# Public repository release checklist

This checklist separates technical publication gates from contribution
governance. The public-tree, history, build, product, repository-setting, and
publication sections block an official release. Qualified legal review and a
recorded CLA workflow are strongly recommended governance work, but they block
merging external contributions rather than publication of first-party code.
Until those contribution controls are active, maintainers may discuss external
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
- [ ] Verify the README describes current behavior and limitations rather than
      roadmap claims.

## 3. History gate

Deleting a file in the latest commit does not remove it from Git history.

- [ ] Create and verify an access-controlled backup of the current private
      repository and all refs.
- [ ] Produce a sanitized public history that removes `MEMORY.md`, internal
      project identifiers, and any discovered secret from every reachable
      commit and tag. Use a reviewed history-rewrite tool or create a new clean
      public root commit.
- [ ] Scan the complete candidate public history, not only the working tree,
      with at least two independent secret-detection methods.
- [ ] Inspect large files, deleted blobs, tags, notes, pull-request refs, and
      release artifacts.
- [ ] Rotate any credential found in history before publication, even if the
      history is rewritten.
- [ ] Compare the sanitized tree with the validated release tree and document
      every intentional difference.

History rewriting and a public visibility change are destructive or
externally visible actions. They require an explicit verified backup and final
maintainer review.

## 4. Build and supply-chain gate

Run on the exact candidate commit:

```bash
npm ci
npm run lint
npm run typecheck
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
npm test
npm run --silent sbom > /tmp/pagelea-sbom.cdx.json
git diff --check
```

- [ ] Review the complete licence inventory and all new dependency notices.
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

- [ ] Publish or replace only the sanitized, validated source history.
- [ ] Change visibility to public only after checking the repository name,
      description, topics, homepage, licence detection, and default branch.
- [ ] Publish the exact SBOM and checksums with the first open-source release.
- [ ] Verify anonymous clone, clean install, build, tests, issue templates,
      security advisory flow, website source link, and licence detection.
- [ ] Announce the free/open-source commitments and limitations without
      promising unsupported enterprise terms or service levels.

## 8. Post-publication

- [ ] Monitor CodeQL, Dependabot, secret-scanning, abuse, and issue queues for
      the first 72 hours.
- [ ] Confirm no private refs, artifacts, environments, logs, or workflow
      secrets became visible.
- [ ] Revoke temporary migration credentials and archive the private backup
      under the retention policy.
- [ ] Record the final public commit, release, SBOM, checksums, and verification
      results in the external maintainer memory.
