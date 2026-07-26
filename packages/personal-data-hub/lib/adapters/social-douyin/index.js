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

const NAME = "social-douyin";
const VERSION = "0.7.0";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_PROFILE = "profile";
const KIND_HISTORY = "history"; // v0.3 (X-Bogus required)
const KIND_FAVOURITE = "favourite"; // v0.3 (X-Bogus required)
const KIND_LIKE = "like"; // v0.3 (X-Bogus required)
const KIND_SEARCH = "search"; // legacy sqlite-mode only
const KIND_MESSAGE = "message"; // Phase 2a — IM private messages from <uid>_im.db (abrignoni DFIR)
const KIND_CONTACT = "contact"; // Phase 2a — SIMPLE_USER/participant contacts from <uid>_im.db
const KIND_CONVERSATION = "conversation"; // device-verified — conversation_list thread → TOPIC

// Forward-compat: list every kind v0.3+ may emit so cc adapter accepts
// snapshots from a newer Android even if this JS hasn't been bumped yet.
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_PROFILE,
  KIND_HISTORY,
  KIND_FAVOURITE,
  KIND_LIKE,
  KIND_MESSAGE,
  KIND_CONTACT,
]);

function stableOriginalId(kind, id) {
  const stringified =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    null;
  if (!stringified) {
    throw new Error(`${NAME}.sync: ${kind} event requires a stable source id`);
  }
  return `douyin:${kind}:${stringified}`;
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
    `social-douyin: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "DOUYIN_SQLITE_SOURCE_UNREADABLE";
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

class DouyinAdapter {
  constructor(opts = {}) {
    // §A8 v0.2: account.uid no longer required at construction — snapshot
    // mode pulls account from the snapshot file. Sqlite mode still requires
    // it at sync time.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;

    this.name = NAME;
    this.defaultScope = createAccountScopeFromAccount(
      NAME,
      this.account || opts,
      ["uid", "secUid", "userId", "accountId", "deviceId"],
    );
    this.version = VERSION;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "sync:im-sqlite",
      "parse:douyin-profile",
      "parse:douyin-history", // v0.3
      "parse:douyin-favourite", // v0.3
      "parse:douyin-like", // v0.3
      "parse:douyin-search", // sqlite-only
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "douyin:profile (sec_user_id / nickname / signature / counts)",
        "douyin:history (aweme_id / title / author / view_time)", // v0.3
        "douyin:favourite", // v0.3
        "douyin:like", // v0.3
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

  fileCheckpointMode() {
    return "shared";
  }

  resolveDefaultScope(options = {}) {
    let inputPath = null;
    let subtype = null;
    if (typeof options.imDbPath === "string" && options.imDbPath.length > 0) {
      inputPath = options.imDbPath;
      subtype = "im";
    } else if (
      typeof options.inputPath === "string" &&
      options.inputPath.length > 0
    ) {
      inputPath = options.inputPath;
      subtype = this._looksLikeSqlite(inputPath) ? "im" : "snapshot";
    } else {
      inputPath =
        typeof options.dbPath === "string" && options.dbPath.length > 0
          ? options.dbPath
          : this._dbPath;
      subtype = inputPath ? "content" : null;
    }
    if (!inputPath) return this.defaultScope;
    return scopeForLocalFile(this._deps.fs, inputPath, {
      accountScope: this.defaultScope,
      maxBytes: subtype === "snapshot" ? options.maxSnapshotBytes : null,
      subtype,
    });
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async authenticate(ctx = {}) {
    if (ctx && typeof ctx.imDbPath === "string" && ctx.imDbPath.length > 0) {
      return probeImSqliteFile(this._deps.fs, ctx.imDbPath);
    }
    if (ctx && typeof ctx.inputPath === "string" && ctx.inputPath.length > 0) {
      if (this._looksLikeSqlite(ctx.inputPath)) {
        return probeImSqliteFile(this._deps.fs, ctx.inputPath);
      }
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
            "social-douyin.authenticate: sqlite mode requires account.uid",
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
    // ── 本地直读样板 (local direct-read) ─────────────────────────────────
    // The most reliable Douyin path: point at a locally-present
    // `<uid>_im.db` (pulled from a rooted device or copied off the phone)
    // and read 私信 + 联系人 straight out of the plaintext SQLite — no ADB
    // orchestration, no snapshot-JSON round trip, no X-Bogus signing.
    //
    // Routing:
    //   1. opts.imDbPath        — explicit IM-db path → direct read
    //   2. opts.inputPath that sniffs as a SQLite file → direct read
    //      (so `cc hub sync-adapter social-douyin --input <uid>_im.db`
    //       just works); a non-SQLite inputPath is a snapshot JSON.
    //   3. opts.dbPath (legacy) — Phase 13.3 video-history tables.
    if (typeof opts.imDbPath === "string" && opts.imDbPath.length > 0) {
      yield* this._syncViaImDb({ ...opts, dbPath: opts.imDbPath });
      return;
    }
    if (typeof opts.inputPath === "string" && opts.inputPath.length > 0) {
      if (this._looksLikeSqlite(opts.inputPath)) {
        yield* this._syncViaImDb({ ...opts, dbPath: opts.inputPath });
        return;
      }
      yield* this._syncViaSnapshot(opts);
      return;
    }
    const dbPath = opts.dbPath || this._dbPath;
    if (dbPath) {
      yield* this._syncViaSqlite({ ...opts, dbPath });
      return;
    }
    throw new Error(
      "social-douyin.sync: needs opts.imDbPath / opts.inputPath (<uid>_im.db or snapshot JSON) OR opts.dbPath (legacy video-history sqlite)",
    );
  }

  /**
   * Cheap SQLite-file sniff via the 16-byte magic header
   * ("SQLite format 3\0"). Lets sync() auto-route a `--input <uid>_im.db`
   * to direct IM read vs treating a `.json` snapshot as SQLite. Returns
   * false on any read error (caller falls back to snapshot path).
   */
  _looksLikeSqlite(filePath) {
    return hasSqliteMagic(this._deps.fs, filePath);
  }

  /**
   * 本地直读 <uid>_im.db — open the plaintext SQLite directly and yield
   * message + contact raw events. Reuses social-douyin-adb/im-db-parser so
   * the defensive column-picker / epoch-normalize / content-JSON logic stays
   * byte-identical with the ADB-pull path (single source of truth). Emits
   * the SAME composite originalIds as the snapshot path so re-syncing the
   * same db (via either route) is idempotent.
   */
  async *_syncViaImDb(opts) {
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const inspected = inspectSqliteFile(this._deps.fs, dbPath);
    const fallbackCapturedAt = fileCapturedAt(inspected.stat);

    const { parseImDb } = require("../social-douyin-adb/im-db-parser");
    const parseOpts = {};
    const limitMessages = positiveLimit(opts.limitMessages);
    const limitContacts = positiveLimit(opts.limitContacts);
    const limitConversations = positiveLimit(opts.limitConversations);
    if (limitMessages !== null) parseOpts.limitMessages = limitMessages;
    if (limitContacts !== null) parseOpts.limitContacts = limitContacts;
    if (limitConversations !== null) {
      parseOpts.limitConversations = limitConversations;
    }
    if (this._deps.dbDriverFactory)
      parseOpts._databaseClass = this._deps.dbDriverFactory();

    const { messages, contacts, conversations, diagnostic } = parseImDb(
      dbPath,
      parseOpts,
    );
    if (typeof opts.onProgress === "function") {
      try {
        opts.onProgress({
          phase: "im-db-parsed",
          adapter: NAME,
          ...diagnostic,
        });
      } catch {
        /* progress is best-effort */
      }
    }

    const include = opts.include || {};
    const records = [];
    messages.forEach((message, index) => {
      if (!message || typeof message !== "object") return;
      const idPart =
        message.conversationId && message.createdTimeMs
          ? `${message.conversationId}-${message.createdTimeMs}`
          : message.senderUid && message.createdTimeMs
            ? `${message.senderUid}-${message.createdTimeMs}`
            : `msg-${index}`;
      records.push({
        adapter: NAME,
        kind: KIND_MESSAGE,
        originalId: stableOriginalId(KIND_MESSAGE, `msg-${idPart}`),
        capturedAt:
          typeof message.createdTimeMs === "number" && message.createdTimeMs > 0
            ? message.createdTimeMs
            : fallbackCapturedAt,
        payload: { kind: KIND_MESSAGE, ...message },
      });
    });
    contacts.forEach((contact, index) => {
      if (!contact || typeof contact !== "object") return;
      records.push({
        adapter: NAME,
        kind: KIND_CONTACT,
        originalId: stableOriginalId(
          KIND_CONTACT,
          contact.uid ? `contact-${contact.uid}` : `contact-${index}`,
        ),
        capturedAt: fallbackCapturedAt,
        payload: { kind: KIND_CONTACT, ...contact },
      });
    });
    for (const conversation of conversations || []) {
      if (
        !conversation ||
        typeof conversation !== "object" ||
        !conversation.conversationId
      ) {
        continue;
      }
      records.push({
        adapter: NAME,
        kind: KIND_CONVERSATION,
        originalId: stableOriginalId(
          KIND_CONVERSATION,
          `conv-${conversation.conversationId}`,
        ),
        capturedAt:
          typeof conversation.lastMsgTimeMs === "number" &&
          conversation.lastMsgTimeMs > 0
            ? conversation.lastMsgTimeMs
            : fallbackCapturedAt,
        payload: { kind: KIND_CONVERSATION, ...conversation },
      });
    }
    // Preserve the parser's SQL order so direct reads remain idempotent with
    // snapshots produced by the ADB collector.
    const selected = records.filter((record) => include[record.kind] !== false);
    yield* this._yieldCollection(opts, {
      config: collectionConfig("sqlite", include, {
        limitContacts,
        limitConversations,
        limitMessages,
        subtype: "im",
      }),
      mode: "sqlite",
      records: selected,
      source: collectionSource(selected, {
        diagnostic,
        file: collectionFileIdentity("im", inspected),
      }),
    });
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
        ev.secUid ||
        ev.awemeId ||
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
      config: collectionConfig("snapshot", include, { subtype: "snapshot" }),
      mode: "snapshot",
      records: records.filter((record) => include[record.kind] !== false),
      source,
    });
  }

  async *_syncViaSqlite(opts) {
    if (!this.account || !this.account.uid) {
      throw new Error(
        "social-douyin._syncViaSqlite: account.uid required (set via new DouyinAdapter({ account: { uid } }) in cli wiring)",
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

    try {
      const entries = [];
      const tableNames = listSqliteTables(db);
      const historySelection = selectFirstQuery(db, tableNames, [
        {
          tableName: "video_history",
          sql: "SELECT * FROM video_history ORDER BY view_time DESC",
        },
        {
          tableName: "history",
          sql: "SELECT * FROM history ORDER BY view_time DESC",
        },
      ]);
      for (const row of historySelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt: parseTime(row.view_time) || fallbackCapturedAt,
            id: row.id || row.aweme_id,
            kind: KIND_HISTORY,
            prefix: "history",
            row,
            tableName: historySelection.tableName,
          }),
        );
      }
      const favouriteSelection = selectFirstQuery(db, tableNames, [
        {
          tableName: "user_favorite",
          sql: "SELECT * FROM user_favorite ORDER BY create_time DESC",
        },
        {
          tableName: "favourite",
          sql: "SELECT * FROM favourite ORDER BY time DESC",
        },
      ]);
      for (const row of favouriteSelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt:
              parseTime(row.create_time || row.time) || fallbackCapturedAt,
            id: row.id || row.aweme_id,
            kind: KIND_FAVOURITE,
            prefix: "fav",
            row,
            tableName: favouriteSelection.tableName,
          }),
        );
      }
      const searchSelection = selectFirstQuery(db, tableNames, [
        {
          tableName: "search_history",
          sql: "SELECT * FROM search_history ORDER BY time DESC",
        },
      ]);
      for (const row of searchSelection.rows) {
        entries.push(
          sqliteEntry({
            capturedAt: parseTime(row.time) || fallbackCapturedAt,
            id: row.id || row._id,
            kind: KIND_SEARCH,
            prefix: "search",
            row,
            tableName: searchSelection.tableName,
          }),
        );
      }
      entries.sort((left, right) =>
        compareCollectionRecords(left.raw, right.raw),
      );
      const include = opts.include || {};
      const selected = entries.filter(
        (entry) => include[entry.raw.payload.kind] !== false,
      );
      yield* this._yieldCollection(opts, {
        config: collectionConfig("sqlite", include, { subtype: "content" }),
        mode: "sqlite",
        records: selected.map((entry) => entry.raw),
        source: collectionSource(selected, {
          file: collectionFileIdentity("content", inspected),
        }),
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
    if (kind === KIND_MESSAGE) {
      return normalizeMessage(p, raw, ingestedAt);
    }
    if (kind === KIND_CONTACT) {
      return normalizeContact(p, raw, ingestedAt);
    }
    if (kind === KIND_CONVERSATION) {
      return normalizeConversation(p, raw, ingestedAt);
    }
    throw new Error(`DouyinAdapter.normalize: unknown kind ${kind}`);
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

function collectionConfig(mode, include, options) {
  const subtype = options.subtype;
  const kinds =
    subtype === "im"
      ? [KIND_MESSAGE, KIND_CONTACT, KIND_CONVERSATION]
      : subtype === "content"
        ? [KIND_HISTORY, KIND_FAVOURITE, KIND_SEARCH]
        : VALID_SNAPSHOT_KINDS;
  return digest(
    Buffer.from(
      JSON.stringify({
        include: Object.fromEntries(
          kinds.map((kind) => [kind, include[kind] !== false]),
        ),
        limits:
          subtype === "im"
            ? {
                contacts: options.limitContacts,
                conversations: options.limitConversations,
                messages: options.limitMessages,
              }
            : null,
        mode,
        subtype,
      }),
      "utf8",
    ),
  );
}

function collectionSource(items, context) {
  return digest(
    Buffer.from(
      stableStringify({
        context,
        records: items.map((item) => {
          const raw = item.raw || item;
          return {
            kind: raw.kind || raw.payload.kind,
            originalId: raw.originalId,
            payload: raw.payload,
            row: item.row,
            tableName: item.tableName,
          };
        }),
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
    KIND_PROFILE,
    KIND_HISTORY,
    KIND_FAVOURITE,
    KIND_LIKE,
    KIND_SEARCH,
    KIND_MESSAGE,
    KIND_CONTACT,
    KIND_CONVERSATION,
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

function positiveLimit(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function selectFirstQuery(db, tableNames, candidates) {
  let lastFailure = null;
  for (const candidate of candidates) {
    if (!tableNames.has(candidate.tableName.toLowerCase())) continue;
    try {
      const rows = db.prepare(candidate.sql).all();
      if (!Array.isArray(rows)) {
        throw new Error("SQLite query did not return a row array");
      }
      return { rows, tableName: candidate.tableName };
    } catch (error) {
      lastFailure = { error, tableName: candidate.tableName };
    }
  }
  if (lastFailure) {
    throw sqliteSourceError(lastFailure.tableName, "read", lastFailure.error);
  }
  return { rows: [], tableName: null };
}

function sqliteEntry({ capturedAt, id, kind, prefix, row, tableName }) {
  return {
    raw: {
      adapter: NAME,
      originalId: sqliteOriginalId(prefix, id),
      capturedAt,
      payload: { row, kind },
    },
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

function scopeForLocalFile(
  fsMod,
  inputPath,
  { accountScope, maxBytes, subtype },
) {
  const inspected =
    subtype === "snapshot"
      ? inspectSnapshotFile(fsMod, inputPath, { maxBytes })
      : inspectSqliteFile(fsMod, inputPath);
  return createAccountScope(
    NAME,
    stableStringify({
      accountScope: accountScope || "unscoped",
      file: collectionFileIdentity(subtype, inspected),
      subtype,
    }),
  );
}

function inspectSqliteFile(fsMod, inputPath) {
  const hasInspectionApi = ["lstatSync", "statSync", "realpathSync"].every(
    (method) => typeof fsMod[method] === "function",
  );
  if (!hasInspectionApi) {
    if (
      typeof fsMod.existsSync !== "function" ||
      !fsMod.existsSync(inputPath)
    ) {
      throw new SnapshotFileError(
        "INPUT_PATH_UNREADABLE",
        "SQLite source is unavailable or unreadable",
      );
    }
    // Some embedders inject a minimal virtual fs alongside a virtual SQLite
    // driver. Production's node:fs dependency always takes the strict path
    // below, including symlink and regular-file checks.
    return {
      linkStat: null,
      realPath: String(inputPath),
      size: 0,
      stat: { mtimeMs: 0 },
    };
  }
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
    path: inspected.realPath,
    revision: String(revision),
    role,
    size: inspected.size,
  };
}

function hasSqliteMagic(fsMod, inputPath) {
  let descriptor;
  try {
    descriptor = fsMod.openSync(inputPath, "r");
    const buffer = Buffer.alloc(16);
    const bytesRead = fsMod.readSync(descriptor, buffer, 0, 16, 0);
    return (
      bytesRead === 16 && buffer.toString("latin1") === "SQLite format 3\u0000"
    );
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        fsMod.closeSync(descriptor);
      } catch {
        // Best-effort close.
      }
    }
  }
}

function probeImSqliteFile(fsMod, inputPath) {
  try {
    inspectSqliteFile(fsMod, inputPath);
    if (!hasSqliteMagic(fsMod, inputPath)) {
      return {
        ok: false,
        reason: "SNAPSHOT_SCHEMA_MISMATCH",
        message: "social-douyin IM source is not a SQLite database",
      };
    }
    return { ok: true, mode: "im-sqlite-file" };
  } catch (error) {
    return {
      ok: false,
      reason: error.code || "INPUT_PATH_UNREADABLE",
      message: error.message,
    };
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
    persons: [
      {
        id: secUid
          ? `person-douyin-${secUid}`
          : `person-douyin-self-${newId()}`,
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
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeHistory(p, raw, ingestedAt) {
  // v0.3 — X-Bogus path. Snapshot fields: { kind:"history", awemeId, title,
  // author, capturedAt, duration }
  const awemeId =
    p.awemeId || p.aweme_id || (p.row && (p.row.aweme_id || p.row.id)) || null;
  const row = p.row || p;
  const title = row.title || row.desc || p.title || "(no title)";
  const author = row.author || row.nickname || p.author || null;
  const duration = row.duration || p.duration || null;
  const occurredAt =
    parseTime(p.capturedAt || row.view_time || row.time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    p.row ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
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
          platform: "douyin",
          awemeId,
          author,
          duration,
          // Source surface from the local video_record.db (homepage_hot / etc.).
          enterFrom: row.enterFrom || row.enter_from || p.enterFrom || null,
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
  // v0.3 — X-Bogus path. Snapshot fields: { kind:"favourite", awemeId, title,
  // author, capturedAt }
  const awemeId =
    p.awemeId || p.aweme_id || (p.row && (p.row.aweme_id || p.row.id)) || null;
  const row = p.row || p;
  const title = row.title || row.desc || p.title || "(no title)";
  const author = row.author || row.nickname || p.author || null;
  const occurredAt =
    parseTime(p.capturedAt || row.create_time || row.time) ||
    raw.capturedAt ||
    ingestedAt;
  const source = buildSource(
    raw,
    occurredAt,
    p.row ? CAPTURED_BY.SQLITE : CAPTURED_BY.API,
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
          platform: "douyin",
          awemeId,
          author,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeLike(p, raw, ingestedAt) {
  // v0.3 — X-Bogus path. Same shape as favourite; semantic diff = a 赞 vs 收藏.
  const awemeId = p.awemeId || (p.row && p.row.aweme_id) || null;
  const title =
    p.title || (p.row && (p.row.title || p.row.desc)) || "(no title)";
  const author =
    p.author || (p.row && (p.row.author || p.row.nickname)) || null;
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.API);
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
        extra: { platform: "douyin", awemeId, author },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeSearch(p, raw, ingestedAt) {
  // sqlite-mode only — payload.row.keyword / row.query
  const row = p.row || {};
  const occurredAt = parseTime(row.time || row.create_time) || ingestedAt;
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

function normalizeMessage(p, raw, ingestedAt) {
  // IM private message from <uid>_im.db (snapshot or 本地直读). Becomes one
  // MESSAGE event. We don't reliably know the self uid here, so actor stays
  // person-self and the real sender is preserved in extra.senderUid (the
  // consumer / EntityResolver can correlate it to a contact person).
  const occurredAt = parseTime(p.createdTimeMs) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const text = typeof p.text === "string" ? p.text : "";
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MESSAGE,
        occurredAt,
        actor: "person-self",
        content: {
          title: text ? text.slice(0, 80) : "(非文本消息)",
          text,
        },
        ingestedAt,
        source,
        extra: {
          platform: "douyin",
          channel: "im",
          senderUid: p.senderUid || null,
          conversationId: p.conversationId || null,
          readStatus: typeof p.readStatus === "number" ? p.readStatus : null,
          // Preserve the raw content blob for non-text message types (stickers
          // / voice / video) so a richer consumer can decode them later.
          contentBlob: typeof p.contentBlob === "string" ? p.contentBlob : null,
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeContact(p, raw, ingestedAt) {
  // SIMPLE_USER row from <uid>_im.db → a contact Person. SIMPLE_USER has no
  // per-row timestamp, so occurredAt falls back to capturedAt.
  const uid =
    (typeof p.uid === "string" && p.uid) ||
    (typeof p.uid === "number" && String(p.uid)) ||
    null;
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const identifiers = {};
  if (uid) identifiers["douyin-uid"] = [uid];
  if (p.shortId) identifiers["douyin-short-id"] = [String(p.shortId)];
  return {
    events: [],
    persons: [
      {
        id: uid ? `person-douyin-${uid}` : `person-douyin-${newId()}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.CONTACT,
        names: [p.name || "(unnamed)"],
        ingestedAt,
        source,
        identifiers,
        extra: {
          platform: "douyin",
          avatarUrl: p.avatarUrl || null,
          // 0/1/2 = none / following / mutual (Douyin follow_status)
          followStatus:
            typeof p.followStatus === "number" ? p.followStatus : null,
        },
      },
    ],
    places: [],
    items: [],
    topics: [],
  };
}

function normalizeConversation(p, raw, ingestedAt) {
  // conversation_list row from <uid>_im.db → a TOPIC (one chat thread).
  const convId =
    (typeof p.conversationId === "string" && p.conversationId) ||
    (typeof p.conversationId === "number" && String(p.conversationId)) ||
    null;
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [
      {
        id: convId
          ? `topic-douyin-conv-${convId}`
          : `topic-douyin-conv-${newId()}`,
        type: ENTITY_TYPES.TOPIC,
        name: convId ? `抖音会话 ${convId}` : "抖音会话",
        ingestedAt,
        source,
        extra: {
          platform: "douyin",
          conversationId: convId,
          conversationType:
            typeof p.conversationType === "number" ? p.conversationType : null,
          lastMsgTimeMs:
            typeof p.lastMsgTimeMs === "number" ? p.lastMsgTimeMs : null,
          stranger: typeof p.stranger === "boolean" ? p.stranger : null,
        },
      },
    ],
  };
}

module.exports = {
  DouyinAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
};
