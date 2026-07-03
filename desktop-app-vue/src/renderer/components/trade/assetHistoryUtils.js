/**
 * Pure helpers extracted from AssetHistory.vue (opportunistic split).
 * Asset/transaction type color+label+name maps, timeline/icon colors, and
 * amount/DID/hash/time formatting. No reactive state — unit-testable.
 *
 * NOTE: getAssetIcon/getTransactionIcon stay in the SFC (return Ant icon
 * components), as do isCurrentUser/isIncoming/isOutgoing (read props).
 */

export const getAssetColor = (type) => {
  const colorMap = {
    token: "#1890ff",
    nft: "#52c41a",
    knowledge: "#faad14",
    service: "#722ed1",
  };
  return colorMap[type] || "#999";
};

export const getTypeLabel = (type) => {
  const labelMap = {
    token: "Token",
    nft: "NFT",
    knowledge: "知识产品",
    service: "服务凭证",
  };
  return labelMap[type] || type;
};

export const getTypeColor = (type) => {
  const colorMap = {
    token: "blue",
    nft: "purple",
    knowledge: "green",
    service: "orange",
  };
  return colorMap[type] || "default";
};

export const getTransactionTypeColor = (type) => {
  const colorMap = {
    transfer: "blue",
    mint: "green",
    burn: "red",
    trade: "orange",
  };
  return colorMap[type] || "default";
};

export const getTransactionTypeName = (type) => {
  const nameMap = {
    transfer: "转账",
    mint: "铸造",
    burn: "销毁",
    trade: "交易",
  };
  return nameMap[type] || type;
};

export const getTimelineColor = (type) => {
  const colorMap = {
    transfer: "blue",
    mint: "green",
    burn: "red",
    trade: "orange",
  };
  return colorMap[type] || "gray";
};

export const getIconColor = (type) => {
  const colorMap = {
    transfer: "#1890ff",
    mint: "#52c41a",
    burn: "#ff4d4f",
    trade: "#faad14",
  };
  return colorMap[type] || "#999";
};

export const formatAmount = (amount, decimals = 0) => {
  if (!amount && amount !== 0) {
    return "0";
  }

  const num = parseFloat(amount);
  if (isNaN(num)) {
    return "0";
  }

  if (decimals > 0) {
    const divisor = Math.pow(10, decimals);
    return (num / divisor).toLocaleString("en-US", {
      maximumFractionDigits: decimals,
    });
  }

  return num.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

export const formatDid = (did) => {
  if (!did) {
    return "-";
  }
  if (did === "SYSTEM") {
    return "SYSTEM（系统）";
  }
  if (did === "BURNED") {
    return "BURNED（已销毁）";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

export const formatHash = (hash) => {
  if (!hash) {
    return "-";
  }
  return hash.length > 20 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;
};

export const formatTime = (timestamp) => {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1小时内显示分钟
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return minutes > 0 ? `${minutes}分钟前` : "刚刚";
  }

  // 24小时内显示小时
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}小时前`;
  }

  // 7天内显示天数
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天前`;
  }

  // 超过7天显示完整日期
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
