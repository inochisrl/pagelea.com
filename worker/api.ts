import {
  getAnalyticsSummary,
  hasAnalyticsOptOut,
  parseAnalyticsEvent,
  safelyIncrementAnalytics,
} from "./analytics";
import {
  authenticatedAdminEmail,
  isAnalyticsAdmin,
} from "./admin-auth";
import type { WorkerEnv } from "./runtime-types";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_ANALYTICS_BODY_BYTES = 1_024;

export type ApiResult = {
  handled: boolean;
  response?: Response;
};

class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(
  value: unknown,
  status = 200,
  additionalHeaders?: HeadersInit,
): Response {
  const headers = new Headers(additionalHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(value), { status, headers });
}

function apiError(error: ApiError): Response {
  return jsonResponse(
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

function methodNotAllowed(allow: string): Response {
  return jsonResponse(
    {
      error: {
        code: "method_not_allowed",
        message: "This method is not allowed for the requested endpoint.",
      },
    },
    405,
    { Allow: allow },
  );
}

function notFound(): ApiResult {
  return {
    handled: true,
    response: jsonResponse(
      {
        error: {
          code: "not_found",
          message: "The API endpoint does not exist.",
        },
      },
      404,
    ),
  };
}

function isSameOriginBrowserRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  if (origin !== expectedOrigin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function requireSameOrigin(request: Request): void {
  if (!isSameOriginBrowserRequest(request)) {
    throw new ApiError(
      403,
      "origin_rejected",
      "The request origin is not allowed.",
    );
  }
}

function hasJsonContentType(request: Request): boolean {
  return (
    request.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() === "application/json"
  );
}

async function readBoundedText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(
      413,
      "payload_too_large",
      "The request body is too large.",
    );
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        throw new ApiError(
          413,
          "payload_too_large",
          "The request body is too large.",
        );
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "invalid_body",
      "The request body is not valid UTF-8.",
    );
  } finally {
    reader.releaseLock();
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (!hasJsonContentType(request)) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Use application/json for this endpoint.",
    );
  }

  const body = await readBoundedText(request, MAX_ANALYTICS_BODY_BYTES);
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError(
      400,
      "invalid_json",
      "The request body is not valid JSON.",
    );
  }
}

async function analyticsEvent(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  requireSameOrigin(request);
  const input = parseAnalyticsEvent(await readJson(request));
  if (!input) {
    throw new ApiError(
      400,
      "invalid_event",
      "The analytics event is not recognized.",
    );
  }

  // Anonymous analytics is privacy fail-closed: source and Worker switches
  // must both be enabled, and GPC/DNT always suppress storage. Optional
  // measurement can never interrupt local document work.
  if (
    env.PAGELEA_ANONYMOUS_ANALYTICS_ENABLED === "true" &&
    !hasAnalyticsOptOut(request)
  ) {
    try {
      const database = env.DB;
      if (database) await safelyIncrementAnalytics(database, input);
    } catch {
      // Preview runtimes can expose a missing optional binding as a throwing
      // proxy. A storage outage must not change the document workflow.
    }
  }

  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

async function adminAnalytics(
  request: Request,
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");

  const email = authenticatedAdminEmail(request);
  if (!email) {
    throw new ApiError(401, "sign_in_required", "Sign in to continue.");
  }
  if (!isAnalyticsAdmin(email, env)) {
    throw new ApiError(
      403,
      "admin_required",
      "This identity is not allowed to view product analytics.",
    );
  }
  if (!env.DB) {
    throw new ApiError(
      503,
      "analytics_unavailable",
      "The analytics database is unavailable.",
    );
  }

  const requestedDays = Number(url.searchParams.get("days") ?? "30");
  const days = Number.isFinite(requestedDays)
    ? Math.min(90, Math.max(1, Math.floor(requestedDays)))
    : 30;

  return jsonResponse({
    days,
    rows: await getAnalyticsSummary(env.DB, days),
  });
}

export async function handleApiRequest(
  request: Request,
  env: WorkerEnv,
): Promise<ApiResult> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return { handled: false };

  try {
    if (url.pathname === "/api/analytics/event") {
      return {
        handled: true,
        response: await analyticsEvent(request, env),
      };
    }

    if (url.pathname === "/api/admin/analytics") {
      return {
        handled: true,
        response: await adminAnalytics(request, env, url),
      };
    }

    return notFound();
  } catch (error) {
    if (error instanceof ApiError) {
      return { handled: true, response: apiError(error) };
    }
    return {
      handled: true,
      response: jsonResponse(
        {
          error: {
            code: "internal_error",
            message: "The request could not be completed.",
          },
        },
        500,
      ),
    };
  }
}
