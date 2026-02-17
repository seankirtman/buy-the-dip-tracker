export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  marketCap?: number;
  peRatio?: number;
  week52High?: number;
  week52Low?: number;
  lastUpdated: string;
}

export interface OHLCDataPoint {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeSeriesData {
  symbol: string;
  dataPoints: OHLCDataPoint[];
  metadata: {
    lastRefreshed: string;
    outputSize: 'compact' | 'full';
    timeZone: string;
  };
}

export interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

export type TimePeriod = '1D' | '7D' | '1M' | '6M' | 'YTD' | '1Y';
export type ViewMode = 'standard' | 'event';
