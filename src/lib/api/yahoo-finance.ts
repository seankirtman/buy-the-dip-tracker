/**
 * Yahoo Finance unofficial chart/quote API.
 * Uses query1.finance.yahoo.com and query2.finance.yahoo.com endpoints.
 * No API key required. For testing only.
 */
import type { NewsArticle } from '@/lib/types/event';
import type { OHLCDataPoint, StockQuote, TimeSeriesData, SearchResult } from '@/lib/types/stock';
import { checkRateLimit, recordApiCall } from './api-queue';

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEARCH_BASE = 'https://query2.finance.yahoo.com/v1/finance/search';
const QUOTE_SUMMARY_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

// User-Agent helps avoid blocks when fetching from server
const FETCH_OPTIONS: RequestInit = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; FinanceTracker/1.0; +https://github.com)',
  },
};

interface YahooChartResult {
  meta?: {
    symbol?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    regularMarketTime?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string };
  };
}

function parseChartResponse(
  json: YahooChartResponse,
  symbol: string
): TimeSeriesData {
  const result = json.chart?.result?.[0];
  if (!result) {
    const err = json.chart?.error;
    throw new Error(
      err?.description ?? `Yahoo Finance: No chart data for ${symbol}`
    );
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const opens = quote?.open ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const closes = quote?.close ?? [];
  const volumes = quote?.volume ?? [];

  const dataPoints: OHLCDataPoint[] = timestamps
    .map((ts, i) => {
      const close = closes[i];
      if (close == null || Number.isNaN(close)) return null;
      const date = new Date(ts * 1000);
      const time = date.toISOString().slice(0, 10);
      return {
        time,
        open: Number(opens[i] ?? close) || 0,
        high: Number(highs[i] ?? close) || 0,
        low: Number(lows[i] ?? close) || 0,
        close: Number(close),
        volume: Number(volumes[i] ?? 0) || 0,
      };
    })
    .filter((p): p is OHLCDataPoint => p != null)
    .sort((a, b) => a.time.localeCompare(b.time));

  const lastTs = timestamps[timestamps.length - 1];
  const lastRefreshed =
    lastTs != null
      ? new Date(lastTs * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  return {
    symbol: result.meta?.symbol ?? symbol,
    dataPoints,
    metadata: {
      lastRefreshed,
      outputSize: dataPoints.length > 100 ? 'full' : 'compact',
      timeZone: 'America/New_York',
    },
  };
}

export async function getDailyTimeSeries(
  symbol: string,
  _daysBack = 365
): Promise<TimeSeriesData> {
  checkRateLimit('yahoo_finance');

  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1d');
  url.searchParams.set('range', '1y');

  const res = await fetch(url.toString(), FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error(`Yahoo Finance API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as YahooChartResponse;
  recordApiCall('yahoo_finance', 'chart_daily', symbol);

  return parseChartResponse(json, symbol);
}

export async function getIntradayTimeSeries(symbol: string): Promise<TimeSeriesData> {
  checkRateLimit('yahoo_finance');

  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '5m');
  url.searchParams.set('range', '1d');

  const res = await fetch(url.toString(), FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error(`Yahoo Finance API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as YahooChartResponse;
  recordApiCall('yahoo_finance', 'chart_intraday', symbol);

  return parseChartResponse(json, symbol);
}

export async function getWeeklyTimeSeries(symbol: string): Promise<TimeSeriesData> {
  checkRateLimit('yahoo_finance');

  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1wk');
  url.searchParams.set('range', '5y');

  const res = await fetch(url.toString(), FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error(`Yahoo Finance API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as YahooChartResponse;
  recordApiCall('yahoo_finance', 'chart_weekly', symbol);

  return parseChartResponse(json, symbol);
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  checkRateLimit('yahoo_finance');

  // Use chart endpoint with short range to get latest quote
  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1d');
  url.searchParams.set('range', '5d');

  const res = await fetch(url.toString(), FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error(`Yahoo Finance API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as YahooChartResponse;
  recordApiCall('yahoo_finance', 'quote', symbol);

  const result = json.chart?.result?.[0];
  if (!result) {
    const err = json.chart?.error;
    throw new Error(
      err?.description ?? `Yahoo Finance: No quote data for ${symbol}`
    );
  }

  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice ?? 0;
  const previousClose = meta.chartPreviousClose ?? price;
  const change = price - previousClose;
  const changePercent =
    previousClose !== 0 ? (change / previousClose) * 100 : 0;

  const lastTs = result.timestamp?.[result.timestamp.length - 1];
  const lastUpdated =
    lastTs != null
      ? new Date(lastTs * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  const quote = result.indicators?.quote?.[0];
  const len = (quote?.close?.length ?? 1) - 1;
  const o = quote?.open?.[len];
  const h = quote?.high?.[len];
  const l = quote?.low?.[len];
  const v = quote?.volume?.[len];

  return {
    symbol: meta.symbol ?? symbol,
    name: meta.symbol ?? symbol,
    price,
    change,
    changePercent,
    open: Number(o ?? price) || 0,
    high: Number(h ?? price) || 0,
    low: Number(l ?? price) || 0,
    previousClose,
    volume: Number(v ?? 0) || 0,
    lastUpdated,
  };
}

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
  typeDisp?: string;
}

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

export interface CompanyProfile {
  marketCap: number | null;
  name?: string;
  industry?: string;
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  checkRateLimit('yahoo_finance');

  const url = new URL(`${QUOTE_SUMMARY_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('modules', 'price,summaryProfile,summaryDetail');

  const res = await fetch(url.toString(), FETCH_OPTIONS);
  if (!res.ok) return null;

  const json = (await res.json()) as {
    quoteSummary?: {
      result?: Array<{
        price?: { shortName?: string; longName?: string };
        summaryProfile?: { longName?: string; industry?: string };
        summaryDetail?: { marketCap?: number };
      }>;
    };
  };
  recordApiCall('yahoo_finance', 'quoteSummary', symbol);

  const result = json.quoteSummary?.result?.[0];
  if (!result) return null;

  const marketCap = result.summaryDetail?.marketCap ?? null;
  const name =
    result.price?.longName ??
    result.price?.shortName ??
    result.summaryProfile?.longName;

  return {
    marketCap: marketCap ?? null,
    name: name ?? undefined,
    industry: result.summaryProfile?.industry,
  };
}

/** Yahoo Finance does not expose news via chart API; returns empty for testing. */
export async function getCompanyNews(
  _symbol: string,
  _from: string,
  _to: string
): Promise<NewsArticle[]> {
  return [];
}

export async function searchSymbol(query: string): Promise<SearchResult[]> {
  checkRateLimit('yahoo_finance');

  const url = new URL(SEARCH_BASE);
  url.searchParams.set('q', query);

  const res = await fetch(url.toString(), FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error(`Yahoo Finance API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as YahooSearchResponse;
  recordApiCall('yahoo_finance', 'search', query);

  const quotes = json.quotes ?? [];
  return quotes
    .filter((q) => q.symbol && q.quoteType)
    .map((q) => ({
      symbol: q.symbol ?? '',
      name: q.shortname ?? q.longname ?? q.symbol ?? '',
      type: q.typeDisp ?? q.quoteType ?? 'Equity',
      region: q.exchDisp ?? 'United States',
      currency: 'USD',
    }));
}
