'use client';

import type { StockEvent } from '@/lib/types/event';
import { EventCard } from './event-card';

interface EventListProps {
  events: StockEvent[];
  loading: boolean;
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

export function EventList({
  events,
  loading,
  selectedEventId,
  onEventSelect,
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

      <div className="custom-scrollbar max-h-[500px] space-y-2 overflow-y-auto p-3">
        {sortedEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            isSelected={event.id === selectedEventId}
            onClick={() => onEventSelect(event.id)}
          />
        ))}
      </div>
    </div>
  );
}
