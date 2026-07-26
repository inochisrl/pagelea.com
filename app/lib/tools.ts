import {
  PUBLIC_TOOL_SLUGS,
  type PublicToolSlug,
} from "../../shared/public-tools";

const PAGELEA_BRAND = "Pagelea" as const;

export type ToolCategory =
  | "Merge"
  | "Split"
  | "Edit & Sign"
  | "Optimize"
  | "Security"
  | "Convert to PDF";

export type ToolIconKey =
  | "compress"
  | "edit"
  | "flatten"
  | "image-add"
  | "merge"
  | "organize"
  | "signature"
  | "split";

type AcceptedInput =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export type Tool = {
  readonly brand: typeof PAGELEA_BRAND;
  readonly slug: PublicToolSlug;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly guideTitle: string;
  readonly category: ToolCategory;
  readonly icon: ToolIconKey;
  readonly accent: string;
  readonly acceptedInputs: readonly AcceptedInput[];
  readonly multiple: boolean;
  readonly howTo: readonly string[];
};

export const TOOLS = [
  {
    brand: PAGELEA_BRAND,
    slug: "pdf-editor",
    title: "PDF Editor",
    subtitle: "Click existing PDF text, rewrite it, and keep working.",
    description:
      "Detect and replace existing text, then add images, shapes, highlights, signatures, freehand marks, and whiteout in your browser.",
    guideTitle: "How to edit a PDF",
    category: "Edit & Sign",
    icon: "edit",
    accent: "#0282E5",
    acceptedInputs: ["application/pdf"],
    multiple: false,
    howTo: [
      "Open a PDF in the Pagelea editor.",
      "Choose Edit text and select an outlined text block.",
      "Rewrite it inline, then adjust its font, size, color, or position.",
      "Export and review the revised PDF.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "sign-pdf",
    title: "Sign PDF",
    subtitle: "Place a drawn, typed, or uploaded signature.",
    description:
      "Add text, initials, images, and signatures exactly where they belong without uploading the document.",
    guideTitle: "How to sign a PDF",
    category: "Edit & Sign",
    icon: "signature",
    accent: "#0282E5",
    acceptedInputs: ["application/pdf"],
    multiple: false,
    howTo: [
      "Open the form or document.",
      "Add any names, dates, or initials with the text tool.",
      "Draw, type, or upload a signature and position it on the page.",
      "Export and review the signed PDF.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "merge-pdf",
    title: "Merge PDF",
    subtitle: "Combine PDFs, JPGs, and PNGs in the order you choose.",
    description:
      "Reorder whole PDFs and images, then create one continuous document without uploading the source files.",
    guideTitle: "How to merge PDFs",
    category: "Merge",
    icon: "merge",
    accent: "#2DC36A",
    acceptedInputs: [
      "application/pdf",
      "image/jpeg",
      "image/png",
    ],
    multiple: true,
    howTo: [
      "Add two or more PDFs, JPGs, or PNGs.",
      "Drag the files, or use the arrow controls, to set their order.",
      "Start the merge and wait while Pagelea builds the document locally.",
      "Download and review the finished PDF.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "organize-pdf",
    title: "Organize PDF",
    subtitle: "Reorder, rotate, remove, or add blank pages.",
    description:
      "Use page thumbnails to restructure one PDF while preserving its original page content.",
    guideTitle: "How to organize a PDF",
    category: "Merge",
    icon: "organize",
    accent: "#2DC36A",
    acceptedInputs: ["application/pdf"],
    multiple: false,
    howTo: [
      "Open the PDF you want to reorganize.",
      "Select a page thumbnail and move it up or down.",
      "Rotate or delete pages, and add blank pages when needed.",
      "Export and review the reorganized PDF.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "split-pdf",
    title: "Split PDF by Pages",
    subtitle: "Create several PDFs from exact page groups.",
    description:
      "Describe each output group and Pagelea packages the resulting PDFs in one ZIP archive.",
    guideTitle: "How to split a PDF by pages",
    category: "Split",
    icon: "split",
    accent: "#83B31F",
    acceptedInputs: ["application/pdf"],
    multiple: false,
    howTo: [
      "Open the PDF to split.",
      "Enter one output group at a time, separating groups with semicolons.",
      "Use commas to combine non-consecutive pages inside one output.",
      "Download the ZIP archive containing every resulting PDF.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "compress-pdf",
    title: "Optimize PDF",
    subtitle: "Clean and repack a PDF without image recompression.",
    description:
      "Remove optional metadata, rebuild page objects, and write compact object streams while keeping the original when it is already smaller.",
    guideTitle: "How to optimize a PDF",
    category: "Optimize",
    icon: "compress",
    accent: "#29AAD2",
    acceptedInputs: ["application/pdf"],
    multiple: false,
    howTo: [
      "Open one PDF.",
      "Choose whether to remove metadata or rebuild page objects.",
      "Let Pagelea optimize the document structure locally.",
      "Download the result and review the reported size change.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "jpg-to-pdf",
    title: "Images to PDF",
    subtitle: "Turn ordered JPG and PNG images into one PDF.",
    description:
      "Choose page size, orientation, and margins, then build a PDF locally from your images.",
    guideTitle: "How to convert images to PDF",
    category: "Convert to PDF",
    icon: "image-add",
    accent: "#6B0BFF",
    acceptedInputs: ["image/jpeg", "image/png"],
    multiple: true,
    howTo: [
      "Add the JPG or PNG images you want in the PDF.",
      "Drag them into the intended page order.",
      "Choose page size, orientation, and margins.",
      "Create, download, and review the image PDF.",
    ],
  },
  {
    brand: PAGELEA_BRAND,
    slug: "flatten-pdf",
    title: "Sanitize & Flatten PDF",
    subtitle: "Flatten form fields and remove active PDF content.",
    description:
      "Flatten visible form values, remove annotations, actions, scripts, attachments, and metadata, then rebuild the pages in a fresh PDF.",
    guideTitle: "How to sanitize and flatten a PDF",
    category: "Security",
    icon: "flatten",
    accent: "#29AAD2",
    acceptedInputs: ["application/pdf"],
    multiple: false,
    howTo: [
      "Open the PDF you want to sanitize.",
      "Pagelea validates and flattens supported form fields locally.",
      "Active annotations, scripts, actions, attachments, and metadata are removed.",
      "Download the sanitized copy and verify its appearance.",
    ],
  },
] as const satisfies readonly Tool[];

const TOOLS_BY_SLUG = new Map<PublicToolSlug, Tool>(
  TOOLS.map((tool) => [tool.slug, tool]),
);

export function getTool(slug: string): Tool | undefined {
  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^tools\//, "");

  return (PUBLIC_TOOL_SLUGS as readonly string[]).includes(normalized)
    ? TOOLS_BY_SLUG.get(normalized as PublicToolSlug)
    : undefined;
}
