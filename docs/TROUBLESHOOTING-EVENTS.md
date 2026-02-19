# Troubleshooting Event / News Pipeline (e.g., META "No Articles Since Jan 30")

## How the pipeline works

1. **Price data** → Alpha Vantage daily/weekly (or Finnhub candles when rate-limited)
2. **Anomaly detection** → Dates where stock had a statistically significant move vs SPY (z-score)
3. **News correlation** → For each anomaly date, Finnhub company-news is fetched for `anomaly - 1 day` to `anomaly + 1 day`
4. **Output** → Events with headlines, descriptions, and `newsArticles`

**Important:** Events only exist for **anomaly dates**. If the latest detected anomaly is Jan 30, there will be no events (and no articles) for dates after Jan 30. Article dates are driven by anomaly dates.

---

## Step 1: Inspect the live API response

```bash
curl -s "https://buy-the-dip-tracker.vercel.app/api/stock/META/events" | jq '.'
```

Check:

| Field | What to look for |
|-------|------------------|
| `error` | If present: you're on a fallback path (rate-limited, cached fallback, etc.) |
| `data[].date` | Latest event date; if it's Jan 30 or earlier, anomalies stop there |
| `data[].newsArticles` | Length and `publishedAt` dates per event |
| `data[].title` | Generic titles like "META rises X%..." mean no matching news was found |

---

## Step 2: Test Finnhub company-news directly

Run the debug script (see Step 5) or manually:

```bash
# Replace YOUR_FINNHUB_KEY with your API key
curl -s "https://finnhub.io/api/v1/company-news?symbol=META&from=2025-02-01&to=2025-02-15&token=YOUR_FINNHUB_KEY"
```

- **Empty array `[]`** → Finnhub has no news for that range (possible API limit or coverage gap)
- **Non-empty** → Finnhub works; the issue is earlier in the pipeline (anomaly dates or correlation)

---

## Step 3: Identify why anomaly dates stop at Jan 30

Possible causes:

### A) Price data doesn't include recent dates

- **Alpha Vantage**: Free tier can have delayed/lagged data
- **Finnhub candles**: Free tier returns up to 1 year per request; `getDailyCandlesTimeSeries` requests 730 days—may be truncated
- **Cached data**: `price_cache` / `events_cache` on Vercel (`/tmp`) is ephemeral; cold starts can use stale cache

### B) No anomalies after Jan 30

- Z-score threshold may be too strict—recent moves might not qualify
- `selectTopRelativeMoveAnchors` takes top 8 by `|relativeReturn|`; if biggest moves are before Jan 30, recent dates are excluded

### C) Finnhub company-news returns empty for recent dates

- Some symbols or date ranges may have sparse coverage
- Verify with Step 2

---

## Step 4: Check which code path is used

In `src/app/api/stock/[symbol]/events/route.ts`:

- **Primary path** (no `error`): Alpha Vantage daily + weekly → `detectAnomalies` → `correlateNews`
- **Fallback 1**: Cached weekly → `selectTopRelativeMoveAnchors` → `correlateNews`  
  - Error: `"Using cached weekly date-anchored fallback due to provider limits"`
- **Fallback 2**: Finnhub daily candles → `detectAnomalies` or `selectTopRelativeMoveAnchors` → `correlateNews`  
  - Error: `"Using Finnhub events fallback..."` or `"Using date-anchored Finnhub fallback..."`

If you see a fallback error, you're likely rate-limited on Alpha Vantage. The fallback uses Finnhub candles (or cached weekly), which may have different date ranges than AV.

---

## Step 5: Run the debug script

From the project root:

```bash
# Optional: load FINNHUB_API_KEY for Finnhub company-news test
# export FINNHUB_API_KEY=your_key_here
npx tsx scripts/debug-meta-events.ts
```

This script:

1. Fetches META events from your deployed API
2. Calls Finnhub company-news for recent date ranges
3. Prints anomaly dates, article counts, and last price dates

---

## Quick fixes to try

1. **Bypass events cache**  
   Add a cache-busting query param (if you add support) or redeploy to clear `/tmp` on Vercel.

2. **Loosen anomaly selection**  
   In `selectTopRelativeMoveAnchors`, increase `.slice(0, 8)` to include more dates, or add a recency bias so recent dates are favored.

3. **Add a "recent news" fallback**  
   When `correlateNews` returns no articles for an anomaly, optionally fetch a generic "recent company news" window (e.g. last 7 days) and attach the top article.

4. **Verify Finnhub symbol**  
   META is correct (Meta rebranded from FB). No change needed.

---

## Common finding: Alpha Vantage rate limit

If the API returns `error` mentioning "Alpha Vantage" or "rate limit" and `data: []`, you are:

1. Hitting Alpha Vantage's free-tier limit (25 req/day, 1/sec)
2. On Vercel, `price_cache` and `events_cache` are often empty (ephemeral `/tmp`, cold starts)
3. The Finnhub daily fallback may fail if:
   - Finnhub returns 403 for daily candles (some plans exclude certain symbols)
   - Finnhub returns &lt; 50 data points (insufficient for anomaly detection)

**Immediate mitigation:** Reduce Alpha Vantage usage (share cache across users, batch requests) or upgrade the AV plan. Ensure `getDailyCandlesTimeSeries` succeeds for META and SPY so the Finnhub fallback can work when AV is limited.
