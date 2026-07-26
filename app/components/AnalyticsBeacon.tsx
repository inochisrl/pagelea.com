"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isPublicToolSlug } from "../../shared/public-tools";
import { trackAnalyticsEvent } from "../lib/analytics-client";

export function AnalyticsBeacon() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;

    trackAnalyticsEvent({ event: "page_view", path: pathname });

    const toolMatch = /^\/tools\/([a-z0-9-]+)$/.exec(pathname);
    const tool = toolMatch?.[1];
    if (isPublicToolSlug(tool)) {
      trackAnalyticsEvent({ event: "tool_open", tool });
    }
  }, [pathname]);

  return null;
}
