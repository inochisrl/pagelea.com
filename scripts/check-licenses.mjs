import { execFileSync } from "node:child_process";
import process from "node:process";

const ALLOWED_LICENSES = new Set([
  "(MIT AND Zlib)",
  "0BSD",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT AND Zlib",
  "MIT OR Apache-2.0",
  "MPL-2.0",
  "Public Domain",
]);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packages = JSON.parse(
  execFileSync(npmCommand, ["query", "*", "--json"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  }),
);
const rejected = packages
  .map((packageMetadata) => ({
    license:
      typeof packageMetadata.license === "string"
        ? packageMetadata.license
        : packageMetadata.license?.type ?? "MISSING",
    name: packageMetadata.name,
    version: packageMetadata.version,
  }))
  .filter(({ license }) => !ALLOWED_LICENSES.has(license));

if (rejected.length > 0) {
  throw new Error(
    "Unreviewed dependency licence metadata:\n" +
      rejected
        .map(
          ({ license, name, version }) =>
            `${name}@${version}: ${license}`,
        )
        .join("\n"),
  );
}

process.stdout.write(
  `Reviewed licence metadata for ${packages.length} installed packages.\n`,
);
