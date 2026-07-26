export const ANALYTICS_EVENTS = [
  "page_view",
  "tool_open",
  "tool_start",
  "tool_complete",
  "tool_error",
] as const;

export const MAX_ANALYTICS_DAYS = 90;

// There are fewer than 60 allowlisted aggregate dimensions per day. This
// ceiling therefore covers a complete 90-day response while remaining bounded.
export const MAX_ANALYTICS_SUMMARY_ROWS = 6_000;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsSummaryRow = {
  day: string;
  dimension_key: string;
  dimension_value: string;
  event_count: number;
  event_name: AnalyticsEventName;
};

export type AnalyticsSummaryResponse = {
  days: number;
  rows: AnalyticsSummaryRow[];
};

const ANALYTICS_DIMENSION_KEYS = [
  "none",
  "path",
  "tool",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return (
    typeof value === "string" &&
    (ANALYTICS_EVENTS as readonly string[]).includes(value)
  );
}

function isAnalyticsDimensionKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (ANALYTICS_DIMENSION_KEYS as readonly string[]).includes(value)
  );
}

export function parseAnalyticsSummaryResponse(
  value: unknown,
): AnalyticsSummaryResponse | null {
  if (
    !isRecord(value) ||
    typeof value.days !== "number" ||
    !Number.isSafeInteger(value.days) ||
    value.days < 1 ||
    value.days > MAX_ANALYTICS_DAYS ||
    !Array.isArray(value.rows) ||
    value.rows.length > MAX_ANALYTICS_SUMMARY_ROWS
  ) {
    return null;
  }

  const rows: AnalyticsSummaryRow[] = [];
  for (const candidate of value.rows) {
    if (
      !isRecord(candidate) ||
      typeof candidate.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.day) ||
      !isAnalyticsEventName(candidate.event_name) ||
      !isAnalyticsDimensionKey(candidate.dimension_key) ||
      typeof candidate.dimension_value !== "string" ||
      candidate.dimension_value.length > 120 ||
      typeof candidate.event_count !== "number" ||
      !Number.isSafeInteger(candidate.event_count) ||
      candidate.event_count < 0
    ) {
      return null;
    }
    rows.push({
      day: candidate.day,
      dimension_key: candidate.dimension_key,
      dimension_value: candidate.dimension_value,
      event_count: candidate.event_count,
      event_name: candidate.event_name,
    });
  }

  return { days: value.days, rows };
}
