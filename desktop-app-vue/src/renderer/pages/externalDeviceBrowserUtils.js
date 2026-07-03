/**
 * Pure display helpers extracted from ExternalDeviceBrowser.vue
 * (opportunistic split). File-category color/label, human file size, and
 * relative-date formatting. No reactive state — unit-testable in isolation.
 * (getFileIcon stays in the SFC: it returns icon components.)
 */

export function getCategoryColor(category) {
  const colorMap = {
    DOCUMENT: "blue",
    IMAGE: "green",
    VIDEO: "purple",
    AUDIO: "orange",
    CODE: "cyan",
    OTHER: "default",
  };
  return colorMap[category] || "default";
}

export function getCategoryLabel(category) {
  const labelMap = {
    DOCUMENT: "文档",
    IMAGE: "图片",
    VIDEO: "视频",
    AUDIO: "音频",
    CODE: "代码",
    OTHER: "其他",
  };
  return labelMap[category] || category;
}

// 人类可读文件大小
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return (bytes / Math.pow(k, i)).toFixed(2) + " " + units[i];
}

// 相对日期：N分钟前 / N小时前 / N天前 / 完整日期
export function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1小时内
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}分钟前`;
  }

  // 1天内
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}小时前`;
  }

  // 7天内
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days}天前`;
  }

  // 格式化为日期
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
