import { NextRequest, NextResponse } from 'next/server';
import { cacheManager, CacheManager } from '@/lib/db/cache';
import { getDailyTimeSeries, getWeeklyTimeSeries } from '@/lib/api/alpha-vantage';
import { getCompanyProfile, getCompanyNews, getDailyCandlesTimeSeries, getQuote } from '@/lib/api/finnhub';
import { detectAnomalies } from '@/lib/events/detector';
import { correlateNews } from '@/lib/events/correlator';
import { scoreAndRankEvents } from '@/lib/events/scorer';
import { RateLimitError } from '@/lib/api/api-queue';
import type { OHLCDataPoint, TimeSeriesData } from '@/lib/types/stock';
import type { StockEvent, NewsArticle } from '@/lib/types/event';
import type { PriceAnomaly } from '@/lib/events/detector';
import { subYears, subDays, format } from 'date-fns';
import crypto from 'crypto';

const EVENTS_PIPELINE_VERSION = 'v3-adjusted-prices';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();
  let stale = false;
  const weeklyStart = format(subYears(new Date(), 1), 'yyyy-MM-dd');

  try {
    const getSeries = async (
      key: string,
      fetcher: () => Promise<TimeSeriesData>,
      symbolForCache: string
    ): Promise<TimeSeriesData> => {
      try {
        return await cacheManager.getOrFetch<TimeSeriesData>(
          'price_cache',
          key,
          604800, // 7 day TTL
          fetcher,
          symbolForCache
        );
      } catch (error) {
        const cached = cacheManager.getCached<TimeSeriesData>('price_cache', key);
        if (cached) {
          stale = true;
          return cached;
        }
        throw error;
      }
    };

    // Step 1: Fetch SPY first (shared across all symbols) so it’s cached for subsequent requests
    const spyDaily = await getSeries(
      'SPY:daily:compact',
      () => getDailyTimeSeries('SPY', 'compact'),
      'SPY'
    );
    const spyWeekly = await getSeries(
      'SPY:weekly',
      () => getWeeklyTimeSeries('SPY'),
      'SPY'
    );

    // Step 2: Get stock price data for daily and weekly abnormal-move detection
    const stockDaily = await getSeries(
      `${upperSymbol}:daily:compact`,
      () => getDailyTimeSeries(upperSymbol, 'compact'),
      upperSymbol
    );
    const stockWeekly = await getSeries(
      `${upperSymbol}:weekly`,
      () => getWeeklyTimeSeries(upperSymbol),
      upperSymbol
    );

    // Keep analysis recent so outputs reflect current narrative windows.
    const stockWeeklyRecent = {
      ...stockWeekly,
      dataPoints: stockWeekly.dataPoints.filter((p) => p.time >= weeklyStart),
    };
    const spyWeeklyRecent = {
      ...spyWeekly,
      dataPoints: spyWeekly.dataPoints.filter((p) => p.time >= weeklyStart),
    };

    // Company name improves article mention matching (e.g., CRM -> Salesforce)
    let companyName: string | undefined;
    try {
      const profile = await getCompanyProfile(upperSymbol);
      companyName = profile?.name;
    } catch {
      // Optional enrichment only
    }

    // Step 3: Check if we have cached events for this data
    const dataHash = CacheManager.hashData({
      pipelineVersion: EVENTS_PIPELINE_VERSION,
      weeklyStart,
      stockDaily: stockDaily.dataPoints.length,
      stockDailyLast: stockDaily.dataPoints[stockDaily.dataPoints.length - 1]?.time,
      stockWeekly: stockWeekly.dataPoints.length,
      stockWeeklyLast: stockWeekly.dataPoints[stockWeekly.dataPoints.length - 1]?.time,
      stockWeeklyRecent: stockWeeklyRecent.dataPoints.length,
      spyDaily: spyDaily.dataPoints.length,
      spyDailyLast: spyDaily.dataPoints[spyDaily.dataPoints.length - 1]?.time,
      spyWeekly: spyWeekly.dataPoints.length,
      spyWeeklyLast: spyWeekly.dataPoints[spyWeekly.dataPoints.length - 1]?.time,
      spyWeeklyRecent: spyWeeklyRecent.dataPoints.length,
    });

    const cachedEvents = cacheManager.getEventsCache<StockEvent[]>(upperSymbol, dataHash);
    if (cachedEvents) {
      return NextResponse.json({ data: normalizeEvents(cachedEvents, weeklyStart), stale });
    }

    // Step 4: Detect abnormal daily and weekly moves versus SPY
    const dailyAnomalies = detectAnomalies(stockDaily.dataPoints, spyDaily.dataPoints, {
      rollingWindow: 40,
      zScoreThreshold: 1.9,
      volumeWindow: 20,
      timeframe: 'daily',
    });
    const weeklyAnomalies = detectAnomalies(stockWeeklyRecent.dataPoints, spyWeeklyRecent.dataPoints, {
      rollingWindow: 20,
      zScoreThreshold: 1.7,
      volumeWindow: 8,
      clusterDays: 7,
      timeframe: 'weekly',
    });
    const anomalies = [
      ...dailyAnomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 8),
      ...weeklyAnomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 6),
    ].sort((a, b) => a.date.localeCompare(b.date));

    if (anomalies.length === 0) {
      const emptyResult: StockEvent[] = [];
      cacheManager.setEventsCache(upperSymbol, emptyResult, dataHash);
      return NextResponse.json({ data: emptyResult, stale });
    }

    // Step 5: Correlate anomalies with same-day company-mention news
    const correlated = await correlateNews(upperSymbol, anomalies, companyName);

    // Step 6: Score and rank events
    const events = normalizeEvents(
      scoreAndRankEvents(correlated, stockDaily.dataPoints, upperSymbol),
      weeklyStart
    );

    // Step 7: Cache computed events
    cacheManager.setEventsCache(upperSymbol, events, dataHash);

    return NextResponse.json({ data: events, stale });
  } catch (error) {
    const isProviderRateLimited =
      error instanceof RateLimitError ||
      (error instanceof Error &&
        (error.message.includes('rate limit') ||
          error.message.includes('Thank you for using Alpha Vantage')));

    if (isProviderRateLimited) {
      // Try to return cached events even if stale
      const cachedEvents = cacheManager.getCached<StockEvent[]>('events_cache', upperSymbol);
      if (cachedEvents) {
        return NextResponse.json({
          data: normalizeEvents(cachedEvents, weeklyStart),
          stale: true,
          error: error.message,
        });
      }

      // Fallback path for production: compute events from Finnhub daily candles only.
      // This avoids Alpha Vantage limits while still surfacing useful event context.
      try {
        const [stockWeeklyCached, spyWeeklyCached] = [
          cacheManager.getCached<TimeSeriesData>('price_cache', `${upperSymbol}:weekly`),
          cacheManager.getCached<TimeSeriesData>('price_cache', 'SPY:weekly'),
        ];

        if (
          stockWeeklyCached?.dataPoints?.length &&
          spyWeeklyCached?.dataPoints?.length &&
          stockWeeklyCached.dataPoints.length >= 20 &&
          spyWeeklyCached.dataPoints.length >= 20
        ) {
          let companyName: string | undefined;
          try {
            const profile = await getCompanyProfile(upperSymbol);
            companyName = profile?.name;
          } catch {
            // Optional enrichment only.
          }

          const weeklyAnchors = selectTopRelativeMoveAnchors(
            stockWeeklyCached.dataPoints,
            spyWeeklyCached.dataPoints,
            weeklyStart,
            'weekly'
          );

          if (weeklyAnchors.length > 0) {
            const correlated = await correlateNews(upperSymbol, weeklyAnchors, companyName);
            const events = normalizeEvents(
              scoreAndRankEvents(correlated, stockWeeklyCached.dataPoints, upperSymbol),
              weeklyStart
            );
            return NextResponse.json({
              data: events,
              stale: true,
              error: 'Using cached weekly date-anchored fallback due to provider limits',
            });
          }
        }
      } catch {
        // Continue to next fallback.
      }

      try {
        const [stockDaily, spyDaily] = await Promise.all([
          getDailyCandlesTimeSeries(upperSymbol),
          getDailyCandlesTimeSeries('SPY'),
        ]);

        if (stockDaily.dataPoints.length >= 50 && spyDaily.dataPoints.length >= 50) {
          let companyName: string | undefined;
          try {
            const profile = await getCompanyProfile(upperSymbol);
            companyName = profile?.name;
          } catch {
            // Optional enrichment only.
          }

          const dailyAnomalies = detectAnomalies(stockDaily.dataPoints, spyDaily.dataPoints, {
            rollingWindow: 40,
            zScoreThreshold: 1.9,
            volumeWindow: 20,
            timeframe: 'daily',
          })
            .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
            .slice(0, 10);

          // If strict anomalies are empty, use top relative-move dates as fallback anchors.
          const fallbackAnchors =
            dailyAnomalies.length > 0
              ? dailyAnomalies
              : selectTopRelativeMoveAnchors(stockDaily.dataPoints, spyDaily.dataPoints, weeklyStart);

          if (fallbackAnchors.length > 0) {
            const correlated = await correlateNews(upperSymbol, fallbackAnchors, companyName);
            const events = normalizeEvents(
              scoreAndRankEvents(correlated, stockDaily.dataPoints, upperSymbol),
              weeklyStart
            );
            return NextResponse.json({
              data: events,
              stale: true,
              error:
                dailyAnomalies.length > 0
                  ? 'Using Finnhub events fallback due to Alpha Vantage limits'
                  : 'Using date-anchored Finnhub fallback due to provider limits',
            });
          }
        }
      } catch {
        // Continue to news-only fallback.
      }

      // Final fallback: use Finnhub company-news only (no price anomaly data).
      // Surfaces recent news when candle data is unavailable (e.g. free tier restrictions).
      try {
        const toDate = new Date();
        const fromDate = subDays(toDate, 14);
        const from = format(fromDate, 'yyyy-MM-dd');
        const to = format(toDate, 'yyyy-MM-dd');
        const articles = await getCompanyNews(upperSymbol, from, to);
        if (articles.length > 0) {
          const quote = await getQuote(upperSymbol).catch(() => null);
          const priceNow = quote?.price ?? 0;
          const newsEvents = createNewsOnlyEvents(upperSymbol, articles, priceNow, weeklyStart);
          if (newsEvents.length > 0) {
            return NextResponse.json({
              data: newsEvents,
              stale: true,
              error: 'Showing recent news only — price data unavailable due to provider limits',
            });
          }
        }
      } catch {
        // Fall through to empty response below.
      }

      // No cache/fallback available: return empty list so UI stays functional.
      return NextResponse.json({
        data: [],
        stale: true,
        error: error instanceof Error ? error.message : 'Rate limited',
      });
    }

    console.error('Events API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute events' },
      { status: 500 }
    );
  }
}

/**
 * Create minimal StockEvents from recent company news when price data is unavailable.
 */
function createNewsOnlyEvents(
  symbol: string,
  articles: NewsArticle[],
  priceNow: number,
  minDate: string
): StockEvent[] {
  const seenDates = new Set<string>();
  const events: StockEvent[] = [];

  for (const article of articles) {
    const date = article.publishedAt.slice(0, 10);
    if (date < minDate || seenDates.has(date)) continue;
    seenDates.add(date);

    const title = article.headline.length > 80 ? article.headline.slice(0, 77) + '...' : article.headline;
    const description = article.summary
      ? `${article.summary.slice(0, 150)}${article.summary.length > 150 ? '...' : ''}`
      : `${symbol} in the news on ${date}.`;

    const id = crypto
      .createHash('md5')
      .update(`news:${symbol}:${date}:${article.id}`)
      .digest('hex')
      .slice(0, 12);

    events.push({
      id,
      symbol,
      date,
      type: 'unknown',
      title,
      description,
      impact: {
        magnitude: 'moderate',
        direction: 'positive',
        absoluteMove: 0,
        percentMove: 0,
        volumeSpike: 1,
      },
      priceAtEvent: priceNow,
      priceNow,
      changeSinceEvent: 0,
      changePercentSinceEvent: 0,
      dailyReturn: 0,
      sp500Return: 0,
      relativeReturn: 0,
      zScore: 0,
      newsArticles: [article],
      recoveryDays: null,
      impactScore: 0.5,
    });

    if (events.length >= 10) break;
  }

  return events.sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeEvents(events: StockEvent[], minDate: string): StockEvent[] {
  const filtered = [...events]
    .filter((event) => event.date >= minDate)
    .sort((a, b) => b.date.localeCompare(a.date));

  const withBackfilledFields = filtered.map((event) => {
    const sp500Return =
      typeof event.sp500Return === 'number'
        ? event.sp500Return
        : event.dailyReturn - event.relativeReturn;
    return { ...event, sp500Return };
  });

  // Defensively ensure IDs are unique for React keys, including stale cached payloads.
  const seen = new Map<string, number>();
  return withBackfilledFields.map((event) => {
    const count = seen.get(event.id) ?? 0;
    seen.set(event.id, count + 1);
    if (count === 0) return event;
    return { ...event, id: `${event.id}-${count + 1}` };
  });
}

function selectTopRelativeMoveAnchors(
  stockData: OHLCDataPoint[],
  spyData: OHLCDataPoint[],
  minDate: string,
  timeframe: 'daily' | 'weekly' = 'daily'
): PriceAnomaly[] {
  const spyByDate = new Map(spyData.map((p) => [p.time, p]));
  const aligned: Array<{ stock: OHLCDataPoint; spy: OHLCDataPoint }> = [];
  for (const stock of stockData) {
    const spy = spyByDate.get(stock.time);
    if (spy) aligned.push({ stock, spy });
  }

  if (aligned.length < 3) return [];

  const candidates: PriceAnomaly[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const prev = aligned[i - 1];
    const curr = aligned[i];
    const stockReturn = prev.stock.close !== 0 ? (curr.stock.close - prev.stock.close) / prev.stock.close : 0;
    const spyReturn = prev.spy.close !== 0 ? (curr.spy.close - prev.spy.close) / prev.spy.close : 0;
    const relativeReturn = stockReturn - spyReturn;

    const volWindowStart = Math.max(1, i - 20);
    const volWindow = aligned.slice(volWindowStart, i).map((r) => r.stock.volume);
    const avgVol =
      volWindow.length > 0 ? volWindow.reduce((sum, v) => sum + v, 0) / volWindow.length : curr.stock.volume;
    const volumeSpike = avgVol > 0 ? curr.stock.volume / avgVol : 1;

    candidates.push({
      index: i,
      date: curr.stock.time,
      timeframe,
      stockReturn,
      spyReturn,
      relativeReturn,
      zScore: Math.abs(relativeReturn) * 100, // proxy score for ranking only
      volumeSpike,
      close: curr.stock.close,
      volume: curr.stock.volume,
    });
  }

  return candidates
    .filter((c) => c.date >= minDate)
    .sort((a, b) => Math.abs(b.relativeReturn) - Math.abs(a.relativeReturn))
    .slice(0, 8);
}
