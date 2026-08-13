/**
 * Durable adjudication for ambiguous Agent Team side effects.
 *
 * A resumed real task may have executed an external side effect even though its
 * registry snapshot still contains a dangling lease. The coordinator must not
 * guess whether to replay it. This store records a human/operator decision
 * against the exact recovery evidence and exposes a one-shot claim protocol:
 *
 *   case.open -> case.decide -> case.claim -> case.apply
 *
 * `retry` claims authorize exactly one new execution. `accept` and `cancel`
 * claims authorize only local task settlement. If a process dies after claiming
 * a retry, recovery remains fail-closed because the claim cannot be issued
 * again. A claimed accept/cancel is reported as replay-safe settlement work.
 *
 * The file is a logically append-only, hash-chained event log stored as one
 * atomically replaced JSON document. Replaying it validates exact schemas,
 * sequence numbers, transition legality, and every digest. External team state
 * should persist the returned cursor; supplying it as `anchor` proves that the
 * cursor is still an exact prefix and detects a valid-but-older rollback or a
 * competing branch.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { withFileLock } from "../with-file-lock.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  SecureFileIdentityError,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";

export const TEAM_ADJUDICATION_SCHEMA_VERSION = 1;
export const TEAM_ADJUDICATION_DECISIONS = Object.freeze({
  RETRY: "retry",
  ACCEPT: "accept",
  CANCEL: "cancel",
});
export const TEAM_ADJUDICATION_ACTIONS = Object.freeze({
  retry: "retry_task_once",
  accept: "complete_task",
  cancel: "cancel_task",
});
export const TEAM_ADJUDICATION_ERROR_CODES = Object.freeze({
  INVALID: "TEAM_ADJUDICATION_INVALID",
  UNSAFE_PATH: "TEAM_ADJUDICATION_UNSAFE_PATH",
  LOCK_UNAVAILABLE: "TEAM_ADJUDICATION_LOCK_UNAVAILABLE",
  READ_FAILED: "TEAM_ADJUDICATION_READ_FAILED",
  WRITE_FAILED: "TEAM_ADJUDICATION_WRITE_FAILED",
  CORRUPT: "TEAM_ADJUDICATION_CORRUPT",
  BINDING_MISMATCH: "TEAM_ADJUDICATION_BINDING_MISMATCH",
  NOT_FOUND: "TEAM_ADJUDICATION_NOT_FOUND",
  CONFLICT: "TEAM_ADJUDICATION_CONFLICT",
  STALE: "TEAM_ADJUDICATION_STALE",
  ROLLBACK: "TEAM_ADJUDICATION_ROLLBACK",
  ALREADY_CLAIMED: "TEAM_ADJUDICATION_ALREADY_CLAIMED",
  LIMIT: "TEAM_ADJUDICATION_LIMIT",
});

export const MAX_TEAM_ADJUDICATION_EVENTS = 50_000;
export const MAX_TEAM_ADJUDICATION_BYTES = 64 * 1024 * 1024;

const STORE_SCHEMA = "cc.team-side-effect-adjudication";
const EVENT_VERSION = 1;
const DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
const EVENT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CASE_ID_PATTERN = /^tadj_[a-f0-9]{64}$/;
const CLAIM_ID_PATTERN =
  /^tadj_claim_[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$/;
const WINDOWS_RENAME_TRANSIENT_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const WINDOWS_RENAME_RETRY_DELAYS_MS = Object.freeze([
  5, 10, 20, 40, 80, 100, 100, 100,
]);
const DECISIONS = new Set(Object.values(TEAM_ADJUDICATION_DECISIONS));
const HEADER_KEYS = new Set([
  "schema",
  "schemaVersion",
  "statePath",
  "statePathDigest",
  "collaborationRunId",
  "createdAt",
  "bindingDigest",
  "events",
]);
const COMMON_EVENT_KEYS = [
  "version",
  "sequence",
  "type",
  "at",
  "previousDigest",
  "digest",
  "bindingDigest",
  "collaborationRunId",
  "statePathDigest",
  "caseId",
];
const EVENT_KEYS = Object.freeze({
  "case.open": new Set([
    ...COMMON_EVENT_KEYS,
    "taskKey",
    "registryDigest",
    "sideEffectDigest",
  ]),
  "case.decide": new Set([
    ...COMMON_EVENT_KEYS,
    "decision",
    "authority",
    "reasonDigest",
  ]),
  "case.claim": new Set([
    ...COMMON_EVENT_KEYS,
    "decisionDigest",
    "claimId",
    "consumer",
  ]),
  "case.apply": new Set([...COMMON_EVENT_KEYS, "claimDigest", "outcomeDigest"]),
});

export class TeamAdjudicationError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "TeamAdjudicationError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null) this[key] = value;
    }
  }
}

function adjudicationError(code, message, details = {}, cause = null) {
  return new TeamAdjudicationError(code, message, details, cause);
}

function sleepSync(milliseconds) {
  const duration = Math.max(0, Number(milliseconds) || 0);
  if (duration === 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
  } catch {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      // SharedArrayBuffer is unavailable; retain a bounded synchronous wait.
    }
  }
}

function isAdjudicationError(error) {
  return Object.values(TEAM_ADJUDICATION_ERROR_CODES).includes(error?.code);
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
      `Invalid team adjudication ${label}`,
    );
  }
  const actual = Object.keys(value);
  if (
    actual.length !== allowed.size ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
      `Unexpected or missing field in team adjudication ${label}`,
    );
  }
}

function canonicalJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.INVALID,
        "Evidence values must contain only finite numbers",
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.INVALID,
        "Evidence values must not contain cycles",
      );
    }
    seen.add(value);
    const encoded = `[${value
      .map((item) => {
        if (item === undefined || typeof item === "function") {
          throw adjudicationError(
            TEAM_ADJUDICATION_ERROR_CODES.INVALID,
            "Evidence arrays must not contain unsupported values",
          );
        }
        return canonicalJson(item, seen);
      })
      .join(",")}]`;
    seen.delete(value);
    return encoded;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.INVALID,
        "Evidence values must not contain cycles",
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.INVALID,
        "Evidence values must be plain JSON objects",
      );
    }
    seen.add(value);
    const entries = [];
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function") {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.INVALID,
          "Evidence objects must not contain unsupported values",
        );
      }
      entries.push(`${JSON.stringify(key)}:${canonicalJson(item, seen)}`);
    }
    seen.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw adjudicationError(
    TEAM_ADJUDICATION_ERROR_CODES.INVALID,
    "Evidence must be a JSON-compatible value",
  );
}

function sha256(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex")}`;
}

/**
 * Produce a deterministic digest for a registry snapshot, side-effect ledger,
 * reason, or post-application outcome without persisting the raw evidence.
 */
export function computeTeamAdjudicationEvidenceDigest(value) {
  return sha256("cc-team-adjudication-evidence-v1", canonicalJson(value));
}

function normalizeDigest(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) {
    return null;
  }
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!DIGEST_PATTERN.test(raw)) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.INVALID,
      `${fieldName} must be a SHA-256 digest`,
      { field: fieldName },
    );
  }
  return raw.startsWith("sha256:") ? raw : `sha256:${raw}`;
}

function requiredLabel(value, fieldName, max = 256) {
  if (typeof value !== "string") {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.INVALID,
      `${fieldName} must be a non-empty string`,
      { field: fieldName },
    );
  }
  const normalized = value.trim();
  if (
    !normalized ||
    Buffer.byteLength(normalized, "utf8") > max ||
    /\p{Cc}/u.test(normalized)
  ) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.INVALID,
      `${fieldName} must be a bounded string without control characters`,
      { field: fieldName },
    );
  }
  return normalized;
}

function normalizeRunId(value) {
  const runId = requiredLabel(value, "collaborationRunId", 160);
  if (!/^(team|batch)-[a-zA-Z0-9._-]+$/.test(runId)) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.INVALID,
      "collaborationRunId is not a valid team or batch run id",
    );
  }
  return runId;
}

function normalizeDecision(value) {
  const decision = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!DECISIONS.has(decision)) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.INVALID,
      "decision must be retry, accept, or cancel",
    );
  }
  return decision;
}

function normalizeFiniteTime(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.INVALID,
      `${fieldName} must be a non-negative finite timestamp`,
    );
  }
  return number;
}

function pathIdentity(value, platform = process.platform) {
  const normalized = path.normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function unsafePath(message, filePath, cause = null) {
  return adjudicationError(
    TEAM_ADJUDICATION_ERROR_CODES.UNSAFE_PATH,
    message,
    { filePath },
    cause,
  );
}

function lstatOrNull(runtimeFs, filePath, options = undefined) {
  try {
    return runtimeFs.lstatSync(filePath, options);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRegularSingleLink(runtimeFs, filePath, options = {}) {
  const {
    allowMissing = false,
    bigint = false,
    requireMode0600 = false,
    platform = process.platform,
  } = options;
  let entry;
  try {
    entry = lstatOrNull(
      runtimeFs,
      filePath,
      bigint ? { bigint: true } : undefined,
    );
  } catch (cause) {
    throw unsafePath(
      `Could not inspect team adjudication path: ${filePath}`,
      filePath,
      cause,
    );
  }
  if (entry === null) {
    if (allowMissing) return null;
    throw unsafePath(
      `Required team adjudication authority file is missing: ${filePath}`,
      filePath,
    );
  }
  if (entry.isSymbolicLink() || !entry.isFile() || Number(entry.nlink) !== 1) {
    throw unsafePath(
      `Team adjudication authority must be a regular, non-symlink, single-link file: ${filePath}`,
      filePath,
    );
  }
  if (
    requireMode0600 &&
    platform !== "win32" &&
    (Number(entry.mode) & 0o777) !== 0o600
  ) {
    throw unsafePath(
      `Team adjudication authority must have mode 0600: ${filePath}`,
      filePath,
    );
  }
  return entry;
}

function canonicalAuthorityPath(runtimeFs, input, label, { mustExist }) {
  const raw = requiredLabel(input, label, 4096);
  const requested = path.resolve(raw);
  const parent = path.dirname(requested);
  let canonicalParent;
  try {
    canonicalParent = runtimeFs.realpathSync.native(parent);
  } catch (cause) {
    throw unsafePath(
      `Could not canonicalize ${label} parent: ${parent}`,
      requested,
      cause,
    );
  }
  const target = path.join(canonicalParent, path.basename(requested));
  const entry = assertRegularSingleLink(runtimeFs, target, {
    allowMissing: !mustExist,
  });
  if (!entry) return target;
  let canonicalTarget;
  try {
    canonicalTarget = runtimeFs.realpathSync.native(target);
  } catch (cause) {
    throw unsafePath(
      `Could not canonicalize ${label}: ${target}`,
      target,
      cause,
    );
  }
  if (pathIdentity(canonicalTarget) !== pathIdentity(target)) {
    throw unsafePath(
      `${label} resolves through an unsafe alias: ${target}`,
      target,
    );
  }
  return canonicalTarget;
}

function bindingHeader({
  statePath,
  statePathDigest,
  collaborationRunId,
  createdAt,
}) {
  return {
    schema: STORE_SCHEMA,
    schemaVersion: TEAM_ADJUDICATION_SCHEMA_VERSION,
    statePath,
    statePathDigest,
    collaborationRunId,
    createdAt,
  };
}

function computeBindingDigest(header) {
  return sha256(
    "cc-team-adjudication-binding-v1",
    canonicalJson(bindingHeader(header)),
  );
}

function caseBinding(store, input) {
  const taskKey = requiredLabel(input?.taskKey, "taskKey", 256);
  const registryDigest = normalizeDigest(
    input?.registryDigest,
    "registryDigest",
  );
  const sideEffectDigest = normalizeDigest(
    input?.sideEffectDigest,
    "sideEffectDigest",
  );
  const material = {
    statePathDigest: store.statePathDigest,
    collaborationRunId: store.collaborationRunId,
    taskKey,
    registryDigest,
    sideEffectDigest,
  };
  const caseId = `tadj_${sha256(
    "cc-team-adjudication-case-v1",
    canonicalJson(material),
  ).slice("sha256:".length)}`;
  return {
    caseId,
    taskKey,
    registryDigest,
    sideEffectDigest,
  };
}

function computeEventDigest(event) {
  const payload = { ...event };
  delete payload.digest;
  return sha256("cc-team-adjudication-event-v1", canonicalJson(payload));
}

function eventEnvelope(runtime, type, caseId, at) {
  return {
    version: EVENT_VERSION,
    sequence: runtime.lastSequence + 1,
    type,
    at: Math.max(at, runtime.lastAt),
    previousDigest: runtime.headDigest,
    digest: null,
    bindingDigest: runtime.document.bindingDigest,
    collaborationRunId: runtime.document.collaborationRunId,
    statePathDigest: runtime.document.statePathDigest,
    caseId,
  };
}

function buildEvent(runtime, type, caseId, at, fields) {
  const event = {
    ...eventEnvelope(runtime, type, caseId, at),
    ...fields,
  };
  event.digest = computeEventDigest(event);
  return event;
}

function assertEventEnvelope(runtime, event) {
  const allowed = EVENT_KEYS[event?.type];
  if (!allowed) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
      "Team adjudication contains an unsupported event type",
    );
  }
  assertExactKeys(event, allowed, "event");
  if (
    event.version !== EVENT_VERSION ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence !== runtime.lastSequence + 1 ||
    !Number.isFinite(event.at) ||
    event.at < runtime.lastAt ||
    event.previousDigest !== runtime.headDigest ||
    event.bindingDigest !== runtime.document.bindingDigest ||
    event.collaborationRunId !== runtime.document.collaborationRunId ||
    event.statePathDigest !== runtime.document.statePathDigest ||
    !CASE_ID_PATTERN.test(event.caseId || "") ||
    !EVENT_DIGEST_PATTERN.test(event.digest || "") ||
    computeEventDigest(event) !== event.digest
  ) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
      `Invalid team adjudication event at sequence ${String(event.sequence)}`,
      { sequence: event.sequence },
    );
  }
}

function replayEvent(runtime, event) {
  assertEventEnvelope(runtime, event);
  let adjudicationCase = runtime.cases.get(event.caseId);

  if (event.type === "case.open") {
    const binding = caseBinding(runtime.store, event);
    if (
      binding.caseId !== event.caseId ||
      binding.taskKey !== event.taskKey ||
      binding.registryDigest !== event.registryDigest ||
      binding.sideEffectDigest !== event.sideEffectDigest ||
      adjudicationCase
    ) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
        "Invalid or duplicate team adjudication case binding",
        { caseId: event.caseId },
      );
    }
    const prior = runtime.byTask.get(event.taskKey) || [];
    const latest = prior[prior.length - 1] || null;
    if (
      latest &&
      (!latest.application ||
        latest.decision?.value !== TEAM_ADJUDICATION_DECISIONS.RETRY)
    ) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
        "Team adjudication log forks an active or terminal task case",
        { caseId: event.caseId, taskKey: event.taskKey },
      );
    }
    adjudicationCase = {
      binding,
      opened: event,
      decision: null,
      claim: null,
      application: null,
    };
    runtime.cases.set(event.caseId, adjudicationCase);
    prior.push(adjudicationCase);
    runtime.byTask.set(event.taskKey, prior);
  } else {
    if (!adjudicationCase) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
        "Team adjudication event refers to an unknown case",
        { caseId: event.caseId },
      );
    }
    if (event.type === "case.decide") {
      if (
        adjudicationCase.decision ||
        !DECISIONS.has(event.decision) ||
        requiredLabel(event.authority, "authority", 256) !== event.authority ||
        normalizeDigest(event.reasonDigest, "reasonDigest", {
          nullable: true,
        }) !== event.reasonDigest
      ) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
          "Invalid or duplicate team adjudication decision",
          { caseId: event.caseId },
        );
      }
      adjudicationCase.decision = {
        value: event.decision,
        authority: event.authority,
        reasonDigest: event.reasonDigest,
        event,
      };
    } else if (event.type === "case.claim") {
      if (
        !adjudicationCase.decision ||
        adjudicationCase.claim ||
        event.decisionDigest !== adjudicationCase.decision.event.digest ||
        !CLAIM_ID_PATTERN.test(event.claimId || "") ||
        requiredLabel(event.consumer, "consumer", 256) !== event.consumer
      ) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
          "Invalid or duplicate team adjudication claim",
          { caseId: event.caseId },
        );
      }
      adjudicationCase.claim = {
        claimId: event.claimId,
        consumer: event.consumer,
        decisionDigest: event.decisionDigest,
        event,
      };
    } else {
      if (
        !adjudicationCase.claim ||
        adjudicationCase.application ||
        event.claimDigest !== adjudicationCase.claim.event.digest ||
        normalizeDigest(event.outcomeDigest, "outcomeDigest") !==
          event.outcomeDigest
      ) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
          "Invalid or duplicate team adjudication application",
          { caseId: event.caseId },
        );
      }
      adjudicationCase.application = {
        claimDigest: event.claimDigest,
        outcomeDigest: event.outcomeDigest,
        event,
      };
    }
  }

  runtime.lastSequence = event.sequence;
  runtime.lastAt = event.at;
  runtime.headDigest = event.digest;
  runtime.digestBySequence.set(event.sequence, event.digest);
}

function recoveryFor(adjudicationCase) {
  if (!adjudicationCase.decision) {
    return {
      state: "adjudication_required",
      action: null,
      replaySafe: false,
    };
  }
  const action = TEAM_ADJUDICATION_ACTIONS[adjudicationCase.decision.value];
  if (!adjudicationCase.claim) {
    return { state: "decision_ready", action, replaySafe: false };
  }
  if (!adjudicationCase.application) {
    if (adjudicationCase.decision.value === TEAM_ADJUDICATION_DECISIONS.RETRY) {
      return {
        state: "retry_outcome_unknown",
        action: null,
        replaySafe: false,
      };
    }
    return {
      state: "settlement_recovery_required",
      action,
      replaySafe: true,
    };
  }
  return { state: "complete", action: null, replaySafe: false };
}

function caseView(adjudicationCase) {
  const revision = adjudicationCase.application
    ? 4
    : adjudicationCase.claim
      ? 3
      : adjudicationCase.decision
        ? 2
        : 1;
  const status = adjudicationCase.application
    ? "applied"
    : adjudicationCase.claim
      ? "claimed"
      : adjudicationCase.decision
        ? "authorized"
        : "pending";
  return {
    ...adjudicationCase.binding,
    status,
    revision,
    openedAt: adjudicationCase.opened.at,
    openDigest: adjudicationCase.opened.digest,
    decision: adjudicationCase.decision
      ? {
          value: adjudicationCase.decision.value,
          authority: adjudicationCase.decision.authority,
          reasonDigest: adjudicationCase.decision.reasonDigest,
          decidedAt: adjudicationCase.decision.event.at,
          decisionDigest: adjudicationCase.decision.event.digest,
        }
      : null,
    claim: adjudicationCase.claim
      ? {
          claimId: adjudicationCase.claim.claimId,
          consumer: adjudicationCase.claim.consumer,
          claimedAt: adjudicationCase.claim.event.at,
          claimDigest: adjudicationCase.claim.event.digest,
        }
      : null,
    application: adjudicationCase.application
      ? {
          outcomeDigest: adjudicationCase.application.outcomeDigest,
          appliedAt: adjudicationCase.application.event.at,
          applicationDigest: adjudicationCase.application.event.digest,
        }
      : null,
    recovery: recoveryFor(adjudicationCase),
  };
}

function cursorFromRuntime(runtime) {
  return {
    version: TEAM_ADJUDICATION_SCHEMA_VERSION,
    statePathDigest: runtime.store.statePathDigest,
    collaborationRunId: runtime.store.collaborationRunId,
    lastSequence: runtime.lastSequence,
    headDigest: runtime.headDigest,
  };
}

function emptyRuntime(store) {
  return {
    store,
    document: null,
    cases: new Map(),
    byTask: new Map(),
    digestBySequence: new Map(),
    lastSequence: 0,
    lastAt: 0,
    headDigest: null,
  };
}

function replayDocument(store, document) {
  assertExactKeys(document, HEADER_KEYS, "document");
  if (
    document.schema !== STORE_SCHEMA ||
    document.schemaVersion !== TEAM_ADJUDICATION_SCHEMA_VERSION ||
    document.statePath !== store.statePath ||
    document.statePathDigest !== store.statePathDigest ||
    document.collaborationRunId !== store.collaborationRunId ||
    !Number.isFinite(document.createdAt) ||
    document.createdAt < 0 ||
    !EVENT_DIGEST_PATTERN.test(document.bindingDigest || "") ||
    computeBindingDigest(document) !== document.bindingDigest ||
    !Array.isArray(document.events)
  ) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.BINDING_MISMATCH,
      "Team adjudication document does not match its state/run binding",
    );
  }
  if (document.events.length > store.maxEvents) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.LIMIT,
      `Team adjudication event limit exceeded (${store.maxEvents})`,
    );
  }
  if (document.events.length === 0) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
      "A persisted team adjudication document cannot have an empty log",
    );
  }

  const runtime = emptyRuntime(store);
  runtime.document = document;
  runtime.lastAt = document.createdAt;
  for (const event of document.events) replayEvent(runtime, event);
  return runtime;
}

function validateCursorIdentity(store, cursor) {
  if (
    !cursor ||
    cursor.version !== TEAM_ADJUDICATION_SCHEMA_VERSION ||
    cursor.statePathDigest !== store.statePathDigest ||
    cursor.collaborationRunId !== store.collaborationRunId ||
    !Number.isSafeInteger(cursor.lastSequence) ||
    cursor.lastSequence < 0 ||
    (cursor.lastSequence === 0
      ? cursor.headDigest !== null
      : !EVENT_DIGEST_PATTERN.test(cursor.headDigest || ""))
  ) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.ROLLBACK,
      "Invalid or mismatched team adjudication recovery cursor",
    );
  }
}

function validateAnchor(runtime, anchor) {
  if (anchor == null) return;
  validateCursorIdentity(runtime.store, anchor);
  const matches =
    anchor.lastSequence === 0
      ? anchor.headDigest === null
      : runtime.digestBySequence.get(anchor.lastSequence) === anchor.headDigest;
  if (anchor.lastSequence > runtime.lastSequence || !matches) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.ROLLBACK,
      "Team adjudication log rolled back or diverged from its recovery cursor",
      {
        expectedSequence: anchor.lastSequence,
        actualSequence: runtime.lastSequence,
      },
    );
  }
}

function validateExpectedCursor(runtime, expectedCursor) {
  if (expectedCursor == null) return;
  validateCursorIdentity(runtime.store, expectedCursor);
  if (
    expectedCursor.lastSequence !== runtime.lastSequence ||
    expectedCursor.headDigest !== runtime.headDigest
  ) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.STALE,
      "Team adjudication mutation was based on a stale cursor",
      {
        expectedSequence: expectedCursor.lastSequence,
        actualSequence: runtime.lastSequence,
      },
    );
  }
}

function validateRevision(adjudicationCase, expectedRevision) {
  const current = caseView(adjudicationCase).revision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current) {
    throw adjudicationError(
      TEAM_ADJUDICATION_ERROR_CODES.STALE,
      `Team adjudication case revision changed (expected ${String(
        expectedRevision,
      )}, actual ${current})`,
      {
        caseId: adjudicationCase.binding.caseId,
        expectedRevision,
        actualRevision: current,
      },
    );
  }
}

function appendEvent(runtime, event) {
  replayEvent(runtime, event);
  runtime.document.events.push(event);
}

/**
 * Durable store/control protocol shared by the CLI coordinator and IDE-facing
 * adapters. All methods are synchronous so one strict cross-process lock covers
 * each complete read/verify/mutate/atomic-write transaction.
 */
export class TeamAdjudicationStore {
  constructor({
    statePath,
    collaborationRunId,
    filePath = null,
    now = () => Date.now(),
    lockTimeoutMs = 2000,
    lockStaleMs = 30_000,
    maxEvents = MAX_TEAM_ADJUDICATION_EVENTS,
    maxBytes = MAX_TEAM_ADJUDICATION_BYTES,
    _fs = fs,
    _lock = withFileLock,
    _randomUUID = randomUUID,
    _platform = process.platform,
    _sleep = sleepSync,
  } = {}) {
    this._fs = _fs;
    this._lock = _lock;
    this._randomUUID = _randomUUID;
    this._platform = _platform;
    this._sleep = typeof _sleep === "function" ? _sleep : sleepSync;
    this._now = typeof now === "function" ? now : () => Number(now);
    this.lockTimeoutMs = Math.max(0, Number(lockTimeoutMs) || 0);
    this.lockStaleMs = Math.max(1, Number(lockStaleMs) || 30_000);
    this.maxEvents = Math.max(
      1,
      Math.min(
        MAX_TEAM_ADJUDICATION_EVENTS,
        Math.floor(Number(maxEvents) || MAX_TEAM_ADJUDICATION_EVENTS),
      ),
    );
    this.maxBytes = Math.max(
      1024,
      Math.min(
        MAX_TEAM_ADJUDICATION_BYTES,
        Math.floor(Number(maxBytes) || MAX_TEAM_ADJUDICATION_BYTES),
      ),
    );

    this.statePath = canonicalAuthorityPath(this._fs, statePath, "statePath", {
      mustExist: true,
    });
    this.collaborationRunId = normalizeRunId(collaborationRunId);
    this.statePathDigest = sha256(
      "cc-team-adjudication-state-path-v1",
      pathIdentity(this.statePath, this._platform),
    );
    const requestedFile =
      filePath == null ? `${this.statePath}.adjudication.json` : filePath;
    this.filePath = canonicalAuthorityPath(
      this._fs,
      requestedFile,
      "filePath",
      { mustExist: false },
    );
    this.lockPath = `${this.filePath}.lock`;
  }

  _assertAuthorityPaths() {
    const currentStatePath = canonicalAuthorityPath(
      this._fs,
      this.statePath,
      "statePath",
      { mustExist: true },
    );
    if (
      pathIdentity(currentStatePath, this._platform) !==
      pathIdentity(this.statePath, this._platform)
    ) {
      throw unsafePath(
        "Team state canonical path changed after adjudication binding",
        this.statePath,
      );
    }
    const currentFile = canonicalAuthorityPath(
      this._fs,
      this.filePath,
      "filePath",
      { mustExist: false },
    );
    if (
      pathIdentity(currentFile, this._platform) !==
      pathIdentity(this.filePath, this._platform)
    ) {
      throw unsafePath(
        "Team adjudication canonical path changed",
        this.filePath,
      );
    }
    const adjudicationEntry = assertRegularSingleLink(this._fs, this.filePath, {
      allowMissing: true,
      requireMode0600: true,
      platform: this._platform,
    });
    const lockEntry = lstatOrNull(this._fs, this.lockPath);
    if (lockEntry && (lockEntry.isSymbolicLink() || !lockEntry.isDirectory())) {
      throw unsafePath(
        "Team adjudication lock path must be a non-symlink directory",
        this.lockPath,
      );
    }
    return adjudicationEntry;
  }

  _secureRead() {
    try {
      return withTrustedFileParentSync(
        this._fs,
        this.filePath,
        ({ canonicalPath, parentDevice }) => {
          const before = assertRegularSingleLink(this._fs, canonicalPath, {
            bigint: true,
            requireMode0600: true,
            platform: this._platform,
          });
          if (Number(before.size) <= 0 || Number(before.size) > this.maxBytes) {
            throw adjudicationError(
              TEAM_ADJUDICATION_ERROR_CODES.LIMIT,
              `Team adjudication file must be between 1 and ${this.maxBytes} bytes`,
            );
          }
          let descriptor = null;
          try {
            const flags =
              Number(this._fs.constants?.O_RDONLY ?? fs.constants.O_RDONLY) |
              Number(
                this._fs.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0,
              );
            descriptor = this._fs.openSync(canonicalPath, flags);
            const opened = this._fs.fstatSync(descriptor, { bigint: true });
            if (
              !opened.isFile() ||
              Number(opened.nlink) !== 1 ||
              !samePathHandleFileIdentity(before, opened, parentDevice)
            ) {
              throw unsafePath(
                "Team adjudication file identity changed while opening",
                this.filePath,
              );
            }
            const bytes = this._fs.readFileSync(descriptor);
            const after = this._fs.fstatSync(descriptor, { bigint: true });
            if (
              !sameFileStatIdentity(opened, after) ||
              Number(after.size) !== bytes.length
            ) {
              throw unsafePath(
                "Team adjudication file changed while reading",
                this.filePath,
              );
            }
            return bytes;
          } finally {
            if (descriptor !== null) {
              try {
                this._fs.closeSync(descriptor);
              } catch {
                // The authoritative read error, if any, is reported above.
              }
            }
          }
        },
      );
    } catch (cause) {
      if (isAdjudicationError(cause)) throw cause;
      if (cause instanceof SecureFileIdentityError) {
        throw unsafePath(
          "Team adjudication parent identity is unsafe",
          this.filePath,
          cause,
        );
      }
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.READ_FAILED,
        "Could not securely read team adjudication state",
        { filePath: this.filePath },
        cause,
      );
    }
  }

  _decodeDocument(bytes) {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (cause) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
        "Team adjudication state is not valid UTF-8",
        {},
        cause,
      );
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("not an object");
      }
      return parsed;
    } catch (cause) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
        "Team adjudication state is not valid JSON",
        {},
        cause,
      );
    }
  }

  _readRuntime() {
    const entry = this._assertAuthorityPaths();
    if (!entry) return emptyRuntime(this);
    return replayDocument(this, this._decodeDocument(this._secureRead()));
  }

  _newRuntime(at) {
    const document = {
      ...bindingHeader({
        statePath: this.statePath,
        statePathDigest: this.statePathDigest,
        collaborationRunId: this.collaborationRunId,
        createdAt: at,
      }),
      bindingDigest: null,
      events: [],
    };
    document.bindingDigest = computeBindingDigest(document);
    const runtime = emptyRuntime(this);
    runtime.document = document;
    runtime.lastAt = at;
    return runtime;
  }

  _atomicWrite(document) {
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > this.maxBytes) {
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.LIMIT,
        `Team adjudication file cannot exceed ${this.maxBytes} bytes`,
      );
    }

    // Security precondition: the canonical parent and its ancestors cannot be
    // renamed by an untrusted concurrent writer during this callback. Node's
    // path-based primitives are not an openat-style authority boundary.
    try {
      return withTrustedFileParentSync(
        this._fs,
        this.filePath,
        ({ canonicalPath, parentPath, parentDescriptor }) => {
          const token = String(this._randomUUID()).replace(
            /[^a-zA-Z0-9._-]/g,
            "-",
          );
          const temporaryPath = path.join(
            parentPath,
            `.${path.basename(canonicalPath)}.${process.pid}.${token}.tmp`,
          );
          let descriptor = null;
          let renamed = false;
          let temporaryCreated = false;
          const flags =
            Number(this._fs.constants?.O_WRONLY ?? fs.constants.O_WRONLY) |
            Number(this._fs.constants?.O_CREAT ?? fs.constants.O_CREAT) |
            Number(this._fs.constants?.O_EXCL ?? fs.constants.O_EXCL) |
            Number(
              this._fs.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0,
            );
          try {
            descriptor = this._fs.openSync(temporaryPath, flags, 0o600);
            temporaryCreated = true;
            this._fs.writeFileSync(descriptor, serialized, "utf8");
            this._fs.fsyncSync(descriptor);
            const temporaryStat = this._fs.fstatSync(descriptor);
            if (!temporaryStat.isFile() || Number(temporaryStat.nlink) !== 1) {
              throw unsafePath(
                "Atomic team adjudication temporary file is not private",
                temporaryPath,
              );
            }
            this._fs.closeSync(descriptor);
            descriptor = null;

            this._assertAuthorityPaths();
            let renameAttempt = 0;
            for (;;) {
              try {
                this._fs.renameSync(temporaryPath, canonicalPath);
                break;
              } catch (cause) {
                const delay = WINDOWS_RENAME_RETRY_DELAYS_MS[renameAttempt];
                if (
                  this._platform !== "win32" ||
                  !WINDOWS_RENAME_TRANSIENT_CODES.has(cause?.code) ||
                  delay === undefined
                ) {
                  throw cause;
                }
                renameAttempt += 1;
                this._sleep(delay);
                // Keep each retry bound to the same canonical authority after
                // yielding to a transient Windows file-sharing holder.
                this._assertAuthorityPaths();
              }
            }
            renamed = true;
            this._fs.chmodSync(canonicalPath, 0o600);
            const persisted = this._secureRead();
            if (!persisted.equals(Buffer.from(serialized, "utf8"))) {
              throw adjudicationError(
                TEAM_ADJUDICATION_ERROR_CODES.WRITE_FAILED,
                "Atomic team adjudication write verification failed",
              );
            }
            if (this._platform !== "win32") {
              this._fs.fsyncSync(parentDescriptor);
            }
          } finally {
            if (descriptor !== null) {
              try {
                this._fs.closeSync(descriptor);
              } catch {
                // Best-effort descriptor cleanup.
              }
            }
            if (!renamed && temporaryCreated) {
              try {
                this._fs.unlinkSync(temporaryPath);
              } catch {
                // Clean only this attempt's canonical temporary path.
              }
            }
          }
        },
      );
    } catch (cause) {
      if (cause instanceof SecureFileIdentityError) {
        throw unsafePath(
          "Team adjudication parent identity is unsafe",
          this.filePath,
          cause,
        );
      }
      if (isAdjudicationError(cause)) throw cause;
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.WRITE_FAILED,
        "Could not atomically persist team adjudication state",
        { filePath: this.filePath },
        cause,
      );
    }
  }

  _withLock(operation, callback) {
    this._assertAuthorityPaths();
    try {
      return this._lock(
        this.filePath,
        () => {
          this._assertAuthorityPaths();
          return callback(this._readRuntime());
        },
        {
          timeoutMs: this.lockTimeoutMs,
          staleMs: this.lockStaleMs,
          failIfUnavailable: true,
        },
      );
    } catch (cause) {
      if (isAdjudicationError(cause)) throw cause;
      if (
        cause?.code === "STATE_LOCK_UNAVAILABLE" ||
        cause?.code === "STATE_LOCK_OWNERSHIP_LOST"
      ) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.LOCK_UNAVAILABLE,
          `Could not hold the strict team adjudication lock for ${operation}`,
          { filePath: this.filePath },
          cause,
        );
      }
      throw adjudicationError(
        TEAM_ADJUDICATION_ERROR_CODES.WRITE_FAILED,
        `Team adjudication ${operation} failed closed`,
        { filePath: this.filePath },
        cause,
      );
    }
  }

  _result(runtime, adjudicationCase, extra = {}) {
    return {
      case: caseView(adjudicationCase),
      cursor: cursorFromRuntime(runtime),
      ...extra,
    };
  }

  /** Read and verify the complete log, optionally proving a recovery prefix. */
  read({ anchor = null } = {}) {
    return this._withLock("read", (runtime) => {
      validateAnchor(runtime, anchor);
      return {
        statePath: this.statePath,
        statePathDigest: this.statePathDigest,
        collaborationRunId: this.collaborationRunId,
        cases: [...runtime.cases.values()].map(caseView),
        cursor: cursorFromRuntime(runtime),
      };
    });
  }

  getCase(input, { anchor = null } = {}) {
    const binding = caseBinding(this, input);
    return this._withLock("get", (runtime) => {
      validateAnchor(runtime, anchor);
      const adjudicationCase = runtime.cases.get(binding.caseId);
      return adjudicationCase ? caseView(adjudicationCase) : null;
    });
  }

  /** Open one case against immutable registry + side-effect evidence digests. */
  openCase(input, { anchor = null, expectedCursor = null } = {}) {
    const binding = caseBinding(this, input);
    return this._withLock("open", (loaded) => {
      validateAnchor(loaded, anchor);
      const existing = loaded.cases.get(binding.caseId);
      if (existing) {
        return this._result(loaded, existing, { duplicate: true });
      }
      validateExpectedCursor(loaded, expectedCursor);

      const prior = loaded.byTask.get(binding.taskKey) || [];
      const latest = prior[prior.length - 1] || null;
      if (
        latest &&
        (!latest.application ||
          latest.decision?.value !== TEAM_ADJUDICATION_DECISIONS.RETRY)
      ) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.CONFLICT,
          `Task "${binding.taskKey}" already has an active or terminal adjudication`,
          { taskKey: binding.taskKey, caseId: latest.binding.caseId },
        );
      }

      const at = normalizeFiniteTime(this._now(), "clock");
      const runtime = loaded.document ? loaded : this._newRuntime(at);
      const event = buildEvent(runtime, "case.open", binding.caseId, at, {
        taskKey: binding.taskKey,
        registryDigest: binding.registryDigest,
        sideEffectDigest: binding.sideEffectDigest,
      });
      appendEvent(runtime, event);
      this._atomicWrite(runtime.document);
      return this._result(runtime, runtime.cases.get(binding.caseId), {
        duplicate: false,
      });
    });
  }

  /**
   * Record the sole decision for a case. An exact retry of the same API request
   * is idempotent; any different authority, reason digest, or decision conflicts.
   */
  decideCase(input, { anchor = null, expectedCursor = null } = {}) {
    const binding = caseBinding(this, input);
    const decision = normalizeDecision(input?.decision);
    const authority = requiredLabel(input?.authority, "authority", 256);
    const reasonDigest = normalizeDigest(input?.reasonDigest, "reasonDigest", {
      nullable: true,
    });
    return this._withLock("decide", (runtime) => {
      validateAnchor(runtime, anchor);
      const adjudicationCase = runtime.cases.get(binding.caseId);
      if (!adjudicationCase) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.NOT_FOUND,
          "Team adjudication case was not found",
          { caseId: binding.caseId },
        );
      }
      if (adjudicationCase.decision) {
        const same =
          adjudicationCase.decision.value === decision &&
          adjudicationCase.decision.authority === authority &&
          adjudicationCase.decision.reasonDigest === reasonDigest;
        if (!same) {
          throw adjudicationError(
            TEAM_ADJUDICATION_ERROR_CODES.CONFLICT,
            "Team adjudication case already has a conflicting decision",
            { caseId: binding.caseId },
          );
        }
        return this._result(runtime, adjudicationCase, { duplicate: true });
      }
      validateRevision(adjudicationCase, input?.expectedRevision);
      validateExpectedCursor(runtime, expectedCursor);
      const event = buildEvent(
        runtime,
        "case.decide",
        binding.caseId,
        normalizeFiniteTime(this._now(), "clock"),
        { decision, authority, reasonDigest },
      );
      appendEvent(runtime, event);
      this._atomicWrite(runtime.document);
      return this._result(runtime, adjudicationCase, { duplicate: false });
    });
  }

  /**
   * Consume a decision once. Only a fresh claim returns an `authorization`;
   * duplicate calls return `authorization:null`, so retry cannot be replayed.
   */
  claimDecision(input, { anchor = null, expectedCursor = null } = {}) {
    const binding = caseBinding(this, input);
    const decisionDigest = normalizeDigest(
      input?.decisionDigest,
      "decisionDigest",
    );
    const consumer = requiredLabel(input?.consumer, "consumer", 256);
    return this._withLock("claim", (runtime) => {
      validateAnchor(runtime, anchor);
      const adjudicationCase = runtime.cases.get(binding.caseId);
      if (!adjudicationCase?.decision) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.NOT_FOUND,
          "A decided team adjudication case was not found",
          { caseId: binding.caseId },
        );
      }
      if (adjudicationCase.claim) {
        const same =
          adjudicationCase.claim.decisionDigest === decisionDigest &&
          adjudicationCase.claim.consumer === consumer;
        if (!same) {
          throw adjudicationError(
            TEAM_ADJUDICATION_ERROR_CODES.ALREADY_CLAIMED,
            "Team adjudication decision was already claimed",
            { caseId: binding.caseId },
          );
        }
        return this._result(runtime, adjudicationCase, {
          duplicate: true,
          authorization: null,
        });
      }
      if (adjudicationCase.decision.event.digest !== decisionDigest) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.BINDING_MISMATCH,
          "Decision digest does not bind the current adjudication decision",
          { caseId: binding.caseId },
        );
      }
      validateRevision(adjudicationCase, input?.expectedRevision);
      validateExpectedCursor(runtime, expectedCursor);
      const claimId = `tadj_claim_${String(this._randomUUID())}`;
      if (!CLAIM_ID_PATTERN.test(claimId)) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.INVALID,
          "Generated adjudication claim id is invalid",
        );
      }
      const event = buildEvent(
        runtime,
        "case.claim",
        binding.caseId,
        normalizeFiniteTime(this._now(), "clock"),
        { decisionDigest, claimId, consumer },
      );
      appendEvent(runtime, event);
      this._atomicWrite(runtime.document);
      return this._result(runtime, adjudicationCase, {
        duplicate: false,
        authorization: {
          caseId: binding.caseId,
          claimId,
          claimDigest: event.digest,
          decisionDigest,
          action: TEAM_ADJUDICATION_ACTIONS[adjudicationCase.decision.value],
        },
      });
    });
  }

  /**
   * Confirm that the claimed action and the corresponding team-state update
   * were durably applied. The outcome is represented only by a digest.
   */
  completeCase(input, { anchor = null, expectedCursor = null } = {}) {
    const binding = caseBinding(this, input);
    const claimDigest = normalizeDigest(input?.claimDigest, "claimDigest");
    const outcomeDigest = normalizeDigest(
      input?.outcomeDigest,
      "outcomeDigest",
    );
    return this._withLock("apply", (runtime) => {
      validateAnchor(runtime, anchor);
      const adjudicationCase = runtime.cases.get(binding.caseId);
      if (!adjudicationCase?.claim) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.NOT_FOUND,
          "A claimed team adjudication case was not found",
          { caseId: binding.caseId },
        );
      }
      if (adjudicationCase.application) {
        const same =
          adjudicationCase.application.claimDigest === claimDigest &&
          adjudicationCase.application.outcomeDigest === outcomeDigest;
        if (!same) {
          throw adjudicationError(
            TEAM_ADJUDICATION_ERROR_CODES.CONFLICT,
            "Team adjudication case already has a conflicting application",
            { caseId: binding.caseId },
          );
        }
        return this._result(runtime, adjudicationCase, { duplicate: true });
      }
      if (adjudicationCase.claim.event.digest !== claimDigest) {
        throw adjudicationError(
          TEAM_ADJUDICATION_ERROR_CODES.BINDING_MISMATCH,
          "Claim digest does not bind the current adjudication claim",
          { caseId: binding.caseId },
        );
      }
      validateRevision(adjudicationCase, input?.expectedRevision);
      validateExpectedCursor(runtime, expectedCursor);
      const event = buildEvent(
        runtime,
        "case.apply",
        binding.caseId,
        normalizeFiniteTime(this._now(), "clock"),
        { claimDigest, outcomeDigest },
      );
      appendEvent(runtime, event);
      this._atomicWrite(runtime.document);
      return this._result(runtime, adjudicationCase, { duplicate: false });
    });
  }
}
