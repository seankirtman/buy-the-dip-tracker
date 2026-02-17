'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchResult } from '@/lib/types/stock';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);
  const lastSearchRef = useRef<string | null>(null);
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsOpen(false);
      lastSearchRef.current = null;
      return;
    }

    lastSearchRef.current = trimmed;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/stock/search?q=${encodeURIComponent(trimmed)}`);
      const text = await res.text();
      if (!text.trim().startsWith('{')) {
        throw new Error('Invalid response');
      }
      const json = JSON.parse(text);
      const data = json.data;
      // Only apply results if this is still the latest search (avoid race condition)
      if (lastSearchRef.current !== trimmed) return;
      if (Array.isArray(data) && data.length > 0) {
        setResults(data);
        setIsOpen(true);
        setSelectedIndex(-1);
      } else {
        setResults([]);
        setIsOpen(false);
      }
    } catch {
      if (lastSearchRef.current !== trimmed) return;
      setResults([]);
      setIsOpen(false);
    } finally {
      if (lastSearchRef.current === trimmed) setIsLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(-1);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsOpen(false);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), DEBOUNCE_MS);
  };

  const navigateToStock = (symbol: string) => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    router.push(`/stock/${symbol}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (selectedIndex >= 0 && results[selectedIndex]) {
        navigateToStock(results[selectedIndex].symbol);
      } else if (query.trim()) {
        navigateToStock(query.trim().toUpperCase());
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // Close dropdown when clicking outside; cancel debounce on unmount
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim().length >= MIN_QUERY_LENGTH && results.length > 0 && setIsOpen(true)}
        placeholder="Search stocks (e.g., AAPL, MSFT)"
        className="w-full rounded-lg border border-border bg-bg-primary px-4 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent"
      />
      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      )}

      {isOpen && results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-lg border border-border bg-bg-secondary shadow-xl">
          {results.slice(0, 8).map((result, idx) => (
            <button
              key={`${result.symbol}-${result.region}-${idx}`}
              type="button"
              onClick={() => navigateToStock(result.symbol)}
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
  );
}
