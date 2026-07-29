# Changelog

All notable changes to Pagelea are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.4] - 2026-07-29

### Added

- Turned the Inspector checkmark into a real 44 px Done control and added an
  equivalent mobile Done action for multi-stroke drawing and signatures.
- Added Enter as a consistent way to finish the selected element without
  intercepting text fields, selects, or text-editing dialogs.

### Changed

- Highlight, Shape, and Whiteout now create one element and immediately return
  to Select with that element ready to move. Draw and drawn signatures remain
  active for multiple strokes until Done, Enter, Select, or the selected move
  handle is dragged.
- Increased the visible mobile move handle from 32 px to 44 px.
- Treat typed and uploaded signatures as signatures throughout selection,
  accessibility labels, status messages, and the Inspector.

### Fixed

- Fixed clicking an existing highlight, shape, whiteout, or the empty page
  creating an unintended duplicate while the user was trying to save or move
  the previous element.
- Fixed the most recent freehand or signature stroke looking movable while its
  creation tool was still active. The page now keeps its drawing cursor and an
  explicit move handle exits creation without adding another stroke.
- Fixed the active-tool checkmark appearing actionable while doing nothing.
- Fixed typed signatures reopening the text editor instead of becoming
  selectable on mobile, and fixed their placement status remaining stuck on
  the previous instruction.

## [0.4.3] - 2026-07-28

### Added

- Added an explicit mobile More tools menu so Edit text, Highlight, Whiteout,
  Shape, Image, and Sign remain reachable in both portrait and short landscape
  layouts without relying on an invisible scrollbar.
- Reused the transactional focused text sheet for new and previously added
  text. Empty drafts cannot create invisible elements, Cancel leaves the
  document and history untouched, and Save updates the existing element
  instead of duplicating it.
- Added direct compact-layout signature setup for typed, drawn, and uploaded
  signatures, including accessible mode state and clear page-placement actions.

### Changed

- Keep Draw, Highlight, Whiteout, Shape, and drawn Signature active until the
  user chooses Select or presses Escape, allowing consecutive marks and
  multi-stroke signatures.
- Give tap-created highlights, whiteouts, and shapes useful tool-specific
  dimensions while preserving precise drag sizing.
- Match preview and export opacity for highlights, and keep Whiteout fully
  opaque in both paths.

### Performance

- Export every freehand or signature stroke as one rounded PDF path instead of
  one PDF object per line segment. The regression suite covers the 4,096-point
  per-stroke limit; a manual 100,000-point document benchmark produced a
  smaller file that Pagelea could reopen while reducing measured export time
  from 17.7 seconds to 0.69 seconds on the review machine.

### Security

- Reject non-finite drawing coordinates before PDF path serialization.

### Fixed

- Fixed Draw, Highlight, Whiteout, Shape, and drawn Signature returning to
  Select after their first gesture, which made a second drag move the previous
  mark instead of creating another.
- Fixed pointer cancellation committing partial or nearly invisible marks.
- Fixed simple Highlight taps creating a roughly three-pixel artifact despite
  the interface promising click-or-drag placement.
- Fixed compact Signature leaving its required name or upload controls inside a
  closed properties sheet.
- Fixed mobile toolbar state persisting as a clipped horizontal offset after
  rotating into landscape.

## [0.4.2] - 2026-07-27

### Security

- Detect case-variant whole-word copies and source text reconstructed from
  complete `Tj` or PDF.js fragments even when those fragments are reordered or
  separated by decoys. Both evidence and raw-operation checks consume one
  fail-closed, page-wide work budget.
- Traverse copied page graphs iteratively in pdf-lib's copier order and bound
  malicious `/Parent` inheritance chains before pdf-lib can recurse through
  them.
- Apply one aggregate copy-work budget across every source-page occurrence,
  including duplicated pages, while retaining per-copy depth, entry, object,
  and reference limits.
- Charge page-tree dereferences, indirect-object roots, nested ownership
  entries, and ownership reference chains to explicit graph budgets before
  expensive copy or obsolete-stream cleanup work begins.

### Fixed

- Replaced the cramped mobile inline text field with a focus-managed,
  transactional bottom sheet. Cancel leaves the document and undo history
  untouched; confirm creates or updates exactly one replacement, and a rejected
  over-limit change keeps its draft and error visible.
- Anchored the preview repair mask to immutable source-text geometry, so moving
  a replacement can no longer reveal the original and appear to duplicate it.
- Let touch pan and pinch gestures begin over replaced text. The first tap
  selects a replacement, the second opens its focused editor, and moving uses
  an explicit edge-aware handle with a 44 px touch target.
- Added synthetic-click activation and complete modal isolation for assistive
  technology, including isolation from document undo, redo, and delete
  shortcuts.

## [0.4.1] - 2026-07-27

### Security

- Require bounded PDF.js text-layer evidence before any native vector rewrite,
  including exact raw-operation correspondence and immutable, unrotated source
  geometry. Missing or conflicting evidence forces the raster fallback.
- Reject case-variant duplicates and copies reconstructed from consecutive,
  complete `Tj` fragments.
- Reject malformed `Tj` calls with extra operands and any string operand
  consumed by an unreviewed operator, including strings nested in arrays or
  dictionaries.
- Verify that the old `/Contents` objects have no alias inside the copied page
  graph; aliases through page keys or inherited resources now force the raster
  fallback.
- Limit vector-path content-stream dictionaries to reviewed `/Length` and
  single-filter forms, so cyclic or nested aliases cannot preserve an obsolete
  stream.
- Copy multiple `/Contents` streams with the same byte-exact sequencing used
  by PDF.js so operators split across stream boundaries cannot evade parsing.
- Restrict copied vector pages to a reviewed page-dictionary allowlist; unknown
  or active entries fail closed to the static raster path.
- Bound page-object graph entries as well as unique containers, avoiding wide
  graph expansion before the raster fallback.
### Fixed

- Prevented `v0.4.0` from retaining a complete or partial old text layer in
  adversarial PDFs that use adjacent split fragments, change the case of, or
  alias source text.
  Version 0.4.1 supersedes that deployed release.

## [0.4.0] - 2026-07-27

### Added

- Added Private Rewrite to recognize English, Italian, or combined
  English-and-Italian scanned text entirely in the browser.
- Added source-font normalization, local font matching, and a reviewed editor
  palette covering sans, serif, mono, condensed, Japanese, Arabic, Hebrew, and
  symbol roles.
- Added searchable Unicode export with reviewed local fonts for Latin, Greek,
  Cyrillic, Japanese/Han, pure Arabic, pure Hebrew, and a validated symbol
  set. Every supported face is subsetted except Symbols 2, whose tested subset
  loses outlines in current PDF renderers.
- Added a versioned asset manifest with exact sizes, SHA-256 digests, upstream
  revisions, transformations, licences, and an inventory verifier.
- Added regression coverage for OCR geometry, mixed native/OCR pages,
  cancellation, resource budgets, font selection, Unicode extraction,
  subsetting, vector preservation, CSP, and asset provenance.

### Changed

- Kept the original PDF page and native vectors intact when replacing
  compatible native text. OCR-derived edits repair the selected pixels before
  securely rasterizing the affected page, so old scan pixels cannot remain
  recoverable below the replacement.
- Made line wrapping word-aware and grapheme-safe, with explicit overflow
  errors instead of silent clipping or character loss.
- Rounded editor geometry to practical decimal values and exposed source
  origin, OCR confidence, matched font, recognition language, and writing
  direction in the inspector.

### Performance

- Load Tesseract, recognition models, fontkit, and Unicode fonts only when the
  active operation needs them.
- Reuse OCR workers and loaded font bytes, and subset replacement glyphs for
  every supported face except the deliberately complete Symbols 2 fallback.
- Reuse one in-flight font load and one embedded font per export even when
  callers observe cancellation independently.

### Security

- Serve all OCR workers, WebAssembly loaders, language models, and export fonts
  from fixed same-origin paths with no document-upload or third-party asset
  request.
- Bound OCR canvas dimensions, pixels, lines, characters, and runtime; support
  cancellation and deterministic cleanup.
- Patched the locked Tesseract browser wrapper so bootstrap failures,
  cancellation, and runtime crashes terminate their worker and reject pending
  jobs; image loading observes abort signals; and recognition buffers transfer
  without an extra full copy.
- Added aggregate limits of 100 flattened pages, 80 million render pixels, and
  128 MB of encoded fallback images per export, with dynamic scale reduction
  against the remaining pixel budget.
- Refuse to flatten below 72 DPI when the remaining aggregate pixel budget
  cannot preserve a readable page; the export now asks the user to split the
  document instead of silently degrading it.
- Extend the nonce CSP only with the narrow `wasm-unsafe-eval` capability
  required by the reviewed local OCR runtime.
- Reject unsupported Unicode combinations with precise errors rather than
  silently substituting glyphs or producing unsearchable output.

### Fixed

- Prevented duplicate editable runs when a mixed PDF contains native text over
  scanned regions.
- Prevented stale OCR results from a previous page or cancelled recognition
  session from replacing current editor state.
- Shipped uncompressed trained-data assets so static hosts serve them
  consistently without changing their contents.
- Preserved previous OCR results after cancellation and announced the
  cancellation state accessibly.
- Forced pages carrying annotations, additional actions, associated files,
  hidden metadata, thumbnails, or presentation payloads through the static
  raster path instead of copying their active page dictionary.
- Bounded native/OCR overlap work and removed marked-content ancestry that
  could multiply extraction memory without a runtime consumer.
- Preserved non-uniform vector backgrounds during compatible native text
  replacement instead of painting an opaque cleanup rectangle.
- Forced pages with custom, embedded, remapped, or otherwise unverified text
  fonts through the secure raster path so an invisible searchable copy cannot
  survive a vector replacement. A bounded page-wide semantic check also
  rejects copies split across multiple standard-font text-show operators.
- Restricted vector neutralization to directly decoded printable-ASCII `Tj`
  strings with a locally verified `Tf` font selection. Non-canonical WinAnsi
  bytes, positioned `TJ` arrays, quote operators, `ExtGState` font changes,
  missing font state, and multi-operation text blocks now fail closed to
  raster so PDF.js whitespace or character normalization cannot preserve a
  hidden copy.
- Propagated export cancellation into PDF.js fallback loading and invalidated
  stale export ownership before opening another PDF, preventing a cancelled
  export from restoring the previous document's ready state.

### Removed

- Removed eight unused Indic and Thai font files that were not part of the
  validated export support matrix.

## [0.3.1] - 2026-07-26

### Fixed

- Restored keyboard focus to Export only after the optimized production build
  has re-enabled the button, preventing focus from falling back to the page
  after a completed download.

## [0.3.0] - 2026-07-26

### Added

- Added automatic `Fit page` and `Fit width` zoom with bounded viewport
  calculations, `ResizeObserver`, visual-viewport updates, and portrait or
  landscape refitting.
- Added canvas-native pinch-to-zoom and one-finger pan for touch users in
  Select and Edit text modes, plus trackpad zoom up to 400%.
- Added collapsible page and property regions on desktop, side drawers on
  tablet, and focus-managed bottom sheets on mobile.
- Added explicit product and design-system documentation for the Pagelea
  workbench, including responsive, accessibility, input, and visual rules.
- Added regression coverage for viewport fitting, immersive routing,
  responsive panels, touch gestures, focus management, and the mobile
  viewport contract.

### Changed

- Rebuilt `/tools/pdf-editor` as a dedicated `100dvh` application shell. The
  marketing header, hero, explanatory sections, and footer no longer compete
  with the document workspace.
- Made the PDF canvas the persistent primary region at every breakpoint.
  Desktop keeps pages and properties beside it; tablet and mobile reveal them
  only when requested instead of stacking them into a long page.
- Kept Export pinned in the top app bar and moved editing tools into a
  thumb-reachable mobile dock with safe-area support.
- Adapted mobile landscape to a vertical tool dock so the document receives
  substantially more usable height.
- Raised coarse-pointer controls to at least 44 by 44 CSS pixels and enlarged
  the invisible resize-handle hit area.

### Fixed

- Removed browser-level horizontal and vertical overflow from the active PDF
  editor at desktop, tablet, phone, 320-pixel, and landscape viewports.
- Prevented the editor command bar from being hidden beneath the public-site
  header and prevented Export from extending beyond narrow screens.
- Restored visible focus treatment, announced editor status updates, exposed
  the active page with `aria-current`, and corrected toolbar semantics.
- Added focus entry, trapping, Escape dismissal, and focus restoration for
  compact page and property panels.
- Added an authoritative `viewport-fit=cover` tag for safe-area insets in the
  current edge runtime.

## [0.2.2] - 2026-07-26

### Performance

- Removed the equivalent HTML font preload elements with Cloudflare's
  streaming `HTMLRewriter`, so Unicode-range fonts load on demand.

## [0.2.1] - 2026-07-26

### Fixed

- Gave the compact mobile home link an explicit accessible name.
- Added the verified `www.pagelea.com` hostname and canonicalized it to the
  HTTPS apex while preserving the request path and query string.

### Performance

- Removed duplicate font preload hints from the HTTP `Link` header.

## [0.2.0] - 2026-07-26

### Added

- Added the official GNU Affero General Public License v3.0-or-later and
  documented Pagelea's community/commercial dual-licensing model.
- Added contributor, governance, support, trademark, Code of Conduct,
  Contributor License Agreement, third-party notice, and supply-chain
  documentation.
- Added CODEOWNERS, structured issue forms, a pull-request template,
  Dependabot, CodeQL, licence validation, and CycloneDX SBOM generation.
- Added a bounded vector-preserving path for existing-text replacement. When a
  standard PDF text-show operation can be identified unambiguously, Pagelea
  neutralizes the old operand, retains the original page, and draws searchable
  replacement text.
- Added regression coverage proving that compatible replacements remove the
  old extractable text, preserve unrelated searchable text and vectors, and
  fall back safely for ambiguous content.
- Added a forward-only D1 migration that removes retired consumer and commerce
  tables while preserving aggregate analytics.

### Changed

- Repositioned Pagelea as a free, open-source, local-first PDF workbench with
  no account requirement or artificial document-processing quota.
- Replaced the commercial checkout page with a static “Free forever” page and
  optional Enterprise, SDK/OEM, integration, and support enquiries.
- Reduced the hosted API surface to fail-closed anonymous aggregate analytics
  and an allowlisted administrator read endpoint.
- Updated the homepage, navigation, footer, metadata, sitemap, robots rules,
  legal notices, security policy, README, and maintainer documentation for the
  community model.
- Changed package licence metadata from `UNLICENSED` to
  `AGPL-3.0-or-later`; `private: true` remains only to prevent accidental npm
  publication of the application.

### Removed

- Removed consumer sign-in, account, checkout-success, plan, entitlement,
  licence, customer portal, and billing interfaces.
- Removed Stripe checkout, webhook, subscription, purchase, and licence
  runtime code together with obsolete commerce tests and configuration.
- Removed the public `MEMORY.md`; operational memory is retained outside the
  repository with owner-only permissions.

### Security

- Preserved the nonce Content Security Policy, restrictive response headers,
  explicit route/method allowlists, same-origin checks, bounded request
  parsing, prepared D1 statements, and administrator email allowlist.
- Kept browser analytics disabled by default and subject to both
  `PAGELEA_ANONYMOUS_ANALYTICS_ENABLED=true` and GPC/DNT opt-out checks.
- Added content-stream size limits and fail-closed parsing to the vector text
  rewrite path, including bounded streaming Flate decoding, token and nesting
  budgets, marked-content rejection, per-string limits, and a content-stream
  count cap. Unsupported encodings, annotations, inline images, nested form
  text, ambiguous matches, and other uncertain structures use the existing
  safe raster fallback.
- Allowlisted the exact reviewed dependency install scripts and made
  unreviewed install scripts a clean-install failure.
- Added public-repository secret scanning, dependency audit, licence inventory,
  SBOM, and immutable GitHub Action checks to the release process.

## [0.1.0] - 2026-07-25

### Added

- Introduced the Pagelea identity and initial responsive PDF workbench.
- Added eight production PDF tools: editor, signer, merge, organize, split,
  optimize, image conversion, and sanitize/flatten.
- Added local PDF.js rendering and text extraction, pdf-lib transformations,
  page management, annotations, signatures, undo/redo, and local downloads.
- Added browser-side resource limits and regression coverage for PDF parsing,
  rendering, export, active-content sanitization, ZIP output, and route
  hardening.

### Security

- Added nonce-based Content Security Policy, HSTS, frame denial, MIME-sniffing
  protection, restrictive referrer and permissions policies, canonical-host
  protection, safe redirects, and bounded PDF object-graph traversal.
- Hardened PDF sanitization against supported active actions, scripts,
  attachments, associated files, nested metadata, and trailer identifiers.
