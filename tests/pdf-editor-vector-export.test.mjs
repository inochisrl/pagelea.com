import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import fontkit from "@pdf-lib/fontkit";
import { build } from "esbuild";
import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  rgb,
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
const rawEditorExport = await import(
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
      kind: "native",
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

function nativeTextEvidence(originalText, extraFragments = []) {
  return [
    {
      pageId: pageModel.id,
      sourcePageIndex: 0,
      fragments: [
        {
          id: "source-text-1",
          text: originalText,
          x: 0.095,
          y: 0.425,
          width: 0.4,
          height: 0.1,
          rotation: 0,
          hasGeometry: true,
        },
        ...extraFragments.map((fragment, index) => ({
          id: `evidence-${index + 1}`,
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.06,
          rotation: 0,
          hasGeometry: true,
          ...fragment,
        })),
      ],
    },
  ];
}

function exportWithNativeTextEvidence(input, extraFragments = []) {
  const sourceEdit = input.elements.find(
    (element) => element.type === "text" && element.sourceText,
  );
  return rawEditorExport.exportEditedPdf({
    ...input,
    nativeTextEvidence:
      input.nativeTextEvidence ??
      (sourceEdit
        ? nativeTextEvidence(
            sourceEdit.sourceText.originalText,
            extraFragments,
          )
        : []),
  });
}

const editorExport = {
  exportEditedPdf: exportWithNativeTextEvidence,
};

async function sourcePdf(
  textRuns,
  {
    removeLocalFontSelection = false,
    targetAsAdjustedTj = false,
  } = {},
) {
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
  if (targetAsAdjustedTj || removeLocalFontSelection) {
    const contents = page.node.Contents();
    assert.ok(contents instanceof PDFArray);
    const stream = contents.lookup(0, PDFStream);
    assert.ok(stream instanceof PDFContentStream);
    const source = new TextDecoder().decode(
      stream.getUnencodedContents(),
    );
    let rewritten = source;
    if (targetAsAdjustedTj) {
      const target = Buffer.from("Original secret")
        .toString("hex")
        .toUpperCase();
      const first = Buffer.from("Original")
        .toString("hex")
        .toUpperCase();
      const second = Buffer.from("secret")
        .toString("hex")
        .toUpperCase();
      rewritten = rewritten.replace(
        `<${target}> Tj`,
        `[<${first}> -200 <${second}>] TJ`,
      );
    } else {
      rewritten = rewritten.replace(
        /\/[^\s]+ 14 Tf/,
        "",
      );
    }
    assert.notEqual(
      rewritten,
      source,
      targetAsAdjustedTj
        ? "fixture rewrites Tj as a positioned TJ array"
        : "fixture removes the local Tf selection",
    );
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

function decodedPageContent(document, page) {
  const rawContents = page.node.get(PDFName.of("Contents"), true);
  const entries =
    rawContents instanceof PDFArray
      ? rawContents.asArray()
      : rawContents
        ? [rawContents]
        : [];
  const decoder = new TextDecoder();
  return entries
    .map((entry) => {
      const stream = document.context.lookup(entry);
      if (stream instanceof PDFContentStream) {
        return decoder.decode(stream.getUnencodedContents());
      }
      if (stream instanceof PDFRawStream) {
        return decoder.decode(decodePDFRawStream(stream).decode());
      }
      return "";
    })
    .join("\n");
}

test("existing-text export preserves unedited vectors and removes the old searchable glyphs", async () => {
  const original = await sourcePdf([
    { text: "Keep searchable", x: 30, y: 150 },
    { text: "Original secret", x: 30, y: 100 },
  ]);
  const result = await editorExport.exportEditedPdf({
    sourceBytes: original,
    pages: [pageModel],
    elements: [replacementElement("Original secret")],
    filename: "edited.pdf",
    nativeTextEvidence: nativeTextEvidence("Original secret", [
      { text: "Keep searchable" },
    ]),
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

test("native vector rewriting handles two selected source fragments together", async () => {
  const sourceBytes = await sourcePdf([
    { text: "Keep searchable", x: 30, y: 160 },
    { text: "First secret", x: 30, y: 110 },
    { text: "Second secret", x: 30, y: 60 },
  ]);
  const first = replacementElement(
    "First secret",
    "First replacement",
  );
  const second = replacementElement(
    "Second secret",
    "Second replacement",
  );
  second.id = "replacement-2";
  second.y = 0.68;
  second.sourceText = {
    ...second.sourceText,
    id: "source-text-2",
    originalY: 0.675,
  };
  const evidence = nativeTextEvidence("First secret", [
    {
      id: "source-text-2",
      text: "Second secret",
      x: 0.095,
      y: 0.675,
      width: 0.4,
      height: 0.1,
    },
    {
      id: "keep-text",
      text: "Keep searchable",
      x: 0.095,
      y: 0.15,
      width: 0.4,
      height: 0.1,
    },
  ]);

  const result = await editorExport.exportEditedPdf({
    sourceBytes,
    pages: [pageModel],
    elements: [first, second],
    filename: "two-native-replacements.pdf",
    nativeTextEvidence: evidence,
  });
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  const strings = (await extractedTextItems(outputBytes)).map(
    (item) => item.str,
  );

  assert.deepEqual(strings, [
    "Keep searchable",
    "First replacement",
    "Second replacement",
  ]);
  const output = await PDFDocument.load(outputBytes, {
    updateMetadata: false,
  });
  const xObjects = output
    .getPage(0)
    .node.Resources()
    ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  assert.equal(
    xObjects?.entries().length ?? 0,
    0,
    "multiple proven native edits must retain the vector page",
  );
});

test("a containing word elsewhere does not force native raster fallback", async () => {
  const sourceBytes = await sourcePdf([
    { text: "Subtotal", x: 30, y: 150 },
    { text: "Total", x: 30, y: 100 },
  ]);
  const result = await editorExport.exportEditedPdf({
    sourceBytes,
    pages: [pageModel],
    elements: [replacementElement("Total", "Paid")],
    filename: "containing-word.pdf",
    nativeTextEvidence: nativeTextEvidence("Total", [
      {
        text: "Subtotal",
        x: 0.1,
        y: 0.15,
      },
    ]),
  });
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.deepEqual(
    (await extractedTextItems(outputBytes)).map((item) => item.str),
    ["Subtotal", "Paid"],
  );
  const output = await PDFDocument.load(outputBytes, {
    updateMetadata: false,
  });
  const xObjects = output
    .getPage(0)
    .node.Resources()
    ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  assert.equal(xObjects?.entries().length ?? 0, 0);
});

test("a semantic source-text substring elsewhere forces the secure raster fallback", async () => {
  const sourceBytes = await sourcePdf([
    {
      text: "Prefix Original secret suffix",
      x: 30,
      y: 150,
    },
    { text: "Original secret", x: 30, y: 100 },
  ]);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "semantic-substring-copy.pdf",
      nativeTextEvidence: nativeTextEvidence(
        "Original secret",
        [
          {
            text: "Prefix Original secret suffix",
            x: 0.1,
            y: 0.15,
          },
        ],
      ),
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("reordered whole fragments cannot hide a source-text copy", async () => {
  const sourceBytes = await sourcePdf([
    { text: "Original secret", x: 30, y: 100 },
    { text: " secret", x: 30, y: 160 },
    { text: "Original", x: 90, y: 160 },
  ]);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "reordered-fragment-copy.pdf",
      nativeTextEvidence: nativeTextEvidence(
        "Original secret",
        [
          { text: " secret", x: 0.1, y: 0.12 },
          { text: "Original", x: 0.45, y: 0.12 },
        ],
      ),
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("native vector replacement does not paint over non-uniform backgrounds", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({
    x: 20,
    y: 85,
    width: 90,
    height: 35,
    color: rgb(0.92, 0.24, 0.2),
  });
  page.drawRectangle({
    x: 110,
    y: 85,
    width: 90,
    height: 35,
    color: rgb(0.18, 0.58, 0.4),
  });
  page.drawRectangle({
    x: 200,
    y: 85,
    width: 80,
    height: 35,
    color: rgb(0.18, 0.38, 0.78),
  });
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  const sourceBytes = await document.save({ useObjectStreams: true });
  const persistedSource = await PDFDocument.load(sourceBytes, {
    updateMetadata: false,
  });
  const sourceBackgroundPathCount = (
    decodedPageContent(
      persistedSource,
      persistedSource.getPage(0),
    ).match(/(?:^|\n)0 0 m(?:\n|$)/g) ?? []
  ).length;
  assert.equal(sourceBackgroundPathCount, 3);

  const result = await editorExport.exportEditedPdf({
    sourceBytes,
    pages: [pageModel],
    elements: [replacementElement("Original secret")],
    filename: "non-uniform-background.pdf",
  });
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  const output = await PDFDocument.load(outputBytes, {
    updateMetadata: false,
  });
  const outputBackgroundPathCount = (
    decodedPageContent(output, output.getPage(0)).match(
      /(?:^|\n)0 0 m(?:\n|$)/g,
    ) ?? []
  ).length;

  assert.equal(
    outputBackgroundPathCount,
    sourceBackgroundPathCount,
    "native replacement must not add an opaque cleanup rectangle",
  );
  assert.deepEqual(
    (await extractedTextItems(outputBytes)).map((item) => item.str),
    ["Replacement text"],
  );
});

test("OCR replacement requires secure browser flattening of original pixels", async () => {
  const original = await sourcePdf([
    { text: "Keep searchable", x: 30, y: 150 },
  ]);
  const replacement = replacementElement(
    "Scanned words",
    "Unicode replacement",
  );
  replacement.sourceText = {
    ...replacement.sourceText,
    kind: "ocr",
    language: "eng",
    confidence: 94,
  };

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: original,
      pages: [pageModel],
      elements: [replacement],
      filename: "ocr-edited.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
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

test("native rewriting without matching PDF.js page evidence fails closed", async () => {
  const sourceBytes = await sourcePdf([
    { text: "Original secret", x: 30, y: 100 },
  ]);

  await assert.rejects(
    rawEditorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "missing-evidence.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("PDF.js evidence text must correspond to every raw text operation", async () => {
  const sourceBytes = await sourcePdf([
    { text: "Keep searchable", x: 30, y: 150 },
    { text: "Original secret", x: 30, y: 100 },
  ]);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "mismatched-evidence.pdf",
      nativeTextEvidence: nativeTextEvidence("Original secret", [
        { text: "Different evidence" },
      ]),
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

for (const fixture of [
  {
    label: "wrong source page",
    mutate(evidence) {
      evidence[0].sourcePageIndex = 1;
    },
  },
  {
    label: "duplicate fragment id",
    mutate(evidence) {
      evidence[0].fragments.push({
        ...evidence[0].fragments[0],
        text: "",
      });
    },
  },
  {
    label: "changed selected geometry",
    mutate(evidence) {
      evidence[0].fragments[0].x += 0.02;
    },
  },
  {
    label: "changed immutable source geometry",
    mutate(_evidence, edit) {
      edit.sourceText.originalX += 0.02;
    },
  },
  {
    label: "rotated selected fragment",
    mutate(evidence) {
      evidence[0].fragments[0].rotation = 90;
    },
  },
]) {
  test(`native rewriting rejects ${fixture.label} evidence`, async () => {
    const sourceBytes = await sourcePdf([
      { text: "Original secret", x: 30, y: 100 },
    ]);
    const evidence = nativeTextEvidence("Original secret");
    const edit = replacementElement("Original secret");
    fixture.mutate(evidence, edit);

    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes,
        pages: [pageModel],
        elements: [edit],
        filename: "invalid-evidence.pdf",
        nativeTextEvidence: evidence,
      }),
      /PDF previews can only be loaded in the browser/i,
    );
  });
}

test("positioned TJ arrays take the secure raster fallback", async () => {
  const sourceBytes = await sourcePdf(
    [{ text: "Original secret", x: 30, y: 100 }],
    { targetAsAdjustedTj: true },
  );
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret"],
    "PDF.js synthesizes the semantic space from the TJ adjustment",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "positioned-tj.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("text without a local verified Tf takes the secure raster fallback", async () => {
  const sourceBytes = await sourcePdf(
    [{ text: "Original secret", x: 30, y: 100 }],
    { removeLocalFontSelection: true },
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "missing-local-font.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("ExtGState text takes the secure raster fallback", async () => {
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
    opacity: 0.5,
  });
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret"],
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "ext-gstate-text.pdf",
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

test("non-printable WinAnsi bytes take the secure raster fallback", async () => {
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
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
    opacity: 0,
  });

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
  const nonCanonical = Buffer.from("Original")
    .toString("hex")
    .toUpperCase()
    .concat(
      "00",
      Buffer.from(" secret").toString("hex").toUpperCase(),
    );
  const needle = `<${target}> Tj`;
  const duplicateIndex = source.lastIndexOf(needle);
  assert.ok(
    duplicateIndex >= 0,
    "fixture contains the invisible duplicate",
  );
  const rewritten = [
    source.slice(0, duplicateIndex),
    `<${nonCanonical}> Tj`,
    source.slice(duplicateIndex + needle.length),
  ].join("");
  const reference = document.context.register(
    document.context.flateStream(rewritten),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );

  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret", "Original secret"],
    "PDF.js suppresses the non-printable byte in searchable text",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "non-printable-winansi.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("an invisible custom-font copy forces the secure raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  document.registerFontkit(fontkit);
  const page = document.addPage([300, 200]);
  const standard = await document.embedFont(StandardFonts.Helvetica);
  const custom = await document.embedFont(
    await readFile(
      new URL(
        "../public/private-rewrite/fonts/NotoSans-Regular.ttf",
        import.meta.url,
      ),
    ),
    { subset: true },
  );
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font: standard,
  });
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font: custom,
    opacity: 0,
  });
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret", "Original secret"],
    "the fixture contains a searchable invisible duplicate",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "hidden-custom-font-copy.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("a split invisible WinAnsi copy forces the secure raster fallback", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 14;
  const firstPart = "Original";
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: fontSize,
    font,
  });
  page.drawText(firstPart, {
    x: 30,
    y: 100,
    size: fontSize,
    font,
    opacity: 0,
  });
  page.drawText("secret", {
    x:
      32 +
      font.widthOfTextAtSize(firstPart, fontSize),
    y: 100,
    size: fontSize,
    font,
    opacity: 0,
  });
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret", "Original secret"],
    "PDF.js combines the split invisible operators semantically",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "split-hidden-copy.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("an invisible case-variant copy forces the secure raster fallback", async () => {
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
  page.drawText("ORIGINAL SECRET", {
    x: 30,
    y: 50,
    size: 14,
    font,
  });

  const contents = page.node.Contents();
  assert.ok(contents instanceof PDFArray);
  const stream = contents.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFContentStream);
  const source = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const uppercaseTarget = Buffer.from("ORIGINAL SECRET")
    .toString("hex")
    .toUpperCase();
  const needle = `<${uppercaseTarget}> Tj`;
  const rewritten = source.replace(needle, `3 Tr\n${needle}`);
  assert.notEqual(
    rewritten,
    source,
    "fixture makes the case-variant text invisible",
  );
  const reference = document.context.register(
    document.context.flateStream(rewritten),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );

  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret", "ORIGINAL SECRET"],
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "case-variant-copy.pdf",
      nativeTextEvidence: nativeTextEvidence("Original secret", [
        {
          text: "ORIGINAL SECRET",
          x: 0.6,
          y: 0.1,
        },
      ]),
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("interleaved decoy operators cannot hide a fragmented duplicate", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 14;
  const firstPart = "Original";
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: fontSize,
    font,
  });
  page.drawText(firstPart, {
    x: 30,
    y: 100,
    size: fontSize,
    font,
  });
  page.drawText("DECOY", {
    x: 10_000,
    y: 10_000,
    size: fontSize,
    font,
  });
  page.drawText(" secret", {
    x: 30 + font.widthOfTextAtSize(firstPart, fontSize),
    y: 100,
    size: fontSize,
    font,
  });
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  const sourceStrings = (await extractedTextItems(sourceBytes)).map(
    (item) => item.str,
  );
  assert.ok(
    sourceStrings.filter((value) => value === "Original secret")
      .length >= 2,
    "the source exposes a complete duplicate despite the decoy operator",
  );
  let selectedEvidenceConsumed = false;
  const additionalEvidence = sourceStrings.flatMap((text) => {
    if (
      text === "Original secret" &&
      !selectedEvidenceConsumed
    ) {
      selectedEvidenceConsumed = true;
      return [];
    }
    return [{ text }];
  });

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "interleaved-decoy.pdf",
      nativeTextEvidence: nativeTextEvidence(
        "Original secret",
        additionalEvidence,
      ),
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("overlapping PDF.js evidence rejects a retained sensitive fragment", async () => {
  const document = await PDFDocument.create({
    updateMetadata: false,
  });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("API key: ABCDEF", {
    x: 30,
    y: 100,
    size: 14,
    font,
  });
  page.drawText("ABCDEF", {
    x: 82,
    y: 100,
    size: 14,
    font,
  });
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["API key: ABCDEF", "ABCDEF"],
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [
        replacementElement("API key: ABCDEF", "Credential removed"),
      ],
      filename: "overlapping-sensitive-fragment.pdf",
      nativeTextEvidence: nativeTextEvidence("API key: ABCDEF", [
        {
          text: "ABCDEF",
          x: 0.27,
          y: 0.43,
          width: 0.2,
          height: 0.07,
        },
      ]),
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("a Tj with an extra string operand takes the secure raster fallback", async () => {
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
  const source = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const target = Buffer.from("Original secret")
    .toString("hex")
    .toUpperCase();
  const needle = `<${target}> Tj`;
  assert.match(source, new RegExp(needle));
  const rewritten = source.replace(
    needle,
    `<${target}> <${target}> Tj`,
  );
  const reference = document.context.register(
    document.context.flateStream(rewritten),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret"],
    "PDF.js renders only the final operand of the malformed Tj",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "extra-tj-operand.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("an unconsumed string operand takes the secure raster fallback", async () => {
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
  const source = new TextDecoder().decode(
    stream.getUnencodedContents(),
  );
  const hidden = Buffer.from("Original secret")
    .toString("hex")
    .toUpperCase();
  const reference = document.context.register(
    document.context.flateStream(
      `<${hidden}> q\nQ\n${source}`,
    ),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([reference]),
  );
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret"],
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "unconsumed-string.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("a hidden Tj split across content streams forces the secure raster fallback", async () => {
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
  page.drawText("Original secret", {
    x: 30,
    y: 100,
    size: 14,
    font,
    opacity: 0,
  });

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
  const needle = `<${target}> Tj`;
  const duplicateIndex = source.lastIndexOf(needle);
  assert.ok(
    duplicateIndex >= 0,
    "fixture contains the invisible duplicate",
  );
  const boundary = duplicateIndex + needle.length - 1;
  const first = document.context.register(
    document.context.flateStream(source.slice(0, boundary)),
  );
  const second = document.context.register(
    document.context.flateStream(source.slice(boundary)),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([first, second]),
  );

  const sourceBytes = await document.save({
    useObjectStreams: true,
  });
  assert.deepEqual(
    (await extractedTextItems(sourceBytes)).map((item) => item.str),
    ["Original secret", "Original secret"],
    "PDF.js reads the Tj operator across the stream boundary",
  );

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "split-stream-hidden-copy.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("a cyclic content-stream dictionary forces the secure raster fallback", async () => {
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
  const rawContents = page.node.get(
    PDFName.of("Contents"),
    true,
  );
  assert.ok(rawContents instanceof PDFArray);
  const streamReference = rawContents.asArray()[0];
  assert.ok(streamReference);
  const stream = page.node.Contents()?.lookup(0, PDFStream);
  assert.ok(stream instanceof PDFStream);
  const loop = document.context.obj({});
  const loopReference = document.context.register(loop);
  stream.dict.set(PDFName.of("Loop"), loopReference);
  loop.set(PDFName.of("Back"), streamReference);
  const sourceBytes = await document.save({
    useObjectStreams: true,
  });

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes,
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "cyclic-content-stream.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

for (const aliasKey of ["Backup", "ArtBox"]) {
  test(`a /${aliasKey} alias to the old page contents forces the secure raster fallback`, async () => {
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
    const contents = page.node.get(PDFName.of("Contents"), true);
    assert.ok(contents);
    page.node.set(PDFName.of(aliasKey), contents);

    await assert.rejects(
      editorExport.exportEditedPdf({
        sourceBytes: await document.save({
          useObjectStreams: true,
        }),
        pages: [pageModel],
        elements: [replacementElement("Original secret")],
        filename: `content-alias-${aliasKey.toLowerCase()}.pdf`,
      }),
      /PDF previews can only be loaded in the browser/i,
    );
  });
}

test("an indirect /ArtBox chain to old contents forces raster fallback", async () => {
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
  const contents = page.node.get(PDFName.of("Contents"), true);
  assert.ok(contents instanceof PDFArray);
  const streamReference = contents.asArray()[0];
  assert.ok(streamReference);
  const wrapperReference =
    document.context.register(streamReference);
  page.node.set(PDFName.of("ArtBox"), wrapperReference);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({
        useObjectStreams: true,
      }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "indirect-content-alias.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("a nested reference in a content-stream dictionary forces raster fallback", async () => {
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
  const backup = document.context.register(
    document.context.flateStream("Original secret"),
  );
  stream.dict.set(PDFName.of("Backup"), backup);

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({
        useObjectStreams: true,
      }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "nested-content-reference.pdf",
    }),
    /PDF previews can only be loaded in the browser/i,
  );
});

test("an inherited resource alias to old contents forces raster fallback", async () => {
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
  const contents = page.node.get(PDFName.of("Contents"), true);
  const resources = page.node.get(PDFName.of("Resources"), true);
  const parentReference = page.node.get(PDFName.of("Parent"), true);
  assert.ok(contents);
  assert.ok(resources);
  assert.ok(parentReference);
  const resourceDictionary = document.context.lookup(
    resources,
    PDFDict,
  );
  const parentDictionary = document.context.lookup(
    parentReference,
    PDFDict,
  );
  resourceDictionary.set(PDFName.of("Backup"), contents);
  parentDictionary.set(PDFName.of("Resources"), resources);
  page.node.delete(PDFName.of("Resources"));

  await assert.rejects(
    editorExport.exportEditedPdf({
      sourceBytes: await document.save({
        useObjectStreams: true,
      }),
      pages: [pageModel],
      elements: [replacementElement("Original secret")],
      filename: "inherited-content-alias.pdf",
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
