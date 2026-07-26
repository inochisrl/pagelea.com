export type EditorFitMode = "page" | "width";

type EditorFitZoomOptions = {
  horizontalPadding: number;
  maximumZoom?: number;
  minimumZoom?: number;
  mode: EditorFitMode;
  pageHeight: number;
  pageWidth: number;
  verticalPadding: number;
  viewportHeight: number;
  viewportWidth: number;
};

const EDITOR_BASE_PAGE_WIDTH = 720;

function clampZoom(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function computeEditorFitZoom({
  horizontalPadding,
  maximumZoom = 1.8,
  minimumZoom = 0.1,
  mode,
  pageHeight,
  pageWidth,
  verticalPadding,
  viewportHeight,
  viewportWidth,
}: EditorFitZoomOptions) {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    return minimumZoom;
  }

  const availableWidth = Math.max(1, viewportWidth - horizontalPadding);
  const availableHeight = Math.max(1, viewportHeight - verticalPadding);
  const widthZoom = availableWidth / EDITOR_BASE_PAGE_WIDTH;
  const pageHeightAtUnitZoom =
    EDITOR_BASE_PAGE_WIDTH * (pageHeight / pageWidth);
  const heightZoom = availableHeight / pageHeightAtUnitZoom;
  const nextZoom =
    mode === "width" ? widthZoom : Math.min(widthZoom, heightZoom);

  return clampZoom(nextZoom, minimumZoom, maximumZoom);
}
