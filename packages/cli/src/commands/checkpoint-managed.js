/**
 * Managed workspace transaction inspection and explicit rewind commands.
 *
 * These commands expose durable checkpoints created by ProcessExecutionBroker.
 * They are deliberately separate from the git/copy checkpoints implemented by
 * `checkpoint.js`: a managed transaction has coverage evidence, a write
 * manifest, and mandatory evidence-digest authority for restore/undo.
 *
 * Registration:
 *   registerManagedCheckpointCommands(checkpointCommand)
 *
 * Resulting surface:
 *   cc checkpoint managed list
 *   cc checkpoint managed show <transaction-id>
 *   cc checkpoint managed run -- <command...>
 *   cc checkpoint managed restore <transaction-id>
 *   cc checkpoint managed undo <transaction-id>
 */

import path from "node:path";
import crypto from "node:crypto";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  WorkspaceTransactionManager,
  WORKSPACE_TRANSACTION_COVERAGE,
} from "../lib/process-execution-broker/workspace-transaction.js";

const EVIDENCE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_TRANSACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const PROCESS_TREE_BOUNDARY = "process-tree";
const DEFAULT_MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function commandError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "ManagedCheckpointCommandError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeTransactionId(id) {
  if (typeof id !== "string" || !SAFE_TRANSACTION_ID.test(id)) {
    throw commandError(
      "MANAGED_CHECKPOINT_INVALID_ID",
      "transaction id must be a stable filesystem-safe identifier",
    );
  }
  return id;
}

function normalizeEvidenceDigest(value, label) {
  if (typeof value !== "string" || !EVIDENCE_DIGEST.test(value)) {
    throw commandError(
      "MANAGED_CHECKPOINT_INVALID_EVIDENCE_DIGEST",
      `${label} must be a sha256:<64 lowercase hex> digest`,
    );
  }
  return value;
}

function normalizeCommand(command, args) {
  if (
    typeof command !== "string" ||
    command.trim() === "" ||
    command.includes("\0")
  ) {
    throw commandError(
      "MANAGED_CHECKPOINT_COMMAND_REQUIRED",
      "managed run requires a literal foreground command after `--`",
    );
  }
  if (
    !Array.isArray(args) ||
    args.some((value) => typeof value !== "string" || value.includes("\0"))
  ) {
    throw commandError(
      "MANAGED_CHECKPOINT_INVALID_COMMAND",
      "managed run command arguments must be NUL-free strings",
    );
  }
  return { command, args: [...args] };
}

function normalizeCaptureLimit(value) {
  const resolved =
    value === undefined ? DEFAULT_MAX_CAPTURE_BYTES : Number(value);
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > 64 * 1024 * 1024
  ) {
    throw commandError(
      "MANAGED_CHECKPOINT_INVALID_OUTPUT_LIMIT",
      "max output bytes must be an integer between 1 and 67108864",
    );
  }
  return resolved;
}

function normalizeInspection(raw) {
  // The public manager API returns a verified state snapshot. Accepting the
  // `{ state: snapshot }` envelope as well keeps this command compatible with
  // embedders that attach baseline metadata without ever reading it here.
  if (
    raw?.state &&
    typeof raw.state === "object" &&
    !Array.isArray(raw.state)
  ) {
    return raw.state;
  }
  return raw;
}

function coverageWarnings(state) {
  const warnings = [];
  const overall =
    state?.coverage ||
    state?.evidence?.coverage ||
    WORKSPACE_TRANSACTION_COVERAGE.NONE;
  const files =
    state?.fileCoverage ||
    state?.evidence?.fileCoverage ||
    WORKSPACE_TRANSACTION_COVERAGE.NONE;
  const uncovered = Array.isArray(state?.uncoveredPaths)
    ? state.uncoveredPaths
    : Array.isArray(state?.evidence?.uncoveredPaths)
      ? state.evidence.uncoveredPaths
      : [];

  if (overall !== WORKSPACE_TRANSACTION_COVERAGE.FULL) {
    warnings.push(
      `Overall rollback coverage is ${overall}; this checkpoint must not be treated as a full side-effect rollback.`,
    );
  }
  if (files !== WORKSPACE_TRANSACTION_COVERAGE.FULL) {
    warnings.push(
      `Workspace file coverage is ${files}; some file writes may be outside the checkpoint.`,
    );
  }
  if (state?.externalSideEffects !== false) {
    warnings.push(
      "External effects such as databases, messages, deployments, payments, and writes outside the workspace are not reversible by this checkpoint.",
    );
  }
  if (uncovered.length > 0) {
    warnings.push(`Uncovered paths: ${uncovered.join(", ")}`);
  }
  return warnings;
}

function transactionSummary(raw) {
  const state = normalizeInspection(raw);
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw commandError(
      "MANAGED_CHECKPOINT_INVALID_INSPECTION",
      "workspace transaction inspection returned an invalid record",
    );
  }
  const id = normalizeTransactionId(state.id);
  const overall =
    state.coverage ||
    state.evidence?.coverage ||
    WORKSPACE_TRANSACTION_COVERAGE.NONE;
  const files =
    state.fileCoverage ||
    state.evidence?.fileCoverage ||
    WORKSPACE_TRANSACTION_COVERAGE.NONE;
  return {
    id,
    checkpointId: state.checkpointId || state.checkpoint?.id || null,
    state: typeof state.state === "string" ? state.state : "unknown",
    runId: state.runId || null,
    taskKey: state.taskKey || null,
    workspaceRoot: state.workspaceRoot || null,
    createdAt: state.createdAt || null,
    updatedAt: state.updatedAt || null,
    coverage: overall,
    fileCoverage: files,
    externalSideEffects: state.externalSideEffects !== false,
    writerIsolation: state.writerIsolation || "unknown",
    uncoveredPaths: Array.isArray(state.uncoveredPaths)
      ? [...state.uncoveredPaths]
      : Array.isArray(state.evidence?.uncoveredPaths)
        ? [...state.evidence.uncoveredPaths]
        : [],
    evidenceDigest: state.evidence?.evidenceDigest || null,
    restoreEvidenceDigest: state.restoreEvidence?.evidenceDigest || null,
    undoRestoreEvidenceDigest:
      state.undoRestoreEvidence?.evidenceDigest || null,
    warnings: coverageWarnings(state),
  };
}

function transactionDetails(raw) {
  const state = normalizeInspection(raw);
  const summary = transactionSummary(state);
  return {
    ...summary,
    checkpoint: state.checkpoint
      ? {
          id: state.checkpoint.id || null,
          digest: state.checkpoint.digest || null,
          entries: state.checkpoint.entries ?? null,
          files: state.checkpoint.files ?? null,
          bytes: state.checkpoint.bytes ?? null,
        }
      : null,
    writeManifest: state.writeManifest
      ? {
          digest: state.writeManifest.digest || null,
          summary: state.writeManifest.summary || null,
        }
      : null,
    evidence: state.evidence || null,
    restoreEvidence: state.restoreEvidence || null,
    undoRestoreEvidence: state.undoRestoreEvidence || null,
    failureEvidence: Array.isArray(state.failureEvidence)
      ? state.failureEvidence
      : [],
  };
}

function managerOptions(options) {
  return {
    ...(options.stateDir ? { stateDir: path.resolve(options.stateDir) } : {}),
  };
}

function resolveWorkspaceFilter(value) {
  return value ? path.resolve(value) : undefined;
}

export function listManagedCheckpoints(manager, options = {}) {
  if (!manager || typeof manager.list !== "function") {
    throw commandError(
      "MANAGED_CHECKPOINT_API_UNAVAILABLE",
      "workspace transaction manager does not expose the verified list API",
    );
  }
  const records = manager.list({
    ...(options.workspaceRoot
      ? { workspaceRoot: path.resolve(options.workspaceRoot) }
      : {}),
  });
  if (!Array.isArray(records)) {
    throw commandError(
      "MANAGED_CHECKPOINT_INVALID_INSPECTION",
      "workspace transaction list returned an invalid result",
    );
  }
  return records
    .map(transactionSummary)
    .sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
    );
}

export function showManagedCheckpoint(manager, id) {
  normalizeTransactionId(id);
  if (!manager || typeof manager.inspect !== "function") {
    throw commandError(
      "MANAGED_CHECKPOINT_API_UNAVAILABLE",
      "workspace transaction manager does not expose the verified inspect API",
    );
  }
  return transactionDetails(manager.inspect(id));
}

export function restoreManagedCheckpoint(manager, id, options = {}) {
  normalizeTransactionId(id);
  if (!manager || typeof manager.restore !== "function") {
    throw commandError(
      "MANAGED_CHECKPOINT_API_UNAVAILABLE",
      "workspace transaction manager does not expose restore",
    );
  }
  const expectedEvidenceDigest = normalizeEvidenceDigest(
    options.expectedEvidenceDigest,
    "expected evidence digest",
  );
  return manager.restore(id, {
    expectedEvidenceDigest,
    force: options.force === true,
    ...(options.reason ? { reason: options.reason } : {}),
  });
}

export function undoManagedCheckpointRestore(manager, id, options = {}) {
  normalizeTransactionId(id);
  if (!manager || typeof manager.undoRestore !== "function") {
    throw commandError(
      "MANAGED_CHECKPOINT_API_UNAVAILABLE",
      "workspace transaction manager does not expose restore undo",
    );
  }
  const expectedRestoreEvidenceDigest = normalizeEvidenceDigest(
    options.expectedRestoreEvidenceDigest,
    "expected restore evidence digest",
  );
  return manager.undoRestore(id, {
    expectedRestoreEvidenceDigest,
    force: options.force === true,
    ...(options.reason ? { reason: options.reason } : {}),
  });
}

function appendBoundedOutput(state, stream, chunk) {
  const value = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), "utf8");
  const nextBytes = state[`${stream}Bytes`] + value.byteLength;
  state[`${stream}Bytes`] = nextBytes;
  if (state.captureOutput && nextBytes <= state.maxOutputBytes) {
    state[`${stream}Chunks`].push(value);
  }
  if (!state.captureOutput) {
    state[`${stream}Writer`]?.(value);
  }
  return nextBytes <= state.maxOutputBytes;
}

function executeForegroundProcess(broker, command, args, options = {}) {
  const output = {
    captureOutput: options.captureOutput === true,
    maxOutputBytes: normalizeCaptureLimit(options.maxOutputBytes),
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutChunks: [],
    stderrChunks: [],
    stdoutWriter: options.stdoutWriter,
    stderrWriter: options.stderrWriter,
  };

  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = broker.spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        detached: false,
        stdio: ["inherit", "pipe", "pipe"],
        origin: "checkpoint:managed-run",
        scope: "checkpoint",
        policy: "allow",
        requiredBoundaries: [PROCESS_TREE_BOUNDARY],
      });
    } catch (error) {
      // A post-spawn sandbox failure may occur after the OS process exists.
      // The Broker exposes a close promise in that case. Never race rollback
      // against that writer, even though the transaction will still refuse to
      // claim a tree guarantee that was not established.
      if (
        error?.workspaceProcessClosed &&
        typeof error.workspaceProcessClosed.then === "function"
      ) {
        Promise.resolve(error.workspaceProcessClosed).then(
          () => reject(error),
          (closeError) => {
            error.workspaceCloseError = String(
              closeError?.message || closeError,
            );
            reject(error);
          },
        );
      } else {
        reject(error);
      }
      return;
    }
    if (!proc || typeof proc.once !== "function") {
      reject(
        commandError(
          "MANAGED_CHECKPOINT_INVALID_PROCESS_HANDLE",
          "Process Broker did not return a close-observable foreground process",
        ),
      );
      return;
    }

    let processError = null;
    let outputLimitError = null;
    let closed = false;
    const collect = (stream, name) => {
      if (!stream || typeof stream.on !== "function") return;
      stream.on("data", (chunk) => {
        if (!appendBoundedOutput(output, name, chunk) && !outputLimitError) {
          outputLimitError = commandError(
            "MANAGED_CHECKPOINT_OUTPUT_LIMIT",
            `${name} exceeded the ${output.maxOutputBytes} byte safety limit`,
            { stream: name, maxOutputBytes: output.maxOutputBytes },
          );
          try {
            proc.kill("SIGTERM");
          } catch {
            // The close event remains mandatory; rollback cannot race a writer.
          }
        }
      });
    };
    collect(proc.stdout, "stdout");
    collect(proc.stderr, "stderr");
    proc.once("error", (error) => {
      // Node normally emits `close` after `error`. Do not let rollback start on
      // `error`, because inherited/duplicated stdio and descendants may still
      // be alive until `close`.
      processError = error;
    });
    proc.once("close", (exitCode, signal) => {
      if (closed) return;
      closed = true;
      const result = {
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: typeof signal === "string" ? signal : null,
        stdoutBytes: output.stdoutBytes,
        stderrBytes: output.stderrBytes,
        stdout: output.captureOutput
          ? Buffer.concat(output.stdoutChunks).toString("utf8")
          : null,
        stderr: output.captureOutput
          ? Buffer.concat(output.stderrChunks).toString("utf8")
          : null,
      };
      if (outputLimitError || processError) {
        const error = outputLimitError || processError;
        error.processResult = result;
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function managedRunResult(transaction, evidence, processResult, ok) {
  const state = transaction.snapshot();
  const coverageState = {
    coverage:
      evidence?.coverage ||
      state.coverage ||
      WORKSPACE_TRANSACTION_COVERAGE.NONE,
    fileCoverage:
      evidence?.fileCoverage ||
      state.fileCoverage ||
      WORKSPACE_TRANSACTION_COVERAGE.NONE,
    externalSideEffects:
      evidence?.externalSideEffects ?? state.externalSideEffects ?? true,
    uncoveredPaths: evidence?.uncoveredPaths || state.uncoveredPaths || [],
  };
  return {
    ok,
    transactionId: transaction.id,
    checkpointId: transaction.checkpointId,
    state: state.state,
    outcome: evidence?.outcome || (ok ? "committed" : "rolled_back"),
    exitCode: processResult?.exitCode ?? null,
    signal: processResult?.signal ?? null,
    evidenceDigest: evidence?.evidenceDigest || null,
    checkpointDigest:
      evidence?.checkpointDigest || state.checkpoint?.digest || null,
    writeManifestDigest: evidence?.writeManifestDigest || null,
    coverage: coverageState.coverage,
    fileCoverage: coverageState.fileCoverage,
    externalSideEffects: coverageState.externalSideEffects,
    uncoveredPaths: [...coverageState.uncoveredPaths],
    stdout: processResult?.stdout ?? null,
    stderr: processResult?.stderr ?? null,
    stdoutBytes: processResult?.stdoutBytes ?? 0,
    stderrBytes: processResult?.stderrBytes ?? 0,
    warnings: coverageWarnings(coverageState),
  };
}

function attachRollbackFailure(primaryError, transaction, rollbackError) {
  const snapshot = transaction.snapshot();
  const error = commandError(
    "MANAGED_CHECKPOINT_ROLLBACK_FAILED",
    `managed command did not commit, but workspace rollback could not be proven: ${rollbackError.message}`,
    {
      transactionId: transaction.id,
      checkpointId: transaction.checkpointId,
      transactionState: {
        id: snapshot.id,
        state: snapshot.state,
        workspaceRoot: snapshot.workspaceRoot,
        coverage: snapshot.coverage || WORKSPACE_TRANSACTION_COVERAGE.NONE,
        fileCoverage:
          snapshot.fileCoverage || WORKSPACE_TRANSACTION_COVERAGE.NONE,
        uncoveredPaths: Array.isArray(snapshot.uncoveredPaths)
          ? snapshot.uncoveredPaths
          : [],
        evidenceDigest: snapshot.evidence?.evidenceDigest || null,
        failureEvidence: Array.isArray(snapshot.failureEvidence)
          ? snapshot.failureEvidence
          : [],
      },
      primaryError: {
        code: primaryError?.code || "MANAGED_COMMAND_FAILED",
        message: String(primaryError?.message || primaryError),
      },
      rollbackError: {
        code: rollbackError?.code || "WORKSPACE_TRANSACTION_ROLLBACK_FAILED",
        message: String(rollbackError?.message || rollbackError),
      },
    },
  );
  error.cause = rollbackError;
  return error;
}

function rollbackAfterError(transaction, error, reason) {
  try {
    const evidence = transaction.rollback({ reason });
    error.managedTransactionResult = managedRunResult(
      transaction,
      evidence,
      error.processResult || null,
      false,
    );
    return error;
  } catch (rollbackError) {
    return attachRollbackFailure(error, transaction, rollbackError);
  }
}

/**
 * Execute one literal foreground command inside a partial workspace
 * transaction. The command always passes through ProcessExecutionBroker with a
 * mandatory process-tree boundary. A missing boundary is therefore denied by
 * the Broker before command execution; it is never downgraded.
 */
export async function runManagedWorkspaceCommand(options = {}) {
  const broker = options.broker;
  if (
    !broker ||
    typeof broker.beginWorkspaceTransaction !== "function" ||
    typeof broker.spawn !== "function"
  ) {
    throw commandError(
      "MANAGED_CHECKPOINT_BROKER_REQUIRED",
      "managed run requires ProcessExecutionBroker",
    );
  }
  if (options.detached === true || options.background === true) {
    throw commandError(
      "MANAGED_CHECKPOINT_FOREGROUND_REQUIRED",
      "managed run rejects detached/background execution",
    );
  }
  const normalized = normalizeCommand(options.command, options.args || []);
  const workspaceRoot = path.resolve(options.workspaceRoot || ".");
  const runId = options.runId || `managed-run-${crypto.randomUUID()}`;
  const taskKey = options.taskKey || "managed-command";
  const captureOutput = options.captureOutput === true;
  const maxOutputBytes = normalizeCaptureLimit(options.maxOutputBytes);

  const transaction = broker.beginWorkspaceTransaction({
    workspaceRoot,
    runId,
    taskKey,
    coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    externalSideEffects: true,
    writerIsolation: "unknown",
    exclusions: Array.isArray(options.exclusions) ? options.exclusions : [],
    ...(options.stateDir ? { stateDir: path.resolve(options.stateDir) } : {}),
  });

  let processResult;
  try {
    processResult = await executeForegroundProcess(
      broker,
      normalized.command,
      normalized.args,
      {
        cwd: workspaceRoot,
        captureOutput,
        maxOutputBytes,
        stdoutWriter: options.stdoutWriter,
        stderrWriter: options.stderrWriter,
      },
    );
  } catch (error) {
    throw rollbackAfterError(
      transaction,
      error,
      `managed command failed before a clean exit: ${error.message}`,
    );
  }

  if (processResult.exitCode !== 0) {
    try {
      const evidence = transaction.rollback({
        reason:
          processResult.signal != null
            ? `managed command terminated by ${processResult.signal}`
            : `managed command exited ${processResult.exitCode ?? "without a status"}`,
      });
      return managedRunResult(transaction, evidence, processResult, false);
    } catch (rollbackError) {
      throw attachRollbackFailure(
        commandError(
          "MANAGED_CHECKPOINT_COMMAND_FAILED",
          `managed command exited ${processResult.exitCode ?? "without a status"}`,
          { processResult },
        ),
        transaction,
        rollbackError,
      );
    }
  }

  try {
    const evidence = transaction.accept();
    return managedRunResult(transaction, evidence, processResult, true);
  } catch (acceptError) {
    throw rollbackAfterError(
      transaction,
      acceptError,
      `managed command commit failed: ${acceptError.message}`,
    );
  }
}

function safeErrorDetails(error) {
  const details = {};
  for (const key of [
    "transactionId",
    "restoreId",
    "undoId",
    "state",
    "expectedEvidenceDigest",
    "actualEvidenceDigest",
    "expectedRestoreEvidenceDigest",
    "actualRestoreEvidenceDigest",
    "conflictDigest",
    "conflicts",
    "unsafe",
    "checkpointId",
    "transactionState",
    "primaryError",
    "rollbackError",
    "managedTransactionResult",
  ]) {
    if (error?.[key] !== undefined) details[key] = error[key];
  }
  return details;
}

function defaultOutput() {
  return {
    json(value) {
      console.log(JSON.stringify(value, null, 2));
    },
    line(value) {
      logger.log(value);
    },
    error(error, json) {
      if (json) {
        console.error(
          JSON.stringify(
            {
              ok: false,
              code: error?.code || "MANAGED_CHECKPOINT_ERROR",
              message: String(error?.message || error),
              ...safeErrorDetails(error),
            },
            null,
            2,
          ),
        );
      } else {
        logger.error(
          chalk.red(
            `managed checkpoint failed [${error?.code || "MANAGED_CHECKPOINT_ERROR"}]: ${error?.message || error}`,
          ),
        );
      }
    },
  };
}

async function confirmMutation(kind, id, options, dependencies) {
  if (options.yes === true) return true;
  const isTTY =
    dependencies.isTTY === undefined
      ? process.stdin.isTTY === true
      : dependencies.isTTY === true;
  if (!isTTY) {
    throw commandError(
      "MANAGED_CHECKPOINT_CONFIRMATION_REQUIRED",
      `refusing to ${kind} in non-interactive mode without --yes`,
      { transactionId: id },
    );
  }
  const confirm =
    dependencies.confirm ||
    (async (message) => {
      const prompts = await import("@inquirer/prompts");
      return prompts.confirm({ message, default: false }).catch(() => false);
    });
  return (
    (await confirm(
      `${kind === "restore" ? "Restore" : "Undo restore for"} managed transaction ${id}? This rewrites workspace files, takes/uses a safety checkpoint, and does not reverse external side effects.${options.force ? " --force also authorizes overwriting post-checkpoint conflicts." : ""}`,
    )) === true
  );
}

function writeSummary(output, item) {
  output.line(
    `${item.id}  ${item.state}  overall=${item.coverage} files=${item.fileCoverage}`,
  );
  output.line(`  workspace: ${item.workspaceRoot || "(unknown)"}`);
  if (item.updatedAt) output.line(`  updated:   ${item.updatedAt}`);
  if (item.evidenceDigest) {
    output.line(`  evidence:  ${item.evidenceDigest}`);
  }
  for (const warning of item.warnings) {
    output.line(chalk.yellow(`  warning: ${warning}`));
  }
}

/**
 * Register managed transaction commands under an existing `checkpoint`
 * Commander command. `dependencies` is intentionally injectable so the
 * destructive command policy can be tested without mutating global state.
 */
export function registerManagedCheckpointCommands(
  checkpointCommand,
  dependencies = {},
) {
  const managerFactory =
    dependencies.managerFactory ||
    ((options) => new WorkspaceTransactionManager(options));
  const output = dependencies.output || defaultOutput();

  const managed = checkpointCommand
    .command("managed")
    .description(
      "Run, inspect, and explicitly restore Process Broker workspace transactions",
    );

  const addStoreOptions = (command) =>
    command.option(
      "--state-dir <dir>",
      "Managed transaction state directory (outside the workspace)",
    );

  addStoreOptions(
    managed
      .command("list")
      .alias("ls")
      .description("List verified managed workspace transactions")
      .option("--workspace <dir>", "Only transactions for this workspace")
      .option("--json", "Output machine-readable JSON"),
  ).action(async (options) => {
    try {
      const manager = managerFactory(managerOptions(options));
      const records = listManagedCheckpoints(manager, {
        workspaceRoot: resolveWorkspaceFilter(options.workspace),
      });
      if (options.json) {
        output.json(records);
        return;
      }
      if (records.length === 0) {
        output.line("No managed workspace transactions.");
        return;
      }
      records.forEach((item) => writeSummary(output, item));
    } catch (error) {
      output.error(error, options.json === true);
      process.exitCode = 1;
    }
  });

  addStoreOptions(
    managed
      .command("show <transaction-id>")
      .description("Show verified transaction, coverage, and restore evidence")
      .option("--json", "Output machine-readable JSON"),
  ).action(async (id, options) => {
    try {
      const manager = managerFactory(managerOptions(options));
      const details = showManagedCheckpoint(manager, id);
      if (options.json) {
        output.json(details);
        return;
      }
      writeSummary(output, details);
      if (details.checkpoint) {
        output.line(
          `  checkpoint: ${details.checkpoint.id} ${details.checkpoint.digest}`,
        );
        output.line(
          `  captured:   ${details.checkpoint.files ?? "?"} files, ${details.checkpoint.bytes ?? "?"} bytes`,
        );
      }
      if (details.restoreEvidenceDigest) {
        output.line(`  restore evidence: ${details.restoreEvidenceDigest}`);
      }
      if (details.undoRestoreEvidenceDigest) {
        output.line(`  undo evidence:    ${details.undoRestoreEvidenceDigest}`);
      }
    } catch (error) {
      output.error(error, options.json === true);
      process.exitCode = 1;
    }
  });

  addStoreOptions(
    managed
      .command("run [command...]")
      .description(
        "Run one literal foreground command in a partial managed transaction (use -- before the command)",
      )
      .option("-d, --dir <dir>", "Workspace root", ".")
      .option("--run-id <id>", "Durable run binding")
      .option("--task-key <key>", "Durable task binding", "managed-command")
      .option(
        "--exclude <paths...>",
        "Explicit uncovered workspace-relative paths",
      )
      .option(
        "--max-output-bytes <bytes>",
        "Per-stream output safety limit (max 67108864)",
        String(DEFAULT_MAX_CAPTURE_BYTES),
      )
      .option(
        "--background",
        "Rejected: managed transactions require foreground execution",
      )
      .option(
        "--json",
        "Capture command output and emit machine-readable JSON",
      ),
  ).action(async (tokens, options) => {
    try {
      const broker =
        dependencies.broker ||
        (await import("../lib/process-execution-broker/index.js"))
          .executionBroker;
      const command = Array.isArray(tokens) ? tokens[0] : null;
      const args = Array.isArray(tokens) ? tokens.slice(1) : [];
      const result = await runManagedWorkspaceCommand({
        broker,
        command,
        args,
        workspaceRoot: options.dir,
        runId: options.runId,
        taskKey: options.taskKey,
        stateDir: options.stateDir,
        exclusions: options.exclude || [],
        background: options.background === true,
        captureOutput: options.json === true,
        maxOutputBytes: options.maxOutputBytes,
        stdoutWriter:
          dependencies.stdoutWriter || ((chunk) => process.stdout.write(chunk)),
        stderrWriter:
          dependencies.stderrWriter || ((chunk) => process.stderr.write(chunk)),
      });
      if (options.json) {
        output.json(result);
      } else {
        output.line(
          result.ok
            ? chalk.green(
                `Committed managed transaction ${result.transactionId}.`,
              )
            : chalk.yellow(
                `Command failed; rolled back managed transaction ${result.transactionId}.`,
              ),
        );
        output.line(`  checkpoint: ${result.checkpointId}`);
        output.line(`  evidence:   ${result.evidenceDigest}`);
        output.line(
          `  coverage:   overall=${result.coverage} files=${result.fileCoverage}`,
        );
        for (const warning of result.warnings) {
          output.line(chalk.yellow(`  warning: ${warning}`));
        }
      }
      if (!result.ok) {
        process.exitCode =
          Number.isInteger(result.exitCode) &&
          result.exitCode > 0 &&
          result.exitCode <= 255
            ? result.exitCode
            : 1;
      }
    } catch (error) {
      output.error(error, options.json === true);
      process.exitCode = 1;
    }
  });

  addStoreOptions(
    managed
      .command("restore <transaction-id>")
      .description(
        "Restore a committed managed checkpoint (evidence digest required)",
      )
      .requiredOption(
        "--expected-evidence-digest <digest>",
        "Exact committed evidence digest shown by `managed show`",
      )
      .option("--reason <text>", "Human restore reason")
      .option(
        "--force",
        "Overwrite post-commit conflicts; never bypasses evidence/unsafe checks",
      )
      .option("--yes", "Approve the destructive operation without a prompt")
      .option("--json", "Output machine-readable JSON"),
  ).action(async (id, options) => {
    try {
      if (!(await confirmMutation("restore", id, options, dependencies))) {
        output.line("Aborted.");
        return;
      }
      const manager = managerFactory(managerOptions(options));
      const evidence = restoreManagedCheckpoint(manager, id, {
        expectedEvidenceDigest: options.expectedEvidenceDigest,
        force: options.force,
        reason: options.reason,
      });
      const fileCoverage =
        evidence?.fileCoverage || WORKSPACE_TRANSACTION_COVERAGE.NONE;
      const externalSideEffects = evidence?.externalSideEffects !== false;
      const coverage =
        evidence?.coverage ||
        (fileCoverage === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
        !externalSideEffects
          ? WORKSPACE_TRANSACTION_COVERAGE.FULL
          : WORKSPACE_TRANSACTION_COVERAGE.PARTIAL);
      const uncoveredPaths = Array.isArray(evidence?.uncoveredPaths)
        ? evidence.uncoveredPaths
        : [];
      const result = {
        ok: true,
        transactionId: id,
        outcome: evidence?.outcome || "restored",
        forced: evidence?.forced === true,
        coverage,
        fileCoverage,
        externalSideEffects,
        uncoveredPaths,
        restoreEvidenceDigest: evidence?.evidenceDigest || null,
        safetyCheckpoint: evidence?.safetyCheckpoint || null,
        warnings: coverageWarnings({
          coverage,
          fileCoverage,
          externalSideEffects,
          uncoveredPaths,
        }),
      };
      if (options.json) {
        output.json(result);
        return;
      }
      output.line(chalk.green(`Restored managed transaction ${id}.`));
      output.line(
        `  restore evidence: ${result.restoreEvidenceDigest || "(unavailable)"}`,
      );
      output.line(
        `  coverage: overall=${result.coverage} files=${result.fileCoverage}`,
      );
      result.warnings.forEach((warning) =>
        output.line(chalk.yellow(`  warning: ${warning}`)),
      );
      if (result.restoreEvidenceDigest) {
        output.line(
          `  undo with: cc checkpoint managed undo ${id} --expected-restore-evidence-digest ${result.restoreEvidenceDigest} --yes`,
        );
      }
    } catch (error) {
      output.error(error, options.json === true);
      process.exitCode = 1;
    }
  });

  addStoreOptions(
    managed
      .command("undo <transaction-id>")
      .description(
        "Undo a completed managed restore using its safety checkpoint",
      )
      .requiredOption(
        "--expected-restore-evidence-digest <digest>",
        "Exact restore evidence digest returned by `managed restore`",
      )
      .option("--reason <text>", "Human undo reason")
      .option(
        "--force",
        "Overwrite post-restore conflicts; never bypasses evidence/unsafe checks",
      )
      .option("--yes", "Approve the destructive operation without a prompt")
      .option("--json", "Output machine-readable JSON"),
  ).action(async (id, options) => {
    try {
      if (!(await confirmMutation("undo", id, options, dependencies))) {
        output.line("Aborted.");
        return;
      }
      const manager = managerFactory(managerOptions(options));
      const evidence = undoManagedCheckpointRestore(manager, id, {
        expectedRestoreEvidenceDigest: options.expectedRestoreEvidenceDigest,
        force: options.force,
        reason: options.reason,
      });
      const fileCoverage =
        evidence?.fileCoverage || WORKSPACE_TRANSACTION_COVERAGE.NONE;
      const externalSideEffects = evidence?.externalSideEffects !== false;
      const coverage =
        evidence?.coverage ||
        (fileCoverage === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
        !externalSideEffects
          ? WORKSPACE_TRANSACTION_COVERAGE.FULL
          : WORKSPACE_TRANSACTION_COVERAGE.PARTIAL);
      const uncoveredPaths = Array.isArray(evidence?.uncoveredPaths)
        ? evidence.uncoveredPaths
        : [];
      const result = {
        ok: true,
        transactionId: id,
        outcome: evidence?.outcome || "restore_undone",
        forced: evidence?.forced === true,
        coverage,
        fileCoverage,
        externalSideEffects,
        uncoveredPaths,
        undoRestoreEvidenceDigest: evidence?.evidenceDigest || null,
        warnings: coverageWarnings({
          coverage,
          fileCoverage,
          externalSideEffects,
          uncoveredPaths,
        }),
      };
      if (options.json) {
        output.json(result);
        return;
      }
      output.line(chalk.green(`Undid managed restore for transaction ${id}.`));
      output.line(
        `  undo evidence: ${result.undoRestoreEvidenceDigest || "(unavailable)"}`,
      );
      output.line(
        `  coverage: overall=${result.coverage} files=${result.fileCoverage}`,
      );
      result.warnings.forEach((warning) =>
        output.line(chalk.yellow(`  warning: ${warning}`)),
      );
    } catch (error) {
      output.error(error, options.json === true);
      process.exitCode = 1;
    }
  });

  return managed;
}
