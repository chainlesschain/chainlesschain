"use strict";

const { randomUUID } = require("node:crypto");
const { digestBusinessObjectContent } = require("./business-object-contract");

const POLICY_SCHEMA = "chainlesschain.organization-project-policy/v1";
const MAX_POLICY_BYTES = 65536;
const PERMISSIONS = Object.freeze([
  "task.read",
  "task.create",
  "task.update-description",
  "task.approve",
]);
const BINDINGS_TABLE = "cc_organization_project_bindings";

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
    fail("ORG_AUTH_INVALID_REQUEST");
  return value;
}

function fields(value, required, optional = []) {
  try {
    digestBusinessObjectContent(value);
  } catch {
    fail("ORG_AUTH_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => ![...required, ...optional].includes(key),
    ) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    fail("ORG_AUTH_INVALID_REQUEST");
  return value;
}

function hasOrganizationProjectBinding(db, projectId) {
  // Revocation retains the scope tombstone. It must never restore personal
  // access implicitly; an ownership migration needs its own governed action.
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(BINDINGS_TABLE) &&
    db
      .prepare(`SELECT 1 FROM ${BINDINGS_TABLE} WHERE project_id=?`)
      .get(projectId),
  );
}

/**
 * Synchronous, owner-attested authority for canonical organization projects.
 * Old roles/grants and report/off RBAC results are never execution authority.
 * Policies name exact actors, projects, permissions and expiration times.
 * Membership/root triggers detect revocation followed by restoration (ABA).
 * A mapping is explicit, permanent in scope, and never inferred from equal IDs.
 *
 * This foundation does not execute organization tasks or consume approvals.
 * The caller supplies trusted identity and native confirmation, and must use
 * assertAuthorizedInTransaction inside the final action/receipt transaction.
 */
class OrganizationProjectAuthority {
  constructor({ db, getActor, confirm, now = () => Date.now() } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("ORG_AUTH_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof confirm !== "function" ||
      typeof now !== "function"
    )
      fail("ORG_AUTH_AUTHORITY_REQUIRED");
    this.db = db;
    this.getActor = getActor;
    this.confirm = confirm;
    this.now = now;
    this._transaction(() => this._initialize());
  }

  _transaction(operation) {
    if (this.db.inTransaction) fail("ORG_AUTH_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }

  _time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0)
      fail("ORG_AUTH_CLOCK_INVALID");
    return value;
  }

  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      fail("ORG_AUTH_IDENTITY_REQUIRED");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("ORG_AUTH_IDENTITY_REQUIRED");
    return identifier(actor);
  }

  _initialize() {
    for (const [table, columns] of [
      ["organization_info", ["org_id", "org_did", "owner_did"]],
      [
        "organization_members",
        ["id", "org_id", "member_did", "role", "status"],
      ],
      ["organization_projects", ["id", "org_id", "owner_did"]],
      ["projects", ["id", "user_id", "status", "updated_at"]],
      ["project_tasks", ["id", "project_id"]],
    ]) {
      const available = new Set(
        this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name),
      );
      if (columns.some((column) => !available.has(column)))
        fail("ORG_AUTH_SOURCE_INCOMPLETE");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cc_organization_authority_revisions (
        org_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=1)
      );
      INSERT OR IGNORE INTO cc_organization_authority_revisions(org_id,revision)
        SELECT org_id,1 FROM organization_info;
      CREATE TABLE IF NOT EXISTS cc_organization_project_policies (
        org_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL CHECK(epoch>=1),
        policy_json TEXT NOT NULL, policy_digest TEXT NOT NULL,
        attested_by_did TEXT NOT NULL, attested_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cc_project_scope_revisions (
        project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=1)
      );
      INSERT OR IGNORE INTO cc_project_scope_revisions(project_id,revision)
        SELECT id,1 FROM projects;
      CREATE TABLE IF NOT EXISTS ${BINDINGS_TABLE} (
        project_id TEXT PRIMARY KEY REFERENCES projects(id),
        organization_project_id TEXT NOT NULL UNIQUE REFERENCES organization_projects(id),
        org_id TEXT NOT NULL REFERENCES organization_info(org_id),
        revision INTEGER NOT NULL CHECK(revision>=1),
        status TEXT NOT NULL CHECK(status IN ('active','revoked')),
        original_owner_did TEXT NOT NULL, bound_by_did TEXT NOT NULL,
        created_at INTEGER NOT NULL, revoked_at INTEGER,
        CHECK((status='active' AND revoked_at IS NULL) OR
          (status='revoked' AND revoked_at IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS cc_organization_authority_events (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_did TEXT NOT NULL,
        kind TEXT NOT NULL, evidence_json TEXT NOT NULL, evidence_digest TEXT NOT NULL
      );
    `);
    // These are database changes, not cache invalidations. All writers, including
    // old report-mode membership handlers, advance the same persistent fence.
    const organizationSources = ["organization_info", "organization_members"];
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='approval_workflows'",
        )
        .get()
    )
      organizationSources.push("approval_workflows");
    for (const table of organizationSources) {
      this._installOrganizationFences(table);
    }
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const references =
        operation === "UPDATE"
          ? ["OLD", "NEW"]
          : [operation === "DELETE" ? "OLD" : "NEW"];
      this.db
        .exec(`CREATE TRIGGER IF NOT EXISTS cc_project_scope_${operation.toLowerCase()}
        AFTER ${operation} ON projects BEGIN ${references
          .map(
            (reference) => `
          INSERT INTO cc_project_scope_revisions(project_id,revision) VALUES (${reference}.id,1)
          ON CONFLICT(project_id) DO UPDATE SET revision=revision+1;`,
          )
          .join("")} END;`);
    }
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const references =
        operation === "UPDATE"
          ? ["OLD", "NEW"]
          : [operation === "DELETE" ? "OLD" : "NEW"];
      this.db
        .exec(`CREATE TRIGGER IF NOT EXISTS cc_project_task_scope_${operation.toLowerCase()}
        AFTER ${operation} ON project_tasks BEGIN ${references
          .map(
            (reference) => `
          INSERT INTO cc_project_scope_revisions(project_id,revision) VALUES (${reference}.project_id,1)
          ON CONFLICT(project_id) DO UPDATE SET revision=revision+1;`,
          )
          .join("")} END;`);
    }
    // Reparenting/restoring an organization project cannot revive the policy
    // admitted before that change. Metadata edits also invalidate conservatively.
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const references =
        operation === "UPDATE"
          ? ["OLD", "NEW"]
          : [operation === "DELETE" ? "OLD" : "NEW"];
      this.db
        .exec(`CREATE TRIGGER IF NOT EXISTS cc_org_project_scope_${operation.toLowerCase()}
        AFTER ${operation} ON organization_projects BEGIN ${references
          .map(
            (reference) => `
          INSERT INTO cc_organization_authority_revisions(org_id,revision) VALUES (${reference}.org_id,1)
          ON CONFLICT(org_id) DO UPDATE SET revision=revision+1;`,
          )
          .join("")} END;`);
    }
    this._installWorkspaceFences();
  }

  _installOrganizationFences(table) {
    const bump = (
      reference,
    ) => `INSERT INTO cc_organization_authority_revisions(org_id,revision)
      VALUES (${reference}.org_id,1) ON CONFLICT(org_id) DO UPDATE SET revision=revision+1;`;
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const body =
        operation === "UPDATE"
          ? bump("OLD") + bump("NEW")
          : bump(operation === "DELETE" ? "OLD" : "NEW");
      this.db
        .exec(`CREATE TRIGGER IF NOT EXISTS cc_org_authority_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table} BEGIN ${body} END;`);
    }
  }

  _installWorkspaceFences() {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_resources'",
        )
        .get()
    )
      return;
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const references =
        operation === "UPDATE"
          ? ["OLD", "NEW"]
          : [operation === "DELETE" ? "OLD" : "NEW"];
      this.db
        .exec(`CREATE TRIGGER IF NOT EXISTS cc_workspace_project_scope_${operation.toLowerCase()}
        AFTER ${operation} ON workspace_resources BEGIN ${references
          .map(
            (reference) => `
          INSERT INTO cc_project_scope_revisions(project_id,revision)
            SELECT id,1 FROM projects WHERE ${reference}.resource_type='project' AND id=${reference}.resource_id
            UNION SELECT project_id,1 FROM project_tasks WHERE ${reference}.resource_type='task' AND id=${reference}.resource_id
            ON CONFLICT(project_id) DO UPDATE SET revision=revision+1;`,
          )
          .join("")} END;`);
    }
  }

  _source(orgId) {
    identifier(orgId);
    const organization = this.db
      .prepare(
        "SELECT org_id,org_did,owner_did FROM organization_info WHERE org_id=?",
      )
      .get(orgId);
    const revision = this.db
      .prepare(
        "SELECT revision FROM cc_organization_authority_revisions WHERE org_id=?",
      )
      .get(orgId)?.revision;
    const members = this.db
      .prepare(
        "SELECT id,member_did,role,status FROM organization_members WHERE org_id=? ORDER BY id LIMIT 1001",
      )
      .all(orgId);
    if (
      !organization ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      members.length > 1000 ||
      new Set(members.map((member) => member.member_did)).size !==
        members.length
    )
      fail("ORG_AUTH_SOURCE_INVALID");
    identifier(organization.org_did);
    identifier(organization.owner_did);
    for (const member of members) {
      identifier(member.id);
      identifier(member.member_did);
      if (
        !["owner", "admin", "member", "viewer"].includes(member.role) ||
        !["active", "inactive", "removed"].includes(member.status)
      )
        fail("ORG_AUTH_SOURCE_INVALID");
    }
    return { organization, revision, members };
  }

  _owner(orgId, actor) {
    const source = this._source(orgId);
    if (
      source.organization.owner_did !== actor ||
      !source.members.some(
        (member) =>
          member.member_did === actor &&
          member.role === "owner" &&
          member.status === "active",
      )
    )
      fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
    return source;
  }

  _permissions(entries, source) {
    if (!Array.isArray(entries) || entries.length > 100)
      fail("ORG_AUTH_INVALID_REQUEST");
    const seen = new Set();
    return entries
      .map((entry) => {
        fields(entry, ["actorDid", "projectId", "permissions", "expiresAt"]);
        identifier(entry.actorDid);
        identifier(entry.projectId);
        if (
          !entry.actorDid.startsWith("did:") ||
          !Number.isSafeInteger(entry.expiresAt) ||
          entry.expiresAt <= this._time() ||
          !Array.isArray(entry.permissions) ||
          entry.permissions.length < 1 ||
          entry.permissions.some(
            (permission) => !PERMISSIONS.includes(permission),
          ) ||
          new Set(entry.permissions).size !== entry.permissions.length
        )
          fail("ORG_AUTH_INVALID_REQUEST");
        const pair = `${entry.actorDid}\0${entry.projectId}`;
        if (seen.has(pair)) fail("ORG_AUTH_INVALID_REQUEST");
        seen.add(pair);
        if (
          !source.members.some(
            (member) =>
              member.member_did === entry.actorDid &&
              member.status === "active",
          )
        )
          fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
        return {
          actorDid: entry.actorDid,
          projectId: entry.projectId,
          permissions: [...entry.permissions].sort(),
          expiresAt: entry.expiresAt,
        };
      })
      .sort(
        (a, b) =>
          a.actorDid.localeCompare(b.actorDid) ||
          a.projectId.localeCompare(b.projectId),
      );
  }

  _policyPreview(input, actor) {
    fields(input, ["orgId", "permissions"], ["workflowIds"]);
    if (Array.isArray(input.workflowIds) && input.workflowIds.length) {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='approval_workflows'",
          )
          .get()
      )
        fail("ORG_AUTH_SOURCE_INCOMPLETE");
      this._installOrganizationFences("approval_workflows");
    }
    this._installWorkspaceFences();
    const source = this._owner(input.orgId, actor);
    const previousEpoch =
      this.db
        .prepare(
          "SELECT epoch FROM cc_organization_project_policies WHERE org_id=?",
        )
        .get(input.orgId)?.epoch ?? 0;
    if (
      !Number.isSafeInteger(previousEpoch) ||
      previousEpoch < 0 ||
      !Number.isSafeInteger(previousEpoch + 1)
    )
      fail("ORG_AUTH_SOURCE_INVALID");
    const workflowIds = input.workflowIds ?? [];
    if (
      !Array.isArray(workflowIds) ||
      workflowIds.length > 20 ||
      new Set(workflowIds).size !== workflowIds.length
    )
      fail("ORG_AUTH_INVALID_REQUEST");
    const workflows = workflowIds
      .map((workflowId) => {
        identifier(workflowId);
        const workflow = this.db
          .prepare("SELECT * FROM approval_workflows WHERE id=?")
          .get(workflowId);
        if (
          !workflow ||
          workflow.org_id !== input.orgId ||
          workflow.enabled !== 1
        )
          fail("ORG_AUTH_WORKFLOW_DENIED");
        return workflow;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const policy = {
      schema: POLICY_SCHEMA,
      orgId: input.orgId,
      epoch: previousEpoch + 1,
      sourceRevision: source.revision,
      sourceDigest: digestBusinessObjectContent(source),
      ownerDid: actor,
      permissions: this._permissions(input.permissions, source),
      workflows: workflows.map((workflow) => ({
        workflowId: workflow.id,
        workflowDigest: digestBusinessObjectContent(workflow),
      })),
    };
    if (Buffer.byteLength(JSON.stringify(policy), "utf8") > MAX_POLICY_BYTES)
      fail("ORG_AUTH_POLICY_TOO_LARGE");
    return { policy, digest: digestBusinessObjectContent(policy), workflows };
  }

  previewPolicy(input) {
    return this._transaction(() => this._policyPreview(input, this._actor()));
  }

  async attestPolicy(input) {
    input = structuredClone(
      fields(
        input,
        ["orgId", "permissions", "expectedDigest"],
        ["workflowIds"],
      ),
    );
    const data = {
      orgId: input.orgId,
      permissions: input.permissions,
      workflowIds: input.workflowIds ?? [],
    };
    const admitted = this._transaction(() => {
      const actor = this._actor();
      const preview = this._policyPreview(data, actor);
      if (preview.digest !== input.expectedDigest)
        fail("ORG_AUTH_VERSION_CONFLICT");
      return { actor, preview };
    });
    if (
      !(await this._confirm("attest-policy", admitted.actor, admitted.preview))
    )
      return { status: "cancelled" };
    return this._transaction(() => {
      const actor = this._actor();
      if (actor !== admitted.actor) fail("ORG_AUTH_IDENTITY_CHANGED");
      const latest = this._policyPreview(data, actor);
      if (latest.digest !== input.expectedDigest)
        fail("ORG_AUTH_VERSION_CONFLICT");
      const at = this._time();
      this.db
        .prepare(
          `INSERT INTO cc_organization_project_policies
        (org_id,epoch,policy_json,policy_digest,attested_by_did,attested_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(org_id) DO UPDATE SET epoch=excluded.epoch,policy_json=excluded.policy_json,
          policy_digest=excluded.policy_digest,attested_by_did=excluded.attested_by_did,attested_at=excluded.attested_at`,
        )
        .run(
          data.orgId,
          latest.policy.epoch,
          JSON.stringify(latest.policy),
          latest.digest,
          actor,
          at,
        );
      const receipt = this._event(data.orgId, actor, "policy-attested", {
        policyDigest: latest.digest,
        epoch: latest.policy.epoch,
        sourceRevision: latest.policy.sourceRevision,
        at,
      });
      return {
        status: "attested",
        policy: latest.policy,
        digest: latest.digest,
        receipt,
      };
    });
  }

  async _confirm(kind, actorDid, preview) {
    // The confirmation receives a detached preview. It cannot change the
    // authoritative data used after the await, and must return boolean true.
    try {
      return (
        (await this.confirm({
          kind,
          actorDid,
          ...structuredClone(preview),
        })) === true
      );
    } catch {
      fail("ORG_AUTH_CONFIRMATION_FAILED");
    }
  }

  _event(orgId, actorDid, kind, data) {
    const evidence = { id: randomUUID(), orgId, actorDid, kind, ...data };
    const digest = digestBusinessObjectContent(evidence);
    this.db
      .prepare(
        `INSERT INTO cc_organization_authority_events
      (id,org_id,actor_did,kind,evidence_json,evidence_digest) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        evidence.id,
        orgId,
        actorDid,
        kind,
        JSON.stringify(evidence),
        digest,
      );
    return { id: evidence.id, digest };
  }

  _policy(orgId) {
    const row = this.db
      .prepare("SELECT * FROM cc_organization_project_policies WHERE org_id=?")
      .get(orgId);
    if (
      !row ||
      typeof row.policy_json !== "string" ||
      Buffer.byteLength(row.policy_json) > MAX_POLICY_BYTES
    )
      fail("ORG_AUTH_POLICY_REQUIRED");
    let policy;
    try {
      policy = JSON.parse(row.policy_json);
      fields(policy, [
        "schema",
        "orgId",
        "epoch",
        "sourceRevision",
        "sourceDigest",
        "ownerDid",
        "permissions",
        "workflows",
      ]);
      if (
        policy.schema !== POLICY_SCHEMA ||
        policy.orgId !== orgId ||
        policy.epoch !== row.epoch ||
        policy.ownerDid !== row.attested_by_did ||
        digestBusinessObjectContent(policy) !== row.policy_digest
      )
        fail("ORG_AUTH_POLICY_CORRUPT");
    } catch {
      fail("ORG_AUTH_POLICY_CORRUPT");
    }
    const source = this._owner(orgId, policy.ownerDid);
    if (
      policy.sourceRevision !== source.revision ||
      policy.sourceDigest !== digestBusinessObjectContent(source)
    )
      fail("ORG_AUTH_POLICY_STALE");
    return { policy, digest: row.policy_digest, source };
  }

  _project(projectId) {
    const columns = new Set(
      this.db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .map((row) => row.name),
    );
    const optional = ["deleted", "org_id", "workspace_id"].filter((name) =>
      columns.has(name),
    );
    const project = this.db
      .prepare(
        `SELECT id,user_id,status,updated_at${optional.map((name) => `,${name}`).join("")} FROM projects WHERE id=?`,
      )
      .get(identifier(projectId));
    if (!project || (project.deleted != null && project.deleted !== 0))
      fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
    if (
      !Number.isSafeInteger(project.updated_at) ||
      !["draft", "active"].includes(project.status)
    )
      fail("ORG_AUTH_PROJECT_INVALID");
    return project;
  }

  _scope(project, orgId) {
    if (
      project.workspace_id != null ||
      (project.org_id != null && project.org_id !== orgId)
    )
      fail("ORG_AUTH_SCOPE_CONFLICT");
    const columns = new Set(
      this.db
        .prepare("PRAGMA table_info(project_tasks)")
        .all()
        .map((row) => row.name),
    );
    const incompatible = [
      ...(columns.has("workspace_id") ? ["workspace_id IS NOT NULL"] : []),
      ...(columns.has("org_id") ? ["(org_id IS NOT NULL AND org_id<>?)"] : []),
    ];
    if (
      incompatible.length &&
      this.db
        .prepare(
          `SELECT 1 FROM project_tasks WHERE project_id=? AND (${incompatible.join(" OR ")}) LIMIT 1`,
        )
        .get(project.id, ...(columns.has("org_id") ? [orgId] : []))
    )
      fail("ORG_AUTH_SCOPE_CONFLICT");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_resources'",
        )
        .get() &&
      this.db
        .prepare(
          `SELECT 1 FROM workspace_resources WHERE
        (resource_type='project' AND resource_id=?) OR
        (resource_type='task' AND resource_id IN (SELECT id FROM project_tasks WHERE project_id=?)) LIMIT 1`,
        )
        .get(project.id, project.id)
    )
      fail("ORG_AUTH_SCOPE_CONFLICT");
  }

  _mappingPreview(input, actor, { dualPrincipal = false } = {}) {
    fields(input, ["projectId", "organizationProjectId", "orgId"]);
    this._installWorkspaceFences();
    const { policy, digest, source } = this._policy(input.orgId);
    if (!dualPrincipal) this._owner(input.orgId, actor);
    const project = this._project(input.projectId);
    const organizationProject = this.db
      .prepare(
        "SELECT id,org_id,owner_did FROM organization_projects WHERE id=?",
      )
      .get(identifier(input.organizationProjectId));
    if (dualPrincipal) {
      if (
        ![project.user_id, source.organization.owner_did].includes(actor) ||
        !source.members.some(
          (member) =>
            member.member_did === project.user_id && member.status === "active",
        )
      )
        fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
      if (project.user_id === source.organization.owner_did)
        fail("ORG_AUTH_OWNER_CONSENT_REQUIRED");
    } else if (project.user_id !== actor)
      fail("ORG_AUTH_OWNER_CONSENT_REQUIRED");
    if (!organizationProject || organizationProject.org_id !== input.orgId)
      fail("ORG_AUTH_SCOPE_CONFLICT");
    this._scope(project, input.orgId);
    // A same-ID independent row is ambiguous unless it is the selected row.
    const collision = this.db
      .prepare("SELECT id FROM organization_projects WHERE id=?")
      .get(project.id);
    if (collision && collision.id !== organizationProject.id)
      fail("ORG_AUTH_SCOPE_CONFLICT");
    if (
      this.db
        .prepare(
          `SELECT 1 FROM ${BINDINGS_TABLE} WHERE project_id=? OR organization_project_id=?`,
        )
        .get(project.id, organizationProject.id)
    )
      fail("ORG_AUTH_MAPPING_EXISTS");
    // The original single-owner entry must not bypass another live transfer.
    // Dual-principal admission excludes its own consent in the transfer service.
    if (
      !dualPrincipal &&
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_organization_project_transfers'",
        )
        .get() &&
      this.db
        .prepare(
          "SELECT 1 FROM cc_organization_project_transfers WHERE status='pending' AND expires_at>? AND (project_id=? OR organization_project_id=?) LIMIT 1",
        )
        .get(this._time(), project.id, organizationProject.id)
    )
      fail("ORG_AUTH_PENDING_ACTION");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_business_action_runs'",
        )
        .get() &&
      this.db
        .prepare(
          `SELECT 1 FROM cc_business_action_runs WHERE
        (target_id=? OR target_id IN (SELECT id FROM project_tasks WHERE project_id=?)) AND
        CASE WHEN json_valid(run_json) THEN COALESCE(json_extract(run_json,'$.status') NOT IN ('succeeded','failed','cancelled','denied'),1) ELSE 1 END LIMIT 1`,
        )
        .get(project.id, project.id)
    )
      fail("ORG_AUTH_PENDING_ACTION");
    const evidence = {
      orgId: input.orgId,
      project,
      organizationProject,
      ...(dualPrincipal
        ? {
            originalOwnerDid: project.user_id,
            organizationOwnerDid: source.organization.owner_did,
            sourceRevision: source.revision,
            sourceDigest: policy.sourceDigest,
            projectPermissions: policy.permissions.filter(
              (grant) => grant.projectId === project.id,
            ),
          }
        : { actorDid: actor }),
      policyDigest: digest,
      authorityEpoch: policy.epoch,
      projectSourceRevision: this.db
        .prepare(
          "SELECT revision FROM cc_project_scope_revisions WHERE project_id=?",
        )
        .get(project.id)?.revision,
      databaseSchemaRevision: this.db.pragma("schema_version", {
        simple: true,
      }),
    };
    return { evidence, digest: digestBusinessObjectContent(evidence) };
  }

  previewBinding(input) {
    return this._transaction(() => this._mappingPreview(input, this._actor()));
  }

  async bindProject(input) {
    input = structuredClone(
      fields(input, [
        "projectId",
        "organizationProjectId",
        "orgId",
        "expectedDigest",
      ]),
    );
    const data = {
      projectId: input.projectId,
      organizationProjectId: input.organizationProjectId,
      orgId: input.orgId,
    };
    const admitted = this._transaction(() => {
      const actor = this._actor();
      const preview = this._mappingPreview(data, actor);
      if (preview.digest !== input.expectedDigest)
        fail("ORG_AUTH_VERSION_CONFLICT");
      return { actor, preview };
    });
    if (
      !(await this._confirm("bind-project", admitted.actor, admitted.preview))
    )
      return { status: "cancelled" };
    return this._transaction(() => {
      const actor = this._actor();
      if (actor !== admitted.actor) fail("ORG_AUTH_IDENTITY_CHANGED");
      const latest = this._mappingPreview(data, actor);
      if (latest.digest !== input.expectedDigest)
        fail("ORG_AUTH_VERSION_CONFLICT");
      const at = this._time();
      this.db
        .prepare(
          `INSERT INTO ${BINDINGS_TABLE}
        (project_id,organization_project_id,org_id,revision,status,original_owner_did,bound_by_did,created_at)
        VALUES (?,?,?,1,'active',?,?,?)`,
        )
        .run(
          data.projectId,
          data.organizationProjectId,
          data.orgId,
          actor,
          actor,
          at,
        );
      const receipt = this._event(data.orgId, actor, "project-bound", {
        projectId: data.projectId,
        organizationProjectId: data.organizationProjectId,
        mappingRevision: 1,
        bindingDigest: latest.digest,
        at,
      });
      return {
        status: "bound",
        receipt,
        binding: this.db
          .prepare(`SELECT * FROM ${BINDINGS_TABLE} WHERE project_id=?`)
          .get(data.projectId),
      };
    });
  }

  assertAuthorizedInTransaction({
    projectId,
    actorDid,
    permission,
    expectedAuthority,
  }) {
    if (!this.db.inTransaction) fail("ORG_AUTH_TRANSACTION_REQUIRED");
    const actor = this._actor();
    if (actor !== actorDid) fail("ORG_AUTH_IDENTITY_CHANGED");
    return this._authorization(projectId, actor, permission, expectedAuthority);
  }

  assertApproverInTransaction({ projectId, approverDid, expectedAuthority }) {
    if (!this.db.inTransaction) fail("ORG_AUTH_TRANSACTION_REQUIRED");
    const actor = this._actor();
    this._authorization(projectId, actor, "task.read", expectedAuthority);
    return this._authorization(
      projectId,
      identifier(approverDid),
      "task.approve",
      expectedAuthority,
    );
  }

  assertWorkflowInTransaction({
    projectId,
    actorDid,
    workflowId,
    expectedAuthority,
  }) {
    const authority = this.assertAuthorizedInTransaction({
      projectId,
      actorDid,
      permission: "task.read",
      expectedAuthority,
    });
    const { policy } = this._policy(authority.scope.id);
    const pin = policy.workflows.find(
      (workflow) => workflow.workflowId === identifier(workflowId),
    );
    if (!pin) fail("ORG_AUTH_WORKFLOW_DENIED");
    const workflow = this.db
      .prepare("SELECT * FROM approval_workflows WHERE id=?")
      .get(workflowId);
    if (
      !workflow ||
      workflow.org_id !== authority.scope.id ||
      workflow.enabled !== 1 ||
      digestBusinessObjectContent(workflow) !== pin.workflowDigest
    )
      fail("ORG_AUTH_WORKFLOW_STALE");
    return { workflow, authority };
  }

  _authorization(projectId, actor, permission, expectedAuthority) {
    this._installWorkspaceFences();
    if (!PERMISSIONS.includes(permission)) fail("ORG_AUTH_INVALID_REQUEST");
    const binding = this.db
      .prepare(`SELECT * FROM ${BINDINGS_TABLE} WHERE project_id=?`)
      .get(identifier(projectId));
    if (!binding || binding.status !== "active")
      fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
    const { policy, digest, source } = this._policy(binding.org_id);
    const project = this._project(projectId);
    const organizationProject = this.db
      .prepare("SELECT org_id FROM organization_projects WHERE id=?")
      .get(binding.organization_project_id);
    if (
      organizationProject?.org_id !== binding.org_id ||
      project.user_id !== binding.original_owner_did
    )
      fail("ORG_AUTH_SCOPE_CONFLICT");
    this._scope(project, binding.org_id);
    if (
      !source.members.some(
        (member) => member.member_did === actor && member.status === "active",
      )
    )
      fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
    const grant = policy.permissions.find(
      (entry) =>
        entry.actorDid === actor &&
        entry.projectId === projectId &&
        entry.permissions.includes(permission),
    );
    if (!grant || grant.expiresAt <= this._time())
      fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
    const authority = {
      scope: { kind: "organization", id: binding.org_id },
      mappingRevision: binding.revision,
      authorityEpoch: policy.epoch,
      sourceRevision: policy.sourceRevision,
      policyDigest: digest,
      projectSourceRevision: this.db
        .prepare(
          "SELECT revision FROM cc_project_scope_revisions WHERE project_id=?",
        )
        .get(projectId)?.revision,
      databaseSchemaRevision: this.db.pragma("schema_version", {
        simple: true,
      }),
    };
    if (
      !Number.isSafeInteger(authority.projectSourceRevision) ||
      authority.projectSourceRevision < 1 ||
      !Number.isSafeInteger(authority.mappingRevision) ||
      authority.mappingRevision < 1
    )
      fail("ORG_AUTH_SOURCE_INVALID");
    if (
      expectedAuthority !== undefined &&
      digestBusinessObjectContent(expectedAuthority) !==
        digestBusinessObjectContent(authority)
    )
      fail("ORG_AUTH_VERSION_CONFLICT");
    return authority;
  }

  async revokeBinding(input) {
    input = structuredClone(fields(input, ["projectId", "expectedRevision"]));
    const read = (actor) => {
      const binding = this.db
        .prepare(`SELECT * FROM ${BINDINGS_TABLE} WHERE project_id=?`)
        .get(identifier(input.projectId));
      if (!binding || binding.status !== "active")
        fail("ORG_AUTH_NOT_FOUND_OR_DENIED");
      const authoritySource = this._owner(binding.org_id, actor);
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision !== binding.revision
      )
        fail("ORG_AUTH_VERSION_CONFLICT");
      return {
        binding,
        authoritySource,
        digest: digestBusinessObjectContent({ binding, authoritySource }),
      };
    };
    const admitted = this._transaction(() => {
      const actor = this._actor();
      return { actor, preview: read(actor) };
    });
    if (
      !(await this._confirm("revoke-binding", admitted.actor, admitted.preview))
    )
      return { status: "cancelled" };
    return this._transaction(() => {
      const actor = this._actor();
      if (actor !== admitted.actor) fail("ORG_AUTH_IDENTITY_CHANGED");
      const latest = read(actor);
      if (latest.digest !== admitted.preview.digest)
        fail("ORG_AUTH_VERSION_CONFLICT");
      const at = this._time();
      const revision = latest.binding.revision + 1;
      if (!Number.isSafeInteger(revision)) fail("ORG_AUTH_SOURCE_INVALID");
      this.db
        .prepare(
          `UPDATE ${BINDINGS_TABLE} SET status='revoked',revision=?,revoked_at=? WHERE project_id=? AND revision=? AND status='active'`,
        )
        .run(revision, at, input.projectId, input.expectedRevision);
      const receipt = this._event(
        latest.binding.org_id,
        actor,
        "project-binding-revoked",
        { projectId: input.projectId, mappingRevision: revision, at },
      );
      return { status: "revoked", revision, receipt };
    });
  }
}

module.exports = {
  OrganizationProjectAuthority,
  hasOrganizationProjectBinding,
  POLICY_SCHEMA,
  PERMISSIONS,
};
