import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { build } from "esbuild";

const bundledViewport = await build({
  entryPoints: [
    new URL("../app/lib/pdf-editor-viewport.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const viewport = await import(
  `data:text/javascript;base64,${Buffer.from(
    bundledViewport.outputFiles[0].contents,
  ).toString("base64")}`,
);

const a4 = {
  pageHeight: 841.89,
  pageWidth: 595.28,
};

function fit(options) {
  return viewport.computeEditorFitZoom({
    ...a4,
    horizontalPadding: 48,
    mode: "page",
    verticalPadding: 48,
    ...options,
  });
}

test("fits a complete A4 page inside desktop and mobile canvas bounds", () => {
  const desktop = fit({
    viewportHeight: 720,
    viewportWidth: 900,
  });
  const mobile = fit({
    horizontalPadding: 28,
    verticalPadding: 28,
    viewportHeight: 620,
    viewportWidth: 390,
  });

  assert.ok(desktop > 0.6 && desktop < 0.7, desktop);
  assert.ok(mobile > 0.49 && mobile < 0.51, mobile);
});

test("fit page remains valid in a short mobile landscape viewport", () => {
  const landscape = fit({
    horizontalPadding: 28,
    verticalPadding: 28,
    viewportHeight: 240,
    viewportWidth: 844,
  });

  assert.ok(landscape > 0.2 && landscape < 0.22, landscape);
});

test("fit width uses available width and custom bounds are respected", () => {
  const width = fit({
    mode: "width",
    viewportHeight: 300,
    viewportWidth: 844,
  });
  const maximum = fit({
    maximumZoom: 0.5,
    mode: "width",
    viewportHeight: 1200,
    viewportWidth: 1800,
  });

  assert.equal(width, (844 - 48) / 720);
  assert.equal(maximum, 0.5);
});

test("invalid geometry fails safely to the configured minimum", () => {
  assert.equal(
    fit({
      minimumZoom: 0.08,
      viewportHeight: 0,
      viewportWidth: Number.NaN,
    }),
    0.08,
  );
});
