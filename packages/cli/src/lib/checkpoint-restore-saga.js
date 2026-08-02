/**
 * Durable, append-only state for checkpoint restore orchestration.
 *
 * This module deliberately does not perform a restore. It gives callers a
 * small durable protocol that can be created before the workspace lock is
 * acquired, then advanced with compare-and-swap after each durable boundary.
 * Each phase is a separate immutable file in an owner-private state tree.
 * A fixed HEAD sidecar settles each append and detects a missing tail. The only
 * automatic repair is event n+1 with HEAD n, the process-crash window between
 * the two atomic renames; HEAD is never rolled backward to fit a shorter chain.
 * Destructive retention writes an exact durable purge receipt before deletion;
 * callers must explicitly release that receipt before reusing an operationId.
 *
 * Cooperative CLI processes are serialized by the canonical state lock. The
 * store also detects ordinary same-owner tampering (links, replacements,
 * truncation, hash drift and path aliases), but it is not a defence against a
 * hostile process running continuously as the same OS account. Windows does
 * not expose directory fsync through Node, so a sudden power loss that rolls
 * both event and HEAD back together also remains outside this protocol.
 */

import fsDefault from "node:fs";
import pathDefault from "node:path";
import { createHash, randomUUID as randomUUIDDefault } from "node:crypto";
import { getStatePath as getStatePathDefault } from "./paths.js";
import {
  ensurePrivateDirectory as ensurePrivateDirectoryDefault,
  repairPrivatePaths as repairPrivatePathsDefault,
} from "./secure-fs.js";
import { withFileLock as withFileLockDefault } from "./with-file-lock.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";

export const CHECKPOINT_RESTORE_SAGA_SCHEMA =
  "chainlesschain.checkpoint-restore-saga-event";
export const CHECKPOINT_RESTORE_SAGA_VERSION = 1;
export const MAX_CHECKPOINT_RESTORE_SAGA_EVENTS = 64;
export const MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES = 32 * 1024;
export const MAX_CHECKPOINT_RESTORE_SAGAS = 10_000;
export const MAX_CHECKPOINT_RESTORE_SAGA_SHARDS = 4_096;
export const MAX_CHECKPOINT_RESTORE_SAGA_LIST_LIMIT = 64;
export const MAX_CHECKPOINT_RESTORE_SAGA_LIST_EVENTS = 512;
export const MAX_CHECKPOINT_RESTORE_SAGA_LIST_BYTES = 16 * 1024 * 1024;
export const MAX_CHECKPOINT_RESTORE_SAGA_LIST_TIME_MS = 2_000;

export const CHECKPOINT_RESTORE_SAGA_DURABILITY = Object.freeze({
  eventFile: "fsync-before-same-directory-atomic-rename",
  headFile: "event-first-then-fsync-before-atomic-head-replace",
  purgeReceipt: "fsync-receipt-before-delete-and-explicit-release-before-reuse",
  posixDirectory: "fsync-best-effort-after-commit",
  windowsDirectory: "atomic-rename-without-directory-fsync",
  listingTimeBudget: "cooperative-between-synchronous-filesystem-calls",
});

export const CHECKPOINT_RESTORE_SAGA_ERROR_CODES = Object.freeze({
  INVALID_OPERATION_ID: "CHECKPOINT_RESTORE_SAGA_INVALID_OPERATION_ID",
  INVALID_EVIDENCE: "CHECKPOINT_RESTORE_SAGA_INVALID_EVIDENCE",
  UNSAFE_PATH: "CHECKPOINT_RESTORE_SAGA_UNSAFE_PATH",
  NOT_FOUND: "CHECKPOINT_RESTORE_SAGA_NOT_FOUND",
  ALREADY_EXISTS: "CHECKPOINT_RESTORE_SAGA_ALREADY_EXISTS",
  CORRUPT: "CHECKPOINT_RESTORE_SAGA_CORRUPT",
  CONFLICT: "CHECKPOINT_RESTORE_SAGA_CONFLICT",
  INVALID_TRANSITION: "CHECKPOINT_RESTORE_SAGA_INVALID_TRANSITION",
  LIMIT: "CHECKPOINT_RESTORE_SAGA_LIMIT",
  LOCK_FAILED: "CHECKPOINT_RESTORE_SAGA_LOCK_FAILED",
  WRITE_FAILED: "CHECKPOINT_RESTORE_SAGA_WRITE_FAILED",
  WORKSPACE_MISMATCH: "CHECKPOINT_RESTORE_SAGA_WORKSPACE_MISMATCH",
});

export const CHECKPOINT_RESTORE_SAGA_PHASES = Object.freeze([
  "created",
  "locked",
  "prepared",
  "intent_committed",
  "safety_ready",
  "mutation_started",
  "workspace_applied",
  "session_committed",
  "completed",
  "aborted",
  "rolled_back",
  "recovery_required",
  "recovery_started",
]);

export const CHECKPOINT_RESTORE_SAGA_TERMINAL_PHASES = Object.freeze([
  "completed",
  "aborted",
  "rolled_back",
]);

const PHASE_SET = new Set(CHECKPOINT_RESTORE_SAGA_PHASES);
const TERMINAL_PHASE_SET = new Set(CHECKPOINT_RESTORE_SAGA_TERMINAL_PHASES);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const WORKSPACE_SHARD_PATTERN = /^workspace-[a-f0-9]{64}$/;
const EVENT_FILE_PATTERN = /^(\d{6})-([a-z_]+)\.json$/;
const TEMPORARY_FILE_PATTERN =
  /^\.(\d{6})-([a-z_]+)\.json\.([1-9]\d{0,15})\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.tmp$/;
const HEAD_FILE_NAME = "HEAD";
const HEAD_TEMPORARY_FILE_PATTERN =
  /^\.HEAD\.([1-9]\d{0,15})\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.tmp$/;
const HEAD_SCHEMA = "chainlesschain.checkpoint-restore-saga-head";
const HEAD_VERSION = 1;
const MAX_HEAD_BYTES = 4 * 1024;
const PURGE_RECEIPT_SCHEMA = "chainlesschain.checkpoint-restore-purge-receipt";
const PURGE_RECEIPT_VERSION = 1;
const MAX_PURGE_RECEIPT_BYTES = 4 * 1024;
const PURGE_RECEIPT_FILE_PATTERN = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\.json$/;
const PURGE_RECEIPT_TEMPORARY_FILE_PATTERN =
  /^\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\.([1-9]\d{0,15})\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.tmp$/;
const HEAD_KEYS = Object.freeze([
  "schema",
  "version",
  "state",
  "operationId",
  "workspaceIdentity",
  "seq",
  "phase",
  "eventFile",
  "eventHash",
  "prevHash",
  "anchorHash",
]);
const PURGE_RECEIPT_KEYS = Object.freeze([
  "schema",
  "version",
  "operationId",
  "workspaceIdentity",
  "seq",
  "phase",
  "headHash",
  "receiptHash",
]);
const MAX_EVIDENCE_BYTES = 16 * 1024;
const MAX_ORPHAN_TEMPORARY_FILES = 16;
const MAX_DIRECTORY_ENTRIES =
  MAX_CHECKPOINT_RESTORE_SAGA_EVENTS + MAX_ORPHAN_TEMPORARY_FILES + 1;
const MAX_STATE_LOCK_OWNER_BYTES = 2 * 1024;
const STATE_LOCK_OWNER_KEYS = Object.freeze(["pid", "startedAt", "token"]);
const WORKSPACE_LOCK_OWNER_KEYS = Object.freeze([
  "identityPolicy",
  "pid",
  "purpose",
  "startedAt",
  "token",
  "transactionId",
  "workspaceRoot",
]);

const TRANSITIONS = new Map([
  ["created", new Set(["locked", "aborted", "recovery_required"])],
  ["locked", new Set(["prepared", "aborted", "recovery_required"])],
  ["prepared", new Set(["intent_committed", "aborted", "recovery_required"])],
  [
    "intent_committed",
    new Set([
      "safety_ready",
      "workspace_applied",
      "aborted",
      "recovery_required",
    ]),
  ],
  [
    "safety_ready",
    new Set(["mutation_started", "aborted", "recovery_required"]),
  ],
  [
    "mutation_started",
    new Set(["workspace_applied", "rolled_back", "recovery_required"]),
  ],
  [
    "workspace_applied",
    new Set([
      "session_committed",
      "completed",
      "rolled_back",
      "recovery_required",
    ]),
  ],
  ["session_committed", new Set(["completed", "recovery_required"])],
  ["recovery_required", new Set(["recovery_started"])],
  [
    "recovery_started",
    new Set(["completed", "aborted", "rolled_back", "recovery_required"]),
  ],
  ["completed", new Set()],
  ["aborted", new Set()],
  ["rolled_back", new Set()],
]);

const EVIDENCE_RULES = Object.freeze({
  workspaceRoot: Object.freeze({ type: "path", max: 4096 }),
  workspaceIdentity: Object.freeze({ type: "hash" }),
  workspaceBinding: Object.freeze({ type: "text", max: 1024 }),
  confirmationDigest: Object.freeze({ type: "hash" }),
  restoreKind: Object.freeze({
    type: "enum",
    values: Object.freeze(["copy", "git", "timeline"]),
  }),
  restoreSurface: Object.freeze({
    type: "enum",
    values: Object.freeze(["direct", "timeline"]),
  }),
  intentAuthority: Object.freeze({
    type: "enum",
    values: Object.freeze(["operation", "session"]),
  }),
  checkpointNamespace: Object.freeze({ type: "text", max: 256 }),
  checkpointId: Object.freeze({ type: "text", max: 256 }),
  checkpointIdentity: Object.freeze({ type: "text", max: 1024 }),
  sessionId: Object.freeze({ type: "text", max: 256 }),
  timelineEntryId: Object.freeze({ type: "text", max: 256 }),
  safetyId: Object.freeze({ type: "text", max: 256 }),
  safetyIdentity: Object.freeze({ type: "text", max: 1024 }),
  safetyPlanIdentity: Object.freeze({ type: "text", max: 1024 }),
  safetyCoverage: Object.freeze({
    type: "enum",
    values: Object.freeze(["full", "partial", "none", "unknown"]),
  }),
  workspaceLockOwner: Object.freeze({ type: "workspaceLockOwner" }),
  lockOwnerDigest: Object.freeze({ type: "hash" }),
  prestateDigest: Object.freeze({ type: "hash" }),
  poststateDigest: Object.freeze({ type: "hash" }),
  resultDigest: Object.freeze({ type: "hash" }),
  sessionCommitDigest: Object.freeze({ type: "hash" }),
  intentCommitDigest: Object.freeze({ type: "hash" }),
  reason: Object.freeze({ type: "text", max: 2048 }),
  errorCode: Object.freeze({ type: "text", max: 128 }),
  recoveryAction: Object.freeze({ type: "text", max: 128 }),
  actorPid: Object.freeze({ type: "positiveInteger" }),
  targetCount: Object.freeze({ type: "nonNegativeInteger" }),
  appliedCount: Object.freeze({ type: "nonNegativeInteger" }),
});

const REQUIRED_EVIDENCE_BY_PHASE = Object.freeze({
  prepared: Object.freeze(["prestateDigest", "targetCount"]),
  intent_committed: Object.freeze(["intentCommitDigest"]),
  safety_ready: Object.freeze([
    "safetyId",
    "safetyIdentity",
    "safetyPlanIdentity",
    "safetyCoverage",
  ]),
  mutation_started: Object.freeze(["targetCount"]),
  workspace_applied: Object.freeze(["appliedCount", "poststateDigest"]),
  session_committed: Object.freeze(["sessionCommitDigest"]),
  completed: Object.freeze(["resultDigest"]),
  aborted: Object.freeze(["reason"]),
  rolled_back: Object.freeze(["recoveryAction", "resultDigest"]),
  recovery_required: Object.freeze(["reason", "errorCode"]),
  recovery_started: Object.freeze(["recoveryAction"]),
});

export class CheckpointRestoreSagaError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "CheckpointRestoreSagaError";
    this.code = code;
    Object.assign(this, options.details || {});
  }
}

function sagaError(code, message, cause = null, details = {}) {
  return new CheckpointRestoreSagaError(code, message, { cause, details });
}

function isSagaError(error) {
  return error instanceof CheckpointRestoreSagaError;
}

function attachCommitState(error, details) {
  if (!error || typeof error !== "object") return error;
  for (const [key, value] of Object.entries(details)) {
    if (error[key] === undefined) error[key] = value;
  }
  return error;
}

function boundedPositiveInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga data contains a non-finite number",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw sagaError(
    CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
    "Saga data contains an unsupported value",
  );
}

function sha256(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
}

function eventHash(event) {
  const body = { ...event };
  delete body.hash;
  return sha256("cc-checkpoint-restore-saga-event-v1", body);
}

function headAnchorHash(head) {
  const body = { ...head };
  delete body.anchorHash;
  return sha256("cc-checkpoint-restore-saga-head-v1", body);
}

function purgeReceiptHash(receipt) {
  const body = { ...receipt };
  delete body.receiptHash;
  return sha256("cc-checkpoint-restore-purge-receipt-v1", body);
}

function purgeReceipt(operationId, workspaceIdentityValue, saga) {
  const receipt = {
    schema: PURGE_RECEIPT_SCHEMA,
    version: PURGE_RECEIPT_VERSION,
    operationId,
    workspaceIdentity: workspaceIdentityValue,
    seq: saga.seq,
    phase: saga.phase,
    headHash: saga.headHash,
    receiptHash: null,
  };
  receipt.receiptHash = purgeReceiptHash(receipt);
  return receipt;
}

function genesisHead(operationId, workspaceIdentityValue) {
  const head = {
    schema: HEAD_SCHEMA,
    version: HEAD_VERSION,
    state: "unpublished",
    operationId,
    workspaceIdentity: workspaceIdentityValue,
    seq: 0,
    phase: null,
    eventFile: null,
    eventHash: null,
    prevHash: null,
    anchorHash: null,
  };
  head.anchorHash = headAnchorHash(head);
  return head;
}

function committedHead(operationId, workspaceIdentityValue, event) {
  const head = {
    schema: HEAD_SCHEMA,
    version: HEAD_VERSION,
    state: "committed",
    operationId,
    workspaceIdentity: workspaceIdentityValue,
    seq: event.seq,
    phase: event.phase,
    eventFile: `${String(event.seq).padStart(6, "0")}-${event.phase}.json`,
    eventHash: event.hash,
    prevHash: event.prevHash,
    anchorHash: null,
  };
  head.anchorHash = headAnchorHash(head);
  return head;
}

export function computeCheckpointRestoreWorkspaceLockOwnerDigest(owner) {
  const normalized = normalizeWorkspaceLockOwner(owner);
  return sha256("cc-checkpoint-restore-workspace-lock-owner-v1", normalized);
}

function hasExactKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function assertOperationId(operationId) {
  if (
    typeof operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(operationId)
  ) {
    throw sagaError(
      CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_OPERATION_ID,
      "Checkpoint restore operationId must be a safe caller-provided identifier",
      null,
      {
        operationId:
          typeof operationId === "string" ? operationId.slice(0, 128) : null,
      },
    );
  }
  return operationId;
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeWorkspaceLockOwner(value) {
  if (
    !hasExactKeys(value, WORKSPACE_LOCK_OWNER_KEYS) ||
    value.identityPolicy !== "pid-only-fail-closed" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !Number.isFinite(value.startedAt) ||
    typeof value.token !== "string" ||
    !/^[a-zA-Z0-9-]{16,128}$/.test(value.token) ||
    value.purpose !== "checkpoint-restore" ||
    typeof value.transactionId !== "string" ||
    !OPERATION_ID_PATTERN.test(value.transactionId) ||
    typeof value.workspaceRoot !== "string" ||
    !pathDefault.isAbsolute(value.workspaceRoot) ||
    value.workspaceRoot.length > 4096 ||
    value.workspaceRoot.includes("\0") ||
    hasControlCharacters(value.workspaceRoot)
  ) {
    throw sagaError(
      CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
      "Invalid saga workspaceLockOwner evidence",
    );
  }
  return Object.freeze({ ...value });
}

function normalizeEvidenceValue(key, value, rule) {
  if (rule.type === "workspaceLockOwner") {
    return normalizeWorkspaceLockOwner(value);
  }
  if (rule.type === "hash") {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
        `Invalid saga evidence field: ${key}`,
      );
    }
    return value;
  }
  if (rule.type === "enum") {
    if (typeof value !== "string" || !rule.values.includes(value)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
        `Invalid saga evidence field: ${key}`,
      );
    }
    return value;
  }
  if (rule.type === "positiveInteger") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
        `Invalid saga evidence field: ${key}`,
      );
    }
    return value;
  }
  if (rule.type === "nonNegativeInteger") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
        `Invalid saga evidence field: ${key}`,
      );
    }
    return value;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > rule.max ||
    value.includes("\0") ||
    hasControlCharacters(value)
  ) {
    throw sagaError(
      CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
      `Invalid saga evidence field: ${key}`,
    );
  }
  if (rule.type === "path" && !pathDefault.isAbsolute(value)) {
    throw sagaError(
      CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
      `Invalid saga evidence field: ${key}`,
    );
  }
  if (rule.type === "text" && value.trim() !== value) {
    throw sagaError(
      CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
      `Invalid saga evidence field: ${key}`,
    );
  }
  return value;
}

function normalizeEvidence(evidence, { replay = false } = {}) {
  const errorCode = replay
    ? CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT
    : CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE;
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    Object.getPrototypeOf(evidence) !== Object.prototype
  ) {
    throw sagaError(errorCode, "Saga evidence must be a plain object");
  }
  const result = {};
  try {
    for (const key of Object.keys(evidence).sort()) {
      const rule = EVIDENCE_RULES[key];
      if (!rule) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
          `Saga evidence field is not allowed: ${key}`,
        );
      }
      result[key] = normalizeEvidenceValue(key, evidence[key], rule);
    }
  } catch (error) {
    if (replay && isSagaError(error)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Persisted saga evidence is invalid",
        error,
      );
    }
    throw error;
  }
  if (Buffer.byteLength(canonicalJson(result), "utf8") > MAX_EVIDENCE_BYTES) {
    throw sagaError(errorCode, "Saga evidence exceeds the durable size limit");
  }
  return Object.freeze(result);
}

function pathKey(value, platform, pathApi) {
  const resolved = pathApi.resolve(value).replace(/[\\/]+$/, "");
  return ["win32", "darwin"].includes(platform)
    ? resolved.toLowerCase()
    : resolved;
}

function samePath(left, right, platform, pathApi) {
  return pathKey(left, platform, pathApi) === pathKey(right, platform, pathApi);
}

function pathContains(parent, child, platform, pathApi) {
  const parentKey = pathKey(parent, platform, pathApi);
  const childKey = pathKey(child, platform, pathApi);
  const relative = pathApi.relative(parentKey, childKey);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !pathApi.isAbsolute(relative))
  );
}

function pathsOverlap(left, right, platform, pathApi) {
  return (
    pathContains(left, right, platform, pathApi) ||
    pathContains(right, left, platform, pathApi)
  );
}

function statIdentity(stat) {
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
  });
}

function sameIdentity(left, right) {
  return (
    left.dev === String(right.dev) &&
    left.ino === String(right.ino) &&
    left.mode === String(right.mode)
  );
}

function workspaceIdentity(workspaceRoot, stat) {
  return sha256("cc-checkpoint-restore-workspace-identity-v1", {
    path: workspaceRoot,
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs ?? Math.trunc(stat.birthtimeMs)),
  });
}

function frozenSaga(operationId, events, orphanTemporaryFiles = []) {
  const frozenEvents = Object.freeze(
    events.map((event) =>
      Object.freeze({ ...event, evidence: event.evidence }),
    ),
  );
  const head = frozenEvents[frozenEvents.length - 1];
  return Object.freeze({
    version: CHECKPOINT_RESTORE_SAGA_VERSION,
    operationId,
    workspaceRoot: frozenEvents[0].evidence.workspaceRoot,
    workspaceIdentity: frozenEvents[0].evidence.workspaceIdentity,
    seq: head.seq,
    headHash: head.hash,
    phase: head.phase,
    terminal: TERMINAL_PHASE_SET.has(head.phase),
    pending: !TERMINAL_PHASE_SET.has(head.phase),
    events: frozenEvents,
    orphanTemporaryFiles: Object.freeze([...orphanTemporaryFiles]),
  });
}

export function resolveCheckpointRestoreSagaStateRoot(options = {}) {
  const pathApi = options.path || pathDefault;
  if (typeof options.stateDir === "string" && options.stateDir.trim()) {
    return pathApi.resolve(options.stateDir);
  }
  const getStatePath = options.getStatePath || getStatePathDefault;
  return pathApi.join(pathApi.resolve(getStatePath()), "checkpoint-restores");
}

export class CheckpointRestoreSagaStore {
  constructor(options = {}) {
    this._fs = options.fs || fsDefault;
    this._path = options.path || pathDefault;
    this._platform = options.platform || process.platform;
    this._runtime = options.runtime;
    this._now = options.now || (() => Date.now());
    this._wallClock = options.wallClock || (() => Date.now());
    this._randomUUID = options.randomUUID || randomUUIDDefault;
    this._withFileLock = options.withFileLock || withFileLockDefault;
    this._secureFileParent =
      options.secureFileParent || withTrustedFileParentSync;
    this._lockTimeoutMs = Number.isSafeInteger(options.lockTimeoutMs)
      ? Math.min(30_000, Math.max(1, options.lockTimeoutMs))
      : 5_000;
    this._lockRetryMs = Number.isSafeInteger(options.lockRetryMs)
      ? Math.min(1_000, Math.max(1, options.lockRetryMs))
      : 2;
    this._maxSagas = boundedPositiveInteger(
      options.maxSagas,
      MAX_CHECKPOINT_RESTORE_SAGAS,
      MAX_CHECKPOINT_RESTORE_SAGAS,
    );
    this._maxWorkspaceShards = boundedPositiveInteger(
      options.maxWorkspaceShards,
      MAX_CHECKPOINT_RESTORE_SAGA_SHARDS,
      MAX_CHECKPOINT_RESTORE_SAGA_SHARDS,
    );
    this._beforeRename = options.beforeRename || null;
    this._beforeHeadRename = options.beforeHeadRename || null;
    this._beforeCreatedEvent = options.beforeCreatedEvent || null;
    this._secureDirectory =
      options.secureDirectory ||
      ((target) =>
        ensurePrivateDirectoryDefault(target, {
          platform: this._platform,
          applyWindowsAcl: true,
          failIfUnavailable: true,
        }));
    this._secureAuthorityPaths =
      typeof options.secureAuthorityPaths === "function"
        ? options.secureAuthorityPaths
        : (targets) =>
            repairPrivatePathsDefault(targets, {
              platform: this._platform,
            });
    this._privateAuthorityCache = new Map();

    this.workspaceRoot = this._canonicalExistingDirectory(
      options.workspaceRoot,
      "workspace root",
      { rejectRoot: true },
    );
    const workspaceStat = this._fs.lstatSync(this.workspaceRoot, {
      bigint: true,
    });
    this._workspaceRootIdentity = statIdentity(workspaceStat);
    this.workspaceIdentity = workspaceIdentity(
      this.workspaceRoot,
      workspaceStat,
    );

    const requestedBaseStateRoot = resolveCheckpointRestoreSagaStateRoot({
      stateDir: options.stateDir,
      getStatePath: options.getStatePath,
      path: this._path,
    });
    if (
      pathsOverlap(
        requestedBaseStateRoot,
        this.workspaceRoot,
        this._platform,
        this._path,
      )
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Checkpoint restore state must be external to the workspace",
        null,
        {
          stateRoot: requestedBaseStateRoot,
          workspaceRoot: this.workspaceRoot,
        },
      );
    }
    try {
      this._secureDirectory(requestedBaseStateRoot);
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Could not establish owner-private checkpoint restore state",
        cause,
        { stateRoot: requestedBaseStateRoot },
      );
    }
    this.baseStateRoot = this._canonicalExistingDirectory(
      requestedBaseStateRoot,
      "checkpoint restore base state root",
    );
    if (
      !samePath(
        requestedBaseStateRoot,
        this.baseStateRoot,
        this._platform,
        this._path,
      ) ||
      pathsOverlap(
        this.baseStateRoot,
        this.workspaceRoot,
        this._platform,
        this._path,
      )
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Checkpoint restore state must be canonical and external to the workspace",
        null,
        {
          stateRoot: requestedBaseStateRoot,
          workspaceRoot: this.workspaceRoot,
        },
      );
    }
    this._baseStateRootIdentity = statIdentity(
      this._fs.lstatSync(this.baseStateRoot, { bigint: true }),
    );
    this.workspaceShardId = `workspace-${this.workspaceIdentity.slice("sha256:".length)}`;
    this.stateRoot = this._path.join(this.baseStateRoot, this.workspaceShardId);
    this._ensureWorkspaceShard();
    this._repairAndVerifyWindowsAuthority(
      [this.baseStateRoot, this.stateRoot],
      "checkpoint restore workspace shard authority",
      { cacheKey: "workspace-shard-roots" },
    );
    this._stateRootIdentity = statIdentity(
      this._fs.lstatSync(this.stateRoot, { bigint: true }),
    );
    this.lockRoot = this._path.join(this.stateRoot, ".locks");
    this.archiveRoot = this._path.join(this.stateRoot, ".archive");
    this.purgeRoot = this._path.join(this.stateRoot, ".purge");
    this.purgeReceiptRoot = this._path.join(this.stateRoot, ".purged");
    this._ensurePrivateChildDirectory(this.lockRoot, this.stateRoot);
    this._ensurePrivateChildDirectory(this.archiveRoot, this.stateRoot);
    this._ensurePrivateChildDirectory(this.purgeRoot, this.stateRoot);
    this._ensurePrivateChildDirectory(this.purgeReceiptRoot, this.stateRoot);
    this._repairAndVerifyWindowsAuthority(
      [this.lockRoot, this.archiveRoot, this.purgeRoot, this.purgeReceiptRoot],
      "checkpoint restore control-root authority",
      { cacheKey: "control-roots" },
    );
    this._lockRootIdentity = statIdentity(
      this._fs.lstatSync(this.lockRoot, { bigint: true }),
    );
    this._archiveRootIdentity = statIdentity(
      this._fs.lstatSync(this.archiveRoot, { bigint: true }),
    );
    this._purgeRootIdentity = statIdentity(
      this._fs.lstatSync(this.purgeRoot, { bigint: true }),
    );
    this._purgeReceiptRootIdentity = statIdentity(
      this._fs.lstatSync(this.purgeReceiptRoot, { bigint: true }),
    );
  }

  _canonicalExistingDirectory(value, label, { rejectRoot = false } = {}) {
    if (
      typeof value !== "string" ||
      value.trim() === "" ||
      value.includes("\0")
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} must be a non-empty canonical path`,
      );
    }
    const requested = this._path.resolve(value);
    let entry;
    let canonical;
    try {
      entry = this._fs.lstatSync(requested, { bigint: true });
      canonical = this._fs.realpathSync.native(requested);
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} is unavailable`,
        cause,
        { path: requested },
      );
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} must be a real directory`,
        null,
        { path: requested },
      );
    }
    if (
      rejectRoot &&
      samePath(
        canonical,
        this._path.parse(canonical).root,
        this._platform,
        this._path,
      )
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} must not be a filesystem root`,
      );
    }
    if (
      !samePath(requested, canonical, this._platform, this._path) ||
      (this._platform !== "win32" &&
        (Number(entry.mode) & 0o077) !== 0 &&
        label !== "workspace root")
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} is aliased or not owner-private`,
        null,
        { path: requested, canonical },
      );
    }
    return canonical;
  }

  _ensurePrivateChildDirectory(
    directory,
    authorityRoot = this.stateRoot || this.baseStateRoot,
  ) {
    const parent = this._path.dirname(directory);
    if (
      authorityRoot &&
      !pathContains(authorityRoot, directory, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga child directory escapes the state root",
      );
    }
    try {
      let created = false;
      if (!this._fs.existsSync(directory)) {
        this._fs.mkdirSync(directory, { mode: 0o700 });
        created = true;
      }
      const initial = this._fs.lstatSync(directory, { bigint: true });
      if (initial.isSymbolicLink() || !initial.isDirectory()) {
        throw new Error("unsafe child directory");
      }
      if (created && this._platform !== "win32") {
        this._fs.chmodSync(directory, 0o700);
      }
      const parentCanonical = this._fs.realpathSync.native(parent);
      const canonical = this._fs.realpathSync.native(directory);
      const entry = this._fs.lstatSync(directory, { bigint: true });
      if (
        entry.isSymbolicLink() ||
        !entry.isDirectory() ||
        !samePath(parent, parentCanonical, this._platform, this._path) ||
        !samePath(directory, canonical, this._platform, this._path) ||
        (this._platform !== "win32" && (Number(entry.mode) & 0o077) !== 0)
      ) {
        throw new Error("unsafe child directory");
      }
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Could not establish a private saga child directory",
        cause,
        { directory },
      );
    }
    return directory;
  }

  _privateAuthoritySignature(paths) {
    return paths
      .map((target) => {
        const stat = this._fs.lstatSync(target, { bigint: true });
        return [
          pathKey(target, this._platform, this._path),
          String(stat.dev),
          String(stat.ino),
          String(stat.mode),
          String(stat.size),
          String(stat.nlink),
        ].join(":");
      })
      .join("|");
  }

  _repairAndVerifyWindowsAuthority(
    paths,
    label,
    { operationId = null, cacheKey = null } = {},
  ) {
    if (
      this._platform !== "win32" ||
      typeof this._secureAuthorityPaths !== "function"
    ) {
      return;
    }
    const uniquePaths = [
      ...new Map(
        paths.map((target) => [
          pathKey(target, this._platform, this._path),
          target,
        ]),
      ).values(),
    ];
    if (uniquePaths.length === 0) return;
    const effectiveCacheKey = cacheKey || uniquePaths.join("\n");
    const details = {
      ...(operationId ? { operationId } : {}),
      paths: Object.freeze([...uniquePaths]),
    };
    try {
      const beforeSignature = this._privateAuthoritySignature(uniquePaths);
      if (
        this._privateAuthorityCache.get(effectiveCacheKey) === beforeSignature
      ) {
        return;
      }
      const repaired = this._secureAuthorityPaths(uniquePaths);
      if (!Array.isArray(repaired)) {
        throw new Error("Owner-private authority repair returned no results");
      }
      const byTarget = new Map();
      for (const result of repaired) {
        const resultTarget = String(result?.target || "");
        const key = pathKey(resultTarget, this._platform, this._path);
        if (!resultTarget || byTarget.has(key)) {
          throw new Error(
            "Owner-private authority repair returned ambiguous results",
          );
        }
        byTarget.set(key, result);
      }
      for (const target of uniquePaths) {
        const result = byTarget.get(
          pathKey(target, this._platform, this._path),
        );
        if (!result || result.ok !== true || result.exists === false) {
          throw new Error(
            result?.error || `Owner-private authority repair failed: ${target}`,
          );
        }
      }
      const afterSignature = this._privateAuthoritySignature(uniquePaths);
      if (afterSignature !== beforeSignature) {
        throw new Error(
          "Owner-private authority changed identity during ACL repair",
        );
      }
      this._privateAuthorityCache.set(effectiveCacheKey, afterSignature);
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `Could not establish owner-private ${label}`,
        cause,
        details,
      );
    }
  }

  _assertPrivateRepairFile(filePath, maximum, { allowEmpty = false } = {}) {
    let entry;
    let canonical;
    try {
      entry = this._fs.lstatSync(filePath, { bigint: true });
      canonical = this._fs.realpathSync.native(filePath);
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Could not inspect a private saga authority file",
        cause,
        { filePath },
      );
    }
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.nlink !== 1n ||
      (!allowEmpty && entry.size <= 0n) ||
      (allowEmpty && entry.size < 0n) ||
      entry.size > BigInt(maximum) ||
      !samePath(filePath, canonical, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga authority is not a bounded canonical regular file",
        null,
        { filePath },
      );
    }
    return entry;
  }

  _secureWindowsFileBeforeRename(filePath, maximum, label, operationId) {
    if (
      this._platform !== "win32" ||
      typeof this._secureAuthorityPaths !== "function"
    ) {
      return;
    }
    this._assertPrivateRepairFile(filePath, maximum);
    this._repairAndVerifyWindowsAuthority([filePath], label, { operationId });
  }

  _secureOperationAuthority(operationId, authority) {
    const classification = this._classifyOperationEntries(authority);
    if (
      this._platform !== "win32" ||
      typeof this._secureAuthorityPaths !== "function"
    ) {
      return classification;
    }
    const targets = [authority.directory];
    for (const file of classification.files) {
      this._assertPrivateRepairFile(
        file.filePath,
        MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES,
      );
      targets.push(file.filePath);
    }
    if (classification.headFile) {
      this._assertPrivateRepairFile(classification.headFile, MAX_HEAD_BYTES);
      targets.push(classification.headFile);
    }
    for (const name of classification.orphanTemporaryFiles) {
      const filePath = this._path.join(authority.directory, name);
      const maximum = name.startsWith(".HEAD.")
        ? MAX_HEAD_BYTES
        : MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES;
      this._assertPrivateRepairFile(filePath, maximum, { allowEmpty: true });
      targets.push(filePath);
    }
    this._repairAndVerifyWindowsAuthority(
      targets,
      "checkpoint restore operation authority",
      {
        operationId,
        cacheKey: `operation:${pathKey(authority.directory, this._platform, this._path)}`,
      },
    );
    const directoryAfter = this._fs.lstatSync(authority.directory, {
      bigint: true,
    });
    const canonicalAfter = this._fs.realpathSync.native(authority.directory);
    if (
      !sameIdentity(authority.identity, directoryAfter) ||
      !samePath(authority.directory, canonicalAfter, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga operation authority changed during owner-private repair",
        null,
        { operationId, directory: authority.directory },
      );
    }
    return classification;
  }

  _ensureWorkspaceShard() {
    const names = this._readDirectoryNamesBounded(
      this.baseStateRoot,
      this._maxWorkspaceShards + 1,
      "Checkpoint restore workspace shard count exceeds its bound",
    );
    const shardNames = [];
    for (const name of names) {
      if (!WORKSPACE_SHARD_PATTERN.test(name)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Checkpoint restore base state contains an unexpected entry",
          null,
          { name },
        );
      }
      shardNames.push(name);
    }
    if (
      !shardNames.includes(this.workspaceShardId) &&
      shardNames.length >= this._maxWorkspaceShards
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
        "Checkpoint restore workspace shard limit reached",
      );
    }
    this._ensurePrivateChildDirectory(this.stateRoot, this.baseStateRoot);
  }

  _assertStoreAuthority() {
    this._assertWorkspaceAuthority();
    const roots = [
      [this.baseStateRoot, this._baseStateRootIdentity],
      [this.stateRoot, this._stateRootIdentity],
      [this.lockRoot, this._lockRootIdentity],
      [this.archiveRoot, this._archiveRootIdentity],
      [this.purgeRoot, this._purgeRootIdentity],
      [this.purgeReceiptRoot, this._purgeReceiptRootIdentity],
    ];
    for (const [directory, identity] of roots) {
      let stat;
      let canonical;
      try {
        stat = this._fs.lstatSync(directory, { bigint: true });
        canonical = this._fs.realpathSync.native(directory);
      } catch (cause) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
          "Checkpoint restore state authority is unavailable",
          cause,
          { directory },
        );
      }
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        !sameIdentity(identity, stat) ||
        !samePath(directory, canonical, this._platform, this._path) ||
        (this._platform !== "win32" && (Number(stat.mode) & 0o077) !== 0)
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
          "Checkpoint restore state authority changed identity",
          null,
          { directory },
        );
      }
    }
  }

  _assertWorkspaceAuthority() {
    let stat;
    let canonical;
    try {
      stat = this._fs.lstatSync(this.workspaceRoot, { bigint: true });
      canonical = this._fs.realpathSync.native(this.workspaceRoot);
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WORKSPACE_MISMATCH,
        "Checkpoint restore workspace authority is unavailable",
        cause,
        { workspaceRoot: this.workspaceRoot },
      );
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      !sameIdentity(this._workspaceRootIdentity, stat) ||
      !samePath(this.workspaceRoot, canonical, this._platform, this._path) ||
      workspaceIdentity(this.workspaceRoot, stat) !== this.workspaceIdentity
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WORKSPACE_MISMATCH,
        "Checkpoint restore workspace authority changed identity",
        null,
        { workspaceRoot: this.workspaceRoot },
      );
    }
  }

  _operationDirectory(operationId) {
    const safeOperationId = assertOperationId(operationId);
    const directory = this._path.join(this.stateRoot, safeOperationId);
    if (
      !pathContains(this.stateRoot, directory, this._platform, this._path) ||
      samePath(this.stateRoot, directory, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga operation path escapes the state root",
      );
    }
    return directory;
  }

  _archiveDirectory(operationId) {
    const safeOperationId = assertOperationId(operationId);
    const directory = this._path.join(this.archiveRoot, safeOperationId);
    if (
      !pathContains(this.archiveRoot, directory, this._platform, this._path) ||
      samePath(this.archiveRoot, directory, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga archive path escapes its workspace shard",
      );
    }
    return directory;
  }

  _purgeDirectory(operationId) {
    const safeOperationId = assertOperationId(operationId);
    const directory = this._path.join(this.purgeRoot, safeOperationId);
    if (
      !pathContains(this.purgeRoot, directory, this._platform, this._path) ||
      samePath(this.purgeRoot, directory, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga purge path escapes its workspace shard",
      );
    }
    return directory;
  }

  _purgeReceiptPath(operationId) {
    const safeOperationId = assertOperationId(operationId);
    const filePath = this._path.join(
      this.purgeReceiptRoot,
      `${safeOperationId}.json`,
    );
    if (
      !pathContains(
        this.purgeReceiptRoot,
        filePath,
        this._platform,
        this._path,
      ) ||
      samePath(this.purgeReceiptRoot, filePath, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga purge receipt path escapes its workspace shard",
      );
    }
    return filePath;
  }

  _scanPurgeReceipts() {
    const names = this._readDirectoryNamesBounded(
      this.purgeReceiptRoot,
      this._maxSagas * 2 + 1,
      "Checkpoint restore purge receipts exceed their bound",
    );
    const operationIds = [];
    const temporaryFiles = [];
    for (const name of names) {
      const receiptMatch = PURGE_RECEIPT_FILE_PATTERN.exec(name);
      if (receiptMatch) {
        operationIds.push(receiptMatch[1]);
        continue;
      }
      const temporaryMatch = PURGE_RECEIPT_TEMPORARY_FILE_PATTERN.exec(name);
      if (temporaryMatch) {
        this._assertSafeOrphanTemporary(
          this._path.join(this.purgeReceiptRoot, name),
          MAX_PURGE_RECEIPT_BYTES,
        );
        temporaryFiles.push(
          Object.freeze({ operationId: temporaryMatch[1], name }),
        );
        continue;
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Checkpoint restore purge receipt root contains an unexpected entry",
        null,
        { name },
      );
    }
    operationIds.sort();
    temporaryFiles.sort((left, right) => left.name.localeCompare(right.name));
    return Object.freeze({
      operationIds: Object.freeze(operationIds),
      temporaryFiles: Object.freeze(temporaryFiles),
    });
  }

  _scanOperationNames(directory, controls = []) {
    const names = this._readDirectoryNamesBounded(
      directory,
      this._maxSagas + controls.length + 1,
      "Checkpoint restore workspace shard exceeds its saga bound",
    );
    const controlSet = new Set(controls);
    const operationIds = [];
    for (const name of names) {
      if (controlSet.has(name)) continue;
      if (!OPERATION_ID_PATTERN.test(name)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Checkpoint restore workspace shard contains an unexpected entry",
          null,
          { directory, name },
        );
      }
      operationIds.push(name);
    }
    return operationIds.sort();
  }

  _assertShardCapacity(operationId) {
    const active = this._scanOperationNames(this.stateRoot, [
      ".locks",
      ".archive",
      ".purge",
      ".purged",
    ]);
    const archived = this._scanOperationNames(this.archiveRoot);
    const purging = this._scanOperationNames(this.purgeRoot);
    const purgeReceipts = this._scanPurgeReceipts();
    if (
      purgeReceipts.temporaryFiles.some(
        (temporary) => temporary.operationId === operationId,
      )
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Checkpoint restore operationId has an unresolved purge receipt temporary",
        null,
        { operationId },
      );
    }
    if (
      archived.includes(operationId) ||
      purging.includes(operationId) ||
      purgeReceipts.operationIds.includes(operationId)
    ) {
      if (purgeReceipts.operationIds.includes(operationId)) {
        this._readPurgeReceipt(operationId);
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS,
        "Checkpoint restore operationId is already retained in the archive",
        null,
        { operationId },
      );
    }
    const retainedOperationIds = new Set([
      ...active,
      ...archived,
      ...purging,
      ...purgeReceipts.operationIds,
    ]);
    if (
      !active.includes(operationId) &&
      retainedOperationIds.size >= this._maxSagas
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
        "Checkpoint restore workspace shard retention limit reached",
        null,
        {
          activeCount: active.length,
          archivedCount: archived.length,
          purgingCount: purging.length,
          purgeReceiptCount: purgeReceipts.operationIds.length,
          maximum: this._maxSagas,
        },
      );
    }
  }

  _withStateLock(lockName, operationId, callback, { timeoutMs } = {}) {
    this._assertStoreAuthority();
    const target = this._path.join(this.lockRoot, lockName);
    try {
      this._inspectStateLockTarget(target);
      const result = this._withFileLock(
        target,
        (context) => {
          this._inspectStateLockTarget(target, { requireOwner: true });
          return callback(context);
        },
        {
          _fs: this._fs,
          failIfUnavailable: true,
          timeoutMs: Number.isSafeInteger(timeoutMs)
            ? Math.max(1, Math.min(this._lockTimeoutMs, timeoutMs))
            : this._lockTimeoutMs,
          retryMs: this._lockRetryMs,
          maxRetryMs: Math.max(this._lockRetryMs, 32),
          retryJitterMs: Math.min(4, this._lockRetryMs),
        },
      );
      this._inspectStateLockTarget(target);
      return result;
    } catch (cause) {
      if (isSagaError(cause)) throw cause;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Could not serialize checkpoint restore saga access",
        cause,
        { operationId },
      );
    }
  }

  _inspectStateLockTarget(target, { requireOwner = false } = {}) {
    const lockDirectory = `${target}.lock`;
    let lockStat;
    let canonical;
    try {
      lockStat = this._fs.lstatSync(lockDirectory, { bigint: true });
      canonical = this._fs.realpathSync.native(lockDirectory);
    } catch (cause) {
      if (cause?.code === "ENOENT" && !requireOwner) return null;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock owner is unavailable",
        cause,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    if (
      lockStat.isSymbolicLink() ||
      !lockStat.isDirectory() ||
      !pathContains(this.lockRoot, lockDirectory, this._platform, this._path) ||
      !samePath(lockDirectory, canonical, this._platform, this._path)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock path is unsafe",
        null,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    let names;
    try {
      names = this._readDirectoryNamesBounded(
        lockDirectory,
        2,
        "Saga state lock contains too many entries",
      );
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock entries are unsafe",
        cause,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    if (!names.includes("owner.json")) {
      if (!requireOwner && names.length === 0) return null;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock has no complete owner",
        null,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    if (names.length !== 1) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock contains unexpected ownership markers",
        null,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    const ownerPath = this._path.join(lockDirectory, "owner.json");
    let ownerStat;
    let owner;
    try {
      ownerStat = this._fs.lstatSync(ownerPath, { bigint: true });
      if (
        ownerStat.isSymbolicLink() ||
        !ownerStat.isFile() ||
        ownerStat.nlink !== 1n ||
        ownerStat.size <= 0n ||
        ownerStat.size > BigInt(MAX_STATE_LOCK_OWNER_BYTES) ||
        (this._platform !== "win32" && (Number(ownerStat.mode) & 0o077) !== 0)
      ) {
        throw new Error("unsafe owner file");
      }
      owner = JSON.parse(this._readBoundedRegularFile(ownerPath));
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock owner is corrupt or unbounded",
        cause,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    if (
      !hasExactKeys(owner, STATE_LOCK_OWNER_KEYS) ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      !Number.isFinite(owner.startedAt) ||
      typeof owner.token !== "string" ||
      !/^[a-zA-Z0-9-]{16,128}$/.test(owner.token)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED,
        "Saga state lock owner has an invalid shape",
        null,
        { lockDirectory, lockState: "corrupt" },
      );
    }
    return Object.freeze({ ...owner });
  }

  _withOperationLock(operationId, callback, options = {}) {
    const safeOperationId = assertOperationId(operationId);
    return this._withStateLock(
      safeOperationId,
      safeOperationId,
      callback,
      options,
    );
  }

  _withShardMaintenanceLock(callback, options = {}) {
    return this._withStateLock(
      ".shard-maintenance",
      "workspace-shard",
      callback,
      options,
    );
  }

  _assertOperationDirectory(operationId, { mustExist = true } = {}) {
    const directory = this._operationDirectory(operationId);
    let stat;
    let canonical;
    try {
      stat = this._fs.lstatSync(directory, { bigint: true });
      canonical = this._fs.realpathSync.native(directory);
    } catch (cause) {
      if (cause?.code === "ENOENT" && !mustExist) return null;
      if (cause?.code === "ENOENT") {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
          "Checkpoint restore saga does not exist",
          cause,
          { operationId },
        );
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Could not inspect checkpoint restore saga directory",
        cause,
        { operationId },
      );
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      !samePath(directory, canonical, this._platform, this._path) ||
      (this._platform !== "win32" && (Number(stat.mode) & 0o077) !== 0)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Checkpoint restore saga directory is unsafe",
        null,
        { operationId, directory },
      );
    }
    return { directory, identity: statIdentity(stat) };
  }

  _assertRetainedOperationDirectory(
    root,
    operationId,
    label,
    { mustExist = true } = {},
  ) {
    const directory = this._path.join(root, assertOperationId(operationId));
    if (!pathContains(root, directory, this._platform, this._path)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} path escapes its authority`,
        null,
        { operationId },
      );
    }
    let stat;
    let canonical;
    try {
      stat = this._fs.lstatSync(directory, { bigint: true });
      canonical = this._fs.realpathSync.native(directory);
    } catch (cause) {
      if (cause?.code === "ENOENT" && !mustExist) return null;
      throw sagaError(
        cause?.code === "ENOENT"
          ? CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND
          : CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} directory is unavailable`,
        cause,
        { operationId, directory },
      );
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      !samePath(directory, canonical, this._platform, this._path) ||
      (this._platform !== "win32" && (Number(stat.mode) & 0o077) !== 0)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        `${label} directory is unsafe`,
        null,
        { operationId, directory },
      );
    }
    return { directory, identity: statIdentity(stat) };
  }

  _eventPath(directory, seq, phase) {
    const fileName = `${String(seq).padStart(6, "0")}-${phase}.json`;
    const filePath = this._path.join(directory, fileName);
    if (!pathContains(directory, filePath, this._platform, this._path)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga event path escapes its operation directory",
      );
    }
    return filePath;
  }

  _headPath(directory) {
    const filePath = this._path.join(directory, HEAD_FILE_NAME);
    if (!pathContains(directory, filePath, this._platform, this._path)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH,
        "Saga HEAD path escapes its operation directory",
      );
    }
    return filePath;
  }

  _readDirectoryNamesBounded(directory, maximum, message) {
    let handle = null;
    const names = [];
    try {
      handle = this._fs.opendirSync(directory);
      for (;;) {
        const entry = handle.readSync();
        if (!entry) break;
        names.push(entry.name);
        if (names.length > maximum) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
            message,
            null,
            { directory, maximum },
          );
        }
      }
      return names;
    } catch (cause) {
      if (isSagaError(cause)) throw cause;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        message,
        cause,
        { directory, maximum },
      );
    } finally {
      if (handle) {
        try {
          handle.closeSync();
        } catch {
          // The bounded enumeration already succeeded or failed closed.
        }
      }
    }
  }

  _assertSafeOrphanTemporary(
    filePath,
    maxBytes = MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES,
  ) {
    let entry;
    try {
      entry = this._fs.lstatSync(filePath, { bigint: true });
    } catch (cause) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Could not inspect orphan saga temporary file",
        cause,
        { filePath },
      );
    }
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.nlink !== 1n ||
      entry.size < 0n ||
      entry.size > BigInt(maxBytes) ||
      (this._platform !== "win32" && (Number(entry.mode) & 0o077) !== 0)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Orphan saga temporary is not a bounded owner-private regular file",
        null,
        { filePath },
      );
    }
  }

  _classifyOperationEntries(authority) {
    const names = this._readDirectoryNamesBounded(
      authority.directory,
      MAX_DIRECTORY_ENTRIES,
      "Saga operation directory exceeds its bounded entry limit",
    );
    const files = [];
    const orphanTemporaryFiles = [];
    let headFile = null;
    for (const name of names) {
      if (name === HEAD_FILE_NAME) {
        headFile = this._headPath(authority.directory);
        continue;
      }
      const eventMatch = EVENT_FILE_PATTERN.exec(name);
      if (eventMatch) {
        files.push({
          name,
          seq: Number(eventMatch[1]),
          phase: eventMatch[2],
          filePath: this._path.join(authority.directory, name),
        });
        continue;
      }
      const temporaryMatch = TEMPORARY_FILE_PATTERN.exec(name);
      if (
        temporaryMatch &&
        Number(temporaryMatch[1]) >= 1 &&
        Number(temporaryMatch[1]) <= MAX_CHECKPOINT_RESTORE_SAGA_EVENTS &&
        PHASE_SET.has(temporaryMatch[2])
      ) {
        if (orphanTemporaryFiles.length >= MAX_ORPHAN_TEMPORARY_FILES) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
            "Saga has too many orphan temporary files",
            null,
            { directory: authority.directory },
          );
        }
        this._assertSafeOrphanTemporary(
          this._path.join(authority.directory, name),
        );
        orphanTemporaryFiles.push(name);
        continue;
      }
      if (HEAD_TEMPORARY_FILE_PATTERN.test(name)) {
        if (orphanTemporaryFiles.length >= MAX_ORPHAN_TEMPORARY_FILES) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
            "Saga has too many orphan temporary files",
            null,
            { directory: authority.directory },
          );
        }
        this._assertSafeOrphanTemporary(
          this._path.join(authority.directory, name),
          MAX_HEAD_BYTES,
        );
        orphanTemporaryFiles.push(name);
        continue;
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga contains an unexpected file",
        null,
        { directory: authority.directory, name },
      );
    }
    files.sort((left, right) =>
      left.seq === right.seq
        ? left.name.localeCompare(right.name)
        : left.seq - right.seq,
    );
    orphanTemporaryFiles.sort();
    return { files, headFile, orphanTemporaryFiles };
  }

  _removeOrphanTemporaries(authority, names) {
    if (names.length === 0) return;
    for (const name of names) {
      if (this._path.basename(name) !== name) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga orphan temporary path is not canonical",
          null,
          { operationId: this._path.basename(authority.directory) },
        );
      }
      const filePath = this._path.join(authority.directory, name);
      const maximum = name.startsWith(".HEAD.")
        ? MAX_HEAD_BYTES
        : MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES;
      this._assertSafeOrphanTemporary(filePath, maximum);
      const before = this._fs.lstatSync(filePath, { bigint: true });
      const directoryBefore = this._fs.lstatSync(authority.directory, {
        bigint: true,
      });
      if (
        !sameIdentity(authority.identity, directoryBefore) ||
        !samePath(
          filePath,
          this._fs.realpathSync.native(filePath),
          this._platform,
          this._path,
        )
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga orphan temporary changed authority before cleanup",
          null,
          { filePath },
        );
      }
      const settled = this._fs.lstatSync(filePath, { bigint: true });
      if (!sameIdentity(statIdentity(before), settled)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga orphan temporary changed identity before cleanup",
          null,
          { filePath },
        );
      }
      try {
        this._fs.unlinkSync(filePath);
      } catch (cause) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
          "Could not remove an uncommitted saga temporary",
          cause,
          { filePath, commitState: "orphan_cleanup_unknown" },
        );
      }
    }
    this._syncDirectoryBestEffort(authority.directory);
  }

  _readBoundedRegularFile(
    filePath,
    maxBytes = MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES,
    readBudget = null,
  ) {
    try {
      const initialPathStat = this._fs.lstatSync(filePath, { bigint: true });
      if (
        initialPathStat.isSymbolicLink() ||
        !initialPathStat.isFile() ||
        initialPathStat.nlink !== 1n ||
        initialPathStat.size <= 0n ||
        initialPathStat.size > BigInt(maxBytes) ||
        (this._platform !== "win32" &&
          (Number(initialPathStat.mode) & 0o077) !== 0)
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga event is not a bounded owner-private regular file",
          null,
          { filePath },
        );
      }
      if (readBudget) {
        const byteLength = Number(initialPathStat.size);
        if (
          this._wallClock() > readBudget.deadline ||
          byteLength > readBudget.remainingBytes
        ) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
            "Saga listing exceeded its bounded replay budget",
            null,
            { filePath, budgetExceeded: true },
          );
        }
        readBudget.remainingBytes -= byteLength;
      }
      return this._secureFileParent(
        this._fs,
        filePath,
        ({ canonicalPath, parentDevice }) => {
          if (!samePath(filePath, canonicalPath, this._platform, this._path)) {
            throw new Error("Saga event parent resolves to another path");
          }
          const pathBefore = this._fs.lstatSync(canonicalPath, {
            bigint: true,
          });
          if (
            pathBefore.isSymbolicLink() ||
            !pathBefore.isFile() ||
            pathBefore.nlink !== 1n ||
            !sameFileStatIdentity(initialPathStat, pathBefore)
          ) {
            throw new Error("Saga event path changed before opening");
          }

          const flags =
            Number(
              this._fs.constants?.O_RDONLY ?? fsDefault.constants.O_RDONLY,
            ) |
            Number(
              this._fs.constants?.O_NOFOLLOW ??
                fsDefault.constants.O_NOFOLLOW ??
                0,
            );
          let descriptor = null;
          try {
            descriptor = this._fs.openSync(canonicalPath, flags);
            const handleBefore = this._fs.fstatSync(descriptor, {
              bigint: true,
            });
            if (
              !handleBefore.isFile() ||
              handleBefore.nlink !== 1n ||
              !samePathHandleFileIdentity(
                pathBefore,
                handleBefore,
                parentDevice,
                this._runtime,
              )
            ) {
              throw new Error("Saga event identity changed while opening");
            }

            const capacity = Math.min(
              maxBytes + 1,
              Number(handleBefore.size) + 1,
            );
            const buffer = Buffer.alloc(capacity);
            let total = 0;
            while (total < capacity) {
              const bytesRead = this._fs.readSync(
                descriptor,
                buffer,
                total,
                capacity - total,
                null,
              );
              if (bytesRead === 0) break;
              total += bytesRead;
            }

            const handleAfter = this._fs.fstatSync(descriptor, {
              bigint: true,
            });
            const pathAfter = this._fs.lstatSync(canonicalPath, {
              bigint: true,
            });
            const serialized = buffer.subarray(0, total).toString("utf8");
            if (
              total > maxBytes ||
              BigInt(total) !== handleAfter.size ||
              Buffer.byteLength(serialized, "utf8") !== total ||
              pathAfter.isSymbolicLink() ||
              !pathAfter.isFile() ||
              pathAfter.nlink !== 1n ||
              !sameFileStatIdentity(handleBefore, handleAfter) ||
              !sameFileStatIdentity(pathBefore, pathAfter) ||
              !samePathHandleFileIdentity(
                pathAfter,
                handleAfter,
                parentDevice,
                this._runtime,
              )
            ) {
              throw new Error("Saga event changed while reading");
            }
            return serialized;
          } finally {
            if (descriptor != null) {
              try {
                this._fs.closeSync(descriptor);
              } catch {
                // The bounded read has already succeeded or failed closed.
              }
            }
          }
        },
        { runtime: this._runtime },
      );
    } catch (cause) {
      if (isSagaError(cause)) throw cause;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Could not safely read saga event",
        cause,
        { filePath },
      );
    }
  }

  _validateHead(value, operationId, expectedWorkspaceIdentity) {
    if (
      !hasExactKeys(value, HEAD_KEYS) ||
      value.schema !== HEAD_SCHEMA ||
      value.version !== HEAD_VERSION ||
      value.operationId !== operationId ||
      value.workspaceIdentity !== expectedWorkspaceIdentity ||
      value.anchorHash !== headAnchorHash(value)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga HEAD failed schema, authority, or hash validation",
        null,
        { operationId },
      );
    }
    if (value.state === "unpublished") {
      if (
        value.seq !== 0 ||
        value.phase !== null ||
        value.eventFile !== null ||
        value.eventHash !== null ||
        value.prevHash !== null
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga unpublished HEAD is not a canonical genesis anchor",
          null,
          { operationId },
        );
      }
      return Object.freeze({ ...value });
    }
    if (
      value.state !== "committed" ||
      !Number.isSafeInteger(value.seq) ||
      value.seq < 1 ||
      value.seq > MAX_CHECKPOINT_RESTORE_SAGA_EVENTS ||
      !PHASE_SET.has(value.phase) ||
      value.eventFile !==
        `${String(value.seq).padStart(6, "0")}-${value.phase}.json` ||
      !HASH_PATTERN.test(String(value.eventHash || "")) ||
      !(
        value.prevHash === null ||
        HASH_PATTERN.test(String(value.prevHash || ""))
      ) ||
      (value.seq === 1 ? value.prevHash !== null : value.prevHash === null)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga committed HEAD is not canonical",
        null,
        { operationId },
      );
    }
    return Object.freeze({ ...value });
  }

  _readHead(
    filePath,
    operationId,
    expectedWorkspaceIdentity,
    readBudget = null,
  ) {
    let parsed;
    try {
      parsed = JSON.parse(
        this._readBoundedRegularFile(filePath, MAX_HEAD_BYTES, readBudget),
      );
    } catch (cause) {
      if (isSagaError(cause)) throw cause;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga HEAD is not valid JSON",
        cause,
        { operationId, filePath },
      );
    }
    return this._validateHead(parsed, operationId, expectedWorkspaceIdentity);
  }

  _validatePhaseEvidence(
    operationId,
    phase,
    evidence,
    { replay = false } = {},
  ) {
    const errorCode = replay
      ? CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT
      : CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE;
    const ownerRequired = phase === "locked" || phase === "recovery_started";
    const owner = evidence.workspaceLockOwner;
    const ownerDigest = evidence.lockOwnerDigest;
    const missing = (REQUIRED_EVIDENCE_BY_PHASE[phase] || []).filter(
      (key) => !Object.hasOwn(evidence, key),
    );
    if (missing.length > 0) {
      throw sagaError(
        errorCode,
        `${phase} requires durable evidence: ${missing.join(", ")}`,
      );
    }
    if (phase === "intent_committed") {
      const hasSessionBinding =
        Object.hasOwn(evidence, "sessionId") ||
        Object.hasOwn(evidence, "timelineEntryId");
      const intentAuthority = evidence.intentAuthority;
      if (!hasSessionBinding && intentAuthority !== "operation") {
        throw sagaError(
          errorCode,
          "intent_committed requires session authority or an explicit operation-local authority",
        );
      }
      if (intentAuthority === "session" && !hasSessionBinding) {
        throw sagaError(
          errorCode,
          "session intent authority requires a sessionId or timelineEntryId",
        );
      }
      if (intentAuthority === "operation" && hasSessionBinding) {
        throw sagaError(
          errorCode,
          "operation-local intent authority cannot claim a session binding",
        );
      }
    }
    if (
      (ownerRequired && (!owner || !ownerDigest)) ||
      (!ownerRequired && (owner || ownerDigest))
    ) {
      throw sagaError(
        errorCode,
        ownerRequired
          ? `${phase} requires the complete workspace lock owner and its digest`
          : `${phase} must not persist workspace lock owner evidence`,
      );
    }
    if (
      owner &&
      (owner.transactionId !== operationId ||
        owner.workspaceRoot !== this.workspaceRoot)
    ) {
      throw sagaError(
        errorCode,
        "Workspace lock owner is not exactly bound to this saga authority",
      );
    }
    if (
      owner &&
      ownerDigest !== computeCheckpointRestoreWorkspaceLockOwnerDigest(owner)
    ) {
      throw sagaError(
        errorCode,
        "Workspace lock owner digest does not match the complete owner",
      );
    }
  }

  _validateEvidenceProgression(events, event, { replay = false } = {}) {
    const errorCode = replay
      ? CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT
      : CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE;
    if (event.phase === "mutation_started") {
      const prepared = [...events]
        .reverse()
        .find((entry) => entry.phase === "prepared");
      const safety = [...events]
        .reverse()
        .find((entry) => entry.phase === "safety_ready");
      if (
        !prepared ||
        !safety ||
        safety.evidence.safetyCoverage !== "full" ||
        event.evidence.targetCount !== prepared.evidence.targetCount
      ) {
        throw sagaError(
          errorCode,
          "mutation_started requires full safety coverage and the prepared target count",
        );
      }
    }
    if (event.phase === "workspace_applied") {
      const previous = events.at(-1);
      if (previous?.phase === "intent_committed") {
        const prepared = [...events]
          .reverse()
          .find((entry) => entry.phase === "prepared");
        if (
          !prepared ||
          prepared.evidence.targetCount !== 0 ||
          event.evidence.appliedCount !== 0
        ) {
          throw sagaError(
            errorCode,
            "workspace_applied may bypass mutation only for an exact zero-target restore",
          );
        }
        return;
      }
      const mutation = [...events]
        .reverse()
        .find((entry) => entry.phase === "mutation_started");
      if (
        !mutation ||
        event.evidence.appliedCount !== mutation.evidence.targetCount
      ) {
        throw sagaError(
          errorCode,
          "workspace_applied must prove that every planned target was applied",
        );
      }
    }
  }

  _validateEvent(value, file, expectedSeq, previous) {
    if (
      !hasExactKeys(value, [
        "schema",
        "version",
        "operationId",
        "seq",
        "prevHash",
        "phase",
        "timestamp",
        "evidence",
        "hash",
      ]) ||
      value.schema !== CHECKPOINT_RESTORE_SAGA_SCHEMA ||
      value.version !== CHECKPOINT_RESTORE_SAGA_VERSION ||
      value.operationId !== file.operationId ||
      value.seq !== expectedSeq ||
      value.seq !== file.seq ||
      value.phase !== file.phase ||
      !PHASE_SET.has(value.phase) ||
      !Number.isSafeInteger(value.timestamp) ||
      value.timestamp < 0 ||
      !HASH_PATTERN.test(String(value.hash || ""))
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga event failed schema or filename validation",
        null,
        { filePath: file.filePath },
      );
    }
    const expectedPrevHash = previous?.hash || null;
    if (
      value.prevHash !== expectedPrevHash ||
      value.hash !== eventHash(value) ||
      (previous && value.timestamp < previous.timestamp) ||
      (expectedSeq === 1 && value.phase !== "created") ||
      (previous && !TRANSITIONS.get(previous.phase)?.has(value.phase))
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga event chain or transition is invalid",
        null,
        { filePath: file.filePath },
      );
    }
    const evidence = normalizeEvidence(value.evidence, { replay: true });
    if (
      expectedSeq === 1 &&
      (typeof evidence.workspaceRoot !== "string" ||
        typeof evidence.workspaceIdentity !== "string")
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Created saga event is missing workspace authority",
      );
    }
    this._validatePhaseEvidence(value.operationId, value.phase, evidence, {
      replay: true,
    });
    if (
      expectedSeq > 1 &&
      (Object.hasOwn(evidence, "workspaceRoot") ||
        Object.hasOwn(evidence, "workspaceIdentity"))
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Workspace authority is only valid on the created event",
      );
    }
    return Object.freeze({ ...value, evidence });
  }

  _readOperationUnlocked(
    operationId,
    { allowOtherWorkspace = false, readBudget = null } = {},
  ) {
    const authority = this._assertOperationDirectory(operationId);
    const archived = this._assertRetainedOperationDirectory(
      this.archiveRoot,
      operationId,
      "Saga archive",
      { mustExist: false },
    );
    const purging = this._assertRetainedOperationDirectory(
      this.purgeRoot,
      operationId,
      "Saga purge",
      { mustExist: false },
    );
    const purgeReceiptState = this._readPurgeReceipt(operationId, {
      mustExist: false,
      readBudget,
    });
    if (archived || purging || purgeReceiptState) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga operationId exists in multiple retention states",
        null,
        { operationId },
      );
    }
    return this._readOperationFromAuthority(operationId, authority, {
      allowOtherWorkspace,
      readBudget,
    });
  }

  _readOperationFromAuthority(
    operationId,
    authority,
    { allowOtherWorkspace = false, readBudget = null } = {},
  ) {
    const { files, headFile, orphanTemporaryFiles } =
      this._secureOperationAuthority(operationId, authority);
    if (
      files.length === 0 ||
      files.length > MAX_CHECKPOINT_RESTORE_SAGA_EVENTS
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga event count is empty or exceeds its bound",
        null,
        { operationId },
      );
    }
    if (readBudget) {
      if (
        this._wallClock() > readBudget.deadline ||
        files.length > readBudget.remainingEvents
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
          "Saga listing exceeded its bounded replay budget",
          null,
          { operationId, budgetExceeded: true },
        );
      }
      readBudget.remainingEvents -= files.length;
    }
    const events = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = { ...files[index], operationId };
      let parsed;
      try {
        parsed = JSON.parse(
          this._readBoundedRegularFile(
            file.filePath,
            MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES,
            readBudget,
          ),
        );
      } catch (cause) {
        if (isSagaError(cause)) throw cause;
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga event is not valid JSON",
          cause,
          { filePath: file.filePath },
        );
      }
      events.push(
        this._validateEvent(parsed, file, index + 1, events[index - 1]),
      );
      this._validateEvidenceProgression(
        events.slice(0, -1),
        events[events.length - 1],
        { replay: true },
      );
    }
    if (!headFile) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga HEAD is missing from a published event chain",
        null,
        { operationId },
      );
    }
    const authorityWorkspaceIdentity = events[0].evidence.workspaceIdentity;
    let head = this._readHead(
      headFile,
      operationId,
      authorityWorkspaceIdentity,
      readBudget,
    );
    if (head.state === "unpublished") {
      if (events.length !== 1) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga genesis HEAD is separated from more than one event",
          null,
          { operationId, eventCount: events.length },
        );
      }
      const reconciled = committedHead(
        operationId,
        authorityWorkspaceIdentity,
        events[0],
      );
      this._writeHead(authority.directory, reconciled);
      head = Object.freeze(reconciled);
    } else {
      if (head.seq > events.length || events.length - head.seq > 1) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga HEAD and event chain differ by an impossible sequence window",
          null,
          { operationId, headSeq: head.seq, eventCount: events.length },
        );
      }
      const anchoredEvent = events[head.seq - 1];
      const anchoredFile = files[head.seq - 1];
      if (
        !anchoredEvent ||
        !anchoredFile ||
        head.phase !== anchoredEvent.phase ||
        head.eventFile !== anchoredFile.name ||
        head.eventHash !== anchoredEvent.hash ||
        head.prevHash !== anchoredEvent.prevHash
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga HEAD does not match its anchored event",
          null,
          { operationId, headSeq: head.seq },
        );
      }
      if (events.length === head.seq + 1) {
        const reconciled = committedHead(
          operationId,
          authorityWorkspaceIdentity,
          events[events.length - 1],
        );
        this._writeHead(authority.directory, reconciled);
        head = Object.freeze(reconciled);
      }
    }
    const chainTail = events[events.length - 1];
    if (head.seq !== chainTail.seq || head.eventHash !== chainTail.hash) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga HEAD did not settle at the validated chain tail",
        null,
        { operationId, headSeq: head.seq, eventCount: events.length },
      );
    }
    const directoryAfter = this._fs.lstatSync(authority.directory, {
      bigint: true,
    });
    if (!sameIdentity(authority.identity, directoryAfter)) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga operation directory changed while reading",
        null,
        { operationId },
      );
    }
    let saga = frozenSaga(operationId, events, orphanTemporaryFiles);
    if (
      !allowOtherWorkspace &&
      (!samePath(
        saga.workspaceRoot,
        this.workspaceRoot,
        this._platform,
        this._path,
      ) ||
        saga.workspaceIdentity !== this.workspaceIdentity)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WORKSPACE_MISMATCH,
        "Saga is not bound to the current workspace authority",
        null,
        { operationId },
      );
    }
    if (orphanTemporaryFiles.length > 0) {
      this._removeOrphanTemporaries(authority, orphanTemporaryFiles);
      saga = frozenSaga(operationId, events, []);
    }
    return saga;
  }

  _syncDirectoryBestEffort(directory) {
    if (this._platform === "win32") return;
    let descriptor = null;
    try {
      descriptor = this._fs.openSync(directory, "r");
      this._fs.fsyncSync(descriptor);
    } catch {
      // The event has already crossed its atomic commit point. Directory
      // durability is explicitly best-effort on POSIX and unavailable through
      // Node's fs API on Windows, so callers must not retry the append here.
    } finally {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Best-effort cleanup after the commit point.
        }
      }
    }
  }

  _writeEvent(directory, event) {
    this._assertStoreAuthority();
    const filePath = this._eventPath(directory, event.seq, event.phase);
    const temporaryPath = this._path.join(
      directory,
      `.${this._path.basename(filePath)}.${process.pid}.${this._randomUUID()}.tmp`,
    );
    const contents = `${JSON.stringify(event, null, 2)}\n`;
    if (
      Buffer.byteLength(contents, "utf8") >
      MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
        "Saga event exceeds the durable size limit",
      );
    }
    let descriptor = null;
    let renamed = false;
    let renameAttempted = false;
    try {
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      this._fs.writeFileSync(descriptor, contents, "utf8");
      this._fs.fsyncSync(descriptor);
      this._fs.closeSync(descriptor);
      descriptor = null;
      this._secureWindowsFileBeforeRename(
        temporaryPath,
        MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES,
        "saga event temporary authority",
        event.operationId,
      );
      if (this._beforeRename) {
        this._beforeRename({ temporaryPath, filePath, event });
      }
      if (this._fs.existsSync(filePath)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
          "Saga event sequence is already committed",
          null,
          { filePath },
        );
      }
      renameAttempted = true;
      this._fs.renameSync(temporaryPath, filePath);
      renamed = true;
      const persisted = JSON.parse(this._readBoundedRegularFile(filePath));
      if (
        persisted.hash !== event.hash ||
        eventHash(persisted) !== event.hash
      ) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Published saga event does not match the intended append",
          null,
          { filePath },
        );
      }
      this._syncDirectoryBestEffort(directory);
    } catch (cause) {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Preserve the primary append failure.
        }
      }
      if (!renamed) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // A failed cleanup intentionally leaves fail-closed recovery evidence.
        }
      }
      const commitDetails = {
        commitState: renameAttempted
          ? "event_commit_unknown"
          : "event_not_committed",
        intendedSeq: event.seq,
        intendedHash: event.hash,
      };
      if (isSagaError(cause)) {
        throw attachCommitState(cause, commitDetails);
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
        "Could not atomically append checkpoint restore saga event",
        cause,
        { filePath, temporaryPath, ...commitDetails },
      );
    }
  }

  _writeHead(directory, head, { createOnly = false } = {}) {
    this._assertStoreAuthority();
    this._validateHead(head, head.operationId, head.workspaceIdentity);
    const filePath = this._headPath(directory);
    const temporaryPath = this._path.join(
      directory,
      `.HEAD.${process.pid}.${this._randomUUID()}.tmp`,
    );
    const contents = `${JSON.stringify(head, null, 2)}\n`;
    if (Buffer.byteLength(contents, "utf8") > MAX_HEAD_BYTES) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
        "Saga HEAD exceeds the durable size limit",
      );
    }
    let descriptor = null;
    let renamed = false;
    let renameAttempted = false;
    try {
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      this._fs.writeFileSync(descriptor, contents, "utf8");
      this._fs.fsyncSync(descriptor);
      this._fs.closeSync(descriptor);
      descriptor = null;
      this._secureWindowsFileBeforeRename(
        temporaryPath,
        MAX_HEAD_BYTES,
        "saga HEAD temporary authority",
        head.operationId,
      );
      if (this._beforeHeadRename) {
        this._beforeHeadRename({ temporaryPath, filePath, head });
      }
      const exists = this._fs.existsSync(filePath);
      if ((createOnly && exists) || (!createOnly && !exists)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
          createOnly
            ? "Saga HEAD is already published"
            : "Saga HEAD disappeared before settlement",
          null,
          { filePath, seq: head.seq, eventHash: head.eventHash },
        );
      }
      renameAttempted = true;
      this._fs.renameSync(temporaryPath, filePath);
      renamed = true;
      const persisted = this._readHead(
        filePath,
        head.operationId,
        head.workspaceIdentity,
      );
      if (canonicalJson(persisted) !== canonicalJson(head)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Published saga HEAD does not match the intended settlement",
          null,
          { filePath, seq: head.seq, eventHash: head.eventHash },
        );
      }
      this._syncDirectoryBestEffort(directory);
    } catch (cause) {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Preserve the primary settlement failure.
        }
      }
      if (!renamed) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // A failed cleanup intentionally leaves fail-closed recovery evidence.
        }
      }
      const commitDetails = {
        commitState:
          head.seq === 0
            ? renameAttempted
              ? "genesis_unknown"
              : "genesis_not_committed"
            : renameAttempted
              ? "head_settlement_unknown"
              : "event_committed_head_unsettled",
        intendedSeq: head.seq,
        intendedHash: head.eventHash,
      };
      if (isSagaError(cause)) {
        throw attachCommitState(cause, commitDetails);
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
        "Could not atomically settle checkpoint restore saga HEAD",
        cause,
        {
          filePath,
          temporaryPath,
          ...commitDetails,
        },
      );
    }
  }

  _newEvent(operationId, seq, prevHash, phase, evidence, minimumTimestamp = 0) {
    const clockValue = this._now();
    if (!Number.isSafeInteger(clockValue) || clockValue < 0) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
        "Saga timestamp source returned an invalid value",
      );
    }
    const timestamp = Math.max(clockValue, minimumTimestamp);
    let normalizedEvidence = normalizeEvidence(evidence);
    if (
      (phase === "locked" || phase === "recovery_started") &&
      normalizedEvidence.workspaceLockOwner &&
      !normalizedEvidence.lockOwnerDigest
    ) {
      normalizedEvidence = normalizeEvidence({
        ...normalizedEvidence,
        lockOwnerDigest: computeCheckpointRestoreWorkspaceLockOwnerDigest(
          normalizedEvidence.workspaceLockOwner,
        ),
      });
    }
    if (
      seq > 1 &&
      (Object.hasOwn(normalizedEvidence, "workspaceRoot") ||
        Object.hasOwn(normalizedEvidence, "workspaceIdentity"))
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
        "Workspace authority evidence is only valid on the created event",
      );
    }
    this._validatePhaseEvidence(operationId, phase, normalizedEvidence);
    const event = {
      schema: CHECKPOINT_RESTORE_SAGA_SCHEMA,
      version: CHECKPOINT_RESTORE_SAGA_VERSION,
      operationId,
      seq,
      prevHash,
      phase,
      timestamp,
      evidence: normalizedEvidence,
      hash: null,
    };
    event.hash = eventHash(event);
    return event;
  }

  _readPurgeReceipt(operationId, { mustExist = true, readBudget = null } = {}) {
    const safeOperationId = assertOperationId(operationId);
    const filePath = this._purgeReceiptPath(safeOperationId);
    if (!this._fs.existsSync(filePath)) {
      if (!mustExist) return null;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
        "Checkpoint restore purge receipt does not exist",
        null,
        { operationId: safeOperationId },
      );
    }
    if (
      this._platform === "win32" &&
      typeof this._secureAuthorityPaths === "function"
    ) {
      this._assertPrivateRepairFile(filePath, MAX_PURGE_RECEIPT_BYTES);
      this._repairAndVerifyWindowsAuthority(
        [filePath],
        "saga purge receipt authority",
        {
          operationId: safeOperationId,
          cacheKey: `receipt:${pathKey(filePath, this._platform, this._path)}`,
        },
      );
    }
    let receipt;
    try {
      receipt = JSON.parse(
        this._readBoundedRegularFile(
          filePath,
          MAX_PURGE_RECEIPT_BYTES,
          readBudget,
        ),
      );
    } catch (cause) {
      if (isSagaError(cause)) throw cause;
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga purge receipt is not valid JSON",
        cause,
        { operationId: safeOperationId, filePath },
      );
    }
    if (
      !hasExactKeys(receipt, PURGE_RECEIPT_KEYS) ||
      receipt.schema !== PURGE_RECEIPT_SCHEMA ||
      receipt.version !== PURGE_RECEIPT_VERSION ||
      receipt.operationId !== safeOperationId ||
      receipt.workspaceIdentity !== this.workspaceIdentity ||
      !Number.isSafeInteger(receipt.seq) ||
      receipt.seq < 1 ||
      !TERMINAL_PHASE_SET.has(receipt.phase) ||
      !HASH_PATTERN.test(String(receipt.headHash || "")) ||
      !HASH_PATTERN.test(String(receipt.receiptHash || "")) ||
      receipt.receiptHash !== purgeReceiptHash(receipt)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
        "Saga purge receipt is not canonical",
        null,
        { operationId: safeOperationId, filePath },
      );
    }
    return Object.freeze({ ...receipt });
  }

  _removePurgeReceiptTemporaries(operationId) {
    const safeOperationId = assertOperationId(operationId);
    const scan = this._scanPurgeReceipts();
    for (const temporary of scan.temporaryFiles) {
      if (temporary.operationId !== safeOperationId) continue;
      const filePath = this._path.join(this.purgeReceiptRoot, temporary.name);
      const before = this._fs.lstatSync(filePath, { bigint: true });
      this._assertSafeOrphanTemporary(filePath, MAX_PURGE_RECEIPT_BYTES);
      if (
        this._platform === "win32" &&
        typeof this._secureAuthorityPaths === "function"
      ) {
        this._assertPrivateRepairFile(filePath, MAX_PURGE_RECEIPT_BYTES, {
          allowEmpty: true,
        });
        this._repairAndVerifyWindowsAuthority(
          [filePath],
          "saga purge receipt temporary authority",
          { operationId: safeOperationId },
        );
      }
      const settled = this._fs.lstatSync(filePath, { bigint: true });
      if (!sameIdentity(statIdentity(before), settled)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Saga purge receipt temporary changed identity before cleanup",
          null,
          { filePath },
        );
      }
      try {
        this._fs.unlinkSync(filePath);
      } catch (cause) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
          "Could not remove an uncommitted purge receipt temporary",
          cause,
          { filePath, commitState: "purge_receipt_cleanup_unknown" },
        );
      }
    }
    this._syncDirectoryBestEffort(this.purgeReceiptRoot);
  }

  _writePurgeReceipt(operationId, saga) {
    const safeOperationId = assertOperationId(operationId);
    this._removePurgeReceiptTemporaries(safeOperationId);
    const filePath = this._purgeReceiptPath(safeOperationId);
    const intended = purgeReceipt(
      safeOperationId,
      this.workspaceIdentity,
      saga,
    );
    const existing = this._readPurgeReceipt(safeOperationId, {
      mustExist: false,
    });
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(intended)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
          "Saga purge receipt belongs to another terminal generation",
          null,
          { operationId: safeOperationId },
        );
      }
      return existing;
    }
    const temporaryPath = this._path.join(
      this.purgeReceiptRoot,
      `.${safeOperationId}.${process.pid}.${this._randomUUID()}.tmp`,
    );
    const contents = `${JSON.stringify(intended, null, 2)}\n`;
    let descriptor = null;
    let renameAttempted = false;
    try {
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      this._fs.writeFileSync(descriptor, contents, "utf8");
      this._fs.fsyncSync(descriptor);
      this._fs.closeSync(descriptor);
      descriptor = null;
      this._secureWindowsFileBeforeRename(
        temporaryPath,
        MAX_PURGE_RECEIPT_BYTES,
        "saga purge receipt temporary authority",
        safeOperationId,
      );
      if (this._fs.existsSync(filePath)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
          "Saga purge receipt is already committed",
          null,
          { operationId: safeOperationId },
        );
      }
      renameAttempted = true;
      this._fs.renameSync(temporaryPath, filePath);
      const persisted = this._readPurgeReceipt(safeOperationId);
      if (canonicalJson(persisted) !== canonicalJson(intended)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
          "Published saga purge receipt differs from the intended receipt",
          null,
          { operationId: safeOperationId },
        );
      }
      this._syncDirectoryBestEffort(this.purgeReceiptRoot);
      return persisted;
    } catch (cause) {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Preserve the primary receipt failure.
        }
      }
      try {
        this._fs.unlinkSync(temporaryPath);
      } catch {
        // A later exact retry cleans bounded uncommitted receipt temporaries.
      }
      const commitDetails = {
        commitState: renameAttempted
          ? "purge_receipt_commit_unknown"
          : "purge_receipt_not_committed",
        intendedSeq: saga.seq,
        intendedHash: saga.headHash,
      };
      if (isSagaError(cause)) {
        throw attachCommitState(cause, commitDetails);
      }
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
        "Could not atomically commit the saga purge receipt",
        cause,
        {
          operationId: safeOperationId,
          filePath,
          temporaryPath,
          ...commitDetails,
        },
      );
    }
  }

  create({ operationId, evidence = {} } = {}) {
    const safeOperationId = assertOperationId(operationId);
    const normalizedEvidence = normalizeEvidence(evidence);
    this._validatePhaseEvidence(safeOperationId, "created", normalizedEvidence);
    return this._withShardMaintenanceLock(() => {
      this._assertShardCapacity(safeOperationId);
      return this._withOperationLock(safeOperationId, () => {
        const existing = this._assertOperationDirectory(safeOperationId, {
          mustExist: false,
        });
        if (
          Object.hasOwn(normalizedEvidence, "workspaceRoot") &&
          normalizedEvidence.workspaceRoot !== this.workspaceRoot
        ) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
            "Created saga workspaceRoot is managed by the store",
          );
        }
        if (
          Object.hasOwn(normalizedEvidence, "workspaceIdentity") &&
          normalizedEvidence.workspaceIdentity !== this.workspaceIdentity
        ) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE,
            "Created saga workspaceIdentity is managed by the store",
          );
        }
        const directory = this._operationDirectory(safeOperationId);
        let classification = null;
        if (existing) {
          classification = this._secureOperationAuthority(
            safeOperationId,
            existing,
          );
          if (classification.files.length > 0) {
            this._readOperationFromAuthority(safeOperationId, existing);
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS,
              "Checkpoint restore saga already exists",
              null,
              { operationId: safeOperationId },
            );
          }
        } else {
          try {
            this._fs.mkdirSync(directory, { mode: 0o700 });
            if (this._platform !== "win32")
              this._fs.chmodSync(directory, 0o700);
          } catch (cause) {
            if (cause?.code === "EEXIST") {
              throw sagaError(
                CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS,
                "Checkpoint restore saga already exists",
                cause,
                { operationId: safeOperationId },
              );
            }
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
              "Could not create checkpoint restore saga directory",
              cause,
              { operationId: safeOperationId },
            );
          }
          this._syncDirectoryBestEffort(this.stateRoot);
        }
        if (!classification) {
          classification = this._secureOperationAuthority(
            safeOperationId,
            this._assertOperationDirectory(safeOperationId),
          );
        }
        if (classification.headFile) {
          const head = this._readHead(
            classification.headFile,
            safeOperationId,
            this.workspaceIdentity,
          );
          if (head.state !== "unpublished") {
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
              "Event-free saga has a committed HEAD",
              null,
              { operationId: safeOperationId },
            );
          }
        }
        if (classification.orphanTemporaryFiles.length > 0) {
          this._removeOrphanTemporaries(
            this._assertOperationDirectory(safeOperationId),
            classification.orphanTemporaryFiles,
          );
          classification = this._secureOperationAuthority(
            safeOperationId,
            this._assertOperationDirectory(safeOperationId),
          );
        }
        if (!classification.headFile) {
          this._writeHead(
            directory,
            genesisHead(safeOperationId, this.workspaceIdentity),
            { createOnly: true },
          );
        }
        if (this._beforeCreatedEvent) {
          this._beforeCreatedEvent({
            operationId: safeOperationId,
            directory,
          });
        }
        const event = this._newEvent(safeOperationId, 1, null, "created", {
          ...normalizedEvidence,
          workspaceRoot: this.workspaceRoot,
          workspaceIdentity: this.workspaceIdentity,
        });
        this._writeEvent(directory, event);
        this._writeHead(
          directory,
          committedHead(safeOperationId, this.workspaceIdentity, event),
        );
        return this._readOperationUnlocked(safeOperationId);
      });
    });
  }

  load(operationId) {
    const safeOperationId = assertOperationId(operationId);
    return this._withOperationLock(safeOperationId, () =>
      this._readOperationUnlocked(safeOperationId),
    );
  }

  advance(
    operationId,
    { expectedSeq, expectedHash, phase, evidence = {} } = {},
  ) {
    const safeOperationId = assertOperationId(operationId);
    if (
      !Number.isSafeInteger(expectedSeq) ||
      expectedSeq < 1 ||
      typeof expectedHash !== "string" ||
      !HASH_PATTERN.test(expectedHash)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
        "Saga advance requires an exact sequence and head hash",
      );
    }
    if (!PHASE_SET.has(phase) || phase === "created") {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_TRANSITION,
        "Saga advance requires a valid non-created phase",
      );
    }
    const normalizedEvidence = normalizeEvidence(evidence);
    return this._withOperationLock(safeOperationId, () => {
      const current = this._readOperationUnlocked(safeOperationId);
      if (current.seq !== expectedSeq || current.headHash !== expectedHash) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
          "Checkpoint restore saga head changed",
          null,
          {
            operationId: safeOperationId,
            expectedSeq,
            actualSeq: current.seq,
            expectedHash,
            actualHash: current.headHash,
          },
        );
      }
      if (!TRANSITIONS.get(current.phase)?.has(phase)) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_TRANSITION,
          `Checkpoint restore saga cannot transition from ${current.phase} to ${phase}`,
          null,
          { operationId: safeOperationId },
        );
      }
      if (current.seq >= MAX_CHECKPOINT_RESTORE_SAGA_EVENTS) {
        throw sagaError(
          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
          "Checkpoint restore saga event limit reached",
          null,
          { operationId: safeOperationId },
        );
      }
      const event = this._newEvent(
        safeOperationId,
        current.seq + 1,
        current.headHash,
        phase,
        normalizedEvidence,
        current.events[current.events.length - 1].timestamp,
      );
      this._validateEvidenceProgression(current.events, event);
      const directory = this._operationDirectory(safeOperationId);
      this._writeEvent(directory, event);
      this._writeHead(
        directory,
        committedHead(safeOperationId, current.workspaceIdentity, event),
      );
      return this._readOperationUnlocked(safeOperationId);
    });
  }

  _readExactCleanTerminal(
    operationId,
    authority,
    expectedSeq,
    expectedHash,
    message,
  ) {
    const current = this._readOperationFromAuthority(operationId, authority);
    if (
      !current.terminal ||
      current.orphanTemporaryFiles.length > 0 ||
      current.seq !== expectedSeq ||
      current.headHash !== expectedHash
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
        message,
        null,
        { operationId },
      );
    }
    return current;
  }

  archiveTerminal(operationId, { expectedSeq, expectedHash } = {}) {
    const safeOperationId = assertOperationId(operationId);
    if (
      !Number.isSafeInteger(expectedSeq) ||
      expectedSeq < 1 ||
      typeof expectedHash !== "string" ||
      !HASH_PATTERN.test(expectedHash)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
        "Terminal archive requires an exact sequence and head hash",
      );
    }
    return this._withShardMaintenanceLock(() =>
      this._withOperationLock(safeOperationId, () => {
        const activeAuthority = this._assertOperationDirectory(
          safeOperationId,
          { mustExist: false },
        );
        const archiveAuthority = this._assertRetainedOperationDirectory(
          this.archiveRoot,
          safeOperationId,
          "Saga archive",
          { mustExist: false },
        );
        const purgeAuthority = this._assertRetainedOperationDirectory(
          this.purgeRoot,
          safeOperationId,
          "Saga purge",
          { mustExist: false },
        );
        const purgeReceiptState = this._readPurgeReceipt(safeOperationId, {
          mustExist: false,
        });
        const presentCount = [
          activeAuthority,
          archiveAuthority,
          purgeAuthority,
          purgeReceiptState,
        ].filter(Boolean).length;
        if (presentCount > 1) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
            "Saga exists in multiple active/archive/purge retention states",
            null,
            { operationId: safeOperationId },
          );
        }
        if (archiveAuthority) {
          const archived = this._readExactCleanTerminal(
            safeOperationId,
            archiveAuthority,
            expectedSeq,
            expectedHash,
            "Archived saga is not the exact clean terminal head requested",
          );
          return Object.freeze({
            operationId: safeOperationId,
            archived: true,
            alreadyArchived: true,
            phase: archived.phase,
            seq: archived.seq,
            headHash: archived.headHash,
          });
        }
        if (purgeAuthority) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Checkpoint restore saga has already entered confirmed purge",
            null,
            { operationId: safeOperationId, commitState: "purge_pending" },
          );
        }
        if (purgeReceiptState) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Checkpoint restore saga has already been purged",
            null,
            { operationId: safeOperationId, commitState: "purged_receipt" },
          );
        }
        if (!activeAuthority) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
            "Checkpoint restore saga does not exist",
            null,
            { operationId: safeOperationId },
          );
        }
        const current = this._readOperationFromAuthority(
          safeOperationId,
          activeAuthority,
        );
        if (current.seq !== expectedSeq || current.headHash !== expectedHash) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Checkpoint restore saga head changed before archival",
            null,
            {
              operationId: safeOperationId,
              expectedSeq,
              actualSeq: current.seq,
            },
          );
        }
        if (!current.terminal || current.orphanTemporaryFiles.length > 0) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_TRANSITION,
            "Only a clean terminal checkpoint restore saga can be archived",
            null,
            { operationId: safeOperationId, phase: current.phase },
          );
        }
        const source = activeAuthority;
        const destination = this._archiveDirectory(safeOperationId);
        if (this._fs.existsSync(destination)) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS,
            "Checkpoint restore saga archive already exists",
            null,
            { operationId: safeOperationId },
          );
        }
        let renameAttempted = false;
        try {
          renameAttempted = true;
          this._fs.renameSync(source.directory, destination);
        } catch (cause) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
            "Could not atomically archive terminal checkpoint restore saga",
            cause,
            {
              operationId: safeOperationId,
              commitState: renameAttempted
                ? "archive_commit_unknown"
                : "archive_not_committed",
              intendedSeq: expectedSeq,
              intendedHash: expectedHash,
            },
          );
        }
        try {
          const archived = this._fs.lstatSync(destination, { bigint: true });
          const canonical = this._fs.realpathSync.native(destination);
          if (
            archived.isSymbolicLink() ||
            !archived.isDirectory() ||
            !sameIdentity(source.identity, archived) ||
            !samePath(destination, canonical, this._platform, this._path)
          ) {
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
              "Archived checkpoint restore saga changed identity",
              null,
              { operationId: safeOperationId },
            );
          }
          this._readExactCleanTerminal(
            safeOperationId,
            { directory: destination, identity: statIdentity(archived) },
            expectedSeq,
            expectedHash,
            "Archived saga HEAD changed during retention transition",
          );
        } catch (cause) {
          if (isSagaError(cause)) {
            throw attachCommitState(cause, {
              commitState: "archive_commit_unknown",
              intendedSeq: expectedSeq,
              intendedHash: expectedHash,
            });
          }
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
            "Could not validate the committed saga archive",
            cause,
            {
              operationId: safeOperationId,
              commitState: "archive_commit_unknown",
              intendedSeq: expectedSeq,
              intendedHash: expectedHash,
            },
          );
        }
        this._syncDirectoryBestEffort(this.stateRoot);
        this._syncDirectoryBestEffort(this.archiveRoot);
        return Object.freeze({
          operationId: safeOperationId,
          archived: true,
          phase: current.phase,
          seq: current.seq,
          headHash: current.headHash,
        });
      }),
    );
  }

  purgeArchived(
    operationId,
    { expectedSeq, expectedHash, confirmOperationId } = {},
  ) {
    const safeOperationId = assertOperationId(operationId);
    if (
      confirmOperationId !== safeOperationId ||
      !Number.isSafeInteger(expectedSeq) ||
      expectedSeq < 1 ||
      typeof expectedHash !== "string" ||
      !HASH_PATTERN.test(expectedHash)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
        "Archived purge requires exact head CAS and explicit operationId confirmation",
      );
    }
    return this._withShardMaintenanceLock(() =>
      this._withOperationLock(safeOperationId, () => {
        const archiveAuthority = this._assertRetainedOperationDirectory(
          this.archiveRoot,
          safeOperationId,
          "Saga archive",
          { mustExist: false },
        );
        const purgePath = this._purgeDirectory(safeOperationId);
        let purgeAuthority = this._assertRetainedOperationDirectory(
          this.purgeRoot,
          safeOperationId,
          "Saga purge",
          { mustExist: false },
        );
        const activeAuthority = this._assertOperationDirectory(
          safeOperationId,
          { mustExist: false },
        );
        this._removePurgeReceiptTemporaries(safeOperationId);
        let purgeReceiptState = this._readPurgeReceipt(safeOperationId, {
          mustExist: false,
        });
        if (
          (archiveAuthority && purgeAuthority) ||
          (activeAuthority &&
            (archiveAuthority || purgeAuthority || purgeReceiptState)) ||
          (archiveAuthority && purgeReceiptState)
        ) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
            "Saga exists in multiple active/archive/purge retention states",
            null,
            { operationId: safeOperationId },
          );
        }
        if (
          activeAuthority &&
          !archiveAuthority &&
          !purgeAuthority &&
          !purgeReceiptState
        ) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Checkpoint restore operationId is active or has been reused",
            null,
            { operationId: safeOperationId },
          );
        }
        if (
          purgeReceiptState &&
          (purgeReceiptState.seq !== expectedSeq ||
            purgeReceiptState.headHash !== expectedHash)
        ) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Purge receipt does not match the exact terminal head requested",
            null,
            { operationId: safeOperationId },
          );
        }
        if (archiveAuthority) {
          const current = this._readOperationFromAuthority(
            safeOperationId,
            archiveAuthority,
          );
          if (
            !current.terminal ||
            current.orphanTemporaryFiles.length > 0 ||
            current.seq !== expectedSeq ||
            current.headHash !== expectedHash
          ) {
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
              "Archived saga is not the exact clean terminal head requested for purge",
              null,
              { operationId: safeOperationId },
            );
          }
          try {
            this._fs.renameSync(archiveAuthority.directory, purgePath);
          } catch (cause) {
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
              "Could not atomically enter the confirmed purge state",
              cause,
              {
                operationId: safeOperationId,
                commitState: "purge_transition_unknown",
                intendedSeq: expectedSeq,
                intendedHash: expectedHash,
              },
            );
          }
          try {
            purgeAuthority = this._assertRetainedOperationDirectory(
              this.purgeRoot,
              safeOperationId,
              "Saga purge",
            );
            if (
              !sameIdentity(archiveAuthority.identity, purgeAuthority.identity)
            ) {
              throw sagaError(
                CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                "Saga purge state changed identity",
                null,
                { operationId: safeOperationId },
              );
            }
          } catch (cause) {
            if (isSagaError(cause)) {
              throw attachCommitState(cause, {
                commitState: "purge_transition_unknown",
                intendedSeq: expectedSeq,
                intendedHash: expectedHash,
              });
            }
            throw sagaError(
              CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
              "Could not validate the committed purge transition",
              cause,
              {
                operationId: safeOperationId,
                commitState: "purge_transition_unknown",
                intendedSeq: expectedSeq,
                intendedHash: expectedHash,
              },
            );
          }
          this._syncDirectoryBestEffort(this.archiveRoot);
          this._syncDirectoryBestEffort(this.purgeRoot);
        }
        if (!purgeAuthority) {
          if (purgeReceiptState) {
            return Object.freeze({
              operationId: safeOperationId,
              purged: true,
              alreadyPurged: true,
              operationIdMayBeReused: false,
              expectedSeq,
              expectedHash,
              receiptHash: purgeReceiptState.receiptHash,
            });
          }
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
            "Archived checkpoint restore saga does not exist",
            null,
            { operationId: safeOperationId },
          );
        }
        const purgeSaga = this._readExactCleanTerminal(
          safeOperationId,
          purgeAuthority,
          expectedSeq,
          expectedHash,
          "Purge saga is not the exact clean terminal head requested",
        );
        if (purgeReceiptState && purgeReceiptState.phase !== purgeSaga.phase) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
            "Purge receipt phase differs from the retained terminal saga",
            null,
            { operationId: safeOperationId },
          );
        }
        if (!purgeReceiptState) {
          purgeReceiptState = this._writePurgeReceipt(
            safeOperationId,
            purgeSaga,
          );
        }
        const beforeDelete = this._fs.lstatSync(purgeAuthority.directory, {
          bigint: true,
        });
        if (!sameIdentity(purgeAuthority.identity, beforeDelete)) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
            "Saga purge authority changed before deletion",
            null,
            { operationId: safeOperationId },
          );
        }
        try {
          this._fs.rmSync(purgeAuthority.directory, {
            recursive: true,
            force: false,
          });
        } catch (cause) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
            "Confirmed saga purge could not be completed",
            cause,
            {
              operationId: safeOperationId,
              commitState: "purge_delete_unknown",
              intendedSeq: expectedSeq,
              intendedHash: expectedHash,
            },
          );
        }
        this._syncDirectoryBestEffort(this.purgeRoot);
        return Object.freeze({
          operationId: safeOperationId,
          purged: true,
          operationIdMayBeReused: false,
          expectedSeq,
          expectedHash,
          receiptHash: purgeReceiptState.receiptHash,
        });
      }),
    );
  }

  releasePurgeReceipt(
    operationId,
    { expectedSeq, expectedHash, confirmOperationId } = {},
  ) {
    const safeOperationId = assertOperationId(operationId);
    if (
      confirmOperationId !== safeOperationId ||
      !Number.isSafeInteger(expectedSeq) ||
      expectedSeq < 1 ||
      typeof expectedHash !== "string" ||
      !HASH_PATTERN.test(expectedHash)
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
        "Purge receipt release requires exact CAS and operationId confirmation",
      );
    }
    return this._withShardMaintenanceLock(() =>
      this._withOperationLock(safeOperationId, () => {
        const activeAuthority = this._assertOperationDirectory(
          safeOperationId,
          { mustExist: false },
        );
        const archiveAuthority = this._assertRetainedOperationDirectory(
          this.archiveRoot,
          safeOperationId,
          "Saga archive",
          { mustExist: false },
        );
        const purgeAuthority = this._assertRetainedOperationDirectory(
          this.purgeRoot,
          safeOperationId,
          "Saga purge",
          { mustExist: false },
        );
        if (activeAuthority || archiveAuthority || purgeAuthority) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Purge receipt cannot be released while saga state is retained",
            null,
            { operationId: safeOperationId },
          );
        }
        this._removePurgeReceiptTemporaries(safeOperationId);
        const receipt = this._readPurgeReceipt(safeOperationId, {
          mustExist: false,
        });
        if (!receipt) {
          return Object.freeze({
            operationId: safeOperationId,
            released: true,
            alreadyReleased: true,
            operationIdMayBeReused: true,
            expectedSeq,
            expectedHash,
          });
        }
        if (receipt.seq !== expectedSeq || receipt.headHash !== expectedHash) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT,
            "Purge receipt does not match the requested terminal generation",
            null,
            { operationId: safeOperationId },
          );
        }
        const filePath = this._purgeReceiptPath(safeOperationId);
        try {
          this._fs.unlinkSync(filePath);
        } catch (cause) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
            "Could not release the exact saga purge receipt",
            cause,
            {
              operationId: safeOperationId,
              commitState: "purge_receipt_release_unknown",
              intendedSeq: expectedSeq,
              intendedHash: expectedHash,
            },
          );
        }
        this._syncDirectoryBestEffort(this.purgeReceiptRoot);
        return Object.freeze({
          operationId: safeOperationId,
          released: true,
          alreadyReleased: false,
          operationIdMayBeReused: true,
          expectedSeq,
          expectedHash,
        });
      }),
    );
  }

  listPending({ afterOperationId = "", limit = 64 } = {}) {
    this._assertStoreAuthority();
    if (
      (afterOperationId !== "" &&
        !OPERATION_ID_PATTERN.test(afterOperationId)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_CHECKPOINT_RESTORE_SAGA_LIST_LIMIT
    ) {
      throw sagaError(
        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
        "Saga listing requires a safe cursor and a bounded page limit",
      );
    }
    const deadline =
      this._wallClock() + MAX_CHECKPOINT_RESTORE_SAGA_LIST_TIME_MS;
    return this._withShardMaintenanceLock(
      () => {
        const activeOperationIds = this._scanOperationNames(this.stateRoot, [
          ".locks",
          ".archive",
          ".purge",
          ".purged",
        ]);
        const archivedOperationNames = this._scanOperationNames(
          this.archiveRoot,
        );
        const purgeOperationNames = this._scanOperationNames(this.purgeRoot);
        const purgeReceiptScan = this._scanPurgeReceipts();
        const purgeReceiptTemporaryOperationIds = [
          ...new Set(
            purgeReceiptScan.temporaryFiles.map(
              (temporary) => temporary.operationId,
            ),
          ),
        ].sort();
        const retention = new Map();
        const addRetention = (operationIds, state) => {
          for (const operationId of operationIds) {
            const states = retention.get(operationId) || [];
            states.push(state);
            retention.set(operationId, states);
          }
        };
        addRetention(activeOperationIds, "active");
        addRetention(archivedOperationNames, "archive");
        addRetention(purgeOperationNames, "purge");
        addRetention(purgeReceiptScan.operationIds, "purged");
        for (const operationId of purgeReceiptTemporaryOperationIds) {
          if (!retention.has(operationId)) retention.set(operationId, []);
        }
        if (retention.size > this._maxSagas) {
          throw sagaError(
            CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT,
            "Checkpoint restore workspace shard exceeds its retention bound",
          );
        }
        const candidates = [...retention.keys()]
          .sort()
          .filter((operationId) => operationId > afterOperationId);
        const page = candidates.slice(0, limit);
        const pending = [];
        const orphanOperationIds = [];
        const terminalOperationIds = [];
        const archivedOperationIds = [];
        const purgeOperationIds = [];
        const purgedOperationIds = [];
        const diagnostics = [];
        const readBudget = {
          deadline,
          remainingBytes: MAX_CHECKPOINT_RESTORE_SAGA_LIST_BYTES,
          remainingEvents: MAX_CHECKPOINT_RESTORE_SAGA_LIST_EVENTS,
        };
        let processedCursor = afterOperationId;
        let budgetExhausted = false;

        for (const operationId of page) {
          const remainingMs = deadline - this._wallClock();
          if (remainingMs <= 0) {
            budgetExhausted = true;
            break;
          }
          try {
            const states = retention.get(operationId);
            const purgeWithReceipt =
              states.length === 2 &&
              states.includes("purge") &&
              states.includes("purged");
            if (states.length > 1 && !purgeWithReceipt) {
              throw sagaError(
                CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                "Saga exists in multiple active/archive/purge retention states",
                null,
                { operationId },
              );
            }
            const state = purgeWithReceipt
              ? "purge_receipted"
              : states[0] || "receipt_temporary";
            const result = this._withOperationLock(
              operationId,
              () => {
                if (state === "active") {
                  const authority = this._assertOperationDirectory(operationId);
                  const classification = this._secureOperationAuthority(
                    operationId,
                    authority,
                  );
                  if (classification.files.length === 0) {
                    let head = null;
                    if (classification.headFile) {
                      head = this._readHead(
                        classification.headFile,
                        operationId,
                        this.workspaceIdentity,
                        readBudget,
                      );
                      if (head.state !== "unpublished") {
                        throw sagaError(
                          CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                          "Event-free saga has a committed HEAD",
                          null,
                          { operationId },
                        );
                      }
                    }
                    return Object.freeze({
                      state,
                      orphan: true,
                      headAnchorHash: head?.anchorHash || null,
                      orphanTemporaryFiles: Object.freeze([
                        ...classification.orphanTemporaryFiles,
                      ]),
                    });
                  }
                  return Object.freeze({
                    state,
                    saga: this._readOperationFromAuthority(
                      operationId,
                      authority,
                      { readBudget },
                    ),
                  });
                }
                if (state === "purged") {
                  return Object.freeze({
                    state,
                    receipt: this._readPurgeReceipt(operationId, {
                      readBudget,
                    }),
                  });
                }
                if (state === "receipt_temporary") {
                  return Object.freeze({ state });
                }
                const root =
                  state === "archive" ? this.archiveRoot : this.purgeRoot;
                const authority = this._assertRetainedOperationDirectory(
                  root,
                  operationId,
                  state === "archive" ? "Saga archive" : "Saga purge",
                );
                const saga = this._readOperationFromAuthority(
                  operationId,
                  authority,
                  { readBudget },
                );
                if (!saga.terminal || saga.orphanTemporaryFiles.length > 0) {
                  throw sagaError(
                    CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                    "Retained saga is not a clean terminal operation",
                    null,
                    { operationId },
                  );
                }
                if (state === "purge_receipted") {
                  const receipt = this._readPurgeReceipt(operationId, {
                    readBudget,
                  });
                  if (
                    receipt.seq !== saga.seq ||
                    receipt.headHash !== saga.headHash ||
                    receipt.phase !== saga.phase
                  ) {
                    throw sagaError(
                      CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                      "Pending purge receipt differs from retained terminal state",
                      null,
                      { operationId },
                    );
                  }
                  return Object.freeze({ state, saga, receipt });
                }
                return Object.freeze({ state, saga });
              },
              { timeoutMs: Math.min(25, remainingMs) },
            );

            if (result.orphan === true) {
              orphanOperationIds.push(operationId);
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "orphan_unpublished",
                  code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                  headAnchorHash: result.headAnchorHash,
                  orphanTemporaryFiles: result.orphanTemporaryFiles,
                  recoverable: true,
                }),
              );
            } else if (result.state === "archive") {
              archivedOperationIds.push(operationId);
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "archived",
                  code: null,
                  orphanTemporaryFiles: Object.freeze([]),
                  recoverable: true,
                }),
              );
            } else if (
              result.state === "purge" ||
              result.state === "purge_receipted"
            ) {
              purgeOperationIds.push(operationId);
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "purge_pending",
                  code: null,
                  orphanTemporaryFiles: Object.freeze([]),
                  recoverable: true,
                }),
              );
            } else if (result.state === "purged") {
              purgedOperationIds.push(operationId);
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "purged_receipt",
                  code: null,
                  orphanTemporaryFiles: Object.freeze([]),
                  recoverable: true,
                }),
              );
            } else if (result.state === "receipt_temporary") {
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "purge_receipt_temporary",
                  code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                  orphanTemporaryFiles: Object.freeze(
                    purgeReceiptScan.temporaryFiles
                      .filter(
                        (temporary) => temporary.operationId === operationId,
                      )
                      .map((temporary) => temporary.name),
                  ),
                  recoverable: true,
                }),
              );
            } else if (result.saga.terminal) {
              terminalOperationIds.push(operationId);
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "terminal_unarchived",
                  code: null,
                  orphanTemporaryFiles: result.saga.orphanTemporaryFiles,
                  recoverable: true,
                }),
              );
            } else if (result.saga.orphanTemporaryFiles.length > 0) {
              diagnostics.push(
                Object.freeze({
                  operationId,
                  status: "orphan_temporary",
                  code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                  orphanTemporaryFiles: result.saga.orphanTemporaryFiles,
                  recoverable: true,
                }),
              );
            } else {
              pending.push(result.saga);
            }
            processedCursor = operationId;
          } catch (error) {
            if (
              error?.code === CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT &&
              error?.budgetExceeded === true
            ) {
              budgetExhausted = true;
              break;
            }
            if (
              error?.code ===
                CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WORKSPACE_MISMATCH ||
              (error?.code ===
                CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH &&
                error?.operationId !== operationId)
            ) {
              throw error;
            }
            diagnostics.push(
              Object.freeze({
                operationId,
                status:
                  error?.lockState === "corrupt"
                    ? "corrupt"
                    : error?.code ===
                        CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED
                      ? "busy"
                      : "corrupt",
                code:
                  typeof error?.code === "string"
                    ? error.code
                    : CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
                orphanTemporaryFiles: Object.freeze([]),
                recoverable: false,
              }),
            );
            processedCursor = operationId;
          }
        }

        const define = (name, value) =>
          Object.defineProperty(pending, name, {
            value,
            enumerable: true,
            writable: false,
            configurable: false,
          });
        define("orphanOperationIds", Object.freeze(orphanOperationIds));
        define("terminalOperationIds", Object.freeze(terminalOperationIds));
        define("archivedOperationIds", Object.freeze(archivedOperationIds));
        define("purgeOperationIds", Object.freeze(purgeOperationIds));
        define("purgedOperationIds", Object.freeze(purgedOperationIds));
        define(
          "purgeReceiptTemporaryOperationIds",
          Object.freeze(purgeReceiptTemporaryOperationIds),
        );
        define("diagnostics", Object.freeze(diagnostics));
        const truncated = budgetExhausted || candidates.length > page.length;
        define("truncated", truncated);
        define("budgetExhausted", budgetExhausted);
        define("nextCursor", truncated ? processedCursor : null);
        return Object.freeze(pending);
      },
      { timeoutMs: MAX_CHECKPOINT_RESTORE_SAGA_LIST_TIME_MS },
    );
  }
}
