import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";
import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  StandardFonts,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
  sourcePageIndex: 0,
  sourceWidth: 300,
  sourceHeight: 200,
  sourceRotation: 0,
  rotation: 0,
};

function replacementElement(originalText, text = "Replacement text") {
  return {
    id: "replacement-1",
    pageId: pageModel.id,
    type: "text",
    x: 0.1,
    y: 0.43,
    width: 0.5,
    height: 0.11,
    opacity: 1,
    text,
    fontSize: 14,
    baselineFactor: 1,
    fontFamily: "Helvetica",
    color: "#111111",
    bold: false,
    italic: false,
    backgroundColor: "#ffffff",
    sourceText: {
      id: "source-text-1",
      pageIndex: 0,
      originalText,
      fontName: "Helvetica",
      originalX: 0.095,
      originalY: 0.425,
      originalWidth: 0.4,
      originalHeight: 0.1,
      originalRotation: 0,
      originalBackgroundColor: "#ffffff",
    },
  };
}

async function sourcePdf(textRuns, { targetAsTj = false } = {}) {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const run of textRuns) {
    page.drawText(run.text, {
      x: run.x,
      y: run.y,
      size: 14,
      font,
    });
  }
  if (targetAsTj) {
    const contents = page.node.Contents();
    assert.ok(contents instanceof PDFArray);
    const stream = contents.lookup(0, PDFStream);
    assert.ok(stream instanceof PDFContentStream);
    const source = new TextDecoder().decode(
      stream.getUnencodedContents(),
    );
    const target = Buffer.from("Original secret")
      .toString("hex")
      .toUpperCase();
    const first = Buffer.from("Original ")
      .toString("hex")
      .toUpperCase();
    const second = Buffer.from("secret")
      .toString("hex")
      .toUpperCase();
    const rewritten = source.replace(
      `<${target}> Tj`,
      `[<${first}> 0 <${second}>] TJ`,
    );
    assert.notEqual(rewritten, source, "fixture rewrites Tj as hex TJ");
    const reference = document.context.register(
      document.context.flateStream(rewritten),
    );
    page.node.set(
      PDFName.of("Contents"),
      document.context.obj([reference]),
    );
  }
  return document.save({ useObjectStreams: true });
}

async function extractedTextItems(bytes, pageNumber = 1) {
  const loadingTask = getDocument({
    data: bytes.slice(),
    verbosity: 0,
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items.filter((item) => "str" in item);
  } finally {
    await loadingTask.destroy();
  }
}

test("existing-text export preserves unedited vectors and removes the old searchable glyphs", async () => {
  const original = await sourcePdf([
    { text: "Keep searchable", x: 30, y: 150 },
    { text: "Original secret", x: 30, y: 100 },
  ], { targetAsTj: true });
  const result = await editorExport.exportEditedPdf({
    sourceBytes: original,
    pages: [pageModel],
    elements: [replacementElement("Original secret")],
    filename: "edited.pdf",
  });
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  const items = await extractedTextItems(outputBytes);
  const strings = items.map((item) => item.str);

  assert.deepEqual(strings, [
    "Keep searchable",
    "Replacement text",
  ]);
  assert.equal(
    strings.some((value) => value.includes("Original secret")),
    false,
    "the replaced source text must not remain extractable below the cover",
  );

  const untouched = items.find(
    (item) => item.str === "Keep searchable",
  );
  assert.ok(untouched);
  assert.deepEqual(untouched.transform.slice(4), [30, 150]);
  assert.ok(untouched.width > 0, "unchanged text remains selectable");

  const replacement = items.find(
    (item) => item.str === "Replacement text",
  );
  assert.ok(replacement);
  assert.ok(replacement.width > 0, "replacement text is vector text");

  const output = await PDFDocument.load(outputBytes, {
    updateMetadata: false,
  });
  const resources = output.getPage(0).node.Resources();
  const xObjects = resources?.lookupMaybe(
    PDFName.of("XObject"),
    PDFDict,
  );
  assert.equal(
    xObjects?.entries().length ?? 0,
    0,
    "the compatible page must not be replaced by a raster image",
  );
});

test("ambiguous source text takes the explicit browser raster fallback", async () => {
  const original = await sourcePdf([
    { text: "Repeated target", x: 30, y: 150 },
    { text: "Repeated target", x: 30, y: 100 },
  ]);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: original,
      pages: [pageModel],
      elements: [replacementElement("Repeated target")],
      filename: "ambiguous.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("font encodings that cannot be identified exactly take the raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const symbol = await document.embedFont(StandardFonts.Symbol);
  page.drawText("Ω", {
    x: 30,
    y: 100,
    size: 14,
    font: symbol,
  });
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Ω"],
    "PDF.js resolves the Symbol-font byte to the selected Unicode text",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Ω", "Omega")],
      filename: "encoded.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("rewriting one page never damages a source content stream shared by another page", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const first = document.addPage([300, 200]);
  const second = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  first.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const sharedContents = first.node.get(
    PDFName.of("Contents"),
    true,
  );
  const sharedResources = first.node.get(
    PDFName.of("Resources"),
    true,
  );
  assert.ok(sharedContents);
  assert.ok(sharedResources);
  second.node.set(PDFName.of("Contents"), sharedContents);
  second.node.set(PDFName.of("Resources"), sharedResources);

  const result = await editorExport.exportEditedPdf({
    sourceBytes: await document.save({ useObjectStreams: true }),
    pages: [
      pageModel,
      {
        ...pageModel,
        id: "page-2",
        sourcePageIndex: 1,
      },
    ],
    elements: [replacementElement("Original secret")],
    filename: "shared-stream.pdf",
  });
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  const firstPage = await extractedTextItems(outputBytes);
  const secondPage = await extractedTextItems(outputBytes, 2);

  assert.deepEqual(
    firstPage.map((item) => item.str),
    ["Replacement text"],
  );
  assert.deepEqual(
    secondPage.map((item) => item.str),
    ["Original secret"],
  );
});

test("excessive content-stream tokens take the bounded raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const contents = page.node.Contents();
  assert.ok(contents instanceof PDFArray);
  const stream = contents.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFContentStream);
  const originalContent = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const oversizedContent = `${"q\nQ\n".repeat(30_000)}${originalContent}`;
  const reference = document.context.register(
    document.context.flateStream(oversizedContent),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({ useObjectStreams: true }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "token-budget.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("deeply nested content operands take the bounded raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const contents = page.node.Contents();
  assert.ok(contents instanceof PDFArray);
  const stream = contents.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFContentStream);
  const originalContent = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const nestedOperand =
    `${"[".repeat(256)}${"]".repeat(256)} pop\n`;
  const reference = document.context.register(
    document.context.flateStream(
      `${nestedOperand}${originalContent}`,
    ),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({ useObjectStreams: true }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "nested-budget.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("marked content with an escaped ActualText name takes the safe raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const contents = page.node.Contents();
  assert.ok(contents instanceof PDFArray);
  const stream = contents.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFContentStream);
  const originalContent = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const markedContent =
    `/Span << /Actual#54ext (Original secret) >> BDC\n` +
    `${originalContent}\nEMC\n`;
  const reference = document.context.register(
    document.context.flateStream(markedContent),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({ useObjectStreams: true }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "actual-text.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("excessive page content streams take the bounded raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const contents = page.node.Contents();
  assert.ok(contents instanceof PDFArray);
  const stream = contents.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFContentStream);
  const originalContent = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const references = Array.from({ length: 257 }, (_, index) =>
    document.context.register(
      document.context.flateStream(
        index === 256 ? originalContent : "",
      ),
    ),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj(references),
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({ useObjectStreams: true }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "content-stream-budget.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("high-expansion Flate content stops at the decoded byte budget", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const contents = page.node.Contents();
  assert.ok(contents instanceof PDFArray);
  const stream = contents.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFContentStream);
  const originalContent = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const highExpansionContent =
    `${" ".repeat(17 * 1024 * 1024)}\n${originalContent}`;
  const reference = document.context.register(
    document.context.flateStream(highExpansionContent),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({ useObjectStreams: true }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "flate-expansion-budget.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

for (const fixture of [
  {
    label: "literal",
    prefix: () => `(${"a".repeat(600 * 1024)}) pop\n`,
  },
  {
    label: "hex",
    prefix: () => `<${"41".repeat(600 * 1024)}> pop\n`,
  },
]) {
  test(`oversized ${fixture.label} strings take the bounded raster fallback`, async () => {
    const document = await PDFDocument.create({
      updateMetadata: false,
    });
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("Original secret", {
      x: 30,
      y: 100,
      size: 14,
      font,
    });
    const contents = page.node.Contents();
    assert.ok(contents instanceof PDFArray);
    const stream = contents.lookup(0, PDFStream);
    assert.ok(stream instanceof PDFContentStream);
    const originalContent = new TextDecoder().decode(
      stream.getUnencodedContents(),
    );
    const reference = document.context.register(
      document.context.flateStream(
        `${fixture.prefix()}${originalContent}`,
      ),
    );
    page.node.set(
      PDFName.of("Contents"),
      document.context.obj([reference]),
    );

    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes: await document.save({ useObjectStreams: true }),
        pages: [pageModel],
        elements: [replacementElement("Original secret")],
        filename: `${fixture.label}-string-budget.pdf`,
      }),
      /PDF previews can only be loaded in the browser/i,
    );
  });
}
