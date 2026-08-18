/**
 * Agent tool adapter for Process Broker workspace transactions.
 *
 * This module deliberately keeps policy separate from the transaction engine:
 * callers opt in, provide the trusted workspace root, and decide whether they
 * can assert an exclusive-writer contract. Unknown/background/external-host
 * writers are reported as coverage=none instead of being wrapped in a
 * misleading "recoverable" checkpoint.
 */

import { WORKSPACE_TRANSACTION_COVERAGE } from "./process-execution-broker/workspace-transaction.js";

export const MANAGED_TOOL_CHECKPOINT_ERROR = Object.freeze({
  INVALID_ARGUMENT: "MANAGED_TOOL_CHECKPOINT_INVALID_ARGUMENT",
  SETTLEMENT_FAILED: "MANAGED_TOOL_CHECKPOINT_SETTLEMENT_FAILED",
});

const DIRECT_FILE_ONLY_TOOLS = new Set([
  "write_file",
  "edit_file",
  "edit_file_hashed",
  "delete_file",
  "move_file",
  "notebook_edit",
]);

const DEFAULT_READ_ONLY_TOOLS = new Set([
  "read_file",
  "search_files",
  "code_intelligence",
  "list_dir",
  "list_skills",
  "search_sessions",
]);

export function managedToolCheckpointRequired(toolName, readOnly = undefined) {
  const normalized = boundedBinding(toolName, "unknown-tool");
  return !(
    readOnly === true ||
    (readOnly !== false && DEFAULT_READ_ONLY_TOOLS.has(normalized))
  );
}

function checkpointError(code, message, details = {}, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "ManagedToolCheckpointError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function boundedBinding(value, fallback) {
  const text =
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.slice(0, 256);
}

function isBackgroundTool(toolName, toolArgs = {}) {
  if (toolName === "run_shell") return toolArgs.run_in_background === true;
  if (toolName === "spawn_sub_agent") {
    return (
      toolArgs.run_in_background === true ||
      toolArgs.background === true ||
      toolArgs.mode === "background"
    );
  }
  return false;
}

function skippedCheckpoint(reason, toolName) {
  return Object.freeze({
    skipped: true,
    toolName,
    coverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
    fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
    reason,
  });
}

/**
 * Prepare one managed checkpoint before a mutating agent tool call.
 *
 * A returned `skipped:true` result is an intentional coverage decision, not an
 * error. Transaction preparation errors throw and must block strict callers
 * before the tool is allowed to mutate the workspace.
 */
export function beginManagedToolCheckpoint(options = {}) {
  if (options.enabled !== true) return null;
  const toolName = boundedBinding(options.toolName, "unknown-tool");
  if (!managedToolCheckpointRequired(toolName, options.readOnly)) return null;
  if (
    typeof options.unmanagedWriterReason === "string" &&
    options.unmanagedWriterReason.trim()
  ) {
    return skippedCheckpoint(
      options.unmanagedWriterReason.trim().slice(0, 256),
      toolName,
    );
  }
  if (isBackgroundTool(toolName, options.toolArgs)) {
    return skippedCheckpoint("background_writer_not_quiescent", toolName);
  }
  if (options.externalToolExecutor) {
    return skippedCheckpoint("external_writer_lifetime_unmanaged", toolName);
  }
  if (
    !options.broker ||
    typeof options.broker.beginWorkspaceTransaction !== "function"
  ) {
    throw checkpointError(
      MANAGED_TOOL_CHECKPOINT_ERROR.INVALID_ARGUMENT,
      "managed tool checkpoint requires a Process Broker transaction API",
    );
  }
  if (
    typeof options.workspaceRoot !== "string" ||
    !options.workspaceRoot.trim()
  ) {
    throw checkpointError(
      MANAGED_TOOL_CHECKPOINT_ERROR.INVALID_ARGUMENT,
      "managed tool checkpoint requires a trusted workspace root",
    );
  }

  const coverageTarget =
    options.coverageTarget || WORKSPACE_TRANSACTION_COVERAGE.PARTIAL;
  const writerIsolation =
    options.writerIsolation === "exclusive-workspace"
      ? "exclusive-workspace"
      : "unknown";
  const transaction = options.broker.beginWorkspaceTransaction({
    ...(options.stateDir ? { stateDir: options.stateDir } : {}),
    ...(options.id ? { id: options.id } : {}),
    runId: boundedBinding(options.runId, "agent-run"),
    taskKey: boundedBinding(options.taskKey, `tool-${toolName}`),
    workspaceRoot: options.workspaceRoot,
    coverageTarget,
    writerIsolation,
    externalSideEffects:
      options.externalSideEffects === undefined
        ? !DIRECT_FILE_ONLY_TOOLS.has(toolName)
        : options.externalSideEffects !== false,
    exclusions: Array.isArray(options.exclusions) ? options.exclusions : [],
    limits: options.limits || {},
  });

  return {
    skipped: false,
    toolName,
    transaction,
    transactionId: transaction.id,
    checkpointId: transaction.checkpointId,
    prepared: transaction.snapshot(),
  };
}

/**
 * Commit a successful tool checkpoint or roll it back after a failed tool.
 * Settlement errors retain the durable transaction snapshot for adjudication.
 */
export function settleManagedToolCheckpoint(handle, { success, reason } = {}) {
  if (!handle) return null;
  if (handle.skipped) return { ...handle };
  if (!handle.transaction) {
    throw checkpointError(
      MANAGED_TOOL_CHECKPOINT_ERROR.INVALID_ARGUMENT,
      "managed tool checkpoint handle has no transaction",
    );
  }
  try {
    const evidence =
      success === true
        ? handle.transaction.accept()
        : handle.transaction.rollback({
            reason: boundedBinding(reason, "agent tool failed"),
          });
    return {
      skipped: false,
      toolName: handle.toolName,
      transactionId: handle.transactionId,
      checkpointId: handle.checkpointId,
      evidence,
      coverage: evidence.coverage,
      fileCoverage: evidence.fileCoverage,
    };
  } catch (cause) {
    throw checkpointError(
      MANAGED_TOOL_CHECKPOINT_ERROR.SETTLEMENT_FAILED,
      `managed checkpoint could not ${success === true ? "commit" : "roll back"}: ${cause.message}`,
      {
        transactionId: handle.transactionId,
        checkpointId: handle.checkpointId,
        transaction: handle.transaction.snapshot(),
        settlement: success === true ? "commit" : "rollback",
      },
      cause,
    );
  }
}
