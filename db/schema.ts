/**
 * Canonical D1 schema documentation.
 *
 * Sites applies the matching SQL migrations in drizzle/ at deployment time.
 * Pagelea stores only bounded daily aggregate product counters. It never
 * stores PDF content, filenames, account records, payment data, request IPs,
 * user agents, referrers, or cookies in D1.
 */
export const PAGELEA_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS analytics_daily (
    day TEXT NOT NULL,
    event_name TEXT NOT NULL,
    dimension_key TEXT NOT NULL,
    dimension_value TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (day, event_name, dimension_key, dimension_value)
  )`,
] as const;
