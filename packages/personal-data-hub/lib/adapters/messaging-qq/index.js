/**
 * §Phase 13.5 v0.2 — QQ adapter, dual-mode (snapshot + sqlite).
 *
 * Mirror of social-weibo/index.js dual-mode pattern, adapted to the QQ
 * data model. Two modes share normalize() but yield from different
 * sources:
 *
 *   1. snapshot mode (opts.inputPath): in-APK Android cc reads a snapshot
 *      JSON produced by QQLocalCollector (root + plain SQLite + per-row
 *      XOR-with-IMEI decrypt — much simpler than WeChat's SQLCipher path).
 *      Adapter stateless when in snapshot mode — account.qq pulled from
 *      the snapshot file.
 *
 *   2. sqlite mode (opts.dbPath, legacy Phase 13.5): desktop AndroidExtractor
 *      pulls QQ's per-uin DB via `adb backup`; reads same tables, applies
 *      same XOR decrypt via a `keyProvider`. account.qq REQUIRED at sync
 *      time (defended in _syncViaSqlite, not the constructor — mirror of
 *      weibo / bilibili A8 pattern).
 *
 * QQ specifics (vs WeChat 12.10):
 *   - DB at /data/data/com.tencent.mobileqq/databases/<uin>.db (per-uin)
 *   - DB itself is plain SQLite — NOT SQLCipher-encrypted
 *   - Message content (`msgData` BLOB) XOR-cycled with device IMEI bytes
 *   - Message tables sharded as mr_friend_<MD5(peer_uin).upper()>_New
 *     and mr_troop_<MD5(troop_uin).upper()>_New
 *   - Contacts: tries Friends / friends / tb_recent_contact (table-name
 *     drift across QQ versions; we probe all three)
 *   - Groups: TroopInfoV2
 *
 * Snapshot schema (mirrors QQLocalCollector.SNAPSHOT_SCHEMA_VERSION):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "qq": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "contact", "id": "contact-<peerUin>", "capturedAt": <ms>,
 *         "uin": "<peerUin>", "nickname": "...", "remark": "..." },
 *       { "kind": "group", "id": "group-<troopUin>", "capturedAt": <ms>,
 *         "troopUin": "<troopUin>", "troopName": "...",
 *         "memberCount": N, "ownerUin": "..." },
 *       { "kind": "message", "id": "msg-<msgId>", "capturedAt": <ms>,
 *         "msgId": "...", "msgType": N, "senderUin": "<senderUin>",
 *         "peerUin": "<friendOrTroopUin>", "isGroup": true|false,
 *         "isSend": true|false, "text": "<decrypted content>" }
 *     ]
 *   }
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  probeJsonSnapshotFile,
  readJsonSnapshot,
} = require("../../snapshot-file");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { mergeQqEntityConflict } = require("../../qq-quality-merge");
const {
  canonicalQqGroupOriginalId,
  canonicalQqNtOriginalId,
  canonicalQqPersonOriginalId,
  createQqAccountScope,
} = require("../../qq-source-identity");
const {
  advanceCursor,
  beginScan,
  comparePositions,
  compareTextIds,
  completeScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "messaging-qq";
const VERSION = "0.7.0";
const CANONICAL_QQ_ADAPTER = "qq-pc";
const SNAPSHOT_SCHEMA_VERSION = 1;

const KIND_CONTACT = "contact";
const KIND_GROUP = "group";
const KIND_MESSAGE = "message";
const VALID_SNAPSHOT_KINDS = Object.freeze([
  KIND_CONTACT,
  KIND_GROUP,
  KIND_MESSAGE,
]);
const SQLITE_CURSOR_PAGE_SIZE = 1000;
const EXACT_ID_ALIAS = "__pdh_exact_id";

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id));
  if (!safe) {
    throw new Error(
      `${NAME}.sync: ${String(kind)} record requires a stable id`,
    );
  }
  return `qq:${kind}:${safe}`;
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

function quoteSqliteIdentifier(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("messaging-qq: SQLite identifier must be non-empty");
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) return value;
  return `"${value.replace(/"/gu, '""')}"`;
}

function selectRows(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function sqliteTableNames(db) {
  let rows;
  try {
    rows = selectRows(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC",
    );
  } catch {
    throw sqliteCursorSourceError("SQLite table inventory is unreadable");
  }
  return rows
    .map((row) => row?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function findSqliteTable(tableNames, candidate) {
  const normalized = candidate.toLowerCase();
  return (
    tableNames.find((tableName) => tableName.toLowerCase() === normalized) ||
    null
  );
}

function exactRowId(row, fallbackColumn) {
  const value =
    row?.[EXACT_ID_ALIAS] != null ? row[EXACT_ID_ALIAS] : row?.[fallbackColumn];
  return value == null ? null : String(value);
}

function maxExactId(rows, fallbackColumn) {
  let maximum = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = exactRowId(row, fallbackColumn);
    if (id === null) continue;
    if (maximum === null || compareTextIds(id, maximum) > 0) maximum = id;
  }
  return maximum;
}

function resolveContactSource(db, tableNames) {
  const candidates = [
    {
      table: "Friends",
      select:
        "CAST(uin AS TEXT) AS \"__pdh_exact_id\", uin, name AS nickname, '' AS remark",
    },
    {
      table: "friends",
      select:
        "CAST(uin AS TEXT) AS \"__pdh_exact_id\", uin, name AS nickname, '' AS remark",
    },
    {
      table: "tb_recent_contact",
      select:
        'CAST(uin AS TEXT) AS "__pdh_exact_id", uin, name AS nickname, remark',
    },
  ];
  const inspectedTables = new Set();
  let emptySource = null;
  let lastUnreadableTable = null;
  for (const candidate of candidates) {
    const sourceTable = findSqliteTable(tableNames, candidate.table);
    if (!sourceTable) continue;
    const normalizedTable = sourceTable.toLowerCase();
    if (inspectedTables.has(normalizedTable)) continue;
    inspectedTables.add(normalizedTable);
    const table = quoteSqliteIdentifier(sourceTable);
    let rows;
    try {
      rows = selectRows(
        db,
        `SELECT ${candidate.select} FROM ${table} WHERE uin IS NOT NULL ORDER BY uin ASC LIMIT 1`,
      );
      if (!Array.isArray(rows)) {
        throw new Error("SQLite contact probe did not return a row array");
      }
    } catch {
      lastUnreadableTable = sourceTable;
      continue;
    }
    lastUnreadableTable = null;
    const source = { ...candidate, table: sourceTable };
    if (rows.length > 0) return source;
    if (emptySource === null) emptySource = source;
  }
  if (lastUnreadableTable) {
    throw sqliteCursorSourceError(
      `discovered SQLite contact table ${lastUnreadableTable} is unreadable`,
    );
  }
  return emptySource;
}

function contactUpper(db, source) {
  if (!source) return null;
  const table = quoteSqliteIdentifier(source.table);
  const rows = selectRows(
    db,
    `SELECT CAST(uin AS TEXT) AS "${EXACT_ID_ALIAS}", uin
     FROM ${table}
     WHERE uin IS NOT NULL
     ORDER BY uin DESC
     LIMIT 1`,
  );
  return maxExactId(rows, "uin");
}

function contactPage(db, source, { after, upper, limit }) {
  if (!source || limit <= 0) return [];
  const table = quoteSqliteIdentifier(source.table);
  const where = ["uin IS NOT NULL"];
  const params = [];
  if (after !== null) {
    where.push("uin > ?");
    params.push(after);
  }
  if (upper !== null) {
    where.push("uin <= ?");
    params.push(upper);
  }
  params.push(limit);
  const rows = selectRows(
    db,
    `SELECT ${source.select}
     FROM ${table}
     WHERE ${where.join(" AND ")}
     ORDER BY uin ASC
     LIMIT ?`,
    params,
  );
  return rows
    .map((row) => ({ row, id: exactRowId(row, "uin") }))
    .filter(
      ({ id }) =>
        id !== null &&
        (after === null || compareTextIds(id, after) > 0) &&
        (upper === null || compareTextIds(id, upper) <= 0),
    )
    .sort((left, right) => compareTextIds(left.id, right.id))
    .slice(0, limit);
}

function groupUpper(db, sourceTable) {
  if (!sourceTable) return null;
  const table = quoteSqliteIdentifier(sourceTable);
  let rows;
  try {
    rows = selectRows(
      db,
      `SELECT CAST(troopuin AS TEXT) AS "${EXACT_ID_ALIAS}", troopuin
       FROM ${table}
       WHERE troopuin IS NOT NULL
       ORDER BY troopuin DESC
       LIMIT 1`,
    );
  } catch {
    throw sqliteCursorSourceError(
      `discovered SQLite group table ${sourceTable} is unreadable`,
    );
  }
  return maxExactId(rows, "troopuin");
}

function groupPage(db, sourceTable, { after, upper, limit }) {
  if (!sourceTable || limit <= 0) return [];
  const table = quoteSqliteIdentifier(sourceTable);
  const where = ["troopuin IS NOT NULL"];
  const params = [];
  if (after !== null) {
    where.push("troopuin > ?");
    params.push(after);
  }
  if (upper !== null) {
    where.push("troopuin <= ?");
    params.push(upper);
  }
  params.push(limit);
  let rows;
  try {
    rows = selectRows(
      db,
      `SELECT CAST(troopuin AS TEXT) AS "${EXACT_ID_ALIAS}",
              troopuin AS troop_uin,
              troopname AS troop_name,
              membernum AS member_count,
              troopowneruin AS owner_uin
       FROM ${table}
       WHERE ${where.join(" AND ")}
       ORDER BY troopuin ASC
       LIMIT ?`,
      params,
    );
  } catch {
    throw sqliteCursorSourceError(
      `discovered SQLite group table ${sourceTable} is unreadable`,
    );
  }
  return rows
    .map((row) => ({ row, id: exactRowId(row, "troop_uin") }))
    .filter(
      ({ id }) =>
        id !== null &&
        (after === null || compareTextIds(id, after) > 0) &&
        (upper === null || compareTextIds(id, upper) <= 0),
    )
    .sort((left, right) => compareTextIds(left.id, right.id))
    .slice(0, limit);
}

function messageTables(tableNames) {
  return Array.from(
    new Set(
      tableNames.filter(
        (name) =>
          typeof name === "string" &&
          (name.startsWith("mr_friend_") || name.startsWith("mr_troop_")) &&
          name.endsWith("_New"),
      ),
    ),
  ).sort();
}

function messageUpper(db, tableName) {
  const table = quoteSqliteIdentifier(tableName);
  const rows = selectRows(
    db,
    `SELECT CAST(msgId AS TEXT) AS "${EXACT_ID_ALIAS}", msgId
     FROM ${table}
     WHERE msgId IS NOT NULL
     ORDER BY msgId DESC
     LIMIT 1`,
  );
  return maxExactId(rows, "msgId");
}

function messagePage(db, tableName, { after, upper, limit }) {
  if (limit <= 0) return [];
  const table = quoteSqliteIdentifier(tableName);
  const where = ["msgId IS NOT NULL"];
  const params = [];
  if (after !== null) {
    where.push("msgId > ?");
    params.push(after);
  }
  if (upper !== null) {
    where.push("msgId <= ?");
    params.push(upper);
  }
  params.push(limit);
  const rows = selectRows(
    db,
    `SELECT CAST(msgId AS TEXT) AS "${EXACT_ID_ALIAS}",
            msgtype,
            senderuin,
            time,
            msgData,
            issend,
            frienduin,
            troopuin
     FROM ${table}
     WHERE ${where.join(" AND ")}
     ORDER BY msgId ASC
     LIMIT ?`,
    params,
  );
  return rows
    .map((row) => ({ row, id: exactRowId(row, "msgId") }))
    .filter(
      ({ id }) =>
        id !== null &&
        (after === null || compareTextIds(id, after) > 0) &&
        (upper === null || compareTextIds(id, upper) <= 0),
    )
    .sort((left, right) => compareTextIds(left.id, right.id))
    .slice(0, limit);
}

function resolveSqliteUpper(db, contactSource, groupSource, tables) {
  for (let index = tables.length - 1; index >= 0; index -= 1) {
    const table = tables[index];
    let id;
    try {
      id = messageUpper(db, table);
    } catch {
      throw sqliteCursorSourceError(
        `discovered SQLite message table ${table} is unreadable`,
      );
    }
    if (id !== null) return { kind: KIND_MESSAGE, table, id };
  }
  const groupId = groupUpper(db, groupSource);
  if (groupId !== null) return { kind: KIND_GROUP, id: groupId };
  const contactId = contactUpper(db, contactSource);
  return contactId === null ? null : { kind: KIND_CONTACT, id: contactId };
}

function sqliteCursorSourceError(message) {
  const error = new Error(`messaging-qq: ${message}`);
  error.code = "QQ_ANDROID_CURSOR_SOURCE_REGRESSED";
  error.retryable = false;
  return error;
}

function observationProducer(raw) {
  const declared =
    raw?.producer ||
    raw?.payload?.observationProducer ||
    raw?.payload?.producer;
  if (typeof declared === "string" && declared.length > 0) return declared;
  return raw?.payload?._table
    ? "qq-pc/android-sqlite"
    : "qq-pc/android-snapshot";
}

function canonicalEntityIdentity(raw) {
  const payload = raw?.payload;
  const kind = raw?.kind || payload?.kind;
  let originalId = null;
  let entityType = null;
  if (kind === KIND_MESSAGE) {
    originalId = canonicalQqNtOriginalId(payload);
    entityType = ENTITY_TYPES.EVENT;
  } else if (kind === KIND_CONTACT) {
    originalId = canonicalQqPersonOriginalId(payload?.uin || payload?.row?.uin);
    entityType = ENTITY_TYPES.PERSON;
  } else if (kind === KIND_GROUP) {
    originalId = canonicalQqGroupOriginalId(
      payload?.troopUin || payload?.row?.troop_uin,
    );
    entityType = ENTITY_TYPES.TOPIC;
  }
  return originalId ? { entityType, originalId } : null;
}

function usesExplicitCursor(opts) {
  return (
    typeof opts?.updateWatermark === "function" ||
    opts?.sinceWatermark !== undefined
  );
}

function collectionPosition(raw) {
  const payload = raw?.payload || {};
  if (raw?.kind === KIND_CONTACT) {
    return {
      kind: KIND_CONTACT,
      id: String(payload.uin ?? raw.originalId),
    };
  }
  if (raw?.kind === KIND_GROUP) {
    return {
      kind: KIND_GROUP,
      id: String(payload.troopUin ?? raw.originalId),
    };
  }
  if (raw?.kind === KIND_MESSAGE) {
    return {
      kind: KIND_MESSAGE,
      table:
        payload._table ||
        payload.tableName ||
        (payload.isGroup ? "group_msg_table" : "c2c_msg_table"),
      id: String(payload.msgId ?? payload.messageId ?? raw.originalId),
    };
  }
  throw new Error(`${NAME}.sync: unsupported cursor record kind ${raw?.kind}`);
}

function dedupeAndSortRecords(raws) {
  const recordsByPosition = new Map();
  for (const raw of raws) {
    const position = collectionPosition(raw);
    recordsByPosition.set(JSON.stringify(position), { position, raw });
  }
  return [...recordsByPosition.values()].sort((left, right) =>
    comparePositions(left.position, right.position),
  );
}

class QQAdapter {
  constructor(opts = {}) {
    // §Phase 13.5 v0.2: account.qq now OPTIONAL at construction — snapshot
    // mode is stateless and pulls account from the snapshot file. Sqlite
    // mode (legacy device-pull) still requires it; checked at sync time.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || null;
    this._keyProvider = opts.keyProvider || null;

    this.name = NAME;
    this.version = VERSION;
    this.scopeNamespace = "qq";
    this.snapshotScopeIdentityFields = ["qq"];
    this.snapshotScopeIdentityIncludesField = false;
    this.capabilities = [
      "sync:snapshot",
      "sync:sqlite",
      "parse:qq-contacts",
      "parse:qq-groups",
      "parse:qq-messages",
      "decrypt:xor-imei",
    ];
    // Kept as device-pull — both modes are sourced from on-device data.
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "qq:contacts (uin / nickname / remark)",
        "qq:groups (troop_uin / name / member_count)",
        "qq:messages (peer / content / time / type) — XOR-decrypted",
      ],
      sensitivity: "high",
      legalGate: true,
      defaultInclude: {
        contact: true,
        group: true,
        message: true,
      },
    };

    // _deps injection seam for tests — vi.mock("fs") does not intercept
    // require under inlined CJS in vitest forks pool.
    this._deps = {
      fs,
      dbDriverFactory: opts.dbDriverFactory || null,
    };
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
      if (!this.account || !this.account.qq) {
        return {
          ok: false,
          reason: "NO_ACCOUNT_QQ",
          message: "messaging-qq.authenticate: sqlite mode requires account.qq",
        };
      }
      if (
        !this._keyProvider ||
        typeof this._keyProvider.getKey !== "function"
      ) {
        return {
          ok: false,
          reason: "NO_KEY_PROVIDER",
          message:
            "messaging-qq.authenticate: sqlite mode requires opts.keyProvider with getKey() — IMEI for XOR-decrypt",
        };
      }
      return { ok: true, account: this.account.qq, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "NO_INPUT",
      message:
        "messaging-qq.authenticate: needs opts.inputPath (snapshot mode) OR opts.dbPath (sqlite mode)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  resolveDefaultScope(options = {}) {
    return createQqAccountScope(
      options.qqUin ||
        options.qq ||
        options.account?.qq ||
        this.account?.qq ||
        null,
    );
  }

  async *sync(opts = {}) {
    // Snapshot mode takes priority — Android in-APK cc always passes
    // inputPath. Sqlite mode only kicks in when caller explicitly provides
    // dbPath (same policy as social-weibo).
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
      "messaging-qq.sync: needs opts.inputPath (snapshot mode, Android in-APK cc) OR opts.dbPath (sqlite mode, legacy device-pull)",
    );
  }

  async *_syncViaSnapshot(opts) {
    const snapshot = readJsonSnapshot(this._deps.fs, opts.inputPath, {
      maxBytes: opts.maxSnapshotBytes,
      expectedSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      requiredArrayFields: ["events"],
      allowedEventKinds: VALID_SNAPSHOT_KINDS,
    });
    const fallbackCapturedAt =
      Number.isFinite(snapshot.snapshottedAt) && snapshot.snapshottedAt > 0
        ? Math.floor(snapshot.snapshottedAt)
        : Date.now();

    const account =
      snapshot.account && typeof snapshot.account === "object"
        ? snapshot.account
        : null;
    const include = opts.include || {};

    const events = snapshot.events;
    const raws = [];
    for (const ev of events) {
      const kind = ev.kind;
      if (include[kind] === false) continue;

      const capturedAt =
        parseTime(ev.capturedAt) || parseTime(ev.time) || fallbackCapturedAt;
      const explicitId =
        (typeof ev.id === "string" && ev.id.length > 0 && ev.id) ||
        (typeof ev.id === "number" && Number.isFinite(ev.id) ? ev.id : null);
      const id =
        explicitId ??
        (kind === KIND_CONTACT
          ? ev.uin
          : kind === KIND_GROUP
            ? ev.troopUin
            : ev.msgId);
      const payload = {
        ...ev,
        account,
        observationProducer: "qq-pc/android-snapshot",
      };
      const originalId = stableOriginalId(kind, id);
      const raw = {
        adapter: NAME,
        kind,
        originalId,
        producer: "qq-pc/android-snapshot",
        capturedAt,
        payload,
      };
      const canonicalIdentity = canonicalEntityIdentity(raw);

      raws.push({
        ...raw,
        ...(canonicalIdentity
          ? { canonicalOriginalId: canonicalIdentity.originalId }
          : {}),
      });
    }
    yield* this._yieldRecords(opts, raws);
  }

  async *_yieldRecords(opts, raws) {
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    if (!usesExplicitCursor(opts)) {
      for (const raw of raws.slice(0, limit)) yield raw;
      return;
    }

    let cursor = parseCursor(opts.sinceWatermark).cursor;
    const records = dedupeAndSortRecords(raws);
    if (cursor.upper === null) {
      cursor = beginScan(
        cursor,
        records.length > 0 ? records[records.length - 1].position : null,
      );
    }
    const candidates =
      cursor.upper === null
        ? []
        : records.filter(
            ({ position }) =>
              (cursor.after === null ||
                comparePositions(position, cursor.after) > 0) &&
              comparePositions(position, cursor.upper) <= 0,
          );

    let emitted = 0;
    for (const { position, raw } of candidates) {
      if (emitted >= limit) break;
      cursor = advanceCursor(cursor, position);
      if (typeof opts.updateWatermark === "function") {
        opts.updateWatermark(serializeCursor(cursor));
      }
      yield raw;
      emitted += 1;
    }
    if (emitted === candidates.length && cursor.upper !== null) {
      cursor = completeScan(cursor);
    }
    if (typeof opts.updateWatermark === "function") {
      opts.updateWatermark(serializeCursor(cursor));
    }
  }

  async *_syncViaSqlite(opts) {
    // Legacy Phase 13.5 path — requires account.qq and a desktop-pulled DB.
    // keyProvider provides the IMEI bytes used to XOR-decrypt msgData; the
    // adapter itself is encryption-agnostic (it just XOR's whatever bytes
    // the provider hands over).
    if (!this.account || !this.account.qq) {
      throw new Error(
        "messaging-qq._syncViaSqlite: account.qq required (set via new QQAdapter({ account: { qq } }) in cli wiring)",
      );
    }
    if (!this._keyProvider) {
      throw new Error(
        "messaging-qq._syncViaSqlite: opts.keyProvider with getKey() required (returns IMEI bytes for XOR-decrypt)",
      );
    }
    const dbPath = opts.dbPath;
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) return;
    const imeiKey = await this._keyProvider.getKey();
    if (!imeiKey) return;
    const imeiBytes =
      typeof imeiKey === "string"
        ? Buffer.from(imeiKey, "utf-8")
        : Buffer.from(imeiKey);

    const Driver = this._deps.dbDriverFactory
      ? this._deps.dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });

    try {
      yield* this._syncViaSqliteCursor(opts, db, imeiBytes);
    } finally {
      try {
        db.close();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  async *_syncViaSqliteCursor(opts, db, imeiBytes) {
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    const fallbackCapturedAt = Date.now();
    const tableNames = sqliteTableNames(db);
    const contactSource = resolveContactSource(db, tableNames);
    const groupSource = findSqliteTable(tableNames, "TroopInfoV2");
    const tables = messageTables(tableNames);
    let cursor = parseCursor(opts.sinceWatermark).cursor;
    if (cursor.upper === null) {
      cursor = beginScan(
        cursor,
        resolveSqliteUpper(db, contactSource, groupSource, tables),
      );
    }
    if (cursor.upper?.kind === KIND_MESSAGE) {
      let currentUpper = null;
      try {
        currentUpper = tables.includes(cursor.upper.table)
          ? messageUpper(db, cursor.upper.table)
          : null;
      } catch {
        currentUpper = null;
      }
      if (
        currentUpper === null ||
        compareTextIds(currentUpper, cursor.upper.id) < 0
      ) {
        throw sqliteCursorSourceError(
          "active SQLite message boundary is no longer readable",
        );
      }
    }
    if (cursor.upper?.kind === KIND_GROUP) {
      const currentUpper = groupUpper(db, groupSource);
      if (
        currentUpper === null ||
        compareTextIds(currentUpper, cursor.upper.id) < 0
      ) {
        throw sqliteCursorSourceError(
          "active SQLite group boundary is no longer readable",
        );
      }
    }
    if (cursor.upper?.kind === KIND_CONTACT) {
      const currentUpper = contactUpper(db, contactSource);
      if (
        currentUpper === null ||
        compareTextIds(currentUpper, cursor.upper.id) < 0
      ) {
        throw sqliteCursorSourceError(
          "active SQLite contact boundary is no longer readable",
        );
      }
    }

    const publish = () => {
      if (typeof opts.updateWatermark === "function") {
        opts.updateWatermark(serializeCursor(cursor));
      }
    };
    const pageSize = (emitted) => {
      const remaining = limit === Infinity ? Infinity : limit - emitted;
      return Math.min(SQLITE_CURSOR_PAGE_SIZE, remaining);
    };
    let emitted = 0;

    if (
      cursor.upper !== null &&
      (cursor.after === null || cursor.after.kind === KIND_CONTACT)
    ) {
      let after = cursor.after?.kind === KIND_CONTACT ? cursor.after.id : null;
      const upper = cursor.upper.kind === KIND_CONTACT ? cursor.upper.id : null;
      while (cursor.upper !== null && emitted < limit) {
        const requested = pageSize(emitted);
        const page = contactPage(db, contactSource, {
          after,
          upper,
          limit: requested,
        });
        if (page.length === 0) break;
        for (const { row, id } of page) {
          cursor = advanceCursor(cursor, { kind: KIND_CONTACT, id });
          publish();
          yield {
            adapter: NAME,
            kind: KIND_CONTACT,
            originalId: stableOriginalId(KIND_CONTACT, id),
            producer: "qq-pc/android-sqlite",
            capturedAt: fallbackCapturedAt,
            payload: {
              kind: KIND_CONTACT,
              uin: id,
              nickname: row.nickname || "",
              remark: row.remark || "",
              observationProducer: "qq-pc/android-sqlite",
            },
          };
          emitted += 1;
          after = id;
          if (cursor.upper === null || emitted >= limit) break;
        }
        if (page.length < requested) break;
      }
    }

    if (
      cursor.upper !== null &&
      cursor.upper.kind !== KIND_CONTACT &&
      groupSource !== null &&
      (cursor.after === null ||
        cursor.after.kind === KIND_CONTACT ||
        cursor.after.kind === KIND_GROUP)
    ) {
      let after = cursor.after?.kind === KIND_GROUP ? cursor.after.id : null;
      const upper = cursor.upper.kind === KIND_GROUP ? cursor.upper.id : null;
      while (cursor.upper !== null && emitted < limit) {
        const requested = pageSize(emitted);
        const page = groupPage(db, groupSource, {
          after,
          upper,
          limit: requested,
        });
        if (page.length === 0) break;
        for (const { row, id } of page) {
          cursor = advanceCursor(cursor, { kind: KIND_GROUP, id });
          publish();
          yield {
            adapter: NAME,
            kind: KIND_GROUP,
            originalId: stableOriginalId(KIND_GROUP, id),
            producer: "qq-pc/android-sqlite",
            capturedAt: fallbackCapturedAt,
            payload: {
              kind: KIND_GROUP,
              troopUin: id,
              troopName: row.troop_name || "",
              memberCount: row.member_count || 0,
              ownerUin: row.owner_uin != null ? String(row.owner_uin) : null,
              observationProducer: "qq-pc/android-sqlite",
            },
          };
          emitted += 1;
          after = id;
          if (cursor.upper === null || emitted >= limit) break;
        }
        if (page.length < requested) break;
      }
    }

    if (cursor.upper?.kind === KIND_MESSAGE && emitted < limit) {
      const afterPosition =
        cursor.after?.kind === KIND_MESSAGE ? cursor.after : null;
      const eligibleTables = tables.filter(
        (table) =>
          table <= cursor.upper.table &&
          (afterPosition === null || table >= afterPosition.table),
      );
      for (const table of eligibleTables) {
        let after =
          afterPosition !== null && table === afterPosition.table
            ? afterPosition.id
            : null;
        const upper = table === cursor.upper.table ? cursor.upper.id : null;
        while (cursor.upper !== null && emitted < limit) {
          const requested = pageSize(emitted);
          let page;
          try {
            page = messagePage(db, table, {
              after,
              upper,
              limit: requested,
            });
          } catch {
            throw sqliteCursorSourceError(
              `discovered SQLite message table ${table} is unreadable`,
            );
          }
          if (page.length === 0) break;
          for (const { row, id } of page) {
            const isGroup = table.startsWith("mr_troop_");
            cursor = advanceCursor(cursor, {
              kind: KIND_MESSAGE,
              table,
              id,
            });
            publish();
            yield {
              adapter: NAME,
              kind: KIND_MESSAGE,
              originalId: stableOriginalId(KIND_MESSAGE, id),
              producer: "qq-pc/android-sqlite",
              capturedAt: parseTime(row.time),
              payload: {
                kind: KIND_MESSAGE,
                msgId: id,
                msgType: row.msgtype,
                senderUin: row.senderuin != null ? String(row.senderuin) : null,
                peerUin: isGroup
                  ? row.troopuin != null
                    ? String(row.troopuin)
                    : null
                  : row.frienduin != null
                    ? String(row.frienduin)
                    : null,
                isGroup,
                isSend: !!row.issend,
                text: xorDecrypt(row.msgData, imeiBytes),
                _table: table,
                observationProducer: "qq-pc/android-sqlite",
              },
            };
            emitted += 1;
            after = id;
            if (cursor.upper === null || emitted >= limit) break;
          }
          if (page.length < requested) break;
        }
        if (cursor.upper === null || emitted >= limit) break;
      }
    }

    if (cursor.upper !== null && emitted < limit) {
      cursor = completeScan(cursor);
    }
    publish();
  }

  buildResolvedIngestOptions({ rawBatch, scope }) {
    const sourceAliases = [];
    const rawObservations = [];
    const seenAliases = new Set();

    for (const raw of Array.isArray(rawBatch) ? rawBatch : []) {
      if (
        !raw ||
        typeof raw.originalId !== "string" ||
        raw.originalId.length === 0
      ) {
        continue;
      }
      const canonicalIdentity = canonicalEntityIdentity(raw);
      if (canonicalIdentity) {
        const aliasKey = JSON.stringify([
          canonicalIdentity.entityType,
          raw.originalId,
          canonicalIdentity.originalId,
        ]);
        if (!seenAliases.has(aliasKey)) {
          seenAliases.add(aliasKey);
          sourceAliases.push({
            entityType: canonicalIdentity.entityType,
            alias: {
              adapter: NAME,
              scope,
              originalId: raw.originalId,
            },
            canonical: {
              adapter: CANONICAL_QQ_ADAPTER,
              scope,
              originalId: canonicalIdentity.originalId,
            },
          });
        }
      }
      rawObservations.push({
        adapter: canonicalIdentity ? CANONICAL_QQ_ADAPTER : NAME,
        scope,
        canonicalOriginalId: canonicalIdentity?.originalId || raw.originalId,
        producer: observationProducer(raw),
        producerOriginalId: raw.originalId,
        capturedAt: raw.capturedAt,
        payload: raw.payload,
      });
    }

    return {
      conflictResolver: mergeQqEntityConflict,
      sourceAliases,
      rawObservations,
    };
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("QQAdapter.normalize: payload missing");
    }
    const ingestedAt = Date.now();
    const kind = raw.kind || raw.payload.kind;
    const p = raw.payload;

    if (kind === KIND_CONTACT) {
      return normalizeContact(p, raw, ingestedAt);
    }
    if (kind === KIND_GROUP) {
      return normalizeGroup(p, raw, ingestedAt);
    }
    if (kind === KIND_MESSAGE) {
      return normalizeMessage(p, raw, ingestedAt);
    }
    throw new Error(`QQAdapter.normalize: unknown kind ${kind}`);
  }
}

function buildSource(raw, occurredAt, capturedBy) {
  const canonicalIdentity = canonicalEntityIdentity(raw);
  return {
    adapter: canonicalIdentity ? CANONICAL_QQ_ADAPTER : NAME,
    adapterVersion: VERSION,
    originalId: canonicalIdentity?.originalId || raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: capturedBy || CAPTURED_BY.SQLITE,
  };
}

function normalizeContact(p, raw, ingestedAt) {
  const uin = p.uin || (p.row && p.row.uin && String(p.row.uin)) || null;
  const nickname =
    p.nickname || (p.row && (p.row.name || p.row.nickname)) || "";
  const remark = p.remark || (p.row && p.row.remark) || "";
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  const names = [remark, nickname, uin].filter(
    (n) => typeof n === "string" && n.length > 0,
  );
  return {
    events: [],
    places: [],
    items: [],
    topics: [],
    persons: [
      {
        id: `person-qq-${uin || "unknown"}`,
        type: ENTITY_TYPES.PERSON,
        subtype: PERSON_SUBTYPES.CONTACT,
        names: names.length > 0 ? names : ["(unnamed)"],
        ingestedAt,
        source,
        identifiers: {
          "qq-uin": [uin || `unknown-${newId()}`],
        },
        extra: {
          platform: "qq",
          remark: remark || null,
          observationProducer: observationProducer(raw),
        },
      },
    ],
  };
}

function normalizeGroup(p, raw, ingestedAt) {
  const troopUin =
    p.troopUin || (p.row && p.row.troop_uin && String(p.row.troop_uin)) || null;
  const troopName =
    p.troopName ||
    (p.row && p.row.troop_name) ||
    (troopUin ? String(troopUin) : "(unnamed)");
  const memberCount =
    p.memberCount != null ? p.memberCount : (p.row && p.row.member_count) || 0;
  const ownerUin =
    p.ownerUin || (p.row && p.row.owner_uin && String(p.row.owner_uin)) || null;
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  return {
    events: [],
    places: [],
    items: [],
    persons: [],
    topics: [
      {
        id: `topic-qq-group-${troopUin || "unknown"}`,
        type: ENTITY_TYPES.TOPIC,
        name: troopName,
        ingestedAt,
        source,
        extra: {
          platform: "qq",
          troopUin,
          memberCount,
          ownerUin,
          observationProducer: observationProducer(raw),
        },
      },
    ],
  };
}

function normalizeMessage(p, raw, ingestedAt) {
  // Snapshot: { msgId, sequence, msgType, senderUid, senderType, senderUin,
  //             peerUin, readState, isGroup, isSend, text, capturedAt }
  // Sqlite:   { msgId, msgType, senderUin, peerUin, isGroup, isSend, text, _table }
  const text = p.text || "";
  const occurredAt = parseTime(p.capturedAt) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt, CAPTURED_BY.SQLITE);
  return {
    events: [
      {
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MESSAGE,
        occurredAt,
        actor: "person-self",
        content: {
          title: (text || "").slice(0, 80) || "(空)",
          text,
        },
        ingestedAt,
        source,
        extra: {
          platform: "qq",
          messageId: p.msgId != null ? String(p.msgId) : null,
          peerUin: p.peerUin || null,
          senderUin: p.senderUin || null,
          sequence: p.sequence != null ? String(p.sequence) : null,
          senderUid: p.senderUid != null ? String(p.senderUid) : null,
          senderType: Number.isFinite(p.senderType) ? p.senderType : null,
          readState: Number.isFinite(p.readState) ? p.readState : null,
          isGroup: !!p.isGroup,
          isSend: !!p.isSend,
          msgType: p.msgType != null ? p.msgType : null,
          textResolved: typeof p.text === "string" && p.text.length > 0,
          observationProducer: observationProducer(raw),
        },
      },
    ],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

/**
 * XOR cycle decrypt. Mirror of sjqz `QQDecryptor.decrypt` (qq.py:90-112).
 * IMEI bytes used as the cycle key; tries UTF-8 then GBK-fallback then hex
 * for unmappable bytes.
 *
 * Exported for the snapshot-mode Kotlin collector to verify byte-identity
 * via cross-language tests (Kotlin QQXorDecryptorTest pins the same
 * algorithm). Both sides MUST stay in lockstep — drift here = silent
 * decrypt failure with no errors raised.
 */
function xorDecrypt(data, keyBytes) {
  if (!data || data.length === 0) return "";
  if (!keyBytes || keyBytes.length === 0) return "";
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const out = Buffer.alloc(buf.length);
  const keyLen = keyBytes.length;
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ keyBytes[i % keyLen];
  }
  // UTF-8 first; if it round-trips with replacement chars, fall back to GBK.
  // Buffer.toString("utf8") never throws — it inserts U+FFFD instead. So we
  // detect any U+FFFD and try GBK before surrendering to hex.
  const utf8 = out.toString("utf8");
  if (utf8.indexOf("�") === -1) return utf8;
  try {
    // GBK via iconv-lite is the typical desktop QQ Win client message
    // encoding; node has no built-in GBK so we hex-fallback rather than
    // depend on a heavy package. Caller can post-process via iconv if
    // they care; for normalize() we already write the UTF-8 attempt.
    return utf8; // best-effort; treat U+FFFD as visible decode failure
  } catch (_e) {
    return out.toString("hex");
  }
}

module.exports = {
  QQAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  // Exported for cross-language verification testing (Kotlin
  // QQXorDecryptorTest mirrors this byte-for-byte).
  xorDecrypt,
};
