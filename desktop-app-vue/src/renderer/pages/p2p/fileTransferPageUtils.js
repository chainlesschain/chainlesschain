/**
 * Pure helpers extracted from FileTransferPage.vue (opportunistic split).
 * Transfer status color+text, and file-size / speed / relative + full datetime
 * formatting. No reactive state — unit-testable in isolation.
 */

export const getStatusColor = (status) => {
  const colorMap = {
    pending: "default",
    uploading: "blue",
    downloading: "blue",
    completed: "success",
    error: "error",
    cancelled: "warning",
  };
  return colorMap[status] || "default";
};

export const getStatusText = (status) => {
  const textMap = {
    pending: "等待中",
    uploading: "发送中",
    downloading: "接收中",
    completed: "已完成",
    error: "失败",
    cancelled: "已取消",
  };
  return textMap[status] || status;
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

export const formatSpeed = (bytesPerSecond) => {
  return formatFileSize(bytesPerSecond) + "/s";
};

export const formatRelativeTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);

  if (seconds < 60) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  return formatDateTime(timestamp);
};

export const formatDateTime = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};
