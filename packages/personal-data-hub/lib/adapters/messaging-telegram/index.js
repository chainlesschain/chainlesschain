/**
 * Telegram Android cache4.db adapter.
 *
 * The database is unencrypted SQLite. Collection walks users, chats, and the
 * selected message table with a frozen cyclic cursor so Registry event limits
 * can resume exactly without fixed 5k/10k truncation.
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");
const { createAccountScopeFromAccount } = require("../../account-scope");
const {
  advanceCursor,
  beginScan,
  compareTextIds,
  completeScan,
  parseCursor,
  serializeCursor,
} = require("./scan-cursor");

const NAME = "messaging-telegram";
const VERSION = "0.8.0";
const CURSOR_PAGE_SIZE = 1000;
const EXACT_ID_ALIAS = "__pdh_exact_id";
const KIND_CONTACT = "contact";
const KIND_CHAT = "chat";
const KIND_MESSAGE = "message";

function sqliteSourceError(tableName, operation, cause) {
  const error = new Error(
    `messaging-telegram: source table ${tableName} could not be ${operation}; refusing a partial import`,
  );
  error.code = "TELEGRAM_SQLITE_SOURCE_UNREADABLE";
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

function selectRows(db, sql, params = []) {
  return db.prepare(sql).all(...params);
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

function resolveSource(db, tableNames, tableCandidates, idCandidates) {
  let emptySource = null;
  let lastFailure = null;
  for (const table of tableCandidates) {
    if (!tableNames.has(table.toLowerCase())) continue;
    let compatible = false;
    let tableFailure = null;
    for (const idColumn of idCandidates) {
      try {
        const rows = db
          .prepare(
            `SELECT CAST(${idColumn} AS TEXT) AS "${EXACT_ID_ALIAS}", *
         FROM ${table}
         WHERE ${idColumn} IS NOT NULL
         ORDER BY ${idColumn} ASC
         LIMIT 1`,
          )
          .all();
        if (!Array.isArray(rows)) {
          throw new Error("SQLite query did not return a row array");
        }
        compatible = true;
        lastFailure = null;
        const source = { table, idColumn };
        if (rows.length > 0) return source;
        if (emptySource === null) emptySource = source;
        break;
      } catch (error) {
        tableFailure = error;
      }
    }
    if (!compatible && tableFailure) {
      lastFailure = { cause: tableFailure, table };
    }
  }
  if (lastFailure) {
    throw sqliteSourceError(lastFailure.table, "read", lastFailure.cause);
  }
  return emptySource;
}

function sourceUpper(db, source) {
  if (!source) return null;
  const rows = selectRows(
    db,
    `SELECT CAST(${source.idColumn} AS TEXT) AS "${EXACT_ID_ALIAS}",
            ${source.idColumn}
     FROM ${source.table}
     WHERE ${source.idColumn} IS NOT NULL
     ORDER BY ${source.idColumn} DESC
     LIMIT 1`,
  );
  return maxExactId(rows, source.idColumn);
}

function sourcePage(db, source, { after, upper, limit }) {
  if (!source || limit <= 0) return [];
  const where = [`${source.idColumn} IS NOT NULL`];
  const params = [];
  if (after !== null) {
    where.push(`${source.idColumn} > ?`);
    params.push(after);
  }
  if (upper !== null) {
    where.push(`${source.idColumn} <= ?`);
    params.push(upper);
  }
  params.push(limit);
  const rows = selectRows(
    db,
    `SELECT CAST(${source.idColumn} AS TEXT) AS "${EXACT_ID_ALIAS}", *
     FROM ${source.table}
     WHERE ${where.join(" AND ")}
     ORDER BY ${source.idColumn} ASC
     LIMIT ?`,
    params,
  );
  return rows
    .map((row) => ({ row, id: exactRowId(row, source.idColumn) }))
    .filter(
      ({ id }) =>
        id !== null &&
        (after === null || compareTextIds(id, after) > 0) &&
        (upper === null || compareTextIds(id, upper) <= 0),
    )
    .sort((left, right) => compareTextIds(left.id, right.id))
    .slice(0, limit);
}

function resolveUpper(db, sources) {
  const messageId = sourceUpper(db, sources.message);
  if (messageId !== null) {
    return {
      kind: KIND_MESSAGE,
      table: sources.message.table,
      id: messageId,
    };
  }
  const chatId = sourceUpper(db, sources.chat);
  if (chatId !== null) return { kind: KIND_CHAT, id: chatId };
  const contactId = sourceUpper(db, sources.contact);
  return contactId === null ? null : { kind: KIND_CONTACT, id: contactId };
}

function sourceRegression(message) {
  const error = new Error(`messaging-telegram: ${message}`);
  error.code = "TELEGRAM_CURSOR_SOURCE_REGRESSED";
  error.retryable = false;
  return error;
}

function withExactId(row, source, id) {
  const payloadRow = {
    ...row,
    [source.idColumn]: id,
  };
  delete payloadRow[EXACT_ID_ALIAS];
  return payloadRow;
}

class TelegramAdapter {
  constructor(opts = {}) {
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || opts.inputPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.scopeNamespace = "telegram";
    this.snapshotScopeIdentityFields = ["userId"];
    this.snapshotScopeIdentityIncludesField = false;
    this.capabilities = [
      "sync:sqlite",
      "sync:snapshot",
      "parse:telegram-messages",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
    this.dataDisclosure = {
      fields: ["telegram:users / chats / messages / dialogs"],
      sensitivity: "high",
      legalGate: true,
    };
  }

  async authenticate(ctx = {}) {
    const dbPath = (ctx && (ctx.inputPath || ctx.dbPath)) || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) {
      return {
        ok: false,
        reason: "DB_NOT_PULLED",
        message:
          "needs ctx.inputPath / opts.dbPath pointing to extracted cache4.db",
      };
    }
    return {
      ok: true,
      account: this.account ? this.account.userId : null,
      mode: "snapshot-file",
    };
  }

  async healthCheck(opts = {}) {
    const result = await this.authenticate(opts);
    return result.ok ? { ok: true, lastChecked: Date.now() } : result;
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
    const dbPath = opts.inputPath || opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Driver = this._dbDriverFactory
      ? this._dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      yield* this._syncCursor(opts, db);
    } finally {
      try {
        db.close();
      } catch {
        // Best-effort close.
      }
    }
  }

  async *_syncCursor(opts, db) {
    const tableNames = listSqliteTables(db);
    let cursor = parseCursor(opts.sinceWatermark).cursor;
    const activeMessageTable =
      cursor.upper?.kind === KIND_MESSAGE ? cursor.upper.table : null;
    const sources = {
      contact: resolveSource(db, tableNames, ["users"], ["uid", "id"]),
      chat: resolveSource(db, tableNames, ["chats"], ["uid", "id"]),
      message: resolveSource(
        db,
        tableNames,
        activeMessageTable ? [activeMessageTable] : ["messages_v2", "messages"],
        ["mid", "id"],
      ),
    };
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : Infinity;
    if (cursor.upper === null) {
      cursor = beginScan(cursor, resolveUpper(db, sources));
    }

    if (cursor.upper?.kind === KIND_MESSAGE) {
      const activeSource = sources.message;
      let currentUpper = null;
      try {
        currentUpper =
          activeSource && activeSource.table === cursor.upper.table
            ? sourceUpper(db, activeSource)
            : null;
      } catch {
        currentUpper = null;
      }
      if (
        currentUpper === null ||
        compareTextIds(currentUpper, cursor.upper.id) < 0
      ) {
        throw sourceRegression("active SQLite boundary is no longer readable");
      }
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

    if (
      cursor.upper !== null &&
      (cursor.after === null || cursor.after.kind === KIND_CONTACT)
    ) {
      let after = cursor.after?.kind === KIND_CONTACT ? cursor.after.id : null;
      const upper = cursor.upper.kind === KIND_CONTACT ? cursor.upper.id : null;
      while (cursor.upper !== null && emitted < limit) {
        const requested = pageSize(emitted);
        const page = sourcePage(db, sources.contact, {
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
            originalId: `user-${id}`,
            capturedAt: fallbackCapturedAt,
            payload: {
              row: {
                ...withExactId(row, sources.contact, id),
                uid: id,
              },
              kind: KIND_CONTACT,
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
      (cursor.after === null ||
        cursor.after.kind === KIND_CONTACT ||
        cursor.after.kind === KIND_CHAT)
    ) {
      let after = cursor.after?.kind === KIND_CHAT ? cursor.after.id : null;
      const upper = cursor.upper.kind === KIND_CHAT ? cursor.upper.id : null;
      while (cursor.upper !== null && emitted < limit) {
        const requested = pageSize(emitted);
        const page = sourcePage(db, sources.chat, {
          after,
          upper,
          limit: requested,
        });
        if (page.length === 0) break;
        for (const { row, id } of page) {
          cursor = advanceCursor(cursor, { kind: KIND_CHAT, id });
          publish();
          yield {
            adapter: NAME,
            originalId: `chat-${id}`,
            capturedAt: fallbackCapturedAt,
            payload: {
              row: {
                ...withExactId(row, sources.chat, id),
                uid: id,
              },
              kind: KIND_CHAT,
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
      let after = cursor.after?.kind === KIND_MESSAGE ? cursor.after.id : null;
      while (cursor.upper !== null && emitted < limit) {
        const requested = pageSize(emitted);
        let page;
        try {
          page = sourcePage(db, sources.message, {
            after,
            upper: cursor.upper.id,
            limit: requested,
          });
        } catch {
          throw sourceRegression("active message table is unreadable");
        }
        if (page.length === 0) break;
        for (const { row, id } of page) {
          cursor = advanceCursor(cursor, {
            kind: KIND_MESSAGE,
            table: sources.message.table,
            id,
          });
          publish();
          const payloadRow = withExactId(row, sources.message, id);
          yield {
            adapter: NAME,
            originalId: `msg-${id}`,
            capturedAt: parseTime(payloadRow.date),
            payload: { row: payloadRow, kind: KIND_MESSAGE },
          };
          emitted += 1;
          after = id;
          if (cursor.upper === null || emitted >= limit) break;
        }
        if (page.length < requested) break;
      }
    }

    if (cursor.upper !== null && emitted < limit) {
      cursor = completeScan(cursor);
    }
    publish();
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.date) || now;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: occurredAt,
      capturedBy: "sqlite",
    };

    if (kind === KIND_CONTACT) {
      return {
        events: [],
        places: [],
        items: [],
        topics: [],
        persons: [
          {
            id: `person-telegram-${row.uid}`,
            type: "person",
            subtype: "contact",
            names: [row.name, row.username].filter(
              (value) => typeof value === "string" && value.length > 0,
            ),
            identifiers: {
              telegramId: String(row.uid),
              ...(row.phone ? { phone: [String(row.phone)] } : {}),
            },
            ingestedAt: now,
            source,
            extra: { fromAdapter: NAME, telegramUid: row.uid },
          },
        ],
      };
    }
    if (kind === KIND_CHAT) {
      return {
        events: [],
        places: [],
        items: [],
        persons: [],
        topics: [
          {
            id: `topic-telegram-${row.uid}`,
            type: "topic",
            name: row.name || String(row.uid),
            ingestedAt: now,
            source,
            extra: { fromAdapter: NAME },
          },
        ],
      };
    }

    const isOutgoing = row.out === 1 || row.is_outgoing === 1;
    return {
      events: [
        {
          id: newId(),
          type: "event",
          subtype: "message",
          occurredAt,
          actor: isOutgoing
            ? "person-self"
            : row.from_id
              ? `person-telegram-${row.from_id}`
              : "person-self",
          content: {
            title: (row.message || "").slice(0, 80) || "(empty)",
            text: row.message || "",
          },
          ingestedAt: now,
          source,
          extra: {
            peer: row.uid || null,
            isOutgoing,
            mediaType: row.media_type || null,
          },
        },
      ],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

function parseTime(value) {
  if (Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === "string") {
    if (/^\d+$/u.test(value)) {
      const parsed = Number.parseInt(value, 10);
      return parsed > 1e12 ? parsed : parsed * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

module.exports = { TelegramAdapter, NAME, VERSION };
