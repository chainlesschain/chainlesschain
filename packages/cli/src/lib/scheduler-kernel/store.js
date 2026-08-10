import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import {
  OCCURRENCE_STATUS,
  SCHEDULER_SCHEMA_VERSION,
  SchedulerKernelError,
  canonicalJson,
  deriveOccurrenceIdentity,
  invalidArgument,
  normalizeAuthorityEnvelope,
  normalizeEpochMs,
  normalizeHistoryLimit,
  normalizeIdentifier,
  normalizeJson,
  normalizeMaxAttempts,
} from "./contract.js";

const requireCjs = createRequire(import.meta.url);

export const SCHEDULER_APPLICATION_ID = 0x4343534b; // "CCSK"
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
export const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;

const MIGRATION_NAME = "scheduler-kernel-v1";
const USER_TABLES = Object.freeze([
  "events",
  "jobs",
  "migrations",
  "occurrences",
]);

const MIGRATION_V1_SQL = `
CREATE TABLE migrations (
  version     INTEGER PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL UNIQUE,
  checksum    TEXT NOT NULL,
  applied_at  INTEGER NOT NULL CHECK (applied_at >= 0)
);

CREATE TABLE jobs (
  job_id          TEXT PRIMARY KEY NOT NULL,
  kind            TEXT NOT NULL,
  trigger_json    TEXT NOT NULL CHECK (json_valid(trigger_json)),
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  authority_json  TEXT NOT NULL CHECK (json_valid(authority_json)),
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  revision        INTEGER NOT NULL CHECK (revision >= 1),
  max_attempts    INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 32),
  created_at      INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at      INTEGER NOT NULL CHECK (updated_at >= 0)
);

CREATE TABLE occurrences (
  occurrence_id    TEXT PRIMARY KEY NOT NULL,
  job_id           TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE RESTRICT,
  job_revision     INTEGER NOT NULL CHECK (job_revision >= 1),
  idempotency_key  TEXT NOT NULL,
  trigger_key      TEXT NOT NULL,
  scheduled_for    INTEGER NOT NULL CHECK (scheduled_for >= 0),
  available_at     INTEGER NOT NULL CHECK (available_at >= 0),
  status           TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'retry_wait', 'succeeded', 'dead_letter')
  ),
  attempt           INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts      INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 32),
  fence             INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_owner       TEXT,
  lease_expires_at  INTEGER,
  authority_json    TEXT NOT NULL CHECK (json_valid(authority_json)),
  payload_json      TEXT NOT NULL CHECK (json_valid(payload_json)),
  last_error_json   TEXT CHECK (
    last_error_json IS NULL OR json_valid(last_error_json)
  ),
  result_json       TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at        INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at        INTEGER NOT NULL CHECK (updated_at >= 0),
  settled_at        INTEGER,
  CHECK (attempt <= max_attempts),
  CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status IN ('succeeded', 'dead_letter') AND settled_at IS NOT NULL)
    OR
    (status NOT IN ('succeeded', 'dead_letter') AND settled_at IS NULL)
  )
);

CREATE UNIQUE INDEX scheduler_occurrences_idempotency
  ON occurrences(idempotency_key);
CREATE INDEX scheduler_occurrences_claim
  ON occurrences(status, available_at, lease_expires_at, scheduled_for, occurrence_id);
CREATE INDEX scheduler_occurrences_job
  ON occurrences(job_id, created_at, occurrence_id);

CREATE TABLE events (
  event_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE RESTRICT,
  occurrence_id  TEXT REFERENCES occurrences(occurrence_id) ON DELETE RESTRICT,
  event_type     TEXT NOT NULL,
  occurred_at    INTEGER NOT NULL CHECK (occurred_at >= 0),
  owner_id       TEXT,
  fence          INTEGER,
  data_json      TEXT NOT NULL CHECK (json_valid(data_json))
);

CREATE INDEX scheduler_events_occurrence
  ON events(occurrence_id, event_id DESC);
CREATE INDEX scheduler_events_job
  ON events(job_id, event_id DESC);
`;

export const MIGRATION_V1_CHECKSUM = createHash("sha256")
  .update(MIGRATION_V1_SQL.trim().replace(/\r\n/g, "\n"), "utf8")
  .digest("hex");

// Fingerprint of the normalized sqlite_master catalog produced by the v1 DDL.
// Unlike the migration-source checksum, this also detects added triggers/views
// and constraint/foreign-key changes that preserve the visible column list.
export const SCHEMA_V1_FINGERPRINT =
  "cf244f675ac7430683f67046b57524eb6c14baa45d6463ed3f704be898fec887";

const EXPECTED_COLUMNS = Object.freeze({
  migrations: [
    ["version", "INTEGER", 1, 1],
    ["name", "TEXT", 1, 0],
    ["checksum", "TEXT", 1, 0],
    ["applied_at", "INTEGER", 1, 0],
  ],
  jobs: [
    ["job_id", "TEXT", 1, 1],
    ["kind", "TEXT", 1, 0],
    ["trigger_json", "TEXT", 1, 0],
    ["payload_json", "TEXT", 1, 0],
    ["authority_json", "TEXT", 1, 0],
    ["enabled", "INTEGER", 1, 0],
    ["revision", "INTEGER", 1, 0],
    ["max_attempts", "INTEGER", 1, 0],
    ["created_at", "INTEGER", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
  ],
  occurrences: [
    ["occurrence_id", "TEXT", 1, 1],
    ["job_id", "TEXT", 1, 0],
    ["job_revision", "INTEGER", 1, 0],
    ["idempotency_key", "TEXT", 1, 0],
    ["trigger_key", "TEXT", 1, 0],
    ["scheduled_for", "INTEGER", 1, 0],
    ["available_at", "INTEGER", 1, 0],
    ["status", "TEXT", 1, 0],
    ["attempt", "INTEGER", 1, 0],
    ["max_attempts", "INTEGER", 1, 0],
    ["fence", "INTEGER", 1, 0],
    ["lease_owner", "TEXT", 0, 0],
    ["lease_expires_at", "INTEGER", 0, 0],
    ["authority_json", "TEXT", 1, 0],
    ["payload_json", "TEXT", 1, 0],
    ["last_error_json", "TEXT", 0, 0],
    ["result_json", "TEXT", 0, 0],
    ["created_at", "INTEGER", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
    ["settled_at", "INTEGER", 0, 0],
  ],
  events: [
    ["event_id", "INTEGER", 0, 1],
    ["job_id", "TEXT", 1, 0],
    ["occurrence_id", "TEXT", 0, 0],
    ["event_type", "TEXT", 1, 0],
    ["occurred_at", "INTEGER", 1, 0],
    ["owner_id", "TEXT", 0, 0],
    ["fence", "INTEGER", 0, 0],
    ["data_json", "TEXT", 1, 0],
  ],
});

const EXPECTED_INDEXES = Object.freeze([
  "scheduler_events_job",
  "scheduler_events_occurrence",
  "scheduler_occurrences_claim",
  "scheduler_occurrences_idempotency",
  "scheduler_occurrences_job",
]);

function schemaError(code, message, cause = undefined, details = undefined) {
  return new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
}

function assertPositiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidArgument(`${field} must be a positive integer`);
  }
  return value;
}

function normalizeLeaseMs(value) {
  const leaseMs = assertPositiveSafeInteger(value, "leaseMs");
  if (leaseMs > MAX_LEASE_MS) {
    throw invalidArgument(`leaseMs must not exceed ${MAX_LEASE_MS}`);
  }
  return leaseMs;
}

function normalizeBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw invalidArgument(`${field} must be a boolean`);
  }
  return value;
}

function normalizeJobInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidArgument("job must be an object");
  }
  const allowed = new Set([
    "id",
    "kind",
    "trigger",
    "payload",
    "authority",
    "enabled",
    "maxAttempts",
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalidArgument("job contains unknown fields", {
      fields: unknown.sort(),
    });
  }
  return {
    id: normalizeIdentifier(input.id, "job.id"),
    kind: normalizeIdentifier(input.kind, "job.kind", { maxLength: 128 }),
    trigger: normalizeJson(input.trigger ?? {}, "job.trigger"),
    payload: normalizeJson(input.payload ?? null, "job.payload"),
    authority: normalizeAuthorityEnvelope(input.authority),
    enabled:
      input.enabled === undefined
        ? true
        : normalizeBoolean(input.enabled, "job.enabled"),
    maxAttempts: normalizeMaxAttempts(input.maxAttempts),
  };
}

function normalizeJobPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw invalidArgument("job patch must be an object");
  }
  const allowed = new Set([
    "kind",
    "trigger",
    "payload",
    "authority",
    "enabled",
    "maxAttempts",
  ]);
  const keys = Object.keys(patch);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalidArgument("job patch contains unknown fields", {
      fields: unknown.sort(),
    });
  }
  if (keys.length === 0) throw invalidArgument("job patch must not be empty");
  const normalized = {};
  if (Object.hasOwn(patch, "kind")) {
    normalized.kind = normalizeIdentifier(patch.kind, "job.kind", {
      maxLength: 128,
    });
  }
  if (Object.hasOwn(patch, "trigger")) {
    normalized.trigger = normalizeJson(patch.trigger, "job.trigger");
  }
  if (Object.hasOwn(patch, "payload")) {
    normalized.payload = normalizeJson(patch.payload, "job.payload");
  }
  if (Object.hasOwn(patch, "authority")) {
    normalized.authority = normalizeAuthorityEnvelope(patch.authority);
  }
  if (Object.hasOwn(patch, "enabled")) {
    normalized.enabled = normalizeBoolean(patch.enabled, "job.enabled");
  }
  if (Object.hasOwn(patch, "maxAttempts")) {
    normalized.maxAttempts = normalizeMaxAttempts(patch.maxAttempts);
  }
  return { normalized, changedFields: keys.sort() };
}

function readStoredJson(encoded, field) {
  try {
    return JSON.parse(encoded);
  } catch (cause) {
    throw schemaError(
      "SCHEDULER_DATA_CORRUPT",
      `Stored ${field} is not valid JSON`,
      cause,
    );
  }
}

function readStoredAuthority(encoded, field) {
  try {
    return normalizeAuthorityEnvelope(readStoredJson(encoded, field));
  } catch (cause) {
    if (cause?.code === "SCHEDULER_DATA_CORRUPT") throw cause;
    throw schemaError(
      "SCHEDULER_DATA_CORRUPT",
      `Stored ${field} does not match authority envelope v1`,
      cause,
    );
  }
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.job_id,
    kind: row.kind,
    trigger: readStoredJson(row.trigger_json, "job trigger"),
    payload: readStoredJson(row.payload_json, "job payload"),
    authority: readStoredAuthority(row.authority_json, "job authority"),
    enabled: row.enabled === 1,
    revision: row.revision,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOccurrence(row) {
  if (!row) return null;
  return {
    id: row.occurrence_id,
    jobId: row.job_id,
    jobRevision: row.job_revision,
    idempotencyKey: row.idempotency_key,
    triggerKey: row.trigger_key,
    scheduledFor: row.scheduled_for,
    availableAt: row.available_at,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    fence: row.fence,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    authority: readStoredAuthority(row.authority_json, "occurrence authority"),
    payload: readStoredJson(row.payload_json, "occurrence payload"),
    lastError:
      row.last_error_json === null
        ? null
        : readStoredJson(row.last_error_json, "occurrence error"),
    result:
      row.result_json === null
        ? null
        : readStoredJson(row.result_json, "occurrence result"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at,
  };
}

function mapEvent(row) {
  return {
    eventId: row.event_id,
    jobId: row.job_id,
    occurrenceId: row.occurrence_id,
    type: row.event_type,
    occurredAt: row.occurred_at,
    ownerId: row.owner_id,
    fence: row.fence,
    data: readStoredJson(row.data_json, "event data"),
  };
}

function listUserTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function assertDatabaseIntegrity(db) {
  let rows;
  try {
    rows = db.pragma("quick_check(1)");
  } catch (cause) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler database integrity check could not run",
      cause,
    );
  }
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.quick_check !== "ok"
  ) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler database failed SQLite quick_check",
      undefined,
      { result: rows },
    );
  }
}

function verifyTableShape(db, table) {
  const actual = db
    .pragma(`table_info(${JSON.stringify(table)})`)
    .map((column) => [
      column.name,
      String(column.type || "").toUpperCase(),
      column.notnull,
      column.pk,
    ]);
  const expected = EXPECTED_COLUMNS[table];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      `Scheduler table shape does not match v1: ${table}`,
      undefined,
      { expected, actual },
    );
  }
}

function schemaFingerprint(db) {
  const catalog = db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()
    .map((row) => ({
      type: row.type,
      name: row.name,
      tbl_name: row.tbl_name,
      sql: String(row.sql || "")
        .replace(/\s+/g, " ")
        .trim(),
    }));
  return createHash("sha256")
    .update(JSON.stringify(catalog), "utf8")
    .digest("hex");
}

function verifySchema(db) {
  assertDatabaseIntegrity(db);
  const tables = listUserTables(db);
  if (JSON.stringify(tables) !== JSON.stringify(USER_TABLES)) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Scheduler database has unknown or missing tables",
      undefined,
      { expected: USER_TABLES, actual: tables },
    );
  }

  let applicationId;
  let userVersion;
  try {
    applicationId = db.pragma("application_id", { simple: true });
    userVersion = db.pragma("user_version", { simple: true });
  } catch (cause) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler schema metadata could not be read",
      cause,
    );
  }
  if (
    applicationId !== SCHEDULER_APPLICATION_ID ||
    userVersion !== SCHEDULER_SCHEMA_VERSION
  ) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Scheduler schema version or application identity is unknown",
      undefined,
      { applicationId, userVersion },
    );
  }

  for (const table of USER_TABLES) verifyTableShape(db, table);

  const actualFingerprint = schemaFingerprint(db);
  if (actualFingerprint !== SCHEMA_V1_FINGERPRINT) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler sqlite_master catalog does not match v1",
      undefined,
      {
        expected: SCHEMA_V1_FINGERPRINT,
        actual: actualFingerprint,
      },
    );
  }

  let migrations;
  try {
    migrations = db
      .prepare(
        "SELECT version, name, checksum FROM migrations ORDER BY version",
      )
      .all();
  } catch (cause) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler migration history could not be read",
      cause,
    );
  }
  if (
    migrations.length !== 1 ||
    migrations[0].version !== SCHEDULER_SCHEMA_VERSION ||
    migrations[0].name !== MIGRATION_NAME ||
    migrations[0].checksum !== MIGRATION_V1_CHECKSUM
  ) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Scheduler migration history is unknown",
      undefined,
      { migrations },
    );
  }

  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'scheduler_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  if (JSON.stringify(indexes) !== JSON.stringify(EXPECTED_INDEXES)) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler indexes do not match v1",
      undefined,
      { expected: EXPECTED_INDEXES, actual: indexes },
    );
  }
  const foreignKeyFailures = db.pragma("foreign_key_check");
  if (foreignKeyFailures.length > 0) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler database contains broken foreign keys",
      undefined,
      { count: foreignKeyFailures.length },
    );
  }
}

function initializeOrVerifySchema(db, now) {
  assertDatabaseIntegrity(db);
  const tables = listUserTables(db);
  if (tables.length === 0) {
    const migrate = db.transaction(() => {
      db.exec(MIGRATION_V1_SQL);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(
        SCHEDULER_SCHEMA_VERSION,
        MIGRATION_NAME,
        MIGRATION_V1_CHECKSUM,
        now,
      );
      db.pragma(`application_id = ${SCHEDULER_APPLICATION_ID}`);
      db.pragma(`user_version = ${SCHEDULER_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (!tables.includes("migrations")) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Refusing a non-empty database without scheduler migration history",
      undefined,
      { tables },
    );
  }
  verifySchema(db);
}

function defaultDatabasePath() {
  return join(getHomeDir(), "scheduler", "kernel-v1.sqlite");
}

function loadDatabaseConstructor() {
  try {
    return requireCjs("better-sqlite3");
  } catch (cause) {
    throw schemaError(
      "SCHEDULER_SQLITE_UNAVAILABLE",
      "Scheduler kernel requires the existing optional better-sqlite3 dependency",
      cause,
    );
  }
}

function sqliteStorageFiles(target) {
  return [target, `${target}-journal`, `${target}-wal`, `${target}-shm`];
}

function openDatabase({ file, Database, busyTimeoutMs, clock }) {
  const target =
    file === ":memory:" ? file : resolve(file || defaultDatabasePath());
  const timeout = Number(busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 60_000) {
    throw invalidArgument(
      "busyTimeoutMs must be an integer between 0 and 60000",
    );
  }
  const now = normalizeEpochMs(clock(), "clock result");
  if (target !== ":memory:") {
    ensurePrivateDirectory(dirname(target));
    // Existing WAL/SHM files participate in the next SQLite open, so validate
    // them before the native driver consumes either sidecar.
    for (const candidate of sqliteStorageFiles(target)) {
      if (existsSync(candidate)) ensurePrivateFile(candidate);
    }
  }

  const DatabaseConstructor = Database || loadDatabaseConstructor();
  let db;
  try {
    db = new DatabaseConstructor(target, { timeout });
    db.pragma("foreign_keys = ON");
    db.pragma("trusted_schema = OFF");
    db.pragma(`busy_timeout = ${timeout}`);
    initializeOrVerifySchema(db, now);
    if (target !== ":memory:") db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
  } catch (cause) {
    try {
      db?.close();
    } catch {
      // Preserve the authoritative open/schema failure.
    }
    if (cause instanceof SchedulerKernelError) throw cause;
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler database could not be opened or verified",
      cause,
    );
  }

  if (target !== ":memory:") {
    // A quiet WAL database may not have materialized sidecars yet. On Windows,
    // asking secure-fs to classify a missing path deliberately falls back to a
    // native ACL preflight. Only inspect files that SQLite actually created;
    // later opens repeat this check for any surviving sidecars.
    for (const candidate of sqliteStorageFiles(target)) {
      if (existsSync(candidate)) ensurePrivateFile(candidate);
    }
  }
  return { db, target };
}

function leaseLost(occurrenceId) {
  return new SchedulerKernelError(
    "SCHEDULER_LEASE_LOST",
    `Occurrence lease is absent, expired, or owned by another fence: ${occurrenceId}`,
  );
}

export class SchedulerStore {
  constructor(db, { file, clock }) {
    this.db = db;
    this.file = file;
    this.clock = clock;
    this.closed = false;
    this.statements = {
      getJob: db.prepare("SELECT * FROM jobs WHERE job_id = ?"),
      getOccurrence: db.prepare(
        "SELECT * FROM occurrences WHERE occurrence_id = ?",
      ),
      getOccurrenceByKey: db.prepare(
        "SELECT * FROM occurrences WHERE idempotency_key = ?",
      ),
      insertEvent: db.prepare(`
        INSERT INTO events
          (job_id, occurrence_id, event_type, occurred_at, owner_id, fence, data_json)
        VALUES
          (@jobId, @occurrenceId, @type, @occurredAt, @ownerId, @fence, @dataJson)
      `),
    };
  }

  _assertOpen() {
    if (this.closed) {
      throw new SchedulerKernelError(
        "SCHEDULER_STORE_CLOSED",
        "Scheduler store is closed",
      );
    }
  }

  _now() {
    return normalizeEpochMs(this.clock(), "clock result");
  }

  _write(callback) {
    this._assertOpen();
    const transaction = this.db.transaction(callback);
    return transaction.immediate();
  }

  _appendEvent({
    jobId,
    occurrenceId = null,
    type,
    occurredAt,
    ownerId = null,
    fence = null,
    data = {},
  }) {
    this.statements.insertEvent.run({
      jobId,
      occurrenceId,
      type,
      occurredAt,
      ownerId,
      fence,
      dataJson: canonicalJson(data, "event.data"),
    });
  }

  createJob(input) {
    const job = normalizeJobInput(input);
    const now = this._now();
    return this._write(() => {
      if (this.statements.getJob.get(job.id)) {
        throw new SchedulerKernelError(
          "SCHEDULER_CONFLICT",
          `Scheduler job already exists: ${job.id}`,
        );
      }
      this.db
        .prepare(
          `
          INSERT INTO jobs
            (job_id, kind, trigger_json, payload_json, authority_json,
             enabled, revision, max_attempts, created_at, updated_at)
          VALUES
            (@id, @kind, @triggerJson, @payloadJson, @authorityJson,
             @enabled, 1, @maxAttempts, @now, @now)
        `,
        )
        .run({
          id: job.id,
          kind: job.kind,
          triggerJson: canonicalJson(job.trigger, "job.trigger"),
          payloadJson: canonicalJson(job.payload, "job.payload"),
          authorityJson: canonicalJson(job.authority, "job.authority"),
          enabled: job.enabled ? 1 : 0,
          maxAttempts: job.maxAttempts,
          now,
        });
      this._appendEvent({
        jobId: job.id,
        type: "job_created",
        occurredAt: now,
        data: { revision: 1 },
      });
      return mapJob(this.statements.getJob.get(job.id));
    });
  }

  getJob(jobId) {
    this._assertOpen();
    return mapJob(
      this.statements.getJob.get(normalizeIdentifier(jobId, "jobId")),
    );
  }

  updateJob(jobId, expectedRevision, patch) {
    const id = normalizeIdentifier(jobId, "jobId");
    const revision = assertPositiveSafeInteger(
      expectedRevision,
      "expectedRevision",
    );
    const { normalized, changedFields } = normalizeJobPatch(patch);
    const now = this._now();
    return this._write(() => {
      const current = mapJob(this.statements.getJob.get(id));
      if (!current) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler job does not exist: ${id}`,
        );
      }
      if (current.revision !== revision) {
        throw new SchedulerKernelError(
          "SCHEDULER_REVISION_CONFLICT",
          `Scheduler job revision changed: ${id}`,
          { expectedRevision: revision, actualRevision: current.revision },
        );
      }
      const next = {
        ...current,
        ...normalized,
        revision: current.revision + 1,
        updatedAt: now,
      };
      const result = this.db
        .prepare(
          `
          UPDATE jobs
          SET kind = @kind,
              trigger_json = @triggerJson,
              payload_json = @payloadJson,
              authority_json = @authorityJson,
              enabled = @enabled,
              revision = @nextRevision,
              max_attempts = @maxAttempts,
              updated_at = @now
          WHERE job_id = @id AND revision = @expectedRevision
        `,
        )
        .run({
          id,
          kind: next.kind,
          triggerJson: canonicalJson(next.trigger, "job.trigger"),
          payloadJson: canonicalJson(next.payload, "job.payload"),
          authorityJson: canonicalJson(next.authority, "job.authority"),
          enabled: next.enabled ? 1 : 0,
          nextRevision: next.revision,
          maxAttempts: next.maxAttempts,
          now,
          expectedRevision: revision,
        });
      if (result.changes !== 1) {
        throw new SchedulerKernelError(
          "SCHEDULER_REVISION_CONFLICT",
          `Scheduler job revision changed during update: ${id}`,
        );
      }
      this._appendEvent({
        jobId: id,
        type: "job_updated",
        occurredAt: now,
        data: {
          fromRevision: revision,
          toRevision: next.revision,
          changedFields,
        },
      });
      return mapJob(this.statements.getJob.get(id));
    });
  }

  enqueueOccurrence({ jobId, scheduledFor, triggerKey, availableAt } = {}) {
    const id = normalizeIdentifier(jobId, "jobId");
    const scheduled = normalizeEpochMs(scheduledFor, "scheduledFor");
    const key = normalizeIdentifier(triggerKey, "triggerKey");
    const available = normalizeEpochMs(availableAt ?? scheduled, "availableAt");
    const now = this._now();
    return this._write(() => {
      const job = mapJob(this.statements.getJob.get(id));
      if (!job) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler job does not exist: ${id}`,
        );
      }
      if (!job.enabled) {
        throw new SchedulerKernelError(
          "SCHEDULER_JOB_DISABLED",
          `Scheduler job is disabled: ${id}`,
        );
      }
      const identity = deriveOccurrenceIdentity({
        jobId: id,
        jobRevision: job.revision,
        scheduledFor: scheduled,
        triggerKey: key,
      });
      const result = this.db
        .prepare(
          `
          INSERT INTO occurrences
            (occurrence_id, job_id, job_revision, idempotency_key, trigger_key,
             scheduled_for, available_at, status, attempt, max_attempts, fence,
             lease_owner, lease_expires_at, authority_json, payload_json,
             last_error_json, result_json, created_at, updated_at, settled_at)
          VALUES
            (@occurrenceId, @jobId, @jobRevision, @idempotencyKey, @triggerKey,
             @scheduledFor, @availableAt, 'queued', 0, @maxAttempts, 0,
             NULL, NULL, @authorityJson, @payloadJson,
             NULL, NULL, @now, @now, NULL)
          ON CONFLICT(idempotency_key) DO NOTHING
        `,
        )
        .run({
          ...identity,
          jobId: id,
          jobRevision: job.revision,
          triggerKey: key,
          scheduledFor: scheduled,
          availableAt: available,
          maxAttempts: job.maxAttempts,
          authorityJson: canonicalJson(job.authority, "occurrence.authority"),
          payloadJson: canonicalJson(job.payload, "occurrence.payload"),
          now,
        });
      const row = this.statements.getOccurrenceByKey.get(
        identity.idempotencyKey,
      );
      if (!row || row.occurrence_id !== identity.occurrenceId) {
        throw schemaError(
          "SCHEDULER_DATA_CORRUPT",
          "Occurrence idempotency identity does not match stored data",
        );
      }
      if (result.changes === 1) {
        this._appendEvent({
          jobId: id,
          occurrenceId: identity.occurrenceId,
          type: "occurrence_enqueued",
          occurredAt: now,
          data: {
            jobRevision: job.revision,
            scheduledFor: scheduled,
            triggerKey: key,
          },
        });
      }
      return { ...mapOccurrence(row), deduplicated: result.changes === 0 };
    });
  }

  getOccurrence(occurrenceId) {
    this._assertOpen();
    return mapOccurrence(
      this.statements.getOccurrence.get(
        normalizeIdentifier(occurrenceId, "occurrenceId"),
      ),
    );
  }

  _deadLetterExpiredLeases(now) {
    const expired = this.db
      .prepare(
        `
        SELECT occurrence_id, job_id, lease_owner, fence, attempt, max_attempts
        FROM occurrences
        WHERE status = 'running'
          AND lease_expires_at <= ?
          AND attempt >= max_attempts
        ORDER BY lease_expires_at, occurrence_id
        LIMIT 100
      `,
      )
      .all(now);
    const update = this.db.prepare(`
      UPDATE occurrences
      SET status = 'dead_letter',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error_json = @errorJson,
          updated_at = @now,
          settled_at = @now
      WHERE occurrence_id = @occurrenceId
        AND status = 'running'
        AND lease_owner = @ownerId
        AND fence = @fence
        AND lease_expires_at <= @now
        AND attempt >= max_attempts
    `);
    for (const row of expired) {
      const error = {
        code: "lease_expired",
        message: "Execution lease expired after the final allowed attempt",
      };
      const result = update.run({
        occurrenceId: row.occurrence_id,
        ownerId: row.lease_owner,
        fence: row.fence,
        errorJson: canonicalJson(error, "occurrence.error"),
        now,
      });
      if (result.changes === 1) {
        this._appendEvent({
          jobId: row.job_id,
          occurrenceId: row.occurrence_id,
          type: "occurrence_dead_lettered",
          occurredAt: now,
          ownerId: row.lease_owner,
          fence: row.fence,
          data: {
            attempt: row.attempt,
            maxAttempts: row.max_attempts,
            reason: "lease_expired",
          },
        });
      }
    }
  }

  claimNext({ ownerId, leaseMs } = {}) {
    const owner = normalizeIdentifier(ownerId, "ownerId");
    const lease = normalizeLeaseMs(leaseMs);
    const now = this._now();
    const leaseExpiresAt = now + lease;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw invalidArgument("lease expiry exceeds the safe integer range");
    }
    return this._write(() => {
      this._deadLetterExpiredLeases(now);
      const candidate = this.db
        .prepare(
          `
          SELECT o.*
          FROM occurrences o
          JOIN jobs j ON j.job_id = o.job_id
          WHERE j.enabled = 1
            AND o.attempt < o.max_attempts
            AND (
              (o.status IN ('queued', 'retry_wait') AND o.available_at <= @now)
              OR
              (o.status = 'running' AND o.lease_expires_at <= @now)
            )
          ORDER BY
            CASE WHEN o.status = 'running' THEN o.lease_expires_at ELSE o.available_at END,
            o.scheduled_for,
            o.occurrence_id
          LIMIT 1
        `,
        )
        .get({ now });
      if (!candidate) return null;
      const previousStatus = candidate.status;
      const previousOwner = candidate.lease_owner;
      const result = this.db
        .prepare(
          `
          UPDATE occurrences
          SET status = 'running',
              attempt = attempt + 1,
              fence = fence + 1,
              lease_owner = @ownerId,
              lease_expires_at = @leaseExpiresAt,
              updated_at = @now,
              settled_at = NULL
          WHERE occurrence_id = @occurrenceId
            AND fence = @expectedFence
            AND attempt < max_attempts
            AND (
              (status IN ('queued', 'retry_wait') AND available_at <= @now)
              OR
              (status = 'running' AND lease_expires_at <= @now)
            )
        `,
        )
        .run({
          occurrenceId: candidate.occurrence_id,
          expectedFence: candidate.fence,
          ownerId: owner,
          leaseExpiresAt,
          now,
        });
      if (result.changes !== 1) {
        throw new SchedulerKernelError(
          "SCHEDULER_CLAIM_CONFLICT",
          "Occurrence eligibility changed during claim",
        );
      }
      const claimed = this.statements.getOccurrence.get(
        candidate.occurrence_id,
      );
      this._appendEvent({
        jobId: candidate.job_id,
        occurrenceId: candidate.occurrence_id,
        type:
          previousStatus === OCCURRENCE_STATUS.RUNNING
            ? "occurrence_reclaimed"
            : "occurrence_claimed",
        occurredAt: now,
        ownerId: owner,
        fence: claimed.fence,
        data: {
          attempt: claimed.attempt,
          previousOwner,
          previousStatus,
        },
      });
      return mapOccurrence(claimed);
    });
  }

  renew({ occurrenceId, ownerId, fence, leaseMs } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const owner = normalizeIdentifier(ownerId, "ownerId");
    const token = assertPositiveSafeInteger(fence, "fence");
    const lease = normalizeLeaseMs(leaseMs);
    const now = this._now();
    const leaseExpiresAt = now + lease;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw invalidArgument("lease expiry exceeds the safe integer range");
    }
    return this._write(() => {
      const result = this.db
        .prepare(
          `
          UPDATE occurrences
          SET lease_expires_at = MAX(lease_expires_at, @leaseExpiresAt),
              updated_at = @now
          WHERE occurrence_id = @occurrenceId
            AND status = 'running'
            AND lease_owner = @ownerId
            AND fence = @fence
            AND lease_expires_at > @now
        `,
        )
        .run({
          occurrenceId: id,
          ownerId: owner,
          fence: token,
          leaseExpiresAt,
          now,
        });
      if (result.changes !== 1) throw leaseLost(id);
      const row = this.statements.getOccurrence.get(id);
      this._appendEvent({
        jobId: row.job_id,
        occurrenceId: id,
        type: "occurrence_renewed",
        occurredAt: now,
        ownerId: owner,
        fence: token,
        data: { leaseExpiresAt: row.lease_expires_at },
      });
      return mapOccurrence(row);
    });
  }

  settle({
    occurrenceId,
    ownerId,
    fence,
    outcome,
    result,
    error,
    retryable = true,
    retryAt,
  } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const owner = normalizeIdentifier(ownerId, "ownerId");
    const token = assertPositiveSafeInteger(fence, "fence");
    if (!["succeeded", "failed"].includes(outcome)) {
      throw invalidArgument("outcome must be succeeded or failed");
    }
    if (typeof retryable !== "boolean") {
      throw invalidArgument("retryable must be a boolean");
    }
    const normalizedResult =
      outcome === "succeeded" ? normalizeJson(result ?? null, "result") : null;
    const normalizedError =
      outcome === "failed"
        ? normalizeJson(
            error ?? {
              code: "execution_failed",
              message: "Execution failed",
            },
            "error",
          )
        : null;
    const now = this._now();
    const availableAt =
      outcome !== "failed" || retryAt === undefined
        ? now
        : Math.max(now, normalizeEpochMs(retryAt, "retryAt"));

    return this._write(() => {
      const current = this.statements.getOccurrence.get(id);
      if (
        !current ||
        current.status !== OCCURRENCE_STATUS.RUNNING ||
        current.lease_owner !== owner ||
        current.fence !== token ||
        current.lease_expires_at <= now
      ) {
        throw leaseLost(id);
      }

      let nextStatus;
      let eventType;
      let settledAt = null;
      let nextAvailableAt = current.available_at;
      let lastErrorJson = null;
      let resultJson = null;
      if (outcome === "succeeded") {
        nextStatus = OCCURRENCE_STATUS.SUCCEEDED;
        eventType = "occurrence_succeeded";
        settledAt = now;
        resultJson = canonicalJson(normalizedResult, "result");
      } else if (retryable && current.attempt < current.max_attempts) {
        nextStatus = OCCURRENCE_STATUS.RETRY_WAIT;
        eventType = "occurrence_retry_scheduled";
        nextAvailableAt = availableAt;
        lastErrorJson = canonicalJson(normalizedError, "error");
      } else {
        nextStatus = OCCURRENCE_STATUS.DEAD_LETTER;
        eventType = "occurrence_dead_lettered";
        settledAt = now;
        lastErrorJson = canonicalJson(normalizedError, "error");
      }

      const update = this.db
        .prepare(
          `
          UPDATE occurrences
          SET status = @status,
              available_at = @availableAt,
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error_json = @lastErrorJson,
              result_json = @resultJson,
              updated_at = @now,
              settled_at = @settledAt
          WHERE occurrence_id = @occurrenceId
            AND status = 'running'
            AND lease_owner = @ownerId
            AND fence = @fence
            AND lease_expires_at > @now
        `,
        )
        .run({
          occurrenceId: id,
          ownerId: owner,
          fence: token,
          status: nextStatus,
          availableAt: nextAvailableAt,
          lastErrorJson,
          resultJson,
          now,
          settledAt,
        });
      if (update.changes !== 1) throw leaseLost(id);
      this._appendEvent({
        jobId: current.job_id,
        occurrenceId: id,
        type: eventType,
        occurredAt: now,
        ownerId: owner,
        fence: token,
        data: {
          attempt: current.attempt,
          maxAttempts: current.max_attempts,
          ...(nextStatus === OCCURRENCE_STATUS.RETRY_WAIT
            ? { retryAt: nextAvailableAt }
            : {}),
        },
      });
      return mapOccurrence(this.statements.getOccurrence.get(id));
    });
  }

  history({ occurrenceId, jobId, limit } = {}) {
    this._assertOpen();
    const boundedLimit = normalizeHistoryLimit(limit);
    const occurrence =
      occurrenceId === undefined
        ? null
        : normalizeIdentifier(occurrenceId, "occurrenceId");
    const job =
      jobId === undefined ? null : normalizeIdentifier(jobId, "jobId");
    let sql = "SELECT * FROM events";
    const parameters = { limit: boundedLimit };
    if (occurrence !== null && job !== null) {
      sql += " WHERE occurrence_id = @occurrenceId AND job_id = @jobId";
      parameters.occurrenceId = occurrence;
      parameters.jobId = job;
    } else if (occurrence !== null) {
      sql += " WHERE occurrence_id = @occurrenceId";
      parameters.occurrenceId = occurrence;
    } else if (job !== null) {
      sql += " WHERE job_id = @jobId";
      parameters.jobId = job;
    }
    sql += " ORDER BY event_id DESC LIMIT @limit";
    return this.db.prepare(sql).all(parameters).map(mapEvent);
  }

  listDeadLetters({ jobId, limit } = {}) {
    this._assertOpen();
    const boundedLimit = normalizeHistoryLimit(limit);
    if (jobId === undefined) {
      return this.db
        .prepare(
          "SELECT * FROM occurrences WHERE status = 'dead_letter' ORDER BY settled_at DESC, occurrence_id LIMIT ?",
        )
        .all(boundedLimit)
        .map(mapOccurrence);
    }
    const id = normalizeIdentifier(jobId, "jobId");
    return this.db
      .prepare(
        "SELECT * FROM occurrences WHERE status = 'dead_letter' AND job_id = ? ORDER BY settled_at DESC, occurrence_id LIMIT ?",
      )
      .all(id, boundedLimit)
      .map(mapOccurrence);
  }

  schemaInfo() {
    this._assertOpen();
    return {
      applicationId: this.db.pragma("application_id", { simple: true }),
      schemaVersion: this.db.pragma("user_version", { simple: true }),
      migration: this.db
        .prepare(
          "SELECT version, name, checksum, applied_at AS appliedAt FROM migrations ORDER BY version DESC LIMIT 1",
        )
        .get(),
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

export function openSchedulerStore({
  file,
  Database,
  clock = Date.now,
  busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
} = {}) {
  if (typeof clock !== "function") {
    throw invalidArgument("clock must be a function");
  }
  const opened = openDatabase({ file, Database, busyTimeoutMs, clock });
  return new SchedulerStore(opened.db, {
    file: opened.target,
    clock,
  });
}
