/**
 * `cc checkpoint recovery` command surface.
 *
 * The command layer keeps read projections and mutation authority separate:
 * saga evidence supplies the exact sequence/head, while the canonical
 * workspace lock is inspected immediately before show/abort/resume/release to
 * derive a live owner digest (or verified absence). The complete owner is
 * never returned or printed.
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import {
  CHECKPOINT_RESTORE_SAGA_PHASES,
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../lib/checkpoint-restore-saga.js";
import {
  readVerifiedProjection,
  withSessionAuthorityTransaction,
} from "../harness/jsonl-session-store.js";
import {
  createCheckpointRestoreRecoveryReader,
  MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT,
} from "../lib/checkpoint-restore-recovery.js";
import { CheckpointRestoreRecoveryController } from "../lib/checkpoint-restore-recovery-controller.js";
import {
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
  CheckpointRestoreAlreadyCompletedController,
} from "../lib/checkpoint-restore-already-completed-controller.js";
import { createCheckpointRestoreSessionRecoveryReader } from "../lib/checkpoint-restore-session-recovery.js";
import {
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
  CheckpointRestorePartialRollbackController,
} from "../lib/checkpoint-restore-partial-rollback-controller.js";
import { CheckpointRestoreWorkspaceTargetVerifier } from "../lib/checkpoint-restore-workspace-target-verifier.js";
import {
  executeCheckpointRollback as executeGitCheckpointRollback,
  prepareCheckpointRollback as prepareGitCheckpointRollback,
} from "../lib/checkpoint-store.js";
import {
  executeCheckpointRollback as executeCopyCheckpointRollback,
  prepareCheckpointRollback as prepareCopyCheckpointRollback,
} from "../lib/file-checkpoint.js";
import {
  inspectWorkspaceLockOwnerSync,
  withWorkspaceRecoveryLockSync,
} from "../lib/process-execution-broker/workspace-transaction.js";

export const CHECKPOINT_RESTORE_RECOVERY_COMMAND_PREVIEW_SCHEMA =
  "chainlesschain.checkpoint-restore-recovery-command-preview";
export const CHECKPOINT_RESTORE_RECOVERY_COMMAND_RESULT_SCHEMA =
  "chainlesschain.checkpoint-restore-recovery-command-result";
export const CHECKPOINT_RESTORE_RECOVERY_COMMAND_ERROR_SCHEMA =
  "chainlesschain.checkpoint-restore-recovery-command-error";
export const CHECKPOINT_RESTORE_RECOVERY_COMMAND_VERSION = 1;

export const CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES = Object.freeze({
  OK: 0,
  FAILURE: 1,
  INVALID_USAGE: 2,
  NOT_EXECUTABLE: 3,
});

export const CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "CHECKPOINT_RESTORE_RECOVERY_CLI_INVALID_ARGUMENT",
  CONFIRMATION_REQUIRED:
    "CHECKPOINT_RESTORE_RECOVERY_CLI_CONFIRMATION_REQUIRED",
  FENCE_MISMATCH: "CHECKPOINT_RESTORE_RECOVERY_CLI_FENCE_MISMATCH",
  ACTION_NOT_ELIGIBLE: "CHECKPOINT_RESTORE_RECOVERY_CLI_ACTION_NOT_ELIGIBLE",
  INVALID_DEPENDENCY: "CHECKPOINT_RESTORE_RECOVERY_CLI_INVALID_DEPENDENCY",
  WORKSPACE_UNAVAILABLE:
    "CHECKPOINT_RESTORE_RECOVERY_CLI_WORKSPACE_UNAVAILABLE",
  FAILED: "CHECKPOINT_RESTORE_RECOVERY_CLI_FAILED",
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const PHASES = new Set(CHECKPOINT_RESTORE_SAGA_PHASES);
const CONTROLLER_ABORT_PHASES = new Set(["created", "locked"]);
const CONTROLLER_RESUME_PHASES = new Set([
  "workspace_applied",
  "session_committed",
]);
const CONTROLLER_ROLLBACK_PHASES = new Set([
  "mutation_started",
  "rollback_prepared",
  "rollback_started",
  "workspace_rolled_back",
  "session_rollback_committed",
]);
const ROLLBACK_BINDING_PHASES = new Set([
  "rollback_prepared",
  "rollback_started",
  "workspace_rolled_back",
  "session_rollback_committed",
]);
const CHECKPOINT_RESTORE_PURPOSE = "checkpoint-restore";
const RECOVERY_REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const GIT_CHECKPOINT_IDENTITY_PATTERN = /^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const GIT_CHECKPOINT_NAMESPACE_PATTERN =
  /^(?!\.)(?!.*\.\.)(?!.*\.lock$)(?!.*\.$)[A-Za-z0-9._-]{1,256}$/i;

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  CHECKPOINT_RESTORE_RECOVERY_CLI_INVALID_ARGUMENT:
    "Recovery arguments are invalid; refresh the read-only preview and retry.",
  CHECKPOINT_RESTORE_RECOVERY_CLI_CONFIRMATION_REQUIRED:
    "Mutation requires an explicit --yes confirmation.",
  CHECKPOINT_RESTORE_RECOVERY_CLI_FENCE_MISMATCH:
    "Recovery authority changed or the supplied fence is stale; run recovery show again.",
  CHECKPOINT_RESTORE_RECOVERY_CLI_ACTION_NOT_ELIGIBLE:
    "This recovery action is not executable from the verified current state.",
  CHECKPOINT_RESTORE_RECOVERY_CLI_INVALID_DEPENDENCY:
    "Recovery authority could not be projected safely.",
  CHECKPOINT_RESTORE_RECOVERY_CLI_WORKSPACE_UNAVAILABLE:
    "The recovery workspace does not exist or cannot be resolved safely.",
  CHECKPOINT_RESTORE_RECOVERY_CLI_FAILED:
    "Checkpoint restore recovery failed without changing the requested authority.",
  CHECKPOINT_RESTORE_RECOVERY_INVALID_ARGUMENT:
    "Recovery arguments are invalid; refresh the read-only preview and retry.",
  CHECKPOINT_RESTORE_RECOVERY_SAGA_CONFLICT:
    "The checkpoint restore saga changed; run recovery show again.",
  CHECKPOINT_RESTORE_RECOVERY_ACTION_NOT_ALLOWED:
    "The requested action is not allowed from the verified recovery phase.",
  CHECKPOINT_RESTORE_RECOVERY_OWNER_CONFLICT:
    "The live workspace recovery owner could not be matched exactly.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_INVALID_ARGUMENT:
    "Recovery arguments are invalid; refresh the read-only preview and retry.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_SAGA_CONFLICT:
    "The checkpoint restore saga changed; run recovery show again.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION_NOT_ALLOWED:
    "Resume is limited to a verified timeline restore already completed in session authority.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_OWNER_CONFLICT:
    "The live workspace recovery owner could not be matched exactly.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_SESSION_CONFLICT:
    "The session transcript does not prove one exact completed restore settlement.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_WORKSPACE_CONFLICT:
    "The workspace does not match the exact restored checkpoint target.",
  CHECKPOINT_RESTORE_ALREADY_COMPLETED_ASYNC_UNSUPPORTED:
    "Recovery verification must complete synchronously under workspace authority.",
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_INVALID_ARGUMENT:
    "Workspace target verification authority is invalid.",
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_CONFLICT:
    "The workspace does not match the exact restored checkpoint target.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_INVALID_ARGUMENT:
    "Recovery arguments are invalid; refresh the read-only preview and retry.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_SAGA_CONFLICT:
    "The checkpoint restore saga changed; run recovery show again.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION_NOT_ALLOWED:
    "Partial rollback is not executable from the verified current state.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OWNER_CONFLICT:
    "The live workspace recovery owner could not be matched exactly.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_PLAN_INVALID:
    "The exact workspace rollback plan could not be proven safely.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_RESULT_INVALID:
    "Workspace rollback completion could not be proven; recovery authority was retained.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_SESSION_CONFLICT:
    "The session transcript does not prove one exact rollback settlement.",
  CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ASYNC_UNSUPPORTED:
    "Recovery verification must remain synchronous under workspace authority.",
  CHECKPOINT_RESTORE_SAGA_NOT_FOUND:
    "The requested checkpoint restore recovery operation was not found.",
  CHECKPOINT_RESTORE_SAGA_CONFLICT:
    "The checkpoint restore saga changed; run recovery show again.",
  CHECKPOINT_RESTORE_SAGA_CORRUPT:
    "Checkpoint restore recovery evidence is corrupt and was rejected.",
  WORKSPACE_TRANSACTION_RECOVERY_REQUIRED:
    "The workspace is owned by a different durable operation.",
  WORKSPACE_TRANSACTION_LOCK_CORRUPT:
    "The live workspace lock could not be verified safely.",
});

const INVALID_USAGE_PUBLIC_ERRORS = new Set([
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
  "CHECKPOINT_RESTORE_RECOVERY_INVALID_ARGUMENT",
  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_INVALID_ARGUMENT",
  "CHECKPOINT_RESTORE_WORKSPACE_TARGET_INVALID_ARGUMENT",
  "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_INVALID_ARGUMENT",
]);

const NOT_EXECUTABLE_PUBLIC_ERRORS = new Set([
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FENCE_MISMATCH,
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
  CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.WORKSPACE_UNAVAILABLE,
  "CHECKPOINT_RESTORE_RECOVERY_SAGA_CONFLICT",
  "CHECKPOINT_RESTORE_RECOVERY_ACTION_NOT_ALLOWED",
  "CHECKPOINT_RESTORE_RECOVERY_OWNER_CONFLICT",
  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_SAGA_CONFLICT",
  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION_NOT_ALLOWED",
  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_OWNER_CONFLICT",
  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_SESSION_CONFLICT",
  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_WORKSPACE_CONFLICT",
  "CHECKPOINT_RESTORE_WORKSPACE_TARGET_CONFLICT",
  "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_SAGA_CONFLICT",
  "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION_NOT_ALLOWED",
  "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_OWNER_CONFLICT",
  "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_PLAN_INVALID",
  "CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_SESSION_CONFLICT",
  "CHECKPOINT_RESTORE_SAGA_NOT_FOUND",
  "CHECKPOINT_RESTORE_SAGA_CONFLICT",
  "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
]);

export class CheckpointRestoreRecoveryCliError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.name = "CheckpointRestoreRecoveryCliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function cliError(code, exitCode) {
  return new CheckpointRestoreRecoveryCliError(
    code,
    PUBLIC_ERROR_MESSAGES[code] ||
      PUBLIC_ERROR_MESSAGES.CHECKPOINT_RESTORE_RECOVERY_CLI_FAILED,
    exitCode,
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function publicErrorCode(error) {
  let value = null;
  try {
    value = error?.code;
  } catch {
    return CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FAILED;
  }
  return typeof value === "string" &&
    ERROR_CODE_PATTERN.test(value) &&
    Object.hasOwn(PUBLIC_ERROR_MESSAGES, value)
    ? value
    : CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FAILED;
}

function publicError(error) {
  const code = publicErrorCode(error);
  const message =
    PUBLIC_ERROR_MESSAGES[code] ||
    PUBLIC_ERROR_MESSAGES.CHECKPOINT_RESTORE_RECOVERY_CLI_FAILED;
  return new CheckpointRestoreRecoveryCliError(
    code,
    message,
    INVALID_USAGE_PUBLIC_ERRORS.has(code)
      ? CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE
      : NOT_EXECUTABLE_PUBLIC_ERRORS.has(code)
        ? CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE
        : CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
  );
}

function assertOperationId(operationId) {
  if (
    typeof operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(operationId)
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  return operationId;
}

function parsePositiveInteger(value) {
  if (
    (typeof value !== "string" && !Number.isSafeInteger(value)) ||
    (typeof value === "string" && !/^[1-9]\d*$/.test(value))
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  return parsed;
}

function parseHash(value, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) {
    return null;
  }
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  return value;
}

function normalizeDependencies(dependencies = {}) {
  if (!isPlainObject(dependencies)) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  return Object.freeze({
    resolveWorkspaceRoot:
      dependencies.resolveWorkspaceRoot || ((value) => path.resolve(value)),
    canonicalizeWorkspaceRoot:
      dependencies.canonicalizeWorkspaceRoot ||
      ((value) => realpathSync.native(value)),
    createStore:
      dependencies.createStore ||
      ((options) => new CheckpointRestoreSagaStore(options)),
    createRecoveryReader:
      dependencies.createRecoveryReader ||
      ((options) => createCheckpointRestoreRecoveryReader(options)),
    createRecoveryController:
      dependencies.createRecoveryController ||
      ((options) => new CheckpointRestoreRecoveryController(options)),
    createSessionRecoveryReader:
      dependencies.createSessionRecoveryReader ||
      (() =>
        createCheckpointRestoreSessionRecoveryReader({
          readVerifiedProjection,
        })),
    createWorkspaceTargetVerifier:
      dependencies.createWorkspaceTargetVerifier ||
      (() => new CheckpointRestoreWorkspaceTargetVerifier()),
    createAlreadyCompletedController:
      dependencies.createAlreadyCompletedController ||
      ((options) => new CheckpointRestoreAlreadyCompletedController(options)),
    createPartialRollbackController:
      dependencies.createPartialRollbackController ||
      ((options) => new CheckpointRestorePartialRollbackController(options)),
    prepareGitCheckpointRollback:
      dependencies.prepareGitCheckpointRollback || prepareGitCheckpointRollback,
    executeGitCheckpointRollback:
      dependencies.executeGitCheckpointRollback || executeGitCheckpointRollback,
    prepareCopyCheckpointRollback:
      dependencies.prepareCopyCheckpointRollback ||
      prepareCopyCheckpointRollback,
    executeCopyCheckpointRollback:
      dependencies.executeCopyCheckpointRollback ||
      executeCopyCheckpointRollback,
    withSessionAuthorityTransaction:
      dependencies.withSessionAuthorityTransaction ||
      withSessionAuthorityTransaction,
    inspectWorkspaceLockOwnerSync:
      dependencies.inspectWorkspaceLockOwnerSync ||
      inspectWorkspaceLockOwnerSync,
    withWorkspaceRecoveryLockSync:
      dependencies.withWorkspaceRecoveryLockSync ||
      withWorkspaceRecoveryLockSync,
    computeWorkspaceLockOwnerDigest:
      dependencies.computeWorkspaceLockOwnerDigest ||
      computeCheckpointRestoreWorkspaceLockOwnerDigest,
    workspaceLockOptions: Object.freeze({
      ...(dependencies.workspaceLockOptions || {}),
    }),
    writeStdout:
      dependencies.writeStdout || ((value) => console.log(String(value))),
    writeStderr:
      dependencies.writeStderr || ((value) => console.error(String(value))),
    setExitCode:
      dependencies.setExitCode || ((value) => (process.exitCode = value)),
  });
}

function invalidRollbackAdapterAuthority() {
  return cliError(
    CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
    CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
  );
}

function isCanonicalGitCheckpointNamespace(value) {
  return (
    typeof value === "string" && GIT_CHECKPOINT_NAMESPACE_PATTERN.test(value)
  );
}

function createWorkspaceRollbackAdapters(runtime) {
  const prepareWorkspaceRollback = (request) => {
    const expected = request?.expected;
    const original = expected?.originalCheckpoint;
    const safety = expected?.safetyCheckpoint;
    if (
      !isPlainObject(request) ||
      !isPlainObject(expected) ||
      !isPlainObject(original) ||
      !isPlainObject(safety) ||
      typeof request.workspaceRoot !== "string"
    ) {
      throw invalidRollbackAdapterAuthority();
    }
    const options = {
      expectedOriginalIdentity: original.identity,
      expectedSafetyIdentity: safety.identity,
      expectedSafetyPlanIdentity: safety.planIdentity,
      originalMutationTargetCount: expected.originalMutationTargetCount,
    };
    if (expected.engine === "git") {
      if (!isCanonicalGitCheckpointNamespace(expected.checkpointNamespace)) {
        throw invalidRollbackAdapterAuthority();
      }
      return runtime.prepareGitCheckpointRollback(
        request.workspaceRoot,
        original.id,
        safety.id,
        { ...options, session: expected.checkpointNamespace },
      );
    }
    if (expected.engine === "copy") {
      if (expected.checkpointNamespace !== null) {
        throw invalidRollbackAdapterAuthority();
      }
      return runtime.prepareCopyCheckpointRollback(
        request.workspaceRoot,
        original.id,
        safety.id,
        options,
      );
    }
    throw invalidRollbackAdapterAuthority();
  };

  const executeWorkspaceRollback = (request) => {
    if (
      !isPlainObject(request) ||
      typeof request.workspaceRoot !== "string" ||
      !isPlainObject(request.plan)
    ) {
      throw invalidRollbackAdapterAuthority();
    }
    const options = { workspaceLease: request.workspaceLease };
    if (request.plan.engine === "git") {
      return runtime.executeGitCheckpointRollback(
        request.workspaceRoot,
        request.plan,
        options,
      );
    }
    if (request.plan.engine === "copy") {
      if (request.plan.checkpointNamespace !== null) {
        throw invalidRollbackAdapterAuthority();
      }
      return runtime.executeCopyCheckpointRollback(
        request.workspaceRoot,
        request.plan,
        options,
      );
    }
    throw invalidRollbackAdapterAuthority();
  };

  return Object.freeze({
    prepareWorkspaceRollback,
    executeWorkspaceRollback,
  });
}

function openContext(
  runtime,
  directory,
  {
    mutation = false,
    alreadyCompletedResume = false,
    partialRollback = false,
  } = {},
) {
  const resolvedWorkspaceRoot = runtime.resolveWorkspaceRoot(directory || ".");
  if (
    typeof resolvedWorkspaceRoot !== "string" ||
    resolvedWorkspaceRoot.length === 0
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  let workspaceRoot;
  try {
    workspaceRoot = runtime.canonicalizeWorkspaceRoot(resolvedWorkspaceRoot);
  } catch {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.WORKSPACE_UNAVAILABLE,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    );
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  const store = runtime.createStore({ workspaceRoot });
  const reader = runtime.createRecoveryReader({ workspaceRoot, store });
  if (
    !reader ||
    typeof reader.list !== "function" ||
    typeof reader.show !== "function"
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  let controller = null;
  if (mutation) {
    controller = runtime.createRecoveryController({
      workspaceRoot,
      store,
      inspectWorkspaceLockOwnerSync: runtime.inspectWorkspaceLockOwnerSync,
      computeWorkspaceLockOwnerDigest: runtime.computeWorkspaceLockOwnerDigest,
      workspaceLockOptions: runtime.workspaceLockOptions,
    });
    if (
      !controller ||
      typeof controller.abort !== "function" ||
      typeof controller.release !== "function"
    ) {
      throw cliError(
        CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
        CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
      );
    }
  }
  let alreadyCompletedController = null;
  if (alreadyCompletedResume) {
    const sessionRecoveryReader = runtime.createSessionRecoveryReader({
      workspaceRoot,
    });
    const workspaceTargetVerifier = runtime.createWorkspaceTargetVerifier({
      workspaceRoot,
    });
    if (
      !sessionRecoveryReader ||
      typeof sessionRecoveryReader.read !== "function" ||
      !workspaceTargetVerifier ||
      typeof workspaceTargetVerifier.verify !== "function"
    ) {
      throw cliError(
        CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
        CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
      );
    }
    alreadyCompletedController = runtime.createAlreadyCompletedController({
      workspaceRoot,
      store,
      sessionRecoveryReader,
      verifyWorkspaceTarget: (request) =>
        workspaceTargetVerifier.verify(request),
      inspectWorkspaceLockOwnerSync: runtime.inspectWorkspaceLockOwnerSync,
      computeWorkspaceLockOwnerDigest: runtime.computeWorkspaceLockOwnerDigest,
      workspaceLockOptions: runtime.workspaceLockOptions,
    });
    if (
      !alreadyCompletedController ||
      typeof alreadyCompletedController.resume !== "function"
    ) {
      throw cliError(
        CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
        CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
      );
    }
  }
  let partialRollbackController = null;
  if (partialRollback) {
    const sessionRecoveryReader = runtime.createSessionRecoveryReader({
      workspaceRoot,
    });
    if (
      !sessionRecoveryReader ||
      typeof sessionRecoveryReader.read !== "function"
    ) {
      throw cliError(
        CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
        CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
      );
    }
    const adapters = createWorkspaceRollbackAdapters(runtime);
    partialRollbackController = runtime.createPartialRollbackController({
      workspaceRoot,
      store,
      prepareWorkspaceRollback: adapters.prepareWorkspaceRollback,
      executeWorkspaceRollback: adapters.executeWorkspaceRollback,
      sessionRecoveryReader,
      withSessionAuthorityTransaction: runtime.withSessionAuthorityTransaction,
      inspectWorkspaceLockOwnerSync: runtime.inspectWorkspaceLockOwnerSync,
      withWorkspaceRecoveryLockSync: runtime.withWorkspaceRecoveryLockSync,
      computeWorkspaceLockOwnerDigest: runtime.computeWorkspaceLockOwnerDigest,
      workspaceLockOptions: runtime.workspaceLockOptions,
    });
    if (
      !partialRollbackController ||
      typeof partialRollbackController.rollback !== "function" ||
      partialRollbackController.rollback.constructor?.name === "AsyncFunction"
    ) {
      throw cliError(
        CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
        CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
      );
    }
  }
  return Object.freeze({
    workspaceRoot,
    store,
    reader,
    controller,
    alreadyCompletedController,
    partialRollbackController,
  });
}

function previewLiveAuthority(runtime, { workspaceRoot, operationId }) {
  const owner = runtime.inspectWorkspaceLockOwnerSync({
    ...runtime.workspaceLockOptions,
    workspaceRoot,
    operationId,
    purpose: CHECKPOINT_RESTORE_PURPOSE,
  });
  if (owner === null) {
    return Object.freeze({
      state: "absent",
      verified: true,
      expectedOwnerDigest: null,
    });
  }
  const digest = runtime.computeWorkspaceLockOwnerDigest(owner);
  if (typeof digest !== "string" || !HASH_PATTERN.test(digest)) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  return Object.freeze({
    state: "retained",
    verified: true,
    expectedOwnerDigest: digest,
  });
}

/**
 * Read the current canonical workspace owner and immediately discard its full
 * value after calculating the digest. The returned object is safe to print.
 */
export function previewCheckpointRestoreRecoveryAuthority(
  input,
  dependencies = {},
) {
  if (!isPlainObject(input) || typeof input.workspaceRoot !== "string") {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  const runtime = normalizeDependencies(dependencies);
  return previewLiveAuthority(runtime, {
    workspaceRoot: input.workspaceRoot,
    operationId: assertOperationId(input.operationId),
  });
}

function commandAction({ candidate, eligible, blockers, prerequisites }) {
  return Object.freeze({
    candidate: candidate === true,
    eligible: eligible === true,
    blockers: Object.freeze([...blockers]),
    prerequisites: Object.freeze([...prerequisites]),
  });
}

function projectedText(value, maximum = 1_024) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !value.includes("\0")
  );
}

function projectedOriginalMutationTargetCount(projection) {
  const rollback = projection?.rollback;
  const rollbackPhase = projection?.rollback?.phase ?? null;
  const rollbackCycleBound =
    ROLLBACK_BINDING_PHASES.has(projection?.basePhase) ||
    ROLLBACK_BINDING_PHASES.has(rollbackPhase);
  if (rollbackCycleBound) {
    return rollback?.originalMutationTargetCount;
  }
  const rollbackBindingPresent = [
    rollback?.rollbackPrestateDigest,
    rollback?.rollbackPlanIdentity,
    rollback?.originalMutationTargetCount,
    rollback?.targetCount,
  ].some((value) => value !== null && value !== undefined);
  if (
    projection?.basePhase === "mutation_started" &&
    (rollbackPhase === null || rollbackPhase === "recovery_started") &&
    !rollbackBindingPresent
  ) {
    return projection?.progress?.targetCount;
  }
  return null;
}

function projectedRollbackAuthority(projection) {
  const restore = projection?.restore;
  const safety = projection?.safety;
  const kind = restore?.kind;
  const identityPattern =
    kind === "git" ? GIT_CHECKPOINT_IDENTITY_PATTERN : HASH_PATTERN;
  const originalMutationTargetCount =
    projectedOriginalMutationTargetCount(projection);
  const engineAuthority =
    ["git", "copy"].includes(kind) &&
    projectedText(restore?.checkpointId, 256) &&
    identityPattern.test(String(restore?.checkpointIdentity || "")) &&
    safety?.coverage === "full" &&
    safety?.complete === true &&
    projectedText(safety?.checkpointId, 256) &&
    identityPattern.test(String(safety?.checkpointIdentity || "")) &&
    HASH_PATTERN.test(String(safety?.planIdentity || "")) &&
    Number.isSafeInteger(originalMutationTargetCount) &&
    originalMutationTargetCount > 0 &&
    (kind === "git"
      ? isCanonicalGitCheckpointNamespace(restore?.checkpointNamespace)
      : restore?.checkpointNamespace === null);
  if (!engineAuthority) return false;
  if (restore.surface === "direct") {
    return (
      restore.intentAuthority === "operation" &&
      restore.sessionId === null &&
      restore.timelineEntryId === null
    );
  }
  return (
    restore.surface === "timeline" &&
    restore.intentAuthority === "session" &&
    projectedText(restore.sessionId, 256) &&
    projectedText(restore.timelineEntryId, 256)
  );
}

function deriveCommandActions(projection, authority) {
  const clean = projection?.integrity?.clean === true;
  const pending = projection?.pending === true;
  const terminal = projection?.terminal === true;
  const basePhase = projection?.basePhase;
  const abortCandidate =
    projection?.actionEligibility?.abort?.candidate === true;
  const abortSupported = CONTROLLER_ABORT_PHASES.has(basePhase);
  const lockFreeCreated =
    basePhase === "created" &&
    projection?.phase === "created" &&
    authority.state === "absent";
  const retainedTakeover = authority.state === "retained";
  const abortEligible =
    pending &&
    clean &&
    abortCandidate &&
    abortSupported &&
    (lockFreeCreated || retainedTakeover);
  const abortBlockers = [];
  if (!pending) abortBlockers.push("saga_is_terminal");
  if (!clean) abortBlockers.push("saga_integrity_not_clean");
  if (!abortCandidate) abortBlockers.push("abort_not_a_safe_candidate");
  if (abortCandidate && !abortSupported) {
    abortBlockers.push("controller_phase_not_supported");
  }
  if (
    abortCandidate &&
    abortSupported &&
    basePhase === "locked" &&
    authority.state !== "retained"
  ) {
    abortBlockers.push("retained_workspace_owner_required");
  }
  if (
    abortCandidate &&
    abortSupported &&
    basePhase === "created" &&
    projection?.phase !== "created" &&
    authority.state === "absent"
  ) {
    abortBlockers.push("retained_workspace_owner_required_after_recovery");
  }

  const releaseCandidate = terminal && clean;
  const releaseEligible = releaseCandidate && authority.verified === true;
  const releaseBlockers = [];
  if (!terminal) releaseBlockers.push("saga_is_not_terminal");
  if (!clean) releaseBlockers.push("saga_integrity_not_clean");

  const resumeCandidate =
    projection?.actionEligibility?.resume?.candidate === true;
  const resumePhaseSupported = CONTROLLER_RESUME_PHASES.has(basePhase);
  const restoreKind = projection?.restore?.kind;
  const timelineAuthority =
    projection?.restore?.surface === "timeline" &&
    projection?.restore?.intentAuthority === "session" &&
    typeof projection?.restore?.sessionId === "string" &&
    typeof projection?.restore?.timelineEntryId === "string" &&
    ["git", "copy"].includes(restoreKind) &&
    typeof projection?.restore?.checkpointId === "string" &&
    typeof projection?.restore?.checkpointIdentity === "string" &&
    (restoreKind !== "git" ||
      typeof projection?.restore?.checkpointNamespace === "string");
  const resumeEligible =
    pending &&
    clean &&
    resumeCandidate &&
    resumePhaseSupported &&
    timelineAuthority &&
    retainedTakeover;
  const resumeBlockers = [];
  if (!pending) resumeBlockers.push("saga_is_terminal");
  if (!clean) resumeBlockers.push("saga_integrity_not_clean");
  if (!resumeCandidate) resumeBlockers.push("resume_not_a_safe_candidate");
  if (resumeCandidate && !resumePhaseSupported) {
    resumeBlockers.push("controller_phase_not_supported");
  }
  if (resumeCandidate && !timelineAuthority) {
    resumeBlockers.push("verified_timeline_session_authority_required");
  }
  if (resumeCandidate && authority.state !== "retained") {
    resumeBlockers.push("retained_workspace_owner_required");
  }

  const rollbackCandidate =
    projection?.actionEligibility?.rollback?.candidate === true;
  const rollbackPhaseSupported = CONTROLLER_ROLLBACK_PHASES.has(basePhase);
  const rollbackAuthority = projectedRollbackAuthority(projection);
  const rollbackEligible =
    pending &&
    clean &&
    rollbackCandidate &&
    rollbackPhaseSupported &&
    rollbackAuthority &&
    retainedTakeover;
  const rollbackBlockers = [];
  if (!rollbackCandidate) {
    rollbackBlockers.push(
      ...(Array.isArray(projection?.actionEligibility?.rollback?.blockers)
        ? projection.actionEligibility.rollback.blockers
        : ["rollback_not_a_safe_candidate"]),
    );
  } else {
    if (!pending) rollbackBlockers.push("saga_is_terminal");
    if (!clean) rollbackBlockers.push("saga_integrity_not_clean");
    if (!rollbackPhaseSupported) {
      rollbackBlockers.push("controller_phase_not_supported");
    }
    if (!rollbackAuthority) {
      rollbackBlockers.push("verified_rollback_authority_required");
    }
    if (!retainedTakeover) {
      rollbackBlockers.push("retained_workspace_owner_required");
    }
  }

  return Object.freeze({
    abort: commandAction({
      candidate: abortCandidate,
      eligible: abortEligible,
      blockers: abortBlockers,
      prerequisites: abortCandidate
        ? ["exact_mutation_fence", "controller_compare_and_swap"]
        : [],
    }),
    resume: commandAction({
      candidate: resumeCandidate,
      eligible: resumeEligible,
      blockers: resumeBlockers,
      prerequisites: resumeCandidate
        ? [
            "exact_mutation_fence",
            "verified_session_already_completed",
            "verified_workspace_target_state",
            "controller_compare_and_swap",
          ]
        : [],
    }),
    rollback: commandAction({
      candidate: rollbackCandidate,
      eligible: rollbackEligible,
      blockers: rollbackBlockers,
      prerequisites: rollbackCandidate
        ? [
            "exact_mutation_fence",
            "verified_full_safety_checkpoint",
            "verified_workspace_rollback_state",
            ...(projection?.restore?.surface === "timeline"
              ? ["verified_session_rollback_state"]
              : []),
            "controller_compare_and_swap",
          ]
        : [],
    }),
    release: commandAction({
      candidate: releaseCandidate,
      eligible: releaseEligible,
      blockers: releaseBlockers,
      prerequisites: releaseCandidate
        ? ["exact_mutation_fence", "controller_compare_and_swap"]
        : [],
    }),
  });
}

function commandPreview(runtime, context, operationId) {
  const projection = context.reader.show(operationId);
  const expectedSeq = projection?.fence?.expectedSeq;
  const expectedHash = projection?.fence?.expectedHash;
  if (
    !Number.isSafeInteger(expectedSeq) ||
    expectedSeq < 1 ||
    typeof expectedHash !== "string" ||
    !HASH_PATTERN.test(expectedHash)
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  const authority = previewLiveAuthority(runtime, {
    workspaceRoot: context.workspaceRoot,
    operationId,
  });
  const mutationFence = Object.freeze({
    expectedSeq,
    expectedHash,
    expectedOwnerDigest: authority.expectedOwnerDigest,
  });
  return Object.freeze({
    schema: CHECKPOINT_RESTORE_RECOVERY_COMMAND_PREVIEW_SCHEMA,
    version: CHECKPOINT_RESTORE_RECOVERY_COMMAND_VERSION,
    recovery: projection,
    liveAuthority: Object.freeze({
      state: authority.state,
      verified: authority.verified,
    }),
    mutationFence,
    actions: deriveCommandActions(projection, authority),
  });
}

function mutationFence(options, preview) {
  const supplied = Object.freeze({
    expectedSeq: parsePositiveInteger(options.expectedSeq),
    expectedHash: parseHash(options.expectedHeadHash),
    expectedOwnerDigest: parseHash(options.expectedOwnerDigest, {
      optional: true,
    }),
  });
  if (
    supplied.expectedSeq !== preview.mutationFence.expectedSeq ||
    supplied.expectedHash !== preview.mutationFence.expectedHash ||
    supplied.expectedOwnerDigest !== preview.mutationFence.expectedOwnerDigest
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FENCE_MISMATCH,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
    );
  }
  return supplied;
}

function assertSynchronousMutationResult(value) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return;
  }
  let then;
  try {
    then = value.then;
  } catch {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  if (typeof then === "function") {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
}

function safeMutationResult(
  result,
  actionName,
  operationId,
  { restoreSurface = null } = {},
) {
  const alreadyCompletedResume =
    actionName === CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION;
  const partialRollback =
    actionName === CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION;
  assertSynchronousMutationResult(result);
  const rollbackSessionDigestValid =
    !partialRollback ||
    (restoreSurface === "timeline"
      ? HASH_PATTERN.test(String(result?.sessionRollbackCommitDigest || ""))
      : restoreSurface === "direct" &&
        result?.sessionRollbackCommitDigest === null);
  if (
    !isPlainObject(result) ||
    result.ok !== true ||
    result.action !== actionName ||
    result.operationId !== operationId ||
    !PHASES.has(result.phase) ||
    !Number.isSafeInteger(result.seq) ||
    result.seq < 1 ||
    typeof result.headHash !== "string" ||
    !HASH_PATTERN.test(result.headHash) ||
    (alreadyCompletedResume &&
      (!HASH_PATTERN.test(String(result.sessionCommitDigest || "")) ||
        !HASH_PATTERN.test(String(result.resultDigest || "")))) ||
    (partialRollback &&
      (result.phase !== "rolled_back" ||
        !RECOVERY_REQUEST_ID_PATTERN.test(
          String(result.recoveryRequestId || ""),
        ) ||
        !Number.isSafeInteger(result.rolledBackCount) ||
        result.rolledBackCount < 0 ||
        !HASH_PATTERN.test(String(result.rollbackStateDigest || "")) ||
        !HASH_PATTERN.test(String(result.resultDigest || "")) ||
        !rollbackSessionDigestValid))
  ) {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_DEPENDENCY,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.FAILURE,
    );
  }
  return Object.freeze({
    schema: CHECKPOINT_RESTORE_RECOVERY_COMMAND_RESULT_SCHEMA,
    version: CHECKPOINT_RESTORE_RECOVERY_COMMAND_VERSION,
    ok: true,
    action: alreadyCompletedResume
      ? "resume"
      : partialRollback
        ? "rollback"
        : actionName,
    ...(alreadyCompletedResume || partialRollback
      ? { recoveryAction: actionName }
      : {}),
    operationId,
    phase: result.phase,
    seq: result.seq,
    headHash: result.headHash,
    archived: result.archived === true,
    alreadyArchived: result.alreadyArchived === true,
    reconciledFromError: result.reconciledFromError === true,
    ...(alreadyCompletedResume
      ? {
          sessionCommitDigest: result.sessionCommitDigest,
          resultDigest: result.resultDigest,
        }
      : {}),
    ...(partialRollback
      ? {
          recoveryRequestId: result.recoveryRequestId,
          rolledBackCount: result.rolledBackCount,
          rollbackStateDigest: result.rollbackStateDigest,
          resultDigest: result.resultDigest,
          sessionRollbackCommitDigest: result.sessionRollbackCommitDigest,
        }
      : {}),
    warning: result.warning
      ? Object.freeze({
          code: "CHECKPOINT_RESTORE_SAGA_ARCHIVE_PENDING",
        })
      : null,
  });
}

function actionLabel(value) {
  if (value?.eligible === true) return "eligible";
  if (value?.candidate === true) {
    return `candidate only (not executable: ${(value.blockers || []).join(", ") || "verification required"})`;
  }
  return `unavailable (${(value?.blockers || []).join(", ") || "not applicable"})`;
}

function humanList(result) {
  const lines = ["Checkpoint restore recovery operations"];
  if (!Array.isArray(result.items) || result.items.length === 0) {
    lines.push("  (no verified pending operations in this page)");
  }
  for (const item of result.items || []) {
    const requestId = item.rollback?.recoveryRequestId || "(none)";
    lines.push(
      `  ${item.operationId}  status=${item.status} phase=${item.phase} base=${item.basePhase || "unknown"} request=${requestId}`,
    );
    lines.push(
      `    fence: seq=${item.fence?.expectedSeq ?? "unknown"} head=${item.fence?.expectedHash || "unknown"}`,
    );
    lines.push(
      `    abort=${actionLabel(item.actionEligibility?.abort)}; ` +
        `resume=${actionLabel(item.actionEligibility?.resume)}; ` +
        `rollback=${actionLabel(item.actionEligibility?.rollback)}`,
    );
    lines.push("    run recovery show for the live mutation fence");
  }
  for (const diagnostic of result.diagnostics || []) {
    lines.push(
      `  diagnostic ${diagnostic.operationId}: ${diagnostic.status} (${diagnostic.code || "no-code"})`,
    );
  }
  if (result.page?.truncated) {
    lines.push(
      `  next cursor: ${result.page.nextCursor === "" ? "(retry current cursor)" : result.page.nextCursor}`,
    );
  }
  return lines.join("\n");
}

function humanPreview(preview) {
  const recovery = preview.recovery;
  const ownerFence = preview.mutationFence.expectedOwnerDigest || "(absent)";
  return [
    `Checkpoint restore recovery: ${recovery.operationId}`,
    `  status: ${recovery.status}`,
    `  phase: ${recovery.phase} (base ${recovery.basePhase || "unknown"})`,
    `  rollback request: ${recovery.rollback?.recoveryRequestId || "(none)"}`,
    `  saga fence: seq=${preview.mutationFence.expectedSeq} head=${preview.mutationFence.expectedHash}`,
    `  live owner: ${preview.liveAuthority.state}`,
    `  expected owner digest: ${ownerFence}`,
    `  abort: ${actionLabel(preview.actions.abort)}`,
    `  resume: ${actionLabel(preview.actions.resume)}`,
    `  rollback: ${actionLabel(preview.actions.rollback)}`,
    `  release: ${actionLabel(preview.actions.release)}`,
    `  recovery reason recorded: ${recovery.recovery?.reasonPresent ? "yes" : "no"}`,
  ].join("\n");
}

function humanMutation(result) {
  const lines = [
    `Checkpoint restore ${result.action} completed: ${result.operationId}`,
    `  phase: ${result.phase}`,
    `  seq: ${result.seq}`,
    `  head: ${result.headHash}`,
    `  archived: ${result.archived ? "yes" : "no"}`,
  ];
  if (result.recoveryAction === CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION) {
    lines.push(
      `  rollback request: ${result.recoveryRequestId}`,
      `  paths rolled back: ${result.rolledBackCount}`,
      `  rollback state: ${result.rollbackStateDigest}`,
      `  result: ${result.resultDigest}`,
    );
    if (result.sessionRollbackCommitDigest) {
      lines.push(
        `  session rollback commit: ${result.sessionRollbackCommitDigest}`,
      );
    }
  }
  if (result.warning) lines.push(`  warning: ${result.warning.code}`);
  return lines.join("\n");
}

function emitSuccess(runtime, options, value, humanFormatter) {
  runtime.writeStdout(
    options?.json ? JSON.stringify(value, null, 2) : humanFormatter(value),
  );
  runtime.setExitCode(CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.OK);
  return value;
}

function emitFailure(runtime, options, error) {
  const safe = publicError(error);
  const payload = Object.freeze({
    schema: CHECKPOINT_RESTORE_RECOVERY_COMMAND_ERROR_SCHEMA,
    version: CHECKPOINT_RESTORE_RECOVERY_COMMAND_VERSION,
    ok: false,
    error: Object.freeze({ code: safe.code, message: safe.message }),
    exitCode: safe.exitCode,
  });
  runtime.writeStderr(
    options?.json
      ? JSON.stringify(payload, null, 2)
      : `${safe.code}: ${safe.message}`,
  );
  runtime.setExitCode(safe.exitCode);
  return null;
}

/** Build dependency-injected command handlers without registering Commander. */
export function createCheckpointRestoreRecoveryCommandHandlers(
  dependencies = {},
) {
  const runtime = normalizeDependencies(dependencies);

  const run = (options, callback) => {
    try {
      return callback();
    } catch (error) {
      return emitFailure(runtime, options, error);
    }
  };

  return Object.freeze({
    list(options = {}) {
      return run(options, () => {
        const context = openContext(runtime, options.dir);
        const limit =
          options.limit === undefined
            ? MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT
            : parsePositiveInteger(options.limit);
        if (limit > MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
          );
        }
        const result = context.reader.list({
          afterOperationId: options.afterOperationId || "",
          limit,
        });
        return emitSuccess(runtime, options, result, humanList);
      });
    },

    show(operationId, options = {}) {
      return run(options, () => {
        const safeOperationId = assertOperationId(operationId);
        const context = openContext(runtime, options.dir);
        const preview = commandPreview(runtime, context, safeOperationId);
        return emitSuccess(runtime, options, preview, humanPreview);
      });
    },

    abort(operationId, options = {}) {
      return run(options, () => {
        if (options.yes !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
          );
        }
        const safeOperationId = assertOperationId(operationId);
        const context = openContext(runtime, options.dir, { mutation: true });
        const preview = commandPreview(runtime, context, safeOperationId);
        if (preview.actions.abort.eligible !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
          );
        }
        const fence = mutationFence(options, preview);
        const result = context.controller.abort(safeOperationId, {
          ...fence,
          reason: "Operator confirmed checkpoint restore recovery abort",
        });
        return emitSuccess(
          runtime,
          options,
          safeMutationResult(result, "abort", safeOperationId),
          humanMutation,
        );
      });
    },

    resume(operationId, options = {}) {
      return run(options, () => {
        if (options.yes !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
          );
        }
        const safeOperationId = assertOperationId(operationId);
        const context = openContext(runtime, options.dir, {
          alreadyCompletedResume: true,
        });
        const preview = commandPreview(runtime, context, safeOperationId);
        if (preview.actions.resume.eligible !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
          );
        }
        const fence = mutationFence(options, preview);
        const result = context.alreadyCompletedController.resume(
          safeOperationId,
          fence,
        );
        return emitSuccess(
          runtime,
          options,
          safeMutationResult(
            result,
            CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
            safeOperationId,
          ),
          humanMutation,
        );
      });
    },

    rollback(operationId, options = {}) {
      return run(options, () => {
        if (options.yes !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
          );
        }
        const safeOperationId = assertOperationId(operationId);
        const context = openContext(runtime, options.dir, {
          partialRollback: true,
        });
        const preview = commandPreview(runtime, context, safeOperationId);
        if (preview.actions.rollback.eligible !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
          );
        }
        const fence = mutationFence(options, preview);
        const result = context.partialRollbackController.rollback(
          safeOperationId,
          fence,
        );
        return emitSuccess(
          runtime,
          options,
          safeMutationResult(
            result,
            CHECKPOINT_RESTORE_PARTIAL_ROLLBACK_ACTION,
            safeOperationId,
            { restoreSurface: preview.recovery.restore.surface },
          ),
          humanMutation,
        );
      });
    },

    release(operationId, options = {}) {
      return run(options, () => {
        if (options.yes !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.CONFIRMATION_REQUIRED,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
          );
        }
        const safeOperationId = assertOperationId(operationId);
        const context = openContext(runtime, options.dir, { mutation: true });
        const preview = commandPreview(runtime, context, safeOperationId);
        if (preview.actions.release.eligible !== true) {
          throw cliError(
            CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.ACTION_NOT_ELIGIBLE,
            CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.NOT_EXECUTABLE,
          );
        }
        const fence = mutationFence(options, preview);
        const result = context.controller.release(safeOperationId, fence);
        return emitSuccess(
          runtime,
          options,
          safeMutationResult(result, "release", safeOperationId),
          humanMutation,
        );
      });
    },
  });
}

/** Register `checkpoint recovery list/show/abort/resume/rollback/release`. */
export function registerCheckpointRestoreRecoveryCommands(
  checkpointCommand,
  dependencies = {},
) {
  if (!checkpointCommand || typeof checkpointCommand.command !== "function") {
    throw cliError(
      CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.INVALID_ARGUMENT,
      CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE,
    );
  }
  const handlers = createCheckpointRestoreRecoveryCommandHandlers(dependencies);
  const recovery = checkpointCommand
    .command("recovery")
    .description(
      "Inspect and conservatively settle durable checkpoint restore recovery",
    )
    .addHelpText(
      "after",
      "\nResume only reconciles a verified already-completed timeline restore. Rollback only reverses a verified partial workspace mutation to its full safety checkpoint.\n",
    );

  recovery
    .command("list")
    .description("List verified pending recovery projections (read-only)")
    .option("-d, --dir <dir>", "Workspace directory", ".")
    .option("--after-operation-id <id>", "Stable operationId page cursor")
    .option("--limit <count>", "Bounded page size (1-64)")
    .option("--json", "Output safe JSON")
    .action((options) => handlers.list(options));

  recovery
    .command("show")
    .description("Show one recovery projection and its live mutation fence")
    .argument("<operation-id>", "Checkpoint restore operationId")
    .option("-d, --dir <dir>", "Workspace directory", ".")
    .option("--json", "Output safe JSON")
    .action((operationId, options) => handlers.show(operationId, options));

  const addMutationOptions = (command) =>
    command
      .option(
        "--expected-seq <number>",
        "Required exact sequence from recovery show",
      )
      .option(
        "--expected-head-hash <digest>",
        "Required exact head hash from recovery show",
      )
      .option(
        "--expected-owner-digest <digest>",
        "Required only when recovery show reports a retained live owner",
      )
      .option("--yes", "Confirm the requested recovery mutation")
      .option("-d, --dir <dir>", "Workspace directory", ".")
      .option("--json", "Output safe JSON");

  addMutationOptions(
    recovery
      .command("abort")
      .description("Abort only a verified created/locked restore"),
  )
    .argument("<operation-id>", "Checkpoint restore operationId")
    .action((operationId, options) => handlers.abort(operationId, options));

  addMutationOptions(
    recovery
      .command("resume")
      .description(
        "Complete only a verified timeline restore already settled in the session",
      ),
  )
    .argument("<operation-id>", "Checkpoint restore operationId")
    .action((operationId, options) => handlers.resume(operationId, options));

  addMutationOptions(
    recovery
      .command("rollback")
      .description(
        "Reverse only a verified partial workspace mutation to full safety",
      ),
  )
    .argument("<operation-id>", "Checkpoint restore operationId")
    .action((operationId, options) => handlers.rollback(operationId, options));

  addMutationOptions(
    recovery
      .command("release")
      .description("Release/archive only a verified terminal restore"),
  )
    .argument("<operation-id>", "Checkpoint restore operationId")
    .action((operationId, options) => handlers.release(operationId, options));

  return recovery;
}
