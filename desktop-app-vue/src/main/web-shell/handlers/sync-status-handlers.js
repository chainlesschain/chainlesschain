/**
 * `sync.*` (核心同步) WS handlers — Phase 3b web-shell parity (2026-05-06).
 *
 * 暴露 5 个 topic 给 web-panel：
 *   sync.status      → getSyncStatus(db)
 *   sync.push        → pushResources(db, resourceType?)
 *   sync.pull        → pullResources(db, resourceType?)
 *   sync.conflicts   → getConflicts(db, { resolved })
 *   sync.resolve     → resolveConflict(db, conflictId, side)
 *
 * 为什么不用 ws.execute('sync status …')：
 *   spawn cc CLI 子进程会再开一份 better-sqlite3 连接到同一 chainlesschain.db，
 *   Windows + WAL 下并发独占失败 → cli 报 "database disk image is malformed"。
 *   走 in-process WS topic 共用 main 已开的 db handle，零冲突。
 *
 * sync-manager.js 是 ESM（packages/cli/src/lib/），handler 是 CJS：用 dynamic
 * import + 模块级缓存（首次 await 后复用）。pathToFileURL 同 web-ui-loader.js。
 *
 * database 可能为 null（pre-bootstrap）— 各 handler 返回结构化错误而不抛，
 * 避免 ws-cli-loader 把 dispatcher 给 trip 掉。
 */

const path = require("path");
const { pathToFileURL } = require("url");

const SYNC_MANAGER_REL = "../../../../../packages/cli/src/lib/sync-manager.js";

let _syncManagerPromise = null;
function loadSyncManager() {
  if (!_syncManagerPromise) {
    const moduleUrl = pathToFileURL(
      path.resolve(__dirname, SYNC_MANAGER_REL),
    ).href;
    _syncManagerPromise = import(moduleUrl);
  }
  return _syncManagerPromise;
}

function _getDb(database) {
  if (!database || typeof database.getDatabase !== "function") {
    return null;
  }
  try {
    return database.getDatabase();
  } catch {
    return null;
  }
}

function createSyncStatusHandler({ database }) {
  return async function syncStatusHandler() {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    try {
      const { getSyncStatus } = await loadSyncManager();
      const status = getSyncStatus(db);
      return { success: true, ...status };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createSyncPushHandler({ database }) {
  return async function syncPushHandler(frame = {}) {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    try {
      const { pushResources } = await loadSyncManager();
      const result = pushResources(db, frame?.resourceType || null);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createSyncPullHandler({ database }) {
  return async function syncPullHandler(frame = {}) {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    try {
      const { pullResources } = await loadSyncManager();
      const result = pullResources(db, frame?.resourceType || null);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createSyncConflictsHandler({ database }) {
  return async function syncConflictsHandler(frame = {}) {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    try {
      const { getConflicts } = await loadSyncManager();
      const conflicts = getConflicts(db, {
        resolved: !!frame?.includeResolved,
      });
      return { success: true, conflicts };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createSyncResolveHandler({ database }) {
  return async function syncResolveHandler(frame = {}) {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    const { conflictId, side } = frame || {};
    if (!conflictId || typeof conflictId !== "string") {
      return { success: false, error: "缺少 conflictId" };
    }
    if (side !== "local" && side !== "remote") {
      return { success: false, error: "side 必须是 local 或 remote" };
    }
    try {
      const { resolveConflict } = await loadSyncManager();
      const ok = resolveConflict(db, conflictId, side);
      if (!ok) {
        return { success: false, error: "冲突不存在或已解决: " + conflictId };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createSyncStatusHandlers({ database } = {}) {
  return {
    "sync.status": createSyncStatusHandler({ database }),
    "sync.push": createSyncPushHandler({ database }),
    "sync.pull": createSyncPullHandler({ database }),
    "sync.conflicts": createSyncConflictsHandler({ database }),
    "sync.resolve": createSyncResolveHandler({ database }),
  };
}

module.exports = {
  createSyncStatusHandlers,
  createSyncStatusHandler,
  createSyncPushHandler,
  createSyncPullHandler,
  createSyncConflictsHandler,
  createSyncResolveHandler,
};
