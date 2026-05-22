/**
 * §A8 v0.2 — Xiaohongshu (小红书) adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-weibo/index.js dual-mode pattern:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's XhsLocalCollector (WebView + OkHttp +
 *      X-S signed requests). account.uid OPTIONAL at construction (snapshot
 *      file carries account).
 *
 *   2. sqlite mode (opts.dbPath, legacy): Phase 13.4 device-pull path —
 *      reads xhs Android app's SQLite (browse_history / liked_note /
 *      favourite / search_history). account.uid REQUIRED at sync time.
 *
 * Snapshot schema (mirrors XhsLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "5e8c..."  (xhs user_id hex string),
 *                  "numericUid": "1234"  (Long hash for sentinel),
 *                  "displayName": "alice" },
 *     "events": [
 *       { "kind": "note",   "id": "note-<noteId>", "capturedAt": <ms>,
 *         "title": "...", "noteId": "...", "desc": "...", "type": "normal|video",
 *         "likedCount": N, "collectedCount": N, "commentCount": N },
 *       { "kind": "liked",  "id": "liked-<noteId>", "capturedAt": <ms>,
 *         "title": "...", "noteId": "...", "authorNickname": "..." },
 *       { "kind": "follow", "id": "follow-<userId>", "capturedAt": <ms>,
 *         "userId": "...", "nickname": "...", "image": "..." }
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

const NAME = "social-xiaohongshu";
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_NOTE = "note";
const KIND_LIKED = "liked";
const KIND_FOLLOW = "follow";
// legacy sqlite-mode-only kinds (preserved for backward compat normalize path)
const KIND_HISTORY = "history";
const KIND_LIKE = "like";
const KIND_FAVOURITE = "favourite";
const VALID_SNAPSHOT_KINDS = Object.freeze([KIND_NOTE, KIND_LIKED, KIND_FOLLOW]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `xiaohongshu:${kind}:${safe}`;
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

class XiaohongshuAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid optional (snapshot mode pulls from file).
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:xhs-note",
      "parse:xhs-liked",
      "parse:xhs-follow",
      "parse:xhs-history",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "xhs:notes (own posts, title / desc / type / engagement counts)",
        "xhs:liked (notes the user liked)",
        "xhs:follow (followed users)",
        "xhs:history / search (legacy sqlite mode)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        note: true,
        liked: true,
        follow: true,
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
          message: "social-xiaohongshu.authenticate: sqlite mode requires account.uid",
        };
      }
      return { ok: true, account: this.account.uid, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-xiaohongshu.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
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
      "social-xiaohongshu.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
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
        `social-xiaohongshu.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
        ev.noteId ||
        ev.userId ||
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
        "social-xiaohongshu._syncViaSqlite: account.uid required",
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
        trySelect(db, "SELECT * FROM browse_history ORDER BY view_time DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM note ORDER BY view_time DESC LIMIT 5000")
        || [];
      for (const row of histories) {
        yield {
          adapter: NAME,
          originalId: `history-${row.id || row.note_id}`,
          capturedAt: parseTime(row.view_time),
          payload: { row, kind: KIND_HISTORY },
        };
      }
      const likes = trySelect(db, "SELECT * FROM liked_note ORDER BY like_time DESC LIMIT 5000") || [];
      for (const row of likes) {
        yield {
          adapter: NAME,
          originalId: `like-${row.id || row.note_id}`,
          capturedAt: parseTime(row.like_time),
          payload: { row, kind: KIND_LIKE },
        };
      }
      const favs = trySelect(db, "SELECT * FROM favourite ORDER BY save_time DESC LIMIT 5000") || [];
      for (const row of favs) {
        yield {
          adapter: NAME,
          originalId: `fav-${row.id || row.note_id}`,
          capturedAt: parseTime(row.save_time),
          payload: { row, kind: KIND_FAVOURITE },
        };
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("XiaohongshuAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    // Sqlite mode (legacy) — payload.row + kind in {history, like, favourite}
    if (kind === KIND_HISTORY || kind === KIND_LIKE || kind === KIND_FAVOURITE) {
      return normalizeSqliteRow(p, raw, ingestedAt);
    }

    // Snapshot mode
    if (kind === KIND_NOTE) return normalizeNote(p, raw, ingestedAt);
    if (kind === KIND_LIKED) return normalizeLiked(p, raw, ingestedAt);
    if (kind === KIND_FOLLOW) return normalizeFollow(p, raw, ingestedAt);
    throw new Error(`XiaohongshuAdapter.normalize: unknown kind ${kind}`);
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

function normalizeSqliteRow(p, raw, ingestedAt) {
  const { kind, row } = p;
  const occurredAt =
    parseTime(row.view_time || row.like_time || row.save_time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const subtypeMap = {
    [KIND_HISTORY]: EVENT_SUBTYPES.BROWSE,
    [KIND_LIKE]: EVENT_SUBTYPES.LIKE,
    [KIND_FAVOURITE]: EVENT_SUBTYPES.LIKE,
  };
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: subtypeMap[kind] || EVENT_SUBTYPES.BROWSE,
      occurredAt,
      actor: "person-self",
      content: { title: row.title || row.note_title || "(no title)" },
      ingestedAt,
      source,
      extra: {
        platform: "xiaohongshu",
        noteId: row.note_id || null,
        author: row.author || row.nickname || null,
        kind,
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeNote(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const title = p.title || "(no title)";
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.POST,
      occurredAt,
      actor: "person-self",
      content: {
        title,
        text: p.desc || "",
      },
      ingestedAt,
      source,
      extra: {
        platform: "xiaohongshu",
        noteId: p.noteId,
        type: p.type || "normal",
        likedCount: p.likedCount || 0,
        collectedCount: p.collectedCount || 0,
        commentCount: p.commentCount || 0,
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeLiked(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const title = p.title || "(no title)";
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
        platform: "xiaohongshu",
        noteId: p.noteId,
        authorNickname: p.authorNickname || null,
      },
    }],
    persons: [], places: [], items: [], topics: [],
  };
}

function normalizeFollow(p, raw, ingestedAt) {
  const followUid =
    (typeof p.userId === "string" && p.userId.length > 0 && p.userId) ||
    `unknown-${newId()}`;
  const nickname = p.nickname || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const person = {
    id: `person-xiaohongshu-${followUid}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [nickname],
    ingestedAt,
    source,
    identifiers: {
      "xiaohongshu-uid": [String(followUid)],
    },
    extra: {
      platform: "xiaohongshu",
      image: p.image || null,
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
  XiaohongshuAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
