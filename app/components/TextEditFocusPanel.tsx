"use client";

import { TextCursorInput, X } from "lucide-react";
import {
  useEffect,
  type KeyboardEvent,
  type RefObject,
} from "react";

import styles from "./TextEditFocusPanel.module.css";

export type FocusedTextEditVariant = "add" | "edit" | "replace";

type TextEditFocusPanelProps = {
  direction: "ltr" | "rtl";
  errorMessage: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  maxLength: number;
  onApply: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  originalText: string;
  panelRef: RefObject<HTMLElement | null>;
  text: string;
  variant: FocusedTextEditVariant;
};

function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((control) => control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function TextEditFocusPanel({
  direction,
  errorMessage,
  inputRef,
  maxLength,
  onApply,
  onCancel,
  onChange,
  originalText,
  panelRef,
  text,
  variant,
}: TextEditFocusPanelProps) {
  const isEmptyAddition = variant === "add" && !text.trim();
  const copy =
    variant === "add"
      ? {
          action: "Add text",
          cancelLabel: "Cancel adding text",
          description:
            "Write comfortably without changing the page zoom. The text is added only when you confirm.",
          fieldLabel: "Text",
          title: "Add text",
        }
      : variant === "edit"
        ? {
            action: !text.trim() ? "Remove text" : "Save text",
            cancelLabel: "Cancel text editing",
            description:
              "Edit without changing the page zoom. Nothing changes until you confirm.",
            fieldLabel: "New text",
            title: "Edit text",
          }
        : {
            action:
              text.length === 0 ? "Remove text" : "Replace text",
            cancelLabel: "Cancel text replacement",
            description:
              "Edit without changing the page zoom. Nothing changes until you confirm.",
            fieldLabel: "New text",
            title: "Replace text",
          };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inputRef]);

  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (!isEmptyAddition) onApply();
      return;
    }
    trapDialogFocus(event);
  }

  return (
    <>
      <button
        aria-hidden="true"
        className={styles.backdrop}
        onClick={onCancel}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-describedby={
          errorMessage
            ? "focused-text-editor-description focused-text-editor-error"
            : "focused-text-editor-description"
        }
        aria-labelledby="focused-text-editor-title"
        aria-modal="true"
        className={styles.panel}
        onKeyDown={onPanelKeyDown}
        ref={panelRef}
        role="dialog"
      >
        <div aria-hidden="true" className={styles.handle} />
        <header className={styles.header}>
          <span className={styles.icon}>
            <TextCursorInput size={19} />
          </span>
          <div>
            <h2 id="focused-text-editor-title">{copy.title}</h2>
            <p id="focused-text-editor-description">
              {copy.description}
            </p>
          </div>
          <button
            aria-label={copy.cancelLabel}
            className={styles.closeButton}
            onClick={onCancel}
            type="button"
          >
            <X size={20} />
          </button>
        </header>

        {variant === "add" ? null : (
          <div className={styles.original}>
            <span>Original</span>
            <p dir="auto">{originalText || "Empty text"}</p>
          </div>
        )}

        <label className={styles.field}>
          <span>{copy.fieldLabel}</span>
          <textarea
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            dir={direction}
            maxLength={maxLength}
            onChange={(event) => onChange(event.currentTarget.value)}
            ref={inputRef}
            rows={6}
            spellCheck={false}
            value={text}
          />
        </label>

        {errorMessage ? (
          <p
            className={styles.errorMessage}
            id="focused-text-editor-error"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        <footer className={styles.actions}>
          <button
            className={styles.cancelButton}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.applyButton}
            disabled={isEmptyAddition}
            onClick={onApply}
            type="button"
          >
            {copy.action}
          </button>
        </footer>
      </section>
    </>
  );
}
