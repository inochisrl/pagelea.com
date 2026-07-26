import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const sourceUrl = new URL(
  "../app/lib/pdf-text-extraction.ts",
  import.meta.url,
);
const bundledExtraction = await build({
  entryPoints: [sourceUrl.pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const extraction = await import(
  `data:text/javascript;base64,${Buffer.from(
    bundledExtraction.outputFiles[0].contents,
  ).toString("base64")}`,
);

const textContent = {
  items: [
    {
      type: "beginMarkedContentProps",
      id: "paragraph-1",
    },
    {
      str: "Hello",
      dir: "ltr",
      transform: [10, 0, 0, 10, 100, 700],
      width: 100,
      height: 10,
      fontName: "g_d0_f1",
      hasEOL: true,
    },
    {
      type: "endMarkedContent",
      id: "",
    },
  ],
  styles: {
    g_d0_f1: {
      ascent: 0.8,
      descent: -0.2,
      vertical: false,
      fontFamily: "Helvetica",
      color: [0.2, 0.4, 0.6],
    },
  },
  lang: "en",
};

function viewport(rotation) {
  switch (rotation) {
    case 90:
      return {
        width: 800,
        height: 600,
        transform: [0, 1, 1, 0, 0, 0],
      };
    case 180:
      return {
        width: 600,
        height: 800,
        transform: [-1, 0, 0, 1, 600, 0],
      };
    case 270:
      return {
        width: 800,
        height: 600,
        transform: [0, -1, -1, 0, 800, 600],
      };
    default:
      return {
        width: 600,
        height: 800,
        transform: [1, 0, 0, -1, 0, 800],
      };
  }
}

test("maps PDF.js text to normalized top-left geometry", () => {
  const page = extraction.mapPdfTextContent(
    textContent,
    viewport(0),
    {
      pageIndex: 0,
      sourceRotation: 0,
      rotation: 0,
      documentId: "fixture",
    },
  );
  const [fragment] = page.fragments;

  assert.equal(page.language, "en");
  assert.equal(fragment.text, "Hello");
  assert.equal(fragment.fontName, "g_d0_f1");
  assert.equal(fragment.fontFamily, "Helvetica");
  assert.equal(fragment.bold, false);
  assert.equal(fragment.italic, false);
  assert.equal(fragment.fontSize, 10);
  assert.equal(fragment.color, "#336699");
  assert.equal(fragment.rotation, 0);
  assert.deepEqual(fragment.markedContentIds, ["paragraph-1"]);
  assert.equal(fragment.x, 100 / 600);
  assert.equal(fragment.y, 92 / 800);
  assert.equal(fragment.width, 100 / 600);
  assert.equal(fragment.height, 10 / 800);
  assert.deepEqual(fragment.baseline, {
    start: { x: 100 / 600, y: 100 / 800 },
    end: { x: 200 / 600, y: 100 / 800 },
  });
});

test("keeps IDs stable while mapping all page quarter turns", () => {
  const expected = [
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
  ];
  const mapped = expected.map(([rotation]) =>
    extraction.mapPdfTextContent(
      textContent,
      viewport(rotation),
      {
        pageIndex: 0,
        sourceRotation: 0,
        rotation,
        documentId: "fixture",
      },
    ),
  );

  assert.deepEqual(
    mapped.map((page) => page.fragments[0].rotation),
    expected.map(([, textRotation]) => textRotation),
  );
  assert.equal(new Set(mapped.map((page) => page.fragments[0].id)).size, 1);

  const rotated = mapped[1].fragments[0];
  assert.equal(rotated.x, 698 / 800);
  assert.equal(rotated.y, 100 / 600);
  assert.equal(rotated.width, 10 / 800);
  assert.equal(rotated.height, 100 / 600);
});

test("skips marked-content records and preserves nested IDs", () => {
  const nestedContent = {
    ...textContent,
    items: [
      { type: "beginMarkedContent", id: "outer" },
      { type: "beginMarkedContentProps", id: "inner" },
      textContent.items[1],
      { type: "endMarkedContent", id: "" },
      { type: "endMarkedContent", id: "" },
    ],
  };
  const page = extraction.mapPdfTextContent(
    nestedContent,
    viewport(0),
    {
      pageIndex: 2,
      documentId: "fixture",
    },
  );

  assert.equal(page.fragments.length, 1);
  assert.equal(page.fragments[0].itemIndex, 2);
  assert.deepEqual(page.fragments[0].markedContentIds, [
    "outer",
    "inner",
  ]);
});

test("rejects oversized text content before mapping fragments", () => {
  const tooManyItems = {
    items: Array.from({ length: 10_001 }, () => ({
      type: "beginMarkedContent",
      id: "nested",
    })),
    styles: {},
    lang: null,
  };
  assert.throws(
    () =>
      extraction.mapPdfTextContent(
        tooManyItems,
        viewport(0),
        { pageIndex: 0 },
      ),
    { name: "PdfSecurityLimitError" },
  );

  const tooManyCharacters = {
    items: [
      {
        ...textContent.items[1],
        str: "a".repeat(500_001),
      },
    ],
    styles: textContent.styles,
    lang: null,
  };
  assert.throws(
    () =>
      extraction.mapPdfTextContent(
        tooManyCharacters,
        viewport(0),
        { pageIndex: 0 },
      ),
    { name: "PdfSecurityLimitError" },
  );
});

test("cancels streamed extraction as soon as the item budget is exceeded", async () => {
  let cancelled = false;
  let chunksRequested = 0;
  const repeatedItem = textContent.items[1];
  const page = {
    pageNumber: 1,
    rotate: 0,
    getViewport: () => viewport(0),
    streamTextContent() {
      return new globalThis.ReadableStream({
        pull(controller) {
          chunksRequested += 1;
          controller.enqueue({
            items: Array(6_000).fill(repeatedItem),
            styles: textContent.styles,
            lang: "en",
          });
        },
        cancel() {
          cancelled = true;
        },
      });
    },
  };

  await assert.rejects(
    extraction.extractPdfPageText(page, { pageIndex: 0 }),
    { name: "PdfSecurityLimitError" },
  );
  assert.equal(cancelled, true);
  assert.ok(chunksRequested <= 3);
});

test("stops consuming requested page iterables at the document page budget", async () => {
  let yielded = 0;
  const requestedPages = {
    *[Symbol.iterator]() {
      for (let pageIndex = 0; pageIndex < 1_000; pageIndex += 1) {
        yielded += 1;
        yield pageIndex;
      }
    },
  };
  const document = {
    fingerprints: [],
    getPage() {
      throw new Error("page loading must not start");
    },
    numPages: 1_000,
  };

  await assert.rejects(
    extraction.extractPdfText(document, {
      pageIndexes: requestedPages,
    }),
    { name: "PdfSecurityLimitError" },
  );
  assert.equal(yielded, 501);
});

test("duplicate-only page iterables cannot run without a consumption bound", async () => {
  let yielded = 0;
  const requestedPages = {
    *[Symbol.iterator]() {
      for (let index = 0; index < 1_000; index += 1) {
        yielded += 1;
        yield 0;
      }
    },
  };
  const document = {
    fingerprints: [],
    getPage() {
      throw new Error("page loading must not start");
    },
    numPages: 1,
  };

  await assert.rejects(
    extraction.extractPdfText(document, {
      pageIndexes: requestedPages,
    }),
    { name: "PdfSecurityLimitError" },
  );
  assert.equal(yielded, 501);
});

test("extracts selected document pages and resolves rotations", async () => {
  const requestedPages = [];
  const document = {
    numPages: 3,
    fingerprints: ["fingerprint-1", null],
    async getPage(pageNumber) {
      requestedPages.push(pageNumber);
      return {
        pageNumber,
        rotate: pageNumber === 2 ? 90 : 0,
        getViewport({ rotation }) {
          return viewport(rotation);
        },
        async getTextContent(parameters) {
          assert.equal(parameters.includeMarkedContent, true);
          return textContent;
        },
      };
    },
  };

  const result = await extraction.extractPdfText(document, {
    pageIndexes: [1, 1, 2],
    rotation: (_pageIndex, sourceRotation) =>
      sourceRotation + 90,
  });

  assert.deepEqual(requestedPages, [2, 3]);
  assert.equal(result.documentId, "fingerprint-1");
  assert.equal(result.pageCount, 3);
  assert.deepEqual(
    result.pages.map((page) => page.pageIndex),
    [1, 2],
  );
  assert.deepEqual(
    result.pages.map((page) => page.rotation),
    [180, 90],
  );
});

test("retains XFA-like text items that do not expose geometry", () => {
  const page = extraction.mapPdfTextContent(
    {
      items: [{ str: "XFA text" }],
      styles: {},
      lang: null,
    },
    viewport(0),
    {
      pageIndex: 0,
      documentId: "fixture",
    },
  );
  const [fragment] = page.fragments;

  assert.equal(fragment.text, "XFA text");
  assert.equal(fragment.hasGeometry, false);
  assert.equal(fragment.baseline, null);
  assert.equal(fragment.rotation, null);
});

test("extracts editable geometry from a real generated PDF", async () => {
  const sourcePdf = await PDFDocument.create();
  const page = sourcePdf.addPage([600, 800]);
  const font = await sourcePdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Pagelea editable text", {
    x: 72,
    y: 700,
    size: 18,
    font,
  });

  const loadingTask = getDocument({
    data: await sourcePdf.save(),
    verbosity: 0,
  });
  const document = await loadingTask.promise;

  try {
    const result = await extraction.extractPdfText(document);
    const fragment = result.pages[0].fragments.find((item) =>
      item.text.includes("Pagelea editable text"),
    );

    assert.ok(fragment);
    assert.equal(fragment.hasGeometry, true);
    assert.equal(fragment.rotation, 0);
    assert.ok(Math.abs(fragment.fontSize - 18) < 0.01);
    assert.ok(fragment.x > 0.1 && fragment.x < 0.13);
    assert.ok(fragment.y > 0.09 && fragment.y < 0.13);
    assert.ok(fragment.width > 0.2);
  } finally {
    await loadingTask.destroy();
  }
});

test("extracts bold and italic style from a resolved PDF.js font", async () => {
  const sourcePdf = await PDFDocument.create();
  const page = sourcePdf.addPage([300, 200]);
  const font = await sourcePdf.embedFont(
    StandardFonts.HelveticaBoldOblique,
  );
  page.drawText("Styled text", {
    x: 30,
    y: 120,
    size: 20,
    font,
  });

  const loadingTask = getDocument({
    data: await sourcePdf.save(),
    verbosity: 0,
  });
  const document = await loadingTask.promise;

  try {
    const result = await extraction.extractPdfText(document);
    const fragment = result.pages[0].fragments.find((item) =>
      item.text.includes("Styled text"),
    );

    assert.ok(fragment);
    assert.equal(fragment.bold, true);
    assert.equal(fragment.italic, true);
    assert.equal(fragment.resolvedFontName, "Helvetica-BoldOblique");
  } finally {
    await loadingTask.destroy();
  }
});
