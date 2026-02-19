/**
 * Debug script: META events pipeline
 *
 * Run: npx tsx scripts/debug-meta-events.ts
 *
 * Requires FINNHUB_API_KEY in .env.local (or env) to test Finnhub company-news.
 */

const DEPLOYED_URL = 'https://buy-the-dip-tracker.vercel.app';
const SYMBOL = 'META';

async function main() {
  console.log('=== META Events Pipeline Debug ===\n');

  // 1. Fetch events from deployed API
  console.log('1. Fetching events from deployed API...');
  const eventsRes = await fetch(`${DEPLOYED_URL}/api/stock/${SYMBOL}/events`);
  const eventsJson = await eventsRes.json();

  if (eventsJson.error) {
    console.log('   Error from API:', eventsJson.error);
  }
  const events = eventsJson.data ?? [];
  console.log('   Events count:', events.length);
  if (events.length > 0) {
    const dates = events.map((e: { date: string }) => e.date);
    console.log('   Event dates (newest first):', dates.slice(0, 10).join(', '));
    const latestDate = dates[0];
    console.log('   Latest event date:', latestDate);

    const withArticles = events.filter((e: { newsArticles: unknown[] }) => e.newsArticles?.length > 0);
    const withoutArticles = events.filter((e: { newsArticles: unknown[] }) => !e.newsArticles?.length);
    console.log('   Events WITH articles:', withArticles.length);
    console.log('   Events WITHOUT articles:', withoutArticles.length);

    if (withArticles.length > 0) {
      const sample = withArticles[0];
      const articleDates = (sample.newsArticles as { publishedAt: string }[]).map((a) =>
        a.publishedAt.slice(0, 10)
      );
      console.log('   Sample article dates (first event):', articleDates.join(', '));
    }
  }
  console.log('');

  // 2. Test Finnhub company-news for recent dates (if API key available)
  const apiKey = process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
  if (!apiKey) {
    console.log('2. Finnhub company-news: Skipped (set FINNHUB_API_KEY to test)');
  } else {
    console.log('2. Testing Finnhub company-news for recent dates...');
    const from = '2025-02-01';
    const to = '2025-02-15';
    const url = `https://finnhub.io/api/v1/company-news?symbol=${SYMBOL}&from=${from}&to=${to}&token=${apiKey}`;
    const newsRes = await fetch(url);
    const news = await newsRes.json();
    if (Array.isArray(news)) {
      console.log('   Articles returned:', news.length);
      if (news.length > 0) {
        const sample = news.slice(0, 3).map((n: { datetime: number; headline: string }) => ({
          date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
          headline: (n.headline ?? '').slice(0, 60) + '...',
        }));
        console.log('   Sample:', JSON.stringify(sample, null, 2));
      } else {
        console.log('   No articles for Feb 1-15. Finnhub may have sparse coverage for this range.');
      }
    } else {
      console.log('   Unexpected response:', typeof news, Object.keys(news));
    }
  }
  console.log('');

  // 3. Summary
  console.log('3. Summary');
  if (events.length === 0) {
    console.log('   -> No events at all. Check: rate limits, price data availability, anomaly threshold.');
  } else {
    const latest = events[0]?.date;
    const noRecent = latest && latest <= '2025-01-30';
    if (noRecent) {
      console.log('   -> Latest event is on or before Jan 30. Anomaly detection is not producing dates after that.');
      console.log('   -> Possible causes: price data ends at ~Jan 30, or biggest moves are all before Jan 30.');
    }
    const manyWithoutArticles = (eventsJson.data ?? []).filter(
      (e: { newsArticles: unknown[] }) => !e.newsArticles?.length
    ).length;
    if (manyWithoutArticles > events.length / 2) {
      console.log('   -> Many events have no articles. Finnhub company-news may return empty for your date windows.');
    }
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
