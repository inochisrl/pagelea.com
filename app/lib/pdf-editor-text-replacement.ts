import {
  type EditorSnapshot,
  type TextEditorElement,
} from "./pdf-editor-types";

export type FocusedTextEditIntent = "create" | "update";

export type FocusedTextReplacementResult = {
  elementId: string;
  outcome: "applied" | "missing" | "unchanged";
  snapshot: EditorSnapshot;
};

/**
 * Applies a focused text draft as one immutable history operation.
 *
 * A source fragment is unique per page. The defensive upsert prevents rapid
 * duplicate activations from leaving two replacements for the same PDF text.
 */
export function applyFocusedTextReplacement(
  current: EditorSnapshot,
  draftedElement: TextEditorElement,
  intent: FocusedTextEditIntent,
): FocusedTextReplacementResult {
  if (intent === "create") {
    if (!draftedElement.sourceText && !draftedElement.text.trim()) {
      return {
        elementId: draftedElement.id,
        outcome: "unchanged",
        snapshot: current,
      };
    }
    const matchingSource = draftedElement.sourceText
      ? current.elements.find(
          (candidate) =>
            candidate.type === "text" &&
            candidate.pageId === draftedElement.pageId &&
            candidate.sourceText?.id === draftedElement.sourceText?.id,
        )
      : undefined;
    if (matchingSource?.type === "text") {
      if (
        matchingSource.text === draftedElement.text &&
        matchingSource.direction === draftedElement.direction
      ) {
        return {
          elementId: matchingSource.id,
          outcome: "unchanged",
          snapshot: current,
        };
      }
      return {
        elementId: matchingSource.id,
        outcome: "applied",
        snapshot: {
          ...current,
          elements: current.elements.map((candidate) =>
            candidate.id === matchingSource.id
              ? {
                  ...matchingSource,
                  text: draftedElement.text,
                  direction: draftedElement.direction,
                }
              : candidate,
          ),
        },
      };
    }
    return {
      elementId: draftedElement.id,
      outcome: "applied",
      snapshot: {
        ...current,
        elements: [...current.elements, draftedElement],
      },
    };
  }

  const existing = current.elements.find(
    (candidate) => candidate.id === draftedElement.id,
  );
  if (
    existing?.type !== "text"
  ) {
    return {
      elementId: draftedElement.id,
      outcome: "missing",
      snapshot: current,
    };
  }
  if (!existing.sourceText && !draftedElement.text.trim()) {
    return {
      elementId: draftedElement.id,
      outcome: "applied",
      snapshot: {
        ...current,
        elements: current.elements.filter(
          (candidate) => candidate.id !== draftedElement.id,
        ),
      },
    };
  }
  if (
    existing.text === draftedElement.text &&
    existing.direction === draftedElement.direction
  ) {
    return {
      elementId: draftedElement.id,
      outcome: "unchanged",
      snapshot: current,
    };
  }
  return {
    elementId: draftedElement.id,
    outcome: "applied",
    snapshot: {
      ...current,
      elements: current.elements.map((candidate) =>
        candidate.id === draftedElement.id ? draftedElement : candidate,
      ),
    },
  };
}
