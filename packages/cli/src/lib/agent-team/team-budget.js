/**
 * TeamBudget (Phase 4 — Agent Team) — a team-wide spend cap across four
 * independent dimensions, consulted by TeamRunner BEFORE it hands a teammate a
 * new task so a runaway graph is bounded and a resumed session keeps counting
 * from where it left off (Phase 4 acceptance "支持 token、时间、并发数和费用预算"
 * + "团队会话恢复后…预算保持一致").
 *
 *   - maxTasks    total task EXECUTIONS across all teammates (task-count cap)
 *   - maxTokens   total (input+output) LLM tokens folded from task results
 *   - maxUsd      total estimated USD spend — delegated to the audited CostBudget
 *                 (same pricing/cache-token rules as `--max-budget-usd`)
 *   - maxWallMs   wall-clock since the first task started (time cap)
 *
 * Because a task's cost is only known once it returns, the team may overshoot a
 * token/USD cap by at most one task — like CostBudget, it never STARTS a task
 * once already over. A dimension left null is simply inactive. The clock is
 * injected so the wall-clock cap is deterministic in tests, and snapshot/restore
 * carries the running totals so `cc team run --resume` doesn't reset the budget.
 */

import { CostBudget } from "../cost-budget.js";

const pos = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export class TeamBudget {
  constructor({
    maxTasks = null,
    maxTokens = null,
    maxUsd = null,
    maxWallMs = null,
    table = undefined,
    now = () => Date.now(),
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this.maxTasks = pos(maxTasks);
    this.maxTokens = pos(maxTokens);
    this.maxWallMs = pos(maxWallMs);
    this.cost = new CostBudget({ limitUsd: maxUsd, table });
    this.tasks = 0;
    this.tokens = 0;
    this.startedAt = null; // set on the first recorded task
  }

  /** Any dimension active? (an all-null budget never stops anything). */
  enabled() {
    return (
      this.maxTasks != null ||
      this.maxTokens != null ||
      this.maxWallMs != null ||
      this.cost.enabled()
    );
  }

  /** Begin the wall-clock window (idempotent — first call wins). */
  start(now = this._now()) {
    if (this.startedAt == null) this.startedAt = now;
    return this;
  }

  /**
   * Fold one settled task into the running totals. `usage` (an LLM token-usage
   * event) is optional — a plain `--exec` shell task carries none, so only the
   * task-count / wall-clock dimensions move for it.
   * @returns {this}
   */
  record({ usage = null, provider, model } = {}, now = this._now()) {
    this.start(now);
    this.tasks += 1;
    if (usage) {
      this.tokens +=
        (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
      this.cost.add({ provider, model, usage });
    }
    return this;
  }

  /**
   * Which cap (if any) is now reached — checked BEFORE starting a new task.
   * @returns {null|"max-tasks"|"max-tokens"|"max-usd"|"max-wall-ms"}
   */
  reason(now = this._now()) {
    if (this.maxTasks != null && this.tasks >= this.maxTasks) {
      return "max-tasks";
    }
    if (this.maxTokens != null && this.tokens >= this.maxTokens) {
      return "max-tokens";
    }
    if (this.cost.exceeded()) return "max-usd";
    if (
      this.maxWallMs != null &&
      this.startedAt != null &&
      now - this.startedAt >= this.maxWallMs
    ) {
      return "max-wall-ms";
    }
    return null;
  }

  /** True once any active cap has been reached. */
  shouldStop(now = this._now()) {
    return this.reason(now) != null;
  }

  status(now = this._now()) {
    return {
      tasks: this.tasks,
      maxTasks: this.maxTasks,
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      spentUsd: this.cost.spentUsd,
      maxUsd: this.cost.limitUsd,
      elapsedMs: this.startedAt == null ? 0 : now - this.startedAt,
      maxWallMs: this.maxWallMs,
      reason: this.reason(now),
    };
  }

  snapshot() {
    return {
      limits: {
        maxTasks: this.maxTasks,
        maxTokens: this.maxTokens,
        maxUsd: this.cost.limitUsd,
        maxWallMs: this.maxWallMs,
      },
      totals: {
        tasks: this.tasks,
        tokens: this.tokens,
        spentUsd: this.cost.spentUsd,
        startedAt: this.startedAt,
      },
    };
  }

  /**
   * Restore running totals + caps from a snapshot. `overrides` lets the current
   * CLI invocation RAISE/lower a cap on resume — a provided (non-nullish) value
   * wins over the snapshot's; an omitted one keeps the prior cap (so a resume
   * with no flags can't silently drop a safety cap).
   */
  static restore(snap, { now = () => Date.now(), table, overrides = {} } = {}) {
    const pick = (o, s) => (o == null ? s : o);
    const b = new TeamBudget({
      maxTasks: pick(overrides.maxTasks, snap?.limits?.maxTasks),
      maxTokens: pick(overrides.maxTokens, snap?.limits?.maxTokens),
      maxUsd: pick(overrides.maxUsd, snap?.limits?.maxUsd),
      maxWallMs: pick(overrides.maxWallMs, snap?.limits?.maxWallMs),
      table,
      now,
    });
    b.tasks = Number(snap?.totals?.tasks) || 0;
    b.tokens = Number(snap?.totals?.tokens) || 0;
    // Preserve prior USD spend so the cap keeps counting across a resume.
    const spent = Number(snap?.totals?.spentUsd);
    b.cost.spentUsd = Number.isFinite(spent) && spent >= 0 ? spent : 0;
    if (b.cost.spentUsd > 0) b.cost.priced = true;
    // A time cap must NOT keep counting wall-clock across a crash gap (the
    // process was down); restart the window on the next recorded task.
    b.startedAt = null;
    return b;
  }
}
