/**
 * Pure display helpers extracted from ErrorMonitorPage.vue (opportunistic split).
 * Severity / classification / status color mappings and timestamp formatting.
 * No reactive state — unit-testable in isolation.
 */

export const getSeverityColor = (severity) => {
  const colors = {
    critical: "red",
    high: "orange",
    medium: "gold",
    low: "green",
  };
  return colors[severity] || "default";
};

export const getClassificationColor = (classification) => {
  const colors = {
    // 数据库错误 - 蓝色系
    DATABASE: "blue",
    DATABASE_LOCKED: "blue",
    DATABASE_CORRUPT: "red",
    DATABASE_READONLY: "geekblue",
    // 网络错误 - 紫色系
    NETWORK: "purple",
    NETWORK_ERROR: "purple",
    CONNECTION_REFUSED: "purple",
    CONNECTION_RESET: "purple",
    TIMEOUT: "gold",
    DNS_ERROR: "volcano",
    SSL_ERROR: "orange",
    // 文件系统错误 - 青色系
    FILESYSTEM: "cyan",
    FILE_NOT_FOUND: "cyan",
    PERMISSION_DENIED: "orange",
    DISK_FULL: "red",
    FILE_LOCKED: "gold",
    PATH_TOO_LONG: "lime",
    // 内存错误 - 红色系
    MEMORY: "red",
    MEMORY_LEAK: "red",
    STACK_OVERFLOW: "magenta",
    // API/HTTP 错误
    RATE_LIMIT: "gold",
    AUTH_ERROR: "orange",
    SERVER_ERROR: "volcano",
    // Electron 错误 - 灰色系
    GPU_ERROR: "default",
    IPC_ERROR: "default",
    WINDOW_ERROR: "default",
    // LLM/AI 错误 - 绿色系
    LLM_CONTEXT_LENGTH: "green",
    LLM_MODEL_ERROR: "lime",
    LLM_API_ERROR: "green",
    // 验证错误
    VALIDATION: "orange",
    // JavaScript 错误 - 品红系
    TYPE_ERROR: "magenta",
    REFERENCE_ERROR: "volcano",
    SYNTAX_ERROR: "geekblue",
    RANGE_ERROR: "pink",
    PERMISSION: "orange",
  };
  return colors[classification] || "default";
};

export const getStatusColor = (status) => {
  const colors = {
    new: "default",
    analyzing: "processing",
    analyzed: "blue",
    fixing: "orange",
    fixed: "success",
    ignored: "default",
  };
  return colors[status] || "default";
};

// 格式化时间
export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "N/A";
  }
  return new Date(timestamp).toLocaleString();
};
