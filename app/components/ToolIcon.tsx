import type { LucideIcon } from "lucide-react";
import {
  FileArchive,
  FilePenLine,
  FilePlus2,
  Grip,
  Layers2,
  Merge,
  Signature,
  Split,
} from "lucide-react";
import { createElement } from "react";

import type { ToolIconKey } from "../lib/tools";

const ICONS: Record<ToolIconKey, LucideIcon> = {
  compress: FileArchive,
  edit: FilePenLine,
  flatten: Layers2,
  "image-add": FilePlus2,
  merge: Merge,
  organize: Grip,
  signature: Signature,
  split: Split,
};

export function ToolIcon({
  name,
  size = 22,
  strokeWidth = 1.8,
}: {
  name: ToolIconKey;
  size?: number;
  strokeWidth?: number;
}) {
  return createElement(ICONS[name], {
    "aria-hidden": true,
    size,
    strokeWidth,
  });
}
