import {
  type EditorTool,
  type Point,
  type RectEditorElement,
} from "./pdf-editor-types";

type RectEditorElementType = RectEditorElement["type"];

const TAP_RECT_SIZE: Record<
  RectEditorElementType,
  { height: number; width: number }
> = {
  highlight: { height: 0.045, width: 0.28 },
  shape: { height: 0.14, width: 0.24 },
  whiteout: { height: 0.075, width: 0.24 },
};

export function isTapSizedEditorRect(width: number, height: number) {
  return width <= 0.008 && height <= 0.008;
}

export function editorRectFromTap(
  type: RectEditorElementType,
  point: Point,
) {
  const size = TAP_RECT_SIZE[type];
  return {
    height: size.height,
    width: size.width,
    x: Math.min(1 - size.width, Math.max(0, point.x - size.width / 2)),
    y: Math.min(
      1 - size.height,
      Math.max(0, point.y - size.height / 2),
    ),
  };
}

export function isPersistentCreationTool(
  tool: EditorTool,
  drawingSignature: boolean,
) {
  return (
    tool === "draw" ||
    (tool === "signature" && drawingSignature)
  );
}
