# Pagelea security policy

Thank you for helping protect Pagelea and its users. Suspected vulnerabilities
must be reported privately so maintainers can investigate and release a fix
before public disclosure.

## Supported versions

| Version | Security support |
| --- | --- |
| Latest release and current `main` | Supported |
| Older releases and historical commits | Unsupported |
| Third-party forks or modified deployments | Contact their operator |

Security fixes are normally applied to `main` and the latest release. Backports
are not guaranteed unless announced for a specific release line.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

[Report a Pagelea vulnerability privately](https://github.com/inochisrl/pagelea.com/security/advisories/new)

Do not open a public issue, discussion, pull request, or social-media post for
an undisclosed vulnerability.

Include:

- affected version, commit, route, and environment;
- realistic impact and attack prerequisites;
- minimal reproduction steps using synthetic data;
- relevant request and response metadata with credentials removed;
- a proposed mitigation when known.

Do not include:

- customer, employee, or confidential PDFs and images;
- authentication headers, cookies, tokens, API keys, administrator allowlists,
  or private keys;
- complete identity, infrastructure, or analytics records;
- destructive payloads beyond the minimum needed to establish impact.

If GitHub private reporting is unavailable, use
[inochi.srl](https://inochi.srl/) only to request a verified Pagelea security
contact. Do not include vulnerability details until a private channel is
confirmed.

## Research guidelines

Use local builds, synthetic documents, and test identities you own.

Without prior written authorization, do not:

- run automated scanners or denial-of-service tests against production;
- degrade service, exhaust resources, or test rate limits aggressively;
- access, alter, retain, or disclose another person's data;
- use social engineering, credential attacks, persistence, or physical access;
- test third-party infrastructure outside Pagelea's control;
- publicly disclose an unresolved report.

Stop when you have enough evidence to demonstrate the issue. Remove sensitive
temporary material after maintainers confirm receipt.

## Response process

On a best-effort basis, maintainers aim to:

- acknowledge a complete report within two business days;
- provide initial triage within five business days;
- send at least weekly updates for a confirmed unresolved issue;
- coordinate disclosure after a fix or mitigation is available.

These targets are not contractual service levels. Complex reports, weekends,
holidays, or dependency coordination may require more time.

The project does not currently operate a public bug-bounty program and cannot
promise payment or credit. Credit is offered when appropriate and requested,
subject to safety and privacy constraints.

## Coordinated disclosure

Maintainers will assess affected versions, severity, containment, regression
coverage, release notes, and whether a CVE or GitHub Security Advisory is
appropriate. Reporters should allow a reasonable remediation period before
publication and coordinate timing with maintainers.

Security releases should include a regression test whenever doing so does not
publish an unsafe exploit primitive.

## Good-faith research

Inochi SRL will not recommend legal action solely for accidental, good-faith
research that follows this policy, avoids privacy harm and service disruption,
and gives maintainers a reasonable opportunity to remediate. This statement
does not grant access rights, waive applicable law, bind third parties, or
authorize activity outside systems and accounts you already have permission to
use.

## Security design

Pagelea's public PDF tools process document bytes locally in the browser. The
hosted application has no document upload API or persistent document library.
Normal page, administration, and operational requests may still reach the
hosting platform as described in the privacy notice.

For implementation details and previously reviewed residual risks, see
`security_best_practices_report.md`.
