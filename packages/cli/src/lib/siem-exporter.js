/**
 * SIEM Exporter — log export to external SIEM targets
 * (Splunk HEC, Elasticsearch, Azure Sentinel) in JSON/CEF/LEEF formats.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _targets = new Map();
const _exports = [];

const SIEM_FORMATS = { JSON: "json", CEF: "cef", LEEF: "leef" };
const SIEM_TARGETS = {
  SPLUNK_HEC: "splunk_hec",
  ELASTICSEARCH: "elasticsearch",
  AZURE_SENTINEL: "azure_sentinel",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureSIEMTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS siem_exports (
      id TEXT PRIMARY KEY,
      target_type TEXT,
      target_url TEXT,
      format TEXT DEFAULT 'json',
      last_exported_log_id TEXT,
      exported_count INTEGER DEFAULT 0,
      last_export_at TEXT,
      status TEXT DEFAULT 'active',
      config TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Target Management ────────────────────────────────────── */

export function listTargets() {
  return [..._targets.values()];
}

export function addTarget(db, type, url, format, config) {
  if (!type) throw new Error("Target type is required");
  if (!url) throw new Error("Target URL is required");

  const validTypes = Object.values(SIEM_TARGETS);
  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid target type: ${type}. Valid: ${validTypes.join(", ")}`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const target = {
    id,
    type,
    url,
    format: format || SIEM_FORMATS.JSON,
    exportedCount: 0,
    lastExportAt: null,
    lastExportedLogId: null,
    status: "active",
    config: config || {},
    createdAt: now,
  };

  _targets.set(id, target);

  db.prepare(
    `INSERT INTO siem_exports (id, target_type, target_url, format, last_exported_log_id, exported_count, last_export_at, status, config, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    type,
    url,
    target.format,
    null,
    0,
    null,
    "active",
    JSON.stringify(target.config),
    now,
  );

  return target;
}

/* ── Log Export ────────────────────────────────────────────── */

export function exportLogs(db, targetId, logs) {
  const target = _targets.get(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);

  const items = logs || [];
  const now = new Date().toISOString();
  const exported = items.length;

  target.exportedCount += exported;
  target.lastExportAt = now;
  if (items.length > 0) {
    target.lastExportedLogId =
      items[items.length - 1].id || `log-${Date.now()}`;
  }

  _exports.push({ targetId, exported, timestamp: now });

  db.prepare(
    `UPDATE siem_exports SET exported_count = ?, last_export_at = ?, last_exported_log_id = ? WHERE id = ?`,
  ).run(target.exportedCount, now, target.lastExportedLogId, targetId);

  return { exported, lastId: target.lastExportedLogId };
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getSIEMStats() {
  return [..._targets.values()].map((t) => ({
    id: t.id,
    type: t.type,
    url: t.url,
    format: t.format,
    exportedCount: t.exportedCount,
    lastExportAt: t.lastExportAt,
    status: t.status,
  }));
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _targets.clear();
  _exports.length = 0;
}

// ═══════════════════════════════════════════════════════════════
// V2 Canonical Surface (Phase 51)
// ═══════════════════════════════════════════════════════════════

export const SIEM_FORMAT = Object.freeze({
  JSON: "json",
  CEF: "cef",
  LEEF: "leef",
});

export const SIEM_TARGET_TYPE = Object.freeze({
  SPLUNK_HEC: "splunk_hec",
  ELASTICSEARCH: "elasticsearch",
  AZURE_SENTINEL: "azure_sentinel",
});

export const SIEM_SEVERITY = Object.freeze({
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  CRITICAL: "critical",
  FATAL: "fatal",
});

export const SIEM_TARGET_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  DISABLED: "disabled",
  ERROR: "error",
});

export const SIEM_DEFAULT_BATCH_SIZE = 100;

// Design §二 severity-to-CEF table (0-10 scale, per ArcSight spec).
const _severityCEF = Object.freeze({
  debug: 1,
  info: 3,
  warn: 5,
  error: 7,
  critical: 9,
  fatal: 10,
});

const _allowedTargetTransitions = new Map([
  ["active", new Set(["paused", "disabled", "error"])],
  ["paused", new Set(["active", "disabled", "error"])],
  ["disabled", new Set(["active", "error"])],
  ["error", new Set(["active", "paused", "disabled"])],
]);

function _validateFormat(format) {
  if (!Object.values(SIEM_FORMAT).includes(format)) {
    throw new Error(
      `Invalid format: ${format}. Expected one of ${Object.values(SIEM_FORMAT).join("|")}`,
    );
  }
}

function _validateTargetType(type) {
  if (!Object.values(SIEM_TARGET_TYPE).includes(type)) {
    throw new Error(
      `Invalid target type: ${type}. Expected one of ${Object.values(SIEM_TARGET_TYPE).join("|")}`,
    );
  }
}

function _validateSeverity(severity) {
  if (!Object.values(SIEM_SEVERITY).includes(severity)) {
    throw new Error(
      `Invalid severity: ${severity}. Expected one of ${Object.values(SIEM_SEVERITY).join("|")}`,
    );
  }
}

function _validateStatus(status) {
  if (!Object.values(SIEM_TARGET_STATUS).includes(status)) {
    throw new Error(
      `Invalid status: ${status}. Expected one of ${Object.values(SIEM_TARGET_STATUS).join("|")}`,
    );
  }
}

/**
 * Map a SIEM_SEVERITY value to a CEF severity integer (0-10).
 */
export function severityToCEF(severity) {
  const key = (severity || "").toLowerCase();
  const n = _severityCEF[key];
  if (n === undefined) {
    throw new Error(`Unknown severity: ${severity}`);
  }
  return n;
}

// CEF extension-value escape (| \ = → escaped).
function _escapeCEFExt(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/=/g, "\\=")
    .replace(/\r?\n/g, "\\n");
}

function _flatExtensions(log) {
  const pairs = [];
  const md = log.metadata || {};
  for (const [k, v] of Object.entries(md)) {
    pairs.push(`${k}=${_escapeCEFExt(v)}`);
  }
  if (log.userId != null) pairs.push(`suser=${_escapeCEFExt(log.userId)}`);
  if (log.ip != null) pairs.push(`src=${_escapeCEFExt(log.ip)}`);
  if (log.message != null) pairs.push(`msg=${_escapeCEFExt(log.message)}`);
  if (log.timestamp != null) pairs.push(`rt=${_escapeCEFExt(log.timestamp)}`);
  return pairs;
}

/**
 * Format a log record as CEF (ArcSight).
 * CEF:0|Vendor|Product|Version|{eventId}|{eventName}|{severity}|{extensions}
 */
export function formatLogCEF(log, opts = {}) {
  const vendor = opts.vendor || "ChainlessChain";
  const product = opts.product || "CLI";
  const version = opts.version || "1.0.0";
  const eventId = log.eventId || log.id || "unknown";
  const eventName = log.eventName || log.message || "event";
  const severity = severityToCEF(log.severity || "info");
  const pipeEscape = (s) => String(s).replace(/\|/g, "\\|");
  const extensions = _flatExtensions(log).join(" ");
  return `CEF:0|${pipeEscape(vendor)}|${pipeEscape(product)}|${pipeEscape(version)}|${pipeEscape(eventId)}|${pipeEscape(eventName)}|${severity}|${extensions}`;
}

/**
 * Format a log record as LEEF 2.0 (IBM QRadar).
 * LEEF:2.0|Vendor|Product|Version|{eventId}|<tab-separated key=value>
 */
export function formatLogLEEF(log, opts = {}) {
  const vendor = opts.vendor || "ChainlessChain";
  const product = opts.product || "CLI";
  const version = opts.version || "1.0.0";
  const eventId = log.eventId || log.id || "unknown";
  const pipeEscape = (s) => String(s).replace(/\|/g, "\\|");
  const pairs = [];
  if (log.timestamp != null) pairs.push(`devTime=${log.timestamp}`);
  if (log.userId != null) pairs.push(`usrName=${log.userId}`);
  if (log.action != null) pairs.push(`action=${log.action}`);
  if (log.ip != null) pairs.push(`src=${log.ip}`);
  if (log.message != null) pairs.push(`msg=${log.message}`);
  const md = log.metadata || {};
  for (const [k, v] of Object.entries(md)) {
    pairs.push(`${k}=${v}`);
  }
  return `LEEF:2.0|${pipeEscape(vendor)}|${pipeEscape(product)}|${pipeEscape(version)}|${pipeEscape(eventId)}|${pairs.join("\t")}`;
}

/**
 * Format a log record as the canonical JSON envelope (Phase 51 §二).
 */
export function formatLogJSON(log) {
  return {
    timestamp: log.timestamp || Date.now(),
    severity: (log.severity || "info").toUpperCase(),
    source: log.source || "chainlesschain-cli",
    message: log.message || "",
    metadata: {
      ...(log.metadata || {}),
      eventId: log.eventId || log.id || null,
      userId: log.userId || null,
      action: log.action || null,
      resource: log.resource || null,
      ip: log.ip || null,
    },
  };
}

/**
 * Dispatch by format. Returns string for CEF/LEEF, object for JSON.
 */
export function formatLog(format, log, opts) {
  _validateFormat(format);
  if (format === SIEM_FORMAT.CEF) return formatLogCEF(log, opts);
  if (format === SIEM_FORMAT.LEEF) return formatLogLEEF(log, opts);
  return formatLogJSON(log);
}

/**
 * Add a SIEM target with V2 canonical validation.
 */
export function addTargetV2(db, options) {
  if (!options || typeof options !== "object") {
    throw new Error("options object is required");
  }
  const { type, url, format = SIEM_FORMAT.JSON, config = {} } = options;
  _validateTargetType(type);
  if (!url) throw new Error("Target URL is required");
  _validateFormat(format);
  return addTarget(db, type, url, format, config);
}

/**
 * Remove a target by id. Throws if unknown.
 */
export function removeTarget(db, targetId) {
  const target = _targets.get(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);
  _targets.delete(targetId);
  db.prepare(`DELETE FROM siem_exports WHERE id = ?`).run(targetId);
  return { success: true, targetId };
}

/**
 * Transition a target's status using the allowed state machine.
 * active ↔ paused/disabled/error; disabled → active/error; error → any.
 */
export function setTargetStatus(db, targetId, newStatus) {
  const target = _targets.get(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);
  _validateStatus(newStatus);
  if (target.status === newStatus) {
    return { ...target };
  }
  const allowed = _allowedTargetTransitions.get(target.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(
      `Invalid status transition: ${target.status} → ${newStatus}`,
    );
  }
  target.status = newStatus;
  db.prepare(`UPDATE siem_exports SET status = ? WHERE id = ?`).run(
    newStatus,
    targetId,
  );
  return { ...target };
}

/**
 * Batch-export logs to a target.
 * - Skips when target.status !== "active" (returns { skipped: true, ... }).
 * - Chunks logs into slices of batchSize (default 100).
 * - Returns { batches, exported, skipped, lastId }.
 */
export function exportLogsV2(db, options) {
  if (!options || typeof options !== "object") {
    throw new Error("options object is required");
  }
  const { targetId, logs = [], batchSize = SIEM_DEFAULT_BATCH_SIZE } = options;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }
  const target = _targets.get(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);
  if (target.status !== SIEM_TARGET_STATUS.ACTIVE) {
    return {
      skipped: true,
      reason: `target status is ${target.status}`,
      batches: 0,
      exported: 0,
      lastId: target.lastExportedLogId,
    };
  }
  if (!Array.isArray(logs)) {
    throw new Error("logs must be an array");
  }

  let batches = 0;
  let exported = 0;
  for (let i = 0; i < logs.length; i += batchSize) {
    const slice = logs.slice(i, i + batchSize);
    exportLogs(db, targetId, slice);
    batches += 1;
    exported += slice.length;
  }
  // Handle zero-length input — register one empty batch for stats parity.
  if (logs.length === 0) {
    exportLogs(db, targetId, []);
    batches = 0; // no real batch was sent
  }
  return {
    skipped: false,
    batches,
    exported,
    lastId: target.lastExportedLogId,
  };
}

/**
 * Extended stats with byFormat / byType / byStatus breakdowns + totals.
 */
export function getSIEMStatsV2() {
  const targets = [..._targets.values()];
  const byFormat = {};
  for (const v of Object.values(SIEM_FORMAT)) byFormat[v] = 0;
  const byType = {};
  for (const v of Object.values(SIEM_TARGET_TYPE)) byType[v] = 0;
  const byStatus = {};
  for (const v of Object.values(SIEM_TARGET_STATUS)) byStatus[v] = 0;
  let totalExported = 0;
  for (const t of targets) {
    if (byFormat[t.format] !== undefined) byFormat[t.format] += 1;
    if (byType[t.type] !== undefined) byType[t.type] += 1;
    if (byStatus[t.status] !== undefined) byStatus[t.status] += 1;
    totalExported += t.exportedCount || 0;
  }
  return {
    totalTargets: targets.length,
    totalExported,
    totalBatches: _exports.length,
    byFormat,
    byType,
    byStatus,
    targets: targets.map((t) => ({
      id: t.id,
      type: t.type,
      url: t.url,
      format: t.format,
      status: t.status,
      exportedCount: t.exportedCount,
      lastExportAt: t.lastExportAt,
    })),
  };
}

/**
 * List targets filtered by status.
 */
export function listTargetsByStatus(status) {
  _validateStatus(status);
  return [..._targets.values()].filter((t) => t.status === status);
}

export { _severityCEF, _allowedTargetTransitions };

// ===== V2 Surface: SIEM Exporter governance overlay (CLI v0.138.0) =====
export const SIEM_TARGET_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});
export const SIEM_EXPORT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _siemTargetTrans = new Map([
  [
    SIEM_TARGET_MATURITY_V2.PENDING,
    new Set([SIEM_TARGET_MATURITY_V2.ACTIVE, SIEM_TARGET_MATURITY_V2.RETIRED]),
  ],
  [
    SIEM_TARGET_MATURITY_V2.ACTIVE,
    new Set([
      SIEM_TARGET_MATURITY_V2.DEGRADED,
      SIEM_TARGET_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    SIEM_TARGET_MATURITY_V2.DEGRADED,
    new Set([SIEM_TARGET_MATURITY_V2.ACTIVE, SIEM_TARGET_MATURITY_V2.RETIRED]),
  ],
  [SIEM_TARGET_MATURITY_V2.RETIRED, new Set()],
]);
const _siemTargetTerminal = new Set([SIEM_TARGET_MATURITY_V2.RETIRED]);
const _siemExportTrans = new Map([
  [
    SIEM_EXPORT_LIFECYCLE_V2.QUEUED,
    new Set([
      SIEM_EXPORT_LIFECYCLE_V2.SENDING,
      SIEM_EXPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SIEM_EXPORT_LIFECYCLE_V2.SENDING,
    new Set([
      SIEM_EXPORT_LIFECYCLE_V2.DELIVERED,
      SIEM_EXPORT_LIFECYCLE_V2.FAILED,
      SIEM_EXPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SIEM_EXPORT_LIFECYCLE_V2.DELIVERED, new Set()],
  [SIEM_EXPORT_LIFECYCLE_V2.FAILED, new Set()],
  [SIEM_EXPORT_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _siemTargets = new Map();
const _siemExportJobs = new Map();
let _siemMaxActivePerOperator = 8;
let _siemMaxPendingExportsPerTarget = 50;
let _siemTargetIdleMs = 24 * 60 * 60 * 1000;
let _siemExportStuckMs = 5 * 60 * 1000;

function _siemPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveSiemTargetsPerOperatorV2(n) {
  _siemMaxActivePerOperator = _siemPos(n, "maxActiveSiemTargetsPerOperator");
}
export function getMaxActiveSiemTargetsPerOperatorV2() {
  return _siemMaxActivePerOperator;
}
export function setMaxPendingSiemExportsPerTargetV2(n) {
  _siemMaxPendingExportsPerTarget = _siemPos(
    n,
    "maxPendingSiemExportsPerTarget",
  );
}
export function getMaxPendingSiemExportsPerTargetV2() {
  return _siemMaxPendingExportsPerTarget;
}
export function setSiemTargetIdleMsV2(n) {
  _siemTargetIdleMs = _siemPos(n, "siemTargetIdleMs");
}
export function getSiemTargetIdleMsV2() {
  return _siemTargetIdleMs;
}
export function setSiemExportStuckMsV2(n) {
  _siemExportStuckMs = _siemPos(n, "siemExportStuckMs");
}
export function getSiemExportStuckMsV2() {
  return _siemExportStuckMs;
}

export function _resetStateSiemExporterV2() {
  _siemTargets.clear();
  _siemExportJobs.clear();
  _siemMaxActivePerOperator = 8;
  _siemMaxPendingExportsPerTarget = 50;
  _siemTargetIdleMs = 24 * 60 * 60 * 1000;
  _siemExportStuckMs = 5 * 60 * 1000;
}

export function registerSiemTargetV2({ id, operator, kind, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!operator || typeof operator !== "string")
    throw new Error("operator is required");
  if (_siemTargets.has(id))
    throw new Error(`siem target ${id} already registered`);
  const now = Date.now();
  const t = {
    id,
    operator,
    kind: kind || "splunk_hec",
    status: SIEM_TARGET_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _siemTargets.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
function _siemCheckT(from, to) {
  const a = _siemTargetTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid siem target transition ${from} → ${to}`);
}
function _siemCountActive(operator) {
  let n = 0;
  for (const t of _siemTargets.values())
    if (t.operator === operator && t.status === SIEM_TARGET_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateSiemTargetV2(id) {
  const t = _siemTargets.get(id);
  if (!t) throw new Error(`siem target ${id} not found`);
  _siemCheckT(t.status, SIEM_TARGET_MATURITY_V2.ACTIVE);
  const recovery = t.status === SIEM_TARGET_MATURITY_V2.DEGRADED;
  if (!recovery) {
    const c = _siemCountActive(t.operator);
    if (c >= _siemMaxActivePerOperator)
      throw new Error(
        `max active siem targets per operator (${_siemMaxActivePerOperator}) reached for ${t.operator}`,
      );
  }
  const now = Date.now();
  t.status = SIEM_TARGET_MATURITY_V2.ACTIVE;
  t.updatedAt = now;
  t.lastTouchedAt = now;
  if (!t.activatedAt) t.activatedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function degradeSiemTargetV2(id) {
  const t = _siemTargets.get(id);
  if (!t) throw new Error(`siem target ${id} not found`);
  _siemCheckT(t.status, SIEM_TARGET_MATURITY_V2.DEGRADED);
  t.status = SIEM_TARGET_MATURITY_V2.DEGRADED;
  t.updatedAt = Date.now();
  return { ...t, metadata: { ...t.metadata } };
}
export function retireSiemTargetV2(id) {
  const t = _siemTargets.get(id);
  if (!t) throw new Error(`siem target ${id} not found`);
  _siemCheckT(t.status, SIEM_TARGET_MATURITY_V2.RETIRED);
  const now = Date.now();
  t.status = SIEM_TARGET_MATURITY_V2.RETIRED;
  t.updatedAt = now;
  if (!t.retiredAt) t.retiredAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function touchSiemTargetV2(id) {
  const t = _siemTargets.get(id);
  if (!t) throw new Error(`siem target ${id} not found`);
  if (_siemTargetTerminal.has(t.status))
    throw new Error(`cannot touch terminal siem target ${id}`);
  const now = Date.now();
  t.lastTouchedAt = now;
  t.updatedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function getSiemTargetV2(id) {
  const t = _siemTargets.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listSiemTargetsV2() {
  return [..._siemTargets.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}

function _siemCountPendingExports(tid) {
  let n = 0;
  for (const e of _siemExportJobs.values())
    if (
      e.targetId === tid &&
      (e.status === SIEM_EXPORT_LIFECYCLE_V2.QUEUED ||
        e.status === SIEM_EXPORT_LIFECYCLE_V2.SENDING)
    )
      n++;
  return n;
}

export function createSiemExportV2({ id, targetId, format, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!targetId || typeof targetId !== "string")
    throw new Error("targetId is required");
  if (_siemExportJobs.has(id))
    throw new Error(`siem export ${id} already exists`);
  if (!_siemTargets.has(targetId))
    throw new Error(`siem target ${targetId} not found`);
  const pending = _siemCountPendingExports(targetId);
  if (pending >= _siemMaxPendingExportsPerTarget)
    throw new Error(
      `max pending siem exports per target (${_siemMaxPendingExportsPerTarget}) reached for ${targetId}`,
    );
  const now = Date.now();
  const e = {
    id,
    targetId,
    format: format || "json",
    status: SIEM_EXPORT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _siemExportJobs.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}
function _siemCheckE(from, to) {
  const a = _siemExportTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid siem export transition ${from} → ${to}`);
}
export function startSiemExportV2(id) {
  const e = _siemExportJobs.get(id);
  if (!e) throw new Error(`siem export ${id} not found`);
  _siemCheckE(e.status, SIEM_EXPORT_LIFECYCLE_V2.SENDING);
  const now = Date.now();
  e.status = SIEM_EXPORT_LIFECYCLE_V2.SENDING;
  e.updatedAt = now;
  if (!e.startedAt) e.startedAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function deliverSiemExportV2(id) {
  const e = _siemExportJobs.get(id);
  if (!e) throw new Error(`siem export ${id} not found`);
  _siemCheckE(e.status, SIEM_EXPORT_LIFECYCLE_V2.DELIVERED);
  const now = Date.now();
  e.status = SIEM_EXPORT_LIFECYCLE_V2.DELIVERED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function failSiemExportV2(id, reason) {
  const e = _siemExportJobs.get(id);
  if (!e) throw new Error(`siem export ${id} not found`);
  _siemCheckE(e.status, SIEM_EXPORT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  e.status = SIEM_EXPORT_LIFECYCLE_V2.FAILED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.failReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function cancelSiemExportV2(id, reason) {
  const e = _siemExportJobs.get(id);
  if (!e) throw new Error(`siem export ${id} not found`);
  _siemCheckE(e.status, SIEM_EXPORT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  e.status = SIEM_EXPORT_LIFECYCLE_V2.CANCELLED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.cancelReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function getSiemExportV2(id) {
  const e = _siemExportJobs.get(id);
  if (!e) return null;
  return { ...e, metadata: { ...e.metadata } };
}
export function listSiemExportsV2() {
  return [..._siemExportJobs.values()].map((e) => ({
    ...e,
    metadata: { ...e.metadata },
  }));
}

export function autoDegradeIdleSiemTargetsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const tgt of _siemTargets.values())
    if (
      tgt.status === SIEM_TARGET_MATURITY_V2.ACTIVE &&
      t - tgt.lastTouchedAt >= _siemTargetIdleMs
    ) {
      tgt.status = SIEM_TARGET_MATURITY_V2.DEGRADED;
      tgt.updatedAt = t;
      flipped.push(tgt.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSiemExportsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const e of _siemExportJobs.values())
    if (
      e.status === SIEM_EXPORT_LIFECYCLE_V2.SENDING &&
      e.startedAt != null &&
      t - e.startedAt >= _siemExportStuckMs
    ) {
      e.status = SIEM_EXPORT_LIFECYCLE_V2.FAILED;
      e.updatedAt = t;
      if (!e.settledAt) e.settledAt = t;
      e.metadata.failReason = "auto-fail-stuck";
      flipped.push(e.id);
    }
  return { flipped, count: flipped.length };
}

export function getSiemExporterGovStatsV2() {
  const targetsByStatus = {};
  for (const s of Object.values(SIEM_TARGET_MATURITY_V2))
    targetsByStatus[s] = 0;
  for (const t of _siemTargets.values()) targetsByStatus[t.status]++;
  const exportsByStatus = {};
  for (const s of Object.values(SIEM_EXPORT_LIFECYCLE_V2))
    exportsByStatus[s] = 0;
  for (const e of _siemExportJobs.values()) exportsByStatus[e.status]++;
  return {
    totalSiemTargetsV2: _siemTargets.size,
    totalSiemExportsV2: _siemExportJobs.size,
    maxActiveSiemTargetsPerOperator: _siemMaxActivePerOperator,
    maxPendingSiemExportsPerTarget: _siemMaxPendingExportsPerTarget,
    siemTargetIdleMs: _siemTargetIdleMs,
    siemExportStuckMs: _siemExportStuckMs,
    targetsByStatus,
    exportsByStatus,
  };
}
