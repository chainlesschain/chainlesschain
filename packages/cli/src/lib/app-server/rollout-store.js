import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureDir, getHomeDir } from "../paths.js";
import { withFileLock } from "../with-file-lock.js";

export const ROLLOUT_EVENT_SCHEMA = "chainlesschain.rollout-event/v1";
export const ROLLOUT_STORE_SCHEMA = "chainlesschain.rollout-store/v1";
export const ROLLOUT_STORE_VERSION = 1;
export const ROLLOUT_STORE_MIN_VERSION = 1;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

function storeError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RolloutStoreError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function identifier(value, label = "identifier") {
  const output = String(value || "").trim();
  if (!ID_PATTERN.test(output)) {
    throw storeError("CC_ROLLOUT_INVALID_ARGUMENT", `${label} is invalid`);
  }
  return output;
}

function idempotencyKey(value) {
  if (value == null) return null;
  const output = String(value).trim();
  if (!IDEMPOTENCY_PATTERN.test(output)) {
    throw storeError(
      "CC_ROLLOUT_INVALID_ARGUMENT",
      "idempotencyKey is invalid",
    );
  }
  return output;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw storeError(
        "CC_ROLLOUT_INVALID_ARGUMENT",
        "rollout values must be finite JSON",
      );
    }
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw storeError(
      "CC_ROLLOUT_INVALID_ARGUMENT",
      "rollout values must be plain JSON objects",
    );
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function recordHash(record) {
  const unsigned = { ...record };
  delete unsigned.hash;
  return digest(unsigned);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function timestamp(now) {
  return new Date(now()).toISOString();
}

function buildRecord(input, previous, now) {
  const threadId = identifier(input.threadId, "threadId");
  const record = {
    schema: ROLLOUT_EVENT_SCHEMA,
    schema_version: ROLLOUT_STORE_VERSION,
    thread_id: threadId,
    turn_id: input.turnId == null ? null : identifier(input.turnId, "turnId"),
    item_id: input.itemId == null ? null : identifier(input.itemId, "itemId"),
    event_seq: previous ? previous.event_seq + 1 : 1,
    event_type: identifier(input.eventType, "eventType"),
    tool_use_id:
      input.toolUseId == null ? null : identifier(input.toolUseId, "toolUseId"),
    approval_id:
      input.approvalId == null
        ? null
        : identifier(input.approvalId, "approvalId"),
    trace_id:
      input.traceId == null ? null : identifier(input.traceId, "traceId"),
    parent_id:
      input.parentId == null ? null : identifier(input.parentId, "parentId"),
    idempotency_key: idempotencyKey(input.idempotencyKey),
    timestamp: input.timestamp || timestamp(now),
    payload: stableValue(input.payload ?? null),
    prev_hash: previous?.hash || null,
  };
  return Object.freeze({ ...record, hash: recordHash(record) });
}

function assertExpectedHead(input, records) {
  const previous = records.at(-1) || null;
  if (
    input.expectedRevision !== undefined &&
    Number(input.expectedRevision) !== Number(previous?.event_seq || 0)
  ) {
    throw storeError(
      "CC_ROLLOUT_HEAD_CONFLICT",
      "rollout revision changed before append",
      {
        expectedRevision: Number(input.expectedRevision),
        actualRevision: Number(previous?.event_seq || 0),
      },
    );
  }
  if (
    input.expectedHeadHash !== undefined &&
    input.expectedHeadHash !== (previous?.hash || null)
  ) {
    throw storeError(
      "CC_ROLLOUT_HEAD_CONFLICT",
      "rollout event head changed before append",
      {
        expectedHeadHash: input.expectedHeadHash,
        actualHeadHash: previous?.hash || null,
      },
    );
  }
}

function verifyRecords(records, expectedThreadId = null) {
  let previous = null;
  for (const record of records) {
    if (
      !record ||
      record.schema !== ROLLOUT_EVENT_SCHEMA ||
      record.schema_version < ROLLOUT_STORE_MIN_VERSION ||
      record.schema_version > ROLLOUT_STORE_VERSION
    ) {
      throw storeError(
        "CC_ROLLOUT_CORRUPT",
        "rollout contains an unsupported event record",
      );
    }
    if (
      (expectedThreadId && record.thread_id !== expectedThreadId) ||
      record.event_seq !== (previous?.event_seq || 0) + 1 ||
      record.prev_hash !== (previous?.hash || null) ||
      record.hash !== recordHash(record)
    ) {
      throw storeError(
        "CC_ROLLOUT_CORRUPT",
        `rollout hash chain failed at event ${record.event_seq || "unknown"}`,
      );
    }
    previous = record;
  }
  return records;
}

function projectThread(records) {
  if (!records.length) return null;
  const first = records[0];
  const started = first.payload || {};
  let archived = false;
  let title = started.title ?? null;
  let status = "idle";
  for (const event of records) {
    if (event.event_type === "thread.archived") archived = true;
    if (event.event_type === "thread.title_updated") {
      title = event.payload?.title ?? title;
    }
    if (event.event_type === "turn.started") status = "active";
    if (
      event.event_type === "turn.completed" ||
      event.event_type === "turn.failed" ||
      event.event_type === "turn.interrupted"
    ) {
      status = "idle";
    }
  }
  return Object.freeze({
    id: first.thread_id,
    status: archived ? "archived" : status,
    title,
    parentThreadId: started.parentThreadId ?? null,
    createdAt: first.timestamp,
    updatedAt: records.at(-1).timestamp,
    revision: records.at(-1).event_seq,
    headHash: records.at(-1).hash,
    metadata: clone(started.metadata || {}),
  });
}

export function defaultRolloutStoreDirectory() {
  return path.join(getHomeDir(), "app-server", "rollouts");
}

export class JsonlRolloutStore {
  constructor({
    directory = defaultRolloutStoreDirectory(),
    now = Date.now,
  } = {}) {
    this.directory = path.resolve(directory);
    this.now = now;
  }

  _file(threadId) {
    const safeId = identifier(threadId, "threadId");
    const name = createHash("sha256").update(safeId).digest("hex");
    return path.join(this.directory, `${name}.jsonl`);
  }

  _ensureDirectory() {
    ensureDir(this.directory);
  }

  _readUnsafe(threadId, { allowMissing = false } = {}) {
    const file = this._file(threadId);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return [];
      if (error?.code === "ENOENT") {
        throw storeError(
          "CC_ROLLOUT_THREAD_NOT_FOUND",
          `thread does not exist: ${threadId}`,
        );
      }
      throw storeError(
        "CC_ROLLOUT_UNAVAILABLE",
        `could not read rollout for ${threadId}`,
        { cause: error },
      );
    }
    const records = text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (cause) {
          throw storeError(
            "CC_ROLLOUT_CORRUPT",
            `invalid rollout JSON at line ${index + 1}`,
            { cause },
          );
        }
      });
    return verifyRecords(records, identifier(threadId, "threadId"));
  }

  start({
    threadId = randomUUID(),
    title = null,
    parentThreadId = null,
    metadata = {},
  } = {}) {
    const safeThreadId = identifier(threadId, "threadId");
    this._ensureDirectory();
    const file = this._file(safeThreadId);
    return withFileLock(
      file,
      () => {
        const existing = this._readUnsafe(safeThreadId, { allowMissing: true });
        if (existing.length) return projectThread(existing);
        const record = buildRecord(
          {
            threadId: safeThreadId,
            eventType: "thread.started",
            idempotencyKey: `thread:${safeThreadId}`,
            payload: {
              title: title == null ? null : String(title).slice(0, 512),
              parentThreadId:
                parentThreadId == null
                  ? null
                  : identifier(parentThreadId, "parentThreadId"),
              metadata: stableValue(metadata),
            },
          },
          null,
          this.now,
        );
        fs.writeFileSync(file, `${JSON.stringify(record)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        return projectThread([record]);
      },
      { failIfUnavailable: true, timeoutMs: 10_000 },
    );
  }

  append(input) {
    const safeThreadId = identifier(input?.threadId, "threadId");
    this._ensureDirectory();
    const file = this._file(safeThreadId);
    return withFileLock(
      file,
      () => {
        const records = this._readUnsafe(safeThreadId);
        const key = idempotencyKey(input.idempotencyKey);
        if (key) {
          const duplicate = records.find(
            (record) => record.idempotency_key === key,
          );
          if (duplicate) {
            const candidatePayload = stableValue(input.payload ?? null);
            if (
              duplicate.event_type !== input.eventType ||
              canonicalJson(duplicate.payload) !==
                canonicalJson(candidatePayload)
            ) {
              throw storeError(
                "CC_ROLLOUT_IDEMPOTENCY_CONFLICT",
                `idempotency key was reused with different content: ${key}`,
              );
            }
            return clone(duplicate);
          }
        }
        assertExpectedHead(input, records);
        const record = buildRecord(input, records.at(-1), this.now);
        fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
        return clone(record);
      },
      { failIfUnavailable: true, timeoutMs: 10_000 },
    );
  }

  read(threadId, { afterSeq = 0, limit = 10_000 } = {}) {
    const safeLimit = Math.max(1, Math.min(100_000, Number(limit) || 10_000));
    return clone(
      this._readUnsafe(threadId)
        .filter((record) => record.event_seq > Number(afterSeq || 0))
        .slice(0, safeLimit),
    );
  }

  resume(threadId) {
    return projectThread(this._readUnsafe(threadId));
  }

  list({ includeArchived = false, limit = 100 } = {}) {
    this._ensureDirectory();
    const output = [];
    for (const entry of fs.readdirSync(this.directory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(this.directory, entry.name);
      let first;
      try {
        first = JSON.parse(
          fs.readFileSync(file, "utf8").split(/\r?\n/u).find(Boolean),
        );
      } catch (cause) {
        throw storeError(
          "CC_ROLLOUT_CORRUPT",
          `could not inspect rollout ${entry.name}`,
          { cause },
        );
      }
      const projection = this.resume(first.thread_id);
      if (includeArchived || projection.status !== "archived")
        output.push(projection);
    }
    return output
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Math.min(10_000, Number(limit) || 100)));
  }

  forkThread(sourceThreadId, { threadId = randomUUID(), title = null } = {}) {
    const sourceRecords = this._readUnsafe(sourceThreadId);
    const source = projectThread(sourceRecords);
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

  compact(
    threadId,
    { summary, retainedState, idempotencyKey: key = null } = {},
  ) {
    if (typeof summary !== "string" || !summary.trim()) {
      throw storeError(
        "CC_ROLLOUT_INVALID_ARGUMENT",
        "compaction summary is required",
      );
    }
    return this.append({
      threadId,
      eventType: "rollout.compacted",
      idempotencyKey: key,
      payload: { summary, retainedState: stableValue(retainedState ?? {}) },
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

  migrate({
    fromVersion,
    toVersion = ROLLOUT_STORE_VERSION,
    dryRun = true,
  } = {}) {
    if (
      Number(fromVersion) < ROLLOUT_STORE_MIN_VERSION ||
      Number(fromVersion) > ROLLOUT_STORE_VERSION ||
      Number(toVersion) !== ROLLOUT_STORE_VERSION
    ) {
      throw storeError(
        "CC_ROLLOUT_MIGRATION_UNSUPPORTED",
        `rollout migration ${fromVersion} -> ${toVersion} is unsupported`,
      );
    }
    return Object.freeze({
      schema: ROLLOUT_STORE_SCHEMA,
      fromVersion: Number(fromVersion),
      toVersion: Number(toVersion),
      dryRun: dryRun !== false,
      changes: 0,
      backupRequired: false,
    });
  }
}

export class MemoryRolloutStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.records = new Map();
  }

  start({
    threadId = randomUUID(),
    title = null,
    parentThreadId = null,
    metadata = {},
  } = {}) {
    const safeThreadId = identifier(threadId, "threadId");
    if (this.records.has(safeThreadId)) return this.resume(safeThreadId);
    const first = buildRecord(
      {
        threadId: safeThreadId,
        eventType: "thread.started",
        idempotencyKey: `thread:${safeThreadId}`,
        payload: { title, parentThreadId, metadata },
      },
      null,
      this.now,
    );
    this.records.set(safeThreadId, [first]);
    return projectThread([first]);
  }

  append(input) {
    const threadId = identifier(input?.threadId, "threadId");
    const records = this.records.get(threadId);
    if (!records) {
      throw storeError(
        "CC_ROLLOUT_THREAD_NOT_FOUND",
        `thread does not exist: ${threadId}`,
      );
    }
    const key = idempotencyKey(input.idempotencyKey);
    const duplicate = key
      ? records.find((record) => record.idempotency_key === key)
      : null;
    if (duplicate) {
      if (
        duplicate.event_type !== input.eventType ||
        canonicalJson(duplicate.payload) !==
          canonicalJson(input.payload ?? null)
      ) {
        throw storeError(
          "CC_ROLLOUT_IDEMPOTENCY_CONFLICT",
          `idempotency key was reused with different content: ${key}`,
        );
      }
      return clone(duplicate);
    }
    assertExpectedHead(input, records);
    const record = buildRecord(input, records.at(-1), this.now);
    records.push(record);
    return clone(record);
  }

  read(threadId, { afterSeq = 0, limit = 10_000 } = {}) {
    const records = this.records.get(identifier(threadId, "threadId"));
    if (!records) {
      throw storeError(
        "CC_ROLLOUT_THREAD_NOT_FOUND",
        `thread does not exist: ${threadId}`,
      );
    }
    return clone(
      records
        .filter((record) => record.event_seq > Number(afterSeq || 0))
        .slice(0, limit),
    );
  }

  resume(threadId) {
    return projectThread(this.read(threadId));
  }

  list({ includeArchived = false, limit = 100 } = {}) {
    return [...this.records.keys()]
      .map((threadId) => this.resume(threadId))
      .filter((thread) => includeArchived || thread.status !== "archived")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
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

  migrate(options = {}) {
    return Object.freeze({
      schema: ROLLOUT_STORE_SCHEMA,
      fromVersion: Number(options.fromVersion || 1),
      toVersion: Number(options.toVersion || 1),
      dryRun: options.dryRun !== false,
      changes: 0,
      backupRequired: false,
    });
  }
}

export const _rolloutStoreInternals = Object.freeze({
  buildRecord,
  canonicalJson,
  digest,
  projectThread,
  verifyRecords,
});
