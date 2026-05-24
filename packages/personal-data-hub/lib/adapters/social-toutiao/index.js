/**
 * §A8 v0.2 — Toutiao (今日头条) adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-weibo / social-bilibili two-mode pattern:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by the phone's ToutiaoLocalCollector (root-required
 *      SQLCipher decrypt of /data/data/com.ss.android.article.news/
 *      databases/ on Phase 13.10 real-device E2E; until then the snapshot
 *      can be produced by the desktop AndroidExtractor pulling a plaintext
 *      7.x DB and running the same row → snapshot transform offline).
 *      Desktop-independent path. account.uid OPTIONAL at construction —
 *      payload carries it.
 *
 *   2. sqlite mode (opts.dbPath, legacy): Phase 13.8 device-pull path —
 *      desktop reads the pulled DB directly. Preserved for backward compat;
 *      account.uid REQUIRED in this mode (checked lazily at sync time, not
 *      at construction, so snapshot-only callers can omit it).
 *
 * Snapshot schema (mirrors ToutiaoLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "read",       "id": "read-<itemId>",    "capturedAt": <ms>,
 *         "itemId": "...", "title": "...", "category": "...", "author": "...",
 *         "readDuration": N, "source": "..." },
 *       { "kind": "collection", "id": "collect-<itemId>", "capturedAt": <ms>,
 *         "itemId": "...", "title": "...", "category": "...", "author": "..." },
 *       { "kind": "search",     "id": "search-<kw>:<ts>", "capturedAt": <ms>,
 *         "keyword": "...", "searchAt": <ms> }
 *     ]
 *   }
 *
 * Sensitivity: bumped to "high" vs Bilibili — Toutiao reading patterns can
 * reveal political / medical / financial topic interest.
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

const NAME = "social-toutiao";
const VERSION = "0.2.1";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_READ = "read";
const KIND_COLLECTION = "collection";
const KIND_SEARCH = "search";
// v0.2.1 — KIND_PROFILE added (mirrors Douyin); v0.3 will add read/collection
// /search once _signature path is wired. SNAPSHOT_SCHEMA_VERSION stays at 1:
// old (events-only) snapshots remain compatible; new profile events are an
// additive extension.
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_PROFILE,
  KIND_READ,
  KIND_COLLECTION,
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
  return `toutiao:${kind}:${safe}`;
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

class ToutiaoAdapter {
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
      "parse:toutiao-profile",
      "parse:toutiao-read-history",
      "parse:toutiao-collection",
      "parse:toutiao-search",
    ];
    // Existing desktop wiring may key off this — kept as device-pull (the
    // sqlite mode is the desktop-side; snapshot mode is in-APK Android).
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "toutiao:profile (user_id / screen_name / avatar / mobile / following / followers)",
        "toutiao:read_history (item_id / title / read_time / category)",
        "toutiao:collection_article (item_id / title / save_time)",
        "toutiao:search_history (keyword / search_time)",
      ],
      // News reading reveals political / medical / financial topic interest.
      sensitivity: "high",
      legalGate: false,
      defaultInclude: {
        profile: true,
        read: true,
        collection: true,
        search: true,
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
          message: "social-toutiao.authenticate: sqlite mode requires account.uid",
        };
      }
      return { ok: true, account: this.account.uid, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "social-toutiao.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
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
      "social-toutiao.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
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
        `social-toutiao.sync: snapshot schemaVersion mismatch (got ${snapshot && snapshot.schemaVersion}, expected ${SNAPSHOT_SCHEMA_VERSION})`,
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
        ev.itemId ||
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
    // Legacy Phase 13.8 path — requires account.uid in constructor and a DB
    // pulled via the desktop AndroidExtractor.
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-toutiao._syncViaSqlite: account.uid required (set via new ToutiaoAdapter({ account: { uid } }) in cli wiring)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      const reads =
        trySelect(
          db,
          "SELECT * FROM read_history ORDER BY read_time DESC LIMIT 5000",
        ) || [];
      for (const row of reads) {
        yield {
          adapter: NAME,
          originalId: `read-${row.id || row._id || row.item_id}`,
          capturedAt: parseTime(row.read_time || row.time || row.create_time),
          payload: { row, kind: KIND_READ },
        };
      }

      const collections =
        trySelect(
          db,
          "SELECT * FROM collection_article ORDER BY save_time DESC LIMIT 5000",
        ) || [];
      for (const row of collections) {
        yield {
          adapter: NAME,
          originalId: `collect-${row.id || row.item_id}`,
          capturedAt: parseTime(row.save_time || row.time),
          payload: { row, kind: KIND_COLLECTION },
        };
      }

      const searches =
        trySelect(
          db,
          "SELECT * FROM search_history ORDER BY search_time DESC LIMIT 5000",
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
      throw new Error("ToutiaoAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (kind === KIND_PROFILE) {
      return normalizeProfile(p, raw, ingestedAt);
    }
    if (kind === KIND_COLLECTION) {
      return normalizeCollection(p, raw, ingestedAt);
    }
    if (kind === KIND_SEARCH) {
      return normalizeSearch(p, raw, ingestedAt);
    }
    if (kind === KIND_READ) {
      return normalizeRead(p, raw, ingestedAt);
    }
    throw new Error(`ToutiaoAdapter.normalize: unknown kind ${kind}`);
  }
}

function normalizeProfile(p, raw, ingestedAt) {
  // v0.2 snapshot-only — produces a person record for the logged-in user
  // (person-self) carrying toutiao-uid identifier + counts in extra.
  // Repeated syncs dedupe on the same id; extra fields get refreshed.
  const uid = p.uid || (p.account && p.account.uid) || null;
  const nickname =
    p.nickname || (p.account && p.account.displayName) || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const identifiers = {};
  if (uid) identifiers["toutiao-uid"] = [String(uid)];
  if (p.mediaId) identifiers["toutiao-media-id"] = [String(p.mediaId)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-toutiao-${uid}` : `person-toutiao-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source,
        identifiers,
        extra: {
          platform: "toutiao",
          avatarUrl: p.avatarUrl || null,
          description: p.description || null,
          mobile: p.mobile || null,
          followingCount: p.followingCount || 0,
          followerCount: p.followerCount || 0,
          mediaId: p.mediaId || null,
          snapshottedAt: occurredAt,
        },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
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
  // Snapshot mode payload carries fields directly; sqlite-mode payload has a
  // `row` sub-object. Try snapshot key first, then each sqlite-row key.
  if (p[snapshotKey] != null) return p[snapshotKey];
  const row = p.row || {};
  for (const k of sqlKeys) {
    if (row[k] != null) return row[k];
  }
  return null;
}

function normalizeRead(p, raw, ingestedAt) {
  if (!p.row && !p.itemId && !p.title) {
    // payload is sqlite-only legacy shape with missing row → preserve old
    // behaviour for the v0.1 scaffold tests that pass `{ payload: {} }`.
    if (!p.row) {
      throw new Error("ToutiaoAdapter.normalize: row missing");
    }
  }
  const isSnapshot = !p.row;
  const row = p.row || {};
  const title = pickField(p, "title", "title", "article_title") || "(no title)";
  const occurredAt =
    parseTime(p.capturedAt) ||
    parseTime(row.read_time || row.time || row.create_time) ||
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
        content: { title },
        ingestedAt,
        source,
        extra: {
          platform: "toutiao",
          itemId: pickField(p, "itemId", "item_id"),
          category: pickField(p, "category", "category"),
          author: pickField(p, "author", "author"),
          readDuration: pickField(p, "readDuration", "read_duration", "duration"),
          source: pickField(p, "source", "source"),
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeCollection(p, raw, ingestedAt) {
  if (!p.row && !p.itemId && !p.title) {
    if (!p.row) {
      throw new Error("ToutiaoAdapter.normalize: row missing");
    }
  }
  const isSnapshot = !p.row;
  const row = p.row || {};
  const title =
    pickField(p, "title", "title", "article_title") || "(no title)";
  const occurredAt =
    parseTime(p.capturedAt) ||
    parseTime(row.save_time || row.time) ||
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
        content: { title },
        ingestedAt,
        source,
        extra: {
          platform: "toutiao",
          itemId: pickField(p, "itemId", "item_id"),
          category: pickField(p, "category", "category"),
          author: pickField(p, "author", "author"),
          source: pickField(p, "source", "source"),
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
      throw new Error("ToutiaoAdapter.normalize: row missing");
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
        // Keep v0.1 scaffold mapping (search → "post") to avoid downstream
        // re-classification — Toutiao searches are user-authored queries.
        subtype: EVENT_SUBTYPES.POST,
        occurredAt,
        actor: "person-self",
        content: { title: keyword },
        ingestedAt,
        source,
        extra: {
          platform: "toutiao",
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
  ToutiaoAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  KIND_PROFILE,
  KIND_READ,
  KIND_COLLECTION,
  KIND_SEARCH,
};
