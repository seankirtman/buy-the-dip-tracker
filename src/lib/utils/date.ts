import { subDays, subMonths, subYears, startOfYear, format } from 'date-fns';
import type { TimePeriod } from '@/lib/types/stock';

export function getPeriodStartDate(period: TimePeriod, from?: Date): string {
  const now = from || new Date();

  switch (period) {
    case '1D':
      return format(subDays(now, 1), 'yyyy-MM-dd');
    case '7D':
      // 11 calendar days ensures ~7 trading days (accounts for weekends)
      return format(subDays(now, 11), 'yyyy-MM-dd');
    case '1M':
      return format(subMonths(now, 1), 'yyyy-MM-dd');
    case '6M':
      return format(subMonths(now, 6), 'yyyy-MM-dd');
    case 'YTD':
      return format(startOfYear(now), 'yyyy-MM-dd');
    case '1Y':
      return format(subYears(now, 1), 'yyyy-MM-dd');
  }
}

export function filterDataByPeriod<T extends { time: string }>(
  data: T[],
  period: TimePeriod
): T[] {
  const startDate = getPeriodStartDate(period);
  return data.filter((d) => d.time >= startDate);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return format(date, 'MMM d, yyyy');
}

export function isMarketHours(): boolean {
  const now = new Date();
  const eastern = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  const hour = eastern.getHours();
  const day = eastern.getDay();

  // Market hours: Mon-Fri 9:30 AM - 4:00 PM ET
  if (day === 0 || day === 6) return false;
  if (hour < 9 || (hour === 9 && eastern.getMinutes() < 30)) return false;
  if (hour >= 16) return false;
  return true;
}

export function getTTLForPeriod(period: TimePeriod): number {
  if (period === '1D' || period === '7D') {
    return isMarketHours() ? 300 : 3600; // 5 min / 1 hr
  }
  return isMarketHours() ? 14400 : 43200; // 4 hr / 12 hr
}
