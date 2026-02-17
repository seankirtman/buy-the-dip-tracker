'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'stock-event-tracker-watchlist';

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSymbols(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
    setLoaded(true);
  }, []);

  const save = useCallback((updated: string[]) => {
    setSymbols(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const addSymbol = useCallback(
    (symbol: string) => {
      const upper = symbol.toUpperCase();
      if (!symbols.includes(upper)) {
        save([...symbols, upper]);
      }
    },
    [symbols, save]
  );

  const removeSymbol = useCallback(
    (symbol: string) => {
      save(symbols.filter((s) => s !== symbol.toUpperCase()));
    },
    [symbols, save]
  );

  const isInWatchlist = useCallback(
    (symbol: string) => symbols.includes(symbol.toUpperCase()),
    [symbols]
  );

  return { symbols, loaded, addSymbol, removeSymbol, isInWatchlist };
}
