/** Cloudflare Worker entry point for Pagelea. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleApiRequest } from "./api";
import type { WorkerEnv } from "./runtime-types";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const PAGE_ALLOWED_METHODS = "GET, HEAD, OPTIONS";
const API_OPTIONS = new Map([
  ["/api/admin/analytics", "GET, OPTIONS"],
  ["/api/analytics/event", "POST, OPTIONS"],
]);
const IMAGE_CONTENT_SECURITY_POLICY =
  "script-src 'none'; frame-src 'none'; sandbox;";
const NON_EXECUTABLE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; sandbox;";

const STATIC_SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function createRequestNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function createContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

function withSecurityHeaders(
  response: Response,
  contentSecurityPolicy?: string,
  stripBody = false,
): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  if (contentSecurityPolicy) {
    headers.set("Content-Security-Policy", contentSecurityPolicy);
  }

  return new Response(stripBody ? null : response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isApiRequest =
      url.pathname === "/api" || url.pathname.startsWith("/api/");

    if (url.protocol === "http:" && url.hostname === "pagelea.com") {
      const destination = new URL("https://pagelea.com");
      // Assign path/query as URL components so a path beginning with `//`
      // cannot be reinterpreted as a protocol-relative external host.
      destination.pathname = url.pathname;
      destination.search = url.search;
      return withSecurityHeaders(
        Response.redirect(destination, 308),
        NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
      );
    }

    if (request.method === "OPTIONS") {
      if (isApiRequest) {
        const allow = API_OPTIONS.get(url.pathname);
        if (!allow) {
          return withSecurityHeaders(
            new Response(
              JSON.stringify({
                error: {
                  code: "not_found",
                  message: "The API endpoint does not exist.",
                },
              }),
              {
                headers: {
                  "Cache-Control": "no-store",
                  "Content-Type": "application/json; charset=utf-8",
                },
                status: 404,
              },
            ),
            NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
          );
        }
        return withSecurityHeaders(
          new Response(null, {
            headers: { Allow: allow },
            status: 204,
          }),
          NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
        );
      }
      return withSecurityHeaders(
        new Response(null, {
          headers: { Allow: PAGE_ALLOWED_METHODS },
          status: 204,
        }),
        NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
      );
    }

    if (isApiRequest) {
      const apiResult = await handleApiRequest(request, env);
      if (!apiResult.handled || !apiResult.response) {
        return withSecurityHeaders(
          new Response(
            JSON.stringify({
              error: {
                code: "not_found",
                message: "The API endpoint does not exist.",
              },
            }),
            {
              headers: {
                "Cache-Control": "no-store",
                "Content-Type": "application/json; charset=utf-8",
              },
              status: 404,
            },
          ),
          NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
          request.method === "HEAD",
        );
      }
      return withSecurityHeaders(
        apiResult.response,
        NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
        request.method === "HEAD",
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurityHeaders(
        new Response("Method Not Allowed", {
          headers: {
            Allow: PAGE_ALLOWED_METHODS,
            "Content-Type": "text/plain; charset=utf-8",
          },
          status: 405,
        }),
        NON_EXECUTABLE_CONTENT_SECURITY_POLICY,
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      // Preserve the optimizer's stricter CSP and also protect its error
      // responses, which do not always include that policy themselves.
      const imageContentSecurityPolicy =
        response.headers.get("Content-Security-Policy") ??
        IMAGE_CONTENT_SECURITY_POLICY;
      return withSecurityHeaders(
        response,
        imageContentSecurityPolicy,
        request.method === "HEAD",
      );
    }

    // Vinext reads a nonce from the request CSP and applies it to its inline
    // RSC bootstrap scripts. Forward the same per-request policy on the
    // response so script-src can be enforced without unsafe-inline/eval.
    const nonce = createRequestNonce();
    const contentSecurityPolicy = createContentSecurityPolicy(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
    const securedRequest = new Request(request, { headers: requestHeaders });
    const response = await handler.fetch(securedRequest, env, ctx);

    return withSecurityHeaders(
      response,
      contentSecurityPolicy,
      request.method === "HEAD",
    );
  },
};

export default worker;
