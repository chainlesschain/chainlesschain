/**
 * Sub-Agent Registry — lifecycle tracking for sub-agents.
 *
 * Tracks active sub-agents, maintains completion history (ring buffer),
 * and provides statistics. Singleton pattern for process-wide access.
 *
 * @module sub-agent-registry
 */

// ─── Ring Buffer ────────────────────────────────────────────────────────────

class RingBuffer {
  constructor(capacity = 100) {
    this._buffer = new Array(capacity);
    this._capacity = capacity;
    this._head = 0;
    this._size = 0;
  }

  push(item) {
    this._buffer[this._head] = item;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) this._size++;
  }

  toArray() {
    if (this._size === 0) return [];
    if (this._size < this._capacity) {
      return this._buffer.slice(0, this._size);
    }
    // Wrap around — oldest first
    return [
      ...this._buffer.slice(this._head),
      ...this._buffer.slice(0, this._head),
    ];
  }

  get size() {
    return this._size;
  }

  clear() {
    this._buffer = new Array(this._capacity);
    this._head = 0;
    this._size = 0;
  }
}

// ─── SubAgentRegistry ───────────────────────────────────────────────────────

export class SubAgentRegistry {
  static _instance = null;

  /**
   * Get or create the singleton instance.
   * @returns {SubAgentRegistry}
   */
  static getInstance() {
    if (!SubAgentRegistry._instance) {
      SubAgentRegistry._instance = new SubAgentRegistry();
    }
    return SubAgentRegistry._instance;
  }

  /**
   * Reset singleton (for testing).
   */
  static resetInstance() {
    SubAgentRegistry._instance = null;
  }

  constructor() {
    /** @type {Map<string, import("./sub-agent-context.js").SubAgentContext>} */
    this._active = new Map();

    /** @type {RingBuffer} */
    this._completed = new RingBuffer(100);

    this._totalTokens = 0;
    this._totalDurationMs = 0;
    this._completedCount = 0;
  }

  /**
   * Register an active sub-agent.
   * @param {import("./sub-agent-context.js").SubAgentContext} subCtx
   */
  register(subCtx) {
    this._active.set(subCtx.id, subCtx);
  }

  /**
   * Mark a sub-agent as completed and move to history.
   * @param {string} id - Sub-agent ID
   * @param {object} result - { summary, artifacts, tokenCount, toolsUsed, iterationCount }
   */
  complete(id, result) {
    const subCtx = this._active.get(id);
    if (!subCtx) return;

    this._active.delete(id);

    const record = {
      id: subCtx.id,
      parentId: subCtx.parentId,
      role: subCtx.role,
      task: subCtx.task,
      status: subCtx.status,
      summary: result?.summary || "(no summary)",
      toolsUsed: result?.toolsUsed || [],
      tokenCount: result?.tokenCount || 0,
      iterationCount: result?.iterationCount || 0,
      createdAt: subCtx.createdAt,
      completedAt: subCtx.completedAt || new Date().toISOString(),
      durationMs: subCtx.completedAt
        ? new Date(subCtx.completedAt) - new Date(subCtx.createdAt)
        : Date.now() - new Date(subCtx.createdAt).getTime(),
    };

    this._completed.push(record);
    this._totalTokens += record.tokenCount;
    this._totalDurationMs += record.durationMs;
    this._completedCount++;
  }

  /**
   * Get all active sub-agents.
   * @returns {Array<object>}
   */
  getActive() {
    return [...this._active.values()].map((ctx) => ctx.toJSON());
  }

  /**
   * Get a single sub-agent snapshot by id — checks active first, then history.
   * @param {string} id
   * @returns {object|null}
   */
  getById(id) {
    if (!id) return null;
    const active = this._active.get(id);
    if (active) return active.toJSON();
    const historyEntry = this._completed
      .toArray()
      .find((record) => record.id === id);
    return historyEntry || null;
  }

  /**
   * Get active + recent sub-agents belonging to a parent session.
   * Used by the WS sub-agent-list query and by UI consumers that need to
   * render only the child agents spawned from a specific parent turn.
   *
   * @param {string} parentId
   * @returns {{ active: Array<object>, history: Array<object> }}
   */
  getByParent(parentId) {
    if (!parentId) return { active: [], history: [] };
    const active = [...this._active.values()]
      .filter((ctx) => ctx.parentId === parentId)
      .map((ctx) => ctx.toJSON());
    const history = this._completed
      .toArray()
      .filter((record) => record.parentId === parentId);
    return { active, history };
  }

  /**
   * Get completion history (most recent last).
   * @returns {Array<object>}
   */
  getHistory() {
    return this._completed.toArray();
  }

  /**
   * Force-complete all sub-agents belonging to a session.
   * Used by ws-session-manager on session close.
   *
   * @param {string} [sessionId] - If provided, only force-complete agents whose parentId matches
   */
  forceCompleteAll(sessionId) {
    for (const [id, subCtx] of this._active) {
      if (!sessionId || subCtx.parentId === sessionId) {
        subCtx.forceComplete("session-closed");
        this.complete(id, subCtx.result);
      }
    }
  }

  /**
   * Clean up stale entries older than maxAgeMs.
   * @param {number} [maxAgeMs=600000] - Max age in ms (default: 10 minutes)
   */
  cleanup(maxAgeMs = 600000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, subCtx] of this._active) {
      if (new Date(subCtx.createdAt).getTime() < cutoff) {
        subCtx.forceComplete("timeout");
        this.complete(id, subCtx.result);
      }
    }
  }

  /**
   * Get registry statistics.
   */
  getStats() {
    return {
      active: this._active.size,
      completed: this._completedCount,
      historySize: this._completed.size,
      totalTokens: this._totalTokens,
      avgDurationMs:
        this._completedCount > 0
          ? Math.round(this._totalDurationMs / this._completedCount)
          : 0,
    };
  }
}

// ===== V2 Surface: Sub-Agent Registry governance overlay (CLI v0.133.0) =====
export const SUBAGENT_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  RETIRED: "retired",
});
export const SUBAGENT_TASK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _saProfileTrans = new Map([
  [
    SUBAGENT_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SUBAGENT_PROFILE_MATURITY_V2.ACTIVE,
      SUBAGENT_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    SUBAGENT_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SUBAGENT_PROFILE_MATURITY_V2.PAUSED,
      SUBAGENT_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    SUBAGENT_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      SUBAGENT_PROFILE_MATURITY_V2.ACTIVE,
      SUBAGENT_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [SUBAGENT_PROFILE_MATURITY_V2.RETIRED, new Set()],
]);
const _saProfileTerminal = new Set([SUBAGENT_PROFILE_MATURITY_V2.RETIRED]);
const _saTaskTrans = new Map([
  [
    SUBAGENT_TASK_LIFECYCLE_V2.QUEUED,
    new Set([
      SUBAGENT_TASK_LIFECYCLE_V2.RUNNING,
      SUBAGENT_TASK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SUBAGENT_TASK_LIFECYCLE_V2.RUNNING,
    new Set([
      SUBAGENT_TASK_LIFECYCLE_V2.COMPLETED,
      SUBAGENT_TASK_LIFECYCLE_V2.FAILED,
      SUBAGENT_TASK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SUBAGENT_TASK_LIFECYCLE_V2.COMPLETED, new Set()],
  [SUBAGENT_TASK_LIFECYCLE_V2.FAILED, new Set()],
  [SUBAGENT_TASK_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _saProfiles = new Map();
const _saTasks = new Map();
let _saMaxActivePerOwner = 12;
let _saMaxPendingPerProfile = 24;
let _saProfileIdleMs = 2 * 60 * 60 * 1000;
let _saTaskStuckMs = 5 * 60 * 1000;

function _saPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveSubagentsPerOwnerV2(n) {
  _saMaxActivePerOwner = _saPos(n, "maxActiveSubagentsPerOwner");
}
export function getMaxActiveSubagentsPerOwnerV2() {
  return _saMaxActivePerOwner;
}
export function setMaxPendingTasksPerSubagentV2(n) {
  _saMaxPendingPerProfile = _saPos(n, "maxPendingTasksPerSubagent");
}
export function getMaxPendingTasksPerSubagentV2() {
  return _saMaxPendingPerProfile;
}
export function setSubagentIdleMsV2(n) {
  _saProfileIdleMs = _saPos(n, "subagentIdleMs");
}
export function getSubagentIdleMsV2() {
  return _saProfileIdleMs;
}
export function setSubagentTaskStuckMsV2(n) {
  _saTaskStuckMs = _saPos(n, "subagentTaskStuckMs");
}
export function getSubagentTaskStuckMsV2() {
  return _saTaskStuckMs;
}

export function _resetStateSubAgentRegistryV2() {
  _saProfiles.clear();
  _saTasks.clear();
  _saMaxActivePerOwner = 12;
  _saMaxPendingPerProfile = 24;
  _saProfileIdleMs = 2 * 60 * 60 * 1000;
  _saTaskStuckMs = 5 * 60 * 1000;
}

export function registerSubagentProfileV2({ id, owner, role, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_saProfiles.has(id))
    throw new Error(`subagent profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    role: role || "generic",
    status: SUBAGENT_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _saProfiles.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}

function _saCheckP(from, to) {
  const allowed = _saProfileTrans.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid subagent profile transition ${from} → ${to}`);
}
function _saCountActiveByOwner(owner) {
  let n = 0;
  for (const p of _saProfiles.values())
    if (p.owner === owner && p.status === SUBAGENT_PROFILE_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateSubagentProfileV2(id) {
  const p = _saProfiles.get(id);
  if (!p) throw new Error(`subagent profile ${id} not found`);
  _saCheckP(p.status, SUBAGENT_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === SUBAGENT_PROFILE_MATURITY_V2.PAUSED;
  if (!recovery) {
    const a = _saCountActiveByOwner(p.owner);
    if (a >= _saMaxActivePerOwner)
      throw new Error(
        `max active subagents per owner (${_saMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = SUBAGENT_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseSubagentProfileV2(id) {
  const p = _saProfiles.get(id);
  if (!p) throw new Error(`subagent profile ${id} not found`);
  _saCheckP(p.status, SUBAGENT_PROFILE_MATURITY_V2.PAUSED);
  p.status = SUBAGENT_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function retireSubagentProfileV2(id) {
  const p = _saProfiles.get(id);
  if (!p) throw new Error(`subagent profile ${id} not found`);
  _saCheckP(p.status, SUBAGENT_PROFILE_MATURITY_V2.RETIRED);
  const now = Date.now();
  p.status = SUBAGENT_PROFILE_MATURITY_V2.RETIRED;
  p.updatedAt = now;
  if (!p.retiredAt) p.retiredAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSubagentProfileV2(id) {
  const p = _saProfiles.get(id);
  if (!p) throw new Error(`subagent profile ${id} not found`);
  if (_saProfileTerminal.has(p.status))
    throw new Error(`cannot touch terminal subagent profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSubagentProfileV2(id) {
  const p = _saProfiles.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSubagentProfilesV2() {
  return [..._saProfiles.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _saCountPendingByProfile(pid) {
  let n = 0;
  for (const t of _saTasks.values())
    if (
      t.profileId === pid &&
      (t.status === SUBAGENT_TASK_LIFECYCLE_V2.QUEUED ||
        t.status === SUBAGENT_TASK_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createSubagentTaskV2({
  id,
  profileId,
  description,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId is required");
  if (_saTasks.has(id)) throw new Error(`subagent task ${id} already exists`);
  if (!_saProfiles.has(profileId))
    throw new Error(`subagent profile ${profileId} not found`);
  const pending = _saCountPendingByProfile(profileId);
  if (pending >= _saMaxPendingPerProfile)
    throw new Error(
      `max pending tasks per subagent (${_saMaxPendingPerProfile}) reached for ${profileId}`,
    );
  const now = Date.now();
  const t = {
    id,
    profileId,
    description: description || "",
    status: SUBAGENT_TASK_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _saTasks.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
function _saCheckT(from, to) {
  const allowed = _saTaskTrans.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid subagent task transition ${from} → ${to}`);
}
export function startSubagentTaskV2(id) {
  const t = _saTasks.get(id);
  if (!t) throw new Error(`subagent task ${id} not found`);
  _saCheckT(t.status, SUBAGENT_TASK_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  t.status = SUBAGENT_TASK_LIFECYCLE_V2.RUNNING;
  t.updatedAt = now;
  if (!t.startedAt) t.startedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function completeSubagentTaskV2(id) {
  const t = _saTasks.get(id);
  if (!t) throw new Error(`subagent task ${id} not found`);
  _saCheckT(t.status, SUBAGENT_TASK_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  t.status = SUBAGENT_TASK_LIFECYCLE_V2.COMPLETED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function failSubagentTaskV2(id, reason) {
  const t = _saTasks.get(id);
  if (!t) throw new Error(`subagent task ${id} not found`);
  _saCheckT(t.status, SUBAGENT_TASK_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  t.status = SUBAGENT_TASK_LIFECYCLE_V2.FAILED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.failReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function cancelSubagentTaskV2(id, reason) {
  const t = _saTasks.get(id);
  if (!t) throw new Error(`subagent task ${id} not found`);
  _saCheckT(t.status, SUBAGENT_TASK_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  t.status = SUBAGENT_TASK_LIFECYCLE_V2.CANCELLED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.cancelReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function getSubagentTaskV2(id) {
  const t = _saTasks.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listSubagentTasksV2() {
  return [..._saTasks.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}

export function autoPauseIdleSubagentsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _saProfiles.values())
    if (
      p.status === SUBAGENT_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _saProfileIdleMs
    ) {
      p.status = SUBAGENT_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSubagentTasksV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const k of _saTasks.values())
    if (
      k.status === SUBAGENT_TASK_LIFECYCLE_V2.RUNNING &&
      k.startedAt != null &&
      t - k.startedAt >= _saTaskStuckMs
    ) {
      k.status = SUBAGENT_TASK_LIFECYCLE_V2.FAILED;
      k.updatedAt = t;
      if (!k.settledAt) k.settledAt = t;
      k.metadata.failReason = "auto-fail-stuck";
      flipped.push(k.id);
    }
  return { flipped, count: flipped.length };
}

export function getSubAgentRegistryStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(SUBAGENT_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _saProfiles.values()) profilesByStatus[p.status]++;
  const tasksByStatus = {};
  for (const s of Object.values(SUBAGENT_TASK_LIFECYCLE_V2))
    tasksByStatus[s] = 0;
  for (const t of _saTasks.values()) tasksByStatus[t.status]++;
  return {
    totalProfilesV2: _saProfiles.size,
    totalTasksV2: _saTasks.size,
    maxActiveSubagentsPerOwner: _saMaxActivePerOwner,
    maxPendingTasksPerSubagent: _saMaxPendingPerProfile,
    subagentIdleMs: _saProfileIdleMs,
    subagentTaskStuckMs: _saTaskStuckMs,
    profilesByStatus,
    tasksByStatus,
  };
}

// =====================================================================
// sub-agent-registry V2 governance overlay (iter25)
// =====================================================================
export const SAREGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const SAREGOV_SPAWN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SPAWNING: "spawning",
  SPAWNED: "spawned",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _saregovPTrans = new Map([
  [
    SAREGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SAREGOV_PROFILE_MATURITY_V2.ACTIVE,
      SAREGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SAREGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SAREGOV_PROFILE_MATURITY_V2.SUSPENDED,
      SAREGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SAREGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      SAREGOV_PROFILE_MATURITY_V2.ACTIVE,
      SAREGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SAREGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _saregovPTerminal = new Set([SAREGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _saregovJTrans = new Map([
  [
    SAREGOV_SPAWN_LIFECYCLE_V2.QUEUED,
    new Set([
      SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNING,
      SAREGOV_SPAWN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNING,
    new Set([
      SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNED,
      SAREGOV_SPAWN_LIFECYCLE_V2.FAILED,
      SAREGOV_SPAWN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNED, new Set()],
  [SAREGOV_SPAWN_LIFECYCLE_V2.FAILED, new Set()],
  [SAREGOV_SPAWN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _saregovPsV2 = new Map();
const _saregovJsV2 = new Map();
let _saregovMaxActive = 10,
  _saregovMaxPending = 25,
  _saregovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _saregovStuckMs = 60 * 1000;
function _saregovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _saregovCheckP(from, to) {
  const a = _saregovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid saregov profile transition ${from} → ${to}`);
}
function _saregovCheckJ(from, to) {
  const a = _saregovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid saregov spawn transition ${from} → ${to}`);
}
function _saregovCountActive(owner) {
  let c = 0;
  for (const p of _saregovPsV2.values())
    if (p.owner === owner && p.status === SAREGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _saregovCountPending(profileId) {
  let c = 0;
  for (const j of _saregovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SAREGOV_SPAWN_LIFECYCLE_V2.QUEUED ||
        j.status === SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNING)
    )
      c++;
  return c;
}
export function setMaxActiveSaregovProfilesPerOwnerV2(n) {
  _saregovMaxActive = _saregovPos(n, "maxActiveSaregovProfilesPerOwner");
}
export function getMaxActiveSaregovProfilesPerOwnerV2() {
  return _saregovMaxActive;
}
export function setMaxPendingSaregovSpawnsPerProfileV2(n) {
  _saregovMaxPending = _saregovPos(n, "maxPendingSaregovSpawnsPerProfile");
}
export function getMaxPendingSaregovSpawnsPerProfileV2() {
  return _saregovMaxPending;
}
export function setSaregovProfileIdleMsV2(n) {
  _saregovIdleMs = _saregovPos(n, "saregovProfileIdleMs");
}
export function getSaregovProfileIdleMsV2() {
  return _saregovIdleMs;
}
export function setSaregovSpawnStuckMsV2(n) {
  _saregovStuckMs = _saregovPos(n, "saregovSpawnStuckMs");
}
export function getSaregovSpawnStuckMsV2() {
  return _saregovStuckMs;
}
export function _resetStateSubAgentRegistryGovV2() {
  _saregovPsV2.clear();
  _saregovJsV2.clear();
  _saregovMaxActive = 10;
  _saregovMaxPending = 25;
  _saregovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _saregovStuckMs = 60 * 1000;
}
export function registerSaregovProfileV2({ id, owner, kind, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_saregovPsV2.has(id))
    throw new Error(`saregov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    kind: kind || "general",
    status: SAREGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _saregovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSaregovProfileV2(id) {
  const p = _saregovPsV2.get(id);
  if (!p) throw new Error(`saregov profile ${id} not found`);
  const isInitial = p.status === SAREGOV_PROFILE_MATURITY_V2.PENDING;
  _saregovCheckP(p.status, SAREGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _saregovCountActive(p.owner) >= _saregovMaxActive)
    throw new Error(`max active saregov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SAREGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendSaregovProfileV2(id) {
  const p = _saregovPsV2.get(id);
  if (!p) throw new Error(`saregov profile ${id} not found`);
  _saregovCheckP(p.status, SAREGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = SAREGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSaregovProfileV2(id) {
  const p = _saregovPsV2.get(id);
  if (!p) throw new Error(`saregov profile ${id} not found`);
  _saregovCheckP(p.status, SAREGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SAREGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSaregovProfileV2(id) {
  const p = _saregovPsV2.get(id);
  if (!p) throw new Error(`saregov profile ${id} not found`);
  if (_saregovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal saregov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSaregovProfileV2(id) {
  const p = _saregovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSaregovProfilesV2() {
  return [..._saregovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSaregovSpawnV2({ id, profileId, task, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_saregovJsV2.has(id))
    throw new Error(`saregov spawn ${id} already exists`);
  if (!_saregovPsV2.has(profileId))
    throw new Error(`saregov profile ${profileId} not found`);
  if (_saregovCountPending(profileId) >= _saregovMaxPending)
    throw new Error(
      `max pending saregov spawns for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    task: task || "",
    status: SAREGOV_SPAWN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _saregovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function spawningSaregovSpawnV2(id) {
  const j = _saregovJsV2.get(id);
  if (!j) throw new Error(`saregov spawn ${id} not found`);
  _saregovCheckJ(j.status, SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNING);
  const now = Date.now();
  j.status = SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeSpawnSaregovV2(id) {
  const j = _saregovJsV2.get(id);
  if (!j) throw new Error(`saregov spawn ${id} not found`);
  _saregovCheckJ(j.status, SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNED);
  const now = Date.now();
  j.status = SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSaregovSpawnV2(id, reason) {
  const j = _saregovJsV2.get(id);
  if (!j) throw new Error(`saregov spawn ${id} not found`);
  _saregovCheckJ(j.status, SAREGOV_SPAWN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SAREGOV_SPAWN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSaregovSpawnV2(id, reason) {
  const j = _saregovJsV2.get(id);
  if (!j) throw new Error(`saregov spawn ${id} not found`);
  _saregovCheckJ(j.status, SAREGOV_SPAWN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SAREGOV_SPAWN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSaregovSpawnV2(id) {
  const j = _saregovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSaregovSpawnsV2() {
  return [..._saregovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleSaregovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _saregovPsV2.values())
    if (
      p.status === SAREGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _saregovIdleMs
    ) {
      p.status = SAREGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSaregovSpawnsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _saregovJsV2.values())
    if (
      j.status === SAREGOV_SPAWN_LIFECYCLE_V2.SPAWNING &&
      j.startedAt != null &&
      t - j.startedAt >= _saregovStuckMs
    ) {
      j.status = SAREGOV_SPAWN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSubAgentRegistryGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SAREGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _saregovPsV2.values()) profilesByStatus[p.status]++;
  const spawnsByStatus = {};
  for (const v of Object.values(SAREGOV_SPAWN_LIFECYCLE_V2))
    spawnsByStatus[v] = 0;
  for (const j of _saregovJsV2.values()) spawnsByStatus[j.status]++;
  return {
    totalSaregovProfilesV2: _saregovPsV2.size,
    totalSaregovSpawnsV2: _saregovJsV2.size,
    maxActiveSaregovProfilesPerOwner: _saregovMaxActive,
    maxPendingSaregovSpawnsPerProfile: _saregovMaxPending,
    saregovProfileIdleMs: _saregovIdleMs,
    saregovSpawnStuckMs: _saregovStuckMs,
    profilesByStatus,
    spawnsByStatus,
  };
}
