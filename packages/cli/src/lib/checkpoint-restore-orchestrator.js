/**
 * Shared durable orchestration for checkpoint workspace restores.
 *
 * The orchestrator owns the workspace-lock and saga boundaries. Callers only
 * provide an immutable restore plan, a locked revalidation callback, the
 * engine adapter, and (for timeline restores) an optional session-authority
 * adapter. All callbacks must be synchronous because the canonical workspace
 * lock is synchronous and must span every durable boundary.
 */

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "./checkpoint-restore-saga.js";
import { withWorkspaceLockSync as withCanonicalWorkspaceLockSync } from "./process-execution-broker/workspace-transaction.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const RECOVERY_PHASES = new Set([
  "mutation_started",
  "workspace_applied",
  "session_committed",
  "recovery_required",
  "recovery_started",
]);
const TERMINAL_PHASES = new Set(["completed", "aborted", "rolled_back"]);

export const CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES = Object.freeze({
  ASYNC_UNSUPPORTED: "CHECKPOINT_RESTORE_ASYNC_UNSUPPORTED",
  BOUNDARY_MISSING: "CHECKPOINT_RESTORE_BOUNDARY_MISSING",
  INVALID_PLAN: "CHECKPOINT_RESTORE_PLAN_INVALID",
  INVALID_RESULT: "CHECKPOINT_RESTORE_RESULT_INVALID",
  SESSION_BOUNDARY_MISSING: "CHECKPOINT_RESTORE_SESSION_BOUNDARY_MISSING",
  WORKSPACE_STALE: "CHECKPOINT_WORKSPACE_STALE",
});

function restoreError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function asError(error) {
  if (error && typeof error === "object") return error;
  return new Error(String(error || "checkpoint restore failed"));
}

function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}

function requireSynchronous(value, boundary) {
  if (isThenable(value)) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.ASYNC_UNSUPPORTED,
      `${boundary} must be synchronous while the workspace lock is held`,
    );
  }
  return value;
}

function stableValue(value) {
  if (value === undefined) return "null";
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableValue(entry)).join(",")}]`;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("checkpoint restore value is not canonical JSON");
}

export function computeCheckpointRestoreDigest(domain, value) {
  if (typeof domain !== "string" || domain.length === 0) {
    throw new TypeError("checkpoint restore digest domain is required");
  }
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${stableValue(value)}`)
    .digest("hex")}`;
}

function boundedText(value, fallback, maximum = 2_048) {
  let sanitized = "";
  for (const character of String(value || fallback)) {
    const code = character.charCodeAt(0);
    sanitized += code < 32 || code === 127 ? " " : character;
  }
  const normalized = sanitized.trim();
  return (normalized || fallback).slice(0, maximum);
}

function errorCode(error) {
  return boundedText(error?.code, "CHECKPOINT_RESTORE_FAILED", 128);
}

function commitStateUnknown(error) {
  const seen = new Set();
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (/unknown/i.test(String(current.commitState || ""))) return true;
    current =
      current.transactionError ||
      current.checkpointRestoreCause ||
      current.cause ||
      null;
  }
  return false;
}

function pathKey(value, platform) {
  if (typeof value !== "string" || value.length === 0) return null;
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function rootsMatch(left, right, platform) {
  const leftKey = pathKey(left, platform);
  const rightKey = pathKey(right, platform);
  return leftKey !== null && leftKey === rightKey;
}

function requireText(value, field, maximum = 1_024) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      `checkpoint restore plan has an invalid ${field}`,
    );
  }
  return value;
}

function optionalText(value, field, maximum = 256) {
  return value == null ? null : requireText(value, field, maximum);
}

function normalizePlan(input, platform) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore plan is required",
    );
  }
  if (input.restoreKind !== "git" && input.restoreKind !== "copy") {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore plan must identify the git or copy engine",
    );
  }
  if (
    input.restoreSurface !== "direct" &&
    input.restoreSurface !== "timeline"
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore plan must identify its direct or timeline surface",
    );
  }
  const workspaceRoot = requireText(
    input.workspaceRoot,
    "workspaceRoot",
    4_096,
  );
  if (!path.isAbsolute(workspaceRoot)) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore workspaceRoot must be absolute",
    );
  }
  const binding = input.workspaceBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore plan requires a workspace binding",
    );
  }
  if (
    binding.engine !== input.restoreKind ||
    !rootsMatch(binding.workspaceRoot, workspaceRoot, platform)
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore binding does not match its engine or workspace",
    );
  }
  for (const field of [
    "scopeIdentity",
    "prestateIdentity",
    "writePlanIdentity",
    "targetPoststateIdentity",
  ]) {
    requireText(binding[field], `workspaceBinding.${field}`);
  }
  if (!Number.isSafeInteger(input.targetCount) || input.targetCount < 0) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore targetCount must be a non-negative safe integer",
    );
  }
  if (!HASH_PATTERN.test(String(input.confirmationDigest || ""))) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore confirmationDigest is invalid",
    );
  }
  const sessionId = optionalText(input.sessionId, "sessionId");
  const timelineEntryId = optionalText(
    input.timelineEntryId,
    "timelineEntryId",
  );
  if (input.restoreSurface === "direct" && (sessionId || timelineEntryId)) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "direct checkpoint restore cannot claim session authority",
    );
  }
  if (input.restoreSurface === "timeline" && !sessionId && !timelineEntryId) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "timeline checkpoint restore requires a session or timeline entry",
    );
  }

  const normalized = {
    ...input,
    restoreKind: input.restoreKind,
    restoreSurface: input.restoreSurface,
    checkpointId: requireText(input.checkpointId, "checkpointId", 256),
    checkpointIdentity: requireText(
      input.checkpointIdentity,
      "checkpointIdentity",
    ),
    checkpointNamespace: optionalText(
      input.checkpointNamespace,
      "checkpointNamespace",
    ),
    workspaceRoot,
    workspaceBinding: binding,
    targetCount: input.targetCount,
    confirmationDigest: input.confirmationDigest,
    sessionId,
    timelineEntryId,
  };
  normalized.authorityFingerprint = stableValue({
    restoreKind: normalized.restoreKind,
    restoreSurface: normalized.restoreSurface,
    checkpointId: normalized.checkpointId,
    checkpointIdentity: normalized.checkpointIdentity,
    checkpointNamespace: normalized.checkpointNamespace,
    workspaceRoot: pathKey(normalized.workspaceRoot, platform),
    workspaceBinding: normalized.workspaceBinding,
    targetCount: normalized.targetCount,
    confirmationDigest: normalized.confirmationDigest,
    sessionId: normalized.sessionId,
    timelineEntryId: normalized.timelineEntryId,
  });
  return Object.freeze(normalized);
}

function stalePlanError(message) {
  return restoreError(
    CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.WORKSPACE_STALE,
    message,
  );
}

function stateDigest(plan, state) {
  return computeCheckpointRestoreDigest(`cc-checkpoint-restore-${state}-v1`, {
    engine: plan.restoreKind,
    scopeIdentity: plan.workspaceBinding.scopeIdentity,
    stateIdentity:
      state === "prestate"
        ? plan.workspaceBinding.prestateIdentity
        : plan.workspaceBinding.targetPoststateIdentity,
  });
}

function validateSagaSnapshot(snapshot, operationId) {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    snapshot.operationId !== operationId ||
    !Number.isSafeInteger(snapshot.seq) ||
    snapshot.seq < 1 ||
    !HASH_PATTERN.test(String(snapshot.headHash || "")) ||
    typeof snapshot.phase !== "string"
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_RESULT,
      "checkpoint restore saga returned an invalid snapshot",
    );
  }
  return snapshot;
}

function exactEvidenceMatches(left, right) {
  try {
    return stableValue(left) === stableValue(right);
  } catch {
    return false;
  }
}

function attachDiagnostics(error, operationId, saga, recoveryRequired = null) {
  const diagnosed = asError(error);
  diagnosed.checkpointRestoreOperationId ||= operationId;
  diagnosed.checkpointRestoreSagaPhase ||= saga?.phase || null;
  diagnosed.checkpointRestoreSagaSeq ||= saga?.seq || null;
  diagnosed.checkpointRestoreSagaHeadHash ||= saga?.headHash || null;
  if (recoveryRequired !== null) {
    diagnosed.checkpointRestoreRecoveryRequired = recoveryRequired;
  }
  return diagnosed;
}

function attachSafetyEvidence(error, evidence) {
  const diagnosed = asError(error);
  if (!evidence) return diagnosed;
  diagnosed.safetyId ||= evidence.safetyId || null;
  diagnosed.safetyIdentity ||= evidence.safetyIdentity || null;
  diagnosed.safetyPlanIdentity ||= evidence.safetyPlanIdentity || null;
  diagnosed.safetyCoverage ||= evidence.safetyCoverage || null;
  return diagnosed;
}

/**
 * Execute one checkpoint restore under a canonical workspace lock and durable
 * saga. The optional withSessionAuthority callback is required for timeline
 * restores and forbidden for direct restores.
 *
 * @param {object} options
 * @param {object} options.plan immutable pre-lock authority plan
 * @param {Function} options.revalidate sync callback returning the locked plan
 * @param {Function} options.restore sync engine callback; it must use hooks
 * @param {Function} [options.withSessionAuthority] sync timeline settlement
 * @param {string} [options.operationId]
 * @param {object} [options.dependencies]
 * @returns {{operationId:string,result:*,sessionCommitDigest:string|null,
 *   saga:{phase:string,seq:number,headHash:string},warnings:string[]}}
 */
export function runCheckpointRestoreOperation(options = {}) {
  const dependencies = options.dependencies || {};
  const platform = dependencies.platform || process.platform;
  const initialPlan = normalizePlan(options.plan, platform);
  if (typeof options.revalidate !== "function") {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore revalidate callback is required",
    );
  }
  if (typeof options.restore !== "function") {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore engine callback is required",
    );
  }
  if (
    initialPlan.restoreSurface === "timeline" &&
    typeof options.withSessionAuthority !== "function"
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "timeline checkpoint restore requires withSessionAuthority",
    );
  }
  if (
    initialPlan.restoreSurface === "direct" &&
    options.withSessionAuthority != null
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "direct checkpoint restore cannot use session authority",
    );
  }

  const operationId =
    options.operationId ||
    (
      dependencies.createOperationId ||
      (() => `checkpoint-restore-${randomUUID()}`)
    )();
  if (
    typeof operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(operationId)
  ) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore operationId is invalid",
    );
  }
  const actorPid = dependencies.actorPid ?? process.pid;
  if (!Number.isSafeInteger(actorPid) || actorPid <= 0) {
    throw restoreError(
      CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      "checkpoint restore actorPid is invalid",
    );
  }
  const createSagaStore =
    dependencies.createSagaStore ||
    ((storeOptions) => new CheckpointRestoreSagaStore(storeOptions));
  const withWorkspaceLockSync =
    dependencies.withWorkspaceLockSync || withCanonicalWorkspaceLockSync;
  const workspaceLockOwnerDigest =
    dependencies.computeWorkspaceLockOwnerDigest ||
    computeCheckpointRestoreWorkspaceLockOwnerDigest;

  let sagaStore = null;
  let saga = null;
  let latestSafetyEvidence = null;
  let sessionCommitDigest = null;
  let callbackEntered = false;
  let deferredFailure = null;

  const loadSaga = () => {
    const loaded = requireSynchronous(
      sagaStore.load(operationId),
      "checkpoint restore saga load",
    );
    saga = validateSagaSnapshot(loaded, operationId);
    return saga;
  };

  const advanceSaga = (phase, evidence) => {
    const prior = saga || loadSaga();
    try {
      const advanced = requireSynchronous(
        sagaStore.advance(operationId, {
          expectedSeq: prior.seq,
          expectedHash: prior.headHash,
          phase,
          evidence,
        }),
        "checkpoint restore saga advance",
      );
      saga = validateSagaSnapshot(advanced, operationId);
      return saga;
    } catch (caught) {
      const error = asError(caught);
      try {
        const observed = loadSaga();
        const latest = observed?.events?.at(-1);
        if (
          observed.seq === prior.seq + 1 &&
          observed.phase === phase &&
          latest?.prevHash === prior.headHash &&
          exactEvidenceMatches(latest.evidence, evidence)
        ) {
          return observed;
        }
      } catch (loadError) {
        error.checkpointRestoreSagaLoadError = loadError;
      }
      throw attachDiagnostics(error, operationId, saga);
    }
  };

  const archiveTerminal = () => {
    const archived = requireSynchronous(
      sagaStore.archiveTerminal(operationId, {
        expectedSeq: saga.seq,
        expectedHash: saga.headHash,
      }),
      "checkpoint restore saga archive",
    );
    return archived;
  };

  const settleFailure = (caught, workspaceLease) => {
    const operationError = attachSafetyEvidence(
      asError(caught),
      latestSafetyEvidence,
    );
    let sagaLoadFailed = false;
    try {
      loadSaga();
    } catch (loadError) {
      sagaLoadFailed = true;
      operationError.checkpointRestoreSagaLoadError = loadError;
    }

    let recoveryRequired =
      sagaLoadFailed ||
      commitStateUnknown(operationError) ||
      operationError.checkpointRestoreSessionSettled === true ||
      RECOVERY_PHASES.has(saga?.phase) ||
      operationError.restorePhase === "workspace-mutation" ||
      operationError.restorePhase === "workspace-applied";

    if (
      !recoveryRequired &&
      saga?.pending &&
      saga.phase !== "recovery_required" &&
      saga.phase !== "recovery_started"
    ) {
      try {
        advanceSaga("aborted", {
          reason: boundedText(
            operationError.message,
            "checkpoint restore stopped before workspace mutation",
          ),
        });
      } catch (abortError) {
        recoveryRequired = true;
        operationError.checkpointRestoreSagaError = abortError;
      }
    }

    if (recoveryRequired && !sagaLoadFailed) {
      try {
        if (
          saga?.pending &&
          saga.phase !== "recovery_required" &&
          saga.phase !== "recovery_started"
        ) {
          advanceSaga("recovery_required", {
            reason: boundedText(
              operationError.message,
              "checkpoint restore outcome requires recovery",
            ),
            errorCode: errorCode(operationError),
          });
        }
      } catch (recoveryError) {
        operationError.checkpointRestoreSagaError = recoveryError;
      }
    }

    attachDiagnostics(operationError, operationId, saga, recoveryRequired);
    if (!recoveryRequired && saga && TERMINAL_PHASES.has(saga.phase)) {
      // When a workspace lease exists, the terminal saga must not move into
      // archive retention until the lifetime lock has been released. Return a
      // sentinel through the callback; the outer scope archives and rethrows
      // only after withWorkspaceLockSync has completed its release boundary.
      if (workspaceLease) {
        deferredFailure = operationError;
        return undefined;
      }
      try {
        archiveTerminal();
      } catch (archiveError) {
        operationError.checkpointRestoreSagaArchiveError = archiveError;
      }
    }

    if (recoveryRequired && workspaceLease) {
      try {
        workspaceLease.retainForRecovery(
          boundedText(
            `${errorCode(operationError)}: ${operationError.message || "restore outcome unknown"}`,
            "checkpoint restore outcome unknown",
            512,
          ),
        );
        operationError.workspaceLockRetained = true;
      } catch (retentionCaught) {
        const retentionError = asError(retentionCaught);
        retentionError.checkpointRestoreCause = operationError;
        retentionError.checkpointRestoreOperationId = operationId;
        retentionError.checkpointRestoreSagaPhase = saga?.phase || null;
        retentionError.checkpointRestoreSagaSeq = saga?.seq || null;
        retentionError.checkpointRestoreSagaHeadHash = saga?.headHash || null;
        retentionError.checkpointRestoreRecoveryRequired = true;
        throw retentionError;
      }
    }
    throw operationError;
  };

  try {
    sagaStore = requireSynchronous(
      createSagaStore({ workspaceRoot: initialPlan.workspaceRoot }),
      "checkpoint restore saga store creation",
    );
    if (
      !sagaStore ||
      typeof sagaStore.create !== "function" ||
      typeof sagaStore.load !== "function" ||
      typeof sagaStore.advance !== "function" ||
      typeof sagaStore.archiveTerminal !== "function"
    ) {
      throw restoreError(
        CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_RESULT,
        "checkpoint restore saga store is invalid",
      );
    }
    const createdEvidence = {
      restoreKind: initialPlan.restoreKind,
      restoreSurface: initialPlan.restoreSurface,
      checkpointId: initialPlan.checkpointId,
      checkpointIdentity: initialPlan.checkpointIdentity,
      ...(initialPlan.checkpointNamespace
        ? { checkpointNamespace: initialPlan.checkpointNamespace }
        : {}),
      ...(initialPlan.sessionId ? { sessionId: initialPlan.sessionId } : {}),
      ...(initialPlan.timelineEntryId
        ? { timelineEntryId: initialPlan.timelineEntryId }
        : {}),
      workspaceBinding:
        initialPlan.workspaceBinding.writePlanIdentity ||
        initialPlan.confirmationDigest,
      confirmationDigest: initialPlan.confirmationDigest,
      actorPid,
    };
    saga = validateSagaSnapshot(
      requireSynchronous(
        sagaStore.create({ operationId, evidence: createdEvidence }),
        "checkpoint restore saga creation",
      ),
      operationId,
    );
  } catch (caught) {
    throw attachDiagnostics(asError(caught), operationId, saga);
  }

  let result;
  let workspaceLease = null;
  try {
    const lockedResult = withWorkspaceLockSync(
      {
        workspaceRoot: initialPlan.workspaceRoot,
        operationId,
        purpose: "checkpoint-restore",
      },
      (lease) => {
        callbackEntered = true;
        workspaceLease = lease;
        try {
          if (
            !lease ||
            typeof lease.assertOwned !== "function" ||
            typeof lease.retainForRecovery !== "function" ||
            !lease.owner
          ) {
            throw restoreError(
              CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_RESULT,
              "workspace lock returned an invalid lease",
            );
          }
          lease.assertOwned();
          advanceSaga("locked", {
            workspaceLockOwner: lease.owner,
            lockOwnerDigest: workspaceLockOwnerDigest(lease.owner),
          });

          const lockedPlan = normalizePlan(
            requireSynchronous(
              options.revalidate({
                operationId,
                plan: initialPlan,
                workspaceLease: lease,
              }),
              "checkpoint restore revalidation",
            ),
            platform,
          );
          if (
            lockedPlan.authorityFingerprint !== initialPlan.authorityFingerprint
          ) {
            throw stalePlanError(
              "workspace or checkpoint restore plan changed while waiting for the lock",
            );
          }
          if (
            !rootsMatch(
              lockedPlan.workspaceRoot,
              lease.canonicalWorkspaceRoot,
              platform,
            )
          ) {
            throw stalePlanError(
              "checkpoint restore scope changed while waiting for the lock",
            );
          }

          advanceSaga("prepared", {
            prestateDigest: stateDigest(lockedPlan, "prestate"),
            targetCount: lockedPlan.targetCount,
            workspaceBinding:
              lockedPlan.workspaceBinding.writePlanIdentity ||
              lockedPlan.confirmationDigest,
          });
          lease.assertOwned();

          let intentCommitted = false;
          let restoreInvoked = false;

          const commitIntent = (intentCommitDigest) => {
            lease.assertOwned();
            if (intentCommitted) {
              throw restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                "checkpoint restore intent was committed more than once",
              );
            }
            if (!HASH_PATTERN.test(String(intentCommitDigest || ""))) {
              throw restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                "checkpoint restore intent commit digest is invalid",
              );
            }
            advanceSaga("intent_committed", {
              intentAuthority:
                lockedPlan.restoreSurface === "timeline"
                  ? "session"
                  : "operation",
              intentCommitDigest,
              ...(lockedPlan.restoreSurface === "timeline" &&
              lockedPlan.sessionId
                ? { sessionId: lockedPlan.sessionId }
                : {}),
              ...(lockedPlan.restoreSurface === "timeline" &&
              lockedPlan.timelineEntryId
                ? { timelineEntryId: lockedPlan.timelineEntryId }
                : {}),
            });
            intentCommitted = true;
            lease.assertOwned();
          };

          const hooks = {
            onSafetyReady(evidence = {}) {
              lease.assertOwned();
              if (lockedPlan.targetCount === 0) {
                throw restoreError(
                  CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                  "zero-target checkpoint restore cannot create safety evidence",
                  { restorePhase: "safety-ready" },
                );
              }
              latestSafetyEvidence = {
                safetyId: evidence.safetyId,
                safetyIdentity: evidence.safetyIdentity,
                safetyPlanIdentity: evidence.safetyPlanIdentity,
                safetyCoverage: evidence.safetyCoverage,
              };
              advanceSaga("safety_ready", latestSafetyEvidence);
              lease.assertOwned();
            },
            onMutationStarted(evidence = {}) {
              lease.assertOwned();
              if (
                lockedPlan.targetCount === 0 ||
                evidence.mutationCount !== lockedPlan.targetCount
              ) {
                throw restoreError(
                  CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                  "checkpoint restore mutation count does not match its prepared plan",
                  { restorePhase: "workspace-mutation" },
                );
              }
              advanceSaga("mutation_started", {
                targetCount: lockedPlan.targetCount,
              });
              lease.assertOwned();
            },
            onWorkspaceApplied(evidence = {}) {
              lease.assertOwned();
              if (
                !Number.isSafeInteger(evidence.appliedCount) ||
                evidence.appliedCount !== lockedPlan.targetCount
              ) {
                throw restoreError(
                  CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                  "checkpoint restore applied count does not match its prepared plan",
                  { restorePhase: "workspace-applied" },
                );
              }
              advanceSaga("workspace_applied", {
                appliedCount: evidence.appliedCount,
                poststateDigest: stateDigest(lockedPlan, "poststate"),
              });
              lease.assertOwned();
            },
          };

          const restoreWorkspace = () => {
            lease.assertOwned();
            if (!intentCommitted) {
              throw restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                "checkpoint restore cannot mutate before durable intent",
              );
            }
            if (restoreInvoked) {
              throw restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                "checkpoint restore engine was invoked more than once",
              );
            }
            restoreInvoked = true;
            let restored;
            try {
              restored = requireSynchronous(
                options.restore({
                  operationId,
                  plan: lockedPlan,
                  workspaceLease: lease,
                  expectedIdentity: lockedPlan.checkpointIdentity,
                  expectedWorkspaceBinding: lockedPlan.workspaceBinding,
                  targetCount: lockedPlan.targetCount,
                  hooks,
                }),
                "checkpoint restore engine",
              );
            } catch (caught) {
              throw attachSafetyEvidence(asError(caught), latestSafetyEvidence);
            }
            if (saga?.phase !== "workspace_applied") {
              throw restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                "checkpoint restore engine omitted its durable workspace boundary",
                { restorePhase: "workspace-applied" },
              );
            }
            lease.assertOwned();
            return restored;
          };

          if (lockedPlan.restoreSurface === "timeline") {
            const settled = requireSynchronous(
              options.withSessionAuthority({
                operationId,
                plan: lockedPlan,
                workspaceLease: lease,
                commitIntent,
                restoreWorkspace,
              }),
              "checkpoint restore session authority",
            );
            if (
              !settled ||
              typeof settled !== "object" ||
              !Object.hasOwn(settled, "result") ||
              !HASH_PATTERN.test(String(settled.sessionCommitDigest || ""))
            ) {
              throw restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.SESSION_BOUNDARY_MISSING,
                "checkpoint restore session settlement is unavailable",
                { commitState: "unknown" },
              );
            }
            // A successful adapter return proves that its session transaction
            // settled. Any missing workspace boundary after that point is not
            // a safe pre-mutation abort: a durable session intent may exist.
            // Preserve the workspace lock so recovery can reconcile both
            // authorities instead of silently archiving the operation.
            if (saga?.phase !== "workspace_applied") {
              const boundaryError = restoreError(
                CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.BOUNDARY_MISSING,
                "checkpoint restore session authority omitted workspace settlement",
              );
              boundaryError.checkpointRestoreSessionSettled = true;
              throw boundaryError;
            }
            sessionCommitDigest = settled.sessionCommitDigest;
            lease.assertOwned();
            advanceSaga("session_committed", { sessionCommitDigest });
            result = settled.result;
          } else {
            commitIntent(
              computeCheckpointRestoreDigest(
                "cc-checkpoint-restore-operation-intent-v1",
                {
                  operationId,
                  restoreKind: lockedPlan.restoreKind,
                  checkpointId: lockedPlan.checkpointId,
                  checkpointIdentity: lockedPlan.checkpointIdentity,
                  checkpointNamespace: lockedPlan.checkpointNamespace,
                  workspaceBinding:
                    lockedPlan.workspaceBinding.writePlanIdentity,
                  confirmationDigest: lockedPlan.confirmationDigest,
                  targetCount: lockedPlan.targetCount,
                },
              ),
            );
            result = restoreWorkspace();
          }

          lease.assertOwned();
          advanceSaga("completed", {
            resultDigest: computeCheckpointRestoreDigest(
              "cc-checkpoint-restore-result-v1",
              {
                operationId,
                restoreSurface: lockedPlan.restoreSurface,
                sessionCommitDigest,
                result,
              },
            ),
          });
          lease.assertOwned();
          return result;
        } catch (caught) {
          return settleFailure(caught, lease);
        }
      },
    );
    requireSynchronous(lockedResult, "checkpoint restore workspace lock");
    if (deferredFailure) {
      try {
        archiveTerminal();
      } catch (archiveError) {
        deferredFailure.checkpointRestoreSagaArchiveError = archiveError;
      }
      throw deferredFailure;
    }
  } catch (caught) {
    if (callbackEntered) {
      const callbackError = attachDiagnostics(
        asError(caught),
        operationId,
        saga,
      );
      if (deferredFailure && callbackError !== deferredFailure) {
        callbackError.checkpointRestoreCause ||= deferredFailure;
        callbackError.checkpointRestoreRecoveryRequired = true;
      } else if (saga?.terminal && callbackError !== deferredFailure) {
        // A terminal callback returned but the workspace lifetime boundary
        // itself failed. The saga is authoritative, but its lock release is
        // uncertain and must remain visible to recovery tooling.
        callbackError.checkpointRestoreRecoveryRequired = true;
      }
      throw callbackError;
    }
    return settleFailure(caught, workspaceLease);
  }

  let archiveWarning = null;
  try {
    archiveTerminal();
  } catch (archiveError) {
    archiveWarning = boundedText(
      `restore completed, but its saga archive is pending: ${archiveError?.code || archiveError?.message || "archive failed"}`,
      "restore completed, but its saga archive is pending",
      512,
    );
  }

  return {
    operationId,
    result,
    sessionCommitDigest,
    saga: {
      phase: saga.phase,
      seq: saga.seq,
      headHash: saga.headHash,
    },
    warnings: archiveWarning ? [archiveWarning] : [],
  };
}
