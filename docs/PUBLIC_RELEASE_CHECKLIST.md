# Public repository release checklist

This checklist separates technical release gates from contribution and history
governance. The repository is already public. First-party rights confirmation
and the public-tree, build, product, repository-setting, and publication
sections block the official 0.4.0 release. Section 3 records known historical
governance debt but does not block 0.4.0. Qualified legal review and a recorded
CLA workflow are strongly recommended governance work, but they block merging
external contributions rather than publication of first-party code. Until
those contribution controls are active, maintainers may discuss external
patches but must not merge them.

## 1. Rights and contribution governance

- [ ] The releasing maintainer confirms that Inochi SRL owns or has sufficient
      rights to publish the first-party source, design, image, and
      documentation included in the release.
- [ ] Record any employee, contractor, or prior-contributor rights evidence in
      the private maintainer record.
- [ ] Have qualified counsel review `LICENSE`, `LICENSING.md`, `CLA.md`, and
      `TRADEMARKS.md` before relying on the dual-licensing model in a material
      commercial transaction.
- [ ] Configure a recorded individual and, when necessary, corporate CLA
      acceptance workflow before merging any external contribution.

## 2. Public-tree gate

`.openai/hosting.json` is intentionally public deployment configuration. It
contains only the opaque Sites project identifier and binding names required to
reproduce the official deployment. Those values are not credentials, grant no
access by themselves, and must never be replaced with authentication material
or environment secrets.

- [ ] Confirm `MEMORY.md` is absent from the worktree and preserved in the
      owner-only external maintainer directory.
- [ ] Remove credentials, unapproved private deployment identifiers, customer
      data, internal contacts, and non-public business records from every
      public file.
- [ ] Verify `.openai/hosting.json` still contains only the reviewed public,
      opaque Sites project and binding identifiers required for deployment.
- [ ] Confirm all environment files, local variables, private keys, generated
      SBOMs, build output, and maintainer-only directories are ignored.
- [ ] Verify third-party licence files remain beside bundled PDF.js assets.
- [ ] Verify every Private Rewrite OCR/font asset matches
      `config/private-rewrite-assets.v1.json` and its retained licence.
- [ ] Verify the README describes current behavior and limitations rather than
      roadmap claims.

## 3. Historical governance debt (not a 0.4.0 release gate)

The already-public reachable history contains a retired `MEMORY.md` file in
nine older commits. It is absent from the current tree, remains ignored, and
the complete reachable-history scan found no secret. Rewriting that history
cannot retract prior public exposure and would invalidate existing clones,
tags, and source links. A clean-root or history rewrite is therefore not a
0.4.0 release prerequisite.

If the owner later elects to rewrite public history, all of the following
become mandatory preconditions for that separate operation:

- [ ] Obtain explicit owner approval for the exact rewrite scope and public-ref
      update plan.
- [ ] Create and verify an access-controlled backup of the repository and all
      refs.
- [ ] Inspect commits, tags, notes, large blobs, deleted files, pull-request
      refs, and release artifacts.
- [ ] Scan the complete rewritten candidate history with at least two
      independent secret-detection methods.
- [ ] Rotate any credential discovered during the review before updating public
      refs.
- [ ] Compare the rewritten candidate tree byte-for-byte with the validated
      release tree and document every intentional difference.

Do not force-update public refs as part of the 0.4.0 release unless that
separate approval, backup, review, and verification process has completed.

## 4. Build and supply-chain gate

Run on the exact candidate commit:

```bash
npm ci
npm run lint
npm run typecheck
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
npm run assets:check
npm test
npm run --silent sbom > /tmp/pagelea-sbom.cdx.json
git diff --check
```

- [ ] Review the complete licence inventory and all new dependency notices.
- [ ] Confirm `npm run assets:check` reports the exact reviewed OCR/font
      inventory with no drift.
- [ ] Confirm the locked Tesseract patch applies during both `npm ci` and
      `npm ci --omit=dev`, and its focused bootstrap, cancellation,
      runtime-crash, and image-loading tests pass.
- [ ] Confirm the SBOM parses as CycloneDX and identifies the root licence as
      `AGPL-3.0-or-later`.
- [ ] Record source SHA, SBOM SHA-256, build artifact SHA-256, and quality-gate
      URL.

## 5. Product and AGPL gate

- [ ] The hosted interface offers users a visible link to the exact
      corresponding source for the deployed version.
- [ ] All manual community tools are available without an account, payment, or
      artificial task quota.
- [ ] Privacy and product notices match the deployed network behavior.
- [ ] No enterprise-only module, commercial contract, credential, or private
      customer integration is included accidentally.
- [ ] Forks can build and test the community tree from documented prerequisites.

## 6. GitHub repository settings

- [ ] Enable private vulnerability reporting.
- [ ] Enable Dependabot alerts and security updates.
- [ ] Enable secret scanning and push protection.
- [ ] Enable CodeQL/default code scanning or verify the committed workflow.
- [ ] Protect `main`: require pull requests, required quality and CodeQL checks,
      conversation resolution, and no force pushes or deletions.
- [ ] Require CODEOWNER review for licensing, governance, security, and release
      boundaries.
- [ ] Limit workflow permissions to read by default and approve exceptions
      explicitly.
- [ ] Verify issue forms, pull-request template, security contact link, labels,
      and discussions/support choices.
- [ ] Activate the reviewed CLA workflow and test it with an external account.

## 7. Publication

- [ ] Publish the exact validated 0.4.0 commit and tag to the already-public
      repository without rewriting historical refs.
- [ ] Verify the repository name, description, topics, homepage, licence
      detection, and default branch.
- [ ] Publish the exact SBOM and checksums with the 0.4.0 release.
- [ ] Verify anonymous clone, clean install, build, tests, issue templates,
      security advisory flow, website source link, and licence detection.
- [ ] Announce the free/open-source commitments and limitations without
      promising unsupported enterprise terms or service levels.

## 8. Post-publication

- [ ] Monitor CodeQL, Dependabot, secret-scanning, abuse, and issue queues for
      the first 72 hours.
- [ ] Confirm no private refs, artifacts, environments, logs, or workflow
      secrets became visible.
- [ ] If a separately approved history rewrite occurred, revoke its temporary
      credentials and archive its verified backup under the retention policy.
- [ ] Record the final public commit, release, SBOM, checksums, and verification
      results in the external maintainer memory.
