import { NextRequest, NextResponse } from 'next/server';
import { cacheManager, CacheManager } from '@/lib/db/cache';
import { getDailyTimeSeries, getWeeklyTimeSeries } from '@/lib/api/alpha-vantage';
import {
  getCompanyProfile,
  getDailyCandlesTimeSeries,
  getCompanyNews,
  getQuote,
} from '@/lib/api/finnhub';
import { detectAnomalies } from '@/lib/events/detector';
import { correlateNews } from '@/lib/events/correlator';
import { scoreAndRankEvents } from '@/lib/events/scorer';
import { RateLimitError } from '@/lib/api/api-queue';
import type { TimeSeriesData } from '@/lib/types/stock';
import type { StockEvent, NewsArticle } from '@/lib/types/event';
import { subYears, subDays, format } from 'date-fns';
import crypto from 'crypto';

const EVENTS_PIPELINE_VERSION = 'v2-prefer-top-headline';

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

    // Step 1: Get stock price data for daily and weekly abnormal-move detection
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

    // Step 2: Get SPY (S&P 500) data for relative comparison
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

          if (dailyAnomalies.length > 0) {
            const correlated = await correlateNews(upperSymbol, dailyAnomalies, companyName);
            const events = normalizeEvents(
              scoreAndRankEvents(correlated, stockDaily.dataPoints, upperSymbol),
              weeklyStart
            );
            return NextResponse.json({
              data: events,
              stale: true,
              error: 'Using Finnhub events fallback due to Alpha Vantage limits',
            });
          }
        }
      } catch {
        // Fall through to empty response below.
      }

      // Final fallback: build news-driven events so Event View remains useful in prod.
      try {
        const to = format(new Date(), 'yyyy-MM-dd');
        const from = format(subDays(new Date(), 90), 'yyyy-MM-dd');
        const [news, quote] = await Promise.all([
          getCompanyNews(upperSymbol, from, to),
          getQuote(upperSymbol),
        ]);

        if (news.length > 0) {
          const fallbackEvents = buildNewsOnlyEvents(upperSymbol, news, quote.price, weeklyStart);
          if (fallbackEvents.length > 0) {
            return NextResponse.json({
              data: fallbackEvents,
              stale: true,
              error: 'Using news-only events fallback due to provider limits',
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

function buildNewsOnlyEvents(
  symbol: string,
  news: NewsArticle[],
  currentPrice: number,
  minDate: string
): StockEvent[] {
  const topNews = [...news]
    .filter((n) => n.publishedAt.slice(0, 10) >= minDate)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 12);

  return topNews.map((article) => {
    const lower = `${article.headline} ${article.summary}`.toLowerCase();
    const isNegative =
      lower.includes('drop') ||
      lower.includes('falls') ||
      lower.includes('decline') ||
      lower.includes('selloff') ||
      lower.includes('downgrade');

    const id = crypto
      .createHash('md5')
      .update(`${symbol}:news-fallback:${article.id}:${article.publishedAt}`)
      .digest('hex')
      .slice(0, 12);

    return {
      id,
      symbol,
      date: article.publishedAt.slice(0, 10),
      type: 'unknown',
      title: article.headline,
      description: article.summary || `${symbol} featured in market coverage from ${article.source}.`,
      impact: {
        magnitude: 'moderate',
        direction: isNegative ? 'negative' : 'positive',
        absoluteMove: 0,
        percentMove: 0,
        volumeSpike: 1,
      },
      priceAtEvent: currentPrice,
      priceNow: currentPrice,
      changeSinceEvent: 0,
      changePercentSinceEvent: 0,
      dailyReturn: 0,
      sp500Return: 0,
      relativeReturn: 0,
      zScore: 0,
      newsArticles: [article],
      recoveryDays: null,
      impactScore: 0,
    };
  });
}
