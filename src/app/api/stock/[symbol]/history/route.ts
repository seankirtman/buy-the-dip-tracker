import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '@/lib/db/cache';
import { getDailyTimeSeries, getWeeklyTimeSeries } from '@/lib/api/alpha-vantage';
import { getIntradayTimeSeries, getDailyCandlesTimeSeries } from '@/lib/api/finnhub';
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
    ? `${upperSymbol}:intraday:60min`
    : useWeekly
      ? `${upperSymbol}:weekly`
      : `${upperSymbol}:daily:compact`;
  const ttl = getTTLForPeriod(period);

  try {
    const fetchIntradayWithFallback = async (): Promise<TimeSeriesData> => {
      try {
        const intraday = await getIntradayTimeSeries(upperSymbol);
        if (intraday.dataPoints.length > 0) return intraday;
      } catch {
        // Fallback to daily below
      }

      // Fallback: return latest daily bar if intraday endpoint is unavailable for this key.
      const daily = await getDailyTimeSeries(upperSymbol, 'compact');
      const latestDate = daily.dataPoints[daily.dataPoints.length - 1]?.time;
      const latestOnly = latestDate
        ? daily.dataPoints.filter((p) => p.time === latestDate)
        : [];
      return { ...daily, dataPoints: latestOnly };
    };

    const fullData = await cacheManager.getOrFetch<TimeSeriesData>(
      'price_cache',
      cacheKey,
      ttl,
      () =>
        useIntraday
          ? fetchIntradayWithFallback()
          : useWeekly
            ? getWeeklyTimeSeries(upperSymbol)
            : getDailyTimeSeries(upperSymbol, 'compact'),
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
    if (cached) {
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
      try {
        const finnhubDaily = await cacheManager.getOrFetch<TimeSeriesData>(
          'price_cache',
          `${upperSymbol}:finnhub:daily`,
          ttl,
          () => getDailyCandlesTimeSeries(upperSymbol),
          upperSymbol
        );
        const filteredPoints = filterDataByPeriod(finnhubDaily.dataPoints, period);
        return NextResponse.json({
          data: {
            ...finnhubDaily,
            dataPoints: filteredPoints,
          },
          stale: true,
          error: 'Using Finnhub history fallback',
        });
      } catch {
        // Continue to original error response path below.
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
