'use client';

import { useWatchlist } from '@/hooks/use-watchlist';

interface WatchlistButtonProps {
  symbol: string;
}

export function WatchlistButton({ symbol }: WatchlistButtonProps) {
  const { isInWatchlist, addSymbol, removeSymbol, loaded } = useWatchlist();

  if (!loaded) return null;

  const inList = isInWatchlist(symbol);

  return (
    <button
      onClick={() => (inList ? removeSymbol(symbol) : addSymbol(symbol))}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        inList
          ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
          : 'border-border text-text-secondary hover:border-accent hover:text-accent'
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={inList ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      {inList ? 'In Watchlist' : 'Add to Watchlist'}
    </button>
  );
}
