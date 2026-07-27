import { createAbortError } from "./abort";

export const PDF_SECURITY_LIMITS = Object.freeze({
  maxFiles: 20,
  maxBytesPerFile: 100 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
  maxPages: 500,
  maxImageBytes: 20 * 1024 * 1024,
  maxImageHeaderBytes: 1024 * 1024,
  maxImageDimension: 12_000,
  maxImagePixels: 40_000_000,
  maxPdfCanvasAreaInBytes: 40_000_000 * 4,
  maxTextItemsPerPage: 10_000,
  maxTextCharactersPerPage: 500_000,
  maxTextItemsPerDocument: 200_000,
  maxTextCharactersPerDocument: 10_000_000,
  maxOcrCanvasDimension: 4_096,
  maxOcrCanvasPixels: 12_000_000,
  maxOcrLinesPerPage: 5_000,
  maxOcrCharactersPerPage: 250_000,
  maxOcrOverlapComparisons: 1_000_000,
  ocrOverlapGridCellsPerAxis: 64,
  maxOcrRuntimeMilliseconds: 120_000,
  ocrTargetDpi: 300,
  maxEditorRasterCanvasDimension: 4_096,
  maxEditorRasterCanvasPixels: 16_000_000,
  maxEditorRasterPages: 100,
  maxEditorRasterCanvasPixelsTotal: 80_000_000,
  maxEditorRasterEncodedBytesTotal: 128 * 1024 * 1024,
  editorRasterTargetScale: 3,
  maxEditorElements: 2_000,
  maxEditorElementsPerPage: 500,
  maxEditorTextCharactersPerElement: 100_000,
  maxEditorTextCharactersTotal: 1_000_000,
  maxEditorFontRunsPerElement: 2_048,
  maxEditorPathPointsPerElement: 4_096,
  maxEditorPathPointsTotal: 100_000,
  maxEditorImageElements: 100,
  maxEditorImageDataUrlCharacters: 64 * 1024 * 1024,
  maxEditorImagePixelsTotal: 80_000_000,
  maxSignatureNameCharacters: 500,
  maxFilenameCharacters: 255,
  maxPageRangeCharacters: 2_000,
  maxPdfObjectGraphDepth: 256,
  maxPdfObjectGraphNodes: 100_000,
  pageMetadataConcurrency: 4,
  thumbnailRenderConcurrency: 2,
});

export interface LocalFileDescriptor {
  name: string;
  size: number;
  type?: string;
}

export interface TextContentBudget {
  itemCount: number;
  characterCount: number;
}

export interface EditorRasterBudget {
  pageCount: number;
  canvasPixelCount: number;
  encodedByteCount: number;
}

export interface EditorResourceElement {
  pageId: string;
  type: string;
  text?: string;
  dataUrl?: string;
  pixelCount?: number;
  points?: readonly unknown[];
}

export interface ImageHeaderInfo {
  kind: "jpeg" | "png";
  width: number;
  height: number;
}

export type PdfSecurityLimitIssue =
  | {
      code: "empty-file";
      fileName: string;
    }
  | {
      code: "file-too-large" | "image-too-large";
      fileName: string;
      maxBytes: number;
    }
  | {
      code: "too-many-files";
      maxFiles: number;
    }
  | {
      code: "total-too-large";
      maxBytes: number;
    }
  | {
      code: "too-many-pages";
      maxPages: number;
    }
  | {
      code: "invalid-image-dimensions";
      fileName: string;
    }
  | {
      code: "image-dimensions-too-large";
      fileName: string;
      maxDimension: number;
      maxPixels: number;
    }
  | {
      code: "too-many-text-items" | "too-many-text-characters";
      scope: "page" | "document";
      maximum: number;
    }
  | {
      code: "too-many-editor-elements";
      scope: "page" | "document";
      maximum: number;
    }
  | {
      code: "too-many-editor-text-characters";
      scope: "element" | "document";
      maximum: number;
    }
  | {
      code: "too-many-editor-path-points";
      scope: "stroke" | "document";
      maximum: number;
    }
  | {
      code:
        | "too-many-editor-images"
        | "editor-image-data-too-large"
        | "editor-image-pixels-too-large"
        | "too-many-editor-raster-pages"
        | "editor-raster-pixels-too-large"
        | "editor-raster-bytes-too-large"
        | "pdf-object-graph-too-deep"
        | "pdf-object-graph-too-large";
      maximum: number;
    }
  | {
      code: "text-field-too-long";
      fieldName: string;
      maximum: number;
    };

function isImageFile(file: LocalFileDescriptor): boolean {
  const mime = file.type?.trim().toLowerCase() ?? "";
  const name = file.name.trim().toLowerCase();
  return (
    mime.startsWith("image/") ||
    /\.(?:jpe?g|png|webp|tiff?)$/i.test(name)
  );
}

export function formatLimitBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function getFileLimitIssue(
  file: LocalFileDescriptor,
): PdfSecurityLimitIssue | null {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { code: "empty-file", fileName: file.name };
  }

  const image = isImageFile(file);
  const maxBytes = image
    ? PDF_SECURITY_LIMITS.maxImageBytes
    : PDF_SECURITY_LIMITS.maxBytesPerFile;

  if (file.size > maxBytes) {
    return {
      code: image ? "image-too-large" : "file-too-large",
      fileName: file.name,
      maxBytes,
    };
  }

  return null;
}

export function getFileSelectionLimitIssue(
  files: readonly LocalFileDescriptor[],
  maxFiles: number = PDF_SECURITY_LIMITS.maxFiles,
): PdfSecurityLimitIssue | null {
  if (files.length > maxFiles) {
    return { code: "too-many-files", maxFiles };
  }

  for (const file of files) {
    const issue = getFileLimitIssue(file);
    if (issue) return issue;
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes > PDF_SECURITY_LIMITS.maxTotalBytes
  ) {
    return {
      code: "total-too-large",
      maxBytes: PDF_SECURITY_LIMITS.maxTotalBytes,
    };
  }

  return null;
}

export function getPageCountLimitIssue(
  pageCount: number,
): PdfSecurityLimitIssue | null {
  if (
    Number.isSafeInteger(pageCount) &&
    pageCount > PDF_SECURITY_LIMITS.maxPages
  ) {
    return {
      code: "too-many-pages",
      maxPages: PDF_SECURITY_LIMITS.maxPages,
    };
  }
  return null;
}

export function getImageDimensionLimitIssue(
  fileName: string,
  width: number,
  height: number,
): PdfSecurityLimitIssue | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { code: "invalid-image-dimensions", fileName };
  }

  const pixels = width * height;
  if (
    width > PDF_SECURITY_LIMITS.maxImageDimension ||
    height > PDF_SECURITY_LIMITS.maxImageDimension ||
    !Number.isSafeInteger(pixels) ||
    pixels > PDF_SECURITY_LIMITS.maxImagePixels
  ) {
    return {
      code: "image-dimensions-too-large",
      fileName,
      maxDimension: PDF_SECURITY_LIMITS.maxImageDimension,
      maxPixels: PDF_SECURITY_LIMITS.maxImagePixels,
    };
  }

  return null;
}

export function getImageInfoFromBytes(
  bytes: Uint8Array,
): ImageHeaderInfo | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    return {
      kind: "png",
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  }

  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  ) {
    return null;
  }

  const startOfFrameMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ]);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)
    ) {
      continue;
    }
    if (offset + 1 >= bytes.length) break;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        kind: "jpeg",
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }

    offset += segmentLength;
  }

  return null;
}

export function getImageDimensionsFromBytes(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const info = getImageInfoFromBytes(bytes);
  return info ? { width: info.width, height: info.height } : null;
}

export function getTextContentLimitIssue(
  itemCount: number,
  characterCount: number,
  scope: "page" | "document" = "page",
): PdfSecurityLimitIssue | null {
  const maximumItems =
    scope === "page"
      ? PDF_SECURITY_LIMITS.maxTextItemsPerPage
      : PDF_SECURITY_LIMITS.maxTextItemsPerDocument;
  const maximumCharacters =
    scope === "page"
      ? PDF_SECURITY_LIMITS.maxTextCharactersPerPage
      : PDF_SECURITY_LIMITS.maxTextCharactersPerDocument;

  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < 0 ||
    itemCount > maximumItems
  ) {
    return {
      code: "too-many-text-items",
      scope,
      maximum: maximumItems,
    };
  }
  if (
    !Number.isSafeInteger(characterCount) ||
    characterCount < 0 ||
    characterCount > maximumCharacters
  ) {
    return {
      code: "too-many-text-characters",
      scope,
      maximum: maximumCharacters,
    };
  }
  return null;
}

export function getTextContentBudget(
  texts: Iterable<string>,
): TextContentBudget {
  let itemCount = 0;
  let characterCount = 0;
  for (const text of texts) {
    itemCount += 1;
    characterCount += text.length;
  }
  return { itemCount, characterCount };
}

export function getReplacementTextContentLimitIssue(
  currentBudgets: Readonly<Record<string, TextContentBudget>>,
  replacedKeys: readonly string[],
  replacement: TextContentBudget,
): PdfSecurityLimitIssue | null {
  const ignoredKeys = new Set(replacedKeys);
  let itemCount = replacement.itemCount;
  let characterCount = replacement.characterCount;

  for (const [key, budget] of Object.entries(currentBudgets)) {
    if (ignoredKeys.has(key)) continue;
    itemCount += budget.itemCount;
    characterCount += budget.characterCount;
  }

  return getTextContentLimitIssue(
    itemCount,
    characterCount,
    "document",
  );
}

export function getEditorPathPointCount(
  elements: readonly EditorResourceElement[],
): number {
  let pointCount = 0;
  for (const element of elements) {
    if (
      (element.type === "draw" || element.type === "signature") &&
      Array.isArray(element.points)
    ) {
      pointCount += element.points.length;
    }
  }
  return pointCount;
}

export function getEditorSnapshotLimitIssue(
  elements: readonly EditorResourceElement[],
): PdfSecurityLimitIssue | null {
  if (elements.length > PDF_SECURITY_LIMITS.maxEditorElements) {
    return {
      code: "too-many-editor-elements",
      scope: "document",
      maximum: PDF_SECURITY_LIMITS.maxEditorElements,
    };
  }

  const pageElementCounts = new Map<string, number>();
  const uniqueImages = new Map<string, number>();
  let textCharacters = 0;
  let pathPoints = 0;
  let imageElements = 0;

  for (const element of elements) {
    const pageElementCount =
      (pageElementCounts.get(element.pageId) ?? 0) + 1;
    if (
      pageElementCount >
      PDF_SECURITY_LIMITS.maxEditorElementsPerPage
    ) {
      return {
        code: "too-many-editor-elements",
        scope: "page",
        maximum: PDF_SECURITY_LIMITS.maxEditorElementsPerPage,
      };
    }
    pageElementCounts.set(element.pageId, pageElementCount);

    if (element.type === "text") {
      const characterCount =
        typeof element.text === "string" ? element.text.length : 0;
      if (
        characterCount >
        PDF_SECURITY_LIMITS.maxEditorTextCharactersPerElement
      ) {
        return {
          code: "too-many-editor-text-characters",
          scope: "element",
          maximum:
            PDF_SECURITY_LIMITS.maxEditorTextCharactersPerElement,
        };
      }
      textCharacters += characterCount;
    }

    if (
      element.type === "draw" ||
      element.type === "signature"
    ) {
      const pointCount = Array.isArray(element.points)
        ? element.points.length
        : 0;
      if (
        pointCount >
        PDF_SECURITY_LIMITS.maxEditorPathPointsPerElement
      ) {
        return {
          code: "too-many-editor-path-points",
          scope: "stroke",
          maximum: PDF_SECURITY_LIMITS.maxEditorPathPointsPerElement,
        };
      }
      pathPoints += pointCount;
    }

    if (element.type === "image") {
      imageElements += 1;
      const dataUrl =
        typeof element.dataUrl === "string" ? element.dataUrl : "";
      if (!uniqueImages.has(dataUrl)) {
        const pixelCount =
          Number.isSafeInteger(element.pixelCount) &&
          (element.pixelCount ?? 0) > 0
            ? (element.pixelCount as number)
            : PDF_SECURITY_LIMITS.maxEditorImagePixelsTotal + 1;
        uniqueImages.set(dataUrl, pixelCount);
      }
    }
  }

  if (
    textCharacters >
    PDF_SECURITY_LIMITS.maxEditorTextCharactersTotal
  ) {
    return {
      code: "too-many-editor-text-characters",
      scope: "document",
      maximum: PDF_SECURITY_LIMITS.maxEditorTextCharactersTotal,
    };
  }
  if (pathPoints > PDF_SECURITY_LIMITS.maxEditorPathPointsTotal) {
    return {
      code: "too-many-editor-path-points",
      scope: "document",
      maximum: PDF_SECURITY_LIMITS.maxEditorPathPointsTotal,
    };
  }
  if (imageElements > PDF_SECURITY_LIMITS.maxEditorImageElements) {
    return {
      code: "too-many-editor-images",
      maximum: PDF_SECURITY_LIMITS.maxEditorImageElements,
    };
  }

  let imageDataUrlCharacters = 0;
  let imagePixels = 0;
  for (const [dataUrl, pixelCount] of uniqueImages) {
    imageDataUrlCharacters += dataUrl.length;
    imagePixels += pixelCount;
  }
  if (
    imageDataUrlCharacters >
    PDF_SECURITY_LIMITS.maxEditorImageDataUrlCharacters
  ) {
    return {
      code: "editor-image-data-too-large",
      maximum:
        PDF_SECURITY_LIMITS.maxEditorImageDataUrlCharacters,
    };
  }
  if (
    !Number.isSafeInteger(imagePixels) ||
    imagePixels > PDF_SECURITY_LIMITS.maxEditorImagePixelsTotal
  ) {
    return {
      code: "editor-image-pixels-too-large",
      maximum: PDF_SECURITY_LIMITS.maxEditorImagePixelsTotal,
    };
  }

  return null;
}

export function getEditorRasterBudgetLimitIssue(
  budget: Readonly<EditorRasterBudget>,
): PdfSecurityLimitIssue | null {
  if (
    !Number.isSafeInteger(budget.pageCount) ||
    budget.pageCount < 0 ||
    budget.pageCount > PDF_SECURITY_LIMITS.maxEditorRasterPages
  ) {
    return {
      code: "too-many-editor-raster-pages",
      maximum: PDF_SECURITY_LIMITS.maxEditorRasterPages,
    };
  }
  if (
    !Number.isSafeInteger(budget.canvasPixelCount) ||
    budget.canvasPixelCount < 0 ||
    budget.canvasPixelCount >
      PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixelsTotal
  ) {
    return {
      code: "editor-raster-pixels-too-large",
      maximum:
        PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixelsTotal,
    };
  }
  if (
    !Number.isSafeInteger(budget.encodedByteCount) ||
    budget.encodedByteCount < 0 ||
    budget.encodedByteCount >
      PDF_SECURITY_LIMITS.maxEditorRasterEncodedBytesTotal
  ) {
    return {
      code: "editor-raster-bytes-too-large",
      maximum:
        PDF_SECURITY_LIMITS.maxEditorRasterEncodedBytesTotal,
    };
  }
  return null;
}

export function getTextFieldLimitIssue(
  fieldName: string,
  value: string,
  maximum: number,
): PdfSecurityLimitIssue | null {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    value.length > maximum
  ) {
    return {
      code: "text-field-too-long",
      fieldName,
      maximum: Math.max(0, maximum),
    };
  }
  return null;
}

export function decimateSequence<Result>(
  values: readonly Result[],
  maximum: number,
): Result[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError("Maximum must be a positive integer.");
  }
  if (values.length <= maximum) return [...values];
  if (maximum === 1) return [values[values.length - 1]];

  const result = [values[0]];
  const interval = (values.length - 1) / (maximum - 1);
  for (let index = 1; index < maximum - 1; index += 1) {
    result.push(values[Math.floor(index * interval)]);
  }
  result.push(values[values.length - 1]);
  return result;
}

export function shouldRenderObservedArea(
  entries: readonly { isIntersecting: boolean }[],
): boolean {
  return entries.some((entry) => entry.isIntersecting);
}

export function describePdfSecurityLimitIssue(
  issue: PdfSecurityLimitIssue,
): string {
  switch (issue.code) {
    case "empty-file":
      return `${issue.fileName} is empty. Choose a valid file.`;
    case "file-too-large":
      return `${issue.fileName} exceeds the ${formatLimitBytes(issue.maxBytes)} per-file limit.`;
    case "image-too-large":
      return `${issue.fileName} exceeds the ${formatLimitBytes(issue.maxBytes)} image limit.`;
    case "too-many-files":
      return `You can process at most ${issue.maxFiles} files at once.`;
    case "total-too-large":
      return `The selection exceeds the ${formatLimitBytes(issue.maxBytes)} total limit.`;
    case "too-many-pages":
      return `This PDF exceeds the ${issue.maxPages}-page limit. Split it into smaller documents.`;
    case "invalid-image-dimensions":
      return `The dimensions of ${issue.fileName} could not be verified.`;
    case "image-dimensions-too-large": {
      const megapixels = Math.round(issue.maxPixels / 1_000_000);
      return `${issue.fileName} exceeds ${issue.maxDimension} px per side or ${megapixels} megapixels. Resize it and try again.`;
    }
    case "too-many-text-items":
      return `The ${issue.scope} exceeds the ${issue.maximum.toLocaleString("en-US")} text-item limit. Split or simplify the PDF and try again.`;
    case "too-many-text-characters":
      return `The ${issue.scope} exceeds the ${issue.maximum.toLocaleString("en-US")} extractable-character limit. Split or simplify the PDF and try again.`;
    case "too-many-editor-elements":
      return `The ${issue.scope} exceeds the ${issue.maximum.toLocaleString("en-US")} editable-element limit.`;
    case "too-many-editor-text-characters":
      return `The ${issue.scope === "element" ? "element" : "document"} text exceeds the ${issue.maximum.toLocaleString("en-US")}-character limit.`;
    case "too-many-editor-path-points":
      return `The ${issue.scope} exceeds the ${issue.maximum.toLocaleString("en-US")} drawing-point limit.`;
    case "too-many-editor-images":
      return `The document exceeds the ${issue.maximum}-image-element limit.`;
    case "editor-image-data-too-large":
      return `Editor images exceed the ${formatLimitBytes(issue.maximum)} local data budget.`;
    case "editor-image-pixels-too-large":
      return `Editor images exceed the combined ${Math.round(issue.maximum / 1_000_000)}-megapixel budget.`;
    case "too-many-editor-raster-pages":
      return `The export needs to flatten more than ${issue.maximum} pages. Split the document and try again.`;
    case "editor-raster-pixels-too-large":
      return `Flattened pages exceed the combined ${Math.round(issue.maximum / 1_000_000)}-megapixel export budget. Split the document and try again.`;
    case "editor-raster-bytes-too-large":
      return `Flattened pages exceed the ${formatLimitBytes(issue.maximum)} encoded-image export budget. Split the document and try again.`;
    case "text-field-too-long":
      return `${issue.fieldName} exceeds the ${issue.maximum.toLocaleString("en-US")}-character limit.`;
    case "pdf-object-graph-too-deep":
      return `The PDF object graph exceeds the ${issue.maximum}-level safety limit.`;
    case "pdf-object-graph-too-large":
      return `The PDF object graph exceeds the ${issue.maximum.toLocaleString("en-US")}-object safety limit.`;
  }
}

export async function mapWithConcurrency<T, Result>(
  items: readonly T[],
  concurrency: number,
  mapper: (
    item: T,
    index: number,
    signal?: AbortSignal,
  ) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }
  if (signal?.aborted) throw createAbortError();
  if (items.length === 0) return [];

  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  let stopped = false;
  const failures: unknown[] = [];

  const worker = async () => {
    while (!stopped) {
      try {
        if (signal?.aborted) throw createAbortError();
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index, signal);
      } catch (error) {
        stopped = true;
        if (failures.length === 0) failures.push(error);
        return;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  if (failures.length > 0) throw failures[0];
  if (signal?.aborted) throw createAbortError();
  return results;
}

interface QueuedTask {
  start: () => void;
  cancel: () => void;
}

export function createTaskLimiter(concurrency: number) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }

  let activeTasks = 0;
  const queue: QueuedTask[] = [];

  const drain = () => {
    while (activeTasks < concurrency && queue.length > 0) {
      queue.shift()?.start();
    }
  };

  return function runLimited<Result>(
    task: (signal?: AbortSignal) => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      let started = false;
      let settled = false;

      const finish = () => {
        if (!started) return;
        activeTasks = Math.max(0, activeTasks - 1);
        drain();
      };

      const entry: QueuedTask = {
        start: () => {
          if (settled) return;
          if (signal?.aborted) {
            entry.cancel();
            return;
          }
          started = true;
          activeTasks += 1;
          signal?.removeEventListener("abort", entry.cancel);
          Promise.resolve()
            .then(() => task(signal))
            .then(
              (value) => {
                settled = true;
                resolve(value);
              },
              (error: unknown) => {
                settled = true;
                reject(error);
              },
            )
            .finally(finish);
        },
        cancel: () => {
          if (started || settled) return;
          settled = true;
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          signal?.removeEventListener("abort", entry.cancel);
          reject(createAbortError());
          drain();
        },
      };

      if (signal?.aborted) {
        entry.cancel();
        return;
      }

      signal?.addEventListener("abort", entry.cancel, { once: true });
      queue.push(entry);
      drain();
    });
  };
}
