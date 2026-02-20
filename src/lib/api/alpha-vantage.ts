import {
  avDailyAdjustedResponseSchema,
  avIntradayResponseSchema,
  avWeeklyAdjustedResponseSchema,
  avGlobalQuoteResponseSchema,
  avSearchResponseSchema,
} from '@/lib/types/api';
import type { OHLCDataPoint, StockQuote, TimeSeriesData, SearchResult } from '@/lib/types/stock';
import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://www.alphavantage.co/query';

/** Alpha Vantage free tier: 1 request per second. Throttle to avoid per-second limits. */
const MIN_INTERVAL_MS = 1100;
let lastAvCallTime = 0;

async function throttleAvCalls(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastAvCallTime;
  if (elapsed < MIN_INTERVAL_MS && lastAvCallTime > 0) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastAvCallTime = Date.now();
}

function getApiKey(): string {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key || key === 'your_alpha_vantage_key_here') {
    throw new Error('ALPHA_VANTAGE_API_KEY is not configured in .env.local');
  }
  return key;
}

async function fetchAV(params: Record<string, string>): Promise<unknown> {
  await throttleAvCalls();
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
    function: 'TIME_SERIES_DAILY_ADJUSTED',
    symbol,
    outputsize: outputSize,
  });

  recordApiCall('alpha_vantage', 'TIME_SERIES_DAILY_ADJUSTED', symbol);

  const parsed = avDailyAdjustedResponseSchema.parse(raw);
  const meta = parsed['Meta Data'];
  const timeSeries = parsed['Time Series (Daily)'];

  const dataPoints: OHLCDataPoint[] = Object.entries(timeSeries)
    .map(([date, values]) => {
      const close = parseFloat(values['4. close']);
      const adjClose = parseFloat(values['5. adjusted close']);
      const factor = close > 0 ? adjClose / close : 1;
      return {
        time: date,
        open: parseFloat(values['1. open']) * factor,
        high: parseFloat(values['2. high']) * factor,
        low: parseFloat(values['3. low']) * factor,
        close: adjClose,
        volume: parseInt(values['6. volume'], 10),
      };
    })
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

/** Weekly data - full history, split/dividend adjusted */
export async function getWeeklyTimeSeries(symbol: string): Promise<TimeSeriesData> {
  checkRateLimit('alpha_vantage');

  const raw = await fetchAV({
    function: 'TIME_SERIES_WEEKLY_ADJUSTED',
    symbol,
  });

  recordApiCall('alpha_vantage', 'TIME_SERIES_WEEKLY_ADJUSTED', symbol);

  const parsed = avWeeklyAdjustedResponseSchema.parse(raw);
  const meta = parsed['Meta Data'];
  const timeSeries = parsed['Weekly Adjusted Time Series'];

  const dataPoints: OHLCDataPoint[] = Object.entries(timeSeries)
    .map(([date, values]) => {
      const close = parseFloat(values['4. close']);
      const adjClose = parseFloat(values['5. adjusted close']);
      const factor = close > 0 ? adjClose / close : 1;
      return {
        time: date,
        open: parseFloat(values['1. open']) * factor,
        high: parseFloat(values['2. high']) * factor,
        low: parseFloat(values['3. low']) * factor,
        close: adjClose,
        volume: parseInt(values['6. volume'], 10),
      };
    })
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

export interface AnalystConsensus {
  targetPrice: number | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export async function getAnalystConsensus(
  symbol: string
): Promise<AnalystConsensus | null> {
  checkRateLimit('alpha_vantage');

  const raw = (await fetchAV({ function: 'OVERVIEW', symbol })) as Record<string, string>;
  recordApiCall('alpha_vantage', 'OVERVIEW', symbol);

  const targetStr = raw['AnalystTargetPrice'];
  const targetPrice = targetStr ? parseFloat(targetStr) : null;

  return {
    targetPrice: targetPrice && targetPrice > 0 ? targetPrice : null,
    strongBuy: parseInt(raw['AnalystRatingStrongBuy'] ?? '0', 10) || 0,
    buy: parseInt(raw['AnalystRatingBuy'] ?? '0', 10) || 0,
    hold: parseInt(raw['AnalystRatingHold'] ?? '0', 10) || 0,
    sell: parseInt(raw['AnalystRatingSell'] ?? '0', 10) || 0,
    strongSell: parseInt(raw['AnalystRatingStrongSell'] ?? '0', 10) || 0,
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
