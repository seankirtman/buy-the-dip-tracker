export interface StockEvent {
  id: string;
  symbol: string;
  date: string; // YYYY-MM-DD
  type: EventType;
  title: string;
  description: string;
  impact: EventImpact;
  priceAtEvent: number;
  priceNow: number;
  changeSinceEvent: number;
  changePercentSinceEvent: number;
  dailyReturn: number;
  sp500Return: number;
  relativeReturn: number;
  zScore: number;
  newsArticles: NewsArticle[];
  recoveryDays: number | null;
  impactScore: number;
}

export type EventType =
  | 'earnings'
  | 'guidance'
  | 'analyst_rating'
  | 'product_launch'
  | 'regulatory'
  | 'macro'
  | 'management'
  | 'sector_move'
  | 'unknown';

export interface EventImpact {
  magnitude: 'extreme' | 'high' | 'moderate';
  direction: 'positive' | 'negative';
  absoluteMove: number;
  percentMove: number;
  volumeSpike: number;
}

export interface NewsArticle {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}
