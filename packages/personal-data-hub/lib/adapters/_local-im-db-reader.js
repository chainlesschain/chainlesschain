"use strict";

/**
 * Generic "honest" local IM-database reader — shared by device-pull desktop
 * IM adapters whose schema we CAN'T verify without a real device (钉钉 /
 * 飞书). Ported from the qq-pc honest pattern:
 *
 *   - open plaintext OR SQLCipher-with-key
 *   - DISCOVER message-like tables via sqlite_master + a name pattern
 *     (proprietary clients shard / rename tables across versions, so we
 *     never hardcode one table name)
 *   - per table, resolve time/sender/peer/content via candidate lists
 *     (readable names first, then version-specific guesses)
 *   - extract text ONLY when the resolved content column is a real string;
 *     otherwise text=null but the FULL raw row is preserved in `rawRow`
 *   - LOUD diagnostic: which tables matched, which columns resolved, counts
 *     — so the user/UI sees what worked instead of silently getting 0 rows
 *
 * This is deliberately best-effort. The reliable part is "open + discover +
 * preserve everything + report"; exact text extraction for encrypted /
 * protobuf bodies is real-device tuning (extend colCandidates per platform).
 *
 * Test seam: inject `_databaseClass`.
 */

function loadDatabaseClass() {
  for (const mod of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    let cls;
    try {
      // eslint-disable-next-line global-require
      cls = require(mod);
    } catch (_e) {
      continue;
    }
    try {
      const probe = new cls(":memory:");
      probe.close();
      return cls;
    } catch (_e) {
      // ABI mismatch — try next
    }
  }
  throw new Error(
    "local-im-db-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (_e) {
    return null;
  }
}

function pickCol(columns, candidates) {
  for (const c of candidates) {
    if (columns.has(c)) return c;
  }
  return null;
}

function normalizeEpochMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v > 1e15) return Math.floor(v / 1000); // µs
  if (v > 1e12) return Math.floor(v); // ms
  return Math.floor(v * 1000); // seconds
}

/**
 * Open a local IM DB. Plaintext when no key; SQLCipher (try compat 4 then 3)
 * when a key is supplied.
 */
function openLocalDb(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const key = typeof opts.key === "string" && opts.key.length > 0 ? opts.key : null;
  if (!key) {
    const db = new Database(dbPath, { readonly: true });
    try {
      db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
      return { db, mode: "plaintext" };
    } catch (err) {
      try { db.close(); } catch (_e) { /* ignore */ }
      const e = new Error(
        `local-im-db-reader: not plaintext SQLite (decrypt first, or pass key): ${err.message}`,
      );
      e.code = "IM_DB_NEEDS_KEY";
      throw e;
    }
  }
  const keyExpr = /^[0-9a-fA-F]{64}$/.test(key) ? `"x'${key}'"` : `'${key}'`;
  for (const compat of [4, 3]) {
    let db;
    try {
      db = new Database(dbPath, { readonly: true });
      db.pragma(`key = ${keyExpr}`);
      db.exec(`PRAGMA cipher_compatibility = ${compat}`);
      db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
      return { db, mode: `sqlcipher-v${compat}` };
    } catch (_err) {
      if (db) { try { db.close(); } catch (_e) { /* ignore */ } }
    }
  }
  const e = new Error("local-im-db-reader: SQLCipher open failed (key wrong, or decrypt first)");
  e.code = "IM_DB_DECRYPT_FAILED";
  throw e;
}

const DEFAULT_COL_CANDIDATES = Object.freeze({
  msgId: ["msgId", "msg_id", "messageId", "message_id", "localId", "id", "_id"],
  time: ["msgTime", "createTime", "create_time", "timestamp", "time", "sendTime", "send_time", "ctime"],
  sender: ["senderId", "sender_id", "senderUid", "fromId", "from_id", "from", "sender", "uid"],
  peer: ["peerId", "peer_id", "conversationId", "conversation_id", "chatId", "chat_id", "sessionId", "talker"],
  content: ["content", "text", "msgContent", "message", "body", "summary"],
});

/**
 * Discover + read message-like tables.
 *
 * @param {string} dbPath
 * @param {object} opts
 * @param {string} [opts.key]
 * @param {any}    [opts._databaseClass]
 * @param {RegExp} [opts.tablePattern]  matches candidate table names (default /msg|message|chat|conversation/i)
 * @param {object} [opts.colCandidates] merged over DEFAULT_COL_CANDIDATES
 * @param {number} [opts.limitMessages]
 * @returns {{messages: Array, diagnostic: object}}
 */
function readLocalImDb(dbPath, opts = {}) {
  if (typeof dbPath !== "string" || dbPath.length === 0) {
    throw new TypeError("readLocalImDb: dbPath must be a non-empty string");
  }
  const limit =
    Number.isInteger(opts.limitMessages) && opts.limitMessages > 0 ? opts.limitMessages : 20_000;
  const tablePattern = opts.tablePattern || /msg|message|chat|conversation/i;
  const cand = { ...DEFAULT_COL_CANDIDATES };
  if (opts.colCandidates) {
    for (const k of Object.keys(opts.colCandidates)) {
      // platform-specific candidates take priority, then the generic list
      cand[k] = [...opts.colCandidates[k], ...(DEFAULT_COL_CANDIDATES[k] || [])];
    }
  }

  const { db, mode } = openLocalDb(dbPath, opts);
  const diagnostic = {
    mode,
    messageCount: 0,
    textCount: 0,
    tablesScanned: 0,
    messageTables: [],
    skippedTables: [],
    resolvedColumns: {},
  };
  const messages = [];
  try {
    const allTables =
      trySelect(db, "SELECT name FROM sqlite_master WHERE type='table'") || [];
    diagnostic.tablesScanned = allTables.length;
    const candidateTables = allTables
      .map((r) => r.name)
      .filter((n) => typeof n === "string" && tablePattern.test(n) && !n.startsWith("sqlite_"));

    for (const tableName of candidateTables) {
      if (messages.length >= limit) break;
      const info = trySelect(db, `PRAGMA table_info("${tableName}")`);
      if (!Array.isArray(info) || info.length === 0) continue;
      const cols = new Set(info.map((r) => r.name));
      const resolved = {
        msgId: pickCol(cols, cand.msgId),
        time: pickCol(cols, cand.time),
        sender: pickCol(cols, cand.sender),
        peer: pickCol(cols, cand.peer),
        content: pickCol(cols, cand.content),
      };
      // Need at least a content or time column to consider it a real message
      // table; otherwise it's likely metadata (record + report, don't ingest).
      if (!resolved.content && !resolved.time) {
        diagnostic.skippedTables.push(tableName);
        continue;
      }
      diagnostic.messageTables.push(tableName);
      diagnostic.resolvedColumns[tableName] = resolved;

      const orderBy = resolved.time ? ` ORDER BY "${resolved.time}" DESC` : "";
      const remaining = limit - messages.length;
      const rows =
        trySelect(db, `SELECT * FROM "${tableName}"${orderBy} LIMIT ${remaining}`) || [];
      rows.forEach((row, idx) => {
        const rawTime = resolved.time ? row[resolved.time] : null;
        const contentVal = resolved.content ? row[resolved.content] : null;
        const text = typeof contentVal === "string" ? contentVal : null;
        if (text && text.length > 0) diagnostic.textCount += 1;
        messages.push({
          msgId:
            (resolved.msgId && row[resolved.msgId] != null && String(row[resolved.msgId])) ||
            `${tableName}-${idx}`,
          table: tableName,
          createdTimeMs: typeof rawTime === "number" ? normalizeEpochMs(rawTime) : null,
          senderId: resolved.sender && row[resolved.sender] != null ? String(row[resolved.sender]) : null,
          peerId: resolved.peer && row[resolved.peer] != null ? String(row[resolved.peer]) : null,
          text,
          rawRow: row,
        });
      });
    }
    diagnostic.messageCount = messages.length;
  } finally {
    try { db.close(); } catch (_e) { /* ignore */ }
  }
  return { messages, diagnostic };
}

module.exports = {
  readLocalImDb,
  openLocalDb,
  DEFAULT_COL_CANDIDATES,
  _internals: { loadDatabaseClass, pickCol, normalizeEpochMs },
};
