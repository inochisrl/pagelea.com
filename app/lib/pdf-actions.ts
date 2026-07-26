import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  PDFRef,
  PDFStream,
  type PDFPage,
} from "pdf-lib";

import { isPublicToolSlug } from "../../shared/public-tools";
import {
  describePdfSecurityLimitIssue,
  getFileLimitIssue,
  getFileSelectionLimitIssue,
  getImageDimensionLimitIssue,
  getImageDimensionsFromBytes,
  getPageCountLimitIssue,
  PDF_SECURITY_LIMITS,
  type PdfSecurityLimitIssue,
} from "./pdf-security-limits";
import { createStoredZip } from "./zip";

const PDF_MIME_TYPE = "application/pdf" as const;
const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];
const LEGAL: [number, number] = [612, 1008];

export type PageSelection = string | number | readonly number[];

/**
 * Options supported by the published local-processing tools.
 *
 * Page numbers in `pages`, `pageRange`, `range`, and `ranges` are one-based.
 * `pageIndices` and `fileOrder` are zero-based.
 */
export interface PdfToolOptions {
  pages?: string;
  pageRange?: string;
  ranges?: string;
  pagesByFile?:
    | readonly (PageSelection | undefined)[]
    | Record<number, PageSelection | undefined>;
  fileOrder?: readonly number[];
  reverseFiles?: boolean;
  aggressive?: boolean;
  keepSmallest?: boolean;
  removeMetadata?: boolean;
  pageSize?:
    | "auto"
    | "fit"
    | "a4"
    | "letter"
    | "legal"
    | readonly [number, number];
  orientation?: "auto" | "portrait" | "landscape";
  imageFit?: "contain" | "cover" | "stretch";
  imageDpi?: number;
  margin?: number;
}

export type PdfProgressCallback = (progress: number, stage?: string) => void;

export interface PdfToolResult {
  blob: Blob;
  filename: string;
  mimeType: typeof PDF_MIME_TYPE | "application/zip";
  message?: string;
}

export class PdfToolError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "PdfToolError";
    this.code = code;
    this.cause = cause;
  }
}

interface InternalPdfResult {
  bytes: Uint8Array;
  filename: string;
  mimeType?: typeof PDF_MIME_TYPE | "application/zip";
  message?: string;
}

type ProgressReporter = (progress: number, stage?: string) => void;
type SourceKind = "pdf" | "jpg" | "png" | "unknown";

interface LoadedSource {
  bytes: Uint8Array;
  filename: string;
  kind: SourceKind;
}

interface OrderedFile {
  file: Blob;
  originalIndex: number;
}

function normaliseSlug(value: string): string {
  const withoutQuery = value.trim().toLowerCase().split(/[?#]/, 1)[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}

function createProgressReporter(
  callback?: PdfProgressCallback,
): ProgressReporter {
  let latest = -1;
  let latestStage: string | undefined;

  return (progress, stage) => {
    const next = Math.max(
      latest,
      Math.min(100, Math.max(0, Math.round(progress))),
    );
    if (next === latest && stage === latestStage) return;

    latest = next;
    latestStage = stage;
    try {
      callback?.(next, stage);
    } catch {
      // Progress observers must not be able to corrupt an otherwise valid PDF.
    }
  };
}

function fileNameOf(file: Blob, index = 0): string {
  const possibleName = (file as Blob & { name?: unknown }).name;
  return typeof possibleName === "string" && possibleName.trim()
    ? possibleName.trim()
    : `document-${index + 1}`;
}

function fileStem(file: Blob | undefined, fallback = "document"): string {
  if (!file) return fallback;
  const name = fileNameOf(file);
  const lastDot = name.lastIndexOf(".");
  return sanitiseFilename(lastDot > 0 ? name.slice(0, lastDot) : name, fallback);
}

function sanitiseFilename(value: string, fallback = "document"): string {
  const withoutControlCharacters = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? "-" : character,
  ).join("");
  const cleaned = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function resultFromBytes(result: InternalPdfResult): PdfToolResult {
  return {
    // Uint8Array is a valid BlobPart at runtime. pdf-lib's broad
    // ArrayBufferLike generic only needs a narrow cast at the type boundary;
    // avoiding an explicit second byte-for-byte copy keeps peak memory lower.
    blob: new Blob([result.bytes as unknown as BlobPart], {
      type: result.mimeType ?? PDF_MIME_TYPE,
    }),
    filename: sanitiseFilename(result.filename, "result.pdf"),
    mimeType: result.mimeType ?? PDF_MIME_TYPE,
    message: result.message,
  };
}

function requireFiles(files: readonly Blob[], minimum = 1): void {
  if (files.length < minimum) {
    throw new PdfToolError(
      "MISSING_FILES",
      minimum === 1
        ? "Select a file before processing."
        : `Select at least ${minimum} files before processing.`,
    );
  }
}

function throwSecurityLimit(issue: PdfSecurityLimitIssue): never {
  throw new PdfToolError(
    "SECURITY_LIMIT_EXCEEDED",
    describePdfSecurityLimitIssue(issue),
  );
}

function enforceFileSelectionLimits(files: readonly Blob[]): void {
  const issue = getFileSelectionLimitIssue(
    files.map((file, index) => ({
      name: fileNameOf(file, index),
      size: file.size,
      type: file.type,
    })),
  );
  if (issue) throwSecurityLimit(issue);
}

function enforcePageCountLimit(pageCount: number): void {
  const issue = getPageCountLimitIssue(pageCount);
  if (issue) throwSecurityLimit(issue);
}

function enforceImageLimits(source: LoadedSource): void {
  const mime =
    source.kind === "png"
      ? "image/png"
      : source.kind === "jpg"
        ? "image/jpeg"
        : "";
  const byteIssue = getFileLimitIssue({
    name: source.filename,
    size: source.bytes.byteLength,
    type: mime,
  });
  if (byteIssue) throwSecurityLimit(byteIssue);

  const headerBytes = source.bytes.subarray(
    0,
    Math.min(
      source.bytes.byteLength,
      PDF_SECURITY_LIMITS.maxImageHeaderBytes,
    ),
  );
  const dimensions = getImageDimensionsFromBytes(headerBytes);
  const dimensionIssue = dimensions
    ? getImageDimensionLimitIssue(
        source.filename,
        dimensions.width,
        dimensions.height,
      )
    : getImageDimensionLimitIssue(
        source.filename,
        Number.NaN,
        Number.NaN,
      );
  if (dimensionIssue) throwSecurityLimit(dimensionIssue);
}

async function readSource(file: Blob, index = 0): Promise<LoadedSource> {
  const filename = fileNameOf(file, index);
  /*
   * Inspect the signature before materialising a mislabeled image in memory.
   * This closes the direct-engine path that bypasses the UI MIME/extension
   * checks.
   */
  const signature = new Uint8Array(
    await file.slice(0, Math.min(file.size, 1024)).arrayBuffer(),
  );
  const signatureKind = detectSourceKind(file, signature);
  if (
    (signatureKind === "jpg" || signatureKind === "png") &&
    file.size > PDF_SECURITY_LIMITS.maxImageBytes
  ) {
    throwSecurityLimit({
      code: "image-too-large",
      fileName: filename,
      maxBytes: PDF_SECURITY_LIMITS.maxImageBytes,
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const source: LoadedSource = {
    bytes,
    filename,
    kind: detectSourceKind(file, bytes),
  };
  if (source.kind === "jpg" || source.kind === "png") {
    enforceImageLimits(source);
  }
  return source;
}

function detectSourceKind(file: Blob, bytes: Uint8Array): SourceKind {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }

  const pdfScanLength = Math.min(bytes.length - 4, 1024);
  for (let index = 0; index <= pdfScanLength; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) {
      return "pdf";
    }
  }

  const mime = file.type.toLowerCase();
  const name = fileNameOf(file).toLowerCase();
  if (mime === PDF_MIME_TYPE || name.endsWith(".pdf")) return "pdf";
  if (mime === "image/png" || name.endsWith(".png")) return "png";
  if (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  ) {
    return "jpg";
  }
  return "unknown";
}

async function loadPdfSource(
  file: Blob,
  index = 0,
  allowSecuritySanitization = false,
): Promise<{ document: PDFDocument; source: LoadedSource }> {
  const source = await readSource(file, index);
  if (source.kind !== "pdf") {
    throw new PdfToolError(
      "EXPECTED_PDF",
      `${source.filename} is not a PDF document.`,
    );
  }

  try {
    const document = await PDFDocument.load(source.bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    assertPdfPageTreeWithinLimits(document);
    enforcePageCountLimit(document.getPageCount());
    if (!allowSecuritySanitization) {
      constrainPdfObjectGraphDepth(document, "reject");
    }
    return { document, source };
  } catch (error) {
    if (error instanceof PdfToolError) throw error;
    throw new PdfToolError(
      "INVALID_PDF",
      `Could not read ${source.filename}. It may be damaged, encrypted, or unsupported.`,
      error,
    );
  }
}

function numberOption(
  options: PdfToolOptions,
  keys: readonly string[],
  fallback: number,
): number {
  const optionRecord = options as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = optionRecord[key];
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanOption(
  options: PdfToolOptions,
  key: string,
  fallback: boolean,
): boolean {
  const value = (options as unknown as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : fallback;
}

function uniqueInOrder(values: readonly number[]): number[] {
  const seen = new Set<number>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function oneBasedPage(value: string, pageCount: number): number | undefined {
  const normalised = value.trim().toLowerCase();
  if (normalised === "first") return 1;
  if (normalised === "last" || normalised === "end") return pageCount;
  const parsed = Number(normalised);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

const MAX_PAGE_SELECTION_CHARACTERS =
  PDF_SECURITY_LIMITS.maxPageRangeCharacters;
const MAX_PAGE_SELECTION_TOKENS = PDF_SECURITY_LIMITS.maxPages;

function throwPageSelectionLimit(): never {
  /*
   * Page selectors are untrusted input. Reject them before split/filter/flatMap
   * can allocate memory proportional to an attacker-controlled token count.
   */
  throwSecurityLimit({
    code: "too-many-pages",
    maxPages: PDF_SECURITY_LIMITS.maxPages,
  });
}

function appendSelectedPage(pages: number[], pageIndex: number): void {
  if (pages.length >= PDF_SECURITY_LIMITS.maxPages) {
    throwPageSelectionLimit();
  }
  pages.push(pageIndex);
}

function parsePageSelection(
  selection: PageSelection,
  pageCount: number,
): number[] {
  const pages: number[] = [];

  if (typeof selection === "number") {
    if (Number.isInteger(selection) && selection >= 1 && selection <= pageCount) {
      return [selection - 1];
    }
    throw new PdfToolError(
      "INVALID_PAGE_SELECTION",
      `Page ${selection} is outside this document.`,
    );
  }

  if (typeof selection !== "string") {
    if (selection.length > MAX_PAGE_SELECTION_TOKENS) {
      throwPageSelectionLimit();
    }
    for (const page of selection) {
      if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
        appendSelectedPage(pages, page - 1);
      }
    }
    if (pages.length === 0) {
      throw new PdfToolError(
        "INVALID_PAGE_SELECTION",
        "The page selection does not contain any valid pages.",
      );
    }
    return pages;
  }

  if (selection.length > MAX_PAGE_SELECTION_CHARACTERS) {
    throwPageSelectionLimit();
  }
  const value = selection
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, "-");
  if (!value || value === "all" || value === "*") {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const tokens = value.split(/[,;\s]+/).filter(Boolean);
  if (tokens.length > MAX_PAGE_SELECTION_TOKENS) {
    throwPageSelectionLimit();
  }
  for (const token of tokens) {
    if (token === "odd" || token === "even") {
      const parity = token === "odd" ? 1 : 0;
      for (let page = 1; page <= pageCount; page += 1) {
        if (page % 2 === parity) appendSelectedPage(pages, page - 1);
      }
      continue;
    }

    const range = token.match(
      /^(first|last|end|\d+)?-(first|last|end|\d+)?$/,
    );
    if (range) {
      const start = oneBasedPage(range[1] || "first", pageCount);
      const end = oneBasedPage(range[2] || "last", pageCount);
      if (!start || !end) continue;

      /*
       * Bound the range before iterating. An input such as
       * "999999999-1" must cost O(pageCount), not O(the supplied number).
       * Ranges wholly outside the document stay invalid instead of being
       * silently mapped to an unrelated boundary page.
       */
      if (
        (start < 1 && end < 1) ||
        (start > pageCount && end > pageCount)
      ) {
        continue;
      }
      const boundedStart = Math.min(pageCount, Math.max(1, start));
      const boundedEnd = Math.min(pageCount, Math.max(1, end));
      const step = boundedStart <= boundedEnd ? 1 : -1;
      for (
        let page = boundedStart;
        step > 0 ? page <= boundedEnd : page >= boundedEnd;
        page += step
      ) {
        appendSelectedPage(pages, page - 1);
      }
      continue;
    }

    const page = oneBasedPage(token, pageCount);
    if (page && page >= 1 && page <= pageCount) {
      appendSelectedPage(pages, page - 1);
    }
  }

  if (pages.length === 0) {
    throw new PdfToolError(
      "INVALID_PAGE_SELECTION",
      `No valid pages were found in "${selection}".`,
    );
  }
  return pages;
}

function orderedFiles(
  files: readonly Blob[],
  options: PdfToolOptions,
): OrderedFile[] {
  const natural = files.map((file, originalIndex) => ({ file, originalIndex }));
  if (!Array.isArray(options.fileOrder)) {
    return options.reverseFiles ? natural.reverse() : natural;
  }

  const requested = uniqueInOrder(
    options.fileOrder.filter(
      (index) => Number.isInteger(index) && index >= 0 && index < files.length,
    ),
  );
  const omitted = natural
    .map(({ originalIndex }) => originalIndex)
    .filter((index) => !requested.includes(index));
  const order = [...requested, ...omitted];
  if (options.reverseFiles) order.reverse();
  return order.map((originalIndex) => ({
    file: files[originalIndex],
    originalIndex,
  }));
}

function selectionForFile(
  options: PdfToolOptions,
  fileIndex: number,
  pageCount: number,
): number[] {
  const perFile = options.pagesByFile;
  const selection = Array.isArray(perFile)
    ? perFile[fileIndex]
    : perFile?.[fileIndex];
  return selection === undefined
    ? Array.from({ length: pageCount }, (_, index) => index)
    : parsePageSelection(selection, pageCount);
}

function resolveImagePageSize(
  imageWidth: number,
  imageHeight: number,
  options: PdfToolOptions,
): [number, number] {
  const dpi = Math.max(1, numberOption(options, ["imageDpi", "dpi"], 72));
  const naturalWidth = (imageWidth * 72) / dpi;
  const naturalHeight = (imageHeight * 72) / dpi;
  const configured = options.pageSize;

  let width: number;
  let height: number;
  if (
    Array.isArray(configured) &&
    configured.length === 2 &&
    Number(configured[0]) > 0 &&
    Number(configured[1]) > 0
  ) {
    width = Number(configured[0]);
    height = Number(configured[1]);
  } else if (configured === "a4") {
    [width, height] = A4;
  } else if (configured === "letter") {
    [width, height] = LETTER;
  } else if (configured === "legal") {
    [width, height] = LEGAL;
  } else {
    width = naturalWidth;
    height = naturalHeight;
  }

  if (
    (options.orientation === "portrait" && width > height) ||
    (options.orientation === "landscape" && height > width)
  ) {
    [width, height] = [height, width];
  }
  return [width, height];
}

async function addImagePage(
  document: PDFDocument,
  source: LoadedSource,
  options: PdfToolOptions,
): Promise<PDFPage> {
  enforceImageLimits(source);
  const image =
    source.kind === "png"
      ? await document.embedPng(source.bytes)
      : await document.embedJpg(source.bytes);
  const [pageWidth, pageHeight] = resolveImagePageSize(
    image.width,
    image.height,
    options,
  );
  const page = document.addPage([pageWidth, pageHeight]);
  const margin = Math.max(
    0,
    Math.min(
      Math.min(pageWidth, pageHeight) / 2 - 0.5,
      numberOption(options, ["margin"], 0),
    ),
  );
  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const availableHeight = Math.max(1, pageHeight - margin * 2);

  let drawWidth = availableWidth;
  let drawHeight = availableHeight;
  if (options.imageFit !== "stretch") {
    const scale =
      options.imageFit === "cover"
        ? Math.max(
            availableWidth / image.width,
            availableHeight / image.height,
          )
        : Math.min(
            availableWidth / image.width,
            availableHeight / image.height,
          );
    drawWidth = image.width * scale;
    drawHeight = image.height * scale;
  }

  page.drawImage(image, {
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
  return page;
}

async function sourceAsPdf(
  file: Blob,
  index: number,
  options: PdfToolOptions,
): Promise<{ document: PDFDocument; filename: string }> {
  const source = await readSource(file, index);
  if (source.kind === "pdf") {
    try {
      const document = await PDFDocument.load(source.bytes, {
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
      assertPdfPageTreeWithinLimits(document);
      enforcePageCountLimit(document.getPageCount());
      constrainPdfObjectGraphDepth(document, "reject");
      return {
        document,
        filename: source.filename,
      };
    } catch (error) {
      if (error instanceof PdfToolError) throw error;
      throw new PdfToolError(
        "INVALID_PDF",
        `Could not read ${source.filename}. It may be damaged, encrypted, or unsupported.`,
        error,
      );
    }
  }

  if (source.kind === "jpg" || source.kind === "png") {
    const document = await PDFDocument.create({ updateMetadata: false });
    await addImagePage(document, source, options);
    return { document, filename: source.filename };
  }

  throw new PdfToolError(
    "UNSUPPORTED_FILE",
    `${source.filename} is not a supported PDF, JPG, JPEG, or PNG file.`,
  );
}

function copyBasicMetadata(source: PDFDocument, target: PDFDocument): void {
  try {
    const title = source.getTitle();
    const author = source.getAuthor();
    const subject = source.getSubject();
    const creator = source.getCreator();
    const producer = source.getProducer();
    const creationDate = source.getCreationDate();
    const modificationDate = source.getModificationDate();
    if (title) target.setTitle(title);
    if (author) target.setAuthor(author);
    if (subject) target.setSubject(subject);
    if (creator) target.setCreator(creator);
    if (producer) target.setProducer(producer);
    if (creationDate) target.setCreationDate(creationDate);
    if (modificationDate) target.setModificationDate(modificationDate);
  } catch {
    // Malformed optional metadata should not prevent valid page processing.
  }
}

async function savePdf(document: PDFDocument): Promise<Uint8Array> {
  return document.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50,
    updateFieldAppearances: false,
  });
}

async function processMerge(
  files: readonly Blob[],
  options: PdfToolOptions,
  progress: ProgressReporter,
): Promise<InternalPdfResult> {
  requireFiles(files);
  const output = await PDFDocument.create({ updateMetadata: false });
  const ordered = orderedFiles(files, options);

  for (let position = 0; position < ordered.length; position += 1) {
    const { file, originalIndex } = ordered[position];
    progress(5 + (position / ordered.length) * 70, `Reading file ${position + 1}`);
    const source = await sourceAsPdf(file, originalIndex, options);
    if (position === 0) copyBasicMetadata(source.document, output);
    const indices = selectionForFile(
      options,
      originalIndex,
      source.document.getPageCount(),
    );
    enforcePageCountLimit(output.getPageCount() + indices.length);
    const pages = await output.copyPages(source.document, indices);
    pages.forEach((page) => output.addPage(page));
  }

  if (output.getPageCount() === 0) {
    throw new PdfToolError("NO_PAGES", "The selected files contain no pages.");
  }
  progress(85, "Building merged PDF");
  return {
    bytes: await savePdf(output),
    filename: "merged.pdf",
  };
}

function splitOutputRanges(
  options: PdfToolOptions,
  pageCount: number,
): number[][] {
  const raw =
    typeof options.ranges === "string"
      ? options.ranges
      : typeof options.pageRange === "string"
        ? options.pageRange
        : typeof options.pages === "string"
          ? options.pages
          : "";
  const groups = raw
    .split(";")
    .map((group) => group.trim())
    .filter(Boolean);

  if (groups.length < 2) {
    throw new PdfToolError(
      "MISSING_SPLIT_GROUPS",
      "Enter at least two page groups separated by semicolons, for example 1-3; 4-6.",
    );
  }
  if (groups.length > PDF_SECURITY_LIMITS.maxPages) {
    throw new PdfToolError(
      "INVALID_PAGE_SELECTION",
      "The split contains too many output groups.",
    );
  }

  const ranges = groups.map((group) => parsePageSelection(group, pageCount));
  enforcePageCountLimit(ranges.reduce((total, range) => total + range.length, 0));
  return ranges;
}

async function processSplit(
  files: readonly Blob[],
  options: PdfToolOptions,
  progress: ProgressReporter,
): Promise<InternalPdfResult> {
  requireFiles(files);
  progress(8, "Reading PDF");
  const { document: source } = await loadPdfSource(files[0]);
  const ranges = splitOutputRanges(options, source.getPageCount());
  const stem = fileStem(files[0]);
  const entries: Array<{ name: string; bytes: Uint8Array }> = [];
  let totalBytes = 0;

  for (let index = 0; index < ranges.length; index += 1) {
    const output = await PDFDocument.create({ updateMetadata: false });
    copyBasicMetadata(source, output);
    const pages = await output.copyPages(source, ranges[index]);
    pages.forEach((page) => output.addPage(page));
    const bytes = await savePdf(output);
    totalBytes += bytes.byteLength;
    if (totalBytes > PDF_SECURITY_LIMITS.maxTotalBytes) {
      throw new PdfToolError(
        "SECURITY_LIMIT_EXCEEDED",
        "The split outputs would exceed the safe in-browser memory limit.",
      );
    }
    entries.push({
      name: `${stem}-part-${String(index + 1).padStart(2, "0")}.pdf`,
      bytes,
    });
    progress(
      18 + ((index + 1) / ranges.length) * 67,
      `Building part ${index + 1}`,
    );
  }

  return {
    bytes: createStoredZip(entries),
    filename: `${stem}-split.zip`,
    mimeType: "application/zip",
    message: `Created ${entries.length} PDF files in one ZIP archive.`,
  };
}

function deleteReferencedEntry(
  document: PDFDocument,
  dictionary: PDFDict,
  key: string,
): boolean {
  const name = PDFName.of(key);
  const value = dictionary.get(name, true);
  const removed = dictionary.delete(name);

  /*
   * Info and Metadata streams are exclusive document/page metadata objects in
   * normal PDFs. Removing their indirect objects prevents their bytes from
   * surviving as unreachable data in pdf-lib's output.
   */
  if (removed && value instanceof PDFRef) {
    document.context.delete(value);
  }
  return removed;
}

function dictionaryForObject(object: PDFObject | undefined): PDFDict | undefined {
  if (object instanceof PDFDict) return object;
  if (object instanceof PDFStream) return object.dict;
  return undefined;
}

function lookupObject(
  document: PDFDocument,
  object: PDFObject,
): PDFObject | undefined {
  if (!(object instanceof PDFRef)) return object;
  try {
    return document.context.lookup(object);
  } catch {
    return undefined;
  }
}

function isMetadataObject(
  document: PDFDocument,
  object: PDFObject | undefined,
): boolean {
  const dictionary = dictionaryForObject(object);
  if (!dictionary) return false;
  const rawType = dictionary.get(PDFName.of("Type"), true);
  const resolvedType = rawType
    ? lookupObject(document, rawType)
    : undefined;
  return (
    resolvedType instanceof PDFName &&
    resolvedType.decodeText() === "Metadata"
  );
}

const METADATA_ENTRY_KEYS = new Set([
  "LastModified",
  "Metadata",
  "PieceInfo",
]);

function removeNestedMetadataObjects(document: PDFDocument): number {
  const indirectObjects = document.context.enumerateIndirectObjects();
  const metadataRefs = new Map<string, PDFRef>();
  for (const [ref, object] of indirectObjects) {
    if (isMetadataObject(document, object)) {
      metadataRefs.set(ref.toString(), ref);
    }
  }

  const discovered = new Set<PDFObject>();
  const discoveryStack: PDFObject[] = [];
  const queueForDiscovery = (object: PDFObject | undefined): void => {
    if (!object || discovered.has(object)) return;
    discovered.add(object);
    discoveryStack.push(object);
  };
  for (const [, object] of indirectObjects) queueForDiscovery(object);
  while (discoveryStack.length > 0) {
    const object = discoveryStack.pop();
    if (!object) continue;
    const dictionary = dictionaryForObject(object);
    if (dictionary) {
      for (const [key, rawValue] of dictionary.entries()) {
        if (
          METADATA_ENTRY_KEYS.has(key.decodeText()) &&
          rawValue instanceof PDFRef
        ) {
          metadataRefs.set(rawValue.toString(), rawValue);
        }
        queueForDiscovery(lookupObject(document, rawValue));
      }
      continue;
    }

    if (object instanceof PDFArray) {
      for (let index = 0; index < object.size(); index += 1) {
        queueForDiscovery(
          lookupObject(document, object.get(index)),
        );
      }
    }
  }

  let removed = 0;
  const visited = new Set<PDFObject>();
  const scrubStack: PDFObject[] = [];
  const queueForScrubbing = (object: PDFObject | undefined): void => {
    if (!object || visited.has(object)) return;
    visited.add(object);
    scrubStack.push(object);
  };
  for (const [, object] of indirectObjects) queueForScrubbing(object);
  while (scrubStack.length > 0) {
    const object = scrubStack.pop();
    if (!object) continue;
    const dictionary = dictionaryForObject(object);
    if (dictionary) {
      for (const [key, rawValue] of [...dictionary.entries()]) {
        const isStandardMetadataEntry = METADATA_ENTRY_KEYS.has(
          key.decodeText(),
        );
        const referencesMetadata =
          rawValue instanceof PDFRef &&
          metadataRefs.has(rawValue.toString());
        const resolvedValue = lookupObject(document, rawValue);
        if (
          isStandardMetadataEntry ||
          referencesMetadata ||
          isMetadataObject(document, resolvedValue)
        ) {
          dictionary.delete(key);
          removed += 1;
          continue;
        }
        queueForScrubbing(resolvedValue);
      }
      continue;
    }

    if (object instanceof PDFArray) {
      for (let index = object.size() - 1; index >= 0; index -= 1) {
        const rawValue = object.get(index);
        const referencesMetadata =
          rawValue instanceof PDFRef &&
          metadataRefs.has(rawValue.toString());
        const resolvedValue = lookupObject(document, rawValue);
        if (
          referencesMetadata ||
          isMetadataObject(document, resolvedValue)
        ) {
          object.remove(index);
          removed += 1;
          continue;
        }
        queueForScrubbing(resolvedValue);
      }
    }
  }

  /*
   * Metadata can be hidden under arbitrary extension keys rather than the
   * standard Catalog/Page /Metadata entries. Walk every reachable container,
   * remove both direct and indirect /Type /Metadata values, then delete the
   * backing indirect streams so their XMP bytes cannot be serialized. The
   * explicit stack keeps deeply nested but otherwise valid PDFs from
   * exhausting the JavaScript call stack.
   */
  for (const ref of metadataRefs.values()) {
    if (document.context.delete(ref)) removed += 1;
  }
  return removed;
}

const ACTIVE_CONTENT_KEYS = new Set([
  "A",
  "AA",
  "Actions",
  "AF",
  "Collection",
  "EmbeddedFiles",
  "EF",
  "ImportData",
  "JavaScript",
  "JS",
  "Launch",
  "Next",
  "OpenAction",
  "Perms",
  "PresSteps",
  "Rendition",
  "RichMedia",
  "SpiderInfo",
  "SubmitForm",
  "Threads",
]);

const ACTIVE_ACTION_SUBTYPES = new Set([
  "GoTo",
  "GoTo3DView",
  "GoToE",
  "GoToR",
  "Hide",
  "ImportData",
  "JavaScript",
  "Launch",
  "Movie",
  "Named",
  "Rendition",
  "ResetForm",
  "SetOCGState",
  "Sound",
  "SubmitForm",
  "Thread",
  "Trans",
  "URI",
]);

function resolvedName(
  document: PDFDocument,
  dictionary: PDFDict,
  key: string,
): string | undefined {
  const rawValue = dictionary.get(PDFName.of(key), true);
  const value = rawValue
    ? lookupObject(document, rawValue)
    : undefined;
  return value instanceof PDFName ? value.decodeText() : undefined;
}

function isActiveContentObject(
  document: PDFDocument,
  object: PDFObject | undefined,
): boolean {
  const dictionary = dictionaryForObject(object);
  if (!dictionary) return false;

  const type = resolvedName(document, dictionary, "Type");
  if (
    type === "Action" ||
    type === "Filespec" ||
    type === "EmbeddedFile"
  ) {
    return true;
  }

  const actionSubtype = resolvedName(document, dictionary, "S");
  return (
    actionSubtype !== undefined &&
    ACTIVE_ACTION_SUBTYPES.has(actionSubtype)
  );
}

function removeNestedActiveContent(document: PDFDocument): number {
  const indirectObjects = document.context.enumerateIndirectObjects();
  const activeRefs = new Map<string, PDFRef>();
  for (const [ref, object] of indirectObjects) {
    if (isActiveContentObject(document, object)) {
      activeRefs.set(ref.toString(), ref);
    }
  }

  let removed = 0;
  const visited = new Set<PDFObject>();
  const scrubStack: PDFObject[] = [];
  const queueForScrubbing = (object: PDFObject | undefined): void => {
    if (!object || visited.has(object)) return;
    visited.add(object);
    scrubStack.push(object);
  };
  for (const [, object] of indirectObjects) queueForScrubbing(object);
  while (scrubStack.length > 0) {
    const object = scrubStack.pop();
    if (!object) continue;
    const dictionary = dictionaryForObject(object);
    if (dictionary) {
      for (const [key, rawValue] of [...dictionary.entries()]) {
        const keyName = key.decodeText();
        const referencesActiveObject =
          rawValue instanceof PDFRef &&
          activeRefs.has(rawValue.toString());
        const resolvedValue = lookupObject(document, rawValue);
        if (
          ACTIVE_CONTENT_KEYS.has(keyName) ||
          referencesActiveObject ||
          isActiveContentObject(document, resolvedValue)
        ) {
          dictionary.delete(key);
          removed += 1;
          continue;
        }
        queueForScrubbing(resolvedValue);
      }
      continue;
    }

    if (object instanceof PDFArray) {
      for (let index = object.size() - 1; index >= 0; index -= 1) {
        const rawValue = object.get(index);
        const referencesActiveObject =
          rawValue instanceof PDFRef &&
          activeRefs.has(rawValue.toString());
        const resolvedValue = lookupObject(document, rawValue);
        if (
          referencesActiveObject ||
          isActiveContentObject(document, resolvedValue)
        ) {
          object.remove(index);
          removed += 1;
          continue;
        }
        queueForScrubbing(resolvedValue);
      }
    }
  }

  /*
   * Associated files and actions may be attached to Form XObjects or custom
   * extension dictionaries. Sanitize the complete object graph, not only the
   * Catalog and Page dictionaries, while leaving normal content/resources.
   * Use an explicit stack because attacker-controlled object depth must not
   * consume the JavaScript call stack.
   */
  for (const ref of activeRefs.values()) {
    if (document.context.delete(ref)) removed += 1;
  }
  return removed;
}

function assertPdfPageTreeWithinLimits(document: PDFDocument): void {
  type PageTreeEntry = { object: PDFObject; depth: number };

  const rawPages = document.catalog.get(PDFName.of("Pages"), true);
  const root = rawPages
    ? lookupObject(document, rawPages)
    : undefined;
  if (!root) return;

  let pageLeaves = 0;
  const seenBranches = new Set<PDFObject>();
  const stack: PageTreeEntry[] = [{ object: root, depth: 0 }];

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (
      entry.depth >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth
    ) {
      throwSecurityLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    /*
     * A valid page tree cannot contain a cycle or reuse an internal branch.
     * pdf-lib traverses it recursively without cycle detection, so reject a
     * repeated branch before invoking getPageCount()/getPages().
     */
    if (seenBranches.has(entry.object)) {
      throwSecurityLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    seenBranches.add(entry.object);
    if (
      seenBranches.size >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      throwSecurityLimit({
        code: "pdf-object-graph-too-large",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
      });
    }

    const dictionary = dictionaryForObject(entry.object);
    if (!dictionary) continue;
    const rawKids = dictionary.get(PDFName.of("Kids"), true);
    const kids = rawKids
      ? lookupObject(document, rawKids)
      : undefined;
    if (!(kids instanceof PDFArray)) continue;

    for (let index = 0; index < kids.size(); index += 1) {
      const rawKid = kids.get(index);
      const kid = lookupObject(document, rawKid);
      const kidDictionary = dictionaryForObject(kid);
      if (!kidDictionary || !kid) continue;

      const type = resolvedName(document, kidDictionary, "Type");
      if (type === "Pages") {
        stack.push({ object: kid, depth: entry.depth + 1 });
        continue;
      }
      if (type !== "Page") continue;

      pageLeaves += 1;
      if (pageLeaves > PDF_SECURITY_LIMITS.maxPages) {
        throwPageSelectionLimit();
      }
    }
  }
}

function constrainPdfObjectGraphDepth(
  document: PDFDocument,
  policy: "prune" | "reject",
): number {
  type GraphEntry = { object: PDFObject; depth: number };

  let removed = 0;
  const shallowestDepth = new Map<PDFObject, number>();
  const stack: GraphEntry[] = [];
  const queue = (object: PDFObject | undefined, depth: number): void => {
    if (!object) return;
    const previousDepth = shallowestDepth.get(object);
    if (previousDepth !== undefined && previousDepth <= depth) return;
    shallowestDepth.set(object, depth);
    if (
      shallowestDepth.size >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      throwSecurityLimit({
        code: "pdf-object-graph-too-large",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
      });
    }
    stack.push({ object, depth });
  };

  queue(document.catalog, 0);
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;

    const dictionary = dictionaryForObject(entry.object);
    if (dictionary) {
      for (const [key, rawValue] of [...dictionary.entries()]) {
        const resolvedValue = lookupObject(document, rawValue);
        const isContainer =
          dictionaryForObject(resolvedValue) !== undefined ||
          resolvedValue instanceof PDFArray;
        if (!isContainer) continue;

        const childDepth = entry.depth + 1;
        if (
          childDepth >
          PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth
        ) {
          if (policy === "reject") {
            throwSecurityLimit({
              code: "pdf-object-graph-too-deep",
              maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
            });
          }
          dictionary.delete(key);
          removed += 1;
          continue;
        }
        queue(resolvedValue, childDepth);
      }
      continue;
    }

    if (entry.object instanceof PDFArray) {
      for (
        let index = entry.object.size() - 1;
        index >= 0;
        index -= 1
      ) {
        const rawValue = entry.object.get(index);
        const resolvedValue = lookupObject(document, rawValue);
        const isContainer =
          dictionaryForObject(resolvedValue) !== undefined ||
          resolvedValue instanceof PDFArray;
        if (!isContainer) continue;

        const childDepth = entry.depth + 1;
        if (
          childDepth >
          PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth
        ) {
          if (policy === "reject") {
            throwSecurityLimit({
              code: "pdf-object-graph-too-deep",
              maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
            });
          }
          entry.object.remove(index);
          removed += 1;
          continue;
        }
        queue(resolvedValue, childDepth);
      }
    }
  }

  return removed;
}

function removeDocumentMetadata(document: PDFDocument): number {
  let removed = 0;
  const info = document.context.trailerInfo.Info;
  if (info !== undefined) {
    delete document.context.trailerInfo.Info;
    if (info instanceof PDFRef) document.context.delete(info);
    removed += 1;
  }

  const id = document.context.trailerInfo.ID;
  if (id !== undefined) {
    delete document.context.trailerInfo.ID;
    if (id instanceof PDFRef) document.context.delete(id);
    removed += 1;
  }

  removed += removeNestedMetadataObjects(document);

  if (deleteReferencedEntry(document, document.catalog, "Metadata")) {
    removed += 1;
  }
  if (deleteReferencedEntry(document, document.catalog, "PieceInfo")) {
    removed += 1;
  }

  for (const page of document.getPages()) {
    for (const key of ["Metadata", "PieceInfo", "LastModified"]) {
      if (deleteReferencedEntry(document, page.node, key)) removed += 1;
    }
  }
  return removed;
}

async function processCompress(
  files: readonly Blob[],
  options: PdfToolOptions,
  progress: ProgressReporter,
): Promise<InternalPdfResult> {
  requireFiles(files);
  progress(8, "Reading PDF");
  const loaded = await loadPdfSource(
    files[0],
    0,
    options.removeMetadata === true,
  );
  let document = loaded.document;

  if (options.removeMetadata) {
    /*
     * Apply the node/depth budget before scanning every indirect object.
     * Metadata cleanup is iterative, but an attacker must not be able to make
     * its work proportional to an otherwise unbounded object graph.
     */
    constrainPdfObjectGraphDepth(document, "prune");
    removeDocumentMetadata(document);
  }

  if (options.aggressive) {
    progress(35, "Discarding unused PDF objects");
    const compact = await PDFDocument.create({ updateMetadata: false });
    if (!options.removeMetadata) copyBasicMetadata(document, compact);
    const pages = await compact.copyPages(
      document,
      document.getPageIndices(),
    );
    pages.forEach((page) => compact.addPage(page));
    document = compact;
  }

  if (options.removeMetadata && options.aggressive) {
    // Re-scan copied page graphs so aggressive compaction cannot reintroduce
    // non-standard metadata carriers from source page resources.
    removeDocumentMetadata(document);
  }

  progress(70, "Writing object streams");
  const candidate = await savePdf(document);
  const keepSmallest = booleanOption(options, "keepSmallest", true);
  const useOriginal =
    !options.removeMetadata &&
    keepSmallest &&
    candidate.byteLength >= loaded.source.bytes.byteLength;

  return {
    bytes: useOriginal ? loaded.source.bytes : candidate,
    filename: `${fileStem(files[0])}-compressed.pdf`,
    message: useOriginal
      ? "The original was already smaller, so its bytes were kept unchanged."
      : `Reduced from ${loaded.source.bytes.byteLength} to ${candidate.byteLength} bytes using PDF object-stream optimisation.`,
  };
}

async function processImagesToPdf(
  files: readonly Blob[],
  options: PdfToolOptions,
  progress: ProgressReporter,
): Promise<InternalPdfResult> {
  requireFiles(files);
  const document = await PDFDocument.create({ updateMetadata: false });

  for (let index = 0; index < files.length; index += 1) {
    progress(5 + (index / files.length) * 75, `Adding image ${index + 1}`);
    const source = await readSource(files[index], index);
    if (source.kind !== "jpg" && source.kind !== "png") {
      throw new PdfToolError(
        "EXPECTED_IMAGE",
        `${source.filename} is not a JPG, JPEG, or PNG image.`,
      );
    }
    await addImagePage(document, source, options);
  }

  document.setTitle(
    files.length === 1 ? fileStem(files[0], "image") : "Images",
  );
  progress(85, "Building PDF");
  return {
    bytes: await savePdf(document),
    filename:
      files.length === 1 ? `${fileStem(files[0], "image")}.pdf` : "images.pdf",
  };
}

async function processFlatten(
  files: readonly Blob[],
  progress: ProgressReporter,
): Promise<InternalPdfResult> {
  requireFiles(files);
  progress(8, "Reading PDF");
  const { document: source } = await loadPdfSource(files[0], 0, true);
  /*
   * AcroForm traversal in pdf-lib is recursive too. Bound custom/form graphs
   * before calling getForm/getFields, then run the content sanitizers below on
   * every indirect object (including anything detached by this pruning).
   */
  const prunedBeforeForm = constrainPdfObjectGraphDepth(source, "prune");
  let fieldCount = 0;
  if (prunedBeforeForm === 0) {
    const form = source.getForm();
    fieldCount = form.getFields().length;

    if (fieldCount > 0) {
      progress(45, "Flattening form fields");
      form.flatten({
        updateFieldAppearances: true,
      });
    }
  }

  removeNestedActiveContent(source);

  /*
   * Flattening form widgets alone is not PDF sanitisation: document/page
   * actions, scripts, launch links, annotations and attachments would remain
   * executable. Remove every standard active entry point, then copy only the
   * cleaned pages into a fresh document so detached malicious objects are not
   * serialised into the result.
   */
  const catalogKeys = [
    "OpenAction",
    "AA",
    "Names",
    "Outlines",
    "AcroForm",
    "AF",
    "Collection",
    "Perms",
    "URI",
    "SpiderInfo",
    "Threads",
    "JavaScript",
    "EmbeddedFiles",
    "Launch",
  ] as const;
  for (const key of catalogKeys) {
    source.catalog.delete(PDFName.of(key));
  }

  const pageKeys = [
    "AA",
    "Annots",
    "AF",
    "Actions",
    "PresSteps",
    "Trans",
    "Dur",
    "B",
  ] as const;
  for (const page of source.getPages()) {
    for (const key of pageKeys) page.node.delete(PDFName.of(key));
  }
  removeDocumentMetadata(source);
  /*
   * pdf-lib copies page graphs recursively. Bound attacker-controlled custom
   * nesting before that copy so a tiny, deeply chained PDF cannot overflow the
   * JavaScript call stack during sanitization.
   */
  constrainPdfObjectGraphDepth(source, "prune");

  progress(72, "Removing active content");
  const sanitized = await PDFDocument.create({ updateMetadata: false });
  const pages = await sanitized.copyPages(source, source.getPageIndices());
  pages.forEach((page) => sanitized.addPage(page));

  return {
    bytes: await savePdf(sanitized),
    filename: `${fileStem(files[0])}-sanitized.pdf`,
    message: `Sanitized the PDF${
      fieldCount > 0
        ? ` and flattened ${fieldCount} form field${fieldCount === 1 ? "" : "s"}`
        : ""
    }. Active annotations, actions, scripts, attachments and metadata were removed.`,
  };
}

/**
 * Runs a PDF tool entirely in the browser and returns a downloadable Blob.
 *
 * Every accepted slug performs a real transformation. Unknown or unpublished
 * slugs fail closed rather than generating a placeholder document.
 */
export async function processPdfTool(
  slug: string,
  files: readonly Blob[],
  options: PdfToolOptions = {},
  onProgress?: PdfProgressCallback,
): Promise<PdfToolResult> {
  const progress = createProgressReporter(onProgress);
  const tool = normaliseSlug(slug);
  progress(0, "Preparing");

  try {
    if (!isPublicToolSlug(tool)) {
      throw new PdfToolError(
        "UNSUPPORTED_TOOL",
        "This PDF tool is not available in the production catalogue.",
      );
    }
    enforceFileSelectionLimits(files);
    let result: InternalPdfResult;
    switch (tool) {
      case "merge-pdf":
        result = await processMerge(files, options, progress);
        break;
      case "split-pdf":
        result = await processSplit(files, options, progress);
        break;
      case "compress-pdf":
        result = await processCompress(files, options, progress);
        break;
      case "jpg-to-pdf":
        result = await processImagesToPdf(files, options, progress);
        break;
      case "flatten-pdf":
        result = await processFlatten(files, progress);
        break;
      default:
        throw new PdfToolError(
          "UNSUPPORTED_TOOL",
          "This PDF tool is not available in the production catalogue.",
        );
    }

    progress(100, "Done");
    return resultFromBytes(result);
  } catch (error) {
    if (error instanceof PdfToolError) throw error;
    throw new PdfToolError(
      "PROCESSING_FAILED",
      `The ${tool || "PDF"} operation could not be completed.`,
      error,
    );
  }
}
