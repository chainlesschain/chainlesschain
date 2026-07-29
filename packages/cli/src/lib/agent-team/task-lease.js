/**
 * TaskLeaseRegistry (Phase 4 — Agent Team) — the two capabilities the existing
 * shared task list lacks, layered on top of it rather than reinventing it:
 *
 *   1. EXCLUSIVE LEASES WITH TTL. session-core's `SharedTaskList.claim()` is
 *      documented as "不互斥" (non-mutex) — it just stamps an assignee, so two
 *      teammates can claim the same task and duplicate the work. Here a task can
 *      be leased by AT MOST ONE holder at a time, the lease carries an expiry,
 *      and a crashed teammate's expired lease becomes reclaimable — satisfying
 *      the Phase 4 acceptance "多 Agent 不会重复处理已被有效 lease 的任务" and
 *      "teammate 崩溃后任务可回收并重新分配".
 *
 *   2. DEPENDENCY EDGES (a DAG). A task declares `dependsOn: [key,…]`; it is not
 *      claimable until every dependency is COMPLETED. Cycles are rejected at add
 *      time (a cyclic dep would deadlock — it could never become claimable).
 *
 * It COMPOSES a real `SharedTaskList` (optimistic-lock task store, status
 * vocabulary, snapshot/restore, terminal-state enforcement) — the lease + edges
 * live in each task's metadata, so persistence/recovery come for free. The clock
 * is injected (`now`) so lease expiry is fully deterministic in tests.
 *
 * This is the scheduling brain; the claim→execute handoff to a real agent
 * (SubAgentContext.run in a per-teammate worktree) is wired separately.
 */

import { SharedTaskList, TASK_STATUS } from "@chainlesschain/session-core";
import { randomUUID } from "node:crypto";

export const DEFAULT_LEASE_TTL_MS = 60000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export class TaskLeaseRegistry {
  constructor({
    groupId = null,
    now = () => Date.now(),
    defaultTtlMs = DEFAULT_LEASE_TTL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    leaseEpoch = randomUUID(),
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this.defaultTtlMs = defaultTtlMs > 0 ? defaultTtlMs : DEFAULT_LEASE_TTL_MS;
    this.maxAttempts = maxAttempts > 0 ? maxAttempts : DEFAULT_MAX_ATTEMPTS;
    this._leaseEpoch = String(leaseEpoch || randomUUID());
    this._leaseSequence = 0;
    this._tasks = new SharedTaskList({ groupId, now: this._now });
    this._byKey = new Map(); // stable user key → internal SharedTaskList id
    // Large-team scheduling indexes. The original implementation rebuilt and
    // scanned the full task graph for every claim, which turns a 5k-task run
    // into O(tasks² × teammates) work. Keep the dependency graph and ready
    // queues incrementally so the hot claim path only touches ready work.
    this._depsByKey = new Map();
    this._dependentsByKey = new Map();
    this._readyByPriority = new Map([
      ["high", new Set()],
      ["normal", new Set()],
      ["low", new Set()],
    ]);
    this._leasedKeys = new Set();
  }

  /**
   * Add a task to the graph. `key` is a stable, user-chosen identifier so
   * `dependsOn` can reference tasks regardless of insertion order. Rejects a
   * duplicate key or a dependency edge that would create a cycle.
   *
   * @returns {{ ok:boolean, key?:string, reason?:string, cycle?:string[] }}
   */
  addTask({
    key,
    title,
    dependsOn = [],
    priority = "normal",
    metadata = {},
    createdBy = null,
  } = {}) {
    const k = key || `t_${this._tasks.size() + 1}`;
    if (this._byKey.has(k)) {
      return { ok: false, reason: `duplicate task key "${k}"` };
    }
    if (!title || typeof title !== "string") {
      return { ok: false, reason: "title required" };
    }
    const deps = Array.isArray(dependsOn) ? dependsOn.filter(Boolean) : [];
    // Self-dependency and (once inserted) any back-edge that closes a cycle
    // would deadlock the task. Check against the edges already present PLUS the
    // proposed ones.
    const cycle = this._detectCycleIfAdded(k, deps);
    if (cycle) {
      return { ok: false, reason: "dependency cycle", cycle };
    }
    return this._insertTask({
      key: k,
      title,
      dependsOn: deps,
      priority,
      metadata,
      createdBy,
    });
  }

  /**
   * Atomically validate and add a whole graph in O(V + E). `loadRegistry`
   * uses this path for large plans so adding N tasks does not run N complete
   * graph traversals. No task is inserted when validation fails.
   */
  addTasks(definitions = []) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      return { ok: false, reason: "tasks required" };
    }
    const normalized = [];
    const seen = new Set(this._byKey.keys());
    for (const source of definitions) {
      const item = source && typeof source === "object" ? source : {};
      const key = item.key || `t_${this._tasks.size() + normalized.length + 1}`;
      if (seen.has(key)) {
        return { ok: false, reason: `duplicate task key "${key}"`, key };
      }
      if (!item.title || typeof item.title !== "string") {
        return { ok: false, reason: "title required", key };
      }
      seen.add(key);
      normalized.push({
        key,
        title: item.title,
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.filter(Boolean)
          : [],
        priority: item.priority || "normal",
        metadata: item.metadata || {},
        createdBy: item.createdBy ?? null,
      });
    }

    const adjacency = new Map(this._depsByKey);
    for (const item of normalized) {
      adjacency.set(item.key, item.dependsOn);
    }
    const cycle = this._findCycle(adjacency);
    if (cycle) {
      return { ok: false, reason: "dependency cycle", cycle };
    }

    const inserted = normalized.map((item) => this._insertTask(item));
    return {
      ok: true,
      keys: inserted.map((item) => item.key),
      ids: inserted.map((item) => item.id),
    };
  }

  _insertTask({
    key,
    title,
    dependsOn = [],
    priority = "normal",
    metadata = {},
    createdBy = null,
  }) {
    const created = this._tasks.add({
      title,
      priority,
      createdBy,
      metadata: {
        ...metadata,
        key,
        dependsOn,
        lease: null,
        attempts: 0,
      },
    });
    this._byKey.set(key, created.id);
    this._depsByKey.set(key, [...dependsOn]);
    if (!this._dependentsByKey.has(key)) {
      this._dependentsByKey.set(key, new Set());
    }
    for (const dependency of dependsOn) {
      let dependents = this._dependentsByKey.get(dependency);
      if (!dependents) {
        dependents = new Set();
        this._dependentsByKey.set(dependency, dependents);
      }
      dependents.add(key);
    }
    this._enqueueIfReady(key);
    return { ok: true, key, id: created.id };
  }

  /** Resolve a stable key → the current task object (or null). */
  getTask(key) {
    const id = this._byKey.get(key);
    if (!id) return null;
    const t = this._tasks.get(id);
    if (!t) return null;
    return this._view(t);
  }

  _view(t) {
    const lease = t.metadata?.lease || null;
    return {
      key: t.metadata?.key,
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dependsOn: t.metadata?.dependsOn || [],
      attempts: t.metadata?.attempts || 0,
      lease: lease ? { ...lease } : null,
      assignee: t.assignee,
      rev: t.rev,
      // Full metadata is exposed so executors can read user payload
      // (e.g. a task's shell `command` or agent `prompt`) — it carries the
      // internal lease/dependsOn/key too, which callers simply ignore.
      metadata: { ...t.metadata },
    };
  }

  list() {
    return this._tasks.list().map((t) => this._view(t));
  }

  _statusOf(key) {
    const id = this._byKey.get(key);
    const t = id ? this._tasks.get(id) : null;
    return t ? t.status : null;
  }

  /** Unmet (not-yet-completed) dependency keys for a task. */
  unmetDependencies(key) {
    const t = this.getTask(key);
    if (!t) return [];
    return t.dependsOn.filter(
      (d) => this._statusOf(d) !== TASK_STATUS.COMPLETED,
    );
  }

  _leaseValid(lease, now) {
    return !!(lease && lease.expiresAt > now);
  }

  _leaseOwned(lease, { holder, leaseId, now }) {
    return !!(
      this._leaseValid(lease, now) &&
      lease.holder === holder &&
      typeof leaseId === "string" &&
      leaseId.length > 0 &&
      lease.leaseId === leaseId
    );
  }

  _nextLeaseId() {
    this._leaseSequence += 1;
    return `${this._leaseEpoch}:${this._leaseSequence}`;
  }

  /**
   * Keys that could be leased right now: PENDING (or a task whose lease has
   * expired) with all dependencies COMPLETED and no currently-valid lease.
   */
  claimable({ now = this._now() } = {}) {
    this._requeueExpiredLeases(now);
    const out = [];
    for (const priority of ["high", "normal", "low"]) {
      for (const key of this._readyByPriority.get(priority)) {
        out.push(key);
      }
    }
    return out;
  }

  /** O(1) ready-frontier size for fair worker/budget reservation. */
  claimableCount({ now = this._now() } = {}) {
    this._requeueExpiredLeases(now);
    let count = 0;
    for (const queue of this._readyByPriority.values()) count += queue.size;
    return count;
  }

  /**
   * Return one ready key without materializing the whole ready set. The runner
   * acquires it immediately, which removes it from the queue synchronously.
   */
  nextClaimable({ now = this._now(), excludeKeys = null } = {}) {
    this._requeueExpiredLeases(now);
    const excluded =
      excludeKeys instanceof Set ? excludeKeys : new Set(excludeKeys || []);
    for (const priority of ["high", "normal", "low"]) {
      for (const key of this._readyByPriority.get(priority)) {
        if (!excluded.has(key)) return key;
      }
    }
    return null;
  }

  /**
   * Acquire (or renew, or steal an expired) exclusive lease.
   *   - blocked by unmet deps            → { ok:false, reason:"blocked_by_deps", unmet }
   *   - terminal task                    → { ok:false, reason:"terminal" }
   *   - validly leased by someone else   → { ok:false, reason:"leased", holder, expiresAt }
   *   - same holder                      → renew (extend expiry, bump renewals)
   *   - expired lease held by another    → steal (stolen:true)
   * @returns {{ ok:boolean, reason?:string, lease?:object, unmet?:string[], holder?:string, expiresAt?:number }}
   */
  acquire(key, { holder, leaseId = null, ttlMs, now = this._now() } = {}) {
    if (!holder) return { ok: false, reason: "holder required" };
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    if (
      task.status === TASK_STATUS.COMPLETED ||
      task.status === TASK_STATUS.CANCELLED
    ) {
      return { ok: false, reason: "terminal" };
    }
    const unmet = this.unmetDependencies(key);
    if (unmet.length > 0) {
      return { ok: false, reason: "blocked_by_deps", unmet };
    }
    const existing = task.metadata?.lease || null;
    const existingValid = this._leaseValid(existing, now);
    if (existingValid) {
      // Holder labels are intentionally human-readable and may be reused after
      // a restart. They are not authority. Only the unguessable leaseId fences
      // an older executor from renewing or settling a newer lease.
      if (!this._leaseOwned(existing, { holder, leaseId, now })) {
        return {
          ok: false,
          reason: "leased",
          holder: existing.holder,
          expiresAt: existing.expiresAt,
        };
      }
    }
    const ttl = ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const renewing = existingValid;
    const lease = {
      holder,
      leaseId: renewing ? existing.leaseId : this._nextLeaseId(),
      acquiredAt: renewing ? existing.acquiredAt : now,
      expiresAt: now + ttl,
      renewals: renewing ? (existing.renewals || 0) + 1 : 0,
      stolen: !renewing && !!existing,
    };
    const ok = this._write(task, {
      status: TASK_STATUS.IN_PROGRESS,
      assignee: holder,
      metadata: { ...task.metadata, lease },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._removeReady(key);
    this._leasedKeys.add(key);
    return { ok: true, lease };
  }

  /** Extend the lease you hold. Fails if you're not the current valid holder. */
  renew(key, { holder, leaseId, ttlMs, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!this._leaseOwned(lease, { holder, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    const ttl = ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const next = {
      ...lease,
      expiresAt: now + ttl,
      renewals: (lease.renewals || 0) + 1,
    };
    return this._write(task, { metadata: { ...task.metadata, lease: next } })
      ? { ok: true, lease: next }
      : { ok: false, reason: "concurrent" };
  }

  /** Voluntarily give up a lease — the task returns to PENDING for re-claim. */
  release(key, { holder, leaseId, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!this._leaseOwned(lease, { holder, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    const ok = this._write(task, {
      status: TASK_STATUS.PENDING,
      assignee: null,
      metadata: { ...task.metadata, lease: null },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._leasedKeys.delete(key);
    this._enqueueIfReady(key, now);
    return { ok: true };
  }

  /** Complete a task you hold the lease on → terminal COMPLETED. */
  complete(key, { holder, leaseId, result = null, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    // Only the valid holder may complete — prevents a stale teammate (whose
    // lease already expired and was reassigned) from marking another's work done.
    if (!this._leaseOwned(lease, { holder, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    const ok = this._write(task, {
      status: TASK_STATUS.COMPLETED,
      metadata: { ...task.metadata, lease: null, result },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._leasedKeys.delete(key);
    this._removeReady(key);
    for (const dependent of this._dependentsByKey.get(key) || []) {
      this._enqueueIfReady(dependent, now);
    }
    return { ok: true };
  }

  /**
   * Report a failed attempt. Under the attempt cap the task returns to PENDING
   * (reclaimable for retry); at the cap it is CANCELLED (terminal) so the team
   * doesn't loop forever on a doomed task.
   * @returns {{ ok:boolean, retry?:boolean, attempts?:number, reason?:string }}
   */
  fail(
    key,
    { holder, leaseId, error = null, retryable = true, now = this._now() } = {},
  ) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!this._leaseOwned(lease, { holder, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    const attempts = (task.metadata?.attempts || 0) + 1;
    const willRetry = retryable !== false && attempts < this.maxAttempts;
    const ok = this._write(task, {
      status: willRetry ? TASK_STATUS.PENDING : TASK_STATUS.CANCELLED,
      assignee: null,
      metadata: {
        ...task.metadata,
        lease: null,
        attempts,
        lastError: error ? String(error) : null,
      },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._leasedKeys.delete(key);
    this._removeReady(key);
    if (willRetry) this._enqueueIfReady(key, now);
    return { ok: true, retry: willRetry, attempts };
  }

  /**
   * Reclaim every task whose lease has EXPIRED (a crashed/lost teammate never
   * renewed) back to PENDING so it can be re-assigned. Returns the reclaimed
   * keys. This is the crash-recovery sweep.
   */
  reclaimExpired({ now = this._now() } = {}) {
    const reclaimed = [];
    for (const t of this._tasks.list()) {
      const lease = t.metadata?.lease || null;
      if (lease && !this._leaseValid(lease, now)) {
        const fresh = this._tasks.get(t.id); // re-read for current rev
        if (
          this._write(fresh, {
            status: TASK_STATUS.PENDING,
            assignee: null,
            metadata: { ...fresh.metadata, lease: null },
          })
        ) {
          this._leasedKeys.delete(fresh.metadata?.key);
          this._enqueueIfReady(fresh.metadata?.key, now);
          reclaimed.push(fresh.metadata?.key);
        }
      }
    }
    return reclaimed;
  }

  /**
   * Reclaim EVERY task that currently holds a lease back to PENDING, regardless
   * of expiry. Used on RESUME: a persisted snapshot comes from a prior process,
   * so every lease holder is by definition dead. `reclaimExpired` alone would
   * SKIP a lease still inside its TTL window (a crash seconds after acquiring) —
   * that task is then neither claimable (the "valid" lease blocks it) nor
   * reclaimed, so it strands forever and the run can never reach `allDone`.
   * Returns the reclaimed keys.
   */
  reclaimAll() {
    return this.reconcileAbandoned().reclaimed;
  }

  /**
   * Reconcile leases restored from a process that is known to be gone.
   *
   * A caller may opt individual tasks into retry. Everything else is cancelled
   * fail-closed so an unknown external side effect is not silently replayed.
   * The returned lists let the resume authority report which tasks need human
   * adjudication.
   */
  reconcileAbandoned({
    shouldRetry = () => true,
    error = "prior execution outcome requires adjudication",
  } = {}) {
    if (typeof shouldRetry !== "function") {
      throw new TypeError("shouldRetry must be a function");
    }
    const candidates = [];
    for (const t of this._tasks.list()) {
      const lease = t.metadata?.lease || null;
      if (!lease) continue;
      candidates.push({
        key: t.metadata?.key,
        retry: shouldRetry(t) === true,
      });
    }

    const reclaimed = [];
    const adjudicationRequired = [];
    for (const candidate of candidates) {
      const id = this._byKey.get(candidate.key);
      const fresh = id ? this._tasks.get(id) : null;
      if (!fresh?.metadata?.lease) continue;
      const metadata = {
        ...fresh.metadata,
        lease: null,
      };
      if (!candidate.retry) {
        metadata.attempts = (fresh.metadata?.attempts || 0) + 1;
        metadata.lastError = String(error);
      }
      if (
        this._write(fresh, {
          status: candidate.retry ? TASK_STATUS.PENDING : TASK_STATUS.CANCELLED,
          assignee: null,
          metadata,
        })
      ) {
        this._leasedKeys.delete(candidate.key);
        this._removeReady(candidate.key);
        if (candidate.retry) {
          this._enqueueIfReady(candidate.key);
          reclaimed.push(candidate.key);
        } else {
          adjudicationRequired.push(candidate.key);
        }
      }
    }
    return { reclaimed, adjudicationRequired };
  }

  stats({ now = this._now() } = {}) {
    const base = this._tasks.stats();
    let leased = 0;
    let expired = 0;
    for (const t of this._tasks.list()) {
      const lease = t.metadata?.lease || null;
      if (lease) {
        if (this._leaseValid(lease, now)) leased++;
        else expired++;
      }
    }
    return {
      ...base,
      leased,
      expiredLeases: expired,
      claimable: this.claimable({ now }).length,
    };
  }

  /** Whether the graph is fully done (all terminal). */
  allDone() {
    return this._tasks
      .list()
      .every(
        (t) =>
          t.status === TASK_STATUS.COMPLETED ||
          t.status === TASK_STATUS.CANCELLED,
      );
  }

  snapshot() {
    return {
      registry: {
        defaultTtlMs: this.defaultTtlMs,
        maxAttempts: this.maxAttempts,
        byKey: Array.from(this._byKey.entries()),
      },
      tasks: this._tasks.snapshot(),
    };
  }

  static restore(snapshot, { now = () => Date.now() } = {}) {
    const reg = new TaskLeaseRegistry({
      now,
      defaultTtlMs: snapshot?.registry?.defaultTtlMs,
      maxAttempts: snapshot?.registry?.maxAttempts,
    });
    reg._tasks = SharedTaskList.restore(snapshot.tasks, { now: reg._now });
    reg._byKey = new Map(snapshot?.registry?.byKey || []);
    reg._rebuildIndexes();
    return reg;
  }

  // --- internals -----------------------------------------------------------

  /** Optimistic write via the underlying list; false on rev conflict. */
  _write(task, patch) {
    try {
      this._tasks.update(task.id, {
        rev: task.rev,
        patch,
        actor: patch.assignee,
      });
      return true;
    } catch {
      // ConcurrencyError (rev changed under us) — caller re-reads and retries.
      return false;
    }
  }

  /**
   * Would adding edges `key → dependsOn[i]` create a cycle? Walks the existing
   * edge set augmented with the proposed edges. Returns the offending path or
   * null. A self-edge counts as a cycle.
   */
  _detectCycleIfAdded(key, deps) {
    const adj = new Map(this._depsByKey);
    adj.set(key, deps);
    return this._findCycle(adj, [key]);
  }

  _findCycle(adj, roots = null) {
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map();
    // Iterative DFS avoids overflowing the JS call stack on a legitimate deep
    // graph (for example a 10,000-task migration chain).
    for (const root of roots || adj.keys()) {
      if ((color.get(root) || WHITE) !== WHITE) continue;
      const path = [root];
      const frames = [
        {
          node: root,
          edges: adj.get(root) || [],
          index: 0,
        },
      ];
      color.set(root, GRAY);
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame.index >= frame.edges.length) {
          color.set(frame.node, BLACK);
          frames.pop();
          path.pop();
          continue;
        }
        const next = frame.edges[frame.index++];
        if (!adj.has(next)) continue;
        const state = color.get(next) || WHITE;
        if (state === GRAY) {
          return [...path.slice(path.indexOf(next)), next];
        }
        if (state === BLACK) continue;
        color.set(next, GRAY);
        path.push(next);
        frames.push({
          node: next,
          edges: adj.get(next) || [],
          index: 0,
        });
      }
    }
    return null;
  }

  _priorityFor(task) {
    return task?.priority === "high"
      ? "high"
      : task?.priority === "low"
        ? "low"
        : "normal";
  }

  _removeReady(key) {
    for (const queue of this._readyByPriority.values()) queue.delete(key);
  }

  _dependenciesCompleted(key) {
    for (const dependency of this._depsByKey.get(key) || []) {
      if (this._statusOf(dependency) !== TASK_STATUS.COMPLETED) return false;
    }
    return true;
  }

  _enqueueIfReady(key, now = this._now()) {
    if (!key) return false;
    const task = this.getTask(key);
    if (
      !task ||
      task.status === TASK_STATUS.COMPLETED ||
      task.status === TASK_STATUS.CANCELLED
    ) {
      this._removeReady(key);
      this._leasedKeys.delete(key);
      return false;
    }
    if (this._leaseValid(task.lease, now)) {
      this._removeReady(key);
      this._leasedKeys.add(key);
      return false;
    }
    if (!this._dependenciesCompleted(key)) {
      this._removeReady(key);
      return false;
    }
    this._leasedKeys.delete(key);
    this._readyByPriority.get(this._priorityFor(task)).add(key);
    return true;
  }

  _requeueExpiredLeases(now = this._now()) {
    for (const key of Array.from(this._leasedKeys)) {
      const task = this.getTask(key);
      if (!task || !this._leaseValid(task.lease, now)) {
        this._leasedKeys.delete(key);
        this._enqueueIfReady(key, now);
      }
    }
  }

  _rebuildIndexes() {
    this._depsByKey = new Map();
    this._dependentsByKey = new Map();
    this._readyByPriority = new Map([
      ["high", new Set()],
      ["normal", new Set()],
      ["low", new Set()],
    ]);
    this._leasedKeys = new Set();
    for (const task of this._tasks.list()) {
      const key = task.metadata?.key;
      const dependencies = task.metadata?.dependsOn || [];
      this._depsByKey.set(key, [...dependencies]);
      if (!this._dependentsByKey.has(key)) {
        this._dependentsByKey.set(key, new Set());
      }
      for (const dependency of dependencies) {
        let dependents = this._dependentsByKey.get(dependency);
        if (!dependents) {
          dependents = new Set();
          this._dependentsByKey.set(dependency, dependents);
        }
        dependents.add(key);
      }
    }
    const now = this._now();
    for (const key of this._byKey.keys()) this._enqueueIfReady(key, now);
  }
}
