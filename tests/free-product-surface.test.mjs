import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}

test("consumer account and commerce modules are absent", async () => {
  for (const pathname of [
    "worker/commerce.ts",
    "shared/plans.ts",
    "app/chatgpt-auth.ts",
    "app/login/page.tsx",
    "app/account/page.tsx",
    "app/account/success/page.tsx",
    "app/pricing/PricingPlans.tsx",
  ]) {
    await assert.rejects(access(new URL(pathname, projectRoot)), pathname);
  }
});

test("Worker runtime exposes analytics without commerce configuration", async () => {
  const workerSource = [
    await source("worker/index.ts"),
    await source("worker/api.ts"),
    await source("worker/runtime-types.ts"),
    await source("worker/analytics.ts"),
  ].join("\n");

  assert.match(workerSource, /\/api\/analytics\/event/);
  assert.match(workerSource, /\/api\/admin\/analytics/);
  assert.doesNotMatch(
    workerSource,
    /STRIPE_|PAGELEA_LICENSE_SECRET|\/api\/billing|\/api\/account|createCheckout|processStripeWebhook|CommerceError|shared\/plans/,
  );
});

test("current schema contains only bounded aggregate analytics", async () => {
  const canonicalSchema = await source("db/schema.ts");
  assert.match(canonicalSchema, /CREATE TABLE IF NOT EXISTS analytics_daily/);
  assert.doesNotMatch(
    canonicalSchema,
    /users|billing_customers|subscriptions|purchases|entitlements|licenses|webhook_events|payment_reversals/i,
  );

  const cleanupMigration = await source(
    "drizzle/0002_remove_consumer_commerce.sql",
  );
  for (const table of [
    "users",
    "billing_customers",
    "subscriptions",
    "purchases",
    "entitlements",
    "licenses",
    "webhook_events",
    "payment_reversals",
  ]) {
    assert.match(
      cleanupMigration,
      new RegExp(`DROP TABLE IF EXISTS ${table}`, "i"),
      table,
    );
  }
  assert.match(cleanupMigration, /DELETE FROM analytics_daily/i);
});

test("free-forever page is static and offers only business contact links", async () => {
  const pricing = await source("app/pricing/page.tsx");

  assert.match(pricing, /Free forever for manual use/);
  assert.match(pricing, /Enterprise/);
  assert.match(pricing, /SDK and OEM/);
  assert.match(pricing, /mailto:hello@pagelea\.com/);
  assert.doesNotMatch(
    pricing,
    /fetch\(|\/api\/|Stripe|subscription|pro-monthly|pro-annual|project-pass|PricingPlans|getChatGPTUser|window\.location|<form/i,
  );
});
