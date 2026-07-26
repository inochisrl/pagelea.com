import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from "pdf-lib";

import {
  describePdfSecurityLimitIssue,
  PDF_SECURITY_LIMITS,
  type PdfSecurityLimitIssue,
} from "./pdf-security-limits";

function resolveObject(
  document: PDFDocument,
  object: PDFObject,
): PDFObject | undefined {
  if (!(object instanceof PDFRef)) return object;
  try {
    return document.context.lookup(object);
  } catch {
    return undefined;
  }
}

function asContainer(
  object: PDFObject | undefined,
): PDFArray | PDFDict | PDFStream | undefined {
  if (
    object instanceof PDFArray ||
    object instanceof PDFDict ||
    object instanceof PDFStream
  ) {
    return object;
  }
  return undefined;
}

function throwGraphLimit(issue: PdfSecurityLimitIssue): never {
  const error = new Error(describePdfSecurityLimitIssue(issue));
  error.name = "PdfSecurityLimitError";
  throw error;
}

function resolvedName(
  document: PDFDocument,
  dictionary: PDFDict,
  key: string,
): string | undefined {
  const rawValue = dictionary.get(PDFName.of(key), true);
  const value = rawValue
    ? resolveObject(document, rawValue)
    : undefined;
  return value instanceof PDFName ? value.decodeText() : undefined;
}

/**
 * Checks the /Pages tree without invoking pdf-lib's recursive page
 * enumeration. This must run before getPageCount(), getPages() or getPage().
 */
export function assertPdfPageTreeWithinLimits(
  document: PDFDocument,
): void {
  const rawPages = document.catalog.get(PDFName.of("Pages"), true);
  const root = rawPages
    ? asContainer(resolveObject(document, rawPages))
    : undefined;
  if (!root) return;

  let pageLeaves = 0;
  const seenBranches = new Set<PDFObject>();
  const stack: Array<{ object: PDFObject; depth: number }> = [
    { object: root, depth: 0 },
  ];

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (entry.depth > PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth) {
      throwGraphLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    if (seenBranches.has(entry.object)) {
      throwGraphLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    seenBranches.add(entry.object);
    if (
      seenBranches.size >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      throwGraphLimit({
        code: "pdf-object-graph-too-large",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
      });
    }

    const dictionary =
      entry.object instanceof PDFStream
        ? entry.object.dict
        : entry.object instanceof PDFDict
          ? entry.object
          : undefined;
    if (!dictionary) continue;
    const rawKids = dictionary.get(PDFName.of("Kids"), true);
    const kids = rawKids
      ? resolveObject(document, rawKids)
      : undefined;
    if (!(kids instanceof PDFArray)) continue;

    for (let index = 0; index < kids.size(); index += 1) {
      const rawKid = kids.get(index);
      const kid = rawKid
        ? asContainer(resolveObject(document, rawKid))
        : undefined;
      const kidDictionary =
        kid instanceof PDFStream
          ? kid.dict
          : kid instanceof PDFDict
            ? kid
            : undefined;
      if (!kid || !kidDictionary) continue;
      const type = resolvedName(document, kidDictionary, "Type");
      if (type === "Pages") {
        stack.push({ object: kid, depth: entry.depth + 1 });
      } else if (type === "Page") {
        pageLeaves += 1;
        const pageIssue =
          pageLeaves > PDF_SECURITY_LIMITS.maxPages
            ? {
                code: "too-many-pages" as const,
                maxPages: PDF_SECURITY_LIMITS.maxPages,
              }
            : null;
        if (pageIssue) throwGraphLimit(pageIssue);
      }
    }
  }
}

/**
 * Iteratively inspects page-reachable containers before pdf-lib's recursive
 * copier sees them. Object identity tracking handles normal cyclic PDF page
 * trees without allowing an attacker-controlled chain to consume the JS stack.
 */
export function assertPdfPageGraphWithinLimits(
  document: PDFDocument,
  pageIndexes: readonly number[],
): void {
  const shallowestDepth = new Map<PDFObject, number>();
  const stack: Array<{ object: PDFObject; depth: number }> = [];

  const enqueue = (
    rawObject: PDFObject | undefined,
    depth: number,
  ): void => {
    if (!rawObject) return;
    const object = asContainer(resolveObject(document, rawObject));
    if (!object) return;
    if (depth > PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth) {
      throwGraphLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    const previousDepth = shallowestDepth.get(object);
    if (previousDepth !== undefined && previousDepth <= depth) return;
    shallowestDepth.set(object, depth);
    if (
      shallowestDepth.size >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      throwGraphLimit({
        code: "pdf-object-graph-too-large",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
      });
    }
    stack.push({ object, depth });
  };

  for (const pageIndex of pageIndexes) {
    enqueue(document.getPage(pageIndex).node, 0);
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    const dictionary =
      entry.object instanceof PDFStream
        ? entry.object.dict
        : entry.object instanceof PDFDict
          ? entry.object
          : undefined;

    if (dictionary) {
      for (const [, value] of dictionary.entries()) {
        enqueue(value, entry.depth + 1);
      }
      continue;
    }

    if (entry.object instanceof PDFArray) {
      for (let index = 0; index < entry.object.size(); index += 1) {
        enqueue(entry.object.get(index), entry.depth + 1);
      }
    }
  }
}
