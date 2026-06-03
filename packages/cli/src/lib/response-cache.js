/**
 * Response cache for CLI
 *
 * Caches LLM responses to avoid redundant API calls.
 * Lightweight port of desktop-app-vue/src/main/llm/response-cache.js
 */

import { createHash } from "crypto";

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_SIZE = 500;

function ensureCacheTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_content TEXT NOT NULL,
      response_tokens INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
}

/**
 * Generate a cache key from request parameters
 */
function generateCacheKey(provider, model, messages) {
  const payload = JSON.stringify({ provider, model, messages });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Look up a cached response
 * @returns {{ hit: boolean, response?: string, tokensSaved?: number, cacheAge?: number }}
 */
export function getCachedResponse(db, provider, model, messages) {
  ensureCacheTable(db);

  const key = generateCacheKey(provider, model, messages);

  const row = db
    .prepare(
      `SELECT * FROM llm_cache WHERE cache_key = ? AND expires_at > datetime('now')`,
    )
    .get(key);

  if (!row) {
    return { hit: false };
  }

  // Update access stats
  db.prepare(
    `UPDATE llm_cache SET hit_count = hit_count + 1, last_accessed_at = datetime('now') WHERE cache_key = ?`,
  ).run(key);

  return {
    hit: true,
    response: row.response_content,
    tokensSaved: row.response_tokens,
    cacheAge: Date.now() - new Date(row.created_at).getTime(),
  };
}

/**
 * Store a response in cache
 */
export function setCachedResponse(
  db,
  provider,
  model,
  messages,
  response,
  options = {},
) {
  ensureCacheTable(db);

  const key = generateCacheKey(provider, model, messages);
  const requestHash = createHash("md5")
    .update(JSON.stringify(messages))
    .digest("hex");
  const ttl = options.ttl || DEFAULT_TTL;
  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const responseTokens = options.responseTokens || 0;

  // LRU eviction if needed
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM llm_cache").get();
  const count = countRow?.cnt || 0;
  if (count >= maxSize) {
    db.prepare(
      `DELETE FROM llm_cache WHERE cache_key IN (
        SELECT cache_key FROM llm_cache ORDER BY last_accessed_at ASC, created_at ASC LIMIT ?
      )`,
    ).run(Math.max(1, Math.ceil(maxSize * 0.1)));
  }

  db.prepare(
    `INSERT OR REPLACE INTO llm_cache (cache_key, provider, model, request_hash, response_content, response_tokens, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(key, provider, model, requestHash, response, responseTokens, expiresAt);
}

/**
 * Clear all cached responses
 */
export function clearCache(db) {
  ensureCacheTable(db);
  db.prepare("DELETE FROM llm_cache").run();
}

/**
 * Remove expired entries
 */
export function clearExpired(db) {
  ensureCacheTable(db);
  const result = db
    .prepare("DELETE FROM llm_cache WHERE expires_at <= datetime('now')")
    .run();
  return result.changes;
}

/**
 * Get cache statistics
 */
export function getCacheStats(db) {
  ensureCacheTable(db);

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total_entries,
        COALESCE(SUM(hit_count), 0) as total_hits,
        COALESCE(SUM(response_tokens), 0) as total_tokens_saved
      FROM llm_cache`,
    )
    .get();

  const expired = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM llm_cache WHERE expires_at <= datetime('now')",
    )
    .get();

  return {
    total_entries: stats?.total_entries || 0,
    total_hits: stats?.total_hits || 0,
    total_tokens_saved: stats?.total_tokens_saved || 0,
    expired_entries: expired?.cnt || 0,
  };
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Response cache governance layer.
 * Tracks per-owner cache-profile maturity + per-profile refresh-job
 * lifecycle independent of SQLite llm_cache table.
 * ═══════════════════════════════════════════════════════════════ */

export const PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});

export const REFRESH_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const PROFILE_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["active", "archived"])],
  ["active", new Set(["suspended", "archived"])],
  ["suspended", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const PROFILE_TERMINALS_V2 = new Set(["archived"]);

const REFRESH_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "cancelled"])],
  ["running", new Set(["completed", "failed", "cancelled"])],
  ["completed", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);
const REFRESH_TERMINALS_V2 = new Set(["completed", "failed", "cancelled"]);

export const CACHE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER = 25;
export const CACHE_DEFAULT_MAX_PENDING_REFRESH_JOBS_PER_PROFILE = 4;
export const CACHE_DEFAULT_PROFILE_IDLE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const CACHE_DEFAULT_REFRESH_STUCK_MS = 1000 * 60 * 10; // 10 min

const _profilesV2 = new Map();
const _refreshJobsV2 = new Map();
let _maxActiveProfilesPerOwnerV2 = CACHE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER;
let _maxPendingRefreshJobsPerProfileV2 =
  CACHE_DEFAULT_MAX_PENDING_REFRESH_JOBS_PER_PROFILE;
let _profileIdleMsV2 = CACHE_DEFAULT_PROFILE_IDLE_MS;
let _refreshStuckMsV2 = CACHE_DEFAULT_REFRESH_STUCK_MS;

function _posIntCacheV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveProfilesPerOwnerV2() {
  return _maxActiveProfilesPerOwnerV2;
}
export function setMaxActiveProfilesPerOwnerV2(n) {
  _maxActiveProfilesPerOwnerV2 = _posIntCacheV2(n, "maxActiveProfilesPerOwner");
}
export function getMaxPendingRefreshJobsPerProfileV2() {
  return _maxPendingRefreshJobsPerProfileV2;
}
export function setMaxPendingRefreshJobsPerProfileV2(n) {
  _maxPendingRefreshJobsPerProfileV2 = _posIntCacheV2(
    n,
    "maxPendingRefreshJobsPerProfile",
  );
}
export function getProfileIdleMsV2() {
  return _profileIdleMsV2;
}
export function setProfileIdleMsV2(n) {
  _profileIdleMsV2 = _posIntCacheV2(n, "profileIdleMs");
}
export function getRefreshStuckMsV2() {
  return _refreshStuckMsV2;
}
export function setRefreshStuckMsV2(n) {
  _refreshStuckMsV2 = _posIntCacheV2(n, "refreshStuckMs");
}

export function getActiveProfileCountV2(ownerId) {
  let n = 0;
  for (const p of _profilesV2.values()) {
    if (p.ownerId === ownerId && p.status === "active") n += 1;
  }
  return n;
}

export function getPendingRefreshJobCountV2(profileId) {
  let n = 0;
  for (const j of _refreshJobsV2.values()) {
    if (
      j.profileId === profileId &&
      (j.status === "queued" || j.status === "running")
    )
      n += 1;
  }
  return n;
}

function _copyProfileV2(p) {
  return { ...p, metadata: { ...p.metadata } };
}
function _copyRefreshJobV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function registerProfileV2(
  id,
  { ownerId, label, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!ownerId || typeof ownerId !== "string")
    throw new Error("ownerId must be a string");
  if (!label || typeof label !== "string")
    throw new Error("label must be a string");
  if (_profilesV2.has(id)) throw new Error(`profile ${id} already exists`);
  const p = {
    id,
    ownerId,
    label,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _profilesV2.set(id, p);
  return _copyProfileV2(p);
}

export function getProfileV2(id) {
  const p = _profilesV2.get(id);
  return p ? _copyProfileV2(p) : null;
}

export function listProfilesV2({ ownerId, status } = {}) {
  const out = [];
  for (const p of _profilesV2.values()) {
    if (ownerId && p.ownerId !== ownerId) continue;
    if (status && p.status !== status) continue;
    out.push(_copyProfileV2(p));
  }
  return out;
}

export function setProfileStatusV2(id, next, { now = Date.now() } = {}) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  if (!PROFILE_TRANSITIONS_V2.has(next))
    throw new Error(`unknown profile status: ${next}`);
  if (PROFILE_TERMINALS_V2.has(p.status))
    throw new Error(`profile ${id} is in terminal state ${p.status}`);
  const allowed = PROFILE_TRANSITIONS_V2.get(p.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition profile from ${p.status} to ${next}`);
  if (next === "active") {
    if (p.status === "pending") {
      const count = getActiveProfileCountV2(p.ownerId);
      if (count >= _maxActiveProfilesPerOwnerV2)
        throw new Error(
          `owner ${p.ownerId} already at active-profile cap (${_maxActiveProfilesPerOwnerV2})`,
        );
    }
    if (!p.activatedAt) p.activatedAt = now;
  }
  if (next === "archived" && !p.archivedAt) p.archivedAt = now;
  p.status = next;
  p.lastSeenAt = now;
  return _copyProfileV2(p);
}

export function activateProfileV2(id, opts) {
  return setProfileStatusV2(id, "active", opts);
}
export function suspendProfileV2(id, opts) {
  return setProfileStatusV2(id, "suspended", opts);
}
export function archiveProfileV2(id, opts) {
  return setProfileStatusV2(id, "archived", opts);
}

export function touchProfileV2(id, { now = Date.now() } = {}) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  p.lastSeenAt = now;
  return _copyProfileV2(p);
}

export function createRefreshJobV2(
  id,
  { profileId, kind = "warm", metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId must be a string");
  if (_refreshJobsV2.has(id)) throw new Error(`job ${id} already exists`);
  const count = getPendingRefreshJobCountV2(profileId);
  if (count >= _maxPendingRefreshJobsPerProfileV2)
    throw new Error(
      `profile ${profileId} already at pending-refresh-job cap (${_maxPendingRefreshJobsPerProfileV2})`,
    );
  const j = {
    id,
    profileId,
    kind,
    status: "queued",
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _refreshJobsV2.set(id, j);
  return _copyRefreshJobV2(j);
}

export function getRefreshJobV2(id) {
  const j = _refreshJobsV2.get(id);
  return j ? _copyRefreshJobV2(j) : null;
}

export function listRefreshJobsV2({ profileId, status } = {}) {
  const out = [];
  for (const j of _refreshJobsV2.values()) {
    if (profileId && j.profileId !== profileId) continue;
    if (status && j.status !== status) continue;
    out.push(_copyRefreshJobV2(j));
  }
  return out;
}

export function setRefreshJobStatusV2(id, next, { now = Date.now() } = {}) {
  const j = _refreshJobsV2.get(id);
  if (!j) throw new Error(`job ${id} not found`);
  if (!REFRESH_TRANSITIONS_V2.has(next))
    throw new Error(`unknown job status: ${next}`);
  if (REFRESH_TERMINALS_V2.has(j.status))
    throw new Error(`job ${id} is in terminal state ${j.status}`);
  const allowed = REFRESH_TRANSITIONS_V2.get(j.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition job from ${j.status} to ${next}`);
  if (next === "running" && !j.startedAt) j.startedAt = now;
  if (REFRESH_TERMINALS_V2.has(next) && !j.settledAt) j.settledAt = now;
  j.status = next;
  j.lastSeenAt = now;
  return _copyRefreshJobV2(j);
}

export function startRefreshJobV2(id, opts) {
  return setRefreshJobStatusV2(id, "running", opts);
}
export function completeRefreshJobV2(id, opts) {
  return setRefreshJobStatusV2(id, "completed", opts);
}
export function failRefreshJobV2(id, opts) {
  return setRefreshJobStatusV2(id, "failed", opts);
}
export function cancelRefreshJobV2(id, opts) {
  return setRefreshJobStatusV2(id, "cancelled", opts);
}

export function autoSuspendIdleProfilesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const p of _profilesV2.values()) {
    if (p.status !== "active") continue;
    if (now - p.lastSeenAt > _profileIdleMsV2) {
      p.status = "suspended";
      p.lastSeenAt = now;
      flipped.push(_copyProfileV2(p));
    }
  }
  return flipped;
}

export function autoFailStuckRefreshJobsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const j of _refreshJobsV2.values()) {
    if (j.status !== "running") continue;
    if (now - j.lastSeenAt > _refreshStuckMsV2) {
      j.status = "failed";
      j.lastSeenAt = now;
      if (!j.settledAt) j.settledAt = now;
      flipped.push(_copyRefreshJobV2(j));
    }
  }
  return flipped;
}

export function getResponseCacheStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PROFILE_MATURITY_V2)) profilesByStatus[v] = 0;
  for (const p of _profilesV2.values()) profilesByStatus[p.status] += 1;

  const jobsByStatus = {};
  for (const v of Object.values(REFRESH_JOB_LIFECYCLE_V2)) jobsByStatus[v] = 0;
  for (const j of _refreshJobsV2.values()) jobsByStatus[j.status] += 1;

  return {
    totalProfilesV2: _profilesV2.size,
    totalRefreshJobsV2: _refreshJobsV2.size,
    maxActiveProfilesPerOwner: _maxActiveProfilesPerOwnerV2,
    maxPendingRefreshJobsPerProfile: _maxPendingRefreshJobsPerProfileV2,
    profileIdleMs: _profileIdleMsV2,
    refreshStuckMs: _refreshStuckMsV2,
    profilesByStatus,
    jobsByStatus,
  };
}

export function _resetStateResponseCacheV2() {
  _profilesV2.clear();
  _refreshJobsV2.clear();
  _maxActiveProfilesPerOwnerV2 = CACHE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER;
  _maxPendingRefreshJobsPerProfileV2 =
    CACHE_DEFAULT_MAX_PENDING_REFRESH_JOBS_PER_PROFILE;
  _profileIdleMsV2 = CACHE_DEFAULT_PROFILE_IDLE_MS;
  _refreshStuckMsV2 = CACHE_DEFAULT_REFRESH_STUCK_MS;
}

// =====================================================================
// response-cache V2 governance overlay (iter23)
// =====================================================================
export const RCGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const RCGOV_REFRESH_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  REFRESHING: "refreshing",
  REFRESHED: "refreshed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _rcgovPTrans = new Map([
  [
    RCGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      RCGOV_PROFILE_MATURITY_V2.ACTIVE,
      RCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    RCGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      RCGOV_PROFILE_MATURITY_V2.STALE,
      RCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    RCGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      RCGOV_PROFILE_MATURITY_V2.ACTIVE,
      RCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [RCGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _rcgovPTerminal = new Set([RCGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _rcgovJTrans = new Map([
  [
    RCGOV_REFRESH_LIFECYCLE_V2.QUEUED,
    new Set([
      RCGOV_REFRESH_LIFECYCLE_V2.REFRESHING,
      RCGOV_REFRESH_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    RCGOV_REFRESH_LIFECYCLE_V2.REFRESHING,
    new Set([
      RCGOV_REFRESH_LIFECYCLE_V2.REFRESHED,
      RCGOV_REFRESH_LIFECYCLE_V2.FAILED,
      RCGOV_REFRESH_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [RCGOV_REFRESH_LIFECYCLE_V2.REFRESHED, new Set()],
  [RCGOV_REFRESH_LIFECYCLE_V2.FAILED, new Set()],
  [RCGOV_REFRESH_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _rcgovPsV2 = new Map();
const _rcgovJsV2 = new Map();
let _rcgovMaxActive = 8,
  _rcgovMaxPending = 15,
  _rcgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _rcgovStuckMs = 60 * 1000;
function _rcgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _rcgovCheckP(from, to) {
  const a = _rcgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid rcgov profile transition ${from} → ${to}`);
}
function _rcgovCheckJ(from, to) {
  const a = _rcgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid rcgov refresh transition ${from} → ${to}`);
}
function _rcgovCountActive(owner) {
  let c = 0;
  for (const p of _rcgovPsV2.values())
    if (p.owner === owner && p.status === RCGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _rcgovCountPending(profileId) {
  let c = 0;
  for (const j of _rcgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === RCGOV_REFRESH_LIFECYCLE_V2.QUEUED ||
        j.status === RCGOV_REFRESH_LIFECYCLE_V2.REFRESHING)
    )
      c++;
  return c;
}
export function setMaxActiveRcgovProfilesPerOwnerV2(n) {
  _rcgovMaxActive = _rcgovPos(n, "maxActiveRcgovProfilesPerOwner");
}
export function getMaxActiveRcgovProfilesPerOwnerV2() {
  return _rcgovMaxActive;
}
export function setMaxPendingRcgovRefreshsPerProfileV2(n) {
  _rcgovMaxPending = _rcgovPos(n, "maxPendingRcgovRefreshsPerProfile");
}
export function getMaxPendingRcgovRefreshsPerProfileV2() {
  return _rcgovMaxPending;
}
export function setRcgovProfileIdleMsV2(n) {
  _rcgovIdleMs = _rcgovPos(n, "rcgovProfileIdleMs");
}
export function getRcgovProfileIdleMsV2() {
  return _rcgovIdleMs;
}
export function setRcgovRefreshStuckMsV2(n) {
  _rcgovStuckMs = _rcgovPos(n, "rcgovRefreshStuckMs");
}
export function getRcgovRefreshStuckMsV2() {
  return _rcgovStuckMs;
}
export function _resetStateResponseCacheGovV2() {
  _rcgovPsV2.clear();
  _rcgovJsV2.clear();
  _rcgovMaxActive = 8;
  _rcgovMaxPending = 15;
  _rcgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _rcgovStuckMs = 60 * 1000;
}
export function registerRcgovProfileV2({ id, owner, lane, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_rcgovPsV2.has(id)) throw new Error(`rcgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    lane: lane || "default",
    status: RCGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _rcgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateRcgovProfileV2(id) {
  const p = _rcgovPsV2.get(id);
  if (!p) throw new Error(`rcgov profile ${id} not found`);
  const isInitial = p.status === RCGOV_PROFILE_MATURITY_V2.PENDING;
  _rcgovCheckP(p.status, RCGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _rcgovCountActive(p.owner) >= _rcgovMaxActive)
    throw new Error(`max active rcgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = RCGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleRcgovProfileV2(id) {
  const p = _rcgovPsV2.get(id);
  if (!p) throw new Error(`rcgov profile ${id} not found`);
  _rcgovCheckP(p.status, RCGOV_PROFILE_MATURITY_V2.STALE);
  p.status = RCGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveRcgovProfileV2(id) {
  const p = _rcgovPsV2.get(id);
  if (!p) throw new Error(`rcgov profile ${id} not found`);
  _rcgovCheckP(p.status, RCGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = RCGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchRcgovProfileV2(id) {
  const p = _rcgovPsV2.get(id);
  if (!p) throw new Error(`rcgov profile ${id} not found`);
  if (_rcgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal rcgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getRcgovProfileV2(id) {
  const p = _rcgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listRcgovProfilesV2() {
  return [..._rcgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createRcgovRefreshV2({ id, profileId, source, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_rcgovJsV2.has(id)) throw new Error(`rcgov refresh ${id} already exists`);
  if (!_rcgovPsV2.has(profileId))
    throw new Error(`rcgov profile ${profileId} not found`);
  if (_rcgovCountPending(profileId) >= _rcgovMaxPending)
    throw new Error(
      `max pending rcgov refreshs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    source: source || "",
    status: RCGOV_REFRESH_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _rcgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function refreshingRcgovRefreshV2(id) {
  const j = _rcgovJsV2.get(id);
  if (!j) throw new Error(`rcgov refresh ${id} not found`);
  _rcgovCheckJ(j.status, RCGOV_REFRESH_LIFECYCLE_V2.REFRESHING);
  const now = Date.now();
  j.status = RCGOV_REFRESH_LIFECYCLE_V2.REFRESHING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRefreshRcgovV2(id) {
  const j = _rcgovJsV2.get(id);
  if (!j) throw new Error(`rcgov refresh ${id} not found`);
  _rcgovCheckJ(j.status, RCGOV_REFRESH_LIFECYCLE_V2.REFRESHED);
  const now = Date.now();
  j.status = RCGOV_REFRESH_LIFECYCLE_V2.REFRESHED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failRcgovRefreshV2(id, reason) {
  const j = _rcgovJsV2.get(id);
  if (!j) throw new Error(`rcgov refresh ${id} not found`);
  _rcgovCheckJ(j.status, RCGOV_REFRESH_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = RCGOV_REFRESH_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelRcgovRefreshV2(id, reason) {
  const j = _rcgovJsV2.get(id);
  if (!j) throw new Error(`rcgov refresh ${id} not found`);
  _rcgovCheckJ(j.status, RCGOV_REFRESH_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = RCGOV_REFRESH_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getRcgovRefreshV2(id) {
  const j = _rcgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listRcgovRefreshsV2() {
  return [..._rcgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleRcgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _rcgovPsV2.values())
    if (
      p.status === RCGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _rcgovIdleMs
    ) {
      p.status = RCGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckRcgovRefreshsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _rcgovJsV2.values())
    if (
      j.status === RCGOV_REFRESH_LIFECYCLE_V2.REFRESHING &&
      j.startedAt != null &&
      t - j.startedAt >= _rcgovStuckMs
    ) {
      j.status = RCGOV_REFRESH_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getResponseCacheGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(RCGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _rcgovPsV2.values()) profilesByStatus[p.status]++;
  const refreshsByStatus = {};
  for (const v of Object.values(RCGOV_REFRESH_LIFECYCLE_V2))
    refreshsByStatus[v] = 0;
  for (const j of _rcgovJsV2.values()) refreshsByStatus[j.status]++;
  return {
    totalRcgovProfilesV2: _rcgovPsV2.size,
    totalRcgovRefreshsV2: _rcgovJsV2.size,
    maxActiveRcgovProfilesPerOwner: _rcgovMaxActive,
    maxPendingRcgovRefreshsPerProfile: _rcgovMaxPending,
    rcgovProfileIdleMs: _rcgovIdleMs,
    rcgovRefreshStuckMs: _rcgovStuckMs,
    profilesByStatus,
    refreshsByStatus,
  };
}
