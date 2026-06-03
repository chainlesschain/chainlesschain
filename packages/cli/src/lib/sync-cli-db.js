/**
 * CLI sync vault — better-sqlite3 wrapper exposing dbManager.run/all/get
 * interface matching desktop's engine deps signature.
 *
 * Phase 3c follow-up Phase 2: cc sync run requires SQLite store for cursors,
 * tombstones, and knowledge_items. CLI vault lives at
 * `~/.chainlesschain/cli-vault.db` and is plain SQLite (no SQLCipher) —
 * encryption is at the OS file-permission layer; users wanting strong
 * crypto should use desktop with hardware U-Key.
 *
 * Schema mirrors desktop `database-schema.js` for the 3 sync-relevant
 * tables (auto-initialized on first open):
 *   - knowledge_items                  user notes (source of truth for sync)
 *   - sync_external_provider_cursor    per-provider state
 *   - sync_external_tombstones         per-provider delete queue
 *   - trg_sync_ext_tombstone_on_delete trigger (auto-fan tombstone on delete)
 */

"use strict";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function _ccDir() {
  return (
    process.env.CHAINLESSCHAIN_HOME ||
    path.join(os.homedir(), ".chainlesschain")
  );
}

function _vaultPath() {
  return path.join(_ccDir(), "cli-vault.db");
}

const CLI_VAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  content TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_external_provider_cursor (
  provider_id TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT '',
  last_sync_at INTEGER NOT NULL DEFAULT 0,
  last_item_id TEXT,
  remote_etag_map TEXT NOT NULL DEFAULT '{}',
  remote_filename_map TEXT NOT NULL DEFAULT '{}',
  last_run_status TEXT,
  last_run_error TEXT,
  last_run_duration_ms INTEGER,
  items_pushed INTEGER NOT NULL DEFAULT 0,
  items_skipped INTEGER NOT NULL DEFAULT 0,
  items_deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY (provider_id, account_key)
);

CREATE TABLE IF NOT EXISTS sync_external_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  resource_type TEXT,
  deleted_at INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE(provider_id, account_key, item_id)
);

CREATE TRIGGER IF NOT EXISTS trg_sync_ext_tombstone_on_delete
AFTER DELETE ON knowledge_items
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO sync_external_tombstones
    (provider_id, account_key, item_id, resource_type, deleted_at)
  SELECT c.provider_id, c.account_key, OLD.id, 'KNOWLEDGE_ITEM',
         (strftime('%s','now') * 1000)
  FROM sync_external_provider_cursor c;
END;
`;

/**
 * Wraps better-sqlite3 Database with the {run, all, get} surface that
 * the desktop sync engine's deps.dbManager expects.
 */
class CliVaultDbManager {
  constructor(db) {
    this.db = db;
  }

  /** Match desktop dbManager.run(sql, params=[]) */
  run(sql, params = []) {
    this.db.prepare(sql).run(...params);
  }

  /** Match desktop dbManager.get(sql, params=[]) → row or undefined */
  get(sql, params = []) {
    const row = this.db.prepare(sql).get(...params);
    return row ?? undefined;
  }

  /** Match desktop dbManager.all(sql, params=[]) → rows */
  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  close() {
    if (this.db && this.db.open) this.db.close();
  }
}

/**
 * Open (or create) the CLI vault. Auto-initializes schema on first open.
 *
 * @returns {Promise<{dbManager: CliVaultDbManager, vaultPath: string}>}
 */
async function openCliVault() {
  const dir = _ccDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Lazy-import better-sqlite3 — heavy native dep, defer until run-time
  // (so the CLI doesn't even pay the require cost for non-sync commands).
  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch (err) {
    const e = new Error(
      "CLI vault requires better-sqlite3 npm package. " +
        "Run `npm install -g chainlesschain` to fetch the prebuilt binary, " +
        "or `cd packages/cli && npm install` for the dev workspace. " +
        "Underlying error: " +
        (err?.message || String(err)),
    );
    e.code = "BETTER_SQLITE3_MISSING";
    throw e;
  }

  const vp = _vaultPath();
  const db = new Database(vp);
  db.exec(CLI_VAULT_SCHEMA);
  return { dbManager: new CliVaultDbManager(db), vaultPath: vp };
}

let _ccDirOverride = null;
function _setCcDirForTest(dir) {
  _ccDirOverride = dir;
}
function _resetCcDirForTest() {
  _ccDirOverride = null;
}

// Re-wrap _ccDir/_vaultPath to honor override (test seam)
const _originalCcDir = _ccDir;
function _ccDirEffective() {
  return _ccDirOverride ?? _originalCcDir();
}
function _vaultPathEffective() {
  return path.join(_ccDirEffective(), "cli-vault.db");
}

async function openCliVaultT() {
  const dir = _ccDirEffective();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch (err) {
    const e = new Error(
      "CLI vault requires better-sqlite3 npm package: " + (err?.message || err),
    );
    e.code = "BETTER_SQLITE3_MISSING";
    throw e;
  }
  const vp = _vaultPathEffective();
  const db = new Database(vp);
  db.exec(CLI_VAULT_SCHEMA);
  return { dbManager: new CliVaultDbManager(db), vaultPath: vp };
}

export {
  openCliVaultT as openCliVault,
  CliVaultDbManager,
  CLI_VAULT_SCHEMA,
  _setCcDirForTest,
  _resetCcDirForTest,
  _vaultPathEffective as _vaultPath,
};
