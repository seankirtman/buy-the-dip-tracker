import { cacheManager } from '@/lib/db/cache';
import {
  getQuote,
  getDailyTimeSeries,
  getWeeklyTimeSeries,
} from '@/lib/api/yahoo-finance';
import type { CompanyProfile } from '@/lib/api/yahoo-finance';
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

  // Fetch quote (Yahoo → Twelve Data → StockData)
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

  // Profile skipped for Yahoo Finance test mode
  const profile: CompanyProfile | null = null;

  // Fetch history (Yahoo Finance - testing only) (use weekly for 6M+/YTD/1Y - daily 'full' is premium-only)
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
          : getDailyTimeSeries(upperSymbol),
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
      const historyFallbacks: Array<{ key: string; fetcher: () => Promise<TimeSeriesData> }> = [
        { key: 'twelve_data', fetcher: () => (useWeekly ? getTwelveDataWeekly(upperSymbol) : getTwelveDataDaily(upperSymbol)) },
        { key: 'stockdata', fetcher: () => (useWeekly ? getStockDataWeekly(upperSymbol) : getStockDataDaily(upperSymbol)) },
      ];
      for (const fb of historyFallbacks) {
        try {
          const fallbackData = await cacheManager.getOrFetch<TimeSeriesData>(
            'price_cache',
            `${upperSymbol}:${fb.key}:${useWeekly ? 'weekly' : 'daily'}`,
            ttl,
            fb.fetcher,
            upperSymbol
          );
          const filteredPoints = filterDataByPeriod(fallbackData.dataPoints, period);
          history = { ...fallbackData, dataPoints: filteredPoints };
          stale = true;
          break;
        } catch {
          // Try next fallback
        }
      }
    }

    if (!(error instanceof RateLimitError) && !history) {
      console.error('History fetch failed:', error);
    }
  }

  return { quote, history, profile, stale };
}
