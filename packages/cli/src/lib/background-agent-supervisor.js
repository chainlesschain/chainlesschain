import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getHomeDir } from "./paths.js";

export const _deps = { spawn, spawnSync };

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
export const DEFAULT_HEARTBEAT_STALE_MS = 120000;

function nowMs(options = {}) {
  return typeof options.now === "number" ? options.now : Date.now();
}

function heartbeatStaleMs(options = {}) {
  const configured =
    options.heartbeatStaleMs ||
    process.env.CC_BACKGROUND_AGENT_HEARTBEAT_STALE_MS;
  const n = Number(configured);
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : DEFAULT_HEARTBEAT_STALE_MS;
}

export function backgroundAgentsDir() {
  const dir =
    process.env.CC_BACKGROUND_AGENTS_DIR ||
    join(getHomeDir(), "background-agents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function createBackgroundAgentId() {
  return `bg-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

function safeId(id) {
  if (!/^bg-[a-zA-Z0-9-]+$/.test(String(id || ""))) {
    throw new Error(`Invalid background agent id: ${id}`);
  }
  return String(id);
}

export function statePath(id) {
  return join(backgroundAgentsDir(), `${safeId(id)}.json`);
}

export function logPath(id) {
  return join(backgroundAgentsDir(), `${safeId(id)}.log`);
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "lost"]);

export function writeBackgroundAgentState(state) {
  const target = statePath(state.id);
  // Field-aware merge against the freshest on-disk state. The state file has
  // multiple concurrent read-modify-write writers (launcher, worker heartbeat/
  // turn/finalize, rename/pin/stop from other processes) with last-writer-wins
  // semantics — a writer holding a stale snapshot used to clobber a terminal
  // status back to "running" (phantom session, real exit code lost) or roll a
  // fresh rename back to the old title. Two invariants restore convergence:
  //   1. a terminal status wins over a racing "running" snapshot — there is no
  //      legitimate same-id terminal→running transition (resume mints a NEW
  //      id, and the worker's own writeHeartbeat already refuses to resurrect);
  //   2. the newest rename/pin (by renamedAt/pinnedAt) wins regardless of
  //      which writer's snapshot carries it.
  // The read happens immediately before the atomic rename, shrinking the
  // clobber window from "any caller's RMW span" to microseconds; rename/pin
  // additionally verify-and-retry on top of this.
  let next = state;
  const current = readBackgroundAgentState(state.id);
  if (current) {
    if (TERMINAL_STATUSES.has(current.status) && next.status === "running") {
      next = {
        ...next,
        status: current.status,
        endedAt: current.endedAt ?? next.endedAt ?? null,
        exitCode: current.exitCode ?? next.exitCode ?? null,
        ...(current.signal !== undefined ? { signal: current.signal } : {}),
        ...(current.error !== undefined ? { error: current.error } : {}),
        ...(current.lostReason !== undefined
          ? { lostReason: current.lostReason }
          : {}),
        ...(current.stoppedByUser !== undefined
          ? { stoppedByUser: current.stoppedByUser }
          : {}),
        // terminal sessions have no live phase or transport endpoint
        phase: null,
        transport: null,
      };
    }
    if (Number(current.renamedAt || 0) > Number(next.renamedAt || 0)) {
      next = { ...next, title: current.title, renamedAt: current.renamedAt };
    }
    if (Number(current.pinnedAt || 0) > Number(next.pinnedAt || 0)) {
      next = { ...next, pinned: current.pinned, pinnedAt: current.pinnedAt };
    }
  }
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
  return next;
}

export function readBackgroundAgentState(id) {
  const file = statePath(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    return false;
  }
}

export function normalizeBackgroundAgentTitle(title) {
  const value = String(title || "").trim();
  if (!value) throw new Error("Background agent title cannot be empty");
  return value.slice(0, 160);
}

export function effectiveBackgroundAgentState(state, options = {}) {
  if (!state) return null;
  if (state.status !== "running") return state;
  const t = nowMs(options);
  let next = state;
  if (
    Number.isFinite(Number(state.heartbeatAt)) &&
    t - Number(state.heartbeatAt) > heartbeatStaleMs(options)
  ) {
    next = {
      ...state,
      status: "lost",
      endedAt: state.endedAt || t,
      lostReason: "heartbeat-stale",
    };
  } else if (!isProcessAlive(state.pid)) {
    next = {
      ...state,
      status: "lost",
      endedAt: state.endedAt || t,
      lostReason: "process-exited",
    };
  }
  if (next !== state && options.persist !== false) {
    try {
      writeBackgroundAgentState(next);
    } catch {
      /* best-effort; callers still get the corrected state */
    }
  }
  return next;
}

export function listBackgroundAgents(options = {}) {
  return readdirSync(backgroundAgentsDir())
    .filter((name) => name.endsWith(".json") && !name.includes(".job."))
    .map((name) => readBackgroundAgentState(name.slice(0, -5)))
    .filter(Boolean)
    .map((state) => effectiveBackgroundAgentState(state, options))
    .filter((state) => options.all || state.status === "running")
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* fallback busy-wait — only a few ms */
    }
  }
}

export function renameBackgroundAgent(id, title, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const normalized = normalizeBackgroundAgentTitle(title);
  const renamedAt = typeof options.now === "number" ? options.now : Date.now();
  // The worker persists state via read-modify-write (heartbeat / transport /
  // turn merges). A rename that lands inside one of those read→write windows
  // gets clobbered by the worker's stale snapshot — so verify after a short
  // beat and re-apply onto the freshest state (bounded retries; the window is
  // milliseconds wide, worst during worker startup's write burst).
  let next = { ...state, title: normalized, renamedAt };
  for (let attempt = 0; attempt < 4; attempt++) {
    writeBackgroundAgentState(next);
    sleepSyncMs(15);
    const current = readBackgroundAgentState(id) || next;
    if (current.title === normalized) {
      return { ...current, title: normalized, renamedAt };
    }
    next = { ...current, title: normalized, renamedAt };
  }
  writeBackgroundAgentState(next);
  return next;
}

/**
 * Remove a background agent's RECORD (state file + log) — `cc daemon rm`
 * (gap-analysis 2026-07-11 P0 "后台 Agent Supervisor" 补 rm 动词). Terminal
 * sessions (completed/failed/stopped/lost) remove directly; a still-running
 * one is refused unless `force`, which stops it first. The underlying JSONL
 * conversation session is NOT touched — that's `cc session delete`.
 */
export function removeBackgroundAgent(id, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  if (state.status === "running") {
    if (options.force !== true) {
      throw new Error(
        `${id} is still running — stop it first (cc daemon stop ${id}) or pass --force`,
      );
    }
    try {
      stopBackgroundAgent(id);
    } catch {
      /* best-effort — the record removal below is the point of rm --force */
    }
  }
  rmSync(statePath(id), { force: true });
  if (options.keepLog !== true) {
    rmSync(logPath(id), { force: true });
  }
  return { id, removed: true, status: state.status };
}

/**
 * Pin/unpin a session for the dashboard (`cc daemon view`) — pinned sessions
 * sort first inside their group. Same read-modify-write + verify-retry dance
 * as rename: the worker's periodic state merges can clobber a write that
 * lands inside its read→write window.
 */
export function setBackgroundAgentPinned(id, pinned, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const value = pinned === true;
  const pinnedAt = typeof options.now === "number" ? options.now : Date.now();
  let next = { ...state, pinned: value, pinnedAt };
  for (let attempt = 0; attempt < 4; attempt++) {
    writeBackgroundAgentState(next);
    sleepSyncMs(15);
    const current = readBackgroundAgentState(id) || next;
    if (current.pinned === value) {
      return { ...current, pinned: value, pinnedAt };
    }
    next = { ...current, pinned: value, pinnedAt };
  }
  writeBackgroundAgentState(next);
  return next;
}

/**
 * Build the follow-up argv template for interactive attach turns: the launch
 * argv minus every token that carried the FIRST turn's prompt (positional
 * task words, `-p/--print` and its inline value). The worker appends
 * `["-p", "<follow-up text>"]` per turn, so all remaining flags (model,
 * permission-mode, session id, …) keep applying to later turns.
 *
 * @param {string[]} argv the background child argv (before any piped-prompt
 *        token is appended)
 * @param {object} [opts]
 * @param {string[]} [opts.positionalTokens] raw positional prompt tokens
 * @param {string|null} [opts.printValue] inline `-p <value>` text, when the
 *        prompt came from --print
 */
export function buildFollowUpArgv(argv, opts = {}) {
  const positionalLeft = Array.isArray(opts.positionalTokens)
    ? [...opts.positionalTokens]
    : [];
  const printValue =
    typeof opts.printValue === "string" && opts.printValue.trim()
      ? opts.printValue
      : null;
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") {
      if (printValue !== null && argv[i + 1] === printValue) i++;
      continue;
    }
    // equals-form: --print=<value> carries the prompt in the same token
    if (
      printValue !== null &&
      arg.startsWith("--print=") &&
      arg.slice("--print=".length) === printValue
    ) {
      continue;
    }
    if (positionalLeft.length && arg === positionalLeft[0]) {
      positionalLeft.shift();
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Continue a finished/crashed background session as a NEW background session
 * on the same conversation (`cc daemon resume <id> <prompt>`). The original
 * launch argv is intentionally NOT persisted (it may carry secrets), so the
 * resume runs a minimal `agent --session <sid> -p <prompt>` — model/provider
 * come from config defaults, and the headless runner replays the JSONL
 * transcript for the session id.
 */
export function resumeBackgroundAgent(id, prompt, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  if (state.status === "running") {
    throw new Error(
      `Background agent ${id} is still running — use cc attach ${id} to send follow-up prompts instead`,
    );
  }
  if (!state.sessionId) {
    throw new Error(`Background agent ${id} has no session id to resume from`);
  }
  const text = String(prompt || "").trim();
  if (!text) throw new Error("resume requires a prompt");
  const argv = ["agent", "--session", state.sessionId, "-p", text];
  return launchBackgroundAgent({
    argv,
    cwd: options.cwd || state.cwd || process.cwd(),
    sessionId: state.sessionId,
    title: options.title || state.title || text.slice(0, 100),
    cliEntry: options.cliEntry,
    followUpArgv: ["agent", "--session", state.sessionId],
  });
}

/**
 * Fail fast on an unusable cwd. Without this, spawn() surfaces a bad cwd as
 * an ASYNC 'error' event on the detached child — which nothing listened to
 * (uncaught exception with no context) — and the pre-written state/job files
 * stayed behind as a phantom "running" session. Deleted, file-replaced, and
 * unmounted paths all land here with one clear message.
 */
function assertUsableCwd(cwd) {
  let reason = null;
  if (!cwd) {
    reason = "no working directory given";
  } else if (!existsSync(cwd)) {
    reason = "directory does not exist (deleted or unmounted?)";
  } else {
    try {
      if (!statSync(cwd).isDirectory()) reason = "path is not a directory";
    } catch (err) {
      reason = `directory is not accessible (${err.code || err.message})`;
    }
  }
  if (reason) {
    throw new Error(
      `Cannot launch background agent: cwd "${cwd ?? ""}" — ${reason}`,
    );
  }
}

export function launchBackgroundAgent({
  argv,
  cwd,
  sessionId,
  title,
  cliEntry,
  followUpArgv,
}) {
  assertUsableCwd(cwd);
  const id = createBackgroundAgentId();
  const dir = backgroundAgentsDir();
  const jobFile = join(dir, `${id}.job.${process.pid}.json`);
  const worker = fileURLToPath(
    new URL("../workers/background-agent-worker.js", import.meta.url),
  );
  const job = {
    id,
    argv,
    cwd,
    sessionId,
    title: title || "Background agent",
    cliEntry: cliEntry || process.argv[1],
    logFile: logPath(id),
    // Present = interactive attach can start follow-up turns; absent = the
    // transport rejects prompts (log-only session).
    ...(Array.isArray(followUpArgv) ? { followUpArgv } : {}),
  };
  writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
  // Write the initial state BEFORE spawning so the worker's own merges (the
  // transport endpoint lands within its first ~100ms) can never be clobbered
  // by a late launcher write racing the worker.
  const state = {
    id,
    sessionId,
    title: job.title,
    cwd,
    pid: null,
    workerPid: null,
    agentPid: null,
    status: "running",
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    endedAt: null,
    exitCode: null,
    logFile: job.logFile,
  };
  writeBackgroundAgentState(state);
  let child;
  try {
    child = _deps.spawn(process.execPath, [worker, jobFile], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    rmSync(jobFile, { force: true });
    rmSync(statePath(id), { force: true });
    throw error;
  }
  // Async spawn failures (EPERM, cwd raced away between the check and the
  // spawn, …) arrive as an 'error' event on the detached child. Reap them
  // into the state file instead of leaving a phantom "running" session and
  // an uncaught exception.
  if (typeof child.on === "function") {
    child.on("error", (error) => {
      try {
        rmSync(jobFile, { force: true });
        const current = readBackgroundAgentState(id);
        if (current && current.status === "running") {
          writeBackgroundAgentState({
            ...current,
            status: "failed",
            endedAt: Date.now(),
            lostReason: `spawn-error: ${error.code || error.message}`,
          });
        }
      } catch {
        /* best-effort */
      }
    });
  }
  child.unref();
  const current = readBackgroundAgentState(id) || state;
  const withPid = {
    ...current,
    pid: child.pid,
    workerPid: child.pid,
  };
  writeBackgroundAgentState(withPid);
  return withPid;
}

export function readBackgroundAgentLog(id, options = {}) {
  const file = logPath(id);
  if (!existsSync(file)) return "";
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const limit = Math.max(1, Number(options.lines) || 100);
  return lines.slice(-limit).join("\n");
}

export function stopBackgroundAgent(id) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id));
  if (!state) throw new Error(`Background agent not found: ${id}`);
  if (state.status !== "running") return { ...state, stopped: false };
  if (process.platform === "win32") {
    const killed = _deps.spawnSync(
      "taskkill",
      ["/PID", String(state.pid), "/T", "/F"],
      {
        windowsHide: true,
        encoding: "utf8",
      },
    );
    if (killed.error || (killed.status !== 0 && isProcessAlive(state.pid))) {
      throw new Error(
        `Failed to stop background agent ${id}: ${killed.error?.message || killed.stderr || `taskkill exited ${killed.status}`}`,
      );
    }
  } else {
    try {
      process.kill(-Number(state.pid), "SIGTERM");
    } catch {
      process.kill(Number(state.pid), "SIGTERM");
    }
  }
  const next = {
    ...state,
    status: "stopped",
    endedAt: Date.now(),
    stoppedByUser: true,
  };
  writeBackgroundAgentState(next);
  return { ...next, stopped: true };
}

export function openBackgroundLogFile(id) {
  const fd = openSync(logPath(id), "a", 0o600);
  return { fd, close: () => closeSync(fd) };
}

export function removeJobFile(file) {
  rmSync(file, { force: true });
}
