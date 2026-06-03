/**
 * GatewayBase — shared foundation for messaging platform gateways.
 *
 * Each gateway (Telegram, Discord, etc.) extends this class.
 * Provides: session-per-chat management, message mapping, rate limiting,
 * and integration with the agent loop.
 *
 * @module gateway-base
 */

import { EventEmitter } from "node:events";

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_MAX_RESPONSE_LENGTH = 4000;
const DEFAULT_RATE_LIMIT_WINDOW = 60000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX = 20; // messages per window

// ─── GatewayBase ────────────────────────────────────────────────────

export class GatewayBase extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.platform - Platform name (e.g. "telegram", "discord")
   * @param {number} [options.maxResponseLength] - Max chars per response
   * @param {number} [options.rateLimitWindow] - Rate limit window in ms
   * @param {number} [options.rateLimitMax] - Max messages per window
   */
  constructor(options = {}) {
    super();
    this.platform = options.platform || "unknown";
    this.maxResponseLength =
      options.maxResponseLength || DEFAULT_MAX_RESPONSE_LENGTH;
    this.rateLimitWindow = options.rateLimitWindow || DEFAULT_RATE_LIMIT_WINDOW;
    this.rateLimitMax = options.rateLimitMax || DEFAULT_RATE_LIMIT_MAX;

    /** @type {Map<string, { messages: object[], lastActivity: number }>} */
    this.sessions = new Map();

    /** @type {Map<string, number[]>} */
    this._rateLimitBuckets = new Map();

    this._running = false;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start the gateway. Override in subclass. */
  async start() {
    this._running = true;
    this.emit("started", { platform: this.platform });
  }

  /** Stop the gateway. Override in subclass. */
  async stop() {
    this._running = false;
    this.sessions.clear();
    this._rateLimitBuckets.clear();
    this.emit("stopped", { platform: this.platform });
  }

  /** @returns {boolean} */
  isRunning() {
    return this._running;
  }

  // ── Session management ──────────────────────────────────────────

  /**
   * Get or create a session for a chat.
   * @param {string} chatId - Platform-specific chat identifier
   * @returns {{ messages: object[], lastActivity: number, isNew: boolean }}
   */
  getOrCreateSession(chatId) {
    if (this.sessions.has(chatId)) {
      const session = this.sessions.get(chatId);
      session.lastActivity = Date.now();
      return { ...session, isNew: false };
    }

    const session = {
      messages: [],
      lastActivity: Date.now(),
    };
    this.sessions.set(chatId, session);
    return { ...session, isNew: true };
  }

  /**
   * Add a message to a chat session.
   * @param {string} chatId
   * @param {string} role - "user" | "assistant"
   * @param {string} content
   */
  addMessage(chatId, role, content) {
    const session = this.sessions.get(chatId);
    if (session) {
      session.messages.push({ role, content });
      session.lastActivity = Date.now();
    }
  }

  /**
   * Clear a chat session.
   * @param {string} chatId
   */
  clearSession(chatId) {
    this.sessions.delete(chatId);
  }

  /**
   * Get active session count.
   * @returns {number}
   */
  getSessionCount() {
    return this.sessions.size;
  }

  // ── Rate limiting ───────────────────────────────────────────────

  /**
   * Check if a chat is rate-limited.
   * @param {string} chatId
   * @returns {boolean}
   */
  isRateLimited(chatId) {
    const now = Date.now();
    const bucket = this._rateLimitBuckets.get(chatId) || [];
    // Clean old entries
    const recent = bucket.filter((ts) => now - ts < this.rateLimitWindow);
    this._rateLimitBuckets.set(chatId, recent);
    return recent.length >= this.rateLimitMax;
  }

  /**
   * Record a message for rate limiting.
   * @param {string} chatId
   */
  recordMessage(chatId) {
    const bucket = this._rateLimitBuckets.get(chatId) || [];
    bucket.push(Date.now());
    this._rateLimitBuckets.set(chatId, bucket);
  }

  // ── Message formatting ──────────────────────────────────────────

  /**
   * Split a long response into chunks.
   * @param {string} text
   * @param {number} [maxLength]
   * @returns {string[]}
   */
  splitResponse(text, maxLength) {
    const limit = maxLength || this.maxResponseLength;
    if (!text || text.length <= limit) return [text || ""];

    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      // Try to split at last newline within limit
      let splitIdx = remaining.lastIndexOf("\n", limit);
      if (splitIdx < limit * 0.5) {
        // No good newline split point — split at limit
        splitIdx = limit;
      }
      chunks.push(remaining.substring(0, splitIdx));
      remaining = remaining.substring(splitIdx).trimStart();
    }
    return chunks;
  }

  // ── Stats ───────────────────────────────────────────────────────

  /**
   * Get gateway statistics.
   * @returns {{ platform: string, running: boolean, sessions: number }}
   */
  getStats() {
    return {
      platform: this.platform,
      running: this._running,
      sessions: this.sessions.size,
    };
  }
}
