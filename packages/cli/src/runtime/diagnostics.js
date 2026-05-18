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
import { existsSync, readdirSync } from "node:fs";
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

  return {
    schema: "chainlesschain.doctor.v1",
    version: VERSION,
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
 *   ports: Array<{ name, port, open }>
 * }
 */
export async function collectStatusReport() {
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
  };
}
