/**
 * Pure display helpers extracted from CollaborationPage.vue (opportunistic split).
 * Collaboration-role color/name mappings and deterministic avatar-color hashing.
 * No reactive state — unit-testable in isolation. (Icon/date/empty-state helpers
 * stay in the SFC: they return icon components or read reactive tab state.)
 */

// 角色颜色
export function getRoleColor(role) {
  const colorMap = {
    owner: "gold",
    admin: "red",
    editor: "blue",
    viewer: "green",
  };
  return colorMap[role] || "default";
}

// 角色名称
export function getRoleName(role) {
  const nameMap = {
    owner: "所有者",
    admin: "管理员",
    editor: "编辑者",
    viewer: "查看者",
  };
  return nameMap[role] || role;
}

// 头像颜色（基于 DID 稳定哈希）
export function getAvatarColor(did) {
  const colors = ["#f56a00", "#7265e6", "#ffbf00", "#00a2ae", "#87d068"];
  const hash =
    did?.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
  return colors[hash % colors.length];
}
