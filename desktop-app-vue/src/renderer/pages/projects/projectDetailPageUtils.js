/**
 * Pure display helpers extracted from ProjectDetailPage.vue (opportunistic split).
 * Project-type / status color+text mappings and date formatting — no reactive
 * state, so unit-testable in isolation.
 */

export function getProjectTypeColor(type) {
  const colors = {
    web: "blue",
    document: "green",
    data: "purple",
    app: "orange",
  };
  return colors[type] || "default";
}

export function getProjectTypeText(type) {
  const texts = {
    web: "Web应用",
    document: "文档项目",
    data: "数据分析",
    app: "应用程序",
  };
  return texts[type] || type;
}

export function getStatusColor(status) {
  const colors = {
    draft: "default",
    active: "success",
    completed: "blue",
    archived: "warning",
  };
  return colors[status] || "default";
}

export function getStatusText(status) {
  const texts = {
    draft: "草稿",
    active: "进行中",
    completed: "已完成",
    archived: "已归档",
  };
  return texts[status] || status;
}

export function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
