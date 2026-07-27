"use client";

import {
  Bold,
  BringToFront,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Highlighter,
  ImagePlus,
  Italic,
  LoaderCircle,
  Maximize2,
  Move,
  MousePointer2,
  PanelLeft,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  SendToBack,
  ShieldCheck,
  Signature,
  SlidersHorizontal,
  Square,
  TextCursorInput,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { trackAnalyticsEvent } from "../lib/analytics-client";
import {
  awaitBounded,
  createAbortError,
} from "../lib/abort";
import {
  EDITOR_FONT_OPTIONS,
  editorFontCss,
  editorFontLabel,
  inferTextDirection,
  matchExtractedPdfFont,
} from "../lib/pdf-font-matching";
import {
  pageDisplaySize,
  type EditorFontFamily,
  type EditorElement,
  type EditorPage,
  type EditorSnapshot,
  type EditorTool,
  type PathEditorElement,
  type Point,
  type TextEditorElement,
} from "../lib/pdf-editor-types";
import {
  applyFocusedTextReplacement,
  type FocusedTextEditIntent,
} from "../lib/pdf-editor-text-replacement";
import {
  computeEditorFitZoom,
  type EditorFitMode,
} from "../lib/pdf-editor-viewport";
import {
  extractPdfPageText,
  type ExtractedPdfTextFragment,
  type ExtractedPdfTextPage,
} from "../lib/pdf-text-extraction";
import {
  createLocalPdfOcrSession,
  removeOcrFragmentsOverlappingNative,
  type LocalOcrLanguage,
  type LocalOcrProgress,
  type LocalPdfOcrSession,
} from "../lib/pdf-local-ocr";
import {
  disposePdfPreview,
  loadPdfPreview,
  type PdfPreviewDocument,
} from "../lib/pdf-preview";
import {
  decimateSequence,
  describePdfSecurityLimitIssue,
  getEditorPathPointCount,
  getEditorSnapshotLimitIssue,
  getFileLimitIssue,
  getImageDimensionLimitIssue,
  getImageInfoFromBytes,
  getPageCountLimitIssue,
  getReplacementTextContentLimitIssue,
  getTextFieldLimitIssue,
  getTextContentBudget,
  mapWithConcurrency,
  PDF_SECURITY_LIMITS,
  type TextContentBudget,
} from "../lib/pdf-security-limits";
import PdfPageCanvas from "./PdfPageCanvas";
import PrivateRewriteControls, {
  type PrivateRewriteStatus,
} from "./PrivateRewriteControls";
import TextEditFocusPanel from "./TextEditFocusPanel";
import styles from "./PdfEditorWorkspace.module.css";

type EditorPhase = "idle" | "loading" | "ready" | "exporting";
type SignatureMode = "type" | "draw" | "upload";

type Interaction =
  | {
      kind: "move" | "resize";
      pointerId: number;
      elementId: string;
      origin: Point;
      element: EditorElement;
      snapshot: EditorSnapshot;
    }
  | {
      kind: "box";
      pointerId: number;
      elementId: string;
      origin: Point;
      snapshot: EditorSnapshot;
    }
  | {
      kind: "path";
      pointerId: number;
      elementId: string;
      origin: Point;
      absolutePoints: Point[];
      otherPointCount: number;
      snapshot: EditorSnapshot;
    };

type PendingImage = {
  dataUrl: string;
  pixelCount: number;
  signature: boolean;
};

type TextLayerStatus = "idle" | "loading" | "ready" | "empty" | "error";
type WorkspacePanel = "pages" | "properties" | null;

type CanvasTouchGesture =
  | {
      kind: "pan";
      moved: boolean;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
    }
  | {
      kind: "pinch";
      startDistance: number;
      startZoom: number;
    };

type TextLayerState = {
  key: string;
  status: TextLayerStatus;
  message: string;
};

type PrivateRewriteState = {
  key: string;
  message: string;
  progress: number;
  status: PrivateRewriteStatus;
};

type SampledTextColors = {
  background: string;
  foreground: string;
};

type FocusedTextEdit = {
  element: TextEditorElement;
  intent: FocusedTextEditIntent;
};

type TouchTextTarget =
  | {
      kind: "element";
      elementId: string;
      pointerId: number;
      trigger: HTMLElement;
    }
  | {
      kind: "fragment";
      fragment: ExtractedPdfTextFragment;
      pointerId: number;
      trigger: HTMLElement;
    };

const HISTORY_LIMIT = 60;
const DEFAULT_PAGE_WIDTH = 595.28;
const DEFAULT_PAGE_HEIGHT = 841.89;

function uniqueTextFragments(
  fragments: readonly ExtractedPdfTextFragment[],
): ExtractedPdfTextFragment[] {
  const seenIds = new Set<string>();
  return fragments.filter((fragment) => {
    if (seenIds.has(fragment.id)) return false;
    seenIds.add(fragment.id);
    return true;
  });
}

/**
 * Builds one text layer from independently completed native and OCR scans.
 *
 * Each argument may already contain a previously merged page. Filtering by
 * `origin` makes the result independent of which scan completed first, while
 * stable fragment IDs prevent retries from creating duplicate hit targets.
 */
export function mergeExtractedTextPageSources(
  nativePage: ExtractedPdfTextPage | null,
  ocrPage: ExtractedPdfTextPage | null,
): ExtractedPdfTextPage {
  const metadataPage = nativePage ?? ocrPage;
  if (!metadataPage) {
    throw new Error("A native or OCR text page is required.");
  }

  const nativeFragments = uniqueTextFragments(
    (nativePage?.fragments ?? []).filter(
      (fragment) => fragment.origin === "native",
    ),
  );
  const ocrFragments = uniqueTextFragments(
    (ocrPage?.fragments ?? []).filter(
      (fragment) => fragment.origin === "ocr",
    ),
  );

  return {
    ...metadataPage,
    language:
      ocrPage?.language ?? nativePage?.language ?? metadataPage.language,
    fragments: [
      ...nativeFragments,
      ...removeOcrFragmentsOverlappingNative(
        ocrFragments,
        nativeFragments,
      ),
    ],
  };
}

function privateRewriteProgressLabel(
  progress: LocalOcrProgress,
): string {
  switch (progress.stage) {
    case "rendering":
      return "Preparing this page";
    case "loading-engine":
      return "Starting the local OCR engine";
    case "loading-language":
      return "Loading the local language model";
    case "recognizing":
      return "Recognizing text locally";
    case "complete":
      return "Local recognition complete";
  }
}

const TOOL_ITEMS: Array<{
  id: EditorTool;
  label: string;
  icon: typeof MousePointer2;
}> = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "edit-text", label: "Edit text", icon: TextCursorInput },
  { id: "text", label: "Add text", icon: TypeIcon },
  { id: "draw", label: "Draw", icon: PenLine },
  { id: "highlight", label: "Highlight", icon: Highlighter },
  { id: "whiteout", label: "Whiteout", icon: FileText },
  { id: "shape", label: "Shape", icon: Square },
  { id: "image", label: "Image", icon: ImagePlus },
  { id: "signature", label: "Sign", icon: Signature },
];

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundEditorNumber(value: number, decimalPlaces = 1) {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

function normalizedQuarterTurn(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

function textFragmentGeometry(
  fragment: ExtractedPdfTextFragment,
  display: { width: number; height: number },
) {
  const padding = 1.2;

  if (fragment.quad) {
    const point = (value: Point) => ({
      x: value.x * display.width,
      y: value.y * display.height,
    });
    const topLeft = point(fragment.quad.topLeft);
    const topRight = point(fragment.quad.topRight);
    const bottomRight = point(fragment.quad.bottomRight);
    const bottomLeft = point(fragment.quad.bottomLeft);
    const width =
      Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) +
      padding * 2;
    const height =
      Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) +
      padding * 2;
    const center = {
      x:
        (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) /
        4,
      y:
        (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) /
        4,
    };
    const normalizedWidth = clamp(width / display.width, 0.004, 1);
    const normalizedHeight = clamp(height / display.height, 0.004, 1);

    return {
      x: clamp(
        center.x / display.width - normalizedWidth / 2,
        0,
        1 - normalizedWidth,
      ),
      y: clamp(
        center.y / display.height - normalizedHeight / 2,
        0,
        1 - normalizedHeight,
      ),
      width: normalizedWidth,
      height: normalizedHeight,
      rotation: roundEditorNumber(fragment.rotation ?? 0),
    };
  }

  const horizontalPadding = padding / display.width;
  const verticalPadding = padding / display.height;
  const x = clamp(fragment.x - horizontalPadding);
  const y = clamp(fragment.y - verticalPadding);
  const width = clamp(
    fragment.width + horizontalPadding * 2,
    0.004,
    1 - x,
  );
  const height = clamp(
    fragment.height + verticalPadding * 2,
    0.004,
    1 - y,
  );
  return {
    x,
    y,
    width,
    height,
    rotation: roundEditorNumber(fragment.rotation ?? 0),
  };
}

function textBaselineFactor(
  fragment: ExtractedPdfTextFragment,
  display: { width: number; height: number },
) {
  if (!fragment.quad || !fragment.baseline || !fragment.fontSize) {
    return undefined;
  }

  const topLeft = {
    x: fragment.quad.topLeft.x * display.width,
    y: fragment.quad.topLeft.y * display.height,
  };
  const topRight = {
    x: fragment.quad.topRight.x * display.width,
    y: fragment.quad.topRight.y * display.height,
  };
  const baseline = {
    x: fragment.baseline.start.x * display.width,
    y: fragment.baseline.start.y * display.height,
  };
  const edge = {
    x: topRight.x - topLeft.x,
    y: topRight.y - topLeft.y,
  };
  const length = Math.hypot(edge.x, edge.y);
  if (length < 0.001) return undefined;
  const downwardNormal = {
    x: -edge.y / length,
    y: edge.x / length,
  };
  const baselineDistance =
    (baseline.x - topLeft.x) * downwardNormal.x +
    (baseline.y - topLeft.y) * downwardNormal.y;

  return clamp((baselineDistance + 1.2) / fragment.fontSize, 0.25, 1.75);
}

type RgbSample = [number, number, number];

function colorDistance(first: RgbSample, second: RgbSample) {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function dominantColor(samples: RgbSample[], fallback: RgbSample): RgbSample {
  if (!samples.length) return fallback;
  const buckets = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >();

  for (const [red, green, blue] of samples) {
    const key = `${red >> 4}:${green >> 4}:${blue >> 4}`;
    const bucket = buckets.get(key) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  }

  const winner = [...buckets.values()].sort(
    (first, second) => second.count - first.count,
  )[0];
  return [
    Math.round(winner.red / winner.count),
    Math.round(winner.green / winner.count),
    Math.round(winner.blue / winner.count),
  ];
}

function rgbHex([red, green, blue]: RgbSample) {
  return `#${[red, green, blue]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function sampleTextColors(
  surface: HTMLDivElement | null,
  fragment: ExtractedPdfTextFragment,
): SampledTextColors {
  const fallback = {
    background: "#ffffff",
    foreground: "#17221e",
  };
  const canvas = surface?.parentElement?.querySelector("canvas");
  if (!canvas?.width || !canvas.height) return fallback;

  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return fallback;

    const left = clamp(
      Math.floor(fragment.x * canvas.width),
      0,
      canvas.width - 1,
    );
    const top = clamp(
      Math.floor(fragment.y * canvas.height),
      0,
      canvas.height - 1,
    );
    const right = clamp(
      Math.ceil((fragment.x + fragment.width) * canvas.width),
      left + 1,
      canvas.width,
    );
    const bottom = clamp(
      Math.ceil((fragment.y + fragment.height) * canvas.height),
      top + 1,
      canvas.height,
    );
    const band = Math.max(2, Math.min(10, Math.round((bottom - top) * 0.35)));
    const sampleLeft = Math.max(0, left - band);
    const sampleTop = Math.max(0, top - band);
    const sampleRight = Math.min(canvas.width, right + band);
    const sampleBottom = Math.min(canvas.height, bottom + band);
    const regionWidth = sampleRight - sampleLeft;
    const regionHeight = sampleBottom - sampleTop;
    const sampleScale = Math.min(
      1,
      128 / Math.max(regionWidth, regionHeight),
    );
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = Math.max(
      1,
      Math.ceil(regionWidth * sampleScale),
    );
    sampleCanvas.height = Math.max(
      1,
      Math.ceil(regionHeight * sampleScale),
    );
    const sampleContext = sampleCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!sampleContext) return fallback;
    sampleContext.drawImage(
      canvas,
      sampleLeft,
      sampleTop,
      regionWidth,
      regionHeight,
      0,
      0,
      sampleCanvas.width,
      sampleCanvas.height,
    );
    const image = sampleContext.getImageData(
      0,
      0,
      sampleCanvas.width,
      sampleCanvas.height,
    );
    const backgroundSamples: RgbSample[] = [];
    const insideSamples: RgbSample[] = [];
    const insideLeft =
      ((left - sampleLeft) / regionWidth) * image.width;
    const insideTop =
      ((top - sampleTop) / regionHeight) * image.height;
    const insideRight =
      ((right - sampleLeft) / regionWidth) * image.width;
    const insideBottom =
      ((bottom - sampleTop) / regionHeight) * image.height;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        if (image.data[offset + 3] < 180) continue;
        const sample: RgbSample = [
          image.data[offset],
          image.data[offset + 1],
          image.data[offset + 2],
        ];
        if (
          x < insideLeft ||
          x >= insideRight ||
          y < insideTop ||
          y >= insideBottom
        ) {
          backgroundSamples.push(sample);
        } else {
          insideSamples.push(sample);
        }
      }
    }
    sampleContext.clearRect(
      0,
      0,
      sampleCanvas.width,
      sampleCanvas.height,
    );
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;

    const background = dominantColor(backgroundSamples, [255, 255, 255]);
    const inkCandidates = insideSamples.filter(
      (sample) => colorDistance(sample, background) > 44,
    );
    const foreground = dominantColor(inkCandidates, [23, 34, 30]);
    return {
      background: rgbHex(background),
      foreground: fragment.color ?? rgbHex(foreground),
    };
  } catch {
    return {
      ...fallback,
      foreground: fragment.color ?? fallback.foreground,
    };
  }
}

function createBlankPage(): EditorPage {
  return {
    id: makeId("page"),
    sourcePageIndex: null,
    sourceWidth: DEFAULT_PAGE_WIDTH,
    sourceHeight: DEFAULT_PAGE_HEIGHT,
    sourceRotation: 0,
    rotation: 0,
  };
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function imageFileToDataUrl(file: File, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const reader = new FileReader();
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      rejectOnce(createAbortError());
    };

    reader.onload = () => {
      if (settled) return;
      if (typeof reader.result !== "string") {
        rejectOnce(new Error("The image could not be read."));
        return;
      }
      settled = true;
      cleanup();
      resolve(reader.result);
    };
    reader.onerror = () =>
      rejectOnce(reader.error ?? new Error("The image could not be read."));
    reader.onabort = () => rejectOnce(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    reader.readAsDataURL(file);
  });
}

function downloadResult(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function rotateElementClockwise(element: EditorElement): EditorElement {
  const rotatedSourceText =
    element.type === "text" && element.sourceText
      ? {
          ...element.sourceText,
          originalX:
            1 -
            element.sourceText.originalY -
            element.sourceText.originalHeight,
          originalY: element.sourceText.originalX,
          originalWidth: element.sourceText.originalHeight,
          originalHeight: element.sourceText.originalWidth,
          originalRotation:
            (element.sourceText.originalRotation + 90) % 360,
        }
      : undefined;
  const rotatedBase = {
    ...element,
    x: clamp(1 - element.y - element.height),
    y: clamp(element.x),
    width: element.height,
    height: element.width,
  };

  if (element.type === "draw" || element.type === "signature") {
    return {
      ...rotatedBase,
      points: element.points.map((point) => ({
        x: clamp(1 - point.y),
        y: clamp(point.x),
      })),
    } as EditorElement;
  }

  return {
    ...rotatedBase,
    rotation: ((element.rotation ?? 0) + 90) % 360,
    ...(rotatedSourceText ? { sourceText: rotatedSourceText } : {}),
  } as EditorElement;
}

function pathFromAbsolutePoints(
  element: PathEditorElement,
  absolutePoints: Point[],
): PathEditorElement {
  if (absolutePoints.length === 0) return element;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of absolutePoints) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const width = Math.max(right - left, 0.004);
  const height = Math.max(bottom - top, 0.004);

  return {
    ...element,
    x: left,
    y: top,
    width,
    height,
    points: absolutePoints.map((point) => ({
      x: clamp((point.x - left) / width),
      y: clamp((point.y - top) / height),
    })),
  };
}

function stopEvent(event: ReactPointerEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export default function PdfEditorWorkspace({
  immersive = false,
  mode = "edit",
}: {
  immersive?: boolean;
  mode?: "edit" | "sign" | "organize";
}) {
  const analyticsTool =
    mode === "sign"
      ? "sign-pdf"
      : mode === "organize"
        ? "organize-pdf"
        : "pdf-editor";
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const pagesPanelRef = useRef<HTMLElement>(null);
  const propertiesPanelRef = useRef<HTMLElement>(null);
  const focusedTextEditorRef = useRef<HTMLElement>(null);
  const focusedTextInputRef = useRef<HTMLTextAreaElement>(null);
  const focusedTextTriggerRef = useRef<HTMLElement | null>(null);
  const touchTextTargetRef = useRef<TouchTextTarget | null>(null);
  const suppressTextTargetClickRef = useRef(false);
  const pagesToggleRef = useRef<HTMLButtonElement>(null);
  const propertiesToggleRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const previousOpenPanelRef = useRef<WorkspacePanel>(null);
  const editorFocusEnteredRef = useRef(false);
  const restoreExportFocusRef = useRef(false);
  const previewRef = useRef<PdfPreviewDocument | null>(null);
  const loadTokenRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const ocrSessionRef = useRef<LocalPdfOcrSession | null>(null);
  const ocrSessionLanguageRef = useRef<LocalOcrLanguage | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const canvasTouchPointsRef = useRef<Map<number, Point>>(new Map());
  const canvasTouchGestureRef = useRef<CanvasTouchGesture | null>(null);
  const textEditOriginRef = useRef<{
    elementId: string;
    snapshot: EditorSnapshot;
  } | null>(null);
  const inspectorEditOriginRef = useRef<{
    elementId: string;
    snapshot: EditorSnapshot;
  } | null>(null);
  const keyboardActionsRef = useRef<{
    cancelFocusedTextEditing: () => void;
    deleteSelected: () => void;
    editingTextId: string | null;
    focusedTextEditing: boolean;
    finishInspectorEditing: () => void;
    finishTextEditing: () => void;
    redo: () => void;
    selectedId: string | null;
    undo: () => void;
  } | null>(null);

  const [phase, setPhase] = useState<EditorPhase>("idle");
  const [documentName, setDocumentName] = useState("untitled.pdf");
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [previewDocument, setPreviewDocument] =
    useState<PdfPreviewDocument | null>(null);
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({
    pages: [],
    elements: [],
  });
  const snapshotRef = useRef(snapshot);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>(
    mode === "sign" ? "signature" : "select",
  );
  const [zoom, setZoom] = useState(0.9);
  const [fitMode, setFitMode] = useState<EditorFitMode | "custom">(
    "page",
  );
  const [compactLayout, setCompactLayout] = useState(false);
  const [openPanel, setOpenPanel] = useState<WorkspacePanel>(null);
  const [pagesCollapsed, setPagesCollapsed] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({
    value: 0,
    label: "Ready",
  });
  const [signatureMode, setSignatureMode] =
    useState<SignatureMode>(mode === "sign" ? "draw" : "type");
  const [signatureName, setSignatureName] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(
    null,
  );
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [focusedTextEdit, setFocusedTextEdit] =
    useState<FocusedTextEdit | null>(null);
  const [focusedTextEditError, setFocusedTextEditError] = useState("");
  const [textLayerState, setTextLayerState] = useState<TextLayerState>({
    key: "",
    status: "idle",
    message: "",
  });
  const [textPages, setTextPages] = useState<
    Record<string, ExtractedPdfTextPage>
  >({});
  const [ocrLanguage, setOcrLanguage] =
    useState<LocalOcrLanguage>("eng+ita");
  const [privateRewrite, setPrivateRewrite] =
    useState<PrivateRewriteState>({
      key: "",
      message: "Ready to recognize this page locally.",
      progress: 0,
      status: "idle",
    });
  const textPagesRef = useRef(textPages);
  const nativeTextPageKeysRef = useRef<Set<string>>(new Set());
  const textPageBudgetsRef = useRef<
    Record<string, TextContentBudget>
  >({});

  function disposeLocalOcrSession(): Promise<void> {
    ocrAbortRef.current?.abort();
    ocrAbortRef.current = null;
    const session = ocrSessionRef.current;
    ocrSessionRef.current = null;
    ocrSessionLanguageRef.current = null;
    return session
      ? session.dispose().catch(() => undefined)
      : Promise.resolve();
  }

  function clearTextPages() {
    void disposeLocalOcrSession();
    const emptyPages: Record<string, ExtractedPdfTextPage> = {};
    nativeTextPageKeysRef.current.clear();
    textPageBudgetsRef.current = {};
    textPagesRef.current = emptyPages;
    setTextPages(emptyPages);
    setPrivateRewrite({
      key: "",
      message: "Ready to recognize this page locally.",
      progress: 0,
      status: "idle",
    });
  }

  const storeTextPage = useCallback(
    (
      pageKey: string,
      pageId: string,
      textPage: ExtractedPdfTextPage,
    ): string | null => {
      const currentPages = textPagesRef.current;
      const pageKeyPrefix = `${pageId}:`;
      const replacedKeys = Object.keys(currentPages).filter((key) =>
        key.startsWith(pageKeyPrefix),
      );
      const currentBudgets = textPageBudgetsRef.current;
      const replacementBudget = getTextContentBudget(
        textPage.fragments.map((fragment) => fragment.text),
      );
      const budgetIssue = getReplacementTextContentLimitIssue(
        currentBudgets,
        replacedKeys,
        replacementBudget,
      );
      if (budgetIssue) {
        return describePdfSecurityLimitIssue(budgetIssue);
      }

      const retainedPages = Object.fromEntries(
        Object.entries(currentPages).filter(
          ([key]) => !key.startsWith(pageKeyPrefix),
        ),
      );
      const retainedBudgets = Object.fromEntries(
        Object.entries(currentBudgets).filter(
          ([key]) => !key.startsWith(pageKeyPrefix),
        ),
      );
      for (const key of nativeTextPageKeysRef.current) {
        if (key.startsWith(pageKeyPrefix) && key !== pageKey) {
          nativeTextPageKeysRef.current.delete(key);
        }
      }
      const nextPages = {
        ...retainedPages,
        [pageKey]: textPage,
      };
      textPageBudgetsRef.current = {
        ...retainedBudgets,
        [pageKey]: replacementBudget,
      };
      textPagesRef.current = nextPages;
      setTextPages(nextPages);
      return null;
    },
    [],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(
    () => () => {
      loadTokenRef.current += 1;
      loadAbortRef.current?.abort();
      exportAbortRef.current?.abort();
      imageAbortRef.current?.abort();
      ocrAbortRef.current?.abort();
      if (ocrSessionRef.current) {
        void ocrSessionRef.current.dispose().catch(() => undefined);
      }
      if (previewRef.current) {
        void disposePdfPreview(previewRef.current).catch(() => undefined);
      }
    },
    [],
  );

  const activePage =
    snapshot.pages.find((page) => page.id === activePageId) ??
    snapshot.pages[0] ??
    null;
  const selectedElement =
    snapshot.elements.find((element) => element.id === selectedId) ?? null;
  const activePageElements = useMemo(
    () =>
      activePage
        ? snapshot.elements.filter(
            (element) => element.pageId === activePage.id,
          )
        : [],
    [activePage, snapshot.elements],
  );
  const activeTextKey =
    activePage && activePage.sourcePageIndex !== null
      ? `${activePage.id}:${normalizedQuarterTurn(
          activePage.sourceRotation + activePage.rotation,
        )}`
      : "";
  const activeTextPage = activeTextKey
    ? textPages[activeTextKey] ?? null
    : null;
  const replacedSourceTextIds = useMemo(
    () =>
      new Set(
        activePageElements.flatMap((element) =>
          element.type === "text" && element.sourceText
            ? [element.sourceText.id]
            : [],
        ),
      ),
    [activePageElements],
  );
  const activeTextFragments = useMemo(
    () =>
      (activeTextPage?.fragments ?? []).filter(
        (fragment) =>
          fragment.hasGeometry &&
          fragment.text.trim().length > 0 &&
          fragment.width > 0.001 &&
          fragment.height > 0.001 &&
          !replacedSourceTextIds.has(fragment.id),
      ),
    [activeTextPage, replacedSourceTextIds],
  );
  const recognizedOcrLines =
    activeTextPage?.fragments.filter(
      (fragment) => fragment.origin === "ocr",
    ).length ?? 0;
  const activePrivateRewrite =
    privateRewrite.key === activeTextKey
      ? privateRewrite
      : {
          key: activeTextKey,
          message: recognizedOcrLines
            ? "Text on this page was recognized locally."
            : "Ready to recognize this page locally.",
          progress: recognizedOcrLines ? 100 : 0,
          status: recognizedOcrLines
            ? ("ready" as const)
            : ("idle" as const),
        };
  const activeTextLayerStatus: TextLayerStatus = activeTextPage
    ? activeTextPage.fragments.some(
        (fragment) =>
          fragment.hasGeometry && fragment.text.trim().length > 0,
      )
      ? "ready"
      : "empty"
    : textLayerState.key === activeTextKey
      ? textLayerState.status
      : activeTextKey
        ? "loading"
        : "idle";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1120px)");
    const syncLayout = () => {
      setCompactLayout(media.matches);
      if (!media.matches) setOpenPanel(null);
    };

    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll =
      document.body.style.overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [immersive]);

  useEffect(() => {
    if (phase === "idle" || phase === "loading") {
      editorFocusEnteredRef.current = false;
      return;
    }
    if (
      !immersive ||
      phase !== "ready" ||
      editorFocusEnteredRef.current
    ) {
      return;
    }
    editorFocusEnteredRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      editorHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [immersive, phase]);

  useEffect(() => {
    if (phase !== "ready" || !restoreExportFocusRef.current) return;
    restoreExportFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      exportButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    const previousPanel = previousOpenPanelRef.current;
    previousOpenPanelRef.current = openPanel;

    if (openPanel) {
      const panel =
        openPanel === "pages"
          ? pagesPanelRef.current
          : propertiesPanelRef.current;
      const frame = window.requestAnimationFrame(() => {
        panel
          ?.querySelector<HTMLElement>("[data-panel-close]")
          ?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (previousPanel) {
      const toggle =
        previousPanel === "pages"
          ? pagesToggleRef.current
          : propertiesToggleRef.current;
      toggle?.focus({ preventScroll: true });
    }
  }, [openPanel]);

  useEffect(() => {
    if (
      phase !== "ready" ||
      !activePage ||
      focusedTextEdit !== null ||
      fitMode === "custom"
    ) {
      return;
    }

    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const applyFit = () => {
      const bounds = viewport.getBoundingClientRect();
      const display = pageDisplaySize(activePage);
      const phone = window.matchMedia("(max-width: 760px)").matches;
      const compactLandscape =
        bounds.height <= 520 && bounds.width > bounds.height;
      const nextZoom = computeEditorFitZoom({
        horizontalPadding: compactLandscape ? 24 : phone ? 28 : 88,
        mode: fitMode,
        pageHeight: display.height,
        pageWidth: display.width,
        verticalPadding: compactLandscape
          ? phone
            ? 82
            : 24
          : phone
            ? 28
            : 88,
        viewportHeight: bounds.height,
        viewportWidth: bounds.width,
      });
      setZoom((current) =>
        Math.abs(current - nextZoom) < 0.005 ? current : nextZoom,
      );
    };

    applyFit();
    const observer = new ResizeObserver(applyFit);
    observer.observe(viewport);
    window.visualViewport?.addEventListener("resize", applyFit);

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", applyFit);
    };
  }, [
    activePage,
    fitMode,
    focusedTextEdit,
    phase,
  ]);

  useEffect(() => {
    if (
      phase !== "ready" ||
      !previewDocument ||
      !activePage ||
      activePage.sourcePageIndex === null ||
      !activeTextKey
    ) {
      return;
    }

    if (nativeTextPageKeysRef.current.has(activeTextKey)) return;

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setTextLayerState({
          key: activeTextKey,
          status: "loading",
          message: "Finding editable text…",
        });
      }
    });

    void previewDocument
      .getPage(activePage.sourcePageIndex + 1)
      .then(async (page) => {
        try {
          return await extractPdfPageText(page, {
            pageIndex: activePage.sourcePageIndex as number,
            rotation: normalizedQuarterTurn(
              activePage.sourceRotation + activePage.rotation,
            ),
            documentId:
              previewDocument.fingerprints.find(Boolean) ??
              "pagelea-document",
            signal: controller.signal,
          });
        } finally {
          try {
            page.cleanup();
          } catch {
            // The preview may have been destroyed while extraction was active.
          }
        }
      })
      .then((textPage) => {
        if (controller.signal.aborted) return;
        const mergedTextPage = mergeExtractedTextPageSources(
          textPage,
          textPagesRef.current[activeTextKey] ?? null,
        );
        const storageIssue = storeTextPage(
          activeTextKey,
          activePage.id,
          mergedTextPage,
        );
        if (storageIssue) {
          setTextLayerState({
            key: activeTextKey,
            status: "error",
            message: storageIssue,
          });
          setError(storageIssue);
          return;
        }
        nativeTextPageKeysRef.current.add(activeTextKey);
        const hasText = mergedTextPage.fragments.some(
          (fragment) =>
            fragment.hasGeometry && fragment.text.trim().length > 0,
        );
        setTextLayerState({
          key: activeTextKey,
          status: hasText ? "ready" : "empty",
          message: hasText
            ? `${mergedTextPage.fragments.length} text blocks found`
            : "No selectable text found",
        });
      })
      .catch((cause) => {
        if (
          controller.signal.aborted ||
          (cause instanceof Error && cause.name === "AbortError")
        ) {
          return;
        }
        const message =
          cause instanceof Error
            ? cause.message
            : "Text detection failed";
        setTextLayerState({
          key: activeTextKey,
          status: "error",
          message,
        });
        if (
          cause instanceof Error &&
          cause.name === "PdfSecurityLimitError"
        ) {
          setError(message);
        }
      });

    return () => controller.abort();
  }, [
    activePage,
    activeTextKey,
    phase,
    previewDocument,
    storeTextPage,
  ]);

  useEffect(
    () => () => {
      const controller = ocrAbortRef.current;
      controller?.abort();
      if (ocrAbortRef.current === controller) {
        ocrAbortRef.current = null;
      }
    },
    [activeTextKey],
  );

  function localOcrSession(
    language: LocalOcrLanguage,
  ): LocalPdfOcrSession {
    if (
      ocrSessionRef.current &&
      ocrSessionLanguageRef.current === language
    ) {
      return ocrSessionRef.current;
    }

    const previous = ocrSessionRef.current;
    ocrSessionRef.current = createLocalPdfOcrSession({ language });
    ocrSessionLanguageRef.current = language;
    if (previous) {
      void previous.dispose().catch(() => undefined);
    }
    return ocrSessionRef.current;
  }

  function changeOcrLanguage(language: LocalOcrLanguage) {
    if (language === ocrLanguage) return;
    void disposeLocalOcrSession();
    setOcrLanguage(language);
    setPrivateRewrite({
      key: activeTextKey,
      message: "Language changed. Ready to scan this page locally.",
      progress: recognizedOcrLines ? 100 : 0,
      status: recognizedOcrLines ? "ready" : "idle",
    });
  }

  function cancelPrivateRewrite() {
    ocrAbortRef.current?.abort();
    setPrivateRewrite((current) =>
      current.status === "recognizing"
        ? {
            ...current,
            message: "Cancelling local recognition…",
          }
        : current,
    );
  }

  async function recognizeActivePageLocally() {
    if (
      !activePage ||
      activePage.sourcePageIndex === null ||
      !activeTextKey ||
      !previewDocument ||
      activePrivateRewrite.status === "recognizing"
    ) {
      return;
    }

    const page = activePage;
    const pageKey = activeTextKey;
    const pageIndex = page.sourcePageIndex;
    if (pageIndex === null) return;
    const previousOcrLines =
      textPagesRef.current[pageKey]?.fragments.filter(
        (fragment) => fragment.origin === "ocr",
      ).length ?? 0;
    ocrAbortRef.current?.abort();
    const controller = new AbortController();
    ocrAbortRef.current = controller;
    const isCurrentRecognition = () =>
      ocrAbortRef.current === controller;
    const recognitionStartedAt = Date.now();
    let lastOcrProgress = -5;
    let lastOcrProgressLabel = "";
    setError("");
    setPrivateRewrite({
      key: pageKey,
      message: "Preparing this page",
      progress: 0,
      status: "recognizing",
    });
    setProgress({
      value: 0,
      label: "Private Rewrite · preparing this page locally",
    });

    try {
      const pdfPage = await awaitBounded(
        previewDocument.getPage(pageIndex + 1),
        {
          abortMessage: "Local OCR was aborted.",
          onLateResolve: (latePage) => {
            try {
              latePage.cleanup();
            } catch {
              // The preview may already have been disposed.
            }
          },
          signal: controller.signal,
          timeoutMessage:
            "Local OCR could not prepare this page before the runtime limit.",
          timeoutMs:
            PDF_SECURITY_LIMITS.maxOcrRuntimeMilliseconds,
        },
      );
      let ocrPage: ExtractedPdfTextPage;
      try {
        if (!isCurrentRecognition()) return;
        const remainingRuntime = Math.max(
          1,
          PDF_SECURITY_LIMITS.maxOcrRuntimeMilliseconds -
            (Date.now() - recognitionStartedAt),
        );
        ocrPage = await localOcrSession(ocrLanguage).recognizePage(
          pdfPage,
          {
            documentId:
              previewDocument.fingerprints.find(Boolean) ??
              "pagelea-document",
            onProgress: (ocrProgress) => {
              if (
                controller.signal.aborted ||
                !isCurrentRecognition()
              ) {
                return;
              }
              const label = privateRewriteProgressLabel(ocrProgress);
              const value = Math.round(ocrProgress.progress * 100);
              if (
                label === lastOcrProgressLabel &&
                value < lastOcrProgress + 5
              ) {
                return;
              }
              lastOcrProgress = value;
              lastOcrProgressLabel = label;
              setPrivateRewrite((current) =>
                current.key === pageKey
                  ? {
                      ...current,
                      message: label,
                      progress: value,
                    }
                  : current,
              );
            },
            pageIndex,
            pageNumber: pageIndex + 1,
            rotation: normalizedQuarterTurn(
              page.sourceRotation + page.rotation,
            ),
            signal: controller.signal,
            sourceRotation: normalizedQuarterTurn(page.sourceRotation),
            timeoutMs: remainingRuntime,
          },
        );
      } finally {
        try {
          pdfPage.cleanup();
        } catch {
          // The preview may have been replaced while OCR was active.
        }
      }
      if (controller.signal.aborted || !isCurrentRecognition()) return;

      const mergedPage = mergeExtractedTextPageSources(
        textPagesRef.current[pageKey] ?? null,
        ocrPage,
      );
      const storageIssue = storeTextPage(
        pageKey,
        page.id,
        mergedPage,
      );
      if (storageIssue) throw new Error(storageIssue);

      const recognizedLines = mergedPage.fragments.filter(
        (fragment) => fragment.origin === "ocr",
      ).length;
      const nativeLines = mergedPage.fragments.filter(
        (fragment) => fragment.origin === "native",
      ).length;
      const message = recognizedLines
        ? `${recognizedLines} text lines recognized locally.`
        : nativeLines
          ? "No additional scanned text was found."
          : "No text was recognized on this page.";
      setPrivateRewrite({
        key: pageKey,
        message,
        progress: 100,
        status: "ready",
      });
      setTextLayerState({
        key: pageKey,
        message,
        status:
          mergedPage.fragments.length > 0 ? "ready" : "empty",
      });
      setProgress({
        value: 100,
        label: `Private Rewrite · ${message}`,
      });
      setTool("edit-text");
    } catch (cause) {
      if (!isCurrentRecognition()) return;
      const aborted =
        controller.signal.aborted ||
        (cause instanceof Error && cause.name === "AbortError");
      if (aborted) {
        setPrivateRewrite({
          key: pageKey,
          message: previousOcrLines
            ? "Recognition cancelled. Previous local results kept."
            : "Local recognition cancelled.",
          progress: previousOcrLines ? 100 : 0,
          status: previousOcrLines ? "ready" : "idle",
        });
        setProgress({
          value: previousOcrLines ? 100 : 0,
          label: "Private Rewrite · recognition cancelled",
        });
        return;
      }

      const message =
        cause instanceof Error
          ? cause.message
          : "Local text recognition failed.";
      setPrivateRewrite({
        key: pageKey,
        message,
        progress: 0,
        status: "error",
      });
      setError(message);
      setProgress({
        value: 0,
        label: "Private Rewrite · recognition failed",
      });
    } finally {
      if (ocrAbortRef.current === controller) {
        ocrAbortRef.current = null;
      }
    }
  }

  function remember(previous: EditorSnapshot) {
    setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), previous]);
    setFuture([]);
  }

  function assignSnapshot(
    update:
      | EditorSnapshot
      | ((current: EditorSnapshot) => EditorSnapshot),
  ) {
    const current = snapshotRef.current;
    const next =
      typeof update === "function" ? update(current) : update;
    const issue =
      getPageCountLimitIssue(next.pages.length) ??
      getEditorSnapshotLimitIssue(next.elements);
    if (issue) {
      setError(describePdfSecurityLimitIssue(issue));
      return current;
    }
    snapshotRef.current = next;
    setSnapshot(next);
    return next;
  }

  function commit(
    update:
      | EditorSnapshot
      | ((current: EditorSnapshot) => EditorSnapshot),
  ) {
    const current = snapshotRef.current;
    const next =
      typeof update === "function" ? update(current) : update;
    if (next === current) return current;
    const issue =
      getPageCountLimitIssue(next.pages.length) ??
      getEditorSnapshotLimitIssue(next.elements);
    if (issue) {
      setError(describePdfSecurityLimitIssue(issue));
      return current;
    }
    remember(current);
    snapshotRef.current = next;
    setSnapshot(next);
    return next;
  }

  function finishInspectorEditing() {
    const origin = inspectorEditOriginRef.current;
    inspectorEditOriginRef.current = null;
    if (!origin) return;

    const before = origin.snapshot.elements.find(
      (element) => element.id === origin.elementId,
    );
    const after = snapshotRef.current.elements.find(
      (element) => element.id === origin.elementId,
    );
    if (before !== after) remember(origin.snapshot);
  }

  function beginInspectorEditing(elementId: string) {
    if (inspectorEditOriginRef.current?.elementId === elementId) {
      return;
    }
    finishInspectorEditing();
    finishTextEditing();
    inspectorEditOriginRef.current = {
      elementId,
      snapshot: snapshotRef.current,
    };
  }

  function finishTextEditing() {
    const origin = textEditOriginRef.current;
    textEditOriginRef.current = null;
    setEditingTextId(null);
    if (!origin) return;

    const before = origin.snapshot.elements.find(
      (element) => element.id === origin.elementId,
    );
    const after = snapshotRef.current.elements.find(
      (element) => element.id === origin.elementId,
    );
    if (
      before?.type === "text" &&
      after?.type === "text" &&
      before.text !== after.text
    ) {
      remember(origin.snapshot);
    }
  }

  function beginTextEditing(elementId: string) {
    if (editingTextId === elementId) return;
    finishInspectorEditing();
    finishTextEditing();
    textEditOriginRef.current = {
      elementId,
      snapshot: snapshotRef.current,
    };
    setEditingTextId(elementId);
    setSelectedId(elementId);
  }

  function closeFocusedTextEditor(restoreFocus: boolean) {
    const trigger = focusedTextTriggerRef.current;
    focusedTextTriggerRef.current = null;
    setFocusedTextEditError("");
    setFocusedTextEdit(null);
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => {
      const focusTarget =
        trigger?.isConnected === true ? trigger : editorHeadingRef.current;
      focusTarget?.focus({ preventScroll: true });
    });
  }

  function cancelFocusedTextEditing() {
    closeFocusedTextEditor(true);
  }

  function openFocusedTextEditor(
    element: TextEditorElement,
    intent: FocusedTextEdit["intent"],
    trigger?: HTMLElement | null,
  ) {
    finishInspectorEditing();
    finishTextEditing();
    setOpenPanel(null);
    setFitMode("custom");
    setError("");
    setFocusedTextEditError("");
    focusedTextTriggerRef.current =
      trigger ?? (document.activeElement as HTMLElement | null);
    setFocusedTextEdit({
      element: {
        ...element,
        sourceText: element.sourceText
          ? { ...element.sourceText }
          : undefined,
      },
      intent,
    });
  }

  function applyFocusedTextEditing() {
    const edit = focusedTextEdit;
    if (!edit) return;
    const trigger = focusedTextTriggerRef.current;
    const draftedElement: TextEditorElement = {
      ...edit.element,
      direction: inferTextDirection(edit.element.text),
    };
    let appliedElementId = draftedElement.id;
    let outcome: "applied" | "missing" | "unchanged" =
      "missing";
    const before = snapshotRef.current;
    const next = commit((current) => {
      const result = applyFocusedTextReplacement(
        current,
        draftedElement,
        edit.intent,
      );
      appliedElementId = result.elementId;
      outcome = result.outcome;
      return result.snapshot;
    });
    if (outcome === "missing") {
      const message =
        "This text replacement is no longer available. Cancel and select the source text again.";
      setError(message);
      setFocusedTextEditError(message);
      return;
    }
    if (outcome === "applied" && next === before) {
      /*
       * commit reports the active document limit. Keep the transactional
       * editor open so the user can shorten the draft instead of losing it.
       */
      const candidateIssue =
        getPageCountLimitIssue(next.pages.length) ??
        getEditorSnapshotLimitIssue(
          applyFocusedTextReplacement(
            before,
            draftedElement,
            edit.intent,
          ).snapshot.elements,
        );
      const message = candidateIssue
        ? describePdfSecurityLimitIssue(candidateIssue)
        : "This replacement could not be applied. Shorten the new text and try again.";
      setFocusedTextEditError(message);
      window.requestAnimationFrame(() => {
        focusedTextInputRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    setSelectedId(appliedElementId);
    setTool("select");
    if (outcome === "applied") {
      setError("");
      setProgress({
        value: 100,
        label:
          draftedElement.text.length === 0
            ? "Existing text removed locally"
            : "Existing text replaced locally",
      });
    }
    closeFocusedTextEditor(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const resultElement = [
          ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
            "[data-editor-element-id]",
          ) ?? []),
        ].find(
          (element) =>
            element.dataset.editorElementId === appliedElementId,
        );
        const focusTarget =
          trigger?.isConnected === true
            ? trigger
            : resultElement ?? editorHeadingRef.current;
        focusTarget?.focus({ preventScroll: true });
      });
    });
  }

  function undo() {
    textEditOriginRef.current = null;
    inspectorEditOriginRef.current = null;
    setEditingTextId(null);
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([
      snapshotRef.current,
      ...future.slice(0, HISTORY_LIMIT - 1),
    ]);
    assignSnapshot(previous);
    setSelectedId(null);
  }

  function redo() {
    textEditOriginRef.current = null;
    inspectorEditOriginRef.current = null;
    setEditingTextId(null);
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([
      ...past.slice(-(HISTORY_LIMIT - 1)),
      snapshotRef.current,
    ]);
    assignSnapshot(next);
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    finishInspectorEditing();
    textEditOriginRef.current = null;
    setEditingTextId(null);
    commit((current) => ({
      ...current,
      elements: current.elements.filter(
        (element) => element.id !== selectedId,
      ),
    }));
    setSelectedId(null);
  }

  useEffect(() => {
    keyboardActionsRef.current = {
      cancelFocusedTextEditing,
      deleteSelected,
      editingTextId,
      focusedTextEditing: focusedTextEdit !== null,
      finishInspectorEditing,
      finishTextEditing,
      redo,
      selectedId,
      undo,
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const actions = keyboardActionsRef.current;
      if (!actions) return;
      if (actions.focusedTextEditing) {
        if (event.key === "Escape") {
          event.preventDefault();
          actions.cancelFocusedTextEditing();
        }
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (
        command &&
        event.key.toLowerCase() === "z" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        actions.selectedId &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        actions.deleteSelected();
      }
      if (event.key === "Escape") {
        setOpenPanel(null);
        actions.finishInspectorEditing();
        if (actions.editingTextId) {
          actions.finishTextEditing();
          return;
        }
        interactionRef.current = null;
        setSelectedId(null);
        setTool("select");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function replacePreview(next: PdfPreviewDocument | null) {
    const previous = previewRef.current;
    previewRef.current = next;
    setPreviewDocument(next);
    if (previous && previous !== next) {
      await disposePdfPreview(previous).catch(() => undefined);
    }
  }

  async function openPdf(file: File) {
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Choose a PDF file to open in the editor.");
      return;
    }

    const fileLimitIssue = getFileLimitIssue(file);
    if (fileLimitIssue) {
      setError(describePdfSecurityLimitIssue(fileLimitIssue));
      return;
    }

    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    loadAbortRef.current?.abort();
    const loadController = new AbortController();
    loadAbortRef.current = loadController;
    const token = ++loadTokenRef.current;
    clearTextPages();
    textEditOriginRef.current = null;
    inspectorEditOriginRef.current = null;
    setEditingTextId(null);
    setTextLayerState({ key: "", status: "idle", message: "" });
    setError("");
    setPhase("loading");
    setProgress({ value: 12, label: "Reading PDF locally" });

    let candidateDocument: PdfPreviewDocument | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (
        loadController.signal.aborted ||
        token !== loadTokenRef.current
      ) {
        throw createAbortError();
      }

      candidateDocument = await loadPdfPreview(bytes, {
        signal: loadController.signal,
      });
      if (
        loadController.signal.aborted ||
        token !== loadTokenRef.current
      ) {
        throw createAbortError();
      }

      const pageLimitIssue = getPageCountLimitIssue(
        candidateDocument.numPages,
      );
      if (pageLimitIssue) {
        throw new Error(
          describePdfSecurityLimitIssue(pageLimitIssue),
        );
      }

      const pageIndexes = Array.from(
        { length: candidateDocument.numPages },
        (_, index) => index,
      );
      let preparedPages = 0;
      const progressStep = Math.max(
        1,
        Math.ceil(candidateDocument.numPages / 10),
      );
      const pages = await mapWithConcurrency(
        pageIndexes,
        PDF_SECURITY_LIMITS.pageMetadataConcurrency,
        async (index, _itemIndex, signal) => {
          if (signal?.aborted) throw createAbortError();
          const sourcePage = await candidateDocument!.getPage(index + 1);
          try {
            if (signal?.aborted) throw createAbortError();
            const [left, bottom, right, top] = sourcePage.view;
            preparedPages += 1;
            if (
              preparedPages === candidateDocument!.numPages ||
              preparedPages % progressStep === 0
            ) {
              setProgress({
                value:
                  18 +
                  Math.round(
                    (preparedPages / candidateDocument!.numPages) * 62,
                  ),
                label: `Preparing page ${preparedPages} of ${candidateDocument!.numPages}`,
              });
            }
            return {
              id: makeId("page"),
              sourcePageIndex: index,
              sourceWidth: Math.abs(right - left),
              sourceHeight: Math.abs(top - bottom),
              sourceRotation: sourcePage.rotate,
              rotation: 0,
            } satisfies EditorPage;
          } finally {
            try {
              sourcePage.cleanup();
            } catch {
              // A stale PDF.js page can already be cleaned by document teardown.
            }
          }
        },
        loadController.signal,
      );

      if (
        loadController.signal.aborted ||
        token !== loadTokenRef.current
      ) {
        throw createAbortError();
      }

      if (!pages.length) {
        throw new Error("This PDF has no pages.");
      }

      const adoptedDocument = candidateDocument;
      await replacePreview(adoptedDocument);
      candidateDocument = null;

      if (
        loadController.signal.aborted ||
        token !== loadTokenRef.current
      ) {
        if (previewRef.current === adoptedDocument) {
          await replacePreview(null);
        }
        throw createAbortError();
      }

      setSourceBytes(bytes);
      const editedName =
        file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
      setDocumentName(
        editedName.slice(
          0,
          PDF_SECURITY_LIMITS.maxFilenameCharacters,
        ),
      );
      assignSnapshot({ pages, elements: [] });
      setPast([]);
      setFuture([]);
      setActivePageId(pages[0].id);
      setSelectedId(null);
      setFitMode("page");
      setOpenPanel(null);
      setTool(
        mode === "sign"
          ? "signature"
          : mode === "organize"
            ? "select"
            : "edit-text",
      );
      setProgress({ value: 100, label: "PDF ready" });
      setPhase("ready");
    } catch (cause) {
      if (
        loadController.signal.aborted ||
        token !== loadTokenRef.current ||
        (cause instanceof Error && cause.name === "AbortError")
      ) {
        return;
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "The PDF could not be opened.",
      );
      setPhase(snapshotRef.current.pages.length ? "ready" : "idle");
    } finally {
      if (candidateDocument) {
        await disposePdfPreview(candidateDocument).catch(() => undefined);
      }
      if (loadAbortRef.current === loadController) {
        loadAbortRef.current = null;
      }
    }
  }

  async function createBlankDocument() {
    exportAbortRef.current?.abort();
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    loadTokenRef.current += 1;
    clearTextPages();
    textEditOriginRef.current = null;
    inspectorEditOriginRef.current = null;
    setEditingTextId(null);
    setTextLayerState({ key: "", status: "idle", message: "" });
    await replacePreview(null);
    const page = createBlankPage();
    setSourceBytes(null);
    setDocumentName("untitled.pdf");
    assignSnapshot({ pages: [page], elements: [] });
    setPast([]);
    setFuture([]);
    setActivePageId(page.id);
    setSelectedId(null);
    setFitMode("page");
    setOpenPanel(null);
    setTool(
      mode === "sign"
        ? "signature"
        : mode === "organize"
          ? "select"
          : "text",
    );
    setError("");
    setProgress({ value: 100, label: "Blank document ready" });
    setPhase("ready");
  }

  function onPdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void openPdf(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void openPdf(file);
  }

  function updateElement(
    id: string,
    patch: Partial<EditorElement>,
    track = true,
  ) {
    const apply = (current: EditorSnapshot): EditorSnapshot => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === id
          ? ({ ...element, ...patch } as EditorElement)
          : element,
      ),
    });
    if (track) commit(apply);
    else assignSnapshot(apply);
  }

  function updateSelected(patch: Partial<EditorElement>) {
    if (selectedId) updateElement(selectedId, patch);
  }

  function updateSelectedContinuously(
    patch: Partial<EditorElement>,
  ) {
    if (!selectedId) return;
    beginInspectorEditing(selectedId);
    updateElement(selectedId, patch, false);
  }

  function selectTool(nextTool: EditorTool) {
    finishInspectorEditing();
    finishTextEditing();
    setError("");
    setSelectedId(null);
    if (nextTool === "edit-text" && activePage?.sourcePageIndex === null) {
      setError(
        "This blank page has no source text. Use Add text to write on it.",
      );
      setTool("text");
      return;
    }
    if (nextTool === "image") {
      imageInputRef.current?.click();
      return;
    }
    setPendingImage(null);
    setTool(nextTool);
  }

  async function receiveImage(
    event: ChangeEvent<HTMLInputElement>,
    signature: boolean,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(?:png|jpe?g)$/i.test(file.type)) {
      setError("Use a PNG or JPEG image.");
      return;
    }

    const fileLimitIssue = getFileLimitIssue(file);
    if (fileLimitIssue) {
      setError(describePdfSecurityLimitIssue(fileLimitIssue));
      return;
    }

    imageAbortRef.current?.abort();
    const imageController = new AbortController();
    imageAbortRef.current = imageController;
    setError("");

    try {
      const headerBytes = new Uint8Array(
        await file
          .slice(0, PDF_SECURITY_LIMITS.maxImageHeaderBytes)
          .arrayBuffer(),
      );
      if (imageController.signal.aborted) throw createAbortError();
      const imageInfo = getImageInfoFromBytes(headerBytes);
      if (!imageInfo) {
        setError(
          describePdfSecurityLimitIssue({
            code: "invalid-image-dimensions",
            fileName: file.name,
          }),
        );
        return;
      }
      const declaredKind = /png/i.test(file.type)
        ? "png"
        : "jpeg";
      if (imageInfo.kind !== declaredKind) {
        setError(
          `${file.name} does not match its declared ${declaredKind.toUpperCase()} format.`,
        );
        return;
      }
      const dimensionIssue = getImageDimensionLimitIssue(
        file.name,
        imageInfo.width,
        imageInfo.height,
      );
      if (dimensionIssue) {
        setError(describePdfSecurityLimitIssue(dimensionIssue));
        return;
      }

      const dataUrl = await imageFileToDataUrl(
        file,
        imageController.signal,
      );
      if (imageController.signal.aborted) return;
      const pixelCount = imageInfo.width * imageInfo.height;
      const reusableImage = snapshotRef.current.elements.find(
        (element) =>
          element.type === "image" && element.dataUrl === dataUrl,
      );
      const retainedDataUrl =
        reusableImage?.type === "image"
          ? reusableImage.dataUrl
          : dataUrl;
      const candidateIssue = getEditorSnapshotLimitIssue([
        ...snapshotRef.current.elements,
        {
          dataUrl: retainedDataUrl,
          pageId: activePage?.id ?? "__pending-image__",
          pixelCount,
          type: "image",
        },
      ]);
      if (candidateIssue) {
        setError(describePdfSecurityLimitIssue(candidateIssue));
        return;
      }
      setPendingImage({
        dataUrl: retainedDataUrl,
        pixelCount,
        signature,
      });
      setSignatureMode(signature ? "upload" : signatureMode);
      setTool(signature ? "signature" : "image");
      setSelectedId(null);
      setProgress({
        value: 100,
        label: signature
          ? "Click the page to place the signature"
          : "Click the page to place the image",
      });
    } catch (cause) {
      if (
        imageController.signal.aborted ||
        (cause instanceof Error && cause.name === "AbortError")
      ) {
        return;
      }
      setError(
        cause instanceof Error ? cause.message : "The image could not load.",
      );
    } finally {
      if (imageAbortRef.current === imageController) {
        imageAbortRef.current = null;
      }
    }
  }

  function pointFromEvent(
    event: Pick<PointerEvent, "clientX" | "clientY">,
  ): Point | null {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }

  function capturePointer(pointerId: number) {
    try {
      surfaceRef.current?.setPointerCapture(pointerId);
    } catch {
      // The interaction still works while the pointer remains on the page.
    }
  }

  function placeImmediateElement(point: Point) {
    if (!activePage) return;
    const id = makeId("element");
    let element: EditorElement | null = null;

    if (tool === "text") {
      element = {
        id,
        pageId: activePage.id,
        type: "text",
        x: clamp(point.x, 0, 0.68),
        y: clamp(point.y, 0, 0.92),
        width: 0.3,
        height: 0.075,
        opacity: 1,
        text: "Type here",
        fontSize: 18,
        fontFamily: "Helvetica",
        direction: "ltr",
        color: "#17221e",
        bold: false,
        italic: false,
      };
    } else if (tool === "image" && pendingImage) {
      element = {
        id,
        pageId: activePage.id,
        type: "image",
        x: clamp(point.x, 0, 0.72),
        y: clamp(point.y, 0, 0.72),
        width: 0.25,
        height: 0.2,
        opacity: 1,
        dataUrl: pendingImage.dataUrl,
        pixelCount: pendingImage.pixelCount,
      };
    } else if (tool === "signature" && signatureMode === "type") {
      if (!signatureName.trim()) {
        setError("Type your name in the signature panel first.");
        return;
      }
      element = {
        id,
        pageId: activePage.id,
        type: "text",
        x: clamp(point.x, 0, 0.58),
        y: clamp(point.y, 0, 0.88),
        width: 0.38,
        height: 0.1,
        opacity: 1,
        text: signatureName.trim(),
        fontSize: 34,
        fontFamily: "Helvetica",
        direction: inferTextDirection(signatureName.trim()),
        color: "#17221e",
        bold: false,
        italic: true,
      };
    } else if (
      tool === "signature" &&
      signatureMode === "upload" &&
      pendingImage?.signature
    ) {
      element = {
        id,
        pageId: activePage.id,
        type: "image",
        x: clamp(point.x, 0, 0.64),
        y: clamp(point.y, 0, 0.82),
        width: 0.34,
        height: 0.14,
        opacity: 1,
        dataUrl: pendingImage.dataUrl,
        pixelCount: pendingImage.pixelCount,
      };
    }

    if (!element) return;
    const before = snapshotRef.current;
    const next = commit((current) => ({
      ...current,
      elements: [...current.elements, element as EditorElement],
    }));
    if (next === before) return;
    setSelectedId(id);
    setTool("select");
    if (element.type === "image") setPendingImage(null);
  }

  function beginExistingTextEdit(
    fragment: ExtractedPdfTextFragment,
    trigger?: HTMLElement | null,
    preferFocusedEditor = false,
  ) {
    if (!activePage || activePage.sourcePageIndex === null) return;
    const display = pageDisplaySize(activePage);
    const geometry = textFragmentGeometry(fragment, display);
    const colors = sampleTextColors(surfaceRef.current, fragment);
    const matchedFont = matchExtractedPdfFont(fragment);
    const sourceTextBase = {
      id: fragment.id,
      pageIndex: activePage.sourcePageIndex,
      originalText: fragment.text,
      fontName: fragment.fontName,
      detectedFontFamily: fragment.fontFamily,
      detectedFontName: matchedFont.sourceName,
      fontMatchConfidence: matchedFont.confidence,
      originalX: geometry.x,
      originalY: geometry.y,
      originalWidth: geometry.width,
      originalHeight: geometry.height,
      originalRotation: geometry.rotation,
      originalBackgroundColor: colors.background,
    };
    const element: TextEditorElement = {
      id: makeId("source-text"),
      pageId: activePage.id,
      type: "text",
      ...geometry,
      opacity: 1,
      text: fragment.text,
      fontSize: clamp(
        roundEditorNumber(fragment.fontSize ?? 12),
        4,
        240,
      ),
      baselineFactor: textBaselineFactor(fragment, display),
      fontFamily: matchedFont.family,
      direction: inferTextDirection(fragment.text, fragment.direction),
      color: colors.foreground,
      bold: matchedFont.bold,
      italic: matchedFont.italic,
      backgroundColor: colors.background,
      sourceText:
        fragment.origin === "ocr"
          ? {
              ...sourceTextBase,
              kind: "ocr",
              language: activeTextPage?.language ?? "und",
              confidence: fragment.confidence ?? 0,
            }
          : {
              ...sourceTextBase,
              kind: "native",
            },
    };

    if (compactLayout || preferFocusedEditor) {
      openFocusedTextEditor(element, "create", trigger);
      return;
    }

    const before = snapshotRef.current;
    const next = commit((current) => ({
      ...current,
      elements: [...current.elements, element],
    }));
    if (next === before) return;
    setTool("select");
    setError("");
    setProgress({
      value: 100,
      label: "Editing existing text · saved locally",
    });
    beginTextEditing(element.id);
  }

  function onSurfacePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePage || event.button !== 0) return;

    if (
      event.pointerType === "touch" &&
      (tool === "select" || tool === "edit-text")
    ) {
      event.preventDefault();
      const points = canvasTouchPointsRef.current;
      points.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can be unavailable during browser gesture handoff.
      }

      if (points.size >= 2) {
        const [first, second] = [...points.values()];
        canvasTouchGestureRef.current = {
          kind: "pinch",
          startDistance: Math.max(
            1,
            Math.hypot(second.x - first.x, second.y - first.y),
          ),
          startZoom: zoom,
        };
        setFitMode("custom");
      } else {
        const scroller = canvasViewportRef.current;
        canvasTouchGestureRef.current = {
          kind: "pan",
          moved: false,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: scroller?.scrollLeft ?? 0,
          startScrollTop: scroller?.scrollTop ?? 0,
        };
      }
      return;
    }

    const point = pointFromEvent(event.nativeEvent);
    if (!point) return;

    if (tool === "select") {
      finishInspectorEditing();
      finishTextEditing();
      setSelectedId(null);
      return;
    }

    if (
      tool === "text" ||
      tool === "image" ||
      (tool === "signature" && signatureMode !== "draw")
    ) {
      stopEvent(event);
      placeImmediateElement(point);
      return;
    }

    const id = makeId("element");
    const previous = snapshotRef.current;

    if (
      tool === "shape" ||
      tool === "highlight" ||
      tool === "whiteout"
    ) {
      stopEvent(event);
      const element: EditorElement = {
        id,
        pageId: activePage.id,
        type: tool,
        x: point.x,
        y: point.y,
        width: 0.004,
        height: 0.004,
        opacity: tool === "highlight" ? 0.38 : 1,
        fill:
          tool === "whiteout"
            ? "#ffffff"
            : tool === "highlight"
              ? "#ffe15d"
              : "#c8f2df",
        stroke: tool === "shape" ? "#0f9f6e" : "transparent",
        strokeWidth: tool === "shape" ? 2 : 0,
      };
      const next = assignSnapshot((current) => ({
        ...current,
        elements: [...current.elements, element],
      }));
      if (next === previous) return;
      setSelectedId(id);
      interactionRef.current = {
        kind: "box",
        pointerId: event.pointerId,
        elementId: id,
        origin: point,
        snapshot: previous,
      };
      capturePointer(event.pointerId);
      return;
    }

    if (
      tool === "draw" ||
      (tool === "signature" && signatureMode === "draw")
    ) {
      stopEvent(event);
      const element: PathEditorElement = {
        id,
        pageId: activePage.id,
        type: tool === "draw" ? "draw" : "signature",
        x: point.x,
        y: point.y,
        width: 0.004,
        height: 0.004,
        opacity: 1,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        color: "#17221e",
        strokeWidth: tool === "draw" ? 2.2 : 2.8,
      };
      const next = assignSnapshot((current) => ({
        ...current,
        elements: [...current.elements, element],
      }));
      if (next === previous) return;
      setSelectedId(id);
      interactionRef.current = {
        kind: "path",
        pointerId: event.pointerId,
        elementId: id,
        origin: point,
        absolutePoints: [point],
        otherPointCount: getEditorPathPointCount(
          previous.elements,
        ),
        snapshot: previous,
      };
      capturePointer(event.pointerId);
    }
  }

  function beginElementInteraction(
    event: ReactPointerEvent<HTMLElement>,
    element: EditorElement,
    kind: "move" | "resize",
  ) {
    if (event.button !== 0) return;
    if (editingTextId === element.id) return;
    if (
      tool === "edit-text" &&
      kind === "move" &&
      element.type === "text" &&
      element.sourceText
    ) {
      if (event.pointerType === "touch") {
        touchTextTargetRef.current = {
          kind: "element",
          elementId: element.id,
          pointerId: event.pointerId,
          trigger: event.currentTarget,
        };
      }
      return;
    }
    if (tool !== "select") return;
    if (
      event.pointerType === "touch" &&
      kind === "move" &&
      event.currentTarget.dataset.touchMoveHandle !== "true"
    ) {
      touchTextTargetRef.current = {
        kind: "element",
        elementId: element.id,
        pointerId: event.pointerId,
        trigger: event.currentTarget,
      };
      return;
    }
    finishInspectorEditing();
    finishTextEditing();
    stopEvent(event);
    const point = pointFromEvent(event.nativeEvent);
    if (!point) return;
    setSelectedId(element.id);
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      elementId: element.id,
      origin: point,
      element,
      snapshot: snapshotRef.current,
    };
    capturePointer(event.pointerId);
  }

  function activateEditorElement(
    element: EditorElement,
    trigger: HTMLElement,
    preferFocusedEditor = false,
  ) {
    const canUseFocusedEditor =
      element.type === "text" &&
      Boolean(element.sourceText) &&
      (compactLayout || preferFocusedEditor);
    if (
      canUseFocusedEditor &&
      (selectedId === element.id || tool === "edit-text")
    ) {
      openFocusedTextEditor(
        element as TextEditorElement,
        "update",
        trigger,
      );
      return;
    }
    setSelectedId(element.id);
  }

  function onSurfacePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (canvasTouchPointsRef.current.has(event.pointerId)) {
      event.preventDefault();
      canvasTouchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const gesture = canvasTouchGestureRef.current;
      const scroller = canvasViewportRef.current;
      if (!gesture || !scroller) return;

      if (
        gesture.kind === "pinch" &&
        canvasTouchPointsRef.current.size >= 2
      ) {
        const [first, second] = [
          ...canvasTouchPointsRef.current.values(),
        ];
        const distance = Math.max(
          1,
          Math.hypot(second.x - first.x, second.y - first.y),
        );
        setZoom(
          clamp(
            gesture.startZoom * (distance / gesture.startDistance),
            0.1,
            4,
          ),
        );
        return;
      }

      if (
        gesture.kind === "pan" &&
        gesture.pointerId === event.pointerId
      ) {
        const deltaX = event.clientX - gesture.startClientX;
        const deltaY = event.clientY - gesture.startClientY;
        if (Math.hypot(deltaX, deltaY) > 5) gesture.moved = true;
        scroller.scrollLeft = gesture.startScrollLeft - deltaX;
        scroller.scrollTop = gesture.startScrollTop - deltaY;
      }
      return;
    }

    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event.nativeEvent);
    if (!point) return;
    event.preventDefault();

    if (interaction.kind === "move") {
      const dx = point.x - interaction.origin.x;
      const dy = point.y - interaction.origin.y;
      updateElement(
        interaction.elementId,
        {
          x: clamp(
            interaction.element.x + dx,
            0,
            1 - interaction.element.width,
          ),
          y: clamp(
            interaction.element.y + dy,
            0,
            1 - interaction.element.height,
          ),
        },
        false,
      );
      return;
    }

    if (interaction.kind === "resize") {
      updateElement(
        interaction.elementId,
        {
          width: clamp(
            interaction.element.width +
              point.x -
              interaction.origin.x,
            0.025,
            1 - interaction.element.x,
          ),
          height: clamp(
            interaction.element.height +
              point.y -
              interaction.origin.y,
            0.02,
            1 - interaction.element.y,
          ),
        },
        false,
      );
      return;
    }

    if (interaction.kind === "box") {
      updateElement(
        interaction.elementId,
        {
          x: Math.min(interaction.origin.x, point.x),
          y: Math.min(interaction.origin.y, point.y),
          width: Math.max(
            Math.abs(point.x - interaction.origin.x),
            0.004,
          ),
          height: Math.max(
            Math.abs(point.y - interaction.origin.y),
            0.004,
          ),
        },
        false,
      );
      return;
    }

    if (interaction.kind !== "path") return;

    const distance =
      Math.abs(
        point.x -
          interaction.absolutePoints[interaction.absolutePoints.length - 1]
            .x,
      ) +
      Math.abs(
        point.y -
          interaction.absolutePoints[interaction.absolutePoints.length - 1]
            .y,
    );
    if (distance < 0.002) return;
    const pointLimit = Math.min(
      PDF_SECURITY_LIMITS.maxEditorPathPointsPerElement,
      PDF_SECURITY_LIMITS.maxEditorPathPointsTotal -
        interaction.otherPointCount,
    );
    if (pointLimit < 2) {
      setError(
        describePdfSecurityLimitIssue({
          code: "too-many-editor-path-points",
          scope: "document",
          maximum: PDF_SECURITY_LIMITS.maxEditorPathPointsTotal,
        }),
      );
      return;
    }

    const retainedPoints =
      interaction.absolutePoints.length >= pointLimit
        ? decimateSequence(
            interaction.absolutePoints,
            Math.max(1, Math.floor(pointLimit / 2)),
          )
        : interaction.absolutePoints;
    const nextAbsolutePoints = [...retainedPoints, point];
    const before = snapshotRef.current;
    const next = assignSnapshot((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === interaction.elementId &&
        (element.type === "draw" || element.type === "signature")
          ? pathFromAbsolutePoints(element, nextAbsolutePoints)
          : element,
      ),
    }));
    if (next !== before) {
      interaction.absolutePoints = nextAbsolutePoints;
    }
  }

  function finishInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    if (canvasTouchPointsRef.current.has(event.pointerId)) {
      event.preventDefault();
      const gesture = canvasTouchGestureRef.current;
      const touchTarget =
        touchTextTargetRef.current?.pointerId === event.pointerId
          ? touchTextTargetRef.current
          : null;
      if (touchTarget) touchTextTargetRef.current = null;
      canvasTouchPointsRef.current.delete(event.pointerId);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released by the browser.
      }

      const remaining = [...canvasTouchPointsRef.current.entries()];
      if (remaining.length === 1) {
        const [pointerId, point] = remaining[0];
        const scroller = canvasViewportRef.current;
        canvasTouchGestureRef.current = {
          kind: "pan",
          moved: true,
          pointerId,
          startClientX: point.x,
          startClientY: point.y,
          startScrollLeft: scroller?.scrollLeft ?? 0,
          startScrollTop: scroller?.scrollTop ?? 0,
        };
      } else {
        canvasTouchGestureRef.current = null;
      }

      if (
        event.type === "pointerup" &&
        remaining.length === 0 &&
        gesture?.kind === "pan" &&
        !gesture.moved &&
        touchTarget
      ) {
        suppressTextTargetClickRef.current = true;
        window.setTimeout(() => {
          suppressTextTargetClickRef.current = false;
        }, 0);
        if (touchTarget.kind === "fragment") {
          beginExistingTextEdit(
            touchTarget.fragment,
            touchTarget.trigger,
            true,
          );
        } else {
          const element = snapshotRef.current.elements.find(
            (candidate) => candidate.id === touchTarget.elementId,
          );
          if (element) {
            activateEditorElement(
              element,
              touchTarget.trigger,
              true,
            );
          }
        }
        return;
      }

      if (
        gesture?.kind === "pan" &&
        !gesture.moved &&
        tool === "select"
      ) {
        finishInspectorEditing();
        finishTextEditing();
        setSelectedId(null);
      }
      return;
    }

    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    interactionRef.current = null;
    try {
      surfaceRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released by the browser.
    }
    if (snapshotRef.current !== interaction.snapshot) {
      remember(interaction.snapshot);
    }
    setTool("select");
  }

  function addBlankPage() {
    finishInspectorEditing();
    finishTextEditing();
    const page = createBlankPage();
    const before = snapshotRef.current;
    const next = commit((current) => {
      const activeIndex = current.pages.findIndex(
        (candidate) => candidate.id === activePage?.id,
      );
      const pages = [...current.pages];
      pages.splice(activeIndex < 0 ? pages.length : activeIndex + 1, 0, page);
      return { ...current, pages };
    });
    if (next === before) return;
    setActivePageId(page.id);
    setSelectedId(null);
  }

  function deleteActivePage() {
    if (!activePage || snapshot.pages.length <= 1) return;
    finishInspectorEditing();
    finishTextEditing();
    const currentIndex = snapshot.pages.findIndex(
      (page) => page.id === activePage.id,
    );
    const nextPages = snapshot.pages.filter(
      (page) => page.id !== activePage.id,
    );
    commit((current) => ({
      pages: current.pages.filter((page) => page.id !== activePage.id),
      elements: current.elements.filter(
        (element) => element.pageId !== activePage.id,
      ),
    }));
    setActivePageId(
      nextPages[Math.min(currentIndex, nextPages.length - 1)]?.id ?? null,
    );
    setSelectedId(null);
  }

  function rotateActivePage() {
    if (!activePage) return;
    finishInspectorEditing();
    finishTextEditing();
    commit((current) => ({
      pages: current.pages.map((page) =>
        page.id === activePage.id
          ? { ...page, rotation: (page.rotation + 90) % 360 }
          : page,
      ),
      elements: current.elements.map((element) =>
        element.pageId === activePage.id
          ? rotateElementClockwise(element)
          : element,
      ),
    }));
  }

  function moveActivePage(direction: -1 | 1) {
    if (!activePage) return;
    finishInspectorEditing();
    finishTextEditing();
    commit((current) => {
      const index = current.pages.findIndex(
        (page) => page.id === activePage.id,
      );
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.pages.length) {
        return current;
      }
      const pages = [...current.pages];
      [pages[index], pages[destination]] = [
        pages[destination],
        pages[index],
      ];
      return { ...current, pages };
    });
  }

  function duplicateSelected() {
    if (!selectedElement) return;
    finishInspectorEditing();
    const duplicate = {
      ...selectedElement,
      ...(selectedElement.type === "text" && selectedElement.sourceText
        ? { sourceText: undefined }
        : {}),
      id: makeId("element"),
      x: clamp(selectedElement.x + 0.025, 0, 1 - selectedElement.width),
      y: clamp(
        selectedElement.y + 0.025,
        0,
        1 - selectedElement.height,
      ),
    } as EditorElement;
    const before = snapshotRef.current;
    const next = commit((current) => ({
      ...current,
      elements: [...current.elements, duplicate],
    }));
    if (next === before) return;
    setSelectedId(duplicate.id);
  }

  function changeLayer(to: "front" | "back") {
    if (!selectedId) return;
    commit((current) => {
      const selected = current.elements.find(
        (element) => element.id === selectedId,
      );
      if (!selected) return current;
      const rest = current.elements.filter(
        (element) => element.id !== selectedId,
      );
      return {
        ...current,
        elements:
          to === "front" ? [...rest, selected] : [selected, ...rest],
      };
    });
  }

  async function exportPdf() {
    const restoreExportFocus =
      document.activeElement === exportButtonRef.current;
    finishInspectorEditing();
    finishTextEditing();
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot.pages.length) return;
    const limitIssue =
      getPageCountLimitIssue(currentSnapshot.pages.length) ??
      getEditorSnapshotLimitIssue(currentSnapshot.elements) ??
      getTextFieldLimitIssue(
        "Output filename",
        documentName,
        PDF_SECURITY_LIMITS.maxFilenameCharacters,
      );
    if (limitIssue) {
      setError(describePdfSecurityLimitIssue(limitIssue));
      return;
    }
    const { planPdfEditorFontRuns } = await import(
      "../lib/pdf-editor-fonts"
    );
    for (const element of currentSnapshot.elements) {
      if (element.type !== "text" || !element.text) continue;
      try {
        planPdfEditorFontRuns(element.text, {
          bold: element.bold,
          family: element.fontFamily ?? "Helvetica",
          italic: element.italic,
        });
      } catch (cause) {
        setSelectedId(element.id);
        if (compactLayout) setOpenPanel("properties");
        setError(
          cause instanceof Error
            ? cause.message
            : "This text cannot be exported with the supported font set.",
        );
        return;
      }
    }
    exportAbortRef.current?.abort();
    const exportController = new AbortController();
    exportAbortRef.current = exportController;
    setPhase("exporting");
    setError("");
    trackAnalyticsEvent({ event: "tool_start", tool: analyticsTool });
    try {
      setProgress({
        value: 1,
        label: "Releasing local OCR memory",
      });
      await disposeLocalOcrSession();
      const { exportEditedPdf } = await import(
        "../lib/pdf-editor-export"
      );
      const nativeTextEvidence = currentSnapshot.pages.flatMap(
        (page) => {
          if (page.sourcePageIndex === null) return [];
          const pageKey = `${page.id}:${normalizedQuarterTurn(
            page.sourceRotation + page.rotation,
          )}`;
          const textPage = textPagesRef.current[pageKey];
          if (!textPage) return [];
          const display = pageDisplaySize(page);
          return [
            {
              pageId: page.id,
              sourcePageIndex: page.sourcePageIndex,
              fragments: textPage.fragments
                .filter((fragment) => fragment.origin === "native")
                .map((fragment) => ({
                    id: fragment.id,
                    text: fragment.text,
                    ...textFragmentGeometry(fragment, display),
                    hasGeometry: fragment.hasGeometry,
                })),
            },
          ];
        },
      );
      const result = await exportEditedPdf({
        sourceBytes,
        pages: currentSnapshot.pages,
        elements: currentSnapshot.elements,
        filename: documentName,
        nativeTextEvidence,
        onProgress: (value, label) => {
          if (exportAbortRef.current === exportController) {
            setProgress({ value, label });
          }
        },
        signal: exportController.signal,
      });
      if (
        exportController.signal.aborted ||
        exportAbortRef.current !== exportController
      ) {
        return;
      }
      downloadResult(result.blob, result.filename);
      setProgress({ value: 100, label: "Download ready" });
      trackAnalyticsEvent({ event: "tool_complete", tool: analyticsTool });
    } catch (cause) {
      if (
        exportController.signal.aborted ||
        exportAbortRef.current !== exportController
      ) {
        return;
      }
      trackAnalyticsEvent({ event: "tool_error", tool: analyticsTool });
      setError(
        cause instanceof Error ? cause.message : "The PDF could not export.",
      );
    } finally {
      if (exportAbortRef.current === exportController) {
        exportAbortRef.current = null;
        restoreExportFocusRef.current = restoreExportFocus;
        setPhase("ready");
      }
    }
  }

  function renderExistingText(fragment: ExtractedPdfTextFragment) {
    if (!activePage) return null;
    const geometry = textFragmentGeometry(
      fragment,
      pageDisplaySize(activePage),
    );
    const label = fragment.text.replace(/\s+/g, " ").trim();

    return (
      <button
        aria-label={`Edit existing text: ${label.slice(0, 90)}`}
        className={styles.existingTextTarget}
        dir={fragment.direction === "rtl" ? "rtl" : "ltr"}
        key={fragment.id}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (suppressTextTargetClickRef.current) return;
          beginExistingTextEdit(fragment, event.currentTarget);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") {
            touchTextTargetRef.current = {
              kind: "fragment",
              fragment,
              pointerId: event.pointerId,
              trigger: event.currentTarget,
            };
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          left: `${geometry.x * 100}%`,
          top: `${geometry.y * 100}%`,
          width: `${geometry.width * 100}%`,
          height: `${geometry.height * 100}%`,
          transform: `rotate(${geometry.rotation}deg)`,
        }}
        title={`Edit “${label.slice(0, 80)}”`}
        type="button"
      >
        <span className={styles.srOnly}>{label}</span>
      </button>
    );
  }

  function renderSourceTextPreviewMask(element: EditorElement) {
    if (element.type !== "text" || !element.sourceText) return null;
    const sourceText = element.sourceText;
    const repairColor =
      element.backgroundColor ?? sourceText.originalBackgroundColor;
    return (
      <div
        aria-hidden="true"
        className={styles.sourceTextPreviewMask}
        data-source-text-mask={sourceText.id}
        key={`source-mask-${element.id}`}
        style={{
          backgroundColor: repairColor,
          boxShadow: `0 0 0 1px ${repairColor}`,
          left: `${sourceText.originalX * 100}%`,
          top: `${sourceText.originalY * 100}%`,
          width: `${sourceText.originalWidth * 100}%`,
          height: `${sourceText.originalHeight * 100}%`,
          transform: `rotate(${sourceText.originalRotation ?? 0}deg)`,
        }}
      />
    );
  }

  function renderElement(element: EditorElement) {
    if (!activePage) return null;
    const display = pageDisplaySize(activePage);
    const pixelScale = (720 * zoom) / display.width;
    const selected = element.id === selectedId;
    const commonStyle = {
      left: `${element.x * 100}%`,
      top: `${element.y * 100}%`,
      width: `${element.width * 100}%`,
      height: `${element.height * 100}%`,
      opacity: element.opacity,
      transform: `rotate(${element.rotation ?? 0}deg)`,
    };
    const renderedPageWidth = Math.max(1, 720 * zoom);
    const renderedPageHeight = Math.max(
      1,
      renderedPageWidth * (display.height / display.width),
    );
    const horizontalHandleEdge = Math.min(
      0.5,
      44 / renderedPageWidth,
    );
    const verticalHandleEdge = Math.min(
      0.5,
      44 / renderedPageHeight,
    );
    const elementRight = element.x + element.width;
    const moveHandleHorizontalEdge =
      elementRight >= 1 - horizontalHandleEdge
        ? "right"
        : elementRight <= horizontalHandleEdge
          ? "left"
          : "none";
    const moveHandleVerticalEdge =
      element.y <= verticalHandleEdge ? "top" : "none";

    let content;
    if (element.type === "text") {
      const textStyle: CSSProperties = {
        color: element.color,
        background: element.sourceText
          ? "transparent"
          : element.backgroundColor || "transparent",
        direction: element.direction ?? "ltr",
        fontFamily: editorFontCss(element.fontFamily, element.text),
        fontSize: `${Math.max(7, element.fontSize * pixelScale)}px`,
        fontStyle: element.italic ? "italic" : "normal",
        fontWeight: element.bold ? 700 : 400,
        textAlign: element.direction === "rtl" ? "right" : "left",
      };
      content =
        editingTextId === element.id ? (
          <textarea
            aria-label="Edit PDF text"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            autoFocus
            className={`${styles.elementContent} ${styles.textElement} ${styles.inlineTextEditor}`}
            maxLength={
              PDF_SECURITY_LIMITS.maxEditorTextCharactersPerElement
            }
            onBlur={finishTextEditing}
            onChange={(event) => {
              const text = event.currentTarget.value;
              updateElement(
                element.id,
                {
                  direction: inferTextDirection(text),
                  text,
                },
                false,
              );
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (
                event.key === "Escape" ||
                ((event.metaKey || event.ctrlKey) && event.key === "Enter")
              ) {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            spellCheck={false}
            style={textStyle}
            value={element.text}
          />
        ) : (
          <div
            className={`${styles.elementContent} ${styles.textElement}`}
            style={textStyle}
          >
            {element.text}
          </div>
        );
    } else if (
      element.type === "shape" ||
      element.type === "highlight" ||
      element.type === "whiteout"
    ) {
      content = (
        <div
          className={`${styles.elementContent} ${styles.rectElement}`}
          style={{
            background: element.fill,
            borderColor: element.stroke,
            borderWidth: element.strokeWidth,
          }}
        />
      );
    } else if (
      element.type === "draw" ||
      element.type === "signature"
    ) {
      content = (
        <svg
          aria-hidden="true"
          className={`${styles.elementContent} ${styles.pathElement}`}
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <polyline
            fill="none"
            points={element.points
              .map((point) => `${point.x * 100},${point.y * 100}`)
              .join(" ")}
            stroke={element.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={Math.max(0.5, element.strokeWidth / 2)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      );
    } else if (element.type === "image") {
      content = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className={`${styles.elementContent} ${styles.imageElement}`}
          draggable={false}
          src={element.dataUrl}
        />
      );
    } else {
      return null;
    }

    return (
      <div
        aria-label={`${element.type} element. Use arrow keys to move and Shift plus arrow keys to resize.`}
        aria-pressed={selected}
        className={`${styles.editorElement} ${
          selected ? styles.selectedElement : ""
        }`}
        data-editor-element
        data-editor-element-id={element.id}
        key={element.id}
        onClick={(event) => {
          if (
            tool === "edit-text" &&
            element.type === "text" &&
            element.sourceText
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (suppressTextTargetClickRef.current) return;
            openFocusedTextEditor(
              element,
              "update",
              event.currentTarget,
            );
            return;
          }
          /*
           * Pointer interactions are completed by finishInteraction. A
           * zero-detail click is the activation path used by assistive
           * technology, and handling only that path prevents a post-drag
           * click from reopening the focused text editor.
           */
          if (
            event.detail !== 0 ||
            suppressTextTargetClickRef.current
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          activateEditorElement(element, event.currentTarget, true);
        }}
        onDoubleClick={(event) => {
          if (
            compactLayout &&
            element.type === "text" &&
            element.sourceText
          ) {
            openFocusedTextEditor(
              element,
              "update",
              event.currentTarget,
            );
          } else if (element.type === "text") beginTextEditing(element.id);
          else setSelectedId(element.id);
        }}
        onPointerDown={(event) =>
          beginElementInteraction(event, element, "move")
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (
              tool === "edit-text" &&
              element.type === "text" &&
              element.sourceText
            ) {
              event.stopPropagation();
              openFocusedTextEditor(
                element,
                "update",
                event.currentTarget,
              );
              return;
            }
            if (
              event.key === "Enter" &&
              compactLayout &&
              element.type === "text" &&
              element.sourceText
            ) {
              openFocusedTextEditor(
                element,
                "update",
                event.currentTarget,
              );
              return;
            }
            setSelectedId(element.id);
            return;
          }
          if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown"
          ) {
            event.preventDefault();
            setSelectedId(element.id);
            const amount = event.altKey ? 0.001 : 0.005;
            const horizontal =
              event.key === "ArrowLeft"
                ? -amount
                : event.key === "ArrowRight"
                  ? amount
                  : 0;
            const vertical =
              event.key === "ArrowUp"
                ? -amount
                : event.key === "ArrowDown"
                  ? amount
                  : 0;
            if (event.shiftKey) {
              updateElement(element.id, {
                width: clamp(
                  element.width + horizontal,
                  0.025,
                  1 - element.x,
                ),
                height: clamp(
                  element.height + vertical,
                  0.02,
                  1 - element.y,
                ),
              });
            } else {
              updateElement(element.id, {
                x: clamp(element.x + horizontal, 0, 1 - element.width),
                y: clamp(element.y + vertical, 0, 1 - element.height),
              });
            }
          }
        }}
        role="button"
        style={commonStyle}
        tabIndex={
          tool === "select" ||
          (tool === "edit-text" &&
            element.type === "text" &&
            Boolean(element.sourceText))
            ? 0
            : -1
        }
      >
        {content}
        {selected &&
        compactLayout &&
        tool === "select" ? (
          <span
            aria-hidden="true"
            className={styles.moveHandle}
            data-edge-x={moveHandleHorizontalEdge}
            data-edge-y={moveHandleVerticalEdge}
            data-touch-move-handle="true"
            onPointerDown={(event) =>
              beginElementInteraction(event, element, "move")
            }
          >
            <Move size={15} />
          </span>
        ) : null}
        {selected && tool === "select" ? (
          <span
            aria-hidden="true"
            className={styles.resizeHandle}
            onPointerDown={(event) =>
              beginElementInteraction(event, element, "resize")
            }
          />
        ) : null}
      </div>
    );
  }

  function changeZoom(delta: number) {
    setFitMode("custom");
    setZoom((value) => clamp(value + delta, 0.1, 4));
  }

  function onCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setFitMode("custom");
    setZoom((value) =>
      clamp(value * Math.exp(-event.deltaY * 0.002), 0.1, 4),
    );
  }

  function trapPanelFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (!immersive || !compactLayout || event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((control) => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function toggleWorkspacePanel(panel: Exclude<WorkspacePanel, null>) {
    if (compactLayout) {
      setOpenPanel((current) => (current === panel ? null : panel));
      return;
    }
    if (panel === "pages") {
      setPagesCollapsed((current) => !current);
    } else {
      setPropertiesCollapsed((current) => !current);
    }
  }

  function closeWorkspacePanel(panel: Exclude<WorkspacePanel, null>) {
    if (compactLayout) {
      setOpenPanel(null);
      return;
    }
    if (panel === "pages") setPagesCollapsed(true);
    else setPropertiesCollapsed(true);
    window.requestAnimationFrame(() => {
      (panel === "pages"
        ? pagesToggleRef.current
        : propertiesToggleRef.current
      )?.focus({ preventScroll: true });
    });
  }

  function toggleFitMode() {
    setFitMode((current) =>
      current === "page" ? "width" : "page",
    );
  }

  if (phase === "idle" || phase === "loading") {
    return (
      <div
        className={`${styles.workspace} ${
          dragActive ? styles.dropActive : ""
        } ${immersive ? styles.immersive : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <input
          accept="application/pdf,.pdf"
          aria-hidden="true"
          hidden
          onChange={onPdfChange}
          ref={pdfInputRef}
          tabIndex={-1}
          type="file"
        />
        <div className={styles.start}>
          {immersive ? (
            <header className={styles.startHeader}>
              <Link
                aria-label="Pagelea home"
                className={styles.appBrand}
                href="/"
              >
                <span className={styles.brandMark}>P</span>
                <span className={styles.brandWordmark}>Pagelea</span>
              </Link>
              <span className={styles.startBadge}>
                <ShieldCheck size={17} />
                Local only
              </span>
            </header>
          ) : null}
          <div className={styles.startArt} aria-hidden="true">
            <span className={styles.startIcon}>
              {phase === "loading" ? (
                <LoaderCircle size={40} />
              ) : (
                <FileText size={40} />
              )}
            </span>
          </div>
          <div>
            {!immersive ? (
              <span className={styles.startBadge}>
                <ShieldCheck size={17} />
                Local only
              </span>
            ) : null}
            <h1 className={styles.startTitle}>
              {phase === "loading"
                ? "Opening your PDF…"
                : mode === "sign"
                  ? "Open a PDF and make it official."
                  : mode === "organize"
                    ? "Put every page in the right place."
                  : "Rewrite native or scanned PDF text."}
            </h1>
            <p className={styles.startCopy}>
              {phase === "loading"
                ? "Pages are being prepared in this browser."
                : mode === "organize"
                  ? "Drop a PDF here to reorder, rotate, remove, or add pages. Nothing is uploaded."
                  : "Drop any PDF here. Pagelea detects native text and Private Rewrite can recognize English or Italian scans locally."}
            </p>
            <div className={styles.startActions}>
              <button
                className={styles.primaryButton}
                disabled={phase === "loading"}
                onClick={() => pdfInputRef.current?.click()}
                type="button"
              >
                <Upload size={18} />
                Choose PDF
              </button>
              <button
                className={styles.secondaryButton}
                disabled={phase === "loading"}
                onClick={() => void createBlankDocument()}
                type="button"
              >
                <FilePlus2 size={18} />
                Start blank
              </button>
            </div>
            {error ? (
              <p className={styles.errorBanner} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!activePage) return null;
  const display = pageDisplaySize(activePage);
  const activeIndex = snapshot.pages.findIndex(
    (page) => page.id === activePage.id,
  );
  const pagesHidden = immersive
    ? compactLayout
      ? openPanel !== "pages"
      : pagesCollapsed
    : false;
  const propertiesHidden = immersive
    ? compactLayout
      ? openPanel !== "properties"
      : propertiesCollapsed
    : false;

  return (
    <div
      className={`${styles.workspace} ${styles.editor} ${
        mode === "organize" ? styles.organizeMode : ""
      } ${immersive ? styles.immersive : ""}`}
      data-pages-collapsed={pagesCollapsed}
      data-properties-collapsed={propertiesCollapsed}
      data-tool={tool}
    >
      <h1
        className={styles.srOnly}
        ref={editorHeadingRef}
        tabIndex={-1}
      >
        Pagelea PDF Editor
      </h1>
      <input
        accept="application/pdf,.pdf"
        aria-hidden="true"
        hidden
        onChange={onPdfChange}
        ref={pdfInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept="image/png,image/jpeg"
        aria-hidden="true"
        hidden
        onChange={(event) => void receiveImage(event, false)}
        ref={imageInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept="image/png,image/jpeg"
        aria-hidden="true"
        hidden
        onChange={(event) => void receiveImage(event, true)}
        ref={signatureInputRef}
        tabIndex={-1}
        type="file"
      />

      <header
        aria-hidden={focusedTextEdit ? true : undefined}
        className={styles.topbar}
        inert={focusedTextEdit ? true : undefined}
      >
        <div className={styles.topbarIdentity}>
          {immersive ? (
            <>
              <Link
                aria-label="Pagelea home"
                className={styles.appBrand}
                href="/"
              >
                <span className={styles.brandMark}>P</span>
                <span className={styles.brandWordmark}>Pagelea</span>
              </Link>
              <span className={styles.appDivider} aria-hidden="true" />
            </>
          ) : null}
          <div className={styles.docIdentity}>
            <span className={styles.logoMark}>
              <FileText size={18} />
            </span>
            <div className={styles.docMeta}>
              <input
                aria-label="Output filename"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className={styles.docName}
                maxLength={PDF_SECURITY_LIMITS.maxFilenameCharacters}
                onChange={(event) =>
                  setDocumentName(
                    event.target.value.slice(
                      0,
                      PDF_SECURITY_LIMITS.maxFilenameCharacters,
                    ),
                  )
                }
                spellCheck={false}
                value={documentName}
              />
              <span className={styles.docStatus}>
                <ShieldCheck size={13} />
                Local draft · {snapshot.pages.length}{" "}
                {snapshot.pages.length === 1 ? "page" : "pages"}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.topActions}>
          <button
            aria-label="Open another PDF"
            className={styles.iconButton}
            onClick={() => pdfInputRef.current?.click()}
            title="Open another PDF"
            type="button"
          >
            <Upload size={18} />
          </button>
          <button
            aria-label="Undo"
            className={styles.iconButton}
            disabled={!past.length}
            onClick={undo}
            title="Undo (⌘Z)"
            type="button"
          >
            <Undo2 size={18} />
          </button>
          <button
            aria-label="Redo"
            className={styles.iconButton}
            disabled={!future.length}
            onClick={redo}
            title="Redo (⇧⌘Z)"
            type="button"
          >
            <Redo2 size={18} />
          </button>
          <div className={styles.zoomGroup}>
            <button
              aria-label="Zoom out"
              className={styles.iconButton}
              disabled={zoom <= 0.1}
              onClick={() => changeZoom(-0.15)}
              type="button"
            >
              <ZoomOut size={17} />
            </button>
            <span className={styles.zoomLabel}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              aria-label={`Fit ${
                fitMode === "page" ? "page width" : "whole page"
              }`}
              aria-pressed={fitMode !== "custom"}
              className={`${styles.fitButton} ${styles.iconButton}`}
              onClick={toggleFitMode}
              title={
                fitMode === "page"
                  ? "Fit page width"
                  : "Fit whole page"
              }
              type="button"
            >
              <Maximize2 size={16} />
              <span className={styles.fitLabel}>
                {fitMode === "width"
                  ? "Width"
                  : fitMode === "page"
                    ? "Page"
                    : "Fit"}
              </span>
            </button>
            <button
              aria-label="Zoom in"
              className={styles.iconButton}
              disabled={zoom >= 4}
              onClick={() => changeZoom(0.15)}
              type="button"
            >
              <ZoomIn size={17} />
            </button>
          </div>
        </div>
        <button
          aria-label={
            phase === "exporting" ? "Exporting PDF" : "Export PDF"
          }
          className={styles.exportButton}
          disabled={phase === "exporting"}
          onClick={() => void exportPdf()}
          ref={exportButtonRef}
          type="button"
        >
          {phase === "exporting" ? (
            <LoaderCircle size={18} />
          ) : (
            <Download size={18} />
          )}
          <span>
            {phase === "exporting" ? "Exporting" : "Export PDF"}
          </span>
        </button>
      </header>

      {error && !focusedTextEdit ? (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      ) : null}

      <div
        aria-hidden={focusedTextEdit ? true : undefined}
        className={styles.editorBody}
        inert={focusedTextEdit ? true : undefined}
      >
        {compactLayout && openPanel ? (
          <button
            aria-label="Close workspace panel"
            className={styles.panelBackdrop}
            onClick={() => setOpenPanel(null)}
            type="button"
          />
        ) : null}
        <aside
          aria-hidden={pagesHidden}
          aria-label="Document pages"
          className={styles.pagesPanel}
          data-open={openPanel === "pages"}
          id="pdf-pages-panel"
          inert={pagesHidden ? true : undefined}
          onKeyDown={trapPanelFocus}
          ref={pagesPanelRef}
        >
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>
              <strong>Pages</strong>
              <span className={styles.pageCount}>
                {snapshot.pages.length}
              </span>
            </div>
            <button
              aria-label={
                compactLayout ? "Close pages" : "Collapse pages"
              }
              className={styles.panelClose}
              data-panel-close
              onClick={() => closeWorkspacePanel("pages")}
              type="button"
            >
              <X size={19} />
            </button>
          </div>
          <div className={styles.thumbnails}>
            {snapshot.pages.map((page, index) => (
              <div
                className={`${styles.thumbnail} ${
                  page.id === activePage.id ? styles.thumbnailActive : ""
                }`}
                key={page.id}
              >
                <button
                  aria-current={
                    page.id === activePage.id ? "page" : undefined
                  }
                  aria-label={`Open page ${index + 1}`}
                  className={styles.thumbCanvas}
                  onClick={() => {
                    finishInspectorEditing();
                    finishTextEditing();
                    setActivePageId(page.id);
                    setSelectedId(null);
                    if (compactLayout) setOpenPanel(null);
                  }}
                  type="button"
                >
                  <PdfPageCanvas
                    document={previewDocument}
                    page={page}
                    quality="thumbnail"
                  />
                  <span className={styles.thumbNumber}>{index + 1}</span>
                </button>
                {page.id === activePage.id ? (
                  <div className={styles.thumbControls}>
                    <button
                      aria-label={`Move page ${index + 1} up`}
                      className={styles.thumbIcon}
                      disabled={index === 0}
                      onClick={() => moveActivePage(-1)}
                      type="button"
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      aria-label={`Move page ${index + 1} down`}
                      className={styles.thumbIcon}
                      disabled={index === snapshot.pages.length - 1}
                      onClick={() => moveActivePage(1)}
                      type="button"
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      aria-label={`Rotate page ${index + 1} clockwise`}
                      className={styles.thumbIcon}
                      onClick={rotateActivePage}
                      type="button"
                    >
                      <RotateCw size={15} />
                    </button>
                    <button
                      aria-label={`Delete page ${index + 1}`}
                      className={styles.thumbIcon}
                      disabled={snapshot.pages.length === 1}
                      onClick={deleteActivePage}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <button
            className={styles.addPageButton}
            onClick={addBlankPage}
            type="button"
          >
            <Plus size={16} />
            Blank page
          </button>
        </aside>

        <section className={styles.stage} aria-label="PDF editor canvas">
          <p className={styles.srOnly} id="pdf-editor-keyboard-instructions">
            Select an added element with Tab. Use the arrow keys to move it,
            Shift plus arrow keys to resize it, and Delete to remove it. Hold
            Alt for finer movement.
          </p>
          <div
            aria-label="Document controls"
            className={styles.mobileUtilityBar}
            role="toolbar"
          >
            <button
              aria-label="Open another PDF"
              className={styles.iconButton}
              onClick={() => pdfInputRef.current?.click()}
              type="button"
            >
              <Upload size={18} />
            </button>
            <button
              aria-label="Undo"
              className={styles.iconButton}
              disabled={!past.length}
              onClick={undo}
              type="button"
            >
              <Undo2 size={18} />
            </button>
            <button
              aria-label="Redo"
              className={styles.iconButton}
              disabled={!future.length}
              onClick={redo}
              type="button"
            >
              <Redo2 size={18} />
            </button>
            <button
              aria-label={`Fit ${
                fitMode === "page" ? "page width" : "whole page"
              }`}
              aria-pressed={fitMode !== "custom"}
              className={`${styles.iconButton} ${styles.fitButton}`}
              onClick={toggleFitMode}
              type="button"
            >
              <Maximize2 size={17} />
              <span className={styles.fitLabel}>
                {fitMode === "width" ? "Width" : "Page"}
              </span>
            </button>
            <div className={styles.compactZoom}>
              <button
                aria-label="Zoom out"
                className={styles.iconButton}
                disabled={zoom <= 0.1}
                onClick={() => changeZoom(-0.15)}
                type="button"
              >
                <ZoomOut size={17} />
              </button>
              <span className={styles.zoomLabel}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                aria-label="Zoom in"
                className={styles.iconButton}
                disabled={zoom >= 4}
                onClick={() => changeZoom(0.15)}
                type="button"
              >
                <ZoomIn size={17} />
              </button>
            </div>
          </div>

          <div className={styles.toolDock}>
            <button
              aria-controls="pdf-pages-panel"
              aria-expanded={
                compactLayout ? openPanel === "pages" : !pagesCollapsed
              }
              aria-label={`Pages, page ${activeIndex + 1} of ${
                snapshot.pages.length
              }`}
              className={styles.panelToggle}
              onClick={() => toggleWorkspacePanel("pages")}
              ref={pagesToggleRef}
              type="button"
            >
              <PanelLeft size={18} />
              <span>
                {activeIndex + 1}/{snapshot.pages.length}
              </span>
            </button>
            <div
              aria-label="Editing tools"
              className={styles.toolRail}
              role="toolbar"
            >
              {mode === "organize" ? (
                <p className={styles.organizeHint}>
                  Select a page thumbnail to move, rotate, or delete it.
                </p>
              ) : TOOL_ITEMS.map((item) => {
                const Icon = item.icon;
                const disabled =
                  item.id === "edit-text" &&
                  activePage.sourcePageIndex === null;
                return (
                  <button
                    aria-label={item.label}
                    aria-pressed={tool === item.id}
                    className={`${styles.toolButton} ${
                      tool === item.id ? styles.toolActive : ""
                    }`}
                    disabled={disabled}
                    key={item.id}
                    onClick={() => selectTool(item.id)}
                    title={
                      disabled
                        ? "Open a PDF with selectable text first"
                        : item.label
                    }
                    type="button"
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              {tool === "edit-text" ? (
                <span
                  aria-live="polite"
                  className={styles.textDetectionBadge}
                  data-status={activeTextLayerStatus}
                  role="status"
                  title={
                    textLayerState.key === activeTextKey
                      ? textLayerState.message
                      : undefined
                  }
                >
                  {activeTextLayerStatus === "loading" ? (
                    <LoaderCircle size={13} />
                  ) : activeTextLayerStatus === "ready" ? (
                    <Check size={13} />
                  ) : (
                    <FileText size={13} />
                  )}
                  {activeTextLayerStatus === "loading"
                    ? "Detecting text"
                    : activeTextLayerStatus === "ready"
                      ? `${activeTextFragments.length} editable`
                      : activeTextLayerStatus === "empty"
                        ? "Scan / image"
                        : "Detection issue"}
                </span>
              ) : null}
            </div>
            <button
              aria-controls="pdf-properties-panel"
              aria-expanded={
                compactLayout
                  ? openPanel === "properties"
                  : !propertiesCollapsed
              }
              aria-label="Element properties"
              className={styles.panelToggle}
              onClick={() => toggleWorkspacePanel("properties")}
              ref={propertiesToggleRef}
              type="button"
            >
              <SlidersHorizontal size={18} />
              <span>Props</span>
            </button>
          </div>

          <div className={styles.canvasViewport}>
            <div
              className={styles.canvasScroller}
              onWheel={onCanvasWheel}
              ref={canvasViewportRef}
            >
              <div
                className={styles.pageShell}
                style={{
                  aspectRatio: `${display.width} / ${display.height}`,
                  width: `${720 * zoom}px`,
                }}
              >
                <PdfPageCanvas
                  className={styles.pageCanvas}
                  document={previewDocument}
                  page={activePage}
                  quality="main"
                />
                <div
                  aria-describedby="pdf-editor-keyboard-instructions"
                  aria-label={`Editable area for page ${activeIndex + 1}`}
                  className={`${styles.overlaySurface} ${
                    tool === "select" || tool === "edit-text"
                      ? styles.panSurface
                      : styles.directSurface
                  }`}
                  onPointerCancel={finishInteraction}
                  onPointerDown={onSurfacePointerDown}
                  onPointerMove={onSurfacePointerMove}
                  onPointerUp={finishInteraction}
                  ref={surfaceRef}
                  role="group"
                >
                  {tool === "edit-text"
                    ? activeTextFragments.map(renderExistingText)
                    : null}
                  {activePageElements.map(renderSourceTextPreviewMask)}
                  {activePageElements.map(renderElement)}
                </div>
              </div>
            </div>
            <div className={styles.hint}>
              <p className={styles.hintText}>
                {tool === "edit-text"
                  ? activePrivateRewrite.status === "recognizing"
                    ? activePrivateRewrite.message
                    : activeTextLayerStatus === "loading"
                      ? "Finding editable text on this page…"
                      : activeTextLayerStatus === "empty"
                        ? "No selectable text found. Run Private Rewrite to recognize scanned text without uploading the PDF."
                        : activeTextLayerStatus === "error"
                          ? "Native text detection failed. Private Rewrite can still recognize the rendered page locally."
                          : compactLayout
                            ? "Tap an outlined text block to replace it in a focused editor."
                            : "Click an outlined text block, then type directly on the page."
                  : tool === "select"
                    ? "Select an element to move, resize, or style it."
                    : tool === "draw" ||
                        (tool === "signature" &&
                          signatureMode === "draw")
                      ? "Drag directly on the page."
                      : tool === "image" ||
                          (tool === "signature" &&
                            signatureMode === "upload")
                        ? "Click the page to place the image."
                        : "Click or drag on the page to add the element."}
              </p>
              {tool === "edit-text" ? (
                <PrivateRewriteControls
                  disabled={
                    !activePage ||
                    activePage.sourcePageIndex === null ||
                    phase !== "ready"
                  }
                  language={ocrLanguage}
                  message={activePrivateRewrite.message}
                  onCancel={cancelPrivateRewrite}
                  onLanguageChange={changeOcrLanguage}
                  onRecognize={() =>
                    void recognizeActivePageLocally()
                  }
                  progress={activePrivateRewrite.progress}
                  recognizedLines={recognizedOcrLines}
                  status={activePrivateRewrite.status}
                />
              ) : null}
            </div>
          </div>
        </section>

        <aside
          aria-hidden={propertiesHidden}
          aria-label="Element properties"
          className={styles.inspector}
          data-open={openPanel === "properties"}
          id="pdf-properties-panel"
          inert={propertiesHidden ? true : undefined}
          onKeyDown={trapPanelFocus}
          ref={propertiesPanelRef}
        >
          <div className={styles.inspectorHeader}>
            <div className={styles.inspectorTitle}>
              <span>Inspector</span>
              <strong>
                {selectedElement
                  ? selectedElement.type === "text" &&
                    selectedElement.sourceText
                    ? "Existing text"
                    : selectedElement.type
                  : tool === "signature"
                    ? "Signature"
                    : "Nothing selected"}
              </strong>
            </div>
            <div className={styles.inspectorHeaderActions}>
              {selectedElement ? <Check size={18} /> : null}
              <button
                aria-label={
                  compactLayout
                    ? "Close properties"
                    : "Collapse properties"
                }
                className={styles.panelClose}
                data-panel-close
                onClick={() => closeWorkspacePanel("properties")}
                type="button"
              >
                <X size={19} />
              </button>
            </div>
          </div>

          {tool === "signature" && !selectedElement ? (
            <div className={styles.signaturePanel}>
              <p>Create a signature, then place it on the page.</p>
              <div
                className={`${styles.segmented} ${styles.signatureTabs}`}
              >
                {(["type", "draw", "upload"] as SignatureMode[]).map(
                  (item) => (
                    <button
                      className={
                        signatureMode === item ? styles.activeSegment : ""
                      }
                      key={item}
                      onClick={() => {
                        setSignatureMode(item);
                        setPendingImage(null);
                        if (item === "upload") {
                          signatureInputRef.current?.click();
                        }
                      }}
                      type="button"
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
              {signatureMode === "type" ? (
                <label className={styles.field}>
                  <span>Your name</span>
                  <input
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    maxLength={
                      PDF_SECURITY_LIMITS.maxSignatureNameCharacters
                    }
                    onChange={(event) =>
                      setSignatureName(
                        event.target.value.slice(
                          0,
                          PDF_SECURITY_LIMITS.maxSignatureNameCharacters,
                        ),
                      )
                    }
                    placeholder="Ada Lovelace"
                    spellCheck={false}
                    value={signatureName}
                  />
                </label>
              ) : signatureMode === "draw" ? (
                <p className={styles.inspectorEmpty}>
                  Draw your signature directly on the document. You can move
                  and resize it afterwards.
                </p>
              ) : (
                <button
                  className={styles.secondaryButton}
                  onClick={() => signatureInputRef.current?.click()}
                  type="button"
                >
                  <ImagePlus size={17} />
                  {pendingImage?.signature
                    ? "Choose another image"
                    : "Choose signature image"}
                </button>
              )}
            </div>
          ) : selectedElement ? (
            <>
              {selectedElement.type === "text" ? (
                <>
                  {selectedElement.sourceText ? (
                    <>
                      <div className={styles.sourceTextNotice}>
                        <TextCursorInput size={17} />
                        <div>
                          <strong>
                            {selectedElement.sourceText.kind === "ocr"
                              ? "Editing locally recognized text"
                              : "Editing original PDF text"}
                          </strong>
                          <span>
                            {selectedElement.sourceText.kind === "ocr"
                              ? "Pagelea repairs the recognized pixels, securely flattens this source page, then writes supported searchable Unicode text."
                              : "Compatible PDF text stays searchable and vector. Complex content is safely flattened so the old words are never left underneath."}
                          </span>
                        </div>
                      </div>
                      <dl
                        aria-label="Source text details"
                        className={styles.sourceTextMetadata}
                      >
                        <div>
                          <dt>Source font</dt>
                          <dd>
                            {selectedElement.sourceText.detectedFontName ||
                              selectedElement.sourceText
                                .detectedFontFamily ||
                              selectedElement.sourceText.fontName ||
                              "Unknown"}
                          </dd>
                        </div>
                        <div>
                          <dt>Font match</dt>
                          <dd>
                            {selectedElement.sourceText
                              .fontMatchConfidence ?? "generic"}
                            {" · "}
                            {editorFontLabel(
                              selectedElement.fontFamily ?? "Helvetica",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Direction</dt>
                          <dd>
                            {selectedElement.direction === "rtl"
                              ? "Right to left"
                              : "Left to right"}
                          </dd>
                        </div>
                        {selectedElement.sourceText.kind === "ocr" ? (
                          <div>
                            <dt>Recognition</dt>
                            <dd>
                              {Math.round(
                                selectedElement.sourceText.confidence,
                              )}
                              % · {selectedElement.sourceText.language}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </>
                  ) : null}
                  <label className={styles.field}>
                    <span>Content</span>
                    <textarea
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      maxLength={
                        PDF_SECURITY_LIMITS.maxEditorTextCharactersPerElement
                      }
                      onBlur={finishInspectorEditing}
                      onChange={(event) => {
                        const text = event.target.value;
                        updateSelectedContinuously({
                          direction: inferTextDirection(text),
                          text,
                        });
                      }}
                      onFocus={() =>
                        beginInspectorEditing(selectedElement.id)
                      }
                      rows={4}
                      spellCheck={false}
                      value={selectedElement.text}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Font family</span>
                    <select
                      onChange={(event) =>
                        updateSelected({
                          fontFamily: event.target
                            .value as EditorFontFamily,
                        })
                      }
                      value={selectedElement.fontFamily ?? "Helvetica"}
                    >
                      {EDITOR_FONT_OPTIONS.map((option) => (
                        <option
                          key={option.family}
                          value={option.family}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span>Size</span>
                      <input
                        max={240}
                        min={4}
                        onBlur={finishInspectorEditing}
                        onChange={(event) =>
                          updateSelectedContinuously({
                            fontSize: Number(event.target.value),
                          })
                        }
                        onFocus={() =>
                          beginInspectorEditing(selectedElement.id)
                        }
                        step={0.1}
                        type="number"
                        value={roundEditorNumber(
                          selectedElement.fontSize,
                        )}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Color</span>
                      <input
                        className={styles.colorInput}
                        onBlur={finishInspectorEditing}
                        onChange={(event) =>
                          updateSelectedContinuously({
                            color: event.target.value,
                          })
                        }
                        onFocus={() =>
                          beginInspectorEditing(selectedElement.id)
                        }
                        type="color"
                        value={selectedElement.color}
                      />
                    </label>
                  </div>
                  {selectedElement.sourceText ? (
                    <label className={styles.field}>
                      <span>Background repair color</span>
                      <input
                        className={styles.colorInput}
                        onBlur={finishInspectorEditing}
                        onChange={(event) =>
                          updateSelectedContinuously({
                            backgroundColor: event.target.value,
                          })
                        }
                        onFocus={() =>
                          beginInspectorEditing(selectedElement.id)
                        }
                        type="color"
                        value={selectedElement.backgroundColor ?? "#ffffff"}
                      />
                    </label>
                  ) : null}
                  <div className={styles.segmented}>
                    <button
                      aria-pressed={selectedElement.bold}
                      className={
                        selectedElement.bold ? styles.activeSegment : ""
                      }
                      onClick={() =>
                        updateSelected({ bold: !selectedElement.bold })
                      }
                      type="button"
                    >
                      <Bold size={16} />
                      Bold
                    </button>
                    <button
                      aria-pressed={selectedElement.italic}
                      className={
                        selectedElement.italic ? styles.activeSegment : ""
                      }
                      onClick={() =>
                        updateSelected({ italic: !selectedElement.italic })
                      }
                      type="button"
                    >
                      <Italic size={16} />
                      Italic
                    </button>
                  </div>
                </>
              ) : null}

              {selectedElement.type === "shape" ||
              selectedElement.type === "highlight" ||
              selectedElement.type === "whiteout" ? (
                <>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span>Fill</span>
                      <input
                        className={styles.colorInput}
                        disabled={selectedElement.type === "whiteout"}
                        onBlur={finishInspectorEditing}
                        onChange={(event) =>
                          updateSelectedContinuously({
                            fill: event.target.value,
                          })
                        }
                        onFocus={() =>
                          beginInspectorEditing(selectedElement.id)
                        }
                        type="color"
                        value={selectedElement.fill}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Border</span>
                      <input
                        className={styles.colorInput}
                        disabled={selectedElement.type !== "shape"}
                        onBlur={finishInspectorEditing}
                        onChange={(event) =>
                          updateSelectedContinuously({
                            stroke: event.target.value,
                          })
                        }
                        onFocus={() =>
                          beginInspectorEditing(selectedElement.id)
                        }
                        type="color"
                        value={
                          selectedElement.stroke === "transparent"
                            ? "#ffffff"
                            : selectedElement.stroke
                        }
                      />
                    </label>
                  </div>
                  {selectedElement.type === "shape" ? (
                    <label className={styles.field}>
                      <span>Border width</span>
                      <input
                        max={20}
                        min={0}
                        onBlur={finishInspectorEditing}
                        onChange={(event) =>
                          updateSelectedContinuously({
                            strokeWidth: Number(event.target.value),
                          })
                        }
                        onFocus={() =>
                          beginInspectorEditing(selectedElement.id)
                        }
                        type="number"
                        value={selectedElement.strokeWidth}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              {selectedElement.type === "draw" ||
              selectedElement.type === "signature" ? (
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Ink</span>
                    <input
                      className={styles.colorInput}
                      onBlur={finishInspectorEditing}
                      onChange={(event) =>
                        updateSelectedContinuously({
                          color: event.target.value,
                        })
                      }
                      onFocus={() =>
                        beginInspectorEditing(selectedElement.id)
                      }
                      type="color"
                      value={selectedElement.color}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Stroke</span>
                    <input
                      max={24}
                      min={0.5}
                      onBlur={finishInspectorEditing}
                      onChange={(event) =>
                        updateSelectedContinuously({
                          strokeWidth: Number(event.target.value),
                        })
                      }
                      onFocus={() =>
                        beginInspectorEditing(selectedElement.id)
                      }
                      step={0.5}
                      type="number"
                      value={selectedElement.strokeWidth}
                    />
                  </label>
                </div>
              ) : null}

              <label className={`${styles.field} ${styles.rangeRow}`}>
                <span>Opacity</span>
                <input
                  max={1}
                  min={0.05}
                  onBlur={finishInspectorEditing}
                  onChange={(event) =>
                    updateSelectedContinuously({
                      opacity: Number(event.target.value),
                    })
                  }
                  onFocus={() =>
                    beginInspectorEditing(selectedElement.id)
                  }
                  step={0.05}
                  type="range"
                  value={selectedElement.opacity}
                />
                <output>{Math.round(selectedElement.opacity * 100)}%</output>
              </label>

              <label className={styles.field}>
                <span>Rotation</span>
                <input
                  max={360}
                  min={-360}
                  onBlur={finishInspectorEditing}
                  onChange={(event) =>
                    updateSelectedContinuously({
                      rotation: Number(event.target.value),
                    })
                  }
                  onFocus={() =>
                    beginInspectorEditing(selectedElement.id)
                  }
                  step={0.1}
                  type="number"
                  value={roundEditorNumber(
                    selectedElement.rotation ?? 0,
                  )}
                />
              </label>

              <div className={styles.inspectorActions}>
                <button onClick={duplicateSelected} type="button">
                  <Copy size={16} />
                  Duplicate
                </button>
                <button onClick={() => changeLayer("front")} type="button">
                  <BringToFront size={16} />
                  Front
                </button>
                <button onClick={() => changeLayer("back")} type="button">
                  <SendToBack size={16} />
                  Back
                </button>
                <button
                  className={styles.dangerButton}
                  onClick={deleteSelected}
                  type="button"
                >
                  {selectedElement.type === "text" &&
                  selectedElement.sourceText ? (
                    <Undo2 size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  {selectedElement.type === "text" &&
                  selectedElement.sourceText
                    ? "Restore original"
                    : "Delete"}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.inspectorEmpty}>
              Choose a tool and work directly on the page. Select any added
              element to change its style or layer order.
            </p>
          )}
        </aside>
      </div>

      {focusedTextEdit ? (
        <TextEditFocusPanel
          direction={focusedTextEdit.element.direction ?? "ltr"}
          errorMessage={focusedTextEditError}
          inputRef={focusedTextInputRef}
          maxLength={
            PDF_SECURITY_LIMITS.maxEditorTextCharactersPerElement
          }
          onApply={applyFocusedTextEditing}
          onCancel={cancelFocusedTextEditing}
          onChange={(text) => {
            if (focusedTextEditError) {
              setFocusedTextEditError("");
              setError("");
            }
            setFocusedTextEdit((current) =>
              current
                ? {
                    ...current,
                    element: {
                      ...current.element,
                      direction: inferTextDirection(text),
                      text,
                    },
                  }
                : current,
            );
          }}
          originalText={
            focusedTextEdit.element.sourceText?.originalText ??
            focusedTextEdit.element.text
          }
          panelRef={focusedTextEditorRef}
          text={focusedTextEdit.element.text}
        />
      ) : null}

      <footer
        aria-hidden={focusedTextEdit ? true : undefined}
        aria-live="polite"
        className={styles.statusBar}
        inert={focusedTextEdit ? true : undefined}
      >
        <span>{progress.label}</span>
        <div
          aria-label={`Progress ${progress.value}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress.value}
          className={styles.progressTrack}
          role="progressbar"
        >
          <span
            className={styles.progressFill}
            style={{ width: `${progress.value}%` }}
          />
        </div>
        <span>
          Page {activeIndex + 1} of {snapshot.pages.length}
        </span>
      </footer>
    </div>
  );
}
