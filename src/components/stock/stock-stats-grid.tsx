import { formatCurrency, formatLargeNumber, formatVolume } from '@/lib/utils/format';
import type { StockQuote, TimeSeriesData } from '@/lib/types/stock';
import type { CompanyProfile } from '@/lib/api/finnhub';
import { RangeSummary } from './range-summary';

interface StockStatsGridProps {
  quote: StockQuote | null;
  history?: TimeSeriesData | null;
  profile?: CompanyProfile | null;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm font-medium text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

function StatSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function StockStatsGrid({ quote, history, profile }: StockStatsGridProps) {

  // Compute 52-week high/low from history
  let week52High: number | null = null;
  let week52Low: number | null = null;
  let avgVolume: number | null = null;
  if (history?.dataPoints && history.dataPoints.length > 0) {
    week52High = Math.max(...history.dataPoints.map((d) => d.high));
    week52Low = Math.min(...history.dataPoints.map((d) => d.low));
    const totalVol = history.dataPoints.reduce((s, d) => s + d.volume, 0);
    avgVolume = totalVol / history.dataPoints.length;
  }

  const marketCap = profile?.marketCap ?? quote?.marketCap ?? null;
  const peRatio = quote?.peRatio;

  let periodChangePercent: number | undefined;
  if (history?.dataPoints && history.dataPoints.length >= 2 && quote) {
    const first = history.dataPoints[0];
    const last = history.dataPoints[history.dataPoints.length - 1];
    const startPrice = first.open;
    const endPrice = last.close;
    if (startPrice && startPrice > 0) {
      periodChangePercent = ((endPrice - startPrice) / startPrice) * 100;
    }
  }

  return (
    <section className="mt-6" aria-label="Key statistics">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Key Statistics</h2>
      {!quote ? (
        <p className="rounded-lg border border-border bg-bg-card p-6 text-center text-text-muted">
          Quote data is required to display statistics.
        </p>
      ) : (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-[1fr_1fr_2fr] items-stretch">
        <StatSection title="Trading">
          <StatRow label="Open" value={formatCurrency(quote.open ?? 0)} />
          <StatRow label="Previous Close" value={formatCurrency(quote.previousClose ?? 0)} />
          <StatRow label="Day High" value={formatCurrency(quote.high ?? 0)} />
          <StatRow label="Day Low" value={formatCurrency(quote.low ?? 0)} />
          <StatRow label="Volume" value={formatVolume(quote.volume ?? 0)} />
          {avgVolume != null && avgVolume > 0 && (
            <StatRow label="Avg. Volume" value={formatVolume(Math.round(avgVolume))} />
          )}
          {marketCap != null && marketCap > 0 && (
            <StatRow label="Market Cap" value={formatLargeNumber(marketCap)} />
          )}
          <StatRow label="P/E Ratio" value={peRatio != null ? peRatio.toFixed(2) : '—'} />
        </StatSection>

        {(week52High != null || week52Low != null) && (
          <StatSection title="52-Week Summary">
            {week52High != null && (
              <StatRow label="52W High" value={formatCurrency(week52High)} />
            )}
            {week52Low != null && (
              <StatRow label="52W Low" value={formatCurrency(week52Low)} />
            )}
            {week52High != null && week52Low != null && week52High > week52Low && (
              <>
                <StatRow
                  label="% of Range"
                  value={`${(((quote.price - week52Low) / (week52High - week52Low)) * 100).toFixed(0)}%`}
                />
                <div className="mt-2">
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-secondary">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-accent transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((quote.price - week52Low) / (week52High - week52Low)) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-text-muted">
                    <span>{formatCurrency(week52Low)}</span>
                    <span>{formatCurrency(week52High)}</span>
                  </div>
                </div>
              </>
            )}
          </StatSection>
        )}

        {(week52High != null && week52Low != null && week52High > week52Low && (
          <StatSection title="Summary">
            <RangeSummary
                symbol={quote.symbol ?? quote.name}
                pctOfRange={((quote.price - week52Low) / (week52High - week52Low)) * 100}
                week52High={week52High}
                week52Low={week52Low}
                price={quote.price}
                companyName={profile?.name}
                industry={profile?.industry}
                periodChangePercent={periodChangePercent}
            />
          </StatSection>
        ))}
      </div>
      )}
    </section>
  );
}
