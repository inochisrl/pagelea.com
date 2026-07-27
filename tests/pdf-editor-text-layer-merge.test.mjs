import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({
  stdin: {
    contents:
      'export { mergeExtractedTextPageSources } from "./app/components/PdfEditorWorkspace.tsx";',
    resolveDir: projectRoot,
    sourcefile: "workspace-text-layer-entry.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "ignore-workspace-css",
      setup(buildContext) {
        buildContext.onLoad({ filter: /\.css$/ }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    },
  ],
});
const bundledJavaScript =
  bundled.outputFiles.find((file) => file.path.endsWith(".js")) ??
  bundled.outputFiles[0];
const moduleUrl =
  "data:text/javascript;base64," +
  Buffer.from(bundledJavaScript.contents).toString("base64");
const { mergeExtractedTextPageSources } = await import(moduleUrl);

const pageMetadata = {
  pageIndex: 0,
  pageNumber: 1,
  width: 612,
  height: 792,
  sourceRotation: 0,
  rotation: 0,
  language: null,
};

function fragment(id, origin, y) {
  return {
    id,
    origin,
    x: 0.1,
    y,
    width: 0.4,
    height: 0.05,
  };
}

function page(fragments, language = null) {
  return {
    ...pageMetadata,
    language,
    fragments,
  };
}

test("native extraction and OCR merge identically in either completion order", () => {
  const nativeFragment = fragment("native-1", "native", 0.2);
  const overlappingOcr = fragment("ocr-overlap", "ocr", 0.2);
  const scannedOcr = fragment("ocr-scanned", "ocr", 0.6);
  const nativePage = page([nativeFragment]);
  const ocrPage = page(
    [overlappingOcr, scannedOcr],
    "eng+ita",
  );

  const ocrFirst = mergeExtractedTextPageSources(
    nativePage,
    mergeExtractedTextPageSources(null, ocrPage),
  );
  const nativeFirst = mergeExtractedTextPageSources(
    mergeExtractedTextPageSources(nativePage, null),
    ocrPage,
  );

  assert.deepEqual(ocrFirst, nativeFirst);
  assert.equal(ocrFirst.language, "eng+ita");
  assert.deepEqual(
    ocrFirst.fragments.map(({ id, origin }) => ({ id, origin })),
    [
      { id: "native-1", origin: "native" },
      { id: "ocr-scanned", origin: "ocr" },
    ],
  );
});

test("merged retries replace stale sources and never duplicate fragments", () => {
  const nativeFragment = fragment("native-1", "native", 0.2);
  const staleOcr = fragment("ocr-stale", "ocr", 0.5);
  const freshOcr = fragment("ocr-fresh", "ocr", 0.7);
  const cachedPage = page(
    [nativeFragment, nativeFragment, staleOcr],
    "eng",
  );

  const merged = mergeExtractedTextPageSources(
    cachedPage,
    page([nativeFragment, freshOcr, freshOcr], "ita"),
  );

  assert.equal(merged.language, "ita");
  assert.deepEqual(
    merged.fragments.map((item) => item.id),
    ["native-1", "ocr-fresh"],
  );
  assert.deepEqual(
    merged.fragments.map((item) => item.origin),
    ["native", "ocr"],
  );
});
