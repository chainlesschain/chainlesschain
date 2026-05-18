"use strict";

/**
 * sql.js (WASM) → better-sqlite3 风格 API 适配，让单测可在无 native dep 下跑 store.js。
 *
 * better-sqlite3 风格：
 *   db.prepare(sql)        → stmt
 *   stmt.run(...params)    → { changes, lastInsertRowid }
 *   stmt.get(...params)    → row | undefined
 *   stmt.all(...params)    → row[]
 *   db.exec(sql)           → void (multi-statement)
 *
 * sql.js 实际 API：
 *   db.prepare(sql) → SQLStatement; bind(params); step(); getAsObject(); free()
 *
 * 简化：每次 run/get/all 都临时 prepare + run + free（无 prepared-statement caching）。
 * 单测无需高频，性能足够。
 */

class SqlJsStmt {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
  }

  _normalizeParams(params) {
    // sql.js bind 需要 array 或 object — Buffer 转 Uint8Array
    return params.map((p) => {
      if (Buffer.isBuffer(p)) return new Uint8Array(p);
      return p;
    });
  }

  run(...params) {
    const stmt = this._db.prepare(this._sql);
    try {
      stmt.bind(this._normalizeParams(params));
      stmt.step();
      const changes = this._db.getRowsModified();
      return { changes, lastInsertRowid: 0 };
    } finally {
      stmt.free();
    }
  }

  get(...params) {
    const stmt = this._db.prepare(this._sql);
    try {
      stmt.bind(this._normalizeParams(params));
      const has = stmt.step();
      return has ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    const stmt = this._db.prepare(this._sql);
    try {
      stmt.bind(this._normalizeParams(params));
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
}

function adaptSqlJsDb(sqlJsDb) {
  return {
    prepare(sql) {
      return new SqlJsStmt(sqlJsDb, sql);
    },
    exec(sql) {
      sqlJsDb.exec(sql);
    },
    _raw: sqlJsDb,
  };
}

module.exports = { adaptSqlJsDb };
