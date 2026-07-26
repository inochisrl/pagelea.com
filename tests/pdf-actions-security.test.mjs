import assert from "node:assert/strict";
import { Blob, Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";

import { build } from "esbuild";
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFStream,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const bundledActions = await build({
  entryPoints: [
    new URL("../app/lib/pdf-actions.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const actionsModuleUrl =
  "data:text/javascript;base64," +
  Buffer.from(bundledActions.outputFiles[0].contents).toString("base64");
const { PdfToolError, processPdfTool } = await import(actionsModuleUrl);

const PDF_TYPE = "application/pdf";

function asPdfBlob(bytes) {
  return new Blob([bytes], { type: PDF_TYPE });
}

async function createPageRangeFixture() {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([100, 100]);
  document.addPage([200, 100]);
  document.addPage([300, 100]);
  return document.save({ useObjectStreams: true });
}

async function createActivePdfFixture() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([400, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Visible page content", {
    x: 40,
    y: 340,
    size: 16,
    font,
  });

  document.setTitle("private title");
  document.setAuthor("private author");

  const field = document.getForm().createTextField("customer.name");
  field.setText("Visible form value");
  field.addToPage(page, {
    x: 40,
    y: 270,
    width: 180,
    height: 24,
    font,
  });

  const scriptAction = document.context.obj({
    S: "JavaScript",
    JS: PDFString.of("app.alert('unsafe')"),
  });
  const scriptActionRef = document.context.register(scriptAction);
  const launchAction = document.context.obj({
    S: "Launch",
    F: PDFString.of("payload.exe"),
  });
  const launchActionRef = document.context.register(launchAction);

  document.catalog.set(PDFName.of("OpenAction"), scriptActionRef);
  document.catalog.set(
    PDFName.of("AA"),
    document.context.obj({ WC: launchActionRef }),
  );

  const embeddedPayload = document.context.register(
    document.context.stream(new TextEncoder().encode("embedded secret")),
  );
  const fileSpec = document.context.register(
    document.context.obj({
      Type: "Filespec",
      F: PDFString.of("secret.txt"),
      EF: { F: embeddedPayload },
    }),
  );
  const names = document.context.obj({
    JavaScript: {
      Names: [PDFString.of("startup"), scriptActionRef],
    },
    EmbeddedFiles: {
      Names: [PDFString.of("secret.txt"), fileSpec],
    },
  });
  document.catalog.set(PDFName.of("Names"), names);
  document.catalog.set(PDFName.of("AF"), document.context.obj([fileSpec]));
  document.catalog.set(
    PDFName.of("Outlines"),
    document.context.obj({ First: { A: launchActionRef } }),
  );

  const xmp = document.context.register(
    document.context.stream(
      new TextEncoder().encode(
        "<?xpacket begin='x'?><private>catalog metadata</private>",
      ),
      { Type: "Metadata", Subtype: "XML" },
    ),
  );
  document.catalog.set(PDFName.of("Metadata"), xmp);

  const pageMetadata = document.context.register(
    document.context.stream(
      new TextEncoder().encode("<private>page metadata</private>"),
      { Type: "Metadata", Subtype: "XML" },
    ),
  );
  page.node.set(PDFName.of("Metadata"), pageMetadata);

  const customXmp = document.context.register(
    document.context.stream(
      new TextEncoder().encode(
        "<x:xmpmeta><private>nested custom XMP</private></x:xmpmeta>",
      ),
      { Type: "Metadata", Subtype: "XML" },
    ),
  );
  const directMetadata = document.context.obj({
    Type: "Metadata",
    Subtype: "XML",
    Marker: PDFString.of("direct custom metadata"),
  });
  page.node.set(
    PDFName.of("PrivateCarrier"),
    document.context.obj({
      Layers: [
        document.context.obj({ Payload: customXmp }),
        directMetadata,
      ],
    }),
  );

  const associatedPayload = document.context.register(
    document.context.stream(
      new TextEncoder().encode("nested associated file payload"),
      { Type: "EmbeddedFile" },
    ),
  );
  const associatedFileSpec = document.context.register(
    document.context.obj({
      Type: "Filespec",
      F: PDFString.of("nested-secret.txt"),
      EF: { F: associatedPayload },
      AFRelationship: "Data",
    }),
  );
  const untypedNestedMetadata = document.context.register(
    document.context.stream(
      new TextEncoder().encode("untyped nested metadata stream"),
      { Subtype: "XML" },
    ),
  );
  const formWithAssociatedFile = document.context.register(
    document.context.stream(new Uint8Array(), {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 1, 1],
      Resources: {},
      AF: [associatedFileSpec],
      Metadata: untypedNestedMetadata,
    }),
  );
  page.node.setXObject(
    PDFName.of("PrivateAssociatedFileCarrier"),
    formWithAssociatedFile,
  );

  document.context.trailerInfo.ID = document.context.obj([
    PDFHexString.of("DEADBEEF"),
    PDFHexString.of("CAFEBABE"),
  ]);
  page.node.set(
    PDFName.of("AA"),
    document.context.obj({ O: scriptActionRef }),
  );

  const link = document.context.register(
    document.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [40, 220, 220, 245],
      A: launchActionRef,
    }),
  );
  page.node.addAnnot(link);

  return document.save({ useObjectStreams: true });
}

async function createPdfWithPageCount(pageCount) {
  const document = await PDFDocument.create({ updateMetadata: false });
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([100, 100]);
  }
  return document.save({ useObjectStreams: true });
}

async function createDeepSecurityCarrierFixture(depth = 6_000) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 100]);
  const metadata = document.context.register(
    document.context.stream(
      new TextEncoder().encode("DEEP_METADATA_MARKER"),
      { Type: "Metadata", Subtype: "XML" },
    ),
  );
  const action = document.context.register(
    document.context.obj({
      Type: "Action",
      S: "JavaScript",
      JS: PDFString.of("DEEP_ACTION_MARKER"),
    }),
  );

  let carrier = document.context.register(
    document.context.obj({
      Metadata: metadata,
      Payload: action,
    }),
  );
  for (let index = 0; index < depth; index += 1) {
    carrier = document.context.register(
      document.context.obj({ Carrier: carrier }),
    );
  }
  page.node.set(PDFName.of("DeepCarrier"), carrier);
  return document.save({ useObjectStreams: true });
}

async function createDeepAcroFormFixture(depth = 6_000) {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([100, 100]);

  let field = document.context.register(
    document.context.obj({
      FT: "Tx",
      T: PDFString.of("leaf"),
    }),
  );
  for (let index = 0; index < depth; index += 1) {
    field = document.context.register(
      document.context.obj({
        T: PDFString.of("branch"),
        Kids: [field],
      }),
    );
  }
  document.catalog.set(
    PDFName.of("AcroForm"),
    document.context.obj({ Fields: [field] }),
  );
  return document.save({ useObjectStreams: true });
}

async function createDeepPageTreeFixture(depth = 6_000) {
  const document = await PDFDocument.create({ updateMetadata: false });
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

function oversizedPngHeader() {
  const bytes = new Uint8Array(24);
  bytes.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 12_001, false);
  view.setUint32(20, 1, false);
  return bytes;
}

function oversizedJpegHeader() {
  const bytes = new Uint8Array(21);
  bytes.set([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11,
    0x08,
    0xff, 0xff,
    0xff, 0xff,
  ]);
  return bytes;
}

test(
  "bounds extreme page ranges to the source page count",
  { timeout: 2_000 },
  async () => {
    const source = await createPageRangeFixture();
    const result = await processPdfTool(
      "merge-pdf",
      [asPdfBlob(source)],
      { pagesByFile: ["999999999-1"] },
    );
    const output = await PDFDocument.load(await result.blob.arrayBuffer(), {
      updateMetadata: false,
    });

    assert.deepEqual(
      output.getPages().map((page) => page.getWidth()),
      [300, 200, 100],
    );

    await assert.rejects(
      processPdfTool(
        "merge-pdf",
        [asPdfBlob(source)],
        { pagesByFile: ["999999998-999999999"] },
      ),
      (error) =>
        error instanceof PdfToolError &&
        error.code === "INVALID_PAGE_SELECTION",
    );
  },
);

test("sanitize and flatten removes standard active PDF entry points", async () => {
  const source = await createActivePdfFixture();
  const result = await processPdfTool(
    "flatten-pdf",
    [asPdfBlob(source)],
    {},
  );
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const output = await PDFDocument.load(bytes, { updateMetadata: false });

  assert.equal(result.filename, "document-1-sanitized.pdf");
  assert.match(result.message ?? "", /flattened 1 form field/i);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.context.trailerInfo.Info, undefined);
  assert.equal(output.context.trailerInfo.ID, undefined);

  for (const key of [
    "OpenAction",
    "AA",
    "Names",
    "Outlines",
    "AcroForm",
    "AF",
    "Collection",
    "Perms",
    "Metadata",
  ]) {
    assert.equal(output.catalog.has(PDFName.of(key)), false, key);
  }

  const outputPage = output.getPage(0);
  for (const key of [
    "AA",
    "Annots",
    "AF",
    "Actions",
    "Metadata",
    "PieceInfo",
    "LastModified",
  ]) {
    assert.equal(outputPage.node.has(PDFName.of(key)), false, key);
  }

  for (const [, object] of output.context.enumerateIndirectObjects()) {
    const dictionary =
      object instanceof PDFDict
        ? object
        : object instanceof PDFStream
          ? object.dict
          : null;
    if (!dictionary) continue;

    for (const key of [
      "OpenAction",
      "AA",
      "JavaScript",
      "JS",
      "Launch",
      "EmbeddedFiles",
      "EF",
      "AF",
      "Annots",
      "EF",
      "EmbeddedFiles",
    ]) {
      assert.equal(dictionary.has(PDFName.of(key)), false, key);
    }
    assert.notEqual(
      dictionary.get(PDFName.of("S"))?.toString(),
      "/JavaScript",
    );
    assert.notEqual(
      dictionary.get(PDFName.of("S"))?.toString(),
      "/Launch",
    );
    assert.notEqual(
      dictionary.get(PDFName.of("Type"))?.toString(),
      "/Filespec",
    );
    assert.notEqual(
      dictionary.get(PDFName.of("Type"))?.toString(),
      "/EmbeddedFile",
    );
    assert.notEqual(
      dictionary.get(PDFName.of("Type"))?.toString(),
      "/Metadata",
    );
  }

  const serialized = new TextDecoder().decode(bytes);
  assert.doesNotMatch(
    serialized,
    /app\.alert|payload\.exe|embedded secret|nested associated file payload|nested-secret\.txt|nested custom XMP|direct custom metadata|untyped nested metadata stream|DEADBEEF|CAFEBABE/,
  );

  const loadingTask = getDocument({ data: bytes, verbosity: 0 });
  const preview = await loadingTask.promise;
  try {
    const textContent = await (await preview.getPage(1)).getTextContent();
    const visibleText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    assert.match(visibleText, /Visible page content/);
    assert.match(visibleText, /Visible form value/);
  } finally {
    await loadingTask.destroy();
  }
});

test("removeMetadata always emits mutated bytes without Info or XMP", async () => {
  const source = await createActivePdfFixture();
  const result = await processPdfTool(
    "compress-pdf",
    [asPdfBlob(source)],
    {
      keepSmallest: true,
      removeMetadata: true,
    },
  );
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const output = await PDFDocument.load(bytes, { updateMetadata: false });

  assert.notDeepEqual(bytes, source);
  assert.equal(output.context.trailerInfo.Info, undefined);
  assert.equal(output.context.trailerInfo.ID, undefined);
  assert.equal(output.catalog.has(PDFName.of("Metadata")), false);
  assert.equal(output.getPage(0).node.has(PDFName.of("Metadata")), false);
  for (const [, object] of output.context.enumerateIndirectObjects()) {
    const dictionary =
      object instanceof PDFDict
        ? object
        : object instanceof PDFStream
          ? object.dict
          : null;
    assert.notEqual(
      dictionary?.get(PDFName.of("Type"))?.toString(),
      "/Metadata",
    );
  }

  const serialized = new TextDecoder().decode(bytes);
  assert.doesNotMatch(
    serialized,
    /private title|private author|catalog metadata|page metadata|nested custom XMP|direct custom metadata|untyped nested metadata stream|DEADBEEF|CAFEBABE/,
  );
});

test("aggressive compression cannot copy nested metadata carriers", async () => {
  const source = await createActivePdfFixture();
  const result = await processPdfTool(
    "compress-pdf",
    [asPdfBlob(source)],
    {
      aggressive: true,
      removeMetadata: true,
    },
  );
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const output = await PDFDocument.load(bytes, { updateMetadata: false });

  assert.equal(output.context.trailerInfo.Info, undefined);
  assert.equal(output.context.trailerInfo.ID, undefined);
  for (const [, object] of output.context.enumerateIndirectObjects()) {
    const dictionary =
      object instanceof PDFDict
        ? object
        : object instanceof PDFStream
          ? object.dict
          : null;
    assert.notEqual(
      dictionary?.get(PDFName.of("Type"))?.toString(),
      "/Metadata",
    );
  }

  const serialized = new TextDecoder().decode(bytes);
  assert.doesNotMatch(
    serialized,
    /nested custom XMP|direct custom metadata|untyped nested metadata stream|DEADBEEF|CAFEBABE/,
  );
});

test(
  "rejects oversized and duplicative page selectors before allocation",
  { timeout: 2_000 },
  async () => {
    const source = await createPageRangeFixture();
    const blob = asPdfBlob(source);
    const selections = [
      {
        slug: "merge-pdf",
        options: { pagesByFile: ["1,".repeat(20_000)] },
        code: "SECURITY_LIMIT_EXCEEDED",
        message: /500-page limit/i,
      },
      {
        slug: "merge-pdf",
        options: { pagesByFile: ["1,".repeat(501)] },
        code: "SECURITY_LIMIT_EXCEEDED",
        message: /500-page limit/i,
      },
      {
        slug: "merge-pdf",
        options: {
          pagesByFile: [Array.from({ length: 501 }, () => 1)],
        },
        code: "SECURITY_LIMIT_EXCEEDED",
        message: /500-page limit/i,
      },
      {
        slug: "split-pdf",
        options: { ranges: `${"1,".repeat(501)};2` },
        code: "SECURITY_LIMIT_EXCEEDED",
        message: /500-page limit/i,
      },
      {
        slug: "split-pdf",
        options: {
          ranges: Array.from({ length: 501 }, () => "1").join(";"),
        },
        code: "INVALID_PAGE_SELECTION",
        message: /too many output groups/i,
      },
      {
        slug: "split-pdf",
        options: {
          ranges: Array.from({ length: 167 }, () => "1-3").join(";"),
        },
        code: "SECURITY_LIMIT_EXCEEDED",
        message: /500-page limit/i,
      },
    ];

    for (const { slug, options, code, message } of selections) {
      await assert.rejects(
        processPdfTool(slug, [blob], options),
        (error) =>
          error instanceof PdfToolError &&
          error.code === code &&
          message.test(error.message),
        `${slug}: ${code}`,
      );
    }
  },
);

test(
  "deep indirect carrier graphs are sanitized without call-stack exhaustion",
  { timeout: 15_000 },
  async () => {
    const source = await createDeepSecurityCarrierFixture();
    const compressed = await processPdfTool(
      "compress-pdf",
      [asPdfBlob(source)],
      { removeMetadata: true },
    );
    assert.doesNotMatch(
      new TextDecoder().decode(
        new Uint8Array(await compressed.blob.arrayBuffer()),
      ),
      /DEEP_METADATA_MARKER/,
    );

    const aggressivelyCompressed = await processPdfTool(
      "compress-pdf",
      [asPdfBlob(source)],
      { aggressive: true, removeMetadata: true },
    );
    assert.doesNotMatch(
      new TextDecoder().decode(
        new Uint8Array(
          await aggressivelyCompressed.blob.arrayBuffer(),
        ),
      ),
      /DEEP_METADATA_MARKER/,
    );

    const flattened = await processPdfTool(
      "flatten-pdf",
      [asPdfBlob(source)],
      {},
    );
    const flattenedBytes = new Uint8Array(
      await flattened.blob.arrayBuffer(),
    );
    assert.doesNotMatch(
      new TextDecoder().decode(flattenedBytes),
      /DEEP_METADATA_MARKER|DEEP_ACTION_MARKER/,
    );
    const output = await PDFDocument.load(flattenedBytes, {
      updateMetadata: false,
    });
    assert.equal(output.getPageCount(), 1);

    for (const [slug, options] of [
      ["merge-pdf", {}],
      ["split-pdf", { ranges: "1;1" }],
    ]) {
      await assert.rejects(
        processPdfTool(slug, [asPdfBlob(source)], options),
        (error) =>
          error instanceof PdfToolError &&
          error.code === "SECURITY_LIMIT_EXCEEDED" &&
          /object graph.*limit/i.test(error.message),
        slug,
      );
    }
  },
);

test("rejects hidden text-mutation tools before reading any file body", async () => {
  let bodyWasRead = false;
  const unreadablePdf = {
    name: "must-not-be-read.pdf",
    size: 10,
    type: PDF_TYPE,
    async arrayBuffer() {
      bodyWasRead = true;
      throw new Error("hidden tools must fail before file I/O");
    },
    slice() {
      bodyWasRead = true;
      throw new Error("hidden tools must fail before file I/O");
    },
  };

  for (const [slug, options] of [
    ["watermark-pdf", { watermarkText: "w".repeat(1_001) }],
    [
      "edit-pdf-metadata",
      { metadata: { title: "m".repeat(4_097) } },
    ],
  ]) {
    await assert.rejects(
      processPdfTool(slug, [unreadablePdf], options),
      (error) =>
        error instanceof PdfToolError &&
        error.code === "UNSUPPORTED_TOOL",
      slug,
    );
  }
  assert.equal(bodyWasRead, false);
});

test(
  "bounds a deeply nested AcroForm before pdf-lib form traversal",
  { timeout: 15_000 },
  async () => {
    const source = await createDeepAcroFormFixture();
    const result = await processPdfTool(
      "flatten-pdf",
      [asPdfBlob(source)],
      {},
    );
    const output = await PDFDocument.load(
      await result.blob.arrayBuffer(),
      { updateMetadata: false },
    );

    assert.equal(output.getPageCount(), 1);
    assert.equal(output.catalog.has(PDFName.of("AcroForm")), false);
  },
);

test(
  "rejects a deep page tree before pdf-lib recursively enumerates pages",
  { timeout: 15_000 },
  async () => {
    const source = await createDeepPageTreeFixture();

    for (const [slug, options] of [
      ["compress-pdf", {}],
      ["compress-pdf", { removeMetadata: true }],
      ["flatten-pdf", {}],
    ]) {
      await assert.rejects(
        processPdfTool(slug, [asPdfBlob(source)], options),
        (error) =>
          error instanceof PdfToolError &&
          error.code === "SECURITY_LIMIT_EXCEEDED" &&
          /object graph.*limit/i.test(error.message),
        slug,
      );
    }
  },
);

test("rejects PDFs above the page-count policy after loading", async () => {
  const source = await createPdfWithPageCount(501);

  await assert.rejects(
    processPdfTool("compress-pdf", [asPdfBlob(source)], {}),
    (error) =>
      error instanceof PdfToolError &&
      error.code === "SECURITY_LIMIT_EXCEEDED" &&
      /500-page limit/i.test(error.message),
  );
});

test("rejects aggregate output above the page-count policy", async () => {
  const source = await createPdfWithPageCount(251);
  const blob = asPdfBlob(source);

  await assert.rejects(
    processPdfTool("merge-pdf", [blob, blob], {}),
    (error) =>
      error instanceof PdfToolError &&
      error.code === "SECURITY_LIMIT_EXCEEDED" &&
      /500-page limit/i.test(error.message),
  );
});

test("rejects oversized PNG and JPEG dimensions before decoding", async () => {
  for (const [type, bytes] of [
    ["image/png", oversizedPngHeader()],
    ["image/jpeg", oversizedJpegHeader()],
  ]) {
    await assert.rejects(
      processPdfTool("jpg-to-pdf", [new Blob([bytes], { type })], {}),
      (error) =>
        error instanceof PdfToolError &&
        error.code === "SECURITY_LIMIT_EXCEEDED" &&
        /12(?:,)?000 px|40 megapixels/i.test(error.message),
      type,
    );
  }
});

test("rejects an oversized image before reading its body", async () => {
  let bodyWasRead = false;
  const oversizedImage = {
    name: "oversized.png",
    size: 20 * 1024 * 1024 + 1,
    type: "image/png",
    async arrayBuffer() {
      bodyWasRead = true;
      throw new Error("body should not be read");
    },
    slice() {
      throw new Error("signature should not be read");
    },
  };

  await assert.rejects(
    processPdfTool("jpg-to-pdf", [oversizedImage], {}),
    (error) =>
      error instanceof PdfToolError &&
      error.code === "SECURITY_LIMIT_EXCEEDED" &&
      /20 MB image limit/i.test(error.message),
  );
  assert.equal(bodyWasRead, false);
});

test("enforces file-count and aggregate-byte limits in the engine", async () => {
  let bodyWasRead = false;
  const fakeBlob = (name, size) => ({
    name,
    size,
    type: PDF_TYPE,
    async arrayBuffer() {
      bodyWasRead = true;
      throw new Error("body should not be read");
    },
    slice() {
      bodyWasRead = true;
      throw new Error("body should not be read");
    },
  });

  await assert.rejects(
    processPdfTool(
      "merge-pdf",
      Array.from({ length: 21 }, (_, index) =>
        fakeBlob(`file-${index}.pdf`, 1),
      ),
      {},
    ),
    (error) =>
      error instanceof PdfToolError &&
      error.code === "SECURITY_LIMIT_EXCEEDED" &&
      /at most 20 files/i.test(error.message),
  );

  await assert.rejects(
    processPdfTool(
      "merge-pdf",
      [
        fakeBlob("one.pdf", 90 * 1024 * 1024),
        fakeBlob("two.pdf", 90 * 1024 * 1024),
        fakeBlob("three.pdf", 90 * 1024 * 1024),
      ],
      {},
    ),
    (error) =>
      error instanceof PdfToolError &&
      error.code === "SECURITY_LIMIT_EXCEEDED" &&
      /250 MB total limit/i.test(error.message),
  );

  assert.equal(bodyWasRead, false);
});
