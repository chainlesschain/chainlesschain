/**
 * Session tail — Phase I of Managed Agents parity plan.
 *
 * Follows a JSONL session file and yields new events as an async iterable.
 * Uses offset-polling so it works cross-platform (fs.watch on Windows is
 * unreliable for appended-to files).
 *
 * Pure generator + helper; the CLI command just wires output.
 */

import { promises as fsp } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { sessionPath } from "../harness/jsonl-session-store.js";

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Parse a contiguous chunk of buffered text into events. Returns {events, rest}
 * where `rest` is the unterminated trailing partial line to keep for the next
 * read.
 */
export function parseChunk(buffer) {
  const events = [];
  let rest = buffer;
  let nl = rest.indexOf("\n");
  while (nl !== -1) {
    const line = rest.slice(0, nl);
    rest = rest.slice(nl + 1);
    const evt = parseLine(line);
    if (evt) events.push(evt);
    nl = rest.indexOf("\n");
  }
  return { events, rest };
}

function matchesFilter(event, { types, sinceMs }) {
  if (types && types.length > 0 && !types.includes(event.type)) return false;
  if (sinceMs && event.timestamp && event.timestamp < sinceMs) return false;
  return true;
}

/**
 * Get the initial offset for a session:
 *   - fromStart: 0
 *   - fromEnd (default): current EOF, so only new events are yielded
 */
export function initialOffset(sessionId, { fromStart = false } = {}) {
  const p = sessionPath(sessionId);
  if (!existsSync(p)) return 0;
  if (fromStart) return 0;
  return statSync(p).size;
}

/**
 * Follow a session file. Yields {event, offset} objects as new JSONL lines
 * are appended. Caller passes an AbortSignal (or the generator runs forever).
 *
 * Options:
 *   - signal       AbortSignal — stops the loop
 *   - pollMs       polling interval (default 200)
 *   - fromStart    start from byte 0 (default false — tail from EOF)
 *   - fromOffset   explicit starting byte offset (overrides fromStart)
 *   - types        string[] of event.type to include (null = all)
 *   - sinceMs      only yield events with timestamp >= sinceMs
 *   - once         if true, stop once file is drained (no polling)
 */
export async function* followSession(sessionId, options = {}) {
  const {
    signal,
    pollMs = 200,
    fromStart = false,
    fromOffset,
    types = null,
    sinceMs = null,
    once = false,
  } = options;

  const filePath = sessionPath(sessionId);
  let offset =
    typeof fromOffset === "number"
      ? fromOffset
      : initialOffset(sessionId, { fromStart });
  let buffer = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) return;

    if (existsSync(filePath)) {
      const stat = await fsp.stat(filePath);
      if (stat.size < offset) {
        // File was truncated / rotated — restart from beginning
        offset = 0;
        buffer = "";
      }
      if (stat.size > offset) {
        const fd = await fsp.open(filePath, "r");
        try {
          const length = stat.size - offset;
          const buf = Buffer.alloc(length);
          await fd.read(buf, 0, length, offset);
          offset = stat.size;
          buffer += buf.toString("utf-8");
        } finally {
          await fd.close();
        }
        const { events, rest } = parseChunk(buffer);
        buffer = rest;
        for (const evt of events) {
          if (matchesFilter(evt, { types, sinceMs })) {
            yield { event: evt, offset };
          }
        }
      }
    }

    if (once) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ===== V2 Surface: Session Tail governance overlay (CLI v0.142.0) =====
export const STAIL_SUB_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  CLOSED: "closed",
});
export const STAIL_EVENT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  TAILING: "tailing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _stailSTrans = new Map([
  [
    STAIL_SUB_MATURITY_V2.PENDING,
    new Set([STAIL_SUB_MATURITY_V2.ACTIVE, STAIL_SUB_MATURITY_V2.CLOSED]),
  ],
  [
    STAIL_SUB_MATURITY_V2.ACTIVE,
    new Set([STAIL_SUB_MATURITY_V2.PAUSED, STAIL_SUB_MATURITY_V2.CLOSED]),
  ],
  [
    STAIL_SUB_MATURITY_V2.PAUSED,
    new Set([STAIL_SUB_MATURITY_V2.ACTIVE, STAIL_SUB_MATURITY_V2.CLOSED]),
  ],
  [STAIL_SUB_MATURITY_V2.CLOSED, new Set()],
]);
const _stailSTerminal = new Set([STAIL_SUB_MATURITY_V2.CLOSED]);
const _stailETrans = new Map([
  [
    STAIL_EVENT_LIFECYCLE_V2.QUEUED,
    new Set([
      STAIL_EVENT_LIFECYCLE_V2.TAILING,
      STAIL_EVENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    STAIL_EVENT_LIFECYCLE_V2.TAILING,
    new Set([
      STAIL_EVENT_LIFECYCLE_V2.COMPLETED,
      STAIL_EVENT_LIFECYCLE_V2.FAILED,
      STAIL_EVENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [STAIL_EVENT_LIFECYCLE_V2.COMPLETED, new Set()],
  [STAIL_EVENT_LIFECYCLE_V2.FAILED, new Set()],
  [STAIL_EVENT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _stailSsV2 = new Map();
const _stailEsV2 = new Map();
let _stailMaxActive = 10,
  _stailMaxPending = 30,
  _stailIdleMs = 24 * 60 * 60 * 1000,
  _stailStuckMs = 60 * 1000;
function _stailPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _stailCheckS(from, to) {
  const a = _stailSTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid stail subscription transition ${from} → ${to}`);
}
function _stailCheckE(from, to) {
  const a = _stailETrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid stail event transition ${from} → ${to}`);
}
export function setMaxActiveStailSubsPerOwnerV2(n) {
  _stailMaxActive = _stailPos(n, "maxActiveStailSubsPerOwner");
}
export function getMaxActiveStailSubsPerOwnerV2() {
  return _stailMaxActive;
}
export function setMaxPendingStailEventsPerSubV2(n) {
  _stailMaxPending = _stailPos(n, "maxPendingStailEventsPerSub");
}
export function getMaxPendingStailEventsPerSubV2() {
  return _stailMaxPending;
}
export function setStailSubIdleMsV2(n) {
  _stailIdleMs = _stailPos(n, "stailSubIdleMs");
}
export function getStailSubIdleMsV2() {
  return _stailIdleMs;
}
export function setStailEventStuckMsV2(n) {
  _stailStuckMs = _stailPos(n, "stailEventStuckMs");
}
export function getStailEventStuckMsV2() {
  return _stailStuckMs;
}
export function _resetStateSessionTailV2() {
  _stailSsV2.clear();
  _stailEsV2.clear();
  _stailMaxActive = 10;
  _stailMaxPending = 30;
  _stailIdleMs = 24 * 60 * 60 * 1000;
  _stailStuckMs = 60 * 1000;
}
export function registerStailSubV2({ id, owner, sessionId, metadata } = {}) {
  if (!id) throw new Error("stail sub id required");
  if (!owner) throw new Error("stail sub owner required");
  if (_stailSsV2.has(id)) throw new Error(`stail sub ${id} already registered`);
  const now = Date.now();
  const s = {
    id,
    owner,
    sessionId: sessionId || "*",
    status: STAIL_SUB_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    closedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _stailSsV2.set(id, s);
  return { ...s, metadata: { ...s.metadata } };
}
function _stailCountActive(owner) {
  let n = 0;
  for (const s of _stailSsV2.values())
    if (s.owner === owner && s.status === STAIL_SUB_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activateStailSubV2(id) {
  const s = _stailSsV2.get(id);
  if (!s) throw new Error(`stail sub ${id} not found`);
  _stailCheckS(s.status, STAIL_SUB_MATURITY_V2.ACTIVE);
  const recovery = s.status === STAIL_SUB_MATURITY_V2.PAUSED;
  if (!recovery && _stailCountActive(s.owner) >= _stailMaxActive)
    throw new Error(`max active stail subs for owner ${s.owner} reached`);
  const now = Date.now();
  s.status = STAIL_SUB_MATURITY_V2.ACTIVE;
  s.updatedAt = now;
  s.lastTouchedAt = now;
  if (!s.activatedAt) s.activatedAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function pauseStailSubV2(id) {
  const s = _stailSsV2.get(id);
  if (!s) throw new Error(`stail sub ${id} not found`);
  _stailCheckS(s.status, STAIL_SUB_MATURITY_V2.PAUSED);
  s.status = STAIL_SUB_MATURITY_V2.PAUSED;
  s.updatedAt = Date.now();
  return { ...s, metadata: { ...s.metadata } };
}
export function closeStailSubV2(id) {
  const s = _stailSsV2.get(id);
  if (!s) throw new Error(`stail sub ${id} not found`);
  _stailCheckS(s.status, STAIL_SUB_MATURITY_V2.CLOSED);
  const now = Date.now();
  s.status = STAIL_SUB_MATURITY_V2.CLOSED;
  s.updatedAt = now;
  if (!s.closedAt) s.closedAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function touchStailSubV2(id) {
  const s = _stailSsV2.get(id);
  if (!s) throw new Error(`stail sub ${id} not found`);
  if (_stailSTerminal.has(s.status))
    throw new Error(`cannot touch terminal stail sub ${id}`);
  const now = Date.now();
  s.lastTouchedAt = now;
  s.updatedAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function getStailSubV2(id) {
  const s = _stailSsV2.get(id);
  if (!s) return null;
  return { ...s, metadata: { ...s.metadata } };
}
export function listStailSubsV2() {
  return [..._stailSsV2.values()].map((s) => ({
    ...s,
    metadata: { ...s.metadata },
  }));
}
function _stailCountPending(subId) {
  let n = 0;
  for (const e of _stailEsV2.values())
    if (
      e.subId === subId &&
      (e.status === STAIL_EVENT_LIFECYCLE_V2.QUEUED ||
        e.status === STAIL_EVENT_LIFECYCLE_V2.TAILING)
    )
      n++;
  return n;
}
export function createStailEventV2({ id, subId, cursor, metadata } = {}) {
  if (!id) throw new Error("stail event id required");
  if (!subId) throw new Error("stail event subId required");
  if (_stailEsV2.has(id)) throw new Error(`stail event ${id} already exists`);
  if (!_stailSsV2.has(subId)) throw new Error(`stail sub ${subId} not found`);
  if (_stailCountPending(subId) >= _stailMaxPending)
    throw new Error(`max pending stail events for sub ${subId} reached`);
  const now = Date.now();
  const e = {
    id,
    subId,
    cursor: cursor || "0",
    status: STAIL_EVENT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _stailEsV2.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}
export function tailingStailEventV2(id) {
  const e = _stailEsV2.get(id);
  if (!e) throw new Error(`stail event ${id} not found`);
  _stailCheckE(e.status, STAIL_EVENT_LIFECYCLE_V2.TAILING);
  const now = Date.now();
  e.status = STAIL_EVENT_LIFECYCLE_V2.TAILING;
  e.updatedAt = now;
  if (!e.startedAt) e.startedAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function completeStailEventV2(id) {
  const e = _stailEsV2.get(id);
  if (!e) throw new Error(`stail event ${id} not found`);
  _stailCheckE(e.status, STAIL_EVENT_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  e.status = STAIL_EVENT_LIFECYCLE_V2.COMPLETED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function failStailEventV2(id, reason) {
  const e = _stailEsV2.get(id);
  if (!e) throw new Error(`stail event ${id} not found`);
  _stailCheckE(e.status, STAIL_EVENT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  e.status = STAIL_EVENT_LIFECYCLE_V2.FAILED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.failReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function cancelStailEventV2(id, reason) {
  const e = _stailEsV2.get(id);
  if (!e) throw new Error(`stail event ${id} not found`);
  _stailCheckE(e.status, STAIL_EVENT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  e.status = STAIL_EVENT_LIFECYCLE_V2.CANCELLED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.cancelReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function getStailEventV2(id) {
  const e = _stailEsV2.get(id);
  if (!e) return null;
  return { ...e, metadata: { ...e.metadata } };
}
export function listStailEventsV2() {
  return [..._stailEsV2.values()].map((e) => ({
    ...e,
    metadata: { ...e.metadata },
  }));
}
export function autoPauseIdleStailSubsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const s of _stailSsV2.values())
    if (
      s.status === STAIL_SUB_MATURITY_V2.ACTIVE &&
      t - s.lastTouchedAt >= _stailIdleMs
    ) {
      s.status = STAIL_SUB_MATURITY_V2.PAUSED;
      s.updatedAt = t;
      flipped.push(s.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckStailEventsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const e of _stailEsV2.values())
    if (
      e.status === STAIL_EVENT_LIFECYCLE_V2.TAILING &&
      e.startedAt != null &&
      t - e.startedAt >= _stailStuckMs
    ) {
      e.status = STAIL_EVENT_LIFECYCLE_V2.FAILED;
      e.updatedAt = t;
      if (!e.settledAt) e.settledAt = t;
      e.metadata.failReason = "auto-fail-stuck";
      flipped.push(e.id);
    }
  return { flipped, count: flipped.length };
}
export function getSessionTailGovStatsV2() {
  const subsByStatus = {};
  for (const v of Object.values(STAIL_SUB_MATURITY_V2)) subsByStatus[v] = 0;
  for (const s of _stailSsV2.values()) subsByStatus[s.status]++;
  const eventsByStatus = {};
  for (const v of Object.values(STAIL_EVENT_LIFECYCLE_V2))
    eventsByStatus[v] = 0;
  for (const e of _stailEsV2.values()) eventsByStatus[e.status]++;
  return {
    totalStailSubsV2: _stailSsV2.size,
    totalStailEventsV2: _stailEsV2.size,
    maxActiveStailSubsPerOwner: _stailMaxActive,
    maxPendingStailEventsPerSub: _stailMaxPending,
    stailSubIdleMs: _stailIdleMs,
    stailEventStuckMs: _stailStuckMs,
    subsByStatus,
    eventsByStatus,
  };
}
