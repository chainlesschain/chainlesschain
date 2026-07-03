/**
 * Pure helpers extracted from TransactionTimeline.vue (opportunistic split).
 * Timeline color (by status/type), item-type color+name, default title,
 * amount/DID/time formatting, and metadata filtering. No reactive state.
 *
 * NOTE: getTimelineIcon stays in the SFC — it returns Ant icon components.
 */

export const getTimelineColor = (item) => {
  if (item.color) {
    return item.color;
  }

  // 根据状态判断
  if (item.status) {
    const statusColors = {
      completed: "#52c41a",
      success: "#52c41a",
      released: "#52c41a",
      pending: "#1890ff",
      processing: "#1890ff",
      locked: "#faad14",
      escrowed: "#faad14",
      failed: "#f5222d",
      error: "#f5222d",
      cancelled: "#d9d9d9",
      disputed: "#ff4d4f",
    };
    return statusColors[item.status] || "#1890ff";
  }

  // 根据类型判断
  const typeColors = {
    create: "#1890ff",
    transfer: "#52c41a",
    payment: "#faad14",
    refund: "#ff7a45",
    dispute: "#f5222d",
  };
  return typeColors[item.type] || "#1890ff";
};

export const getItemTypeColor = (type) => {
  const colors = {
    create: "blue",
    transfer: "green",
    payment: "orange",
    refund: "red",
    dispute: "volcano",
    escrow: "gold",
    release: "cyan",
  };
  return colors[type] || "default";
};

export const getItemTypeName = (type) => {
  const names = {
    create: "创建",
    transfer: "转账",
    payment: "支付",
    refund: "退款",
    dispute: "争议",
    escrow: "托管",
    release: "释放",
  };
  return names[type] || type;
};

export const getDefaultTitle = (item) => {
  const titles = {
    create: "创建记录",
    transfer: "转账记录",
    payment: "支付记录",
    refund: "退款记录",
    dispute: "争议记录",
    escrow: "托管记录",
    release: "释放记录",
  };
  return titles[item.type] || "交易记录";
};

export const formatAmount = (amount) => {
  if (!amount && amount !== 0) {
    return "0";
  }
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return "0";
  }
  return num.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

export const formatDid = (did) => {
  if (!did) {
    return "-";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 24小时内显示相对时间
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else {
      return "刚刚";
    }
  }

  // 超过24小时显示日期
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export const formatFullTime = (timestamp) => {
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
    second: "2-digit",
  });
};

export const visibleMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  // 过滤掉空值和内部字段
  const filtered = {};
  Object.keys(metadata).forEach((key) => {
    if (
      metadata[key] !== null &&
      metadata[key] !== undefined &&
      metadata[key] !== "" &&
      !key.startsWith("_")
    ) {
      filtered[key] = metadata[key];
    }
  });

  return filtered;
};
