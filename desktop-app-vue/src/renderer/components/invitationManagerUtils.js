/**
 * Pure helpers extracted from InvitationManager.vue (opportunistic split).
 * Invitation expiry/active state, status badge, usage percent, DID/date
 * formatting, and role label+color. No reactive state — unit-testable.
 */
import dayjs from "dayjs";

export const isExpired = (invitation) => {
  if (!invitation.expire_at) {
    return false;
  }
  return Date.now() > invitation.expire_at;
};

export const isInvitationActive = (invitation) => {
  if (!invitation.is_active) {
    return false;
  }
  if (invitation.used_count >= invitation.max_uses) {
    return false;
  }
  if (isExpired(invitation)) {
    return false;
  }
  return true;
};

export const getStatusBadge = (invitation) => {
  if (!invitation.is_active) {
    return { status: "default", text: "已禁用" };
  }
  if (invitation.used_count >= invitation.max_uses) {
    return { status: "error", text: "已用完" };
  }
  if (isExpired(invitation)) {
    return { status: "error", text: "已过期" };
  }
  return { status: "success", text: "有效" };
};

export const getUsagePercent = (invitation) => {
  // max_uses === 0 (unlimited / unset) would divide by zero → NaN% / Infinity%.
  // Mirror InvitationLinkManager.getUsagePercent and report 0%.
  if (!invitation.max_uses) {
    return 0;
  }
  return Math.round((invitation.used_count / invitation.max_uses) * 100);
};

export const formatDID = (did) => {
  if (!did) {
    return "";
  }
  if (did.length > 30) {
    return did.substring(0, 15) + "..." + did.substring(did.length - 10);
  }
  return did;
};

export const formatDate = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
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

export const getRoleColor = (role) => {
  const colors = {
    owner: "red",
    admin: "orange",
    member: "blue",
    viewer: "default",
  };
  return colors[role] || "default";
};
