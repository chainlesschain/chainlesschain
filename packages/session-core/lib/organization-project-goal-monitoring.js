"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");
const { goalError, goalDefinitionDigest } = require("./goal-contract");
const {
  OrganizationProjectGoalService,
} = require("./organization-project-goal-service");
const { SchedulerRuntime } = require("./scheduler-runtime");
const {
  bindSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
  checkSchedulerAuthorityPolicy,
  parseSchedulerAuthorityPolicyReference,
} = require("./scheduler-authority-resolver");

const KIND = "organization-project-goal-risk";
const CAPABILITY = "organization.project.goal.check";
const REQUESTS = "cc_organization_project_goal_manual_requests";
const CHECKS = "cc_organization_project_goal_checks";
const MAX_BYTES = 16384;
function fail(code) {
  throw goalError(code);
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("GOAL_MONITOR_INVALID_REQUEST");
  return value;
}
function fields(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("GOAL_MONITOR_INVALID_REQUEST");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("GOAL_MONITOR_INVALID_REQUEST");
  return JSON.parse(JSON.stringify(value));
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    fail("GOAL_MONITOR_INVALID_CLOCK");
  return value;
}
function decode(row) {
  try {
    if (
      !row ||
      typeof row.record_json !== "string" ||
      Buffer.byteLength(row.record_json) > MAX_BYTES
    )
      throw new Error();
    const record = JSON.parse(row.record_json);
    if (digest(record) !== row.content_digest) throw new Error();
    return record;
  } catch {
    fail("GOAL_MONITOR_RECORD_CORRUPT");
  }
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
function payloadFor(request) {
  return {
    requestKey: request.id,
    storeId: request.storeId,
    goalId: request.goalId,
    actorDid: request.actorDid,
    requestId: request.requestId,
    goalRevision: request.goalRevision,
    controlGeneration: request.controlGeneration,
    definitionDigest: request.definitionDigest,
    authorityDigest: digest(request.authority),
    schedulerPolicyRevision: parseSchedulerAuthorityPolicyReference(
      request.schedulerAuthority.authorizationRefs.schedulerPolicyRevision,
    ),
  };
}
function jobId(request) {
  return `org-goal-risk-${digest([request.id, payloadFor(request)]).slice(7)}`;
}

/** Only manual occurrences. Uses the existing scheduler leases, authority policy
 * reservation and settlement. Native review + check usage commit atomically in
 * the project DB; scheduler settlement remains a recoverable projection. */
class OrganizationProjectGoalMonitoringEngine {
  constructor({
    db,
    getActor,
    authority,
    store,
    clock = Date.now,
    ownerId,
    leaseMs,
  } = {}) {
    if (
      typeof clock !== "function" ||
      !store ||
      typeof store.enqueueOccurrenceOncePerTrigger !== "function"
    )
      fail("GOAL_MONITOR_AUTHORITY_REQUIRED");
    Object.assign(this, { db, getActor, store, clock, ownerId, leaseMs });
    this.goals = new OrganizationProjectGoalService({
      db,
      getActor,
      authority,
      clock,
    });
    this.adapter = this.goals.adapter;
    this.risk = this.goals.risk;
    this.usage = this.goals.usage;
    this.state = {
      goals: this.goals,
      adapter: this.adapter,
      risk: this.risk,
      usageLedger: this.usage,
    };
    this.closed = false;
    this.abort = new AbortController();
    this.inFlight = new Set();
  }
  _open() {
    if (this.closed) fail("GOAL_MONITOR_HOST_CLOSED");
  }
  _tx(operation) {
    return this.adapter._transaction(operation);
  }
  _goal(goalId, actor) {
    const goal = this.adapter._read(id(goalId), actor);
    if (!goal) fail("GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _assertLive(goal, revision) {
    if (goal.revision !== revision) fail("GOAL_REVISION_CONFLICT");
    if (goal.status !== "active") fail("GOAL_MONITOR_NOT_ACTIVE");
    if (
      goal.expiresAt !== null &&
      epoch(this.clock()) >= Date.parse(goal.expiresAt)
    )
      fail("GOAL_MONITOR_EXPIRED");
    const project = this.adapter._project(
      goal.projectRef.id,
      this.adapter._actor(),
    );
    if (!["draft", "active"].includes(project.status))
      fail("GOAL_PROJECT_NOT_ACTIVE");
  }
  _checkPermissions(goal, actor, expectedAuthority) {
    let authority;
    for (const permission of [
      "goal.read",
      "goal.check",
      "risk.read",
      "risk.evaluate",
    ])
      authority = this.adapter._authorize(
        goal.projectRef.id,
        actor,
        permission,
        expectedAuthority,
      );
    return authority;
  }
  _requestByKey(requestKey) {
    const row = this.db
      .prepare(
        `SELECT id,goal_id,actor_did,request_id,request_digest,content_digest,
      CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_BYTES} THEN record_json ELSE NULL END AS record_json FROM ${REQUESTS} WHERE id=?`,
      )
      .get(id(requestKey));
    if (!row) return null;
    const record = decode(row);
    try {
      fields(record, [
        "schema",
        "id",
        "goalId",
        "storeId",
        "actorDid",
        "requestId",
        "inputDigest",
        "goalRevision",
        "controlGeneration",
        "definitionDigest",
        "authority",
        "schedulerAuthority",
        "createdAt",
      ]);
      if (
        record.schema !==
          "chainlesschain.organization-goal-manual-request/v1" ||
        record.id !== row.id ||
        record.goalId !== row.goal_id ||
        record.actorDid !== row.actor_did ||
        record.requestId !== row.request_id ||
        record.inputDigest !== row.request_digest ||
        !Number.isSafeInteger(record.goalRevision) ||
        record.goalRevision < 1 ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0 ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.definitionDigest) ||
        record.authority.scope.kind !== "organization" ||
        record.schedulerAuthority.principal.type !== "user" ||
        record.schedulerAuthority.principal.id !== record.actorDid ||
        record.schedulerAuthority.workspaceId !== record.authority.scope.id ||
        digest(record.schedulerAuthority.requestedCapabilities) !==
          digest([CAPABILITY]) ||
        parseSchedulerAuthorityPolicyReference(
          record.schedulerAuthority.authorizationRefs.schedulerPolicyRevision,
        ) === null
      )
        throw new Error();
      for (const key of ["id", "goalId", "storeId", "actorDid", "requestId"])
        id(record[key]);
      epoch(record.createdAt);
    } catch {
      fail("GOAL_MONITOR_RECORD_CORRUPT");
    }
    return record;
  }
  _checkRow(occurrenceId) {
    return this.db
      .prepare(
        `SELECT occurrence_id,goal_id,actor_did,request_id,elapsed_ms,content_digest,
      CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_BYTES} THEN record_json ELSE NULL END AS record_json FROM ${CHECKS} WHERE occurrence_id=?`,
      )
      .get(id(occurrenceId));
  }
  _checkByRequest(request) {
    const row = this.db
      .prepare(
        `SELECT occurrence_id FROM ${CHECKS} WHERE goal_id=? AND actor_did=? AND request_id=?`,
      )
      .get(request.goalId, request.actorDid, request.requestId);
    return row ? this._checkRow(row.occurrence_id) : null;
  }
  _validatedCheck(row, goal, actor, request = null) {
    this.adapter._authorize(goal.projectRef.id, actor, "risk.read");
    const record = decode(row);
    try {
      fields(record, [
        "schema",
        "occurrenceId",
        "requestKey",
        "goalId",
        "storeId",
        "actorDid",
        "requestId",
        "goalRevision",
        "controlGeneration",
        "requestDigest",
        "authority",
        "reviewId",
        "reviewDigest",
        "checkedAt",
        "elapsedMs",
        "result",
      ]);
      if (
        record.schema !== "chainlesschain.organization-goal-check/v1" ||
        record.occurrenceId !== row.occurrence_id ||
        record.goalId !== row.goal_id ||
        record.goalId !== goal.id ||
        record.storeId !== goal.storeId ||
        record.actorDid !== row.actor_did ||
        record.requestId !== row.request_id ||
        record.elapsedMs !== row.elapsed_ms ||
        !Number.isSafeInteger(record.elapsedMs) ||
        record.elapsedMs < 0 ||
        !Number.isSafeInteger(record.goalRevision) ||
        record.goalRevision < 1 ||
        record.goalRevision > goal.revision ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0 ||
        record.controlGeneration > goal.controlGeneration ||
        digest(record.authority.scope) !== digest(goal.projectRef.scope)
      )
        throw new Error();
      epoch(record.checkedAt);
      id(record.reviewId);
      id(record.requestKey);
      const original = this._requestByKey(record.requestKey);
      if (
        !original ||
        digest(original) !== record.requestDigest ||
        original.goalId !== goal.id ||
        original.actorDid !== record.actorDid ||
        original.requestId !== record.requestId ||
        original.goalRevision !== record.goalRevision ||
        original.controlGeneration !== record.controlGeneration ||
        digest(original.authority) !== digest(record.authority) ||
        (request && digest(original) !== digest(request))
      )
        throw new Error();
    } catch {
      fail("GOAL_MONITOR_CHECK_CORRUPT");
    }
    const review = this.risk.getReviewInTransaction({
      reviewId: record.reviewId,
    });
    if (
      review.review.actorDid !== record.actorDid ||
      review.review.projectId !== goal.projectRef.id ||
      digest(review) !== record.reviewDigest ||
      digest(resultFor(goal, review)) !== digest(record.result) ||
      Date.parse(review.review.createdAt) !== record.checkedAt
    )
      fail("GOAL_MONITOR_CHECK_CORRUPT");
    return record;
  }
  _view(record) {
    const {
      occurrenceId,
      goalId,
      actorDid,
      requestId,
      goalRevision,
      controlGeneration,
      reviewId,
      reviewDigest,
      checkedAt,
      elapsedMs,
      result,
    } = record;
    return {
      occurrenceId,
      goalId,
      actorDid,
      requestId,
      goalRevision,
      controlGeneration,
      reviewId,
      reviewDigest,
      checkedAt,
      elapsedMs,
      result,
    };
  }
  _prepare(value, actor) {
    return this._tx(() => {
      const goal = this._goal(value.id, actor);
      const priorRow = this.db
        .prepare(
          `SELECT id FROM ${REQUESTS} WHERE goal_id=? AND actor_did=? AND request_id=?`,
        )
        .get(goal.id, actor, value.requestId);
      if (priorRow) {
        const request = this._requestByKey(priorRow.id);
        if (request.inputDigest !== digest(value))
          fail("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
        const row = this._checkByRequest(request);
        if (row)
          return {
            goal,
            request,
            completed: this._validatedCheck(row, goal, actor, request),
          };
        this._fresh(request, goal, actor);
        return { goal, request, completed: null };
      }
      this._assertLive(goal, value.expectedRevision);
      const authority = this._checkPermissions(goal, actor);
      this.usage.assertAvailable(goal, actor);
      if (
        this.db
          .prepare(`SELECT count(*) AS n FROM ${REQUESTS} WHERE goal_id=?`)
          .get(goal.id).n >= 1000
      )
        fail("GOAL_MONITOR_REQUEST_LIMIT");
      const schedulerAuthority = bindSchedulerAuthorityPolicy(this.store, {
        schemaVersion: 1,
        principal: { type: "user", id: actor },
        workspaceId: authority.scope.id,
        requestedCapabilities: [CAPABILITY],
        authorizationRefs: { policyRevision: digest(authority) },
      });
      const request = {
        schema: "chainlesschain.organization-goal-manual-request/v1",
        id: `org-goal-request-${digest([goal.storeId, goal.id, actor, value.requestId]).slice(7)}`,
        goalId: goal.id,
        storeId: goal.storeId,
        actorDid: actor,
        requestId: value.requestId,
        inputDigest: digest(value),
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
        definitionDigest: goalDefinitionDigest(goal),
        authority,
        schedulerAuthority,
        createdAt: epoch(this.clock()),
      };
      this.db
        .prepare(`INSERT INTO ${REQUESTS} VALUES(?,?,?,?,?,?,?)`)
        .run(
          request.id,
          goal.id,
          actor,
          value.requestId,
          request.inputDigest,
          JSON.stringify(request),
          digest(request),
        );
      return { goal, request, completed: null };
    });
  }
  _fresh(request, goal, actor) {
    if (
      request.actorDid !== actor ||
      request.storeId !== goal.storeId ||
      request.goalId !== goal.id ||
      request.controlGeneration !== goal.controlGeneration ||
      request.definitionDigest !== goalDefinitionDigest(goal)
    )
      fail("GOAL_MONITOR_BINDING_STALE");
    this._assertLive(goal, request.goalRevision);
    this._checkPermissions(goal, actor, request.authority);
  }
  _job(request) {
    const key = jobId(request),
      old = this.store.getJob(key),
      payload = payloadFor(request);
    if (old) {
      if (
        old.kind !== KIND ||
        digest(old.authority) !== digest(request.schedulerAuthority) ||
        digest(old.payload) !== digest(payload)
      )
        fail("GOAL_MONITOR_JOB_MISMATCH");
      return old;
    }
    return this.store.createJob({
      id: key,
      kind: KIND,
      trigger: { type: "domain-intent" },
      payload,
      authority: request.schedulerAuthority,
      maxAttempts: 3,
    });
  }
  _context(context, actor) {
    const request = this._requestByKey(context.occurrence.payload.requestKey);
    if (
      !request ||
      request.actorDid !== actor ||
      context.job.kind !== KIND ||
      context.job.id !== jobId(request) ||
      context.occurrence.jobId !== context.job.id ||
      context.occurrence.jobRevision !== context.job.revision ||
      digest(context.occurrence.payload) !== digest(payloadFor(request)) ||
      digest(context.job.payload) !== digest(payloadFor(request)) ||
      digest(context.occurrence.authority) !==
        digest(request.schedulerAuthority) ||
      digest(context.job.authority) !== digest(request.schedulerAuthority)
    )
      fail("GOAL_MONITOR_AUTHORITY_MISMATCH");
    return request;
  }
  _runtime(actor, guard) {
    const authorize = (context) =>
      this._tx(() => {
        guard();
        const request = this._context(context, actor),
          goal = this._goal(request.goalId, actor),
          prior = this._checkRow(context.occurrence.id);
        if (prior) this._validatedCheck(prior, goal, actor, request);
        else {
          this._fresh(request, goal, actor);
          this.usage.assertAvailable(goal, actor);
        }
        guard();
        return { allowed: true };
      });
    return new SchedulerRuntime({
      store: this.store,
      ownerId: this.ownerId,
      leaseMs: this.leaseMs,
      graphAuthorityMode: "legacy",
      authorize: createSchedulerAuthorityResolver({
        store: this.store,
        validate: authorize,
      }),
      adapters: [
        {
          kind: KIND,
          runtimeControl: {
            schemaVersion: 1,
            pauseResume: "checkpoint_v1",
            safePoints: ["before_execute"],
          },
          classifyError: () => ({ retryable: false }),
          execute: (context) =>
            this._tx(() => {
              const renew = () => {
                guard();
                context.renewLease();
                if (context.signal.aborted) fail("GOAL_MONITOR_ABORTED");
                const policy = checkSchedulerAuthorityPolicy(
                  this.store,
                  context.occurrence.authority,
                );
                if (
                  !policy.allowed ||
                  policy.policyRevision !== context.decision.policyRevision
                )
                  fail("GOAL_MONITOR_AUTHORITY_CHANGED");
              };
              renew();
              const request = this._context(context, actor),
                goal = this._goal(request.goalId, actor),
                prior = this._checkRow(context.occurrence.id);
              if (prior)
                return this._validatedCheck(prior, goal, actor, request).result;
              this._fresh(request, goal, actor);
              const usage = this.usage.assertAvailable(goal, actor),
                started = epoch(this.clock());
              const review = this.risk.evaluateInTransaction({
                projectId: goal.projectRef.id,
              });
              renew();
              this._fresh(request, goal, actor);
              const finished = epoch(this.clock()),
                elapsedMs = finished - started;
              if (elapsedMs < 0) fail("GOAL_CLOCK_MOVED_BACKWARDS");
              if (
                goal.budgetPolicy.maxTimeMs !== null &&
                usage.knownElapsedMs + usage.reservedElapsedMs + elapsedMs >
                  goal.budgetPolicy.maxTimeMs
              )
                fail("GOAL_MONITOR_BUDGET_EXHAUSTED");
              const result = resultFor(goal, review);
              const record = {
                schema: "chainlesschain.organization-goal-check/v1",
                occurrenceId: context.occurrence.id,
                requestKey: request.id,
                goalId: goal.id,
                storeId: goal.storeId,
                actorDid: actor,
                requestId: request.requestId,
                goalRevision: goal.revision,
                controlGeneration: goal.controlGeneration,
                requestDigest: digest(request),
                authority: request.authority,
                reviewId: review.review.id,
                reviewDigest: digest(review),
                checkedAt: Date.parse(review.review.createdAt),
                elapsedMs,
                result,
              };
              if (Buffer.byteLength(JSON.stringify(record)) > MAX_BYTES)
                fail("GOAL_MONITOR_RECORD_CORRUPT");
              this.db
                .prepare(`INSERT INTO ${CHECKS} VALUES(?,?,?,?,?,?,?)`)
                .run(
                  record.occurrenceId,
                  goal.id,
                  actor,
                  request.requestId,
                  JSON.stringify(record),
                  digest(record),
                  elapsedMs,
                );
              renew();
              this._fresh(request, goal, actor);
              return result;
            }),
        },
      ],
    });
  }
  checkNow(input, { guard: callerGuard } = {}) {
    this._open();
    const value = fields(input, ["id", "expectedRevision", "requestId"]);
    id(value.id);
    id(value.requestId);
    if (
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 1 ||
      (callerGuard !== undefined && typeof callerGuard !== "function")
    )
      fail("GOAL_MONITOR_INVALID_REQUEST");
    const actor = this.adapter._actor();
    const guard = () => {
      this._open();
      if (this.adapter._actor() !== actor) fail("GOAL_IDENTITY_CHANGED");
      if (callerGuard) {
        const value = callerGuard();
        if (value && typeof value.then === "function")
          fail("GOAL_MONITOR_INVALID_GUARD");
        if (value !== undefined && value !== actor)
          fail("GOAL_IDENTITY_CHANGED");
      }
    };
    guard();
    const operation = Promise.resolve().then(async () => {
      guard();
      const prepared = this._prepare(value, actor);
      if (prepared.completed) {
        guard();
        return {
          status: "succeeded",
          occurrenceId: prepared.completed.occurrenceId,
          result: prepared.completed.result,
          error: null,
          replayed: true,
        };
      }
      const job = this._job(prepared.request),
        payload = payloadFor(prepared.request);
      const occurrence = this.store.enqueueOccurrenceOncePerTrigger({
        jobId: job.id,
        scheduledFor: epoch(this.clock()),
        triggerKey: `manual:${prepared.request.requestId}`,
        payload,
      });
      if (digest(occurrence.payload) !== digest(payload))
        fail("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
      guard();
      const outcome = await this._runtime(actor, guard).runOccurrence(
        occurrence.id,
        { signal: this.abort.signal },
      );
      guard();
      const completed = this._tx(() => {
        const goal = this._goal(value.id, actor),
          row = this._checkByRequest(prepared.request);
        return row
          ? this._validatedCheck(row, goal, actor, prepared.request)
          : null;
      });
      return {
        status: completed ? "succeeded" : outcome.status,
        occurrenceId: occurrence.id,
        result: completed?.result ?? null,
        error: completed ? null : (outcome.error ?? null),
        replayed: false,
      };
    });
    this.inFlight.add(operation);
    operation.then(
      () => this.inFlight.delete(operation),
      () => this.inFlight.delete(operation),
    );
    return operation;
  }
  status(input) {
    this._open();
    const value = fields(input, ["id"]);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(value.id, actor);
      return { goal, usage: this.usage.summary(goal, actor), manualOnly: true };
    });
  }
  getCheck(input) {
    this._open();
    const value = fields(input, ["id", "occurrenceId"]);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(value.id, actor);
      this.adapter._authorize(goal.projectRef.id, actor, "risk.read");
      const row = this._checkRow(value.occurrenceId);
      if (!row || row.goal_id !== goal.id) fail("GOAL_NOT_FOUND_OR_DENIED");
      return this._view(this._validatedCheck(row, goal, actor));
    });
  }
  history(input) {
    this._open();
    const value = fields(input, ["id"], ["beforeId", "limit"]),
      limit = value.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("GOAL_INVALID_LIMIT");
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(value.id, actor);
      this.adapter._authorize(goal.projectRef.id, actor, "risk.read");
      let cursor;
      if (value.beforeId !== undefined) {
        cursor = this.db
          .prepare(
            `SELECT rowid FROM ${CHECKS} WHERE occurrence_id=? AND goal_id=?`,
          )
          .get(id(value.beforeId), goal.id);
        if (!cursor) fail("GOAL_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          `SELECT occurrence_id FROM ${CHECKS} WHERE goal_id=? ${cursor ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(goal.id, ...(cursor ? [cursor.rowid] : []), limit + 1);
      const checks = rows
        .slice(0, limit)
        .map((row) =>
          this._view(
            this._validatedCheck(
              this._checkRow(row.occurrence_id),
              goal,
              actor,
            ),
          ),
        );
      return {
        checks,
        nextCursor: rows.length > limit ? checks.at(-1).occurrenceId : null,
      };
    });
  }
  close() {
    if (!this.closePromise) {
      this.closed = true;
      this.abort.abort();
      this.closePromise = Promise.allSettled([...this.inFlight]).then(
        () => undefined,
      );
    }
    return this.closePromise;
  }
}

module.exports = {
  OrganizationProjectGoalMonitoringEngine,
  ORGANIZATION_GOAL_MONITOR_KIND: KIND,
  ORGANIZATION_GOAL_MONITOR_CAPABILITY: CAPABILITY,
};
