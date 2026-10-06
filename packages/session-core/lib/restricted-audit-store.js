"use strict";

const { randomUUID } = require("node:crypto");
const {
  projectAuditMetadata,
  projectAuditField,
  validateRetentionDays,
  AUDIT_POLICY_VERSION,
} = require("./audit-data-policy");

/** SQLite diagnostics, separate from ordinary audit query/export. Authorization
 * is supplied by the trusted host and rechecked on every operation. No renderer
 * boolean, stored permission, or previous write grants a subsequent read. */
class RestrictedAuditStore {
  constructor(db, { authorize, retentionDays = 1, now = Date.now } = {}) {
    this.db = db;
    this.authorize = authorize;
    this.retentionDays = validateRetentionDays(retentionDays, 7);
    this.now = now;
  }

  async requirePermission(action, context, resource = null) {
    let allowed = false;
    try {
      allowed =
        typeof this.authorize === "function" &&
        (await this.authorize({
          permission: `audit.diagnostics.${action}`,
          context,
          resource,
        })) === true;
    } catch {
      /* Host errors must not leak credentials in denial messages. */
    }
    if (!allowed) {
      throw Object.assign(
        new Error("Restricted audit diagnostics access denied"),
        { code: "AUDIT_DIAGNOSTICS_DENIED" },
      );
    }
  }

  ensureTable() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS restricted_audit_diagnostics (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, metadata TEXT NOT NULL,
      policy_version TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_restricted_audit_expiry ON restricted_audit_diagnostics(expires_at)`);
  }

  purgeExpired() {
    this.ensureTable();
    return this.db
      .prepare("DELETE FROM restricted_audit_diagnostics WHERE expires_at <= ?")
      .run(this.now()).changes;
  }

  async capture(eventId, details, context) {
    const safeEventId = projectAuditField("eventId", eventId);
    if (typeof eventId !== "string" || safeEventId !== eventId) {
      throw Object.assign(new Error("Invalid audit event ID"), {
        code: "AUDIT_EVENT_ID_INVALID",
      });
    }
    await this.requirePermission("write", context, { eventId });
    this.purgeExpired();
    const id = randomUUID();
    const createdAt = this.now();
    const expiresAt = createdAt + this.retentionDays * 86400000;
    this.db
      .prepare(
        `INSERT INTO restricted_audit_diagnostics
      (id, event_id, metadata, policy_version, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        eventId,
        JSON.stringify(projectAuditMetadata(details) ?? null),
        AUDIT_POLICY_VERSION,
        createdAt,
        expiresAt,
      );
    return {
      id,
      eventId,
      createdAt,
      expiresAt,
      policyVersion: AUDIT_POLICY_VERSION,
    };
  }

  async read(id, context) {
    // Denied callers cannot probe existence or cause database mutations.
    await this.requirePermission("read", context, { id });
    this.purgeExpired();
    const row = this.db
      .prepare(
        "SELECT * FROM restricted_audit_diagnostics WHERE id = ? AND expires_at > ?",
      )
      .get(id, this.now());
    if (!row) return null;
    await this.requirePermission("read", context, {
      id: row.id,
      eventId: row.event_id,
    });
    if (row.expires_at <= this.now()) {
      this.purgeExpired();
      return null;
    }
    let metadata;
    try {
      metadata = projectAuditMetadata(JSON.parse(row.metadata));
    } catch {
      metadata = null;
    }
    return {
      id: row.id,
      eventId: row.event_id,
      metadata,
      policyVersion: row.policy_version,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
}

module.exports = { RestrictedAuditStore };
