"use strict";

const { randomUUID } = require("node:crypto");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract");

const SCHEMA = "chainlesschain.organization-project-transfer/v1";
const TABLE = "cc_organization_project_transfers";
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 65536;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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
    fail("ORG_TRANSFER_INVALID_REQUEST");
  return value;
}
function fields(value, required, optional = []) {
  try {
    digest(value);
  } catch {
    fail("ORG_TRANSFER_INVALID_REQUEST");
  }
  if (
    !value ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("ORG_TRANSFER_INVALID_REQUEST");
}
function mapping(value) {
  return {
    projectId: id(value.projectId),
    organizationProjectId: id(value.organizationProjectId),
    orgId: id(value.orgId),
  };
}
function consentDigest(snapshotDigest, expiresAt) {
  return digest({ schema: SCHEMA, snapshotDigest, expiresAt });
}

/** Two authenticated principals consent to one immutable mapping snapshot.
 * This private ledger contains no task bodies and confers no task permission.
 * Pending records do not block personal reads/writes; their source revisions
 * invalidate acceptance when a personal writer changes the project meanwhile.
 * A terminal receipt remains readable by its original parties after migration.
 */
class OrganizationProjectTransferService {
  constructor({ db, getActor, authority, now = () => Date.now() } = {}) {
    if (
      !db ||
      typeof db.transaction !== "function" ||
      typeof db.inTransaction !== "boolean" ||
      typeof db.transaction(() => {}).immediate !== "function"
    )
      fail("ORG_TRANSFER_NATIVE_DATABASE_REQUIRED");
    if (
      typeof getActor !== "function" ||
      typeof now !== "function" ||
      authority?.db !== db ||
      typeof authority?._mappingPreview !== "function" ||
      typeof authority?._confirm !== "function"
    )
      fail("ORG_TRANSFER_AUTHORITY_REQUIRED");
    Object.assign(this, { db, getActor, authority, now });
    this._transaction(() =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, organization_project_id TEXT NOT NULL, org_id TEXT NOT NULL,
        original_owner_did TEXT NOT NULL, organization_owner_did TEXT NOT NULL,
        snapshot_json TEXT NOT NULL CHECK(length(CAST(snapshot_json AS BLOB))<=${MAX_SNAPSHOT_BYTES}),
        snapshot_digest TEXT NOT NULL, consent_digest TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
        expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at-created_at<=${MAX_LIFETIME_MS}),
        metadata_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','bound','cancelled','rejected')),
        consent_receipt_id TEXT NOT NULL, consent_receipt_digest TEXT NOT NULL,
        terminal_receipt_id TEXT, terminal_receipt_digest TEXT,
        CHECK(original_owner_did<>organization_owner_did),
        CHECK((status='pending' AND terminal_receipt_id IS NULL AND terminal_receipt_digest IS NULL) OR
          (status<>'pending' AND terminal_receipt_id IS NOT NULL AND terminal_receipt_digest IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS cc_org_transfer_project ON ${TABLE}(project_id,id);
      CREATE INDEX IF NOT EXISTS cc_org_transfer_project_created ON ${TABLE}(project_id,created_at,id);
      CREATE INDEX IF NOT EXISTS cc_org_transfer_target ON ${TABLE}(organization_project_id,status,expires_at);
      CREATE TRIGGER IF NOT EXISTS cc_org_transfer_immutable BEFORE UPDATE ON ${TABLE}
        WHEN OLD.id IS NOT NEW.id OR OLD.project_id IS NOT NEW.project_id OR OLD.organization_project_id IS NOT NEW.organization_project_id
          OR OLD.org_id IS NOT NEW.org_id OR OLD.original_owner_did IS NOT NEW.original_owner_did
          OR OLD.organization_owner_did IS NOT NEW.organization_owner_did OR OLD.snapshot_json IS NOT NEW.snapshot_json
          OR OLD.snapshot_digest IS NOT NEW.snapshot_digest OR OLD.consent_digest IS NOT NEW.consent_digest
          OR OLD.created_at IS NOT NEW.created_at OR OLD.expires_at IS NOT NEW.expires_at OR OLD.metadata_digest IS NOT NEW.metadata_digest
          OR OLD.consent_receipt_id IS NOT NEW.consent_receipt_id OR OLD.consent_receipt_digest IS NOT NEW.consent_receipt_digest
          OR OLD.status<>'pending' OR NEW.status='pending'
          OR NEW.terminal_receipt_id IS NULL OR NEW.terminal_receipt_digest IS NULL
        BEGIN SELECT RAISE(ABORT,'ORG_TRANSFER_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS cc_org_transfer_retained BEFORE DELETE ON ${TABLE}
        BEGIN SELECT RAISE(ABORT,'ORG_TRANSFER_IMMUTABLE'); END;
    `),
    );
  }
  _transaction(operation) {
    if (this.db.inTransaction) fail("ORG_TRANSFER_TRANSACTION_BUSY");
    return this.db.transaction(operation).immediate();
  }
  _actor() {
    const actor = this.getActor();
    if (typeof actor !== "string" || !actor.startsWith("did:"))
      fail("ORG_TRANSFER_IDENTITY_REQUIRED");
    id(actor);
    if (actor !== this.authority._actor())
      fail("ORG_TRANSFER_IDENTITY_CHANGED");
    return actor;
  }
  _time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0)
      fail("ORG_TRANSFER_CLOCK_INVALID");
    return value;
  }
  _metadata(row) {
    return {
      transferId: row.id,
      projectId: row.project_id,
      organizationProjectId: row.organization_project_id,
      orgId: row.org_id,
      originalOwnerDid: row.original_owner_did,
      organizationOwnerDid: row.organization_owner_did,
      snapshotDigest: row.snapshot_digest,
      consentDigest: row.consent_digest,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
  _receipt(row, terminal = false) {
    return terminal
      ? row.terminal_receipt_id && {
          id: row.terminal_receipt_id,
          digest: row.terminal_receipt_digest,
        }
      : { id: row.consent_receipt_id, digest: row.consent_receipt_digest };
  }
  _event(receipt, orgId, actorDid, kind) {
    const stored = this.db
      .prepare("SELECT * FROM cc_organization_authority_events WHERE id=?")
      .get(receipt?.id);
    if (
      !stored ||
      typeof stored.evidence_json !== "string" ||
      Buffer.byteLength(stored.evidence_json) > MAX_SNAPSHOT_BYTES
    )
      fail("ORG_TRANSFER_RECORD_CORRUPT");
    let evidence;
    try {
      evidence = JSON.parse(stored.evidence_json);
    } catch {
      fail("ORG_TRANSFER_RECORD_CORRUPT");
    }
    if (
      stored.org_id !== orgId ||
      stored.actor_did !== actorDid ||
      stored.kind !== kind ||
      stored.evidence_digest !== receipt.digest ||
      digest(evidence) !== receipt.digest ||
      evidence.id !== receipt.id ||
      evidence.orgId !== orgId ||
      evidence.actorDid !== actorDid ||
      evidence.kind !== kind
    )
      fail("ORG_TRANSFER_RECORD_CORRUPT");
    return evidence;
  }
  _row(row) {
    if (!row) fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    try {
      const metadata = this._metadata(row),
        receipt = this._receipt(row);
      for (const value of [
        metadata.transferId,
        metadata.projectId,
        metadata.organizationProjectId,
        metadata.orgId,
        metadata.originalOwnerDid,
        metadata.organizationOwnerDid,
        receipt.id,
      ])
        id(value);
      if (
        !metadata.originalOwnerDid.startsWith("did:") ||
        !metadata.organizationOwnerDid.startsWith("did:") ||
        metadata.originalOwnerDid === metadata.organizationOwnerDid ||
        !Number.isSafeInteger(metadata.createdAt) ||
        metadata.createdAt < 0 ||
        !Number.isSafeInteger(metadata.expiresAt) ||
        metadata.expiresAt <= metadata.createdAt ||
        metadata.expiresAt - metadata.createdAt > MAX_LIFETIME_MS ||
        !DIGEST.test(metadata.snapshotDigest) ||
        !DIGEST.test(metadata.consentDigest) ||
        !DIGEST.test(receipt.digest) ||
        digest({ schema: SCHEMA, ...metadata, consentReceipt: receipt }) !==
          row.metadata_digest ||
        consentDigest(metadata.snapshotDigest, metadata.expiresAt) !==
          metadata.consentDigest ||
        typeof row.snapshot_json !== "string" ||
        Buffer.byteLength(row.snapshot_json) > MAX_SNAPSHOT_BYTES
      )
        fail("ORG_TRANSFER_RECORD_CORRUPT");
      const evidence = JSON.parse(row.snapshot_json);
      if (
        digest(evidence) !== metadata.snapshotDigest ||
        evidence.orgId !== metadata.orgId ||
        evidence.project?.id !== metadata.projectId ||
        evidence.organizationProject?.id !== metadata.organizationProjectId ||
        evidence.organizationProject?.org_id !== metadata.orgId ||
        evidence.originalOwnerDid !== metadata.originalOwnerDid ||
        evidence.project?.user_id !== metadata.originalOwnerDid ||
        evidence.organizationOwnerDid !== metadata.organizationOwnerDid
      )
        fail("ORG_TRANSFER_RECORD_CORRUPT");
      const consent = this._event(
        receipt,
        metadata.orgId,
        metadata.originalOwnerDid,
        "project-transfer-consented",
      );
      if (
        digest(consent) !==
        digest({
          id: receipt.id,
          orgId: metadata.orgId,
          actorDid: metadata.originalOwnerDid,
          kind: "project-transfer-consented",
          ...metadata,
          at: metadata.createdAt,
        })
      )
        fail("ORG_TRANSFER_RECORD_CORRUPT");
      if (!["pending", "bound", "cancelled", "rejected"].includes(row.status))
        fail("ORG_TRANSFER_RECORD_CORRUPT");
      if (row.status === "pending") {
        if (
          row.terminal_receipt_id !== null ||
          row.terminal_receipt_digest !== null
        )
          fail("ORG_TRANSFER_RECORD_CORRUPT");
      } else {
        const terminal = this._receipt(row, true);
        const kind =
          row.status === "bound"
            ? "project-transfer-accepted"
            : `project-transfer-${row.status}`;
        const actor =
          row.status === "cancelled"
            ? metadata.originalOwnerDid
            : metadata.organizationOwnerDid;
        const event = this._event(terminal, metadata.orgId, actor, kind);
        if (
          !Number.isSafeInteger(event.at) ||
          event.at < metadata.createdAt ||
          (row.status === "bound" && event.at >= metadata.expiresAt)
        )
          fail("ORG_TRANSFER_RECORD_CORRUPT");
        const expected = {
          id: terminal.id,
          orgId: metadata.orgId,
          actorDid: actor,
          kind,
          ...metadata,
          consentReceipt: receipt,
          at: event.at,
        };
        if (row.status === "bound") {
          const binding = this._event(
            event.bindingReceipt,
            metadata.orgId,
            metadata.organizationOwnerDid,
            "project-bound",
          );
          if (
            digest(binding) !==
            digest({
              id: event.bindingReceipt.id,
              orgId: metadata.orgId,
              actorDid: metadata.organizationOwnerDid,
              kind: "project-bound",
              ...metadata,
              mappingRevision: 1,
              bindingDigest: metadata.snapshotDigest,
              at: event.at,
            })
          )
            fail("ORG_TRANSFER_RECORD_CORRUPT");
          const mappingRow = this.db
            .prepare(
              "SELECT * FROM cc_organization_project_bindings WHERE project_id=?",
            )
            .get(metadata.projectId);
          if (
            !mappingRow ||
            mappingRow.org_id !== metadata.orgId ||
            mappingRow.organization_project_id !==
              metadata.organizationProjectId ||
            mappingRow.original_owner_did !== metadata.originalOwnerDid ||
            mappingRow.bound_by_did !== metadata.organizationOwnerDid ||
            mappingRow.created_at !== event.at ||
            !["active", "revoked"].includes(mappingRow.status) ||
            !Number.isSafeInteger(mappingRow.revision) ||
            mappingRow.revision < 1
          )
            fail("ORG_TRANSFER_RECORD_CORRUPT");
          expected.bindingReceipt = event.bindingReceipt;
        }
        if (digest(event) !== digest(expected))
          fail("ORG_TRANSFER_RECORD_CORRUPT");
      }
      return row;
    } catch (error) {
      if (error.code === "ORG_TRANSFER_RECORD_CORRUPT") throw error;
      fail("ORG_TRANSFER_RECORD_CORRUPT");
    }
  }
  _load(transferId) {
    return this._row(
      this.db.prepare(`SELECT * FROM ${TABLE} WHERE id=?`).get(id(transferId)),
    );
  }
  _party(row, actor) {
    if (![row.original_owner_did, row.organization_owner_did].includes(actor))
      fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
  }
  _noPending(data, exceptId = "") {
    const rows = this.db
      .prepare(
        `SELECT * FROM ${TABLE} WHERE status='pending' AND expires_at>?
      AND (project_id=? OR organization_project_id=?) AND id<>? LIMIT 101`,
      )
      .all(this._time(), data.projectId, data.organizationProjectId, exceptId);
    if (rows.length > 100) fail("ORG_TRANSFER_RECORD_CORRUPT");
    for (const row of rows) this._row(row);
    if (rows.length) fail("ORG_TRANSFER_PENDING_TRANSFER");
  }
  _preview(data, expiresAt, actor) {
    const at = this._time();
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= at ||
      expiresAt - at > MAX_LIFETIME_MS
    )
      fail(
        expiresAt <= at
          ? "ORG_TRANSFER_EXPIRED"
          : "ORG_TRANSFER_INVALID_REQUEST",
      );
    if (this.authority._project(data.projectId).user_id !== actor)
      fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    const preview = this.authority._mappingPreview(data, actor, {
      dualPrincipal: true,
    });
    if (
      Buffer.byteLength(JSON.stringify(preview.evidence)) > MAX_SNAPSHOT_BYTES
    )
      fail("ORG_TRANSFER_SNAPSHOT_TOO_LARGE");
    const revision = preview.evidence.projectSourceRevision;
    if (!Number.isSafeInteger(revision) || revision < 1)
      fail("ORG_AUTH_SOURCE_INVALID");
    return {
      evidence: preview.evidence,
      snapshotDigest: preview.digest,
      expiresAt,
      consentDigest: consentDigest(preview.digest, expiresAt),
    };
  }
  preview(input) {
    fields(
      input,
      ["projectId", "organizationProjectId", "orgId"],
      ["expiresAt"],
    );
    const data = mapping(input);
    return this._transaction(() => {
      const result = this._preview(
        data,
        input.expiresAt ?? this._time() + MAX_LIFETIME_MS,
        this._actor(),
      );
      this._noPending(data);
      return result;
    });
  }
  _current(row, actor) {
    const at = this._time();
    if (at < row.created_at) fail("ORG_TRANSFER_CLOCK_INVALID");
    if (at >= row.expires_at) fail("ORG_TRANSFER_EXPIRED");
    if (row.status !== "pending") fail("ORG_TRANSFER_NOT_PENDING");
    const data = mapping(this._metadata(row));
    const current = this.authority._mappingPreview(data, actor, {
      dualPrincipal: true,
    });
    if (current.digest !== row.snapshot_digest)
      fail("ORG_TRANSFER_VERSION_CONFLICT");
    this._noPending(data, row.id);
    return current.evidence;
  }
  _view(row, actor) {
    this._party(row, actor);
    const result = {
      ...this._metadata(row),
      status:
        row.status === "pending" && this._time() >= row.expires_at
          ? "expired"
          : row.status,
      consentReceipt: this._receipt(row),
      terminalReceipt: this._receipt(row, true),
      canAccept: false,
      canCancel: false,
      canReject: false,
      eligibilityReason: null,
    };
    if (result.status !== "pending") {
      if (result.status === "expired")
        result.eligibilityReason = "ORG_TRANSFER_EXPIRED";
      return result;
    }
    result.canCancel = actor === row.original_owner_did;
    if (actor === row.organization_owner_did) {
      try {
        this.authority._owner(row.org_id, actor);
        result.canReject = true;
      } catch (error) {
        if (!/^ORG_AUTH_/u.test(error.code || "")) throw error;
        result.eligibilityReason = error.code;
      }
    }
    try {
      this._current(row, actor);
      result.canAccept = actor === row.organization_owner_did;
    } catch (error) {
      if (!/^(ORG_AUTH_|ORG_TRANSFER_)/u.test(error.code || "")) throw error;
      result.eligibilityReason = error.code;
    }
    return result;
  }
  get(input) {
    fields(input, ["transferId"]);
    return this._transaction(() =>
      this._view(this._load(input.transferId), this._actor()),
    );
  }
  list(input) {
    fields(input, ["projectId"], ["beforeId", "limit"]);
    const projectId = id(input.projectId),
      beforeId = input.beforeId === undefined ? null : id(input.beforeId);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      fail("ORG_TRANSFER_INVALID_REQUEST");
    return this._transaction(() => {
      const actor = this._actor();
      const cursor = beforeId ? this._load(beforeId) : null;
      if (cursor) {
        if (cursor.project_id !== projectId)
          fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
        this._party(cursor, actor);
      }
      const rows = this.db
        .prepare(
          `SELECT * FROM ${TABLE} WHERE project_id=? AND (original_owner_did=? OR organization_owner_did=?)
        ${cursor ? "AND (created_at<? OR (created_at=? AND id<?))" : ""}
        ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(
          projectId,
          actor,
          actor,
          ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
          limit + 1,
        );
      const visible = rows.slice(0, limit);
      return {
        transfers: visible.map((row) => this._view(this._row(row), actor)),
        nextCursor: rows.length > limit ? visible.at(-1).id : null,
      };
    });
  }
  _existing(input, actor) {
    const row = this.db
      .prepare(`SELECT * FROM ${TABLE} WHERE consent_digest=?`)
      .get(input.expectedDigest);
    if (!row) return null;
    this._row(row);
    if (
      row.original_owner_did !== actor ||
      row.project_id !== input.projectId ||
      row.organization_project_id !== input.organizationProjectId ||
      row.org_id !== input.orgId ||
      row.expires_at !== input.expiresAt
    )
      fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
    return this._view(row, actor);
  }
  async submit(input) {
    fields(input, [
      "projectId",
      "organizationProjectId",
      "orgId",
      "expiresAt",
      "expectedDigest",
    ]);
    input = structuredClone(input);
    const data = mapping(input);
    if (
      !DIGEST.test(input.expectedDigest) ||
      !Number.isSafeInteger(input.expiresAt)
    )
      fail("ORG_TRANSFER_INVALID_REQUEST");
    const admitted = this._transaction(() => {
      const actor = this._actor(),
        existing = this._existing(input, actor);
      if (existing) return { actor, existing };
      const preview = this._preview(data, input.expiresAt, actor);
      if (preview.consentDigest !== input.expectedDigest)
        fail("ORG_TRANSFER_VERSION_CONFLICT");
      this._noPending(data);
      return { actor, preview };
    });
    if (admitted.existing) return admitted.existing;
    const confirmed = await this.authority._confirm(
      "consent-project-transfer",
      admitted.actor,
      admitted.preview,
    );
    return this._transaction(() => {
      const actor = this._actor();
      if (actor !== admitted.actor) fail("ORG_TRANSFER_IDENTITY_CHANGED");
      if (!confirmed) return { status: "cancelled" };
      const existing = this._existing(input, actor);
      if (existing) return existing;
      const latest = this._preview(data, input.expiresAt, actor);
      if (latest.consentDigest !== input.expectedDigest)
        fail("ORG_TRANSFER_VERSION_CONFLICT");
      this._noPending(data);
      const createdAt = this._time(),
        transferId = randomUUID();
      const metadata = {
        transferId,
        ...data,
        originalOwnerDid: latest.evidence.originalOwnerDid,
        organizationOwnerDid: latest.evidence.organizationOwnerDid,
        snapshotDigest: latest.snapshotDigest,
        consentDigest: latest.consentDigest,
        createdAt,
        expiresAt: input.expiresAt,
      };
      const receipt = this.authority._event(
        data.orgId,
        actor,
        "project-transfer-consented",
        { ...metadata, at: createdAt },
      );
      this.db
        .prepare(
          `INSERT INTO ${TABLE}(id,project_id,organization_project_id,org_id,original_owner_did,organization_owner_did,
        snapshot_json,snapshot_digest,consent_digest,created_at,expires_at,metadata_digest,status,consent_receipt_id,consent_receipt_digest)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
        )
        .run(
          transferId,
          data.projectId,
          data.organizationProjectId,
          data.orgId,
          metadata.originalOwnerDid,
          metadata.organizationOwnerDid,
          JSON.stringify(latest.evidence),
          latest.snapshotDigest,
          latest.consentDigest,
          createdAt,
          input.expiresAt,
          digest({ schema: SCHEMA, ...metadata, consentReceipt: receipt }),
          receipt.id,
          receipt.digest,
        );
      const row = this._load(transferId);
      // Even a database trigger cannot change source authority while persisting consent.
      this._current(row, this._actor());
      return this._view(row, actor);
    });
  }
  _finish(row, actor, status, kind, extra = {}, at = this._time()) {
    const metadata = this._metadata(row);
    if (at < row.created_at) fail("ORG_TRANSFER_CLOCK_INVALID");
    const receipt = this.authority._event(row.org_id, actor, kind, {
      ...metadata,
      consentReceipt: this._receipt(row),
      at,
      ...extra,
    });
    const result = this.db
      .prepare(
        `UPDATE ${TABLE} SET status=?,terminal_receipt_id=?,terminal_receipt_digest=? WHERE id=? AND status='pending'`,
      )
      .run(status, receipt.id, receipt.digest, row.id);
    if (result.changes !== 1) fail("ORG_TRANSFER_NOT_PENDING");
    // Bound records are validated after the mapping is inserted in this same
    // transaction; no provisional acceptance escapes to an external caller.
    return status === "bound"
      ? this.db.prepare(`SELECT * FROM ${TABLE} WHERE id=?`).get(row.id)
      : this._load(row.id);
  }
  async accept(input) {
    fields(input, ["transferId"]);
    const transferId = id(input.transferId);
    const admitted = this._transaction(() => {
      const actor = this._actor(),
        row = this._load(transferId);
      if (actor !== row.organization_owner_did)
        fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
      if (row.status === "bound")
        return { actor, existing: this._view(row, actor) };
      const evidence = this._current(row, actor);
      return {
        actor,
        preview: {
          ...this._metadata(row),
          evidence,
          consentReceipt: this._receipt(row),
        },
      };
    });
    if (admitted.existing) return admitted.existing;
    const confirmed = await this.authority._confirm(
      "accept-project-transfer",
      admitted.actor,
      admitted.preview,
    );
    return this._transaction(() => {
      const actor = this._actor();
      if (actor !== admitted.actor) fail("ORG_TRANSFER_IDENTITY_CHANGED");
      let row = this._load(transferId);
      if (!confirmed || row.status === "bound") return this._view(row, actor);
      const evidence = this._current(row, actor),
        metadata = this._metadata(row),
        at = this._time();
      const bindingReceipt = this.authority._event(
        row.org_id,
        actor,
        "project-bound",
        {
          ...metadata,
          mappingRevision: 1,
          bindingDigest: row.snapshot_digest,
          at,
        },
      );
      // Event writers run before the last source check and binding insertion.
      row = this._finish(
        row,
        actor,
        "bound",
        "project-transfer-accepted",
        { bindingReceipt },
        at,
      );
      const current = this.authority._mappingPreview(
        mapping(metadata),
        this._actor(),
        { dualPrincipal: true },
      );
      if (
        current.digest !== row.snapshot_digest ||
        this._time() >= row.expires_at
      )
        fail("ORG_TRANSFER_VERSION_CONFLICT");
      this._noPending(metadata, row.id);
      this.db
        .prepare(
          `INSERT INTO cc_organization_project_bindings
        (project_id,organization_project_id,org_id,revision,status,original_owner_did,bound_by_did,created_at)
        VALUES (?,?,?,1,'active',?,?,?)`,
        )
        .run(
          row.project_id,
          row.organization_project_id,
          row.org_id,
          row.original_owner_did,
          actor,
          at,
        );
      // A binding trigger changing either source must also roll the entire commit back.
      const policy = this.authority._policy(row.org_id);
      const revision = this.db
        .prepare(
          "SELECT revision FROM cc_project_scope_revisions WHERE project_id=?",
        )
        .get(row.project_id)?.revision;
      if (
        this._actor() !== actor ||
        policy.digest !== evidence.policyDigest ||
        policy.source.revision !== evidence.sourceRevision ||
        revision !== evidence.projectSourceRevision ||
        this.db.pragma("schema_version", { simple: true }) !==
          evidence.databaseSchemaRevision ||
        this._time() >= row.expires_at
      )
        fail("ORG_TRANSFER_VERSION_CONFLICT");
      return this._view(this._load(transferId), actor);
    });
  }
  cancel(input) {
    return this._close(input, "cancelled");
  }
  reject(input) {
    return this._close(input, "rejected");
  }
  async _close(input, status) {
    fields(input, ["transferId"]);
    const transferId = id(input.transferId);
    const read = (actor) => {
      const row = this._load(transferId);
      const expected =
        status === "cancelled"
          ? row.original_owner_did
          : row.organization_owner_did;
      if (actor !== expected) fail("ORG_TRANSFER_NOT_FOUND_OR_DENIED");
      if (row.status === status)
        return { row, existing: this._view(row, actor) };
      if (row.status !== "pending") fail("ORG_TRANSFER_NOT_PENDING");
      const ownerDigest =
        status === "rejected"
          ? digest(this.authority._owner(row.org_id, actor))
          : null;
      return { row, ownerDigest };
    };
    const admitted = this._transaction(() => {
      const actor = this._actor();
      return { actor, ...read(actor) };
    });
    if (admitted.existing) return admitted.existing;
    const confirmed = await this.authority._confirm(
      status === "cancelled"
        ? "cancel-project-transfer"
        : "reject-project-transfer",
      admitted.actor,
      {
        ...this._metadata(admitted.row),
        consentReceipt: this._receipt(admitted.row),
      },
    );
    return this._transaction(() => {
      const actor = this._actor();
      if (actor !== admitted.actor) fail("ORG_TRANSFER_IDENTITY_CHANGED");
      const { row, existing, ownerDigest } = read(actor);
      if (existing) return existing;
      if (!confirmed) return this._view(row, actor);
      if (ownerDigest !== admitted.ownerDigest)
        fail("ORG_TRANSFER_VERSION_CONFLICT");
      const result = this._finish(
        row,
        actor,
        status,
        `project-transfer-${status}`,
      );
      if (this._actor() !== actor) fail("ORG_TRANSFER_IDENTITY_CHANGED");
      if (
        status === "rejected" &&
        digest(this.authority._owner(row.org_id, actor)) !==
          admitted.ownerDigest
      )
        fail("ORG_TRANSFER_VERSION_CONFLICT");
      return this._view(result, actor);
    });
  }
}

module.exports = {
  OrganizationProjectTransferService,
  MAX_LIFETIME_MS,
  SCHEMA,
};
