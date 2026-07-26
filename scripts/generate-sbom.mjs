import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);

const packageName = packageJson.name;
const packageVersion = packageJson.version;
const packageLicense = packageJson.license;

if (
  typeof packageName !== "string" ||
  !packageName ||
  typeof packageVersion !== "string" ||
  !packageVersion
) {
  throw new Error("package.json must declare a non-empty name and version.");
}
if (packageLicense !== "AGPL-3.0-or-later") {
  throw new Error(
    "Pagelea's root package licence must be AGPL-3.0-or-later.",
  );
}

function packagePurl(name, version) {
  const slash = name.indexOf("/");
  const encodedName =
    name.startsWith("@") && slash > 1
      ? `${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(
          name.slice(slash + 1),
        )}`
      : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function compareText(left, right) {
  const first = String(left);
  const second = String(right);
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const rawSbom = execFileSync(
  npmCommand,
  ["sbom", "--sbom-format=cyclonedx"],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: "1",
    },
    maxBuffer: 50 * 1024 * 1024,
  },
);
const sbom = JSON.parse(rawSbom);

if (
  sbom.bomFormat !== "CycloneDX" ||
  !sbom.metadata ||
  !sbom.metadata.component ||
  !Array.isArray(sbom.components) ||
  !Array.isArray(sbom.dependencies)
) {
  throw new Error("npm returned an invalid CycloneDX SBOM.");
}

// npm derives the root component name from the checkout-directory basename and
// adds a random serial number and wall-clock timestamp. Normalize those fields
// so the same lockfile and pinned npm version produce byte-for-byte stable
// release evidence regardless of the local directory name.
delete sbom.serialNumber;
delete sbom.metadata.timestamp;

const rootComponent = sbom.metadata.component;
const previousRootReference = rootComponent["bom-ref"];
const rootReference = `${packageName}@${packageVersion}`;
rootComponent["bom-ref"] = rootReference;
rootComponent.type = "application";
rootComponent.name = packageName;
rootComponent.version = packageVersion;
rootComponent.purl = packagePurl(packageName, packageVersion);
rootComponent.licenses = [
  {
    license: {
      id: packageLicense,
    },
  },
];

for (const dependency of sbom.dependencies) {
  if (dependency.ref === previousRootReference) {
    dependency.ref = rootReference;
  }
  if (Array.isArray(dependency.dependsOn)) {
    dependency.dependsOn.sort(compareText);
  }
}
sbom.components.sort((left, right) =>
  compareText(
    left["bom-ref"] ?? left.purl ?? left.name,
    right["bom-ref"] ?? right.purl ?? right.name,
  ),
);
sbom.dependencies.sort((left, right) =>
  compareText(left.ref, right.ref),
);

const output = `${JSON.stringify(sbom, null, 2)}\n`;
if (/sejda-clone/i.test(output)) {
  throw new Error("The normalized SBOM contains a retired project name.");
}

process.stdout.write(output);
