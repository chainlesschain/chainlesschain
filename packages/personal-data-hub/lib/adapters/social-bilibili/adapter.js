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
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const {
  advanceCursor,
  assertScanIdentity,
  beginScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "social-bilibili";
const VERSION = "0.7.0";
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
  // integers, but originalId is a string in raw_events schema. Values with no
  // stable source ID are rejected below so repeated syncs stay idempotent.
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!stringified) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `bilibili:${kind}:${stringified}`;
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
    `social-bilibili: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "BILIBILI_SQLITE_SOURCE_UNREADABLE";
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

class BilibiliAdapter {
  constructor(opts = {}) {
    // Stateless in snapshot mode — account.uid optional. Sqlite-mode still
    // requires it (the legacy path before A8); see _syncViaSqlite below.
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
      "parse:bilibili-history",
      "parse:bilibili-favourite",
      "parse:bilibili-dynamic",
      "parse:bilibili-follow",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
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
        allowedEventKinds: VALID_KINDS,
      });
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
      "social-bilibili.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, Phase 7.5 desktop extractor)",
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
        ev.bvid ||
        ev.mid ||
        ev.rid ||
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
    // Legacy Phase 7.5 path — requires account.uid in constructor and a DB
    // pulled via the desktop AndroidExtractor. Preserved verbatim from the
    // pre-A8 adapter so existing desktop users don't regress.
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-bilibili._syncViaSqlite: account.uid required (set via new BilibiliAdapter({ account: { uid } }) in cli wiring)",
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
      const history = readOptionalTable(
        db,
        tableNames,
        "history",
        "SELECT * FROM history ORDER BY view_at DESC",
      );
      const records = history.map((row) => ({
        adapter: NAME,
        kind: KIND_HISTORY,
        originalId: stableOriginalId(
          KIND_HISTORY,
          row.id || row._id || row.kid || row.bvid || row.avid,
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
      }));
      const favs = readOptionalTable(
        db,
        tableNames,
        "bili_favourite",
        "SELECT * FROM bili_favourite ORDER BY save_time DESC",
      );
      records.push(
        ...favs.map((row) => ({
          adapter: NAME,
          kind: KIND_FAVOURITE,
          originalId: stableOriginalId(
            KIND_FAVOURITE,
            row.id || row.fav_id || row.bvid,
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
    allowedEventKinds: VALID_KINDS,
  });
  return { snapshot, source: digest(buffer) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(mode, include) {
  const kinds =
    mode === "sqlite" ? [KIND_HISTORY, KIND_FAVOURITE] : VALID_KINDS;
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
            Object.entries(record.payload).filter(([key]) => key !== "_row"),
          ),
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
    VALID_KINDS.indexOf(left.kind) - VALID_KINDS.indexOf(right.kind);
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

function normalizeHistory(p, source, occurredAt, ingestedAt) {
  const title = p.title || "(no title)";
  const bvid = p.bvid || null;
  const itemId = bvid
    ? `item-bilibili-video-${bvid}`
    : `item-bilibili-video-${newId()}`;
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
          platform: "bilibili",
          bvid,
          avid: p.avid || null,
          duration: p.duration || null,
          uploader: p.uploader || null,
          part: p.part || null,
          itemRef: itemId,
        },
      },
    ],
    persons: [],
    places: [],
    items: [item],
    topics: [],
  };
}

function normalizeFavourite(p, source, occurredAt, ingestedAt) {
  const title = p.title || "(no title)";
  const bvid = p.bvid || null;
  const itemId = bvid
    ? `item-bilibili-video-${bvid}`
    : `item-bilibili-video-${newId()}`;
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
          platform: "bilibili",
          bvid,
          avid: p.avid || null,
          folderName: p.folderName || null,
          uploader: p.uploader || null,
          itemRef: itemId,
        },
      },
    ],
    persons: [],
    places: [],
    items: [item],
    topics: [],
  };
}

function normalizeDynamic(p, source, occurredAt, ingestedAt) {
  const summary = p.summary || p.content || "(no summary)";
  return {
    events: [
      {
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
      },
    ],
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
