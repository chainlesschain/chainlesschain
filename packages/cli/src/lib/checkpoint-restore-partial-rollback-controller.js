/**
 * Durable partial-mutation rollback controller.
 *
 * The controller owns only orchestration and authority validation. Engine
 * adapters prepare and execute an exact rollback plan; session helpers read or
 * append the timeline settlement. Lock order is always:
 *
 *   workspace recovery lease -> session authority -> short saga CAS
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "./checkpoint-restore-saga.js";
import { computeCheckpointRestoreDigest } from "./checkpoint-restore-orchestrator.js";
import {
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OUTCOME,
  CHECKPOINT_RESTORE_ROLLBACK_CONVERSATION_DISPOSITION,
  CHECKPOINT_RESTORE_SESSION_RECONCILIATION,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
  appendCheckpointRestoreRecoveryResolution,
  computeCheckpointRestoreSessionRollbackCommitDigest,
  reconcileCheckpointRestoreRecoveryResolutionProjection,
} from "./checkpoint-restore-session-recovery.js";
import {
  inspectWorkspaceLockOwnerSync,
  withWorkspaceRecoveryLockSync,
} from "./process-execution-broker/workspace-transaction.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RAW_HASH_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const GIT_IDENTITY_PATTERN = /^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const GIT_TREE_PATTERN = /^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const COPY_IDENTITY_PATTERN = /^sha256:[a-f0-9]{64}$/;
const WORKSPACE_BINDING_SCHEMA = "cc-checkpoint-workspace-binding/v1";
const CHECKPOINT_RESTORE_PURPOSE = "checkpoint-restore";
const RECOVERY_ADMIN_PHASES = new Set([
  "recovery_required",
  "recovery_started",
]);
const ROLLBACK_PROTOCOL_PHASES = new Set([
  ...RECOVERY_ADMIN_PHASES,
  "rollback_prepared",
  "rollback_started",
  "workspace_rolled_back",
  "session_rollback_committed",
]);
const NON_SETTLED_BASE_PHASES = new Set([
  "mutation_started",
  "rollback_prepared",
  "rollback_started",
]);
const TIMELINE_RESUMABLE_CLASSIFICATIONS = new Set([
  CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CODE_SETTLEMENT_RESUMABLE,
  CHECKPOINT_RESTORE_SESSION_RECONCILIATION.BOTH_SETTLEMENT_RESUMABLE,
]);
const ACTIONS = new Set(["restore-code", "restore-both"]);

export const CHECKPOINT_ROLLBACK_PLAN_SCHEMA =
  "chainlesschain.checkpoint-rollback-plan";
export const CHECKPOINT_ROLLBACK_PLAN_VERSION = 1;
export const CHECKPOINT_ROLLBACK_RESULT_SCHEMA =
  "chainlesschain.checkpoint-rollback-result";
export const CHECKPOINT_ROLLBACK_RESULT_VERSION = 1;
export const CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_SCHEMA =
  "chainlesschain.checkpoint-restore-partial-rollback-result";
export const CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_VERSION = 1;

export { CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION };

export const CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_INVALID_ARGUMENT",
  SAGA_CONFLICT: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_SAGA_CONFLICT",
  ACTION_NOT_ALLOWED: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION_NOT_ALLOWED",
  OWNER_CONFLICT: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OWNER_CONFLICT",
  PLAN_INVALID: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_PLAN_INVALID",
  RESULT_INVALID: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_INVALID",
  SESSION_CONFLICT: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_SESSION_CONFLICT",
  ASYNC_UNSUPPORTED: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ASYNC_UNSUPPORTED",
});

export class CheckpointRestorePartialRollbackError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "CheckpointRestorePartialRollbackError";
    this.code = code;
    Object.assign(this, details);
  }
}

function rollbackError(code, message, details = {}, cause = null) {
  return new CheckpointRestorePartialRollbackError(
    code,
    message,
    details,
    cause,
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function immutable(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutable(entry)));
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = immutable(entry);
    }
    return Object.freeze(result);
  }
  return value;
}

function canonicalJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw rollbackError(
    CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.INVALID_ARGUMENT,
    "Checkpoint rollback evidence is not canonical JSON",
  );
}

function boundedText(value, fallback, maximum = 2_048) {
  let sanitized = "";
  for (const character of String(value || fallback)) {
    const code = character.charCodeAt(0);
    sanitized += code < 32 || code === 127 ? " " : character;
  }
  return (sanitized.trim() || fallback).slice(0, maximum);
}

function validText(value, maximum = 1_024) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes("\0") &&
    value.trim() === value
  );
}

function asError(value) {
  return value && typeof value === "object"
    ? value
    : new Error(String(value || "checkpoint rollback failed"));
}

function isThenable(value) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  try {
    return typeof value.then === "function";
  } catch (cause) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ASYNC_UNSUPPORTED,
      "Checkpoint rollback result exposed an unsafe thenable",
      {},
      cause,
    );
  }
}

function requireSynchronous(value, boundary) {
  if (isThenable(value)) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ASYNC_UNSUPPORTED,
      `${boundary} must be synchronous while workspace authority is held`,
    );
  }
  return value;
}

function assertLeaseOwnedSync(lease, boundary = "workspace lease assertion") {
  if (!lease || typeof lease.assertOwned !== "function") {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.OWNER_CONFLICT,
      "Checkpoint rollback requires an active workspace recovery lease",
    );
  }
  return requireSynchronous(lease.assertOwned(), boundary);
}

function pathKey(value, platform) {
  if (!validText(value, 4_096) || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right, platform) {
  const leftKey = pathKey(left, platform);
  return leftKey !== null && leftKey === pathKey(right, platform);
}

function uniqueEvent(saga, phase) {
  const matches = saga.events.filter((event) => event?.phase === phase);
  return matches.length === 1 ? matches[0] : null;
}

function currentRecoveryBaseEvent(saga) {
  return (
    [...saga.events]
      .reverse()
      .find((event) => !RECOVERY_ADMIN_PHASES.has(event?.phase)) || null
  );
}

function originalDurableBaseEvent(saga) {
  return (
    [...saga.events]
      .reverse()
      .find((event) => !ROLLBACK_PROTOCOL_PHASES.has(event?.phase)) || null
  );
}

function validateExpectedAuthority({
  operationId,
  expectedSeq,
  expectedHash,
  expectedOwnerDigest,
}) {
  if (
    !OPERATION_ID_PATTERN.test(String(operationId || "")) ||
    !Number.isSafeInteger(expectedSeq) ||
    expectedSeq < 1 ||
    !DIGEST_PATTERN.test(String(expectedHash || "")) ||
    !DIGEST_PATTERN.test(String(expectedOwnerDigest || ""))
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.INVALID_ARGUMENT,
      "Partial rollback requires an exact saga head and retained owner digest",
    );
  }
}

function exactSaga(saga, operationId, expectedSeq, expectedHash) {
  if (
    !saga ||
    saga.operationId !== operationId ||
    saga.seq !== expectedSeq ||
    saga.headHash !== expectedHash
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.SAGA_CONFLICT,
      "Checkpoint restore saga changed after rollback preview",
      {
        operationId,
        expectedSeq,
        expectedHash,
        actualSeq: saga?.seq ?? null,
        actualHash: saga?.headHash ?? null,
      },
    );
  }
  return saga;
}

function stateDigest(domain, engine, binding, stateIdentity) {
  return computeCheckpointRestoreDigest(domain, {
    engine,
    scopeIdentity: binding.scopeIdentity,
    stateIdentity,
  });
}

function originalPrestateDigest(engine, binding) {
  return stateDigest(
    "cc-checkpoint-restore-prestate-v1",
    engine,
    binding,
    binding.prestateIdentity,
  );
}

function rollbackPrestateDigest(engine, binding) {
  return stateDigest(
    "cc-checkpoint-restore-rollback-prestate-v1",
    engine,
    binding,
    binding.prestateIdentity,
  );
}

function rollbackStateDigest(engine, binding) {
  return stateDigest(
    "cc-checkpoint-restore-rollback-state-v1",
    engine,
    binding,
    binding.targetPoststateIdentity,
  );
}

function mutationSetIdentity(engine, paths) {
  return computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-original-mutation-set-v1",
    { engine, paths },
  );
}

function rollbackResultDigest(operationId, recoveryRequestId, plan, result) {
  return computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-rollback-result-v1",
    {
      operationId,
      recoveryRequestId,
      restoreKind: plan.engine,
      safetyCheckpoint: {
        id: plan.safetyCheckpoint.id,
        identity: plan.safetyCheckpoint.identity,
        planIdentity: plan.safetyCheckpoint.planIdentity,
      },
      originalMutationTargetCount: plan.originalMutationTargetCount,
      targetCount: plan.targetCount,
      rolledBackCount: result.rolledBackCount,
      rollbackPlanIdentity: plan.rollbackPlanIdentity,
      rollbackStateDigest: result.rollbackStateDigest,
    },
  );
}

function settledRollbackResultDigest(authority, settlement) {
  return computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-rollback-result-v1",
    {
      operationId: authority.operationId,
      recoveryRequestId: settlement.recoveryRequestId,
      restoreKind: authority.restoreKind,
      safetyCheckpoint: {
        id: authority.safetyId,
        identity: authority.safetyIdentity,
        planIdentity: authority.safetyPlanIdentity,
      },
      originalMutationTargetCount: settlement.originalMutationTargetCount,
      targetCount: settlement.targetCount,
      rolledBackCount: settlement.rolledBackCount,
      rollbackPlanIdentity: settlement.rollbackPlanIdentity,
      rollbackStateDigest: settlement.rollbackStateDigest,
    },
  );
}

function validWorkspaceBinding(value, engine, workspaceRoot, platform) {
  const statePattern = engine === "git" ? GIT_TREE_PATTERN : DIGEST_PATTERN;
  return (
    exactKeys(value, [
      "engine",
      "prestateIdentity",
      "schema",
      "scopeIdentity",
      "targetPoststateIdentity",
      "version",
      "workspaceRoot",
      "writePlanIdentity",
    ]) &&
    value.schema === WORKSPACE_BINDING_SCHEMA &&
    value.version === 1 &&
    value.engine === engine &&
    samePath(value.workspaceRoot, workspaceRoot, platform) &&
    DIGEST_PATTERN.test(String(value.scopeIdentity || "")) &&
    statePattern.test(String(value.prestateIdentity || "")) &&
    DIGEST_PATTERN.test(String(value.writePlanIdentity || "")) &&
    statePattern.test(String(value.targetPoststateIdentity || ""))
  );
}

function validCanonicalPaths(value) {
  if (!Array.isArray(value)) return false;
  const normalized = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > 4_096 ||
      entry.includes("\0") ||
      entry.includes("\\") ||
      path.posix.isAbsolute(entry) ||
      path.win32.isAbsolute(entry)
    ) {
      return false;
    }
    const segments = entry.split("/");
    if (
      segments.some(
        (segment) =>
          segment.length === 0 || segment === "." || segment === "..",
      )
    ) {
      return false;
    }
    normalized.push(entry);
  }
  const canonical = [...new Set(normalized)].sort();
  return (
    canonical.length === value.length &&
    canonical.every((v, i) => v === value[i])
  );
}

function canonicalPathSubset(values, candidates) {
  const candidateSet = new Set(candidates);
  return values.every((entry) => candidateSet.has(entry));
}

function partialRollbackSagaAuthority(saga, workspaceRoot, platform) {
  const created = uniqueEvent(saga, "created");
  const prepared = uniqueEvent(saga, "prepared");
  const intent = uniqueEvent(saga, "intent_committed");
  const safety = uniqueEvent(saga, "safety_ready");
  const mutation = uniqueEvent(saga, "mutation_started");
  const originalBase = originalDurableBaseEvent(saga);
  const c = created?.evidence;
  const p = prepared?.evidence;
  const i = intent?.evidence;
  const s = safety?.evidence;
  const m = mutation?.evidence;
  const direct = c?.restoreSurface === "direct";
  const timeline = c?.restoreSurface === "timeline";
  const timelineAuthority =
    timeline &&
    i?.intentAuthority === "session" &&
    validText(c?.sessionId, 256) &&
    validText(c?.timelineEntryId, 256) &&
    i.sessionId === c.sessionId &&
    i.timelineEntryId === c.timelineEntryId;
  const directAuthority =
    direct &&
    i?.intentAuthority === "operation" &&
    c?.sessionId == null &&
    c?.timelineEntryId == null &&
    i?.sessionId == null &&
    i?.timelineEntryId == null;

  if (
    saga.terminal ||
    originalBase?.phase !== "mutation_started" ||
    !created ||
    !prepared ||
    !intent ||
    !safety ||
    !mutation ||
    !["git", "copy"].includes(c?.restoreKind) ||
    (!directAuthority && !timelineAuthority) ||
    !samePath(c?.workspaceRoot, workspaceRoot, platform) ||
    !validText(c?.checkpointId, 256) ||
    !validText(c?.checkpointIdentity) ||
    (c.restoreKind === "git" && !validText(c?.checkpointNamespace, 256)) ||
    (c.restoreKind === "copy" && c?.checkpointNamespace != null) ||
    !DIGEST_PATTERN.test(String(c?.workspaceBinding || "")) ||
    !DIGEST_PATTERN.test(String(c?.confirmationDigest || "")) ||
    !DIGEST_PATTERN.test(String(p?.prestateDigest || "")) ||
    p?.workspaceBinding !== c.workspaceBinding ||
    !Number.isSafeInteger(p?.targetCount) ||
    p.targetCount <= 0 ||
    !DIGEST_PATTERN.test(String(i?.intentCommitDigest || "")) ||
    s?.safetyCoverage !== "full" ||
    !validText(s?.safetyId, 256) ||
    !validText(s?.safetyIdentity) ||
    !DIGEST_PATTERN.test(String(s?.safetyPlanIdentity || "")) ||
    m?.targetCount !== p.targetCount
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ACTION_NOT_ALLOWED,
      "Partial rollback requires one exact mutation_started restore with full safety authority",
      {
        operationId: saga.operationId,
        phase: saga.phase,
        originalBasePhase: originalBase?.phase || null,
      },
    );
  }

  return immutable({
    restoreKind: c.restoreKind,
    restoreSurface: c.restoreSurface,
    checkpointNamespace: c.checkpointNamespace || null,
    checkpointId: c.checkpointId,
    checkpointIdentity: c.checkpointIdentity,
    workspaceWritePlanIdentity: c.workspaceBinding,
    confirmationDigest: c.confirmationDigest,
    originalPrestateDigest: p.prestateDigest,
    originalMutationTargetCount: p.targetCount,
    intentCommitDigest: i.intentCommitDigest,
    sessionId: c.sessionId || null,
    timelineEntryId: c.timelineEntryId || null,
    safetyId: s.safetyId,
    safetyIdentity: s.safetyIdentity,
    safetyPlanIdentity: s.safetyPlanIdentity,
  });
}

const PLAN_KEYS = Object.freeze([
  "checkpointNamespace",
  "currentRollbackPaths",
  "engine",
  "expectedRollbackStateDigest",
  "expectedWorkspaceBinding",
  "originalBindingVerification",
  "originalCheckpoint",
  "originalMutationPaths",
  "originalMutationTargetCount",
  "originalPlanAuthority",
  "originalWorkspaceBinding",
  "rollbackPlanIdentity",
  "rollbackPrestateDigest",
  "safetyCheckpoint",
  "schema",
  "targetCount",
  "version",
  "workspaceRoot",
]);

function validateCheckpointAuthority(plan, authority) {
  const original = plan.originalCheckpoint;
  const safety = plan.safetyCheckpoint;
  const originalIdentityPattern =
    plan.engine === "git" ? GIT_IDENTITY_PATTERN : COPY_IDENTITY_PATTERN;
  const treeIdentityPattern = plan.engine === "git" ? GIT_TREE_PATTERN : null;
  return (
    exactKeys(original, ["id", "identity", "treeIdentity"]) &&
    exactKeys(safety, ["id", "identity", "planIdentity", "treeIdentity"]) &&
    original.id === authority.checkpointId &&
    original.identity === authority.checkpointIdentity &&
    originalIdentityPattern.test(String(original.identity || "")) &&
    safety.id === authority.safetyId &&
    safety.identity === authority.safetyIdentity &&
    originalIdentityPattern.test(String(safety.identity || "")) &&
    safety.planIdentity === authority.safetyPlanIdentity &&
    DIGEST_PATTERN.test(String(safety.planIdentity || "")) &&
    (plan.engine === "git"
      ? treeIdentityPattern.test(String(original.treeIdentity || "")) &&
        treeIdentityPattern.test(String(safety.treeIdentity || ""))
      : original.treeIdentity === null && safety.treeIdentity === null)
  );
}

function validateRollbackPlan(
  rawPlan,
  authority,
  workspaceRoot,
  platform,
  sessionIntentAuthority = null,
) {
  const plan = rawPlan;
  const expectedBinding = plan?.expectedWorkspaceBinding;
  const originalPlanAuthority = plan?.originalPlanAuthority;
  if (
    !exactKeys(plan, PLAN_KEYS) ||
    plan.schema !== CHECKPOINT_ROLLBACK_PLAN_SCHEMA ||
    plan.version !== CHECKPOINT_ROLLBACK_PLAN_VERSION ||
    plan.engine !== authority.restoreKind ||
    !samePath(plan.workspaceRoot, workspaceRoot, platform) ||
    (plan.engine === "git"
      ? plan.checkpointNamespace !== authority.checkpointNamespace
      : plan.checkpointNamespace !== null) ||
    !validateCheckpointAuthority(plan, authority) ||
    !validCanonicalPaths(plan.originalMutationPaths) ||
    !validCanonicalPaths(plan.currentRollbackPaths) ||
    !Number.isSafeInteger(plan.originalMutationTargetCount) ||
    plan.originalMutationTargetCount !==
      authority.originalMutationTargetCount ||
    plan.originalMutationPaths.length !== plan.originalMutationTargetCount ||
    !Number.isSafeInteger(plan.targetCount) ||
    plan.targetCount < 0 ||
    plan.targetCount > plan.originalMutationTargetCount ||
    plan.currentRollbackPaths.length !== plan.targetCount ||
    !canonicalPathSubset(
      plan.currentRollbackPaths,
      plan.originalMutationPaths,
    ) ||
    !validWorkspaceBinding(
      expectedBinding,
      plan.engine,
      workspaceRoot,
      platform,
    ) ||
    plan.rollbackPlanIdentity !== expectedBinding.writePlanIdentity ||
    plan.rollbackPrestateDigest !==
      rollbackPrestateDigest(plan.engine, expectedBinding) ||
    plan.expectedRollbackStateDigest !==
      rollbackStateDigest(plan.engine, expectedBinding) ||
    !exactKeys(originalPlanAuthority, [
      "bindingReconstructable",
      "mutationSetIdentity",
      "safetyPlanIdentity",
      "sourceCheckpointId",
      "sourceCheckpointIdentity",
    ]) ||
    originalPlanAuthority.sourceCheckpointId !== authority.checkpointId ||
    originalPlanAuthority.sourceCheckpointIdentity !==
      authority.checkpointIdentity ||
    originalPlanAuthority.safetyPlanIdentity !== authority.safetyPlanIdentity ||
    originalPlanAuthority.mutationSetIdentity !==
      mutationSetIdentity(plan.engine, plan.originalMutationPaths)
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
      "Workspace rollback adapter returned an invalid authority-bound plan",
      { operationId: authority.operationId || null },
    );
  }

  if (plan.engine === "git") {
    const originalBinding = plan.originalWorkspaceBinding;
    if (
      plan.originalBindingVerification !==
        "exact-checkpoint-tree-reconstruction" ||
      originalPlanAuthority.bindingReconstructable !== true ||
      !validWorkspaceBinding(originalBinding, "git", workspaceRoot, platform) ||
      originalBinding.writePlanIdentity !==
        authority.workspaceWritePlanIdentity ||
      originalBinding.targetPoststateIdentity !==
        plan.originalCheckpoint.treeIdentity ||
      originalBinding.prestateIdentity !== plan.safetyCheckpoint.treeIdentity ||
      originalPrestateDigest("git", originalBinding) !==
        authority.originalPrestateDigest
    ) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
        "Git rollback did not reconstruct the exact original workspace binding",
      );
    }
  } else if (
    plan.originalBindingVerification !== "durable-safety-plan-v2" ||
    originalPlanAuthority.bindingReconstructable !== false ||
    plan.originalWorkspaceBinding !== null
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
      "Copy rollback must use durable safety-plan v2 authority",
    );
  }

  if (sessionIntentAuthority) {
    if (
      sessionIntentAuthority.workspaceWritePlanIdentity !==
        authority.workspaceWritePlanIdentity ||
      sessionIntentAuthority.checkpointId !== authority.checkpointId ||
      sessionIntentAuthority.checkpointIdentity !==
        authority.checkpointIdentity ||
      !samePath(sessionIntentAuthority.workspaceDir, workspaceRoot, platform) ||
      originalPrestateDigest(plan.engine, {
        scopeIdentity: sessionIntentAuthority.workspaceScopeIdentity,
        prestateIdentity: sessionIntentAuthority.workspacePrestateIdentity,
      }) !== authority.originalPrestateDigest
    ) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
        "Rollback plan does not match the verified timeline intent",
      );
    }
  }

  return immutable(plan);
}

function validateRollbackResult(rawResult, plan) {
  if (
    !exactKeys(rawResult, [
      "engine",
      "rollbackStateDigest",
      "rolledBackCount",
      "schema",
      "version",
    ]) ||
    rawResult.schema !== CHECKPOINT_ROLLBACK_RESULT_SCHEMA ||
    rawResult.version !== CHECKPOINT_ROLLBACK_RESULT_VERSION ||
    rawResult.engine !== plan.engine ||
    rawResult.rolledBackCount !== plan.targetCount ||
    rawResult.rollbackStateDigest !== plan.expectedRollbackStateDigest
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.RESULT_INVALID,
      "Workspace rollback adapter did not prove the complete rollback state",
    );
  }
  return immutable(rawResult);
}

function rollbackBindingEvidence(authority, recoveryRequestId, plan) {
  return Object.freeze({
    recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
    recoveryRequestId,
    safetyId: authority.safetyId,
    safetyIdentity: authority.safetyIdentity,
    safetyPlanIdentity: authority.safetyPlanIdentity,
    safetyCoverage: "full",
    rollbackPrestateDigest: plan.rollbackPrestateDigest,
    rollbackPlanIdentity: plan.rollbackPlanIdentity,
    originalMutationTargetCount: authority.originalMutationTargetCount,
    targetCount: plan.targetCount,
  });
}

function rollbackSettlementEvidence(
  authority,
  recoveryRequestId,
  plan,
  result,
) {
  return Object.freeze({
    ...rollbackBindingEvidence(authority, recoveryRequestId, plan),
    rolledBackCount: result.rolledBackCount,
    rollbackStateDigest: result.rollbackStateDigest,
    resultDigest: rollbackResultDigest(
      authority.operationId,
      recoveryRequestId,
      plan,
      result,
    ),
  });
}

function validateSettledPlan(plan, authority, settlement) {
  if (
    plan.targetCount !== 0 ||
    plan.currentRollbackPaths.length !== 0 ||
    !exactKeys(settlement, [
      "originalMutationTargetCount",
      "recoveryAction",
      "recoveryRequestId",
      "resultDigest",
      "rollbackPlanIdentity",
      "rollbackPrestateDigest",
      "rollbackStateDigest",
      "rolledBackCount",
      "safetyCoverage",
      "safetyId",
      "safetyIdentity",
      "safetyPlanIdentity",
      "targetCount",
    ]) ||
    plan.originalMutationTargetCount !==
      settlement.originalMutationTargetCount ||
    plan.originalPlanAuthority.mutationSetIdentity !==
      mutationSetIdentity(plan.engine, plan.originalMutationPaths) ||
    plan.expectedRollbackStateDigest !== settlement.rollbackStateDigest ||
    settlement.safetyId !== authority.safetyId ||
    settlement.safetyIdentity !== authority.safetyIdentity ||
    settlement.safetyPlanIdentity !== authority.safetyPlanIdentity ||
    settlement.safetyCoverage !== "full" ||
    settlement.recoveryAction !== CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION ||
    !REQUEST_ID_PATTERN.test(String(settlement.recoveryRequestId || "")) ||
    !DIGEST_PATTERN.test(String(settlement.rollbackPrestateDigest || "")) ||
    !DIGEST_PATTERN.test(String(settlement.rollbackPlanIdentity || "")) ||
    !DIGEST_PATTERN.test(String(settlement.resultDigest || "")) ||
    !Number.isSafeInteger(settlement.targetCount) ||
    settlement.targetCount < 0 ||
    settlement.targetCount > settlement.originalMutationTargetCount ||
    settlement.rolledBackCount !== settlement.targetCount ||
    settlement.resultDigest !==
      settledRollbackResultDigest(authority, settlement)
  ) {
    throw rollbackError(
      CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.PLAN_INVALID,
      "Settled rollback no longer matches the exact durable safety state",
    );
  }
  return plan;
}

function sessionConflict(message, details = {}, cause = null) {
  return rollbackError(
    CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.SESSION_CONFLICT,
    message,
    details,
    cause,
  );
}

function validTranscriptAuthority(value) {
  return (
    isPlainObject(value) &&
    RAW_HASH_PATTERN.test(String(value.headHash || "")) &&
    Number.isSafeInteger(value.eventCount) &&
    value.eventCount > 0 &&
    Number.isSafeInteger(value.operationEventCount) &&
    value.operationEventCount > 0 &&
    RAW_HASH_PATTERN.test(String(value.operationTailHash || "")) &&
    Number.isSafeInteger(value.eventsAfterOperationTail) &&
    value.eventsAfterOperationTail >= 0
  );
}

function validIntentStateIdentity(engine, value) {
  return engine === "git"
    ? GIT_TREE_PATTERN.test(String(value || ""))
    : DIGEST_PATTERN.test(String(value || ""));
}

function sameIntentAuthority(left, right, workspaceRoot, platform) {
  return (
    isPlainObject(left) &&
    isPlainObject(right) &&
    left.revision === right.revision &&
    left.action === right.action &&
    left.turnId === right.turnId &&
    left.checkpointId === right.checkpointId &&
    left.checkpointIdentity === right.checkpointIdentity &&
    samePath(left.workspaceDir, right.workspaceDir, platform) &&
    samePath(left.workspaceDir, workspaceRoot, platform) &&
    left.workspaceScopeIdentity === right.workspaceScopeIdentity &&
    left.workspacePrestateIdentity === right.workspacePrestateIdentity &&
    left.workspaceWritePlanIdentity === right.workspaceWritePlanIdentity &&
    left.workspaceTargetPoststateIdentity ===
      right.workspaceTargetPoststateIdentity &&
    left.confirmationDigest === right.confirmationDigest
  );
}

function validateTimelineProjection(
  projection,
  authority,
  workspaceRoot,
  platform,
  allowedClassifications,
) {
  const intent = projection?.intent;
  const intentAuthority = intent?.authority;
  const failedAudit = projection?.audit?.failed ?? null;
  const classification = projection?.classification;
  const commonValid =
    isPlainObject(projection) &&
    projection.schema === CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA &&
    projection.version === CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION &&
    projection.operationId === authority.operationId &&
    projection.sessionId === authority.sessionId &&
    projection.restoreSurface === "timeline" &&
    projection.failClosed === false &&
    projection.safeToMutate === false &&
    Array.isArray(projection.issues) &&
    projection.issues.length === 0 &&
    allowedClassifications.has(classification) &&
    validTranscriptAuthority(projection.transcript) &&
    isPlainObject(intent) &&
    RAW_HASH_PATTERN.test(String(intent.eventHash || "")) &&
    intent.intentCommitDigest === authority.intentCommitDigest &&
    intent.intentCommitDigest ===
      computeCheckpointRestoreDigest(
        "cc-checkpoint-restore-intent-commit-v1",
        intent.eventHash,
      ) &&
    isPlainObject(intentAuthority) &&
    ACTIONS.has(intentAuthority.action) &&
    intentAuthority.turnId === authority.timelineEntryId &&
    intentAuthority.checkpointId === authority.checkpointId &&
    intentAuthority.checkpointIdentity === authority.checkpointIdentity &&
    samePath(intentAuthority.workspaceDir, workspaceRoot, platform) &&
    DIGEST_PATTERN.test(String(intentAuthority.workspaceScopeIdentity || "")) &&
    validIntentStateIdentity(
      authority.restoreKind,
      intentAuthority.workspacePrestateIdentity,
    ) &&
    intentAuthority.workspaceWritePlanIdentity ===
      authority.workspaceWritePlanIdentity &&
    validIntentStateIdentity(
      authority.restoreKind,
      intentAuthority.workspaceTargetPoststateIdentity,
    ) &&
    intentAuthority.confirmationDigest === authority.confirmationDigest &&
    originalPrestateDigest(authority.restoreKind, {
      scopeIdentity: intentAuthority.workspaceScopeIdentity,
      prestateIdentity: intentAuthority.workspacePrestateIdentity,
    }) === authority.originalPrestateDigest &&
    projection.conversationCommit === null &&
    projection.audit?.completed === null &&
    (failedAudit === null ||
      (isPlainObject(failedAudit) &&
        RAW_HASH_PATTERN.test(String(failedAudit.eventHash || "")) &&
        failedAudit.conversationSideEffectPresent === false &&
        sameIntentAuthority(
          failedAudit.authority,
          intentAuthority,
          workspaceRoot,
          platform,
        )));

  const resumable = TIMELINE_RESUMABLE_CLASSIFICATIONS.has(classification);
  const resolution = projection?.resolution;
  const resolutionShapeValid =
    classification === CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK &&
    isPlainObject(resolution) &&
    Number.isSafeInteger(resolution.index) &&
    resolution.index > intent.index &&
    RAW_HASH_PATTERN.test(String(resolution.eventHash || "")) &&
    RAW_HASH_PATTERN.test(String(resolution.prevHash || "")) &&
    projection.transcript.operationTailHash === resolution.eventHash &&
    resolution.sessionRollbackCommitDigest ===
      computeCheckpointRestoreSessionRollbackCommitDigest(
        resolution.eventHash,
      ) &&
    isPlainObject(resolution.data);

  if (
    !commonValid ||
    (resumable && resolution !== null) ||
    (!resumable && !resolutionShapeValid)
  ) {
    throw sessionConflict(
      "Timeline rollback requires one exact resumable or rolled-back session authority",
      {
        operationId: authority.operationId,
        classification: classification || null,
        issues: Array.isArray(projection?.issues)
          ? projection.issues.slice(0, 20)
          : [],
      },
    );
  }
  return projection;
}

function resolutionInput(
  authority,
  projection,
  settlement,
  sagaWorkspaceRolledBackHash,
) {
  return immutable({
    operationId: authority.operationId,
    recoveryRequestId: settlement.recoveryRequestId,
    action: projection.intent.authority.action,
    recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
    outcome: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OUTCOME,
    intentEventHash: projection.intent.eventHash,
    intentCommitDigest: authority.intentCommitDigest,
    failedAuditEventHash: projection.audit.failed?.eventHash ?? null,
    conversationDisposition:
      CHECKPOINT_RESTORE_ROLLBACK_CONVERSATION_DISPOSITION,
    checkpointId: authority.checkpointId,
    checkpointIdentity: authority.checkpointIdentity,
    workspaceScopeIdentity: projection.intent.authority.workspaceScopeIdentity,
    workspaceWritePlanIdentity: authority.workspaceWritePlanIdentity,
    safetyId: authority.safetyId,
    safetyIdentity: authority.safetyIdentity,
    safetyPlanIdentity: authority.safetyPlanIdentity,
    rollbackPlanIdentity: settlement.rollbackPlanIdentity,
    rollbackStateDigest: settlement.rollbackStateDigest,
    sagaWorkspaceRolledBackHash,
  });
}

function exactHistoricalWorkspaceSettlement(saga, eventHash, settlement) {
  const matches = saga.events.filter(
    (event) =>
      event.phase === "workspace_rolled_back" &&
      event.hash === eventHash &&
      canonicalJson(event.evidence) === canonicalJson(settlement),
  );
  if (matches.length !== 1) {
    throw sessionConflict(
      "Session rollback resolution is not bound to the exact historical workspace settlement",
      { operationId: saga.operationId, sagaWorkspaceRolledBackHash: eventHash },
    );
  }
  return matches[0];
}

function workspaceSettlementFromSessionSettlement(settlement) {
  return immutable({
    recoveryAction: settlement.recoveryAction,
    recoveryRequestId: settlement.recoveryRequestId,
    safetyId: settlement.safetyId,
    safetyIdentity: settlement.safetyIdentity,
    safetyPlanIdentity: settlement.safetyPlanIdentity,
    safetyCoverage: settlement.safetyCoverage,
    rollbackPrestateDigest: settlement.rollbackPrestateDigest,
    rollbackPlanIdentity: settlement.rollbackPlanIdentity,
    originalMutationTargetCount: settlement.originalMutationTargetCount,
    targetCount: settlement.targetCount,
    rolledBackCount: settlement.rolledBackCount,
    rollbackStateDigest: settlement.rollbackStateDigest,
    resultDigest: settlement.resultDigest,
  });
}

function validateResolutionReceipt(receipt, expectedHeadHash, input) {
  if (
    !isPlainObject(receipt) ||
    !RAW_HASH_PATTERN.test(String(receipt.eventHash || "")) ||
    receipt.prevHash !== expectedHeadHash ||
    receipt.sessionRollbackCommitDigest !==
      computeCheckpointRestoreSessionRollbackCommitDigest(receipt.eventHash) ||
    canonicalJson(receipt.resolution) !==
      canonicalJson({
        schema: "chainlesschain.checkpoint-restore-recovery-resolution",
        version: 1,
        ...input,
      })
  ) {
    throw sessionConflict(
      "Session rollback resolution append did not return exact durable authority",
      { commitState: "unknown" },
    );
  }
  return immutable(receipt);
}

function terminalSummary(saga) {
  return Object.freeze({
    operationId: saga.operationId,
    phase: saga.phase,
    seq: saga.seq,
    headHash: saga.headHash,
  });
}

function archiveWarning(error) {
  return Object.freeze({
    code: boundedText(
      error?.code,
      "CHECKPOINT_RESTORE_SAGA_ARCHIVE_PENDING",
      128,
    ),
    message: boundedText(
      error?.message,
      "Checkpoint restore saga archive is pending",
      512,
    ),
    commitState:
      typeof error?.commitState === "string"
        ? boundedText(error.commitState, "unknown", 128)
        : null,
  });
}

function propagateRecoveryDiagnostics(error) {
  if (!error || typeof error !== "object") return error;
  const nested = error.cause;
  if (!nested || typeof nested !== "object") return error;
  for (const field of [
    "checkpointRestoreRecoveryCause",
    "checkpointRestoreOperationId",
    "checkpointRestoreSagaPhase",
    "checkpointRestoreSagaSeq",
    "checkpointRestoreSagaHeadHash",
    "checkpointRestoreRecoveryRequired",
  ]) {
    if (error[field] === undefined && nested[field] !== undefined) {
      error[field] = nested[field];
    }
  }
  return error;
}

export class CheckpointRestorePartialRollbackController {
  constructor(options = {}) {
    if (!isPlainObject(options) || !validText(options.workspaceRoot, 4_096)) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.INVALID_ARGUMENT,
        "Partial rollback controller requires a workspaceRoot",
      );
    }
    if (
      typeof options.prepareWorkspaceRollback !== "function" ||
      typeof options.executeWorkspaceRollback !== "function"
    ) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.INVALID_ARGUMENT,
        "Partial rollback controller requires prepare and execute adapters",
      );
    }
    this.workspaceRoot = options.workspaceRoot;
    this.store =
      options.store ||
      new CheckpointRestoreSagaStore({ workspaceRoot: this.workspaceRoot });
    this._prepareWorkspaceRollback = options.prepareWorkspaceRollback;
    this._executeWorkspaceRollback = options.executeWorkspaceRollback;
    this._readSessionRecovery =
      options.readSessionRecovery ||
      (typeof options.sessionRecoveryReader?.read === "function"
        ? options.sessionRecoveryReader.read.bind(options.sessionRecoveryReader)
        : null);
    this._withSessionAuthorityTransaction =
      options.withSessionAuthorityTransaction || null;
    this._appendSessionResolution =
      options.appendSessionResolution ||
      appendCheckpointRestoreRecoveryResolution;
    this._reconcileSessionResolution =
      options.reconcileSessionResolution ||
      reconcileCheckpointRestoreRecoveryResolutionProjection;
    this._inspectWorkspaceLockOwnerSync =
      options.inspectWorkspaceLockOwnerSync || inspectWorkspaceLockOwnerSync;
    this._withWorkspaceRecoveryLockSync =
      options.withWorkspaceRecoveryLockSync || withWorkspaceRecoveryLockSync;
    this._workspaceLockOwnerDigest =
      options.computeWorkspaceLockOwnerDigest ||
      computeCheckpointRestoreWorkspaceLockOwnerDigest;
    this._createRecoveryRequestId =
      options.createRecoveryRequestId || (() => `rollback-${randomUUID()}`);
    this._workspaceLockOptions = Object.freeze({
      ...(options.workspaceLockOptions || {}),
    });
    this._platform = options.platform || process.platform;
  }

  _lockOptions(operationId) {
    return {
      ...this._workspaceLockOptions,
      workspaceRoot: this.workspaceRoot,
      operationId,
      purpose: CHECKPOINT_RESTORE_PURPOSE,
    };
  }

  _loadExact(operationId, expectedSeq, expectedHash) {
    return exactSaga(
      requireSynchronous(
        this.store.load(operationId),
        "checkpoint rollback saga load",
      ),
      operationId,
      expectedSeq,
      expectedHash,
    );
  }

  _advanceExact(saga, phase, evidence) {
    try {
      return requireSynchronous(
        this.store.advance(saga.operationId, {
          expectedSeq: saga.seq,
          expectedHash: saga.headHash,
          phase,
          evidence,
        }),
        "checkpoint rollback saga advance",
      );
    } catch (caught) {
      const error = asError(caught);
      try {
        const observed = requireSynchronous(
          this.store.load(saga.operationId),
          "checkpoint rollback saga reconciliation load",
        );
        const latest = observed.events?.at(-1);
        if (
          observed.seq === saga.seq + 1 &&
          observed.phase === phase &&
          latest?.prevHash === saga.headHash &&
          canonicalJson(latest.evidence) === canonicalJson(evidence)
        ) {
          return observed;
        }
      } catch (loadError) {
        error.checkpointRestoreRecoveryLoadError = loadError;
      }
      throw error;
    }
  }

  _inspectBoundOwner(operationId, expectedOwnerDigest) {
    const owner = this._inspectWorkspaceLockOwnerSync(
      this._lockOptions(operationId),
    );
    if (!owner) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore has no retained workspace owner to take over",
        { operationId, expectedOwnerDigest, actualOwnerDigest: null },
      );
    }
    const actualOwnerDigest = this._workspaceLockOwnerDigest(owner);
    if (actualOwnerDigest !== expectedOwnerDigest) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore workspace owner changed after rollback preview",
        { operationId, expectedOwnerDigest, actualOwnerDigest },
      );
    }
    return owner;
  }

  _archiveTerminal(saga) {
    try {
      const archived = requireSynchronous(
        this.store.archiveTerminal(saga.operationId, {
          expectedSeq: saga.seq,
          expectedHash: saga.headHash,
        }),
        "checkpoint rollback saga archive",
      );
      return Object.freeze({
        archived: true,
        alreadyArchived: archived.alreadyArchived === true,
        warning: null,
      });
    } catch (error) {
      return Object.freeze({
        archived: false,
        alreadyArchived: false,
        warning: archiveWarning(error),
      });
    }
  }

  _newRequestId() {
    const value = requireSynchronous(
      this._createRecoveryRequestId(),
      "checkpoint rollback request id creation",
    );
    if (!REQUEST_ID_PATTERN.test(String(value || ""))) {
      throw rollbackError(
        CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.INVALID_ARGUMENT,
        "Checkpoint rollback recoveryRequestId is invalid",
      );
    }
    return value;
  }

  _prepareRequest(operationId, recoveryRequestId, authority, lease) {
    return Object.freeze({
      operationId,
      recoveryRequestId,
      workspaceRoot: this.workspaceRoot,
      workspaceLease: lease,
      expected: immutable({
        engine: authority.restoreKind,
        restoreSurface: authority.restoreSurface,
        checkpointNamespace: authority.checkpointNamespace,
        originalCheckpoint: {
          id: authority.checkpointId,
          identity: authority.checkpointIdentity,
        },
        safetyCheckpoint: {
          id: authority.safetyId,
          identity: authority.safetyIdentity,
          planIdentity: authority.safetyPlanIdentity,
        },
        originalWorkspaceWritePlanIdentity:
          authority.workspaceWritePlanIdentity,
        originalPrestateDigest: authority.originalPrestateDigest,
        originalMutationTargetCount: authority.originalMutationTargetCount,
      }),
    });
  }

  _preparePlan(operationId, recoveryRequestId, authority, lease, session) {
    assertLeaseOwnedSync(lease);
    const rawPlan = requireSynchronous(
      this._prepareWorkspaceRollback(
        this._prepareRequest(operationId, recoveryRequestId, authority, lease),
      ),
      "checkpoint workspace rollback preparation",
    );
    assertLeaseOwnedSync(lease);
    return validateRollbackPlan(
      rawPlan,
      { ...authority, operationId },
      this.workspaceRoot,
      this._platform,
      session?.intent?.authority || null,
    );
  }

  _executePlan(operationId, recoveryRequestId, plan, lease) {
    assertLeaseOwnedSync(lease);
    const rawResult = requireSynchronous(
      this._executeWorkspaceRollback(
        Object.freeze({
          operationId,
          recoveryRequestId,
          workspaceRoot: this.workspaceRoot,
          workspaceLease: lease,
          plan,
        }),
      ),
      "checkpoint workspace rollback execution",
    );
    assertLeaseOwnedSync(lease);
    return validateRollbackResult(rawResult, plan);
  }

  _readTimelineProjection(
    authority,
    allowedClassifications,
    expectedSessionRollbackCommitDigest = null,
  ) {
    if (typeof this._readSessionRecovery !== "function") {
      throw sessionConflict(
        "Timeline rollback requires a verified session recovery reader",
        { operationId: authority.operationId },
      );
    }
    const options = {
      operationId: authority.operationId,
      sessionId: authority.sessionId,
      restoreSurface: "timeline",
      expectedIntentCommitDigest: authority.intentCommitDigest,
      expectedTimelineEntryId: authority.timelineEntryId,
      expectedCheckpointId: authority.checkpointId,
      expectedCheckpointIdentity: authority.checkpointIdentity,
      expectedConfirmationDigest: authority.confirmationDigest,
      ...(expectedSessionRollbackCommitDigest
        ? { expectedSessionRollbackCommitDigest }
        : {}),
    };
    let projection;
    try {
      projection = requireSynchronous(
        this._readSessionRecovery(Object.freeze(options)),
        "checkpoint timeline recovery read",
      );
    } catch (cause) {
      throw sessionConflict(
        "Timeline rollback session authority could not be read",
        { operationId: authority.operationId },
        cause,
      );
    }
    return validateTimelineProjection(
      projection,
      authority,
      this.workspaceRoot,
      this._platform,
      allowedClassifications,
    );
  }

  _reconcileTimelineResolution(saga, authority, projection, settlement) {
    const resolution = projection.resolution;
    const historicalHash = resolution.data.sagaWorkspaceRolledBackHash;
    exactHistoricalWorkspaceSettlement(saga, historicalHash, settlement);
    const input = resolutionInput(
      authority,
      projection,
      settlement,
      historicalHash,
    );
    let receipt;
    try {
      receipt = requireSynchronous(
        this._reconcileSessionResolution(projection, input, {
          expectedHeadHash: resolution.prevHash,
          expectedSessionId: authority.sessionId,
        }),
        "checkpoint timeline rollback resolution reconciliation",
      );
    } catch (cause) {
      throw sessionConflict(
        "Timeline rollback resolution reconciliation failed closed",
        { operationId: authority.operationId },
        cause,
      );
    }
    if (!receipt) {
      throw sessionConflict(
        "Timeline rollback resolution does not exactly match saga settlement authority",
        { operationId: authority.operationId },
      );
    }
    return validateResolutionReceipt(receipt, resolution.prevHash, input);
  }

  _appendTimelineResolution(
    saga,
    authority,
    projection,
    settlement,
    workspaceSettlementEvent,
    lease,
  ) {
    if (typeof this._withSessionAuthorityTransaction !== "function") {
      throw sessionConflict(
        "Timeline rollback requires a session authority transaction",
        { operationId: authority.operationId },
      );
    }
    const expectedHeadHash = projection.transcript.headHash;
    const input = resolutionInput(
      authority,
      projection,
      settlement,
      workspaceSettlementEvent.hash,
    );
    try {
      assertLeaseOwnedSync(lease);
      const receipt = requireSynchronous(
        this._withSessionAuthorityTransaction(
          authority.sessionId,
          expectedHeadHash,
          (transaction) => {
            assertLeaseOwnedSync(lease);
            return requireSynchronous(
              this._appendSessionResolution(transaction, input, {
                expectedHeadHash,
              }),
              "checkpoint timeline rollback resolution append",
            );
          },
        ),
        "checkpoint timeline authority transaction",
      );
      assertLeaseOwnedSync(lease);
      return validateResolutionReceipt(receipt, expectedHeadHash, input);
    } catch (caught) {
      const appendError = asError(caught);
      try {
        assertLeaseOwnedSync(lease);
        const observed = this._readTimelineProjection(
          authority,
          new Set([
            ...TIMELINE_RESUMABLE_CLASSIFICATIONS,
            CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
          ]),
        );
        if (
          observed.classification ===
          CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK
        ) {
          const receipt = requireSynchronous(
            this._reconcileSessionResolution(observed, input, {
              expectedHeadHash,
              expectedSessionId: authority.sessionId,
            }),
            "checkpoint timeline unknown append reconciliation",
          );
          if (receipt) {
            assertLeaseOwnedSync(lease);
            return validateResolutionReceipt(receipt, expectedHeadHash, input);
          }
        }
      } catch (reconciliationError) {
        appendError.checkpointRestoreSessionReconciliationError =
          reconciliationError;
      }
      throw sessionConflict(
        "Timeline rollback resolution append outcome is not exactly reconciled",
        { operationId: authority.operationId, commitState: "unknown" },
        appendError,
      );
    }
  }

  _settleTimeline(
    saga,
    authority,
    projection,
    workspaceSettlement,
    workspaceSettlementEvent,
    lease,
    reconciledReceipt = null,
  ) {
    const receipt =
      reconciledReceipt ||
      (projection.classification ===
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK
        ? this._reconcileTimelineResolution(
            saga,
            authority,
            projection,
            workspaceSettlement,
          )
        : this._appendTimelineResolution(
            saga,
            authority,
            projection,
            workspaceSettlement,
            workspaceSettlementEvent,
            lease,
          ));
    assertLeaseOwnedSync(lease);
    const sessionSettlement = immutable({
      ...workspaceSettlement,
      sessionRollbackCommitDigest: receipt.sessionRollbackCommitDigest,
    });
    saga = this._advanceExact(
      saga,
      "session_rollback_committed",
      sessionSettlement,
    );
    return Object.freeze({
      saga,
      sessionSettlement,
      receipt,
    });
  }

  _retainFailure(operationError, lease, terminalEvidence = null) {
    const error = asError(operationError);
    let observed = null;
    let leaseOwned = false;
    try {
      assertLeaseOwnedSync(
        lease,
        "checkpoint rollback failure workspace lease assertion",
      );
      leaseOwned = true;
    } catch (leaseError) {
      error.checkpointRestoreRecoveryLeaseError = leaseError;
    }
    try {
      if (!leaseOwned) throw error.checkpointRestoreRecoveryLeaseError;
      observed = requireSynchronous(
        this.store.load(lease.recoveryOfOperationId),
        "checkpoint rollback failure reconciliation load",
      );
      const latest = observed.events?.at(-1);
      if (
        terminalEvidence &&
        observed.terminal &&
        observed.phase === "rolled_back" &&
        canonicalJson(latest?.evidence) === canonicalJson(terminalEvidence)
      ) {
        return Object.freeze({ saga: observed, reconciledFromError: true });
      }
      if (!observed.terminal) {
        partialRollbackSagaAuthority(
          observed,
          this.workspaceRoot,
          this._platform,
        );
        if (observed.phase !== "recovery_required") {
          observed = this._advanceExact(observed, "recovery_required", {
            reason: boundedText(
              error.message,
              "Partial rollback requires another recovery attempt",
            ),
            errorCode: boundedText(
              error.code,
              "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_FAILED",
              128,
            ),
          });
        }
      }
    } catch (journalError) {
      error.checkpointRestoreRecoveryJournalError = journalError;
    }

    try {
      requireSynchronous(
        lease.retainForRecovery(
          boundedText(
            `${error.code || "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_FAILED"}: ${error.message || "partial rollback outcome is unknown"}`,
            "Partial rollback outcome is unknown",
            512,
          ),
        ),
        "checkpoint rollback workspace lease retention",
      );
    } catch (retentionError) {
      if (retentionError && typeof retentionError === "object") {
        retentionError.checkpointRestoreRecoveryCause = error;
        retentionError.checkpointRestoreOperationId =
          lease.recoveryOfOperationId;
        retentionError.checkpointRestoreSagaPhase = observed?.phase || null;
        retentionError.checkpointRestoreSagaSeq = observed?.seq || null;
        retentionError.checkpointRestoreSagaHeadHash =
          observed?.headHash || null;
        retentionError.checkpointRestoreRecoveryRequired = true;
      }
      throw retentionError;
    }
    throw error;
  }

  rollback(
    operationId,
    { expectedSeq, expectedHash, expectedOwnerDigest } = {},
  ) {
    validateExpectedAuthority({
      operationId,
      expectedSeq,
      expectedHash,
      expectedOwnerDigest,
    });
    const previewSaga = this._loadExact(operationId, expectedSeq, expectedHash);
    partialRollbackSagaAuthority(
      previewSaga,
      this.workspaceRoot,
      this._platform,
    );
    const observedOwner = this._inspectBoundOwner(
      operationId,
      expectedOwnerDigest,
    );

    let settled;
    try {
      settled = requireSynchronous(
        this._withWorkspaceRecoveryLockSync(
          {
            ...this._lockOptions(operationId),
            expectedOwner: observedOwner,
          },
          (lease) => {
            let terminalEvidence = null;
            try {
              assertLeaseOwnedSync(lease);
              let saga = this._loadExact(
                operationId,
                expectedSeq,
                expectedHash,
              );
              const authority = {
                ...partialRollbackSagaAuthority(
                  saga,
                  this.workspaceRoot,
                  this._platform,
                ),
                operationId,
              };
              const currentBase = currentRecoveryBaseEvent(saga);
              const nonSettled = NON_SETTLED_BASE_PHASES.has(
                currentBase?.phase,
              );
              const workspaceSettled =
                currentBase?.phase === "workspace_rolled_back";
              const sessionSettled =
                currentBase?.phase === "session_rollback_committed";
              if (!nonSettled && !workspaceSettled && !sessionSettled) {
                throw rollbackError(
                  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ACTION_NOT_ALLOWED,
                  "Partial rollback requires a mutation or rollback settlement base",
                  { operationId, basePhase: currentBase?.phase || null },
                );
              }
              if (authority.restoreSurface === "direct" && sessionSettled) {
                throw rollbackError(
                  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ERROR_CODES.ACTION_NOT_ALLOWED,
                  "Direct rollback cannot claim a session settlement",
                  { operationId },
                );
              }

              let sessionProjection = null;
              if (authority.restoreSurface === "timeline") {
                const classifications = sessionSettled
                  ? new Set([
                      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
                    ])
                  : workspaceSettled
                    ? new Set([
                        ...TIMELINE_RESUMABLE_CLASSIFICATIONS,
                        CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK,
                      ])
                    : TIMELINE_RESUMABLE_CLASSIFICATIONS;
                sessionProjection = this._readTimelineProjection(
                  authority,
                  classifications,
                  sessionSettled
                    ? currentBase.evidence.sessionRollbackCommitDigest
                    : null,
                );
              }

              const publishRecoveryStarted = (recoveryRequestId) => {
                if (saga.phase !== "recovery_required") {
                  saga = this._advanceExact(saga, "recovery_required", {
                    reason:
                      "Partial workspace mutation requires exact rollback",
                    errorCode: "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_REQUESTED",
                  });
                }
                assertLeaseOwnedSync(lease);
                saga = this._advanceExact(saga, "recovery_started", {
                  workspaceLockOwner: lease.owner,
                  lockOwnerDigest: this._workspaceLockOwnerDigest(lease.owner),
                  recoveryAction: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
                  recoveryRequestId,
                });
                assertLeaseOwnedSync(lease);
              };

              let recoveryRequestId;
              let result;
              let sessionRollbackCommitDigest = null;
              let reconciledFromError = false;

              if (nonSettled) {
                recoveryRequestId = this._newRequestId();
                publishRecoveryStarted(recoveryRequestId);
                const plan = this._preparePlan(
                  operationId,
                  recoveryRequestId,
                  authority,
                  lease,
                  sessionProjection,
                );
                const bindingEvidence = rollbackBindingEvidence(
                  authority,
                  recoveryRequestId,
                  plan,
                );
                saga = this._advanceExact(
                  saga,
                  "rollback_prepared",
                  bindingEvidence,
                );
                assertLeaseOwnedSync(lease);
                if (plan.targetCount > 0) {
                  saga = this._advanceExact(
                    saga,
                    "rollback_started",
                    bindingEvidence,
                  );
                  result = this._executePlan(
                    operationId,
                    recoveryRequestId,
                    plan,
                    lease,
                  );
                } else {
                  result = immutable({
                    schema: CHECKPOINT_ROLLBACK_RESULT_SCHEMA,
                    version: CHECKPOINT_ROLLBACK_RESULT_VERSION,
                    engine: plan.engine,
                    rolledBackCount: 0,
                    rollbackStateDigest: plan.expectedRollbackStateDigest,
                  });
                }
                const workspaceSettlement = rollbackSettlementEvidence(
                  authority,
                  recoveryRequestId,
                  plan,
                  result,
                );
                assertLeaseOwnedSync(lease);
                saga = this._advanceExact(
                  saga,
                  "workspace_rolled_back",
                  workspaceSettlement,
                );
                const workspaceSettlementEvent = saga.events.at(-1);
                if (authority.restoreSurface === "timeline") {
                  const session = this._settleTimeline(
                    saga,
                    authority,
                    sessionProjection,
                    workspaceSettlement,
                    workspaceSettlementEvent,
                    lease,
                  );
                  saga = session.saga;
                  terminalEvidence = session.sessionSettlement;
                  sessionRollbackCommitDigest =
                    session.receipt.sessionRollbackCommitDigest;
                  reconciledFromError =
                    session.receipt.reconciledFromError === true;
                } else {
                  terminalEvidence = workspaceSettlement;
                }
              } else if (workspaceSettled) {
                const workspaceSettlement = immutable(currentBase.evidence);
                recoveryRequestId = workspaceSettlement.recoveryRequestId;
                let existingReceipt = null;
                if (
                  sessionProjection?.classification ===
                  CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ROLLED_BACK
                ) {
                  // Inspect and bind an existing resolution before any saga
                  // republication can change the current workspace event hash.
                  existingReceipt = this._reconcileTimelineResolution(
                    saga,
                    authority,
                    sessionProjection,
                    workspaceSettlement,
                  );
                }
                const plan = this._preparePlan(
                  operationId,
                  recoveryRequestId,
                  authority,
                  lease,
                  sessionProjection,
                );
                validateSettledPlan(plan, authority, workspaceSettlement);
                result = immutable({
                  schema: CHECKPOINT_ROLLBACK_RESULT_SCHEMA,
                  version: CHECKPOINT_ROLLBACK_RESULT_VERSION,
                  engine: plan.engine,
                  rolledBackCount: workspaceSettlement.rolledBackCount,
                  rollbackStateDigest: workspaceSettlement.rollbackStateDigest,
                });
                let workspaceSettlementEvent = currentBase;
                if (saga.phase !== "workspace_rolled_back") {
                  publishRecoveryStarted(recoveryRequestId);
                  saga = this._advanceExact(
                    saga,
                    "workspace_rolled_back",
                    workspaceSettlement,
                  );
                  workspaceSettlementEvent = saga.events.at(-1);
                }
                if (authority.restoreSurface === "timeline") {
                  const session = this._settleTimeline(
                    saga,
                    authority,
                    sessionProjection,
                    workspaceSettlement,
                    workspaceSettlementEvent,
                    lease,
                    existingReceipt,
                  );
                  saga = session.saga;
                  terminalEvidence = session.sessionSettlement;
                  sessionRollbackCommitDigest =
                    session.receipt.sessionRollbackCommitDigest;
                  reconciledFromError =
                    session.receipt.reconciledFromError === true;
                } else {
                  terminalEvidence = workspaceSettlement;
                }
              } else {
                const sessionSettlement = immutable(currentBase.evidence);
                const workspaceSettlement =
                  workspaceSettlementFromSessionSettlement(sessionSettlement);
                recoveryRequestId = sessionSettlement.recoveryRequestId;
                const existingReceipt = this._reconcileTimelineResolution(
                  saga,
                  authority,
                  sessionProjection,
                  workspaceSettlement,
                );
                const plan = this._preparePlan(
                  operationId,
                  recoveryRequestId,
                  authority,
                  lease,
                  sessionProjection,
                );
                validateSettledPlan(plan, authority, workspaceSettlement);
                if (
                  existingReceipt.sessionRollbackCommitDigest !==
                  sessionSettlement.sessionRollbackCommitDigest
                ) {
                  throw sessionConflict(
                    "Saga session settlement does not match the verified transcript resolution",
                    { operationId },
                  );
                }
                result = immutable({
                  schema: CHECKPOINT_ROLLBACK_RESULT_SCHEMA,
                  version: CHECKPOINT_ROLLBACK_RESULT_VERSION,
                  engine: plan.engine,
                  rolledBackCount: workspaceSettlement.rolledBackCount,
                  rollbackStateDigest: workspaceSettlement.rollbackStateDigest,
                });
                if (saga.phase !== "session_rollback_committed") {
                  publishRecoveryStarted(recoveryRequestId);
                  saga = this._advanceExact(
                    saga,
                    "session_rollback_committed",
                    sessionSettlement,
                  );
                }
                terminalEvidence = sessionSettlement;
                sessionRollbackCommitDigest =
                  sessionSettlement.sessionRollbackCommitDigest;
                reconciledFromError =
                  existingReceipt.reconciledFromError === true;
              }

              assertLeaseOwnedSync(lease);
              saga = this._advanceExact(saga, "rolled_back", terminalEvidence);
              assertLeaseOwnedSync(lease);
              return Object.freeze({
                saga,
                recoveryRequestId,
                rolledBackCount: result.rolledBackCount,
                rollbackStateDigest: result.rollbackStateDigest,
                resultDigest: terminalEvidence.resultDigest,
                sessionRollbackCommitDigest,
                reconciledFromError,
              });
            } catch (error) {
              const reconciled = this._retainFailure(
                error,
                lease,
                terminalEvidence,
              );
              if (reconciled?.saga) {
                return Object.freeze({
                  saga: reconciled.saga,
                  recoveryRequestId: terminalEvidence.recoveryRequestId,
                  rolledBackCount: terminalEvidence.rolledBackCount,
                  rollbackStateDigest: terminalEvidence.rollbackStateDigest,
                  resultDigest: terminalEvidence.resultDigest,
                  sessionRollbackCommitDigest:
                    terminalEvidence.sessionRollbackCommitDigest || null,
                  reconciledFromError: true,
                });
              }
              return reconciled;
            }
          },
        ),
        "checkpoint rollback workspace recovery transaction",
      );
    } catch (error) {
      throw propagateRecoveryDiagnostics(error);
    }

    const archive = this._archiveTerminal(settled.saga);
    return Object.freeze({
      schema: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_SCHEMA,
      version: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_VERSION,
      ok: true,
      action: CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
      ...terminalSummary(settled.saga),
      recoveryRequestId: settled.recoveryRequestId,
      rolledBackCount: settled.rolledBackCount,
      rollbackStateDigest: settled.rollbackStateDigest,
      resultDigest: settled.resultDigest,
      sessionRollbackCommitDigest: settled.sessionRollbackCommitDigest,
      reconciledFromError: settled.reconciledFromError,
      ...archive,
    });
  }
}

export function createCheckpointRestorePartialRollbackController(options = {}) {
  return new CheckpointRestorePartialRollbackController(options);
}
