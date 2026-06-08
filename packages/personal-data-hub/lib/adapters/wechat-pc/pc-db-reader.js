"use strict";

/**
 * WeChat **desktop (PC)** local-DB direct reader — 本地直读样板, ported from
 * the Douyin im.db sample (social-douyin-adb/im-db-parser.js) to PC WeChat.
 *
 * KEY DIFFERENCE from the Android `wechat/` adapter:
 *   - Android WeChat: ONE EnMicroMsg.db, tables `message` / `rcontact` /
 *     `chatroom`, key = MD5(IMEI+UIN) or frida.
 *   - PC WeChat 3.x: messages live in `MSG0.db`..`MSGN.db` (table `MSG`),
 *     contacts + groups live in `MicroMsg.db` (tables `Contact` / `ChatRoom`).
 *     Encrypted with SQLCipher using a 32-byte (64-hex) raw key extracted
 *     from the running WeChat.exe process memory.
 *
 * Two ways in (mirrors the user's "愿意本地解密" stance):
 *
 *   1. PLAINTEXT (recommended, fully reliable + testable): the user decrypts
 *      the PC DB to a plain SQLite file first (PyWxDump / 手动 SQLCipher
 *      decrypt) and points the adapter at it. WeChat PC's SQLCipher uses a
 *      non-standard per-page HMAC salt scheme, so "decrypt-to-plaintext
 *      then read" is the proven path — same shape as the Douyin plaintext
 *      im.db sample.
 *
 *   2. ENCRYPTED + raw key (best-effort): if a 64-hex key is supplied we try
 *      the documented PC SQLCipher PRAGMA profile. Some WeChat builds open
 *      cleanly this way; if not, fall back to method 1.
 *
 * This reader does NOT extract the key (that needs OS-specific process-memory
 * scanning — out of scope here; the guide points at the manual step). It
 * opens what it's given and reads whatever of {MSG, Contact, ChatRoom} the
 * file contains, so the SAME reader serves both MSG*.db (messages) and
 * MicroMsg.db (contacts) — point it at each in turn.
 *
 * Test seam: inject a synthetic `_databaseClass` to bypass the native
 * dual-load (mirrors douyin im-db-parser + bilibili chromium-cookies-reader).
 */

// PC WeChat 3.x SQLCipher params (documented by PyWxDump et al.). Applied
// only when a raw key is supplied. cipher_compatibility 3 ≈ WeChat's
// page_size 4096 / kdf_iter 64000 / HMAC-SHA1 layout. Tried in order.
const KNOWN_PC_PRAGMA_PROFILES = Object.freeze([
  {
    name: "wechat-pc-v3",
    pragmas: [
      "PRAGMA cipher_compatibility = 3",
      "PRAGMA cipher_page_size = 4096",
      "PRAGMA kdf_iter = 64000",
      "PRAGMA cipher_hmac_algorithm = HMAC_SHA1",
      "PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA1",
    ],
  },
  {
    name: "wechat-pc-v4",
    pragmas: [
      "PRAGMA cipher_compatibility = 4",
      "PRAGMA cipher_page_size = 4096",
    ],
  },
]);

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
    "wechat-pc-db-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
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

/**
 * Normalize PC WeChat timestamps to ms. PC stores CreateTime in SECONDS
 * (10-digit). Be defensive about ms/µs the same way Douyin is.
 */
function normalizeEpochMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v > 1e15) return Math.floor(v / 1000); // µs
  if (v > 1e12) return Math.floor(v); // ms
  return Math.floor(v * 1000); // seconds
}

/**
 * For Type=1 (plain text) messages StrContent IS the text. For group
 * messages PC prefixes the sender wxid + ":\n" inside StrContent; strip it
 * so the text is clean and expose the sender separately.
 */
function parsePcContent(strContent, isGroup) {
  if (typeof strContent !== "string" || strContent.length === 0) {
    return { text: "", senderWxid: null };
  }
  if (isGroup) {
    const idx = strContent.indexOf(":\n");
    if (idx > 0 && idx < 80) {
      return {
        senderWxid: strContent.slice(0, idx),
        text: strContent.slice(idx + 2),
      };
    }
  }
  return { text: strContent, senderWxid: null };
}

function isGroupTalker(talker) {
  return typeof talker === "string" && talker.endsWith("@chatroom");
}

/**
 * Open a PC WeChat DB (encrypted-with-key OR already-plaintext).
 *
 * @param {string} dbPath
 * @param {{ key?: string, _databaseClass?: any }} [opts]
 * @returns {{ db: object, mode: "plaintext"|"sqlcipher", profile: string|null }}
 */
function openPcWeChatDb(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const key = typeof opts.key === "string" && opts.key.length > 0 ? opts.key : null;

  if (!key) {
    // Plaintext path — already-decrypted db. Probe sqlite_master.
    const db = new Database(dbPath, { readonly: true });
    try {
      db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
      return { db, mode: "plaintext", profile: null };
    } catch (err) {
      try { db.close(); } catch (_e) { /* ignore */ }
      const e = new Error(
        `wechat-pc-db-reader: db is not plaintext SQLite (supply a 64-hex key, or decrypt first): ${err.message}`,
      );
      e.code = "WECHAT_PC_NEEDS_KEY";
      throw e;
    }
  }

  // SQLCipher path — raw hex key. Try each known PC profile.
  const keyExpr = /^[0-9a-fA-F]{64}$/.test(key) ? `"x'${key}'"` : `'${key}'`;
  let lastError = null;
  for (const profile of KNOWN_PC_PRAGMA_PROFILES) {
    let db;
    try {
      db = new Database(dbPath, { readonly: true });
      db.pragma(`key = ${keyExpr}`);
      for (const p of profile.pragmas) db.exec(p);
      const row = db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
      if (row && Number.isFinite(row.n)) {
        return { db, mode: "sqlcipher", profile: profile.name };
      }
      db.close();
    } catch (err) {
      lastError = err;
      if (db) {
        try { db.close(); } catch (_e) { /* ignore */ }
      }
    }
  }
  const e = new Error(
    `wechat-pc-db-reader: failed to open with any SQLCipher profile — ` +
      `key wrong, or WeChat build needs decrypt-to-plaintext first. ` +
      `Last error: ${lastError && lastError.message}`,
  );
  e.code = "WECHAT_PC_DECRYPT_FAILED";
  throw e;
}

/**
 * Read messages + contacts out of a PC WeChat DB. Reads whatever of
 * {MSG, Contact} the file contains (MSG*.db has MSG; MicroMsg.db has
 * Contact), so the same call works for either file.
 *
 * Returns `{ messages, contacts, diagnostic }`:
 *   messages: {msgSvrId, talker, isSend, createdTimeMs, type, text,
 *              senderWxid, isGroup, contentBlob}
 *   contacts: {wxid, alias, nickname, remark, type}
 *   diagnostic: {messageCount, contactCount, hadMsgTable, hadContactTable,
 *                mode, profile}
 *
 * @param {string} dbPath
 * @param {{key?, _databaseClass?, limitMessages?, limitContacts?}} [opts]
 */
function readPcWeChat(dbPath, opts = {}) {
  if (typeof dbPath !== "string" || dbPath.length === 0) {
    throw new TypeError("readPcWeChat: dbPath must be a non-empty string");
  }
  const limitMessages =
    Number.isInteger(opts.limitMessages) && opts.limitMessages > 0
      ? opts.limitMessages
      : 20_000;
  const limitContacts =
    Number.isInteger(opts.limitContacts) && opts.limitContacts > 0
      ? opts.limitContacts
      : 10_000;

  const { db, mode, profile } = openPcWeChatDb(dbPath, opts);
  const out = {
    messages: [],
    contacts: [],
    diagnostic: {
      messageCount: 0,
      contactCount: 0,
      hadMsgTable: false,
      hadContactTable: false,
      mode,
      profile,
    },
  };
  try {
    // ─── MSG table (messages) ────────────────────────────────────────────
    const msgInfo = trySelect(db, "PRAGMA table_info(MSG)");
    if (Array.isArray(msgInfo) && msgInfo.length > 0) {
      out.diagnostic.hadMsgTable = true;
      const cols = new Set(msgInfo.map((r) => r.name));
      const svrCol = pickCol(cols, ["MsgSvrID", "msgSvrId", "MsgSvrId"]);
      const talkerCol = pickCol(cols, ["StrTalker", "strTalker", "Talker", "talker"]);
      const sendCol = pickCol(cols, ["IsSender", "isSend", "IsSend"]);
      const timeCol = pickCol(cols, ["CreateTime", "createTime", "create_time"]);
      const typeCol = pickCol(cols, ["Type", "type", "MsgType"]);
      const contentCol = pickCol(cols, ["StrContent", "strContent", "Content", "content"]);
      const localIdCol = pickCol(cols, ["localId", "MsgId", "msgId"]);
      if (timeCol && contentCol) {
        const fields = [];
        if (svrCol) fields.push(`${svrCol} AS msgSvrId`);
        if (localIdCol) fields.push(`${localIdCol} AS localId`);
        if (talkerCol) fields.push(`${talkerCol} AS talker`);
        if (sendCol) fields.push(`${sendCol} AS isSend`);
        if (typeCol) fields.push(`${typeCol} AS type`);
        fields.push(`${timeCol} AS createTime`);
        fields.push(`${contentCol} AS content`);
        const sql =
          `SELECT ${fields.join(", ")} FROM MSG ORDER BY ${timeCol} DESC LIMIT ${limitMessages}`;
        const rows = trySelect(db, sql) || [];
        for (const r of rows) {
          const isGroup = isGroupTalker(r.talker);
          const { text, senderWxid } = parsePcContent(r.content, isGroup);
          out.messages.push({
            msgSvrId: r.msgSvrId != null ? String(r.msgSvrId) : (r.localId != null ? `local-${r.localId}` : null),
            talker: r.talker ? String(r.talker) : null,
            isSend: typeof r.isSend === "number" ? r.isSend : null,
            createdTimeMs: normalizeEpochMs(r.createTime),
            type: typeof r.type === "number" ? r.type : null,
            text,
            senderWxid,
            isGroup,
            contentBlob: typeof r.content === "string" ? r.content : null,
          });
        }
        out.diagnostic.messageCount = out.messages.length;
      }
    }

    // ─── Contact table (contacts) ────────────────────────────────────────
    const contactInfo = trySelect(db, "PRAGMA table_info(Contact)");
    if (Array.isArray(contactInfo) && contactInfo.length > 0) {
      out.diagnostic.hadContactTable = true;
      const cols = new Set(contactInfo.map((r) => r.name));
      const wxidCol = pickCol(cols, ["UserName", "userName", "Username", "username"]);
      const aliasCol = pickCol(cols, ["Alias", "alias"]);
      const nickCol = pickCol(cols, ["NickName", "nickName", "nickname"]);
      const remarkCol = pickCol(cols, ["Remark", "remark", "ConRemark", "conRemark"]);
      const typeCol = pickCol(cols, ["Type", "type"]);
      if (wxidCol) {
        const fields = [`${wxidCol} AS wxid`];
        if (aliasCol) fields.push(`${aliasCol} AS alias`);
        if (nickCol) fields.push(`${nickCol} AS nickname`);
        if (remarkCol) fields.push(`${remarkCol} AS remark`);
        if (typeCol) fields.push(`${typeCol} AS type`);
        const sql = `SELECT ${fields.join(", ")} FROM Contact LIMIT ${limitContacts}`;
        const rows = trySelect(db, sql) || [];
        for (const r of rows) {
          if (!r.wxid) continue;
          const wxid = String(r.wxid);
          // Skip WeChat internal placeholders + chatrooms (not Persons).
          if (wxid.endsWith("@chatroom")) continue;
          out.contacts.push({
            wxid,
            alias: r.alias || null,
            nickname: r.nickname || null,
            remark: r.remark || null,
            type: typeof r.type === "number" ? r.type : null,
          });
        }
        out.diagnostic.contactCount = out.contacts.length;
      }
    }
  } finally {
    try { db.close(); } catch (_e) { /* ignore */ }
  }
  return out;
}

module.exports = {
  readPcWeChat,
  openPcWeChatDb,
  KNOWN_PC_PRAGMA_PROFILES,
  _internals: {
    loadDatabaseClass,
    normalizeEpochMs,
    parsePcContent,
    isGroupTalker,
    pickCol,
  },
};
