import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import {
  ROLLOUT_STORE_SCHEMA,
  ROLLOUT_STORE_VERSION,
  _rolloutStoreInternals,
} from "./rollout-store.js";

const { buildRecord, canonicalJson, projectThread, verifyRecords } =
  _rolloutStoreInternals;

let DatabaseSync = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
} catch {
  // node:sqlite is optional on the minimum supported Node 22.12 runtime.
}

function sqliteError(code, message, cause = null) {
  const error = new Error(message);
  error.name = "SqliteRolloutStoreError";
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function recordThreadId(input) {
  return buildRecord(
    { threadId: input, eventType: "validation", payload: null },
    null,
    Date.now,
  ).thread_id;
}

export function sqliteRolloutStoreAvailable() {
  return typeof DatabaseSync === "function";
}

export class SqliteRolloutStore {
  constructor({ filename = ":memory:", now = Date.now, database = null } = {}) {
    this.filename = filename === ":memory:" ? filename : path.resolve(filename);
    this.now = now;
    if (this.filename !== ":memory:") {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    }
    if (!database && !sqliteRolloutStoreAvailable()) {
      throw sqliteError(
        "CC_ROLLOUT_SQLITE_UNAVAILABLE",
        "SQLite rollout storage requires a Node runtime with node:sqlite",
      );
    }
    this.db = database || new DatabaseSync(this.filename);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cc_rollout_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cc_rollout_events (
        thread_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL,
        idempotency_key TEXT,
        event_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, event_seq),
        UNIQUE (thread_id, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS cc_rollout_events_thread
        ON cc_rollout_events(thread_id, event_seq);
    `);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO cc_rollout_meta(key, value) VALUES ('schema_version', ?)",
      )
      .run(String(ROLLOUT_STORE_VERSION));
    const version = Number(
      this.db
        .prepare(
          "SELECT value FROM cc_rollout_meta WHERE key = 'schema_version'",
        )
        .get()?.value,
    );
    if (version !== ROLLOUT_STORE_VERSION) {
      throw sqliteError(
        "CC_ROLLOUT_VERSION_UNSUPPORTED",
        `SQLite rollout schema version ${version} is unsupported`,
      );
    }
  }

  _read(threadId, { allowMissing = false } = {}) {
    const id = recordThreadId(threadId);
    const rows = this.db
      .prepare(
        "SELECT event_json FROM cc_rollout_events WHERE thread_id = ? ORDER BY event_seq",
      )
      .all(id);
    if (!rows.length && !allowMissing) {
      throw sqliteError(
        "CC_ROLLOUT_THREAD_NOT_FOUND",
        `thread does not exist: ${id}`,
      );
    }
    const records = rows.map((row) => {
      try {
        return JSON.parse(row.event_json);
      } catch (cause) {
        throw sqliteError(
          "CC_ROLLOUT_CORRUPT",
          `rollout contains invalid JSON: ${id}`,
          cause,
        );
      }
    });
    try {
      return verifyRecords(records, id);
    } catch (cause) {
      throw sqliteError("CC_ROLLOUT_CORRUPT", cause.message, cause);
    }
  }

  _transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the operation error; rollback failure is secondary.
      }
      throw error;
    }
  }

  start({
    threadId = randomUUID(),
    title = null,
    parentThreadId = null,
    metadata = {},
  } = {}) {
    const id = recordThreadId(threadId);
    return this._transaction(() => {
      const existing = this._read(id, { allowMissing: true });
      if (existing.length) return projectThread(existing);
      const record = buildRecord(
        {
          threadId: id,
          eventType: "thread.started",
          idempotencyKey: `thread:${id}`,
          payload: { title, parentThreadId, metadata },
        },
        null,
        this.now,
      );
      this.db
        .prepare(
          "INSERT INTO cc_rollout_events(thread_id, event_seq, idempotency_key, event_json) VALUES (?, ?, ?, ?)",
        )
        .run(
          id,
          record.event_seq,
          record.idempotency_key,
          JSON.stringify(record),
        );
      return projectThread([record]);
    });
  }

  append(input) {
    const id = recordThreadId(input?.threadId);
    return this._transaction(() => {
      const records = this._read(id);
      const duplicate = input.idempotencyKey
        ? records.find(
            (record) => record.idempotency_key === input.idempotencyKey,
          )
        : null;
      if (duplicate) {
        if (
          duplicate.event_type !== input.eventType ||
          canonicalJson(duplicate.payload) !==
            canonicalJson(input.payload ?? null)
        ) {
          throw sqliteError(
            "CC_ROLLOUT_IDEMPOTENCY_CONFLICT",
            `idempotency key was reused with different content: ${input.idempotencyKey}`,
          );
        }
        return clone(duplicate);
      }
      const record = buildRecord(input, records.at(-1), this.now);
      this.db
        .prepare(
          "INSERT INTO cc_rollout_events(thread_id, event_seq, idempotency_key, event_json) VALUES (?, ?, ?, ?)",
        )
        .run(
          id,
          record.event_seq,
          record.idempotency_key,
          JSON.stringify(record),
        );
      return clone(record);
    });
  }

  read(threadId, { afterSeq = 0, limit = 10_000 } = {}) {
    return clone(
      this._read(threadId)
        .filter((record) => record.event_seq > Number(afterSeq || 0))
        .slice(0, Math.max(1, Math.min(100_000, Number(limit) || 10_000))),
    );
  }

  resume(threadId) {
    return projectThread(this._read(threadId));
  }

  list({ includeArchived = false, limit = 100 } = {}) {
    const ids = this.db
      .prepare(
        "SELECT DISTINCT thread_id FROM cc_rollout_events ORDER BY thread_id",
      )
      .all()
      .map((row) => row.thread_id);
    return ids
      .map((threadId) => this.resume(threadId))
      .filter((thread) => includeArchived || thread.status !== "archived")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Number(limit) || 100));
  }

  forkThread(sourceThreadId, { threadId = randomUUID(), title = null } = {}) {
    const source = this.resume(sourceThreadId);
    const target = this.start({
      threadId,
      title: title ?? source.title,
      parentThreadId: source.id,
      metadata: source.metadata,
    });
    this.append({
      threadId: target.id,
      eventType: "thread.forked",
      idempotencyKey: `fork:${source.id}:${source.headHash}`,
      payload: {
        sourceThreadId: source.id,
        sourceEventSeq: source.revision,
        sourceHeadHash: source.headHash,
      },
    });
    return this.resume(target.id);
  }

  checkpoint(threadId, payload = {}) {
    return this.append({
      threadId,
      eventType: "rollout.checkpoint",
      idempotencyKey: payload.idempotencyKey || null,
      payload: { ...payload, idempotencyKey: undefined },
    });
  }

  compact(threadId, options = {}) {
    return this.append({
      threadId,
      eventType: "rollout.compacted",
      idempotencyKey: options.idempotencyKey || null,
      payload: {
        summary: String(options.summary || ""),
        retainedState: options.retainedState || {},
      },
    });
  }

  archive(threadId) {
    this.append({
      threadId,
      eventType: "thread.archived",
      idempotencyKey: `archive:${threadId}`,
      payload: {},
    });
    return this.resume(threadId);
  }

  migrate({ fromVersion = 1, toVersion = 1, dryRun = true } = {}) {
    if (Number(fromVersion) !== 1 || Number(toVersion) !== 1) {
      throw sqliteError(
        "CC_ROLLOUT_VERSION_UNSUPPORTED",
        "SQLite rollout adapter currently supports schema v1 only",
      );
    }
    return Object.freeze({
      schema: ROLLOUT_STORE_SCHEMA,
      fromVersion: 1,
      toVersion: 1,
      dryRun: dryRun !== false,
      changes: 0,
      backupRequired: false,
    });
  }

  close() {
    this.db.close();
  }
}
