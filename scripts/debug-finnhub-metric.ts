/**
 * Debug script: call Finnhub stock/metric and log raw response.
 * Run: npx tsx scripts/debug-finnhub-metric.ts [SYMBOL]
 * Loads .env.local if present.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const BASE_URL = 'https://finnhub.io/api/v1';

async function main() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    console.error('FINNHUB_API_KEY missing in .env.local');
    process.exit(1);
  }

  const symbol = process.argv[2] ?? 'AAPL';
  const url = `${BASE_URL}/stock/metric?symbol=${symbol}&metric=all&token=${key}`;
  console.log('Fetching:', url.replace(key, '***'));

  const res = await fetch(url);
  console.log('Status:', res.status, res.statusText);
  const json = await res.json();
  console.log('Raw JSON:', JSON.stringify(json, null, 2));

  // Also try company-basic-financials if that's a different endpoint
  const url2 = `${BASE_URL}/stock/company-basic-financials?symbol=${symbol}&token=${key}`;
  console.log('\nTrying company-basic-financials:', url2.replace(key, '***'));
  const res2 = await fetch(url2);
  console.log('Status:', res2.status, res2.statusText);
  const json2 = await res2.json();
  console.log('Raw JSON:', JSON.stringify(json2, null, 2));
}

main().catch(console.error);
