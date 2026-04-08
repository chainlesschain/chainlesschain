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
