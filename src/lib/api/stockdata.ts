import type { NewsArticle } from '@/lib/types/event';
import type { StockQuote, TimeSeriesData } from '@/lib/types/stock';
import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://api.stockdata.org/v1';

function getApiKey(): string | null {
  const key = process.env.STOCKDATA_API_KEY;
  if (!key || key === 'your_stockdata_key_here') return null;
  return key;
}

export async function getDailyTimeSeries(
  symbol: string,
  daysBack = 365
): Promise<TimeSeriesData> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('STOCKDATA_API_KEY is not configured in .env.local');

  checkRateLimit('stockdata');

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const url = new URL(`${BASE_URL}/data/eod`);
  url.searchParams.set('symbols', symbol);
  url.searchParams.set('interval', 'day');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('date_from', startDate.toISOString().slice(0, 10));
  url.searchParams.set('date_to', endDate.toISOString().slice(0, 10));
  url.searchParams.set('api_token', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`StockData API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('stockdata', 'eod_daily', symbol);

  const data = (json as { data?: Array<Record<string, unknown>> }).data ?? [];
  const dataPoints = data.map((row) => {
    const d = row as { date?: string; open?: number; high?: number; low?: number; close?: number; volume?: number };
    const dateStr = typeof d.date === 'string' ? d.date.slice(0, 10) : '';
    return {
      time: dateStr,
      open: Number(d.open ?? 0),
      high: Number(d.high ?? 0),
      low: Number(d.low ?? 0),
      close: Number(d.close ?? 0),
      volume: Number(d.volume ?? 0),
    };
  }).filter((p) => p.time).sort((a, b) => a.time.localeCompare(b.time));

  const meta = json as { meta?: { date_from?: string; date_to?: string } };
  return {
    symbol,
    dataPoints,
    metadata: {
      lastRefreshed: meta.meta?.date_to ?? new Date().toISOString().slice(0, 10),
      outputSize: 'compact',
      timeZone: 'America/New_York',
    },
  };
}

export async function getWeeklyTimeSeries(symbol: string): Promise<TimeSeriesData> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('STOCKDATA_API_KEY is not configured in .env.local');

  checkRateLimit('stockdata');

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 5);

  const url = new URL(`${BASE_URL}/data/eod`);
  url.searchParams.set('symbols', symbol);
  url.searchParams.set('interval', 'week');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('date_from', startDate.toISOString().slice(0, 10));
  url.searchParams.set('date_to', endDate.toISOString().slice(0, 10));
  url.searchParams.set('api_token', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`StockData API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('stockdata', 'eod_weekly', symbol);

  const data = (json as { data?: Array<Record<string, unknown>> }).data ?? [];
  const dataPoints = data.map((row) => {
    const d = row as { date?: string; open?: number; high?: number; low?: number; close?: number; volume?: number };
    const dateStr = typeof d.date === 'string' ? d.date.slice(0, 10) : '';
    return {
      time: dateStr,
      open: Number(d.open ?? 0),
      high: Number(d.high ?? 0),
      low: Number(d.low ?? 0),
      close: Number(d.close ?? 0),
      volume: Number(d.volume ?? 0),
    };
  }).filter((p) => p.time).sort((a, b) => a.time.localeCompare(b.time));

  const meta = json as { meta?: { date_to?: string } };
  return {
    symbol,
    dataPoints,
    metadata: {
      lastRefreshed: meta.meta?.date_to ?? new Date().toISOString().slice(0, 10),
      outputSize: 'full',
      timeZone: 'America/New_York',
    },
  };
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('STOCKDATA_API_KEY is not configured in .env.local');

  checkRateLimit('stockdata');

  const url = new URL(`${BASE_URL}/data/quote`);
  url.searchParams.set('symbols', symbol);
  url.searchParams.set('api_token', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`StockData API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('stockdata', 'quote', symbol);

  const data = (json as { data?: Array<Record<string, unknown>> }).data ?? [];
  const row = data[0] as {
    ticker?: string;
    name?: string;
    price?: number;
    day_change?: number;
    day_open?: number;
    day_high?: number;
    day_low?: number;
    previous_close_price?: number;
    volume?: number;
    last_trade_time?: string;
    '52_week_high'?: number;
    '52_week_low'?: number;
  };

  if (!row) {
    throw new Error(`StockData: No quote data for ${symbol}`);
  }

  const price = Number(row.price ?? 0);
  const prevClose = Number(row.previous_close_price ?? price);
  const change = Number(row.day_change ?? price - prevClose);
  const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;

  return {
    symbol: row.ticker ?? symbol,
    name: (row.name as string) ?? symbol,
    price,
    change,
    changePercent,
    open: Number(row.day_open ?? 0),
    high: Number(row.day_high ?? 0),
    low: Number(row.day_low ?? 0),
    previousClose: prevClose,
    volume: Number(row.volume ?? 0),
    week52High: row['52_week_high'],
    week52Low: row['52_week_low'],
    lastUpdated: (row.last_trade_time ?? new Date().toISOString()).slice(0, 10),
  };
}

export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<NewsArticle[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('STOCKDATA_API_KEY is not configured in .env.local');

  checkRateLimit('stockdata');

  const url = new URL(`${BASE_URL}/news/all`);
  url.searchParams.set('symbols', symbol);
  url.searchParams.set('published_after', `${from}T00:00:00`);
  url.searchParams.set('published_before', `${to}T23:59:59`);
  url.searchParams.set('limit', '50');
  url.searchParams.set('api_token', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`StockData API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('stockdata', 'news', symbol);

  const data = (json as { data?: Array<Record<string, unknown>> }).data ?? [];
  return data.map((a, i) => {
    const article = a as {
      uuid?: string;
      title?: string;
      snippet?: string;
      source?: string;
      url?: string;
      published_at?: string;
      entities?: Array<{ sentiment_score?: number }>;
    };
    const publishedAt = article.published_at ?? new Date().toISOString();
    const entities = (article.entities ?? []) as Array<{ sentiment_score?: number }>;
    const avgSentiment = entities.length > 0
      ? entities.reduce((s, e) => s + (e.sentiment_score ?? 0), 0) / entities.length
      : 0;
    const sentiment: 'positive' | 'negative' | 'neutral' =
      avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'neutral';

    return {
      id: parseInt(article.uuid?.slice(-8).replace(/\D/g, '0') || String(i), 10) || i + 1,
      headline: (article.title as string) ?? '',
      summary: (article.snippet as string) ?? '',
      source: (article.source as string) ?? 'StockData',
      url: (article.url as string) ?? '',
      publishedAt,
      sentiment,
    };
  });
}
