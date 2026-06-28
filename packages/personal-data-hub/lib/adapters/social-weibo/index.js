/**
 * §A8 v0.2 — Weibo (微博) adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-bilibili/adapter.js two-mode pattern:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's WeiboLocalCollector (WebView + OkHttp).
 *      Desktop-independent path. Adapter is stateless when in snapshot mode
 *      — account.uid is OPTIONAL at construction (the snapshot file carries
 *      account in payload).
 *
 *   2. sqlite mode (opts.dbPath): desktop device-pull path — reads the Weibo
 *      Android app's plain SQLite DB `com.sina.weibo/databases/sina_weibo`.
 *      account.uid REQUIRED in this mode.
 *
 *      Table/column names are DEVICE-VERIFIED against a real install
 *      (Redmi M2104K10AC, 微博 16.5.3, 2026-06-16):
 *        - posts      → `home_table` (timeline cache; own posts = uid==selfUid)
 *                       cols: mblogid / uid / content / time / rtnum /
 *                       commentnum / attitudenum / src / longitude / latitude
 *        - favourites → `like_table`   cols: mblogid / content / time / nick
 *        - follows    → `follower_table` (following=1 ⇒ accounts the user
 *                       follows) cols: user_id / screen_name / remark / gender
 *      The legacy `post`/`status`/`search_history` queries are kept as
 *      FALLBACKS (older builds) — on a modern device those tables don't
 *      exist so the adapter previously collected ZERO. Row VALUES were not
 *      validated (verification account was empty); column semantics use the
 *      standard Weibo schema. See memory pdh_collector_completeness_audit.
 *
 * Snapshot schema (mirrors WeiboLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "post",      "id": "post-<mid>",  "capturedAt": <ms>,
 *         "text": "...", "mid": "...", "source": "...",
 *         "repostsCount": N, "commentsCount": N, "likesCount": N, "picCount": N },
 *       { "kind": "favourite", "id": "fav-<mid>",   "capturedAt": <ms>,
 *         "text": "...", "mid": "...", "authorScreenName": "..." },
 *       { "kind": "follow",    "id": "follow-<uid>", "capturedAt": <ms>,
 *         "uid": <num>, "screenName": "...", "description": "...", "avatarUrl": "..." }
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

const NAME = "social-weibo";
const VERSION = "0.8.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_POST = "post";
const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const KIND_SEARCH = "search"; // legacy sqlite-mode only
// Private-message (私信) kinds — read from the sibling `message_<uid>.db`
// (device-verified schema 2026-06-28: t_buddy/t_session/t_message). Opt-in
// (opts.includeDm) because DMs are high-sensitivity. See
// docs/internal/pdh-app-db-schemas.md → 微博 message_<uid>.db.
const KIND_DM_BUDDY = "dm-buddy"; // t_buddy   → PERSON(CONTACT)
const KIND_DM_SESSION = "dm-session"; // t_session → TOPIC
const KIND_DM_MESSAGE = "dm-message"; // t_message → EVENT(MESSAGE)
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_POST, KIND_FAVOURITE, KIND_FOLLOW]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `weibo:${kind}:${safe}`;
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
  try { return db.prepare(sql).all(); } catch (_e) { return null; }
}

class WeiboAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid now OPTIONAL at construction — snapshot mode is
    // stateless and pulls account from the snapshot file. Sqlite mode (legacy
    // device-pull) still requires it; checked at sync time, not construction.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:weibo-posts",
      "parse:weibo-favourite",
      "parse:weibo-follow",
      "parse:weibo-search",
    ];
    // Existing desktop wiring may key off this — kept as device-pull (the
    // sqlite mode is the desktop-side; snapshot mode is in-APK Android).
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "weibo:posts (text / created_at / reposts_count / comments_count / likes)",
        "weibo:favourite (mid / text / author)",
        "weibo:follow (uid / screen_name)",
        "weibo:search_history (legacy sqlite mode)",
        "weibo:dm-buddy (uid / nick / remark) — HIGH sensitivity, opt-in (includeDm)",
        "weibo:dm-session (session_id / unread) — HIGH sensitivity, opt-in",
        "weibo:dm-message (time / outgoing / content) — HIGH sensitivity, opt-in",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        post: true,
        favourite: true,
        follow: true,
        // Private messages are off by default — require opts.includeDm:true.
        dm: false,
      },
    };

    // _deps injection seam for tests (vi.mock fs/ doesn't intercept require in
    // inlined CJS — see .claude/rules/testing.md).
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
      if (!this.account || !this.account.uid) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_UID",
          message: "social-weibo.authenticate: sqlite mode requires account.uid",
        };
      }
      return { ok: true, account: this.account.uid, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-weibo.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
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
      "social-weibo.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
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
        `social-weibo.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
        ev.mid ||
        ev.uid ||
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
    // Legacy Phase 13.2 path — requires account.uid in constructor and a DB
    // pulled via the desktop AndroidExtractor.
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-weibo._syncViaSqlite: account.uid required (set via new WeiboAdapter({ account: { uid } }) in cli wiring)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    // selfUid sanitised to digits — interpolated into a WHERE clause and
    // sourced from wiring config (numeric uin). Defensive against injection.
    const selfUid = String(this.account.uid).replace(/[^0-9]/g, "");

    try {
      // POSTS — device-verified `home_table` (own posts = uid==selfUid);
      // legacy `post`/`status` kept as fallback for older builds.
      const posts =
        (selfUid &&
          trySelect(
            db,
            `SELECT * FROM home_table WHERE uid='${selfUid}' ORDER BY time DESC LIMIT 5000`,
          )) ||
        trySelect(db, "SELECT * FROM post ORDER BY created_at DESC LIMIT 5000") ||
        trySelect(db, "SELECT * FROM status ORDER BY created_at DESC LIMIT 5000") ||
        [];
      for (const row of posts) {
        yield {
          adapter: NAME,
          originalId: `post-${row.mblogid || row.id || row.mid || row.idstr}`,
          capturedAt: parseTime(row.time || row.created_at),
          payload: { row, kind: KIND_POST },
        };
      }

      // FAVOURITES — device-verified `like_table` (the account's likes).
      // Legacy sqlite had no favourite path (folded into posts pre-A8).
      const favourites =
        trySelect(db, "SELECT * FROM like_table ORDER BY time DESC LIMIT 5000") || [];
      for (const row of favourites) {
        yield {
          adapter: NAME,
          originalId: `fav-${row.mblogid || row.id}`,
          capturedAt: parseTime(row.time),
          payload: { row, kind: KIND_FAVOURITE },
        };
      }

      // FOLLOWS — device-verified `follower_table`; following=1 ⇒ accounts
      // the user follows (vs followers). Fallback to the whole table.
      const follows =
        trySelect(
          db,
          "SELECT * FROM follower_table WHERE following=1 ORDER BY user_id LIMIT 5000",
        ) ||
        trySelect(db, "SELECT * FROM follower_table LIMIT 5000") ||
        [];
      for (const row of follows) {
        yield {
          adapter: NAME,
          originalId: `follow-${row.user_id || row.id}`,
          capturedAt: parseTime(row.time) || Date.now(),
          payload: { row, kind: KIND_FOLLOW },
        };
      }

      // SEARCH — legacy only (`search_history` doesn't exist on modern
      // weibo; trySelect returns null gracefully, loop is skipped).
      const searches =
        trySelect(db, "SELECT * FROM search_history ORDER BY time DESC LIMIT 5000")
        || [];
      for (const row of searches) {
        yield {
          adapter: NAME,
          originalId: `search-${row.id || row._id}`,
          capturedAt: parseTime(row.time || row.create_at),
          payload: { row, kind: KIND_SEARCH },
        };
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }

    // Private messages live in a SEPARATE sibling DB `message_<uid>.db`.
    // High-sensitivity → opt-in only (opts.includeDm === true).
    if (opts.includeDm === true) {
      yield* this._syncDmMessages(opts, selfUid);
    }
  }

  // Reads the Weibo private-message DB `message_<uid>.db` (a sibling of the
  // `sina_weibo` file, or opts.messageDbPath). device-verified schema:
  //   t_buddy   → PERSON  (DM contacts: uid/nick/remark/screen_name)
  //   t_session → TOPIC   (conversation threads: session_id/type/update_time)
  //   t_message → EVENT   (messages: time/outgoing/content_type/content/sender_id)
  // Columns confirmed against a real populated device (2026-06-28); t_message
  // content encoding is best-effort (no rows on the reference account).
  async *_syncDmMessages(opts, selfUid) {
    const path = require("node:path");
    const baseDbPath = opts.dbPath || this._dbPath;
    const msgDbPath =
      opts.messageDbPath ||
      (baseDbPath
        ? path.join(path.dirname(baseDbPath), `message_${selfUid}.db`)
        : null);
    if (!msgDbPath || !this._deps.fs.existsSync(msgDbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(msgDbPath, { readonly: true });
    try {
      // BUDDIES → PERSON
      const buddies = trySelect(db, "SELECT * FROM t_buddy LIMIT 5000") || [];
      for (const row of buddies) {
        if (row.uid == null) continue;
        yield {
          adapter: NAME,
          originalId: `dm-buddy-${row.uid}`,
          capturedAt: Date.now(),
          payload: { row, kind: KIND_DM_BUDDY },
        };
      }
      // SESSIONS → TOPIC
      const sessions =
        trySelect(
          db,
          "SELECT * FROM t_session ORDER BY update_time DESC LIMIT 5000",
        ) || [];
      for (const row of sessions) {
        if (row.session_id == null) continue;
        yield {
          adapter: NAME,
          originalId: `dm-session-${row.session_id}`,
          capturedAt: parseTime(row.update_time) || Date.now(),
          payload: { row, kind: KIND_DM_SESSION },
        };
      }
      // MESSAGES → EVENT (content best-effort; schema device-verified)
      const messages =
        trySelect(
          db,
          "SELECT * FROM t_message ORDER BY time DESC LIMIT 10000",
        ) || [];
      for (const row of messages) {
        yield {
          adapter: NAME,
          originalId: `dm-msg-${row.global_id || row.id}`,
          capturedAt: parseTime(row.time) || Date.now(),
          payload: { row, kind: KIND_DM_MESSAGE },
        };
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("WeiboAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    // Sqlite-mode payload carries `row`; snapshot-mode payload carries fields
    // directly. The normalizers below handle both shapes.
    if (kind === KIND_SEARCH) {
      return normalizeSearch(p, raw, ingestedAt);
    }
    if (kind === KIND_POST) {
      return normalizePost(p, raw, ingestedAt);
    }
    if (kind === KIND_FAVOURITE) {
      return normalizeFavourite(p, raw, ingestedAt);
    }
    if (kind === KIND_FOLLOW) {
      return normalizeFollow(p, raw, ingestedAt);
    }
    if (kind === KIND_DM_BUDDY) {
      return normalizeDmBuddy(p, raw, ingestedAt);
    }
    if (kind === KIND_DM_SESSION) {
      return normalizeDmSession(p, raw, ingestedAt);
    }
    if (kind === KIND_DM_MESSAGE) {
      return normalizeDmMessage(p, raw, ingestedAt);
    }
    throw new Error(`WeiboAdapter.normalize: unknown kind ${kind}`);
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

function normalizeSearch(p, raw, ingestedAt) {
  // Sqlite-mode only: payload.row.keyword / row.query
  const row = p.row || {};
  const occurredAt = parseTime(row.time || row.create_at) || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.INTERACTION,
      occurredAt,
      actor: "person-self",
      content: {
        title: `搜索: ${row.keyword || row.query || ""}`,
        text: row.keyword || row.query || "",
      },
      ingestedAt,
      source,
      extra: { query: row.keyword || row.query, fromAdapter: NAME },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizePost(p, raw, ingestedAt) {
  // Snapshot mode: { kind:"post", text, mid, source, repostsCount, … } direct
  // Sqlite mode:   { kind:"post", row: { text, mid, ... } }
  const row = p.row || p;
  const isSnapshot = !p.row;
  // home_table (device-verified) stores body in `content`, id in `mblogid`.
  const text = row.text || row.content || "";
  const mid = row.mid || row.mblogid || row.id || row.idstr || null;
  const occurredAt =
    parseTime(row.created_at || row.createdAt || row.time || raw.capturedAt) ||
    ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    isSnapshot ? CAPTURED_BY.API : CAPTURED_BY.SQLITE,
  );
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.POST,
      occurredAt,
      actor: "person-self",
      content: {
        title: (text || "").slice(0, 80) || "(空)",
        text,
      },
      ingestedAt,
      source,
      extra: {
        weiboMid: mid,
        repostsCount:
          row.repostsCount != null ? row.repostsCount
            : row.reposts_count || row.repost || row.rtnum || 0,
        commentsCount:
          row.commentsCount != null ? row.commentsCount
            : row.comments_count || row.comments || row.commentnum || 0,
        likesCount:
          row.likesCount != null ? row.likesCount
            : row.attitudes_count || row.likes || row.attitudenum || 0,
        picCount: row.picCount || row.pic_num || 0,
        source: row.source || null,
        location: row.location || row.geo || null,
        platform: "weibo",
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeFavourite(p, raw, ingestedAt) {
  // Snapshot: { kind:"favourite", mid, text, capturedAt, authorScreenName }
  // Sqlite (device-verified `like_table`): { row: { mblogid, content, time,
  // nick } }. Both shapes handled below.
  const row = p.row || null;
  const isSqlite = !!row;
  const text = isSqlite ? (row.content || "") : (p.text || "");
  const mid = isSqlite ? (row.mblogid || row.id || null) : (p.mid || null);
  const occurredAt = isSqlite
    ? (parseTime(row.time) || raw.capturedAt || ingestedAt)
    : (parseTime(p.capturedAt) || raw.capturedAt || ingestedAt);
  const source = buildSource(
    raw,
    occurredAt,
    isSqlite ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
  );
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.LIKE,
      occurredAt,
      actor: "person-self",
      content: {
        title: (text || "").slice(0, 80) || "(空)",
        text,
      },
      ingestedAt,
      source,
      extra: {
        platform: "weibo",
        weiboMid: mid,
        authorScreenName: isSqlite
          ? (row.nick || null)
          : (p.authorScreenName || null),
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeFollow(p, raw, ingestedAt) {
  // Snapshot: { kind:"follow", uid, screenName, description, avatarUrl,
  //   capturedAt }
  // Sqlite (device-verified `follower_table`): { row: { user_id|id,
  //   screen_name, remark, gender } }. Both shapes handled below.
  const row = p.row || null;
  const isSqlite = !!row;
  const rawUid = isSqlite ? (row.user_id || row.id) : p.uid;
  const followUid =
    (typeof rawUid === "number" && rawUid) ||
    (typeof rawUid === "string" && rawUid.length > 0 && rawUid) ||
    `unknown-${newId()}`;
  const screenName = isSqlite
    ? (row.screen_name || row.remark || "(unnamed)")
    : (p.screenName || "(unnamed)");
  const occurredAt = isSqlite
    ? (parseTime(row.time) || raw.capturedAt || ingestedAt)
    : (parseTime(p.capturedAt) || raw.capturedAt || ingestedAt);
  const source = buildSource(
    raw,
    occurredAt,
    isSqlite ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
  );
  const person = {
    id: `person-weibo-${followUid}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [screenName],
    ingestedAt,
    source,
    identifiers: {
      "weibo-uid": [String(followUid)],
    },
    extra: {
      platform: "weibo",
      description: p.description || null,
      avatarUrl: p.avatarUrl || null,
      followedAt: occurredAt,
    },
  };
  return {
    events: [],
    persons: [person],
    places: [],
    items: [],
    topics: [],
  };
}

// ─── Private-message (私信) normalizers — device-verified message_<uid>.db ──

function normalizeDmBuddy(p, raw, ingestedAt) {
  const row = p.row || {};
  const uid = row.uid != null ? String(row.uid) : `unknown-${newId()}`;
  const name = row.remark || row.screen_name || row.nick || "(unnamed)";
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const person = {
    id: `person-weibo-${uid}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [String(name)],
    ingestedAt,
    source,
    identifiers: { "weibo-uid": [uid] },
    extra: {
      platform: "weibo",
      via: "dm",
      gender: row.gender != null ? row.gender : null,
      verified: row.verified === 1 || row.verified === true || null,
      follower: typeof row.follower === "number" ? row.follower : null,
      following: typeof row.following === "number" ? row.following : null,
    },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

function normalizeDmSession(p, raw, ingestedAt) {
  const row = p.row || {};
  const sid = row.session_id != null ? String(row.session_id) : `unknown-${newId()}`;
  const occurredAt = parseTime(row.update_time) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const topic = {
    id: `topic-weibo-dm-${sid}`,
    type: ENTITY_TYPES.TOPIC,
    name: `微博私信会话 ${sid}`,
    ingestedAt,
    source,
    extra: {
      platform: "weibo",
      via: "dm",
      sessionId: sid,
      sessionType: row.type != null ? row.type : null,
      unread: typeof row.im_unread_count === "number" ? row.im_unread_count : null,
      lastUpdate: occurredAt,
    },
  };
  return { events: [], persons: [], places: [], items: [], topics: [topic] };
}

function normalizeDmMessage(p, raw, ingestedAt) {
  const row = p.row || {};
  const occurredAt = parseTime(row.time) || raw.capturedAt || ingestedAt;
  const outgoing = row.outgoing === 1 || row.outgoing === true;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  // content is plain text for text messages (content_type 0/1/null); other
  // types carry structured/empty content → emit a typed placeholder. Encoding
  // is device-verified-schema but best-effort (no rows on reference account).
  const isText =
    row.content_type == null || row.content_type === 0 || row.content_type === 1;
  const rawText =
    isText && typeof row.content === "string" && row.content.length > 0
      ? row.content
      : `[${row.content_type != null ? `type:${row.content_type}` : "non-text"}]`;
  const text = rawText.length > 2000 ? rawText.slice(0, 2000) + "…" : rawText;
  const event = {
    id: `event-weibo-dm-${row.global_id || row.id || newId()}`,
    type: ENTITY_TYPES.EVENT,
    subtype: EVENT_SUBTYPES.MESSAGE,
    occurredAt,
    ingestedAt,
    source,
    actor: outgoing ? "self" : "contact",
    content: { text },
    extra: {
      platform: "weibo",
      via: "dm",
      sessionId: row.session_id != null ? String(row.session_id) : null,
      senderId: row.sender_id != null ? String(row.sender_id) : null,
      contentType: row.content_type != null ? row.content_type : null,
      outgoing,
    },
  };
  return { events: [event], persons: [], places: [], items: [], topics: [] };
}

module.exports = {
  WeiboAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
