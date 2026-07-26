import { headers } from "next/headers";
import { redirect } from "next/navigation";

const AUTHENTICATED_EMAIL_HEADER = "oai-authenticated-user-email";
const ADMIN_ANALYTICS_PATH = "/admin/analytics";
const SIGN_IN_PATH = "/signin-with-chatgpt";

export async function requireAdminIdentity(): Promise<void> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(AUTHENTICATED_EMAIL_HEADER)?.trim();
  if (email) return;

  redirect(
    `${SIGN_IN_PATH}?return_to=${encodeURIComponent(ADMIN_ANALYTICS_PATH)}`,
  );
}
