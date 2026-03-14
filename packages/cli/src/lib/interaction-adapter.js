/**
 * Interaction Adapter — abstraction layer for user interaction
 *
 * Unifies terminal REPL and WebSocket modes so that agent-core, slot-filler,
 * and interactive-planner can ask the user questions without knowing the
 * transport.
 */

import { createHash } from "crypto";

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
  constructor(ws, sessionId) {
    super();
    this.ws = ws;
    this.sessionId = sessionId;
    /** @type {Map<string, {resolve: Function, reject: Function}>} */
    this._pending = new Map();
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
  _ask(questionType, question, extra = {}) {
    return new Promise((resolve, reject) => {
      const requestId = this._requestId();
      this._pending.set(requestId, { resolve, reject });

      this._sendWs({
        type: "question",
        sessionId: this.sessionId,
        requestId,
        questionType,
        question,
        ...extra,
      });

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (this._pending.has(requestId)) {
            this._pending.delete(requestId);
            reject(new Error("Question timed out"));
          }
        },
        5 * 60 * 1000,
      );
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
    const pending = this._pending.get(requestId);
    if (pending) {
      this._pending.delete(requestId);
      pending.resolve(answer);
    }
  }

  emit(eventType, data) {
    this._sendWs({
      type: eventType,
      sessionId: this.sessionId,
      ...data,
    });
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
}
