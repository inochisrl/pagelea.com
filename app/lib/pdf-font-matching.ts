import type {
  EditorFontFamily,
  EditorTextDirection,
  FontMatchConfidence,
} from "./pdf-editor-types";
import type { ExtractedPdfTextFragment } from "./pdf-text-extraction";

export interface MatchedEditorFont {
  bold: boolean;
  confidence: FontMatchConfidence;
  family: EditorFontFamily;
  italic: boolean;
  sourceName: string;
}

export const EDITOR_FONT_OPTIONS: ReadonlyArray<{
  family: EditorFontFamily;
  label: string;
}> = Object.freeze([
  { family: "Helvetica", label: "Helvetica compatible" },
  { family: "Noto Sans", label: "Noto Sans" },
  { family: "Noto Sans Condensed", label: "Noto Sans Condensed" },
  { family: "Times", label: "Times compatible" },
  { family: "Noto Serif", label: "Noto Serif" },
  { family: "Courier", label: "Courier compatible" },
  { family: "Noto Sans Mono", label: "Noto Sans Mono" },
]);

const EXACT_HELVETICA =
  /\b(?:arial|helvetica|liberation\s*sans|nimbus\s*sans)\b/;
const EXACT_TIMES =
  /\b(?:times(?:\s*new\s*roman)?|liberation\s*serif|nimbus\s*roman)\b/;
const EXACT_COURIER =
  /\b(?:courier(?:\s*new)?|liberation\s*mono|nimbus\s*mono)\b/;
const OTHER_SERIF =
  /\b(?:bookman|cambria|constantia|garamond|georgia|literata|merriweather|noto\s*serif|palatino|source\s*serif)\b/;
const OTHER_MONO =
  /\b(?:code|consolas|fixed|inconsolata|menlo|monaco|mono|source\s*code|typewriter)\b/;
const OTHER_SANS =
  /\b(?:calibri|candara|futura|gill\s*sans|inter|manrope|noto\s*sans|open\s*sans|roboto|san\s*francisco|segoe|source\s*sans|tahoma|trebuchet|ubuntu|verdana)\b/;
const CONDENSED =
  /\b(?:compressed|condensed|compact|narrow|semicondensed|semi\s*condensed)\b/;
const BOLD =
  /\b(?:black|bold|demi|demibold|extra\s*bold|heavy|semibold|semi\s*bold)\b/;
const ITALIC = /\b(?:italic|oblique|slanted)\b/;

function stripSubsetPrefix(value: string): string {
  return value.replace(/^[A-Z]{6}\+/, "");
}

/**
 * Normalizes internal PostScript names without discarding width/style hints.
 */
export function normalizePdfFontName(value: string): string {
  return stripSubsetPrefix(value.trim())
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_,]+/g, " ")
    .replace(/\b(?:psmt|ps|mt|std)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceFontName(fragment: ExtractedPdfTextFragment): string {
  const resolved = fragment.resolvedFontName?.trim();
  if (resolved) return stripSubsetPrefix(resolved);

  const family = fragment.fontFamily.trim();
  if (family && !/^(?:sans-serif|serif|monospace)$/i.test(family)) {
    return stripSubsetPrefix(family);
  }

  return stripSubsetPrefix(fragment.fontName.trim()) || "Unknown source font";
}

/**
 * Maps a PDF.js font description to a deliberately small, locally bundled
 * font palette. Exact PDF base-font aliases retain metric-compatible standard
 * fonts; other families use Noto alternatives, including a condensed face.
 */
export function matchExtractedPdfFont(
  fragment: ExtractedPdfTextFragment,
): MatchedEditorFont {
  const sourceName = sourceFontName(fragment);
  const genericFamily = fragment.fontFamily.trim().toLowerCase();
  const descriptiveFamily = /^(?:sans-serif|serif|monospace)$/i.test(
    fragment.fontFamily.trim(),
  )
    ? ""
    : fragment.fontFamily;
  const label = normalizePdfFontName(
    [
      fragment.resolvedFontName,
      descriptiveFamily,
      fragment.fontName,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const bold = fragment.bold || BOLD.test(label);
  const italic = fragment.italic || ITALIC.test(label);

  if (EXACT_COURIER.test(label)) {
    return {
      bold,
      confidence: "exact",
      family: "Courier",
      italic,
      sourceName,
    };
  }
  if (OTHER_MONO.test(label)) {
    return {
      bold,
      confidence: "close",
      family: "Noto Sans Mono",
      italic,
      sourceName,
    };
  }
  if (EXACT_TIMES.test(label)) {
    return {
      bold,
      confidence: "exact",
      family: "Times",
      italic,
      sourceName,
    };
  }
  if (OTHER_SERIF.test(label)) {
    return {
      bold,
      confidence: "close",
      family: "Noto Serif",
      italic,
      sourceName,
    };
  }
  if (CONDENSED.test(label)) {
    return {
      bold,
      confidence: "close",
      family: "Noto Sans Condensed",
      italic,
      sourceName,
    };
  }
  if (EXACT_HELVETICA.test(label)) {
    return {
      bold,
      confidence: "exact",
      family: "Helvetica",
      italic,
      sourceName,
    };
  }
  if (OTHER_SANS.test(label)) {
    return {
      bold,
      confidence: "close",
      family: "Noto Sans",
      italic,
      sourceName,
    };
  }
  if (genericFamily === "monospace") {
    return {
      bold,
      confidence: "generic",
      family: "Noto Sans Mono",
      italic,
      sourceName,
    };
  }
  if (genericFamily === "serif") {
    return {
      bold,
      confidence: "generic",
      family: "Noto Serif",
      italic,
      sourceName,
    };
  }

  return {
    bold,
    confidence: "generic",
    family: "Noto Sans",
    italic,
    sourceName,
  };
}

const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const HEBREW_SCRIPT = /\p{Script=Hebrew}/u;

export function editorFontCss(
  family: EditorFontFamily | undefined,
  text = "",
): string {
  const scriptFallback =
    '"Pagelea Noto Arabic", "Pagelea Noto Hebrew", "Pagelea Noto CJK", "Pagelea Noto Symbols 2"';

  let stack: string;
  switch (family) {
    case "Times":
      stack = `"Times New Roman", Times, ${scriptFallback}, serif`;
      break;
    case "Courier":
      stack = `"Courier New", Courier, ${scriptFallback}, monospace`;
      break;
    case "Noto Serif":
      stack = `"Pagelea Noto Serif", ${scriptFallback}, Georgia, serif`;
      break;
    case "Noto Sans Mono":
      stack = `"Pagelea Noto Sans Mono", ${scriptFallback}, "Courier New", monospace`;
      break;
    case "Noto Sans Condensed":
      stack = `"Pagelea Noto Sans Condensed", ${scriptFallback}, "Arial Narrow", sans-serif`;
      break;
    case "Noto Sans":
      stack = `"Pagelea Noto Sans", ${scriptFallback}, Arial, sans-serif`;
      break;
    case "Helvetica":
    default:
      stack = `Helvetica, Arial, ${scriptFallback}, sans-serif`;
  }

  /*
   * System Helvetica/Times faces may contain their own RTL glyphs. Put the
   * exact bundled shaping face first for pure Arabic/Hebrew edits so preview
   * metrics do not silently depend on the operating system.
   */
  if (ARABIC_SCRIPT.test(text)) {
    return `"Pagelea Noto Arabic", ${stack}`;
  }
  if (HEBREW_SCRIPT.test(text)) {
    return `"Pagelea Noto Hebrew", ${stack}`;
  }
  return stack;
}

export function editorFontLabel(family: EditorFontFamily): string {
  return (
    EDITOR_FONT_OPTIONS.find((option) => option.family === family)?.label ??
    family
  );
}

const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const LTR_SCRIPT = /[\p{Alphabetic}\p{Number}]/u;

export function inferTextDirection(
  text: string,
  reportedDirection?: string,
): EditorTextDirection {
  if (reportedDirection === "rtl") return "rtl";
  if (reportedDirection === "ltr") return "ltr";

  for (const character of text) {
    if (RTL_SCRIPT.test(character)) return "rtl";
    if (LTR_SCRIPT.test(character)) return "ltr";
  }
  return "ltr";
}
