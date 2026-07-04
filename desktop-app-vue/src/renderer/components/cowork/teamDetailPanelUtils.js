/**
 * Pure helpers extracted from TeamDetailPanel.vue (opportunistic split).
 * Team status color+text, role text, task status color+text, and datetime
 * formatting (date-fns). No reactive state — unit-testable in isolation.
 */
import { format } from "date-fns";

export function getStatusColor(status) {
  const colors = {
    active: "green",
    paused: "orange",
    completed: "blue",
    failed: "red",
    destroyed: "default",
  };
  return colors[status] || "default";
}

export function getStatusText(status) {
  const texts = {
    active: "活跃",
    paused: "暂停",
    completed: "已完成",
    failed: "失败",
    destroyed: "已销毁",
  };
  return texts[status] || status;
}

export function getRoleText(role) {
  const texts = {
    leader: "领导者",
    member: "成员",
  };
  return texts[role] || role;
}

export function getTaskStatusColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
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
