/**
 * Pure helpers extracted from BridgeHistory.vue (opportunistic split).
 * Bridge status text+tag/status color and address/time formatting. No reactive
 * state — unit-testable in isolation.
 *
 * NOTE: getStatusIcon stays in the SFC (returns Ant icon components) and
 * getNetworkName stays (reads the reactive blockchain-store network list).
 */

export const getStatusText = (status) => {
  const statusMap = {
    pending: "待处理",
    locked: "已锁定",
    completed: "已完成",
    failed: "失败",
  };
  return statusMap[status] || status;
};

export const getStatusTagColor = (status) => {
  const colorMap = {
    pending: "processing",
    locked: "warning",
    completed: "success",
    failed: "error",
  };
  return colorMap[status] || "default";
};

export const getStatusColor = (status) => {
  const colorMap = {
    pending: "#faad14",
    locked: "#1890ff",
    completed: "#52c41a",
    failed: "#ff4d4f",
  };
  return colorMap[status] || "#8c8c8c";
};

export const formatAddress = (address) => {
  if (!address) {
    return "";
  }
  if (address.length <= 20) {
    return address;
  }
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
};

export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return "刚刚";
  }

  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前`;
  }

  // 小于24小时
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前`;
  }

  // 超过24小时，显示具体日期
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
