"use strict";

const { randomUUID } = require("node:crypto");
const {
  createBusinessObjectRef,
  validateBusinessObjectRef,
  createBusinessActionRequest,
  validateBusinessActionRequest,
  createBusinessActionRun,
  validateBusinessActionRun,
  digestBusinessObjectContent,
} = require("./business-object-contract");

const ACTION_TYPE = "task.update-description";
const SOURCE_KIND = "desktop.project-task";
const MAX_DESCRIPTION_BYTES = 8192;
const TASK_DESCRIPTION_PREVIEW_CHARACTERS = 256;
const MAX_SOURCE_BYTES = 65536;
const MAX_RECEIPT_BYTES = 65536;
const RECEIPT_COLUMNS = `id,actor_did,target_id,idempotency_digest,invocation_digest,
  CASE WHEN length(CAST(run_json AS BLOB))<=${MAX_RECEIPT_BYTES} THEN run_json ELSE NULL END AS run_json,
  CASE WHEN length(CAST(evidence_json AS BLOB))<=${MAX_RECEIPT_BYTES} THEN evidence_json ELSE NULL END AS evidence_json`;

function receiptTarget(type) {
  // Malformed candidates remain visible to the receipt validator and fail
  // closed; an actual other object type must never cross this history boundary.
  return `CASE WHEN json_valid(run_json) THEN COALESCE(json_extract(run_json,'$.target.type')='${type}',1) ELSE 1 END`;
}

function readOptions(input, required, optional) {
  try {
    digestBusinessObjectContent(input);
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
  return input;
}

function pageLimit(value, fallback, maximum) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum)
    fail("ACTION_INVALID_LIMIT");
  return limit;
}

function sqlColumn(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function boundedDescription(value) {
  if (typeof value !== "string") return "";
  let bytes = 0;
  let result = "";
  for (const character of value) {
    bytes += Buffer.byteLength(character, "utf8");
    if (bytes > MAX_DESCRIPTION_BYTES) break;
    result += character;
  }
  return result;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(value)
  ) {
    fail("ACTION_INVALID_ID");
  }
  return value;
}

function description(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_DESCRIPTION_BYTES
  ) {
    fail("ACTION_INVALID_DESCRIPTION");
  }
  return value;
}

function validateRequest(value) {
  let request;
  try {
    request = validateBusinessActionRequest(value);
  } catch {
    fail("ACTION_INVALID_REQUEST");
  }
  if (
    request.actionType !== ACTION_TYPE ||
    request.actionVersion !== 1 ||
    request.target.type !== "Task" ||
    request.target.sourceKind !== SOURCE_KIND ||
    request.target.scope.kind !== "personal" ||
    Object.keys(request.input).some(
      (key) => !["description", "riskReview", "goalIntent"].includes(key),
    ) ||
    !Object.hasOwn(request.input, "description")
  ) {
    fail("ACTION_UNSUPPORTED_REQUEST");
  }
  description(request.input.description);
  if (Object.hasOwn(request.input, "riskReview")) {
    readOptions(request.input.riskReview, ["id", "contentDigest"], []);
    id(request.input.riskReview.id);
    if (!/^sha256:[a-f0-9]{64}$/.test(request.input.riskReview.contentDigest))
      fail("ACTION_INVALID_REQUEST");
  }
  if (Object.hasOwn(request.input, "goalIntent"))
    validateGoalIntent(request.input.goalIntent);
  return request;
}

function validateGoalIntent(value) {
  readOptions(
    value,
    [
      "id",
      "goalId",
      "storeId",
      "goalRevision",
      "controlGeneration",
      "proposalId",
    ],
    [],
  );
  for (const key of ["id", "goalId", "storeId", "proposalId"]) id(value[key]);
  if (
    !Number.isSafeInteger(value.goalRevision) ||
    value.goalRevision < 1 ||
    !Number.isSafeInteger(value.controlGeneration) ||
    value.controlGeneration < 0
  )
    fail("ACTION_INVALID_REQUEST");
  return value;
}

function snapshotReferences(task, project) {
  const projectSnapshot = {
    id: project.id,
    owner: project.user_id,
    status: project.status,
    updatedAt: project.updated_at,
    deleted: project.deleted ?? 0,
  };
  const scope = { kind: "personal", id: project.user_id };
  return {
    ref: createBusinessObjectRef({
      type: "Task",
      id: task.id,
      sourceKind: SOURCE_KIND,
      scope,
      version: digestBusinessObjectContent({ task, project: projectSnapshot }),
    }),
    projectRef: createBusinessObjectRef({
      type: "Project",
      id: project.id,
      sourceKind: "desktop.project-task-owner",
      scope,
      version: digestBusinessObjectContent(projectSnapshot),
    }),
  };
}

/** Offline request preparation only. Snapshot ownership is a claim; execution
 * always obtains identity and all canonical rows independently from the host. */
function createTaskDescriptionPreview(input) {
  try {
    digestBusinessObjectContent(input);
  } catch {
    fail("ACTION_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "description,idempotencyKey,project,task"
  )
    fail("ACTION_INVALID_REQUEST");
  const { task, project } = input;
  if (
    !task ||
    !project ||
    task.project_id !== project.id ||
    typeof project.user_id !== "string" ||
    !project.user_id.startsWith("did:") ||
    (task.deleted != null && task.deleted !== 0) ||
    (project.deleted != null && project.deleted !== 0)
  )
    fail("ACTION_SOURCE_INVALID");
  if (
    task.org_id != null ||
    task.workspace_id != null ||
    project.org_id != null ||
    project.workspace_id != null
  )
    fail("ACTION_ORGANIZATION_UNSUPPORTED");
  if (
    !["draft", "active"].includes(project.status) ||
    task.status !== "pending"
  )
    fail("ACTION_TARGET_NOT_EDITABLE");
  if (
    !Number.isSafeInteger(task.updated_at) ||
    !Number.isSafeInteger(project.updated_at)
  )
    fail("ACTION_SOURCE_INVALID");
  id(task.id);
  id(project.id);
  id(input.idempotencyKey);
  description(task.description);
  description(input.description);
  const { ref } = snapshotReferences(task, project);
  const request = createBusinessActionRequest({
    actionType: ACTION_TYPE,
    actionVersion: 1,
    target: ref,
    expectedVersion: ref.version,
    input: { description: input.description },
    idempotencyKey: input.idempotencyKey,
  });
  return Object.freeze({
    request,
    before: Object.freeze({ description: task.description }),
    after: request.input,
    authority: "unverified-snapshot",
  });
}

/**
 * Native SQLite implementation for a deliberately narrow personal-task action.
 * Authority comes from the host's current unlocked identity, never the request.
 * Organizations/workspaces are unsupported until their RBAC/workflow adapter is
 * available. The desktop adapter routes canonical legacy reads and rejects
 * ungoverned canonical writes; team-board and ancillary models remain separate.
 *
 * An admission receipt is durable before confirmation. No transaction spans an
 * await. Final ownership/version checks, mutation and success evidence commit in
 * one immediate transaction. Interrupted running receipts are never replayed.
 */
class TaskDescriptionActionService {
  constructor({
    db,
    getActor,
    approvalGate,
    now = () => Date.now(),
    contextAdapter = null,
  } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("ACTION_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof approvalGate?.decide !== "function"
    )
      fail("ACTION_AUTHORITY_UNAVAILABLE");
    this.db = db;
    this.getActor = getActor;
    this.approvalGate = approvalGate;
    this.now = now;
    if (
      contextAdapter !== null &&
      (typeof contextAdapter?.verify !== "function" ||
        typeof contextAdapter?.record !== "function")
    )
      fail("ACTION_GOAL_AUTHORITY_REQUIRED");
    this.contextAdapter = contextAdapter;
    this._transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_business_action_runs (
      id TEXT PRIMARY KEY,
      actor_did TEXT NOT NULL,
      target_id TEXT NOT NULL,
      idempotency_digest TEXT NOT NULL UNIQUE,
      invocation_digest TEXT NOT NULL,
      run_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cc_business_action_runs_actor_target
      ON cc_business_action_runs(actor_did,target_id);
    CREATE INDEX IF NOT EXISTS idx_cc_business_action_runs_target
      ON cc_business_action_runs(target_id);`),
    );
  }

  _transaction(fn) {
    if (this.db.inTransaction) fail("ACTION_TRANSACTION_BUSY");
    return this.db.transaction(fn).immediate();
  }

  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      fail("ACTION_AUTHORITY_UNAVAILABLE");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("ACTION_AUTHENTICATION_REQUIRED");
    return id(actor);
  }

  _ownedProject(projectId, actor) {
    const columns = this.db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .map((column) => column.name);
    const optional = ["deleted", "org_id", "workspace_id"].filter((column) =>
      columns.includes(column),
    );
    const selection = ["id", "user_id", "status", "updated_at", ...optional]
      .map(sqlColumn)
      .join(",");
    const project = this.db
      .prepare(`SELECT ${selection} FROM projects WHERE id=?`)
      .get(id(projectId));
    if (
      !project ||
      project.user_id !== actor ||
      (project.deleted != null && project.deleted !== 0)
    )
      fail("ACTION_NOT_FOUND_OR_DENIED");
    if (project.org_id != null || project.workspace_id != null)
      fail("ACTION_ORGANIZATION_UNSUPPORTED");
    if (typeof project.status !== "string" || project.status.length > 80)
      fail("ACTION_SOURCE_INVALID");
    const hasOrganizations = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='organization_projects'",
      )
      .get();
    if (
      hasOrganizations &&
      this.db
        .prepare("SELECT 1 FROM organization_projects WHERE id=?")
        .get(project.id)
    )
      fail("ACTION_ORGANIZATION_UNSUPPORTED");
    this._rejectWorkspaceResource("project", project.id);
    return project;
  }

  _hasWorkspaceResources() {
    return !!this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_resources'",
      )
      .get();
  }

  _rejectWorkspaceResource(resourceType, resourceId) {
    if (
      this._hasWorkspaceResources() &&
      this.db
        .prepare(
          "SELECT 1 FROM workspace_resources WHERE resource_type=? AND resource_id=? LIMIT 1",
        )
        .get(resourceType, resourceId)
    )
      fail("ACTION_ORGANIZATION_UNSUPPORTED");
  }

  _taskColumns() {
    return this.db
      .prepare("PRAGMA table_info(project_tasks)")
      .all()
      .map((column) => column.name);
  }

  _ownedTask(taskId, actor, { metadataOnly = false } = {}) {
    let selection = "*";
    if (metadataOnly) {
      const columns = this._taskColumns();
      const optional = ["deleted", "org_id", "workspace_id"].filter((column) =>
        columns.includes(column),
      );
      selection = ["id", "project_id", "status", "updated_at", ...optional]
        .map(sqlColumn)
        .join(",");
    }
    const task = this.db
      .prepare(`SELECT ${selection} FROM project_tasks WHERE id=?`)
      .get(id(taskId));
    if (!task || (task.deleted != null && task.deleted !== 0))
      fail("ACTION_NOT_FOUND_OR_DENIED");
    const project = this._ownedProject(task.project_id, actor);
    // The enterprise schema adds these columns; the baseline need not have them.
    if (task.org_id != null || task.workspace_id != null)
      fail("ACTION_ORGANIZATION_UNSUPPORTED");
    this._rejectWorkspaceResource("task", task.id);
    return { task, project };
  }

  _assertNoUnresolvedTask(taskId) {
    // Any actor's unresolved admission still concerns this source object. A
    // new key or owner must not turn an unknown outcome into a fresh write.
    // Validate candidates in JS too; SQL safely handles malformed JSON first.
    const row = this.db
      .prepare(
        `SELECT ${RECEIPT_COLUMNS} FROM cc_business_action_runs WHERE target_id=? AND ${receiptTarget(this._targetType())} AND
      CASE WHEN json_valid(run_json) THEN
        COALESCE(json_extract(run_json,'$.status') NOT IN ('succeeded','failed','cancelled','denied'),1)
      ELSE 1 END LIMIT 1`,
      )
      .get(taskId);
    if (row) {
      this._readRun(row);
      fail("ACTION_UNRESOLVED_ACTION");
    }
  }

  _targetType() {
    return "Task";
  }

  _readTransaction(operation) {
    try {
      return this._transaction(operation);
    } catch (error) {
      if (
        typeof error?.code === "string" &&
        /^ACTION_[A-Z_]+$/u.test(error.code)
      )
        throw error;
      fail("ACTION_READ_FAILED");
    }
  }

  listTasks(input = {}) {
    const options = readOptions(input, ["projectId"], ["afterId", "limit"]);
    id(options.projectId);
    if (options.afterId !== undefined) id(options.afterId);
    const limit = pageLimit(options.limit, 50, 100);
    return this._readTransaction(() => {
      const project = this._ownedProject(options.projectId, this._actor());
      const columns = this._taskColumns();
      const visible = columns.includes("deleted")
        ? " AND (deleted IS NULL OR deleted=0)"
        : "";
      const enterprise = ["org_id", "workspace_id"].filter((column) =>
        columns.includes(column),
      );
      if (
        enterprise.length &&
        this.db
          .prepare(
            `SELECT 1 FROM project_tasks WHERE project_id=?${visible}
        AND (${enterprise.map((column) => `${sqlColumn(column)} IS NOT NULL`).join(" OR ")}) LIMIT 1`,
          )
          .get(project.id)
      ) {
        fail("ACTION_ORGANIZATION_UNSUPPORTED");
      }
      if (
        this._hasWorkspaceResources() &&
        this.db
          .prepare(
            `SELECT 1 FROM project_tasks
        WHERE project_id=?${visible} AND EXISTS (
          SELECT 1 FROM workspace_resources w WHERE w.resource_type='task' AND w.resource_id=project_tasks.id
        ) LIMIT 1`,
          )
          .get(project.id)
      )
        fail("ACTION_ORGANIZATION_UNSUPPORTED");
      if (
        options.afterId !== undefined &&
        !this.db
          .prepare("SELECT 1 FROM project_tasks WHERE id=? AND project_id=?")
          .get(options.afterId, project.id)
      ) {
        fail("ACTION_INVALID_CURSOR");
      }
      const params = [project.id];
      if (options.afterId !== undefined) params.push(options.afterId);
      const rows = this.db
        .prepare(
          `SELECT id,task_type AS taskType,status,
        substr(description,1,${TASK_DESCRIPTION_PREVIEW_CHARACTERS}) AS descriptionPreview,
        updated_at AS updatedAt FROM project_tasks WHERE project_id=?${visible}
        ${options.afterId !== undefined ? "AND id>?" : ""} ORDER BY id LIMIT ?`,
        )
        .all(...params, limit + 1);
      const tasks = rows.slice(0, limit);
      for (const task of tasks) {
        id(task.id);
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
        nextCursor: rows.length > limit ? tasks.at(-1).id : null,
      };
    });
  }

  readTask(taskId) {
    id(taskId);
    return this._readTransaction(() => {
      const actor = this._actor();
      const { task, project } = this._ownedTask(taskId, actor, {
        metadataOnly: true,
      });
      if (typeof task.status !== "string" || task.status.length > 80)
        fail("ACTION_SOURCE_INVALID");
      const content = this.db
        .prepare(
          `SELECT substr(CAST(description AS BLOB),1,${MAX_DESCRIPTION_BYTES}) AS descriptionPrefix,
        typeof(description) AS descriptionType,
        length(CAST(description AS BLOB)) AS descriptionBytes FROM project_tasks WHERE id=?`,
        )
        .get(taskId);
      let reason = null;
      let text = "";
      if (
        content.descriptionType !== "text" ||
        !Buffer.isBuffer(content.descriptionPrefix) ||
        !Number.isSafeInteger(content.descriptionBytes)
      ) {
        reason = "ACTION_SOURCE_INVALID";
      } else {
        try {
          // SQL substr(TEXT) stops at embedded NUL. Read a bounded byte prefix
          // instead; streaming decode omits an incomplete final code point.
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(content.descriptionPrefix, {
            stream: content.descriptionBytes > content.descriptionPrefix.length,
          });
        } catch {
          reason = "ACTION_SOURCE_INVALID";
        }
      }
      if (!reason && content.descriptionBytes > MAX_DESCRIPTION_BYTES) {
        reason = "ACTION_DESCRIPTION_TOO_LARGE";
      } else if (
        !reason &&
        (!["draft", "active"].includes(project.status) ||
          task.status !== "pending")
      ) {
        reason = "ACTION_TARGET_NOT_EDITABLE";
      } else if (!reason) {
        try {
          this._assertNoUnresolvedTask(taskId);
        } catch (error) {
          if (
            ["ACTION_UNRESOLVED_ACTION", "ACTION_RECEIPT_CORRUPT"].includes(
              error.code,
            )
          )
            reason = error.code;
          else throw error;
        }
        // Do not fetch a potentially huge result_data merely to decide whether
        // this bounded description operation can build its full-row version.
        const bytes = this._taskColumns()
          .map(
            (column) =>
              `COALESCE(length(CAST(${sqlColumn(column)} AS BLOB)),0)`,
          )
          .join("+");
        const size = this.db
          .prepare(`SELECT ${bytes} AS bytes FROM project_tasks WHERE id=?`)
          .get(taskId).bytes;
        if (!reason && size > MAX_SOURCE_BYTES)
          reason = "ACTION_SOURCE_INVALID";
        else if (!reason) {
          try {
            this._snapshot(taskId, actor, true);
          } catch (error) {
            if (
              [
                "ACTION_SOURCE_INVALID",
                "ACTION_INVALID_DESCRIPTION",
                "ACTION_TARGET_NOT_EDITABLE",
              ].includes(error.code)
            )
              reason = error.code;
            else throw error;
          }
        }
      }
      return {
        taskId: task.id,
        projectId: project.id,
        status: task.status,
        description: boundedDescription(text),
        editable: reason === null,
        reason,
      };
    });
  }

  listRuns(input = {}) {
    const options = readOptions(input, ["taskId"], ["beforeId", "limit"]);
    id(options.taskId);
    if (options.beforeId !== undefined) id(options.beforeId);
    const limit = pageLimit(options.limit, 20, 50);
    return this._readTransaction(() => {
      const actor = this._actor();
      this._ownedTask(options.taskId, actor, { metadataOnly: true });
      let beforeRowId;
      if (options.beforeId !== undefined) {
        const cursor = this.db
          .prepare(
            `SELECT rowid FROM cc_business_action_runs WHERE id=? AND actor_did=? AND target_id=? AND ${receiptTarget("Task")}`,
          )
          .get(options.beforeId, actor, options.taskId);
        if (!cursor) fail("ACTION_INVALID_CURSOR");
        beforeRowId = cursor.rowid;
      }
      const params = [actor, options.taskId];
      if (beforeRowId !== undefined) params.push(beforeRowId);
      const rows = this.db
        .prepare(
          `SELECT ${RECEIPT_COLUMNS} FROM cc_business_action_runs WHERE actor_did=? AND target_id=? AND ${receiptTarget("Task")}
        ${beforeRowId !== undefined ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(...params, limit + 1);
      const selected = rows.slice(0, limit);
      return {
        runs: selected.map((row) => this._readRun(row)),
        nextCursor: rows.length > limit ? selected.at(-1).id : null,
      };
    });
  }

  _snapshot(taskId, actor, requireEditable = false) {
    const { task, project } = this._ownedTask(taskId, actor);
    if (
      requireEditable &&
      (!["draft", "active"].includes(project.status) ||
        task.status !== "pending")
    )
      fail("ACTION_TARGET_NOT_EDITABLE");
    if (
      !Number.isSafeInteger(task.updated_at) ||
      !Number.isSafeInteger(project.updated_at)
    )
      fail("ACTION_SOURCE_INVALID");
    description(task.description);
    let references;
    try {
      references = snapshotReferences(task, project);
    } catch {
      fail("ACTION_SOURCE_INVALID");
    }
    return { task, ...references };
  }

  getTask(taskId) {
    return this._transaction(() => {
      const snapshot = this._snapshot(taskId, this._actor());
      return {
        ref: snapshot.ref,
        description: snapshot.task.description,
        projectRef: snapshot.projectRef,
      };
    });
  }

  preview(input) {
    try {
      digestBusinessObjectContent(input);
    } catch {
      fail("ACTION_INVALID_REQUEST");
    }
    if (
      !input ||
      Array.isArray(input) ||
      !["description", "idempotencyKey", "taskId"].every((key) =>
        Object.hasOwn(input, key),
      ) ||
      Object.keys(input).some(
        (key) =>
          ![
            "description",
            "idempotencyKey",
            "taskId",
            "reviewId",
            "goalIntent",
          ].includes(key),
      )
    )
      fail("ACTION_INVALID_REQUEST");
    description(input.description);
    id(input.idempotencyKey);
    if (input.goalIntent !== undefined) validateGoalIntent(input.goalIntent);
    const riskContext =
      input.reviewId === undefined
        ? null
        : this._riskService().getActionContext({
            reviewId: input.reviewId,
            taskId: input.taskId,
          });
    return this._transaction(() => {
      const actor = this._actor();
      this._ownedTask(input.taskId, actor, { metadataOnly: true });
      this._assertNoUnresolvedTask(input.taskId);
      const snapshot = this._snapshot(input.taskId, actor, true);
      const riskReview = riskContext;
      if (riskReview)
        this._riskService().verifyActionContext({
          reviewId: riskReview.id,
          taskId: input.taskId,
          contentDigest: riskReview.contentDigest,
        });
      const request = createBusinessActionRequest({
        actionType: ACTION_TYPE,
        actionVersion: 1,
        target: snapshot.ref,
        expectedVersion: snapshot.ref.version,
        input: {
          description: input.description,
          ...(input.goalIntent ? { goalIntent: input.goalIntent } : {}),
          ...(riskReview
            ? {
                riskReview: {
                  id: riskReview.id,
                  contentDigest: riskReview.contentDigest,
                },
              }
            : {}),
        },
        idempotencyKey: input.idempotencyKey,
      });
      this._verifyGoalContext(request, actor, "preview");
      return Object.freeze({
        request,
        before: Object.freeze({ description: snapshot.task.description }),
        after: request.input,
      });
    });
  }

  _readRun(row) {
    try {
      if (
        typeof row.run_json !== "string" ||
        typeof row.evidence_json !== "string" ||
        Buffer.byteLength(row.run_json, "utf8") > MAX_RECEIPT_BYTES ||
        Buffer.byteLength(row.evidence_json, "utf8") > MAX_RECEIPT_BYTES
      )
        fail("ACTION_RECEIPT_CORRUPT");
      const run = validateBusinessActionRun(JSON.parse(row.run_json));
      if (
        ![ACTION_TYPE, "task.create"].includes(run.actionType) ||
        run.target.type !==
          (run.actionType === "task.create" ? "Project" : "Task") ||
        run.target.scope.kind !== "personal" ||
        run.target.sourceKind !==
          (run.actionType === "task.create"
            ? "desktop.project-task-owner"
            : SOURCE_KIND)
      )
        fail("ACTION_RECEIPT_CORRUPT");
      const evidence = JSON.parse(row.evidence_json);
      // Evidence must be exactly the records bound by the stored run, including
      // its host-observed actor and action binding. Never accept supplied proof.
      if (
        !Array.isArray(evidence) ||
        evidence.length !== run.evidenceRefs.length ||
        new Set(evidence.map((item) => item.id)).size !== evidence.length ||
        row.id !== run.id ||
        row.actor_did !== run.target.scope.id ||
        row.target_id !== run.target.id ||
        row.invocation_digest !== run.invocationDigest ||
        row.idempotency_digest !== run.idempotencyDigest
      )
        fail("ACTION_RECEIPT_CORRUPT");
      for (const item of evidence) {
        const reference = run.evidenceRefs.find((ref) => ref.id === item.id);
        if (
          !reference ||
          reference.digest !== digestBusinessObjectContent(item) ||
          item.actorDid !== row.actor_did ||
          item.invocationDigest !== run.invocationDigest
        )
          fail("ACTION_RECEIPT_CORRUPT");
      }
      const resolveEvidence = (reference) => {
        if (!reference) return null;
        if (
          !run.evidenceRefs.some(
            (item) =>
              item.id === reference.id && item.digest === reference.digest,
          )
        )
          fail("ACTION_RECEIPT_CORRUPT");
        return evidence.find((item) => item.id === reference.id);
      };
      const approval = resolveEvidence(run.approvalRef);
      const execution = resolveEvidence(run.executionRef);
      const sources = evidence.filter(
        (item) => item.kind === "project-risk-review",
      );
      if (
        sources.length > 1 ||
        sources.some(
          (item) =>
            ![ACTION_TYPE, "task.create"].includes(run.actionType) ||
            item.actionDigest !== run.actionDigest ||
            item.expectedVersion !== run.expectedVersion ||
            typeof item.reviewId !== "string" ||
            !/^sha256:[a-f0-9]{64}$/.test(item.contentDigest),
        )
      )
        fail("ACTION_RECEIPT_CORRUPT");
      const goals = evidence.filter(
        (item) => item.kind === "project-goal-intent",
      );
      if (
        goals.length > 1 ||
        goals.some((item) => {
          validateGoalIntent(item.reference);
          return (
            item.actionDigest !== run.actionDigest ||
            item.expectedVersion !== run.expectedVersion
          );
        })
      )
        fail("ACTION_RECEIPT_CORRUPT");
      if (run.status === "succeeded" && run.actionType === "task.create") {
        const created = validateBusinessObjectRef(execution?.createdTaskRef);
        if (
          created.type !== "Task" ||
          created.sourceKind !== SOURCE_KIND ||
          created.scope.kind !== "personal" ||
          created.scope.id !== row.actor_did
        )
          fail("ACTION_RECEIPT_CORRUPT");
      }
      if (
        approval &&
        (approval.actionDigest !== run.actionDigest ||
          approval.expectedVersion !== run.expectedVersion)
      )
        fail("ACTION_RECEIPT_CORRUPT");
      if (
        run.status === "succeeded" &&
        (approval?.kind !== "local-user-confirmation" ||
          approval.decision !== "allow" ||
          approval.via !== "user-confirm" ||
          approval.policy !== "strict" ||
          approval.riskLevel !== "high" ||
          execution?.kind !==
            (run.actionType === "task.create"
              ? "sqlite-task-create"
              : "sqlite-task-description-update") ||
          execution.affectedRows !== 1 ||
          execution.beforeVersion !== run.expectedVersion ||
          execution.afterVersion !== run.afterVersion)
      )
        fail("ACTION_RECEIPT_CORRUPT");
      return { run, evidence };
    } catch {
      fail("ACTION_RECEIPT_CORRUPT");
    }
  }

  getRun(runId) {
    return this._transaction(() => {
      const actor = this._actor();
      const row = this.db
        .prepare(
          `SELECT ${RECEIPT_COLUMNS} FROM cc_business_action_runs WHERE id=? AND actor_did=?`,
        )
        .get(id(runId), actor);
      if (!row) fail("ACTION_NOT_FOUND_OR_DENIED");
      const result = this._readRun(row);
      if (result.run.actionType === "task.create")
        this._ownedProject(row.target_id, actor);
      else this._ownedTask(row.target_id, actor, { metadataOnly: true });
      return result;
    });
  }

  _save(run, evidence, actor, insert = false, request = null) {
    if (insert) {
      this.db
        .prepare(
          `INSERT INTO cc_business_action_runs
        (id,actor_did,target_id,idempotency_digest,invocation_digest,run_json,evidence_json)
        VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          run.id,
          actor,
          run.target.id,
          run.idempotencyDigest,
          run.invocationDigest,
          JSON.stringify(run),
          JSON.stringify(evidence),
        );
    } else {
      const saved = this.db
        .prepare(
          "UPDATE cc_business_action_runs SET run_json=?,evidence_json=? WHERE id=? AND actor_did=? AND invocation_digest=?",
        )
        .run(
          JSON.stringify(run),
          JSON.stringify(evidence),
          run.id,
          actor,
          run.invocationDigest,
        );
      if (saved.changes !== 1) fail("ACTION_RECEIPT_CONFLICT");
    }
    for (const item of (insert ? evidence : []).filter(
      (item) => item.kind === "project-risk-review",
    )) {
      this._riskService().bindActionRun({
        reviewId: item.reviewId,
        contentDigest: item.contentDigest,
        run,
      });
    }
    if (request?.input.goalIntent) {
      if (!this.contextAdapter) fail("ACTION_GOAL_AUTHORITY_REQUIRED");
      const recorded = this.contextAdapter.record({
        request,
        run,
        evidence,
        actor,
      });
      if (recorded && typeof recorded.then === "function")
        fail("ACTION_GOAL_ASYNC_CONTEXT_DENIED");
      if (recorded?.recorded !== true) fail("ACTION_GOAL_CONTEXT_REJECTED");
    }
  }

  _riskService() {
    const {
      ProjectRiskReviewService,
    } = require("./project-risk-review-service");
    return (this.riskService ||= new ProjectRiskReviewService({
      db: this.db,
      getActor: this.getActor,
      now: this.now,
    }));
  }

  _validateRequest(input) {
    return validateRequest(input);
  }
  _verifyRiskContext(request) {
    if (request.input.riskReview)
      this._riskService().verifyActionContext({
        reviewId: request.input.riskReview.id,
        contentDigest: request.input.riskReview.contentDigest,
        taskId: request.target.id,
      });
  }
  _verifyGoalContext(request, actor, phase) {
    if (!request.input.goalIntent) return;
    if (!this.contextAdapter) fail("ACTION_GOAL_AUTHORITY_REQUIRED");
    const verified = this.contextAdapter.verify({ request, actor, phase });
    if (verified && typeof verified.then === "function")
      fail("ACTION_GOAL_ASYNC_CONTEXT_DENIED");
    if (verified?.allowed !== true) fail("ACTION_GOAL_CONTEXT_REJECTED");
  }
  _authorizeRequest(request, actor) {
    this._ownedTask(request.target.id, actor, { metadataOnly: true });
  }
  _requestSnapshot(request, actor) {
    return this._snapshot(request.target.id, actor, true);
  }
  _applyRequest(request, actor, latest) {
    const updatedAt = Math.max(this.now(), latest.task.updated_at + 1);
    if (!Number.isSafeInteger(updatedAt)) fail("ACTION_SOURCE_INVALID");
    const result = this.db
      .prepare(
        "UPDATE project_tasks SET description=?,updated_at=?,sync_status='pending' WHERE id=? AND description=? AND updated_at=?",
      )
      .run(
        request.input.description,
        updatedAt,
        request.target.id,
        latest.task.description,
        latest.task.updated_at,
      );
    if (result.changes !== 1) fail("ACTION_VERSION_CONFLICT");
    const afterSnapshot = this._snapshot(request.target.id, actor);
    if (afterSnapshot.task.description !== request.input.description)
      fail("ACTION_POSTCONDITION_FAILED");
    return {
      afterVersion: afterSnapshot.ref.version,
      affectedRows: result.changes,
      kind: "sqlite-task-description-update",
    };
  }

  async execute(input) {
    const request = this._validateRequest(input);
    if (request.input.riskReview) this._riskService();
    const admitted = this._transaction(() => {
      const actor = this._actor();
      this._authorizeRequest(request, actor);
      if (request.target.scope.id !== actor) fail("ACTION_NOT_FOUND_OR_DENIED");
      const previous = this.db
        .prepare(
          "SELECT * FROM cc_business_action_runs WHERE idempotency_digest=?",
        )
        .get(request.idempotencyDigest);
      if (previous) {
        if (
          previous.actor_did !== actor ||
          previous.invocation_digest !== request.invocationDigest
        )
          fail("ACTION_IDEMPOTENCY_CONFLICT");
        this._verifyGoalContext(request, actor, "replay");
        return { previous: this._readRun(previous) };
      }
      this._assertNoUnresolvedTask(request.target.id);
      const current = this._requestSnapshot(request, actor);
      const riskContext = request.input.riskReview;
      this._verifyRiskContext(request);
      this._verifyGoalContext(request, actor, "admission");
      if (current.ref.version !== request.expectedVersion)
        fail("ACTION_VERSION_CONFLICT");
      const startedAt = new Date(this.now()).toISOString();
      const sourceEvidence = riskContext
        ? [
            {
              id: randomUUID(),
              kind: "project-risk-review",
              reviewId: riskContext.id,
              contentDigest: riskContext.contentDigest,
              actionDigest: request.actionDigest,
              expectedVersion: request.expectedVersion,
              actorDid: actor,
              invocationDigest: request.invocationDigest,
            },
          ]
        : [];
      if (request.input.goalIntent)
        sourceEvidence.push({
          id: randomUUID(),
          kind: "project-goal-intent",
          reference: request.input.goalIntent,
          actorDid: actor,
          invocationDigest: request.invocationDigest,
          actionDigest: request.actionDigest,
          expectedVersion: request.expectedVersion,
        });
      const sourceRefs = sourceEvidence.map((item) => ({
        id: item.id,
        digest: digestBusinessObjectContent(item),
      }));
      const run = createBusinessActionRun({
        id: randomUUID(),
        request,
        status: "running",
        startedAt,
        evidenceRefs: sourceRefs,
      });
      this._save(run, sourceEvidence, actor, true, request);
      return {
        actor,
        current,
        startedAt,
        runId: run.id,
        sourceEvidence,
        sourceRefs,
      };
    });
    if (admitted.previous)
      return {
        ...admitted.previous,
        replayed: true,
        executionState: ["queued", "running", "unknown"].includes(
          admitted.previous.run.status,
        )
          ? "unresolved"
          : "recorded",
      };

    const { actor, current, startedAt, runId, sourceEvidence, sourceRefs } =
      admitted;
    let decision;
    try {
      decision = await this.approvalGate.decide(
        Object.freeze({
          sessionId: "business-actions",
          policy: "strict",
          riskLevel: "high",
          tool: request.actionType,
          request,
          actorDid: actor,
          before: Object.freeze({ description: current.task.description }),
          after: request.input,
        }),
      );
    } catch {
      decision = { decision: "deny", via: "confirm-error" };
    }
    const approved =
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
    const vias = [
      "user-confirm",
      "user-deny",
      "no-confirmer",
      "confirm-error",
      "policy",
      "policy-store-error",
      "authorization-missing",
      "authorization-consumer-missing",
    ];
    const via = decision?.authorization
      ? "authorization-unconsumed"
      : vias.includes(decision?.via)
        ? decision.via
        : "invalid-decision";
    // No renderer input or serialized approval object can reach this receipt.
    const approval = {
      id: randomUUID(),
      kind:
        approved || cancelled
          ? "local-user-confirmation"
          : "approval-gate-decision",
      actorDid: actor,
      invocationDigest: request.invocationDigest,
      actionDigest: request.actionDigest,
      expectedVersion: request.expectedVersion,
      decision: approved ? "allow" : "deny",
      via,
      policy: "strict",
      riskLevel: "high",
      at: new Date(this.now()).toISOString(),
    };
    const approvalRef = {
      id: approval.id,
      digest: digestBusinessObjectContent(approval),
    };

    try {
      return this._transaction(() => {
        const currentActor = this._actor();
        if (currentActor !== actor) fail("ACTION_AUTHORITY_CHANGED");
        const latest = this._requestSnapshot(request, actor);
        this._verifyRiskContext(request);
        this._verifyGoalContext(request, actor, "before-write");
        if (latest.ref.version !== request.expectedVersion)
          fail("ACTION_VERSION_CONFLICT");
        const row = this.db
          .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
          .get(runId);
        if (!row || this._readRun(row).run.status !== "running")
          fail("ACTION_RECEIPT_CONFLICT");
        const evidence = [...sourceEvidence, approval];
        const evidenceRefs = [...sourceRefs, approvalRef];
        let afterVersion = null,
          executionRef = null;
        if (approved) {
          const mutation = this._applyRequest(request, actor, latest);
          afterVersion = mutation.afterVersion;
          const execution = {
            id: randomUUID(),
            kind: mutation.kind,
            ...(mutation.createdTaskRef
              ? { createdTaskRef: mutation.createdTaskRef }
              : {}),
            actorDid: actor,
            invocationDigest: request.invocationDigest,
            beforeVersion: request.expectedVersion,
            afterVersion,
            affectedRows: mutation.affectedRows,
            at: new Date(this.now()).toISOString(),
          };
          executionRef = {
            id: execution.id,
            digest: digestBusinessObjectContent(execution),
          };
          evidence.push(execution);
          evidenceRefs.push(executionRef);
        }
        const run = createBusinessActionRun({
          id: runId,
          request,
          status: approved ? "succeeded" : cancelled ? "cancelled" : "denied",
          startedAt,
          completedAt: new Date(this.now()).toISOString(),
          afterVersion,
          approvalRef,
          executionRef,
          evidenceRefs,
        });
        this._save(run, evidence, actor, false, request);
        return { run, evidence, replayed: false };
      });
    } catch (error) {
      // A changed identity/version is a known precondition failure before any
      // write. Other DB/commit errors retain running (unknown) and are not retried.
      if (
        /^(PROJECT_RISK_|ACTION_GOAL_)/.test(error.code || "") ||
        [
          "ACTION_AUTHORITY_CHANGED",
          "ACTION_VERSION_CONFLICT",
          "ACTION_NOT_FOUND_OR_DENIED",
          "ACTION_TARGET_NOT_EDITABLE",
          "ACTION_ORGANIZATION_UNSUPPORTED",
          "ACTION_AUTHENTICATION_REQUIRED",
          "ACTION_AUTHORITY_UNAVAILABLE",
        ].includes(error.code)
      ) {
        this._transaction(() => {
          const row = this.db
            .prepare("SELECT * FROM cc_business_action_runs WHERE id=?")
            .get(runId);
          if (!row || this._readRun(row).run.status !== "running") return;
          const denied = createBusinessActionRun({
            id: runId,
            request,
            status: "denied",
            startedAt,
            completedAt: new Date(this.now()).toISOString(),
            approvalRef,
            evidenceRefs: [...sourceRefs, approvalRef],
          });
          this._save(
            denied,
            [...sourceEvidence, approval],
            actor,
            false,
            request,
          );
        });
        throw error;
      }
      fail("ACTION_OUTCOME_UNKNOWN");
    }
  }
}

/** Creation uses the owning Project as its existing, versioned action target.
 * The new Task reference is durable execution evidence, never a renderer ID. */
class TaskCreateActionService extends TaskDescriptionActionService {
  _targetType() {
    return "Project";
  }
  _projectSnapshot(projectId, actor) {
    const project = this._ownedProject(projectId, actor);
    if (!["draft", "active"].includes(project.status))
      fail("ACTION_TARGET_NOT_EDITABLE");
    if (!Number.isSafeInteger(project.updated_at))
      fail("ACTION_SOURCE_INVALID");
    const { projectRef } = snapshotReferences(
      { id: "prospective-task" },
      project,
    );
    return { ref: projectRef, project, task: { description: "" } };
  }

  preview(input) {
    readOptions(
      input,
      ["projectId", "taskType", "description", "idempotencyKey"],
      ["reviewId", "goalIntent"],
    );
    description(input.description);
    id(input.idempotencyKey);
    if (input.goalIntent !== undefined) validateGoalIntent(input.goalIntent);
    const riskReview =
      input.reviewId === undefined
        ? null
        : this._riskService().getCreateActionContext({
            reviewId: input.reviewId,
            projectId: input.projectId,
          });
    if (
      ![
        "create_file",
        "edit_file",
        "query_info",
        "analyze_data",
        "export_file",
        "deploy_project",
      ].includes(input.taskType)
    )
      fail("ACTION_INVALID_TASK_TYPE");
    return this._transaction(() => {
      const actor = this._actor();
      const snapshot = this._projectSnapshot(input.projectId, actor);
      this._assertNoUnresolvedTask(input.projectId);
      const request = createBusinessActionRequest({
        actionType: "task.create",
        actionVersion: 1,
        target: snapshot.ref,
        expectedVersion: snapshot.ref.version,
        input: {
          taskType: input.taskType,
          description: input.description,
          ...(riskReview ? { riskReview } : {}),
          ...(input.goalIntent ? { goalIntent: input.goalIntent } : {}),
        },
        idempotencyKey: input.idempotencyKey,
      });
      this._verifyRiskContext(request);
      this._verifyGoalContext(request, actor, "preview");
      return { request, before: { description: "" }, after: request.input };
    });
  }

  _validateRequest(input) {
    let request;
    try {
      request = validateBusinessActionRequest(input);
    } catch {
      fail("ACTION_INVALID_REQUEST");
    }
    if (
      request.actionType !== "task.create" ||
      request.actionVersion !== 1 ||
      request.target.type !== "Project" ||
      request.target.sourceKind !== "desktop.project-task-owner" ||
      request.target.scope.kind !== "personal"
    )
      fail("ACTION_UNSUPPORTED_REQUEST");
    readOptions(
      request.input,
      ["taskType", "description"],
      ["riskReview", "goalIntent"],
    );
    if (request.input.riskReview) {
      readOptions(request.input.riskReview, ["id", "contentDigest"], []);
      id(request.input.riskReview.id);
      if (!/^sha256:[a-f0-9]{64}$/.test(request.input.riskReview.contentDigest))
        fail("ACTION_INVALID_REQUEST");
    }
    if (request.input.goalIntent) validateGoalIntent(request.input.goalIntent);
    description(request.input.description);
    if (
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
    this._ownedProject(request.target.id, actor);
  }
  _verifyRiskContext(request) {
    if (request.input.riskReview)
      this._riskService().verifyCreateActionContext({
        reviewId: request.input.riskReview.id,
        contentDigest: request.input.riskReview.contentDigest,
        projectId: request.target.id,
      });
  }
  _requestSnapshot(request, actor) {
    return this._projectSnapshot(request.target.id, actor);
  }
  _applyRequest(request, actor, latest) {
    const taskId = randomUUID();
    const updatedAt = Math.max(this.now(), latest.project.updated_at + 1);
    if (!Number.isSafeInteger(updatedAt)) fail("ACTION_SOURCE_INVALID");
    const result = this.db
      .prepare(
        `INSERT INTO project_tasks
      (id,project_id,task_type,description,status,created_at,updated_at,sync_status)
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
    // Advance the Project version in the same transaction as the new row and
    // receipt, so separately prepared creation requests cannot share a revision.
    const updated = this.db
      .prepare(
        "UPDATE projects SET updated_at=? WHERE id=? AND updated_at=? AND user_id=?",
      )
      .run(updatedAt, request.target.id, latest.project.updated_at, actor);
    if (updated.changes !== 1) fail("ACTION_VERSION_CONFLICT");
    const created = this._snapshot(taskId, actor, true);
    if (
      created.task.description !== request.input.description ||
      created.task.task_type !== request.input.taskType ||
      created.task.project_id !== request.target.id
    )
      fail("ACTION_POSTCONDITION_FAILED");
    return {
      kind: "sqlite-task-create",
      affectedRows: result.changes,
      afterVersion: this._projectSnapshot(request.target.id, actor).ref.version,
      createdTaskRef: created.ref,
    };
  }

  listProjectRuns(input) {
    readOptions(input, ["projectId"], ["beforeId", "limit"]);
    const limit = pageLimit(input.limit, 20, 50);
    return this._readTransaction(() => {
      const actor = this._actor();
      this._ownedProject(input.projectId, actor);
      let cursor;
      if (input.beforeId !== undefined) {
        cursor = this.db
          .prepare(
            `SELECT rowid FROM cc_business_action_runs WHERE id=? AND actor_did=? AND target_id=? AND ${receiptTarget("Project")}`,
          )
          .get(id(input.beforeId), actor, input.projectId);
        if (!cursor) fail("ACTION_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          `SELECT ${RECEIPT_COLUMNS} FROM cc_business_action_runs WHERE actor_did=? AND target_id=? AND ${receiptTarget("Project")} ${cursor ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(
          actor,
          input.projectId,
          ...(cursor ? [cursor.rowid] : []),
          limit + 1,
        );
      return {
        runs: rows.slice(0, limit).map((row) => this._readRun(row)),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
  }
}

module.exports = {
  TaskDescriptionActionService,
  TaskCreateActionService,
  createTaskDescriptionPreview,
  ACTION_TYPE,
  MAX_DESCRIPTION_BYTES,
};
