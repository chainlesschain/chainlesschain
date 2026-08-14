import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import {
  OCCURRENCE_STATUS,
  RUNTIME_CONTROL_SAFE_POINTS,
  RUNTIME_PAUSE_RESUME,
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
  normalizeRuntimeControlCapability,
} from "./contract.js";
import { isCanonicalSchedulerSourcePath } from "./source-locator-path.js";

const requireCjs = createRequire(import.meta.url);

const STORAGE_FAILURE_CODES = Object.freeze([
  "ENOSPC",
  "EROFS",
  "EIO",
  "SQLITE_FULL",
  "SQLITE_IOERR",
  "SQLITE_READONLY",
]);
const STORAGE_FAILURE_CODE_SET = new Set(STORAGE_FAILURE_CODES);

export const SCHEDULER_APPLICATION_ID = 0x4343534b; // "CCSK"
export const SCHEDULER_STORE_SCHEMA_VERSION = 6;
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
export const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;
export const MIN_AUTHORITY_WINDOW_MS = 60_000;
export const MAX_AUTHORITY_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
export const MAX_AUTHORITY_BUDGET = 1_000_000;
export const MAX_RUNTIME_CHECKPOINT_BYTES = 64 * 1024;
export const DEFAULT_AUTHORITY_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_AUTHORITY_MAX_RUNS = 100_000;
export const DEFAULT_AUTHORITY_MAX_UNITS = 100_000;
export const MAX_RUNTIME_CONTROL_OCCURRENCES = 200;
export const RUNTIME_CONTROL_OCCURRENCE_STATUSES = Object.freeze([
  "running",
  "pause_requested",
  "paused",
]);
export const RUNTIME_CONTROL_JOB_KINDS = Object.freeze([
  "agenda",
  "automation",
  "automation-event",
  "cowork-cron",
  "loop-iteration",
  "routine",
]);
const RUNTIME_CONTROL_OCCURRENCE_STATUS_SET = new Set(
  RUNTIME_CONTROL_OCCURRENCE_STATUSES,
);
const RUNTIME_CONTROL_JOB_KIND_SET = new Set(RUNTIME_CONTROL_JOB_KINDS);
export const SCHEDULER_ADJUDICATION_AUTHORITY = "local-operator";
export const SCHEDULER_ADJUDICATION_DECISIONS = Object.freeze({
  CONFIRMED_APPLIED: "confirmed_applied",
  CONFIRMED_NOT_APPLIED: "confirmed_not_applied",
});
export const SCHEDULER_MIGRATION_DOMAINS = Object.freeze([
  "agenda",
  "cowork-cron",
  "routine",
  "automation",
  "loop-iteration",
]);
export const SCHEDULER_MIGRATION_STATES = Object.freeze({
  PREPARED: "prepared",
  APPLIED: "applied",
  VERIFIED: "verified",
  RETIRING: "retiring",
  RETIRED: "retired",
  ROLLING_BACK: "rolling_back",
  ROLLED_BACK: "rolled_back",
});

const MIGRATION_V1_NAME = "scheduler-kernel-v1";
const MIGRATION_V2_NAME = "scheduler-kernel-authority-v2";
const MIGRATION_V3_NAME = "scheduler-kernel-adjudication-v3";
const MIGRATION_V4_NAME = "scheduler-kernel-domain-migration-v4";
const MIGRATION_V5_NAME = "scheduler-kernel-source-locator-v5";
const MIGRATION_V6_NAME = "scheduler-kernel-runtime-control-v6";
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
const V3_USER_TABLES = Object.freeze([
  ...V2_USER_TABLES,
  "scheduler_occurrence_adjudications",
]);
const V4_V5_USER_TABLES = Object.freeze([
  ...V2_USER_TABLES,
  "scheduler_domain_migration_entries",
  "scheduler_domain_migrations",
  "scheduler_occurrence_adjudications",
]);
const USER_TABLES = Object.freeze([
  ...V4_V5_USER_TABLES,
  "scheduler_occurrence_controls",
  "scheduler_occurrence_retries",
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

export const MIGRATION_V4_SQL = `
CREATE TABLE scheduler_domain_migrations (
  migration_id       TEXT PRIMARY KEY NOT NULL,
  manifest_digest    TEXT NOT NULL UNIQUE,
  manifest_json      TEXT NOT NULL CHECK (json_valid(manifest_json)),
  state              TEXT NOT NULL CHECK (
    state IN (
      'prepared', 'applied', 'verified', 'retiring', 'retired',
      'rolling_back', 'rolled_back'
    )
  ),
  entry_count        INTEGER NOT NULL CHECK (entry_count BETWEEN 1 AND 1000),
  created_at         INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at         INTEGER NOT NULL CHECK (updated_at >= 0),
  completed_at       INTEGER,
  last_error_json    TEXT CHECK (
    last_error_json IS NULL OR json_valid(last_error_json)
  ),
  CHECK (
    (state IN ('retired', 'rolled_back') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('retired', 'rolled_back') AND completed_at IS NULL)
  )
);

CREATE TABLE scheduler_domain_migration_entries (
  migration_id                  TEXT NOT NULL
                                REFERENCES scheduler_domain_migrations(migration_id)
                                ON DELETE RESTRICT,
  entry_id                      TEXT NOT NULL,
  domain                        TEXT NOT NULL CHECK (
    domain IN ('agenda', 'cowork-cron', 'routine', 'automation', 'loop-iteration')
  ),
  source_id                     TEXT NOT NULL,
  source_scope_digest           TEXT NOT NULL,
  source_digest                 TEXT NOT NULL,
  target_job_id                 TEXT NOT NULL,
  target_job_digest             TEXT NOT NULL,
  rollback_strategy             TEXT NOT NULL CHECK (
    rollback_strategy IN ('restore', 'disable')
  ),
  state                         TEXT NOT NULL CHECK (
    state IN (
      'prepared', 'applied', 'verified', 'retiring', 'retired',
      'rollback_target_disabled', 'source_restored', 'rolled_back'
    )
  ),
  target_action                 TEXT CHECK (
    target_action IS NULL OR target_action IN ('created', 'updated', 'reused')
  ),
  target_before_json            TEXT CHECK (
    target_before_json IS NULL OR json_valid(target_before_json)
  ),
  target_applied_revision       INTEGER CHECK (target_applied_revision >= 1),
  target_applied_at             INTEGER CHECK (target_applied_at >= 0),
  target_occurrence_count_before INTEGER CHECK (
    target_occurrence_count_before >= 0
  ),
  target_execution_event_count_before INTEGER CHECK (
    target_execution_event_count_before >= 0
  ),
  target_rollback_revision      INTEGER CHECK (target_rollback_revision >= 1),
  retirement_token             TEXT,
  source_retirement_digest     TEXT,
  source_restored_digest       TEXT,
  created_at                    INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at                    INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (migration_id, entry_id),
  UNIQUE (migration_id, domain, source_scope_digest, source_id),
  UNIQUE (migration_id, target_job_id),
  CHECK (
    (state = 'prepared' AND target_action IS NULL
      AND target_applied_revision IS NULL AND target_applied_at IS NULL
      AND target_occurrence_count_before IS NULL
      AND target_execution_event_count_before IS NULL)
    OR
    (state <> 'prepared' AND state <> 'rolled_back'
      AND target_action IS NOT NULL AND target_applied_revision IS NOT NULL
      AND target_applied_at IS NOT NULL
      AND target_occurrence_count_before IS NOT NULL
      AND target_execution_event_count_before IS NOT NULL)
    OR
    (state = 'rolled_back')
  ),
  CHECK (
    (target_action IN ('updated', 'reused') AND target_before_json IS NOT NULL)
    OR
    (target_action = 'created' AND target_before_json IS NULL)
    OR
    (target_action IS NULL AND target_before_json IS NULL)
  ),
  CHECK (
    state NOT IN ('retiring', 'retired')
    OR retirement_token IS NOT NULL
  ),
  CHECK (
    state <> 'retired'
    OR source_retirement_digest IS NOT NULL
  )
);

CREATE INDEX scheduler_domain_migrations_state
  ON scheduler_domain_migrations(state, updated_at, migration_id);
CREATE INDEX scheduler_domain_migration_entries_state
  ON scheduler_domain_migration_entries(state, updated_at, migration_id, entry_id);
CREATE UNIQUE INDEX scheduler_domain_migration_active_source
  ON scheduler_domain_migration_entries(domain, source_scope_digest, source_id)
  WHERE state <> 'rolled_back';
CREATE UNIQUE INDEX scheduler_domain_migration_active_target
  ON scheduler_domain_migration_entries(target_job_id)
  WHERE state <> 'rolled_back';
`;

export const MIGRATION_V4_CHECKSUM = createHash("sha256")
  .update(MIGRATION_V4_SQL.trim().replace(/\r\n/g, "\n"), "utf8")
  .digest("hex");

export const MIGRATION_V5_SQL = `
ALTER TABLE scheduler_domain_migration_entries
  ADD COLUMN source_locator_json TEXT CHECK (
    source_locator_json IS NULL OR json_valid(source_locator_json)
  );
`;

export const MIGRATION_V5_CHECKSUM = createHash("sha256")
  .update(MIGRATION_V5_SQL.trim().replace(/\r\n/g, "\n"), "utf8")
  .digest("hex");

export const MIGRATION_V6_SQL = `
CREATE TABLE scheduler_occurrence_controls (
  occurrence_id       TEXT PRIMARY KEY NOT NULL
                      REFERENCES occurrences(occurrence_id) ON DELETE RESTRICT,
  capability_json     TEXT NOT NULL CHECK (json_valid(capability_json)),
  capability_digest   TEXT NOT NULL CHECK (
    capability_digest GLOB 'sha256:[0-9a-f]*'
    AND length(capability_digest) = 71
  ),
  state                TEXT NOT NULL CHECK (
    state IN ('pause_requested', 'paused', 'resumed', 'terminal')
  ),
  revision             INTEGER NOT NULL CHECK (revision >= 1),
  pause_request_id     TEXT NOT NULL,
  resume_request_id    TEXT UNIQUE,
  expected_fence       INTEGER NOT NULL CHECK (expected_fence >= 1),
  checkpoint_json      TEXT CHECK (
    checkpoint_json IS NULL OR json_valid(checkpoint_json)
  ),
  requested_at         INTEGER NOT NULL CHECK (requested_at >= 0),
  paused_at            INTEGER CHECK (paused_at >= 0),
  resumed_at           INTEGER CHECK (resumed_at >= 0),
  terminal_at          INTEGER CHECK (terminal_at >= 0),
  updated_at           INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (
    (state = 'pause_requested' AND paused_at IS NULL
      AND resumed_at IS NULL AND terminal_at IS NULL)
    OR
    (state = 'paused' AND paused_at IS NOT NULL
      AND resumed_at IS NULL AND terminal_at IS NULL)
    OR
    (state = 'resumed' AND paused_at IS NOT NULL
      AND resumed_at IS NOT NULL AND terminal_at IS NULL)
    OR
    (state = 'terminal' AND terminal_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX scheduler_occurrence_controls_pause_request
  ON scheduler_occurrence_controls(pause_request_id);
CREATE INDEX scheduler_occurrence_controls_state
  ON scheduler_occurrence_controls(state, updated_at, occurrence_id);

CREATE TABLE scheduler_occurrence_retries (
  occurrence_id       TEXT NOT NULL
                      REFERENCES occurrences(occurrence_id) ON DELETE RESTRICT,
  request_id           TEXT NOT NULL UNIQUE,
  expected_fence       INTEGER NOT NULL CHECK (expected_fence >= 1),
  expected_error_code  TEXT NOT NULL,
  created_at           INTEGER NOT NULL CHECK (created_at >= 0),
  claimed_at           INTEGER CHECK (claimed_at >= 0),
  PRIMARY KEY (occurrence_id, request_id)
);

CREATE INDEX scheduler_occurrence_retries_pending
  ON scheduler_occurrence_retries(occurrence_id, claimed_at, expected_fence);
`;

export const MIGRATION_V6_CHECKSUM = createHash("sha256")
  .update(MIGRATION_V6_SQL.trim().replace(/\r\n/g, "\n"), "utf8")
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
export const SCHEMA_V4_FINGERPRINT =
  "59762b9d5da862b857edb76021ed51d05a256133dce543a3fd7d7b0403c9c081";
export const SCHEMA_V5_FINGERPRINT =
  "9619647628488fc4fdc79ad36b4b6632d8257f40c23245822a18941870c187ac";
export const SCHEMA_V6_FINGERPRINT =
  "6abe5595ba3f772c9643440b27d18d5d40057c85523ecb3b4986b195d67787c2";

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
  scheduler_occurrence_controls: [
    ["occurrence_id", "TEXT", 1, 1],
    ["capability_json", "TEXT", 1, 0],
    ["capability_digest", "TEXT", 1, 0],
    ["state", "TEXT", 1, 0],
    ["revision", "INTEGER", 1, 0],
    ["pause_request_id", "TEXT", 1, 0],
    ["resume_request_id", "TEXT", 0, 0],
    ["expected_fence", "INTEGER", 1, 0],
    ["checkpoint_json", "TEXT", 0, 0],
    ["requested_at", "INTEGER", 1, 0],
    ["paused_at", "INTEGER", 0, 0],
    ["resumed_at", "INTEGER", 0, 0],
    ["terminal_at", "INTEGER", 0, 0],
    ["updated_at", "INTEGER", 1, 0],
  ],
  scheduler_occurrence_retries: [
    ["occurrence_id", "TEXT", 1, 1],
    ["request_id", "TEXT", 1, 2],
    ["expected_fence", "INTEGER", 1, 0],
    ["expected_error_code", "TEXT", 1, 0],
    ["created_at", "INTEGER", 1, 0],
    ["claimed_at", "INTEGER", 0, 0],
  ],
  scheduler_domain_migrations: [
    ["migration_id", "TEXT", 1, 1],
    ["manifest_digest", "TEXT", 1, 0],
    ["manifest_json", "TEXT", 1, 0],
    ["state", "TEXT", 1, 0],
    ["entry_count", "INTEGER", 1, 0],
    ["created_at", "INTEGER", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
    ["completed_at", "INTEGER", 0, 0],
    ["last_error_json", "TEXT", 0, 0],
  ],
  scheduler_domain_migration_entries: [
    ["migration_id", "TEXT", 1, 1],
    ["entry_id", "TEXT", 1, 2],
    ["domain", "TEXT", 1, 0],
    ["source_id", "TEXT", 1, 0],
    ["source_scope_digest", "TEXT", 1, 0],
    ["source_digest", "TEXT", 1, 0],
    ["target_job_id", "TEXT", 1, 0],
    ["target_job_digest", "TEXT", 1, 0],
    ["rollback_strategy", "TEXT", 1, 0],
    ["state", "TEXT", 1, 0],
    ["target_action", "TEXT", 0, 0],
    ["target_before_json", "TEXT", 0, 0],
    ["target_applied_revision", "INTEGER", 0, 0],
    ["target_applied_at", "INTEGER", 0, 0],
    ["target_occurrence_count_before", "INTEGER", 0, 0],
    ["target_execution_event_count_before", "INTEGER", 0, 0],
    ["target_rollback_revision", "INTEGER", 0, 0],
    ["retirement_token", "TEXT", 0, 0],
    ["source_retirement_digest", "TEXT", 0, 0],
    ["source_restored_digest", "TEXT", 0, 0],
    ["created_at", "INTEGER", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
    ["source_locator_json", "TEXT", 0, 0],
  ],
});

const EXPECTED_INDEXES = Object.freeze([
  "scheduler_adjudications_status",
  "scheduler_authority_reservations_principal",
  "scheduler_authority_reservations_status",
  "scheduler_domain_migration_active_source",
  "scheduler_domain_migration_active_target",
  "scheduler_domain_migration_entries_state",
  "scheduler_domain_migrations_state",
  "scheduler_events_job",
  "scheduler_events_occurrence",
  "scheduler_occurrence_controls_pause_request",
  "scheduler_occurrence_controls_state",
  "scheduler_occurrence_retries_pending",
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

function normalizedStorageFailureCode(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toUpperCase();
  if (STORAGE_FAILURE_CODE_SET.has(candidate)) return candidate;
  return (
    STORAGE_FAILURE_CODES.find((code) => candidate.startsWith(`${code}_`)) ||
    null
  );
}

function findStorageFailureCode(error) {
  const visited = new Set();
  let current = error;
  while (
    current !== null &&
    (typeof current === "object" || typeof current === "function") &&
    !visited.has(current)
  ) {
    visited.add(current);
    const code = normalizedStorageFailureCode(current.code);
    if (code) return code;
    current = current.cause;
  }
  return null;
}

function storageUnavailableError({ phase, storageCode, commitState }) {
  return new SchedulerKernelError(
    "SCHEDULER_STORAGE_UNAVAILABLE",
    "Scheduler storage is unavailable",
    {
      phase,
      storageCode,
      commitState,
      retryable: false,
    },
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

function mapRuntimeControlOccurrence(row) {
  if (!row) return null;
  return {
    id: row.occurrence_id,
    jobId: row.job_id,
    jobKind: row.job_kind,
    runtimeStatus: row.runtime_status,
    occurrenceStatus: row.occurrence_status,
    scheduledFor: row.scheduled_for,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    fence: row.fence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    control:
      row.control_state === null
        ? null
        : {
            state: row.control_state,
            revision: row.control_revision,
            expectedFence: row.control_expected_fence,
            capabilityDigest: row.control_capability_digest,
            requestedAt: row.control_requested_at,
            pausedAt: row.control_paused_at,
            updatedAt: row.control_updated_at,
          },
  };
}

function normalizeRuntimeControlEnumeration(values, allowed, field) {
  if (!Array.isArray(values) || values.length === 0) {
    throw invalidArgument(`${field} must be a non-empty array`);
  }
  const normalized = [
    ...new Set(
      values.map((value, index) =>
        normalizeIdentifier(value, `${field}[${index}]`, { maxLength: 128 }),
      ),
    ),
  ];
  const unsupported = normalized.filter((value) => !allowed.has(value));
  if (unsupported.length > 0) {
    throw invalidArgument(`${field} contains unsupported values`, {
      values: unsupported.sort(),
    });
  }
  return normalized.sort();
}

export function schedulerRuntimeControlCapabilityDigest(capability) {
  return sha256PayloadDigest(
    normalizeRuntimeControlCapability(capability),
    "runtimeControl.capability",
  );
}

function mapOccurrenceControl(row) {
  if (!row) return null;
  const capability = normalizeRuntimeControlCapability(
    readStoredJson(row.capability_json, "scheduler runtime control capability"),
  );
  const capabilityDigest = schedulerRuntimeControlCapabilityDigest(capability);
  if (capabilityDigest !== row.capability_digest) {
    throw schemaError(
      "SCHEDULER_DATA_CORRUPT",
      `Scheduler runtime-control capability digest is invalid: ${row.occurrence_id}`,
    );
  }
  return {
    occurrenceId: row.occurrence_id,
    capability,
    capabilityDigest,
    state: row.state,
    revision: row.revision,
    pauseRequestId: row.pause_request_id,
    resumeRequestId: row.resume_request_id,
    expectedFence: row.expected_fence,
    checkpoint:
      row.checkpoint_json === null
        ? null
        : readStoredJson(
            row.checkpoint_json,
            "scheduler runtime control checkpoint",
          ),
    requestedAt: row.requested_at,
    pausedAt: row.paused_at,
    resumedAt: row.resumed_at,
    terminalAt: row.terminal_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRuntimeCheckpoint(value) {
  const checkpoint = normalizeJson(value ?? null, "runtimeControl.checkpoint");
  const encoded = canonicalJson(checkpoint, "runtimeControl.checkpoint");
  if (Buffer.byteLength(encoded, "utf8") > MAX_RUNTIME_CHECKPOINT_BYTES) {
    throw invalidArgument(
      `runtimeControl.checkpoint exceeds ${MAX_RUNTIME_CHECKPOINT_BYTES} encoded bytes`,
    );
  }
  return { checkpoint, encoded };
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

function schedulerJobDefinition(job) {
  return {
    id: job.id,
    kind: job.kind,
    trigger: job.trigger,
    payload: job.payload,
    authority: job.authority,
    enabled: job.enabled,
    maxAttempts: job.maxAttempts,
  };
}

export function schedulerJobDefinitionDigest(job) {
  return sha256PayloadDigest(
    schedulerJobDefinition(normalizeJobInput(schedulerJobDefinition(job))),
    "schedulerMigration.targetJob",
  );
}

export function schedulerMigrationSourceDigest(source) {
  return sha256PayloadDigest(
    normalizeJson(source, "schedulerMigration.source"),
    "schedulerMigration.source",
  );
}

export function schedulerMigrationScopeDigest(sourceScope) {
  return sha256PayloadDigest(
    normalizeJson(sourceScope, "schedulerMigration.sourceScope"),
    "schedulerMigration.sourceScope",
  );
}

const SENSITIVE_SOURCE_LOCATOR_FIELD =
  /(?:pass(?:word)?|secret|token|credential|api[_-]?key|private[_-]?key)/iu;

function assertNonSensitiveSourceLocator(value, field) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNonSensitiveSourceLocator(item, `${field}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_SOURCE_LOCATOR_FIELD.test(key)) {
      throw invalidArgument(`${field} must not contain sensitive fields`, {
        field: key,
      });
    }
    assertNonSensitiveSourceLocator(nested, `${field}.${key}`);
  }
}

function normalizeSchedulerMigrationSourceLocator(
  value,
  domain,
  sourceScopeDigest,
  field,
  { allowLegacyAutomationCurrent = false } = {},
) {
  if (value === undefined || value === null) return null;
  const locator = normalizeJson(value, field);
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) {
    throw invalidArgument(`${field} must be an object`);
  }
  if (locator.schemaVersion !== 1) {
    throw invalidArgument(`${field}.schemaVersion must be 1`);
  }
  const type = normalizeIdentifier(locator.type, `${field}.type`, {
    maxLength: 128,
  });
  const locatorTypes = {
    agenda: {
      type: "agenda-store",
      key: "directory",
      store: "agent-schedule",
    },
    "cowork-cron": {
      type: "cowork-workspace",
      key: "workspace",
      store: "cowork-schedules",
    },
    routine: {
      type: "routine-store",
      key: "directory",
      store: "routines",
    },
    automation: {
      type: "automation-database",
      key: "database",
      store: "automation-engine",
    },
    "loop-iteration": {
      type: "jsonl-session",
      key: "sessionId",
      additionalKey: "directory",
      store: "jsonl-session",
    },
  };
  const locatorType = locatorTypes[domain];
  if (!locatorType || locatorType.type !== type) {
    throw invalidArgument(`${field}.type does not match migration domain`);
  }
  const allowed = new Set([
    "schemaVersion",
    "type",
    locatorType.key,
    ...(locatorType.additionalKey ? [locatorType.additionalKey] : []),
  ]);
  const unknown = Object.keys(locator).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalidArgument(`${field} contains unknown fields`, {
      fields: unknown.sort(),
    });
  }
  const location = normalizeIdentifier(
    locator[locatorType.key],
    `${field}.${locatorType.key}`,
    { maxLength: 4096 },
  );
  const additionalLocation = locatorType.additionalKey
    ? normalizeIdentifier(
        locator[locatorType.additionalKey],
        `${field}.${locatorType.additionalKey}`,
        { maxLength: 4096 },
      )
    : null;
  const pathKeys = new Set(["directory", "workspace", "database"]);
  for (const [key, candidate] of [
    [locatorType.key, location],
    [locatorType.additionalKey, additionalLocation],
  ]) {
    if (
      key &&
      pathKeys.has(key) &&
      !(domain === "automation" && String(candidate).startsWith("memory:")) &&
      !isCanonicalSchedulerSourcePath(candidate)
    ) {
      throw invalidArgument(
        `${field}.${key} must be an absolute path in canonical form; Windows paths require a fully-qualified drive or UNC share`,
      );
    }
  }
  const derivedScope = {
    store: locatorType.store,
    [locatorType.key]: location,
  };
  const legacyAutomationCurrentScope =
    allowLegacyAutomationCurrent &&
    domain === "automation" &&
    schedulerMigrationScopeDigest({
      store: "automation-engine",
      database: "current",
    }) === sourceScopeDigest;
  if (
    schedulerMigrationScopeDigest(derivedScope) !== sourceScopeDigest &&
    !legacyAutomationCurrentScope
  ) {
    throw invalidArgument(`${field} must resolve to sourceScope`);
  }
  const normalized = {
    schemaVersion: 1,
    type,
    [locatorType.key]: location,
    ...(locatorType.additionalKey
      ? { [locatorType.additionalKey]: additionalLocation }
      : {}),
  };
  assertNonSensitiveSourceLocator(normalized, field);
  return normalized;
}

function normalizeDomainMigrationEntry(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidArgument(`entries[${index}] must be an object`);
  }
  const allowed = new Set([
    "domain",
    "sourceId",
    "sourceScope",
    "sourceLocator",
    "source",
    "targetJob",
    "rollbackStrategy",
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalidArgument(`entries[${index}] contains unknown fields`, {
      fields: unknown.sort(),
    });
  }
  if (!SCHEDULER_MIGRATION_DOMAINS.includes(input.domain)) {
    throw invalidArgument(
      `entries[${index}].domain must be a supported scheduler migration domain`,
    );
  }
  const sourceId = normalizeIdentifier(
    input.sourceId,
    `entries[${index}].sourceId`,
  );
  const sourceScopeDigest = schedulerMigrationScopeDigest(input.sourceScope);
  const sourceLocator = normalizeSchedulerMigrationSourceLocator(
    input.sourceLocator,
    input.domain,
    sourceScopeDigest,
    `entries[${index}].sourceLocator`,
  );
  const sourceDigest = schedulerMigrationSourceDigest(input.source);
  const targetJob = normalizeJobInput(input.targetJob);
  const targetJobDigest = schedulerJobDefinitionDigest(targetJob);
  const rollbackStrategy = input.rollbackStrategy ?? "restore";
  if (!["restore", "disable"].includes(rollbackStrategy)) {
    throw invalidArgument(
      `entries[${index}].rollbackStrategy must be restore or disable`,
    );
  }
  const identity = {
    schemaVersion: 1,
    domain: input.domain,
    sourceId,
    sourceScopeDigest,
    sourceDigest,
    targetJobId: targetJob.id,
    targetJobDigest,
    rollbackStrategy,
  };
  const entryDigest = sha256PayloadDigest(
    identity,
    `schedulerMigration.entries[${index}]`,
  );
  return {
    ...identity,
    sourceLocator,
    entryId: `scheduler-migration-entry-${entryDigest.slice("sha256:".length)}`,
    targetJob,
  };
}

function normalizeDomainMigrationPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidArgument("scheduler migration plan must be an object");
  }
  const unknown = Object.keys(input).filter((key) => key !== "entries");
  if (unknown.length > 0) {
    throw invalidArgument("scheduler migration plan contains unknown fields", {
      fields: unknown.sort(),
    });
  }
  if (
    !Array.isArray(input.entries) ||
    input.entries.length < 1 ||
    input.entries.length > 1_000
  ) {
    throw invalidArgument(
      "scheduler migration plan must contain between 1 and 1000 entries",
    );
  }
  const entries = input.entries
    .map(normalizeDomainMigrationEntry)
    .sort((left, right) => left.entryId.localeCompare(right.entryId));
  const entryIds = new Set();
  const sources = new Set();
  const targets = new Set();
  for (const entry of entries) {
    const sourceKey = canonicalJson([
      entry.domain,
      entry.sourceScopeDigest,
      entry.sourceId,
    ]);
    if (entryIds.has(entry.entryId) || sources.has(sourceKey)) {
      throw invalidArgument(
        "scheduler migration plan contains duplicate sources",
      );
    }
    if (targets.has(entry.targetJobId)) {
      throw invalidArgument(
        "scheduler migration plan contains duplicate target jobs",
      );
    }
    entryIds.add(entry.entryId);
    sources.add(sourceKey);
    targets.add(entry.targetJobId);
  }
  const manifest = {
    schemaVersion: 1,
    entries: entries.map((entry) => ({
      schemaVersion: entry.schemaVersion,
      entryId: entry.entryId,
      domain: entry.domain,
      sourceId: entry.sourceId,
      sourceScopeDigest: entry.sourceScopeDigest,
      sourceDigest: entry.sourceDigest,
      targetJobId: entry.targetJobId,
      targetJobDigest: entry.targetJobDigest,
      rollbackStrategy: entry.rollbackStrategy,
      targetJob: entry.targetJob,
    })),
  };
  const manifestDigest = sha256PayloadDigest(
    manifest,
    "schedulerMigration.manifest",
  );
  return {
    migrationId: `scheduler-domain-migration-${manifestDigest.slice("sha256:".length)}`,
    manifestDigest,
    manifest,
    entries,
  };
}

function mapDomainMigrationEntry(row) {
  if (!row) return null;
  let sourceLocator = null;
  if (row.source_locator_json !== null) {
    try {
      sourceLocator = normalizeSchedulerMigrationSourceLocator(
        readStoredJson(
          row.source_locator_json,
          "scheduler migration source locator",
        ),
        row.domain,
        row.source_scope_digest,
        "scheduler migration source locator",
        { allowLegacyAutomationCurrent: true },
      );
    } catch (cause) {
      if (cause?.code === "SCHEDULER_DATA_CORRUPT") throw cause;
      throw schemaError(
        "SCHEDULER_DATA_CORRUPT",
        "Stored scheduler migration source locator is invalid or unbound",
        cause,
      );
    }
  }
  return {
    migrationId: row.migration_id,
    entryId: row.entry_id,
    domain: row.domain,
    sourceId: row.source_id,
    sourceScopeDigest: row.source_scope_digest,
    sourceLocator,
    sourceLocatorDigest:
      sourceLocator === null
        ? null
        : sha256PayloadDigest(
            sourceLocator,
            "schedulerMigration.sourceLocator",
          ),
    sourceDigest: row.source_digest,
    targetJobId: row.target_job_id,
    targetJobDigest: row.target_job_digest,
    rollbackStrategy: row.rollback_strategy,
    state: row.state,
    targetAction: row.target_action,
    targetBefore:
      row.target_before_json === null
        ? null
        : readStoredJson(
            row.target_before_json,
            "scheduler migration target before",
          ),
    targetAppliedRevision: row.target_applied_revision,
    targetAppliedAt: row.target_applied_at,
    targetOccurrenceCountBefore: row.target_occurrence_count_before,
    targetExecutionEventCountBefore: row.target_execution_event_count_before,
    targetRollbackRevision: row.target_rollback_revision,
    retirementToken: row.retirement_token,
    sourceRetirementDigest: row.source_retirement_digest,
    sourceRestoredDigest: row.source_restored_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDomainMigration(row, entries = undefined) {
  if (!row) return null;
  return {
    id: row.migration_id,
    manifestDigest: row.manifest_digest,
    manifest: readStoredJson(row.manifest_json, "scheduler migration manifest"),
    state: row.state,
    entryCount: row.entry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastError:
      row.last_error_json === null
        ? null
        : readStoredJson(row.last_error_json, "scheduler migration error"),
    ...(entries === undefined ? {} : { entries }),
  };
}

function schedulerMigrationError(code, message, details = undefined) {
  return new SchedulerKernelError(code, message, details);
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

function verifyTableShape(db, table, version) {
  const actual = db
    .pragma(`table_info(${JSON.stringify(table)})`)
    .map((column) => [
      column.name,
      String(column.type || "").toUpperCase(),
      column.notnull,
      column.pk,
    ]);
  const expected =
    version < 5 && table === "scheduler_domain_migration_entries"
      ? EXPECTED_COLUMNS[table].filter(
          ([name]) => name !== "source_locator_json",
        )
      : EXPECTED_COLUMNS[table];
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
        : version === 3
          ? V3_USER_TABLES
          : version <= 5
            ? V4_V5_USER_TABLES
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

  for (const table of expectedTables) verifyTableShape(db, table, version);

  const actualFingerprint = schemaFingerprint(db);
  const expectedFingerprint =
    version === 1
      ? SCHEMA_V1_FINGERPRINT
      : version === 2
        ? SCHEMA_V2_FINGERPRINT
        : version === 3
          ? SCHEMA_V3_FINGERPRINT
          : version === 4
            ? SCHEMA_V4_FINGERPRINT
            : version === 5
              ? SCHEMA_V5_FINGERPRINT
              : SCHEMA_V6_FINGERPRINT;
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
        migrations[2]?.checksum !== MIGRATION_V3_CHECKSUM)) ||
    (version >= 4 &&
      (migrations[3]?.version !== 4 ||
        migrations[3]?.name !== MIGRATION_V4_NAME ||
        migrations[3]?.checksum !== MIGRATION_V4_CHECKSUM)) ||
    (version >= 5 &&
      (migrations[4]?.version !== 5 ||
        migrations[4]?.name !== MIGRATION_V5_NAME ||
        migrations[4]?.checksum !== MIGRATION_V5_CHECKSUM)) ||
    (version >= 6 &&
      (migrations[5]?.version !== 6 ||
        migrations[5]?.name !== MIGRATION_V6_NAME ||
        migrations[5]?.checksum !== MIGRATION_V6_CHECKSUM))
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
      (version >= 3 || !name.startsWith("scheduler_adjudications_")) &&
      (version >= 4 || !name.startsWith("scheduler_domain_migration")) &&
      (version >= 6 || !name.startsWith("scheduler_occurrence_controls_")) &&
      (version >= 6 || !name.startsWith("scheduler_occurrence_retries_")),
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

function migrateDomainMigrationV4(db) {
  db.exec(MIGRATION_V4_SQL);
}

function migrateSourceLocatorV5(db) {
  db.exec(MIGRATION_V5_SQL);
}

function migrateRuntimeControlV6(db) {
  db.exec(MIGRATION_V6_SQL);
}

function initializeOrVerifySchema(db, now) {
  assertDatabaseIntegrity(db);
  const tables = listUserTables(db);
  if (tables.length === 0) {
    const migrate = db.transaction(() => {
      db.exec(MIGRATION_V1_SQL);
      migrateAuthorityV2(db, now);
      migrateAdjudicationV3(db);
      migrateDomainMigrationV4(db);
      migrateSourceLocatorV5(db);
      migrateRuntimeControlV6(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(1, MIGRATION_V1_NAME, MIGRATION_V1_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(2, MIGRATION_V2_NAME, MIGRATION_V2_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(3, MIGRATION_V3_NAME, MIGRATION_V3_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(4, MIGRATION_V4_NAME, MIGRATION_V4_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(5, MIGRATION_V5_NAME, MIGRATION_V5_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(6, MIGRATION_V6_NAME, MIGRATION_V6_CHECKSUM, now);
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
      migrateDomainMigrationV4(db);
      migrateSourceLocatorV5(db);
      migrateRuntimeControlV6(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(2, MIGRATION_V2_NAME, MIGRATION_V2_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(3, MIGRATION_V3_NAME, MIGRATION_V3_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(4, MIGRATION_V4_NAME, MIGRATION_V4_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(5, MIGRATION_V5_NAME, MIGRATION_V5_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(6, MIGRATION_V6_NAME, MIGRATION_V6_CHECKSUM, now);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (db.pragma("user_version", { simple: true }) === 2) {
    verifySchema(db, 2);
    const migrate = db.transaction(() => {
      migrateAdjudicationV3(db);
      migrateDomainMigrationV4(db);
      migrateSourceLocatorV5(db);
      migrateRuntimeControlV6(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(3, MIGRATION_V3_NAME, MIGRATION_V3_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(4, MIGRATION_V4_NAME, MIGRATION_V4_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(5, MIGRATION_V5_NAME, MIGRATION_V5_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(6, MIGRATION_V6_NAME, MIGRATION_V6_CHECKSUM, now);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (db.pragma("user_version", { simple: true }) === 3) {
    verifySchema(db, 3);
    const migrate = db.transaction(() => {
      migrateDomainMigrationV4(db);
      migrateSourceLocatorV5(db);
      migrateRuntimeControlV6(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(4, MIGRATION_V4_NAME, MIGRATION_V4_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(5, MIGRATION_V5_NAME, MIGRATION_V5_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(6, MIGRATION_V6_NAME, MIGRATION_V6_CHECKSUM, now);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (db.pragma("user_version", { simple: true }) === 4) {
    verifySchema(db, 4);
    const migrate = db.transaction(() => {
      migrateSourceLocatorV5(db);
      migrateRuntimeControlV6(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(5, MIGRATION_V5_NAME, MIGRATION_V5_CHECKSUM, now);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(6, MIGRATION_V6_NAME, MIGRATION_V6_CHECKSUM, now);
      db.pragma(`user_version = ${SCHEDULER_STORE_SCHEMA_VERSION}`);
    });
    migrate.immediate();
  } else if (db.pragma("user_version", { simple: true }) === 5) {
    verifySchema(db, 5);
    const migrate = db.transaction(() => {
      migrateRuntimeControlV6(db);
      db.prepare(
        "INSERT INTO migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(6, MIGRATION_V6_NAME, MIGRATION_V6_CHECKSUM, now);
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
    try {
      ensurePrivateDirectory(dirname(target));
      // Existing WAL/SHM files participate in the next SQLite open, so validate
      // them before the native driver consumes either sidecar.
      for (const candidate of sqliteStorageFiles(target)) {
        if (existsSync(candidate)) ensurePrivateFile(candidate);
      }
    } catch (cause) {
      const storageCode = findStorageFailureCode(cause);
      if (!storageCode) throw cause;
      throw storageUnavailableError({
        phase: "open",
        storageCode,
        commitState: "unknown",
      });
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
    const storageCode = findStorageFailureCode(cause);
    if (storageCode) {
      throw storageUnavailableError({
        phase: "open",
        storageCode,
        commitState: "unknown",
      });
    }
    throw schemaError(
      "SCHEDULER_SCHEMA_CORRUPT",
      "Scheduler database could not be opened or verified",
      cause,
    );
  }

  if (target !== ":memory:") {
    try {
      // A quiet WAL database may not have materialized sidecars yet. On Windows,
      // asking secure-fs to classify a missing path deliberately falls back to a
      // native ACL preflight. Only inspect files that SQLite actually created;
      // later opens repeat this check for any surviving sidecars.
      for (const candidate of sqliteStorageFiles(target)) {
        if (existsSync(candidate)) ensurePrivateFile(candidate);
      }
    } catch (cause) {
      try {
        db.close();
      } catch {
        // Preserve the authoritative storage or security failure.
      }
      const storageCode = findStorageFailureCode(cause);
      if (!storageCode) throw cause;
      throw storageUnavailableError({
        phase: "open",
        storageCode,
        commitState: "unknown",
      });
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
      getOccurrenceControl: db.prepare(
        "SELECT * FROM scheduler_occurrence_controls WHERE occurrence_id = ?",
      ),
      getOccurrenceControlByPauseRequest: db.prepare(
        "SELECT * FROM scheduler_occurrence_controls WHERE pause_request_id = ?",
      ),
      getOccurrenceControlByResumeRequest: db.prepare(
        "SELECT * FROM scheduler_occurrence_controls WHERE resume_request_id = ?",
      ),
      getOccurrenceRetryByRequest: db.prepare(
        "SELECT * FROM scheduler_occurrence_retries WHERE request_id = ?",
      ),
      listOccurrencesByTrigger: db.prepare(
        `SELECT * FROM occurrences
         WHERE job_id = ? AND trigger_key = ?
         ORDER BY created_at ASC, occurrence_id ASC
         LIMIT ?`,
      ),
      getDomainMigration: db.prepare(
        "SELECT * FROM scheduler_domain_migrations WHERE migration_id = ?",
      ),
      getDomainMigrationEntry: db.prepare(
        `SELECT * FROM scheduler_domain_migration_entries
         WHERE migration_id = ? AND entry_id = ?`,
      ),
      listDomainMigrationEntries: db.prepare(
        `SELECT * FROM scheduler_domain_migration_entries
         WHERE migration_id = ? ORDER BY entry_id`,
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
    let bodyState = "not_started";
    let bodyObservedTransaction = false;
    try {
      const transaction = this.db.transaction((...args) => {
        bodyState = "running";
        try {
          bodyObservedTransaction = this.db.inTransaction === true;
        } catch {
          bodyObservedTransaction = false;
        }
        const result = callback(...args);
        bodyState = "returned";
        return result;
      });
      return transaction.immediate();
    } catch (cause) {
      if (cause instanceof SchedulerKernelError) throw cause;
      const storageCode = findStorageFailureCode(cause);
      if (!storageCode) throw cause;
      let transactionClosed = false;
      try {
        transactionClosed = this.db.inTransaction === false;
      } catch {
        transactionClosed = false;
      }
      // Once the body returns, the wrapper may already be in COMMIT and an I/O
      // failure cannot distinguish an applied commit from an aborted one. A
      // body failure is only safe to call not-committed when we observed the
      // native transaction and can also observe that its rollback closed it.
      throw storageUnavailableError({
        phase: "write",
        storageCode,
        commitState:
          bodyState === "running" &&
          bodyObservedTransaction &&
          transactionClosed
            ? "not_committed"
            : "unknown",
      });
    }
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

  _domainMigration(migrationId) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const row = this.statements.getDomainMigration.get(id);
    if (!row) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_NOT_FOUND",
        `Scheduler domain migration does not exist: ${id}`,
      );
    }
    return mapDomainMigration(
      row,
      this.statements.listDomainMigrationEntries
        .all(id)
        .map(mapDomainMigrationEntry),
    );
  }

  getDomainMigration(migrationId) {
    this._assertOpen();
    return this._domainMigration(migrationId);
  }

  getActiveDomainMigrationBySource({ domain, sourceScope, sourceId } = {}) {
    this._assertOpen();
    if (!SCHEDULER_MIGRATION_DOMAINS.includes(domain)) {
      throw invalidArgument(
        "domain must be a supported scheduler migration domain",
      );
    }
    const scopeDigest = schedulerMigrationScopeDigest(sourceScope);
    const id = normalizeIdentifier(sourceId, "sourceId");
    const row = this.db
      .prepare(
        `SELECT migration_id FROM scheduler_domain_migration_entries
         WHERE domain = ? AND source_scope_digest = ? AND source_id = ?
           AND state <> 'rolled_back'`,
      )
      .get(domain, scopeDigest, id);
    return row ? this._domainMigration(row.migration_id) : null;
  }

  bindDomainMigrationSourceLocator({
    migrationId,
    entryId,
    sourceLocator,
    expectedSourceDigest,
    expectedTargetJobId,
  } = {}) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const normalizedEntryId = normalizeIdentifier(entryId, "entryId");
    const sourceDigest = normalizeSha256Digest(
      expectedSourceDigest,
      "expectedSourceDigest",
    );
    const targetJobId = normalizeIdentifier(
      expectedTargetJobId,
      "expectedTargetJobId",
    );
    const now = this._now();
    return this._write(() => {
      const row = this.statements.getDomainMigrationEntry.get(
        id,
        normalizedEntryId,
      );
      if (!row) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_NOT_FOUND",
          `Scheduler migration entry does not exist: ${normalizedEntryId}`,
        );
      }
      if (
        row.source_digest !== sourceDigest ||
        row.target_job_id !== targetJobId
      ) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_SOURCE_MISMATCH",
          "Scheduler migration locator evidence does not match the journal",
        );
      }
      const locator = normalizeSchedulerMigrationSourceLocator(
        sourceLocator,
        row.domain,
        row.source_scope_digest,
        "sourceLocator",
        { allowLegacyAutomationCurrent: true },
      );
      if (locator === null) {
        throw invalidArgument("sourceLocator is required");
      }
      const encoded = canonicalJson(
        locator,
        "schedulerMigration.sourceLocator",
      );
      if (row.source_locator_json !== null) {
        if (row.source_locator_json !== encoded) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_LOCATOR_CONFLICT",
            "Scheduler migration source locator is already bound differently",
          );
        }
        return {
          ...mapDomainMigrationEntry(row),
          deduplicated: true,
        };
      }
      const result = this.db
        .prepare(
          `UPDATE scheduler_domain_migration_entries
           SET source_locator_json = ?, updated_at = ?
           WHERE migration_id = ? AND entry_id = ?
             AND source_locator_json IS NULL
             AND source_digest = ? AND target_job_id = ?`,
        )
        .run(encoded, now, id, normalizedEntryId, sourceDigest, targetJobId);
      if (result.changes !== 1) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_LOCATOR_CONFLICT",
          "Scheduler migration source locator changed during binding",
        );
      }
      this.db
        .prepare(
          `UPDATE scheduler_domain_migrations
           SET updated_at = ? WHERE migration_id = ?`,
        )
        .run(now, id);
      return {
        ...mapDomainMigrationEntry(
          this.statements.getDomainMigrationEntry.get(id, normalizedEntryId),
        ),
        deduplicated: false,
      };
    });
  }

  listDomainMigrations({ state, limit = 50 } = {}) {
    this._assertOpen();
    const boundedLimit = Math.min(
      200,
      Math.max(1, Number.isSafeInteger(Number(limit)) ? Number(limit) : 50),
    );
    let normalizedState = null;
    if (state !== undefined) {
      normalizedState = normalizeIdentifier(state, "state", { maxLength: 32 });
      if (
        !Object.values(SCHEDULER_MIGRATION_STATES).includes(normalizedState)
      ) {
        throw invalidArgument("state is not a scheduler migration state");
      }
    }
    const rows = normalizedState
      ? this.db
          .prepare(
            `SELECT * FROM scheduler_domain_migrations
             WHERE state = ? ORDER BY updated_at DESC, migration_id LIMIT ?`,
          )
          .all(normalizedState, boundedLimit)
      : this.db
          .prepare(
            `SELECT * FROM scheduler_domain_migrations
             ORDER BY updated_at DESC, migration_id LIMIT ?`,
          )
          .all(boundedLimit);
    return rows.map((row) => mapDomainMigration(row));
  }

  prepareDomainMigration(input) {
    const plan = normalizeDomainMigrationPlan(input);
    const now = this._now();
    return this._write(() => {
      const activeIds = new Set();
      const findActiveSource = this.db.prepare(
        `SELECT migration_id FROM scheduler_domain_migration_entries
         WHERE domain = ? AND source_scope_digest = ? AND source_id = ?
           AND state <> 'rolled_back'`,
      );
      const findActiveTarget = this.db.prepare(
        `SELECT migration_id FROM scheduler_domain_migration_entries
         WHERE target_job_id = ? AND state <> 'rolled_back'`,
      );
      for (const entry of plan.entries) {
        const source = findActiveSource.get(
          entry.domain,
          entry.sourceScopeDigest,
          entry.sourceId,
        );
        const target = findActiveTarget.get(entry.targetJobId);
        if (source) activeIds.add(source.migration_id);
        if (target) activeIds.add(target.migration_id);
      }
      if (activeIds.size > 0) {
        if (activeIds.size !== 1) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_CONFLICT",
            "Scheduler migration sources or targets belong to different active migrations",
          );
        }
        const [activeId] = activeIds;
        const active = this.statements.getDomainMigration.get(activeId);
        if (!active) {
          throw schemaError(
            "SCHEDULER_DATA_CORRUPT",
            "Active scheduler migration entry has no parent journal",
          );
        }
        const activeMigration = this._domainMigration(activeId);
        const matchedEntries = [];
        const samePlan =
          activeMigration.entries.length === plan.entries.length &&
          activeMigration.entries.every((entry) => {
            const candidate = plan.entries.find(
              (item) =>
                item.domain === entry.domain &&
                item.sourceId === entry.sourceId &&
                item.sourceScopeDigest === entry.sourceScopeDigest &&
                item.targetJobId === entry.targetJobId,
            );
            const locatorMatches =
              candidate &&
              (entry.sourceLocator === null ||
                candidate.sourceLocator === null ||
                canonicalJson(
                  entry.sourceLocator,
                  "schedulerMigration.sourceLocator",
                ) ===
                  canonicalJson(
                    candidate.sourceLocator,
                    "schedulerMigration.sourceLocator",
                  ));
            const matches =
              candidate &&
              locatorMatches &&
              candidate.sourceDigest === entry.sourceDigest &&
              candidate.targetJobDigest === entry.targetJobDigest &&
              candidate.rollbackStrategy === entry.rollbackStrategy;
            if (matches) matchedEntries.push({ entry, candidate });
            return matches;
          });
        if (!samePlan) {
          const comparison = {
            active: activeMigration.entries.map((entry) => ({
              domain: entry.domain,
              sourceId: entry.sourceId,
              sourceScopeDigest: entry.sourceScopeDigest,
              sourceDigest: entry.sourceDigest,
              targetJobId: entry.targetJobId,
              targetJobDigest: entry.targetJobDigest,
              rollbackStrategy: entry.rollbackStrategy,
            })),
            requested: plan.entries.map((entry) => ({
              domain: entry.domain,
              sourceId: entry.sourceId,
              sourceScopeDigest: entry.sourceScopeDigest,
              sourceDigest: entry.sourceDigest,
              targetJobId: entry.targetJobId,
              targetJobDigest: entry.targetJobDigest,
              rollbackStrategy: entry.rollbackStrategy,
            })),
          };
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_CONFLICT",
            "A scheduler source or target already has a different active migration",
            comparison,
          );
        }
        let locatorBackfilled = false;
        const backfillLocator = this.db.prepare(
          `UPDATE scheduler_domain_migration_entries
           SET source_locator_json = ?, updated_at = ?
           WHERE migration_id = ? AND entry_id = ?
             AND source_locator_json IS NULL`,
        );
        for (const { entry, candidate } of matchedEntries) {
          if (
            entry.sourceLocator !== null ||
            candidate.sourceLocator === null
          ) {
            continue;
          }
          const result = backfillLocator.run(
            canonicalJson(
              candidate.sourceLocator,
              "schedulerMigration.sourceLocator",
            ),
            now,
            activeId,
            entry.entryId,
          );
          if (result.changes !== 1) {
            throw schemaError(
              "SCHEDULER_DATA_CORRUPT",
              "Scheduler migration source locator changed during binding",
            );
          }
          locatorBackfilled = true;
        }
        if (locatorBackfilled) {
          this.db
            .prepare(
              `UPDATE scheduler_domain_migrations
               SET updated_at = ? WHERE migration_id = ?`,
            )
            .run(now, activeId);
        }
        return {
          ...(locatorBackfilled
            ? this._domainMigration(activeId)
            : activeMigration),
          deduplicated: true,
        };
      }

      const attemptManifest = {
        ...plan.manifest,
        schemaVersion: 2,
        planDigest: plan.manifestDigest,
        attemptId: randomUUID(),
      };
      const manifestDigest = sha256PayloadDigest(
        attemptManifest,
        "schedulerMigration.attemptManifest",
      );
      const migrationId = `scheduler-domain-migration-${manifestDigest.slice(
        "sha256:".length,
      )}`;
      this.db
        .prepare(
          `INSERT INTO scheduler_domain_migrations
             (migration_id, manifest_digest, manifest_json, state, entry_count,
              created_at, updated_at, completed_at, last_error_json)
           VALUES (?, ?, ?, 'prepared', ?, ?, ?, NULL, NULL)`,
        )
        .run(
          migrationId,
          manifestDigest,
          canonicalJson(attemptManifest, "schedulerMigration.manifest"),
          plan.entries.length,
          now,
          now,
        );
      const insert = this.db.prepare(
        `INSERT INTO scheduler_domain_migration_entries
           (migration_id, entry_id, domain, source_id, source_scope_digest,
            source_locator_json, source_digest, target_job_id,
            target_job_digest, rollback_strategy, state,
            target_action, target_before_json, target_applied_revision,
            target_applied_at, target_occurrence_count_before,
            target_execution_event_count_before, target_rollback_revision,
            retirement_token, source_retirement_digest, source_restored_digest,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared',
                 NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 ?, ?)`,
      );
      for (const entry of plan.entries) {
        try {
          insert.run(
            migrationId,
            entry.entryId,
            entry.domain,
            entry.sourceId,
            entry.sourceScopeDigest,
            entry.sourceLocator === null
              ? null
              : canonicalJson(
                  entry.sourceLocator,
                  "schedulerMigration.sourceLocator",
                ),
            entry.sourceDigest,
            entry.targetJobId,
            entry.targetJobDigest,
            entry.rollbackStrategy,
            now,
            now,
          );
        } catch (cause) {
          if (String(cause?.code || "").startsWith("SQLITE_CONSTRAINT")) {
            throw schedulerMigrationError(
              "SCHEDULER_MIGRATION_CONFLICT",
              "A scheduler source or target already has an active migration",
              {
                domain: entry.domain,
                sourceId: entry.sourceId,
                targetJobId: entry.targetJobId,
              },
            );
          }
          throw cause;
        }
      }
      return {
        ...this._domainMigration(migrationId),
        deduplicated: false,
      };
    });
  }

  applyDomainMigration(migrationId) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const now = this._now();
    return this._write(() => {
      const migration = this._domainMigration(id);
      if (migration.state !== SCHEDULER_MIGRATION_STATES.PREPARED) {
        if (
          [
            SCHEDULER_MIGRATION_STATES.APPLIED,
            SCHEDULER_MIGRATION_STATES.VERIFIED,
            SCHEDULER_MIGRATION_STATES.RETIRING,
            SCHEDULER_MIGRATION_STATES.RETIRED,
          ].includes(migration.state)
        ) {
          return { ...migration, deduplicated: true };
        }
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          `Scheduler migration cannot be applied from state ${migration.state}`,
        );
      }
      const manifestById = new Map(
        migration.manifest.entries.map((entry) => [entry.entryId, entry]),
      );
      const updateEntry = this.db.prepare(
        `UPDATE scheduler_domain_migration_entries
         SET state = 'applied', target_action = ?, target_before_json = ?,
             target_applied_revision = ?, target_applied_at = ?,
             target_occurrence_count_before = ?,
             target_execution_event_count_before = ?, updated_at = ?
         WHERE migration_id = ? AND entry_id = ? AND state = 'prepared'`,
      );
      for (const entry of migration.entries) {
        const manifestEntry = manifestById.get(entry.entryId);
        if (!manifestEntry) {
          throw schemaError(
            "SCHEDULER_DATA_CORRUPT",
            "Scheduler migration entry is absent from its manifest",
          );
        }
        const targetJob = normalizeJobInput(manifestEntry.targetJob);
        if (
          targetJob.id !== entry.targetJobId ||
          schedulerJobDefinitionDigest(targetJob) !== entry.targetJobDigest
        ) {
          throw schemaError(
            "SCHEDULER_DATA_CORRUPT",
            "Scheduler migration target does not match its stored digest",
          );
        }
        const current = mapJob(this.statements.getJob.get(entry.targetJobId));
        const stagedTargetJob = { ...targetJob, enabled: false };
        const occurrenceCount = this.db
          .prepare("SELECT COUNT(*) AS count FROM occurrences WHERE job_id = ?")
          .get(entry.targetJobId).count;
        const executionEventCount = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM events
             WHERE job_id = ? AND occurrence_id IS NOT NULL`,
          )
          .get(entry.targetJobId).count;
        let action;
        let applied;
        if (!current) {
          applied = this.createJob(stagedTargetJob);
          action = "created";
        } else if (
          schedulerJobDefinitionDigest(current) ===
          schedulerJobDefinitionDigest(stagedTargetJob)
        ) {
          applied = current;
          action = "reused";
        } else {
          applied = this.updateJob(current.id, current.revision, {
            kind: stagedTargetJob.kind,
            trigger: stagedTargetJob.trigger,
            payload: stagedTargetJob.payload,
            authority: stagedTargetJob.authority,
            enabled: false,
            maxAttempts: stagedTargetJob.maxAttempts,
          });
          action = "updated";
        }
        const result = updateEntry.run(
          action,
          current === null
            ? null
            : canonicalJson(
                schedulerJobDefinition(current),
                "schedulerMigration.targetBefore",
              ),
          applied.revision,
          now,
          occurrenceCount,
          executionEventCount,
          now,
          id,
          entry.entryId,
        );
        if (result.changes !== 1) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_STATE_CONFLICT",
            "Scheduler migration entry changed while it was being applied",
          );
        }
      }
      this.db
        .prepare(
          `UPDATE scheduler_domain_migrations
           SET state = 'applied', updated_at = ?
           WHERE migration_id = ? AND state = 'prepared'`,
        )
        .run(now, id);
      return { ...this._domainMigration(id), deduplicated: false };
    });
  }

  verifyDomainMigration(migrationId, { sources } = {}) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    if (!Array.isArray(sources)) {
      throw invalidArgument("sources must be an array");
    }
    const supplied = new Map();
    for (const [index, source] of sources.entries()) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw invalidArgument(`sources[${index}] must be an object`);
      }
      const entryId = normalizeIdentifier(
        source.entryId,
        `sources[${index}].entryId`,
      );
      if (supplied.has(entryId)) {
        throw invalidArgument("sources contains duplicate migration entries");
      }
      supplied.set(entryId, schedulerMigrationSourceDigest(source.source));
    }
    const now = this._now();
    return this._write(() => {
      const migration = this._domainMigration(id);
      if (migration.state === SCHEDULER_MIGRATION_STATES.VERIFIED) {
        return { ...migration, deduplicated: true };
      }
      if (migration.state !== SCHEDULER_MIGRATION_STATES.APPLIED) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          `Scheduler migration cannot be verified from state ${migration.state}`,
        );
      }
      if (supplied.size !== migration.entries.length) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_SOURCE_MISMATCH",
          "Verification must provide every scheduler migration source exactly once",
        );
      }
      for (const entry of migration.entries) {
        if (supplied.get(entry.entryId) !== entry.sourceDigest) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_SOURCE_CHANGED",
            `Scheduler migration source changed before verification: ${entry.sourceId}`,
            { entryId: entry.entryId, sourceId: entry.sourceId },
          );
        }
        const job = mapJob(this.statements.getJob.get(entry.targetJobId));
        const manifestEntry = migration.manifest.entries.find(
          (candidate) => candidate.entryId === entry.entryId,
        );
        if (!manifestEntry) {
          throw schemaError(
            "SCHEDULER_DATA_CORRUPT",
            "Scheduler migration entry is absent from its manifest",
          );
        }
        const stagedDigest = schedulerJobDefinitionDigest({
          ...normalizeJobInput(manifestEntry.targetJob),
          enabled: false,
        });
        if (
          !job ||
          job.revision !== entry.targetAppliedRevision ||
          schedulerJobDefinitionDigest(job) !== stagedDigest
        ) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_TARGET_CHANGED",
            `Scheduler migration target changed before verification: ${entry.targetJobId}`,
            { entryId: entry.entryId, targetJobId: entry.targetJobId },
          );
        }
      }
      const entries = this.db
        .prepare(
          `UPDATE scheduler_domain_migration_entries
           SET state = 'verified', updated_at = ?
           WHERE migration_id = ? AND state = 'applied'`,
        )
        .run(now, id);
      if (entries.changes !== migration.entries.length) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          "Scheduler migration entries changed during verification",
        );
      }
      this.db
        .prepare(
          `UPDATE scheduler_domain_migrations
           SET state = 'verified', updated_at = ?
           WHERE migration_id = ? AND state = 'applied'`,
        )
        .run(now, id);
      return { ...this._domainMigration(id), deduplicated: false };
    });
  }

  beginDomainMigrationRetirement(migrationId) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const now = this._now();
    return this._write(() => {
      const migration = this._domainMigration(id);
      if (migration.state === SCHEDULER_MIGRATION_STATES.RETIRING) {
        return { ...migration, deduplicated: true };
      }
      if (migration.state !== SCHEDULER_MIGRATION_STATES.VERIFIED) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          `Scheduler migration cannot retire sources from state ${migration.state}`,
        );
      }
      const update = this.db.prepare(
        `UPDATE scheduler_domain_migration_entries
         SET state = 'retiring', retirement_token = ?, updated_at = ?
         WHERE migration_id = ? AND entry_id = ? AND state = 'verified'`,
      );
      for (const entry of migration.entries) {
        const token = `scheduler-retirement-${randomUUID()}`;
        if (update.run(token, now, id, entry.entryId).changes !== 1) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_STATE_CONFLICT",
            "Scheduler migration entry changed during retirement preparation",
          );
        }
      }
      this.db
        .prepare(
          `UPDATE scheduler_domain_migrations
           SET state = 'retiring', updated_at = ?
           WHERE migration_id = ? AND state = 'verified'`,
        )
        .run(now, id);
      return { ...this._domainMigration(id), deduplicated: false };
    });
  }

  confirmDomainMigrationEntryRetired({
    migrationId,
    entryId,
    retirementToken,
    source,
  } = {}) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const normalizedEntryId = normalizeIdentifier(entryId, "entryId");
    const token = normalizeIdentifier(retirementToken, "retirementToken");
    const retirementDigest = schedulerMigrationSourceDigest(source);
    const now = this._now();
    return this._write(() => {
      const entry = mapDomainMigrationEntry(
        this.statements.getDomainMigrationEntry.get(id, normalizedEntryId),
      );
      if (!entry) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_NOT_FOUND",
          `Scheduler migration entry does not exist: ${normalizedEntryId}`,
        );
      }
      if (entry.state === "retired") {
        if (
          entry.retirementToken !== token ||
          entry.sourceRetirementDigest !== retirementDigest
        ) {
          throw schedulerMigrationError(
            "SCHEDULER_MIGRATION_SOURCE_MISMATCH",
            "Retired scheduler source evidence does not match the journal",
          );
        }
        return { ...entry, deduplicated: true };
      }
      if (entry.state !== "retiring" || entry.retirementToken !== token) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          "Scheduler migration entry is not waiting for this retirement token",
        );
      }
      const updated = this.db
        .prepare(
          `UPDATE scheduler_domain_migration_entries
           SET state = 'retired', source_retirement_digest = ?, updated_at = ?
           WHERE migration_id = ? AND entry_id = ? AND state = 'retiring'
             AND retirement_token = ?`,
        )
        .run(retirementDigest, now, id, normalizedEntryId, token);
      if (updated.changes !== 1) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          "Scheduler migration entry changed while retirement was confirmed",
        );
      }
      const remaining = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM scheduler_domain_migration_entries
           WHERE migration_id = ? AND state <> 'retired'`,
        )
        .get(id).count;
      if (remaining === 0) {
        const refreshed = this._domainMigration(id);
        const manifestById = new Map(
          refreshed.manifest.entries.map((candidate) => [
            candidate.entryId,
            candidate,
          ]),
        );
        const activations = [];
        for (const candidate of refreshed.entries) {
          const manifestEntry = manifestById.get(candidate.entryId);
          if (!manifestEntry) {
            throw schemaError(
              "SCHEDULER_DATA_CORRUPT",
              "Scheduler migration entry is absent from its manifest",
            );
          }
          const intended = normalizeJobInput(manifestEntry.targetJob);
          const current = mapJob(
            this.statements.getJob.get(candidate.targetJobId),
          );
          const stagedDigest = schedulerJobDefinitionDigest({
            ...intended,
            enabled: false,
          });
          if (
            current &&
            schedulerJobDefinitionDigest(current) === candidate.targetJobDigest
          ) {
            this.db
              .prepare(
                `UPDATE scheduler_domain_migration_entries
                 SET target_applied_revision = ?, updated_at = ?
                 WHERE migration_id = ? AND entry_id = ? AND state = 'retired'`,
              )
              .run(current.revision, now, id, candidate.entryId);
            continue;
          }
          if (
            !current ||
            current.revision !== candidate.targetAppliedRevision ||
            schedulerJobDefinitionDigest(current) !== stagedDigest
          ) {
            throw schedulerMigrationError(
              "SCHEDULER_MIGRATION_TARGET_CHANGED",
              `Scheduler migration target changed before activation: ${candidate.targetJobId}`,
              {
                entryId: candidate.entryId,
                targetJobId: candidate.targetJobId,
              },
            );
          }
          activations.push({ candidate, current, intended });
        }
        for (const { candidate, current, intended } of activations) {
          const activated =
            schedulerJobDefinitionDigest(current) === candidate.targetJobDigest
              ? current
              : this.updateJob(current.id, current.revision, {
                  kind: intended.kind,
                  trigger: intended.trigger,
                  payload: intended.payload,
                  authority: intended.authority,
                  enabled: intended.enabled,
                  maxAttempts: intended.maxAttempts,
                });
          this.db
            .prepare(
              `UPDATE scheduler_domain_migration_entries
               SET target_applied_revision = ?, updated_at = ?
               WHERE migration_id = ? AND entry_id = ? AND state = 'retired'`,
            )
            .run(activated.revision, now, id, candidate.entryId);
        }
        this.db
          .prepare(
            `UPDATE scheduler_domain_migrations
             SET state = 'retired', updated_at = ?, completed_at = ?
             WHERE migration_id = ? AND state = 'retiring'`,
          )
          .run(now, now, id);
      }
      return {
        ...mapDomainMigrationEntry(
          this.statements.getDomainMigrationEntry.get(id, normalizedEntryId),
        ),
        deduplicated: false,
      };
    });
  }

  beginDomainMigrationRollback(migrationId) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const now = this._now();
    return this._write(() => {
      const migration = this._domainMigration(id);
      if (migration.state === SCHEDULER_MIGRATION_STATES.ROLLING_BACK) {
        return this._rollbackDomainMigrationTargetsInTransaction(id, now);
      }
      if (migration.state === SCHEDULER_MIGRATION_STATES.ROLLED_BACK) {
        return { ...migration, deduplicated: true };
      }
      if (
        ![
          SCHEDULER_MIGRATION_STATES.PREPARED,
          SCHEDULER_MIGRATION_STATES.APPLIED,
          SCHEDULER_MIGRATION_STATES.VERIFIED,
          SCHEDULER_MIGRATION_STATES.RETIRING,
          SCHEDULER_MIGRATION_STATES.RETIRED,
        ].includes(migration.state)
      ) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          `Scheduler migration cannot roll back from state ${migration.state}`,
        );
      }
      this.db
        .prepare(
          `UPDATE scheduler_domain_migrations
           SET state = 'rolling_back', updated_at = ?, completed_at = NULL
           WHERE migration_id = ?
             AND state IN ('prepared', 'applied', 'verified', 'retiring', 'retired')`,
        )
        .run(now, id);
      return this._rollbackDomainMigrationTargetsInTransaction(
        id,
        now,
        migration.state,
      );
    });
  }

  restoreDomainMigrationEntrySource({
    migrationId,
    entryId,
    retirementToken,
    restoreSource,
  } = {}) {
    if (typeof restoreSource !== "function") {
      throw invalidArgument("restoreSource must be a function");
    }
    const id = normalizeIdentifier(migrationId, "migrationId");
    const normalizedEntryId = normalizeIdentifier(entryId, "entryId");
    const token =
      retirementToken === null || retirementToken === undefined
        ? null
        : normalizeIdentifier(retirementToken, "retirementToken");
    const now = this._now();
    return this._write(() =>
      this._restoreDomainMigrationEntrySourceInTransaction({
        migrationId: id,
        entryId: normalizedEntryId,
        retirementToken: token,
        restoreSource,
        now,
      }),
    );
  }

  confirmDomainMigrationEntrySourceRestored({
    migrationId,
    entryId,
    retirementToken,
    source,
  } = {}) {
    return this.restoreDomainMigrationEntrySource({
      migrationId,
      entryId,
      retirementToken,
      restoreSource: () => source,
    });
  }

  _restoreDomainMigrationEntrySourceInTransaction({
    migrationId,
    entryId,
    retirementToken,
    restoreSource,
    now,
  }) {
    const migration = this._domainMigration(migrationId);
    if (
      ![
        SCHEDULER_MIGRATION_STATES.ROLLING_BACK,
        SCHEDULER_MIGRATION_STATES.ROLLED_BACK,
      ].includes(migration.state)
    ) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_STATE_CONFLICT",
        "Scheduler migration is not rolling back",
      );
    }
    const entry = mapDomainMigrationEntry(
      this.statements.getDomainMigrationEntry.get(migrationId, entryId),
    );
    if (!entry || entry.retirementToken !== retirementToken) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_STATE_CONFLICT",
        "Scheduler migration source restoration token does not match",
      );
    }
    if (entry.state === "rolled_back") {
      if (entry.sourceRestoredDigest !== entry.sourceDigest) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_SOURCE_MISMATCH",
          "Restored scheduler source evidence does not match the journal",
        );
      }
      return { ...entry, deduplicated: true };
    }
    if (entry.state === "rollback_target_disabled") {
      this._assertDomainMigrationRollbackTarget(migration, entry);
    } else if (entry.state !== "prepared") {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_STATE_CONFLICT",
        `Scheduler migration entry cannot restore its source from state ${entry.state}`,
      );
    }

    const restoredSource = restoreSource();
    if (restoredSource && typeof restoredSource.then === "function") {
      throw invalidArgument("restoreSource must complete synchronously");
    }
    const restoredDigest = schedulerMigrationSourceDigest(restoredSource);
    if (restoredDigest !== entry.sourceDigest) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_SOURCE_CHANGED",
        "Restored scheduler source does not match its pre-migration digest",
        { entryId, sourceId: entry.sourceId },
      );
    }
    const update = this.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries
         SET state = 'rolled_back', source_restored_digest = ?, updated_at = ?
         WHERE migration_id = ? AND entry_id = ?
           AND state IN ('prepared', 'rollback_target_disabled')`,
      )
      .run(restoredDigest, now, migrationId, entryId);
    if (update.changes !== 1) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_STATE_CONFLICT",
        "Scheduler migration source restoration lost its journal fence",
      );
    }
    const remaining = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM scheduler_domain_migration_entries
         WHERE migration_id = ? AND state <> 'rolled_back'`,
      )
      .get(migrationId).count;
    if (remaining === 0) {
      this.db
        .prepare(
          `UPDATE scheduler_domain_migrations
           SET state = 'rolled_back', updated_at = ?, completed_at = ?
           WHERE migration_id = ? AND state = 'rolling_back'`,
        )
        .run(now, now, migrationId);
    }
    return {
      ...mapDomainMigrationEntry(
        this.statements.getDomainMigrationEntry.get(migrationId, entryId),
      ),
      deduplicated: false,
    };
  }

  rollbackDomainMigrationTargets(migrationId) {
    const id = normalizeIdentifier(migrationId, "migrationId");
    const now = this._now();
    return this._write(() => {
      const migration = this._domainMigration(id);
      if (migration.state === SCHEDULER_MIGRATION_STATES.ROLLED_BACK) {
        return { ...migration, deduplicated: true };
      }
      if (migration.state !== SCHEDULER_MIGRATION_STATES.ROLLING_BACK) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_STATE_CONFLICT",
          "Scheduler migration is not rolling back",
        );
      }
      return this._rollbackDomainMigrationTargetsInTransaction(id, now);
    });
  }

  _rollbackDomainMigrationTargetsInTransaction(
    migrationId,
    now,
    rollbackFromState = null,
  ) {
    const migration = this._domainMigration(migrationId);
    const invalid = migration.entries.filter(
      (entry) =>
        ![
          "prepared",
          "applied",
          "verified",
          "retired",
          "retiring",
          "source_restored",
          "rollback_target_disabled",
          "rolled_back",
        ].includes(entry.state),
    );
    if (invalid.length > 0) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_STATE_CONFLICT",
        "Scheduler migration entries are not ready for target rollback",
        { entryIds: invalid.map((entry) => entry.entryId) },
      );
    }
    const targetRollbackEntries = migration.entries.filter(
      (entry) => entry.state === "rollback_target_disabled",
    );
    for (const entry of targetRollbackEntries) {
      this._assertDomainMigrationRollbackTarget(migration, entry);
    }
    const pending = [...migration.entries]
      .reverse()
      .filter(
        (entry) =>
          !["prepared", "rollback_target_disabled", "rolled_back"].includes(
            entry.state,
          ),
      );
    const snapshots = new Map();
    for (const entry of pending) {
      const current = mapJob(this.statements.getJob.get(entry.targetJobId));
      if (!current || current.revision !== entry.targetAppliedRevision) {
        throw schedulerMigrationError(
          "SCHEDULER_MIGRATION_TARGET_CHANGED",
          `Scheduler migration target revision changed before rollback: ${entry.targetJobId}`,
          {
            expectedRevision: entry.targetAppliedRevision,
            actualRevision: current?.revision ?? null,
          },
        );
      }
      this._assertDomainMigrationTargetBeforeRollback(
        migration,
        entry,
        current,
        rollbackFromState,
      );
      this._assertDomainMigrationTargetExecutionEvidence(entry);
      snapshots.set(entry.entryId, current);
    }
    for (const entry of pending) {
      if (entry.state === "rollback_target_disabled") continue;
      const current = snapshots.get(entry.entryId);
      let rolledBack;
      if (
        entry.targetAction === "created" ||
        entry.rollbackStrategy === "disable"
      ) {
        rolledBack = current.enabled
          ? this.updateJob(current.id, current.revision, { enabled: false })
          : current;
      } else {
        const before = normalizeJobInput(entry.targetBefore);
        rolledBack =
          schedulerJobDefinitionDigest(current) ===
          schedulerJobDefinitionDigest(before)
            ? current
            : this.updateJob(current.id, current.revision, {
                kind: before.kind,
                trigger: before.trigger,
                payload: before.payload,
                authority: before.authority,
                enabled: before.enabled,
                maxAttempts: before.maxAttempts,
              });
      }
      this.db
        .prepare(
          `UPDATE scheduler_domain_migration_entries
             SET state = 'rollback_target_disabled',
                 target_rollback_revision = ?, updated_at = ?
             WHERE migration_id = ? AND entry_id = ?
               AND state IN (
                 'applied', 'verified', 'retiring', 'retired', 'source_restored'
               )`,
        )
        .run(rolledBack.revision, now, migrationId, entry.entryId);
    }
    this.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries
           SET source_restored_digest = NULL, updated_at = ?
           WHERE migration_id = ? AND state = 'rollback_target_disabled'
             AND source_restored_digest IS NOT NULL`,
      )
      .run(now, migrationId);
    return {
      ...this._domainMigration(migrationId),
      deduplicated: pending.length === 0,
    };
  }

  _assertDomainMigrationTargetBeforeRollback(
    migration,
    entry,
    current,
    rollbackFromState,
  ) {
    const manifestEntry = migration.manifest.entries.find(
      (candidate) => candidate.entryId === entry.entryId,
    );
    if (!manifestEntry) {
      throw schemaError(
        "SCHEDULER_DATA_CORRUPT",
        "Scheduler migration entry is absent from its manifest",
      );
    }
    const intended = normalizeJobInput(manifestEntry.targetJob);
    const resumedRetiredMigration =
      rollbackFromState === null &&
      entry.state === "retired" &&
      migration.entries.every((candidate) =>
        ["retired", "rollback_target_disabled", "rolled_back"].includes(
          candidate.state,
        ),
      );
    const targetWasActivated =
      rollbackFromState === SCHEDULER_MIGRATION_STATES.RETIRED ||
      resumedRetiredMigration;
    const expected = targetWasActivated
      ? intended
      : { ...intended, enabled: false };
    const expectedDigest = schedulerJobDefinitionDigest(expected);
    const actualDigest = schedulerJobDefinitionDigest(current);
    if (actualDigest !== expectedDigest) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_TARGET_CHANGED",
        `Scheduler migration target definition changed before rollback: ${entry.targetJobId}`,
        {
          expectedRevision: entry.targetAppliedRevision,
          actualRevision: current.revision,
          expectedDefinitionDigest: expectedDigest,
          actualDefinitionDigest: actualDigest,
        },
      );
    }
  }

  _assertDomainMigrationRollbackTarget(migration, entry) {
    const current = mapJob(this.statements.getJob.get(entry.targetJobId));
    const manifestEntry = migration.manifest.entries.find(
      (candidate) => candidate.entryId === entry.entryId,
    );
    if (
      !current ||
      current.revision !== entry.targetRollbackRevision ||
      !manifestEntry ||
      !this._isExpectedDomainMigrationRollbackTarget(
        entry,
        current,
        manifestEntry.targetJob,
      )
    ) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_TARGET_CHANGED",
        `Scheduler migration target changed after rollback: ${entry.targetJobId}`,
        {
          expectedRevision: entry.targetRollbackRevision,
          actualRevision: current?.revision ?? null,
        },
      );
    }
    this._assertDomainMigrationTargetExecutionEvidence(entry);
  }

  _isExpectedDomainMigrationRollbackTarget(entry, current, targetJob) {
    if (
      entry.targetAction === "created" ||
      entry.rollbackStrategy === "disable"
    ) {
      const intended = normalizeJobInput(targetJob);
      return (
        schedulerJobDefinitionDigest(current) ===
        schedulerJobDefinitionDigest({ ...intended, enabled: false })
      );
    }
    return (
      entry.targetBefore !== null &&
      schedulerJobDefinitionDigest(current) ===
        schedulerJobDefinitionDigest(entry.targetBefore)
    );
  }

  _assertDomainMigrationTargetExecutionEvidence(entry) {
    const counts = this.db
      .prepare(
        `SELECT
             (SELECT COUNT(*) FROM occurrences WHERE job_id = ?) AS occurrences,
             (SELECT COUNT(*) FROM events
              WHERE job_id = ? AND occurrence_id IS NOT NULL) AS execution_events`,
      )
      .get(entry.targetJobId, entry.targetJobId);
    if (
      counts.occurrences !== entry.targetOccurrenceCountBefore ||
      counts.execution_events !== entry.targetExecutionEventCountBefore
    ) {
      throw schedulerMigrationError(
        "SCHEDULER_MIGRATION_EXECUTION_EVIDENCE",
        `Scheduler migration target has execution evidence and cannot be rolled back: ${entry.targetJobId}`,
        {
          occurrenceCountBefore: entry.targetOccurrenceCountBefore,
          occurrenceCountNow: counts.occurrences,
          executionEventCountBefore: entry.targetExecutionEventCountBefore,
          executionEventCountNow: counts.execution_events,
        },
      );
    }
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

  getOccurrenceControl(occurrenceId) {
    this._assertOpen();
    return mapOccurrenceControl(
      this.statements.getOccurrenceControl.get(
        normalizeIdentifier(occurrenceId, "occurrenceId"),
      ),
    );
  }

  /**
   * Enumerate the small, public runtime-control surface used by Automation
   * Center. This intentionally does not reuse mapOccurrence(): payload,
   * authority, lease ownership, checkpoints, results and error bodies never
   * cross this read boundary.
   */
  listRuntimeControlOccurrences({
    statuses = RUNTIME_CONTROL_OCCURRENCE_STATUSES,
    jobKinds = RUNTIME_CONTROL_JOB_KINDS,
    limit = 50,
  } = {}) {
    this._assertOpen();
    const selectedStatuses = normalizeRuntimeControlEnumeration(
      statuses,
      RUNTIME_CONTROL_OCCURRENCE_STATUS_SET,
      "statuses",
    );
    const selectedJobKinds = normalizeRuntimeControlEnumeration(
      jobKinds,
      RUNTIME_CONTROL_JOB_KIND_SET,
      "jobKinds",
    );
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw invalidArgument("limit must be a positive integer");
    }
    const boundedLimit = Math.min(limit, MAX_RUNTIME_CONTROL_OCCURRENCES);
    const statusParameters = selectedStatuses.map(() => "?").join(", ");
    const kindParameters = selectedJobKinds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT o.occurrence_id, o.job_id, j.kind AS job_kind,
                CASE
                  WHEN c.state = 'pause_requested' THEN 'pause_requested'
                  WHEN c.state = 'paused' THEN 'paused'
                  ELSE 'running'
                END AS runtime_status,
                o.status AS occurrence_status, o.scheduled_for, o.attempt,
                o.max_attempts, o.fence, o.created_at, o.updated_at,
                c.state AS control_state, c.revision AS control_revision,
                c.expected_fence AS control_expected_fence,
                c.capability_digest AS control_capability_digest,
                c.requested_at AS control_requested_at,
                c.paused_at AS control_paused_at,
                c.updated_at AS control_updated_at
         FROM occurrences o
         JOIN jobs j ON j.job_id = o.job_id
         LEFT JOIN scheduler_occurrence_controls c
           ON c.occurrence_id = o.occurrence_id
         WHERE j.kind IN (${kindParameters})
           AND (
             (o.status = 'running' AND c.occurrence_id IS NULL)
             OR (o.status = 'running' AND c.state = 'pause_requested')
             OR (o.status = 'running' AND c.state = 'resumed')
             OR (o.status = 'retry_wait' AND c.state = 'paused')
           )
           AND CASE
                 WHEN c.state = 'pause_requested' THEN 'pause_requested'
                 WHEN c.state = 'paused' THEN 'paused'
                 ELSE 'running'
               END IN (${statusParameters})
         ORDER BY o.updated_at DESC, o.occurrence_id ASC
         LIMIT ?`,
      )
      .all(...selectedJobKinds, ...selectedStatuses, boundedLimit);
    return rows.map(mapRuntimeControlOccurrence);
  }

  requestOccurrencePause({
    occurrenceId,
    expectedFence,
    expectedRevision,
    requestId,
    capability,
  } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const fence = assertPositiveSafeInteger(expectedFence, "expectedFence");
    const request = normalizeIdentifier(requestId, "requestId", {
      maxLength: 128,
    });
    const revision =
      expectedRevision === undefined
        ? null
        : (() => {
            if (
              !Number.isSafeInteger(expectedRevision) ||
              expectedRevision < 0
            ) {
              throw invalidArgument(
                "expectedRevision must be a non-negative integer",
              );
            }
            return expectedRevision;
          })();
    const normalizedCapability = normalizeRuntimeControlCapability(capability);
    if (
      normalizedCapability.pauseResume !== RUNTIME_PAUSE_RESUME.CHECKPOINT_V1
    ) {
      throw new SchedulerKernelError(
        "SCHEDULER_PAUSE_UNSUPPORTED",
        "Scheduler adapter does not declare durable checkpoint pause/resume",
      );
    }
    const capabilityJson = canonicalJson(
      normalizedCapability,
      "runtimeControl.capability",
    );
    const capabilityDigest =
      schedulerRuntimeControlCapabilityDigest(normalizedCapability);
    const now = this._now();
    return this._write(() => {
      const occurrence = this.statements.getOccurrence.get(id);
      if (!occurrence) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence does not exist: ${id}`,
        );
      }
      const requestOwner =
        this.statements.getOccurrenceControlByPauseRequest.get(request);
      if (requestOwner && requestOwner.occurrence_id !== id) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          "Scheduler pause request is already bound to another occurrence",
        );
      }
      const current = this.statements.getOccurrenceControl.get(id);
      if (current?.pause_request_id === request) {
        if (
          current.expected_fence !== fence ||
          current.capability_digest !== capabilityDigest
        ) {
          throw new SchedulerKernelError(
            "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
            `Scheduler pause request evidence changed: ${id}`,
          );
        }
        return { ...mapOccurrenceControl(current), deduplicated: true };
      }
      const actualRevision = current?.revision ?? 0;
      if (revision !== null && actualRevision !== revision) {
        throw new SchedulerKernelError(
          "SCHEDULER_REVISION_CONFLICT",
          `Scheduler occurrence control revision changed: ${id}`,
          { expectedRevision: revision, actualRevision },
        );
      }
      if (current && current.state !== "terminal") {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          `Scheduler occurrence already has an active runtime control: ${id}`,
          { state: current.state, revision: current.revision },
        );
      }
      if (occurrence.status !== OCCURRENCE_STATUS.RUNNING) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_NOT_RUNNING",
          `Scheduler occurrence is not running: ${id}`,
          { status: occurrence.status },
        );
      }
      if (occurrence.fence !== fence) {
        throw new SchedulerKernelError(
          "SCHEDULER_FENCE_CONFLICT",
          `Scheduler occurrence fence changed: ${id}`,
          { expectedFence: fence, actualFence: occurrence.fence },
        );
      }
      if (occurrence.lease_expires_at <= now) throw leaseLost(id);
      if (current) {
        this.db
          .prepare(
            `UPDATE scheduler_occurrence_controls
             SET capability_json = @capabilityJson,
                 capability_digest = @capabilityDigest,
                 state = 'pause_requested', revision = revision + 1,
                 pause_request_id = @requestId, resume_request_id = NULL,
                 expected_fence = @expectedFence, checkpoint_json = NULL,
                 requested_at = @now, paused_at = NULL, resumed_at = NULL,
                 terminal_at = NULL, updated_at = @now
             WHERE occurrence_id = @occurrenceId AND state = 'terminal'`,
          )
          .run({
            occurrenceId: id,
            capabilityJson,
            capabilityDigest,
            requestId: request,
            expectedFence: fence,
            now,
          });
      } else {
        this.db
          .prepare(
            `INSERT INTO scheduler_occurrence_controls
               (occurrence_id, capability_json, capability_digest, state,
                revision, pause_request_id, resume_request_id, expected_fence,
                checkpoint_json, requested_at, paused_at, resumed_at,
                terminal_at, updated_at)
             VALUES (@occurrenceId, @capabilityJson, @capabilityDigest,
                     'pause_requested', 1, @requestId, NULL, @expectedFence,
                     NULL, @now, NULL, NULL, NULL, @now)`,
          )
          .run({
            occurrenceId: id,
            capabilityJson,
            capabilityDigest,
            requestId: request,
            expectedFence: fence,
            now,
          });
      }
      const control = this.statements.getOccurrenceControl.get(id);
      this._appendEvent({
        jobId: occurrence.job_id,
        occurrenceId: id,
        type: "occurrence_pause_requested",
        occurredAt: now,
        fence,
        data: {
          requestId: request,
          controlRevision: control.revision,
          capabilityDigest,
        },
      });
      return { ...mapOccurrenceControl(control), deduplicated: false };
    });
  }

  ackOccurrencePause({
    occurrenceId,
    ownerId,
    fence,
    requestId,
    expectedRevision,
    safePoint,
    checkpoint,
  } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const owner = normalizeIdentifier(ownerId, "ownerId");
    const token = assertPositiveSafeInteger(fence, "fence");
    const request = normalizeIdentifier(requestId, "requestId", {
      maxLength: 128,
    });
    const revision = assertPositiveSafeInteger(
      expectedRevision,
      "expectedRevision",
    );
    const point = normalizeIdentifier(safePoint, "safePoint", {
      maxLength: 64,
    });
    if (!Object.values(RUNTIME_CONTROL_SAFE_POINTS).includes(point)) {
      throw invalidArgument("safePoint is not a scheduler runtime safe point");
    }
    const normalizedCheckpoint = normalizeRuntimeCheckpoint({
      schemaVersion: 1,
      safePoint: point,
      data: checkpoint ?? null,
    });
    const now = this._now();
    return this._write(() => {
      const occurrence = this.statements.getOccurrence.get(id);
      const controlRow = this.statements.getOccurrenceControl.get(id);
      if (!occurrence || !controlRow) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence control does not exist: ${id}`,
        );
      }
      const control = mapOccurrenceControl(controlRow);
      if (
        control.state !== "pause_requested" ||
        control.pauseRequestId !== request
      ) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          `Scheduler pause request is no longer pending: ${id}`,
          { state: control.state, revision: control.revision },
        );
      }
      if (control.revision !== revision) {
        throw new SchedulerKernelError(
          "SCHEDULER_REVISION_CONFLICT",
          `Scheduler occurrence control revision changed: ${id}`,
          { expectedRevision: revision, actualRevision: control.revision },
        );
      }
      if (
        control.expectedFence !== token ||
        occurrence.status !== OCCURRENCE_STATUS.RUNNING ||
        occurrence.fence !== token ||
        occurrence.lease_owner !== owner ||
        occurrence.lease_expires_at <= now
      ) {
        throw leaseLost(id);
      }
      if (!control.capability.safePoints.includes(point)) {
        throw new SchedulerKernelError(
          "SCHEDULER_PAUSE_UNSUPPORTED_SAFE_POINT",
          `Scheduler adapter did not declare pause safety at ${point}`,
        );
      }
      const occurrenceUpdate = this.db
        .prepare(
          `UPDATE occurrences
           SET status = 'retry_wait', available_at = @now,
               lease_owner = NULL, lease_expires_at = NULL,
               updated_at = @now, settled_at = NULL
           WHERE occurrence_id = @occurrenceId AND status = 'running'
             AND lease_owner = @ownerId AND fence = @fence
             AND lease_expires_at > @now`,
        )
        .run({ occurrenceId: id, ownerId: owner, fence: token, now });
      if (occurrenceUpdate.changes !== 1) throw leaseLost(id);
      const controlUpdate = this.db
        .prepare(
          `UPDATE scheduler_occurrence_controls
           SET state = 'paused', revision = revision + 1,
               checkpoint_json = @checkpointJson,
               paused_at = @now, updated_at = @now
           WHERE occurrence_id = @occurrenceId
             AND state = 'pause_requested' AND revision = @revision
             AND pause_request_id = @requestId AND expected_fence = @fence`,
        )
        .run({
          occurrenceId: id,
          checkpointJson: normalizedCheckpoint.encoded,
          now,
          revision,
          requestId: request,
          fence: token,
        });
      if (controlUpdate.changes !== 1) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          `Scheduler pause acknowledgement lost its CAS: ${id}`,
        );
      }
      this._appendEvent({
        jobId: occurrence.job_id,
        occurrenceId: id,
        type: "occurrence_paused",
        occurredAt: now,
        fence: token,
        data: {
          requestId: request,
          safePoint: point,
          checkpointDigest: sha256PayloadDigest(
            normalizedCheckpoint.checkpoint,
            "runtimeControl.checkpoint",
          ),
        },
      });
      return {
        control: mapOccurrenceControl(
          this.statements.getOccurrenceControl.get(id),
        ),
        occurrence: mapOccurrence(this.statements.getOccurrence.get(id)),
      };
    });
  }

  resumeOccurrence({ occurrenceId, expectedRevision, requestId } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const revision = assertPositiveSafeInteger(
      expectedRevision,
      "expectedRevision",
    );
    const request = normalizeIdentifier(requestId, "requestId", {
      maxLength: 128,
    });
    const now = this._now();
    return this._write(() => {
      const occurrence = this.statements.getOccurrence.get(id);
      const controlRow = this.statements.getOccurrenceControl.get(id);
      if (!occurrence || !controlRow) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence control does not exist: ${id}`,
        );
      }
      const requestOwner =
        this.statements.getOccurrenceControlByResumeRequest.get(request);
      if (requestOwner && requestOwner.occurrence_id !== id) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          "Scheduler resume request is already bound to another occurrence",
        );
      }
      const control = mapOccurrenceControl(controlRow);
      if (control.resumeRequestId === request) {
        return {
          control: { ...control, deduplicated: true },
          occurrence: mapOccurrence(occurrence),
        };
      }
      if (control.state !== "paused") {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          `Scheduler occurrence is not paused: ${id}`,
          { state: control.state, revision: control.revision },
        );
      }
      if (control.revision !== revision) {
        throw new SchedulerKernelError(
          "SCHEDULER_REVISION_CONFLICT",
          `Scheduler occurrence control revision changed: ${id}`,
          { expectedRevision: revision, actualRevision: control.revision },
        );
      }
      if (
        occurrence.status !== OCCURRENCE_STATUS.RETRY_WAIT ||
        occurrence.lease_owner !== null ||
        occurrence.lease_expires_at !== null
      ) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          `Paused occurrence state is inconsistent: ${id}`,
        );
      }
      const update = this.db
        .prepare(
          `UPDATE scheduler_occurrence_controls
           SET state = 'resumed', revision = revision + 1,
               resume_request_id = @requestId, resumed_at = @now,
               updated_at = @now
           WHERE occurrence_id = @occurrenceId AND state = 'paused'
             AND revision = @revision`,
        )
        .run({ occurrenceId: id, requestId: request, now, revision });
      if (update.changes !== 1) {
        throw new SchedulerKernelError(
          "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
          `Scheduler resume request lost its CAS: ${id}`,
        );
      }
      this.db
        .prepare(
          `UPDATE occurrences SET available_at = ?, updated_at = ?
           WHERE occurrence_id = ? AND status = 'retry_wait'`,
        )
        .run(now, now, id);
      this._appendEvent({
        jobId: occurrence.job_id,
        occurrenceId: id,
        type: "occurrence_resume_requested",
        occurredAt: now,
        fence: occurrence.fence,
        data: { requestId: request, controlRevision: revision + 1 },
      });
      return {
        control: mapOccurrenceControl(
          this.statements.getOccurrenceControl.get(id),
        ),
        occurrence: mapOccurrence(this.statements.getOccurrence.get(id)),
      };
    });
  }

  requeueDeadLetter({
    occurrenceId,
    expectedFence,
    expectedErrorCode,
    requestId,
  } = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const fence = assertPositiveSafeInteger(expectedFence, "expectedFence");
    const errorCode = normalizeIdentifier(
      expectedErrorCode,
      "expectedErrorCode",
      {
        maxLength: 128,
      },
    );
    const request = normalizeIdentifier(requestId, "requestId", {
      maxLength: 128,
    });
    const now = this._now();
    return this._write(() => {
      const existing = this.statements.getOccurrenceRetryByRequest.get(request);
      if (existing) {
        if (
          existing.occurrence_id !== id ||
          existing.expected_fence !== fence ||
          existing.expected_error_code !== errorCode
        ) {
          throw new SchedulerKernelError(
            "SCHEDULER_REQUEUE_CONFLICT",
            "Scheduler retry request evidence changed",
          );
        }
        return {
          occurrence: mapOccurrence(this.statements.getOccurrence.get(id)),
          requestId: request,
          deduplicated: true,
        };
      }
      const occurrence = this.statements.getOccurrence.get(id);
      if (!occurrence) {
        throw new SchedulerKernelError(
          "SCHEDULER_NOT_FOUND",
          `Scheduler occurrence does not exist: ${id}`,
        );
      }
      const lastError =
        occurrence.last_error_json === null
          ? null
          : readStoredJson(occurrence.last_error_json, "occurrence error");
      if (
        occurrence.status !== OCCURRENCE_STATUS.DEAD_LETTER ||
        occurrence.fence !== fence ||
        lastError?.code !== errorCode
      ) {
        throw new SchedulerKernelError(
          "SCHEDULER_REQUEUE_EVIDENCE_CONFLICT",
          `Scheduler dead-letter evidence changed: ${id}`,
          {
            status: occurrence.status,
            expectedFence: fence,
            actualFence: occurrence.fence,
            expectedErrorCode: errorCode,
            actualErrorCode: lastError?.code ?? null,
          },
        );
      }
      this.db
        .prepare(
          `INSERT INTO scheduler_occurrence_retries
             (occurrence_id, request_id, expected_fence,
              expected_error_code, created_at, claimed_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
        )
        .run(id, request, fence, errorCode, now);
      const update = this.db
        .prepare(
          `UPDATE occurrences
           SET status = 'retry_wait', available_at = ?, updated_at = ?,
               settled_at = NULL
           WHERE occurrence_id = ? AND status = 'dead_letter' AND fence = ?`,
        )
        .run(now, now, id, fence);
      if (update.changes !== 1) {
        throw new SchedulerKernelError(
          "SCHEDULER_REQUEUE_CONFLICT",
          `Scheduler dead letter changed during requeue: ${id}`,
        );
      }
      this._appendEvent({
        jobId: occurrence.job_id,
        occurrenceId: id,
        type: "occurrence_requeued",
        occurredAt: now,
        fence,
        data: { requestId: request, expectedErrorCode: errorCode },
      });
      return {
        occurrence: mapOccurrence(this.statements.getOccurrence.get(id)),
        requestId: request,
        deduplicated: false,
      };
    });
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
          AND NOT EXISTS (
            SELECT 1 FROM scheduler_occurrence_controls c
            WHERE c.occurrence_id = occurrences.occurrence_id
              AND c.state IN ('pause_requested', 'resumed')
          )
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
        AND NOT EXISTS (
          SELECT 1 FROM scheduler_occurrence_controls c
          WHERE c.occurrence_id = occurrences.occurrence_id
            AND c.state IN ('pause_requested', 'resumed')
        )
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
          SELECT o.*, c.state AS control_state,
                 c.expected_fence AS control_expected_fence,
                 r.request_id AS retry_request_id
          FROM occurrences o
          JOIN jobs j ON j.job_id = o.job_id
          LEFT JOIN scheduler_occurrence_controls c
            ON c.occurrence_id = o.occurrence_id
          LEFT JOIN scheduler_occurrence_retries r
            ON r.occurrence_id = o.occurrence_id
           AND r.claimed_at IS NULL
           AND r.expected_fence = o.fence
          WHERE j.enabled = 1
            AND (@jobKind IS NULL OR j.kind = @jobKind)
            AND (
              @workspaceId IS NULL
              OR json_extract(j.authority_json, '$.workspaceId') = @workspaceId
            )
            AND (
              o.attempt < o.max_attempts
              OR c.state IN ('pause_requested', 'resumed')
              OR r.request_id IS NOT NULL
            )
            AND (c.state IS NULL OR c.state <> 'paused')
            AND (
              c.state IS NULL OR c.state <> 'pause_requested'
              OR o.status = 'running'
            )
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
              attempt = attempt + CASE
                WHEN EXISTS (
                  SELECT 1 FROM scheduler_occurrence_controls c
                  WHERE c.occurrence_id = occurrences.occurrence_id
                    AND c.state = 'pause_requested'
                ) THEN 0
                WHEN EXISTS (
                  SELECT 1 FROM scheduler_occurrence_controls c
                  WHERE c.occurrence_id = occurrences.occurrence_id
                    AND c.state = 'resumed'
                    AND c.expected_fence = occurrences.fence
                ) THEN 0
                WHEN EXISTS (
                  SELECT 1 FROM scheduler_occurrence_retries r
                  WHERE r.occurrence_id = occurrences.occurrence_id
                    AND r.claimed_at IS NULL
                    AND r.expected_fence = occurrences.fence
                ) THEN 0
                ELSE 1 END,
              fence = fence + 1,
              lease_owner = @ownerId,
              lease_expires_at = @leaseExpiresAt,
              updated_at = @now,
              settled_at = NULL
          WHERE occurrence_id = @occurrenceId
            AND fence = @expectedFence
            AND (
              attempt < max_attempts
              OR EXISTS (
                SELECT 1 FROM scheduler_occurrence_controls c
                WHERE c.occurrence_id = occurrences.occurrence_id
                  AND c.state IN ('pause_requested', 'resumed')
              )
              OR EXISTS (
                SELECT 1 FROM scheduler_occurrence_retries r
                WHERE r.occurrence_id = occurrences.occurrence_id
                  AND r.claimed_at IS NULL
                  AND r.expected_fence = occurrences.fence
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM scheduler_occurrence_controls c
              WHERE c.occurrence_id = occurrences.occurrence_id
                AND c.state = 'paused'
            )
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
      if (candidate.control_state === "pause_requested") {
        this.db
          .prepare(
            `UPDATE scheduler_occurrence_controls
             SET expected_fence = ?, revision = revision + 1, updated_at = ?
             WHERE occurrence_id = ? AND state = 'pause_requested'
               AND expected_fence = ?`,
          )
          .run(
            claimed.fence,
            now,
            candidate.occurrence_id,
            candidate.control_expected_fence,
          );
      } else if (candidate.control_state === "resumed") {
        const rebound = this.db
          .prepare(
            `UPDATE scheduler_occurrence_controls
             SET expected_fence = ?, revision = revision + 1, updated_at = ?
             WHERE occurrence_id = ? AND state = 'resumed'
               AND expected_fence = ?`,
          )
          .run(
            claimed.fence,
            now,
            candidate.occurrence_id,
            candidate.control_expected_fence,
          );
        if (rebound.changes !== 1) {
          throw new SchedulerKernelError(
            "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
            `Scheduler resume checkpoint lost its claim fence: ${candidate.occurrence_id}`,
          );
        }
      }
      if (candidate.retry_request_id !== null) {
        this.db
          .prepare(
            `UPDATE scheduler_occurrence_retries SET claimed_at = ?
             WHERE occurrence_id = ? AND request_id = ? AND claimed_at IS NULL`,
          )
          .run(now, candidate.occurrence_id, candidate.retry_request_id);
      }
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
          ...(candidate.control_state === "pause_requested"
            ? { pauseRequestRebound: true }
            : {}),
          ...(candidate.control_state === "resumed"
            ? { resumedWithoutAttempt: true }
            : {}),
          ...(candidate.retry_request_id === null
            ? {}
            : { retryRequestId: candidate.retry_request_id }),
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
      const controlRow = this.statements.getOccurrenceControl.get(id);
      const retryRow = this.db
        .prepare(
          `SELECT * FROM scheduler_occurrence_retries
           WHERE occurrence_id = ? AND claimed_at IS NULL
             AND expected_fence = ? ORDER BY created_at, request_id LIMIT 1`,
        )
        .get(id, candidate.fence);
      const eligible =
        job?.enabled === 1 &&
        (candidate.attempt < candidate.max_attempts ||
          ["pause_requested", "resumed"].includes(controlRow?.state) ||
          retryRow !== undefined) &&
        controlRow?.state !== "paused" &&
        !(
          controlRow?.state === "pause_requested" &&
          candidate.status !== OCCURRENCE_STATUS.RUNNING
        ) &&
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
              attempt = attempt + CASE
                WHEN EXISTS (
                  SELECT 1 FROM scheduler_occurrence_controls c
                  WHERE c.occurrence_id = occurrences.occurrence_id
                    AND c.state = 'pause_requested'
                ) THEN 0
                WHEN EXISTS (
                  SELECT 1 FROM scheduler_occurrence_controls c
                  WHERE c.occurrence_id = occurrences.occurrence_id
                    AND c.state = 'resumed'
                    AND c.expected_fence = occurrences.fence
                ) THEN 0
                WHEN EXISTS (
                  SELECT 1 FROM scheduler_occurrence_retries r
                  WHERE r.occurrence_id = occurrences.occurrence_id
                    AND r.claimed_at IS NULL
                    AND r.expected_fence = occurrences.fence
                ) THEN 0
                ELSE 1 END,
              fence = fence + 1,
              lease_owner = @ownerId,
              lease_expires_at = @leaseExpiresAt,
              updated_at = @now,
              settled_at = NULL
          WHERE occurrence_id = @occurrenceId
            AND fence = @expectedFence
            AND (
              attempt < max_attempts
              OR EXISTS (
                SELECT 1 FROM scheduler_occurrence_controls c
                WHERE c.occurrence_id = occurrences.occurrence_id
                  AND c.state IN ('pause_requested', 'resumed')
              )
              OR EXISTS (
                SELECT 1 FROM scheduler_occurrence_retries r
                WHERE r.occurrence_id = occurrences.occurrence_id
                  AND r.claimed_at IS NULL
                  AND r.expected_fence = occurrences.fence
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM scheduler_occurrence_controls c
              WHERE c.occurrence_id = occurrences.occurrence_id
                AND c.state = 'paused'
            )
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
      if (controlRow?.state === "pause_requested") {
        this.db
          .prepare(
            `UPDATE scheduler_occurrence_controls
             SET expected_fence = ?, revision = revision + 1, updated_at = ?
             WHERE occurrence_id = ? AND state = 'pause_requested'
               AND expected_fence = ?`,
          )
          .run(claimed.fence, now, id, controlRow.expected_fence);
      } else if (controlRow?.state === "resumed") {
        const rebound = this.db
          .prepare(
            `UPDATE scheduler_occurrence_controls
             SET expected_fence = ?, revision = revision + 1, updated_at = ?
             WHERE occurrence_id = ? AND state = 'resumed'
               AND expected_fence = ?`,
          )
          .run(claimed.fence, now, id, controlRow.expected_fence);
        if (rebound.changes !== 1) {
          throw new SchedulerKernelError(
            "SCHEDULER_OCCURRENCE_CONTROL_CONFLICT",
            `Scheduler resume checkpoint lost its claim fence: ${id}`,
          );
        }
      }
      if (retryRow) {
        this.db
          .prepare(
            `UPDATE scheduler_occurrence_retries SET claimed_at = ?
             WHERE occurrence_id = ? AND request_id = ? AND claimed_at IS NULL`,
          )
          .run(now, id, retryRow.request_id);
      }
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
          ...(controlRow?.state === "pause_requested"
            ? { pauseRequestRebound: true }
            : {}),
          ...(controlRow?.state === "resumed"
            ? { resumedWithoutAttempt: true }
            : {}),
          ...(retryRow ? { retryRequestId: retryRow.request_id } : {}),
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
      if (nextStatus === OCCURRENCE_STATUS.RETRY_WAIT) {
        this.db
          .prepare(
            `UPDATE scheduler_occurrence_controls
             SET expected_fence = @nextFence, revision = revision + 1,
                 updated_at = @now
             WHERE occurrence_id = @occurrenceId
               AND state = 'resumed'
               AND expected_fence = @fence`,
          )
          .run({
            occurrenceId: id,
            fence: token,
            nextFence: token + 1,
            now,
          });
      }
      const controlTerminalized = this.db
        .prepare(
          `UPDATE scheduler_occurrence_controls
           SET state = 'terminal', revision = revision + 1,
               terminal_at = @now, updated_at = @now
           WHERE occurrence_id = @occurrenceId
              AND (
                state = 'pause_requested'
                OR (state = 'resumed' AND @status <> 'retry_wait')
              )`,
        )
        .run({ occurrenceId: id, status: nextStatus, now }).changes;
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
          ...(controlTerminalized === 1
            ? { runtimeControlTerminalized: true }
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
