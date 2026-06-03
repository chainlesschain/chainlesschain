export const TOOL_PERMISSION_LEVELS = {
  readonly: 0,
  standard: 1,
  elevated: 2,
};

export function normalizeToolPermissions(permissions = {}) {
  return {
    level: permissions.level || "standard",
    scopes: Array.isArray(permissions.scopes) ? [...permissions.scopes] : [],
  };
}

export function isToolAllowed(descriptor, policy = {}) {
  const permissions = normalizeToolPermissions(descriptor?.permissions);
  const allowlist = Array.isArray(policy.allowlist) ? policy.allowlist : null;
  const denylist = Array.isArray(policy.denylist) ? policy.denylist : [];
  const maxLevel = policy.maxLevel || "elevated";

  if (!descriptor?.name) return false;
  if (allowlist && !allowlist.includes(descriptor.name)) return false;
  if (denylist.includes(descriptor.name)) return false;

  return (
    TOOL_PERMISSION_LEVELS[permissions.level] <=
    TOOL_PERMISSION_LEVELS[maxLevel]
  );
}
