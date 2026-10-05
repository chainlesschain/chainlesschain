"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { digestBusinessObjectContent } = require("./business-object-contract");
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
 * This service neither authorizes nor links business actions. Risk references
 * remain selected-field versions; they are never full-row action revisions.
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
    )`),
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
    return this._transaction(() => {
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
    });
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
    return this._transaction(() => {
      const actor = this._actor();
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
        meta.source_bytes + meta.evaluation_bytes >
          MAX_PROJECT_RISK_REVIEW_BYTES
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
    });
  }
}

module.exports = { ProjectRiskReviewService, MAX_PROJECT_RISK_REVIEW_BYTES };
