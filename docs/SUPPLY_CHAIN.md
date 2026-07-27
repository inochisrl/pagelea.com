# Supply-chain and SBOM policy

Pagelea treats the lockfile, licence inventory, and software bill of materials
as release evidence.

## Reproducible dependency graph

- `package-lock.json` is committed.
- CI and releases use `npm ci`, not `npm install`.
- Direct versions that are security- or build-critical are pinned.
- `.npmrc` rejects dependency install scripts unless the exact package version
  is reviewed and allowlisted in `package.json`.
- GitHub Actions use reviewed immutable commit SHAs.
- Dependency updates are reviewed separately from unrelated product changes.

## Licence review

Every direct dependency or bundled asset requires:

1. an identified copyright holder and licence;
2. compatibility review for the intended distribution;
3. retention of required notices and source offers;
4. an update to `THIRD_PARTY_NOTICES.md`;
5. a refreshed CycloneDX SBOM.

CI rejects missing or unexpected licence metadata. An allowed SPDX expression
is not automatic legal approval: copyleft, data, font, and content licences
still require review of distribution obligations.

## SBOM

Generate the CycloneDX JSON SBOM from the exact locked release tree:

```bash
npm ci
npm run sbom -- > pagelea-sbom.cdx.json
```

The generated SBOM is intentionally ignored in normal development because it
is derived from `package-lock.json` plus the verified Private Rewrite asset
manifest. CI regenerates and validates it on every change. Each tagged release
should publish its exact SBOM alongside the source archive and release
artifacts.

`scripts/generate-sbom.mjs` removes npm's random serial number and wall-clock
timestamp, sorts dependency records, derives the root component identity from
`package.json`, and adds a hashed CycloneDX file component for every manifest
asset and retained licence. It also records the exact third-party libraries
incorporated into the generated OCR worker and links them to that file in the
dependency graph. This prevents a checkout-directory name from leaking into
release evidence and makes the output byte-for-byte reproducible for the same
installed dependency tree, lockfile, package metadata, asset manifest, Node.js
and npm versions, operating system, and architecture. CI verifies the root
identity and licence, regenerates the SBOM twice on the same Ubuntu runner, and
rejects any missing, extra, or changed Private Rewrite component before
uploading the official release artifact.

The release record should include:

- source commit SHA;
- Node.js and npm versions;
- SBOM SHA-256;
- artifact SHA-256;
- build and test workflow URL;
- security and licence-review result.

## Vulnerability handling

- Run full and production-only `npm audit` checks in CI.
- Use Dependabot for npm and GitHub Actions updates.
- Run CodeQL on pushes, pull requests, and a weekly schedule.
- Do not apply automated breaking upgrades without review.
- Handle suspected exploitable findings under `SECURITY.md`.

## Bundled source and notices

PDF.js assets are self-hosted under `public/pdfjs`. Their licence files must
remain beside the binary, font, CMap, and WebAssembly files. A build or
packaging change must verify those notices are still included.

Private Rewrite assets are self-hosted under `public/private-rewrite` and
declared in `config/private-rewrite-assets.v1.json`. Any OCR model, worker,
WebAssembly loader, or font change must update the retained licence, exact
size, SHA-256 digest, upstream revision, path, and transformation record. Run:

```bash
npm run assets:check
```

The check also pins the third-party packages incorporated into the Tesseract
worker bundle. It rejects missing, unexpected, changed, oversized, symlinked,
or path-traversing assets, bundle components, and retained licence entries.

The locked install also applies
`patches/tesseract.js+7.0.0.patch` with `patch-package`. This reviewed patch
adds cancellation and deterministic cleanup around the browser OCR worker.
`npm ci` must fail if the patch no longer applies exactly, and
`tests/tesseract-bootstrap-patch.test.mjs` exercises its bootstrap failure,
abort, runtime-crash, image-loading, success, and disposal paths. Tesseract's
own package lifecycle script remains disallowed in `package.json`; for
Tesseract, the repository's reviewed patch step is the only install-time
action.

## Release gate

A release is not complete until:

- the dependency graph installs cleanly from the lockfile;
- `npm approve-scripts --allow-scripts-pending` reports no unreviewed install
  script;
- licence metadata has no missing or unreviewed expression;
- full and production audits have no unresolved vulnerability at the project's
  accepted threshold;
- the generated SBOM parses and identifies Pagelea as
  an `AGPL-3.0-or-later` application using the package name and version;
- bundled third-party notices are present;
- the Private Rewrite asset manifest passes `npm run assets:check`;
- the Tesseract source patch applies during a clean `npm ci` and its focused
  regression tests pass;
- the exact release commit passes the complete quality gate.
