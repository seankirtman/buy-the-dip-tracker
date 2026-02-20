import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const isVercel = Boolean(process.env.VERCEL);
    const dbPath = isVercel
      ? path.join('/tmp', 'cache.db')
      : path.join(process.cwd(), 'data', 'cache.db');

    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      db = new Database(dbPath);
    } catch {
      // Last-resort fallback so server rendering doesn't crash if filesystem is unavailable.
      db = new Database(':memory:');
    }

    try {
      db.pragma('journal_mode = WAL');
    } catch {
      // Ignore journal mode issues in ephemeral/in-memory environments.
    }
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_cache (
      key TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_cache (
      symbol TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 300
    );

    CREATE TABLE IF NOT EXISTS news_cache (
      key TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 7200
    );

    CREATE TABLE IF NOT EXISTS profile_cache (
      key TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 86400
    );

    CREATE TABLE IF NOT EXISTS fundamentals_cache (
      key TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 86400
    );

    CREATE TABLE IF NOT EXISTS events_cache (
      symbol TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      price_data_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      called_at INTEGER NOT NULL,
      symbol TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_provider_date
      ON api_usage(provider, called_at);
  `);
}
