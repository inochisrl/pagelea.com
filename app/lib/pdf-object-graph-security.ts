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
  onReference?: (reference: PDFRef) => void,
): PDFObject | undefined {
  let current: PDFObject | undefined = object;
  const seenReferences = new Set<string>();
  let depth = 0;
  while (current instanceof PDFRef) {
    if (depth >= PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth) {
      throwGraphLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    const key =
      `${current.objectNumber}:${current.generationNumber}`;
    if (seenReferences.has(key)) {
      throwGraphLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    seenReferences.add(key);
    depth += 1;
    onReference?.(current);
    try {
      current = document.context.lookup(current);
    } catch {
      return undefined;
    }
  }
  return current;
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
  onReference?: (reference: PDFRef) => void,
): string | undefined {
  const rawValue = dictionary.get(PDFName.of(key), true);
  const value = rawValue
    ? resolveObject(document, rawValue, onReference)
    : undefined;
  return value instanceof PDFName ? value.decodeText() : undefined;
}

const INHERITABLE_PAGE_ENTRY_NAMES = [
  "Resources",
  "MediaBox",
  "CropBox",
  "Rotate",
] as const;

function inheritedPageEntriesWithinLimits(
  document: PDFDocument,
  page: PDFDict,
  recordCopyWork: (units?: number) => void,
): ReadonlyMap<string, PDFObject> {
  const inherited = new Map<string, PDFObject>();
  const seenContainers = new Set<PDFObject>();
  const seenReferences = new Set<string>();
  let current: PDFDict | undefined = page;
  let depth = 0;

  while (current) {
    /*
     * PDFObjectCopier calls getInheritableAttribute once for each key. Each
     * call walks the complete parent chain even after finding its value.
     */
    recordCopyWork(INHERITABLE_PAGE_ENTRY_NAMES.length);
    if (
      depth > PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth ||
      seenContainers.has(current)
    ) {
      throwGraphLimit({
        code: "pdf-object-graph-too-deep",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
      });
    }
    seenContainers.add(current);

    for (const key of INHERITABLE_PAGE_ENTRY_NAMES) {
      if (inherited.has(key)) continue;
      const value = current.get(PDFName.of(key));
      if (value) inherited.set(key, value);
    }

    let parent = current.get(PDFName.of("Parent"), true);
    if (!parent) break;
    while (parent instanceof PDFRef) {
      recordCopyWork(INHERITABLE_PAGE_ENTRY_NAMES.length);
      depth += 1;
      if (
        depth >
        PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth
      ) {
        throwGraphLimit({
          code: "pdf-object-graph-too-deep",
          maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
        });
      }
      const key =
        `${parent.objectNumber}:${parent.generationNumber}`;
      if (seenReferences.has(key)) {
        throwGraphLimit({
          code: "pdf-object-graph-too-deep",
          maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
        });
      }
      seenReferences.add(key);
      try {
        parent = document.context.lookup(parent);
      } catch {
        parent = undefined;
      }
      if (!parent) break;
    }
    if (!(parent instanceof PDFDict)) break;
    depth += 1;
    current = parent;
  }

  return inherited;
}

/**
 * Checks the /Pages tree without invoking pdf-lib's recursive page
 * enumeration. This must run before getPageCount(), getPages() or getPage().
 */
export function assertPdfPageTreeWithinLimits(
  document: PDFDocument,
): void {
  let traversalWork = 0;
  const recordTraversalWork = (): void => {
    traversalWork += 1;
    if (
      traversalWork >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      throwGraphLimit({
        code: "pdf-object-graph-too-large",
        maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
      });
    }
  };
  const rawPages = document.catalog.get(PDFName.of("Pages"), true);
  let rootReferenceDepth = 0;
  const root = rawPages
    ? asContainer(
        resolveObject(
          document,
          rawPages,
          () => {
            rootReferenceDepth += 1;
            recordTraversalWork();
          },
        ),
      )
    : undefined;
  if (!root) return;

  let pageLeaves = 0;
  const seenBranches = new Set<PDFObject>();
  const stack: Array<{ object: PDFObject; depth: number }> = [
    { object: root, depth: rootReferenceDepth },
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
      ? resolveObject(
          document,
          rawKids,
          recordTraversalWork,
        )
      : undefined;
    if (!(kids instanceof PDFArray)) continue;

    for (let index = 0; index < kids.size(); index += 1) {
      recordTraversalWork();
      const rawKid = kids.get(index);
      let kidReferenceDepth = 0;
      const kid = rawKid
        ? asContainer(
            resolveObject(
              document,
              rawKid,
              () => {
                kidReferenceDepth += 1;
                recordTraversalWork();
              },
            ),
          )
        : undefined;
      const kidDictionary =
        kid instanceof PDFStream
          ? kid.dict
          : kid instanceof PDFDict
            ? kid
            : undefined;
      if (!kid || !kidDictionary) continue;
      const kidDepth =
        entry.depth + 1 + kidReferenceDepth;
      if (kidDepth > PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth) {
        throwGraphLimit({
          code: "pdf-object-graph-too-deep",
          maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
        });
      }
      const type = resolvedName(
        document,
        kidDictionary,
        "Type",
        recordTraversalWork,
      );
      if (type === "Pages") {
        stack.push({ object: kid, depth: kidDepth });
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
  const throwTooLarge = (): never =>
    throwGraphLimit({
      code: "pdf-object-graph-too-large",
      maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes,
    });
  const throwTooDeep = (): never =>
    throwGraphLimit({
      code: "pdf-object-graph-too-deep",
      maximum: PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth,
    });
  let aggregateCopyWork = 0;
  const recordAggregateCopyWork = (units = 1): void => {
    aggregateCopyWork += units;
    if (
      aggregateCopyWork >
      PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
    ) {
      throwTooLarge();
    }
  };

  /*
   * exportEditedPdf invokes copyPages once per source page. pdf-lib therefore
   * creates a fresh PDFObjectCopier (and a fresh visited-object map) for every
   * page. Validate depth and graph ownership independently for each copy so a
   * shallow path cannot mask a later deep one, while charging every occurrence
   * to the aggregate work budget above.
   */
  for (const pageIndex of pageIndexes) {
    const page = document.getPage(pageIndex).node;
    /*
     * PDFObjectCopier asks PDFPageLeaf for all inheritable values before it
     * removes /Parent. Resolve that untrusted backlink iteratively first;
     * PDFPageLeaf.ascend() is recursive and is not safe on an adversarial
     * parent chain.
     */
    const inheritedPageEntries =
      inheritedPageEntriesWithinLimits(
        document,
        page,
        recordAggregateCopyWork,
      );
    const traversedObjects = new Set<PDFObject>();
    const stack: Array<{ object: PDFObject; depth: number }> = [
      { object: page, depth: 0 },
    ];
    let visitedEntries = 0;
    let visitedObjects = 0;

    const recordEntry = (): void => {
      visitedEntries += 1;
      if (
        visitedEntries >
        PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
      ) {
        throwTooLarge();
      }
      recordAggregateCopyWork();
    };
    const recordObject = (object: PDFObject): boolean => {
      if (traversedObjects.has(object)) return false;
      traversedObjects.add(object);
      visitedObjects += 1;
      if (
        visitedObjects >
        PDF_SECURITY_LIMITS.maxPdfObjectGraphNodes
      ) {
        throwTooLarge();
      }
      recordAggregateCopyWork();
      return true;
    };
    const pushChildrenInCopyOrder = (
      children: readonly PDFObject[],
      depth: number,
    ): void => {
      /*
       * The stack is LIFO. Pushing in reverse preserves pdf-lib's first-to-last
       * recursive traversal order, including which alias is marked visited
       * first.
       */
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ object: children[index], depth });
      }
    };

    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) continue;
      if (
        entry.depth >
        PDF_SECURITY_LIMITS.maxPdfObjectGraphDepth
      ) {
        throwTooDeep();
      }

      if (entry.object instanceof PDFRef) {
        if (!recordObject(entry.object)) continue;
        let resolved: PDFObject | undefined;
        try {
          /*
           * PDFObjectCopier dereferences exactly one reference per recursive
           * call. Do the same instead of collapsing a chain up front.
           */
          resolved = document.context.lookup(entry.object);
        } catch {
          resolved = undefined;
        }
        if (resolved) {
          stack.push({
            object: resolved,
            depth: entry.depth + 1,
          });
        }
        continue;
      }

      const container = asContainer(entry.object);
      if (!container || !recordObject(container)) continue;

      if (container instanceof PDFArray) {
        const children: PDFObject[] = [];
        for (let index = 0; index < container.size(); index += 1) {
          recordEntry();
          const child = container.get(index);
          if (child) children.push(child);
        }
        pushChildrenInCopyOrder(children, entry.depth + 1);
        continue;
      }

      const dictionary =
        container instanceof PDFStream
          ? container.dict
          : container;
      const children: PDFObject[] = [];
      for (const [key, value] of dictionary.entries()) {
        /*
         * copyPDFPage materializes inheritable entries on a clone and removes
         * /Parent before PDFObjectCopier traverses it. The page-tree validator
         * has already bounded that inheritance walk.
         */
        if (
          container === page &&
          key.decodeText() === "Parent"
        ) {
          continue;
        }
        recordEntry();
        const keyText = key.decodeText();
        const inheritedReplacement =
          container === page &&
          INHERITABLE_PAGE_ENTRY_NAMES.includes(
            keyText as (typeof INHERITABLE_PAGE_ENTRY_NAMES)[number],
          ) &&
          !page.get(key)
            ? inheritedPageEntries.get(keyText)
            : undefined;
        children.push(inheritedReplacement ?? value);
      }

      if (container === page) {
        for (const key of INHERITABLE_PAGE_ENTRY_NAMES) {
          const name = PDFName.of(key);
          if (page.get(name, true) !== undefined) continue;
          const inherited = inheritedPageEntries.get(key);
          if (!inherited) continue;
          recordEntry();
          children.push(inherited);
        }
      }
      pushChildrenInCopyOrder(children, entry.depth + 1);
    }
  }
}
