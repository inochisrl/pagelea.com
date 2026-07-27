import assert from "node:assert/strict";
import test from "node:test";

import { importBundledModule } from "./helpers/bundle-module.mjs";

const {
  LOCAL_OCR_ASSET_PATHS,
  LOCAL_OCR_MODEL_CACHE_PATH,
  calculateBoundedOcrRenderScale,
  createLocalPdfOcrSession,
  mapTesseractBlocksToPdfTextPage,
  recognizePdfPageLocally,
  removeOcrFragmentsOverlappingNative,
} = await importBundledModule(
  "../app/lib/pdf-local-ocr.ts",
  import.meta.url,
);
const { PDF_SECURITY_LIMITS } = await importBundledModule(
  "../app/lib/pdf-security-limits.ts",
  import.meta.url,
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(options = {}) {
  const state = {
    blobType: null,
    canvas: null,
    canvasContextOptions: [],
    clearCalls: 0,
    createWorkerCalls: 0,
    language: null,
    oem: null,
    recognizeCalls: 0,
    recognizeInput: null,
    recognizeOptions: null,
    recognizeOutput: null,
    renderCancelCalls: 0,
    renderParams: [],
    terminateCalls: 0,
    workerOptions: null,
    workerOptionsHistory: [],
  };
  const context = {
    clearRect() {
      state.clearCalls += 1;
    },
  };
  const canvas = {
    height: 0,
    width: 0,
    getContext(kind, contextOptions) {
      assert.equal(kind, "2d");
      state.canvasContextOptions.push(contextOptions);
      return context;
    },
    toBlob(callback, type) {
      state.blobType = type;
      callback(new Blob(["local-only-image"], { type: "image/png" }));
    },
  };
  state.canvas = canvas;

  const worker = {
    async recognize(image, recognizeOptions, output) {
      state.recognizeCalls += 1;
      state.recognizeInput = image;
      state.recognizeOptions = recognizeOptions;
      state.recognizeOutput = output;
      state.workerOptions?.logger({
        progress: 0.5,
        status: "recognizing text",
      });
      if (options.recognize) {
        return options.recognize(image, recognizeOptions, output);
      }
      return {
        data: {
          blocks: [
            {
              confidence: 91,
              paragraphs: [
                {
                  is_ltr: true,
                  lines: [
                    {
                      baseline: { x0: 10, y0: 48, x1: 210, y1: 48 },
                      bbox: { x0: 10, y0: 20, x1: 210, y1: 50 },
                      confidence: 94,
                      text: "Pagelea",
                      words: [{ font_name: "Arial" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
    },
    async terminate() {
      state.terminateCalls += 1;
    },
  };
  const tesseract = {
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: "3" },
    async createWorker(language, oem, workerOptions) {
      state.createWorkerCalls += 1;
      state.language = language;
      state.oem = oem;
      state.workerOptions = workerOptions;
      state.workerOptionsHistory.push(workerOptions);
      workerOptions.logger({
        progress: 0.5,
        status: "initializing tesseract",
      });
      workerOptions.logger({
        progress: 0.5,
        status: "loading language traineddata",
      });
      if (options.createWorker) {
        return options.createWorker(worker, workerOptions);
      }
      return worker;
    },
  };
  const runtime = {
    createCanvas() {
      return canvas;
    },
    async loadTesseract() {
      return tesseract;
    },
  };
  const page = {
    rotate: options.pageRotation ?? 0,
    getViewport({ scale, rotation }) {
      const swapsAxes = rotation === 90 || rotation === 270;
      const width = swapsAxes
        ? (options.pageHeight ?? 800) * scale
        : (options.pageWidth ?? 600) * scale;
      const height = swapsAxes
        ? (options.pageWidth ?? 600) * scale
        : (options.pageHeight ?? 800) * scale;
      return {
        height,
        rotation,
        scale,
        transform: [scale, 0, 0, -scale, 0, height],
        width,
      };
    },
    render(params) {
      state.renderParams.push(params);
      const task = options.renderTask
        ? options.renderTask()
        : { promise: Promise.resolve() };
      return {
        cancel() {
          state.renderCancelCalls += 1;
          task.cancel?.();
        },
        promise: task.promise,
      };
    },
  };

  return { canvas, page, runtime, state, tesseract, worker };
}

test("bounded OCR rendering honors target DPI and exact canvas limits", () => {
  const target = calculateBoundedOcrRenderScale(100, 100);
  assert.equal(target, PDF_SECURITY_LIMITS.ocrTargetDpi / 72);

  const dimensionBound = calculateBoundedOcrRenderScale(2_000, 500);
  assert.ok(
    Math.ceil(2_000 * dimensionBound) <=
      PDF_SECURITY_LIMITS.maxOcrCanvasDimension,
  );
  assert.ok(
    Math.ceil(500 * dimensionBound) <=
      PDF_SECURITY_LIMITS.maxOcrCanvasDimension,
  );

  const pixelBound = calculateBoundedOcrRenderScale(2_000, 2_000);
  const pixelWidth = Math.ceil(2_000 * pixelBound);
  const pixelHeight = Math.ceil(2_000 * pixelBound);
  assert.ok(
    pixelWidth * pixelHeight <= PDF_SECURITY_LIMITS.maxOcrCanvasPixels,
  );
  assert.ok(pixelBound < target);

  assert.throws(
    () => calculateBoundedOcrRenderScale(0, 100),
    /positive finite number/,
  );
});

test("mixed pages drop OCR targets that overlap editable native text", () => {
  const native = {
    x: 0.1,
    y: 0.2,
    width: 0.4,
    height: 0.05,
  };
  const overlapping = {
    x: 0.11,
    y: 0.205,
    width: 0.38,
    height: 0.045,
  };
  const scanned = {
    x: 0.1,
    y: 0.6,
    width: 0.4,
    height: 0.05,
  };

  assert.deepEqual(
    removeOcrFragmentsOverlappingNative(
      [overlapping, scanned],
      [native],
    ),
    [scanned],
  );
});

test("mixed-page deduplication uses union coverage across native runs", () => {
  const ocrLine = {
    x: 0.1,
    y: 0.2,
    width: 0.8,
    height: 0.05,
  };
  const nativeWords = Array.from({ length: 4 }, (_, index) => ({
    x: 0.1 + index * 0.2,
    y: 0.2,
    width: 0.2,
    height: 0.05,
  }));

  assert.deepEqual(
    removeOcrFragmentsOverlappingNative([ocrLine], nativeWords),
    [],
  );
});

test("a small native run does not hide a longer OCR line", () => {
  const ocrLine = {
    x: 0.1,
    y: 0.2,
    width: 0.8,
    height: 0.05,
  };
  const smallNativeRun = {
    x: 0.2,
    y: 0.2,
    width: 0.05,
    height: 0.05,
  };

  assert.deepEqual(
    removeOcrFragmentsOverlappingNative(
      [ocrLine],
      [smallNativeRun],
    ),
    [ocrLine],
  );
});

test("mixed-page spatial indexing handles maximum dispersed counts", () => {
  const native = Array.from(
    { length: PDF_SECURITY_LIMITS.maxTextItemsPerPage },
    (_, index) => ({
      x: (index % 100) / 100,
      y: (Math.floor(index / 100) % 40) / 100,
      width: 0.004,
      height: 0.004,
    }),
  );
  const ocr = Array.from(
    { length: PDF_SECURITY_LIMITS.maxOcrLinesPerPage },
    (_, index) => ({
      x: (index % 100) / 100,
      y: 0.6 + (Math.floor(index / 100) % 40) / 100,
      width: 0.004,
      height: 0.004,
    }),
  );

  assert.equal(
    removeOcrFragmentsOverlappingNative(ocr, native).length,
    PDF_SECURITY_LIMITS.maxOcrLinesPerPage,
  );
});

test("adversarial overlap candidate work fails at an explicit budget", () => {
  const native = new Array(1_001).fill({
    x: 0,
    y: 0,
    width: 1,
    height: 0.2,
  });
  const ocr = new Array(1_000).fill({
    x: 0,
    y: 0.8,
    width: 1,
    height: 0.1,
  });

  assert.throws(
    () => removeOcrFragmentsOverlappingNative(ocr, native),
    {
      code: "too-many-overlap-comparisons",
      maximum: PDF_SECURITY_LIMITS.maxOcrOverlapComparisons,
      name: "PdfSecurityLimitError",
    },
  );
});

test("a small native run does not hide a much larger OCR region", () => {
  const largeOcrRegion = {
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.2,
  };
  const smallNativeRun = {
    x: 0.2,
    y: 0.25,
    width: 0.04,
    height: 0.03,
  };

  assert.deepEqual(
    removeOcrFragmentsOverlappingNative(
      [largeOcrRegion],
      [smallNativeRun],
    ),
    [largeOcrRegion],
  );
});

test("Tesseract blocks map to bounded, normalized OCR text fragments", () => {
  const blocks = [
    {
      confidence: 35,
      paragraphs: [
        {
          confidence: 72,
          is_ltr: false,
          lines: [
            {
              baseline: { x0: 0, y0: 60, x1: 200, y1: 70 },
              bbox: { x0: -10, y0: 20, x1: 210, y1: 70 },
              confidence: 125,
              text: "  مرحبا  ",
              words: [{ font_name: "Arial Bold Italic" }],
            },
            {
              bbox: { x0: 20, y0: 80, x1: 20, y1: 90 },
              text: "invalid geometry",
            },
            {
              bbox: { x0: 20, y0: 80, x1: 80, y1: 90 },
              text: "   ",
            },
          ],
        },
      ],
    },
  ];
  const options = {
    documentId: "document-A",
    imageHeight: 100,
    imageWidth: 200,
    language: "ita",
    pageHeight: 200,
    pageIndex: 2,
    pageWidth: 400,
    rotation: 180,
    sourceRotation: 90,
  };

  const mapped = mapTesseractBlocksToPdfTextPage(blocks, options);
  const repeated = mapTesseractBlocksToPdfTextPage(blocks, options);

  assert.deepEqual(
    {
      height: mapped.height,
      language: mapped.language,
      pageIndex: mapped.pageIndex,
      pageNumber: mapped.pageNumber,
      rotation: mapped.rotation,
      sourceRotation: mapped.sourceRotation,
      width: mapped.width,
    },
    {
      height: 200,
      language: "ita",
      pageIndex: 2,
      pageNumber: 3,
      rotation: 180,
      sourceRotation: 90,
      width: 400,
    },
  );
  assert.equal(mapped.fragments.length, 1);

  const fragment = mapped.fragments[0];
  assert.equal(fragment.id, repeated.fragments[0].id);
  assert.equal(fragment.origin, "ocr");
  assert.equal(fragment.text, "مرحبا");
  assert.equal(fragment.confidence, 100);
  assert.equal(fragment.x, 0);
  assert.equal(fragment.y, 0.2);
  assert.equal(fragment.width, 1);
  assert.equal(fragment.height, 0.5);
  assert.equal(fragment.fontName, "Arial Bold Italic");
  assert.equal(fragment.fontFamily, "Arial Bold Italic");
  assert.equal(fragment.resolvedFontName, "Arial Bold Italic");
  assert.equal(fragment.bold, true);
  assert.equal(fragment.italic, true);
  assert.equal(fragment.fontSize, 100);
  assert.equal(fragment.fontSizeNormalized, 0.5);
  assert.equal(fragment.direction, "rtl");
  assert.equal(fragment.hasGeometry, true);
  assert.equal(fragment.hasEOL, true);
  assert.deepEqual(fragment.baseline, {
    start: { x: 0, y: 0.6 },
    end: { x: 1, y: 0.7 },
  });
  assert.ok(Math.abs(fragment.rotation - 2.8624052261) < 1e-9);
  assert.deepEqual(fragment.quad, {
    bottomLeft: { x: 0, y: 0.7 },
    bottomRight: { x: 1, y: 0.7 },
    topLeft: { x: 0, y: 0.2 },
    topRight: { x: 1, y: 0.2 },
  });
});

test("OCR mapping enforces shared line and character budgets", () => {
  const line = {
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    text: "x",
  };
  const excessiveLines = new Array(
    PDF_SECURITY_LIMITS.maxOcrLinesPerPage + 1,
  ).fill(line);
  const baseOptions = {
    imageHeight: 100,
    imageWidth: 100,
    pageHeight: 100,
    pageIndex: 0,
    pageWidth: 100,
  };

  assert.throws(
    () =>
      mapTesseractBlocksToPdfTextPage(
        [{ paragraphs: [{ lines: excessiveLines }] }],
        baseOptions,
      ),
    {
      code: "too-many-ocr-lines",
      maximum: PDF_SECURITY_LIMITS.maxOcrLinesPerPage,
      name: "PdfSecurityLimitError",
    },
  );
  assert.throws(
    () =>
      mapTesseractBlocksToPdfTextPage(
        [
          {
            paragraphs: [
              {
                lines: [
                  {
                    ...line,
                    text: "x".repeat(
                      PDF_SECURITY_LIMITS.maxOcrCharactersPerPage + 1,
                    ),
                  },
                ],
              },
            ],
          },
        ],
        baseOptions,
      ),
    {
      code: "too-many-ocr-characters",
      maximum: PDF_SECURITY_LIMITS.maxOcrCharactersPerPage,
      name: "PdfSecurityLimitError",
    },
  );
});

test("one-page OCR uses only same-origin assets and clears resources", async () => {
  const harness = createHarness();
  const progress = [];

  const result = await recognizePdfPageLocally(harness.page, {
    documentId: "private-document",
    language: "ita",
    onProgress(update) {
      progress.push(update);
    },
    pageIndex: 0,
    runtime: harness.runtime,
  });

  assert.equal(harness.state.createWorkerCalls, 1);
  assert.equal(harness.state.language, "ita");
  assert.equal(harness.state.oem, 1);
  assert.deepEqual(
    {
      cacheMethod: harness.state.workerOptions.cacheMethod,
      cachePath: harness.state.workerOptions.cachePath,
      corePath: harness.state.workerOptions.corePath,
      gzip: harness.state.workerOptions.gzip,
      langPath: harness.state.workerOptions.langPath,
      workerBlobURL: harness.state.workerOptions.workerBlobURL,
      workerPath: harness.state.workerOptions.workerPath,
    },
    {
      cacheMethod: "write",
      cachePath: LOCAL_OCR_MODEL_CACHE_PATH,
      corePath: LOCAL_OCR_ASSET_PATHS.core,
      gzip: false,
      langPath: LOCAL_OCR_ASSET_PATHS.languages,
      workerBlobURL: false,
      workerPath: LOCAL_OCR_ASSET_PATHS.worker,
    },
  );
  assert.ok(harness.state.recognizeInput instanceof Blob);
  assert.equal(harness.state.recognizeInput.type, "image/png");
  assert.deepEqual(harness.state.recognizeOptions, {
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "3",
    user_defined_dpi: "300",
  });
  assert.deepEqual(harness.state.recognizeOutput, {
    blocks: true,
    text: false,
  });
  assert.equal(harness.state.renderParams.length, 1);
  assert.equal(harness.state.renderParams[0].background, "#ffffff");
  assert.equal(
    harness.state.renderParams[0].canvas,
    harness.canvas,
  );
  assert.equal(harness.state.blobType, "image/png");
  assert.equal(harness.canvas.width, 1);
  assert.equal(harness.canvas.height, 1);
  assert.ok(harness.state.clearCalls >= 1);
  assert.equal(harness.state.terminateCalls, 1);
  assert.equal(result.fragments[0].origin, "ocr");

  assert.ok(progress.length >= 5);
  assert.equal(progress.at(-1).stage, "complete");
  assert.equal(progress.at(-1).progress, 1);
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index].progress >= progress[index - 1].progress);
  }
});

test("a session reuses one OCR worker serially across pages", async () => {
  const recognizeGate = deferred();
  let activeRecognitions = 0;
  let maximumConcurrentRecognitions = 0;
  const harness = createHarness({
    async recognize() {
      activeRecognitions += 1;
      maximumConcurrentRecognitions = Math.max(
        maximumConcurrentRecognitions,
        activeRecognitions,
      );
      if (harness.state.recognizeCalls === 1) {
        await recognizeGate.promise;
      }
      activeRecognitions -= 1;
      return { data: { blocks: [] } };
    },
  });
  const session = createLocalPdfOcrSession({
    language: "eng+ita",
    runtime: harness.runtime,
  });

  const first = session.recognizePage(harness.page, { pageIndex: 0 });
  const second = session.recognizePage(harness.page, { pageIndex: 1 });
  await waitForMicrotasks();
  assert.equal(harness.state.recognizeCalls, 1);
  recognizeGate.resolve();
  await Promise.all([first, second]);

  assert.equal(harness.state.createWorkerCalls, 1);
  assert.equal(harness.state.recognizeCalls, 2);
  assert.equal(maximumConcurrentRecognitions, 1);
  assert.equal(harness.state.terminateCalls, 0);
  await session.dispose();
  assert.equal(harness.state.terminateCalls, 1);
});

test("aborting during recognition terminates the worker", async () => {
  const recognitionStarted = deferred();
  const harness = createHarness({
    recognize() {
      recognitionStarted.resolve();
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const pending = recognizePdfPageLocally(harness.page, {
    pageIndex: 0,
    runtime: harness.runtime,
    signal: controller.signal,
  });

  await recognitionStarted.promise;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(harness.state.terminateCalls, 1);
  assert.equal(harness.canvas.width, 1);
  assert.equal(harness.canvas.height, 1);
});

test("aborting a PDF.js render cancels it before OCR starts", async () => {
  const renderStarted = deferred();
  const renderGate = deferred();
  const harness = createHarness({
    renderTask() {
      renderStarted.resolve();
      return { promise: renderGate.promise };
    },
  });
  const controller = new AbortController();
  const pending = recognizePdfPageLocally(harness.page, {
    pageIndex: 0,
    runtime: harness.runtime,
    signal: controller.signal,
  });

  await renderStarted.promise;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(harness.state.renderCancelCalls, 1);
  assert.equal(harness.state.createWorkerCalls, 0);
  assert.equal(harness.canvas.width, 1);
  assert.equal(harness.canvas.height, 1);
  renderGate.reject(new Error("render cancelled"));
});

test("worker initialization times out and a late worker is still terminated", async () => {
  const workerGate = deferred();
  const harness = createHarness({
    createWorker() {
      return workerGate.promise;
    },
  });
  const pending = recognizePdfPageLocally(harness.page, {
    pageIndex: 0,
    runtime: harness.runtime,
    timeoutMs: 5,
  });

  await assert.rejects(pending, { name: "TimeoutError" });
  assert.equal(
    harness.state.workerOptions.workerAbortSignal.aborted,
    true,
  );
  assert.equal(harness.canvas.width, 1);
  assert.equal(harness.canvas.height, 1);
  workerGate.resolve(harness.worker);
  await waitForMicrotasks();
  assert.equal(harness.state.terminateCalls, 1);
});

test("late callbacks from an aborted bootstrap cannot affect its retry", async () => {
  const firstWorkerGate = deferred();
  const retryRecognitionGate = deferred();
  let workerAttempt = 0;
  const retryProgress = [];
  const harness = createHarness({
    createWorker(worker) {
      workerAttempt += 1;
      return workerAttempt === 1
        ? firstWorkerGate.promise
        : worker;
    },
    recognize() {
      return retryRecognitionGate.promise;
    },
  });
  const session = createLocalPdfOcrSession({
    language: "eng",
    runtime: harness.runtime,
  });

  await assert.rejects(
    session.recognizePage(harness.page, {
      pageIndex: 0,
      timeoutMs: 5,
    }),
    { name: "TimeoutError" },
  );
  const staleOptions = harness.state.workerOptionsHistory[0];
  assert.equal(staleOptions.workerAbortSignal.aborted, true);

  const retry = session.recognizePage(harness.page, {
    onProgress(update) {
      retryProgress.push(update);
    },
    pageIndex: 1,
    timeoutMs: 500,
  });
  while (harness.state.recognizeCalls === 0) {
    await waitForMicrotasks();
  }

  const progressBeforeStaleCallback = retryProgress.length;
  staleOptions.logger({
    progress: 0.99,
    status: "recognizing text",
  });
  staleOptions.errorHandler(new Error("stale worker error"));
  await waitForMicrotasks();
  assert.equal(retryProgress.length, progressBeforeStaleCallback);

  retryRecognitionGate.resolve({ data: { blocks: [] } });
  await retry;
  firstWorkerGate.resolve({
    ...harness.worker,
    async terminate() {
      harness.state.terminateCalls += 1;
    },
  });
  await waitForMicrotasks();
  await session.dispose();
  assert.equal(harness.state.createWorkerCalls, 2);
  assert.equal(harness.state.terminateCalls, 2);
});
