# Changelog

All notable changes to Pagelea are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
