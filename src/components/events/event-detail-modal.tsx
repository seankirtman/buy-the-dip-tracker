'use client';

import { useEffect } from 'react';
import type { StockEvent } from '@/lib/types/event';
import { EventImpactBadge } from './event-impact-badge';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { formatDate } from '@/lib/utils/date';

interface EventDetailModalProps {
  event: StockEvent;
  onClose: () => void;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  earnings: 'Earnings',
  guidance: 'Guidance',
  analyst_rating: 'Analyst Rating',
  product_launch: 'Product / Launch',
  regulatory: 'Regulatory',
  macro: 'Macro / Economic',
  management: 'Management',
  sector_move: 'Sector Move',
  unknown: 'Market Move',
};

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const dipAnalysis = getDipAnalysis(event);
  const sp500Return =
    typeof event.sp500Return === 'number'
      ? event.sp500Return
      : event.dailyReturn - event.relativeReturn;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="custom-scrollbar max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-bg-secondary shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 flex items-start justify-between border-b border-border bg-bg-secondary p-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <EventImpactBadge impact={event.impact} size="md" />
              <span className="rounded-full bg-bg-hover px-2 py-0.5 text-xs text-text-muted">
                {EVENT_TYPE_LABELS[event.type] || event.type}
              </span>
            </div>
            <h2 className="text-lg font-bold text-text-primary">{event.title}</h2>
            <p className="mt-0.5 text-sm text-text-muted">{formatDate(event.date)}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l12 12M16 4L4 16" />
            </svg>
          </button>
        </div>

        {/* Price Impact */}
        <div className="border-b border-border p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
            Price Impact
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Price at Event"
              value={formatCurrency(event.priceAtEvent)}
            />
            <Stat
              label="Current Price"
              value={formatCurrency(event.priceNow)}
            />
            <Stat
              label="Day Move"
              value={formatPercent(event.dailyReturn)}
              color={event.dailyReturn >= 0 ? 'positive' : 'negative'}
            />
            <Stat
              label="Since Event"
              value={formatPercent(event.changePercentSinceEvent)}
              color={event.changePercentSinceEvent >= 0 ? 'positive' : 'negative'}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="S&P 500 (day)"
              value={formatPercent(sp500Return)}
              color={sp500Return >= 0 ? 'positive' : 'negative'}
            />
            <Stat
              label="vs S&P 500 (day)"
              value={formatPercentagePoints(event.relativeReturn)}
              color={event.relativeReturn >= 0 ? 'positive' : 'negative'}
            />
            <Stat label="Z-Score" value={event.zScore.toFixed(2)} />
            <Stat
              label="Volume Spike"
              value={`${event.impact.volumeSpike.toFixed(1)}x avg`}
            />
          </div>
        </div>

        {/* Buy the Dip Analysis */}
        {dipAnalysis && (
          <div className="border-b border-border p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
              Buy the Dip Analysis
            </h3>
            <div
              className={`rounded-lg p-4 ${
                dipAnalysis.positive ? 'bg-positive-bg' : 'bg-negative-bg'
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  dipAnalysis.positive ? 'text-positive' : 'text-negative'
                }`}
              >
                {dipAnalysis.verdict}
              </p>
              <p className="mt-1 text-xs text-text-secondary">{dipAnalysis.detail}</p>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="border-b border-border p-5">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
            What Happened
          </h3>
          <p className="text-sm leading-relaxed text-text-secondary">{event.description}</p>
        </div>

        {/* Related News */}
        {event.newsArticles.length > 0 && (
          <div className="p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
              Related News
            </h3>
            <div className="space-y-3">
              {event.newsArticles.map((article) => (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-border p-3 transition-colors hover:border-accent/50 hover:bg-bg-hover"
                >
                  <p className="text-sm font-medium text-text-primary">{article.headline}</p>
                  {article.summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                      {article.summary}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-text-muted">
                    {article.source} &middot;{' '}
                    {formatDate(article.publishedAt.split('T')[0])}
                  </p>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: 'positive' | 'negative';
}) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p
        className={`text-sm font-semibold ${
          color === 'positive'
            ? 'text-positive'
            : color === 'negative'
              ? 'text-negative'
              : 'text-text-primary'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function formatPercentagePoints(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} pp`;
}

function getDipAnalysis(
  event: StockEvent
): { verdict: string; detail: string; positive: boolean } | null {
  if (event.impact.direction !== 'negative') return null;

  const changeSince = event.changePercentSinceEvent;
  const recoveryDays = event.recoveryDays;

  if (changeSince > 20) {
    return {
      verdict: 'Excellent buy opportunity',
      detail: `If you bought at the event price of ${formatCurrency(event.priceAtEvent)}, you'd be up ${changeSince.toFixed(1)}% today. ${
        recoveryDays !== null
          ? `The stock recovered to pre-event levels in ${recoveryDays} trading days.`
          : ''
      }`,
      positive: true,
    };
  }

  if (changeSince > 5) {
    return {
      verdict: 'Good buy opportunity',
      detail: `Buying at ${formatCurrency(event.priceAtEvent)} would have yielded a ${changeSince.toFixed(1)}% return. ${
        recoveryDays !== null
          ? `Recovery took ${recoveryDays} trading days.`
          : 'The stock has recovered and then some.'
      }`,
      positive: true,
    };
  }

  if (changeSince > 0) {
    return {
      verdict: 'Modest recovery',
      detail: `The stock is up ${changeSince.toFixed(1)}% from the event price, a slight recovery. ${
        recoveryDays !== null
          ? `It took ${recoveryDays} trading days to recover.`
          : ''
      }`,
      positive: true,
    };
  }

  if (changeSince > -10) {
    return {
      verdict: 'Risky buy — still underwater',
      detail: `Buying at the event price would leave you down ${Math.abs(changeSince).toFixed(1)}% today. The stock has not yet recovered to pre-event levels.`,
      positive: false,
    };
  }

  return {
    verdict: 'Poor buy timing — significant further decline',
    detail: `The stock fell an additional ${Math.abs(changeSince).toFixed(1)}% after the event. Buying the dip here would have resulted in further losses.`,
    positive: false,
  };
}
