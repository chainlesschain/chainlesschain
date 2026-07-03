/**
 * Pure helpers extracted from OrderDetail.vue (opportunistic split).
 * Order type/status + transaction status color+name maps, DID/ID shortening,
 * and time formatting. No reactive state — unit-testable in isolation.
 */

export const getOrderTypeColor = (type) => {
  const colors = {
    sell: "green",
    buy: "blue",
    auction: "purple",
    exchange: "orange",
  };
  return colors[type] || "default";
};

export const getOrderTypeName = (type) => {
  const names = {
    sell: "出售",
    buy: "求购",
    auction: "拍卖",
    exchange: "交换",
  };
  return names[type] || type;
};

export const getOrderStatusColor = (status) => {
  const colors = {
    open: "green",
    matched: "blue",
    escrow: "orange",
    completed: "default",
    cancelled: "red",
    disputed: "volcano",
  };
  return colors[status] || "default";
};

export const getOrderStatusName = (status) => {
  const names = {
    open: "开放",
    matched: "已匹配",
    escrow: "托管中",
    completed: "已完成",
    cancelled: "已取消",
    disputed: "有争议",
  };
  return names[status] || status;
};

export const getTransactionStatusColor = (status) => {
  const colors = {
    pending: "blue",
    escrowed: "orange",
    delivered: "cyan",
    completed: "green",
    refunded: "default",
    disputed: "red",
  };
  return colors[status] || "default";
};

export const getTransactionStatusName = (status) => {
  const names = {
    pending: "待处理",
    escrowed: "已托管",
    delivered: "已交付",
    completed: "已完成",
    refunded: "已退款",
    disputed: "有争议",
  };
  return names[status] || status;
};

export const shortenDid = (did) => {
  if (!did) {
    return "";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

export const shortenId = (id) => {
  if (!id) {
    return "";
  }
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
};

export const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};
