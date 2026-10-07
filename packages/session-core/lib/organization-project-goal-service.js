"use strict";

const { randomUUID } = require("node:crypto");
const {
  createBusinessObjectRef,
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");
const {
  goalError,
  validateGoalRecord,
  reviseGoalRecord,
  createGoalRecord,
  MAX_GOAL_RECORD_BYTES,
} = require("./goal-contract");
const { GoalRepository } = require("./goal-repository");
const { GoalUsageLedger } = require("./goal-usage-ledger");
const {
  OrganizationProjectRiskReviewService,
} = require("./organization-project-risk-review-service");

const SOURCE_KIND = "desktop.organization-project-goals";
const PREFIX = "cc_organization_project_goal";
const MAX_RECORDS = 1000;
function fail(code) {
  throw goalError(code);
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("GOAL_INVALID_ID");
  return value;
}
function fields(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("GOAL_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("GOAL_INVALID_REQUEST");
  return JSON.parse(JSON.stringify(value));
}
function decode(text, max = MAX_GOAL_RECORD_BYTES) {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > max)
      throw new Error();
    const value = JSON.parse(text);
    digest(value);
    return value;
  } catch {
    fail("GOAL_RECORD_CORRUPT");
  }
}
function time(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    fail("GOAL_INVALID_TIME");
  return value;
}

/** Separate storage and current organization permission checks. The creator DID
 * is permanent attribution, never the reader/update ACL or execution principal. */
class SqliteOrganizationProjectGoalAdapter {
  constructor({ db, getActor, authority }) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("GOAL_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof authority?.assertAuthorizedInTransaction !== "function"
    )
      fail("GOAL_AUTHORITY_REQUIRED");
    if (db.inTransaction) fail("GOAL_TRANSACTION_BUSY");
    Object.assign(this, { db, getActor, authority });
    this._transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS ${PREFIX}_store_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),store_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ${PREFIX}s(id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,project_id TEXT NOT NULL,org_id TEXT NOT NULL,mapping_revision INTEGER NOT NULL,revision INTEGER NOT NULL,authority_json TEXT NOT NULL,goal_json TEXT NOT NULL,content_digest TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_org_goals_project ON ${PREFIX}s(project_id,id);
        CREATE TABLE IF NOT EXISTS ${PREFIX}_mutations(id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,goal_id TEXT NOT NULL,input_digest TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,UNIQUE(actor_did,kind,request_id));
        CREATE TABLE IF NOT EXISTS ${PREFIX}_manual_requests(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,request_id TEXT NOT NULL,request_digest TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,UNIQUE(goal_id,actor_did,request_id));
        CREATE TABLE IF NOT EXISTS ${PREFIX}_checks(occurrence_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,request_id TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms>=0),UNIQUE(goal_id,actor_did,request_id));
        CREATE TABLE IF NOT EXISTS ${PREFIX}_monitor_consents(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,request_id TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,UNIQUE(actor_did,request_id));
        CREATE TABLE IF NOT EXISTS ${PREFIX}_monitor_states(goal_id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ${PREFIX}_monitor_stops(id TEXT PRIMARY KEY,actor_did TEXT NOT NULL,request_id TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,UNIQUE(actor_did,request_id));
        CREATE TABLE IF NOT EXISTS ${PREFIX}_workflow(id TEXT PRIMARY KEY,kind TEXT NOT NULL,goal_id TEXT NOT NULL,actor_did TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_org_goal_workflow ON ${PREFIX}_workflow(goal_id,kind,id);
        CREATE TABLE IF NOT EXISTS ${PREFIX}_observations(review_id TEXT NOT NULL,goal_id TEXT NOT NULL,record_json TEXT NOT NULL,content_digest TEXT NOT NULL,PRIMARY KEY(review_id,goal_id));
        CREATE INDEX IF NOT EXISTS idx_org_goal_checks_goal ON ${PREFIX}_checks(goal_id,occurrence_id);`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS cc_org_goal_scope_immutable BEFORE UPDATE ON ${PREFIX}s
        WHEN OLD.id IS NOT NEW.id OR OLD.actor_did IS NOT NEW.actor_did OR OLD.project_id IS NOT NEW.project_id
          OR OLD.org_id IS NOT NEW.org_id OR OLD.mapping_revision IS NOT NEW.mapping_revision OR OLD.authority_json IS NOT NEW.authority_json
        BEGIN SELECT RAISE(ABORT,'GOAL_RECORD_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS cc_org_goal_retained BEFORE DELETE ON ${PREFIX}s
        BEGIN SELECT RAISE(ABORT,'GOAL_RECORD_IMMUTABLE'); END;`);
      for (const table of [
        `${PREFIX}_mutations`,
        `${PREFIX}_manual_requests`,
        `${PREFIX}_checks`,
        `${PREFIX}_monitor_consents`,
        `${PREFIX}_monitor_stops`,
      ])
        for (const operation of ["UPDATE", "DELETE"])
          db.exec(
            `CREATE TRIGGER IF NOT EXISTS ${table}_${operation.toLowerCase()}_immutable BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'GOAL_RECORD_IMMUTABLE'); END;`,
          );
      db.prepare(`INSERT OR IGNORE INTO ${PREFIX}_store_meta VALUES(1,?)`).run(
        `organization-goals-${randomUUID()}`,
      );
      this.storeId = id(
        db
          .prepare(
            `SELECT store_id FROM ${PREFIX}_store_meta WHERE singleton=1`,
          )
          .get().store_id,
      );
    });
  }
  _transaction(operation) {
    // Trusted composition joins a synchronous native transaction; every adapter
    // operation still checks the actual host actor and current project grant.
    try {
      return this.db.inTransaction
        ? operation()
        : this.db.transaction(operation).immediate();
    } catch (error) {
      if (
        /^(GOAL_|ORG_AUTH_|PROJECT_RISK_|ACTION_GOAL_)/u.test(error?.code || "")
      )
        throw error;
      fail("GOAL_STORAGE_FAILED");
    }
  }
  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch (error) {
      if (/^ORG_AUTH_/u.test(error?.code || "")) throw error;
      fail("GOAL_AUTHORITY_UNAVAILABLE");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("GOAL_IDENTITY_REQUIRED");
    return id(actor);
  }
  _authorize(projectId, actor, permission = "goal.read", expectedAuthority) {
    const current = this.authority.assertAuthorizedInTransaction({
      projectId: id(projectId),
      actorDid: actor,
      permission,
      ...(expectedAuthority ? { expectedAuthority } : {}),
    });
    if (
      current.scope?.kind !== "organization" ||
      (expectedAuthority && digest(current) !== digest(expectedAuthority))
    )
      fail("GOAL_AUTHORITY_CHANGED");
    return current;
  }
  _project(projectId, actor) {
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
      fail("GOAL_PROJECT_SOURCE_INCOMPLETE");
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
      !Number.isSafeInteger(project.updated_at) ||
      (project.deleted != null && project.deleted !== 0) ||
      project.workspace_id != null ||
      (project.org_id != null && project.org_id !== authority.scope.id)
    )
      fail("GOAL_NOT_FOUND_OR_DENIED");
    return project;
  }
  _validate(record) {
    const goal = validateGoalRecord(record);
    if (goal.storeId !== this.storeId) fail("GOAL_STORE_MISMATCH");
    if (
      goal.projectRef?.sourceKind !== SOURCE_KIND ||
      goal.projectRef.scope.kind !== "organization" ||
      !goal.ownerRef?.startsWith("did:")
    )
      fail("GOAL_PROJECT_REQUIRED");
    return goal;
  }
  describeProject(projectId) {
    return this._transaction(() => {
      const actor = this._actor(),
        project = this._project(projectId, actor);
      const authority = this._authorize(projectId, actor, "goal.create");
      if (!["draft", "active"].includes(project.status))
        fail("GOAL_PROJECT_NOT_ACTIVE");
      return {
        ownerRef: actor,
        projectRef: createBusinessObjectRef({
          type: "Project",
          id: projectId,
          sourceKind: SOURCE_KIND,
          scope: authority.scope,
          version: digest({ project, authority }),
        }),
        authority,
      };
    });
  }
  create(record) {
    return this._transaction(() => {
      const actor = this._actor(),
        goal = this._validate(record),
        description = this.describeProject(goal.projectRef.id);
      if (
        goal.ownerRef !== actor ||
        digest(description.projectRef) !== digest(goal.projectRef)
      )
        fail("GOAL_PROJECT_VERSION_CONFLICT");
      if (
        goal.revision !== 1 ||
        goal.controlGeneration !== 0 ||
        goal.status !== "active" ||
        goal.completion !== null ||
        goal.executionState !== "idle"
      )
        fail("GOAL_INVALID_INITIAL_STATE");
      if (this.db.prepare(`SELECT 1 FROM ${PREFIX}s WHERE id=?`).get(goal.id))
        fail("GOAL_ALREADY_EXISTS");
      if (
        this.db
          .prepare(`SELECT count(*) AS n FROM ${PREFIX}s WHERE project_id=?`)
          .get(goal.projectRef.id).n >= MAX_RECORDS
      )
        fail("GOAL_RECORD_LIMIT");
      this.db
        .prepare(`INSERT INTO ${PREFIX}s VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(
          goal.id,
          actor,
          goal.projectRef.id,
          description.authority.scope.id,
          description.authority.mappingRevision,
          goal.revision,
          JSON.stringify(description.authority),
          JSON.stringify(goal),
          digest(goal),
        );
      return goal;
    });
  }
  _read(goalId, actor) {
    const row = this.db
      .prepare(
        `SELECT id,actor_did,project_id,org_id,mapping_revision,revision,content_digest,
      CASE WHEN length(CAST(authority_json AS BLOB))<=8192 THEN authority_json ELSE NULL END AS authority_json,
      CASE WHEN length(CAST(goal_json AS BLOB))<=${MAX_GOAL_RECORD_BYTES} THEN goal_json ELSE NULL END AS goal_json FROM ${PREFIX}s WHERE id=?`,
      )
      .get(id(goalId));
    if (!row) return null;
    const current = this._authorize(row.project_id, actor);
    this._project(row.project_id, actor);
    const stored = decode(row.authority_json, 8192),
      goal = this._validate(decode(row.goal_json));
    try {
      fields(stored, [
        "scope",
        "mappingRevision",
        "authorityEpoch",
        "sourceRevision",
        "policyDigest",
        "projectSourceRevision",
        "databaseSchemaRevision",
      ]);
      fields(stored.scope, ["kind", "id"]);
      if (
        !/^sha256:[a-f0-9]{64}$/u.test(stored.policyDigest) ||
        [
          "mappingRevision",
          "authorityEpoch",
          "sourceRevision",
          "projectSourceRevision",
          "databaseSchemaRevision",
        ].some((key) => !Number.isSafeInteger(stored[key]) || stored[key] < 1)
      )
        throw new Error();
    } catch {
      fail("GOAL_RECORD_CORRUPT");
    }
    if (
      digest(goal) !== row.content_digest ||
      goal.id !== row.id ||
      goal.ownerRef !== row.actor_did ||
      goal.projectRef.id !== row.project_id ||
      goal.projectRef.scope.id !== row.org_id ||
      stored.scope?.id !== row.org_id ||
      stored.scope.kind !== "organization" ||
      stored.mappingRevision !== row.mapping_revision ||
      goal.revision !== row.revision
    )
      fail("GOAL_RECORD_CORRUPT");
    if (
      current.scope.id !== row.org_id ||
      current.mappingRevision !== row.mapping_revision
    )
      fail("GOAL_NOT_FOUND_OR_DENIED");
    return goal;
  }
  get(goalId) {
    return this._transaction(() => this._read(goalId, this._actor()));
  }
  compareAndSwap(goalId, expectedRevision, transform) {
    return this._transaction(() =>
      this.compareAndSwapInTransaction(goalId, expectedRevision, transform),
    );
  }
  compareAndSwapInTransaction(goalId, expectedRevision, transform) {
    if (!this.db.inTransaction) fail("GOAL_TRANSACTION_REQUIRED");
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      typeof transform !== "function"
    )
      fail("GOAL_INVALID_REVISION");
    const actor = this._actor(),
      current = this._read(goalId, actor);
    if (!current) fail("GOAL_NOT_FOUND_OR_DENIED");
    const authority = this._authorize(
      current.projectRef.id,
      actor,
      "goal.update",
    );
    if (current.revision !== expectedRevision) fail("GOAL_REVISION_CONFLICT");
    const next = this._validate(transform(current));
    if (this._actor() !== actor) fail("GOAL_IDENTITY_CHANGED");
    this._authorize(current.projectRef.id, actor, "goal.update", authority);
    if (
      next.id !== current.id ||
      next.ownerRef !== current.ownerRef ||
      digest(next.projectRef) !== digest(current.projectRef) ||
      next.revision !== current.revision + 1 ||
      next.controlGeneration !== current.controlGeneration + 1
    )
      fail("GOAL_INVALID_REPLACEMENT");
    const result = this.db
      .prepare(
        `UPDATE ${PREFIX}s SET revision=?,goal_json=?,content_digest=? WHERE id=? AND revision=?`,
      )
      .run(
        next.revision,
        JSON.stringify(next),
        digest(next),
        current.id,
        expectedRevision,
      );
    if (result.changes !== 1) fail("GOAL_REVISION_CONFLICT");
    return next;
  }
  list(input) {
    const value = fields(input, ["projectId"], ["afterId", "limit"]),
      limit = value.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51)
      fail("GOAL_INVALID_LIMIT");
    return this._transaction(() => {
      const actor = this._actor();
      this._project(id(value.projectId), actor);
      if (
        value.afterId !== undefined &&
        !this.db
          .prepare(`SELECT 1 FROM ${PREFIX}s WHERE id=? AND project_id=?`)
          .get(id(value.afterId), value.projectId)
      )
        fail("GOAL_INVALID_CURSOR");
      return this.db
        .prepare(
          `SELECT id FROM ${PREFIX}s WHERE project_id=? AND id>? ORDER BY id LIMIT ?`,
        )
        .all(value.projectId, value.afterId ?? "", limit)
        .map((row) => this._read(row.id, actor));
    });
  }
}

class OrganizationProjectGoalService {
  constructor({ db, getActor, authority, clock = Date.now }) {
    if (typeof clock !== "function") fail("GOAL_INVALID_TIME");
    Object.assign(this, { db, clock });
    this.adapter = new SqliteOrganizationProjectGoalAdapter({
      db,
      getActor,
      authority,
    });
    this.repository = new GoalRepository({
      adapter: this.adapter,
      now: () => this._stamp(),
    });
    this.risk = new OrganizationProjectRiskReviewService({
      db,
      getActor,
      authority,
      now: clock,
    });
    // Initialize both domain ledgers before the host captures schema fences.
    this.usage = new GoalUsageLedger({
      db,
      namespace: "organization",
      sharedBudget: true,
      scopeAuthorizer: (goal, actor) => {
        const actual = this.adapter._read(goal.id, actor);
        if (
          !actual ||
          actual.storeId !== goal.storeId ||
          digest(actual.projectRef) !== digest(goal.projectRef)
        )
          fail("GOAL_NOT_FOUND_OR_DENIED");
        return true;
      },
    });
  }
  _stamp() {
    return new Date(time(this.clock())).toISOString();
  }
  _input(input, kind) {
    const value =
      kind === "create"
        ? fields(
            input,
            ["projectId", "requestId", "objective"],
            ["title", "budgetPolicy", "expiresAt"],
          )
        : fields(input, ["id", "expectedRevision", "requestId", "patch"]);
    id(value.requestId);
    id(kind === "create" ? value.projectId : value.id);
    if (kind === "revise") {
      if (
        !Number.isSafeInteger(value.expectedRevision) ||
        value.expectedRevision < 1
      )
        fail("GOAL_INVALID_REVISION");
      value.patch = fields(
        value.patch,
        [],
        [
          "title",
          "objective",
          "budgetPolicy",
          "expiresAt",
          "status",
          "allowedActionTypes",
        ],
      );
      if (
        !Object.keys(value.patch).length ||
        (value.patch.status !== undefined &&
          !["active", "paused", "abandoned"].includes(value.patch.status))
      )
        fail("GOAL_INVALID_REQUEST");
      if (
        value.patch.allowedActionTypes !== undefined &&
        (!Array.isArray(value.patch.allowedActionTypes) ||
          value.patch.allowedActionTypes.length > 3 ||
          new Set(value.patch.allowedActionTypes).size !==
            value.patch.allowedActionTypes.length ||
          value.patch.allowedActionTypes.some(
            (type) =>
              ![
                "project.risk.review",
                "task.update-description",
                "task.create",
              ].includes(type),
          ))
      )
        fail("GOAL_INVALID_ACTION_TYPE");
    }
    return value;
  }
  _prior(kind, value, actor) {
    const row = this.db
      .prepare(
        `SELECT id,goal_id,input_digest,content_digest,CASE WHEN length(CAST(record_json AS BLOB))<=${MAX_GOAL_RECORD_BYTES + 16384} THEN record_json ELSE NULL END AS record_json FROM ${PREFIX}_mutations WHERE actor_did=? AND kind=? AND request_id=?`,
      )
      .get(actor, kind, value.requestId);
    if (!row) return null;
    const record = decode(row.record_json, MAX_GOAL_RECORD_BYTES + 16384);
    try {
      fields(record, [
        "schema",
        "id",
        "kind",
        "actorDid",
        "requestId",
        "inputDigest",
        "authority",
        "goal",
      ]);
    } catch {
      fail("GOAL_RECORD_CORRUPT");
    }
    if (
      record.schema !== "chainlesschain.organization-goal-mutation/v1" ||
      record.id !== row.id ||
      record.kind !== kind ||
      record.actorDid !== actor ||
      record.requestId !== value.requestId ||
      record.inputDigest !== row.input_digest ||
      digest(record) !== row.content_digest ||
      record.goal?.id !== row.goal_id
    )
      fail("GOAL_RECORD_CORRUPT");
    if (row.input_digest !== digest(value)) fail("GOAL_REQUEST_CONFLICT");
    const goal = this.adapter._validate(record.goal),
      current = this.adapter._read(goal.id, actor);
    if (!current || digest(current.projectRef) !== digest(goal.projectRef))
      fail("GOAL_NOT_FOUND_OR_DENIED");
    if (
      goal.revision > current.revision ||
      goal.controlGeneration > current.controlGeneration
    )
      fail("GOAL_RECORD_CORRUPT");
    return {
      goal,
      actorDid: actor,
      authority: this.adapter._authorize(goal.projectRef.id, actor),
      requestDigest: row.input_digest,
      replayed: true,
    };
  }
  _prepare(kind, value) {
    const actor = this.adapter._actor(),
      prior = this._prior(kind, value, actor);
    if (prior) return prior;
    let goal,
      previous = null,
      authority;
    if (kind === "create") {
      const description = this.adapter.describeProject(value.projectId);
      authority = description.authority;
      const { projectId, requestId, ...definition } = value;
      goal = createGoalRecord({
        ...definition,
        id: `org-goal-${digest([this.adapter.storeId, actor, requestId]).slice(7)}`,
        storeId: this.adapter.storeId,
        ownerRef: actor,
        projectRef: description.projectRef,
        createdAt: this._stamp(),
      });
    } else {
      previous = this.adapter._read(value.id, actor);
      if (!previous) fail("GOAL_NOT_FOUND_OR_DENIED");
      authority = this.adapter._authorize(
        previous.projectRef.id,
        actor,
        "goal.update",
      );
      if (previous.revision !== value.expectedRevision)
        fail("GOAL_REVISION_CONFLICT");
      goal = reviseGoalRecord(previous, value.patch, this._stamp());
    }
    return {
      goal,
      ...(previous ? { previous } : {}),
      actorDid: actor,
      authority,
      requestDigest: digest(value),
      replayed: false,
    };
  }
  prepareCreate(input) {
    const value = this._input(input, "create");
    return this.adapter._transaction(() => this._prepare("create", value));
  }
  prepareRevise(input) {
    const value = this._input(input, "revise");
    return this.adapter._transaction(() => this._prepare("revise", value));
  }
  _write(kind, input, options) {
    const value = this._input(input, kind);
    const opts = fields(options ?? {}, [], ["expectedAuthority"]);
    return this.adapter._transaction(() => {
      const prepared = this._prepare(kind, value);
      if (prepared.replayed) return { goal: prepared.goal, replayed: true };
      if (!opts.expectedAuthority) fail("GOAL_AUTHORITY_REQUIRED");
      this.adapter._authorize(
        prepared.goal.projectRef.id,
        prepared.actorDid,
        `goal.${kind === "create" ? "create" : "update"}`,
        opts.expectedAuthority,
      );
      const goal =
        kind === "create"
          ? this.repository.create({
              id: prepared.goal.id,
              ownerRef: prepared.goal.ownerRef,
              projectRef: prepared.goal.projectRef,
              title: prepared.goal.title,
              objective: prepared.goal.objective,
              budgetPolicy: prepared.goal.budgetPolicy,
              expiresAt: prepared.goal.expiresAt,
            })
          : this.repository.revise({
              id: value.id,
              expectedRevision: value.expectedRevision,
              patch: value.patch,
            });
      const record = {
        schema: "chainlesschain.organization-goal-mutation/v1",
        id: randomUUID(),
        kind,
        actorDid: prepared.actorDid,
        requestId: value.requestId,
        inputDigest: prepared.requestDigest,
        authority: prepared.authority,
        goal,
      };
      if (
        Buffer.byteLength(JSON.stringify(record)) >
        MAX_GOAL_RECORD_BYTES + 16384
      )
        fail("GOAL_RECORD_LIMIT");
      this.db
        .prepare(`INSERT INTO ${PREFIX}_mutations VALUES(?,?,?,?,?,?,?,?)`)
        .run(
          record.id,
          record.actorDid,
          kind,
          record.requestId,
          goal.id,
          record.inputDigest,
          JSON.stringify(record),
          digest(record),
        );
      this.adapter._authorize(
        goal.projectRef.id,
        record.actorDid,
        "goal.read",
        opts.expectedAuthority,
      );
      return { goal, replayed: false };
    });
  }
  create(input, options) {
    return this._write("create", input, options);
  }
  revise(input, options) {
    return this._write("revise", input, options);
  }
  get(input) {
    const value = fields(input, ["id"]);
    return this.repository.get(id(value.id));
  }
  list(input) {
    const value = fields(input, ["projectId"], ["afterId", "limit"]),
      limit = value.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("GOAL_INVALID_LIMIT");
    const rows = this.repository.list({ ...value, limit: limit + 1 });
    return {
      goals: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
}

module.exports = {
  OrganizationProjectGoalService,
  SqliteOrganizationProjectGoalAdapter,
  ORGANIZATION_PROJECT_GOAL_SOURCE_KIND: SOURCE_KIND,
};
