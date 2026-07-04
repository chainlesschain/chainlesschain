/**
 * Pure helpers extracted from EscrowDetail.vue (opportunistic split).
 * Escrow status title/description (static maps) + id/did/amount/time
 * formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: isCurrentUser stays in the SFC (reads the reactive currentUserDid ref).
 */

export const getStatusTitle = (status) => {
  const titles = {
    locked: "资金已托管",
    released: "资金已释放",
    refunded: "资金已退款",
    disputed: "存在争议",
  };
  return titles[status] || status;
};

export const getStatusDescription = (status) => {
  const descriptions = {
    locked: "托管资金已锁定，等待交易完成",
    released: "托管资金已释放给卖家",
    refunded: "托管资金已退款给买家",
    disputed: "交易存在争议，等待仲裁",
  };
  return descriptions[status] || "";
};

export const formatId = (id) => {
  if (!id) {
    return "-";
  }
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
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
