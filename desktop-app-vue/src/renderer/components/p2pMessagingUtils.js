/**
 * Pure helpers extracted from P2PMessaging.vue (opportunistic split).
 * Encryption-session key, per-platform device color, and relative time
 * formatting. No reactive state — unit-testable in isolation. (Session/device
 * lookups and the chat title read reactive maps/refs and stay in the SFC.)
 */

// 加密会话 key（peerId + deviceId）
export function getSessionKey(peerId, deviceId) {
  return `${peerId}-${deviceId}`;
}

// 设备平台颜色
export function getDeviceColor(platform) {
  const colors = {
    win32: "#1890ff",
    darwin: "#722ed1",
    linux: "#fa8c16",
    android: "#52c41a",
    ios: "#13c2c2",
  };
  return colors[platform] || "#999";
}

// 相对时间：今天→时:分 / 近 7 天→N天前 / 更早→日期
export function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 如果是今天
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // 如果是最近7天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天前`;
  }

  // 否则显示日期
  return date.toLocaleDateString("zh-CN");
}
