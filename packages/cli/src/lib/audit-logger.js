/**
 * Audit Logger — records security events and operations for compliance.
 * Provides event logging, querying, statistics, and export.
 */

import crypto from "crypto";

/**
 * Event types for audit logging.
 */
export const EVENT_TYPES = {
  AUTH: "auth",
  PERMISSION: "permission",
  DATA: "data",
  SYSTEM: "system",
  FILE: "file",
  DID: "did",
  CRYPTO: "crypto",
  API: "api",
};

/**
 * Risk levels.
 */
export const RISK_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

/**
 * High-risk operations that trigger elevated risk assessment.
 */
const HIGH_RISK_OPERATIONS = new Set([
  "delete_identity",
  "grant_admin",
  "revoke_all",
  "delete_role",
  "db_encrypt",
  "db_decrypt",
  "config_change",
  "export_secrets",
  "bulk_delete",
  "password_reset",
  "schema_change",
]);

/**
 * Ensure audit tables exist.
 */
export function ensureAuditTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      actor TEXT,
      target TEXT,
      details TEXT,
      risk_level TEXT DEFAULT 'low',
      ip_address TEXT,
      user_agent TEXT,
      success INTEGER DEFAULT 1,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_risk_level ON audit_log(risk_level)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor)
  `);
}

/**
 * Assess risk level for an operation.
 */
export function assessRisk(eventType, operation, details) {
  if (HIGH_RISK_OPERATIONS.has(operation)) {
    return RISK_LEVELS.HIGH;
  }

  if (eventType === EVENT_TYPES.AUTH && operation.includes("fail")) {
    return RISK_LEVELS.MEDIUM;
  }

  if (eventType === EVENT_TYPES.PERMISSION) {
    return RISK_LEVELS.MEDIUM;
  }

  if (details && typeof details === "object") {
    if (details.bulkCount && details.bulkCount > 100) {
      return RISK_LEVELS.HIGH;
    }
  }

  return RISK_LEVELS.LOW;
}

/**
 * Sanitize sensitive data from log details.
 */
export function sanitizeDetails(details) {
  if (!details || typeof details !== "object") return details;

  const sanitized = { ...details };
  const sensitiveKeys = [
    "password",
    "secret",
    "secretKey",
    "secret_key",
    "privateKey",
    "private_key",
    "token",
    "apiKey",
    "api_key",
    "mnemonic",
  ];

  for (const key of sensitiveKeys) {
    if (sanitized[key]) {
      sanitized[key] = "[REDACTED]";
    }
  }

  return sanitized;
}

/**
 * Log an audit event.
 */
export function logEvent(db, event) {
  ensureAuditTables(db);

  const id = crypto.randomUUID();
  const sanitized = sanitizeDetails(event.details);
  const risk =
    event.riskLevel ||
    assessRisk(event.eventType, event.operation, event.details);

  db.prepare(
    `INSERT INTO audit_log (id, event_type, operation, actor, target, details, risk_level, ip_address, user_agent, success, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    event.eventType || EVENT_TYPES.SYSTEM,
    event.operation || "unknown",
    event.actor || null,
    event.target || null,
    sanitized ? JSON.stringify(sanitized) : null,
    risk,
    event.ipAddress || null,
    event.userAgent || null,
    event.success !== false ? 1 : 0,
    event.errorMessage || null,
  );

  return { id, riskLevel: risk, createdAt: new Date().toISOString() };
}

/**
 * Query audit logs with filters.
 */
export function queryLogs(db, filters = {}) {
  ensureAuditTables(db);

  let sql = "SELECT * FROM audit_log WHERE 1=1";
  const params = [];

  if (filters.eventType) {
    sql += " AND event_type = ?";
    params.push(filters.eventType);
  }

  if (filters.operation) {
    sql += " AND operation LIKE ?";
    params.push(`%${filters.operation}%`);
  }

  if (filters.actor) {
    sql += " AND actor LIKE ?";
    params.push(`%${filters.actor}%`);
  }

  if (filters.riskLevel) {
    sql += " AND risk_level = ?";
    params.push(filters.riskLevel);
  }

  if (filters.success !== undefined) {
    sql += " AND success = ?";
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    sql += " AND created_at >= ?";
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    sql += " AND created_at <= ?";
    params.push(filters.endDate);
  }

  if (filters.search) {
    // Search in operation field (primary search field for CLI)
    sql += " AND operation LIKE ?";
    params.push(`%${filters.search}%`);
  }

  sql += " ORDER BY created_at DESC";

  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  if (filters.offset) {
    sql += " OFFSET ?";
    params.push(filters.offset);
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    ...r,
    details: r.details ? JSON.parse(r.details) : null,
    success: r.success === 1,
  }));
}

/**
 * Get audit statistics.
 */
export function getStatistics(db, startDate, endDate) {
  ensureAuditTables(db);

  let dateFilter = "";
  const params = [];

  if (startDate) {
    dateFilter += " AND created_at >= ?";
    params.push(startDate);
  }
  if (endDate) {
    dateFilter += " AND created_at <= ?";
    params.push(endDate);
  }

  const total = db
    .prepare(`SELECT COUNT(*) as c FROM audit_log WHERE 1=1 ${dateFilter}`)
    .get(...params).c;

  const byEventType = db
    .prepare(
      `SELECT event_type, COUNT(*) as count FROM audit_log WHERE 1=1 ${dateFilter} GROUP BY event_type ORDER BY count DESC`,
    )
    .all(...params);

  const byRiskLevel = db
    .prepare(
      `SELECT risk_level, COUNT(*) as count FROM audit_log WHERE 1=1 ${dateFilter} GROUP BY risk_level ORDER BY count DESC`,
    )
    .all(...params);

  const failures = db
    .prepare(
      `SELECT COUNT(*) as c FROM audit_log WHERE success = 0 ${dateFilter}`,
    )
    .get(...params).c;

  const highRiskHigh = db
    .prepare(
      `SELECT COUNT(*) as c FROM audit_log WHERE risk_level = 'high' ${dateFilter}`,
    )
    .get(...params).c;
  const highRiskCritical = db
    .prepare(
      `SELECT COUNT(*) as c FROM audit_log WHERE risk_level = 'critical' ${dateFilter}`,
    )
    .get(...params).c;
  const highRisk = highRiskHigh + highRiskCritical;

  return {
    total,
    failures,
    highRisk,
    byEventType: Object.fromEntries(
      byEventType.map((r) => [r.event_type, r.count]),
    ),
    byRiskLevel: Object.fromEntries(
      byRiskLevel.map((r) => [r.risk_level, r.count]),
    ),
  };
}

/**
 * Export audit logs as JSON or CSV.
 */
export function exportLogs(db, format = "json", filters = {}) {
  const logs = queryLogs(db, { ...filters, limit: filters.limit || 10000 });

  if (format === "csv") {
    const headers = [
      "id",
      "event_type",
      "operation",
      "actor",
      "target",
      "risk_level",
      "success",
      "error_message",
      "created_at",
    ];
    const csvRows = [headers.join(",")];

    for (const log of logs) {
      const row = headers.map((h) => {
        const val = log[h];
        if (val === null || val === undefined) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      });
      csvRows.push(row.join(","));
    }

    return csvRows.join("\n");
  }

  return JSON.stringify(logs, null, 2);
}

/**
 * Delete old audit logs.
 */
export function purgeLogs(db, daysToKeep = 90) {
  ensureAuditTables(db);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString().replace("T", " ").slice(0, 19);

  const result = db
    .prepare("DELETE FROM audit_log WHERE created_at < ?")
    .run(cutoffStr);
  return result.changes;
}

/**
 * Get the most recent audit events.
 */
export function getRecentEvents(db, limit = 20) {
  return queryLogs(db, { limit });
}
