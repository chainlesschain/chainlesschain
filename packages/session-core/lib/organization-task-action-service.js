"use strict";

const { randomUUID } = require("node:crypto");
const {
  TaskDescriptionActionService,
  TaskCreateActionService,
  MAX_DESCRIPTION_BYTES,
} = require("./task-description-action-service");
const {
  createBusinessObjectRef,
  createBusinessActionRequest,
  validateBusinessActionRequest,
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");
const {
  organizationProjectActionTargetVersion,
} = require("./organization-project-approval-service");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("ACTION_INVALID_ID");
  return value;
}
function fields(input, required, optional = []) {
  try {
    digest(input);
  } catch {
    fail("ACTION_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => ![...required, ...optional].includes(key))
  )
    fail("ACTION_INVALID_REQUEST");
}
function text(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > MAX_DESCRIPTION_BYTES
  )
    fail("ACTION_INVALID_DESCRIPTION");
  return value;
}
function limit(value, fallback, max) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max)
    fail("ACTION_INVALID_LIMIT");
  return result;
}

/** Reuses the existing durable admission, native confirmation, terminal status
 * and idempotency engine. Organizations additionally require owner-attested
 * authority and a version-bound multi-level approval consumed in the same
 * final SQLite transaction as the task change and success receipt. */
function organizationActions(Base) {
  return class extends Base {
    constructor({
      authority,
      approvals,
      approvalId = null,
      proposalGuard = null,
      riskService = null,
      ...options
    } = {}) {
      super(options);
      if (
        typeof authority?.assertAuthorizedInTransaction !== "function" ||
        typeof approvals?.verifyApprovedInTransaction !== "function" ||
        typeof approvals?.consumeInTransaction !== "function"
      )
        fail("ORG_APPROVAL_AUTHORITY_REQUIRED");
      if (approvalId !== null) identifier(approvalId);
      this.authority = authority;
      this.approvals = approvals;
      this.approvalId = approvalId;
      if (proposalGuard !== null && typeof proposalGuard !== "function")
        fail("ORG_PROPOSAL_AUTHORITY_REQUIRED");
      this.proposalGuard = proposalGuard;
      this.organizationRiskService = riskService;
    }

    _riskService() {
      if (!this.organizationRiskService) {
        const {
          OrganizationProjectRiskReviewService,
        } = require("./organization-project-risk-review-service");
        this.organizationRiskService = new OrganizationProjectRiskReviewService(
          {
            db: this.db,
            getActor: this.getActor,
            authority: this.authority,
            now: this.now,
          },
        );
      }
      return this.organizationRiskService;
    }

    _isReceiptScope(run, row) {
      return (
        run.target.scope.kind === "organization" &&
        typeof row.actor_did === "string" &&
        row.actor_did.startsWith("did:")
      );
    }
    _additionalSourceEvidence(request, actor) {
      const projectId = this._projectId(request);
      const approval = this.approvals.verifyApprovedInTransaction({
        approvalId: this.approvalId,
        request,
        projectId,
        actorDid: actor,
      });
      return [
        {
          id: randomUUID(),
          kind: "organization-project-authority",
          projectId,
          scope: request.target.scope,
          actorDid: actor,
          invocationDigest: request.invocationDigest,
          actionDigest: request.actionDigest,
          expectedVersion: request.expectedVersion,
          approvalId: approval.approvalId,
          approvalBindingDigest: approval.bindingDigest,
        },
      ];
    }
    _receiptTarget(type) {
      return `${super._receiptTarget(type)} AND CASE WHEN json_valid(run_json) THEN
        CASE WHEN json_extract(run_json,'$.target.scope.kind') IN ('personal','team') THEN 0 ELSE 1 END
        ELSE 1 END`;
    }
    _validateActorScope(request, actor) {
      const projectId = this._projectId(request);
      const authority = this.authority.assertAuthorizedInTransaction({
        projectId,
        actorDid: actor,
        permission: "task.read",
      });
      if (digest(request.target.scope) !== digest(authority.scope))
        fail("ACTION_NOT_FOUND_OR_DENIED");
    }
    _projectId(request) {
      if (request.target.type === "Project") return request.target.id;
      const task = this.db
        .prepare("SELECT project_id FROM project_tasks WHERE id=?")
        .get(request.target.id);
      if (!task) fail("ACTION_NOT_FOUND_OR_DENIED");
      return task.project_id;
    }
    _ownedProject(projectId, actor) {
      this.authority.assertAuthorizedInTransaction({
        projectId,
        actorDid: actor,
        permission: "task.read",
      });
      const columns = new Set(
        this.db
          .prepare("PRAGMA table_info(projects)")
          .all()
          .map((row) => row.name),
      );
      const selected = [
        "id",
        "user_id",
        "status",
        "updated_at",
        ...["deleted", "org_id", "workspace_id"].filter((name) =>
          columns.has(name),
        ),
      ];
      return this.db
        .prepare(`SELECT ${selected.join(",")} FROM projects WHERE id=?`)
        .get(projectId);
    }
    _ownedTask(taskId, actor, { metadataOnly = false } = {}) {
      identifier(taskId);
      let selected = "*";
      if (metadataOnly) {
        const columns = this._taskColumns();
        selected = [
          "id",
          "project_id",
          "status",
          "updated_at",
          ...["deleted", "org_id", "workspace_id"].filter((name) =>
            columns.includes(name),
          ),
        ].join(",");
      } else {
        const size = this._taskColumns()
          .map(
            (name) =>
              `COALESCE(length(CAST("${name.replaceAll('"', '""')}" AS BLOB)),0)`,
          )
          .join("+");
        if (
          this.db
            .prepare(`SELECT ${size} AS bytes FROM project_tasks WHERE id=?`)
            .get(taskId)?.bytes > 65536
        )
          fail("ACTION_SOURCE_INVALID");
      }
      const task = this.db
        .prepare(`SELECT ${selected} FROM project_tasks WHERE id=?`)
        .get(taskId);
      if (!task || (task.deleted != null && task.deleted !== 0))
        fail("ACTION_NOT_FOUND_OR_DENIED");
      return { task, project: this._ownedProject(task.project_id, actor) };
    }
    _ref(type, objectId, projectId, actor) {
      const authority = this.authority.assertAuthorizedInTransaction({
        projectId,
        actorDid: actor,
        permission: "task.read",
      });
      const target = {
        type,
        id: objectId,
        sourceKind:
          type === "Task"
            ? "desktop.project-task"
            : "desktop.project-task-owner",
        scope: authority.scope,
      };
      const version = organizationProjectActionTargetVersion(this.db, {
        projectId,
        target,
        authority,
      });
      return createBusinessObjectRef({ ...target, version });
    }
    _snapshot(taskId, actor) {
      const { task, project } = this._ownedTask(taskId, actor);
      text(task.description);
      return {
        task,
        ref: this._ref("Task", taskId, project.id, actor),
        projectRef: this._ref("Project", project.id, project.id, actor),
      };
    }
    _projectSnapshot(projectId, actor) {
      const project = this._ownedProject(projectId, actor);
      return {
        project,
        task: { description: "" },
        ref: this._ref("Project", projectId, projectId, actor),
      };
    }

    preview(input) {
      const creation = this._targetType() === "Project";
      fields(
        input,
        creation
          ? ["projectId", "taskType", "description", "idempotencyKey"]
          : ["taskId", "description", "idempotencyKey"],
        ["reviewId", "goalIntent"],
      );
      text(input.description);
      identifier(input.idempotencyKey);
      if (input.reviewId !== undefined) {
        identifier(input.reviewId);
        this._riskService();
      }
      return this._transaction(() => {
        const actor = this._actor();
        const snapshot = creation
          ? this._projectSnapshot(input.projectId, actor)
          : this._snapshot(input.taskId, actor);
        const projectId = creation ? input.projectId : snapshot.task.project_id;
        const actionType = creation ? "task.create" : "task.update-description";
        this.authority.assertAuthorizedInTransaction({
          projectId,
          actorDid: actor,
          permission: actionType,
        });
        this._assertNoUnresolvedTask(snapshot.ref.id);
        const request = createBusinessActionRequest({
          actionType,
          actionVersion: 1,
          target: snapshot.ref,
          expectedVersion: snapshot.ref.version,
          input: {
            description: input.description,
            ...(creation ? { taskType: input.taskType } : {}),
            ...(input.goalIntent !== undefined
              ? { goalIntent: input.goalIntent }
              : {}),
            ...(input.reviewId !== undefined
              ? {
                  riskReview: creation
                    ? this._riskService().getCreateActionContext({
                        reviewId: input.reviewId,
                        projectId,
                      })
                    : this._riskService().getActionContext({
                        reviewId: input.reviewId,
                        taskId: input.taskId,
                      }),
                }
              : {}),
          },
          idempotencyKey: input.idempotencyKey,
        });
        this._validateRequest(request);
        this._verifyGoalContext(request, actor, "preview");
        return {
          request,
          before: { description: snapshot.task.description },
          after: request.input,
        };
      });
    }
    _validateRequest(input) {
      let request;
      try {
        request = validateBusinessActionRequest(input);
      } catch {
        fail("ACTION_INVALID_REQUEST");
      }
      const creation = this._targetType() === "Project";
      if (
        request.idempotencyKey.startsWith("org-goal-intent-") &&
        request.input.goalIntent?.id !== request.idempotencyKey
      )
        fail("ACTION_GOAL_INTENT_CONFLICT");
      if (
        request.actionType !==
          (creation ? "task.create" : "task.update-description") ||
        request.actionVersion !== 1 ||
        request.target.type !== this._targetType() ||
        request.target.scope.kind !== "organization" ||
        request.target.sourceKind !==
          (creation ? "desktop.project-task-owner" : "desktop.project-task")
      )
        fail("ACTION_UNSUPPORTED_REQUEST");
      fields(
        request.input,
        creation ? ["description", "taskType"] : ["description"],
        ["riskReview", "goalIntent"],
      );
      if (request.input.goalIntent !== undefined) {
        fields(request.input.goalIntent, [
          "id",
          "goalId",
          "storeId",
          "goalRevision",
          "controlGeneration",
          "proposalId",
        ]);
        for (const key of ["id", "goalId", "storeId", "proposalId"])
          identifier(request.input.goalIntent[key]);
        if (
          !Number.isSafeInteger(request.input.goalIntent.goalRevision) ||
          request.input.goalIntent.goalRevision < 1 ||
          !Number.isSafeInteger(request.input.goalIntent.controlGeneration) ||
          request.input.goalIntent.controlGeneration < 0 ||
          !request.input.riskReview
        )
          fail("ACTION_INVALID_REQUEST");
      }
      if (request.input.riskReview !== undefined) {
        fields(request.input.riskReview, ["id", "contentDigest"]);
        identifier(request.input.riskReview.id);
        if (
          !/^sha256:[a-f0-9]{64}$/u.test(request.input.riskReview.contentDigest)
        )
          fail("ACTION_INVALID_REQUEST");
      }
      text(request.input.description);
      if (
        creation &&
        ![
          "create_file",
          "edit_file",
          "query_info",
          "analyze_data",
          "export_file",
          "deploy_project",
        ].includes(request.input.taskType)
      )
        fail("ACTION_INVALID_TASK_TYPE");
      return request;
    }
    _authorizeRequest(request, actor) {
      this.authority.assertAuthorizedInTransaction({
        projectId: this._projectId(request),
        actorDid: actor,
        permission: request.actionType,
      });
      this._validateActorScope(request, actor);
    }
    async execute(input) {
      const owned =
        input?.input?.goalIntent &&
        typeof this.contextAdapter?.begin === "function"
          ? this.contextAdapter.begin({ request: input })
          : false;
      try {
        return await super.execute(input);
      } finally {
        if (owned && typeof this.contextAdapter?.finish === "function") {
          try {
            this.contextAdapter.finish({ request: input });
          } catch {
            /* Preserve the native result; durable running usage remains reserved. */
          }
        }
      }
    }
    _requestSnapshot(request, actor) {
      this._verifyProposal(request, actor);
      if (!this.approvalId) fail("ORG_APPROVAL_ID_REQUIRED");
      this.approvals.verifyApprovedInTransaction({
        approvalId: this.approvalId,
        request,
        projectId: this._projectId(request),
        actorDid: actor,
      });
      return request.target.type === "Project"
        ? this._projectSnapshot(request.target.id, actor)
        : this._snapshot(request.target.id, actor);
    }
    _verifyProposal(request, actor) {
      if (!this.proposalGuard) return;
      const result = this.proposalGuard({ request, actor });
      if (result && typeof result.then === "function")
        fail("ORG_PROPOSAL_ASYNC_GUARD_DENIED");
      if (result !== true) fail("ORG_PROPOSAL_NOT_FOUND_OR_DENIED");
    }
    _applyRequest(request, actor, latest, { runId }) {
      const organizationApproval = this.approvals.consumeInTransaction({
        approvalId: this.approvalId,
        request,
        projectId: this._projectId(request),
        runId,
        actorDid: actor,
      });
      if (request.actionType !== "task.create") {
        const mutation = {
          ...TaskDescriptionActionService.prototype._applyRequest.call(
            this,
            request,
            actor,
            latest,
          ),
          organizationApproval,
        };
        this._verifyProposal(request, actor);
        return mutation;
      }
      const taskId = randomUUID();
      const updatedAt = Math.max(this.now(), latest.project.updated_at + 1);
      if (!Number.isSafeInteger(updatedAt)) fail("ACTION_SOURCE_INVALID");
      const result = this.db
        .prepare(
          `INSERT INTO project_tasks (id,project_id,task_type,description,status,created_at,updated_at,sync_status)
        VALUES (?,?,?,?,'pending',?,?,'pending')`,
        )
        .run(
          taskId,
          request.target.id,
          request.input.taskType,
          request.input.description,
          updatedAt,
          updatedAt,
        );
      const updated = this.db
        .prepare(
          "UPDATE projects SET updated_at=? WHERE id=? AND updated_at=? AND user_id=?",
        )
        .run(
          updatedAt,
          request.target.id,
          latest.project.updated_at,
          latest.project.user_id,
        );
      if (updated.changes !== 1) fail("ACTION_VERSION_CONFLICT");
      const created = this._snapshot(taskId, actor);
      if (
        created.task.description !== request.input.description ||
        created.task.task_type !== request.input.taskType ||
        created.task.project_id !== request.target.id
      )
        fail("ACTION_POSTCONDITION_FAILED");
      this._verifyProposal(request, actor);
      return {
        kind: "sqlite-task-create",
        affectedRows: result.changes,
        afterVersion: this._projectSnapshot(request.target.id, actor).ref
          .version,
        createdTaskRef: created.ref,
        organizationApproval,
      };
    }
    _readRun(row) {
      const result = super._readRun(row);
      try {
        const sources = result.evidence.filter(
          (item) => item.kind === "organization-project-authority",
        );
        if (sources.length !== 1) fail("ACTION_RECEIPT_CORRUPT");
        const source = sources[0];
        identifier(source.projectId);
        const approval = this.db
          .prepare(
            "SELECT binding_json,binding_digest FROM cc_organization_action_approvals WHERE request_id=?",
          )
          .get(identifier(source.approvalId));
        if (
          !approval ||
          typeof approval.binding_json !== "string" ||
          Buffer.byteLength(approval.binding_json) > 65536
        )
          fail("ACTION_RECEIPT_CORRUPT");
        const binding = JSON.parse(approval.binding_json);
        const riskSources = result.evidence.filter(
          (item) => item.kind === "project-risk-review",
        );
        const goalSources = result.evidence.filter(
          (item) => item.kind === "project-goal-intent",
        );
        if (
          source.actionDigest !== result.run.actionDigest ||
          source.expectedVersion !== result.run.expectedVersion ||
          digest(source.scope) !== digest(result.run.target.scope) ||
          approval.binding_digest !== source.approvalBindingDigest ||
          digest(binding) !== source.approvalBindingDigest ||
          binding.projectId !== source.projectId ||
          binding.invocationDigest !== result.run.invocationDigest ||
          binding.actionDigest !== result.run.actionDigest ||
          binding.expectedVersion !== result.run.expectedVersion ||
          digest(binding.target) !== digest(result.run.target) ||
          (binding.goalIntent
            ? goalSources.length !== 1 ||
              digest(goalSources[0].reference) !== digest(binding.goalIntent) ||
              goalSources[0].actorDid !== binding.requesterDid
            : goalSources.length !== 0) ||
          (binding.riskReview
            ? riskSources.length !== 1 ||
              binding.riskReview.id !== riskSources[0].reviewId ||
              binding.riskReview.contentDigest !== riskSources[0].contentDigest
            : riskSources.length !== 0)
        )
          fail("ACTION_RECEIPT_CORRUPT");
      } catch {
        fail("ACTION_RECEIPT_CORRUPT");
      }
      if (result.run.status !== "succeeded") return result;
      try {
        const execution = result.evidence.find(
          (item) => item.id === result.run.executionRef.id,
        );
        const proof = execution.organizationApproval;
        fields(proof, ["approvalId", "bindingDigest", "runId", "consumedAt"]);
        const approval = this.db
          .prepare(
            "SELECT * FROM cc_organization_action_approvals WHERE request_id=?",
          )
          .get(identifier(proof.approvalId));
        if (
          !approval ||
          approval.consumed_run_id !== result.run.id ||
          proof.runId !== result.run.id ||
          approval.binding_digest !== proof.bindingDigest ||
          approval.consumed_at !== proof.consumedAt ||
          approval.requester_did !== row.actor_did ||
          typeof approval.binding_json !== "string" ||
          Buffer.byteLength(approval.binding_json) > 65536
        )
          fail("ACTION_RECEIPT_CORRUPT");
        const binding = JSON.parse(approval.binding_json);
        if (
          digest(binding) !== proof.bindingDigest ||
          binding.invocationDigest !== result.run.invocationDigest ||
          binding.actionDigest !== result.run.actionDigest ||
          binding.expectedVersion !== result.run.expectedVersion
        )
          fail("ACTION_RECEIPT_CORRUPT");
      } catch {
        fail("ACTION_RECEIPT_CORRUPT");
      }
      return result;
    }

    _authorizeHistory(results) {
      this._transaction(() => {
        const actor = this._actor();
        for (const result of results) {
          const source = result.evidence.find(
            (item) => item.kind === "organization-project-authority",
          );
          if (
            result.run.target.type === "Task" &&
            this._ownedTask(result.run.target.id, actor, { metadataOnly: true })
              .project.id !== source.projectId
          )
            fail("ACTION_NOT_FOUND_OR_DENIED");
          const authority = this.authority.assertAuthorizedInTransaction({
            projectId: source.projectId,
            actorDid: actor,
            permission: "task.read",
          });
          if (digest(authority.scope) !== digest(result.run.target.scope))
            fail("ACTION_NOT_FOUND_OR_DENIED");
        }
      });
    }
    getRun(runId) {
      const result = super.getRun(runId);
      this._authorizeHistory([result]);
      return result;
    }
    listRuns(input) {
      const result = super.listRuns(input);
      this._authorizeHistory(result.runs);
      return result;
    }
    listProjectRuns(input) {
      const result = super.listProjectRuns(input);
      this._authorizeHistory(result.runs);
      return result;
    }

    listTasks(input) {
      fields(input, ["projectId"], ["afterId", "limit"]);
      const count = limit(input.limit, 50, 100);
      return this._readTransaction(() => {
        const project = this._ownedProject(
          identifier(input.projectId),
          this._actor(),
        );
        const deleted = this._taskColumns().includes("deleted")
          ? " AND (deleted IS NULL OR deleted=0)"
          : "";
        if (
          input.afterId !== undefined &&
          !this.db
            .prepare("SELECT 1 FROM project_tasks WHERE id=? AND project_id=?")
            .get(identifier(input.afterId), project.id)
        )
          fail("ACTION_INVALID_CURSOR");
        const rows = this.db
          .prepare(
            `SELECT id,task_type AS taskType,status,substr(description,1,256) AS descriptionPreview,updated_at AS updatedAt
          FROM project_tasks WHERE project_id=?${deleted}${input.afterId !== undefined ? " AND id>?" : ""} ORDER BY id LIMIT ?`,
          )
          .all(
            project.id,
            ...(input.afterId !== undefined ? [input.afterId] : []),
            count + 1,
          );
        const tasks = rows.slice(0, count);
        for (const task of tasks) {
          identifier(task.id);
          if (
            typeof task.taskType !== "string" ||
            task.taskType.length > 80 ||
            typeof task.status !== "string" ||
            task.status.length > 80 ||
            typeof task.descriptionPreview !== "string" ||
            !Number.isSafeInteger(task.updatedAt)
          )
            fail("ACTION_SOURCE_INVALID");
        }
        return {
          project: { id: project.id, status: project.status },
          tasks,
          nextCursor: rows.length > count ? tasks.at(-1).id : null,
        };
      });
    }
    readTask(taskId) {
      return this._readTransaction(() => {
        const actor = this._actor();
        const { task, project } = this._ownedTask(identifier(taskId), actor, {
          metadataOnly: true,
        });
        if (typeof task.status !== "string" || task.status.length > 80)
          fail("ACTION_SOURCE_INVALID");
        const content = this.db
          .prepare(
            "SELECT substr(CAST(description AS BLOB),1,8192) AS prefix,length(CAST(description AS BLOB)) AS bytes,typeof(description) AS kind FROM project_tasks WHERE id=?",
          )
          .get(taskId);
        let description = "",
          reason = null;
        try {
          if (content.kind !== "text" || !Buffer.isBuffer(content.prefix))
            fail("ACTION_SOURCE_INVALID");
          description = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(content.prefix, {
            stream: content.bytes > content.prefix.length,
          });
          if (content.bytes > MAX_DESCRIPTION_BYTES)
            fail("ACTION_DESCRIPTION_TOO_LARGE");
          this.authority.assertAuthorizedInTransaction({
            projectId: project.id,
            actorDid: actor,
            permission: "task.update-description",
          });
          this._snapshot(taskId, actor);
          this._assertNoUnresolvedTask(taskId);
        } catch (error) {
          if (/^(ACTION_|ORG_AUTH_|ORG_APPROVAL_)/u.test(error.code || ""))
            reason = error.code;
          else fail("ACTION_SOURCE_INVALID");
        }
        return {
          taskId,
          projectId: project.id,
          status: task.status,
          description,
          editable: reason === null,
          reason,
        };
      });
    }
  };
}

class OrganizationTaskDescriptionActionService extends organizationActions(
  TaskDescriptionActionService,
) {}
class OrganizationTaskCreateActionService extends organizationActions(
  TaskCreateActionService,
) {}

// Pure durable receipt verification for risk.read histories. Constructing an
// action executor would create tables and introduce unrelated task permissions.
function readOrganizationTaskActionRun(db, row) {
  const reader = Object.create(
    OrganizationTaskDescriptionActionService.prototype,
  );
  reader.db = db;
  return reader._readRun(row);
}

module.exports = {
  OrganizationTaskDescriptionActionService,
  OrganizationTaskCreateActionService,
  readOrganizationTaskActionRun,
};
