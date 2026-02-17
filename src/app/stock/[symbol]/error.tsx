'use client';

import Link from 'next/link';

export default function StockError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 text-center">
      <h2 className="mb-2 text-xl font-bold text-text-primary">Failed to load stock data</h2>
      <p className="mb-6 text-sm text-text-secondary">
        {error.message || 'Could not fetch data for this stock.'}
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Retry
        </button>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
