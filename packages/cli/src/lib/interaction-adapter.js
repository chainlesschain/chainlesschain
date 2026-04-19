/**
 * Interaction Adapter — abstraction layer for user interaction
 *
 * Unifies terminal REPL and WebSocket modes so that agent-core, slot-filler,
 * and interactive-planner can ask the user questions without knowing the
 * transport.
 */

import { createHash } from "crypto";
import {
  createCodingAgentEvent,
  CodingAgentSequenceTracker,
  CODING_AGENT_EVENT_TYPES,
  LEGACY_TO_UNIFIED_TYPE,
} from "../runtime/runtime-events.js";
import { createAbortError } from "./abort-utils.js";
import { createEnvelope } from "@chainlesschain/session-core";

// Phase 5: parallel service-envelope emission. Map WS agent-handler event
// types onto the canonical `run.*` run-loop envelope types. Events not in
// this map are skipped (legacy coding-agent envelope still flows).
const AGENT_EVENT_TO_ENVELOPE_TYPE = Object.freeze({
  "tool-executing": "run.tool_call",
  "tool-result": "run.tool_result",
  "response-complete": "run.message",
  error: "run.error",
  // Phase 5 bookends — emitted by agentLoop at entry / termination so
  // envelope subscribers can correlate a full run by runId.
  "run-started": "run.started",
  "run-ended": "run.ended",
});

// Whitelist of event types the CLI runtime should emit as unified envelopes
// (with source: "cli-runtime"). Anything not in this set keeps the legacy
// raw shape so non-coding-agent transports (host-tool callbacks, generic
// progress events, etc.) are unaffected.
const CODING_AGENT_EVENT_TYPE_SET = new Set([
  ...Object.values(CODING_AGENT_EVENT_TYPES),
  ...Object.keys(LEGACY_TO_UNIFIED_TYPE),
]);

function isCodingAgentEventType(type) {
  return typeof type === "string" && CODING_AGENT_EVENT_TYPE_SET.has(type);
}

/**
 * Base class — subclasses must implement askInput, askSelect, askConfirm, emit.
 */
export class InteractionAdapter {
  /** @param {string} question  @param {object} [options] @returns {Promise<string>} */
  async askInput(question, _options) {
    throw new Error(`askInput not implemented: ${question}`);
  }

  /** @param {string} question  @param {Array<{name:string,value:string}>} choices @returns {Promise<string>} */
  async askSelect(question, _choices) {
    throw new Error(`askSelect not implemented: ${question}`);
  }

  /** @param {string} question  @param {boolean} [defaultVal] @returns {Promise<boolean>} */
  async askConfirm(question, _defaultVal) {
    throw new Error(`askConfirm not implemented: ${question}`);
  }

  /** Emit an event to the consumer (terminal stdout or WebSocket client) */
  emit(_eventType, _data) {}
}

// ─── Terminal mode ────────────────────────────────────────────────────────

/**
 * Terminal adapter — wraps @inquirer/prompts via prompts.js
 */
export class TerminalInteractionAdapter extends InteractionAdapter {
  constructor() {
    super();
    this._prompts = null;
  }

  async _loadPrompts() {
    if (!this._prompts) {
      this._prompts = await import("./prompts.js");
    }
    return this._prompts;
  }

  async askInput(question, options = {}) {
    const p = await this._loadPrompts();
    return p.askInput(question, options.default || "");
  }

  async askSelect(question, choices) {
    const p = await this._loadPrompts();
    return p.askSelect(question, choices);
  }

  async askConfirm(question, defaultVal = true) {
    const p = await this._loadPrompts();
    return p.askConfirm(question, defaultVal);
  }

  emit(_eventType, _data) {
    // Terminal mode does not need to emit structured events —
    // callers use process.stdout directly.
  }
}

// ─── WebSocket mode ───────────────────────────────────────────────────────

/**
 * WebSocket adapter — sends question messages to the client and waits for
 * session-answer responses.
 */
export class WebSocketInteractionAdapter extends InteractionAdapter {
  /**
   * @param {import("ws").WebSocket} ws
   * @param {string} sessionId
   */
  constructor(ws, sessionId, options = {}) {
    super();
    this.ws = ws;
    this.sessionId = sessionId;
    /** @type {Map<string, {resolve: Function, reject: Function, timeoutId: ReturnType<typeof setTimeout>|null}>} */
    this._pending = new Map();
    // Per-instance sequence tracker so monotonic sequences are scoped to
    // this WS session instead of leaking across sessions via the process-
    // global default tracker.
    this._sequenceTracker = new CodingAgentSequenceTracker();
    // Phase 5: parallel service-envelope emission. Opt-in (default off) so
    // legacy callers that count ws.send invocations stay green.
    this.enablePhase5Envelopes = options.enablePhase5Envelopes === true;
    // Optional fan-out bus for hosted HTTP SSE subscribers.
    this.envelopeBus = options.envelopeBus || null;
  }

  /** Generate a unique request id */
  _requestId() {
    return `q-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;
  }

  /**
   * Ask a question over WebSocket and wait for the answer.
   * @param {string} questionType - "input" | "select" | "confirm"
   * @param {string} question
   * @param {object} [extra] - choices, default, etc.
   * @returns {Promise<string|boolean>}
   */
  _request(message, options = {}) {
    return new Promise((resolve, reject) => {
      const requestId = this._requestId();
      const timeoutId = setTimeout(
        () => {
          const pending = this._pending.get(requestId);
          if (!pending) {
            return;
          }
          this._pending.delete(requestId);
          reject(new Error("Question timed out"));
        },
        options.timeoutMs || 5 * 60 * 1000,
      );
      this._pending.set(requestId, { resolve, reject, timeoutId });

      this._sendWs({
        ...message,
        sessionId: this.sessionId,
        requestId,
      });
    });
  }

  _ask(questionType, question, extra = {}) {
    return this._request({
      type: "question",
      questionType,
      question,
      ...extra,
    });
  }

  async askInput(question, options = {}) {
    return this._ask("input", question, { default: options.default || "" });
  }

  async askSelect(question, choices) {
    return this._ask("select", question, { choices });
  }

  async askConfirm(question, defaultVal = true) {
    const answer = await this._ask("confirm", question, {
      default: defaultVal,
    });
    // Normalize to boolean
    if (typeof answer === "boolean") return answer;
    return answer === "true" || answer === "yes" || answer === "y";
  }

  /**
   * Called by ws-server when a session-answer message arrives.
   * Resolves the corresponding pending promise.
   */
  resolveAnswer(requestId, answer) {
    this._resolvePending(requestId, answer);
  }

  async requestHostTool(toolName, args = {}, extra = {}) {
    return this._request(
      {
        type: "host-tool-call",
        toolName,
        args,
        ...extra,
      },
      { timeoutMs: extra.timeoutMs || 60 * 1000 },
    );
  }

  resolveHostTool(requestId, payload) {
    this._resolvePending(requestId, payload);
  }

  rejectAllPending(reason = createAbortError("Interaction interrupted")) {
    const error =
      reason instanceof Error ? reason : createAbortError(String(reason));

    for (const [requestId, pending] of this._pending.entries()) {
      this._pending.delete(requestId);
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(error);
    }
  }

  emit(eventType, data) {
    // Coding-agent events flow as the unified envelope so the Desktop bridge
    // (and any other consumer) sees a single canonical shape with
    // source: "cli-runtime" baked in — no Bridge-layer translation needed.
    if (isCodingAgentEventType(eventType)) {
      const payload = data && typeof data === "object" ? { ...data } : {};
      const requestId = payload.requestId || null;
      const sessionId = payload.sessionId || this.sessionId || null;
      delete payload.requestId;
      delete payload.sessionId;

      const envelope = createCodingAgentEvent(eventType, payload, {
        sessionId,
        requestId,
        source: "cli-runtime",
        tracker: this._sequenceTracker,
      });
      this._sendWs(envelope);
      // Phase 5: parallel service-envelope emission for unified subscribers.
      this._sendPhase5Envelope(eventType, payload, { sessionId, requestId });
      return;
    }

    // Non-coding-agent events (host-tool callbacks, generic progress, etc.)
    // keep the legacy raw shape — they are not part of the v1.0 protocol.
    this._sendWs({
      type: eventType,
      sessionId: this.sessionId,
      ...data,
    });

    // Phase 5: even for non-coding-agent events, forward if the type maps to
    // a canonical envelope (run-started / run-ended bookends flow here).
    if (AGENT_EVENT_TO_ENVELOPE_TYPE[eventType]) {
      const payload = data && typeof data === "object" ? { ...data } : {};
      const requestId = payload.requestId || null;
      const sessionId = payload.sessionId || this.sessionId || null;
      delete payload.requestId;
      delete payload.sessionId;
      this._sendPhase5Envelope(eventType, payload, { sessionId, requestId });
    }
  }

  _sendPhase5Envelope(eventType, payload, { sessionId, requestId }) {
    if (!this.enablePhase5Envelopes) return;
    const envType = AGENT_EVENT_TO_ENVELOPE_TYPE[eventType];
    if (!envType) return;
    try {
      const env = createEnvelope({
        type: envType,
        sessionId: sessionId || null,
        runId: payload?.runId || null,
        requestId: requestId || null,
        payload: { ...(payload || {}) },
      });
      this._sendWs(env);
      if (this.envelopeBus && env.sessionId) {
        try {
          this.envelopeBus.publish(env.sessionId, env);
        } catch (_e) {
          // Bus fan-out must never break the WS path.
        }
      }
    } catch (_e) {
      // Phase 5 is additive — never break the legacy path on envelope failure.
    }
  }

  _sendWs(data) {
    if (this.ws.readyState === this.ws.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (_err) {
        // Connection may have closed
      }
    }
  }

  _resolvePending(requestId, payload) {
    const pending = this._pending.get(requestId);
    if (!pending) {
      return;
    }

    this._pending.delete(requestId);
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    pending.resolve(payload);
  }
}

// =====================================================================
// interaction-adapter V2 governance overlay (iter26)
// =====================================================================
export const IAGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  IDLE: "idle",
  ARCHIVED: "archived",
});
export const IAGOV_TURN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RESPONDING: "responding",
  RESPONDED: "responded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _iagovPTrans = new Map([
  [
    IAGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      IAGOV_PROFILE_MATURITY_V2.ACTIVE,
      IAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    IAGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      IAGOV_PROFILE_MATURITY_V2.IDLE,
      IAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    IAGOV_PROFILE_MATURITY_V2.IDLE,
    new Set([
      IAGOV_PROFILE_MATURITY_V2.ACTIVE,
      IAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [IAGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _iagovPTerminal = new Set([IAGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _iagovJTrans = new Map([
  [
    IAGOV_TURN_LIFECYCLE_V2.QUEUED,
    new Set([
      IAGOV_TURN_LIFECYCLE_V2.RESPONDING,
      IAGOV_TURN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    IAGOV_TURN_LIFECYCLE_V2.RESPONDING,
    new Set([
      IAGOV_TURN_LIFECYCLE_V2.RESPONDED,
      IAGOV_TURN_LIFECYCLE_V2.FAILED,
      IAGOV_TURN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [IAGOV_TURN_LIFECYCLE_V2.RESPONDED, new Set()],
  [IAGOV_TURN_LIFECYCLE_V2.FAILED, new Set()],
  [IAGOV_TURN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _iagovPsV2 = new Map();
const _iagovJsV2 = new Map();
let _iagovMaxActive = 6,
  _iagovMaxPending = 15,
  _iagovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _iagovStuckMs = 60 * 1000;
function _iagovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _iagovCheckP(from, to) {
  const a = _iagovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid iagov profile transition ${from} → ${to}`);
}
function _iagovCheckJ(from, to) {
  const a = _iagovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid iagov turn transition ${from} → ${to}`);
}
function _iagovCountActive(owner) {
  let c = 0;
  for (const p of _iagovPsV2.values())
    if (p.owner === owner && p.status === IAGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _iagovCountPending(profileId) {
  let c = 0;
  for (const j of _iagovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === IAGOV_TURN_LIFECYCLE_V2.QUEUED ||
        j.status === IAGOV_TURN_LIFECYCLE_V2.RESPONDING)
    )
      c++;
  return c;
}
export function setMaxActiveIagovProfilesPerOwnerV2(n) {
  _iagovMaxActive = _iagovPos(n, "maxActiveIagovProfilesPerOwner");
}
export function getMaxActiveIagovProfilesPerOwnerV2() {
  return _iagovMaxActive;
}
export function setMaxPendingIagovTurnsPerProfileV2(n) {
  _iagovMaxPending = _iagovPos(n, "maxPendingIagovTurnsPerProfile");
}
export function getMaxPendingIagovTurnsPerProfileV2() {
  return _iagovMaxPending;
}
export function setIagovProfileIdleMsV2(n) {
  _iagovIdleMs = _iagovPos(n, "iagovProfileIdleMs");
}
export function getIagovProfileIdleMsV2() {
  return _iagovIdleMs;
}
export function setIagovTurnStuckMsV2(n) {
  _iagovStuckMs = _iagovPos(n, "iagovTurnStuckMs");
}
export function getIagovTurnStuckMsV2() {
  return _iagovStuckMs;
}
export function _resetStateInteractionAdapterGovV2() {
  _iagovPsV2.clear();
  _iagovJsV2.clear();
  _iagovMaxActive = 6;
  _iagovMaxPending = 15;
  _iagovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _iagovStuckMs = 60 * 1000;
}
export function registerIagovProfileV2({ id, owner, adapter, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_iagovPsV2.has(id)) throw new Error(`iagov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    adapter: adapter || "cli",
    status: IAGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _iagovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateIagovProfileV2(id) {
  const p = _iagovPsV2.get(id);
  if (!p) throw new Error(`iagov profile ${id} not found`);
  const isInitial = p.status === IAGOV_PROFILE_MATURITY_V2.PENDING;
  _iagovCheckP(p.status, IAGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _iagovCountActive(p.owner) >= _iagovMaxActive)
    throw new Error(`max active iagov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = IAGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function idleIagovProfileV2(id) {
  const p = _iagovPsV2.get(id);
  if (!p) throw new Error(`iagov profile ${id} not found`);
  _iagovCheckP(p.status, IAGOV_PROFILE_MATURITY_V2.IDLE);
  p.status = IAGOV_PROFILE_MATURITY_V2.IDLE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveIagovProfileV2(id) {
  const p = _iagovPsV2.get(id);
  if (!p) throw new Error(`iagov profile ${id} not found`);
  _iagovCheckP(p.status, IAGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = IAGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchIagovProfileV2(id) {
  const p = _iagovPsV2.get(id);
  if (!p) throw new Error(`iagov profile ${id} not found`);
  if (_iagovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal iagov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getIagovProfileV2(id) {
  const p = _iagovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listIagovProfilesV2() {
  return [..._iagovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createIagovTurnV2({ id, profileId, input, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_iagovJsV2.has(id)) throw new Error(`iagov turn ${id} already exists`);
  if (!_iagovPsV2.has(profileId))
    throw new Error(`iagov profile ${profileId} not found`);
  if (_iagovCountPending(profileId) >= _iagovMaxPending)
    throw new Error(`max pending iagov turns for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    input: input || "",
    status: IAGOV_TURN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _iagovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function respondingIagovTurnV2(id) {
  const j = _iagovJsV2.get(id);
  if (!j) throw new Error(`iagov turn ${id} not found`);
  _iagovCheckJ(j.status, IAGOV_TURN_LIFECYCLE_V2.RESPONDING);
  const now = Date.now();
  j.status = IAGOV_TURN_LIFECYCLE_V2.RESPONDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeTurnIagovV2(id) {
  const j = _iagovJsV2.get(id);
  if (!j) throw new Error(`iagov turn ${id} not found`);
  _iagovCheckJ(j.status, IAGOV_TURN_LIFECYCLE_V2.RESPONDED);
  const now = Date.now();
  j.status = IAGOV_TURN_LIFECYCLE_V2.RESPONDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failIagovTurnV2(id, reason) {
  const j = _iagovJsV2.get(id);
  if (!j) throw new Error(`iagov turn ${id} not found`);
  _iagovCheckJ(j.status, IAGOV_TURN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = IAGOV_TURN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelIagovTurnV2(id, reason) {
  const j = _iagovJsV2.get(id);
  if (!j) throw new Error(`iagov turn ${id} not found`);
  _iagovCheckJ(j.status, IAGOV_TURN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = IAGOV_TURN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getIagovTurnV2(id) {
  const j = _iagovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listIagovTurnsV2() {
  return [..._iagovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoIdleIdleIagovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _iagovPsV2.values())
    if (
      p.status === IAGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _iagovIdleMs
    ) {
      p.status = IAGOV_PROFILE_MATURITY_V2.IDLE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckIagovTurnsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _iagovJsV2.values())
    if (
      j.status === IAGOV_TURN_LIFECYCLE_V2.RESPONDING &&
      j.startedAt != null &&
      t - j.startedAt >= _iagovStuckMs
    ) {
      j.status = IAGOV_TURN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getInteractionAdapterGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(IAGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _iagovPsV2.values()) profilesByStatus[p.status]++;
  const turnsByStatus = {};
  for (const v of Object.values(IAGOV_TURN_LIFECYCLE_V2)) turnsByStatus[v] = 0;
  for (const j of _iagovJsV2.values()) turnsByStatus[j.status]++;
  return {
    totalIagovProfilesV2: _iagovPsV2.size,
    totalIagovTurnsV2: _iagovJsV2.size,
    maxActiveIagovProfilesPerOwner: _iagovMaxActive,
    maxPendingIagovTurnsPerProfile: _iagovMaxPending,
    iagovProfileIdleMs: _iagovIdleMs,
    iagovTurnStuckMs: _iagovStuckMs,
    profilesByStatus,
    turnsByStatus,
  };
}
