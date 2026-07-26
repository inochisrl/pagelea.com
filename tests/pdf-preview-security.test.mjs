import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";

const previewSourceUrl = new URL(
  "../app/lib/pdf-preview.ts",
  import.meta.url,
);
const bundledPreview = await build({
  entryPoints: [previewSourceUrl.pathname],
  bundle: true,
  external: ["pdfjs-dist"],
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const preview = await import(
  `data:text/javascript;base64,${Buffer.from(
    bundledPreview.outputFiles[0].contents,
  ).toString("base64")}`,
);

test("aborting a pending PDF load destroys its loading task exactly once", async () => {
  let destroyCalls = 0;
  const loadingTask = {
    promise: new Promise(() => undefined),
    async destroy() {
      destroyCalls += 1;
    },
  };
  const controller = new globalThis.AbortController();
  const pendingLoad = preview.waitForPdfLoadingTask(
    loadingTask,
    controller.signal,
  );

  controller.abort();

  assert.equal(
    destroyCalls,
    1,
    "abort should invoke destroy synchronously",
  );
  await assert.rejects(pendingLoad, { name: "AbortError" });
  assert.equal(destroyCalls, 1);
});

test("a pre-aborted PDF load is never awaited and is destroyed once", async () => {
  let destroyCalls = 0;
  const controller = new globalThis.AbortController();
  controller.abort();

  await assert.rejects(
    preview.waitForPdfLoadingTask(
      {
        promise: new Promise(() => undefined),
        async destroy() {
          destroyCalls += 1;
        },
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(destroyCalls, 1);
});

test("PDF loading task cleanup preserves success and parsing failures", async () => {
  let successDestroyCalls = 0;
  const document = { numPages: 1 };
  assert.equal(
    await preview.waitForPdfLoadingTask({
      promise: Promise.resolve(document),
      async destroy() {
        successDestroyCalls += 1;
      },
    }),
    document,
  );
  assert.equal(successDestroyCalls, 0);

  let failureDestroyCalls = 0;
  const parsingError = new Error("Malformed PDF");
  await assert.rejects(
    preview.waitForPdfLoadingTask({
      promise: Promise.reject(parsingError),
      async destroy() {
        failureDestroyCalls += 1;
      },
    }),
    (error) => error === parsingError,
  );
  assert.equal(failureDestroyCalls, 1);
});

test("PDF.js preview decoding uses the shared pixel and canvas budgets", async () => {
  const source = await readFile(previewSourceUrl, "utf8");

  assert.match(
    source,
    /maxImageSize:\s*PDF_SECURITY_LIMITS\.maxImagePixels/,
  );
  assert.match(
    source,
    /canvasMaxAreaInBytes:\s*PDF_SECURITY_LIMITS\.maxPdfCanvasAreaInBytes/,
  );
  assert.match(source, /getPageCountLimitIssue\(document\.numPages\)/);
  assert.match(source, /await loadingTask\.destroy\(\)/);
});

test("PDF preview rejects oversized bytes before browser-only module loading", async () => {
  await assert.rejects(
    preview.loadPdfPreview({
      byteLength: 100 * 1024 * 1024 + 1,
    }),
    { name: "PdfSecurityLimitError" },
  );
});
