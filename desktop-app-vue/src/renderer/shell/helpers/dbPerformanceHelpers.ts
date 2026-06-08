/**
 * Database Performance panel helpers — pure functions extracted for unit
 * testing. Used by `shell/DatabasePerformancePanel.vue`.
 *
 * V5→V6 port of pages/DatabasePerformancePage.vue (window.electronAPI
 * .dbPerformance.* → db-performance:* IPC). All formatting / threshold logic
 * lives here so the panel stays declarative and the math is testable.
 */

export interface CacheStats {
  size?: number;
  maxSize?: number;
  hitRate?: string; // backend sends a pre-formatted string like "85%"
  hits?: number;
  misses?: number;
  evictions?: number;
  [key: string]: unknown;
}

export interface DbStats {
  totalQueries?: number;
  avgQueryTime?: number;
  slowQueries?: number;
  cache?: CacheStats;
  [key: string]: unknown;
}

/**
 * Parse the backend's cache hit-rate string ("85%", "85.5 %", "0%") into a
 * number for threshold coloring. Non-parseable / missing → 0 (never NaN).
 */
export function parseHitRate(
  hitRate: string | number | undefined | null,
): number {
  if (typeof hitRate === "number") {
    return Number.isFinite(hitRate) ? hitRate : 0;
  }
  if (!hitRate) {
    return 0;
  }
  const n = parseFloat(String(hitRate).replace("%", "").trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cache usage as a 0–100 integer percentage of size/maxSize. 0 when maxSize is
 * 0/missing (avoids divide-by-zero → NaN/Infinity render).
 */
export function cacheUsagePercent(
  size: number | undefined,
  maxSize: number | undefined,
): number {
  const s = Number(size) || 0;
  const m = Number(maxSize) || 0;
  if (m <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((s / m) * 100));
}

/** Color a single slow-query duration (ms): green < 50, orange < 200, red ≥ 200. */
export function durationColor(ms: number | undefined | null): string {
  const v = Number(ms) || 0;
  if (v < 50) {
    return "green";
  }
  if (v < 200) {
    return "orange";
  }
  return "red";
}

/** Ant-Design statistic color for an average-query-time threshold (50ms). */
export function avgQueryTimeColor(ms: number | undefined | null): string {
  return (Number(ms) || 0) > 50 ? "#cf1322" : "#3f8600";
}

/** Statistic color for the cache hit-rate (good ≥ 80%). */
export function hitRateColor(
  hitRate: string | number | undefined | null,
): string {
  return parseHitRate(hitRate) > 80 ? "#3f8600" : "#cf1322";
}

/** Statistic color for the slow-query count (any > 0 is bad). */
export function slowQueryCountColor(count: number | undefined | null): string {
  return (Number(count) || 0) > 0 ? "#cf1322" : "#3f8600";
}

/**
 * Truncate a SQL string for inline preview. Empty/undefined → "" so the panel
 * never renders "undefined". Appends "…" only when actually truncated.
 */
export function truncateSql(sql: string | undefined | null, len = 100): string {
  if (!sql) {
    return "";
  }
  if (len <= 0) {
    return "";
  }
  return sql.length > len ? `${sql.substring(0, len)}…` : sql;
}

/**
 * Format an epoch-ms (or ISO) timestamp as a locale time string. Invalid /
 * missing → "—". Accepts a clock injection for deterministic tests.
 */
export function formatTimestamp(
  ts: number | string | undefined | null,
  toDate: (v: number | string) => Date = (v) => new Date(v),
): string {
  if (ts === undefined || ts === null || ts === "") {
    return "—";
  }
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString();
}

/** A short human label for an index suggestion (table.column). */
export function suggestionLabel(s: {
  table?: string;
  column?: string;
}): string {
  const table = s?.table || "?";
  const column = s?.column || "?";
  return `${table}.${column}`;
}
