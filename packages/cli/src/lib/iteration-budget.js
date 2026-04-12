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
