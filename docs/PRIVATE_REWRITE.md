# Private Rewrite

Private Rewrite is Pagelea's local OCR and Unicode text-replacement path. It
lets a user recognize text in an image-only or mixed PDF page, select a
recognized line, rewrite it, and export searchable replacement text without
sending the document to Pagelea or an OCR provider.

This document describes version 0.4.0. It is a support contract, not a claim
that arbitrary PDF content can be edited losslessly.

## Workflow

1. Open `/tools/pdf-editor` and choose a PDF.
2. Select **Edit text**.
3. Choose English, Italian, or English + Italian in **Private Rewrite**.
4. Select **Recognize text**. Recognition runs against a bounded local render
   of the active page and can be cancelled.
5. Select an outlined native or OCR-derived text line and edit it.
6. Export, then compare the result with the original document.

Native text extraction still runs first. On mixed pages, OCR results that
overlap native text are removed so the editor does not create duplicate hit
targets.

## Privacy and network boundary

Document bytes, rendered page pixels, recognized text, and replacement text
remain in browser memory. Private Rewrite has no document-upload API.

The first recognition request lazily downloads the reviewed Tesseract worker,
one compatible WebAssembly loader, and the selected language model from
Pagelea's own origin. Unicode fonts are also fetched from fixed same-origin
paths only when an export needs them. A browser may cache those public assets
for later use.

The asset inventory is pinned in
`config/private-rewrite-assets.v1.json`. Run:

```bash
npm run assets:check
```

The verifier rejects missing, unexpected, changed, oversized, symlinked, or
path-traversing assets. Licences are retained under
`public/licenses/private-rewrite/` and summarized in
`THIRD_PARTY_NOTICES.md`.

## OCR support

| Capability | Status |
| --- | --- |
| English (`eng`) | Supported |
| Italian (`ita`) | Supported |
| English + Italian (`eng+ita`) | Supported |
| Image-only pages | Supported |
| Mixed native text and scanned regions | Supported with overlap deduplication |
| Per-page recognition | Supported |
| Progress and cancellation | Supported |
| Rotation, handwriting, tables, or arbitrary layouts | Best effort; verify manually |
| Other recognition languages | Not included in version 0.4.0 |

OCR accuracy depends on resolution, contrast, skew, rotation, typography, and
layout. A recognized line is an editable geometry estimate, not proof of the
original reading order or semantic structure.

## Searchable Unicode export

Private Rewrite uses reviewed local Noto fonts and validates every replacement
before export. Supported output is deliberately narrower than the fonts'
theoretical glyph inventory.

| Text class | Export policy |
| --- | --- |
| Latin, Greek, and Cyrillic | Supported |
| Japanese and covered Han characters | Supported with Noto Sans JP |
| Arabic letters and spaces | Supported as a pure right-to-left run |
| Hebrew letters and spaces | Supported as a pure right-to-left run |
| Reviewed Symbols 2 characters | Supported |
| Arabic or Hebrew mixed with digits, punctuation, left-to-right text, or combining marks | Rejected |
| Indic scripts, Hangul, emoji, and unreviewed symbols | Rejected |

The editor emits an explicit diagnostic when it cannot guarantee the intended
glyph mapping or searchable extraction. It does not silently replace unknown
characters, fall back to an operating-system font, or convert unsupported text
to an unsearchable image.

Pure Arabic and Hebrew runs are positioned right-to-left and preserve exact
text extraction within the supported matrix. Version 0.4.0 does not provide a
general Unicode bidirectional-layout or complex-script shaping engine.

Source-font correspondence is heuristic. Pagelea normalizes the font names
reported by PDF.js and maps them to a small reviewed palette of PDF standard
fonts and local Noto faces. It does not copy arbitrary embedded fonts, and it
cannot guarantee identical glyph metrics, kerning, line breaks, or appearance.
OCR lines often contain only a weak font-family hint.

## Export behavior

- A compatible native text edit neutralizes the original text-show operand
  while retaining the original PDF page, unrelated searchable text, images,
  and vectors.
- An OCR-derived edit first repairs the selected pixels, then rasterizes the
  affected source page and draws searchable replacement text over the clean
  page image. The old scan pixels are not retained beneath the replacement.
- Ambiguous content streams, nested forms, annotations, unsupported
  encodings, and other uncertain native structures use Pagelea's bounded
  flattened fallback.
- Replacement wrapping is word-aware and grapheme-safe. Text that cannot fit
  inside the selected box fails with an explicit overflow error.
- Font assets are reused within one export. Supported faces are embedded as
  glyph subsets except Symbols 2, which remains complete because the current
  PDF stack loses reviewed outlines when that face is subsetted.

For every OCR-backed edit, and for any native edit that needs the flattened
fallback, unrelated source text on the affected page becomes part of the page
image and therefore loses its original selection and accessibility structure.
Vector fidelity can also be reduced. Newly written replacement text remains
searchable. Always retain the source PDF and review the downloaded result.

## Resource limits

Runtime limits live in `app/lib/pdf-security-limits.ts`. Private Rewrite
currently bounds:

- OCR render dimensions and total canvas pixels;
- recognition runtime;
- recognized lines and characters per page;
- editor elements and replacement text;
- fallback raster dimensions, pages, pixels, and encoded bytes;
- font runs and per-asset runtime fetch sizes.

Each flattened page is capped at 16 megapixels. One export may flatten at most
100 pages, use 80 megapixels across those canvases, and retain 128 MB of
encoded page images. Pagelea lowers the render scale to fit the remaining
aggregate pixel budget but never below 72 DPI. If that minimum fidelity, the
page-count budget, or the encoded-byte budget cannot be preserved, the export
stops with an explicit instruction to split the document.

Supply-chain inventory size, total bytes, paths, hashes, and provenance are
bounded separately by `scripts/verify-private-rewrite-assets.mjs`.

Limit failures are intentional. Reduce the document, work page by page, or use
a better source scan rather than bypassing the safeguards.

## Loading and performance

The normal editor path does not preload the OCR engine, language models,
fontkit, or the full Unicode font set. The largest optional asset is the
Japanese font, which is fetched only for a matching export. Tesseract workers
are reused during the active recognition session and released when the OCR
language changes, the workspace resets, or export begins. Font bytes are
reused within an export and the export font manager is disposed immediately
after that export finishes.

## Verification

The release gate covers:

- type checking, linting, production build, and complete regression tests;
- real browser recognition of an image-only English/Italian fixture;
- mixed native/scanned recognition and deduplication;
- recognition cancellation and stale-result protection;
- searchable replacement export with the old scan pixels removed from the
  flattened affected page;
- exact text extraction and visual rendering for the supported Unicode
  matrix;
- same-origin network inspection, CSP enforcement, asset hashes, licences,
  dependency audits, and SBOM generation;
- desktop, phone portrait, and phone landscape editor behavior.

This verification reduces known regressions; it does not make OCR infallible or
turn Pagelea into a general-purpose PDF content-stream authoring system.
