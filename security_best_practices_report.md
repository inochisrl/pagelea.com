# Pagelea 0.4.2 Security and Release Review

- **Review date:** 2026-07-27
- **Owner:** Inochi SRL
- **Target:** Pagelea Community 0.4.2
- **Licence:** AGPL-3.0-or-later
- **Scope:** the current release-candidate source tree

## Executive summary

Pagelea 0.4.2 is a free and open-source, browser-based PDF workbench. Its
published document workflows process selected files in the user's browser.
The application has no document-upload endpoint, cloud document library,
consumer account API, checkout, subscription, entitlement, payment webhook, or
licence API.

The remaining Worker API surface consists of anonymous aggregate analytics
ingestion and an allowlisted administrative analytics read endpoint. Anonymous
browser analytics is disabled in source and remains storage-disabled unless a
separate Worker environment switch is also set to the exact value `true`.

This review found no unresolved P0 or P1 code vulnerability in the reviewed
tree. The PDF vector-rewrite path was made fail-closed for ambiguous syntax,
marked content, unsupported stream encodings, excessive nesting, decompression
expansion, too many content streams, and oversized individual strings. Inputs
that cannot be rewritten conservatively use the existing in-browser raster
fallback.

The repository is already public. Its reachable history contains a retired
`MEMORY.md` file in nine older commits; the file is absent from the current
tree, remains ignored, and the complete reachable-history scan found no secret.
A history rewrite cannot retract that prior exposure and is **not** a 0.4.2
release prerequisite. It remains separately tracked governance debt: any future
rewrite requires explicit owner approval and a verified, access-controlled
backup before public refs are changed.

This is a source-assisted security review and regression exercise. It is not an
external penetration test, malware certification, accessibility certification,
privacy or tax opinion, or legal approval of the project and its dependencies.

## Reviewed product surface

The public catalogue contains exactly these eight tools:

1. `pdf-editor`
2. `sign-pdf`
3. `merge-pdf`
4. `organize-pdf`
5. `split-pdf`
6. `compress-pdf`
7. `jpg-to-pdf`
8. `flatten-pdf`

Unknown, retired, account, login, checkout, and historical prototype routes
fail closed rather than exposing an unreviewed product surface.

The review covered:

- local PDF/image selection, parsing, preview, text extraction, editing, export,
  ZIP output, and resource limits;
- existing-text vector rewriting and its raster fallback;
- active-content and metadata removal in Sanitize & Flatten;
- the Worker route, method, body, origin, response, and header boundaries;
- Sites-forwarded administrator identity and the server-side allowlist;
- aggregate analytics privacy, retention, response bounds, and opt-out handling;
- the D1 schema and destructive retirement migration;
- dependency advisories, source leakage, GitHub Actions, CodeQL, Dependabot,
  SBOM generation, and public-history requirements.

### Private Rewrite 0.4.2 review delta

Version 0.4.2 retains the local English/Italian OCR, reviewed Unicode export
fonts, and font matching introduced in 0.4.0. It builds on the fail-closed
vector rewrite released in 0.4.1 and adds the following review coverage:

- fixed same-origin Tesseract worker, WebAssembly, language-model, and font
  paths with `workerBlobURL: false` and no document-upload fallback;
- explicit OCR canvas, pixel, runtime, line, character, spatial-comparison,
  font-run, font-fetch, and per-page plus aggregate raster-export budgets;
- cancellation, worker disposal, stale-result rejection, and bounded
  main-thread overlap deduplication;
- a versioned asset inventory with exact size, SHA-256, upstream revision,
  transformation, and retained-licence verification;
- searchable Unicode output with bounded reviewed font embedding, while
  unsupported scripts and unsafe right-to-left combinations are rejected
  explicitly;
- OCR source-pixel cleanup before the flattened PNG is created;
- fail-closed flattening for annotations, page additional actions, associated
  files, presentation actions, thumbnails, metadata, article beads, and other
  reviewed non-visual page payload entries before any vector page copy;
- complete bounded PDF.js text-layer evidence, immutable selected-fragment
  matching, and geometric overlap rejection before a vector rewrite;
- bounded case-folded whole-word and whole-fragment duplicate detection, with
  one page-wide work budget shared by evidence and raw-operation checks, plus
  alias checks for old content streams reached through the copied page graph;
- a reviewed allowlist for copied page-dictionary keys and byte-exact
  concatenation of multiple content streams;
- exact one-string `Tj` operand validation, rejection of unconsumed nested
  strings, and reviewed content-stream dictionary forms that exclude cycles;
- root and nested-entry charging for obsolete-content ownership traversal,
  including PDFs with large sets of orphan indirect scalar objects;
- copier-order page-graph traversal with fresh ownership per copied page and
  iterative bounds for malicious inherited `/Parent` backlinks;
- transactional mobile existing-text editing whose Cancel and rejected-limit
  paths preserve the document, undo history, and draft, while the open dialog
  isolates document undo, redo, and delete shortcuts;
- the narrow `wasm-unsafe-eval` CSP capability required by the pinned local
  Tesseract core, without adding general `unsafe-eval` or remote script
  origins.

## Data and trust boundaries

### Local document processing

The intended document path is:

```text
local file selection
  -> bounded browser memory
  -> PDF.js/pdf-lib processing
  -> local Blob or ZIP download
```

There is no Worker route that accepts PDF bytes, filenames, extracted text,
annotations, signatures, or document metadata. D1 stores no document content.
Refreshing or closing the workspace releases application-held in-memory state,
subject to the normal behavior of the browser and operating system.

Normal page and asset requests still reach the hosting platform. The optional
administrative and aggregate analytics endpoints are separate from document
processing and must never be extended to receive document-derived data.

### Hosted identity

The official Sites deployment trusts the
`oai-authenticated-user-email` header only because the Sites dispatcher owns
authentication and injects that header at the trusted edge. The API then
requires an exact normalized match in `PAGELEA_ADMIN_EMAILS`.

The application shell may redirect an unauthenticated visitor to the hosted
sign-in route, but the Worker API is the authorization boundary for analytics
data. A self-hosted or alternate reverse-proxy deployment must strip and
overwrite client-supplied identity headers or disable the administrator
endpoint. Direct exposure behind a proxy that permits header forgery is unsafe.

## Worker and browser controls

### API surface

| Endpoint | Method | Controls |
| --- | --- | --- |
| `/api/analytics/event` | `POST` | Exact same-origin check, fetch-site check, JSON media type, 1 KiB streamed body limit, exact event schema, GPC/DNT suppression, source and Worker kill switches |
| `/api/admin/analytics` | `GET` | Trusted hosted identity, exact administrator allowlist, required D1 binding, 1–90 day clamp, bounded 6,000-row response |

Unknown `/api/*` paths return JSON `404`. API `OPTIONS` responses advertise
only the exact endpoint methods and do not opt into CORS. State-changing methods
outside the API allowlist are rejected. API responses use `Cache-Control:
no-store`.

Anonymous analytics events are not authenticated. Same-origin controls prevent
ordinary browser cross-site submission but do not stop a scripted client from
forging request headers. Ingestion therefore remains disabled by default and
must never be used for billing, fraud, security, or audited usage decisions.

### Content Security Policy and response headers

HTML responses receive a fresh per-request nonce. The script policy permits
only same-origin scripts carrying that nonce, contains neither `unsafe-inline`
nor the general `unsafe-eval` capability, and grants only the narrower
`wasm-unsafe-eval` capability required by the reviewed local Tesseract core.
The policy also restricts connections and workers to the application origin,
denies objects and framing, disables base URL changes, and limits form
submissions to the same origin.

Inline styles remain permitted because of the current framework output. This
does not authorize inline scripts and should be revisited if the build can emit
nonce- or hash-compatible styles.

All routed responses receive:

- HSTS;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `frame-ancestors 'none'`;
- same-origin opener isolation;
- `Referrer-Policy: no-referrer`;
- a restrictive Permissions Policy;
- cross-domain-policy denial.

API and other non-executable responses use a deny-all, sandboxed CSP. The image
optimizer is limited to local asset paths and preserves a non-executable image
CSP on success and error responses. The canonical HTTP redirect is fixed to
`https://pagelea.com` and assigns path and query as URL components.

## PDF defensive controls

### General resource limits

Central limits include:

- at most 20 files and 250 MiB per selection;
- at most 100 MiB per PDF and 20 MiB per source image;
- at most 500 pages;
- bounded decoded image dimensions, pixel counts, and canvas memory;
- bounded text items and characters per page and document;
- at most 2,000 editor elements, with per-page, text, stroke, image, and pixel
  budgets;
- iterative PDF object-graph traversal capped by depth and node count;
- indirect-object roots and nested graph entries charged to the same traversal
  budget before obsolete content streams can be deleted;
- bounded page-metadata and thumbnail concurrency;
- bounded ZIP entry and ZIP32 output paths.

These are security and device-resource ceilings, not commercial usage quotas.
They reduce denial-of-service risk but cannot guarantee that every malformed
file will be inexpensive for the browser or third-party PDF parsers.

### Existing-text vector rewrite

For a compatible page, Pagelea identifies a unique source text-show operation,
neutralizes its source string bytes in a copied content stream, replaces the
page's content reference, removes obsolete unreferenced streams where safe,
and writes the replacement as vector text without painting an opaque cleanup
rectangle over the original background. Unedited page text and graphics remain
vector content.

The conservative parser and decoder enforce:

- 16 MiB of combined decoded page content;
- no more than 256 page content streams;
- bounded Flate inflation in 64 KiB chunks;
- raw or single Flate-encoded streams only;
- fail-closed handling for filter chains and decode parameters;
- 50,000 parsed tokens;
- 64 levels of composite nesting;
- 10,000 text blocks and 25,000 text-show operations;
- 4,096 pending operands;
- 512 KiB per literal or hexadecimal string.

The vector path rejects inline images, marked-content operators, Form XObjects,
live annotations, ambiguous text matches, unsupported font encodings, malformed
syntax, unsupported filters, decompression over-budget, and any parsing error.
It also requires every page font to be an unembedded, unremapped WinAnsi
Helvetica, Times, or Courier variant and rejects every unverified text-show
operation. This prevents a custom-font or invisible searchable copy from
surviving while a separately decodable visible operation is replaced. Only
directly decoded printable-ASCII `Tj` strings with exactly one string operand
are eligible: extra or unconsumed string operands, non-printable WinAnsi bytes,
positioned `TJ` arrays, quote operators, and multi-operation text blocks fail
closed. Nested strings are tracked through arrays and dictionaries so an
unreviewed operator cannot leave source text recoverable. Every eligible `Tj`
also requires a local `Tf` selection that resolves to a verified page font;
`ExtGState` font replacement is rejected. A vector rewrite additionally
requires complete, bounded PDF.js text-layer evidence for the page. Selected
evidence text and geometry must match the immutable source fragment, and every
other searchable fragment must have valid geometry and remain outside the
edited source rectangle. A bounded case-folded guard rejects a whole-word
target within another fragment and duplicates reconstructed from complete
fragments, while avoiding the false equivalence between a containing word such
as `Subtotal` and `Total`. Copied page keys and inherited resources must not
alias an old `/Contents` object; unreviewed content-stream dictionaries
independently force the raster path. The graph validator follows pdf-lib's
recursive copy order with a fresh visited set per copied page and resolves
inherited `/Parent` chains iteratively. Marked content is rejected as a class
so escaped `/ActualText` names or external marked-content properties cannot
leave an alternative copy of the replaced text behind.

Flate decoding uses streaming `pako` output with a hard decoded-byte ceiling.
The decoder stops when the remaining page budget would be exceeded rather than
materializing an unbounded decompressed stream.

If the vector path cannot prove that a rewrite is safe, Pagelea uses PDF.js in
the browser to rasterize that source page, removes the old visual text in the
rendered result, and writes the replacement text into the exported PDF. The
fallback does not upload the page, but it can reduce searchability,
accessibility, zoom fidelity, and print fidelity for unaffected content on that
page. Rasterization is capped at 16 million pixels per page, 100 pages and
80 million pixels per export, plus 128 MB of encoded page images. Scale is
reduced against the remaining aggregate pixel budget but never below 72 DPI;
insufficient fidelity or exhausted page/image budgets fail closed with an
instruction to split the document.

Existing-text replacement is an editing feature, not a certified secure
redaction workflow. Users must not rely on it as the sole control for regulated
redaction without independent inspection of the exported file. Non-rendered
copies in comments, metadata, resources, or unrelated objects can remain
outside the visible/searchable text path.

### Sanitize & Flatten

Sanitize & Flatten rebuilds the document and removes the covered actions,
JavaScript, attachments, annotations, embedded files, forms, and metadata.
Metadata mutation never returns the original input bytes as an optimization.
Browser writing assistance is disabled on local-only text fields.

This substantially reduces the covered active structures but is not a malware
verdict. High-risk or adversarial documents still require independent
inspection in an appropriately isolated environment.

## Analytics privacy and persistence

The browser analytics switch is a source constant set to `false`. If a future
release enables it, storage still requires
`PAGELEA_ANONYMOUS_ANALYTICS_ENABLED=true` in the Worker. Both client and server
honor Global Privacy Control and Do Not Track. The client omits credentials,
sends no referrer, and treats telemetry failures as non-blocking.

Accepted records are restricted to five aggregate product events:

- `page_view`;
- `tool_open`;
- `tool_start`;
- `tool_complete`;
- `tool_error`.

Dimensions are normalized to an allowlisted public path or tool slug. D1 does
not store account identifiers, cookies, IP addresses, user-agent strings,
referrers, filenames, document content, signatures, annotations, or raw event
payloads.

The canonical post-migration D1 schema contains only `analytics_daily`. Reads
are bounded to 90 days and 6,000 rows. Ingestion deletes rows outside the
retention window, but there is no independently verified wall-clock deletion
job; policy copy must describe ingestion-time cleanup accurately.

## D1 migration review

`0002_remove_consumer_commerce.sql` intentionally removes the retired consumer
and commerce tables, then deletes analytics rows outside the five-event,
three-dimension contract. It preserves `analytics_daily`.

The migration contains a Drizzle statement breakpoint between every statement
and no trailing empty statement. A local `0000 -> 0001 -> 0002` SQLite exercise
completed with an empty `foreign_key_check`, a successful integrity check, and
only `analytics_daily` remaining.

This migration is destructive by design. Before applying it to a hosted
database, the operator must:

1. create and verify an access-controlled backup or restorable D1 bookmark;
2. record the database and release revision being migrated;
3. confirm that retired account and commerce records are no longer required by
   legal, support, finance, or retention obligations;
4. run the exact migration through the normal deployment mechanism;
5. verify the resulting schema, row contract, and administrative dashboard;
6. archive or destroy the backup according to the approved retention policy.

## Supply-chain and repository controls

The reviewed workflows use least-privilege permissions, fixed runner and
runtime versions, immutable action commit SHAs, locked npm installation,
dependency and licence checks, a production build, tests, deterministic
CycloneDX generation, and tracked-file drift detection. CodeQL covers
JavaScript/TypeScript changes and scheduled analysis. Dependabot covers npm and
GitHub Actions.

The current checks produced:

| Check | Result |
| --- | --- |
| Clean install on Node 22.13.0 / npm 11.17.0 | Passed; dependency patch reapplied |
| Production-only `npm ci --omit=dev` | Passed; dependency patch reapplied and 7 focused runtime tests passed |
| Full production build and test suite | 253 passed, 0 failed |
| TypeScript and ESLint | Passed |
| `npm audit --audit-level=low` | 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=low` | 0 vulnerabilities |
| Dependency licence metadata | 388 packages reviewed |
| Private Rewrite assets and retained licences | 27 assets, 4 worker-bundle components, and 9 licences verified |
| Deterministic CycloneDX SBOM | Passed; root is Pagelea 0.4.2 / AGPL-3.0-or-later |
| Real Chromium mobile edit/export smoke test | Passed in portrait and landscape; Cancel preserved history, Replace created one element and fixed source mask, touch re-entry worked, and focus returned to the replacement |
| Export inspection | Original source text was absent; the replacement and unedited line remained searchable. Automated Unicode LGC/Japanese/Hebrew/Arabic extraction tests passed |
| `git diff --check` | Passed |
| Gitleaks full reachable history scan | Passed on all reachable refs, no finding |
| Historical D1 migration split and SQLite integrity exercise | Passed |

An advisory or secret scan is point-in-time evidence, not proof that every
dependency or blob is safe. The 0.4.2 release must publish the Linux CI SBOM
and checksums produced from the exact public commit and must enable repository
secret scanning, push protection, private vulnerability reporting, branch
protection, and required CI checks.

Version 0.4.2 accepts only the downloaded SBOM artifact from the final Linux CI
run, records its SHA-256 in release provenance, and publishes that exact file.

The repository currently has one eligible maintainer. CODEOWNER approval is
therefore temporarily waived because GitHub does not permit self-approval.
Pull requests, required quality/production-install/CodeQL checks, conversation
resolution, linear history, administrator enforcement, and force-push/deletion
protection remain mandatory. Enable CODEOWNER review when a second eligible
maintainer is available.

Licence metadata allowlisting is an engineering gate, not a legal conclusion.
AGPL source-offer, notices, bundled third-party licences, contributor authority,
and trademark requirements remain separate release obligations.

## Historical repository debt

The already-public history contains a retired maintainer-memory file in nine
older commits. It is absent from the current tree, remains ignored, and the
complete reachable history scan found no secret. Rewriting a repository that
is already public cannot retract prior exposure and would invalidate existing
clones, tags, and source links, so it is not a 0.4.2 release prerequisite.

This remains governance debt. Any future history rewrite requires a verified
access-controlled backup, independent review of every ref and release artifact,
a byte-for-byte comparison with the validated tree, renewed secret scanning,
and explicit owner approval before force-updating public refs.

`.openai/hosting.json` is intentionally public deployment configuration. Its
opaque Sites project identifier and binding names are not credentials and grant
no access by themselves. Authentication material must never be added to it.

## Residual risks

### Anonymous analytics abuse — Medium only if enabled

A scripted client can forge same-origin request headers and inflate aggregate
counters or D1 writes. Keep browser and Worker ingestion disabled until edge
rate limiting, cost alerts, and abuse monitoring are deployed and tested. Treat
the counters as directional product signals only.

### Alternate-host identity spoofing — Medium if misconfigured

Administrator authorization assumes that the official hosted dispatcher owns
the identity header. An alternate deployment that forwards a client-supplied
header can expose aggregate analytics. Strip and replace identity headers at a
trusted edge, configure the exact allowlist, or disable the endpoint.

### Malicious local files — Low residual risk

Limits, iterative traversal, conservative parsing, bounded decompression, and
fallbacks reduce resource-exhaustion risk. PDF.js, pdf-lib, the browser image
decoders, and the device still process attacker-controlled local input. A
malicious or pathological file can potentially stall or crash a tab. Do not
open untrusted documents on a device where a browser failure is unacceptable.

### PDF fidelity and accessibility — Product limitation

The vector rewrite supports only text it can identify unambiguously. Private
Rewrite recognizes English and Italian scans locally, but OCR accuracy,
complex font encodings, arbitrary fonts, and unsupported shaped scripts can
fall back or fail explicitly. Raster fallback reduces accessibility and
selectability for the affected page. Replacement is not word-processor reflow.

### Sanitization scope — Product limitation

Sanitize & Flatten removes the structures covered by its tests but does not
certify a document as harmless. It must not be marketed as a universal malware
scanner or regulated redaction certification.

### Style CSP — Low

The current HTML CSP permits inline styles for framework compatibility. Script
execution remains nonce-restricted. Future build changes should remove the
style exception when practical and regression-test production HTML before
tightening the policy.

### Retention scheduling — Low

Analytics cleanup occurs during ingestion. If ingestion is disabled or stops,
old aggregate rows are excluded from bounded reads but are not removed by an
independently verified scheduled job.

## Release decision

Pagelea Community 0.4.2 is suitable for a public free/open-source beta only
after all of the following are true for the exact release commit:

- the current CI build, tests, audits, CodeQL, and SBOM checks pass;
- repository branch protection, secret scanning, push protection, and private
  vulnerability reporting are enabled;
- the deployed origin is smoke-tested for all eight tools, hidden routes, API
  methods, CSP, security headers, redirects, privacy pages, and mobile layout;
- anonymous analytics remains disabled unless its Medium abuse risk has been
  explicitly mitigated and accepted;
- the published source, licence, notices, SBOM, and checksums identify the exact
  deployed revision.

Subject to those operational gates, the reviewed tree has no known P0 or P1
code blocker. This approval does not expand the API surface, authorize document
uploads, certify secure redaction, or authorize a future history rewrite. The
already-public maintainer-memory file remains documented governance debt, not a
0.4.2 release prerequisite. Version 0.4.2 contains no D1 schema migration; the
historical destructive migration and its recovery requirements are unchanged.
