/**
 * Execution Backend — abstraction for command execution environments.
 *
 * Provides LocalBackend (default), DockerBackend, and SSHBackend.
 * The agent's run_shell and run_code tools delegate to the active backend.
 *
 * Config: .chainlesschain/config.json → agent.executionBackend
 * Feature flag: EXECUTION_BACKENDS (off by default)
 *
 * @module execution-backend
 */

import { execSync } from "node:child_process";

// ─── Exported for test injection ────────────────────────────────────

export const _deps = {
  execSync,
};

// ─── Base class ─────────────────────────────────────────────────────

export class ExecutionBackend {
  constructor(options = {}) {
    this.type = "base";
    this.options = options;
  }

  /**
   * Execute a command.
   * @param {string} command - The command to run
   * @param {object} [opts]
   * @param {string} [opts.cwd] - Working directory
   * @param {number} [opts.timeout] - Timeout in ms
   * @param {number} [opts.maxBuffer] - Max output buffer size
   * @returns {{ stdout: string, stderr: string, exitCode: number }}
   */
  execute(command, opts = {}) {
    throw new Error("execute() must be implemented by subclass");
  }

  /** @returns {string} Backend description for logging */
  describe() {
    return `${this.type} backend`;
  }
}

// ─── Local Backend ──────────────────────────────────────────────────

export class LocalBackend extends ExecutionBackend {
  constructor(options = {}) {
    super(options);
    this.type = "local";
  }

  execute(command, opts = {}) {
    const cwd = opts.cwd || process.cwd();
    const timeout = opts.timeout || 60000;
    const maxBuffer = opts.maxBuffer || 1024 * 1024;

    try {
      const stdout = _deps.execSync(command, {
        cwd,
        encoding: "utf8",
        timeout,
        maxBuffer,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err) {
      return {
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || err.message || "").toString(),
        exitCode: err.status || 1,
      };
    }
  }

  describe() {
    return "local (direct execution)";
  }
}

// ─── Docker Backend ─────────────────────────────────────────────────

export class DockerBackend extends ExecutionBackend {
  /**
   * @param {object} options
   * @param {string} options.container - Container name or ID (for exec mode)
   * @param {string} [options.image] - Image name (for run mode — ephemeral containers)
   * @param {string} [options.workdir] - Working directory inside container
   * @param {string[]} [options.volumes] - Volume mounts (host:container format)
   * @param {string} [options.shell] - Shell to use (default: sh)
   */
  constructor(options = {}) {
    super(options);
    this.type = "docker";
    this.container = options.container || null;
    this.image = options.image || null;
    this.workdir = options.workdir || "/workspace";
    this.volumes = options.volumes || [];
    this.shell = options.shell || "sh";
  }

  execute(command, opts = {}) {
    const timeout = opts.timeout || 60000;
    const maxBuffer = opts.maxBuffer || 1024 * 1024;
    const cwd = opts.cwd || this.workdir;

    let dockerCmd;
    if (this.container) {
      // Exec into existing container
      dockerCmd = `docker exec -w "${cwd}" ${this.container} ${this.shell} -c "${this._escapeCommand(command)}"`;
    } else if (this.image) {
      // Run ephemeral container
      const volumeArgs = this.volumes.map((v) => `-v "${v}"`).join(" ");
      dockerCmd = `docker run --rm -w "${cwd}" ${volumeArgs} ${this.image} ${this.shell} -c "${this._escapeCommand(command)}"`;
    } else {
      return {
        stdout: "",
        stderr: "Docker backend: neither container nor image specified",
        exitCode: 1,
      };
    }

    try {
      const stdout = _deps.execSync(dockerCmd, {
        encoding: "utf8",
        timeout,
        maxBuffer,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err) {
      return {
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || err.message || "").toString(),
        exitCode: err.status || 1,
      };
    }
  }

  _escapeCommand(cmd) {
    return cmd.replace(/"/g, '\\"');
  }

  describe() {
    if (this.container) return `docker exec (container: ${this.container})`;
    return `docker run (image: ${this.image})`;
  }
}

// ─── SSH Backend ────────────────────────────────────────────────────

export class SSHBackend extends ExecutionBackend {
  /**
   * @param {object} options
   * @param {string} options.host - Remote host
   * @param {string} [options.user] - SSH user
   * @param {string} [options.key] - Path to SSH private key
   * @param {number} [options.port] - SSH port (default: 22)
   * @param {string} [options.workdir] - Remote working directory
   */
  constructor(options = {}) {
    super(options);
    this.type = "ssh";
    this.host = options.host;
    this.user = options.user || "";
    this.key = options.key || "";
    this.port = options.port || 22;
    this.workdir = options.workdir || "~";
  }

  execute(command, opts = {}) {
    const timeout = opts.timeout || 60000;
    const maxBuffer = opts.maxBuffer || 1024 * 1024;
    const cwd = opts.cwd || this.workdir;

    if (!this.host) {
      return {
        stdout: "",
        stderr: "SSH backend: host not specified",
        exitCode: 1,
      };
    }

    const userHost = this.user ? `${this.user}@${this.host}` : this.host;
    const keyArg = this.key ? `-i "${this.key}"` : "";
    const portArg = this.port !== 22 ? `-p ${this.port}` : "";
    const remoteCmd = `cd "${cwd}" && ${command}`;

    const sshCmd = `ssh ${keyArg} ${portArg} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${userHost} "${this._escapeCommand(remoteCmd)}"`;

    try {
      const stdout = _deps.execSync(sshCmd, {
        encoding: "utf8",
        timeout,
        maxBuffer,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err) {
      return {
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || err.message || "").toString(),
        exitCode: err.status || 1,
      };
    }
  }

  _escapeCommand(cmd) {
    return cmd.replace(/"/g, '\\"');
  }

  describe() {
    const userHost = this.user ? `${this.user}@${this.host}` : this.host;
    return `ssh (${userHost}:${this.port})`;
  }
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create an execution backend from config.
 * @param {object} [config] - Backend config from config.json
 * @param {string} [config.type] - "local" | "docker" | "ssh"
 * @param {object} [config.options] - Backend-specific options
 * @returns {ExecutionBackend}
 */
export function createBackend(config = {}) {
  const type = (config.type || "local").toLowerCase();

  switch (type) {
    case "docker":
      return new DockerBackend(config.options || {});
    case "ssh":
      return new SSHBackend(config.options || {});
    case "local":
    default:
      return new LocalBackend(config.options || {});
  }
}

// ===== V2 Surface: Execution Backend governance overlay (CLI v0.133.0) =====
export const EXECBE_BACKEND_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});
export const EXECBE_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _ebBackendTrans = new Map([
  [
    EXECBE_BACKEND_MATURITY_V2.PENDING,
    new Set([
      EXECBE_BACKEND_MATURITY_V2.ACTIVE,
      EXECBE_BACKEND_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    EXECBE_BACKEND_MATURITY_V2.ACTIVE,
    new Set([
      EXECBE_BACKEND_MATURITY_V2.DEGRADED,
      EXECBE_BACKEND_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    EXECBE_BACKEND_MATURITY_V2.DEGRADED,
    new Set([
      EXECBE_BACKEND_MATURITY_V2.ACTIVE,
      EXECBE_BACKEND_MATURITY_V2.RETIRED,
    ]),
  ],
  [EXECBE_BACKEND_MATURITY_V2.RETIRED, new Set()],
]);
const _ebBackendTerminal = new Set([EXECBE_BACKEND_MATURITY_V2.RETIRED]);
const _ebJobTrans = new Map([
  [
    EXECBE_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      EXECBE_JOB_LIFECYCLE_V2.RUNNING,
      EXECBE_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EXECBE_JOB_LIFECYCLE_V2.RUNNING,
    new Set([
      EXECBE_JOB_LIFECYCLE_V2.SUCCEEDED,
      EXECBE_JOB_LIFECYCLE_V2.FAILED,
      EXECBE_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EXECBE_JOB_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [EXECBE_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [EXECBE_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _ebBackends = new Map();
const _ebJobs = new Map();
let _ebMaxActivePerOwner = 6;
let _ebMaxPendingPerBackend = 20;
let _ebBackendIdleMs = 12 * 60 * 60 * 1000;
let _ebJobStuckMs = 10 * 60 * 1000;

function _ebPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveBackendsPerOwnerV2(n) {
  _ebMaxActivePerOwner = _ebPos(n, "maxActiveBackendsPerOwner");
}
export function getMaxActiveBackendsPerOwnerV2() {
  return _ebMaxActivePerOwner;
}
export function setMaxPendingJobsPerBackendV2(n) {
  _ebMaxPendingPerBackend = _ebPos(n, "maxPendingJobsPerBackend");
}
export function getMaxPendingJobsPerBackendV2() {
  return _ebMaxPendingPerBackend;
}
export function setBackendIdleMsV2(n) {
  _ebBackendIdleMs = _ebPos(n, "backendIdleMs");
}
export function getBackendIdleMsV2() {
  return _ebBackendIdleMs;
}
export function setExecJobStuckMsV2(n) {
  _ebJobStuckMs = _ebPos(n, "execJobStuckMs");
}
export function getExecJobStuckMsV2() {
  return _ebJobStuckMs;
}

export function _resetStateExecutionBackendV2() {
  _ebBackends.clear();
  _ebJobs.clear();
  _ebMaxActivePerOwner = 6;
  _ebMaxPendingPerBackend = 20;
  _ebBackendIdleMs = 12 * 60 * 60 * 1000;
  _ebJobStuckMs = 10 * 60 * 1000;
}

export function registerBackendV2({ id, owner, kind, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_ebBackends.has(id)) throw new Error(`backend ${id} already registered`);
  const now = Date.now();
  const b = {
    id,
    owner,
    kind: kind || "local",
    status: EXECBE_BACKEND_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _ebBackends.set(id, b);
  return { ...b, metadata: { ...b.metadata } };
}
function _ebCheckB(from, to) {
  const allowed = _ebBackendTrans.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid backend transition ${from} → ${to}`);
}
function _ebCountActive(owner) {
  let n = 0;
  for (const b of _ebBackends.values())
    if (b.owner === owner && b.status === EXECBE_BACKEND_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateBackendV2(id) {
  const b = _ebBackends.get(id);
  if (!b) throw new Error(`backend ${id} not found`);
  _ebCheckB(b.status, EXECBE_BACKEND_MATURITY_V2.ACTIVE);
  const recovery = b.status === EXECBE_BACKEND_MATURITY_V2.DEGRADED;
  if (!recovery) {
    const a = _ebCountActive(b.owner);
    if (a >= _ebMaxActivePerOwner)
      throw new Error(
        `max active backends per owner (${_ebMaxActivePerOwner}) reached for ${b.owner}`,
      );
  }
  const now = Date.now();
  b.status = EXECBE_BACKEND_MATURITY_V2.ACTIVE;
  b.updatedAt = now;
  b.lastTouchedAt = now;
  if (!b.activatedAt) b.activatedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function degradeBackendV2(id) {
  const b = _ebBackends.get(id);
  if (!b) throw new Error(`backend ${id} not found`);
  _ebCheckB(b.status, EXECBE_BACKEND_MATURITY_V2.DEGRADED);
  b.status = EXECBE_BACKEND_MATURITY_V2.DEGRADED;
  b.updatedAt = Date.now();
  return { ...b, metadata: { ...b.metadata } };
}
export function retireBackendV2(id) {
  const b = _ebBackends.get(id);
  if (!b) throw new Error(`backend ${id} not found`);
  _ebCheckB(b.status, EXECBE_BACKEND_MATURITY_V2.RETIRED);
  const now = Date.now();
  b.status = EXECBE_BACKEND_MATURITY_V2.RETIRED;
  b.updatedAt = now;
  if (!b.retiredAt) b.retiredAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function touchBackendV2(id) {
  const b = _ebBackends.get(id);
  if (!b) throw new Error(`backend ${id} not found`);
  if (_ebBackendTerminal.has(b.status))
    throw new Error(`cannot touch terminal backend ${id}`);
  const now = Date.now();
  b.lastTouchedAt = now;
  b.updatedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function getBackendV2(id) {
  const b = _ebBackends.get(id);
  if (!b) return null;
  return { ...b, metadata: { ...b.metadata } };
}
export function listBackendsV2() {
  return [..._ebBackends.values()].map((b) => ({
    ...b,
    metadata: { ...b.metadata },
  }));
}

function _ebCountPending(bid) {
  let n = 0;
  for (const j of _ebJobs.values())
    if (
      j.backendId === bid &&
      (j.status === EXECBE_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === EXECBE_JOB_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createExecJobV2({ id, backendId, command, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!backendId || typeof backendId !== "string")
    throw new Error("backendId is required");
  if (_ebJobs.has(id)) throw new Error(`exec job ${id} already exists`);
  if (!_ebBackends.has(backendId))
    throw new Error(`backend ${backendId} not found`);
  const pending = _ebCountPending(backendId);
  if (pending >= _ebMaxPendingPerBackend)
    throw new Error(
      `max pending jobs per backend (${_ebMaxPendingPerBackend}) reached for ${backendId}`,
    );
  const now = Date.now();
  const j = {
    id,
    backendId,
    command: command || "",
    status: EXECBE_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ebJobs.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
function _ebCheckJ(from, to) {
  const allowed = _ebJobTrans.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid exec job transition ${from} → ${to}`);
}
export function startExecJobV2(id) {
  const j = _ebJobs.get(id);
  if (!j) throw new Error(`exec job ${id} not found`);
  _ebCheckJ(j.status, EXECBE_JOB_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = EXECBE_JOB_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function succeedExecJobV2(id) {
  const j = _ebJobs.get(id);
  if (!j) throw new Error(`exec job ${id} not found`);
  _ebCheckJ(j.status, EXECBE_JOB_LIFECYCLE_V2.SUCCEEDED);
  const now = Date.now();
  j.status = EXECBE_JOB_LIFECYCLE_V2.SUCCEEDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failExecJobV2(id, reason) {
  const j = _ebJobs.get(id);
  if (!j) throw new Error(`exec job ${id} not found`);
  _ebCheckJ(j.status, EXECBE_JOB_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = EXECBE_JOB_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelExecJobV2(id, reason) {
  const j = _ebJobs.get(id);
  if (!j) throw new Error(`exec job ${id} not found`);
  _ebCheckJ(j.status, EXECBE_JOB_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = EXECBE_JOB_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getExecJobV2(id) {
  const j = _ebJobs.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listExecJobsV2() {
  return [..._ebJobs.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}

export function autoDegradeIdleBackendsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const b of _ebBackends.values())
    if (
      b.status === EXECBE_BACKEND_MATURITY_V2.ACTIVE &&
      t - b.lastTouchedAt >= _ebBackendIdleMs
    ) {
      b.status = EXECBE_BACKEND_MATURITY_V2.DEGRADED;
      b.updatedAt = t;
      flipped.push(b.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckExecJobsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ebJobs.values())
    if (
      j.status === EXECBE_JOB_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _ebJobStuckMs
    ) {
      j.status = EXECBE_JOB_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}

export function getExecutionBackendStatsV2() {
  const backendsByStatus = {};
  for (const s of Object.values(EXECBE_BACKEND_MATURITY_V2))
    backendsByStatus[s] = 0;
  for (const b of _ebBackends.values()) backendsByStatus[b.status]++;
  const jobsByStatus = {};
  for (const s of Object.values(EXECBE_JOB_LIFECYCLE_V2)) jobsByStatus[s] = 0;
  for (const j of _ebJobs.values()) jobsByStatus[j.status]++;
  return {
    totalBackendsV2: _ebBackends.size,
    totalJobsV2: _ebJobs.size,
    maxActiveBackendsPerOwner: _ebMaxActivePerOwner,
    maxPendingJobsPerBackend: _ebMaxPendingPerBackend,
    backendIdleMs: _ebBackendIdleMs,
    execJobStuckMs: _ebJobStuckMs,
    backendsByStatus,
    jobsByStatus,
  };
}
