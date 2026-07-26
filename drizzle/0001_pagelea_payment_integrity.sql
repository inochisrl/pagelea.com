ALTER TABLE subscriptions
  ADD COLUMN stripe_observation_generation INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE subscriptions
  ADD COLUMN completion_analytics_recorded INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subscription_sync_generations (
  stripe_subscription_id TEXT PRIMARY KEY NOT NULL,
  generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE purchases
  ADD COLUMN stripe_payment_intent_id TEXT;
--> statement-breakpoint
ALTER TABLE purchases
  ADD COLUMN stripe_charge_id TEXT;
--> statement-breakpoint
ALTER TABLE purchases
  ADD COLUMN dispute_status TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchases_payment_intent_idx
  ON purchases(stripe_payment_intent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchases_charge_idx
  ON purchases(stripe_charge_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_reversals (
  stripe_payment_intent_id TEXT PRIMARY KEY NOT NULL,
  stripe_charge_id TEXT,
  reversal_status TEXT NOT NULL,
  dispute_status TEXT,
  state_rank INTEGER NOT NULL,
  stripe_event_created INTEGER NOT NULL,
  stripe_event_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
