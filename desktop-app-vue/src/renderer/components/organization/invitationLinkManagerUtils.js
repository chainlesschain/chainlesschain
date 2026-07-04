/**
 * Pure helpers extracted from InvitationLinkManager.vue (opportunistic split).
 * Role color/label (static maps), usage percent/status, status badge, and
 * date formatting. No reactive state — unit-testable in isolation.
 *
 * NOTE: this module now owns the dayjs + relativeTime + zh-cn locale setup
 * (they were only used by formatDate + getTimeRemaining). dayjs.extend runs
 * once at module load — the plugin registration is a singleton.
 */
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

export const getRoleColor = (role) => {
  const colors = {
    owner: "red",
    admin: "orange",
    member: "blue",
    viewer: "green",
  };
  return colors[role] || "default";
};

export const getRoleLabel = (role) => {
  const labels = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    viewer: "访客",
  };
  return labels[role] || role;
};

export const getUsagePercent = (record) => {
  if (record.max_uses === 0) {
    return 0;
  }
  return Math.round((record.used_count / record.max_uses) * 100);
};

export const getUsageStatus = (record) => {
  const percent = getUsagePercent(record);
  if (percent >= 100) {
    return "exception";
  }
  if (percent >= 80) {
    return "active";
  }
  return "normal";
};

export const getStatusBadge = (record) => {
  if (record.isExpired) {
    return { status: "default", text: "已过期" };
  }
  if (record.isExhausted) {
    return { status: "default", text: "已用尽" };
  }
  if (record.status === "revoked") {
    return { status: "error", text: "已撤销" };
  }
  if (record.status === "active") {
    return { status: "success", text: "活跃" };
  }
  return { status: "default", text: record.status };
};

export const formatDate = (timestamp) => {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm");
};

export const getTimeRemaining = (expiresAt) => {
  const now = Date.now();
  if (expiresAt < now) {
    return "已过期";
  }
  return dayjs(expiresAt).fromNow();
};
