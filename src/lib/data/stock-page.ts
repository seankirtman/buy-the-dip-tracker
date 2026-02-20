import { cacheManager } from '@/lib/db/cache';
import {
  getQuote,
  getCompanyProfile,
  getCompanyBasicFinancials,
  getDailyCandlesTimeSeries,
} from '@/lib/api/finnhub';
import type { CompanyProfile } from '@/lib/api/finnhub';
import { getDailyTimeSeries, getWeeklyTimeSeries } from '@/lib/api/alpha-vantage';
import { getQuote as getTwelveDataQuote, getDailyTimeSeries as getTwelveDataDaily, getWeeklyTimeSeries as getTwelveDataWeekly } from '@/lib/api/twelve-data';
import { getQuote as getStockDataQuote, getDailyTimeSeries as getStockDataDaily, getWeeklyTimeSeries as getStockDataWeekly } from '@/lib/api/stockdata';
import { RateLimitError } from '@/lib/api/api-queue';
import { isMarketHours } from '@/lib/utils/date';
import { filterDataByPeriod, getTTLForPeriod } from '@/lib/utils/date';
import type { StockQuote, TimePeriod, TimeSeriesData } from '@/lib/types/stock';

export interface StockPageData {
  quote: StockQuote | null;
  history: TimeSeriesData | null;
  profile: CompanyProfile | null;
  stale: boolean;
}

export async function getStockPageData(
  symbol: string,
  period: TimePeriod = '1Y'
): Promise<StockPageData> {
  const upperSymbol = symbol.toUpperCase();
  let stale = false;

  // Fetch quote (Finnhub → Twelve Data → StockData)
  const quoteTtl = isMarketHours() ? 300 : 3600;
  const getQuoteWithFallbacks = async () => {
    try {
      return await getQuote(upperSymbol);
    } catch {
      try {
        return await getTwelveDataQuote(upperSymbol);
      } catch {
        return await getStockDataQuote(upperSymbol);
      }
    }
  };
  let quote: StockQuote | null = null;
  try {
    quote = await cacheManager.getOrFetch(
      'quote_cache',
      upperSymbol,
      quoteTtl,
      getQuoteWithFallbacks
    );
  } catch (error) {
    const cached = cacheManager.getCached<StockQuote>('quote_cache', upperSymbol);
    if (cached) {
      quote = cached;
      stale = true;
    }
    if (!(error instanceof RateLimitError)) {
      console.error('Quote fetch failed:', error);
    }
  }

  // Fetch company profile (market cap) - non-blocking, cache 24h
  let profile: CompanyProfile | null = null;
  try {
    profile = await cacheManager.getOrFetch<CompanyProfile | null>(
      'profile_cache',
      upperSymbol,
      86400, // 24h TTL
      () => getCompanyProfile(upperSymbol)
    );
  } catch {
    // Optional - don't fail page if profile fails
  }

  // Fetch fundamentals (P/E) - non-blocking, cache 24h
  let fundamentals: { peRatio: number | null } | null = null;
  try {
    fundamentals = await cacheManager.getOrFetch<{ peRatio: number | null } | null>(
      'fundamentals_cache',
      upperSymbol,
      86400, // 24h TTL
      async () => {
        const f = await getCompanyBasicFinancials(upperSymbol);
        return f ? { peRatio: f.peRatio } : null;
      }
    );
  } catch {
    // Optional - don't fail page if fundamentals fail
  }

  // Merge P/E into quote for UI
  if (quote && fundamentals?.peRatio != null) {
    quote = { ...quote, peRatio: fundamentals.peRatio };
  }

  // Fetch history (use weekly for 6M+/YTD/1Y - daily 'full' is premium-only)
  const useWeekly = period === '1Y' || period === '6M' || period === 'YTD';
  const cacheKey = useWeekly
    ? `${upperSymbol}:weekly`
    : `${upperSymbol}:daily:compact`;
  const ttl = getTTLForPeriod(period);
  let history: TimeSeriesData | null = null;
  try {
    const fullData = await cacheManager.getOrFetch<TimeSeriesData>(
      'price_cache',
      cacheKey,
      ttl,
      () =>
        useWeekly
          ? getWeeklyTimeSeries(upperSymbol)
          : getDailyTimeSeries(upperSymbol, 'compact'),
      upperSymbol
    );
    const filteredPoints = filterDataByPeriod(fullData.dataPoints, period);
    history = { ...fullData, dataPoints: filteredPoints };
  } catch (error) {
    const cached = cacheManager.getCached<TimeSeriesData>('price_cache', cacheKey);
    if (cached) {
      const filteredPoints = filterDataByPeriod(cached.dataPoints, period);
      history = { ...cached, dataPoints: filteredPoints };
      stale = true;
    } else {
      const historyFallbacks: Array<{ key: string; daily: () => Promise<TimeSeriesData>; weekly: () => Promise<TimeSeriesData> }> = [
        { key: 'finnhub', daily: () => getDailyCandlesTimeSeries(upperSymbol), weekly: () => getDailyCandlesTimeSeries(upperSymbol) },
        { key: 'twelve_data', daily: () => getTwelveDataDaily(upperSymbol), weekly: () => getTwelveDataWeekly(upperSymbol) },
        { key: 'stockdata', daily: () => getStockDataDaily(upperSymbol), weekly: () => getStockDataWeekly(upperSymbol) },
      ];
      for (const fb of historyFallbacks) {
        try {
          const fetcher = useWeekly ? fb.weekly : fb.daily;
          const fallbackData = await cacheManager.getOrFetch<TimeSeriesData>(
            'price_cache',
            `${upperSymbol}:${fb.key}:${useWeekly ? 'weekly' : 'daily'}`,
            ttl,
            fetcher,
            upperSymbol
          );
          const filteredPoints = filterDataByPeriod(fallbackData.dataPoints, period);
          history = { ...fallbackData, dataPoints: filteredPoints };
          stale = true;
          break;
        } catch (fallbackError) {
          const isExpectedProviderDenial =
            fallbackError instanceof Error &&
            (fallbackError.message.includes('API error: 401') ||
              fallbackError.message.includes('API error: 403') ||
              fallbackError.message.includes('API error: 429') ||
              fallbackError.message.includes('not configured'));
          if (!(fallbackError instanceof RateLimitError) && !isExpectedProviderDenial) {
            console.error(`History fallback (${fb.key}) fetch failed:`, fallbackError);
          }
        }
      }
    }

    if (!(error instanceof RateLimitError)) {
      console.error('History fetch failed:', error);
    }
  }

  return { quote, history, profile, stale };
}
