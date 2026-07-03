/**
 * Pure display helpers extracted from TaskMonitor.vue (opportunistic split).
 * Task status color/text, progress-bar state, and duration formatting. No
 * reactive state — unit-testable in isolation. (getTeamName reads the reactive
 * teams list and formatDate uses date-fns; both stay in the SFC.)
 */

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

// 持续时间：Hh Mm / Mm Ss / Ss（无值返回 '-'）
export function formatDuration(ms) {
  if (!ms || ms === 0) {
    return "-";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
