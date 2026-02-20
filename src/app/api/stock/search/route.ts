import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '@/lib/db/cache';
import { searchSymbol } from '@/lib/api/yahoo-finance';
import { searchSymbol as searchTwelveData } from '@/lib/api/twelve-data';
import { RateLimitError } from '@/lib/api/api-queue';

// When results are empty and query looks like a ticker, add it as a fallback option.
const TICKER_PATTERN = /^[A-Za-z]{2,5}$/;

function withTickerFallback(data: { symbol: string; name: string; type: string; region: string; currency: string }[], query: string) {
  if (data.length > 0) return data;
  const upper = query.trim().toUpperCase();
  if (!TICKER_PATTERN.test(upper)) return data;
  return [{ symbol: upper, name: upper, type: 'Equity', region: 'United States', currency: 'USD' }];
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');

  if (!query || query.length < 1) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  const searchWithFallbacks = async () => {
    try {
      const results = await searchSymbol(query);
      if (results.length > 0) return results;
    } catch {
      // Try Twelve Data below
    }
    return await searchTwelveData(query);
  };
  try {
    const data = await cacheManager.getOrFetch(
      'news_cache', // reuse news_cache table for search results
      `search:${query.toUpperCase()}`,
      86400, // Cache search results for 24 hours
      searchWithFallbacks,
      query
    );

    const withFallback = withTickerFallback(data, query);
    return NextResponse.json({ data: withFallback });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const cached = cacheManager.getCached<{ symbol: string; name: string; type: string; region: string; currency: string }[]>('news_cache', `search:${query.toUpperCase()}`);
      const data = withTickerFallback(cached || [], query);
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
