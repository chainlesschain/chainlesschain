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
 * Concurrent agent tasks reserve a bounded slice of the remaining token/USD
 * ceilings before they start. The slice becomes the child task's own hard stop,
 * preventing a 64-worker frontier from each spending the full team remainder.
 * A dimension left null is inactive. Snapshot/restore carries settled totals;
 * in-flight reservations are intentionally discarded after a crash because the
 * caller must adjudicate those executions before resuming.
 */

import { CostBudget } from "../cost-budget.js";

const pos = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

function assertBudgetSnapshot(snap) {
  if (
    !snap ||
    typeof snap !== "object" ||
    Array.isArray(snap) ||
    !snap.limits ||
    typeof snap.limits !== "object" ||
    !snap.totals ||
    typeof snap.totals !== "object"
  ) {
    throw new TypeError("invalid team budget snapshot");
  }
  for (const field of ["maxTasks", "maxTokens", "maxUsd", "maxWallMs"]) {
    const value = snap.limits[field];
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      throw new TypeError(`invalid team budget limit: ${field}`);
    }
  }
  for (const field of ["tasks", "tokens", "spentUsd", "elapsedMs"]) {
    const value = snap.totals[field];
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`invalid team budget total: ${field}`);
    }
  }
  for (const field of ["maxTasks", "maxTokens"]) {
    const value = snap.limits[field];
    if (value !== null && !Number.isSafeInteger(value)) {
      throw new TypeError(`invalid team budget integer limit: ${field}`);
    }
  }
  for (const field of ["tasks", "tokens"]) {
    if (!Number.isSafeInteger(snap.totals[field])) {
      throw new TypeError(`invalid team budget integer total: ${field}`);
    }
  }
  if (
    typeof snap.totals.started !== "boolean" ||
    typeof snap.totals.unpricedUsage !== "boolean" ||
    (snap.totals.startedAt !== null &&
      (!Number.isFinite(snap.totals.startedAt) || snap.totals.startedAt < 0))
  ) {
    throw new TypeError("invalid team budget wall-clock state");
  }
  if (
    (snap.totals.started && snap.totals.startedAt === null) ||
    (!snap.totals.started &&
      (snap.totals.startedAt !== null || snap.totals.elapsedMs !== 0))
  ) {
    throw new TypeError("inconsistent team budget wall-clock state");
  }
}

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
    this.unpricedUsage = false;
    this._reservations = new Map();
    this.reservedTokens = 0;
    this.reservedUsd = 0;
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
  record(
    {
      usage = null,
      usageRecords = null,
      provider,
      model,
      reservationId = null,
    } = {},
    now = this._now(),
  ) {
    this.start(now);
    if (reservationId) this.releaseReservation(reservationId);
    this.tasks += 1;
    if (usage) {
      this.tokens +=
        (Number(usage.input_tokens) || 0) +
        (Number(usage.output_tokens) || 0) +
        (Number(usage.cache_read_input_tokens) || 0) +
        (Number(usage.cache_creation_input_tokens) || 0);
      if (Array.isArray(usageRecords) && usageRecords.length > 0) {
        for (const record of usageRecords) {
          this._recordCost(record);
        }
      } else {
        this._recordCost({ provider, model, usage });
      }
    }
    return this;
  }

  _recordCost(record) {
    const estimate = this.cost.add(record);
    if (!this.cost.enabled()) return estimate;
    const value = record?.usage || {};
    const tokens =
      (Number(value.input_tokens) || 0) +
      (Number(value.output_tokens) || 0) +
      (Number(value.cache_read_input_tokens) || 0) +
      (Number(value.cache_creation_input_tokens) || 0);
    const price = Number(estimate?.totalCost);
    if (
      tokens > 0 &&
      estimate?.free !== true &&
      (estimate?.matched !== true || !Number.isFinite(price) || price < 0)
    ) {
      this.unpricedUsage = true;
    }
    return estimate;
  }

  /**
   * Reserve one fair slice of the remaining token/USD ceilings.
   *
   * `slots` is the number of claim slots sharing the current remainder. A
   * task-level cap can only tighten its slice. The returned limits are suitable
   * for passing directly to the child agent.
   */
  reserve(id, { maxTokens = null, maxUsd = null, slots = 1 } = {}) {
    const key = String(id || "");
    if (!key) throw new Error("team budget reservation id is required");
    const existing = this._reservations.get(key);
    if (existing) return { ok: true, ...existing, reused: true };

    const divisor =
      Number.isSafeInteger(slots) && slots > 0 ? Math.max(1, slots) : 1;
    const requestedTokens = pos(maxTokens);
    const requestedUsd = pos(maxUsd);
    let tokenSlice = requestedTokens;
    let usdSlice = requestedUsd;

    if (this.maxTokens != null) {
      const remaining = Math.max(
        0,
        Math.floor(this.maxTokens - this.tokens - this.reservedTokens),
      );
      if (remaining <= 0) {
        return {
          ok: false,
          reason: "max-tokens",
          temporary: this.reservedTokens > 0,
        };
      }
      const fair = Math.max(1, Math.ceil(remaining / divisor));
      tokenSlice =
        requestedTokens == null ? fair : Math.min(requestedTokens, fair);
    }

    if (this.cost.limitUsd != null) {
      const remaining = Math.max(
        0,
        this.cost.limitUsd - this.cost.spentUsd - this.reservedUsd,
      );
      if (remaining <= Number.EPSILON) {
        return {
          ok: false,
          reason: "max-usd",
          temporary: this.reservedUsd > 0,
        };
      }
      const fair = remaining / divisor;
      usdSlice = requestedUsd == null ? fair : Math.min(requestedUsd, fair);
    }

    const reservation = {
      id: key,
      maxTokens: tokenSlice,
      maxUsd: usdSlice,
      reservedTokens: this.maxTokens == null ? 0 : tokenSlice || 0,
      reservedUsd: this.cost.limitUsd == null ? 0 : usdSlice || 0,
    };
    this._reservations.set(key, reservation);
    this.reservedTokens += reservation.reservedTokens;
    this.reservedUsd += reservation.reservedUsd;
    return { ok: true, ...reservation, reused: false };
  }

  releaseReservation(id) {
    const key = String(id || "");
    const reservation = this._reservations.get(key);
    if (!reservation) return false;
    this._reservations.delete(key);
    this.reservedTokens = Math.max(
      0,
      this.reservedTokens - reservation.reservedTokens,
    );
    this.reservedUsd = Math.max(0, this.reservedUsd - reservation.reservedUsd);
    return true;
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
    if (this.cost.enabled() && this.unpricedUsage) {
      return "unpriced-usage";
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
      reservedTokens: this.reservedTokens,
      spentUsd: this.cost.spentUsd,
      maxUsd: this.cost.limitUsd,
      reservedUsd: this.reservedUsd,
      reservations: this._reservations.size,
      unpricedUsage: this.unpricedUsage,
      elapsedMs: this.startedAt == null ? 0 : now - this.startedAt,
      maxWallMs: this.maxWallMs,
      reason: this.reason(now),
    };
  }

  snapshot(now = this._now()) {
    const started = this.startedAt != null;
    const elapsedMs = started ? Math.max(0, now - this.startedAt) : 0;
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
        started,
        elapsedMs,
        unpricedUsage: this.unpricedUsage,
      },
    };
  }

  /**
   * Restore running totals + caps from a snapshot. A provided override can only
   * tighten a persisted cap; an omitted value keeps the prior cap so resume
   * cannot silently widen its resource authority.
   */
  static restore(snap, { now = () => Date.now(), table, overrides = {} } = {}) {
    assertBudgetSnapshot(snap);
    const pick = (override, stored) => {
      const next = pos(override);
      const prior = pos(stored);
      if (next == null) return prior;
      return prior == null ? next : Math.min(prior, next);
    };
    const b = new TeamBudget({
      maxTasks: pick(overrides.maxTasks, snap?.limits?.maxTasks),
      maxTokens: pick(overrides.maxTokens, snap?.limits?.maxTokens),
      maxUsd: pick(overrides.maxUsd, snap?.limits?.maxUsd),
      maxWallMs: pick(overrides.maxWallMs, snap?.limits?.maxWallMs),
      table,
      now,
    });
    b.tasks = snap.totals.tasks;
    b.tokens = snap.totals.tokens;
    // Preserve prior USD spend so the cap keeps counting across a resume.
    const spent = snap.totals.spentUsd;
    b.cost.spentUsd = spent;
    if (b.cost.spentUsd > 0) b.cost.priced = true;
    b.unpricedUsage = snap.totals.unpricedUsage;
    // Preserve active execution time without charging process downtime. This
    // prevents repeated resume from refreshing the team-wide wall-clock cap.
    const restoredAt = b._now();
    const elapsed = snap.totals.elapsedMs;
    const started = snap.totals.started;
    b.startedAt =
      started && Number.isFinite(elapsed) && elapsed >= 0
        ? restoredAt - elapsed
        : null;
    return b;
  }
}
