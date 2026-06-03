"use strict";

/**
 * BilibiliAdapter — A8 v0.1 (2026-05-22)
 *
 * Two sync modes, mutually exclusive based on opts:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's own WebView+OkHttp pipeline. This is
 *      the desktop-independent path for Plan A v0.1; Android does cookie
 *      capture + HTTP fetch + parsing in Kotlin, then writes the snapshot
 *      to filesDir and asks LocalCcRunner to ingest it. Adapter is stateless.
 *
 *   2. sqlite mode (opts.dbPath, legacy): Phase 7.5 AndroidExtractor pulled
 *      the app DB via `adb backup`; this mode parses `history` + `bili_favourite`
 *      tables. Retained for backward compat — desktop users with rooted devices
 *      can still go this route.
 *
 * Snapshot schema (mirrors Android-side BilibiliLocalCollector.SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "history",   "id": "BV1xx", "capturedAt": <ms>,
 *         "title": "...", "bvid": "...", "avid": ..., "duration": ...,
 *         "uploader": "...", "uploaderMid": ..., "part": "..." },
 *       { "kind": "favourite", "id": "fav-<bvid>", "capturedAt": <ms>,
 *         "title": "...", "bvid": "...", "folderName": "...", "uploader": "..." },
 *       { "kind": "dynamic",   "id": "dyn-<rid>", "capturedAt": <ms>,
 *         "summary": "...", "dynamicType": "video|text|image|...",
 *         "authorMid": ..., "authorName": "..." },
 *       { "kind": "follow",    "id": "follow-<mid>", "capturedAt": <ms>,
 *         "mid": "...", "uname": "...", "face": "...", "sign": "..." }
 *     ]
 *   }
 */

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "social-bilibili";
const VERSION = "0.6.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_HISTORY = "history";
const KIND_FAVOURITE = "favourite";
const KIND_DYNAMIC = "dynamic";
const KIND_FOLLOW = "follow";
const VALID_KINDS = Object.freeze([
  KIND_HISTORY,
  KIND_FAVOURITE,
  KIND_DYNAMIC,
  KIND_FOLLOW,
]);

function stableOriginalId(kind, id) {
  // Coerce numeric IDs to string — Bilibili APIs return mid/avid/rid as
  // integers, but originalId is a string in raw_events schema. Without this
  // coercion, `typeof 999 === "string"` is false → falls to unknown- prefix
  // and breaks idempotency across syncs (every sync emits a new "unknown-"
  // ID, raw_events table grows unbounded).
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `bilibili:${kind}:${safe}`;
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

class BilibiliAdapter {
  constructor(opts = {}) {
    // Stateless in snapshot mode — account.uid optional. Sqlite-mode still
    // requires it (the legacy path before A8); see _syncViaSqlite below.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:bilibili-history",
      "parse:bilibili-favourite",
      "parse:bilibili-dynamic",
      "parse:bilibili-follow",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "bilibili:history (avid / bvid / title / view_at / duration / uploader)",
        "bilibili:favourite (folder / video / save_time / uploader)",
        "bilibili:dynamic (rid / type / summary / author)",
        "bilibili:follow (mid / uname / face)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        history: true,
        favourite: true,
        dynamic: true,
        follow: true,
      },
    };

    // _deps injection seam (see .claude/rules/cli-dev.md — vi.mock("fs") does
    // not intercept require under inlined CJS; tests override via _deps).
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
      return { ok: true, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-bilibili.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    // Snapshot mode takes priority — the in-APK Android cc path always passes
    // inputPath. Sqlite mode is the legacy Phase 7.5 desktop path; only kicks
    // in when caller explicitly provides dbPath (no auto-engage to avoid
    // surprising desktop users who upgrade from sqlite-only adapter).
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
      "social-bilibili.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, Phase 7.5 desktop extractor)"
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
        `social-bilibili.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`
      );
    }
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();

    const account = snapshot.account && typeof snapshot.account === "object"
      ? snapshot.account
      : null;
    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;

    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    let emitted = 0;
    for (const ev of events) {
      if (emitted >= limit) return;
      if (!ev || typeof ev !== "object") continue;
      const kind = ev.kind;
      if (!VALID_KINDS.includes(kind)) continue;
      // Per-kind include gate. Default: include everything.
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) ||
        parseTime(ev.time) ||
        fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        ev.bvid ||
        ev.mid ||
        ev.rid ||
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
    // Legacy Phase 7.5 path — requires account.uid in constructor and a DB
    // pulled via the desktop AndroidExtractor. Preserved verbatim from the
    // pre-A8 adapter so existing desktop users don't regress.
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-bilibili._syncViaSqlite: account.uid required (set via new BilibiliAdapter({ account: { uid } }) in cli wiring)"
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      const history = trySelect(db, "SELECT * FROM history ORDER BY view_at DESC LIMIT 5000") || [];
      for (const row of history) {
        yield {
          adapter: NAME,
          kind: KIND_HISTORY,
          originalId: stableOriginalId(
            KIND_HISTORY,
            row.id || row._id || row.kid || row.bvid || row.avid
          ),
          capturedAt: parseTime(row.view_at || row.create_at || row.time),
          payload: {
            kind: KIND_HISTORY,
            title: row.title || row.video_title,
            bvid: row.bvid,
            avid: row.avid,
            duration: row.duration || row.progress,
            uploader: row.uploader || row.up_name,
            part: row.part_name,
            _row: row,
          },
        };
      }
      const favs = trySelect(db, "SELECT * FROM bili_favourite ORDER BY save_time DESC LIMIT 5000") || [];
      for (const row of favs) {
        yield {
          adapter: NAME,
          kind: KIND_FAVOURITE,
          originalId: stableOriginalId(
            KIND_FAVOURITE,
            row.id || row.fav_id || row.bvid
          ),
          capturedAt: parseTime(row.save_time || row.time),
          payload: {
            kind: KIND_FAVOURITE,
            title: row.title || row.video_title,
            bvid: row.bvid,
            avid: row.avid,
            folderName: row.folder_name,
            uploader: row.uploader || row.up_name,
            _row: row,
          },
        };
      }
    } finally {
      try { db.close(); } catch (_e) { /* ignore */ }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("BilibiliAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;
    const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: raw.capturedAt || occurredAt,
      capturedBy: CAPTURED_BY.API,
      originalId: raw.originalId,
    };

    if (kind === KIND_HISTORY) {
      return normalizeHistory(p, source, occurredAt, ingestedAt);
    }
    if (kind === KIND_FAVOURITE) {
      return normalizeFavourite(p, source, occurredAt, ingestedAt);
    }
    if (kind === KIND_DYNAMIC) {
      return normalizeDynamic(p, source, occurredAt, ingestedAt);
    }
    if (kind === KIND_FOLLOW) {
      return normalizeFollow(p, source, occurredAt, ingestedAt);
    }
    throw new Error(`BilibiliAdapter.normalize: unknown kind ${kind}`);
  }
}

function normalizeHistory(p, source, occurredAt, ingestedAt) {
  const title = p.title || "(no title)";
  const bvid = p.bvid || null;
  const itemId = bvid ? `item-bilibili-video-${bvid}` : `item-bilibili-video-${newId()}`;
  const item = {
    id: itemId,
    type: ENTITY_TYPES.ITEM,
    subtype: ITEM_SUBTYPES.MEDIA,
    name: title,
    ingestedAt,
    source,
    extra: {
      kind: "bilibili-video",
      bvid,
      avid: p.avid || null,
      uploader: p.uploader || null,
      uploaderMid: p.uploaderMid || null,
    },
  };
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
        platform: "bilibili",
        bvid,
        avid: p.avid || null,
        duration: p.duration || null,
        uploader: p.uploader || null,
        part: p.part || null,
        itemRef: itemId,
      },
    }],
    persons: [],
    places: [],
    items: [item],
    topics: [],
  };
}

function normalizeFavourite(p, source, occurredAt, ingestedAt) {
  const title = p.title || "(no title)";
  const bvid = p.bvid || null;
  const itemId = bvid ? `item-bilibili-video-${bvid}` : `item-bilibili-video-${newId()}`;
  const item = {
    id: itemId,
    type: ENTITY_TYPES.ITEM,
    subtype: ITEM_SUBTYPES.MEDIA,
    name: title,
    ingestedAt,
    source,
    extra: {
      kind: "bilibili-video",
      bvid,
      avid: p.avid || null,
      uploader: p.uploader || null,
    },
  };
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
        platform: "bilibili",
        bvid,
        avid: p.avid || null,
        folderName: p.folderName || null,
        uploader: p.uploader || null,
        itemRef: itemId,
      },
    }],
    persons: [],
    places: [],
    items: [item],
    topics: [],
  };
}

function normalizeDynamic(p, source, occurredAt, ingestedAt) {
  const summary = p.summary || p.content || "(no summary)";
  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.BROWSE,
      occurredAt,
      actor: "person-self",
      content: { title: summary.slice(0, 200) },
      ingestedAt,
      source,
      extra: {
        platform: "bilibili",
        dynamicType: p.dynamicType || "unknown",
        rid: p.rid || null,
        authorMid: p.authorMid || null,
        authorName: p.authorName || null,
        summary,
      },
    }],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeFollow(p, source, occurredAt, ingestedAt) {
  const mid =
    (typeof p.mid === "string" && p.mid) ||
    (typeof p.mid === "number" && String(p.mid)) ||
    `unknown-${newId()}`;
  const uname = p.uname || "(unnamed)";
  const person = {
    id: `person-bilibili-${mid}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [uname],
    ingestedAt,
    source,
    identifiers: {
      "bilibili-mid": [mid],
    },
    extra: {
      platform: "bilibili",
      face: p.face || null,
      sign: p.sign || null,
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
  BilibiliAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
};
