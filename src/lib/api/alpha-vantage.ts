import {
  avDailyResponseSchema,
  avIntradayResponseSchema,
  avWeeklyResponseSchema,
  avGlobalQuoteResponseSchema,
  avSearchResponseSchema,
} from '@/lib/types/api';
import type { OHLCDataPoint, StockQuote, TimeSeriesData, SearchResult } from '@/lib/types/stock';
import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://www.alphavantage.co/query';

function getApiKey(): string {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key || key === 'your_alpha_vantage_key_here') {
    throw new Error('ALPHA_VANTAGE_API_KEY is not configured in .env.local');
  }
  return key;
}

async function fetchAV(params: Record<string, string>): Promise<unknown> {
  const apiKey = getApiKey();
  const url = new URL(BASE_URL);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Alpha Vantage API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // Alpha Vantage returns errors as 200 with Note, Error Message, or Information field
  if (json['Note']) {
    throw new Error(`Alpha Vantage rate limit: ${json['Note']}`);
  }
  if (json['Error Message']) {
    throw new Error(`Alpha Vantage error: ${json['Error Message']}`);
  }
  if (json['Information']) {
    throw new Error(`Alpha Vantage: ${json['Information']}`);
  }

  return json;
}

export async function getDailyTimeSeries(
  symbol: string,
  outputSize: 'compact' | 'full' = 'compact'
): Promise<TimeSeriesData> {
  checkRateLimit('alpha_vantage');

  const raw = await fetchAV({
    function: 'TIME_SERIES_DAILY',
    symbol,
    outputsize: outputSize,
  });

  recordApiCall('alpha_vantage', 'TIME_SERIES_DAILY', symbol);

  const parsed = avDailyResponseSchema.parse(raw);
  const meta = parsed['Meta Data'];
  const timeSeries = parsed['Time Series (Daily)'];

  const dataPoints: OHLCDataPoint[] = Object.entries(timeSeries)
    .map(([date, values]) => ({
      time: date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return {
    symbol: meta['2. Symbol'],
    dataPoints,
    metadata: {
      lastRefreshed: meta['3. Last Refreshed'],
      outputSize: outputSize,
      timeZone: meta['5. Time Zone'],
    },
  };
}

/** Intraday 60min bars, compact output (~last 100 points) */
export async function getIntradayTimeSeries(symbol: string): Promise<TimeSeriesData> {
  checkRateLimit('alpha_vantage');

  const raw = await fetchAV({
    function: 'TIME_SERIES_INTRADAY',
    symbol,
    interval: '60min',
    outputsize: 'compact',
    adjusted: 'true',
    extended_hours: 'false',
  });

  recordApiCall('alpha_vantage', 'TIME_SERIES_INTRADAY', symbol);

  const parsed = avIntradayResponseSchema.parse(raw);
  const meta = parsed['Meta Data'];
  const timeSeries = parsed['Time Series (60min)'];

  const dataPoints: OHLCDataPoint[] = Object.entries(timeSeries)
    .map(([dateTime, values]) => ({
      // Keep as string here; chart layer converts intraday strings to UTC timestamps.
      time: dateTime, // YYYY-MM-DD HH:mm:ss
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  const latestDay = meta['3. Last Refreshed'].slice(0, 10);
  const latestDayPoints = dataPoints.filter((d) => d.time.startsWith(latestDay));

  return {
    symbol: meta['2. Symbol'],
    dataPoints: latestDayPoints,
    metadata: {
      lastRefreshed: meta['3. Last Refreshed'],
      outputSize: 'compact',
      timeZone: meta['6. Time Zone'],
    },
  };
}

/** Weekly data - full history on free tier (no outputsize restriction) */
export async function getWeeklyTimeSeries(symbol: string): Promise<TimeSeriesData> {
  checkRateLimit('alpha_vantage');

  const raw = await fetchAV({
    function: 'TIME_SERIES_WEEKLY',
    symbol,
  });

  recordApiCall('alpha_vantage', 'TIME_SERIES_WEEKLY', symbol);

  const parsed = avWeeklyResponseSchema.parse(raw);
  const meta = parsed['Meta Data'];
  const timeSeries = parsed['Weekly Time Series'];

  const dataPoints: OHLCDataPoint[] = Object.entries(timeSeries)
    .map(([date, values]) => ({
      time: date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return {
    symbol: meta['2. Symbol'],
    dataPoints,
    metadata: {
      lastRefreshed: meta['3. Last Refreshed'],
      outputSize: 'full',
      timeZone: meta['4. Time Zone'],
    },
  };
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  checkRateLimit('alpha_vantage');

  const raw = await fetchAV({
    function: 'GLOBAL_QUOTE',
    symbol,
  });

  recordApiCall('alpha_vantage', 'GLOBAL_QUOTE', symbol);

  const parsed = avGlobalQuoteResponseSchema.parse(raw);
  const q = parsed['Global Quote'];

  return {
    symbol: q['01. symbol'],
    name: symbol, // GLOBAL_QUOTE doesn't return company name; search does
    price: parseFloat(q['05. price']),
    change: parseFloat(q['09. change']),
    changePercent: parseFloat(q['10. change percent'].replace('%', '')),
    open: parseFloat(q['02. open']),
    high: parseFloat(q['03. high']),
    low: parseFloat(q['04. low']),
    previousClose: parseFloat(q['08. previous close']),
    volume: parseInt(q['06. volume'], 10),
    lastUpdated: q['07. latest trading day'],
  };
}

export async function searchSymbol(query: string): Promise<SearchResult[]> {
  checkRateLimit('alpha_vantage');

  const raw = await fetchAV({
    function: 'SYMBOL_SEARCH',
    keywords: query,
  });

  recordApiCall('alpha_vantage', 'SYMBOL_SEARCH', query);

  const parsed = avSearchResponseSchema.parse(raw);

  return parsed.bestMatches.map((match) => ({
    symbol: match['1. symbol'],
    name: match['2. name'],
    type: match['3. type'],
    region: match['4. region'],
    currency: match['8. currency'],
  }));
}
