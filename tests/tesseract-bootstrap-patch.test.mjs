import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";

const require = createRequire(import.meta.url);
const patchedSource = await readFile(
  new URL(
    "../node_modules/tesseract.js/src/createWorker.js",
    import.meta.url,
  ),
  "utf8",
);

function patchedWorkerHarness({
  hangAction,
  rejectAction,
  workerErrorAction,
} = {}) {
  let jobCounter = 0;
  let messageHandler = null;
  const state = {
    sentActions: [],
    terminateCalls: 0,
  };
  const spawnedWorker = {
    onerror: null,
  };

  const workerAdapter = {
    defaultOptions: {},
    loadImage: async (image) => image,
    onMessage(_worker, callback) {
      messageHandler = callback;
    },
    send(worker, message) {
      state.sentActions.push(message.action);
      if (message.action === hangAction) return;
      queueMicrotask(() => {
        if (message.action === workerErrorAction) {
          worker.onerror?.({
            message: `${message.action} worker crash`,
          });
          return;
        }
        messageHandler?.({
          action: message.action,
          data:
            message.action === rejectAction
              ? `${message.action} failed`
              : null,
          jobId: message.jobId,
          status:
            message.action === rejectAction ? "reject" : "resolve",
          workerId: "worker-test",
        });
      });
    },
    spawnWorker() {
      return spawnedWorker;
    },
    terminateWorker(worker) {
      if (worker.terminated) return;
      worker.terminated = true;
      state.terminateCalls += 1;
    },
  };
  const fakeRequire = (specifier) => {
    switch (specifier) {
      case "./utils/resolvePaths":
        return (options) => options;
      case "./createJob":
        return (job) => ({
          ...job,
          id: job.id ?? `job-${++jobCounter}`,
        });
      case "./utils/log":
        return { log() {} };
      case "./utils/getId":
        return () => "worker-test";
      case "./constants/OEM":
        return {
          DEFAULT: 3,
          LSTM_ONLY: 1,
          TESSERACT_LSTM_COMBINED: 2,
          TESSERACT_ONLY: 0,
        };
      case "./worker/node":
        return workerAdapter;
      default:
        throw new Error(`Unexpected dependency ${specifier}`);
    }
  };
  const commonJsModule = { exports: {} };
  const factory = new Script(
    `(function(require, module, exports) {\n${patchedSource}\n})`,
    { filename: "patched-tesseract-createWorker.js" },
  ).runInThisContext();
  factory(
    fakeRequire,
    commonJsModule,
    commonJsModule.exports,
  );

  return {
    createWorker: commonJsModule.exports,
    state,
  };
}

function workerOptions(overrides = {}) {
  return {
    errorHandler() {},
    logger() {},
    ...overrides,
  };
}

for (const rejectAction of ["loadLanguage", "initialize"]) {
  test(`patched Tesseract terminates when ${rejectAction} bootstrap fails`, async () => {
    const harness = patchedWorkerHarness({ rejectAction });

    await assert.rejects(
      harness.createWorker(
        "eng",
        1,
        workerOptions(),
      ),
      new RegExp(`${rejectAction} failed`),
    );
    assert.equal(harness.state.terminateCalls, 1);
  });
}

test("patched Tesseract aborts and terminates a hanging bootstrap", async () => {
  const harness = patchedWorkerHarness({ hangAction: "loadLanguage" });
  const controller = new AbortController();
  const pending = harness.createWorker(
    "eng",
    1,
    workerOptions({ workerAbortSignal: controller.signal }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(harness.state.terminateCalls, 1);
});

test("patched Tesseract terminates a worker that crashes during bootstrap", async () => {
  const harness = patchedWorkerHarness({
    workerErrorAction: "load",
  });

  await assert.rejects(
    harness.createWorker("eng", 1, workerOptions()),
    /load worker crash/,
  );
  assert.equal(harness.state.terminateCalls, 1);
});

test("patched Tesseract keeps a successful worker until explicit disposal", async () => {
  const harness = patchedWorkerHarness();
  const worker = await harness.createWorker(
    "eng",
    1,
    workerOptions(),
  );

  assert.deepEqual(harness.state.sentActions, [
    "load",
    "loadLanguage",
    "initialize",
  ]);
  assert.equal(harness.state.terminateCalls, 0);
  await worker.terminate();
  assert.equal(harness.state.terminateCalls, 1);
});

test("patched Tesseract rejects an active job immediately after a runtime crash", async () => {
  const harness = patchedWorkerHarness({
    workerErrorAction: "recognize",
  });
  const worker = await harness.createWorker(
    "eng",
    1,
    workerOptions(),
  );

  await assert.rejects(
    worker.recognize(new Uint8Array([1, 2, 3])),
    /recognize worker crash/,
  );
  assert.equal(harness.state.terminateCalls, 1);
  await assert.rejects(
    worker.setParameters({ preserve_interword_spaces: "1" }),
    /recognize worker crash/,
  );
});

test("patched browser image loading forwards cancellation and callback errors", async () => {
  const loadImage = require(
    "../node_modules/tesseract.js/src/worker/browser/loadImage.js",
  );
  const originalFetch = globalThis.fetch;
  const originalFileReader = globalThis.FileReader;
  const originalHTMLElement = globalThis.HTMLElement;

  class TestElement {}
  class RejectingFileReader {
    static EMPTY = 0;
    static LOADING = 1;

    readyState = RejectingFileReader.EMPTY;

    abort() {
      this.readyState = RejectingFileReader.EMPTY;
      this.onabort?.();
    }

    readAsArrayBuffer() {
      this.readyState = RejectingFileReader.LOADING;
      queueMicrotask(() => {
        this.readyState = RejectingFileReader.EMPTY;
        this.onerror?.({
          target: { error: { code: 7 } },
        });
      });
    }
  }

  try {
    globalThis.HTMLElement = TestElement;
    globalThis.FileReader = RejectingFileReader;
    globalThis.fetch = (_url, { signal } = {}) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      });

    const video = new TestElement();
    video.tagName = "VIDEO";
    video.poster = "https://pagelea.test/poster.png";
    const controller = new AbortController();
    const videoLoad = loadImage(video, controller.signal);
    controller.abort(new Error("video cancelled"));
    await assert.rejects(videoLoad, /video cancelled/);

    const nullCanvas = new TestElement();
    nullCanvas.tagName = "CANVAS";
    nullCanvas.toBlob = (callback) => callback(null);
    await assert.rejects(
      loadImage(nullCanvas),
      /could not be converted/i,
    );

    const failingCanvas = new TestElement();
    failingCanvas.tagName = "CANVAS";
    failingCanvas.toBlob = (callback) =>
      callback(new Blob([new Uint8Array([1])]));
    await assert.rejects(
      loadImage(failingCanvas),
      /Code=7/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.FileReader = originalFileReader;
    globalThis.HTMLElement = originalHTMLElement;
  }
});
