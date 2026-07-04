/**
 * Pure helpers extracted from MessageQueuePage.vue (opportunistic split).
 * Message preview truncation, status color/text (static maps), and datetime
 * formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: MessageQueuePage is an Options-API component — these were defined inside
 * setup() and are still listed in its return{} block (now as imported bindings).
 */

export const getMessagePreview = (msg) => {
  if (msg.messageType === "text") {
    return (
      msg.content.substring(0, 50) + (msg.content.length > 50 ? "..." : "")
    );
  }
  return `[${msg.messageType}]`;
};

export const getStatusColor = (status) => {
  const colorMap = {
    pending: "default",
    sending: "blue",
    completed: "success",
    error: "error",
    cancelled: "warning",
    accepted: "success",
    rejected: "warning",
  };
  return colorMap[status] || "default";
};

export const getStatusText = (status) => {
  const textMap = {
    pending: "等待中",
    sending: "发送中",
    completed: "已完成",
    error: "失败",
    cancelled: "已取消",
    accepted: "已接受",
    rejected: "已拒绝",
  };
  return textMap[status] || status;
};

export const formatDateTime = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};
