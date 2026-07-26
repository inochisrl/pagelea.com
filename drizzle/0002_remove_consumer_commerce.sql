-- Pagelea Community has no consumer accounts, checkout, subscriptions, or
-- entitlements. Remove the retired records while preserving anonymous,
-- aggregate product analytics.
DROP TABLE IF EXISTS entitlements;
--> statement-breakpoint
DROP TABLE IF EXISTS licenses;
--> statement-breakpoint
DROP TABLE IF EXISTS purchases;
--> statement-breakpoint
DROP TABLE IF EXISTS subscriptions;
--> statement-breakpoint
DROP TABLE IF EXISTS billing_customers;
--> statement-breakpoint
DROP TABLE IF EXISTS subscription_sync_generations;
--> statement-breakpoint
DROP TABLE IF EXISTS payment_reversals;
--> statement-breakpoint
DROP TABLE IF EXISTS webhook_events;
--> statement-breakpoint
DROP TABLE IF EXISTS users;
--> statement-breakpoint

DELETE FROM analytics_daily
WHERE event_name NOT IN (
  'page_view',
  'tool_open',
  'tool_start',
  'tool_complete',
  'tool_error'
)
OR dimension_key NOT IN ('none', 'path', 'tool');
