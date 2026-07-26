import type { PDFPageProxy } from "pdfjs-dist";

import type { PdfPreviewDocument } from "./pdf-preview";
import {
  describePdfSecurityLimitIssue,
  getPageCountLimitIssue,
  getTextContentLimitIssue,
} from "./pdf-security-limits";

export type PdfQuarterTurn = 0 | 90 | 180 | 270;

export interface NormalizedPdfTextPoint {
  /**
   * Horizontal position as a fraction of the displayed page width.
   */
  x: number;
  /**
   * Vertical position as a fraction of the displayed page height, measured
   * from the top edge.
   */
  y: number;
}

export interface PdfTextBaseline {
  start: NormalizedPdfTextPoint;
  end: NormalizedPdfTextPoint;
}

export interface PdfTextQuad {
  topLeft: NormalizedPdfTextPoint;
  topRight: NormalizedPdfTextPoint;
  bottomRight: NormalizedPdfTextPoint;
  bottomLeft: NormalizedPdfTextPoint;
}

/**
 * A text run returned by PDF.js, positioned in a scale-independent,
 * top-left coordinate system.
 *
 * `x`, `y`, `width` and `height` are clipped to the visible page and normally
 * fall in the 0..1 range. The un-clipped, rotated geometry is retained in
 * `quad`, which is useful for precise hit testing.
 */
export interface ExtractedPdfTextFragment {
  id: string;
  pageIndex: number;
  itemIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: PdfTextBaseline | null;
  quad: PdfTextQuad | null;
  /**
   * Clockwise angle in the displayed page coordinate system.
   */
  rotation: number | null;
  fontName: string;
  fontFamily: string;
  resolvedFontName?: string;
  bold: boolean;
  italic: boolean;
  /**
   * Font height in scale-1 viewport units (normally PDF points).
   */
  fontSize: number | null;
  /**
   * Font height as a fraction of the displayed page height.
   */
  fontSizeNormalized: number | null;
  /**
   * A CSS color when PDF.js or a caller-provided TextContent implementation
   * exposes one. Standard PDF.js TextContent does not currently expose fill
   * color, hence this is usually null.
   */
  color: string | null;
  direction: string;
  vertical: boolean;
  hasEOL: boolean;
  hasGeometry: boolean;
  markedContentIds: string[];
}

export interface ExtractedPdfTextPage {
  pageIndex: number;
  pageNumber: number;
  width: number;
  height: number;
  sourceRotation: PdfQuarterTurn;
  rotation: PdfQuarterTurn;
  language: string | null;
  fragments: ExtractedPdfTextFragment[];
}

export interface ExtractedPdfTextDocument {
  documentId: string;
  pageCount: number;
  pages: ExtractedPdfTextPage[];
}

export interface PdfTextViewportLike {
  width: number;
  height: number;
  transform: readonly number[];
}

export interface PdfJsTextItemLike {
  str: string;
  dir?: string;
  transform?: unknown;
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
  color?: unknown;
  fillColor?: unknown;
}

export interface PdfJsTextMarkedContentLike {
  type: string;
  id?: string;
}

export interface PdfJsTextStyleLike {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  black?: boolean;
  bold?: boolean;
  italic?: boolean;
  resolvedFontName?: string;
  color?: unknown;
  fillColor?: unknown;
}

export interface PdfJsTextContentLike {
  items: Array<
    PdfJsTextItemLike | PdfJsTextMarkedContentLike
  >;
  styles: Record<string, PdfJsTextStyleLike>;
  lang?: string | null;
}

export interface MapPdfTextContentOptions {
  pageIndex: number;
  pageNumber?: number;
  sourceRotation?: number;
  rotation?: number;
  documentId?: string;
  includeEmpty?: boolean;
}

export interface ExtractPdfPageTextOptions
  extends Omit<MapPdfTextContentOptions, "pageNumber" | "sourceRotation"> {
  signal?: AbortSignal;
  disableNormalization?: boolean;
}

export type PdfTextRotationResolver =
  | number
  | ReadonlyMap<number, number>
  | Readonly<Record<number, number>>
  | ((
      pageIndex: number,
      sourceRotation: PdfQuarterTurn,
    ) => number);

export interface ExtractPdfTextOptions {
  /**
   * Zero-based indexes. Omit to extract every page.
   */
  pageIndexes?: Iterable<number>;
  /**
   * Absolute displayed rotation. A callback can add editor rotation to the
   * source rotation supplied as its second argument.
   */
  rotation?: PdfTextRotationResolver;
  documentId?: string;
  includeEmpty?: boolean;
  disableNormalization?: boolean;
  signal?: AbortSignal;
}

type Matrix = [
  number,
  number,
  number,
  number,
  number,
  number,
];

interface Point {
  x: number;
  y: number;
}

type RuntimeTextStyle = PdfJsTextStyleLike;
type RuntimeTextItem = PdfJsTextItemLike;

interface PdfTextContentStats {
  itemCount: number;
  characterCount: number;
}

const DEFAULT_ASCENT = 0.8;
const DEFAULT_DESCENT = -0.2;

export function normalizePdfTextRotation(
  value: number | undefined,
): PdfQuarterTurn {
  if (!Number.isFinite(value)) return 0;

  const normalized =
    ((Math.round((value as number) / 90) * 90) % 360 + 360) %
    360;

  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }

  return 0;
}

function abortError(): Error {
  const error = new Error("PDF text extraction was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function textContentStats(
  items: readonly (
    | PdfJsTextItemLike
    | PdfJsTextMarkedContentLike
  )[],
): PdfTextContentStats {
  let characterCount = 0;
  for (const item of items) {
    if (isRuntimeTextItem(item)) {
      characterCount += item.str.length;
    }
  }
  return { itemCount: items.length, characterCount };
}

function assertTextContentWithinLimits(
  stats: PdfTextContentStats,
  scope: "page" | "document" = "page",
): void {
  const issue = getTextContentLimitIssue(
    stats.itemCount,
    stats.characterCount,
    scope,
  );
  if (issue) {
    const error = new Error(describePdfSecurityLimitIssue(issue));
    error.name = "PdfSecurityLimitError";
    throw error;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toMatrix(value: unknown): Matrix | null {
  let matrix: unknown[];
  if (Array.isArray(value)) {
    matrix = value.slice(0, 6);
  } else if (
    ArrayBuffer.isView(value) &&
    "length" in value &&
    typeof value.length === "number"
  ) {
    matrix = Array.from(
      value as unknown as ArrayLike<unknown>,
    ).slice(0, 6);
  } else {
    return null;
  }

  if (matrix.length < 6) return null;
  if (!matrix.every(isFiniteNumber)) return null;

  return matrix as Matrix;
}

function multiplyMatrices(first: Matrix, second: Matrix): Matrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizedPoint(
  point: Point,
  pageWidth: number,
  pageHeight: number,
): NormalizedPdfTextPoint {
  return {
    x: point.x / pageWidth,
    y: point.y / pageHeight,
  };
}

function normalizedDegrees(radians: number): number {
  const degrees = (radians * 180) / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;

  // Avoid values such as 359.99999999999994 for exact quarter turns.
  const nearestQuarterTurn = Math.round(normalized / 90) * 90;
  if (Math.abs(normalized - nearestQuarterTurn) < 1e-10) {
    return nearestQuarterTurn % 360;
  }

  return normalized;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36).padStart(7, "0");
}

function stableNumber(value: unknown): string {
  return isFiniteNumber(value) ? value.toFixed(5) : "?";
}

function textItemSignature(item: RuntimeTextItem): string {
  const transform = toMatrix(item.transform)
    ?.map(stableNumber)
    .join(",") ?? "";

  return [
    item.str,
    item.fontName ?? "",
    transform,
    stableNumber(item.width),
    stableNumber(item.height),
  ].join("\u001f");
}

function stableFragmentId(
  documentId: string,
  pageIndex: number,
  item: RuntimeTextItem,
  occurrence: number,
): string {
  const documentHash = hashString(documentId || "document");
  const itemHash = hashString(textItemSignature(item));

  return `pdf-text-${documentHash}-p${pageIndex}-${itemHash}-${occurrence}`;
}

function isRuntimeTextItem(
  item: PdfJsTextItemLike | PdfJsTextMarkedContentLike,
): item is PdfJsTextItemLike {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Partial<PdfJsTextItemLike>).str === "string"
  );
}

function isMarkedContentStart(
  item: PdfJsTextMarkedContentLike,
): boolean {
  return (
    item.type === "beginMarkedContent" ||
    item.type === "beginMarkedContentProps"
  );
}

function markedContentId(
  item: PdfJsTextMarkedContentLike,
): string | null {
  return typeof item.id === "string" && item.id.trim()
    ? item.id
    : null;
}

function byteToHex(value: number): string {
  return clamp(Math.round(value), 0, 255)
    .toString(16)
    .padStart(2, "0");
}

function colorChannel(value: number): number {
  return value >= 0 && value <= 1 ? value * 255 : value;
}

function cssColor(value: unknown): string | null {
  if (typeof value === "string") {
    const color = value.trim();
    return color || null;
  }

  if (
    (Array.isArray(value) ||
      (ArrayBuffer.isView(value) && "length" in value)) &&
    (value as ArrayLike<unknown>).length >= 3
  ) {
    const channels = Array.from(
      value as ArrayLike<unknown>,
    ).slice(0, 3);
    if (!channels.every(isFiniteNumber)) return null;

    return `#${channels
      .map((channel) => byteToHex(colorChannel(channel)))
      .join("")}`;
  }

  if (typeof value === "object" && value !== null) {
    const candidate = value as {
      r?: unknown;
      g?: unknown;
      b?: unknown;
    };

    if (
      isFiniteNumber(candidate.r) &&
      isFiniteNumber(candidate.g) &&
      isFiniteNumber(candidate.b)
    ) {
      return `#${[
        candidate.r,
        candidate.g,
        candidate.b,
      ]
        .map((channel) => byteToHex(colorChannel(channel)))
        .join("")}`;
    }
  }

  return null;
}

function resolveColor(
  item: RuntimeTextItem,
  style: RuntimeTextStyle,
): string | null {
  return (
    cssColor(item.color) ??
    cssColor(item.fillColor) ??
    cssColor(style.color) ??
    cssColor(style.fillColor)
  );
}

function fontMetrics(style: RuntimeTextStyle): {
  ascent: number;
  descent: number;
} {
  let ascent = isFiniteNumber(style.ascent)
    ? style.ascent
    : undefined;
  let descent = isFiniteNumber(style.descent)
    ? style.descent
    : undefined;

  if (ascent === undefined && descent !== undefined) {
    ascent = 1 + descent;
  }
  if (descent === undefined && ascent !== undefined) {
    descent = ascent - 1;
  }

  if (ascent === undefined || descent === undefined) {
    ascent = DEFAULT_ASCENT;
    descent = DEFAULT_DESCENT;
  }

  return {
    ascent: Math.max(0, ascent),
    descent: Math.min(0, descent),
  };
}

function fontStyleFlags(style: RuntimeTextStyle): {
  bold: boolean;
  italic: boolean;
} {
  const weight = String(style.fontWeight ?? "").toLowerCase();
  const fontStyle = String(style.fontStyle ?? "").toLowerCase();
  return {
    bold:
      style.bold === true ||
      style.black === true ||
      weight === "bold" ||
      Number(weight) >= 600,
    italic:
      style.italic === true ||
      fontStyle === "italic" ||
      fontStyle === "oblique",
  };
}

function missingGeometryFragment(
  item: RuntimeTextItem,
  options: Required<
    Pick<
      MapPdfTextContentOptions,
      "documentId" | "pageIndex"
    >
  >,
  itemIndex: number,
  occurrence: number,
  style: RuntimeTextStyle,
  markedContentIds: string[],
): ExtractedPdfTextFragment {
  const fontName =
    typeof item.fontName === "string" ? item.fontName : "";
  const fontFamily =
    typeof style.fontFamily === "string" && style.fontFamily.trim()
      ? style.fontFamily
      : fontName;
  const fontStyle = fontStyleFlags(style);
  const resolvedFontName =
    typeof style.resolvedFontName === "string" &&
    style.resolvedFontName.trim()
      ? style.resolvedFontName
      : undefined;

  return {
    id: stableFragmentId(
      options.documentId,
      options.pageIndex,
      item,
      occurrence,
    ),
    pageIndex: options.pageIndex,
    itemIndex,
    text: item.str,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    baseline: null,
    quad: null,
    rotation: null,
    fontName,
    fontFamily,
    resolvedFontName,
    bold: fontStyle.bold,
    italic: fontStyle.italic,
    fontSize: null,
    fontSizeNormalized: null,
    color: resolveColor(item, style),
    direction:
      typeof item.dir === "string" ? item.dir : "ltr",
    vertical: style.vertical === true,
    hasEOL: item.hasEOL === true,
    hasGeometry: false,
    markedContentIds: [...markedContentIds],
  };
}

function mapTextItem(
  item: RuntimeTextItem,
  itemIndex: number,
  occurrence: number,
  style: RuntimeTextStyle,
  viewport: PdfTextViewportLike,
  viewportTransform: Matrix,
  viewportScale: number,
  documentId: string,
  pageIndex: number,
  activeMarkedContentIds: string[],
): ExtractedPdfTextFragment {
  const textTransform = toMatrix(item.transform);
  if (!textTransform) {
    return missingGeometryFragment(
      item,
      { documentId, pageIndex },
      itemIndex,
      occurrence,
      style,
      activeMarkedContentIds,
    );
  }

  const transformed = multiplyMatrices(
    viewportTransform,
    textTransform,
  );
  let angle = Math.atan2(transformed[1], transformed[0]);
  const vertical = style.vertical === true;
  if (vertical) angle += Math.PI / 2;

  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
  const downwardNormal = {
    x: -direction.y,
    y: direction.x,
  };
  const baselineStart = {
    x: transformed[4],
    y: transformed[5],
  };

  const fontSize = Math.hypot(
    transformed[2],
    transformed[3],
  );
  const metrics = fontMetrics(style);
  const ascent = fontSize * metrics.ascent;
  const descent = fontSize * -metrics.descent;
  const rawAdvance = vertical ? item.height : item.width;
  const advance =
    isFiniteNumber(rawAdvance) && rawAdvance !== 0
      ? Math.abs(rawAdvance) * viewportScale
      : 0;

  const baselineEnd = {
    x: baselineStart.x + direction.x * advance,
    y: baselineStart.y + direction.y * advance,
  };
  const topLeft = {
    x: baselineStart.x - downwardNormal.x * ascent,
    y: baselineStart.y - downwardNormal.y * ascent,
  };
  const topRight = {
    x: baselineEnd.x - downwardNormal.x * ascent,
    y: baselineEnd.y - downwardNormal.y * ascent,
  };
  const bottomLeft = {
    x: baselineStart.x + downwardNormal.x * descent,
    y: baselineStart.y + downwardNormal.y * descent,
  };
  const bottomRight = {
    x: baselineEnd.x + downwardNormal.x * descent,
    y: baselineEnd.y + downwardNormal.y * descent,
  };
  const corners = [topLeft, topRight, bottomRight, bottomLeft];
  const minimumX = Math.min(...corners.map((point) => point.x));
  const minimumY = Math.min(...corners.map((point) => point.y));
  const maximumX = Math.max(...corners.map((point) => point.x));
  const maximumY = Math.max(...corners.map((point) => point.y));
  const clippedLeft = clamp(minimumX, 0, viewport.width);
  const clippedTop = clamp(minimumY, 0, viewport.height);
  const clippedRight = clamp(maximumX, 0, viewport.width);
  const clippedBottom = clamp(maximumY, 0, viewport.height);
  const fontName =
    typeof item.fontName === "string" ? item.fontName : "";
  const fontFamily =
    typeof style.fontFamily === "string" && style.fontFamily.trim()
      ? style.fontFamily
      : fontName;
  const fontStyle = fontStyleFlags(style);
  const resolvedFontName =
    typeof style.resolvedFontName === "string" &&
    style.resolvedFontName.trim()
      ? style.resolvedFontName
      : undefined;

  return {
    id: stableFragmentId(
      documentId,
      pageIndex,
      item,
      occurrence,
    ),
    pageIndex,
    itemIndex,
    text: item.str,
    x: clippedLeft / viewport.width,
    y: clippedTop / viewport.height,
    width:
      Math.max(0, clippedRight - clippedLeft) / viewport.width,
    height:
      Math.max(0, clippedBottom - clippedTop) / viewport.height,
    baseline: {
      start: normalizedPoint(
        baselineStart,
        viewport.width,
        viewport.height,
      ),
      end: normalizedPoint(
        baselineEnd,
        viewport.width,
        viewport.height,
      ),
    },
    quad: {
      topLeft: normalizedPoint(
        topLeft,
        viewport.width,
        viewport.height,
      ),
      topRight: normalizedPoint(
        topRight,
        viewport.width,
        viewport.height,
      ),
      bottomRight: normalizedPoint(
        bottomRight,
        viewport.width,
        viewport.height,
      ),
      bottomLeft: normalizedPoint(
        bottomLeft,
        viewport.width,
        viewport.height,
      ),
    },
    rotation: normalizedDegrees(angle),
    fontName,
    fontFamily,
    resolvedFontName,
    bold: fontStyle.bold,
    italic: fontStyle.italic,
    fontSize,
    fontSizeNormalized: fontSize / viewport.height,
    color: resolveColor(item, style),
    direction:
      typeof item.dir === "string" ? item.dir : "ltr",
    vertical,
    hasEOL: item.hasEOL === true,
    hasGeometry: true,
    markedContentIds: [...activeMarkedContentIds],
  };
}

/**
 * Converts already-loaded PDF.js TextContent into clickable text fragments.
 * This pure mapping function is useful when callers cache TextContent.
 */
export function mapPdfTextContent(
  textContent: PdfJsTextContentLike,
  viewport: PdfTextViewportLike,
  options: MapPdfTextContentOptions,
): ExtractedPdfTextPage {
  if (
    !Number.isInteger(options.pageIndex) ||
    options.pageIndex < 0
  ) {
    throw new RangeError("pageIndex must be a non-negative integer.");
  }
  assertTextContentWithinLimits(textContentStats(textContent.items));
  if (
    !isFiniteNumber(viewport.width) ||
    viewport.width <= 0 ||
    !isFiniteNumber(viewport.height) ||
    viewport.height <= 0
  ) {
    throw new Error("The PDF.js viewport has invalid dimensions.");
  }

  const viewportTransform = toMatrix(viewport.transform);
  if (!viewportTransform) {
    throw new Error("The PDF.js viewport has an invalid transform.");
  }

  // PageViewport is uniformly scaled (also when rotated), so either basis
  // vector yields the factor needed for TextItem.width/TextItem.height.
  const viewportScale =
    Math.hypot(viewportTransform[0], viewportTransform[1]) ||
    Math.hypot(viewportTransform[2], viewportTransform[3]) ||
    1;
  const includeEmpty = options.includeEmpty === true;
  const documentId = options.documentId?.trim() || "document";
  const activeMarkedContent: Array<string | null> = [];
  const signatureOccurrences = new Map<string, number>();
  const fragments: ExtractedPdfTextFragment[] = [];

  textContent.items.forEach((contentItem, itemIndex) => {
    if (!isRuntimeTextItem(contentItem)) {
      if (isMarkedContentStart(contentItem)) {
        activeMarkedContent.push(markedContentId(contentItem));
      } else if (
        contentItem.type === "endMarkedContent" &&
        activeMarkedContent.length > 0
      ) {
        activeMarkedContent.pop();
      }
      return;
    }

    const item = contentItem as RuntimeTextItem;
    if (!includeEmpty && item.str.length === 0) return;

    const fontName =
      typeof item.fontName === "string" ? item.fontName : "";
    const style =
      (textContent.styles[fontName] as RuntimeTextStyle | undefined) ??
      {};
    const signature = textItemSignature(item);
    const occurrence = signatureOccurrences.get(signature) ?? 0;
    signatureOccurrences.set(signature, occurrence + 1);
    const markedContentIds = activeMarkedContent.filter(
      (id): id is string => id !== null,
    );

    fragments.push(
      mapTextItem(
        item,
        itemIndex,
        occurrence,
        style,
        viewport,
        viewportTransform,
        viewportScale,
        documentId,
        options.pageIndex,
        markedContentIds,
      ),
    );
  });

  return {
    pageIndex: options.pageIndex,
    pageNumber: options.pageNumber ?? options.pageIndex + 1,
    width: viewport.width,
    height: viewport.height,
    sourceRotation: normalizePdfTextRotation(
      options.sourceRotation,
    ),
    rotation: normalizePdfTextRotation(
      options.rotation ?? options.sourceRotation,
    ),
    language: textContent.lang ?? null,
    fragments,
  };
}

/**
 * Extracts one PDF.js page. `rotation` is the absolute clockwise rotation of
 * the displayed page, not an increment relative to PDFPageProxy.rotate.
 */
async function readLimitedTextContent(
  page: PDFPageProxy,
  options: Pick<
    ExtractPdfPageTextOptions,
    "disableNormalization" | "signal"
  >,
): Promise<{
  textContent: PdfJsTextContentLike;
  stats: PdfTextContentStats;
}> {
  if (typeof page.streamTextContent !== "function") {
    const textContent = (await page.getTextContent({
      includeMarkedContent: true,
      disableNormalization:
        options.disableNormalization ?? false,
    })) as PdfJsTextContentLike;
    throwIfAborted(options.signal);
    const stats = textContentStats(textContent.items);
    assertTextContentWithinLimits(stats);
    return { textContent, stats };
  }

  const stream = page.streamTextContent({
    includeMarkedContent: true,
    disableNormalization: options.disableNormalization ?? false,
  });
  const reader = stream.getReader();
  const textContent: PdfJsTextContentLike = {
    items: [],
    styles: Object.create(null) as Record<
      string,
      PdfJsTextStyleLike
    >,
    lang: null,
  };
  const stats: PdfTextContentStats = {
    itemCount: 0,
    characterCount: 0,
  };
  let completed = false;
  const onAbort = () => {
    void reader.cancel(abortError()).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      throwIfAborted(options.signal);
      const result = await reader.read();
      throwIfAborted(options.signal);
      if (result.done) {
        completed = true;
        break;
      }

      const chunk = result.value as Partial<PdfJsTextContentLike>;
      const chunkItems = Array.isArray(chunk.items)
        ? chunk.items
        : [];
      const chunkStats = textContentStats(chunkItems);
      stats.itemCount += chunkStats.itemCount;
      stats.characterCount += chunkStats.characterCount;
      assertTextContentWithinLimits(stats);

      textContent.items.push(...chunkItems);
      if (
        typeof chunk.styles === "object" &&
        chunk.styles !== null
      ) {
        Object.assign(textContent.styles, chunk.styles);
      }
      if (textContent.lang === null && typeof chunk.lang === "string") {
        textContent.lang = chunk.lang;
      }
    }
  } catch (error) {
    if (!completed) {
      await reader.cancel(error).catch(() => undefined);
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  return { textContent, stats };
}

async function extractPdfPageTextWithStats(
  page: PDFPageProxy,
  options: ExtractPdfPageTextOptions,
): Promise<{
  page: ExtractedPdfTextPage;
  stats: PdfTextContentStats;
}> {
  throwIfAborted(options.signal);

  const pageIndex = options.pageIndex;
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError("pageIndex must be a non-negative integer.");
  }

  const sourceRotation = normalizePdfTextRotation(page.rotate);
  const rotation = normalizePdfTextRotation(
    options.rotation ?? sourceRotation,
  );
  const viewport = page.getViewport({
    scale: 1,
    rotation,
  });
  const { textContent, stats } = await readLimitedTextContent(
    page,
    options,
  );

  const fontNames = new Set<string>();
  for (const item of textContent.items) {
    if (isRuntimeTextItem(item) && typeof item.fontName === "string") {
      fontNames.add(item.fontName);
    }
  }
  if (
    page.commonObjs &&
    [...fontNames].some((fontName) => !page.commonObjs.has(fontName))
  ) {
    try {
      // PDF.js resolves its FontFaceObject metadata while building the display
      // operator list. The same list is required to paint the editor preview,
      // and it supplies the bold/italic flags omitted from TextContent styles.
      await page.getOperatorList();
    } catch {
      // Text remains editable with conservative regular-style defaults.
    }
  }
  throwIfAborted(options.signal);

  const visitedFonts = new Set<string>();
  for (const item of textContent.items) {
    if (!isRuntimeTextItem(item) || typeof item.fontName !== "string") {
      continue;
    }
    const fontName = item.fontName;
    if (visitedFonts.has(fontName)) continue;
    visitedFonts.add(fontName);
    try {
      if (!page.commonObjs?.has(fontName)) continue;
      const resolved: unknown = page.commonObjs.get(fontName);
      if (!resolved || typeof resolved !== "object") continue;
      const font = resolved as {
        black?: unknown;
        bold?: unknown;
        italic?: unknown;
        name?: unknown;
      };
      textContent.styles[fontName] = {
        ...textContent.styles[fontName],
        black: font.black === true,
        bold: font.bold === true,
        italic: font.italic === true,
        resolvedFontName:
          typeof font.name === "string" ? font.name : undefined,
      };
    } catch {
      // Text geometry remains usable when PDF.js does not expose font internals.
    }
  }

  throwIfAborted(options.signal);

  return {
    page: mapPdfTextContent(textContent, viewport, {
      pageIndex,
      pageNumber: page.pageNumber,
      sourceRotation,
      rotation,
      documentId: options.documentId,
      includeEmpty: options.includeEmpty,
    }),
    stats,
  };
}

export async function extractPdfPageText(
  page: PDFPageProxy,
  options: ExtractPdfPageTextOptions,
): Promise<ExtractedPdfTextPage> {
  const result = await extractPdfPageTextWithStats(page, options);
  return result.page;
}

function resolveDocumentId(
  document: PdfPreviewDocument,
  suppliedId: string | undefined,
): string {
  const explicit = suppliedId?.trim();
  if (explicit) return explicit;

  const fingerprint = document.fingerprints.find(
    (value): value is string =>
      typeof value === "string" && value.length > 0,
  );
  return fingerprint ?? "document";
}

function resolvePageIndexes(
  document: PdfPreviewDocument,
  requested: Iterable<number> | undefined,
): number[] {
  const uniqueIndexes: number[] = [];
  const seen = new Set<number>();
  let requestedEntryCount = 0;

  const append = (pageIndex: number) => {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= document.numPages
    ) {
      throw new RangeError(
        `Page index ${String(pageIndex)} is outside this document.`,
      );
    }

    if (!seen.has(pageIndex)) {
      seen.add(pageIndex);
      uniqueIndexes.push(pageIndex);
      const issue = getPageCountLimitIssue(uniqueIndexes.length);
      if (issue) {
        const error = new Error(
          describePdfSecurityLimitIssue(issue),
        );
        error.name = "PdfSecurityLimitError";
        throw error;
      }
    }
  };

  if (requested) {
    for (const pageIndex of requested) {
      requestedEntryCount += 1;
      const issue = getPageCountLimitIssue(requestedEntryCount);
      if (issue) {
        const error = new Error(
          describePdfSecurityLimitIssue(issue),
        );
        error.name = "PdfSecurityLimitError";
        throw error;
      }
      append(pageIndex);
    }
  } else {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      append(pageIndex);
    }
  }

  return uniqueIndexes;
}

function resolvePageRotation(
  resolver: PdfTextRotationResolver | undefined,
  pageIndex: number,
  sourceRotation: PdfQuarterTurn,
): PdfQuarterTurn {
  if (resolver === undefined) return sourceRotation;

  if (typeof resolver === "number") {
    return normalizePdfTextRotation(resolver);
  }
  if (typeof resolver === "function") {
    return normalizePdfTextRotation(
      resolver(pageIndex, sourceRotation),
    );
  }
  if ("get" in resolver && typeof resolver.get === "function") {
    return normalizePdfTextRotation(
      resolver.get(pageIndex) ?? sourceRotation,
    );
  }

  return normalizePdfTextRotation(
    (resolver as Readonly<Record<number, number>>)[pageIndex] ??
      sourceRotation,
  );
}

/**
 * Extracts text from a PdfPreviewDocument in deterministic page order.
 */
export async function extractPdfText(
  document: PdfPreviewDocument,
  options: ExtractPdfTextOptions = {},
): Promise<ExtractedPdfTextDocument> {
  throwIfAborted(options.signal);

  const documentId = resolveDocumentId(
    document,
    options.documentId,
  );
  const documentPageLimitIssue =
    options.pageIndexes === undefined
      ? getPageCountLimitIssue(document.numPages)
      : null;
  if (documentPageLimitIssue) {
    const error = new Error(
      describePdfSecurityLimitIssue(documentPageLimitIssue),
    );
    error.name = "PdfSecurityLimitError";
    throw error;
  }
  const pageIndexes = resolvePageIndexes(
    document,
    options.pageIndexes,
  );
  const pageLimitIssue = getPageCountLimitIssue(pageIndexes.length);
  if (pageLimitIssue) {
    const error = new Error(
      describePdfSecurityLimitIssue(pageLimitIssue),
    );
    error.name = "PdfSecurityLimitError";
    throw error;
  }
  const pages: ExtractedPdfTextPage[] = [];
  const documentStats: PdfTextContentStats = {
    itemCount: 0,
    characterCount: 0,
  };

  for (const pageIndex of pageIndexes) {
    throwIfAborted(options.signal);
    const page = await document.getPage(pageIndex + 1);
    try {
      const sourceRotation = normalizePdfTextRotation(page.rotate);
      const rotation = resolvePageRotation(
        options.rotation,
        pageIndex,
        sourceRotation,
      );
      const result = await extractPdfPageTextWithStats(page, {
        pageIndex,
        rotation,
        documentId,
        includeEmpty: options.includeEmpty,
        disableNormalization: options.disableNormalization,
        signal: options.signal,
      });
      documentStats.itemCount += result.stats.itemCount;
      documentStats.characterCount += result.stats.characterCount;
      assertTextContentWithinLimits(documentStats, "document");
      pages.push(result.page);
    } finally {
      try {
        page.cleanup();
      } catch {
        // A destroyed PDF.js document may have released the page already.
      }
    }
  }

  return {
    documentId,
    pageCount: document.numPages,
    pages,
  };
}
