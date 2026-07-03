/**
 * Pure helpers extracted from CommandLogsPage.vue (opportunistic split).
 * Log status/level/duration color+text, string truncation, and timestamp/JSON
 * formatting. No reactive state — unit-testable in isolation.
 */
import dayjs from "dayjs";

export function getStatusColor(status) {
  const colors = {
    success: "success",
    failure: "error",
    warning: "warning",
  };
  return colors[status] || "default";
}

export function getStatusText(status) {
  const texts = {
    success: "成功",
    failure: "失败",
    warning: "警告",
  };
  return texts[status] || status;
}

export function getLevelColor(level) {
  const colors = {
    debug: "default",
    info: "processing",
    warn: "warning",
    error: "error",
  };
  return colors[level] || "default";
}

export function getDurationColor(duration) {
  if (duration < 500) {
    return "success";
  }
  if (duration < 2000) {
    return "warning";
  }
  return "error";
}

export function truncate(str, maxLen) {
  if (!str) {
    return "";
  }
  if (str.length <= maxLen) {
    return str;
  }
  return str.substring(0, maxLen) + "...";
}

export function formatTimestamp(timestamp) {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
}

export function formatJSON(data) {
  if (!data) {
    return "";
  }
  if (typeof data === "string") {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  return JSON.stringify(data, null, 2);
}
