"use strict";

/**
 * sql.js (WASM) → better-sqlite3 风格 API 适配，让单测无 native dep 即可跑。
 * （与 core-multisig 同款 helper。）
 */

class SqlJsStmt {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
  }
  _normalizeParams(params) {
    return params.map((p) => (Buffer.isBuffer(p) ? new Uint8Array(p) : p));
  }
  run(...params) {
    const stmt = this._db.prepare(this._sql);
    try {
      stmt.bind(this._normalizeParams(params));
      stmt.step();
      return { changes: this._db.getRowsModified(), lastInsertRowid: 0 };
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
      while (stmt.step()) rows.push(stmt.getAsObject());
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
