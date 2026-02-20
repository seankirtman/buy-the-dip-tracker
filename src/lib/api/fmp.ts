import { checkRateLimit, recordApiCall } from './api-queue';

const BASE_URL = 'https://financialmodelingprep.com';

function getApiKey(): string | null {
  const key = process.env.FMP_API_KEY;
  if (!key || key === 'your_fmp_key_here') return null;
  return key;
}

export interface FmpPriceTarget {
  symbol: string;
  publishedDate: string;
  analystName: string;
  analystCompany: string;
  priceTarget: number;
  priceWhenPosted: number;
}

/**
 * Fetch the most recent individual analyst price targets for a symbol.
 * Returns null if FMP_API_KEY is not configured.
 */
export async function getLatestPriceTargets(
  symbol: string,
  limit = 5
): Promise<FmpPriceTarget[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  checkRateLimit('fmp');

  const url = `${BASE_URL}/api/v4/price-target?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return null;
    throw new Error(`FMP API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  recordApiCall('fmp', 'price-target', symbol);

  if (!Array.isArray(json) || json.length === 0) return null;

  return json.slice(0, limit).map((entry: Record<string, unknown>) => ({
    symbol: String(entry.symbol ?? symbol),
    publishedDate: String(entry.publishedDate ?? ''),
    analystName: String(entry.analystName ?? ''),
    analystCompany: String(entry.analystCompany ?? entry.newsPublisher ?? ''),
    priceTarget: Number(entry.adjPriceTarget ?? entry.priceTarget ?? 0),
    priceWhenPosted: Number(entry.priceWhenPosted ?? 0),
  }));
}
