import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";
import { PDFArray, PDFDocument, PDFName } from "pdf-lib";

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

const blankPage = {
  id: "page-1",
  sourcePageIndex: null,
  sourceWidth: 595,
  sourceHeight: 842,
  sourceRotation: 0,
  rotation: 0,
};

async function createDeepPageTreeFixture(depth = 6_000) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 100]);
  let child = page.ref;

  for (let index = 0; index < depth; index += 1) {
    child = document.context.register(
      document.context.obj({
        Type: "Pages",
        Kids: [child],
        Count: 1,
      }),
    );
  }
  document.catalog.set(PDFName.of("Pages"), child);
  return document.save({ useObjectStreams: true });
}

async function createDeepPageGraphFixture(depth = 6_000) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 100]);
  let child = document.context.register(
    document.context.obj({ Value: "leaf" }),
  );
  for (let index = 0; index < depth; index += 1) {
    child = document.context.register(
      document.context.obj({ Child: child }),
    );
  }
  page.node.set(PDFName.of("DeepCarrier"), child);
  return document.save({ useObjectStreams: true });
}

async function createWidePageGraphFixture(width = 100_001) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 100]);
  const resources =
    page.node.Resources() ?? document.context.obj({});
  page.node.set(PDFName.of("Resources"), resources);
  const values = PDFArray.withContext(document.context);
  const scalar = PDFName.of("Scalar");
  for (let index = 0; index < width; index += 1) {
    values.push(scalar);
  }
  resources.set(PDFName.of("Wide"), values);
  return document.save({ useObjectStreams: true });
}

async function createDeepPageReferenceChainFixture(depth = 512) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 100]);
  let child = document.context.register(
    document.context.obj({ Leaf: true }),
  );
  for (let index = 0; index < depth; index += 1) {
    child = document.context.register(child);
  }
  page.node.set(PDFName.of("ArtBox"), child);
  return document.save({ useObjectStreams: true });
}

async function createAlternatingReferenceGraphFixture(
  groups = 4,
  referencesPerGroup = 100,
) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 100]);
  let child = document.context.obj({ Leaf: true });
  for (let group = 0; group < groups; group += 1) {
    let reference = document.context.register(child);
    for (
      let index = 1;
      index < referencesPerGroup;
      index += 1
    ) {
      reference = document.context.register(reference);
    }
    child = document.context.obj({ Child: reference });
  }
  page.node.set(
    PDFName.of("ArtBox"),
    document.context.register(child),
  );
  return document.save({ useObjectStreams: true });
}

async function createContainerAndScalarReferenceFixture(
  containerDepth = 200,
  referenceDepth = 100,
) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 100]);
  let child = document.context.register(PDFName.of("Leaf"));
  for (let index = 1; index < referenceDepth; index += 1) {
    child = document.context.register(child);
  }
  let carrier = document.context.obj({ Child: child });
  for (let index = 1; index < containerDepth; index += 1) {
    carrier = document.context.obj({ Child: carrier });
  }
  page.node.set(PDFName.of("ArtBox"), carrier);
  return document.save({ useObjectStreams: true });
}

async function createPageDictionaryPayloadFixture(pageKey) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([100, 120]);
  page.node.set(
    PDFName.of(pageKey),
    document.context.obj({
      Payload: "private-rewrite-security-fixture",
    }),
  );
  return document.save({ useObjectStreams: true });
}

function dataUrl(mimeType, bytes) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function imageElement(source, pixelCount = 1) {
  return {
    id: "image-1",
    pageId: blankPage.id,
    type: "image",
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
    opacity: 1,
    dataUrl: source,
    pixelCount,
  };
}

function textElement(text, width = 0.05, height = 0.02) {
  return {
    id: "text-1",
    pageId: blankPage.id,
    type: "text",
    x: 0.1,
    y: 0.1,
    width,
    height,
    opacity: 1,
    text,
    fontSize: 18,
    fontFamily: "Helvetica",
    color: "#111111",
    bold: false,
    italic: false,
  };
}

function preparedRun(text, font, direction = "ltr") {
  return {
    direction,
    font,
    syntheticBold: false,
    syntheticItalic: false,
    text,
  };
}

function lineText(line) {
  return line.runs.map((run) => run.text).join("");
}

test("editor export still copies a normal vector source page", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  document.addPage([100, 120]);
  const result = await editorExport.exportEditedPdf({
    sourceBytes: await document.save({ useObjectStreams: true }),
    pages: [
      {
        ...blankPage,
        sourcePageIndex: 0,
        sourceWidth: 100,
        sourceHeight: 120,
      },
    ],
    elements: [],
    filename: "normal.pdf",
  });
  const output = await PDFDocument.load(
    new Uint8Array(await result.blob.arrayBuffer()),
    { updateMetadata: false },
  );

  assert.equal(output.getPageCount(), 1);
});

for (const pageKey of [
  "AA",
  "AcroForm",
  "AF",
  "B",
  "Collection",
  "Dur",
  "EmbeddedFiles",
  "JavaScript",
  "Metadata",
  "Names",
  "OpenAction",
  "PieceInfo",
  "PresSteps",
  "Thumb",
  "Trans",
  "UnreviewedCustom",
]) {
  test(`editor export flattens source pages carrying /${pageKey}`, async () => {
    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes:
          await createPageDictionaryPayloadFixture(pageKey),
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 120,
          },
        ],
        elements: [],
        filename: "flattened.pdf",
      }),
      /PDF previews can only be loaded in the browser/i,
    );
  });
}

test(
  "editor export rejects a deeply nested page tree before recursive enumeration",
  { timeout: 15_000 },
  async () => {
    const sourceBytes = await createDeepPageTreeFixture();

    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes,
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 100,
          },
        ],
        elements: [],
        filename: "deep.pdf",
      }),
      (error) =>
        error instanceof Error &&
        error.name === "PdfSecurityLimitError" &&
        /object graph.*limit/i.test(error.message) &&
        !/call stack|rangeerror/i.test(error.message),
    );
  },
);

test(
  "editor export rejects deep page resources before copyPages recursion",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes: await createDeepPageGraphFixture(),
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 100,
          },
        ],
        elements: [],
        filename: "deep-resource.pdf",
      }),
      { name: "PdfSecurityLimitError" },
    );
  },
);

test(
  "editor export bounds wide page-object graphs without spread expansion",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes: await createWidePageGraphFixture(),
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 100,
          },
        ],
        elements: [],
        filename: "wide-resource.pdf",
      }),
      (error) =>
        error instanceof Error &&
        error.name === "PdfSecurityLimitError" &&
        /object graph.*limit/i.test(error.message) &&
        !/call stack|rangeerror/i.test(error.message),
    );
  },
);

test(
  "editor export rejects deep reference chains before copyPages recursion",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes: await createDeepPageReferenceChainFixture(),
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 100,
          },
        ],
        elements: [],
        filename: "deep-reference-chain.pdf",
      }),
      (error) =>
        error instanceof Error &&
        error.name === "PdfSecurityLimitError" &&
        /object graph.*limit/i.test(error.message) &&
        !/call stack|rangeerror/i.test(error.message),
    );
  },
);

test(
  "editor export counts cumulative reference and container depth",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes:
          await createAlternatingReferenceGraphFixture(),
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 100,
          },
        ],
        elements: [],
        filename: "alternating-reference-graph.pdf",
      }),
      (error) =>
        error instanceof Error &&
        error.name === "PdfSecurityLimitError" &&
        /object graph.*limit/i.test(error.message) &&
        !/call stack|rangeerror/i.test(error.message),
    );
  },
);

test(
  "editor export counts scalar reference chains after nested containers",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes:
          await createContainerAndScalarReferenceFixture(),
        pages: [
          {
            ...blankPage,
            sourcePageIndex: 0,
            sourceWidth: 100,
            sourceHeight: 100,
          },
        ],
        elements: [],
        filename: "container-scalar-reference-graph.pdf",
      }),
      { name: "PdfSecurityLimitError" },
    );
  },
);

test("editor export bounds the filename before sanitization", async () => {
  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: null,
      pages: [blankPage],
      elements: [],
      filename: "a".repeat(256),
    }),
    {
      name: "PdfSecurityLimitError",
    },
  );
});

test("editor export honors cancellation before allocating the document", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: null,
      pages: [blankPage],
      elements: [],
      filename: "cancelled.pdf",
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});

test("editor export rejects text that would be silently truncated", async () => {
  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: null,
      pages: [blankPage],
      elements: [
        textElement(
          "This sentence cannot fit inside the intentionally tiny text box.",
        ),
      ],
      filename: "overflow.pdf",
    }),
    /does not fit all of its content/i,
  );
});

test("existing-text cleanup keeps immutable source geometry after a move", () => {
  const moved = {
    ...textElement("Replacement", 0.2, 0.04),
    x: 0.7,
    y: 0.8,
    rotation: 45,
    backgroundColor: "#000000",
    sourceText: {
      kind: "native",
      id: "source-1",
      pageIndex: 0,
      originalText: "Original",
      fontName: "Helvetica",
      originalX: 0.1,
      originalY: 0.2,
      originalWidth: 0.3,
      originalHeight: 0.05,
      originalRotation: 12,
      originalBackgroundColor: "#fefefe",
    },
  };

  assert.deepEqual(editorExport.sourceTextCleanupGeometry(moved), {
    backgroundColor: "#000000",
    height: 0.05,
    rotation: 12,
    width: 0.3,
    x: 0.1,
    y: 0.2,
  });
});

test("Unicode wrapping keeps combining and emoji grapheme clusters intact", () => {
  assert.deepEqual(
    editorExport.splitTextGraphemes(
      "e\u0301👨‍👩‍👧‍👦🇮🇹",
    ),
    ["e\u0301", "👨‍👩‍👧‍👦", "🇮🇹"],
  );
});

test("Unicode wrapping measures Arabic words with contextual shaping", () => {
  const contextualArabicFont = {
    widthOfTextAtSize(text) {
      const characters = [...text];
      return characters.length === 1
        ? 10
        : characters.reduce(
            (width, character) =>
              width + (character === " " ? 2 : 4),
            0,
          );
    },
  };

  const lines = editorExport.wrapPreparedTextRuns(
    [preparedRun("سلام", contextualArabicFont, "rtl")],
    12,
    20,
  );

  assert.deepEqual(lines.map(lineText), ["سلام"]);
  assert.equal(lines[0].direction, "rtl");
  assert.equal(lines[0].width, 16);
});

test("Unicode wrapping prefers word boundaries and trims line spaces", () => {
  const font = {
    widthOfTextAtSize(text) {
      return [...text].length;
    },
  };

  const lines = editorExport.wrapPreparedTextRuns(
    [preparedRun("hello world", font)],
    12,
    7,
  );

  assert.deepEqual(lines.map(lineText), ["hello", "world"]);
});

test("Unicode wrapping splits only an oversized token at grapheme boundaries", () => {
  const font = {
    widthOfTextAtSize(text) {
      return [...text].length;
    },
  };

  const lines = editorExport.wrapPreparedTextRuns(
    [preparedRun("abcdefghij", font)],
    12,
    4,
  );

  assert.deepEqual(lines.map(lineText), ["abcd", "efgh", "ij"]);
});

test("Unicode wrapping preserves font runs across a split token", () => {
  const firstFont = {
    widthOfTextAtSize(text) {
      return [...text].length;
    },
  };
  const secondFont = {
    widthOfTextAtSize(text) {
      return [...text].length;
    },
  };

  const lines = editorExport.wrapPreparedTextRuns(
    [
      preparedRun("ab", firstFont),
      preparedRun("cd", secondFont),
    ],
    12,
    3,
  );

  assert.deepEqual(lines.map(lineText), ["abc", "d"]);
  assert.equal(lines[0].runs.length, 2);
});

test("Unicode wrapping stops bounded export work after the overflow line", () => {
  let measuredCodeUnits = 0;
  const font = {
    widthOfTextAtSize(text) {
      measuredCodeUnits += text.length;
      return text.length;
    },
  };
  const text = "a".repeat(100_000);

  const lines = editorExport.wrapPreparedTextRuns(
    [preparedRun(text, font)],
    12,
    1,
    2,
  );

  assert.deepEqual(lines.map(lineText), ["a", "a"]);
  assert.ok(
    measuredCodeUnits < 100_100,
    `expected bounded near-linear measurement, saw ${measuredCodeUnits} code units`,
  );
});

test("editor export rejects oversized source bytes before copying them", async () => {
  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: { byteLength: 100 * 1024 * 1024 + 1 },
      pages: [blankPage],
      elements: [],
      filename: "source.pdf",
    }),
    { name: "PdfSecurityLimitError" },
  );
});

test("editor export rejects a source document above the page budget", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  for (let index = 0; index < 501; index += 1) {
    document.addPage([10, 10]);
  }

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({ useObjectStreams: true }),
      pages: [
        {
          ...blankPage,
          sourcePageIndex: 0,
          sourceWidth: 10,
          sourceHeight: 10,
        },
      ],
      elements: [],
      filename: "pages.pdf",
    }),
    { name: "PdfSecurityLimitError" },
  );
});

test("editor export verifies image magic bytes instead of trusting MIME", async () => {
  const jpeg = new Uint8Array(21);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  jpeg.set([0x00, 0x10, 0x00, 0x10], 7);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: null,
      pages: [blankPage],
      elements: [imageElement(dataUrl("image/png", jpeg))],
      filename: "image.pdf",
    }),
    /declares PNG but contains JPEG bytes/i,
  );
});

test("editor export ignores claimed pixel counts and checks image headers", async () => {
  const png = new Uint8Array(24);
  png.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 12_000, false);
  view.setUint32(20, 12_000, false);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: null,
      pages: [blankPage],
      elements: [imageElement(dataUrl("image/png", png), 1)],
      filename: "pixels.pdf",
    }),
    { name: "PdfSecurityLimitError" },
  );
});
