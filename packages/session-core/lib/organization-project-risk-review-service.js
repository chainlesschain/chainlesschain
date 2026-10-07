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
 * Organization risk reviews use independent tables and explicit risk permissions.
 * Creator identities are attribution; current authorized readers share history.
 * Full authority fences bind action freshness; historical reads retain the original mapping.
 * Risk references remain selected-field versions, never full-row action
 * revisions. Action admission binds a verified review inside the same native
 * transaction; manual feedback is append-only and never rewrites rule facts.
 */
class OrganizationProjectRiskReviewService {
  constructor({ db, getActor, authority, now = () => Date.now() } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("PROJECT_RISK_NATIVE_DATABASE_REQUIRED");
    if (typeof getActor !== "function" || typeof now !== "function")
      fail("PROJECT_RISK_AUTHORITY_UNAVAILABLE");
    if (typeof authority?.assertAuthorizedInTransaction !== "function")
      fail("PROJECT_RISK_AUTHORITY_UNAVAILABLE");
    this.authority = authority;
    this.db = db;
    this.getActor = getActor;
    this.now = now;
    this._transaction(() =>
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS cc_organization_project_risk_reviews (
      id TEXT PRIMARY KEY,
      actor_did TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      authority_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      evaluation_json TEXT NOT NULL,
      content_digest TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cc_organization_project_risk_reviews_actor_project
      ON cc_organization_project_risk_reviews(actor_did,project_id);
    CREATE TABLE IF NOT EXISTS cc_organization_project_risk_action_links (
      review_id TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE,
      actor_did TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      invocation_digest TEXT NOT NULL,
      PRIMARY KEY(review_id,run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cc_organization_project_risk_action_links_review
      ON cc_organization_project_risk_action_links(review_id);
    CREATE TABLE IF NOT EXISTS cc_organization_project_risk_feedback (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      feedback_json TEXT NOT NULL,
      content_digest TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cc_organization_project_risk_feedback_review
      ON cc_organization_project_risk_feedback(review_id,actor_did)`),
    );
    this._transaction(() => {
      for (const table of [
        "cc_organization_project_risk_reviews",
        "cc_organization_project_risk_action_links",
        "cc_organization_project_risk_feedback",
      ])
        for (const operation of ["UPDATE", "DELETE"])
          this.db
            .exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${operation.toLowerCase()}_immutable
            BEFORE ${operation} ON ${table}
            BEGIN SELECT RAISE(ABORT,'PROJECT_RISK_IMMUTABLE'); END;`);
    });
  }

  _transaction(operation) {
    if (this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_BUSY");
    try {
      return this.db.transaction(operation).immediate();
    } catch (error) {
      if (
        typeof error?.code === "string" &&
        /^(PROJECT_RISK_|ORG_AUTH_)/u.test(error.code)
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

  _authorize(projectId, actor, permission = "risk.read", expectedAuthority) {
    const current = this.authority.assertAuthorizedInTransaction({
      projectId,
      actorDid: actor,
      permission,
      ...(expectedAuthority ? { expectedAuthority } : {}),
    });
    if (
      expectedAuthority &&
      canonical(current) !== canonical(expectedAuthority)
    )
      fail("PROJECT_RISK_REVIEW_STALE");
    return current;
  }

  _ownedProject(projectId, actor) {
    const authority = this._authorize(projectId, actor);
    const columns = new Set(
      this.db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .map((row) => row.name),
    );
    if (
      !["id", "user_id", "status", "updated_at"].every((key) =>
        columns.has(key),
      )
    )
      fail("PROJECT_RISK_SOURCE_INVALID");
    const selected = [
      "id",
      "user_id",
      "status",
      "updated_at",
      ...["deleted", "org_id", "workspace_id"].filter((key) =>
        columns.has(key),
      ),
    ];
    const project = this.db
      .prepare(`SELECT ${selected.join(",")} FROM projects WHERE id=?`)
      .get(projectId);
    if (
      !project ||
      (project.deleted != null && project.deleted !== 0) ||
      project.workspace_id != null ||
      (project.org_id != null && project.org_id !== authority.scope.id) ||
      (this._hasTable("workspace_resources") &&
        this.db
          .prepare(
            "SELECT 1 FROM workspace_resources WHERE resource_type='project' AND resource_id=? LIMIT 1",
          )
          .get(projectId))
    )
      fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
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

  _checkProjectTaskScope(projectId, columns) {
    if (!columns.has("project_id")) return;
    const authority = this._authorize(projectId, this._actor());
    const live = columns.has("deleted")
      ? "AND (deleted IS NULL OR deleted=0)"
      : "";
    const predicates = [];
    const parameters = [projectId];
    if (columns.has("org_id")) {
      predicates.push("(org_id IS NOT NULL AND org_id<>?)");
      parameters.push(authority.scope.id);
    }
    if (columns.has("workspace_id"))
      predicates.push("workspace_id IS NOT NULL");
    if (
      predicates.length &&
      this.db
        .prepare(
          `SELECT 1 FROM project_tasks WHERE project_id=? ${live} AND (${predicates.join(" OR ")}) LIMIT 1`,
        )
        .get(...parameters)
    )
      fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    if (
      columns.has("id") &&
      this._hasTable("workspace_resources") &&
      this.db
        .prepare(
          `SELECT 1 FROM project_tasks t WHERE t.project_id=? ${live} AND EXISTS (SELECT 1 FROM workspace_resources r WHERE r.resource_type='task' AND r.resource_id=t.id) LIMIT 1`,
        )
        .get(projectId)
    )
      fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
  }

  _snapshot(project, actor, createdAt, columns) {
    for (const value of [project.id, project.status, project.updated_at])
      assertJsonScalar(value);
    const snapshot = {
      sourceSchema: SOURCE_SCHEMA,
      readStatus: "complete",
      asOf: createdAt,
      scope: this._authorize(project.id, actor).scope,
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
    const authority = this._authorize(projectId, actor, "risk.evaluate");
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
    const result = { review, sourceSnapshot, evaluation, authority };
    const evaluationJson = JSON.stringify(evaluation);
    if (
      Buffer.byteLength(JSON.stringify(result), "utf8") >
      MAX_PROJECT_RISK_REVIEW_BYTES
    )
      fail("PROJECT_RISK_EVIDENCE_TOO_LARGE");
    this.db
      .prepare(
        `INSERT INTO cc_organization_project_risk_reviews
        (id,actor_did,project_id,created_at,authority_json,source_json,evaluation_json,content_digest)
        VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        review.id,
        actor,
        projectId,
        createdAt,
        JSON.stringify(authority),
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
      if (
        (current.org_id != null && current.org_id !== snapshot.scope.id) ||
        current.workspace_id != null ||
        (this._hasTable("workspace_resources") &&
          this.db
            .prepare(
              "SELECT 1 FROM workspace_resources WHERE resource_type='task' AND resource_id=? LIMIT 1",
            )
            .get(current.id))
      )
        fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
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
        length(CAST(authority_json AS BLOB)) AS authority_bytes,
        length(CAST(source_json AS BLOB)) AS source_bytes,
        length(CAST(evaluation_json AS BLOB)) AS evaluation_bytes
        FROM cc_organization_project_risk_reviews WHERE id=?`,
      )
      .get(reviewId);
    if (!meta) fail("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    this._ownedProject(meta.project_id, actor);
    const currentAuthority = this._authorize(meta.project_id, actor);
    const columns = this._taskColumns();
    this._checkProjectTaskScope(meta.project_id, columns);
    if (
      !Number.isSafeInteger(meta.authority_bytes) ||
      meta.authority_bytes > 8192 ||
      !Number.isSafeInteger(meta.source_bytes) ||
      !Number.isSafeInteger(meta.evaluation_bytes) ||
      meta.source_bytes + meta.evaluation_bytes > MAX_PROJECT_RISK_REVIEW_BYTES
    )
      fail("PROJECT_RISK_REVIEW_CORRUPT");
    const row = this.db
      .prepare(
        "SELECT authority_json,source_json,evaluation_json,content_digest FROM cc_organization_project_risk_reviews WHERE id=?",
      )
      .get(reviewId);
    let result;
    try {
      const sourceSnapshot = JSON.parse(row.source_json);
      const evaluation = JSON.parse(row.evaluation_json);
      const authority = JSON.parse(row.authority_json);
      options(sourceSnapshot, [
        "sourceSchema",
        "readStatus",
        "asOf",
        "scope",
        "project",
        "tasks",
      ]);
      options(authority.scope, ["kind", "id"]);
      result = {
        review: {
          id: meta.id,
          projectId: meta.project_id,
          actorDid: meta.actor_did,
          createdAt: meta.created_at,
        },
        sourceSnapshot,
        evaluation,
        authority,
      };
      options(authority, [
        "scope",
        "mappingRevision",
        "authorityEpoch",
        "sourceRevision",
        "policyDigest",
        "projectSourceRevision",
        "databaseSchemaRevision",
      ]);
      if (
        !/^sha256:[a-f0-9]{64}$/u.test(authority.policyDigest) ||
        [
          "mappingRevision",
          "authorityEpoch",
          "sourceRevision",
          "projectSourceRevision",
          "databaseSchemaRevision",
        ].some(
          (key) => !Number.isSafeInteger(authority[key]) || authority[key] < 1,
        )
      )
        throw new Error();
      identifier(meta.actor_did);
      if (
        !meta.actor_did.startsWith("did:") ||
        new Date(meta.created_at).toISOString() !== meta.created_at
      )
        throw new Error();
      if (
        sourceSnapshot.sourceSchema !== SOURCE_SCHEMA ||
        !["complete", "schema-incomplete", "task-limit-exceeded"].includes(
          sourceSnapshot.readStatus,
        ) ||
        sourceSnapshot.project.id !== meta.project_id ||
        sourceSnapshot.scope.kind !== "organization" ||
        canonical(sourceSnapshot.scope) !== canonical(authority.scope) ||
        canonical(authority.scope) !== canonical(currentAuthority.scope) ||
        authority.mappingRevision !== currentAuthority.mappingRevision ||
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
            "SELECT rowid FROM cc_organization_project_risk_reviews WHERE id=? AND project_id=?",
          )
          .get(value.beforeId, value.projectId);
        if (!cursor) fail("PROJECT_RISK_INVALID_CURSOR");
      }
      const rows = this.db
        .prepare(
          `SELECT id FROM cc_organization_project_risk_reviews
        WHERE project_id=? ${cursor ? "AND rowid<?" : ""}
        ORDER BY rowid DESC LIMIT ?`,
        )
        .all(value.projectId, ...(cursor ? [cursor.rowid] : []), limit + 1);
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
      this._authorize(
        result.review.projectId,
        actor,
        "risk.read",
        result.authority,
      );
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
    const value = options(input, ["reviewId", "taskId"], ["contentDigest"]);
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
    const value = options(input, ["reviewId", "projectId"], ["contentDigest"]);
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
      run.target.scope.kind !== "organization"
    )
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    const context = this._readReview(value.reviewId, actor);
    if (canonical(run.target.scope) !== canonical(context.authority.scope))
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
        `SELECT id,actor_did,target_id,idempotency_digest,invocation_digest,
        CASE WHEN length(CAST(run_json AS BLOB))<=65536 THEN run_json ELSE NULL END AS run_json,
        CASE WHEN length(CAST(evidence_json AS BLOB))<=65536 THEN evidence_json ELSE NULL END AS evidence_json
        FROM cc_business_action_runs WHERE id=?`,
      )
      .get(run.id);
    if (
      !row ||
      row.actor_did !== actor ||
      row.invocation_digest !== run.invocationDigest ||
      row.run_json !== JSON.stringify(run)
    )
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    this._lineageRun(
      {
        run_id: run.id,
        actor_did: actor,
        content_digest: value.contentDigest,
        invocation_digest: run.invocationDigest,
        receipt_actor: row.actor_did,
        receipt_target: row.target_id,
        receipt_idempotency: row.idempotency_digest,
        receipt_invocation: row.invocation_digest,
        run_json: row.run_json,
        evidence_json: row.evidence_json,
      },
      context,
    );
    const previous = this.db
      .prepare(
        "SELECT * FROM cc_organization_project_risk_action_links WHERE run_id=?",
      )
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
        `INSERT INTO cc_organization_project_risk_action_links
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

  _feedbackInput(input) {
    const value = options(
      input,
      ["reviewId", "taskId", "verdict", "reasonCodes"],
      ["comment", "expectedAuthority"],
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
          Buffer.byteLength(value.comment, "utf8") > 4096)) ||
      (value.expectedAuthority !== undefined &&
        (!value.expectedAuthority ||
          typeof value.expectedAuthority !== "object" ||
          Array.isArray(value.expectedAuthority)))
    )
      fail("PROJECT_RISK_INVALID_REQUEST");
    return value;
  }

  _prepareFeedback(value) {
    const actor = this._actor();
    const context = this._readReview(value.reviewId, actor);
    if (
      context.evaluation.status !== "evaluated" ||
      !context.sourceSnapshot.tasks.some((task) => task.id === value.taskId)
    )
      fail("PROJECT_RISK_ACTION_SOURCE_INVALID");
    const recordedReasons =
      context.evaluation.tasks.find((task) => task.taskRef.id === value.taskId)
        ?.reasonCodes ?? [];
    if (value.reasonCodes.some((code) => !recordedReasons.includes(code)))
      fail("PROJECT_RISK_INVALID_REQUEST");
    const authority = this._authorize(
      context.review.projectId,
      actor,
      "risk.feedback",
      value.expectedAuthority,
    );
    return immutable({
      review: context.review,
      evaluation: context.evaluation,
      contentDigest: digest(context),
      authority,
      actorDid: actor,
      taskId: value.taskId,
    });
  }

  prepareFeedback(input) {
    const value = this._feedbackInput(input);
    return this._transaction(() => this._prepareFeedback(value));
  }

  prepareFeedbackInTransaction(input) {
    if (!this.db.inTransaction) fail("PROJECT_RISK_TRANSACTION_REQUIRED");
    return this._prepareFeedback(this._feedbackInput(input));
  }

  recordFeedback(input) {
    const value = this._feedbackInput(input);
    return this._transaction(() => {
      const { actorDid: actor } = this._prepareFeedback(value);
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
          `INSERT INTO cc_organization_project_risk_feedback
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

  _lineageRun(row, context) {
    try {
      if (!row.run_json || !row.evidence_json) throw new Error();
      const {
        readOrganizationTaskActionRun,
      } = require("./organization-task-action-service");
      const { run, evidence } = readOrganizationTaskActionRun(this.db, {
        id: row.run_id,
        actor_did: row.receipt_actor,
        target_id: row.receipt_target,
        invocation_digest: row.receipt_invocation,
        idempotency_digest: row.receipt_idempotency,
        run_json: row.run_json,
        evidence_json: row.evidence_json,
      });
      const actor = row.actor_did;
      if (
        run.id !== row.run_id ||
        canonical(run.target.scope) !== canonical(context.authority.scope) ||
        run.target.scope.kind !== "organization" ||
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
      const organizationSource = evidence.find(
        (item) => item.kind === "organization-project-authority",
      );
      if (
        organizationSource?.projectId !== context.review.projectId ||
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
          created.scope?.kind !== "organization" ||
          canonical(created.scope) !== canonical(context.authority.scope)
        )
          throw new Error();
        const columns = this._taskColumns();
        this._checkHistoricalTasks(
          {
            project: context.sourceSnapshot.project,
            scope: context.authority.scope,
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
          .prepare(`SELECT rowid FROM ${table} WHERE ${key}=? AND review_id=?`)
          .get(cursor, value.reviewId);
        if (!row) fail("PROJECT_RISK_INVALID_CURSOR");
        return row.rowid;
      };
      const cursor = cursorFor(
        "cc_organization_project_risk_action_links",
        "run_id",
        value.beforeId,
      );
      const feedbackCursor = cursorFor(
        "cc_organization_project_risk_feedback",
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
          FROM cc_organization_project_risk_action_links l LEFT JOIN cc_business_action_runs r ON r.id=l.run_id
          WHERE l.review_id=? ${cursor !== undefined ? "AND l.rowid<?" : ""}
          ORDER BY l.rowid DESC LIMIT ?`,
          )
          .all(
            value.reviewId,
            ...(cursor !== undefined ? [cursor] : []),
            limit + 1,
          );
      } else if (
        this.db
          .prepare(
            "SELECT 1 FROM cc_organization_project_risk_action_links WHERE review_id=? LIMIT 1",
          )
          .get(value.reviewId)
      )
        fail("PROJECT_RISK_LINEAGE_CORRUPT");
      const rows = this.db
        .prepare(
          `SELECT id,actor_did,content_digest,
        CASE WHEN length(CAST(feedback_json AS BLOB))<=8192 THEN feedback_json ELSE NULL END AS feedback_json
        FROM cc_organization_project_risk_feedback WHERE review_id=?
        ${feedbackCursor !== undefined ? "AND rowid<?" : ""} ORDER BY rowid DESC LIMIT ?`,
        )
        .all(
          value.reviewId,
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
            item.actorDid !== row.actor_did ||
            !item.actorDid.startsWith("did:") ||
            item.reasonCodes.some(
              (code) =>
                !(
                  context.evaluation.tasks.find(
                    (task) => task.taskRef.id === item.taskId,
                  )?.reasonCodes ?? []
                ).includes(code),
            ) ||
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
          .map((row) => this._lineageRun(row, context)),
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

module.exports = {
  OrganizationProjectRiskReviewService,
  MAX_PROJECT_RISK_REVIEW_BYTES,
};
