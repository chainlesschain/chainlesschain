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
  msgId: ["msgId", "messageId", "msg_id", "40001"],
  sequence: ["sequence", "seq", "msgSeq", "40003"],
  time: ["msgTime", "time", "timestamp", "40050"],
  type: ["msgType", "type", "40011"],
  subtype: ["msgSubtype", "subtype", "40012"],
  senderUid: ["senderUid", "40020"],
  peerUin: ["peerUin", "peer", "40021"],
  peerUid: ["peerUid", "40027"],
  senderType: ["senderType", "40030"],
  senderUin: ["senderUin", "sender", "40033"],
  readState: ["readState", "isRead", "40040"],
  content: ["content", "text", "msgContent", "40080", "40800"],
});

const EXACT_MSG_ID_ALIAS = "__cc_exact_message_id";

function exactString(v) {
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return null;
}

function finiteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Open a QQ NT DB (plaintext OR SQLCipher-with-key). Mirrors wechat-pc.
 */
function openNtDb(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const key =
    typeof opts.key === "string" && opts.key.length > 0 ? opts.key : null;
  if (!key) {
    const db = new Database(dbPath, { readonly: true });
    try {
      db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
      return { db, mode: "plaintext" };
    } catch (err) {
      try {
        db.close();
      } catch (_e) {
        /* ignore */
      }
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
    try {
      db.close();
    } catch (_e) {
      /* ignore */
    }
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
    sequence: pickCol(cols, COL_CANDIDATES.sequence),
    time: pickCol(cols, COL_CANDIDATES.time),
    type: pickCol(cols, COL_CANDIDATES.type),
    subtype: pickCol(cols, COL_CANDIDATES.subtype),
    senderUid: pickCol(cols, COL_CANDIDATES.senderUid),
    peerUin: pickCol(cols, COL_CANDIDATES.peerUin),
    peerUid: pickCol(cols, COL_CANDIDATES.peerUid),
    senderType: pickCol(cols, COL_CANDIDATES.senderType),
    senderUin: pickCol(cols, COL_CANDIDATES.senderUin),
    readState: pickCol(cols, COL_CANDIDATES.readState),
    content: pickCol(cols, COL_CANDIDATES.content),
  };
  diag.resolvedColumns[tableName] = resolved;
  // Select ALL columns so the full raw row is preserved (protobuf bodies,
  // unknown columns) — we map the resolved fields on top of it.
  const orderBy = resolved.time ? ` ORDER BY "${resolved.time}" DESC` : "";
  const exactMsgIdSelect = resolved.msgId
    ? `, CAST("${resolved.msgId}" AS TEXT) AS "${EXACT_MSG_ID_ALIAS}"`
    : "";
  const rows =
    trySelect(
      db,
      `SELECT *${exactMsgIdSelect} FROM ${tableName}${orderBy} LIMIT ${limit}`,
    ) || [];
  return rows.map((row, idx) => {
    const rawTime = resolved.time ? row[resolved.time] : null;
    const contentVal = resolved.content ? row[resolved.content] : null;
    const messageId =
      exactString(row[EXACT_MSG_ID_ALIAS]) ||
      (resolved.msgId ? exactString(row[resolved.msgId]) : null);
    const rawRow = { ...row };
    delete rawRow[EXACT_MSG_ID_ALIAS];
    if (messageId && resolved.msgId) rawRow[resolved.msgId] = messageId;
    return {
      tableName,
      msgId: messageId || `${tableName}-${idx}`,
      messageId,
      sequence: resolved.sequence ? exactString(row[resolved.sequence]) : null,
      isGroup,
      createdTimeMs:
        typeof rawTime === "number" ? normalizeEpochMs(rawTime) : null,
      type: resolved.type ? finiteNumber(row[resolved.type]) : null,
      subtype: resolved.subtype ? finiteNumber(row[resolved.subtype]) : null,
      senderUid:
        resolved.senderUid && row[resolved.senderUid] != null
          ? String(row[resolved.senderUid])
          : null,
      peerUin:
        resolved.peerUin && row[resolved.peerUin] != null
          ? String(row[resolved.peerUin])
          : null,
      peerUid:
        resolved.peerUid && row[resolved.peerUid] != null
          ? String(row[resolved.peerUid])
          : null,
      senderType: resolved.senderType
        ? finiteNumber(row[resolved.senderType])
        : null,
      senderUin:
        resolved.senderUin && row[resolved.senderUin] != null
          ? String(row[resolved.senderUin])
          : null,
      readState: resolved.readState
        ? finiteNumber(row[resolved.readState])
        : null,
      // Only treat content as text when it's a real string (not a BLOB).
      text: typeof contentVal === "string" ? contentVal : null,
      // Preserve the full raw row so a later protobuf decoder loses nothing.
      rawRow,
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
    if (diagnostic.resolvedColumns.group_msg_table)
      diagnostic.hadGroupTable = true;
    for (const m of [...c2c, ...group]) {
      messages.push(m);
      if (typeof m.text === "string" && m.text.length > 0)
        diagnostic.textCount += 1;
    }
    diagnostic.messageCount = messages.length;
  } finally {
    try {
      db.close();
    } catch (_e) {
      /* ignore */
    }
  }
  return { messages, diagnostic };
}

module.exports = {
  readQqNt,
  openNtDb,
  COL_CANDIDATES,
  _internals: { loadDatabaseClass, normalizeEpochMs, pickCol, readMsgTable },
};
