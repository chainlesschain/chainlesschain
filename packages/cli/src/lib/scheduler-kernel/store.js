import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import {
  OCCURRENCE_STATUS,
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
export const SCHEDULER_STORE_SCHEMA_VERSION = 3;
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
export const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;
export const MIN_AUTHORITY_WINDOW_MS = 60_000;
export const MAX_AUTHORITY_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
export const MAX_AUTHORITY_BUDGET = 1_000_000;
export const DEFAULT_AUTHORITY_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_AUTHORITY_MAX_RUNS = 100_000;
export const DEFAULT_AUTHORITY_MAX_UNITS = 100_000;
export const SCHEDULER_ADJUDICATION_AUTHORITY = "local-operator";
export const SCHEDULER_ADJUDICATION_DECISIONS = Object.freeze({
  CONFIRMED_APPLIED: "confirmed_applied",
  CONFIRMED_NOT_APPLIED: "confirmed_not_applied",
});

const MIGRATION_V1_NAME = "scheduler-kernel-v1";
const MIGRATION_V2_NAME = "scheduler-kernel-authority-v2";
const MIGRATION_V3_NAME = "scheduler-kernel-adjudication-v3";
const V1_USER_TABLES = Object.freeze([
  "events",
  "jobs",
  "migrations",
  "occurrences",
]);
const V2_USER_TABLES = Object.freeze([
  "events",
  "jobs",
  "migrations",
  "occurrences",
  "scheduler_authority_policies",
  "scheduler_authority_reservations",
  "scheduler_authority_usage",
]);
const USER_TABLES = Object.freeze([
  ...V2_USER_TABLES,
  "scheduler_occurrence_adjudications",
]);

export const MIGRATION_V1_SQL = `
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

export const MIGRATION_V2_SQL = `
CREATE TABLE scheduler_authority_policies (
  principal_type     TEXT NOT NULL,
  principal_id       TEXT NOT NULL,
  revision           INTEGER NOT NULL CHECK (revision >= 1),
  enabled            INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  capabilities_json  TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  window_ms          INTEGER NOT NULL CHECK (
    window_ms BETWEEN 60000 AND 2678400000
  ),
  max_runs           INTEGER NOT NULL CHECK (
    max_runs BETWEEN 1 AND 1000000
  ),
  max_units          INTEGER NOT NULL CHECK (
    max_units BETWEEN 1 AND 1000000
  ),
  created_at         INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at         INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (principal_type, principal_id)
);

CREATE TABLE scheduler_authority_usage (
  principal_type     TEXT NOT NULL,
  principal_id       TEXT NOT NULL,
  policy_revision    INTEGER NOT NULL CHECK (policy_revision >= 1),
  window_started_at  INTEGER NOT NULL CHECK (window_started_at >= 0),
  runs               INTEGER NOT NULL CHECK (runs BETWEEN 0 AND 1000000),
  units              INTEGER NOT NULL CHECK (units BETWEEN 0 AND 1000000),
  updated_at         INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (
    principal_type,
    principal_id,
    policy_revision,
    window_started_at
  )
);

CREATE TABLE scheduler_authority_reservations (
  occurrence_id      TEXT PRIMARY KEY NOT NULL
                     REFERENCES occurrences(occurrence_id) ON DELETE RESTRICT,
  job_id             TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE RESTRICT,
  principal_type     TEXT NOT NULL,
  principal_id       TEXT NOT NULL,
  policy_revision    INTEGER NOT NULL CHECK (policy_revision >= 1),
  window_started_at  INTEGER NOT NULL CHECK (window_started_at >= 0),
  units              INTEGER NOT NULL CHECK (units BETWEEN 1 AND 1000000),
  status             TEXT NOT NULL CHECK (
    status IN ('reserved', 'succeeded', 'failed')
  ),
  outcome_json       TEXT CHECK (
    outcome_json IS NULL OR json_valid(outcome_json)
  ),
  created_at         INTEGER NOT NULL CHECK (created_at >= 0),
  settled_at         INTEGER,
  CHECK (
    (status = 'reserved' AND outcome_json IS NULL AND settled_at IS NULL)
    OR
    (status <> 'reserved' AND outcome_json IS NOT NULL AND settled_at IS NOT NULL)
  )
);

CREATE INDEX scheduler_authority_reservations_principal
  ON scheduler_authority_reservations
    (principal_type, principal_id, policy_revision, window_started_at);
CREATE INDEX scheduler_authority_reservations_status
  ON scheduler_authority_reservations(status, created_at);
`;

export const MIGRATION_V2_CHECKSUM = createHash("sha256")
  .update(MIGRATION_V2_SQL.trim().replace(/\r\n/g, "\n"), "utf8")
  .update("\0scheduler-authority-v2-backfill-v1", "utf8")
  .digest("hex");

export const MIGRATION_V3_SQL = `
CREATE TABLE scheduler_occurrence_adjudications (
  occurrence_id       TEXT PRIMARY KEY NOT NULL
                      REFERENCES occurrences(occurrence_id) ON DELETE RESTRICT,
  job_id              TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE RESTRICT,
  request_id          TEXT NOT NULL UNIQUE,
  decision            TEXT NOT NULL CHECK (
    decision IN ('confirmed_applied', 'confirmed_not_applied')
  ),
  authority           TEXT NOT NULL CHECK (authority = 'local-operator'),
  evidence_digest     TEXT NOT NULL,
  expected_attempt    INTEGER NOT NULL CHECK (expected_attempt >= 1),
  expected_fence      INTEGER NOT NULL CHECK (expected_fence >= 1),
  reason_digest       TEXT NOT NULL,
  operator_digest     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'applied')),
  created_at          INTEGER NOT NULL CHECK (created_at >= 0),
  applied_at          INTEGER,
  retry_settled_at    INTEGER,
  retry_outcome_json  TEXT CHECK (
    retry_outcome_json IS NULL OR json_valid(retry_outcome_json)
  ),
  CHECK (
    (status = 'pending' AND applied_at IS NULL)
    OR
    (status = 'applied' AND applied_at IS NOT NULL)
  ),
  CHECK (
    (retry_settled_at IS NULL AND retry_outcome_json IS NULL)
    OR
    (status = 'applied' AND retry_settled_at IS NOT NULL
      AND retry_outcome_json IS NOT NULL)
  )
);

CREATE INDEX scheduler_adjudications_status
  ON scheduler_occurrence_adjudications(status, created_at, occurrence_id);
`;

export const MIGRATION_V3_CHECKSUM = createHash("sha256")
  .update(MIGRATION_V3_SQL.trim().replace(/\r\n/g, "\n"), "utf8")
  .digest("hex");

// Fingerprint of the normalized sqlite_master catalog produced by the v1 DDL.
// Unlike the migration-source checksum, this also detects added triggers/views
// and constraint/foreign-key changes that preserve the visible column list.
export const SCHEMA_V1_FINGERPRINT =
  "cf244f675ac7430683f67046b57524eb6c14baa45d6463ed3f704be898fec887";
export const SCHEMA_V2_FINGERPRINT =
  "402c58d4b3b217699591528f9be6c1c7fe341650b843eb2d8d9d907779ff27b0";
export const SCHEMA_V3_FINGERPRINT =
  "aac3733641bebb5a86aea3f9c421818201f5dde051da6b95b880d503a420047b";

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
  scheduler_authority_policies: [
    ["principal_type", "TEXT", 1, 1],
    ["principal_id", "TEXT", 1, 2],
    ["revision", "INTEGER", 1, 0],
    ["enabled", "INTEGER", 1, 0],
    ["capabilities_json", "TEXT", 1, 0],
    ["window_ms", "INTEGER", 1, 0],
    ["max_runs", "INTEGER", 1, 0],
    ["max_units", "INTEGER", 1, 0],
    ["created_at", "INTEGER", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
  ],
  scheduler_authority_usage: [
    ["principal_type", "TEXT", 1, 1],
    ["principal_id", "TEXT", 1, 2],
    ["policy_revision", "INTEGER", 1, 3],
    ["window_started_at", "INTEGER", 1, 4],
    ["runs", "INTEGER", 1, 0],
    ["units", "INTEGER", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
  ],
  scheduler_authority_reservations: [
    ["occurrence_id", "TEXT", 1, 1],
    ["job_id", "TEXT", 1, 0],
    ["principal_type", "TEXT", 1, 0],
    ["principal_id", "TEXT", 1, 0],
    ["policy_revision", "INTEGER", 1, 0],
    ["window_started_at", "INTEGER", 1, 0],
    ["units", "INTEGER", 1, 0],
    ["status", "TEXT", 1, 0],
    ["outcome_json", "TEXT", 0, 0],
    ["created_at", "INTEGER", 1, 0],
    ["settled_at", "INTEGER", 0, 0],
  ],
  scheduler_occurrence_adjudications: [
    ["occurrence_id", "TEXT", 1, 1],
    ["job_id", "TEXT", 1, 0],
    ["request_id", "TEXT", 1, 0],
    ["decision", "TEXT", 1, 0],
    ["authority", "TEXT", 1, 0],
    ["evidence_digest", "TEXT", 1, 0],
    ["expected_attempt", "INTEGER", 1, 0],
    ["expected_fence", "INTEGER", 1, 0],
    ["reason_digest", "TEXT", 1, 0],
    ["operator_digest", "TEXT", 1, 0],
    ["status", "TEXT", 1, 0],
    ["created_at", "INTEGER", 1, 0],
    ["applied_at", "INTEGER", 0, 0],
    ["retry_settled_at", "INTEGER", 0, 0],
    ["retry_outcome_json", "TEXT", 0, 0],
  ],
});

const EXPECTED_INDEXES = Object.freeze([
  "scheduler_adjudications_status",
  "scheduler_authority_reservations_principal",
  "scheduler_authority_reservations_status",
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

function normalizeAuthorityBudgetLimit(
  value,
  field,
  { minimum = 1, maximum = MAX_AUTHORITY_BUDGET } = {},
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidArgument(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function normalizeAuthorityPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw invalidArgument("authority principal must be an object");
  }
  return {
    type: normalizeIdentifier(principal.type, "authority.principal.type", {
      maxLength: 64,
    }),
    id: normalizeIdentifier(principal.id, "authority.principal.id"),
  };
}

function normalizeCapabilityList(value, field = "capabilities") {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw invalidArgument(`${field} must contain between 1 and 256 entries`);
  }
  const capabilities = [
    ...new Set(
      value.map((capability, index) =>
        normalizeIdentifier(capability, `${field}[${index}]`),
      ),
    ),
  ].sort();
  if (capabilities.includes("*")) {
    throw invalidArgument(`${field} must contain exact capabilities`);
  }
  return capabilities;
}

function mapAuthorityPolicy(row) {
  if (!row) return null;
  return {
    principal: { type: row.principal_type, id: row.principal_id },
    revision: row.revision,
    enabled: row.enabled === 1,
    capabilities: normalizeCapabilityList(
      readStoredJson(row.capabilities_json, "scheduler authority capabilities"),
    ),
    windowMs: row.window_ms,
    maxRuns: row.max_runs,
    maxUnits: row.max_units,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAuthorityReservation(row) {
  if (!row) return null;
  return {
    occurrenceId: row.occurrence_id,
    jobId: row.job_id,
    principal: { type: row.principal_type, id: row.principal_id },
    policyRevision: row.policy_revision,
    windowStartedAt: row.window_started_at,
    units: row.units,
    status: row.status,
    outcome:
      row.outcome_json === null
        ? null
        : readStoredJson(row.outcome_json, "scheduler authority outcome"),
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
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

function mapAdjudication(row) {
  if (!row) return null;
  return {
    occurrenceId: row.occurrence_id,
    jobId: row.job_id,
    requestId: row.request_id,
    decision: row.decision,
    authority: row.authority,
    evidenceDigest: row.evidence_digest,
    expectedAttempt: row.expected_attempt,
    expectedFence: row.expected_fence,
    reasonDigest: row.reason_digest,
    operatorDigest: row.operator_digest,
    status: row.status,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
    retrySettledAt: row.retry_settled_at,
    retryOutcome:
      row.retry_outcome_json === null
        ? null
        : readStoredJson(row.retry_outcome_json, "adjudication retry outcome"),
  };
}

function schedulerAdjudicationError(code, message, details = undefined) {
  return new SchedulerKernelError(code, message, details);
}

function normalizeAdjudicationDecision(value) {
  if (!Object.values(SCHEDULER_ADJUDICATION_DECISIONS).includes(value)) {
    throw invalidArgument(
      "decision must be confirmed_applied or confirmed_not_applied",
    );
  }
  return value;
}

function normalizeSha256Digest(value, field) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw invalidArgument(`${field} must be a sha256 payload digest`);
  }
  return value;
}

function isOutcomeUnknownError(error) {
  return (
    typeof error?.code === "string" &&
    /^[A-Z0-9_]+_OUTCOME_UNKNOWN$/.test(error.code)
  );
}

function sha256PayloadDigest(value, field) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value, field), "utf8")
    .digest("hex")}`;
}

export function schedulerAdjudicationReasonDigest(reason) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw invalidArgument("adjudication reason must be a non-empty string");
  }
  if (Buffer.byteLength(reason, "utf8") > 4_000) {
    throw invalidArgument("adjudication reason must not exceed 4000 bytes");
  }
  return sha256PayloadDigest(reason, "adjudication.reason");
}

export function schedulerAdjudicationOperatorDigest(identity) {
  return sha256PayloadDigest(
    normalizeJson(identity, "adjudication.operatorIdentity"),
    "adjudication.operatorIdentity",
  );
}

function adjudicationEvidence(occurrence, reservation) {
  return {
    schemaVersion: 1,
    occurrence: {
      id: occurrence.id,
      jobId: occurrence.jobId,
      jobRevision: occurrence.jobRevision,
      idempotencyKey: occurrence.idempotencyKey,
      triggerKey: occurrence.triggerKey,
      scheduledFor: occurrence.scheduledFor,
      status: occurrence.status,
      attempt: occurrence.attempt,
      maxAttempts: occurrence.maxAttempts,
      fence: occurrence.fence,
      authorityDigest: sha256PayloadDigest(
        occurrence.authority,
        "adjudication.authority",
      ),
      payloadDigest: sha256PayloadDigest(
        occurrence.payload,
        "adjudication.payload",
      ),
      lastError: occurrence.lastError,
      settledAt: occurrence.settledAt,
    },
    reservation:
      reservation === null
        ? null
        : {
            jobId: reservation.jobId,
            principal: reservation.principal,
            policyRevision: reservation.policyRevision,
            windowStartedAt: reservation.windowStartedAt,
            units: reservation.units,
            status: reservation.status,
            outcomeDigest:
              reservation.outcome === null
                ? null
                : sha256PayloadDigest(
                    reservation.outcome,
                    "adjudication.reservationOutcome",
                  ),
            createdAt: reservation.createdAt,
            settledAt: reservation.settledAt,
          },
  };
}

function deterministicAdjudicationRequestId({
  occurrenceId,
  decision,
  evidenceDigest,
  reasonDigest,
}) {
  const digest = sha256PayloadDigest(
    {
      schemaVersion: 1,
      occurrenceId,
      decision,
      evidenceDigest,
      reasonDigest,
    },
    "adjudication.request",
  );
  return `scheduler-adjudication-${digest.slice("sha256:".length)}`;
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
      `Scheduler table shape is invalid: ${table}`,
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

function verifySchema(db, version = SCHEDULER_STORE_SCHEMA_VERSION) {
  assertDatabaseIntegrity(db);
  const tables = listUserTables(db);
  const expectedTables =
    version === 1
      ? V1_USER_TABLES
      : version === 2
        ? V2_USER_TABLES
        : USER_TABLES;
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Scheduler database has unknown or missing tables",
      undefined,
      { expected: expectedTables, actual: tables },
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
  if (applicationId !== SCHEDULER_APPLICATION_ID || userVersion !== version) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Scheduler schema version or application identity is unknown",
      undefined,
      { applicationId, userVersion },
    );
  }

  for (const table of expectedTables) verifyTableShape(db, table);

  const actualFingerprint = schemaFingerprint(db);
  const expectedFingerprint =
    version === 1
      ? SCHEMA_V1_FINGERPRINT
      : version === 2
        ? SCHEMA_V2_FINGERPRINT
        : SCHEMA_V3_FINGERPRINT;
  if (actualFingerprint !== expectedFingerprint) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      `Scheduler sqlite_master catalog does not match v${version}`,
      undefined,
      {
        expected: expectedFingerprint,
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
    migrations.length !== version ||
    migrations[0].version !== 1 ||
    migrations[0].name !== MIGRATION_V1_NAME ||
    migrations[0].checksum !== MIGRATION_V1_CHECKSUM ||
    (version >= 2 &&
      (migrations[1]?.version !== 2 ||
        migrations[1]?.name !== MIGRATION_V2_NAME ||
        migrations[1]?.checksum !== MIGRATION_V2_CHECKSUM)) ||
    (version >= 3 &&
      (migrations[2]?.version !== 3 ||
        migrations[2]?.name !== MIGRATION_V3_NAME ||
        migrations[2]?.checksum !== MIGRATION_V3_CHECKSUM))
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
  const expectedIndexes = EXPECTED_INDEXES.filter(
    (name) =>
      (version >= 2 || !name.startsWith("scheduler_authority_")) &&
      (version >= 3 || !name.startsWith("scheduler_adjudications_")),
  );
  if (JSON.stringify(indexes) !== JSON.stringify(expectedIndexes)) {
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      `Scheduler indexes do not match v${version}`,
      undefined,
      { expected: expectedIndexes, actual: indexes },
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

function migrateAuthorityV2(db, now) {
  db.exec(MIGRATION_V2_SQL);
  const policies = new Map();
  const jobs = db
    .prepare("SELECT job_id, authority_json FROM jobs ORDER BY job_id")
    .all();
  const occurrences = db
    .prepare(
      `SELECT occurrence_id, status, authority_json
       FROM occurrences ORDER BY occurrence_id`,
    )
    .all();
  const bind = (encoded, field) => {
    const authority = readStoredAuthority(encoded, field);
    const key = canonicalJson(authority.principal, `${field}.principal`);
    const current = policies.get(key) ?? {
      principal: authority.principal,
      capabilities: new Set(),
    };
    for (const capability of authority.requestedCapabilities) {
      current.capabilities.add(capability);
    }
    policies.set(key, current);
    return {
      ...authority,
      authorizationRefs: {
        ...authority.authorizationRefs,
        schedulerPolicyRevision: "scheduler-authority:1",
      },
    };
  };
  const boundJobs = jobs.map((row) => ({
    id: row.job_id,
    authority: bind(row.authority_json, `job ${row.job_id} authority`),
  }));
  const boundOccurrences = occurrences.map((row) => {
    const field = `occurrence ${row.occurrence_id} authority`;
    const terminal =
      row.status === OCCURRENCE_STATUS.SUCCEEDED ||
      row.status === OCCURRENCE_STATUS.DEAD_LETTER;
    return {
      id: row.occurrence_id,
      terminal,
      // Validate terminal history too, but do not widen the active policy with
      // capabilities that no current or replayable occurrence still needs.
      authority: terminal
        ? readStoredAuthority(row.authority_json, field)
        : bind(row.authority_json, field),
    };
  });
  const insertPolicy = db.prepare(
    `INSERT INTO scheduler_authority_policies
       (principal_type, principal_id, revision, enabled,
        capabilities_json, window_ms, max_runs, max_units,
        created_at, updated_at)
     VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`,
  );
  for (const { principal, capabilities } of policies.values()) {
    insertPolicy.run(
      principal.type,
      principal.id,
      canonicalJson([...capabilities].sort(), "authorityPolicy.capabilities"),
      DEFAULT_AUTHORITY_WINDOW_MS,
      DEFAULT_AUTHORITY_MAX_RUNS,
      DEFAULT_AUTHORITY_MAX_UNITS,
      now,
      now,
    );
  }
  const updateJob = db.prepare(
    "UPDATE jobs SET authority_json = ? WHERE job_id = ?",
  );
  for (const row of boundJobs) {
    updateJob.run(canonicalJson(row.authority, "job.authority"), row.id);
  }
  const updateOccurrence = db.prepare(
    "UPDATE occurrences SET authority_json = ? WHERE occurrence_id = ?",
  );
  for (const row of boundOccurrences) {
    if (row.terminal) continue;
    updateOccurrence.run(
      canonicalJson(row.authority, "occurrence.authority"),
      row.id,
    );
  }
}

function migrateAdjudicationV3(db) {
  db.exec(MIGRATION_V3_SQL);
}

function initializeOrVerifySchema(db, now) {
  assertDatabaseIntegrity(db);
  const tables = listUserTables(db);
  if (tables.length === 0) {
    const migrate = db.transaction(() => {
      db.exec(MIGRATION_V1_SQL);
      migrateAuthorityV2(db, now);
      migrateAdjudicationV3(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(1, MIGRATION_V1_NAME, MIGRATION_V1_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(2, MIGRATION_V2_NAME, MIGRATION_V2_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(3, MIGRATION_V3_NAME, MIGRATION_V3_CHECKSUM, now);
      db.pragma(`application_id = ${SCHEDULER_APPLICATION_ID}`);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (!tables.includes("migrations")) {
    throw schemaError(
      "SCHEDULER_SCHEMA_UNKNOWN",
      "Refusing a non-empty database without scheduler migration history",
      undefined,
      { tables },
    );
  } else if (db.pragma("user_version", { simple: true }) === 1) {
    verifySchema(db, 1);
    const migrate = db.transaction(() => {
      migrateAuthorityV2(db, now);
      migrateAdjudicationV3(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(2, MIGRATION_V2_NAME, MIGRATION_V2_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(3, MIGRATION_V3_NAME, MIGRATION_V3_CHECKSUM, now);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (db.pragma("user_version", { simple: true }) === 2) {
    verifySchema(db, 2);
    const migrate = db.transaction(() => {
      migrateAdjudicationV3(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(3, MIGRATION_V3_NAME, MIGRATION_V3_CHECKSUM, now);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
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
      listOccurrencesByTrigger: db.prepare(
        `SELECT * FROM occurrences
         WHERE job_id = ? AND trigger_key = ?
         ORDER BY created_at ASC, occurrence_id ASC
         LIMIT ?`,
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

  _enqueueOccurrence({ id, scheduled, key, available, payload, now }) {
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
    const payloadJson = canonicalJson(
      payload === undefined ? job.payload : payload,
      "occurrence.payload",
    );
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
        payloadJson,
        now,
      });
    const row = this.statements.getOccurrenceByKey.get(identity.idempotencyKey);
    if (!row || row.occurrence_id !== identity.occurrenceId) {
      throw schemaError(
        "SCHEDULER_DATA_CORRUPT",
        "Occurrence idempotency identity does not match stored data",
      );
    }
    if (row.payload_json !== payloadJson) {
      throw new SchedulerKernelError(
        "SCHEDULER_IDEMPOTENCY_PAYLOAD_MISMATCH",
        "Occurrence idempotency identity was reused with a different payload",
        { jobId: id, triggerKey: key },
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
  }

  enqueueOccurrence({
    jobId,
    scheduledFor,
    triggerKey,
    availableAt,
    payload,
  } = {}) {
    const id = normalizeIdentifier(jobId, "jobId");
    const scheduled = normalizeEpochMs(scheduledFor, "scheduledFor");
    const key = normalizeIdentifier(triggerKey, "triggerKey");
    const available = normalizeEpochMs(availableAt ?? scheduled, "availableAt");
    const now = this._now();
    return this._write(() =>
      this._enqueueOccurrence({ id, scheduled, key, available, payload, now }),
    );
  }

  enqueueOccurrenceOncePerTrigger({
    jobId,
    scheduledFor,
    triggerKey,
    availableAt,
    payload,
  } = {}) {
    const id = normalizeIdentifier(jobId, "jobId");
    const scheduled = normalizeEpochMs(scheduledFor, "scheduledFor");
    const key = normalizeIdentifier(triggerKey, "triggerKey");
    const available = normalizeEpochMs(availableAt ?? scheduled, "availableAt");
    const now = this._now();
    return this._write(() => {
      const prior = this.statements.listOccurrencesByTrigger.all(id, key, 2);
      if (prior.length > 1) {
        throw schemaError(
          "SCHEDULER_DATA_CORRUPT",
          "Multiple occurrences exist for a unique job trigger",
        );
      }
      if (prior.length === 1) {
        return { ...mapOccurrence(prior[0]), deduplicated: true };
      }
      return this._enqueueOccurrence({
        id,
        scheduled,
        key,
        available,
        payload,
        now,
      });
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

  listOccurrencesByTrigger({ jobId, triggerKey, limit = 2 } = {}) {
    this._assertOpen();
    const id = normalizeIdentifier(jobId, "jobId");
    const key = normalizeIdentifier(triggerKey, "triggerKey");
    const boundedLimit = Math.min(
      200,
      Math.max(1, Number.isSafeInteger(Number(limit)) ? Number(limit) : 2),
    );
    return this.statements.listOccurrencesByTrigger
      .all(id, key, boundedLimit)
      .map(mapOccurrence);
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
        const adjudication = this.db
          .prepare(
            `SELECT * FROM scheduler_occurrence_adjudications
             WHERE occurrence_id = ? AND status = 'pending'`,
          )
          .get(row.occurrence_id);
        if (adjudication) {
          const retryOutcome = {
            status: OCCURRENCE_STATUS.DEAD_LETTER,
            error,
          };
          this.db
            .prepare(
              `UPDATE scheduler_occurrence_adjudications
               SET status = 'applied', applied_at = ?, retry_settled_at = ?,
                   retry_outcome_json = ?
               WHERE occurrence_id = ? AND status = 'pending'`,
            )
            .run(
              now,
              now,
              canonicalJson(retryOutcome, "adjudication.retryOutcome"),
              row.occurrence_id,
            );
          this.db
            .prepare(
              `UPDATE scheduler_authority_reservations
               SET status = 'failed', outcome_json = ?, settled_at = ?
               WHERE occurrence_id = ? AND status = 'reserved'`,
            )
            .run(
              canonicalJson(retryOutcome, "authoritySettlement"),
              now,
              row.occurrence_id,
            );
        }
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
            ...(adjudication
              ? { adjudicationRequestId: adjudication.request_id }
              : {}),
          },
        });
      }
    }
  }

  claimNext({ ownerId, leaseMs, jobKind, workspaceId } = {}) {
    const owner = normalizeIdentifier(ownerId, "ownerId");
    const lease = normalizeLeaseMs(leaseMs);
    const kind =
      jobKind === undefined
        ? null
        : normalizeIdentifier(jobKind, "jobKind", { maxLength: 128 });
    const workspace =
      workspaceId === undefined
        ? null
        : normalizeIdentifier(workspaceId, "workspaceId", { maxLength: 256 });
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
            AND (@jobKind IS NULL OR j.kind = @jobKind)
            AND (
              @workspaceId IS NULL
              OR json_extract(j.authority_json, '$.workspaceId') = @workspaceId
            )
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
        .get({ now, jobKind: kind, workspaceId: workspace });
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

  /**
   * Claim one known occurrence without consuming unrelated scheduler work.
   *
   * Command adapters use this after durably enqueueing a user-selected job.
   * Returning `null` means the occurrence exists but is not currently
   * claimable (another live owner holds it, it is not due yet, or it is
   * terminal). A missing occurrence remains a hard error so callers cannot
   * confuse a lost durable enqueue with ordinary contention.
   */
  claimOccurrence({ occurrenceId, ownerId, leaseMs } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const owner = normalizeIdentifier(ownerId, "ownerId");
    const lease = normalizeLeaseMs(leaseMs);
    const now = this._now();
    const leaseExpiresAt = now + lease;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw invalidArgument("lease expiry exceeds the safe integer range");
    }
    return this._write(() => {
      this._deadLetterExpiredLeases(now);
      const candidate = this.statements.getOccurrence.get(id);
      if (!candidate) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence does not exist: ${id}`,
        );
      }
      const job = this.statements.getJob.get(candidate.job_id);
      const eligible =
        job?.enabled === 1 &&
        candidate.attempt < candidate.max_attempts &&
        (([OCCURRENCE_STATUS.QUEUED, OCCURRENCE_STATUS.RETRY_WAIT].includes(
          candidate.status,
        ) &&
          candidate.available_at <= now) ||
          (candidate.status === OCCURRENCE_STATUS.RUNNING &&
            candidate.lease_expires_at <= now));
      if (!eligible) return null;

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
          occurrenceId: id,
          expectedFence: candidate.fence,
          ownerId: owner,
          leaseExpiresAt,
          now,
        });
      if (result.changes !== 1) {
        throw new SchedulerKernelError(
          "SCHEDULER_CLAIM_CONFLICT",
          "Occurrence eligibility changed during targeted claim",
        );
      }
      const claimed = this.statements.getOccurrence.get(id);
      this._appendEvent({
        jobId: candidate.job_id,
        occurrenceId: id,
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
          targeted: true,
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
    adjudicationRequestId,
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
    const adjudicationRequest =
      adjudicationRequestId === undefined
        ? null
        : normalizeIdentifier(adjudicationRequestId, "adjudicationRequestId", {
            maxLength: 128,
          });

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
      const reservation = this.db
        .prepare(
          `SELECT * FROM scheduler_authority_reservations
           WHERE occurrence_id = ?`,
        )
        .get(id);
      if (
        reservation?.status === "reserved" &&
        (nextStatus === OCCURRENCE_STATUS.SUCCEEDED ||
          nextStatus === OCCURRENCE_STATUS.DEAD_LETTER)
      ) {
        const authorityOutcome =
          nextStatus === OCCURRENCE_STATUS.SUCCEEDED ? "succeeded" : "failed";
        const authorityResult =
          authorityOutcome === "succeeded"
            ? { status: nextStatus, result: normalizedResult }
            : { status: nextStatus, error: normalizedError };
        const authorityUpdate = this.db
          .prepare(
            `UPDATE scheduler_authority_reservations
             SET status = ?, outcome_json = ?, settled_at = ?
             WHERE occurrence_id = ? AND status = 'reserved'`,
          )
          .run(
            authorityOutcome,
            canonicalJson(authorityResult, "authoritySettlement"),
            now,
            id,
          );
        if (authorityUpdate.changes !== 1) {
          throw new SchedulerKernelError(
            "SCHEDULER_AUTHORITY_SETTLEMENT_CONFLICT",
            `Scheduler authority reservation could not be settled: ${id}`,
          );
        }
      }
      const adjudication = this.db
        .prepare(
          `SELECT * FROM scheduler_occurrence_adjudications
           WHERE occurrence_id = ?`,
        )
        .get(id);
      if (
        adjudicationRequest !== null &&
        adjudication?.status === "pending" &&
        adjudication.request_id !== adjudicationRequest
      ) {
        throw new SchedulerKernelError(
          "SCHEDULER_ADJUDICATION_SETTLEMENT_CONFLICT",
          `Scheduler adjudication request does not match settlement: ${id}`,
        );
      }
      if (
        adjudication?.status === "pending" &&
        (nextStatus === OCCURRENCE_STATUS.SUCCEEDED ||
          nextStatus === OCCURRENCE_STATUS.DEAD_LETTER)
      ) {
        const retryOutcome =
          nextStatus === OCCURRENCE_STATUS.SUCCEEDED
            ? { status: nextStatus, result: normalizedResult }
            : { status: nextStatus, error: normalizedError };
        const adjudicationUpdate = this.db
          .prepare(
            `UPDATE scheduler_occurrence_adjudications
             SET status = 'applied', applied_at = ?, retry_settled_at = ?,
                 retry_outcome_json = ?
             WHERE occurrence_id = ? AND status = 'pending'`,
          )
          .run(
            now,
            now,
            canonicalJson(retryOutcome, "adjudication.retryOutcome"),
            id,
          );
        if (adjudicationUpdate.changes !== 1) {
          throw new SchedulerKernelError(
            "SCHEDULER_ADJUDICATION_SETTLEMENT_CONFLICT",
            `Scheduler adjudication could not be settled: ${id}`,
          );
        }
      }
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
          ...(reservation
            ? {
                authorityPolicyRevision: reservation.policy_revision,
                authorityUnits: reservation.units,
              }
            : {}),
          ...(nextStatus === OCCURRENCE_STATUS.RETRY_WAIT
            ? { retryAt: nextAvailableAt }
            : {}),
          ...(adjudication?.status === "pending"
            ? { adjudicationRequestId: adjudication.request_id }
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

  _adjudicationCase(occurrenceId) {
    const row = this.statements.getOccurrence.get(occurrenceId);
    if (!row) return null;
    const occurrence = mapOccurrence(row);
    const reservation = mapAuthorityReservation(
      this.db
        .prepare(
          `SELECT * FROM scheduler_authority_reservations
           WHERE occurrence_id = ?`,
        )
        .get(occurrenceId),
    );
    const adjudication = mapAdjudication(
      this.db
        .prepare(
          `SELECT * FROM scheduler_occurrence_adjudications
           WHERE occurrence_id = ?`,
        )
        .get(occurrenceId),
    );
    const eligible =
      occurrence.status === OCCURRENCE_STATUS.DEAD_LETTER &&
      isOutcomeUnknownError(occurrence.lastError) &&
      adjudication === null;
    const evidenceDigest = eligible
      ? sha256PayloadDigest(
          adjudicationEvidence(occurrence, reservation),
          "adjudication.evidence",
        )
      : (adjudication?.evidenceDigest ?? null);
    return {
      occurrenceId: occurrence.id,
      jobId: occurrence.jobId,
      status: occurrence.status,
      attempt: occurrence.attempt,
      maxAttempts: occurrence.maxAttempts,
      fence: occurrence.fence,
      settledAt: occurrence.settledAt,
      errorCode:
        typeof occurrence.lastError?.code === "string"
          ? occurrence.lastError.code
          : null,
      authorityPrincipal: occurrence.authority.principal,
      reservation:
        reservation === null
          ? null
          : {
              policyRevision: reservation.policyRevision,
              units: reservation.units,
              status: reservation.status,
            },
      eligible,
      evidenceDigest,
      adjudication,
    };
  }

  getAdjudicationCase(occurrenceId) {
    this._assertOpen();
    return this._adjudicationCase(
      normalizeIdentifier(occurrenceId, "occurrenceId"),
    );
  }

  listAdjudicationCases({ limit } = {}) {
    this._assertOpen();
    const boundedLimit = normalizeHistoryLimit(limit);
    return this.db
      .prepare(
        `SELECT o.occurrence_id
         FROM occurrences o
         LEFT JOIN scheduler_occurrence_adjudications a
           ON a.occurrence_id = o.occurrence_id
         WHERE o.status = 'dead_letter'
           AND a.occurrence_id IS NULL
           AND json_extract(o.last_error_json, '$.code') GLOB '*_OUTCOME_UNKNOWN'
         ORDER BY o.settled_at DESC, o.occurrence_id
         LIMIT 1000`,
      )
      .all()
      .map((row) => this._adjudicationCase(row.occurrence_id))
      .filter((entry) => entry.eligible)
      .slice(0, boundedLimit);
  }

  getOccurrenceAdjudication(occurrenceId) {
    this._assertOpen();
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    return mapAdjudication(
      this.db
        .prepare(
          `SELECT * FROM scheduler_occurrence_adjudications
           WHERE occurrence_id = ?`,
        )
        .get(id),
    );
  }

  adjudicateOccurrence({
    occurrenceId,
    decision,
    expectedEvidenceDigest,
    expectedAttempt,
    expectedFence,
    reasonDigest,
    operatorDigest,
  } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const normalizedDecision = normalizeAdjudicationDecision(decision);
    const evidenceDigest = normalizeSha256Digest(
      expectedEvidenceDigest,
      "expectedEvidenceDigest",
    );
    const reason = normalizeSha256Digest(reasonDigest, "reasonDigest");
    const operator = normalizeSha256Digest(operatorDigest, "operatorDigest");
    const attempt = assertPositiveSafeInteger(
      expectedAttempt,
      "expectedAttempt",
    );
    const fence = assertPositiveSafeInteger(expectedFence, "expectedFence");
    const now = this._now();
    return this._write(() => {
      const adjudicationCase = this._adjudicationCase(id);
      if (!adjudicationCase) {
        throw schedulerAdjudicationError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence does not exist: ${id}`,
        );
      }
      if (adjudicationCase.adjudication) {
        throw schedulerAdjudicationError(
          "SCHEDULER_ADJUDICATION_ALREADY_RECORDED",
          `Scheduler occurrence already has a monotonic adjudication: ${id}`,
          { requestId: adjudicationCase.adjudication.requestId },
        );
      }
      if (!adjudicationCase.eligible) {
        throw schedulerAdjudicationError(
          "SCHEDULER_ADJUDICATION_NOT_ELIGIBLE",
          `Scheduler occurrence is not an outcome-unknown dead letter: ${id}`,
          {
            status: adjudicationCase.status,
            errorCode: adjudicationCase.errorCode,
          },
        );
      }
      if (
        adjudicationCase.evidenceDigest !== evidenceDigest ||
        adjudicationCase.attempt !== attempt ||
        adjudicationCase.fence !== fence
      ) {
        throw schedulerAdjudicationError(
          "SCHEDULER_ADJUDICATION_EVIDENCE_CONFLICT",
          `Scheduler adjudication evidence changed: ${id}`,
          {
            actualEvidenceDigest: adjudicationCase.evidenceDigest,
            actualAttempt: adjudicationCase.attempt,
            actualFence: adjudicationCase.fence,
          },
        );
      }
      const grantedMaxAttempts =
        normalizedDecision ===
        SCHEDULER_ADJUDICATION_DECISIONS.CONFIRMED_APPLIED
          ? attempt + 2
          : attempt + 1;
      if (grantedMaxAttempts > 32) {
        throw schedulerAdjudicationError(
          "SCHEDULER_ADJUDICATION_ATTEMPT_LIMIT",
          `Scheduler occurrence cannot receive a bounded adjudication claim: ${id}`,
        );
      }
      const requestId = deterministicAdjudicationRequestId({
        occurrenceId: id,
        decision: normalizedDecision,
        evidenceDigest,
        reasonDigest: reason,
      });
      this.db
        .prepare(
          `INSERT INTO scheduler_occurrence_adjudications
             (occurrence_id, job_id, request_id, decision, authority,
              evidence_digest, expected_attempt, expected_fence,
              reason_digest, operator_digest, status, created_at, applied_at,
              retry_settled_at, retry_outcome_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL)`,
        )
        .run(
          id,
          adjudicationCase.jobId,
          requestId,
          normalizedDecision,
          SCHEDULER_ADJUDICATION_AUTHORITY,
          evidenceDigest,
          attempt,
          fence,
          reason,
          operator,
          now,
        );
      const update = this.db
        .prepare(
          `UPDATE occurrences
           SET status = 'retry_wait',
               available_at = ?,
               max_attempts = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               result_json = NULL,
               updated_at = ?,
               settled_at = NULL
           WHERE occurrence_id = ?
             AND status = 'dead_letter'
             AND attempt = ?
             AND fence = ?`,
        )
        .run(now, grantedMaxAttempts, now, id, attempt, fence);
      if (update.changes !== 1) {
        throw schedulerAdjudicationError(
          "SCHEDULER_ADJUDICATION_EVIDENCE_CONFLICT",
          `Scheduler occurrence changed during adjudication: ${id}`,
        );
      }
      this.db
        .prepare(
          `UPDATE scheduler_authority_reservations
           SET status = 'reserved', outcome_json = NULL, settled_at = NULL
           WHERE occurrence_id = ? AND status = 'failed'`,
        )
        .run(id);
      this._appendEvent({
        jobId: adjudicationCase.jobId,
        occurrenceId: id,
        type: "occurrence_adjudication_recorded",
        occurredAt: now,
        fence,
        data: {
          requestId,
          decision: normalizedDecision,
          authority: SCHEDULER_ADJUDICATION_AUTHORITY,
          evidenceDigest,
          expectedAttempt: attempt,
          expectedFence: fence,
          reasonDigest: reason,
          operatorDigest: operator,
          retryAttempt: attempt + 1,
          maxAttempts: grantedMaxAttempts,
        },
      });
      return this._adjudicationCase(id);
    });
  }

  setAuthorityPolicy(
    principal,
    {
      capabilities,
      windowMs,
      maxRuns,
      maxUnits,
      enabled = true,
      expectedRevision,
    } = {},
  ) {
    const actor = normalizeAuthorityPrincipal(principal);
    const allowedCapabilities = normalizeCapabilityList(capabilities);
    const window = normalizeAuthorityBudgetLimit(windowMs, "windowMs", {
      minimum: MIN_AUTHORITY_WINDOW_MS,
      maximum: MAX_AUTHORITY_WINDOW_MS,
    });
    const runs = normalizeAuthorityBudgetLimit(maxRuns, "maxRuns");
    const units = normalizeAuthorityBudgetLimit(maxUnits, "maxUnits");
    const active = normalizeBoolean(enabled, "enabled");
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      throw invalidArgument("expectedRevision must be an integer >= 0");
    }
    const now = this._now();
    return this._write(() => {
      const current = this.db
        .prepare(
          `SELECT * FROM scheduler_authority_policies
           WHERE principal_type = ? AND principal_id = ?`,
        )
        .get(actor.type, actor.id);
      const currentRevision = current?.revision ?? 0;
      if (
        expectedRevision !== undefined &&
        expectedRevision !== currentRevision
      ) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_POLICY_CONFLICT",
          "Scheduler authority policy revision does not match",
          { expectedRevision, actualRevision: currentRevision },
        );
      }
      const revision = currentRevision + 1;
      this.db
        .prepare(
          `INSERT INTO scheduler_authority_policies
             (principal_type, principal_id, revision, enabled,
              capabilities_json, window_ms, max_runs, max_units,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(principal_type, principal_id) DO UPDATE SET
             revision = excluded.revision,
             enabled = excluded.enabled,
             capabilities_json = excluded.capabilities_json,
             window_ms = excluded.window_ms,
             max_runs = excluded.max_runs,
             max_units = excluded.max_units,
             updated_at = excluded.updated_at`,
        )
        .run(
          actor.type,
          actor.id,
          revision,
          active ? 1 : 0,
          canonicalJson(allowedCapabilities, "authorityPolicy.capabilities"),
          window,
          runs,
          units,
          current?.created_at ?? now,
          now,
        );
      return this.getAuthorityPolicy(actor);
    });
  }

  getAuthorityPolicy(principal) {
    this._assertOpen();
    const actor = normalizeAuthorityPrincipal(principal);
    return mapAuthorityPolicy(
      this.db
        .prepare(
          `SELECT * FROM scheduler_authority_policies
           WHERE principal_type = ? AND principal_id = ?`,
        )
        .get(actor.type, actor.id),
    );
  }

  ensureAuthorityPolicy(
    authority,
    {
      windowMs = DEFAULT_AUTHORITY_WINDOW_MS,
      maxRuns = DEFAULT_AUTHORITY_MAX_RUNS,
      maxUnits = DEFAULT_AUTHORITY_MAX_UNITS,
    } = {},
  ) {
    const normalized = normalizeAuthorityEnvelope(authority);
    const current = this.getAuthorityPolicy(normalized.principal);
    if (current) return current;
    try {
      return this.setAuthorityPolicy(normalized.principal, {
        capabilities: normalized.requestedCapabilities,
        windowMs,
        maxRuns,
        maxUnits,
        expectedRevision: 0,
      });
    } catch (error) {
      if (error?.code !== "SCHEDULER_AUTHORITY_POLICY_CONFLICT") throw error;
      const raced = this.getAuthorityPolicy(normalized.principal);
      if (raced) return raced;
      throw error;
    }
  }

  getAuthorityReservation(occurrenceId) {
    this._assertOpen();
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    return mapAuthorityReservation(
      this.db
        .prepare(
          `SELECT * FROM scheduler_authority_reservations
           WHERE occurrence_id = ?`,
        )
        .get(id),
    );
  }

  reserveAuthority({ occurrenceId, policyRevision, units = 1 } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const expectedPolicyRevision = normalizeAuthorityBudgetLimit(
      policyRevision,
      "policyRevision",
      { maximum: Number.MAX_SAFE_INTEGER },
    );
    const requestedUnits = normalizeAuthorityBudgetLimit(units, "units");
    const now = this._now();
    return this._write(() => {
      const occurrence = mapOccurrence(this.statements.getOccurrence.get(id));
      if (!occurrence) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence does not exist: ${id}`,
        );
      }
      if (occurrence.status !== OCCURRENCE_STATUS.RUNNING) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_OCCURRENCE_NOT_RUNNING",
          `Scheduler authority may only reserve a running occurrence: ${id}`,
        );
      }
      const existing = this.db
        .prepare(
          `SELECT * FROM scheduler_authority_reservations
           WHERE occurrence_id = ?`,
        )
        .get(id);
      if (existing) {
        const reservation = mapAuthorityReservation(existing);
        if (
          reservation.jobId !== occurrence.jobId ||
          reservation.principal.type !== occurrence.authority.principal.type ||
          reservation.principal.id !== occurrence.authority.principal.id ||
          reservation.policyRevision !== expectedPolicyRevision ||
          reservation.units !== requestedUnits
        ) {
          throw new SchedulerKernelError(
            "SCHEDULER_AUTHORITY_RESERVATION_MISMATCH",
            `Scheduler authority reservation identity is mismatched: ${id}`,
          );
        }
        return { ...reservation, deduplicated: true };
      }
      const principal = occurrence.authority.principal;
      const policyRow = this.db
        .prepare(
          `SELECT * FROM scheduler_authority_policies
           WHERE principal_type = ? AND principal_id = ?`,
        )
        .get(principal.type, principal.id);
      const policy = mapAuthorityPolicy(policyRow);
      if (!policy || !policy.enabled) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_POLICY_REQUIRED",
          `Scheduler authority policy is missing or disabled: ${principal.type}:${principal.id}`,
        );
      }
      if (policy.revision !== expectedPolicyRevision) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_POLICY_STALE",
          `Scheduler authority policy changed before reservation: ${principal.type}:${principal.id}`,
          {
            expectedRevision: expectedPolicyRevision,
            actualRevision: policy.revision,
          },
        );
      }
      const denied = occurrence.authority.requestedCapabilities.filter(
        (capability) =>
          !policy.capabilities.includes("*") &&
          !policy.capabilities.includes(capability),
      );
      if (denied.length > 0) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_PERMISSION_DENIED",
          `Scheduler authority capability was denied: ${principal.type}:${principal.id}`,
          { denied },
        );
      }
      const windowStartedAt =
        Math.floor(now / policy.windowMs) * policy.windowMs;
      const usage = this.db
        .prepare(
          `SELECT runs, units FROM scheduler_authority_usage
           WHERE principal_type = ? AND principal_id = ?
             AND policy_revision = ? AND window_started_at = ?`,
        )
        .get(
          principal.type,
          principal.id,
          policy.revision,
          windowStartedAt,
        ) ?? { runs: 0, units: 0 };
      const reservations = this.db
        .prepare(
          `SELECT COUNT(*) AS runs, COALESCE(SUM(units), 0) AS units
           FROM scheduler_authority_reservations
           WHERE principal_type = ? AND principal_id = ?
             AND policy_revision = ? AND window_started_at = ?`,
        )
        .get(principal.type, principal.id, policy.revision, windowStartedAt);
      if (
        reservations.runs !== usage.runs ||
        reservations.units !== usage.units
      ) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_BUDGET_STATE_INVALID",
          `Scheduler authority usage does not match reservations: ${principal.type}:${principal.id}`,
          { usage, reservations },
        );
      }
      const nextRuns = usage.runs + 1;
      const nextUnits = usage.units + requestedUnits;
      if (nextRuns > policy.maxRuns || nextUnits > policy.maxUnits) {
        throw new SchedulerKernelError(
          "SCHEDULER_AUTHORITY_BUDGET_EXHAUSTED",
          `Scheduler authority budget is exhausted: ${principal.type}:${principal.id}`,
          {
            windowStartedAt,
            windowEndsAt: windowStartedAt + policy.windowMs,
            usedRuns: usage.runs,
            usedUnits: usage.units,
            requestedUnits,
            maxRuns: policy.maxRuns,
            maxUnits: policy.maxUnits,
          },
        );
      }
      this.db
        .prepare(
          `INSERT INTO scheduler_authority_usage
             (principal_type, principal_id, policy_revision,
              window_started_at, runs, units, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(principal_type, principal_id, policy_revision,
                       window_started_at) DO UPDATE SET
             runs = excluded.runs,
             units = excluded.units,
             updated_at = excluded.updated_at`,
        )
        .run(
          principal.type,
          principal.id,
          policy.revision,
          windowStartedAt,
          nextRuns,
          nextUnits,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO scheduler_authority_reservations
             (occurrence_id, job_id, principal_type, principal_id,
              policy_revision, window_started_at, units, status,
              outcome_json, created_at, settled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', NULL, ?, NULL)`,
        )
        .run(
          id,
          occurrence.jobId,
          principal.type,
          principal.id,
          policy.revision,
          windowStartedAt,
          requestedUnits,
          now,
        );
      return {
        ...this.getAuthorityReservation(id),
        deduplicated: false,
      };
    });
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
