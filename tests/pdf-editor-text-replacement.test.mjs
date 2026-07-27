import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const { applyFocusedTextReplacement } = await importBundledModule(
  "../app/lib/pdf-editor-text-replacement.ts",
  import.meta.url,
);

function sourceText(id = "fragment-1") {
  return {
    id,
    kind: "native",
    pageIndex: 0,
    originalText: "Original",
    originalX: 0.1,
    originalY: 0.2,
    originalWidth: 0.3,
    originalHeight: 0.05,
    originalRotation: 0,
    originalBackgroundColor: "#ffffff",
  };
}

function textElement(overrides = {}) {
  return {
    id: "replacement-1",
    pageId: "page-1",
    type: "text",
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.05,
    opacity: 1,
    text: "Replacement",
    fontSize: 12,
    fontFamily: "Helvetica",
    direction: "ltr",
    color: "#111111",
    bold: false,
    italic: false,
    sourceText: sourceText(),
    ...overrides,
  };
}

test("a focused create applies exactly one immutable replacement", () => {
  const current = { pages: [], elements: [] };
  const draft = textElement();
  const result = applyFocusedTextReplacement(current, draft, "create");

  assert.notEqual(result.snapshot, current);
  assert.deepEqual(current.elements, []);
  assert.equal(result.snapshot.elements.length, 1);
  assert.equal(result.snapshot.elements[0], draft);
  assert.equal(result.elementId, draft.id);
  assert.equal(result.outcome, "applied");
});

test("rapid duplicate activation upserts the same source instead of appending", () => {
  const existing = textElement({
    id: "committed-replacement",
    text: "First edit",
    x: 0.55,
  });
  const current = { pages: [], elements: [existing] };
  const duplicateDraft = textElement({
    id: "duplicate-draft",
    text: "Second edit",
    x: 0.1,
  });
  const result = applyFocusedTextReplacement(
    current,
    duplicateDraft,
    "create",
  );

  assert.equal(result.snapshot.elements.length, 1);
  assert.equal(result.elementId, existing.id);
  assert.equal(result.snapshot.elements[0].id, existing.id);
  assert.equal(result.snapshot.elements[0].text, "Second edit");
  assert.equal(result.snapshot.elements[0].x, 0.55);
  assert.equal(result.outcome, "applied");
});

test("an update can remove text without deleting its immutable source repair", () => {
  const existing = textElement();
  const current = { pages: [], elements: [existing] };
  const emptyDraft = textElement({ text: "" });
  const result = applyFocusedTextReplacement(
    current,
    emptyDraft,
    "update",
  );

  assert.equal(result.snapshot.elements.length, 1);
  assert.equal(result.snapshot.elements[0].text, "");
  assert.equal(
    result.snapshot.elements[0].sourceText.originalText,
    "Original",
  );
  assert.equal(current.elements[0].text, "Replacement");
  assert.equal(result.outcome, "applied");
});

test("unchanged and missing updates preserve snapshot identity", () => {
  const existing = textElement();
  const current = { pages: [], elements: [existing] };
  const unchanged = applyFocusedTextReplacement(
    current,
    textElement(),
    "update",
  );
  const missing = applyFocusedTextReplacement(
    current,
    textElement({ id: "missing" }),
    "update",
  );

  assert.equal(unchanged.snapshot, current);
  assert.equal(missing.snapshot, current);
  assert.equal(unchanged.outcome, "unchanged");
  assert.equal(missing.outcome, "missing");
});
