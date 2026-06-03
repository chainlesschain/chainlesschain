/**
 * Cowork Observe — aggregate view over Cowork task/workflow/schedule history.
 *
 * Produces a single snapshot combining:
 *   - task history (from F9 learning layer)
 *   - workflow run history (from F6)
 *   - active schedules + next fire times (from F5 cron)
 *
 * Pure + `_deps`-injected for testability. Reads files, never writes.
 *
 * @module cowork-observe
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadHistory,
  computeTemplateStats,
  summarizeFailures,
} from "./cowork-learning.js";
import { loadSchedules, parseCron } from "./cowork-cron.js";

export const _deps = {
  existsSync,
  readFileSync,
  now: () => new Date(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _parseTs(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function _loadWorkflowHistory(cwd, cutoffMs) {
  const file = join(cwd, ".chainlesschain", "cowork", "workflow-history.jsonl");
  if (!_deps.existsSync(file)) return [];
  const raw = _deps.readFileSync(file, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (_parseTs(rec.startedAt || rec.timestamp) >= cutoffMs) out.push(rec);
    } catch (_e) {
      // skip malformed
    }
  }
  // Most recent first, top 10
  out.sort(
    (a, b) =>
      _parseTs(b.startedAt || b.timestamp) -
      _parseTs(a.startedAt || a.timestamp),
  );
  return out.slice(0, 10);
}

/**
 * Compute the next N fire times across all enabled schedules.
 * Probes minute-by-minute from `from` for up to `maxMinutesAhead` (default 7d).
 *
 * Exported for testability.
 */
export function _computeNextTriggers(schedules, from, limit = 5) {
  const enabled = (schedules || []).filter((s) => s && s.enabled !== false);
  if (enabled.length === 0) return [];
  const matchers = [];
  for (const s of enabled) {
    try {
      matchers.push({ id: s.id, cron: s.cron, match: parseCron(s.cron) });
    } catch (_e) {
      // skip invalid cron
    }
  }
  if (matchers.length === 0) return [];

  const out = [];
  const MAX_MINUTES = 60 * 24 * 7; // 1 week window is enough for typical cadences
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1); // first candidate = next whole minute
  const cursor = new Date(start);
  for (let i = 0; i < MAX_MINUTES && out.length < limit; i++) {
    for (const m of matchers) {
      if (m.match(cursor)) {
        out.push({
          scheduleId: m.id,
          cron: m.cron,
          at: new Date(cursor).toISOString(),
        });
        if (out.length >= limit) break;
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}

// ─── Main aggregate ──────────────────────────────────────────────────────────

/**
 * Aggregate all Cowork state for the given window.
 *
 * @param {string} cwd
 * @param {object} [options]
 * @param {number} [options.windowDays=7]
 * @returns {{
 *   window: { days: number, from: string, to: string },
 *   tasks: { total, completed, failed, successRate, avgTokens },
 *   templates: Array, failures: Array, workflows: Array,
 *   schedules: { active: number, nextTriggers: Array },
 * }}
 */
export function aggregate(cwd, { windowDays = 7 } = {}) {
  const now = _deps.now();
  const cutoff = now.getTime() - windowDays * 86400_000;
  const allHistory = loadHistory(cwd);
  const history = allHistory.filter((r) => _parseTs(r.timestamp) >= cutoff);

  const total = history.length;
  const completed = history.filter((r) => r.status === "completed").length;
  const failed = history.filter((r) => r.status === "failed").length;
  let tokenSum = 0;
  let tokenCount = 0;
  for (const r of history) {
    const t = Number(r.result?.tokenCount || 0);
    if (t > 0) {
      tokenSum += t;
      tokenCount += 1;
    }
  }

  const schedules = loadSchedules(cwd);
  const activeSchedules = schedules.filter((s) => s && s.enabled !== false);

  return {
    window: {
      days: windowDays,
      from: new Date(cutoff).toISOString(),
      to: now.toISOString(),
    },
    tasks: {
      total,
      completed,
      failed,
      successRate: total > 0 ? +(completed / total).toFixed(3) : 0,
      avgTokens: tokenCount > 0 ? Math.round(tokenSum / tokenCount) : 0,
    },
    templates: computeTemplateStats(history),
    failures: summarizeFailures(history),
    workflows: _loadWorkflowHistory(cwd, cutoff),
    schedules: {
      active: activeSchedules.length,
      nextTriggers: _computeNextTriggers(schedules, now, 5),
    },
  };
}

// =====================================================================
// cowork-observe V2 governance overlay (iter27)
// =====================================================================
export const COBSGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  MUTED: "muted",
  ARCHIVED: "archived",
});
export const COBSGOV_EVENT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RECORDING: "recording",
  RECORDED: "recorded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cobsgovPTrans = new Map([
  [
    COBSGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      COBSGOV_PROFILE_MATURITY_V2.ACTIVE,
      COBSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COBSGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      COBSGOV_PROFILE_MATURITY_V2.MUTED,
      COBSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COBSGOV_PROFILE_MATURITY_V2.MUTED,
    new Set([
      COBSGOV_PROFILE_MATURITY_V2.ACTIVE,
      COBSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [COBSGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cobsgovPTerminal = new Set([COBSGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _cobsgovJTrans = new Map([
  [
    COBSGOV_EVENT_LIFECYCLE_V2.QUEUED,
    new Set([
      COBSGOV_EVENT_LIFECYCLE_V2.RECORDING,
      COBSGOV_EVENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    COBSGOV_EVENT_LIFECYCLE_V2.RECORDING,
    new Set([
      COBSGOV_EVENT_LIFECYCLE_V2.RECORDED,
      COBSGOV_EVENT_LIFECYCLE_V2.FAILED,
      COBSGOV_EVENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [COBSGOV_EVENT_LIFECYCLE_V2.RECORDED, new Set()],
  [COBSGOV_EVENT_LIFECYCLE_V2.FAILED, new Set()],
  [COBSGOV_EVENT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cobsgovPsV2 = new Map();
const _cobsgovJsV2 = new Map();
let _cobsgovMaxActive = 10,
  _cobsgovMaxPending = 25,
  _cobsgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cobsgovStuckMs = 60 * 1000;
function _cobsgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cobsgovCheckP(from, to) {
  const a = _cobsgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cobsgov profile transition ${from} → ${to}`);
}
function _cobsgovCheckJ(from, to) {
  const a = _cobsgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cobsgov event transition ${from} → ${to}`);
}
function _cobsgovCountActive(owner) {
  let c = 0;
  for (const p of _cobsgovPsV2.values())
    if (p.owner === owner && p.status === COBSGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _cobsgovCountPending(profileId) {
  let c = 0;
  for (const j of _cobsgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === COBSGOV_EVENT_LIFECYCLE_V2.QUEUED ||
        j.status === COBSGOV_EVENT_LIFECYCLE_V2.RECORDING)
    )
      c++;
  return c;
}
export function setMaxActiveCobsgovProfilesPerOwnerV2(n) {
  _cobsgovMaxActive = _cobsgovPos(n, "maxActiveCobsgovProfilesPerOwner");
}
export function getMaxActiveCobsgovProfilesPerOwnerV2() {
  return _cobsgovMaxActive;
}
export function setMaxPendingCobsgovEventsPerProfileV2(n) {
  _cobsgovMaxPending = _cobsgovPos(n, "maxPendingCobsgovEventsPerProfile");
}
export function getMaxPendingCobsgovEventsPerProfileV2() {
  return _cobsgovMaxPending;
}
export function setCobsgovProfileIdleMsV2(n) {
  _cobsgovIdleMs = _cobsgovPos(n, "cobsgovProfileIdleMs");
}
export function getCobsgovProfileIdleMsV2() {
  return _cobsgovIdleMs;
}
export function setCobsgovEventStuckMsV2(n) {
  _cobsgovStuckMs = _cobsgovPos(n, "cobsgovEventStuckMs");
}
export function getCobsgovEventStuckMsV2() {
  return _cobsgovStuckMs;
}
export function _resetStateCoworkObserveGovV2() {
  _cobsgovPsV2.clear();
  _cobsgovJsV2.clear();
  _cobsgovMaxActive = 10;
  _cobsgovMaxPending = 25;
  _cobsgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cobsgovStuckMs = 60 * 1000;
}
export function registerCobsgovProfileV2({
  id,
  owner,
  channel,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cobsgovPsV2.has(id))
    throw new Error(`cobsgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    channel: channel || "default",
    status: COBSGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cobsgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCobsgovProfileV2(id) {
  const p = _cobsgovPsV2.get(id);
  if (!p) throw new Error(`cobsgov profile ${id} not found`);
  const isInitial = p.status === COBSGOV_PROFILE_MATURITY_V2.PENDING;
  _cobsgovCheckP(p.status, COBSGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cobsgovCountActive(p.owner) >= _cobsgovMaxActive)
    throw new Error(`max active cobsgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = COBSGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function muteCobsgovProfileV2(id) {
  const p = _cobsgovPsV2.get(id);
  if (!p) throw new Error(`cobsgov profile ${id} not found`);
  _cobsgovCheckP(p.status, COBSGOV_PROFILE_MATURITY_V2.MUTED);
  p.status = COBSGOV_PROFILE_MATURITY_V2.MUTED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCobsgovProfileV2(id) {
  const p = _cobsgovPsV2.get(id);
  if (!p) throw new Error(`cobsgov profile ${id} not found`);
  _cobsgovCheckP(p.status, COBSGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = COBSGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCobsgovProfileV2(id) {
  const p = _cobsgovPsV2.get(id);
  if (!p) throw new Error(`cobsgov profile ${id} not found`);
  if (_cobsgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cobsgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCobsgovProfileV2(id) {
  const p = _cobsgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCobsgovProfilesV2() {
  return [..._cobsgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCobsgovEventV2({ id, profileId, kind, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cobsgovJsV2.has(id))
    throw new Error(`cobsgov event ${id} already exists`);
  if (!_cobsgovPsV2.has(profileId))
    throw new Error(`cobsgov profile ${profileId} not found`);
  if (_cobsgovCountPending(profileId) >= _cobsgovMaxPending)
    throw new Error(
      `max pending cobsgov events for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    kind: kind || "",
    status: COBSGOV_EVENT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cobsgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function recordingCobsgovEventV2(id) {
  const j = _cobsgovJsV2.get(id);
  if (!j) throw new Error(`cobsgov event ${id} not found`);
  _cobsgovCheckJ(j.status, COBSGOV_EVENT_LIFECYCLE_V2.RECORDING);
  const now = Date.now();
  j.status = COBSGOV_EVENT_LIFECYCLE_V2.RECORDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeEventCobsgovV2(id) {
  const j = _cobsgovJsV2.get(id);
  if (!j) throw new Error(`cobsgov event ${id} not found`);
  _cobsgovCheckJ(j.status, COBSGOV_EVENT_LIFECYCLE_V2.RECORDED);
  const now = Date.now();
  j.status = COBSGOV_EVENT_LIFECYCLE_V2.RECORDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCobsgovEventV2(id, reason) {
  const j = _cobsgovJsV2.get(id);
  if (!j) throw new Error(`cobsgov event ${id} not found`);
  _cobsgovCheckJ(j.status, COBSGOV_EVENT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = COBSGOV_EVENT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCobsgovEventV2(id, reason) {
  const j = _cobsgovJsV2.get(id);
  if (!j) throw new Error(`cobsgov event ${id} not found`);
  _cobsgovCheckJ(j.status, COBSGOV_EVENT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = COBSGOV_EVENT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCobsgovEventV2(id) {
  const j = _cobsgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCobsgovEventsV2() {
  return [..._cobsgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoMuteIdleCobsgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cobsgovPsV2.values())
    if (
      p.status === COBSGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cobsgovIdleMs
    ) {
      p.status = COBSGOV_PROFILE_MATURITY_V2.MUTED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCobsgovEventsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cobsgovJsV2.values())
    if (
      j.status === COBSGOV_EVENT_LIFECYCLE_V2.RECORDING &&
      j.startedAt != null &&
      t - j.startedAt >= _cobsgovStuckMs
    ) {
      j.status = COBSGOV_EVENT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkObserveGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(COBSGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cobsgovPsV2.values()) profilesByStatus[p.status]++;
  const eventsByStatus = {};
  for (const v of Object.values(COBSGOV_EVENT_LIFECYCLE_V2))
    eventsByStatus[v] = 0;
  for (const j of _cobsgovJsV2.values()) eventsByStatus[j.status]++;
  return {
    totalCobsgovProfilesV2: _cobsgovPsV2.size,
    totalCobsgovEventsV2: _cobsgovJsV2.size,
    maxActiveCobsgovProfilesPerOwner: _cobsgovMaxActive,
    maxPendingCobsgovEventsPerProfile: _cobsgovMaxPending,
    cobsgovProfileIdleMs: _cobsgovIdleMs,
    cobsgovEventStuckMs: _cobsgovStuckMs,
    profilesByStatus,
    eventsByStatus,
  };
}
