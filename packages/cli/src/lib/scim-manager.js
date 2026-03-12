/**
 * SCIM Manager — user/group provisioning via SCIM 2.0 protocol,
 * connector management, and sync operations.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _users = new Map();
const _connectors = new Map();
const _syncLog = [];

const SCIM_SCHEMAS = {
  USER: "urn:ietf:params:scim:schemas:core:2.0:User",
  LIST_RESPONSE: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureSCIMTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scim_resources (
      id TEXT PRIMARY KEY,
      resource_type TEXT DEFAULT 'User',
      external_id TEXT,
      display_name TEXT,
      user_name TEXT,
      email TEXT,
      active INTEGER DEFAULT 1,
      attributes TEXT,
      source TEXT,
      provider TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scim_sync_log (
      id TEXT PRIMARY KEY,
      operation TEXT,
      resource_type TEXT,
      resource_id TEXT,
      provider TEXT,
      status TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── User Management ──────────────────────────────────────── */

export function listUsers(filter = {}) {
  let users = [..._users.values()];
  if (filter.active !== undefined) {
    users = users.filter((u) => u.active === filter.active);
  }
  const limit = filter.limit || 100;
  const startIndex = filter.startIndex || 0;
  return {
    totalResults: users.length,
    startIndex,
    itemsPerPage: limit,
    resources: users.slice(startIndex, startIndex + limit),
  };
}

export function createUser(db, userName, displayName, email) {
  if (!userName) throw new Error("Username is required");

  // Check for duplicate
  for (const u of _users.values()) {
    if (u.userName === userName)
      throw new Error(`User already exists: ${userName}`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const user = {
    id,
    userName,
    displayName: displayName || userName,
    email: email || null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  _users.set(id, user);

  db.prepare(
    `INSERT INTO scim_resources (id, resource_type, external_id, display_name, user_name, email, active, attributes, source, provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "User",
    null,
    user.displayName,
    userName,
    email,
    1,
    "{}",
    "cli",
    null,
    now,
    now,
  );

  return user;
}

export function getUser(userId) {
  const user = _users.get(userId);
  if (!user) return null;
  return user;
}

export function deleteUser(db, userId) {
  const user = _users.get(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  _users.delete(userId);

  db.prepare(`DELETE FROM scim_resources WHERE id = ?`).run(userId);

  return { success: true, userId };
}

/* ── Connector Management ─────────────────────────────────── */

export function listConnectors() {
  return [..._connectors.values()];
}

export function addConnector(db, name, provider, config) {
  if (!name) throw new Error("Connector name is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const connector = {
    id,
    name,
    provider: provider || "generic",
    config: config || {},
    status: "active",
    lastSync: null,
    createdAt: now,
  };

  _connectors.set(id, connector);

  return connector;
}

/* ── Sync Operations ──────────────────────────────────────── */

export function syncProvision(db, connectorId) {
  const connector = _connectors.get(connectorId);
  if (!connector) throw new Error(`Connector not found: ${connectorId}`);

  const now = new Date().toISOString();
  connector.lastSync = now;

  const logEntry = {
    id: crypto.randomUUID(),
    operation: "sync",
    resourceType: "User",
    resourceId: null,
    provider: connector.provider,
    status: "completed",
    details: `Synced via ${connector.name}`,
    createdAt: now,
  };

  _syncLog.push(logEntry);

  db.prepare(
    `INSERT INTO scim_sync_log (id, operation, resource_type, resource_id, provider, status, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    logEntry.id,
    logEntry.operation,
    logEntry.resourceType,
    null,
    logEntry.provider,
    logEntry.status,
    logEntry.details,
    now,
  );

  return { success: true, connector: connector.name, syncedAt: now };
}

export function getStatus() {
  return {
    users: _users.size,
    connectors: _connectors.size,
    syncOperations: _syncLog.length,
    lastSync:
      _syncLog.length > 0 ? _syncLog[_syncLog.length - 1].createdAt : null,
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _users.clear();
  _connectors.clear();
  _syncLog.length = 0;
}
