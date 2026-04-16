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
