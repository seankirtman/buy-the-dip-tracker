import { StockDashboard } from '@/components/stock/stock-dashboard';
import { StockStatsGrid } from '@/components/stock/stock-stats-grid';
import { getStockPageData } from '@/lib/data/stock-page';

interface StockPageProps {
  params: Promise<{ symbol: string }>;
}

export default async function StockPage({ params }: StockPageProps) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  // Fetch data directly (avoids HTML-instead-of-JSON errors from self-fetch)
  const { quote, history, profile, stale } = await getStockPageData(upperSymbol, '1Y');

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {stale && (
        <div className="mb-4 rounded-lg border border-event-high/30 bg-event-high/10 px-4 py-2 text-sm text-event-high">
          Some data may be stale due to API rate limits. Cached data is being shown.
        </div>
      )}

      <StockDashboard
        symbol={upperSymbol}
        initialQuote={quote}
        initialHistory={history}
      />

      <StockStatsGrid quote={quote} history={history} profile={profile} />
    </div>
  );
}
