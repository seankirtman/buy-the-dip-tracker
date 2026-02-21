'use client';

import type { StockEvent } from '@/lib/types/event';
import { EventCard } from './event-card';

interface EventListProps {
  events: StockEvent[];
  loading: boolean;
  error?: string | null;
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  currentPrice?: number;
}

export function EventList({
  events,
  loading,
  error,
  selectedEventId,
  onEventSelect,
  currentPrice,
}: EventListProps) {
  // Default and only view: most recent events first.
  const sortedEvents = [...events].sort((a, b) => b.date.localeCompare(a.date));

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Detecting Events...</h3>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-2">
              <div className="h-4 w-24 rounded bg-bg-hover" />
              <div className="h-3 w-full rounded bg-bg-hover" />
              <div className="h-3 w-3/4 rounded bg-bg-hover" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    const isRateLimited = error && (error.includes('Alpha Vantage') || error.includes('rate limit') || error.includes('Rate limited'));
    const isProviderError = error && !isRateLimited;

    if (isRateLimited) {
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10">
            <span className="text-base text-amber-400">!</span>
          </div>
          <p className="text-sm font-medium text-amber-400">
            Event detection temporarily unavailable
          </p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Our data provider is rate-limited. Events will load automatically when the limit resets. Try again in a few minutes.
          </p>
        </div>
      );
    }

    if (isProviderError) {
      return (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
            <span className="text-base text-red-400">!</span>
          </div>
          <p className="text-sm font-medium text-red-400">
            Failed to detect events
          </p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Something went wrong while analyzing this stock. Please try again shortly.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-border bg-bg-card p-6 text-center">
        <p className="text-sm text-text-secondary">
          No significant events detected for this stock in the past year.
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Events are detected when a stock moves significantly more than the broader market.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-card">
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            Events ({events.length})
          </h3>
          <span className="text-xs text-text-muted">Recent first</span>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-[11px] leading-snug text-amber-400/80">
            Showing cached results — live data is temporarily limited.
          </p>
        </div>
      )}

      <div className="custom-scrollbar max-h-[500px] space-y-2 overflow-y-auto p-3">
        {sortedEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            isSelected={event.id === selectedEventId}
            onClick={() => onEventSelect(event.id)}
            currentPrice={currentPrice}
          />
        ))}
      </div>
    </div>
  );
}
