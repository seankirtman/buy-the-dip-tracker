'use client';

import { useState, useEffect } from 'react';
import { formatCurrency } from '@/lib/utils/format';

interface DipRatingProps {
  symbol: string;
  price: number;
}

interface FmpSummary {
  last30DaysCount: number;
  last30DaysAvgTarget: number;
  publishers: string[];
}

interface DipRatingData {
  grade: string;
  score: number;
  targetPrice: number | null;
  upsidePercent: number | null;
  totalAnalysts: number;
  fmpSummary: FmpSummary | null;
}

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-400',
  'A':  'text-emerald-400',
  'A-': 'text-emerald-500',
  'B+': 'text-green-400',
  'B':  'text-green-500',
  'B-': 'text-lime-400',
  'C+': 'text-yellow-400',
  'C':  'text-yellow-500',
  'C-': 'text-amber-500',
  'D+': 'text-orange-400',
  'D':  'text-orange-500',
  'F':  'text-red-500',
};

function gradeDescription(grade: string): string {
  if (grade.startsWith('A')) return 'Strong buy-the-dip signal';
  if (grade.startsWith('B')) return 'Favorable dip opportunity';
  if (grade.startsWith('C')) return 'Mixed signals — proceed with caution';
  if (grade.startsWith('D')) return 'Weak setup — analysts are cautious';
  return 'Poor timing — targets revised lower';
}

export function DipRating({ symbol, price }: DipRatingProps) {
  const [data, setData] = useState<DipRatingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchRating() {
      try {
        const res = await fetch(
          `/api/stock/${symbol}/dip-rating?price=${price.toFixed(2)}`
        );
        if (!res.ok) {
          setError(true);
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRating();
    return () => { cancelled = true; };
  }, [symbol, price]);

  if (loading) {
    return (
      <div className="mt-3 space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-bg-secondary" />
        <div className="h-3 w-40 animate-pulse rounded bg-bg-secondary" />
      </div>
    );
  }

  if (error || !data) return null;

  const colorClass = GRADE_COLORS[data.grade] ?? 'text-text-muted';

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Buy the Dip Rating
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className={`text-3xl font-black tracking-tight ${colorClass}`}>
          {data.grade}
        </span>
        <span className="text-sm text-text-secondary">
          {gradeDescription(data.grade)}
        </span>
      </div>
      <div className="mt-2 space-y-1.5 text-xs text-text-muted">
        {data.totalAnalysts > 0 && (
          <div>
            <span className="text-text-secondary font-medium">{data.totalAnalysts} analysts</span>
            {data.targetPrice != null && (
              <>
                {' · target '}
                {formatCurrency(data.targetPrice)}
                {data.upsidePercent != null && (
                  <span className={data.upsidePercent >= 0 ? 'text-positive' : 'text-negative'}>
                    {' '}({data.upsidePercent >= 0 ? '+' : ''}{data.upsidePercent}%)
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {data.fmpSummary && data.fmpSummary.last30DaysCount > 0 && (
          <div>
            <span className="text-text-secondary font-medium">
              Price target updates in last 30 days: {data.fmpSummary.last30DaysCount}
            </span>
            {' · avg '}
            {formatCurrency(data.fmpSummary.last30DaysAvgTarget)}
            {data.fmpSummary.publishers.length > 0 && (
              <span className="text-text-muted/70">
                {' '}via {data.fmpSummary.publishers.slice(0, 3).join(', ')}
                {data.fmpSummary.publishers.length > 3 && (
                  <span> +{data.fmpSummary.publishers.length - 3} more</span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
