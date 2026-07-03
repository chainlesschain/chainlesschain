/**
 * TeamRunner (Phase 4 — Agent Team) — drives a TaskLeaseRegistry with N
 * concurrent teammates, each looping: pick a claimable task → acquire its
 * EXCLUSIVE lease → run it → complete (or fail → retry/cancel). The registry's
 * lease + dependency DAG guarantees the two things a plain worker pool can't:
 *   - a task is run by AT MOST ONE teammate at a time (exclusive lease), so no
 *     duplicate work even with M teammates racing for the same task;
 *   - a task only starts once its dependencies are COMPLETED (DAG gating), and a
 *     task whose dependency was CANCELLED never runs (stays blocked).
 *
 * `runTask` is injected so the whole orchestration is unit-testable offline; in
 * production it's wired to a real agent turn (SubAgentContext.run in a
 * per-teammate worktree). Events are emitted for a machine-readable stream /
 * status panel. A total-time / total-task budget bounds a runaway graph.
 */

export class TeamRunner {
  /**
   * @param {TaskLeaseRegistry} registry
   * @param {object} opts
   *   runTask   async ({key, task, holder, renew}) => any   (throw = task failed)
   *   teammates number of concurrent workers (default 2)
   *   ttlMs     lease TTL per acquisition
   *   onEvent   (evt) => void   {type, ...}
   *   maxTasks  safety cap on total task executions (default 1000)
   *   now       () => ms  (for deadline math; defaults to registry clock)
   */
  constructor(registry, opts = {}) {
    this.registry = registry;
    this.runTask = opts.runTask;
    this.teammates = opts.teammates > 0 ? Math.floor(opts.teammates) : 2;
    this.ttlMs = opts.ttlMs;
    this.onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
    this.maxTasks = opts.maxTasks > 0 ? opts.maxTasks : 1000;
    this._now = opts.now || registry._now || (() => Date.now());
    this._executions = 0;
    this._inFlight = 0;
    this._maxInFlight = 0;
  }

  _emit(type, extra) {
    try {
      this.onEvent({ type, ts: this._now(), ...extra });
    } catch {
      /* event sink is best-effort */
    }
  }

  /**
   * Run the graph to completion (all tasks terminal) or until no teammate can
   * make progress (everything remaining is blocked/leased). Returns a summary.
   */
  async run() {
    if (typeof this.runTask !== "function") {
      throw new Error("TeamRunner: opts.runTask is required");
    }
    this._emit("run:start", {
      teammates: this.teammates,
      tasks: this.registry.list().length,
    });
    const workers = [];
    for (let i = 0; i < this.teammates; i++) {
      workers.push(this._worker(`teammate-${i + 1}`));
    }
    await Promise.all(workers);
    const stats = this.registry.stats();
    const summary = {
      done: this.registry.allDone(),
      executions: this._executions,
      maxConcurrent: this._maxInFlight,
      stats,
    };
    this._emit("run:end", summary);
    return summary;
  }

  async _worker(holder) {
    // Each teammate keeps taking claimable work until none is left FOR IT. A
    // task blocked only by a peer's in-flight lease will free up (complete) or
    // its dep will finish — so a worker that finds nothing claimable yields and
    // re-checks while any work is still in flight.
    for (;;) {
      if (this._executions >= this.maxTasks) {
        this._emit("run:budget-exhausted", { maxTasks: this.maxTasks });
        return;
      }
      const key = this._nextFor(holder);
      if (!key) {
        // Nothing to claim right now. If peers are still working, wait and
        // retry (their completions may unblock a dependent). Otherwise we're done.
        if (this._inFlight > 0) {
          await this._tick();
          continue;
        }
        return; // no claimable + nothing in flight → this worker is finished
      }
      const acq = this.registry.acquire(key, { holder, ttlMs: this.ttlMs });
      if (!acq.ok) {
        // Lost the race to a peer (or it just got blocked) — try another.
        await this._tick();
        continue;
      }
      await this._execute(holder, key, acq.lease);
    }
  }

  /** Pick a claimable task key for this holder (highest priority first). */
  _nextFor() {
    const claimable = this.registry.claimable();
    if (claimable.length === 0) return null;
    // Stable: prefer higher priority, else insertion order (claimable order).
    const rank = { high: 0, normal: 1, low: 2 };
    let best = null;
    let bestScore = Infinity;
    for (const key of claimable) {
      const t = this.registry.getTask(key);
      const score = rank[t?.priority] ?? 1;
      if (score < bestScore) {
        bestScore = score;
        best = key;
      }
    }
    return best;
  }

  async _execute(holder, key, lease) {
    const task = this.registry.getTask(key);
    this._executions++;
    this._inFlight++;
    this._maxInFlight = Math.max(this._maxInFlight, this._inFlight);
    this._emit("task:claimed", { key, holder, attempts: task.attempts });
    const renew = () => this.registry.renew(key, { holder, ttlMs: this.ttlMs });
    try {
      const result = await this.runTask({ key, task, holder, renew });
      this.registry.complete(key, { holder, result });
      this._emit("task:completed", { key, holder });
    } catch (err) {
      const outcome = this.registry.fail(key, {
        holder,
        error: err?.message || String(err),
      });
      this._emit("task:failed", {
        key,
        holder,
        error: err?.message || String(err),
        retry: outcome?.retry === true,
        attempts: outcome?.attempts,
      });
    } finally {
      this._inFlight--;
    }
  }

  /** Yield to the event loop so peer completions land before re-checking. */
  _tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}
