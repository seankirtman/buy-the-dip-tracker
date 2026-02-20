import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '@/lib/db/cache';
import {
  getDailyTimeSeries,
  getWeeklyTimeSeries,
  getIntradayTimeSeries,
} from '@/lib/api/yahoo-finance';
import { getDailyTimeSeries as getTwelveDataDaily, getWeeklyTimeSeries as getTwelveDataWeekly } from '@/lib/api/twelve-data';
import { getDailyTimeSeries as getStockDataDaily, getWeeklyTimeSeries as getStockDataWeekly } from '@/lib/api/stockdata';
import { RateLimitError } from '@/lib/api/api-queue';
import { filterDataByPeriod, getTTLForPeriod } from '@/lib/utils/date';
import type { TimePeriod, TimeSeriesData } from '@/lib/types/stock';

const VALID_PERIODS: TimePeriod[] = ['1D', '7D', '1M', '6M', 'YTD', '1Y'];

// Alpha Vantage free tier: daily 'full' is premium-only. Use weekly for 6M+/YTD/1Y.
const USE_WEEKLY_FOR: TimePeriod[] = ['6M', 'YTD', '1Y'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();
  const period = (request.nextUrl.searchParams.get('period') || '1Y') as TimePeriod;

  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json(
      { error: `Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}` },
      { status: 400 }
    );
  }

  const useIntraday = period === '1D';
  const useWeekly = USE_WEEKLY_FOR.includes(period);
  const cacheKey = useIntraday
    ? `${upperSymbol}:intraday:5min`
    : useWeekly
      ? `${upperSymbol}:weekly`
      : `${upperSymbol}:daily:compact`;
  const ttl = getTTLForPeriod(period);

  try {
    const fullData = await cacheManager.getOrFetch<TimeSeriesData>(
      'price_cache',
      cacheKey,
      ttl,
      () =>
        useIntraday
          ? getIntradayTimeSeries(upperSymbol)
          : useWeekly
            ? getWeeklyTimeSeries(upperSymbol)
            : getDailyTimeSeries(upperSymbol),
      upperSymbol
    );

    // Filter data to the requested period
    const filteredPoints = useIntraday
      ? fullData.dataPoints
      : filterDataByPeriod(fullData.dataPoints, period);

    return NextResponse.json({
      data: {
        ...fullData,
        dataPoints: filteredPoints,
      },
    });
  } catch (error) {
    const cached = cacheManager.getCached<TimeSeriesData>('price_cache', cacheKey);
    if (cached && (!useIntraday || cached.dataPoints.length >= 4)) {
      const filteredPoints = useIntraday
        ? cached.dataPoints
        : filterDataByPeriod(cached.dataPoints, period);
      return NextResponse.json({
        data: { ...cached, dataPoints: filteredPoints },
        stale: true,
        error: error instanceof Error ? error.message : 'Using cached history data',
      });
    }

    if (!useIntraday) {
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
          return NextResponse.json({
            data: { ...fallbackData, dataPoints: filteredPoints },
            stale: true,
            error: `Using ${fb.key} history fallback`,
          });
        } catch {
          // Try next fallback
        }
      }
    }

    const isProviderLimited =
      error instanceof RateLimitError ||
      (error instanceof Error &&
        (error.message.includes('rate limit') ||
          error.message.includes('premium endpoint') ||
          error.message.includes('Alpha Vantage')));

    if (isProviderLimited) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'History data rate limited' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
