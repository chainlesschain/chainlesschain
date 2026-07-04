/**
 * Pure helpers extracted from PermissionManager.vue (opportunistic split).
 * Role tag color (static map) + date formatting. No reactive state —
 * unit-testable in isolation.
 *
 * NOTE: getRolesWithPermission / hasPermission / isBuiltinRole stay in the SFC
 * — they read the reactive `roles` ref.
 */

export function getRoleColor(roleName) {
  const colors = {
    owner: "red",
    admin: "orange",
    editor: "blue",
    member: "green",
    viewer: "default",
  };
  return colors[roleName.toLowerCase()] || "default";
}

export function formatDate(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }
  return new Date(timestamp).toLocaleDateString();
}
