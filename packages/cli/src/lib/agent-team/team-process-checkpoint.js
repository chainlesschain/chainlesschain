/**
 * Thin Agent Team adapter over ProcessExecutionBroker workspace transactions.
 *
 * TeamRunner/CLI integration can either hold the returned guard explicitly or
 * use executeTask(). No team scheduler state is mutated here.
 */

import executionBroker from "../process-execution-broker/index.js";
import {
  WORKSPACE_TRANSACTION_COVERAGE,
  WORKSPACE_TRANSACTION_ERROR,
} from "../process-execution-broker/workspace-transaction.js";

export const TEAM_PROCESS_CHECKPOINT_ERROR = Object.freeze({
  INVALID_RUNNER: "TEAM_PROCESS_CHECKPOINT_INVALID_RUNNER",
  ROLLBACK_FAILED: "TEAM_PROCESS_CHECKPOINT_ROLLBACK_FAILED",
});

function checkpointError(code, message, details = {}, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "TeamProcessCheckpointError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

export class TeamTaskCheckpointGuard {
  constructor(transaction) {
    this.transaction = transaction;
  }

  get id() {
    return this.transaction.id;
  }

  get checkpointId() {
    return this.transaction.checkpointId;
  }

  snapshot() {
    return this.transaction.snapshot();
  }

  markRunning() {
    return this.transaction.markRunning();
  }

  accept() {
    return this.transaction.accept();
  }

  rollback(options = {}) {
    return this.transaction.rollback(options);
  }

  restore(options = {}) {
    return this.transaction.restore(options);
  }

  /**
   * Run one task under the prepared checkpoint. A thrown/aborted task is
   * rolled back before the original error is rethrown. If rollback itself
   * fails, both errors and the durable failure evidence are retained.
   */
  async execute(runTask) {
    if (typeof runTask !== "function") {
      throw checkpointError(
        TEAM_PROCESS_CHECKPOINT_ERROR.INVALID_RUNNER,
        "team checkpoint execute requires a runTask function",
      );
    }
    this.markRunning();
    try {
      const result = await runTask({
        transactionId: this.id,
        checkpointId: this.checkpointId,
        workspaceRoot: this.transaction.workspaceRoot,
      });
      const checkpoint = this.accept();
      return { result, checkpoint };
    } catch (taskError) {
      try {
        const checkpoint = this.rollback({
          reason:
            taskError?.code === "ABORT_ERR" || taskError?.name === "AbortError"
              ? "task interrupted"
              : "task failed",
        });
        if (
          taskError &&
          (typeof taskError === "object" || typeof taskError === "function")
        ) {
          try {
            taskError.workspaceCheckpoint = checkpoint;
          } catch {
            // Frozen/non-extensible errors still retain the durable checkpoint
            // evidence in the transaction store; do not misreport a successful
            // rollback as a rollback failure merely because decoration failed.
          }
        }
        throw taskError;
      } catch (rollbackError) {
        if (rollbackError === taskError) throw taskError;
        throw checkpointError(
          TEAM_PROCESS_CHECKPOINT_ERROR.ROLLBACK_FAILED,
          `team task failed and checkpoint rollback also failed: ${rollbackError.message}`,
          {
            taskError,
            rollbackError,
            transactionId: this.id,
            failureEvidence:
              rollbackError.failureEvidence ||
              this.transaction.snapshot().failureEvidence ||
              [],
          },
          rollbackError,
        );
      }
    }
  }
}

export class TeamProcessCheckpointBroker {
  constructor(options = {}) {
    this.broker = options.broker || executionBroker;
    this.stateDir = options.stateDir;
    this.lockDir = options.lockDir;
    this.limits = options.limits || {};
    this.externalSideEffects = options.externalSideEffects !== false;
    this.coverageTarget =
      options.coverageTarget || WORKSPACE_TRANSACTION_COVERAGE.PARTIAL;
    this.writerIsolation = options.writerIsolation || "unknown";
    this.exclusions = Array.isArray(options.exclusions)
      ? [...options.exclusions]
      : [];
  }

  beginTask(options = {}) {
    const transaction = this.broker.beginWorkspaceTransaction({
      stateDir: options.stateDir || this.stateDir,
      lockDir: options.lockDir || this.lockDir,
      runId: options.runId,
      taskKey: options.taskKey,
      workspaceRoot: options.workspaceRoot,
      limits: { ...this.limits, ...(options.limits || {}) },
      // A process task may touch network/database/message/deployment state.
      // Callers may set false only for a proven file-only execution contract.
      externalSideEffects:
        options.externalSideEffects === undefined
          ? this.externalSideEffects
          : options.externalSideEffects !== false,
      coverageTarget: options.coverageTarget || this.coverageTarget,
      writerIsolation: options.writerIsolation || this.writerIsolation,
      exclusions: Array.isArray(options.exclusions)
        ? options.exclusions
        : this.exclusions,
      ...(options.id ? { id: options.id } : {}),
    });
    return new TeamTaskCheckpointGuard(transaction);
  }

  async executeTask(options, runTask) {
    return this.beginTask(options).execute(runTask);
  }

  recoverPending(options = {}) {
    return this.broker.recoverWorkspaceTransactions({
      stateDir: options.stateDir || this.stateDir,
      lockDir: options.lockDir || this.lockDir,
      workspaceRoot: options.workspaceRoot,
      reason: options.reason || "agent team crash recovery",
    });
  }

  inspectCheckpoint(id, options = {}) {
    return this.broker.inspectWorkspaceTransaction(id, {
      stateDir: options.stateDir || this.stateDir,
      lockDir: options.lockDir || this.lockDir,
    });
  }

  listCheckpoints(options = {}) {
    return this.broker.listWorkspaceTransactions({
      stateDir: options.stateDir || this.stateDir,
      lockDir: options.lockDir || this.lockDir,
      workspaceRoot: options.workspaceRoot,
    });
  }

  restoreCheckpoint(id, options = {}) {
    return this.broker.restoreWorkspaceTransaction(id, {
      stateDir: options.stateDir || this.stateDir,
      lockDir: options.lockDir || this.lockDir,
      expectedEvidenceDigest: options.expectedEvidenceDigest,
      force: options.force === true,
      reason: options.reason || "agent team checkpoint restore",
    });
  }

  undoRestore(id, options = {}) {
    return this.broker.undoWorkspaceTransactionRestore(id, {
      stateDir: options.stateDir || this.stateDir,
      lockDir: options.lockDir || this.lockDir,
      expectedRestoreEvidenceDigest: options.expectedRestoreEvidenceDigest,
      force: options.force === true,
      reason: options.reason || "undo agent team checkpoint restore",
    });
  }
}

export { WORKSPACE_TRANSACTION_COVERAGE, WORKSPACE_TRANSACTION_ERROR };
