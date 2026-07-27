import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

const [
  editorSource,
  editorCss,
  exportSource,
  toolsSource,
  toolRouteSource,
  privateRewriteSource,
  privateRewriteCss,
  localOcrSource,
] = await Promise.all([
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
  readFile(new URL("app/tools/[slug]/page.tsx", projectRoot), "utf8"),
  readFile(
    new URL("app/components/PrivateRewriteControls.tsx", projectRoot),
    "utf8",
  ),
  readFile(
    new URL(
      "app/components/PrivateRewriteControls.module.css",
      projectRoot,
    ),
    "utf8",
  ),
  readFile(new URL("app/lib/pdf-local-ocr.ts", projectRoot), "utf8"),
]);

test("editor uses an immersive, viewport-owned application shell", () => {
  assert.match(
    editorCss,
    /\.editor\.immersive\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/,
  );
  assert.match(
    editorCss,
    /\.immersive \.editorBody\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;[\s\S]*?grid-template-columns:\s*200px minmax\(0,\s*1fr\) 300px;/,
  );
  assert.match(
    toolRouteSource,
    /<PdfEditorWorkspace immersive mode="edit" \/>/,
  );
  assert.match(editorSource, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(editorSource, /editorHeadingRef\.current\?\.focus/);
  assert.match(editorSource, /editorFocusEnteredRef\.current/);
  assert.match(editorSource, /document\.activeElement === exportButtonRef\.current/);
  assert.match(
    editorSource,
    /phase !== "ready" \|\| !restoreExportFocusRef\.current/,
  );
  assert.match(
    editorSource,
    /restoreExportFocusRef\.current = restoreExportFocus/,
  );
  assert.match(editorSource, /exportButtonRef\.current\?\.focus/);
  assert.match(
    editorSource,
    /phase === "exporting" \? "Exporting PDF" : "Export PDF"/,
  );
  assert.match(
    editorSource,
    /phase === "idle" \|\| phase === "loading"[\s\S]*?editorFocusEnteredRef\.current = false/,
  );
  assert.match(
    editorCss,
    /@media \(max-height: 520px\) and \(orientation: landscape\)[\s\S]*?\.workspace\.immersive \.start\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?\.workspace\.immersive \.startArt\s*\{[\s\S]*?display:\s*none;/,
  );
});

test("editor turns pages and properties into adaptive drawers and sheets", () => {
  const compactRules = editorCss.slice(
    editorCss.indexOf("@media (max-width: 1120px)"),
    editorCss.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  const mobileRules = compactRules.slice(
    compactRules.indexOf("@media (max-width: 760px)"),
  );

  assert.match(
    compactRules,
    /\.immersive \.pagesPanel,[\s\S]*?position:\s*absolute;/,
  );
  assert.match(
    compactRules,
    /\.immersive \.pagesPanel\[data-open="true"\],[\s\S]*?transform:\s*none;/,
  );
  assert.match(
    mobileRules,
    /\.immersive \.pagesPanel,[\s\S]*?transform:\s*translateY\(105%\);/,
  );
  assert.match(
    mobileRules,
    /\.immersive \.thumbIcon\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  );
  assert.match(editorSource, /aria-controls="pdf-pages-panel"/);
  assert.match(editorSource, /aria-controls="pdf-properties-panel"/);
  assert.match(
    editorSource,
    /aria-expanded=\{[\s\S]*?openPanel === "pages"[\s\S]*?: !pagesCollapsed/,
  );
  assert.match(editorSource, /inert=\{/);
  assert.match(editorSource, /trapPanelFocus/);
  assert.match(editorSource, /const pagesHidden = immersive/);
  assert.match(editorSource, /const propertiesHidden = immersive/);
  assert.match(
    editorSource,
    /if \(!immersive \|\| !compactLayout \|\| event\.key !== "Tab"\) return;/,
  );

  for (const label of [
    'aria-label={`Move page ${index + 1} up`}',
    'aria-label={`Move page ${index + 1} down`}',
    'aria-label={`Rotate page ${index + 1} clockwise`}',
    'aria-label={`Delete page ${index + 1}`}',
  ]) {
    assert.ok(editorSource.includes(label), label);
  }
});

test("editor fits the page responsively and preserves touch navigation", () => {
  assert.match(editorSource, /computeEditorFitZoom/);
  assert.match(editorSource, /new ResizeObserver\(applyFit\)/);
  assert.match(editorSource, /window\.visualViewport\?\.addEventListener/);
  assert.match(editorSource, /fitMode === "custom"/);
  assert.match(editorSource, /onWheel=\{onCanvasWheel\}/);
  assert.match(editorCss, /touch-action:\s*pan-x pan-y pinch-zoom;/);
  assert.match(editorCss, /\.directSurface\s*\{[\s\S]*?touch-action:\s*none;/);
  assert.match(editorCss, /\.panSurface\s*\{[\s\S]*?touch-action:\s*none;/);
  assert.match(editorSource, /type CanvasTouchGesture/);
  assert.match(editorSource, /startDistance:/);
  assert.match(editorSource, /scroller\.scrollLeft =/);
  assert.match(editorSource, /gesture\.startZoom \* \(distance \/ gesture\.startDistance\)/);
  assert.match(editorCss, /\.resizeHandle::before\s*\{[\s\S]*?inset:\s*-15px;/);
  assert.match(editorSource, /aria-current=\{/);
  assert.match(editorSource, /role="toolbar"/);
  assert.match(editorSource, /<footer aria-live="polite"/);
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
  assert.match(
    exportSource,
    /fonts\.prepareRuns\(element, element\.text\)/,
  );
  assert.match(editorSource, /fontFamily:\s*editorFontCss\(/);
});

test("Private Rewrite exposes local OCR, cancellation, and mobile-safe controls", () => {
  assert.match(editorSource, /<PrivateRewriteControls/);
  assert.match(editorSource, /removeOcrFragmentsOverlappingNative/);
  assert.match(
    editorSource,
    /nativeTextPageKeysRef\.current\.has\(activeTextKey\)/,
  );
  assert.doesNotMatch(editorSource, /if \(activeTextPage\) return;/);
  assert.match(
    privateRewriteSource,
    /aria-label="Private Rewrite local OCR"/,
  );
  assert.match(
    privateRewriteSource,
    /OCR runs only in this browser/,
  );
  assert.match(privateRewriteSource, />\s*Cancel\s*</);
  assert.match(privateRewriteSource, /Recognition language/);
  assert.match(localOcrSource, /import\("tesseract\.js"\)/);
  assert.match(localOcrSource, /workerBlobURL:\s*false/);
  assert.match(localOcrSource, /gzip:\s*false/);
  assert.match(
    privateRewriteCss,
    /@media \(max-width: 760px\)[\s\S]*?min-height:\s*44px;/,
  );
  assert.match(
    editorCss,
    /@media \(pointer: coarse\)[\s\S]*?\.exportButton,[\s\S]*?min-height:\s*44px;[\s\S]*?\.iconButton\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  );
  assert.match(
    privateRewriteCss,
    /@media \(prefers-reduced-motion: reduce\)/,
  );
});
