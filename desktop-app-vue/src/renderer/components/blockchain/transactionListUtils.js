/**
 * Pure helpers extracted from TransactionList.vue (opportunistic split).
 * Tx-type text+color, status text+color, and hash/address/time formatting.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: getTxTypeIcon stays in the SFC (returns Ant icon components) and
 * formatValue stays (reads the reactive current-network symbol).
 */

export const getTxTypeText = (type) => {
  const typeMap = {
    transfer: "转账",
    mint: "铸造",
    contract_call: "合约调用",
  };
  return typeMap[type] || "未知";
};

export const getTxTypeColor = (type) => {
  const colorMap = {
    transfer: "#1890ff",
    mint: "#52c41a",
    contract_call: "#fa8c16",
  };
  return colorMap[type] || "#8c8c8c";
};

export const getStatusText = (status) => {
  const statusMap = {
    pending: "待确认",
    confirmed: "已确认",
    failed: "失败",
  };
  return statusMap[status] || "未知";
};

export const getStatusColor = (status) => {
  const colorMap = {
    pending: "processing",
    confirmed: "success",
    failed: "error",
  };
  return colorMap[status] || "default";
};

export const formatHash = (hash) => {
  if (!hash) {
    return "";
  }
  if (hash.length <= 20) {
    return hash;
  }
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

export const formatAddress = (address) => {
  if (!address) {
    return "";
  }
  if (address.length <= 20) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
