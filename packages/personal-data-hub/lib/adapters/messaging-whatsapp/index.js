/**
 * Phase 13.7 — WhatsApp adapter.
 *
 * Per sjqz/parsers/whatsapp.py WhatsAppParser. WhatsApp Android stores
 * messages in `msgstore.db` (encrypted with crypt14/crypt15 layered on
 * SQLite). v0.7 accepts either a decrypted `msgstore.db`, or a `.crypt14` /
 * `.crypt15` backup together with the user's own key/keyProvider. Encrypted
 * input is authenticated, stream-decrypted and decompressed to a mode-0600
 * temporary DB, which is removed as soon as sync finishes.
 *
 * Tables of interest:
 *   - jid                contacts + chats (jid = WhatsApp ID)
 *   - chat               chat metadata
 *   - message            messages
 *   - call_log           call records
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { newId } = require("../../ids");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  decryptWhatsAppBackupToFile,
  inspectWhatsAppBackupFile,
  isEncryptedWhatsAppBackup,
} = require("./backup-decryptor");
const { createWhatsAppBackupExtension } = require("./adb-extension");
const {
  POSITION_KINDS,
  advanceCursor,
  beginScan,
  comparePositions,
  compareTextIds,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "messaging-whatsapp";
const VERSION = "1.0.0";
const CURSOR_PAGE_SIZE = 1000;
const EXACT_ID_ALIAS = "__pdh_exact_id";
const RELATION_ID_ALIAS = "__pdh_relation_message_id";
const KIND_CONTACT = "contact";
const KIND_CHAT = "chat";
const KIND_MODERN_MESSAGE = "modern-message";
const KIND_LEGACY_MESSAGE = "legacy-message";
const KIND_CALL = "call";

class WhatsAppAdapter {
  constructor(opts = {}) {
    // 2026-05-25 — account.phone OPTIONAL (mirror Taobao/Ctrip/Telegram).
    // Account is optional. The adapter accepts a local msgstore DB/backup or,
    // when the host wires bridgeProvider, pulls the encrypted public backup
    // over ADB and decrypts it with the user's own key.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || opts.inputPath || null;
    this._keyProvider = opts.keyProvider || opts.key || opts.keyPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;
    this._bridgeProvider = opts.bridgeProvider || null;

    this.name = NAME;
    this.version = VERSION;
    this.scopeNamespace = "whatsapp";
    this.snapshotScopeIdentityFields = ["phone"];
    this.snapshotScopeIdentityIncludesField = false;
    this.capabilities = [
      "sync:sqlite",
      "sync:snapshot",
      "sync:adb-public-backup",
      "decrypt:whatsapp-crypt14",
      "decrypt:whatsapp-crypt15",
      "parse:whatsapp-messages",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: [
        "whatsapp:jid (contacts + chats)",
        "whatsapp:messages (text / media / time)",
        "whatsapp:call_log",
      ],
      sensitivity: "high",
      legalGate: true,
    };
  }

  async authenticate(ctx = {}) {
    const dbPath = (ctx && (ctx.inputPath || ctx.dbPath)) || this._dbPath;
    if (dbPath && !fs.existsSync(dbPath)) {
      return {
        ok: false,
        reason: "INPUT_PATH_UNREADABLE",
        message: "WhatsApp snapshot path does not exist or is unreadable",
      };
    }
    if (!dbPath) {
      const bridgeProvider = ctx.bridgeProvider || this._bridgeProvider;
      if (!ctx.readinessOnly) {
        const bridge = tryResolveBridge(bridgeProvider);
        if (
          bridge &&
          (ctx.keyProvider || ctx.key || ctx.keyPath || this._keyProvider)
        ) {
          return {
            ok: true,
            account: this.account ? this.account.phone : null,
            mode: "adb-public-backup",
          };
        }
      }
      return {
        ok: false,
        reason: bridgeProvider ? "ADB_PULL_REQUIRED" : "DB_NOT_PULLED",
        message: bridgeProvider
          ? "connect Android and sync with the user's crypt14/crypt15 key"
          : "needs ctx.inputPath / opts.dbPath pointing to msgstore.db(.crypt14/.crypt15)",
      };
    }
    if (isEncryptedWhatsAppBackup(dbPath)) {
      if (!(ctx.keyProvider || ctx.key || ctx.keyPath || this._keyProvider)) {
        return {
          ok: false,
          reason: "KEY_REQUIRED",
          message:
            "encrypted WhatsApp backup requires the user's key/keyPath/keyProvider",
        };
      }
      try {
        const header = inspectWhatsAppBackupFile(dbPath);
        return {
          ok: true,
          account: this.account ? this.account.phone : null,
          mode: header.format,
        };
      } catch (error) {
        return {
          ok: false,
          reason: error.code || "BAD_BACKUP",
          message: error.message,
        };
      }
    }
    return {
      ok: true,
      account: this.account ? this.account.phone : null,
      mode: "snapshot-file",
    };
  }

  async healthCheck(opts = {}) {
    const r = await this.authenticate(opts);
    return r.ok ? { ok: true, lastChecked: Date.now() } : r;
  }

  resolveDefaultScope(options = {}) {
    return createAccountScopeFromAccount(
      this.scopeNamespace,
      options.account || this.account,
      this.snapshotScopeIdentityFields,
    );
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async *sync(opts = {}) {
    let dbPath = opts.inputPath || opts.dbPath || this._dbPath;
    let sourceCleanup = null;
    if (!dbPath) {
      const bridge = resolveBridge(opts.bridgeProvider || this._bridgeProvider);
      if (!bridge || typeof bridge.invoke !== "function") {
        const error = new Error(
          "messaging-whatsapp: ADB backup bridge is unavailable",
        );
        error.code = "WHATSAPP_ADB_BRIDGE_UNAVAILABLE";
        throw error;
      }
      const pulled = await bridge.invoke("whatsapp.backup", {
        serial: opts.serial,
        business: opts.business === true,
        remotePath: opts.remotePath,
        timeoutMs: opts.timeoutMs,
      });
      dbPath = pulled && pulled.localPath;
      sourceCleanup =
        pulled && typeof pulled.cleanup === "function" ? pulled.cleanup : null;
    }
    if (!dbPath || !fs.existsSync(dbPath)) {
      runCleanup(sourceCleanup);
      sourceCleanup = null;
      const error = new Error(
        dbPath
          ? "messaging-whatsapp: input database not found"
          : "messaging-whatsapp: ADB backup did not provide a local path",
      );
      error.code = dbPath
        ? "INPUT_PATH_UNREADABLE"
        : "WHATSAPP_BACKUP_NOT_FOUND";
      throw error;
    }
    let openPath = dbPath;
    let tempDir = null;
    if (isEncryptedWhatsAppBackup(dbPath)) {
      const keyProvider =
        opts.keyProvider || opts.key || opts.keyPath || this._keyProvider;
      if (!keyProvider) {
        runCleanup(sourceCleanup);
        const error = new Error(
          "messaging-whatsapp: encrypted backup requires key/keyPath/keyProvider",
        );
        error.code = "WHATSAPP_BACKUP_KEY_REQUIRED";
        throw error;
      }
      try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pdh-whatsapp-"));
      } catch (error) {
        runCleanup(sourceCleanup);
        throw error;
      }
      openPath = path.join(tempDir, "msgstore.db");
      try {
        await decryptWhatsAppBackupToFile({
          inputPath: dbPath,
          outputPath: openPath,
          keyProvider,
        });
      } catch (error) {
        removeTempDir(tempDir);
        runCleanup(sourceCleanup);
        throw error;
      }
    }
    let db;
    try {
      const Driver = this._dbDriverFactory
        ? this._dbDriverFactory()
        : require("better-sqlite3-multiple-ciphers");
      db = new Driver(openPath, { readonly: true });
      yield* this._syncCursor(opts, db);
    } finally {
      try {
        if (db) db.close();
      } catch {
        // Best-effort close; preserve the primary sync result or error.
      }
      removeTempDir(tempDir);
      runCleanup(sourceCleanup);
    }
  }

  async *_syncCursor(opts, db) {
    const tableNames = listSqliteTables(db);
    let cursor = parseCursor(opts.sinceWatermark).cursor;
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    if (cursor.upper === null) {
      cursor = beginScan(cursor, resolveSourceBounds(db, tableNames));
    } else {
      assertFrozenSources(db, tableNames, cursor.upper);
    }

    const publish = () => {
      if (typeof opts.updateWatermark === "function") {
        opts.updateWatermark(serializeCursor(cursor));
      }
    };
    const pageSize = (emitted) => {
      const remaining = limit === Infinity ? Infinity : limit - emitted;
      return Math.min(CURSOR_PAGE_SIZE, remaining);
    };
    const fallbackCapturedAt = Date.now();
    let emitted = 0;

    for (const kind of POSITION_KINDS) {
      if (cursor.upper === null || emitted >= limit) break;
      const upper = cursor.upper[kind];
      if (upper === null) continue;
      if (
        cursor.after !== null &&
        comparePositions(cursor.after, { kind, id: upper }) > 0
      ) {
        continue;
      }
      let after = cursor.after?.kind === kind ? cursor.after.id : null;
      while (cursor.upper !== null && emitted < limit) {
        const requested = pageSize(emitted);
        let page = readSourcePage(db, kind, {
          after,
          upper,
          limit: requested,
        });
        if (page.length === 0) {
          if (after === upper) break;
          throw sourceRegression(
            `${kind} source no longer reaches its frozen boundary`,
          );
        }
        if (kind === KIND_MODERN_MESSAGE) {
          const related = loadModernMessageRelations(
            db,
            tableNames,
            page.map(({ id }) => id),
          );
          page = page.map(({ row, id }) => ({
            id,
            row: attachMessageRelations(row, related, id),
          }));
        }
        const modernIndex =
          kind === KIND_LEGACY_MESSAGE
            ? loadModernMessageIndex(
                db,
                cursor.upper[KIND_MODERN_MESSAGE],
                page,
              )
            : null;

        for (const { row, id } of page) {
          cursor = advanceCursor(cursor, { kind, id });
          publish();
          after = id;

          if (
            kind === KIND_LEGACY_MESSAGE &&
            modernIndex.fingerprints.has(messageFingerprint(row))
          ) {
            if (cursor.upper === null) break;
            continue;
          }

          yield rawFromCursorRow({
            kind,
            id,
            row,
            modernIdCollision:
              kind === KIND_LEGACY_MESSAGE && modernIndex.ids.has(id),
            fallbackCapturedAt,
          });
          emitted += 1;
          if (cursor.upper === null || emitted >= limit) break;
        }
        if (cursor.upper === null || page.length < requested) break;
      }
    }
    publish();
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt =
      parseTime(row.timestamp || row.received_timestamp) || now;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: occurredAt,
      capturedBy: "sqlite",
    };

    if (kind === "contact") {
      // WhatsApp jids are "<phone>@s.whatsapp.net" or "<phone>@g.us" (group)
      const isGroup =
        typeof row.raw_string === "string" && row.raw_string.includes("@g.us");
      if (isGroup) {
        return {
          events: [],
          places: [],
          items: [],
          persons: [],
          topics: [
            {
              id: `topic-whatsapp-${row.raw_string}`,
              type: "topic",
              name: row.display_name || row.raw_string,
              ingestedAt: now,
              source,
              extra: { fromAdapter: NAME, jid: row.raw_string },
            },
          ],
        };
      }
      const phone = (row.user || "").replace(/[^0-9]/g, "");
      return {
        events: [],
        places: [],
        items: [],
        topics: [],
        persons: [
          {
            id: `person-whatsapp-${row.raw_string || row.user || row._id}`,
            type: "person",
            subtype: "contact",
            names: [row.display_name, row.user].filter(
              (x) => typeof x === "string" && x.length > 0,
            ),
            identifiers: phone ? { phone: [phone] } : {},
            ingestedAt: now,
            source,
            extra: { fromAdapter: NAME, jid: row.raw_string },
          },
        ],
      };
    }

    if (kind === "chat") {
      const chatJid = row.chat_jid || row.raw_string || null;
      return {
        events: [],
        places: [],
        items: [],
        persons: [],
        topics: [
          {
            id: `topic-whatsapp-chat-${row._id}`,
            type: "topic",
            name: row.subject || row.display_name || chatJid || String(row._id),
            ingestedAt: now,
            source,
            extra: {
              fromAdapter: NAME,
              jid: chatJid,
              archived: !!row.archived,
            },
          },
        ],
      };
    }

    if (kind === "call") {
      return {
        events: [
          {
            id: newId(),
            type: "event",
            subtype: "call",
            occurredAt,
            actor: row.from_me
              ? "person-self"
              : `person-whatsapp-${row.jid || row.jid_row_id || "unknown"}`,
            content: {
              title: `WhatsApp call (${row.video_call ? "video" : "voice"})`,
            },
            ingestedAt: now,
            source,
            extra: {
              jid: row.jid || null,
              groupJid: row.group_jid || null,
              duration: row.duration || null,
              isVideo: !!row.video_call,
              fromMe: !!row.from_me,
              callResult: row.call_result || null,
            },
          },
        ],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }

    // message
    const isOutgoing = (row.from_me ?? row.key_from_me) === 1;
    const chatJid = row.chat_jid || row.key_remote_jid || null;
    const senderJid = row.sender_jid || row.remote_resource || null;
    const actorJid = senderJid || chatJid;
    const media = row._media || null;
    const location = row._location || legacyLocation(row);
    const mediaRefs = [
      media && media.file_path,
      media && media.direct_path,
      media && media.message_url,
    ].filter((value) => typeof value === "string" && value.length > 0);
    const placeId = hasCoordinates(location)
      ? `place-whatsapp-${row._id}`
      : null;
    const topicId =
      row.chat_row_id != null ? `topic-whatsapp-chat-${row.chat_row_id}` : null;
    const text = row.text_data || row.data || mediaCaption(row) || "";
    return {
      events: [
        {
          id: newId(),
          type: "event",
          subtype: "message",
          occurredAt,
          actor: isOutgoing
            ? "person-self"
            : `person-whatsapp-${actorJid || "unknown"}`,
          ...(placeId ? { place: placeId } : {}),
          ...(topicId ? { topics: [topicId] } : {}),
          content: {
            title: text.slice(0, 80) || "(空)",
            text,
            ...(mediaRefs.length > 0 ? { mediaRefs } : {}),
          },
          ingestedAt: now,
          source,
          extra: {
            jid: chatJid,
            senderJid,
            chatRowId: row.chat_row_id ?? null,
            isOutgoing,
            messageType: row.message_type ?? row.media_wa_type ?? null,
            mediaType:
              (media && media.mime_type) ||
              row.media_mime_type ||
              row.media_wa_type ||
              null,
            media,
            location,
            vcards: row._vcards || [],
            quotedMessage: row._quoted || null,
            status: row.status || null,
          },
        },
      ],
      persons: [],
      places: placeId
        ? [
            {
              id: placeId,
              type: "place",
              name:
                location.place_name ||
                location.place_address ||
                "WhatsApp location",
              coordinates: {
                lat: Number(location.latitude),
                lng: Number(location.longitude),
              },
              ...(location.place_address
                ? { address: location.place_address }
                : {}),
              aliases: [],
              ingestedAt: now,
              source,
              extra: { fromAdapter: NAME, url: location.url || null },
            },
          ]
        : [],
      items: [],
      topics: [],
    };
  }
}

function sqliteSourceError(tableName, operation, cause) {
  const error = new Error(
    `messaging-whatsapp: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "WHATSAPP_SQLITE_SOURCE_UNREADABLE";
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

function readTableRows(db, tableName, sql, params = []) {
  try {
    const rows = db.prepare(sql).all(...params);
    if (!Array.isArray(rows)) {
      throw new Error("SQLite query did not return a row array");
    }
    return rows;
  } catch (error) {
    throw sqliteSourceError(tableName, "read", error);
  }
}

function selectCompatibleRows(db, tableName, candidates) {
  let lastFailure = null;
  for (const candidate of candidates) {
    try {
      const rows = db.prepare(candidate.sql).all(...candidate.params);
      if (!Array.isArray(rows)) {
        throw new Error("SQLite query did not return a row array");
      }
      return rows;
    } catch (error) {
      lastFailure = error;
    }
  }
  throw sqliteSourceError(tableName, "read", lastFailure);
}

function exactRowId(row, fallbackColumn = "_id") {
  const value =
    row?.[EXACT_ID_ALIAS] != null ? row[EXACT_ID_ALIAS] : row?.[fallbackColumn];
  return value == null ? null : String(value);
}

function withExactId(row, id, fallbackColumn = "_id") {
  const payloadRow = { ...row, [fallbackColumn]: id };
  delete payloadRow[EXACT_ID_ALIAS];
  return payloadRow;
}

function normalizedPage(rows, { after, upper, limit }) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = exactRowId(row);
      return id === null ? null : { id, row: withExactId(row, id) };
    })
    .filter(
      (entry) =>
        entry !== null &&
        (after === null || compareTextIds(entry.id, after) > 0) &&
        compareTextIds(entry.id, upper) <= 0,
    )
    .sort((left, right) => compareTextIds(left.id, right.id))
    .slice(0, limit);
}

function sourceUpper(db, tableNames, table) {
  if (!tableNames.has(table.toLowerCase())) return null;
  const rows = readTableRows(
    db,
    table,
    `SELECT CAST(source._id AS TEXT) AS "${EXACT_ID_ALIAS}", source.*
     FROM ${table} AS source
     WHERE source._id IS NOT NULL
     ORDER BY source._id DESC
     LIMIT 1`,
  );
  let maximum = null;
  for (const row of rows) {
    const id = exactRowId(row);
    if (id !== null && (maximum === null || compareTextIds(id, maximum) > 0)) {
      maximum = id;
    }
  }
  return maximum;
}

function sourceHasExactId(db, tableNames, table, id) {
  if (!tableNames.has(table.toLowerCase())) return false;
  const rows = readTableRows(
    db,
    table,
    `SELECT CAST(source._id AS TEXT) AS "${EXACT_ID_ALIAS}", source._id
     FROM ${table} AS source
     WHERE source._id = ?
     LIMIT 1`,
    [id],
  );
  return rows.some((row) => {
    const candidate = exactRowId(row);
    return candidate !== null && compareTextIds(candidate, id) === 0;
  });
}

function resolveSourceBounds(db, tableNames) {
  return {
    [KIND_CONTACT]: sourceUpper(db, tableNames, "jid"),
    [KIND_CHAT]: sourceUpper(db, tableNames, "chat"),
    [KIND_MODERN_MESSAGE]: sourceUpper(db, tableNames, "message"),
    [KIND_LEGACY_MESSAGE]: sourceUpper(db, tableNames, "messages"),
    [KIND_CALL]: sourceUpper(db, tableNames, "call_log"),
  };
}

function sourceTable(kind) {
  switch (kind) {
    case KIND_CONTACT:
      return "jid";
    case KIND_CHAT:
      return "chat";
    case KIND_MODERN_MESSAGE:
      return "message";
    case KIND_LEGACY_MESSAGE:
      return "messages";
    case KIND_CALL:
      return "call_log";
    default:
      throw new Error(`${NAME}: unsupported cursor source ${String(kind)}`);
  }
}

function assertFrozenSources(db, tableNames, upper) {
  for (const kind of POSITION_KINDS) {
    const boundary = upper[kind];
    if (
      boundary !== null &&
      !sourceHasExactId(db, tableNames, sourceTable(kind), boundary)
    ) {
      throw sourceRegression(`${kind} frozen boundary is no longer readable`);
    }
  }
}

function sourceRegression(message) {
  const error = new Error(`${NAME}: ${message}`);
  error.code = "WHATSAPP_CURSOR_SOURCE_REGRESSED";
  error.retryable = false;
  return error;
}

function pageWindow(column, { after, upper, limit }) {
  const where = [`${column} IS NOT NULL`];
  const params = [];
  if (after !== null) {
    where.push(`${column} > ?`);
    params.push(after);
  }
  where.push(`${column} <= ?`);
  params.push(upper, limit);
  return { where: where.join(" AND "), params };
}

function readSourcePage(db, kind, window) {
  const table = sourceTable(kind);
  const alias = table;
  const { where, params } = pageWindow(`${alias}._id`, window);
  const candidates = [];
  if (kind === KIND_CHAT) {
    candidates.push({
      sql: `SELECT CAST(chat._id AS TEXT) AS "${EXACT_ID_ALIAS}",
              chat.*, jid.raw_string AS chat_jid
       FROM chat AS chat
       LEFT JOIN jid ON jid._id = chat.jid_row_id
       WHERE ${where}
       ORDER BY chat._id ASC
       LIMIT ?`,
      params,
    });
  } else if (kind === KIND_MODERN_MESSAGE) {
    candidates.push({
      sql: `SELECT CAST(message._id AS TEXT) AS "${EXACT_ID_ALIAS}",
              message.*, chat_jid.raw_string AS chat_jid,
              sender_jid.raw_string AS sender_jid
       FROM message AS message
       LEFT JOIN chat ON chat._id = message.chat_row_id
       LEFT JOIN jid AS chat_jid ON chat_jid._id = chat.jid_row_id
       LEFT JOIN jid AS sender_jid
         ON sender_jid._id = message.sender_jid_row_id
       WHERE ${where}
       ORDER BY message._id ASC
       LIMIT ?`,
      params,
    });
  } else if (kind === KIND_CALL) {
    candidates.push({
      sql: `SELECT CAST(call_log._id AS TEXT) AS "${EXACT_ID_ALIAS}",
              call_log.*, jid.raw_string AS jid,
              group_jid.raw_string AS group_jid
       FROM call_log AS call_log
       LEFT JOIN jid ON jid._id = call_log.jid_row_id
       LEFT JOIN jid AS group_jid
         ON group_jid._id = call_log.group_jid_row_id
       WHERE ${where}
       ORDER BY call_log._id ASC
       LIMIT ?`,
      params,
    });
  }
  candidates.push({
    sql: `SELECT CAST(${alias}._id AS TEXT) AS "${EXACT_ID_ALIAS}", ${alias}.*
       FROM ${table} AS ${alias}
       WHERE ${where}
       ORDER BY ${alias}._id ASC
       LIMIT ?`,
    params,
  });
  const rows = selectCompatibleRows(db, table, candidates);
  return normalizedPage(rows, window);
}

function rawFromCursorRow({
  kind,
  id,
  row,
  modernIdCollision,
  fallbackCapturedAt,
}) {
  if (kind === KIND_CONTACT) {
    return {
      adapter: NAME,
      originalId: `jid-${id}`,
      capturedAt: fallbackCapturedAt,
      payload: { row, kind: "contact" },
    };
  }
  if (kind === KIND_CHAT) {
    return {
      adapter: NAME,
      originalId: `chat-${id}`,
      capturedAt: fallbackCapturedAt,
      payload: { row, kind: "chat" },
    };
  }
  if (kind === KIND_MODERN_MESSAGE || kind === KIND_LEGACY_MESSAGE) {
    const schema = kind === KIND_MODERN_MESSAGE ? "modern" : "legacy";
    return {
      adapter: NAME,
      originalId:
        schema === "legacy" && modernIdCollision
          ? `msg-legacy-${id}`
          : `msg-${id}`,
      capturedAt: parseTime(row.timestamp || row.received_timestamp),
      payload: { row, kind: "message", schema },
    };
  }
  if (kind === KIND_CALL) {
    return {
      adapter: NAME,
      originalId: `call-${id}`,
      capturedAt: parseTime(row.timestamp),
      payload: { row, kind: "call" },
    };
  }
  throw new Error(`${NAME}: unsupported cursor record kind ${String(kind)}`);
}

function resolveBridge(provider) {
  return typeof provider === "function" ? provider() : provider;
}
function tryResolveBridge(provider) {
  try {
    const bridge = resolveBridge(provider);
    return bridge && typeof bridge.invoke === "function" ? bridge : null;
  } catch {
    return null;
  }
}
function removeTempDir(tempDir) {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}
function runCleanup(cleanup) {
  try {
    if (cleanup) cleanup();
  } catch {
    // Cleanup is best-effort and must not mask the primary sync result.
  }
}
function loadModernMessageRelations(db, tableNames, messageIds) {
  const ids = [...new Set(messageIds.map(String))];
  const query = (table) => {
    if (!tableNames.has(table.toLowerCase())) return [];
    const rows = [];
    for (const chunk of chunks(ids, 400)) {
      const selected = readTableRows(
        db,
        table,
        `SELECT CAST(related.message_row_id AS TEXT)
                    AS "${RELATION_ID_ALIAS}",
                  related.*
           FROM ${table} AS related
           WHERE related.message_row_id IN (${placeholders(chunk.length)})`,
        chunk,
      );
      const wanted = new Set(chunk);
      for (const row of selected) {
        const id = relationMessageId(row);
        if (id === null || !wanted.has(id)) continue;
        const payloadRow = { ...row, message_row_id: id };
        delete payloadRow[RELATION_ID_ALIAS];
        rows.push(payloadRow);
      }
    }
    return rows;
  };
  return {
    media: indexOne(query("message_media")),
    location: indexOne(query("message_location")),
    vcards: indexMany(query("message_vcard")),
    quoted: indexOne(query("message_quoted")),
  };
}

function relationMessageId(row) {
  const value =
    row?.[RELATION_ID_ALIAS] != null
      ? row[RELATION_ID_ALIAS]
      : row?.message_row_id;
  return value == null ? null : String(value);
}

function indexOne(rows) {
  return new Map(rows.map((row) => [String(row.message_row_id), row]));
}
function indexMany(rows) {
  const indexed = new Map();
  for (const row of rows) {
    const id = String(row.message_row_id);
    const values = indexed.get(id) || [];
    values.push(row);
    indexed.set(id, values);
  }
  return indexed;
}
function attachMessageRelations(row, related, id) {
  return {
    ...row,
    _media: related.media.get(id) || null,
    _location: related.location.get(id) || null,
    _vcards: related.vcards.get(id) || [],
    _quoted: related.quoted.get(id) || null,
  };
}

function loadModernMessageIndex(db, modernUpper, legacyPage) {
  const index = { fingerprints: new Set(), ids: new Set() };
  if (modernUpper === null || legacyPage.length === 0) return index;
  const legacyIds = [...new Set(legacyPage.map(({ id }) => id))];
  const keyIds = [
    ...new Set(
      legacyPage
        .map(({ row }) => row.key_id)
        .filter(isPresent)
        .map(String),
    ),
  ];
  const candidates = [];

  for (const chunk of chunks(legacyIds, 400)) {
    const rows = readTableRows(
      db,
      "message",
      `SELECT CAST(modern._id AS TEXT) AS "${EXACT_ID_ALIAS}", modern.*
         FROM message AS modern
         WHERE modern._id <= ?
           AND modern._id IN (${placeholders(chunk.length)})`,
      [modernUpper, ...chunk],
    );
    const wanted = new Set(chunk);
    for (const row of rows) {
      const id = exactRowId(row);
      if (
        id !== null &&
        wanted.has(id) &&
        compareTextIds(id, modernUpper) <= 0
      ) {
        candidates.push(withExactId(row, id));
      }
    }
  }

  for (const chunk of chunks(keyIds, 400)) {
    const rows = readTableRows(
      db,
      "message",
      `SELECT CAST(modern._id AS TEXT) AS "${EXACT_ID_ALIAS}", modern.*
         FROM message AS modern
         WHERE modern._id <= ?
           AND modern.key_id IN (${placeholders(chunk.length)})`,
      [modernUpper, ...chunk],
    );
    const wanted = new Set(chunk);
    for (const row of rows) {
      const id = exactRowId(row);
      if (
        id !== null &&
        wanted.has(String(row.key_id)) &&
        compareTextIds(id, modernUpper) <= 0
      ) {
        candidates.push(withExactId(row, id));
      }
    }
  }

  for (const row of candidates) {
    index.ids.add(String(row._id));
    index.fingerprints.add(messageFingerprint(row));
  }
  return index;
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
function isPresent(value) {
  return value !== null && value !== undefined && value !== "";
}
function messageFingerprint(row) {
  if (isPresent(row.key_id)) return `key:${row.key_id}`;
  return [
    "row",
    row._id,
    row.timestamp || row.received_timestamp || "",
    row.from_me ?? row.key_from_me ?? "",
    row.text_data || row.data || "",
  ].join(":");
}
function legacyLocation(row) {
  return hasCoordinates(row)
    ? {
        latitude: row.latitude,
        longitude: row.longitude,
        place_name: null,
        place_address: null,
        url: null,
      }
    : null;
}
function hasCoordinates(location) {
  if (!location) return false;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}
function mediaCaption(row) {
  return row.media_caption || (row._media && row._media.media_name) || "";
}
function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    return Date.parse(v) || null;
  }
  return null;
}

module.exports = {
  WhatsAppAdapter,
  NAME,
  VERSION,
  decryptWhatsAppBackupToFile,
  inspectWhatsAppBackupFile,
  createWhatsAppBackupExtension,
};
