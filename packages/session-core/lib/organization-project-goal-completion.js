"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");
const {
  goalError,
  goalDefinitionDigest,
  reviseGoalRecord,
} = require("./goal-contract");
const { evaluateProjectRiskSnapshot } = require("./project-risk-evaluation");
const {
  OrganizationProjectGoalService,
} = require("./organization-project-goal-service");
const {
  OrganizationProjectGoalWorkflow,
} = require("./organization-project-goal-workflow");
const {
  readOrganizationTaskActionRun,
} = require("./organization-task-action-service");

const TABLE = "cc_organization_project_goal_acceptance";
const MAX_BYTES = 524288;
const COLUMNS = `id,goal_id,actor_did,kind,request_id,goal_revision,content_digest,CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_BYTES} THEN record_json ELSE NULL END AS record_json`;
const TYPES = [
  "all-tasks-completed",
  "selected-risk-signals-cleared",
  "all-goal-actions-resolved",
];
const REASONS = ["OVERDUE_INCOMPLETE_TASK", "BLOCKED_BY_INCOMPLETE_DEPENDENCY"];
const ESTIMATE = Object.freeze({
  runs: 1,
  tokens: 0,
  costUsd: 0,
  elapsedMs: 0,
});
function fail(code) {
  throw goalError(code);
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("GOAL_COMPLETION_INVALID_REQUEST");
  return value;
}
function fields(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("GOAL_COMPLETION_INVALID_REQUEST");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("GOAL_COMPLETION_INVALID_REQUEST");
  return JSON.parse(JSON.stringify(value));
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    fail("GOAL_COMPLETION_INVALID_CLOCK");
  return value;
}
function fixed(authority) {
  const { projectSourceRevision, ...result } = authority;
  return result;
}
function factsSnapshot(snapshot) {
  const { asOf, ...facts } = snapshot;
  return facts;
}
function sameGoal(record, goal) {
  return (
    record.goalId === goal.id &&
    record.storeId === goal.storeId &&
    record.projectId === goal.projectRef.id &&
    digest(record.scope) === digest(goal.projectRef.scope)
  );
}
function samePlan(record, goal) {
  return (
    sameGoal(record, goal) &&
    record.goalRevision === goal.revision &&
    record.controlGeneration === goal.controlGeneration &&
    record.definitionDigest === goalDefinitionDigest(goal)
  );
}

/** Independent shared acceptance. Native callers confirm prepared facts; only
 * this service creates the bounded evidence passed to the dedicated done CAS.
 * Attribution never substitutes for current organization permissions. */
class OrganizationProjectGoalCompletionService {
  constructor({
    db,
    getActor,
    authority,
    clock = Date.now,
    goals,
    risk,
    usage,
    workflow,
  } = {}) {
    if (typeof clock !== "function") fail("GOAL_COMPLETION_INVALID_CLOCK");
    this.goals =
      goals ||
      new OrganizationProjectGoalService({ db, getActor, authority, clock });
    Object.assign(this, { db, getActor, authority, clock });
    this.adapter = this.goals.adapter;
    this.risk = risk || this.goals.risk;
    this.usage = usage || this.goals.usage;
    this.workflow =
      workflow ||
      new OrganizationProjectGoalWorkflow({
        db,
        getActor,
        authority,
        clock,
        goals: this.goals,
        risk: this.risk,
        usage: this.usage,
      });
    if (
      [this.adapter, this.risk, this.usage, this.workflow].some(
        (service) => service.db !== db,
      )
    )
      fail("GOAL_COMPLETION_DATABASE_MISMATCH");
  }
  _tx(fn) {
    return this.adapter._transaction(fn);
  }
  _stamp() {
    return new Date(epoch(this.clock())).toISOString();
  }
  _goal(goalId, actor) {
    const goal = this.adapter._read(id(goalId), actor);
    if (!goal) fail("GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _guard(actor, guard) {
    if (guard !== undefined && typeof guard !== "function")
      fail("GOAL_COMPLETION_INVALID_GUARD");
    return () => {
      if (this.adapter._actor() !== actor) fail("GOAL_IDENTITY_CHANGED");
      if (guard) {
        const result = guard();
        if (result && typeof result.then === "function")
          fail("GOAL_COMPLETION_INVALID_GUARD");
        if (result !== undefined && result !== actor)
          fail("GOAL_IDENTITY_CHANGED");
      }
    };
  }
  _auth(goal, actor, mode = "read", expectedAuthority) {
    let authority;
    const permissions = [
      "goal.read",
      ...(["read", "inspect", "complete"].includes(mode)
        ? ["risk.read", "task.read"]
        : []),
      ...(mode !== "read" ? ["goal.accept"] : []),
      ...(["configure", "complete"].includes(mode) ? ["goal.update"] : []),
      ...(["inspect", "complete"].includes(mode) ? ["risk.evaluate"] : []),
    ];
    for (const permission of permissions)
      authority = this.adapter._authorize(
        goal.projectRef.id,
        actor,
        permission,
        expectedAuthority,
      );
    return authority;
  }
  _live(goal, revision) {
    if (goal.revision !== revision) fail("GOAL_REVISION_CONFLICT");
    if (goal.status !== "active") fail("GOAL_COMPLETION_NOT_ACTIVE");
    if (
      goal.expiresAt !== null &&
      epoch(this.clock()) >= Date.parse(goal.expiresAt)
    )
      fail("GOAL_COMPLETION_EXPIRED");
    if (
      !["draft", "active"].includes(
        this.adapter._project(goal.projectRef.id, this.adapter._actor()).status,
      )
    )
      fail("GOAL_PROJECT_NOT_ACTIVE");
  }
  _binding(goal, actor, authority) {
    return {
      goalId: goal.id,
      storeId: goal.storeId,
      projectId: goal.projectRef.id,
      scope: goal.projectRef.scope,
      actorDid: actor,
      goalRevision: goal.revision,
      controlGeneration: goal.controlGeneration,
      definitionDigest: goalDefinitionDigest(goal),
      authority,
    };
  }
  _record(kind, goal, actor, authority, requestId, inputDigest, body) {
    return {
      schema: `chainlesschain.organization-goal-acceptance-${kind}/v1`,
      id: `org-goal-${kind}-${digest([goal.storeId, goal.id, actor, kind, requestId]).slice(7)}`,
      ...this._binding(goal, actor, authority),
      requestId,
      inputDigest,
      createdAt: epoch(this.clock()),
      ...body,
    };
  }
  _decode(row) {
    if (!row) return null;
    try {
      if (
        typeof row.record_json !== "string" ||
        Buffer.byteLength(row.record_json) > MAX_BYTES
      )
        throw new Error();
      const record = JSON.parse(row.record_json);
      if (
        !["plan", "ack", "source", "fence", "report"].includes(row.kind) ||
        record.schema !==
          `chainlesschain.organization-goal-acceptance-${row.kind}/v1` ||
        record.id !== row.id ||
        record.goalId !== row.goal_id ||
        record.actorDid !== row.actor_did ||
        record.requestId !== row.request_id ||
        record.goalRevision !== row.goal_revision ||
        digest(record) !== row.content_digest ||
        !Number.isSafeInteger(record.goalRevision) ||
        record.goalRevision < 1 ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0 ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.definitionDigest) ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.inputDigest) ||
        record.scope.kind !== "organization" ||
        digest(record.scope) !== digest(record.authority.scope)
      )
        throw new Error();
      for (const key of [
        "id",
        "goalId",
        "storeId",
        "actorDid",
        "requestId",
        "projectId",
      ])
        id(record[key]);
      epoch(record.createdAt);
      if (row.kind === "plan") {
        this._assertions(record.assertions);
        this.adapter._validate(record.goal);
        if (
          record.criteriaDigest !== digest(record.goal.acceptanceCriteria) ||
          !samePlan(record, record.goal)
        )
          throw new Error();
      }
      if (
        row.kind === "ack" &&
        (!["accepted", "cancelled"].includes(record.status) ||
          !Array.isArray(record.criterionIds) ||
          record.criterionIds.length < 1 ||
          record.criterionIds.length > 50 ||
          new Set(record.criterionIds).size !== record.criterionIds.length)
      )
        throw new Error();
      if (
        row.kind === "report" &&
        (!["inspect", "complete"].includes(record.mode) ||
          !Array.isArray(record.criteria) ||
          record.criteria.length < 1 ||
          record.criteria.length > 50 ||
          typeof record.met !== "boolean" ||
          !Number.isSafeInteger(record.elapsedMs) ||
          record.elapsedMs < 0 ||
          record.appliedRevision !==
            (record.mode === "complete" && record.met
              ? record.goalRevision + 1
              : null))
      )
        throw new Error();
      return record;
    } catch {
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    }
  }
  _byId(recordId, kind) {
    const record = this._decode(
      this.db
        .prepare(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id=? AND kind=?`)
        .get(id(recordId), kind),
    );
    if (!record) fail("GOAL_COMPLETION_RECORD_CORRUPT");
    return record;
  }
  _prior(goalId, actor, kind, requestId, inputDigest) {
    const record = this._decode(
      this.db
        .prepare(
          `SELECT ${COLUMNS} FROM ${TABLE} WHERE goal_id=? AND actor_did=? AND kind=? AND request_id=?`,
        )
        .get(goalId, actor, kind, requestId),
    );
    if (record && record.inputDigest !== inputDigest)
      fail("GOAL_COMPLETION_REQUEST_CONFLICT");
    return record;
  }
  _save(record, kind) {
    const json = JSON.stringify(record),
      row = {
        id: record.id,
        goal_id: record.goalId,
        actor_did: record.actorDid,
        kind,
        request_id: record.requestId,
        goal_revision: record.goalRevision,
        record_json: json,
        content_digest: digest(record),
      };
    this._decode(row);
    if (
      this.db
        .prepare(
          `SELECT count(*) AS n FROM ${TABLE} WHERE goal_id=? AND kind=?`,
        )
        .get(record.goalId, kind).n >= 1000
    )
      fail("GOAL_COMPLETION_RECORD_LIMIT");
    this.db
      .prepare(`INSERT INTO ${TABLE} VALUES(?,?,?,?,?,?,?,?)`)
      .run(
        row.id,
        row.goal_id,
        row.actor_did,
        kind,
        row.request_id,
        row.goal_revision,
        json,
        row.content_digest,
      );
    return record;
  }
  _input(input, extra = [], optional = []) {
    const value = fields(
      input,
      ["goalId", "expectedRevision", "requestId", ...extra],
      optional,
    );
    id(value.goalId);
    id(value.requestId);
    if (
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 1
    )
      fail("GOAL_COMPLETION_INVALID_REQUEST");
    return value;
  }
  _assertions(value) {
    if (!Array.isArray(value) || value.length > 50)
      fail("GOAL_COMPLETION_INVALID_PLAN");
    const seen = new Set();
    for (const assertion of value) {
      fields(assertion, ["criterionId", "type"], ["reasonCodes"]);
      id(assertion.criterionId);
      if (seen.has(assertion.criterionId) || !TYPES.includes(assertion.type))
        fail("GOAL_COMPLETION_INVALID_PLAN");
      seen.add(assertion.criterionId);
      if (assertion.type === "selected-risk-signals-cleared") {
        if (
          !Array.isArray(assertion.reasonCodes) ||
          !assertion.reasonCodes.length ||
          new Set(assertion.reasonCodes).size !==
            assertion.reasonCodes.length ||
          assertion.reasonCodes.some((code) => !REASONS.includes(code))
        )
          fail("GOAL_COMPLETION_INVALID_PLAN");
      } else if (assertion.reasonCodes !== undefined)
        fail("GOAL_COMPLETION_INVALID_PLAN");
    }
  }
  _prepareConfigure(value, actor) {
    const current = this._goal(value.goalId, actor),
      prior = this._prior(
        current.id,
        actor,
        "plan",
        value.requestId,
        digest(value),
      );
    if (prior)
      return {
        goal: prior.goal,
        previous: current,
        plan: prior,
        actorDid: actor,
        authority: this.adapter._authorize(current.projectRef.id, actor),
        requestDigest: digest(value),
        replayed: true,
      };
    this._live(current, value.expectedRevision);
    const authority = this._auth(current, actor, "configure");
    this._assertions(value.assertions);
    if (
      !Array.isArray(value.acceptanceCriteria) ||
      !value.acceptanceCriteria.length
    )
      fail("GOAL_COMPLETION_INVALID_PLAN");
    const goal = reviseGoalRecord(
      current,
      { acceptanceCriteria: value.acceptanceCriteria },
      this._stamp(),
    );
    if (
      digest(
        goal.acceptanceCriteria
          .filter((c) => c.kind === "business-assertion")
          .map((c) => c.id)
          .sort(),
      ) !== digest(value.assertions.map((a) => a.criterionId).sort())
    )
      fail("GOAL_COMPLETION_INVALID_PLAN");
    const plan = this._record(
      "plan",
      goal,
      actor,
      authority,
      value.requestId,
      digest(value),
      {
        goal,
        previousRevision: current.revision,
        criteriaDigest: digest(goal.acceptanceCriteria),
        assertions: value.assertions,
        manualCriterionIds: goal.acceptanceCriteria
          .filter((c) => c.kind === "manual")
          .map((c) => c.id)
          .sort(),
      },
    );
    return {
      goal,
      previous: current,
      plan,
      actorDid: actor,
      authority,
      requestDigest: digest(value),
      replayed: false,
    };
  }
  prepareConfigure(input) {
    const value = this._input(input, ["acceptanceCriteria", "assertions"]);
    return this._tx(() => this._prepareConfigure(value, this.adapter._actor()));
  }
  configure(input, { expectedAuthority, guard } = {}) {
    const value = this._input(input, ["acceptanceCriteria", "assertions"]),
      actor = this.adapter._actor(),
      check = this._guard(actor, guard);
    return this._tx(() => {
      check();
      const prepared = this._prepareConfigure(value, actor);
      if (prepared.replayed)
        return { goal: prepared.goal, plan: prepared.plan, replayed: true };
      if (!expectedAuthority) fail("GOAL_COMPLETION_AUTHORITY_REQUIRED");
      this._auth(prepared.previous, actor, "configure", expectedAuthority);
      const goal = this.adapter.compareAndSwapInTransaction(
        prepared.previous.id,
        prepared.previous.revision,
        () => prepared.goal,
      );
      const plan = this._save(prepared.plan, "plan");
      check();
      this._auth(goal, actor, "configure", expectedAuthority);
      return { goal, plan, replayed: false };
    });
  }
  _plan(goal, actor, authority) {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM ${TABLE} WHERE goal_id=? AND kind='plan' AND goal_revision=? ORDER BY rowid DESC LIMIT 2`,
      )
      .all(goal.id, goal.revision);
    if (rows.length !== 1) fail("GOAL_COMPLETION_PLAN_REQUIRED");
    const plan = this._decode(rows[0]);
    if (
      !samePlan(plan, goal) ||
      plan.criteriaDigest !== digest(goal.acceptanceCriteria) ||
      digest(fixed(plan.authority)) !==
        digest(
          fixed(
            authority || this.adapter._authorize(goal.projectRef.id, actor),
          ),
        )
    )
      fail("GOAL_COMPLETION_PLAN_STALE");
    return plan;
  }
  _ackInput(input) {
    const value = this._input(input, ["criterionIds"]);
    if (
      !Array.isArray(value.criterionIds) ||
      !value.criterionIds.length ||
      value.criterionIds.length > 50 ||
      new Set(value.criterionIds).size !== value.criterionIds.length
    )
      fail("GOAL_COMPLETION_INVALID_REQUEST");
    value.criterionIds.forEach(id);
    value.criterionIds.sort();
    return value;
  }
  _prepareAck(value, actor) {
    const goal = this._goal(value.goalId, actor),
      prior = this._prior(
        goal.id,
        actor,
        "ack",
        value.requestId,
        digest(value),
      );
    if (prior)
      return {
        goal,
        acknowledgement: prior,
        actorDid: actor,
        authority: this.adapter._authorize(goal.projectRef.id, actor),
        requestDigest: digest(value),
        replayed: true,
      };
    this._live(goal, value.expectedRevision);
    const authority = this._auth(goal, actor, "ack"),
      plan = this._plan(goal, actor, authority);
    if (
      value.criterionIds.some((key) => !plan.manualCriterionIds.includes(key))
    )
      fail("GOAL_COMPLETION_INVALID_REQUEST");
    return {
      goal,
      plan,
      actorDid: actor,
      authority,
      requestDigest: digest(value),
      replayed: false,
    };
  }
  prepareAcknowledge(input) {
    const value = this._ackInput(input);
    return this._tx(() => this._prepareAck(value, this.adapter._actor()));
  }
  acknowledge(input, { expectedAuthority, confirmed, guard } = {}) {
    const value = this._ackInput(input),
      actor = this.adapter._actor(),
      check = this._guard(actor, guard);
    return this._tx(() => {
      check();
      const prepared = this._prepareAck(value, actor);
      if (prepared.replayed)
        return { acknowledgement: prepared.acknowledgement, replayed: true };
      if (!expectedAuthority || typeof confirmed !== "boolean")
        fail("GOAL_COMPLETION_CONFIRMATION_REQUIRED");
      this._auth(prepared.goal, actor, "ack", expectedAuthority);
      const acknowledgement = this._save(
        this._record(
          "ack",
          prepared.goal,
          actor,
          prepared.authority,
          value.requestId,
          digest(value),
          {
            planId: prepared.plan.id,
            planDigest: digest(prepared.plan),
            criterionIds: value.criterionIds,
            status: confirmed ? "accepted" : "cancelled",
          },
        ),
        "ack",
      );
      check();
      this._auth(prepared.goal, actor, "ack", expectedAuthority);
      return { acknowledgement, replayed: false };
    });
  }
  _acks(goal, plan, authority) {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM ${TABLE} WHERE goal_id=? AND kind='ack' AND goal_revision=? ORDER BY rowid LIMIT 1001`,
      )
      .all(goal.id, plan.goalRevision);
    if (rows.length > 1000) fail("GOAL_COMPLETION_RECORD_LIMIT");
    return rows
      .map((row) => this._decode(row))
      .filter(
        (ack) =>
          ack.status === "accepted" &&
          samePlan(ack, goal) &&
          ack.planId === plan.id &&
          ack.planDigest === digest(plan) &&
          digest(ack.authority) === digest(authority),
      );
  }
  _reviewSnapshot(goal, actor) {
    const project = this.risk._ownedProject(goal.projectRef.id, actor),
      columns = this.risk._taskColumns();
    this.risk._checkProjectTaskScope(project.id, columns);
    const sourceSnapshot = this.risk._snapshot(
      project,
      actor,
      this._stamp(),
      columns,
    );
    const evaluation = evaluateProjectRiskSnapshot(sourceSnapshot);
    return { sourceSnapshot, evaluation };
  }
  _actions(goal, actor) {
    const rows = this.db
      .prepare(
        "SELECT rowid,id FROM cc_organization_project_goal_workflow WHERE goal_id=? AND kind='intent' ORDER BY id LIMIT 501",
      )
      .all(goal.id);
    if (rows.length > 500) fail("GOAL_COMPLETION_RECORD_LIMIT");
    const intents = rows.map((row) => {
      const intent = this.workflow._read(row.id, "intent"),
        suggestion = this.workflow._read(intent.suggestionId, "suggestion");
      if (
        intent.goalId !== goal.id ||
        intent.storeId !== goal.storeId ||
        intent.goalRevision > goal.revision ||
        intent.controlGeneration > goal.controlGeneration ||
        suggestion.goalId !== goal.id ||
        suggestion.intentId !== intent.id
      )
        fail("GOAL_COMPLETION_SOURCE_CORRUPT");
      if (intent.preview) this.workflow._bound(intent.preview.request);
      this.workflow._source(
        suggestion,
        actor,
        intent.reviewId,
        intent.reviewDigest,
        false,
      );
      let receipt = null,
        proposal = null,
        resolution = null;
      if (intent.runId) {
        const stored = this.db
          .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
          .get(intent.runId);
        if (stored?.actor_did !== intent.actorDid)
          fail("GOAL_COMPLETION_SOURCE_CORRUPT");
        receipt = readOrganizationTaskActionRun(this.db, stored);
        if (
          receipt.run.status !== intent.status ||
          receipt.run.invocationDigest !==
            intent.preview?.request.invocationDigest
        )
          fail("GOAL_COMPLETION_SOURCE_CORRUPT");
      }
      if (intent.orgProposalId) {
        if (!this.workflow.proposals || !this.workflow.approvals)
          fail("GOAL_COMPLETION_WORKFLOW_REQUIRED");
        proposal = this.workflow.proposals.getInTransaction({
          proposalId: intent.orgProposalId,
        });
        if (
          proposal.invocationDigest !==
            intent.preview?.request.invocationDigest ||
          proposal.requesterDid !== intent.actorDid
        )
          fail("GOAL_COMPLETION_SOURCE_CORRUPT");
        resolution = this.workflow.approvals.verifyResolutionInTransaction({
          approvalId: proposal.approvalId,
        });
      }
      const resolved =
        (["succeeded", "denied", "cancelled"].includes(intent.status) &&
          !!receipt) ||
        (intent.status === "submitted" && resolution?.resolved === true);
      return {
        id: intent.id,
        actorDid: intent.actorDid,
        goalRevision: intent.goalRevision,
        controlGeneration: intent.controlGeneration,
        status: intent.status,
        recordDigest: digest(intent),
        runId: intent.runId,
        receiptDigest: receipt ? digest(receipt) : null,
        proposalId: intent.orgProposalId,
        approvalId: proposal?.approvalId ?? null,
        approvalStatus: proposal?.approvalStatus ?? null,
        resolution: resolution?.proof ?? null,
        resolved,
      };
    });
    return { watermark: Math.max(0, ...rows.map((row) => row.rowid)), intents };
  }
  _derive(goal, plan, review, acks, actions) {
    return goal.acceptanceCriteria.map((criterion) => {
      if (criterion.kind === "manual") {
        const ack = acks.find((item) =>
          item.criterionIds.includes(criterion.id),
        );
        return {
          id: criterion.id,
          type: "manual",
          met: !!ack,
          reason: ack ? "member-accepted" : "member-acceptance-required",
          observation: { acknowledgementId: ack?.id ?? null },
        };
      }
      const assertion = plan.assertions.find(
        (item) => item.criterionId === criterion.id,
      );
      if (!assertion) fail("GOAL_COMPLETION_RECORD_CORRUPT");
      const type = assertion.type;
      if (type === "all-goal-actions-resolved") {
        const unresolved = actions.intents.filter(
          (item) => !item.resolved,
        ).length;
        return {
          id: criterion.id,
          type,
          met: unresolved === 0,
          reason: unresolved
            ? "goal-actions-unresolved"
            : "goal-actions-resolved",
          observation: {
            actionCount: actions.intents.length,
            unresolvedCount: unresolved,
          },
        };
      }
      if (review.evaluation.status !== "evaluated")
        return {
          id: criterion.id,
          type,
          met: false,
          reason: "source-insufficient",
          observation: { sourceStatus: review.evaluation.status },
        };
      if (type === "all-tasks-completed") {
        const tasks = review.sourceSnapshot.tasks,
          incomplete = tasks.filter(
            (task) => task.status !== "completed",
          ).length;
        return {
          id: criterion.id,
          type,
          met: tasks.length > 0 && incomplete === 0,
          reason: !tasks.length
            ? "nonempty-project-required"
            : incomplete
              ? "project-tasks-incomplete"
              : "project-tasks-completed",
          observation: { taskCount: tasks.length, incompleteCount: incomplete },
        };
      }
      const n = review.evaluation.tasks.filter((task) =>
        task.reasonCodes.some((code) => assertion.reasonCodes.includes(code)),
      ).length;
      return {
        id: criterion.id,
        type,
        met: n === 0,
        reason: n
          ? "selected-risk-signals-present"
          : "selected-risk-signals-cleared",
        observation: {
          reasonCodes: assertion.reasonCodes,
          riskTaskCount: n,
          ruleVersion: review.evaluation.ruleVersion,
        },
      };
    });
  }
  _facts(goal, actor, plan, authority, review = null) {
    review ||= this._reviewSnapshot(goal, actor);
    const acks = this._acks(goal, plan, authority),
      actions = this._actions(goal, actor),
      criteria = this._derive(goal, plan, review, acks, actions),
      usage = this.usage.summary(goal, actor);
    const blockedReason = actions.intents.some((item) =>
      ["running", "unknown"].includes(item.status),
    )
      ? "GOAL_COMPLETION_ACTION_UNRESOLVED"
      : usage.unknownTime || usage.unknownTokens || usage.unknownCost
        ? "GOAL_COMPLETION_USAGE_UNKNOWN"
        : null;
    const sourceFacts = {
      usageUnknown: {
        time: usage.unknownTime,
        tokens: usage.unknownTokens,
        cost: usage.unknownCost,
      },
      tasksDigest: digest(factsSnapshot(review.sourceSnapshot)),
      actions,
      acknowledgements: acks.map((ack) => ({
        id: ack.id,
        contentDigest: digest(ack),
      })),
      criteria,
      blockedReason,
    };
    const factsDigest = digest(sourceFacts);
    return {
      review,
      acks,
      actions,
      criteria,
      blockedReason,
      met: criteria.every((item) => item.met) && blockedReason === null,
      factsDigest,
      freshnessDigest: digest({
        factsDigest,
        authority,
        goalDigest: digest(goal),
        planDigest: digest(plan),
        usage,
      }),
      sourceFacts,
    };
  }
  _prepareComplete(value, actor) {
    const goal = this._goal(value.goalId, actor),
      prior = this._prior(
        goal.id,
        actor,
        "report",
        value.requestId,
        digest({ ...value, mode: "complete" }),
      );
    if (prior) {
      this._auth(goal, actor);
      this._validateReport(prior, goal, actor);
      return {
        goal,
        report: prior,
        actorDid: actor,
        authority: this.adapter._authorize(goal.projectRef.id, actor),
        freshnessDigest: prior.freshnessDigest,
        requestDigest: digest(value),
        replayed: true,
      };
    }
    this._live(goal, value.expectedRevision);
    const authority = this._auth(goal, actor, "complete"),
      plan = this._plan(goal, actor, authority);
    this.usage.assertAvailable(goal, actor, ESTIMATE);
    const facts = this._facts(goal, actor, plan, authority);
    return {
      goal,
      plan,
      preview: {
        criteria: facts.criteria,
        met: facts.met,
        blockedReason: facts.blockedReason,
      },
      actorDid: actor,
      authority,
      freshnessDigest: facts.freshnessDigest,
      requestDigest: digest(value),
      replayed: false,
    };
  }
  prepareComplete(input) {
    const value = this._input(input);
    return this._tx(() => this._prepareComplete(value, this.adapter._actor()));
  }
  _disableMonitor(goal) {
    const row = this.db
      .prepare(
        "SELECT * FROM cc_organization_project_goal_monitor_states WHERE goal_id=?",
      )
      .get(goal.id);
    if (!row) return;
    let state;
    try {
      state = JSON.parse(row.record_json);
      if (
        digest(state) !== row.content_digest ||
        state.goalId !== goal.id ||
        state.monitorId !== row.monitor_id
      )
        throw new Error();
    } catch {
      fail("GOAL_COMPLETION_SOURCE_CORRUPT");
    }
    state.status = "blocked";
    state.blockedReason = "GOAL_COMPLETED";
    state.updatedAt = epoch(this.clock());
    this.db
      .prepare(
        "UPDATE cc_organization_project_goal_monitor_states SET record_json=?,content_digest=? WHERE goal_id=? AND monitor_id=?",
      )
      .run(JSON.stringify(state), digest(state), goal.id, row.monitor_id);
  }
  _operate(
    input,
    mode,
    { expectedAuthority, expectedFreshnessDigest, guard } = {},
  ) {
    const value = this._input(input),
      actor = this.adapter._actor(),
      check = this._guard(actor, guard),
      inputDigest = digest({ ...value, mode });
    return this._tx(() => {
      check();
      const goal = this._goal(value.goalId, actor),
        prior = this._prior(
          goal.id,
          actor,
          "report",
          value.requestId,
          inputDigest,
        );
      if (prior) {
        this._auth(goal, actor);
        this._validateReport(prior, goal, actor);
        return {
          goal,
          report: prior,
          completed: prior.appliedRevision !== null,
          replayed: true,
        };
      }
      this._live(goal, value.expectedRevision);
      if (
        mode === "complete" &&
        (!expectedAuthority ||
          !/^sha256:[a-f0-9]{64}$/u.test(expectedFreshnessDigest))
      )
        fail("GOAL_COMPLETION_AUTHORITY_REQUIRED");
      const authority = this._auth(goal, actor, mode, expectedAuthority),
        plan = this._plan(goal, actor, authority),
        initial = this._facts(goal, actor, plan, authority);
      if (
        mode === "complete" &&
        initial.freshnessDigest !== expectedFreshnessDigest
      )
        fail("GOAL_COMPLETION_SOURCE_CHANGED");
      this.usage.assertAvailable(goal, actor, ESTIMATE);
      const started = epoch(this.clock());
      const reportId = `org-goal-report-${digest([goal.storeId, goal.id, actor, "report", value.requestId]).slice(7)}`;
      this.usage.reserve({
        goal,
        actor,
        operationId: reportId,
        domain: "native-verifier",
        estimate: ESTIMATE,
      });
      const review = this.risk.evaluateInTransaction({
          projectId: goal.projectRef.id,
        }),
        facts = this._facts(goal, actor, plan, authority, review);
      if (facts.factsDigest !== initial.factsDigest)
        fail("GOAL_COMPLETION_SOURCE_CHANGED");
      const source = this._save(
        this._record("source", goal, actor, authority, reportId, inputDigest, {
          planId: plan.id,
          planDigest: digest(plan),
          review: { id: review.review.id, contentDigest: digest(review) },
          facts: initial.sourceFacts,
          factsDigest: initial.factsDigest,
        }),
        "source",
      );
      const fence = this._save(
        this._record("fence", goal, actor, authority, reportId, inputDigest, {
          planId: plan.id,
          sourceId: source.id,
          sourceDigest: digest(source),
          freshnessDigest: initial.freshnessDigest,
        }),
        "fence",
      );
      const checkedAt = epoch(this.clock()),
        elapsedMs = checkedAt - started;
      if (elapsedMs < 0) fail("GOAL_CLOCK_MOVED_BACKWARDS");
      const usage = this.usage.summary(goal, actor);
      if (
        goal.budgetPolicy.maxTimeMs !== null &&
        (usage.unknownTime ||
          usage.knownElapsedMs + usage.reservedElapsedMs + elapsedMs >
            goal.budgetPolicy.maxTimeMs)
      )
        fail("GOAL_COMPLETION_BUDGET_EXCEEDED");
      const report = this._save(
        this._record(
          "report",
          goal,
          actor,
          authority,
          value.requestId,
          inputDigest,
          {
            mode,
            planId: plan.id,
            planDigest: digest(plan),
            review: source.review,
            actionsSource: { id: source.id, contentDigest: digest(source) },
            fence: { id: fence.id, contentDigest: digest(fence) },
            ackIds: initial.acks.map((ack) => ack.id),
            checkedAt,
            elapsedMs,
            freshnessDigest: initial.freshnessDigest,
            criteria: initial.criteria,
            blockedReason: initial.blockedReason,
            met: initial.met,
            appliedRevision:
              mode === "complete" && initial.met ? goal.revision + 1 : null,
          },
        ),
        "report",
      );
      this.usage.settle({
        operationId: report.id,
        actor,
        goalId: goal.id,
        status: "settled",
        usage: { ...ESTIMATE, elapsedMs },
      });
      check();
      this._auth(goal, actor, mode, authority);
      this._live(goal, goal.revision);
      if (
        this._facts(goal, actor, plan, authority).factsDigest !==
        initial.factsDigest
      )
        fail("GOAL_COMPLETION_SOURCE_CHANGED");
      let next = goal;
      if (mode === "complete" && report.met) {
        next = this.adapter.completeInTransaction(
          goal.id,
          goal.revision,
          report,
          this._stamp(),
        );
        this._disableMonitor(next);
      }
      check();
      this._auth(next, actor, mode, authority);
      if (
        goal.expiresAt !== null &&
        epoch(this.clock()) >= Date.parse(goal.expiresAt)
      )
        fail("GOAL_COMPLETION_EXPIRED");
      if (
        this._facts(goal, actor, plan, authority).factsDigest !==
        initial.factsDigest
      )
        fail("GOAL_COMPLETION_SOURCE_CHANGED");
      if (goal.budgetPolicy.maxTimeMs !== null) {
        const settled = this.usage.summary(next, actor);
        if (
          settled.unknownTime ||
          settled.knownElapsedMs +
            settled.reservedElapsedMs +
            Math.max(0, epoch(this.clock()) - checkedAt) >
            goal.budgetPolicy.maxTimeMs
        )
          fail("GOAL_COMPLETION_BUDGET_EXCEEDED");
      }
      return {
        goal: next,
        report,
        completed: next.status === "done",
        replayed: false,
      };
    });
  }
  inspect(input, options) {
    return this._operate(input, "inspect", options);
  }
  complete(input, options) {
    return this._operate(input, "complete", options);
  }
  _validateReport(report, goal, actor) {
    if (
      !sameGoal(report, goal) ||
      report.goalRevision > goal.revision ||
      report.controlGeneration > goal.controlGeneration
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const plan = this._byId(report.planId, "plan"),
      source = this._byId(report.actionsSource.id, "source"),
      fence = this._byId(report.fence.id, "fence");
    if (
      !sameGoal(plan, goal) ||
      !sameGoal(source, goal) ||
      !sameGoal(fence, goal) ||
      digest(plan) !== report.planDigest ||
      digest(source) !== report.actionsSource.contentDigest ||
      digest(fence) !== report.fence.contentDigest ||
      source.planId !== plan.id ||
      source.planDigest !== digest(plan) ||
      source.factsDigest !== digest(source.facts) ||
      fence.sourceId !== source.id ||
      fence.sourceDigest !== digest(source) ||
      fence.freshnessDigest !== report.freshnessDigest ||
      digest(source.review) !== digest(report.review) ||
      digest(source.authority) !== digest(report.authority) ||
      source.goalRevision !== report.goalRevision ||
      source.controlGeneration !== report.controlGeneration ||
      plan.goalRevision !== report.goalRevision ||
      plan.controlGeneration !== report.controlGeneration ||
      report.definitionDigest !== plan.definitionDigest
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const review = this.risk._readReview(report.review.id, actor);
    if (
      digest(review) !== report.review.contentDigest ||
      review.review.actorDid !== report.actorDid ||
      review.review.projectId !== goal.projectRef.id ||
      digest(factsSnapshot(review.sourceSnapshot)) !== source.facts.tasksDigest
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const acks = source.facts.acknowledgements.map((ref) => {
      const ack = this._byId(ref.id, "ack");
      if (
        digest(ack) !== ref.contentDigest ||
        ack.planId !== plan.id ||
        ack.status !== "accepted" ||
        digest(ack.authority) !== digest(report.authority) ||
        !sameGoal(ack, goal)
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      return ack;
    });
    const actions = source.facts.actions;
    if (
      !actions ||
      !Number.isSafeInteger(actions.watermark) ||
      actions.watermark < 0 ||
      !Array.isArray(actions.intents) ||
      actions.intents.length > 500 ||
      new Set(actions.intents.map((item) => item.id)).size !==
        actions.intents.length
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    for (const item of actions.intents) {
      const intent = this.workflow._read(item.id, "intent");
      if (
        intent.goalId !== goal.id ||
        intent.storeId !== goal.storeId ||
        intent.actorDid !== item.actorDid ||
        intent.goalRevision !== item.goalRevision ||
        intent.controlGeneration !== item.controlGeneration ||
        ![
          "draft",
          "prepared",
          "submitting",
          "submitted",
          "running",
          "succeeded",
          "denied",
          "cancelled",
        ].includes(item.status) ||
        typeof item.resolved !== "boolean"
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      let resolved = false;
      if (["succeeded", "denied", "cancelled"].includes(item.status)) {
        const stored = this.db
          .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
          .get(item.runId);
        if (stored?.actor_did !== item.actorDid || intent.runId !== item.runId)
          fail("GOAL_COMPLETION_RECORD_CORRUPT");
        const receipt = readOrganizationTaskActionRun(this.db, stored);
        if (
          receipt.run.status !== item.status ||
          digest(receipt) !== item.receiptDigest ||
          receipt.run.invocationDigest !==
            intent.preview?.request.invocationDigest
        )
          fail("GOAL_COMPLETION_RECORD_CORRUPT");
        resolved = true;
      } else if (item.resolution) {
        if (item.status !== "submitted" || !this.workflow.approvals)
          fail("GOAL_COMPLETION_RECORD_CORRUPT");
        const proof = this.workflow.approvals.verifyResolutionInTransaction({
          approvalId: item.approvalId,
        });
        if (!proof.resolved || digest(proof.proof) !== digest(item.resolution))
          fail("GOAL_COMPLETION_RECORD_CORRUPT");
        resolved = true;
      }
      if (resolved !== item.resolved) fail("GOAL_COMPLETION_RECORD_CORRUPT");
    }
    const unknown = source.facts.usageUnknown;
    if (
      !unknown ||
      Object.keys(unknown).sort().join(",") !== "cost,time,tokens" ||
      Object.values(unknown).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const blockedReason = actions.intents.some(
      (item) => item.status === "running",
    )
      ? "GOAL_COMPLETION_ACTION_UNRESOLVED"
      : Object.values(unknown).some((value) => value > 0)
        ? "GOAL_COMPLETION_USAGE_UNKNOWN"
        : null;
    if (blockedReason !== report.blockedReason)
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const criteria = this._derive(
      plan.goal,
      plan,
      review,
      acks,
      source.facts.actions,
    );
    if (
      digest(criteria) !== digest(report.criteria) ||
      report.met !==
        (criteria.every((item) => item.met) && report.blockedReason === null) ||
      report.blockedReason !== source.facts.blockedReason ||
      digest(acks.map((ack) => ack.id)) !== digest(report.ackIds)
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const ledger = this.usage._read(
      this.db
        .prepare(`SELECT * FROM ${this.usage.table} WHERE operation_id=?`)
        .get(report.id),
    );
    if (
      !ledger ||
      ledger.actorDid !== report.actorDid ||
      ledger.goalId !== goal.id ||
      ledger.domain !== "native-verifier" ||
      ledger.status !== "settled" ||
      ledger.usage.runs !== 1 ||
      ledger.usage.elapsedMs !== report.elapsedMs
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    return report;
  }
  status(input) {
    const value = fields(input, ["goalId"], ["beforeId", "limit"]),
      limit = value.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("GOAL_COMPLETION_INVALID_REQUEST");
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(value.goalId, actor),
        authority = this._auth(goal, actor);
      const planRow = this.db
          .prepare(
            `SELECT ${COLUMNS} FROM ${TABLE} WHERE goal_id=? AND kind='plan' ORDER BY rowid DESC LIMIT 1`,
          )
          .get(goal.id),
        plan = this._decode(planRow);
      let cursor = null;
      if (value.beforeId !== undefined) {
        cursor = this.db
          .prepare(
            `SELECT rowid FROM ${TABLE} WHERE id=? AND goal_id=? AND kind='report'`,
          )
          .get(id(value.beforeId), goal.id);
        if (!cursor) fail("GOAL_COMPLETION_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          `SELECT ${COLUMNS} FROM ${TABLE} WHERE goal_id=? AND kind='report' ${cursor ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(goal.id, ...(cursor ? [cursor.rowid] : []), limit + 1);
      const reports = rows
        .slice(0, limit)
        .map((row) => this._validateReport(this._decode(row), goal, actor));
      const acknowledgements = plan
        ? this.db
            .prepare(
              `SELECT ${COLUMNS} FROM ${TABLE} WHERE goal_id=? AND kind='ack' AND goal_revision=? ORDER BY rowid DESC LIMIT 1000`,
            )
            .all(goal.id, plan.goalRevision)
            .map((row) => this._decode(row))
        : [];
      return {
        goal,
        plan,
        planCurrent:
          !!plan &&
          samePlan(plan, goal) &&
          digest(fixed(plan.authority)) === digest(fixed(authority)),
        acknowledgements,
        reports,
        nextCursor: rows.length > limit ? reports.at(-1).id : null,
      };
    });
  }
}

module.exports = { OrganizationProjectGoalCompletionService };
