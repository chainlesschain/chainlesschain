/**
 * session-consolidator — bridges CLI JSONL sessions into session-core
 * MemoryConsolidator.
 *
 * Managed Agents parity Phase G: `chainlesschain memory consolidate --session <id>`
 * reads the session's append-only JSONL log, projects the events into
 * `TRACE_TYPES.{MESSAGE,TOOL_CALL,TOOL_RESULT}` payloads, and runs the shared
 * MemoryConsolidator against the CLI MemoryStore singleton.
 *
 * The JSONL store holds `session_start / user_message / assistant_message /
 * tool_call / tool_result / compact` events. Only the user/assistant messages
 * and tool call/result events are carried through — `session_start` and
 * `compact` don't contribute to memory extraction.
 */

import {
  TraceStore,
  TRACE_TYPES,
  MemoryConsolidator,
} from "@chainlesschain/session-core";
import { readEvents, sessionExists } from "../harness/jsonl-session-store.js";
import { getMemoryStore } from "./session-core-singletons.js";

/**
 * Build an in-memory TraceStore populated with events from a JSONL session.
 * Used so MemoryConsolidator can run against sessions that were never live
 * in this CLI process.
 */
export function buildTraceStoreFromJsonl(sessionId, events) {
  const trace = new TraceStore();
  const source = events || readEvents(sessionId);

  for (const ev of source) {
    if (!ev || !ev.type) continue;
    const ts = ev.timestamp || Date.now();
    const d = ev.data || {};

    switch (ev.type) {
      case "user_message":
        trace.record({
          sessionId,
          type: TRACE_TYPES.MESSAGE,
          ts,
          payload: { role: "user", content: d.content || "" },
        });
        break;
      case "assistant_message":
        trace.record({
          sessionId,
          type: TRACE_TYPES.MESSAGE,
          ts,
          payload: { role: "assistant", content: d.content || "" },
        });
        break;
      case "tool_call":
        trace.record({
          sessionId,
          type: TRACE_TYPES.TOOL_CALL,
          ts,
          payload: { tool: d.tool, args: d.args },
        });
        break;
      case "tool_result": {
        const raw = d.result;
        const ok = !(raw && typeof raw === "object" && raw.error);
        const summary =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object"
              ? raw.summary || raw.message || null
              : null;
        trace.record({
          sessionId,
          type: TRACE_TYPES.TOOL_RESULT,
          ts,
          payload: { tool: d.tool, ok, summary, result: raw },
        });
        break;
      }
      default:
        // session_start / compact / other — not memory-relevant
        break;
    }
  }

  return trace;
}

/**
 * Consolidate a JSONL session into the CLI MemoryStore.
 *
 * @param {string} sessionId
 * @param {object} options
 * @param {"session"|"agent"|"global"} [options.scope="agent"]
 * @param {string|null} [options.scopeId]
 * @param {string|null} [options.agentId] — used as SessionHandle.agentId when
 *   scope=agent and no scopeId given
 * @param {object} [options.memoryStore] — override (tests)
 * @param {Array}  [options.events] — override (tests)
 * @returns {Promise<object>} MemoryConsolidator result
 */
export async function consolidateJsonlSession(sessionId, options = {}) {
  if (!sessionId) throw new Error("sessionId required");
  if (!options.events && !sessionExists(sessionId)) {
    const err = new Error(`Session not found: ${sessionId}`);
    err.code = "SESSION_NOT_FOUND";
    throw err;
  }

  const trace = buildTraceStoreFromJsonl(sessionId, options.events);
  const memoryStore = options.memoryStore || getMemoryStore();
  const consolidator = new MemoryConsolidator({
    memoryStore,
    traceStore: trace,
    scope: options.scope || "agent",
  });

  return consolidator.consolidate(
    { sessionId, agentId: options.agentId || sessionId },
    {
      scope: options.scope,
      scopeId: options.scopeId,
    },
  );
}


// ===== V2 Surface: Session Consolidator governance overlay (CLI v0.134.0) =====
export const CONSOL_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", PAUSED: "paused", ARCHIVED: "archived",
});
export const CONSOL_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled",
});

const _scProfTrans = new Map([
  [CONSOL_PROFILE_MATURITY_V2.PENDING, new Set([CONSOL_PROFILE_MATURITY_V2.ACTIVE, CONSOL_PROFILE_MATURITY_V2.ARCHIVED])],
  [CONSOL_PROFILE_MATURITY_V2.ACTIVE, new Set([CONSOL_PROFILE_MATURITY_V2.PAUSED, CONSOL_PROFILE_MATURITY_V2.ARCHIVED])],
  [CONSOL_PROFILE_MATURITY_V2.PAUSED, new Set([CONSOL_PROFILE_MATURITY_V2.ACTIVE, CONSOL_PROFILE_MATURITY_V2.ARCHIVED])],
  [CONSOL_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _scProfTerminal = new Set([CONSOL_PROFILE_MATURITY_V2.ARCHIVED]);
const _scJobTrans = new Map([
  [CONSOL_JOB_LIFECYCLE_V2.QUEUED, new Set([CONSOL_JOB_LIFECYCLE_V2.RUNNING, CONSOL_JOB_LIFECYCLE_V2.CANCELLED])],
  [CONSOL_JOB_LIFECYCLE_V2.RUNNING, new Set([CONSOL_JOB_LIFECYCLE_V2.COMPLETED, CONSOL_JOB_LIFECYCLE_V2.FAILED, CONSOL_JOB_LIFECYCLE_V2.CANCELLED])],
  [CONSOL_JOB_LIFECYCLE_V2.COMPLETED, new Set()],
  [CONSOL_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [CONSOL_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _scProfiles = new Map();
const _scJobs = new Map();
let _scMaxActivePerOwner = 8;
let _scMaxPendingPerProfile = 12;
let _scProfileIdleMs = 7 * 24 * 60 * 60 * 1000;
let _scJobStuckMs = 10 * 60 * 1000;

function _scPos(n, lbl) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${lbl} must be positive integer`); return v; }

export function setMaxActiveConsolProfilesPerOwnerV2(n) { _scMaxActivePerOwner = _scPos(n, "maxActiveConsolProfilesPerOwner"); }
export function getMaxActiveConsolProfilesPerOwnerV2() { return _scMaxActivePerOwner; }
export function setMaxPendingConsolJobsPerProfileV2(n) { _scMaxPendingPerProfile = _scPos(n, "maxPendingConsolJobsPerProfile"); }
export function getMaxPendingConsolJobsPerProfileV2() { return _scMaxPendingPerProfile; }
export function setConsolProfileIdleMsV2(n) { _scProfileIdleMs = _scPos(n, "consolProfileIdleMs"); }
export function getConsolProfileIdleMsV2() { return _scProfileIdleMs; }
export function setConsolJobStuckMsV2(n) { _scJobStuckMs = _scPos(n, "consolJobStuckMs"); }
export function getConsolJobStuckMsV2() { return _scJobStuckMs; }

export function _resetStateSessionConsolidatorV2() {
  _scProfiles.clear(); _scJobs.clear();
  _scMaxActivePerOwner = 8; _scMaxPendingPerProfile = 12;
  _scProfileIdleMs = 7 * 24 * 60 * 60 * 1000; _scJobStuckMs = 10 * 60 * 1000;
}

export function registerConsolProfileV2({ id, owner, scope, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_scProfiles.has(id)) throw new Error(`consol profile ${id} already registered`);
  const now = Date.now();
  const p = { id, owner, scope: scope || "agent", status: CONSOL_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, archivedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _scProfiles.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _scCheckP(from, to) { const a = _scProfTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid consol profile transition ${from} → ${to}`); }
function _scCountActive(owner) { let n = 0; for (const p of _scProfiles.values()) if (p.owner === owner && p.status === CONSOL_PROFILE_MATURITY_V2.ACTIVE) n++; return n; }

export function activateConsolProfileV2(id) {
  const p = _scProfiles.get(id); if (!p) throw new Error(`consol profile ${id} not found`);
  _scCheckP(p.status, CONSOL_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === CONSOL_PROFILE_MATURITY_V2.PAUSED;
  if (!recovery) { const a = _scCountActive(p.owner); if (a >= _scMaxActivePerOwner) throw new Error(`max active consol profiles per owner (${_scMaxActivePerOwner}) reached for ${p.owner}`); }
  const now = Date.now(); p.status = CONSOL_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now; if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseConsolProfileV2(id) { const p = _scProfiles.get(id); if (!p) throw new Error(`consol profile ${id} not found`); _scCheckP(p.status, CONSOL_PROFILE_MATURITY_V2.PAUSED); p.status = CONSOL_PROFILE_MATURITY_V2.PAUSED; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archiveConsolProfileV2(id) { const p = _scProfiles.get(id); if (!p) throw new Error(`consol profile ${id} not found`); _scCheckP(p.status, CONSOL_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = CONSOL_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchConsolProfileV2(id) { const p = _scProfiles.get(id); if (!p) throw new Error(`consol profile ${id} not found`); if (_scProfTerminal.has(p.status)) throw new Error(`cannot touch terminal consol profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getConsolProfileV2(id) { const p = _scProfiles.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listConsolProfilesV2() { return [..._scProfiles.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }

function _scCountPending(pid) { let n = 0; for (const j of _scJobs.values()) if (j.profileId === pid && (j.status === CONSOL_JOB_LIFECYCLE_V2.QUEUED || j.status === CONSOL_JOB_LIFECYCLE_V2.RUNNING)) n++; return n; }

export function createConsolJobV2({ id, profileId, sessionId, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string") throw new Error("profileId is required");
  if (_scJobs.has(id)) throw new Error(`consol job ${id} already exists`);
  if (!_scProfiles.has(profileId)) throw new Error(`consol profile ${profileId} not found`);
  const pending = _scCountPending(profileId);
  if (pending >= _scMaxPendingPerProfile) throw new Error(`max pending consol jobs per profile (${_scMaxPendingPerProfile}) reached for ${profileId}`);
  const now = Date.now();
  const j = { id, profileId, sessionId: sessionId || null, status: CONSOL_JOB_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _scJobs.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
function _scCheckJ(from, to) { const a = _scJobTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid consol job transition ${from} → ${to}`); }
export function startConsolJobV2(id) { const j = _scJobs.get(id); if (!j) throw new Error(`consol job ${id} not found`); _scCheckJ(j.status, CONSOL_JOB_LIFECYCLE_V2.RUNNING); const now = Date.now(); j.status = CONSOL_JOB_LIFECYCLE_V2.RUNNING; j.updatedAt = now; if (!j.startedAt) j.startedAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function completeConsolJobV2(id) { const j = _scJobs.get(id); if (!j) throw new Error(`consol job ${id} not found`); _scCheckJ(j.status, CONSOL_JOB_LIFECYCLE_V2.COMPLETED); const now = Date.now(); j.status = CONSOL_JOB_LIFECYCLE_V2.COMPLETED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function failConsolJobV2(id, reason) { const j = _scJobs.get(id); if (!j) throw new Error(`consol job ${id} not found`); _scCheckJ(j.status, CONSOL_JOB_LIFECYCLE_V2.FAILED); const now = Date.now(); j.status = CONSOL_JOB_LIFECYCLE_V2.FAILED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.failReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function cancelConsolJobV2(id, reason) { const j = _scJobs.get(id); if (!j) throw new Error(`consol job ${id} not found`); _scCheckJ(j.status, CONSOL_JOB_LIFECYCLE_V2.CANCELLED); const now = Date.now(); j.status = CONSOL_JOB_LIFECYCLE_V2.CANCELLED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.cancelReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function getConsolJobV2(id) { const j = _scJobs.get(id); if (!j) return null; return { ...j, metadata: { ...j.metadata } }; }
export function listConsolJobsV2() { return [..._scJobs.values()].map((j) => ({ ...j, metadata: { ...j.metadata } })); }

export function autoPauseIdleConsolProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _scProfiles.values()) if (p.status === CONSOL_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _scProfileIdleMs) { p.status = CONSOL_PROFILE_MATURITY_V2.PAUSED; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckConsolJobsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const j of _scJobs.values()) if (j.status === CONSOL_JOB_LIFECYCLE_V2.RUNNING && j.startedAt != null && (t - j.startedAt) >= _scJobStuckMs) { j.status = CONSOL_JOB_LIFECYCLE_V2.FAILED; j.updatedAt = t; if (!j.settledAt) j.settledAt = t; j.metadata.failReason = "auto-fail-stuck"; flipped.push(j.id); } return { flipped, count: flipped.length }; }

export function getSessionConsolidatorStatsV2() {
  const profilesByStatus = {}; for (const s of Object.values(CONSOL_PROFILE_MATURITY_V2)) profilesByStatus[s] = 0; for (const p of _scProfiles.values()) profilesByStatus[p.status]++;
  const jobsByStatus = {}; for (const s of Object.values(CONSOL_JOB_LIFECYCLE_V2)) jobsByStatus[s] = 0; for (const j of _scJobs.values()) jobsByStatus[j.status]++;
  return { totalProfilesV2: _scProfiles.size, totalJobsV2: _scJobs.size, maxActiveConsolProfilesPerOwner: _scMaxActivePerOwner, maxPendingConsolJobsPerProfile: _scMaxPendingPerProfile, consolProfileIdleMs: _scProfileIdleMs, consolJobStuckMs: _scJobStuckMs, profilesByStatus, jobsByStatus };
}
