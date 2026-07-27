import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";
import { PDFDocument, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PROJECT_ROOT = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const exportSourceUrl = new URL(
  "../app/lib/pdf-editor-export.ts",
  import.meta.url,
);
const bundledExport = await build({
  entryPoints: [exportSourceUrl.pathname],
  bundle: true,
  external: ["pdfjs-dist"],
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const editorExport = await import(
  `data:text/javascript;base64,${Buffer.from(
    bundledExport.outputFiles[0].contents,
  ).toString("base64")}`,
);

const pageModel = {
  id: "page-1",
  sourcePageIndex: null,
  sourceWidth: 720,
  sourceHeight: 420,
  sourceRotation: 0,
  rotation: 0,
};

function textElement(
  id,
  text,
  {
    direction = "ltr",
    family = "Noto Sans",
    y = 0.1,
  } = {},
) {
  return {
    id,
    pageId: pageModel.id,
    type: "text",
    x: 0.08,
    y,
    width: 0.84,
    height: 0.16,
    opacity: 1,
    text,
    fontSize: 22,
    fontFamily: family,
    direction,
    color: "#142019",
    bold: false,
    italic: false,
  };
}

function createFontLoader(requestedAssets) {
  return async (asset) => {
    requestedAssets.push(asset.id);
    return readFile(
      join(PROJECT_ROOT, "public", asset.path.replace(/^\//, "")),
    );
  };
}

async function extractText(bytes) {
  const task = getDocument({
    data: bytes.slice(),
    verbosity: 0,
  });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items
      .filter((item) => "str" in item)
      .map((item) => item.str)
      .join("");
  } finally {
    await task.destroy();
  }
}

test("editor export writes searchable LGC, Japanese, Hebrew, and Arabic Unicode text", async () => {
  const latinGreekCyrillic =
    "Caffè già pronto · Ελληνικά · Русский";
  const japanese = "Pagelea、日本語テキスト。１２３！";
  const hebrew = "שלום עולם";
  const arabic = "مرحبا بالعالم";
  const requestedAssets = [];
  const result = await editorExport.exportEditedPdf({
    sourceBytes: null,
    pages: [pageModel],
    elements: [
      textElement("lgc", latinGreekCyrillic, { y: 0.12 }),
      textElement("jp", japanese, { y: 0.4 }),
      textElement("hebrew", hebrew, {
        direction: "rtl",
        y: 0.62,
      }),
      textElement("arabic", arabic, {
        direction: "rtl",
        y: 0.8,
      }),
    ],
    filename: "unicode.pdf",
    fontAssetLoader: createFontLoader(requestedAssets),
  });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const extracted = await extractText(bytes);

  assert.match(extracted, /Caffè già pronto/);
  assert.match(extracted, /Ελληνικά/);
  assert.match(extracted, /Русский/);
  assert.match(extracted, /Pagelea、日本語テキスト。１２３！/);
  assert.match(extracted, /שלום עולם/);
  assert.match(extracted, /مرحبا بالعالم/);
  assert.deepEqual(new Set(requestedAssets), new Set([
    "noto-sans-regular",
    "noto-sans-jp-variable-regular",
    "noto-sans-hebrew-regular",
    "noto-sans-arabic-regular",
  ]));
  assert.ok(
    bytes.byteLength < 500_000,
    "subsetted Unicode export should not contain full multi-megabyte fonts",
  );

  const output = await PDFDocument.load(bytes, {
    updateMetadata: false,
  });
  const resources = output.getPage(0).node.Resources();
  const xObjects = resources?.get(PDFName.of("XObject"));
  assert.equal(
    xObjects && "size" in xObjects ? xObjects.size() : 0,
    0,
    "Unicode text must remain vector text rather than a raster image",
  );
});

test("editor export rejects unvalidated Indic shaping with an exact code point", async () => {
  const requestedAssets = [];
  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: null,
      pages: [pageModel],
      elements: [
        textElement("indic", "नमस्ते"),
      ],
      filename: "unsupported.pdf",
      fontAssetLoader: createFontLoader(requestedAssets),
    }),
    (error) =>
      error instanceof Error &&
      error.name === "PdfEditorFontError" &&
      /U\+0928/.test(error.message),
  );
  assert.deepEqual(
    requestedAssets,
    [],
    "unsupported scripts must fail before any font asset is fetched",
  );
});

test("built-in WinAnsi export does not fetch a custom font", async () => {
  const requestedAssets = [];
  const result = await editorExport.exportEditedPdf({
    sourceBytes: null,
    pages: [pageModel],
    elements: [
      textElement("standard", "Simple PDF text", {
        family: "Helvetica",
      }),
    ],
    filename: "standard.pdf",
    fontAssetLoader: createFontLoader(requestedAssets),
  });

  assert.deepEqual(requestedAssets, []);
  assert.equal(
    await extractText(
      new Uint8Array(await result.blob.arrayBuffer()),
    ),
    "Simple PDF text",
  );
});
