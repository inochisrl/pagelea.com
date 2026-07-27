import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PRIVATE_REWRITE_ASSET_ROOT,
  PRIVATE_REWRITE_MANIFEST_PATH,
  verifyPrivateRewriteAssets,
} from "../scripts/verify-private-rewrite-assets.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ASSET_ROOT = join(PROJECT_ROOT, PRIVATE_REWRITE_ASSET_ROOT);
const MANIFEST_PATH = join(
  PROJECT_ROOT,
  PRIVATE_REWRITE_MANIFEST_PATH,
);
const MANIFEST = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const LICENSE_ROOT = join(
  PROJECT_ROOT,
  "public/licenses/private-rewrite",
);

async function withTemporaryManifest(mutate, assertion) {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "pagelea-private-rewrite-assets-"),
  );
  const temporaryManifest = join(temporaryDirectory, "manifest.json");
  const candidate = structuredClone(MANIFEST);
  mutate(candidate);
  await writeFile(
    temporaryManifest,
    `${JSON.stringify(candidate, null, 2)}\n`,
    "utf8",
  );

  try {
    await assertion(temporaryManifest);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function withTemporaryLicenses(mutate, assertion) {
  const temporaryProjectRoot = await mkdtemp(
    join(tmpdir(), "pagelea-private-rewrite-licenses-"),
  );
  const temporaryLicenseParent = join(
    temporaryProjectRoot,
    "public/licenses",
  );
  const temporaryLicenseRoot = join(
    temporaryLicenseParent,
    "private-rewrite",
  );
  await mkdir(temporaryLicenseParent, { recursive: true });
  await cp(LICENSE_ROOT, temporaryLicenseRoot, { recursive: true });

  try {
    await mutate(temporaryLicenseRoot);
    await assertion(temporaryProjectRoot);
  } finally {
    await rm(temporaryProjectRoot, { force: true, recursive: true });
  }
}

test("Private Rewrite asset manifest verifies the complete reviewed inventory", async () => {
  const result = await verifyPrivateRewriteAssets({
    assetRoot: ASSET_ROOT,
    manifestPath: MANIFEST_PATH,
    projectRoot: PROJECT_ROOT,
  });

  assert.deepEqual(
    {
      assetCount: result.assetCount,
      bundledComponentCount: result.bundledComponentCount,
      licenseBytes: result.licenseBytes,
      licenseCount: result.licenseCount,
      totalBytes: result.totalBytes,
    },
    {
      assetCount: 27,
      bundledComponentCount: 4,
      licenseBytes: 47_711,
      licenseCount: 9,
      totalBytes: 37_539_698,
    },
  );
});

test("Private Rewrite asset verification detects byte tampering", async () => {
  await withTemporaryManifest(
    (candidate) => {
      candidate.assets[0].sha256 = "0".repeat(64);
    },
    async (temporaryManifest) => {
      await assert.rejects(
        verifyPrivateRewriteAssets({
          assetRoot: ASSET_ROOT,
          manifestPath: temporaryManifest,
          projectRoot: PROJECT_ROOT,
        }),
        /SHA-256 mismatch for "fonts\/NotoSans-Bold\.ttf"/,
      );
    },
  );
});

test("Private Rewrite asset verification detects retained licence tampering", async () => {
  await withTemporaryLicenses(
    async (temporaryLicenseRoot) => {
      const licensePath = join(
        temporaryLicenseRoot,
        "buffer-MIT.txt",
      );
      const bytes = await readFile(licensePath);
      bytes[0] ^= 1;
      await writeFile(licensePath, bytes);
    },
    async (temporaryProjectRoot) => {
      await assert.rejects(
        verifyPrivateRewriteAssets({
          assetRoot: ASSET_ROOT,
          manifestPath: MANIFEST_PATH,
          projectRoot: temporaryProjectRoot,
        }),
        /SHA-256 mismatch for "public\/licenses\/private-rewrite\/buffer-MIT\.txt"/,
      );
    },
  );
});

test("Private Rewrite asset verification pins worker bundle components", async () => {
  await withTemporaryManifest(
    (candidate) => {
      candidate.bundledComponents[0].integrity =
        `sha512-${"A".repeat(86)}==`;
    },
    async (temporaryManifest) => {
      await assert.rejects(
        verifyPrivateRewriteAssets({
          assetRoot: ASSET_ROOT,
          manifestPath: temporaryManifest,
          projectRoot: PROJECT_ROOT,
        }),
        /does not match reviewed provenance/,
      );
    },
  );
});

test("Private Rewrite asset verification rejects path traversal", async () => {
  await withTemporaryManifest(
    (candidate) => {
      candidate.assets[0].path = "../NotoSans-Bold.ttf";
    },
    async (temporaryManifest) => {
      await assert.rejects(
        verifyPrivateRewriteAssets({
          assetRoot: ASSET_ROOT,
          manifestPath: temporaryManifest,
          projectRoot: PROJECT_ROOT,
        }),
        /canonical safe relative path/,
      );
    },
  );
});

test("Private Rewrite asset verification pins reviewed provenance", async () => {
  await withTemporaryManifest(
    (candidate) => {
      candidate.assets[0].upstream.repository =
        "https://example.invalid/unreviewed.git";
    },
    async (temporaryManifest) => {
      await assert.rejects(
        verifyPrivateRewriteAssets({
          assetRoot: ASSET_ROOT,
          manifestPath: temporaryManifest,
          projectRoot: PROJECT_ROOT,
        }),
        /does not match reviewed provenance/,
      );
    },
  );
});
