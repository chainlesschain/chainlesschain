/**
 * Permission Engine — RBAC (Role-Based Access Control) for CLI.
 * Manages roles, permissions, grants, and checks.
 */

import crypto from "crypto";

function generateId() {
  return crypto.randomUUID();
}

/**
 * Built-in roles.
 */
export const BUILT_IN_ROLES = {
  admin: {
    name: "admin",
    description: "Full system access",
    permissions: ["*"],
  },
  editor: {
    name: "editor",
    description: "Read and write access to content",
    permissions: [
      "note:read",
      "note:write",
      "note:delete",
      "search:read",
      "memory:read",
      "memory:write",
      "session:read",
      "session:write",
      "export:read",
      "import:write",
    ],
  },
  viewer: {
    name: "viewer",
    description: "Read-only access",
    permissions: [
      "note:read",
      "search:read",
      "memory:read",
      "session:read",
      "export:read",
    ],
  },
  agent: {
    name: "agent",
    description: "AI agent access",
    permissions: [
      "note:read",
      "note:write",
      "search:read",
      "memory:read",
      "memory:write",
      "llm:read",
      "llm:write",
      "skill:execute",
    ],
  },
};

/**
 * All known permission scopes.
 */
export const PERMISSION_SCOPES = [
  "note:read",
  "note:write",
  "note:delete",
  "search:read",
  "memory:read",
  "memory:write",
  "session:read",
  "session:write",
  "export:read",
  "import:write",
  "llm:read",
  "llm:write",
  "skill:execute",
  "did:read",
  "did:write",
  "did:delete",
  "encrypt:read",
  "encrypt:write",
  "auth:read",
  "auth:write",
  "auth:admin",
  "audit:read",
  "audit:write",
  "config:read",
  "config:write",
  "system:admin",
];

/**
 * Ensure permission tables exist.
 */
export function ensurePermissionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rbac_roles (
      name TEXT PRIMARY KEY,
      description TEXT,
      permissions TEXT NOT NULL,
      is_builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rbac_grants (
      id TEXT PRIMARY KEY,
      user_did TEXT NOT NULL,
      role_name TEXT NOT NULL,
      granted_by TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_did, role_name)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rbac_direct_permissions (
      id TEXT PRIMARY KEY,
      user_did TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_by TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_did, permission)
    )
  `);

  // Seed built-in roles
  const existing = db
    .prepare("SELECT COUNT(*) as c FROM rbac_roles WHERE is_builtin = 1")
    .get();
  if (existing.c === 0) {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO rbac_roles (name, description, permissions, is_builtin) VALUES (?, ?, ?, ?)",
    );
    for (const role of Object.values(BUILT_IN_ROLES)) {
      stmt.run(
        role.name,
        role.description,
        JSON.stringify(role.permissions),
        1,
      );
    }
  }
}

/**
 * Get all roles.
 */
export function getRoles(db) {
  ensurePermissionTables(db);
  const rows = db
    .prepare("SELECT * FROM rbac_roles ORDER BY is_builtin DESC, name ASC")
    .all();
  return rows.map((r) => ({
    ...r,
    permissions: JSON.parse(r.permissions || "[]"),
    isBuiltin: r.is_builtin === 1,
  }));
}

/**
 * Create a custom role.
 */
export function createRole(db, name, description, permissions) {
  ensurePermissionTables(db);

  if (BUILT_IN_ROLES[name]) {
    throw new Error(`Cannot override built-in role: ${name}`);
  }

  const existing = db
    .prepare("SELECT name FROM rbac_roles WHERE name = ?")
    .get(name);
  if (existing) {
    throw new Error(`Role already exists: ${name}`);
  }

  db.prepare(
    "INSERT INTO rbac_roles (name, description, permissions, is_builtin) VALUES (?, ?, ?, ?)",
  ).run(name, description || "", JSON.stringify(permissions || []), 0);

  return {
    name,
    description,
    permissions: permissions || [],
    isBuiltin: false,
  };
}

/**
 * Delete a custom role.
 */
export function deleteRole(db, name) {
  ensurePermissionTables(db);

  if (BUILT_IN_ROLES[name]) {
    throw new Error(`Cannot delete built-in role: ${name}`);
  }

  const result = db
    .prepare("DELETE FROM rbac_roles WHERE name = ? AND is_builtin = 0")
    .run(name);
  if (result.changes > 0) {
    // Remove grants referencing this role
    db.prepare("DELETE FROM rbac_grants WHERE role_name = ?").run(name);
  }
  return result.changes > 0;
}

/**
 * Grant a role to a user (by DID).
 */
export function grantRole(db, userDid, roleName, grantedBy, expiresAt) {
  ensurePermissionTables(db);

  // Verify role exists
  const role = db
    .prepare("SELECT name FROM rbac_roles WHERE name = ?")
    .get(roleName);
  if (!role) {
    throw new Error(`Role not found: ${roleName}`);
  }

  const id = generateId();
  db.prepare(
    "INSERT OR REPLACE INTO rbac_grants (id, user_did, role_name, granted_by, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userDid, roleName, grantedBy || null, expiresAt || null);

  return { id, userDid, roleName, grantedBy, expiresAt };
}

/**
 * Revoke a role from a user.
 */
export function revokeRole(db, userDid, roleName) {
  ensurePermissionTables(db);
  const result = db
    .prepare("DELETE FROM rbac_grants WHERE user_did = ? AND role_name = ?")
    .run(userDid, roleName);
  return result.changes > 0;
}

/**
 * Grant a direct permission to a user.
 */
export function grantPermission(db, userDid, permission, grantedBy) {
  ensurePermissionTables(db);
  const id = generateId();
  db.prepare(
    "INSERT OR REPLACE INTO rbac_direct_permissions (id, user_did, permission, granted_by) VALUES (?, ?, ?, ?)",
  ).run(id, userDid, permission, grantedBy || null);
  return { id, userDid, permission };
}

/**
 * Revoke a direct permission from a user.
 */
export function revokePermission(db, userDid, permission) {
  ensurePermissionTables(db);
  const result = db
    .prepare(
      "DELETE FROM rbac_direct_permissions WHERE user_did = ? AND permission = ?",
    )
    .run(userDid, permission);
  return result.changes > 0;
}

/**
 * Get all roles and direct permissions for a user.
 */
export function getUserPermissions(db, userDid) {
  ensurePermissionTables(db);

  // Get active role grants
  const allGrants = db
    .prepare("SELECT * FROM rbac_grants WHERE user_did = ?")
    .all(userDid);

  // Filter out expired grants
  const now = new Date().toISOString();
  const grants = allGrants.filter((g) => !g.expires_at || g.expires_at > now);

  // Get direct permissions (not expired)
  const allDirectPerms = db
    .prepare("SELECT * FROM rbac_direct_permissions WHERE user_did = ?")
    .all(userDid);
  const directPerms = allDirectPerms.filter(
    (d) => !d.expires_at || d.expires_at > now,
  );

  // Collect all permissions by looking up each role
  const allPerms = new Set();
  const roles = [];

  for (const grant of grants) {
    roles.push(grant.role_name);
    const role = db
      .prepare("SELECT permissions FROM rbac_roles WHERE name = ?")
      .get(grant.role_name);
    if (role) {
      const perms = JSON.parse(role.permissions || "[]");
      for (const p of perms) allPerms.add(p);
    }
  }

  for (const dp of directPerms) {
    allPerms.add(dp.permission);
  }

  return {
    userDid,
    roles,
    directPermissions: directPerms.map((d) => d.permission),
    effectivePermissions: [...allPerms],
    isAdmin: allPerms.has("*"),
  };
}

/**
 * Check if a user has a specific permission.
 */
export function checkPermission(db, userDid, permission) {
  const userPerms = getUserPermissions(db, userDid);

  // Admin wildcard
  if (userPerms.isAdmin) return true;

  // Exact match
  if (userPerms.effectivePermissions.includes(permission)) return true;

  // Wildcard match (e.g., "note:*" matches "note:read")
  const [scope] = permission.split(":");
  if (userPerms.effectivePermissions.includes(`${scope}:*`)) return true;

  return false;
}

/**
 * Get all grants for a specific role.
 */
export function getRoleGrants(db, roleName) {
  ensurePermissionTables(db);
  return db
    .prepare("SELECT * FROM rbac_grants WHERE role_name = ?")
    .all(roleName);
}

/**
 * List all users with their roles.
 */
export function listUserRoles(db) {
  ensurePermissionTables(db);
  const grants = db
    .prepare("SELECT * FROM rbac_grants ORDER BY user_did")
    .all();

  // Group by user_did in JS to avoid GROUP_CONCAT
  const userMap = new Map();
  for (const g of grants) {
    if (!userMap.has(g.user_did)) {
      userMap.set(g.user_did, []);
    }
    userMap.get(g.user_did).push(g.role_name);
  }

  return [...userMap.entries()].map(([userDid, roles]) => ({ userDid, roles }));
}
