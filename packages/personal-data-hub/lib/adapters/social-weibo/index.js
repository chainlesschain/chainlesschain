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
 *   2. sqlite mode (opts.dbPath, legacy): Phase 13.2 device-pull path —
 *      reads Weibo Android app's SQLite (history / post / status / search_
 *      history). Preserved for backward compat with desktop sqlite-mode
 *      users; account.uid REQUIRED in this mode.
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
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_POST = "post";
const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const KIND_SEARCH = "search"; // legacy sqlite-mode only
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
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        post: true,
        favourite: true,
        follow: true,
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

    try {
      const posts =
        trySelect(db, "SELECT * FROM post ORDER BY created_at DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM status ORDER BY created_at DESC LIMIT 5000")
        || [];
      for (const row of posts) {
        yield {
          adapter: NAME,
          originalId: `post-${row.id || row.mid || row.idstr}`,
          capturedAt: parseTime(row.created_at || row.time),
          payload: { row, kind: KIND_POST },
        };
      }

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
  const text = row.text || "";
  const mid = row.mid || row.id || row.idstr || null;
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
            : row.reposts_count || row.repost || 0,
        commentsCount:
          row.commentsCount != null ? row.commentsCount
            : row.comments_count || row.comments || 0,
        likesCount:
          row.likesCount != null ? row.likesCount
            : row.attitudes_count || row.likes || 0,
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
  // Snapshot only — sqlite mode has no favourite kind (legacy parser merged
  // favourites into posts pre-A8). Payload: { kind:"favourite", mid, text,
  // capturedAt, authorScreenName }
  const text = p.text || "";
  const mid = p.mid || null;
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
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
        authorScreenName: p.authorScreenName || null,
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeFollow(p, raw, ingestedAt) {
  // Snapshot only — payload: { kind:"follow", uid, screenName, description,
  // avatarUrl, capturedAt }
  const followUid =
    (typeof p.uid === "number" && p.uid) ||
    (typeof p.uid === "string" && p.uid.length > 0 && p.uid) ||
    `unknown-${newId()}`;
  const screenName = p.screenName || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
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

module.exports = {
  WeiboAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
