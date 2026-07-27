import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/", requestHeaders = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${Math.random()}`,
  );
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://pagelea.test${pathname}`, {
      headers: {
        accept: "text/html",
        host: "pagelea.test",
        "x-forwarded-host": "pagelea.test",
        "x-forwarded-proto": "https",
        ...requestHeaders,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished Pagelea homepage", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.doesNotMatch(
    response.headers.get("link") ?? "",
    /\bas=font\b/i,
    "font files should load on demand instead of preloading every unicode range",
  );

  const html = await response.text();
  assert.match(html, /<title>Pagelea — Free, open-source PDF tools<\/title>/i);
  assert.match(html, /Change PDF text/);
  assert.match(html, /without uploading it/);
  assert.match(html, /Browse 8 tools/);
  assert.match(
    html,
    /aria-label="Pagelea home"/i,
    "the compact mobile brand link must keep an accessible name",
  );
  assert.match(html, /Pagelea Community/);
  assert.match(html, /Pagelea Open Source/);
  assert.match(html, /Free forever/);
  assert.match(
    html,
    /github\.com\/inochisrl\/pagelea\.com\/tree\/v0\.4\.1/i,
    "every rendered page must expose the exact corresponding source tag",
  );
  assert.doesNotMatch(html, /Pagelea Account|Pagelea Desktop/i);
  assert.match(html, /https:\/\/pagelea\.com\/og\.png/);
  assert.match(html, /viewport-fit=cover/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);

  const homeStyles = await readFile(
    new URL("../app/components/HomePage.module.css", import.meta.url),
    "utf8",
  );
  assert.match(
    homeStyles,
    /\.toolsSection\s*\{[^}]*overflow:\s*hidden;/s,
    "the oversized tools-section decoration must not create page-level horizontal scroll",
  );
});

test("uses the canonical Pagelea origin even with hostile forwarded headers", async () => {
  const response = await render("/", {
    host: "attacker.example",
    "x-forwarded-host": "attacker.example",
    "x-forwarded-proto": "http",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /https:\/\/pagelea\.com\/og\.png/);
  assert.doesNotMatch(html, /attacker\.example/);
});

test("publishes complete public information and legal pages", async () => {
  for (const [pathname, marker, updated] of [
    ["/about", "Operator and contact", "27 July 2026"],
    ["/help", "Contact support", "27 July 2026"],
    ["/security", "Responsible reporting", "27 July 2026"],
    ["/terms", "Free community service", "26 July 2026"],
    ["/privacy", "Controller and contact", "27 July 2026"],
    ["/cookies", "__cf_bm", "26 July 2026"],
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, new RegExp(marker, "i"), pathname);
    assert.match(html, /Last updated/i, pathname);
    assert.match(html, new RegExp(updated, "i"), pathname);
    if (pathname !== "/cookies") {
      assert.match(html, /hello@pagelea\.com/i, pathname);
    }
  }

  const terms = await render("/terms");
  const termsHtml = await terms.text();
  assert.match(termsHtml, /AGPL-3\.0-or-later/i);
  assert.match(termsHtml, /trademark policy/i);
  assert.match(termsHtml, /Enterprise, SDK and professional services/i);
  assert.doesNotMatch(termsHtml, /product baseline|reviewed by legal counsel/i);
  assert.doesNotMatch(termsHtml, /all Pagelea visual and written material is original/i);
  assert.doesNotMatch(termsHtml, /subscription|Stripe|billing portal/i);

  const privacy = await render("/privacy");
  const privacyHtml = await privacy.text();
  assert.match(privacyHtml, /privacy fail-closed/i);
  assert.match(privacyHtml, /Standard Contractual Clauses/i);
  assert.match(privacyHtml, /without registration/i);
  assert.match(privacyHtml, /normalized path, tool or non-identifying/i);
  assert.match(privacyHtml, /deleted on the next aggregate write/i);
  assert.doesNotMatch(privacyHtml, /Stripe|subscription|payment card/i);

  for (const retiredPath of ["/login", "/account", "/account/success"]) {
    const retired = await render(retiredPath);
    assert.equal(retired.status, 404, retiredPath);
  }

  const unknown = await render("/not-a-pagelea-page");
  assert.equal(unknown.status, 404);
});

test("publishes a static free-forever page without consumer commerce", async () => {
  const response = await render("/pricing");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Free forever for manual use/i);
  assert.match(html, /No account or online purchase flow/i);
  assert.match(html, /AGPL-3\.0-or-later/i);
  assert.match(html, /Enterprise/i);
  assert.match(html, /SDK and OEM/i);
  assert.match(html, /100 MB/i);
  assert.match(html, /500 pages/i);
  assert.doesNotMatch(
    html,
    /Stripe|checkout|subscription|pro-monthly|project-pass|billing portal/i,
  );
});

test("server-renders a real dynamic tool workspace", async () => {
  const response = await render("/tools/merge-pdf");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>Merge PDF · Pagelea<\/title>/i);
  assert.match(html, /Combine PDFs, JPGs, and PNGs in the order you choose/);
  assert.match(html, /Pagelea workspace/);
  assert.match(html, /Local processing/);
  assert.match(html, /How it works/i);
});

test("server-renders the dedicated visual PDF editor", async () => {
  const response = await render("/tools/pdf-editor");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>PDF Editor · Pagelea<\/title>/i);
  assert.match(html, /Rewrite native or scanned PDF text\./);
  assert.match(
    html,
    /Pagelea detects native text and Private Rewrite can recognize English or Italian scans locally\./,
  );
  assert.match(html, /Local only/);
  assert.match(html, /Start blank/);
  assert.doesNotMatch(html, /Pagelea workspace/);
  assert.doesNotMatch(html, /How it works/i);
  assert.doesNotMatch(html, /Related tools/i);
  assert.doesNotMatch(html, /aria-label="Primary navigation"/i);
  assert.match(html, /aria-label="Pagelea home"/i);
});

test("does not render hidden demo routes and ships no starter preview", async () => {
  const packageJson = await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  for (const slug of [
    "watermark-pdf",
    "ocr-pdf",
    "extract-pdf-pages",
    "not-a-pagelea-tool",
  ]) {
    const response = await render(`/tools/${slug}`);
    assert.equal(response.status, 404, slug);
    const html = await response.text();
    assert.doesNotMatch(html, /Pagelea workspace|demo result/i, slug);
  }

  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
  await access(new URL("public/og.png", projectRoot));
  await access(new URL("public/favicon.png", projectRoot));
  await access(new URL("public/licenses/pako-LICENSE.txt", projectRoot));
  await access(
    new URL("../dist/client/licenses/pako-LICENSE.txt", import.meta.url),
  );
  await access(new URL("public/pdf.worker.min.mjs", projectRoot));
});

test("does not publish retired informational filler routes", async () => {
  for (const slug of ["status", "education", "developers", "blog"]) {
    const response = await render(`/${slug}`);
    assert.equal(response.status, 404, slug);
  }
});
