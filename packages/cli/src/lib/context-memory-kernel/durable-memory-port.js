import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonicalDigest,
  cloneCanonical,
  normalizeMemoryRecord,
} from "@chainlesschain/context-memory-kernel";
import { withFileLock } from "../with-file-lock.js";
import { getHomeDir } from "../paths.js";

const STORE_SCHEMA = "chainlesschain.cli-context-memory-store/v1";
const DEFAULT_MAX_STORE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_EVENTS = 100_000;

function emptyState() {
  return {
    schema: STORE_SCHEMA,
    schemaVersion: 1,
    storeRevision: 0,
    records: {},
    events: [],
    reconciliations: {},
  };
}

function stateDigest(state) {
  const copy = { ...state };
  delete copy.digest;
  return canonicalDigest(copy, "chainlesschain.cli-context-memory-store/v1");
}

function corruptStore(filePath, reason, cause) {
  const error = new Error(`Context/Memory store is invalid: ${reason}`, {
    ...(cause ? { cause } : {}),
  });
  error.code = "CONTEXT_MEMORY_STORE_CORRUPT";
  error.filePath = filePath;
  return error;
}

function assertRegularFile(filePath) {
  if (!existsSync(filePath)) return;
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw corruptStore(filePath, "authority path is not a regular file");
  }
}

function normalizeState(input, filePath) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw corruptStore(filePath, "root must be an object");
  }
  const keys = Object.keys(input);
  const expected = new Set([
    "schema",
    "schemaVersion",
    "storeRevision",
    "records",
    "events",
    "reconciliations",
    "digest",
  ]);
  if (keys.some((key) => !expected.has(key))) {
    throw corruptStore(filePath, "root contains unknown fields");
  }
  if (input.schema !== STORE_SCHEMA || input.schemaVersion !== 1) {
    throw corruptStore(filePath, "schema version is unsupported");
  }
  if (!Number.isSafeInteger(input.storeRevision) || input.storeRevision < 0) {
    throw corruptStore(filePath, "storeRevision is invalid");
  }
  if (
    !input.records ||
    typeof input.records !== "object" ||
    Array.isArray(input.records) ||
    !Array.isArray(input.events) ||
    !input.reconciliations ||
    typeof input.reconciliations !== "object" ||
    Array.isArray(input.reconciliations)
  ) {
    throw corruptStore(filePath, "records/events/reconciliations are invalid");
  }
  const records = {};
  try {
    for (const [memoryId, record] of Object.entries(input.records)) {
      const normalized = normalizeMemoryRecord(record);
      if (normalized.memoryId !== memoryId) {
        throw new Error(`record key does not match ${memoryId}`);
      }
      records[memoryId] = normalized;
    }
  } catch (cause) {
    throw corruptStore(filePath, "a memory record failed validation", cause);
  }
  if (typeof input.digest !== "string" || stateDigest(input) !== input.digest) {
    throw corruptStore(filePath, "state digest does not match");
  }
  return {
    schema: STORE_SCHEMA,
    schemaVersion: 1,
    storeRevision: input.storeRevision,
    records,
    events: cloneCanonical(input.events),
    reconciliations: cloneCanonical(input.reconciliations),
    digest: input.digest,
  };
}

function initializeState() {
  const state = emptyState();
  state.digest = stateDigest(state);
  return state;
}

function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeState(filePath, state) {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const output = cloneCanonical(state);
  delete output.digest;
  output.digest = stateDigest(output);
  const bytes = `${JSON.stringify(output)}\n`;
  const temporary = join(
    directory,
    `.${filePath.split(/[\\/]/u).at(-1)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor = null;
  let renamed = false;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, bytes, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    assertRegularFile(filePath);
    renameSync(temporary, filePath);
    renamed = true;
    syncDirectory(directory);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (!renamed) rmSync(temporary, { force: true });
  }
  return output;
}

/** Durable CAS MemoryPort used by CLI commands and the App Server. */
export class DurableJsonMemoryPort {
  constructor({
    filePath = join(getHomeDir(), "context-memory", "kernel-v1.json"),
    maxStoreBytes = DEFAULT_MAX_STORE_BYTES,
    maxEvents = DEFAULT_MAX_EVENTS,
  } = {}) {
    this.name = "cli-context-memory-authority";
    this.filePath = filePath;
    this.maxStoreBytes = maxStoreBytes;
    this.maxEvents = maxEvents;
  }

  _readUnlocked() {
    assertRegularFile(this.filePath);
    if (!existsSync(this.filePath)) return initializeState();
    const bytes = readFileSync(this.filePath);
    if (bytes.length > this.maxStoreBytes) {
      throw corruptStore(this.filePath, "store exceeds its configured byte limit");
    }
    try {
      return normalizeState(JSON.parse(bytes.toString("utf8")), this.filePath);
    } catch (error) {
      if (error?.code === "CONTEXT_MEMORY_STORE_CORRUPT") throw error;
      throw corruptStore(this.filePath, "JSON cannot be parsed", error);
    }
  }

  _locked(operation) {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    return withFileLock(this.filePath, operation, {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 2,
      maxRetryMs: 32,
      retryJitterMs: 8,
    });
  }

  async read(memoryId) {
    return this._locked(() => {
      const record = this._readUnlocked().records[memoryId];
      return cloneCanonical(record || null);
    });
  }

  async query() {
    return this._locked(() =>
      Object.values(this._readUnlocked().records).map(cloneCanonical),
    );
  }

  async listRecords({ includeTombstones = false } = {}) {
    const records = await this.query();
    return records
      .filter(
        (record) =>
          includeTombstones || !["deleted", "purged"].includes(record.state),
      )
      .sort(
        (left, right) =>
          right.importance - left.importance ||
          right.updatedAt.localeCompare(left.updatedAt, "en") ||
          left.memoryId.localeCompare(right.memoryId, "en"),
      );
  }

  async commit({ record, event, reconciliation }, expectedRevision = 0) {
    const normalized = normalizeMemoryRecord(record);
    return this._locked(() => {
      const state = this._readUnlocked();
      const current = state.records[normalized.memoryId];
      const actualRevision = current?.revision || 0;
      if (actualRevision !== expectedRevision) {
        return {
          ok: false,
          currentRevision: actualRevision,
          storeRevision: state.storeRevision,
        };
      }
      if (state.events.length >= this.maxEvents) {
        const error = new Error("Context/Memory audit event limit reached");
        error.code = "CONTEXT_MEMORY_STORE_LIMIT";
        throw error;
      }
      state.records[normalized.memoryId] = normalized;
      state.events.push(cloneCanonical(event));
      if (reconciliation) {
        state.reconciliations[reconciliation.requestId] =
          cloneCanonical(reconciliation);
      }
      state.storeRevision += 1;
      writeState(this.filePath, state);
      return {
        ok: true,
        revision: normalized.revision,
        storeRevision: state.storeRevision,
        reconciliationStored: Boolean(reconciliation),
      };
    });
  }

  async getRevision() {
    return this._locked(() => this._readUnlocked().storeRevision);
  }

  async getReconciliation(requestId) {
    return this._locked(() =>
      cloneCanonical(this._readUnlocked().reconciliations[requestId] || null),
    );
  }

  async putReconciliation(operation) {
    return this._locked(() => {
      const state = this._readUnlocked();
      state.reconciliations[operation.requestId] = cloneCanonical(operation);
      state.storeRevision += 1;
      writeState(this.filePath, state);
      return { ok: true, storeRevision: state.storeRevision };
    });
  }
}

export {
  DEFAULT_MAX_EVENTS,
  DEFAULT_MAX_STORE_BYTES,
  STORE_SCHEMA,
  normalizeState,
  stateDigest,
};
