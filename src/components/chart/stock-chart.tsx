'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChartControls } from './chart-controls';
import { ChartContainer } from './chart-container';
import type { ChartContainerHandle } from './chart-container';
import { EventList } from '@/components/events/event-list';
import { EventDetailModal } from '@/components/events/event-detail-modal';
import type { TimePeriod, ViewMode, TimeSeriesData } from '@/lib/types/stock';
import type { StockEvent } from '@/lib/types/event';

interface StockChartProps {
  symbol: string;
  historyData: TimeSeriesData | null;
  historyLoading?: boolean;
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
  currentPrice?: number | null;
}

export function StockChart({
  symbol,
  historyData,
  historyLoading = false,
  timePeriod,
  onTimePeriodChange,
  currentPrice,
}: StockChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('standard');
  const [events, setEvents] = useState<StockEvent[]>([]);
  const [eventsSymbol, setEventsSymbol] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const chartRef = useRef<ChartContainerHandle>(null);

  // Reset event state when changing symbols so event tab/data doesn't leak across pages.
  useEffect(() => {
    setEvents([]);
    setEventsSymbol(null);
    setSelectedEventId(null);
    setShowEventModal(false);
    setEventsError(null);
  }, [symbol]);

  // Fetch events when switching to event view
  useEffect(() => {
    if (viewMode !== 'event') return;
    if (eventsSymbol === symbol && events.length > 0) return;

    let cancelled = false;
    const controller = new AbortController();
    async function fetchEvents() {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const res = await fetch(`/api/stock/${symbol}/events`, { signal: controller.signal });
        const text = await res.text();
        const json = text.trim().startsWith('{') ? JSON.parse(text) : null;
        if (!cancelled && res.ok && json && Array.isArray(json.data)) {
          setEvents(json.data as StockEvent[]);
          setEventsSymbol(symbol);
          if (json.error) {
            setEventsError(json.error);
          }
        } else if (!cancelled) {
          setEvents([]);
          setEventsSymbol(symbol);
          setEventsError(json?.error || (res.ok ? null : `Server error (${res.status})`));
        }
      } catch (err) {
        if (!cancelled) {
          setEvents([]);
          setEventsError(err instanceof Error && err.name !== 'AbortError' ? 'Failed to load events. Please try again.' : null);
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }
    fetchEvents();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, viewMode, events.length, eventsSymbol]);

  const handleEventClick = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setShowEventModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowEventModal(false);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'standard') {
      setSelectedEventId(null);
      setShowEventModal(false);
      chartRef.current?.resetZoom();
    }
  }, []);

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;
  const hasChartData = Boolean(historyData?.dataPoints && historyData.dataPoints.length > 0);

  return (
    <div>
      <ChartControls
        timePeriod={timePeriod}
        viewMode={viewMode}
        onTimePeriodChange={onTimePeriodChange}
        onViewModeChange={handleViewModeChange}
        eventsCount={events.length}
      />

      <div className={`flex gap-4 ${viewMode === 'event' ? 'flex-col lg:flex-row' : ''}`}>
        <div className={viewMode === 'event' ? 'flex-1 min-w-0' : 'w-full'}>
          {hasChartData ? (
            <ChartContainer
              ref={chartRef}
              data={historyData?.dataPoints || []}
              events={events}
              showEvents={viewMode === 'event'}
              selectedEventId={selectedEventId}
              timePeriod={timePeriod}
              onEventClick={handleEventClick}
            />
          ) : historyLoading ? (
            <div className="flex h-[500px] w-full items-center justify-center rounded-xl border border-border/50 bg-gradient-to-b from-bg-secondary/30 to-bg-primary px-6 text-center text-sm text-text-secondary">
              Loading {timePeriod} chart for {symbol}...
            </div>
          ) : (
            <div className="flex h-[500px] w-full items-center justify-center rounded-xl border border-border/50 bg-gradient-to-b from-bg-secondary/30 to-bg-primary px-6 text-center text-sm text-text-secondary">
              Chart data is temporarily unavailable for {symbol}. Try another time period or refresh in a minute.
            </div>
          )}
        </div>

        {viewMode === 'event' && (
          <div className="w-full lg:w-80 shrink-0">
            <EventList
              events={events}
              loading={eventsLoading}
              error={eventsError}
              selectedEventId={selectedEventId}
              onEventSelect={handleEventClick}
              currentPrice={currentPrice ?? undefined}
            />
          </div>
        )}
      </div>

      {showEventModal && selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={handleCloseModal}
          symbol={symbol}
          currentPrice={currentPrice ?? undefined}
        />
      )}
    </div>
  );
}
