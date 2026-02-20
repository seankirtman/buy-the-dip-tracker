import type { NewsArticle, EventType } from '@/lib/types/event';
import type { PriceAnomaly } from './detector';
import { getCompanyNews } from '@/lib/api/yahoo-finance';
import { cacheManager } from '@/lib/db/cache';
import { format, subDays, addDays } from 'date-fns';

// Keyword dictionaries for event type classification
const EVENT_KEYWORDS: Record<EventType, string[]> = {
  earnings: [
    'earnings', 'EPS', 'revenue', 'quarterly', 'beat', 'miss', 'guidance',
    'profit', 'loss', 'income', 'q1', 'q2', 'q3', 'q4', 'fiscal',
  ],
  guidance: [
    'guidance', 'forecast', 'outlook', 'raised', 'lowered', 'expects',
    'projection', 'estimate', 'revised',
  ],
  analyst_rating: [
    'upgrade', 'downgrade', 'price target', 'rating', 'buy', 'sell', 'hold',
    'overweight', 'underweight', 'neutral', 'outperform', 'analyst',
  ],
  product_launch: [
    'launch', 'announce', 'release', 'unveil', 'FDA', 'approval', 'patent',
    'product', 'new feature', 'innovation',
  ],
  regulatory: [
    'SEC', 'lawsuit', 'fine', 'investigation', 'antitrust', 'regulation',
    'compliance', 'settlement', 'probe', 'subpoena',
  ],
  macro: [
    'fed', 'interest rate', 'inflation', 'recession', 'tariff', 'trade war',
    'sanctions', 'economic', 'GDP',
  ],
  management: [
    'CEO', 'CFO', 'COO', 'resign', 'appoint', 'hire', 'fired', 'board',
    'executive', 'leadership', 'management',
    'stock split', 'split', 'spin-off', 'spin off', 'corporate action',
  ],
  sector_move: [
    'sector', 'industry', 'peers', 'competitor', 'market share',
    'SaaS', 'software', 'cloud', 'AI', 'artificial intelligence',
    'sentiment', 'digital transformation', 'enterprise software',
  ],
  unknown: [],
};

export interface CorrelatedAnomaly {
  anomaly: PriceAnomaly;
  eventType: EventType;
  title: string;
  description: string;
  newsArticles: NewsArticle[];
  newsRelevance: number; // 0-1 score
}

/**
 * For each price anomaly, fetch related news and classify the event type.
 */
export async function correlateNews(
  symbol: string,
  anomalies: PriceAnomaly[],
  companyName?: string
): Promise<CorrelatedAnomaly[]> {
  const results: CorrelatedAnomaly[] = [];
  const mentionTerms = buildMentionTerms(symbol, companyName);

  for (const anomaly of anomalies) {
    const date = new Date(anomaly.date);
    const sameDay = format(date, 'yyyy-MM-dd');
    const from = format(subDays(date, 1), 'yyyy-MM-dd');
    const to = format(addDays(date, 1), 'yyyy-MM-dd');

    const cacheKey = `${symbol}:${sameDay}:${from}:${to}`;

    let articles: NewsArticle[];
    try {
      articles = await cacheManager.getOrFetch<NewsArticle[]>(
        'news_cache',
        cacheKey,
        7200, // 2 hour TTL
        () => getCompanyNews(symbol, from, to),
        symbol
      );
    } catch {
      articles = [];
    }

    // Prefer same-day articles that explicitly mention the company.
    const sameDayMentioned = articles
      .filter((article) => article.publishedAt.slice(0, 10) === sameDay)
      .filter((article) => mentionsCompany(article, mentionTerms))
      .sort((a, b) => scoreArticlePopularity(b) - scoreArticlePopularity(a));

    const contextArticles = sameDayMentioned.length > 0
      ? sameDayMentioned
      : articles
          .filter((article) => mentionsCompany(article, mentionTerms))
          .sort((a, b) => scoreArticlePopularity(b) - scoreArticlePopularity(a));

    // Classify event type from news headlines
    const { eventType, bestHeadline, relevance } = classifyEvent(contextArticles);

    // Generate title and description
    const direction = anomaly.relativeReturn >= 0 ? 'rises' : 'drops';
    const pctMove = Math.abs(anomaly.stockReturn * 100).toFixed(1);
    const timeLabel = anomaly.timeframe === 'weekly' ? `week of ${anomaly.date}` : anomaly.date;

    let title: string;
    let description: string;

    const topHeadline = contextArticles[0]?.headline ?? bestHeadline;

    // Prefer the top matched article headline as the event title when available.
    if (topHeadline) {
      title = truncate(topHeadline, 80);
      description = generateDescription(
        symbol,
        anomaly,
        eventType,
        contextArticles.slice(0, 3)
      );
    } else {
      title = `${symbol} ${direction} ${pctMove}% in ${anomaly.timeframe === 'weekly' ? 'a week' : 'a day'} on ${anomaly.volumeSpike > 2 ? 'heavy' : 'notable'} volume`;
      description = `${symbol} saw an unusual ${direction === 'rises' ? 'gain' : 'decline'} of ${pctMove}% in the ${anomaly.timeframe === 'weekly' ? 'week' : 'day'} ending ${timeLabel}, outpacing the S&P 500 by ${Math.abs(anomaly.relativeReturn * 100).toFixed(1)} percentage points.`;
    }

    results.push({
      anomaly,
      eventType: relevance > 0.2 ? eventType : 'unknown',
      title,
      description,
      newsArticles: contextArticles.slice(0, 5),
      newsRelevance: relevance,
    });
  }

  return results;
}

function classifyEvent(articles: NewsArticle[]): {
  eventType: EventType;
  bestHeadline: string | null;
  relevance: number;
} {
  if (articles.length === 0) {
    return { eventType: 'unknown', bestHeadline: null, relevance: 0 };
  }

  const typeCounts: Record<EventType, number> = {} as Record<EventType, number>;
  let bestHeadline: string | null = null;
  let bestScore = 0;

  for (const article of articles) {
    const text = `${article.headline} ${article.summary}`.toLowerCase();

    for (const [type, keywords] of Object.entries(EVENT_KEYWORDS)) {
      if (type === 'unknown') continue;
      let score = 0;
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score++;
        }
      }
      if (score > 0) {
        typeCounts[type as EventType] = (typeCounts[type as EventType] || 0) + score;
      }
      if (score > bestScore) {
        bestScore = score;
        bestHeadline = article.headline;
      }
    }
  }

  // Find the type with the highest count
  let maxType: EventType = 'unknown';
  let maxCount = 0;
  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxType = type as EventType;
    }
  }

  // Relevance: how many keyword matches found, normalized
  const totalKeywords = Object.values(EVENT_KEYWORDS).flat().length;
  const relevance = Math.min(maxCount / 5, 1); // Cap at 1.0

  return { eventType: maxType, bestHeadline, relevance };
}

function generateDescription(
  symbol: string,
  anomaly: PriceAnomaly,
  eventType: EventType,
  topArticles: NewsArticle[]
): string {
  const direction = anomaly.relativeReturn >= 0 ? 'gained' : 'lost';
  const pctMove = Math.abs(anomaly.stockReturn * 100).toFixed(1);
  const relMove = Math.abs(anomaly.relativeReturn * 100).toFixed(1);
  const isWeekly = anomaly.timeframe === 'weekly';
  const outUnder = anomaly.relativeReturn >= 0 ? 'outperforming' : 'underperforming';

  const timePhrase = isWeekly
    ? `over the week ending ${anomaly.date}`
    : `on ${anomaly.date}`;
  let desc = `${symbol} ${direction} ${pctMove}% ${timePhrase}`;
  desc += `, ${outUnder} the S&P 500 by ${relMove} percentage points.`;

  if (anomaly.volumeSpike > 2) {
    desc += ` Trading volume was ${anomaly.volumeSpike.toFixed(1)}x the 20-day average.`;
  }

  const dateContext = isWeekly ? 'this week' : 'this date';
  if (topArticles.length > 0) {
    desc += ` Key headlines around ${dateContext}: "${truncate(topArticles[0].headline, 100)}"`;
    if (topArticles.length > 1) {
      desc += ` and "${truncate(topArticles[1].headline, 80)}"`;
    }
    desc += '.';
  }

  return desc;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function buildMentionTerms(symbol: string, companyName?: string): string[] {
  const terms = new Set<string>([symbol.toLowerCase()]);
  const cleanedName = (companyName || '').toLowerCase().trim();
  if (cleanedName) {
    terms.add(cleanedName);
    for (const token of cleanedName.split(/\s+/)) {
      if (token.length >= 4) terms.add(token);
    }
  }
  return [...terms];
}

function mentionsCompany(article: NewsArticle, mentionTerms: string[]): boolean {
  const text = `${article.headline} ${article.summary}`.toLowerCase();
  return mentionTerms.some((term) => text.includes(term));
}

// Finnhub company-news doesn't include a popularity field, so proxy with source + recency.
function scoreArticlePopularity(article: NewsArticle): number {
  const sourceBoost: Record<string, number> = {
    reuters: 1.0,
    bloomberg: 0.95,
    cnbc: 0.9,
    wsj: 0.9,
    'wall street journal': 0.9,
    'financial times': 0.9,
    fortune: 0.8,
    cnn: 0.75,
    marketwatch: 0.7,
  };

  const sourceKey = article.source.toLowerCase();
  const sourceScore = sourceBoost[sourceKey] ?? 0.6;
  const publishedMs = Date.parse(article.publishedAt);
  const ageHours = Number.isFinite(publishedMs) ? Math.max(0, (Date.now() - publishedMs) / 36e5) : 24;
  const recencyScore = Math.max(0, 1 - ageHours / 48);
  return sourceScore * 0.7 + recencyScore * 0.3;
}
