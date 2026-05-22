/**
 * §A8 v0.2 — Douyin (抖音) adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-weibo / social-bilibili two-mode pattern, **but with a
 * smaller v0.2 surface because Douyin's web APIs gate behind X-Bogus + msToken
 * signatures**:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's DouyinLocalCollector (WebView cookie
 *      capture + 1 endpoint `passport/account/info/v2/` that works without
 *      X-Bogus). Desktop-independent. account.secUid OPTIONAL at construction
 *      — payload carries it.
 *
 *   2. sqlite mode (opts.dbPath, legacy): Phase 13.3 device-pull path —
 *      reads Douyin Android app's SQLite (video_history / user_favorite /
 *      search_history). Preserved for backward compat; account.uid REQUIRED.
 *
 * v0.2 KIND_PROFILE only. v0.3 KIND_HISTORY/KIND_FAVOURITE/KIND_LIKE will
 * land once the X-Bogus signature path is wired (likely via WebView JS
 * injection — Douyin signs every read endpoint and there is no pure-Kotlin
 * implementation that survives signature rotation).
 *
 * Snapshot schema (mirrors DouyinLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "secUid": "MS4wLjABA…", "shortId": "12345678",
 *                  "displayName": "alice" },
 *     "events": [
 *       { "kind": "profile", "id": "profile-<secUid>", "capturedAt": <ms>,
 *         "secUid": "MS4wLjABA…", "shortId": "12345678", "nickname": "…",
 *         "signature": "…",  // bio
 *         "followingCount": N, "followerCount": N,
 *         "awemeCount": N, "favoritingCount": N, "totalFavorited": N }
 *
 *       // v0.3 will add (X-Bogus path):
 *       // { "kind": "history",   "id": "history-<aweme>",  ... }
 *       // { "kind": "favourite", "id": "fav-<aweme>",      ... }
 *       // { "kind": "like",      "id": "like-<aweme>",     ... }
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

const NAME = "social-douyin";
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_HISTORY = "history";   // v0.3 (X-Bogus required)
const KIND_FAVOURITE = "favourite"; // v0.3 (X-Bogus required)
const KIND_LIKE = "like";         // v0.3 (X-Bogus required)
const KIND_SEARCH = "search";     // legacy sqlite-mode only

// Forward-compat: list every kind v0.3+ may emit so cc adapter accepts
// snapshots from a newer Android even if this JS hasn't been bumped yet.
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_PROFILE,
  KIND_HISTORY,
  KIND_FAVOURITE,
  KIND_LIKE,
]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `douyin:${kind}:${safe}`;
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

class DouyinAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid no longer required at construction — snapshot
    // mode pulls account from the snapshot file. Sqlite mode still requires
    // it at sync time.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:douyin-profile",
      "parse:douyin-history",   // v0.3
      "parse:douyin-favourite", // v0.3
      "parse:douyin-like",      // v0.3
      "parse:douyin-search",    // sqlite-only
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "douyin:profile (sec_user_id / nickname / signature / counts)",
        "douyin:history (aweme_id / title / author / view_time)",      // v0.3
        "douyin:favourite",                                            // v0.3
        "douyin:like",                                                 // v0.3
        "douyin:search_history (sqlite-mode only)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        profile: true,
        history: true,
        favourite: true,
        like: true,
      },
    };

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
          message: "social-douyin.authenticate: sqlite mode requires account.uid",
        };
      }
      return { ok: true, account: this.account.uid, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-douyin.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
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
      "social-douyin.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
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
        `social-douyin.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
        ev.secUid ||
        ev.awemeId ||
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
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-douyin._syncViaSqlite: account.uid required (set via new DouyinAdapter({ account: { uid } }) in cli wiring)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      const histories =
        trySelect(db, "SELECT * FROM video_history ORDER BY view_time DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM history ORDER BY view_time DESC LIMIT 5000")
        || [];
      for (const row of histories) {
        yield {
          adapter: NAME,
          originalId: `history-${row.id || row.aweme_id}`,
          capturedAt: parseTime(row.view_time),
          payload: { row, kind: KIND_HISTORY },
        };
      }
      const favs =
        trySelect(db, "SELECT * FROM user_favorite ORDER BY create_time DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM favourite ORDER BY time DESC LIMIT 5000")
        || [];
      for (const row of favs) {
        yield {
          adapter: NAME,
          originalId: `fav-${row.id || row.aweme_id}`,
          capturedAt: parseTime(row.create_time || row.time),
          payload: { row, kind: KIND_FAVOURITE },
        };
      }
      const searches =
        trySelect(db, "SELECT * FROM search_history ORDER BY time DESC LIMIT 5000")
        || [];
      for (const row of searches) {
        yield {
          adapter: NAME,
          originalId: `search-${row.id || row._id}`,
          capturedAt: parseTime(row.time),
          payload: { row, kind: KIND_SEARCH },
        };
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("DouyinAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (kind === KIND_PROFILE) {
      return normalizeProfile(p, raw, ingestedAt);
    }
    if (kind === KIND_HISTORY) {
      return normalizeHistory(p, raw, ingestedAt);
    }
    if (kind === KIND_FAVOURITE) {
      return normalizeFavourite(p, raw, ingestedAt);
    }
    if (kind === KIND_LIKE) {
      return normalizeLike(p, raw, ingestedAt);
    }
    if (kind === KIND_SEARCH) {
      return normalizeSearch(p, raw, ingestedAt);
    }
    throw new Error(`DouyinAdapter.normalize: unknown kind ${kind}`);
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

function normalizeProfile(p, raw, ingestedAt) {
  // v0.2 snapshot-only — produces a person record for the logged-in user
  // (person-self) carrying douyin-sec-uid identifier + stat counts in extra.
  // Repeated syncs dedupe on the same id; extra fields get refreshed.
  const secUid = p.secUid || (p.account && p.account.secUid) || null;
  const shortId = p.shortId || (p.account && p.account.shortId) || null;
  const nickname =
    p.nickname || (p.account && p.account.displayName) || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const identifiers = {};
  if (secUid) identifiers["douyin-sec-uid"] = [String(secUid)];
  if (shortId) identifiers["douyin-short-id"] = [String(shortId)];
  return {
    events: [],
    persons: [{
      id: secUid ? `person-douyin-${secUid}` : `person-douyin-self-${newId()}`,
      type: ENTITY_TYPES.PERSON,
      subtype: PERSON_SUBTYPES.SELF,
      names: [nickname],
      ingestedAt,
      source,
      identifiers,
      extra: {
        platform: "douyin",
        signature: p.signature || null,
        followingCount: p.followingCount || 0,
        followerCount: p.followerCount || 0,
        awemeCount: p.awemeCount || 0,
        favoritingCount: p.favoritingCount || 0,
        totalFavorited: p.totalFavorited || 0,
        snapshottedAt: occurredAt,
      },
    }],
    places: [], items: [], topics: [],
  };
}

function normalizeHistory(p, raw, ingestedAt) {
  // v0.3 — X-Bogus path. Snapshot fields: { kind:"history", awemeId, title,
  // author, capturedAt, duration }
  const awemeId = p.awemeId || p.aweme_id || (p.row && (p.row.aweme_id || p.row.id)) || null;
  const row = p.row || p;
  const title = row.title || row.desc || p.title || "(no title)";
  const author = row.author || row.nickname || p.author || null;
  const duration = row.duration || p.duration || null;
  const occurredAt =
    parseTime(p.capturedAt || row.view_time || row.time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw, occurredAt,
    p.row ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
  );
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.BROWSE,
      occurredAt,
      actor: "person-self",
      content: { title },
      ingestedAt,
      source,
      extra: {
        platform: "douyin",
        awemeId,
        author,
        duration,
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeFavourite(p, raw, ingestedAt) {
  // v0.3 — X-Bogus path. Snapshot fields: { kind:"favourite", awemeId, title,
  // author, capturedAt }
  const awemeId = p.awemeId || p.aweme_id || (p.row && (p.row.aweme_id || p.row.id)) || null;
  const row = p.row || p;
  const title = row.title || row.desc || p.title || "(no title)";
  const author = row.author || row.nickname || p.author || null;
  const occurredAt =
    parseTime(p.capturedAt || row.create_time || row.time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw, occurredAt,
    p.row ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
  );
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.LIKE,
      occurredAt,
      actor: "person-self",
      content: { title },
      ingestedAt,
      source,
      extra: {
        platform: "douyin",
        awemeId,
        author,
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeLike(p, raw, ingestedAt) {
  // v0.3 — X-Bogus path. Same shape as favourite; semantic diff = a 赞 vs 收藏.
  const awemeId = p.awemeId || (p.row && p.row.aweme_id) || null;
  const title = p.title || (p.row && (p.row.title || p.row.desc)) || "(no title)";
  const author = p.author || (p.row && (p.row.author || p.row.nickname)) || null;
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.LIKE,
      occurredAt,
      actor: "person-self",
      content: { title },
      ingestedAt,
      source,
      extra: { platform: "douyin", awemeId, author },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeSearch(p, raw, ingestedAt) {
  // sqlite-mode only — payload.row.keyword / row.query
  const row = p.row || {};
  const occurredAt = parseTime(row.time || row.create_time) || ingestedAt;
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

module.exports = {
  DouyinAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
