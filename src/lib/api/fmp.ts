import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://financialmodelingprep.com/stable';

function getApiKey(): string | null {
  const key = process.env.FMP_API_KEY;
  if (!key || key === 'your_fmp_key_here') return null;
  return key;
}

export interface FmpPriceTargetSummary {
  symbol: string;
  lastMonthCount: number;
  lastMonthAvgPriceTarget: number;
  lastQuarterCount: number;
  lastQuarterAvgPriceTarget: number;
  lastYearCount: number;
  lastYearAvgPriceTarget: number;
  publishers: string[];
}

/**
 * Fetch the price target summary for a symbol (aggregate data with publisher names).
 * Returns null if FMP_API_KEY is not configured or data is unavailable.
 */
export async function getPriceTargetSummary(
  symbol: string
): Promise<FmpPriceTargetSummary | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  checkRateLimit('fmp');

  const url = `${BASE_URL}/price-target-summary?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'StockEventTracker/1.0' },
  });
  if (!res.ok) return null;

  const json = await res.json();
  recordApiCall('fmp', 'price-target-summary', symbol);

  if (!Array.isArray(json) || json.length === 0) return null;

  const entry = json[0] as Record<string, unknown>;

  let publishers: string[] = [];
  const raw = entry.publishers;
  if (typeof raw === 'string') {
    try { publishers = JSON.parse(raw); } catch { /* ignore */ }
  } else if (Array.isArray(raw)) {
    publishers = raw.map(String);
  }

  return {
    symbol: String(entry.symbol ?? symbol),
    lastMonthCount: Number(entry.lastMonthCount ?? 0),
    lastMonthAvgPriceTarget: Number(entry.lastMonthAvgPriceTarget ?? 0),
    lastQuarterCount: Number(entry.lastQuarterCount ?? 0),
    lastQuarterAvgPriceTarget: Number(entry.lastQuarterAvgPriceTarget ?? 0),
    lastYearCount: Number(entry.lastYearCount ?? 0),
    lastYearAvgPriceTarget: Number(entry.lastYearAvgPriceTarget ?? 0),
    publishers,
  };
}
