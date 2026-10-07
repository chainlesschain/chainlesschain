"use strict";

const { randomUUID } = require("node:crypto");
const {
  digestBusinessObjectContent: digest,
  validateBusinessActionRequest,
} = require("./business-object-contract.js");
const { PersonalProjectGoalService } = require("./project-goal-service.js");
const {
  ProjectRiskReviewService,
} = require("./project-risk-review-service.js");
const { GoalUsageLedger } = require("./goal-usage-ledger.js");
const { ApprovalGate } = require("./approval-gate.js");
const {
  TaskDescriptionActionService,
  TaskCreateActionService,
  MAX_DESCRIPTION_BYTES,
} = require("./task-description-action-service.js");

const ACTIONS = ["task.update-description", "task.create"];
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_RECORDS = 1000;
const MAX_PROPOSALS_PER_CHECK = 100;
const activeNativeIntents = new Set();
const ESTIMATE = Object.freeze({
  runs: 1,
  tokens: 0,
  costUsd: 0,
  elapsedMs: 0,
});
const PROPOSAL_FIELDS = [
  "schema",
  "id",
  "goalId",
  "storeId",
  "actorDid",
  "goalRevision",
  "controlGeneration",
  "projectId",
  "actionType",
  "targetId",
  "sourceTaskId",
  "signalDigest",
  "reviewId",
  "reviewDigest",
  "createdAt",
  "lastSeenAt",
  "intentId",
];
const INTENT_FIELDS = [
  "schema",
  "id",
  "goalId",
  "storeId",
  "actorDid",
  "goalRevision",
  "controlGeneration",
  "proposalId",
  "requestId",
  "inputDigest",
  "description",
  "taskType",
  "reviewId",
  "reviewDigest",
  "createdAt",
  "preview",
  "runId",
  "status",
  "executionStartedAt",
];
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("ACTION_GOAL_INVALID_REQUEST");
  return value;
}
function options(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("ACTION_GOAL_INVALID_REQUEST");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("ACTION_GOAL_INVALID_REQUEST");
  return value;
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    fail("ACTION_GOAL_INVALID_CLOCK");
  return value;
}
function signal(review, taskId) {
  const item = review.evaluation.tasks.find(
    (task) => task.taskRef.id === taskId,
  );
  if (!item) fail("ACTION_GOAL_SIGNAL_MISSING");
  // Row update timestamps and check asOf do not describe a new business risk.
  return digest({
    ruleVersion: review.evaluation.ruleVersion,
    sourceSchema: review.evaluation.sourceSchema,
    taskId,
    dueDate: item.dueDate,
    reasonCodes: [...item.reasonCodes].sort(),
    blockingTaskIds: item.blockingTaskRefs.map((ref) => ref.id).sort(),
  });
}
function reference(intent) {
  return Object.fromEntries(
    [
      "id",
      "goalId",
      "storeId",
      "goalRevision",
      "controlGeneration",
      "proposalId",
    ].map((key) => [key, intent[key]]),
  );
}
function copy(value) {
  return JSON.parse(JSON.stringify(value));
}
function usageError(error) {
  if (error.code === "GOAL_USAGE_UNKNOWN") fail("ACTION_GOAL_USAGE_UNKNOWN");
  if (error.code === "GOAL_USAGE_BUDGET_EXHAUSTED")
    fail("ACTION_GOAL_BUDGET_EXHAUSTED");
  throw error;
}

/** Background suggestions never dispatch writes. A persisted intent is consumed
 * only by the existing native action service and its strict approval gate.
 * Proposals are single-use per semantic signal and goal control generation. */
class ProjectGoalWorkflow {
  constructor({
    db,
    getActor,
    clock = Date.now,
    goals = null,
    risk = null,
    usage = null,
    approvalGate = null,
  } = {}) {
    if (typeof clock !== "function") fail("ACTION_GOAL_INVALID_CLOCK");
    this.db = db;
    this.clock = clock;
    this.goals =
      goals ||
      new PersonalProjectGoalService({
        db,
        getActor,
        now: () => new Date(epoch(clock())).toISOString(),
      });
    this.adapter = this.goals.adapter;
    this.risk =
      risk || new ProjectRiskReviewService({ db, getActor, now: clock });
    this.usage = usage || new GoalUsageLedger({ db });
    if (this.adapter.db !== db || this.risk.db !== db || this.usage.db !== db)
      fail("ACTION_GOAL_DATABASE_MISMATCH");
    this._tx(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_workflow (
      id TEXT PRIMARY KEY,kind TEXT NOT NULL,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,
      record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_cc_project_goal_workflow_scope
      ON cc_project_goal_workflow(goal_id,actor_did,kind,id);
      CREATE TABLE IF NOT EXISTS cc_project_goal_proposal_observations (
        review_id TEXT NOT NULL,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,
        summary_json TEXT NOT NULL,content_digest TEXT NOT NULL,PRIMARY KEY(review_id,goal_id));`),
    );
    const contextAdapter = Object.freeze({
      verify: (value) => this._verify(value),
      record: (value) => this._record(value),
    });
    const services = {
      db,
      getActor,
      now: clock,
      approvalGate: approvalGate || new ApprovalGate(),
      contextAdapter,
    };
    this.descriptionActions = new TaskDescriptionActionService(services);
    this.createActions = new TaskCreateActionService(services);
    // Avoid lazy service construction while a native action transaction is open.
    this.descriptionActions.riskService = this.risk;
    this.createActions.riskService = this.risk;
    this.recoverUnresolved();
  }
  _tx(operation) {
    if (this.db.inTransaction) fail("ACTION_GOAL_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _transactionRequired() {
    if (!this.db.inTransaction) fail("ACTION_GOAL_TRANSACTION_REQUIRED");
  }
  _goal(goalId, actor) {
    const goal = this.adapter._read(id(goalId), actor);
    if (!goal) fail("ACTION_GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _live(goal, binding, actor, actionType = null) {
    if (
      goal.ownerRef !== actor ||
      goal.storeId !== binding.storeId ||
      goal.revision !== binding.goalRevision ||
      goal.controlGeneration !== binding.controlGeneration
    )
      fail("ACTION_GOAL_REVISION_CONFLICT");
    if (goal.status !== "active") fail("ACTION_GOAL_NOT_ACTIVE");
    if (
      !["active", "draft"].includes(
        this.adapter._project(goal.projectRef.id, actor).status,
      )
    )
      fail("ACTION_GOAL_PROJECT_NOT_ACTIVE");
    if (
      goal.expiresAt !== null &&
      epoch(this.clock()) >= Date.parse(goal.expiresAt)
    )
      fail("ACTION_GOAL_EXPIRED");
    if (actionType && !goal.allowedActionTypes.includes(actionType))
      fail("ACTION_GOAL_ACTION_OUT_OF_SCOPE");
  }
  _read(recordId, kind, actor) {
    const row = this.db
      .prepare(
        `SELECT id,kind,goal_id,actor_did,
      CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_RECORD_BYTES}
      THEN record_json ELSE NULL END AS record_json,content_digest
      FROM cc_project_goal_workflow WHERE id=? AND kind=? AND actor_did=?`,
      )
      .get(id(recordId), kind, actor);
    if (!row) fail("ACTION_GOAL_NOT_FOUND_OR_DENIED");
    try {
      const record = JSON.parse(row.record_json);
      const fields = kind === "proposal" ? PROPOSAL_FIELDS : INTENT_FIELDS;
      if (
        !record ||
        Object.keys(record).sort().join(",") !== [...fields].sort().join(",") ||
        record.schema !== `chainlesschain.goal-${kind}/v1` ||
        record.id !== row.id ||
        record.goalId !== row.goal_id ||
        record.actorDid !== row.actor_did ||
        digest(record) !== row.content_digest ||
        !Number.isSafeInteger(record.goalRevision) ||
        record.goalRevision < 1 ||
        !Number.isSafeInteger(record.controlGeneration) ||
        record.controlGeneration < 0
      )
        throw new Error();
      for (const key of ["id", "goalId", "storeId", "actorDid", "reviewId"])
        id(record[key]);
      for (const key of [
        "createdAt",
        ...(kind === "proposal" ? ["lastSeenAt"] : []),
      ])
        epoch(record[key]);
      if (!/^sha256:[a-f0-9]{64}$/u.test(record.reviewDigest))
        throw new Error();
      if (kind === "proposal") {
        for (const key of ["projectId", "targetId", "sourceTaskId"])
          id(record[key]);
        if (
          !ACTIONS.includes(record.actionType) ||
          !/^sha256:[a-f0-9]{64}$/u.test(record.signalDigest)
        )
          throw new Error();
        if (record.intentId !== null) id(record.intentId);
      } else {
        for (const key of ["proposalId", "requestId"]) id(record[key]);
        if (
          ![
            "draft",
            "prepared",
            "running",
            "succeeded",
            "denied",
            "cancelled",
          ].includes(record.status) ||
          typeof record.description !== "string" ||
          !record.description.trim() ||
          Buffer.byteLength(record.description, "utf8") >
            MAX_DESCRIPTION_BYTES ||
          !/^sha256:[a-f0-9]{64}$/u.test(record.inputDigest) ||
          (record.taskType !== null && typeof record.taskType !== "string")
        )
          throw new Error();
        if (record.preview !== null)
          validateBusinessActionRequest(record.preview.request);
        if (
          (record.status === "draft") !== (record.preview === null) ||
          ["draft", "prepared"].includes(record.status) !==
            (record.runId === null)
        )
          throw new Error();
        if (record.runId !== null) id(record.runId);
        if (record.executionStartedAt !== null)
          epoch(record.executionStartedAt);
      }
      return record;
    } catch {
      fail("ACTION_GOAL_RECORD_CORRUPT");
    }
  }
  _save(record, kind) {
    this._transactionRequired();
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body, "utf8") > MAX_RECORD_BYTES)
      fail("ACTION_GOAL_RECORD_LIMIT");
    const existing = this.db
      .prepare(
        "SELECT kind,goal_id,actor_did FROM cc_project_goal_workflow WHERE id=?",
      )
      .get(record.id);
    if (
      existing &&
      (existing.kind !== kind ||
        existing.goal_id !== record.goalId ||
        existing.actor_did !== record.actorDid)
    )
      fail("ACTION_GOAL_RECORD_CORRUPT");
    if (
      !existing &&
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_workflow WHERE goal_id=? AND actor_did=? AND kind=?",
        )
        .get(record.goalId, record.actorDid, kind).n >=
        MAX_RECORDS / 2
    )
      fail("ACTION_GOAL_RECORD_LIMIT");
    this.db
      .prepare(
        `INSERT INTO cc_project_goal_workflow VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        record.id,
        kind,
        record.goalId,
        record.actorDid,
        body,
        digest(record),
      );
    return record;
  }
  _source(
    proposal,
    actor,
    reviewId = proposal.reviewId,
    reviewDigest = proposal.reviewDigest,
    fresh = true,
  ) {
    const { review, contentDigest } = this._review(reviewId, actor);
    if (
      review.review.projectId !== proposal.projectId ||
      contentDigest !== reviewDigest ||
      review.evaluation.status !== "evaluated" ||
      signal(review, proposal.sourceTaskId) !== proposal.signalDigest
    )
      fail("ACTION_GOAL_SOURCE_CONFLICT");
    if (fresh)
      this.risk._actionContext(
        {
          reviewId,
          contentDigest: reviewDigest,
          ...(proposal.actionType === "task.create"
            ? { projectId: proposal.projectId }
            : { taskId: proposal.targetId }),
        },
        actor,
      );
    return review;
  }
  _review(reviewId, actor) {
    this._transactionRequired();
    const review = this.risk._readReview(reviewId, actor);
    // The risk service has independently verified this digest with its own
    // 2 MiB snapshot bounds. Action-request JSON bounds are deliberately smaller.
    const contentDigest = this.db
      .prepare(
        "SELECT content_digest FROM cc_project_risk_reviews WHERE id=? AND actor_did=?",
      )
      .get(reviewId, actor).content_digest;
    return { review, contentDigest };
  }
  /** Called by the monitoring host inside the review/check transaction. */
  observeInTransaction({ goalId, reviewId }) {
    this._transactionRequired();
    const actor = this.adapter._actor();
    const goal = this._goal(goalId, actor);
    this._live(
      goal,
      {
        storeId: goal.storeId,
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
      },
      actor,
    );
    const { review, contentDigest } = this._review(id(reviewId), actor);
    if (review.review.projectId !== goal.projectRef.id)
      fail("ACTION_GOAL_SOURCE_CONFLICT");
    if (review.evaluation.status !== "evaluated") return [];
    const result = [];
    let available =
      MAX_RECORDS / 2 -
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_workflow WHERE goal_id=? AND actor_did=? AND kind='proposal'",
        )
        .get(goal.id, actor).n;
    let newProposals = 0,
      omitted = 0;
    for (const task of review.evaluation.tasks)
      for (const actionType of ACTIONS) {
        const identity = {
          storeId: goal.storeId,
          goalId: goal.id,
          goalRevision: goal.revision,
          controlGeneration: goal.controlGeneration,
          actionType,
          sourceTaskId: task.taskRef.id,
          signalDigest: signal(review, task.taskRef.id),
        };
        const proposalId = `goal-proposal-${digest(identity).slice(7)}`;
        const exists = this.db
          .prepare("SELECT 1 FROM cc_project_goal_workflow WHERE id=?")
          .get(proposalId);
        const prior = exists ? this._read(proposalId, "proposal", actor) : null;
        if (
          !prior &&
          (available <= 0 || newProposals >= MAX_PROPOSALS_PER_CHECK)
        ) {
          omitted++;
          continue;
        }
        const proposal = prior || {
          schema: "chainlesschain.goal-proposal/v1",
          id: proposalId,
          ...identity,
          actorDid: actor,
          projectId: goal.projectRef.id,
          targetId:
            actionType === "task.create" ? goal.projectRef.id : task.taskRef.id,
          reviewId,
          reviewDigest: contentDigest,
          createdAt: epoch(this.clock()),
          lastSeenAt: epoch(this.clock()),
          intentId: null,
        };
        // A prepared intent retains the exact historical source it previewed.
        this._save(
          {
            ...proposal,
            reviewId,
            reviewDigest: contentDigest,
            lastSeenAt: epoch(this.clock()),
          },
          "proposal",
        );
        result.push(proposalId);
        if (!prior) {
          available--;
          newProposals++;
        }
      }
    if (this.adapter._actor() !== actor) fail("ACTION_GOAL_AUTHORITY_CHANGED");
    const summary = {
      schema: "chainlesschain.goal-proposal-observation/v1",
      goalId: goal.id,
      reviewId,
      candidateCount: review.evaluation.tasks.length * ACTIONS.length,
      savedCount: result.length,
      omittedCount: omitted,
      newCount: newProposals,
      status: omitted ? "truncated" : "complete",
    };
    this.db
      .prepare(
        "INSERT INTO cc_project_goal_proposal_observations VALUES (?,?,?,?,?) ON CONFLICT(review_id,goal_id) DO NOTHING",
      )
      .run(reviewId, goal.id, actor, JSON.stringify(summary), digest(summary));
    return summary;
  }
  list(input) {
    options(input, ["goalId"], ["afterId", "limit"]);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("ACTION_GOAL_INVALID_REQUEST");
    if (input.afterId !== undefined) id(input.afterId);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(input.goalId, actor);
      if (
        input.afterId !== undefined &&
        this._read(input.afterId, "proposal", actor).goalId !== goal.id
      )
        fail("ACTION_GOAL_INVALID_CURSOR");
      const rows = this.db
        .prepare(
          `SELECT id FROM cc_project_goal_workflow WHERE kind='proposal' AND goal_id=?
        AND actor_did=? AND id>? ORDER BY id LIMIT ?`,
        )
        .all(goal.id, actor, input.afterId ?? "", limit + 1);
      const proposals = rows.slice(0, limit).map(({ id: proposalId }) => {
        const proposal = this._read(proposalId, "proposal", actor);
        this._source(proposal, actor, undefined, undefined, false);
        const intent =
          proposal.intentId === null
            ? null
            : this._read(proposal.intentId, "intent", actor);
        return {
          proposal,
          intent: intent ? this._intentResult(intent, actor) : null,
          current:
            goal.revision === proposal.goalRevision &&
            goal.controlGeneration === proposal.controlGeneration &&
            goal.status === "active" &&
            goal.allowedActionTypes.includes(proposal.actionType) &&
            (goal.expiresAt === null ||
              epoch(this.clock()) < Date.parse(goal.expiresAt)),
        };
      });
      if (this.adapter._actor() !== actor)
        fail("ACTION_GOAL_AUTHORITY_CHANGED");
      const observation = this.db
        .prepare(
          "SELECT * FROM cc_project_goal_proposal_observations WHERE goal_id=? AND actor_did=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(goal.id, actor);
      let summary = null;
      if (observation) {
        try {
          if (Buffer.byteLength(observation.summary_json, "utf8") > 4096)
            throw new Error();
          summary = JSON.parse(observation.summary_json);
          if (
            summary.schema !== "chainlesschain.goal-proposal-observation/v1" ||
            summary.goalId !== goal.id ||
            summary.reviewId !== observation.review_id ||
            digest(summary) !== observation.content_digest ||
            ![
              summary.candidateCount,
              summary.savedCount,
              summary.omittedCount,
              summary.newCount,
            ].every((v) => Number.isSafeInteger(v) && v >= 0) ||
            summary.savedCount + summary.omittedCount !==
              summary.candidateCount ||
            summary.newCount > MAX_PROPOSALS_PER_CHECK ||
            summary.status !== (summary.omittedCount ? "truncated" : "complete")
          )
            throw new Error();
          this.risk._readReview(summary.reviewId, actor);
        } catch {
          fail("ACTION_GOAL_RECORD_CORRUPT");
        }
      }
      return copy({
        proposals,
        summary,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      });
    });
  }
  prepare(input) {
    options(
      input,
      ["goalId", "proposalId", "expectedRevision", "requestId", "description"],
      ["taskType"],
    );
    id(input.requestId);
    if (
      typeof input.description !== "string" ||
      !input.description.trim() ||
      Buffer.byteLength(input.description, "utf8") > MAX_DESCRIPTION_BYTES
    )
      fail("ACTION_GOAL_INVALID_REQUEST");
    const inputDigest = digest(input);
    const draft = this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(input.goalId, actor);
      if (goal.revision !== input.expectedRevision)
        fail("ACTION_GOAL_REVISION_CONFLICT");
      const proposal = this._read(input.proposalId, "proposal", actor);
      if (proposal.goalId !== goal.id) fail("ACTION_GOAL_NOT_FOUND_OR_DENIED");
      this._live(goal, proposal, actor, proposal.actionType);
      if (
        proposal.actionType === "task.create"
          ? ![
              "create_file",
              "edit_file",
              "query_info",
              "analyze_data",
              "export_file",
              "deploy_project",
            ].includes(input.taskType)
          : input.taskType !== undefined
      )
        fail("ACTION_GOAL_INVALID_REQUEST");
      if (proposal.intentId !== null) {
        const prior = this._read(proposal.intentId, "intent", actor);
        if (
          prior.requestId !== input.requestId ||
          prior.inputDigest !== inputDigest
        )
          fail("ACTION_GOAL_INTENT_CONFLICT");
        return prior;
      }
      this._source(proposal, actor);
      const reused = this.db
        .prepare(
          "SELECT id FROM cc_project_goal_workflow WHERE kind='intent' AND goal_id=? AND actor_did=?",
        )
        .all(goal.id, actor);
      if (
        reused.some(
          ({ id: intentId }) =>
            this._read(intentId, "intent", actor).requestId === input.requestId,
        )
      )
        fail("ACTION_GOAL_INTENT_CONFLICT");
      const intent = {
        schema: "chainlesschain.goal-intent/v1",
        id: `goal-intent-${randomUUID()}`,
        goalId: goal.id,
        storeId: goal.storeId,
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
        proposalId: proposal.id,
        actorDid: actor,
        requestId: input.requestId,
        inputDigest,
        description: input.description,
        taskType: input.taskType ?? null,
        reviewId: proposal.reviewId,
        reviewDigest: proposal.reviewDigest,
        createdAt: epoch(this.clock()),
        preview: null,
        runId: null,
        status: "draft",
        executionStartedAt: null,
      };
      this._save(intent, "intent");
      this._save({ ...proposal, intentId: intent.id }, "proposal");
      if (this.adapter._actor() !== actor)
        fail("ACTION_GOAL_AUTHORITY_CHANGED");
      return intent;
    });
    if (draft.preview !== null) return this.getIntent({ intentId: draft.id });
    const proposal = this._tx(() =>
      this._read(draft.proposalId, "proposal", this.adapter._actor()),
    );
    const service = this._service(proposal.actionType);
    const preview = service.preview({
      description: draft.description,
      idempotencyKey: draft.id,
      reviewId: draft.reviewId,
      goalIntent: reference(draft),
      ...(proposal.actionType === "task.create"
        ? { projectId: proposal.projectId, taskType: draft.taskType }
        : { taskId: proposal.targetId }),
    });
    return this._tx(() => {
      const actor = this.adapter._actor(),
        latest = this._read(draft.id, "intent", actor);
      this._verify({ request: preview.request, actor, phase: "preview" });
      if (latest.preview !== null && digest(latest.preview) !== digest(preview))
        fail("ACTION_GOAL_INTENT_CONFLICT");
      const prepared =
        latest.preview !== null
          ? latest
          : this._save({ ...latest, preview, status: "prepared" }, "intent");
      return copy(this._intentResult(prepared, actor));
    });
  }
  _service(actionType) {
    return actionType === "task.create"
      ? this.createActions
      : this.descriptionActions;
  }
  _verify({ request, actor, phase }) {
    this._transactionRequired();
    if (!["preview", "admission", "before-write", "replay"].includes(phase))
      fail("ACTION_GOAL_INVALID_PHASE");
    const intent = this._read(request.input.goalIntent.id, "intent", actor);
    const proposal = this._read(intent.proposalId, "proposal", actor);
    const goal = this._goal(intent.goalId, actor);
    if (
      proposal.intentId !== intent.id ||
      digest(reference(intent)) !== digest(request.input.goalIntent) ||
      request.idempotencyKey !== intent.id ||
      request.actionType !== proposal.actionType ||
      request.target.id !== proposal.targetId ||
      request.input.description !== intent.description ||
      (proposal.actionType === "task.create" &&
        request.input.taskType !== intent.taskType) ||
      request.input.riskReview?.id !== intent.reviewId ||
      request.input.riskReview.contentDigest !== intent.reviewDigest ||
      (intent.preview !== null &&
        digest(intent.preview.request) !== digest(request))
    )
      fail("ACTION_GOAL_INTENT_CONFLICT");
    this._source(
      proposal,
      actor,
      intent.reviewId,
      intent.reviewDigest,
      phase !== "replay",
    );
    if (phase === "replay") {
      if (intent.runId === null) fail("ACTION_GOAL_INTENT_CONFLICT");
      return { allowed: true };
    }
    if (this.adapter._actor() !== actor) fail("ACTION_GOAL_AUTHORITY_CHANGED");
    this._live(goal, intent, actor, proposal.actionType);
    if (phase === "preview" && !["draft", "prepared"].includes(intent.status))
      fail("ACTION_GOAL_INTENT_CONSUMED");
    if (phase === "admission") {
      if (intent.status !== "prepared") fail("ACTION_GOAL_INTENT_CONSUMED");
      try {
        this.usage.reserve({
          goal,
          actor,
          operationId: intent.id,
          estimate: ESTIMATE,
        });
      } catch (error) {
        usageError(error);
      }
    }
    if (phase === "before-write") {
      if (intent.status !== "running") fail("ACTION_GOAL_INTENT_CONFLICT");
      try {
        this.usage.assertAvailable(goal, actor, { ...ESTIMATE, runs: 0 });
      } catch (error) {
        usageError(error);
      }
      this._save(
        { ...intent, executionStartedAt: epoch(this.clock()) },
        "intent",
      );
    }
    return { allowed: true };
  }
  _record({ request, run, evidence, actor }) {
    this._transactionRequired();
    const intent = this._read(request.input.goalIntent.id, "intent", actor);
    const proposal = this._read(intent.proposalId, "proposal", actor);
    const stored = this.db
      .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
      .get(run.id);
    // Terminal denial may follow logout. This only settles the original admitted
    // operation; it does not resolve a new actor or authorize any business write.
    if (
      !intent.preview ||
      digest(intent.preview.request) !== digest(request) ||
      proposal.intentId !== intent.id ||
      stored?.actor_did !== actor ||
      stored.invocation_digest !== request.invocationDigest ||
      stored.run_json !== JSON.stringify(run) ||
      stored.evidence_json !== JSON.stringify(evidence) ||
      !evidence.some(
        (item) =>
          item.kind === "project-goal-intent" &&
          digest(item.reference) === digest(reference(intent)),
      )
    )
      fail("ACTION_GOAL_INTENT_CONFLICT");
    if (run.status === "running") {
      if (intent.status !== "prepared" || intent.runId !== null)
        fail("ACTION_GOAL_INTENT_CONFLICT");
    } else {
      if (
        intent.runId !== run.id ||
        intent.status !== "running" ||
        !["succeeded", "denied", "cancelled"].includes(run.status)
      )
        fail("ACTION_GOAL_INTENT_CONFLICT");
      if (run.status === "succeeded") {
        const goal = this._goal(intent.goalId, actor);
        this._live(goal, intent, actor, proposal.actionType);
        if (intent.executionStartedAt === null)
          fail("ACTION_GOAL_INTENT_CONFLICT");
        const elapsedMs = epoch(this.clock()) - intent.executionStartedAt;
        if (elapsedMs < 0) fail("ACTION_GOAL_INVALID_CLOCK");
        const usage = this.usage.summary(goal, actor);
        if (
          goal.budgetPolicy.maxTimeMs !== null &&
          (usage.unknownTime ||
            usage.knownElapsedMs + usage.reservedElapsedMs + elapsedMs >
              goal.budgetPolicy.maxTimeMs)
        )
          fail("ACTION_GOAL_TIME_BUDGET_EXHAUSTED");
        this.usage.settle({
          operationId: intent.id,
          actor,
          goalId: intent.goalId,
          status: "settled",
          usage: { ...ESTIMATE, elapsedMs },
        });
      } else {
        const priorUsage = this.usage._read(
          this.db
            .prepare("SELECT * FROM cc_project_goal_usage WHERE operation_id=?")
            .get(intent.id),
        );
        this.usage.settle({
          operationId: intent.id,
          actor,
          goalId: intent.goalId,
          status: priorUsage?.status === "unknown" ? "settled" : "released",
          usage: priorUsage?.status === "unknown" ? priorUsage.usage : null,
        });
      }
    }
    this._save({ ...intent, runId: run.id, status: run.status }, "intent");
    return { recorded: true };
  }
  _intentResult(intent, actor) {
    const proposal = this._read(intent.proposalId, "proposal", actor);
    if (proposal.intentId !== intent.id || proposal.goalId !== intent.goalId)
      fail("ACTION_GOAL_RECORD_CORRUPT");
    this._source(proposal, actor, intent.reviewId, intent.reviewDigest, false);
    let receipt = null;
    if (intent.runId !== null) {
      const row = this.db
        .prepare(
          "SELECT * FROM cc_business_action_runs WHERE id=? AND actor_did=?",
        )
        .get(intent.runId, actor);
      if (!row) fail("ACTION_GOAL_RECORD_CORRUPT");
      receipt = this._service(proposal.actionType)._readRun(row);
      if (
        receipt.run.status !== intent.status ||
        receipt.run.invocationDigest !==
          intent.preview.request.invocationDigest ||
        !receipt.evidence.some(
          (item) =>
            item.kind === "project-goal-intent" &&
            digest(item.reference) === digest(reference(intent)),
        )
      )
        fail("ACTION_GOAL_RECORD_CORRUPT");
    }
    return {
      intent,
      receipt,
      executionState:
        intent.status === "running" ? "unresolved" : intent.status,
    };
  }
  getIntent(input) {
    options(input, ["intentId"]);
    return this._tx(() => {
      const actor = this.adapter._actor(),
        intent = this._read(input.intentId, "intent", actor);
      this._goal(intent.goalId, actor);
      const result = this._intentResult(intent, actor);
      if (this.adapter._actor() !== actor)
        fail("ACTION_GOAL_AUTHORITY_CHANGED");
      return copy(result);
    });
  }
  async execute(input) {
    options(input, ["intentId"]);
    const { intent } = this.getIntent(input);
    if (intent.preview === null) fail("ACTION_GOAL_PREVIEW_REQUIRED");
    const key = `${intent.storeId}:${intent.id}`;
    const alreadyActive = activeNativeIntents.has(key);
    if (!alreadyActive) activeNativeIntents.add(key);
    try {
      return await this._service(intent.preview.request.actionType).execute(
        intent.preview.request,
      );
    } catch (error) {
      if (error.code === "ACTION_OUTCOME_UNKNOWN") {
        try {
          this._tx(() => this._markUnknown(intent, intent.actorDid));
        } catch {}
      }
      throw error;
    } finally {
      if (!alreadyActive) activeNativeIntents.delete(key);
    }
  }
  _markUnknown(intent, actor) {
    const current = this._read(intent.id, "intent", actor);
    if (current.status !== "running") return;
    this.usage.settle({
      operationId: intent.id,
      actor,
      goalId: intent.goalId,
      status: "unknown",
      usage: { ...ESTIMATE, elapsedMs: null },
    });
  }
  /** Recovery never dispatches writes. Live same-process confirmations are
   * excluded; another process conservatively treats unfinished time as unknown. */
  recoverUnresolved() {
    let actor;
    try {
      actor = this.adapter._actor();
    } catch (error) {
      if (
        ["GOAL_IDENTITY_REQUIRED", "GOAL_AUTHORITY_UNAVAILABLE"].includes(
          error.code,
        )
      )
        return { recovered: 0 };
      throw error;
    }
    let afterId = "",
      recovered = 0;
    for (;;) {
      const page = this._tx(() => {
        const rows = this.db
          .prepare(
            `SELECT w.id FROM cc_project_goal_workflow w
          JOIN cc_project_goal_usage u ON u.operation_id=w.id AND u.actor_did=w.actor_did AND u.goal_id=w.goal_id
          WHERE w.actor_did=? AND w.kind='intent' AND w.id>?
          AND json_extract(w.record_json,'$.status')='running'
          AND json_extract(u.record_json,'$.status')='reserved' ORDER BY w.id LIMIT 50`,
          )
          .all(actor, afterId);
        for (const row of rows) {
          const intent = this._read(row.id, "intent", actor);
          if (activeNativeIntents.has(`${intent.storeId}:${intent.id}`))
            continue;
          try {
            this._goal(intent.goalId, actor);
          } catch (error) {
            if (
              [
                "GOAL_NOT_FOUND_OR_DENIED",
                "GOAL_ORGANIZATION_UNSUPPORTED",
              ].includes(error.code)
            )
              continue;
            throw error;
          }
          this._intentResult(intent, actor);
          this._markUnknown(intent, actor);
          recovered++;
        }
        if (this.adapter._actor() !== actor)
          fail("ACTION_GOAL_AUTHORITY_CHANGED");
        return rows;
      });
      if (page.length < 50) return { recovered };
      afterId = page.at(-1).id;
    }
  }
}

module.exports = { ProjectGoalWorkflow };
