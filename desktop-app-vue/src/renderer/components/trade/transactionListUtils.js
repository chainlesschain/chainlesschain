/**
 * Pure helpers extracted from trade/TransactionList.vue (opportunistic split).
 * ID/DID shortening, amount + relative/full time formatting, and status text.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: distinct from blockchain/transactionListUtils.js — different component.
 * isCurrentUser stays in the SFC (reads props.currentUserDid).
 */

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

export const getStatusText = (status) => {
  const statusMap = {
    pending: "待处理",
    escrowed: "托管中",
    completed: "已完成",
    refunded: "已退款",
    cancelled: "已取消",
    disputed: "争议中",
  };
  return statusMap[status] || status;
};
