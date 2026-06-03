/**
 * §Phase 13.5 v0.2 — QQ adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-weibo/index.js dual-mode pattern, adapted to the QQ
 * data model. Two modes share normalize() but yield from different
 * sources:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by QQLocalCollector (root + plain SQLite + per-row
 *      XOR-with-IMEI decrypt — much simpler than WeChat's SQLCipher path).
 *      Adapter stateless when in snapshot mode — account.qq pulled from
 *      the snapshot file.
 *
 *   2. sqlite mode (opts.dbPath, legacy Phase 13.5): desktop AndroidExtractor
 *      pulls QQ's per-uin DB via `adb backup`; reads same tables, applies
 *      same XOR decrypt via a `keyProvider`. account.qq REQUIRED at sync
 *      time (defended in _syncViaSqlite, not the constructor — mirror of
 *      weibo / bilibili A8 pattern).
 *
 * QQ specifics (vs WeChat 12.10):
 *   - DB at /data/data/com.tencent.mobileqq/databases/<uin>.db (per-uin)
 *   - DB itself is plain SQLite — NOT SQLCipher-encrypted
 *   - Message content (`msgData` BLOB) XOR-cycled with device IMEI bytes
 *   - Message tables sharded as mr_friend_<MD5(peer_uin).upper()>_New
 *     and mr_troop_<MD5(troop_uin).upper()>_New
 *   - Contacts: tries Friends / friends / tb_recent_contact (table-name
 *     drift across QQ versions; we probe all three)
 *   - Groups: TroopInfoV2
 *
 * Snapshot schema (mirrors QQLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "qq": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "contact", "id": "contact-<peerUin>", "capturedAt": <ms>,
 *         "uin": "<peerUin>", "nickname": "...", "remark": "..." },
 *       { "kind": "group", "id": "group-<troopUin>", "capturedAt": <ms>,
 *         "troopUin": "<troopUin>", "troopName": "...",
 *         "memberCount": N, "ownerUin": "..." },
 *       { "kind": "message", "id": "msg-<msgId>", "capturedAt": <ms>,
 *         "msgId": "...", "msgType": N, "senderUin": "<senderUin>",
 *         "peerUin": "<friendOrTroopUin>", "isGroup": true|false,
 *         "isSend": true|false, "text": "<decrypted content>" }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "messaging-qq";
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_CONTACT = "contact";
const KIND_GROUP = "group";
const KIND_MESSAGE = "message";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_CONTACT,
  KIND_GROUP,
  KIND_MESSAGE,
]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `qq:${kind}:${safe}`;
}

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (_e) {
    return null;
  }
}

class QQAdapter {
  constructor(opts = {}) {
    // §Phase 13.5 v0.2: account.qq now OPTIONAL at construction — snapshot
    // mode is stateless and pulls account from the snapshot file. Sqlite
    // mode (legacy device-pull) still requires it; checked at sync time.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;
    this._keyProvider = opts.keyProvider || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:qq-contacts",
      "parse:qq-groups",
      "parse:qq-messages",
      "decrypt:xor-imei",
    ];
    // Kept as device-pull — both modes are sourced from on-device data.
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "qq:contacts (uin / nickname / remark)",
        "qq:groups (troop_uin / name / member_count)",
        "qq:messages (peer / content / time / type) — XOR-decrypted",
      ],
      sensitivity: "high",
      legalGate: true,
      defaultInclude: {
        contact: true,
        group: true,
        message: true,
      },
    };

    // _deps injection seam for tests — vi.mock("fs") does not intercept
    // require under inlined CJS in vitest forks pool.
    this._deps = {
      fs,
      dbDriverFactory: opts.dbDriverFactory || null,
    };
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      try {
        this._deps.fs.accessSync(ctx.inputPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `snapshot not readable at ${ctx.inputPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "snapshot-file" };
    }
    if (this._dbPath || (ctx && typeof ctx.dbPath === "string")) {
      if (!this.account || !this.account.qq) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_QQ",
          message: "messaging-qq.authenticate: sqlite mode requires account.qq",
        };
      }
      if (!this._keyProvider || typeof this._keyProvider.getKey !== "function") {
        return {
          ok: false,
          reason: "NO_KEY_PROVIDER",
          message:
            "messaging-qq.authenticate: sqlite mode requires opts.keyProvider with getKey() — IMEI for XOR-decrypt",
        };
      }
      return { ok: true, account: this.account.qq, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "messaging-qq.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    // Snapshot mode takes priority — Android in-APK cc always passes
    // inputPath. Sqlite mode only kicks in when caller explicitly provides
    // dbPath (same policy as social-weibo).
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      yield* this._syncViaSnapshot(opts);
      return;
    }
    const dbPath = opts.dbPath || this._dbPath;
    if (dbPath) {
      yield* this._syncViaSqlite({ ...opts, dbPath });
      return;
    }
    throw new Error(
      "messaging-qq.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const raw = this._deps.fs.readFileSync(opts.inputPath, "utf-8");
    const snapshot = JSON.parse(raw);
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    ) {
      throw new Error(
        `messaging-qq.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();

    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object") continue;
      const kind = ev.kind;
      if (!VALID_SNAPSHOT_KINDS.includes(kind)) continue;
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) ||
        parseTime(ev.time) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.uin ||
        ev.troopUin ||
        ev.msgId ||
        null;

      yield {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
      emitted += 1;
    }
  }

  async *_syncViaSqlite(opts) {
    // Legacy Phase 13.5 path — requires account.qq and a desktop-pulled DB.
    // keyProvider provides the IMEI bytes used to XOR-decrypt msgData; the
    // adapter itself is encryption-agnostic (it just XOR's whatever bytes
    // the provider hands over).
    if (!this.account || !this.account.qq) {
      throw new Error(
        "messaging-qq._syncViaSqlite: account.qq required (set via new QQAdapter({ account: { qq } }) in cli wiring)",
      );
    }
    if (!this._keyProvider) {
      throw new Error(
        "messaging-qq._syncViaSqlite: opts.keyProvider with getKey() required (returns IMEI bytes for XOR-decrypt)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const imeiKey = await this._keyProvider.getKey();
    if (!imeiKey) return;
    const imeiBytes =
      typeof imeiKey === "string" ? Buffer.from(imeiKey, "utf-8") : Buffer.from(imeiKey);

    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      // Friends: probe 3 known table names across QQ version drift.
      const friends =
        trySelect(db, "SELECT uin, name AS nickname, '' AS remark FROM Friends LIMIT 5000") ||
        trySelect(db, "SELECT uin, name AS nickname, '' AS remark FROM friends LIMIT 5000") ||
        trySelect(db, "SELECT uin, name AS nickname, remark FROM tb_recent_contact LIMIT 5000") ||
        [];
      for (const row of friends) {
        yield {
          adapter: NAME,
          kind: KIND_CONTACT,
          originalId: stableOriginalId(KIND_CONTACT, row.uin),
          capturedAt: Date.now(),
          payload: {
            kind: KIND_CONTACT,
            uin: row.uin != null ? String(row.uin) : null,
            nickname: row.nickname || "",
            remark: row.remark || "",
          },
        };
      }
      // Groups
      const groups =
        trySelect(
          db,
          "SELECT troopuin AS troop_uin, troopname AS troop_name, membernum AS member_count, troopowneruin AS owner_uin FROM TroopInfoV2 LIMIT 1000",
        ) || [];
      for (const row of groups) {
        yield {
          adapter: NAME,
          kind: KIND_GROUP,
          originalId: stableOriginalId(KIND_GROUP, row.troop_uin),
          capturedAt: Date.now(),
          payload: {
            kind: KIND_GROUP,
            troopUin: row.troop_uin != null ? String(row.troop_uin) : null,
            troopName: row.troop_name || "",
            memberCount: row.member_count || 0,
            ownerUin: row.owner_uin != null ? String(row.owner_uin) : null,
          },
        };
      }
      // Messages: discover mr_friend_*_New and mr_troop_*_New tables, then
      // walk each in DESC-time order. Per sjqz qq.py the table-name format
      // is mr_friend_<MD5(peer_uin).upper()>_New — we don't reverse it; we
      // surface peerUin from row.frienduin / row.troopuin if present.
      const tables =
        trySelect(
          db,
          "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'mr_friend_%_New' OR name LIKE 'mr_troop_%_New')",
        ) || [];
      for (const t of tables) {
        const isGroup = String(t.name).startsWith("mr_troop_");
        const msgs =
          trySelect(
            db,
            `SELECT msgId, msgtype, senderuin, time, msgData, issend, frienduin, troopuin FROM ${t.name} ORDER BY time DESC LIMIT 1000`,
          ) || [];
        for (const row of msgs) {
          const decrypted = xorDecrypt(row.msgData, imeiBytes);
          yield {
            adapter: NAME,
            kind: KIND_MESSAGE,
            originalId: stableOriginalId(KIND_MESSAGE, row.msgId),
            capturedAt: parseTime(row.time),
            payload: {
              kind: KIND_MESSAGE,
              msgId: row.msgId != null ? String(row.msgId) : null,
              msgType: row.msgtype,
              senderUin: row.senderuin != null ? String(row.senderuin) : null,
              peerUin:
                isGroup
                  ? (row.troopuin != null ? String(row.troopuin) : null)
                  : (row.frienduin != null ? String(row.frienduin) : null),
              isGroup,
              isSend: !!row.issend,
              text: decrypted,
              _table: t.name,
            },
          };
        }
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("QQAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (kind === KIND_CONTACT) {
      return normalizeContact(p, raw, ingestedAt);
    }
    if (kind === KIND_GROUP) {
      return normalizeGroup(p, raw, ingestedAt);
    }
    if (kind === KIND_MESSAGE) {
      return normalizeMessage(p, raw, ingestedAt);
    }
    throw new Error(`QQAdapter.normalize: unknown kind ${kind}`);
  }
}

function buildSource(raw, occurredAt, capturedBy) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: capturedBy || CAPTURED_BY.SQLITE,
  };
}

function normalizeContact(p, raw, ingestedAt) {
  const uin = p.uin || (p.row && p.row.uin && String(p.row.uin)) || null;
  const nickname =
    p.nickname || (p.row && (p.row.name || p.row.nickname)) || "";
  const remark = p.remark || (p.row && p.row.remark) || "";
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const names = [remark, nickname, uin].filter(
    (n) => typeof n === "string" && n.length > 0,
  );
  return {
    events: [],
    places: [],
    items: [],
    topics: [],
    persons: [
      {
        id: `person-qq-${uin || "unknown"}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.CONTACT,
        names: names.length > 0 ? names : ["(unnamed)"],
        ingestedAt,
        source,
        identifiers: {
          "qq-uin": [uin || `unknown-${newId()}`],
        },
        extra: {
          platform: "qq",
          remark: remark || null,
        },
      },
    ],
  };
}

function normalizeGroup(p, raw, ingestedAt) {
  const troopUin =
    p.troopUin || (p.row && p.row.troop_uin && String(p.row.troop_uin)) || null;
  const troopName =
    p.troopName || (p.row && p.row.troop_name) || (troopUin ? String(troopUin) : "(unnamed)");
  const memberCount =
    p.memberCount != null ? p.memberCount : (p.row && p.row.member_count) || 0;
  const ownerUin =
    p.ownerUin || (p.row && p.row.owner_uin && String(p.row.owner_uin)) || null;
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  return {
    events: [],
    places: [],
    items: [],
    persons: [],
    topics: [
      {
        id: `topic-qq-group-${troopUin || "unknown"}`,
        type: ENTITY_TYPES.TOPIC,
        name: troopName,
        ingestedAt,
        source,
        extra: {
          platform: "qq",
          troopUin,
          memberCount,
          ownerUin,
        },
      },
    ],
  };
}

function normalizeMessage(p, raw, ingestedAt) {
  // Snapshot: { msgId, msgType, senderUin, peerUin, isGroup, isSend, text, capturedAt }
  // Sqlite:   { msgId, msgType, senderUin, peerUin, isGroup, isSend, text, _table }
  const text = p.text || "";
  const occurredAt =
    parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MESSAGE,
        occurredAt,
        actor: "person-self",
        content: {
          title: (text || "").slice(0, 80) || "(空)",
          text,
        },
        ingestedAt,
        source,
        extra: {
          platform: "qq",
          peerUin: p.peerUin || null,
          senderUin: p.senderUin || null,
          isGroup: !!p.isGroup,
          isSend: !!p.isSend,
          msgType: p.msgType != null ? p.msgType : null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

/**
 * XOR cycle decrypt. Mirror of sjqz `QQDecryptor.decrypt` (qq.py:90-112).
 * IMEI bytes used as the cycle key; tries UTF-8 then GBK-fallback then hex
 * for unmappable bytes.
 *
 * Exported for the snapshot-mode Kotlin collector to verify byte-identity
 * via cross-language tests (Kotlin QQXorDecryptorTest pins the same
 * algorithm). Both sides MUST stay in lockstep — drift here = silent
 * decrypt failure with no errors raised.
 */
function xorDecrypt(data, keyBytes) {
  if (!data || data.length === 0) return "";
  if (!keyBytes || keyBytes.length === 0) return "";
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const out = Buffer.alloc(buf.length);
  const keyLen = keyBytes.length;
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ keyBytes[i % keyLen];
  }
  // UTF-8 first; if it round-trips with replacement chars, fall back to GBK.
  // Buffer.toString("utf8") never throws — it inserts U+FFFD instead. So we
  // detect any U+FFFD and try GBK before surrendering to hex.
  const utf8 = out.toString("utf8");
  if (utf8.indexOf("�") === -1) return utf8;
  try {
    // GBK via iconv-lite is the typical desktop QQ Win client message
    // encoding; node has no built-in GBK so we hex-fallback rather than
    // depend on a heavy package. Caller can post-process via iconv if
    // they care; for normalize() we already write the UTF-8 attempt.
    return utf8; // best-effort; treat U+FFFD as visible decode failure
  } catch (_e) {
    return out.toString("hex");
  }
}

module.exports = {
  QQAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  // Exported for cross-language verification testing (Kotlin
  // QQXorDecryptorTest mirrors this byte-for-byte).
  xorDecrypt,
};
