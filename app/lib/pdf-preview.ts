import type { PDFDocumentProxy } from "pdfjs-dist";

import { createAbortError } from "./abort";
import {
  describePdfSecurityLimitIssue,
  getFileLimitIssue,
  getPageCountLimitIssue,
  PDF_SECURITY_LIMITS,
  type PdfSecurityLimitIssue,
} from "./pdf-security-limits";

export type PdfPreviewDocument = PDFDocumentProxy;

type PdfJsModule = typeof import("pdfjs-dist");

const PDF_WORKER_URL = "/pdf.worker.min.mjs";

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let workerConfigured = false;

interface LoadPdfPreviewOptions {
  signal?: AbortSignal;
}

interface DestroyableLoadingTask<Result> {
  promise: Promise<Result>;
  destroy: () => Promise<void>;
}

function createSecurityLimitError(
  issue: PdfSecurityLimitIssue,
): Error {
  const error = new Error(describePdfSecurityLimitIssue(issue));
  error.name = "PdfSecurityLimitError";
  return error;
}

export async function waitForPdfLoadingTask<Result>(
  loadingTask: DestroyableLoadingTask<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  let destroyPromise: Promise<void> | null = null;
  const destroyOnce = () => {
    if (!destroyPromise) {
      try {
        destroyPromise = Promise.resolve(
          loadingTask.destroy(),
        ).catch(() => undefined);
      } catch {
        destroyPromise = Promise.resolve();
      }
    }
    return destroyPromise;
  };

  if (signal?.aborted) {
    await destroyOnce();
    throw createAbortError("PDF loading was aborted.");
  }

  let rejectAbort: ((reason: Error) => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void destroyOnce();
    rejectAbort?.(createAbortError("PDF loading was aborted."));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const document = await Promise.race([
      loadingTask.promise,
      abortPromise,
    ]);
    if (signal?.aborted) {
      await destroyOnce();
      throw createAbortError("PDF loading was aborted.");
    }
    return document;
  } catch (error) {
    await destroyOnce();
    if (signal?.aborted) {
      throw createAbortError("PDF loading was aborted.");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    rejectAbort = null;
  }
}

async function loadPdfJsModule() {
  if (typeof window === "undefined") {
    throw new Error("PDF previews can only be loaded in the browser.");
  }

  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((pdfjs) => {
      if (!workerConfigured) {
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        workerConfigured = true;
      }

      return pdfjs;
    });
  }

  return pdfJsModulePromise;
}

export async function loadPdfPreview(
  bytes: Uint8Array,
  options: LoadPdfPreviewOptions = {},
): Promise<PdfPreviewDocument> {
  const fileIssue = getFileLimitIssue({
    name: "PDF preview",
    size: bytes.byteLength,
    type: "application/pdf",
  });
  if (fileIssue) throw createSecurityLimitError(fileIssue);

  const pdfjs = await loadPdfJsModule();
  if (options.signal?.aborted) {
    throw createAbortError("PDF loading was aborted.");
  }

  // PDF.js transfers the supplied buffer to its worker. Keep the editor's
  // source bytes intact so the same document can still be exported later.
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    cMapPacked: true,
    cMapUrl: "/pdfjs/cmaps/",
    canvasMaxAreaInBytes:
      PDF_SECURITY_LIMITS.maxPdfCanvasAreaInBytes,
    maxImageSize: PDF_SECURITY_LIMITS.maxImagePixels,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    useSystemFonts: true,
    wasmUrl: "/pdfjs/wasm/",
  });

  const document = await waitForPdfLoadingTask(
    loadingTask,
    options.signal,
  );
  const pageIssue = getPageCountLimitIssue(document.numPages);
  if (pageIssue) {
    await loadingTask.destroy().catch(() => undefined);
    throw createSecurityLimitError(pageIssue);
  }
  return document;
}

export async function disposePdfPreview(
  document: PdfPreviewDocument,
): Promise<void> {
  // Destroying the loading task also releases the document proxy, worker and
  // page resources. Unlike cleanup(), it is safe when an in-flight render is
  // being cancelled as the editor swaps documents.
  await document.loadingTask.destroy();
}
