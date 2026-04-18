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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — SCIM provisioning lifecycle layer.
 * Tracks identities and sync-job lifecycle independent of legacy
 * createUser/syncProvision flows above.
 * ═══════════════════════════════════════════════════════════════ */

export const IDENTITY_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  PROVISIONED: "provisioned",
  SUSPENDED: "suspended",
  DEPROVISIONED: "deprovisioned",
});

export const SYNC_JOB_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const IDENTITY_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["provisioned", "deprovisioned"])],
  ["provisioned", new Set(["suspended", "deprovisioned"])],
  ["suspended", new Set(["provisioned", "deprovisioned"])],
  ["deprovisioned", new Set()],
]);
const IDENTITY_TERMINALS_V2 = new Set(["deprovisioned"]);

const SYNC_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["succeeded", "failed", "cancelled"])],
  ["succeeded", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);
const SYNC_TERMINALS_V2 = new Set(["succeeded", "failed", "cancelled"]);

export const SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR = 1000;
export const SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR = 2;
export const SCIM_DEFAULT_IDENTITY_IDLE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
export const SCIM_DEFAULT_SYNC_STUCK_MS = 1000 * 60 * 30; // 30 min

const _identitiesV2 = new Map();
const _syncJobsV2 = new Map();
let _maxProvisionedPerConnectorV2 = SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR;
let _maxRunningSyncPerConnectorV2 = SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR;
let _identityIdleMsV2 = SCIM_DEFAULT_IDENTITY_IDLE_MS;
let _syncStuckMsV2 = SCIM_DEFAULT_SYNC_STUCK_MS;

function _posIntScimV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxProvisionedPerConnectorV2() {
  return _maxProvisionedPerConnectorV2;
}
export function setMaxProvisionedPerConnectorV2(n) {
  _maxProvisionedPerConnectorV2 = _posIntScimV2(
    n,
    "maxProvisionedPerConnector",
  );
}
export function getMaxRunningSyncPerConnectorV2() {
  return _maxRunningSyncPerConnectorV2;
}
export function setMaxRunningSyncPerConnectorV2(n) {
  _maxRunningSyncPerConnectorV2 = _posIntScimV2(
    n,
    "maxRunningSyncPerConnector",
  );
}
export function getIdentityIdleMsV2() {
  return _identityIdleMsV2;
}
export function setIdentityIdleMsV2(n) {
  _identityIdleMsV2 = _posIntScimV2(n, "identityIdleMs");
}
export function getSyncStuckMsV2() {
  return _syncStuckMsV2;
}
export function setSyncStuckMsV2(n) {
  _syncStuckMsV2 = _posIntScimV2(n, "syncStuckMs");
}

export function getProvisionedCountV2(connectorId) {
  let n = 0;
  for (const i of _identitiesV2.values()) {
    if (i.connectorId === connectorId && i.status === "provisioned") n += 1;
  }
  return n;
}

export function getRunningSyncCountV2(connectorId) {
  let n = 0;
  for (const j of _syncJobsV2.values()) {
    if (j.connectorId === connectorId && j.status === "running") n += 1;
  }
  return n;
}

function _copyIdentityV2(i) {
  return { ...i, metadata: { ...i.metadata } };
}
function _copySyncV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function registerIdentityV2(
  id,
  { connectorId, externalId, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!connectorId || typeof connectorId !== "string")
    throw new Error("connectorId must be a string");
  if (!externalId || typeof externalId !== "string")
    throw new Error("externalId must be a string");
  if (_identitiesV2.has(id)) throw new Error(`identity ${id} already exists`);
  const i = {
    id,
    connectorId,
    externalId,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    provisionedAt: null,
    deprovisionedAt: null,
    metadata: { ...metadata },
  };
  _identitiesV2.set(id, i);
  return _copyIdentityV2(i);
}

export function getIdentityV2(id) {
  const i = _identitiesV2.get(id);
  return i ? _copyIdentityV2(i) : null;
}

export function listIdentitiesV2({ connectorId, status } = {}) {
  const out = [];
  for (const i of _identitiesV2.values()) {
    if (connectorId && i.connectorId !== connectorId) continue;
    if (status && i.status !== status) continue;
    out.push(_copyIdentityV2(i));
  }
  return out;
}

export function setIdentityStatusV2(id, next, { now = Date.now() } = {}) {
  const i = _identitiesV2.get(id);
  if (!i) throw new Error(`identity ${id} not found`);
  if (!IDENTITY_TRANSITIONS_V2.has(next))
    throw new Error(`unknown identity status: ${next}`);
  if (IDENTITY_TERMINALS_V2.has(i.status))
    throw new Error(`identity ${id} is in terminal state ${i.status}`);
  const allowed = IDENTITY_TRANSITIONS_V2.get(i.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition identity from ${i.status} to ${next}`);
  if (next === "provisioned") {
    if (i.status === "pending") {
      const count = getProvisionedCountV2(i.connectorId);
      if (count >= _maxProvisionedPerConnectorV2)
        throw new Error(
          `connector ${i.connectorId} already at provisioned cap (${_maxProvisionedPerConnectorV2})`,
        );
    }
    if (!i.provisionedAt) i.provisionedAt = now;
  }
  if (next === "deprovisioned" && !i.deprovisionedAt) i.deprovisionedAt = now;
  i.status = next;
  i.lastSeenAt = now;
  return _copyIdentityV2(i);
}

export function provisionIdentityV2(id, opts) {
  return setIdentityStatusV2(id, "provisioned", opts);
}
export function suspendIdentityV2(id, opts) {
  return setIdentityStatusV2(id, "suspended", opts);
}
export function deprovisionIdentityV2(id, opts) {
  return setIdentityStatusV2(id, "deprovisioned", opts);
}

export function touchIdentityV2(id, { now = Date.now() } = {}) {
  const i = _identitiesV2.get(id);
  if (!i) throw new Error(`identity ${id} not found`);
  i.lastSeenAt = now;
  return _copyIdentityV2(i);
}

export function createSyncJobV2(
  id,
  { connectorId, kind = "full", metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!connectorId || typeof connectorId !== "string")
    throw new Error("connectorId must be a string");
  if (_syncJobsV2.has(id)) throw new Error(`syncJob ${id} already exists`);
  const j = {
    id,
    connectorId,
    kind,
    status: "queued",
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    finishedAt: null,
    metadata: { ...metadata },
  };
  _syncJobsV2.set(id, j);
  return _copySyncV2(j);
}

export function getSyncJobV2(id) {
  const j = _syncJobsV2.get(id);
  return j ? _copySyncV2(j) : null;
}

export function listSyncJobsV2({ connectorId, status } = {}) {
  const out = [];
  for (const j of _syncJobsV2.values()) {
    if (connectorId && j.connectorId !== connectorId) continue;
    if (status && j.status !== status) continue;
    out.push(_copySyncV2(j));
  }
  return out;
}

export function setSyncJobStatusV2(id, next, { now = Date.now() } = {}) {
  const j = _syncJobsV2.get(id);
  if (!j) throw new Error(`syncJob ${id} not found`);
  if (!SYNC_TRANSITIONS_V2.has(next))
    throw new Error(`unknown syncJob status: ${next}`);
  if (SYNC_TERMINALS_V2.has(j.status))
    throw new Error(`syncJob ${id} is in terminal state ${j.status}`);
  const allowed = SYNC_TRANSITIONS_V2.get(j.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition syncJob from ${j.status} to ${next}`);
  if (next === "running" && j.status === "queued") {
    const count = getRunningSyncCountV2(j.connectorId);
    if (count >= _maxRunningSyncPerConnectorV2)
      throw new Error(
        `connector ${j.connectorId} already at running-sync cap (${_maxRunningSyncPerConnectorV2})`,
      );
    if (!j.startedAt) j.startedAt = now;
  }
  if (SYNC_TERMINALS_V2.has(next) && !j.finishedAt) j.finishedAt = now;
  j.status = next;
  j.lastSeenAt = now;
  return _copySyncV2(j);
}

export function startSyncJobV2(id, opts) {
  return setSyncJobStatusV2(id, "running", opts);
}
export function succeedSyncJobV2(id, opts) {
  return setSyncJobStatusV2(id, "succeeded", opts);
}
export function failSyncJobV2(id, opts) {
  return setSyncJobStatusV2(id, "failed", opts);
}
export function cancelSyncJobV2(id, opts) {
  return setSyncJobStatusV2(id, "cancelled", opts);
}

export function autoDeprovisionIdleIdentitiesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const i of _identitiesV2.values()) {
    if (i.status === "deprovisioned" || i.status === "pending") continue;
    if (now - i.lastSeenAt > _identityIdleMsV2) {
      i.status = "deprovisioned";
      i.lastSeenAt = now;
      if (!i.deprovisionedAt) i.deprovisionedAt = now;
      flipped.push(_copyIdentityV2(i));
    }
  }
  return flipped;
}

export function autoFailStuckSyncJobsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const j of _syncJobsV2.values()) {
    if (j.status !== "running") continue;
    const ref = j.startedAt ?? j.lastSeenAt;
    if (now - ref > _syncStuckMsV2) {
      j.status = "failed";
      j.lastSeenAt = now;
      if (!j.finishedAt) j.finishedAt = now;
      flipped.push(_copySyncV2(j));
    }
  }
  return flipped;
}

export function getScimManagerStatsV2() {
  const identitiesByStatus = {};
  for (const v of Object.values(IDENTITY_LIFECYCLE_V2))
    identitiesByStatus[v] = 0;
  for (const i of _identitiesV2.values()) identitiesByStatus[i.status] += 1;

  const syncJobsByStatus = {};
  for (const v of Object.values(SYNC_JOB_V2)) syncJobsByStatus[v] = 0;
  for (const j of _syncJobsV2.values()) syncJobsByStatus[j.status] += 1;

  return {
    totalIdentitiesV2: _identitiesV2.size,
    totalSyncJobsV2: _syncJobsV2.size,
    maxProvisionedPerConnector: _maxProvisionedPerConnectorV2,
    maxRunningSyncPerConnector: _maxRunningSyncPerConnectorV2,
    identityIdleMs: _identityIdleMsV2,
    syncStuckMs: _syncStuckMsV2,
    identitiesByStatus,
    syncJobsByStatus,
  };
}

export function _resetStateScimManagerV2() {
  _identitiesV2.clear();
  _syncJobsV2.clear();
  _maxProvisionedPerConnectorV2 = SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR;
  _maxRunningSyncPerConnectorV2 = SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR;
  _identityIdleMsV2 = SCIM_DEFAULT_IDENTITY_IDLE_MS;
  _syncStuckMsV2 = SCIM_DEFAULT_SYNC_STUCK_MS;
}
