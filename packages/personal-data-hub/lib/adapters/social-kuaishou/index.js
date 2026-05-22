/**
 * §A8 v0.2 — Kuaishou (快手) adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-toutiao v0.2 two-mode pattern:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's KuaishouLocalCollector (root-required
 *      SQLCipher decrypt of /data/data/com.smile.gifmaker/databases/ on
 *      Phase 13.10 real-device E2E). Desktop-independent; account.uid
 *      OPTIONAL at construction — payload carries it.
 *
 *   2. sqlite mode (opts.dbPath, legacy): Phase 13.9 device-pull path —
 *      desktop reads the pulled DB directly. account.uid REQUIRED in this
 *      mode (lazy-checked at sync time).
 *
 * Snapshot schema (mirrors KuaishouLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "watch",   "id": "photo-<photoId>",   "capturedAt": <ms>,
 *         "photoId": "...", "caption": "...", "duration": N,
 *         "authorId": "...", "authorName": "..." },
 *       { "kind": "collect", "id": "collect-<photoId>", "capturedAt": <ms>,
 *         "photoId": "...", "caption": "...",
 *         "authorId": "...", "authorName": "..." },
 *       { "kind": "search",  "id": "search-<kw>:<ts>",  "capturedAt": <ms>,
 *         "keyword": "...", "searchAt": <ms> }
 *     ]
 *   }
 *
 * Sensitivity: "medium" — short-video watch history mainly reveals
 * entertainment preference (vs Toutiao's news-reading which goes "high").
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "social-kuaishou";
const VERSION = "0.2.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_WATCH = "watch";
const KIND_COLLECT = "collect";
const KIND_SEARCH = "search";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_WATCH,
  KIND_COLLECT,
  KIND_SEARCH,
]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  const safe =
    stringified ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `kuaishou:${kind}:${safe}`;
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

class KuaishouAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid OPTIONAL at construction — snapshot mode is
    // stateless. Sqlite mode lazy-checks at sync time.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:kuaishou-photo-history",
      "parse:kuaishou-user-collect",
      "parse:kuaishou-search",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "kuaishou:photo_history (photo_id / caption / view_time / duration / author_id)",
        "kuaishou:user_collect (photo_id / caption / collect_time)",
        "kuaishou:search_record (keyword / search_time)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        watch: true,
        collect: true,
        search: true,
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
          message:
            "social-kuaishou.authenticate: sqlite mode requires account.uid",
        };
      }
      return { ok: true, account: this.account.uid, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-kuaishou.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
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
      "social-kuaishou.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
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
        `social-kuaishou.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
        ev.photoId ||
        ev.keyword ||
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
        "social-kuaishou._syncViaSqlite: account.uid required (set via new KuaishouAdapter({ account: { uid } }) in cli wiring)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      const watched =
        trySelect(
          db,
          "SELECT * FROM photo_history ORDER BY view_time DESC LIMIT 5000",
        ) || [];
      for (const row of watched) {
        yield {
          adapter: NAME,
          originalId: `photo-${row.id || row._id || row.photo_id}`,
          capturedAt: parseTime(row.view_time || row.time || row.create_time),
          payload: { row, kind: KIND_WATCH },
        };
      }

      const collected =
        trySelect(
          db,
          "SELECT * FROM user_collect ORDER BY collect_time DESC LIMIT 5000",
        ) || [];
      for (const row of collected) {
        yield {
          adapter: NAME,
          originalId: `collect-${row.id || row.photo_id}`,
          capturedAt: parseTime(row.collect_time || row.time),
          payload: { row, kind: KIND_COLLECT },
        };
      }

      const searches =
        trySelect(
          db,
          "SELECT * FROM search_record ORDER BY search_time DESC LIMIT 5000",
        ) || [];
      for (const row of searches) {
        yield {
          adapter: NAME,
          originalId: `search-${row.id || row.keyword + ":" + row.search_time}`,
          capturedAt: parseTime(row.search_time || row.time),
          payload: { row, kind: KIND_SEARCH },
        };
      }
    } finally {
      try {
        db.close();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("KuaishouAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (kind === KIND_COLLECT) {
      return normalizeCollect(p, raw, ingestedAt);
    }
    if (kind === KIND_SEARCH) {
      return normalizeSearch(p, raw, ingestedAt);
    }
    if (kind === KIND_WATCH) {
      return normalizeWatch(p, raw, ingestedAt);
    }
    throw new Error(`KuaishouAdapter.normalize: unknown kind ${kind}`);
  }
}

function buildSource(raw, occurredAt, capturedBy) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy,
  };
}

function pickField(p, snapshotKey, ...sqlKeys) {
  if (p[snapshotKey] != null) return p[snapshotKey];
  const row = p.row || {};
  for (const k of sqlKeys) {
    if (row[k] != null) return row[k];
  }
  return null;
}

function normalizeWatch(p, raw, ingestedAt) {
  if (!p.row && !p.photoId && !p.caption) {
    if (!p.row) {
      throw new Error("KuaishouAdapter.normalize: row missing");
    }
  }
  const isSnapshot = !p.row;
  const row = p.row || {};
  const caption =
    pickField(p, "caption", "caption", "title") || "(no caption)";
  const occurredAt =
    parseTime(p.capturedAt) ||
    parseTime(row.view_time || row.time || row.create_time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    isSnapshot ? CAPTURED_BY.API : CAPTURED_BY.SQLITE,
  );
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.BROWSE,
        occurredAt,
        actor: "person-self",
        content: { title: caption },
        ingestedAt,
        source,
        extra: {
          platform: "kuaishou",
          photoId: pickField(p, "photoId", "photo_id"),
          duration: pickField(p, "duration", "duration", "play_duration"),
          authorId: pickField(p, "authorId", "author_id"),
          authorName: pickField(p, "authorName", "author_name"),
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeCollect(p, raw, ingestedAt) {
  if (!p.row && !p.photoId && !p.caption) {
    if (!p.row) {
      throw new Error("KuaishouAdapter.normalize: row missing");
    }
  }
  const isSnapshot = !p.row;
  const row = p.row || {};
  const caption =
    pickField(p, "caption", "caption", "title") || "(no caption)";
  const occurredAt =
    parseTime(p.capturedAt) ||
    parseTime(row.collect_time || row.time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    isSnapshot ? CAPTURED_BY.API : CAPTURED_BY.SQLITE,
  );
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.LIKE,
        occurredAt,
        actor: "person-self",
        content: { title: caption },
        ingestedAt,
        source,
        extra: {
          platform: "kuaishou",
          photoId: pickField(p, "photoId", "photo_id"),
          authorId: pickField(p, "authorId", "author_id"),
          authorName: pickField(p, "authorName", "author_name"),
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeSearch(p, raw, ingestedAt) {
  if (!p.row && !p.keyword && !p.query) {
    if (!p.row) {
      throw new Error("KuaishouAdapter.normalize: row missing");
    }
  }
  const isSnapshot = !p.row;
  const row = p.row || {};
  const keyword =
    pickField(p, "keyword", "keyword", "query") ||
    pickField(p, "query") ||
    "(empty query)";
  const occurredAt =
    parseTime(p.capturedAt) ||
    parseTime(p.searchAt) ||
    parseTime(row.search_time || row.time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    isSnapshot ? CAPTURED_BY.API : CAPTURED_BY.SQLITE,
  );
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.POST,
        occurredAt,
        actor: "person-self",
        content: { title: keyword },
        ingestedAt,
        source,
        extra: {
          platform: "kuaishou",
          kind: "search",
          keyword,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

module.exports = {
  KuaishouAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
