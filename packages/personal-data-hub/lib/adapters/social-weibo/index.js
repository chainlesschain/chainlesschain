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
 *   2. sqlite mode (opts.dbPath): desktop device-pull path — reads the Weibo
 *      Android app's plain SQLite DB `com.sina.weibo/databases/sina_weibo`.
 *      account.uid REQUIRED in this mode.
 *
 *      Table/column names are DEVICE-VERIFIED against a real install
 *      (Redmi M2104K10AC, 微博 16.5.3, 2026-06-16):
 *        - posts      → `home_table` (timeline cache; own posts = uid==selfUid)
 *                       cols: mblogid / uid / content / time / rtnum /
 *                       commentnum / attitudenum / src / longitude / latitude
 *        - favourites → `like_table`   cols: mblogid / content / time / nick
 *        - follows    → `follower_table` (following=1 ⇒ accounts the user
 *                       follows) cols: user_id / screen_name / remark / gender
 *      The legacy `post`/`status`/`search_history` queries are kept as
 *      FALLBACKS (older builds) — on a modern device those tables don't
 *      exist so the adapter previously collected ZERO. Row VALUES were not
 *      validated (verification account was empty); column semantics use the
 *      standard Weibo schema. See memory pdh_collector_completeness_audit.
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
const path = require("node:path");
const crypto = require("node:crypto");
const {
  SnapshotFileError,
  inspectSnapshotFile,
  probeJsonSnapshotFile,
  readBoundedSnapshotBuffer,
  validateJsonSnapshot,
} = require("../../snapshot-file");
const {
  createAccountScope,
  createAccountScopeFromAccount,
} = require("../../account-scope");
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

const NAME = "social-weibo";
const VERSION = "0.9.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_POST = "post";
const KIND_FAVOURITE = "favourite";
const KIND_FOLLOW = "follow";
const KIND_SEARCH = "search"; // legacy sqlite-mode only
// Private-message (私信) kinds — read from the sibling `message_<uid>.db`
// (device-verified schema 2026-06-28: t_buddy/t_session/t_message). Opt-in
// (opts.includeDm) because DMs are high-sensitivity. See
// docs/internal/pdh-app-db-schemas.md → 微博 message_<uid>.db.
const KIND_DM_BUDDY = "dm-buddy"; // t_buddy   → PERSON(CONTACT)
const KIND_DM_SESSION = "dm-session"; // t_session → TOPIC
const KIND_DM_MESSAGE = "dm-message"; // t_message → EVENT(MESSAGE)
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_POST,
  KIND_FAVOURITE,
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
  return `weibo:${kind}:${stringified}`;
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
    `social-weibo: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "WEIBO_SQLITE_SOURCE_UNREADABLE";
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

class WeiboAdapter {
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
      ["uid", "userId", "accountId", "deviceId"],
    );
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
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "weibo:posts (text / created_at / reposts_count / comments_count / likes)",
        "weibo:favourite (mid / text / author)",
        "weibo:follow (uid / screen_name)",
        "weibo:search_history (legacy sqlite mode)",
        "weibo:dm-buddy (uid / nick / remark) — HIGH sensitivity, opt-in (includeDm)",
        "weibo:dm-session (session_id / unread) — HIGH sensitivity, opt-in",
        "weibo:dm-message (time / outgoing / content) — HIGH sensitivity, opt-in",
      ],
      sensitivity: "medium",
      legalGate: false,
      defaultInclude: {
        post: true,
        favourite: true,
        follow: true,
        // Private messages are off by default — require opts.includeDm:true.
        dm: false,
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
    const hasInputPath =
      typeof options.inputPath === "string" && options.inputPath.length > 0;
    if (hasInputPath) {
      return scopeForLocalFiles(this._deps.fs, {
        accountScope: this.defaultScope,
        inputPath: options.inputPath,
        maxBytes: options.maxSnapshotBytes,
        mode: "snapshot",
      });
    }
    const dbPath =
      typeof options.dbPath === "string" && options.dbPath.length > 0
        ? options.dbPath
        : this._dbPath;
    if (!dbPath) return this.defaultScope;
    const selfUid = sanitizedUid(this.account && this.account.uid);
    return scopeForLocalFiles(this._deps.fs, {
      accountScope: this.defaultScope,
      dbPath,
      includeDm: options.includeDm === true,
      messageDbPath: resolveMessageDbPath(options, dbPath, selfUid),
      mode: "sqlite",
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
            "social-weibo.authenticate: sqlite mode requires account.uid",
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
        ev.mid ||
        ev.uid ||
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
    // Legacy Phase 13.2 path — requires account.uid in constructor and a DB
    // pulled via the desktop AndroidExtractor.
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-weibo._syncViaSqlite: account.uid required (set via new WeiboAdapter({ account: { uid } }) in cli wiring)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const inspected = inspectSqliteFile(this._deps.fs, dbPath);
    const fallbackCapturedAt = fileCapturedAt(inspected.stat);
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    // selfUid sanitised to digits — interpolated into a WHERE clause and
    // sourced from wiring config (numeric uin). Defensive against injection.
    const selfUid = sanitizedUid(this.account.uid);
    const entries = [];
    const files = [collectionFileIdentity("main", inspected)];

    try {
      const tableNames = listSqliteTables(db);
      // POSTS — device-verified `home_table` (own posts = uid==selfUid);
      // legacy `post`/`status` kept as fallback for older builds.
      const postSelection = selectFirstQuery(db, tableNames, [
        ...(selfUid
          ? [
              {
                tableName: "home_table",
                sql: `SELECT * FROM home_table WHERE uid='${selfUid}' ORDER BY time DESC`,
              },
            ]
          : []),
        {
          tableName: "post",
          sql: "SELECT * FROM post ORDER BY created_at DESC",
        },
        {
          tableName: "status",
          sql: "SELECT * FROM status ORDER BY created_at DESC",
        },
      ]);
      for (const row of postSelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt:
              parseTime(row.time || row.created_at) || fallbackCapturedAt,
            id: row.mblogid || row.id || row.mid || row.idstr,
            kind: KIND_POST,
            prefix: "post",
            role: "main",
            row,
            tableName: postSelection.tableName,
          }),
        );
      }

      // FAVOURITES — device-verified `like_table` (the account's likes).
      // Legacy sqlite had no favourite path (folded into posts pre-A8).
      const favouriteSelection = selectFirstQuery(db, tableNames, [
        {
          tableName: "like_table",
          sql: "SELECT * FROM like_table ORDER BY time DESC",
        },
      ]);
      for (const row of favouriteSelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt: parseTime(row.time) || fallbackCapturedAt,
            id: row.mblogid || row.id,
            kind: KIND_FAVOURITE,
            prefix: "fav",
            role: "main",
            row,
            tableName: favouriteSelection.tableName,
          }),
        );
      }

      // FOLLOWS — device-verified `follower_table`; following=1 ⇒ accounts
      // the user follows (vs followers). Fallback to the whole table.
      const followSelection = selectFirstQuery(db, tableNames, [
        {
          tableName: "follower_table:following",
          sql: "SELECT * FROM follower_table WHERE following=1 ORDER BY user_id",
        },
        {
          tableName: "follower_table",
          sql: "SELECT * FROM follower_table",
        },
      ]);
      for (const row of followSelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt: parseTime(row.time) || fallbackCapturedAt,
            id: row.user_id || row.id,
            kind: KIND_FOLLOW,
            prefix: "follow",
            role: "main",
            row,
            tableName: followSelection.tableName,
          }),
        );
      }

      // SEARCH — legacy only (`search_history` doesn't exist on modern
      // weibo; absent legacy tables are skipped gracefully).
      const searchSelection = selectFirstQuery(db, tableNames, [
        {
          tableName: "search_history",
          sql: "SELECT * FROM search_history ORDER BY time DESC",
        },
      ]);
      for (const row of searchSelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt:
              parseTime(row.time || row.create_at) || fallbackCapturedAt,
            id: row.id || row._id,
            kind: KIND_SEARCH,
            prefix: "search",
            role: "main",
            row,
            tableName: searchSelection.tableName,
          }),
        );
      }
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }

    // Private messages live in a SEPARATE sibling DB `message_<uid>.db`.
    // High-sensitivity → opt-in only (opts.includeDm === true).
    if (opts.includeDm === true) {
      const dmCollection = this._readDmCollection(opts, selfUid);
      entries.push(...dmCollection.entries);
      files.push(dmCollection.file);
    }
    entries.sort((left, right) =>
      compareCollectionRecords(left.raw, right.raw),
    );
    const include = opts.include || {};
    const selected = entries.filter(
      (entry) => include[entry.raw.payload.kind] !== false,
    );
    yield* this._yieldCollection(opts, {
      config: collectionConfig("sqlite", include, {
        includeDm: opts.includeDm === true,
        selfUid,
      }),
      mode: "sqlite",
      records: selected.map((entry) => entry.raw),
      source: collectionSource(selected, files),
    });
  }

  // Reads the Weibo private-message DB `message_<uid>.db` (a sibling of the
  // `sina_weibo` file, or opts.messageDbPath). device-verified schema:
  //   t_buddy   → PERSON  (DM contacts: uid/nick/remark/screen_name)
  //   t_session → TOPIC   (conversation threads: session_id/type/update_time)
  //   t_message → EVENT   (messages: time/outgoing/content_type/content/sender_id)
  // Columns confirmed against a real populated device (2026-06-28); t_message
  // content encoding is best-effort (no rows on the reference account).
  _readDmCollection(opts, selfUid) {
    const baseDbPath = opts.dbPath || this._dbPath;
    const msgDbPath = resolveMessageDbPath(opts, baseDbPath, selfUid);
    if (!msgDbPath || !this._deps.fs.existsSync(msgDbPath)) {
      return {
        entries: [],
        file: missingCollectionFileIdentity("message", msgDbPath),
      };
    }
    const inspected = inspectSqliteFile(this._deps.fs, msgDbPath);
    const fallbackCapturedAt = fileCapturedAt(inspected.stat);
    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(msgDbPath, { readonly: true });
    const entries = [];
    try {
      const tableNames = listSqliteTables(db);
      // BUDDIES → PERSON
      const buddies = readOptionalTable(
        db,
        tableNames,
        "t_buddy",
        "SELECT * FROM t_buddy",
      );
      for (const row of buddies) {
        if (row.uid == null) continue;
        entries.push(
          sqliteEntry({
            capturedAt: fallbackCapturedAt,
            id: row.uid,
            kind: KIND_DM_BUDDY,
            prefix: "dm-buddy",
            role: "message",
            row,
            tableName: "t_buddy",
          }),
        );
      }
      // SESSIONS → TOPIC
      const sessions = readOptionalTable(
        db,
        tableNames,
        "t_session",
        "SELECT * FROM t_session ORDER BY update_time DESC",
      );
      for (const row of sessions) {
        if (row.session_id == null) continue;
        entries.push(
          sqliteEntry({
            capturedAt: parseTime(row.update_time) || fallbackCapturedAt,
            id: row.session_id,
            kind: KIND_DM_SESSION,
            prefix: "dm-session",
            role: "message",
            row,
            tableName: "t_session",
          }),
        );
      }
      // MESSAGES → EVENT (content best-effort; schema device-verified)
      const messages = readOptionalTable(
        db,
        tableNames,
        "t_message",
        "SELECT * FROM t_message ORDER BY time DESC",
      );
      for (const row of messages) {
        entries.push(
          sqliteEntry({
            capturedAt: parseTime(row.time) || fallbackCapturedAt,
            id: row.global_id || row.id,
            kind: KIND_DM_MESSAGE,
            prefix: "dm-msg",
            role: "message",
            row,
            tableName: "t_message",
          }),
        );
      }
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    return {
      entries,
      file: collectionFileIdentity("message", inspected),
    };
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
    if (kind === KIND_DM_BUDDY) {
      return normalizeDmBuddy(p, raw, ingestedAt);
    }
    if (kind === KIND_DM_SESSION) {
      return normalizeDmSession(p, raw, ingestedAt);
    }
    if (kind === KIND_DM_MESSAGE) {
      return normalizeDmMessage(p, raw, ingestedAt);
    }
    throw new Error(`WeiboAdapter.normalize: unknown kind ${kind}`);
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
    allowedEventKinds: VALID_SNAPSHOT_KINDS,
  });
  return { snapshot, source: digest(buffer) };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectionConfig(mode, include, sqlite = {}) {
  const includeDm = mode === "sqlite" && sqlite.includeDm === true;
  const kinds =
    mode === "snapshot"
      ? VALID_SNAPSHOT_KINDS
      : [
          KIND_POST,
          KIND_FAVOURITE,
          KIND_FOLLOW,
          KIND_SEARCH,
          KIND_DM_BUDDY,
          KIND_DM_SESSION,
          KIND_DM_MESSAGE,
        ];
  return digest(
    Buffer.from(
      JSON.stringify({
        include: Object.fromEntries(
          kinds.map((kind) => [
            kind,
            kind.startsWith("dm-")
              ? includeDm && include[kind] !== false
              : include[kind] !== false,
          ]),
        ),
        includeDm,
        mode,
        selfUid: mode === "sqlite" ? sqlite.selfUid || null : null,
      }),
      "utf8",
    ),
  );
}

function collectionSource(entries, files) {
  return digest(
    Buffer.from(
      stableStringify({
        entries: entries.map(({ raw, role, row, tableName }) => ({
          kind: raw.payload.kind,
          originalId: raw.originalId,
          role,
          row,
          tableName,
        })),
        files,
      }),
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
  const kinds = [
    KIND_POST,
    KIND_FAVOURITE,
    KIND_FOLLOW,
    KIND_SEARCH,
    KIND_DM_BUDDY,
    KIND_DM_SESSION,
    KIND_DM_MESSAGE,
  ];
  const leftKind = left.kind || left.payload.kind;
  const rightKind = right.kind || right.payload.kind;
  const kindOrder = kinds.indexOf(leftKind) - kinds.indexOf(rightKind);
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

function sqliteEntry({ capturedAt, id, kind, prefix, role, row, tableName }) {
  return {
    raw: {
      adapter: NAME,
      originalId: sqliteOriginalId(prefix, id),
      capturedAt,
      payload: { row, kind },
    },
    role,
    row,
    tableName,
  };
}

function sqliteOriginalId(prefix, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    (typeof id === "bigint" && id.toString()) ||
    null;
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${prefix} SQLite row requires a stable source id`,
    );
  }
  return `${prefix}-${safe}`;
}

function selectFirstQuery(db, tableNames, candidates) {
  let lastFailure = null;
  for (const candidate of candidates) {
    const sourceTable =
      candidate.sourceTable || candidate.tableName.split(":", 1)[0];
    if (!tableNames.has(sourceTable.toLowerCase())) continue;
    try {
      const rows = db.prepare(candidate.sql).all();
      if (!Array.isArray(rows)) {
        throw new Error("SQLite query did not return a row array");
      }
      return { rows, tableName: candidate.tableName };
    } catch (error) {
      lastFailure = { error, sourceTable };
    }
  }
  if (lastFailure) {
    throw sqliteSourceError(lastFailure.sourceTable, "read", lastFailure.error);
  }
  return { rows: [], tableName: null };
}

function sanitizedUid(value) {
  return String(value == null ? "" : value).replace(/[^0-9]/gu, "");
}

function resolveMessageDbPath(opts, baseDbPath, selfUid) {
  if (
    opts &&
    typeof opts.messageDbPath === "string" &&
    opts.messageDbPath.length > 0
  ) {
    return opts.messageDbPath;
  }
  return baseDbPath && selfUid
    ? path.join(path.dirname(baseDbPath), `message_${selfUid}.db`)
    : null;
}

function scopeForLocalFiles(
  fsMod,
  {
    accountScope,
    dbPath,
    includeDm = false,
    inputPath,
    maxBytes,
    messageDbPath,
    mode,
  },
) {
  const files = [];
  if (mode === "snapshot") {
    files.push(
      collectionFileIdentity(
        "snapshot",
        inspectSnapshotFile(fsMod, inputPath, { maxBytes }),
      ),
    );
  } else {
    files.push(
      collectionFileIdentity("main", inspectSqliteFile(fsMod, dbPath)),
    );
    if (includeDm) {
      files.push(
        messageDbPath && fsMod.existsSync(messageDbPath)
          ? collectionFileIdentity(
              "message",
              inspectSqliteFile(fsMod, messageDbPath),
            )
          : missingCollectionFileIdentity("message", messageDbPath),
      );
    }
  }
  return createAccountScope(
    NAME,
    stableStringify({ accountScope: accountScope || "unscoped", files, mode }),
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

function fileCapturedAt(stat) {
  const value = Number(stat && stat.mtimeMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now();
}

function collectionFileIdentity(role, inspected) {
  const revision =
    inspected.stat.mtimeNs ??
    inspected.stat.mtimeMs ??
    inspected.stat.ctimeNs ??
    inspected.stat.ctimeMs ??
    "";
  return {
    missing: false,
    path: inspected.realPath,
    revision: String(revision),
    role,
    size: inspected.size,
  };
}

function missingCollectionFileIdentity(role, inputPath) {
  return {
    missing: true,
    path:
      typeof inputPath === "string" && inputPath.length > 0
        ? path.resolve(inputPath)
        : null,
    revision: null,
    role,
    size: null,
  };
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
    events: [
      {
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
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizePost(p, raw, ingestedAt) {
  // Snapshot mode: { kind:"post", text, mid, source, repostsCount, … } direct
  // Sqlite mode:   { kind:"post", row: { text, mid, ... } }
  const row = p.row || p;
  const isSnapshot = !p.row;
  // home_table (device-verified) stores body in `content`, id in `mblogid`.
  const text = row.text || row.content || "";
  const mid = row.mid || row.mblogid || row.id || row.idstr || null;
  const occurredAt =
    parseTime(row.created_at || row.createdAt || row.time || raw.capturedAt) ||
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
        content: {
          title: (text || "").slice(0, 80) || "(空)",
          text,
        },
        ingestedAt,
        source,
        extra: {
          weiboMid: mid,
          repostsCount:
            row.repostsCount != null
              ? row.repostsCount
              : row.reposts_count || row.repost || row.rtnum || 0,
          commentsCount:
            row.commentsCount != null
              ? row.commentsCount
              : row.comments_count || row.comments || row.commentnum || 0,
          likesCount:
            row.likesCount != null
              ? row.likesCount
              : row.attitudes_count || row.likes || row.attitudenum || 0,
          picCount: row.picCount || row.pic_num || 0,
          source: row.source || null,
          location: row.location || row.geo || null,
          platform: "weibo",
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeFavourite(p, raw, ingestedAt) {
  // Snapshot: { kind:"favourite", mid, text, capturedAt, authorScreenName }
  // Sqlite (device-verified `like_table`): { row: { mblogid, content, time,
  // nick } }. Both shapes handled below.
  const row = p.row || null;
  const isSqlite = !!row;
  const text = isSqlite ? row.content || "" : p.text || "";
  const mid = isSqlite ? row.mblogid || row.id || null : p.mid || null;
  const occurredAt = isSqlite
    ? parseTime(row.time) || raw.capturedAt || ingestedAt
    : parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    isSqlite ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
  );
  return {
    events: [
      {
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
          authorScreenName: isSqlite
            ? row.nick || null
            : p.authorScreenName || null,
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
  // Snapshot: { kind:"follow", uid, screenName, description, avatarUrl,
  //   capturedAt }
  // Sqlite (device-verified `follower_table`): { row: { user_id|id,
  //   screen_name, remark, gender } }. Both shapes handled below.
  const row = p.row || null;
  const isSqlite = !!row;
  const rawUid = isSqlite ? row.user_id || row.id : p.uid;
  const followUid =
    (typeof rawUid === "number" && rawUid) ||
    (typeof rawUid === "string" && rawUid.length > 0 && rawUid) ||
    `unknown-${newId()}`;
  const screenName = isSqlite
    ? row.screen_name || row.remark || "(unnamed)"
    : p.screenName || "(unnamed)";
  const occurredAt = isSqlite
    ? parseTime(row.time) || raw.capturedAt || ingestedAt
    : parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    isSqlite ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
  );
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

// ─── Private-message (私信) normalizers — device-verified message_<uid>.db ──

function normalizeDmBuddy(p, raw, ingestedAt) {
  const row = p.row || {};
  const uid = row.uid != null ? String(row.uid) : `unknown-${newId()}`;
  const name = row.remark || row.screen_name || row.nick || "(unnamed)";
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const person = {
    id: `person-weibo-${uid}`,
    type: ENTITY_TYPES.PERSON,
    subtype: PERSON_SUBTYPES.CONTACT,
    names: [String(name)],
    ingestedAt,
    source,
    identifiers: { "weibo-uid": [uid] },
    extra: {
      platform: "weibo",
      via: "dm",
      gender: row.gender != null ? row.gender : null,
      verified: row.verified === 1 || row.verified === true || null,
      follower: typeof row.follower === "number" ? row.follower : null,
      following: typeof row.following === "number" ? row.following : null,
    },
  };
  return { events: [], persons: [person], places: [], items: [], topics: [] };
}

function normalizeDmSession(p, raw, ingestedAt) {
  const row = p.row || {};
  const sid =
    row.session_id != null ? String(row.session_id) : `unknown-${newId()}`;
  const occurredAt = parseTime(row.update_time) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const topic = {
    id: `topic-weibo-dm-${sid}`,
    type: ENTITY_TYPES.TOPIC,
    name: `微博私信会话 ${sid}`,
    ingestedAt,
    source,
    extra: {
      platform: "weibo",
      via: "dm",
      sessionId: sid,
      sessionType: row.type != null ? row.type : null,
      unread:
        typeof row.im_unread_count === "number" ? row.im_unread_count : null,
      lastUpdate: occurredAt,
    },
  };
  return { events: [], persons: [], places: [], items: [], topics: [topic] };
}

function normalizeDmMessage(p, raw, ingestedAt) {
  const row = p.row || {};
  const occurredAt = parseTime(row.time) || raw.capturedAt || ingestedAt;
  const outgoing = row.outgoing === 1 || row.outgoing === true;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  // content is plain text for text messages (content_type 0/1/null); other
  // types carry structured/empty content → emit a typed placeholder. Encoding
  // is device-verified-schema but best-effort (no rows on reference account).
  const isText =
    row.content_type == null ||
    row.content_type === 0 ||
    row.content_type === 1;
  const rawText =
    isText && typeof row.content === "string" && row.content.length > 0
      ? row.content
      : `[${row.content_type != null ? `type:${row.content_type}` : "non-text"}]`;
  const text = rawText.length > 2000 ? rawText.slice(0, 2000) + "…" : rawText;
  const event = {
    id: `event-weibo-dm-${row.global_id || row.id || newId()}`,
    type: ENTITY_TYPES.EVENT,
    subtype: EVENT_SUBTYPES.MESSAGE,
    occurredAt,
    ingestedAt,
    source,
    actor: outgoing ? "self" : "contact",
    content: { text },
    extra: {
      platform: "weibo",
      via: "dm",
      sessionId: row.session_id != null ? String(row.session_id) : null,
      senderId: row.sender_id != null ? String(row.sender_id) : null,
      contentType: row.content_type != null ? row.content_type : null,
      outgoing,
    },
  };
  return { events: [event], persons: [], places: [], items: [], topics: [] };
}

module.exports = {
  WeiboAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
