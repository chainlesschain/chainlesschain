/**
 * cost-budget — a hard USD spend cap for unattended agent runs
 * (Claude-Code `--max-budget-usd` parity).
 *
 * Where IterationBudget caps the number of agent-loop turns, CostBudget caps the
 * estimated dollar cost: it accumulates the per-call cost (via llm-pricing) as
 * token-usage events arrive and reports when the cap is reached, so the runner
 * can stop BEFORE making another paid LLM call. Because a call's cost is only
 * known after it returns, a run may overshoot by at most one call — it never
 * starts a new turn once over budget.
 *
 * Local/free providers (ollama, …) and unpriced models cost $0 here, so a cap
 * can never trigger for them; `shouldWarnInactive()` lets the caller surface a
 * one-time "cap inactive" notice instead of silently doing nothing.
 *
 * Pure + dependency-light (only llm-pricing) so it is unit-testable without a
 * real agent loop.
 */

import { estimateCost } from "./llm-pricing.js";

const round = (n, dp = 6) => {
  const f = Math.pow(10, dp);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

/** Parse a `--max-budget-usd` value into a positive number, or null when unset. */
export function parseBudgetUsd(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid --max-budget-usd "${value}". Expected a positive number of US dollars.`,
    );
  }
  return n;
}

export class CostBudget {
  /**
   * @param {object} opts
   * @param {number|null} [opts.limitUsd] cap in USD; null/≤0 → disabled
   * @param {object} [opts.table]         merged price table (mergePricing output)
   */
  constructor({ limitUsd = null, table = undefined } = {}) {
    const lim = Number(limitUsd);
    this.limitUsd = Number.isFinite(lim) && lim > 0 ? lim : null;
    this.table = table;
    this.spentUsd = 0;
    this.priced = false; // priced ≥1 non-free usage record
    this.sawUnpriced = false; // saw tokens we couldn't price
    this.sawFree = false; // saw a free/local provider
    this._warned = false;
  }

  enabled() {
    return this.limitUsd != null;
  }

  /**
   * Fold one token-usage record into the running spend.
   * @returns {object} the estimateCost() result for this record
   */
  add({ provider, model, usage } = {}) {
    const est = estimateCost({
      provider,
      model,
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0,
      table: this.table,
    });
    const tokens = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
    if (est.free) {
      this.sawFree = true;
    } else if (est.matched) {
      this.spentUsd = round(this.spentUsd + est.totalCost);
      this.priced = true;
    } else if (tokens > 0) {
      this.sawUnpriced = true;
    }
    return est;
  }

  /** True once the running spend has reached/passed the cap. */
  exceeded() {
    return this.limitUsd != null && this.spentUsd >= this.limitUsd;
  }

  /** USD left under the cap (Infinity when disabled). */
  remaining() {
    return this.limitUsd == null
      ? Infinity
      : Math.max(0, round(this.limitUsd - this.spentUsd));
  }

  /**
   * True the FIRST time we can tell the cap can't bite — a cap was set but every
   * usage so far has been free/local or unpriced, so spend stays $0. Lets the
   * caller print a one-time "cap inactive" warning instead of a silent no-op.
   */
  shouldWarnInactive() {
    if (!this.enabled() || this._warned || this.priced) return false;
    if (this.sawUnpriced || this.sawFree) {
      this._warned = true;
      return true;
    }
    return false;
  }
}
