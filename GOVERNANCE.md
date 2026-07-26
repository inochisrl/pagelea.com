# Pagelea governance

Pagelea is an open-source project stewarded by Inochi SRL.

## Principles

Project decisions prioritize:

1. keeping document processing local and private by default;
2. preserving document integrity, security limits, and honest capability
   claims;
3. maintaining a useful free community edition;
4. keeping the project sustainable through optional commercial licensing,
   enterprise services, and support;
5. welcoming technically sound contributions without weakening the first four
   principles.

## Roles

### Users

Anyone who uses Pagelea or participates in issues and discussions in
accordance with the [Code of Conduct](CODE_OF_CONDUCT.md).

### Contributors

People who submit accepted code, documentation, design, testing, or issue
analysis. Contributors do not receive merge, release, or trademark authority
automatically.

### Maintainers

People appointed by Inochi SRL who triage issues, review changes, merge pull
requests, and operate releases. Maintainers are listed through
[CODEOWNERS](.github/CODEOWNERS) and repository permissions.

### Project steward

Inochi SRL is the final steward for project direction, official releases,
security response, licensing, and use of Pagelea trademarks.

## Decision process

Routine decisions are made through issue and pull-request review. Maintainers
should explain material tradeoffs and seek rough consensus when practical.

The project steward makes the final decision when consensus is not reached or
when a decision affects:

- privacy and security invariants;
- release signing or production operations;
- licence, CLA, trademark, or commercial boundaries;
- compatibility commitments or long-term maintenance;
- legal, regulatory, or financial risk.

Material architectural changes should begin with an issue describing the user
problem, alternatives, privacy impact, security impact, migration plan, and
test strategy.

## Releases

Official releases require:

- review by a maintainer other than the author when practical;
- a clean locked install;
- lint, type checks, dependency audits, build, and complete tests;
- an updated changelog;
- a generated CycloneDX SBOM;
- a signed or otherwise verifiable release artifact when the release process
  supports it.

Only Inochi SRL-controlled channels publish official Pagelea builds.

## Security decisions

Security reports follow [SECURITY.md](SECURITY.md), not public issue triage.
Maintainers may embargo a fix until users can update safely. Security fixes
may be merged without advance public design discussion.

## Maintainer changes

The project steward appoints and removes maintainers based on sustained,
trustworthy contributions and the principle of least privilege. Inactive
access should be removed promptly.

## Changing this document

Governance changes require a pull request, public rationale, and approval by
the project steward. Licensing or CLA changes also require appropriate legal
review.
