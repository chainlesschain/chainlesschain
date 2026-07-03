/**
 * Pure helpers extracted from OrganizationMembersPage.vue (opportunistic split).
 * DID/date formatting, role label+color, permission JSON parsing, and default
 * permission counts. No reactive state — unit-testable in isolation.
 */

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
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
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

export const parsePermissions = (permissionsJson) => {
  try {
    const perms = JSON.parse(permissionsJson);
    return Array.isArray(perms) ? perms : [];
  } catch {
    return [];
  }
};

export const getPermissionCount = (member) => {
  if (member.permissions_json) {
    return parsePermissions(member.permissions_json).length;
  }
  // 返回默认权限数量
  const defaultCounts = {
    owner: "全部",
    admin: 15,
    member: 8,
    viewer: 3,
  };
  return defaultCounts[member.role] || 0;
};
