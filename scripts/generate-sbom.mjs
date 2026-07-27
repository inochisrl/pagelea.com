import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  PRIVATE_REWRITE_MANIFEST_PATH,
  verifyPrivateRewriteAssets,
} from "./verify-private-rewrite-assets.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const PROPERTY_PREFIX = "pagelea:private-rewrite:";

function compareText(left, right) {
  const first = String(left);
  const second = String(right);
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
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

function licenseChoice(spdx) {
  return /\b(?:AND|OR|WITH)\b|[()]/.test(spdx)
    ? [{ expression: spdx }]
    : [{ license: { id: spdx } }];
}

function property(name, value) {
  return {
    name: `${PROPERTY_PREFIX}${name}`,
    value: String(value),
  };
}

function sortProperties(properties) {
  properties.sort((left, right) => {
    const nameOrder = compareText(left.name, right.name);
    return nameOrder || compareText(left.value, right.value);
  });
  return properties;
}

function fileReference(kind, path) {
  return `pagelea-private-rewrite:${kind}:${path}`;
}

function upstreamProperties(upstream) {
  return [
    property("upstream-commit", upstream.commit),
    property("upstream-path", upstream.path),
    property("upstream-repository", upstream.repository),
    property("upstream-transform", upstream.transform),
  ];
}

function assetLicensePaths(asset) {
  return Array.isArray(asset.licensePaths)
    ? asset.licensePaths
    : [asset.licensePath];
}

function fileComponent({
  bytes,
  kind,
  license,
  licensePaths,
  path,
  sha256,
  upstream,
}) {
  return {
    "bom-ref": fileReference(kind, path),
    type: "file",
    name: path,
    version: upstream.commit,
    scope: "required",
    hashes: [
      {
        alg: "SHA-256",
        content: sha256,
      },
    ],
    licenses: licenseChoice(license),
    properties: sortProperties([
      property("bytes", bytes),
      property("kind", kind),
      property("license-paths", JSON.stringify(licensePaths)),
      property("path", path),
      ...upstreamProperties(upstream),
    ]),
    externalReferences: [
      {
        type: "vcs",
        url: `${upstream.repository}#${upstream.commit}`,
      },
    ],
  };
}

function dependencyFor(sbom, reference) {
  let dependency = sbom.dependencies.find(
    (candidate) => candidate.ref === reference,
  );
  if (!dependency) {
    dependency = { ref: reference, dependsOn: [] };
    sbom.dependencies.push(dependency);
  }
  if (!Array.isArray(dependency.dependsOn)) {
    dependency.dependsOn = [];
  }
  return dependency;
}

function addUniqueProperty(component, entry) {
  component.properties ??= [];
  if (
    !component.properties.some(
      (candidate) =>
        candidate.name === entry.name &&
        candidate.value === entry.value,
    )
  ) {
    component.properties.push(entry);
  }
}

function addUniqueReference(component, entry) {
  component.externalReferences ??= [];
  if (
    !component.externalReferences.some(
      (candidate) =>
        candidate.type === entry.type && candidate.url === entry.url,
    )
  ) {
    component.externalReferences.push(entry);
  }
}

function sha512HexFromIntegrity(integrity) {
  return Buffer.from(integrity.slice("sha512-".length), "base64").toString(
    "hex",
  );
}

function mergeBundledComponent(sbom, bundled) {
  let component = sbom.components.find(
    (candidate) => candidate.purl === bundled.purl,
  );
  const hash = sha512HexFromIntegrity(bundled.integrity);

  if (!component) {
    component = {
      "bom-ref": `${bundled.name}@${bundled.version}`,
      type: "library",
      name: bundled.name,
      version: bundled.version,
      scope: "required",
      purl: bundled.purl,
      hashes: [{ alg: "SHA-512", content: hash }],
      licenses: licenseChoice(bundled.license),
      properties: [],
      externalReferences: [],
    };
    sbom.components.push(component);
  }

  if (
    component.name !== bundled.name ||
    component.version !== bundled.version
  ) {
    throw new Error(
      `CycloneDX component ${bundled.purl} conflicts with the reviewed bundle manifest.`,
    );
  }
  const componentHash = component.hashes?.find(
    (candidate) => candidate.alg === "SHA-512",
  )?.content;
  if (componentHash && componentHash !== hash) {
    throw new Error(
      `CycloneDX component ${bundled.purl} has an unexpected SHA-512 digest.`,
    );
  }
  if (!componentHash) {
    component.hashes ??= [];
    component.hashes.push({ alg: "SHA-512", content: hash });
  }

  const declaredLicenceIds = (component.licenses ?? [])
    .map((entry) => entry.license?.id)
    .filter(Boolean);
  if (
    declaredLicenceIds.length > 0 &&
    !declaredLicenceIds.includes(bundled.license)
  ) {
    throw new Error(
      `CycloneDX component ${bundled.purl} has an unexpected licence.`,
    );
  }
  component.licenses = licenseChoice(bundled.license);

  for (const entry of [
    property("bundled-in", bundled.assetPath),
    property("integrity", bundled.integrity),
    property("license-path", bundled.licensePath),
    ...upstreamProperties(bundled.upstream),
  ]) {
    addUniqueProperty(component, entry);
  }
  sortProperties(component.properties);
  addUniqueReference(component, {
    type: "vcs",
    url: `${bundled.upstream.repository}#${bundled.upstream.commit}`,
  });

  dependencyFor(sbom, component["bom-ref"]);
  return component["bom-ref"];
}

export function mergePrivateRewriteInventory(sbom, manifest) {
  const rootReference = sbom.metadata.component["bom-ref"];
  const rootDependency = dependencyFor(sbom, rootReference);
  const fileReferences = [];

  for (const asset of manifest.assets) {
    const component = fileComponent({
      bytes: asset.bytes,
      kind: "asset",
      license: asset.license,
      licensePaths: assetLicensePaths(asset),
      path: asset.path,
      sha256: asset.sha256,
      upstream: asset.upstream,
    });
    sbom.components.push(component);
    fileReferences.push(component["bom-ref"]);
    dependencyFor(sbom, component["bom-ref"]);
  }

  for (const retainedLicense of manifest.licenses) {
    const component = fileComponent({
      bytes: retainedLicense.bytes,
      kind: "license",
      license: retainedLicense.spdx,
      licensePaths: [retainedLicense.path],
      path: retainedLicense.path,
      sha256: retainedLicense.sha256,
      upstream: retainedLicense.upstream,
    });
    sbom.components.push(component);
    fileReferences.push(component["bom-ref"]);
    dependencyFor(sbom, component["bom-ref"]);
  }

  const bundledReferences = new Map();
  for (const bundled of manifest.bundledComponents) {
    const reference = mergeBundledComponent(sbom, bundled);
    const references = bundledReferences.get(bundled.assetPath) ?? [];
    references.push(reference);
    bundledReferences.set(bundled.assetPath, references);
  }

  for (const [assetPath, references] of bundledReferences) {
    const assetDependency = dependencyFor(
      sbom,
      fileReference("asset", assetPath),
    );
    assetDependency.dependsOn.push(...references);
    assetDependency.dependsOn = [
      ...new Set(assetDependency.dependsOn),
    ].sort(compareText);
  }

  rootDependency.dependsOn.push(...fileReferences);
  rootDependency.dependsOn = [
    ...new Set(rootDependency.dependsOn),
  ].sort(compareText);
}

function propertyValue(component, name) {
  return component.properties?.find(
    (entry) => entry.name === `${PROPERTY_PREFIX}${name}`,
  )?.value;
}

function assertFileComponent(component, expected) {
  if (
    !component ||
    component.type !== "file" ||
    component.name !== expected.path ||
    component.version !== expected.upstream.commit ||
    component.hashes?.length !== 1 ||
    component.hashes[0].alg !== "SHA-256" ||
    component.hashes[0].content !== expected.sha256 ||
    JSON.stringify(component.licenses) !==
      JSON.stringify(licenseChoice(expected.license)) ||
    propertyValue(component, "bytes") !== String(expected.bytes) ||
    propertyValue(component, "kind") !== expected.kind ||
    propertyValue(component, "license-paths") !==
      JSON.stringify(expected.licensePaths) ||
    propertyValue(component, "path") !== expected.path ||
    propertyValue(component, "upstream-commit") !==
      expected.upstream.commit ||
    propertyValue(component, "upstream-path") !== expected.upstream.path ||
    propertyValue(component, "upstream-repository") !==
      expected.upstream.repository ||
    propertyValue(component, "upstream-transform") !==
      expected.upstream.transform
  ) {
    throw new Error(
      `CycloneDX file component ${expected.path} does not match the reviewed manifest.`,
    );
  }
}

export function validatePrivateRewriteSbom(sbom, manifest) {
  const expectedFiles = [
    ...manifest.assets.map((asset) => ({
      ...asset,
      kind: "asset",
      licensePaths: assetLicensePaths(asset),
    })),
    ...manifest.licenses.map((retainedLicense) => ({
      bytes: retainedLicense.bytes,
      kind: "license",
      license: retainedLicense.spdx,
      licensePaths: [retainedLicense.path],
      path: retainedLicense.path,
      sha256: retainedLicense.sha256,
      upstream: retainedLicense.upstream,
    })),
  ];
  const inventoryComponents = sbom.components.filter((component) =>
    ["asset", "license"].includes(propertyValue(component, "kind")),
  );
  if (inventoryComponents.length !== expectedFiles.length) {
    throw new Error(
      "CycloneDX Private Rewrite file inventory has missing or extra components.",
    );
  }

  const expectedFileReferences = [];
  for (const expected of expectedFiles) {
    const reference = fileReference(expected.kind, expected.path);
    expectedFileReferences.push(reference);
    const component = sbom.components.find(
      (candidate) => candidate["bom-ref"] === reference,
    );
    assertFileComponent(component, expected);
    if (
      !sbom.dependencies.some(
        (dependency) => dependency.ref === reference,
      )
    ) {
      throw new Error(
        `CycloneDX dependency graph omits ${expected.path}.`,
      );
    }
  }

  const rootReference = sbom.metadata.component["bom-ref"];
  const rootDependencies =
    sbom.dependencies.find(
      (dependency) => dependency.ref === rootReference,
    )?.dependsOn ?? [];
  if (
    expectedFileReferences.some(
      (reference) => !rootDependencies.includes(reference),
    )
  ) {
    throw new Error(
      "CycloneDX root dependency graph omits Private Rewrite files.",
    );
  }

  const workerDependencies =
    sbom.dependencies.find(
      (dependency) =>
        dependency.ref === fileReference("asset", "ocr/worker.min.js"),
    )?.dependsOn ?? [];
  const bundledInventoryComponents = sbom.components.filter(
    (component) => propertyValue(component, "bundled-in") !== undefined,
  );
  if (
    bundledInventoryComponents.length !==
    manifest.bundledComponents.length
  ) {
    throw new Error(
      "CycloneDX Private Rewrite bundle inventory has missing or extra components.",
    );
  }

  const expectedBundledReferences = [];
  for (const bundled of manifest.bundledComponents) {
    const component = sbom.components.find(
      (candidate) => candidate.purl === bundled.purl,
    );
    const expectedHash = sha512HexFromIntegrity(bundled.integrity);
    if (
      !component ||
      component.type !== "library" ||
      typeof component["bom-ref"] !== "string" ||
      !component["bom-ref"] ||
      component.name !== bundled.name ||
      component.version !== bundled.version ||
      component.hashes?.length !== 1 ||
      component.hashes[0].alg !== "SHA-512" ||
      component.hashes[0].content !== expectedHash ||
      JSON.stringify(component.licenses) !==
        JSON.stringify(licenseChoice(bundled.license)) ||
      propertyValue(component, "bundled-in") !== bundled.assetPath ||
      propertyValue(component, "integrity") !== bundled.integrity ||
      propertyValue(component, "license-path") !== bundled.licensePath ||
      propertyValue(component, "upstream-commit") !==
        bundled.upstream.commit ||
      propertyValue(component, "upstream-path") !==
        bundled.upstream.path ||
      propertyValue(component, "upstream-repository") !==
        bundled.upstream.repository ||
      propertyValue(component, "upstream-transform") !==
        bundled.upstream.transform ||
      !component.externalReferences?.some(
        (reference) =>
          reference.type === "vcs" &&
          reference.url ===
            `${bundled.upstream.repository}#${bundled.upstream.commit}`,
      )
    ) {
      throw new Error(
        `CycloneDX bundled component ${bundled.purl} does not match the reviewed manifest.`,
      );
    }
    expectedBundledReferences.push(component["bom-ref"]);
  }

  if (
    workerDependencies.length !== expectedBundledReferences.length ||
    expectedBundledReferences.some(
      (reference) => !workerDependencies.includes(reference),
    )
  ) {
    throw new Error(
      "CycloneDX OCR worker dependency graph does not match the reviewed bundle manifest.",
    );
  }

  const references = [
    sbom.metadata.component["bom-ref"],
    ...sbom.components.map((component) => component["bom-ref"]),
  ];
  if (new Set(references).size !== references.length) {
    throw new Error("CycloneDX SBOM contains duplicate component references.");
  }
}

function normalizeSbom(sbom, packageJson) {
  delete sbom.serialNumber;
  delete sbom.metadata.timestamp;

  const rootComponent = sbom.metadata.component;
  const previousRootReference = rootComponent["bom-ref"];
  const rootReference = `${packageJson.name}@${packageJson.version}`;
  rootComponent["bom-ref"] = rootReference;
  rootComponent.type = "application";
  rootComponent.name = packageJson.name;
  rootComponent.version = packageJson.version;
  rootComponent.purl = packagePurl(
    packageJson.name,
    packageJson.version,
  );
  rootComponent.licenses = licenseChoice(packageJson.license);

  for (const dependency of sbom.dependencies) {
    if (dependency.ref === previousRootReference) {
      dependency.ref = rootReference;
    }
  }
}

function sortSbom(sbom) {
  for (const component of sbom.components) {
    component.hashes?.sort((left, right) =>
      compareText(left.alg, right.alg),
    );
    component.properties?.sort((left, right) => {
      const nameOrder = compareText(left.name, right.name);
      return nameOrder || compareText(left.value, right.value);
    });
    component.externalReferences?.sort((left, right) => {
      const typeOrder = compareText(left.type, right.type);
      return typeOrder || compareText(left.url, right.url);
    });
  }
  for (const dependency of sbom.dependencies) {
    dependency.dependsOn = [...new Set(dependency.dependsOn ?? [])].sort(
      compareText,
    );
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
}

export async function generateNormalizedSbom({
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const resolvedProjectRoot = resolve(projectRoot);
  await verifyPrivateRewriteAssets({
    projectRoot: resolvedProjectRoot,
  });
  const packageJson = JSON.parse(
    readFileSync(resolve(resolvedProjectRoot, "package.json"), "utf8"),
  );
  if (
    typeof packageJson.name !== "string" ||
    !packageJson.name ||
    typeof packageJson.version !== "string" ||
    !packageJson.version
  ) {
    throw new Error(
      "package.json must declare a non-empty name and version.",
    );
  }
  if (packageJson.license !== "AGPL-3.0-or-later") {
    throw new Error(
      "Pagelea's root package licence must be AGPL-3.0-or-later.",
    );
  }
  const manifest = JSON.parse(
    readFileSync(
      resolve(resolvedProjectRoot, PRIVATE_REWRITE_MANIFEST_PATH),
      "utf8",
    ),
  );
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const rawSbom = execFileSync(
    npmCommand,
    ["sbom", "--sbom-format=cyclonedx"],
    {
      cwd: resolvedProjectRoot,
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
    !sbom.metadata?.component ||
    !Array.isArray(sbom.components) ||
    !Array.isArray(sbom.dependencies)
  ) {
    throw new Error("npm returned an invalid CycloneDX SBOM.");
  }

  normalizeSbom(sbom, packageJson);
  mergePrivateRewriteInventory(sbom, manifest);
  sortSbom(sbom);
  validatePrivateRewriteSbom(sbom, manifest);

  const output = `${JSON.stringify(sbom, null, 2)}\n`;
  if (/sejda-clone/i.test(output)) {
    throw new Error("The normalized SBOM contains a retired project name.");
  }
  return output;
}

async function main() {
  process.stdout.write(await generateNormalizedSbom());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
