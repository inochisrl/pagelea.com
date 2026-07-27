"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";

import type { EditorPage } from "../lib/pdf-editor-types";
import type { PdfPreviewDocument } from "../lib/pdf-preview";
import {
  createTaskLimiter,
  PDF_SECURITY_LIMITS,
  shouldRenderObservedArea,
} from "../lib/pdf-security-limits";

type PreviewQuality = "main" | "thumbnail";
type PreviewState =
  | "blank"
  | "deferred"
  | "error"
  | "loading"
  | "ready";

interface PdfPageCanvasProps {
  document: PdfPreviewDocument | null;
  page: EditorPage;
  className?: string;
  quality?: PreviewQuality;
}

interface PreviewSize {
  width: number;
  height: number;
}

const VISUALLY_HIDDEN: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

const STATUS_SURFACE: CSSProperties = {
  alignItems: "center",
  background: "#f7f8f4",
  color: "#59645f",
  display: "flex",
  fontSize: 12,
  fontWeight: 700,
  inset: 0,
  justifyContent: "center",
  letterSpacing: "0.02em",
  padding: 16,
  position: "absolute",
  textAlign: "center",
};

const runThumbnailTask = createTaskLimiter(
  PDF_SECURITY_LIMITS.thumbnailRenderConcurrency,
);

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized =
    ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
}

function boundedRenderScale(
  logicalSize: PreviewSize,
  quality: PreviewQuality,
): number {
  const qualityScale = quality === "thumbnail" ? 0.38 : 1.45;
  const pixelRatio = Math.min(
    Math.max(window.devicePixelRatio || 1, 1),
    2,
  );
  const maxDimension = quality === "thumbnail" ? 1024 : 4096;
  const maxPixels =
    quality === "thumbnail" ? 900_000 : 12_000_000;
  let scale = Math.min(
    qualityScale * pixelRatio,
    maxDimension / Math.max(1, logicalSize.width),
    maxDimension / Math.max(1, logicalSize.height),
    Math.sqrt(
      maxPixels /
        Math.max(1, logicalSize.width * logicalSize.height),
    ),
  );

  // Account for integer canvas rounding while keeping hard caps intact.
  for (let pass = 0; pass < 2; pass += 1) {
    const width = Math.max(1, Math.ceil(logicalSize.width * scale));
    const height = Math.max(
      1,
      Math.ceil(logicalSize.height * scale),
    );
    const adjustment = Math.min(
      1,
      maxDimension / width,
      maxDimension / height,
      Math.sqrt(maxPixels / Math.max(1, width * height)),
    );
    scale *= adjustment;
  }

  return Math.max(Number.EPSILON, scale);
}

function getFallbackSize(
  sourceWidth: number,
  sourceHeight: number,
  totalRotation: number,
): PreviewSize {
  const width =
    Number.isFinite(sourceWidth) && sourceWidth > 0
      ? sourceWidth
      : 612;
  const height =
    Number.isFinite(sourceHeight) && sourceHeight > 0
      ? sourceHeight
      : 792;
  const rotation = normalizeRotation(totalRotation);

  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

function getErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    error.name !== "RenderingCancelledException" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return "The page preview could not be rendered.";
}

function PdfPageCanvas({
  document,
  page,
  className,
  quality = "main",
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    rotation: pageRotation,
    sourceHeight,
    sourcePageIndex,
    sourceRotation,
    sourceWidth,
  } = page;
  const [previewState, setPreviewState] = useState<PreviewState>(
    sourcePageIndex === null
      ? "blank"
      : quality === "thumbnail"
        ? "deferred"
        : "loading",
  );
  const [shouldRender, setShouldRender] = useState(
    quality !== "thumbnail" || sourcePageIndex === null,
  );
  const [previewSize, setPreviewSize] = useState<PreviewSize>(() =>
    getFallbackSize(
      sourceWidth,
      sourceHeight,
      sourceRotation + pageRotation,
    ),
  );
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (quality !== "thumbnail" || sourcePageIndex === null) {
      let stale = false;
      queueMicrotask(() => {
        if (!stale) setShouldRender(true);
      });
      return () => {
        stale = true;
      };
    }

    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      let stale = false;
      queueMicrotask(() => {
        if (!stale) setShouldRender(true);
      });
      return () => {
        stale = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setShouldRender(shouldRenderObservedArea(entries));
      },
      { rootMargin: "360px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [quality, sourcePageIndex]);

  useEffect(() => {
    let stale = false;
    let renderTask: RenderTask | null = null;
    let renderedPage: PDFPageProxy | null = null;
    const renderController = new AbortController();
    const canvas = canvasRef.current;
    clearCanvas(canvas);
    const fallbackSize = getFallbackSize(
      sourceWidth,
      sourceHeight,
      sourceRotation + pageRotation,
    );
    const pendingState: PreviewState =
      sourcePageIndex === null
        ? "blank"
        : shouldRender
          ? "loading"
          : "deferred";

    queueMicrotask(() => {
      if (stale) return;
      setPreviewSize(fallbackSize);
      setErrorMessage("");
      setPreviewState(pendingState);
    });

    if (sourcePageIndex === null) {
      return () => {
        stale = true;
        renderController.abort();
      };
    }

    if (!document || !shouldRender) {
      return () => {
        stale = true;
        renderController.abort();
      };
    }

    const renderPage = async () => {
      try {
        if (renderController.signal.aborted) return;
        const pdfPage = await document.getPage(sourcePageIndex + 1);
        renderedPage = pdfPage;
        if (stale || renderController.signal.aborted) return;

        const rotation = normalizeRotation(
          sourceRotation + pageRotation,
        );
        const logicalViewport = pdfPage.getViewport({
          rotation,
          scale: 1,
        });
        const logicalSize = {
          width: logicalViewport.width,
          height: logicalViewport.height,
        };

        setPreviewSize(logicalSize);
        const activeCanvas = canvasRef.current;
        if (!activeCanvas || activeCanvas !== canvas) return;

        const renderScale = boundedRenderScale(
          logicalSize,
          quality,
        );
        const renderViewport = pdfPage.getViewport({
          rotation,
          scale: renderScale,
        });

        activeCanvas.width = Math.max(
          1,
          Math.ceil(renderViewport.width),
        );
        activeCanvas.height = Math.max(
          1,
          Math.ceil(renderViewport.height),
        );

        renderTask = pdfPage.render({
          background: "#ffffff",
          canvas: activeCanvas,
          viewport: renderViewport,
        });

        await renderTask.promise;
        if (!stale && !renderController.signal.aborted) {
          setPreviewState("ready");
        }
      } catch (error) {
        if (
          stale ||
          renderController.signal.aborted ||
          (error instanceof Error &&
            error.name === "RenderingCancelledException")
        ) {
          return;
        }

        setErrorMessage(getErrorMessage(error));
        setPreviewState("error");
      } finally {
        try {
          renderedPage?.cleanup();
        } catch {
          // Rendering cancellation can race PDF.js' internal cleanup.
        }
      }
    };

    const scheduledRender =
      quality === "thumbnail"
        ? runThumbnailTask(renderPage, renderController.signal)
        : renderPage();
    void scheduledRender.catch((error: unknown) => {
      if (
        stale ||
        renderController.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      setErrorMessage(getErrorMessage(error));
      setPreviewState("error");
    });

    return () => {
      stale = true;
      renderController.abort();
      renderTask?.cancel();
      clearCanvas(canvas);
    };
  }, [
    document,
    pageRotation,
    quality,
    shouldRender,
    sourceHeight,
    sourcePageIndex,
    sourceRotation,
    sourceWidth,
  ]);

  const statusText =
    previewState === "blank"
      ? "Blank page"
      : previewState === "deferred"
        ? "PDF preview waits until it is near the viewport"
        : previewState === "loading"
          ? "Loading PDF preview"
          : previewState === "error"
            ? "PDF preview unavailable"
            : "PDF page preview ready";

  return (
    <div
      aria-busy={previewState === "loading"}
      className={className}
      data-pdf-preview-state={previewState}
      ref={containerRef}
      style={{
        aspectRatio: `${previewSize.width} / ${previewSize.height}`,
        background: "#ffffff",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      <canvas
        aria-label={
          page.sourcePageIndex === null
            ? "Blank PDF page"
            : `PDF page ${page.sourcePageIndex + 1}`
        }
        ref={canvasRef}
        role="img"
        style={{
          display: "block",
          height: "100%",
          inset: 0,
          opacity: previewState === "ready" ? 1 : 0,
          position: "absolute",
          width: "100%",
        }}
      />

      {previewState === "blank" ? (
        <div aria-hidden="true" style={STATUS_SURFACE}>
          Blank page
        </div>
      ) : null}

      {previewState === "loading" ? (
        <div aria-hidden="true" style={STATUS_SURFACE}>
          Loading preview…
        </div>
      ) : null}

      {previewState === "deferred" ? (
        <div aria-hidden="true" style={STATUS_SURFACE}>
          Preview
        </div>
      ) : null}

      {previewState === "error" ? (
        <div style={STATUS_SURFACE} title={errorMessage}>
          Preview unavailable
        </div>
      ) : null}

      <span aria-live="polite" role="status" style={VISUALLY_HIDDEN}>
        {statusText}
      </span>
    </div>
  );
}

export default PdfPageCanvas;
