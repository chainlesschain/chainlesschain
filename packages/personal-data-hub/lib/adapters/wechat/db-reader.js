/**
 * Phase 12 v0.5 — WeChat SQLCipher DB reader (frida-INDEPENDENT).
 *
 * Opens the decrypted-via-MD5-key EnMicroMsg.db using
 * better-sqlite3-multiple-ciphers (the same package LocalVault uses).
 *
 * Note about the key flow:
 *   - For WeChat < 8.0: key comes from KeyExtractor (MD5(IMEI+UIN)[:7]).
 *   - For WeChat 8.0+ : key comes from Frida hook (Phase 12.6). DI seam
 *     `keyProvider.getKey()` lets both paths plug in cleanly.
 *
 * SQLCipher PRAGMA settings per design doc + sjqz reference:
 *   PRAGMA cipher_default_kdf_iter = 4000;
 *   PRAGMA cipher_default_use_hmac = OFF;
 *   PRAGMA cipher_compatibility = 1;  // WCDB legacy SQLCipher v1 layout
 *
 * Different WeChat builds use different SQLCipher params — we try a few
 * standard ones in order via tryOpen().
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const KNOWN_PRAGMA_PROFILES = [
  // WCDB legacy (most common, WeChat < 8.0)
  {
    name: "wcdb-legacy",
    pragmas: [
      "PRAGMA cipher_compatibility = 1",
      "PRAGMA cipher_default_kdf_iter = 4000",
      "PRAGMA cipher_default_use_hmac = OFF",
      "PRAGMA cipher_default_page_size = 1024",
    ],
  },
  // SQLCipher v3 default — fallback for some PC WeChat builds
  {
    name: "sqlcipher-v3",
    pragmas: [
      "PRAGMA cipher_compatibility = 3",
      "PRAGMA cipher_default_kdf_iter = 64000",
    ],
  },
  // SQLCipher v4 default
  {
    name: "sqlcipher-v4",
    pragmas: [
      "PRAGMA cipher_compatibility = 4",
    ],
  },
];

class WeChatDBReader {
  constructor(opts = {}) {
    if (!opts || typeof opts !== "object") {
      throw new Error("WeChatDBReader: opts required");
    }
    if (!opts.dbPath || typeof opts.dbPath !== "string") {
      throw new Error("WeChatDBReader: opts.dbPath required");
    }
    if (!opts.keyProvider || typeof opts.keyProvider.getKey !== "function") {
      throw new Error("WeChatDBReader: opts.keyProvider with getKey() required");
    }
    this._dbPath = opts.dbPath;
    this._keyProvider = opts.keyProvider;
    this._driver = opts.driver || null; // DI seam for tests
    this._db = null;
    this._profile = null;
  }

  async open() {
    if (!fs.existsSync(this._dbPath)) {
      throw new Error(`WeChatDBReader: DB not found: ${this._dbPath}`);
    }
    const key = await this._keyProvider.getKey();
    if (!key) {
      throw new Error("WeChatDBReader: keyProvider returned empty key");
    }
    const Database = this._driver || loadDriver();
    let lastError = null;
    for (const profile of KNOWN_PRAGMA_PROFILES) {
      try {
        const db = new Database(this._dbPath, { readonly: true });
        db.pragma(`key = '${key}'`);
        for (const p of profile.pragmas) db.exec(p);
        // Probe — does sqlite_master open?
        const row = db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
        if (row && Number.isFinite(row.n)) {
          this._db = db;
          this._profile = profile.name;
          return { profile: profile.name, tables: row.n };
        }
        db.close();
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `WeChatDBReader: failed to open with any pragma profile. Last error: ${lastError && lastError.message}`,
    );
  }

  /**
   * Quick check: does this look like an EnMicroMsg.db (the main WeChat
   * message DB)? Verifies the `message` + `rcontact` tables exist.
   */
  isEnMicroMsg() {
    if (!this._db) return false;
    try {
      const tables = this._db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      return tables.includes("message") && tables.includes("rcontact");
    } catch (_e) {
      return false;
    }
  }

  /**
   * List tables present.
   */
  listTables() {
    if (!this._db) return [];
    return this._db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
  }

  /**
   * Discover actual column names via `PRAGMA table_info(<table>)` so
   * uppercase/lowercase divergence across WeChat builds doesn't blow up
   * the SELECT. Returns a Map<lowercased_name, actual_name>.
   *
   * Post-sjqz audit defence — sjqz schema docs show some column-case
   * variation across versions; failing late at SELECT yields a confusing
   * "no such column" error rather than a clean fallback path.
   */
  _columnMap(table) {
    if (!this._db) return new Map();
    try {
      const rows = this._db.prepare(`PRAGMA table_info(${table})`).all();
      return new Map(rows.map((r) => [String(r.name).toLowerCase(), r.name]));
    } catch (_e) {
      return new Map();
    }
  }

  /**
   * Resolve a list of desired column names against the actual table
   * schema. Returns the actual column names quoted for SQL use; throws
   * if any required column is missing (caller catches and surfaces a
   * "schema-mismatch" error to the host).
   */
  _resolveColumns(table, desiredNames, { required = true } = {}) {
    const map = this._columnMap(table);
    const resolved = [];
    const missing = [];
    for (const name of desiredNames) {
      const actual = map.get(name.toLowerCase());
      if (actual) resolved.push(actual);
      else if (required) missing.push(name);
    }
    if (missing.length > 0 && required) {
      const err = new Error(
        `WeChatDBReader: table '${table}' missing required columns: ${missing.join(", ")} ` +
          `(available: ${Array.from(map.values()).join(", ")})`,
      );
      err.code = "WECHAT_SCHEMA_MISMATCH";
      throw err;
    }
    return resolved;
  }

  /**
   * Fetch up to `limit` messages since `sinceMsgSvrId` (per design doc
   * §6 OQ-6 watermark = per-talker last msgSvrId). For initial v0 we
   * accept a global watermark and let the adapter post-filter per
   * talker.
   *
   * Column names resolved via PRAGMA table_info to survive case-drift
   * across WeChat versions (sjqz audit defence).
   */
  fetchMessages({ sinceMsgSvrId = 0, limit = 1000, talker = null } = {}) {
    if (!this._db) throw new Error("WeChatDBReader: call open() first");
    const cols = this._resolveColumns("message", [
      "msgId",
      "msgSvrId",
      "talker",
      "content",
      "type",
      "createTime",
      "isSend",
      "status",
    ]);
    let sql = `SELECT ${cols.join(", ")} FROM message`;
    const params = [];
    const where = [];
    if (sinceMsgSvrId) {
      // Use the resolved column name in WHERE / ORDER BY to match case.
      const msgSvrIdCol = cols[1];
      where.push(`${msgSvrIdCol} > ?`);
      params.push(sinceMsgSvrId);
    }
    if (talker) {
      const talkerCol = cols[2];
      where.push(`${talkerCol} = ?`);
      params.push(talker);
    }
    if (where.length > 0) sql += " WHERE " + where.join(" AND ");
    sql += ` ORDER BY ${cols[1]} ASC LIMIT ?`;
    params.push(limit);
    return this._db.prepare(sql).all(...params);
  }

  /**
   * Fetch contacts. WeChat rcontact has many columns; we pull the ones
   * relevant for normalization.
   */
  fetchContacts({ limit = 5000 } = {}) {
    if (!this._db) throw new Error("WeChatDBReader: call open() first");
    return this._db
      .prepare(
        "SELECT username, alias, nickname, conRemark, type FROM rcontact LIMIT ?",
      )
      .all(limit);
  }

  /**
   * Fetch chatroom info.
   */
  fetchChatrooms({ limit = 1000 } = {}) {
    if (!this._db) throw new Error("WeChatDBReader: call open() first");
    return this._db
      .prepare(
        "SELECT chatroomname, memberlist, displayname, roomowner FROM chatroom LIMIT ?",
      )
      .all(limit);
  }

  close() {
    if (this._db) {
      try { this._db.close(); } catch (_e) {}
      this._db = null;
    }
  }

  /** Active pragma profile name (set after successful open). */
  profile() { return this._profile; }
}

let _driverCache = null;
function loadDriver() {
  if (_driverCache) return _driverCache;
  try {
    _driverCache = require("better-sqlite3-multiple-ciphers");
  } catch (err) {
    throw new Error(
      `WeChatDBReader: better-sqlite3-multiple-ciphers required: ${err && err.message ? err.message : err}`,
    );
  }
  return _driverCache;
}

module.exports = {
  WeChatDBReader,
  KNOWN_PRAGMA_PROFILES,
};
