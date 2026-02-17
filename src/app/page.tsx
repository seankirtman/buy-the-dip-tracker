import { WatchlistPanel } from '@/components/stock/watchlist-panel';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-12 text-center">
        <h1 className="mb-3 text-4xl font-bold text-text-primary">Stock Event Tracker</h1>
        <p className="mx-auto max-w-2xl text-lg text-text-secondary">
          Track stocks and discover the events that moved them. Toggle to Event View to see
          how major news, earnings, and market shifts impacted any stock — and whether buying
          the dip was the right call.
        </p>
      </div>

      <WatchlistPanel />
    </div>
  );
}
