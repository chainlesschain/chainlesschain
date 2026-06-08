/**
 * LLM Performance panel helpers — pure functions extracted for unit testing.
 * Used by `shell/LLMPerformancePanel.vue`.
 *
 * V5→V6 port of pages/LLMPerformancePage.vue (window.electronAPI.invoke
 * "llm:*"). All money / token / budget formatting + threshold math lives here
 * so the panel stays declarative and the arithmetic is testable.
 *
 * NB: the `llm:get-*` IPC loaders return their payload DIRECTLY (not wrapped in
 * {success,data}); the action channels (clear-cache / export / dismiss) DO use
 * {success,...}. See stores/llmPerformance.ts.
 */

export interface DateRange {
  startDate: number;
  endDate: number;
}

/**
 * Build the {startDate,endDate} epoch-ms window the `llm:*` stats channels
 * expect, for the last `days` days. `now` is injectable for deterministic tests.
 */
export function dateRangeFromDays(days: number, now: number): DateRange {
  const d = Number(days) > 0 ? Number(days) : 7;
  return { startDate: now - d * 24 * 60 * 60 * 1000, endDate: now };
}

/**
 * Budget usage as a 0–100 number (clamped). 0 when the limit is ≤ 0 (avoids
 * divide-by-zero → NaN/Infinity render).
 */
export function budgetPercent(
  spend: number | undefined,
  limit: number | undefined,
): number {
  const s = Number(spend) || 0;
  const l = Number(limit) || 0;
  if (l <= 0) {
    return 0;
  }
  return Math.min(100, (s / l) * 100);
}

/**
 * Color a budget usage percentage against warning/critical thresholds.
 * green < warning, orange < critical, red ≥ critical.
 */
export function budgetColor(
  percent: number,
  warning = 80,
  critical = 95,
): string {
  const p = Number(percent) || 0;
  if (p >= critical) {
    return "#cf1322";
  }
  if (p >= warning) {
    return "#fa8c16";
  }
  return "#3f8600";
}

/** ant-design progress status for a budget bar. */
export function budgetStatus(
  percent: number,
  warning = 80,
  critical = 95,
): "success" | "normal" | "exception" {
  const p = Number(percent) || 0;
  if (p >= critical) {
    return "exception";
  }
  if (p >= warning) {
    return "normal";
  }
  return "success";
}

/** Format a USD amount as "$1.2345" (4dp — LLM costs are small). 0 for bad input. */
export function formatUsd(n: number | undefined | null): string {
  const v = Number(n);
  return `$${(Number.isFinite(v) ? v : 0).toFixed(4)}`;
}

/** Format a CNY amount as "¥1.23" (2dp). */
export function formatCny(n: number | undefined | null): string {
  const v = Number(n);
  return `¥${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
}

/** Compact token count: 1234 → "1.2k", 3_400_000 → "3.4M". */
export function formatTokens(n: number | undefined | null): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) {
    return `${(v / 1_000_000).toFixed(1)}M`;
  }
  if (v >= 1_000) {
    return `${(v / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(v));
}

/**
 * Normalize a hit-rate value to a 0–100 percentage. The backend may send a
 * fraction (0.85) or an already-scaled percent (85); ≤ 1 is treated as a
 * fraction. Returns a number rounded to 1dp.
 */
export function asPercent(rate: number | undefined | null): number {
  const v = Number(rate) || 0;
  const scaled = v > 0 && v <= 1 ? v * 100 : v;
  return Math.round(scaled * 10) / 10;
}

/** Color for a cache hit-rate percent (good ≥ 50%, ok ≥ 30%). */
export function hitRateColor(rate: number | undefined | null): string {
  const p = asPercent(rate);
  if (p >= 50) {
    return "#3f8600";
  }
  if (p >= 30) {
    return "#fa8c16";
  }
  return "#cf1322";
}

/** Color for an alert severity / level string. */
export function alertLevelColor(level: string | undefined | null): string {
  switch (String(level || "").toLowerCase()) {
    case "critical":
    case "error":
      return "red";
    case "warning":
    case "warn":
      return "orange";
    case "info":
      return "blue";
    default:
      return "default";
  }
}

/** A display label for a cost-breakdown row (provider/model name fallback). */
export function breakdownLabel(row: {
  name?: string;
  provider?: string;
  model?: string;
}): string {
  return row?.name || row?.model || row?.provider || "未知";
}
