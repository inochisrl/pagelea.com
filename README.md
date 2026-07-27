# Pagelea

**Free, open-source, local-first PDF tools.**

[Website](https://pagelea.com/) ·
[Report a bug](https://github.com/inochisrl/pagelea.com/issues/new/choose) ·
[Security](SECURITY.md) ·
[Contributing](CONTRIBUTING.md)

Pagelea edits, signs, organizes, optimizes, and sanitizes PDFs in the browser.
Document bytes stay on the device: the public tools do not upload source files,
do not require an account, and do not impose an artificial task quota.

The community edition is free software under
`AGPL-3.0-or-later`. Inochi SRL may offer separate commercial licensing,
supported deployment, and enterprise services without restricting the free
community edition.

Pagelea is an independent clean-room project. It is not affiliated with or
endorsed by Sejda BV or any other PDF vendor.

## Status

Pagelea is available as a public beta at [pagelea.com](https://pagelea.com/).
Eight document tools perform real local transformations and are covered by
build, rendering, privacy, security, and PDF regression tests.

The project is suitable for evaluation and ordinary documents, but it is not
yet a lossless replacement for a professional PDF content-stream editor.
Compatible existing-text edits preserve the original page and unaffected
searchable content. Private Rewrite recognizes English and Italian scans in
the browser, and validated embedded fonts keep supported Unicode replacements
searchable. Ambiguous encodings, nested forms, annotations, and other complex
cases intentionally use a safe flattened fallback; see
[Known limitations](#known-limitations).

## Why Pagelea

- **Local-first:** PDF and image bytes remain in browser memory.
- **Free hosted tools:** no document-processing paywall or task counter.
- **Open source:** the privacy boundary and transformation logic are
  inspectable.
- **No account required:** open a tool, select a file, and download the result.
- **Private Rewrite:** recognize English or Italian scanned text locally,
  replace a selected line, and export searchable text without a document
  upload.
- **Validated Unicode:** reviewed local fonts cover Latin, Greek, Cyrillic,
  Japanese, pure Arabic, pure Hebrew, and a reviewed symbol set; supported
  faces are subsetted except the explicitly tested Symbols 2 fallback.
- **Document-first editor:** a full-viewport workspace with fit-page zoom,
  collapsible desktop panels, mobile sheets, and native touch pan and pinch.
- **Self-contained:** PDF.js worker, CMaps, fonts, and WebAssembly helpers are
  served from the same application instead of a third-party CDN.
- **Security bounded:** file sizes, pages, rendering, text, images, ZIP output,
  and PDF object traversal have explicit limits.

## Tools

| Tool | Route | What it does |
| --- | --- | --- |
| PDF Editor | `/tools/pdf-editor` | Uses an immersive desktop and mobile workspace to replace native or locally recognized scanned text, preserve supported vectors, export validated Unicode, and add text, images, shapes, highlights, whiteout, freehand marks, signatures, and page operations. |
| Sign PDF | `/tools/sign-pdf` | Adds typed, drawn, or uploaded signatures and text. |
| Merge PDF | `/tools/merge-pdf` | Combines ordered PDFs, JPGs, and PNGs. |
| Organize PDF | `/tools/organize-pdf` | Reorders, rotates, removes, and adds pages. |
| Split PDF by Pages | `/tools/split-pdf` | Creates explicit page groups and downloads them as a ZIP. |
| Optimize PDF | `/tools/compress-pdf` | Removes optional metadata and can rebuild object streams; it does not claim image recompression. |
| Images to PDF | `/tools/jpg-to-pdf` | Converts ordered JPG and PNG images with page, orientation, and margin controls. |
| Sanitize & Flatten PDF | `/tools/flatten-pdf` | Removes supported active content and metadata, flattens form values, and rebuilds pages. |

Unknown or unpublished tool routes fail closed. There are no demo
transformations disguised as production tools.

## Privacy model

The document path for every public tool is:

```text
selected file
    -> browser memory
    -> local PDF.js / pdf-lib processing
    -> local Blob or ZIP download
```

Pagelea has no document upload endpoint, cloud document library, or object
storage bucket. Refreshing or closing the workspace releases its in-memory
state.

Normal web requests still reach the hosting platform. Hosted administration
and aggregate operational endpoints are separate from document processing and
must never receive filenames, file contents, extracted text, annotations, or
signatures.

Review the deployed [privacy notice](https://pagelea.com/privacy) before using
the hosted beta with sensitive material. A self-hosted deployment remains
responsible for its own network, logging, analytics, and compliance choices.

## Architecture

```text
Browser
  |
  |-- Next.js / React interface
  |     `-- bounded editor and tool workspaces
  |
  |-- PDF.js
  |     `-- local parsing, rendering, and text geometry
  |
  |-- Tesseract.js
  |     `-- cancellable English / Italian OCR using same-origin assets
  |
  |-- pdf-lib
  |     `-- local transformations, reviewed font embedding, and export
  |
  `-- local Blob / ZIP download

Hosted edge
  |-- static application and same-origin assets
  |-- allowlisted aggregate-analytics and administrator JSON endpoints
  `-- no PDF upload or document persistence route
```

Important locations:

| Path | Purpose |
| --- | --- |
| `app/components/PdfEditorWorkspace.tsx` | Visual editor, signer, and organizer |
| `app/components/ToolWorkspace.tsx` | Merge, split, optimize, conversion, and sanitization workflows |
| `app/lib/pdf-actions.ts` | PDF transformations |
| `app/lib/pdf-editor-export.ts` | Editor export path |
| `app/lib/pdf-local-ocr.ts` | Bounded, cancellable local OCR session |
| `app/lib/pdf-editor-fonts.ts` | Unicode support policy, local font loading, and bounded embedding |
| `app/lib/pdf-font-matching.ts` | Source-font normalization and editor font matching |
| `app/lib/pdf-editor-viewport.ts` | Responsive fit-page and fit-width calculations |
| `app/lib/pdf-security-limits.ts` | Canonical resource budgets |
| `shared/public-tools.ts` | Public tool allowlist |
| `worker/` | Edge routing, policy, and optional hosted APIs |
| `tests/` | Production, privacy, security, and regression coverage |
| `public/pdfjs/` | Self-hosted PDF.js runtime assets and notices |
| `public/private-rewrite/` | Pinned OCR and Unicode font assets |
| `config/private-rewrite-assets.v1.json` | Reviewed asset sizes, hashes, licences, and provenance |
| `patches/tesseract.js+7.0.0.patch` | Reviewed OCR cancellation and worker-cleanup patch applied by the locked install |

## Local development

### Requirements

- Node.js `>=22.13.0`
- npm `11.17.0`

### Install and run

```bash
git clone https://github.com/inochisrl/pagelea.com.git
cd pagelea.com
npm ci
npm run dev
```

The document tools do not need API keys or accounts. Optional hosted
administration and aggregate analytics paths fail closed when their platform
bindings or authorization settings are not configured.

Never commit `.env*`, `.dev.vars*`, credentials, customer files, or production
data.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Build the production Cloudflare/vinext application |
| `npm run start` | Start the production build locally |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Build and run the complete Node test suite |
| `npm run licenses:list` | Emit installed package metadata as JSON |
| `npm run licenses:check` | Reject missing or unreviewed licence metadata |
| `npm run assets:check` | Verify every pinned Private Rewrite asset and reject inventory drift |
| `npm run sbom` | Emit a CycloneDX JSON SBOM |

The complete contributor gate is documented in
[CONTRIBUTING.md](CONTRIBUTING.md).
The one-time repository publication gates are documented in
[docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md).

## Deployment and AGPL compliance

The official hosted build uses a vinext/Vite Cloudflare Worker deployment.
Portable turnkey self-hosting packages are not yet a supported release
artifact; the current repository is optimized for the official edge runtime.

Anyone deploying a modified Pagelea for remote users must comply with the
AGPL, including section 13's corresponding-source requirement. Keep a clear
source link available to users and point it at the exact deployed revision and
all material needed to build that version.

Do not expose the Worker behind an untrusted proxy that lets clients forge
identity headers. Do not enable optional administration endpoints without
reviewing their trust boundaries, configuration, and tests.

## Quality and security

The repository quality gate performs:

- locked installation;
- lint and TypeScript checks;
- full and production-only dependency audits;
- licence metadata validation;
- a production build and complete tests;
- CycloneDX SBOM generation;
- whitespace and tracked-file drift checks.

CodeQL and Dependabot cover the public repository's code and dependency
changes. Security reports use GitHub private vulnerability reporting; see
[SECURITY.md](SECURITY.md).

The detailed implementation review is retained in
[`security_best_practices_report.md`](security_best_practices_report.md).

## Known limitations

- Private Rewrite currently recognizes English, Italian, or both. OCR accuracy
  depends on scan resolution, contrast, rotation, language, and layout; always
  compare the export with the original.
- Searchable Unicode export is validated for Latin, Greek, Cyrillic,
  Japanese/Han covered by the Japanese Noto face, pure Arabic letters and
  spaces, pure Hebrew letters and spaces, and a reviewed symbol set.
  Arabic/Hebrew mixed with digits, punctuation, left-to-right text or
  combining marks, Indic scripts, Hangul, and emoji fail with an explicit
  error instead of silently producing malformed or unsearchable text.
- Compatible text-show operators are neutralized in the original content
  stream and replacements are drawn as searchable vector text. Ambiguous
  encodings, nested form content, annotations, or unsupported streams use a
  fail-closed raster fallback; that page can lose selection, accessibility
  structure, and vector fidelity.
- OCR-backed replacements always use that secure raster path on the affected
  source page after removing the old pixels; unrelated source text on that
  page is no longer independently selectable.
- Secure raster export is bounded to 16 megapixels per page, 100 flattened
  pages, 80 megapixels in aggregate, and 128 MB of encoded page images; split
  a document if those safety budgets are reached.
- Optimize PDF restructures supported objects and metadata but does not
  recompress embedded images.
- Browser memory and device performance limit very large or complex documents.
- Password-protected, damaged, unusual-font, deeply nested, or unsupported PDFs
  may be rejected.
- Pagelea is not a compliance certification, malware scanner, archival
  validator, or substitute for retaining the original document.

Keep the original file and verify every exported document before relying on
it.

The exact workflow, support matrix, privacy boundary, resource budgets, and
verification evidence are documented in
[Private Rewrite](docs/PRIVATE_REWRITE.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Participation is governed by:

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Governance](GOVERNANCE.md)
- [Contributor License Agreement](CLA.md)
- [Support policy](SUPPORT.md)
- [Security policy](SECURITY.md)

Because Pagelea uses dual licensing, external contributions cannot be merged
until the contributor's CLA acceptance is recorded.

## Licensing

Copyright © 2026 Inochi SRL and Pagelea contributors.

Pagelea's original source and documentation are licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE). Inochi SRL may
offer separate commercial terms; no such contract is included in this
repository. See [LICENSING.md](LICENSING.md).

Third-party components retain their own licences. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the licence files shipped
beside bundled assets.

The Pagelea name, logo, and domain are not granted by the software licence. See
[TRADEMARKS.md](TRADEMARKS.md).
