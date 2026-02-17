export default function StockLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 animate-pulse">
        <div className="mb-2 h-8 w-32 rounded bg-bg-card" />
        <div className="mb-1 h-10 w-48 rounded bg-bg-card" />
        <div className="h-5 w-24 rounded bg-bg-card" />
      </div>
      <div className="animate-pulse">
        <div className="mb-4 flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 w-14 rounded bg-bg-card" />
          ))}
        </div>
        <div className="h-[500px] rounded-lg bg-bg-card" />
      </div>
    </div>
  );
}
