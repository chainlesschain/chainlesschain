import { spawn, execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { getPidFilePath, getBinDir, ensureDir, getStatePath } from "./paths.js";
import { isWindows } from "./platform.js";
import logger from "./logger.js";

export function startApp(options = {}) {
  ensureDir(getStatePath());
  const pidFile = getPidFilePath();

  if (isAppRunning()) {
    logger.warn("ChainlessChain is already running");
    return null;
  }

  const binDir = getBinDir();
  let appPath;

  if (options.appPath) {
    appPath = options.appPath;
  } else if (isWindows()) {
    appPath = findExecutable(binDir, ".exe");
  } else {
    appPath = findExecutable(binDir);
  }

  if (!appPath) {
    throw new Error(
      'ChainlessChain binary not found. Run "chainlesschain setup" first.',
    );
  }

  const args = [];
  if (options.headless) {
    args.push("--headless");
  }

  logger.verbose(`Starting: ${appPath} ${args.join(" ")}`);

  const child = spawn(appPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...options.env },
  });

  child.unref();

  writeFileSync(pidFile, String(child.pid), "utf-8");
  logger.verbose(`PID ${child.pid} written to ${pidFile}`);

  return child.pid;
}

export function stopApp() {
  const pidFile = getPidFilePath();

  if (!existsSync(pidFile)) {
    logger.warn("No PID file found. App may not be running.");
    return false;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  try {
    if (isWindows()) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    logger.verbose(`Sent stop signal to PID ${pid}`);
  } catch (err) {
    logger.verbose(`Process ${pid} may have already exited: ${err.message}`);
  }

  unlinkSync(pidFile);
  return true;
}

export function isAppRunning() {
  const pidFile = getPidFilePath();

  if (!existsSync(pidFile)) {
    return false;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    unlinkSync(pidFile);
    return false;
  }
}

export function getAppPid() {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return null;
  return parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
}

function findExecutable(binDir, extension) {
  if (!existsSync(binDir)) return null;
  try {
    // Search recursively for the executable
    const results = [];
    searchDir(binDir, extension, results);
    return results.length > 0 ? results[0] : null;
  } catch {
    return null;
  }
}

function searchDir(dir, extension, results) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      searchDir(fullPath, extension, results);
    } else {
      const name = entry.name.toLowerCase();
      const isChainless = name.includes("chainlesschain");
      if (!isChainless) continue;
      if (extension && name.endsWith(extension)) {
        results.push(fullPath);
      } else if (
        !extension &&
        !name.endsWith(".dmg") &&
        !name.endsWith(".deb") &&
        !name.endsWith(".zip") &&
        !name.endsWith(".sha256") &&
        !name.endsWith(".dll") &&
        !name.endsWith(".dat") &&
        !name.endsWith(".pak") &&
        !name.endsWith(".json")
      ) {
        results.push(fullPath);
      }
    }
  }
}

// =====================================================================
// process-manager V2 governance overlay (iter27)
// =====================================================================
export const PMGRGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STOPPED: "stopped",
  ARCHIVED: "archived",
});
export const PMGRGOV_PROC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  STARTING: "starting",
  RUNNING: "running",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pmgrgovPTrans = new Map([
  [
    PMGRGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
      PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PMGRGOV_PROFILE_MATURITY_V2.STOPPED,
      PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PMGRGOV_PROFILE_MATURITY_V2.STOPPED,
    new Set([
      PMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
      PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pmgrgovPTerminal = new Set([PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _pmgrgovJTrans = new Map([
  [
    PMGRGOV_PROC_LIFECYCLE_V2.QUEUED,
    new Set([
      PMGRGOV_PROC_LIFECYCLE_V2.STARTING,
      PMGRGOV_PROC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PMGRGOV_PROC_LIFECYCLE_V2.STARTING,
    new Set([
      PMGRGOV_PROC_LIFECYCLE_V2.RUNNING,
      PMGRGOV_PROC_LIFECYCLE_V2.FAILED,
      PMGRGOV_PROC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PMGRGOV_PROC_LIFECYCLE_V2.RUNNING, new Set()],
  [PMGRGOV_PROC_LIFECYCLE_V2.FAILED, new Set()],
  [PMGRGOV_PROC_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pmgrgovPsV2 = new Map();
const _pmgrgovJsV2 = new Map();
let _pmgrgovMaxActive = 8,
  _pmgrgovMaxPending = 20,
  _pmgrgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _pmgrgovStuckMs = 60 * 1000;
function _pmgrgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pmgrgovCheckP(from, to) {
  const a = _pmgrgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pmgrgov profile transition ${from} → ${to}`);
}
function _pmgrgovCheckJ(from, to) {
  const a = _pmgrgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pmgrgov proc transition ${from} → ${to}`);
}
function _pmgrgovCountActive(owner) {
  let c = 0;
  for (const p of _pmgrgovPsV2.values())
    if (p.owner === owner && p.status === PMGRGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _pmgrgovCountPending(profileId) {
  let c = 0;
  for (const j of _pmgrgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PMGRGOV_PROC_LIFECYCLE_V2.QUEUED ||
        j.status === PMGRGOV_PROC_LIFECYCLE_V2.STARTING)
    )
      c++;
  return c;
}
export function setMaxActivePmgrgovProfilesPerOwnerV2(n) {
  _pmgrgovMaxActive = _pmgrgovPos(n, "maxActivePmgrgovProfilesPerOwner");
}
export function getMaxActivePmgrgovProfilesPerOwnerV2() {
  return _pmgrgovMaxActive;
}
export function setMaxPendingPmgrgovProcsPerProfileV2(n) {
  _pmgrgovMaxPending = _pmgrgovPos(n, "maxPendingPmgrgovProcsPerProfile");
}
export function getMaxPendingPmgrgovProcsPerProfileV2() {
  return _pmgrgovMaxPending;
}
export function setPmgrgovProfileIdleMsV2(n) {
  _pmgrgovIdleMs = _pmgrgovPos(n, "pmgrgovProfileIdleMs");
}
export function getPmgrgovProfileIdleMsV2() {
  return _pmgrgovIdleMs;
}
export function setPmgrgovProcStuckMsV2(n) {
  _pmgrgovStuckMs = _pmgrgovPos(n, "pmgrgovProcStuckMs");
}
export function getPmgrgovProcStuckMsV2() {
  return _pmgrgovStuckMs;
}
export function _resetStateProcessManagerGovV2() {
  _pmgrgovPsV2.clear();
  _pmgrgovJsV2.clear();
  _pmgrgovMaxActive = 8;
  _pmgrgovMaxPending = 20;
  _pmgrgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _pmgrgovStuckMs = 60 * 1000;
}
export function registerPmgrgovProfileV2({ id, owner, kind, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pmgrgovPsV2.has(id))
    throw new Error(`pmgrgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    kind: kind || "service",
    status: PMGRGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pmgrgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePmgrgovProfileV2(id) {
  const p = _pmgrgovPsV2.get(id);
  if (!p) throw new Error(`pmgrgov profile ${id} not found`);
  const isInitial = p.status === PMGRGOV_PROFILE_MATURITY_V2.PENDING;
  _pmgrgovCheckP(p.status, PMGRGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pmgrgovCountActive(p.owner) >= _pmgrgovMaxActive)
    throw new Error(`max active pmgrgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PMGRGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stopPmgrgovProfileV2(id) {
  const p = _pmgrgovPsV2.get(id);
  if (!p) throw new Error(`pmgrgov profile ${id} not found`);
  _pmgrgovCheckP(p.status, PMGRGOV_PROFILE_MATURITY_V2.STOPPED);
  p.status = PMGRGOV_PROFILE_MATURITY_V2.STOPPED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePmgrgovProfileV2(id) {
  const p = _pmgrgovPsV2.get(id);
  if (!p) throw new Error(`pmgrgov profile ${id} not found`);
  _pmgrgovCheckP(p.status, PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PMGRGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPmgrgovProfileV2(id) {
  const p = _pmgrgovPsV2.get(id);
  if (!p) throw new Error(`pmgrgov profile ${id} not found`);
  if (_pmgrgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pmgrgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPmgrgovProfileV2(id) {
  const p = _pmgrgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPmgrgovProfilesV2() {
  return [..._pmgrgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPmgrgovProcV2({ id, profileId, command, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pmgrgovJsV2.has(id))
    throw new Error(`pmgrgov proc ${id} already exists`);
  if (!_pmgrgovPsV2.has(profileId))
    throw new Error(`pmgrgov profile ${profileId} not found`);
  if (_pmgrgovCountPending(profileId) >= _pmgrgovMaxPending)
    throw new Error(
      `max pending pmgrgov procs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    command: command || "",
    status: PMGRGOV_PROC_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pmgrgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function startingPmgrgovProcV2(id) {
  const j = _pmgrgovJsV2.get(id);
  if (!j) throw new Error(`pmgrgov proc ${id} not found`);
  _pmgrgovCheckJ(j.status, PMGRGOV_PROC_LIFECYCLE_V2.STARTING);
  const now = Date.now();
  j.status = PMGRGOV_PROC_LIFECYCLE_V2.STARTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeProcPmgrgovV2(id) {
  const j = _pmgrgovJsV2.get(id);
  if (!j) throw new Error(`pmgrgov proc ${id} not found`);
  _pmgrgovCheckJ(j.status, PMGRGOV_PROC_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = PMGRGOV_PROC_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPmgrgovProcV2(id, reason) {
  const j = _pmgrgovJsV2.get(id);
  if (!j) throw new Error(`pmgrgov proc ${id} not found`);
  _pmgrgovCheckJ(j.status, PMGRGOV_PROC_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PMGRGOV_PROC_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPmgrgovProcV2(id, reason) {
  const j = _pmgrgovJsV2.get(id);
  if (!j) throw new Error(`pmgrgov proc ${id} not found`);
  _pmgrgovCheckJ(j.status, PMGRGOV_PROC_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PMGRGOV_PROC_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPmgrgovProcV2(id) {
  const j = _pmgrgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPmgrgovProcsV2() {
  return [..._pmgrgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStopIdlePmgrgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pmgrgovPsV2.values())
    if (
      p.status === PMGRGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pmgrgovIdleMs
    ) {
      p.status = PMGRGOV_PROFILE_MATURITY_V2.STOPPED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPmgrgovProcsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _pmgrgovJsV2.values())
    if (
      j.status === PMGRGOV_PROC_LIFECYCLE_V2.STARTING &&
      j.startedAt != null &&
      t - j.startedAt >= _pmgrgovStuckMs
    ) {
      j.status = PMGRGOV_PROC_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getProcessManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PMGRGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pmgrgovPsV2.values()) profilesByStatus[p.status]++;
  const procsByStatus = {};
  for (const v of Object.values(PMGRGOV_PROC_LIFECYCLE_V2))
    procsByStatus[v] = 0;
  for (const j of _pmgrgovJsV2.values()) procsByStatus[j.status]++;
  return {
    totalPmgrgovProfilesV2: _pmgrgovPsV2.size,
    totalPmgrgovProcsV2: _pmgrgovJsV2.size,
    maxActivePmgrgovProfilesPerOwner: _pmgrgovMaxActive,
    maxPendingPmgrgovProcsPerProfile: _pmgrgovMaxPending,
    pmgrgovProfileIdleMs: _pmgrgovIdleMs,
    pmgrgovProcStuckMs: _pmgrgovStuckMs,
    profilesByStatus,
    procsByStatus,
  };
}
