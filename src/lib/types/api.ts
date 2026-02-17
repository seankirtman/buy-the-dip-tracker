import { z } from 'zod';

// Alpha Vantage TIME_SERIES_DAILY response
export const avDailyPointSchema = z.object({
  '1. open': z.string(),
  '2. high': z.string(),
  '3. low': z.string(),
  '4. close': z.string(),
  '5. volume': z.string(),
});

export const avDailyMetadataSchema = z.object({
  '1. Information': z.string(),
  '2. Symbol': z.string(),
  '3. Last Refreshed': z.string(),
  '4. Output Size': z.string(),
  '5. Time Zone': z.string(),
});

export const avDailyResponseSchema = z.object({
  'Meta Data': avDailyMetadataSchema,
  'Time Series (Daily)': z.record(z.string(), avDailyPointSchema),
});

// Alpha Vantage TIME_SERIES_INTRADAY response (e.g., 60min interval)
export const avIntradayMetadataSchema = z.object({
  '1. Information': z.string(),
  '2. Symbol': z.string(),
  '3. Last Refreshed': z.string(),
  '4. Interval': z.string(),
  '5. Output Size': z.string(),
  '6. Time Zone': z.string(),
});

export const avIntradayResponseSchema = z.object({
  'Meta Data': avIntradayMetadataSchema,
  'Time Series (60min)': z.record(z.string(), avDailyPointSchema),
});

// Alpha Vantage TIME_SERIES_WEEKLY response (full history on free tier)
export const avWeeklyMetadataSchema = z.object({
  '1. Information': z.string(),
  '2. Symbol': z.string(),
  '3. Last Refreshed': z.string(),
  '4. Time Zone': z.string(),
});

export const avWeeklyResponseSchema = z.object({
  'Meta Data': avWeeklyMetadataSchema,
  'Weekly Time Series': z.record(z.string(), avDailyPointSchema),
});

// Alpha Vantage GLOBAL_QUOTE response
export const avQuoteSchema = z.object({
  '01. symbol': z.string(),
  '02. open': z.string(),
  '03. high': z.string(),
  '04. low': z.string(),
  '05. price': z.string(),
  '06. volume': z.string(),
  '07. latest trading day': z.string(),
  '08. previous close': z.string(),
  '09. change': z.string(),
  '10. change percent': z.string(),
});

export const avGlobalQuoteResponseSchema = z.object({
  'Global Quote': avQuoteSchema,
});

// Alpha Vantage SYMBOL_SEARCH response
export const avSearchMatchSchema = z.object({
  '1. symbol': z.string(),
  '2. name': z.string(),
  '3. type': z.string(),
  '4. region': z.string(),
  '8. currency': z.string(),
});

export const avSearchResponseSchema = z.object({
  bestMatches: z.array(avSearchMatchSchema),
});

// Finnhub quote response (nullable when market closed)
export const finnhubQuoteSchema = z.object({
  c: z.union([z.number(), z.null()]), // current price
  d: z.union([z.number(), z.null()]).optional(), // change
  dp: z.union([z.number(), z.null()]).optional(), // change percent
  h: z.union([z.number(), z.null()]), // high
  l: z.union([z.number(), z.null()]), // low
  o: z.union([z.number(), z.null()]), // open
  pc: z.union([z.number(), z.null()]), // previous close
  t: z.union([z.number(), z.null()]).optional(), // timestamp
  v: z.union([z.number(), z.null()]).optional(), // volume
});

// Finnhub symbol search response
export const finnhubSearchResultSchema = z.object({
  description: z.string().optional(),
  displaySymbol: z.string().optional(),
  symbol: z.string(),
  type: z.string().optional(),
});

export const finnhubSearchResponseSchema = z.object({
  count: z.number(),
  result: z.array(finnhubSearchResultSchema),
});

// Finnhub stock candle response
export const finnhubCandleSchema = z.object({
  c: z.array(z.number()), // close prices
  h: z.array(z.number()), // high prices
  l: z.array(z.number()), // low prices
  o: z.array(z.number()), // open prices
  s: z.string(), // status ("ok" or "no_data")
  t: z.array(z.number()), // unix timestamps
  v: z.array(z.number()), // volume
});

// Finnhub company news response
export const finnhubNewsSchema = z.object({
  category: z.string(),
  datetime: z.number(),
  headline: z.string(),
  id: z.number(),
  image: z.string(),
  related: z.string(),
  source: z.string(),
  summary: z.string(),
  url: z.string(),
});

export const finnhubNewsArraySchema = z.array(finnhubNewsSchema);

// Finnhub company profile (profile2) - market cap in millions
export const finnhubCompanyProfileSchema = z.object({
  marketCapitalization: z.union([z.number(), z.null()]).optional(),
  name: z.string().optional(),
  ticker: z.string().optional(),
  weburl: z.string().optional(),
  finnhubIndustry: z.string().optional(),
});

export type AVDailyResponse = z.infer<typeof avDailyResponseSchema>;
export type AVGlobalQuoteResponse = z.infer<typeof avGlobalQuoteResponseSchema>;
export type AVSearchResponse = z.infer<typeof avSearchResponseSchema>;
export type FinnhubNewsItem = z.infer<typeof finnhubNewsSchema>;
