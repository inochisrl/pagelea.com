import { Buffer } from "node:buffer";

import { build } from "esbuild";

/**
 * Bundle a TypeScript entry point exactly as the browser/worker build sees it,
 * then import the in-memory ESM output in Node's test runner.
 */
export async function importBundledModule(relativeEntry, importMetaUrl) {
  const entryUrl = new URL(relativeEntry, importMetaUrl);
  const bundled = await build({
    entryPoints: [entryUrl.pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const moduleUrl =
    "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].contents).toString("base64");
  return import(moduleUrl);
}
