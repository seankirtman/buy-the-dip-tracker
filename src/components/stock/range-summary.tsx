'use client';

import { useState, useEffect } from 'react';

interface RangeSummaryProps {
  symbol: string;
  pctOfRange: number;
  week52High: number;
  week52Low: number;
  price: number;
  companyName?: string;
  periodChangePercent?: number;
}

export function RangeSummary({
  symbol,
  pctOfRange,
  week52High,
  week52Low,
  price,
  companyName,
  periodChangePercent,
}: RangeSummaryProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSummary() {
      try {
        const params = new URLSearchParams({
          pctOfRange: pctOfRange.toFixed(1),
          week52High: week52High.toFixed(2),
          week52Low: week52Low.toFixed(2),
          price: price.toFixed(2),
        });
        if (companyName) params.set('companyName', companyName);
        if (periodChangePercent != null && !Number.isNaN(periodChangePercent)) {
          params.set('periodChangePercent', periodChangePercent.toFixed(1));
        }

        const res = await fetch(`/api/stock/${symbol}/range-summary?${params}`);
        const json = await res.json();

        if (cancelled) return;
        if (!res.ok) {
          setError(json?.error ?? 'Failed to load summary');
          setSummary(null);
          return;
        }
        setSummary(json.summary ?? null);
        setError(null);
      } catch {
        if (!cancelled) {
          setError('Failed to load summary');
          setSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSummary();
    return () => { cancelled = true; };
  }, [symbol, pctOfRange, week52High, week52Low, price, companyName, periodChangePercent]);

  if (loading) {
    return (
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-bg-secondary" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-bg-secondary" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-bg-secondary" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="mt-3 text-xs text-text-muted">
        Summary unavailable. {error}
      </p>
    );
  }

  if (!summary) return null;

  return (
    <p className="mt-3 text-sm leading-relaxed text-text-secondary">
      {summary}
    </p>
  );
}
