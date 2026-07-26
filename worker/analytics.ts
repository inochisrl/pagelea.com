import { isPublicToolSlug } from "../shared/public-tools";
import {
  ANALYTICS_EVENTS,
  MAX_ANALYTICS_DAYS,
  MAX_ANALYTICS_SUMMARY_ROWS,
  type AnalyticsEventName,
  type AnalyticsSummaryRow,
} from "../shared/analytics";
import type { D1Database } from "./runtime-types";

export { ANALYTICS_EVENTS };

export type AnalyticsEventInput = {
  event: AnalyticsEventName;
  path?: string;
  tool?: string;
};

type AnalyticsDimension = {
  key: "none" | "path" | "tool";
  value: string;
};

function isClientAnalyticsEventName(
  value: unknown,
): value is (typeof ANALYTICS_EVENTS)[number] {
  return (
    typeof value === "string" &&
    (ANALYTICS_EVENTS as readonly string[]).includes(value)
  );
}

export function hasAnalyticsOptOut(
  request: Pick<Request, "headers">,
): boolean {
  return (
    request.headers.get("Sec-GPC") === "1" ||
    request.headers.get("DNT") === "1"
  );
}

function normalizePath(value: unknown): string {
  if (typeof value !== "string") return "/other";
  if (value === "/") return "/";
  if (
    value === "/pricing" ||
    value === "/about" ||
    value === "/cookies" ||
    value === "/help" ||
    value === "/privacy" ||
    value === "/security" ||
    value === "/terms"
  ) {
    return value;
  }
  const match = /^\/tools\/([a-z0-9-]+)$/.exec(value);
  return match && isPublicToolSlug(match[1])
    ? `/tools/${match[1]}`
    : "/other";
}

function dimensionForEvent(input: AnalyticsEventInput): AnalyticsDimension {
  if (
    (input.event === "tool_open" ||
      input.event === "tool_start" ||
      input.event === "tool_complete" ||
      input.event === "tool_error") &&
    isPublicToolSlug(input.tool)
  ) {
    return { key: "tool", value: input.tool };
  }
  if (input.event === "page_view") {
    return { key: "path", value: normalizePath(input.path) };
  }
  return { key: "none", value: "all" };
}

export function parseAnalyticsEvent(value: unknown): AnalyticsEventInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!isClientAnalyticsEventName(record.event)) return null;

  if (
    record.event === "page_view" &&
    keys.length === 2 &&
    keys.includes("path") &&
    typeof record.path === "string"
  ) {
    return { event: record.event, path: record.path };
  }

  if (
    (record.event === "tool_open" ||
      record.event === "tool_start" ||
      record.event === "tool_complete" ||
      record.event === "tool_error") &&
    keys.length === 2 &&
    keys.includes("tool") &&
    isPublicToolSlug(record.tool)
  ) {
    return { event: record.event, tool: record.tool };
  }

  return null;
}

export async function incrementAnalytics(
  db: D1Database,
  input: AnalyticsEventInput,
  timestampSeconds = Math.floor(Date.now() / 1_000),
): Promise<void> {
  const dimension = dimensionForEvent(input);
  const day = new Date(timestampSeconds * 1_000).toISOString().slice(0, 10);
  const retentionThreshold = new Date(Date.now() - 89 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await db.batch([
    db
      .prepare(
      `INSERT INTO analytics_daily
        (day, event_name, dimension_key, dimension_value, event_count, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(day, event_name, dimension_key, dimension_value)
       DO UPDATE SET
         event_count = event_count + 1,
         updated_at = excluded.updated_at`,
      )
      .bind(
        day,
        input.event,
        dimension.key,
        dimension.value,
        timestampSeconds,
      ),
    db
      .prepare("DELETE FROM analytics_daily WHERE day < ?")
      .bind(retentionThreshold),
  ]);
}

export async function safelyIncrementAnalytics(
  db: D1Database,
  input: AnalyticsEventInput,
  timestampSeconds = Math.floor(Date.now() / 1_000),
): Promise<void> {
  try {
    await incrementAnalytics(db, input, timestampSeconds);
  } catch {
    // Aggregate product metrics must never interrupt local document work.
  }
}

export async function getAnalyticsSummary(
  db: D1Database,
  days = 30,
): Promise<AnalyticsSummaryRow[]> {
  const finiteDays = Number.isFinite(days) ? Math.floor(days) : 30;
  const boundedDays = Math.min(
    MAX_ANALYTICS_DAYS,
    Math.max(1, finiteDays),
  );
  const threshold = new Date(Date.now() - (boundedDays - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const result = await db
    .prepare(
      `SELECT day, event_name, dimension_key, dimension_value, event_count
       FROM analytics_daily
       WHERE day >= ?
         AND event_name IN (
           'page_view',
           'tool_open',
           'tool_start',
           'tool_complete',
           'tool_error'
         )
         AND dimension_key IN ('none', 'path', 'tool')
       ORDER BY day ASC, event_name ASC, dimension_value ASC
       LIMIT ${MAX_ANALYTICS_SUMMARY_ROWS}`,
    )
    .bind(threshold)
    .all<AnalyticsSummaryRow>();
  return result.results ?? [];
}
