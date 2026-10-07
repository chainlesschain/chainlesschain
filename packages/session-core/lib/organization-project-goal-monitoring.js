"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");
const { goalError, goalDefinitionDigest } = require("./goal-contract");
const {
  OrganizationProjectGoalService,
} = require("./organization-project-goal-service");
const {
  OrganizationProjectGoalWorkflow,
} = require("./organization-project-goal-workflow");
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
const CONSENTS = "cc_organization_project_goal_monitor_consents";
const STATES = "cc_organization_project_goal_monitor_states";
const STOPS = "cc_organization_project_goal_monitor_stops";
const PERIODIC_PREFIX = "org-periodic:";
const DAY_MS = 86400000;
const MAX_BYTES = 16384;
function consentAuthority(authority) {
  const { projectSourceRevision, ...fixed } = authority;
  return fixed;
}
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

/** Manual and consent-bound periodic occurrences use existing scheduler leases, authority policy
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
    getAuthenticationGeneration,
  } = {}) {
    if (
      typeof clock !== "function" ||
      !store ||
      typeof store.enqueueOccurrenceOncePerTrigger !== "function"
    )
      fail("GOAL_MONITOR_AUTHORITY_REQUIRED");
    if (
      getAuthenticationGeneration !== undefined &&
      typeof getAuthenticationGeneration !== "function"
    )
      fail("GOAL_MONITOR_AUTHORITY_REQUIRED");
    Object.assign(this, {
      db,
      getActor,
      store,
      clock,
      ownerId,
      leaseMs,
      getAuthenticationGeneration,
    });
    this.goals = new OrganizationProjectGoalService({
      db,
      getActor,
      authority,
      clock,
    });
    this.adapter = this.goals.adapter;
    this.risk = this.goals.risk;
    this.usage = this.goals.usage;
    this.workflow = new OrganizationProjectGoalWorkflow({
      db,
      getActor,
      authority,
      clock,
      goals: this.goals,
      risk: this.risk,
      usage: this.usage,
    });
    this.state = {
      goals: this.goals,
      adapter: this.adapter,
      risk: this.risk,
      usageLedger: this.usage,
      workflow: this.workflow,
    };
    this.closed = false;
    this.abort = new AbortController();
    this.inFlight = new Set();
    this.monitorAborts = new Map();
    this.backgroundTimer = null;
    this.tickPromise = null;
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
  _monitorPermissions(goal, actor, expectedAuthority) {
    this._checkPermissions(goal, actor, expectedAuthority);
    return this.adapter._authorize(
      goal.projectRef.id,
      actor,
      "goal.monitor",
      expectedAuthority,
    );
  }
  _consent(monitorId) {
    const row = this.db
      .prepare(`SELECT * FROM ${CONSENTS} WHERE id=?`)
      .get(id(monitorId));
    if (!row) fail("GOAL_MONITOR_RECORD_CORRUPT");
    const record = decode(row);
    try {
      fields(record, [
        "schema",
        "id",
        "goalId",
        "storeId",
        "executorDid",
        "requestId",
        "inputDigest",
        "goalRevision",
        "controlGeneration",
        "definitionDigest",
        "authority",
        "schedulerAuthority",
        "createdAt",
        "expiresAt",
        "intervalMs",
        "generation",
        "resumeSameIdentity",
      ]);
      if (
        record.schema !==
          "chainlesschain.organization-goal-monitor-consent/v1" ||
        record.id !== row.id ||
        record.goalId !== row.goal_id ||
        record.executorDid !== row.actor_did ||
        record.requestId !== row.request_id ||
        record.resumeSameIdentity !== true ||
        !Number.isSafeInteger(record.generation) ||
        record.generation < 1 ||
        !Number.isSafeInteger(record.intervalMs) ||
        record.intervalMs < 60000 ||
        record.intervalMs > DAY_MS ||
        record.expiresAt <= record.createdAt ||
        record.expiresAt > record.createdAt + DAY_MS
      )
        throw new Error();
      epoch(record.createdAt);
      epoch(record.expiresAt);
    } catch {
      fail("GOAL_MONITOR_RECORD_CORRUPT");
    }
    return record;
  }
  _monitorState(goalId) {
    const row = this.db
      .prepare(`SELECT * FROM ${STATES} WHERE goal_id=?`)
      .get(id(goalId));
    if (!row) return null;
    const state = decode(row),
      consent = this._consent(row.monitor_id);
    try {
      fields(state, [
        "goalId",
        "monitorId",
        "generation",
        "status",
        "stopMode",
        "nextCheckAt",
        "pendingRequestId",
        "pendingSlot",
        "blockedReason",
        "updatedAt",
      ]);
      if (
        state.goalId !== row.goal_id ||
        state.monitorId !== row.monitor_id ||
        consent.goalId !== state.goalId ||
        consent.generation !== state.generation ||
        !["enabled", "stopped", "blocked", "expired"].includes(state.status) ||
        ![null, "periodic", "abort"].includes(state.stopMode) ||
        (state.pendingRequestId === null) !== (state.pendingSlot === null)
      )
        throw new Error();
      epoch(state.nextCheckAt);
      epoch(state.updatedAt);
      if (state.pendingRequestId !== null) {
        epoch(state.pendingSlot);
        if (
          state.pendingRequestId !==
          this._periodicRequestId(consent, state.pendingSlot)
        )
          throw new Error();
      }
    } catch {
      fail("GOAL_MONITOR_RECORD_CORRUPT");
    }
    return { consent, state };
  }
  _saveMonitor(state) {
    this.db
      .prepare(
        `INSERT INTO ${STATES} VALUES(?,?,?,?) ON CONFLICT(goal_id) DO UPDATE SET monitor_id=excluded.monitor_id,record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(state.goalId, state.monitorId, JSON.stringify(state), digest(state));
  }
  _monitorView(pair) {
    if (!pair) return null;
    const { consent, state } = pair;
    let activeOccurrence = null;
    if (state.pendingRequestId !== null) {
      const row = this.db
        .prepare(
          `SELECT id FROM ${REQUESTS} WHERE goal_id=? AND actor_did=? AND request_id=?`,
        )
        .get(consent.goalId, consent.executorDid, state.pendingRequestId);
      const request = row ? this._requestByKey(row.id) : null;
      const occurrence = request
        ? this.store.listOccurrencesByTrigger({
            jobId: jobId(request),
            triggerKey: `manual:${request.requestId}`,
            limit: 1,
          })[0]
        : null;
      activeOccurrence = {
        requestId: state.pendingRequestId,
        occurrenceId: occurrence?.id ?? null,
        status: occurrence?.status ?? "pending",
      };
    }
    return {
      id: consent.id,
      monitorId: consent.id,
      goalId: consent.goalId,
      scope: consent.authority.scope,
      executorDid: consent.executorDid,
      intervalMs: consent.intervalMs,
      expiresAt: consent.expiresAt,
      enabled: state.status === "enabled",
      goalRevision: consent.goalRevision,
      generation: consent.generation,
      state:
        state.status === "enabled"
          ? activeOccurrence
            ? "running"
            : "waiting"
          : state.status,
      blockedReason: state.blockedReason,
      nextCheckAt: state.nextCheckAt,
      activeOccurrence,
      resumeSameIdentity: true,
    };
  }
  _periodicRequestId(consent, slot) {
    return `${PERIODIC_PREFIX}${digest([consent.id, slot]).slice(7)}`;
  }
  _assertConsent(pair, goal, actor, { admitted = false } = {}) {
    const { consent, state } = pair;
    if (
      consent.executorDid !== actor ||
      consent.storeId !== goal.storeId ||
      consent.goalId !== goal.id ||
      consent.controlGeneration !== goal.controlGeneration ||
      consent.definitionDigest !== goalDefinitionDigest(goal) ||
      !(
        state.status === "enabled" ||
        (admitted &&
          state.status === "stopped" &&
          state.stopMode === "periodic")
      )
    )
      fail("GOAL_MONITOR_CONSENT_STALE");
    this._assertLive(goal, consent.goalRevision);
    if (epoch(this.clock()) >= consent.expiresAt)
      fail("GOAL_MONITOR_CONSENT_EXPIRED");
    const authority = this._monitorPermissions(goal, actor);
    if (
      digest(consentAuthority(authority)) !==
      digest(consentAuthority(consent.authority))
    )
      fail("GOAL_MONITOR_CONSENT_STALE");
    const policy = checkSchedulerAuthorityPolicy(
      this.store,
      consent.schedulerAuthority,
    );
    if (!policy.allowed) fail("GOAL_MONITOR_AUTHORITY_CHANGED");
    return authority;
  }
  _startInput(input) {
    const value = fields(input, [
      "id",
      "expectedRevision",
      "requestId",
      "intervalMs",
      "expiresAt",
    ]);
    id(value.id);
    id(value.requestId);
    if (
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 1 ||
      !Number.isSafeInteger(value.intervalMs) ||
      value.intervalMs < 60000 ||
      value.intervalMs > DAY_MS
    )
      fail("GOAL_MONITOR_INVALID_REQUEST");
    epoch(value.expiresAt);
    return value;
  }
  _prepareStart(value, actor) {
    const goal = this._goal(value.id, actor);
    const prior = this.db
      .prepare(`SELECT id FROM ${CONSENTS} WHERE actor_did=? AND request_id=?`)
      .get(actor, value.requestId);
    if (prior) {
      const consent = this._consent(prior.id);
      if (consent.inputDigest !== digest(value))
        fail("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
      const current = this._monitorState(goal.id);
      return {
        goal,
        actorDid: actor,
        authority: this.adapter._authorize(goal.projectRef.id, actor),
        requestDigest: digest(value),
        expectedMonitorId: current?.consent.id ?? null,
        monitor:
          current?.consent.id === consent.id
            ? this._monitorView(current)
            : {
                id: consent.id,
                monitorId: consent.id,
                goalId: consent.goalId,
                scope: consent.authority.scope,
                executorDid: actor,
                intervalMs: consent.intervalMs,
                expiresAt: consent.expiresAt,
                enabled: false,
                goalRevision: consent.goalRevision,
                generation: consent.generation,
                state: "replaced",
                blockedReason: null,
                nextCheckAt: null,
                activeOccurrence: null,
                resumeSameIdentity: true,
              },
        replayed: true,
      };
    }
    this._assertLive(goal, value.expectedRevision);
    const authority = this._monitorPermissions(goal, actor);
    this.usage.assertAvailable(goal, actor);
    const now = epoch(this.clock());
    if (
      value.expiresAt <= now ||
      value.expiresAt > now + DAY_MS ||
      (goal.expiresAt !== null && value.expiresAt > Date.parse(goal.expiresAt))
    )
      fail("GOAL_MONITOR_INVALID_EXPIRY");
    if (
      this.db
        .prepare(`SELECT count(*) AS n FROM ${CONSENTS} WHERE goal_id=?`)
        .get(goal.id).n >= 1000
    )
      fail("GOAL_MONITOR_REQUEST_LIMIT");
    const current = this._monitorState(goal.id);
    const consent = {
      schema: "chainlesschain.organization-goal-monitor-consent/v1",
      id: `org-goal-monitor-${digest([goal.storeId, actor, value.requestId]).slice(7)}`,
      goalId: goal.id,
      storeId: goal.storeId,
      executorDid: actor,
      requestId: value.requestId,
      inputDigest: digest(value),
      goalRevision: goal.revision,
      controlGeneration: goal.controlGeneration,
      definitionDigest: goalDefinitionDigest(goal),
      authority,
      schedulerAuthority: bindSchedulerAuthorityPolicy(this.store, {
        schemaVersion: 1,
        principal: { type: "user", id: actor },
        workspaceId: authority.scope.id,
        requestedCapabilities: [CAPABILITY],
        authorizationRefs: {
          policyRevision: digest(consentAuthority(authority)),
        },
      }),
      createdAt: now,
      expiresAt: value.expiresAt,
      intervalMs: value.intervalMs,
      generation: (current?.state.generation ?? 0) + 1,
      resumeSameIdentity: true,
    };
    const state = {
      goalId: goal.id,
      monitorId: consent.id,
      generation: consent.generation,
      status: "enabled",
      stopMode: null,
      nextCheckAt: now + value.intervalMs,
      pendingRequestId: null,
      pendingSlot: null,
      blockedReason: null,
      updatedAt: now,
    };
    return {
      goal,
      actorDid: actor,
      authority,
      requestDigest: digest(value),
      expectedMonitorId: current?.consent.id ?? null,
      monitor: this._monitorView({ consent, state }),
      replayed: false,
      consent,
      state,
    };
  }
  prepareStartMonitoring(input) {
    this._open();
    const value = this._startInput(input);
    return this._tx(() => {
      const { consent, state, ...prepared } = this._prepareStart(
        value,
        this.adapter._actor(),
      );
      return prepared;
    });
  }
  startMonitoring(input, { expectedAuthority, expectedMonitorId, guard } = {}) {
    this._open();
    const value = this._startInput(input),
      actor = this.adapter._actor();
    const check = this._guard(actor, guard);
    return this._tx(() => {
      check();
      const prepared = this._prepareStart(value, actor);
      if (prepared.replayed)
        return { monitor: prepared.monitor, replayed: true };
      if (!expectedAuthority) fail("GOAL_MONITOR_AUTHORITY_REQUIRED");
      if (expectedMonitorId !== prepared.expectedMonitorId)
        fail("GOAL_MONITOR_VERSION_CONFLICT");
      this._monitorPermissions(prepared.goal, actor, expectedAuthority);
      this.db
        .prepare(`INSERT INTO ${CONSENTS} VALUES(?,?,?,?,?,?)`)
        .run(
          prepared.consent.id,
          prepared.goal.id,
          actor,
          value.requestId,
          JSON.stringify(prepared.consent),
          digest(prepared.consent),
        );
      this._saveMonitor(prepared.state);
      check();
      return { monitor: prepared.monitor, replayed: false };
    });
  }
  _stopInput(input) {
    const value = fields(input, ["id", "monitorId", "requestId", "mode"]);
    for (const key of ["id", "monitorId", "requestId"]) id(value[key]);
    if (!["periodic", "abort"].includes(value.mode))
      fail("GOAL_MONITOR_INVALID_REQUEST");
    return value;
  }
  _prepareStop(value, actor) {
    const goal = this._goal(value.id, actor);
    const row = this.db
      .prepare(`SELECT * FROM ${STOPS} WHERE actor_did=? AND request_id=?`)
      .get(actor, value.requestId);
    if (row) {
      const receipt = decode(row);
      if (
        receipt.actorDid !== actor ||
        receipt.requestId !== value.requestId ||
        receipt.goalId !== goal.id ||
        receipt.id !== row.id
      )
        fail("GOAL_MONITOR_RECORD_CORRUPT");
      if (receipt.inputDigest !== digest(value))
        fail("GOAL_MONITOR_REQUEST_VERSION_CONFLICT");
      return {
        goal,
        actorDid: actor,
        authority: this.adapter._authorize(goal.projectRef.id, actor),
        requestDigest: digest(value),
        monitor: receipt.monitor,
        replayed: true,
      };
    }
    const authority = this.adapter._authorize(
        goal.projectRef.id,
        actor,
        "goal.monitor",
      ),
      pair = this._monitorState(goal.id);
    if (!pair || pair.consent.id !== value.monitorId)
      fail("GOAL_MONITOR_VERSION_CONFLICT");
    return {
      goal,
      actorDid: actor,
      authority,
      requestDigest: digest(value),
      monitor: this._monitorView(pair),
      pair,
      replayed: false,
    };
  }
  prepareStopMonitoring(input) {
    this._open();
    const value = this._stopInput(input);
    return this._tx(() => {
      const { pair, ...prepared } = this._prepareStop(
        value,
        this.adapter._actor(),
      );
      return prepared;
    });
  }
  stopMonitoring(input, { expectedAuthority, guard } = {}) {
    this._open();
    const value = this._stopInput(input),
      actor = this.adapter._actor(),
      check = this._guard(actor, guard);
    const result = this._tx(() => {
      check();
      const prepared = this._prepareStop(value, actor);
      if (prepared.replayed)
        return { monitor: prepared.monitor, replayed: true };
      if (!expectedAuthority) fail("GOAL_MONITOR_AUTHORITY_REQUIRED");
      this.adapter._authorize(
        prepared.goal.projectRef.id,
        actor,
        "goal.monitor",
        expectedAuthority,
      );
      const { state, consent } = prepared.pair;
      state.status = "stopped";
      // An old graceful stop cannot weaken an already durable abort.
      if (state.stopMode !== "abort") state.stopMode = value.mode;
      state.updatedAt = epoch(this.clock());
      this._saveMonitor(state);
      const monitor = this._monitorView({ consent, state });
      const receipt = {
        id: `org-goal-monitor-stop-${digest([actor, value.requestId]).slice(7)}`,
        goalId: prepared.goal.id,
        actorDid: actor,
        requestId: value.requestId,
        inputDigest: digest(value),
        authority: expectedAuthority,
        monitor,
      };
      this.db
        .prepare(`INSERT INTO ${STOPS} VALUES(?,?,?,?,?)`)
        .run(
          receipt.id,
          actor,
          value.requestId,
          JSON.stringify(receipt),
          digest(receipt),
        );
      check();
      return { monitor, replayed: false };
    });
    if (!result.replayed && value.mode === "abort")
      this.monitorAborts.get(value.monitorId)?.abort();
    return result;
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
      fields(
        record,
        [
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
        ],
        ["monitorId", "monitorSlot"],
      );
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
      if (record.monitorId !== undefined) {
        const consent = this._consent(record.monitorId);
        epoch(record.monitorSlot);
        if (
          record.requestId !==
            this._periodicRequestId(consent, record.monitorSlot) ||
          record.actorDid !== consent.executorDid ||
          record.goalId !== consent.goalId ||
          record.goalRevision !== consent.goalRevision ||
          record.controlGeneration !== consent.controlGeneration ||
          record.definitionDigest !== consent.definitionDigest ||
          digest(consentAuthority(record.authority)) !==
            digest(consentAuthority(consent.authority))
        )
          throw new Error();
      } else if (
        record.requestId.startsWith(PERIODIC_PREFIX) ||
        record.monitorSlot !== undefined
      )
        throw new Error();
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
  _prepare(value, actor, monitorContext = null) {
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
        if ((request.monitorId ?? null) !== (monitorContext?.monitorId ?? null))
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
      if (monitorContext) {
        const pair = this._monitorState(goal.id);
        if (
          !pair ||
          pair.consent.id !== monitorContext.monitorId ||
          pair.state.pendingRequestId !== value.requestId ||
          pair.state.pendingSlot !== monitorContext.monitorSlot
        )
          fail("GOAL_MONITOR_CONSENT_STALE");
        this._assertConsent(pair, goal, actor, { admitted: true });
      }
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
        ...(monitorContext ?? {}),
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
    if (request.monitorId !== undefined) {
      const pair = this._monitorState(goal.id);
      if (
        !pair ||
        pair.consent.id !== request.monitorId ||
        pair.state.pendingRequestId !== request.requestId ||
        pair.state.pendingSlot !== request.monitorSlot
      )
        fail("GOAL_MONITOR_CONSENT_STALE");
      this._assertConsent(pair, goal, actor, { admitted: true });
    }
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
        validate: (context) => {
          try {
            return authorize(context);
          } catch (error) {
            // A durable consent/revision/permission rejection is definitive.
            // Keep transient session or storage loss retryable for recovery.
            if (
              /^(GOAL_|ORG_AUTH_)/u.test(error?.code ?? "") &&
              !/IDENTITY|SESSION|LOCKED|UNAVAILABLE|STORAGE|HOST_CLOSED/u.test(
                error.code,
              )
            )
              return { allowed: false, reason: error.code };
            throw error;
          }
        },
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
              this.workflow.observeInTransaction({
                goalId: goal.id,
                reviewId: review.review.id,
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
  _guard(actor, callerGuard) {
    if (callerGuard !== undefined && typeof callerGuard !== "function")
      fail("GOAL_MONITOR_INVALID_GUARD");
    const generation = this.getAuthenticationGeneration?.();
    const guard = () => {
      this._open();
      if (this.adapter._actor() !== actor) fail("GOAL_IDENTITY_CHANGED");
      if (
        this.getAuthenticationGeneration &&
        this.getAuthenticationGeneration() !== generation
      )
        fail("GOAL_IDENTITY_CHANGED");
      if (callerGuard) {
        const value = callerGuard();
        if (value && typeof value.then === "function")
          fail("GOAL_MONITOR_INVALID_GUARD");
        if (value !== undefined && value !== actor)
          fail("GOAL_IDENTITY_CHANGED");
      }
    };
    guard();
    return guard;
  }
  checkNow(input, options = {}) {
    if (
      typeof input?.requestId === "string" &&
      input.requestId.startsWith(PERIODIC_PREFIX)
    )
      fail("GOAL_MONITOR_INVALID_REQUEST");
    return this._checkNow(input, options);
  }
  _checkNow(input, { guard: callerGuard } = {}, monitorContext = null) {
    this._open();
    const value = fields(input, ["id", "expectedRevision", "requestId"]);
    id(value.id);
    id(value.requestId);
    if (
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 1
    )
      fail("GOAL_MONITOR_INVALID_REQUEST");
    const actor = this.adapter._actor(),
      guard = this._guard(actor, callerGuard);
    const operation = Promise.resolve().then(async () => {
      guard();
      const prepared = this._prepare(value, actor, monitorContext);
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
        {
          signal: monitorContext
            ? AbortSignal.any([
                this.abort.signal,
                this._monitorAbort(monitorContext.monitorId).signal,
              ])
            : this.abort.signal,
        },
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
  _monitorAbort(monitorId) {
    if (!this.monitorAborts.has(monitorId))
      this.monitorAborts.set(monitorId, new AbortController());
    return this.monitorAborts.get(monitorId);
  }
  _blockMonitor(goalId, monitorId, reason) {
    return this._tx(() => {
      const pair = this._monitorState(goalId);
      if (
        !pair ||
        pair.consent.id !== monitorId ||
        !["enabled", "stopped"].includes(pair.state.status) ||
        (pair.state.status === "stopped" && pair.state.stopMode === "abort")
      )
        return;
      pair.state.status =
        reason === "GOAL_MONITOR_CONSENT_EXPIRED" ? "expired" : "blocked";
      pair.state.blockedReason = reason;
      pair.state.updatedAt = epoch(this.clock());
      this._saveMonitor(pair.state);
    });
  }
  async _reconcileStopped(pair, actor, guard) {
    const { consent, state } = pair;
    const row = this.db
      .prepare(
        `SELECT id FROM ${REQUESTS} WHERE goal_id=? AND actor_did=? AND request_id=?`,
      )
      .get(consent.goalId, actor, state.pendingRequestId);
    if (!row) fail("GOAL_MONITOR_RECORD_CORRUPT");
    const request = this._requestByKey(row.id);
    const occurrence = this.store.listOccurrencesByTrigger({
      jobId: jobId(request),
      triggerKey: `manual:${request.requestId}`,
      limit: 1,
    })[0];
    // No new job or domain request is created while reconciling a hard stop.
    // Existing claimed work settles normally, or is denied after its lease
    // expires because the durable stop is checked by the scheduler adapter.
    let settled = !occurrence;
    if (occurrence) {
      const outcome = await this._runtime(actor, guard).runOccurrence(
        occurrence.id,
        { signal: this.abort.signal },
      );
      settled = !["busy", "paused", "retry_wait", "aborted"].includes(
        outcome.status,
      );
    }
    guard();
    if (settled)
      this._tx(() => {
        const current = this._monitorState(consent.goalId);
        if (
          current?.consent.id !== consent.id ||
          current.state.status !== "stopped" ||
          current.state.stopMode !== "abort" ||
          current.state.pendingRequestId !== state.pendingRequestId
        )
          return;
        current.state.pendingRequestId = null;
        current.state.pendingSlot = null;
        current.state.updatedAt = epoch(this.clock());
        this._saveMonitor(current.state);
      });
  }
  tick({ guard: callerGuard } = {}) {
    this._open();
    if (this.tickPromise) return this.tickPromise;
    const operation = this._tick(callerGuard);
    this.tickPromise = operation;
    this.inFlight.add(operation);
    operation.then(
      () => {
        this.tickPromise = null;
        this.inFlight.delete(operation);
      },
      () => {
        this.tickPromise = null;
        this.inFlight.delete(operation);
      },
    );
    return operation;
  }
  async _tick(callerGuard) {
    const results = { checks: [], blocked: [], suspended: false };
    let actor, guard;
    try {
      actor = this.adapter._actor();
      guard = this._guard(actor, callerGuard);
    } catch (error) {
      if (
        /IDENTITY|SESSION|LOCKED|AUTHORITY_UNAVAILABLE/u.test(error?.code ?? "")
      )
        return { ...results, suspended: true };
      throw error;
    }
    // Discovery uses trusted local metadata only. Domain access is still checked
    // for the executor on every dispatch and on every scheduler safe point.
    const rows = this.db
      .prepare(
        `SELECT goal_id,monitor_id FROM ${STATES} ORDER BY goal_id LIMIT 1001`,
      )
      .all();
    if (rows.length > 1000) fail("GOAL_MONITOR_REQUEST_LIMIT");
    for (const row of rows) {
      let prepared;
      try {
        guard();
        const stopped = this._tx(() => this._monitorState(row.goal_id));
        if (
          stopped?.consent.executorDid === actor &&
          stopped.state.status === "stopped" &&
          stopped.state.stopMode === "abort" &&
          stopped.state.pendingRequestId !== null
        ) {
          await this._reconcileStopped(stopped, actor, guard);
          continue;
        }
        prepared = this._tx(() => {
          const pair = this._monitorState(row.goal_id);
          if (
            !pair ||
            pair.consent.executorDid !== actor ||
            !(
              pair.state.status === "enabled" ||
              (pair.state.status === "stopped" &&
                pair.state.stopMode === "periodic" &&
                pair.state.pendingRequestId !== null)
            )
          )
            return null;
          const goal = this._goal(row.goal_id, actor),
            { consent, state } = pair;
          // A committed domain result is authoritative even if a later source
          // update makes the unfinished scheduler projection stale.
          let completed = false;
          if (state.pendingRequestId !== null) {
            const requestRow = this.db
              .prepare(
                `SELECT id FROM ${REQUESTS} WHERE goal_id=? AND actor_did=? AND request_id=?`,
              )
              .get(goal.id, actor, state.pendingRequestId);
            const request = requestRow
              ? this._requestByKey(requestRow.id)
              : null;
            completed = !!(request && this._checkByRequest(request));
          }
          if (!completed)
            this._assertConsent(pair, goal, actor, {
              admitted: state.pendingRequestId !== null,
            });
          const now = epoch(this.clock());
          if (state.pendingRequestId === null) {
            this.usage.assertAvailable(goal, actor);
            if (now < state.nextCheckAt) return null;
            const slot = Math.floor(
              (now - consent.createdAt) / consent.intervalMs,
            );
            state.pendingSlot = slot;
            state.pendingRequestId = this._periodicRequestId(consent, slot);
            state.updatedAt = now;
            this._saveMonitor(state);
          }
          const input = {
              id: goal.id,
              expectedRevision: consent.goalRevision,
              requestId: state.pendingRequestId,
            },
            context = { monitorId: consent.id, monitorSlot: state.pendingSlot };
          this._prepare(input, actor, context);
          guard();
          return { input, context };
        });
        if (!prepared) continue;
        const outcome = await this._checkNow(
          prepared.input,
          { guard },
          prepared.context,
        );
        guard();
        results.checks.push({
          goalId: row.goal_id,
          monitorId: prepared.context.monitorId,
          ...outcome,
        });
        if (outcome.status === "succeeded") {
          this._tx(() => {
            const pair = this._monitorState(row.goal_id);
            if (
              !pair ||
              pair.consent.id !== prepared.context.monitorId ||
              pair.state.pendingRequestId !== prepared.input.requestId
            )
              return;
            pair.state.pendingRequestId = null;
            pair.state.pendingSlot = null;
            const now = epoch(this.clock());
            pair.state.nextCheckAt =
              pair.consent.createdAt +
              (Math.floor(
                (now - pair.consent.createdAt) / pair.consent.intervalMs,
              ) +
                1) *
                pair.consent.intervalMs;
            pair.state.updatedAt = now;
            this._saveMonitor(pair.state);
          });
        } else if (
          !["busy", "retry_wait", "paused", "aborted"].includes(outcome.status)
        ) {
          const reason = outcome.error?.code ?? "GOAL_MONITOR_CHECK_FAILED";
          this._blockMonitor(row.goal_id, prepared.context.monitorId, reason);
          results.blocked.push({
            goalId: row.goal_id,
            monitorId: prepared.context.monitorId,
            reason,
          });
        }
      } catch (error) {
        // A locked/unavailable session suspends work; its old guard cannot be
        // carried across login. A later tick captures the new host session.
        try {
          guard();
        } catch {
          results.suspended = true;
          break;
        }
        const reason = error?.code ?? "GOAL_MONITOR_CHECK_FAILED";
        if (
          reason.startsWith("SCHEDULER_") ||
          reason === "GOAL_STORAGE_FAILED"
        ) {
          // Preserve the exact pending nonce after uncertain projection/storage
          // failure. Never advance to a fresh slot to conceal an unresolved run.
          results.blocked.push({
            goalId: row.goal_id,
            monitorId: row.monitor_id,
            reason,
            recoverable: true,
          });
          continue;
        }
        this._blockMonitor(row.goal_id, row.monitor_id, reason);
        results.blocked.push({
          goalId: row.goal_id,
          monitorId: row.monitor_id,
          reason,
        });
      }
    }
    return results;
  }
  async startBackground({ intervalMs = 1000, guard } = {}) {
    this._open();
    if (
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 100 ||
      intervalMs > 60000 ||
      (guard !== undefined && typeof guard !== "function")
    )
      fail("GOAL_MONITOR_INVALID_REQUEST");
    if (!this.backgroundTimer) {
      const run = () => {
        if (!this.closed) this.tick({ guard }).catch(() => {});
      };
      this.backgroundTimer = setInterval(run, intervalMs);
      this.backgroundTimer.unref?.();
      run();
    }
    return { started: true };
  }
  stopBackground() {
    if (this.backgroundTimer) clearInterval(this.backgroundTimer);
    this.backgroundTimer = null;
    return { stopped: true };
  }
  status(input) {
    this._open();
    const value = fields(input, ["id"]);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(value.id, actor);
      let pair = this._monitorState(goal.id);
      if (pair?.state.status === "enabled") {
        let reason = null;
        if (epoch(this.clock()) >= pair.consent.expiresAt)
          reason = "GOAL_MONITOR_CONSENT_EXPIRED";
        else if (
          goal.status !== "active" ||
          goal.revision !== pair.consent.goalRevision ||
          goal.controlGeneration !== pair.consent.controlGeneration ||
          digest(
            consentAuthority(
              this.adapter._authorize(goal.projectRef.id, actor),
            ),
          ) !== digest(consentAuthority(pair.consent.authority))
        )
          reason = "GOAL_MONITOR_CONSENT_STALE";
        if (reason) {
          this._blockMonitor(goal.id, pair.consent.id, reason);
          pair = this._monitorState(goal.id);
        }
      }
      return {
        goal,
        usage: this.usage.summary(goal, actor),
        manualOnly: false,
        monitor: this._monitorView(pair),
      };
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
      this.stopBackground();
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
