"use strict";

/**
 * Phase 2a (Douyin C 路径 — 2026-05-25): Douyin IM sqlite parser.
 *
 * Parses the Douyin Android App's per-user IM sqlite:
 *   /data/data/com.ss.android.ugc.aweme/databases/<uid>_im.db
 *
 * Where `<uid>` is the 19-digit numeric Douyin UID (matches what the app
 * shows in passport/account/info/v2 as `user_id`, not the secUid).
 *
 * Schema reference: Alexis Brignoni's TIKTOK DFIR SQL repo
 *   https://github.com/abrignoni/DFIR-SQL-Query-Repo/blob/master/Android/TIKTOK/TikTokMessages.sql
 *
 * Two tables we parse:
 *
 *   msg
 *     sender         INTEGER  — sender UID (numeric, matches DB filename uid for self-sent)
 *     created_time   INTEGER  — Unix epoch milliseconds
 *     content        TEXT     — JSON: {text, display_name, url:{url_list:[...]}}
 *     read_status    INTEGER
 *     local_info     TEXT
 *     conversation_id TEXT    — peer thread identifier
 *
 *   SIMPLE_USER  (contacts cache; mutual-follow visible)
 *     UID            INTEGER
 *     short_id       INTEGER
 *     name           TEXT
 *     avatar_url     TEXT
 *     follow_status  INTEGER  — 0/1/2 (none/following/mutual)
 *
 * Both tables are **unencrypted SQLite**. No SQLCipher. Douyin (and global
 * TikTok) stores its IM db in plaintext on Android per multiple academic
 * forensic studies (Brignoni 2018, ACM ARES 2020). This is the key
 * differentiator from WeChat/QQ which need frida hooks for the key.
 *
 * What this parser DOES NOT do:
 *  - Decrypt encrypted message attachments (separate `attachment_<id>` files
 *    in the same dir; not in scope for v0.1)
 *  - Resolve sender UID → nickname (would need a JOIN to SIMPLE_USER; we
 *    emit both tables separately so the consumer can correlate)
 *  - Sticker / voice / video message content (the content JSON has type
 *    discriminators we ignore — only `text` is extracted; other types
 *    yield empty `text` field with the raw payload preserved)
 *
 * Test seam: callers can inject a synthetic `_databaseClass` to bypass the
 * dual-load probe (Phase 1a chromium-cookies-reader pattern).
 */

/**
 * Dual-load: prefers bs3mc (Electron ABI 140 runtime), falls back to plain
 * better-sqlite3 (Node ABI 127 test path). Same pattern as
 * social-bilibili-adb/chromium-cookies-reader.js.
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
    "douyin-im-db-parser: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

/**
 * Parse a content blob (TEXT column) for the user-visible text. The blob
 * is JSON for most modern Douyin versions, but some legacy rows have the
 * text directly. We try JSON first, fall back to the raw string.
 *
 * @param {string} blob raw content column value
 * @returns {string|null} extracted text, or null if blob is empty/unparseable
 */
function extractTextFromContent(blob) {
  if (typeof blob !== "string" || blob.length === 0) return null;
  try {
    const parsed = JSON.parse(blob);
    if (parsed && typeof parsed === "object") {
      // Modern shape: {text: "...", display_name: "...", url: {url_list: [...]}}
      if (typeof parsed.text === "string") return parsed.text;
      // Some versions wrap text in `content` nested
      if (parsed.content && typeof parsed.content.text === "string") return parsed.content.text;
    }
  } catch (_e) {
    // Not JSON — return the raw value (could be a legacy plaintext row)
    return blob;
  }
  return null;
}

/**
 * Parse the msg + SIMPLE_USER tables from a Douyin IM sqlite at [dbPath].
 *
 * Returns `{ messages, contacts, diagnostic }` where:
 *   - messages: Array<{senderUid, conversationId, createdTimeMs, text, readStatus, contentBlob}>
 *   - contacts: Array<{uid, shortId, name, avatarUrl, followStatus}>
 *   - diagnostic: {messageCount, contactCount, hadMsgTable, hadSimpleUserTable}
 *
 * If either table is missing (older Douyin version, or non-IM db opened
 * by mistake), the missing array is empty + `hadXxxTable=false` so the
 * caller can warn the user. Throws only when the db file itself isn't
 * openable (file corrupted / wrong magic header).
 *
 * @param {string} dbPath  absolute path to the IM sqlite db
 * @param {{_databaseClass?: any, limitMessages?: number, limitContacts?: number}} [opts]
 * @returns {{messages: Array, contacts: Array, diagnostic: object}}
 */
function parseImDb(dbPath, opts = {}) {
  if (typeof dbPath !== "string" || dbPath.length === 0) {
    throw new TypeError("parseImDb: dbPath must be a non-empty string");
  }
  const limitMessages =
    Number.isInteger(opts.limitMessages) && opts.limitMessages > 0
      ? opts.limitMessages
      : 10_000;
  const limitContacts =
    Number.isInteger(opts.limitContacts) && opts.limitContacts > 0
      ? opts.limitContacts
      : 5_000;
  const Database = opts._databaseClass || loadDatabaseClass();
  const db = new Database(dbPath, { readonly: true });
  const out = {
    messages: [],
    contacts: [],
    diagnostic: {
      messageCount: 0,
      contactCount: 0,
      hadMsgTable: false,
      hadSimpleUserTable: false,
      hadParticipantTable: false,
    },
  };
  try {
    // ─── msg table ───────────────────────────────────────────────────────
    const msgTableInfo = trySelect(
      db,
      "PRAGMA table_info(msg)",
    );
    if (Array.isArray(msgTableInfo) && msgTableInfo.length > 0) {
      out.diagnostic.hadMsgTable = true;
      const columns = new Set(msgTableInfo.map((r) => r.name));
      // Defensive column picker — Douyin app versions add/drop columns.
      // We need: sender + created_time + content. Other fields nice-to-have.
      const senderCol = pickCol(columns, ["sender", "from_user_id", "uid"]);
      const timeCol = pickCol(columns, [
        "created_time",
        "create_time",
        "created_at",
      ]);
      const contentCol = pickCol(columns, ["content", "message_content"]);
      const convCol = pickCol(columns, [
        "conversation_id",
        "conv_id",
        "session_id",
      ]);
      const readCol = pickCol(columns, ["read_status", "read", "is_read"]);
      if (senderCol && timeCol && contentCol) {
        const sql =
          `SELECT ${senderCol} AS sender, ${timeCol} AS createdTime, ${contentCol} AS content` +
          (convCol ? `, ${convCol} AS conversationId` : "") +
          (readCol ? `, ${readCol} AS readStatus` : "") +
          ` FROM msg ORDER BY ${timeCol} DESC LIMIT ${limitMessages}`;
        const rows = trySelect(db, sql) || [];
        for (const r of rows) {
          const createdTimeMs = normalizeEpochMs(r.createdTime);
          out.messages.push({
            senderUid:
              typeof r.sender === "number"
                ? String(r.sender)
                : r.sender != null
                  ? String(r.sender)
                  : null,
            conversationId: r.conversationId ? String(r.conversationId) : null,
            createdTimeMs,
            text: extractTextFromContent(r.content),
            readStatus:
              typeof r.readStatus === "number" ? r.readStatus : null,
            contentBlob: typeof r.content === "string" ? r.content : null,
          });
        }
        out.diagnostic.messageCount = out.messages.length;
      }
    }

    // ─── SIMPLE_USER table ───────────────────────────────────────────────
    const userTableInfo = trySelect(
      db,
      "PRAGMA table_info(SIMPLE_USER)",
    );
    if (Array.isArray(userTableInfo) && userTableInfo.length > 0) {
      out.diagnostic.hadSimpleUserTable = true;
      const columns = new Set(userTableInfo.map((r) => r.name));
      const uidCol = pickCol(columns, ["UID", "uid", "user_id"]);
      const shortIdCol = pickCol(columns, ["short_id", "shortId", "ShortId"]);
      const nameCol = pickCol(columns, ["name", "nick_name", "nickname"]);
      const avatarCol = pickCol(columns, ["avatar_url", "avatarUrl", "avatar"]);
      const followCol = pickCol(columns, [
        "follow_status",
        "followStatus",
        "follow_state",
      ]);
      if (uidCol) {
        const fields = [`${uidCol} AS uid`];
        if (shortIdCol) fields.push(`${shortIdCol} AS shortId`);
        if (nameCol) fields.push(`${nameCol} AS name`);
        if (avatarCol) fields.push(`${avatarCol} AS avatarUrl`);
        if (followCol) fields.push(`${followCol} AS followStatus`);
        const sql = `SELECT ${fields.join(", ")} FROM SIMPLE_USER LIMIT ${limitContacts}`;
        const rows = trySelect(db, sql) || [];
        for (const r of rows) {
          out.contacts.push({
            uid: r.uid != null ? String(r.uid) : null,
            shortId: r.shortId != null ? String(r.shortId) : null,
            name: r.name || null,
            avatarUrl: r.avatarUrl || null,
            followStatus:
              typeof r.followStatus === "number" ? r.followStatus : null,
          });
        }
        out.diagnostic.contactCount = out.contacts.length;
      }
    }

    // ─── participant table (device-verified 2026-06-16) ──────────────────
    // Real Douyin IM schema keeps conversation members in `participant`
    // (conversation_id, user_id, sort_order; UNIQUE(conversation_id,user_id)),
    // NOT SIMPLE_USER (which is older/other builds). Pull distinct member uids
    // as contacts — uid-only (nickname/avatar live in a separate user table),
    // so a PERSON gets created keyed by douyin-uid even without a name.
    // Dedup against contacts already harvested from SIMPLE_USER.
    const partTableInfo = trySelect(db, "PRAGMA table_info(participant)");
    if (Array.isArray(partTableInfo) && partTableInfo.length > 0) {
      out.diagnostic.hadParticipantTable = true;
      const columns = new Set(partTableInfo.map((r) => r.name));
      const uidCol = pickCol(columns, ["user_id", "uid", "UID"]);
      if (uidCol) {
        const seen = new Set(
          out.contacts.map((c) => c.uid).filter(Boolean),
        );
        const sql =
          `SELECT DISTINCT ${uidCol} AS uid FROM participant ` +
          `WHERE ${uidCol} IS NOT NULL LIMIT ${limitContacts}`;
        const rows = trySelect(db, sql) || [];
        for (const r of rows) {
          const uid = r.uid != null ? String(r.uid) : null;
          if (!uid || seen.has(uid)) continue;
          seen.add(uid);
          out.contacts.push({
            uid,
            shortId: null,
            name: null,
            avatarUrl: null,
            followStatus: null,
            fromParticipant: true,
          });
        }
        out.diagnostic.contactCount = out.contacts.length;
      }
    }
  } finally {
    db.close();
  }
  return out;
}

/**
 * Normalize various epoch units to ms. Douyin sometimes writes seconds,
 * sometimes microseconds, sometimes ms. Heuristic: 13-digit = ms,
 * 10-digit = seconds, 16-digit = microseconds.
 */
function normalizeEpochMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  // > 1e16 µs → / 1000
  if (v > 1e15) return Math.floor(v / 1000);
  // > 1e12 ms → keep
  if (v > 1e12) return Math.floor(v);
  // <= 1e12 seconds → × 1000
  return Math.floor(v * 1000);
}

/**
 * Try a SELECT; return the row array on success or null on any error
 * (missing table / syntax error / driver throw). Mirrors social-bilibili
 * adapter.js:trySelect.
 */
function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (_e) {
    return null;
  }
}

/**
 * Return the first column in [candidates] that exists in [columns], or
 * null. Used to handle Douyin's schema drift across versions.
 */
function pickCol(columns, candidates) {
  for (const c of candidates) {
    if (columns.has(c)) return c;
  }
  return null;
}

module.exports = {
  parseImDb,
  // Exposed for tests
  _internals: {
    loadDatabaseClass,
    extractTextFromContent,
    normalizeEpochMs,
    pickCol,
  },
};
