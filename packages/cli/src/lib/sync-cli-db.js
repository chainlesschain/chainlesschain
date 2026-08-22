/**
 * CLI sync vault. The native better-sqlite3 driver is preferred, with a
 * sql.js fallback for installations where an optional native addon cannot
 * load. Both backends use the same strict per-operation file lock so a WASM
 * snapshot can never overwrite a newer vault written by another cc process.
 */

"use strict";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ensureDir, getHomeDir } from "./paths.js";
import { ensurePrivateFile } from "./secure-fs.js";
import { withFileLock } from "./with-file-lock.js";

const requireCjs = createRequire(import.meta.url);

const CLI_VAULT_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS knowledge_items (",
  "  id TEXT PRIMARY KEY,",
  "  title TEXT NOT NULL,",
  "  type TEXT NOT NULL DEFAULT 'note',",
  "  content TEXT,",
  "  tags TEXT,",
  "  created_at INTEGER NOT NULL,",
  "  updated_at INTEGER NOT NULL",
  ");",
  "",
  "CREATE TABLE IF NOT EXISTS sync_external_provider_cursor (",
  "  provider_id TEXT NOT NULL,",
  "  account_key TEXT NOT NULL DEFAULT '',",
  "  last_sync_at INTEGER NOT NULL DEFAULT 0,",
  "  last_item_id TEXT,",
  "  remote_etag_map TEXT NOT NULL DEFAULT '{}',",
  "  remote_filename_map TEXT NOT NULL DEFAULT '{}',",
  "  last_run_status TEXT,",
  "  last_run_error TEXT,",
  "  last_run_duration_ms INTEGER,",
  "  items_pushed INTEGER NOT NULL DEFAULT 0,",
  "  items_skipped INTEGER NOT NULL DEFAULT 0,",
  "  items_deleted INTEGER NOT NULL DEFAULT 0,",
  "  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),",
  "  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),",
  "  PRIMARY KEY (provider_id, account_key)",
  ");",
  "",
  "CREATE TABLE IF NOT EXISTS sync_external_tombstones (",
  "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
  "  provider_id TEXT NOT NULL,",
  "  account_key TEXT NOT NULL DEFAULT '',",
  "  item_id TEXT NOT NULL,",
  "  resource_type TEXT,",
  "  deleted_at INTEGER NOT NULL,",
  "  retry_count INTEGER NOT NULL DEFAULT 0,",
  "  last_error TEXT,",
  "  UNIQUE(provider_id, account_key, item_id)",
  ");",
  "",
  "CREATE TRIGGER IF NOT EXISTS trg_sync_ext_tombstone_on_delete",
  "AFTER DELETE ON knowledge_items",
  "FOR EACH ROW",
  "BEGIN",
  "  INSERT OR IGNORE INTO sync_external_tombstones",
  "    (provider_id, account_key, item_id, resource_type, deleted_at)",
  "  SELECT c.provider_id, c.account_key, OLD.id, 'KNOWLEDGE_ITEM',",
  "         (strftime('%s','now') * 1000)",
  "  FROM sync_external_provider_cursor c;",
  "END;",
].join("\n");

const VAULT_LOCK_OPTIONS = Object.freeze({
  failIfUnavailable: true,
  timeoutMs: 3000,
  retryMs: 25,
  maxRetryMs: 150,
  retryJitterMs: 25,
  yieldAfterReleaseMs: 5,
});

const defaultDeps = Object.freeze({
  fs,
  ensureDir,
  ensurePrivateFile,
  randomUUID,
  withFileLock,
  platform: () => process.platform,
  async loadNativeDatabase() {
    return requireCjs("better-sqlite3");
  },
  async loadSqlJs() {
    return requireCjs("sql.js");
  },
});

/**
 * Injectable only for focused driver-loading tests. Production callers must
 * leave these dependencies at their secure defaults.
 */
const _deps = { ...defaultDeps };

let _ccDirOverride = null;

function _ccDir() {
  return _ccDirOverride ?? getHomeDir();
}

function _vaultPath() {
  return path.join(_ccDir(), "cli-vault.db");
}

function vaultError(code, message, cause) {
  const error = cause ? new Error(message, { cause }) : new Error(message);
  error.code = code;
  return error;
}

function isVaultLockFailure(error) {
  return [
    "STATE_LOCK_UNAVAILABLE",
    "STATE_LOCK_OWNERSHIP_LOST",
    "STATE_LOCK_RELEASE_HANDOFF_FAILED",
  ].includes(error?.code);
}

function withVaultLock(vaultPath, callback) {
  try {
    return _deps.withFileLock(vaultPath, callback, VAULT_LOCK_OPTIONS);
  } catch (error) {
    if (isVaultLockFailure(error)) {
      throw vaultError(
        "CLI_VAULT_LOCK_UNAVAILABLE",
        "CLI vault is busy and could not acquire its exclusive state lock. Retry the sync after the other ChainlessChain process finishes.",
        error,
      );
    }
    throw error;
  }
}

function ensureVaultDirectory(directory) {
  _deps.ensureDir(directory);
}

function ensureVaultFile(vaultPath) {
  _deps.ensurePrivateFile(vaultPath, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
}

function nativeSqliteSidecarPaths(vaultPath) {
  return [vaultPath + "-wal", vaultPath + "-shm", vaultPath + "-journal"];
}

function assertNoNativeSqliteSidecars(vaultPath) {
  const sidecar = nativeSqliteSidecarPaths(vaultPath).find((candidate) =>
    _deps.fs.existsSync(candidate),
  );
  if (sidecar) {
    throw vaultError(
      "CLI_VAULT_WASM_NATIVE_CONCURRENCY_UNSAFE",
      "CLI vault has an active native SQLite journal. Refusing the sql.js fallback because concurrent native access could lose vault updates. Close the other SQLite user and retry.",
    );
  }
}

function syncVaultDirectory(vaultPath) {
  let descriptor = null;
  try {
    descriptor = _deps.fs.openSync(path.dirname(vaultPath), "r");
    _deps.fs.fsyncSync(descriptor);
  } catch (error) {
    // Windows does not consistently permit directory fsync. The staged file
    // itself is always fsynced before rename, so retain the platform-specific
    // best effort used by the repository's other durable stores.
    if (
      _deps.platform() !== "win32" ||
      !["EACCES", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)
    ) {
      throw error;
    }
  } finally {
    if (descriptor != null) _deps.fs.closeSync(descriptor);
  }
}

function persistSqlJsBytes(vaultPath, bytes) {
  const temporary = path.join(
    path.dirname(vaultPath),
    "." +
      path.basename(vaultPath) +
      "." +
      process.pid +
      "." +
      _deps.randomUUID() +
      ".tmp",
  );
  let descriptor = null;
  try {
    descriptor = _deps.fs.openSync(temporary, "wx", 0o600);
    // The parent is already private. Repair this file before it receives
    // database content so a Windows inherited ACL can never expose a staging
    // snapshot during the write window.
    _deps.ensurePrivateFile(temporary, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
    _deps.fs.writeFileSync(descriptor, bytes);
    _deps.fs.fsyncSync(descriptor);
    _deps.fs.closeSync(descriptor);
    descriptor = null;

    // Verify a pre-existing destination before replacement. The strict lock
    // serializes cooperating cc processes; this check additionally refuses a
    // symlink or broad ACL introduced by a local filesystem race.
    ensureVaultFile(vaultPath);
    _deps.fs.renameSync(temporary, vaultPath);
    ensureVaultFile(vaultPath);
    syncVaultDirectory(vaultPath);
  } catch (error) {
    if (error?.code?.startsWith("CLI_VAULT_")) throw error;
    throw vaultError(
      "CLI_VAULT_WASM_WRITE_FAILED",
      "Could not atomically persist the sql.js CLI vault. No further sync work was performed.",
      error,
    );
  } finally {
    if (descriptor != null) {
      try {
        _deps.fs.closeSync(descriptor);
      } catch {
        // Preserve the primary write failure.
      }
    }
    try {
      if (_deps.fs.existsSync(temporary)) {
        _deps.fs.rmSync(temporary, { force: true });
      }
    } catch {
      // A uniquely named stale temp cannot be selected as the vault.
    }
  }
}

function openSqlJsDatabase(SQL, vaultPath) {
  if (_deps.fs.existsSync(vaultPath)) {
    ensureVaultFile(vaultPath);
    return new SQL.Database(_deps.fs.readFileSync(vaultPath));
  }
  return new SQL.Database();
}

function runSqlJsStatement(sqlDb, sql, params) {
  const statement = sqlDb.prepare(sql);
  try {
    statement.bind(params);
    statement.step();
    return {
      changes: sqlDb.getRowsModified(),
      lastInsertRowid: 0,
    };
  } finally {
    statement.free();
  }
}

function getSqlJsStatement(sqlDb, sql, params) {
  const statement = sqlDb.prepare(sql);
  try {
    statement.bind(params);
    return statement.step() ? statement.getAsObject() : undefined;
  } finally {
    statement.free();
  }
}

function allSqlJsStatement(sqlDb, sql, params) {
  const statement = sqlDb.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function closedVaultError() {
  return vaultError("CLI_VAULT_CLOSED", "CLI vault handle is already closed.");
}

/**
 * Existing direct wrapper retained for users that already supply a
 * better-sqlite3-compatible database object.
 */
class CliVaultDbManager {
  constructor(db) {
    this.db = db;
  }

  run(sql, params = []) {
    this.db.prepare(sql).run(...params);
  }

  get(sql, params = []) {
    const row = this.db.prepare(sql).get(...params);
    return row ?? undefined;
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  close() {
    if (this.db && this.db.open) this.db.close();
  }
}

/**
 * Native connections reopen under the shared vault lock for every operation.
 * This is intentional: a sql.js writer atomically replaces the database file,
 * so retaining a native descriptor across calls could otherwise write to the
 * old, unlinked inode after a fallback operation.
 */
class SerializedNativeCliVaultDbManager {
  constructor(vaultPath, Database) {
    this.vaultPath = vaultPath;
    this.Database = Database;
    this.backend = "better-sqlite3";
    this.closed = false;
  }

  _withDatabase(callback) {
    if (this.closed) throw closedVaultError();
    return withVaultLock(this.vaultPath, () => {
      ensureVaultFile(this.vaultPath);
      const db = new this.Database(this.vaultPath);
      try {
        return callback(db);
      } finally {
        if (db?.open) db.close();
      }
    });
  }

  run(sql, params = []) {
    this._withDatabase((db) => db.prepare(sql).run(...params));
  }

  get(sql, params = []) {
    return this._withDatabase((db) => {
      const row = db.prepare(sql).get(...params);
      return row ?? undefined;
    });
  }

  all(sql, params = []) {
    return this._withDatabase((db) => db.prepare(sql).all(...params));
  }

  close() {
    this.closed = true;
  }
}

/**
 * sql.js has no filesystem locking. Each operation therefore opens the latest
 * committed bytes while holding the same strict lock as the native backend.
 * Writes export, fsync and atomically rename before releasing that lock.
 */
class SerializedSqlJsCliVaultDbManager {
  constructor(vaultPath, SQL) {
    this.vaultPath = vaultPath;
    this.SQL = SQL;
    this.backend = "sql.js";
    this.closed = false;
  }

  _withDatabase(write, callback) {
    if (this.closed) throw closedVaultError();
    return withVaultLock(this.vaultPath, () => {
      assertNoNativeSqliteSidecars(this.vaultPath);
      const db = openSqlJsDatabase(this.SQL, this.vaultPath);
      try {
        const result = callback(db);
        if (write) {
          const bytes = Buffer.from(db.export());
          persistSqlJsBytes(this.vaultPath, bytes);
        }
        return result;
      } finally {
        db.close();
      }
    });
  }

  run(sql, params = []) {
    this._withDatabase(true, (db) => runSqlJsStatement(db, sql, params));
  }

  get(sql, params = []) {
    return this._withDatabase(false, (db) =>
      getSqlJsStatement(db, sql, params),
    );
  }

  all(sql, params = []) {
    return this._withDatabase(false, (db) =>
      allSqlJsStatement(db, sql, params),
    );
  }

  close() {
    this.closed = true;
  }
}

function initializeNativeVault(vaultPath, Database) {
  withVaultLock(vaultPath, () => {
    ensureVaultFile(vaultPath);
    const db = new Database(vaultPath);
    try {
      db.exec(CLI_VAULT_SCHEMA);
    } finally {
      if (db?.open) db.close();
    }
    ensureVaultFile(vaultPath);
  });
}

function initializeSqlJsVault(vaultPath, SQL) {
  withVaultLock(vaultPath, () => {
    assertNoNativeSqliteSidecars(vaultPath);
    const db = openSqlJsDatabase(SQL, vaultPath);
    try {
      db.exec(CLI_VAULT_SCHEMA);
      persistSqlJsBytes(vaultPath, Buffer.from(db.export()));
    } finally {
      db.close();
    }
  });
}

async function loadSqlJsFallback(vaultPath, nativeError) {
  let initialize;
  try {
    initialize = await _deps.loadSqlJs();
  } catch (error) {
    throw vaultError(
      "CLI_VAULT_SQLJS_UNAVAILABLE",
      "CLI vault could not load better-sqlite3 and its sql.js fallback is unavailable. Reinstall ChainlessChain with its runtime dependencies.",
      error,
    );
  }

  let SQL;
  try {
    SQL = await initialize();
  } catch (error) {
    throw vaultError(
      "CLI_VAULT_SQLJS_UNAVAILABLE",
      "CLI vault could not initialize its sql.js fallback. Reinstall ChainlessChain with its runtime dependencies.",
      error,
    );
  }
  if (!SQL || typeof SQL.Database !== "function") {
    throw vaultError(
      "CLI_VAULT_SQLJS_UNAVAILABLE",
      "CLI vault sql.js fallback did not provide a SQLite database constructor.",
      nativeError,
    );
  }

  try {
    initializeSqlJsVault(vaultPath, SQL);
  } catch (error) {
    if (error?.code?.startsWith("CLI_VAULT_")) throw error;
    throw vaultError(
      "CLI_VAULT_WASM_OPEN_FAILED",
      "Could not open the sql.js CLI vault. Check the vault file permissions and integrity.",
      error,
    );
  }
  return {
    dbManager: new SerializedSqlJsCliVaultDbManager(vaultPath, SQL),
    vaultPath,
    backend: "sql.js",
  };
}

async function openCliVault() {
  const directory = _ccDir();
  ensureVaultDirectory(directory);
  const vaultPath = _vaultPath();

  let Database;
  let nativeError = null;
  try {
    Database = await _deps.loadNativeDatabase();
    if (typeof Database !== "function") {
      throw new TypeError(
        "better-sqlite3 did not export a database constructor",
      );
    }
    // A memory probe distinguishes an unavailable native binding from a vault
    // schema/permission failure. The latter must remain visible and must not
    // silently switch backends.
    const probe = new Database(":memory:");
    if (probe?.open) probe.close();
  } catch (error) {
    nativeError = error;
  }

  if (!nativeError) {
    initializeNativeVault(vaultPath, Database);
    return {
      dbManager: new SerializedNativeCliVaultDbManager(vaultPath, Database),
      vaultPath,
      backend: "better-sqlite3",
    };
  }
  return loadSqlJsFallback(vaultPath, nativeError);
}

function _setCcDirForTest(directory) {
  _ccDirOverride = directory;
}

function _resetCcDirForTest() {
  _ccDirOverride = null;
}

function _resetDepsForTest() {
  for (const key of Object.keys(_deps)) delete _deps[key];
  Object.assign(_deps, defaultDeps);
}

export {
  openCliVault,
  CliVaultDbManager,
  CLI_VAULT_SCHEMA,
  _deps,
  _setCcDirForTest,
  _resetCcDirForTest,
  _resetDepsForTest,
  _vaultPath,
};
