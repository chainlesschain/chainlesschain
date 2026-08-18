/**
 * background-agent-worker — detached supervisor process for one background
 * session. Spawns the agent CLI child with output to the session log, keeps a
 * heartbeat in the state file, and (since batch 10) hosts a local session
 * transport so `cc attach <id>` can send follow-up prompts interactively.
 *
 * Turn loop: the initial task runs as turn 1. While a client is attached the
 * worker stays alive between turns (phase "idle"); a received prompt starts
 * the next turn via `job.followUpArgv + ["-p", text]` on the same session id
 * (headless `--session` resumes the conversation). The worker finalizes and
 * exits only when the current turn has ended, the prompt queue is empty, and
 * no client is attached.
 */

import { readFileSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_STALE_MS,
  backgroundAgentsDir,
  claimBackgroundAgentHeartbeat,
  deliverBackgroundNeedsInputNotification,
  insertArgumentsBeforeOptionTerminator,
  mutateBackgroundAgentState,
  openBackgroundLogFile,
  readBackgroundAgentState,
  removeJobFile,
  stopBackgroundAgentChildTree,
} from "../lib/background-agent-supervisor.js";
import { startBackgroundSessionServer } from "../lib/background-session-transport.js";
import { idlePhaseFor } from "../lib/background-agent-phase.js";
import { attachInteractionRequestHandler } from "../lib/background-interaction-resolver.js";
import {
  classifyLateBackgroundInteractionSettlement,
  loadBackgroundInteractionJournal,
  rejectPendingBackgroundInteractions,
  updateBackgroundInteractionJournal,
} from "../lib/background-interaction-journal.js";
import executionBroker from "../lib/process-execution-broker/index.js";
import { agentPrintArgument } from "../lib/background-command-argv.js";
import {
  shouldRetryOwnedProcessTreeTermination,
  terminateOwnedProcessTree,
} from "../lib/process-tree-termination.js";
import {
  closeNeedsInputIncident,
  createNeedsInputIncident,
} from "../lib/background-needs-input-incident.js";
import {
  withSessionHostDelegatedWriteAuthority,
  withSessionHostRecoveryLease,
} from "../lib/session-host-lease.js";
import {
  BACKGROUND_TURN_BOOTSTRAP_ENV,
  BACKGROUND_TURN_BOOTSTRAP_READY,
  BACKGROUND_TURN_BOOTSTRAP_RELEASE,
  createBackgroundTurnBootstrapMessage,
  matchesBackgroundTurnBootstrapMessage,
  normalizeBackgroundTurnBootstrapAuthority,
  normalizeBackgroundTurnBootstrapBinding,
} from "../lib/background-turn-bootstrap-protocol.js";
import { connectBackgroundAgentKeeper } from "../lib/background-agent-keeper-client.js";

const TURN_BOOTSTRAP_MODULE_URL = new URL(
  "./background-turn-bootstrap.js",
  import.meta.url,
).href;
const TURN_BOOTSTRAP_IMPORT_ARGUMENT = `--import=${TURN_BOOTSTRAP_MODULE_URL}`;

const jobFile = process.argv[2];
let job;
let log;
let server = null;
let child = null;
let heartbeat = null;
let finalized = false;
let phase = "turn";
let turnCount = 0;
let lastExit = { code: 0, signal: null };
let transportState = null;
let detachInteractionHandler = null;
let detachTurnBootstrapHandler = null;
let keeperClient = null;
let activeKeeperTurn = null;
let interactionJournal = null;
let interactionFinalSweep = null;
let turnLaunchUncertainty = null;
let turnLaunchSettlement = null;
let initialTurnStarted = false;
const promptQueue = [];
// P0-2: 保存 pending 的交互请求，等 attach 客户端连接后转发
const pendingInteractions = new Map();

// Backpressure (Gap 4): an attached client can push prompts faster than
// turns drain — an unbounded queue grows without limit and every entry is a
// future agent turn. Past the cap the prompt is REJECTED (the transport
// relays the throw as {type:"error", message}) instead of silently queued.
const MAX_PROMPT_QUEUE = 100;

/**
 * Bind one idempotent termination settlement to a turn child.
 *
 * Node normally emits `exit` before `close`, but a spawn/runtime error can
 * produce `error` followed only by `close`. Treat `error` as diagnostic (it
 * does not prove process death) and settle when either terminal event arrives.
 * The first terminal event wins, so the ordinary exit->close sequence cannot
 * run journal recovery or finalization twice.
 *
 * Exported only so the event-order contract can be exercised without booting
 * the detached worker process.
 */
export function attachTurnChildTerminationSettlement(
  childProcess,
  settleTermination,
) {
  if (!childProcess || typeof childProcess.once !== "function") {
    throw new TypeError("turn child must be an EventEmitter-like process");
  }
  if (typeof settleTermination !== "function") {
    throw new TypeError("turn child termination callback is required");
  }

  let settled = false;
  let observedError = null;
  const settleOnce = (source, code, signal) => {
    if (settled) return false;
    settled = true;
    settleTermination(
      Object.freeze({
        source,
        code: observedError ? 1 : (code ?? null),
        signal: signal || null,
        error: observedError,
        errorMessage: observedError?.message || null,
      }),
    );
    return true;
  };
  const onError = (error) => {
    observedError ||= error instanceof Error ? error : new Error(String(error));
  };
  const onExit = (code, signal) => settleOnce("exit", code, signal);
  const onClose = (code, signal) => settleOnce("close", code, signal);

  childProcess.once("error", onError);
  childProcess.once("exit", onExit);
  childProcess.once("close", onClose);

  return () => {
    childProcess.off?.("error", onError);
    childProcess.off?.("exit", onExit);
    childProcess.off?.("close", onClose);
  };
}

/**
 * Release a pre-main turn child only after its actual runtime PID is durably
 * committed and every worker listener needed to supervise it is installed.
 * The ChildProcess PID may name a Windows sandbox helper, so the actual Node
 * PID arrives over the nonce-bound private IPC channel instead of being
 * inferred from `child.pid`.
 */
export function attachTurnChildBootstrapRelease(
  childProcess,
  authority,
  commitReady,
  onFailure = () => {},
) {
  if (!childProcess || typeof childProcess.on !== "function") {
    throw new TypeError("turn bootstrap child must expose message events");
  }
  if (typeof childProcess.send !== "function") {
    throw new TypeError("turn bootstrap child must expose dedicated IPC");
  }
  if (typeof commitReady !== "function") {
    throw new TypeError("turn bootstrap durable commit callback is required");
  }
  if (typeof onFailure !== "function") {
    throw new TypeError("turn bootstrap failure callback must be a function");
  }
  const expected = normalizeBackgroundTurnBootstrapAuthority(authority);
  let releasedBinding = null;
  let pendingBinding = null;
  let failed = false;
  let detached = false;

  const failOnce = (error) => {
    if (failed || detached) return;
    failed = true;
    onFailure(error instanceof Error ? error : new Error(String(error)));
  };
  const onMessage = (message) => {
    if (message?.type !== BACKGROUND_TURN_BOOTSTRAP_READY) return;
    if (
      !matchesBackgroundTurnBootstrapMessage(
        message,
        BACKGROUND_TURN_BOOTSTRAP_READY,
        expected,
      )
    ) {
      failOnce(new Error("background turn bootstrap ready binding mismatch"));
      return;
    }
    const readyBinding = normalizeBackgroundTurnBootstrapBinding(message);
    if (releasedBinding) {
      if (readyBinding.pid !== releasedBinding.pid) {
        failOnce(new Error("background turn bootstrap runtime pid changed"));
      }
      // READY is retransmitted until the child observes RELEASE. Matching
      // duplicates are idempotent; never answer with a second RELEASE.
      return;
    }
    if (pendingBinding) {
      if (readyBinding.pid !== pendingBinding.pid) {
        failOnce(new Error("background turn bootstrap runtime pid changed"));
      }
      return;
    }
    pendingBinding = readyBinding;
    Promise.resolve()
      .then(() => commitReady(readyBinding))
      .then((committed) => {
        if (failed || detached) return;
        if (committed !== true) {
          failOnce(
            new Error("background turn runtime pid commit was rejected"),
          );
          return;
        }
        releasedBinding = readyBinding;
        try {
          childProcess.send(
            createBackgroundTurnBootstrapMessage(
              BACKGROUND_TURN_BOOTSTRAP_RELEASE,
              readyBinding,
            ),
            (error) => {
              if (error) failOnce(error);
            },
          );
        } catch (error) {
          failOnce(error);
        }
      })
      .catch(failOnce);
  };
  const detach = () => {
    if (detached) return;
    detached = true;
    childProcess.off?.("message", onMessage);
  };

  childProcess.on("message", onMessage);
  childProcess.once?.("exit", detach);
  childProcess.once?.("disconnect", detach);
  return detach;
}

/**
 * Deliver an already-durable interaction outcome after best-effort cleanup of
 * the worker-state projection.
 *
 * The transcript journal is the settlement authority. Once it contains the
 * terminal answer, failure to clear the rebuildable state projection (or to
 * persist its diagnostic marker) must not strand the child that is waiting
 * for that answer.
 */
export function deliverAfterDurableInteractionCleanup({
  cleanupProjection,
  recordCleanupFailure,
  detachAbort,
  deliver,
}) {
  if (typeof deliver !== "function") {
    throw new TypeError("durable interaction delivery callback is required");
  }

  let cleanupError = null;
  try {
    cleanupProjection?.();
  } catch (error) {
    cleanupError = error;
    try {
      recordCleanupFailure?.(error);
    } catch {
      // The canonical terminal journal remains the answer authority even when
      // both the state cleanup and its rebuildable diagnostic marker fail.
    }
  }

  try {
    detachAbort?.();
  } catch {
    // Listener cleanup is also subordinate to delivering the durable answer.
  }
  deliver();
  return { cleanupError };
}

/**
 * Spawn a pre-main-blocked turn only after its launch intent is durable, then
 * commit the exact child identity in a short state transaction.
 *
 * Native process creation can block under sustained process churn. It must not
 * run inside the cross-process state lock: a concurrent stop still observes
 * the durable launch intent, while the bootstrap child cannot enter Agent main
 * until the later PID commit releases it. If stop wins the commit race, retain
 * the exact spawned child so the launch-settlement path can retire it.
 */
export function spawnTurnAfterDurableIntent({
  spawnTurn,
  commitSpawn,
  now = Date.now,
}) {
  if (typeof spawnTurn !== "function" || typeof commitSpawn !== "function") {
    throw new TypeError(
      "background turn spawn and commit callbacks are required",
    );
  }
  const agentStartedAt = now();
  let spawned = null;
  try {
    spawned = spawnTurn();
  } catch (error) {
    return Object.freeze({
      committed: false,
      spawned: error?.spawnedProcess || null,
      agentStartedAt,
      error,
    });
  }
  try {
    const mutation = commitSpawn(spawned, agentStartedAt);
    if (!mutation?.applied) {
      return Object.freeze({
        committed: false,
        spawned,
        agentStartedAt,
        mutation: mutation || null,
        error: new Error("background turn was stopped before PID commit"),
      });
    }
    return Object.freeze({
      committed: true,
      spawned,
      agentStartedAt,
      mutation,
      error: null,
    });
  } catch (error) {
    return Object.freeze({
      committed: false,
      spawned: spawned || error?.spawnedProcess || null,
      agentStartedAt,
      error,
    });
  }
}

function updateInteractionJournal(mutate, options = {}) {
  const {
    sessionHostWriteDelegation = null,
    expectedOwnerPid,
    ...journalOptions
  } = options;
  const update = () =>
    updateBackgroundInteractionJournal(
      job.sessionId,
      interactionJournal,
      mutate,
      journalOptions,
    );
  // Live child interaction writes always require the exact lease delegated by
  // that child. Recovery is the only exception and uses its own acquired lease
  // outside this helper; never fall back to legacy no-lease write authority.
  const mutation = withSessionHostDelegatedWriteAuthority(
    job.sessionId,
    sessionHostWriteDelegation,
    update,
    { expectedOwnerPid },
  );
  interactionJournal = mutation.journal;
  return mutation.result;
}

function persistInteractionSettlement(
  requestId,
  binding,
  outcome,
  authority = {},
) {
  return updateInteractionJournal(
    (draft) => draft.settle(requestId, binding, outcome),
    { ...authority, persistIf: (result) => result.applied },
  );
}

function beginFinalInteractionSweep(continuation) {
  if (interactionFinalSweep) return;
  if (!job?.sessionId || !interactionJournal) {
    continuation();
    return;
  }
  const context = {
    attempts: 0,
    timer: null,
    continuation,
  };
  interactionFinalSweep = context;

  const attempt = () => {
    if (interactionFinalSweep !== context) return;
    context.attempts += 1;
    try {
      // Reload from the canonical transcript under a fresh lease after the
      // child is proven dead. This deliberately ignores the worker's cached
      // journal: an earlier append may have reported commitState=unknown even
      // though its pending snapshot reached disk.
      const recovery = withSessionHostRecoveryLease(job.sessionId, () =>
        rejectPendingBackgroundInteractions(job.sessionId, job.id, {
          code: "INTERACTION_CHILD_EXITED",
          message: "The agent child exited before the interaction settled",
        }),
      );
      interactionJournal = recovery.journal;
      phase = "turn";
      mergeState({
        phase,
        pendingQuestion: null,
        interactionRecovery: {
          status: recovery.changed ? "rejected" : "clean",
          requestIds: recovery.rejected.map((record) => record.requestId),
          recoveredAt: Date.now(),
          attempts: context.attempts,
          turn: turnCount,
          workerGeneration: job.workerGeneration,
        },
      });
      interactionFinalSweep = null;
      context.continuation();
    } catch (error) {
      phase = "interaction_recovery";
      const retryMs = Math.min(
        5_000,
        250 * 2 ** Math.min(context.attempts - 1, 4),
      );
      mergeState({
        phase,
        pendingQuestion: null,
        interactionRecovery: {
          status: "failed",
          code: error?.code || "INTERACTION_RECOVERY_FAILED",
          message: error?.message || String(error),
          failedAt: Date.now(),
          attempts: context.attempts,
          retryAfterMs: retryMs,
          turn: turnCount,
          workerGeneration: job.workerGeneration,
        },
      });
      context.timer = setTimeout(attempt, retryMs);
    }
  };
  attempt();
}

function mutateWorkerState(updater) {
  return mutateBackgroundAgentState(job.id, (current) => {
    if (!current || current.status !== "running" || current.stopRequestedAt) {
      return null;
    }
    return updater(current);
  });
}

function mergeState(patch) {
  return mutateWorkerState((current) => ({
    ...current,
    id: job.id,
    ...patch,
  })).state;
}

function writeHeartbeat() {
  const mutation = claimBackgroundAgentHeartbeat(job.id, {
    workerGeneration: job.workerGeneration,
    pid: process.pid,
    workerPid: process.pid,
    ...(child?.pid ? { agentPid: child.pid } : {}),
    ...(turnLaunchUncertainty || {}),
    heartbeatAt: Date.now(),
    // Re-assert the transport endpoint so a launcher write racing the
    // worker's initial merge self-heals within one heartbeat.
    ...(transportState ? { transport: transportState } : {}),
  });
  const applied =
    mutation.applied &&
    mutation.state?.status === "running" &&
    Number(mutation.state.workerPid) === process.pid &&
    (!mutation.state.workerGeneration ||
      mutation.state.workerGeneration === job.workerGeneration);
  if (applied && turnLaunchSettlement?.termination?.confirmed === true) {
    scheduleTurnLaunchSettlementPersistence(0);
  }
  return applied;
}

async function waitForLaunchFinalization() {
  const deadline = Date.now() + DEFAULT_HEARTBEAT_STALE_MS;
  for (;;) {
    const current = readBackgroundAgentState(job.id);
    if (!current) return "terminal";
    if (current.status && current.status !== "running") return "terminal";
    if (current.launchFinalizationUncertain !== true) return "ready";
    if (Date.now() >= deadline) {
      mergeState({
        status: "failed",
        endedAt: Date.now(),
        exitCode: 1,
        error: "background launcher did not finalize process ownership",
        phase: null,
        transport: null,
        launchFinalizationUncertain: false,
      });
      return "timeout";
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function finalize(code, signal, errorMessage) {
  // A launch settlement owns the worker lifetime until its tree/no-spawn
  // result is durably recorded. Transport detach, a queued prompt, or a fatal
  // callback must not exit through finalize and strand that retry protocol.
  if (turnLaunchSettlement) return;
  // A child-death journal sweep is part of terminal durability. Keep the
  // worker and heartbeat alive until its fresh-lease reload either settles
  // every disk-visible pending request or persists retry evidence.
  if (interactionFinalSweep) return;
  if (finalized) return;
  finalized = true;
  clearInterval(heartbeat);
  try {
    mutateBackgroundAgentState(job.id, (current) => {
      if (!current) return null;
      const ownsRecord =
        (!current.workerGeneration ||
          current.workerGeneration === job.workerGeneration) &&
        (Number(current.workerClaimedPid) === process.pid ||
          (current.workerClaimedPid == null &&
            Number(current.workerPid ?? current.pid) === process.pid));
      if (!ownsRecord) return null;
      // An external stop/remove owns an already-terminal or deleted record.
      if (current.status !== "running") {
        return { ...current, phase: null, transport: null };
      }
      return {
        ...current,
        id: job.id,
        status: errorMessage ? "failed" : code === 0 ? "completed" : "failed",
        endedAt: Date.now(),
        exitCode: errorMessage ? (code ?? 1) : code,
        signal: signal || null,
        ...(errorMessage ? { error: errorMessage } : {}),
        phase: null,
        transport: null,
      };
    });
  } catch (error) {
    try {
      writeSync(
        2,
        `[background-agent-worker] final state persistence failed: ${
          error?.message || String(error)
        }\n`,
      );
    } catch {
      /* inherited stderr may already be closed */
    }
  }
  const done = () => {
    keeperClient?.close();
    keeperClient = null;
    try {
      log?.close();
    } catch {
      /* log fd already closed */
    }
    process.exit(errorMessage ? 1 : (code ?? 1));
  };
  if (server) {
    server.broadcast({ type: "closing" });
    server.close().then(done, done);
  } else {
    done();
  }
}

function scheduleTurnLaunchSettlementRetry(context, delayMs = 250) {
  if (
    !context ||
    turnLaunchSettlement !== context ||
    context.retryTimer ||
    (context.termination?.confirmed !== true &&
      context.terminationRetryBlocked === true)
  ) {
    return;
  }
  context.retryTimer = setTimeout(
    () => {
      context.retryTimer = null;
      if (turnLaunchSettlement !== context) return;
      if (context.termination?.confirmed === true) {
        persistConfirmedTurnLaunchSettlement(context);
      } else {
        void settleUncertainTurnLaunch(context);
      }
    },
    Math.max(0, delayMs),
  );
}

function scheduleTurnLaunchSettlementPersistence(delayMs = 100) {
  const context = turnLaunchSettlement;
  if (!context || context.termination?.confirmed !== true) return;
  scheduleTurnLaunchSettlementRetry(context, delayMs);
}

function persistConfirmedTurnLaunchSettlement(context) {
  try {
    mutateBackgroundAgentState(job.id, (current) => {
      const sameWorker =
        current?.workerGeneration === job.workerGeneration &&
        Number(current?.workerClaimedPid) === process.pid;
      const tokenMatches =
        current?.turnLaunchToken === context.turnLaunchToken ||
        current?.turnLaunchIntent?.token === context.turnLaunchToken;
      const ownedPid = Number(context.owned?.pid);
      if (
        !current ||
        (!tokenMatches && !sameWorker) ||
        (Number.isInteger(ownedPid) &&
          ownedPid > 0 &&
          current.agentPid != null &&
          Number(current.agentPid) !== ownedPid)
      ) {
        return null;
      }
      return {
        ...current,
        status: current.stopRequestedAt ? "stopped" : "failed",
        endedAt: current.endedAt || Date.now(),
        exitCode: current.exitCode ?? 1,
        error: `background turn launch failed after spawn: ${
          context.error?.message || "unknown post-spawn failure"
        }`,
        phase: null,
        transport: null,
        turnLaunchIntent: null,
        turnLaunchResolution: {
          token: context.turnLaunchToken,
          attempt: context.turnLaunchAttempt,
          outcome: context.owned ? "terminated" : "not-spawned",
          ...(context.owned ? { agentPid: ownedPid } : {}),
          resolvedAt: Date.now(),
        },
        turnLaunchFinalizationUncertain: false,
        turnLaunchToken: null,
        turnLaunchError: null,
        interactionRecovery: job.sessionId
          ? {
              status: "failed",
              code: "INTERACTION_TURN_LAUNCH_SETTLEMENT",
              message:
                "Turn launch settlement completed before interaction recovery",
              turn: Math.max(turnCount, context.turnLaunchAttempt),
              workerGeneration: job.workerGeneration,
              failedAt: Date.now(),
            }
          : current.interactionRecovery,
        turnLaunchTermination: {
          confirmed: true,
          treeMode: context.termination.treeMode || null,
          closed: context.termination.closed === true,
          treeTerminated: context.termination.treeTerminated === true,
          settledAt: Date.now(),
        },
      };
    });
    // A missing or incompatible record must not be recreated or retargeted.
    // The owned tree is already confirmed gone, so it is safe for this worker
    // to close even though the retained record (if any) stays fail-closed.
    clearInterval(context.keeper);
    turnLaunchUncertainty = null;
    turnLaunchSettlement = null;
    child = null;
    const finishLaunchFailure = () =>
      finalize(
        1,
        null,
        context.error?.message || "background turn launch failed",
      );
    if (context.owned && job.sessionId && interactionJournal) {
      turnCount = Math.max(turnCount, context.turnLaunchAttempt);
      beginFinalInteractionSweep(finishLaunchFailure);
    } else {
      finishLaunchFailure();
    }
  } catch {
    scheduleTurnLaunchSettlementPersistence();
  }
}

async function settleUncertainTurnLaunch(context) {
  if (!context || turnLaunchSettlement !== context || context.settling) return;
  if (context.termination?.confirmed === true) {
    persistConfirmedTurnLaunchSettlement(context);
    return;
  }
  if (
    !shouldRetryOwnedProcessTreeTermination(context.owned, context.termination)
  ) {
    context.terminationRetryBlocked = true;
    return;
  }
  context.settling = true;
  try {
    context.termination = await terminateOwnedProcessTree(context.owned, {
      treeMode: process.platform === "win32" ? "windows-tree" : "posix-group",
    });
  } catch (error) {
    context.terminationError = error?.message || String(error);
  } finally {
    context.settling = false;
  }
  if (context.termination?.confirmed === true) {
    persistConfirmedTurnLaunchSettlement(context);
    return;
  }
  if (
    !shouldRetryOwnedProcessTreeTermination(context.owned, context.termination)
  ) {
    // The root is closed but descendants were not proven gone. Its numeric
    // pid/pgid can now be reused, so another taskkill/kill would risk an
    // unrelated process tree. Retain the durable uncertainty and the keeper;
    // only explicit recovery with stronger identity evidence may proceed.
    context.terminationRetryBlocked = true;
    return;
  }
  context.terminationAttempts = Number(context.terminationAttempts || 0) + 1;
  const retryMs = Math.min(
    5_000,
    250 * 2 ** Math.min(context.terminationAttempts, 4),
  );
  scheduleTurnLaunchSettlementRetry(context, retryMs);
}

function beginTurnLaunchSettlement({
  owned,
  error,
  turnLaunchToken,
  turnLaunchAttempt,
  agentStartedAt,
}) {
  child = owned || null;
  phase = "turn_launch_uncertain";
  const ownedPid = Number(owned?.pid);
  turnLaunchUncertainty = {
    ...(owned
      ? { agentPid: ownedPid, agentStartedAt: agentStartedAt || Date.now() }
      : {}),
    phase,
    turnLaunchIntent: null,
    turnLaunchResolution: {
      token: turnLaunchToken,
      attempt: turnLaunchAttempt,
      outcome: owned ? "spawned" : "not-spawned",
      ...(owned ? { agentPid: ownedPid } : {}),
      resolvedAt: Date.now(),
    },
    turnLaunchFinalizationUncertain: true,
    turnLaunchError: error?.message || String(error),
    turnLaunchToken,
  };
  const settlement = {
    owned,
    error,
    turnLaunchToken,
    turnLaunchAttempt,
    termination: owned
      ? null
      : {
          confirmed: true,
          treeMode: "none",
          closed: true,
          treeTerminated: true,
        },
    terminationAttempts: 0,
    terminationRetryBlocked: false,
    settling: false,
    retryTimer: null,
    keeper: null,
  };
  settlement.keeper = setInterval(() => {
    if (turnLaunchSettlement !== settlement) return;
    if (settlement.termination?.confirmed === true) {
      scheduleTurnLaunchSettlementPersistence(0);
    } else if (settlement.terminationRetryBlocked !== true) {
      scheduleTurnLaunchSettlementRetry(settlement, 0);
    }
  }, 1_000);
  turnLaunchSettlement = settlement;
  try {
    mutateBackgroundAgentState(job.id, (current) =>
      current ? { ...current, ...turnLaunchUncertainty } : null,
    );
  } catch {
    // The durable prepare record remains the stop/cleanup fence. Settlement
    // retries both tree termination and the final confirmation write.
  }
  if (settlement.termination?.confirmed === true) {
    persistConfirmedTurnLaunchSettlement(settlement);
  } else {
    void settleUncertainTurnLaunch(settlement);
  }
  return "uncertain";
}

function startTurn(argv, promptText) {
  if (!writeHeartbeat()) return false;
  const nextTurn = turnCount + 1;
  const turnLaunchToken = randomBytes(16).toString("hex");
  // Private spawn-generation binding for the dedicated child IPC channel.
  // It is never persisted in state or exposed through attach transports.
  const turnIpcToken = randomBytes(32).toString("hex");
  const turnBootstrapNonce = randomBytes(32).toString("hex");
  let turnLaunchAttempt = 0;
  let turnTerminated = false;
  let keeperBootstrapStarted = false;
  let keeperBootstrapOutcome = null;
  let resolveKeeperBootstrap;
  const keeperBootstrapSettled = new Promise((resolvePromise) => {
    resolveKeeperBootstrap = resolvePromise;
  });
  const settleKeeperBootstrap = (outcome) => {
    if (keeperBootstrapOutcome) return;
    keeperBootstrapOutcome = outcome;
    resolveKeeperBootstrap(outcome);
  };
  let prepared;
  try {
    prepared = mutateBackgroundAgentState(job.id, (current) => {
      if (
        !current ||
        current.status !== "running" ||
        current.stopRequestedAt ||
        current.turnLaunchIntent ||
        current.turnLaunchFinalizationUncertain === true ||
        Number(current.workerPid) !== process.pid ||
        Number(current.workerClaimedPid) !== process.pid ||
        (current.workerGeneration &&
          current.workerGeneration !== job.workerGeneration)
      ) {
        return null;
      }
      turnLaunchAttempt =
        Math.max(0, Number(current.turnLaunchAttempt) || 0) + 1;
      return {
        ...current,
        phase: "turn_launching",
        turnLaunchAttempt,
        turnLaunchIntent: {
          token: turnLaunchToken,
          attempt: turnLaunchAttempt,
          workerPid: process.pid,
          workerGeneration: job.workerGeneration,
          preparedAt: Date.now(),
        },
        heartbeatAt: Date.now(),
      };
    });
  } catch (error) {
    if (turnLaunchAttempt > 0) {
      // The atomic rename may have committed even when strict lock release
      // reports ownership loss. Resolve that window as an explicit no-spawn
      // attempt instead of exiting with a durable intent and no settlement.
      return beginTurnLaunchSettlement({
        owned: null,
        error,
        turnLaunchToken,
        turnLaunchAttempt,
        agentStartedAt: null,
      });
    }
    throw error;
  }
  if (!prepared.applied) return false;

  const launch = spawnTurnAfterDurableIntent({
    spawnTurn: () =>
      executionBroker.spawn(
        process.execPath,
        [TURN_BOOTSTRAP_IMPORT_ARGUMENT, job.cliEntry, ...argv],
        {
          cwd: job.cwd,
          env: {
            ...process.env,
            CC_BACKGROUND_AGENT_ID: job.id,
            CC_BACKGROUND_TURN_IPC_NONCE: turnIpcToken,
            [BACKGROUND_TURN_BOOTSTRAP_ENV.nonce]: turnBootstrapNonce,
            [BACKGROUND_TURN_BOOTSTRAP_ENV.workerGeneration]:
              job.workerGeneration,
            [BACKGROUND_TURN_BOOTSTRAP_ENV.attempt]: String(turnLaunchAttempt),
          },
          stdio: ["ignore", log.fd, log.fd, "ipc"],
          windowsHide: true,
          origin: "background-agent:turn",
          policy: "allow",
          scope: "background-agent",
          shell: false,
          detached: process.platform !== "win32",
        },
      ),
    commitSpawn: (spawnedTurn, startedAt) =>
      mutateBackgroundAgentState(job.id, (current) => {
        if (
          !current ||
          current.status !== "running" ||
          current.stopRequestedAt ||
          current.turnLaunchIntent?.token !== turnLaunchToken ||
          Number(current.turnLaunchIntent?.attempt) !== turnLaunchAttempt ||
          Number(current.workerPid) !== process.pid ||
          Number(current.workerClaimedPid) !== process.pid ||
          (current.workerGeneration &&
            current.workerGeneration !== job.workerGeneration)
        ) {
          return null;
        }
        return {
          ...current,
          status: "running",
          phase: "turn",
          turnCount: nextTurn,
          pendingApprovals: 0,
          pendingQuestion: null,
          uncertainSideEffects: 0,
          interactionRecovery: {
            status: "pending",
            turn: nextTurn,
            workerGeneration: job.workerGeneration,
            startedAt,
          },
          agentPid: spawnedTurn.pid,
          agentStartedAt: startedAt,
          agentRuntimePid: null,
          agentRuntimeStartedAt: null,
          turnBootstrapStatus: "awaiting-ready",
          turnBootstrapCommittedAt: null,
          turnKeeperStatus: "waiting-for-runtime",
          turnKeeperPid: null,
          turnKeeperArmedAt: null,
          turnKeeperCleanupReason: null,
          turnKeeperCleanupRequestedAt: null,
          turnKeeperCleanupConfirmedAt: null,
          turnKeeperCleanupError: null,
          turnLaunchIntent: null,
          turnLaunchResolution: {
            token: turnLaunchToken,
            attempt: turnLaunchAttempt,
            outcome: "spawned",
            agentPid: spawnedTurn.pid,
            resolvedAt: Date.now(),
          },
          heartbeatAt: Date.now(),
        };
      }),
  });
  if (!launch.committed) {
    return beginTurnLaunchSettlement({
      owned: launch.spawned,
      error: launch.error,
      turnLaunchToken,
      turnLaunchAttempt,
      agentStartedAt: launch.agentStartedAt,
    });
  }
  const spawned = launch.spawned;
  const agentStartedAt = launch.agentStartedAt;
  child = spawned;
  phase = "turn";
  turnCount = nextTurn;
  server?.broadcast({
    type: "turn-started",
    turn: turnCount,
    prompt: promptText || null,
  });

  // P0-2: keep the active tool call suspended in this turn while the request
  // is routed to an attached client. The resolver returns the answer to the
  // same child over Node IPC; it never queues the answer as a follow-up turn.
  detachInteractionHandler = attachInteractionRequestHandler(
    child,
    async (payload, msg, { signal }) => {
      const requestId = msg.requestId;
      const journalAuthority = {
        sessionHostWriteDelegation: msg.sessionHostWriteDelegation || null,
        // On Windows the broker ChildProcess PID can be the restricted-token
        // sandbox helper. The dedicated IPC target reports its actual Node PID;
        // require that PID to be the owner embedded in the exact active lease.
        expectedOwnerPid: msg.senderPid,
      };
      updateInteractionJournal(
        (draft) =>
          draft.recordPending({
            requestId,
            binding: msg.binding,
            payload,
            createdAt: Date.now(),
          }),
        journalAuthority,
      );
      phase = "needs_input";
      const pendingQuestion = {
        intId: requestId,
        requestId,
        prompt: payload.prompt || payload.question,
        hint: payload.hint,
        options: payload.options,
        multiSelect: payload.multiSelect,
        timeoutMs: payload.timeoutMs,
        askedAt: Date.now(),
        binding: msg.binding,
      };
      const candidateIncident = createNeedsInputIncident({
        runId: job.id,
        sessionId: job.sessionId || null,
        requestId,
        now: pendingQuestion.askedAt,
      });
      let activeIncident = candidateIncident;
      const questionMutation = mutateWorkerState((current) => {
        if (
          current.needsInputIncident?.incidentId ===
          candidateIncident.incidentId
        ) {
          activeIncident = current.needsInputIncident;
        }
        return {
          ...current,
          id: job.id,
          phase,
          pendingQuestion,
          needsInputIncident: activeIncident,
        };
      });
      if (
        questionMutation.applied &&
        activeIncident.notification?.status === "pending"
      ) {
        void deliverBackgroundNeedsInputNotification(job.id).catch((error) => {
          try {
            writeSync(
              2,
              `[background-agent] needs-input notification failed: ${String(error?.message || error).slice(0, 500)}\n`,
            );
          } catch {
            // The durable incident remains visible even if stderr is closed.
          }
        });
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const deliverTerminalOutcome = (
          incidentStatus = "resolved",
          deliver,
        ) => {
          if (settled) return false;
          settled = true;
          pendingInteractions.delete(requestId);
          let releasedQuestion = false;
          deliverAfterDurableInteractionCleanup({
            cleanupProjection() {
              const cleanupMutation = mutateWorkerState((current) => {
                const ownsQuestion =
                  current.pendingQuestion?.requestId === requestId ||
                  current.pendingQuestion?.intId === requestId;
                const ownsIncident =
                  current.needsInputIncident?.requestId === requestId;
                if (!ownsQuestion && !ownsIncident) return null;
                releasedQuestion = ownsQuestion;
                return {
                  ...current,
                  id: job.id,
                  ...(ownsQuestion
                    ? { phase: "turn", pendingQuestion: null }
                    : {}),
                  ...(ownsIncident
                    ? {
                        needsInputIncident: closeNeedsInputIncident(
                          current.needsInputIncident,
                          { status: incidentStatus, now: Date.now() },
                        ),
                      }
                    : {}),
                };
              });
              if (cleanupMutation.applied && releasedQuestion) phase = "turn";
            },
            recordCleanupFailure(error) {
              // The terminal journal snapshot is already durable and therefore
              // remains answer authority. Retain an explicit failed marker for
              // the next heartbeat/recovery pass when possible.
              mergeState({
                interactionRecovery: {
                  status: "failed",
                  code: "INTERACTION_STATE_CLEANUP_FAILED",
                  message: error?.message || String(error),
                  failedAt: Date.now(),
                  turn: turnCount,
                  workerGeneration: job.workerGeneration,
                },
              });
            },
            detachAbort() {
              signal?.removeEventListener?.("abort", onAbort);
            },
            deliver,
          });
          return true;
        };
        const onAbort = () => {
          let rejection;
          try {
            persistInteractionSettlement(
              requestId,
              msg.binding,
              {
                status: "cancelled",
                error: {
                  code: "INTERACTION_CANCELLED",
                  message: "Background interaction was cancelled",
                },
              },
              journalAuthority,
            );
          } catch (error) {
            rejection = error;
          }
          if (!rejection) {
            rejection = new Error("Background interaction was cancelled");
            rejection.code = "INTERACTION_CANCELLED";
          }
          deliverTerminalOutcome("cancelled", () => reject(rejection));
        };
        const entry = {
          payload,
          binding: msg.binding,
          journalAuthority,
          deliverResolved(answer) {
            deliverTerminalOutcome("resolved", () => resolve(answer));
          },
          deliverRejected(error) {
            deliverTerminalOutcome("cancelled", () => reject(error));
          },
        };
        pendingInteractions.set(requestId, entry);
        signal?.addEventListener?.("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        server?.broadcastInteractionRequest(requestId, payload, msg.binding);
      });
    },
    {
      backgroundAgentId: job.id,
      sessionId: job.sessionId || null,
      turnIpcToken,
      requireSenderPid: true,
      requireDelegationOwnerPid: true,
    },
  );

  detachTurnBootstrapHandler = attachTurnChildBootstrapRelease(
    child,
    {
      nonce: turnBootstrapNonce,
      workerGeneration: job.workerGeneration,
      attempt: turnLaunchAttempt,
    },
    async (readyBinding) => {
      keeperBootstrapStarted = true;
      const committedAt = Date.now();
      const commit = mutateBackgroundAgentState(job.id, (current) => {
        if (
          !current ||
          current.status !== "running" ||
          current.stopRequestedAt ||
          current.workerGeneration !== job.workerGeneration ||
          Number(current.workerClaimedPid) !== process.pid ||
          current.turnLaunchResolution?.token !== turnLaunchToken ||
          Number(current.turnLaunchResolution?.attempt) !== turnLaunchAttempt ||
          current.turnLaunchResolution?.outcome !== "spawned" ||
          Number(current.agentPid) !== Number(spawned.pid)
        ) {
          return null;
        }
        return {
          ...current,
          agentRuntimePid: readyBinding.pid,
          // The host timestamp immediately before native spawn is a positive
          // lower-bound anchor for the runtime creation window. Destructive
          // identity checks still require a fresh OS creation-time probe.
          agentRuntimeStartedAt: agentStartedAt,
          turnBootstrapStatus: "awaiting-keeper",
          turnBootstrapCommittedAt: null,
          turnKeeperStatus: "arming",
        };
      });
      if (!commit.applied || !keeperClient) {
        settleKeeperBootstrap("failed");
        return false;
      }
      if (turnTerminated || child !== spawned || turnLaunchSettlement) {
        settleKeeperBootstrap("retired");
        return false;
      }
      const keeperTurn = {
        id: job.id,
        workerGeneration: job.workerGeneration,
        turnLaunchToken,
        attempt: turnLaunchAttempt,
        agentPid: Number(spawned.pid),
        agentStartedAt,
        agentRuntimePid: readyBinding.pid,
        agentRuntimeStartedAt: agentStartedAt,
      };
      try {
        await keeperClient.arm(keeperTurn);
      } catch (error) {
        settleKeeperBootstrap("failed");
        throw error;
      }
      activeKeeperTurn = keeperTurn;
      if (turnTerminated || child !== spawned || turnLaunchSettlement) {
        await keeperClient.retire(keeperTurn);
        if (activeKeeperTurn === keeperTurn) activeKeeperTurn = null;
        settleKeeperBootstrap("retired");
        return false;
      }
      const released = mutateBackgroundAgentState(job.id, (current) => {
        if (
          !current ||
          current.status !== "running" ||
          current.stopRequestedAt ||
          current.workerGeneration !== job.workerGeneration ||
          Number(current.workerClaimedPid) !== process.pid ||
          current.turnLaunchResolution?.token !== turnLaunchToken ||
          Number(current.turnLaunchResolution?.attempt) !== turnLaunchAttempt ||
          current.turnLaunchResolution?.outcome !== "spawned" ||
          Number(current.agentPid) !== Number(spawned.pid) ||
          Number(current.agentRuntimePid) !== readyBinding.pid ||
          current.turnKeeperStatus !== "armed" ||
          Number(current.turnKeeperPid) !== Number(current.keeperPid)
        ) {
          return null;
        }
        return {
          ...current,
          turnBootstrapStatus: "released",
          turnBootstrapCommittedAt: committedAt,
        };
      });
      if (!released.applied) {
        await keeperClient.retire(keeperTurn);
        if (activeKeeperTurn === keeperTurn) activeKeeperTurn = null;
        settleKeeperBootstrap("failed");
        return false;
      }
      settleKeeperBootstrap("released");
      return true;
    },
    (error) => {
      settleKeeperBootstrap("failed");
      detachInteractionHandler?.();
      detachInteractionHandler = null;
      if (
        keeperBootstrapOutcome !== "retired" &&
        (child === spawned || turnTerminated) &&
        !turnLaunchSettlement
      ) {
        beginTurnLaunchSettlement({
          owned: spawned,
          error,
          turnLaunchToken,
          turnLaunchAttempt,
          agentStartedAt,
        });
      }
    },
  );

  attachTurnChildTerminationSettlement(
    child,
    ({ code, signal, errorMessage }) => {
      turnTerminated = true;
      lastExit = {
        code,
        signal,
        ...(errorMessage ? { errorMessage } : {}),
      };
      child = null;
      detachTurnBootstrapHandler?.();
      detachTurnBootstrapHandler = null;
      // 清理交互处理器
      detachInteractionHandler?.();
      detachInteractionHandler = null;
      // Reject any request that survived an abnormal child exit. Normal
      // responses remove themselves from this map before the turn continues.
      for (const pending of pendingInteractions.values()) {
        const error = new Error("Agent exited");
        error.code = "INTERACTION_CHILD_EXITED";
        pending.deliverRejected?.(error);
      }
      pendingInteractions.clear();
      const finishTurn = () =>
        beginFinalInteractionSweep(() => {
          server?.broadcast({
            type: "turn-ended",
            turn: turnCount,
            exitCode: code,
          });
          if (lastExit.errorMessage) {
            finalize(1, signal, lastExit.errorMessage);
          } else {
            maybeContinue();
          }
        });
      void (async () => {
        if (keeperBootstrapStarted) {
          const outcome = await keeperBootstrapSettled;
          // The bootstrap failure callback owns process-tree settlement and
          // must not race a normal continuation into the next queued turn.
          if (outcome === "failed") return;
        }
        if (turnLaunchSettlement) return;
        const keeperTurn = activeKeeperTurn;
        if (!keeperTurn || !keeperClient) {
          finishTurn();
          return;
        }
        try {
          await keeperClient.retire(keeperTurn);
          if (activeKeeperTurn === keeperTurn) activeKeeperTurn = null;
          finishTurn();
        } catch (error) {
          if (!turnLaunchSettlement) {
            beginTurnLaunchSettlement({
              owned: spawned,
              error,
              turnLaunchToken,
              turnLaunchAttempt,
              agentStartedAt,
            });
          }
        }
      })();
    },
  );
  return true;
}

function maybeContinue() {
  if (finalized) return;
  // External stop marked the session terminal while a turn was in flight —
  // don't start another turn against a stopped session.
  const current = readBackgroundAgentState(job.id);
  if (!current || current.status !== "running") {
    finalize(lastExit.code, lastExit.signal);
    return;
  }
  if (promptQueue.length && Array.isArray(job.followUpArgv)) {
    const text = promptQueue.shift();
    if (
      !startTurn(
        insertArgumentsBeforeOptionTerminator(job.followUpArgv, [
          agentPrintArgument(text),
        ]),
        text,
      )
    ) {
      finalize(lastExit.code, lastExit.signal);
    }
    return;
  }
  if (server && server.clientCount() > 0) {
    // Parked between turns. Normally `idle` — but a turn that parked an
    // unanswered ask_user_question stays `needs_input` until the user's reply
    // starts the next turn (the reply prompt clears pendingQuestion).
    phase = idlePhaseFor(current);
    mergeState({
      phase,
      // Between turns no APPROVAL can be pending — the approval-owning child
      // has exited. Honest zero keeps a killed-mid-approval count from
      // parking the session in "Needs input" forever. (A parked QUESTION is
      // different: it awaits the user, so pendingQuestion survives idle.)
      pendingApprovals: 0,
      // The verify turn for any uncertain side effects has now run its
      // course — the annotation does not outlive it.
      uncertainSideEffects: 0,
      agentPid: null,
      agentStartedAt: null,
      agentRuntimePid: null,
      agentRuntimeStartedAt: null,
      turnBootstrapStatus: null,
      turnBootstrapCommittedAt: null,
      turnKeeperStatus: null,
      turnKeeperPid: null,
      turnKeeperArmedAt: null,
      turnKeeperCleanupReason: null,
      turnKeeperCleanupRequestedAt: null,
      turnKeeperCleanupConfirmedAt: null,
      turnKeeperCleanupError: null,
      heartbeatAt: Date.now(),
    });
    server.broadcast({ type: "idle", turn: turnCount });
    return;
  }
  finalize(lastExit.code, lastExit.signal);
}

function getStatus() {
  return {
    id: job.id,
    sessionId: job.sessionId || null,
    title: job.title || null,
    phase,
    turn: turnCount,
    interactive: Array.isArray(job.followUpArgv),
  };
}

async function main() {
  job = JSON.parse(readFileSync(jobFile, "utf8"));
  // Claim before opening logs, recovering interactions or creating the pipe.
  // A stopped/removed/differently-generated record must produce no worker
  // side effects and must never be recreated by bootstrap merges.
  if (!writeHeartbeat()) {
    removeJobFile(jobFile);
    return;
  }
  removeJobFile(jobFile);
  log = openBackgroundLogFile(job.id);
  const bootstrapState = readBackgroundAgentState(job.id);
  const allowAbsentBootstrap =
    job.sessionBootstrapExpected === true &&
    bootstrapState?.sessionBootstrapExpected === true &&
    bootstrapState?.workerGeneration === job.workerGeneration &&
    Number(bootstrapState?.turnCount || 0) === 0 &&
    !bootstrapState?.pendingQuestion;
  interactionJournal = loadBackgroundInteractionJournal(job.sessionId, job.id, {
    // A fresh background session is created by the first headless turn child.
    // Bootstrap may inspect an actually absent transcript before that child
    // writes session_start; it must remain an empty in-memory journal and may
    // never create transcript genesis itself.
    allowAbsent: allowAbsentBootstrap,
  });
  if (interactionJournal.pending().length > 0) {
    const recovery = withSessionHostRecoveryLease(job.sessionId, () =>
      rejectPendingBackgroundInteractions(job.sessionId, job.id, {
        code: "INTERACTION_WORKER_RESTARTED",
        message:
          "The background worker restarted before the interaction settled",
      }),
    );
    interactionJournal = recovery.journal;
    mergeState({
      phase: "turn",
      pendingQuestion: null,
      interactionRecovery: {
        status: recovery.changed ? "rejected" : "clean",
        requestIds: recovery.rejected.map((record) => record.requestId),
        recoveredAt: Date.now(),
        turn: turnCount,
        workerGeneration: job.workerGeneration,
      },
    });
  }

  // Session transport (best-effort): interactive attach needs it, but a
  // transport failure must never take down the background task itself.
  try {
    const token = randomBytes(16).toString("hex");
    server = await startBackgroundSessionServer({
      id: job.id,
      dir: backgroundAgentsDir(),
      token,
      getStatus,
      onPrompt: (text) => {
        if (!Array.isArray(job.followUpArgv)) {
          throw new Error(
            "this session was launched without follow-up support — start a new one with cc agent --bg",
          );
        }
        if (promptQueue.length >= MAX_PROMPT_QUEUE) {
          throw new Error(
            `prompt queue full (${MAX_PROMPT_QUEUE} pending) — wait for queued turns to drain before sending more`,
          );
        }
        promptQueue.push(text);
        const queued = promptQueue.length;
        // The transport is intentionally published before keeper/bootstrap
        // readiness. Prompts arriving in that window belong behind turn 1;
        // consuming one immediately would skip the launch job and make the
        // queue cap timing-dependent.
        if (!child && initialTurnStarted) maybeContinue();
        return { queued };
      },
      onStop: () => {
        if (!child) return;
        // An explicit stop owns this turn's termination. Detach the bootstrap
        // release callback before killing the child so a late IPC EPIPE cannot
        // reclassify the intentional stop as a post-spawn launch failure. The
        // child termination settlement remains attached and advances any
        // queued follow-up turn after the tree is confirmed closed.
        detachTurnBootstrapHandler?.();
        detachTurnBootstrapHandler = null;
        // The agent child is detached into its own group on POSIX; Windows
        // requires brokered taskkill /T /F so tool grandchildren cannot
        // survive an attached-session stop.
        stopBackgroundAgentChildTree(child.pid);
      },
      onClientChange: (count) => {
        // A UI/terminal may attach after the request was created. Re-broadcast
        // every still-pending interaction so reconnecting clients can resume
        // the exact suspended tool call.
        if (count > 0) {
          for (const [requestId, pending] of pendingInteractions) {
            server?.broadcastInteractionRequest(
              requestId,
              pending.payload,
              pending.binding,
            );
          }
        }
        // Last client detached while the session is idle → nothing left to
        // wait for; finalize with the last turn's exit code.
        if (count === 0 && !child && promptQueue.length === 0) {
          finalize(lastExit.code, lastExit.signal);
        }
      },
      onInteractionResponse: ({ requestId, intId, binding, answer, error }) => {
        // Support both field names: requestId (from transport) and intId (legacy)
        const resolvedId = requestId ?? intId;
        const entry = pendingInteractions.get(resolvedId);
        const outcome = error
          ? {
              status: "rejected",
              error:
                typeof error === "object"
                  ? error
                  : { code: "INTERACTION_REJECTED", message: String(error) },
            }
          : { status: "resolved", answer };
        if (!entry) {
          return classifyLateBackgroundInteractionSettlement(
            interactionJournal,
            resolvedId,
            binding,
            outcome,
          );
        }
        const settlement = persistInteractionSettlement(
          resolvedId,
          binding,
          outcome,
          entry.journalAuthority,
        );
        if (!settlement.applied) {
          return { accepted: true, duplicate: true };
        }
        if (error) {
          const rejection = new Error(
            typeof error === "object" ? error.message : error,
          );
          rejection.code =
            (typeof error === "object" && error.code) || "INTERACTION_REJECTED";
          entry.deliverRejected(rejection);
        } else {
          entry.deliverResolved(answer);
        }
        return { accepted: true, duplicate: false, delivered: true };
      },
    });
    transportState = { pipe: server.pipePath, token };
    mergeState({ transport: transportState });
  } catch {
    server = null;
  }

  if (!writeHeartbeat()) {
    // A list/stop/remove writer may have terminalized the record before this
    // worker claimed it. Never execute the task after losing ownership of the
    // session id; close any best-effort transport and exit without rewriting
    // the terminal status.
    finalize(0, null);
    return;
  }
  heartbeat = setInterval(() => {
    try {
      if (!writeHeartbeat()) {
        if (turnLaunchSettlement) {
          // The owned tree is already in explicit settlement. Keep the worker
          // alive until confirmed termination evidence is durably recorded;
          // an external stopper may still terminate this worker directly.
          return;
        }
        clearInterval(heartbeat);
        // External stop owns the terminal fence. Reap our current detached
        // child as a second line of defence, then stop holding the pipe.
        if (child?.pid) {
          try {
            stopBackgroundAgentChildTree(child.pid);
          } catch {
            /* the stopper may already have reaped it */
          }
        }
        finalize(lastExit.code, lastExit.signal);
      }
    } catch {
      /* do not let heartbeat persistence kill the worker */
    }
  }, DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const launchReadiness = await waitForLaunchFinalization();
  if (launchReadiness !== "ready") {
    finalize(launchReadiness === "timeout" ? 1 : 0, null);
    return;
  }
  if (!job.keeper) {
    throw new Error("background agent keeper launch authority is missing");
  }
  keeperClient = await connectBackgroundAgentKeeper({
    id: job.id,
    workerGeneration: job.workerGeneration,
    workerPid: process.pid,
    pipePath: job.keeper.pipePath,
    token: job.keeper.token,
    onDisconnect(error, keeperTurn) {
      if (finalized || turnLaunchSettlement) return;
      if (child && keeperTurn) {
        beginTurnLaunchSettlement({
          owned: child,
          error,
          turnLaunchToken: keeperTurn.turnLaunchToken,
          turnLaunchAttempt: keeperTurn.attempt,
          agentStartedAt: keeperTurn.agentStartedAt,
        });
        return;
      }
      finalize(1, null, error?.message || "background keeper disconnected");
    },
  });
  // Launch finalization can take long enough for an external stop/remove to
  // win after bootstrap. Re-claim immediately before the first native turn.
  if (!writeHeartbeat()) {
    finalize(0, null);
    return;
  }
  initialTurnStarted = true;
  if (!startTurn(job.argv, null)) finalize(0, null);
}

function handleWorkerFatal(error) {
  // The earliest bootstrap failures happen before `job` and `log` exist.
  // Write synchronously to the launcher-provided stderr handle so detached
  // Windows workers retain the loader/job/state error that caused the exit.
  try {
    writeSync(
      2,
      `[background-agent-worker] fatal: ${
        error?.stack || error?.message || String(error)
      }\n`,
    );
  } catch {
    /* the inherited stderr handle itself may be unavailable */
  }
  if (job?.id) {
    try {
      finalize(1, null, error.message);
      return;
    } catch {
      /* fall through to hard exit */
    }
  }
  process.exit(1);
}

const invokedWorkerPath = process.argv[1] ? resolve(process.argv[1]) : null;
const moduleWorkerPath = resolve(fileURLToPath(import.meta.url));
const directWorkerEntrypoint =
  invokedWorkerPath !== null &&
  (process.platform === "win32"
    ? invokedWorkerPath.toLowerCase() === moduleWorkerPath.toLowerCase()
    : invokedWorkerPath === moduleWorkerPath);

if (directWorkerEntrypoint) {
  main().catch(handleWorkerFatal);
}
