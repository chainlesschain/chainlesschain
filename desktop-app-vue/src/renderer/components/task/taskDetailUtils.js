/**
 * Pure helpers extracted from TaskDetail.vue (opportunistic split).
 * Task status/priority label+color, hash-based label/avatar color + avatar
 * text, datetime formatting, and change-type label+color. No reactive state.
 */

export function getStatusLabel(status) {
  const labels = {
    pending: "待处理",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
  };
  return labels[status] || status;
}

export function getStatusColor(status) {
  const colors = {
    pending: "default",
    in_progress: "processing",
    completed: "success",
    cancelled: "error",
  };
  return colors[status] || "default";
}

export function getPriorityLabel(priority) {
  const labels = {
    urgent: "紧急",
    high: "高",
    medium: "中",
    low: "低",
  };
  return labels[priority] || priority;
}

export function getPriorityColor(priority) {
  const colors = {
    urgent: "red",
    high: "orange",
    medium: "blue",
    low: "green",
  };
  return colors[priority] || "default";
}

export function getLabelColor(label) {
  const colors = ["blue", "green", "orange", "purple", "cyan", "magenta"];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function getAvatarColor(did) {
  const colors = [
    "#1890ff",
    "#52c41a",
    "#faad14",
    "#f5222d",
    "#722ed1",
    "#13c2c2",
  ];
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = did.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function getAvatarText(did) {
  return did.substring(0, 2).toUpperCase();
}

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN");
}

export function getChangeLabel(changeType) {
  const labels = {
    create: "创建了任务",
    title: "修改了标题",
    description: "修改了描述",
    status: "变更了状态",
    priority: "调整了优先级",
    assigned_to: "分配给",
    due_date: "修改了截止日期",
  };
  return labels[changeType] || changeType;
}

export function getChangeColor(changeType) {
  if (changeType === "create") {
    return "green";
  }
  if (changeType === "status") {
    return "blue";
  }
  return "gray";
}
