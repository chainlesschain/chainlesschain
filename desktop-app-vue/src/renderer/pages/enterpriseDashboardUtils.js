/**
 * Pure helpers extracted from EnterpriseDashboard.vue (opportunistic split).
 * Byte / relative-time formatting, badge/role/activity color + activity text.
 * No reactive state — unit-testable in isolation.
 *
 * NOTE: getStorageColor/getBandwidthColor/getNetworkHealthColor stay in the SFC
 * (they read reactive `stats`), and getActivityIcon stays (returns Ant icon
 * components).
 */

export function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "Just now";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

export function getBadgeColor(index) {
  const colors = ["#f5222d", "#fa8c16", "#faad14"];
  return colors[index] || "#1890ff";
}

export function getRoleColor(role) {
  const colors = {
    owner: "red",
    admin: "orange",
    editor: "blue",
    member: "green",
    viewer: "default",
  };
  return colors[role] || "default";
}

export function getActivityColor(type) {
  const colors = {
    create: "green",
    edit: "blue",
    view: "gray",
    comment: "purple",
    share: "orange",
    delete: "red",
  };
  return colors[type] || "blue";
}

export function getActivityText(type) {
  const texts = {
    create: "created",
    edit: "edited",
    view: "viewed",
    comment: "commented on",
    share: "shared",
    delete: "deleted",
  };
  return texts[type] || "interacted with";
}
