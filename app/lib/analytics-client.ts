"use client";

import type { PublicToolSlug } from "../../shared/public-tools";

export type ClientAnalyticsEvent =
  | { event: "page_view"; path: string }
  | {
      event: "tool_complete" | "tool_error" | "tool_open" | "tool_start";
      tool: PublicToolSlug;
    };

type PrivacyAwareNavigator = Navigator & {
  globalPrivacyControl?: boolean;
};

// Privacy kill switch. Source and Worker storage must both be enabled before
// browsers can transmit anonymous aggregate events.
export const ANONYMOUS_BROWSER_ANALYTICS_ENABLED = false;

function analyticsOptedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const privacyNavigator = navigator as PrivacyAwareNavigator;
  return (
    privacyNavigator.globalPrivacyControl === true ||
    privacyNavigator.doNotTrack === "1"
  );
}

export function trackAnalyticsEvent(input: ClientAnalyticsEvent): void {
  if (!ANONYMOUS_BROWSER_ANALYTICS_ENABLED) return;
  if (analyticsOptedOut()) return;

  const payload = JSON.stringify(input);
  if (payload.length > 512) return;

  void fetch("/api/analytics/event", {
    body: payload,
    cache: "no-store",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
    referrerPolicy: "no-referrer",
  }).catch(() => {
    // Product analytics must never interrupt document work.
  });
}
