'use client';

import { useState, useEffect } from 'react';
import { StockOverview } from '@/components/stock/stock-overview';
import { StockChart } from '@/components/chart/stock-chart';
import { WatchlistButton } from '@/components/stock/watchlist-button';
import type { StockQuote, TimePeriod, TimeSeriesData } from '@/lib/types/stock';

interface StockDashboardProps {
  symbol: string;
  initialQuote: StockQuote | null;
  initialHistory: TimeSeriesData | null;
}

export function StockDashboard({ symbol, initialQuote, initialHistory }: StockDashboardProps) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1Y');
  const [historyData, setHistoryData] = useState<TimeSeriesData | null>(initialHistory);
  const [periodChange, setPeriodChange] = useState<number | undefined>(undefined);
  const [periodChangePercent, setPeriodChangePercent] = useState<number | undefined>(undefined);

  // Calculate change when history data updates
  useEffect(() => {
    if (!historyData?.dataPoints || historyData.dataPoints.length === 0 || !initialQuote) {
      setPeriodChange(undefined);
      setPeriodChangePercent(undefined);
      return;
    }

    // For 1D, we use the quote's daily change (passed to StockOverview by default)
    if (timePeriod === '1D') {
      setPeriodChange(undefined);
      setPeriodChangePercent(undefined);
      return;
    }

    const currentPrice = initialQuote.price;
    // Use the first data point in the series as the baseline
    const startPrice = historyData.dataPoints[0].open; 
    
    const change = currentPrice - startPrice;
    const changePercent = (change / startPrice) * 100;

    setPeriodChange(change);
    setPeriodChangePercent(changePercent);
  }, [historyData, initialQuote, timePeriod]);

  // Fetch history when time period changes
  useEffect(() => {
    if (timePeriod === '1Y' && initialHistory) {
      setHistoryData(initialHistory);
      return;
    }

    let cancelled = false;
    async function fetchHistory() {
      try {
        const res = await fetch(`/api/stock/${symbol}/history?period=${timePeriod}`);
        const json = await res.json();
        if (!cancelled && json.data) {
          setHistoryData(json.data);
        }
      } catch {
        // Keep existing data on error
      }
    }
    fetchHistory();
    return () => { cancelled = true; };
  }, [symbol, timePeriod, initialHistory]);

  return (
    <>
      <div className="mb-6 flex items-start justify-between">
        <StockOverview 
          quote={initialQuote} 
          symbol={symbol} 
          periodChange={periodChange}
          periodChangePercent={periodChangePercent}
        />
        <WatchlistButton symbol={symbol} />
      </div>

      <StockChart
        symbol={symbol}
        historyData={historyData}
        timePeriod={timePeriod}
        onTimePeriodChange={setTimePeriod}
      />
    </>
  );
}
