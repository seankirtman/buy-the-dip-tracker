import {
  finnhubCandleSchema,
  finnhubCompanyProfileSchema,
  finnhubNewsArraySchema,
  finnhubQuoteSchema,
  finnhubSearchResponseSchema,
} from '@/lib/types/api';
import type { NewsArticle } from '@/lib/types/event';
import type { StockQuote, SearchResult, TimeSeriesData } from '@/lib/types/stock';
import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://finnhub.io/api/v1';

function getApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key || key === 'your_finnhub_key_here') {
    throw new Error('FINNHUB_API_KEY is not configured in .env.local');
  }
  return key;
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  checkRateLimit('finnhub');

  const apiKey = getApiKey();
  const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('finnhub', 'quote', symbol);

  const parsed = finnhubQuoteSchema.parse(json);
  const c = parsed.c ?? 0;
  const o = parsed.o ?? 0;
  const h = parsed.h ?? 0;
  const l = parsed.l ?? 0;
  const pc = parsed.pc ?? o;
  const change = parsed.d ?? c - pc;
  const changePercent = parsed.dp ?? (pc ? ((c - pc) / pc) * 100 : 0);
  const lastUpdated = parsed.t
    ? new Date(parsed.t * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return {
    symbol,
    name: symbol,
    price: c,
    change,
    changePercent,
    open: o,
    high: h,
    low: l,
    previousClose: pc,
    volume: parsed.v ?? 0,
    lastUpdated,
  };
}

export interface CompanyProfile {
  marketCap: number | null;
  name?: string;
  industry?: string;
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  checkRateLimit('finnhub');

  const apiKey = getApiKey();
  const url = `${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  recordApiCall('finnhub', 'profile2', symbol);

  const parsed = finnhubCompanyProfileSchema.safeParse(json);
  if (!parsed.success) return null;

  const mc = parsed.data.marketCapitalization;
  // Finnhub returns market cap in millions
  const marketCap = mc != null && mc > 0 ? mc * 1e6 : null;

  return {
    marketCap,
    name: parsed.data.name,
    industry: parsed.data.finnhubIndustry,
  };
}

export async function searchSymbol(query: string): Promise<SearchResult[]> {
  checkRateLimit('finnhub');

  const apiKey = getApiKey();
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&token=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('finnhub', 'search', query);

  const parsed = finnhubSearchResponseSchema.parse(json);

  return parsed.result.map((r) => ({
    symbol: r.symbol,
    name: r.description ?? r.displaySymbol ?? r.symbol,
    type: r.type ?? 'Equity',
    region: '',
    currency: '',
  }));
}

export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<NewsArticle[]> {
  checkRateLimit('finnhub');

  const apiKey = getApiKey();
  const url = `${BASE_URL}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('finnhub', 'company-news', symbol);

  const parsed = finnhubNewsArraySchema.parse(json);

  return parsed.map((item) => ({
    id: item.id,
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    url: item.url,
    publishedAt: new Date(item.datetime * 1000).toISOString(),
  }));
}

export async function getIntradayTimeSeries(symbol: string): Promise<TimeSeriesData> {
  checkRateLimit('finnhub');

  const apiKey = getApiKey();
  const now = Math.floor(Date.now() / 1000);
  const oneWeekAgo = now - 7 * 24 * 60 * 60;
  const url = `${BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${oneWeekAgo}&to=${now}&token=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('finnhub', 'stock/candle', symbol);

  const parsed = finnhubCandleSchema.parse(json);
  if (parsed.s !== 'ok' || parsed.t.length === 0) {
    return {
      symbol,
      dataPoints: [],
      metadata: {
        lastRefreshed: new Date().toISOString(),
        outputSize: 'compact',
        timeZone: 'UTC',
      },
    };
  }

  const points = parsed.t.map((ts, i) => ({
    time: new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '), // YYYY-MM-DD HH:mm:ss
    open: parsed.o[i],
    high: parsed.h[i],
    low: parsed.l[i],
    close: parsed.c[i],
    volume: parsed.v[i],
  }));

  // Keep only the latest active trading day.
  const lastDate = points[points.length - 1].time.slice(0, 10);
  const latestDayPoints = points.filter((p) => p.time.startsWith(lastDate));

  return {
    symbol,
    dataPoints: latestDayPoints,
    metadata: {
      lastRefreshed: new Date(parsed.t[parsed.t.length - 1] * 1000).toISOString(),
      outputSize: 'compact',
      timeZone: 'UTC',
    },
  };
}

export async function getDailyCandlesTimeSeries(
  symbol: string,
  daysBack = 730
): Promise<TimeSeriesData> {
  checkRateLimit('finnhub');

  const apiKey = getApiKey();
  const now = Math.floor(Date.now() / 1000);
  const from = now - daysBack * 24 * 60 * 60;
  const url = `${BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    // Some Finnhub plans do not include daily candles for all symbols.
    // Return an empty series so fallback logic stays non-fatal in UI.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return {
        symbol,
        dataPoints: [],
        metadata: {
          lastRefreshed: new Date().toISOString(),
          outputSize: 'compact',
          timeZone: 'UTC',
        },
      };
    }
    throw new Error(`Finnhub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('finnhub', 'stock/candle', symbol);

  const parsed = finnhubCandleSchema.parse(json);
  if (parsed.s !== 'ok' || parsed.t.length === 0) {
    return {
      symbol,
      dataPoints: [],
      metadata: {
        lastRefreshed: new Date().toISOString(),
        outputSize: 'compact',
        timeZone: 'UTC',
      },
    };
  }

  const points = parsed.t.map((ts, i) => ({
    time: new Date(ts * 1000).toISOString().slice(0, 10), // YYYY-MM-DD
    open: parsed.o[i],
    high: parsed.h[i],
    low: parsed.l[i],
    close: parsed.c[i],
    volume: parsed.v[i],
  }));

  return {
    symbol,
    dataPoints: points,
    metadata: {
      lastRefreshed: new Date(parsed.t[parsed.t.length - 1] * 1000).toISOString(),
      outputSize: 'compact',
      timeZone: 'UTC',
    },
  };
}
