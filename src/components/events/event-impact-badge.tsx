import type { EventImpact } from '@/lib/types/event';

interface EventImpactBadgeProps {
  impact: EventImpact;
  size?: 'sm' | 'md';
}

const MAGNITUDE_STYLES = {
  extreme: 'bg-event-extreme/15 text-event-extreme border-event-extreme/30',
  high: 'bg-event-high/15 text-event-high border-event-high/30',
  moderate: 'bg-event-moderate/15 text-event-moderate border-event-moderate/30',
};

const MAGNITUDE_LABELS = {
  extreme: 'Extreme',
  high: 'High',
  moderate: 'Moderate',
};

export function EventImpactBadge({ impact, size = 'sm' }: EventImpactBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${MAGNITUDE_STYLES[impact.magnitude]} ${sizeClasses}`}
    >
      <span>{impact.direction === 'positive' ? '▲' : '▼'}</span>
      <span>{MAGNITUDE_LABELS[impact.magnitude]}</span>
    </span>
  );
}
