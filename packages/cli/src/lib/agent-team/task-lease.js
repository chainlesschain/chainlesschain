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

export const DEFAULT_LEASE_TTL_MS = 60000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export class TaskLeaseRegistry {
  constructor({
    groupId = null,
    now = () => Date.now(),
    defaultTtlMs = DEFAULT_LEASE_TTL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this.defaultTtlMs = defaultTtlMs > 0 ? defaultTtlMs : DEFAULT_LEASE_TTL_MS;
    this.maxAttempts = maxAttempts > 0 ? maxAttempts : DEFAULT_MAX_ATTEMPTS;
    this._tasks = new SharedTaskList({ groupId, now: this._now });
    this._byKey = new Map(); // stable user key → internal SharedTaskList id
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
    const created = this._tasks.add({
      title,
      priority,
      createdBy,
      metadata: {
        ...metadata,
        key: k,
        dependsOn: deps,
        lease: null,
        attempts: 0,
      },
    });
    this._byKey.set(k, created.id);
    return { ok: true, key: k, id: created.id };
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

  /**
   * Keys that could be leased right now: PENDING (or a task whose lease has
   * expired) with all dependencies COMPLETED and no currently-valid lease.
   */
  claimable({ now = this._now() } = {}) {
    const out = [];
    for (const t of this._tasks.list()) {
      const v = this._view(t);
      if (
        v.status === TASK_STATUS.COMPLETED ||
        v.status === TASK_STATUS.CANCELLED
      ) {
        continue;
      }
      if (this._leaseValid(v.lease, now)) continue; // held by a live teammate
      if (this.unmetDependencies(v.key).length > 0) continue; // blocked by deps
      out.push(v.key);
    }
    return out;
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
  acquire(key, { holder, ttlMs, now = this._now() } = {}) {
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
    if (this._leaseValid(existing, now) && existing.holder !== holder) {
      return {
        ok: false,
        reason: "leased",
        holder: existing.holder,
        expiresAt: existing.expiresAt,
      };
    }
    const ttl = ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const sameHolder = existing && existing.holder === holder;
    const lease = {
      holder,
      acquiredAt: sameHolder ? existing.acquiredAt : now,
      expiresAt: now + ttl,
      renewals: sameHolder ? (existing.renewals || 0) + 1 : 0,
      stolen: !!(existing && existing.holder !== holder),
    };
    return this._write(task, {
      status: TASK_STATUS.IN_PROGRESS,
      assignee: holder,
      metadata: { ...task.metadata, lease },
    })
      ? { ok: true, lease }
      : { ok: false, reason: "concurrent" };
  }

  /** Extend the lease you hold. Fails if you're not the current valid holder. */
  renew(key, { holder, ttlMs, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!this._leaseValid(lease, now) || lease.holder !== holder) {
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
  release(key, { holder, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!lease || lease.holder !== holder) {
      return { ok: false, reason: "not_holder" };
    }
    return this._write(task, {
      status: TASK_STATUS.PENDING,
      assignee: null,
      metadata: { ...task.metadata, lease: null },
    })
      ? { ok: true }
      : { ok: false, reason: "concurrent" };
  }

  /** Complete a task you hold the lease on → terminal COMPLETED. */
  complete(key, { holder, result = null, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    // Only the valid holder may complete — prevents a stale teammate (whose
    // lease already expired and was reassigned) from marking another's work done.
    if (!this._leaseValid(lease, now) || lease.holder !== holder) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    return this._write(task, {
      status: TASK_STATUS.COMPLETED,
      metadata: { ...task.metadata, lease: null, result },
    })
      ? { ok: true }
      : { ok: false, reason: "concurrent" };
  }

  /**
   * Report a failed attempt. Under the attempt cap the task returns to PENDING
   * (reclaimable for retry); at the cap it is CANCELLED (terminal) so the team
   * doesn't loop forever on a doomed task.
   * @returns {{ ok:boolean, retry?:boolean, attempts?:number, reason?:string }}
   */
  fail(key, { holder, error = null, now = this._now() } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!lease || lease.holder !== holder) {
      return { ok: false, reason: "not_holder" };
    }
    const attempts = (task.metadata?.attempts || 0) + 1;
    const willRetry = attempts < this.maxAttempts;
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
          reclaimed.push(fresh.metadata?.key);
        }
      }
    }
    return reclaimed;
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
    // Build adjacency from current tasks, then add the candidate.
    const adj = new Map();
    for (const t of this._tasks.list()) {
      adj.set(t.metadata?.key, t.metadata?.dependsOn || []);
    }
    adj.set(key, deps);
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map();
    const stack = [];
    let found = null;
    const visit = (node) => {
      color.set(node, GRAY);
      stack.push(node);
      for (const next of adj.get(node) || []) {
        if (!adj.has(next)) continue; // edge to a not-yet-added task: no cycle via it
        const c = color.get(next) || WHITE;
        if (c === GRAY) {
          found = [...stack.slice(stack.indexOf(next)), next];
          return true;
        }
        if (c === WHITE && visit(next)) return true;
      }
      stack.pop();
      color.set(node, BLACK);
      return false;
    };
    // Only need to start from the candidate — a new cycle must pass through it.
    if (visit(key)) return found;
    return null;
  }
}
