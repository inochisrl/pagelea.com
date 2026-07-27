import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const { awaitBounded } = await importBundledModule(
  "../app/lib/abort.ts",
  import.meta.url,
);

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("awaitBounded resolves an operation within its deadline", async () => {
  assert.equal(
    await awaitBounded(Promise.resolve("ready"), {
      timeoutMs: 100,
    }),
    "ready",
  );
});

test("awaitBounded aborts promptly and disposes a late value", async () => {
  const pending = deferred();
  const controller = new AbortController();
  const lateValues = [];
  const result = awaitBounded(pending.promise, {
    onLateResolve(value) {
      lateValues.push(value);
    },
    signal: controller.signal,
    timeoutMs: 1_000,
  });

  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  pending.resolve("late-resource");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lateValues, ["late-resource"]);
});

test("awaitBounded reports a stable timeout error", async () => {
  await assert.rejects(
    awaitBounded(new Promise(() => {}), {
      timeoutMessage: "deadline reached",
      timeoutMs: 2,
    }),
    (error) =>
      error?.name === "TimeoutError" &&
      error.message === "deadline reached",
  );
});
