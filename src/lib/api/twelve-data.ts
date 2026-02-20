import type { StockQuote, SearchResult, TimeSeriesData } from '@/lib/types/stock';
import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://api.twelvedata.com';

function getApiKey(): string | null {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key || key === 'your_twelve_data_key_here') return null;
  return key;
}

export async function getDailyTimeSeries(
  symbol: string,
  outputSize = 100
): Promise<TimeSeriesData> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured in .env.local');

  checkRateLimit('twelve_data');

  const url = new URL(`${BASE_URL}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1day');
  url.searchParams.set('outputsize', String(outputSize));
  url.searchParams.set('adjust', 'splits');
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg = (json as { message?: string }).message ?? res.statusText;
    throw new Error(`Twelve Data API error: ${res.status} ${msg}`);
  }

  const json = await res.json();
  recordApiCall('twelve_data', 'time_series_daily', symbol);

  if ((json as { status?: string }).status === 'error') {
    throw new Error(
      `Twelve Data: ${(json as { message?: string }).message ?? 'Unknown error'}`
    );
  }

  const values = (json as { values?: Array<Record<string, string>> }).values ?? [];
  const meta = (json as { meta?: { symbol?: string; exchange_timezone?: string } }).meta ?? {};
  const dataPoints = values.map((v) => ({
    time: (v.datetime ?? '').slice(0, 10),
    open: parseFloat(v.open ?? '0'),
    high: parseFloat(v.high ?? '0'),
    low: parseFloat(v.low ?? '0'),
    close: parseFloat(v.close ?? '0'),
    volume: parseInt(v.volume ?? '0', 10),
  })).sort((a, b) => a.time.localeCompare(b.time));

  return {
    symbol: meta.symbol ?? symbol,
    dataPoints,
    metadata: {
      lastRefreshed: values[0]?.datetime ?? new Date().toISOString(),
      outputSize: outputSize >= 5000 ? 'full' : 'compact',
      timeZone: meta.exchange_timezone ?? 'America/New_York',
    },
  };
}

export async function getWeeklyTimeSeries(symbol: string): Promise<TimeSeriesData> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured in .env.local');

  checkRateLimit('twelve_data');

  const url = new URL(`${BASE_URL}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1week');
  url.searchParams.set('outputsize', '200');
  url.searchParams.set('adjust', 'splits');
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg = (json as { message?: string }).message ?? res.statusText;
    throw new Error(`Twelve Data API error: ${res.status} ${msg}`);
  }

  const json = await res.json();
  recordApiCall('twelve_data', 'time_series_weekly', symbol);

  if ((json as { status?: string }).status === 'error') {
    throw new Error(
      `Twelve Data: ${(json as { message?: string }).message ?? 'Unknown error'}`
    );
  }

  const values = (json as { values?: Array<Record<string, string>> }).values ?? [];
  const meta = (json as { meta?: { symbol?: string; exchange_timezone?: string } }).meta ?? {};
  const dataPoints = values.map((v) => ({
    time: (v.datetime ?? '').slice(0, 10),
    open: parseFloat(v.open ?? '0'),
    high: parseFloat(v.high ?? '0'),
    low: parseFloat(v.low ?? '0'),
    close: parseFloat(v.close ?? '0'),
    volume: parseInt(v.volume ?? '0', 10),
  })).sort((a, b) => a.time.localeCompare(b.time));

  return {
    symbol: meta.symbol ?? symbol,
    dataPoints,
    metadata: {
      lastRefreshed: values[0]?.datetime ?? new Date().toISOString(),
      outputSize: 'full',
      timeZone: meta.exchange_timezone ?? 'America/New_York',
    },
  };
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured in .env.local');

  checkRateLimit('twelve_data');

  const url = new URL(`${BASE_URL}/quote`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg = (json as { message?: string }).message ?? res.statusText;
    throw new Error(`Twelve Data API error: ${res.status} ${msg}`);
  }

  const json = await res.json();
  recordApiCall('twelve_data', 'quote', symbol);

  if ((json as { status?: string }).status === 'error') {
    throw new Error(
      `Twelve Data: ${(json as { message?: string }).message ?? 'Unknown error'}`
    );
  }

  const q = json as {
    symbol?: string;
    name?: string;
    close?: string;
    open?: string;
    high?: string;
    low?: string;
    volume?: string;
    previous_close?: string;
    change?: string;
    percent_change?: string;
    datetime?: string;
    fifty_two_week?: { high?: string; low?: string };
  };

  const close = parseFloat(q.close ?? '0');
  const prevClose = parseFloat(q.previous_close ?? q.close ?? '0');
  const change = parseFloat(q.change ?? String(close - prevClose));
  const changePercent = parseFloat(String(q.percent_change ?? (prevClose ? ((close - prevClose) / prevClose) * 100 : 0)));

  const week52 = q.fifty_two_week;
  return {
    symbol: q.symbol ?? symbol,
    name: q.name ?? symbol,
    price: close,
    change,
    changePercent,
    open: parseFloat(q.open ?? '0'),
    high: parseFloat(q.high ?? '0'),
    low: parseFloat(q.low ?? '0'),
    previousClose: prevClose,
    volume: parseInt(q.volume ?? '0', 10),
    week52High: week52?.high ? parseFloat(week52.high) : undefined,
    week52Low: week52?.low ? parseFloat(week52.low) : undefined,
    lastUpdated: (q.datetime ?? new Date().toISOString()).slice(0, 10),
  };
}

export async function searchSymbol(query: string): Promise<SearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured in .env.local');

  checkRateLimit('twelve_data');

  const url = new URL(`${BASE_URL}/symbol_search`);
  url.searchParams.set('symbol', query);
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg = (json as { message?: string }).message ?? res.statusText;
    throw new Error(`Twelve Data API error: ${res.status} ${msg}`);
  }

  const json = await res.json();
  recordApiCall('twelve_data', 'symbol_search', query);

  const data = (json as { data?: Array<Record<string, string>> }).data ?? [];
  return data.slice(0, 10).map((r) => ({
    symbol: r.symbol ?? '',
    name: r.instrument_name ?? r.name ?? r.symbol ?? '',
    type: r.instrument_type ?? 'Equity',
    region: r.country ?? '',
    currency: r.currency ?? '',
  })).filter((r) => r.symbol);
}
