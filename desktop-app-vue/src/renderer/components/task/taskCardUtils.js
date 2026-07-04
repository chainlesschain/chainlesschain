/**
 * Pure helpers extracted from TaskCard.vue (opportunistic split).
 * Priority label, hash-based label + avatar color, and due-date formatting.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: getAvatarText / getAssignedUserName / getDueDateTooltip stay in the SFC
 * — they read the reactive workspace store / props.
 */

export function getPriorityLabel(priority) {
  const labels = {
    urgent: "紧急",
    high: "高",
    medium: "中",
    low: "低",
  };
  return labels[priority] || priority;
}

export function getLabelColor(label) {
  // 根据标签名称生成颜色
  const colors = ["blue", "green", "orange", "purple", "cyan", "magenta"];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function formatDueDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "今天";
  }
  if (days === 1) {
    return "明天";
  }
  if (days === -1) {
    return "昨天";
  }
  if (days > 0 && days < 7) {
    return `${days}天后`;
  }
  if (days < 0 && days > -7) {
    return `${Math.abs(days)}天前`;
  }

  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function getAvatarColor(did) {
  // 根据 DID 生成颜色
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
