"use strict";

/**
 * QQ NT **desktop (PC)** local-DB reader — 本地直读样板, ported from the
 * Douyin / wechat-pc samples to QQ NT (新版 PC QQ, Electron 9.x).
 *
 * Source: `nt_msg.db` under the QQ data dir (e.g.
 *   %APPDATA%\Tencent\QQ\nt_qq_<hash>\nt_db\nt_msg.db).
 * Message tables: `c2c_msg_table` (1-on-1) + `group_msg_table` (群).
 *
 * ⚠️ HONEST CAVEAT (v0.1): unlike Douyin's plaintext im.db, QQ NT is the
 * hardest of the three:
 *   - SQLCipher-encrypted (decrypt to plaintext first — recommended).
 *   - Column names are NUMERIC + obfuscated ("40050", "40011", ...) and
 *     DRIFT across QQ versions.
 *   - Message bodies are protobuf BLOBs, not plain text — full text needs
 *     per-type protobuf decoding that must be tuned on a real DB.
 *
 * So this reader is deliberately DEFENSIVE + LOUD rather than clever:
 *   - It probes a table's columns and resolves time/type/sender/peer/content
 *     against candidate lists (readable names FIRST, then known numeric ids).
 *   - It extracts text ONLY when the resolved content column is a real
 *     string; otherwise text=null but the FULL raw row is preserved in
 *     `rawRow` so nothing is lost and a later protobuf decoder can fill it.
 *   - The diagnostic reports exactly which tables + columns were resolved,
 *     so the user/UI sees what worked instead of silently getting 0 rows.
 *
 * Test seam: inject `_databaseClass` to bypass the native dual-load.
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
    "qq-pc-nt-db-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
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

// Candidate column names per field — readable names first (decrypted /
// re-exported DBs sometimes have them), then the known QQ NT numeric ids.
// Tune the numeric lists on a real device; unknowns just fall through to
// rawRow (loud diagnostic), never a silent 0.
const COL_CANDIDATES = Object.freeze({
  msgId: ["msgId", "msg_id", "40001", "40020"],
  time: ["msgTime", "time", "timestamp", "40050"],
  type: ["msgType", "type", "40011", "40012"],
  sender: ["senderUin", "sender", "senderUid", "40033", "40030"],
  peer: ["peerUin", "peer", "peerUid", "40021", "40027"],
  content: ["content", "text", "msgContent", "40080", "40800"],
});

/**
 * Open a QQ NT DB (plaintext OR SQLCipher-with-key). Mirrors wechat-pc.
 */
function openNtDb(dbPath, opts = {}) {
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
        `qq-pc-nt-db-reader: db is not plaintext SQLite (decrypt nt_msg.db first, or pass --key): ${err.message}`,
      );
      e.code = "QQ_PC_NEEDS_KEY";
      throw e;
    }
  }
  const keyExpr = /^[0-9a-fA-F]{64}$/.test(key) ? `"x'${key}'"` : `'${key}'`;
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma(`key = ${keyExpr}`);
    db.exec("PRAGMA cipher_compatibility = 4");
    db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    return { db, mode: "sqlcipher" };
  } catch (err) {
    try { db.close(); } catch (_e) { /* ignore */ }
    const e = new Error(
      `qq-pc-nt-db-reader: SQLCipher open failed (key wrong, or decrypt to plaintext first): ${err.message}`,
    );
    e.code = "QQ_PC_DECRYPT_FAILED";
    throw e;
  }
}

function readMsgTable(db, tableName, isGroup, limit, diag) {
  const info = trySelect(db, `PRAGMA table_info(${tableName})`);
  if (!Array.isArray(info) || info.length === 0) return [];
  const cols = new Set(info.map((r) => r.name));
  const resolved = {
    msgId: pickCol(cols, COL_CANDIDATES.msgId),
    time: pickCol(cols, COL_CANDIDATES.time),
    type: pickCol(cols, COL_CANDIDATES.type),
    sender: pickCol(cols, COL_CANDIDATES.sender),
    peer: pickCol(cols, COL_CANDIDATES.peer),
    content: pickCol(cols, COL_CANDIDATES.content),
  };
  diag.resolvedColumns[tableName] = resolved;
  // Select ALL columns so the full raw row is preserved (protobuf bodies,
  // unknown columns) — we map the resolved fields on top of it.
  const orderBy = resolved.time ? ` ORDER BY "${resolved.time}" DESC` : "";
  const rows =
    trySelect(db, `SELECT * FROM ${tableName}${orderBy} LIMIT ${limit}`) || [];
  return rows.map((row, idx) => {
    const rawTime = resolved.time ? row[resolved.time] : null;
    const contentVal = resolved.content ? row[resolved.content] : null;
    return {
      msgId:
        (resolved.msgId && row[resolved.msgId] != null && String(row[resolved.msgId])) ||
        `${tableName}-${idx}`,
      isGroup,
      createdTimeMs:
        typeof rawTime === "number" ? normalizeEpochMs(rawTime) : null,
      type:
        resolved.type && typeof row[resolved.type] === "number"
          ? row[resolved.type]
          : null,
      senderUin: resolved.sender && row[resolved.sender] != null ? String(row[resolved.sender]) : null,
      peerUin: resolved.peer && row[resolved.peer] != null ? String(row[resolved.peer]) : null,
      // Only treat content as text when it's a real string (not a BLOB).
      text: typeof contentVal === "string" ? contentVal : null,
      // Preserve the full raw row so a later protobuf decoder loses nothing.
      rawRow: row,
    };
  });
}

/**
 * Read messages out of a QQ NT nt_msg.db. Returns `{messages, diagnostic}`.
 * Reads c2c_msg_table + group_msg_table (whichever exist).
 */
function readQqNt(dbPath, opts = {}) {
  if (typeof dbPath !== "string" || dbPath.length === 0) {
    throw new TypeError("readQqNt: dbPath must be a non-empty string");
  }
  const limit =
    Number.isInteger(opts.limitMessages) && opts.limitMessages > 0
      ? opts.limitMessages
      : 20_000;
  const { db, mode } = openNtDb(dbPath, opts);
  const diagnostic = {
    messageCount: 0,
    hadC2cTable: false,
    hadGroupTable: false,
    textCount: 0,
    resolvedColumns: {},
    mode,
  };
  const messages = [];
  try {
    const c2c = readMsgTable(db, "c2c_msg_table", false, limit, diagnostic);
    if (diagnostic.resolvedColumns.c2c_msg_table) diagnostic.hadC2cTable = true;
    const group = readMsgTable(db, "group_msg_table", true, limit, diagnostic);
    if (diagnostic.resolvedColumns.group_msg_table) diagnostic.hadGroupTable = true;
    for (const m of [...c2c, ...group]) {
      messages.push(m);
      if (typeof m.text === "string" && m.text.length > 0) diagnostic.textCount += 1;
    }
    diagnostic.messageCount = messages.length;
  } finally {
    try { db.close(); } catch (_e) { /* ignore */ }
  }
  return { messages, diagnostic };
}

module.exports = {
  readQqNt,
  openNtDb,
  COL_CANDIDATES,
  _internals: { loadDatabaseClass, normalizeEpochMs, pickCol, readMsgTable },
};
