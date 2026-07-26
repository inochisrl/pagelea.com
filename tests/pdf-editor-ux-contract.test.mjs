import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

const [editorSource, editorCss, exportSource, toolsSource] = await Promise.all([
  readFile(
    new URL("app/components/PdfEditorWorkspace.tsx", projectRoot),
    "utf8",
  ),
  readFile(
    new URL("app/components/PdfEditorWorkspace.module.css", projectRoot),
    "utf8",
  ),
  readFile(new URL("app/lib/pdf-editor-export.ts", projectRoot), "utf8"),
  readFile(new URL("app/lib/tools.ts", projectRoot), "utf8"),
]);

test("editor keeps page management usable on narrow screens", () => {
  const mobileRules = editorCss.slice(
    editorCss.indexOf("@media (max-width: 760px)"),
    editorCss.indexOf("@media (prefers-reduced-motion: reduce)"),
  );

  assert.match(mobileRules, /\.thumbControls\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(
    mobileRules,
    /grid-template-columns:\s*repeat\(2,\s*44px\);/,
  );
  assert.match(
    mobileRules,
    /\.thumbIcon\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  );
  assert.match(mobileRules, /\.thumbnail\s*\{[\s\S]*?width:\s*124px;/);
  assert.doesNotMatch(mobileRules, /\.thumbControls\s*\{[\s\S]*?display:\s*none;/);

  for (const label of [
    'aria-label={`Move page ${index + 1} up`}',
    'aria-label={`Move page ${index + 1} down`}',
    'aria-label={`Rotate page ${index + 1} clockwise`}',
    'aria-label={`Delete page ${index + 1}`}',
  ]) {
    assert.ok(editorSource.includes(label), label);
  }
});

test("editor exposes a coherent keyboard interaction contract", () => {
  assert.match(editorSource, /role="group"/);
  assert.doesNotMatch(editorSource, /role="application"/);
  assert.match(
    editorSource,
    /aria-describedby="pdf-editor-keyboard-instructions"/,
  );
  assert.match(
    editorSource,
    /Use the arrow keys to move it,[\s\S]*Shift plus arrow keys to resize it/,
  );
  assert.match(editorSource, /aria-pressed=\{selected\}/);
  assert.match(editorSource, /event\.shiftKey[\s\S]*?updateElement/);

  const undoBranch = editorSource.slice(
    editorSource.indexOf("const command = event.metaKey || event.ctrlKey"),
    editorSource.indexOf('event.key === "Escape"'),
  );
  assert.match(undoBranch, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(undoBranch, /!isEditableTarget\(event\.target\)/);
});

test("signing copy and export preview stay within implemented capabilities", () => {
  const signStart = toolsSource.indexOf('slug: "sign-pdf"');
  const signEnd = toolsSource.indexOf('slug: "merge-pdf"', signStart);
  const signCopy = toolsSource.slice(signStart, signEnd);

  assert.match(signCopy, /drawn, typed, or uploaded signature/i);
  assert.doesNotMatch(
    signCopy,
    /complete forms|fill existing fields|checkmarks/i,
  );

  assert.match(
    editorCss,
    /\.textElement\s*\{[\s\S]*?font-family:\s*Helvetica,[\s\S]*?line-height:\s*1\.22;/,
  );
  assert.match(
    editorCss,
    /\.imageElement\s*\{[\s\S]*?object-fit:\s*fill;/,
  );
  assert.match(exportSource, /const lineHeight = fontSize \* 1\.22;/);
  assert.match(exportSource, /fonts\[element\.fontFamily \?\? "Helvetica"\]/);
});
