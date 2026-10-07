"use strict";

const { randomUUID } = require("node:crypto");
const {
  validateBusinessActionRequest,
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");

const SCHEMA = "chainlesschain.organization-project-proposal/v1";
const MAX_REQUEST_BYTES = 65536;
const MAX_DESCRIPTION_BYTES = 8192;
const MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const META_COLUMNS =
  "id,project_id,org_id,workflow_id,requester_did,approval_id,request_digest,invocation_digest,action_digest,input_digest,target_type,target_id,created_at,expires_at,metadata_digest,body_purged_at";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u.test(value)
  )
    fail("ORG_PROPOSAL_INVALID_REQUEST");
  return value;
}
function fields(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("ORG_PROPOSAL_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("ORG_PROPOSAL_INVALID_REQUEST");
}
function limit(value, fallback = 20, maximum = 50) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    fail("ORG_PROPOSAL_INVALID_REQUEST");
  return result;
}

/** Controlled private business data, deliberately separate from body-free
 * approval/audit/action receipts. Full requests (including the raw idempotency
 * key needed for recovery) live only in this table. Reads reauthorize current
 * project membership; expiration is fixed at admission and never extended by
 * retries. Purging removes bodies while preserving historical metadata.
 * Hosts must execute by proposal ID and recheck its expiry after confirmation. */
class OrganizationProjectProposalStore {
  constructor({
    db,
    getActor,
    authority,
    approvals,
    now = () => Date.now(),
  } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("ORG_PROPOSAL_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof now !== "function" ||
      typeof authority?.assertAuthorizedInTransaction !== "function" ||
      typeof approvals?.submitInTransaction !== "function" ||
      typeof approvals?.getInTransaction !== "function"
    )
      fail("ORG_PROPOSAL_AUTHORITY_REQUIRED");
    Object.assign(this, { db, getActor, authority, approvals, now });
    this._transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS cc_organization_project_proposals (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), org_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL, requester_did TEXT NOT NULL,
      approval_id TEXT NOT NULL UNIQUE REFERENCES cc_organization_action_approvals(request_id),
      request_digest TEXT NOT NULL, invocation_digest TEXT NOT NULL, action_digest TEXT NOT NULL, input_digest TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('Task','Project')), target_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
      metadata_digest TEXT NOT NULL, request_json TEXT, body_purged_at INTEGER,
      CHECK((request_json IS NOT NULL AND body_purged_at IS NULL) OR (request_json IS NULL AND body_purged_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS cc_org_proposal_project_created ON cc_organization_project_proposals(project_id,created_at,id);
    CREATE TRIGGER IF NOT EXISTS cc_org_proposal_immutable BEFORE UPDATE ON cc_organization_project_proposals
      WHEN OLD.id IS NOT NEW.id OR OLD.project_id IS NOT NEW.project_id OR OLD.org_id IS NOT NEW.org_id
        OR OLD.workflow_id IS NOT NEW.workflow_id OR OLD.requester_did IS NOT NEW.requester_did
        OR OLD.approval_id IS NOT NEW.approval_id OR OLD.request_digest IS NOT NEW.request_digest
        OR OLD.invocation_digest IS NOT NEW.invocation_digest OR OLD.action_digest IS NOT NEW.action_digest
        OR OLD.input_digest IS NOT NEW.input_digest OR OLD.target_type IS NOT NEW.target_type OR OLD.target_id IS NOT NEW.target_id
        OR OLD.created_at IS NOT NEW.created_at OR OLD.expires_at IS NOT NEW.expires_at OR OLD.metadata_digest IS NOT NEW.metadata_digest
        OR OLD.request_json IS NULL OR NEW.request_json IS NOT NULL OR NEW.body_purged_at IS NULL
        OR typeof(NEW.body_purged_at)<>'integer' OR NEW.body_purged_at<OLD.expires_at
      BEGIN SELECT RAISE(ABORT,'ORG_PROPOSAL_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS cc_org_proposal_metadata_retained BEFORE DELETE ON cc_organization_project_proposals
      BEGIN SELECT RAISE(ABORT,'ORG_PROPOSAL_IMMUTABLE'); END;`),
    );
  }
  _transaction(operation) {
    if (this.db.inTransaction) fail("ORG_PROPOSAL_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _actor() {
    let actor;
    try {
      actor = this.getActor();
    } catch {
      fail("ORG_PROPOSAL_IDENTITY_REQUIRED");
    }
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("ORG_PROPOSAL_IDENTITY_REQUIRED");
    return id(actor);
  }
  _time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0)
      fail("ORG_PROPOSAL_CLOCK_INVALID");
    return value;
  }
  _request(input) {
    let request;
    try {
      request = validateBusinessActionRequest(input);
    } catch {
      fail("ORG_PROPOSAL_INVALID_REQUEST");
    }
    if (
      request.actionVersion !== 1 ||
      request.target.scope.kind !== "organization" ||
      !["task.create", "task.update-description"].includes(
        request.actionType,
      ) ||
      typeof request.input.description !== "string" ||
      Buffer.byteLength(request.input.description) > MAX_DESCRIPTION_BYTES
    )
      fail("ORG_PROPOSAL_INVALID_REQUEST");
    const json = JSON.stringify(request);
    if (Buffer.byteLength(json) > MAX_REQUEST_BYTES)
      fail("ORG_PROPOSAL_REQUEST_TOO_LARGE");
    return { request, json };
  }
  _authorize(projectId, actor = this._actor(), orgId = null) {
    const authority = this.authority.assertAuthorizedInTransaction({
      projectId: id(projectId),
      actorDid: actor,
      permission: "task.read",
    });
    if (
      authority?.scope?.kind !== "organization" ||
      (orgId !== null && authority.scope.id !== orgId)
    )
      fail("ORG_PROPOSAL_NOT_FOUND_OR_DENIED");
    return authority;
  }
  _metadata(row) {
    const metadata = {
      schema: SCHEMA,
      proposalId: row.id,
      projectId: row.project_id,
      orgId: row.org_id,
      workflowId: row.workflow_id,
      requesterDid: row.requester_did,
      approvalId: row.approval_id,
      requestDigest: row.request_digest,
      invocationDigest: row.invocation_digest,
      actionDigest: row.action_digest,
      inputDigest: row.input_digest,
      target: { type: row.target_type, id: row.target_id },
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
    try {
      for (const value of [
        metadata.proposalId,
        metadata.projectId,
        metadata.orgId,
        metadata.workflowId,
        metadata.requesterDid,
        metadata.approvalId,
        metadata.target.id,
      ])
        id(value);
      if (
        !metadata.requesterDid.startsWith("did:") ||
        !["Task", "Project"].includes(metadata.target.type) ||
        [
          metadata.requestDigest,
          metadata.invocationDigest,
          metadata.actionDigest,
          metadata.inputDigest,
        ].some((value) => !DIGEST.test(value)) ||
        !Number.isSafeInteger(metadata.createdAt) ||
        metadata.createdAt < 0 ||
        !Number.isSafeInteger(metadata.expiresAt) ||
        metadata.expiresAt <= metadata.createdAt ||
        metadata.expiresAt - metadata.createdAt > MAX_RETENTION_MS ||
        digest(metadata) !== row.metadata_digest ||
        (row.body_purged_at !== null &&
          (!Number.isSafeInteger(row.body_purged_at) ||
            row.body_purged_at < metadata.expiresAt))
      )
        throw new Error();
    } catch {
      fail("ORG_PROPOSAL_CORRUPT");
    }
    return metadata;
  }
  _load(proposalId) {
    // Authorize metadata before retrieving any request text from SQLite.
    const row = this.db
      .prepare(
        `SELECT ${META_COLUMNS},request_json IS NOT NULL AS body_present,
      length(CAST(request_json AS BLOB)) AS body_bytes FROM cc_organization_project_proposals WHERE id=?`,
      )
      .get(id(proposalId));
    if (!row) fail("ORG_PROPOSAL_NOT_FOUND_OR_DENIED");
    this._authorize(row.project_id, this._actor(), row.org_id);
    return { row, metadata: this._metadata(row) };
  }
  _approval(metadata) {
    const approval = this.approvals.getInTransaction({
      approvalId: metadata.approvalId,
    });
    if (
      approval.projectId !== metadata.projectId ||
      approval.requesterDid !== metadata.requesterDid ||
      approval.actionDigest !== metadata.actionDigest ||
      approval.target?.type !== metadata.target.type ||
      approval.target.id !== metadata.target.id ||
      approval.target.scope?.kind !== "organization" ||
      approval.target.scope.id !== metadata.orgId ||
      metadata.expiresAt > approval.expiresAt
    )
      fail("ORG_PROPOSAL_CORRUPT");
    return approval;
  }
  _view(loaded, { includeApproval = false } = {}) {
    const { row, metadata } = loaded;
    const approval = this._approval(metadata);
    let unavailableReason = null;
    if (this._time() >= metadata.expiresAt || approval.status === "expired")
      unavailableReason = "expired";
    else if (["cancelled", "rejected"].includes(approval.status))
      unavailableReason = approval.status;
    else if (!row.body_present) unavailableReason = "purged";
    if (
      (row.body_present && row.body_purged_at !== null) ||
      (!row.body_present && row.body_purged_at === null) ||
      (row.body_present &&
        (!Number.isSafeInteger(row.body_bytes) ||
          row.body_bytes < 1 ||
          row.body_bytes > MAX_REQUEST_BYTES))
    )
      fail("ORG_PROPOSAL_CORRUPT");
    if (!unavailableReason && metadata.target.type === "Task") {
      const columns = new Set(
        this.db
          .prepare("PRAGMA table_info(project_tasks)")
          .all()
          .map((column) => column.name),
      );
      const task = this.db
        .prepare(
          `SELECT project_id${columns.has("deleted") ? ",deleted" : ""} FROM project_tasks WHERE id=?`,
        )
        .get(metadata.target.id);
      if (
        !task ||
        task.project_id !== metadata.projectId ||
        (task.deleted != null && task.deleted !== 0)
      )
        unavailableReason = "target-unavailable";
    } else if (!unavailableReason && metadata.target.id !== metadata.projectId)
      fail("ORG_PROPOSAL_CORRUPT");
    return {
      ...metadata,
      approvalStatus: approval.status,
      currentStep: approval.currentStep,
      expiresAt: metadata.expiresAt,
      bodyAvailable: unavailableReason === null,
      unavailableReason,
      bodyPurgedAt: row.body_purged_at,
      authority: "current-project-read",
      ...(includeApproval ? { approval } : {}),
    };
  }
  submit(input) {
    fields(input, ["projectId", "workflowId", "request"]);
    id(input.projectId);
    id(input.workflowId);
    const { request, json } = this._request(input.request);
    return this._transaction(() => {
      const actor = this._actor();
      this._authorize(input.projectId, actor, request.target.scope.id);
      const approval = this.approvals.submitInTransaction({
        projectId: input.projectId,
        workflowId: input.workflowId,
        request,
      });
      const previous = this.db
        .prepare(
          "SELECT id FROM cc_organization_project_proposals WHERE approval_id=?",
        )
        .get(approval.approvalId);
      if (previous) {
        const loaded = this._load(previous.id);
        if (
          loaded.metadata.requestDigest !== digest(request) ||
          loaded.metadata.requesterDid !== actor ||
          loaded.metadata.workflowId !== input.workflowId
        )
          fail("ORG_PROPOSAL_IDEMPOTENCY_CONFLICT");
        return this._view(loaded);
      }
      const at = this._time();
      const expiresAt = Math.min(approval.expiresAt, at + MAX_RETENTION_MS);
      if (
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= at ||
        !["pending", "approved"].includes(approval.status)
      )
        fail("ORG_PROPOSAL_APPROVAL_UNAVAILABLE");
      const metadata = {
        schema: SCHEMA,
        proposalId: randomUUID(),
        projectId: input.projectId,
        orgId: request.target.scope.id,
        workflowId: input.workflowId,
        requesterDid: actor,
        approvalId: approval.approvalId,
        requestDigest: digest(request),
        invocationDigest: request.invocationDigest,
        actionDigest: request.actionDigest,
        inputDigest: request.inputDigest,
        target: { type: request.target.type, id: request.target.id },
        createdAt: at,
        expiresAt,
      };
      this.db
        .prepare(
          `INSERT INTO cc_organization_project_proposals
        (id,project_id,org_id,workflow_id,requester_did,approval_id,request_digest,invocation_digest,action_digest,input_digest,target_type,target_id,created_at,expires_at,metadata_digest,request_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          metadata.proposalId,
          input.projectId,
          metadata.orgId,
          input.workflowId,
          actor,
          metadata.approvalId,
          metadata.requestDigest,
          metadata.invocationDigest,
          metadata.actionDigest,
          metadata.inputDigest,
          metadata.target.type,
          metadata.target.id,
          at,
          expiresAt,
          digest(metadata),
          json,
        );
      return this._view(this._load(metadata.proposalId));
    });
  }
  get(input) {
    return this._transaction(() => this.getInTransaction(input));
  }
  getInTransaction(input) {
    if (!this.db.inTransaction) fail("ORG_PROPOSAL_TRANSACTION_REQUIRED");
    fields(input, ["proposalId"]);
    const loaded = this._load(input.proposalId),
      view = this._view(loaded, { includeApproval: true });
    if (!view.bodyAvailable) return { ...view, request: null };
    const stored = this.db
      .prepare(
        `SELECT CASE WHEN length(CAST(request_json AS BLOB))<=? THEN request_json ELSE NULL END AS request_json
        FROM cc_organization_project_proposals WHERE id=?`,
      )
      .get(MAX_REQUEST_BYTES, view.proposalId);
    let request;
    try {
      request = this._request(JSON.parse(stored.request_json)).request;
      if (
        digest(request) !== view.requestDigest ||
        request.invocationDigest !== view.invocationDigest ||
        request.actionDigest !== view.actionDigest ||
        request.inputDigest !== view.inputDigest ||
        request.target.type !== view.target.type ||
        request.target.id !== view.target.id ||
        request.target.scope.id !== view.orgId
      )
        throw new Error();
    } catch {
      fail("ORG_PROPOSAL_CORRUPT");
    }
    return { ...view, request };
  }
  list(input) {
    fields(input, ["projectId"], ["beforeId", "limit"]);
    const count = limit(input.limit);
    return this._transaction(() => {
      const authority = this._authorize(input.projectId);
      let cursor;
      if (input.beforeId !== undefined) {
        const loaded = this._load(input.beforeId);
        if (
          loaded.metadata.projectId !== input.projectId ||
          loaded.metadata.orgId !== authority.scope.id
        )
          fail("ORG_PROPOSAL_INVALID_CURSOR");
        cursor = loaded.metadata;
      }
      const rows = this.db
        .prepare(
          `SELECT id FROM cc_organization_project_proposals WHERE project_id=?
        ${cursor ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(
          input.projectId,
          ...(cursor
            ? [cursor.createdAt, cursor.createdAt, cursor.proposalId]
            : []),
          count + 1,
        );
      const proposals = rows
        .slice(0, count)
        .map((row) => this._view(this._load(row.id)));
      return {
        proposals,
        nextCursor: rows.length > count ? proposals.at(-1).proposalId : null,
      };
    });
  }
  purgeExpired(input) {
    fields(input, ["projectId"], ["limit"]);
    const count = limit(input.limit, 50, 100);
    return this._transaction(() => {
      this._authorize(input.projectId);
      const at = this._time();
      const rows = this.db
        .prepare(
          `SELECT id FROM cc_organization_project_proposals WHERE project_id=? AND expires_at<=? AND request_json IS NOT NULL
        ORDER BY expires_at,id LIMIT ?`,
        )
        .all(input.projectId, at, count);
      for (const row of rows) {
        this._load(row.id);
        const changed = this.db
          .prepare(
            "UPDATE cc_organization_project_proposals SET request_json=NULL,body_purged_at=? WHERE id=? AND expires_at<=? AND request_json IS NOT NULL",
          )
          .run(at, row.id, at).changes;
        if (changed !== 1) fail("ORG_PROPOSAL_PURGE_CONFLICT");
      }
      return { purged: rows.length };
    });
  }
}

module.exports = {
  OrganizationProjectProposalStore,
  ORGANIZATION_PROPOSAL_SCHEMA: SCHEMA,
  MAX_ORGANIZATION_PROPOSAL_RETENTION_MS: MAX_RETENTION_MS,
};
