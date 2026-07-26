import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const {
  ANALYTICS_EVENTS,
  getAnalyticsSummary,
  hasAnalyticsOptOut,
  incrementAnalytics,
  parseAnalyticsEvent,
  safelyIncrementAnalytics,
} = await importBundledModule("../worker/analytics.ts", import.meta.url);

const {
  MAX_ANALYTICS_SUMMARY_ROWS,
  parseAnalyticsSummaryResponse,
} = await importBundledModule("../shared/analytics.ts", import.meta.url);

const {
  ANONYMOUS_BROWSER_ANALYTICS_ENABLED,
  trackAnalyticsEvent,
} = await importBundledModule("../app/lib/analytics-client.ts", import.meta.url);

function createCapturingDatabase(rows = []) {
  const executed = [];
  const allQueries = [];

  return {
    executed,
    allQueries,
    prepare(query) {
      let values = [];
      const statement = {
        query,
        get values() {
          return values;
        },
        bind(...nextValues) {
          values = nextValues;
          return statement;
        },
        async first() {
          return null;
        },
        async all() {
          allQueries.push({ query, values: [...values] });
          return { success: true, results: rows };
        },
        async run() {
          executed.push({ query, values: [...values] });
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

test("source disables browser analytics before any network request", () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(null, { status: 204 });
  };

  try {
    assert.equal(ANONYMOUS_BROWSER_ANALYTICS_ENABLED, false);
    trackAnalyticsEvent({ event: "page_view", path: "/" });
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analytics accepts only the documented aggregate event schema", () => {
  assert.deepEqual(ANALYTICS_EVENTS, [
    "page_view",
    "tool_open",
    "tool_start",
    "tool_complete",
    "tool_error",
  ]);
  assert.deepEqual(
    parseAnalyticsEvent({
      event: "tool_complete",
      tool: "pdf-editor",
    }),
    {
      event: "tool_complete",
      tool: "pdf-editor",
    },
  );

  for (const value of [
    null,
    [],
    {},
    { event: "unknown" },
    { event: "tool_open", tool: 42 },
    { event: "tool_open" },
    { event: "tool_open", tool: "not-a-pagelea-tool" },
    { event: "tool_open", tool: "pdf-editor", path: "/" },
    { event: "pricing_view" },
    { event: "page_view", path: "/", email: "person@example.com" },
    { event: "page_view", ip: "203.0.113.4" },
    { event: "tool_error", documentName: "confidential.pdf" },
    { event: "checkout_start", plan: "pro-monthly" },
    { event: "checkout_redirect", plan: "pro-monthly" },
    { event: "checkout_complete", plan: "pro-monthly" },
    { event: "account_view" },
  ]) {
    assert.equal(parseAnalyticsEvent(value), null);
  }
});

test("analytics honors Global Privacy Control and Do Not Track headers", () => {
  const requestWith = (headers) => new Request("https://pagelea.com", {
    headers,
  });

  assert.equal(hasAnalyticsOptOut(requestWith({ "Sec-GPC": "1" })), true);
  assert.equal(hasAnalyticsOptOut(requestWith({ DNT: "1" })), true);
  assert.equal(
    hasAnalyticsOptOut(requestWith({ "Sec-GPC": "0", DNT: "0" })),
    false,
  );
});

test("analytics persists only allowlisted aggregate dimensions", async () => {
  const timestamp = 1_800_000_000;
  const database = createCapturingDatabase();

  await incrementAnalytics(
    database,
    { event: "tool_complete", tool: "pdf-editor" },
    timestamp,
  );
  await incrementAnalytics(
    database,
    {
      event: "page_view",
      path: "/pricing?email=private.person@example.com",
    },
    timestamp,
  );
  await incrementAnalytics(
    database,
    { event: "tool_error", tool: "private-document-name.pdf" },
    timestamp,
  );
  const inserts = database.executed.filter(({ query }) =>
    /INSERT\s+INTO\s+analytics_daily/i.test(query),
  );
  assert.deepEqual(
    inserts.map(({ values }) => values.slice(1, 4)),
    [
      ["tool_complete", "tool", "pdf-editor"],
      ["page_view", "path", "/other"],
      ["tool_error", "none", "all"],
    ],
  );

  const serialized = JSON.stringify(database.executed);
  assert.doesNotMatch(
    serialized,
    /private\.person|example\.com|private-document-name\.pdf/i,
  );
  assert.doesNotMatch(serialized, /\bip\b|user.?agent|document.?name/i);
});

test("analytics aggregation deletes rows beyond its bounded retention window", async () => {
  const database = createCapturingDatabase();
  await incrementAnalytics(
    database,
    { event: "page_view", path: "/pricing" },
    1_800_000_000,
  );

  const retention = database.executed.find(({ query }) =>
    /DELETE\s+FROM\s+analytics_daily/i.test(query),
  );
  assert.ok(retention, "incrementAnalytics applies aggregate-data retention");
  assert.match(retention.query, /WHERE\s+day\s*</i);
  assert.equal(retention.values.length, 1);
  assert.match(String(retention.values[0]), /^\d{4}-\d{2}-\d{2}$/);
});

test("best-effort analytics never propagates storage failures", async () => {
  const failingDatabase = {
    prepare() {
      throw new Error("D1 is temporarily unavailable");
    },
  };

  await assert.doesNotReject(
    safelyIncrementAnalytics(
      failingDatabase,
      { event: "tool_complete", tool: "pdf-editor" },
      1_800_000_000,
    ),
  );
});

test("analytics summaries clamp the read window and row count", async () => {
  const rows = [
    {
      day: "2026-07-26",
      event_name: "tool_open",
      dimension_key: "tool",
      dimension_value: "pdf-editor",
      event_count: 3,
    },
  ];
  const database = createCapturingDatabase(rows);
  assert.deepEqual(await getAnalyticsSummary(database, 10_000), rows);

  assert.equal(database.allQueries.length, 1);
  assert.match(database.allQueries[0].query, /LIMIT\s+6000/i);
  assert.match(database.allQueries[0].query, /event_name IN/i);
  assert.doesNotMatch(
    database.allQueries[0].query,
    /checkout|pricing_view|account_view/i,
  );
  assert.match(
    String(database.allQueries[0].values[0]),
    /^\d{4}-\d{2}-\d{2}$/,
  );
  const threshold = Date.parse(
    `${database.allQueries[0].values[0]}T00:00:00.000Z`,
  );
  const ageInDays = (Date.now() - threshold) / 86_400_000;
  assert.ok(ageInDays >= 88 && ageInDays <= 90);

  const invalidWindowDatabase = createCapturingDatabase(rows);
  assert.deepEqual(
    await getAnalyticsSummary(invalidWindowDatabase, Number.NaN),
    rows,
  );
  const invalidWindowThreshold = Date.parse(
    `${invalidWindowDatabase.allQueries[0].values[0]}T00:00:00.000Z`,
  );
  const invalidWindowAgeInDays =
    (Date.now() - invalidWindowThreshold) / 86_400_000;
  assert.ok(
    invalidWindowAgeInDays >= 28 && invalidWindowAgeInDays <= 30,
  );
});

test("analytics dashboard contract accepts the full bounded 90-day response", () => {
  const row = {
    day: "2026-07-25",
    event_name: "tool_complete",
    dimension_key: "tool",
    dimension_value: "pdf-editor",
    event_count: 1,
  };
  const maximumRows = Array.from(
    { length: MAX_ANALYTICS_SUMMARY_ROWS },
    () => ({ ...row }),
  );

  assert.equal(
    parseAnalyticsSummaryResponse({ days: 90, rows: maximumRows })?.rows
      .length,
    MAX_ANALYTICS_SUMMARY_ROWS,
  );
  assert.equal(
    parseAnalyticsSummaryResponse({
      days: 90,
      rows: [...maximumRows, { ...row }],
    }),
    null,
  );

  assert.equal(
    parseAnalyticsSummaryResponse({
      days: 30,
      rows: [
        {
          day: "2026-07-25",
          event_name: "checkout_complete",
          dimension_key: "plan",
          dimension_value: "pro-monthly",
          event_count: 1,
        },
      ],
    }),
    null,
  );
});
