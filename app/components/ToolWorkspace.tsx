"use client";

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileText,
  GripVertical,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";

import { isPublicToolSlug } from "../../shared/public-tools";
import { trackAnalyticsEvent } from "../lib/analytics-client";
import {
  describePdfSecurityLimitIssue,
  getFileSelectionLimitIssue,
  getTextFieldLimitIssue,
  PDF_SECURITY_LIMITS,
} from "../lib/pdf-security-limits";
import type { Tool } from "../lib/tools";

type WorkspacePhase =
  | "idle"
  | "configuring"
  | "processing"
  | "ready"
  | "error";

interface WorkspaceProcessOptions {
  pages?: string;
  pageRange?: string;
  ranges?: string;
  aggressive?: boolean;
  keepSmallest?: boolean;
  removeMetadata?: boolean;
  pageSize?: "fit" | "a4" | "letter";
  orientation?: "auto" | "portrait" | "landscape";
  imageFit?: "contain";
  margin?: number;
}

interface ReadyResult {
  blob: Blob;
  filename: string;
  message?: string;
}

interface ToolWorkspaceProps {
  tool: Tool;
}

interface ToolOptionFlags {
  pages: boolean;
  imageLayout: boolean;
  optimize: boolean;
}

function getOptionFlags(slug: string): ToolOptionFlags {
  return {
    pages: slug === "split-pdf",
    imageLayout: slug === "jpg-to-pdf",
    optimize: slug === "compress-pdf",
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeAcceptedFiles(accept: string) {
  if (accept.includes("image") && accept.includes("pdf")) {
    return "PDF, JPG or PNG";
  }

  if (accept.includes("image")) {
    return "JPG or PNG";
  }

  return "PDF";
}

function fileMatchesAccept(file: File, accept: string) {
  const rules = accept
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);

  if (rules.length === 0) return true;

  const filename = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  return rules.some((rule) => {
    if (rule.startsWith(".")) return filename.endsWith(rule);
    if (rule.endsWith("/*")) {
      return mimeType.startsWith(rule.slice(0, -1));
    }
    if (mimeType === rule) return true;
    if (rule === "application/pdf") return filename.endsWith(".pdf");
    if (rule === "image/jpeg") {
      return filename.endsWith(".jpg") || filename.endsWith(".jpeg");
    }
    if (rule === "image/png") return filename.endsWith(".png");
    return false;
  });
}

function normalizeProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  const percentage = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(percentage)));
}

function normalizePageRange(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  if (["all", "*"].includes(normalizedValue)) {
    return "all";
  }
  return value.trim();
}

function localizeProgressStage(stage: string) {
  const exactStages: Record<string, string> = {
    Preparing: "Preparing",
    "Reading PDF": "Reading PDF",
    "Reading PDF form": "Reading form fields",
    "Building PDF": "Building PDF",
    "Building merged PDF": "Building merged PDF",
    "Copying selected pages": "Copying selected pages",
    "Discarding unused PDF objects": "Removing unused objects",
    "Flattening form fields": "Flattening form fields",
    "Writing object streams": "Optimizing document structure",
    Done: "Document ready",
  };

  if (exactStages[stage]) return exactStages[stage];

  return stage
    .replace(/^Building part (\d+)$/i, "Building output $1");
}

function localizeProcessingError(error: unknown) {
  const errorRecord =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : null;
  const code =
    typeof errorRecord?.code === "string" ? errorRecord.code : undefined;

  const messagesByCode: Record<string, string> = {
    EXPECTED_IMAGE:
      "One file is not a JPG or PNG image. Replace it and try again.",
    EXPECTED_PDF:
      "One file is not a PDF. Replace it with a compatible document.",
    INVALID_PAGE_SELECTION:
      "The page range is not valid. Use a format such as 1-3, 6, 9-12.",
    INVALID_PDF:
      "Pagelea could not read one of the PDFs. It may be protected, damaged, or unsupported.",
    MISSING_FILES: "Choose at least one file before processing.",
    NO_PAGES:
      "The selected files do not contain any pages Pagelea can process.",
    PROCESSING_FAILED:
      "Processing stopped. Check the document and try again.",
    UNSUPPORTED_FILE:
      "One file uses an unsupported format. Choose a PDF, JPG, or PNG.",
    UNSUPPORTED_TOOL:
      "This tool is not part of Pagelea’s production catalogue.",
    MISSING_SPLIT_GROUPS:
      "Enter at least two page groups separated by semicolons, for example 1-3; 4-6.",
  };

  if (code && messagesByCode[code]) return messagesByCode[code];
  if (typeof errorRecord?.message === "string" && errorRecord.message.trim()) {
    return errorRecord.message;
  }
  return "Processing failed. Check the files and try again.";
}

function fallbackFilename(slug: string) {
  const stem = slug.replace(/-pdf(?:-.+)?$/, "").replace(/[^a-z0-9-]/gi, "");
  return `pagelea-${stem || "document"}.pdf`;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export function ToolWorkspace({ tool }: ToolWorkspaceProps) {
  const inputId = useId();
  const headingId = useId();
  const uploadHintId = useId();
  const statusId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const slug = tool.slug;
  const title = tool.title;
  const accept = tool.acceptedInputs.join(",");
  const allowsMultiple = tool.multiple;
  const acceptedFilesLabel = describeAcceptedFiles(accept);
  const optionFlags = useMemo(() => getOptionFlags(slug), [slug]);
  const hasOptions = Object.values(optionFlags).some(Boolean);

  const [phase, setPhase] = useState<WorkspacePhase>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(
    null,
  );
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState(
    "Preparing documents…",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readyResult, setReadyResult] = useState<ReadyResult | null>(null);

  const [pageRange, setPageRange] = useState("");
  const [imagePageSize, setImagePageSize] =
    useState<"fit" | "a4" | "letter">("fit");
  const [imageMargin, setImageMargin] = useState(18);
  const [imageOrientation, setImageOrientation] =
    useState<"auto" | "portrait" | "landscape">("auto");
  const [aggressiveOptimization, setAggressiveOptimization] = useState(false);
  const [removeMetadata, setRemoveMetadata] = useState(false);

  const isBusy = phase === "processing";

  const processingOptions = useMemo<WorkspaceProcessOptions>(() => {
    const options: WorkspaceProcessOptions = {};

    if (optionFlags.pages) {
      const normalizedRange = normalizePageRange(pageRange);
      if (normalizedRange) {
        options.pages = normalizedRange;
        options.pageRange = normalizedRange;
        options.ranges = normalizedRange;
      }
    }

    if (optionFlags.imageLayout) {
      options.pageSize = imagePageSize;
      options.margin = imageMargin;
      options.orientation = imageOrientation;
      options.imageFit = "contain";
    }

    if (optionFlags.optimize) {
      options.aggressive = aggressiveOptimization;
      options.removeMetadata = removeMetadata;
      options.keepSmallest = true;
    }

    return options;
  }, [
    aggressiveOptimization,
    imageMargin,
    imageOrientation,
    imagePageSize,
    optionFlags,
    pageRange,
    removeMetadata,
  ]);

  function moveFile(fromIndex: number, toIndex: number) {
    if (isBusy || fromIndex === toIndex || toIndex < 0) return;

    setFiles((currentFiles) => {
      if (
        fromIndex >= currentFiles.length ||
        toIndex >= currentFiles.length
      ) {
        return currentFiles;
      }

      const nextFiles = [...currentFiles];
      const [movedFile] = nextFiles.splice(fromIndex, 1);
      nextFiles.splice(toIndex, 0, movedFile);
      return nextFiles;
    });
  }

  function addFiles(incomingFiles: File[]) {
    if (isBusy || incomingFiles.length === 0) return;

    const acceptedFiles = incomingFiles.filter((file) =>
      fileMatchesAccept(file, accept),
    );

    if (acceptedFiles.length === 0) {
      setErrorMessage(
        `These files are not suitable for ${title}. Choose ${acceptedFilesLabel.toLowerCase()}.`,
      );
      setPhase("error");
      return;
    }

    const candidates = allowsMultiple
      ? acceptedFiles
      : acceptedFiles.slice(0, 1);
    const baseFiles = allowsMultiple ? files : [];
    const uniqueFiles = candidates.filter(
      (candidate) =>
        !baseFiles.some(
          (file) =>
            file.name === candidate.name &&
            file.size === candidate.size &&
            file.lastModified === candidate.lastModified,
        ),
    );
    const nextFiles = [...baseFiles, ...uniqueFiles];
    const limitIssue = getFileSelectionLimitIssue(
      nextFiles,
      allowsMultiple ? PDF_SECURITY_LIMITS.maxFiles : 1,
    );

    if (limitIssue) {
      setErrorMessage(
        describePdfSecurityLimitIssue(limitIssue),
      );
      setPhase("error");
      return;
    }

    setFiles(nextFiles);

    setReadyResult(null);
    setErrorMessage(null);
    setProgress(0);
    setPhase("configuring");
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    if (isBusy) return;
    addFiles(Array.from(event.dataTransfer.files));
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isBusy || !event.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  }

  function handleRemoveFile(index: number) {
    if (isBusy) return;
    setFiles((currentFiles) => {
      const nextFiles = currentFiles.filter(
        (_file, fileIndex) => fileIndex !== index,
      );
      if (nextFiles.length === 0) {
        setPhase("idle");
        setReadyResult(null);
        setErrorMessage(null);
      } else if (phase === "ready" || phase === "error") {
        setPhase("configuring");
        setReadyResult(null);
        setErrorMessage(null);
      }
      return nextFiles;
    });
  }

  function handleReorderDrop(
    event: DragEvent<HTMLLIElement>,
    targetIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (draggedFileIndex !== null) {
      moveFile(draggedFileIndex, targetIndex);
    }
    setDraggedFileIndex(null);
  }

  function resetWorkspace() {
    setFiles([]);
    setReadyResult(null);
    setErrorMessage(null);
    setProgress(0);
    setProgressStage("Preparing documents…");
    setPhase("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy || files.length === 0) return;

    const optionLimitIssue = optionFlags.pages
      ? getTextFieldLimitIssue(
          "Page range",
          pageRange,
          PDF_SECURITY_LIMITS.maxPageRangeCharacters,
        )
      : null;
    if (optionLimitIssue) {
      setErrorMessage(
        describePdfSecurityLimitIssue(optionLimitIssue),
      );
      setPhase("error");
      return;
    }

    if (slug === "split-pdf" && pageRange.trim().length === 0) {
      setErrorMessage(
        "Enter at least two page groups, for example 1-3; 4-6.",
      );
      setPhase("error");
      return;
    }

    setPhase("processing");
    setErrorMessage(null);
    setReadyResult(null);
    setProgress(2);
    setProgressStage("Preparing documents…");
    if (isPublicToolSlug(slug)) {
      trackAnalyticsEvent({ event: "tool_start", tool: slug });
    }

    try {
      const { processPdfTool } = await import("../lib/pdf-actions");
      const response = await processPdfTool(
        slug,
        files,
        processingOptions,
        (nextProgress, nextStage) => {
          setProgress(normalizeProgress(nextProgress));
          if (nextStage) {
            setProgressStage(localizeProgressStage(nextStage));
          }
        },
      );

      const result: ReadyResult = {
        blob: response.blob,
        filename: response.filename || fallbackFilename(slug),
        message: response.message,
      };

      if (!(result.blob instanceof Blob)) {
        throw new Error("The result does not contain a downloadable document.");
      }

      setProgress(100);
      setProgressStage("Document ready");
      setReadyResult(result);
      setPhase("ready");
      if (isPublicToolSlug(slug)) {
        trackAnalyticsEvent({ event: "tool_complete", tool: slug });
      }
      triggerBlobDownload(result.blob, result.filename);
    } catch (error) {
      if (isPublicToolSlug(slug)) {
        trackAnalyticsEvent({ event: "tool_error", tool: slug });
      }
      setErrorMessage(localizeProcessingError(error));
      setPhase("error");
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isBusy}
      className="relative isolate w-full overflow-hidden rounded-[2rem] border border-[#d9ded8] bg-[#fbfaf6] text-[#1f2a26] shadow-[0_30px_80px_-58px_rgba(19,69,49,0.75)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-28 -z-10 h-64 w-64 rotate-12 border-l border-[#d7e5dc] bg-[#edf5ef]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-5 top-5 -z-10 h-28 w-28 rotate-45 border border-[#d7e5dc] bg-[#f7f4ec]"
      />

      <header className="border-b border-[#dfe3dc] px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#39725b]">
            Pagelea workspace
          </p>
          <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#e2f3e9] px-3 py-1.5 text-sm font-bold text-[#15573d]">
            <ShieldCheck aria-hidden="true" className="size-4" />
            Local processing
          </span>
        </div>

        <div className="mt-5 max-w-3xl">
          <h2
            id={headingId}
            className="text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] text-[#17211d] sm:text-4xl lg:text-5xl"
          >
            {title}
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#52615a] sm:text-lg">
            Bring your files here. Pagelea processes them directly in your
            browser: no upload and no document left on a server.
          </p>
        </div>
      </header>

      <form onSubmit={handleProcess}>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              className={[
                "relative flex min-h-56 flex-col items-start justify-center overflow-hidden rounded-[1.4rem] border-2 border-dashed p-6 transition-colors sm:min-h-64 sm:p-8",
                isDragActive
                  ? "border-[#07875f] bg-[#e8f6ee]"
                  : "border-[#9ab7a8] bg-[#f5f2e9]",
                isBusy ? "cursor-wait opacity-65" : "",
              ].join(" ")}
            >
              <div
                aria-hidden="true"
                className="absolute -bottom-14 -right-10 size-40 rotate-12 rounded-[2rem] border border-[#dad6ca] bg-[#fbfaf6]"
              />

              <div className="relative">
                <span className="flex size-12 items-center justify-center rounded-full bg-[#dff1e6] text-[#08724f]">
                  <UploadCloud aria-hidden="true" className="size-6" />
                </span>
                <p className="mt-5 text-xl font-bold tracking-[-0.02em] text-[#1d2a24] sm:text-2xl">
                  {isDragActive
                    ? "Drop them here"
                    : files.length > 0 && allowsMultiple
                      ? "Add more files"
                      : "Drop your files here"}
                </p>
                <p
                  id={uploadHintId}
                  className="mt-2 max-w-lg text-sm leading-6 text-[#66736d] sm:text-base"
                >
                  {acceptedFilesLabel}
                  {allowsMultiple ? ", including several at once." : "."}
                </p>

                <input
                  ref={fileInputRef}
                  id={inputId}
                  type="file"
                  accept={accept}
                  multiple={allowsMultiple}
                  disabled={isBusy}
                  aria-describedby={uploadHintId}
                  onChange={handleFileSelection}
                  className="sr-only"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#087a56] px-5 py-2.5 text-base font-bold text-[#f8fff9] shadow-[0_6px_18px_-10px_rgba(6,94,64,0.9)] transition-[background-color,transform] hover:bg-[#056746] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#145c43]"
                >
                  <UploadCloud aria-hidden="true" className="size-5" />
                  Choose {allowsMultiple ? "files" : "a file"}
                </button>
              </div>
            </div>

            <p className="sr-only" aria-live="polite">
              {files.length === 0
                ? "No files selected"
                : `Selected files: ${files.length}`}
            </p>

            {files.length > 0 ? (
              <div className="mt-8">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.17em] text-[#5d7167]">
                      Documents
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-[#17211d]">
                      {files.length} {files.length === 1 ? "file" : "files"} ready
                    </h3>
                  </div>
                  {allowsMultiple && files.length > 1 ? (
                    <p className="text-sm text-[#69766f]">
                      Drag or use the arrows to reorder.
                    </p>
                  ) : null}
                </div>

                <ol className="mt-4 space-y-2" aria-label="Selected files">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${file.lastModified}-${file.size}-${index}`}
                      draggable={
                        !isBusy && allowsMultiple && files.length > 1
                      }
                      onDragStart={(event) => {
                        setDraggedFileIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggedFileIndex(null)}
                      onDragOver={(event) => {
                        if (draggedFileIndex !== null) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => handleReorderDrop(event, index)}
                      className={[
                        "group flex min-w-0 items-center gap-3 rounded-xl border bg-[#fffefb] p-2.5 transition-[border-color,transform,opacity] sm:p-3",
                        draggedFileIndex === index
                          ? "border-[#7ca690] opacity-50"
                          : "border-[#e1e2dc]",
                      ].join(" ")}
                    >
                      {allowsMultiple && files.length > 1 ? (
                        <GripVertical
                          aria-hidden="true"
                          className="hidden size-5 shrink-0 text-[#8d9992] sm:block"
                        />
                      ) : null}
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf4ed] text-[#267056]">
                        <FileText aria-hidden="true" className="size-5" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-[#24312b] sm:text-base">
                          {file.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#748078]">
                          {formatFileSize(file.size)}
                        </span>
                      </span>

                      {allowsMultiple && files.length > 1 ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={isBusy || index === 0}
                            onClick={() => moveFile(index, index - 1)}
                            aria-label={`Move ${file.name} up`}
                            className="inline-flex size-11 items-center justify-center rounded-lg text-[#52645b] transition-colors hover:bg-[#edf3ee] hover:text-[#1f5c45] disabled:cursor-not-allowed disabled:opacity-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c43]"
                          >
                            <ArrowUp aria-hidden="true" className="size-5" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || index === files.length - 1}
                            onClick={() => moveFile(index, index + 1)}
                            aria-label={`Move ${file.name} down`}
                            className="inline-flex size-11 items-center justify-center rounded-lg text-[#52645b] transition-colors hover:bg-[#edf3ee] hover:text-[#1f5c45] disabled:cursor-not-allowed disabled:opacity-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c43]"
                          >
                            <ArrowDown aria-hidden="true" className="size-5" />
                          </button>
                        </span>
                      ) : null}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRemoveFile(index)}
                        aria-label={`Remove ${file.name} from the list`}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[#7b6159] transition-colors hover:bg-[#faece7] hover:text-[#a13926] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b3928]"
                      >
                        <Trash2 aria-hidden="true" className="size-5" />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>

          <aside className="border-t border-[#dfe3dc] bg-[#f1eee5] px-5 py-6 sm:px-8 sm:py-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-10">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-[#fffefb] text-[#36745b]">
                <SlidersHorizontal aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#65756d]">
                  Step 2
                </p>
                <h3 className="text-lg font-bold text-[#1c2822]">
                  Settings
                </h3>
              </div>
            </div>

            {files.length === 0 ? (
              <div className="mt-7 border-l-2 border-[#a4b8ac] pl-4">
                <p className="font-bold text-[#33443c]">Choose files first.</p>
                <p className="mt-1 text-sm leading-6 text-[#66736d]">
                  Once a file is selected, Pagelea shows only the settings this
                  tool can actually apply.
                </p>
              </div>
            ) : (
              <fieldset
                disabled={isBusy}
                className="mt-7 space-y-6 disabled:opacity-65"
              >
                <legend className="sr-only">
                  Settings for {title}
                </legend>

                {!hasOptions ? (
                  <div className="border-l-2 border-[#84aa96] pl-4">
                    <p className="font-bold text-[#2b4036]">Ready as shown.</p>
                    <p className="mt-1 text-sm leading-6 text-[#65736c]">
                      This tool needs no additional settings. Files stay in the
                      order shown on the left.
                    </p>
                  </div>
                ) : null}

                {optionFlags.pages ? (
                  <div>
                    <label
                      htmlFor={`${inputId}-pages`}
                      className="block text-sm font-bold text-[#27372f]"
                    >
                      Pages
                    </label>
                    <input
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      id={`${inputId}-pages`}
                      maxLength={
                        PDF_SECURITY_LIMITS.maxPageRangeCharacters
                      }
                      value={pageRange}
                      onChange={(event) =>
                        setPageRange(
                          event.target.value.slice(
                            0,
                            PDF_SECURITY_LIMITS.maxPageRangeCharacters,
                          ),
                        )
                      }
                      placeholder="Example: 1-3; 4-6; 7-10"
                      aria-invalid={
                        phase === "error" &&
                        pageRange.trim() === ""
                      }
                      className="mt-2 min-h-11 w-full rounded-lg border border-[#cdd3cc] bg-[#fffefb] px-3 py-2.5 text-base text-[#1f2a26] placeholder:text-[#8d9791] aria-[invalid=true]:border-[#a6402d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c43]"
                      spellCheck={false}
                    />
                    <p className="mt-1.5 text-xs leading-5 text-[#6c7872]">
                      Use commas inside one output and semicolons between
                      outputs: 1-3, 7; 4-6; 8-10.
                    </p>
                  </div>
                ) : null}

                {optionFlags.imageLayout ? (
                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor={`${inputId}-page-size`}
                        className="block text-sm font-bold text-[#27372f]"
                      >
                        Page size
                      </label>
                      <select
                        id={`${inputId}-page-size`}
                        value={imagePageSize}
                        onChange={(event) =>
                          setImagePageSize(
                            event.target.value as "fit" | "a4" | "letter",
                          )
                        }
                        className="mt-2 min-h-11 w-full rounded-lg border border-[#cdd3cc] bg-[#fffefb] px-3 py-2.5 text-base text-[#1f2a26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c43]"
                      >
                        <option value="fit">Fit each image</option>
                        <option value="a4">A4</option>
                        <option value="letter">US Letter</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor={`${inputId}-orientation`}
                        className="block text-sm font-bold text-[#27372f]"
                      >
                        Orientation
                      </label>
                      <select
                        id={`${inputId}-orientation`}
                        value={imageOrientation}
                        onChange={(event) =>
                          setImageOrientation(
                            event.target.value as
                              | "auto"
                              | "portrait"
                              | "landscape",
                          )
                        }
                        className="mt-2 min-h-11 w-full rounded-lg border border-[#cdd3cc] bg-[#fffefb] px-3 py-2.5 text-base text-[#1f2a26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c43]"
                      >
                        <option value="auto">Match each image</option>
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor={`${inputId}-margin`}
                        className="block text-sm font-bold text-[#27372f]"
                      >
                        Page margin
                      </label>
                      <select
                        id={`${inputId}-margin`}
                        value={imageMargin}
                        onChange={(event) =>
                          setImageMargin(Number(event.target.value))
                        }
                        className="mt-2 min-h-11 w-full rounded-lg border border-[#cdd3cc] bg-[#fffefb] px-3 py-2.5 text-base text-[#1f2a26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c43]"
                      >
                        <option value={0}>None</option>
                        <option value={18}>Small</option>
                        <option value={36}>Large</option>
                      </select>
                    </div>
                  </div>
                ) : null}

                {optionFlags.optimize ? (
                  <div className="space-y-4">
                    <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[#cdd3cc] bg-[#fffefb] p-3 text-sm text-[#27372f]">
                      <input
                        checked={removeMetadata}
                        onChange={(event) =>
                          setRemoveMetadata(event.target.checked)
                        }
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[#087a56]"
                      />
                      <span>
                        <strong className="block">Remove document metadata</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#6c7872]">
                          Removes title, author, dates, XMP, and custom metadata
                          carriers.
                        </span>
                      </span>
                    </label>
                    <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[#cdd3cc] bg-[#fffefb] p-3 text-sm text-[#27372f]">
                      <input
                        checked={aggressiveOptimization}
                        onChange={(event) =>
                          setAggressiveOptimization(event.target.checked)
                        }
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[#087a56]"
                      />
                      <span>
                        <strong className="block">Rebuild page objects</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#6c7872]">
                          Stronger cleanup. Non-page structures such as
                          bookmarks may not be preserved.
                        </span>
                      </span>
                    </label>
                  </div>
                ) : null}

              </fieldset>
            )}

            {files.length > 0 ? (
              <div className="mt-8 border-t border-[#d4d1c8] pt-6">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#087a56] px-5 py-3 text-base font-bold text-[#f8fff9] shadow-[0_8px_20px_-12px_rgba(6,94,64,0.9)] transition-[background-color,transform] hover:bg-[#056746] active:translate-y-px disabled:cursor-wait disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#145c43]"
                >
                  {isBusy ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-5 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <Sparkles aria-hidden="true" className="size-5" />
                  )}
                  {isBusy ? "Processing…" : "Process with Pagelea"}
                </button>
                <p className="mt-3 text-center text-xs leading-5 text-[#6d7973]">
                  Processing stays on this device. You can close the page after
                  downloading the result.
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <div
          id={statusId}
          aria-live="polite"
          aria-atomic="true"
          className="border-t border-[#dfe3dc]"
        >
          {phase === "processing" ? (
            <div className="bg-[#e9f4ed] px-5 py-6 sm:px-8 lg:px-10">
              <div className="flex items-start gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#d4eadc] text-[#176543]">
                  <Loader2
                    aria-hidden="true"
                    className="size-5 animate-spin motion-reduce:animate-none"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-bold text-[#1e3c2f]">
                      Pagelea is processing the document.
                    </p>
                    <span className="text-sm font-bold text-[#2f6c52]">
                      {progress}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[#547064]">
                    {progressStage}
                  </p>
                  <progress
                    value={progress}
                    max={100}
                    aria-label={`Processing progress: ${progress}%`}
                    className="mt-4 h-2 w-full overflow-hidden rounded-full accent-[#087a56]"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {phase === "ready" && readyResult ? (
            <div className="bg-[#e5f4e9] px-5 py-6 sm:px-8 lg:px-10">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#cde9d7] text-[#0e6844]">
                    <CheckCircle2 aria-hidden="true" className="size-6" />
                  </span>
                  <div>
                    <p className="font-bold text-[#183e2d]">
                      Done. Your download has started.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[#527061]">
                      Download it again or start a new task.
                    </p>
                    {readyResult.message ? (
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3f6151]">
                        {readyResult.message}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() =>
                      triggerBlobDownload(
                        readyResult.blob,
                        readyResult.filename,
                      )
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#087a56] px-4 py-2.5 text-sm font-bold text-[#f8fff9] hover:bg-[#056746] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#145c43]"
                  >
                    <Download aria-hidden="true" className="size-4" />
                    Download again
                  </button>
                  <button
                    type="button"
                    onClick={resetWorkspace}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#9cb4a6] bg-[#f8fcf9] px-4 py-2.5 text-sm font-bold text-[#275841] hover:bg-[#edf5f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#145c43]"
                  >
                    <RotateCcw aria-hidden="true" className="size-4" />
                    New task
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {phase === "error" && errorMessage ? (
            <div role="alert" className="bg-[#faece7] px-5 py-6 sm:px-8 lg:px-10">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f4d7cd] text-[#9b3928]">
                    <AlertCircle aria-hidden="true" className="size-6" />
                  </span>
                  <div>
                    <p className="font-bold text-[#6f2e22]">
                      Pagelea could not complete this task.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[#794d44]">
                      {errorMessage}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setPhase(files.length > 0 ? "configuring" : "idle");
                  }}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[#c9988c] bg-[#fff8f5] px-4 py-2.5 text-sm font-bold text-[#7b3426] hover:bg-[#fffdfb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#9b3928]"
                >
                  Back to settings
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </form>

      <footer className="flex flex-col gap-2 border-t border-[#dfe3dc] bg-[#fffefb] px-5 py-4 text-sm text-[#64716a] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
        <span className="inline-flex items-center gap-2 font-bold text-[#3f6352]">
          <ShieldCheck aria-hidden="true" className="size-4" />
          No file leaves this browser
        </span>
        <span>Reloading the page clears the workspace.</span>
      </footer>
    </section>
  );
}

export default ToolWorkspace;
