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
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getHomeDir } from "./paths.js";

export const _deps = { spawn, spawnSync };

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

export function writeBackgroundAgentState(state) {
  const target = statePath(state.id);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
  return state;
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

export function effectiveBackgroundAgentState(state) {
  if (!state) return null;
  if (state.status === "running" && !isProcessAlive(state.pid)) {
    return { ...state, status: "lost", endedAt: state.endedAt || Date.now() };
  }
  return state;
}

export function listBackgroundAgents(options = {}) {
  return readdirSync(backgroundAgentsDir())
    .filter((name) => name.endsWith(".json") && !name.includes(".job."))
    .map((name) => readBackgroundAgentState(name.slice(0, -5)))
    .filter(Boolean)
    .map(effectiveBackgroundAgentState)
    .filter((state) => options.all || state.status === "running")
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function launchBackgroundAgent({
  argv,
  cwd,
  sessionId,
  title,
  cliEntry,
}) {
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
  };
  writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
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
    throw error;
  }
  child.unref();
  const state = {
    id,
    sessionId,
    title: job.title,
    cwd,
    pid: child.pid,
    status: "running",
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    logFile: job.logFile,
  };
  writeBackgroundAgentState(state);
  return state;
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
