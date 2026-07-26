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

const NAME = "social-xiaohongshu";
const VERSION = "0.7.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_NOTE = "note";
const KIND_LIKED = "liked";
const KIND_FOLLOW = "follow";
// legacy sqlite-mode-only kinds (preserved for backward compat normalize path)
const KIND_HISTORY = "history";
const KIND_LIKE = "like";
const KIND_FAVOURITE = "favourite";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_NOTE,
  KIND_LIKED,
  KIND_FOLLOW,
]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!stringified) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `xiaohongshu:${kind}:${stringified}`;
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
    `social-xiaohongshu: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "XIAOHONGSHU_SQLITE_SOURCE_UNREADABLE";
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

function selectFirstTable(db, tableNames, candidates) {
  let lastFailure = null;
  for (const candidate of candidates) {
    if (!tableNames.has(candidate.tableName.toLowerCase())) continue;
    try {
      const rows = db.prepare(candidate.sql).all();
      if (!Array.isArray(rows)) {
        throw new Error("SQLite query did not return a row array");
      }
      return rows;
    } catch (error) {
      lastFailure = { error, tableName: candidate.tableName };
    }
  }
  if (lastFailure) {
    throw sqliteSourceError(lastFailure.tableName, "read", lastFailure.error);
  }
  return [];
}

function readOptionalTable(db, tableNames, tableName, sql) {
  return selectFirstTable(db, tableNames, [{ tableName, sql }]);
}

class XiaohongshuAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid optional (snapshot mode pulls from file).
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["uid", "numericUid", "userId", "accountId"],
    );
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
    this.watermarkStrategy = "explicit";
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
            "social-xiaohongshu.authenticate: sqlite mode requires account.uid",
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
        ev.noteId ||
        ev.userId ||
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
        "social-xiaohongshu._syncViaSqlite: account.uid required",
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
      const histories = selectFirstTable(db, tableNames, [
        {
          tableName: "browse_history",
          sql: "SELECT * FROM browse_history ORDER BY view_time DESC",
        },
        {
          tableName: "note",
          sql: "SELECT * FROM note ORDER BY view_time DESC",
        },
      ]);
      const records = histories.map((row) => ({
        adapter: NAME,
        kind: KIND_HISTORY,
        originalId: sqliteOriginalId("history", row.id || row.note_id),
        capturedAt: parseTime(row.view_time),
        payload: { row, kind: KIND_HISTORY },
      }));
      const likes = readOptionalTable(
        db,
        tableNames,
        "liked_note",
        "SELECT * FROM liked_note ORDER BY like_time DESC",
      );
      records.push(
        ...likes.map((row) => ({
          adapter: NAME,
          kind: KIND_LIKE,
          originalId: sqliteOriginalId("like", row.id || row.note_id),
          capturedAt: parseTime(row.like_time),
          payload: { row, kind: KIND_LIKE },
        })),
      );
      const favs = readOptionalTable(
        db,
        tableNames,
        "favourite",
        "SELECT * FROM favourite ORDER BY save_time DESC",
      );
      records.push(
        ...favs.map((row) => ({
          adapter: NAME,
          kind: KIND_FAVOURITE,
          originalId: sqliteOriginalId("fav", row.id || row.note_id),
          capturedAt: parseTime(row.save_time),
          payload: { row, kind: KIND_FAVOURITE },
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
      throw new Error("XiaohongshuAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    // Sqlite mode (legacy) — payload.row + kind in {history, like, favourite}
    if (
      kind === KIND_HISTORY ||
      kind === KIND_LIKE ||
      kind === KIND_FAVOURITE
    ) {
      return normalizeSqliteRow(p, raw, ingestedAt);
    }

    // Snapshot mode
    if (kind === KIND_NOTE) return normalizeNote(p, raw, ingestedAt);
    if (kind === KIND_LIKED) return normalizeLiked(p, raw, ingestedAt);
    if (kind === KIND_FOLLOW) return normalizeFollow(p, raw, ingestedAt);
    throw new Error(`XiaohongshuAdapter.normalize: unknown kind ${kind}`);
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
      ? [KIND_HISTORY, KIND_LIKE, KIND_FAVOURITE]
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
  const kinds = [KIND_HISTORY, KIND_LIKE, KIND_FAVOURITE];
  const kindOrder = kinds.indexOf(left.kind) - kinds.indexOf(right.kind);
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
    events: [
      {
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
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeNote(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const title = p.title || "(no title)";
  return {
    events: [
      {
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
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeLiked(p, raw, ingestedAt) {
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
  const title = p.title || "(no title)";
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
          platform: "xiaohongshu",
          noteId: p.noteId,
          authorNickname: p.authorNickname || null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
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
