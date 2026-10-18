import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";

// Advisories accepted temporarily because no patched release exists yet.
// Every entry needs a reason and a review date; an expired entry fails the
// gate again so the exception cannot linger silently.
const ACCEPTED_ADVISORIES = new Map([
  [
    "GHSA-vfj7-8cjw-p6xm",
    {
      package: "braces",
      reason:
        "No patched braces release (<=3.0.3 affected). Reached only through " +
        "build tooling and patch-package glob patterns, never user input.",
      reviewBy: "2026-11-18",
    },
  ],
]);

const omitDev = process.argv.includes("--omit=dev");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
const result = spawnSync(npmCommand, args, {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error(result.stderr || "npm audit did not return JSON.");
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  process.exit(1);
}

const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const source of vulnerability.via) {
    if (typeof source !== "object" || !source.url) continue;
    const id = source.url.split("/").pop();
    advisories.set(id, {
      package: source.name,
      severity: source.severity,
      title: source.title,
    });
  }
}

const today = new Date().toISOString().slice(0, 10);
const rejected = [];
for (const [id, advisory] of advisories) {
  const accepted = ACCEPTED_ADVISORIES.get(id);
  if (!accepted) {
    rejected.push(`${id} ${advisory.package} (${advisory.severity}): ${advisory.title}`);
  } else if (accepted.reviewBy < today) {
    rejected.push(`${id} ${advisory.package}: accepted until ${accepted.reviewBy}, review expired`);
  } else {
    console.log(
      `Accepted ${id} ${advisory.package} until ${accepted.reviewBy}: ${accepted.reason}`,
    );
  }
}

const scope = omitDev ? "production" : "all";
if (rejected.length > 0) {
  console.error(`npm audit (${scope} dependencies) found unaccepted advisories:`);
  for (const line of rejected) console.error(`- ${line}`);
  process.exit(1);
}
console.log(`npm audit (${scope} dependencies): no unaccepted advisories.`);
