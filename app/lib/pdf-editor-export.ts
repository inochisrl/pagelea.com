import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  TextRenderingMode,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  type PDFFont,
  type PDFImage,
  type PDFObject,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { Inflate } from "pako";

import { throwIfAborted } from "./abort";
import {
  pageDisplaySize,
  type EditorFontFamily,
  type EditorElement,
  type EditorPage,
  type ImageEditorElement,
  type PathEditorElement,
  type Point,
  type RectEditorElement,
  type TextEditorElement,
} from "./pdf-editor-types";
import {
  PdfEditorFontError,
  createPdfEditorFontEmbedder,
  planPdfEditorFontRuns,
  type PdfEditorFontAssetLoader,
} from "./pdf-editor-fonts";
import {
  assertPdfPageGraphWithinLimits,
  assertPdfPageTreeWithinLimits,
} from "./pdf-object-graph-security";
import {
  disposePdfPreview,
  loadPdfPreview,
  type PdfPreviewDocument,
} from "./pdf-preview";
import {
  describePdfSecurityLimitIssue,
  getEditorRasterBudgetLimitIssue,
  getEditorRasterMinimumScaleLimitIssue,
  getEditorSnapshotLimitIssue,
  getFileLimitIssue,
  getImageDimensionLimitIssue,
  getImageInfoFromBytes,
  getPageCountLimitIssue,
  getTextFieldLimitIssue,
  PDF_SECURITY_LIMITS,
  type EditorRasterBudget,
  type PdfSecurityLimitIssue,
} from "./pdf-security-limits";

export interface ExportEditedPdfInput {
  sourceBytes: Uint8Array | null;
  pages: EditorPage[];
  elements: EditorElement[];
  filename: string;
  nativeTextEvidence?: NativeTextRewritePageEvidence[];
  /** Test/SSR injection; browsers load only the fixed same-origin allowlist. */
  fontAssetLoader?: PdfEditorFontAssetLoader;
  onProgress?: (value: number, label: string) => void;
  signal?: AbortSignal;
}

export interface NativeTextRewriteFragmentEvidence {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  hasGeometry: boolean;
}

export interface NativeTextRewritePageEvidence {
  pageId: string;
  sourcePageIndex: number;
  fragments: NativeTextRewriteFragmentEvidence[];
}

export interface ExportEditedPdfResult {
  blob: Blob;
  filename: string;
}

type StandardEditorFontFamily = "Helvetica" | "Times" | "Courier";

interface PreparedPdfTextRun {
  direction: "ltr" | "rtl";
  font: PDFFont;
  syntheticBold: boolean;
  syntheticItalic: boolean;
  text: string;
}

interface ExportFontManager {
  dispose(): void;
  prepareRuns(
    element: TextEditorElement,
    text: string,
  ): Promise<readonly PreparedPdfTextRun[]>;
}

interface PageDrawingTransform {
  /** Unrotated CropBox dimensions in PDF user-space points. */
  baseWidth: number;
  baseHeight: number;
  cropX: number;
  cropY: number;
  /** The page's effective clockwise /Rotate value. */
  pageRotation: 0 | 90 | 180 | 270;
  /** Dimensions seen in PDF.js and by the visual editor. */
  visualWidth: number;
  visualHeight: number;
}

interface VisualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RasterizedSourcePage {
  bytes: Uint8Array;
  canvasPixelCount: number;
  width: number;
  height: number;
}

interface PdfContentStringToken {
  end: number;
  kind: "hex-string" | "literal-string";
  start: number;
  text: string;
}

interface PdfContentToken {
  end: number;
  kind:
    | "array"
    | "dictionary"
    | "hex-string"
    | "literal-string"
    | "name"
    | "number"
    | "scalar";
  start: number;
  stringTokens: PdfContentStringToken[];
  name?: string;
  text?: string;
}

interface PdfTextShowOperation {
  stringTokens: PdfContentStringToken[];
  text: string | null;
}

interface PdfTextBlock {
  showOperations: PdfTextShowOperation[];
}

interface ParsedPdfContent {
  textBlocks: PdfTextBlock[];
}

interface NormalizedPdfTextOperation {
  operation: PdfTextShowOperation;
  text: string;
}

interface PdfContentParseBudget {
  exhausted: boolean;
  tokens: number;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MAX_VECTOR_TEXT_REWRITE_CONTENT_BYTES = 16 * 1024 * 1024;
const MAX_VECTOR_TEXT_REWRITE_CONTENT_STREAMS = 256;
const VECTOR_TEXT_REWRITE_INFLATE_CHUNK_BYTES = 64 * 1024;
const MAX_VECTOR_TEXT_REWRITE_STRING_BYTES = 512 * 1024;
const MAX_VECTOR_TEXT_REWRITE_TOKENS = 50_000;
const MAX_VECTOR_TEXT_REWRITE_NESTING = 64;
const MAX_VECTOR_TEXT_REWRITE_TEXT_BLOCKS = 10_000;
const MAX_VECTOR_TEXT_REWRITE_SHOW_OPERATIONS = 25_000;
const MAX_VECTOR_TEXT_REWRITE_OPERANDS = 4_096;
const MAX_VECTOR_TEXT_REWRITE_SEARCH_WORK = 32 * 1024 * 1024;
const MAX_VECTOR_TEXT_REWRITE_EVIDENCE_COMPARISONS = 5_000_000;
const NORMALIZED_GEOMETRY_EPSILON = 0.000_001;
const SAFE_VECTOR_CONTENT_STREAM_KEYS = new Set([
  "Filter",
  "Length",
]);
const VERIFIED_VECTOR_BASE_FONTS = new Set([
  "Courier",
  "Courier-Bold",
  "Courier-BoldOblique",
  "Courier-Oblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-BoldOblique",
  "Helvetica-Oblique",
  "Times-Bold",
  "Times-BoldItalic",
  "Times-Italic",
  "Times-Roman",
]);

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function quarterTurn(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

function safeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeOpacity(value: number): number {
  return clamp(value, 0, 1);
}

function sanitizeFilename(value: string): string {
  const withoutExtension = value.trim().replace(/(?:\.pdf)+$/i, "");
  const cleaned = withoutExtension
    // Deliberately strip ASCII controls from the download filename.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 116);

  return `${cleaned || "edited-document"}.pdf`;
}

function copyBytes(
  bytes: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isPdfWhitespace(value: number): boolean {
  return (
    value === 0x00 ||
    value === 0x09 ||
    value === 0x0a ||
    value === 0x0c ||
    value === 0x0d ||
    value === 0x20
  );
}

function isPdfDelimiter(value: number): boolean {
  return (
    value === 0x25 ||
    value === 0x28 ||
    value === 0x29 ||
    value === 0x2f ||
    value === 0x3c ||
    value === 0x3e ||
    value === 0x5b ||
    value === 0x5d ||
    value === 0x7b ||
    value === 0x7d
  );
}

function isHexDigit(value: number): boolean {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66)
  );
}

function hexValue(value: number): number {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  if (value >= 0x41 && value <= 0x46) return value - 0x41 + 10;
  return value - 0x61 + 10;
}

function decodeSingleBytePdfText(
  bytes: readonly number[],
): string | null {
  let result = "";
  for (const value of bytes) {
    /*
     * PDF.js applies font-specific substitutions and whitespace handling to
     * non-printable/extended WinAnsi bytes. The local parser must never guess
     * at those semantics when deciding which searchable glyphs to remove.
     */
    if (value < 0x20 || value > 0x7e) return null;
    result += String.fromCharCode(value);
  }
  return result;
}

// PDF.js can suppress control/format bytes while combining text items.
const VECTOR_IGNORABLE_TEXT_PATTERN = new RegExp(
  "[\\s\\u0000-\\u001f\\u007f-\\u009f\\u00ad" +
    "\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]+",
  "gu",
);

function normalizeVectorSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(VECTOR_IGNORABLE_TEXT_PATTERN, "");
}

function asciiCaseFoldCode(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

function asciiCaseFoldText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    result += String.fromCharCode(
      asciiCaseFoldCode(value.charCodeAt(index)),
    );
  }
  return result;
}

function containsEquivalentTextSequence(
  target: string,
  texts: readonly string[],
): boolean {
  const foldedTarget = asciiCaseFoldText(target);
  if (!foldedTarget) return true;

  const boundaries = new Set<number>([0]);
  const foldedTexts: string[] = [];
  let combinedLength = 0;
  for (const text of texts) {
    const foldedText = asciiCaseFoldText(text);
    if (!foldedText) continue;
    foldedTexts.push(foldedText);
    combinedLength += foldedText.length;
    boundaries.add(combinedLength);
  }
  if (combinedLength < foldedTarget.length) return false;

  const combined = foldedTexts.join("");
  let match = combined.indexOf(foldedTarget);
  while (match !== -1) {
    if (
      boundaries.has(match) &&
      boundaries.has(match + foldedTarget.length)
    ) {
      return true;
    }
    match = combined.indexOf(foldedTarget, match + 1);
  }
  return false;
}

function skipPdfWhitespaceAndComments(
  bytes: Uint8Array,
  start: number,
): number {
  let index = start;
  while (index < bytes.length) {
    if (isPdfWhitespace(bytes[index])) {
      index += 1;
      continue;
    }
    if (bytes[index] !== 0x25) break;
    index += 1;
    while (
      index < bytes.length &&
      bytes[index] !== 0x0a &&
      bytes[index] !== 0x0d
    ) {
      index += 1;
    }
  }
  return index;
}

function readPdfLiteralString(
  bytes: Uint8Array,
  start: number,
): PdfContentToken | null {
  const decoded: number[] = [];
  const appendDecodedByte = (value: number): boolean => {
    if (
      decoded.length >= MAX_VECTOR_TEXT_REWRITE_STRING_BYTES
    ) {
      return false;
    }
    decoded.push(value);
    return true;
  };
  let depth = 1;
  let index = start + 1;

  while (index < bytes.length) {
    const value = bytes[index];
    if (value === 0x5c) {
      index += 1;
      if (index >= bytes.length) return null;
      const escaped = bytes[index];
      const simpleEscape: Record<number, number> = {
        0x62: 0x08,
        0x66: 0x0c,
        0x6e: 0x0a,
        0x72: 0x0d,
        0x74: 0x09,
      };
      if (escaped in simpleEscape) {
        if (!appendDecodedByte(simpleEscape[escaped])) return null;
        index += 1;
        continue;
      }
      if (escaped === 0x0a) {
        index += 1;
        continue;
      }
      if (escaped === 0x0d) {
        index += bytes[index + 1] === 0x0a ? 2 : 1;
        continue;
      }
      if (escaped >= 0x30 && escaped <= 0x37) {
        let octal = escaped - 0x30;
        let digits = 1;
        index += 1;
        while (
          digits < 3 &&
          index < bytes.length &&
          bytes[index] >= 0x30 &&
          bytes[index] <= 0x37
        ) {
          octal = octal * 8 + bytes[index] - 0x30;
          digits += 1;
          index += 1;
        }
        if (!appendDecodedByte(octal & 0xff)) return null;
        continue;
      }
      if (!appendDecodedByte(escaped)) return null;
      index += 1;
      continue;
    }
    if (value === 0x28) {
      depth += 1;
      if (!appendDecodedByte(value)) return null;
      index += 1;
      continue;
    }
    if (value === 0x29) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        const text = decodeSingleBytePdfText(decoded);
        if (text === null) return null;
        const stringToken: PdfContentStringToken = {
          end: index,
          kind: "literal-string",
          start,
          text,
        };
        return {
          ...stringToken,
          stringTokens: [stringToken],
        };
      }
      if (!appendDecodedByte(value)) return null;
      continue;
    }
    if (!appendDecodedByte(value)) return null;
    index += 1;
  }

  return null;
}

function readPdfHexString(
  bytes: Uint8Array,
  start: number,
): PdfContentToken | null {
  const decoded: number[] = [];
  let highNibble: number | null = null;
  let index = start + 1;
  while (index < bytes.length && bytes[index] !== 0x3e) {
    const value = bytes[index];
    if (!isPdfWhitespace(value)) {
      if (!isHexDigit(value)) return null;
      const nibble = hexValue(value);
      if (highNibble === null) {
        highNibble = nibble;
      } else {
        if (
          decoded.length >=
          MAX_VECTOR_TEXT_REWRITE_STRING_BYTES
        ) {
          return null;
        }
        decoded.push((highNibble << 4) | nibble);
        highNibble = null;
      }
    }
    index += 1;
  }
  if (index >= bytes.length) return null;
  if (highNibble !== null) {
    if (
      decoded.length >= MAX_VECTOR_TEXT_REWRITE_STRING_BYTES
    ) {
      return null;
    }
    decoded.push(highNibble << 4);
  }
  const text = decodeSingleBytePdfText(decoded);
  if (text === null) return null;
  const stringToken: PdfContentStringToken = {
    end: index + 1,
    kind: "hex-string",
    start,
    text,
  };
  return {
    ...stringToken,
    stringTokens: [stringToken],
  };
}

function readPdfName(
  bytes: Uint8Array,
  start: number,
): PdfContentToken {
  let index = start + 1;
  while (
    index < bytes.length &&
    !isPdfWhitespace(bytes[index]) &&
    !isPdfDelimiter(bytes[index])
  ) {
    index += 1;
  }
  let name = "";
  for (let offset = start; offset < index; offset += 1) {
    name += String.fromCharCode(bytes[offset]);
  }
  return {
    end: index,
    kind: "name",
    name,
    start,
    stringTokens: [],
  };
}

function readPdfBareToken(
  bytes: Uint8Array,
  start: number,
): { end: number; value: string } {
  let index = start;
  while (
    index < bytes.length &&
    !isPdfWhitespace(bytes[index]) &&
    !isPdfDelimiter(bytes[index])
  ) {
    index += 1;
  }
  let value = "";
  for (let offset = start; offset < index; offset += 1) {
    value += String.fromCharCode(bytes[offset]);
  }
  return { end: index, value };
}

function isPdfNumber(value: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value);
}

function consumePdfContentToken(
  budget: PdfContentParseBudget,
): boolean {
  if (budget.tokens >= MAX_VECTOR_TEXT_REWRITE_TOKENS) {
    budget.exhausted = true;
    return false;
  }
  budget.tokens += 1;
  return true;
}

function readPdfCompositeToken(
  bytes: Uint8Array,
  start: number,
  budget: PdfContentParseBudget,
  depth = 0,
): PdfContentToken | null {
  if (depth > MAX_VECTOR_TEXT_REWRITE_NESTING) {
    budget.exhausted = true;
    return null;
  }
  if (!consumePdfContentToken(budget)) return null;

  const value = bytes[start];
  if (value === 0x28) return readPdfLiteralString(bytes, start);
  if (value === 0x3c && bytes[start + 1] !== 0x3c) {
    return readPdfHexString(bytes, start);
  }
  if (value === 0x2f) return readPdfName(bytes, start);

  if (value === 0x5b) {
    let index = start + 1;
    let nestedStringToken: PdfContentStringToken | undefined;
    while (index < bytes.length) {
      index = skipPdfWhitespaceAndComments(bytes, index);
      if (index >= bytes.length) return null;
      if (bytes[index] === 0x5d) {
        return {
          end: index + 1,
          kind: "array",
          start,
          stringTokens: nestedStringToken
            ? [nestedStringToken]
            : [],
        };
      }
      const item = readPdfCompositeToken(
        bytes,
        index,
        budget,
        depth + 1,
      );
      if (budget.exhausted) return null;
      if (item) {
        nestedStringToken ??= item.stringTokens[0];
        index = item.end;
        continue;
      }
      const bare = readPdfBareToken(bytes, index);
      if (bare.end === index) return null;
      index = bare.end;
    }
    return null;
  }

  if (value === 0x3c && bytes[start + 1] === 0x3c) {
    let dictionaryDepth = 1;
    let index = start + 2;
    let nestedStringToken: PdfContentStringToken | undefined;
    while (index < bytes.length) {
      index = skipPdfWhitespaceAndComments(bytes, index);
      if (index >= bytes.length) return null;
      if (bytes[index] === 0x3c && bytes[index + 1] === 0x3c) {
        dictionaryDepth += 1;
        if (
          depth + dictionaryDepth >
          MAX_VECTOR_TEXT_REWRITE_NESTING
        ) {
          budget.exhausted = true;
          return null;
        }
        index += 2;
        continue;
      }
      if (bytes[index] === 0x3e && bytes[index + 1] === 0x3e) {
        dictionaryDepth -= 1;
        index += 2;
        if (dictionaryDepth === 0) {
          return {
            end: index,
            kind: "dictionary",
            start,
            stringTokens: nestedStringToken
              ? [nestedStringToken]
              : [],
          };
        }
        continue;
      }
      const item = readPdfCompositeToken(
        bytes,
        index,
        budget,
        depth + 1,
      );
      if (budget.exhausted) return null;
      if (item) {
        nestedStringToken ??= item.stringTokens[0];
        index = item.end;
        continue;
      }
      const bare = readPdfBareToken(bytes, index);
      if (bare.end === index) return null;
      index = bare.end;
    }
    return null;
  }

  const bare = readPdfBareToken(bytes, start);
  if (bare.end === start) return null;
  const scalar =
    isPdfNumber(bare.value)
      ? "number"
      : bare.value === "true" ||
          bare.value === "false" ||
          bare.value === "null"
        ? "scalar"
        : null;
  return scalar
    ? {
        end: bare.end,
        kind: scalar,
        start,
        stringTokens: [],
      }
    : null;
}

function textShowOperation(
  operand: PdfContentToken,
): PdfTextShowOperation | null {
  if (
    operand.kind !== "literal-string" &&
    operand.kind !== "hex-string"
  ) {
    return null;
  }

  return {
    stringTokens: operand.stringTokens,
    text: operand.text ?? null,
  };
}

function parsePdfContent(
  bytes: Uint8Array,
  verifiedFontResourceNames: ReadonlySet<string>,
): ParsedPdfContent | null {
  const textBlocks: PdfTextBlock[] = [];
  const budget: PdfContentParseBudget = {
    exhausted: false,
    tokens: 0,
  };
  let currentBlock: PdfTextBlock | null = null;
  let currentFontResourceName: string | null = null;
  let operands: PdfContentToken[] = [];
  let showOperationCount = 0;
  let index = 0;

  while (index < bytes.length) {
    index = skipPdfWhitespaceAndComments(bytes, index);
    if (index >= bytes.length) break;

    const token = readPdfCompositeToken(bytes, index, budget);
    if (budget.exhausted) return null;
    if (token) {
      if (operands.length >= MAX_VECTOR_TEXT_REWRITE_OPERANDS) {
        return null;
      }
      operands.push(token);
      index = token.end;
      continue;
    }

    const bare = readPdfBareToken(bytes, index);
    if (bare.end === index) return null;
    index = bare.end;
    const operator = bare.value;
    const hasStringOperand = operands.some(
      (operand) => operand.stringTokens.length > 0,
    );

    if (
      isPdfNumber(operator) ||
      operator === "true" ||
      operator === "false" ||
      operator === "null"
    ) {
      if (operands.length >= MAX_VECTOR_TEXT_REWRITE_OPERANDS) {
        return null;
      }
      operands.push({
        end: bare.end,
        kind: isPdfNumber(operator) ? "number" : "scalar",
        start: index,
        stringTokens: [],
      });
      continue;
    }
    if (operator === "BI") {
      // Inline-image payloads can contain arbitrary operator-like bytes. The
      // safe path is to leave parsing to PDF.js and flatten the page.
      return null;
    }
    if (operator !== "Tj" && hasStringOperand) {
      // A string consumed by an unreviewed operator would remain recoverable
      // after the selected Tj is neutralized. Nested array/dictionary strings
      // are tracked as well, so malformed or extension operators fail closed.
      return null;
    }
    if (operator === "BMC" || operator === "BDC") {
      // Marked content can replace the glyphs' extracted or accessible text
      // through /ActualText (including an escaped /Actual#54ext name). Since
      // this conservative parser does not rewrite marked-content properties,
      // flatten the page instead of leaving hidden source text behind.
      return null;
    }
    if (operator === "BT") {
      if (
        currentBlock ||
        textBlocks.length >= MAX_VECTOR_TEXT_REWRITE_TEXT_BLOCKS
      ) {
        return null;
      }
      currentBlock = { showOperations: [] };
      currentFontResourceName = null;
      textBlocks.push(currentBlock);
    } else if (operator === "ET") {
      if (!currentBlock) return null;
      currentBlock = null;
      currentFontResourceName = null;
    } else if (operator === "Tf") {
      const fontName = operands.at(-2);
      const fontSize = operands.at(-1);
      if (
        !currentBlock ||
        operands.length !== 2 ||
        fontName?.kind !== "name" ||
        !fontName.name ||
        !verifiedFontResourceNames.has(fontName.name) ||
        fontSize?.kind !== "number"
      ) {
        return null;
      }
      currentFontResourceName = fontName.name;
    } else if (operator === "Tj") {
      if (
        !currentBlock ||
        currentFontResourceName === null ||
        operands.length !== 1 ||
        showOperationCount >=
          MAX_VECTOR_TEXT_REWRITE_SHOW_OPERATIONS
      ) {
        return null;
      }
      const operation = textShowOperation(operands[0]);
      if (!operation) return null;
      currentBlock.showOperations.push(operation);
      showOperationCount += 1;
    } else if (
      operator === "TJ" ||
      operator === "'" ||
      operator === '"' ||
      operator === "gs" ||
      (currentBlock !== null &&
        (operator === "q" || operator === "Q"))
    ) {
      /*
       * PDF.js may synthesize whitespace from TJ positioning adjustments and
       * from the quote operators' implicit line movement. ExtGState can also
       * replace the active font, while a graphics-state restore inside a text
       * object would require a complete state stack. Keep the vector path
       * limited to a locally verified Tf and one directly decoded string per
       * Tj operation.
       */
      return null;
    }
    operands = [];
  }

  return currentBlock || operands.length > 0
    ? null
    : { textBlocks };
}

function neutralizePdfString(
  bytes: Uint8Array,
  token: PdfContentStringToken,
): void {
  if (token.kind === "literal-string") {
    bytes.fill(0x20, token.start + 1, token.end - 1);
    return;
  }

  let nibbleIndex = 0;
  for (let index = token.start + 1; index < token.end - 1; index += 1) {
    if (!isHexDigit(bytes[index])) continue;
    bytes[index] = nibbleIndex % 2 === 0 ? 0x32 : 0x30;
    nibbleIndex += 1;
  }
}

function concatenateByteArrays(
  arrays: readonly Uint8Array[],
): Uint8Array {
  const total = arrays.reduce(
    (size, array) => size + array.byteLength,
    0,
  );
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  return result;
}

function sourcePageHasFormXObjects(page: PDFPage): boolean {
  const resources = page.node.Resources();
  if (!resources) return false;
  let xObjects: PDFDict | undefined;
  try {
    xObjects = resources.lookupMaybe(
      PDFName.of("XObject"),
      PDFDict,
    );
  } catch {
    return true;
  }
  if (!xObjects) return false;

  for (const rawObject of xObjects.values()) {
    try {
      const object = page.doc.context.lookup(rawObject, PDFStream);
      const subtype = object.dict.lookupMaybe(
        PDFName.of("Subtype"),
        PDFName,
      );
      if (subtype?.decodeText() === "Form") return true;
    } catch {
      // An unresolvable reusable object cannot be proven text-free.
      return true;
    }
  }
  return false;
}

function verifiedVectorFontResourceNames(
  page: PDFPage,
): Set<string> | null {
  const resources = page.node.Resources();
  if (!resources) return null;

  let fonts: PDFDict | undefined;
  try {
    fonts = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
  } catch {
    return null;
  }
  if (!fonts || fonts.entries().length === 0) return null;

  const verifiedNames = new Set<string>();
  for (const [fontResourceName, rawFont] of fonts.entries()) {
    try {
      const font = page.doc.context.lookup(rawFont);
      if (!(font instanceof PDFDict)) return null;
      const type = font.lookupMaybe(PDFName.of("Type"), PDFName);
      const subtype = font.lookupMaybe(
        PDFName.of("Subtype"),
        PDFName,
      );
      const baseFont = font.lookupMaybe(
        PDFName.of("BaseFont"),
        PDFName,
      );
      const encoding = font.lookupMaybe(
        PDFName.of("Encoding"),
        PDFName,
      );
      if (
        type?.decodeText() !== "Font" ||
        subtype?.decodeText() !== "Type1" ||
        !baseFont ||
        !VERIFIED_VECTOR_BASE_FONTS.has(baseFont.decodeText()) ||
        encoding?.decodeText() !== "WinAnsiEncoding" ||
        font.has(PDFName.of("ToUnicode")) ||
        font.has(PDFName.of("FontDescriptor")) ||
        font.has(PDFName.of("DescendantFonts")) ||
        font.has(PDFName.of("CharProcs")) ||
        font.has(PDFName.of("FontFile")) ||
        font.has(PDFName.of("FontFile2")) ||
        font.has(PDFName.of("FontFile3"))
      ) {
        return null;
      }
      verifiedNames.add(fontResourceName.toString());
    } catch {
      return null;
    }
  }

  return verifiedNames;
}

function contentStreamDictionaryIsSafe(
  stream: PDFStream,
): boolean {
  if (
    stream.dict
      .keys()
      .some(
        (key) =>
          !SAFE_VECTOR_CONTENT_STREAM_KEYS.has(key.decodeText()),
      )
  ) {
    return false;
  }

  const lengthKey = PDFName.of("Length");
  try {
    const length = stream.dict.lookup(lengthKey);
    if (length && !(length instanceof PDFNumber)) return false;
  } catch {
    return false;
  }

  const filterKey = PDFName.of("Filter");
  let filter: PDFObject | undefined;
  try {
    filter = stream.dict.lookup(filterKey);
  } catch {
    return false;
  }
  if (!filter) return true;

  if (filter instanceof PDFName) {
    return true;
  }
  if (filter instanceof PDFArray && filter.size() === 1) {
    try {
      filter.lookup(0, PDFName);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function rawContentStreamEncoding(
  stream: PDFRawStream,
): "flate" | "none" | null {
  const filterKey = PDFName.of("Filter");
  const filter = stream.dict.lookup(filterKey);
  if (!filter) return "none";

  let filterName: PDFName;
  if (filter instanceof PDFName) {
    filterName = filter;
  } else if (filter instanceof PDFArray) {
    filterName = filter.lookup(0, PDFName);
  } else {
    return null;
  }

  const name = filterName.decodeText();
  return name === "FlateDecode" || name === "Fl" ? "flate" : null;
}

function inflateWithinLimit(
  encoded: Uint8Array,
  maximumBytes: number,
): Uint8Array | null {
  if (maximumBytes < 0) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let exceeded = false;

  try {
    const inflator = new Inflate({
      chunkSize: VECTOR_TEXT_REWRITE_INFLATE_CHUNK_BYTES,
      // PDF /FlateDecode uses a zlib wrapper, not gzip autodetection.
      windowBits: 15,
    });
    inflator.onData = (chunk): void => {
      if (chunk.byteLength > maximumBytes - totalBytes) {
        exceeded = true;
        throw new Error("Decoded PDF content exceeds its memory budget.");
      }
      chunks.push(copyBytes(chunk));
      totalBytes += chunk.byteLength;
    };
    const succeeded = inflator.push(encoded, true);
    if (!succeeded || inflator.err !== 0 || exceeded) return null;
  } catch {
    return null;
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeRawContentStreamWithinLimit(
  stream: PDFRawStream,
  maximumBytes: number,
): Uint8Array | null {
  const encoding = rawContentStreamEncoding(stream);
  if (encoding === null) return null;
  const encoded = stream.getContents();
  if (encoding === "none") {
    return encoded.byteLength <= maximumBytes
      ? copyBytes(encoded)
      : null;
  }
  return inflateWithinLimit(encoded, maximumBytes);
}

function decodedPageContents(page: PDFPage): Uint8Array | null {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    if (
      contents.size() >
      MAX_VECTOR_TEXT_REWRITE_CONTENT_STREAMS
    ) {
      return null;
    }
    for (let index = 0; index < contents.size(); index += 1) {
      try {
        streams.push(contents.lookup(index, PDFStream));
      } catch {
        return null;
      }
    }
  } else if (contents instanceof PDFStream) {
    streams.push(contents);
  } else {
    return null;
  }

  const decoded: Uint8Array[] = [];
  let combinedBytes = 0;
  for (const stream of streams) {
    if (
      !contentStreamDictionaryIsSafe(stream) ||
      stream.getContentsSize() >
      MAX_VECTOR_TEXT_REWRITE_CONTENT_BYTES
    ) {
      return null;
    }
    try {
      const remainingBytes =
        MAX_VECTOR_TEXT_REWRITE_CONTENT_BYTES -
        combinedBytes;
      if (remainingBytes < 0) return null;
      const bytes =
        stream instanceof PDFRawStream
          ? decodeRawContentStreamWithinLimit(
              stream,
              remainingBytes,
            )
          : stream instanceof PDFContentStream
            ? stream.getUnencodedContents()
            : null;
      if (!bytes) return null;
      combinedBytes += bytes.byteLength;
      if (combinedBytes > MAX_VECTOR_TEXT_REWRITE_CONTENT_BYTES) {
        return null;
      }
      decoded.push(copyBytes(bytes));
    } catch {
      return null;
    }
  }
  return concatenateByteArrays(decoded);
}

interface NormalizedRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function hasValidNormalizedRectangle(
  rectangle: NormalizedRectangle,
): boolean {
  return (
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    Number.isFinite(rectangle.width) &&
    Number.isFinite(rectangle.height) &&
    rectangle.x >= 0 &&
    rectangle.y >= 0 &&
    rectangle.width > 0 &&
    rectangle.height > 0 &&
    rectangle.x + rectangle.width <=
      1 + NORMALIZED_GEOMETRY_EPSILON &&
    rectangle.y + rectangle.height <=
      1 + NORMALIZED_GEOMETRY_EPSILON
  );
}

function normalizedRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function isUnrotatedEvidence(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const rotation = normalizedRotation(value);
  return (
    rotation <= NORMALIZED_GEOMETRY_EPSILON ||
    360 - rotation <= NORMALIZED_GEOMETRY_EPSILON
  );
}

function hasValidNormalizedGeometry(
  fragment: NativeTextRewriteFragmentEvidence,
): boolean {
  return (
    fragment.hasGeometry &&
    hasValidNormalizedRectangle(fragment) &&
    isUnrotatedEvidence(fragment.rotation)
  );
}

function normalizedRectanglesMatch(
  first: NormalizedRectangle,
  second: NormalizedRectangle,
): boolean {
  return (
    Math.abs(first.x - second.x) <= NORMALIZED_GEOMETRY_EPSILON &&
    Math.abs(first.y - second.y) <= NORMALIZED_GEOMETRY_EPSILON &&
    Math.abs(first.width - second.width) <=
      NORMALIZED_GEOMETRY_EPSILON &&
    Math.abs(first.height - second.height) <=
      NORMALIZED_GEOMETRY_EPSILON
  );
}

function normalizedRectanglesOverlap(
  first: NormalizedRectangle,
  second: NormalizedRectangle,
): boolean {
  const overlapWidth =
    Math.min(first.x + first.width, second.x + second.width) -
    Math.max(first.x, second.x);
  const overlapHeight =
    Math.min(first.y + first.height, second.y + second.height) -
    Math.max(first.y, second.y);
  return (
    overlapWidth > NORMALIZED_GEOMETRY_EPSILON &&
    overlapHeight > NORMALIZED_GEOMETRY_EPSILON
  );
}

function incrementTextCount(
  counts: Map<string, number>,
  text: string,
): void {
  counts.set(text, (counts.get(text) ?? 0) + 1);
}

function textCountsMatch(
  evidenceCounts: ReadonlyMap<string, number>,
  operationCounts: ReadonlyMap<string, number>,
): boolean {
  if (evidenceCounts.size !== operationCounts.size) return false;
  for (const [text, count] of evidenceCounts) {
    if (operationCounts.get(text) !== count) return false;
  }
  return true;
}

function evidenceSupportsVectorRewrite(
  evidence: NativeTextRewritePageEvidence | undefined,
  edits: readonly TextEditorElement[],
  normalizedOperations: readonly NormalizedPdfTextOperation[],
): boolean {
  if (
    !evidence ||
    evidence.fragments.length >
      PDF_SECURITY_LIMITS.maxTextItemsPerPage ||
    evidence.fragments.length * edits.length >
      MAX_VECTOR_TEXT_REWRITE_EVIDENCE_COMPARISONS
  ) {
    return false;
  }

  let characterCount = 0;
  const evidenceById = new Map<
    string,
    NativeTextRewriteFragmentEvidence
  >();
  const searchableEvidence: NativeTextRewriteFragmentEvidence[] = [];
  const evidenceTextCounts = new Map<string, number>();
  for (const fragment of evidence.fragments) {
    if (
      !fragment.id ||
      evidenceById.has(fragment.id) ||
      typeof fragment.text !== "string"
    ) {
      return false;
    }
    characterCount += fragment.text.length;
    if (
      characterCount >
      PDF_SECURITY_LIMITS.maxTextCharactersPerPage
    ) {
      return false;
    }
    evidenceById.set(fragment.id, fragment);
    const normalizedText = normalizeVectorSearchText(fragment.text);
    if (normalizedText) {
      searchableEvidence.push(fragment);
      incrementTextCount(evidenceTextCounts, normalizedText);
    }
  }
  const operationTextCounts = new Map<string, number>();
  for (const operation of normalizedOperations) {
    incrementTextCount(operationTextCounts, operation.text);
  }
  if (
    searchableEvidence.length !== normalizedOperations.length ||
    !textCountsMatch(evidenceTextCounts, operationTextCounts)
  ) {
    return false;
  }

  const selectedIds = new Set<string>();
  const sourceRects: NormalizedRectangle[] = [];
  const normalizedTargets: string[] = [];
  for (const edit of edits) {
    const source = edit.sourceText;
    if (
      source?.kind !== "native" ||
      selectedIds.has(source.id)
    ) {
      return false;
    }
    const selectedEvidence = evidenceById.get(source.id);
    if (
      !selectedEvidence ||
      selectedEvidence.text !== source.originalText ||
      !hasValidNormalizedGeometry(selectedEvidence) ||
      !hasValidNormalizedRectangle({
        x: source.originalX,
        y: source.originalY,
        width: source.originalWidth,
        height: source.originalHeight,
      }) ||
      !isUnrotatedEvidence(source.originalRotation) ||
      !normalizedRectanglesMatch(selectedEvidence, {
        x: source.originalX,
        y: source.originalY,
        width: source.originalWidth,
        height: source.originalHeight,
      })
    ) {
      return false;
    }
    selectedIds.add(source.id);
    normalizedTargets.push(
      normalizeVectorSearchText(source.originalText),
    );
    sourceRects.push({
      x: source.originalX,
      y: source.originalY,
      width: source.originalWidth,
      height: source.originalHeight,
    });
  }

  const unselectedEvidenceTexts = searchableEvidence.flatMap(
    (fragment) =>
      selectedIds.has(fragment.id)
        ? []
        : [normalizeVectorSearchText(fragment.text)],
  );
  if (
    normalizedTargets.some((target) =>
      containsEquivalentTextSequence(
        target,
        unselectedEvidenceTexts,
      ),
    )
  ) {
    return false;
  }

  for (const fragment of searchableEvidence) {
    if (selectedIds.has(fragment.id)) continue;
    if (!hasValidNormalizedGeometry(fragment)) return false;
    if (
      sourceRects.some((sourceRect) =>
        normalizedRectanglesOverlap(fragment, sourceRect),
      )
    ) {
      return false;
    }
  }
  return true;
}

function unselectedTextContainsEquivalentTarget(
  target: string,
  operations: readonly NormalizedPdfTextOperation[],
  selected: ReadonlySet<PdfTextShowOperation>,
): boolean {
  return containsEquivalentTextSequence(
    target,
    operations.flatMap(({ operation, text }) =>
      selected.has(operation) ? [] : [text],
    ),
  );
}

function rewrittenSourcePageContents(
  sourcePage: PDFPage,
  edits: readonly TextEditorElement[],
  evidence: NativeTextRewritePageEvidence | undefined,
): Uint8Array | null {
  if (edits.some((edit) => edit.sourceText?.kind !== "native")) {
    return null;
  }
  if (sourcePageHasFormXObjects(sourcePage)) return null;
  if (!sourcePageContentIsExclusivelyOwned(sourcePage)) return null;
  const verifiedFontNames =
    verifiedVectorFontResourceNames(sourcePage);
  if (!verifiedFontNames) return null;
  const contents = decodedPageContents(sourcePage);
  if (!contents?.byteLength) return null;
  let parsed: ParsedPdfContent | null;
  try {
    parsed = parsePdfContent(contents, verifiedFontNames);
  } catch {
    return null;
  }
  if (!parsed) return null;

  const operationsByText = new Map<
    string,
    { count: number; operation: PdfTextShowOperation }
  >();
  const normalizedOperations: NormalizedPdfTextOperation[] = [];
  let normalizedCharacterCount = 0;
  for (const block of parsed.textBlocks) {
    if (block.showOperations.length > 1) return null;
    for (const operation of block.showOperations) {
      if (
        operation.text === null ||
        operation.stringTokens.length === 0
      ) {
        return null;
      }
      const normalizedText = normalizeVectorSearchText(
        operation.text,
      );
      if (normalizedText) {
        normalizedOperations.push({
          operation,
          text: normalizedText,
        });
        normalizedCharacterCount += normalizedText.length;
      }
      const existing = operationsByText.get(operation.text);
      if (existing) {
        existing.count += 1;
      } else {
        operationsByText.set(operation.text, {
          count: 1,
          operation,
        });
      }
    }
  }
  if (
    edits.length < 1 ||
    normalizedCharacterCount >
      Math.floor(
        MAX_VECTOR_TEXT_REWRITE_SEARCH_WORK / edits.length,
      )
  ) {
    return null;
  }
  const selected = new Set<PdfTextShowOperation>();
  const normalizedOriginals: string[] = [];
  for (const edit of edits) {
    const originalText = edit.sourceText?.originalText;
    if (!originalText) return null;
    const normalizedOriginal = normalizeVectorSearchText(originalText);
    const match = operationsByText.get(originalText);
    if (
      !normalizedOriginal ||
      match?.count !== 1 ||
      selected.has(match.operation)
    ) {
      return null;
    }
    selected.add(match.operation);
    normalizedOriginals.push(normalizedOriginal);
  }
  if (
    !evidenceSupportsVectorRewrite(
      evidence,
      edits,
      normalizedOperations,
    ) ||
    normalizedOriginals.some((originalText) =>
      unselectedTextContainsEquivalentTarget(
        originalText,
        normalizedOperations,
        selected,
      ),
    )
  ) {
    return null;
  }

  const rewritten = copyBytes(contents);
  for (const operation of selected) {
    for (const stringToken of operation.stringTokens) {
      neutralizePdfString(rewritten, stringToken);
    }
  }
  return rewritten;
}

function resolvePdfReferenceChain(
  document: PDFDocument,
  root: PDFObject,
  onReference?: (reference: PDFRef) => void,
): PDFObject | null {
  let object = root;
  const seen = new Set<string>();
  for (
    let depth = 0;
    object instanceof PDFRef;
    depth += 1
  ) {
    if (depth >= PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth) {
      return null;
    }
    const key = pdfReferenceKey(object);
    if (seen.has(key)) return null;
    seen.add(key);
    onReference?.(object);
    try {
      const resolved = document.context.lookup(object);
      if (!resolved) return null;
      object = resolved;
    } catch {
      return null;
    }
  }
  return object;
}

function referencedContentObjects(
  document: PDFDocument,
  page: PDFPage,
): PDFRef[] | null {
  const references = new Map<string, PDFRef>();
  const remember = (reference: PDFRef): void => {
    references.set(pdfReferenceKey(reference), reference);
  };
  const raw = page.node.get(PDFName.of("Contents"), true);
  if (!raw) return [];
  const contents = resolvePdfReferenceChain(
    document,
    raw,
    remember,
  );
  if (!contents) return null;
  if (contents instanceof PDFArray) {
    for (const entry of contents.asArray()) {
      if (
        !resolvePdfReferenceChain(document, entry, remember)
      ) {
        return null;
      }
    }
  }
  return [...references.values()];
}

function samePdfReference(first: PDFRef, second: PDFRef): boolean {
  return (
    first.objectNumber === second.objectNumber &&
    first.generationNumber === second.generationNumber
  );
}

function pdfReferenceKey(reference: PDFRef): string {
  return `${reference.objectNumber}:${reference.generationNumber}`;
}

interface PdfObjectTraversalBudget {
  entries: number;
}

function canContainPdfReferences(object: PDFObject): boolean {
  return (
    object instanceof PDFRef ||
    object instanceof PDFArray ||
    object instanceof PDFStream ||
    object instanceof PDFDict
  );
}

function appendTraversablePdfObjects(
  values: Iterable<PDFObject>,
  pending: PDFObject[],
  budget: PdfObjectTraversalBudget,
): boolean {
  for (const value of values) {
    budget.entries += 1;
    if (
      budget.entries >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      return false;
    }
    if (canContainPdfReferences(value)) pending.push(value);
  }
  return true;
}

function candidateReferencesInObject(
  root: PDFObject,
  candidateKeys: ReadonlySet<string>,
  budget: PdfObjectTraversalBudget,
): Set<string> | null {
  const references = new Set<string>();
  const stack: PDFObject[] = [root];
  const seen = new Set<PDFObject>();
  while (stack.length > 0) {
    const object = stack.pop();
    if (!object) continue;
    if (object instanceof PDFRef) {
      const key = pdfReferenceKey(object);
      if (candidateKeys.has(key)) references.add(key);
      continue;
    }
    if (seen.has(object)) continue;
    seen.add(object);

    if (object instanceof PDFArray) {
      if (
        !appendTraversablePdfObjects(
          object.asArray(),
          stack,
          budget,
        )
      ) {
        return null;
      }
    } else if (object instanceof PDFStream) {
      if (
        !appendTraversablePdfObjects(
          [object.dict],
          stack,
          budget,
        )
      ) {
        return null;
      }
    } else if (object instanceof PDFDict) {
      if (
        !appendTraversablePdfObjects(
          object.values(),
          stack,
          budget,
        )
      ) {
        return null;
      }
    }
  }
  return references;
}

function sourcePageContentCandidates(page: PDFPage): {
  objects: Set<PDFObject>;
  references: Set<string>;
} | null {
  const rawContents = page.node.get(PDFName.of("Contents"), true);
  if (!rawContents) return null;

  const objects = new Set<PDFObject>();
  const references = new Set<string>();
  const resolve = (object: PDFObject): PDFObject | null => {
    return resolvePdfReferenceChain(
      page.doc,
      object,
      (reference) =>
        references.add(pdfReferenceKey(reference)),
    );
  };

  const contents = resolve(rawContents);
  if (!contents) return null;
  objects.add(contents);
  if (contents instanceof PDFStream) {
    return contentStreamDictionaryIsSafe(contents)
      ? { objects, references }
      : null;
  }
  if (
    !(contents instanceof PDFArray) ||
    contents.size() === 0 ||
    contents.size() >
      MAX_VECTOR_TEXT_REWRITE_CONTENT_STREAMS
  ) {
    return null;
  }

  for (const entry of contents.asArray()) {
    const stream = resolve(entry);
    if (
      !(stream instanceof PDFStream) ||
      !contentStreamDictionaryIsSafe(stream)
    ) {
      return null;
    }
    objects.add(stream);
  }
  return { objects, references };
}

function sourcePageContentIsExclusivelyOwned(
  page: PDFPage,
): boolean {
  const candidates = sourcePageContentCandidates(page);
  if (!candidates) return false;

  const pending: PDFObject[] = [];
  const traversalBudget: PdfObjectTraversalBudget = { entries: 0 };
  const inheritedKeys = [
    "Resources",
    "MediaBox",
    "CropBox",
    "Rotate",
  ] as const;
  for (const [key, value] of page.node.entries()) {
    const name = key.decodeText();
    if (name !== "Contents" && name !== "Parent") {
      if (
        !appendTraversablePdfObjects(
          [value],
          pending,
          traversalBudget,
        )
      ) {
        return false;
      }
    }
  }
  for (const key of inheritedKeys) {
    const name = PDFName.of(key);
    if (page.node.get(name) === undefined) {
      const inherited = page.node.getInheritableAttribute(name);
      if (
        inherited &&
        !appendTraversablePdfObjects(
          [inherited],
          pending,
          traversalBudget,
        )
      ) {
        return false;
      }
    }
  }

  const seenObjects = new Set<PDFObject>();
  const seenReferences = new Set<string>();
  while (pending.length > 0) {
    let object = pending.pop();
    if (!object) continue;
    let alreadyTraversed = false;
    let referenceDepth = 0;
    while (object instanceof PDFRef) {
      if (
        referenceDepth >=
        PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth
      ) {
        return false;
      }
      referenceDepth += 1;
      const key = pdfReferenceKey(object);
      if (candidates.references.has(key)) return false;
      if (seenReferences.has(key)) {
        alreadyTraversed = true;
        break;
      }
      seenReferences.add(key);
      try {
        object = page.doc.context.lookup(object) ?? undefined;
      } catch {
        return false;
      }
      if (!object) return false;
    }
    if (alreadyTraversed) continue;
    if (candidates.objects.has(object)) return false;
    if (seenObjects.has(object)) continue;
    seenObjects.add(object);
    if (
      seenObjects.size >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      return false;
    }

    if (object instanceof PDFArray) {
      if (
        !appendTraversablePdfObjects(
          object.asArray(),
          pending,
          traversalBudget,
        )
      ) {
        return false;
      }
    } else if (object instanceof PDFStream) {
      if (
        !appendTraversablePdfObjects(
          [object.dict],
          pending,
          traversalBudget,
        )
      ) {
        return false;
      }
    } else if (object instanceof PDFDict) {
      if (
        !appendTraversablePdfObjects(
          object.values(),
          pending,
          traversalBudget,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function deleteUnreferencedObjects(
  document: PDFDocument,
  candidates: readonly PDFRef[],
): void {
  if (candidates.length === 0) return;

  const candidateByKey = new Map(
    candidates.map((reference) => [
      pdfReferenceKey(reference),
      reference,
    ]),
  );
  const candidateKeys = new Set(candidateByKey.keys());
  const candidateEdges = new Map<string, Set<string>>();
  const liveCandidates = new Set<string>();
  const traversalBudget: PdfObjectTraversalBudget = { entries: 0 };
  const indirectObjects = document.context.enumerateIndirectObjects();
  if (
    indirectObjects.length >
    PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
  ) {
    throw securityLimitError({
      code: "pdf-object-graph-too-large",
      maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
    });
  }
  traversalBudget.entries = indirectObjects.length;

  /*
   * Build the candidate reference graph once. References from ordinary
   * objects are live roots; references between obsolete objects are followed
   * only when their owner is live. This safely removes unreferenced cycles
   * without rescanning the complete PDF once per old content stream.
   */
  for (const [owner, object] of indirectObjects) {
    const ownerKey = pdfReferenceKey(owner);
    const references = candidateReferencesInObject(
      object,
      candidateKeys,
      traversalBudget,
    );
    if (!references) {
      throw securityLimitError({
        code: "pdf-object-graph-too-large",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
      });
    }
    if (candidateKeys.has(ownerKey)) {
      candidateEdges.set(ownerKey, references);
    } else {
      for (const reference of references) liveCandidates.add(reference);
    }
  }

  const pending = [...liveCandidates];
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key) continue;
    for (const reference of candidateEdges.get(key) ?? []) {
      if (liveCandidates.has(reference)) continue;
      liveCandidates.add(reference);
      pending.push(reference);
    }
  }

  for (const [key, reference] of candidateByKey) {
    if (!liveCandidates.has(key)) document.context.delete(reference);
  }
}

function replacePageContents(
  document: PDFDocument,
  page: PDFPage,
  contents: Uint8Array,
): void {
  const obsoleteReferences = referencedContentObjects(document, page);
  if (!obsoleteReferences) {
    throw new Error(
      "The original page content graph could not be replaced safely.",
    );
  }
  const streamReference = document.context.register(
    document.context.flateStream(contents),
  );
  page.node.set(
    PDFName.of("Contents"),
    document.context.obj([streamReference]),
  );
  deleteUnreferencedObjects(
    document,
    obsoleteReferences.filter(
      (reference) => !samePdfReference(reference, streamReference),
    ),
  );
}

async function canvasToPngBytes(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("The flattened page could not be encoded as PNG."));
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function report(
  callback: ExportEditedPdfInput["onProgress"],
  value: number,
  label: string,
): void {
  try {
    callback?.(clamp(Math.round(value), 0, 100), label);
  } catch {
    // A progress observer must never interrupt a valid local export.
  }
}

function parseRgbComponent(value: string): number | null {
  const component = Number(value.trim());
  return Number.isFinite(component) ? clamp(component / 255, 0, 1) : null;
}

function parseColor(value: string | undefined): RGB | undefined {
  if (!value) return undefined;

  const color = value.trim().toLowerCase();
  if (
    color === "none" ||
    color === "transparent" ||
    color === "rgba(0, 0, 0, 0)"
  ) {
    return undefined;
  }

  const shortHex = /^#([0-9a-f]{3,4})$/i.exec(color);
  if (shortHex) {
    const [red, green, blue] = shortHex[1].slice(0, 3).split("");
    return rgb(
      Number.parseInt(`${red}${red}`, 16) / 255,
      Number.parseInt(`${green}${green}`, 16) / 255,
      Number.parseInt(`${blue}${blue}`, 16) / 255,
    );
  }

  const longHex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color);
  if (longHex) {
    return rgb(
      Number.parseInt(longHex[1].slice(0, 2), 16) / 255,
      Number.parseInt(longHex[1].slice(2, 4), 16) / 255,
      Number.parseInt(longHex[1].slice(4, 6), 16) / 255,
    );
  }

  const functional = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (functional) {
    const components = functional[1].split(",");
    if (components.length >= 3) {
      const red = parseRgbComponent(components[0]);
      const green = parseRgbComponent(components[1]);
      const blue = parseRgbComponent(components[2]);
      if (red !== null && green !== null && blue !== null) {
        return rgb(red, green, blue);
      }
    }
  }

  const namedColors: Record<string, RGB> = {
    black: rgb(0, 0, 0),
    blue: rgb(0, 0.35, 0.85),
    green: rgb(0, 0.55, 0.35),
    grey: rgb(0.5, 0.5, 0.5),
    gray: rgb(0.5, 0.5, 0.5),
    red: rgb(0.85, 0.12, 0.12),
    white: rgb(1, 1, 1),
    yellow: rgb(1, 0.9, 0.2),
  };

  return namedColors[color];
}

function visualRectForElement(
  element: EditorElement,
  pageWidth: number,
  pageHeight: number,
): VisualRect {
  const x = clamp(element.x, -4, 5) * pageWidth;
  const top = clamp(element.y, -4, 5) * pageHeight;
  const width = Math.max(0, clamp(element.width, 0, 5) * pageWidth);
  const height = Math.max(0, clamp(element.height, 0, 5) * pageHeight);

  return {
    x,
    y: pageHeight - top - height,
    width,
    height,
  };
}

function mapVisualPointToPage(
  point: Point,
  transform: PageDrawingTransform,
): Point {
  const { baseWidth, baseHeight, cropX, cropY, pageRotation } =
    transform;

  if (pageRotation === 90) {
    return {
      x: cropX + baseWidth - point.y,
      y: cropY + point.x,
    };
  }
  if (pageRotation === 180) {
    return {
      x: cropX + baseWidth - point.x,
      y: cropY + baseHeight - point.y,
    };
  }
  if (pageRotation === 270) {
    return {
      x: cropX + point.y,
      y: cropY + baseHeight - point.x,
    };
  }
  return {
    x: cropX + point.x,
    y: cropY + point.y,
  };
}

function rotateVisualPointAroundElement(
  point: Point,
  bounds: VisualRect,
  editorClockwiseDegrees: number,
): Point {
  return rotatePoint(
    point,
    {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    },
    -editorClockwiseDegrees,
  );
}

function elementAnchor(
  bounds: VisualRect,
  transform: PageDrawingTransform,
  editorClockwiseDegrees: number,
): Point {
  return mapVisualPointToPage(
    rotateVisualPointAroundElement(
      { x: bounds.x, y: bounds.y },
      bounds,
      editorClockwiseDegrees,
    ),
    transform,
  );
}

/**
 * CSS/editor rotation is clockwise in a top-left coordinate system. PDF draw
 * operators rotate counter-clockwise in a bottom-left system. The page's
 * clockwise /Rotate is then inverted to reach the unrotated page user space.
 */
function elementPdfRotation(
  transform: PageDrawingTransform,
  editorClockwiseDegrees: number,
): number {
  return transform.pageRotation - editorClockwiseDegrees;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", {
  granularity: "grapheme",
});
const WORD_SEGMENTER = new Intl.Segmenter("und", {
  granularity: "word",
});

export function splitTextGraphemes(value: string): string[] {
  return [...GRAPHEME_SEGMENTER.segment(value)].map(
    (segment) => segment.segment,
  );
}

const EDITOR_FONT_FAMILIES = new Set<EditorFontFamily>([
  "Helvetica",
  "Times",
  "Courier",
  "Noto Sans",
  "Noto Sans Condensed",
  "Noto Serif",
  "Noto Sans Mono",
]);
const STANDARD_EDITOR_FONT_FAMILIES =
  new Set<StandardEditorFontFamily>([
    "Helvetica",
    "Times",
    "Courier",
  ]);
const WIN_ANSI_EXTRA = new Set([
  0x0152,
  0x0153,
  0x0160,
  0x0161,
  0x0178,
  0x017d,
  0x017e,
  0x0192,
  0x02c6,
  0x02dc,
  0x2013,
  0x2014,
  0x2018,
  0x2019,
  0x201a,
  0x201c,
  0x201d,
  0x201e,
  0x2020,
  0x2021,
  0x2022,
  0x2026,
  0x2030,
  0x2039,
  0x203a,
  0x20ac,
  0x2122,
]);

function normalizeEditorText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .normalize("NFC");
}

function isWinAnsiText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === "\n" ||
      (codePoint >= 0x20 && codePoint <= 0x7e) ||
      (codePoint >= 0xa0 && codePoint <= 0xff) ||
      WIN_ANSI_EXTRA.has(codePoint)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function standardFontName(
  family: StandardEditorFontFamily,
  bold: boolean,
  italic: boolean,
): StandardFonts {
  if (family === "Times") {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === "Courier") {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

function createExportFontManager(
  document: PDFDocument,
  loadAsset?: PdfEditorFontAssetLoader,
  signal?: AbortSignal,
): ExportFontManager {
  const standardFonts = new Map<string, Promise<PDFFont>>();
  const customFonts = createPdfEditorFontEmbedder(document, {
    loadAsset,
  });

  const embedStandard = (
    family: StandardEditorFontFamily,
    bold: boolean,
    italic: boolean,
  ): Promise<PDFFont> => {
    const name = standardFontName(family, bold, italic);
    const cached = standardFonts.get(name);
    if (cached) return cached;
    const pending = document.embedFont(name);
    standardFonts.set(name, pending);
    return pending;
  };

  return {
    dispose(): void {
      standardFonts.clear();
      customFonts.clear();
    },
    async prepareRuns(
      element: TextEditorElement,
      value: string,
    ): Promise<readonly PreparedPdfTextRun[]> {
      const text = normalizeEditorText(value);
      const family = element.fontFamily ?? "Helvetica";
      if (!EDITOR_FONT_FAMILIES.has(family)) {
        throw new Error(
          `Text annotation "${element.id}" uses an unsupported font family.`,
        );
      }

      if (
        STANDARD_EDITOR_FONT_FAMILIES.has(
          family as StandardEditorFontFamily,
        ) &&
        isWinAnsiText(text)
      ) {
        return [
          {
            direction: element.direction ?? "ltr",
            font: await embedStandard(
              family as StandardEditorFontFamily,
              element.bold,
              element.italic,
            ),
            syntheticBold: false,
            syntheticItalic: false,
            text,
          },
        ];
      }

      const planned = planPdfEditorFontRuns(text, {
        bold: element.bold,
        family,
        italic: element.italic,
      });
      const groupedByAsset = new Map<
        string,
        {
          asset: (typeof planned)[number]["asset"];
          text: string;
        }
      >();
      for (const run of planned) {
        const group = groupedByAsset.get(run.asset.id);
        if (group) {
          group.text += run.text;
        } else {
          groupedByAsset.set(run.asset.id, {
            asset: run.asset,
            text: run.text,
          });
        }
      }
      const embeddedByAsset = new Map(
        await Promise.all(
          [...groupedByAsset.entries()].map(
            async ([assetId, group]) =>
              [
                assetId,
                await customFonts.embed(
                  group.asset,
                  group.text,
                  signal,
                ),
              ] as const,
          ),
        ),
      );
      return planned.map((run) => {
        const font = embeddedByAsset.get(run.asset.id);
        if (!font) {
          throw new Error(
            `Bundled font "${run.asset.id}" was not prepared for export.`,
          );
        }
        return {
          direction: element.direction ?? run.direction,
          font,
          syntheticBold: run.syntheticBold,
          syntheticItalic: run.syntheticItalic,
          text: run.text,
        };
      });
    },
  };
}

interface PreparedPdfTextUnit
  extends Omit<PreparedPdfTextRun, "text"> {
  text: string;
}

interface PreparedPdfTextLine {
  direction: "ltr" | "rtl";
  runs: PreparedPdfTextRun[];
  width: number;
}

function samePreparedTextRunStyle(
  first: PreparedPdfTextRun,
  second: PreparedPdfTextRun,
): boolean {
  return (
    first.font === second.font &&
    first.direction === second.direction &&
    first.syntheticBold === second.syntheticBold &&
    first.syntheticItalic === second.syntheticItalic
  );
}

function appendPreparedTextRun(
  runs: PreparedPdfTextRun[],
  run: PreparedPdfTextRun,
): void {
  if (!run.text) return;
  const previous = runs.at(-1);
  if (previous && samePreparedTextRunStyle(previous, run)) {
    previous.text += run.text;
    return;
  }
  runs.push({ ...run });
}

function groupPreparedTextRuns(
  source: readonly PreparedPdfTextRun[],
): PreparedPdfTextRun[] {
  const runs: PreparedPdfTextRun[] = [];
  for (const run of source) appendPreparedTextRun(runs, run);
  return runs;
}

function groupTextLineRuns(
  units: readonly PreparedPdfTextUnit[],
  direction: "ltr" | "rtl",
  fontSize: number,
): PreparedPdfTextLine {
  const runs = groupPreparedTextRuns(units);
  return {
    direction,
    runs,
    width: runs.reduce(
      (width, run) =>
        width + run.font.widthOfTextAtSize(run.text, fontSize),
      0,
    ),
  };
}

function trimTrailingWhitespace(
  units: readonly PreparedPdfTextUnit[],
): PreparedPdfTextUnit[] {
  let end = units.length;
  while (
    end > 0 &&
    units[end - 1].text !== "\n" &&
    /^\s+$/u.test(units[end - 1].text)
  ) {
    end -= 1;
  }
  return units.slice(0, end);
}

interface PreparedPdfTextToken {
  runs: PreparedPdfTextRun[];
  whitespace: boolean;
}

function preparedTextWidth(
  units: readonly PreparedPdfTextUnit[],
  direction: "ltr" | "rtl",
  fontSize: number,
): number {
  return groupTextLineRuns(units, direction, fontSize).width;
}

function preparedTextRunsWidth(
  runs: readonly PreparedPdfTextRun[],
  fontSize: number,
): number {
  return groupPreparedTextRuns(runs).reduce(
    (width, run) =>
      width + run.font.widthOfTextAtSize(run.text, fontSize),
    0,
  );
}

function preparedTextCandidateWidth(
  units: readonly PreparedPdfTextUnit[],
  runs: readonly PreparedPdfTextRun[],
  fontSize: number,
): number {
  return preparedTextRunsWidth([...units, ...runs], fontSize);
}

function* preparedTextParagraphs(
  runs: readonly PreparedPdfTextRun[],
): Generator<PreparedPdfTextRun[]> {
  let paragraph: PreparedPdfTextRun[] = [];
  for (const run of runs) {
    let start = 0;
    while (start < run.text.length) {
      const newline = run.text.indexOf("\n", start);
      const end = newline < 0 ? run.text.length : newline;
      appendPreparedTextRun(paragraph, {
        ...run,
        text: run.text.slice(start, end),
      });
      if (newline < 0) break;
      yield paragraph;
      paragraph = [];
      start = newline + 1;
    }
    if (run.text.endsWith("\n")) {
      // The final empty paragraph is emitted below or completed by later runs.
      continue;
    }
  }
  yield paragraph;
}

function* segmentPreparedTextTokens(
  runs: readonly PreparedPdfTextRun[],
): Generator<PreparedPdfTextToken> {
  const text = runs.map((run) => run.text).join("");
  if (!text) return;

  let runIndex = 0;
  let runOffset = 0;
  let codeUnitOffset = 0;
  let pendingRuns: PreparedPdfTextRun[] = [];
  let pendingHasWord = false;

  const takeRunsThrough = (end: number): PreparedPdfTextRun[] => {
    const taken: PreparedPdfTextRun[] = [];
    while (runIndex < runs.length && codeUnitOffset < end) {
      const run = runs[runIndex];
      const available = run.text.length - runOffset;
      if (available <= 0) {
        runIndex += 1;
        runOffset = 0;
        continue;
      }
      const length = Math.min(available, end - codeUnitOffset);
      appendPreparedTextRun(taken, {
        ...run,
        text: run.text.slice(runOffset, runOffset + length),
      });
      runOffset += length;
      codeUnitOffset += length;
      if (runOffset === run.text.length) {
        runIndex += 1;
        runOffset = 0;
      }
    }
    return taken;
  };

  for (const segment of WORD_SEGMENTER.segment(text)) {
    const segmentEnd = segment.index + segment.segment.length;
    const segmentRuns = takeRunsThrough(segmentEnd);
    if (codeUnitOffset < segmentEnd || segmentRuns.length === 0) continue;

    if (/^\s+$/u.test(segment.segment)) {
      if (pendingRuns.length > 0) {
        yield { runs: pendingRuns, whitespace: false };
        pendingRuns = [];
        pendingHasWord = false;
      }
      yield { runs: segmentRuns, whitespace: true };
      continue;
    }

    if (segment.isWordLike && pendingHasWord) {
      yield { runs: pendingRuns, whitespace: false };
      pendingRuns = [];
      pendingHasWord = false;
    }
    for (const run of segmentRuns) {
      appendPreparedTextRun(pendingRuns, run);
    }
    if (segment.isWordLike) pendingHasWord = true;
  }

  if (codeUnitOffset < text.length) {
    for (const run of takeRunsThrough(text.length)) {
      appendPreparedTextRun(pendingRuns, run);
    }
  }
  if (pendingRuns.length > 0) {
    yield { runs: pendingRuns, whitespace: false };
  }
}

function* preparedTextUnits(
  runs: readonly PreparedPdfTextRun[],
): Generator<PreparedPdfTextUnit> {
  for (const run of runs) {
    for (const segment of GRAPHEME_SEGMENTER.segment(run.text)) {
      yield {
        direction: run.direction,
        font: run.font,
        syntheticBold: run.syntheticBold,
        syntheticItalic: run.syntheticItalic,
        text: segment.segment,
      };
    }
  }
}

function materializePreparedTextUnits(
  runs: readonly PreparedPdfTextRun[],
): PreparedPdfTextUnit[] {
  return [...preparedTextUnits(runs)];
}

interface PreparedPdfTextChunk {
  hasMore: boolean;
  units: PreparedPdfTextUnit[];
}

function* splitOversizedPreparedTextToken(
  token: PreparedPdfTextToken,
  direction: "ltr" | "rtl",
  fontSize: number,
  maximumWidth: number,
): Generator<PreparedPdfTextChunk> {
  const iterator = preparedTextUnits(token.runs);
  const buffer: PreparedPdfTextUnit[] = [];
  let exhausted = false;

  const fill = (length: number): void => {
    while (!exhausted && buffer.length < length) {
      const next = iterator.next();
      if (next.done) {
        exhausted = true;
      } else {
        buffer.push(next.value);
      }
    }
  };

  while (true) {
    fill(1);
    if (buffer.length === 0) return;

    let fitting = 1;
    if (
      preparedTextWidth(
        buffer.slice(0, 1),
        direction,
        fontSize,
      ) <= maximumWidth
    ) {
      let probeLength = 2;
      while (true) {
        fill(probeLength);
        const available = Math.min(buffer.length, probeLength);
        if (available <= fitting) break;
        if (
          preparedTextWidth(
            buffer.slice(0, available),
            direction,
            fontSize,
          ) <= maximumWidth
        ) {
          fitting = available;
          if (exhausted && fitting === buffer.length) break;
          probeLength *= 2;
          continue;
        }

        let lower = fitting + 1;
        let upper = available - 1;
        while (lower <= upper) {
          const midpoint = Math.floor((lower + upper) / 2);
          if (
            preparedTextWidth(
              buffer.slice(0, midpoint),
              direction,
              fontSize,
            ) <= maximumWidth
          ) {
            fitting = midpoint;
            lower = midpoint + 1;
          } else {
            upper = midpoint - 1;
          }
        }
        break;
      }
    }

    const units = buffer.splice(0, fitting);
    fill(1);
    const hasMore = buffer.length > 0;
    yield { hasMore, units };
    if (!hasMore) return;
  }
}

export function wrapPreparedTextRuns(
  runs: readonly PreparedPdfTextRun[],
  fontSize: number,
  maximumWidth: number,
  maximumLines = Number.POSITIVE_INFINITY,
): PreparedPdfTextLine[] {
  if (maximumWidth <= 0 || maximumLines <= 0) return [];

  const direction =
    runs.find((run) => run.direction === "rtl")?.direction ?? "ltr";
  const lines: PreparedPdfTextLine[] = [];

  for (const paragraph of preparedTextParagraphs(runs)) {
    const tokens = segmentPreparedTextTokens(paragraph);
    let line: PreparedPdfTextUnit[] = [];

    const flushLine = () => {
      const trimmed = trimTrailingWhitespace(line);
      lines.push(groupTextLineRuns(trimmed, direction, fontSize));
      line = [];
      return lines.length >= maximumLines;
    };

    for (const token of tokens) {
      if (line.length === 0 && token.whitespace) continue;

      const hadLine = line.length > 0;
      if (
        preparedTextCandidateWidth(line, token.runs, fontSize) <=
        maximumWidth
      ) {
        line.push(...materializePreparedTextUnits(token.runs));
        continue;
      }

      if (hadLine && flushLine()) return lines;
      if (token.whitespace) continue;

      if (
        hadLine &&
        preparedTextRunsWidth(token.runs, fontSize) <= maximumWidth
      ) {
        line = materializePreparedTextUnits(token.runs);
        continue;
      }

      for (const chunk of splitOversizedPreparedTextToken(
        token,
        direction,
        fontSize,
        maximumWidth,
      )) {
        line = chunk.units;
        if (chunk.hasMore && flushLine()) return lines;
      }
    }

    if (flushLine()) return lines;
  }
  return lines;
}

async function drawTextElement(
  page: PDFPage,
  element: TextEditorElement,
  fonts: ExportFontManager,
  transform: PageDrawingTransform,
): Promise<void> {
  const bounds = visualRectForElement(
    element,
    transform.visualWidth,
    transform.visualHeight,
  );
  if (bounds.width <= 0 || bounds.height <= 0 || !element.text) return;
  const editorRotation = element.rotation ?? 0;
  const anchor = elementAnchor(bounds, transform, editorRotation);
  const pdfRotation = degrees(
    elementPdfRotation(transform, editorRotation),
  );

  const background = element.sourceText
    ? undefined
    : parseColor(element.backgroundColor);
  if (background) {
    page.drawRectangle({
      x: anchor.x,
      y: anchor.y,
      width: bounds.width,
      height: bounds.height,
      color: background,
      opacity: safeOpacity(element.opacity),
      rotate: pdfRotation,
    });
  }

  const fontSize = clamp(element.fontSize, 4, 240);
  const lineHeight = fontSize * 1.22;
  const maxLines = Math.max(1, Math.floor(bounds.height / lineHeight));
  const preparedRuns = await fonts.prepareRuns(element, element.text);
  const lines = wrapPreparedTextRuns(
    preparedRuns,
    fontSize,
    bounds.width,
    maxLines + 1,
  );
  if (lines.length > maxLines) {
    throw new Error(
      "A text box does not fit all of its content. Resize the box or reduce the font size before exporting.",
    );
  }
  const color = parseColor(element.color) ?? rgb(0.09, 0.13, 0.11);

  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    const line = lines[index];
    if (line.width > bounds.width + 0.01) {
      throw new Error(
        "A character does not fit inside its text box. Resize the box or reduce the font size before exporting.",
      );
    }
    const firstBaselineOffset =
      fontSize * clamp(element.baselineFactor ?? 1, 0.25, 1.75);
    const baseline =
      bounds.y +
      bounds.height -
      firstBaselineOffset -
      index * lineHeight;
    if (baseline < bounds.y - fontSize * 0.25) break;
    let visualX =
      line.direction === "rtl"
        ? bounds.x + bounds.width - line.width
        : bounds.x;
    for (const run of line.runs) {
      const lineAnchor = mapVisualPointToPage(
        rotateVisualPointAroundElement(
          { x: visualX, y: baseline },
          bounds,
          editorRotation,
        ),
        transform,
      );
      if (run.syntheticBold) {
        page.pushOperators(
          pushGraphicsState(),
          setLineWidth(Math.max(0.2, fontSize * 0.025)),
          setStrokingRgbColor(color.red, color.green, color.blue),
          setTextRenderingMode(TextRenderingMode.FillAndOutline),
        );
      }
      page.drawText(run.text, {
        x: lineAnchor.x,
        y: lineAnchor.y,
        size: fontSize,
        font: run.font,
        color,
        opacity: safeOpacity(element.opacity),
        rotate: pdfRotation,
        xSkew: run.syntheticItalic ? degrees(12) : undefined,
      });
      if (run.syntheticBold) {
        page.pushOperators(popGraphicsState());
      }
      visualX += run.font.widthOfTextAtSize(run.text, fontSize);
    }
  }
}

function drawRectElement(
  page: PDFPage,
  element: RectEditorElement,
  transform: PageDrawingTransform,
): void {
  const bounds = visualRectForElement(
    element,
    transform.visualWidth,
    transform.visualHeight,
  );
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const editorRotation = element.rotation ?? 0;
  const anchor = elementAnchor(bounds, transform, editorRotation);

  const whiteout = element.type === "whiteout";
  const highlight = element.type === "highlight";
  const color =
    parseColor(element.fill) ??
    (whiteout ? rgb(1, 1, 1) : highlight ? rgb(1, 0.88, 0.2) : undefined);
  const borderColor = whiteout ? undefined : parseColor(element.stroke);
  const opacity = whiteout
    ? 1
    : highlight
      ? Math.min(safeOpacity(element.opacity), 0.55)
      : safeOpacity(element.opacity);
  const borderWidth = borderColor
    ? clamp(element.strokeWidth, 0, 72)
    : 0;

  page.drawRectangle({
    x: anchor.x,
    y: anchor.y,
    width: bounds.width,
    height: bounds.height,
    color,
    borderColor,
    borderWidth,
    opacity,
    borderOpacity: opacity,
    rotate: degrees(elementPdfRotation(transform, editorRotation)),
  });
}

function pointOnPage(
  point: Point,
  element: PathEditorElement,
  pageWidth: number,
  pageHeight: number,
): Point {
  const normalizedX = element.x + clamp(point.x, -4, 5) * element.width;
  const normalizedY = element.y + clamp(point.y, -4, 5) * element.height;
  return {
    x: normalizedX * pageWidth,
    y: pageHeight - normalizedY * pageHeight,
  };
}

function rotatePoint(
  point: Point,
  center: Point,
  angleInDegrees: number,
): Point {
  if (!angleInDegrees) return point;
  const angle = (angleInDegrees * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function drawPathElement(
  page: PDFPage,
  element: PathEditorElement,
  transform: PageDrawingTransform,
): void {
  if (element.points.length < 2) return;

  const bounds = visualRectForElement(
    element,
    transform.visualWidth,
    transform.visualHeight,
  );
  const points = element.points.map((point) => {
    const visualPoint = pointOnPage(
      point,
      element,
      transform.visualWidth,
      transform.visualHeight,
    );
    return mapVisualPointToPage(
      rotateVisualPointAroundElement(
        visualPoint,
        bounds,
        element.rotation ?? 0,
      ),
      transform,
    );
  });
  const color = parseColor(element.color) ?? rgb(0.09, 0.13, 0.11);
  const thickness = clamp(element.strokeWidth, 0.25, 72);
  const opacity = safeOpacity(element.opacity);

  for (let index = 1; index < points.length; index += 1) {
    page.drawLine({
      start: points[index - 1],
      end: points[index],
      thickness,
      color,
      opacity,
    });
  }
}

interface ImageDataParts {
  mimeType: "image/png" | "image/jpeg";
  bytes: Uint8Array;
  pixelCount: number;
}

function securityLimitError(
  issue: PdfSecurityLimitIssue,
): Error {
  const error = new Error(describePdfSecurityLimitIssue(issue));
  error.name = "PdfSecurityLimitError";
  return error;
}

function isBase64Code(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  );
}

function dataUrlParts(dataUrl: string): ImageDataParts {
  if (dataUrl !== dataUrl.trim()) {
    throw new Error(
      "An image annotation is not a valid PNG or JPEG data URL.",
    );
  }

  const commaIndex = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const mimeType =
    header === "data:image/png;base64"
      ? "image/png"
      : header === "data:image/jpeg;base64" ||
          header === "data:image/jpg;base64"
        ? "image/jpeg"
        : null;
  const encoded =
    commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
  if (!mimeType || encoded.length === 0 || encoded.length % 4 !== 0) {
    throw new Error(
      "An image annotation is not a valid PNG or JPEG data URL.",
    );
  }

  const padding = encoded.endsWith("==")
    ? 2
    : encoded.endsWith("=")
      ? 1
      : 0;
  const contentLength = encoded.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if (!isBase64Code(encoded.charCodeAt(index))) {
      throw new Error(
        "An image annotation contains invalid base64 data.",
      );
    }
  }
  for (let index = contentLength; index < encoded.length; index += 1) {
    if (encoded.charCodeAt(index) !== 0x3d) {
      throw new Error(
        "An image annotation contains invalid base64 padding.",
      );
    }
  }

  const decodedByteLength =
    (encoded.length / 4) * 3 - padding;
  if (decodedByteLength > PDF_SECURITY_LIMITS.maxImageBytes) {
    throw securityLimitError({
      code: "image-too-large",
      fileName: "Image annotation",
      maxBytes: PDF_SECURITY_LIMITS.maxImageBytes,
    });
  }

  try {
    let bytes: Uint8Array | null = null;
    if (typeof globalThis.atob === "function") {
      const decoded = globalThis.atob(encoded);
      bytes = Uint8Array.from(decoded, (character) =>
          character.charCodeAt(0),
        );
    }

    if (!bytes) {
      const runtimeBuffer = (
        globalThis as typeof globalThis & {
          Buffer?: {
            from(value: string, encoding: "base64"): Uint8Array;
          };
        }
      ).Buffer;
      if (runtimeBuffer) {
        bytes = copyBytes(runtimeBuffer.from(encoded, "base64"));
      }
    }
    if (!bytes || bytes.byteLength !== decodedByteLength) {
      throw new Error("Invalid decoded image length.");
    }

    const imageInfo = getImageInfoFromBytes(
      bytes.subarray(
        0,
        PDF_SECURITY_LIMITS.maxImageHeaderBytes,
      ),
    );
    if (!imageInfo) {
      throw new Error(
        "An image annotation has an invalid PNG or JPEG header.",
      );
    }
    const expectedKind = mimeType === "image/png" ? "png" : "jpeg";
    if (imageInfo.kind !== expectedKind) {
      throw new Error(
        `An image annotation declares ${expectedKind.toUpperCase()} but contains ${imageInfo.kind.toUpperCase()} bytes.`,
      );
    }
    const dimensionIssue = getImageDimensionLimitIssue(
      "Image annotation",
      imageInfo.width,
      imageInfo.height,
    );
    if (dimensionIssue) throw securityLimitError(dimensionIssue);

    return {
      mimeType,
      bytes,
      pixelCount: imageInfo.width * imageInfo.height,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    if (
      error instanceof Error &&
      (error.name === "PdfSecurityLimitError" ||
        error.message.startsWith("An image annotation"))
    ) {
      throw error;
    }
    // The actionable error below is clearer than a runtime decoder failure.
  }

  throw new Error("The image annotation could not be decoded.");
}

function validateEditorImageData(
  elements: readonly EditorElement[],
): Map<string, ImageDataParts> {
  const validated = new Map<string, ImageDataParts>();
  for (const element of elements) {
    if (element.type !== "image" || validated.has(element.dataUrl)) {
      continue;
    }
    validated.set(element.dataUrl, dataUrlParts(element.dataUrl));
  }
  return validated;
}

async function embedImage(
  document: PDFDocument,
  element: ImageEditorElement,
  cache: Map<string, Promise<PDFImage>>,
  validatedImages: ReadonlyMap<string, ImageDataParts>,
): Promise<PDFImage> {
  const existing = cache.get(element.dataUrl);
  if (existing) return existing;

  const pending = (async () => {
    const image = validatedImages.get(element.dataUrl);
    if (!image) {
      throw new Error(
        "An image annotation was not validated before embedding.",
      );
    }
    return image.mimeType === "image/png"
      ? document.embedPng(image.bytes)
      : document.embedJpg(image.bytes);
  })();
  cache.set(element.dataUrl, pending);

  try {
    return await pending;
  } catch (error) {
    cache.delete(element.dataUrl);
    throw new Error(
      `An image annotation could not be embedded: ${
        error instanceof Error ? error.message : "unknown image error"
      }`,
      { cause: error },
    );
  }
}

async function drawImageElement(
  document: PDFDocument,
  page: PDFPage,
  element: ImageEditorElement,
  transform: PageDrawingTransform,
  cache: Map<string, Promise<PDFImage>>,
  validatedImages: ReadonlyMap<string, ImageDataParts>,
): Promise<void> {
  const bounds = visualRectForElement(
    element,
    transform.visualWidth,
    transform.visualHeight,
  );
  if (bounds.width <= 0 || bounds.height <= 0 || !element.dataUrl) return;
  const image = await embedImage(
    document,
    element,
    cache,
    validatedImages,
  );
  const editorRotation = element.rotation ?? 0;
  const anchor = elementAnchor(bounds, transform, editorRotation);
  page.drawImage(image, {
    x: anchor.x,
    y: anchor.y,
    width: bounds.width,
    height: bounds.height,
    opacity: safeOpacity(element.opacity),
    rotate: degrees(elementPdfRotation(transform, editorRotation)),
  });
}

async function drawElement(
  document: PDFDocument,
  page: PDFPage,
  element: EditorElement,
  fonts: ExportFontManager,
  transform: PageDrawingTransform,
  imageCache: Map<string, Promise<PDFImage>>,
  validatedImages: ReadonlyMap<string, ImageDataParts>,
): Promise<void> {
  if (element.type === "text") {
    await drawTextElement(page, element, fonts, transform);
    return;
  }
  if (
    element.type === "shape" ||
    element.type === "whiteout" ||
    element.type === "highlight"
  ) {
    drawRectElement(page, element, transform);
    return;
  }
  if (element.type === "draw" || element.type === "signature") {
    drawPathElement(page, element, transform);
    return;
  }
  if (element.type === "image") {
    await drawImageElement(
      document,
      page,
      element,
      transform,
      imageCache,
      validatedImages,
    );
  }
}

const SAFE_COPIED_PAGE_KEYS = new Set([
  "Annots",
  "ArtBox",
  "BleedBox",
  "Contents",
  "CropBox",
  "MediaBox",
  "Parent",
  "Resources",
  "Rotate",
  "TrimBox",
  "Type",
  "UserUnit",
]);

/**
 * `copyPages` retains the complete page dictionary. Interactive annotations,
 * additional actions, associated files, and presentation actions therefore
 * have to take the inspected raster path instead of being copied into an
 * edited document.
 */
function sourcePageRequiresFlattening(page: PDFPage): boolean {
  if (
    page.node
      .entries()
      .some(([key]) => !SAFE_COPIED_PAGE_KEYS.has(key.decodeText()))
  ) {
    return true;
  }

  const annotationEntry = page.node.get(PDFName.of("Annots"));
  if (!annotationEntry) return false;

  try {
    const annotations = page.doc.context.lookup(
      annotationEntry,
      PDFArray,
    );
    return annotations.size() > 0;
  } catch {
    // A malformed/indirect annotation tree is still safer to flatten through
    // PDF.js than to copy and silently lose its visible appearance.
    return true;
  }
}

export function sourceTextCleanupGeometry(element: TextEditorElement): {
  backgroundColor: string;
  height: number;
  rotation: number;
  width: number;
  x: number;
  y: number;
} {
  const source = element.sourceText;
  return {
    backgroundColor:
      element.backgroundColor ||
      source?.originalBackgroundColor ||
      "#ffffff",
    height: source?.originalHeight ?? element.height,
    rotation: source?.originalRotation ?? element.rotation ?? 0,
    width: source?.originalWidth ?? element.width,
    x: source?.originalX ?? element.x,
    y: source?.originalY ?? element.y,
  };
}

async function rasterizeSourcePage(
  preview: PdfPreviewDocument,
  sourcePageIndex: number,
  rotation: 0 | 90 | 180 | 270,
  canvasPixelBudget: number,
  sourceTextEdits: TextEditorElement[] = [],
  signal?: AbortSignal,
): Promise<RasterizedSourcePage> {
  if (typeof window === "undefined" || !globalThis.document) {
    throw new Error(
      "A source page must be exported in a browser so edited pixels, annotations, or form widgets can be flattened safely.",
    );
  }

  const pdfPage = await preview.getPage(sourcePageIndex + 1);
  let renderTask: ReturnType<typeof pdfPage.render> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  const cancelRender = () => renderTask?.cancel();

  try {
    throwIfAborted(signal, "PDF export was cancelled.");
    const logicalViewport = pdfPage.getViewport({
      rotation,
      scale: 1,
    });
    if (
      !Number.isFinite(logicalViewport.width) ||
      !Number.isFinite(logicalViewport.height) ||
      logicalViewport.width <= 0 ||
      logicalViewport.height <= 0
    ) {
      throw new Error(
        "The source page has invalid dimensions and cannot be flattened.",
      );
    }
    const logicalCanvasArea =
      logicalViewport.width * logicalViewport.height;
    if (
      !Number.isFinite(logicalCanvasArea) ||
      logicalCanvasArea <= 0
    ) {
      throw securityLimitError({
        code: "editor-raster-pixels-too-large",
        maximum:
          PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixelsTotal,
      });
    }
    if (
      !Number.isSafeInteger(canvasPixelBudget) ||
      canvasPixelBudget < 1
    ) {
      throw securityLimitError({
        code: "editor-raster-pixels-too-large",
        maximum:
          PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixelsTotal,
      });
    }
    const pagePixelBudget = Math.min(
      PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixels,
      canvasPixelBudget,
    );
    const minimumScaleIssue =
      getEditorRasterMinimumScaleLimitIssue(
        logicalViewport.width,
        logicalViewport.height,
        canvasPixelBudget,
      );
    if (minimumScaleIssue) {
      throw securityLimitError(minimumScaleIssue);
    }
    const limitedScale = Math.min(
      PDF_SECURITY_LIMITS.editorRasterTargetScale,
      PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension /
        Math.max(1, logicalViewport.width),
      PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension /
        Math.max(1, logicalViewport.height),
      Math.sqrt(
        pagePixelBudget /
          Math.max(1, logicalCanvasArea),
      ),
    );
    if (
      !Number.isFinite(limitedScale) ||
      limitedScale <
        PDF_SECURITY_LIMITS.editorRasterMinimumScale
    ) {
      throw securityLimitError({
        code: "editor-raster-pixels-too-large",
        maximum:
          PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixelsTotal,
      });
    }
    let renderScale = limitedScale;
    let renderViewport = pdfPage.getViewport({
      rotation,
      scale: renderScale,
    });
    let canvasWidth = Math.max(1, Math.ceil(renderViewport.width));
    let canvasHeight = Math.max(1, Math.ceil(renderViewport.height));

    /*
     * Viewport dimensions are rounded up for the canvas. Refit after rounding
     * so the exact allocation, not only its floating-point estimate, remains
     * inside both the per-page and aggregate pixel budgets.
     */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvasPixels = canvasWidth * canvasHeight;
      if (
        canvasWidth <=
          PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension &&
        canvasHeight <=
          PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension &&
        Number.isSafeInteger(canvasPixels) &&
        canvasPixels <= pagePixelBudget
      ) {
        break;
      }
      const reduction = Math.min(
        PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension /
          canvasWidth,
        PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension /
          canvasHeight,
        Math.sqrt(pagePixelBudget / Math.max(1, canvasPixels)),
      );
      renderScale = Math.max(
        PDF_SECURITY_LIMITS.editorRasterMinimumScale,
        renderScale *
          Math.max(Number.EPSILON, reduction * 0.999),
      );
      renderViewport = pdfPage.getViewport({
        rotation,
        scale: renderScale,
      });
      canvasWidth = Math.max(1, Math.ceil(renderViewport.width));
      canvasHeight = Math.max(1, Math.ceil(renderViewport.height));
    }
    const canvasPixelCount = canvasWidth * canvasHeight;
    if (
      canvasWidth >
        PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension ||
      canvasHeight >
        PDF_SECURITY_LIMITS.maxEditorRasterCanvasDimension ||
      !Number.isSafeInteger(canvasPixelCount) ||
      canvasPixelCount > pagePixelBudget
    ) {
      throw securityLimitError({
        code: "editor-raster-pixels-too-large",
        maximum:
          PDF_SECURITY_LIMITS.maxEditorRasterCanvasPixelsTotal,
      });
    }

    canvas = globalThis.document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    renderTask = pdfPage.render({
      annotationMode: 1, // PDF.js AnnotationMode.ENABLE, including widget appearances.
      background: "#ffffff",
      canvas,
      viewport: renderViewport,
    });
    signal?.addEventListener("abort", cancelRender, { once: true });
    await renderTask.promise;
    throwIfAborted(signal, "PDF export was cancelled.");

    if (sourceTextEdits.length) {
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(
          "The edited source text could not be removed from the flattened page.",
        );
      }

      for (const element of sourceTextEdits) {
        const cleanup = sourceTextCleanupGeometry(element);
        const width = Math.max(1, cleanup.width * canvas.width);
        const height = Math.max(1, cleanup.height * canvas.height);
        const centerX = (cleanup.x + cleanup.width / 2) * canvas.width;
        const centerY = (cleanup.y + cleanup.height / 2) * canvas.height;
        const cleanupPadding = Math.max(
          1,
          Math.min(canvas.width, canvas.height) / 2400,
        );

        context.save();
        context.globalAlpha = 1;
        context.translate(centerX, centerY);
        context.rotate((cleanup.rotation * Math.PI) / 180);
        context.fillStyle = cleanup.backgroundColor;
        context.fillRect(
          -width / 2 - cleanupPadding,
          -height / 2 - cleanupPadding,
          width + cleanupPadding * 2,
          height + cleanupPadding * 2,
        );
        context.restore();
      }
    }

    const bytes = await canvasToPngBytes(canvas);
    throwIfAborted(signal, "PDF export was cancelled.");
    return {
      bytes,
      canvasPixelCount,
      width: logicalViewport.width,
      height: logicalViewport.height,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "RenderingCancelledException"
    ) {
      throw new Error(
        "The source annotation appearance render was cancelled.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelRender);
    renderTask?.cancel();
    pdfPage.cleanup();
    if (canvas) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

async function loadSource(
  sourceBytes: Uint8Array | null,
): Promise<PDFDocument | null> {
  if (!sourceBytes?.byteLength) return null;

  try {
    return await PDFDocument.load(copyBytes(sourceBytes), {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? ` ${error.message}`
        : "";
    throw new Error(
      `The source PDF could not be opened. It may be encrypted or damaged.${reason}`,
      { cause: error },
    );
  }
}

function validatePages(
  pages: EditorPage[],
  source: PDFDocument | null,
): void {
  if (!pages.length) {
    throw new Error("Add at least one page before exporting.");
  }

  const sourcePageCount = source?.getPageCount() ?? 0;
  for (const page of pages) {
    if (
      page.sourcePageIndex !== null &&
      (!source ||
        !Number.isInteger(page.sourcePageIndex) ||
        page.sourcePageIndex < 0 ||
        page.sourcePageIndex >= sourcePageCount)
    ) {
      throw new Error(
        `Page "${page.id}" references a source page that is not available.`,
      );
    }
  }
}

/**
 * Exports the visual editor state without sending bytes outside the current
 * runtime. Source pages stay as their original vector PDF whenever an edited
 * printable-ASCII `Tj` operation can be identified uniquely and neutralized.
 * Ambiguous content streams, positioned/implicit text-show operators,
 * OCR-backed edits, and pages with live annotations use the explicit PDF.js
 * raster fallback so original glyphs or scanned pixels are never recoverable
 * below a replacement.
 */
export async function exportEditedPdf(
  input: ExportEditedPdfInput,
): Promise<ExportEditedPdfResult> {
  report(input.onProgress, 0, "Preparing document");
  let annotationPreview: PdfPreviewDocument | null = null;
  let fontManager: ExportFontManager | null = null;

  try {
    throwIfAborted(input.signal, "PDF export was cancelled.");
    const provisionalElements = input.elements.map((element) =>
      element.type === "image"
        ? { ...element, pixelCount: 1 }
        : element,
    );
    const sourceFileIssue =
      input.sourceBytes === null
        ? null
        : getFileLimitIssue({
            name: "Source PDF",
            size: input.sourceBytes.byteLength,
            type: "application/pdf",
          });
    const resourceIssue =
      getPageCountLimitIssue(input.pages.length) ??
      getEditorSnapshotLimitIssue(provisionalElements) ??
      getTextFieldLimitIssue(
        "Output filename",
        input.filename,
        PDF_SECURITY_LIMITS.maxFilenameCharacters,
      ) ??
      sourceFileIssue;
    if (resourceIssue) {
      throw securityLimitError(resourceIssue);
    }

    const validatedImages = validateEditorImageData(input.elements);
    const verifiedElements = input.elements.map((element) =>
      element.type === "image"
        ? {
            ...element,
            pixelCount:
              validatedImages.get(element.dataUrl)?.pixelCount ?? 0,
          }
        : element,
    );
    const verifiedResourceIssue =
      getEditorSnapshotLimitIssue(verifiedElements);
    if (verifiedResourceIssue) {
      throw securityLimitError(verifiedResourceIssue);
    }

    const source = await loadSource(input.sourceBytes);
    throwIfAborted(input.signal, "PDF export was cancelled.");
    if (source) assertPdfPageTreeWithinLimits(source);
    const sourcePageIssue = source
      ? getPageCountLimitIssue(source.getPageCount())
      : null;
    if (sourcePageIssue) {
      throw securityLimitError(sourcePageIssue);
    }
    validatePages(input.pages, source);
    if (source) {
      assertPdfPageGraphWithinLimits(
        source,
        [
          ...new Set(
            input.pages.flatMap((page) =>
              page.sourcePageIndex === null
                ? []
                : [page.sourcePageIndex],
            ),
          ),
        ],
      );
    }

    const output = await PDFDocument.create();
    const fonts = createExportFontManager(
      output,
      input.fontAssetLoader,
      input.signal,
    );
    fontManager = fonts;
    const imageCache = new Map<string, Promise<PDFImage>>();
    let rasterBudget: EditorRasterBudget = {
      pageCount: 0,
      canvasPixelCount: 0,
      encodedByteCount: 0,
    };
    const elementsByPage = new Map<string, EditorElement[]>();
    for (const element of input.elements) {
      const pageElements = elementsByPage.get(element.pageId) ?? [];
      pageElements.push(element);
      elementsByPage.set(element.pageId, pageElements);
    }
    const nativeTextEvidenceByPage = new Map<
      string,
      NativeTextRewritePageEvidence
    >();
    const duplicateEvidencePageIds = new Set<string>();
    if (
      (input.nativeTextEvidence?.length ?? 0) <=
      PDF_SECURITY_LIMITS.maxPages
    ) {
      for (const evidence of input.nativeTextEvidence ?? []) {
        if (
          duplicateEvidencePageIds.has(evidence.pageId) ||
          nativeTextEvidenceByPage.has(evidence.pageId)
        ) {
          nativeTextEvidenceByPage.delete(evidence.pageId);
          duplicateEvidencePageIds.add(evidence.pageId);
          continue;
        }
        nativeTextEvidenceByPage.set(evidence.pageId, evidence);
      }
    }

    for (let index = 0; index < input.pages.length; index += 1) {
      throwIfAborted(input.signal, "PDF export was cancelled.");
      const model = input.pages[index];
      const sourceWidth = safeDimension(model.sourceWidth, A4_WIDTH);
      const sourceHeight = safeDimension(model.sourceHeight, A4_HEIGHT);
      const pageElements = elementsByPage.get(model.id) ?? [];
      const sourceTextEdits = pageElements.filter(
        (element): element is TextEditorElement =>
          element.type === "text" && Boolean(element.sourceText),
      );
      const nativeSourceTextEdits = sourceTextEdits.filter(
        (element) => element.sourceText?.kind === "native",
      );
      const ocrSourceTextEdits = sourceTextEdits.filter(
        (element) => element.sourceText?.kind === "ocr",
      );
      let page: PDFPage;
      let transform: PageDrawingTransform;
      if (model.sourcePageIndex !== null && source) {
        const sourcePage = source.getPage(model.sourcePageIndex);
        const rotation = quarterTurn(model.sourceRotation + model.rotation);
        for (const edit of sourceTextEdits) {
          if (edit.sourceText?.pageIndex !== model.sourcePageIndex) {
            throw new Error(
              `Text replacement "${edit.id}" references a different source page.`,
            );
          }
        }
        const mustFlattenSourcePage =
          sourcePageRequiresFlattening(sourcePage);
        const pageTextEvidence =
          nativeTextEvidenceByPage.get(model.id);
        const rewrittenContents =
          !mustFlattenSourcePage &&
          ocrSourceTextEdits.length === 0 &&
          nativeSourceTextEdits.length > 0
            ? rewrittenSourcePageContents(
                sourcePage,
                nativeSourceTextEdits,
                pageTextEvidence?.sourcePageIndex ===
                  model.sourcePageIndex
                  ? pageTextEvidence
                  : undefined,
              )
            : null;
        if (
          mustFlattenSourcePage ||
          ocrSourceTextEdits.length > 0 ||
          (nativeSourceTextEdits.length > 0 && !rewrittenContents)
        ) {
          if (!input.sourceBytes?.byteLength) {
            throw new Error(
              `Page ${model.sourcePageIndex + 1} must be flattened but its source bytes are unavailable.`,
            );
          }
          const prospectivePageIssue =
            getEditorRasterBudgetLimitIssue({
              ...rasterBudget,
              pageCount: rasterBudget.pageCount + 1,
              canvasPixelCount:
                rasterBudget.canvasPixelCount + 1,
            });
          if (prospectivePageIssue) {
            throw securityLimitError(prospectivePageIssue);
          }
          annotationPreview ??= await loadPdfPreview(
            input.sourceBytes,
            { signal: input.signal },
          );
          const raster = await rasterizeSourcePage(
            annotationPreview,
            model.sourcePageIndex,
            rotation,
            PDF_SECURITY_LIMITS
              .maxEditorRasterCanvasPixelsTotal -
              rasterBudget.canvasPixelCount,
            sourceTextEdits,
            input.signal,
          );
          const nextRasterBudget: EditorRasterBudget = {
            pageCount: rasterBudget.pageCount + 1,
            canvasPixelCount:
              rasterBudget.canvasPixelCount +
              raster.canvasPixelCount,
            encodedByteCount:
              rasterBudget.encodedByteCount + raster.bytes.byteLength,
          };
          const rasterBudgetIssue =
            getEditorRasterBudgetLimitIssue(nextRasterBudget);
          if (rasterBudgetIssue) {
            throw securityLimitError(rasterBudgetIssue);
          }
          rasterBudget = nextRasterBudget;
          page = output.addPage([raster.width, raster.height]);
          const background = await output.embedPng(raster.bytes);
          page.drawImage(background, {
            x: 0,
            y: 0,
            width: raster.width,
            height: raster.height,
          });
          transform = {
            baseHeight: raster.height,
            baseWidth: raster.width,
            cropX: 0,
            cropY: 0,
            pageRotation: 0,
            visualHeight: raster.height,
            visualWidth: raster.width,
          };
        } else {
          /*
           * copyPages preserves the complete source page dictionary, including
           * empty pages that do not have a /Contents entry. Pages containing
           * annotations, additional actions, associated files, and
           * presentation actions are intentionally handled above. PDF.js
           * paints the static appearance seen by the editor and the export
           * cannot retain their active page-dictionary entries.
           */
          const [copiedPage] = await output.copyPages(source, [
            model.sourcePageIndex,
          ]);
          if (rewrittenContents) {
            replacePageContents(output, copiedPage, rewrittenContents);
          }
          copiedPage.setRotation(degrees(rotation));
          output.addPage(copiedPage);
          page = copiedPage;

          const cropBox = page.getCropBox();
          const turnsSideways = rotation === 90 || rotation === 270;
          transform = {
            baseHeight: cropBox.height,
            baseWidth: cropBox.width,
            cropX: cropBox.x,
            cropY: cropBox.y,
            pageRotation: rotation,
            visualHeight: turnsSideways
              ? cropBox.width
              : cropBox.height,
            visualWidth: turnsSideways
              ? cropBox.height
              : cropBox.width,
          };
        }
      } else {
        const display = pageDisplaySize({
          ...model,
          sourceWidth,
          sourceHeight,
        });
        page = output.addPage([display.width, display.height]);
        transform = {
          baseHeight: display.height,
          baseWidth: display.width,
          cropX: 0,
          cropY: 0,
          pageRotation: 0,
          visualHeight: display.height,
          visualWidth: display.width,
        };
      }

      for (const element of pageElements) {
        throwIfAborted(input.signal, "PDF export was cancelled.");
        await drawElement(
          output,
          page,
          element,
          fonts,
          transform,
          imageCache,
          validatedImages,
        );
      }

      const progress = 8 + ((index + 1) / input.pages.length) * 82;
      report(
        input.onProgress,
        progress,
        sourceTextEdits.length
          ? `Cleaning edited text on page ${index + 1} of ${input.pages.length}`
          : `Rendering page ${index + 1} of ${input.pages.length}`,
      );
    }

    report(input.onProgress, 93, "Saving PDF");
    throwIfAborted(input.signal, "PDF export was cancelled.");
    const bytes = await output.save({
      addDefaultPage: false,
      useObjectStreams: true,
      updateFieldAppearances: false,
    });
    throwIfAborted(input.signal, "PDF export was cancelled.");
    const filename = sanitizeFilename(input.filename);
    report(input.onProgress, 100, "Ready");

    return {
      blob: new Blob([bytes as unknown as BlobPart], {
        type: "application/pdf",
      }),
      filename,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    if (
      error instanceof Error &&
      error.name === "PdfSecurityLimitError"
    ) {
      throw error;
    }
    if (error instanceof PdfEditorFontError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new Error(`PDF export failed: ${error.message}`, {
        cause: error,
      });
    }
    throw new Error("PDF export failed for an unknown reason.", {
      cause: error,
    });
  } finally {
    fontManager?.dispose();
    if (annotationPreview) {
      try {
        await disposePdfPreview(annotationPreview);
      } catch {
        // The export result/error is more important than worker cleanup noise.
      }
    }
  }
}
