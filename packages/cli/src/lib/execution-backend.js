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

// =====================================================================
// execution-backend V2 governance overlay (iter25)
// =====================================================================
export const EBGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  ARCHIVED: "archived",
});
export const EBGOV_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  EXECUTING: "executing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ebgovPTrans = new Map([
  [
    EBGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      EBGOV_PROFILE_MATURITY_V2.ACTIVE,
      EBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EBGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      EBGOV_PROFILE_MATURITY_V2.DEGRADED,
      EBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EBGOV_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      EBGOV_PROFILE_MATURITY_V2.ACTIVE,
      EBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [EBGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ebgovPTerminal = new Set([EBGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ebgovJTrans = new Map([
  [
    EBGOV_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      EBGOV_JOB_LIFECYCLE_V2.EXECUTING,
      EBGOV_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EBGOV_JOB_LIFECYCLE_V2.EXECUTING,
    new Set([
      EBGOV_JOB_LIFECYCLE_V2.SUCCEEDED,
      EBGOV_JOB_LIFECYCLE_V2.FAILED,
      EBGOV_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EBGOV_JOB_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [EBGOV_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [EBGOV_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ebgovPsV2 = new Map();
const _ebgovJsV2 = new Map();
let _ebgovMaxActive = 6,
  _ebgovMaxPending = 15,
  _ebgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ebgovStuckMs = 60 * 1000;
function _ebgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ebgovCheckP(from, to) {
  const a = _ebgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ebgov profile transition ${from} → ${to}`);
}
function _ebgovCheckJ(from, to) {
  const a = _ebgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ebgov job transition ${from} → ${to}`);
}
function _ebgovCountActive(owner) {
  let c = 0;
  for (const p of _ebgovPsV2.values())
    if (p.owner === owner && p.status === EBGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _ebgovCountPending(profileId) {
  let c = 0;
  for (const j of _ebgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === EBGOV_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === EBGOV_JOB_LIFECYCLE_V2.EXECUTING)
    )
      c++;
  return c;
}
export function setMaxActiveEbgovProfilesPerOwnerV2(n) {
  _ebgovMaxActive = _ebgovPos(n, "maxActiveEbgovProfilesPerOwner");
}
export function getMaxActiveEbgovProfilesPerOwnerV2() {
  return _ebgovMaxActive;
}
export function setMaxPendingEbgovJobsPerProfileV2(n) {
  _ebgovMaxPending = _ebgovPos(n, "maxPendingEbgovJobsPerProfile");
}
export function getMaxPendingEbgovJobsPerProfileV2() {
  return _ebgovMaxPending;
}
export function setEbgovProfileIdleMsV2(n) {
  _ebgovIdleMs = _ebgovPos(n, "ebgovProfileIdleMs");
}
export function getEbgovProfileIdleMsV2() {
  return _ebgovIdleMs;
}
export function setEbgovJobStuckMsV2(n) {
  _ebgovStuckMs = _ebgovPos(n, "ebgovJobStuckMs");
}
export function getEbgovJobStuckMsV2() {
  return _ebgovStuckMs;
}
export function _resetStateExecutionBackendGovV2() {
  _ebgovPsV2.clear();
  _ebgovJsV2.clear();
  _ebgovMaxActive = 6;
  _ebgovMaxPending = 15;
  _ebgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ebgovStuckMs = 60 * 1000;
}
export function registerEbgovProfileV2({ id, owner, backend, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ebgovPsV2.has(id)) throw new Error(`ebgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    backend: backend || "local",
    status: EBGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ebgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateEbgovProfileV2(id) {
  const p = _ebgovPsV2.get(id);
  if (!p) throw new Error(`ebgov profile ${id} not found`);
  const isInitial = p.status === EBGOV_PROFILE_MATURITY_V2.PENDING;
  _ebgovCheckP(p.status, EBGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ebgovCountActive(p.owner) >= _ebgovMaxActive)
    throw new Error(`max active ebgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = EBGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function degradeEbgovProfileV2(id) {
  const p = _ebgovPsV2.get(id);
  if (!p) throw new Error(`ebgov profile ${id} not found`);
  _ebgovCheckP(p.status, EBGOV_PROFILE_MATURITY_V2.DEGRADED);
  p.status = EBGOV_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveEbgovProfileV2(id) {
  const p = _ebgovPsV2.get(id);
  if (!p) throw new Error(`ebgov profile ${id} not found`);
  _ebgovCheckP(p.status, EBGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = EBGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchEbgovProfileV2(id) {
  const p = _ebgovPsV2.get(id);
  if (!p) throw new Error(`ebgov profile ${id} not found`);
  if (_ebgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ebgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getEbgovProfileV2(id) {
  const p = _ebgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listEbgovProfilesV2() {
  return [..._ebgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createEbgovJobV2({ id, profileId, task, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ebgovJsV2.has(id)) throw new Error(`ebgov job ${id} already exists`);
  if (!_ebgovPsV2.has(profileId))
    throw new Error(`ebgov profile ${profileId} not found`);
  if (_ebgovCountPending(profileId) >= _ebgovMaxPending)
    throw new Error(`max pending ebgov jobs for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    task: task || "",
    status: EBGOV_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ebgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function executingEbgovJobV2(id) {
  const j = _ebgovJsV2.get(id);
  if (!j) throw new Error(`ebgov job ${id} not found`);
  _ebgovCheckJ(j.status, EBGOV_JOB_LIFECYCLE_V2.EXECUTING);
  const now = Date.now();
  j.status = EBGOV_JOB_LIFECYCLE_V2.EXECUTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeJobEbgovV2(id) {
  const j = _ebgovJsV2.get(id);
  if (!j) throw new Error(`ebgov job ${id} not found`);
  _ebgovCheckJ(j.status, EBGOV_JOB_LIFECYCLE_V2.SUCCEEDED);
  const now = Date.now();
  j.status = EBGOV_JOB_LIFECYCLE_V2.SUCCEEDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failEbgovJobV2(id, reason) {
  const j = _ebgovJsV2.get(id);
  if (!j) throw new Error(`ebgov job ${id} not found`);
  _ebgovCheckJ(j.status, EBGOV_JOB_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = EBGOV_JOB_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelEbgovJobV2(id, reason) {
  const j = _ebgovJsV2.get(id);
  if (!j) throw new Error(`ebgov job ${id} not found`);
  _ebgovCheckJ(j.status, EBGOV_JOB_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = EBGOV_JOB_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getEbgovJobV2(id) {
  const j = _ebgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listEbgovJobsV2() {
  return [..._ebgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdleEbgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ebgovPsV2.values())
    if (
      p.status === EBGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ebgovIdleMs
    ) {
      p.status = EBGOV_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEbgovJobsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ebgovJsV2.values())
    if (
      j.status === EBGOV_JOB_LIFECYCLE_V2.EXECUTING &&
      j.startedAt != null &&
      t - j.startedAt >= _ebgovStuckMs
    ) {
      j.status = EBGOV_JOB_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getExecutionBackendGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(EBGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ebgovPsV2.values()) profilesByStatus[p.status]++;
  const jobsByStatus = {};
  for (const v of Object.values(EBGOV_JOB_LIFECYCLE_V2)) jobsByStatus[v] = 0;
  for (const j of _ebgovJsV2.values()) jobsByStatus[j.status]++;
  return {
    totalEbgovProfilesV2: _ebgovPsV2.size,
    totalEbgovJobsV2: _ebgovJsV2.size,
    maxActiveEbgovProfilesPerOwner: _ebgovMaxActive,
    maxPendingEbgovJobsPerProfile: _ebgovMaxPending,
    ebgovProfileIdleMs: _ebgovIdleMs,
    ebgovJobStuckMs: _ebgovStuckMs,
    profilesByStatus,
    jobsByStatus,
  };
}
