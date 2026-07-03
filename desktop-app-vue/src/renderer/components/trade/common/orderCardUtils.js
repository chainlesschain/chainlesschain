/**
 * Pure helpers extracted from OrderCard.vue (opportunistic split).
 * Order type color+label, asset color, and amount/DID/time formatting.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: getAssetIcon stays in the SFC — it returns Ant icon components.
 */

export const getOrderTypeColor = (type) => {
  const colorMap = {
    sell: "green",
    buy: "blue",
    auction: "purple",
    exchange: "orange",
  };
  return colorMap[type] || "default";
};

export const getOrderTypeLabel = (type) => {
  const labelMap = {
    sell: "出售",
    buy: "求购",
    auction: "拍卖",
    exchange: "交换",
  };
  return labelMap[type] || type;
};

export const getAssetColor = (type) => {
  const colorMap = {
    token: "#1890ff",
    nft: "#52c41a",
    knowledge: "#faad14",
    service: "#722ed1",
  };
  return colorMap[type] || "#999";
};

export const formatAmount = (amount) => {
  if (!amount && amount !== 0) {
    return "0";
  }
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return "0";
  }

  // 大数字使用科学计数法
  if (num >= 1e9) {
    return (num / 1e9).toFixed(2) + "B";
  } else if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + "M";
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(2) + "K";
  }

  // 小数点后最多8位
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
