import { cacheManager } from '@/lib/db/cache';

export class RateLimitError extends Error {
  constructor(provider: string, limit: number, used: number) {
    super(`${provider} rate limit reached: ${used}/${limit} requests used today`);
    this.name = 'RateLimitError';
  }
}

const LIMITS: Record<string, { daily: number; perMinute: number }> = {
  alpha_vantage: { daily: 25, perMinute: 5 },
  finnhub: { daily: Infinity, perMinute: 60 },
  fmp: { daily: 250, perMinute: 10 },
  twelve_data: { daily: 800, perMinute: 8 },
  stockdata: { daily: 100, perMinute: 10 },
};

const minuteTrackers: Record<string, number[]> = {};

export function checkRateLimit(provider: string): void {
  const limits = LIMITS[provider];
  if (!limits) return;

  // Check daily limit
  const usedToday = cacheManager.getApiUsageToday(provider);
  if (usedToday >= limits.daily) {
    throw new RateLimitError(provider, limits.daily, usedToday);
  }

  // Check per-minute limit
  const now = Date.now();
  if (!minuteTrackers[provider]) {
    minuteTrackers[provider] = [];
  }
  const tracker = minuteTrackers[provider];
  // Remove entries older than 1 minute
  while (tracker.length > 0 && now - tracker[0] > 60000) {
    tracker.shift();
  }
  if (tracker.length >= limits.perMinute) {
    throw new RateLimitError(provider, limits.perMinute, tracker.length);
  }
}

export function recordApiCall(provider: string, endpoint: string, symbol?: string): void {
  const now = Date.now();
  if (!minuteTrackers[provider]) {
    minuteTrackers[provider] = [];
  }
  minuteTrackers[provider].push(now);
  cacheManager.recordApiUsage(provider, endpoint, symbol);
}

export function getUsageToday(provider: string): number {
  return cacheManager.getApiUsageToday(provider);
}
