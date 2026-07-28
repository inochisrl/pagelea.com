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

function addedTextElement(overrides = {}) {
  const element = textElement({
    id: "added-text-1",
    text: "Added text",
    ...overrides,
  });
  Reflect.deleteProperty(element, "sourceText");
  return element;
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

test("a focused create applies exactly one immutable added-text element", () => {
  const existing = textElement({ id: "existing-replacement" });
  const current = { pages: [], elements: [existing] };
  const draft = addedTextElement();
  const result = applyFocusedTextReplacement(current, draft, "create");

  assert.notEqual(result.snapshot, current);
  assert.deepEqual(current.elements, [existing]);
  assert.equal(result.snapshot.elements.length, 2);
  assert.equal(result.snapshot.elements[0], existing);
  assert.equal(result.snapshot.elements[1], draft);
  assert.equal(result.snapshot.elements[1].sourceText, undefined);
  assert.equal(result.elementId, draft.id);
  assert.equal(result.outcome, "applied");
});

test("an empty focused create without source text does not persist an invisible element", () => {
  const current = { pages: [], elements: [] };
  const result = applyFocusedTextReplacement(
    current,
    addedTextElement({ text: "" }),
    "create",
  );

  assert.equal(result.snapshot, current);
  assert.deepEqual(result.snapshot.elements, []);
  assert.equal(result.outcome, "unchanged");
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

test("a focused update modifies an added-text element immutably", () => {
  const existing = addedTextElement({
    text: "Before",
    x: 0.2,
  });
  const sibling = textElement({ id: "source-replacement-sibling" });
  const current = { pages: [], elements: [existing, sibling] };
  const draft = addedTextElement({
    text: "After",
    direction: "rtl",
    x: 0.45,
  });
  const result = applyFocusedTextReplacement(current, draft, "update");

  assert.notEqual(result.snapshot, current);
  assert.equal(result.snapshot.elements.length, 2);
  assert.equal(result.snapshot.elements[0], draft);
  assert.equal(result.snapshot.elements[1], sibling);
  assert.equal(result.snapshot.elements[0].sourceText, undefined);
  assert.equal(current.elements[0].text, "Before");
  assert.equal(current.elements[0].x, 0.2);
  assert.equal(result.elementId, draft.id);
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

test("clearing added text removes only that element", () => {
  const existing = addedTextElement({ text: "Remove me" });
  const sibling = textElement({ id: "source-replacement-sibling" });
  const current = { pages: [], elements: [existing, sibling] };
  const result = applyFocusedTextReplacement(
    current,
    addedTextElement({ text: "" }),
    "update",
  );

  assert.notEqual(result.snapshot, current);
  assert.deepEqual(result.snapshot.elements, [sibling]);
  assert.equal(current.elements[0], existing);
  assert.equal(result.elementId, existing.id);
  assert.equal(result.outcome, "applied");
});

test("an unchanged added-text update preserves snapshot identity", () => {
  const existing = addedTextElement();
  const current = { pages: [], elements: [existing] };
  const result = applyFocusedTextReplacement(
    current,
    addedTextElement(),
    "update",
  );

  assert.equal(result.snapshot, current);
  assert.equal(result.elementId, existing.id);
  assert.equal(result.outcome, "unchanged");
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
