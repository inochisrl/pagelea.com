import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

import { build } from "esbuild";
import ts from "typescript";

const bundledLimits = await build({
  entryPoints: [
    new URL("../app/lib/pdf-security-limits.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const limits = await import(
  `data:text/javascript;base64,${Buffer.from(
    bundledLimits.outputFiles[0].contents,
  ).toString("base64")}`,
);

test("enforces per-file, image, count, total, and page limits", () => {
  const policy = limits.PDF_SECURITY_LIMITS;

  assert.equal(
    limits.getFileLimitIssue({
      name: "large.pdf",
      size: policy.maxBytesPerFile + 1,
      type: "application/pdf",
    }).code,
    "file-too-large",
  );
  assert.equal(
    limits.getFileLimitIssue({
      name: "large.png",
      size: policy.maxImageBytes + 1,
      type: "image/png",
    }).code,
    "image-too-large",
  );
  assert.equal(
    limits.getFileSelectionLimitIssue(
      Array.from({ length: policy.maxFiles + 1 }, (_, index) => ({
        name: `${index}.pdf`,
        size: 1,
        type: "application/pdf",
      })),
    ).code,
    "too-many-files",
  );
  assert.equal(
    limits.getFileSelectionLimitIssue([
      {
        name: "first.pdf",
        size: policy.maxBytesPerFile,
        type: "application/pdf",
      },
      {
        name: "second.pdf",
        size: policy.maxBytesPerFile,
        type: "application/pdf",
      },
      {
        name: "third.pdf",
        size: policy.maxBytesPerFile,
        type: "application/pdf",
      },
    ]).code,
    "total-too-large",
  );
  assert.equal(
    limits.getPageCountLimitIssue(policy.maxPages + 1).code,
    "too-many-pages",
  );
  assert.equal(limits.getPageCountLimitIssue(policy.maxPages), null);
});

test("reads PNG and JPEG dimensions without decoding image pixels", () => {
  const png = new Uint8Array(24);
  png.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, 640, false);
  new DataView(png.buffer).setUint32(20, 480, false);
  assert.deepEqual(limits.getImageDimensionsFromBytes(png), {
    width: 640,
    height: 480,
  });
  assert.deepEqual(limits.getImageInfoFromBytes(png), {
    kind: "png",
    width: 640,
    height: 480,
  });

  const jpeg = new Uint8Array(21);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  jpeg.set([0x01, 0xe0, 0x02, 0x80], 7);
  assert.deepEqual(limits.getImageDimensionsFromBytes(jpeg), {
    width: 640,
    height: 480,
  });
  assert.equal(limits.getImageInfoFromBytes(jpeg).kind, "jpeg");

  assert.equal(
    limits.getImageDimensionLimitIssue(
      "huge.jpg",
      limits.PDF_SECURITY_LIMITS.maxImageDimension + 1,
      10,
    ).code,
    "image-dimensions-too-large",
  );
  assert.equal(
    limits.getImageDimensionsFromBytes(
      new Uint8Array([0x47, 0x49, 0x46]),
    ),
    null,
  );
});

test("enforces page and document text-content budgets", () => {
  const policy = limits.PDF_SECURITY_LIMITS;

  assert.equal(
    limits.getTextContentLimitIssue(
      policy.maxTextItemsPerPage + 1,
      0,
      "page",
    ).code,
    "too-many-text-items",
  );
  assert.equal(
    limits.getTextContentLimitIssue(
      1,
      policy.maxTextCharactersPerPage + 1,
      "page",
    ).code,
    "too-many-text-characters",
  );
  assert.equal(
    limits.getTextContentLimitIssue(
      policy.maxTextItemsPerDocument,
      policy.maxTextCharactersPerDocument,
      "document",
    ),
    null,
  );

  const currentBudgets = {
    "page-1:0": {
      itemCount: policy.maxTextItemsPerDocument / 2,
      characterCount: policy.maxTextCharactersPerDocument / 2,
    },
    "page-2:0": {
      itemCount: policy.maxTextItemsPerDocument / 2,
      characterCount: policy.maxTextCharactersPerDocument / 2,
    },
  };
  assert.equal(
    limits.getReplacementTextContentLimitIssue(
      currentBudgets,
      ["page-1:0"],
      currentBudgets["page-1:0"],
    ),
    null,
  );
  assert.equal(
    limits.getReplacementTextContentLimitIssue(
      currentBudgets,
      [],
      { itemCount: 1, characterCount: 1 },
    ).code,
    "too-many-text-items",
  );
  assert.deepEqual(
    limits.getTextContentBudget(["abc", "de"]),
    { itemCount: 2, characterCount: 5 },
  );
});

test("bounds all resource-bearing editor element types", () => {
  const policy = limits.PDF_SECURITY_LIMITS;
  const baseElement = (overrides = {}) => ({
    pageId: "page-1",
    type: "shape",
    ...overrides,
  });

  assert.equal(
    limits.getEditorSnapshotLimitIssue(
      Array.from(
        { length: policy.maxEditorElements + 1 },
        (_, index) =>
          baseElement({ pageId: `page-${index}`, type: "shape" }),
      ),
    ).code,
    "too-many-editor-elements",
  );
  assert.deepEqual(
    limits.getEditorSnapshotLimitIssue(
      Array.from(
        { length: policy.maxEditorElementsPerPage + 1 },
        () => baseElement(),
      ),
    ),
    {
      code: "too-many-editor-elements",
      scope: "page",
      maximum: policy.maxEditorElementsPerPage,
    },
  );
  assert.deepEqual(
    limits.getEditorSnapshotLimitIssue([
      baseElement({
        type: "text",
        text: "x".repeat(
          policy.maxEditorTextCharactersPerElement + 1,
        ),
      }),
    ]),
    {
      code: "too-many-editor-text-characters",
      scope: "element",
      maximum: policy.maxEditorTextCharactersPerElement,
    },
  );
  const maximumText = "x".repeat(
    policy.maxEditorTextCharactersPerElement,
  );
  assert.deepEqual(
    limits.getEditorSnapshotLimitIssue(
      Array.from({ length: 11 }, () =>
        baseElement({ type: "text", text: maximumText }),
      ),
    ),
    {
      code: "too-many-editor-text-characters",
      scope: "document",
      maximum: policy.maxEditorTextCharactersTotal,
    },
  );
  assert.deepEqual(
    limits.getEditorSnapshotLimitIssue([
      baseElement({
        type: "draw",
        points: Array(policy.maxEditorPathPointsPerElement + 1),
      }),
    ]),
    {
      code: "too-many-editor-path-points",
      scope: "stroke",
      maximum: policy.maxEditorPathPointsPerElement,
    },
  );
  const maximumStroke = Array(
    policy.maxEditorPathPointsPerElement,
  );
  assert.deepEqual(
    limits.getEditorSnapshotLimitIssue(
      Array.from({ length: 25 }, () =>
        baseElement({ type: "draw", points: maximumStroke }),
      ),
    ),
    {
      code: "too-many-editor-path-points",
      scope: "document",
      maximum: policy.maxEditorPathPointsTotal,
    },
  );
  assert.equal(
    limits.getEditorSnapshotLimitIssue(
      Array.from(
        { length: policy.maxEditorImageElements + 1 },
        () =>
          baseElement({
            type: "image",
            dataUrl: "data:image/png;base64,AAAA",
            pixelCount: 1,
          }),
      ),
    ).code,
    "too-many-editor-images",
  );
  assert.equal(
    limits.getEditorSnapshotLimitIssue([
      baseElement({
        type: "image",
        dataUrl: "data:image/png;base64,AAAA",
        pixelCount: 30_000_000,
      }),
      baseElement({
        type: "image",
        dataUrl: "data:image/png;base64,AAAB",
        pixelCount: 30_000_000,
      }),
      baseElement({
        type: "image",
        dataUrl: "data:image/png;base64,AAAC",
        pixelCount: 30_000_000,
      }),
    ]).code,
    "editor-image-pixels-too-large",
  );
});

test("bounds raster volume without silently dropping below 72 DPI", () => {
  const policy = limits.PDF_SECURITY_LIMITS;
  const withinBudget = {
    pageCount: policy.maxEditorRasterPages,
    canvasPixelCount:
      policy.maxEditorRasterCanvasPixelsTotal,
    encodedByteCount:
      policy.maxEditorRasterEncodedBytesTotal,
  };

  assert.equal(
    limits.getEditorRasterBudgetLimitIssue(withinBudget),
    null,
  );
  assert.deepEqual(
    limits.getEditorRasterBudgetLimitIssue({
      ...withinBudget,
      pageCount: withinBudget.pageCount + 1,
    }),
    {
      code: "too-many-editor-raster-pages",
      maximum: policy.maxEditorRasterPages,
    },
  );
  assert.deepEqual(
    limits.getEditorRasterBudgetLimitIssue({
      ...withinBudget,
      canvasPixelCount: withinBudget.canvasPixelCount + 1,
    }),
    {
      code: "editor-raster-pixels-too-large",
      maximum: policy.maxEditorRasterCanvasPixelsTotal,
    },
  );
  assert.deepEqual(
    limits.getEditorRasterBudgetLimitIssue({
      ...withinBudget,
      encodedByteCount: withinBudget.encodedByteCount + 1,
    }),
    {
      code: "editor-raster-bytes-too-large",
      maximum: policy.maxEditorRasterEncodedBytesTotal,
    },
  );

  const letterWidth = 612;
  const letterHeight = 792;
  const minimumPixels =
    Math.ceil(letterWidth * policy.editorRasterMinimumScale) *
    Math.ceil(letterHeight * policy.editorRasterMinimumScale);
  assert.equal(policy.editorRasterMinimumScale, 1);
  assert.equal(
    limits.getEditorRasterMinimumScaleLimitIssue(
      letterWidth,
      letterHeight,
      minimumPixels,
    ),
    null,
  );
  assert.deepEqual(
    limits.getEditorRasterMinimumScaleLimitIssue(
      letterWidth,
      letterHeight,
      minimumPixels - 1,
    ),
    {
      code: "editor-raster-fidelity-too-low",
      maximum: 72,
    },
  );
});

test("decimates long strokes while preserving endpoints", () => {
  const values = Array.from({ length: 20 }, (_, index) => index);
  const decimated = limits.decimateSequence(values, 6);

  assert.equal(decimated.length, 6);
  assert.equal(decimated[0], 0);
  assert.equal(decimated.at(-1), 19);
  assert.deepEqual(limits.decimateSequence([1, 2], 4), [1, 2]);
});

test("bounds production free-text fields before processing", () => {
  const maximum = limits.PDF_SECURITY_LIMITS.maxSignatureNameCharacters;
  assert.equal(
    limits.getTextFieldLimitIssue(
      "Signature name",
      "x".repeat(maximum + 1),
      maximum,
    ).code,
    "text-field-too-long",
  );
});

test("thumbnail visibility follows both observer entry and exit", () => {
  assert.equal(
    limits.shouldRenderObservedArea([{ isIntersecting: false }]),
    false,
  );
  assert.equal(
    limits.shouldRenderObservedArea([
      { isIntersecting: false },
      { isIntersecting: true },
    ]),
    true,
  );
  assert.equal(limits.shouldRenderObservedArea([]), false);
});

test("all local-only free-text fields disable browser writing services", async () => {
  const [editorSource, toolSource] = await Promise.all([
    readFile(
      new URL("../app/components/PdfEditorWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/ToolWorkspace.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  const sources = [
    ["PdfEditorWorkspace.tsx", editorSource],
    ["ToolWorkspace.tsx", toolSource],
  ];
  const freeTextFields = [];

  for (const [fileName, source] of sources) {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (
        ts.isJsxOpeningElement(node) ||
        ts.isJsxSelfClosingElement(node)
      ) {
        const tagName = node.tagName.getText(sourceFile);
        const attributes = node.attributes.properties.filter(
          ts.isJsxAttribute,
        );
        const typeAttribute = attributes.find(
          (attribute) =>
            attribute.name.getText(sourceFile) === "type",
        );
        const inputType =
          typeAttribute?.initializer &&
          ts.isStringLiteral(typeAttribute.initializer)
            ? typeAttribute.initializer.text.toLowerCase()
            : "text";
        if (
          tagName === "textarea" ||
          (tagName === "input" &&
            new Set([
              "email",
              "password",
              "search",
              "tel",
              "text",
              "url",
            ]).has(inputType))
        ) {
          freeTextFields.push({
            attributes,
            fileName,
            sourceFile,
            tag: node.getText(sourceFile).slice(0, 120),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.ok(
    freeTextFields.length >= 5,
    "expected every production editor and tool free-text field to be inspected",
  );
  for (const field of freeTextFields) {
    for (const name of [
      "autoCapitalize",
      "autoComplete",
      "autoCorrect",
    ]) {
      const attribute = field.attributes.find(
        (candidate) =>
          candidate.name.getText(field.sourceFile) === name,
      );
      assert.ok(
        attribute?.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === "off",
        `${field.fileName}: ${name} must be "off" on ${field.tag}`,
      );
    }
    assert.ok(
      field.attributes.some(
        (candidate) =>
          candidate.name.getText(field.sourceFile) === "maxLength",
      ),
      `${field.fileName}: maxLength is required on ${field.tag}`,
    );
    const spellCheck = field.attributes.find(
      (candidate) =>
        candidate.name.getText(field.sourceFile) === "spellCheck",
    );
    assert.ok(
      spellCheck?.initializer &&
        ts.isJsxExpression(spellCheck.initializer) &&
        spellCheck.initializer.expression?.kind ===
          ts.SyntaxKind.FalseKeyword,
      `${field.fileName}: spellCheck must be false on ${field.tag}`,
    );
  }
});

test("bounded mapper preserves order and never exceeds its concurrency", async () => {
  let active = 0;
  let peak = 0;
  const result = await limits.mapWithConcurrency(
    Array.from({ length: 17 }, (_, index) => index),
    4,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(2);
      active -= 1;
      return value * 2;
    },
  );

  assert.equal(peak, 4);
  assert.deepEqual(
    result,
    Array.from({ length: 17 }, (_, index) => index * 2),
  );
});

test("queued limited tasks can be aborted without being executed", async () => {
  const runLimited = limits.createTaskLimiter(1);
  let releaseFirst;
  const first = runLimited(
    () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const controller = new globalThis.AbortController();
  let secondRan = false;
  const second = runLimited(async () => {
    secondRan = true;
  }, controller.signal);

  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  releaseFirst();
  await first;
  assert.equal(secondRan, false);
});
