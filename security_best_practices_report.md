# Pagelea 0.2.0 Security and Release Review

- **Review date:** 2026-07-26
- **Owner:** Inochi SRL
- **Target:** Pagelea Community 0.2.0
- **Licence:** AGPL-3.0-or-later
- **Scope:** the current release-candidate source tree

## Executive summary

Pagelea 0.2.0 is a free and open-source, browser-based PDF workbench. Its
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

There is one mandatory **operational P1 publication gate**: the historical
maintainer repository must not simply be made public. A sanitized clean-root
public history must be created and verified because deleting maintainer-only
files from the tip does not remove them from earlier commits.

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
only same-origin scripts carrying that nonce and contains neither
`unsafe-inline` nor `unsafe-eval`. The policy also restricts connections to the
application origin and workers to same-origin or local Blob URLs, denies
objects and framing, disables base URL changes, and limits form submissions to
the same origin.

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
- bounded page-metadata and thumbnail concurrency;
- bounded ZIP entry and ZIP32 output paths.

These are security and device-resource ceilings, not commercial usage quotas.
They reduce denial-of-service risk but cannot guarantee that every malformed
file will be inexpensive for the browser or third-party PDF parsers.

### Existing-text vector rewrite

For a compatible page, Pagelea identifies a unique source text-show operation,
neutralizes its source string bytes in a copied content stream, replaces the
page's content reference, removes obsolete unreferenced streams where safe,
draws an opaque cleanup region, and writes the replacement as vector text.
Unedited page text and graphics remain vector content.

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
Marked content is rejected as a class so escaped `/ActualText` names or external
marked-content properties cannot leave an alternative copy of the replaced text
behind.

Flate decoding uses streaming `pako` output with a hard decoded-byte ceiling.
The decoder stops when the remaining page budget would be exceeded rather than
materializing an unbounded decompressed stream.

If the vector path cannot prove that a rewrite is safe, Pagelea uses PDF.js in
the browser to rasterize that source page, removes the old visual text in the
rendered result, and writes the replacement text into the exported PDF. The
fallback does not upload the page, but it can reduce searchability,
accessibility, zoom fidelity, and print fidelity for unaffected content on that
page.

Existing-text replacement is an editing feature, not a certified secure
redaction workflow. Users must not rely on it as the sole control for regulated
redaction without independent inspection of the exported file.

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
| Targeted PDF, Worker, analytics, and free-product tests | 43 passed, 0 failed |
| Full production build and test suite | 115 passed, 0 failed |
| `npm audit --audit-level=low` | 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=low` | 0 vulnerabilities |
| D1 migration split and SQLite integrity exercise | Passed |
| `git diff --check` | Passed |
| Gitleaks full reachable history scan | 13 commits scanned, no finding |

An advisory or secret scan is point-in-time evidence, not proof that every
dependency or blob is safe. The first public release must publish the SBOM and
checksums produced from the exact public commit and must enable repository
secret scanning, push protection, private vulnerability reporting, branch
protection, and required CI checks.

Licence metadata allowlisting is an engineering gate, not a legal conclusion.
AGPL source-offer, notices, bundled third-party licences, contributor authority,
and trademark requirements remain separate release obligations.

## Mandatory public-history gate

The existing maintainer history contains a retired maintainer-only memory file.
Removing it in the release commit does not remove it from earlier commits.
Consequently, changing the visibility of that history is not an approved
publication method even though the current secret scan reported no credential.

The public repository must be created from a clean root or an independently
reviewed history rewrite. Before publication:

1. preserve a verified, access-controlled backup of the maintainer repository
   and all refs;
2. construct the public history from the exact validated source tree while
   excluding maintainer memory, local state, generated output, environment
   files, credentials, and private artifacts;
3. compare the candidate public tree byte-for-byte with the validated release
   tree, documenting only intentional exclusions;
4. inspect commits, tags, notes, large blobs, deleted files, artifacts, and
   non-default refs;
5. scan the complete candidate history with at least two independent secret
   detection methods;
6. verify an anonymous clone, locked install, build, tests, licence detection,
   SBOM, source links, issue templates, and security-advisory path.

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

The vector rewrite supports only text it can identify unambiguously. Scanned
documents need OCR, complex font encodings and shaped scripts can fall back or
fail explicitly, and the raster fallback reduces accessibility and
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

Pagelea Community 0.2.0 is suitable for a public free/open-source beta only
after all of the following are true for the exact release commit:

- the clean-root public-history gate is complete;
- the current CI build, tests, audits, CodeQL, and SBOM checks pass;
- the destructive D1 migration has an approved, verified recovery point;
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
uploads, certify secure redaction, or approve publication of the historical
maintainer repository.
