import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const { handleApiRequest } = await importBundledModule(
  "../worker/api.ts",
  import.meta.url,
);
const {
  authenticatedAdminEmail,
  isAnalyticsAdmin,
} = await importBundledModule("../worker/admin-auth.ts", import.meta.url);

async function apiRequest(pathname, init = {}, env = {}) {
  const request = new Request(`https://pagelea.test${pathname}`, init);
  const result = await handleApiRequest(request, env);
  assert.equal(result.handled, true, pathname);
  assert.ok(result.response, pathname);
  return result.response;
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

function assertNoCrossOriginAccess(response) {
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-methods"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("vary"), null);
}

function analyticsRequest(body, headers = {}, env = {}) {
  return apiRequest(
    "/api/analytics/event",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pagelea.test",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

test("the API router leaves page paths untouched and fails closed inside /api", async () => {
  const nonApi = await handleApiRequest(
    new Request("https://pagelea.test/pricing"),
    {},
  );
  assert.deepEqual(nonApi, { handled: false });

  for (const path of [
    "/api/not-a-real-endpoint",
    "/api/account",
    "/api/billing/config",
    "/api/billing/checkout",
    "/api/billing/portal",
    "/api/billing/webhook",
  ]) {
    const response = await apiRequest(path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await responseJson(response), {
      error: {
        code: "not_found",
        message: "The API endpoint does not exist.",
      },
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assertNoCrossOriginAccess(response);
  }
});

test("the two remaining API endpoints enforce exact methods", async () => {
  for (const [path, method, allowed] of [
    ["/api/analytics/event", "GET", "POST"],
    ["/api/admin/analytics", "POST", "GET"],
  ]) {
    const response = await apiRequest(path, { method });
    assert.equal(response.status, 405, path);
    assert.equal(response.headers.get("allow"), allowed, path);
    assert.equal(
      (await responseJson(response)).error.code,
      "method_not_allowed",
      path,
    );
    assertNoCrossOriginAccess(response);
  }
});

test("anonymous analytics rejects missing, foreign and cross-site origins", async () => {
  for (const headers of [
    { "content-type": "application/json" },
    {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    {
      "content-type": "application/json",
      origin: "https://pagelea.test",
      "sec-fetch-site": "cross-site",
    },
  ]) {
    const response = await apiRequest("/api/analytics/event", {
      method: "POST",
      headers,
      body: JSON.stringify({ event: "page_view", path: "/" }),
    });
    assert.equal(response.status, 403);
    assert.equal(
      (await responseJson(response)).error.code,
      "origin_rejected",
    );
    assertNoCrossOriginAccess(response);
  }
});

test("anonymous analytics bounds media type, JSON and event schema", async () => {
  const wrongType = await apiRequest("/api/analytics/event", {
    method: "POST",
    headers: {
      origin: "https://pagelea.test",
      "content-type": "text/plain",
    },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);
  assert.equal(
    (await responseJson(wrongType)).error.code,
    "unsupported_media_type",
  );

  const invalidJson = await analyticsRequest("{");
  assert.equal(invalidJson.status, 400);
  assert.equal((await responseJson(invalidJson)).error.code, "invalid_json");

  for (const invalidEvent of [
    { event: "pricing_view" },
    { event: "checkout_start", plan: "pro-monthly" },
    { event: "account_view" },
    { event: "tool_open", tool: "not-a-tool" },
    { event: "page_view", path: "/", email: "person@example.com" },
  ]) {
    const response = await analyticsRequest(invalidEvent);
    assert.equal(response.status, 400, invalidEvent.event);
    assert.equal(
      (await responseJson(response)).error.code,
      "invalid_event",
    );
  }

  const declaredOversize = await apiRequest("/api/analytics/event", {
    method: "POST",
    headers: {
      origin: "https://pagelea.test",
      "content-type": "application/json",
      "content-length": "1025",
    },
    body: "{}",
  });
  assert.equal(declaredOversize.status, 413);
  assert.equal(
    (await responseJson(declaredOversize)).error.code,
    "payload_too_large",
  );

  const streamedOversize = await analyticsRequest({
    event: "page_view",
    path: `/${"x".repeat(1_100)}`,
  });
  assert.equal(streamedOversize.status, 413);
  assert.equal(
    (await responseJson(streamedOversize)).error.code,
    "payload_too_large",
  );
});

test("anonymous analytics is storage fail-closed unless explicitly enabled", async () => {
  let databaseReads = 0;
  const disabledEnvironment = Object.defineProperties(
    { PAGELEA_ANONYMOUS_ANALYTICS_ENABLED: "false" },
    {
      DB: {
        get() {
          databaseReads += 1;
          throw new Error("Disabled analytics must not access D1");
        },
      },
    },
  );

  for (const environment of [{}, disabledEnvironment]) {
    const response = await analyticsRequest(
      { event: "page_view", path: "/" },
      {},
      environment,
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  }
  assert.equal(databaseReads, 0);
});

test("GPC and DNT suppress enabled anonymous analytics storage", async () => {
  let databaseWrites = 0;
  const database = {
    prepare() {
      throw new Error("Privacy opt-out must prevent statement creation");
    },
    async batch() {
      databaseWrites += 1;
      return [];
    },
  };

  for (const privacyHeader of [
    { "sec-gpc": "1" },
    { dnt: "1" },
  ]) {
    const response = await analyticsRequest(
      { event: "tool_open", tool: "pdf-editor" },
      privacyHeader,
      {
        DB: database,
        PAGELEA_ANONYMOUS_ANALYTICS_ENABLED: "true",
      },
    );
    assert.equal(response.status, 204);
  }

  assert.equal(databaseWrites, 0);
});

test("enabled anonymous analytics stores only approved aggregate events", async () => {
  const preparedStatements = [];
  let batchCalls = 0;
  const database = {
    prepare(query) {
      return {
        bind(...values) {
          const statement = { query, values };
          preparedStatements.push(statement);
          return statement;
        },
      };
    },
    async batch(statements) {
      batchCalls += 1;
      assert.equal(statements.length, 2);
      return statements.map(() => ({
        success: true,
        meta: { changes: 1 },
      }));
    },
  };

  const response = await analyticsRequest(
    { event: "tool_start", tool: "pdf-editor" },
    {},
    {
      DB: database,
      PAGELEA_ANONYMOUS_ANALYTICS_ENABLED: "true",
    },
  );

  assert.equal(response.status, 204);
  assert.equal(batchCalls, 1);
  assert.equal(preparedStatements.length, 2);
  assert.deepEqual(
    preparedStatements[0].values.slice(1, 4),
    ["tool_start", "tool", "pdf-editor"],
  );
});

test("analytics storage outages never interrupt document work", async () => {
  const failingDatabase = {
    prepare() {
      return {
        bind() {
          return this;
        },
      };
    },
    async batch() {
      throw new Error("D1 is temporarily unavailable");
    },
  };

  const response = await analyticsRequest(
    { event: "tool_complete", tool: "pdf-editor" },
    {},
    {
      DB: failingDatabase,
      PAGELEA_ANONYMOUS_ANALYTICS_ENABLED: "true",
    },
  );

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("administrator identity parsing and allowlisting remain narrow", () => {
  const requestWithIdentity = (value) =>
    ({
      headers: {
        get(name) {
          return name.toLowerCase() === "oai-authenticated-user-email"
            ? value
            : null;
        },
      },
    });

  assert.equal(
    authenticatedAdminEmail(requestWithIdentity(" Owner@Example.COM ")),
    "owner@example.com",
  );
  for (const value of [
    "",
    "not-an-email",
    "a@b",
    "two@@example.com",
    `person@example.com${String.fromCharCode(10)}x`,
    `${"a".repeat(245)}@example.com`,
  ]) {
    assert.equal(authenticatedAdminEmail(requestWithIdentity(value)), null);
  }

  const env = {
    PAGELEA_ADMIN_EMAILS: "other@example.com, OWNER@example.com",
  };
  assert.equal(isAnalyticsAdmin("owner@example.com", env), true);
  assert.equal(isAnalyticsAdmin("attacker@example.com", env), false);
  assert.equal(isAnalyticsAdmin("owner@example.com", {}), false);
});

test("administrative analytics requires identity, allowlist and D1", async () => {
  const unauthenticated = await apiRequest("/api/admin/analytics");
  assert.equal(unauthenticated.status, 401);
  assert.equal(
    (await responseJson(unauthenticated)).error.code,
    "sign_in_required",
  );

  const identityHeaders = {
    "oai-authenticated-user-email": "owner@example.com",
  };
  const unauthorized = await apiRequest("/api/admin/analytics", {
    headers: identityHeaders,
  });
  assert.equal(unauthorized.status, 403);
  assert.equal((await responseJson(unauthorized)).error.code, "admin_required");

  const unavailable = await apiRequest(
    "/api/admin/analytics",
    { headers: identityHeaders },
    { PAGELEA_ADMIN_EMAILS: "owner@example.com" },
  );
  assert.equal(unavailable.status, 503);
  assert.equal(
    (await responseJson(unavailable)).error.code,
    "analytics_unavailable",
  );

  const database = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async all() {
              assert.match(query, /event_name IN/i);
              assert.equal(values.length, 1);
              return { success: true, results: [] };
            },
          };
        },
      };
    },
  };
  const ready = await apiRequest(
    "/api/admin/analytics?days=999",
    { headers: identityHeaders },
    {
      DB: database,
      PAGELEA_ADMIN_EMAILS: "owner@example.com",
    },
  );
  assert.equal(ready.status, 200);
  assert.deepEqual(await responseJson(ready), { days: 90, rows: [] });
  assertNoCrossOriginAccess(ready);
});
