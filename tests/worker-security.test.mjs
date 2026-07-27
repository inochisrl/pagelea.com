import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "security-test",
    `${process.pid}-${Date.now()}-${Math.random()}`,
  );
  return (await import(workerUrl.href)).default;
}

function createEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function request(pathname = "/", init = {}) {
  return requestUrl(`https://pagelea.test${pathname}`, init);
}

async function requestUrl(url, init = {}) {
  const worker = await loadWorker();
  const { headers: extraHeaders, ...requestInit } = init;
  return worker.fetch(
    new Request(url, {
      ...requestInit,
      headers: {
        accept: "text/html",
        host: "pagelea.test",
        "x-forwarded-host": "pagelea.test",
        "x-forwarded-proto": "https",
        ...extraHeaders,
      },
    }),
    createEnv(),
    executionContext,
  );
}

function assertStaticSecurityHeaders(response) {
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  assert.equal(
    response.headers.get("cross-origin-opener-policy"),
    "same-origin",
  );
  assert.equal(
    response.headers.get("x-permitted-cross-domain-policies"),
    "none",
  );
}

test("blocks state-changing methods outside the allowlisted API", async () => {
  const response = await request("/", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "next-action": "malicious-action-id",
    },
    body: "untrusted action payload",
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal(await response.text(), "Method Not Allowed");
  assertStaticSecurityHeaders(response);
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; sandbox;",
  );
});

test("answers OPTIONS without enabling cross-origin access", async () => {
  const response = await request("/", {
    method: "OPTIONS",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "POST",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-methods"), null);
  assert.equal(await response.text(), "");
  assertStaticSecurityHeaders(response);
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; sandbox;",
  );
});

test("answers API OPTIONS without advertising cross-origin access", async () => {
  const response = await request("/api/analytics/event", {
    method: "OPTIONS",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "POST",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-methods"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(await response.text(), "");
  assertStaticSecurityHeaders(response);
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; sandbox;",
  );

  const retired = await request("/api/billing/checkout", {
    method: "OPTIONS",
  });
  assert.equal(retired.status, 404);
  assert.equal(retired.headers.get("allow"), null);
  assert.equal((await retired.json()).error.code, "not_found");
});

test("redirects canonical HTTP and the www alias to the HTTPS apex", async () => {
  const response = await requestUrl(
    "http://pagelea.com/tools/pdf-editor?source=homepage%20cta",
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://pagelea.com/tools/pdf-editor?source=homepage%20cta",
  );
  assertStaticSecurityHeaders(response);
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; sandbox;",
  );

  const wwwResponse = await requestUrl(
    "https://www.pagelea.com/tools/pdf-editor?source=www%20alias",
  );
  assert.equal(wwwResponse.status, 308);
  assert.equal(
    wwwResponse.headers.get("location"),
    "https://pagelea.com/tools/pdf-editor?source=www%20alias",
  );
  assertStaticSecurityHeaders(wwwResponse);

  const doubleSlashResponse = await requestUrl(
    "http://pagelea.com//attacker.example/phish",
  );
  assert.equal(doubleSlashResponse.status, 308);
  assert.equal(
    doubleSlashResponse.headers.get("location"),
    "https://pagelea.com//attacker.example/phish",
  );

  const localResponse = await requestUrl("http://pagelea.test/");
  assert.equal(localResponse.status, 200);
  assert.equal(localResponse.headers.get("location"), null);

  const redirectedPost = await requestUrl("http://pagelea.com/must-not-run", {
    method: "POST",
    body: "redirected without entering application routing",
  });
  assert.equal(redirectedPost.status, 308);
  assert.equal(
    redirectedPost.headers.get("location"),
    "https://pagelea.com/must-not-run",
  );
});

test("routes only analytics APIs and rejects foreign origins", async () => {
  const retired = await request("/api/billing/config", {
    headers: { accept: "application/json" },
  });
  assert.equal(retired.status, 404);
  assert.equal((await retired.json()).error.code, "not_found");
  assert.equal(retired.headers.get("access-control-allow-origin"), null);
  assert.equal(
    retired.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; sandbox;",
  );
  assertStaticSecurityHeaders(retired);

  const rejected = await request("/api/analytics/event", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: JSON.stringify({ event: "page_view", path: "/" }),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, "origin_rejected");
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  assert.equal(
    rejected.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; sandbox;",
  );
  assertStaticSecurityHeaders(rejected);
});

test("rejects oversized analytics bodies before parsing", async () => {
  const response = await request("/api/analytics/event", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://pagelea.test",
    },
    body: JSON.stringify({
      event: "page_view",
      path: `/${"x".repeat(1_100)}`,
    }),
  });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "payload_too_large");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assertStaticSecurityHeaders(response);
});

test("serves HTML with a per-request nonce CSP and matching script nonces", async () => {
  const response = await request("/");

  assert.equal(response.status, 200);
  assertStaticSecurityHeaders(response);

  const policy = response.headers.get("content-security-policy") ?? "";
  assert.match(policy, /\bdefault-src 'self'/);
  assert.match(
    policy,
    /\bscript-src 'self' 'nonce-([a-f0-9]{32})' 'wasm-unsafe-eval'/,
  );
  assert.match(policy, /\bobject-src 'none'/);
  assert.match(policy, /\bframe-ancestors 'none'/);
  assert.match(policy, /\bworker-src 'self'(?:;|$)/);
  assert.doesNotMatch(policy, /\bworker-src [^;]*\bblob:/);
  const scriptPolicy = policy.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] ?? "";
  assert.doesNotMatch(scriptPolicy, /'unsafe-eval'|'unsafe-inline'/);
  assert.match(scriptPolicy, /'wasm-unsafe-eval'/);

  const nonce = policy.match(/'nonce-([a-f0-9]{32})'/)?.[1];
  assert.ok(nonce);

  const html = await response.text();
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scriptTags.length > 0);
  for (const [, attributes] of scriptTags) {
    assert.match(attributes, new RegExp(`\\bnonce="${nonce}"`));
  }
});

test("preserves HEAD semantics while applying security headers", async () => {
  const response = await request("/", { method: "HEAD" });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assertStaticSecurityHeaders(response);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /\bscript-src 'self' 'nonce-[a-f0-9]{32}' 'wasm-unsafe-eval'/,
  );
});

test("preserves the image optimizer's restrictive CSP on error responses", async () => {
  const response = await request(
    "/_vinext/image?url=%2Fog.png&w=16&q=75",
    { headers: { accept: "image/avif,image/webp,*/*" } },
  );

  assert.equal(response.status, 404);
  assertStaticSecurityHeaders(response);
  assert.equal(
    response.headers.get("content-security-policy"),
    "script-src 'none'; frame-src 'none'; sandbox;",
  );
});

test("uses a fresh CSP nonce for each HTML response", async () => {
  const [first, second] = await Promise.all([request("/"), request("/")]);
  const firstPolicy = first.headers.get("content-security-policy") ?? "";
  const secondPolicy = second.headers.get("content-security-policy") ?? "";
  const firstNonce = firstPolicy.match(/'nonce-([^']+)'/)?.[1];
  const secondNonce = secondPolicy.match(/'nonce-([^']+)'/)?.[1];

  assert.ok(firstNonce);
  assert.ok(secondNonce);
  assert.notEqual(firstNonce, secondNonce);
});
