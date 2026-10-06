"use strict";

const { createHash } = require("node:crypto");
const { PersonalProjectGoalService } = require("./project-goal-service.js");
const {
  ProjectRiskReviewService,
} = require("./project-risk-review-service.js");
const { goalError, reviseGoalRecord } = require("./goal-contract.js");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const { SchedulerRuntime } = require("./scheduler-runtime.js");
const { createSchedulerService } = require("./scheduler-service.js");
const {
  bindSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
  checkSchedulerAuthorityPolicy,
  parseSchedulerAuthorityPolicyReference,
  schedulerAuthorityPolicyReference,
} = require("./scheduler-authority-resolver.js");

const KIND = "project-goal-risk";
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CHECKS = 1_000;
const CAPABILITY = "project.risk.read";
const MAX_CHECK_BYTES = 4_096;
const PAYLOAD_FIELDS = [
  "storeId",
  "goalId",
  "goalRevision",
  "controlGeneration",
  "monitorRevision",
  "requestId",
  "schedulerPolicyRevision",
];

function input(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    throw goalError("GOAL_MONITOR_INVALID_REQUEST");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    throw goalError("GOAL_MONITOR_INVALID_REQUEST");
  return value;
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    throw goalError("GOAL_MONITOR_INVALID_REQUEST");
  return value;
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    throw goalError("GOAL_MONITOR_INVALID_CLOCK");
  return value;
}
function jobPrefix(goal) {
  return `goal-risk-${createHash("sha256")
    .update(JSON.stringify([goal.storeId, goal.id]))
    .digest("hex")}-`;
}
function payloadFor({
  goal,
  monitor = null,
  requestId = null,
  policyRevision = null,
}) {
  return {
    storeId: goal.storeId,
    goalId: goal.id,
    goalRevision: goal.revision,
    controlGeneration: goal.controlGeneration,
    monitorRevision: monitor?.revision ?? null,
    requestId,
    schedulerPolicyRevision:
      policyRevision ?? monitor?.scheduler_policy_revision,
  };
}
function jobId(goal, payload) {
  // Request identity belongs to an occurrence, so manual requests cannot
  // invalidate each other's pending execution or crash recovery.
  return (
    jobPrefix(goal) +
    digest({
      ...payload,
      requestId: payload.requestId === null ? null : "manual",
    })
  );
}
function resultFor(goal, review) {
  return {
    goalId: goal.id,
    reviewId: review.review.id,
    checkedAt: review.review.createdAt,
    status: review.evaluation.status,
    riskTaskCount: review.evaluation.summary?.riskTaskCount ?? null,
  };
}

/** Project evidence and usage commit together in native SQLite. Scheduler
 * settlement is a separate projection, recoverable by occurrence identity. */
class ProjectGoalMonitoringState {
  constructor({ db, getActor, clock = Date.now }) {
    if (typeof clock !== "function")
      throw goalError("GOAL_MONITOR_INVALID_CLOCK");
    this.clock = clock;
    this.goals = new PersonalProjectGoalService({
      db,
      getActor,
      now: () => new Date(epoch(clock())).toISOString(),
    });
    this.adapter = this.goals.adapter;
    this.db = db;
    this.risk = new ProjectRiskReviewService({ db, getActor, now: clock });
    this.adapter._transaction(() =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS cc_project_goal_monitors (
        goal_id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,revision INTEGER NOT NULL,
        interval_ms INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        next_check_at INTEGER NOT NULL,scheduler_policy_revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cc_project_goal_manual_requests (
        goal_id TEXT NOT NULL,request_id TEXT NOT NULL,actor_did TEXT NOT NULL,
        goal_revision INTEGER NOT NULL,control_generation INTEGER NOT NULL,created_at INTEGER NOT NULL,scheduler_policy_revision INTEGER NOT NULL,
        PRIMARY KEY(goal_id,request_id));
      CREATE TABLE IF NOT EXISTS cc_project_goal_checks (
        occurrence_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,
        goal_revision INTEGER NOT NULL,control_generation INTEGER NOT NULL,
        request_digest TEXT NOT NULL,payload_json TEXT NOT NULL,review_id TEXT NOT NULL,
        result_json TEXT NOT NULL,result_digest TEXT NOT NULL,checked_at INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms>=0));
      CREATE INDEX IF NOT EXISTS idx_cc_project_goal_checks_goal ON cc_project_goal_checks(goal_id,actor_did,checked_at);
    `),
    );
  }
  _withGoal(goalId, operation) {
    return this.adapter._transaction(() => {
      const actor = this.adapter._actor();
      const goal = this.adapter._read(id(goalId), actor);
      if (!goal) throw goalError("GOAL_NOT_FOUND_OR_DENIED");
      const result = operation(goal, actor);
      if (result && typeof result.then === "function")
        throw goalError("GOAL_MONITOR_ASYNC_TRANSACTION_DENIED");
      if (this.adapter._actor() !== actor)
        throw goalError("GOAL_IDENTITY_CHANGED");
      this.adapter._project(goal.projectRef.id, actor);
      return result;
    });
  }
  _monitor(goalId, actor) {
    const row = this.db
      .prepare("SELECT * FROM cc_project_goal_monitors WHERE goal_id=?")
      .get(goalId);
    if (
      row &&
      (row.actor_did !== actor ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1 ||
        !Number.isSafeInteger(row.interval_ms) ||
        row.interval_ms < MIN_INTERVAL_MS ||
        row.interval_ms > MAX_INTERVAL_MS ||
        ![0, 1].includes(row.enabled) ||
        !Number.isSafeInteger(row.scheduler_policy_revision) ||
        row.scheduler_policy_revision < 1 ||
        !Number.isSafeInteger(row.next_check_at) ||
        row.next_check_at < 0 ||
        row.next_check_at > 253402300799999)
    )
      throw goalError("GOAL_MONITOR_RECORD_CORRUPT");
    return row ?? null;
  }
  _usage(goal, actor) {
    const usage = this.db
      .prepare(
        `SELECT COUNT(*) AS checks,COALESCE(SUM(elapsed_ms),0) AS elapsedMs,
      COALESCE(SUM(CASE WHEN elapsed_ms<0 OR typeof(elapsed_ms)!='integer' THEN 1 ELSE 0 END),0) AS invalid
      FROM cc_project_goal_checks WHERE goal_id=? AND actor_did=?`,
      )
      .get(goal.id, actor);
    if (
      usage.invalid ||
      !Number.isSafeInteger(usage.checks) ||
      usage.checks > MAX_CHECKS ||
      !Number.isSafeInteger(usage.elapsedMs) ||
      usage.elapsedMs < 0
    )
      throw goalError("GOAL_MONITOR_CHECK_CORRUPT");
    return {
      checks: usage.checks,
      elapsedMs: usage.elapsedMs,
      modelTokens: 0,
      modelCostUsd: 0,
    };
  }
  _blocked(goal, actor, usage = this._usage(goal, actor)) {
    if (goal.status !== "active") return "GOAL_MONITOR_NOT_ACTIVE";
    if (
      !["active", "draft"].includes(
        this.adapter._project(goal.projectRef.id, actor).status,
      )
    )
      return "GOAL_PROJECT_NOT_ACTIVE";
    if (
      goal.expiresAt !== null &&
      epoch(this.clock()) >= Date.parse(goal.expiresAt)
    )
      return "GOAL_MONITOR_EXPIRED";
    if (
      usage.checks >=
        Math.min(goal.budgetPolicy.maxRuns ?? MAX_CHECKS, MAX_CHECKS) ||
      (goal.budgetPolicy.maxTimeMs !== null &&
        usage.elapsedMs >= goal.budgetPolicy.maxTimeMs)
    )
      return "GOAL_MONITOR_BUDGET_EXHAUSTED";
    return null;
  }
  configure(value, resolvePolicy) {
    if (typeof resolvePolicy !== "function")
      throw goalError("GOAL_MONITOR_AUTHORITY_REQUIRED");
    input(value, ["id", "expectedRevision", "intervalMs"]);
    if (
      !Number.isSafeInteger(value.intervalMs) ||
      value.intervalMs < MIN_INTERVAL_MS ||
      value.intervalMs > MAX_INTERVAL_MS
    )
      throw goalError("GOAL_MONITOR_INVALID_INTERVAL");
    return this._withGoal(value.id, (goal, actor) => {
      if (goal.revision !== value.expectedRevision)
        throw goalError("GOAL_REVISION_CONFLICT");
      const blocked = this._blocked(goal, actor);
      if (blocked) throw goalError(blocked);
      const old = this._monitor(goal.id, actor);
      const revision = (old?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision))
        throw goalError("GOAL_INVALID_REVISION");
      this.db
        .prepare(
          `INSERT INTO cc_project_goal_monitors VALUES (?,?,?,?,1,?,?)
        ON CONFLICT(goal_id) DO UPDATE SET revision=excluded.revision,interval_ms=excluded.interval_ms,
        enabled=1,next_check_at=excluded.next_check_at,scheduler_policy_revision=excluded.scheduler_policy_revision WHERE actor_did=excluded.actor_did`,
        )
        .run(
          goal.id,
          actor,
          revision,
          value.intervalMs,
          epoch(this.clock()),
          resolvePolicy(goal),
        );
      return { goal, monitor: this._monitor(goal.id, actor) };
    });
  }
  pause(value) {
    input(value, ["id", "expectedRevision"]);
    // Control generation and monitoring intent change in the same CAS tx.
    return this.adapter.compareAndSwap(
      value.id,
      value.expectedRevision,
      (goal) => {
        const monitor = this._monitor(goal.id, goal.ownerRef);
        if (monitor?.enabled) {
          if (!Number.isSafeInteger(monitor.revision + 1))
            throw goalError("GOAL_INVALID_REVISION");
          this.db
            .prepare(
              "UPDATE cc_project_goal_monitors SET enabled=0,revision=revision+1 WHERE goal_id=?",
            )
            .run(goal.id);
        }
        return reviseGoalRecord(
          goal,
          { status: "paused" },
          new Date(epoch(this.clock())).toISOString(),
        );
      },
    );
  }
  binding(goalId) {
    return this._withGoal(goalId, (goal, actor) => ({
      goal,
      monitor: this._monitor(goal.id, actor),
      blockedReason: this._blocked(goal, actor),
    }));
  }
  due(after = null) {
    return this.adapter._transaction(() => {
      const actor = this.adapter._actor();
      const rows = this.db
        .prepare(
          `SELECT goal_id,next_check_at FROM cc_project_goal_monitors
        WHERE actor_did=? AND enabled=1 AND next_check_at<=?
        ${after ? "AND (next_check_at,goal_id)>(?,?)" : ""}
        ORDER BY next_check_at,goal_id LIMIT 50`,
        )
        .all(
          actor,
          epoch(this.clock()),
          ...(after ? [after.at, after.id] : []),
        );
      return rows;
    });
  }
  advance(binding) {
    return this._withGoal(binding.goal.id, (goal, actor) => {
      const current = this._monitor(goal.id, actor);
      if (
        !current ||
        !current.enabled ||
        current.revision !== binding.monitor.revision ||
        current.next_check_at !== binding.monitor.next_check_at ||
        goal.revision !== binding.goal.revision
      )
        throw goalError("GOAL_MONITOR_BINDING_STALE");
      const now = epoch(this.clock());
      const steps =
        Math.floor(
          Math.max(0, now - current.next_check_at) / current.interval_ms,
        ) + 1;
      const next = epoch(current.next_check_at + steps * current.interval_ms);
      this.db
        .prepare(
          "UPDATE cc_project_goal_monitors SET next_check_at=? WHERE goal_id=? AND revision=?",
        )
        .run(next, goal.id, current.revision);
      return next;
    });
  }
  prepareManual(value, resolvePolicy) {
    if (typeof resolvePolicy !== "function")
      throw goalError("GOAL_MONITOR_AUTHORITY_REQUIRED");
    input(value, ["id", "expectedRevision", "requestId"]);
    id(value.requestId);
    return this._withGoal(value.id, (goal, actor) => {
      if (goal.revision !== value.expectedRevision)
        throw goalError("GOAL_REVISION_CONFLICT");
      const prior = this.db
        .prepare(
          "SELECT * FROM cc_project_goal_manual_requests WHERE goal_id=? AND request_id=?",
        )
        .get(goal.id, value.requestId);
      const policyRevision =
        prior?.scheduler_policy_revision ?? resolvePolicy(goal);
      if (
        !Number.isSafeInteger(policyRevision) ||
        policyRevision < 1 ||
        (prior &&
          (!Number.isSafeInteger(prior.created_at) || prior.created_at < 0))
      )
        throw goalError("GOAL_MONITOR_RECORD_CORRUPT");
      if (
        prior &&
        (prior.actor_did !== actor ||
          prior.goal_revision !== goal.revision ||
          prior.control_generation !== goal.controlGeneration)
      )
        throw goalError("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
      if (goal.status !== "active") throw goalError("GOAL_MONITOR_NOT_ACTIVE");
      if (!prior) {
        const blocked = this._blocked(goal, actor);
        if (blocked) throw goalError(blocked);
        const requests = this.db
          .prepare(
            "SELECT COUNT(*) AS total FROM cc_project_goal_manual_requests WHERE goal_id=?",
          )
          .get(goal.id).total;
        if (requests >= MAX_CHECKS)
          throw goalError("GOAL_MONITOR_REQUEST_LIMIT");
        this.db
          .prepare(
            "INSERT INTO cc_project_goal_manual_requests VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            goal.id,
            value.requestId,
            actor,
            goal.revision,
            goal.controlGeneration,
            epoch(this.clock()),
            policyRevision,
          );
      }
      return {
        goal,
        monitor: null,
        requestId: value.requestId,
        policyRevision,
      };
    });
  }
  _payload(payload) {
    input(payload, PAYLOAD_FIELDS);
    id(payload.storeId);
    id(payload.goalId);
    if (
      !Number.isSafeInteger(payload.goalRevision) ||
      payload.goalRevision < 1 ||
      !Number.isSafeInteger(payload.controlGeneration) ||
      payload.controlGeneration < 0 ||
      !Number.isSafeInteger(payload.schedulerPolicyRevision) ||
      payload.schedulerPolicyRevision < 1 ||
      (payload.requestId === null
        ? !Number.isSafeInteger(payload.monitorRevision) ||
          payload.monitorRevision < 1
        : payload.monitorRevision !== null)
    )
      throw goalError("GOAL_MONITOR_BINDING_STALE");
    if (payload.requestId !== null) id(payload.requestId);
  }
  _validateBinding(payload, goal, actor) {
    this._payload(payload);
    if (
      payload.storeId !== goal.storeId ||
      payload.goalId !== goal.id ||
      payload.goalRevision !== goal.revision ||
      payload.controlGeneration !== goal.controlGeneration
    )
      throw goalError("GOAL_MONITOR_BINDING_STALE");
    if (goal.status !== "active") throw goalError("GOAL_MONITOR_NOT_ACTIVE");
    if (payload.requestId !== null) {
      const request = this.db
        .prepare(
          "SELECT * FROM cc_project_goal_manual_requests WHERE goal_id=? AND request_id=? AND actor_did=?",
        )
        .get(goal.id, payload.requestId, actor);
      if (
        !request ||
        request.scheduler_policy_revision !== payload.schedulerPolicyRevision ||
        request.goal_revision !== goal.revision ||
        request.control_generation !== goal.controlGeneration
      )
        throw goalError("GOAL_MONITOR_REQUEST_REQUIRED");
    } else {
      const monitor = this._monitor(goal.id, actor);
      if (
        !monitor ||
        !monitor.enabled ||
        monitor.scheduler_policy_revision !== payload.schedulerPolicyRevision ||
        monitor.revision !== payload.monitorRevision
      )
        throw goalError("GOAL_MONITOR_DISABLED");
    }
  }
  _check(occurrenceId) {
    return this.db
      .prepare(
        `SELECT occurrence_id,goal_id,actor_did,goal_revision,control_generation,request_digest,
      CASE WHEN length(CAST(payload_json AS BLOB))<=${MAX_CHECK_BYTES} THEN payload_json ELSE NULL END AS payload_json,
      review_id,CASE WHEN length(CAST(result_json AS BLOB))<=${MAX_CHECK_BYTES} THEN result_json ELSE NULL END AS result_json,
      result_digest,checked_at,elapsed_ms FROM cc_project_goal_checks WHERE occurrence_id=?`,
      )
      .get(id(occurrenceId));
  }
  _validatedCheck(row, goal, actor, expectedPayload = null) {
    let payload, result;
    try {
      payload = JSON.parse(row.payload_json);
      result = JSON.parse(row.result_json);
      this._payload(payload);
      if (
        row.goal_id !== goal.id ||
        row.actor_did !== actor ||
        row.goal_revision !== payload.goalRevision ||
        row.control_generation !== payload.controlGeneration ||
        payload.goalRevision > goal.revision ||
        payload.controlGeneration > goal.controlGeneration ||
        payload.goalId !== goal.id ||
        payload.storeId !== goal.storeId ||
        digest(payload) !== row.request_digest ||
        digest(result) !== row.result_digest ||
        (expectedPayload !== null &&
          digest(expectedPayload) !== row.request_digest) ||
        !Number.isSafeInteger(row.elapsed_ms) ||
        row.elapsed_ms < 0 ||
        epoch(row.checked_at) !== Date.parse(result.checkedAt)
      )
        throw new Error("invalid check");
    } catch {
      throw goalError("GOAL_MONITOR_CHECK_CORRUPT");
    }
    const review = this.risk.getReviewInTransaction({
      reviewId: row.review_id,
    });
    if (
      review.review.actorDid !== actor ||
      review.review.projectId !== goal.projectRef.id ||
      digest(resultFor(goal, review)) !== row.result_digest
    )
      throw goalError("GOAL_MONITOR_CHECK_CORRUPT");
    return result;
  }
  authorize({ job, occurrence }) {
    try {
      return this._withGoal(occurrence.payload.goalId, (goal, actor) => {
        this._validateBinding(occurrence.payload, goal, actor);
        if (
          job.kind !== KIND ||
          job.id !== jobId(goal, occurrence.payload) ||
          occurrence.authority.principal.id !== actor ||
          occurrence.authority.principal.type !== "user" ||
          occurrence.authority.workspaceId !== actor ||
          JSON.stringify(occurrence.authority.requestedCapabilities) !==
            JSON.stringify([CAPABILITY])
        )
          throw goalError("GOAL_MONITOR_AUTHORITY_MISMATCH");
        const old = this._check(occurrence.id);
        if (old) this._validatedCheck(old, goal, actor, occurrence.payload);
        else {
          const blocked = this._blocked(goal, actor);
          if (blocked) return { allowed: false, reason: blocked };
        }
        return { allowed: true };
      });
    } catch (error) {
      if (
        [
          "GOAL_MONITOR_BINDING_STALE",
          "GOAL_MONITOR_NOT_ACTIVE",
          "GOAL_MONITOR_DISABLED",
          "GOAL_NOT_FOUND_OR_DENIED",
          "GOAL_ORGANIZATION_UNSUPPORTED",
        ].includes(error.code)
      )
        return { allowed: false, reason: error.code };
      throw error;
    }
  }
  perform(context, assertAuthority) {
    if (typeof assertAuthority !== "function")
      throw goalError("GOAL_MONITOR_AUTHORITY_REQUIRED");
    return this._withGoal(context.occurrence.payload.goalId, (goal, actor) => {
      this._validateBinding(context.occurrence.payload, goal, actor);
      const renew = () => {
        context.renewLease();
        if (context.signal.aborted) throw goalError("GOAL_MONITOR_ABORTED");
        assertAuthority();
      };
      renew();
      const old = this._check(context.occurrence.id);
      if (old)
        return this._validatedCheck(
          old,
          goal,
          actor,
          context.occurrence.payload,
        );
      const usage = this._usage(goal, actor);
      const blocked = this._blocked(goal, actor, usage);
      if (blocked) throw goalError(blocked);
      const started = epoch(this.clock());
      const review = this.risk.evaluateInTransaction({
        projectId: goal.projectRef.id,
      });
      renew();
      const finished = epoch(this.clock());
      if (finished < started) throw goalError("GOAL_CLOCK_MOVED_BACKWARDS");
      if (
        goal.budgetPolicy.maxTimeMs !== null &&
        usage.elapsedMs + finished - started > goal.budgetPolicy.maxTimeMs
      )
        throw goalError("GOAL_MONITOR_BUDGET_EXHAUSTED");
      if (goal.expiresAt !== null && finished >= Date.parse(goal.expiresAt))
        throw goalError("GOAL_MONITOR_EXPIRED");
      const result = resultFor(goal, review);
      this.db
        .prepare(
          "INSERT INTO cc_project_goal_checks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          context.occurrence.id,
          goal.id,
          actor,
          goal.revision,
          goal.controlGeneration,
          digest(context.occurrence.payload),
          JSON.stringify(context.occurrence.payload),
          review.review.id,
          JSON.stringify(result),
          digest(result),
          Date.parse(result.checkedAt),
          finished - started,
        );
      renew();
      return result;
    });
  }
  readCheck(occurrence) {
    return this._withGoal(occurrence.payload.goalId, (goal, actor) => {
      const row = this._check(occurrence.id);
      if (!row) throw goalError("GOAL_MONITOR_CHECK_MISSING");
      return this._validatedCheck(row, goal, actor, occurrence.payload);
    });
  }
  status(goalId) {
    return this._withGoal(goalId, (goal, actor) => {
      const monitor = this._monitor(goal.id, actor);
      const rows = this.db
        .prepare(
          "SELECT occurrence_id FROM cc_project_goal_checks WHERE goal_id=? AND actor_did=? ORDER BY rowid DESC LIMIT 20",
        )
        .all(goal.id, actor);
      const history = rows.map(({ occurrence_id }) => {
        const row = this._check(occurrence_id);
        return {
          occurrenceId: row.occurrence_id,
          goalRevision: row.goal_revision,
          controlGeneration: row.control_generation,
          reviewId: row.review_id,
          result: this._validatedCheck(row, goal, actor),
          elapsedMs: row.elapsed_ms,
        };
      });
      const usage = this._usage(goal, actor);
      return {
        goal,
        monitor,
        history,
        usage,
        blockedReason: this._blocked(goal, actor, usage),
      };
    });
  }
}

class ProjectGoalMonitoringEngine {
  constructor({ db, getActor, store, clock = Date.now, ownerId, leaseMs }) {
    this.getActor = getActor;
    this.store = store;
    this.clock = clock;
    this.closed = false;
    this.abort = new AbortController();
    this.inFlight = new Set();
    this.loop = null;
    this.closePromise = null;
    this.dueCursor = null;
    this.state = new ProjectGoalMonitoringState({ db, getActor, clock });
    this.runtime = new SchedulerRuntime({
      store,
      graphAuthorityMode: "legacy",
      ownerId,
      leaseMs,
      authorize: createSchedulerAuthorityResolver({
        store,
        validate: (context) => this.state.authorize(context),
      }),
      adapters: [
        {
          kind: KIND,
          execute: (context) =>
            this.state.perform(context, () => {
              const current = checkSchedulerAuthorityPolicy(
                store,
                context.occurrence.authority,
              );
              if (
                !current.allowed ||
                current.policyRevision !== context.decision.policyRevision
              )
                throw goalError("GOAL_MONITOR_AUTHORITY_CHANGED");
            }),
          classifyError: () => ({ retryable: false }),
        },
      ],
    });
    this.service = createSchedulerService({
      drivers: [{ name: KIND, run: (context) => this.tick(context) }],
    });
  }
  _assertOpen() {
    if (this.closed) throw goalError("GOAL_MONITOR_HOST_CLOSED");
  }
  _track(operation, signal) {
    this._assertOpen();
    const linked = signal
      ? AbortSignal.any([this.abort.signal, signal])
      : this.abort.signal;
    const promise = Promise.resolve().then(() => {
      this._assertOpen();
      return operation(linked);
    });
    this.inFlight.add(promise);
    promise.then(
      () => this.inFlight.delete(promise),
      () => this.inFlight.delete(promise),
    );
    return promise;
  }
  _resolvePolicy(goal) {
    const bound = bindSchedulerAuthorityPolicy(this.store, {
      schemaVersion: 1,
      principal: { type: "user", id: goal.ownerRef },
      workspaceId: goal.ownerRef,
      requestedCapabilities: [CAPABILITY],
    });
    return parseSchedulerAuthorityPolicyReference(
      bound.authorizationRefs.schedulerPolicyRevision,
    );
  }
  _manualBinding(value) {
    return this.state.prepareManual(value, (goal) => this._resolvePolicy(goal));
  }
  _job(binding) {
    const { goal } = binding;
    const occurrencePayload = payloadFor(binding);
    const payload = {
      ...occurrencePayload,
      requestId: occurrencePayload.requestId === null ? null : "manual",
    };
    const key = jobId(goal, occurrencePayload);
    const existing = this.store.getJob(key);
    if (existing) {
      if (
        existing.kind !== KIND ||
        existing.authority.principal.id !== goal.ownerRef ||
        digest(existing.payload) !== digest(payload)
      )
        throw goalError("GOAL_MONITOR_JOB_MISMATCH");
      return existing;
    }
    const authority = {
      schemaVersion: 1,
      principal: { type: "user", id: goal.ownerRef },
      workspaceId: goal.ownerRef,
      requestedCapabilities: [CAPABILITY],
      authorizationRefs: {
        schedulerPolicyRevision: schedulerAuthorityPolicyReference(
          payload.schedulerPolicyRevision,
        ),
      },
    };
    return this.store.createJob({
      id: key,
      kind: KIND,
      trigger: { type: "domain-intent" },
      payload,
      authority,
      maxAttempts: 3,
    });
  }
  start(value) {
    this._assertOpen();
    const binding = this.state.configure(value, (goal) =>
      this._resolvePolicy(goal),
    );
    this._job(binding);
    return this.status({ id: binding.goal.id });
  }
  stop(value) {
    this._assertOpen();
    const goal = this.state.pause(value);
    // A claimed operation remains visible until settlement. Paused intent alone
    // does not prove that previously claimed work has already stopped.
    return this.status({ id: goal.id });
  }
  checkNow(value) {
    return this._track(async (signal) => {
      const binding = this._manualBinding(value);
      const job = this._job(binding);
      const payload = payloadFor(binding);
      const occurrence = this.store.enqueueOccurrenceOncePerTrigger({
        jobId: job.id,
        scheduledFor: epoch(this.clock()),
        triggerKey: `manual:${binding.requestId}`,
        payload,
      });
      if (digest(occurrence.payload) !== digest(payload))
        throw goalError("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
      const outcome = await this.runtime.runOccurrence(occurrence.id, {
        signal,
      });
      const result =
        outcome.status === "succeeded"
          ? this.state.readCheck(outcome.occurrence)
          : null;
      return {
        status: outcome.status,
        occurrenceId: occurrence.id,
        result,
        error: outcome.error ?? null,
      };
    });
  }
  tick({ signal } = {}) {
    return this._track((linked) => this._tick(linked), signal);
  }
  async _tick(signal) {
    const actor = this.getActor();
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      return { status: "waiting", reason: "identity-locked" };
    const incidents = [];
    let due = this.state.due(this.dueCursor);
    if (due.length === 0 && this.dueCursor) {
      this.dueCursor = null;
      due = this.state.due();
    }
    for (const row of due) {
      if (signal.aborted) break;
      this.dueCursor = { at: row.next_check_at, id: row.goal_id };
      try {
        const binding = this.state.binding(row.goal_id);
        if (!binding.blockedReason) {
          const job = this._job(binding);
          const authority = checkSchedulerAuthorityPolicy(
            this.store,
            job.authority,
            { checkBudget: true },
          );
          if (authority.allowed)
            this.store.enqueueOccurrenceOncePerTrigger({
              jobId: job.id,
              scheduledFor: binding.monitor.next_check_at,
              triggerKey: `timer:${binding.monitor.revision}:${binding.monitor.next_check_at}`,
              payload: payloadFor(binding),
            });
        }
        // Offline periods coalesce. Blocked goals advance without new work;
        // revoked rows use the cursor so they cannot starve later goals.
        this.state.advance(binding);
      } catch (error) {
        incidents.push({
          goalId: row.goal_id,
          code: error.code ?? "GOAL_MONITOR_FAILED",
        });
      }
    }
    const result = await this.runtime.runUntilIdle({
      limit: 50,
      signal,
      jobKind: KIND,
      workspaceId: actor,
    });
    return { ...result, incidents };
  }
  status(value) {
    this._assertOpen();
    input(value, ["id"]);
    const status = this.state.status(value.id);
    const active = this.store.listRuntimeControlOccurrences({
      jobKinds: [KIND],
      jobIdPrefix: jobPrefix(status.goal),
      statuses: ["running", "pause_requested"],
      limit: 20,
    });
    const job = status.monitor?.enabled
      ? this.store.getJob(jobId(status.goal, payloadFor(status)))
      : null;
    const authority = job
      ? checkSchedulerAuthorityPolicy(this.store, job.authority, {
          checkBudget: true,
        })
      : null;
    const blockedReason =
      status.blockedReason ??
      (authority && !authority.allowed ? authority.reason : null);
    return {
      ...status,
      blockedReason,
      executionState:
        active.length > 0
          ? status.goal.status === "active"
            ? "running"
            : "pause-requested"
          : status.goal.status === "paused"
            ? "paused"
            : blockedReason
              ? "blocked"
              : status.monitor?.enabled
                ? "waiting"
                : "idle",
      active,
    };
  }
  startBackground({ intervalMs = 5_000 } = {}) {
    this._assertOpen();
    if (!this.loop)
      this.loop = this.service.run({ intervalMs, signal: this.abort.signal });
    return this.loop;
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.abort.abort();
    this.closePromise = (async () => {
      await Promise.allSettled([
        ...this.inFlight,
        ...(this.loop ? [this.loop] : []),
      ]);
      try {
        await this.service.close();
      } finally {
        this.store.close();
      }
    })();
    return this.closePromise;
  }
}

module.exports = {
  ProjectGoalMonitoringState,
  ProjectGoalMonitoringEngine,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
};
