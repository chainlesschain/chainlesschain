/**
 * Independent lifetime keeper for one detached background-agent worker.
 *
 * The launcher starts this process as a sibling of the worker. The worker must
 * arm an exact turn identity over the private local channel and receive the
 * keeper's durable acknowledgement before releasing Agent main. If the worker
 * disappears, this process remains outside the worker's process group / Job
 * and retires the armed process trees before exiting.
 */

import net from "node:net";
import { readFileSync, unlinkSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNdjsonReader } from "../lib/background-session-transport.js";
import {
  isBackgroundProcessTreeExecutionAlive,
  isProcessAlive,
  isSameProcess,
  mutateBackgroundAgentState,
  readBackgroundAgentState,
  removeJobFile,
  stopBackgroundAgentChildTree,
} from "../lib/background-agent-supervisor.js";
import {
  BACKGROUND_AGENT_KEEPER_ARM,
  BACKGROUND_AGENT_KEEPER_ARMED,
  BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS,
  BACKGROUND_AGENT_KEEPER_HELLO,
  BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION,
  BACKGROUND_AGENT_KEEPER_READY,
  BACKGROUND_AGENT_KEEPER_RETIRE,
  BACKGROUND_AGENT_KEEPER_RETIRED,
  BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS,
  cleanupBackgroundAgentKeeperPipeDirectory,
  createBackgroundAgentKeeperMessage,
  normalizeBackgroundAgentKeeperHello,
  normalizeBackgroundAgentKeeperTurn,
  sameBackgroundAgentKeeperTurn,
} from "../lib/background-agent-keeper-protocol.js";

const STARTUP_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 1_000;
const KEEPER_PERSIST_RETRY_TIMEOUT_MS =
  3 * BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS;
const KEEPER_PERSIST_RETRY_DELAY_MS = 50;

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Retry a cleanup-critical state mutation after a worker is hard-killed.
 *
 * A worker can disappear while it owns the cross-process state lock. Windows
 * may keep that terminated PID observable briefly, so the strict lock cannot
 * immediately prove the owner dead and correctly fails closed. The keeper is
 * the only remaining owner of the armed turn; it must wait for that transient
 * fence instead of turning a lock exception into an unhandled rejection and
 * exiting with the durable projection still `armed`.
 */
export async function retryKeeperPersistence(operation, options = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || delay;
  const timeoutMs = Math.max(
    0,
    Number(options.timeoutMs ?? KEEPER_PERSIST_RETRY_TIMEOUT_MS),
  );
  const retryDelayMs = Math.max(
    1,
    Number(options.retryDelayMs ?? KEEPER_PERSIST_RETRY_DELAY_MS),
  );
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let error = null;
  for (;;) {
    attempts += 1;
    try {
      return { result: operation(), error: null, attempts };
    } catch (cause) {
      error = cause;
    }
    const remaining = deadline - now();
    if (remaining <= 0) return { result: null, error, attempts };
    await sleep(Math.min(retryDelayMs, remaining));
  }
}

function writeMessage(socket, message) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(`${JSON.stringify(message)}\n`);
    return true;
  } catch {
    return false;
  }
}

export function keeperWorkerIdentityAlive(
  workerPid,
  workerStartedAt,
  probe = isSameProcess,
) {
  return probe(Number(workerPid), Number(workerStartedAt));
}

function stateOwnsTurn(state, turn) {
  return Boolean(
    state &&
    state.id === turn.id &&
    state.workerGeneration === turn.workerGeneration &&
    state.turnLaunchResolution?.token === turn.turnLaunchToken &&
    Number(state.turnLaunchResolution?.attempt) === turn.attempt &&
    state.turnLaunchResolution?.outcome === "spawned" &&
    Number(state.agentPid) === turn.agentPid &&
    Number(state.agentStartedAt) === turn.agentStartedAt &&
    Number(state.agentRuntimePid) === turn.agentRuntimePid &&
    Number(state.agentRuntimeStartedAt) === turn.agentRuntimeStartedAt,
  );
}

function persistKeeperTurn(job, turn, patch) {
  return mutateBackgroundAgentState(
    job.id,
    (current) => {
      if (
        !stateOwnsTurn(current, turn) ||
        Number(current.keeperPid) !== process.pid
      ) {
        return null;
      }
      return { ...current, ...patch };
    },
    { timeoutMs: BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS },
  );
}

async function cleanupTurn(job, turn, reason) {
  const requestedAt = Date.now();
  const requestedPersistence = await retryKeeperPersistence(() =>
    persistKeeperTurn(job, turn, {
      turnKeeperStatus: "cleanup-requested",
      turnKeeperCleanupReason: reason,
      turnKeeperCleanupRequestedAt: requestedAt,
    }),
  );

  const targets = [
    { pid: turn.agentPid, startedAt: turn.agentStartedAt },
    {
      pid: turn.agentRuntimePid,
      startedAt: turn.agentRuntimeStartedAt,
    },
  ].filter(
    (target, index, values) =>
      values.findIndex((candidate) => candidate.pid === target.pid) === index,
  );
  const failures = [];
  for (const target of targets) {
    try {
      stopBackgroundAgentChildTree(target.pid, { signal: "SIGKILL" });
    } catch (error) {
      // A preceding wrapper/group signal may already have retired this root.
      if (isProcessAlive(target.pid)) {
        failures.push(error?.message || String(error));
      }
    }
  }

  const deadline =
    Date.now() + BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS;
  let alive = targets.filter((target) =>
    isBackgroundProcessTreeExecutionAlive(target.pid, target.startedAt),
  );
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    alive = targets.filter((target) =>
      isBackgroundProcessTreeExecutionAlive(target.pid, target.startedAt),
    );
  }
  const confirmed = alive.length === 0 && failures.length === 0;
  let finalPersistenceAttempts = 0;
  const finalPersistence = await retryKeeperPersistence(() => {
    finalPersistenceAttempts += 1;
    return persistKeeperTurn(job, turn, {
      turnKeeperStatus: confirmed ? "retired" : "cleanup-unconfirmed",
      turnKeeperCleanupReason: reason,
      turnKeeperCleanupRequestedAt: requestedAt,
      turnKeeperCleanupConfirmedAt: confirmed ? Date.now() : null,
      turnKeeperCleanupError:
        failures.length > 0
          ? failures.join("; ").slice(0, 1_000)
          : alive.length > 0
            ? `process tree still executable: ${alive.map(({ pid }) => pid).join(",")}`
            : null,
      turnKeeperPersistenceRetries:
        Math.max(0, requestedPersistence.attempts - 1) +
        Math.max(0, finalPersistenceAttempts - 1),
    });
  });
  const persistenceError = finalPersistence.error
    ? finalPersistence.error?.message || String(finalPersistence.error)
    : finalPersistence.result?.applied === false
      ? "keeper cleanup state no longer owned"
      : null;
  if (persistenceError) failures.push(persistenceError);
  return {
    confirmed: confirmed && !persistenceError,
    failures,
    alive,
    persistenceError,
  };
}

export async function runBackgroundAgentKeeper(jobFile, options = {}) {
  const job = JSON.parse(readFileSync(jobFile, "utf8"));
  removeJobFile(jobFile);
  const startedAt = Date.now();
  const claim = mutateBackgroundAgentState(job.id, (current) => {
    if (
      !current ||
      current.status !== "running" ||
      current.workerGeneration !== job.workerGeneration ||
      current.keeperGeneration !== job.keeperGeneration
    ) {
      return null;
    }
    return {
      ...current,
      keeperPid: process.pid,
      keeperStartedAt: startedAt,
      keeperStatus: "listening",
      keeperHeartbeatAt: startedAt,
    };
  });
  if (!claim.applied) return { status: "unclaimed" };

  if (process.platform !== "win32") {
    try {
      unlinkSync(job.pipePath);
    } catch {
      // Usually ENOENT; the generation-bound endpoint is not reusable.
    }
  }

  let workerSocket = null;
  let candidateSocket = null;
  let authenticatedHello = null;
  let authenticatedWorkerStartedAt = null;
  let armedTurn = null;
  let finishing = false;
  let finishResolve;
  const finished = new Promise((resolvePromise) => {
    finishResolve = resolvePromise;
  });

  const persistKeeper = (patch) =>
    mutateBackgroundAgentState(job.id, (current) => {
      if (
        !current ||
        current.workerGeneration !== job.workerGeneration ||
        current.keeperGeneration !== job.keeperGeneration ||
        Number(current.keeperPid) !== process.pid
      ) {
        return null;
      }
      return { ...current, ...patch };
    });

  const finishForWorkerDisconnect = () => {
    if (finishing) return false;
    finishing = true;
    const active = armedTurn;
    void (async () => {
      let cleanup;
      try {
        cleanup = active
          ? await cleanupTurn(job, active, "worker-disconnected")
          : { confirmed: true, failures: [], alive: [] };
      } catch (error) {
        cleanup = {
          confirmed: false,
          failures: [error?.message || String(error)],
          alive: [],
        };
      }
      // Closing the keeper must never be skipped because one final metadata
      // update throws. Retry the critical status write, retain the failure in
      // the log, and always settle the server promise without an unhandled
      // rejection.
      const persisted = await retryKeeperPersistence(() =>
        persistKeeper({
          keeperStatus: active
            ? cleanup.confirmed
              ? "worker-disconnected"
              : "cleanup-unconfirmed"
            : "closed",
          keeperEndedAt: Date.now(),
          ...(cleanup.failures.length > 0
            ? {
                keeperError: cleanup.failures.join("; ").slice(0, 1_000),
              }
            : {}),
        }),
      );
      if (persisted.error) {
        try {
          writeSync(
            2,
            `[background-agent-keeper] final state persistence failed: ${persisted.error?.stack || persisted.error?.message || String(persisted.error)}\n`,
          );
        } catch {
          // The inherited diagnostic handle may already be closed.
        }
      }
      server.close(() => finishResolve({ status: "closed" }));
    })();
    return true;
  };

  const server = net.createServer((socket) => {
    let authenticated = false;
    if (workerSocket || candidateSocket) {
      socket.destroy();
      return;
    }
    candidateSocket = socket;
    const helloTimer = setTimeout(() => socket.destroy(), 5_000);
    helloTimer.unref?.();
    socket.on(
      "data",
      createNdjsonReader(
        (message) => {
          if (
            message?.protocolVersion !==
            BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION
          ) {
            socket.destroy();
            return;
          }
          if (!authenticated) {
            if (message.type !== BACKGROUND_AGENT_KEEPER_HELLO) {
              socket.destroy();
              return;
            }
            let hello;
            try {
              hello = normalizeBackgroundAgentKeeperHello(message);
            } catch {
              socket.destroy();
              return;
            }
            const current = readBackgroundAgentState(job.id);
            if (
              hello.id !== job.id ||
              hello.workerGeneration !== job.workerGeneration ||
              hello.token !== job.token ||
              Number(current?.workerClaimedPid) !== hello.workerPid ||
              current?.keeperGeneration !== job.keeperGeneration ||
              Number(current?.keeperPid) !== process.pid
            ) {
              socket.destroy();
              return;
            }
            authenticated = true;
            authenticatedHello = hello;
            authenticatedWorkerStartedAt = Number(current.startedAt);
            workerSocket = socket;
            clearTimeout(helloTimer);
            persistKeeper({ keeperStatus: "ready", keeperReadyAt: Date.now() });
            writeMessage(
              socket,
              createBackgroundAgentKeeperMessage(
                BACKGROUND_AGENT_KEEPER_READY,
                {
                  id: job.id,
                  workerGeneration: job.workerGeneration,
                  keeperPid: process.pid,
                },
              ),
            );
            return;
          }

          if (
            message.type !== BACKGROUND_AGENT_KEEPER_ARM &&
            message.type !== BACKGROUND_AGENT_KEEPER_RETIRE
          ) {
            return;
          }
          let turn;
          try {
            turn = normalizeBackgroundAgentKeeperTurn(message);
          } catch (error) {
            writeMessage(
              socket,
              createBackgroundAgentKeeperMessage(
                "background-agent-keeper-error",
                {
                  requestId: message.requestId,
                  code: "BACKGROUND_AGENT_KEEPER_INVALID_TURN",
                  message: error?.message || String(error),
                },
              ),
            );
            return;
          }

          if (message.type === BACKGROUND_AGENT_KEEPER_ARM) {
            const durableTurnState = readBackgroundAgentState(job.id);
            if (
              armedTurn ||
              durableTurnState?.status !== "running" ||
              !stateOwnsTurn(durableTurnState, turn)
            ) {
              writeMessage(
                socket,
                createBackgroundAgentKeeperMessage(
                  "background-agent-keeper-error",
                  {
                    requestId: message.requestId,
                    code: "BACKGROUND_AGENT_KEEPER_ARM_REJECTED",
                    message: "keeper arm did not match the durable turn",
                  },
                ),
              );
              return;
            }
            armedTurn = turn;
            const armedAt = Date.now();
            const armed = persistKeeperTurn(job, turn, {
              turnKeeperStatus: "armed",
              turnKeeperPid: process.pid,
              turnKeeperArmedAt: armedAt,
            });
            if (!armed.applied) {
              armedTurn = null;
              writeMessage(
                socket,
                createBackgroundAgentKeeperMessage(
                  "background-agent-keeper-error",
                  {
                    requestId: message.requestId,
                    code: "BACKGROUND_AGENT_KEEPER_ARM_REJECTED",
                    message: "keeper arm persistence was rejected",
                  },
                ),
              );
              return;
            }
            writeMessage(
              socket,
              createBackgroundAgentKeeperMessage(
                BACKGROUND_AGENT_KEEPER_ARMED,
                { requestId: message.requestId, ...turn },
              ),
            );
            return;
          }

          if (!sameBackgroundAgentKeeperTurn(turn, armedTurn)) {
            writeMessage(
              socket,
              createBackgroundAgentKeeperMessage(
                "background-agent-keeper-error",
                {
                  requestId: message.requestId,
                  code: "BACKGROUND_AGENT_KEEPER_RETIRE_REJECTED",
                  message: "keeper retire binding mismatch",
                },
              ),
            );
            return;
          }
          void cleanupTurn(job, turn, "turn-exited").then((result) => {
            if (!result.confirmed) {
              writeMessage(
                socket,
                createBackgroundAgentKeeperMessage(
                  "background-agent-keeper-error",
                  {
                    requestId: message.requestId,
                    code: "BACKGROUND_AGENT_KEEPER_CLEANUP_UNCONFIRMED",
                    message: "keeper could not confirm process-tree cleanup",
                  },
                ),
              );
              return;
            }
            armedTurn = null;
            writeMessage(
              socket,
              createBackgroundAgentKeeperMessage(
                BACKGROUND_AGENT_KEEPER_RETIRED,
                { requestId: message.requestId, ...turn },
              ),
            );
          });
        },
        () => socket.destroy(),
      ),
    );

    const disconnected = () => {
      clearTimeout(helloTimer);
      if (candidateSocket === socket) candidateSocket = null;
      if (workerSocket !== socket || finishing) return;
      finishForWorkerDisconnect();
    };
    socket.once("close", disconnected);
    socket.once("error", disconnected);
  });

  const heartbeat = setInterval(() => {
    if (
      workerSocket &&
      authenticatedHello &&
      armedTurn &&
      !keeperWorkerIdentityAlive(
        authenticatedHello.workerPid,
        authenticatedWorkerStartedAt,
      )
    ) {
      // A Windows named-pipe handle can remain open after its worker dies if a
      // platform helper retained a duplicate. Socket EOF alone is therefore
      // not a sufficient lifetime signal. The generation-bound worker PID and
      // its durable launch anchor provide an independent identity fence.
      finishForWorkerDisconnect();
      workerSocket.destroy();
      return;
    }
    persistKeeper({ keeperHeartbeatAt: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();
  const startupTimer = setTimeout(
    () => {
      if (workerSocket || finishing) return;
      finishing = true;
      persistKeeper({
        keeperStatus: "startup-timeout",
        keeperEndedAt: Date.now(),
      });
      server.close(() => finishResolve({ status: "startup-timeout" }));
    },
    Number(options.startupTimeoutMs) || STARTUP_TIMEOUT_MS,
  );
  startupTimer.unref?.();

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(job.pipePath, () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const result = await finished;
  clearInterval(heartbeat);
  clearTimeout(startupTimer);
  if (process.platform !== "win32") {
    try {
      unlinkSync(job.pipePath);
    } catch {
      // Already removed or never materialized.
    }
    try {
      cleanupBackgroundAgentKeeperPipeDirectory(job.pipePath);
    } catch {
      // Another keeper can still own a sibling socket in the shared namespace.
    }
  }
  return {
    ...result,
    authenticatedWorkerPid: authenticatedHello?.workerPid || null,
  };
}

function reportFatal(error) {
  try {
    writeSync(
      2,
      `[background-agent-keeper] fatal: ${error?.stack || error?.message || String(error)}\n`,
    );
  } catch {
    // The inherited diagnostic handle may already be closed.
  }
  process.exit(1);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (
  invokedPath !== null &&
  (process.platform === "win32"
    ? invokedPath.toLowerCase() === modulePath.toLowerCase()
    : invokedPath === modulePath)
) {
  runBackgroundAgentKeeper(process.argv[2]).then(
    () => process.exit(0),
    reportFatal,
  );
}
