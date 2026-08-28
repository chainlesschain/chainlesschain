/**
 * A durable, cross-process adapter for TaskLeaseRegistry.
 *
 * Every operation that can observe or mutate scheduling state runs under the
 * canonical strict file lock. The critical section restores the in-memory
 * registry, reclaims expired/dead-process leases, performs one operation, and
 * atomically replaces the 0600 state file. Consequently several `cc`
 * processes on one shared local filesystem can safely drive one TeamRunner
 * without granting two live executors authority over the same task.
 *
 * The file is a consistency authority, not a signature. The graph, authority,
 * and complete state carry independent SHA-256 digests so corruption, rollback
 * mix-ups, or an accidentally opened queue fail closed. Callers that need
 * authenticity must place the state under an authenticated control plane.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TaskLeaseRegistry } from "./task-lease.js";
import { withFileLock } from "../with-file-lock.js";
import {
  SecureFileIdentityError,
  fileStatIdentity,
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";

export const TEAM_DISTRIBUTED_QUEUE_SCHEMA_VERSION = 1;
export const DEFAULT_DISTRIBUTED_QUEUE_MAX_BYTES = 64 * 1024 * 1024;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_OID_PATTERN = /^[a-f0-9]{40,64}$/;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const WORKSPACE_EXECUTION_VERSION = 1;
const MAX_WORKSPACE_EXECUTION_HISTORY = 16;
const MAX_ADJUDICATION_DECISION_ID_BYTES = 256;
const MAX_ADJUDICATION_ACTOR_BYTES = 256;
const MAX_ADJUDICATION_REASON_BYTES = 4096;
const MAX_ADJUDICATION_RESULT_BYTES = 1024 * 1024;
const ADJUDICATION_DECISIONS = new Set(["retry", "accept", "cancel"]);
const MAX_INTERRUPT_REQUEST_ID_BYTES = 256;
const MAX_INTERRUPT_ACTOR_BYTES = 256;
const MAX_INTERRUPT_REASON_BYTES = 4096;
const INTERRUPT_KIND = "distributed-task-interruption";
const INTERRUPT_ERROR_CODE = "TEAM_TASK_HUMAN_INTERRUPTED";
const USAGE_TOKEN_FIELDS = Object.freeze([
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
]);
const MAX_USAGE_RECORDS = 10_000;
const FINALIZATION_VERSION = 1;
const DEFAULT_FINALIZATION_TTL_MS = 5 * 60 * 1000;
const MAX_FINALIZATION_TEXT_BYTES = 512;
const MAX_FINALIZATION_TRANSITIONS = 64;
const FINALIZATION_PHASES = new Set([
  "idle",
  "previewing",
  "previewed",
  "merging",
  "merged",
  "cleanup_prepared",
  "cleaning",
  "completed",
  "blocked",
  "recovery_required",
]);
const FINALIZATION_MODES = new Set(["preview", "merge"]);
const FINALIZATION_INTENTS = new Set(["preview", "merge", "cleanup"]);
const FINALIZATION_TRANSITIONS = new Map([
  ["previewing", new Set(["previewed", "blocked", "recovery_required"])],
  ["previewed", new Set(["merging", "blocked", "recovery_required"])],
  ["merging", new Set(["merged", "blocked", "recovery_required"])],
  ["merged", new Set(["cleanup_prepared", "blocked", "recovery_required"])],
  ["cleanup_prepared", new Set(["cleaning", "blocked", "recovery_required"])],
  ["cleaning", new Set(["blocked", "recovery_required"])],
  [
    "recovery_required",
    new Set([
      "previewing",
      "previewed",
      "merging",
      "merged",
      "cleanup_prepared",
      "cleaning",
      "recovery_required",
      "blocked",
    ]),
  ],
]);
const ADJUDICATION_ACCEPTANCE_PHASES = new Set(["committed", "completed"]);
const WORKSPACE_EXECUTION_PHASES = new Set([
  "prepared",
  "running",
  "validated",
  "committed",
  "completed",
  "preparation-rolled-back",
  "rolled-back",
  "rollback-recovery-required",
]);
const WORKSPACE_CHECKPOINT_STATES = new Set([
  "preparing",
  "prepared",
  "running",
  "rollback_required",
  "committed",
  "rolled_back",
  "rollback_failed",
  "restoring",
  "restored",
  "restore_failed",
  "aborted",
]);
const WORKSPACE_CHECKPOINT_TERMINAL_STATES = new Set([
  "committed",
  "rolled_back",
  "restored",
  "aborted",
]);
const WORKSPACE_EXECUTION_TRANSITIONS = new Map([
  ["prepared", new Set(["prepared", "running", "preparation-rolled-back"])],
  [
    "running",
    new Set([
      "running",
      "validated",
      "rolled-back",
      "rollback-recovery-required",
    ]),
  ],
  [
    "validated",
    new Set([
      "validated",
      "committed",
      "rolled-back",
      "rollback-recovery-required",
    ]),
  ],
  ["committed", new Set(["committed", "completed"])],
  ["completed", new Set(["completed"])],
  ["preparation-rolled-back", new Set(["preparation-rolled-back"])],
  ["rolled-back", new Set(["rolled-back"])],
  [
    "rollback-recovery-required",
    new Set(["rollback-recovery-required", "rolled-back"]),
  ],
]);
const TASK_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "blocked",
]);
const INTERNAL_METADATA = new Set([
  "key",
  "dependsOn",
  "lease",
  "attempts",
  "lastError",
  "result",
  "adjudication",
  "interruption",
  "abandonedLeaseEvidence",
  "workspaceExecution",
  "workspaceExecutionHistory",
  "workspaceRecovery",
  "custodyHandoffs",
  "canonicalGraphProjection",
]);

export class TeamDistributedQueueError extends Error {
  constructor(code, message, { cause, filePath } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TeamDistributedQueueError";
    this.code = code;
    if (filePath) this.filePath = filePath;
  }
}

function queueError(code, message, filePath, cause) {
  return new TeamDistributedQueueError(code, message, { cause, filePath });
}

function secureParentQueueError(cause, filePath, operation) {
  if (!(cause instanceof SecureFileIdentityError)) return null;
  return queueError(
    "TEAM_QUEUE_INSECURE_PATH",
    `Distributed queue ${operation} rejected an insecure parent path: ${filePath}`,
    filePath,
    cause,
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label = "value", seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contains a non-finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${label} contains a cycle`);
    seen.add(value);
    const result = value.map((item, index) =>
      cloneJson(item, `${label}[${index}]`, seen),
    );
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must contain JSON-compatible values`);
  }
  if (seen.has(value)) throw new TypeError(`${label} contains a cycle`);
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined) {
      throw new TypeError(`${label}.${key} must not be undefined`);
    }
    result[key] = cloneJson(item, `${label}.${key}`, seen);
  }
  seen.delete(value);
  return result;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sameFilesystemPath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function executionText(value, label, maxBytes = 4096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxBytes ||
    value !== value.trim() ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a stable non-empty string`);
  }
  return value;
}

function optionalEvidenceDigest(value, label) {
  if (value == null) return null;
  if (typeof value !== "string" || !EVIDENCE_DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a sha256 evidence digest`);
  }
  return value;
}

function optionalGitOid(value, label) {
  if (value == null) return null;
  if (typeof value !== "string" || !GIT_OID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a Git object id`);
  }
  return value.toLowerCase();
}

class FinalizationRequestError extends TypeError {
  constructor(reason, message) {
    super(message);
    this.name = "FinalizationRequestError";
    this.reason = reason;
  }
}

function finalizationText(
  value,
  label,
  maxBytes = MAX_FINALIZATION_TEXT_BYTES,
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new FinalizationRequestError(
      `invalid_${label}`,
      `${label} must be a stable 1..${maxBytes} byte string without control characters`,
    );
  }
  return value;
}

function finalizationTimestamp(value, label, { nullable = true } = {}) {
  if (nullable && value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative timestamp`);
  }
  return parsed;
}

function emptyFinalizationResult() {
  return {
    preview: null,
    integration: null,
    cleanup: null,
  };
}

function emptyFinalization() {
  return {
    version: FINALIZATION_VERSION,
    revision: 0,
    phase: "idle",
    operationId: null,
    mode: null,
    inputDigest: null,
    lease: null,
    git: null,
    coordinator: null,
    result: emptyFinalizationResult(),
    intent: null,
    cursor: 0,
    startedAt: null,
    updatedAt: null,
    previewedAt: null,
    mergedAt: null,
    cleanupPreparedAt: null,
    completedAt: null,
    blocked: null,
    recovery: null,
    transitions: [],
  };
}

function normalizeFinalizationLease(value, { nullable = true } = {}) {
  if (nullable && value == null) return null;
  if (!isPlainObject(value)) {
    throw new TypeError("finalization lease must be an object");
  }
  const lease = {
    owner: finalizationText(value.owner, "finalization_owner"),
    leaseId: finalizationText(value.leaseId, "finalization_lease_id"),
    ownerPid: Number(value.ownerPid),
    fencingToken: Number(value.fencingToken),
    acquiredAt: finalizationTimestamp(
      value.acquiredAt,
      "finalization.lease.acquiredAt",
      { nullable: false },
    ),
    expiresAt: finalizationTimestamp(
      value.expiresAt,
      "finalization.lease.expiresAt",
      { nullable: false },
    ),
    renewals: Number(value.renewals),
  };
  if (
    !Number.isSafeInteger(lease.ownerPid) ||
    lease.ownerPid < 1 ||
    !Number.isSafeInteger(lease.fencingToken) ||
    lease.fencingToken < 1 ||
    !Number.isSafeInteger(lease.renewals) ||
    lease.renewals < 0 ||
    lease.expiresAt < lease.acquiredAt
  ) {
    throw new TypeError("finalization lease has invalid fencing/timing");
  }
  return lease;
}

function normalizeFinalizationBranches(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("finalization git branches must be a non-empty array");
  }
  const seen = new Set();
  const branches = value.map((item) => {
    if (!isPlainObject(item)) {
      throw new TypeError("finalization git branch must be an object");
    }
    const key = finalizationText(item.key, "finalization_task_key", 4096);
    if (seen.has(key)) {
      throw new TypeError(`duplicate finalization git branch "${key}"`);
    }
    seen.add(key);
    return {
      key,
      branch: finalizationText(item.branch, "finalization_branch", 4096),
      commitOid: optionalGitOid(
        item.commitOid,
        "finalization.git.branch.commitOid",
      ),
      worktreePath: finalizationText(
        item.worktreePath,
        "finalization_worktree_path",
        16384,
      ),
    };
  });
  if (branches.some((item) => item.commitOid == null)) {
    throw new TypeError("finalization git branch lacks a commit OID");
  }
  const sorted = [...branches].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  if (canonicalJson(sorted) !== canonicalJson(branches)) {
    throw new TypeError("finalization git branches must be sorted by task key");
  }
  return branches;
}

function normalizeFinalizationGit(value, state) {
  if (!isPlainObject(value)) {
    throw new TypeError("finalization git authority must be an object");
  }
  const baseBranch =
    value.baseBranch == null
      ? null
      : finalizationText(value.baseBranch, "finalization_base_branch", 4096);
  const authorityBranch = state.authority?.baseTarget?.branch ?? null;
  if (baseBranch !== authorityBranch) {
    throw new TypeError(
      "finalization base branch changed from queue authority",
    );
  }
  const git = {
    baseBranch,
    initialBaseOid: optionalGitOid(
      value.initialBaseOid,
      "finalization.git.initialBaseOid",
    ),
    currentBaseOid: optionalGitOid(
      value.currentBaseOid,
      "finalization.git.currentBaseOid",
    ),
    branches: normalizeFinalizationBranches(value.branches),
  };
  const authorityOid = optionalGitOid(
    state.authority?.baseTarget?.commitOid,
    "authority.baseTarget.commitOid",
  );
  if (git.initialBaseOid !== authorityOid) {
    throw new TypeError(
      "finalization initial base OID changed from queue authority",
    );
  }
  return git;
}

function normalizeFinalizationCoordinator(value, state, git) {
  if (!isPlainObject(value)) {
    throw new TypeError("finalization coordinator snapshot must be an object");
  }
  const snapshot = cloneJson(value, "finalization coordinator snapshot");
  if (
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1 ||
    String(snapshot.runId || "") !== String(state.authority?.runId || "") ||
    !isPlainObject(snapshot.baseTarget) ||
    snapshot.baseTarget.branch !==
      (state.authority?.baseTarget?.branch ?? null) ||
    optionalGitOid(
      snapshot.baseTarget.commitOid,
      "finalization.coordinator.baseTarget.commitOid",
    ) !==
      optionalGitOid(
        state.authority?.baseTarget?.commitOid,
        "authority.baseTarget.commitOid",
      ) ||
    !Array.isArray(snapshot.records)
  ) {
    throw new TypeError("finalization coordinator authority changed");
  }
  const bindings = new Map(git.branches.map((item) => [item.key, item]));
  if (
    snapshot.records.length !== bindings.size ||
    snapshot.records.some((record) => {
      const binding = bindings.get(record?.key);
      return (
        !binding ||
        record.completed !== true ||
        record.branch !== binding.branch ||
        record.path !== binding.worktreePath ||
        optionalGitOid(
          record.commitOid,
          "finalization.coordinator.record.commitOid",
        ) !== binding.commitOid
      );
    })
  ) {
    throw new TypeError(
      "finalization coordinator records changed from completed task results",
    );
  }
  return snapshot;
}

function normalizeFinalizationResult(value) {
  if (!isPlainObject(value)) {
    throw new TypeError("finalization result must be an object");
  }
  const result = {};
  for (const field of ["preview", "integration", "cleanup"]) {
    const item = value[field];
    if (item != null && !Array.isArray(item)) {
      throw new TypeError(
        `finalization result ${field} must be an array or null`,
      );
    }
    result[field] =
      item == null ? null : cloneJson(item, `finalization result ${field}`);
  }
  return result;
}

function normalizeFinalizationIntent(value, git) {
  if (value == null) return null;
  if (!isPlainObject(value) || !FINALIZATION_INTENTS.has(value.kind)) {
    throw new TypeError("invalid finalization intent");
  }
  const branches = normalizeFinalizationBranches(value.branches);
  if (canonicalJson(branches) !== canonicalJson(git.branches)) {
    throw new TypeError("finalization intent branch authority changed");
  }
  const coordinatorDigest = String(value.coordinatorDigest || "");
  if (!DIGEST_PATTERN.test(coordinatorDigest)) {
    throw new TypeError(
      "finalization intent has an invalid coordinator digest",
    );
  }
  const intent = {
    kind: value.kind,
    expectedBaseOid: optionalGitOid(
      value.expectedBaseOid,
      "finalization.intent.expectedBaseOid",
    ),
    branches,
    coordinatorDigest,
    preparedAt: finalizationTimestamp(
      value.preparedAt,
      "finalization.intent.preparedAt",
      { nullable: false },
    ),
  };
  if (!intent.expectedBaseOid) {
    throw new TypeError("finalization intent lacks an expected base OID");
  }
  return intent;
}

function normalizeFinalizationBlock(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) {
    throw new TypeError("finalization block must be an object");
  }
  return {
    code: finalizationText(value.code, "finalization_block_code"),
    message: finalizationText(
      value.message,
      "finalization_block_message",
      16 * 1024,
    ),
    at: finalizationTimestamp(value.at, "finalization.blocked.at", {
      nullable: false,
    }),
    evidenceDigest: optionalEvidenceDigest(
      value.evidenceDigest,
      "finalization.blocked.evidenceDigest",
    ),
  };
}

function normalizeFinalizationRecovery(value, git) {
  if (value == null) return null;
  if (
    !isPlainObject(value) ||
    !FINALIZATION_PHASES.has(value.fromPhase) ||
    value.fromPhase === "idle"
  ) {
    throw new TypeError("invalid finalization recovery record");
  }
  return {
    fromPhase: value.fromPhase,
    intent: normalizeFinalizationIntent(value.intent, git),
    priorLease: normalizeFinalizationLease(value.priorLease, {
      nullable: false,
    }),
    takenOverAt: finalizationTimestamp(
      value.takenOverAt,
      "finalization.recovery.takenOverAt",
      { nullable: false },
    ),
    reason: finalizationText(
      value.reason,
      "finalization_recovery_reason",
      4096,
    ),
  };
}

function normalizeFinalizationTransitions(value) {
  if (!Array.isArray(value) || value.length > MAX_FINALIZATION_TRANSITIONS) {
    throw new TypeError("invalid finalization transition log");
  }
  const ids = new Set();
  return value.map((item) => {
    if (
      !isPlainObject(item) ||
      !FINALIZATION_PHASES.has(item.from) ||
      !FINALIZATION_PHASES.has(item.to)
    ) {
      throw new TypeError("invalid finalization transition");
    }
    const id = finalizationText(item.id, "finalization_transition_id", 4096);
    if (ids.has(id) || !DIGEST_PATTERN.test(String(item.digest || ""))) {
      throw new TypeError("duplicate or corrupt finalization transition");
    }
    ids.add(id);
    return {
      id,
      digest: item.digest,
      from: item.from,
      to: item.to,
      at: finalizationTimestamp(item.at, "finalization.transition.at", {
        nullable: false,
      }),
    };
  });
}

function normalizeFinalization(value, state) {
  if (!isPlainObject(value) || value.version !== FINALIZATION_VERSION) {
    throw new TypeError("invalid distributed finalization state");
  }
  const phase = value.phase;
  if (
    !FINALIZATION_PHASES.has(phase) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Number.isSafeInteger(value.cursor) ||
    value.cursor < 0
  ) {
    throw new TypeError("invalid distributed finalization phase/revision");
  }
  if (phase === "idle") {
    const empty = emptyFinalization();
    if (canonicalJson(value) !== canonicalJson(empty)) {
      throw new TypeError("non-canonical idle finalization state");
    }
    return empty;
  }
  const operationId = finalizationText(
    value.operationId,
    "finalization_operation_id",
    4096,
  );
  if (
    !FINALIZATION_MODES.has(value.mode) ||
    !DIGEST_PATTERN.test(String(value.inputDigest || ""))
  ) {
    throw new TypeError("invalid finalization mode/input digest");
  }
  const git = normalizeFinalizationGit(value.git, state);
  if (!git.initialBaseOid || !git.currentBaseOid) {
    throw new TypeError("finalization Git authority lacks a base OID");
  }
  const coordinator = normalizeFinalizationCoordinator(
    value.coordinator,
    state,
    git,
  );
  const normalized = {
    version: FINALIZATION_VERSION,
    revision: value.revision,
    phase,
    operationId,
    mode: value.mode,
    inputDigest: value.inputDigest,
    lease: normalizeFinalizationLease(value.lease),
    git,
    coordinator,
    result: normalizeFinalizationResult(value.result),
    intent: normalizeFinalizationIntent(value.intent, git),
    cursor: value.cursor,
    startedAt: finalizationTimestamp(
      value.startedAt,
      "finalization.startedAt",
      { nullable: false },
    ),
    updatedAt: finalizationTimestamp(
      value.updatedAt,
      "finalization.updatedAt",
      { nullable: false },
    ),
    previewedAt: finalizationTimestamp(
      value.previewedAt,
      "finalization.previewedAt",
    ),
    mergedAt: finalizationTimestamp(value.mergedAt, "finalization.mergedAt"),
    cleanupPreparedAt: finalizationTimestamp(
      value.cleanupPreparedAt,
      "finalization.cleanupPreparedAt",
    ),
    completedAt: finalizationTimestamp(
      value.completedAt,
      "finalization.completedAt",
    ),
    blocked: normalizeFinalizationBlock(value.blocked),
    recovery: normalizeFinalizationRecovery(value.recovery, git),
    transitions: normalizeFinalizationTransitions(value.transitions),
  };
  if (
    normalized.updatedAt < normalized.startedAt ||
    (phase === "completed" &&
      (normalized.completedAt == null ||
        normalized.lease != null ||
        normalized.intent != null)) ||
    (phase === "blocked" &&
      (!normalized.blocked || normalized.lease != null)) ||
    (phase === "recovery_required" && !normalized.recovery) ||
    (phase !== "blocked" && normalized.blocked != null)
  ) {
    throw new TypeError("inconsistent distributed finalization state");
  }
  if (
    normalized.intent &&
    phase !== "recovery_required" &&
    normalized.intent.coordinatorDigest !== digest(normalized.coordinator)
  ) {
    throw new TypeError("finalization intent coordinator digest mismatch");
  }
  const requiresLease = new Set([
    "previewing",
    "merging",
    "merged",
    "cleanup_prepared",
    "cleaning",
  ]);
  if (requiresLease.has(phase) && normalized.lease == null) {
    throw new TypeError(`finalization phase "${phase}" requires a lease`);
  }
  const expectedIntent = new Map([
    ["previewing", "preview"],
    ["merging", "merge"],
    ["cleaning", "cleanup"],
  ]).get(phase);
  if (
    (expectedIntent && normalized.intent?.kind !== expectedIntent) ||
    (!expectedIntent &&
      phase !== "recovery_required" &&
      normalized.intent != null)
  ) {
    throw new TypeError(`finalization phase "${phase}" has an invalid intent`);
  }
  return normalized;
}

class AdjudicationRequestError extends TypeError {
  constructor(reason, message) {
    super(message);
    this.name = "AdjudicationRequestError";
    this.reason = reason;
  }
}

function boundedAdjudicationText(
  value,
  label,
  maxBytes,
  { nullable = false } = {},
) {
  if (nullable && value == null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new AdjudicationRequestError(
      `invalid_${label}`,
      `${label} must be a stable 1..${maxBytes} byte string without control characters`,
    );
  }
  return value;
}

function interruptRequestPayload(state, key, options) {
  if (!isPlainObject(options)) {
    throw new AdjudicationRequestError(
      "invalid_interrupt_request",
      "interrupt request must be an object",
    );
  }
  const fencingToken = Number(options.fencingToken);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new AdjudicationRequestError(
      "invalid_fencing_token",
      "fencingToken must be a positive safe integer",
    );
  }
  return {
    schemaVersion: 1,
    kind: INTERRUPT_KIND,
    queueId: state.queueId,
    key: boundedAdjudicationText(key, "task_key", 4096),
    holder: boundedAdjudicationText(options.holder, "holder", 4096),
    leaseId: boundedAdjudicationText(options.leaseId, "lease_id", 4096),
    fencingToken,
    requestId: boundedAdjudicationText(
      options.requestId,
      "request_id",
      MAX_INTERRUPT_REQUEST_ID_BYTES,
    ),
    actor: boundedAdjudicationText(
      options.actor ?? "human",
      "actor",
      MAX_INTERRUPT_ACTOR_BYTES,
    ),
    reason: boundedAdjudicationText(
      options.reason ?? "human takeover requested",
      "reason",
      MAX_INTERRUPT_REASON_BYTES,
    ),
  };
}

function interruptionRequestDigest(payload) {
  return `sha256:${digest(payload)}`;
}

function createInterruptionRecord(state, task, lease, payload, now) {
  const requestDigest = interruptionRequestDigest(payload);
  const evidence = {
    ...payload,
    requestDigest,
    requestedAt: now,
    taskRevision: task.rev,
    lease: cloneJson(lease, "interrupted lease"),
    budgetReservationDigest: (() => {
      const reservation = reservationFor(state, lease.leaseId);
      return reservation == null
        ? null
        : `sha256:${digest(
            cloneJson(reservation, "interrupted budget reservation"),
          )}`;
    })(),
    workspaceExecutionDigest:
      task.metadata?.workspaceExecution == null
        ? null
        : `sha256:${digest(
            cloneJson(
              task.metadata.workspaceExecution,
              "interrupted workspace execution",
            ),
          )}`,
  };
  return {
    ...evidence,
    evidenceDigest: `sha256:${digest(evidence)}`,
  };
}

function normalizeInterruptionRecord(value, state, expectedKey = null) {
  if (!isPlainObject(value)) {
    throw new TypeError("interruption must be an object");
  }
  const payload = interruptRequestPayload(state, value.key, value);
  if (expectedKey != null && payload.key !== expectedKey) {
    throw new TypeError("interruption task binding mismatch");
  }
  const requestDigest = interruptionRequestDigest(payload);
  if (value.requestDigest !== requestDigest) {
    throw new TypeError("interruption request digest mismatch");
  }
  const requestedAt = Number(value.requestedAt);
  const taskRevision = Number(value.taskRevision);
  if (
    !Number.isFinite(requestedAt) ||
    requestedAt < 0 ||
    !Number.isSafeInteger(taskRevision) ||
    taskRevision < 1
  ) {
    throw new TypeError("interruption timing or task revision is invalid");
  }
  if (!isPlainObject(value.lease)) {
    throw new TypeError("interruption lease evidence must be an object");
  }
  const lease = cloneJson(value.lease, "interruption lease evidence");
  if (
    lease.holder !== payload.holder ||
    lease.leaseId !== payload.leaseId ||
    lease.fencingToken !== payload.fencingToken ||
    !Number.isSafeInteger(lease.ownerPid) ||
    lease.ownerPid < 1 ||
    !Number.isFinite(lease.acquiredAt) ||
    !Number.isFinite(lease.expiresAt) ||
    lease.expiresAt < lease.acquiredAt ||
    !Number.isSafeInteger(lease.renewals) ||
    lease.renewals < 0
  ) {
    throw new TypeError("interruption lease evidence is invalid");
  }
  for (const field of ["budgetReservationDigest", "workspaceExecutionDigest"]) {
    if (
      value[field] !== null &&
      !EVIDENCE_DIGEST_PATTERN.test(value[field] || "")
    ) {
      throw new TypeError(`interruption ${field} is invalid`);
    }
  }
  const evidence = {
    ...payload,
    requestDigest,
    requestedAt,
    taskRevision,
    lease,
    budgetReservationDigest: value.budgetReservationDigest,
    workspaceExecutionDigest: value.workspaceExecutionDigest,
  };
  const evidenceDigest = `sha256:${digest(evidence)}`;
  if (value.evidenceDigest !== evidenceDigest) {
    throw new TypeError("interruption evidence digest mismatch");
  }
  const normalized = { ...evidence, evidenceDigest };
  if (canonicalJson(value) !== canonicalJson(normalized)) {
    throw new TypeError("interruption record is non-canonical");
  }
  return normalized;
}

function validateInterruptionLedger(state) {
  if (!Array.isArray(state.interruptions)) {
    throw new TypeError("distributed queue interruptions must be an array");
  }
  const byRequestId = new Map();
  for (const value of state.interruptions) {
    const record = normalizeInterruptionRecord(value, state);
    if (byRequestId.has(record.requestId)) {
      throw new TypeError(
        `duplicate distributed interruption request "${record.requestId}"`,
      );
    }
    byRequestId.set(record.requestId, record);
  }
  return byRequestId;
}

function interruptionAdjudication(record) {
  return {
    code: INTERRUPT_ERROR_CODE,
    reason: record.reason,
    evidenceDigest: record.evidenceDigest,
    requestedAt: record.requestedAt,
    requestId: record.requestId,
    actor: record.actor,
    holder: record.holder,
    leaseId: record.leaseId,
    fencingToken: record.fencingToken,
    requestDigest: record.requestDigest,
  };
}

function interruptionError(record) {
  const error = new Error(record.reason || "human takeover requested");
  error.code = INTERRUPT_ERROR_CODE;
  error.retryable = false;
  error.adjudication = interruptionAdjudication(record);
  return error;
}

function materializeInterruptionError(result) {
  if (!isPlainObject(result) || !result.interruptionErrorRecord) return result;
  const record = result.interruptionErrorRecord;
  const materialized = { ...result };
  delete materialized.interruptionErrorRecord;
  materialized.error = interruptionError(record);
  return materialized;
}

function interruptionRequestFailure(error) {
  if (error instanceof AdjudicationRequestError) {
    return { ok: false, reason: error.reason, error: error.message };
  }
  return {
    ok: false,
    reason: "invalid_interrupt_request",
    error: error instanceof Error ? error.message : String(error),
  };
}

function activeInterruption(task, lease = task?.metadata?.lease || null) {
  const interruption = task?.metadata?.interruption || null;
  return interruption &&
    lease &&
    interruption.holder === lease.holder &&
    interruption.leaseId === lease.leaseId &&
    interruption.fencingToken === lease.fencingToken
    ? interruption
    : null;
}

function normalizeAdjudicationRequest(key, options) {
  if (!isPlainObject(options)) {
    throw new AdjudicationRequestError(
      "invalid_adjudication_request",
      "adjudication request must be an object",
    );
  }
  if (!ADJUDICATION_DECISIONS.has(options.decision)) {
    throw new AdjudicationRequestError(
      "invalid_decision",
      "decision must be retry, accept, or cancel",
    );
  }
  const decisionId = boundedAdjudicationText(
    options.decisionId,
    "decision_id",
    MAX_ADJUDICATION_DECISION_ID_BYTES,
  );
  const actor = boundedAdjudicationText(
    options.actor ?? "human",
    "actor",
    MAX_ADJUDICATION_ACTOR_BYTES,
  );
  const reason = boundedAdjudicationText(
    options.reason,
    "reason",
    MAX_ADJUDICATION_REASON_BYTES,
    { nullable: true },
  );
  if (typeof options.evidenceDigest !== "string") {
    throw new AdjudicationRequestError(
      "evidence_digest_required",
      "evidenceDigest is required",
    );
  }
  if (!EVIDENCE_DIGEST_PATTERN.test(options.evidenceDigest)) {
    throw new AdjudicationRequestError(
      "invalid_evidence_digest",
      "evidenceDigest must be an exact sha256 evidence digest",
    );
  }

  const hasResult = Object.prototype.hasOwnProperty.call(options, "result");
  let result = null;
  if (options.decision === "accept") {
    if (!hasResult) {
      throw new AdjudicationRequestError(
        "result_required",
        "accept requires an evidence-bound result",
      );
    }
    try {
      result = cloneJson(options.result, "adjudication result");
    } catch (error) {
      throw new AdjudicationRequestError(
        "invalid_result",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!isPlainObject(result)) {
      throw new AdjudicationRequestError(
        "invalid_result",
        "accept result must be a plain JSON object",
      );
    }
    if (
      Buffer.byteLength(canonicalJson(result), "utf8") >
      MAX_ADJUDICATION_RESULT_BYTES
    ) {
      throw new AdjudicationRequestError(
        "result_too_large",
        `accept result exceeds ${MAX_ADJUDICATION_RESULT_BYTES} bytes`,
      );
    }
  } else if (hasResult) {
    throw new AdjudicationRequestError(
      "result_not_allowed",
      `${options.decision} must not include result`,
    );
  }

  const request = {
    schemaVersion: 1,
    kind: "distributed-queue-adjudication",
    key: boundedAdjudicationText(key, "task_key", 4096),
    decision: options.decision,
    decisionId,
    actor,
    reason,
    evidenceDigest: options.evidenceDigest,
    result,
  };
  return {
    ...request,
    requestDigest: `sha256:${digest(request)}`,
  };
}

function normalizeWorkspaceRecoveryRequest(key, options) {
  if (!isPlainObject(options)) {
    throw new AdjudicationRequestError(
      "invalid_workspace_recovery_request",
      "workspace recovery request must be an object",
    );
  }
  const recoveryId = boundedAdjudicationText(
    options.recoveryId,
    "recovery_id",
    MAX_ADJUDICATION_DECISION_ID_BYTES,
  );
  const actor = boundedAdjudicationText(
    options.actor ?? "recovery",
    "actor",
    MAX_ADJUDICATION_ACTOR_BYTES,
  );
  const reason = boundedAdjudicationText(
    options.reason,
    "reason",
    MAX_ADJUDICATION_REASON_BYTES,
    { nullable: true },
  );
  for (const field of [
    "evidenceDigest",
    "checkpointDigest",
    "writeManifestDigest",
    "checkpointEvidenceDigest",
  ]) {
    if (
      typeof options[field] !== "string" ||
      !EVIDENCE_DIGEST_PATTERN.test(options[field])
    ) {
      throw new AdjudicationRequestError(
        `invalid_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
        `${field} must be an exact sha256 evidence digest`,
      );
    }
  }
  let execution;
  try {
    execution = cloneJson(options.execution, "recovered workspace execution");
  } catch (error) {
    throw new AdjudicationRequestError(
      "invalid_workspace_execution",
      error instanceof Error ? error.message : String(error),
    );
  }
  const request = {
    schemaVersion: 1,
    kind: "distributed-workspace-recovery",
    key: boundedAdjudicationText(key, "task_key", 4096),
    recoveryId,
    actor,
    reason,
    evidenceDigest: options.evidenceDigest,
    checkpointDigest: options.checkpointDigest,
    writeManifestDigest: options.writeManifestDigest,
    checkpointEvidenceDigest: options.checkpointEvidenceDigest,
    execution,
  };
  return {
    ...request,
    requestDigest: `sha256:${digest(request)}`,
  };
}

function normalizeWorkspaceExecution(
  value,
  { state, key, activeLease = null, existing = null } = {},
) {
  if (!isPlainObject(value)) {
    throw new TypeError("workspaceExecution must be an object");
  }
  if (value.version !== WORKSPACE_EXECUTION_VERSION) {
    throw new TypeError("unsupported workspaceExecution version");
  }
  const queueId = executionText(value.queueId, "workspaceExecution.queueId");
  const runId = executionText(value.runId, "workspaceExecution.runId");
  const taskKey = executionText(value.taskKey, "workspaceExecution.taskKey");
  const workerId = executionText(value.workerId, "workspaceExecution.workerId");
  if (
    queueId !== state.queueId ||
    runId !== String(state.authority?.runId || "") ||
    taskKey !== key ||
    state.authority?.checkpoint?.enabled !== true
  ) {
    throw new TypeError("workspaceExecution authority binding changed");
  }
  const phase = executionText(value.phase, "workspaceExecution.phase");
  if (!WORKSPACE_EXECUTION_PHASES.has(phase)) {
    throw new TypeError(`unsupported workspaceExecution phase "${phase}"`);
  }

  if (!isPlainObject(value.lease)) {
    throw new TypeError("workspaceExecution.lease must be an object");
  }
  const lease = {
    holder: executionText(
      value.lease.holder,
      "workspaceExecution.lease.holder",
    ),
    leaseId: executionText(
      value.lease.leaseId,
      "workspaceExecution.lease.leaseId",
    ),
    ownerPid: Number(value.lease.ownerPid),
    fencingToken: Number(value.lease.fencingToken),
  };
  if (
    !Number.isSafeInteger(lease.ownerPid) ||
    lease.ownerPid < 1 ||
    !Number.isSafeInteger(lease.fencingToken) ||
    lease.fencingToken < 1
  ) {
    throw new TypeError("workspaceExecution has an invalid lease fence");
  }
  if (
    activeLease &&
    (lease.holder !== activeLease.holder ||
      lease.leaseId !== activeLease.leaseId ||
      lease.ownerPid !== activeLease.ownerPid ||
      lease.fencingToken !== activeLease.fencingToken)
  ) {
    throw new TypeError("workspaceExecution does not match the active lease");
  }

  if (!isPlainObject(value.worktree)) {
    throw new TypeError("workspaceExecution.worktree must be an object");
  }
  const worktree = cloneJson(value.worktree, "workspaceExecution.worktree");
  if (
    executionText(worktree.key, "workspaceExecution.worktree.key") !== key ||
    typeof worktree.committed !== "boolean" ||
    typeof worktree.completed !== "boolean" ||
    !Array.isArray(worktree.dependencyCommits) ||
    !Array.isArray(worktree.managedLinks)
  ) {
    throw new TypeError("workspaceExecution has an invalid worktree record");
  }
  executionText(worktree.branch, "workspaceExecution.worktree.branch");
  executionText(worktree.path, "workspaceExecution.worktree.path");
  optionalGitOid(
    worktree.baselineCommitOid,
    "workspaceExecution.worktree.baselineCommitOid",
  );
  optionalGitOid(worktree.commitOid, "workspaceExecution.worktree.commitOid");

  if (!isPlainObject(value.checkpoint)) {
    throw new TypeError("workspaceExecution.checkpoint must be an object");
  }
  const checkpoint = cloneJson(
    value.checkpoint,
    "workspaceExecution.checkpoint",
  );
  const checkpointState = executionText(
    checkpoint.state,
    "workspaceExecution.checkpoint.state",
  );
  if (
    !WORKSPACE_CHECKPOINT_STATES.has(checkpointState) ||
    checkpoint.requestedCoverage !== "partial" ||
    !["full", "partial", "none"].includes(checkpoint.coverage) ||
    !["full", "partial", "none"].includes(checkpoint.fileCoverage) ||
    typeof checkpoint.externalSideEffects !== "boolean" ||
    typeof checkpoint.recoveryRequired !== "boolean" ||
    checkpoint.recoveryRequired !==
      !WORKSPACE_CHECKPOINT_TERMINAL_STATES.has(checkpointState) ||
    !Array.isArray(checkpoint.uncoveredPaths)
  ) {
    throw new TypeError(
      "workspaceExecution has invalid checkpoint coverage/state",
    );
  }
  for (const uncovered of checkpoint.uncoveredPaths) {
    executionText(uncovered, "workspaceExecution.checkpoint.uncoveredPaths");
  }
  if (
    checkpoint.coverage === "full" &&
    (checkpoint.externalSideEffects || checkpoint.uncoveredPaths.length > 0)
  ) {
    throw new TypeError("workspaceExecution overstates full coverage");
  }
  for (const field of [
    "transactionId",
    "checkpointId",
    "runId",
    "taskKey",
    "workspaceRoot",
    "stateDir",
    "writerIsolation",
    "updatedAt",
  ]) {
    executionText(checkpoint[field], `workspaceExecution.checkpoint.${field}`);
  }
  if (
    checkpoint.runId !== runId ||
    checkpoint.taskKey !== key ||
    !sameFilesystemPath(checkpoint.workspaceRoot, worktree.path)
  ) {
    throw new TypeError("workspaceExecution checkpoint binding changed");
  }
  const authorityStateDir = state.authority?.checkpoint?.stateDir;
  if (
    state.authority?.checkpoint?.enabled === true &&
    (!authorityStateDir ||
      !sameFilesystemPath(checkpoint.stateDir, authorityStateDir))
  ) {
    throw new TypeError(
      "workspaceExecution checkpoint store changed from queue authority",
    );
  }
  if (!Number.isFinite(Date.parse(checkpoint.updatedAt))) {
    throw new TypeError("workspaceExecution has an invalid checkpoint time");
  }
  checkpoint.checkpointDigest = optionalEvidenceDigest(
    checkpoint.checkpointDigest,
    "workspaceExecution.checkpoint.checkpointDigest",
  );
  checkpoint.writeManifestDigest = optionalEvidenceDigest(
    checkpoint.writeManifestDigest,
    "workspaceExecution.checkpoint.writeManifestDigest",
  );
  checkpoint.evidenceDigest = optionalEvidenceDigest(
    checkpoint.evidenceDigest,
    "workspaceExecution.checkpoint.evidenceDigest",
  );
  const verifiedCommitOid = optionalGitOid(
    value.verifiedCommitOid,
    "workspaceExecution.verifiedCommitOid",
  );

  if (
    ["committed", "completed"].includes(phase) &&
    (checkpointState !== "committed" ||
      !checkpoint.writeManifestDigest ||
      !checkpoint.evidenceDigest ||
      !verifiedCommitOid)
  ) {
    throw new TypeError(
      "committed workspaceExecution lacks commit/checkpoint evidence",
    );
  }
  if (
    phase === "completed" &&
    (!worktree.completed ||
      worktree.commitOid?.toLowerCase() !== verifiedCommitOid)
  ) {
    throw new TypeError(
      "completed workspaceExecution does not bind the worktree commit",
    );
  }
  if (
    ["preparation-rolled-back", "rolled-back"].includes(phase) &&
    !["rolled_back", "aborted"].includes(checkpointState)
  ) {
    throw new TypeError(
      "rolled-back workspaceExecution has a non-terminal checkpoint",
    );
  }
  if (phase === "rollback-recovery-required" && !checkpoint.recoveryRequired) {
    throw new TypeError(
      "workspaceExecution recovery phase has no recovery requirement",
    );
  }

  const normalized = {
    version: WORKSPACE_EXECUTION_VERSION,
    queueId,
    runId,
    taskKey,
    workerId,
    phase,
    lease,
    worktree,
    checkpoint,
    verifiedCommitOid,
    updatedAt: checkpoint.updatedAt,
  };
  if (existing) {
    const prior = normalizeWorkspaceExecution(existing, {
      state,
      key,
    });
    if (prior.checkpoint.transactionId === checkpoint.transactionId) {
      if (
        prior.lease.leaseId !== lease.leaseId ||
        prior.lease.fencingToken !== lease.fencingToken ||
        !WORKSPACE_EXECUTION_TRANSITIONS.get(prior.phase)?.has(phase)
      ) {
        throw new TypeError(
          "workspaceExecution attempted a stale phase transition",
        );
      }
    } else if (
      !["rolled_back", "aborted"].includes(prior.checkpoint.state) ||
      lease.fencingToken <= prior.lease.fencingToken ||
      phase !== "prepared"
    ) {
      throw new TypeError(
        "workspaceExecution replaced an unsettled transaction",
      );
    }
  }
  return normalized;
}

function isRetryableWorkspaceSettlement(execution) {
  return !!(
    execution &&
    ["preparation-rolled-back", "rolled-back"].includes(execution.phase) &&
    ["rolled_back", "aborted"].includes(execution.checkpoint?.state) &&
    execution.checkpoint?.recoveryRequired === false &&
    (execution.checkpoint.state === "aborted" ||
      (execution.checkpoint.coverage !== "none" &&
        execution.checkpoint.fileCoverage !== "none" &&
        execution.checkpoint.evidenceDigest))
  );
}

function normalizeWorkspaceExecutionHistory(value, { state, key } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_WORKSPACE_EXECUTION_HISTORY) {
    throw new TypeError("invalid workspaceExecutionHistory");
  }
  return value.map((item) => {
    const execution = normalizeWorkspaceExecution(item, { state, key });
    if (!isRetryableWorkspaceSettlement(execution)) {
      throw new TypeError(
        "workspaceExecutionHistory contains an unsettled transaction",
      );
    }
    return execution;
  });
}

function positiveLimit(value, { integer = false, label } = {}) {
  if (value == null) return null;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new TypeError(`${label || "limit"} must be a positive number`);
  }
  return parsed;
}

function validTimestamp(value, label = "timestamp") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return parsed;
}

function normalizeLimits(source = {}) {
  if (!isPlainObject(source)) throw new TypeError("budget must be an object");
  return {
    maxTasks: positiveLimit(source.maxTasks, {
      integer: true,
      label: "maxTasks",
    }),
    maxTokens: positiveLimit(source.maxTokens, {
      integer: true,
      label: "maxTokens",
    }),
    maxUsd: positiveLimit(source.maxUsd, { label: "maxUsd" }),
    maxWallMs: positiveLimit(source.maxWallMs, {
      integer: true,
      label: "maxWallMs",
    }),
  };
}

function emptyBudget(limits) {
  return {
    limits,
    totals: {
      tasksStarted: 0,
      tasksSettled: 0,
      tokens: 0,
      spentUsd: 0,
      startedAt: null,
    },
    reservations: [],
  };
}

function userMetadata(metadata) {
  const result = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!INTERNAL_METADATA.has(key)) result[key] = cloneJson(value);
  }
  return result;
}

function graphFromRegistrySnapshot(snapshot) {
  const tasks = snapshot?.tasks?.tasks;
  if (!Array.isArray(tasks)) {
    throw new TypeError("registry snapshot has no task list");
  }
  return tasks
    .map((task) => ({
      key: task?.metadata?.key,
      title: task?.title,
      priority: task?.priority || "normal",
      dependsOn: [...(task?.metadata?.dependsOn || [])].sort(),
      metadata: userMetadata(task?.metadata),
      createdBy: task?.createdBy ?? null,
    }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function authorityPayload(state) {
  return {
    schemaVersion: state.schemaVersion,
    queueId: state.queueId,
    graphDigest: state.graphDigest,
    authority: state.authority,
    budgetLimits: state.budget.limits,
  };
}

function stateWithoutIntegrity(state) {
  const rest = { ...state };
  delete rest.integrityDigest;
  return rest;
}

function refreshDigests(state) {
  state.graphDigest = digest(state.graph);
  state.authorityDigest = digest(authorityPayload(state));
  state.integrityDigest = digest(stateWithoutIntegrity(state));
}

function modeIsPrivate(stat) {
  return process.platform === "win32" || (Number(stat.mode) & 0o777) === 0o600;
}

function assertRegularPrivateFile(stat, filePath) {
  if (!stat.isFile() || stat.isSymbolicLink?.()) {
    throw queueError(
      "TEAM_QUEUE_INSECURE_PATH",
      `Distributed queue state must be a regular file: ${filePath}`,
      filePath,
    );
  }
  if (Number(stat.nlink) !== 1) {
    throw queueError(
      "TEAM_QUEUE_INSECURE_PATH",
      `Distributed queue state must not be hard-linked: ${filePath}`,
      filePath,
    );
  }
  if (!modeIsPrivate(stat)) {
    throw queueError(
      "TEAM_QUEUE_INSECURE_PERMISSIONS",
      `Distributed queue state must have mode 0600: ${filePath}`,
      filePath,
    );
  }
}

function pathIdentity(stat) {
  return fileStatIdentity(stat);
}

function assertNoSymlinkDirectories(directory, filePath) {
  let current = path.resolve(directory);
  for (;;) {
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        const parent = path.dirname(current);
        if (parent === current) throw cause;
        current = parent;
        continue;
      }
      throw queueError(
        "TEAM_QUEUE_PREPARE_FAILED",
        `Could not inspect distributed queue directory: ${current}`,
        filePath,
        cause,
      );
    }
    if (stat.isSymbolicLink()) {
      throw queueError(
        "TEAM_QUEUE_INSECURE_PATH",
        `Distributed queue directory must not traverse a symlink: ${current}`,
        filePath,
      );
    }
    if (!stat.isDirectory()) {
      throw queueError(
        "TEAM_QUEUE_INSECURE_PATH",
        `Distributed queue parent is not a directory: ${current}`,
        filePath,
      );
    }
    return;
  }
}

function prepareDirectory(filePath) {
  const directory = path.dirname(filePath);
  assertNoSymlinkDirectories(directory, filePath);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch (cause) {
    throw queueError(
      "TEAM_QUEUE_PREPARE_FAILED",
      `Could not create distributed queue directory: ${directory}`,
      filePath,
      cause,
    );
  }
  assertNoSymlinkDirectories(directory, filePath);
  if (process.platform !== "win32") {
    const stat = fs.statSync(directory);
    if ((stat.mode & 0o077) !== 0) {
      throw queueError(
        "TEAM_QUEUE_INSECURE_PERMISSIONS",
        `Distributed queue directory must not be group/world accessible: ${directory}`,
        filePath,
      );
    }
  }
}

function secureRead(
  runtimeFs,
  filePath,
  maxBytes,
  { allowMissing = false, secureFileParent = withTrustedFileParentSync } = {},
) {
  try {
    return secureFileParent(
      runtimeFs,
      filePath,
      ({ canonicalPath, parentDevice }) => {
        let lstat;
        try {
          lstat = runtimeFs.lstatSync(canonicalPath, { bigint: true });
        } catch (cause) {
          if (cause?.code === "ENOENT" && allowMissing) {
            return { missing: true, identity: null, serialized: null };
          }
          if (cause?.code === "ENOENT") {
            throw queueError(
              "TEAM_QUEUE_NOT_INITIALIZED",
              `Distributed queue state does not exist: ${filePath}`,
              filePath,
              cause,
            );
          }
          throw queueError(
            "TEAM_QUEUE_READ_FAILED",
            `Could not inspect distributed queue state: ${filePath}`,
            filePath,
            cause,
          );
        }
        assertRegularPrivateFile(lstat, filePath);
        if (Number(lstat.size) > maxBytes) {
          throw queueError(
            "TEAM_QUEUE_TOO_LARGE",
            `Distributed queue state exceeds ${maxBytes} bytes: ${filePath}`,
            filePath,
          );
        }

        let descriptor = null;
        try {
          const noFollow = runtimeFs.constants.O_NOFOLLOW || 0;
          descriptor = runtimeFs.openSync(
            canonicalPath,
            runtimeFs.constants.O_RDONLY | noFollow,
          );
          const stat = runtimeFs.fstatSync(descriptor, { bigint: true });
          assertRegularPrivateFile(stat, filePath);
          if (!samePathHandleFileIdentity(lstat, stat, parentDevice)) {
            throw queueError(
              "TEAM_QUEUE_PATH_RACE",
              `Distributed queue state changed while opening: ${filePath}`,
              filePath,
            );
          }
          const serialized = runtimeFs.readFileSync(descriptor, "utf8");
          const after = runtimeFs.fstatSync(descriptor, { bigint: true });
          if (
            Buffer.byteLength(serialized) !== Number(stat.size) ||
            !sameFileStatIdentity(stat, after)
          ) {
            throw queueError(
              "TEAM_QUEUE_PATH_RACE",
              `Distributed queue state changed while reading: ${filePath}`,
              filePath,
            );
          }
          if (Buffer.byteLength(serialized) > maxBytes) {
            throw queueError(
              "TEAM_QUEUE_TOO_LARGE",
              `Distributed queue state exceeds ${maxBytes} bytes: ${filePath}`,
              filePath,
            );
          }
          return {
            missing: false,
            identity: pathIdentity(stat),
            serialized,
          };
        } finally {
          if (descriptor != null) runtimeFs.closeSync(descriptor);
        }
      },
    );
  } catch (cause) {
    if (cause instanceof TeamDistributedQueueError) throw cause;
    const secureFailure = secureParentQueueError(cause, filePath, "read");
    if (secureFailure) throw secureFailure;
    throw queueError(
      "TEAM_QUEUE_READ_FAILED",
      `Could not securely read distributed queue state: ${filePath}`,
      filePath,
      cause,
    );
  }
}

function assertTargetIdentity(
  runtimeFs,
  filePath,
  expectedIdentity,
  expectedDevice,
) {
  let stat;
  try {
    stat = runtimeFs.lstatSync(filePath, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT" && expectedIdentity == null) return;
    throw queueError(
      "TEAM_QUEUE_PATH_RACE",
      `Distributed queue state identity changed before replace: ${filePath}`,
      filePath,
      cause,
    );
  }
  if (expectedIdentity == null) {
    throw queueError(
      "TEAM_QUEUE_PATH_RACE",
      `Distributed queue state appeared before create: ${filePath}`,
      filePath,
    );
  }
  assertRegularPrivateFile(stat, filePath);
  if (!samePathHandleFileIdentity(stat, expectedIdentity, expectedDevice)) {
    throw queueError(
      "TEAM_QUEUE_PATH_RACE",
      `Distributed queue state changed before replace: ${filePath}`,
      filePath,
    );
  }
}

function atomicWrite(
  runtimeFs,
  filePath,
  state,
  maxBytes,
  expectedIdentity,
  { secureFileParent = withTrustedFileParentSync } = {},
) {
  const serialized = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw queueError(
      "TEAM_QUEUE_TOO_LARGE",
      `Distributed queue state exceeds ${maxBytes} bytes: ${filePath}`,
      filePath,
    );
  }
  try {
    return secureFileParent(
      runtimeFs,
      filePath,
      ({
        canonicalPath,
        parentDescriptor,
        parentDevice,
        parentPath: directory,
      }) => {
        const temporaryPath = path.join(
          directory,
          `.${path.basename(canonicalPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
        );
        let descriptor = null;
        let renamed = false;
        try {
          descriptor = runtimeFs.openSync(temporaryPath, "wx", 0o600);
          runtimeFs.fchmodSync(descriptor, 0o600);
          runtimeFs.writeFileSync(descriptor, serialized, "utf8");
          runtimeFs.fsyncSync(descriptor);
          runtimeFs.closeSync(descriptor);
          descriptor = null;
          assertTargetIdentity(
            runtimeFs,
            canonicalPath,
            expectedIdentity,
            parentDevice,
          );
          runtimeFs.renameSync(temporaryPath, canonicalPath);
          renamed = true;
          const written = runtimeFs.lstatSync(canonicalPath, { bigint: true });
          assertRegularPrivateFile(written, filePath);
          if (process.platform !== "win32") {
            runtimeFs.fsyncSync(parentDescriptor);
          }
        } finally {
          if (descriptor != null) {
            try {
              runtimeFs.closeSync(descriptor);
            } catch {
              // Preserve the original write failure.
            }
          }
          if (!renamed) {
            try {
              runtimeFs.unlinkSync(temporaryPath);
            } catch {
              // The exact per-attempt temporary file is safe to clean best-effort.
            }
          }
        }
      },
    );
  } catch (cause) {
    if (cause instanceof TeamDistributedQueueError) throw cause;
    const secureFailure = secureParentQueueError(cause, filePath, "write");
    if (secureFailure) throw secureFailure;
    throw queueError(
      "TEAM_QUEUE_WRITE_FAILED",
      `Could not atomically write distributed queue state: ${filePath}`,
      filePath,
      cause,
    );
  }
}

function validateBudget(budget) {
  if (
    !isPlainObject(budget) ||
    !isPlainObject(budget.limits) ||
    !isPlainObject(budget.totals) ||
    !Array.isArray(budget.reservations)
  ) {
    throw new TypeError("invalid distributed queue budget");
  }
  const normalized = normalizeLimits(budget.limits);
  if (canonicalJson(normalized) !== canonicalJson(budget.limits)) {
    throw new TypeError("non-canonical distributed queue budget limits");
  }
  for (const field of ["tasksStarted", "tasksSettled", "tokens", "spentUsd"]) {
    const value = budget.totals[field];
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (field !== "spentUsd" && !Number.isSafeInteger(value))
    ) {
      throw new TypeError(`invalid distributed queue budget total: ${field}`);
    }
  }
  if (budget.totals.tasksSettled > budget.totals.tasksStarted) {
    throw new TypeError("settled task count exceeds started task count");
  }
  if (
    budget.totals.startedAt !== null &&
    (!Number.isFinite(budget.totals.startedAt) || budget.totals.startedAt < 0)
  ) {
    throw new TypeError("invalid distributed queue budget start time");
  }
  const leaseIds = new Set();
  for (const reservation of budget.reservations) {
    if (
      !isPlainObject(reservation) ||
      typeof reservation.leaseId !== "string" ||
      reservation.leaseId.length === 0 ||
      typeof reservation.taskKey !== "string" ||
      reservation.taskKey.length === 0 ||
      leaseIds.has(reservation.leaseId)
    ) {
      throw new TypeError("invalid distributed queue reservation identity");
    }
    leaseIds.add(reservation.leaseId);
    for (const field of ["maxTokens", "reservedTokens"]) {
      const value = reservation[field];
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new TypeError(`invalid reservation ${field}`);
      }
    }
    for (const field of ["maxUsd", "reservedUsd"]) {
      const value = reservation[field];
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new TypeError(`invalid reservation ${field}`);
      }
    }
  }
}

function validateStateShape(state) {
  if (!isPlainObject(state)) throw new TypeError("state must be an object");
  if (state.schemaVersion !== TEAM_DISTRIBUTED_QUEUE_SCHEMA_VERSION) {
    throw new TypeError(
      `unsupported distributed queue schema ${state.schemaVersion}`,
    );
  }
  if (
    typeof state.queueId !== "string" ||
    state.queueId.length < 1 ||
    state.queueId.length > 512 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Number.isSafeInteger(state.nextFence) ||
    state.nextFence < 1 ||
    !Number.isSafeInteger(state.nextFinalizationFence) ||
    state.nextFinalizationFence < 1 ||
    !Number.isFinite(state.createdAt) ||
    state.createdAt < 0 ||
    !Number.isFinite(state.updatedAt) ||
    state.updatedAt < state.createdAt ||
    !Array.isArray(state.graph) ||
    !isPlainObject(state.authority) ||
    !isPlainObject(state.registry)
  ) {
    throw new TypeError("invalid distributed queue state fields");
  }
  for (const field of ["graphDigest", "authorityDigest", "integrityDigest"]) {
    if (!DIGEST_PATTERN.test(state[field] || "")) {
      throw new TypeError(`invalid distributed queue ${field}`);
    }
  }
  validateBudget(state.budget);
  validateInterruptionLedger(state);
  normalizeFinalization(state.finalization, state);
}

function activeLeases(registry) {
  return registry
    .list()
    .filter((task) => task.lease)
    .map((task) => ({
      taskKey: task.key,
      ...task.lease,
    }));
}

function finalizationInputPayload(state, registry) {
  return {
    queueId: state.queueId,
    graphDigest: state.graphDigest,
    authorityDigest: state.authorityDigest,
    tasks: registry
      .list()
      .map((task) => ({
        key: task.key,
        status: task.status,
        result: cloneJson(task.metadata?.result ?? null, "task result"),
        adjudication: cloneJson(
          task.metadata?.adjudication ?? null,
          "task adjudication",
        ),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function finalizationInputDigest(state, registry) {
  return digest(finalizationInputPayload(state, registry));
}

function finalizationTaskBindings(registry) {
  return registry
    .list()
    .map((task) => {
      if (task.status !== "completed") {
        throw new FinalizationRequestError(
          "finalization_not_ready",
          `task "${task.key}" is not completed`,
        );
      }
      if (
        task.metadata?.adjudication?.required === true ||
        task.lease != null
      ) {
        throw new FinalizationRequestError(
          "finalization_not_ready",
          `task "${task.key}" still has active authority or adjudication`,
        );
      }
      const result = task.metadata?.result;
      if (!isPlainObject(result)) {
        throw new FinalizationRequestError(
          "finalization_result_missing",
          `completed task "${task.key}" has no worktree result`,
        );
      }
      return {
        key: task.key,
        branch: finalizationText(
          result.branch,
          "finalization_task_branch",
          4096,
        ),
        commitOid: optionalGitOid(
          result.commitOid,
          `task "${task.key}" result commitOid`,
        ),
        worktreePath: finalizationText(
          result.worktreePath,
          "finalization_task_worktree_path",
          16384,
        ),
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function validateFinalizationBindings(finalization, state, registry) {
  if (finalization.phase === "idle") return;
  if (finalization.inputDigest !== finalizationInputDigest(state, registry)) {
    throw new TypeError("finalization input changed after it was fenced");
  }
  const bindings = finalizationTaskBindings(registry);
  if (canonicalJson(bindings) !== canonicalJson(finalization.git.branches)) {
    throw new TypeError("finalization task Git bindings changed");
  }
}

function validateRegistry(registry, state) {
  const interruptionRequests = validateInterruptionLedger(state);
  const graph = graphFromRegistrySnapshot(registry.snapshot());
  if (canonicalJson(graph) !== canonicalJson(state.graph)) {
    throw new TypeError("registry task graph does not match graph authority");
  }
  const graphKeys = new Set();
  for (const task of graph) {
    if (
      typeof task.key !== "string" ||
      task.key.length === 0 ||
      typeof task.title !== "string" ||
      task.title.length === 0 ||
      graphKeys.has(task.key) ||
      !Array.isArray(task.dependsOn)
    ) {
      throw new TypeError("invalid task in distributed queue graph");
    }
    graphKeys.add(task.key);
  }
  for (const task of graph) {
    for (const dependency of task.dependsOn) {
      if (!graphKeys.has(dependency)) {
        throw new TypeError(
          `task "${task.key}" has unknown dependency "${dependency}"`,
        );
      }
    }
  }

  const registryTasks = registry._tasks.list();
  if (
    registry._byKey.size !== registryTasks.length ||
    registryTasks.length !== graph.length
  ) {
    throw new TypeError("registry key index does not match its task list");
  }
  for (const task of registryTasks) {
    const key = task?.metadata?.key;
    if (
      registry._byKey.get(key) !== task.id ||
      !TASK_STATUSES.has(task.status) ||
      !Number.isSafeInteger(task.rev) ||
      task.rev < 1 ||
      !Number.isSafeInteger(task?.metadata?.attempts || 0) ||
      (task?.metadata?.attempts || 0) < 0
    ) {
      throw new TypeError(`invalid registry task state for "${key}"`);
    }
    const lease = task?.metadata?.lease;
    if (
      lease &&
      (typeof lease.holder !== "string" ||
        lease.holder.length === 0 ||
        !Number.isFinite(lease.acquiredAt) ||
        !Number.isFinite(lease.expiresAt) ||
        lease.expiresAt < lease.acquiredAt ||
        !Number.isSafeInteger(lease.renewals) ||
        lease.renewals < 0)
    ) {
      throw new TypeError(`invalid registry lease state for "${key}"`);
    }
    if (task?.metadata?.workspaceExecution != null) {
      normalizeWorkspaceExecution(task.metadata.workspaceExecution, {
        state,
        key,
        activeLease: lease || null,
      });
    }
    normalizeWorkspaceExecutionHistory(
      task?.metadata?.workspaceExecutionHistory,
      { state, key },
    );
    validateWorkspaceRecoveryMetadata(task, state, key);
    if (task?.metadata?.interruption != null) {
      const interruption = normalizeInterruptionRecord(
        task.metadata.interruption,
        state,
        key,
      );
      const durable = interruptionRequests.get(interruption.requestId);
      if (
        !durable ||
        durable.requestDigest !== interruption.requestDigest ||
        durable.evidenceDigest !== interruption.evidenceDigest
      ) {
        throw new TypeError(
          `task "${key}" interruption has no matching durable request`,
        );
      }
      if (
        activeInterruption(task, lease) &&
        (task.status !== "in_progress" ||
          canonicalJson(lease) !== canonicalJson(interruption.lease))
      ) {
        throw new TypeError(
          `task "${key}" active interruption lease binding is invalid`,
        );
      }
    }
  }

  const leases = activeLeases(registry);
  const reservations = new Map(
    state.budget.reservations.map((item) => [item.leaseId, item]),
  );
  if (leases.length !== reservations.size) {
    throw new TypeError("lease and budget reservation counts differ");
  }
  for (const lease of leases) {
    if (
      typeof lease.leaseId !== "string" ||
      !Number.isSafeInteger(lease.fencingToken) ||
      lease.fencingToken < 1 ||
      !Number.isSafeInteger(lease.ownerPid) ||
      lease.ownerPid < 1
    ) {
      throw new TypeError("invalid durable lease authority");
    }
    const reservation = reservations.get(lease.leaseId);
    if (!reservation || reservation.taskKey !== lease.taskKey) {
      throw new TypeError("lease has no matching budget reservation");
    }
  }
  validateFinalizationBindings(state.finalization, state, registry);
}

function parseState(serialized, filePath) {
  try {
    return JSON.parse(serialized);
  } catch (cause) {
    throw queueError(
      "TEAM_QUEUE_CORRUPT",
      `Distributed queue state is not valid JSON: ${filePath}`,
      filePath,
      cause,
    );
  }
}

function validateState(state, filePath, expected = {}) {
  try {
    validateStateShape(state);
    if (digest(state.graph) !== state.graphDigest) {
      throw new TypeError("graph digest mismatch");
    }
    if (digest(authorityPayload(state)) !== state.authorityDigest) {
      throw new TypeError("authority digest mismatch");
    }
    if (digest(stateWithoutIntegrity(state)) !== state.integrityDigest) {
      throw new TypeError("integrity digest mismatch");
    }
    if (expected.queueId && state.queueId !== expected.queueId) {
      throw new TypeError("queue id does not match the pinned authority");
    }
    if (
      expected.authorityDigest &&
      state.authorityDigest !== expected.authorityDigest
    ) {
      throw new TypeError("queue authority digest does not match the pin");
    }
    if (
      expected.runId &&
      String(state.authority?.runId || "") !== expected.runId
    ) {
      throw new TypeError("queue run id does not match the pinned authority");
    }
  } catch (cause) {
    throw queueError(
      "TEAM_QUEUE_CORRUPT",
      `Distributed queue state failed validation: ${cause.message}`,
      filePath,
      cause,
    );
  }
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function usageTokens(usage) {
  if (usage == null) return null;
  if (!isPlainObject(usage)) throw new TypeError("usage must be an object");
  let total = 0;
  let fields = 0;
  for (const field of USAGE_TOKEN_FIELDS) {
    if (usage[field] == null) continue;
    const value = Number(usage[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`usage.${field} must be a non-negative integer`);
    }
    if (!Number.isSafeInteger(total + value)) {
      throw new TypeError("usage token total exceeds the safe integer range");
    }
    total += value;
    fields += 1;
  }
  if (fields === 0) {
    throw new TypeError("usage has no accountable token fields");
  }
  return total;
}

function validateUsageRecords(usageRecords, usage) {
  if (usageRecords == null) return null;
  if (
    !Array.isArray(usageRecords) ||
    usageRecords.length === 0 ||
    usageRecords.length > MAX_USAGE_RECORDS
  ) {
    throw new TypeError(
      `usageRecords must contain 1..${MAX_USAGE_RECORDS} records`,
    );
  }
  const aggregate = Object.fromEntries(
    USAGE_TOKEN_FIELDS.map((field) => [field, 0]),
  );
  usageRecords.forEach((record, index) => {
    if (!isPlainObject(record)) {
      throw new TypeError(`usageRecords[${index}] must be an object`);
    }
    for (const field of ["provider", "model"]) {
      const value = record[field];
      if (
        value != null &&
        (typeof value !== "string" ||
          value.length === 0 ||
          value !== value.trim() ||
          Buffer.byteLength(value, "utf8") > 512 ||
          CONTROL_CHARACTER_PATTERN.test(value))
      ) {
        throw new TypeError(
          `usageRecords[${index}].${field} must be a stable string`,
        );
      }
    }
    if (record.usage == null) {
      throw new TypeError(`usageRecords[${index}].usage is required`);
    }
    usageTokens(record.usage);
    for (const field of USAGE_TOKEN_FIELDS) {
      const value = Number(record.usage[field] || 0);
      if (!Number.isSafeInteger(aggregate[field] + value)) {
        throw new TypeError(
          `usageRecords aggregate ${field} exceeds the safe integer range`,
        );
      }
      aggregate[field] += value;
    }
  });
  if (usage != null) {
    for (const field of USAGE_TOKEN_FIELDS) {
      if (aggregate[field] !== Number(usage[field] || 0)) {
        throw new TypeError(
          `usageRecords do not match aggregate usage.${field}`,
        );
      }
    }
  }
  return aggregate;
}

function reservationFor(state, leaseId) {
  return state.budget.reservations.find((item) => item.leaseId === leaseId);
}

function removeReservation(state, leaseId) {
  const index = state.budget.reservations.findIndex(
    (item) => item.leaseId === leaseId,
  );
  if (index < 0) return null;
  return state.budget.reservations.splice(index, 1)[0];
}

function chargeAbandonedReservation(state, leaseId) {
  const reservation = removeReservation(state, leaseId);
  if (!reservation) return null;
  // The process disappeared without trustworthy metering. Conservatively
  // consume its full global reservation so crash/retry cannot refresh token or
  // USD authority and overspend the durable team budget.
  state.budget.totals.tokens += reservation.reservedTokens || 0;
  state.budget.totals.spentUsd += reservation.reservedUsd || 0;
  return reservation;
}

function isRetrySafeAbandonment(task, state) {
  if (activeInterruption(task)) return false;
  const declaredRetrySafe = !!(
    state.authority?.dryRun === true ||
    task?.metadata?.dryRun === true ||
    task?.metadata?.retrySafe === true
  );
  if (!declaredRetrySafe) return false;
  if (state.authority?.checkpoint?.enabled !== true) return true;
  const checkpoint = task?.metadata?.workspaceExecution?.checkpoint;
  // Managed execution is replayable only after the prior transaction reached
  // a durably proven rollback. Missing/running/coverage-none evidence remains
  // an adjudication case even if the task declared itself retry-safe.
  return !!(
    checkpoint &&
    ["rolled_back", "aborted"].includes(checkpoint.state) &&
    checkpoint.recoveryRequired === false &&
    checkpoint.coverage !== "none" &&
    checkpoint.fileCoverage !== "none" &&
    checkpoint.evidenceDigest
  );
}

function abandonedLeaseEvidence(
  state,
  taskKey,
  lease,
  now,
  reason,
  workspaceExecution = null,
) {
  const evidence = {
    schemaVersion: 1,
    kind: "distributed-lease-abandonment",
    queueId: state.queueId,
    taskKey,
    observedAt: now,
    reason,
    lease: cloneJson(lease, "abandoned lease"),
    budgetReservation: cloneJson(
      reservationFor(state, lease.leaseId) || null,
      "abandoned budget reservation",
    ),
    workspaceExecution: cloneJson(
      workspaceExecution,
      "abandoned workspace execution",
    ),
  };
  return {
    ...evidence,
    evidenceDigest: `sha256:${digest(evidence)}`,
  };
}

function workspaceAcceptanceFailure(reason, error = null) {
  return {
    ok: false,
    reason,
    ...(error ? { error } : {}),
  };
}

function immutableWorkspaceExecutionBinding(execution) {
  return {
    version: execution.version,
    queueId: execution.queueId,
    runId: execution.runId,
    taskKey: execution.taskKey,
    workerId: execution.workerId,
    lease: execution.lease,
    worktree: {
      key: execution.worktree.key,
      branch: execution.worktree.branch,
      path: execution.worktree.path,
      dependencyCommits: execution.worktree.dependencyCommits,
      baselineCommitOid: execution.worktree.baselineCommitOid,
      managedLinks: execution.worktree.managedLinks,
    },
    checkpoint: {
      transactionId: execution.checkpoint.transactionId,
      checkpointId: execution.checkpoint.checkpointId,
      runId: execution.checkpoint.runId,
      taskKey: execution.checkpoint.taskKey,
      workspaceRoot: execution.checkpoint.workspaceRoot,
      stateDir: execution.checkpoint.stateDir,
      writerIsolation: execution.checkpoint.writerIsolation,
      requestedCoverage: execution.checkpoint.requestedCoverage,
      checkpointDigest: execution.checkpoint.checkpointDigest,
    },
  };
}

function sameWorkspaceExecutionBinding(left, right) {
  return (
    canonicalJson(immutableWorkspaceExecutionBinding(left)) ===
      canonicalJson(immutableWorkspaceExecutionBinding(right)) &&
    (!left.verifiedCommitOid ||
      !right.verifiedCommitOid ||
      left.verifiedCommitOid === right.verifiedCommitOid)
  );
}

function verifyWorkspaceRecoveryRecord(
  record,
  { abandonedExecution, currentExecution, evidenceDigest },
) {
  if (!isPlainObject(record)) {
    return workspaceAcceptanceFailure("workspace_recovery_record_missing");
  }
  const fromExecutionDigest = `sha256:${digest(abandonedExecution)}`;
  const toExecutionDigest = `sha256:${digest(currentExecution)}`;
  const expectedOutcome = isRetryableWorkspaceSettlement(currentExecution)
    ? "rolled-back"
    : ["committed", "completed"].includes(currentExecution.phase)
      ? "committed"
      : null;
  if (
    record.version !== 1 ||
    record.kind !== "distributed-workspace-recovery" ||
    typeof record.recoveryId !== "string" ||
    !EVIDENCE_DIGEST_PATTERN.test(record.requestDigest || "") ||
    record.abandonmentEvidenceDigest !== evidenceDigest ||
    record.fromExecutionDigest !== fromExecutionDigest ||
    record.toExecutionDigest !== toExecutionDigest ||
    record.checkpointDigest !== currentExecution.checkpoint.checkpointDigest ||
    record.writeManifestDigest !==
      currentExecution.checkpoint.writeManifestDigest ||
    record.checkpointEvidenceDigest !==
      currentExecution.checkpoint.evidenceDigest ||
    record.outcome !== expectedOutcome ||
    !Number.isFinite(record.recoveredAt)
  ) {
    return workspaceAcceptanceFailure("workspace_recovery_record_mismatch");
  }
  return {
    ok: true,
    record,
    recordDigest: `sha256:${digest(record)}`,
  };
}

function validateWorkspaceRecoveryMetadata(task, state, key) {
  const record = task?.metadata?.workspaceRecovery;
  if (record == null) return;
  const currentSource = task?.metadata?.workspaceExecution;
  const abandonedSource =
    task?.metadata?.abandonedLeaseEvidence?.workspaceExecution;
  const evidenceDigest = task?.metadata?.abandonedLeaseEvidence?.evidenceDigest;
  if (
    !currentSource ||
    !abandonedSource ||
    typeof evidenceDigest !== "string" ||
    !EVIDENCE_DIGEST_PATTERN.test(evidenceDigest)
  ) {
    throw new TypeError("workspaceRecovery lacks abandoned execution evidence");
  }
  const abandonedEvidence = cloneJson(
    task.metadata.abandonedLeaseEvidence,
    "abandoned lease evidence",
  );
  delete abandonedEvidence.evidenceDigest;
  if (
    `sha256:${digest(abandonedEvidence)}` !== evidenceDigest ||
    abandonedEvidence.queueId !== state.queueId ||
    abandonedEvidence.taskKey !== key
  ) {
    throw new TypeError("workspaceRecovery abandonment evidence changed");
  }
  const current = normalizeWorkspaceExecution(currentSource, { state, key });
  const abandoned = normalizeWorkspaceExecution(abandonedSource, {
    state,
    key,
  });
  if (!sameWorkspaceExecutionBinding(abandoned, current)) {
    throw new TypeError("workspaceRecovery authority binding changed");
  }
  const verified = verifyWorkspaceRecoveryRecord(record, {
    abandonedExecution: abandoned,
    currentExecution: current,
    evidenceDigest,
  });
  if (!verified.ok) {
    throw new TypeError(verified.reason);
  }
}

function verifyAbandonedWorkspaceBinding(task, state, key, evidenceDigest) {
  const adjudication = task?.metadata?.adjudication || null;
  if (adjudication?.required !== true) {
    return workspaceAcceptanceFailure("adjudication_not_required");
  }
  if (!adjudication.evidenceDigest) {
    return workspaceAcceptanceFailure("adjudication_evidence_missing");
  }
  if (adjudication.evidenceDigest !== evidenceDigest) {
    return workspaceAcceptanceFailure("evidence_mismatch");
  }

  const abandoned = task?.metadata?.abandonedLeaseEvidence;
  if (!isPlainObject(abandoned)) {
    return workspaceAcceptanceFailure("abandonment_evidence_missing");
  }
  let cloned;
  try {
    cloned = cloneJson(abandoned, "abandoned lease evidence");
  } catch (error) {
    return workspaceAcceptanceFailure(
      "invalid_abandonment_evidence",
      error instanceof Error ? error.message : String(error),
    );
  }
  const storedDigest = cloned.evidenceDigest;
  delete cloned.evidenceDigest;
  const recomputedDigest = `sha256:${digest(cloned)}`;
  if (
    storedDigest !== evidenceDigest ||
    recomputedDigest !== evidenceDigest ||
    cloned.schemaVersion !== 1 ||
    cloned.kind !== "distributed-lease-abandonment" ||
    cloned.queueId !== state.queueId ||
    cloned.taskKey !== key
  ) {
    return workspaceAcceptanceFailure("abandonment_evidence_mismatch");
  }

  const currentExecution = task?.metadata?.workspaceExecution || null;
  const abandonedExecution = cloned.workspaceExecution || null;
  if (!currentExecution || !abandonedExecution) {
    return workspaceAcceptanceFailure("workspace_execution_evidence_missing");
  }

  let execution;
  let initialExecution;
  try {
    execution = normalizeWorkspaceExecution(currentExecution, { state, key });
    initialExecution = normalizeWorkspaceExecution(abandonedExecution, {
      state,
      key,
    });
  } catch (error) {
    return workspaceAcceptanceFailure(
      "invalid_workspace_execution",
      error instanceof Error ? error.message : String(error),
    );
  }
  const abandonedLease = cloned.lease || {};
  if (
    abandonedLease.holder !== initialExecution.lease.holder ||
    abandonedLease.leaseId !== initialExecution.lease.leaseId ||
    abandonedLease.ownerPid !== initialExecution.lease.ownerPid ||
    abandonedLease.fencingToken !== initialExecution.lease.fencingToken
  ) {
    return workspaceAcceptanceFailure("workspace_execution_lease_mismatch");
  }
  if (!sameWorkspaceExecutionBinding(initialExecution, execution)) {
    return workspaceAcceptanceFailure("workspace_execution_binding_changed");
  }

  let recovery = null;
  if (canonicalJson(initialExecution) !== canonicalJson(execution)) {
    recovery = verifyWorkspaceRecoveryRecord(task.metadata?.workspaceRecovery, {
      abandonedExecution: initialExecution,
      currentExecution: execution,
      evidenceDigest,
    });
    if (!recovery.ok) return recovery;
  }
  return {
    ok: true,
    abandoned: cloned,
    initialExecution,
    execution,
    recovery,
  };
}

function verifyAbandonedWorkspaceEvidence(task, state, key, evidenceDigest) {
  const binding = verifyAbandonedWorkspaceBinding(
    task,
    state,
    key,
    evidenceDigest,
  );
  if (!binding.ok) return binding;
  const { execution, recovery } = binding;
  if (!ADJUDICATION_ACCEPTANCE_PHASES.has(execution.phase)) {
    return workspaceAcceptanceFailure(
      "workspace_execution_not_acceptance_ready",
    );
  }
  if (
    execution.checkpoint?.state !== "committed" ||
    execution.checkpoint?.recoveryRequired !== false ||
    !execution.verifiedCommitOid ||
    !execution.worktree?.baselineCommitOid ||
    !execution.checkpoint?.checkpointDigest
  ) {
    return workspaceAcceptanceFailure("workspace_execution_proof_incomplete");
  }

  const proof = {
    schemaVersion: 1,
    kind: "distributed-workspace-adjudication-acceptance",
    queueId: state.queueId,
    taskKey: key,
    abandonmentEvidenceDigest: evidenceDigest,
    workspaceExecutionDigest: `sha256:${digest(execution)}`,
    phase: execution.phase,
    transactionId: execution.checkpoint.transactionId,
    checkpointId: execution.checkpoint.checkpointId,
    checkpointDigest: execution.checkpoint.checkpointDigest,
    writeManifestDigest: execution.checkpoint.writeManifestDigest,
    checkpointEvidenceDigest: execution.checkpoint.evidenceDigest,
    verifiedCommitOid: execution.verifiedCommitOid,
    branch: execution.worktree.branch,
    worktreePath: execution.worktree.path,
    baselineCommitOid: execution.worktree.baselineCommitOid,
    workspaceRecoveryDigest: recovery?.recordDigest || null,
  };
  const result = {
    branch: execution.worktree.branch,
    worktreePath: execution.worktree.path,
    committed:
      execution.phase === "completed"
        ? execution.worktree.committed
        : execution.verifiedCommitOid !== execution.worktree.baselineCommitOid,
    commitOid: execution.verifiedCommitOid,
    baselineCommitOid: execution.worktree.baselineCommitOid,
    dependencyCommits: cloneJson(
      execution.worktree.dependencyCommits,
      "workspace dependency commits",
    ),
    managedLinks: cloneJson(
      execution.worktree.managedLinks,
      "workspace managed links",
    ),
    workspaceCheckpoint: cloneJson(
      execution.checkpoint,
      "workspace checkpoint",
    ),
    workspaceExecutionEvidence: proof,
  };
  return { ok: true, execution, proof, result };
}

function findAdjudicationDecision(registry, decisionId) {
  for (const task of registry.list()) {
    const decision = task?.metadata?.adjudication?.decision || null;
    if (decision?.id === decisionId) {
      return { key: task.key, task, decision };
    }
  }
  return null;
}

function findWorkspaceRecovery(registry, recoveryId) {
  for (const task of registry.list()) {
    const recovery = task?.metadata?.workspaceRecovery || null;
    if (recovery?.recoveryId === recoveryId) {
      return { key: task.key, task, recovery };
    }
  }
  return null;
}

function budgetStatus(state, now) {
  const { limits, totals, reservations } = state.budget;
  const reservedTokens = reservations.reduce(
    (sum, item) => sum + (item.reservedTokens || 0),
    0,
  );
  const reservedUsd = reservations.reduce(
    (sum, item) => sum + (item.reservedUsd || 0),
    0,
  );
  let reason = null;
  if (limits.maxTasks != null && totals.tasksStarted >= limits.maxTasks) {
    reason = "max-tasks";
  } else if (
    limits.maxTokens != null &&
    totals.tokens + reservedTokens >= limits.maxTokens
  ) {
    reason = "max-tokens";
  } else if (
    limits.maxUsd != null &&
    totals.spentUsd + reservedUsd >= limits.maxUsd
  ) {
    reason = "max-usd";
  } else if (
    limits.maxWallMs != null &&
    totals.startedAt != null &&
    now - totals.startedAt >= limits.maxWallMs
  ) {
    reason = "max-wall-ms";
  }
  return {
    ...cloneJson(totals),
    ...cloneJson(limits),
    observedAt: now,
    reservedTokens,
    reservedUsd,
    reservations: reservations.length,
    elapsedMs:
      totals.startedAt == null ? 0 : Math.max(0, now - totals.startedAt),
    reason,
  };
}

function planReservation(state, options, now) {
  const status = budgetStatus(state, now);
  if (status.reason) return { ok: false, reason: status.reason };
  const { limits, totals, reservations } = state.budget;
  const slots =
    Number.isSafeInteger(options.slots) && options.slots > 0
      ? options.slots
      : 1;
  const requestedTokens = positiveLimit(
    options.maxTokens ?? options.reservation?.maxTokens,
    { integer: true, label: "reservation maxTokens" },
  );
  const requestedUsd = positiveLimit(
    options.maxUsd ??
      options.maxBudgetUsd ??
      options.reservation?.maxUsd ??
      options.reservation?.maxBudgetUsd,
    { label: "reservation maxUsd" },
  );
  const alreadyReservedTokens = reservations.reduce(
    (sum, item) => sum + (item.reservedTokens || 0),
    0,
  );
  const alreadyReservedUsd = reservations.reduce(
    (sum, item) => sum + (item.reservedUsd || 0),
    0,
  );

  let maxTokens = requestedTokens;
  let reservedTokens = 0;
  if (limits.maxTokens != null) {
    const remaining = Math.max(
      0,
      limits.maxTokens - totals.tokens - alreadyReservedTokens,
    );
    if (remaining <= 0) return { ok: false, reason: "max-tokens" };
    const fair = Math.max(1, Math.ceil(remaining / slots));
    maxTokens = requestedTokens == null ? fair : requestedTokens;
    if (maxTokens > remaining) return { ok: false, reason: "max-tokens" };
    reservedTokens = maxTokens;
  }

  let maxUsd = requestedUsd;
  let reservedUsd = 0;
  if (limits.maxUsd != null) {
    const remaining = Math.max(
      0,
      limits.maxUsd - totals.spentUsd - alreadyReservedUsd,
    );
    if (remaining <= Number.EPSILON) {
      return { ok: false, reason: "max-usd" };
    }
    const fair = remaining / slots;
    maxUsd = requestedUsd == null ? fair : requestedUsd;
    if (maxUsd - remaining > Number.EPSILON) {
      return { ok: false, reason: "max-usd" };
    }
    reservedUsd = maxUsd;
  }
  return {
    ok: true,
    maxTokens,
    maxUsd,
    reservedTokens,
    reservedUsd,
  };
}

function settleBudget(state, leaseId, { usage, usageRecords, costUsd } = {}) {
  const reservation = reservationFor(state, leaseId);
  if (!reservation) {
    return { ok: false, reason: "missing-budget-reservation" };
  }
  let tokens;
  try {
    tokens = usageTokens(usage);
    validateUsageRecords(usageRecords, usage);
  } catch (error) {
    return { ok: false, reason: "invalid-usage", error: error.message };
  }
  const parsedCost =
    costUsd == null
      ? null
      : Number.isFinite(Number(costUsd))
        ? Number(costUsd)
        : NaN;
  if (Number.isNaN(parsedCost) || parsedCost < 0) {
    return { ok: false, reason: "invalid-cost" };
  }
  // Missing metering consumes the whole reservation. This is conservative:
  // a provider that failed to report usage cannot silently refresh the cap.
  const chargedTokens =
    tokens == null && state.budget.limits.maxTokens != null
      ? reservation.reservedTokens
      : tokens || 0;
  const chargedUsd =
    parsedCost == null && state.budget.limits.maxUsd != null
      ? reservation.reservedUsd
      : parsedCost || 0;
  if (reservation.maxTokens != null && chargedTokens > reservation.maxTokens) {
    return { ok: false, reason: "usage-exceeds-reservation" };
  }
  if (!Number.isSafeInteger(state.budget.totals.tokens + chargedTokens)) {
    return {
      ok: false,
      reason: "invalid-usage",
      error: "usage token total exceeds the safe integer range",
    };
  }
  if (
    reservation.maxUsd != null &&
    chargedUsd - reservation.maxUsd > Number.EPSILON
  ) {
    return { ok: false, reason: "cost-exceeds-reservation" };
  }
  return { ok: true, reservation, chargedTokens, chargedUsd };
}

function finalizationRequestFailure(error) {
  if (error instanceof FinalizationRequestError) {
    return { ok: false, reason: error.reason, error: error.message };
  }
  return {
    ok: false,
    reason: "invalid_finalization_request",
    error: error instanceof Error ? error.message : String(error),
  };
}

function finalizationTtl(value) {
  const ttl = value == null ? DEFAULT_FINALIZATION_TTL_MS : Number(value);
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new FinalizationRequestError(
      "invalid_finalization_ttl",
      "finalization ttlMs must be a positive integer",
    );
  }
  return ttl;
}

function finalizationLeaseUnavailable(queue, lease, now) {
  let dead = false;
  try {
    dead = !queue._isProcessAlive(lease.ownerPid);
  } catch (cause) {
    throw queueError(
      "TEAM_QUEUE_LIVENESS_FAILED",
      `Could not verify finalization owner process ${lease.ownerPid}`,
      queue.filePath,
      cause,
    );
  }
  return {
    // Expiry is a liveness signal, not authority to run a second destructive
    // merge/cleanup process. A synchronous Git operation can outlive its TTL;
    // takeover is safe only after the owner process is confirmed dead.
    unavailable: dead,
    expired: lease.expiresAt <= now,
    dead,
  };
}

function createFinalizationLease(queue, state, owner, ttlMs, now) {
  const lease = {
    owner,
    leaseId: queue._nextId("finalization-lease"),
    ownerPid: queue._processId,
    fencingToken: state.nextFinalizationFence,
    acquiredAt: now,
    expiresAt: now + ttlMs,
    renewals: 0,
  };
  state.nextFinalizationFence += 1;
  return lease;
}

function finalizationLeaseMatches(queue, finalization, options) {
  const lease = finalization.lease;
  if (
    !lease ||
    lease.ownerPid !== queue._processId ||
    lease.owner !== options.owner ||
    lease.leaseId !== options.leaseId ||
    lease.fencingToken !== Number(options.fencingToken)
  ) {
    return { ok: false, reason: "finalization_not_holder" };
  }
  return { ok: true, lease };
}

function finalizationIntent(kind, git, coordinator, now) {
  return {
    kind,
    expectedBaseOid: git.currentBaseOid,
    branches: cloneJson(git.branches, "finalization intent branches"),
    coordinatorDigest: digest(coordinator),
    preparedAt: now,
  };
}

function finalizationTransitionPayload(options) {
  return {
    operationId: options.operationId,
    expectedPhase: options.expectedPhase,
    expectedRevision: Number(options.expectedRevision),
    toPhase: options.toPhase,
    coordinator: options.coordinator ?? null,
    result: options.result ?? null,
    currentBaseOid: options.currentBaseOid ?? null,
    intentKind: options.intentKind ?? null,
    releaseLease: options.releaseLease === true,
    block: options.block ?? null,
    recoveryReason: options.recoveryReason ?? null,
  };
}

function findFinalizationTransition(finalization, transitionId) {
  return finalization.transitions.find((item) => item.id === transitionId);
}

function appendFinalizationTransition(
  finalization,
  { id, transitionDigest, from, to, at },
) {
  finalization.transitions = [
    ...finalization.transitions,
    {
      id,
      digest: transitionDigest,
      from,
      to,
      at,
    },
  ].slice(-MAX_FINALIZATION_TRANSITIONS);
}

function assertFinalizationEvidence(phase, finalization) {
  const records = finalization.coordinator.records;
  const all = (predicate) => records.every(predicate);
  if (
    [
      "previewed",
      "merged",
      "cleanup_prepared",
      "cleaning",
      "completed",
    ].includes(phase) &&
    (!Array.isArray(finalization.result.preview) ||
      !all(
        (record) =>
          record.integration?.previewed === true &&
          record.integration?.clean === true,
      ))
  ) {
    throw new FinalizationRequestError(
      "finalization_preview_evidence_missing",
      `finalization phase "${phase}" lacks a clean preview`,
    );
  }
  if (
    ["merged", "cleanup_prepared", "cleaning", "completed"].includes(phase) &&
    (!Array.isArray(finalization.result.integration) ||
      !all(
        (record) =>
          record.committed !== true || record.integration?.merged === true,
      ))
  ) {
    throw new FinalizationRequestError(
      "finalization_merge_evidence_missing",
      `finalization phase "${phase}" lacks complete merge evidence`,
    );
  }
  if (
    ["cleanup_prepared", "cleaning", "completed"].includes(phase) &&
    !all((record) => record.cleanupPrepared === true)
  ) {
    throw new FinalizationRequestError(
      "finalization_cleanup_prepare_missing",
      `finalization phase "${phase}" lacks durable cleanup preparation`,
    );
  }
  if (
    phase === "completed" &&
    (!Array.isArray(finalization.result.cleanup) ||
      finalization.result.cleanup.some((item) => item?.ok !== true) ||
      !all((record) => record.cleaned === true))
  ) {
    throw new FinalizationRequestError(
      "finalization_cleanup_incomplete",
      "finalization completion lacks successful cleanup evidence",
    );
  }
}

function finalizationResult(finalization, extra = {}) {
  return {
    ok: true,
    operationId: finalization.operationId,
    phase: finalization.phase,
    revision: finalization.revision,
    lease: cloneJson(finalization.lease, "finalization lease"),
    finalization: cloneJson(finalization, "finalization"),
    ...extra,
  };
}

/**
 * Synchronous by design: TeamRunner's registry contract is synchronous and
 * withFileLock serializes one short JSON read/modify/write critical section.
 */
export class TeamDistributedQueue {
  constructor({
    filePath,
    statePath,
    now = () => Date.now(),
    id = () => crypto.randomUUID(),
    processId = process.pid,
    isProcessAlive = defaultProcessAlive,
    maxStateBytes = DEFAULT_DISTRIBUTED_QUEUE_MAX_BYTES,
    lock = withFileLock,
    fileSystem = fs,
    secureFileParent = withTrustedFileParentSync,
    lockTimeoutMs = 30000,
    lockStaleMs = 30000,
    lockRetryMs = 10,
    lockMaxRetryMs = 80,
    lockRetryJitterMs = 20,
    lockYieldAfterReleaseMs = 30,
    lockOptions = {},
    expectedQueueId = null,
    expectedAuthorityDigest = null,
    expectedRunId = null,
  } = {}) {
    const target = filePath || statePath;
    if (!target || typeof target !== "string") {
      throw new TypeError("TeamDistributedQueue filePath is required");
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    if (typeof id !== "function") throw new TypeError("id must be a function");
    if (!Number.isSafeInteger(processId) || processId <= 0) {
      throw new TypeError("processId must be a positive integer");
    }
    if (typeof isProcessAlive !== "function") {
      throw new TypeError("isProcessAlive must be a function");
    }
    if (!fileSystem || typeof fileSystem !== "object") {
      throw new TypeError("fileSystem must be an fs-compatible object");
    }
    if (typeof secureFileParent !== "function") {
      throw new TypeError("secureFileParent must be a function");
    }
    this.filePath = path.resolve(target);
    this._now = now;
    this._id = id;
    this._processId = processId;
    this._isProcessAlive = isProcessAlive;
    this._maxStateBytes = positiveLimit(maxStateBytes, {
      integer: true,
      label: "maxStateBytes",
    });
    this._lock = lock;
    this._fileSystem = fileSystem;
    this._secureFileParent = secureFileParent;
    this._lockOptions = {
      timeoutMs: lockTimeoutMs,
      staleMs: lockStaleMs,
      retryMs: lockRetryMs,
      maxRetryMs: lockMaxRetryMs,
      retryJitterMs: lockRetryJitterMs,
      yieldAfterReleaseMs: lockYieldAfterReleaseMs,
      ...lockOptions,
      failIfUnavailable: true,
    };
    this._expected = {
      queueId: expectedQueueId || null,
      authorityDigest: expectedAuthorityDigest || null,
      runId: expectedRunId == null ? null : String(expectedRunId),
    };
  }

  static create({
    tasks = [],
    authority = {},
    runId = null,
    budget = {},
    groupId = null,
    defaultTtlMs,
    maxAttempts,
    ...options
  } = {}) {
    const queue = new TeamDistributedQueue(options);
    if (
      runId != null &&
      authority?.runId != null &&
      String(authority.runId) !== String(runId)
    ) {
      throw new TypeError("runId conflicts with authority.runId");
    }
    queue.initialize({
      tasks,
      authority:
        runId == null ? authority : { ...authority, runId: String(runId) },
      budget,
      groupId,
      defaultTtlMs,
      maxAttempts,
    });
    return queue;
  }

  static open({ runId = null, ...options } = {}) {
    const queue = new TeamDistributedQueue({
      ...options,
      expectedRunId: options.expectedRunId ?? runId,
    });
    queue.snapshot();
    return queue;
  }

  initialize({
    tasks = [],
    authority = {},
    budget = {},
    groupId = null,
    defaultTtlMs,
    maxAttempts,
  } = {}) {
    if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array");
    const normalizedAuthority = cloneJson(authority, "authority");
    const limits = normalizeLimits(budget);
    prepareDirectory(this.filePath);
    return this._underLock(() => {
      const existing = secureRead(
        this._fileSystem,
        this.filePath,
        this._maxStateBytes,
        {
          allowMissing: true,
          secureFileParent: this._secureFileParent,
        },
      );
      if (!existing.missing) {
        throw queueError(
          "TEAM_QUEUE_ALREADY_EXISTS",
          `Distributed queue state already exists: ${this.filePath}`,
          this.filePath,
        );
      }
      const now = validTimestamp(this._now(), "queue clock");
      const queueId = this._nextId("queue");
      const registry = new TaskLeaseRegistry({
        groupId,
        now: this._now,
        defaultTtlMs,
        maxAttempts,
        leaseEpoch: `${queueId}:0:${this._nextId("lease-epoch")}`,
      });
      if (tasks.length > 0) {
        this._validateTaskDefinitions(tasks);
        const added = registry.addTasks(cloneJson(tasks, "tasks"));
        if (!added.ok) {
          throw queueError(
            "TEAM_QUEUE_INVALID_GRAPH",
            `Could not initialize distributed queue graph: ${added.reason}`,
            this.filePath,
          );
        }
      }
      const snapshot = registry.snapshot();
      const state = {
        schemaVersion: TEAM_DISTRIBUTED_QUEUE_SCHEMA_VERSION,
        queueId,
        revision: 0,
        nextFence: 1,
        nextFinalizationFence: 1,
        createdAt: now,
        updatedAt: now,
        authority: normalizedAuthority,
        graph: graphFromRegistrySnapshot(snapshot),
        graphDigest: "",
        authorityDigest: "",
        registry: snapshot,
        budget: emptyBudget(limits),
        interruptions: [],
        finalization: emptyFinalization(),
        integrityDigest: "",
      };
      refreshDigests(state);
      try {
        validateStateShape(state);
        validateRegistry(registry, state);
      } catch (cause) {
        throw queueError(
          "TEAM_QUEUE_INVALID_GRAPH",
          `Could not initialize distributed queue: ${cause.message}`,
          this.filePath,
          cause,
        );
      }
      atomicWrite(
        this._fileSystem,
        this.filePath,
        state,
        this._maxStateBytes,
        null,
        { secureFileParent: this._secureFileParent },
      );
      return {
        ok: true,
        queueId: state.queueId,
        graphDigest: state.graphDigest,
        authorityDigest: state.authorityDigest,
      };
    });
  }

  asRegistry() {
    return this;
  }

  get defaultTtlMs() {
    return this._inspect(({ registry }) => registry.defaultTtlMs);
  }

  get maxAttempts() {
    return this._inspect(({ registry }) => registry.maxAttempts);
  }

  getTask(key) {
    return this._inspect(({ registry }) => registry.getTask(key));
  }

  list() {
    return this._inspect(({ registry }) => registry.list());
  }

  claimable(options = {}) {
    return this._inspect(({ registry, now }) =>
      registry.claimable({ now: options.now ?? now }),
    );
  }

  claimableCount(options = {}) {
    return this._inspect(({ registry, now }) =>
      registry.claimableCount({ now: options.now ?? now }),
    );
  }

  nextClaimable(options = {}) {
    return this._inspect(({ registry, now }) =>
      registry.nextClaimable({
        now: options.now ?? now,
        excludeKeys: options.excludeKeys,
      }),
    );
  }

  addTask(definition) {
    return this._mutate(({ registry, state, markChanged }) => {
      this._validateTaskDefinitions([definition], registry.list());
      const result = registry.addTask(cloneJson(definition, "task"));
      if (result.ok) {
        state.graph = graphFromRegistrySnapshot(registry.snapshot());
        markChanged();
      }
      return result;
    });
  }

  addTasks(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      return { ok: false, reason: "tasks required" };
    }
    return this._mutate(({ registry, state, markChanged }) => {
      this._validateTaskDefinitions(definitions, registry.list());
      const result = registry.addTasks(cloneJson(definitions, "tasks"));
      if (result.ok) {
        state.graph = graphFromRegistrySnapshot(registry.snapshot());
        markChanged();
      }
      return result;
    });
  }

  /**
   * Atomically choose and acquire one ready task. Prefer this over a separate
   * nextClaimable()+acquire pair when a worker does not already have a key.
   */
  claim({ excludeKeys = null, ...options } = {}) {
    return materializeInterruptionError(
      this._mutate((context) => {
        const key = context.registry.nextClaimable({
          now: options.now ?? context.now,
          excludeKeys,
        });
        if (!key) return { ok: false, reason: "no_claimable_task" };
        const result = this._acquireInTransaction(context, key, options);
        return result.ok ? { ...result, key } : result;
      }),
    );
  }

  acquire(key, options = {}) {
    return materializeInterruptionError(
      this._mutate((context) =>
        this._acquireInTransaction(context, key, options),
      ),
    );
  }

  offerHandoff(key, options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const result = registry.offerHandoff(key, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) markChanged();
      return result;
    });
  }

  findHandoff(handoffId, options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const expired = registry.expireHandoffs({ now: options.now ?? now });
      if (expired.expired?.length > 0) markChanged();
      return registry.findHandoff(handoffId, { now: options.now ?? now });
    });
  }

  acceptHandoff(handoffId, options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const result = registry.acceptHandoff(handoffId, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) markChanged();
      return result;
    });
  }

  rejectHandoff(handoffId, options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const result = registry.rejectHandoff(handoffId, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) markChanged();
      return result;
    });
  }

  commitHandoff(handoffId, options = {}) {
    return this._mutate(({ registry, state, now, markChanged }) => {
      const result = registry.commitHandoff(handoffId, {
        ...options,
        now: options.now ?? now,
      });
      if (!result.ok || result.idempotent) return result;
      const taskId = registry._byKey.get(result.key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      if (!task?.metadata?.lease) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not attach durable handoff lease for task "${result.key}"`,
          this.filePath,
        );
      }
      const fencingToken = state.nextFence;
      const lease = {
        ...task.metadata.lease,
        ownerPid: this._processId,
        fencingToken,
      };
      const custodyHandoffs = (task.metadata.custodyHandoffs || []).map(
        (handoff) =>
          handoff.id === handoffId && handoff.status === "committed"
            ? {
                ...handoff,
                targetLease: cloneJson(lease, "durable handoff lease"),
                targetLeaseRefreshedAt: options.now ?? now,
              }
            : handoff,
      );
      if (
        !registry._write(task, {
          metadata: {
            ...task.metadata,
            lease,
            custodyHandoffs,
          },
        })
      ) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not persist durable handoff lease for task "${result.key}"`,
          this.filePath,
        );
      }
      const reservation = state.budget.reservations.find(
        (item) => item.leaseId === options.leaseId,
      );
      if (!reservation || reservation.taskKey !== result.key) {
        throw queueError(
          "TEAM_QUEUE_BUDGET_RESERVATION_MISSING",
          `Handoff source lease has no budget reservation for task "${result.key}"`,
          this.filePath,
        );
      }
      reservation.leaseId = lease.leaseId;
      state.nextFence += 1;
      markChanged();
      return {
        ...result,
        lease,
        handoff: {
          ...result.handoff,
          targetLease: cloneJson(lease, "durable handoff lease"),
        },
      };
    });
  }

  revokeHandoff(handoffId, options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const result = registry.revokeHandoff(handoffId, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) markChanged();
      return result;
    });
  }

  expireHandoffs(options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const expired = registry.expireHandoffs({ now: options.now ?? now });
      if (expired.expired?.length > 0) markChanged();
      return expired;
    });
  }

  applyCanonicalTaskProjection(key, options = {}) {
    return this._mutate(({ registry, state, now, markChanged }) => {
      const result = registry.applyCanonicalTaskProjection(key, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) {
        state.graph = graphFromRegistrySnapshot(registry.snapshot());
        markChanged();
      }
      return result;
    });
  }

  applyCanonicalHandoffProjection(key, options = {}) {
    return this._mutate(({ registry, state, now, markChanged }) => {
      const result = registry.applyCanonicalHandoffProjection(key, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) {
        state.graph = graphFromRegistrySnapshot(registry.snapshot());
        markChanged();
      }
      return result;
    });
  }

  pendingCommittedHandoffs() {
    return this._inspect(({ registry }) => registry.pendingCommittedHandoffs());
  }

  refreshCommittedHandoffLease(key, options = {}) {
    return this._mutate(({ registry, state, now, markChanged }) => {
      const previousLeaseId = registry.getTask(key)?.lease?.leaseId || null;
      const result = registry.refreshCommittedHandoffLease(key, {
        ...options,
        now: options.now ?? now,
      });
      if (!result.ok || result.idempotent) return result;
      const taskId = registry._byKey.get(key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      if (!task?.metadata?.lease) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not refresh durable handoff lease for task "${key}"`,
          this.filePath,
        );
      }
      const lease = {
        ...task.metadata.lease,
        ownerPid: this._processId,
        fencingToken: state.nextFence,
      };
      const custodyHandoffs = (task.metadata.custodyHandoffs || []).map(
        (handoff) =>
          handoff.id === options.handoffId && handoff.status === "committed"
            ? {
                ...handoff,
                targetLease: cloneJson(lease, "durable handoff lease"),
                targetLeaseRefreshedAt: options.now ?? now,
              }
            : handoff,
      );
      if (
        !registry._write(task, {
          metadata: {
            ...task.metadata,
            lease,
            custodyHandoffs,
          },
        })
      ) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not persist refreshed handoff lease for task "${key}"`,
          this.filePath,
        );
      }
      const reservation = state.budget.reservations.find(
        (item) => item.leaseId === previousLeaseId,
      );
      if (!reservation || reservation.taskKey !== key) {
        throw queueError(
          "TEAM_QUEUE_BUDGET_RESERVATION_MISSING",
          `Handoff lease has no budget reservation for task "${key}"`,
          this.filePath,
        );
      }
      reservation.leaseId = lease.leaseId;
      state.nextFence += 1;
      markChanged();
      return {
        ...result,
        lease,
        handoff: {
          ...result.handoff,
          targetLease: cloneJson(lease, "durable handoff lease"),
        },
      };
    });
  }

  markHandoffStarted(key, options = {}) {
    return this._mutate(({ registry, now, markChanged }) => {
      const result = registry.markHandoffStarted(key, {
        ...options,
        now: options.now ?? now,
      });
      if (result.ok && !result.idempotent) markChanged();
      return result;
    });
  }

  /**
   * Durably fence one exact in-flight attempt for human takeover.
   *
   * requestId is queue-global. Replaying the byte-equivalent semantic request
   * returns its original evidence even after the task has settled; reusing the
   * id for any different task, attempt, actor, or reason fails closed.
   */
  requestInterrupt(key, options = {}) {
    return this._mutate(({ registry, state, now, markChanged }) => {
      let payload;
      try {
        payload = interruptRequestPayload(state, key, options);
      } catch (error) {
        return interruptionRequestFailure(error);
      }
      const requestDigest = interruptionRequestDigest(payload);
      const prior = state.interruptions.find(
        (record) => record.requestId === payload.requestId,
      );
      if (prior) {
        if (prior.requestDigest !== requestDigest) {
          return {
            ok: false,
            reason: "interrupt_request_id_conflict",
            requestId: payload.requestId,
          };
        }
        return {
          ok: true,
          idempotent: true,
          requestId: prior.requestId,
          requestDigest: prior.requestDigest,
          evidenceDigest: prior.evidenceDigest,
          interruption: prior,
        };
      }

      const taskId = registry._byKey.get(payload.key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      if (!task) return { ok: false, reason: "not_found" };
      const lease = task.metadata?.lease || null;
      if (
        task.status !== "in_progress" ||
        !lease ||
        lease.expiresAt <= now ||
        lease.holder !== payload.holder ||
        lease.leaseId !== payload.leaseId ||
        lease.fencingToken !== payload.fencingToken
      ) {
        return { ok: false, reason: "stale_attempt" };
      }

      const record = createInterruptionRecord(state, task, lease, payload, now);
      if (
        !registry._write(task, {
          metadata: {
            ...task.metadata,
            interruption: record,
          },
        })
      ) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not persist interruption for task "${payload.key}"`,
          this.filePath,
        );
      }
      state.interruptions.push(record);
      markChanged();
      return {
        ok: true,
        requestId: record.requestId,
        requestDigest: record.requestDigest,
        evidenceDigest: record.evidenceDigest,
        interruption: record,
      };
    });
  }

  renew(key, options = {}) {
    const result = this._mutate(({ registry, now, markChanged }) => {
      const taskId = registry._byKey.get(key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      const lease = task?.metadata?.lease || null;
      const interruption = activeInterruption(task, lease);
      if (
        interruption &&
        options.holder === lease.holder &&
        options.leaseId === lease.leaseId
      ) {
        return {
          ok: false,
          reason: "interrupted",
          retryable: false,
          interruption,
          interruptionErrorRecord: interruption,
        };
      }
      const renewed = registry.renew(key, {
        ...options,
        now: options.now ?? now,
      });
      if (renewed.ok) markChanged();
      return renewed;
    });
    return materializeInterruptionError(result);
  }

  release(key, options = {}) {
    const result = this._mutate(({ registry, state, now, markChanged }) => {
      const taskId = registry._byKey.get(key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      const lease = task?.metadata?.lease || null;
      const interruption = activeInterruption(task, lease);
      if (
        interruption &&
        options.holder === lease.holder &&
        options.leaseId === lease.leaseId
      ) {
        return {
          ok: false,
          reason: "interrupted",
          retryable: false,
          interruption,
          interruptionErrorRecord: interruption,
        };
      }
      const released = registry.release(key, {
        ...options,
        now: options.now ?? now,
      });
      if (released.ok) {
        removeReservation(state, options.leaseId);
        markChanged();
      }
      return released;
    });
    return materializeInterruptionError(result);
  }

  /**
   * Persist a managed worktree checkpoint phase under the task's current
   * lease/fencing authority. This is deliberately separate from completion:
   * a crashed worker leaves its last prepared/running/committed evidence in
   * the queue so recovery cannot silently replay an unknown write.
   */
  recordWorkspaceExecution(key, options = {}) {
    return this._mutate(({ registry, state, now, markChanged }) => {
      const taskId = registry._byKey.get(key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      if (!task) return { ok: false, reason: "not_found" };
      const lease = task.metadata?.lease || null;
      if (
        task.status !== "in_progress" ||
        !lease ||
        lease.expiresAt <= (options.now ?? now) ||
        lease.holder !== options.holder ||
        lease.leaseId !== options.leaseId ||
        lease.fencingToken !== options.fencingToken
      ) {
        return { ok: false, reason: "not_holder_or_expired" };
      }
      let execution;
      try {
        const supplied = cloneJson(options.execution, "workspace execution");
        execution = normalizeWorkspaceExecution(
          {
            ...supplied,
            version: WORKSPACE_EXECUTION_VERSION,
            queueId: state.queueId,
            runId: String(state.authority?.runId || ""),
            taskKey: key,
            lease: {
              holder: lease.holder,
              leaseId: lease.leaseId,
              ownerPid: lease.ownerPid,
              fencingToken: lease.fencingToken,
            },
          },
          {
            state,
            key,
            activeLease: lease,
            existing: task.metadata?.workspaceExecution || null,
          },
        );
      } catch (error) {
        return {
          ok: false,
          reason: "invalid_workspace_execution",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (
        !registry._write(task, {
          metadata: {
            ...task.metadata,
            workspaceExecution: execution,
          },
        })
      ) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not persist workspace execution for task "${key}"`,
          this.filePath,
        );
      }
      markChanged();
      return { ok: true, execution };
    });
  }

  complete(key, options = {}) {
    return this._settle("complete", key, options);
  }

  fail(key, options = {}) {
    return this._settle("fail", key, options);
  }

  reclaimExpired(options = {}) {
    return this._mutate(
      ({ reclaimed, markChanged }) => {
        if (reclaimed.length > 0) markChanged();
        return [...reclaimed];
      },
      { now: options.now },
    );
  }

  reclaimUnavailable(options = {}) {
    return this.reclaimExpired(options);
  }

  unmetDependencies(key) {
    return this._inspect(({ registry }) => registry.unmetDependencies(key));
  }

  pendingAdjudications() {
    return this._inspect(({ registry }) => registry.pendingAdjudications());
  }

  /**
   * Reconcile a crashed managed checkpoint without deciding the task outcome.
   *
   * Only a legal same-transaction transition to a proven rollback or committed
   * checkpoint is accepted. The task intentionally remains fail-closed for a
   * later human retry/accept/cancel decision.
   */
  reconcileWorkspaceExecution(key, options = {}) {
    let request;
    try {
      request = normalizeWorkspaceRecoveryRequest(key, options);
    } catch (error) {
      if (error instanceof AdjudicationRequestError) {
        return { ok: false, reason: error.reason, error: error.message };
      }
      throw error;
    }

    return this._mutate(({ registry, state, now, markChanged }) => {
      const task = registry.getTask(request.key);
      if (!task) return { ok: false, reason: "not_found" };

      const priorUse = findWorkspaceRecovery(registry, request.recoveryId);
      if (priorUse) {
        if (
          priorUse.key === request.key &&
          priorUse.recovery.requestDigest === request.requestDigest
        ) {
          return {
            ok: true,
            idempotent: true,
            recoveryId: request.recoveryId,
            outcome: priorUse.recovery.outcome,
            requestDigest: request.requestDigest,
          };
        }
        return {
          ok: false,
          reason: "recovery_id_conflict",
          recoveryId: request.recoveryId,
        };
      }
      if (task.metadata?.workspaceRecovery) {
        return { ok: false, reason: "workspace_recovery_already_recorded" };
      }

      const binding = verifyAbandonedWorkspaceBinding(
        task,
        state,
        request.key,
        request.evidenceDigest,
      );
      if (!binding.ok) return binding;
      const current = binding.execution;

      let recovered;
      try {
        const supplied = cloneJson(
          request.execution,
          "recovered workspace execution",
        );
        recovered = normalizeWorkspaceExecution(
          {
            ...supplied,
            version: WORKSPACE_EXECUTION_VERSION,
            queueId: state.queueId,
            runId: String(state.authority?.runId || ""),
            taskKey: request.key,
            lease: current.lease,
          },
          {
            state,
            key: request.key,
            existing: current,
          },
        );
      } catch (error) {
        return {
          ok: false,
          reason: "invalid_workspace_recovery",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (!sameWorkspaceExecutionBinding(current, recovered)) {
        return {
          ok: false,
          reason: "workspace_execution_binding_changed",
        };
      }
      const rolledBack = isRetryableWorkspaceSettlement(recovered);
      const committed = ["committed", "completed"].includes(recovered.phase);
      if (!rolledBack && !committed) {
        return {
          ok: false,
          reason: "workspace_recovery_not_terminal",
        };
      }
      if (
        recovered.checkpoint.checkpointDigest !== request.checkpointDigest ||
        recovered.checkpoint.writeManifestDigest !==
          request.writeManifestDigest ||
        recovered.checkpoint.evidenceDigest !== request.checkpointEvidenceDigest
      ) {
        return {
          ok: false,
          reason: "workspace_recovery_evidence_mismatch",
        };
      }
      if (canonicalJson(current) === canonicalJson(recovered)) {
        return { ok: false, reason: "workspace_recovery_no_progress" };
      }

      const recoveryRecord = {
        version: 1,
        kind: "distributed-workspace-recovery",
        recoveryId: request.recoveryId,
        actor: request.actor,
        reason: request.reason,
        abandonmentEvidenceDigest: request.evidenceDigest,
        fromExecutionDigest: `sha256:${digest(current)}`,
        toExecutionDigest: `sha256:${digest(recovered)}`,
        checkpointDigest: request.checkpointDigest,
        writeManifestDigest: request.writeManifestDigest,
        checkpointEvidenceDigest: request.checkpointEvidenceDigest,
        outcome: rolledBack ? "rolled-back" : "committed",
        requestDigest: request.requestDigest,
        recoveredAt: now,
      };
      if (
        !registry._write(task, {
          metadata: {
            ...task.metadata,
            workspaceExecution: recovered,
            workspaceRecovery: recoveryRecord,
          },
        })
      ) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not persist workspace recovery for "${request.key}"`,
          this.filePath,
        );
      }
      markChanged();
      return {
        ok: true,
        recoveryId: request.recoveryId,
        outcome: recoveryRecord.outcome,
        requestDigest: request.requestDigest,
        execution: recovered,
      };
    });
  }

  /**
   * Return the only task result that an `accept` decision may persist.
   *
   * The template is derived from the exact abandoned-lease digest plus a
   * validated/committed worktree execution. Requiring callers to return this
   * complete template prevents an operator or competing process from attaching
   * an unrelated external result to an otherwise valid decision.
   */
  adjudicationAcceptance(key, { evidenceDigest } = {}) {
    if (
      typeof evidenceDigest !== "string" ||
      !EVIDENCE_DIGEST_PATTERN.test(evidenceDigest)
    ) {
      return {
        ok: false,
        reason:
          evidenceDigest == null
            ? "evidence_digest_required"
            : "invalid_evidence_digest",
      };
    }
    return this._inspect(({ registry, state }) => {
      const task = registry.getTask(key);
      if (!task) return { ok: false, reason: "not_found" };
      const acceptance = verifyAbandonedWorkspaceEvidence(
        task,
        state,
        key,
        evidenceDigest,
      );
      if (!acceptance.ok) return acceptance;
      return {
        ok: true,
        evidenceDigest,
        result: acceptance.result,
        proof: acceptance.proof,
      };
    });
  }

  /**
   * Resolve one durable distributed-queue adjudication under the same strict
   * lock as lease, budget, and checkpoint mutations.
   *
   * Idempotency is compare-by-full-request, not merely decision id/action. A
   * decision id is queue-global; an exact replay returns without marking the
   * state changed, while any conflicting reuse fails without a revision bump.
   */
  resolveAdjudication(key, options = {}) {
    let request;
    try {
      request = normalizeAdjudicationRequest(key, options);
    } catch (error) {
      if (error instanceof AdjudicationRequestError) {
        return { ok: false, reason: error.reason, error: error.message };
      }
      throw error;
    }

    return this._mutate(({ registry, state, now, markChanged }) => {
      const task = registry.getTask(request.key);
      if (!task) return { ok: false, reason: "not_found" };

      const priorUse = findAdjudicationDecision(registry, request.decisionId);
      if (priorUse) {
        if (
          priorUse.key === request.key &&
          priorUse.decision.queueRequestDigest === request.requestDigest
        ) {
          return {
            ok: true,
            idempotent: true,
            decision: priorUse.decision.action,
            decisionId: request.decisionId,
            status: priorUse.task.status,
            requestDigest: request.requestDigest,
          };
        }
        return {
          ok: false,
          reason: "decision_id_conflict",
          decisionId: request.decisionId,
        };
      }

      const pending = task.metadata?.adjudication || null;
      if (pending?.required !== true) {
        return { ok: false, reason: "adjudication_not_required" };
      }
      if (task.status !== "cancelled") {
        return { ok: false, reason: "invalid_task_state" };
      }
      if (!pending.evidenceDigest) {
        return { ok: false, reason: "adjudication_evidence_missing" };
      }
      if (pending.evidenceDigest !== request.evidenceDigest) {
        return { ok: false, reason: "evidence_mismatch" };
      }

      let acceptance = null;
      if (request.decision === "accept") {
        acceptance = verifyAbandonedWorkspaceEvidence(
          task,
          state,
          request.key,
          request.evidenceDigest,
        );
        if (!acceptance.ok) return acceptance;
        if (
          canonicalJson(request.result) !== canonicalJson(acceptance.result)
        ) {
          return {
            ok: false,
            reason: "result_evidence_mismatch",
          };
        }
      } else if (
        request.decision === "retry" &&
        task.metadata?.workspaceExecution &&
        !isRetryableWorkspaceSettlement(task.metadata.workspaceExecution)
      ) {
        return {
          ok: false,
          reason: "workspace_checkpoint_recovery_required",
        };
      }

      const applied = registry.resolveAdjudication(request.key, {
        decision: request.decision,
        decisionId: request.decisionId,
        actor: request.actor,
        reason: request.reason,
        evidenceDigest: request.evidenceDigest,
        ...(request.decision === "accept" ? { result: request.result } : {}),
        now,
      });
      if (!applied.ok) return applied;

      const resolved = registry.getTask(request.key);
      if (!resolved) {
        throw queueError(
          "TEAM_QUEUE_INVALID_MUTATION",
          `Adjudicated task "${request.key}" disappeared`,
          this.filePath,
        );
      }
      const metadata = {
        ...resolved.metadata,
        adjudication: {
          ...resolved.metadata.adjudication,
          decision: {
            ...resolved.metadata.adjudication.decision,
            queueRequestDigest: request.requestDigest,
            resultDigest:
              request.decision === "accept"
                ? `sha256:${digest(request.result)}`
                : null,
            workspaceEvidence:
              request.decision === "accept" ? acceptance.proof : null,
          },
        },
      };
      if (request.decision !== "accept") delete metadata.result;
      if (!registry._write(resolved, { metadata })) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Could not persist adjudication request binding for "${request.key}"`,
          this.filePath,
        );
      }
      markChanged();
      return {
        ok: true,
        decision: request.decision,
        decisionId: request.decisionId,
        status: applied.status,
        requestDigest: request.requestDigest,
        evidenceDigest: request.evidenceDigest,
      };
    });
  }

  stats(options = {}) {
    return this._inspect(({ registry, state, now }) => ({
      ...registry.stats({ now: options.now ?? now }),
      queueId: state.queueId,
      revision: state.revision,
      graphDigest: state.graphDigest,
      authorityDigest: state.authorityDigest,
      budget: budgetStatus(state, options.now ?? now),
    }));
  }

  /**
   * Return one lock-consistent operator view. In particular, none of the task,
   * adjudication, finalization, or budget fields can come from a different
   * queue revision.
   */
  statusView(options = {}) {
    return this._inspect(
      ({ registry, state, now, reclaimed, adjudicationRequired }) => {
        const viewNow = options.now ?? now;
        // A read transaction may itself durably recover an unavailable lease.
        // Report the revision that _transact will persist for that recovery.
        const revision =
          state.revision +
          (reclaimed.length > 0 || adjudicationRequired.length > 0 ? 1 : 0);
        const stats = {
          ...registry.stats({ now: viewNow }),
          queueId: state.queueId,
          revision,
          graphDigest: state.graphDigest,
          authorityDigest: state.authorityDigest,
          budget: budgetStatus(state, viewNow),
        };
        return {
          queueId: state.queueId,
          revision,
          graphDigest: state.graphDigest,
          authorityDigest: state.authorityDigest,
          authority: cloneJson(state.authority, "queue authority"),
          stats,
          finalization: cloneJson(state.finalization, "finalization"),
          pendingAdjudications: registry.pendingAdjudications(),
          interruptions: cloneJson(
            state.interruptions,
            "distributed interruptions",
          ),
          tasks: registry.list(),
        };
      },
    );
  }

  budgetStatus(options = {}) {
    return this._inspect(({ state, now }) =>
      budgetStatus(state, options.now ?? now),
    );
  }

  allDone() {
    return this._inspect(({ registry }) => registry.allDone());
  }

  snapshot() {
    return this._inspect(({ state }) => cloneJson(state));
  }

  getFinalization() {
    return this._inspect(({ state }) =>
      cloneJson(state.finalization, "finalization"),
    );
  }

  beginFinalization(options = {}) {
    let request;
    try {
      request = {
        operationId: finalizationText(
          options.operationId,
          "finalization_operation_id",
          4096,
        ),
        owner: finalizationText(options.owner, "finalization_owner", 4096),
        mode: options.mode,
        ttlMs: finalizationTtl(options.ttlMs),
        git: options.git,
        coordinator: options.coordinator,
      };
      if (!FINALIZATION_MODES.has(request.mode)) {
        throw new FinalizationRequestError(
          "invalid_finalization_mode",
          "finalization mode must be preview or merge",
        );
      }
    } catch (error) {
      return finalizationRequestFailure(error);
    }

    return this._mutate(({ registry, state, now, markChanged }) => {
      let bindings;
      let git;
      let coordinator;
      try {
        bindings = finalizationTaskBindings(registry);
        git = normalizeFinalizationGit(request.git, state);
        coordinator = normalizeFinalizationCoordinator(
          request.coordinator,
          state,
          git,
        );
      } catch (error) {
        return finalizationRequestFailure(error);
      }
      if (canonicalJson(bindings) !== canonicalJson(git.branches)) {
        return {
          ok: false,
          reason: "finalization_git_binding_mismatch",
        };
      }
      const inputDigest = finalizationInputDigest(state, registry);
      const current = state.finalization;
      if (current.phase === "idle") {
        const lease = createFinalizationLease(
          this,
          state,
          request.owner,
          request.ttlMs,
          now,
        );
        const initial = {
          version: FINALIZATION_VERSION,
          revision: 1,
          phase: "previewing",
          operationId: request.operationId,
          mode: request.mode,
          inputDigest,
          lease,
          git,
          coordinator,
          result: emptyFinalizationResult(),
          intent: finalizationIntent("preview", git, coordinator, now),
          cursor: 1,
          startedAt: now,
          updatedAt: now,
          previewedAt: null,
          mergedAt: null,
          cleanupPreparedAt: null,
          completedAt: null,
          blocked: null,
          recovery: null,
          transitions: [
            {
              id: `${request.operationId}:begin`,
              digest: digest({
                operationId: request.operationId,
                mode: request.mode,
                inputDigest,
                git,
                coordinator,
              }),
              from: "idle",
              to: "previewing",
              at: now,
            },
          ],
        };
        try {
          state.finalization = normalizeFinalization(initial, state);
        } catch (error) {
          return finalizationRequestFailure(error);
        }
        markChanged();
        return finalizationResult(state.finalization);
      }

      if (
        current.operationId !== request.operationId ||
        current.inputDigest !== inputDigest
      ) {
        return {
          ok: false,
          reason: "finalization_parameter_or_input_drift",
          phase: current.phase,
          operationId: current.operationId,
        };
      }
      if (
        canonicalJson(current.git) !== canonicalJson(git) ||
        canonicalJson(current.coordinator) !== canonicalJson(coordinator)
      ) {
        return {
          ok: false,
          reason: "finalization_parameter_or_git_drift",
          phase: current.phase,
        };
      }
      if (current.mode !== request.mode) {
        if (
          current.mode !== "preview" ||
          request.mode !== "merge" ||
          current.phase !== "previewed" ||
          current.lease != null
        ) {
          return {
            ok: false,
            reason: "finalization_mode_conflict",
            phase: current.phase,
            mode: current.mode,
          };
        }
        const next = cloneJson(current, "finalization");
        next.mode = "merge";
        next.lease = createFinalizationLease(
          this,
          state,
          request.owner,
          request.ttlMs,
          now,
        );
        next.revision += 1;
        next.cursor += 1;
        next.updatedAt = now;
        appendFinalizationTransition(next, {
          id: `${request.operationId}:promote-merge`,
          transitionDigest: digest({
            operationId: request.operationId,
            fromMode: "preview",
            toMode: "merge",
            inputDigest,
          }),
          from: "previewed",
          to: "previewed",
          at: now,
        });
        state.finalization = normalizeFinalization(next, state);
        markChanged();
        return finalizationResult(state.finalization, { promoted: true });
      }

      if (["completed", "blocked"].includes(current.phase)) {
        return finalizationResult(current, { idempotent: true });
      }
      if (
        current.phase === "previewed" &&
        current.lease == null &&
        request.mode === "preview"
      ) {
        return finalizationResult(current, { idempotent: true });
      }
      if (
        current.lease?.owner === request.owner &&
        current.lease?.ownerPid === this._processId &&
        current.lease.expiresAt > now
      ) {
        return finalizationResult(current, { idempotent: true });
      }
      if (!current.lease) {
        return {
          ok: false,
          reason:
            current.phase === "recovery_required"
              ? "finalization_takeover_required"
              : "finalization_not_resumable",
          phase: current.phase,
          takeoverRequired: current.phase === "recovery_required",
        };
      }
      const availability = finalizationLeaseUnavailable(
        this,
        current.lease,
        now,
      );
      return {
        ok: false,
        reason: availability.unavailable
          ? "finalization_takeover_required"
          : "finalization_busy",
        phase: current.phase,
        takeoverRequired: availability.unavailable,
        expired: availability.expired,
        ownerDead: availability.dead,
        lease: cloneJson(current.lease, "finalization lease"),
      };
    });
  }

  renewFinalization(options = {}) {
    let request;
    try {
      request = {
        operationId: finalizationText(
          options.operationId,
          "finalization_operation_id",
          4096,
        ),
        owner: finalizationText(options.owner, "finalization_owner", 4096),
        leaseId: finalizationText(
          options.leaseId,
          "finalization_lease_id",
          4096,
        ),
        fencingToken: Number(options.fencingToken),
        ttlMs: finalizationTtl(options.ttlMs),
      };
    } catch (error) {
      return finalizationRequestFailure(error);
    }
    return this._mutate(({ state, now, markChanged }) => {
      const current = state.finalization;
      if (current.operationId !== request.operationId) {
        return { ok: false, reason: "finalization_operation_mismatch" };
      }
      const authority = finalizationLeaseMatches(this, current, request);
      if (!authority.ok) return authority;
      const next = cloneJson(current, "finalization");
      next.lease.expiresAt = now + request.ttlMs;
      next.lease.renewals += 1;
      next.updatedAt = now;
      next.revision += 1;
      state.finalization = normalizeFinalization(next, state);
      markChanged();
      return finalizationResult(state.finalization);
    });
  }

  recordFinalizationPhase(options = {}) {
    let request;
    try {
      request = {
        ...options,
        operationId: finalizationText(
          options.operationId,
          "finalization_operation_id",
          4096,
        ),
        owner: finalizationText(options.owner, "finalization_owner", 4096),
        leaseId: finalizationText(
          options.leaseId,
          "finalization_lease_id",
          4096,
        ),
        transitionId: finalizationText(
          options.transitionId,
          "finalization_transition_id",
          4096,
        ),
        expectedRevision: Number(options.expectedRevision),
        fencingToken: Number(options.fencingToken),
      };
      if (
        !FINALIZATION_PHASES.has(request.expectedPhase) ||
        !FINALIZATION_PHASES.has(request.toPhase) ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0
      ) {
        throw new FinalizationRequestError(
          "invalid_finalization_transition",
          "finalization transition phase/revision is invalid",
        );
      }
    } catch (error) {
      return finalizationRequestFailure(error);
    }
    const transitionDigest = digest(finalizationTransitionPayload(request));

    return this._mutate(({ state, now, markChanged }) => {
      const current = state.finalization;
      const prior = findFinalizationTransition(current, request.transitionId);
      if (prior) {
        return prior.digest === transitionDigest
          ? finalizationResult(current, { idempotent: true })
          : {
              ok: false,
              reason: "finalization_transition_id_conflict",
            };
      }
      if (current.operationId !== request.operationId) {
        return { ok: false, reason: "finalization_operation_mismatch" };
      }
      if (
        current.phase !== request.expectedPhase ||
        current.revision !== request.expectedRevision
      ) {
        return {
          ok: false,
          reason: "finalization_cas_mismatch",
          phase: current.phase,
          revision: current.revision,
        };
      }
      const authority = finalizationLeaseMatches(this, current, request);
      if (!authority.ok) return authority;
      const allowed = FINALIZATION_TRANSITIONS.get(current.phase);
      if (!allowed?.has(request.toPhase)) {
        return {
          ok: false,
          reason: "finalization_transition_forbidden",
          phase: current.phase,
          toPhase: request.toPhase,
        };
      }

      try {
        const next = cloneJson(current, "finalization");
        if (request.coordinator != null) {
          next.coordinator = normalizeFinalizationCoordinator(
            request.coordinator,
            state,
            next.git,
          );
        }
        if (request.result != null) {
          next.result = normalizeFinalizationResult({
            ...next.result,
            ...cloneJson(request.result, "finalization result update"),
          });
        }
        if (request.currentBaseOid != null) {
          next.git.currentBaseOid = optionalGitOid(
            request.currentBaseOid,
            "finalization.git.currentBaseOid",
          );
        }
        next.phase = request.toPhase;
        next.blocked = null;
        next.recovery = null;
        if (["previewing", "merging", "cleaning"].includes(request.toPhase)) {
          const expectedKind = {
            previewing: "preview",
            merging: "merge",
            cleaning: "cleanup",
          }[request.toPhase];
          if (request.intentKind !== expectedKind) {
            throw new FinalizationRequestError(
              "finalization_intent_missing",
              `transition to "${request.toPhase}" requires ${expectedKind} intent`,
            );
          }
          next.intent = finalizationIntent(
            expectedKind,
            next.git,
            next.coordinator,
            now,
          );
        } else {
          next.intent = null;
        }
        if (request.toPhase === "blocked") {
          next.blocked = normalizeFinalizationBlock({
            ...(request.block || {}),
            at: request.block?.at ?? now,
          });
        }
        if (request.toPhase === "recovery_required") {
          if (!current.intent) {
            throw new FinalizationRequestError(
              "finalization_recovery_intent_missing",
              "cannot require recovery without a persisted Git/cleanup intent",
            );
          }
          next.recovery = {
            fromPhase:
              current.phase === "recovery_required"
                ? current.recovery.fromPhase
                : current.phase,
            intent: cloneJson(current.intent, "finalization recovery intent"),
            priorLease: cloneJson(current.lease, "finalization prior lease"),
            takenOverAt: now,
            reason: finalizationText(
              request.recoveryReason,
              "finalization_recovery_reason",
              4096,
            ),
          };
          next.intent = cloneJson(current.intent, "finalization intent");
        }
        if (
          request.releaseLease === true ||
          ["blocked", "recovery_required"].includes(request.toPhase)
        ) {
          next.lease = null;
        }
        if (
          request.releaseLease === true &&
          !["previewed", "blocked", "recovery_required"].includes(
            request.toPhase,
          )
        ) {
          throw new FinalizationRequestError(
            "finalization_lease_release_forbidden",
            `cannot release finalization lease in phase "${request.toPhase}"`,
          );
        }
        next.revision += 1;
        next.cursor += 1;
        next.updatedAt = now;
        if (request.toPhase === "previewed") next.previewedAt = now;
        if (request.toPhase === "merged") next.mergedAt = now;
        if (request.toPhase === "cleanup_prepared") {
          next.cleanupPreparedAt = now;
        }
        appendFinalizationTransition(next, {
          id: request.transitionId,
          transitionDigest,
          from: current.phase,
          to: request.toPhase,
          at: now,
        });
        assertFinalizationEvidence(request.toPhase, next);
        state.finalization = normalizeFinalization(next, state);
        markChanged();
        return finalizationResult(state.finalization);
      } catch (error) {
        return finalizationRequestFailure(error);
      }
    });
  }

  takeoverFinalization(options = {}) {
    let request;
    try {
      request = {
        operationId: finalizationText(
          options.operationId,
          "finalization_operation_id",
          4096,
        ),
        owner: finalizationText(options.owner, "finalization_owner", 4096),
        reason: finalizationText(
          options.reason || "prior finalizer became unavailable",
          "finalization_takeover_reason",
          4096,
        ),
        ttlMs: finalizationTtl(options.ttlMs),
      };
    } catch (error) {
      return finalizationRequestFailure(error);
    }
    return this._mutate(({ registry, state, now, markChanged }) => {
      const current = state.finalization;
      if (
        current.phase === "idle" ||
        current.operationId !== request.operationId
      ) {
        return { ok: false, reason: "finalization_operation_mismatch" };
      }
      if (current.inputDigest !== finalizationInputDigest(state, registry)) {
        return { ok: false, reason: "finalization_input_drift" };
      }
      if (["completed", "blocked"].includes(current.phase)) {
        return finalizationResult(current, { idempotent: true });
      }
      if (
        current.lease?.owner === request.owner &&
        current.lease?.ownerPid === this._processId &&
        current.lease.expiresAt > now
      ) {
        return finalizationResult(current, { idempotent: true });
      }

      let unavailable = current.lease == null;
      let availability = null;
      if (current.lease) {
        availability = finalizationLeaseUnavailable(this, current.lease, now);
        unavailable = availability.unavailable;
      }
      if (!unavailable) {
        return {
          ok: false,
          reason: "finalization_busy",
          expired: availability?.expired === true,
          ownerDead: false,
          lease: cloneJson(current.lease, "finalization lease"),
        };
      }
      if (current.lease == null && current.phase !== "recovery_required") {
        return {
          ok: false,
          reason: "finalization_takeover_not_required",
          phase: current.phase,
        };
      }

      const next = cloneJson(current, "finalization");
      const priorLease = current.lease || current.recovery?.priorLease || null;
      if (current.intent) {
        if (!priorLease) {
          return {
            ok: false,
            reason: "finalization_recovery_lease_missing",
          };
        }
        next.phase = "recovery_required";
        next.recovery = {
          fromPhase:
            current.phase === "recovery_required"
              ? current.recovery.fromPhase
              : current.phase,
          intent:
            current.phase === "recovery_required"
              ? cloneJson(current.recovery.intent)
              : cloneJson(current.intent),
          priorLease: cloneJson(priorLease),
          takenOverAt: now,
          reason: request.reason,
        };
        next.intent = cloneJson(next.recovery.intent);
      }
      next.lease = createFinalizationLease(
        this,
        state,
        request.owner,
        request.ttlMs,
        now,
      );
      next.revision += 1;
      next.cursor += 1;
      next.updatedAt = now;
      appendFinalizationTransition(next, {
        id: `${request.operationId}:takeover:${next.lease.fencingToken}`,
        transitionDigest: digest({
          operationId: request.operationId,
          priorLease,
          fencingToken: next.lease.fencingToken,
          reason: request.reason,
        }),
        from: current.phase,
        to: next.phase,
        at: now,
      });
      state.finalization = normalizeFinalization(next, state);
      markChanged();
      return finalizationResult(state.finalization, { takeover: true });
    });
  }

  completeFinalization(options = {}) {
    let request;
    try {
      request = {
        ...options,
        operationId: finalizationText(
          options.operationId,
          "finalization_operation_id",
          4096,
        ),
        owner: finalizationText(options.owner, "finalization_owner", 4096),
        leaseId: finalizationText(
          options.leaseId,
          "finalization_lease_id",
          4096,
        ),
        transitionId: finalizationText(
          options.transitionId,
          "finalization_transition_id",
          4096,
        ),
        expectedRevision: Number(options.expectedRevision),
        fencingToken: Number(options.fencingToken),
      };
      if (
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0
      ) {
        throw new FinalizationRequestError(
          "invalid_finalization_revision",
          "finalization expectedRevision must be a non-negative integer",
        );
      }
    } catch (error) {
      return finalizationRequestFailure(error);
    }
    const transitionDigest = digest({
      operationId: request.operationId,
      expectedRevision: request.expectedRevision,
      coordinator: request.coordinator,
      cleanup: request.cleanup,
      currentBaseOid: request.currentBaseOid,
    });

    return this._mutate(({ state, now, markChanged }) => {
      const current = state.finalization;
      const prior = findFinalizationTransition(current, request.transitionId);
      if (prior) {
        return prior.digest === transitionDigest
          ? finalizationResult(current, { idempotent: true })
          : {
              ok: false,
              reason: "finalization_transition_id_conflict",
            };
      }
      if (current.operationId !== request.operationId) {
        return { ok: false, reason: "finalization_operation_mismatch" };
      }
      const resumableCleaning =
        current.phase === "cleaning" ||
        (current.phase === "recovery_required" &&
          current.recovery?.fromPhase === "cleaning");
      if (!resumableCleaning || current.revision !== request.expectedRevision) {
        return {
          ok: false,
          reason: "finalization_cas_mismatch",
          phase: current.phase,
          revision: current.revision,
        };
      }
      const authority = finalizationLeaseMatches(this, current, request);
      if (!authority.ok) return authority;
      try {
        const next = cloneJson(current, "finalization");
        next.coordinator = normalizeFinalizationCoordinator(
          request.coordinator,
          state,
          next.git,
        );
        next.result = normalizeFinalizationResult({
          ...next.result,
          cleanup: cloneJson(request.cleanup, "finalization cleanup result"),
        });
        next.git.currentBaseOid = optionalGitOid(
          request.currentBaseOid,
          "finalization.git.currentBaseOid",
        );
        next.phase = "completed";
        next.lease = null;
        next.intent = null;
        next.recovery = null;
        next.blocked = null;
        next.revision += 1;
        next.cursor += 1;
        next.updatedAt = now;
        next.completedAt = now;
        appendFinalizationTransition(next, {
          id: request.transitionId,
          transitionDigest,
          from: current.phase,
          to: "completed",
          at: now,
        });
        assertFinalizationEvidence("completed", next);
        state.finalization = normalizeFinalization(next, state);
        markChanged();
        return finalizationResult(state.finalization);
      } catch (error) {
        return finalizationRequestFailure(error);
      }
    });
  }

  _settle(operation, key, options) {
    const result = this._mutate(({ registry, state, now, markChanged }) => {
      const leaseId = options.leaseId;
      const usage = options.usage ?? options.result?.usage ?? null;
      const usageRecords =
        options.usageRecords ?? options.result?.usageRecords ?? null;
      const costUsd =
        options.costUsd ??
        options.result?.costUsd ??
        options.result?.spentUsd ??
        null;
      const settlement = settleBudget(state, leaseId, {
        usage,
        usageRecords,
        costUsd,
      });
      if (!settlement.ok) return settlement;
      const taskId = registry._byKey.get(key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      const lease = task?.metadata?.lease || null;
      const interruption = activeInterruption(task, lease);
      const interrupted =
        interruption &&
        options.holder === lease.holder &&
        options.leaseId === lease.leaseId;
      const registryOptions = {
        ...options,
        now: options.now ?? now,
      };
      delete registryOptions.usage;
      delete registryOptions.usageRecords;
      delete registryOptions.costUsd;
      let settledOperation = operation;
      if (interrupted) {
        settledOperation = "fail";
        registryOptions.error = interruption.reason;
        registryOptions.retryable = false;
        registryOptions.adjudication = interruptionAdjudication(interruption);
        delete registryOptions.result;
      } else if (operation === "complete") {
        registryOptions.result =
          options.result == null
            ? null
            : cloneJson(options.result, "task completion result");
      }
      if (
        settledOperation === "fail" &&
        registryOptions.retryable === false &&
        isPlainObject(registryOptions.adjudication) &&
        !registryOptions.adjudication.evidenceDigest &&
        task &&
        lease
      ) {
        const evidence = abandonedLeaseEvidence(
          state,
          key,
          lease,
          now,
          "settled-adjudication-required",
          task.metadata?.workspaceExecution || null,
        );
        const attached = registry._write(task, {
          metadata: {
            ...task.metadata,
            abandonedLeaseEvidence: evidence,
          },
        });
        if (!attached) {
          throw queueError(
            "TEAM_QUEUE_CONCURRENT_MUTATION",
            `Could not preserve settled attempt evidence for "${key}"`,
            this.filePath,
          );
        }
        registryOptions.adjudication = {
          ...registryOptions.adjudication,
          evidenceDigest: evidence.evidenceDigest,
        };
      }
      const registryResult = registry[settledOperation](key, registryOptions);
      if (!registryResult.ok) return registryResult;
      removeReservation(state, leaseId);
      state.budget.totals.tasksSettled += 1;
      state.budget.totals.tokens += settlement.chargedTokens;
      state.budget.totals.spentUsd += settlement.chargedUsd;
      markChanged();
      if (interrupted && operation === "complete") {
        return {
          ok: false,
          settled: true,
          retry: false,
          attempts: registryResult.attempts,
          reason: "interrupted",
          retryable: false,
          interruption,
          interruptionErrorRecord: interruption,
          chargedTokens: settlement.chargedTokens,
          chargedUsd: settlement.chargedUsd,
        };
      }
      return {
        ...registryResult,
        ...(interrupted ? { interrupted: true, interruption } : {}),
        chargedTokens: settlement.chargedTokens,
        chargedUsd: settlement.chargedUsd,
      };
    });
    return materializeInterruptionError(result);
  }

  _acquireInTransaction({ registry, state, now, markChanged }, key, options) {
    const operationNow = options.now ?? now;
    const beforeTask = registry.getTask(key);
    const before = beforeTask?.lease || null;
    const interruption = activeInterruption(beforeTask, before);
    if (interruption) {
      return {
        ok: false,
        reason: "interrupted",
        retryable: false,
        interruption,
        interruptionErrorRecord: interruption,
      };
    }
    const priorWorkspaceExecution =
      beforeTask?.metadata?.workspaceExecution || null;
    const archivePriorExecution = !!(!before && priorWorkspaceExecution);
    if (
      archivePriorExecution &&
      !isRetryableWorkspaceSettlement(priorWorkspaceExecution)
    ) {
      return {
        ok: false,
        reason: "workspace_checkpoint_recovery_required",
      };
    }
    const priorHistory = normalizeWorkspaceExecutionHistory(
      beforeTask?.metadata?.workspaceExecutionHistory,
      { state, key },
    );
    const taskReservationSource = beforeTask?.metadata?.budgetReservation;
    const taskReservation = isPlainObject(taskReservationSource)
      ? taskReservationSource
      : {};
    const effectiveOptions = {
      ...taskReservation,
      ...options,
      reservation: {
        ...(isPlainObject(taskReservation.reservation)
          ? taskReservation.reservation
          : {}),
        ...(isPlainObject(options.reservation) ? options.reservation : {}),
      },
    };
    const result = registry.acquire(key, {
      ...options,
      now: operationNow,
    });
    if (!result.ok) return result;
    const renewing = before?.leaseId === result.lease.leaseId;
    if (renewing) {
      markChanged();
      return result;
    }

    let reservation;
    try {
      reservation = planReservation(state, effectiveOptions, operationNow);
    } catch (error) {
      registry.release(key, {
        holder: result.lease.holder,
        leaseId: result.lease.leaseId,
        now: operationNow,
      });
      return {
        ok: false,
        reason: "invalid-budget-reservation",
        error: error.message,
      };
    }
    if (!reservation.ok) {
      registry.release(key, {
        holder: result.lease.holder,
        leaseId: result.lease.leaseId,
        now: operationNow,
      });
      return reservation;
    }

    const taskId = registry._byKey.get(key);
    const task = taskId ? registry._tasks.get(taskId) : null;
    const fencingToken = state.nextFence;
    const lease = {
      ...task.metadata.lease,
      ownerPid: this._processId,
      fencingToken,
    };
    const metadata = { ...task.metadata, lease };
    if (archivePriorExecution) {
      metadata.workspaceExecution = null;
      metadata.workspaceExecutionHistory = [
        ...priorHistory,
        cloneJson(priorWorkspaceExecution, "settled workspace execution"),
      ].slice(-MAX_WORKSPACE_EXECUTION_HISTORY);
      delete metadata.workspaceRecovery;
    }
    if (
      !registry._write(task, {
        metadata,
      })
    ) {
      throw queueError(
        "TEAM_QUEUE_CONCURRENT_MUTATION",
        `Could not attach durable lease authority for task "${key}"`,
        this.filePath,
      );
    }
    state.nextFence += 1;
    state.budget.totals.tasksStarted += 1;
    if (state.budget.totals.startedAt == null) {
      state.budget.totals.startedAt = operationNow;
    }
    state.budget.reservations.push({
      leaseId: lease.leaseId,
      taskKey: key,
      maxTokens: reservation.maxTokens,
      maxUsd: reservation.maxUsd,
      reservedTokens: reservation.reservedTokens,
      reservedUsd: reservation.reservedUsd,
    });
    markChanged();
    return {
      ok: true,
      lease,
      budgetReservation: {
        id: lease.leaseId,
        maxTokens: reservation.maxTokens,
        maxUsd: reservation.maxUsd,
        maxBudgetUsd: reservation.maxUsd,
      },
    };
  }

  _inspect(reader) {
    return this._transact(reader, { readOnly: true });
  }

  _mutate(mutator, options = {}) {
    return this._transact(mutator, { readOnly: false, ...options });
  }

  _transact(action, { readOnly = false, now: explicitNow } = {}) {
    prepareDirectory(this.filePath);
    return this._underLock(() => {
      const loaded = secureRead(
        this._fileSystem,
        this.filePath,
        this._maxStateBytes,
        { secureFileParent: this._secureFileParent },
      );
      const state = parseState(loaded.serialized, this.filePath);
      validateState(state, this.filePath, this._expected);
      const operationNow = validTimestamp(
        explicitNow ?? this._now(),
        "queue clock",
      );
      let registry;
      try {
        registry = TaskLeaseRegistry.restore(state.registry, {
          now: this._now,
        });
        registry._leaseEpoch = `${state.queueId}:${state.nextFence}:${this._nextId("lease-epoch")}`;
        registry._leaseSequence = 0;
        validateRegistry(registry, state);
      } catch (cause) {
        throw queueError(
          "TEAM_QUEUE_CORRUPT",
          `Distributed queue registry failed validation: ${cause.message}`,
          this.filePath,
          cause,
        );
      }

      const recovery = this._reclaimUnavailable(registry, state, operationNow);
      let changed =
        recovery.reclaimed.length > 0 ||
        recovery.adjudicationRequired.length > 0;
      const context = {
        registry,
        state,
        now: operationNow,
        reclaimed: recovery.reclaimed,
        adjudicationRequired: recovery.adjudicationRequired,
        markChanged: () => {
          changed = true;
        },
      };
      const result = action(context);
      if (changed) {
        state.registry = registry.snapshot();
        state.revision += 1;
        state.updatedAt = operationNow;
        if (!readOnly && state.graph.length !== registry.list().length) {
          state.graph = graphFromRegistrySnapshot(state.registry);
        }
        refreshDigests(state);
        try {
          validateStateShape(state);
          validateRegistry(registry, state);
        } catch (cause) {
          throw queueError(
            "TEAM_QUEUE_INVALID_MUTATION",
            `Distributed queue mutation violated an invariant: ${cause.message}`,
            this.filePath,
            cause,
          );
        }
        atomicWrite(
          this._fileSystem,
          this.filePath,
          state,
          this._maxStateBytes,
          loaded.identity,
          { secureFileParent: this._secureFileParent },
        );
      }
      return cloneJson(result, "queue operation result");
    });
  }

  _reclaimUnavailable(registry, state, now) {
    const unavailable = [];
    for (const task of registry.list()) {
      const lease = task.lease;
      if (!lease) continue;
      let dead = false;
      if (Number.isSafeInteger(lease.ownerPid) && lease.ownerPid > 0) {
        try {
          dead = !this._isProcessAlive(lease.ownerPid);
        } catch (cause) {
          throw queueError(
            "TEAM_QUEUE_LIVENESS_FAILED",
            `Could not verify lease owner process ${lease.ownerPid}`,
            this.filePath,
            cause,
          );
        }
      }
      if (lease.expiresAt <= now || dead) {
        const expired = lease.expiresAt <= now;
        unavailable.push({
          key: task.key,
          lease,
          dead,
          expired,
          reason:
            dead && expired
              ? "owner-dead-and-lease-expired"
              : dead
                ? "owner-dead"
                : "lease-expired",
        });
      }
    }
    const reclaimed = [];
    const adjudicationRequired = [];
    for (const item of unavailable) {
      const taskId = registry._byKey.get(item.key);
      const task = taskId ? registry._tasks.get(taskId) : null;
      if (!task?.metadata?.lease) continue;
      if (task.metadata.lease.leaseId !== item.lease.leaseId) {
        throw queueError(
          "TEAM_QUEUE_CONCURRENT_MUTATION",
          `Lease authority changed while recovering task "${item.key}"`,
          this.filePath,
        );
      }

      if (isRetrySafeAbandonment(task, state)) {
        const retried = registry._write(task, {
          status: "pending",
          assignee: null,
          metadata: {
            ...task.metadata,
            lease: null,
          },
        });
        if (!retried) {
          throw queueError(
            "TEAM_QUEUE_CONCURRENT_MUTATION",
            `Could not safely requeue abandoned task "${item.key}"`,
            this.filePath,
          );
        }
        registry._leasedKeys.delete(item.key);
        registry._removeReady(item.key);
        registry._enqueueIfReady(item.key, now);
        reclaimed.push(item.key);
      } else {
        const interruption = activeInterruption(task, item.lease);
        const evidence = abandonedLeaseEvidence(
          state,
          item.key,
          item.lease,
          now,
          item.reason,
          task.metadata?.workspaceExecution || null,
        );
        const attached = registry._write(task, {
          metadata: {
            ...task.metadata,
            attempts: (task.metadata?.attempts || 0) + 1,
            abandonedLeaseEvidence: evidence,
          },
        });
        if (!attached) {
          throw queueError(
            "TEAM_QUEUE_CONCURRENT_MUTATION",
            `Could not preserve abandoned lease evidence for "${item.key}"`,
            this.filePath,
          );
        }
        const required = registry.requireAdjudication(item.key, {
          code: interruption
            ? INTERRUPT_ERROR_CODE
            : "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
          reason: interruption
            ? interruption.reason
            : "distributed execution outcome is unknown; adjudication is required before retry",
          evidenceDigest:
            interruption?.evidenceDigest || evidence.evidenceDigest,
          now,
        });
        if (!required.ok) {
          throw queueError(
            "TEAM_QUEUE_INVALID_MUTATION",
            `Could not fail abandoned task "${item.key}" closed: ${required.reason}`,
            this.filePath,
          );
        }
        adjudicationRequired.push(item.key);
      }
      chargeAbandonedReservation(state, item.lease.leaseId);
    }
    return { reclaimed, adjudicationRequired };
  }

  _underLock(body) {
    try {
      return this._lock(this.filePath, body, this._lockOptions);
    } catch (cause) {
      if (cause instanceof TeamDistributedQueueError) throw cause;
      throw queueError(
        "TEAM_QUEUE_LOCK_FAILED",
        `Distributed queue strict lock failed: ${this.filePath}`,
        this.filePath,
        cause,
      );
    }
  }

  _nextId(kind) {
    const value = this._id(kind);
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      String(value).length === 0 ||
      String(value).length > 512
    ) {
      throw new TypeError(`id("${kind}") returned an invalid identifier`);
    }
    return String(value);
  }

  _validateTaskDefinitions(definitions, existing = []) {
    const known = new Set(existing.map((task) => task.key));
    for (const definition of definitions) {
      if (!isPlainObject(definition)) {
        throw new TypeError("each task definition must be an object");
      }
      if (
        definition.key != null &&
        (typeof definition.key !== "string" || definition.key.length === 0)
      ) {
        throw new TypeError("task key must be a non-empty string");
      }
      if (
        typeof definition.title !== "string" ||
        definition.title.length === 0
      ) {
        throw new TypeError("task title must be a non-empty string");
      }
      if (
        definition.priority != null &&
        !["high", "normal", "low"].includes(definition.priority)
      ) {
        throw new TypeError("task priority must be high, normal, or low");
      }
      if (
        definition.dependsOn != null &&
        !Array.isArray(definition.dependsOn)
      ) {
        throw new TypeError("task dependsOn must be an array");
      }
      if (definition.metadata != null) {
        cloneJson(definition.metadata, "task metadata");
        for (const field of INTERNAL_METADATA) {
          if (Object.hasOwn(definition.metadata, field)) {
            throw new TypeError(
              `task metadata field "${field}" is reserved by the queue`,
            );
          }
        }
      }
      if (definition.key) known.add(definition.key);
    }
    for (const definition of definitions) {
      const dependencies = definition.dependsOn || [];
      const unique = new Set();
      for (const dependency of dependencies) {
        if (typeof dependency !== "string" || dependency.length === 0) {
          throw new TypeError("task dependencies must be non-empty strings");
        }
        if (unique.has(dependency)) {
          throw new TypeError(
            `Task "${definition.key}" repeats dependency "${dependency}"`,
          );
        }
        unique.add(dependency);
        if (!known.has(dependency)) {
          throw queueError(
            "TEAM_QUEUE_INVALID_GRAPH",
            `Task "${definition.key}" has unknown dependency "${dependency}"`,
            this.filePath,
          );
        }
      }
    }
  }
}
