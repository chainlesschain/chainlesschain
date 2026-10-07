"use strict";

const { randomUUID } = require("node:crypto");
const {
  digestBusinessObjectContent: digest,
  validateBusinessActionRequest,
} = require("./business-object-contract");
const { goalDefinitionDigest } = require("./goal-contract");
const {
  OrganizationProjectGoalService,
} = require("./organization-project-goal-service");
const {
  readOrganizationTaskActionRun,
} = require("./organization-task-action-service");

const TABLE = "cc_organization_project_goal_workflow";
const OBSERVATIONS = "cc_organization_project_goal_observations";
const ACTIONS = ["task.update-description", "task.create"];
const ESTIMATE = Object.freeze({
  runs: 1,
  tokens: 0,
  costUsd: 0,
  elapsedMs: 0,
});
const MAX_BYTES = 131072;
const activeNativeIntents = new Set();
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
function fields(value, required, optional = []) {
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
  return JSON.parse(JSON.stringify(value));
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    fail("ACTION_GOAL_INVALID_CLOCK");
  return value;
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
function fixedAuthority(value) {
  const { projectSourceRevision, ...fixed } = value;
  return fixed;
}
function signal(review, taskId) {
  const task = review.evaluation.tasks.find(
    (item) => item.taskRef.id === taskId,
  );
  if (!task) fail("ACTION_GOAL_SOURCE_CONFLICT");
  return digest({
    ruleVersion: review.evaluation.ruleVersion,
    sourceSchema: review.evaluation.sourceSchema,
    taskId,
    dueDate: task.dueDate,
    reasonCodes: [...task.reasonCodes].sort(),
    blockingTaskIds: task.blockingTaskRefs.map((ref) => ref.id).sort(),
  });
}

/** Shared suggestions are domain records, not an execution engine. The native
 * task action services remain the sole writer and use this context adapter in
 * their existing admission/confirmation/atomic receipt transaction. */
class OrganizationProjectGoalWorkflow {
  constructor({
    db,
    getActor,
    authority,
    clock = Date.now,
    goals,
    risk,
    usage,
    approvals = null,
    proposals = null,
    descriptionActions = null,
    createActions = null,
  } = {}) {
    if (typeof clock !== "function") fail("ACTION_GOAL_INVALID_CLOCK");
    this.goals =
      goals ||
      new OrganizationProjectGoalService({ db, getActor, authority, clock });
    Object.assign(this, {
      db,
      getActor,
      authority,
      clock,
      approvals,
      proposals,
      descriptionActions,
      createActions,
    });
    this.adapter = this.goals.adapter;
    this.risk = risk || this.goals.risk;
    this.usage = usage || this.goals.usage;
    if (this.adapter.db !== db || this.risk.db !== db || this.usage.db !== db)
      fail("ACTION_GOAL_DATABASE_MISMATCH");
    this.contextAdapter = Object.freeze({
      begin: (value) => this._begin(value),
      verify: (value) => this._verify(value),
      record: (value) => this._record(value),
      finish: (value) => this._finish(value),
    });
    if (approvals) approvals.goalWorkflow = this;
    for (const service of [descriptionActions, createActions])
      if (service) service.contextAdapter = this.contextAdapter;
    this.recoverUnresolved();
  }
  _tx(operation) {
    if (this.db.inTransaction) fail("ACTION_GOAL_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _required() {
    if (!this.db.inTransaction) fail("ACTION_GOAL_TRANSACTION_REQUIRED");
  }
  _goal(goalId, actor) {
    const goal = this.adapter._read(id(goalId), actor);
    if (!goal) fail("ACTION_GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  _permissions(goal, actor, actionType = null, expectedAuthority) {
    let authority;
    for (const permission of [
      "goal.read",
      "risk.read",
      "task.read",
      ...(actionType ? ["goal.propose", actionType] : []),
    ])
      authority = this.adapter._authorize(
        goal.projectRef.id,
        actor,
        permission,
        expectedAuthority,
      );
    return authority;
  }
  _live(goal, record, actor, actionType, { postWrite = false } = {}) {
    if (
      goal.storeId !== record.storeId ||
      goal.revision !== record.goalRevision ||
      goal.controlGeneration !== record.controlGeneration ||
      goalDefinitionDigest(goal) !== record.definitionDigest
    )
      fail("ACTION_GOAL_REVISION_CONFLICT");
    if (goal.status !== "active") fail("ACTION_GOAL_NOT_ACTIVE");
    if (
      goal.expiresAt !== null &&
      epoch(this.clock()) >= Date.parse(goal.expiresAt)
    )
      fail("ACTION_GOAL_EXPIRED");
    if (!goal.allowedActionTypes.includes(actionType))
      fail("ACTION_GOAL_ACTION_OUT_OF_SCOPE");
    if (
      !["active", "draft"].includes(
        this.adapter._project(goal.projectRef.id, actor).status,
      )
    )
      fail("ACTION_GOAL_PROJECT_NOT_ACTIVE");
    const current = this._permissions(
      goal,
      actor,
      actionType,
      postWrite ? undefined : record.authority,
    );
    if (
      postWrite &&
      digest(fixedAuthority(current)) !==
        digest(fixedAuthority(record.authority))
    )
      fail("ACTION_GOAL_AUTHORITY_CHANGED");
  }
  _read(recordId, kind) {
    const row = this.db
      .prepare(
        `SELECT id,kind,goal_id,actor_did,content_digest,CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_BYTES} THEN record_json ELSE NULL END AS record_json FROM ${TABLE} WHERE id=? AND kind=?`,
      )
      .get(id(recordId), kind);
    if (!row) fail("ACTION_GOAL_NOT_FOUND_OR_DENIED");
    try {
      const value = JSON.parse(row.record_json);
      if (
        value.schema !== `chainlesschain.organization-goal-${kind}/v1` ||
        value.id !== row.id ||
        value.goalId !== row.goal_id ||
        value.actorDid !== row.actor_did ||
        digest(value) !== row.content_digest ||
        !Number.isSafeInteger(value.goalRevision) ||
        value.goalRevision < 1 ||
        !Number.isSafeInteger(value.controlGeneration) ||
        value.controlGeneration < 0 ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.definitionDigest) ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.reviewDigest)
      )
        throw new Error();
      for (const key of ["id", "goalId", "storeId", "actorDid", "reviewId"])
        id(value[key]);
      epoch(value.createdAt);
      if (kind === "suggestion") {
        if (
          !ACTIONS.includes(value.actionType) ||
          !/^sha256:[a-f0-9]{64}$/u.test(value.signalDigest)
        )
          throw new Error();
        for (const key of ["projectId", "targetId", "sourceTaskId"])
          id(value[key]);
        if (value.intentId !== null) id(value.intentId);
      } else {
        id(value.proposalId);
        id(value.suggestionId);
        id(value.requestId);
        if (
          value.proposalId !== value.suggestionId ||
          ![
            "draft",
            "prepared",
            "submitting",
            "submitted",
            "running",
            "succeeded",
            "denied",
            "cancelled",
          ].includes(value.status) ||
          typeof value.description !== "string" ||
          !value.description.trim() ||
          Buffer.byteLength(value.description) > 8192 ||
          !/^sha256:[a-f0-9]{64}$/u.test(value.inputDigest)
        )
          throw new Error();
        if (value.preview !== null)
          validateBusinessActionRequest(value.preview.request);
        if (value.runId !== null) id(value.runId);
        if (value.orgProposalId !== null) id(value.orgProposalId);
      }
      return value;
    } catch {
      fail("ACTION_GOAL_RECORD_CORRUPT");
    }
  }
  _save(record, kind) {
    this._required();
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > MAX_BYTES) fail("ACTION_GOAL_RECORD_LIMIT");
    const old = this.db
      .prepare(`SELECT kind,goal_id,actor_did FROM ${TABLE} WHERE id=?`)
      .get(record.id);
    if (
      old &&
      (old.kind !== kind ||
        old.goal_id !== record.goalId ||
        old.actor_did !== record.actorDid)
    )
      fail("ACTION_GOAL_RECORD_CORRUPT");
    if (
      !old &&
      this.db
        .prepare(
          `SELECT count(*) AS n FROM ${TABLE} WHERE goal_id=? AND kind=?`,
        )
        .get(record.goalId, kind).n >= 500
    )
      fail("ACTION_GOAL_RECORD_LIMIT");
    this.db
      .prepare(
        `INSERT INTO ${TABLE} VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,content_digest=excluded.content_digest`,
      )
      .run(
        record.id,
        kind,
        record.goalId,
        record.actorDid,
        json,
        digest(record),
      );
    return record;
  }
  _review(reviewId, actor) {
    const review = this.risk._readReview(id(reviewId), actor);
    return { review, contentDigest: digest(review) };
  }
  _source(
    suggestion,
    actor,
    reviewId = suggestion.reviewId,
    reviewDigest = suggestion.reviewDigest,
    fresh = true,
  ) {
    const { review, contentDigest } = this._review(reviewId, actor);
    if (
      review.review.projectId !== suggestion.projectId ||
      contentDigest !== reviewDigest ||
      review.evaluation.status !== "evaluated" ||
      signal(review, suggestion.sourceTaskId) !== suggestion.signalDigest
    )
      fail("ACTION_GOAL_SOURCE_CONFLICT");
    if (fresh)
      this.risk[
        suggestion.actionType === "task.create"
          ? "verifyCreateActionContext"
          : "verifyActionContext"
      ]({
        reviewId,
        contentDigest: reviewDigest,
        ...(suggestion.actionType === "task.create"
          ? { projectId: suggestion.projectId }
          : { taskId: suggestion.targetId }),
      });
    return review;
  }
  observeInTransaction({ goalId, reviewId }) {
    this._required();
    const actor = this.adapter._actor(),
      goal = this._goal(goalId, actor),
      { review, contentDigest } = this._review(reviewId, actor);
    if (
      review.review.projectId !== goal.projectRef.id ||
      review.review.actorDid !== actor ||
      goal.status !== "active"
    )
      fail("ACTION_GOAL_SOURCE_CONFLICT");
    const actions = ACTIONS.filter((type) =>
      goal.allowedActionTypes.includes(type),
    );
    const tasks =
      review.evaluation.status === "evaluated" ? review.evaluation.tasks : [];
    let available =
        500 -
        this.db
          .prepare(
            `SELECT count(*) AS n FROM ${TABLE} WHERE goal_id=? AND kind='suggestion'`,
          )
          .get(goal.id).n,
      savedCount = 0,
      newCount = 0,
      omittedCount = 0;
    for (const task of tasks)
      for (const actionType of actions) {
        const identity = {
          storeId: goal.storeId,
          goalId: goal.id,
          goalRevision: goal.revision,
          controlGeneration: goal.controlGeneration,
          actionType,
          sourceTaskId: task.taskRef.id,
          signalDigest: signal(review, task.taskRef.id),
        };
        const suggestionId = `org-goal-suggestion-${digest(identity).slice(7)}`;
        const exists = this.db
            .prepare(`SELECT 1 FROM ${TABLE} WHERE id=?`)
            .get(suggestionId),
          prior = exists ? this._read(suggestionId, "suggestion") : null;
        if (!prior && (available <= 0 || newCount >= 100)) {
          omittedCount++;
          continue;
        }
        const suggestion = prior || {
          schema: "chainlesschain.organization-goal-suggestion/v1",
          id: suggestionId,
          ...identity,
          actorDid: actor,
          definitionDigest: goalDefinitionDigest(goal),
          projectId: goal.projectRef.id,
          targetId:
            actionType === "task.create" ? goal.projectRef.id : task.taskRef.id,
          createdAt: epoch(this.clock()),
          intentId: null,
        };
        this._save(
          {
            ...suggestion,
            reviewId,
            reviewDigest: contentDigest,
            authority: review.authority,
            lastSeenAt: epoch(this.clock()),
          },
          "suggestion",
        );
        savedCount++;
        if (!prior) {
          newCount++;
          available--;
        }
      }
    const summary = {
      goalId,
      reviewId,
      candidateCount: tasks.length * actions.length,
      savedCount,
      newCount,
      omittedCount,
      status: omittedCount ? "truncated" : "complete",
    };
    this.db
      .prepare(
        `INSERT INTO ${OBSERVATIONS} VALUES(?,?,?,?) ON CONFLICT(review_id,goal_id) DO NOTHING`,
      )
      .run(reviewId, goalId, JSON.stringify(summary), digest(summary));
    return summary;
  }
  list(input) {
    const value = fields(input, ["goalId"], ["afterId", "limit"]),
      limit = value.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("ACTION_GOAL_INVALID_REQUEST");
    return this._tx(() => {
      const actor = this.adapter._actor(),
        goal = this._goal(value.goalId, actor);
      this._permissions(goal, actor);
      if (
        value.afterId !== undefined &&
        this._read(value.afterId, "suggestion").goalId !== goal.id
      )
        fail("ACTION_GOAL_INVALID_CURSOR");
      const rows = this.db
        .prepare(
          `SELECT id FROM ${TABLE} WHERE goal_id=? AND kind='suggestion' AND id>? ORDER BY id LIMIT ?`,
        )
        .all(goal.id, value.afterId ?? "", limit + 1);
      const currentAuthority = this._permissions(goal, actor);
      const suggestions = rows.slice(0, limit).map((row) => {
        const suggestion = this._read(row.id, "suggestion");
        this._source(suggestion, actor, undefined, undefined, false);
        const claimed = suggestion.intentId
          ? this._read(suggestion.intentId, "intent")
          : null;
        return {
          suggestion,
          current:
            goal.status === "active" &&
            goal.revision === suggestion.goalRevision &&
            goal.controlGeneration === suggestion.controlGeneration &&
            goal.allowedActionTypes.includes(suggestion.actionType) &&
            digest(currentAuthority) ===
              digest((claimed || suggestion).authority) &&
            (goal.expiresAt === null ||
              epoch(this.clock()) < Date.parse(goal.expiresAt)),
          intent: claimed ? this._intentResult(claimed, actor) : null,
        };
      });
      const row = this.db
        .prepare(
          `SELECT * FROM ${OBSERVATIONS} WHERE goal_id=? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(goal.id);
      let summary = null;
      if (row) {
        try {
          if (Buffer.byteLength(row.record_json) > 4096) throw new Error();
          summary = JSON.parse(row.record_json);
          if (
            digest(summary) !== row.content_digest ||
            summary.goalId !== goal.id ||
            summary.reviewId !== row.review_id
          )
            throw new Error();
        } catch {
          fail("ACTION_GOAL_RECORD_CORRUPT");
        }
      }
      return {
        suggestions,
        summary,
        nextCursor:
          rows.length > limit ? suggestions.at(-1).suggestion.id : null,
      };
    });
  }
  prepare(input) {
    const value = fields(
      input,
      [
        "goalId",
        "suggestionId",
        "expectedRevision",
        "requestId",
        "description",
      ],
      ["taskType"],
    );
    id(value.requestId);
    if (
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 1 ||
      typeof value.description !== "string" ||
      !value.description.trim() ||
      Buffer.byteLength(value.description) > 8192
    )
      fail("ACTION_GOAL_INVALID_REQUEST");
    const actor = this.adapter._actor();
    const draft = this._tx(() => {
      const goal = this._goal(value.goalId, actor),
        suggestion = this._read(value.suggestionId, "suggestion");
      if (suggestion.goalId !== goal.id)
        fail("ACTION_GOAL_NOT_FOUND_OR_DENIED");
      if (suggestion.intentId) {
        const prior = this._read(suggestion.intentId, "intent");
        this._permissions(goal, actor);
        if (
          prior.actorDid !== actor ||
          prior.requestId !== value.requestId ||
          prior.inputDigest !== digest(value)
        )
          fail("ACTION_GOAL_INTENT_CONFLICT");
        return prior;
      }
      if (goal.revision !== value.expectedRevision)
        fail("ACTION_GOAL_REVISION_CONFLICT");
      this._live(goal, suggestion, actor, suggestion.actionType);
      this._source(suggestion, actor);
      if (
        suggestion.actionType === "task.create"
          ? ![
              "create_file",
              "edit_file",
              "query_info",
              "analyze_data",
              "export_file",
              "deploy_project",
            ].includes(value.taskType)
          : value.taskType !== undefined
      )
        fail("ACTION_GOAL_INVALID_REQUEST");
      const reused = this.db
        .prepare(
          `SELECT id FROM ${TABLE} WHERE goal_id=? AND kind='intent' AND actor_did=?`,
        )
        .all(goal.id, actor);
      if (
        reused.some(
          (row) => this._read(row.id, "intent").requestId === value.requestId,
        )
      )
        fail("ACTION_GOAL_INTENT_CONFLICT");
      this.usage.assertAvailable(goal, actor, ESTIMATE);
      const intent = {
        schema: "chainlesschain.organization-goal-intent/v1",
        id: `org-goal-intent-${randomUUID()}`,
        goalId: goal.id,
        storeId: goal.storeId,
        goalRevision: goal.revision,
        controlGeneration: goal.controlGeneration,
        definitionDigest: goalDefinitionDigest(goal),
        authority: this._permissions(goal, actor, suggestion.actionType),
        proposalId: suggestion.id,
        suggestionId: suggestion.id,
        actorDid: actor,
        requestId: value.requestId,
        inputDigest: digest(value),
        description: value.description,
        taskType: value.taskType ?? null,
        reviewId: suggestion.reviewId,
        reviewDigest: suggestion.reviewDigest,
        createdAt: epoch(this.clock()),
        preview: null,
        runId: null,
        status: "draft",
        executionStartedAt: null,
        orgProposalId: null,
        workflowId: null,
        submitDigest: null,
      };
      this._save(intent, "intent");
      this._save({ ...suggestion, intentId: intent.id }, "suggestion");
      return intent;
    });
    if (draft.preview) return this.getIntent({ intentId: draft.id });
    const suggestion = this._tx(() =>
        this._read(draft.suggestionId, "suggestion"),
      ),
      service = this._service(suggestion.actionType);
    const preview = service.preview({
      description: draft.description,
      idempotencyKey: draft.id,
      reviewId: draft.reviewId,
      goalIntent: reference(draft),
      ...(suggestion.actionType === "task.create"
        ? { projectId: suggestion.projectId, taskType: draft.taskType }
        : { taskId: suggestion.targetId }),
    });
    return this._tx(() => {
      if (this.adapter._actor() !== actor)
        fail("ACTION_GOAL_AUTHORITY_CHANGED");
      const intent = this._read(draft.id, "intent");
      this._verify({ request: preview.request, actor, phase: "preview" });
      if (intent.preview && digest(intent.preview) !== digest(preview))
        fail("ACTION_GOAL_INTENT_CONFLICT");
      return this._intentResult(
        this._save({ ...intent, preview, status: "prepared" }, "intent"),
        actor,
      );
    });
  }
  _service(actionType) {
    const service =
      actionType === "task.create"
        ? this.createActions
        : this.descriptionActions;
    if (!service) fail("ACTION_GOAL_ACTION_SERVICE_REQUIRED");
    return service;
  }
  _bound(request) {
    const intent = this._read(request.input.goalIntent.id, "intent"),
      suggestion = this._read(intent.suggestionId, "suggestion");
    if (
      suggestion.intentId !== intent.id ||
      suggestion.goalId !== intent.goalId ||
      digest(reference(intent)) !== digest(request.input.goalIntent) ||
      request.idempotencyKey !== intent.id ||
      request.actionType !== suggestion.actionType ||
      request.target.id !== suggestion.targetId ||
      request.target.scope.kind !== "organization" ||
      request.target.scope.id !== intent.authority.scope.id ||
      request.input.description !== intent.description ||
      (suggestion.actionType === "task.create" &&
        request.input.taskType !== intent.taskType) ||
      request.input.riskReview?.id !== intent.reviewId ||
      request.input.riskReview?.contentDigest !== intent.reviewDigest ||
      (intent.preview && digest(intent.preview.request) !== digest(request))
    )
      fail("ACTION_GOAL_INTENT_CONFLICT");
    return { intent, suggestion };
  }
  _verify({ request, actor, phase }) {
    this._required();
    if (!["preview", "admission", "before-write", "replay"].includes(phase))
      fail("ACTION_GOAL_INVALID_PHASE");
    const { intent, suggestion } = this._bound(request),
      goal = this._goal(intent.goalId, actor);
    if (intent.actorDid !== actor) fail("ACTION_GOAL_AUTHORITY_CHANGED");
    this._permissions(goal, actor);
    this._source(
      suggestion,
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
    this._live(goal, intent, actor, suggestion.actionType);
    if (phase === "preview" && !["draft", "prepared"].includes(intent.status))
      fail("ACTION_GOAL_INTENT_CONSUMED");
    if (phase === "admission") {
      if (intent.status !== "submitted" || !intent.orgProposalId)
        fail("ACTION_GOAL_INTENT_CONSUMED");
      this.usage.reserve({
        goal,
        actor,
        operationId: intent.id,
        estimate: ESTIMATE,
      });
    }
    if (phase === "before-write") {
      if (intent.status !== "running") fail("ACTION_GOAL_INTENT_CONFLICT");
      this.usage.assertAvailable(goal, actor, { ...ESTIMATE, runs: 0 });
      this._save(
        { ...intent, executionStartedAt: epoch(this.clock()) },
        "intent",
      );
    }
    return { allowed: true };
  }
  verifyApprovalInTransaction({ request, goalIntent, binding, actor, phase }) {
    this._required();
    const intent = this._read(
        (goalIntent || request?.input.goalIntent).id,
        "intent",
      ),
      suggestion = this._read(intent.suggestionId, "suggestion");
    if (!intent.preview) fail("ACTION_GOAL_PREVIEW_REQUIRED");
    this._bound(request || intent.preview.request);
    if (
      binding &&
      (digest(reference(intent)) !== digest(binding.goalIntent) ||
        binding.projectId !== suggestion.projectId ||
        binding.requesterDid !== intent.actorDid ||
        binding.invocationDigest !== intent.preview.request.invocationDigest ||
        binding.actionDigest !== intent.preview.request.actionDigest ||
        digest(binding.authority) !== digest(intent.authority))
    )
      fail("ACTION_GOAL_INTENT_CONFLICT");
    const goal = this._goal(intent.goalId, actor);
    if (phase === "read") {
      this._permissions(goal, actor);
      this._source(
        suggestion,
        actor,
        intent.reviewId,
        intent.reviewDigest,
        false,
      );
      return { allowed: true };
    }
    if (phase === "submit") {
      if (actor !== intent.actorDid || intent.status !== "submitting")
        fail("ACTION_GOAL_INTENT_CONSUMED");
      this._live(goal, intent, actor, suggestion.actionType);
    } else {
      if (
        !["submitted", "running"].includes(intent.status) ||
        !intent.orgProposalId
      )
        fail("ACTION_GOAL_INTENT_CONSUMED");
      // Approvers must independently read the goal and risk. Propose/action
      // grants belong to the fixed executor, not the approving identity.
      this._permissions(goal, actor, null, intent.authority);
      if (
        goal.revision !== intent.goalRevision ||
        goal.controlGeneration !== intent.controlGeneration ||
        goalDefinitionDigest(goal) !== intent.definitionDigest ||
        goal.status !== "active" ||
        !goal.allowedActionTypes.includes(suggestion.actionType)
      )
        fail("ACTION_GOAL_REVISION_CONFLICT");
      if (
        goal.expiresAt !== null &&
        epoch(this.clock()) >= Date.parse(goal.expiresAt)
      )
        fail("ACTION_GOAL_EXPIRED");
      for (const permission of [
        "goal.read",
        "goal.propose",
        "risk.read",
        "task.read",
        suggestion.actionType,
      ])
        this.authority._authorization(
          goal.projectRef.id,
          intent.actorDid,
          permission,
          intent.authority,
        );
    }
    this._source(suggestion, actor, intent.reviewId, intent.reviewDigest);
    return { allowed: true };
  }
  submit(input) {
    const value = fields(input, ["intentId", "workflowId"], ["timeoutMs"]);
    id(value.workflowId);
    if (
      value.timeoutMs !== undefined &&
      (!Number.isSafeInteger(value.timeoutMs) ||
        value.timeoutMs < 1 ||
        value.timeoutMs > 7 * 86400000)
    )
      fail("ACTION_GOAL_INVALID_REQUEST");
    if (!this.proposals || !this.approvals)
      fail("ACTION_GOAL_APPROVAL_SERVICE_REQUIRED");
    return this._tx(() => {
      const actor = this.adapter._actor(),
        intent = this._read(value.intentId, "intent"),
        suggestion = this._read(intent.suggestionId, "suggestion"),
        goal = this._goal(intent.goalId, actor);
      this._permissions(goal, actor);
      if (actor !== intent.actorDid) fail("ACTION_GOAL_AUTHORITY_CHANGED");
      if (intent.orgProposalId) {
        if (intent.submitDigest !== digest(value))
          fail("ACTION_GOAL_INTENT_CONFLICT");
        return this._intentResult(intent, actor);
      }
      if (intent.status !== "prepared" || !intent.preview)
        fail("ACTION_GOAL_PREVIEW_REQUIRED");
      this._live(goal, intent, actor, suggestion.actionType);
      this._source(suggestion, actor, intent.reviewId, intent.reviewDigest);
      this._save(
        {
          ...intent,
          status: "submitting",
          workflowId: value.workflowId,
          submitDigest: digest(value),
        },
        "intent",
      );
      const proposal = this.proposals.submitInTransaction({
        projectId: goal.projectRef.id,
        workflowId: value.workflowId,
        request: intent.preview.request,
        ...(value.timeoutMs !== undefined
          ? { timeoutMs: value.timeoutMs }
          : {}),
      });
      const saved = this._save(
        {
          ...intent,
          status: "submitted",
          workflowId: value.workflowId,
          submitDigest: digest(value),
          orgProposalId: proposal.proposalId,
        },
        "intent",
      );
      if (this.adapter._actor() !== actor)
        fail("ACTION_GOAL_AUTHORITY_CHANGED");
      return this._intentResult(saved, actor);
    });
  }
  _record({ request, run, evidence, actor }) {
    this._required();
    const { intent, suggestion } = this._bound(request),
      row = this.db
        .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
        .get(run.id);
    if (
      intent.actorDid !== actor ||
      !intent.preview ||
      row?.actor_did !== actor ||
      row.invocation_digest !== request.invocationDigest ||
      row.run_json !== JSON.stringify(run) ||
      row.evidence_json !== JSON.stringify(evidence) ||
      !evidence.some(
        (item) =>
          item.kind === "project-goal-intent" &&
          digest(item.reference) === digest(reference(intent)),
      )
    )
      fail("ACTION_GOAL_INTENT_CONFLICT");
    if (run.status === "running") {
      if (intent.status !== "submitted" || intent.runId !== null)
        fail("ACTION_GOAL_INTENT_CONFLICT");
      activeNativeIntents.add(`${intent.storeId}:${intent.id}`);
    } else {
      if (
        intent.status !== "running" ||
        intent.runId !== run.id ||
        !["succeeded", "cancelled", "denied"].includes(run.status)
      )
        fail("ACTION_GOAL_INTENT_CONFLICT");
      if (run.status === "succeeded") {
        const goal = this._goal(intent.goalId, actor);
        this._live(goal, intent, actor, suggestion.actionType, {
          postWrite: true,
        });
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
        const prior = this.usage._read(
          this.db
            .prepare(`SELECT * FROM ${this.usage.table} WHERE operation_id=?`)
            .get(intent.id),
        );
        this.usage.settle({
          operationId: intent.id,
          actor,
          goalId: intent.goalId,
          status: prior?.status === "unknown" ? "settled" : "released",
          usage: prior?.status === "unknown" ? prior.usage : null,
        });
      }
    }
    this._save({ ...intent, runId: run.id, status: run.status }, "intent");
    return { recorded: true };
  }
  _finish({ request }) {
    const intentId = request?.input.goalIntent?.id;
    if (!intentId) return;
    this._tx(() => {
      const intent = this._read(intentId, "intent");
      activeNativeIntents.delete(`${intent.storeId}:${intent.id}`);
      if (intent.status === "running")
        this.usage.settle({
          operationId: intent.id,
          actor: intent.actorDid,
          goalId: intent.goalId,
          status: "unknown",
          usage: { ...ESTIMATE, elapsedMs: null },
        });
    });
  }
  _begin({ request }) {
    const intentId = request?.input?.goalIntent?.id;
    if (!intentId) return false;
    return this._tx(() => {
      const intent = this._read(intentId, "intent"),
        key = `${intent.storeId}:${intent.id}`;
      if (intent.status !== "submitted" || activeNativeIntents.has(key))
        return false;
      activeNativeIntents.add(key);
      return true;
    });
  }
  recoverUnresolved() {
    let afterId = "",
      recovered = 0;
    for (;;) {
      const rows = this._tx(() => {
        const page = this.db
          .prepare(
            `SELECT id FROM ${TABLE} WHERE kind='intent' AND id>? ORDER BY id LIMIT 50`,
          )
          .all(afterId);
        for (const row of page) {
          const intent = this._read(row.id, "intent");
          if (
            intent.status !== "running" ||
            activeNativeIntents.has(`${intent.storeId}:${intent.id}`)
          )
            continue;
          const stored = this.db
            .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
            .get(intent.runId);
          if (
            stored?.actor_did !== intent.actorDid ||
            stored.invocation_digest !==
              intent.preview?.request.invocationDigest
          )
            fail("ACTION_GOAL_RECORD_CORRUPT");
          const receipt = readOrganizationTaskActionRun(this.db, stored);
          if (
            receipt.run.status !== "running" ||
            !receipt.evidence.some(
              (item) =>
                item.kind === "project-goal-intent" &&
                digest(item.reference) === digest(reference(intent)),
            )
          )
            fail("ACTION_GOAL_RECORD_CORRUPT");
          this.usage.settle({
            operationId: intent.id,
            actor: intent.actorDid,
            goalId: intent.goalId,
            status: "unknown",
            usage: { ...ESTIMATE, elapsedMs: null },
          });
          recovered++;
        }
        return page;
      });
      if (rows.length < 50) return { recovered };
      afterId = rows.at(-1).id;
    }
  }
  _intentResult(intent, actor) {
    const goal = this._goal(intent.goalId, actor),
      suggestion = this._read(intent.suggestionId, "suggestion");
    this._permissions(goal, actor);
    if (
      suggestion.intentId !== intent.id ||
      suggestion.goalId !== intent.goalId
    )
      fail("ACTION_GOAL_RECORD_CORRUPT");
    this._source(
      suggestion,
      actor,
      intent.reviewId,
      intent.reviewDigest,
      false,
    );
    let receipt = null,
      proposal = null;
    if (intent.runId) {
      const row = this.db
        .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
        .get(intent.runId);
      if (row?.actor_did !== intent.actorDid)
        fail("ACTION_GOAL_RECORD_CORRUPT");
      receipt = readOrganizationTaskActionRun(this.db, row);
      if (
        receipt.run.status !== intent.status ||
        receipt.run.invocationDigest !==
          intent.preview?.request.invocationDigest ||
        !receipt.evidence.some(
          (item) =>
            item.kind === "project-goal-intent" &&
            digest(item.reference) === digest(reference(intent)),
        )
      )
        fail("ACTION_GOAL_RECORD_CORRUPT");
      if (
        intent.status === "running" &&
        !activeNativeIntents.has(`${intent.storeId}:${intent.id}`)
      )
        this.usage.settle({
          operationId: intent.id,
          actor: intent.actorDid,
          goalId: intent.goalId,
          status: "unknown",
          usage: { ...ESTIMATE, elapsedMs: null },
        });
    }
    if (intent.orgProposalId) {
      if (!this.proposals) fail("ACTION_GOAL_APPROVAL_SERVICE_REQUIRED");
      const loaded = this.proposals.getInTransaction({
        proposalId: intent.orgProposalId,
      });
      if (
        loaded.requesterDid !== intent.actorDid ||
        loaded.invocationDigest !== intent.preview.request.invocationDigest ||
        loaded.workflowId !== intent.workflowId
      )
        fail("ACTION_GOAL_RECORD_CORRUPT");
      const { request: ignored, ...metadata } = loaded;
      proposal = metadata;
    }
    const visible =
      actor === intent.actorDid
        ? intent
        : Object.fromEntries(
            [
              "id",
              "goalId",
              "storeId",
              "goalRevision",
              "controlGeneration",
              "suggestionId",
              "proposalId",
              "actorDid",
              "createdAt",
              "runId",
              "status",
              "orgProposalId",
              "workflowId",
            ].map((key) => [key, intent[key]]),
          );
    return {
      intent: visible,
      preview: actor === intent.actorDid ? intent.preview : null,
      proposal,
      receipt,
      executionState:
        intent.status === "running" ? "unresolved" : intent.status,
    };
  }
  getIntent(input) {
    const value = fields(input, ["intentId"]);
    return this._tx(() =>
      this._intentResult(
        this._read(value.intentId, "intent"),
        this.adapter._actor(),
      ),
    );
  }
}

module.exports = { OrganizationProjectGoalWorkflow };
