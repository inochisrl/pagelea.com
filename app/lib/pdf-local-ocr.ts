import type { PDFPageProxy } from "pdfjs-dist";

import { createAbortError, throwIfAborted } from "./abort";
import { PDF_SECURITY_LIMITS } from "./pdf-security-limits";
import {
  normalizePdfTextRotation,
  type ExtractedPdfTextFragment,
  type ExtractedPdfTextPage,
  type PdfQuarterTurn,
} from "./pdf-text-extraction";

export const LOCAL_OCR_ASSET_PATHS = Object.freeze({
  worker: "/private-rewrite/ocr/worker.min.js",
  core: "/private-rewrite/ocr/core",
  languages: "/private-rewrite/ocr/lang",
});
export const LOCAL_OCR_MODEL_CACHE_PATH =
  "pagelea-private-rewrite-v1-7d4322bd-b8f89e1e";

export type LocalOcrLanguage = "eng" | "ita" | "eng+ita";

export type LocalOcrProgressStage =
  | "rendering"
  | "loading-engine"
  | "loading-language"
  | "recognizing"
  | "complete";

export interface LocalOcrProgress {
  pageIndex: number;
  progress: number;
  stage: LocalOcrProgressStage;
  status: string;
}

export interface LocalOcrBboxLike {
  x0?: unknown;
  y0?: unknown;
  x1?: unknown;
  y1?: unknown;
}

export type LocalOcrBaselineLike = LocalOcrBboxLike;

export interface LocalOcrWordLike {
  confidence?: unknown;
  font_name?: unknown;
  text?: unknown;
}

export interface LocalOcrLineLike {
  baseline?: LocalOcrBaselineLike | null;
  bbox?: LocalOcrBboxLike | null;
  confidence?: unknown;
  text?: unknown;
  words?: readonly LocalOcrWordLike[] | null;
}

export interface LocalOcrParagraphLike {
  confidence?: unknown;
  is_ltr?: unknown;
  lines?: readonly LocalOcrLineLike[] | null;
}

export interface LocalOcrBlockLike {
  confidence?: unknown;
  paragraphs?: readonly LocalOcrParagraphLike[] | null;
}

export interface MapLocalOcrBlocksOptions {
  documentId?: string;
  imageHeight: number;
  imageWidth: number;
  language?: LocalOcrLanguage;
  pageHeight: number;
  pageIndex: number;
  pageNumber?: number;
  pageWidth: number;
  rotation?: PdfQuarterTurn;
  sourceRotation?: PdfQuarterTurn;
}

export interface LocalOcrPageOptions {
  documentId?: string;
  onProgress?: (progress: LocalOcrProgress) => void;
  pageIndex: number;
  pageNumber?: number;
  rotation?: PdfQuarterTurn;
  signal?: AbortSignal;
  sourceRotation?: PdfQuarterTurn;
  timeoutMs?: number;
}

interface LocalOcrLoggerMessage {
  progress?: unknown;
  status?: unknown;
}

interface LocalOcrRecognizeResult {
  data?: {
    blocks?: readonly LocalOcrBlockLike[] | null;
  };
}

interface LocalOcrWorker {
  recognize(
    image: Blob,
    options: Readonly<Record<string, unknown>>,
    output: Readonly<Record<string, boolean>>,
    jobId?: string,
    signal?: AbortSignal,
  ): Promise<LocalOcrRecognizeResult>;
  terminate(): Promise<unknown>;
}

export interface LocalOcrTesseractModule {
  OEM: {
    LSTM_ONLY: unknown;
  };
  PSM: {
    AUTO: unknown;
  };
  createWorker(
    languages: string,
    oem: unknown,
    options: {
      cacheMethod: string;
      cachePath: string;
      corePath: string;
      errorHandler: (error: unknown) => void;
      gzip: boolean;
      langPath: string;
      logger: (message: LocalOcrLoggerMessage) => void;
      workerAbortSignal: AbortSignal;
      workerBlobURL: boolean;
      workerPath: string;
    },
  ): Promise<LocalOcrWorker>;
}

export interface LocalOcrRuntime {
  createCanvas(): HTMLCanvasElement;
  loadTesseract(): Promise<LocalOcrTesseractModule>;
}

export interface LocalPdfOcrSessionOptions {
  language?: LocalOcrLanguage;
  runtime?: Partial<LocalOcrRuntime>;
}

export interface LocalPdfOcrSession {
  dispose(): Promise<void>;
  recognizePage(
    page: PDFPageProxy,
    options: LocalOcrPageOptions,
  ): Promise<ExtractedPdfTextPage>;
}

export interface RecognizePdfPageLocallyOptions
  extends LocalOcrPageOptions,
    LocalPdfOcrSessionOptions {}

export type LocalOcrLimitCode =
  | "too-many-ocr-lines"
  | "too-many-ocr-characters"
  | "too-many-overlap-comparisons";

export class LocalOcrLimitError extends Error {
  readonly code: LocalOcrLimitCode;
  readonly maximum: number;

  constructor(code: LocalOcrLimitCode, maximum: number) {
    const subject =
      code === "too-many-ocr-lines"
        ? "text lines"
        : code === "too-many-ocr-characters"
          ? "text characters"
          : "native/OCR overlap comparisons";
    super(
      `Local OCR stopped because this page exceeds the limit of ${maximum.toLocaleString("en-US")} ${subject}.`,
    );
    this.name = "PdfSecurityLimitError";
    this.code = code;
    this.maximum = maximum;
  }
}

interface LocalOcrEngine {
  events: LocalOcrEngineEvents;
  module: LocalOcrTesseractModule;
  worker: LocalOcrWorker;
}

interface LocalOcrEngineEvents {
  cancel: ((reason: Error) => void) | null;
  progress: ProgressReporter | null;
}

interface RenderedOcrPage {
  blob: Blob;
  imageHeight: number;
  imageWidth: number;
  pageHeight: number;
  pageWidth: number;
  renderScale: number;
  rotation: PdfQuarterTurn;
}

interface CancellableRenderTask {
  cancel(): void;
  promise: PromiseLike<unknown>;
}

const DEFAULT_LANGUAGE: LocalOcrLanguage = "eng+ita";
const SUPPORTED_LANGUAGES = new Set<LocalOcrLanguage>([
  "eng",
  "ita",
  "eng+ita",
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function normalizeLanguage(value: unknown): LocalOcrLanguage {
  if (
    typeof value === "string" &&
    SUPPORTED_LANGUAGES.has(value as LocalOcrLanguage)
  ) {
    return value as LocalOcrLanguage;
  }
  throw new RangeError("Local OCR supports only eng, ita, or eng+ita.");
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(
    `Local OCR exceeded the ${timeoutMs.toLocaleString("en-US")} ms runtime limit.`,
  );
  error.name = "TimeoutError";
  return error;
}

function createEngineError(): Error {
  return new Error("The local OCR engine failed.");
}

function timeoutMilliseconds(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return PDF_SECURITY_LIMITS.maxOcrRuntimeMilliseconds;
  }
  return clamp(
    Math.floor(value as number),
    1,
    PDF_SECURITY_LIMITS.maxOcrRuntimeMilliseconds,
  );
}

function canvasDimensionsFit(
  pageWidth: number,
  pageHeight: number,
  scale: number,
): boolean {
  const width = Math.max(1, Math.ceil(pageWidth * scale));
  const height = Math.max(1, Math.ceil(pageHeight * scale));

  return (
    width <= PDF_SECURITY_LIMITS.maxOcrCanvasDimension &&
    height <= PDF_SECURITY_LIMITS.maxOcrCanvasDimension &&
    width * height <= PDF_SECURITY_LIMITS.maxOcrCanvasPixels
  );
}

/**
 * Chooses the highest scale up to the target OCR DPI while respecting both
 * canvas-axis and total-pixel budgets, including integer canvas rounding.
 */
export function calculateBoundedOcrRenderScale(
  pageWidth: number,
  pageHeight: number,
): number {
  positiveDimension(pageWidth, "OCR page width");
  positiveDimension(pageHeight, "OCR page height");

  const targetScale = PDF_SECURITY_LIMITS.ocrTargetDpi / 72;
  const dimensionScale =
    PDF_SECURITY_LIMITS.maxOcrCanvasDimension /
    Math.max(pageWidth, pageHeight);
  const pixelScale = Math.sqrt(
    PDF_SECURITY_LIMITS.maxOcrCanvasPixels /
      (pageWidth * pageHeight),
  );
  const candidate = Math.min(
    targetScale,
    dimensionScale,
    pixelScale,
  );

  if (canvasDimensionsFit(pageWidth, pageHeight, candidate)) {
    return candidate;
  }

  // `ceil` can put an otherwise exact floating-point bound one pixel over.
  // A bounded binary search avoids magic epsilon values and preserves the
  // largest safe scale for unusually shaped pages.
  let lower = 0;
  let upper = candidate;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (canvasDimensionsFit(pageWidth, pageHeight, midpoint)) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }

  if (lower <= 0 || !Number.isFinite(lower)) {
    throw new RangeError("The PDF page cannot fit within the OCR canvas limits.");
  }
  return lower;
}

function normalizeUnit(value: number, dimension: number): number {
  return clamp(value / dimension, 0, 1);
}

interface FragmentBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface FragmentGridRange {
  cellCount: number;
  endX: number;
  endY: number;
  startX: number;
  startY: number;
}

function fragmentBounds(
  fragment: ExtractedPdfTextFragment,
): FragmentBounds | null {
  const values = [
    fragment.x,
    fragment.y,
    fragment.width,
    fragment.height,
  ];
  if (!values.every(Number.isFinite)) return null;

  const left = clamp(
    Math.min(fragment.x, fragment.x + fragment.width),
    0,
    1,
  );
  const right = clamp(
    Math.max(fragment.x, fragment.x + fragment.width),
    0,
    1,
  );
  const top = clamp(
    Math.min(fragment.y, fragment.y + fragment.height),
    0,
    1,
  );
  const bottom = clamp(
    Math.max(fragment.y, fragment.y + fragment.height),
    0,
    1,
  );
  return right > left && bottom > top
    ? { bottom, left, right, top }
    : null;
}

function intersectBounds(
  first: FragmentBounds,
  second: FragmentBounds,
): FragmentBounds | null {
  const intersection = {
    bottom: Math.min(first.bottom, second.bottom),
    left: Math.max(first.left, second.left),
    right: Math.min(first.right, second.right),
    top: Math.max(first.top, second.top),
  };
  return intersection.right > intersection.left &&
    intersection.bottom > intersection.top
    ? intersection
    : null;
}

function boundsArea(bounds: FragmentBounds): number {
  return (
    (bounds.right - bounds.left) *
    (bounds.bottom - bounds.top)
  );
}

function fragmentGridRange(bounds: FragmentBounds): FragmentGridRange {
  const size = PDF_SECURITY_LIMITS.ocrOverlapGridCellsPerAxis;
  const startX = Math.min(size - 1, Math.floor(bounds.left * size));
  const startY = Math.min(size - 1, Math.floor(bounds.top * size));
  const endX = Math.min(
    size - 1,
    Math.max(startX, Math.ceil(bounds.right * size) - 1),
  );
  const endY = Math.min(
    size - 1,
    Math.max(startY, Math.ceil(bounds.bottom * size) - 1),
  );
  return {
    cellCount: (endX - startX + 1) * (endY - startY + 1),
    endX,
    endY,
    startX,
    startY,
  };
}

function unionAreaAtLeast(
  rectangles: readonly FragmentBounds[],
  targetArea: number,
  consumeBudget: (amount?: number) => void,
): boolean {
  if (rectangles.length === 0) return false;
  const events = rectangles
    .flatMap((rectangle, index) => [
      { index, start: true, x: rectangle.left },
      { index, start: false, x: rectangle.right },
    ])
    .sort(
      (first, second) =>
        first.x - second.x ||
        Number(first.start) - Number(second.start),
    );
  const active = new Set<number>();
  let area = 0;
  let previousX = events[0].x;
  let eventIndex = 0;

  while (eventIndex < events.length) {
    const x = events[eventIndex].x;
    const width = x - previousX;
    if (width > 0 && active.size > 0) {
      consumeBudget(active.size);
      const vertical = [...active]
        .map((index) => rectangles[index])
        .sort(
          (first, second) =>
            first.top - second.top ||
            first.bottom - second.bottom,
        );
      let covered = 0;
      let top = vertical[0].top;
      let bottom = vertical[0].bottom;
      for (let index = 1; index < vertical.length; index += 1) {
        const interval = vertical[index];
        if (interval.top <= bottom) {
          bottom = Math.max(bottom, interval.bottom);
        } else {
          covered += bottom - top;
          top = interval.top;
          bottom = interval.bottom;
        }
      }
      covered += bottom - top;
      area += width * covered;
      if (area >= targetArea) return true;
    }

    while (eventIndex < events.length && events[eventIndex].x === x) {
      const event = events[eventIndex];
      if (event.start) active.add(event.index);
      else active.delete(event.index);
      eventIndex += 1;
    }
    previousX = x;
  }
  return false;
}

/**
 * Mixed PDFs often contain both native text and scanned regions. Avoids
 * creating duplicate OCR hit targets over already editable native runs. The
 * spatial index and comparison budget keep worst-case work bounded, while
 * union coverage handles one OCR line split across several native runs.
 */
export function removeOcrFragmentsOverlappingNative(
  ocrFragments: readonly ExtractedPdfTextFragment[],
  nativeFragments: readonly ExtractedPdfTextFragment[],
): ExtractedPdfTextFragment[] {
  if (ocrFragments.length === 0 || nativeFragments.length === 0) {
    return [...ocrFragments];
  }

  const size = PDF_SECURITY_LIMITS.ocrOverlapGridCellsPerAxis;
  const maximumIndexedCells = size * 4;
  const nativeBounds = nativeFragments.map(fragmentBounds);
  const nativeByCell = new Map<number, number[]>();
  const broadNativeIndexes: number[] = [];
  nativeBounds.forEach((bounds, index) => {
    if (!bounds) return;
    const range = fragmentGridRange(bounds);
    if (range.cellCount > maximumIndexedCells) {
      broadNativeIndexes.push(index);
      return;
    }
    for (let y = range.startY; y <= range.endY; y += 1) {
      for (let x = range.startX; x <= range.endX; x += 1) {
        const key = y * size + x;
        const indexes = nativeByCell.get(key);
        if (indexes) indexes.push(index);
        else nativeByCell.set(key, [index]);
      }
    }
  });

  let operations = 0;
  const consumeBudget = (amount = 1) => {
    operations += amount;
    if (
      operations >
      PDF_SECURITY_LIMITS.maxOcrOverlapComparisons
    ) {
      throw new LocalOcrLimitError(
        "too-many-overlap-comparisons",
        PDF_SECURITY_LIMITS.maxOcrOverlapComparisons,
      );
    }
  };
  const visitedAt = new Uint32Array(nativeFragments.length);
  const retained: ExtractedPdfTextFragment[] = [];

  for (let ocrIndex = 0; ocrIndex < ocrFragments.length; ocrIndex += 1) {
    const ocrFragment = ocrFragments[ocrIndex];
    const ocrBounds = fragmentBounds(ocrFragment);
    if (!ocrBounds) {
      retained.push(ocrFragment);
      continue;
    }
    const marker = ocrIndex + 1;
    const intersections: FragmentBounds[] = [];
    const inspectNative = (nativeIndex: number) => {
      if (visitedAt[nativeIndex] === marker) return;
      visitedAt[nativeIndex] = marker;
      consumeBudget();
      const bounds = nativeBounds[nativeIndex];
      if (!bounds) return;
      const intersection = intersectBounds(ocrBounds, bounds);
      if (intersection) intersections.push(intersection);
    };

    for (const nativeIndex of broadNativeIndexes) {
      inspectNative(nativeIndex);
    }
    const range = fragmentGridRange(ocrBounds);
    for (let y = range.startY; y <= range.endY; y += 1) {
      for (let x = range.startX; x <= range.endX; x += 1) {
        for (const nativeIndex of nativeByCell.get(y * size + x) ?? []) {
          inspectNative(nativeIndex);
        }
      }
    }

    const duplicate = unionAreaAtLeast(
      intersections,
      boundsArea(ocrBounds) * 0.55,
      consumeBudget,
    );
    if (!duplicate) retained.push(ocrFragment);
  }
  return retained;
}

function normalizedDegrees(baseline: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}): number {
  const degrees =
    (Math.atan2(
      baseline.y1 - baseline.y0,
      baseline.x1 - baseline.x0,
    ) *
      180) /
    Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;
  return Math.abs(normalized - 360) < 1e-10 ? 0 : normalized;
}

function readBbox(value: LocalOcrBboxLike | null | undefined): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} | null {
  if (
    !value ||
    !finiteNumber(value.x0) ||
    !finiteNumber(value.y0) ||
    !finiteNumber(value.x1) ||
    !finiteNumber(value.y1)
  ) {
    return null;
  }
  if (value.x1 <= value.x0 || value.y1 <= value.y0) return null;
  return {
    x0: value.x0,
    y0: value.y0,
    x1: value.x1,
    y1: value.y1,
  };
}

function readBaseline(
  value: LocalOcrBaselineLike | null | undefined,
): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} | null {
  if (
    !value ||
    !finiteNumber(value.x0) ||
    !finiteNumber(value.y0) ||
    !finiteNumber(value.x1) ||
    !finiteNumber(value.y1)
  ) {
    return null;
  }
  return {
    x0: value.x0,
    y0: value.y0,
    x1: value.x1,
    y1: value.y1,
  };
}

function confidence(
  line: LocalOcrLineLike,
  paragraph: LocalOcrParagraphLike,
  block: LocalOcrBlockLike,
): number | undefined {
  const value = [line.confidence, paragraph.confidence, block.confidence].find(
    finiteNumber,
  );
  return value === undefined ? undefined : clamp(value, 0, 100);
}

function firstFontName(line: LocalOcrLineLike): string | null {
  if (!Array.isArray(line.words)) return null;

  for (const word of line.words) {
    if (typeof word?.font_name !== "string") continue;
    const candidate = word.font_name.trim();
    if (
      candidate &&
      !/^(?:unknown|null|undefined)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function fontStyle(fontName: string | null): {
  bold: boolean;
  italic: boolean;
} {
  const value = fontName ?? "";
  return {
    bold: /\b(?:black|bold|demi|heavy|semibold)\b/i.test(value),
    italic: /\b(?:italic|oblique|slanted)\b/i.test(value),
  };
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function stableOcrFragmentId(
  documentId: string,
  pageIndex: number,
  itemIndex: number,
  text: string,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): string {
  const signature = [
    text,
    bbox.x0.toFixed(3),
    bbox.y0.toFixed(3),
    bbox.x1.toFixed(3),
    bbox.y1.toFixed(3),
  ].join("\u001f");
  return `pdf-text-${hashString(documentId || "document")}-p${pageIndex}-ocr-i${itemIndex}-${hashString(signature)}`;
}

/**
 * Converts Tesseract's block/paragraph/line hierarchy to the same normalized
 * top-left coordinate model used by native PDF.js text extraction.
 */
export function mapTesseractBlocksToPdfTextPage(
  blocks: readonly LocalOcrBlockLike[] | null | undefined,
  options: MapLocalOcrBlocksOptions,
): ExtractedPdfTextPage {
  const pageWidth = positiveDimension(options.pageWidth, "OCR page width");
  const pageHeight = positiveDimension(options.pageHeight, "OCR page height");
  const imageWidth = positiveDimension(options.imageWidth, "OCR image width");
  const imageHeight = positiveDimension(
    options.imageHeight,
    "OCR image height",
  );
  const language = normalizeLanguage(options.language ?? DEFAULT_LANGUAGE);
  const documentId = options.documentId ?? "document";
  const sourceRotation = normalizePdfTextRotation(options.sourceRotation);
  const rotation = normalizePdfTextRotation(
    options.rotation ?? sourceRotation,
  );
  const fragments: ExtractedPdfTextFragment[] = [];
  let lineCount = 0;
  let characterCount = 0;
  let paragraphCount = 0;

  const runtimeBlocks = Array.isArray(blocks) ? blocks : [];
  if (runtimeBlocks.length > PDF_SECURITY_LIMITS.maxOcrLinesPerPage) {
    throw new LocalOcrLimitError(
      "too-many-ocr-lines",
      PDF_SECURITY_LIMITS.maxOcrLinesPerPage,
    );
  }

  for (const block of runtimeBlocks) {
    const paragraphs = Array.isArray(block?.paragraphs)
      ? block.paragraphs
      : [];
    paragraphCount += paragraphs.length;
    if (paragraphCount > PDF_SECURITY_LIMITS.maxOcrLinesPerPage) {
      throw new LocalOcrLimitError(
        "too-many-ocr-lines",
        PDF_SECURITY_LIMITS.maxOcrLinesPerPage,
      );
    }

    for (const paragraph of paragraphs) {
      const lines = Array.isArray(paragraph?.lines)
        ? paragraph.lines
        : [];

      for (const line of lines) {
        lineCount += 1;
        if (lineCount > PDF_SECURITY_LIMITS.maxOcrLinesPerPage) {
          throw new LocalOcrLimitError(
            "too-many-ocr-lines",
            PDF_SECURITY_LIMITS.maxOcrLinesPerPage,
          );
        }
        if (typeof line?.text !== "string") continue;

        characterCount += line.text.length;
        if (
          characterCount >
          PDF_SECURITY_LIMITS.maxOcrCharactersPerPage
        ) {
          throw new LocalOcrLimitError(
            "too-many-ocr-characters",
            PDF_SECURITY_LIMITS.maxOcrCharactersPerPage,
          );
        }

        const text = line.text.trim();
        if (!text) continue;
        const bbox = readBbox(line.bbox);
        if (!bbox) continue;

        const clipped = {
          x0: clamp(bbox.x0, 0, imageWidth),
          y0: clamp(bbox.y0, 0, imageHeight),
          x1: clamp(bbox.x1, 0, imageWidth),
          y1: clamp(bbox.y1, 0, imageHeight),
        };
        if (
          clipped.x1 <= clipped.x0 ||
          clipped.y1 <= clipped.y0
        ) {
          continue;
        }

        const baseline = readBaseline(line.baseline);
        const clippedBaseline = baseline
          ? {
              x0: clamp(baseline.x0, 0, imageWidth),
              y0: clamp(baseline.y0, 0, imageHeight),
              x1: clamp(baseline.x1, 0, imageWidth),
              y1: clamp(baseline.y1, 0, imageHeight),
            }
          : null;
        const reportedFont = firstFontName(line);
        const style = fontStyle(reportedFont);
        const fontName = reportedFont ?? "OCR";
        const normalizedHeight =
          (clipped.y1 - clipped.y0) / imageHeight;

        fragments.push({
          id: stableOcrFragmentId(
            documentId,
            options.pageIndex,
            lineCount - 1,
            text,
            bbox,
          ),
          pageIndex: options.pageIndex,
          itemIndex: lineCount - 1,
          origin: "ocr",
          confidence: confidence(line, paragraph, block),
          text,
          x: normalizeUnit(clipped.x0, imageWidth),
          y: normalizeUnit(clipped.y0, imageHeight),
          width: (clipped.x1 - clipped.x0) / imageWidth,
          height: normalizedHeight,
          baseline: clippedBaseline
            ? {
                start: {
                  x: normalizeUnit(clippedBaseline.x0, imageWidth),
                  y: normalizeUnit(clippedBaseline.y0, imageHeight),
                },
                end: {
                  x: normalizeUnit(clippedBaseline.x1, imageWidth),
                  y: normalizeUnit(clippedBaseline.y1, imageHeight),
                },
              }
            : null,
          quad: {
            topLeft: {
              x: normalizeUnit(clipped.x0, imageWidth),
              y: normalizeUnit(clipped.y0, imageHeight),
            },
            topRight: {
              x: normalizeUnit(clipped.x1, imageWidth),
              y: normalizeUnit(clipped.y0, imageHeight),
            },
            bottomRight: {
              x: normalizeUnit(clipped.x1, imageWidth),
              y: normalizeUnit(clipped.y1, imageHeight),
            },
            bottomLeft: {
              x: normalizeUnit(clipped.x0, imageWidth),
              y: normalizeUnit(clipped.y1, imageHeight),
            },
          },
          rotation: clippedBaseline
            ? normalizedDegrees(clippedBaseline)
            : null,
          fontName,
          fontFamily: reportedFont ?? "sans-serif",
          resolvedFontName: reportedFont ?? undefined,
          bold: style.bold,
          italic: style.italic,
          fontSize: normalizedHeight * pageHeight,
          fontSizeNormalized: normalizedHeight,
          color: null,
          direction: paragraph.is_ltr === false ? "rtl" : "ltr",
          vertical: false,
          hasEOL: true,
          hasGeometry: true,
        });
      }
    }
  }

  return {
    pageIndex: options.pageIndex,
    pageNumber: options.pageNumber ?? options.pageIndex + 1,
    width: pageWidth,
    height: pageHeight,
    sourceRotation,
    rotation,
    language,
    fragments,
  };
}

async function defaultLoadTesseract(): Promise<LocalOcrTesseractModule> {
  if (typeof window === "undefined") {
    throw new Error("Local OCR can only run in a browser.");
  }

  const imported = await import("tesseract.js");
  const candidate =
    (
      imported as unknown as {
        default?: unknown;
      }
    ).default ?? imported;

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as { createWorker?: unknown }).createWorker !==
      "function"
  ) {
    throw new Error("The local OCR engine could not be loaded.");
  }
  return candidate as LocalOcrTesseractModule;
}

const DEFAULT_RUNTIME: LocalOcrRuntime = {
  createCanvas() {
    if (typeof document === "undefined") {
      throw new Error("Local OCR can only run in a browser.");
    }
    return document.createElement("canvas");
  },
  loadTesseract: defaultLoadTesseract,
};

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The PDF page could not be prepared for local OCR."));
      }
    }, "image/png");
  });
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
}

class ProgressReporter {
  private active = true;
  private lastEmittedAt = 0;
  private lastEmittedProgress = -1;
  private lastEmittedStage: LocalOcrProgressStage | null = null;
  private lastProgress = 0;

  constructor(
    private readonly pageIndex: number,
    private readonly callback:
      | ((progress: LocalOcrProgress) => void)
      | undefined,
  ) {}

  emit(
    stage: LocalOcrProgressStage,
    progress: number,
    status: string,
  ): void {
    if (!this.active || !this.callback) return;
    const monotonic = clamp(
      Math.max(this.lastProgress, progress),
      0,
      1,
    );
    this.lastProgress = monotonic;
    const now = Date.now();
    if (
      stage === this.lastEmittedStage &&
      monotonic < 1 &&
      monotonic - this.lastEmittedProgress < 0.01 &&
      now - this.lastEmittedAt < 100
    ) {
      return;
    }
    this.lastEmittedAt = now;
    this.lastEmittedProgress = monotonic;
    this.lastEmittedStage = stage;
    try {
      this.callback({
        pageIndex: this.pageIndex,
        progress: monotonic,
        stage,
        status,
      });
    } catch {
      // Progress observers must never be able to break OCR or leak its worker.
    }
  }

  fromTesseract(message: LocalOcrLoggerMessage): void {
    const status =
      typeof message.status === "string" ? message.status : "loading OCR";
    const progress = finiteNumber(message.progress)
      ? clamp(message.progress, 0, 1)
      : 0;

    switch (status) {
      case "loading language traineddata":
        this.emit(
          "loading-language",
          0.4 + progress * 0.2,
          status,
        );
        break;
      case "recognizing text":
        this.emit("recognizing", 0.62 + progress * 0.36, status);
        break;
      case "initializing tesseract":
        this.emit(
          "loading-engine",
          0.22 + progress * 0.16,
          status,
        );
        break;
      case "initializing api":
        this.emit(
          "loading-engine",
          0.6 + progress * 0.02,
          status,
        );
        break;
      default:
        this.emit(
          "loading-engine",
          0.2 + progress * 0.02,
          status,
        );
    }
  }

  stop(): void {
    this.active = false;
  }
}

async function waitForQueueTurn(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) {
    await previous;
    return;
  }
  throwIfAborted(signal, "Local OCR was aborted.");

  let rejectAbort: ((reason: Error) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () =>
    rejectAbort?.(createAbortError("Local OCR was aborted."));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([previous, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    rejectAbort = null;
  }
}

class LocalPdfOcrSessionImpl implements LocalPdfOcrSession {
  private activeCancel: ((reason: Error) => void) | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private engine: LocalOcrEngine | null = null;
  private engineAttemptGeneration = 0;
  private engineBootstrapController: AbortController | null = null;
  private enginePromise: Promise<LocalOcrEngine> | null = null;
  private encodingDrain: Promise<void> = Promise.resolve();
  private queue: Promise<void> = Promise.resolve();
  private readonly terminatedWorkers = new WeakSet<object>();
  private readonly language: LocalOcrLanguage;
  private readonly runtime: LocalOcrRuntime;

  constructor(options: LocalPdfOcrSessionOptions) {
    this.language = normalizeLanguage(
      options.language ?? DEFAULT_LANGUAGE,
    );
    this.runtime = {
      ...DEFAULT_RUNTIME,
      ...options.runtime,
    };
  }

  recognizePage(
    page: PDFPageProxy,
    options: LocalOcrPageOptions,
  ): Promise<ExtractedPdfTextPage> {
    if (this.disposed) {
      return Promise.reject(
        createAbortError("The local OCR session was disposed."),
      );
    }

    const previous = this.queue;
    const operation = waitForQueueTurn(previous, options.signal)
      .then(() =>
        waitForQueueTurn(this.encodingDrain, options.signal),
      )
      .then(() => this.runPage(page, options));
    this.queue = previous
      .then(() => operation)
      .then(
        () => undefined,
        () => undefined,
      );
    return operation;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    this.activeCancel?.(
      createAbortError("The local OCR session was disposed."),
    );
    await this.queue;
    await this.encodingDrain;

    const engine = this.engine;
    const pending = this.enginePromise;
    this.engine = null;
    this.enginePromise = null;
    if (engine) {
      this.deactivateEngine(engine);
      await this.terminateWorkerOnce(engine.worker);
    } else if (pending) {
      void pending
        .then((value) => {
          this.deactivateEngine(value);
          return this.terminateWorkerOnce(value.worker);
        })
        .catch(() => undefined);
    }
  }

  private abortEngineBootstrap(): void {
    this.engineAttemptGeneration += 1;
    const controller = this.engineBootstrapController;
    this.engineBootstrapController = null;
    controller?.abort();
  }

  private bindEngineEvents(
    engine: LocalOcrEngine,
    cancel: (reason: Error) => void,
    progress: ProgressReporter,
  ): LocalOcrEngine {
    engine.events.cancel = cancel;
    engine.events.progress = progress;
    return engine;
  }

  private deactivateEngine(engine: LocalOcrEngine): void {
    engine.events.cancel = null;
    engine.events.progress = null;
  }

  private getEngine(
    cancel: (reason: Error) => void,
    progress: ProgressReporter,
  ): Promise<LocalOcrEngine> {
    if (this.engine) {
      return Promise.resolve(
        this.bindEngineEvents(this.engine, cancel, progress),
      );
    }
    if (this.enginePromise) {
      return this.enginePromise.then((engine) =>
        this.bindEngineEvents(engine, cancel, progress),
      );
    }

    const events: LocalOcrEngineEvents = { cancel, progress };
    const generation = this.engineAttemptGeneration + 1;
    this.engineAttemptGeneration = generation;
    const bootstrapController = new AbortController();
    this.engineBootstrapController = bootstrapController;
    const promise = this.runtime
      .loadTesseract()
      .then(async (module) => {
        throwIfAborted(
          bootstrapController.signal,
          "The local OCR engine bootstrap was aborted.",
        );
        const worker = await module.createWorker(
          this.language,
          module.OEM.LSTM_ONLY,
          {
            cacheMethod: "write",
            cachePath: LOCAL_OCR_MODEL_CACHE_PATH,
            corePath: LOCAL_OCR_ASSET_PATHS.core,
            errorHandler: () =>
              this.engineAttemptGeneration === generation &&
              !bootstrapController.signal.aborted
                ? events.cancel?.(createEngineError())
                : undefined,
            // Vinext, Cloudflare and other static hosts do not consistently
            // expose double-extension `.traineddata.gz` files. The pinned
            // models are shipped verbatim and Tesseract must not append `.gz`.
            gzip: false,
            langPath: LOCAL_OCR_ASSET_PATHS.languages,
            logger: (message) =>
              this.engineAttemptGeneration === generation &&
              !bootstrapController.signal.aborted
                ? events.progress?.fromTesseract(message)
                : undefined,
            workerAbortSignal: bootstrapController.signal,
            workerBlobURL: false,
            workerPath: LOCAL_OCR_ASSET_PATHS.worker,
          },
        );
        return { events, module, worker };
      });
    this.enginePromise = promise;
    void promise.then(
      (engine) => {
        if (this.engineBootstrapController === bootstrapController) {
          this.engineBootstrapController = null;
        }
        if (this.enginePromise !== promise || this.disposed) {
          this.deactivateEngine(engine);
          void this.terminateWorkerOnce(engine.worker);
          return;
        }
        this.engine = engine;
      },
      () => {
        if (this.engineBootstrapController === bootstrapController) {
          this.engineBootstrapController = null;
        }
        if (this.enginePromise === promise) this.enginePromise = null;
      },
    );
    return promise;
  }

  private discardEngine(pending: Promise<LocalOcrEngine>): void {
    if (this.engine) {
      const engine = this.engine;
      this.engine = null;
      this.enginePromise = null;
      this.deactivateEngine(engine);
      void this.terminateWorkerOnce(engine.worker);
      return;
    }
    if (this.enginePromise === pending) {
      this.abortEngineBootstrap();
      this.enginePromise = null;
      this.engine = null;
    }
    void pending
      .then((engine) => {
        if (this.engine === engine) {
          this.engine = null;
          this.enginePromise = null;
        }
        this.deactivateEngine(engine);
        return this.terminateWorkerOnce(engine.worker);
      })
      .catch(() => undefined);
  }

  private async terminateWorkerOnce(worker: LocalOcrWorker): Promise<void> {
    if (
      typeof worker !== "object" ||
      worker === null ||
      this.terminatedWorkers.has(worker)
    ) {
      return;
    }
    this.terminatedWorkers.add(worker);
    try {
      await worker.terminate();
    } catch {
      // Cleanup is best-effort and must not mask the OCR result or error.
    }
  }

  private async renderPage(
    page: PDFPageProxy,
    rotation: PdfQuarterTurn,
    reporter: ProgressReporter,
    raceCancellation: <Value>(promise: PromiseLike<Value>) => Promise<Value>,
    setRenderTask: (task: CancellableRenderTask | null) => void,
  ): Promise<RenderedOcrPage> {
    reporter.emit("rendering", 0, "rendering PDF page");
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const pageWidth = positiveDimension(
      baseViewport.width,
      "OCR page width",
    );
    const pageHeight = positiveDimension(
      baseViewport.height,
      "OCR page height",
    );
    const renderScale = calculateBoundedOcrRenderScale(
      pageWidth,
      pageHeight,
    );
    const viewport = page.getViewport({
      scale: renderScale,
      rotation,
    });
    const imageWidth = Math.max(1, Math.ceil(viewport.width));
    const imageHeight = Math.max(1, Math.ceil(viewport.height));
    if (
      imageWidth > PDF_SECURITY_LIMITS.maxOcrCanvasDimension ||
      imageHeight > PDF_SECURITY_LIMITS.maxOcrCanvasDimension ||
      imageWidth * imageHeight >
        PDF_SECURITY_LIMITS.maxOcrCanvasPixels
    ) {
      throw new RangeError("The PDF page exceeds the OCR canvas limits.");
    }

    const canvas = this.runtime.createCanvas();
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    if (!canvas.getContext("2d", { alpha: false })) {
      clearCanvas(canvas);
      throw new Error("A 2D canvas is required for local OCR.");
    }

    try {
      const renderTask = page.render({
        background: "#ffffff",
        canvas,
        viewport,
      }) as CancellableRenderTask;
      setRenderTask(renderTask);
      await raceCancellation(renderTask.promise);
      setRenderTask(null);
      reporter.emit("rendering", 0.2, "PDF page rendered");
      const encoding = canvasToPngBlob(canvas);
      this.encodingDrain = encoding.then(
        () => undefined,
        () => undefined,
      );
      const blob = await raceCancellation(encoding);
      return {
        blob,
        imageHeight,
        imageWidth,
        pageHeight,
        pageWidth,
        renderScale,
        rotation,
      };
    } finally {
      setRenderTask(null);
      clearCanvas(canvas);
    }
  }

  private async runPage(
    page: PDFPageProxy,
    options: LocalOcrPageOptions,
  ): Promise<ExtractedPdfTextPage> {
    if (this.disposed) {
      throw createAbortError("The local OCR session was disposed.");
    }
    throwIfAborted(options.signal, "Local OCR was aborted.");

    const timeoutMs = timeoutMilliseconds(options.timeoutMs);
    const reporter = new ProgressReporter(
      options.pageIndex,
      options.onProgress,
    );
    let cancellationError: Error | null = null;
    let rejectCancellation: ((reason: Error) => void) | null = null;
    let renderTask: CancellableRenderTask | null = null;
    let operationEngine: Promise<LocalOcrEngine> | null = null;
    const recognitionController = new AbortController();
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancel = (reason: Error) => {
      if (cancellationError) return;
      cancellationError = reason;
      try {
        renderTask?.cancel();
      } catch {
        // PDF.js render cancellation is best-effort.
      }
      recognitionController.abort();
      if (operationEngine) this.discardEngine(operationEngine);
      rejectCancellation?.(reason);
    };
    this.activeCancel = cancel;
    const onAbort = () =>
      cancel(createAbortError("Local OCR was aborted."));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => cancel(createTimeoutError(timeoutMs)),
      timeoutMs,
    );
    const raceCancellation = <Value>(
      promise: PromiseLike<Value>,
    ): Promise<Value> =>
      Promise.race([Promise.resolve(promise), cancellation]);

    try {
      const sourceRotation = normalizePdfTextRotation(
        options.sourceRotation ?? page.rotate,
      );
      const rotation = normalizePdfTextRotation(
        options.rotation ?? sourceRotation,
      );
      const rendered = await this.renderPage(
        page,
        rotation,
        reporter,
        raceCancellation,
        (task) => {
          renderTask = task;
        },
      );

      reporter.emit("loading-engine", 0.2, "loading local OCR engine");
      operationEngine = this.getEngine(cancel, reporter);
      const engine = await raceCancellation(operationEngine);
      if (cancellationError) throw cancellationError;

      reporter.emit("recognizing", 0.62, "recognizing text");
      const result = await raceCancellation(
        engine.worker.recognize(
          rendered.blob,
          {
            preserve_interword_spaces: "1",
            tessedit_pageseg_mode: engine.module.PSM.AUTO,
            user_defined_dpi: String(
              Math.max(1, Math.round(rendered.renderScale * 72)),
            ),
          },
          {
            blocks: true,
            text: false,
          },
          undefined,
          recognitionController.signal,
        ),
      );
      if (cancellationError) throw cancellationError;

      const mapped = mapTesseractBlocksToPdfTextPage(
        result.data?.blocks,
        {
          documentId: options.documentId,
          imageHeight: rendered.imageHeight,
          imageWidth: rendered.imageWidth,
          language: this.language,
          pageHeight: rendered.pageHeight,
          pageIndex: options.pageIndex,
          pageNumber: options.pageNumber,
          pageWidth: rendered.pageWidth,
          rotation: rendered.rotation,
          sourceRotation,
        },
      );
      reporter.emit("complete", 1, "local OCR complete");
      return mapped;
    } catch (error) {
      if (operationEngine && !cancellationError) {
        this.discardEngine(operationEngine);
      }
      if (cancellationError) throw cancellationError;
      throw error;
    } finally {
      clearTimeout(timer);
      recognitionController.abort();
      options.signal?.removeEventListener("abort", onAbort);
      reporter.stop();
      renderTask = null;
      rejectCancellation = null;
      if (this.activeCancel === cancel) this.activeCancel = null;
      if (operationEngine) {
        void operationEngine
          .then((engine) => {
            if (engine.events.cancel === cancel) {
              this.deactivateEngine(engine);
            }
          })
          .catch(() => undefined);
      }
    }
  }
}

export function createLocalPdfOcrSession(
  options: LocalPdfOcrSessionOptions = {},
): LocalPdfOcrSession {
  return new LocalPdfOcrSessionImpl(options);
}

/**
 * One-page convenience wrapper. Call `createLocalPdfOcrSession` directly when
 * processing multiple pages so the same worker can be reused serially.
 */
export async function recognizePdfPageLocally(
  page: PDFPageProxy,
  options: RecognizePdfPageLocallyOptions,
): Promise<ExtractedPdfTextPage> {
  const session = createLocalPdfOcrSession({
    language: options.language,
    runtime: options.runtime,
  });
  try {
    return await session.recognizePage(page, options);
  } finally {
    await session.dispose();
  }
}
