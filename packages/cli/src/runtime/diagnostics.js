/**
 * Runtime diagnostics — machine-readable doctor/status reports.
 *
 * Canonical data collectors for `chainlesschain doctor` and
 * `chainlesschain status`. These return plain JSON-serializable
 * objects that both the human-readable CLI renderers and external
 * consumers (IDE integrations, monitoring) can rely on.
 *
 * Introduced as part of the CLI Runtime Convergence roadmap (Phase 5,
 * 2026-04-09) per ADR decision D6 (machine-readable doctor/status JSON).
 *
 * Refs: docs/implementation-plans/CLI_RUNTIME_CONVERGENCE_ADR.md
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import semver from "semver";

import { MIN_NODE_VERSION, DEFAULT_PORTS, VERSION } from "../constants.js";
import { getHomeDir, getConfigPath, getBinDir } from "../lib/paths.js";
import {
  isDockerAvailable,
  isDockerComposeAvailable,
  getServiceStatus,
  findComposeFile,
} from "../lib/service-manager.js";
import { loadConfig } from "../lib/config-manager.js";
import { isAppRunning, getAppPid } from "../lib/process-manager.js";
import { readDiskVersion, versionDiagnosis } from "../lib/version-skew.js";
import { EventRuntimeStore } from "../lib/event-runtime-store.js";

/** Best-effort read of the npm `latest` cached by the startup update notice. */
function readCachedLatest() {
  try {
    const p = pathJoin(getHomeDir() || "", "update-check.json");
    return JSON.parse(readFileSync(p, "utf-8"))?.latest || null;
  } catch {
    return null;
  }
}

/**
 * Probe a TCP port. Resolves true if something is listening.
 */
export function checkPort(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: timeoutMs });
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

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Verify the personal-data-hub package (lazily loaded by every `cc hub …`
 * command) is fully present on disk.
 *
 * A partial global install — most commonly an interrupted `npm i -g
 * chainlesschain` whose extraction was blocked by a running `cc` process
 * locking a native file (EBUSY) — leaves pdh files unwritten. The hub
 * commands then fail at runtime with a raw ERR_MODULE_NOT_FOUND. Because pdh
 * is lazy-loaded, `cc doctor` itself still starts and can surface this
 * proactively with a one-line repair hint instead of leaving the user to
 * decode a stack trace.
 *
 * Probes the two exported entry points (main + the wechat adapter); CJS
 * require.resolve verifies the target file exists, so a missing file throws.
 * Deps are injectable for unit tests.
 */
export function checkPdhPackageIntegrity(deps = {}) {
  const resolve =
    deps.resolve || ((spec) => createRequire(import.meta.url).resolve(spec));
  const exists = deps.existsSync || existsSync;
  const repair = "Repair: npm i -g chainlesschain@latest";
  const probes = [
    "@chainlesschain/personal-data-hub",
    "@chainlesschain/personal-data-hub/adapters/wechat",
  ];
  try {
    const paths = probes.map((spec) => resolve(spec));
    const missing = paths.filter((p) => !exists(p));
    if (missing.length === 0) return { ok: true, detail: "" };
    return { ok: false, detail: `Incomplete install — ${repair}` };
  } catch {
    return { ok: false, detail: `Missing/unresolvable — ${repair}` };
  }
}

/**
 * Collect a machine-readable doctor report.
 *
 * Shape:
 * {
 *   schema: "chainlesschain.doctor.v1",
 *   version: string,         // CLI version
 *   generatedAt: string,     // ISO timestamp
 *   checks: Array<{ id, name, ok, optional, detail }>,
 *   ports: Array<{ name, port, open }>,
 *   disk: { homeDir, freeGB } | null,
 *   summary: { total, passed, failed, criticalFailed }
 * }
 */
export async function collectDoctorReport() {
  const checks = [];

  // Node.js
  const nodeVersion = process.versions.node;
  const nodeOk = semver.gte(nodeVersion, MIN_NODE_VERSION);
  checks.push({
    id: "node",
    name: `Node.js ${nodeVersion}`,
    ok: nodeOk,
    optional: false,
    detail: nodeOk ? "" : `Requires >=${MIN_NODE_VERSION}`,
  });

  // npm
  const npmVersion = safeExec("npm --version");
  checks.push({
    id: "npm",
    name: npmVersion ? `npm ${npmVersion}` : "npm",
    ok: Boolean(npmVersion),
    optional: false,
    detail: npmVersion ? "" : "Not found",
  });

  // Docker
  const dockerOk = isDockerAvailable();
  checks.push({
    id: "docker",
    name: "Docker",
    ok: dockerOk,
    optional: true,
    detail: dockerOk ? "" : "Not installed (optional)",
  });

  const composeOk = isDockerComposeAvailable();
  checks.push({
    id: "docker-compose",
    name: "Docker Compose",
    ok: composeOk,
    optional: true,
    detail: composeOk ? "" : "Not installed (optional)",
  });

  // Git
  const gitVersion = safeExec("git --version");
  checks.push({
    id: "git",
    name: gitVersion || "Git",
    ok: Boolean(gitVersion),
    optional: false,
    detail: gitVersion ? "" : "Not found",
  });

  // Config directory
  const homeDir = getHomeDir();
  const homeOk = existsSync(homeDir);
  checks.push({
    id: "config-dir",
    name: `Config dir: ${homeDir}`,
    ok: homeOk,
    optional: false,
    detail: homeOk ? "" : 'Run "chainlesschain setup"',
  });

  // Config file
  const configPath = getConfigPath();
  const configOk = existsSync(configPath);
  checks.push({
    id: "config-file",
    name: "Config file",
    ok: configOk,
    optional: false,
    detail: configOk ? "" : 'Run "chainlesschain setup"',
  });

  // Desktop binary
  const binDir = getBinDir();
  const hasBin = existsSync(binDir) && readdirSafe(binDir).length > 0;
  checks.push({
    id: "desktop-binary",
    name: "Desktop binary",
    ok: hasBin,
    optional: true,
    detail: hasBin
      ? ""
      : 'Run "chainlesschain setup" or "chainlesschain update"',
  });

  // Setup completed
  let setupCompleted = false;
  try {
    setupCompleted = Boolean(loadConfig().setupCompleted);
  } catch {
    // loadConfig may throw if config missing
  }
  checks.push({
    id: "setup-completed",
    name: "Setup completed",
    ok: setupCompleted,
    optional: false,
    detail: setupCompleted ? "" : 'Run "chainlesschain setup"',
  });

  // Personal Data Hub package integrity (catches partial/EBUSY-corrupted
  // global installs before the user hits a raw ERR_MODULE_NOT_FOUND from a
  // `cc hub …` command). Optional: non-hub usage works without it.
  const pdh = checkPdhPackageIntegrity();
  checks.push({
    id: "pdh-package",
    name: "Personal Data Hub package",
    ok: pdh.ok,
    optional: true,
    detail: pdh.detail,
  });

  // Port scan
  const ports = [];
  for (const [name, port] of Object.entries(DEFAULT_PORTS)) {
    const open = await checkPort(port);
    ports.push({ name, port, open });
  }

  // Disk (Node 22+ statfsSync)
  let disk = null;
  try {
    const { statfsSync } = await import("node:fs");
    if (typeof statfsSync === "function") {
      const stats = statfsSync(homeDir);
      const freeGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
      disk = { homeDir, freeGB: Number(freeGB.toFixed(2)) };
    }
  } catch {
    // statfsSync unavailable on some platforms
  }

  const failed = checks.filter((c) => !c.ok);
  const criticalFailed = failed.filter((c) => !c.optional);

  // Three-way version check: running (this process) vs installed (on disk) vs
  // latest (npm, from the update-notice cache). Tells the user whether they need
  // `npm i -g` (a new release) or just a restart (already updated on disk).
  const versionCheck = versionDiagnosis({
    running: VERSION,
    installed: readDiskVersion(),
    latest: readCachedLatest(),
  });

  return {
    schema: "chainlesschain.doctor.v1",
    version: VERSION,
    versionCheck,
    generatedAt: new Date().toISOString(),
    checks,
    ports,
    disk,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      criticalFailed: criticalFailed.length,
    },
  };
}

/**
 * Parse `git worktree list --porcelain` output into `{ path, branch }` entries.
 *
 * Pure (no I/O) so it can be unit-tested against fixed fixtures. A detached
 * worktree has no `branch` line and yields `branch: null`.
 */
export function parseGitWorktrees(porcelain) {
  if (!porcelain || typeof porcelain !== "string") return [];
  const entries = [];
  let cur = null;
  for (const line of porcelain.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("worktree ")) {
      if (cur) entries.push(cur);
      cur = { path: trimmed.slice("worktree ".length).trim(), branch: null };
    } else if (trimmed.startsWith("branch ") && cur) {
      cur.branch = trimmed
        .slice("branch ".length)
        .replace("refs/heads/", "")
        .trim();
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

/** Best-effort live git worktree list for the current repo. */
export function collectWorktrees() {
  return parseGitWorktrees(safeExec("git worktree list --porcelain"));
}

/**
 * Map a doctor report + ambient runtime signals into the input contract of
 * `buildDiagnosticBundle` (src/lib/diagnostic-bundle.js).
 *
 * Pure & deterministic aside from reading this process's own platform tags:
 * the caller gathers live signals (env, worktrees, lockfiles) and passes them
 * in, so the mapping itself is unit-testable. Session-runtime fields
 * (connectionState, reconnectHistory, trace, redactionEvents) are absent from a
 * cold `cc doctor` invocation and left to the bundle builder's safe defaults.
 */
export function buildDoctorDiagnosticInput(report, signals = {}) {
  const r = report || {};
  return {
    version: r.version || null,
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.versions?.node || null,
    },
    ports: (Array.isArray(r.ports) ? r.ports : [])
      .filter((p) => p && p.open)
      .map((p) => ({ port: p.port, proto: p.name })),
    worktrees: Array.isArray(signals.worktrees) ? signals.worktrees : [],
    lockfiles: Array.isArray(signals.lockfiles) ? signals.lockfiles : [],
    env: signals.env && typeof signals.env === "object" ? signals.env : {},
    notes: signals.notes != null ? signals.notes : null,
  };
}

/**
 * Collect a machine-readable status report.
 *
 * Shape:
 * {
 *   schema: "chainlesschain.status.v1",
 *   version: string,
 *   generatedAt: string,
 *   app: { running, pid },
 *   setup: { completed, completedAt, edition, llm: { provider, model } } | null,
 *   docker: {
 *     available,
 *     composePath: string | null,
 *     services: Array<{ name, state }> | null,
 *     note: string | null
 *   },
 *   ports: Array<{ name, port, open }>,
 *   eventRuntime: { enabled, health, error }
 * }
 */
export function collectEventRuntimeStatus({
  env = process.env,
  store = null,
} = {}) {
  const enabled = env?.CC_EVENT_RUNTIME_DURABLE === "1";
  if (!enabled && !store) {
    return { enabled: false, health: null, error: null };
  }
  try {
    return {
      enabled,
      health: (store || new EventRuntimeStore()).getHealthSnapshot(),
      error: null,
    };
  } catch (error) {
    return {
      enabled,
      health: null,
      error: {
        code: error?.code || "CC_EVENT_RUNTIME_STATUS_FAILED",
        message: String(error?.message || error),
      },
    };
  }
}

export async function collectStatusReport(options = {}) {
  let config = {};
  try {
    config = loadConfig();
  } catch {
    // loadConfig may throw if config missing
  }

  // App
  const running = isAppRunning();
  const app = {
    running,
    pid: running ? getAppPid() : null,
  };

  // Setup
  const setup = config.setupCompleted
    ? {
        completed: true,
        completedAt: config.completedAt || null,
        edition: config.edition || null,
        llm: config.llm
          ? {
              provider: config.llm.provider || null,
              model: config.llm.model || null,
            }
          : null,
      }
    : { completed: false };

  // Docker services
  const dockerAvailable = isDockerAvailable();
  const docker = {
    available: dockerAvailable,
    composePath: null,
    services: null,
    note: null,
  };

  if (!dockerAvailable) {
    docker.note = "Docker not available";
  } else {
    const composePath = findComposeFile([process.cwd(), "backend/docker"]);
    if (!composePath) {
      docker.note = "docker-compose.yml not found";
    } else {
      docker.composePath = composePath;
      const raw = getServiceStatus(composePath);
      if (Array.isArray(raw)) {
        docker.services = raw.map((svc) => ({
          name: svc.Service || svc.Name || null,
          state: svc.State || null,
        }));
      } else if (raw) {
        docker.note = String(raw);
      } else {
        docker.note = "No services running";
      }
    }
  }

  // Ports
  const ports = [];
  for (const [name, port] of Object.entries(DEFAULT_PORTS)) {
    const open = await checkPort(port);
    ports.push({ name, port, open });
  }

  return {
    schema: "chainlesschain.status.v1",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    app,
    setup,
    docker,
    ports,
    eventRuntime: collectEventRuntimeStatus({
      env: options.eventRuntimeEnv || process.env,
      store: options.eventRuntimeStore || null,
    }),
  };
}
