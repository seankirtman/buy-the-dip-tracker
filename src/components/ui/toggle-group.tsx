'use client';

interface ToggleGroupProps<T extends string> {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Record<T, string>;
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  labels,
}: ToggleGroupProps<T>) {
  return (
    <div className="flex gap-1 rounded-lg border border-border/50 bg-bg-secondary/50 p-1 backdrop-blur-sm">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
            value === option
              ? 'bg-accent text-white shadow-sm'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}
