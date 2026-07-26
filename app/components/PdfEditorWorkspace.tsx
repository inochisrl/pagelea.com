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
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  SendToBack,
  ShieldCheck,
  Signature,
  Square,
  TextCursorInput,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { trackAnalyticsEvent } from "../lib/analytics-client";
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
  extractPdfPageText,
  type ExtractedPdfTextFragment,
  type ExtractedPdfTextPage,
} from "../lib/pdf-text-extraction";
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

type TextLayerState = {
  key: string;
  status: TextLayerStatus;
  message: string;
};

type SampledTextColors = {
  background: string;
  foreground: string;
};

const HISTORY_LIMIT = 60;
const DEFAULT_PAGE_WIDTH = 595.28;
const DEFAULT_PAGE_HEIGHT = 841.89;

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

function normalizedQuarterTurn(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

function inferFontFamily(fragment: ExtractedPdfTextFragment): EditorFontFamily {
  const label =
    `${fragment.resolvedFontName ?? ""} ${fragment.fontFamily} ${fragment.fontName}`.toLowerCase();
  if (/courier|mono|typewriter|consolas/.test(label)) return "Courier";
  if (
    /(?:^|[^a-z])times|georgia|garamond|palatino/.test(label) ||
    fragment.fontFamily.trim().toLowerCase() === "serif"
  ) {
    return "Times";
  }
  return "Helvetica";
}

function inferredFontStyle(fragment: ExtractedPdfTextFragment) {
  const label =
    `${fragment.resolvedFontName ?? ""} ${fragment.fontFamily} ${fragment.fontName}`.toLowerCase();
  return {
    bold: fragment.bold || /bold|black|heavy|semibold|demi/.test(label),
    italic: fragment.italic || /italic|oblique|slant/.test(label),
  };
}

function editorFontCss(family: EditorFontFamily | undefined) {
  if (family === "Times") return '"Times New Roman", Times, serif';
  if (family === "Courier") return '"Courier New", Courier, monospace';
  return "Helvetica, Arial, sans-serif";
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
      rotation: fragment.rotation ?? 0,
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
  return { x, y, width, height, rotation: fragment.rotation ?? 0 };
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
    const image = context.getImageData(
      sampleLeft,
      sampleTop,
      sampleRight - sampleLeft,
      sampleBottom - sampleTop,
    );
    const backgroundSamples: RgbSample[] = [];
    const insideSamples: RgbSample[] = [];
    const totalPixels = image.width * image.height;
    const stride = Math.max(1, Math.ceil(Math.sqrt(totalPixels / 9_000)));

    for (let y = 0; y < image.height; y += stride) {
      for (let x = 0; x < image.width; x += stride) {
        const offset = (y * image.width + x) * 4;
        if (image.data[offset + 3] < 180) continue;
        const sample: RgbSample = [
          image.data[offset],
          image.data[offset + 1],
          image.data[offset + 2],
        ];
        const pageX = sampleLeft + x;
        const pageY = sampleTop + y;
        if (pageX < left || pageX >= right || pageY < top || pageY >= bottom) {
          backgroundSamples.push(sample);
        } else {
          insideSamples.push(sample);
        }
      }
    }

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

function createAbortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
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
  mode = "edit",
}: {
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
  const previewRef = useRef<PdfPreviewDocument | null>(null);
  const loadTokenRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const textEditOriginRef = useRef<{
    elementId: string;
    snapshot: EditorSnapshot;
  } | null>(null);
  const inspectorEditOriginRef = useRef<{
    elementId: string;
    snapshot: EditorSnapshot;
  } | null>(null);
  const keyboardActionsRef = useRef<{
    deleteSelected: () => void;
    editingTextId: string | null;
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
  const [textLayerState, setTextLayerState] = useState<TextLayerState>({
    key: "",
    status: "idle",
    message: "",
  });
  const [textPages, setTextPages] = useState<
    Record<string, ExtractedPdfTextPage>
  >({});
  const textPagesRef = useRef(textPages);
  const textPageBudgetsRef = useRef<
    Record<string, TextContentBudget>
  >({});

  function clearTextPages() {
    const emptyPages: Record<string, ExtractedPdfTextPage> = {};
    textPageBudgetsRef.current = {};
    textPagesRef.current = emptyPages;
    setTextPages(emptyPages);
  }

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(
    () => () => {
      loadTokenRef.current += 1;
      loadAbortRef.current?.abort();
      imageAbortRef.current?.abort();
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
    if (
      phase !== "ready" ||
      !previewDocument ||
      !activePage ||
      activePage.sourcePageIndex === null ||
      !activeTextKey
    ) {
      return;
    }

    if (activeTextPage) return;

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
        const currentPages = textPagesRef.current;
        const pageKeyPrefix = `${activePage.id}:`;
        const replacedKeys = Object.keys(currentPages).filter(
          (key) => key.startsWith(pageKeyPrefix),
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
          const message =
            describePdfSecurityLimitIssue(budgetIssue);
          setTextLayerState({
            key: activeTextKey,
            status: "error",
            message,
          });
          setError(message);
          return;
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
        const nextPages = {
          ...retainedPages,
          [activeTextKey]: textPage,
        };
        textPageBudgetsRef.current = {
          ...retainedBudgets,
          [activeTextKey]: replacementBudget,
        };
        textPagesRef.current = nextPages;
        setTextPages(nextPages);
        const hasText = textPage.fragments.some(
          (fragment) =>
            fragment.hasGeometry && fragment.text.trim().length > 0,
        );
        setTextLayerState({
          key: activeTextKey,
          status: hasText ? "ready" : "empty",
          message: hasText
            ? `${textPage.fragments.length} text blocks found`
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
    activeTextPage,
    phase,
    previewDocument,
  ]);

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
      deleteSelected,
      editingTextId,
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

  function beginExistingTextEdit(fragment: ExtractedPdfTextFragment) {
    if (!activePage || activePage.sourcePageIndex === null) return;
    const display = pageDisplaySize(activePage);
    const geometry = textFragmentGeometry(fragment, display);
    const colors = sampleTextColors(surfaceRef.current, fragment);
    const fontStyle = inferredFontStyle(fragment);
    const element: TextEditorElement = {
      id: makeId("source-text"),
      pageId: activePage.id,
      type: "text",
      ...geometry,
      opacity: 1,
      text: fragment.text,
      fontSize: clamp(fragment.fontSize ?? 12, 4, 240),
      baselineFactor: textBaselineFactor(fragment, display),
      fontFamily: inferFontFamily(fragment),
      color: colors.foreground,
      bold: fontStyle.bold,
      italic: fontStyle.italic,
      backgroundColor: colors.background,
      sourceText: {
        id: fragment.id,
        pageIndex: activePage.sourcePageIndex,
        originalText: fragment.text,
        fontName: fragment.fontName,
        detectedFontFamily: fragment.fontFamily,
        originalX: geometry.x,
        originalY: geometry.y,
        originalWidth: geometry.width,
        originalHeight: geometry.height,
        originalRotation: geometry.rotation,
        originalBackgroundColor: colors.background,
      },
    };

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
    if (tool !== "select" || event.button !== 0) return;
    if (editingTextId === element.id) return;
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

  function onSurfacePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
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
    setPhase("exporting");
    setError("");
    trackAnalyticsEvent({ event: "tool_start", tool: analyticsTool });
    try {
      const { exportEditedPdf } = await import(
        "../lib/pdf-editor-export"
      );
      const result = await exportEditedPdf({
        sourceBytes,
        pages: currentSnapshot.pages,
        elements: currentSnapshot.elements,
        filename: documentName,
        onProgress: (value, label) => setProgress({ value, label }),
      });
      downloadResult(result.blob, result.filename);
      setProgress({ value: 100, label: "Download ready" });
      trackAnalyticsEvent({ event: "tool_complete", tool: analyticsTool });
    } catch (cause) {
      trackAnalyticsEvent({ event: "tool_error", tool: analyticsTool });
      setError(
        cause instanceof Error ? cause.message : "The PDF could not export.",
      );
    } finally {
      setPhase("ready");
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
          beginExistingTextEdit(fragment);
        }}
        onPointerDown={(event) => {
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

    let content;
    if (element.type === "text") {
      const textStyle = {
        color: element.color,
        background: element.backgroundColor || "transparent",
        fontFamily: editorFontCss(element.fontFamily),
        fontSize: `${Math.max(7, element.fontSize * pixelScale)}px`,
        fontStyle: element.italic ? "italic" : "normal",
        fontWeight: element.bold ? 800 : 500,
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
            onChange={(event) =>
              updateElement(
                element.id,
                { text: event.currentTarget.value },
                false,
              )
            }
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
        key={element.id}
        onDoubleClick={() => {
          if (element.type === "text") beginTextEditing(element.id);
          else setSelectedId(element.id);
        }}
        onPointerDown={(event) =>
          beginElementInteraction(event, element, "move")
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
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
        tabIndex={tool === "select" ? 0 : -1}
      >
        {content}
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

  if (phase === "idle" || phase === "loading") {
    return (
      <div
        className={`${styles.workspace} ${
          dragActive ? styles.dropActive : ""
        }`}
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
          <div className={styles.startArt} aria-hidden="true">
            <span className={styles.startBadge}>
              <ShieldCheck size={17} />
              Local only
            </span>
            <span className={styles.startIcon}>
              {phase === "loading" ? (
                <LoaderCircle size={40} />
              ) : (
                <FileText size={40} />
              )}
            </span>
          </div>
          <div>
            <p className={styles.startTitle}>
              {phase === "loading"
                ? "Opening your PDF…"
                : mode === "sign"
                  ? "Open a PDF and make it official."
                  : mode === "organize"
                    ? "Put every page in the right place."
                  : "Click existing PDF text and rewrite it."}
            </p>
            <p className={styles.startCopy}>
              {phase === "loading"
                ? "Pages are being prepared in this browser."
                : mode === "organize"
                  ? "Drop a PDF here to reorder, rotate, remove, or add pages. Nothing is uploaded."
                  : "Drop a text-based PDF here. Pagelea detects editable text locally, and nothing is uploaded."}
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

  return (
    <div
      className={`${styles.workspace} ${styles.editor} ${
        mode === "organize" ? styles.organizeMode : ""
      }`}
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

      <header className={styles.topbar}>
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
              disabled={zoom <= 0.45}
              onClick={() =>
                setZoom((value) => clamp(value - 0.15, 0.4, 1.8))
              }
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
              disabled={zoom >= 1.8}
              onClick={() =>
                setZoom((value) => clamp(value + 0.15, 0.4, 1.8))
              }
              type="button"
            >
              <ZoomIn size={17} />
            </button>
          </div>
          <button
            className={styles.exportButton}
            disabled={phase === "exporting"}
            onClick={() => void exportPdf()}
            type="button"
          >
            {phase === "exporting" ? (
              <LoaderCircle size={18} />
            ) : (
              <Download size={18} />
            )}
            {phase === "exporting" ? "Exporting" : "Export PDF"}
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.editorBody}>
        <aside className={styles.pagesPanel} aria-label="Document pages">
          <div className={styles.panelHeader}>
            <strong>Pages</strong>
            <span className={styles.pageCount}>{snapshot.pages.length}</span>
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
                  aria-label={`Open page ${index + 1}`}
                  className={styles.thumbCanvas}
                  onClick={() => {
                    finishInspectorEditing();
                    finishTextEditing();
                    setActivePageId(page.id);
                    setSelectedId(null);
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
          <nav className={styles.toolRail} aria-label="Editing tools">
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
          </nav>

          <div className={styles.canvasViewport}>
            <div className={styles.canvasScroller}>
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
                  className={styles.overlaySurface}
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
                  {activePageElements.map(renderElement)}
                </div>
              </div>
            </div>
            <p className={styles.hint}>
              {tool === "edit-text"
                ? activeTextLayerStatus === "loading"
                  ? "Finding editable text on this page…"
                  : activeTextLayerStatus === "empty"
                    ? "No selectable text was found. Scanned text cannot be rewritten yet; use Add text to place new content."
                    : activeTextLayerStatus === "error"
                      ? "Text detection failed on this page. You can still use Add text and Whiteout."
                      : "Click an outlined text block, then type directly on the page."
                : tool === "select"
                ? "Select an element to move, resize, or style it."
                : tool === "draw" ||
                    (tool === "signature" && signatureMode === "draw")
                  ? "Drag directly on the page."
                  : tool === "image" ||
                      (tool === "signature" &&
                        signatureMode === "upload")
                    ? "Click the page to place the image."
                    : "Click or drag on the page to add the element."}
            </p>
          </div>
        </section>

        <aside className={styles.inspector} aria-label="Element properties">
          <div className={styles.inspectorHeader}>
            <div>
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
            {selectedElement ? <Check size={18} /> : null}
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
                    <div className={styles.sourceTextNotice}>
                      <TextCursorInput size={17} />
                      <div>
                        <strong>Editing original PDF text</strong>
                        <span>
                          Compatible PDF text stays searchable and vector.
                          Complex content is safely flattened so the old words
                          are never left underneath.
                        </span>
                      </div>
                    </div>
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
                      onChange={(event) =>
                        updateSelectedContinuously({
                          text: event.target.value,
                        })
                      }
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
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times">Times</option>
                      <option value="Courier">Courier</option>
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
                        type="number"
                        value={selectedElement.fontSize}
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
                  type="number"
                  value={selectedElement.rotation ?? 0}
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

      <footer className={styles.statusBar}>
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
