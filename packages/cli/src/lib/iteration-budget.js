/**
 * Iteration Budget — shared, configurable iteration limit for agent loops.
 *
 * Replaces the hardcoded MAX_ITERATIONS constant with a first-class budget
 * object that is shared across parent and child agents, supports progressive
 * warnings, and can be configured via config.json or environment variable.
 *
 * Inspired by Hermes Agent's shared iteration budget system.
 *
 * @module iteration-budget
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BUDGET = 50;
const WARNING_THRESHOLD = 0.7; // 70%
const WRAPPING_UP_THRESHOLD = 0.9; // 90%

/**
 * Warning level enum.
 */
export const WarningLevel = {
  NONE: "none",
  WARNING: "warning", // 70-89%
  WRAPPING_UP: "wrapping-up", // 90-99%
  EXHAUSTED: "exhausted", // 100%
};

// ─── IterationBudget ────────────────────────────────────────────────────────

export class IterationBudget {
  /**
   * @param {object} [options]
   * @param {number} [options.limit] - Maximum iterations (default: 50)
   * @param {string} [options.owner] - Identifier for the budget creator (e.g. session ID)
   */
  constructor(options = {}) {
    this._limit = options.limit || IterationBudget.resolveLimit();
    this._consumed = 0;
    this._owner = options.owner || null;
    this._warnings = []; // timestamps of emitted warnings
  }

  /**
   * Resolve the budget limit from config/env/default.
   * Priority: CC_ITERATION_BUDGET env > default
   */
  static resolveLimit() {
    const env = process.env.CC_ITERATION_BUDGET;
    if (env) {
      const parsed = parseInt(env, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_BUDGET;
  }

  /** Total iteration limit. */
  get limit() {
    return this._limit;
  }

  /** Number of iterations consumed so far. */
  get consumed() {
    return this._consumed;
  }

  /**
   * Consume one iteration. Returns the current warning level after consumption.
   * @returns {string} WarningLevel value
   */
  consume() {
    this._consumed++;
    return this.warningLevel();
  }

  /**
   * Number of iterations remaining.
   * @returns {number}
   */
  remaining() {
    return Math.max(0, this._limit - this._consumed);
  }

  /**
   * Percentage of budget consumed (0.0 – 1.0+).
   * @returns {number}
   */
  percentage() {
    if (this._limit === 0) return 1;
    return this._consumed / this._limit;
  }

  /**
   * Whether the budget is exhausted.
   * @returns {boolean}
   */
  isExhausted() {
    return this._consumed >= this._limit;
  }

  /**
   * Whether there is still budget remaining.
   * @returns {boolean}
   */
  hasRemaining() {
    return this._consumed < this._limit;
  }

  /**
   * Current warning level based on consumption percentage.
   * @returns {string} WarningLevel value
   */
  warningLevel() {
    const pct = this.percentage();
    if (pct >= 1) return WarningLevel.EXHAUSTED;
    if (pct >= WRAPPING_UP_THRESHOLD) return WarningLevel.WRAPPING_UP;
    if (pct >= WARNING_THRESHOLD) return WarningLevel.WARNING;
    return WarningLevel.NONE;
  }

  /**
   * Record that a warning was emitted (for dedup in the agent loop).
   * @param {string} level - WarningLevel value
   */
  recordWarning(level) {
    this._warnings.push({ level, at: this._consumed });
  }

  /**
   * Whether a warning at this level has already been recorded.
   * @param {string} level
   * @returns {boolean}
   */
  hasWarned(level) {
    return this._warnings.some((w) => w.level === level);
  }

  /**
   * Generate a human-readable summary of budget usage.
   * Useful when the budget is exhausted and the agent needs to report status.
   * @returns {string}
   */
  toSummary() {
    const pct = Math.round(this.percentage() * 100);
    return (
      `Iteration budget: ${this._consumed}/${this._limit} (${pct}%). ` +
      `${this.remaining()} iterations remaining.`
    );
  }

  /**
   * Create a warning message suitable for appending to tool results.
   * @returns {string|null} Warning message or null if no warning needed
   */
  toWarningMessage() {
    const level = this.warningLevel();
    const remaining = this.remaining();
    switch (level) {
      case WarningLevel.WARNING:
        return `[Budget Warning] ${remaining} iterations remaining out of ${this._limit}. Start wrapping up your work.`;
      case WarningLevel.WRAPPING_UP:
        return `[Budget Critical] Only ${remaining} iterations remaining! Finish immediately and return your results.`;
      case WarningLevel.EXHAUSTED:
        return `[Budget Exhausted] No iterations remaining. Returning work summary.`;
      default:
        return null;
    }
  }
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_ITERATION_BUDGET = DEFAULT_BUDGET;
export const BUDGET_WARNING_THRESHOLD = WARNING_THRESHOLD;
export const BUDGET_WRAPPING_UP_THRESHOLD = WRAPPING_UP_THRESHOLD;

// ===== V2 Surface: Iteration Budget governance overlay (CLI v0.140.0) =====
export const ITER_BUDGET_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  EXHAUSTED: "exhausted",
});
export const ITER_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _ibpTrans = new Map([
  [
    ITER_BUDGET_PROFILE_MATURITY_V2.PENDING,
    new Set([
      ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE,
      ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED,
    ]),
  ],
  [
    ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED,
      ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED,
    ]),
  ],
  [
    ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE,
      ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED,
    ]),
  ],
  [ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED, new Set()],
]);
const _ibpTerminal = new Set([ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED]);
const _irTrans = new Map([
  [
    ITER_RUN_LIFECYCLE_V2.QUEUED,
    new Set([ITER_RUN_LIFECYCLE_V2.RUNNING, ITER_RUN_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    ITER_RUN_LIFECYCLE_V2.RUNNING,
    new Set([
      ITER_RUN_LIFECYCLE_V2.COMPLETED,
      ITER_RUN_LIFECYCLE_V2.FAILED,
      ITER_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [ITER_RUN_LIFECYCLE_V2.COMPLETED, new Set()],
  [ITER_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [ITER_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _ibpsV2 = new Map();
const _irsV2 = new Map();
let _ibpMaxActivePerOwner = 4;
let _ibpMaxPendingRunsPerProfile = 8;
let _ibpIdleMs = 24 * 60 * 60 * 1000;
let _irStuckMs = 60 * 60 * 1000;

function _ibpPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveIterBudgetProfilesPerOwnerV2(n) {
  _ibpMaxActivePerOwner = _ibpPos(n, "maxActiveIterBudgetProfilesPerOwner");
}
export function getMaxActiveIterBudgetProfilesPerOwnerV2() {
  return _ibpMaxActivePerOwner;
}
export function setMaxPendingIterRunsPerProfileV2(n) {
  _ibpMaxPendingRunsPerProfile = _ibpPos(n, "maxPendingIterRunsPerProfile");
}
export function getMaxPendingIterRunsPerProfileV2() {
  return _ibpMaxPendingRunsPerProfile;
}
export function setIterBudgetProfileIdleMsV2(n) {
  _ibpIdleMs = _ibpPos(n, "iterBudgetProfileIdleMs");
}
export function getIterBudgetProfileIdleMsV2() {
  return _ibpIdleMs;
}
export function setIterRunStuckMsV2(n) {
  _irStuckMs = _ibpPos(n, "iterRunStuckMs");
}
export function getIterRunStuckMsV2() {
  return _irStuckMs;
}

export function _resetStateIterationBudgetV2() {
  _ibpsV2.clear();
  _irsV2.clear();
  _ibpMaxActivePerOwner = 4;
  _ibpMaxPendingRunsPerProfile = 8;
  _ibpIdleMs = 24 * 60 * 60 * 1000;
  _irStuckMs = 60 * 60 * 1000;
}

export function registerIterBudgetProfileV2({
  id,
  owner,
  budget,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_ibpsV2.has(id))
    throw new Error(`iter budget profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    budget: budget || 50,
    status: ITER_BUDGET_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    exhaustedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _ibpsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _ibpCheckP(from, to) {
  const a = _ibpTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid iter budget profile transition ${from} → ${to}`);
}
function _ibpCountActive(owner) {
  let n = 0;
  for (const p of _ibpsV2.values())
    if (
      p.owner === owner &&
      p.status === ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE
    )
      n++;
  return n;
}

export function activateIterBudgetProfileV2(id) {
  const p = _ibpsV2.get(id);
  if (!p) throw new Error(`iter budget profile ${id} not found`);
  _ibpCheckP(p.status, ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED;
  if (!recovery) {
    const c = _ibpCountActive(p.owner);
    if (c >= _ibpMaxActivePerOwner)
      throw new Error(
        `max active iter budget profiles per owner (${_ibpMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseIterBudgetProfileV2(id) {
  const p = _ibpsV2.get(id);
  if (!p) throw new Error(`iter budget profile ${id} not found`);
  _ibpCheckP(p.status, ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED);
  p.status = ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function exhaustIterBudgetProfileV2(id) {
  const p = _ibpsV2.get(id);
  if (!p) throw new Error(`iter budget profile ${id} not found`);
  _ibpCheckP(p.status, ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED);
  const now = Date.now();
  p.status = ITER_BUDGET_PROFILE_MATURITY_V2.EXHAUSTED;
  p.updatedAt = now;
  if (!p.exhaustedAt) p.exhaustedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchIterBudgetProfileV2(id) {
  const p = _ibpsV2.get(id);
  if (!p) throw new Error(`iter budget profile ${id} not found`);
  if (_ibpTerminal.has(p.status))
    throw new Error(`cannot touch terminal iter budget profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getIterBudgetProfileV2(id) {
  const p = _ibpsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listIterBudgetProfilesV2() {
  return [..._ibpsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _irCountPending(profileId) {
  let n = 0;
  for (const r of _irsV2.values())
    if (
      r.profileId === profileId &&
      (r.status === ITER_RUN_LIFECYCLE_V2.QUEUED ||
        r.status === ITER_RUN_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createIterRunV2({ id, profileId, goal, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId is required");
  if (_irsV2.has(id)) throw new Error(`iter run ${id} already exists`);
  if (!_ibpsV2.has(profileId))
    throw new Error(`iter budget profile ${profileId} not found`);
  const pending = _irCountPending(profileId);
  if (pending >= _ibpMaxPendingRunsPerProfile)
    throw new Error(
      `max pending iter runs per profile (${_ibpMaxPendingRunsPerProfile}) reached for ${profileId}`,
    );
  const now = Date.now();
  const r = {
    id,
    profileId,
    goal: goal || "",
    status: ITER_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _irsV2.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _irCheckR(from, to) {
  const a = _irTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid iter run transition ${from} → ${to}`);
}
export function startIterRunV2(id) {
  const r = _irsV2.get(id);
  if (!r) throw new Error(`iter run ${id} not found`);
  _irCheckR(r.status, ITER_RUN_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  r.status = ITER_RUN_LIFECYCLE_V2.RUNNING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function completeIterRunV2(id) {
  const r = _irsV2.get(id);
  if (!r) throw new Error(`iter run ${id} not found`);
  _irCheckR(r.status, ITER_RUN_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  r.status = ITER_RUN_LIFECYCLE_V2.COMPLETED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failIterRunV2(id, reason) {
  const r = _irsV2.get(id);
  if (!r) throw new Error(`iter run ${id} not found`);
  _irCheckR(r.status, ITER_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = ITER_RUN_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelIterRunV2(id, reason) {
  const r = _irsV2.get(id);
  if (!r) throw new Error(`iter run ${id} not found`);
  _irCheckR(r.status, ITER_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = ITER_RUN_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getIterRunV2(id) {
  const r = _irsV2.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listIterRunsV2() {
  return [..._irsV2.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}

export function autoPauseIdleIterBudgetProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ibpsV2.values())
    if (
      p.status === ITER_BUDGET_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ibpIdleMs
    ) {
      p.status = ITER_BUDGET_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckIterRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _irsV2.values())
    if (
      r.status === ITER_RUN_LIFECYCLE_V2.RUNNING &&
      r.startedAt != null &&
      t - r.startedAt >= _irStuckMs
    ) {
      r.status = ITER_RUN_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}

export function getIterationBudgetGovStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(ITER_BUDGET_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _ibpsV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {};
  for (const s of Object.values(ITER_RUN_LIFECYCLE_V2)) runsByStatus[s] = 0;
  for (const r of _irsV2.values()) runsByStatus[r.status]++;
  return {
    totalIterBudgetProfilesV2: _ibpsV2.size,
    totalIterRunsV2: _irsV2.size,
    maxActiveIterBudgetProfilesPerOwner: _ibpMaxActivePerOwner,
    maxPendingIterRunsPerProfile: _ibpMaxPendingRunsPerProfile,
    iterBudgetProfileIdleMs: _ibpIdleMs,
    iterRunStuckMs: _irStuckMs,
    profilesByStatus,
    runsByStatus,
  };
}
