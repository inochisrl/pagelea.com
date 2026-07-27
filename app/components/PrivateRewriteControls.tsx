"use client";

import { LoaderCircle, ScanText, ShieldCheck, X } from "lucide-react";

import type { LocalOcrLanguage } from "../lib/pdf-local-ocr";
import styles from "./PrivateRewriteControls.module.css";

export type PrivateRewriteStatus =
  | "idle"
  | "recognizing"
  | "ready"
  | "error";

interface PrivateRewriteControlsProps {
  disabled?: boolean;
  language: LocalOcrLanguage;
  message: string;
  onCancel: () => void;
  onLanguageChange: (language: LocalOcrLanguage) => void;
  onRecognize: () => void;
  progress: number;
  recognizedLines: number;
  status: PrivateRewriteStatus;
}

const LANGUAGE_OPTIONS: ReadonlyArray<{
  label: string;
  value: LocalOcrLanguage;
}> = [
  { label: "English", value: "eng" },
  { label: "Italiano", value: "ita" },
  { label: "English + Italiano", value: "eng+ita" },
];

export default function PrivateRewriteControls({
  disabled = false,
  language,
  message,
  onCancel,
  onLanguageChange,
  onRecognize,
  progress,
  recognizedLines,
  status,
}: PrivateRewriteControlsProps) {
  const recognizing = status === "recognizing";

  return (
    <section
      aria-label="Private Rewrite local OCR"
      className={styles.controls}
      data-status={status}
    >
      <div className={styles.identity}>
        <span className={styles.icon} aria-hidden="true">
          {recognizing ? (
            <LoaderCircle size={17} />
          ) : (
            <ScanText size={17} />
          )}
        </span>
        <span>
          <strong>Private Rewrite</strong>
          <small>
            <ShieldCheck size={12} aria-hidden="true" />
            OCR runs only in this browser
          </small>
        </span>
      </div>

      <label className={styles.language}>
        <span className={styles.srOnly}>Recognition language</span>
        <select
          disabled={disabled || recognizing}
          onChange={(event) =>
            onLanguageChange(event.target.value as LocalOcrLanguage)
          }
          value={language}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {recognizing ? (
        <button
          className={styles.cancel}
          onClick={onCancel}
          type="button"
        >
          <X size={15} />
          Cancel
        </button>
      ) : (
        <button
          className={styles.recognize}
          disabled={disabled}
          onClick={onRecognize}
          type="button"
        >
          <ScanText size={15} />
          {recognizedLines > 0 ? "Scan again" : "Recognize text"}
        </button>
      )}

      <span
        aria-live="polite"
        className={styles.status}
        role="status"
      >
        {recognizing
          ? `${message} · ${Math.round(progress)}%`
          : message ||
            (recognizedLines > 0
              ? `${recognizedLines} recognized lines`
              : "Ready to recognize this page locally.")}
      </span>
    </section>
  );
}
