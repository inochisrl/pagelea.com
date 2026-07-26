export type EditorTool =
  | "select"
  | "edit-text"
  | "text"
  | "draw"
  | "highlight"
  | "whiteout"
  | "shape"
  | "image"
  | "signature";

export interface EditorPage {
  id: string;
  sourcePageIndex: number | null;
  sourceWidth: number;
  sourceHeight: number;
  sourceRotation: number;
  rotation: number;
}

export interface Point {
  x: number;
  y: number;
}

interface EditorElementBase {
  id: string;
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation?: number;
}

export type EditorFontFamily = "Helvetica" | "Times" | "Courier";

interface SourceTextReference {
  /** Stable PDF.js text-run identifier used to hide the source hit target. */
  id: string;
  /** Zero-based page index in the original PDF. */
  pageIndex: number;
  /** Text as extracted from the source before the user changed it. */
  originalText: string;
  /** Internal PDF.js font key, useful for diagnostics and style matching. */
  fontName: string;
  /** Best-effort CSS family reported by PDF.js. */
  detectedFontFamily?: string;
  /**
   * Immutable visual geometry of the original run. The replacement element
   * can move or resize, but export must always erase the source glyphs here.
   */
  originalX: number;
  originalY: number;
  originalWidth: number;
  originalHeight: number;
  originalRotation: number;
  /** Sampled page color used only when cleaning the original run. */
  originalBackgroundColor: string;
}

export interface TextEditorElement extends EditorElementBase {
  type: "text";
  text: string;
  fontSize: number;
  /** Baseline distance from the top edge, expressed as a font-size multiple. */
  baselineFactor?: number;
  fontFamily?: EditorFontFamily;
  color: string;
  bold: boolean;
  italic: boolean;
  backgroundColor?: string;
  /**
   * Present when this element visually replaces an existing PDF text run.
   * Compatible source operators are neutralized in place; uncertain content
   * uses the raster fallback so old searchable glyphs are never hidden below
   * the replacement.
   */
  sourceText?: SourceTextReference;
}

export interface RectEditorElement extends EditorElementBase {
  type: "shape" | "whiteout" | "highlight";
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface PathEditorElement extends EditorElementBase {
  type: "draw" | "signature";
  /**
   * Coordinates are normalized to the element's own bounding box. This keeps
   * a stroke editable when the element is moved or resized.
   */
  points: Point[];
  color: string;
  strokeWidth: number;
}

export interface ImageEditorElement extends EditorElementBase {
  type: "image";
  dataUrl: string;
  /** Verified decoded pixel count from the PNG/JPEG header. */
  pixelCount: number;
}

export type EditorElement =
  | TextEditorElement
  | RectEditorElement
  | PathEditorElement
  | ImageEditorElement;

export interface EditorSnapshot {
  pages: EditorPage[];
  elements: EditorElement[];
}

function normalizedQuarterTurn(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

/**
 * Returns the visual page size after applying the source page rotation and
 * the editor's relative rotation.
 */
export function pageDisplaySize(page: EditorPage): {
  width: number;
  height: number;
} {
  const width =
    Number.isFinite(page.sourceWidth) && page.sourceWidth > 0
      ? page.sourceWidth
      : 595.28;
  const height =
    Number.isFinite(page.sourceHeight) && page.sourceHeight > 0
      ? page.sourceHeight
      : 841.89;
  const rotation = normalizedQuarterTurn(
    page.sourceRotation + page.rotation,
  );

  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}
