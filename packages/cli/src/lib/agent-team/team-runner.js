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

import { emitHooksV2Event } from "../hooks-v2-producers.js";

function leaseFencingToken(lease) {
  return lease?.fencingToken ?? lease?.leaseId ?? null;
}

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
    // Lease-renewal heartbeat cadence while a task runs (default ttl/3).
    this.renewEveryMs = opts.renewEveryMs;
    this.onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
    this.emitHook =
      typeof opts.emitHook === "function" ? opts.emitHook : emitHooksV2Event;
    this.maxTasks = opts.maxTasks > 0 ? opts.maxTasks : 1000;
    this._now = opts.now || registry._now || (() => Date.now());
    // Team-wide token/USD/time/task budget (null → unbounded). Consulted before
    // every claim; folded after every settled task.
    this.budget = opts.budget || null;
    // Optional process/session-wide authority shared with non-team sub-agents,
    // tools and background work. TeamBudget remains the team-specific pricing
    // and reservation facade; this budget owns global concurrency + cascade.
    this.sessionBudget = opts.sessionBudget || null;
    this.budgetForTask =
      typeof opts.budgetForTask === "function" ? opts.budgetForTask : null;
    // Directed/broadcast messaging between teammates (null → disabled).
    this.mailbox = opts.mailbox || null;
    // Real agent children keep messages pending until their explicit ACK tool
    // succeeds. Legacy/dry-run executors retain drain-on-dispatch semantics.
    this.realtimeMessaging = opts.realtimeMessaging === true;
    // Optional conservative path ownership. Tasks with overlapping scopes are
    // serialized in a shared workspace; an empty scope means the whole repo.
    this.scopeLock = opts.scopeLock || null;
    this.scopeForTask =
      typeof opts.scopeForTask === "function"
        ? opts.scopeForTask
        : (task) => task?.metadata?.scopePaths || [];
    this.maxScopeScan =
      Number.isSafeInteger(opts.maxScopeScan) && opts.maxScopeScan > 0
        ? opts.maxScopeScan
        : 1024;
    // Optional TelemetryRecorder: emits a `team.task` span per execution (and
    // inherits the recorder's default workflow.run_id/name attributes) so
    // `cc team run --otlp` traces the whole graph. Null → zero cost.
    this.recorder = opts.recorder || null;
    // Durable state hooks. `beforeTask` runs after lease acquisition but before
    // the executor (so a claim can be persisted before side effects);
    // `afterTask` runs after the authoritative registry settlement.
    this.beforeTask =
      typeof opts.beforeTask === "function" ? opts.beforeTask : null;
    this.afterTask =
      typeof opts.afterTask === "function" ? opts.afterTask : null;
    // A lease that expires and is reacquired receives a new fencing identity.
    // Persist that identity synchronously before the executor can settle under
    // it. Ordinary renewals keep the same identity and do not call this hook.
    this.onLeaseChanged =
      typeof opts.onLeaseChanged === "function" ? opts.onLeaseChanged : null;
    this._executions = 0;
    this._reservedExecutions = 0;
    this._inFlight = 0;
    this._maxInFlight = 0;
    // Keys executing in this runner process. An event-loop stall may let a
    // short lease expire before its heartbeat callback runs; peer loops in the
    // same process must not steal and double-run that still-active task.
    this._activeKeys = new Set();
    this._members = new Map(); // holder → lifecycle record
    this._budgetStopped = false;
    this._registryBudgetReason = null;
    this._fatalError = null;
    // Idle workers wait on graph progress instead of polling the full graph
    // through setTimeout(0). This matters once a team has many workers but only
    // a narrow DAG frontier.
    this._progressWaiters = new Set();
    this._workerCount = 1;
    this._claimControllers = new Set();
    this._claimsByKey = new Map();
    this._wallTimer = null;
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
    const previousState = m.state;
    m.state = state;
    this._emit("teammate:state", { holder, state, ...extra });
    // Initial registration starts in `idle`; the hook is reserved for a real
    // transition back to idle after a teammate has participated in the run.
    if (state === "idle" && previousState !== null) {
      try {
        this.emitHook("TeammateIdle", {
          schema_version: 1,
          holder,
          state,
          previous_state: previousState,
          completed: m.completed,
          failed: m.failed,
          ...extra,
        });
      } catch {
        /* hook observer is best-effort */
      }
    }
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

  /** Snapshot of local in-flight claims for an IDE/operator control surface. */
  activeClaims() {
    return Array.from(this._claimsByKey.values()).map((claim) => ({
      key: claim.key,
      holder: claim.holder,
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      interrupted: !!claim.interruption,
      interruption: claim.interruption ? { ...claim.interruption } : null,
    }));
  }

  /**
   * Request human takeover of an executing task.
   *
   * Aborting the executor cannot prove whether an external side effect landed,
   * so the task always settles fail-closed into adjudication rather than being
   * silently retried. A durable control log supplies requestId/evidenceDigest
   * in production and must bind the exact active holder/lease/fencing identity;
   * keeping this method synchronous makes it safe to call from a file-control
   * watcher or an embedded IDE host.
   */
  interruptTask(
    key,
    {
      holder = null,
      leaseId = null,
      fencingToken = null,
      reason = "human takeover requested",
      actor = "human",
      requestId = null,
      evidenceDigest = null,
    } = {},
  ) {
    const claim = this._claimsByKey.get(key);
    if (!claim) return { ok: false, reason: "not_active" };
    if (
      holder !== claim.holder ||
      leaseId !== claim.leaseId ||
      fencingToken !== claim.fencingToken
    ) {
      return { ok: false, reason: "stale_attempt" };
    }
    if (claim.interruption) {
      if (
        requestId &&
        claim.interruption.requestId &&
        requestId !== claim.interruption.requestId
      ) {
        return { ok: false, reason: "already_interrupted" };
      }
      return {
        ok: true,
        idempotent: true,
        interruption: { ...claim.interruption },
      };
    }
    claim.interruption = {
      holder: claim.holder,
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      requestId: requestId || null,
      actor: actor ? String(actor) : "human",
      reason: String(reason || "human takeover requested"),
      evidenceDigest: evidenceDigest || null,
      requestedAt: this._now(),
    };
    const error = this._interruptionError(claim);
    try {
      claim.abortController.abort(error);
    } catch {
      /* settlement remains fenced by the task lease */
    }
    this._emit("task:interrupt-requested", {
      key,
      holder: claim.holder,
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      requestId: claim.interruption.requestId,
      actor: claim.interruption.actor,
      reason: claim.interruption.reason,
    });
    this._signalProgress();
    return { ok: true, interruption: { ...claim.interruption } };
  }

  /**
   * Fail the coordinator closed (for example when its durable control log is
   * corrupt or rolled back). Active executors are aborted and settle as
   * adjudication-required because their external outcome may be unknown.
   */
  abortRun(error, { requireAdjudication = true } = {}) {
    const failure =
      error instanceof Error ? error : new Error(String(error || "team abort"));
    if (requireAdjudication) {
      failure.retryable = false;
      failure.adjudication = {
        code: failure.code || "TEAM_RUN_ABORTED_ADJUDICATION_REQUIRED",
        reason: failure.message,
        evidenceDigest: null,
        requestedAt: this._now(),
      };
    }
    this._setFatal(failure, { phase: "external-control" });
    for (const claim of this._claimsByKey.values()) {
      claim.coordinatorAbort = failure;
      try {
        claim.abortController.abort(failure);
      } catch {
        /* settlement remains fenced by the task lease */
      }
    }
    return { ok: true, activeClaims: this._claimsByKey.size };
  }

  /**
   * Run the graph to completion (all tasks terminal) or until no teammate can
   * make progress (everything remaining is blocked/leased). Returns a summary.
   */
  async run() {
    if (typeof this.runTask !== "function") {
      throw new Error("TeamRunner: opts.runTask is required");
    }
    const initialScopeStatus = this.scopeLock?.status?.();
    if (initialScopeStatus?.count > 0) {
      const error = new Error(
        "TeamRunner cannot start with orphaned scope ownership",
      );
      error.code = "TEAM_SCOPE_LOCK_ORPHANED";
      throw error;
    }
    this._emit("run:start", {
      teammates: this.teammates,
      tasks: this.registry.list().length,
    });
    if (this.budget) {
      this.budget.start();
      const maxWallMs = Number(this.budget.maxWallMs);
      if (Number.isFinite(maxWallMs) && maxWallMs > 0) {
        const exhaustWallBudget = () => {
          if (!this._budgetStopped) {
            this._budgetStopped = true;
            this._emit("run:budget-exhausted", {
              reason: "max-wall-ms",
            });
          }
          for (const controller of this._claimControllers) {
            try {
              const error = new Error("Team wall-clock budget exhausted");
              error.code = "TEAM_WALL_BUDGET_EXHAUSTED";
              controller.abort(error);
            } catch {
              /* every settlement remains fenced by its lease id */
            }
          }
          this._signalProgress();
        };
        const armWallTimer = () => {
          const elapsedMs = this.budget.status().elapsedMs;
          const remainingMs = maxWallMs - elapsedMs;
          if (remainingMs <= 0) {
            exhaustWallBudget();
            return;
          }
          // Node timers are signed 32-bit. Re-arm long budgets instead of
          // truncating them, and charge only the active time restored from a
          // prior process (not the downtime between runs).
          this._wallTimer = setTimeout(
            armWallTimer,
            Math.min(remainingMs, 2_147_483_647),
          );
        };
        armWallTimer();
      }
    }
    this.sessionBudget?.start?.();
    const workers = [];
    const workerCount = Math.min(
      this.teammates,
      Math.max(1, this.registry.list().length),
    );
    this._workerCount = workerCount;
    const holders = Array.from(
      { length: workerCount },
      (_, index) => `teammate-${index + 1}`,
    );
    this.mailbox?.registerRecipients?.(holders);
    for (const holder of holders) {
      this._setState(holder, "idle");
      workers.push(this._worker(holder));
    }
    try {
      await Promise.all(workers);
    } finally {
      if (this._wallTimer) {
        clearTimeout(this._wallTimer);
        this._wallTimer = null;
      }
    }
    if (this._fatalError) throw this._fatalError;
    const stats = this.registry.stats();
    const done = this.registry.allDone();
    const summary = {
      done,
      success: done && stats.completed === stats.total,
      executions: this._executions,
      maxConcurrent: this._maxInFlight,
      requestedTeammates: this.teammates,
      activeTeammates: workerCount,
      budgetStopped: this._budgetStopped,
      budgetReason:
        this.budget?.reason?.() ||
        this.sessionBudget?.reason?.() ||
        this._registryBudgetReason,
      sessionBudgetStatus: this.sessionBudget?.status?.() || null,
      members: this.members(),
      messages: this.mailbox ? this.mailbox.size() : 0,
      mailboxStatus: this.mailbox?.status?.() || null,
      scopeOwnership: this.scopeLock?.status?.() || null,
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
      if (this._fatalError) {
        this._setState(holder, "shutdown", { reason: "fatal-error" });
        return;
      }
      const sessionStopReason = this._sessionBudgetStopReason();
      if (sessionStopReason) {
        const reason = sessionStopReason;
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", { reason });
        }
        this._setState(holder, "shutdown", { reason });
        return;
      }
      if (this._executions + this._reservedExecutions >= this.maxTasks) {
        this._emit("run:budget-exhausted", { maxTasks: this.maxTasks });
        this._setState(holder, "shutdown", { reason: "max-tasks" });
        return;
      }
      const budgetStatus = this.budget?.status?.();
      if (
        budgetStatus?.maxTasks != null &&
        Math.max(budgetStatus.tasks, this._executions) +
          this._reservedExecutions >=
          budgetStatus.maxTasks
      ) {
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", { reason: "max-tasks" });
        }
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
        const heldScopes = this.scopeLock?.status?.().count || 0;
        if (this._inFlight > 0 || this._reservedExecutions > 0) {
          this._setState(holder, "idle");
          await this._waitForProgress();
          continue;
        }
        if (heldScopes > 0) {
          const error = new Error(
            "TeamRunner found scope ownership without a live local claim",
          );
          error.code = "TEAM_SCOPE_LOCK_ORPHANED";
          this._setFatal(error, { phase: "scope-reconciliation" });
          this._setState(holder, "shutdown", { reason: "fatal-error" });
          return;
        }
        this._setState(holder, "shutdown", { reason: "no-more-work" });
        return; // no claimable + nothing in flight → this worker is finished
      }
      const acq = this.registry.acquire(key, { holder, ttlMs: this.ttlMs });
      if (!acq.ok) {
        if (
          ["max-tasks", "max-tokens", "max-usd", "max-wall-ms"].includes(
            acq.reason,
          )
        ) {
          this._budgetStopped = true;
          this._registryBudgetReason = acq.reason;
          this._emit("run:budget-exhausted", { reason: acq.reason });
          this._setState(holder, "shutdown", { reason: acq.reason });
          this._signalProgress();
          return;
        }
        // Lost the race to a peer (or it just got blocked) — try another.
        this._setState(holder, "idle");
        await this._tick();
        continue;
      }
      const budgetReservation = acq.budgetReservation
        ? { ok: true, ...acq.budgetReservation }
        : this._reserveTaskBudget(key, this.registry.getTask(key), acq.lease);
      if (!budgetReservation.ok) {
        this.registry.release(key, {
          holder,
          leaseId: acq.lease.leaseId,
        });
        if (budgetReservation.temporary) {
          this._setState(holder, "idle");
          await this._waitForProgress();
          continue;
        }
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", {
            reason: budgetReservation.reason,
          });
        }
        this._setState(holder, "shutdown", {
          reason: budgetReservation.reason,
        });
        return;
      }
      let sessionWork;
      try {
        sessionWork = this._reserveSessionWork(key, acq.lease);
      } catch (error) {
        this.registry.release(key, {
          holder,
          leaseId: acq.lease.leaseId,
        });
        if (budgetReservation.id) {
          this.budget?.releaseReservation?.(budgetReservation.id);
        }
        this._setFatal(error, {
          phase: "session-budget-acquire",
          key,
          holder,
        });
        this._setState(holder, "shutdown", { reason: "fatal-error" });
        return;
      }
      if (!sessionWork.ok) {
        this.registry.release(key, {
          holder,
          leaseId: acq.lease.leaseId,
        });
        if (budgetReservation.id) {
          this.budget?.releaseReservation?.(budgetReservation.id);
        }
        if (sessionWork.retryable) {
          this._setState(holder, "idle");
          // The occupied global slot may belong to a background task outside
          // this runner, so no TeamRunner progress event is guaranteed.
          await this._tick();
          continue;
        }
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", {
            reason: sessionWork.reason,
          });
        }
        this._setState(holder, "shutdown", {
          reason: sessionWork.reason,
        });
        return;
      }
      this._reservedExecutions++;
      let claim;
      try {
        claim = this._beginClaim(
          holder,
          key,
          acq.lease,
          budgetReservation,
          sessionWork,
        );
      } catch (error) {
        this._reservedExecutions = Math.max(0, this._reservedExecutions - 1);
        this.registry.release(key, {
          holder,
          leaseId: acq.lease.leaseId,
        });
        if (budgetReservation.id) {
          this.budget?.releaseReservation?.(budgetReservation.id);
        }
        this._setFatal(error, { phase: "session-budget-bind", key, holder });
        this._setState(holder, "shutdown", { reason: "fatal-error" });
        return;
      }
      if (!this._acquireScope(holder, key)) {
        this._abandonClaim(holder, key, claim);
        if (this._fatalError) {
          this._setState(holder, "shutdown", { reason: "fatal-error" });
          return;
        }
        this._setState(holder, "idle");
        await this._waitForProgress();
        continue;
      }
      if (!(await this._prepareTask(holder, key, claim))) {
        this._abandonClaim(holder, key, claim);
        return;
      }
      if (this._fatalError || claim.lost) {
        if (claim.lost && !this._fatalError) {
          const error = new Error(
            `Lease for task "${key}" was lost while preparing it`,
          );
          error.code = "TEAM_TASK_LEASE_LOST";
          this._setFatal(error, { phase: "before-task", key, holder });
        }
        this._abandonClaim(holder, key, claim);
        this._setState(holder, "shutdown", { reason: "fatal-error" });
        return;
      }
      // `beforeTask` may persist a durable claim slowly enough to cross the
      // wall-clock deadline. The timer's AbortSignal is advisory: this is the
      // last authoritative fence before handing control to the executor.
      // Preserve an explicit human interruption so `_execute` can settle it
      // fail-closed for adjudication instead of silently abandoning it.
      const preparedBudgetReason = this.budget?.reason?.();
      const preparedSessionReason = this._sessionBudgetStopReason();
      if (
        !claim.interruption &&
        !claim.coordinatorAbort &&
        (preparedBudgetReason === "max-wall-ms" || preparedSessionReason)
      ) {
        const reason = preparedSessionReason || preparedBudgetReason;
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", {
            reason,
          });
        }
        this._abandonClaim(holder, key, claim);
        this._setState(holder, "shutdown", {
          reason,
        });
        return;
      }
      await this._execute(holder, key, claim);
    }
  }

  async _prepareTask(holder, key, claim) {
    if (!this.beforeTask) return true;
    try {
      await this.beforeTask({
        key,
        task: this.registry.getTask(key),
        holder,
        lease: this.registry.getTask(key)?.lease || claim.lease,
      });
      return true;
    } catch (error) {
      this._setFatal(error, { phase: "before-task", key, holder });
      this._setState(holder, "shutdown", { reason: "fatal-error" });
      return false;
    }
  }

  _setFatal(error, extra = {}) {
    if (this._fatalError) return;
    const failure =
      error instanceof Error ? error : new Error(String(error || "team fatal"));
    this._fatalError = failure;
    this._emit("run:fatal", {
      ...extra,
      error: failure.message,
    });
    this._signalProgress();
  }

  _reserveTaskBudget(key, task, lease) {
    if (!this.budget?.reserve) return { ok: true, id: null };
    const requested = this.budgetForTask?.(task, key) || {};
    if (requested.reserveUsage === false) return { ok: true, id: null };
    const availableWorkers = Math.max(
      1,
      this._workerCount - this._inFlight - this._reservedExecutions,
    );
    const readyAfterAcquire =
      typeof this.registry.claimableCount === "function"
        ? this.registry.claimableCount()
        : availableWorkers - 1;
    const slots = Math.max(
      1,
      Math.min(availableWorkers, readyAfterAcquire + 1),
    );
    const reservation = this.budget.reserve(lease.leaseId, {
      maxTokens: requested.maxTokens,
      maxUsd: requested.maxBudgetUsd ?? requested.maxUsd,
      slots,
    });
    if (!reservation.ok) return reservation;
    return {
      ...reservation,
      maxBudgetUsd: reservation.maxUsd,
    };
  }

  _reserveSessionWork(key, lease) {
    if (!this.sessionBudget?.acquireWork) return { ok: true, release: null };
    return this.sessionBudget.acquireWork({
      id: `team-task:${lease?.leaseId || key}`,
      kind: "team-task",
      depth: 1,
    });
  }

  _beginClaim(
    holder,
    key,
    lease,
    budgetReservation = null,
    sessionWork = null,
  ) {
    const claim = {
      holder,
      key,
      lease,
      leaseId: lease?.leaseId,
      fencingToken: leaseFencingToken(lease),
      heartbeat: null,
      lost: false,
      abortController: new AbortController(),
      budgetReservation,
      budgetSettled: false,
      sessionWork,
      sessionBudgetSettled: false,
      sessionBudgetUsageHandledByExecutor: false,
      sessionBudgetUsageUnknown: false,
      sessionBudgetView: null,
      unregisterSessionAbortable: null,
      interruption: null,
      coordinatorAbort: null,
    };
    // Fence the task immediately after acquire, before any async durable hook.
    // Otherwise a slow beforeTask can outlive the TTL and a peer can run the
    // same side effect concurrently.
    this._activeKeys.add(key);
    this._claimControllers.add(claim.abortController);
    this._claimsByKey.set(key, claim);
    if (this.sessionBudget?.registerAbortable && sessionWork?.id) {
      try {
        claim.unregisterSessionAbortable = this.sessionBudget.registerAbortable(
          `team-claim:${sessionWork.id}`,
          (reason) => {
            if (!claim.abortController.signal.aborted) {
              claim.abortController.abort(reason);
            }
          },
        );
      } catch (error) {
        this._activeKeys.delete(key);
        this._claimControllers.delete(claim.abortController);
        this._claimsByKey.delete(key);
        try {
          sessionWork.release?.();
        } catch {
          // Preserve the registration failure as the authoritative cause. A
          // conforming SessionResourceBudget release is idempotent/nonthrowing.
        }
        throw error;
      }
    }
    const effectiveTtl =
      this.ttlMs > 0 ? this.ttlMs : this.registry.defaultTtlMs || 60000;
    const every = Math.max(
      25,
      Math.floor(this.renewEveryMs > 0 ? this.renewEveryMs : effectiveTtl / 3),
    );
    claim.heartbeat = setInterval(() => {
      const result = this._renewClaim(claim);
      if (!result?.ok) clearInterval(claim.heartbeat);
    }, every);
    if (typeof claim.heartbeat.unref === "function") claim.heartbeat.unref();
    return claim;
  }

  _applyRenewedLease(claim, lease) {
    const previousLease = claim.lease;
    const previousLeaseId = claim.leaseId;
    const previousFencingToken = claim.fencingToken;
    claim.lease = lease;
    claim.leaseId = lease?.leaseId;
    claim.fencingToken = leaseFencingToken(lease);
    const identityChanged =
      claim.leaseId !== previousLeaseId ||
      claim.fencingToken !== previousFencingToken;
    if (!identityChanged || !this.onLeaseChanged) {
      return { ok: true, identityChanged };
    }
    try {
      const callbackResult = this.onLeaseChanged({
        key: claim.key,
        holder: claim.holder,
        previousLease: previousLease ? { ...previousLease } : null,
        lease: lease ? { ...lease } : null,
        previousLeaseId,
        leaseId: claim.leaseId,
        previousFencingToken,
        fencingToken: claim.fencingToken,
      });
      if (
        callbackResult &&
        (typeof callbackResult === "object" ||
          typeof callbackResult === "function") &&
        typeof callbackResult.then === "function"
      ) {
        Promise.resolve(callbackResult).catch(() => {});
        throw new Error("onLeaseChanged must be synchronous");
      }
      return { ok: true, identityChanged: true };
    } catch (error) {
      const cause =
        error instanceof Error
          ? error
          : new Error(String(error || "lease identity persistence failed"));
      const failure = new Error(cause.message, { cause });
      failure.code = "TEAM_LEASE_CHANGE_PERSIST_FAILED";
      failure.retryable = false;
      failure.adjudication = failure.adjudication || {
        code: failure.code,
        reason: failure.message,
        evidenceDigest: null,
        requestedAt: this._now(),
        holder: claim.holder,
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
      };
      claim.coordinatorAbort = failure;
      this._setFatal(failure, {
        phase: "lease-change",
        key: claim.key,
        holder: claim.holder,
      });
      return {
        ok: false,
        reason: "lease_change_persist_failed",
        error: failure,
      };
    }
  }

  _renewClaim(claim) {
    if (!claim || claim.lost) {
      return { ok: false, reason: "lease_lost" };
    }
    let result;
    try {
      result = this.registry.renew(claim.key, {
        holder: claim.holder,
        leaseId: claim.leaseId,
        ttlMs: this.ttlMs,
      });
      // A delayed heartbeat may wake just after expiry. Reacquire creates a new
      // fencing token and succeeds only if no peer has taken the task.
      if (!result?.ok && result?.reason === "not_holder_or_expired") {
        result = this.registry.acquire(claim.key, {
          holder: claim.holder,
          ttlMs: this.ttlMs,
        });
        if (result?.ok) {
          const applied = this._applyRenewedLease(claim, result.lease);
          if (!applied.ok) result = applied;
        }
      } else if (result?.ok) {
        const applied = this._applyRenewedLease(claim, result.lease);
        if (!applied.ok) result = applied;
      }
    } catch {
      result = { ok: false, reason: "renew_failed" };
    }
    if (!result?.ok) {
      claim.lost = true;
      try {
        claim.abortController.abort(
          result?.error || new Error(`Lease for task "${claim.key}" was lost`),
        );
      } catch {
        /* the fencing token still prevents stale settlement */
      }
      this._signalProgress();
    }
    return result;
  }

  _endClaim(claim) {
    if (!claim) return;
    if (claim.heartbeat) clearInterval(claim.heartbeat);
    this._activeKeys.delete(claim.key);
    this._claimControllers.delete(claim.abortController);
    if (this._claimsByKey.get(claim.key) === claim) {
      this._claimsByKey.delete(claim.key);
    }
    try {
      claim.unregisterSessionAbortable?.();
    } catch {
      // The session budget may already have delivered and cleared the callback.
    }
    claim.unregisterSessionAbortable = null;
    try {
      claim.sessionWork?.release?.();
    } catch {
      // Session work leases are idempotent.
    }
    claim.sessionWork = null;
    claim.sessionBudgetView = null;
  }

  _sessionBudgetForClaim(claim) {
    if (!this.sessionBudget || !claim) return this.sessionBudget;
    if (claim.sessionBudgetView) return claim.sessionBudgetView;
    const authority = this.sessionBudget;
    const methods = new Map();
    claim.sessionBudgetView = new Proxy(authority, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (methods.has(property)) return methods.get(property);
        const method =
          property === "recordUsage" || property === "markUsageUnknown"
            ? (...args) => {
                const result = value.apply(target, args);
                // Usage charged through the inherited authority is already in
                // the global ledger. Remember that ownership so the task's
                // returned aggregate is not charged a second time. Unknown
                // usage must also prevent this task becoming a phantom success.
                claim.sessionBudgetUsageHandledByExecutor = true;
                if (property === "markUsageUnknown") {
                  claim.sessionBudgetUsageUnknown = true;
                }
                return result;
              }
            : value.bind(target);
        methods.set(property, method);
        return method;
      },
      set(target, property, value) {
        return Reflect.set(target, property, value, target);
      },
    });
    return claim.sessionBudgetView;
  }

  _sessionBudgetStopReason() {
    if (!this.sessionBudget) return null;
    const reason = this.sessionBudget.reason?.() || null;
    if (this.sessionBudget.signal?.aborted) {
      return reason || "session-aborted";
    }
    return reason === "recovery-required" ? reason : null;
  }

  _recordSessionUsage(claim, source) {
    if (!this.sessionBudget || claim.sessionBudgetSettled) return;
    claim.sessionBudgetSettled = true;
    if (claim.sessionBudgetUsageHandledByExecutor) return;
    if (
      !source?.usage &&
      (!Array.isArray(source?.usageRecords) || source.usageRecords.length === 0)
    ) {
      return;
    }
    this.sessionBudget.recordUsage({
      usage: source?.usage || null,
      usageRecords: source?.usageRecords || null,
      provider: source?.provider,
      model: source?.model,
    });
  }

  _sessionBudgetFailure(executionResult = null) {
    const sharedReason = this.sessionBudget?.signal?.reason;
    const budgetReason =
      sharedReason?.budgetReason ||
      this.sessionBudget?.reason?.() ||
      "session-aborted";
    // Never attach per-task usage to the shared AbortSignal reason: every
    // sibling observes that same Error object and would then re-record the
    // triggering task's usage as its own failure.
    const failure = new Error(
      sharedReason?.message ||
        `Session budget exhausted: ${this.sessionBudget?.reason?.() || "session-aborted"}`,
      sharedReason instanceof Error ? { cause: sharedReason } : undefined,
    );
    failure.code =
      sharedReason?.code ||
      (budgetReason === "recovery-required"
        ? "CC_SESSION_BUDGET_USAGE_UNKNOWN"
        : "ERR_SESSION_RESOURCE_BUDGET");
    failure.budgetReason = budgetReason;
    failure.retryable = false;
    if (executionResult && typeof executionResult === "object") {
      failure.usage = executionResult.usage || null;
      failure.usageRecords = executionResult.usageRecords || null;
      failure.provider = executionResult.provider;
      failure.model = executionResult.model;
    }
    return failure;
  }

  _interruptionError(claim, executionResult = null) {
    const interruption = claim?.interruption || {};
    const error = new Error(interruption.reason || "human takeover requested");
    error.code = "TEAM_TASK_HUMAN_INTERRUPTED";
    error.retryable = false;
    error.adjudication = {
      code: error.code,
      reason: error.message,
      evidenceDigest: interruption.evidenceDigest || null,
      requestedAt: interruption.requestedAt || this._now(),
      requestId: interruption.requestId || null,
      actor: interruption.actor || "human",
      holder: interruption.holder || claim?.holder || null,
      leaseId: interruption.leaseId || claim?.leaseId || null,
      fencingToken: interruption.fencingToken ?? claim?.fencingToken ?? null,
    };
    if (executionResult && typeof executionResult === "object") {
      error.usage = executionResult.usage || null;
      error.usageRecords = executionResult.usageRecords || null;
      error.provider = executionResult.provider;
      error.model = executionResult.model;
    }
    return error;
  }

  _abandonClaim(holder, key, claim) {
    this.registry.release(key, {
      holder,
      leaseId: claim?.leaseId,
    });
    this._releaseScope(holder, key);
    if (claim?.budgetReservation?.id) {
      this.budget?.releaseReservation?.(claim.budgetReservation.id);
    }
    this._endClaim(claim);
    this._reservedExecutions = Math.max(0, this._reservedExecutions - 1);
    this._signalProgress();
  }

  async _notifySettlement(settlement) {
    if (!this.afterTask) return;
    try {
      await this.afterTask(settlement);
    } catch (error) {
      this._setFatal(error, {
        phase: "after-task",
        key: settlement.key,
        holder: settlement.holder,
      });
    }
  }

  /** Pick a claimable task key for this holder (highest priority first). */
  _nextFor() {
    // A whole-workspace owner blocks every other scope, so avoid walking a
    // large ready queue only to rediscover the same conflict for each task.
    if (
      this.scopeLock
        ?.status?.()
        ?.locks?.some((candidate) => candidate.workspace === true)
    ) {
      return null;
    }
    if (typeof this.registry.nextClaimable === "function") {
      const excluded = new Set(this._activeKeys);
      for (let scanned = 0; scanned < this.maxScopeScan; scanned++) {
        const key = this.registry.nextClaimable({ excludeKeys: excluded });
        if (!key || !this.scopeLock) return key;
        const task = this.registry.getTask(key);
        const check = this.scopeLock.canAcquire(
          key,
          this.scopeForTask(task, key),
        );
        if (check.ok) return key;
        if (check.code !== "TEAM_SCOPE_LOCK_SCOPE_CONFLICT") {
          const error = new Error(
            check.message || `invalid task scope ownership for "${key}"`,
          );
          error.code = check.code || "TEAM_SCOPE_LOCK_INVALID_SCOPES";
          this._setFatal(error, { phase: "scope-validation", key });
          return null;
        }
        excluded.add(key);
      }
      return null;
    }
    const claimable = this.registry.claimable();
    if (claimable.length === 0) return null;
    // Stable: prefer higher priority, else insertion order (claimable order).
    const rank = { high: 0, normal: 1, low: 2 };
    let best = null;
    let bestScore = Infinity;
    for (const key of claimable) {
      if (this._activeKeys.has(key)) continue;
      const t = this.registry.getTask(key);
      const score = rank[t?.priority] ?? 1;
      if (score < bestScore) {
        bestScore = score;
        best = key;
      }
    }
    return best;
  }

  _acquireScope(holder, key) {
    if (!this.scopeLock) return true;
    const task = this.registry.getTask(key);
    const result = this.scopeLock.acquire(key, this.scopeForTask(task, key));
    if (!result.ok) {
      if (result.code !== "TEAM_SCOPE_LOCK_SCOPE_CONFLICT") {
        const error = new Error(
          result.message || `invalid task scope ownership for "${key}"`,
        );
        error.code = result.code || "TEAM_SCOPE_LOCK_INVALID_SCOPES";
        this._setFatal(error, {
          phase: "scope-acquire",
          key,
          holder,
        });
      }
      return false;
    }
    this._emit("task:scope-acquired", {
      key,
      holder,
      scopes: result.scopes,
      workspace: result.scopes.length === 0,
    });
    return true;
  }

  _releaseScope(holder, key) {
    if (!this.scopeLock) return;
    const released = this.scopeLock.release(key);
    if (released?.ok) {
      this._emit("task:scope-released", {
        key,
        holder,
        scopes: released.scopes,
        workspace: released.workspace,
      });
    }
  }

  async _execute(holder, key, claim) {
    const task = this.registry.getTask(key);
    this._reservedExecutions--;
    this._executions++;
    this._inFlight++;
    this._maxInFlight = Math.max(this._maxInFlight, this._inFlight);
    this._setState(holder, "running", { key });
    this._emit("task:claimed", { key, holder, attempts: task.attempts });
    const renew = () => this._renewClaim(claim);
    // A teammate-scoped messaging handle: post to a peer / broadcast, and read
    // its own inbox (direct messages + unseen broadcasts).
    const inbox = this.mailbox
      ? this.realtimeMessaging
        ? this.mailbox.peek(holder)
        : this.mailbox.drain(holder)
      : [];
    const messageAuthority = () => {
      const current = this._claimsByKey.get(key);
      if (
        current !== claim ||
        claim.lost ||
        claim.interruption ||
        claim.coordinatorAbort ||
        claim.abortController.signal.aborted
      ) {
        const error = new Error(
          `Team message authority for task "${key}" is no longer active`,
        );
        error.code = "TEAM_MESSAGE_BRIDGE_STALE_ATTEMPT";
        throw error;
      }
      return {
        holder,
        taskKey: key,
        attempt: task.attempts,
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
      };
    };
    const recipientState = (recipient) => {
      const member = this._members.get(recipient);
      return member ? { ...member } : null;
    };
    const sendMessage = (to, body, subject = null, options = {}) => {
      if (!this.mailbox) return null;
      let message;
      try {
        const authority = messageAuthority();
        message = this.mailbox.send({
          from: holder,
          to,
          subject,
          body,
          mode: options.mode,
          idempotencyKey: options.idempotencyKey,
          causationId: options.causationId,
          correlationId: options.correlationId,
          senderAttempt: authority,
        });
      } catch (error) {
        this._emit("mailbox:backpressure", {
          holder,
          code: error?.code || "TEAM_MAILBOX_SEND_FAILED",
          status: this.mailbox.status?.() || null,
        });
        throw error;
      }
      const pressure = this.mailbox.pressure?.();
      if (pressure && pressure.level !== "normal") {
        this._emit("mailbox:pressure", {
          holder,
          level: pressure.level,
          ratio: pressure.ratio,
          messages: this.mailbox.size(),
        });
      }
      this._emit("mailbox:message-sent", {
        holder,
        key,
        messageId: message.id,
        to: message.to,
        mode: message.mode || "send",
      });
      return message;
    };
    const startedAt = this._now();
    const span = this.recorder
      ? this.recorder.startSpan("team.task", {
          "team.task.key": key,
          "team.holder": holder,
          "team.attempts": task.attempts,
        })
      : null;
    try {
      if (claim.interruption) {
        throw this._interruptionError(claim);
      }
      if (claim.coordinatorAbort) {
        throw claim.coordinatorAbort;
      }
      // Synchronous observers above (`onEvent`, mailbox, tracing) may abort the
      // shared authority after the worker's post-beforeTask check. This is the
      // final fail-closed fence immediately before executor side effects.
      if (this._sessionBudgetStopReason()) {
        throw this._sessionBudgetFailure();
      }
      const result = await this.runTask({
        key,
        task,
        holder,
        renew,
        inbox,
        sendMessage,
        messageAuthority,
        recipientState,
        mailbox: this.mailbox,
        budget: this.budget,
        budgetReservation: claim.budgetReservation,
        sessionBudget: this._sessionBudgetForClaim(claim),
        signal: claim.abortController.signal,
      });
      // The executor may ignore AbortSignal or finish concurrently with an IDE
      // takeover request. Never turn that race into an automatic success:
      // preserve usage, then fail closed for explicit adjudication.
      if (claim.interruption) {
        throw this._interruptionError(claim, result);
      }
      if (claim.coordinatorAbort) {
        throw claim.coordinatorAbort;
      }
      this._recordSessionUsage(claim, result);
      if (
        claim.sessionBudgetUsageUnknown ||
        this.sessionBudget?.signal?.aborted
      ) {
        throw this._sessionBudgetFailure(result);
      }
      // Executors are allowed to return after observing (or even ignoring) an
      // aborted signal. Re-read the authoritative budget before recording or
      // completing so a late result can never become a phantom success.
      if (
        this.budget?.reason?.() === "max-wall-ms" ||
        claim.abortController.signal.reason?.code ===
          "TEAM_WALL_BUDGET_EXHAUSTED"
      ) {
        if (!this._budgetStopped) {
          this._budgetStopped = true;
          this._emit("run:budget-exhausted", {
            reason: "max-wall-ms",
          });
        }
        const error = new Error("Team wall-clock budget exhausted");
        error.code = "TEAM_WALL_BUDGET_EXHAUSTED";
        throw error;
      }
      // Fold usage/cost into the team budget regardless — the task DID execute
      // and consumed resources. `--exec` shell tasks carry no usage → only the
      // task-count / wall-clock dimensions move.
      if (this.budget) {
        this.budget.record(
          {
            usage: result?.usage || null,
            usageRecords: result?.usageRecords || null,
            provider: result?.provider,
            model: result?.model,
            reservationId: claim.budgetReservation?.id,
          },
          this._now(),
        );
        claim.budgetSettled = true;
        if (this.budget.reason() === "unpriced-usage") {
          const error = new Error(
            "Team USD budget cannot account for unpriced remote usage",
          );
          error.code = "TEAM_BUDGET_UNPRICED_USAGE";
          error.retryable = false;
          throw error;
        }
      }
      const done = this.registry.complete(key, {
        holder,
        leaseId: claim.leaseId,
        result,
      });
      if (done.ok) {
        if (span) span.end();
        this._setState(holder, "completed-task");
        this._emit("task:completed", {
          key,
          holder,
          ms: this._now() - startedAt,
        });
        await this._notifySettlement({
          key,
          holder,
          status: "completed",
          result,
        });
      } else {
        if (span) {
          span.setAttribute("team.completion_discarded", true);
          span.end();
        }
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
        await this._notifySettlement({
          key,
          holder,
          status: "completion-discarded",
          reason: done.reason,
        });
      }
    } catch (err) {
      const failure = claim.coordinatorAbort || err;
      if (span) {
        span.recordException(failure, "task_failure");
        span.end({ status: "error" });
      }
      // A failed task still consumed a task-count slot (and any wall-clock) — fold
      // it so a doomed retry loop can't dodge the budget.
      if (this.budget && !claim.budgetSettled) {
        this.budget.record(
          {
            usage: failure?.usage || null,
            usageRecords: failure?.usageRecords || null,
            provider: failure?.provider,
            model: failure?.model,
            reservationId: claim.budgetReservation?.id,
          },
          this._now(),
        );
        claim.budgetSettled = true;
      }
      this._recordSessionUsage(claim, failure);
      const outcome = this.registry.fail(key, {
        holder,
        leaseId: claim.leaseId,
        error: failure?.message || String(failure),
        retryable: failure?.retryable !== false,
        adjudication: failure?.adjudication || null,
      });
      if (outcome?.ok) {
        this._setState(holder, "failed-task", {
          error: failure?.message || String(failure),
        });
        this._emit("task:failed", {
          key,
          holder,
          error: failure?.message || String(failure),
          retry: outcome.retry === true,
          attempts: outcome.attempts,
          interrupted: failure?.code === "TEAM_TASK_HUMAN_INTERRUPTED",
          requestId: failure?.adjudication?.requestId || null,
        });
        await this._notifySettlement({
          key,
          holder,
          status: outcome.retry === true ? "pending" : "failed",
          error: failure?.message || String(failure),
          retry: outcome.retry === true,
          attempts: outcome.attempts,
          interrupted: failure?.code === "TEAM_TASK_HUMAN_INTERRUPTED",
          requestId: failure?.adjudication?.requestId || null,
        });
      } else {
        this._emit("task:failure-discarded", {
          key,
          holder,
          reason: outcome?.reason || "lease_lost",
          error: failure?.message || String(failure),
          ms: this._now() - startedAt,
        });
        await this._notifySettlement({
          key,
          holder,
          status: "failure-discarded",
          reason: outcome?.reason || "lease_lost",
        });
      }
    } finally {
      if (!claim.budgetSettled && claim.budgetReservation?.id) {
        this.budget?.releaseReservation?.(claim.budgetReservation.id);
      }
      this._releaseScope(holder, key);
      this._endClaim(claim);
      this._inFlight--;
      this._signalProgress();
    }
  }

  _waitForProgress() {
    return new Promise((resolve) => this._progressWaiters.add(resolve));
  }

  _signalProgress() {
    if (this._progressWaiters.size === 0) return;
    const waiters = Array.from(this._progressWaiters);
    this._progressWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  /** Yield to the event loop so peer completions land before re-checking. */
  _tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}
