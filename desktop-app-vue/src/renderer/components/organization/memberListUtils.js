/**
 * Pure helpers extracted from MemberList.vue (opportunistic split).
 * Online-status tag, hash-based avatar color, role color+label, and DID/date/
 * relative-time formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: getMembersByRole stays in the SFC — it filters the reactive member list.
 */

export function getOnlineStatus(online) {
  return online ? "success" : "default";
}

export function getAvatarColor(name) {
  const colors = ["#f56a00", "#7265e6", "#ffbf00", "#00a2ae", "#87d068"];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
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

export function getRoleLabel(role) {
  const labels = {
    owner: "Owner",
    admin: "Admin",
    editor: "Editor",
    member: "Member",
    viewer: "Viewer",
  };
  return labels[role] || "Member";
}

export function formatDID(did) {
  if (!did) {
    return "";
  }
  if (did.length <= 20) {
    return did;
  }
  return `${did.substring(0, 10)}...${did.substring(did.length - 10)}`;
}

export function formatDate(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

export function formatTime(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "just now";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  return `${Math.floor(diff / 86400000)}d ago`;
}
