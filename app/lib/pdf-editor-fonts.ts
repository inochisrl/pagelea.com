import type { PDFDocument, PDFFont } from "pdf-lib";

import type {
  EditorFontFamily,
  EditorTextDirection,
} from "./pdf-editor-types";
import { createAbortError } from "./abort";
import { PDF_SECURITY_LIMITS } from "./pdf-security-limits";

const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;

export type PdfEditorFontRole =
  | "primary"
  | "arabic"
  | "hebrew"
  | "cjk-jp"
  | "symbols";

export type PdfEditorFontErrorCode =
  | "unsupported-script"
  | "unsupported-glyph"
  | "font-asset-fetch"
  | "font-asset-too-large"
  | "font-asset-invalid"
  | "font-origin"
  | "too-many-font-runs";

export class PdfEditorFontError extends Error {
  readonly assetId?: string;
  readonly code: PdfEditorFontErrorCode;
  readonly codePoint?: number;

  constructor(
    code: PdfEditorFontErrorCode,
    message: string,
    details: { assetId?: string; codePoint?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "PdfEditorFontError";
    this.code = code;
    this.assetId = details.assetId;
    this.codePoint = details.codePoint;
  }
}

export interface PdfEditorFontAsset {
  readonly family: string;
  readonly id: string;
  readonly maxBytes: number;
  readonly path: `/private-rewrite/fonts/${string}`;
  /**
   * Symbols2 deliberately remains un-subsetted. pdf-lib/fontkit 1.1.1 writes
   * an extractable subset for that font, but several BMP outlines disappear
   * in PDF renderers. All other validated assets are safely subsetted.
   */
  readonly subset: boolean;
  readonly roles: ReadonlyArray<PdfEditorFontRole>;
  readonly style: "normal" | "italic";
  readonly weight: 400 | 700;
  /** Selects a static instance from a reviewed variable font before subsetting. */
  readonly variationWeight?: 400 | 700;
}

function fontAsset(
  asset: PdfEditorFontAsset,
): Readonly<PdfEditorFontAsset> {
  return Object.freeze({
    ...asset,
    roles: Object.freeze([...asset.roles]),
  });
}

const STANDARD_MAX_BYTES = 768 * KIBIBYTE;

export const PDF_EDITOR_FONT_ASSETS = Object.freeze([
  fontAsset({
    id: "noto-sans-regular",
    family: "Noto Sans",
    path: "/private-rewrite/fonts/NotoSans-Regular.ttf",
    weight: 400,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-bold",
    family: "Noto Sans",
    path: "/private-rewrite/fonts/NotoSans-Bold.ttf",
    weight: 700,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-italic",
    family: "Noto Sans",
    path: "/private-rewrite/fonts/NotoSans-Italic.ttf",
    weight: 400,
    style: "italic",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-bold-italic",
    family: "Noto Sans",
    path: "/private-rewrite/fonts/NotoSans-BoldItalic.ttf",
    weight: 700,
    style: "italic",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-condensed-regular",
    family: "Noto Sans Condensed",
    path: "/private-rewrite/fonts/NotoSans-Condensed.ttf",
    weight: 400,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-condensed-bold",
    family: "Noto Sans Condensed",
    path: "/private-rewrite/fonts/NotoSans-CondensedBold.ttf",
    weight: 700,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-condensed-italic",
    family: "Noto Sans Condensed",
    path: "/private-rewrite/fonts/NotoSans-CondensedItalic.ttf",
    weight: 400,
    style: "italic",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-condensed-bold-italic",
    family: "Noto Sans Condensed",
    path: "/private-rewrite/fonts/NotoSans-CondensedBoldItalic.ttf",
    weight: 700,
    style: "italic",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-serif-regular",
    family: "Noto Serif",
    path: "/private-rewrite/fonts/NotoSerif-Regular.ttf",
    weight: 400,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-serif-bold",
    family: "Noto Serif",
    path: "/private-rewrite/fonts/NotoSerif-Bold.ttf",
    weight: 700,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-serif-italic",
    family: "Noto Serif",
    path: "/private-rewrite/fonts/NotoSerif-Italic.ttf",
    weight: 400,
    style: "italic",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-serif-bold-italic",
    family: "Noto Serif",
    path: "/private-rewrite/fonts/NotoSerif-BoldItalic.ttf",
    weight: 700,
    style: "italic",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-mono-regular",
    family: "Noto Sans Mono",
    path: "/private-rewrite/fonts/NotoSansMono-Regular.ttf",
    weight: 400,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-mono-bold",
    family: "Noto Sans Mono",
    path: "/private-rewrite/fonts/NotoSansMono-Bold.ttf",
    weight: 700,
    style: "normal",
    roles: ["primary"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-arabic-regular",
    family: "Noto Sans Arabic",
    path: "/private-rewrite/fonts/NotoSansArabic-Regular.ttf",
    weight: 400,
    style: "normal",
    roles: ["arabic"],
    maxBytes: 320 * KIBIBYTE,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-arabic-bold",
    family: "Noto Sans Arabic",
    path: "/private-rewrite/fonts/NotoSansArabic-Bold.ttf",
    weight: 700,
    style: "normal",
    roles: ["arabic"],
    maxBytes: 320 * KIBIBYTE,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-hebrew-regular",
    family: "Noto Sans Hebrew",
    path: "/private-rewrite/fonts/NotoSansHebrew-Regular.ttf",
    weight: 400,
    style: "normal",
    roles: ["hebrew"],
    maxBytes: 64 * KIBIBYTE,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-hebrew-bold",
    family: "Noto Sans Hebrew",
    path: "/private-rewrite/fonts/NotoSansHebrew-Bold.ttf",
    weight: 700,
    style: "normal",
    roles: ["hebrew"],
    maxBytes: 64 * KIBIBYTE,
    subset: true,
  }),
  fontAsset({
    id: "noto-sans-jp-variable-regular",
    family: "Noto Sans JP",
    path: "/private-rewrite/fonts/NotoSansJP[wght].ttf",
    weight: 400,
    style: "normal",
    roles: ["cjk-jp"],
    maxBytes: 10 * MEBIBYTE,
    subset: true,
    variationWeight: 400,
  }),
  fontAsset({
    id: "noto-sans-jp-variable-bold",
    family: "Noto Sans JP",
    path: "/private-rewrite/fonts/NotoSansJP[wght].ttf",
    weight: 700,
    style: "normal",
    roles: ["cjk-jp"],
    maxBytes: 10 * MEBIBYTE,
    subset: true,
    variationWeight: 700,
  }),
  fontAsset({
    id: "noto-sans-symbols2-regular",
    family: "Noto Sans Symbols 2",
    path: "/private-rewrite/fonts/NotoSansSymbols2-Regular.ttf",
    weight: 400,
    style: "normal",
    roles: ["symbols"],
    maxBytes: STANDARD_MAX_BYTES,
    subset: false,
  }),
] as const);

const ASSET_BY_ID = new Map(
  PDF_EDITOR_FONT_ASSETS.map((asset) => [asset.id, asset]),
);

function getFontAsset(id: string): Readonly<PdfEditorFontAsset> {
  const asset = ASSET_BY_ID.get(id);
  if (!asset) {
    throw new PdfEditorFontError(
      "font-asset-invalid",
      `Unknown bundled PDF font asset "${id}".`,
      { assetId: id },
    );
  }
  return asset;
}

function allowedFontAsset(
  assetOrId: Readonly<PdfEditorFontAsset> | string,
): Readonly<PdfEditorFontAsset> {
  return getFontAsset(
    typeof assetOrId === "string" ? assetOrId : assetOrId.id,
  );
}

const LATIN = /^\p{Script=Latin}$/u;
const GREEK = /^\p{Script=Greek}$/u;
const CYRILLIC = /^\p{Script=Cyrillic}$/u;
const ARABIC = /^\p{Script=Arabic}$/u;
const HEBREW = /^\p{Script=Hebrew}$/u;
const HAN = /^\p{Script=Han}$/u;
const HIRAGANA = /^\p{Script=Hiragana}$/u;
const KATAKANA = /^\p{Script=Katakana}$/u;
const HANGUL = /^\p{Script=Hangul}$/u;
const LETTER = /^\p{Letter}$/u;
const MARK = /^\p{Mark}$/u;
const NUMBER = /^\p{Number}$/u;
const PUNCTUATION = /^\p{Punctuation}$/u;
const SEPARATOR = /^\p{Separator}$/u;
const SYMBOL = /^\p{Symbol}$/u;
const CJK_SCRIPT_EXTENSION =
  /^(?:\p{Script_Extensions=Han}|\p{Script_Extensions=Hiragana}|\p{Script_Extensions=Katakana})$/u;

/**
 * These Symbols2 glyphs have an explicit render + extraction contract. Other
 * common Unicode symbols stay with the selected primary Noto face and are
 * checked against its cmap immediately after embedding.
 */
const VALIDATED_SYMBOLS2_CODE_POINTS = new Set([
  0x231b, // ⌛
  0x23f3, // ⏳
  0x2600, // ☀
  0x2605, // ★
  0x265e, // ♞
  0x2713, // ✓
  0x1f7bf, // 🞿
  0x1f846, // 🡆
]);

type CharacterRole =
  | PdfEditorFontRole
  | "common"
  | "control";

interface CharacterRecord {
  character: string;
  codePoint: number;
  role: CharacterRole;
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function printableCharacter(character: string): string {
  if (character === "\n") return "\\n";
  if (character === "\r") return "\\r";
  if (character === "\t") return "\\t";
  return character;
}

function unsupportedCharacter(
  code: "unsupported-script" | "unsupported-glyph",
  character: string,
  context: string,
): never {
  const codePoint = character.codePointAt(0) ?? 0;
  throw new PdfEditorFontError(
    code,
    `${context}: "${printableCharacter(character)}" (${formatCodePoint(codePoint)}).`,
    { codePoint },
  );
}

function isEmojiCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x1fc00 && codePoint <= 0x1ffff)
  );
}

function classifyCharacter(character: string): CharacterRecord {
  const codePoint = character.codePointAt(0) ?? 0;

  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    unsupportedCharacter(
      "unsupported-glyph",
      character,
      "Unpaired UTF-16 surrogate is not valid PDF text",
    );
  }
  if (character === "\n" || character === "\r" || character === "\t") {
    return { character, codePoint, role: "control" };
  }
  if (ARABIC.test(character)) {
    return { character, codePoint, role: "arabic" };
  }
  if (HEBREW.test(character)) {
    return { character, codePoint, role: "hebrew" };
  }
  if (HAN.test(character) || HIRAGANA.test(character) || KATAKANA.test(character)) {
    return { character, codePoint, role: "cjk-jp" };
  }
  if (HANGUL.test(character)) {
    unsupportedCharacter(
      "unsupported-script",
      character,
      "Hangul is not supported by the validated CJK JP subset renderer",
    );
  }
  if (
    LATIN.test(character) ||
    GREEK.test(character) ||
    CYRILLIC.test(character)
  ) {
    return { character, codePoint, role: "primary" };
  }
  if (VALIDATED_SYMBOLS2_CODE_POINTS.has(codePoint)) {
    return { character, codePoint, role: "symbols" };
  }
  if (isEmojiCodePoint(codePoint)) {
    unsupportedCharacter(
      "unsupported-glyph",
      character,
      "Color emoji and unvalidated pictographs are not supported",
    );
  }
  if (
    MARK.test(character) ||
    NUMBER.test(character) ||
    PUNCTUATION.test(character) ||
    SEPARATOR.test(character)
  ) {
    return { character, codePoint, role: "common" };
  }
  if (LETTER.test(character)) {
    unsupportedCharacter(
      "unsupported-script",
      character,
      "This script requires shaping that Private Rewrite has not validated",
    );
  }
  if (SYMBOL.test(character)) {
    return { character, codePoint, role: "primary" };
  }

  unsupportedCharacter(
    "unsupported-glyph",
    character,
    "This control, private-use, or unassigned character is not supported",
  );
}

function characterRecords(text: string): CharacterRecord[] {
  return Array.from(text, classifyCharacter);
}

function isValidatedRtlRecord(
  record: CharacterRecord,
  role: "arabic" | "hebrew",
): boolean {
  return (
    (record.role === role && LETTER.test(record.character)) ||
    record.role === "control" ||
    SEPARATOR.test(record.character)
  );
}

/**
 * Enforces the scripts for which Pagelea has a render + extraction contract.
 * It intentionally does not call PDFFont.encodeText: encoding mutates
 * pdf-lib's subset glyph collection and is therefore not a safe validator.
 */
export function assertSupportedText(text: string): void {
  const records = characterRecords(text.normalize("NFC"));
  const rtlRole = records.find(
    (record) => record.role === "arabic" || record.role === "hebrew",
  )?.role;
  if (rtlRole !== "arabic" && rtlRole !== "hebrew") return;

  const mixedRecord = records.find(
    (record) => !isValidatedRtlRecord(record, rtlRole),
  );
  if (mixedRecord) {
    unsupportedCharacter(
      "unsupported-script",
      mixedRecord.character,
      "Private Rewrite supports pure Arabic or Hebrew letters and spaces; marks, numbers, punctuation, mixed scripts, and mixed RTL are not yet safe to shape and reorder",
    );
  }
}

export interface PdfEditorFontSelection {
  readonly bold?: boolean;
  readonly family?: EditorFontFamily;
  readonly italic?: boolean;
}

export interface ResolvedPdfEditorFont {
  readonly asset: Readonly<PdfEditorFontAsset>;
  readonly direction: EditorTextDirection;
  readonly role: PdfEditorFontRole;
  /** The caller may opt into a visual fallback; it is never applied silently. */
  readonly syntheticBold: boolean;
  /** The caller may opt into a visual fallback; it is never applied silently. */
  readonly syntheticItalic: boolean;
}

function primaryAssetPrefix(
  family: EditorFontFamily | undefined,
): "noto-sans" | "noto-sans-condensed" | "noto-serif" | "noto-sans-mono" {
  switch (family) {
    case "Times":
    case "Noto Serif":
      return "noto-serif";
    case "Courier":
    case "Noto Sans Mono":
      return "noto-sans-mono";
    case "Noto Sans Condensed":
      return "noto-sans-condensed";
    case "Helvetica":
    case "Noto Sans":
    default:
      return "noto-sans";
  }
}

export function resolvePdfEditorFont(
  role: PdfEditorFontRole,
  selection: PdfEditorFontSelection = {},
): ResolvedPdfEditorFont {
  const bold = selection.bold === true;
  const italic = selection.italic === true;
  let assetId: string;
  let syntheticBold = false;
  let syntheticItalic = false;

  if (role === "arabic") {
    assetId = `noto-sans-arabic-${bold ? "bold" : "regular"}`;
    syntheticItalic = italic;
  } else if (role === "hebrew") {
    assetId = `noto-sans-hebrew-${bold ? "bold" : "regular"}`;
    syntheticItalic = italic;
  } else if (role === "cjk-jp") {
    assetId = `noto-sans-jp-variable-${bold ? "bold" : "regular"}`;
    syntheticItalic = italic;
  } else if (role === "symbols") {
    assetId = "noto-sans-symbols2-regular";
    syntheticBold = bold;
    syntheticItalic = italic;
  } else {
    const prefix = primaryAssetPrefix(selection.family);
    if (prefix === "noto-sans-mono") {
      assetId = `${prefix}-${bold ? "bold" : "regular"}`;
      syntheticItalic = italic;
    } else {
      const variant = italic
        ? bold
          ? "bold-italic"
          : "italic"
        : bold
          ? "bold"
          : "regular";
      assetId = `${prefix}-${variant}`;
    }
  }

  return Object.freeze({
    asset: getFontAsset(assetId),
    direction:
      role === "arabic" || role === "hebrew" ? "rtl" : "ltr",
    role,
    syntheticBold,
    syntheticItalic,
  });
}

export interface PdfEditorFontRun extends ResolvedPdfEditorFont {
  readonly text: string;
}

function dominantRole(records: ReadonlyArray<CharacterRecord>): PdfEditorFontRole {
  if (records.some((record) => record.role === "arabic")) return "arabic";
  if (records.some((record) => record.role === "hebrew")) return "hebrew";
  if (records.some((record) => record.role === "primary")) return "primary";
  if (records.some((record) => record.role === "cjk-jp")) return "cjk-jp";
  if (records.some((record) => record.role === "symbols")) return "symbols";
  return "primary";
}

function isCjkCompatibilityCharacter(record: CharacterRecord): boolean {
  const { codePoint } = record;
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x30fb && codePoint <= 0x30fc) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe1f) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60)
  );
}

function neighboringTextRole(
  records: ReadonlyArray<CharacterRecord>,
  startIndex: number,
  step: -1 | 1,
): PdfEditorFontRole | undefined {
  for (
    let index = startIndex + step;
    index >= 0 && index < records.length;
    index += step
  ) {
    const role = records[index]?.role;
    if (
      role === "primary" ||
      role === "arabic" ||
      role === "hebrew" ||
      role === "cjk-jp"
    ) {
      return role;
    }
  }
  return undefined;
}

function contextualCommonRole(
  records: ReadonlyArray<CharacterRecord>,
  index: number,
  fallbackRole: PdfEditorFontRole,
  precedingRole: PdfEditorFontRole | undefined,
): PdfEditorFontRole {
  const record = records[index];
  if (!record) return fallbackRole;
  if (MARK.test(record.character) && precedingRole) return precedingRole;

  const previousTextRole = neighboringTextRole(records, index, -1);
  const nextTextRole = neighboringTextRole(records, index, 1);
  const hasCjkNeighbor =
    previousTextRole === "cjk-jp" || nextTextRole === "cjk-jp";

  if (
    isCjkCompatibilityCharacter(record) ||
    (hasCjkNeighbor && CJK_SCRIPT_EXTENSION.test(record.character))
  ) {
    return "cjk-jp";
  }

  return previousTextRole ?? nextTextRole ?? fallbackRole;
}

/**
 * Produces adjacent font runs without network or font parsing. Text is NFC
 * normalized so common decomposed accents use their precomposed Noto glyph.
 */
export function planPdfEditorFontRuns(
  text: string,
  selection: PdfEditorFontSelection = {},
): ReadonlyArray<PdfEditorFontRun> {
  const normalizedText = text.normalize("NFC");
  assertSupportedText(normalizedText);
  const records = characterRecords(normalizedText);
  if (records.length === 0) return Object.freeze([]);

  const fallbackRole = dominantRole(records);
  const runs: PdfEditorFontRun[] = [];
  let precedingRole: PdfEditorFontRole | undefined;

  for (const [index, record] of records.entries()) {
    const role =
      record.role === "control"
        ? fallbackRole
        : record.role === "common"
          ? contextualCommonRole(
              records,
              index,
              fallbackRole,
              precedingRole,
            )
          : record.role;
    const resolved = resolvePdfEditorFont(role, selection);
    const previous = runs.at(-1);

    if (
      previous &&
      previous.asset.id === resolved.asset.id &&
      previous.direction === resolved.direction &&
      previous.syntheticBold === resolved.syntheticBold &&
      previous.syntheticItalic === resolved.syntheticItalic
    ) {
      runs[runs.length - 1] = Object.freeze({
        ...previous,
        text: previous.text + record.character,
      });
    } else {
      if (
        runs.length >= PDF_SECURITY_LIMITS.maxEditorFontRunsPerElement
      ) {
        throw new PdfEditorFontError(
          "too-many-font-runs",
          `Text needs more than ${PDF_SECURITY_LIMITS.maxEditorFontRunsPerElement} font runs. Split it into smaller text boxes or reduce script switching.`,
        );
      }
      runs.push(Object.freeze({ ...resolved, text: record.character }));
    }
    precedingRole = role;
  }

  return Object.freeze(runs);
}

export type PdfEditorFontAssetLoader = (
  asset: Readonly<PdfEditorFontAsset>,
  signal?: AbortSignal,
) => Promise<ArrayBuffer | Uint8Array>;

export interface PdfEditorFontLoaderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly loadAsset?: PdfEditorFontAssetLoader;
  /** Trusted application origin, primarily injectable for SSR and tests. */
  readonly origin?: string;
}

export interface PdfEditorFontLoader {
  clear(): void;
  load(
    assetOrId: Readonly<PdfEditorFontAsset> | string,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

const SHARED_FONT_BYTE_CACHES = new WeakMap<
  PdfEditorFontAssetLoader | typeof fetch,
  Map<string, Promise<Uint8Array>>
>();

function sharedFontByteCache(
  options: PdfEditorFontLoaderOptions,
): Map<string, Promise<Uint8Array>> {
  const source = options.loadAsset ?? options.fetchImpl ?? globalThis.fetch;
  if (typeof source !== "function") return new Map();

  let cache = SHARED_FONT_BYTE_CACHES.get(source);
  if (!cache) {
    cache = new Map();
    SHARED_FONT_BYTE_CACHES.set(source, cache);
  }
  return cache;
}

function observeAbort<Value>(
  operation: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  if (!signal) return operation;
  if (signal.aborted) {
    return Promise.reject(
      createAbortError("PDF font loading was cancelled."),
    );
  }

  return new Promise<Value>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(createAbortError("PDF font loading was cancelled."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function validateFontMagic(
  bytes: Uint8Array,
  asset: Readonly<PdfEditorFontAsset>,
): void {
  if (bytes.byteLength === 0 || bytes.byteLength > asset.maxBytes) {
    throw new PdfEditorFontError(
      bytes.byteLength > asset.maxBytes
        ? "font-asset-too-large"
        : "font-asset-invalid",
      `Bundled font "${asset.id}" has invalid size ${bytes.byteLength} bytes (limit ${asset.maxBytes}).`,
      { assetId: asset.id },
    );
  }

  const isOpenType =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x4f;
  const isTrueType =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00;
  const isAppleTrueType =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x74 &&
    bytes[1] === 0x72 &&
    bytes[2] === 0x75 &&
    bytes[3] === 0x65;

  if (!isOpenType && !isTrueType && !isAppleTrueType) {
    throw new PdfEditorFontError(
      "font-asset-invalid",
      `Bundled font "${asset.id}" is not a supported OpenType/TrueType file.`,
      { assetId: asset.id },
    );
  }
}

function asUint8Array(
  value: ArrayBuffer | Uint8Array,
  asset: Readonly<PdfEditorFontAsset>,
): Uint8Array {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!bytes) {
    throw new PdfEditorFontError(
      "font-asset-invalid",
      `Loader for "${asset.id}" returned an unsupported byte container.`,
      { assetId: asset.id },
    );
  }
  validateFontMagic(bytes, asset);
  return bytes;
}

function trustedOrigin(explicitOrigin?: string): string {
  const candidate =
    explicitOrigin ??
    (typeof globalThis.location === "object"
      ? globalThis.location.origin
      : undefined);
  if (!candidate) {
    throw new PdfEditorFontError(
      "font-origin",
      "A trusted application origin is required to load bundled PDF fonts.",
    );
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new PdfEditorFontError(
      "font-origin",
      "The configured PDF font origin is invalid.",
      { cause: error },
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PdfEditorFontError(
      "font-origin",
      `PDF fonts cannot be loaded from the ${url.protocol} protocol.`,
    );
  }
  return url.origin;
}

async function readBoundedResponse(
  response: Response,
  asset: Readonly<PdfEditorFontAsset>,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const byteLength = Number(declaredLength);
    if (!Number.isSafeInteger(byteLength) || byteLength > asset.maxBytes) {
      throw new PdfEditorFontError(
        "font-asset-too-large",
        `Bundled font "${asset.id}" exceeds its ${asset.maxBytes}-byte limit.`,
        { assetId: asset.id },
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return asUint8Array(await response.arrayBuffer(), asset);
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > asset.maxBytes) {
      await reader.cancel();
      throw new PdfEditorFontError(
        "font-asset-too-large",
        `Bundled font "${asset.id}" exceeded its ${asset.maxBytes}-byte streaming limit.`,
        { assetId: asset.id },
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  validateFontMagic(bytes, asset);
  return bytes;
}

async function fetchFontAsset(
  asset: Readonly<PdfEditorFontAsset>,
  options: PdfEditorFontLoaderOptions,
): Promise<Uint8Array> {
  const origin = trustedOrigin(options.origin);
  const url = new URL(asset.path, `${origin}/`);
  if (
    url.origin !== origin ||
    url.pathname !== asset.path ||
    (url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    throw new PdfEditorFontError(
      "font-origin",
      `Bundled font "${asset.id}" resolved outside the trusted origin.`,
      { assetId: asset.id },
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PdfEditorFontError(
      "font-asset-fetch",
      "No fetch implementation is available for bundled PDF fonts.",
      { assetId: asset.id },
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: "force-cache",
      credentials: "same-origin",
      redirect: "error",
    });
  } catch (error) {
    throw new PdfEditorFontError(
      "font-asset-fetch",
      `Could not fetch bundled font "${asset.id}".`,
      { assetId: asset.id, cause: error },
    );
  }
  if (!response.ok) {
    throw new PdfEditorFontError(
      "font-asset-fetch",
      `Bundled font "${asset.id}" returned HTTP ${response.status}.`,
      { assetId: asset.id },
    );
  }
  if (response.url) {
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== origin || finalUrl.pathname !== asset.path) {
      throw new PdfEditorFontError(
        "font-origin",
        `Bundled font "${asset.id}" was redirected outside its allowlisted URL.`,
        { assetId: asset.id },
      );
    }
  }

  return readBoundedResponse(response, asset);
}

export function createPdfEditorFontLoader(
  options: PdfEditorFontLoaderOptions = {},
): PdfEditorFontLoader {
  const cache = sharedFontByteCache(options);
  const usedCacheKeys = new Set<string>();

  const loadOnce = async (
    asset: Readonly<PdfEditorFontAsset>,
  ): Promise<Uint8Array> => {
    if (options.loadAsset) {
      try {
        return asUint8Array(await options.loadAsset(asset), asset);
      } catch (error) {
        if (error instanceof PdfEditorFontError) throw error;
        throw new PdfEditorFontError(
          "font-asset-fetch",
          `Could not load bundled font "${asset.id}".`,
          { assetId: asset.id, cause: error },
        );
      }
    }
    return fetchFontAsset(asset, options);
  };

  return Object.freeze({
    clear(): void {
      for (const cacheKey of usedCacheKeys) cache.delete(cacheKey);
      usedCacheKeys.clear();
    },
    load(
      assetOrId: Readonly<PdfEditorFontAsset> | string,
      signal?: AbortSignal,
    ): Promise<Uint8Array> {
      const asset = allowedFontAsset(assetOrId);

      const cacheKey = options.loadAsset
        ? asset.id
        : `${trustedOrigin(options.origin)}\u0000${asset.path}`;
      usedCacheKeys.add(cacheKey);
      const cached = cache.get(cacheKey);
      if (cached) return observeAbort(cached, signal);

      const pending = loadOnce(asset).catch((error: unknown) => {
        if (cache.get(cacheKey) === pending) cache.delete(cacheKey);
        throw error;
      });
      cache.set(cacheKey, pending);
      return observeAbort(pending, signal);
    },
  });
}

/**
 * Validates against the embedded font cmap without mutating subset state.
 */
const FONT_CHARACTER_SET_CACHE = new WeakMap<
  PDFFont,
  ReadonlySet<number>
>();

export function assertFontCoversText(
  font: PDFFont,
  text: string,
  asset?: Readonly<PdfEditorFontAsset>,
): void {
  assertSupportedText(text);
  let supportedCodePoints = FONT_CHARACTER_SET_CACHE.get(font);
  if (!supportedCodePoints) {
    supportedCodePoints = new Set(font.getCharacterSet());
    FONT_CHARACTER_SET_CACHE.set(font, supportedCodePoints);
  }

  for (const character of text.normalize("NFC")) {
    if (character === "\n" || character === "\r" || character === "\t") {
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (!supportedCodePoints.has(codePoint)) {
      throw new PdfEditorFontError(
        "unsupported-glyph",
        `Font "${asset?.family ?? font.name}" cannot encode "${printableCharacter(character)}" (${formatCodePoint(codePoint)}).`,
        { assetId: asset?.id, codePoint },
      );
    }
  }
}

export interface PdfEditorFontEmbedderOptions
  extends PdfEditorFontLoaderOptions {
  readonly loader?: PdfEditorFontLoader;
}

export interface PdfEditorFontEmbedder {
  clear(): void;
  embed(
    assetOrId: Readonly<PdfEditorFontAsset> | string,
    text?: string,
    signal?: AbortSignal,
  ): Promise<PDFFont>;
  embedRun(run: PdfEditorFontRun, signal?: AbortSignal): Promise<PDFFont>;
}

let fontkitPromise:
  | Promise<Awaited<ReturnType<typeof importPdfLibFontkit>>>
  | undefined;

async function importPdfLibFontkit() {
  const fontkitModule = await import("@pdf-lib/fontkit");
  return fontkitModule.default;
}

function loadPdfLibFontkit() {
  fontkitPromise ??= importPdfLibFontkit().catch((error: unknown) => {
    fontkitPromise = undefined;
    throw error;
  });
  return fontkitPromise;
}

type PdfLibFontkit = Awaited<ReturnType<typeof importPdfLibFontkit>>;

function variableFontkitAdapter(
  fontkit: PdfLibFontkit,
  asset: Readonly<PdfEditorFontAsset>,
): PdfLibFontkit {
  const variationWeight = asset.variationWeight;
  if (variationWeight === undefined) return fontkit;

  return {
    ...fontkit,
    create(
      ...arguments_: Parameters<PdfLibFontkit["create"]>
    ): ReturnType<PdfLibFontkit["create"]> {
      const font = fontkit.create(...arguments_);
      const variable = font as typeof font & {
        getVariation?: (axes: { wght: number }) => typeof font;
        variationAxes?: {
          wght?: {
            max: number;
            min: number;
          };
        };
      };
      const axis = variable.variationAxes?.wght;
      if (
        typeof variable.getVariation !== "function" ||
        !axis ||
        variationWeight < axis.min ||
        variationWeight > axis.max
      ) {
        throw new PdfEditorFontError(
          "font-asset-invalid",
          `Bundled font "${asset.id}" does not expose the reviewed weight axis.`,
          { assetId: asset.id },
        );
      }
      return variable.getVariation({
        wght: variationWeight,
      }) as ReturnType<PdfLibFontkit["create"]>;
    },
  };
}

/**
 * Lazily registers fontkit and embeds each asset at most once per PDF.
 */
export function createPdfEditorFontEmbedder(
  pdfDocument: PDFDocument,
  options: PdfEditorFontEmbedderOptions = {},
): PdfEditorFontEmbedder {
  const loader = options.loader ?? createPdfEditorFontLoader(options);
  const embeddedFonts = new Map<string, Promise<PDFFont>>();
  const fontkitAdapters = new Map<
    number,
    Promise<PdfLibFontkit>
  >();

  const fontkitForAsset = (
    asset: Readonly<PdfEditorFontAsset>,
  ): Promise<PdfLibFontkit> => {
    const weight = asset.variationWeight ?? 0;
    const cached = fontkitAdapters.get(weight);
    if (cached) return cached;
    const pending = loadPdfLibFontkit()
      .then((fontkit) => variableFontkitAdapter(fontkit, asset))
      .catch((error: unknown) => {
        if (fontkitAdapters.get(weight) === pending) {
          fontkitAdapters.delete(weight);
        }
        throw error;
      });
    fontkitAdapters.set(weight, pending);
    return pending;
  };

  const embedAsset = (
    asset: Readonly<PdfEditorFontAsset>,
    signal?: AbortSignal,
  ): Promise<PDFFont> => {
    const embed = async (
      fontkit: PdfLibFontkit,
      bytes: Uint8Array,
    ): Promise<PDFFont> => {
      /*
       * PDFDocument captures its registered adapter synchronously when
       * embedFont starts. This keeps concurrent regular/bold variable-font
       * instances isolated even though pdf-lib stores one adapter per PDF.
       */
      pdfDocument.registerFontkit(fontkit);
      return pdfDocument.embedFont(bytes, {
        customName:
          asset.variationWeight === undefined
            ? undefined
            : `NotoSansJP-${asset.weight === 700 ? "Bold" : "Regular"}`,
        subset: asset.subset,
      });
    };

    const cached = embeddedFonts.get(asset.id);
    if (cached) return observeAbort(cached, signal);

    const pending = Promise.all([
      fontkitForAsset(asset),
      loader.load(asset),
    ])
      .then(([fontkit, bytes]) =>
        embed(fontkit, bytes),
      )
      .catch((error: unknown) => {
        if (embeddedFonts.get(asset.id) === pending) {
          embeddedFonts.delete(asset.id);
        }
        throw error;
      });
    embeddedFonts.set(asset.id, pending);
    return observeAbort(pending, signal);
  };

  return Object.freeze({
    clear(): void {
      embeddedFonts.clear();
      loader.clear();
    },
    async embed(
      assetOrId: Readonly<PdfEditorFontAsset> | string,
      text?: string,
      signal?: AbortSignal,
    ): Promise<PDFFont> {
      const asset = allowedFontAsset(assetOrId);
      const font = await embedAsset(asset, signal);
      if (text !== undefined) assertFontCoversText(font, text, asset);
      return font;
    },
    embedRun(
      run: PdfEditorFontRun,
      signal?: AbortSignal,
    ): Promise<PDFFont> {
      return this.embed(run.asset, run.text, signal);
    },
  });
}
