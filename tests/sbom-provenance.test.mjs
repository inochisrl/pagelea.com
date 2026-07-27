import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  generateNormalizedSbom,
  validatePrivateRewriteSbom,
} from "../scripts/generate-sbom.mjs";
import { PRIVATE_REWRITE_MANIFEST_PATH } from "../scripts/verify-private-rewrite-assets.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = JSON.parse(
  await readFile(
    new URL(`../${PRIVATE_REWRITE_MANIFEST_PATH}`, import.meta.url),
    "utf8",
  ),
);

function propertyValue(component, name) {
  return component.properties?.find(
    (entry) => entry.name === `pagelea:private-rewrite:${name}`,
  )?.value;
}

test("CycloneDX SBOM exactly covers the reviewed Private Rewrite inventory", async () => {
  const firstOutput = await generateNormalizedSbom({
    projectRoot: PROJECT_ROOT,
  });
  const secondOutput = await generateNormalizedSbom({
    projectRoot: PROJECT_ROOT,
  });
  assert.equal(firstOutput, secondOutput);

  const sbom = JSON.parse(firstOutput);
  assert.doesNotThrow(() =>
    validatePrivateRewriteSbom(sbom, MANIFEST),
  );

  const assetComponents = sbom.components.filter(
    (component) => propertyValue(component, "kind") === "asset",
  );
  const licenseComponents = sbom.components.filter(
    (component) => propertyValue(component, "kind") === "license",
  );
  assert.equal(assetComponents.length, MANIFEST.assets.length);
  assert.equal(licenseComponents.length, MANIFEST.licenses.length);
  assert.ok(
    [...assetComponents, ...licenseComponents].every(
      (component) =>
        component.type === "file" &&
        component.hashes?.some(
          (hash) =>
            hash.alg === "SHA-256" &&
            /^[a-f0-9]{64}$/.test(hash.content),
        ) &&
        propertyValue(component, "upstream-commit") &&
        propertyValue(component, "upstream-path") &&
        propertyValue(component, "upstream-repository") &&
        propertyValue(component, "upstream-transform"),
    ),
  );

  const worker = assetComponents.find(
    (component) => component.name === "ocr/worker.min.js",
  );
  assert.deepEqual(worker.licenses, [
    { expression: "Apache-2.0 AND MIT AND BSD-3-Clause" },
  ]);
  assert.deepEqual(
    JSON.parse(propertyValue(worker, "license-paths")),
    MANIFEST.assets.find(
      (asset) => asset.path === "ocr/worker.min.js",
    ).licensePaths,
  );

  const bundledPurls = new Set(
    sbom.components
      .filter((component) => propertyValue(component, "bundled-in"))
      .map((component) => component.purl),
  );
  assert.deepEqual(
    bundledPurls,
    new Set(
      MANIFEST.bundledComponents.map((component) => component.purl),
    ),
  );
});

test("CycloneDX validation rejects drift from the reviewed manifest", async () => {
  const sbom = JSON.parse(
    await generateNormalizedSbom({ projectRoot: PROJECT_ROOT }),
  );
  const tamperedManifest = structuredClone(MANIFEST);
  tamperedManifest.assets[0].sha256 = "0".repeat(64);

  assert.throws(
    () => validatePrivateRewriteSbom(sbom, tamperedManifest),
    /does not match the reviewed manifest/,
  );

  const tamperedBundle = structuredClone(sbom);
  const bundledComponent = tamperedBundle.components.find(
    (component) => propertyValue(component, "bundled-in"),
  );
  assert.ok(bundledComponent);
  bundledComponent.hashes[0].content = "0".repeat(128);

  assert.throws(
    () => validatePrivateRewriteSbom(tamperedBundle, MANIFEST),
    /does not match the reviewed manifest/,
  );
});
