"use strict";

const { randomUUID } = require("node:crypto");
const {
  digestBusinessObjectContent: digest,
  validateBusinessActionRequest,
} = require("./business-object-contract");

const SCHEMA = "chainlesschain.organization-action-approval/v1";
const MAX_BYTES = 65536;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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
    fail("ORG_APPROVAL_INVALID_REQUEST");
  return value;
}
function fields(value, keys) {
  try {
    digest(value);
  } catch {
    fail("ORG_APPROVAL_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("ORG_APPROVAL_INVALID_REQUEST");
  return value;
}
function encode(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_BYTES) fail("ORG_APPROVAL_LIMIT_EXCEEDED");
  return text;
}
function decode(text) {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES)
      throw new Error();
    const result = JSON.parse(text);
    digest(result);
    return result;
  } catch {
    fail("ORG_APPROVAL_CORRUPT");
  }
}

/** Shared with the organization action preview/executor. The full task row and
 * the monotonic authority/project fences belong to the target version. */
function organizationProjectActionTargetVersion(
  db,
  { projectId, target, authority },
) {
  identifier(projectId);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .map((row) => row.name),
  );
  const optional = ["deleted", "org_id", "workspace_id"].filter((key) =>
    columns.has(key),
  );
  const project = db
    .prepare(
      `SELECT id,user_id,status,updated_at${optional.map((key) => `,${key}`).join("")} FROM projects WHERE id=?`,
    )
    .get(projectId);
  if (
    !project ||
    !["draft", "active"].includes(project.status) ||
    !Number.isSafeInteger(project.updated_at) ||
    (project.deleted != null && project.deleted !== 0)
  )
    fail("ORG_APPROVAL_TARGET_DENIED");
  if (
    authority?.scope?.kind !== "organization" ||
    target.scope?.kind !== "organization" ||
    target.scope.id !== authority.scope.id ||
    project.workspace_id != null ||
    (project.org_id != null && project.org_id !== authority.scope.id)
  )
    fail("ORG_APPROVAL_TARGET_DENIED");
  const workspaceTable = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_resources'",
    )
    .get();
  if (
    workspaceTable &&
    db
      .prepare(
        "SELECT 1 FROM workspace_resources WHERE resource_type='project' AND resource_id=? LIMIT 1",
      )
      .get(projectId)
  )
    fail("ORG_APPROVAL_TARGET_DENIED");
  if (target.type === "Project") {
    if (
      target.id !== projectId ||
      target.sourceKind !== "desktop.project-task-owner"
    )
      fail("ORG_APPROVAL_TARGET_DENIED");
    return digest({ project, authority });
  }
  if (target.type !== "Task" || target.sourceKind !== "desktop.project-task")
    fail("ORG_APPROVAL_TARGET_DENIED");
  const taskColumns = db.prepare("PRAGMA table_info(project_tasks)").all();
  const sizeExpression = taskColumns
    .map(
      ({ name }) =>
        `COALESCE(length(CAST("${name.replaceAll('"', '""')}" AS BLOB)),0)`,
    )
    .join("+");
  if (!sizeExpression) fail("ORG_APPROVAL_SOURCE_INCOMPLETE");
  const taskSize = db
    .prepare(
      `SELECT (${sizeExpression}) AS bytes FROM project_tasks WHERE id=?`,
    )
    .get(identifier(target.id));
  if (
    taskSize &&
    (!Number.isSafeInteger(taskSize.bytes) || taskSize.bytes > MAX_BYTES)
  )
    fail("ORG_APPROVAL_SOURCE_TOO_LARGE");
  const task = db
    .prepare("SELECT * FROM project_tasks WHERE id=?")
    .get(identifier(target.id));
  if (
    !task ||
    task.project_id !== projectId ||
    task.status !== "pending" ||
    !Number.isSafeInteger(task.updated_at) ||
    (task.deleted != null && task.deleted !== 0) ||
    task.workspace_id != null ||
    (task.org_id != null && task.org_id !== authority.scope.id) ||
    (workspaceTable &&
      db
        .prepare(
          "SELECT 1 FROM workspace_resources WHERE resource_type='task' AND resource_id=? LIMIT 1",
        )
        .get(task.id))
  )
    fail("ORG_APPROVAL_TARGET_DENIED");
  return digest({ project, task, authority });
}

/** Uses the existing workflow step contract, but never trusts legacy approved
 * status or legacy response provenance. No task body or raw idempotency key is
 * persisted. No transaction crosses an await. Execution owns target mutation,
 * durable action receipt and this service's consumption in one transaction. */
class OrganizationProjectApprovalService {
  constructor({
    db,
    getActor,
    authority,
    riskService = null,
    goalWorkflow = null,
    now = () => Date.now(),
  } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("ORG_APPROVAL_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof now !== "function" ||
      [
        "assertAuthorizedInTransaction",
        "assertWorkflowInTransaction",
        "assertApproverInTransaction",
      ].some((key) => typeof authority?.[key] !== "function")
    )
      fail("ORG_APPROVAL_AUTHORITY_REQUIRED");
    Object.assign(this, {
      db,
      getActor,
      authority,
      riskService,
      goalWorkflow,
      now,
    });
    this._transaction(() => {
      for (const table of [
        "approval_workflows",
        "approval_requests",
        "approval_responses",
      ])
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          fail("ORG_APPROVAL_SOURCE_INCOMPLETE");
      db.exec(`CREATE TABLE IF NOT EXISTS cc_organization_action_approvals (
        request_id TEXT PRIMARY KEY REFERENCES approval_requests(id),
        requester_did TEXT NOT NULL, project_id TEXT NOT NULL,
        idempotency_digest TEXT NOT NULL UNIQUE,
        binding_json TEXT NOT NULL, binding_digest TEXT NOT NULL,
        consumed_run_id TEXT UNIQUE, consumed_at INTEGER,
        CHECK((consumed_run_id IS NULL AND consumed_at IS NULL) OR (consumed_run_id IS NOT NULL AND consumed_at IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS cc_organization_action_approval_responses (
        response_id TEXT PRIMARY KEY REFERENCES approval_responses(id),
        request_id TEXT NOT NULL REFERENCES cc_organization_action_approvals(request_id),
        step INTEGER NOT NULL, approver_did TEXT NOT NULL,
        response_digest TEXT NOT NULL, authority_digest TEXT NOT NULL,
        UNIQUE(request_id,step,approver_did)
      );
      CREATE TRIGGER IF NOT EXISTS cc_org_approval_binding_immutable
        BEFORE UPDATE ON cc_organization_action_approvals
        WHEN OLD.request_id IS NOT NEW.request_id OR OLD.requester_did IS NOT NEW.requester_did
          OR OLD.project_id IS NOT NEW.project_id OR OLD.idempotency_digest IS NOT NEW.idempotency_digest
          OR OLD.binding_json IS NOT NEW.binding_json OR OLD.binding_digest IS NOT NEW.binding_digest
          OR OLD.consumed_run_id IS NOT NULL
        BEGIN SELECT RAISE(ABORT,'ORG_APPROVAL_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS cc_org_approval_binding_retained
        BEFORE DELETE ON cc_organization_action_approvals
        BEGIN SELECT RAISE(ABORT,'ORG_APPROVAL_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS cc_org_approval_response_immutable
        BEFORE UPDATE ON cc_organization_action_approval_responses
        BEGIN SELECT RAISE(ABORT,'ORG_APPROVAL_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS cc_org_approval_response_retained
        BEFORE DELETE ON cc_organization_action_approval_responses
        BEGIN SELECT RAISE(ABORT,'ORG_APPROVAL_IMMUTABLE'); END;`);
    });
  }
  _transaction(fn) {
    if (this.db.inTransaction) fail("ORG_APPROVAL_TRANSACTION_BUSY");
    return this.db.transaction(fn).immediate();
  }
  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      fail("ORG_APPROVAL_IDENTITY_REQUIRED");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("ORG_APPROVAL_IDENTITY_REQUIRED");
    return identifier(actor);
  }
  _time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0)
      fail("ORG_APPROVAL_CLOCK_INVALID");
    return value;
  }
  _request(input, projectId) {
    let request;
    try {
      request = validateBusinessActionRequest(input);
    } catch {
      fail("ORG_APPROVAL_INVALID_REQUEST");
    }
    if (
      request.idempotencyKey.startsWith("org-goal-intent-") &&
      request.input.goalIntent?.id !== request.idempotencyKey
    )
      fail("ORG_APPROVAL_GOAL_BINDING_REQUIRED");
    if (
      request.actionVersion !== 1 ||
      request.target.scope.kind !== "organization" ||
      !DIGEST.test(request.expectedVersion) ||
      !(
        (request.actionType === "task.create" &&
          request.target.type === "Project" &&
          request.target.id === projectId) ||
        (request.actionType === "task.update-description" &&
          request.target.type === "Task")
      )
    )
      fail("ORG_APPROVAL_UNSUPPORTED_REQUEST");
    const keys =
      request.actionType === "task.create"
        ? ["description", "taskType"]
        : ["description"];
    fields(request.input, [
      ...keys,
      ...(Object.hasOwn(request.input, "riskReview") ? ["riskReview"] : []),
      ...(Object.hasOwn(request.input, "goalIntent") ? ["goalIntent"] : []),
    ]);
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
        !request.input.riskReview ||
        !Number.isSafeInteger(request.input.goalIntent.goalRevision) ||
        request.input.goalIntent.goalRevision < 1 ||
        !Number.isSafeInteger(request.input.goalIntent.controlGeneration) ||
        request.input.goalIntent.controlGeneration < 0
      )
        fail("ORG_APPROVAL_INVALID_REQUEST");
    }
    if (request.input.riskReview !== undefined) {
      fields(request.input.riskReview, ["id", "contentDigest"]);
      identifier(request.input.riskReview.id);
      if (!DIGEST.test(request.input.riskReview.contentDigest))
        fail("ORG_APPROVAL_INVALID_REQUEST");
    }
    if (
      typeof request.input.description !== "string" ||
      Buffer.byteLength(request.input.description) > 8192
    )
      fail("ORG_APPROVAL_INVALID_REQUEST");
    if (
      request.actionType === "task.create" &&
      ![
        "create_file",
        "edit_file",
        "query_info",
        "analyze_data",
        "export_file",
        "deploy_project",
      ].includes(request.input.taskType)
    )
      fail("ORG_APPROVAL_INVALID_REQUEST");
    return request;
  }
  _authority(projectId, actorDid, permission, expectedAuthority) {
    const result = this.authority.assertAuthorizedInTransaction({
      projectId,
      actorDid,
      permission,
      ...(expectedAuthority ? { expectedAuthority } : {}),
    });
    if (expectedAuthority && digest(result) !== digest(expectedAuthority))
      fail("ORG_APPROVAL_AUTHORITY_CHANGED");
    return result;
  }
  _workflow(projectId, actorDid, workflowId, expectedAuthority) {
    const result = this.authority.assertWorkflowInTransaction({
      projectId,
      actorDid,
      workflowId,
      ...(expectedAuthority ? { expectedAuthority } : {}),
    });
    if (
      expectedAuthority &&
      digest(result.authority) !== digest(expectedAuthority)
    )
      fail("ORG_APPROVAL_AUTHORITY_CHANGED");
    return result;
  }
  _approver(projectId, approverDid, expectedAuthority, riskReview, goalIntent) {
    const result = this.authority.assertApproverInTransaction({
      projectId,
      approverDid,
      expectedAuthority,
    });
    if (digest(result) !== digest(expectedAuthority))
      fail("ORG_APPROVAL_AUTHORITY_CHANGED");
    if (riskReview) {
      if (typeof this.authority._authorization !== "function")
        fail("ORG_APPROVAL_RISK_AUTHORITY_REQUIRED");
      const riskAuthority = this.authority._authorization(
        projectId,
        approverDid,
        "risk.read",
        expectedAuthority,
      );
      if (digest(riskAuthority) !== digest(expectedAuthority))
        fail("ORG_APPROVAL_AUTHORITY_CHANGED");
    }
    if (goalIntent) {
      const current = this.authority._authorization(
        projectId,
        approverDid,
        "goal.read",
        expectedAuthority,
      );
      if (digest(current) !== digest(expectedAuthority))
        fail("ORG_APPROVAL_AUTHORITY_CHANGED");
    }
  }
  _goal(value) {
    if (!value.goalIntent && !value.request?.input.goalIntent) return;
    if (typeof this.goalWorkflow?.verifyApprovalInTransaction !== "function")
      fail("ORG_APPROVAL_GOAL_AUTHORITY_REQUIRED");
    const result = this.goalWorkflow.verifyApprovalInTransaction(value);
    if (result?.allowed !== true || typeof result?.then === "function")
      fail("ORG_APPROVAL_GOAL_CONTEXT_REJECTED");
  }
  _risk(target, riskReview) {
    if (riskReview === undefined) return;
    fields(riskReview, ["id", "contentDigest"]);
    identifier(riskReview.id);
    if (!DIGEST.test(riskReview.contentDigest))
      fail("ORG_APPROVAL_INVALID_REQUEST");
    const method =
      target.type === "Project"
        ? "verifyCreateActionContext"
        : "verifyActionContext";
    if (typeof this.riskService?.[method] !== "function")
      fail("ORG_APPROVAL_RISK_SERVICE_REQUIRED");
    const verified = this.riskService[method]({
      reviewId: riskReview.id,
      contentDigest: riskReview.contentDigest,
      ...(target.type === "Project"
        ? { projectId: target.id }
        : { taskId: target.id }),
    });
    if (digest(verified) !== digest(riskReview))
      fail("ORG_APPROVAL_RISK_BINDING_MISMATCH");
    return verified;
  }
  _plan(workflow, request, actor) {
    if (
      workflow.enabled !== 1 ||
      workflow.org_id !== request.target.scope.id ||
      ![request.target.type.toLowerCase(), "task"].includes(
        workflow.trigger_resource_type,
      ) ||
      workflow.trigger_action !== request.actionType ||
      ![null, undefined, "", "null"].includes(workflow.trigger_conditions) ||
      !["sequential", "parallel", "any_one"].includes(workflow.approval_type) ||
      !Number.isFinite(workflow.timeout_hours) ||
      workflow.timeout_hours <= 0 ||
      workflow.timeout_hours > 8760
    )
      fail("ORG_APPROVAL_WORKFLOW_UNSUPPORTED");
    const raw = decode(workflow.approvers);
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 32)
      fail("ORG_APPROVAL_INVALID_PLAN");
    const steps = raw.map((step) => {
      const actors = typeof step === "string" ? [step] : step;
      if (
        !Array.isArray(actors) ||
        actors.length < 1 ||
        actors.length > 32 ||
        new Set(actors).size !== actors.length
      )
        fail("ORG_APPROVAL_INVALID_PLAN");
      for (const did of actors) {
        identifier(did);
        if (!did.startsWith("did:") || did === actor)
          fail("ORG_APPROVAL_INVALID_PLAN");
      }
      return [...actors].sort();
    });
    return { type: workflow.approval_type, steps };
  }
  submit(input) {
    return this._transaction(() => this.submitInTransaction(input));
  }
  submitInTransaction(input) {
    if (!this.db.inTransaction) fail("ORG_APPROVAL_TRANSACTION_REQUIRED");
    fields(input, [
      "request",
      "projectId",
      "workflowId",
      ...(Object.hasOwn(input, "timeoutMs") ? ["timeoutMs"] : []),
    ]);
    if (
      input.timeoutMs !== undefined &&
      (!Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > 7 * 86400000)
    )
      fail("ORG_APPROVAL_INVALID_REQUEST");
    const projectId = identifier(input.projectId),
      workflowId = identifier(input.workflowId);
    const request = this._request(input.request, projectId);
    const submit = () => {
      const actor = this._actor();
      const authority = this._authority(projectId, actor, request.actionType);
      this._authority(projectId, actor, "task.read", authority);
      if (digest(authority.scope) !== digest(request.target.scope))
        fail("ORG_APPROVAL_TARGET_DENIED");
      const prior = this.db
        .prepare(
          "SELECT request_id FROM cc_organization_action_approvals WHERE idempotency_digest=?",
        )
        .get(request.idempotencyDigest);
      if (prior) {
        const previous = this._load(prior.request_id);
        if (
          previous.binding.invocationDigest !== request.invocationDigest ||
          previous.binding.requesterDid !== actor ||
          previous.binding.workflowId !== workflowId
        )
          fail("ORG_APPROVAL_IDEMPOTENCY_CONFLICT");
        this._responses(previous);
        return this._view(previous);
      }
      this._goal({ request, actor, phase: "submit" });
      const riskReview = this._risk(request.target, request.input.riskReview);
      this._assertNoUnresolvedTarget(projectId, request.target);
      const { workflow } = this._workflow(
        projectId,
        actor,
        workflowId,
        authority,
      );
      const plan = this._plan(workflow, request, actor);
      if (
        organizationProjectActionTargetVersion(this.db, {
          projectId,
          target: request.target,
          authority,
        }) !== request.expectedVersion
      )
        fail("ORG_APPROVAL_VERSION_CONFLICT");
      for (const did of new Set(plan.steps.flat()))
        this._approver(
          projectId,
          did,
          authority,
          riskReview,
          request.input.goalIntent,
        );
      const createdAt = this._time();
      const expiresAt =
        createdAt +
        Math.min(
          Math.ceil(workflow.timeout_hours * 3600000),
          input.timeoutMs ?? Infinity,
        );
      if (!Number.isSafeInteger(expiresAt)) fail("ORG_APPROVAL_CLOCK_INVALID");
      const requestId = randomUUID();
      const binding = {
        schema: SCHEMA,
        requestId,
        projectId,
        workflowId,
        requesterDid: actor,
        target: request.target,
        actionType: request.actionType,
        expectedVersion: request.expectedVersion,
        actionDigest: request.actionDigest,
        invocationDigest: request.invocationDigest,
        inputDigest: request.inputDigest,
        idempotencyDigest: request.idempotencyDigest,
        authority,
        workflowDigest: digest(workflow),
        plan,
        createdAt,
        expiresAt,
        ...(riskReview ? { riskReview } : {}),
        ...(request.input.goalIntent
          ? { goalIntent: request.input.goalIntent }
          : {}),
      };
      const bindingJson = encode(binding),
        bindingDigest = digest(binding);
      this.db
        .prepare(
          `INSERT INTO approval_requests
        (id,workflow_id,org_id,requester_did,resource_type,resource_id,action,request_data,status,current_step,total_steps,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'pending',0,?,?,?)`,
        )
        .run(
          requestId,
          workflowId,
          request.target.scope.id,
          actor,
          request.target.type.toLowerCase(),
          request.target.id,
          request.actionType,
          JSON.stringify({ schema: SCHEMA, bindingDigest }),
          plan.steps.length,
          createdAt,
          createdAt,
        );
      this.db
        .prepare(
          `INSERT INTO cc_organization_action_approvals
        (request_id,requester_did,project_id,idempotency_digest,binding_json,binding_digest) VALUES (?,?,?,?,?,?)`,
        )
        .run(
          requestId,
          actor,
          projectId,
          request.idempotencyDigest,
          bindingJson,
          bindingDigest,
        );
      return this._view(this._load(requestId));
    };
    return submit();
  }
  _load(approvalId) {
    const row = this.db
      .prepare(
        "SELECT * FROM cc_organization_action_approvals WHERE request_id=?",
      )
      .get(identifier(approvalId));
    if (!row) fail("ORG_APPROVAL_NOT_FOUND_OR_DENIED");
    const binding = decode(row.binding_json);
    const request = this.db
      .prepare("SELECT * FROM approval_requests WHERE id=?")
      .get(approvalId);
    if (
      digest(binding) !== row.binding_digest ||
      binding.schema !== SCHEMA ||
      binding.requestId !== approvalId ||
      binding.requesterDid !== row.requester_did ||
      binding.projectId !== row.project_id ||
      binding.idempotencyDigest !== row.idempotency_digest ||
      !request ||
      request.workflow_id !== binding.workflowId ||
      request.org_id !== binding.target.scope.id ||
      request.requester_did !== binding.requesterDid ||
      request.resource_type !== binding.target.type.toLowerCase() ||
      request.resource_id !== binding.target.id ||
      request.action !== binding.actionType ||
      request.total_steps !== binding.plan.steps.length ||
      request.created_at !== binding.createdAt ||
      request.request_data !==
        JSON.stringify({ schema: SCHEMA, bindingDigest: row.binding_digest }) ||
      !Number.isSafeInteger(request.current_step) ||
      request.current_step < 0 ||
      request.current_step >= binding.plan.steps.length ||
      !["pending", "approved", "rejected", "cancelled", "expired"].includes(
        request.status,
      )
    )
      fail("ORG_APPROVAL_CORRUPT");
    return { row, binding, request };
  }
  _assertNoUnresolvedTarget(projectId, target) {
    // Validate unresolved candidates before looking at their JSON target. A
    // malformed admission must not disappear from the lock through SQL JSON
    // filtering. Terminal cancellations and consumed approvals release it.
    const candidates = this.db
      .prepare(
        `SELECT c.request_id
      FROM cc_organization_action_approvals c LEFT JOIN approval_requests r ON r.id=c.request_id
      WHERE c.project_id=? AND c.consumed_run_id IS NULL
        AND (r.id IS NULL OR r.status IS NULL OR r.status NOT IN ('rejected','cancelled','expired'))
      ORDER BY c.request_id LIMIT 1001`,
      )
      .all(projectId);
    if (candidates.length > 1000) fail("ORG_APPROVAL_LIMIT_EXCEEDED");
    const now = this._time();
    for (const candidate of candidates) {
      const loaded = this._load(candidate.request_id);
      this._responses(loaded);
      const other = loaded.binding.target;
      if (
        other.type === target.type &&
        other.id === target.id &&
        digest(other.scope) === digest(target.scope) &&
        loaded.binding.expiresAt > now &&
        ["pending", "approved"].includes(loaded.request.status)
      )
        fail("ORG_APPROVAL_UNRESOLVED_TARGET");
    }
  }
  _view({ row, binding, request }) {
    return {
      approvalId: binding.requestId,
      projectId: binding.projectId,
      requesterDid: binding.requesterDid,
      authority: "recorded-only",
      target: binding.target,
      actionType: binding.actionType,
      actionDigest: binding.actionDigest,
      plan: binding.plan,
      currentStep: request.current_step,
      status: row.consumed_run_id
        ? "consumed"
        : this._time() >= binding.expiresAt &&
            ["pending", "approved"].includes(request.status)
          ? "expired"
          : request.status,
      expiresAt: binding.expiresAt,
      consumedRunId: row.consumed_run_id,
      bindingDigest: row.binding_digest,
    };
  }
  _current(binding, actor, permission) {
    this._goal({
      goalIntent: binding.goalIntent,
      binding,
      actor,
      phase: "approval",
    });
    this._authority(binding.projectId, actor, permission, binding.authority);
    this._authority(binding.projectId, actor, "task.read", binding.authority);
    this._risk(binding.target, binding.riskReview);
    if (binding.riskReview)
      for (const did of new Set(binding.plan.steps.flat()))
        this._approver(
          binding.projectId,
          did,
          binding.authority,
          binding.riskReview,
          binding.goalIntent,
        );
    const { workflow } = this._workflow(
      binding.projectId,
      actor,
      binding.workflowId,
      binding.authority,
    );
    if (digest(workflow) !== binding.workflowDigest)
      fail("ORG_APPROVAL_WORKFLOW_CHANGED");
    if (
      organizationProjectActionTargetVersion(this.db, {
        projectId: binding.projectId,
        target: binding.target,
        authority: binding.authority,
      }) !== binding.expectedVersion
    )
      fail("ORG_APPROVAL_VERSION_CONFLICT");
  }
  get(input) {
    return this._transaction(() => this.getInTransaction(input));
  }
  getInTransaction(input) {
    if (!this.db.inTransaction) fail("ORG_APPROVAL_TRANSACTION_REQUIRED");
    fields(input, ["approvalId"]);
    const loaded = this._load(input.approvalId);
    this._authority(loaded.binding.projectId, this._actor(), "task.read");
    this._goal({
      goalIntent: loaded.binding.goalIntent,
      binding: loaded.binding,
      actor: this._actor(),
      phase: "read",
    });
    this._responses(loaded);
    return this._view(loaded);
  }
  cancel(input) {
    fields(input, ["approvalId"]);
    return this._transaction(() => {
      const actor = this._actor();
      const loaded = this._load(input.approvalId);
      const { binding, request, row } = loaded;
      if (actor !== binding.requesterDid)
        fail("ORG_APPROVAL_NOT_FOUND_OR_DENIED");
      // Cancellation only withdraws this request. A still-authorized reader can
      // cancel a stale action version or policy generation without restoring it.
      this._authority(binding.projectId, actor, "task.read");
      if (row.consumed_run_id) fail("ORG_APPROVAL_ALREADY_CONSUMED");
      if (!["pending", "approved"].includes(request.status))
        fail("ORG_APPROVAL_NOT_PENDING");
      this._responses(loaded);
      const at = this._time();
      const status = at >= binding.expiresAt ? "expired" : "cancelled";
      const changes = this.db
        .prepare(
          `UPDATE approval_requests SET status=?,updated_at=?,completed_at=?
        WHERE id=? AND status IN ('pending','approved')
          AND EXISTS (SELECT 1 FROM cc_organization_action_approvals c WHERE c.request_id=approval_requests.id AND c.consumed_run_id IS NULL)`,
        )
        .run(status, at, at, binding.requestId).changes;
      if (changes !== 1) fail("ORG_APPROVAL_NOT_PENDING");
      return this._view(this._load(binding.requestId));
    });
  }
  _responses(loaded, { recheck = false } = {}) {
    const { binding } = loaded;
    const responses = this.db
      .prepare(
        "SELECT * FROM approval_responses WHERE request_id=? ORDER BY step,created_at,id LIMIT 1025",
      )
      .all(binding.requestId);
    if (responses.length > 1024) fail("ORG_APPROVAL_CORRUPT");
    const seen = new Set();
    let currentStep = 0,
      rejected = false;
    for (let step = 0; step < binding.plan.steps.length; step++) {
      const group = responses.filter((response) => response.step === step);
      if (group.length && (step !== currentStep || rejected))
        fail("ORG_APPROVAL_CORRUPT");
      for (const response of group) {
        const key = `${step}\0${response.approver_did}`;
        const evidence = this.db
          .prepare(
            "SELECT * FROM cc_organization_action_approval_responses WHERE response_id=?",
          )
          .get(response.id);
        if (
          !evidence ||
          evidence.request_id !== binding.requestId ||
          evidence.step !== step ||
          evidence.approver_did !== response.approver_did ||
          evidence.response_digest !== digest(response) ||
          evidence.authority_digest !== digest(binding.authority) ||
          seen.has(key) ||
          !binding.plan.steps[step].includes(response.approver_did) ||
          response.approver_did === binding.requesterDid ||
          !["approve", "reject"].includes(response.decision) ||
          response.delegated_to != null ||
          !Number.isSafeInteger(response.created_at) ||
          response.created_at < binding.createdAt ||
          response.created_at >= binding.expiresAt
        )
          fail("ORG_APPROVAL_CORRUPT");
        seen.add(key);
        if (recheck)
          this._approver(
            binding.projectId,
            response.approver_did,
            binding.authority,
            binding.riskReview,
            binding.goalIntent,
          );
        if (response.decision === "reject") rejected = true;
      }
      if (
        !rejected &&
        group.length &&
        (binding.plan.type !== "parallel" ||
          group.length === binding.plan.steps[step].length)
      )
        currentStep++;
    }
    if (
      responses.some(
        (response) =>
          !Number.isSafeInteger(response.step) ||
          response.step < 0 ||
          response.step >= binding.plan.steps.length,
      )
    )
      fail("ORG_APPROVAL_CORRUPT");
    const evidenceCount = this.db
      .prepare(
        "SELECT count(*) AS n FROM cc_organization_action_approval_responses WHERE request_id=?",
      )
      .get(binding.requestId).n;
    if (evidenceCount !== responses.length) fail("ORG_APPROVAL_CORRUPT");
    const status = rejected
      ? "rejected"
      : currentStep === binding.plan.steps.length
        ? "approved"
        : "pending";
    const step = Math.min(currentStep, binding.plan.steps.length - 1);
    if (
      ["pending", "approved", "rejected"].includes(loaded.request.status) &&
      (status !== loaded.request.status || step !== loaded.request.current_step)
    )
      fail("ORG_APPROVAL_CORRUPT");
    return { status, currentStep: step };
  }
  _decision(input) {
    fields(input, ["approvalId", "step", "decision"]);
    if (
      !Number.isSafeInteger(input.step) ||
      input.step < 0 ||
      !["approve", "reject"].includes(input.decision)
    )
      fail("ORG_APPROVAL_INVALID_REQUEST");
    const actor = this._actor(),
      loaded = this._load(input.approvalId);
    const { binding, request, row } = loaded;
    this._current(binding, actor, "task.approve");
    if (row.consumed_run_id || request.status !== "pending")
      fail("ORG_APPROVAL_NOT_PENDING");
    if (this._time() >= binding.expiresAt) fail("ORG_APPROVAL_EXPIRED");
    this._responses(loaded, { recheck: true });
    if (
      actor === binding.requesterDid ||
      !binding.plan.steps[request.current_step].includes(actor)
    )
      fail("ORG_APPROVAL_NOT_FOUND_OR_DENIED");
    if (input.step !== request.current_step) fail("ORG_APPROVAL_STEP_CONFLICT");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM cc_organization_action_approval_responses WHERE request_id=? AND step=? AND approver_did=?",
        )
        .get(binding.requestId, input.step, actor)
    )
      fail("ORG_APPROVAL_ALREADY_RESPONDED");
    return { actor, loaded };
  }
  verifyDecisionInTransaction(input) {
    if (!this.db.inTransaction) fail("ORG_APPROVAL_TRANSACTION_REQUIRED");
    return this._view(this._decision(input).loaded);
  }
  respond(input) {
    return this._transaction(() => this.respondInTransaction(input));
  }
  respondInTransaction(input) {
    if (!this.db.inTransaction) fail("ORG_APPROVAL_TRANSACTION_REQUIRED");
    const respond = () => {
      const { actor, loaded } = this._decision(input);
      const { binding } = loaded;
      const id = randomUUID(),
        at = this._time();
      if (at >= binding.expiresAt) fail("ORG_APPROVAL_EXPIRED");
      this.db
        .prepare(
          "INSERT INTO approval_responses(id,request_id,approver_did,step,decision,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(id, binding.requestId, actor, input.step, input.decision, at);
      const response = this.db
        .prepare("SELECT * FROM approval_responses WHERE id=?")
        .get(id);
      this.db
        .prepare(
          `INSERT INTO cc_organization_action_approval_responses(response_id,request_id,step,approver_did,response_digest,authority_digest) VALUES (?,?,?,?,?,?)`,
        )
        .run(
          id,
          binding.requestId,
          input.step,
          actor,
          digest(response),
          digest(binding.authority),
        );
      const count = this.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_action_approval_responses WHERE request_id=? AND step=?",
        )
        .get(binding.requestId, input.step).n;
      const advance =
        input.decision === "approve" &&
        (binding.plan.type !== "parallel" ||
          count === binding.plan.steps[input.step].length);
      const status =
        input.decision === "reject"
          ? "rejected"
          : advance && input.step === binding.plan.steps.length - 1
            ? "approved"
            : "pending";
      const nextStep =
        advance && status === "pending" ? input.step + 1 : input.step;
      const changes = this.db
        .prepare(
          "UPDATE approval_requests SET status=?,current_step=?,updated_at=?,completed_at=? WHERE id=? AND status='pending' AND current_step=?",
        )
        .run(
          status,
          nextStep,
          at,
          status === "pending" ? null : at,
          binding.requestId,
          input.step,
        ).changes;
      if (changes !== 1) fail("ORG_APPROVAL_STEP_CONFLICT");
      return this._view(this._load(binding.requestId));
    };
    return respond();
  }
  verifyApprovedInTransaction(input) {
    fields(input, ["approvalId", "request", "projectId", "actorDid"]);
    if (!this.db.inTransaction) fail("ORG_APPROVAL_TRANSACTION_REQUIRED");
    const actor = this._actor();
    if (actor !== input.actorDid) fail("ORG_APPROVAL_IDENTITY_CHANGED");
    const request = this._request(input.request, input.projectId);
    const loaded = this._load(input.approvalId),
      { binding, row } = loaded;
    if (
      binding.requesterDid !== actor ||
      binding.projectId !== input.projectId ||
      binding.invocationDigest !== request.invocationDigest ||
      binding.actionDigest !== request.actionDigest
    )
      fail("ORG_APPROVAL_BINDING_MISMATCH");
    this._current(binding, actor, binding.actionType);
    if (this._time() >= binding.expiresAt) fail("ORG_APPROVAL_EXPIRED");
    if (row.consumed_run_id) fail("ORG_APPROVAL_ALREADY_CONSUMED");
    if (
      loaded.request.status !== "approved" ||
      this._responses(loaded, { recheck: true }).status !== "approved"
    )
      fail("ORG_APPROVAL_NOT_APPROVED");
    const at = this._time();
    if (at >= binding.expiresAt) fail("ORG_APPROVAL_EXPIRED");
    return {
      approvalId: binding.requestId,
      bindingDigest: row.binding_digest,
      expiresAt: binding.expiresAt,
    };
  }
  consumeInTransaction(input) {
    fields(input, ["approvalId", "request", "projectId", "runId", "actorDid"]);
    identifier(input.runId);
    const verified = this.verifyApprovedInTransaction({
      approvalId: input.approvalId,
      request: input.request,
      projectId: input.projectId,
      actorDid: input.actorDid,
    });
    const at = this._time();
    if (at >= verified.expiresAt) fail("ORG_APPROVAL_EXPIRED");
    const changes = this.db
      .prepare(
        "UPDATE cc_organization_action_approvals SET consumed_run_id=?,consumed_at=? WHERE request_id=? AND consumed_run_id IS NULL",
      )
      .run(input.runId, at, verified.approvalId).changes;
    if (changes !== 1) fail("ORG_APPROVAL_ALREADY_CONSUMED");
    return {
      approvalId: verified.approvalId,
      bindingDigest: verified.bindingDigest,
      runId: input.runId,
      consumedAt: at,
    };
  }
}

module.exports = {
  OrganizationProjectApprovalService,
  organizationProjectActionTargetVersion,
  ORGANIZATION_APPROVAL_SCHEMA: SCHEMA,
};
