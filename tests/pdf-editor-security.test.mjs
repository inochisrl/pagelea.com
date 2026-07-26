import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";
import { PDFDocument, PDFName } from "pdf-lib";

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
    backgroundColor: "#fefefe",
    height: 0.05,
    rotation: 12,
    width: 0.3,
    x: 0.1,
    y: 0.2,
  });
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
