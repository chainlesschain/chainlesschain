/**
 * Pure helpers extracted from AssetDetail.vue (opportunistic split).
 * Asset type label+color, cover gradient, and amount/ID/DID/time formatting.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: getAssetIcon stays in the SFC (returns Ant icon components) and
 * isCurrentUser stays (reads props.currentUserDid).
 */

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

export const getCoverGradient = (type) => {
  const gradientMap = {
    token: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    nft: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    knowledge: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    service: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  };
  return gradientMap[type] || gradientMap.token;
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

export const formatId = (id) => {
  if (!id) {
    return "-";
  }
  return id.length > 20 ? `${id.slice(0, 10)}...${id.slice(-8)}` : id;
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

  // 超过24小时显示完整日期
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
