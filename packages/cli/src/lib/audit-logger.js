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

/* ═══════════════════════════════════════════════════════════════
   V2 SURFACE (Phase 11 canonical) — strictly additive
   ═══════════════════════════════════════════════════════════════ */

export const LOG_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  PURGED: "purged",
});

export const INTEGRITY_STATUS_V2 = Object.freeze({
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
  CORRUPTED: "corrupted",
});

export const ALERT_STATUS_V2 = Object.freeze({
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  DISMISSED: "dismissed",
});

export const EVENT_TYPES_V2 = Object.freeze([
  "auth",
  "permission",
  "data",
  "system",
  "file",
  "did",
  "crypto",
  "api",
]);

export const RISK_LEVELS_V2 = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

export const AUDIT_DEFAULT_MAX_ALERTS_PER_ACTOR = 10;
export const AUDIT_DEFAULT_ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AUDIT_DEFAULT_PURGE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 365 days

let _maxAlertsPerActor = AUDIT_DEFAULT_MAX_ALERTS_PER_ACTOR;
let _archiveRetentionMs = AUDIT_DEFAULT_ARCHIVE_RETENTION_MS;
let _purgeRetentionMs = AUDIT_DEFAULT_PURGE_RETENTION_MS;

const _logStatesV2 = new Map();
const _alertStatesV2 = new Map();
let _lastChainHash = null;

const LOG_TRANSITIONS_V2 = new Map([
  ["active", new Set(["archived", "purged"])],
  ["archived", new Set(["purged"])],
]);
const LOG_TERMINALS_V2 = new Set(["purged"]);

const ALERT_TRANSITIONS_V2 = new Map([
  ["open", new Set(["acknowledged", "dismissed"])],
  ["acknowledged", new Set(["resolved", "dismissed"])],
]);
const ALERT_TERMINALS_V2 = new Set(["resolved", "dismissed"]);

function _positiveInt(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(v);
}

export function setMaxAlertsPerActor(n) {
  _maxAlertsPerActor = _positiveInt(n, "maxAlertsPerActor");
  return _maxAlertsPerActor;
}

export function setArchiveRetentionMs(ms) {
  _archiveRetentionMs = _positiveInt(ms, "archiveRetentionMs");
  return _archiveRetentionMs;
}

export function setPurgeRetentionMs(ms) {
  _purgeRetentionMs = _positiveInt(ms, "purgeRetentionMs");
  return _purgeRetentionMs;
}

export function getMaxAlertsPerActor() {
  return _maxAlertsPerActor;
}

export function getArchiveRetentionMs() {
  return _archiveRetentionMs;
}

export function getPurgeRetentionMs() {
  return _purgeRetentionMs;
}

export function getOpenAlertCount(actor) {
  let count = 0;
  for (const entry of _alertStatesV2.values()) {
    if (entry.status === ALERT_STATUS_V2.OPEN) {
      if (!actor || entry.actor === actor) count += 1;
    }
  }
  return count;
}

function _hashChainEntry(prevHash, entry) {
  const payload = JSON.stringify({
    logId: entry.logId,
    eventType: entry.eventType,
    operation: entry.operation,
    actor: entry.actor,
    riskLevel: entry.riskLevel,
    createdAt: entry.createdAt,
    prev: prevHash || "",
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/* ── Log V2 (hash-chained) ──────────────────────────────────── */

export function logEventV2(
  db,
  {
    logId,
    eventType,
    operation,
    actor,
    target,
    details,
    riskLevel,
    ipAddress,
    userAgent,
    success,
    errorMessage,
  } = {},
) {
  if (!logId) throw new Error("logId is required");
  if (!operation) throw new Error("operation is required");
  if (!eventType) throw new Error("eventType is required");
  if (!EVENT_TYPES_V2.includes(eventType)) {
    throw new Error(`Invalid eventType: ${eventType}`);
  }
  if (_logStatesV2.has(logId)) {
    throw new Error(`Log already registered: ${logId}`);
  }
  const risk = riskLevel || assessRisk(eventType, operation, details);
  if (!RISK_LEVELS_V2.includes(risk)) {
    throw new Error(`Invalid riskLevel: ${risk}`);
  }
  const now = Date.now();
  const entry = {
    logId,
    eventType,
    operation,
    actor: actor || null,
    target: target || null,
    details: sanitizeDetails(details) || null,
    riskLevel: risk,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    success: success !== false,
    errorMessage: errorMessage || null,
    status: LOG_STATUS_V2.ACTIVE,
    integrityStatus: INTEGRITY_STATUS_V2.UNVERIFIED,
    prevHash: _lastChainHash,
    hash: null,
    createdAt: now,
    updatedAt: now,
  };
  entry.hash = _hashChainEntry(_lastChainHash, entry);
  _lastChainHash = entry.hash;
  _logStatesV2.set(logId, entry);

  // Auto-create alert on critical events
  if (risk === "critical" && actor) {
    const openCount = getOpenAlertCount(actor);
    if (openCount < _maxAlertsPerActor) {
      const alertId = `alert-${logId}`;
      _alertStatesV2.set(alertId, {
        alertId,
        logId,
        actor,
        operation,
        riskLevel: risk,
        status: ALERT_STATUS_V2.OPEN,
        reason: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return { ...entry };
}

export function getLogStatusV2(logId) {
  const entry = _logStatesV2.get(logId);
  return entry ? { ...entry } : null;
}

export function setLogStatusV2(db, logId, newStatus, patch = {}) {
  const entry = _logStatesV2.get(logId);
  if (!entry) throw new Error(`Log not found: ${logId}`);
  if (!Object.values(LOG_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid log status: ${newStatus}`);
  }
  if (LOG_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Log is terminal: ${entry.status}`);
  }
  const allowed = LOG_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  return { ...entry };
}

export function verifyChainV2() {
  const results = [];
  let prevHash = null;
  const entries = [..._logStatesV2.values()].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  for (const entry of entries) {
    const expected = _hashChainEntry(prevHash, entry);
    const valid = expected === entry.hash && entry.prevHash === prevHash;
    entry.integrityStatus = valid
      ? INTEGRITY_STATUS_V2.VERIFIED
      : INTEGRITY_STATUS_V2.CORRUPTED;
    results.push({
      logId: entry.logId,
      valid,
      integrityStatus: entry.integrityStatus,
    });
    prevHash = entry.hash;
  }
  return results;
}

export function autoArchiveLogs(db, nowMs = Date.now()) {
  const archived = [];
  for (const entry of _logStatesV2.values()) {
    if (entry.status !== LOG_STATUS_V2.ACTIVE) continue;
    if (nowMs - entry.createdAt > _archiveRetentionMs) {
      entry.status = LOG_STATUS_V2.ARCHIVED;
      entry.updatedAt = nowMs;
      archived.push({ ...entry });
    }
  }
  return archived;
}

export function autoPurgeLogs(db, nowMs = Date.now()) {
  const purged = [];
  for (const entry of _logStatesV2.values()) {
    if (entry.status !== LOG_STATUS_V2.ARCHIVED) continue;
    if (nowMs - entry.createdAt > _purgeRetentionMs) {
      entry.status = LOG_STATUS_V2.PURGED;
      entry.updatedAt = nowMs;
      purged.push({ ...entry });
    }
  }
  return purged;
}

/* ── Alert V2 ───────────────────────────────────────────────── */

export function getAlertStatusV2(alertId) {
  const entry = _alertStatesV2.get(alertId);
  return entry ? { ...entry } : null;
}

export function setAlertStatusV2(db, alertId, newStatus, patch = {}) {
  const entry = _alertStatesV2.get(alertId);
  if (!entry) throw new Error(`Alert not found: ${alertId}`);
  if (!Object.values(ALERT_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid alert status: ${newStatus}`);
  }
  if (ALERT_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Alert is terminal: ${entry.status}`);
  }
  const allowed = ALERT_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function acknowledgeAlert(db, alertId, reason) {
  return setAlertStatusV2(db, alertId, ALERT_STATUS_V2.ACKNOWLEDGED, {
    reason,
  });
}

export function resolveAlert(db, alertId, reason) {
  return setAlertStatusV2(db, alertId, ALERT_STATUS_V2.RESOLVED, { reason });
}

export function dismissAlert(db, alertId, reason) {
  return setAlertStatusV2(db, alertId, ALERT_STATUS_V2.DISMISSED, { reason });
}

/* ── Stats V2 ───────────────────────────────────────────────── */

export function getAuditStatsV2() {
  const logsByStatus = { active: 0, archived: 0, purged: 0 };
  const logsByRisk = { low: 0, medium: 0, high: 0, critical: 0 };
  const logsByIntegrity = { unverified: 0, verified: 0, corrupted: 0 };
  const logsByEventType = {
    auth: 0,
    permission: 0,
    data: 0,
    system: 0,
    file: 0,
    did: 0,
    crypto: 0,
    api: 0,
  };
  const alertsByStatus = {
    open: 0,
    acknowledged: 0,
    resolved: 0,
    dismissed: 0,
  };

  for (const entry of _logStatesV2.values()) {
    if (logsByStatus[entry.status] !== undefined)
      logsByStatus[entry.status] += 1;
    if (logsByRisk[entry.riskLevel] !== undefined)
      logsByRisk[entry.riskLevel] += 1;
    if (logsByIntegrity[entry.integrityStatus] !== undefined)
      logsByIntegrity[entry.integrityStatus] += 1;
    if (logsByEventType[entry.eventType] !== undefined)
      logsByEventType[entry.eventType] += 1;
  }
  for (const entry of _alertStatesV2.values()) {
    if (alertsByStatus[entry.status] !== undefined)
      alertsByStatus[entry.status] += 1;
  }

  return {
    totalLogs: _logStatesV2.size,
    totalAlerts: _alertStatesV2.size,
    activeAlerts: alertsByStatus.open,
    maxAlertsPerActor: _maxAlertsPerActor,
    archiveRetentionMs: _archiveRetentionMs,
    purgeRetentionMs: _purgeRetentionMs,
    lastChainHash: _lastChainHash,
    logsByStatus,
    logsByRisk,
    logsByIntegrity,
    logsByEventType,
    alertsByStatus,
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetStateV2() {
  _logStatesV2.clear();
  _alertStatesV2.clear();
  _lastChainHash = null;
  _maxAlertsPerActor = AUDIT_DEFAULT_MAX_ALERTS_PER_ACTOR;
  _archiveRetentionMs = AUDIT_DEFAULT_ARCHIVE_RETENTION_MS;
  _purgeRetentionMs = AUDIT_DEFAULT_PURGE_RETENTION_MS;
}
