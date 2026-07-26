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

const NAME = "social-kuaishou";
const VERSION = "0.3.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_WATCH = "watch";
const KIND_COLLECT = "collect";
const KIND_SEARCH = "search";
// v0.2.1 — KIND_PROFILE added (mirrors Douyin/Toutiao). The watch/collect/
// search producers LANDED since (verified 2026-06-11): Android
// KuaishouLocalCollector emits all 4 kinds via the NS_sig3 WebSignBridge
// path, KuaishouRootDbExtractor emits watch/collect/search, and the PC ADB
// KuaishouApiClient fetches them through its injected signProvider (signed
// GraphQL). This adapter normalizes whatever the snapshot carries.
// SNAPSHOT_SCHEMA_VERSION stays at 1 — additive.
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_PROFILE,
  KIND_WATCH,
  KIND_COLLECT,
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
  return `kuaishou:${kind}:${stringified}`;
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
    `social-kuaishou: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "KUAISHOU_SQLITE_SOURCE_UNREADABLE";
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

class KuaishouAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid OPTIONAL at construction — snapshot mode is
    // stateless. Sqlite mode lazy-checks at sync time.
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
      "parse:kuaishou-profile",
      "parse:kuaishou-photo-history",
      "parse:kuaishou-user-collect",
      "parse:kuaishou-search",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "kuaishou:profile (user_id / user_name / kuaishou_id / headurl / sex / city)",
        "kuaishou:photo_history (photo_id / caption / view_time / duration / author_id)",
        "kuaishou:user_collect (photo_id / caption / collect_time)",
        "kuaishou:search_record (keyword / search_time)",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        profile: true,
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
        ev.photoId ||
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
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-kuaishou._syncViaSqlite: account.uid required (set via new KuaishouAdapter({ account: { uid } }) in cli wiring)",
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
      const watched = readOptionalTable(
        db,
        tableNames,
        "photo_history",
        "SELECT * FROM photo_history ORDER BY view_time DESC",
      );
      const records = watched.map((row) => ({
        adapter: NAME,
        kind: KIND_WATCH,
        originalId: sqliteOriginalId(
          "photo",
          row.id || row._id || row.photo_id,
        ),
        capturedAt: parseTime(row.view_time || row.time || row.create_time),
        payload: { row, kind: KIND_WATCH },
      }));

      const collected = readOptionalTable(
        db,
        tableNames,
        "user_collect",
        "SELECT * FROM user_collect ORDER BY collect_time DESC",
      );
      records.push(
        ...collected.map((row) => ({
          adapter: NAME,
          kind: KIND_COLLECT,
          originalId: sqliteOriginalId("collect", row.id || row.photo_id),
          capturedAt: parseTime(row.collect_time || row.time),
          payload: { row, kind: KIND_COLLECT },
        })),
      );

      const searches = readOptionalTable(
        db,
        tableNames,
        "search_record",
        "SELECT * FROM search_record ORDER BY search_time DESC",
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
      throw new Error("KuaishouAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (kind === KIND_PROFILE) {
      return normalizeProfile(p, raw, ingestedAt);
    }
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
      ? [KIND_WATCH, KIND_COLLECT, KIND_SEARCH]
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
  // (person-self) carrying kuaishou-uid + kuaishou-id identifiers + profile
  // metadata in extra. Repeated syncs dedupe on the same id; extra fields
  // get refreshed.
  const uid = p.uid || (p.account && p.account.uid) || null;
  const nickname =
    p.nickname || (p.account && p.account.displayName) || "(unnamed)";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const identifiers = {};
  if (uid) identifiers["kuaishou-uid"] = [String(uid)];
  if (p.kuaishouId) identifiers["kuaishou-id"] = [String(p.kuaishouId)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-kuaishou-${uid}` : `person-kuaishou-self-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.SELF,
        names: [nickname],
        ingestedAt,
        source,
        identifiers,
        extra: {
          platform: "kuaishou",
          avatarUrl: p.avatarUrl || null,
          sex: p.sex || null,
          city: p.city || null,
          constellation: p.constellation || null,
          description: p.description || null,
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
  const caption = pickField(p, "caption", "caption", "title") || "(no caption)";
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
  const caption = pickField(p, "caption", "caption", "title") || "(no caption)";
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
  KIND_PROFILE,
  KIND_WATCH,
  KIND_COLLECT,
  KIND_SEARCH,
};
