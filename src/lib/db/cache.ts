import { getDb } from './schema';
import crypto from 'crypto';

export class CacheManager {
  getOrFetch<T>(
    table: string,
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
    symbol?: string
  ): Promise<T> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Try to get from cache (quote_cache uses symbol as PK, others use key)
    const whereColumn = table === 'quote_cache' ? 'symbol' : 'key';
    const row = db
      .prepare(`SELECT data, fetched_at, ttl_seconds FROM ${table} WHERE ${whereColumn} = ?`)
      .get(key) as { data: string; fetched_at: number; ttl_seconds: number } | undefined;

    if (row && now - row.fetched_at < row.ttl_seconds) {
      return Promise.resolve(JSON.parse(row.data) as T);
    }

    // Cache miss or stale — fetch fresh data
    return fetcher().then((data) => {
      if (table === 'quote_cache') {
        db.prepare(
          'INSERT OR REPLACE INTO quote_cache (symbol, data, fetched_at, ttl_seconds) VALUES (?, ?, ?, ?)'
        ).run(key, JSON.stringify(data), now, ttlSeconds);
      } else {
        db.prepare(
          `INSERT OR REPLACE INTO ${table} (key, symbol, data, fetched_at, ttl_seconds) VALUES (?, ?, ?, ?, ?)`
        ).run(key, symbol || key, JSON.stringify(data), now, ttlSeconds);
      }

      return data;
    });
  }

  getCached<T>(table: string, key: string): T | null {
    const db = getDb();
    const column = table === 'quote_cache' || table === 'events_cache' ? 'symbol' : 'key';
    const row = db
      .prepare(`SELECT data FROM ${table} WHERE ${column} = ?`)
      .get(key) as { data: string } | undefined;

    return row ? (JSON.parse(row.data) as T) : null;
  }

  setEventsCache(symbol: string, data: unknown, priceDataHash: string): void {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      'INSERT OR REPLACE INTO events_cache (symbol, data, computed_at, price_data_hash) VALUES (?, ?, ?, ?)'
    ).run(symbol, JSON.stringify(data), now, priceDataHash);
  }

  getEventsCache<T>(symbol: string, currentPriceDataHash: string): T | null {
    const db = getDb();
    const row = db
      .prepare('SELECT data, price_data_hash FROM events_cache WHERE symbol = ?')
      .get(symbol) as { data: string; price_data_hash: string } | undefined;

    if (row && row.price_data_hash === currentPriceDataHash) {
      return JSON.parse(row.data) as T;
    }
    return null;
  }

  recordApiUsage(provider: string, endpoint: string, symbol?: string): void {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      'INSERT INTO api_usage (provider, endpoint, called_at, symbol) VALUES (?, ?, ?, ?)'
    ).run(provider, endpoint, now, symbol || null);
  }

  getApiUsageToday(provider: string): number {
    const db = getDb();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTimestamp = Math.floor(startOfDay.getTime() / 1000);

    const row = db
      .prepare('SELECT COUNT(*) as count FROM api_usage WHERE provider = ? AND called_at >= ?')
      .get(provider, startTimestamp) as { count: number };

    return row.count;
  }

  static hashData(data: unknown): string {
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }
}

export const cacheManager = new CacheManager();
