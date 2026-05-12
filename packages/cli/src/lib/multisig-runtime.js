/**
 * v1.2 m-of-n Phase 2 — shared multisig DB + manager loader.
 *
 * Phase 1 inlined this in commands/multisig.js. Phase 2 marketplace mediator
 * also needs it (cc marketplace purchase / consume), so factor out here.
 *
 * SQLite driver cascade: better-sqlite3-multiple-ciphers → better-sqlite3 →
 * sql.js (WASM) per feedback_sqlite_wasm_fallback memo. sql.js gets a
 * better-sqlite3-style adapter for the subset core-multisig/store.js needs.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import multisig from "@chainlesschain/core-multisig";
import { getHomeDir } from "./paths.js";

const requireCjs = createRequire(import.meta.url);

const {
  applySchema,
  createStore,
  createProposalsManager,
  appendGovernanceEvent,
} = multisig;

export function defaultMultisigDbPath() {
  return path.join(getHomeDir(), "multisig.db");
}

export function defaultMultisigLogPath() {
  return path.join(getHomeDir(), "multisig.governance.log");
}

async function _openDatabase(dbPath) {
  for (const pkg of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    try {
      const Database = requireCjs(pkg);
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      return { kind: "native", db, close: () => db.close() };
    } catch (_e) {
      /* try next */
    }
  }
  const initSqlJs = requireCjs("sql.js");
  const SQL = await initSqlJs();
  const buf = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  const sqlDb = new SQL.Database(buf);
  return {
    kind: "wasm",
    db: _adaptSqlJs(sqlDb),
    close: () => {
      const out = sqlDb.export();
      fs.writeFileSync(dbPath, Buffer.from(out));
      sqlDb.close();
    },
  };
}

function _adaptSqlJs(sqlDb) {
  const norm = (params) =>
    params.map((p) => (Buffer.isBuffer(p) ? new Uint8Array(p) : p));
  return {
    prepare(sql) {
      return {
        run(...params) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(norm(params));
            stmt.step();
            return { changes: sqlDb.getRowsModified(), lastInsertRowid: 0 };
          } finally {
            stmt.free();
          }
        },
        get(...params) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(norm(params));
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(norm(params));
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    },
    exec(sql) {
      sqlDb.exec(sql);
    },
  };
}

/**
 * Open a multisig manager backed by SQLite + governance log.
 *
 * @param {string} [dbPath]
 * @param {string} [logPath]
 * @returns {Promise<{ db, store, mgr, close }>}
 */
export async function openMultisigManager(
  dbPath = defaultMultisigDbPath(),
  logPath = defaultMultisigLogPath(),
) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const handle = await _openDatabase(dbPath);
  applySchema(handle.db);
  const store = createStore(handle.db);
  const mgr = createProposalsManager(store, {
    logEvent: (event) => appendGovernanceEvent(logPath, event),
  });
  return {
    db: handle.db,
    store,
    mgr,
    close: handle.close,
  };
}

/**
 * Read a secret key from hex string or hex file path.
 *
 * @param {string} arg
 * @returns {Buffer}
 */
export function readSecretKey(arg) {
  if (!arg) {
    throw new Error("--key required (hex string or path to hex file)");
  }
  if (/^[0-9a-fA-F]+$/.test(arg)) {
    return Buffer.from(arg, "hex");
  }
  if (fs.existsSync(arg)) {
    const raw = fs.readFileSync(arg, "utf-8").trim();
    return Buffer.from(raw, "hex");
  }
  throw new Error(`--key: not hex and not an existing file path: ${arg}`);
}

/**
 * Read JSON from inline string or file path.
 */
export function readJsonArg(arg) {
  if (fs.existsSync(arg)) {
    return JSON.parse(fs.readFileSync(arg, "utf-8"));
  }
  return JSON.parse(arg);
}
