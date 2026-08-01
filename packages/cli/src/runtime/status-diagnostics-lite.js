/** Lightweight, read-only collector used by default `cc status`. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import {
  CONFIG_DIR_NAME,
  DEFAULT_CONFIG,
  DEFAULT_PORTS,
  VERSION,
} from "../constants.js";
import { isExecutableOnPath } from "../lib/executable-path.js";

function checkPort(port, host, timeoutMs, connect = createConnection) {
  return new Promise((resolve) => {
    const socket = connect({ port, host, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function readJson(path, deps) {
  try {
    return JSON.parse(deps.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function findComposeFile(searchPaths, exists = existsSync) {
  for (const directory of searchPaths) {
    for (const name of [
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yml",
      "compose.yaml",
    ]) {
      const candidate = join(directory, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function readAppState(home, deps) {
  const pidFile = join(home, "state", "app.pid");
  if (!deps.exists(pidFile)) return { running: false, pid: null };
  let pid = null;
  try {
    const parsed = Number.parseInt(deps.readFile(pidFile, "utf8").trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
  } catch {
    // A partial/corrupt PID file is reported as stopped; status stays read-only.
  }
  if (pid === null) return { running: false, pid: null };
  try {
    deps.processKill(pid, 0);
    return { running: true, pid };
  } catch {
    return { running: false, pid: null };
  }
}

export async function collectQuickStatusReport(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const timeoutMs = Number.isFinite(options.probeTimeoutMs)
    ? Math.max(1, options.probeTimeoutMs)
    : 500;
  const deps = {
    exists: options.exists || existsSync,
    readFile: options.readFile || readFileSync,
    processKill: options.processKill || process.kill.bind(process),
    home: options.home || homedir,
    executableCheck: options.executableCheck || isExecutableOnPath,
    connect: options.connect || createConnection,
  };
  const home = env.CHAINLESSCHAIN_HOME || join(deps.home(), CONFIG_DIR_NAME);
  const config = readJson(join(home, "config.json"), deps) || {};
  const llm = { ...DEFAULT_CONFIG.llm, ...(config.llm || {}) };
  const setupCompleted = config.setupCompleted === true;
  const dockerAvailable = deps.executableCheck("docker", { env });
  const composePath = dockerAvailable
    ? findComposeFile([cwd, join(cwd, "backend", "docker")], deps.exists)
    : null;
  const ports = await Promise.all(
    Object.entries(DEFAULT_PORTS).map(async ([name, port]) => ({
      name,
      port,
      open: await checkPort(port, "127.0.0.1", timeoutMs, deps.connect),
    })),
  );

  let eventRuntime = { enabled: false, health: null, error: null };
  if (env.CC_EVENT_RUNTIME_DURABLE === "1") {
    const { collectEventRuntimeStatus } = await import("./diagnostics.js");
    eventRuntime = collectEventRuntimeStatus({ env });
  }

  return {
    schema: "chainlesschain.status.v1",
    probeMode: "quick",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    app: readAppState(home, deps),
    setup: setupCompleted
      ? {
          completed: true,
          completedAt: config.completedAt || null,
          edition: config.edition || DEFAULT_CONFIG.edition || null,
          llm: {
            provider: llm.provider || null,
            model: llm.model || null,
          },
        }
      : { completed: false },
    docker: {
      available: dockerAvailable,
      composePath,
      services: null,
      note: dockerAvailable
        ? composePath
          ? "Service details skipped (run with --deep)"
          : "docker-compose.yml not found"
        : "Docker not available",
    },
    ports,
    eventRuntime,
  };
}
