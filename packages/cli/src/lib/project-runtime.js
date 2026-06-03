/**
 * v1.3+ #21 P1 — `cc project` CLI 共享 runtime。
 *
 * 设计目标 (per v1.2 GA 反馈 "目标在手机端做ai项目的交互要像在电脑端那样丝滑"):
 *   CLI 直接读写 desktop app 的 chainlesschain.db, init/list/delete 立刻在
 *   desktop UI 出现, Phase 3d sync 同步到手机端 — 无中间层延迟。
 *
 * DB 路径解析: 跟随 Electron app.getPath("userData") 约定:
 *   Windows: %APPDATA%/chainlesschain-desktop-vue/data/chainlesschain.db
 *   macOS:   ~/Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db
 *   Linux:   ~/.config/chainlesschain-desktop-vue/data/chainlesschain.db
 *
 * SQLite driver cascade (per memory feedback_sqlite_wasm_fallback):
 *   better-sqlite3-multiple-ciphers → better-sqlite3 → sql.js (WASM)
 *
 * 并发: desktop app 运行时也开同一 DB, 走 WAL mode 允许多读单写, 短查询无冲突。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

/** Mirror Electron userData resolution for desktop-app-vue. */
export function defaultDesktopUserDataDir() {
  const home = os.homedir();
  const productName = "chainlesschain-desktop-vue";
  switch (process.platform) {
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(home, "AppData", "Roaming"),
        productName,
      );
    case "darwin":
      return path.join(home, "Library", "Application Support", productName);
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
        productName,
      );
  }
}

/** Desktop SQLite DB path (shared with desktop app). */
export function defaultProjectDbPath() {
  return path.join(defaultDesktopUserDataDir(), "data", "chainlesschain.db");
}

async function _openDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    const e = new Error(
      `Desktop DB not found at: ${dbPath}\n` +
        `Has the desktop app ever been launched? It creates the DB on first run.`,
    );
    e.code = "DB_NOT_FOUND";
    throw e;
  }
  for (const pkg of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    try {
      const Database = requireCjs(pkg);
      const db = new Database(dbPath);
      // WAL mode: desktop app may be running concurrently. WAL allows
      // multiple readers + one writer with no contention for short ops.
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      return { kind: "native", db, close: () => db.close() };
    } catch (_e) {
      /* try next */
    }
  }
  const initSqlJs = requireCjs("sql.js");
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const sqlDb = new SQL.Database(buf);
  return {
    kind: "wasm",
    db: _adaptSqlJs(sqlDb),
    close: () => {
      // WASM: write back on close. Desktop should be closed to avoid race.
      const out = sqlDb.export();
      fs.writeFileSync(dbPath, Buffer.from(out));
      sqlDb.close();
    },
  };
}

function _adaptSqlJs(sqlDb) {
  return {
    prepare(sql) {
      return {
        run(...params) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(params);
            stmt.step();
            return { changes: sqlDb.getRowsModified(), lastInsertRowid: 0 };
          } finally {
            stmt.free();
          }
        },
        get(...params) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(params);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params) {
          const stmt = sqlDb.prepare(sql);
          try {
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    },
    pragma() {
      // sql.js doesn't support pragmas via prepare; quietly ignore.
    },
    exec(sql) {
      sqlDb.exec(sql);
    },
  };
}

/** Generate a project ID matching the desktop convention (UUID v4). */
export function newProjectId() {
  // Node 14.17+ ships crypto.randomUUID; no extra dep needed.
  const crypto = requireCjs("node:crypto");
  return crypto.randomUUID();
}

/**
 * Open the desktop SQLite DB and return { db, close }.
 *
 * @param {string} [dbPath]  Override DB path (default: desktop userData db)
 * @returns {Promise<{ db, close }>}
 */
export async function openProjectsDb(dbPath = defaultProjectDbPath()) {
  return _openDatabase(dbPath);
}

/** Valid project_type values (matches CHECK constraint in projects table). */
export const VALID_PROJECT_TYPES = [
  "web",
  "document",
  "data",
  "app",
  "presentation",
  "spreadsheet",
  "design",
  "code",
  "workflow",
  "knowledge",
];

/** Valid project statuses. */
export const VALID_PROJECT_STATUSES = [
  "draft",
  "active",
  "completed",
  "archived",
];
