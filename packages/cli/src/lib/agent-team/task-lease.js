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
import { createHash, randomUUID } from "node:crypto";

export const DEFAULT_LEASE_TTL_MS = 60000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_QUEUE_WAIT_SLO_MS = 10_000;
export const DEFAULT_AGING_WINDOW_MS = 2_500;
export const ADJUDICATION_DECISIONS = Object.freeze({
  RETRY: "retry",
  ACCEPT: "accept",
  CANCEL: "cancel",
});

export const TEAM_CUSTODY_HANDOFF_SCHEMA =
  "chainlesschain.team-custody-handoff/v1";
export const TEAM_CUSTODY_HANDOFF_STATUSES = Object.freeze([
  "offered",
  "accepted",
  "rejected",
  "committed",
  "revoked",
  "expired",
]);
export const DEFAULT_HANDOFF_TTL_MS = 5 * 60 * 1000;
export const MAX_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_HANDOFF_HISTORY = 64;

const HANDOFF_ACTIVE_STATUSES = new Set(["offered", "accepted"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_HANDOFF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digestValue(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")}`;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function handoffHistory(task) {
  return Array.isArray(task?.metadata?.custodyHandoffs)
    ? task.metadata.custodyHandoffs.map((handoff) => cloneValue(handoff))
    : [];
}

function currentCommittedHandoff(task) {
  return [...handoffHistory(task)]
    .reverse()
    .find((handoff) => handoff?.status === "committed");
}

function settleHandoffHistory(task, holder, leaseId, settlement, now) {
  const history = handoffHistory(task);
  const handoff = [...history]
    .reverse()
    .find(
      (entry) =>
        entry?.status === "committed" &&
        entry.toHolder === holder &&
        entry.targetLease?.leaseId === leaseId,
    );
  if (!handoff || handoff.targetSettledAt != null) return null;
  handoff.targetSettledAt = now;
  handoff.targetSettlement = String(settlement || "unknown").slice(0, 128);
  handoff.updatedAt = now;
  return history;
}

function refreshHandoffTargetLease(task, lease, now) {
  if (!lease?.handoffId) return null;
  const history = handoffHistory(task);
  const handoff = [...history]
    .reverse()
    .find(
      (entry) =>
        entry?.id === lease.handoffId &&
        entry.status === "committed" &&
        entry.toHolder === lease.holder &&
        entry.targetSettledAt == null,
    );
  if (!handoff) return null;
  handoff.targetLease = cloneValue(lease);
  handoff.targetLeaseRefreshedAt = now;
  handoff.updatedAt = now;
  return history;
}

function normalizedHandoffId(value, createId = randomUUID) {
  const id = value == null ? createId() : String(value).trim();
  return SAFE_HANDOFF_ID_PATTERN.test(id) ? id : null;
}

function normalizedHolder(value) {
  const holder = String(value || "").trim();
  return SAFE_HANDOFF_ID_PATTERN.test(holder) ? holder : null;
}

function normalizedDigest(value) {
  const digest = String(value || "").trim();
  return SHA256_PATTERN.test(digest) ? digest : null;
}

function normalizedArtifactIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 64) return null;
  const ids = value.map((entry) => String(entry || "").trim());
  if (
    ids.some((id) => !SAFE_HANDOFF_ID_PATTERN.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return null;
  }
  return ids;
}

export class TaskLeaseRegistry {
  constructor({
    groupId = null,
    now = () => Date.now(),
    defaultTtlMs = DEFAULT_LEASE_TTL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    queueWaitSloMs = DEFAULT_QUEUE_WAIT_SLO_MS,
    agingWindowMs = DEFAULT_AGING_WINDOW_MS,
    leaseEpoch = randomUUID(),
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this.defaultTtlMs = defaultTtlMs > 0 ? defaultTtlMs : DEFAULT_LEASE_TTL_MS;
    this.maxAttempts = maxAttempts > 0 ? maxAttempts : DEFAULT_MAX_ATTEMPTS;
    this.queueWaitSloMs =
      Number.isFinite(queueWaitSloMs) && queueWaitSloMs > 0
        ? Math.floor(queueWaitSloMs)
        : DEFAULT_QUEUE_WAIT_SLO_MS;
    this.agingWindowMs =
      Number.isFinite(agingWindowMs) && agingWindowMs > 0
        ? Math.floor(agingWindowMs)
        : DEFAULT_AGING_WINDOW_MS;
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
    this._priorityInheritanceCache = null;
    // The ready timestamp is part of the durable scheduler contract. Restarts
    // must not reset a task's queue-wait clock and thereby reintroduce
    // starvation under a sustained high-priority stream.
    this._readySinceByKey = new Map();
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
    this._priorityInheritanceCache = null;
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
      createdBy: t.createdBy ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
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
    let selected = null;
    for (const priority of ["high", "normal", "low"]) {
      for (const key of this._readyByPriority.get(priority)) {
        if (excluded.has(key)) continue;
        const scheduling = this.schedulingPriority(key, { now });
        const bothUrgent =
          scheduling.sloUrgent && selected?.scheduling?.sloUrgent;
        if (
          !selected ||
          (bothUrgent &&
            scheduling.queueWaitMs > selected.scheduling.queueWaitMs) ||
          (!bothUrgent &&
            (scheduling.total > selected.scheduling.total ||
              (scheduling.total === selected.scheduling.total &&
                scheduling.queueWaitMs > selected.scheduling.queueWaitMs)))
        ) {
          selected = { key, scheduling };
        }
        // FIFO inside one priority class is sufficient: later members cannot
        // have waited longer than the first non-excluded member.
        break;
      }
    }
    return selected?.key || null;
  }

  /**
   * Explain the effective scheduling priority for one task.
   *
   * A blocked high-priority descendant donates its priority transitively to
   * the dependency that can unblock it. Ready tasks also age, and once they
   * consume 75% of the declared queue-wait SLO they enter an urgent band that
   * outranks newly arriving work. This makes the SLO enforceable rather than
   * leaving aging as telemetry-only decoration.
   */
  schedulingPriority(key, { now = this._now() } = {}) {
    const task = this.getTask(key);
    if (!task) return null;
    const base = this._priorityScore(task.priority);
    const readySince = this._readySinceByKey.get(key);
    const queueWaitMs = Math.max(
      0,
      Number(now) -
        Number(
          readySince ??
            task.createdAt ??
            (Number.isFinite(now) ? Number(now) : 0),
        ),
    );
    const inheritance = this._priorityInheritanceFor(key);
    const donatedBase = Math.max(base, inheritance.donatedBase);
    const criticalPathBoost = inheritance.criticalPathBoost;
    const aging = Math.min(1000, Math.floor(queueWaitMs / this.agingWindowMs));
    const sloUrgent = queueWaitMs >= Math.floor(this.queueWaitSloMs * 0.75);
    const sloBoost = sloUrgent ? 10_000 : 0;
    return Object.freeze({
      base,
      donation: Math.max(0, donatedBase - base),
      aging,
      criticalPathBoost,
      sloBoost,
      sloUrgent,
      total: donatedBase + aging + Math.min(1000, criticalPathBoost) + sloBoost,
      queueWaitMs,
      queueWaitSloMs: this.queueWaitSloMs,
      readySince: Number(readySince ?? task.createdAt ?? now),
      queueWaitDeadlineAt:
        Number(readySince ?? task.createdAt ?? now) + this.queueWaitSloMs,
    });
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
    const committedCustody = currentCommittedHandoff(task);
    if (committedCustody && committedCustody.toHolder !== holder) {
      return {
        ok: false,
        reason: "custody_transferred",
        holder: committedCustody.toHolder,
        handoffId: committedCustody.id,
      };
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
    const nextLeaseId = renewing ? existing.leaseId : this._nextLeaseId();
    const lease = {
      holder,
      leaseId: nextLeaseId,
      fencingToken: renewing
        ? (existing.fencingToken ?? existing.leaseId)
        : nextLeaseId,
      acquiredAt: renewing ? existing.acquiredAt : now,
      expiresAt: now + ttl,
      renewals: renewing ? (existing.renewals || 0) + 1 : 0,
      stolen: !renewing && !!existing,
      ...(!renewing && existing?.handoffId
        ? {
            handoffId: existing.handoffId,
            transferredFromLeaseId: existing.leaseId,
            recovered: true,
          }
        : {}),
    };
    const custodyHandoffs = refreshHandoffTargetLease(task, lease, now);
    const ok = this._write(task, {
      status: TASK_STATUS.IN_PROGRESS,
      assignee: holder,
      metadata: {
        ...task.metadata,
        lease,
        ...(custodyHandoffs ? { custodyHandoffs } : {}),
      },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._removeReady(key);
    this._leasedKeys.add(key);
    return { ok: true, lease };
  }

  /**
   * Offer the current task lease to one specific teammate. The immutable
   * revision/authority binding and current lease fence are captured in the same
   * optimistic task write as the state transition, so a snapshot can never
   * contain an offer detached from its source custody.
   */
  offerHandoff(
    key,
    {
      handoffId = null,
      holder,
      leaseId,
      toHolder,
      revisionDigest,
      authorityDigest,
      artifactIds = [],
      preconditions = null,
      summary = null,
      ttlMs = DEFAULT_HANDOFF_TTL_MS,
      idempotencyKey = null,
      now = this._now(),
    } = {},
  ) {
    const id = normalizedHandoffId(handoffId);
    const source = normalizedHolder(holder);
    const recipient = normalizedHolder(toHolder);
    const revision = normalizedDigest(revisionDigest);
    const authority = normalizedDigest(authorityDigest);
    const artifacts = normalizedArtifactIds(artifactIds);
    if (!id) return { ok: false, reason: "invalid_handoff_id" };
    if (!source || !recipient || source === recipient) {
      return { ok: false, reason: "invalid_recipient" };
    }
    if (!revision) return { ok: false, reason: "invalid_revision_digest" };
    if (!authority) return { ok: false, reason: "invalid_authority_digest" };
    if (!artifacts) return { ok: false, reason: "invalid_artifact_ids" };
    const ttl = Number(ttlMs);
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_HANDOFF_TTL_MS) {
      return { ok: false, reason: "invalid_ttl" };
    }
    const idempotency =
      idempotencyKey == null
        ? id
        : normalizedHandoffId(idempotencyKey, () => id);
    if (!idempotency) {
      return { ok: false, reason: "invalid_idempotency_key" };
    }
    let cleanSummary;
    let cleanPreconditions;
    try {
      cleanSummary = cloneValue(summary);
      cleanPreconditions = cloneValue(preconditions);
    } catch {
      return { ok: false, reason: "invalid_payload" };
    }
    const taskId = this._byKey.get(key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    if (
      task.status === TASK_STATUS.COMPLETED ||
      task.status === TASK_STATUS.CANCELLED
    ) {
      return { ok: false, reason: "terminal" };
    }
    const lease = task.metadata?.lease || null;
    if (!this._leaseOwned(lease, { holder: source, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    const history = handoffHistory(task);
    let changedByExpiry = false;
    for (const handoff of history) {
      if (
        HANDOFF_ACTIVE_STATUSES.has(handoff.status) &&
        handoff.expiresAtMs <= now
      ) {
        handoff.status = "expired";
        handoff.expiredAt = now;
        handoff.updatedAt = now;
        changedByExpiry = true;
      }
    }
    const binding = {
      schema: TEAM_CUSTODY_HANDOFF_SCHEMA,
      id,
      taskKey: key,
      fromHolder: source,
      fromLeaseId: lease.leaseId,
      fromFence: lease.fencingToken ?? lease.leaseId,
      toHolder: recipient,
      revisionDigest: revision,
      authorityDigest: authority,
      artifactIds: artifacts,
      preconditions: cleanPreconditions,
      summary: cleanSummary,
      idempotencyKey: idempotency,
      ttlMs: ttl,
    };
    const bindingDigest = digestValue(binding);
    const duplicate = history.find((handoff) => handoff.id === id);
    if (duplicate) {
      if (duplicate.bindingDigest !== bindingDigest) {
        return { ok: false, reason: "handoff_id_conflict" };
      }
      if (changedByExpiry) {
        const written = this._write(task, {
          metadata: { ...task.metadata, custodyHandoffs: history },
        });
        if (!written) return { ok: false, reason: "concurrent" };
      }
      return { ok: true, idempotent: true, handoff: cloneValue(duplicate) };
    }
    const active = history.find((handoff) =>
      HANDOFF_ACTIVE_STATUSES.has(handoff.status),
    );
    if (active) {
      return {
        ok: false,
        reason: "handoff_active",
        handoffId: active.id,
      };
    }
    const handoff = {
      ...binding,
      bindingDigest,
      expiresAtMs: now + ttl,
      status: "offered",
      offeredAt: now,
      acceptedAt: null,
      rejectedAt: null,
      committedAt: null,
      revokedAt: null,
      expiredAt: null,
      targetStartedAt: null,
      targetSettledAt: null,
      targetSettlement: null,
      reason: null,
      acceptedByAttempt: null,
      targetLease: null,
      updatedAt: now,
    };
    history.push(handoff);
    while (history.length > MAX_HANDOFF_HISTORY) history.shift();
    const ok = this._write(task, {
      metadata: { ...task.metadata, custodyHandoffs: history },
    });
    return ok
      ? { ok: true, handoff: cloneValue(handoff) }
      : { ok: false, reason: "concurrent" };
  }

  /** Return one handoff with its owning task, expiring overdue offers first. */
  findHandoff(handoffId, { now = this._now() } = {}) {
    const id = normalizedHandoffId(handoffId, () => null);
    if (!id) return null;
    this.expireHandoffs({ now });
    for (const task of this.list()) {
      const handoff = handoffHistory(task).find((entry) => entry.id === id);
      if (handoff) return { key: task.key, handoff };
    }
    return null;
  }

  listHandoffs({ now = this._now() } = {}) {
    this.expireHandoffs({ now });
    return this.list().flatMap((task) =>
      handoffHistory(task).map((handoff) => ({
        key: task.key,
        handoff,
      })),
    );
  }

  expireHandoffs({ now = this._now() } = {}) {
    const expired = [];
    for (const taskView of this.list()) {
      const taskId = this._byKey.get(taskView.key);
      const task = taskId ? this._tasks.get(taskId) : null;
      if (!task) continue;
      const history = handoffHistory(task);
      let changed = false;
      for (const handoff of history) {
        if (
          HANDOFF_ACTIVE_STATUSES.has(handoff.status) &&
          handoff.expiresAtMs <= now
        ) {
          handoff.status = "expired";
          handoff.expiredAt = now;
          handoff.updatedAt = now;
          expired.push(cloneValue(handoff));
          changed = true;
        }
      }
      if (
        changed &&
        !this._write(task, {
          metadata: { ...task.metadata, custodyHandoffs: history },
        })
      ) {
        return { ok: false, reason: "concurrent", expired };
      }
    }
    return { ok: true, expired };
  }

  acceptHandoff(
    handoffId,
    { holder, recipientAttempt = null, now = this._now() } = {},
  ) {
    const found = this.findHandoff(handoffId, { now });
    if (!found) return { ok: false, reason: "not_found" };
    const taskId = this._byKey.get(found.key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const index = history.findIndex((entry) => entry.id === found.handoff.id);
    const handoff = history[index];
    if (handoff.toHolder !== holder) {
      return { ok: false, reason: "wrong_recipient" };
    }
    if (handoff.status === "accepted") {
      return { ok: true, idempotent: true, handoff: cloneValue(handoff) };
    }
    if (handoff.status !== "offered") {
      return { ok: false, reason: `handoff_${handoff.status}` };
    }
    handoff.status = "accepted";
    handoff.acceptedAt = now;
    handoff.acceptedByAttempt = cloneValue(recipientAttempt);
    handoff.updatedAt = now;
    const ok = this._write(task, {
      metadata: { ...task.metadata, custodyHandoffs: history },
    });
    return ok
      ? { ok: true, key: found.key, handoff: cloneValue(handoff) }
      : { ok: false, reason: "concurrent" };
  }

  rejectHandoff(
    handoffId,
    { holder, reason = "rejected", now = this._now() } = {},
  ) {
    const found = this.findHandoff(handoffId, { now });
    if (!found) return { ok: false, reason: "not_found" };
    const taskId = this._byKey.get(found.key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const handoff = history.find((entry) => entry.id === found.handoff.id);
    if (handoff.toHolder !== holder) {
      return { ok: false, reason: "wrong_recipient" };
    }
    if (handoff.status === "rejected") {
      return { ok: true, idempotent: true, handoff: cloneValue(handoff) };
    }
    if (handoff.status !== "offered") {
      return { ok: false, reason: `handoff_${handoff.status}` };
    }
    handoff.status = "rejected";
    handoff.rejectedAt = now;
    handoff.reason = String(reason || "rejected").slice(0, 1024);
    handoff.updatedAt = now;
    const ok = this._write(task, {
      metadata: { ...task.metadata, custodyHandoffs: history },
    });
    return ok
      ? { ok: true, key: found.key, handoff: cloneValue(handoff) }
      : { ok: false, reason: "concurrent" };
  }

  commitHandoff(handoffId, { holder, leaseId, ttlMs, now = this._now() } = {}) {
    const found = this.findHandoff(handoffId, { now });
    if (!found) return { ok: false, reason: "not_found" };
    const taskId = this._byKey.get(found.key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const handoff = history.find((entry) => entry.id === found.handoff.id);
    if (
      handoff.status === "committed" &&
      handoff.fromHolder === holder &&
      handoff.fromLeaseId === leaseId
    ) {
      const current = currentCommittedHandoff(task);
      if (current?.id !== handoff.id) {
        return { ok: false, reason: "handoff_superseded" };
      }
      return {
        ok: true,
        idempotent: true,
        key: found.key,
        handoff: cloneValue(handoff),
        lease: cloneValue(handoff.targetLease),
      };
    }
    if (handoff.status !== "accepted") {
      return { ok: false, reason: `handoff_${handoff.status}` };
    }
    const lease = task.metadata?.lease || null;
    if (!this._leaseOwned(lease, { holder, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    if (
      handoff.fromHolder !== holder ||
      handoff.fromLeaseId !== leaseId ||
      handoff.fromFence !== (lease.fencingToken ?? lease.leaseId)
    ) {
      return { ok: false, reason: "source_binding_changed" };
    }
    const ttl = ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const targetLeaseId = this._nextLeaseId();
    const targetLease = {
      holder: handoff.toHolder,
      leaseId: targetLeaseId,
      fencingToken: targetLeaseId,
      acquiredAt: now,
      expiresAt: now + ttl,
      renewals: 0,
      stolen: false,
      handoffId: handoff.id,
      transferredFromLeaseId: lease.leaseId,
    };
    handoff.status = "committed";
    handoff.committedAt = now;
    handoff.targetLease = cloneValue(targetLease);
    handoff.updatedAt = now;
    const ok = this._write(task, {
      status: TASK_STATUS.IN_PROGRESS,
      assignee: handoff.toHolder,
      metadata: {
        ...task.metadata,
        lease: targetLease,
        custodyHandoffs: history,
      },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._removeReady(found.key);
    this._leasedKeys.add(found.key);
    return {
      ok: true,
      key: found.key,
      handoff: cloneValue(handoff),
      lease: cloneValue(targetLease),
    };
  }

  revokeHandoff(
    handoffId,
    { holder, leaseId, reason = "revoked", now = this._now() } = {},
  ) {
    const found = this.findHandoff(handoffId, { now });
    if (!found) return { ok: false, reason: "not_found" };
    const taskId = this._byKey.get(found.key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const handoff = history.find((entry) => entry.id === found.handoff.id);
    if (handoff.status === "revoked") {
      return { ok: true, idempotent: true, handoff: cloneValue(handoff) };
    }
    if (!HANDOFF_ACTIVE_STATUSES.has(handoff.status)) {
      return { ok: false, reason: `handoff_${handoff.status}` };
    }
    const lease = task.metadata?.lease || null;
    if (
      handoff.fromHolder !== holder ||
      handoff.fromLeaseId !== leaseId ||
      !this._leaseOwned(lease, { holder, leaseId, now })
    ) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    handoff.status = "revoked";
    handoff.revokedAt = now;
    handoff.reason = String(reason || "revoked").slice(0, 1024);
    handoff.updatedAt = now;
    const ok = this._write(task, {
      metadata: { ...task.metadata, custodyHandoffs: history },
    });
    return ok
      ? { ok: true, key: found.key, handoff: cloneValue(handoff) }
      : { ok: false, reason: "concurrent" };
  }

  pendingCommittedHandoffs() {
    return this.list().flatMap((task) => {
      const handoff = currentCommittedHandoff(task);
      if (
        !handoff ||
        handoff.targetStartedAt != null ||
        handoff.targetSettledAt != null ||
        [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED].includes(task.status)
      ) {
        return [];
      }
      return [{ key: task.key, handoff, lease: cloneValue(task.lease) }];
    });
  }

  refreshCommittedHandoffLease(
    key,
    { handoffId, holder, ttlMs, now = this._now() } = {},
  ) {
    const taskId = this._byKey.get(key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const handoff = history.find((entry) => entry.id === handoffId);
    if (
      !handoff ||
      handoff.status !== "committed" ||
      handoff.toHolder !== holder ||
      handoff.targetStartedAt != null ||
      handoff.targetSettledAt != null ||
      [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED].includes(task.status)
    ) {
      return { ok: false, reason: "handoff_not_recoverable" };
    }
    const ttl = ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const leaseId = this._nextLeaseId();
    const lease = {
      holder,
      leaseId,
      fencingToken: leaseId,
      acquiredAt: now,
      expiresAt: now + ttl,
      renewals: 0,
      stolen: false,
      handoffId,
      transferredFromLeaseId: handoff.targetLease?.leaseId || null,
      recovered: true,
    };
    handoff.targetLease = cloneValue(lease);
    handoff.recoveredAt = now;
    handoff.updatedAt = now;
    const ok = this._write(task, {
      status: TASK_STATUS.IN_PROGRESS,
      assignee: holder,
      metadata: { ...task.metadata, lease, custodyHandoffs: history },
    });
    if (!ok) return { ok: false, reason: "concurrent" };
    this._removeReady(key);
    this._leasedKeys.add(key);
    return { ok: true, key, handoff: cloneValue(handoff), lease };
  }

  markHandoffStarted(
    key,
    { handoffId, holder, leaseId, now = this._now() } = {},
  ) {
    const taskId = this._byKey.get(key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const lease = task.metadata?.lease || null;
    if (!this._leaseOwned(lease, { holder, leaseId, now })) {
      return { ok: false, reason: "not_holder_or_expired" };
    }
    const history = handoffHistory(task);
    const handoff = history.find((entry) => entry.id === handoffId);
    if (
      !handoff ||
      handoff.status !== "committed" ||
      handoff.toHolder !== holder ||
      handoff.targetLease?.leaseId !== leaseId
    ) {
      return { ok: false, reason: "handoff_not_committed" };
    }
    if (handoff.targetStartedAt != null) {
      return { ok: true, idempotent: true, handoff: cloneValue(handoff) };
    }
    handoff.targetStartedAt = now;
    handoff.updatedAt = now;
    const ok = this._write(task, {
      metadata: { ...task.metadata, custodyHandoffs: history },
    });
    return ok
      ? { ok: true, handoff: cloneValue(handoff) }
      : { ok: false, reason: "concurrent" };
  }

  settleCommittedHandoff(
    key,
    { handoffId, holder, leaseId, settlement, now = this._now() } = {},
  ) {
    const taskId = this._byKey.get(key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const handoff = history.find((entry) => entry.id === handoffId);
    if (!handoff || handoff.status !== "committed") {
      return { ok: false, reason: "handoff_not_committed" };
    }
    if (
      handoff.toHolder !== holder ||
      handoff.targetLease?.leaseId !== leaseId
    ) {
      return { ok: false, reason: "target_binding_changed" };
    }
    if (handoff.targetSettledAt != null) {
      return { ok: true, idempotent: true, handoff: cloneValue(handoff) };
    }
    handoff.targetSettledAt = now;
    handoff.targetSettlement = String(settlement || "unknown").slice(0, 128);
    handoff.updatedAt = now;
    const ok = this._write(task, {
      metadata: { ...task.metadata, custodyHandoffs: history },
    });
    return ok
      ? { ok: true, handoff: cloneValue(handoff) }
      : { ok: false, reason: "concurrent" };
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
    const custodyHandoffs = settleHandoffHistory(
      task,
      holder,
      leaseId,
      "completed",
      now,
    );
    const ok = this._write(task, {
      status: TASK_STATUS.COMPLETED,
      metadata: {
        ...task.metadata,
        lease: null,
        result,
        ...(custodyHandoffs ? { custodyHandoffs } : {}),
      },
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
    {
      holder,
      leaseId,
      error = null,
      retryable = true,
      adjudication = null,
      now = this._now(),
    } = {},
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
    const adjudicationRequest =
      !willRetry && adjudication && typeof adjudication === "object"
        ? {
            required: true,
            code:
              adjudication.code ||
              "TEAM_TASK_SIDE_EFFECT_ADJUDICATION_REQUIRED",
            reason:
              adjudication.reason ||
              (error ? String(error) : "task outcome requires adjudication"),
            evidenceDigest: adjudication.evidenceDigest || null,
            requestedAt: Number.isFinite(adjudication.requestedAt)
              ? adjudication.requestedAt
              : now,
            decision: null,
          }
        : task.metadata?.adjudication || null;
    const custodyHandoffs = settleHandoffHistory(
      task,
      holder,
      leaseId,
      willRetry ? "retry" : "failed",
      now,
    );
    const ok = this._write(task, {
      status: willRetry ? TASK_STATUS.PENDING : TASK_STATUS.CANCELLED,
      assignee: null,
      metadata: {
        ...task.metadata,
        lease: null,
        attempts,
        lastError: error ? String(error) : null,
        ...(adjudicationRequest ? { adjudication: adjudicationRequest } : {}),
        ...(custodyHandoffs ? { custodyHandoffs } : {}),
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
      const custody = currentCommittedHandoff(t);
      if (lease && !this._leaseValid(lease, now)) {
        // A committed but not-yet-started transfer is a durable dispatch
        // journal entry. The designated recipient must recover it with a fresh
        // fence; generic expiry reclamation may not erase or steal custody.
        if (custody && custody.targetStartedAt == null) continue;
        const fresh = this._tasks.get(t.id); // re-read for current rev
        const custodyHandoffs = settleHandoffHistory(
          fresh,
          lease.holder,
          lease.leaseId,
          "lease_expired_retry",
          now,
        );
        if (
          this._write(fresh, {
            status: TASK_STATUS.PENDING,
            assignee: null,
            metadata: {
              ...fresh.metadata,
              lease: null,
              ...(custodyHandoffs ? { custodyHandoffs } : {}),
            },
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
      const custody = currentCommittedHandoff(t);
      if (
        custody &&
        custody.targetStartedAt == null &&
        custody.targetSettledAt == null
      ) {
        continue;
      }
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
      const lease = fresh.metadata.lease;
      const now = this._now();
      const custodyHandoffs = settleHandoffHistory(
        fresh,
        lease.holder,
        lease.leaseId,
        candidate.retry ? "recovery_retry" : "recovery_adjudication",
        now,
      );
      const metadata = {
        ...fresh.metadata,
        lease: null,
        ...(custodyHandoffs ? { custodyHandoffs } : {}),
      };
      if (!candidate.retry) {
        metadata.attempts = (fresh.metadata?.attempts || 0) + 1;
        metadata.lastError = String(error);
        metadata.adjudication = {
          required: true,
          code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
          reason: String(error),
          evidenceDigest: null,
          requestedAt: now,
          decision: null,
        };
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

  /**
   * Resolve a fail-closed task after a durable human decision has been
   * authenticated by the adjudication log.
   *
   * This is deliberately the only TaskLeaseRegistry operation allowed to move
   * a CANCELLED task out of a terminal state. The generic SharedTaskList keeps
   * its terminal-state invariant; this method performs a compare-by-revision
   * replacement and records the exceptional transition in task history.
   */
  resolveAdjudication(
    key,
    {
      decision,
      decisionId,
      actor = "human",
      reason = null,
      evidenceDigest = null,
      result = null,
      now = this._now(),
    } = {},
  ) {
    const allowed = new Set(Object.values(ADJUDICATION_DECISIONS));
    if (!allowed.has(decision)) {
      return { ok: false, reason: "invalid_decision" };
    }
    if (!decisionId || typeof decisionId !== "string") {
      return { ok: false, reason: "decision_id_required" };
    }
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const pending = task.metadata?.adjudication || null;
    if (pending?.required !== true) {
      const prior = pending?.decision || null;
      if (prior?.id === decisionId && prior?.action === decision) {
        return {
          ok: true,
          idempotent: true,
          decision,
          status: task.status,
        };
      }
      return { ok: false, reason: "adjudication_not_required" };
    }
    if (task.status !== TASK_STATUS.CANCELLED) {
      return { ok: false, reason: "invalid_task_state" };
    }
    if (pending.evidenceDigest && pending.evidenceDigest !== evidenceDigest) {
      return { ok: false, reason: "evidence_mismatch" };
    }

    const status =
      decision === ADJUDICATION_DECISIONS.RETRY
        ? TASK_STATUS.PENDING
        : decision === ADJUDICATION_DECISIONS.ACCEPT
          ? TASK_STATUS.COMPLETED
          : TASK_STATUS.CANCELLED;
    const decidedAt = Number.isFinite(now) ? now : this._now();
    const decisionRecord = {
      id: decisionId,
      action: decision,
      actor: actor ? String(actor) : "human",
      reason: reason == null ? null : String(reason),
      evidenceDigest: evidenceDigest || pending.evidenceDigest || null,
      decidedAt,
    };
    const snapshot = this._tasks.snapshot();
    const stored = snapshot.tasks.find((candidate) => candidate.id === task.id);
    if (!stored || stored.rev !== task.rev) {
      return { ok: false, reason: "concurrent" };
    }
    stored.status = status;
    stored.assignee = null;
    stored.updatedAt = decidedAt;
    stored.rev += 1;
    stored.metadata = {
      ...stored.metadata,
      lease: null,
      ...(decision === ADJUDICATION_DECISIONS.ACCEPT
        ? {
            result: result ?? {
              adjudicated: true,
              decisionId,
            },
          }
        : {}),
      adjudication: {
        ...pending,
        required: false,
        decision: decisionRecord,
      },
    };
    stored.history = [
      ...(stored.history || []),
      {
        ts: decidedAt,
        actor: decisionRecord.actor,
        action: "adjudicated",
        changes: ["status", "assignee", "metadata"],
        decision: decisionRecord.action,
        decisionId,
      },
    ];
    this._tasks = SharedTaskList.restore(snapshot, { now: this._now });
    this._rebuildIndexes();
    if (status === TASK_STATUS.PENDING) {
      this._enqueueIfReady(key, decidedAt);
    } else if (status === TASK_STATUS.COMPLETED) {
      for (const dependent of this._dependentsByKey.get(key) || []) {
        this._enqueueIfReady(dependent, decidedAt);
      }
    }
    return { ok: true, decision, status };
  }

  /**
   * Force any recovery-ambiguous task into the fail-closed adjudication state.
   * This exceptional transition is used only when durable collaboration
   * evidence contradicts or weakens the registry snapshot.
   */
  requireAdjudication(
    key,
    {
      code = "TEAM_TASK_SIDE_EFFECT_ADJUDICATION_REQUIRED",
      reason = "task outcome requires adjudication",
      evidenceDigest = null,
      now = this._now(),
    } = {},
  ) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    if (task.metadata?.adjudication?.required === true) {
      return { ok: true, idempotent: true };
    }
    const snapshot = this._tasks.snapshot();
    const stored = snapshot.tasks.find((candidate) => candidate.id === task.id);
    if (!stored || stored.rev !== task.rev) {
      return { ok: false, reason: "concurrent" };
    }
    const requestedAt = Number.isFinite(now) ? now : this._now();
    const priorStatus = stored.status;
    stored.status = TASK_STATUS.CANCELLED;
    stored.assignee = null;
    stored.updatedAt = requestedAt;
    stored.rev += 1;
    stored.metadata = {
      ...stored.metadata,
      lease: null,
      lastError: String(reason),
      adjudication: {
        required: true,
        code: String(code),
        reason: String(reason),
        evidenceDigest: evidenceDigest || null,
        requestedAt,
        priorStatus,
        decision: null,
      },
    };
    stored.history = [
      ...(stored.history || []),
      {
        ts: requestedAt,
        actor: "recovery",
        action: "adjudication-required",
        changes: ["status", "assignee", "metadata"],
      },
    ];
    this._tasks = SharedTaskList.restore(snapshot, { now: this._now });
    this._rebuildIndexes();
    return { ok: true, priorStatus };
  }

  /**
   * Repair the compatibility task view from a terminal canonical Graph node.
   * This exceptional path may correct a fail-closed recovery cancellation when
   * the immutable Graph ledger proves that the effect/attempt already settled.
   */
  applyCanonicalTaskProjection(
    key,
    {
      runId,
      nodeId,
      graphStatus,
      authorityGeneration,
      eventHead,
      revisionDigest,
      evidence = null,
      now = this._now(),
    } = {},
  ) {
    const terminalStatus =
      graphStatus === "succeeded"
        ? TASK_STATUS.COMPLETED
        : ["failed", "blocked", "cancelled"].includes(graphStatus)
          ? TASK_STATUS.CANCELLED
          : null;
    if (!terminalStatus) {
      return { ok: false, reason: "graph_not_terminal" };
    }
    if (
      !SAFE_HANDOFF_ID_PATTERN.test(String(runId || "")) ||
      !SAFE_HANDOFF_ID_PATTERN.test(String(nodeId || "")) ||
      !Number.isSafeInteger(Number(authorityGeneration)) ||
      Number(authorityGeneration) < 1 ||
      !SHA256_PATTERN.test(String(eventHead || "")) ||
      !SHA256_PATTERN.test(String(revisionDigest || ""))
    ) {
      return { ok: false, reason: "invalid_graph_binding" };
    }
    let cleanEvidence;
    try {
      cleanEvidence = cloneValue(evidence);
    } catch {
      return { ok: false, reason: "invalid_graph_evidence" };
    }
    const binding = {
      schema: "chainlesschain.team-graph-task-projection/v1",
      runId: String(runId),
      nodeId: String(nodeId),
      graphStatus,
      authorityGeneration: Number(authorityGeneration),
      eventHead: String(eventHead),
      revisionDigest: String(revisionDigest),
      evidence: cleanEvidence,
    };
    const projectionDigest = digestValue(binding);
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const prior = task.metadata?.canonicalGraphProjection || null;
    if (prior?.projectionDigest === projectionDigest) {
      return {
        ok: true,
        idempotent: true,
        status: task.status,
        projectionDigest,
      };
    }
    if (
      prior &&
      (prior.runId !== binding.runId ||
        prior.nodeId !== binding.nodeId ||
        prior.revisionDigest !== binding.revisionDigest ||
        prior.graphStatus !== binding.graphStatus)
    ) {
      return { ok: false, reason: "graph_projection_conflict" };
    }
    const snapshot = this._tasks.snapshot();
    const stored = snapshot.tasks.find((candidate) => candidate.id === task.id);
    if (!stored || stored.rev !== task.rev) {
      return { ok: false, reason: "concurrent" };
    }
    const projectedAt = Number.isFinite(Number(now))
      ? Number(now)
      : this._now();
    const metadata = {
      ...stored.metadata,
      lease: null,
      canonicalGraphProjection: {
        ...binding,
        projectionDigest,
        projectedAt,
      },
    };
    delete metadata.adjudication;
    if (terminalStatus === TASK_STATUS.COMPLETED) {
      metadata.result = {
        canonicalGraph: true,
        terminalEvidence: cleanEvidence,
      };
      delete metadata.lastError;
    } else {
      metadata.lastError = `canonical Graph node settled ${graphStatus}`;
    }
    stored.status = terminalStatus;
    stored.assignee = null;
    stored.updatedAt = projectedAt;
    stored.rev += 1;
    stored.metadata = metadata;
    stored.history = [
      ...(stored.history || []),
      {
        ts: projectedAt,
        actor: "graph-kernel",
        action: "canonical-projection-repaired",
        changes: ["status", "assignee", "metadata"],
        graphStatus,
        projectionDigest,
      },
    ];
    this._tasks = SharedTaskList.restore(snapshot, { now: this._now });
    this._rebuildIndexes();
    if (terminalStatus === TASK_STATUS.COMPLETED) {
      for (const dependent of this._dependentsByKey.get(key) || []) {
        this._enqueueIfReady(dependent, projectedAt);
      }
    }
    return { ok: true, status: terminalStatus, projectionDigest };
  }

  applyCanonicalHandoffProjection(
    key,
    { handoff: source, targetLease = null, now = this._now() } = {},
  ) {
    if (!source || typeof source !== "object") {
      return { ok: false, reason: "invalid_handoff_projection" };
    }
    const id = normalizedHandoffId(source.id, () => null);
    const fromHolder = normalizedHolder(source.fromHolder);
    const toHolder = normalizedHolder(source.toHolder);
    const revisionDigest = normalizedDigest(source.revisionDigest);
    const authorityDigest = normalizedDigest(source.authorityDigest);
    const artifactIds = normalizedArtifactIds(source.artifactIds);
    const status = String(source.status || "");
    const ttlMs = Number(source.ttlMs);
    if (
      !id ||
      !fromHolder ||
      !toHolder ||
      fromHolder === toHolder ||
      !revisionDigest ||
      !authorityDigest ||
      !artifactIds ||
      !TEAM_CUSTODY_HANDOFF_STATUSES.includes(status) ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > MAX_HANDOFF_TTL_MS ||
      source.taskKey !== key ||
      typeof source.fromLeaseId !== "string" ||
      source.fromLeaseId.length === 0 ||
      !["string", "number"].includes(typeof source.fromFence)
    ) {
      return { ok: false, reason: "invalid_handoff_projection" };
    }
    let preconditions;
    let summary;
    try {
      preconditions = cloneValue(source.preconditions);
      summary = cloneValue(source.summary);
    } catch {
      return { ok: false, reason: "invalid_handoff_projection" };
    }
    const idempotencyKey = normalizedHandoffId(
      source.idempotencyKey,
      () => null,
    );
    if (!idempotencyKey) {
      return { ok: false, reason: "invalid_handoff_projection" };
    }
    const binding = {
      schema: TEAM_CUSTODY_HANDOFF_SCHEMA,
      id,
      taskKey: key,
      fromHolder,
      fromLeaseId: source.fromLeaseId,
      fromFence: source.fromFence,
      toHolder,
      revisionDigest,
      authorityDigest,
      artifactIds,
      preconditions,
      summary,
      idempotencyKey,
      ttlMs,
    };
    const bindingDigest = digestValue(binding);
    if (source.bindingDigest && source.bindingDigest !== bindingDigest) {
      return { ok: false, reason: "handoff_binding_conflict" };
    }
    let cleanTargetLease = null;
    if (status === "committed") {
      try {
        cleanTargetLease = cloneValue(targetLease || source.targetLease);
      } catch {
        return { ok: false, reason: "invalid_target_lease" };
      }
      if (
        !cleanTargetLease ||
        cleanTargetLease.holder !== toHolder ||
        typeof cleanTargetLease.leaseId !== "string" ||
        cleanTargetLease.leaseId.length === 0 ||
        !Number.isFinite(Number(cleanTargetLease.expiresAt))
      ) {
        return { ok: false, reason: "invalid_target_lease" };
      }
    }
    const taskId = this._byKey.get(key);
    const task = taskId ? this._tasks.get(taskId) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const history = handoffHistory(task);
    const existing = history.find((entry) => entry.id === id);
    if (existing && existing.bindingDigest !== bindingDigest) {
      return { ok: false, reason: "handoff_binding_conflict" };
    }
    if (existing && existing.status !== status) {
      const transitions = {
        offered: new Set([
          "accepted",
          "rejected",
          "committed",
          "revoked",
          "expired",
        ]),
        accepted: new Set(["committed", "revoked", "expired"]),
      };
      if (!transitions[existing.status]?.has(status)) {
        return { ok: false, reason: "handoff_projection_regressed" };
      }
    }
    if (existing?.status === status) {
      return { ok: true, idempotent: true, handoff: cloneValue(existing) };
    }
    const projectedAt = Number.isFinite(Number(now))
      ? Number(now)
      : this._now();
    const projected = {
      ...(existing || binding),
      ...binding,
      bindingDigest,
      expiresAtMs: Number(source.expiresAtMs),
      status,
      offeredAt: Number(source.offeredAt),
      acceptedAt: source.acceptedAt == null ? null : Number(source.acceptedAt),
      rejectedAt: source.rejectedAt == null ? null : Number(source.rejectedAt),
      committedAt:
        source.committedAt == null ? null : Number(source.committedAt),
      revokedAt: source.revokedAt == null ? null : Number(source.revokedAt),
      expiredAt: source.expiredAt == null ? null : Number(source.expiredAt),
      targetStartedAt: existing?.targetStartedAt ?? null,
      targetSettledAt: existing?.targetSettledAt ?? null,
      targetSettlement: existing?.targetSettlement ?? null,
      reason:
        source.reason == null ? null : String(source.reason).slice(0, 1024),
      acceptedByAttempt: existing?.acceptedByAttempt ?? null,
      targetLease:
        status === "committed"
          ? cloneValue(existing?.targetLease || cleanTargetLease)
          : null,
      canonicalProjectedAt: projectedAt,
      updatedAt: Number(source.updatedAt) || projectedAt,
    };
    if (existing) {
      history[history.indexOf(existing)] = projected;
    } else {
      history.push(projected);
      while (history.length > MAX_HANDOFF_HISTORY) history.shift();
    }
    const snapshot = this._tasks.snapshot();
    const stored = snapshot.tasks.find((candidate) => candidate.id === task.id);
    if (!stored || stored.rev !== task.rev) {
      return { ok: false, reason: "concurrent" };
    }
    stored.rev += 1;
    stored.updatedAt = projectedAt;
    stored.metadata = { ...stored.metadata, custodyHandoffs: history };
    if (
      status === "committed" &&
      ![TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED].includes(stored.status)
    ) {
      stored.status = TASK_STATUS.IN_PROGRESS;
      stored.assignee = toHolder;
      stored.metadata.lease = cloneValue(projected.targetLease);
    } else if (
      status === "expired" &&
      stored.metadata?.lease?.leaseId === binding.fromLeaseId
    ) {
      stored.status = TASK_STATUS.PENDING;
      stored.assignee = null;
      stored.metadata.lease = null;
    }
    stored.history = [
      ...(stored.history || []),
      {
        ts: projectedAt,
        actor: "graph-kernel",
        action: "canonical-handoff-projected",
        changes: ["status", "assignee", "metadata"],
        handoffId: id,
        handoffStatus: status,
      },
    ];
    this._tasks = SharedTaskList.restore(snapshot, { now: this._now });
    this._rebuildIndexes();
    return { ok: true, handoff: cloneValue(projected) };
  }

  /** Bind a pending adjudication to its immutable durable case evidence. */
  bindAdjudicationCase(key, { caseId, registryDigest, sideEffectDigest } = {}) {
    const id = this._byKey.get(key);
    const task = id ? this._tasks.get(id) : null;
    if (!task) return { ok: false, reason: "not_found" };
    const adjudication = task.metadata?.adjudication || null;
    if (adjudication?.required !== true) {
      return { ok: false, reason: "adjudication_not_required" };
    }
    for (const [name, value] of Object.entries({
      caseId,
      registryDigest,
      sideEffectDigest,
    })) {
      if (typeof value !== "string" || value.length === 0) {
        return { ok: false, reason: `${name}_required` };
      }
    }
    const current = adjudication.case || null;
    if (current) {
      if (
        current.caseId === caseId &&
        current.registryDigest === registryDigest &&
        current.sideEffectDigest === sideEffectDigest
      ) {
        return { ok: true, idempotent: true, case: { ...current } };
      }
      return { ok: false, reason: "case_binding_conflict" };
    }
    const binding = { caseId, registryDigest, sideEffectDigest };
    const ok = this._write(task, {
      metadata: {
        ...task.metadata,
        adjudication: {
          ...adjudication,
          case: binding,
        },
      },
    });
    return ok
      ? { ok: true, case: { ...binding } }
      : { ok: false, reason: "concurrent" };
  }

  pendingAdjudications() {
    return this.list()
      .filter((task) => task.metadata?.adjudication?.required === true)
      .map((task) => ({
        key: task.key,
        status: task.status,
        ...task.metadata.adjudication,
      }));
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
      adjudicationRequired: this.pendingAdjudications().length,
    };
  }

  /** Whether the graph is fully done (all terminal). */
  allDone() {
    return this._tasks
      .list()
      .every(
        (t) =>
          (t.status === TASK_STATUS.COMPLETED ||
            t.status === TASK_STATUS.CANCELLED) &&
          t.metadata?.adjudication?.required !== true,
      );
  }

  snapshot() {
    return {
      registry: {
        defaultTtlMs: this.defaultTtlMs,
        maxAttempts: this.maxAttempts,
        queueWaitSloMs: this.queueWaitSloMs,
        agingWindowMs: this.agingWindowMs,
        readySinceByKey: Array.from(this._readySinceByKey.entries()),
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
      queueWaitSloMs: snapshot?.registry?.queueWaitSloMs,
      agingWindowMs: snapshot?.registry?.agingWindowMs,
    });
    reg._tasks = SharedTaskList.restore(snapshot.tasks, { now: reg._now });
    reg._byKey = new Map(snapshot?.registry?.byKey || []);
    reg._readySinceByKey = new Map(snapshot?.registry?.readySinceByKey || []);
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
      // Lease lifecycle changes do not alter the dependency-priority graph.
      // In particular, a successfully completed task can only have completed
      // ancestors because acquire() gates on every dependency. Cancelling is
      // different: recovery may fail a blocked descendant closed, which must
      // withdraw its donated priority from unfinished ancestors.
      if (
        (patch.priority !== undefined && patch.priority !== task.priority) ||
        (patch.status === TASK_STATUS.CANCELLED &&
          task.status !== TASK_STATUS.CANCELLED)
      ) {
        this._priorityInheritanceCache = null;
      }
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

  _priorityScore(priority) {
    return priority === "high" ? 2 : priority === "low" ? 0 : 1;
  }

  _priorityInheritanceFor(key) {
    if (!this._priorityInheritanceCache) {
      const keys = [...this._byKey.keys()];
      const indegree = new Map(
        keys.map((candidate) => [
          candidate,
          (this._depsByKey.get(candidate) || []).filter((dependency) =>
            this._byKey.has(dependency),
          ).length,
        ]),
      );
      const ready = keys.filter((candidate) => indegree.get(candidate) === 0);
      const order = [];
      for (let index = 0; index < ready.length; index += 1) {
        const candidate = ready[index];
        order.push(candidate);
        for (const dependent of this._dependentsByKey.get(candidate) || []) {
          if (!indegree.has(dependent)) continue;
          indegree.set(dependent, indegree.get(dependent) - 1);
          if (indegree.get(dependent) === 0) ready.push(dependent);
        }
      }
      const inherited = new Map();
      for (const candidate of order.reverse()) {
        const task = this.getTask(candidate);
        let donatedBase = this._priorityScore(task?.priority);
        let criticalPathBoost = 0;
        for (const dependent of this._dependentsByKey.get(candidate) || []) {
          const dependentTask = this.getTask(dependent);
          if (
            !dependentTask ||
            [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED].includes(
              dependentTask.status,
            )
          ) {
            continue;
          }
          const child = inherited.get(dependent) || {
            donatedBase: this._priorityScore(dependentTask.priority),
            criticalPathBoost: 0,
          };
          donatedBase = Math.max(donatedBase, child.donatedBase);
          criticalPathBoost = Math.max(
            criticalPathBoost,
            child.criticalPathBoost + 1,
          );
        }
        inherited.set(candidate, { donatedBase, criticalPathBoost });
      }
      this._priorityInheritanceCache = inherited;
    }
    return (
      this._priorityInheritanceCache.get(key) || {
        donatedBase: this._priorityScore(this.getTask(key)?.priority),
        criticalPathBoost: 0,
      }
    );
  }

  _removeReady(key, { clearWait = true } = {}) {
    for (const queue of this._readyByPriority.values()) queue.delete(key);
    if (clearWait) this._readySinceByKey.delete(key);
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
    const custody = currentCommittedHandoff(task);
    if (custody && custody.targetSettledAt == null) {
      // A committed transfer is a durable dispatch journal, including after
      // its target lease expires. It is recovered or adjudicated explicitly;
      // the generic ready frontier must never expose it for lease stealing.
      this._removeReady(key);
      this._leasedKeys.add(key);
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
    if (!this._readySinceByKey.has(key)) {
      this._readySinceByKey.set(key, Number(now));
    }
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
    const restoredReadySince = new Map(this._readySinceByKey || []);
    this._depsByKey = new Map();
    this._dependentsByKey = new Map();
    this._readyByPriority = new Map([
      ["high", new Set()],
      ["normal", new Set()],
      ["low", new Set()],
    ]);
    this._leasedKeys = new Set();
    this._readySinceByKey = restoredReadySince;
    this._priorityInheritanceCache = null;
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
    for (const priority of ["high", "normal", "low"]) {
      const ordered = [...this._readyByPriority.get(priority)].sort(
        (left, right) =>
          (this._readySinceByKey.get(left) || 0) -
            (this._readySinceByKey.get(right) || 0) ||
          left.localeCompare(right),
      );
      this._readyByPriority.set(priority, new Set(ordered));
    }
  }
}
