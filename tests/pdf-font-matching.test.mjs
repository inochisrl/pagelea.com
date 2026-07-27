import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";

const sourceUrl = new URL(
  "../app/lib/pdf-font-matching.ts",
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

function fragment(overrides = {}) {
  return {
    fontName: "g_d0_f1",
    fontFamily: "sans-serif",
    resolvedFontName: undefined,
    bold: false,
    italic: false,
    ...overrides,
  };
}

test("normalizes PDF subset and PostScript font names", () => {
  assert.equal(
    fonts.normalizePdfFontName("ABCDEF+TimesNewRomanPSMT"),
    "times new roman",
  );
  assert.equal(
    fonts.normalizePdfFontName("NotoSans-SemiCondensedBoldItalic"),
    "noto sans semi condensed bold italic",
  );
});

test("retains exact PDF base-font aliases", () => {
  assert.deepEqual(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "ABCDEF+Helvetica-BoldOblique" }),
    ),
    {
      bold: true,
      confidence: "exact",
      family: "Helvetica",
      italic: true,
      sourceName: "Helvetica-BoldOblique",
    },
  );
  assert.equal(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "TimesNewRomanPSMT" }),
    ).family,
    "Times",
  );
  assert.equal(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "CourierNewPS-BoldMT" }),
    ).family,
    "Courier",
  );
});

test("maps non-base serif, mono, sans and condensed families to local Noto", () => {
  assert.equal(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "Garamond-Italic" }),
    ).family,
    "Noto Serif",
  );
  assert.equal(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "Inconsolata-SemiBold" }),
    ).family,
    "Noto Sans Mono",
  );
  assert.equal(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "Roboto-Regular" }),
    ).family,
    "Noto Sans",
  );
  assert.equal(
    fonts.matchExtractedPdfFont(
      fragment({ resolvedFontName: "ArialNarrow-BoldItalic" }),
    ).family,
    "Noto Sans Condensed",
  );
});

test("uses a generic local Unicode font for unknown source names", () => {
  const result = fonts.matchExtractedPdfFont(
    fragment({
      fontName: "g_d0_f99",
      fontFamily: "sans-serif",
    }),
  );
  assert.equal(result.family, "Noto Sans");
  assert.equal(result.confidence, "generic");
});

test("preview stacks include the reviewed Symbols 2 export fallback", () => {
  for (const family of [
    "Helvetica",
    "Times",
    "Courier",
    "Noto Sans",
    "Noto Serif",
    "Noto Sans Mono",
    "Noto Sans Condensed",
  ]) {
    assert.match(
      fonts.editorFontCss(family),
      /"Pagelea Noto Symbols 2"/,
    );
  }
});

test("preview puts the reviewed RTL shaping font before system faces", () => {
  assert.match(
    fonts.editorFontCss("Helvetica", "مرحبا"),
    /^"Pagelea Noto Arabic", Helvetica/,
  );
  assert.match(
    fonts.editorFontCss("Times", "שלום"),
    /^"Pagelea Noto Hebrew", "Times New Roman"/,
  );
});

test("infers reading direction from PDF metadata or Unicode script", () => {
  assert.equal(fonts.inferTextDirection("Hello"), "ltr");
  assert.equal(fonts.inferTextDirection("שלום"), "rtl");
  assert.equal(fonts.inferTextDirection("مرحبا"), "rtl");
  assert.equal(fonts.inferTextDirection("שלום", "ltr"), "ltr");
});
