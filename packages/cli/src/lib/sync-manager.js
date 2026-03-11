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
