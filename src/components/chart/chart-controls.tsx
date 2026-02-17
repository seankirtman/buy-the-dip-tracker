'use client';

import { ToggleGroup } from '@/components/ui/toggle-group';
import type { TimePeriod, ViewMode } from '@/lib/types/stock';

const TIME_PERIODS: TimePeriod[] = ['1D', '7D', '1M', '6M', 'YTD', '1Y'];

interface ChartControlsProps {
  timePeriod: TimePeriod;
  viewMode: ViewMode;
  onTimePeriodChange: (period: TimePeriod) => void;
  onViewModeChange: (mode: ViewMode) => void;
  eventsCount?: number;
}

export function ChartControls({
  timePeriod,
  viewMode,
  onTimePeriodChange,
  onViewModeChange,
  eventsCount = 0,
}: ChartControlsProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <ToggleGroup
        options={TIME_PERIODS}
        value={timePeriod}
        onChange={onTimePeriodChange}
      />

      <button
        type="button"
        onClick={() => onViewModeChange(viewMode === 'standard' ? 'event' : 'standard')}
        className={`flex items-center gap-2 rounded-lg border px-4 py-1.5 text-sm font-medium transition-all ${
          viewMode === 'event'
            ? 'border-event-extreme bg-event-extreme/10 text-event-extreme shadow-sm'
            : 'border-border/50 bg-bg-secondary/30 text-text-secondary hover:border-event-extreme/50 hover:bg-event-extreme/5 hover:text-event-extreme'
        }`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        Event View
        {eventsCount > 0 && (
          <span
            className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
              viewMode === 'event'
                ? 'bg-event-extreme/20 text-event-extreme'
                : 'bg-bg-hover text-text-muted'
            }`}
          >
            {eventsCount}
          </span>
        )}
      </button>
    </div>
  );
}
