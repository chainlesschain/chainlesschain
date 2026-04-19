import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import logger from "./logger.js";

export function isDockerAvailable() {
  try {
    execSync("docker --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isDockerComposeAvailable() {
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return true;
  } catch {
    try {
      execSync("docker-compose --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function getComposeCommand() {
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return "docker compose";
  } catch {
    return "docker-compose";
  }
}

export function findComposeFile(searchPaths) {
  const names = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];
  for (const dir of searchPaths) {
    for (const name of names) {
      const filePath = join(dir, name);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return null;
}

export function servicesUp(composePath, options = {}) {
  const cmd = getComposeCommand();
  const args = ["-f", composePath, "up", "-d"];
  if (options.services) {
    args.push(...options.services);
  }
  return runCompose(cmd, args);
}

export function servicesDown(composePath) {
  const cmd = getComposeCommand();
  return runCompose(cmd, ["-f", composePath, "down"]);
}

export function servicesLogs(composePath, options = {}) {
  const cmd = getComposeCommand();
  const args = ["-f", composePath, "logs"];
  if (options.follow) args.push("-f");
  if (options.tail) args.push("--tail", String(options.tail));
  if (options.services) args.push(...options.services);

  const parts = cmd.split(" ");
  const child = spawn(parts[0], [...parts.slice(1), ...args], {
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose logs exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

export function servicesPull(composePath) {
  const cmd = getComposeCommand();
  return runCompose(cmd, ["-f", composePath, "pull"]);
}

export function getServiceStatus(composePath) {
  const cmd = getComposeCommand();
  try {
    const output = execSync(`${cmd} -f "${composePath}" ps --format json`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    try {
      return JSON.parse(`[${output.trim().split("\n").join(",")}]`);
    } catch {
      return output.trim();
    }
  } catch {
    return null;
  }
}

function runCompose(cmd, args) {
  const fullCmd = `${cmd} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
  logger.verbose(`Running: ${fullCmd}`);
  try {
    execSync(fullCmd, { stdio: "inherit" });
    return true;
  } catch (err) {
    logger.error(`Command failed: ${fullCmd}`);
    throw err;
  }
}

// =====================================================================
// service-manager V2 governance overlay (iter27)
// =====================================================================
export const SMGRGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  ARCHIVED: "archived",
});
export const SMGRGOV_OP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  OPERATING: "operating",
  OPERATED: "operated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _smgrgovPTrans = new Map([
  [
    SMGRGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
      SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SMGRGOV_PROFILE_MATURITY_V2.DEGRADED,
      SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SMGRGOV_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      SMGRGOV_PROFILE_MATURITY_V2.ACTIVE,
      SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _smgrgovPTerminal = new Set([SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _smgrgovJTrans = new Map([
  [
    SMGRGOV_OP_LIFECYCLE_V2.QUEUED,
    new Set([
      SMGRGOV_OP_LIFECYCLE_V2.OPERATING,
      SMGRGOV_OP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SMGRGOV_OP_LIFECYCLE_V2.OPERATING,
    new Set([
      SMGRGOV_OP_LIFECYCLE_V2.OPERATED,
      SMGRGOV_OP_LIFECYCLE_V2.FAILED,
      SMGRGOV_OP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SMGRGOV_OP_LIFECYCLE_V2.OPERATED, new Set()],
  [SMGRGOV_OP_LIFECYCLE_V2.FAILED, new Set()],
  [SMGRGOV_OP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _smgrgovPsV2 = new Map();
const _smgrgovJsV2 = new Map();
let _smgrgovMaxActive = 8,
  _smgrgovMaxPending = 20,
  _smgrgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _smgrgovStuckMs = 60 * 1000;
function _smgrgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _smgrgovCheckP(from, to) {
  const a = _smgrgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid smgrgov profile transition ${from} → ${to}`);
}
function _smgrgovCheckJ(from, to) {
  const a = _smgrgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid smgrgov op transition ${from} → ${to}`);
}
function _smgrgovCountActive(owner) {
  let c = 0;
  for (const p of _smgrgovPsV2.values())
    if (p.owner === owner && p.status === SMGRGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _smgrgovCountPending(profileId) {
  let c = 0;
  for (const j of _smgrgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SMGRGOV_OP_LIFECYCLE_V2.QUEUED ||
        j.status === SMGRGOV_OP_LIFECYCLE_V2.OPERATING)
    )
      c++;
  return c;
}
export function setMaxActiveSmgrgovProfilesPerOwnerV2(n) {
  _smgrgovMaxActive = _smgrgovPos(n, "maxActiveSmgrgovProfilesPerOwner");
}
export function getMaxActiveSmgrgovProfilesPerOwnerV2() {
  return _smgrgovMaxActive;
}
export function setMaxPendingSmgrgovOpsPerProfileV2(n) {
  _smgrgovMaxPending = _smgrgovPos(n, "maxPendingSmgrgovOpsPerProfile");
}
export function getMaxPendingSmgrgovOpsPerProfileV2() {
  return _smgrgovMaxPending;
}
export function setSmgrgovProfileIdleMsV2(n) {
  _smgrgovIdleMs = _smgrgovPos(n, "smgrgovProfileIdleMs");
}
export function getSmgrgovProfileIdleMsV2() {
  return _smgrgovIdleMs;
}
export function setSmgrgovOpStuckMsV2(n) {
  _smgrgovStuckMs = _smgrgovPos(n, "smgrgovOpStuckMs");
}
export function getSmgrgovOpStuckMsV2() {
  return _smgrgovStuckMs;
}
export function _resetStateServiceManagerGovV2() {
  _smgrgovPsV2.clear();
  _smgrgovJsV2.clear();
  _smgrgovMaxActive = 8;
  _smgrgovMaxPending = 20;
  _smgrgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _smgrgovStuckMs = 60 * 1000;
}
export function registerSmgrgovProfileV2({
  id,
  owner,
  service,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_smgrgovPsV2.has(id))
    throw new Error(`smgrgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    service: service || "default",
    status: SMGRGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _smgrgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSmgrgovProfileV2(id) {
  const p = _smgrgovPsV2.get(id);
  if (!p) throw new Error(`smgrgov profile ${id} not found`);
  const isInitial = p.status === SMGRGOV_PROFILE_MATURITY_V2.PENDING;
  _smgrgovCheckP(p.status, SMGRGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _smgrgovCountActive(p.owner) >= _smgrgovMaxActive)
    throw new Error(`max active smgrgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SMGRGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function degradeSmgrgovProfileV2(id) {
  const p = _smgrgovPsV2.get(id);
  if (!p) throw new Error(`smgrgov profile ${id} not found`);
  _smgrgovCheckP(p.status, SMGRGOV_PROFILE_MATURITY_V2.DEGRADED);
  p.status = SMGRGOV_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSmgrgovProfileV2(id) {
  const p = _smgrgovPsV2.get(id);
  if (!p) throw new Error(`smgrgov profile ${id} not found`);
  _smgrgovCheckP(p.status, SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SMGRGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSmgrgovProfileV2(id) {
  const p = _smgrgovPsV2.get(id);
  if (!p) throw new Error(`smgrgov profile ${id} not found`);
  if (_smgrgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal smgrgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSmgrgovProfileV2(id) {
  const p = _smgrgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSmgrgovProfilesV2() {
  return [..._smgrgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSmgrgovOpV2({ id, profileId, action, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_smgrgovJsV2.has(id)) throw new Error(`smgrgov op ${id} already exists`);
  if (!_smgrgovPsV2.has(profileId))
    throw new Error(`smgrgov profile ${profileId} not found`);
  if (_smgrgovCountPending(profileId) >= _smgrgovMaxPending)
    throw new Error(`max pending smgrgov ops for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    action: action || "",
    status: SMGRGOV_OP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _smgrgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function operatingSmgrgovOpV2(id) {
  const j = _smgrgovJsV2.get(id);
  if (!j) throw new Error(`smgrgov op ${id} not found`);
  _smgrgovCheckJ(j.status, SMGRGOV_OP_LIFECYCLE_V2.OPERATING);
  const now = Date.now();
  j.status = SMGRGOV_OP_LIFECYCLE_V2.OPERATING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeOpSmgrgovV2(id) {
  const j = _smgrgovJsV2.get(id);
  if (!j) throw new Error(`smgrgov op ${id} not found`);
  _smgrgovCheckJ(j.status, SMGRGOV_OP_LIFECYCLE_V2.OPERATED);
  const now = Date.now();
  j.status = SMGRGOV_OP_LIFECYCLE_V2.OPERATED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSmgrgovOpV2(id, reason) {
  const j = _smgrgovJsV2.get(id);
  if (!j) throw new Error(`smgrgov op ${id} not found`);
  _smgrgovCheckJ(j.status, SMGRGOV_OP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SMGRGOV_OP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSmgrgovOpV2(id, reason) {
  const j = _smgrgovJsV2.get(id);
  if (!j) throw new Error(`smgrgov op ${id} not found`);
  _smgrgovCheckJ(j.status, SMGRGOV_OP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SMGRGOV_OP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSmgrgovOpV2(id) {
  const j = _smgrgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSmgrgovOpsV2() {
  return [..._smgrgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdleSmgrgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _smgrgovPsV2.values())
    if (
      p.status === SMGRGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _smgrgovIdleMs
    ) {
      p.status = SMGRGOV_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSmgrgovOpsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _smgrgovJsV2.values())
    if (
      j.status === SMGRGOV_OP_LIFECYCLE_V2.OPERATING &&
      j.startedAt != null &&
      t - j.startedAt >= _smgrgovStuckMs
    ) {
      j.status = SMGRGOV_OP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getServiceManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SMGRGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _smgrgovPsV2.values()) profilesByStatus[p.status]++;
  const opsByStatus = {};
  for (const v of Object.values(SMGRGOV_OP_LIFECYCLE_V2)) opsByStatus[v] = 0;
  for (const j of _smgrgovJsV2.values()) opsByStatus[j.status]++;
  return {
    totalSmgrgovProfilesV2: _smgrgovPsV2.size,
    totalSmgrgovOpsV2: _smgrgovJsV2.size,
    maxActiveSmgrgovProfilesPerOwner: _smgrgovMaxActive,
    maxPendingSmgrgovOpsPerProfile: _smgrgovMaxPending,
    smgrgovProfileIdleMs: _smgrgovIdleMs,
    smgrgovOpStuckMs: _smgrgovStuckMs,
    profilesByStatus,
    opsByStatus,
  };
}
