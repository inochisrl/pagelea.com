import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const {
  TOOLS,
  getTool,
} = await importBundledModule("../app/lib/tools.ts", import.meta.url);
const { PUBLIC_TOOL_SLUGS } = await importBundledModule(
  "../shared/public-tools.ts",
  import.meta.url,
);

const EXPECTED_PRODUCTION_SLUGS = [
  "pdf-editor",
  "sign-pdf",
  "merge-pdf",
  "organize-pdf",
  "split-pdf",
  "compress-pdf",
  "jpg-to-pdf",
  "flatten-pdf",
];

test("publishes exactly the eight production Pagelea tools", () => {
  assert.deepEqual(PUBLIC_TOOL_SLUGS, EXPECTED_PRODUCTION_SLUGS);
  assert.deepEqual(
    TOOLS.map((tool) => tool.slug).toSorted(),
    EXPECTED_PRODUCTION_SLUGS.toSorted(),
  );
  assert.equal(new Set(PUBLIC_TOOL_SLUGS).size, 8);

  for (const slug of EXPECTED_PRODUCTION_SLUGS) {
    assert.equal(getTool(slug)?.slug, slug);
    assert.equal(getTool(`/tools/${slug}`)?.slug, slug);
  }
});

test("the public registry fails closed for hidden and unknown tools", () => {
  for (const slug of [
    "watermark-pdf",
    "ocr-pdf",
    "extract-pdf-pages",
    "rotate-pdf-pages",
    "workflow",
    "not-a-pagelea-tool",
  ]) {
    assert.equal(getTool(slug), undefined, slug);
    assert.equal(getTool(`/tools/${slug}`), undefined, slug);
  }
});
