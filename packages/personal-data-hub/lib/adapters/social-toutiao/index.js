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
const crypto = require("node:crypto");
const {
  createAccountScope,
  createAccountScopeFromAccount,
} = require("../../account-scope");
const {
  SnapshotFileError,
  inspectSnapshotFile,
  probeJsonSnapshotFile,
  readBoundedSnapshotBuffer,
  validateJsonSnapshot,
} = require("../../snapshot-file");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const {
  advanceCursor,
  assertScanIdentity,
  beginScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "social-toutiao";
const VERSION = "0.3.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_READ = "read";
const KIND_COLLECTION = "collection";
const KIND_SEARCH = "search";
// v0.2.1 — KIND_PROFILE added (mirrors Douyin). The read/collection/search
// producers LANDED since (verified 2026-06-11): Android ToutiaoLocalCollector
// emits all 4 kinds via the _signature WebSignBridge path, ToutiaoRootDbExtractor
// emits read/collection/search, and the PC ADB ToutiaoApiClient fetches
// feed/collection/search through its injected signProvider. This adapter
// normalizes whatever the snapshot carries. SNAPSHOT_SCHEMA_VERSION stays
// at 1: old (events-only) snapshots remain compatible; profile events are
// an additive extension.
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
  if (!stringified) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `toutiao:${kind}:${stringified}`;
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

function sqliteSourceError(tableName, operation, cause) {
  const error = new Error(
    `social-toutiao: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "TOUTIAO_SQLITE_SOURCE_UNREADABLE";
  error.table = tableName;
  error.operation = operation;
  error.cause = cause;
  return error;
}

function listSqliteTables(db) {
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    if (!Array.isArray(rows)) {
      throw new Error("SQLite table inventory did not return a row array");
    }
    return new Set(
      rows
        .map((row) => row && row.name)
        .filter((name) => typeof name === "string")
        .map((name) => name.toLowerCase()),
    );
  } catch (error) {
    throw sqliteSourceError("sqlite_master", "listed", error);
  }
}

function readOptionalTable(db, tableNames, tableName, sql) {
  if (!tableNames.has(tableName.toLowerCase())) return [];
  try {
    const rows = db.prepare(sql).all();
    if (!Array.isArray(rows)) {
      throw new Error("SQLite query did not return a row array");
    }
    return rows;
  } catch (error) {
    throw sqliteSourceError(tableName, "read", error);
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
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["uid", "userId", "accountId"],
    );
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
    this.watermarkStrategy = "explicit";
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

  fileCheckpointMode() {
    return "shared";
  }

  resolveDefaultScope(options = {}) {
    const inputPath =
      typeof options.inputPath === "string" && options.inputPath.length > 0
        ? options.inputPath
        : typeof options.dbPath === "string" && options.dbPath.length > 0
          ? options.dbPath
          : this._dbPath;
    if (!inputPath) return this.defaultScope;
    return scopeForLocalFile(this._deps.fs, inputPath, {
      accountScope: this.defaultScope,
      maxBytes:
        options.inputPath === inputPath ? options.maxSnapshotBytes : null,
      mode: options.inputPath === inputPath ? "snapshot" : "sqlite",
    });
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      return probeJsonSnapshotFile(this._deps.fs, ctx.inputPath, {
        maxBytes: ctx.maxSnapshotBytes,
        expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requiredArrayFields: ["events"],
        allowedEventKinds: VALID_SNAPSHOT_KINDS,
      });
    }
    if (this._dbPath || (ctx && typeof ctx.dbPath === "string")) {
      if (!this.account || !this.account.uid) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_UID",
          message:
            "social-toutiao.authenticate: sqlite mode requires account.uid",
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
    const { snapshot, source } = readSnapshotSource(
      this._deps.fs,
      opts.inputPath,
      opts.maxSnapshotBytes,
    );
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();

    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};
    const records = snapshot.events.map((ev) => {
      const kind = ev.kind;
      const capturedAt =
        parseTime(ev.capturedAt) || parseTime(ev.time) || fallbackCapturedAt;
      const id =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        (typeof ev.id === "number" &&
          Number.isFinite(ev.id) &&
          String(ev.id)) ||
        ev.itemId ||
        ev.keyword ||
        null;
      return {
        adapter: NAME,
        kind,
        originalId: stableOriginalId(kind, id),
        capturedAt,
        payload: { ...ev, account },
      };
    });
    yield* this._yieldCollection(opts, {
      config: collectionConfig("snapshot", include),
      mode: "snapshot",
      records: records.filter((record) => include[record.kind] !== false),
      source,
    });
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
    inspectSqliteFile(this._deps.fs, dbPath);
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      const tableNames = listSqliteTables(db);
      const reads = readOptionalTable(
        db,
        tableNames,
        "read_history",
        "SELECT * FROM read_history ORDER BY read_time DESC",
      );
      const records = reads.map((row) => ({
        adapter: NAME,
        kind: KIND_READ,
        originalId: sqliteOriginalId("read", row.id || row._id || row.item_id),
        capturedAt: parseTime(row.read_time || row.time || row.create_time),
        payload: { row, kind: KIND_READ },
      }));

      const collections = readOptionalTable(
        db,
        tableNames,
        "collection_article",
        "SELECT * FROM collection_article ORDER BY save_time DESC",
      );
      records.push(
        ...collections.map((row) => ({
          adapter: NAME,
          kind: KIND_COLLECTION,
          originalId: sqliteOriginalId("collect", row.id || row.item_id),
          capturedAt: parseTime(row.save_time || row.time),
          payload: { row, kind: KIND_COLLECTION },
        })),
      );

      const searches = readOptionalTable(
        db,
        tableNames,
        "search_history",
        "SELECT * FROM search_history ORDER BY search_time DESC",
      );
      records.push(
        ...searches.map((row) => ({
          adapter: NAME,
          kind: KIND_SEARCH,
          originalId: sqliteOriginalId(
            "search",
            row.id ||
              (row.keyword != null && row.search_time != null
                ? `${row.keyword}:${row.search_time}`
                : null),
          ),
          capturedAt: parseTime(row.search_time || row.time),
          payload: { row, kind: KIND_SEARCH },
        })),
      );
      records.sort(compareCollectionRecords);
      const include = opts.include || {};
      const selected = records.filter(
        (record) => include[record.kind] !== false,
      );
      yield* this._yieldCollection(opts, {
        config: collectionConfig("sqlite", include),
        mode: "sqlite",
        records: selected,
        source: collectionSource(selected),
      });
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }

  async *_yieldCollection(opts, { config, mode, records, source }) {
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    let cursor = prepareCursor(opts.sinceWatermark, {
      mode,
      source,
      config,
      upper: records.length,
    });
    const publish = () => publishCursor(opts, cursor);
    let emitted = 0;
    let ordinal = cursor.after ?? 0;
    while (cursor.upper !== null && emitted < limit) {
      ordinal += 1;
      cursor = advanceCursor(cursor, ordinal);
      publish();
      yield records[ordinal - 1];
      emitted += 1;
    }
    publish();
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

function sqliteOriginalId(prefix, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${prefix} SQLite row requires a stable source id`,
    );
  }
  return `${prefix}-${safe}`;
}

function readSnapshotSource(fsMod, inputPath, maxBytes) {
  const buffer = readBoundedSnapshotBuffer(fsMod, inputPath, { maxBytes });
  let snapshot;
  try {
    snapshot = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new SnapshotFileError(
      "SNAPSHOT_JSON_INVALID",
      "snapshot file must contain valid JSON",
      { cause: error },
    );
  }
  validateJsonSnapshot(snapshot, {
    expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    requiredArrayFields: ["events"],
    allowedEventKinds: VALID_SNAPSHOT_KINDS,
  });
  return { snapshot, source: digest(buffer) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(mode, include) {
  const kinds =
    mode === "sqlite"
      ? [KIND_READ, KIND_COLLECTION, KIND_SEARCH]
      : VALID_SNAPSHOT_KINDS;
  return digest(
    Buffer.from(
      JSON.stringify({
        include: Object.fromEntries(
          kinds.map((kind) => [kind, include[kind] !== false]),
        ),
        mode,
      }),
      "utf8",
    ),
  );
}

function collectionSource(records) {
  return digest(
    Buffer.from(
      stableStringify(
        records.map((record) => ({
          capturedAt: record.capturedAt,
          kind: record.kind,
          originalId: record.originalId,
          payload: Object.fromEntries(
            Object.entries(record.payload).filter(([key]) => key !== "row"),
          ),
          row: record.payload.row,
        })),
      ),
      "utf8",
    ),
  );
}

function stableStringify(value) {
  return JSON.stringify(canonicalDigestValue(value));
}

function canonicalDigestValue(value) {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (Buffer.isBuffer(value)) {
    return { $buffer: value.toString("base64") };
  }
  if (Array.isArray(value)) return value.map(canonicalDigestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalDigestValue(value[key])]),
    );
  }
  return value;
}

function compareCollectionRecords(left, right) {
  const kindOrder =
    VALID_SNAPSHOT_KINDS.indexOf(left.kind) -
    VALID_SNAPSHOT_KINDS.indexOf(right.kind);
  if (kindOrder !== 0) return kindOrder;
  const leftTime = Number.isFinite(left.capturedAt)
    ? left.capturedAt
    : Number.NEGATIVE_INFINITY;
  const rightTime = Number.isFinite(right.capturedAt)
    ? right.capturedAt
    : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.originalId.localeCompare(right.originalId, "en");
}

function prepareCursor(sinceWatermark, identity) {
  let cursor = parseCursor(sinceWatermark).cursor;
  cursor =
    cursor.upper === null
      ? beginScan(cursor, identity)
      : assertScanIdentity(cursor, identity);
  return cursor;
}

function publishCursor(opts, cursor) {
  if (typeof opts.updateWatermark === "function") {
    opts.updateWatermark(serializeCursor(cursor));
  }
}

function scopeForLocalFile(fsMod, inputPath, { accountScope, maxBytes, mode }) {
  const inspected =
    mode === "snapshot"
      ? inspectSnapshotFile(fsMod, inputPath, { maxBytes })
      : inspectSqliteFile(fsMod, inputPath);
  const revision =
    inspected.stat.mtimeNs ??
    inspected.stat.mtimeMs ??
    inspected.stat.ctimeNs ??
    inspected.stat.ctimeMs ??
    "";
  return createAccountScope(
    NAME,
    [
      accountScope || "unscoped",
      mode,
      inspected.realPath,
      String(inspected.size),
      String(revision),
    ].join("\0"),
  );
}

function inspectSqliteFile(fsMod, inputPath) {
  let linkStat;
  let stat;
  let realPath;
  try {
    linkStat = fsMod.lstatSync(inputPath, { bigint: true });
    if (
      typeof linkStat.isSymbolicLink === "function" &&
      linkStat.isSymbolicLink()
    ) {
      throw new SnapshotFileError(
        "SNAPSHOT_SYMBOLIC_LINK",
        "SQLite source must not be a symbolic link",
      );
    }
    stat = fsMod.statSync(inputPath, { bigint: true });
    realPath = fsMod.realpathSync(inputPath);
  } catch (error) {
    if (error instanceof SnapshotFileError) throw error;
    throw new SnapshotFileError(
      "INPUT_PATH_UNREADABLE",
      "SQLite source is unavailable or unreadable",
      { cause: error },
    );
  }
  if (typeof stat.isFile !== "function" || !stat.isFile()) {
    throw new SnapshotFileError(
      "SNAPSHOT_NOT_REGULAR_FILE",
      "SQLite source must be a regular file",
    );
  }
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new SnapshotFileError(
      "SNAPSHOT_SIZE_INVALID",
      "SQLite source size is invalid",
    );
  }
  return { linkStat, realPath, size, stat };
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
          readDuration: pickField(
            p,
            "readDuration",
            "read_duration",
            "duration",
          ),
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
  const title = pickField(p, "title", "title", "article_title") || "(no title)";
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
