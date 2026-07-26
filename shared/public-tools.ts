export const PUBLIC_TOOL_SLUGS = [
  "pdf-editor",
  "sign-pdf",
  "merge-pdf",
  "organize-pdf",
  "split-pdf",
  "compress-pdf",
  "jpg-to-pdf",
  "flatten-pdf",
] as const;

export type PublicToolSlug = (typeof PUBLIC_TOOL_SLUGS)[number];

export function isPublicToolSlug(value: unknown): value is PublicToolSlug {
  return (
    typeof value === "string" &&
    (PUBLIC_TOOL_SLUGS as readonly string[]).includes(value)
  );
}
