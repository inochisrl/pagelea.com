import type { WorkerEnv } from "./runtime-types";

const AUTHENTICATED_EMAIL_HEADER = "oai-authenticated-user-email";

export function authenticatedAdminEmail(request: Request): string | null {
  const value = request.headers
    .get(AUTHENTICATED_EMAIL_HEADER)
    ?.trim()
    .toLowerCase();
  const containsUnsafeCharacter =
    value !== undefined &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 32 || codePoint === 127;
    });

  if (
    !value ||
    value.length > 254 ||
    containsUnsafeCharacter ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(value)
  ) {
    return null;
  }

  return value;
}

export function isAnalyticsAdmin(
  email: string,
  env: WorkerEnv,
): boolean {
  const allowlist = (env.PAGELEA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.toLowerCase());
}
