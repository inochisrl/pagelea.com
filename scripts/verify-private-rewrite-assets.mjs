import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
} from "node:fs";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");

export const PRIVATE_REWRITE_MANIFEST_PATH =
  "config/private-rewrite-assets.v1.json";
export const PRIVATE_REWRITE_ASSET_ROOT = "public/private-rewrite";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 64 * 1024 * 1024;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA_512_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

const NOTO_FONTS_COMMIT =
  "ffebf8c1ee449e544955a7e813c54f9b73848eac";
const GOOGLE_FONTS_NOTO_SANS_JP_COMMIT =
  "295d98a7a0c17c68f1341eaeea354e7960ea70d3";
const TESSERACT_JS_COMMIT =
  "42eae669e4b3a66429d8516f078912cc747a89df";
const TESSERACT_CORE_COMMIT =
  "acffef2b66eb44a31df297e11d905f4b39001068";
const TESSDATA_FAST_COMMIT =
  "87416418657359cb625c412a48b6e1d6d41c29bd";
const BUFFER_COMMIT =
  "088fd9709e95f96b1f64d1c55ed3c50a19c73e9f";
const IEEE_754_COMMIT =
  "b60d148be9cad718f9ff007c211c2427cdc180a4";
const REGENERATOR_RUNTIME_COMMIT =
  "e4b592a44ef0d3a366cc7ad6125c4d9c8f6cc597";
const ZLIB_JS_COMMIT =
  "2701521273ed7a9741c9a7827fa8de51d8843f7f";

const NOTO_FONT_FILES = Object.freeze([
  "NotoSans-Bold.ttf",
  "NotoSans-BoldItalic.ttf",
  "NotoSans-Condensed.ttf",
  "NotoSans-CondensedBold.ttf",
  "NotoSans-CondensedBoldItalic.ttf",
  "NotoSans-CondensedItalic.ttf",
  "NotoSans-Italic.ttf",
  "NotoSans-Regular.ttf",
  "NotoSansArabic-Bold.ttf",
  "NotoSansArabic-Regular.ttf",
  "NotoSansHebrew-Bold.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansMono-Bold.ttf",
  "NotoSansMono-Regular.ttf",
  "NotoSansSymbols2-Regular.ttf",
  "NotoSerif-Bold.ttf",
  "NotoSerif-BoldItalic.ttf",
  "NotoSerif-Italic.ttf",
  "NotoSerif-Regular.ttf",
]);

const CJK_FONT_FILES = Object.freeze([
  "NotoSansJP[wght].ttf",
]);

const OCR_CORE_FILES = Object.freeze([
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
]);

const EXPECTED_ASSET_PATHS = Object.freeze(
  [
    ...NOTO_FONT_FILES.map((file) => `fonts/${file}`),
    ...CJK_FONT_FILES.map((file) => `fonts/${file}`),
    ...OCR_CORE_FILES.map((file) => `ocr/core/${file}`),
    "ocr/lang/eng.traineddata",
    "ocr/lang/ita.traineddata",
    "ocr/worker.min.js",
    "ocr/worker.min.js.LICENSE.txt",
  ].sort(),
);
const EXPECTED_ASSET_PATH_SET = new Set(EXPECTED_ASSET_PATHS);
const EXPECTED_LICENSES = Object.freeze([
  {
    bytes: 1_106,
    path: "public/licenses/private-rewrite/buffer-MIT.txt",
    sha256:
      "06bafa45fdad2579ba0e43b0c9b2c6290287c99c4203c300254a462b38a307f6",
    spdx: "MIT",
    upstream: {
      commit: BUFFER_COMMIT,
      path: "LICENSE",
      repository: "https://github.com/feross/buffer.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 4_388,
    path: "public/licenses/private-rewrite/google-fonts-noto-sans-jp-OFL-1.1.txt",
    sha256:
      "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9",
    spdx: "OFL-1.1",
    upstream: {
      commit: GOOGLE_FONTS_NOTO_SANS_JP_COMMIT,
      path: "ofl/notosansjp/OFL.txt",
      repository: "https://github.com/google/fonts.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 1_465,
    path: "public/licenses/private-rewrite/ieee754-BSD-3-Clause.txt",
    sha256:
      "18d45466ba3253deae04667e267a91ea8de8548f18c1125264d1c9db28194cc1",
    spdx: "BSD-3-Clause",
    upstream: {
      commit: IEEE_754_COMMIT,
      path: "LICENSE",
      repository: "https://github.com/feross/ieee754.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 4_377,
    path: "public/licenses/private-rewrite/noto-fonts-OFL-1.1.txt",
    sha256:
      "0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb",
    spdx: "OFL-1.1",
    upstream: {
      commit: NOTO_FONTS_COMMIT,
      path: "LICENSE",
      repository: "https://github.com/notofonts/noto-fonts.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 1_080,
    path: "public/licenses/private-rewrite/regenerator-runtime-MIT.txt",
    sha256:
      "51887a3d47051ac2fce1210562e5b9fe0830a8a8fabeb272c2d586eeb18a05fd",
    spdx: "MIT",
    upstream: {
      commit: REGENERATOR_RUNTIME_COMMIT,
      path: "packages/runtime/LICENSE",
      repository: "https://github.com/facebook/regenerator.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 11_358,
    path: "public/licenses/private-rewrite/tessdata-fast-Apache-2.0.txt",
    sha256:
      "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    spdx: "Apache-2.0",
    upstream: {
      commit: TESSDATA_FAST_COMMIT,
      path: "LICENSE",
      repository: "https://github.com/tesseract-ocr/tessdata_fast.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 11_357,
    path: "public/licenses/private-rewrite/tesseract-js-Apache-2.0.txt",
    sha256:
      "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1",
    spdx: "Apache-2.0",
    upstream: {
      commit: TESSERACT_JS_COMMIT,
      path: "LICENSE.md",
      repository: "https://github.com/naptha/tesseract.js.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 11_358,
    path: "public/licenses/private-rewrite/tesseract-js-core-Apache-2.0.txt",
    sha256:
      "c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08",
    spdx: "Apache-2.0",
    upstream: {
      commit: TESSERACT_CORE_COMMIT,
      path: "LICENSE",
      repository: "https://github.com/naptha/tesseract.js-core.git",
      transform: "verbatim",
    },
  },
  {
    bytes: 1_222,
    path: "public/licenses/private-rewrite/zlibjs-MIT.txt",
    sha256:
      "131afe3f7bdce1698beb292fb8de1a968de01bce876122a60ef5db230471c866",
    spdx: "MIT",
    upstream: {
      commit: ZLIB_JS_COMMIT,
      path: "LICENSE",
      repository: "https://github.com/imaya/zlib.js.git",
      transform: "verbatim",
    },
  },
]);
const EXPECTED_LICENSE_PATH_SET = new Set(
  EXPECTED_LICENSES.map((license) => license.path),
);
const EXPECTED_BUNDLED_COMPONENTS = Object.freeze([
  {
    assetPath: "ocr/worker.min.js",
    integrity:
      "sha512-FTiCpNxtwiZZHEZbcbTIcZjERVICn9yq/pDFkTl95/AxzD1naBctN7YO68riM/gLSDY7sdrMby8hofADYuuqOA==",
    license: "MIT",
    licensePath: "public/licenses/private-rewrite/buffer-MIT.txt",
    name: "buffer",
    purl: "pkg:npm/buffer@6.0.3",
    upstream: {
      commit: BUFFER_COMMIT,
      path: "index.js",
      repository: "https://github.com/feross/buffer.git",
      transform: "bundled-by-webpack-in-tesseract.js@7.0.0",
    },
    version: "6.0.3",
  },
  {
    assetPath: "ocr/worker.min.js",
    integrity:
      "sha512-dcyqhDvX1C46lXZcVqCpK+FtMRQVdIMN6/Df5js2zouUsqG7I6sFxitIC+7KYK29KdXOLHdu9zL4sFnoVQnqaA==",
    license: "BSD-3-Clause",
    licensePath:
      "public/licenses/private-rewrite/ieee754-BSD-3-Clause.txt",
    name: "ieee754",
    purl: "pkg:npm/ieee754@1.2.1",
    upstream: {
      commit: IEEE_754_COMMIT,
      path: "index.js",
      repository: "https://github.com/feross/ieee754.git",
      transform: "bundled-by-webpack-in-tesseract.js@7.0.0",
    },
    version: "1.2.1",
  },
  {
    assetPath: "ocr/worker.min.js",
    integrity:
      "sha512-kY1AZVr2Ra+t+piVaJ4gxaFaReZVH40AKNo7UCX6W+dEwBo/2oZJzqfuN1qLq1oL45o56cPaTXELwrTh8Fpggg==",
    license: "MIT",
    licensePath:
      "public/licenses/private-rewrite/regenerator-runtime-MIT.txt",
    name: "regenerator-runtime",
    purl: "pkg:npm/regenerator-runtime@0.13.11",
    upstream: {
      commit: REGENERATOR_RUNTIME_COMMIT,
      path: "packages/runtime/runtime.js",
      repository: "https://github.com/facebook/regenerator.git",
      transform: "bundled-by-webpack-in-tesseract.js@7.0.0",
    },
    version: "0.13.11",
  },
  {
    assetPath: "ocr/worker.min.js",
    integrity:
      "sha512-+J9RrgTKOmlxFSDHo0pI1xM6BLVUv+o0ZT9ANtCxGkjIVCCUdx9alUF8Gm+dGLKbkkkidWIHFDZHDMpfITt4+w==",
    license: "MIT",
    licensePath: "public/licenses/private-rewrite/zlibjs-MIT.txt",
    name: "zlibjs",
    purl: "pkg:npm/zlibjs@0.3.1",
    upstream: {
      commit: ZLIB_JS_COMMIT,
      path: "bin/node-zlib.js",
      repository: "https://github.com/imaya/zlib.js.git",
      transform: "bundled-by-webpack-in-tesseract.js@7.0.0",
    },
    version: "0.3.1",
  },
]);
const ALLOWED_DIRECTORIES = new Set([
  "fonts",
  "ocr",
  "ocr/core",
  "ocr/lang",
]);

const TOP_LEVEL_KEYS = Object.freeze([
  "assetRoot",
  "assets",
  "bundledComponents",
  "licenses",
  "schemaVersion",
]);
const SINGLE_LICENSE_ASSET_KEYS = Object.freeze([
  "bytes",
  "license",
  "licensePath",
  "path",
  "sha256",
  "upstream",
]);
const MULTIPLE_LICENSE_ASSET_KEYS = Object.freeze([
  "bytes",
  "license",
  "licensePaths",
  "path",
  "sha256",
  "upstream",
]);
const LICENSE_KEYS = Object.freeze([
  "bytes",
  "path",
  "sha256",
  "spdx",
  "upstream",
]);
const BUNDLED_COMPONENT_KEYS = Object.freeze([
  "assetPath",
  "integrity",
  "license",
  "licensePath",
  "name",
  "purl",
  "upstream",
  "version",
]);
function fail(message) {
  throw new Error(`Private Rewrite asset verification failed: ${message}`);
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) {
    fail(`${label} must be a JSON object.`);
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    fail(
      `${label} must contain exactly: ${sortedExpectedKeys.join(", ")}.`,
    );
  }
}

function notoFamilyForFile(file) {
  const styleStart = file.search(/-(?:Bold|Condensed|Italic|Regular)/);
  if (styleStart <= 0) {
    fail(`cannot derive the upstream Noto family for "${file}".`);
  }
  return file.slice(0, styleStart);
}

function expectedMetadataForPath(assetPath) {
  if (assetPath.startsWith("fonts/")) {
    const file = posix.basename(assetPath);
    if (CJK_FONT_FILES.includes(file)) {
      return {
        license: "OFL-1.1",
        licensePath:
          "public/licenses/private-rewrite/google-fonts-noto-sans-jp-OFL-1.1.txt",
        upstream: {
          commit: GOOGLE_FONTS_NOTO_SANS_JP_COMMIT,
          path: `ofl/notosansjp/${file}`,
          repository: "https://github.com/google/fonts.git",
          transform: "verbatim",
        },
      };
    }

    if (NOTO_FONT_FILES.includes(file)) {
      return {
        license: "OFL-1.1",
        licensePath:
          "public/licenses/private-rewrite/noto-fonts-OFL-1.1.txt",
        upstream: {
          commit: NOTO_FONTS_COMMIT,
          path: `hinted/ttf/${notoFamilyForFile(file)}/${file}`,
          repository: "https://github.com/notofonts/noto-fonts.git",
          transform: "verbatim",
        },
      };
    }
  }

  if (assetPath.startsWith("ocr/core/")) {
    const file = posix.basename(assetPath);
    if (OCR_CORE_FILES.includes(file)) {
      return {
        license: "Apache-2.0",
        licensePath:
          "public/licenses/private-rewrite/tesseract-js-core-Apache-2.0.txt",
        upstream: {
          commit: TESSERACT_CORE_COMMIT,
          path: file,
          repository:
            "https://github.com/naptha/tesseract.js-core.git",
          transform: "verbatim-from-npm:tesseract.js-core@7.0.0",
        },
      };
    }
  }

  if (
    assetPath === "ocr/lang/eng.traineddata" ||
    assetPath === "ocr/lang/ita.traineddata"
  ) {
    const file = posix.basename(assetPath);
    return {
      license: "Apache-2.0",
      licensePath:
        "public/licenses/private-rewrite/tessdata-fast-Apache-2.0.txt",
      upstream: {
        commit: TESSDATA_FAST_COMMIT,
        path: file,
        repository:
          "https://github.com/tesseract-ocr/tessdata_fast.git",
        transform: "verbatim",
      },
    };
  }

  if (assetPath === "ocr/worker.min.js") {
    return {
      license: "Apache-2.0 AND MIT AND BSD-3-Clause",
      licensePaths: [
        "public/licenses/private-rewrite/tesseract-js-Apache-2.0.txt",
        "public/licenses/private-rewrite/buffer-MIT.txt",
        "public/licenses/private-rewrite/ieee754-BSD-3-Clause.txt",
        "public/licenses/private-rewrite/regenerator-runtime-MIT.txt",
        "public/licenses/private-rewrite/zlibjs-MIT.txt",
      ],
      upstream: {
        commit: TESSERACT_JS_COMMIT,
        path: "dist/worker.min.js",
        repository: "https://github.com/naptha/tesseract.js.git",
        transform: "verbatim-from-npm:tesseract.js@7.0.0",
      },
    };
  }

  if (assetPath === "ocr/worker.min.js.LICENSE.txt") {
    return {
      license: "MIT AND BSD-3-Clause",
      licensePaths: [
        "public/licenses/private-rewrite/buffer-MIT.txt",
        "public/licenses/private-rewrite/ieee754-BSD-3-Clause.txt",
        "public/licenses/private-rewrite/regenerator-runtime-MIT.txt",
        "public/licenses/private-rewrite/zlibjs-MIT.txt",
      ],
      upstream: {
        commit: TESSERACT_JS_COMMIT,
        path: "dist/worker.min.js.LICENSE.txt",
        repository: "https://github.com/naptha/tesseract.js.git",
        transform: "verbatim-from-npm:tesseract.js@7.0.0",
      },
    };
  }

  fail(`"${assetPath}" is not in the reviewed path allowlist.`);
}

function assertSafeRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    isAbsolute(value) ||
    posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value === "." ||
    value.startsWith("../") ||
    value.includes("/../")
  ) {
    fail(`${label} is not a canonical safe relative path.`);
  }
}

function assertMatchingObject(actual, expected, label) {
  assertExactKeys(actual, Object.keys(expected), label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (isPlainObject(expectedValue)) {
      assertMatchingObject(actual[key], expectedValue, `${label}.${key}`);
    } else if (Array.isArray(expectedValue)) {
      if (
        !Array.isArray(actual[key]) ||
        actual[key].length !== expectedValue.length ||
        actual[key].some(
          (value, index) => value !== expectedValue[index],
        )
      ) {
        fail(`${label}.${key} does not match reviewed provenance.`);
      }
    } else if (actual[key] !== expectedValue) {
      fail(`${label}.${key} does not match reviewed provenance.`);
    }
  }
}

async function collectAssetFiles(assetRoot) {
  const rootInfo = await lstat(assetRoot).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    fail(`asset root "${assetRoot}" must be a real directory.`);
  }

  const files = [];
  const walk = async (directory, relativeDirectory = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((first, second) => first.name.localeCompare(second.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`symbolic links are not allowed: "${relativePath}".`);
      }
      if (entry.isDirectory()) {
        if (!ALLOWED_DIRECTORIES.has(relativePath)) {
          fail(`unexpected directory "${relativePath}".`);
        }
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        fail(`unsupported filesystem entry "${relativePath}".`);
      }
    }
  };

  await walk(assetRoot);
  return files.sort();
}

async function sha256File(filePath) {
  return new Promise((resolveDigest, rejectDigest) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", rejectDigest);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveDigest(hash.digest("hex")));
  });
}

function resolveInside(root, safeRelativePath) {
  const resolved = resolve(root, ...safeRelativePath.split("/"));
  const relation = relative(root, resolved);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(`"${safeRelativePath}" resolves outside its approved root.`);
  }
  return resolved;
}

async function readManifest(manifestPath) {
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    fail(
      `cannot read manifest "${manifestPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    return JSON.parse(source);
  } catch {
    fail(`manifest "${manifestPath}" is not valid JSON.`);
  }
}

export async function verifyPrivateRewriteAssets({
  assetRoot,
  manifestPath,
  projectRoot = DEFAULT_PROJECT_ROOT,
} = {}) {
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedAssetRoot = assetRoot
    ? resolve(assetRoot)
    : resolve(resolvedProjectRoot, PRIVATE_REWRITE_ASSET_ROOT);
  const resolvedManifestPath = manifestPath
    ? resolve(manifestPath)
    : resolve(resolvedProjectRoot, PRIVATE_REWRITE_MANIFEST_PATH);
  const manifest = await readManifest(resolvedManifestPath);

  assertExactKeys(manifest, TOP_LEVEL_KEYS, "manifest");
  if (manifest.schemaVersion !== 1) {
    fail("manifest.schemaVersion must be 1.");
  }
  if (manifest.assetRoot !== PRIVATE_REWRITE_ASSET_ROOT) {
    fail(
      `manifest.assetRoot must be "${PRIVATE_REWRITE_ASSET_ROOT}".`,
    );
  }
  if (!Array.isArray(manifest.assets)) {
    fail("manifest.assets must be an array.");
  }
  if (!Array.isArray(manifest.bundledComponents)) {
    fail("manifest.bundledComponents must be an array.");
  }
  if (!Array.isArray(manifest.licenses)) {
    fail("manifest.licenses must be an array.");
  }
  if (manifest.assets.length !== EXPECTED_ASSET_PATHS.length) {
    fail(
      `manifest must contain exactly ${EXPECTED_ASSET_PATHS.length} reviewed assets.`,
    );
  }
  if (manifest.licenses.length !== EXPECTED_LICENSES.length) {
    fail(
      `manifest must contain exactly ${EXPECTED_LICENSES.length} reviewed licences.`,
    );
  }
  if (
    manifest.bundledComponents.length !==
    EXPECTED_BUNDLED_COMPONENTS.length
  ) {
    fail(
      `manifest must contain exactly ${EXPECTED_BUNDLED_COMPONENTS.length} reviewed bundled components.`,
    );
  }

  const licensesByPath = new Map();
  let verifiedLicenseBytes = 0;
  for (const [index, license] of manifest.licenses.entries()) {
    const label = `manifest.licenses[${index}]`;
    assertExactKeys(license, LICENSE_KEYS, label);
    assertSafeRelativePath(license.path, `${label}.path`);
    if (!EXPECTED_LICENSE_PATH_SET.has(license.path)) {
      fail(`"${license.path}" is not in the reviewed licence allowlist.`);
    }
    if (licensesByPath.has(license.path)) {
      fail(`duplicate manifest licence path "${license.path}".`);
    }
    assertMatchingObject(license, EXPECTED_LICENSES[index], label);

    const licenseFile = resolveInside(
      resolvedProjectRoot,
      license.path,
    );
    const licenseInfo = await lstat(licenseFile).catch(() => null);
    if (!licenseInfo?.isFile() || licenseInfo.isSymbolicLink()) {
      fail(`reviewed licence file is unavailable: "${license.path}".`);
    }
    if (licenseInfo.size !== license.bytes) {
      fail(
        `size mismatch for "${license.path}": expected ${license.bytes}, received ${licenseInfo.size}.`,
      );
    }
    const licenseDigest = await sha256File(licenseFile);
    if (licenseDigest !== license.sha256) {
      fail(
        `SHA-256 mismatch for "${license.path}": expected ${license.sha256}, received ${licenseDigest}.`,
      );
    }
    licensesByPath.set(license.path, license);
    verifiedLicenseBytes += licenseInfo.size;
  }

  for (const [index, component] of manifest.bundledComponents.entries()) {
    const label = `manifest.bundledComponents[${index}]`;
    assertExactKeys(component, BUNDLED_COMPONENT_KEYS, label);
    assertSafeRelativePath(component.assetPath, `${label}.assetPath`);
    assertSafeRelativePath(component.licensePath, `${label}.licensePath`);
    if (!SHA_512_INTEGRITY_PATTERN.test(component.integrity)) {
      fail(`${label}.integrity must be a canonical SHA-512 SRI value.`);
    }
    assertMatchingObject(
      component,
      EXPECTED_BUNDLED_COMPONENTS[index],
      label,
    );
    const retainedLicense = licensesByPath.get(component.licensePath);
    if (!retainedLicense || retainedLicense.spdx !== component.license) {
      fail(
        `${label}.licensePath must reference its hashed SPDX licence.`,
      );
    }
  }

  const seenPaths = new Set();
  let declaredTotalBytes = 0;
  for (const [index, asset] of manifest.assets.entries()) {
    const label = `manifest.assets[${index}]`;
    const usesMultipleLicenses = Array.isArray(asset.licensePaths);
    assertExactKeys(
      asset,
      usesMultipleLicenses
        ? MULTIPLE_LICENSE_ASSET_KEYS
        : SINGLE_LICENSE_ASSET_KEYS,
      label,
    );
    assertSafeRelativePath(asset.path, `${label}.path`);
    if (!EXPECTED_ASSET_PATH_SET.has(asset.path)) {
      fail(`"${asset.path}" is not in the reviewed path allowlist.`);
    }
    if (seenPaths.has(asset.path)) {
      fail(`duplicate manifest path "${asset.path}".`);
    }
    seenPaths.add(asset.path);

    if (
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > MAX_ASSET_BYTES
    ) {
      fail(
        `${label}.bytes must be a positive integer no greater than ${MAX_ASSET_BYTES}.`,
      );
    }
    declaredTotalBytes += asset.bytes;
    if (
      !Number.isSafeInteger(declaredTotalBytes) ||
      declaredTotalBytes > MAX_TOTAL_ASSET_BYTES
    ) {
      fail(
        `declared asset bytes exceed the ${MAX_TOTAL_ASSET_BYTES}-byte reviewed budget.`,
      );
    }
    if (
      typeof asset.sha256 !== "string" ||
      !SHA_256_PATTERN.test(asset.sha256)
    ) {
      fail(`${label}.sha256 must be a lowercase SHA-256 digest.`);
    }
    if (
      !isPlainObject(asset.upstream) ||
      typeof asset.upstream.commit !== "string" ||
      !GIT_COMMIT_PATTERN.test(asset.upstream.commit)
    ) {
      fail(`${label}.upstream.commit must be a full lowercase Git commit.`);
    }

    const expected = expectedMetadataForPath(asset.path);
    const declaredLicensePaths = usesMultipleLicenses
      ? asset.licensePaths
      : [asset.licensePath];
    assertMatchingObject(
      {
        license: asset.license,
        ...(usesMultipleLicenses
          ? { licensePaths: declaredLicensePaths }
          : { licensePath: asset.licensePath }),
        upstream: asset.upstream,
      },
      expected,
      label,
    );

    if (declaredLicensePaths.length === 0) {
      fail(`${label} must reference at least one retained licence.`);
    }
    for (const [licenseIndex, licensePath] of declaredLicensePaths.entries()) {
      assertSafeRelativePath(
        licensePath,
        `${label}.licensePaths[${licenseIndex}]`,
      );
      if (!licensesByPath.has(licensePath)) {
        fail(
          `${label} must reference only retained, hashed licence files.`,
        );
      }
    }
    if (!usesMultipleLicenses) {
      const reviewedLicense = licensesByPath.get(asset.licensePath);
      if (reviewedLicense.spdx !== asset.license) {
        fail(
          `${label}.licensePath must reference a hashed licence with the same SPDX identifier.`,
        );
      }
    }
  }

  const manifestPaths = manifest.assets.map((asset) => asset.path);
  for (let index = 0; index < EXPECTED_ASSET_PATHS.length; index += 1) {
    if (manifestPaths[index] !== EXPECTED_ASSET_PATHS[index]) {
      fail(
        "manifest paths must be sorted and exactly match the reviewed inventory.",
      );
    }
  }

  const actualPaths = await collectAssetFiles(resolvedAssetRoot);
  if (
    actualPaths.length !== EXPECTED_ASSET_PATHS.length ||
    actualPaths.some(
      (assetPath, index) => assetPath !== EXPECTED_ASSET_PATHS[index],
    )
  ) {
    const missing = EXPECTED_ASSET_PATHS.filter(
      (assetPath) => !actualPaths.includes(assetPath),
    );
    const unexpected = actualPaths.filter(
      (assetPath) => !EXPECTED_ASSET_PATH_SET.has(assetPath),
    );
    fail(
      [
        missing.length ? `missing: ${missing.join(", ")}` : "",
        unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ") || "filesystem inventory does not match the manifest.",
    );
  }

  let verifiedTotalBytes = 0;
  for (const asset of manifest.assets) {
    const absolutePath = resolveInside(resolvedAssetRoot, asset.path);
    const fileInfo = await lstat(absolutePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      fail(`"${asset.path}" must be a regular file.`);
    }
    if (fileInfo.size !== asset.bytes) {
      fail(
        `size mismatch for "${asset.path}": expected ${asset.bytes}, received ${fileInfo.size}.`,
      );
    }
    const digest = await sha256File(absolutePath);
    if (digest !== asset.sha256) {
      fail(
        `SHA-256 mismatch for "${asset.path}": expected ${asset.sha256}, received ${digest}.`,
      );
    }
    verifiedTotalBytes += fileInfo.size;
  }

  return {
    assetCount: manifest.assets.length,
    bundledComponentCount: manifest.bundledComponents.length,
    licenseBytes: verifiedLicenseBytes,
    licenseCount: manifest.licenses.length,
    manifestPath: resolvedManifestPath,
    totalBytes: verifiedTotalBytes,
  };
}

async function main() {
  const result = await verifyPrivateRewriteAssets();
  const displayedManifest = relative(
    DEFAULT_PROJECT_ROOT,
    result.manifestPath,
  );
  process.stdout.write(
    `Verified ${result.assetCount} Private Rewrite assets (${result.totalBytes.toLocaleString("en-US")} bytes), ${result.bundledComponentCount} bundled components, and ${result.licenseCount} retained licences (${result.licenseBytes.toLocaleString("en-US")} bytes) against ${displayedManifest}.\n`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (
  invokedPath &&
  existsSync(invokedPath) &&
  fileURLToPath(import.meta.url) === invokedPath
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
