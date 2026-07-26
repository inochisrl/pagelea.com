import assert from "node:assert/strict";
import { Blob, Buffer } from "node:buffer";
import test from "node:test";
import { TextDecoder } from "node:util";

import { PDFDocument } from "pdf-lib";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const {
  PdfToolError,
  processPdfTool,
} = await importBundledModule("../app/lib/pdf-actions.ts", import.meta.url);
const { createStoredZip } = await importBundledModule(
  "../app/lib/zip.ts",
  import.meta.url,
);

const PDF_MIME_TYPE = "application/pdf";
const decoder = new TextDecoder();

function asPdfBlob(bytes) {
  return new Blob([bytes], { type: PDF_MIME_TYPE });
}

function asPngBlob() {
  return new Blob(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4yQAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    { type: "image/png" },
  );
}

async function createOrderedPageFixture() {
  const document = await PDFDocument.create({ updateMetadata: false });
  for (const width of [100, 200, 300, 400, 500]) {
    document.addPage([width, 100]);
  }
  return document.save({ useObjectStreams: true });
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) !== 0
          ? 0xedb88320 ^ (value >>> 1)
          : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function parseStoredZip(bytes) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  assert.ok(bytes.byteLength >= 22, "ZIP contains an end record");

  const endOffset = bytes.byteLength - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50);
  assert.equal(view.getUint16(endOffset + 4, true), 0, "single disk ZIP");
  assert.equal(view.getUint16(endOffset + 6, true), 0, "single disk ZIP");

  const entryCount = view.getUint16(endOffset + 10, true);
  assert.equal(view.getUint16(endOffset + 8, true), entryCount);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  assert.equal(centralOffset + centralSize, endOffset);
  assert.equal(view.getUint16(endOffset + 20, true), 0, "no ZIP comment");

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint16(offset + 8, true), 0x0800, "UTF-8 flag");
    assert.equal(view.getUint16(offset + 10, true), 0, "STORE method");
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    assert.equal(compressedSize, uncompressedSize);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    assert.equal(view.getUint16(localOffset + 6, true), 0x0800);
    assert.equal(view.getUint16(localOffset + 8, true), 0);
    assert.equal(view.getUint32(localOffset + 14, true), expectedCrc);
    assert.equal(view.getUint32(localOffset + 18, true), compressedSize);
    assert.equal(view.getUint32(localOffset + 22, true), uncompressedSize);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    assert.equal(
      decoder.decode(
        bytes.subarray(
          localOffset + 30,
          localOffset + 30 + localNameLength,
        ),
      ),
      name,
    );
    const dataOffset =
      localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataOffset, dataOffset + compressedSize);
    assert.equal(crc32(data), expectedCrc, `${name} CRC`);

    entries.push({ name, bytes: data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset);
  return entries;
}

test("split-pdf creates an ordered multi-entry ZIP with the selected ranges", async () => {
  const source = await createOrderedPageFixture();
  const result = await processPdfTool(
    "split-pdf",
    [asPdfBlob(source)],
    { ranges: "3,1; 2-4; 5" },
  );

  assert.equal(result.filename, "document-1-split.zip");
  assert.equal(result.mimeType, "application/zip");
  assert.equal(result.blob.type, "application/zip");
  assert.match(result.message ?? "", /created 3 PDF files/i);

  const archive = new Uint8Array(await result.blob.arrayBuffer());
  const entries = parseStoredZip(archive);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    [
      "document-1-part-01.pdf",
      "document-1-part-02.pdf",
      "document-1-part-03.pdf",
    ],
  );

  const pageWidths = [];
  for (const entry of entries) {
    const document = await PDFDocument.load(entry.bytes, {
      updateMetadata: false,
    });
    pageWidths.push(
      document.getPages().map((page) => page.getWidth()),
    );
  }
  assert.deepEqual(pageWidths, [
    [300, 100],
    [200, 300, 400],
    [500],
  ]);
});

test("split-pdf requires at least two explicit output groups", async () => {
  const source = await createOrderedPageFixture();
  await assert.rejects(
    processPdfTool(
      "split-pdf",
      [asPdfBlob(source)],
      { ranges: "1-5" },
    ),
    (error) =>
      error instanceof PdfToolError &&
      error.code === "MISSING_SPLIT_GROUPS",
  );
});

test("merge-pdf preserves the requested source order and selected pages", async () => {
  const first = await PDFDocument.create({ updateMetadata: false });
  first.addPage([100, 100]);
  first.addPage([110, 100]);
  const second = await PDFDocument.create({ updateMetadata: false });
  second.addPage([200, 100]);

  const result = await processPdfTool(
    "merge-pdf",
    [
      asPdfBlob(await first.save({ useObjectStreams: true })),
      asPdfBlob(await second.save({ useObjectStreams: true })),
    ],
    {
      fileOrder: [1, 0],
      pagesByFile: { 0: "2", 1: "1" },
    },
  );
  const output = await PDFDocument.load(
    new Uint8Array(await result.blob.arrayBuffer()),
    { updateMetadata: false },
  );

  assert.equal(result.filename, "merged.pdf");
  assert.equal(result.mimeType, PDF_MIME_TYPE);
  assert.deepEqual(
    output.getPages().map((page) => page.getWidth()),
    [200, 110],
  );
});

test("jpg-to-pdf creates one correctly sized page per image", async () => {
  const result = await processPdfTool(
    "jpg-to-pdf",
    [asPngBlob(), asPngBlob()],
    {
      pageSize: "a4",
      orientation: "landscape",
      imageFit: "contain",
      margin: 18,
    },
  );
  const output = await PDFDocument.load(
    new Uint8Array(await result.blob.arrayBuffer()),
    { updateMetadata: false },
  );

  assert.equal(result.filename, "images.pdf");
  assert.equal(output.getPageCount(), 2);
  for (const page of output.getPages()) {
    assert.ok(page.getWidth() > page.getHeight());
    assert.ok(Math.abs(page.getWidth() - 841.89) < 0.01);
    assert.ok(Math.abs(page.getHeight() - 595.28) < 0.01);
  }
});

test("compress-pdf can remove metadata without returning original bytes", async () => {
  const source = await PDFDocument.create({ updateMetadata: false });
  source.addPage([120, 120]);
  source.setTitle("Private title");
  source.setAuthor("Private author");
  const original = await source.save({ useObjectStreams: false });

  const result = await processPdfTool(
    "compress-pdf",
    [asPdfBlob(original)],
    {
      aggressive: true,
      keepSmallest: true,
      removeMetadata: true,
    },
  );
  const outputBytes = new Uint8Array(await result.blob.arrayBuffer());
  const output = await PDFDocument.load(outputBytes, {
    updateMetadata: false,
  });

  assert.notDeepEqual(outputBytes, original);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.getTitle(), undefined);
  assert.equal(output.getAuthor(), undefined);
});

test("flatten-pdf returns a rebuilt, valid document with metadata removed", async () => {
  const source = await PDFDocument.create({ updateMetadata: false });
  source.addPage([130, 140]);
  source.setTitle("Remove me");

  const result = await processPdfTool(
    "flatten-pdf",
    [asPdfBlob(await source.save({ useObjectStreams: true }))],
  );
  const output = await PDFDocument.load(
    new Uint8Array(await result.blob.arrayBuffer()),
    { updateMetadata: false },
  );

  assert.match(result.filename, /-sanitized\.pdf$/);
  assert.match(result.message ?? "", /active annotations.*removed/i);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.getTitle(), undefined);
});

test("the PDF engine rejects unknown and hidden catalogue slugs", async () => {
  const source = await createOrderedPageFixture();
  for (const slug of [
    "watermark-pdf",
    "extract-pdf-pages",
    "rotate-pdf-pages",
    "not-a-pagelea-tool",
  ]) {
    await assert.rejects(
      processPdfTool(slug, [asPdfBlob(source)], {}),
      (error) =>
        error instanceof PdfToolError &&
        error.code === "UNSUPPORTED_TOOL",
      slug,
    );
  }
});

test("the ZIP writer sanitizes entry names and emits valid CRCs", () => {
  const zip = createStoredZip(
    [
      {
        name: "../../private/../first.pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
      {
        name: String.raw`folder\..\second.pdf`,
        bytes: new Uint8Array([4, 5]),
      },
      { name: "", bytes: new Uint8Array([6]) },
    ],
    new Date("2026-07-26T12:00:00.000Z"),
  );
  const entries = parseStoredZip(zip);

  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["private-first.pdf", "folder-second.pdf", "document-3.pdf"],
  );
  for (const entry of entries) {
    assert.doesNotMatch(entry.name, /(?:^|\/)\.\.(?:\/|$)|[\\/]/);
  }
});

test("the ZIP writer enforces entry-count and ZIP32 size bounds", () => {
  assert.throws(
    () => createStoredZip([]),
    /entry count.*supported range/i,
  );
  assert.throws(
    () =>
      createStoredZip(
        Array.from({ length: 1_001 }, (_, index) => ({
          name: `${index}.pdf`,
          bytes: new Uint8Array(),
        })),
      ),
    /entry count.*supported range/i,
  );
  assert.throws(
    () =>
      createStoredZip([
        {
          name: "oversized.pdf",
          bytes: { byteLength: 0x1_0000_0000 },
        },
      ]),
    /4 GB/i,
  );
});
