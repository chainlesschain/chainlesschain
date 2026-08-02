/**
 * `cc checkpoint recovery` command surface.
 *
 * The command layer keeps read projections and mutation authority separate:
 * saga evidence supplies the exact sequence/head, while the canonical
 * workspace lock is inspected immediately before show/abort/release to derive
 * a live owner digest (or verified absence). The complete owner is never
 * returned or printed.
 */

import path from "node:path";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../lib/checkpoint-restore-saga.js";
import {
  createCheckpointRestoreRecoveryReader,
  MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT,
} from "../lib/checkpoint-restore-recovery.js";
import { CheckpointRestoreRecoveryController } from "../lib/checkpoint-restore-recovery-controller.js";
import { inspectWorkspaceLockOwnerSync } from "../lib/process-execution-broker/workspace-transaction.js";

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
  FAILED: "CHECKPOINT_RESTORE_RECOVERY_CLI_FAILED",
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const PHASES = new Set([
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
const CONTROLLER_ABORT_PHASES = new Set(["created", "locked"]);
const CHECKPOINT_RESTORE_PURPOSE = "checkpoint-restore";

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

function safeErrorCode(value, fallback) {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value)
    ? value
    : fallback;
}

function publicError(error) {
  if (error instanceof CheckpointRestoreRecoveryCliError) return error;
  const code = safeErrorCode(
    error?.code,
    CHECKPOINT_RESTORE_RECOVERY_CLI_ERROR_CODES.FAILED,
  );
  const message =
    PUBLIC_ERROR_MESSAGES[code] ||
    PUBLIC_ERROR_MESSAGES.CHECKPOINT_RESTORE_RECOVERY_CLI_FAILED;
  const notExecutable =
    code.includes("CONFLICT") ||
    code.includes("NOT_ALLOWED") ||
    code.includes("NOT_FOUND") ||
    code.includes("RECOVERY_REQUIRED");
  const invalid = code.includes("INVALID_ARGUMENT");
  return new CheckpointRestoreRecoveryCliError(
    code,
    message,
    invalid
      ? CHECKPOINT_RESTORE_RECOVERY_CLI_EXIT_CODES.INVALID_USAGE
      : notExecutable
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
    createStore:
      dependencies.createStore ||
      ((options) => new CheckpointRestoreSagaStore(options)),
    createRecoveryReader:
      dependencies.createRecoveryReader ||
      ((options) => createCheckpointRestoreRecoveryReader(options)),
    createRecoveryController:
      dependencies.createRecoveryController ||
      ((options) => new CheckpointRestoreRecoveryController(options)),
    inspectWorkspaceLockOwnerSync:
      dependencies.inspectWorkspaceLockOwnerSync ||
      inspectWorkspaceLockOwnerSync,
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

function openContext(runtime, directory, { mutation = false } = {}) {
  const workspaceRoot = runtime.resolveWorkspaceRoot(directory || ".");
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
  return Object.freeze({ workspaceRoot, store, reader, controller });
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

  const deferred = (name) => {
    const candidate = projection?.actionEligibility?.[name]?.candidate === true;
    return commandAction({
      candidate,
      eligible: false,
      blockers: ["action_not_implemented"],
      prerequisites: candidate
        ? projection.actionEligibility[name].prerequisites || []
        : [],
    });
  };

  return Object.freeze({
    abort: commandAction({
      candidate: abortCandidate,
      eligible: abortEligible,
      blockers: abortBlockers,
      prerequisites: abortCandidate
        ? ["exact_mutation_fence", "controller_compare_and_swap"]
        : [],
    }),
    resume: deferred("resume"),
    rollback: deferred("rollback"),
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

function safeMutationResult(result, actionName, operationId) {
  if (
    !isPlainObject(result) ||
    result.ok !== true ||
    result.action !== actionName ||
    result.operationId !== operationId ||
    !PHASES.has(result.phase) ||
    !Number.isSafeInteger(result.seq) ||
    result.seq < 1 ||
    typeof result.headHash !== "string" ||
    !HASH_PATTERN.test(result.headHash)
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
    action: actionName,
    operationId,
    phase: result.phase,
    seq: result.seq,
    headHash: result.headHash,
    archived: result.archived === true,
    alreadyArchived: result.alreadyArchived === true,
    reconciledFromError: result.reconciledFromError === true,
    warning: result.warning
      ? Object.freeze({
          code: safeErrorCode(
            result.warning.code,
            "CHECKPOINT_RESTORE_SAGA_ARCHIVE_PENDING",
          ),
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
    lines.push(
      `  ${item.operationId}  phase=${item.phase} base=${item.basePhase || "unknown"} seq=${item.seq}`,
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

/** Register `checkpoint recovery list/show/abort/release`. */
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
      "Inspect and conservatively settle durable checkpoint restore recovery; Resume and rollback are read-only candidates only",
    )
    .addHelpText(
      "after",
      "\nResume and rollback are read-only candidates only; this command never executes them.\n",
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
      .command("release")
      .description("Release/archive only a verified terminal restore"),
  )
    .argument("<operation-id>", "Checkpoint restore operationId")
    .action((operationId, options) => handlers.release(operationId, options));

  return recovery;
}
