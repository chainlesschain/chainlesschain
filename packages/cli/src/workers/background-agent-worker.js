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

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  backgroundAgentsDir,
  openBackgroundLogFile,
  readBackgroundAgentState,
  removeJobFile,
  writeBackgroundAgentState,
} from "../lib/background-agent-supervisor.js";
import { startBackgroundSessionServer } from "../lib/background-session-transport.js";

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
const promptQueue = [];

function mergeState(patch) {
  const current = readBackgroundAgentState(job.id) || { id: job.id };
  const next = { ...current, id: job.id, ...patch };
  writeBackgroundAgentState(next);
  return next;
}

function writeHeartbeat() {
  const current = readBackgroundAgentState(job.id) || { id: job.id };
  if (current.status && current.status !== "running") return false;
  writeBackgroundAgentState({
    ...current,
    id: job.id,
    pid: process.pid,
    workerPid: process.pid,
    agentPid: child?.pid ?? current.agentPid ?? null,
    status: "running",
    heartbeatAt: Date.now(),
    // Re-assert the transport endpoint so a launcher write racing the
    // worker's initial merge self-heals within one heartbeat.
    ...(transportState ? { transport: transportState } : {}),
  });
  return true;
}

function finalize(code, signal, errorMessage) {
  if (finalized) return;
  finalized = true;
  clearInterval(heartbeat);
  const current = readBackgroundAgentState(job.id) || { id: job.id };
  // An external `cc daemon stop` already recorded its own terminal status —
  // don't overwrite it; just clear the dead transport endpoint.
  if (!current.status || current.status === "running") {
    writeBackgroundAgentState({
      ...current,
      id: job.id,
      status: errorMessage ? "failed" : code === 0 ? "completed" : "failed",
      endedAt: Date.now(),
      exitCode: errorMessage ? (code ?? 1) : code,
      signal: signal || null,
      ...(errorMessage ? { error: errorMessage } : {}),
      phase: null,
      transport: null,
    });
  } else {
    writeBackgroundAgentState({ ...current, phase: null, transport: null });
  }
  const done = () => {
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

function startTurn(argv, promptText) {
  phase = "turn";
  turnCount++;
  child = spawn(process.execPath, [job.cliEntry, ...argv], {
    cwd: job.cwd,
    env: { ...process.env, CC_BACKGROUND_AGENT_ID: job.id },
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true,
  });
  mergeState({
    status: "running",
    phase,
    turnCount,
    agentPid: child.pid,
    heartbeatAt: Date.now(),
  });
  server?.broadcast({
    type: "turn-started",
    turn: turnCount,
    prompt: promptText || null,
  });
  child.on("exit", (code, signal) => {
    lastExit = { code, signal };
    child = null;
    server?.broadcast({ type: "turn-ended", turn: turnCount, exitCode: code });
    maybeContinue();
  });
  child.on("error", (error) => {
    child = null;
    finalize(1, null, error.message);
  });
}

function maybeContinue() {
  if (finalized) return;
  // External stop marked the session terminal while a turn was in flight —
  // don't start another turn against a stopped session.
  const current = readBackgroundAgentState(job.id);
  if (current?.status && current.status !== "running") {
    finalize(lastExit.code, lastExit.signal);
    return;
  }
  if (promptQueue.length && Array.isArray(job.followUpArgv)) {
    const text = promptQueue.shift();
    startTurn([...job.followUpArgv, "-p", text], text);
    return;
  }
  if (server && server.clientCount() > 0) {
    phase = "idle";
    mergeState({ phase, agentPid: null, heartbeatAt: Date.now() });
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
  removeJobFile(jobFile);
  log = openBackgroundLogFile(job.id);

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
        promptQueue.push(text);
        const queued = promptQueue.length;
        if (!child) maybeContinue();
        return { queued };
      },
      onStop: () => {
        child?.kill("SIGTERM");
      },
      onClientChange: (count) => {
        // Last client detached while the session is idle → nothing left to
        // wait for; finalize with the last turn's exit code.
        if (count === 0 && !child && promptQueue.length === 0) {
          finalize(lastExit.code, lastExit.signal);
        }
      },
    });
    transportState = { pipe: server.pipePath, token };
    mergeState({ transport: transportState });
  } catch {
    server = null;
  }

  writeHeartbeat();
  heartbeat = setInterval(() => {
    try {
      if (!writeHeartbeat()) {
        clearInterval(heartbeat);
        // External stop: the child tree is being killed by the stopper; make
        // sure the worker itself never lingers holding the pipe.
        if (!child) finalize(lastExit.code, lastExit.signal);
      }
    } catch {
      /* do not let heartbeat persistence kill the worker */
    }
  }, DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  startTurn(job.argv, null);
}

main().catch((error) => {
  if (job?.id) {
    try {
      finalize(1, null, error.message);
      return;
    } catch {
      /* fall through to hard exit */
    }
  }
  process.exit(1);
});
