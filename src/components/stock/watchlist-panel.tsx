'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useWatchlist } from '@/hooks/use-watchlist';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import type { StockQuote, SearchResult } from '@/lib/types/stock';

interface WatchlistQuote extends StockQuote {
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;

export function WatchlistPanel() {
  const { symbols, loaded, addSymbol, removeSymbol } = useWatchlist();
  const [quotes, setQuotes] = useState<Record<string, WatchlistQuote>>({});
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const addContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);
  const lastSearchRef = useRef<string | null>(null);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setSearchOpen(false);
      lastSearchRef.current = null;
      return;
    }
    lastSearchRef.current = trimmed;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/stock/search?q=${encodeURIComponent(trimmed)}`);
      const text = await res.text();
      if (!text.trim().startsWith('{')) throw new Error('Invalid response');
      const json = JSON.parse(text);
      const data = json.data;
      if (lastSearchRef.current !== trimmed) return;
      if (Array.isArray(data) && data.length > 0) {
        setSearchResults(data);
        setSearchOpen(true);
        setSelectedIndex(-1);
      } else {
        setSearchResults([]);
        setSearchOpen(false);
      }
    } catch {
      if (lastSearchRef.current === trimmed) {
        setSearchResults([]);
        setSearchOpen(false);
      }
    } finally {
      if (lastSearchRef.current === trimmed) setSearchLoading(false);
    }
  }, []);

  const addFromResult = useCallback(
    (result: SearchResult) => {
      const symbol = result.symbol;
      if (symbols.includes(symbol)) {
        setAddError('Already in watchlist');
        setAddInput('');
        setSearchOpen(false);
        setTimeout(() => setAddError(null), 3000);
        return;
      }
      addSymbol(symbol);
      setAddInput('');
      setSearchResults([]);
      setSearchOpen(false);
      setAddError(null);
      setQuotes((prev) => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
    },
    [symbols, addSymbol]
  );

  useEffect(() => {
    if (!loaded || symbols.length === 0) return;

    // Fetch quotes for all watchlist symbols
    symbols.forEach(async (symbol) => {
      if (quotes[symbol] && !quotes[symbol].error) return; // Already fetched
      try {
        const res = await fetch(`/api/stock/${symbol}/quote`);
        const text = await res.text();
        if (!text.trim().startsWith('{')) {
          throw new Error('Invalid response');
        }
        const json = JSON.parse(text);
        if (json.data) {
          setQuotes((prev) => ({ ...prev, [symbol]: json.data }));
        } else {
          const msg = res.status === 429 ? 'Rate limited' : 'Unable to load';
          setQuotes((prev) => ({ ...prev, [symbol]: { symbol, error: true, errorMessage: msg } as WatchlistQuote }));
        }
      } catch {
        setQuotes((prev) => ({ ...prev, [symbol]: { symbol, error: true, errorMessage: 'Unable to load' } as WatchlistQuote }));
      }
    });
  }, [symbols, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddInputChange = (value: string) => {
    setAddInput(value);
    setAddError(null);
    setSelectedIndex(-1);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setSearchOpen(false);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), DEBOUNCE_MS);
  };

  const handleAddSubmit = () => {
    if (selectedIndex >= 0 && searchResults[selectedIndex]) {
      addFromResult(searchResults[selectedIndex]);
      return;
    }
    if (searchResults.length > 0) {
      addFromResult(searchResults[0]);
      return;
    }
    const trimmed = addInput.trim().toUpperCase();
    if (trimmed) {
      addSymbol(trimmed);
      setAddInput('');
      setSearchOpen(false);
      setQuotes((prev) => {
        const next = { ...prev };
        delete next[trimmed];
        return next;
      });
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (addContainerRef.current && !addContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!loaded) {
    return (
      <div className="animate-pulse">
        <div className="mb-4 h-8 w-48 rounded bg-bg-card" />
        <div className="h-32 rounded-lg bg-bg-card" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">Watchlist</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddSubmit();
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <div ref={addContainerRef} className="relative flex-1 max-w-xs">
            <div className="flex gap-2">
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={addInput}
                onChange={(e) => handleAddInputChange(e.target.value)}
                onKeyDown={handleAddKeyDown}
                onFocus={() =>
                  addInput.trim().length >= MIN_QUERY_LENGTH &&
                  searchResults.length > 0 &&
                  setSearchOpen(true)
                }
                placeholder="Add symbol (e.g., AAPL or Apple)"
                className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => handleAddSubmit()}
                disabled={!addInput.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
            {searchLoading && (
              <div className="absolute right-14 top-1/2 -translate-y-1/2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
              </div>
            )}
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute top-full z-50 mt-1 w-full min-w-[280px] rounded-lg border border-border bg-bg-secondary shadow-xl">
                {searchResults.slice(0, 8).map((result, idx) => (
                  <button
                    key={`${result.symbol}-${result.region}-${idx}`}
                    type="button"
                    onClick={() => addFromResult(result)}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg ${
                      idx === selectedIndex
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <div>
                      <span className="font-medium text-text-primary">{result.symbol}</span>
                      <span className="ml-2 text-text-muted">{result.name}</span>
                    </div>
                    <span className="text-xs text-text-muted">{result.region}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {addError && <p className="text-sm text-negative">{addError}</p>}
        </form>
      </div>

      {symbols.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-card p-8 text-center">
          <p className="text-text-secondary">Your watchlist is empty.</p>
          <p className="mt-1 text-sm text-text-muted">
            Add stock symbols above or search for stocks to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {symbols.map((symbol) => {
            const quote = quotes[symbol];
            return (
              <div
                key={symbol}
                className="group relative rounded-lg border border-border bg-bg-card p-4 transition-colors hover:border-accent/50"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeSymbol(symbol);
                  }}
                  className="absolute right-2 top-2 z-10 rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-negative group-hover:opacity-100 group-hover:pointer-events-auto pointer-events-none"
                  title="Remove from watchlist"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 1l12 12M13 1L1 13" />
                  </svg>
                </button>

                <Link
                  href={`/stock/${symbol}`}
                  className="block cursor-pointer rounded-lg outline-none transition-colors hover:bg-bg-hover/30 focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="mb-2 text-lg font-semibold text-text-primary">{symbol}</div>
                  {quote && !quote.error ? (
                    <>
                      <div className="text-2xl font-bold text-text-primary">
                        {formatCurrency(quote.price)}
                      </div>
                      <div
                        className={`mt-1 text-sm font-medium ${
                          quote.changePercent >= 0 ? 'text-positive' : 'text-negative'
                        }`}
                      >
                        {formatPercent(quote.changePercent)}
                      </div>
                    </>
                  ) : quote?.error ? (
                    <div className="text-sm text-text-muted">
                      {quote.errorMessage || 'Unable to load'}
                      <span className="ml-1 text-accent">→ View</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="h-7 w-24 animate-pulse rounded bg-bg-hover" />
                      <div className="h-4 w-16 animate-pulse rounded bg-bg-hover" />
                    </div>
                  )}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
