"use client";

import {
  Activity,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ANALYTICS_EVENTS,
  parseAnalyticsSummaryResponse,
  type AnalyticsEventName,
  type AnalyticsSummaryRow,
} from "../../../shared/analytics";
import { PUBLIC_TOOL_SLUGS } from "../../../shared/public-tools";
import { TOOLS } from "../../lib/tools";
import styles from "./analytics.module.css";

type Days = 7 | 30 | 90;

type DashboardState =
  | { kind: "error"; message: string; status: number }
  | { kind: "loading" }
  | { days: number; kind: "ready"; rows: AnalyticsSummaryRow[] };

const TOOL_LABELS = new Map(
  TOOLS.map((tool) => [tool.slug, tool.title] as const),
);
const NUMBER_FORMATTER = new Intl.NumberFormat();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function fetchAnalytics(days: Days): Promise<{
  days: number;
  rows: AnalyticsSummaryRow[];
}> {
  const response = await fetch(`/api/admin/analytics?days=${days}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  if (!response.ok) {
    const message =
      isRecord(value) &&
      isRecord(value.error) &&
      typeof value.error.message === "string"
        ? value.error.message
        : "Product analytics could not be loaded. Please try again.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  const parsed = parseAnalyticsSummaryResponse(value);
  if (!parsed) {
    throw Object.assign(
      new Error(
        "Pagelea returned an unexpected analytics response. Please try again.",
      ),
      { status: 502 },
    );
  }
  return parsed;
}

function total(
  rows: AnalyticsSummaryRow[],
  event: AnalyticsEventName,
): number {
  return rows
    .filter((row) => row.event_name === event)
    .reduce((sum, row) => sum + row.event_count, 0);
}

function ratio(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.min(999, (numerator / denominator) * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function toolLabel(slug: string): string {
  return TOOL_LABELS.get(slug as (typeof TOOLS)[number]["slug"]) ?? slug;
}

export function AnalyticsDashboard() {
  const [days, setDays] = useState<Days>(30);
  const [state, setState] = useState<DashboardState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    void fetchAnalytics(30)
      .then((result) => {
        if (current) setState({ ...result, kind: "ready" });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Product analytics could not be loaded. Please try again.",
          status:
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof error.status === "number"
              ? error.status
              : 500,
        });
      });
    return () => {
      current = false;
    };
  }, []);

  async function selectRange(nextDays: Days) {
    setDays(nextDays);
    setState({ kind: "loading" });
    try {
      setState({
        ...(await fetchAnalytics(nextDays)),
        kind: "ready",
      });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Product analytics could not be loaded. Please try again.",
        status:
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : 500,
      });
    }
  }

  const summary = useMemo(() => {
    if (state.kind !== "ready") return null;
    const rows = state.rows;
    const pageViews = total(rows, "page_view");
    const toolOpen = total(rows, "tool_open");
    const toolStart = total(rows, "tool_start");
    const toolComplete = total(rows, "tool_complete");
    const toolError = total(rows, "tool_error");

    const daily = new Map<
      string,
      Record<AnalyticsEventName, number>
    >();
    for (const row of rows) {
      const values =
        daily.get(row.day) ??
        Object.fromEntries(
          ANALYTICS_EVENTS.map((event) => [event, 0]),
        ) as Record<AnalyticsEventName, number>;
      values[row.event_name] += row.event_count;
      daily.set(row.day, values);
    }

    const tools = PUBLIC_TOOL_SLUGS.map((tool) => {
      const forTool = rows.filter(
        (row) =>
          row.dimension_key === "tool" && row.dimension_value === tool,
      );
      const opened = total(forTool, "tool_open");
      const started = total(forTool, "tool_start");
      const completed = total(forTool, "tool_complete");
      const errors = total(forTool, "tool_error");
      return { completed, errors, opened, started, tool };
    }).sort((left, right) => right.started - left.started);

    return {
      daily: [...daily.entries()].sort(([left], [right]) =>
        right.localeCompare(left),
      ),
      pageViews,
      toolComplete,
      toolError,
      toolOpen,
      tools,
      toolStart,
    };
  }, [state]);

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Private product pulse</p>
          <h1 className="display">Pagelea, in aggregate.</h1>
          <p>
            Daily counts only. No document names, identity fields, IP
            addresses, cookies, user agents or referrers are collected here.
            Anonymous client events are directional product signals, not
            audited financial records.
          </p>
        </div>
        <div className={styles.rangeControl} aria-label="Analytics date range">
          {([7, 30, 90] as const).map((option) => (
            <button
              className={days === option ? styles.activeRange : ""}
              type="button"
              aria-pressed={days === option}
              disabled={state.kind === "loading"}
              key={option}
              onClick={() => void selectRange(option)}
            >
              {option} days
            </button>
          ))}
        </div>
      </header>

      {state.kind === "loading" ? (
        <div className={styles.loadingState} aria-live="polite">
          <LoaderCircle
            className={styles.spinner}
            size={24}
            aria-hidden="true"
          />
          Loading aggregate counts…
        </div>
      ) : null}

      {state.kind === "error" ? (
        <section className={styles.errorState} role="alert">
          <CircleAlert size={28} aria-hidden="true" />
          <div>
            <h2>
              {state.status === 403
                ? "This account is not on the analytics allowlist."
                : "Analytics are unavailable."}
            </h2>
            <p>{state.message}</p>
          </div>
          {state.status !== 403 ? (
            <button type="button" onClick={() => void selectRange(days)}>
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </section>
      ) : null}

      {state.kind === "ready" && summary ? (
        <>
          <section className={styles.metrics} aria-label="Key product metrics">
            <article>
              <span aria-hidden="true">
                <Activity size={21} />
              </span>
              <p>Page views</p>
              <strong>{formatNumber(summary.pageViews)}</strong>
              <small>{formatNumber(summary.toolOpen)} tool opens</small>
            </article>
            <article>
              <span aria-hidden="true">
                <MousePointerClick size={21} />
              </span>
              <p>Tool starts</p>
              <strong>{formatNumber(summary.toolStart)}</strong>
              <small>
                {formatNumber(summary.toolOpen)} opens before processing
              </small>
            </article>
            <article>
              <span aria-hidden="true">
                <CheckCircle2 size={21} />
              </span>
              <p>Tool completion</p>
              <strong>
                {ratio(summary.toolComplete, summary.toolStart)}
              </strong>
              <small>
                {formatNumber(summary.toolComplete)} of{" "}
                {formatNumber(summary.toolStart)} starts
              </small>
            </article>
            <article>
              <span aria-hidden="true">
                <CircleAlert size={21} />
              </span>
              <p>Processing errors</p>
              <strong>
                {ratio(summary.toolError, summary.toolStart)}
              </strong>
              <small>
                {formatNumber(summary.toolError)} aggregate error events
              </small>
            </article>
          </section>

          <section className={styles.tables}>
            <div className={styles.tableSection}>
              <div className={styles.tableHeading}>
                <div>
                  <p className="eyebrow">Tool quality</p>
                  <h2 className="display">Eight production tools.</h2>
                </div>
                <span>
                  <BarChart3 size={17} aria-hidden="true" />
                  {formatNumber(summary.toolError)} reported processing errors
                </span>
              </div>
              <div
                className={styles.tableWrap}
                role="region"
                aria-label="Tool usage table"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Tool</th>
                      <th scope="col">Opened</th>
                      <th scope="col">Started</th>
                      <th scope="col">Completed</th>
                      <th scope="col">Errors</th>
                      <th scope="col">Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.tools.map((tool) => (
                      <tr key={tool.tool}>
                        <th scope="row">{toolLabel(tool.tool)}</th>
                        <td>{formatNumber(tool.opened)}</td>
                        <td>{formatNumber(tool.started)}</td>
                        <td>{formatNumber(tool.completed)}</td>
                        <td>{formatNumber(tool.errors)}</td>
                        <td>{ratio(tool.completed, tool.started)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.tableSection}>
              <div className={styles.tableHeading}>
                <div>
                  <p className="eyebrow">Daily ledger</p>
                  <h2 className="display">The most recent days first.</h2>
                </div>
                <span>Rolling {Math.round(state.days)}-day window</span>
              </div>
              <div
                className={styles.tableWrap}
                role="region"
                aria-label="Daily aggregate analytics table"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Page views</th>
                      <th scope="col">Tool opens</th>
                      <th scope="col">Tool starts</th>
                      <th scope="col">Completions</th>
                      <th scope="col">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.daily.length ? (
                      summary.daily.map(([day, values]) => (
                        <tr key={day}>
                          <th scope="row">{day}</th>
                          <td>{formatNumber(values.page_view)}</td>
                          <td>{formatNumber(values.tool_open)}</td>
                          <td>{formatNumber(values.tool_start)}</td>
                          <td>{formatNumber(values.tool_complete)}</td>
                          <td>{formatNumber(values.tool_error)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className={styles.emptyTable} colSpan={6}>
                          No aggregate events have been recorded in this
                          window.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
