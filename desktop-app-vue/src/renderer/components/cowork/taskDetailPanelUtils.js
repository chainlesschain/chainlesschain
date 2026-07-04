/**
 * Pure helpers extracted from TaskDetailPanel.vue (opportunistic split).
 * Task status color+text, progress/steps status, datetime + duration + result
 * formatting. No reactive state — unit-testable in isolation.
 */
import { format } from "date-fns";

export function getTaskStatusColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
    paused: "warning",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return colors[status] || "default";
}

export function getTaskStatusText(status) {
  const texts = {
    pending: "待处理",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return texts[status] || status;
}

export function getProgressStatus(task) {
  if (task.status === "failed") {
    return "exception";
  }
  if (task.status === "completed") {
    return "success";
  }
  if (task.status === "running") {
    return "active";
  }
  return "normal";
}

export function getStepsStatus(task) {
  if (task.status === "failed") {
    return "error";
  }
  if (task.status === "completed") {
    return "finish";
  }
  return "process";
}

export function formatDateTime(timestamp) {
  if (!timestamp) {
    return "-";
  }

  try {
    return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
  } catch {
    return "-";
  }
}

export function formatDuration(ms) {
  if (!ms || ms === 0) {
    return "-";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours} 小时 ${minutes % 60} 分钟`;
  } else if (minutes > 0) {
    return `${minutes} 分钟 ${seconds % 60} 秒`;
  } else {
    return `${seconds} 秒`;
  }
}

export function formatResult(result) {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
