/**
 * cc checkpoint — file-state snapshot / rewind (Claude-Code rewind parity).
 *
 *   cc checkpoint create [paths...] [--label <l>]   snapshot the work tree (git)
 *                                                   or the given paths (fallback)
 *   cc checkpoint list                              list checkpoints
 *   cc checkpoint show <id> [--diff]                manifest, or diff vs current
 *   cc checkpoint restore <id> [--dry-run] [--force]  roll back (alias: rewind)
 *   cc checkpoint delete <id> [--force]             remove a checkpoint
 *   cc checkpoint clear                             remove all (a session)
 *
 * Engine: inside a git work tree it uses git-plumbing shadow commits
 * (whole-tree, content-addressed, .gitignore-aware, accurate add/modify/delete
 * rewind — refs/cc-checkpoints/*). Outside git it falls back to the copy-based
 * store (file-checkpoint.js) which snapshots the explicit paths you name.
 *
 * Restore takes an automatic safety snapshot of the current state first, so a
 * rewind is itself reversible. Distinct from `cc workflow checkpoint`
 * (workflow execution state, not files).
 */

import chalk from "chalk";
import { createHash } from "node:crypto";
import { resolve } from "path";
import {
  buildCheckpointTimeline,
  projectCheckpointTimeline,
} from "../lib/checkpoint-timeline.js";
import {
  CHECKPOINT_TIMELINE_AUDIT_EVENT,
  CHECKPOINT_TIMELINE_INTENT_EVENT,
  CHECKPOINT_TIMELINE_RESULT_SCHEMA,
  CHECKPOINT_TIMELINE_RESULT_VERSION,
  checkpointTimelineConfirmationsMatch,
  planCheckpointTimelineAction,
  timelineActionError,
  validateCheckpointTimelineConfirmationSubmission,
  validateCheckpointTimelineSubmission,
} from "../lib/checkpoint-timeline-authority.js";
import { logger } from "../lib/logger.js";
import {
  loadTurnBindingLog,
  TURN_BINDING_TIMELINE_EVENT,
} from "../lib/turn-binding-store.js";
import {
  createBranchSession,
  findLatestEvent,
  readVerifiedMessages,
  withSessionAuthorityTransaction,
} from "../harness/jsonl-session-store.js";
import { withWorkspaceLockSync as withCanonicalWorkspaceLockSync } from "../lib/process-execution-broker/workspace-transaction.js";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../lib/checkpoint-restore-saga.js";
import {
  computeCheckpointRestoreDigest,
  runCheckpointRestoreOperation,
} from "../lib/checkpoint-restore-orchestrator.js";
import { registerManagedCheckpointCommands } from "./checkpoint-managed.js";
import { registerCheckpointRestoreRecoveryCommands } from "./checkpoint-restore-recovery.js";

function stableCheckpointRestoreValue(value) {
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
    return `[${value.map((entry) => stableCheckpointRestoreValue(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableCheckpointRestoreValue(value[key])}`,
      )
      .join(",")}}`;
  }
  throw new TypeError("checkpoint restore evidence is not canonical JSON");
}

function checkpointRestoreDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${stableCheckpointRestoreValue(value)}`)
    .digest("hex")}`;
}

function boundedCheckpointRestoreText(value, fallback, maximum = 2_048) {
  let sanitized = "";
  for (const character of String(value || fallback)) {
    const code = character.charCodeAt(0);
    sanitized += code < 32 || code === 127 ? " " : character;
  }
  const normalized = sanitized.trim();
  return (normalized || fallback).slice(0, maximum);
}

function checkpointRestoreErrorCode(error) {
  return boundedCheckpointRestoreText(
    error?.code,
    "CHECKPOINT_RESTORE_FAILED",
    128,
  );
}

function checkpointRestoreTargetCount(planned) {
  const total = planned?.preview?.code?.summary?.total;
  if (!Number.isSafeInteger(total) || total < 0) {
    const error = new Error("checkpoint restore target count is unavailable");
    error.code = "TIMELINE_WORKSPACE_BINDING_INVALID";
    throw error;
  }
  return total;
}

/** git-plumbing engine adapter (normalized interface). */
function gitEngine(gs, dir, session) {
  return {
    kind: "git",
    create: ({ label }) => {
      const r = gs.createCheckpoint(dir, { session, label });
      return {
        id: r.id,
        label: r.label,
        createdAt: r.createdAt,
        fileCount: r.files ?? r.fileCount,
      };
    },
    list: () =>
      gs.listCheckpoints(dir, { session }).map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt,
        fileCount: null,
        identity: r.commit ? `git:${r.commit}` : null,
      })),
    show: (id) => gs.showCheckpoint(dir, id, { session }),
    status: (id, o) => {
      const status = gs.statusAgainst(dir, id, {
        session,
        expectedIdentity: o?.expectedIdentity,
      });
      return {
        checkpointIdentity: status.checkpointIdentity,
        modified: status.modified,
        added: status.added,
        deleted: status.deleted,
        ...(o?.includeWorkspaceBinding
          ? { workspaceBinding: status.workspaceBinding }
          : {}),
      };
    },
    diffText: (id, o) => gs.diffCheckpoint(dir, id, { session, stat: o?.stat }),
    restore: (id, o) => {
      const r = gs.rewindTo(dir, id, {
        session,
        dryRun: o?.dryRun,
        skipSafety: o?.skipSafety,
        expectedIdentity: o?.expectedIdentity,
        expectedWorkspaceBinding: o?.expectedWorkspaceBinding,
        expectedSafetyPlanIdentity: o?.expectedSafetyPlanIdentity,
        onSafetyReady: o?.onSafetyReady,
        onMutationStarted: o?.onMutationStarted,
        onWorkspaceApplied: o?.onWorkspaceApplied,
      });
      return {
        dryRun: !!r.dryRun,
        restoredCount: r.modified + r.recreated,
        modified: r.modified,
        recreated: r.recreated,
        deleted: r.deleted,
        safetyId: r.safetyId,
        safetyIdentity: r.safetyIdentity,
        safetyPlanIdentity: r.safetyPlanIdentity,
        safetyCoverage: r.safetyCoverage,
      };
    },
    remove: (id) => gs.deleteCheckpoint(dir, id, { session }),
    clear: () => gs.clearCheckpoints(dir, { session }),
  };
}

/** copy-based engine adapter (normalized interface). */
function copyEngine(cs, dir) {
  return {
    kind: "copy",
    create: ({ paths, label }) => {
      const m = cs.createCheckpoint(paths, { cwd: dir, label });
      return {
        id: m.id,
        label: m.label,
        createdAt: m.createdAt,
        fileCount: m.fileCount,
      };
    },
    list: () =>
      cs.listCheckpoints().map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.createdAt,
        fileCount: c.fileCount,
        identity: c.identity || null,
      })),
    show: (id) => {
      const m = cs.getCheckpoint(id);
      if (!m) throw new Error(`no such checkpoint: ${id}`);
      return {
        id: m.id,
        label: m.label,
        createdAt: m.createdAt,
        fileCount: m.fileCount,
        files: m.files.map((f) => ({ rel: f.rel, bytes: f.bytes })),
      };
    },
    status: (id, o) => {
      const d = cs.diffCheckpoint(id, {
        cwd: dir,
        expectedIdentity: o?.expectedIdentity,
        expectedSafetyPlanIdentity: o?.expectedSafetyPlanIdentity,
      });
      return {
        checkpointIdentity: d.checkpointIdentity,
        modified: d.modified,
        added: [],
        deleted: d.deleted,
        ...(o?.includeWorkspaceBinding
          ? { workspaceBinding: d.workspaceBinding }
          : {}),
      };
    },
    diffText: () => null, // copy engine has no raw patch — caller uses status()
    restore: (id, o) => {
      const r = cs.restoreCheckpoint(id, {
        cwd: dir,
        dryRun: o?.dryRun,
        skipSafety: o?.skipSafety,
        expectedIdentity: o?.expectedIdentity,
        expectedWorkspaceBinding: o?.expectedWorkspaceBinding,
        expectedSafetyPlanIdentity: o?.expectedSafetyPlanIdentity,
        onSafetyReady: o?.onSafetyReady,
        onMutationStarted: o?.onMutationStarted,
        onWorkspaceApplied: o?.onWorkspaceApplied,
      });
      return {
        dryRun: !!r.dryRun,
        restoredCount: r.restored.length,
        restored: r.restored,
        missingBlob: r.missingBlob,
        safetyId: r.safetyId,
        safetyIdentity: r.safetyIdentity,
        safetyPlanIdentity: r.safetyPlanIdentity,
        safetyCoverage: r.safetyCoverage,
        createdPaths: r.createdPaths,
        deletedPaths: r.deletedPaths,
      };
    },
    remove: (id) => cs.deleteCheckpoint(id),
    clear: () => {
      const all = cs.listCheckpoints();
      for (const c of all) cs.deleteCheckpoint(c.id);
      return all.length;
    },
  };
}

/** Choose the engine for `dir`: git-plumbing when available, else copy-based. */
async function pickEngine(dir, session) {
  const gs = await import("../lib/checkpoint-store.js");
  if (gs.isCheckpointAvailable(dir)) return gitEngine(gs, dir, session);
  const cs = await import("../lib/file-checkpoint.js");
  return copyEngine(cs, dir);
}

function loadTimelineContext(engine, sessionId) {
  const binding = loadTurnBindingLog(sessionId);
  const checkpoints = engine.list();
  const headHash = findLatestEvent(sessionId, null)?.hash || null;
  const timeline = buildCheckpointTimeline({
    sessionId,
    turns: binding,
    checkpoints,
    headHash,
  });
  return {
    binding,
    checkpoints,
    headHash,
    timeline,
    messages: readVerifiedMessages(sessionId),
  };
}

function printTimelineActionResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result?.ok === false) {
    logger.error(
      chalk.red(
        `${result.code || "TIMELINE_ACTION_FAILED"}: ${result.error || "request rejected"}`,
      ),
    );
    return;
  }
  logger.log(
    chalk.green(
      `${result.mode === "preview" ? "Preview" : "Completed"}: ${result.action} at ${result.turnId}`,
    ),
  );
  for (const warning of result.warnings || []) {
    logger.log(chalk.yellow(`  ${warning}`));
  }
}

const tag = (engine) => chalk.dim(engine.kind === "git" ? "[git]" : "[copy]");

function isCodeRestoreAction(action) {
  return action === "restore-code" || action === "restore-both";
}

function workspaceStaleError(message = "workspace changed; preview again") {
  const error = new Error(message);
  error.code = "TIMELINE_WORKSPACE_STALE";
  return error;
}

function restoreWorkspaceStaleError(
  message = "workspace changed before the restore lock was acquired; retry the restore",
) {
  const error = new Error(message);
  error.code = "CHECKPOINT_WORKSPACE_STALE";
  return error;
}

function directRestoreTargetCount(preview) {
  const groups = [preview?.modified, preview?.added, preview?.deleted];
  if (groups.some((group) => !Array.isArray(group))) {
    throw restoreWorkspaceStaleError(
      "checkpoint restore target count is unavailable; retry the restore",
    );
  }
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  if (!Number.isSafeInteger(total)) {
    throw restoreWorkspaceStaleError(
      "checkpoint restore target count is invalid; retry the restore",
    );
  }
  return total;
}

function directRestorePlan({
  engine,
  checkpointId,
  checkpointNamespace,
  preview,
  authorization,
}) {
  const checkpointIdentity = preview?.checkpointIdentity;
  const workspaceBinding = preview?.workspaceBinding;
  const workspaceRoot = workspaceBinding?.workspaceRoot;
  if (
    typeof checkpointIdentity !== "string" ||
    checkpointIdentity.length === 0 ||
    !workspaceRoot
  ) {
    throw restoreWorkspaceStaleError(
      "checkpoint immutable identity or workspace scope is unavailable; retry the restore",
    );
  }
  const targetCount = directRestoreTargetCount(preview);
  return {
    restoreKind: engine.kind,
    restoreSurface: "direct",
    checkpointId,
    checkpointIdentity,
    checkpointNamespace,
    workspaceRoot,
    workspaceBinding,
    targetCount,
    confirmationDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-direct-confirmation-v1",
      {
        authorization,
        restoreKind: engine.kind,
        checkpointId,
        checkpointIdentity,
        checkpointNamespace,
        workspaceBinding,
        targetCount,
      },
    ),
  };
}

export function registerCheckpointCommand(program, dependencies = {}) {
  const withWorkspaceLockSync =
    dependencies.withWorkspaceLockSync || withCanonicalWorkspaceLockSync;
  const createCheckpointRestoreSagaStore =
    dependencies.createCheckpointRestoreSagaStore ||
    ((options) => new CheckpointRestoreSagaStore(options));
  const workspaceLockOwnerDigest =
    dependencies.computeCheckpointRestoreWorkspaceLockOwnerDigest ||
    computeCheckpointRestoreWorkspaceLockOwnerDigest;
  const runCheckpointRestore =
    dependencies.runCheckpointRestoreOperation || runCheckpointRestoreOperation;
  const cp = program
    .command("checkpoint")
    .description("Snapshot / rewind file state (git-plumbing, copy fallback)");

  registerManagedCheckpointCommands(cp);
  registerCheckpointRestoreRecoveryCommands(
    cp,
    dependencies.checkpointRestoreRecovery,
  );

  cp.command("create [paths...]")
    .description(
      "Snapshot the work tree (git) or the given files/dirs (fallback)",
    )
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--label <label>", "Human label for this checkpoint")
    .option("--json", "Output as JSON")
    .action(async (paths, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        if (engine.kind === "copy" && (!paths || paths.length === 0)) {
          logger.error(
            chalk.red(
              "Not a git repo here — specify paths to snapshot: cc checkpoint create <paths...>",
            ),
          );
          process.exitCode = 1;
          return;
        }
        if (engine.kind === "git" && paths && paths.length > 0) {
          logger.log(
            chalk.gray(
              "  (git engine snapshots the whole work tree; paths ignored)",
            ),
          );
        }
        const m = engine.create({ paths, label: options.label });
        if (options.json) {
          console.log(JSON.stringify({ ...m, engine: engine.kind }, null, 2));
          return;
        }
        logger.log(
          chalk.green(`✓ checkpoint ${chalk.bold(m.id)}`) +
            ` ${tag(engine)}` +
            (m.label ? chalk.gray(`  "${m.label}"`) : ""),
        );
        logger.log(chalk.gray(`  ${m.fileCount} file(s) snapshotted`));
        logger.log(
          chalk.gray(
            `  rewind with: cc checkpoint restore ${m.id}` +
              (options.session !== "default" ? ` -s ${options.session}` : ""),
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`checkpoint create failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("list")
    .alias("ls")
    .description("List checkpoints (newest first)")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        const all = engine.list();
        if (options.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        if (all.length === 0) {
          logger.log(
            chalk.gray(
              "No checkpoints. Create one: cc checkpoint create" +
                (engine.kind === "copy" ? " <paths...>" : ""),
            ),
          );
          return;
        }
        for (const c of all) {
          const count =
            c.fileCount == null
              ? ""
              : `${String(c.fileCount).padStart(4)} files`;
          logger.log(
            `${chalk.cyan(c.id.padEnd(22))} ${chalk.gray(c.createdAt)}  ${count}` +
              (c.label ? chalk.gray(`  "${c.label}"`) : ""),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`checkpoint list failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("timeline")
    .description(
      "Project persisted turns, checkpoints, side effects, and rewind actions",
    )
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint/session binding", "default")
    .option("--json", "Output the canonical versioned projection as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        const { timeline } = loadTimelineContext(engine, options.session);
        if (options.json) {
          console.log(JSON.stringify(timeline, null, 2));
          return;
        }

        const projection = projectCheckpointTimeline(timeline);
        if (projection.entries.length === 0) {
          logger.log(
            chalk.gray(
              timeline.unboundMarkers.length > 0
                ? `${timeline.unboundMarkers.length} checkpoint/marker(s) are not bound to a persisted turn.`
                : "No persisted checkpoint timeline for this session.",
            ),
          );
          return;
        }
        for (const entry of projection.entries) {
          const coverage =
            entry.coverage === "full"
              ? chalk.green(entry.coverage)
              : entry.coverage === "partial"
                ? chalk.yellow(entry.coverage)
                : chalk.red(entry.coverage);
          logger.log(
            `${chalk.cyan(entry.turnId)}  ${coverage}  ` +
              `${entry.markerKinds.join(", ") || "no markers"}  ` +
              `${entry.enabledActions.join(", ") || "no actions"}`,
          );
          if (entry.excludedPaths.length > 0) {
            logger.log(
              chalk.yellow(`  excluded: ${entry.excludedPaths.join(", ")}`),
            );
          }
          if (entry.irreversibleSideEffects.length > 0) {
            logger.log(
              chalk.red(
                `  irreversible: ${entry.irreversibleSideEffects.join(", ")}`,
              ),
            );
          }
        }
      } catch (err) {
        logger.error(chalk.red(`checkpoint timeline failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("action")
    .description(
      "Preview or commit a CLI-authored checkpoint timeline submission",
    )
    .requiredOption(
      "--submission <json>",
      "Exact action envelope embedded in checkpoint timeline --json",
    )
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint/session binding", "default")
    .option("--preview", "Validate and preview without writing")
    .option("--confirm", "Commit after an IDE/user confirmation")
    .option("--json", "Output the versioned result as JSON")
    .action(async (options) => {
      let output;
      try {
        if (options.preview === options.confirm) {
          const error = new Error(
            "choose exactly one of --preview or --confirm",
          );
          error.code = "TIMELINE_CONFIRMATION_REQUIRED";
          throw error;
        }
        if (String(options.submission).length > 16_384) {
          const error = new Error("timeline submission is too large");
          error.code = "TIMELINE_SUBMISSION_INVALID";
          throw error;
        }
        let submittedEnvelope;
        try {
          submittedEnvelope = JSON.parse(options.submission);
        } catch {
          const error = new Error("timeline submission must be valid JSON");
          error.code = "TIMELINE_SUBMISSION_INVALID";
          throw error;
        }

        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        const planForContext = (authoritativeContext) => {
          const validation = options.preview
            ? validateCheckpointTimelineSubmission(
                authoritativeContext.timeline,
                submittedEnvelope,
              )
            : validateCheckpointTimelineConfirmationSubmission(
                authoritativeContext.timeline,
                submittedEnvelope,
              );
          if (!validation.ok) {
            const error = new Error(
              validation.code === "TIMELINE_STALE"
                ? "checkpoint timeline is stale; refresh before retrying"
                : "checkpoint timeline submission was rejected",
            );
            error.code = validation.code;
            throw error;
          }
          const authoritativeSubmission = validation.submission;
          const checkpointIdentity =
            authoritativeSubmission.checkpointIdentity || null;
          let codePreview = null;
          if (isCodeRestoreAction(authoritativeSubmission.action)) {
            if (!checkpointIdentity) {
              const error = new Error(
                "checkpoint immutable identity is unavailable; refresh or recreate it",
              );
              error.code = "TIMELINE_CHECKPOINT_IDENTITY_INVALID";
              throw error;
            }
            codePreview = engine.status(authoritativeSubmission.checkpointId, {
              expectedIdentity: checkpointIdentity,
              includeWorkspaceBinding: true,
            });
          }
          const authoritativePlan = planCheckpointTimelineAction({
            timeline: authoritativeContext.timeline,
            submission: authoritativeSubmission,
            messages: authoritativeContext.messages,
            codePreview,
          });
          if (!authoritativePlan.ok) {
            const error = new Error(
              authoritativePlan.code === "TIMELINE_STALE"
                ? "checkpoint timeline is stale; refresh before retrying"
                : "checkpoint timeline submission was rejected",
            );
            error.code = authoritativePlan.code;
            throw error;
          }
          return {
            submission: authoritativeSubmission,
            planned: authoritativePlan,
            codePreview,
          };
        };

        let context = loadTimelineContext(engine, options.session);
        let { submission, planned } = planForContext(context);
        if (options.preview) {
          output = planned.preview;
          printTimelineActionResult(output, options.json);
          return;
        }

        if (
          !checkpointTimelineConfirmationsMatch(
            planned.preview.confirmationSubmission,
            submittedEnvelope,
          )
        ) {
          const error = new Error(
            isCodeRestoreAction(submission.action)
              ? "workspace changed after checkpoint preview; preview again"
              : "timeline confirmation no longer matches the current plan",
          );
          error.code = isCodeRestoreAction(submission.action)
            ? "TIMELINE_WORKSPACE_STALE"
            : "TIMELINE_CONFIRMATION_INVALID";
          throw error;
        }

        let checkpointIdentity = submission.checkpointIdentity || null;
        let restoreExecution = null;
        let restoreOperationId = null;

        const executeUnderSessionAuthority = ({
          operationId = null,
          workspaceLease = null,
          commitIntent = null,
          restoreWorkspace = null,
        } = {}) => {
          let durableSessionCommitHash = null;
          const transactionResult = withSessionAuthorityTransaction(
            options.session,
            context.headHash,
            (transaction) => {
              workspaceLease?.assertOwned();
              const intent = transaction.appendAuthorityEvent(
                CHECKPOINT_TIMELINE_INTENT_EVENT,
                {
                  ...(operationId ? { operationId } : {}),
                  revision: context.timeline.revision,
                  action: submission.action,
                  turnId: submission.turnId,
                  checkpointId: submission.checkpointId || null,
                  checkpointIdentity,
                  workspaceDir: dir,
                  workspaceScopeIdentity:
                    planned.workspaceBinding?.scopeIdentity || null,
                  workspacePrestateIdentity:
                    planned.workspaceBinding?.prestateIdentity || null,
                  workspaceWritePlanIdentity:
                    planned.workspaceBinding?.writePlanIdentity || null,
                  workspaceTargetPoststateIdentity:
                    planned.workspaceBinding?.targetPoststateIdentity || null,
                  confirmationDigest:
                    planned.preview.confirmationSubmission.digest,
                },
              );
              const result = {};
              try {
                if (commitIntent) {
                  try {
                    commitIntent(
                      checkpointRestoreDigest(
                        "cc-checkpoint-restore-intent-commit-v1",
                        intent.hash,
                      ),
                    );
                  } catch (error) {
                    // The transcript intent append precedes the short saga CAS.
                    // If the CAS fails, recovery must reconcile the durable
                    // transcript instead of treating this as a pre-intent abort.
                    if (error && typeof error === "object") {
                      error.checkpointRestoreSessionIntentCommitted = true;
                      // Let the orchestrator attach the post-settlement saga
                      // position rather than leaking this failed CAS's stale
                      // prepared-phase snapshot as the recovery status.
                      error.checkpointRestoreSagaPhase = null;
                      error.checkpointRestoreSagaSeq = null;
                      error.checkpointRestoreSagaHeadHash = null;
                    }
                    throw error;
                  }
                }

                if (restoreWorkspace) {
                  workspaceLease?.assertOwned();
                  result.code = restoreWorkspace();
                  transaction.retainRecoveryEvidence({
                    safetyId: result.code?.safetyId,
                    safetyIdentity: result.code?.safetyIdentity,
                    safetyPlanIdentity: result.code?.safetyPlanIdentity,
                    safetyCoverage: result.code?.safetyCoverage,
                    restorePhase: "workspace-applied",
                    createdPaths: result.code?.createdPaths,
                  });
                  workspaceLease?.assertOwned();
                }

                if (planned.commit.branchPlan) {
                  result.branch = createBranchSession({
                    branchSessionId: planned.commit.branchPlan.branchSessionId,
                    parentSessionId: options.session,
                    parentTurnId: submission.turnId,
                    messages: planned.commit.messages,
                    meta: { title: `Branch of ${options.session}` },
                  });
                  transaction.retainRecoveryEvidence({
                    branchSessionId:
                      result.branch?.branchSessionId ||
                      planned.commit.branchPlan.branchSessionId,
                  });
                } else if (planned.commit.messages) {
                  context.binding.pruneFromOffset(
                    planned.commit.bindingPruneOffset,
                  );
                  const committed = transaction.appendAuthorityEvent(
                    TURN_BINDING_TIMELINE_EVENT,
                    {
                      ...(operationId ? { operationId } : {}),
                      action: submission.action,
                      sourceRevision: context.timeline.revision,
                      turnId: submission.turnId,
                      messages: planned.commit.messages,
                      binding: context.binding.toJSON(),
                    },
                  );
                  result.conversation = {
                    messages: planned.commit.messages.length,
                    commitHash: committed.hash,
                  };
                }

                workspaceLease?.assertOwned();
                const completedAudit = transaction.appendAuthorityEvent(
                  CHECKPOINT_TIMELINE_AUDIT_EVENT,
                  {
                    ...(operationId ? { operationId } : {}),
                    revision: context.timeline.revision,
                    action: submission.action,
                    turnId: submission.turnId,
                    checkpointId: submission.checkpointId || null,
                    checkpointIdentity,
                    workspaceDir: dir,
                    workspaceScopeIdentity:
                      planned.workspaceBinding?.scopeIdentity || null,
                    workspacePrestateIdentity:
                      planned.workspaceBinding?.prestateIdentity || null,
                    workspaceWritePlanIdentity:
                      planned.workspaceBinding?.writePlanIdentity || null,
                    workspaceTargetPoststateIdentity:
                      planned.workspaceBinding?.targetPoststateIdentity || null,
                    confirmationDigest:
                      planned.preview.confirmationSubmission.digest,
                    status: "completed",
                    branchSessionId: result.branch?.branchSessionId || null,
                    safetyCheckpointId: result.code?.safetyId || null,
                    safetyCheckpointIdentity:
                      result.code?.safetyIdentity || null,
                    safetyPlanIdentity: result.code?.safetyPlanIdentity || null,
                    safetyCoverage: result.code?.safetyCoverage || null,
                  },
                );
                durableSessionCommitHash = completedAudit.hash;
              } catch (error) {
                if (error && typeof error === "object") {
                  error.safetyId ||= result.code?.safetyId || null;
                  error.safetyIdentity ||= result.code?.safetyIdentity || null;
                  error.safetyPlanIdentity ||=
                    result.code?.safetyPlanIdentity || null;
                  error.safetyCoverage ||= result.code?.safetyCoverage || null;
                  if (result.code && !error.restorePhase) {
                    error.restorePhase = "workspace-applied";
                  }
                  if (!Array.isArray(error.createdPaths)) {
                    error.createdPaths = Array.isArray(
                      result.code?.createdPaths,
                    )
                      ? [...result.code.createdPaths]
                      : [];
                  }
                  error.branchSessionId ||=
                    result.branch?.branchSessionId ||
                    planned.commit.branchPlan?.branchSessionId ||
                    null;
                }
                try {
                  transaction.appendAuthorityEvent(
                    CHECKPOINT_TIMELINE_AUDIT_EVENT,
                    {
                      ...(operationId ? { operationId } : {}),
                      revision: context.timeline.revision,
                      action: submission.action,
                      turnId: submission.turnId,
                      checkpointId: submission.checkpointId || null,
                      checkpointIdentity,
                      workspaceDir: dir,
                      workspaceScopeIdentity:
                        planned.workspaceBinding?.scopeIdentity || null,
                      workspacePrestateIdentity:
                        planned.workspaceBinding?.prestateIdentity || null,
                      workspaceWritePlanIdentity:
                        planned.workspaceBinding?.writePlanIdentity || null,
                      workspaceTargetPoststateIdentity:
                        planned.workspaceBinding?.targetPoststateIdentity ||
                        null,
                      confirmationDigest:
                        planned.preview.confirmationSubmission.digest,
                      status: "failed",
                      failureCode: checkpointRestoreErrorCode(error),
                      workspaceState: restoreWorkspace
                        ? "unknown"
                        : "unchanged",
                      branchSessionId:
                        result.branch?.branchSessionId ||
                        planned.commit.branchPlan?.branchSessionId ||
                        null,
                      safetyCheckpointId:
                        result.code?.safetyId || error?.safetyId || null,
                      safetyCheckpointIdentity:
                        result.code?.safetyIdentity ||
                        error?.safetyIdentity ||
                        null,
                      safetyPlanIdentity:
                        result.code?.safetyPlanIdentity ||
                        error?.safetyPlanIdentity ||
                        null,
                      safetyCoverage:
                        result.code?.safetyCoverage ||
                        error?.safetyCoverage ||
                        null,
                      createdPaths: Array.isArray(error?.createdPaths)
                        ? error.createdPaths.slice(0, 256)
                        : [],
                    },
                  );
                } catch (auditError) {
                  // An authority append can fail after bytes reach the transcript.
                  // Retain the first operation error as the transaction's nested
                  // diagnosis and let a poisoned writer/final settlement report
                  // commitState=unknown instead of appending from a stale head.
                  if (error && typeof error === "object") {
                    error.checkpointAuditError = auditError;
                  }
                }
                throw error;
              }
              return result;
            },
          );

          if (operationId) {
            workspaceLease?.assertOwned();
            if (!durableSessionCommitHash) {
              const error = new Error(
                "checkpoint restore session settlement hash is unavailable",
              );
              error.code = "CHECKPOINT_RESTORE_SESSION_BOUNDARY_MISSING";
              error.commitState = "unknown";
              throw error;
            }
            return {
              result: transactionResult,
              sessionCommitDigest: checkpointRestoreDigest(
                "cc-checkpoint-restore-session-commit-v1",
                durableSessionCommitHash,
              ),
            };
          }
          return transactionResult;
        };

        const buildTimelineRestorePlan = () => {
          const workspaceRoot = planned.workspaceBinding?.workspaceRoot;
          if (!workspaceRoot) {
            throw workspaceStaleError(
              "checkpoint restore scope is unavailable; preview again",
            );
          }
          return {
            restoreKind: engine.kind,
            restoreSurface: "timeline",
            checkpointId: submission.checkpointId,
            checkpointIdentity,
            checkpointNamespace: options.session,
            workspaceRoot,
            workspaceBinding: planned.workspaceBinding,
            targetCount: checkpointRestoreTargetCount(planned),
            confirmationDigest: planned.preview.confirmationSubmission.digest,
            sessionId: options.session,
            timelineEntryId: submission.turnId,
          };
        };

        let result;
        if (isCodeRestoreAction(submission.action)) {
          const initialRestorePlan = buildTimelineRestorePlan();
          restoreExecution = runCheckpointRestore({
            plan: initialRestorePlan,
            revalidate: () => {
              // Both the session head and the full workspace write plan can
              // change while this process waits for the workspace lock.
              const lockedContext = loadTimelineContext(
                engine,
                options.session,
              );
              const lockedAction = planForContext(lockedContext);
              if (
                !checkpointTimelineConfirmationsMatch(
                  lockedAction.planned.preview.confirmationSubmission,
                  submittedEnvelope,
                )
              ) {
                throw workspaceStaleError(
                  "workspace or checkpoint timeline changed while waiting for the restore lock; preview again",
                );
              }
              context = lockedContext;
              submission = lockedAction.submission;
              planned = lockedAction.planned;
              checkpointIdentity = submission.checkpointIdentity || null;
              return buildTimelineRestorePlan();
            },
            restore: ({ expectedIdentity, expectedWorkspaceBinding, hooks }) =>
              engine.restore(submission.checkpointId, {
                expectedIdentity,
                expectedWorkspaceBinding,
                ...hooks,
              }),
            withSessionAuthority: (authority) => {
              try {
                return executeUnderSessionAuthority(authority);
              } catch (error) {
                const retained = error?.transactionRecoveryEvidence;
                if (
                  error &&
                  typeof error === "object" &&
                  retained &&
                  typeof retained === "object"
                ) {
                  error.safetyId ||= retained.safetyId || null;
                  error.safetyIdentity ||= retained.safetyIdentity || null;
                  error.safetyPlanIdentity ||=
                    retained.safetyPlanIdentity || null;
                  error.safetyCoverage ||= retained.safetyCoverage || null;
                  error.restorePhase ||= retained.restorePhase || null;
                }
                throw error;
              }
            },
            dependencies: {
              withWorkspaceLockSync,
              createSagaStore: createCheckpointRestoreSagaStore,
              computeWorkspaceLockOwnerDigest: workspaceLockOwnerDigest,
            },
          });
          restoreOperationId = restoreExecution.operationId;
          result = restoreExecution.result;
        } else {
          result = executeUnderSessionAuthority();
        }
        let nextContext = null;
        let nextContextWarning = null;
        try {
          nextContext = loadTimelineContext(engine, options.session);
        } catch (reloadError) {
          if (restoreExecution?.saga?.phase !== "completed") throw reloadError;
          nextContextWarning = boundedCheckpointRestoreText(
            `restore completed, but the next timeline revision could not be reloaded: ${reloadError?.code || reloadError?.message || "reload failed"}`,
            "restore completed, but the next timeline revision could not be reloaded",
            512,
          );
        }
        output = {
          schema: CHECKPOINT_TIMELINE_RESULT_SCHEMA,
          version: CHECKPOINT_TIMELINE_RESULT_VERSION,
          ok: true,
          mode: "executed",
          action: submission.action,
          sessionId: options.session,
          turnId: submission.turnId,
          revision: context.timeline.revision,
          nextRevision: nextContext?.timeline?.revision || null,
          ...(restoreOperationId ? { operationId: restoreOperationId } : {}),
          result,
          warnings: [
            ...planned.preview.warnings,
            ...(restoreExecution?.warnings || []),
            ...(nextContextWarning ? [nextContextWarning] : []),
          ],
        };
        printTimelineActionResult(output, options.json);
      } catch (error) {
        output = timelineActionError(error);
        printTimelineActionResult(output, options.json);
        process.exitCode = 1;
      }
    });

  cp.command("show <id>")
    .description("Show a checkpoint's files, or its diff vs current state")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--diff", "Compare snapshot against current on-disk files")
    .option("--stat", "With --diff: summary (diffstat) instead of full patch")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);

        if (options.diff) {
          const text = engine.diffText(id, { stat: options.stat });
          if (text != null) {
            if (options.json) {
              console.log(JSON.stringify({ id, diff: text }, null, 2));
              return;
            }
            if (!text.trim()) logger.info(`No changes since checkpoint ${id}.`);
            else logger.log(text);
            return;
          }
          const d = engine.status(id);
          if (options.json) {
            console.log(JSON.stringify({ id, ...d }, null, 2));
            return;
          }
          logger.log(chalk.bold(`Diff vs current — ${id}`));
          logger.log(`  ${chalk.yellow("modified")}: ${d.modified.length}`);
          d.modified.forEach((f) => logger.log(chalk.yellow(`    M ${f}`)));
          logger.log(`  ${chalk.red("deleted")}:  ${d.deleted.length}`);
          d.deleted.forEach((f) => logger.log(chalk.red(`    D ${f}`)));
          return;
        }

        const m = engine.show(id);
        if (options.json) {
          console.log(JSON.stringify(m, null, 2));
          return;
        }
        logger.log(chalk.bold(`Checkpoint ${m.id}`) + ` ${tag(engine)}`);
        if (m.label) logger.log(chalk.gray(`  label: ${m.label}`));
        logger.log(
          chalk.gray(`  created: ${m.createdAt}  files: ${m.fileCount}`),
        );
        for (const f of m.files) {
          logger.log(`  ${chalk.gray(String(f.bytes).padStart(8))}  ${f.rel}`);
        }
      } catch (err) {
        logger.error(chalk.red(`checkpoint show failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("restore <id>")
    .alias("rewind")
    .description(
      "Restore files from a checkpoint (auto-snapshots current state first)",
    )
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--dry-run", "Show what would change without writing")
    .option("--force", "Restore without the interactive confirm prompt")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);

        if (options.dryRun) {
          const r = engine.restore(id, { dryRun: true });
          if (options.json) {
            console.log(JSON.stringify(r, null, 2));
            return;
          }
          logger.log(chalk.bold(`Dry-run restore — ${id}`));
          logger.log(`  would restore: ${r.restoredCount} file(s)`);
          if (typeof r.deleted === "number") {
            logger.log(`  would remove:  ${r.deleted} file(s) created since`);
          }
          return;
        }

        // Destructive: bind the exact workspace state that is displayed (or
        // immediately preflighted for --force), then require the engine to
        // observe the same full state before safety creation or file writes.
        // Require --force when not a TTY; prompt when interactive.
        const restorePreview = engine.status(id, {
          includeWorkspaceBinding: true,
        });
        if (!options.force) {
          const willChange =
            restorePreview.modified.length +
            restorePreview.deleted.length +
            (restorePreview.added?.length || 0);
          if (process.stdin.isTTY) {
            const { confirm } = await import("@inquirer/prompts");
            const ok = await confirm({
              message: `Restore ${id}? ${willChange} file(s) affected (a safety checkpoint is taken first).`,
              default: false,
            }).catch(() => false);
            if (!ok) {
              logger.log(chalk.gray("Aborted."));
              return;
            }
          } else {
            logger.error(
              chalk.red(
                `Refusing to restore without --force (non-interactive). ${willChange} file(s) would change. Re-run with --dry-run to preview or --force to proceed.`,
              ),
            );
            process.exitCode = 1;
            return;
          }
        }

        const authorization = options.force ? "force" : "interactive";
        const initialPlan = directRestorePlan({
          engine,
          checkpointId: id,
          checkpointNamespace: options.session,
          preview: restorePreview,
          authorization,
        });
        const execution = runCheckpointRestore({
          plan: initialPlan,
          revalidate: () => {
            const lockedPreview = engine.status(id, {
              expectedIdentity: initialPlan.checkpointIdentity,
              includeWorkspaceBinding: true,
            });
            return directRestorePlan({
              engine,
              checkpointId: id,
              checkpointNamespace: options.session,
              preview: lockedPreview,
              authorization,
            });
          },
          restore: ({ expectedIdentity, expectedWorkspaceBinding, hooks }) =>
            engine.restore(id, {
              expectedIdentity,
              expectedWorkspaceBinding,
              ...hooks,
            }),
          dependencies: {
            withWorkspaceLockSync,
            createSagaStore: createCheckpointRestoreSagaStore,
            computeWorkspaceLockOwnerDigest: workspaceLockOwnerDigest,
          },
        });
        const r = execution.result;
        const directOutput = {
          ...r,
          operationId: execution.operationId,
          phase: execution.saga.phase,
          warnings: execution.warnings,
        };
        if (options.json) {
          console.log(JSON.stringify(directOutput, null, 2));
          return;
        }
        logger.log(
          chalk.green(`✓ restored ${r.restoredCount} file(s) from ${id}`) +
            (typeof r.deleted === "number" && r.deleted > 0
              ? chalk.gray(`  (${r.deleted} removed)`)
              : ""),
        );
        if (r.safetyId) {
          logger.log(
            chalk.gray(
              `  safety checkpoint of prior state: ${r.safetyId}` +
                ` (undo with: cc checkpoint restore ${r.safetyId}` +
                (options.session !== "default"
                  ? ` -s ${options.session}`
                  : "") +
                `)`,
            ),
          );
        }
        if (r.missingBlob && r.missingBlob.length) {
          logger.log(
            chalk.red(`  missing blobs (skipped): ${r.missingBlob.join(", ")}`),
          );
        }
        logger.log(
          chalk.gray(
            `  restore operation: ${execution.operationId} (${execution.saga.phase})`,
          ),
        );
        for (const warning of execution.warnings) {
          logger.log(chalk.yellow(`  ${warning}`));
        }
      } catch (err) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: false,
                code: err?.code || "CHECKPOINT_RESTORE_FAILED",
                error: err?.message || String(err),
                operationId:
                  err?.checkpointRestoreOperationId || err?.operationId || null,
                phase: err?.checkpointRestoreSagaPhase || null,
                blockingOperationId:
                  err?.ownerTransactionId ||
                  err?.retainedOwner?.transactionId ||
                  err?.priorOwner?.transactionId ||
                  null,
                recoveryRequired: Boolean(
                  err?.checkpointRestoreRecoveryRequired ||
                  err?.workspaceLockRetained,
                ),
                workspaceLockRetained: err?.workspaceLockRetained === true,
              },
              null,
              2,
            ),
          );
        } else {
          logger.error(chalk.red(`checkpoint restore failed: ${err.message}`));
        }
        process.exitCode = 1;
      }
    });

  cp.command("delete <id>")
    .alias("rm")
    .description("Delete a checkpoint")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        if (!options.force && process.stdin.isTTY) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete checkpoint ${id}?`,
            default: false,
          }).catch(() => false);
          if (!ok) {
            logger.log(chalk.gray("Aborted."));
            return;
          }
        }
        const existed = engine.remove(id);
        if (!existed) {
          logger.error(chalk.red(`no such checkpoint: ${id}`));
          process.exitCode = 1;
          return;
        }
        logger.log(chalk.green(`✓ deleted ${id}`));
      } catch (err) {
        logger.error(chalk.red(`checkpoint delete failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  cp.command("clear")
    .description("Delete all checkpoints (in a session, for the git engine)")
    .option("-d, --dir <dir>", "Target directory", ".")
    .option("-s, --session <id>", "Checkpoint session (git engine)", "default")
    .option("--force", "Skip confirmation")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        const engine = await pickEngine(dir, options.session);
        if (!options.force && process.stdin.isTTY) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete ALL checkpoints${engine.kind === "git" ? ` in session "${options.session}"` : ""}?`,
            default: false,
          }).catch(() => false);
          if (!ok) {
            logger.log(chalk.gray("Aborted."));
            return;
          }
        }
        const removed = engine.clear();
        if (options.json) {
          console.log(
            JSON.stringify({ removed, engine: engine.kind }, null, 2),
          );
          return;
        }
        logger.log(chalk.green(`✓ removed ${removed} checkpoint(s)`));
      } catch (err) {
        logger.error(chalk.red(`checkpoint clear failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
