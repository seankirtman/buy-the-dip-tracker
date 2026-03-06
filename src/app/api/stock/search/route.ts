import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '@/lib/db/cache';
import { searchSymbol as searchFinnhub } from '@/lib/api/finnhub';
import { searchSymbol as searchAlphaVantage } from '@/lib/api/alpha-vantage';
import { searchSymbol as searchTwelveData } from '@/lib/api/twelve-data';
import { RateLimitError } from '@/lib/api/api-queue';

// Alpha Vantage SYMBOL_SEARCH sometimes returns empty for valid tickers (e.g. CRM).
// When results are empty and query looks like a ticker, add it as a fallback option.
const TICKER_PATTERN = /^[A-Za-z]{2,5}$/;
type SearchResult = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
};

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getSearchResultScore(result: SearchResult, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const normalizedSymbol = normalizeSearchText(result.symbol);
  const normalizedName = normalizeSearchText(result.name);
  const compactSymbol = normalizedSymbol.replace(/\s+/g, '');
  const compactName = normalizedName.replace(/\s+/g, '');
  const nameWords = normalizedName.split(' ').filter(Boolean);

  let score = 0;

  if (compactSymbol === compactQuery) score += 1000;
  if (compactName === compactQuery) score += 950;
  if (normalizedName.startsWith(normalizedQuery)) score += 900;
  if (normalizedSymbol.startsWith(normalizedQuery)) score += 850;
  if (nameWords.some((word) => word.startsWith(normalizedQuery))) score += 800;
  if (compactName.startsWith(compactQuery)) score += 700;
  if (compactSymbol.includes(compactQuery)) score += 300;
  if (compactName.includes(compactQuery)) score += 250;

  // Tie-breaker: prefer shorter names/symbols when relevance is equal.
  // Use small divisors so these never dominate the main relevance scores (smallest gap ~50).
  score -= Math.max(compactName.length - compactQuery.length, 0) / 10;
  score -= Math.max(compactSymbol.length - compactQuery.length, 0) / 100;

  return score;
}

function rankSearchResults(results: SearchResult[], query: string): SearchResult[] {
  const deduped = results.filter(
    (result, index, allResults) =>
      allResults.findIndex((candidate) => candidate.symbol === result.symbol) === index
  );

  return deduped.sort((a, b) => {
    const scoreDiff = getSearchResultScore(b, query) - getSearchResultScore(a, query);
    if (scoreDiff !== 0) return scoreDiff;
    return a.symbol.localeCompare(b.symbol);
  });
}

function withTickerFallback(data: SearchResult[], query: string) {
  if (data.length > 0) return data;
  const upper = query.trim().toUpperCase();
  if (!TICKER_PATTERN.test(upper)) return data;
  return [{ symbol: upper, name: upper, type: 'Equity', region: 'United States', currency: 'USD' }];
}

async function searchWithFallbackProviders(query: string) {
  try {
    const finnhubResults = await searchFinnhub(query);
    if (finnhubResults.length > 0) return finnhubResults;
  } catch {
    // Try Alpha Vantage below.
  }

  try {
    const alphaResults = await searchAlphaVantage(query);
    if (alphaResults.length > 0) return alphaResults;
  } catch {
    // Try Twelve Data below.
  }

  try {
    const twelveDataResults = await searchTwelveData(query);
    if (twelveDataResults.length > 0) return twelveDataResults;
  } catch {
    // If all providers fail, return empty.
  }

  return [];
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');

  if (!query || query.length < 1) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    const data = await cacheManager.getOrFetch(
      'news_cache', // reuse news_cache table for search results
      `search:${query.toUpperCase()}`,
      86400, // Cache search results for 24 hours
      () => searchWithFallbackProviders(query),
      query
    );

    const rankedResults = rankSearchResults(withTickerFallback(data, query), query);
    return NextResponse.json({ data: rankedResults });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const cached = cacheManager.getCached<SearchResult[]>('news_cache', `search:${query.toUpperCase()}`);
      const data = rankSearchResults(withTickerFallback(cached || [], query), query);
      return NextResponse.json(
        { data, stale: true, error: error.message },
        { status: cached ? 200 : 429 }
      );
    }
    // Keep search usable even if provider auth/config fails in deployment.
    const data = withTickerFallback([], query);
    if (data.length > 0) {
      return NextResponse.json(
        {
          data,
          stale: true,
          error: error instanceof Error ? error.message : 'Provider search unavailable',
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search symbols' },
      { status: 500 }
    );
  }
}
