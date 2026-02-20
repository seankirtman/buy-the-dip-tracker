import { cacheManager } from '@/lib/db/cache';
import {
  getQuote,
  getCompanyProfile,
  getCompanyBasicFinancials,
  getDailyCandlesTimeSeries,
} from '@/lib/api/finnhub';
import type { CompanyProfile } from '@/lib/api/finnhub';
import { getDailyTimeSeries, getWeeklyTimeSeries } from '@/lib/api/alpha-vantage';
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

  // Fetch quote
  const quoteTtl = isMarketHours() ? 300 : 3600;
  let quote: StockQuote | null = null;
  try {
    quote = await cacheManager.getOrFetch(
      'quote_cache',
      upperSymbol,
      quoteTtl,
      () => getQuote(upperSymbol)
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
      // Fallback provider for history when Alpha Vantage is unavailable/rate-limited.
      try {
        const finnhubDaily = await cacheManager.getOrFetch<TimeSeriesData>(
          'price_cache',
          `${upperSymbol}:finnhub:daily`,
          ttl,
          () => getDailyCandlesTimeSeries(upperSymbol),
          upperSymbol
        );
        const filteredPoints = filterDataByPeriod(finnhubDaily.dataPoints, period);
        history = { ...finnhubDaily, dataPoints: filteredPoints };
        stale = true;
      } catch (fallbackError) {
        const isExpectedProviderDenial =
          fallbackError instanceof Error &&
          (fallbackError.message.includes('Finnhub API error: 401') ||
            fallbackError.message.includes('Finnhub API error: 403') ||
            fallbackError.message.includes('Finnhub API error: 429'));
        if (!(fallbackError instanceof RateLimitError) && !isExpectedProviderDenial) {
          console.error('History fallback fetch failed:', fallbackError);
        }
      }
    }

    if (!(error instanceof RateLimitError)) {
      console.error('History fetch failed:', error);
    }
  }

  return { quote, history, profile, stale };
}
