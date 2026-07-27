import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const sourceUrl = new URL(
  "../app/lib/pdf-editor-fonts.ts",
  import.meta.url,
);
const bundled = await build({
  entryPoints: [sourceUrl.pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const fonts = await import(
  `data:text/javascript;base64,${Buffer.from(
    bundled.outputFiles[0].contents,
  ).toString("base64")}`,
);

const TTF_HEADER = Uint8Array.of(0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0);

function assetPath(asset) {
  return new URL(`../public${asset.path}`, import.meta.url);
}

async function localAssetLoader(asset) {
  return readFile(assetPath(asset));
}

function fontError(error, code, codePoint) {
  assert.equal(error?.name, "PdfEditorFontError");
  assert.equal(error?.code, code);
  if (codePoint !== undefined) {
    assert.equal(error?.codePoint, codePoint);
    const formattedCodePoint = codePoint
      .toString(16)
      .padStart(4, "0");
    assert.match(error.message, new RegExp(`U\\+${formattedCodePoint}`, "i"));
  }
  return true;
}

async function extractText(pdfBytes) {
  const loadingTask = getDocument({
    // PDF.js transfers the supplied buffer to its worker and may detach it.
    data: pdfBytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items
      .filter((item) => typeof item.str === "string")
      .map((item) => item.str)
      .join("");
  } finally {
    await loadingTask.destroy();
  }
}

async function createTextPdf(text, selection = {}) {
  const document = await PDFDocument.create();
  const embedder = fonts.createPdfEditorFontEmbedder(document, {
    loadAsset: localAssetLoader,
  });
  const page = document.addPage([842, 220]);
  const runs = fonts.planPdfEditorFontRuns(text, selection);
  let x = 42;

  for (const run of runs) {
    const font = await embedder.embedRun(run);
    page.drawText(run.text, { x, y: 92, size: 34, font });
    x += font.widthOfTextAtSize(run.text, 34);
  }

  return {
    bytes: await document.save(),
    runs,
  };
}

test("publishes a frozen, bounded allowlist at the deployed font paths", async () => {
  assert.equal(Object.isFrozen(fonts.PDF_EDITOR_FONT_ASSETS), true);
  assert.equal(fonts.PDF_EDITOR_FONT_ASSETS.length, 21);

  const ids = new Set();
  const paths = new Set();
  for (const asset of fonts.PDF_EDITOR_FONT_ASSETS) {
    assert.equal(Object.isFrozen(asset), true);
    assert.equal(Object.isFrozen(asset.roles), true);
    assert.match(asset.path, /^\/private-rewrite\/fonts\/[^/]+$/);
    assert.equal(ids.has(asset.id), false);
    if (paths.has(asset.path)) {
      assert.equal(
        asset.path,
        "/private-rewrite/fonts/NotoSansJP[wght].ttf",
        "only the reviewed JP variable font may back two logical weights",
      );
    }
    ids.add(asset.id);
    paths.add(asset.path);

    const details = await stat(assetPath(asset));
    assert.equal(details.isFile(), true);
    assert.ok(details.size > 0);
    assert.ok(details.size <= asset.maxBytes);
  }

  const fullFontAssets = fonts.PDF_EDITOR_FONT_ASSETS.filter(
    (asset) => !asset.subset,
  );
  assert.deepEqual(
    fullFontAssets.map((asset) => asset.id),
    ["noto-sans-symbols2-regular"],
    "Symbols2 stays full because its pdf-lib subset loses rendered outlines",
  );
  assert.equal(
    fonts.PDF_EDITOR_FONT_ASSETS.some((asset) =>
      /Devanagari|Bengali|Tamil|Thai/.test(asset.family),
    ),
    false,
  );
});

test("selects requested family variants and reports style fallbacks", () => {
  assert.equal(
    fonts.resolvePdfEditorFont("primary", {
      family: "Helvetica",
      italic: true,
    }).asset.id,
    "noto-sans-italic",
  );
  assert.equal(
    fonts.resolvePdfEditorFont("primary", {
      family: "Times",
      bold: true,
      italic: true,
    }).asset.id,
    "noto-serif-bold-italic",
  );
  assert.equal(
    fonts.resolvePdfEditorFont("primary", {
      family: "Noto Sans Condensed",
      bold: true,
    }).asset.id,
    "noto-sans-condensed-bold",
  );

  const monoItalic = fonts.resolvePdfEditorFont("primary", {
    family: "Courier",
    italic: true,
  });
  assert.equal(monoItalic.asset.id, "noto-sans-mono-regular");
  assert.equal(monoItalic.syntheticItalic, true);

  const cjkBoldItalic = fonts.resolvePdfEditorFont("cjk-jp", {
    bold: true,
    italic: true,
  });
  assert.equal(cjkBoldItalic.asset.id, "noto-sans-jp-variable-bold");
  assert.equal(cjkBoldItalic.syntheticItalic, true);

  const boldSymbols = fonts.resolvePdfEditorFont("symbols", { bold: true });
  assert.equal(boldSymbols.asset.id, "noto-sans-symbols2-regular");
  assert.equal(boldSymbols.syntheticBold, true);
});

test("plans NFC-normalized Unicode runs without hiding fallbacks", () => {
  const normalized = fonts.planPdfEditorFontRuns("Cafe\u0301", {
    family: "Noto Sans",
  });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].text, "Café");

  const mixed = fonts.planPdfEditorFontRuns("Hello ✓ 世界", {
    family: "Noto Serif",
    bold: true,
  });
  assert.deepEqual(
    mixed.map((run) => [run.asset.id, run.text, run.direction]),
    [
      ["noto-serif-bold", "Hello ", "ltr"],
      ["noto-sans-symbols2-regular", "✓", "ltr"],
      ["noto-serif-bold", " ", "ltr"],
      ["noto-sans-jp-variable-bold", "世界", "ltr"],
    ],
  );

  const japanese = fonts.planPdfEditorFontRuns("日本語 123");
  assert.equal(japanese.length, 1);
  assert.equal(japanese[0].asset.id, "noto-sans-jp-variable-regular");

  const mixedJapanese = fonts.planPdfEditorFontRuns(
    "Pagelea、日本語。１２３！",
  );
  assert.deepEqual(
    mixedJapanese.map((run) => [run.asset.id, run.text]),
    [
      ["noto-sans-regular", "Pagelea"],
      [
        "noto-sans-jp-variable-regular",
        "、日本語。１２３！",
      ],
    ],
    "CJK punctuation and fullwidth forms must follow the Japanese run",
  );

  const hebrew = fonts.planPdfEditorFontRuns("שלום עולם");
  assert.equal(hebrew.length, 1);
  assert.equal(hebrew[0].asset.id, "noto-sans-hebrew-regular");
  assert.equal(hebrew[0].direction, "rtl");

  const arabic = fonts.planPdfEditorFontRuns("مرحبا بالعالم");
  assert.equal(arabic.length, 1);
  assert.equal(arabic[0].asset.id, "noto-sans-arabic-regular");
  assert.equal(arabic[0].direction, "rtl");

  const inheritedMark = fonts.planPdfEditorFontRuns("A 世\u3099");
  assert.deepEqual(
    inheritedMark.map((run) => [run.asset.id, run.text]),
    [
      ["noto-sans-regular", "A "],
      ["noto-sans-jp-variable-regular", "世\u3099"],
    ],
    "an inherited combining mark must remain with its preceding scalar",
  );
});

test("bounds adversarial script switching before font embedding", () => {
  const alternatingScripts = "A世".repeat(2_049);

  assert.throws(
    () => fonts.planPdfEditorFontRuns(alternatingScripts),
    (error) =>
      fontError(error, "too-many-font-runs") &&
      /2048 font runs/i.test(error.message),
  );
});

test("rejects unvalidated shaping, bidi mixtures, marks, Hangul, and emoji diagnostically", () => {
  assert.throws(
    () => fonts.assertSupportedText("مَرْحَبًا"),
    (error) => fontError(error, "unsupported-script", 0x64e),
  );
  assert.throws(
    () => fonts.assertSupportedText("שָׁלוֹם"),
    (error) => fontError(error, "unsupported-script", 0x5b8),
  );
  assert.throws(
    () => fonts.assertSupportedText("مرحبا 123"),
    (error) => fontError(error, "unsupported-script", 0x31),
  );
  assert.throws(
    () => fonts.assertSupportedText("नमस्ते"),
    (error) => fontError(error, "unsupported-script", 0x928),
  );
  assert.throws(
    () => fonts.assertSupportedText("한글"),
    (error) => fontError(error, "unsupported-script", 0xd55c),
  );
  assert.throws(
    () => fonts.assertSupportedText("שלום 123"),
    (error) => fontError(error, "unsupported-script", 0x31),
  );
  assert.throws(
    () => fonts.assertSupportedText("🧑"),
    (error) => fontError(error, "unsupported-glyph", 0x1f9d1),
  );
  assert.throws(
    () => fonts.assertSupportedText("\ud800"),
    (error) => fontError(error, "unsupported-glyph", 0xd800),
  );
});

test("custom loaders are bounded, validate signatures, cache success, and retry failure", async () => {
  let calls = 0;
  const cachedLoader = fonts.createPdfEditorFontLoader({
    async loadAsset() {
      calls += 1;
      return TTF_HEADER;
    },
  });
  const first = cachedLoader.load("noto-sans-regular");
  const second = cachedLoader.load("noto-sans-regular");
  assert.equal(first, second);
  assert.deepEqual(await first, TTF_HEADER);
  assert.equal(calls, 1);

  let resolveSignalledLoad;
  let signalledCalls = 0;
  const signalledLoader = fonts.createPdfEditorFontLoader({
    loadAsset() {
      signalledCalls += 1;
      return new Promise((resolve) => {
        resolveSignalledLoad = resolve;
      });
    },
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const cancelledLoad = signalledLoader.load(
    "noto-sans-italic",
    firstController.signal,
  );
  const survivingLoad = signalledLoader.load(
    "noto-sans-italic",
    secondController.signal,
  );
  firstController.abort();
  await assert.rejects(
    cancelledLoad,
    (error) => error instanceof Error && error.name === "AbortError",
  );
  resolveSignalledLoad(TTF_HEADER);
  assert.deepEqual(await survivingLoad, TTF_HEADER);
  assert.equal(
    signalledCalls,
    1,
    "caller cancellation must not duplicate or cancel the shared bounded load",
  );

  let sharedCalls = 0;
  const sharedSource = async () => {
    sharedCalls += 1;
    return TTF_HEADER;
  };
  const sharedLoaderA = fonts.createPdfEditorFontLoader({
    loadAsset: sharedSource,
  });
  const sharedLoaderB = fonts.createPdfEditorFontLoader({
    loadAsset: sharedSource,
  });
  await Promise.all([
    sharedLoaderA.load("noto-sans-bold"),
    sharedLoaderB.load("noto-sans-bold"),
  ]);
  assert.equal(sharedCalls, 1, "font bytes are shared across export instances");

  let attempts = 0;
  const retryingLoader = fonts.createPdfEditorFontLoader({
    async loadAsset() {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return TTF_HEADER;
    },
  });
  await assert.rejects(
    retryingLoader.load("noto-serif-regular"),
    (error) => fontError(error, "font-asset-fetch"),
  );
  await retryingLoader.load("noto-serif-regular");
  assert.equal(attempts, 2);

  const invalidLoader = fonts.createPdfEditorFontLoader({
    async loadAsset() {
      return Uint8Array.of(0x50, 0x44, 0x46, 0x2d);
    },
  });
  await assert.rejects(
    invalidLoader.load("noto-sans-bold"),
    (error) => fontError(error, "font-asset-invalid"),
  );

  const oversizedLoader = fonts.createPdfEditorFontLoader({
    async loadAsset(asset) {
      return new Uint8Array(asset.maxBytes + 1);
    },
  });
  await assert.rejects(
    oversizedLoader.load("noto-sans-italic"),
    (error) => fontError(error, "font-asset-too-large"),
  );
});

test("default loading is same-origin, redirect-safe, cached, and streaming-bounded", async () => {
  let calls = 0;
  const loader = fonts.createPdfEditorFontLoader({
    origin: "https://pagelea.test/app",
    async fetchImpl(url, init) {
      calls += 1;
      assert.equal(url.href, "https://pagelea.test/private-rewrite/fonts/NotoSans-Regular.ttf");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.redirect, "error");
      return new Response(TTF_HEADER, {
        headers: { "content-length": String(TTF_HEADER.byteLength) },
      });
    },
  });
  await Promise.all([
    loader.load("noto-sans-regular"),
    loader.load("noto-sans-regular"),
  ]);
  assert.equal(calls, 1);

  const crossOriginRedirect = fonts.createPdfEditorFontLoader({
    origin: "https://pagelea.test",
    async fetchImpl() {
      return {
        ok: true,
        status: 200,
        url: "https://cdn.invalid/NotoSans-Regular.ttf",
        headers: new Headers(),
        body: null,
        async arrayBuffer() {
          return TTF_HEADER.buffer;
        },
      };
    },
  });
  await assert.rejects(
    crossOriginRedirect.load("noto-sans-regular"),
    (error) => fontError(error, "font-origin"),
  );

  const streamingOverflow = fonts.createPdfEditorFontLoader({
    origin: "https://pagelea.test",
    async fetchImpl() {
      const asset = fonts.PDF_EDITOR_FONT_ASSETS.find(
        (candidate) => candidate.id === "noto-sans-regular",
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(TTF_HEADER);
            controller.enqueue(new Uint8Array(asset.maxBytes));
            controller.close();
          },
        }),
      );
    },
  });
  await assert.rejects(
    streamingOverflow.load("noto-sans-regular"),
    (error) => fontError(error, "font-asset-too-large"),
  );

  const invalidOrigin = fonts.createPdfEditorFontLoader({
    origin: "data:text/plain,pagelea",
    async fetchImpl() {
      throw new Error("must not fetch");
    },
  });
  assert.throws(
    () => invalidOrigin.load("noto-sans-regular"),
    (error) => fontError(error, "font-origin"),
  );
});

test("embeds one cached subset for Latin, Greek, and Cyrillic with exact extraction", async () => {
  const text = "Pchnąć w tę łódź jeża Ωμέγα Привет";
  let loads = 0;
  const document = await PDFDocument.create();
  const embedder = fonts.createPdfEditorFontEmbedder(document, {
    async loadAsset(asset) {
      loads += 1;
      return localAssetLoader(asset);
    },
  });
  const [run] = fonts.planPdfEditorFontRuns(text, {
    family: "Noto Sans",
  });
  const first = await embedder.embedRun(run);
  const second = await embedder.embedRun(run);
  const controller = new AbortController();
  const signalled = await embedder.embedRun(run, controller.signal);
  assert.equal(first, second);
  assert.equal(first, signalled);
  assert.equal(loads, 1);

  document.addPage([842, 220]).drawText(text, {
    x: 42,
    y: 92,
    size: 30,
    font: first,
  });
  const pdfBytes = await document.save();
  assert.equal(await extractText(pdfBytes), text);
  assert.ok(pdfBytes.byteLength < 25_000);
});

test("keeps pure Hebrew subsetted, visually ordered RTL, and exactly extractable", async () => {
  const text = "שלום עולם";
  const { bytes, runs } = await createTextPdf(text, { bold: true });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].asset.id, "noto-sans-hebrew-bold");
  assert.equal(runs[0].asset.subset, true);
  assert.equal(await extractText(bytes), text);
  assert.ok(bytes.byteLength < 30_000);
});

test("keeps pure Arabic subsetted, shaped RTL, and exactly extractable", async () => {
  const text = "مرحبا بالعالم";
  const { bytes, runs } = await createTextPdf(text, { bold: true });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].asset.id, "noto-sans-arabic-bold");
  assert.equal(runs[0].asset.subset, true);
  assert.equal(await extractText(bytes), text);
  assert.ok(bytes.byteLength < 45_000);
});

test("keeps validated Symbols2 complete so all outlines render and extract", async () => {
  const text = "✓ ★ ☀ ♞ ⌛ ⏳ 🞿 🡆";
  const { bytes, runs } = await createTextPdf(text);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].asset.id, "noto-sans-symbols2-regular");
  assert.equal(runs[0].asset.subset, false);
  assert.equal(await extractText(bytes), text);
  assert.ok(
    bytes.byteLength > 100_000,
    `expected a complete compressed Symbols2 font, got ${bytes.byteLength} bytes`,
  );
  assert.ok(bytes.byteLength < 500_000);
});

test("subsets Japanese and Han text in regular and bold with exact extraction", async () => {
  const text = "日本語 ひらがな カタカナ 中文 123";

  for (const bold of [false, true]) {
    const { bytes, runs } = await createTextPdf(text, { bold });
    assert.equal(runs.length, 1);
    assert.equal(
      runs[0].asset.id,
      `noto-sans-jp-variable-${bold ? "bold" : "regular"}`,
    );
    assert.equal(runs[0].asset.subset, true);
    assert.equal(await extractText(bytes), text);
    assert.ok(bytes.byteLength < 180_000);
  }
});

test("reports the exact missing code point from an embedded font cmap", async () => {
  const document = await PDFDocument.create();
  const embedder = fonts.createPdfEditorFontEmbedder(document, {
    loadAsset: localAssetLoader,
  });

  await assert.rejects(
    embedder.embed("noto-sans-hebrew-regular", "1"),
    (error) => fontError(error, "unsupported-glyph", 0x31),
  );
});
