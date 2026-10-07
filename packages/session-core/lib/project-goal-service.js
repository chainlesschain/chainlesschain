"use strict";

const { randomUUID } = require("node:crypto");
const {
  createBusinessObjectRef,
  digestBusinessObjectContent,
} = require("./business-object-contract.js");
const {
  goalError,
  validateGoalRecord,
  MAX_GOAL_RECORD_BYTES,
} = require("./goal-contract.js");
const { GoalRepository } = require("./goal-repository.js");
const MAX_RECORD_BYTES = MAX_GOAL_RECORD_BYTES;
const SOURCE_KIND = "desktop.project-goals";

function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    throw goalError("GOAL_INVALID_ID");
  return value;
}
function options(value, required, optional = []) {
  try {
    digestBusinessObjectContent(value);
  } catch {
    throw goalError("GOAL_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    throw goalError("GOAL_INVALID_REQUEST");
  return value;
}

/** Personal-project records live in the existing native database. The host
 * supplies identity; request fields are never used to resolve an actor. */
class SqliteProjectGoalAdapter {
  constructor({ db, getActor }) {
    if (
      !db ||
      typeof db.prepare !== "function" ||
      typeof db.exec !== "function" ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      throw goalError("GOAL_NATIVE_DATABASE_REQUIRED");
    if (typeof getActor !== "function")
      throw goalError("GOAL_AUTHORITY_REQUIRED");
    this.db = db;
    this.getActor = getActor;
    this._transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS cc_project_goal_store_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),store_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS cc_project_goals (
        id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,project_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision>=1),goal_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_cc_project_goals_actor_project
        ON cc_project_goals(actor_did,project_id,id);`);
      db.prepare(
        "INSERT OR IGNORE INTO cc_project_goal_store_meta VALUES (1,?)",
      ).run(`project-goals-${randomUUID()}`);
      this.storeId = identifier(
        db
          .prepare(
            "SELECT store_id FROM cc_project_goal_store_meta WHERE singleton=1",
          )
          .get().store_id,
      );
    });
  }
  _transaction(operation) {
    if (this.db.inTransaction) throw goalError("GOAL_TRANSACTION_BUSY");
    try {
      return this.db.transaction(operation).immediate();
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("GOAL_"))
        throw error;
      throw goalError("GOAL_STORAGE_FAILED");
    }
  }
  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      throw goalError("GOAL_AUTHORITY_UNAVAILABLE");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      throw goalError("GOAL_IDENTITY_REQUIRED");
    return identifier(actor);
  }
  _hasTable(name) {
    return !!this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
  }
  _project(projectId, actor) {
    const columns = new Set(
      this.db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .map((row) => row.name),
    );
    const required = ["id", "user_id", "status", "updated_at"];
    if (required.some((column) => !columns.has(column)))
      throw goalError("GOAL_PROJECT_SOURCE_INCOMPLETE");
    const selected = [
      ...required,
      ...["deleted", "org_id", "workspace_id"].filter((name) =>
        columns.has(name),
      ),
    ];
    const project = this.db
      .prepare(`SELECT ${selected.join(",")} FROM projects WHERE id=?`)
      .get(identifier(projectId));
    if (
      !project ||
      project.user_id !== actor ||
      (project.deleted != null && project.deleted !== 0)
    )
      throw goalError("GOAL_NOT_FOUND_OR_DENIED");
    if (
      project.org_id != null ||
      project.workspace_id != null ||
      (this._hasTable("organization_projects") &&
        this.db
          .prepare("SELECT 1 FROM organization_projects WHERE id=?")
          .get(project.id)) ||
      (this._hasTable("workspace_resources") &&
        this.db
          .prepare(
            "SELECT 1 FROM workspace_resources WHERE resource_type='project' AND resource_id=? LIMIT 1",
          )
          .get(project.id))
    )
      throw goalError("GOAL_ORGANIZATION_UNSUPPORTED");
    if (
      !Number.isSafeInteger(project.updated_at) ||
      typeof project.status !== "string"
    )
      throw goalError("GOAL_PROJECT_SOURCE_INVALID");
    return project;
  }
  _projectRef(project, actor) {
    return createBusinessObjectRef({
      type: "Project",
      id: project.id,
      sourceKind: SOURCE_KIND,
      scope: { kind: "personal", id: actor },
      version: digestBusinessObjectContent({
        id: project.id,
        owner: actor,
        status: project.status,
        updatedAt: project.updated_at,
        deleted: project.deleted ?? 0,
      }),
    });
  }
  describeProject(projectId) {
    return this._transaction(() => {
      const actor = this._actor();
      const project = this._project(projectId, actor);
      if (!["draft", "active"].includes(project.status))
        throw goalError("GOAL_PROJECT_NOT_ACTIVE");
      return { ownerRef: actor, projectRef: this._projectRef(project, actor) };
    });
  }
  _validate(record) {
    const goal = validateGoalRecord(record);
    if (goal.storeId !== this.storeId) throw goalError("GOAL_STORE_MISMATCH");
    if (
      goal.projectRef === null ||
      goal.ownerRef === null ||
      goal.projectRef.sourceKind !== SOURCE_KIND
    )
      throw goalError("GOAL_PROJECT_REQUIRED");
    return goal;
  }
  create(record) {
    const goal = this._validate(record);
    return this._transaction(() => {
      const actor = this._actor();
      const project = this._project(goal.projectRef.id, actor);
      if (
        goal.ownerRef !== actor ||
        !["draft", "active"].includes(project.status)
      )
        throw goalError("GOAL_NOT_FOUND_OR_DENIED");
      if (goal.projectRef.version !== this._projectRef(project, actor).version)
        throw goalError("GOAL_PROJECT_VERSION_CONFLICT");
      if (
        goal.revision !== 1 ||
        goal.controlGeneration !== 0 ||
        goal.status !== "active" ||
        goal.completion !== null ||
        goal.executionState !== "idle"
      )
        throw goalError("GOAL_INVALID_INITIAL_STATE");
      if (
        this.db
          .prepare("SELECT 1 FROM cc_project_goals WHERE id=?")
          .get(goal.id)
      )
        throw goalError("GOAL_ALREADY_EXISTS");
      this.db
        .prepare("INSERT INTO cc_project_goals VALUES (?,?,?,?,?)")
        .run(goal.id, actor, project.id, goal.revision, JSON.stringify(goal));
      return goal;
    });
  }
  _read(id, actor) {
    const row = this.db
      .prepare(
        `SELECT id,actor_did,project_id,revision,
      CASE WHEN length(CAST(goal_json AS BLOB))<=${MAX_RECORD_BYTES} THEN goal_json ELSE NULL END AS goal_json
      FROM cc_project_goals WHERE id=? AND actor_did=?`,
      )
      .get(identifier(id), actor);
    if (!row) return null;
    this._project(row.project_id, actor);
    let goal;
    try {
      goal = this._validate(JSON.parse(row.goal_json));
    } catch {
      throw goalError("GOAL_RECORD_CORRUPT");
    }
    if (
      goal.id !== row.id ||
      goal.ownerRef !== actor ||
      goal.projectRef.id !== row.project_id ||
      goal.revision !== row.revision
    )
      throw goalError("GOAL_RECORD_CORRUPT");
    return goal;
  }
  get(id) {
    return this._transaction(() => this._read(id, this._actor()));
  }
  compareAndSwap(id, expectedRevision, transform) {
    return this._transaction(() =>
      this.compareAndSwapInTransaction(id, expectedRevision, transform),
    );
  }
  /** Trusted domain hosts can join goal CAS to evidence in the same native tx.
   * Identity, personal ownership and replacement invariants are still checked. */
  compareAndSwapInTransaction(id, expectedRevision, transform) {
    if (!this.db.inTransaction) throw goalError("GOAL_TRANSACTION_REQUIRED");
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      typeof transform !== "function"
    )
      throw goalError("GOAL_INVALID_REVISION");
    const apply = () => {
      const actor = this._actor();
      const current = this._read(id, actor);
      if (current === null) throw goalError("GOAL_NOT_FOUND_OR_DENIED");
      if (current.revision !== expectedRevision)
        throw goalError("GOAL_REVISION_CONFLICT");
      const next = this._validate(transform(current));
      if (this._actor() !== actor) throw goalError("GOAL_IDENTITY_CHANGED");
      this._project(current.projectRef.id, actor);
      if (
        next.id !== current.id ||
        next.ownerRef !== current.ownerRef ||
        digestBusinessObjectContent(next.projectRef) !==
          digestBusinessObjectContent(current.projectRef) ||
        next.revision !== current.revision + 1 ||
        next.controlGeneration < current.controlGeneration
      )
        throw goalError("GOAL_INVALID_REPLACEMENT");
      const result = this.db
        .prepare(
          "UPDATE cc_project_goals SET revision=?,goal_json=? WHERE id=? AND actor_did=? AND revision=?",
        )
        .run(next.revision, JSON.stringify(next), id, actor, expectedRevision);
      if (result.changes !== 1) throw goalError("GOAL_REVISION_CONFLICT");
      return next;
    };
    return apply();
  }
  list(input) {
    options(input, ["projectId"], ["afterId", "limit"]);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw goalError("GOAL_INVALID_LIMIT");
    if (input.afterId !== undefined) identifier(input.afterId);
    return this._transaction(() => {
      const actor = this._actor();
      this._project(input.projectId, actor);
      return this.db
        .prepare(
          "SELECT id FROM cc_project_goals WHERE actor_did=? AND project_id=? AND id>? ORDER BY id LIMIT ?",
        )
        .all(actor, input.projectId, input.afterId ?? "", limit)
        .map((row) => this._read(row.id, actor));
    });
  }
}

class PersonalProjectGoalService {
  constructor({ db, getActor, now, verifyCompletion = null }) {
    this.adapter = new SqliteProjectGoalAdapter({ db, getActor });
    this.repository = new GoalRepository({
      adapter: this.adapter,
      now,
      verifyCompletion,
    });
  }
  create(input) {
    options(
      input,
      ["projectId", "objective"],
      [
        "title",
        "acceptanceCriteria",
        "budgetPolicy",
        "expiresAt",
        "notificationPolicy",
      ],
    );
    const { projectId, ...definition } = input;
    // Rechecked against the authoritative project version in the insert tx.
    return this.repository.create({
      ...definition,
      ...this.adapter.describeProject(projectId),
    });
  }
  get(input) {
    options(input, ["id"]);
    return this.repository.get(identifier(input.id));
  }
  list(input) {
    return this.repository.list(input);
  }
  revise(input) {
    options(input, ["id", "expectedRevision", "patch"]);
    return this.repository.revise(input);
  }
  complete(input) {
    options(input, ["id", "expectedRevision"]);
    return this.repository.complete(input);
  }
}

module.exports = { SqliteProjectGoalAdapter, PersonalProjectGoalService };
