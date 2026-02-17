import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '@/lib/db/cache';
import { getQuote } from '@/lib/api/finnhub';
import { RateLimitError } from '@/lib/api/api-queue';
import { isMarketHours } from '@/lib/utils/date';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();
  const ttl = isMarketHours() ? 300 : 3600; // 5 min during market hours, 1 hr after

  try {
    const data = await cacheManager.getOrFetch(
      'quote_cache',
      upperSymbol,
      ttl,
      () => getQuote(upperSymbol)
    );

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const cached = cacheManager.getCached('quote_cache', upperSymbol);
      if (cached) {
        return NextResponse.json({ data: cached, stale: true, error: error.message });
      }
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch quote' },
      { status: 500 }
    );
  }
}
