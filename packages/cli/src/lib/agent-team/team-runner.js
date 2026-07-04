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
    // Team-wide token/USD/time/task budget (null → unbounded). Consulted before
    // every claim; folded after every settled task.
    this.budget = opts.budget || null;
    // Directed/broadcast messaging between teammates (null → disabled).
    this.mailbox = opts.mailbox || null;
    this._executions = 0;
    this._inFlight = 0;
    this._maxInFlight = 0;
    this._members = new Map(); // holder → lifecycle record
    this._budgetStopped = false;
  }

  _emit(type, extra) {
    try {
      this.onEvent({ type, ts: this._now(), ...extra });
    } catch {
      /* event sink is best-effort */
    }
  }

  /**
   * Track a teammate's lifecycle state (idle / running / failed / shutdown) and
   * emit a `teammate:state` event on every transition. `lost` is set on resume
   * by the caller for a teammate whose lease was reclaimed after a crash.
   */
  _setState(holder, state, extra = {}) {
    let m = this._members.get(holder);
    if (!m) {
      m = { holder, state: null, completed: 0, failed: 0, lastError: null };
      this._members.set(holder, m);
    }
    if (state === "completed-task") {
      m.completed += 1;
      return m;
    }
    if (state === "failed-task") {
      m.failed += 1;
      m.lastError = extra.error || null;
      return m;
    }
    if (m.state === state) return m; // no transition
    m.state = state;
    this._emit("teammate:state", { holder, state, ...extra });
    return m;
  }

  /** Snapshot of every teammate's lifecycle (for a status panel / resume). */
  members() {
    return Array.from(this._members.values()).map((m) => ({ ...m }));
  }

  /** Restore prior-run member records (e.g. before a --resume run). */
  seedMembers(records = []) {
    for (const r of records) {
      if (r && r.holder) this._members.set(r.holder, { ...r });
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
    if (this.budget) this.budget.start();
    const workers = [];
    for (let i = 0; i < this.teammates; i++) {
      const holder = `teammate-${i + 1}`;
      this._setState(holder, "idle");
      workers.push(this._worker(holder));
    }
    await Promise.all(workers);
    const stats = this.registry.stats();
    const summary = {
      done: this.registry.allDone(),
      executions: this._executions,
      maxConcurrent: this._maxInFlight,
      budgetStopped: this._budgetStopped,
      budgetReason: this.budget ? this.budget.reason() : null,
      members: this.members(),
      messages: this.mailbox ? this.mailbox.size() : 0,
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
        this._setState(holder, "shutdown", { reason: "max-tasks" });
        return;
      }
      // Team budget (token/USD/time/task) — stop CLAIMING once any cap is hit so
      // the team overshoots by at most the tasks already in flight.
      if (this.budget && this.budget.shouldStop()) {
        const reason = this.budget.reason();
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", { reason });
        }
        this._setState(holder, "shutdown", { reason });
        return;
      }
      const key = this._nextFor(holder);
      if (!key) {
        // Nothing to claim right now. If peers are still working, wait and
        // retry (their completions may unblock a dependent). Otherwise we're done.
        if (this._inFlight > 0) {
          this._setState(holder, "idle");
          await this._tick();
          continue;
        }
        this._setState(holder, "shutdown", { reason: "no-more-work" });
        return; // no claimable + nothing in flight → this worker is finished
      }
      const acq = this.registry.acquire(key, { holder, ttlMs: this.ttlMs });
      if (!acq.ok) {
        // Lost the race to a peer (or it just got blocked) — try another.
        this._setState(holder, "idle");
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
    this._setState(holder, "running", { key });
    this._emit("task:claimed", { key, holder, attempts: task.attempts });
    const renew = () => this.registry.renew(key, { holder, ttlMs: this.ttlMs });
    // A teammate-scoped messaging handle: post to a peer / broadcast, and read
    // its own inbox (direct messages + unseen broadcasts).
    const inbox = this.mailbox ? this.mailbox.drain(holder) : [];
    const sendMessage = (to, body, subject = null) =>
      this.mailbox
        ? this.mailbox.send({ from: holder, to, subject, body })
        : null;
    const startedAt = this._now();
    try {
      const result = await this.runTask({
        key,
        task,
        holder,
        renew,
        inbox,
        sendMessage,
        mailbox: this.mailbox,
        budget: this.budget,
      });
      const done = this.registry.complete(key, { holder, result });
      // Fold usage/cost into the team budget regardless — the task DID execute
      // and consumed resources. `--exec` shell tasks carry no usage → only the
      // task-count / wall-clock dimensions move.
      if (this.budget) {
        this.budget.record(
          {
            usage: result?.usage || null,
            provider: result?.provider,
            model: result?.model,
          },
          this._now(),
        );
      }
      if (done.ok) {
        this._setState(holder, "completed-task");
        this._emit("task:completed", {
          key,
          holder,
          ms: this._now() - startedAt,
        });
      } else {
        // The registry REJECTED the completion — the lease expired mid-run (the
        // task outran its TTL without renewing), so a peer may already own it.
        // Reporting `task:completed` + bumping the completed counter here would
        // be a phantom success (the registry has no record of it, and the task
        // will be reclaimed and re-run). Surface the discard honestly instead so
        // the event stream and per-teammate stats stay truthful.
        this._emit("task:completion-discarded", {
          key,
          holder,
          reason: done.reason,
          ms: this._now() - startedAt,
        });
      }
    } catch (err) {
      // A failed task still consumed a task-count slot (and any wall-clock) — fold
      // it so a doomed retry loop can't dodge the budget.
      if (this.budget) this.budget.record({ usage: null }, this._now());
      const outcome = this.registry.fail(key, {
        holder,
        error: err?.message || String(err),
      });
      this._setState(holder, "failed-task", {
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
