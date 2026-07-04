/**
 * Pure helpers extracted from trade/common/ContractCard.vue (opportunistic split).
 * Contract type color/name (static maps) + did/amount/relative-time formatting.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: isCurrentUser + the canSign/canExecute/isMyContract computeds stay in
 * the SFC — they read props / reactive state.
 */

export const getContractTypeColor = (type) => {
  const colorMap = {
    trade: "green",
    service: "blue",
    escrow: "orange",
    subscription: "purple",
    exchange: "cyan",
  };
  return colorMap[type] || "default";
};

export const getContractTypeName = (type) => {
  const nameMap = {
    trade: "交易合约",
    service: "服务合约",
    escrow: "托管合约",
    subscription: "订阅合约",
    exchange: "交换合约",
  };
  return nameMap[type] || type;
};

export const formatDid = (did) => {
  if (!did) {
    return "-";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
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
