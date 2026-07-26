# Contributing to Pagelea

Thank you for helping improve Pagelea. Contributions should preserve its
local-first privacy model, bounded PDF processing, and honest product claims.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md),
[governance model](GOVERNANCE.md), and [licensing policy](LICENSING.md) before
contributing.

## Before opening a pull request

- Search existing issues and pull requests.
- Open an issue before a large feature, public API change, licence-sensitive
  dependency, data-flow change, or architectural rewrite.
- Report suspected vulnerabilities privately as described in
  [SECURITY.md](SECURITY.md).
- Use only synthetic or redistributable PDF fixtures. Never commit customer,
  employee, or otherwise confidential documents.

## Local setup

Requirements:

- Node.js `>=22.13.0`;
- npm `11.17.0`.

```bash
git clone https://github.com/inochisrl/pagelea.com.git
cd pagelea.com
npm ci
npm run dev
```

The document tools do not require credentials for local development. Optional
hosted administration and aggregate analytics paths fail closed when their
platform bindings or authorization settings are absent.

## Quality gate

Run the complete gate before requesting review:

```bash
npm run lint
npm run typecheck
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
npm test
npm run sbom -- > /tmp/pagelea-sbom.cdx.json
git diff --check
```

`npm test` performs a production build before executing the test suite.

## Pull-request expectations

A pull request should:

- solve one coherent problem;
- explain user impact, privacy impact, security impact, and important
  tradeoffs;
- include or update regression tests;
- update documentation and `CHANGELOG.md` when behavior changes;
- avoid unrelated formatting or dependency churn;
- keep generated assets and third-party notices synchronized;
- pass required checks without weakening them.

Use clear imperative commit subjects. Maintainers may squash commits during
merge.

## Privacy and PDF safety

Contributions must not:

- add a document upload or persistence path without an approved threat model;
- transmit filenames, document content, extracted text, annotations, or
  signatures through analytics;
- loosen file, page, image, text, render, ZIP, or object-graph limits merely to
  make a fixture pass;
- render uploaded active content as HTML;
- introduce unbounded parsing, rendering, recursion, or concurrency.

Changes to these boundaries require focused security tests and maintainer
approval.

## Dependencies

Prefer existing platform capabilities and small, actively maintained
dependencies. A new dependency requires:

- a concrete need that cannot reasonably be met with existing code;
- review of maintenance health and supply-chain risk;
- an SPDX licence compatible with the project strategy;
- an update to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when the
  dependency or asset is distributed;
- a refreshed SBOM.

## Contributor License Agreement

Pagelea uses dual licensing. Before an external contribution can be merged,
the contributor must accept [CLA.md](CLA.md) through the repository's recorded
CLA workflow. A pull-request checkbox alone is not a substitute for recorded
acceptance.

Until that workflow is legally reviewed and activated, external pull requests
may be discussed and reviewed but must not be merged.

## Review and acceptance

Maintainers may request changes or decline a contribution when it conflicts
with product direction, privacy, security, maintainability, licensing, or
trademark policy. Submission does not guarantee inclusion.

For usage questions and non-security help, see [SUPPORT.md](SUPPORT.md).
