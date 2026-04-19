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

// ===== V2 Surface: Permission Engine governance overlay (CLI v0.141.0) =====
export const PERM_RULE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", DISABLED: "disabled", RETIRED: "retired",
});
export const PERM_CHECK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", EVALUATING: "evaluating", ALLOWED: "allowed", DENIED: "denied", CANCELLED: "cancelled",
});
const _permRTrans = new Map([
  [PERM_RULE_MATURITY_V2.PENDING, new Set([PERM_RULE_MATURITY_V2.ACTIVE, PERM_RULE_MATURITY_V2.RETIRED])],
  [PERM_RULE_MATURITY_V2.ACTIVE, new Set([PERM_RULE_MATURITY_V2.DISABLED, PERM_RULE_MATURITY_V2.RETIRED])],
  [PERM_RULE_MATURITY_V2.DISABLED, new Set([PERM_RULE_MATURITY_V2.ACTIVE, PERM_RULE_MATURITY_V2.RETIRED])],
  [PERM_RULE_MATURITY_V2.RETIRED, new Set()],
]);
const _permRTerminal = new Set([PERM_RULE_MATURITY_V2.RETIRED]);
const _permCTrans = new Map([
  [PERM_CHECK_LIFECYCLE_V2.QUEUED, new Set([PERM_CHECK_LIFECYCLE_V2.EVALUATING, PERM_CHECK_LIFECYCLE_V2.CANCELLED])],
  [PERM_CHECK_LIFECYCLE_V2.EVALUATING, new Set([PERM_CHECK_LIFECYCLE_V2.ALLOWED, PERM_CHECK_LIFECYCLE_V2.DENIED, PERM_CHECK_LIFECYCLE_V2.CANCELLED])],
  [PERM_CHECK_LIFECYCLE_V2.ALLOWED, new Set()],
  [PERM_CHECK_LIFECYCLE_V2.DENIED, new Set()],
  [PERM_CHECK_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _permRsV2 = new Map();
const _permCsV2 = new Map();
let _permMaxActivePerOwner = 10, _permMaxPendingChecksPerRule = 30, _permIdleMs = 30 * 24 * 60 * 60 * 1000, _permStuckMs = 60 * 1000;
function _permPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _permCheckR(from, to) { const a = _permRTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid perm rule transition ${from} → ${to}`); }
function _permCheckC(from, to) { const a = _permCTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid perm check transition ${from} → ${to}`); }
export function setMaxActivePermRulesPerOwnerV2(n) { _permMaxActivePerOwner = _permPos(n, "maxActivePermRulesPerOwner"); }
export function getMaxActivePermRulesPerOwnerV2() { return _permMaxActivePerOwner; }
export function setMaxPendingPermChecksPerRuleV2(n) { _permMaxPendingChecksPerRule = _permPos(n, "maxPendingPermChecksPerRule"); }
export function getMaxPendingPermChecksPerRuleV2() { return _permMaxPendingChecksPerRule; }
export function setPermRuleIdleMsV2(n) { _permIdleMs = _permPos(n, "permRuleIdleMs"); }
export function getPermRuleIdleMsV2() { return _permIdleMs; }
export function setPermCheckStuckMsV2(n) { _permStuckMs = _permPos(n, "permCheckStuckMs"); }
export function getPermCheckStuckMsV2() { return _permStuckMs; }
export function _resetStatePermissionEngineV2() { _permRsV2.clear(); _permCsV2.clear(); _permMaxActivePerOwner = 10; _permMaxPendingChecksPerRule = 30; _permIdleMs = 30 * 24 * 60 * 60 * 1000; _permStuckMs = 60 * 1000; }
export function registerPermRuleV2({ id, owner, scope, metadata } = {}) {
  if (!id) throw new Error("perm rule id required"); if (!owner) throw new Error("perm rule owner required");
  if (_permRsV2.has(id)) throw new Error(`perm rule ${id} already registered`);
  const now = Date.now();
  const r = { id, owner, scope: scope || "*", status: PERM_RULE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, retiredAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _permRsV2.set(id, r); return { ...r, metadata: { ...r.metadata } };
}
function _permCountActive(owner) { let n = 0; for (const r of _permRsV2.values()) if (r.owner === owner && r.status === PERM_RULE_MATURITY_V2.ACTIVE) n++; return n; }
export function activatePermRuleV2(id) {
  const r = _permRsV2.get(id); if (!r) throw new Error(`perm rule ${id} not found`);
  _permCheckR(r.status, PERM_RULE_MATURITY_V2.ACTIVE);
  const recovery = r.status === PERM_RULE_MATURITY_V2.DISABLED;
  if (!recovery && _permCountActive(r.owner) >= _permMaxActivePerOwner) throw new Error(`max active perm rules for owner ${r.owner} reached`);
  const now = Date.now(); r.status = PERM_RULE_MATURITY_V2.ACTIVE; r.updatedAt = now; r.lastTouchedAt = now; if (!r.activatedAt) r.activatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function disablePermRuleV2(id) { const r = _permRsV2.get(id); if (!r) throw new Error(`perm rule ${id} not found`); _permCheckR(r.status, PERM_RULE_MATURITY_V2.DISABLED); r.status = PERM_RULE_MATURITY_V2.DISABLED; r.updatedAt = Date.now(); return { ...r, metadata: { ...r.metadata } }; }
export function retirePermRuleV2(id) { const r = _permRsV2.get(id); if (!r) throw new Error(`perm rule ${id} not found`); _permCheckR(r.status, PERM_RULE_MATURITY_V2.RETIRED); const now = Date.now(); r.status = PERM_RULE_MATURITY_V2.RETIRED; r.updatedAt = now; if (!r.retiredAt) r.retiredAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function touchPermRuleV2(id) { const r = _permRsV2.get(id); if (!r) throw new Error(`perm rule ${id} not found`); if (_permRTerminal.has(r.status)) throw new Error(`cannot touch terminal perm rule ${id}`); const now = Date.now(); r.lastTouchedAt = now; r.updatedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function getPermRuleV2(id) { const r = _permRsV2.get(id); if (!r) return null; return { ...r, metadata: { ...r.metadata } }; }
export function listPermRulesV2() { return [..._permRsV2.values()].map((r) => ({ ...r, metadata: { ...r.metadata } })); }
function _permCountPending(ruleId) { let n = 0; for (const c of _permCsV2.values()) if (c.ruleId === ruleId && (c.status === PERM_CHECK_LIFECYCLE_V2.QUEUED || c.status === PERM_CHECK_LIFECYCLE_V2.EVALUATING)) n++; return n; }
export function createPermCheckV2({ id, ruleId, subject, metadata } = {}) {
  if (!id) throw new Error("perm check id required"); if (!ruleId) throw new Error("perm check ruleId required");
  if (_permCsV2.has(id)) throw new Error(`perm check ${id} already exists`);
  if (!_permRsV2.has(ruleId)) throw new Error(`perm rule ${ruleId} not found`);
  if (_permCountPending(ruleId) >= _permMaxPendingChecksPerRule) throw new Error(`max pending perm checks for rule ${ruleId} reached`);
  const now = Date.now();
  const c = { id, ruleId, subject: subject || "", status: PERM_CHECK_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _permCsV2.set(id, c); return { ...c, metadata: { ...c.metadata } };
}
export function evaluatePermCheckV2(id) { const c = _permCsV2.get(id); if (!c) throw new Error(`perm check ${id} not found`); _permCheckC(c.status, PERM_CHECK_LIFECYCLE_V2.EVALUATING); const now = Date.now(); c.status = PERM_CHECK_LIFECYCLE_V2.EVALUATING; c.updatedAt = now; if (!c.startedAt) c.startedAt = now; return { ...c, metadata: { ...c.metadata } }; }
export function allowPermCheckV2(id) { const c = _permCsV2.get(id); if (!c) throw new Error(`perm check ${id} not found`); _permCheckC(c.status, PERM_CHECK_LIFECYCLE_V2.ALLOWED); const now = Date.now(); c.status = PERM_CHECK_LIFECYCLE_V2.ALLOWED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; return { ...c, metadata: { ...c.metadata } }; }
export function denyPermCheckV2(id, reason) { const c = _permCsV2.get(id); if (!c) throw new Error(`perm check ${id} not found`); _permCheckC(c.status, PERM_CHECK_LIFECYCLE_V2.DENIED); const now = Date.now(); c.status = PERM_CHECK_LIFECYCLE_V2.DENIED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; if (reason) c.metadata.denyReason = String(reason); return { ...c, metadata: { ...c.metadata } }; }
export function cancelPermCheckV2(id, reason) { const c = _permCsV2.get(id); if (!c) throw new Error(`perm check ${id} not found`); _permCheckC(c.status, PERM_CHECK_LIFECYCLE_V2.CANCELLED); const now = Date.now(); c.status = PERM_CHECK_LIFECYCLE_V2.CANCELLED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; if (reason) c.metadata.cancelReason = String(reason); return { ...c, metadata: { ...c.metadata } }; }
export function getPermCheckV2(id) { const c = _permCsV2.get(id); if (!c) return null; return { ...c, metadata: { ...c.metadata } }; }
export function listPermChecksV2() { return [..._permCsV2.values()].map((c) => ({ ...c, metadata: { ...c.metadata } })); }
export function autoDisableIdlePermRulesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const r of _permRsV2.values()) if (r.status === PERM_RULE_MATURITY_V2.ACTIVE && (t - r.lastTouchedAt) >= _permIdleMs) { r.status = PERM_RULE_MATURITY_V2.DISABLED; r.updatedAt = t; flipped.push(r.id); } return { flipped, count: flipped.length }; }
export function autoDenyStuckPermChecksV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const c of _permCsV2.values()) if (c.status === PERM_CHECK_LIFECYCLE_V2.EVALUATING && c.startedAt != null && (t - c.startedAt) >= _permStuckMs) { c.status = PERM_CHECK_LIFECYCLE_V2.DENIED; c.updatedAt = t; if (!c.settledAt) c.settledAt = t; c.metadata.denyReason = "auto-deny-stuck"; flipped.push(c.id); } return { flipped, count: flipped.length }; }
export function getPermissionEngineGovStatsV2() {
  const rulesByStatus = {}; for (const v of Object.values(PERM_RULE_MATURITY_V2)) rulesByStatus[v] = 0; for (const r of _permRsV2.values()) rulesByStatus[r.status]++;
  const checksByStatus = {}; for (const v of Object.values(PERM_CHECK_LIFECYCLE_V2)) checksByStatus[v] = 0; for (const c of _permCsV2.values()) checksByStatus[c.status]++;
  return { totalPermRulesV2: _permRsV2.size, totalPermChecksV2: _permCsV2.size, maxActivePermRulesPerOwner: _permMaxActivePerOwner, maxPendingPermChecksPerRule: _permMaxPendingChecksPerRule, permRuleIdleMs: _permIdleMs, permCheckStuckMs: _permStuckMs, rulesByStatus, checksByStatus };
}
