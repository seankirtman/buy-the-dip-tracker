import { formatCurrency, formatPercent, formatChange } from '@/lib/utils/format';
import type { StockQuote } from '@/lib/types/stock';

interface StockOverviewProps {
  quote: StockQuote | null;
  symbol: string;
  periodChange?: number;
  periodChangePercent?: number;
}

export function StockOverview({ quote, symbol, periodChange, periodChangePercent }: StockOverviewProps) {
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
    </div>
  );
}
