"use strict";

const { randomUUID } = require("node:crypto");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  goalError,
  goalDefinitionDigest,
  reviseGoalRecord,
  completeGoalRecord,
} = require("./goal-contract.js");
const { PersonalProjectGoalService } = require("./project-goal-service.js");
const {
  ProjectRiskReviewService,
} = require("./project-risk-review-service.js");
const { ProjectGoalWorkflow } = require("./project-goal-workflow.js");
const { GoalUsageLedger } = require("./goal-usage-ledger.js");
const { ApprovalGate } = require("./approval-gate.js");

const MAX_RECORD_BYTES = 65536;
const MAX_RECORDS = 1000;
const TYPES = [
  "all-tasks-completed",
  "selected-risk-signals-cleared",
  "all-goal-actions-resolved",
];
const REASONS = ["OVERDUE_INCOMPLETE_TASK", "BLOCKED_BY_INCOMPLETE_DEPENDENCY"];
const ESTIMATE = { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 0 };
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
function options(value, required, optional = []) {
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
  return value;
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    fail("GOAL_COMPLETION_INVALID_CLOCK");
  return value;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function sameBinding(record, goal) {
  return (
    record.goalId === goal.id &&
    record.storeId === goal.storeId &&
    record.actorDid === goal.ownerRef &&
    record.goalRevision === goal.revision &&
    record.controlGeneration === goal.controlGeneration &&
    record.definitionDigest === goalDefinitionDigest(goal)
  );
}

/** Explicit first-party assertions. Neither goal progress, model prose nor
 * scheduler success can satisfy these conditions. A goal CAS, independent
 * source evidence, completion receipt and verifier usage share one native tx. */
class ProjectGoalCompletionService {
  constructor({ db, getActor, clock = Date.now, approvalGate = null } = {}) {
    if (typeof clock !== "function") fail("GOAL_COMPLETION_INVALID_CLOCK");
    this.db = db;
    this.clock = clock;
    this.goals = new PersonalProjectGoalService({
      db,
      getActor,
      now: () => this._stamp(),
    });
    this.adapter = this.goals.adapter;
    this.risk = new ProjectRiskReviewService({ db, getActor, now: clock });
    this.usage = new GoalUsageLedger({ db });
    this.workflow = new ProjectGoalWorkflow({
      db,
      getActor,
      clock,
      goals: this.goals,
      risk: this.risk,
      usage: this.usage,
    });
    this.approvalGate = approvalGate || new ApprovalGate();
    if (typeof this.approvalGate.decide !== "function")
      fail("GOAL_COMPLETION_APPROVAL_REQUIRED");
    this._tx(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_acceptance (
      id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,kind TEXT NOT NULL,
      request_id TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,
      UNIQUE(goal_id,actor_did,kind,request_id));
      CREATE INDEX IF NOT EXISTS idx_cc_project_goal_acceptance_goal ON cc_project_goal_acceptance(goal_id,actor_did,kind);`),
    );
  }
  _stamp() {
    return new Date(epoch(this.clock())).toISOString();
  }
  _tx(operation) {
    return this.adapter._transaction(operation);
  }
  _goal(goalId, actor) {
    const goal = this.adapter._read(id(goalId), actor);
    if (!goal) fail("GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _live(goal, expectedRevision) {
    if (goal.revision !== expectedRevision) fail("GOAL_REVISION_CONFLICT");
    if (goal.status !== "active") fail("GOAL_COMPLETION_NOT_ACTIVE");
    if (
      goal.expiresAt !== null &&
      epoch(this.clock()) >= Date.parse(goal.expiresAt)
    )
      fail("GOAL_COMPLETION_EXPIRED");
  }
  _binding(goal) {
    return {
      goalId: goal.id,
      storeId: goal.storeId,
      actorDid: goal.ownerRef,
      goalRevision: goal.revision,
      controlGeneration: goal.controlGeneration,
      definitionDigest: goalDefinitionDigest(goal),
    };
  }
  _read(row) {
    if (!row) return null;
    try {
      if (
        typeof row.record_json !== "string" ||
        Buffer.byteLength(row.record_json, "utf8") > MAX_RECORD_BYTES
      )
        throw new Error();
      const record = JSON.parse(row.record_json);
      if (
        !record ||
        record.schema !== `chainlesschain.goal-acceptance-${row.kind}/v1` ||
        record.id !== row.id ||
        record.goalId !== row.goal_id ||
        record.actorDid !== row.actor_did ||
        record.requestId !== row.request_id ||
        digest(record) !== row.content_digest ||
        !Number.isSafeInteger(record.goalRevision) ||
        record.goalRevision < 1 ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0 ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.definitionDigest)
      )
        throw new Error();
      for (const key of ["id", "goalId", "storeId", "actorDid", "requestId"])
        id(record[key]);
      if (row.kind === "plan") {
        options(record, [
          "schema",
          "id",
          "goalId",
          "storeId",
          "actorDid",
          "goalRevision",
          "controlGeneration",
          "definitionDigest",
          "requestId",
          "createdAt",
          "criteriaDigest",
          "assertions",
          "manualCriterionIds",
        ]);
        epoch(record.createdAt);
        if (!/^sha256:[a-f0-9]{64}$/u.test(record.criteriaDigest))
          throw new Error();
        this._assertions(record.assertions);
        if (
          !Array.isArray(record.manualCriterionIds) ||
          record.manualCriterionIds.length + record.assertions.length > 50 ||
          new Set([
            ...record.manualCriterionIds,
            ...record.assertions.map((item) => item.criterionId),
          ]).size !==
            record.manualCriterionIds.length + record.assertions.length
        )
          throw new Error();
        record.manualCriterionIds.forEach(id);
      } else if (row.kind === "ack") {
        options(record, [
          "schema",
          "id",
          "goalId",
          "storeId",
          "actorDid",
          "goalRevision",
          "controlGeneration",
          "definitionDigest",
          "requestId",
          "inputDigest",
          "criterionIds",
          "startedAt",
          "completedAt",
          "status",
          "decision",
        ]);
        epoch(record.startedAt);
        if (
          !/^sha256:[a-f0-9]{64}$/u.test(record.inputDigest) ||
          !Array.isArray(record.criterionIds) ||
          !record.criterionIds.length ||
          record.criterionIds.length > 50 ||
          new Set(record.criterionIds).size !== record.criterionIds.length ||
          !["running", "accepted", "cancelled", "denied"].includes(
            record.status,
          )
        )
          throw new Error();
        record.criterionIds.forEach(id);
        if (record.status === "running") {
          if (record.completedAt !== null || record.decision !== null)
            throw new Error();
        } else {
          epoch(record.completedAt);
          if (record.completedAt < record.startedAt) throw new Error();
          options(record.decision, ["decision", "via", "policy", "riskLevel"]);
          if (
            record.decision.policy !== "strict" ||
            record.decision.riskLevel !== "high" ||
            (record.status === "accepted" &&
              (record.decision.decision !== "allow" ||
                record.decision.via !== "user-confirm")) ||
            (record.status !== "accepted" &&
              record.decision.decision !== "deny")
          )
            throw new Error();
        }
      } else if (row.kind === "source") {
        options(record, [
          "schema",
          "id",
          "goalId",
          "storeId",
          "actorDid",
          "goalRevision",
          "controlGeneration",
          "definitionDigest",
          "requestId",
          "createdAt",
          "watermark",
          "intents",
        ]);
        epoch(record.createdAt);
        epoch(record.watermark);
        if (!Array.isArray(record.intents) || record.intents.length > 500)
          throw new Error();
        const seen = new Set();
        for (const item of record.intents) {
          if (
            !Array.isArray(item) ||
            item.length !== 2 ||
            seen.has(item[0]) ||
            ![
              "draft",
              "prepared",
              "running",
              "succeeded",
              "cancelled",
              "denied",
            ].includes(item[1])
          )
            throw new Error();
          id(item[0]);
          seen.add(item[0]);
        }
      } else if (row.kind === "check") {
        options(record, [
          "schema",
          "id",
          "goalId",
          "storeId",
          "actorDid",
          "goalRevision",
          "controlGeneration",
          "definitionDigest",
          "requestId",
          "inputDigest",
          "mode",
          "planId",
          "planDigest",
          "review",
          "actionsSource",
          "ackIds",
          "checkedAt",
          "decisionAt",
          "elapsedMs",
          "criteria",
          "met",
          "blockedReason",
          "appliedRevision",
        ]);
        epoch(record.checkedAt);
        epoch(record.decisionAt);
        if (record.decisionAt < record.checkedAt) throw new Error();
        epoch(record.elapsedMs);
        if (
          !["check", "complete"].includes(record.mode) ||
          typeof record.met !== "boolean" ||
          !/^sha256:[a-f0-9]{64}$/u.test(record.inputDigest) ||
          !Array.isArray(record.criteria) ||
          record.criteria.length < 1 ||
          record.criteria.length > 50 ||
          !Array.isArray(record.ackIds) ||
          record.ackIds.length > 50 ||
          record.met !==
            (record.criteria.every((item) => item.met === true) &&
              record.blockedReason === null) ||
          record.appliedRevision !==
            (record.mode === "complete" && record.met
              ? record.goalRevision + 1
              : null)
        )
          throw new Error();
        id(record.planId);
        record.ackIds.forEach(id);
        if (!/^sha256:[a-f0-9]{64}$/u.test(record.planDigest))
          throw new Error();
        if (record.review !== null) {
          options(record.review, ["id", "contentDigest"]);
          id(record.review.id);
          if (!/^sha256:[a-f0-9]{64}$/u.test(record.review.contentDigest))
            throw new Error();
        }
        if (record.actionsSource !== null) {
          options(record.actionsSource, ["id", "contentDigest"]);
          id(record.actionsSource.id);
          if (
            !/^sha256:[a-f0-9]{64}$/u.test(record.actionsSource.contentDigest)
          )
            throw new Error();
        }
        for (const criterion of record.criteria) {
          options(criterion, ["id", "type", "met", "reason", "observation"]);
          id(criterion.id);
          if (
            ![...TYPES, "manual"].includes(criterion.type) ||
            typeof criterion.met !== "boolean" ||
            typeof criterion.reason !== "string"
          )
            throw new Error();
        }
        if (
          new Set(record.criteria.map((item) => item.id)).size !==
          record.criteria.length
        )
          throw new Error();
      } else throw new Error();
      return record;
    } catch {
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    }
  }
  _row(goalId, actor, kind, requestId) {
    return this.db
      .prepare(
        `SELECT id,goal_id,actor_did,kind,request_id,
      CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_RECORD_BYTES} THEN record_json ELSE NULL END AS record_json,
      content_digest FROM cc_project_goal_acceptance WHERE goal_id=? AND actor_did=? AND kind=? AND request_id=?`,
      )
      .get(goalId, actor, kind, requestId);
  }
  _byId(recordId, actor, kind) {
    const meta = this.db
      .prepare(
        "SELECT goal_id,request_id FROM cc_project_goal_acceptance WHERE id=? AND actor_did=? AND kind=?",
      )
      .get(id(recordId), actor, kind);
    if (!meta) fail("GOAL_COMPLETION_RECORD_CORRUPT");
    return this._read(this._row(meta.goal_id, actor, kind, meta.request_id));
  }
  _save(record, kind) {
    if (!this.db.inTransaction) fail("GOAL_TRANSACTION_REQUIRED");
    const body = JSON.stringify(record);
    const row = {
      id: record.id,
      goal_id: record.goalId,
      actor_did: record.actorDid,
      kind,
      request_id: record.requestId,
      record_json: body,
      content_digest: digest(record),
    };
    this._read(row);
    const prior = this.db
      .prepare(
        "SELECT kind,goal_id,actor_did,request_id FROM cc_project_goal_acceptance WHERE id=?",
      )
      .get(record.id);
    if (
      prior &&
      (prior.kind !== kind ||
        prior.goal_id !== record.goalId ||
        prior.actor_did !== record.actorDid ||
        prior.request_id !== record.requestId)
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    if (
      !prior &&
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_acceptance WHERE goal_id=? AND actor_did=? AND kind=?",
        )
        .get(record.goalId, record.actorDid, kind).n >= MAX_RECORDS
    )
      fail("GOAL_COMPLETION_RECORD_LIMIT");
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_acceptance VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        row.id,
        row.goal_id,
        row.actor_did,
        kind,
        row.request_id,
        body,
        row.content_digest,
      );
    return record;
  }
  _assertions(value) {
    if (!Array.isArray(value) || value.length > 50)
      fail("GOAL_COMPLETION_INVALID_PLAN");
    const seen = new Set();
    for (const assertion of value) {
      options(assertion, ["criterionId", "type"], ["reasonCodes"]);
      id(assertion.criterionId);
      if (seen.has(assertion.criterionId) || !TYPES.includes(assertion.type))
        fail("GOAL_COMPLETION_INVALID_PLAN");
      seen.add(assertion.criterionId);
      if (assertion.type === "selected-risk-signals-cleared") {
        if (
          !Array.isArray(assertion.reasonCodes) ||
          !assertion.reasonCodes.length ||
          assertion.reasonCodes.length > REASONS.length ||
          new Set(assertion.reasonCodes).size !==
            assertion.reasonCodes.length ||
          assertion.reasonCodes.some((code) => !REASONS.includes(code))
        )
          fail("GOAL_COMPLETION_INVALID_PLAN");
      } else if (assertion.reasonCodes !== undefined)
        fail("GOAL_COMPLETION_INVALID_PLAN");
    }
    return value;
  }
  configure(input) {
    options(input, [
      "goalId",
      "expectedRevision",
      "acceptanceCriteria",
      "assertions",
    ]);
    this._assertions(input.assertions);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        current = this._goal(input.goalId, actor);
      this._live(current, input.expectedRevision);
      if (
        !Array.isArray(input.acceptanceCriteria) ||
        !input.acceptanceCriteria.length
      )
        fail("GOAL_COMPLETION_INVALID_PLAN");
      const goal = this.adapter.compareAndSwapInTransaction(
        current.id,
        current.revision,
        (record) =>
          reviseGoalRecord(
            record,
            { acceptanceCriteria: input.acceptanceCriteria },
            this._stamp(),
          ),
      );
      const business = goal.acceptanceCriteria
        .filter((criterion) => criterion.kind === "business-assertion")
        .map((item) => item.id)
        .sort();
      if (
        digest(business) !==
        digest(
          input.assertions.map((assertion) => assertion.criterionId).sort(),
        )
      )
        fail("GOAL_COMPLETION_INVALID_PLAN");
      const plan = this._save(
        {
          schema: "chainlesschain.goal-acceptance-plan/v1",
          id: `acceptance-plan-${randomUUID()}`,
          ...this._binding(goal),
          requestId: `revision:${goal.revision}`,
          createdAt: epoch(this.clock()),
          criteriaDigest: digest(goal.acceptanceCriteria),
          assertions: input.assertions,
          manualCriterionIds: goal.acceptanceCriteria
            .filter((criterion) => criterion.kind === "manual")
            .map((criterion) => criterion.id)
            .sort(),
        },
        "plan",
      );
      this._authority(goal, actor);
      return clone({ goal, plan });
    });
  }
  _authority(goal, actor) {
    if (this.adapter._actor() !== actor) fail("GOAL_IDENTITY_CHANGED");
    this.adapter._project(goal.projectRef.id, actor);
  }
  _plan(goal, actor) {
    const plan = this._read(
      this._row(goal.id, actor, "plan", `revision:${goal.revision}`),
    );
    if (
      !plan ||
      !sameBinding(plan, goal) ||
      plan.criteriaDigest !== digest(goal.acceptanceCriteria)
    )
      fail("GOAL_COMPLETION_PLAN_REQUIRED");
    return plan;
  }
  async acknowledge(input) {
    options(input, ["goalId", "expectedRevision", "requestId"]);
    id(input.requestId);
    const inputDigest = digest(input);
    const admitted = this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(input.goalId, actor);
      const prior = this._read(
        this._row(goal.id, actor, "ack", input.requestId),
      );
      if (prior) {
        if (prior.inputDigest !== inputDigest)
          fail("GOAL_COMPLETION_REQUEST_CONFLICT");
        this._authority(goal, actor);
        return { prior };
      }
      this._live(goal, input.expectedRevision);
      this._plan(goal, actor);
      const criteria = goal.acceptanceCriteria.filter(
        (criterion) => criterion.kind === "manual",
      );
      if (!criteria.length) fail("GOAL_COMPLETION_NO_MANUAL_CRITERIA");
      const ack = this._save(
        {
          schema: "chainlesschain.goal-acceptance-ack/v1",
          id: `acceptance-ack-${randomUUID()}`,
          ...this._binding(goal),
          requestId: input.requestId,
          inputDigest,
          criterionIds: criteria.map((item) => item.id).sort(),
          startedAt: epoch(this.clock()),
          completedAt: null,
          status: "running",
          decision: null,
        },
        "ack",
      );
      this._authority(goal, actor);
      return { goal, criteria, ack, actor };
    });
    if (admitted.prior)
      return clone({ acknowledgement: admitted.prior, replayed: true });
    const { goal, criteria, ack, actor } = admitted;
    let decision;
    try {
      decision = await this.approvalGate.decide({
        sessionId: "goal-acceptance",
        policy: "strict",
        riskLevel: "high",
        tool: "project.goal.acceptance",
        goal,
        criteria,
        actorDid: actor,
        acknowledgementId: ack.id,
        inputDigest,
      });
    } catch {
      decision = { decision: "deny", via: "confirm-error" };
    }
    const allowed =
      decision?.decision === "allow" &&
      decision.via === "user-confirm" &&
      decision.policy === "strict" &&
      decision.riskLevel === "high" &&
      !decision.authorization;
    const cancelled =
      decision?.decision === "deny" &&
      decision.via === "user-deny" &&
      decision.policy === "strict" &&
      decision.riskLevel === "high" &&
      !decision.authorization;
    let deniedError = null;
    const saved = this._tx(() => {
      const completedAt = epoch(this.clock());
      try {
        const currentActor = this.adapter._actor(),
          current = this._goal(goal.id, currentActor);
        if (currentActor !== actor || !sameBinding(ack, current))
          fail("GOAL_COMPLETION_ACK_STALE");
        this._live(current, goal.revision);
        this._plan(current, actor);
        this._authority(current, actor);
        if (completedAt < ack.startedAt) fail("GOAL_CLOCK_MOVED_BACKWARDS");
      } catch (error) {
        deniedError = error;
      }
      // Revocation cleanup settles only the original admission and grants no
      // new authority; no protected content is returned after it is denied.
      const prior = this._byId(ack.id, actor, "ack");
      if (prior.status !== "running" || prior.inputDigest !== inputDigest)
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      const accepted = allowed && !deniedError;
      return this._save(
        {
          ...prior,
          completedAt: Math.max(completedAt, prior.startedAt),
          status: accepted
            ? "accepted"
            : !deniedError && cancelled
              ? "cancelled"
              : "denied",
          decision: {
            decision: accepted ? "allow" : "deny",
            via: deniedError
              ? "precondition-denied"
              : accepted
                ? "user-confirm"
                : cancelled
                  ? "user-deny"
                  : "approval-denied",
            policy: "strict",
            riskLevel: "high",
          },
        },
        "ack",
      );
    });
    if (deniedError) throw deniedError;
    return clone({ acknowledgement: saved, replayed: false });
  }
  _accepted(goal, actor) {
    const rows = this.db
      .prepare(
        "SELECT request_id FROM cc_project_goal_acceptance WHERE goal_id=? AND actor_did=? AND kind='ack' ORDER BY rowid DESC LIMIT ?",
      )
      .all(goal.id, actor, MAX_RECORDS + 1);
    if (rows.length > MAX_RECORDS) fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const acks = rows.map((row) =>
      this._read(this._row(goal.id, actor, "ack", row.request_id)),
    );
    return acks.filter(
      (ack) => ack.status === "accepted" && sameBinding(ack, goal),
    );
  }
  _actionSource(goal, actor, requestId) {
    const rows = this.db
      .prepare(
        "SELECT rowid,id FROM cc_project_goal_workflow WHERE goal_id=? AND actor_did=? AND kind='intent' ORDER BY id LIMIT 501",
      )
      .all(goal.id, actor);
    if (rows.length > 500) fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const intents = rows.map((row) =>
      this.workflow._read(row.id, "intent", actor),
    );
    intents.forEach((intent) => this.workflow._intentResult(intent, actor));
    return this._save(
      {
        schema: "chainlesschain.goal-acceptance-source/v1",
        id: `acceptance-source-${randomUUID()}`,
        ...this._binding(goal),
        requestId,
        createdAt: epoch(this.clock()),
        watermark: Math.max(0, ...rows.map((row) => row.rowid)),
        intents: intents.map((intent) => [intent.id, intent.status]),
      },
      "source",
    );
  }
  _derive(criterionId, type, assertion, review, acknowledgements, actions) {
    if (type === "manual") {
      const ack = acknowledgements.find((item) =>
        item.criterionIds.includes(criterionId),
      );
      return {
        id: criterionId,
        type,
        met: !!ack,
        reason: ack ? "owner-accepted" : "owner-acceptance-required",
        observation: { acknowledgementId: ack?.id ?? null },
      };
    }
    if (type === "all-goal-actions-resolved") {
      if (!actions) fail("GOAL_COMPLETION_RECORD_CORRUPT");
      const unresolved = actions.intents.filter((item) =>
        ["draft", "prepared", "running"].includes(item[1]),
      ).length;
      return {
        id: criterionId,
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
    if (!review) fail("GOAL_COMPLETION_RECORD_CORRUPT");
    if (review.evaluation.status !== "evaluated")
      return {
        id: criterionId,
        type,
        met: false,
        reason: "source-insufficient",
        observation: {
          sourceStatus: review.evaluation.status,
          reasonCodes: review.evaluation.reasonCodes,
        },
      };
    if (type === "all-tasks-completed") {
      const tasks = review.sourceSnapshot.tasks,
        incomplete = tasks.filter((task) => task.status !== "completed").length;
      return {
        id: criterionId,
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
    const riskTasks = review.evaluation.tasks.filter((task) =>
      task.reasonCodes.some((code) => assertion.reasonCodes.includes(code)),
    );
    return {
      id: criterionId,
      type,
      met: riskTasks.length === 0,
      reason: riskTasks.length
        ? "selected-risk-signals-present"
        : "selected-risk-signals-cleared",
      observation: {
        reasonCodes: assertion.reasonCodes,
        riskTaskCount: riskTasks.length,
        ruleVersion: review.evaluation.ruleVersion,
      },
    };
  }
  _check(goal, actor, plan, input, mode) {
    const reportId = `acceptance-check-${randomUUID()}`,
      started = epoch(this.clock());
    this.usage.reserve({
      goal,
      actor,
      operationId: reportId,
      domain: "native-verifier",
      estimate: ESTIMATE,
    });
    const needsTasks = plan.assertions.some(
      (assertion) => assertion.type !== "all-goal-actions-resolved",
    );
    const review = needsTasks
      ? this.risk.evaluateInTransaction({ projectId: goal.projectRef.id })
      : null;
    const sourceDigest = review
      ? this.db
          .prepare(
            "SELECT content_digest FROM cc_project_risk_reviews WHERE id=? AND actor_did=?",
          )
          .get(review.review.id, actor).content_digest
      : null;
    const acks = this._accepted(goal, actor);
    const actions = plan.assertions.some(
      (assertion) => assertion.type === "all-goal-actions-resolved",
    )
      ? this._actionSource(goal, actor, reportId)
      : null;
    const criteria = goal.acceptanceCriteria.map((criterion) => {
      const assertion = plan.assertions.find(
        (item) => item.criterionId === criterion.id,
      );
      if (criterion.kind !== "manual" && !assertion)
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      return this._derive(
        criterion.id,
        criterion.kind === "manual" ? "manual" : assertion.type,
        assertion,
        review,
        acks,
        actions,
      );
    });
    const checkedAt = epoch(this.clock()),
      elapsedMs = checkedAt - started;
    if (elapsedMs < 0) fail("GOAL_CLOCK_MOVED_BACKWARDS");
    const usage = this.usage.summary(goal, actor);
    const blockedReason =
      goal.expiresAt !== null && checkedAt >= Date.parse(goal.expiresAt)
        ? "GOAL_COMPLETION_EXPIRED"
        : goal.budgetPolicy.maxTimeMs !== null &&
            (usage.elapsedMs === null ||
              usage.knownElapsedMs + usage.reservedElapsedMs + elapsedMs >
                goal.budgetPolicy.maxTimeMs)
          ? "GOAL_COMPLETION_BUDGET_EXCEEDED"
          : null;
    const met =
      criteria.every((criterion) => criterion.met) && blockedReason === null;
    const ackIds = [
      ...new Set(
        criteria
          .filter((criterion) => criterion.type === "manual" && criterion.met)
          .map((criterion) => criterion.observation.acknowledgementId),
      ),
    ];
    return this._save(
      {
        schema: "chainlesschain.goal-acceptance-check/v1",
        id: reportId,
        ...this._binding(goal),
        requestId: input.requestId,
        inputDigest: digest({ ...input, mode }),
        mode,
        planId: plan.id,
        planDigest: digest(plan),
        review: review
          ? { id: review.review.id, contentDigest: sourceDigest }
          : null,
        ackIds,
        checkedAt,
        decisionAt: checkedAt,
        actionsSource: actions
          ? { id: actions.id, contentDigest: digest(actions) }
          : null,
        elapsedMs,
        criteria,
        met,
        blockedReason,
        appliedRevision: mode === "complete" && met ? goal.revision + 1 : null,
      },
      "check",
    );
  }
  _report(record, actor) {
    const goal = this._goal(record.goalId, actor);
    const plan = this._byId(record.planId, actor, "plan");
    if (
      plan.goalId !== record.goalId ||
      plan.storeId !== record.storeId ||
      goal.storeId !== record.storeId ||
      plan.goalRevision !== record.goalRevision ||
      plan.controlGeneration !== record.controlGeneration ||
      digest(plan) !== record.planDigest ||
      plan.definitionDigest !== record.definitionDigest
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const expectedIds = [
      ...plan.manualCriterionIds,
      ...plan.assertions.map((item) => item.criterionId),
    ].sort();
    if (
      digest(expectedIds) !==
      digest(record.criteria.map((item) => item.id).sort())
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    let review = null;
    if (record.review) {
      review = this.risk._readReview(record.review.id, actor);
      const row = this.db
        .prepare(
          "SELECT content_digest FROM cc_project_risk_reviews WHERE id=? AND actor_did=?",
        )
        .get(record.review.id, actor);
      if (
        review.review.projectId !== goal.projectRef.id ||
        row.content_digest !== record.review.contentDigest ||
        Date.parse(review.review.createdAt) > record.checkedAt
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
    }
    const acknowledgements = record.ackIds.map((ackId) => {
      const ack = this._byId(ackId, actor, "ack");
      if (
        ack.status !== "accepted" ||
        ack.goalId !== record.goalId ||
        ack.storeId !== record.storeId ||
        ack.goalRevision !== record.goalRevision ||
        ack.controlGeneration !== record.controlGeneration ||
        ack.definitionDigest !== record.definitionDigest ||
        ack.completedAt > record.checkedAt
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      return ack;
    });
    let actions = null;
    if (record.actionsSource) {
      actions = this._byId(record.actionsSource.id, actor, "source");
      if (
        actions.goalId !== record.goalId ||
        actions.storeId !== record.storeId ||
        actions.goalRevision !== record.goalRevision ||
        actions.controlGeneration !== record.controlGeneration ||
        actions.definitionDigest !== record.definitionDigest ||
        digest(actions) !== record.actionsSource.contentDigest ||
        actions.createdAt > record.checkedAt
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      const rows = this.db
        .prepare(
          "SELECT id FROM cc_project_goal_workflow WHERE goal_id=? AND actor_did=? AND kind='intent' AND rowid<=? ORDER BY id LIMIT 501",
        )
        .all(goal.id, actor, actions.watermark);
      if (
        digest(rows.map((row) => row.id)) !==
        digest(actions.intents.map((item) => item[0]).sort())
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
      for (const [intentId, status] of actions.intents) {
        const intent = this.workflow._read(intentId, "intent", actor);
        this.workflow._intentResult(intent, actor);
        if (
          intent.goalId !== record.goalId ||
          intent.goalRevision > record.goalRevision ||
          intent.controlGeneration > record.controlGeneration ||
          (["succeeded", "denied", "cancelled"].includes(status) &&
            intent.status !== status)
        )
          fail("GOAL_COMPLETION_RECORD_CORRUPT");
      }
    }
    for (const criterion of record.criteria) {
      const assertion = plan.assertions.find(
        (item) => item.criterionId === criterion.id,
      );
      const type = plan.manualCriterionIds.includes(criterion.id)
        ? "manual"
        : assertion?.type;
      if (
        type !== criterion.type ||
        digest(criterion) !==
          digest(
            this._derive(
              criterion.id,
              type,
              assertion,
              review,
              acknowledgements,
              actions,
            ),
          )
      )
        fail("GOAL_COMPLETION_RECORD_CORRUPT");
    }
    const usage = this.usage._read(
      this.db
        .prepare("SELECT * FROM cc_project_goal_usage WHERE operation_id=?")
        .get(record.id),
    );
    if (
      !usage ||
      usage.operationId !== record.id ||
      usage.actorDid !== actor ||
      usage.goalId !== record.goalId ||
      usage.goalRevision !== record.goalRevision ||
      usage.controlGeneration !== record.controlGeneration ||
      usage.domain !== "native-verifier" ||
      usage.status !== "settled" ||
      digest(usage.usage) !==
        digest({ ...ESTIMATE, elapsedMs: record.elapsedMs })
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    const proof = goal.completion?.evidenceRefs.find(
      (ref) => ref.kind === "native-goal-completion" && ref.id === record.id,
    );
    if (
      proof &&
      (proof.version !== digest(record) ||
        !record.met ||
        record.appliedRevision !== goal.completion.forRevision ||
        record.definitionDigest !== goal.completion.definitionDigest ||
        goal.completion.verifierRef !== "native.project-delivery-acceptance-v1")
    )
      fail("GOAL_COMPLETION_RECORD_CORRUPT");
    return record;
  }
  _operate(input, mode) {
    options(input, ["goalId", "expectedRevision", "requestId"]);
    id(input.requestId);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(input.goalId, actor);
      const prior = this._read(
        this._row(goal.id, actor, "check", input.requestId),
      );
      if (prior) {
        if (prior.inputDigest !== digest({ ...input, mode }))
          fail("GOAL_COMPLETION_REQUEST_CONFLICT");
        this._report(prior, actor);
        this._authority(goal, actor);
        return clone({
          goal,
          report: prior,
          replayed: true,
          completed:
            goal.status === "done" &&
            goal.completion?.evidenceRefs.some(
              (ref) =>
                ref.kind === "native-goal-completion" &&
                ref.id === prior.id &&
                ref.version === digest(prior),
            ) === true,
        });
      }
      this._live(goal, input.expectedRevision);
      const plan = this._plan(goal, actor);
      let report = this._check(goal, actor, plan, input, mode);
      // Include provisional evidence persistence in the measured check. Usage
      // bookkeeping follows this boundary, while the final CAS checks time again.
      const started = report.checkedAt - report.elapsedMs,
        finished = epoch(this.clock());
      if (finished < report.checkedAt) fail("GOAL_CLOCK_MOVED_BACKWARDS");
      const elapsedMs = finished - started,
        usage = this.usage.summary(goal, actor);
      const blockedReason =
        goal.expiresAt !== null && finished >= Date.parse(goal.expiresAt)
          ? "GOAL_COMPLETION_EXPIRED"
          : goal.budgetPolicy.maxTimeMs !== null &&
              (usage.unknownTime ||
                usage.knownElapsedMs + usage.reservedElapsedMs + elapsedMs >
                  goal.budgetPolicy.maxTimeMs)
            ? "GOAL_COMPLETION_BUDGET_EXCEEDED"
            : null;
      const met =
        report.criteria.every((criterion) => criterion.met) &&
        blockedReason === null;
      report = this._save(
        {
          ...report,
          checkedAt: finished,
          decisionAt: finished,
          elapsedMs,
          blockedReason,
          met,
          appliedRevision:
            mode === "complete" && met ? goal.revision + 1 : null,
        },
        "check",
      );
      this.usage.settle({
        goalId: goal.id,
        actor,
        operationId: report.id,
        status: "settled",
        usage: { ...ESTIMATE, elapsedMs },
      });
      const decisionAt = epoch(this.clock());
      if (decisionAt < report.checkedAt) fail("GOAL_CLOCK_MOVED_BACKWARDS");
      if (goal.expiresAt !== null && decisionAt >= Date.parse(goal.expiresAt))
        report = this._save(
          {
            ...report,
            decisionAt,
            blockedReason: "GOAL_COMPLETION_EXPIRED",
            met: false,
            appliedRevision: null,
          },
          "check",
        );
      else if (decisionAt !== report.decisionAt)
        report = this._save({ ...report, decisionAt }, "check");
      let next = goal;
      if (mode === "complete" && report.met) {
        try {
          next = this.adapter.compareAndSwapInTransaction(
            goal.id,
            goal.revision,
            (current) => {
              // This fresh precondition is after evidence and usage persistence.
              // A known expiry leaves a paid negative report, with no goal mutation.
              this._live(current, goal.revision);
              return completeGoalRecord(
                current,
                {
                  met: true,
                  verifierRef: "native.project-delivery-acceptance-v1",
                  criteriaIds: current.acceptanceCriteria.map(
                    (criterion) => criterion.id,
                  ),
                  evidenceRefs: [
                    {
                      kind: "native-goal-completion",
                      id: report.id,
                      version: digest(report),
                    },
                  ],
                },
                this._stamp(),
              );
            },
          );
        } catch (error) {
          const expiredAt = epoch(this.clock());
          if (
            !["GOAL_COMPLETION_EXPIRED", "GOAL_COMPLETION_NOT_MET"].includes(
              error.code,
            ) ||
            goal.expiresAt === null ||
            expiredAt < Date.parse(goal.expiresAt)
          )
            throw error;
          report = this._save(
            {
              ...report,
              decisionAt: expiredAt,
              blockedReason: "GOAL_COMPLETION_EXPIRED",
              met: false,
              appliedRevision: null,
            },
            "check",
          );
        }
        if (
          next.status === "done" &&
          this.db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_project_goal_monitors'",
            )
            .get()
        ) {
          const monitor = this.db
            .prepare(
              "SELECT revision FROM cc_project_goal_monitors WHERE goal_id=? AND actor_did=?",
            )
            .get(goal.id, actor);
          if (monitor) {
            if (
              !Number.isSafeInteger(monitor.revision) ||
              !Number.isSafeInteger(monitor.revision + 1)
            )
              fail("GOAL_COMPLETION_RECORD_CORRUPT");
            this.db
              .prepare(
                "UPDATE cc_project_goal_monitors SET enabled=0,revision=revision+1 WHERE goal_id=? AND actor_did=?",
              )
              .run(goal.id, actor);
          }
        }
      }
      this._authority(next, actor);
      return clone({
        goal: next,
        report,
        replayed: false,
        completed: next.status === "done",
      });
    });
  }
  inspect(input) {
    return this._operate(input, "check");
  }
  complete(input) {
    return this._operate(input, "complete");
  }
  status(input) {
    options(input, ["goalId"], ["limit", "beforeId"]);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("GOAL_COMPLETION_INVALID_REQUEST");
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(input.goalId, actor);
      const plan = this._read(
        this._row(goal.id, actor, "plan", `revision:${goal.revision}`),
      );
      let cursor = null;
      if (input.beforeId !== undefined) {
        cursor = this.db
          .prepare(
            "SELECT rowid FROM cc_project_goal_acceptance WHERE id=? AND goal_id=? AND actor_did=? AND kind='check'",
          )
          .get(id(input.beforeId), goal.id, actor);
        if (!cursor) fail("GOAL_COMPLETION_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          `SELECT request_id,id FROM cc_project_goal_acceptance WHERE goal_id=? AND actor_did=? AND kind='check'
        ${cursor ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(goal.id, actor, ...(cursor ? [cursor.rowid] : []), limit + 1);
      const reports = rows
        .slice(0, limit)
        .map((row) =>
          this._report(
            this._read(this._row(goal.id, actor, "check", row.request_id)),
            actor,
          ),
        );
      const acks = this._accepted(goal, actor);
      this._authority(goal, actor);
      return clone({
        goal,
        plan,
        acknowledgements: acks,
        reports,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      });
    });
  }
}

module.exports = { ProjectGoalCompletionService };
