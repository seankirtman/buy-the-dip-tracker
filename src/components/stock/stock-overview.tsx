import { formatCurrency, formatPercent, formatChange } from '@/lib/utils/format';
import type { StockQuote, OHLCDataPoint } from '@/lib/types/stock';
import { format, parseISO } from 'date-fns';

interface StockOverviewProps {
  quote: StockQuote | null;
  symbol: string;
  periodChange?: number;
  periodChangePercent?: number;
  crosshairPoint?: OHLCDataPoint | null;
}

export function StockOverview({ quote, symbol, periodChange, periodChangePercent, crosshairPoint }: StockOverviewProps) {
  if (!quote) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{symbol}</h1>
        <p className="text-sm text-text-muted">Unable to load quote data</p>
      </div>
    );
  }

  const change = periodChange ?? quote.change;
  const changePercent = periodChangePercent ?? quote.changePercent;
  const isPositive = changePercent >= 0;

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold text-text-primary">{quote.symbol}</h1>
        {quote.name !== quote.symbol && (
          <span className="text-sm text-text-secondary">{quote.name}</span>
        )}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-bold text-text-primary">
          {formatCurrency(quote.price)}
        </span>
        <span
          className={`text-lg font-semibold ${isPositive ? 'text-positive' : 'text-negative'}`}
        >
          {formatChange(change)} ({formatPercent(changePercent)})
        </span>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-text-muted">
        <span>Open: {formatCurrency(quote.open)}</span>
        <span>High: {formatCurrency(quote.high)}</span>
        <span>Low: {formatCurrency(quote.low)}</span>
        <span>Prev Close: {formatCurrency(quote.previousClose)}</span>
      </div>

      <div className="mt-4 min-h-[3.5rem]">
        {crosshairPoint && (
          <div className="flex w-fit animate-in fade-in slide-in-from-left-2 items-center gap-6 rounded-lg border border-border/50 bg-bg-secondary/40 px-4 py-2 shadow-sm backdrop-blur-sm">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Date</span>
              <span className="text-sm font-medium text-text-primary">
                {crosshairPoint.time.includes(' ') 
                  ? format(parseISO(crosshairPoint.time.replace(' ', 'T')), 'MMM d, HH:mm')
                  : format(parseISO(crosshairPoint.time), 'MMM d, yyyy')}
              </span>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Price</span>
              <span className="text-sm font-bold text-text-primary">
                {formatCurrency(crosshairPoint.close)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Open</span>
              <span className="text-sm font-medium text-text-secondary">
                {formatCurrency(crosshairPoint.open)}
              </span>
            </div>
            <div className="hidden flex-col sm:flex">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">High</span>
              <span className="text-sm font-medium text-text-secondary">
                {formatCurrency(crosshairPoint.high)}
              </span>
            </div>
            <div className="hidden flex-col sm:flex">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Low</span>
              <span className="text-sm font-medium text-text-secondary">
                {formatCurrency(crosshairPoint.low)}
              </span>
            </div>
            <div className="h-8 w-px bg-border/50" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Change</span>
              <span className={`text-sm font-medium ${crosshairPoint.close >= crosshairPoint.open ? 'text-positive' : 'text-negative'}`}>
                {formatPercent((crosshairPoint.close - crosshairPoint.open) / crosshairPoint.open * 100)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
