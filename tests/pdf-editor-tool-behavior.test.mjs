import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const {
  editorRectFromTap,
  isPersistentCreationTool,
  isTapSizedEditorRect,
} = await importBundledModule(
  "../app/lib/pdf-editor-tool-behavior.ts",
  import.meta.url,
);

const expectedTapSizes = {
  highlight: { height: 0.045, width: 0.28 },
  shape: { height: 0.14, width: 0.24 },
  whiteout: { height: 0.075, width: 0.24 },
};

test("tap-created rectangles have useful tool-specific dimensions", () => {
  for (const [type, expectedSize] of Object.entries(expectedTapSizes)) {
    const rectangle = editorRectFromTap(type, { x: 0.5, y: 0.5 });

    assert.equal(rectangle.width, expectedSize.width, `${type} width`);
    assert.equal(rectangle.height, expectedSize.height, `${type} height`);
    assert.equal(rectangle.x, 0.5 - expectedSize.width / 2, `${type} x`);
    assert.equal(
      rectangle.y,
      0.5 - expectedSize.height / 2,
      `${type} y`,
    );
    assert.ok(rectangle.width > 0.008, `${type} is visibly wide`);
    assert.ok(rectangle.height > 0.008, `${type} is visibly tall`);
  }
});

test("tap-created rectangles clamp fully inside every page edge", () => {
  for (const [type, expectedSize] of Object.entries(expectedTapSizes)) {
    const topLeft = editorRectFromTap(type, { x: 0, y: 0 });
    const bottomRight = editorRectFromTap(type, { x: 1, y: 1 });

    assert.deepEqual(topLeft, {
      ...expectedSize,
      x: 0,
      y: 0,
    });
    assert.deepEqual(bottomRight, {
      ...expectedSize,
      x: 1 - expectedSize.width,
      y: 1 - expectedSize.height,
    });
    assert.equal(bottomRight.x + bottomRight.width, 1);
    assert.equal(bottomRight.y + bottomRight.height, 1);
  }
});

test("tap-sized detection includes its boundary and rejects a real drag", () => {
  assert.equal(isTapSizedEditorRect(0, 0), true);
  assert.equal(isTapSizedEditorRect(0.008, 0.008), true);
  assert.equal(isTapSizedEditorRect(0.0080001, 0.008), false);
  assert.equal(isTapSizedEditorRect(0.008, 0.0080001), false);
  assert.equal(isTapSizedEditorRect(0.2, 0.04), false);
});

test("freehand tools stay active until the user finishes drawing", () => {
  assert.equal(
    isPersistentCreationTool("draw", false),
    true,
    "draw should accept multiple strokes",
  );
  assert.equal(
    isPersistentCreationTool("signature", true),
    true,
    "a drawn signature should accept multiple strokes",
  );
});

test("rectangles, placement tools, and non-drawn signatures are one-shot", () => {
  for (const tool of [
    "highlight",
    "shape",
    "whiteout",
    "text",
    "image",
  ]) {
    assert.equal(
      isPersistentCreationTool(tool, false),
      false,
      `${tool} should return to selection after placement`,
    );
  }
  assert.equal(
    isPersistentCreationTool("signature", false),
    false,
    "typed and uploaded signatures should be placed once",
  );
});
