PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS billing_customers (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_price_id TEXT,
  status TEXT NOT NULL,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_updated_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS purchases (
  checkout_session_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  payment_status TEXT NOT NULL,
  access_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchases_user_idx ON purchases(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  active_until INTEGER,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, feature_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  active_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS webhook_events (
  stripe_event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  event_created INTEGER NOT NULL,
  processed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT NOT NULL,
  event_name TEXT NOT NULL,
  dimension_key TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, event_name, dimension_key, dimension_value)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS analytics_daily_day_idx ON analytics_daily(day);
