import semver from "semver";
import { GITHUB_RELEASES_URL, VERSION } from "../constants.js";
import logger from "./logger.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/chainlesschain/latest";

export async function checkForUpdates(options = {}) {
  const channel = options.channel || "stable";
  const currentVersion = options.currentVersion || VERSION;

  // Try GitHub releases first (has full release notes and assets)
  try {
    const releases = await fetchReleases();
    const filtered = filterByChannel(releases, channel);

    if (filtered.length > 0) {
      const latest = filtered[0];
      const latestVersion = latest.tag_name.replace(/^v/, "");
      const updateAvailable = semver.gt(latestVersion, currentVersion);

      return {
        updateAvailable,
        currentVersion,
        latestVersion,
        releaseUrl: latest.html_url,
        publishedAt: latest.published_at,
        releaseNotes: latest.body,
        assets: latest.assets.map((a) => ({
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url,
        })),
      };
    }
  } catch (err) {
    logger.verbose(`GitHub release check failed: ${err.message}`);
  }

  // Fallback: check npm registry for CLI package version
  // This catches cases where the GitHub Release CI is still building but npm is already published
  try {
    const npmVersion = await fetchNpmVersion();
    if (npmVersion) {
      const updateAvailable = semver.gt(npmVersion, currentVersion);
      return {
        updateAvailable,
        currentVersion,
        latestVersion: npmVersion,
        releaseUrl: `https://www.npmjs.com/package/chainlesschain/v/${npmVersion}`,
        source: "npm",
      };
    }
  } catch (err) {
    logger.verbose(`npm registry check failed: ${err.message}`);
  }

  return {
    updateAvailable: false,
    currentVersion,
    latestVersion: currentVersion,
    error:
      "Unable to check for updates (GitHub releases and npm registry both unavailable)",
  };
}

async function fetchNpmVersion() {
  const response = await fetch(NPM_REGISTRY_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry error: HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.version || null;
}

async function fetchReleases() {
  const response = await fetch(`${GITHUB_RELEASES_URL}?per_page=20`, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error: HTTP ${response.status}`);
  }
  return response.json();
}

function filterByChannel(releases, channel) {
  switch (channel) {
    case "stable":
      return releases.filter((r) => !r.prerelease && !r.draft);
    case "beta":
      return releases.filter((r) => !r.draft);
    case "dev":
      return releases;
    default:
      return releases.filter((r) => !r.prerelease && !r.draft);
  }
}

export { fetchReleases, filterByChannel };

// =====================================================================
// Version Checker V2 governance overlay
// =====================================================================
export const VCHK_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const VCHK_CHECK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  CHECKING: "checking",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _vchkPTrans = new Map([
  [
    VCHK_PROFILE_MATURITY_V2.PENDING,
    new Set([
      VCHK_PROFILE_MATURITY_V2.ACTIVE,
      VCHK_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    VCHK_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      VCHK_PROFILE_MATURITY_V2.STALE,
      VCHK_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    VCHK_PROFILE_MATURITY_V2.STALE,
    new Set([
      VCHK_PROFILE_MATURITY_V2.ACTIVE,
      VCHK_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [VCHK_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _vchkPTerminal = new Set([VCHK_PROFILE_MATURITY_V2.ARCHIVED]);
const _vchkCTrans = new Map([
  [
    VCHK_CHECK_LIFECYCLE_V2.QUEUED,
    new Set([
      VCHK_CHECK_LIFECYCLE_V2.CHECKING,
      VCHK_CHECK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    VCHK_CHECK_LIFECYCLE_V2.CHECKING,
    new Set([
      VCHK_CHECK_LIFECYCLE_V2.COMPLETED,
      VCHK_CHECK_LIFECYCLE_V2.FAILED,
      VCHK_CHECK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [VCHK_CHECK_LIFECYCLE_V2.COMPLETED, new Set()],
  [VCHK_CHECK_LIFECYCLE_V2.FAILED, new Set()],
  [VCHK_CHECK_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _vchkPsV2 = new Map();
const _vchkCsV2 = new Map();
let _vchkMaxActive = 5,
  _vchkMaxPending = 10,
  _vchkIdleMs = 30 * 24 * 60 * 60 * 1000,
  _vchkStuckMs = 30 * 1000;
function _vchkPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _vchkCheckP(from, to) {
  const a = _vchkPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid vchk profile transition ${from} → ${to}`);
}
function _vchkCheckC(from, to) {
  const a = _vchkCTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid vchk check transition ${from} → ${to}`);
}
function _vchkCountActive(owner) {
  let c = 0;
  for (const p of _vchkPsV2.values())
    if (p.owner === owner && p.status === VCHK_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _vchkCountPending(profileId) {
  let c = 0;
  for (const x of _vchkCsV2.values())
    if (
      x.profileId === profileId &&
      (x.status === VCHK_CHECK_LIFECYCLE_V2.QUEUED ||
        x.status === VCHK_CHECK_LIFECYCLE_V2.CHECKING)
    )
      c++;
  return c;
}
export function setMaxActiveVchkProfilesPerOwnerV2(n) {
  _vchkMaxActive = _vchkPos(n, "maxActiveVchkProfilesPerOwner");
}
export function getMaxActiveVchkProfilesPerOwnerV2() {
  return _vchkMaxActive;
}
export function setMaxPendingVchkChecksPerProfileV2(n) {
  _vchkMaxPending = _vchkPos(n, "maxPendingVchkChecksPerProfile");
}
export function getMaxPendingVchkChecksPerProfileV2() {
  return _vchkMaxPending;
}
export function setVchkProfileIdleMsV2(n) {
  _vchkIdleMs = _vchkPos(n, "vchkProfileIdleMs");
}
export function getVchkProfileIdleMsV2() {
  return _vchkIdleMs;
}
export function setVchkCheckStuckMsV2(n) {
  _vchkStuckMs = _vchkPos(n, "vchkCheckStuckMs");
}
export function getVchkCheckStuckMsV2() {
  return _vchkStuckMs;
}
export function _resetStateVersionCheckerV2() {
  _vchkPsV2.clear();
  _vchkCsV2.clear();
  _vchkMaxActive = 5;
  _vchkMaxPending = 10;
  _vchkIdleMs = 30 * 24 * 60 * 60 * 1000;
  _vchkStuckMs = 30 * 1000;
}
export function registerVchkProfileV2({ id, owner, channel, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_vchkPsV2.has(id)) throw new Error(`vchk profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    channel: channel || "stable",
    status: VCHK_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _vchkPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateVchkProfileV2(id) {
  const p = _vchkPsV2.get(id);
  if (!p) throw new Error(`vchk profile ${id} not found`);
  const isInitial = p.status === VCHK_PROFILE_MATURITY_V2.PENDING;
  _vchkCheckP(p.status, VCHK_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _vchkCountActive(p.owner) >= _vchkMaxActive)
    throw new Error(`max active vchk profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = VCHK_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleVchkProfileV2(id) {
  const p = _vchkPsV2.get(id);
  if (!p) throw new Error(`vchk profile ${id} not found`);
  _vchkCheckP(p.status, VCHK_PROFILE_MATURITY_V2.STALE);
  p.status = VCHK_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveVchkProfileV2(id) {
  const p = _vchkPsV2.get(id);
  if (!p) throw new Error(`vchk profile ${id} not found`);
  _vchkCheckP(p.status, VCHK_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = VCHK_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchVchkProfileV2(id) {
  const p = _vchkPsV2.get(id);
  if (!p) throw new Error(`vchk profile ${id} not found`);
  if (_vchkPTerminal.has(p.status))
    throw new Error(`cannot touch terminal vchk profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getVchkProfileV2(id) {
  const p = _vchkPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listVchkProfilesV2() {
  return [..._vchkPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createVchkCheckV2({
  id,
  profileId,
  currentVersion,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_vchkCsV2.has(id)) throw new Error(`vchk check ${id} already exists`);
  if (!_vchkPsV2.has(profileId))
    throw new Error(`vchk profile ${profileId} not found`);
  if (_vchkCountPending(profileId) >= _vchkMaxPending)
    throw new Error(`max pending vchk checks for profile ${profileId} reached`);
  const now = Date.now();
  const c = {
    id,
    profileId,
    currentVersion: currentVersion || "",
    status: VCHK_CHECK_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _vchkCsV2.set(id, c);
  return { ...c, metadata: { ...c.metadata } };
}
export function checkingVchkCheckV2(id) {
  const c = _vchkCsV2.get(id);
  if (!c) throw new Error(`vchk check ${id} not found`);
  _vchkCheckC(c.status, VCHK_CHECK_LIFECYCLE_V2.CHECKING);
  const now = Date.now();
  c.status = VCHK_CHECK_LIFECYCLE_V2.CHECKING;
  c.updatedAt = now;
  if (!c.startedAt) c.startedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function completeVchkCheckV2(id) {
  const c = _vchkCsV2.get(id);
  if (!c) throw new Error(`vchk check ${id} not found`);
  _vchkCheckC(c.status, VCHK_CHECK_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  c.status = VCHK_CHECK_LIFECYCLE_V2.COMPLETED;
  c.updatedAt = now;
  if (!c.settledAt) c.settledAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function failVchkCheckV2(id, reason) {
  const c = _vchkCsV2.get(id);
  if (!c) throw new Error(`vchk check ${id} not found`);
  _vchkCheckC(c.status, VCHK_CHECK_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  c.status = VCHK_CHECK_LIFECYCLE_V2.FAILED;
  c.updatedAt = now;
  if (!c.settledAt) c.settledAt = now;
  if (reason) c.metadata.failReason = String(reason);
  return { ...c, metadata: { ...c.metadata } };
}
export function cancelVchkCheckV2(id, reason) {
  const c = _vchkCsV2.get(id);
  if (!c) throw new Error(`vchk check ${id} not found`);
  _vchkCheckC(c.status, VCHK_CHECK_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  c.status = VCHK_CHECK_LIFECYCLE_V2.CANCELLED;
  c.updatedAt = now;
  if (!c.settledAt) c.settledAt = now;
  if (reason) c.metadata.cancelReason = String(reason);
  return { ...c, metadata: { ...c.metadata } };
}
export function getVchkCheckV2(id) {
  const c = _vchkCsV2.get(id);
  if (!c) return null;
  return { ...c, metadata: { ...c.metadata } };
}
export function listVchkChecksV2() {
  return [..._vchkCsV2.values()].map((c) => ({
    ...c,
    metadata: { ...c.metadata },
  }));
}
export function autoStaleIdleVchkProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _vchkPsV2.values())
    if (
      p.status === VCHK_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _vchkIdleMs
    ) {
      p.status = VCHK_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckVchkChecksV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const c of _vchkCsV2.values())
    if (
      c.status === VCHK_CHECK_LIFECYCLE_V2.CHECKING &&
      c.startedAt != null &&
      t - c.startedAt >= _vchkStuckMs
    ) {
      c.status = VCHK_CHECK_LIFECYCLE_V2.FAILED;
      c.updatedAt = t;
      if (!c.settledAt) c.settledAt = t;
      c.metadata.failReason = "auto-fail-stuck";
      flipped.push(c.id);
    }
  return { flipped, count: flipped.length };
}
export function getVersionCheckerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(VCHK_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _vchkPsV2.values()) profilesByStatus[p.status]++;
  const checksByStatus = {};
  for (const v of Object.values(VCHK_CHECK_LIFECYCLE_V2)) checksByStatus[v] = 0;
  for (const c of _vchkCsV2.values()) checksByStatus[c.status]++;
  return {
    totalVchkProfilesV2: _vchkPsV2.size,
    totalVchkChecksV2: _vchkCsV2.size,
    maxActiveVchkProfilesPerOwner: _vchkMaxActive,
    maxPendingVchkChecksPerProfile: _vchkMaxPending,
    vchkProfileIdleMs: _vchkIdleMs,
    vchkCheckStuckMs: _vchkStuckMs,
    profilesByStatus,
    checksByStatus,
  };
}
