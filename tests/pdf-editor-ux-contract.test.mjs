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
  focusedTextEditorSource,
  focusedTextEditorCss,
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
  readFile(
    new URL("app/components/TextEditFocusPanel.tsx", projectRoot),
    "utf8",
  ),
  readFile(
    new URL("app/components/TextEditFocusPanel.module.css", projectRoot),
    "utf8",
  ),
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
  assert.match(editorSource, /<footer[\s\S]*?aria-live="polite"/);
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

  const undoBranchStart = editorSource.indexOf(
    "const command = event.metaKey || event.ctrlKey",
  );
  const undoBranch = editorSource.slice(
    undoBranchStart,
    editorSource.indexOf('if (event.key === "Escape")', undoBranchStart),
  );
  assert.match(undoBranch, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(undoBranch, /!isEditableTarget\(event\.target\)/);
});

test("mobile existing-text editing is focused, accessible, and transactional", () => {
  assert.match(focusedTextEditorSource, /role="dialog"/);
  assert.match(focusedTextEditorSource, /aria-modal="true"/);
  assert.match(focusedTextEditorSource, />Original</);
  assert.match(focusedTextEditorSource, />New text</);
  assert.match(focusedTextEditorSource, /Nothing changes until you/);
  assert.match(focusedTextEditorSource, /onCancel/);
  assert.match(focusedTextEditorSource, /onApply/);
  assert.match(focusedTextEditorSource, /trapDialogFocus/);
  assert.match(focusedTextEditorSource, /inputRef\.current\?\.select\(\)/);
  assert.match(focusedTextEditorSource, /errorMessage/);
  assert.match(focusedTextEditorSource, /role="alert"/);
  assert.match(
    focusedTextEditorSource,
    /focused-text-editor-description focused-text-editor-error/,
  );
  assert.match(
    focusedTextEditorCss,
    /\.field textarea\s*\{[\s\S]*?font-size:\s*18px;/,
  );
  assert.match(
    focusedTextEditorCss,
    /\.actions button\s*\{[\s\S]*?min-height:\s*48px;/,
  );
  assert.match(focusedTextEditorCss, /env\(safe-area-inset-bottom\)/);
  assert.match(focusedTextEditorCss, /max-height:\s*min\(78dvh,\s*680px\)/);
  assert.match(
    focusedTextEditorCss,
    /@media \(max-height: 520px\) and \(orientation: landscape\)/,
  );
  assert.match(
    focusedTextEditorCss,
    /@media \(max-height: 520px\) and \(orientation: landscape\)[\s\S]*?height:\s*104px;/,
  );

  assert.match(
    editorSource,
    /if \(compactLayout \|\| preferFocusedEditor\)\s*\{[\s\S]*?openFocusedTextEditor\(element,\s*"create",\s*trigger\);[\s\S]*?return;/,
  );
  assert.match(editorSource, /FocusedTextEditIntent/);
  assert.match(editorSource, /applyFocusedTextReplacement/);
  assert.match(
    editorSource,
    /function openFocusedTextEditor[\s\S]*?setFitMode\("custom"\)/,
  );
  assert.match(editorSource, /inert=\{focusedTextEdit \? true : undefined\}/);
  assert.match(
    editorSource,
    /focusedTextEdit !== null \|\|[\s\S]*?fitMode === "custom"/,
  );
  assert.match(
    editorSource,
    /outcome === "applied" && next === before[\s\S]*?return;/,
  );
  assert.match(
    editorSource,
    /outcome === "missing"[\s\S]*?select the source text again/,
  );
  assert.match(
    editorSource,
    /focusedTextEditError[\s\S]*?setFocusedTextEditError\(message\)/,
  );
  assert.match(
    editorSource,
    /tool === "edit-text"[\s\S]*?element\.sourceText[\s\S]*?touchTextTargetRef\.current/,
  );
  assert.match(
    editorSource,
    /tool === "edit-text"[\s\S]*?openFocusedTextEditor\([\s\S]*?"update"/,
  );
  assert.match(
    editorSource,
    /event\.key === "Enter" \|\| event\.key === " "[\s\S]*?tool === "edit-text"[\s\S]*?openFocusedTextEditor\([\s\S]*?"update"/,
  );
  assert.match(editorSource, /data-editor-element-id=\{element\.id\}/);
  assert.match(
    editorSource,
    /resultElement \?\? editorHeadingRef\.current[\s\S]*?focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    editorSource,
    /error && !focusedTextEdit[\s\S]*?role="alert"/,
  );
  assert.match(
    editorSource,
    /if \(actions\.focusedTextEditing\)\s*\{[\s\S]*?event\.key === "Escape"[\s\S]*?actions\.cancelFocusedTextEditing\(\);[\s\S]*?return;[\s\S]*?\}\s*const command = event\.metaKey \|\| event\.ctrlKey/,
    "the focused editor must isolate document-level undo, redo, and deletion shortcuts",
  );
});

test("vector duplicate detection shares one fail-closed page budget", () => {
  const rewriteSource = exportSource.slice(
    exportSource.indexOf("function rewrittenSourcePageContents"),
    exportSource.indexOf("function resolvePdfReferenceChain"),
  );
  assert.match(
    rewriteSource,
    /const duplicateSearchBudget:[\s\S]*?MAX_VECTOR_TEXT_REWRITE_DUPLICATE_SEARCH_WORK/,
  );
  assert.match(
    rewriteSource,
    /evidenceSupportsVectorRewrite\([\s\S]*?duplicateSearchBudget[\s\S]*?\)[\s\S]*?unselectedTextContainsEquivalentTarget\([\s\S]*?duplicateSearchBudget/,
    "evidence and raw-operation checks must consume the same per-page budget",
  );

  const searchSource = exportSource.slice(
    exportSource.indexOf("function containsEquivalentTextSequence"),
    exportSource.indexOf("function skipPdfWhitespaceAndComments"),
  );
  assert.match(
    searchSource,
    /budget:\s*VectorDuplicateSearchBudget/,
  );
  assert.doesNotMatch(
    searchSource,
    /let searchWork\s*=/,
    "individual targets must not reset duplicate-search work",
  );
});

test("source-text preview repair stays fixed and touch gestures win over moving", () => {
  assert.match(editorSource, /function renderSourceTextPreviewMask/);
  assert.match(editorSource, /sourceText\.originalX/);
  assert.match(editorSource, /sourceText\.originalY/);
  assert.match(editorSource, /sourceText\.originalWidth/);
  assert.match(editorSource, /sourceText\.originalHeight/);
  assert.match(editorSource, /data-source-text-mask=/);
  assert.match(
    editorSource,
    /background:\s*element\.sourceText[\s\S]*?\?\s*"transparent"/,
  );
  assert.match(
    editorSource,
    /activePageElements\.map\(renderSourceTextPreviewMask\)[\s\S]*?activePageElements\.map\(renderElement\)/,
  );
  assert.match(
    editorCss,
    /\.sourceTextPreviewMask\s*\{[\s\S]*?z-index:\s*2;[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    editorSource,
    /event\.pointerType === "touch"[\s\S]*?dataset\.touchMoveHandle[\s\S]*?touchTextTargetRef\.current/,
  );
  assert.match(
    editorSource,
    /function activateEditorElement[\s\S]*?selectedId === element\.id[\s\S]*?openFocusedTextEditor[\s\S]*?setSelectedId\(element\.id\)/,
  );
  assert.match(
    editorSource,
    /onClick=\{\(event\) => \{[\s\S]*?event\.detail !== 0[\s\S]*?activateEditorElement\(element,\s*event\.currentTarget,\s*true\)/,
  );
  assert.match(editorSource, /data-touch-move-handle="true"/);
  assert.match(editorSource, /data-edge-x=\{moveHandleHorizontalEdge\}/);
  assert.match(editorSource, /data-edge-y=\{moveHandleVerticalEdge\}/);
  assert.match(
    editorCss,
    /\.moveHandle::before\s*\{[\s\S]*?inset:\s*-6px;/,
  );
  assert.match(
    editorCss,
    /@media \(max-width: 1120px\), \(pointer: coarse\)[\s\S]*?\.existingTextTarget::before\s*\{[\s\S]*?width:\s*max\(44px,\s*100%\);[\s\S]*?height:\s*max\(44px,\s*100%\);/,
  );
  assert.match(
    editorCss,
    /\.moveHandle\[data-edge-x="right"\][\s\S]*?right:\s*8px;/,
  );
  assert.match(
    editorCss,
    /\.moveHandle\[data-edge-y="top"\][\s\S]*?top:\s*8px;/,
  );
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
  assert.match(editorSource, /nativeTextEvidence/);
  assert.match(exportSource, /evidenceSupportsVectorRewrite/);
  assert.match(
    exportSource,
    /loadPdfPreview\(\s*input\.sourceBytes,\s*\{\s*signal:\s*input\.signal\s*\},?\s*\)/,
  );
  assert.match(
    editorSource,
    /exportAbortRef\.current\?\.abort\(\);\s*exportAbortRef\.current = null;\s*loadAbortRef\.current\?\.abort\(\);/,
  );
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
