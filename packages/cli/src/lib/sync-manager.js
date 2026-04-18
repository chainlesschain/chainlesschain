/**
 * Sync Manager — File and knowledge synchronization for CLI.
 * Manages sync state, conflict resolution, and push/pull operations.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Ensure sync tables exist.
 */
export function ensureSyncTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      local_version INTEGER DEFAULT 1,
      remote_version INTEGER DEFAULT 0,
      checksum TEXT,
      status TEXT DEFAULT 'pending',
      last_synced TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      local_data TEXT,
      remote_data TEXT,
      resolution TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      status TEXT DEFAULT 'success',
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Compute file checksum (SHA-256).
 */
export function computeChecksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Register a resource for syncing.
 */
export function registerResource(db, resourceType, resourceId, checksum) {
  ensureSyncTables(db);
  const id = `sync-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT OR REPLACE INTO sync_state (id, resource_type, resource_id, checksum, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, resourceType, resourceId, checksum || null, "pending");

  return { id, resourceType, resourceId, checksum, status: "pending" };
}

/**
 * Get sync state for a resource.
 */
export function getSyncState(db, resourceType, resourceId) {
  ensureSyncTables(db);
  return db
    .prepare(
      "SELECT * FROM sync_state WHERE resource_type = ? AND resource_id = ?",
    )
    .get(resourceType, resourceId);
}

/**
 * Get all sync states.
 */
export function getAllSyncStates(db, options = {}) {
  ensureSyncTables(db);
  const { status, resourceType } = options;

  let sql = "SELECT * FROM sync_state WHERE 1=1";
  const params = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (resourceType) {
    sql += " AND resource_type = ?";
    params.push(resourceType);
  }

  sql += " ORDER BY updated_at DESC";
  return db.prepare(sql).all(...params);
}

/**
 * Update sync state after push or pull.
 */
export function updateSyncState(db, id, updates) {
  ensureSyncTables(db);
  const { localVersion, remoteVersion, checksum, status, lastSynced } = updates;

  if (status) {
    db.prepare("UPDATE sync_state SET status = ? WHERE id = ?").run(status, id);
  }
  if (localVersion !== undefined) {
    db.prepare("UPDATE sync_state SET local_version = ? WHERE id = ?").run(
      localVersion,
      id,
    );
  }
  if (remoteVersion !== undefined) {
    db.prepare("UPDATE sync_state SET remote_version = ? WHERE id = ?").run(
      remoteVersion,
      id,
    );
  }
  if (checksum) {
    db.prepare("UPDATE sync_state SET checksum = ? WHERE id = ?").run(
      checksum,
      id,
    );
  }
  if (lastSynced) {
    db.prepare("UPDATE sync_state SET last_synced = ? WHERE id = ?").run(
      lastSynced,
      id,
    );
  }

  return true;
}

/**
 * Create a sync conflict record.
 */
export function createConflict(
  db,
  resourceType,
  resourceId,
  localData,
  remoteData,
) {
  ensureSyncTables(db);
  const id = `conflict-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO sync_conflicts (id, resource_type, resource_id, local_data, remote_data)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    resourceType,
    resourceId,
    typeof localData === "string" ? localData : JSON.stringify(localData),
    typeof remoteData === "string" ? remoteData : JSON.stringify(remoteData),
  );

  return { id, resourceType, resourceId, status: "unresolved" };
}

/**
 * Get unresolved conflicts.
 */
export function getConflicts(db, options = {}) {
  ensureSyncTables(db);
  const { resolved = false } = options;

  if (resolved) {
    return db
      .prepare("SELECT * FROM sync_conflicts ORDER BY created_at DESC")
      .all();
  }
  return db
    .prepare(
      "SELECT * FROM sync_conflicts WHERE resolution IS NULL ORDER BY created_at DESC",
    )
    .all();
}

/**
 * Resolve a conflict.
 */
export function resolveConflict(db, conflictId, resolution) {
  ensureSyncTables(db);
  const result = db
    .prepare(
      "UPDATE sync_conflicts SET resolution = ?, resolved_at = datetime('now') WHERE id = ?",
    )
    .run(resolution, conflictId);
  return result.changes > 0;
}

/**
 * Log a sync operation.
 */
export function logSyncOperation(
  db,
  operation,
  resourceType,
  resourceId,
  status,
  details,
) {
  ensureSyncTables(db);
  const id = `slog-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO sync_log (id, operation, resource_type, resource_id, status, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    operation,
    resourceType || null,
    resourceId || null,
    status,
    details || null,
  );

  return { id, operation, status };
}

/**
 * Get sync log entries.
 */
export function getSyncLog(db, options = {}) {
  ensureSyncTables(db);
  const { limit = 50, operation } = options;

  let sql = "SELECT * FROM sync_log";
  const params = [];

  if (operation) {
    sql += " WHERE operation = ?";
    params.push(operation);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * Get sync status summary.
 */
export function getSyncStatus(db) {
  ensureSyncTables(db);
  const total = db.prepare("SELECT COUNT(*) as c FROM sync_state").get();
  const pending = db
    .prepare("SELECT COUNT(*) as c FROM sync_state WHERE status = ?")
    .get("pending");
  const synced = db
    .prepare("SELECT COUNT(*) as c FROM sync_state WHERE status = ?")
    .get("synced");
  const conflicts = db
    .prepare(
      "SELECT COUNT(*) as c FROM sync_conflicts WHERE resolution IS NULL",
    )
    .get();

  return {
    totalResources: total?.c || 0,
    pending: pending?.c || 0,
    synced: synced?.c || 0,
    conflicts: conflicts?.c || 0,
  };
}

/**
 * Perform a push operation (mark resources as synced).
 */
export function pushResources(db, resourceType) {
  ensureSyncTables(db);
  let sql = "SELECT * FROM sync_state WHERE status = ?";
  const params = ["pending"];

  if (resourceType) {
    sql += " AND resource_type = ?";
    params.push(resourceType);
  }

  const pending = db.prepare(sql).all(...params);
  let pushed = 0;

  for (const resource of pending) {
    updateSyncState(db, resource.id, {
      status: "synced",
      remoteVersion: resource.local_version,
      lastSynced: new Date().toISOString(),
    });
    logSyncOperation(
      db,
      "push",
      resource.resource_type,
      resource.resource_id,
      "success",
    );
    pushed++;
  }

  return { pushed, total: pending.length };
}

/**
 * Perform a pull operation (check for remote updates).
 */
export function pullResources(db, resourceType) {
  ensureSyncTables(db);
  // In standalone CLI mode, pull simulates checking for remote updates
  const synced = getAllSyncStates(db, { status: "synced", resourceType });

  logSyncOperation(
    db,
    "pull",
    resourceType || null,
    null,
    "success",
    `Checked ${synced.length} resources`,
  );

  return { checked: synced.length, updated: 0 };
}

/**
 * Clear all sync data.
 */
export function clearSyncData(db) {
  ensureSyncTables(db);
  db.prepare("DELETE FROM sync_state").run();
  db.prepare("DELETE FROM sync_conflicts").run();
  db.prepare("DELETE FROM sync_log").run();
  return true;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Sync Manager governance layer.
 * Tracks tracked-resource maturity + sync-run lifecycle independent
 * of legacy registerResource/pushResources/pullResources flows above.
 * ═══════════════════════════════════════════════════════════════ */

export const RESOURCE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});

export const SYNC_RUN_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const RESOURCE_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "archived"])],
  ["active", new Set(["paused", "archived"])],
  ["paused", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const RESOURCE_TERMINALS_V2 = new Set(["archived"]);

const RUN_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["succeeded", "failed", "cancelled"])],
  ["succeeded", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);
const RUN_TERMINALS_V2 = new Set(["succeeded", "failed", "cancelled"]);

export const SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER = 200;
export const SYNC_DEFAULT_MAX_RUNNING_RUNS_PER_RESOURCE = 1;
export const SYNC_DEFAULT_RESOURCE_IDLE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const SYNC_DEFAULT_RUN_STUCK_MS = 1000 * 60 * 15; // 15 min

const _resourcesV2 = new Map();
const _runsV2 = new Map();
let _maxActiveResourcesPerOwnerV2 = SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER;
let _maxRunningRunsPerResourceV2 = SYNC_DEFAULT_MAX_RUNNING_RUNS_PER_RESOURCE;
let _resourceIdleMsV2 = SYNC_DEFAULT_RESOURCE_IDLE_MS;
let _runStuckMsV2 = SYNC_DEFAULT_RUN_STUCK_MS;

function _posIntSyncV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveResourcesPerOwnerV2() {
  return _maxActiveResourcesPerOwnerV2;
}
export function setMaxActiveResourcesPerOwnerV2(n) {
  _maxActiveResourcesPerOwnerV2 = _posIntSyncV2(
    n,
    "maxActiveResourcesPerOwner",
  );
}
export function getMaxRunningRunsPerResourceV2() {
  return _maxRunningRunsPerResourceV2;
}
export function setMaxRunningRunsPerResourceV2(n) {
  _maxRunningRunsPerResourceV2 = _posIntSyncV2(n, "maxRunningRunsPerResource");
}
export function getResourceIdleMsV2() {
  return _resourceIdleMsV2;
}
export function setResourceIdleMsV2(n) {
  _resourceIdleMsV2 = _posIntSyncV2(n, "resourceIdleMs");
}
export function getRunStuckMsV2() {
  return _runStuckMsV2;
}
export function setRunStuckMsV2(n) {
  _runStuckMsV2 = _posIntSyncV2(n, "runStuckMs");
}

export function getActiveResourceCountV2(owner) {
  let n = 0;
  for (const r of _resourcesV2.values()) {
    if (r.owner === owner && r.status === "active") n += 1;
  }
  return n;
}

export function getRunningRunCountV2(resourceId) {
  let n = 0;
  for (const j of _runsV2.values()) {
    if (j.resourceId === resourceId && j.status === "running") n += 1;
  }
  return n;
}

function _copyResV2(r) {
  return { ...r, metadata: { ...r.metadata } };
}
function _copyRunV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function registerResourceV2(
  id,
  { owner, kind, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!owner || typeof owner !== "string")
    throw new Error("owner must be a string");
  if (!kind || typeof kind !== "string")
    throw new Error("kind must be a string");
  if (_resourcesV2.has(id)) throw new Error(`resource ${id} already exists`);
  const r = {
    id,
    owner,
    kind,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _resourcesV2.set(id, r);
  return _copyResV2(r);
}

export function getResourceV2(id) {
  const r = _resourcesV2.get(id);
  return r ? _copyResV2(r) : null;
}

export function listResourcesV2({ owner, kind, status } = {}) {
  const out = [];
  for (const r of _resourcesV2.values()) {
    if (owner && r.owner !== owner) continue;
    if (kind && r.kind !== kind) continue;
    if (status && r.status !== status) continue;
    out.push(_copyResV2(r));
  }
  return out;
}

export function setResourceStatusV2(id, next, { now = Date.now() } = {}) {
  const r = _resourcesV2.get(id);
  if (!r) throw new Error(`resource ${id} not found`);
  if (!RESOURCE_TRANSITIONS_V2.has(next))
    throw new Error(`unknown resource status: ${next}`);
  if (RESOURCE_TERMINALS_V2.has(r.status))
    throw new Error(`resource ${id} is in terminal state ${r.status}`);
  const allowed = RESOURCE_TRANSITIONS_V2.get(r.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition resource from ${r.status} to ${next}`);
  if (next === "active") {
    if (r.status === "pending") {
      const count = getActiveResourceCountV2(r.owner);
      if (count >= _maxActiveResourcesPerOwnerV2)
        throw new Error(
          `owner ${r.owner} already at active-resource cap (${_maxActiveResourcesPerOwnerV2})`,
        );
    }
    if (!r.activatedAt) r.activatedAt = now;
  }
  if (next === "archived" && !r.archivedAt) r.archivedAt = now;
  r.status = next;
  r.lastSeenAt = now;
  return _copyResV2(r);
}

export function activateResourceV2(id, opts) {
  return setResourceStatusV2(id, "active", opts);
}
export function pauseResourceV2(id, opts) {
  return setResourceStatusV2(id, "paused", opts);
}
export function archiveResourceV2(id, opts) {
  return setResourceStatusV2(id, "archived", opts);
}

export function touchResourceV2(id, { now = Date.now() } = {}) {
  const r = _resourcesV2.get(id);
  if (!r) throw new Error(`resource ${id} not found`);
  r.lastSeenAt = now;
  return _copyResV2(r);
}

export function createSyncRunV2(
  id,
  { resourceId, kind = "push", metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!resourceId || typeof resourceId !== "string")
    throw new Error("resourceId must be a string");
  if (_runsV2.has(id)) throw new Error(`syncRun ${id} already exists`);
  const j = {
    id,
    resourceId,
    kind,
    status: "queued",
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    finishedAt: null,
    metadata: { ...metadata },
  };
  _runsV2.set(id, j);
  return _copyRunV2(j);
}

export function getSyncRunV2(id) {
  const j = _runsV2.get(id);
  return j ? _copyRunV2(j) : null;
}

export function listSyncRunsV2({ resourceId, status } = {}) {
  const out = [];
  for (const j of _runsV2.values()) {
    if (resourceId && j.resourceId !== resourceId) continue;
    if (status && j.status !== status) continue;
    out.push(_copyRunV2(j));
  }
  return out;
}

export function setSyncRunStatusV2(id, next, { now = Date.now() } = {}) {
  const j = _runsV2.get(id);
  if (!j) throw new Error(`syncRun ${id} not found`);
  if (!RUN_TRANSITIONS_V2.has(next))
    throw new Error(`unknown syncRun status: ${next}`);
  if (RUN_TERMINALS_V2.has(j.status))
    throw new Error(`syncRun ${id} is in terminal state ${j.status}`);
  const allowed = RUN_TRANSITIONS_V2.get(j.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition syncRun from ${j.status} to ${next}`);
  if (next === "running" && j.status === "queued") {
    const count = getRunningRunCountV2(j.resourceId);
    if (count >= _maxRunningRunsPerResourceV2)
      throw new Error(
        `resource ${j.resourceId} already at running-run cap (${_maxRunningRunsPerResourceV2})`,
      );
    if (!j.startedAt) j.startedAt = now;
  }
  if (RUN_TERMINALS_V2.has(next) && !j.finishedAt) j.finishedAt = now;
  j.status = next;
  j.lastSeenAt = now;
  return _copyRunV2(j);
}

export function startSyncRunV2(id, opts) {
  return setSyncRunStatusV2(id, "running", opts);
}
export function succeedSyncRunV2(id, opts) {
  return setSyncRunStatusV2(id, "succeeded", opts);
}
export function failSyncRunV2(id, opts) {
  return setSyncRunStatusV2(id, "failed", opts);
}
export function cancelSyncRunV2(id, opts) {
  return setSyncRunStatusV2(id, "cancelled", opts);
}

export function autoArchiveIdleResourcesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const r of _resourcesV2.values()) {
    if (r.status === "archived" || r.status === "pending") continue;
    if (now - r.lastSeenAt > _resourceIdleMsV2) {
      r.status = "archived";
      r.lastSeenAt = now;
      if (!r.archivedAt) r.archivedAt = now;
      flipped.push(_copyResV2(r));
    }
  }
  return flipped;
}

export function autoFailStuckSyncRunsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const j of _runsV2.values()) {
    if (j.status !== "running") continue;
    const ref = j.startedAt ?? j.lastSeenAt;
    if (now - ref > _runStuckMsV2) {
      j.status = "failed";
      j.lastSeenAt = now;
      if (!j.finishedAt) j.finishedAt = now;
      flipped.push(_copyRunV2(j));
    }
  }
  return flipped;
}

export function getSyncManagerStatsV2() {
  const resourcesByStatus = {};
  for (const v of Object.values(RESOURCE_MATURITY_V2)) resourcesByStatus[v] = 0;
  for (const r of _resourcesV2.values()) resourcesByStatus[r.status] += 1;

  const runsByStatus = {};
  for (const v of Object.values(SYNC_RUN_V2)) runsByStatus[v] = 0;
  for (const j of _runsV2.values()) runsByStatus[j.status] += 1;

  return {
    totalResourcesV2: _resourcesV2.size,
    totalSyncRunsV2: _runsV2.size,
    maxActiveResourcesPerOwner: _maxActiveResourcesPerOwnerV2,
    maxRunningRunsPerResource: _maxRunningRunsPerResourceV2,
    resourceIdleMs: _resourceIdleMsV2,
    runStuckMs: _runStuckMsV2,
    resourcesByStatus,
    runsByStatus,
  };
}

export function _resetStateSyncManagerV2() {
  _resourcesV2.clear();
  _runsV2.clear();
  _maxActiveResourcesPerOwnerV2 = SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER;
  _maxRunningRunsPerResourceV2 = SYNC_DEFAULT_MAX_RUNNING_RUNS_PER_RESOURCE;
  _resourceIdleMsV2 = SYNC_DEFAULT_RESOURCE_IDLE_MS;
  _runStuckMsV2 = SYNC_DEFAULT_RUN_STUCK_MS;
}
