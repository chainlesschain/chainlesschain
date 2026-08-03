/**
 * Serialize checkpoint retention with restore authority.
 *
 * The canonical workspace lifetime lock is deliberately acquired before the
 * saga shard's maintenance/operation locks. This is the same outer lock used
 * by restore orchestration, so a retention callback can neither race a newly
 * published safety checkpoint nor invert the restore lock order.
 */

import { randomUUID } from "node:crypto";
import {
  CHECKPOINT_RESTORE_SAGA_ERROR_CODES,
  CheckpointRestoreSagaStore,
} from "./checkpoint-restore-saga.js";
import { withWorkspaceLockSync } from "./process-execution-broker/workspace-transaction.js";

const RETENTION_OPERATION_PREFIX = "checkpoint-retention";

export function checkpointRestoreRetentionUnverifiedError(cause, message) {
  if (
    cause?.code === CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED
  ) {
    return cause;
  }
  const error = new Error(
    message || "Checkpoint retention authority could not be verified",
    cause ? { cause } : undefined,
  );
  error.name = "CheckpointRestoreRetentionError";
  error.code = CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED;
  if (typeof cause?.code === "string") error.reasonCode = cause.code;
  return error;
}

/**
 * Run one synchronous checkpoint deletion/prune callback under both the
 * workspace lease and the restore saga retention guard.
 */
export function withCheckpointRestoreRetention(options = {}, callback) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    typeof callback !== "function"
  ) {
    throw checkpointRestoreRetentionUnverifiedError(
      null,
      "Checkpoint retention requires a synchronous request and callback",
    );
  }

  const operationId = `${RETENTION_OPERATION_PREFIX}-${randomUUID()}`;
  const workspaceLockOptions = options.workspaceLockOptions;
  const redirectsAuthority =
    options.stateDir != null ||
    workspaceLockOptions != null ||
    options.sagaStoreOptionsForTests != null;
  if (
    redirectsAuthority &&
    (process.env.NODE_ENV !== "test" || options.allowTestRuntime !== true)
  ) {
    throw checkpointRestoreRetentionUnverifiedError(
      null,
      "Checkpoint retention authority redirection is test-only",
    );
  }
  if (
    workspaceLockOptions != null &&
    (typeof workspaceLockOptions !== "object" ||
      Array.isArray(workspaceLockOptions))
  ) {
    throw checkpointRestoreRetentionUnverifiedError(
      null,
      "Checkpoint retention workspace lock options are invalid",
    );
  }
  const testSagaStoreOptions = options.sagaStoreOptionsForTests;
  if (
    testSagaStoreOptions != null &&
    (typeof testSagaStoreOptions !== "object" ||
      Array.isArray(testSagaStoreOptions) ||
      Object.keys(testSagaStoreOptions).some(
        (key) => !["secureDirectory", "secureAuthorityPaths"].includes(key),
      ))
  ) {
    throw checkpointRestoreRetentionUnverifiedError(
      null,
      "Checkpoint retention saga runtime injection is test-only",
    );
  }

  try {
    return withWorkspaceLockSync(
      {
        ...(workspaceLockOptions || {}),
        workspaceRoot: options.workspaceRoot,
        operationId,
        purpose: RETENTION_OPERATION_PREFIX,
      },
      (workspaceLease) => {
        const store = new CheckpointRestoreSagaStore({
          ...(testSagaStoreOptions || {}),
          workspaceRoot: workspaceLease.canonicalWorkspaceRoot,
          ...(options.stateDir ? { stateDir: options.stateDir } : {}),
        });
        return store.withCheckpointRetentionGuard(
          {
            engine: options.engine,
            checkpointNamespace: options.checkpointNamespace ?? null,
            candidates: options.candidates,
            protectedPolicy: options.protectedPolicy ?? "reject",
            workspaceLease,
          },
          callback,
        );
      },
    );
  } catch (cause) {
    if (
      cause?.code === CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_PROTECTED
    ) {
      throw cause;
    }
    throw checkpointRestoreRetentionUnverifiedError(cause);
  }
}
