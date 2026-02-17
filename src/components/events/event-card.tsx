import type { StockEvent } from '@/lib/types/event';
import { EventImpactBadge } from './event-impact-badge';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { formatDate } from '@/lib/utils/date';

interface EventCardProps {
  event: StockEvent;
  isSelected: boolean;
  onClick: () => void;
}

export function EventCard({ event, isSelected, onClick }: EventCardProps) {
  const dipVerdict = getDipVerdict(event);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-all ${
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-border bg-bg-card hover:border-border hover:bg-bg-hover'
      }`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <EventImpactBadge impact={event.impact} />
        <span className="shrink-0 text-xs text-text-muted">{formatDate(event.date)}</span>
      </div>

      <h4 className="mb-1 text-sm font-medium leading-snug text-text-primary">
        {event.title}
      </h4>

      <div className="mb-2 flex items-baseline gap-3 text-xs">
        <span className="text-text-muted">
          Price at event: {formatCurrency(event.priceAtEvent)}
        </span>
        <span
          className={`font-medium ${
            event.changePercentSinceEvent >= 0 ? 'text-positive' : 'text-negative'
          }`}
        >
          Since: {formatPercent(event.changePercentSinceEvent)}
        </span>
      </div>

      {dipVerdict && (
        <div
          className={`rounded px-2 py-1 text-xs font-medium ${
            dipVerdict.positive
              ? 'bg-positive-bg text-positive'
              : 'bg-negative-bg text-negative'
          }`}
        >
          {dipVerdict.label}
        </div>
      )}
    </button>
  );
}

function getDipVerdict(
  event: StockEvent
): { label: string; positive: boolean } | null {
  // Only show "buy the dip" analysis for negative events
  if (event.impact.direction !== 'negative') return null;

  if (event.changePercentSinceEvent > 10) {
    return {
      label: `Buying the dip? Great idea — up ${event.changePercentSinceEvent.toFixed(1)}% since`,
      positive: true,
    };
  }
  if (event.changePercentSinceEvent > 0) {
    if (event.recoveryDays !== null) {
      return {
        label: `Recovered in ${event.recoveryDays} trading days`,
        positive: true,
      };
    }
    return {
      label: `Modestly recovered — up ${event.changePercentSinceEvent.toFixed(1)}% since`,
      positive: true,
    };
  }
  if (event.recoveryDays === null) {
    return {
      label: `Still below event price — down ${Math.abs(event.changePercentSinceEvent).toFixed(1)}% since`,
      positive: false,
    };
  }
  return null;
}
