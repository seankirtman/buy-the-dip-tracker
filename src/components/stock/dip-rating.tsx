'use client';

import { useState, useEffect } from 'react';
import { formatCurrency } from '@/lib/utils/format';

interface DipRatingProps {
  symbol: string;
  price: number;
}

interface LatestAnalyst {
  name: string;
  company: string;
  date: string;
  priceTarget: number;
}

interface DipRatingData {
  grade: string;
  score: number;
  targetPrice: number | null;
  upsidePercent: number | null;
  totalAnalysts: number;
  latestAnalyst: LatestAnalyst | null;
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

function formatAnalystDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
        {data.targetPrice != null && (
          <span>
            Target: {formatCurrency(data.targetPrice)}
            {data.upsidePercent != null && (
              <span className={data.upsidePercent >= 0 ? 'text-positive' : 'text-negative'}>
                {' '}({data.upsidePercent >= 0 ? '+' : ''}{data.upsidePercent}%)
              </span>
            )}
          </span>
        )}
        {data.totalAnalysts > 0 && (
          <span>{data.totalAnalysts} analysts</span>
        )}
      </div>
      {data.latestAnalyst && (
        <div className="mt-2 text-xs text-text-muted">
          <span className="text-text-secondary font-medium">
            {data.latestAnalyst.name}
          </span>
          {data.latestAnalyst.company && (
            <span> ({data.latestAnalyst.company})</span>
          )}
          {' — '}
          {formatCurrency(data.latestAnalyst.priceTarget)} target
          {data.latestAnalyst.date && (
            <span className="text-text-muted/70">
              {' · '}{formatAnalystDate(data.latestAnalyst.date)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
