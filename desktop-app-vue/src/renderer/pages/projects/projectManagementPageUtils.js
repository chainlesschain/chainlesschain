/**
 * Pure helpers extracted from ProjectManagementPage.vue (opportunistic split).
 * Project type + status label+color, file-size and datetime formatting.
 * No reactive state — unit-testable in isolation.
 */

export const getProjectTypeLabel = (type) => {
  const map = {
    web: "网页",
    document: "文档",
    data: "数据",
    app: "应用",
    presentation: "演示",
    spreadsheet: "表格",
  };
  return map[type] || type;
};

export const getProjectTypeColor = (type) => {
  const map = {
    web: "blue",
    document: "green",
    data: "orange",
    app: "purple",
    presentation: "cyan",
    spreadsheet: "magenta",
  };
  return map[type] || "default";
};

export const getStatusLabel = (status) => {
  const map = {
    draft: "草稿",
    active: "活跃",
    completed: "已完成",
    archived: "已归档",
  };
  return map[status] || status;
};

export const getStatusColor = (status) => {
  const map = {
    draft: "default",
    active: "success",
    completed: "processing",
    archived: "warning",
  };
  return map[status] || "default";
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatDateTime = (timestamp) => {
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
};
