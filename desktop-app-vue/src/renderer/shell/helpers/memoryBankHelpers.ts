/**
 * Memory Bank panel helpers — pure functions extracted for unit testing.
 * Used by `shell/MemoryBankPanel.vue`.
 *
 * Memory Bank ≠ memory.ts daily-notes. This is the AI learning system:
 * patterns / preferences / sessions / behavior insights / storage stats.
 */

export interface PatternLike {
  success_count?: number;
  failure_count?: number;
  use_count?: number;
  execution_count?: number;
  [key: string]: unknown;
}

/**
 * Truncate a string to `len` chars with a trailing "...". Empty / undefined
 * inputs return "" so the panel never renders "undefined".
 */
export function truncate(text: string | undefined | null, len: number): string {
  if (!text) {
    return "";
  }
  if (len <= 0) {
    return "";
  }
  return text.length > len ? `${text.substring(0, len)}...` : text;
}

/**
 * Compute % success rate from {success_count, failure_count}.
 * Returns 0 when total is 0 (avoids NaN render).
 */
export function successRatePercent(item: PatternLike): number {
  const success = Number(item.success_count) || 0;
  const failure = Number(item.failure_count) || 0;
  const total = success + failure;
  if (total === 0) {
    return 0;
  }
  return Math.round((success / total) * 100);
}

/**
 * Format byte count as human-readable string. 0 bytes → "0 B".
 * Uses 1 decimal place and walks B/KB/MB/GB/TB.
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes < 0 || !Number.isFinite(bytes)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  // 0 decimals for B, 1 decimal for everything else
  const formatted = i === 0 ? Math.round(v).toString() : v.toFixed(1);
  return `${formatted} ${units[i]}`;
}

/**
 * Format a millisecond timestamp as MM-DD HH:MM (Chinese locale).
 * Returns "-" for missing / NaN inputs.
 */
export function formatMemDate(
  timestamp: number | string | undefined | null,
): string {
  if (timestamp === undefined || timestamp === null || timestamp === "") {
    return "-";
  }
  const ms =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return "-";
  }
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Color hint for an error-classification tag. Mirrors V5's mapping;
 * missing / unknown classification → "default".
 */
export function classificationColor(
  classification: string | undefined | null,
): string {
  switch ((classification ?? "").toUpperCase()) {
    case "DATABASE":
      return "orange";
    case "NETWORK":
      return "blue";
    case "FILESYSTEM":
      return "green";
    case "VALIDATION":
      return "purple";
    case "AUTHENTICATION":
      return "red";
    default:
      return "default";
  }
}

/**
 * Color hint for a recommendation type tag (returned by
 * memory:get-behavior-insights).
 */
export function recommendationColor(type: string | undefined | null): string {
  switch ((type ?? "").toLowerCase()) {
    case "performance":
      return "#1890ff";
    case "cost":
      return "#52c41a";
    case "usage":
      return "#faad14";
    case "error":
      return "#f5222d";
    default:
      return "#8c8c8c";
  }
}

/**
 * Stringify a preference value for the 用户偏好 a-table cell. Objects
 * become compact JSON; primitives stringify normally.
 */
export function formatPreferenceValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable]";
    }
  }
  return String(value);
}

/**
 * Sum total patterns across the four sub-arrays. Pure derivation so the
 * panel doesn't need to recompute it inline.
 */
export function totalPatternsCount(state: {
  promptPatterns?: unknown[];
  errorFixPatterns?: unknown[];
  codeSnippets?: unknown[];
  workflowPatterns?: unknown[];
}): number {
  return (
    (state.promptPatterns?.length ?? 0) +
    (state.errorFixPatterns?.length ?? 0) +
    (state.codeSnippets?.length ?? 0) +
    (state.workflowPatterns?.length ?? 0)
  );
}
