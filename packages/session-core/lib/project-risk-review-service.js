"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  digestBusinessObjectContent,
  validateBusinessActionRun,
  validateBusinessObjectRef,
} = require("./business-object-contract");
const { evaluateProjectRiskSnapshot } = require("./project-risk-evaluation");

const MAX_PROJECT_RISK_REVIEW_BYTES = 2 * 1024 * 1024;
const SOURCE_SCHEMA = "desktop.project-tasks/v1";
const REQUIRED_TASK_COLUMNS = [
  "id",
  "project_id",
  "status",
  "due_date",
  "blocked_by",
  "updated_at",
  "deleted",
];

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
    fail("PROJECT_RISK_INVALID_REQUEST");
  return value;
}

function inputId(input, name) {
  try {
    digestBusinessObjectContent(input);
  } catch {
    fail("PROJECT_RISK_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, name)
  )
    fail("PROJECT_RISK_INVALID_REQUEST");
  return identifier(input[name]);
}

function options(input, required, optional = []) {
  try {
    digestBusinessObjectContent(input);
  } catch {
    fail("PROJECT_RISK_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => ![...required, ...optional].includes(key))
  )
    fail("PROJECT_RISK_INVALID_REQUEST");
  return input;
}

function pageLimit(value) {
  const limit = value === undefined ? 10 : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    fail("PROJECT_RISK_INVALID_REQUEST");
  return limit;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function immutable(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function assertJsonScalar(value) {
  if (
    value !== null &&
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    fail("PROJECT_RISK_SOURCE_INVALID");
}

function deriveReviewEvaluation(snapshot) {
  const evaluation = evaluateProjectRiskSnapshot(snapshot);
  const collectionReason = {
    "schema-incomplete": "SOURCE_SCHEMA_INCOMPLETE",
    "task-limit-exceeded": "TASK_LIMIT_EXCEEDED",
  }[snapshot.readStatus];
  return collectionReason
    ? { ...evaluation, reasonCodes: [collectionReason] }
    : evaluation;
}

/**
 * Authorized selected-field project risk reads and durable rule evidence.
 * The host supplies current identity and a native synchronous SQLite handle.
 * Risk references remain selected-field versions, never full-row action
 * revisions. Action admission binds a verified review inside the same native
 * transaction; manual feedback is append-only and never rewrites rule facts.
 */
class ProjectRiskReviewService {
  constructor({ db, getActor, now = () => Date.now() } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("PROJECT_RISK_NATIVE_DATABASE_REQUIRED");
    if (typeof getActor !== "function" || typeof now !== "function")
      fail("PROJECT_RISK_AUTHORITY_UNAVAILABLE");
    this.db = db;
    this.getActor = getActor;
    this.now = now;
    this._transaction(() =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS cc_project_risk_reviews (
      id TEXT PRIMARY KEY,
      actor_did TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_json TEXT NOT NULL,
      evaluation_json TEXT NOT NULL,
      content_digest TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cc_project_risk_reviews_actor_project
      ON cc_project_risk_reviews(actor_did,project_id);
    CREATE TABLE IF NOT EXISTS cc_project_risk_action_links (
      review_id TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE,
      actor_did TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      invocation_digest TEXT NOT NULL,
      PRIMARY KEY(review_id,run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cc_project_risk_action_links_review
      ON cc_project_risk_action_links(review_id);
    CREATE TABLE IF NOT EXISTS cc_project_risk_feedback (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      feedback_json TEXT NOT NULL,
      content_digest TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cc_project_risk_feedback_review
      ON cc_project_risk_feedback(review_id,actor_did)`),
    );
  }

  _transaction(operation) {
    if (this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_BUSY");
    try {
      return this.db.transaction(operation).immediate();
    } catch (error) {
      if (
        typeof error?.code === "string" &&
        error.code.startsWith("PROJECT_RISK_")
      )
        throw error;
      fail("PROJECT_RISK_READ_FAILED");
    }
  }

  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      fail("PROJECT_RISK_AUTHORITY_UNAVAILABLE");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("PROJECT_RISK_AUTHENTICATION_REQUIRED");
    return identifier(actor);
  }

  _hasTable(name) {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name),
    );
  }

  _ownedProject(projectId, actor) {
    const columns = new Set(
      this.db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .map((column) => column.name),
    );
    const selected = [
      "id",
      "user_id",
      "status",
      "updated_at",
      "deleted",
      ...["org_id", "workspace_id"].filter((column) => columns.has(column)),
    ];
    const project = this.db
      .prepare(`SELECT ${selected.join(",")} FROM projects WHERE id=?`)
      .get(projectId);
    if (
      !project ||
      project.user_id !== actor ||
      (project.deleted != null && project.deleted !== 0)
    )
      fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    if (project.org_id != null || project.workspace_id != null)
      fail("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
    if (
      this._hasTable("organization_projects") &&
      this.db
        .prepare("SELECT 1 FROM organization_projects WHERE id=?")
        .get(projectId)
    )
      fail("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
    if (
      this._hasTable("workspace_resources") &&
      this.db
        .prepare(
          "SELECT 1 FROM workspace_resources WHERE resource_type='project' AND resource_id=? LIMIT 1",
        )
        .get(projectId)
    )
      fail("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
    return project;
  }

  _taskColumns() {
    return new Set(
      this.db
        .prepare("PRAGMA table_info(project_tasks)")
        .all()
        .map((column) => column.name),
    );
  }

  _scopeQuery(columns) {
    const fields = ["org_id", "workspace_id"].filter((name) =>
      columns.has(name),
    );
    return fields.map((name) => `${name} IS NOT NULL`).join(" OR ");
  }

  _checkProjectTaskScope(projectId, columns) {
    if (!columns.has("project_id")) return;
    const scope = this._scopeQuery(columns);
    const live = columns.has("deleted")
      ? "AND (deleted IS NULL OR deleted=0)"
      : "";
    if (
      scope &&
      this.db
        .prepare(
          `SELECT 1 FROM project_tasks WHERE project_id=? ${live} AND (${scope}) LIMIT 1`,
        )
        .get(projectId)
    )
      fail("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
    if (
      columns.has("id") &&
      this._hasTable("workspace_resources") &&
      this.db
        .prepare(
          `SELECT 1 FROM project_tasks t
          WHERE t.project_id=? ${live} AND EXISTS (SELECT 1 FROM workspace_resources r
            WHERE r.resource_type='task' AND r.resource_id=t.id) LIMIT 1`,
        )
        .get(projectId)
    )
      fail("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
  }

  _snapshot(project, actor, createdAt, columns) {
    for (const value of [project.id, project.status, project.updated_at])
      assertJsonScalar(value);
    const snapshot = {
      sourceSchema: SOURCE_SCHEMA,
      readStatus: "complete",
      asOf: createdAt,
      scope: { kind: "personal", id: actor },
      project: {
        id: project.id,
        status: project.status,
        updated_at: project.updated_at,
      },
      tasks: [],
    };
    if (REQUIRED_TASK_COLUMNS.some((column) => !columns.has(column))) {
      snapshot.readStatus = "schema-incomplete";
      return snapshot;
    }
    // Inspect lengths before allocating selected values in JavaScript. LIMIT
    // 1001 distinguishes a complete <=1000 set from a partial page.
    const rawSize = [
      "id",
      "project_id",
      "status",
      "due_date",
      "blocked_by",
      "updated_at",
    ]
      .map((name) => `COALESCE(length(CAST(${name} AS BLOB)),0)`)
      .join("+");
    const sizes = this.db
      .prepare(
        `SELECT ${rawSize} AS bytes
      FROM project_tasks WHERE project_id=? AND (deleted IS NULL OR deleted=0)
      ORDER BY id LIMIT 1001`,
      )
      .all(project.id);
    if (sizes.length > 1000) {
      snapshot.readStatus = "task-limit-exceeded";
      return snapshot;
    }
    if (
      sizes.reduce((sum, row) => sum + row.bytes, 0) >
      MAX_PROJECT_RISK_REVIEW_BYTES
    )
      fail("PROJECT_RISK_EVIDENCE_TOO_LARGE");
    const tasks = this.db
      .prepare(
        `SELECT id,project_id,status,due_date,blocked_by,updated_at
      FROM project_tasks WHERE project_id=? AND (deleted IS NULL OR deleted=0)
      ORDER BY id LIMIT 1001`,
      )
      .all(project.id);
    snapshot.tasks = tasks.map((task) => {
      for (const value of Object.values(task)) assertJsonScalar(value);
      try {
        identifier(task.id);
        identifier(task.project_id);
      } catch {
        fail("PROJECT_RISK_SOURCE_INVALID");
      }
      return {
        ...task,
        // Migration 7 gives blocked_by SQL NULL for no configured dependency.
        // Empty strings and malformed JSON are preserved for fail-closed rules.
        blocked_by: task.blocked_by === null ? [] : task.blocked_by,
      };
    });
    return snapshot;
  }

  evaluate(input) {
    const projectId = inputId(input, "projectId");
    return this._transaction(() => this._evaluateProject(projectId));
  }

  /** Trusted native-domain composition only. The caller owns the surrounding
   * immediate transaction; project ownership and source validation still run. */
  evaluateInTransaction(input) {
    const projectId = inputId(input, "projectId");
    if (!this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_REQUIRED");
    return this._evaluateProject(projectId);
  }

  getReviewInTransaction(input) {
    const reviewId = inputId(input, "reviewId");
    if (!this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_REQUIRED");
    return this._readReview(reviewId, this._actor());
  }

  _evaluateProject(projectId) {
    const actor = this._actor();
    const project = this._ownedProject(projectId, actor);
    const columns = this._taskColumns();
    this._checkProjectTaskScope(projectId, columns);
    const at = this.now();
    if (!Number.isSafeInteger(at) || at < 0 || at > 253402300799999)
      fail("PROJECT_RISK_INVALID_CLOCK");
    const createdAt = new Date(at).toISOString();
    const sourceSnapshot = this._snapshot(project, actor, createdAt, columns);
    const sourceJson = JSON.stringify(sourceSnapshot);
    if (Buffer.byteLength(sourceJson, "utf8") > MAX_PROJECT_RISK_REVIEW_BYTES)
      fail("PROJECT_RISK_EVIDENCE_TOO_LARGE");
    const evaluation = deriveReviewEvaluation(sourceSnapshot);
    const review = {
      id: randomUUID(),
      projectId,
      actorDid: actor,
      createdAt,
    };
    const result = { review, sourceSnapshot, evaluation };
    const evaluationJson = JSON.stringify(evaluation);
    if (
      Buffer.byteLength(JSON.stringify(result), "utf8") >
      MAX_PROJECT_RISK_REVIEW_BYTES
    )
      fail("PROJECT_RISK_EVIDENCE_TOO_LARGE");
    this.db
      .prepare(
        `INSERT INTO cc_project_risk_reviews
        (id,actor_did,project_id,created_at,source_json,evaluation_json,content_digest)
        VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        review.id,
        actor,
        projectId,
        createdAt,
        sourceJson,
        evaluationJson,
        digest(result),
      );
    return immutable(result);
  }

  _checkHistoricalTasks(snapshot, columns) {
    if (!Array.isArray(snapshot.tasks) || snapshot.tasks.length > 1000)
      fail("PROJECT_RISK_REVIEW_CORRUPT");
    if (snapshot.tasks.length === 0) return;
    if (!["id", "project_id", "deleted"].every((column) => columns.has(column)))
      fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    const selected = [
      "id",
      "project_id",
      "deleted",
      ...["org_id", "workspace_id"].filter((column) => columns.has(column)),
    ];
    const getTask = this.db.prepare(
      `SELECT ${selected.join(",")} FROM project_tasks WHERE id=?`,
    );
    for (const prior of snapshot.tasks) {
      const current = getTask.get(identifier(prior.id));
      if (
        !current ||
        current.project_id !== snapshot.project.id ||
        (current.deleted != null && current.deleted !== 0)
      )
        fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
      if (current.org_id != null || current.workspace_id != null)
        fail("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
    }
  }

  getReview(input) {
    const reviewId = inputId(input, "reviewId");
    return this._transaction(() => this._readReview(reviewId, this._actor()));
  }

  _readReview(reviewId, actor) {
    const meta = this.db
      .prepare(
        `SELECT id,actor_did,project_id,created_at,
        length(CAST(source_json AS BLOB)) AS source_bytes,
        length(CAST(evaluation_json AS BLOB)) AS evaluation_bytes
        FROM cc_project_risk_reviews WHERE id=? AND actor_did=?`,
      )
      .get(reviewId, actor);
    if (!meta) fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    this._ownedProject(meta.project_id, actor);
    const columns = this._taskColumns();
    this._checkProjectTaskScope(meta.project_id, columns);
    if (
      !Number.isSafeInteger(meta.source_bytes) ||
      !Number.isSafeInteger(meta.evaluation_bytes) ||
      meta.source_bytes + meta.evaluation_bytes > MAX_PROJECT_RISK_REVIEW_BYTES
    )
      fail("PROJECT_RISK_REVIEW_CORRUPT");
    const row = this.db
      .prepare(
        "SELECT source_json,evaluation_json,content_digest FROM cc_project_risk_reviews WHERE id=? AND actor_did=?",
      )
      .get(reviewId, actor);
    let result;
    try {
      const sourceSnapshot = JSON.parse(row.source_json);
      const evaluation = JSON.parse(row.evaluation_json);
      result = {
        review: {
          id: meta.id,
          projectId: meta.project_id,
          actorDid: meta.actor_did,
          createdAt: meta.created_at,
        },
        sourceSnapshot,
        evaluation,
      };
      if (
        sourceSnapshot.sourceSchema !== SOURCE_SCHEMA ||
        !["complete", "schema-incomplete", "task-limit-exceeded"].includes(
          sourceSnapshot.readStatus,
        ) ||
        sourceSnapshot.project.id !== meta.project_id ||
        sourceSnapshot.scope.kind !== "personal" ||
        sourceSnapshot.scope.id !== actor ||
        sourceSnapshot.asOf !== meta.created_at ||
        row.content_digest !== digest(result) ||
        canonical(deriveReviewEvaluation(sourceSnapshot)) !==
          canonical(evaluation) ||
        Buffer.byteLength(JSON.stringify(result), "utf8") >
          MAX_PROJECT_RISK_REVIEW_BYTES
      )
        fail("PROJECT_RISK_REVIEW_CORRUPT");
    } catch {
      fail("PROJECT_RISK_REVIEW_CORRUPT");
    }
    this._checkHistoricalTasks(result.sourceSnapshot, columns);
    return immutable(result);
  }

  listReviews(input) {
    const value = options(input, ["projectId"], ["beforeId", "limit"]);
    identifier(value.projectId);
    if (value.beforeId !== undefined) identifier(value.beforeId);
    const limit = pageLimit(value.limit);
    return this._transaction(() => {
      const actor = this._actor();
      this._ownedProject(value.projectId, actor);
      let cursor;
      if (value.beforeId !== undefined) {
        cursor = this.db
          .prepare(
            "SELECT rowid FROM cc_project_risk_reviews WHERE id=? AND actor_did=? AND project_id=?",
          )
          .get(value.beforeId, actor, value.projectId);
        if (!cursor) fail("PROJECT_RISK_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          `SELECT id FROM cc_project_risk_reviews
        WHERE actor_did=? AND project_id=? ${cursor ? "AND rowid<?" : ""}
        ORDER BY rowid DESC LIMIT ?`,
        )
        .all(
          actor,
          value.projectId,
          ...(cursor ? [cursor.rowid] : []),
          limit + 1,
        );
      const reviews = rows.slice(0, limit).map(({ id }) => {
        const result = this._readReview(id, actor);
        return {
          review: result.review,
          status: result.evaluation.status,
          summary: result.evaluation.summary,
          reasonCodes: result.evaluation.reasonCodes,
          contentDigest: digest(result),
        };
      });
      return immutable({
        reviews,
        nextCursor: rows.length > limit ? reviews.at(-1).review.id : null,
      });
    });
  }

  _actionContext(value, actor, requireFresh = true) {
    const result = this._readReview(value.reviewId, actor);
    const contentDigest = digest(result);
    if (
      value.contentDigest !== undefined &&
      value.contentDigest !== contentDigest
    )
      fail("PROJECT_RISK_REVIEW_CONFLICT");
    if (
      result.evaluation.status !== "evaluated" ||
      (value.projectId === undefined
        ? !result.sourceSnapshot.tasks.some((task) => task.id === value.taskId)
        : result.review.projectId !== value.projectId)
    )
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    if (requireFresh) {
      const project = this._ownedProject(result.review.projectId, actor);
      const columns = this._taskColumns();
      this._checkProjectTaskScope(project.id, columns);
      const current = this._snapshot(
        project,
        actor,
        result.review.createdAt,
        columns,
      );
      if (canonical(current) !== canonical(result.sourceSnapshot))
        fail("PROJECT_RISK_REVIEW_STALE");
    }
    return immutable({ id: result.review.id, contentDigest });
  }

  getActionContext(input) {
    const value = options(input, ["reviewId", "taskId"]);
    identifier(value.reviewId);
    identifier(value.taskId);
    // This may be used by the action service during its preview transaction.
    if (this.db.inTransaction) return this._actionContext(value, this._actor());
    return this._transaction(() => this._actionContext(value, this._actor()));
  }

  verifyActionContext(input) {
    if (!this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_REQUIRED");
    const value = options(input, ["reviewId", "taskId", "contentDigest"]);
    identifier(value.reviewId);
    identifier(value.taskId);
    return this._actionContext(value, this._actor());
  }

  getCreateActionContext(input) {
    const value = options(input, ["reviewId", "projectId"]);
    identifier(value.reviewId);
    identifier(value.projectId);
    if (this.db.inTransaction) return this._actionContext(value, this._actor());
    return this._transaction(() => this._actionContext(value, this._actor()));
  }

  verifyCreateActionContext(input) {
    if (!this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_REQUIRED");
    const value = options(input, ["reviewId", "projectId", "contentDigest"]);
    identifier(value.reviewId);
    identifier(value.projectId);
    return this._actionContext(value, this._actor());
  }

  bindActionRun(input) {
    if (!this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_REQUIRED");
    const value = options(input, ["reviewId", "run", "contentDigest"]);
    const actor = this._actor();
    let run;
    try {
      run = validateBusinessActionRun(value.run);
    } catch {
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    }
    if (
      !["task.update-description", "task.create"].includes(run.actionType) ||
      run.target.type !==
        (run.actionType === "task.create" ? "Project" : "Task") ||
      run.target.scope.kind !== "personal" ||
      run.target.scope.id !== actor
    )
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    this._actionContext(
      {
        ...value,
        ...(run.actionType === "task.create"
          ? { projectId: run.target.id }
          : { taskId: run.target.id }),
      },
      actor,
      false,
    );
    const row = this.db
      .prepare(
        "SELECT actor_did,invocation_digest,run_json FROM cc_business_action_runs WHERE id=?",
      )
      .get(run.id);
    if (
      !row ||
      row.actor_did !== actor ||
      row.invocation_digest !== run.invocationDigest ||
      row.run_json !== JSON.stringify(run)
    )
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    const previous = this.db
      .prepare("SELECT * FROM cc_project_risk_action_links WHERE run_id=?")
      .get(run.id);
    if (previous) {
      if (
        previous.review_id !== value.reviewId ||
        previous.actor_did !== actor ||
        previous.content_digest !== value.contentDigest ||
        previous.invocation_digest !== run.invocationDigest
      )
        fail("PROJECT_RISK_REVIEW_CONFLICT");
      return;
    }
    this.db
      .prepare(
        `INSERT INTO cc_project_risk_action_links
      (review_id,run_id,actor_did,content_digest,invocation_digest) VALUES (?,?,?,?,?)`,
      )
      .run(
        value.reviewId,
        run.id,
        actor,
        value.contentDigest,
        run.invocationDigest,
      );
  }

  recordFeedback(input) {
    const value = options(
      input,
      ["reviewId", "taskId", "verdict", "reasonCodes"],
      ["comment"],
    );
    identifier(value.reviewId);
    identifier(value.taskId);
    const allowedReasons = [
      "OVERDUE_INCOMPLETE_TASK",
      "BLOCKED_BY_INCOMPLETE_DEPENDENCY",
    ];
    if (
      !["affirmed", "dismissed", "needs-review"].includes(value.verdict) ||
      !Array.isArray(value.reasonCodes) ||
      value.reasonCodes.length > 2 ||
      new Set(value.reasonCodes).size !== value.reasonCodes.length ||
      value.reasonCodes.some((code) => !allowedReasons.includes(code)) ||
      (value.verdict === "dismissed" && value.reasonCodes.length !== 0) ||
      (value.comment !== undefined &&
        (typeof value.comment !== "string" ||
          Buffer.byteLength(value.comment, "utf8") > 4096))
    )
      fail("PROJECT_RISK_INVALID_REQUEST");
    return this._transaction(() => {
      const actor = this._actor();
      this._actionContext(value, actor, false);
      const at = this.now();
      if (!Number.isSafeInteger(at) || at < 0 || at > 253402300799999)
        fail("PROJECT_RISK_INVALID_CLOCK");
      const feedback = {
        id: randomUUID(),
        reviewId: value.reviewId,
        taskId: value.taskId,
        actorDid: actor,
        createdAt: new Date(at).toISOString(),
        verdict: value.verdict,
        reasonCodes: [...value.reasonCodes].sort(),
        comment: value.comment ?? "",
      };
      this.db
        .prepare(
          `INSERT INTO cc_project_risk_feedback
        (id,review_id,actor_did,feedback_json,content_digest) VALUES (?,?,?,?,?)`,
        )
        .run(
          feedback.id,
          value.reviewId,
          actor,
          JSON.stringify(feedback),
          digest(feedback),
        );
      return immutable({ feedback, contentDigest: digest(feedback) });
    });
  }

  _lineageRun(row, context, actor) {
    try {
      if (!row.run_json || !row.evidence_json) throw new Error();
      const run = validateBusinessActionRun(JSON.parse(row.run_json));
      const evidence = JSON.parse(row.evidence_json);
      if (
        run.id !== row.run_id ||
        row.actor_did !== actor ||
        run.target.scope.id !== actor ||
        run.target.scope.kind !== "personal" ||
        run.target.sourceKind !==
          (run.actionType === "task.create"
            ? "desktop.project-task-owner"
            : "desktop.project-task") ||
        row.receipt_actor !== actor ||
        row.receipt_target !== run.target.id ||
        row.receipt_idempotency !== run.idempotencyDigest ||
        row.receipt_invocation !== run.invocationDigest ||
        row.invocation_digest !== run.invocationDigest ||
        !Array.isArray(evidence) ||
        evidence.length !== run.evidenceRefs.length ||
        new Set(evidence.map((item) => item.id)).size !== evidence.length
      )
        throw new Error();
      for (const item of evidence) {
        const ref = run.evidenceRefs.find((entry) => entry.id === item.id);
        if (
          !ref ||
          ref.digest !== digestBusinessObjectContent(item) ||
          item.actorDid !== actor ||
          item.invocationDigest !== run.invocationDigest
        )
          throw new Error();
      }
      const source = evidence.filter(
        (item) => item.kind === "project-risk-review",
      );
      if (
        source.length !== 1 ||
        source[0].reviewId !== context.review.id ||
        source[0].contentDigest !== digest(context) ||
        source[0].actionDigest !== run.actionDigest ||
        source[0].expectedVersion !== run.expectedVersion ||
        row.content_digest !== digest(context) ||
        !["task.update-description", "task.create"].includes(run.actionType) ||
        run.target.type !==
          (run.actionType === "task.create" ? "Project" : "Task") ||
        (run.actionType === "task.create"
          ? run.target.id !== context.review.projectId
          : !context.sourceSnapshot.tasks.some(
              (task) => task.id === run.target.id,
            ))
      )
        throw new Error();
      const approval = evidence.find((item) => item.id === run.approvalRef?.id);
      const execution = evidence.find(
        (item) => item.id === run.executionRef?.id,
      );
      if (
        (run.approvalRef &&
          (!approval ||
            approval.actionDigest !== run.actionDigest ||
            approval.expectedVersion !== run.expectedVersion)) ||
        (run.executionRef && !execution)
      )
        throw new Error();
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
        throw new Error();
      if (run.status === "succeeded" && run.actionType === "task.create") {
        const created = validateBusinessObjectRef(execution?.createdTaskRef);
        if (
          created?.type !== "Task" ||
          created.sourceKind !== "desktop.project-task" ||
          created.scope?.kind !== "personal" ||
          created.scope.id !== actor
        )
          throw new Error();
        const columns = this._taskColumns();
        this._checkHistoricalTasks(
          {
            project: context.sourceSnapshot.project,
            tasks: [{ id: created.id }],
          },
          columns,
        );
      }
      return { run, evidence };
    } catch {
      fail("PROJECT_RISK_LINEAGE_CORRUPT");
    }
  }

  getLineage(input) {
    const value = options(
      input,
      ["reviewId"],
      ["beforeId", "feedbackBeforeId", "limit"],
    );
    identifier(value.reviewId);
    for (const key of ["beforeId", "feedbackBeforeId"])
      if (value[key] !== undefined) identifier(value[key]);
    const limit = pageLimit(value.limit);
    return this._transaction(() => {
      const actor = this._actor();
      const context = this._readReview(value.reviewId, actor);
      const cursorFor = (table, key, cursor) => {
        if (cursor === undefined) return undefined;
        const row = this.db
          .prepare(
            `SELECT rowid FROM ${table} WHERE ${key}=? AND review_id=? AND actor_did=?`,
          )
          .get(cursor, value.reviewId, actor);
        if (!row) fail("PROJECT_RISK_INVALID_CURSOR");
        return row.rowid;
      };
      const cursor = cursorFor(
        "cc_project_risk_action_links",
        "run_id",
        value.beforeId,
      );
      const feedbackCursor = cursorFor(
        "cc_project_risk_feedback",
        "id",
        value.feedbackBeforeId,
      );
      let actionRows = [];
      if (this._hasTable("cc_business_action_runs")) {
        actionRows = this.db
          .prepare(
            `SELECT l.run_id,l.actor_did,l.content_digest,l.invocation_digest,
          r.actor_did AS receipt_actor,r.target_id AS receipt_target,
          r.idempotency_digest AS receipt_idempotency,r.invocation_digest AS receipt_invocation,
          CASE WHEN length(CAST(r.run_json AS BLOB))<=65536 THEN r.run_json ELSE NULL END AS run_json,
          CASE WHEN length(CAST(r.evidence_json AS BLOB))<=65536 THEN r.evidence_json ELSE NULL END AS evidence_json
          FROM cc_project_risk_action_links l LEFT JOIN cc_business_action_runs r ON r.id=l.run_id
          WHERE l.review_id=? AND l.actor_did=? ${cursor !== undefined ? "AND l.rowid<?" : ""}
          ORDER BY l.rowid DESC LIMIT ?`,
          )
          .all(
            value.reviewId,
            actor,
            ...(cursor !== undefined ? [cursor] : []),
            limit + 1,
          );
      } else if (
        this.db
          .prepare(
            "SELECT 1 FROM cc_project_risk_action_links WHERE review_id=? LIMIT 1",
          )
          .get(value.reviewId)
      )
        fail("PROJECT_RISK_LINEAGE_CORRUPT");
      const rows = this.db
        .prepare(
          `SELECT id,content_digest,
        CASE WHEN length(CAST(feedback_json AS BLOB))<=8192 THEN feedback_json ELSE NULL END AS feedback_json
        FROM cc_project_risk_feedback WHERE review_id=? AND actor_did=?
        ${feedbackCursor !== undefined ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(
          value.reviewId,
          actor,
          ...(feedbackCursor !== undefined ? [feedbackCursor] : []),
          limit + 1,
        );
      const feedback = rows.slice(0, limit).map((row) => {
        try {
          if (!row.feedback_json) throw new Error();
          const item = JSON.parse(row.feedback_json);
          options(item, [
            "id",
            "reviewId",
            "taskId",
            "actorDid",
            "createdAt",
            "verdict",
            "reasonCodes",
            "comment",
          ]);
          identifier(item.id);
          identifier(item.taskId);
          if (
            typeof item.createdAt !== "string" ||
            !Number.isFinite(Date.parse(item.createdAt)) ||
            new Date(item.createdAt).toISOString() !== item.createdAt ||
            !["affirmed", "dismissed", "needs-review"].includes(item.verdict) ||
            !Array.isArray(item.reasonCodes) ||
            item.reasonCodes.length > 2 ||
            new Set(item.reasonCodes).size !== item.reasonCodes.length ||
            item.reasonCodes.some(
              (code) =>
                ![
                  "OVERDUE_INCOMPLETE_TASK",
                  "BLOCKED_BY_INCOMPLETE_DEPENDENCY",
                ].includes(code),
            ) ||
            (item.verdict === "dismissed" && item.reasonCodes.length !== 0) ||
            typeof item.comment !== "string" ||
            Buffer.byteLength(item.comment, "utf8") > 4096
          )
            throw new Error();
          if (
            item.id !== row.id ||
            item.reviewId !== value.reviewId ||
            item.actorDid !== actor ||
            row.content_digest !== digest(item) ||
            !context.sourceSnapshot.tasks.some(
              (task) => task.id === item.taskId,
            )
          )
            throw new Error();
          return { feedback: item, contentDigest: row.content_digest };
        } catch {
          fail("PROJECT_RISK_FEEDBACK_CORRUPT");
        }
      });
      const result = {
        review: context.review,
        contentDigest: digest(context),
        evaluation: context.evaluation,
        actionRuns: actionRows
          .slice(0, limit)
          .map((row) => this._lineageRun(row, context, actor)),
        feedback,
        nextCursor:
          actionRows.length > limit ? actionRows[limit - 1].run_id : null,
        nextFeedbackCursor: rows.length > limit ? rows[limit - 1].id : null,
        proof: "local-content-binding",
        modelUsage: null,
        cost: { status: "unknown" },
      };
      if (
        Buffer.byteLength(JSON.stringify(result), "utf8") >
        MAX_PROJECT_RISK_REVIEW_BYTES
      )
        fail("PROJECT_RISK_EVIDENCE_TOO_LARGE");
      return immutable(result);
    });
  }
}

module.exports = { ProjectRiskReviewService, MAX_PROJECT_RISK_REVIEW_BYTES };
