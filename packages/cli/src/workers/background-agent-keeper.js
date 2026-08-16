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

export function stopBackgroundAgentKeeperTurnTrees(targets, options = {}) {
  const processAlive = options.isProcessAlive || isProcessAlive;
  const stopTree = options.stopProcessTree || stopBackgroundAgentChildTree;
  const failures = [];
  let precedingTreeStopSucceeded = false;
  for (const target of targets) {
    // On Windows the wrapper's taskkill /T also retires its runtime child.
    // Avoid starting a second bounded taskkill for a target the first tree
    // operation already proved absent; under 20-way churn that redundant
    // command can consume the keeper's entire cleanup SLO. Never skip the
    // first root merely because its leader exited: POSIX descendants can keep
    // executing in the leader's process group and still require a group kill.
    if (precedingTreeStopSucceeded && !processAlive(target.pid)) continue;
    try {
      stopTree(target.pid, { signal: "SIGKILL" });
      precedingTreeStopSucceeded = true;
    } catch (error) {
      // A preceding wrapper/group signal may already have retired this root.
      if (processAlive(target.pid)) {
        failures.push(error?.message || String(error));
      }
    }
  }
  return failures;
}

async function cleanupTurn(job, turn, reason) {
  const requestedAt = Date.now();
  persistKeeperTurn(job, turn, {
    turnKeeperStatus: "cleanup-requested",
    turnKeeperCleanupReason: reason,
    turnKeeperCleanupRequestedAt: requestedAt,
  });

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
  const failures = stopBackgroundAgentKeeperTurnTrees(targets);

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
  persistKeeperTurn(job, turn, {
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
  });
  return { confirmed, failures, alive };
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
    void (
      active
        ? cleanupTurn(job, active, "worker-disconnected")
        : Promise.resolve({ confirmed: true })
    ).finally(() => {
      persistKeeper({
        keeperStatus: active ? "worker-disconnected" : "closed",
        keeperEndedAt: Date.now(),
      });
      server.close(() => finishResolve({ status: "closed" }));
    });
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
