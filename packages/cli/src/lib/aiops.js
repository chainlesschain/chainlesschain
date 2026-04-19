/**
 * Autonomous Ops (AIOps) — CLI port of 25_自治运维系统
 *
 * Desktop uses real-time anomaly detection, auto-remediation playbooks,
 * rollback orchestration, alert escalation chains, and postmortem generation.
 * CLI port ships:
 *
 *   - Anomaly detection (Z-Score / IQR heuristics on metric baselines)
 *   - Incident lifecycle (open → acknowledged → resolved → closed)
 *   - Remediation playbook CRUD (trigger conditions, step lists)
 *   - Metrics baseline tracking (mean/stddev/IQR per metric)
 *   - Simulated postmortem generation
 *
 * What does NOT port: real-time metric streaming, Docker/Git rollback,
 * alert escalation chains, webhook/email/IM notification channels,
 * EWMA algorithm, post-deploy health monitoring.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const SEVERITY = Object.freeze({
  P0: "P0",
  P1: "P1",
  P2: "P2",
  P3: "P3",
});

export const INCIDENT_STATUS = Object.freeze({
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  CLOSED: "closed",
});

export const DETECTION_ALGORITHM = Object.freeze({
  Z_SCORE: "z_score",
  IQR: "iqr",
});

export const ROLLBACK_TYPE = Object.freeze({
  GIT: "git",
  DOCKER: "docker",
  CONFIG: "config",
  SERVICE: "service",
  CUSTOM: "custom",
});

/* ── State ──────────────────────────────────────────────── */

let _incidents = new Map();
let _playbooks = new Map();
let _baselines = new Map();

function _id() {
  return crypto.randomUUID();
}
function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

/* ── Schema ─────────────────────────────────────────────── */

export function ensureAiOpsTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ops_incidents (
    id TEXT PRIMARY KEY,
    anomaly_metric TEXT,
    severity TEXT DEFAULT 'P3',
    status TEXT DEFAULT 'open',
    description TEXT,
    anomaly_data TEXT,
    remediation_id TEXT,
    postmortem TEXT,
    acknowledged_at INTEGER,
    resolved_at INTEGER,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS ops_remediation_playbooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    trigger_condition TEXT,
    steps TEXT,
    enabled INTEGER DEFAULT 1,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS ops_metrics_baseline (
    metric_name TEXT PRIMARY KEY,
    mean REAL DEFAULT 0,
    std_dev REAL DEFAULT 0,
    q1 REAL DEFAULT 0,
    q3 REAL DEFAULT 0,
    sample_count INTEGER DEFAULT 0,
    updated_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _incidents.clear();
  _playbooks.clear();
  _baselines.clear();

  const tables = [
    ["ops_incidents", _incidents, "id"],
    ["ops_remediation_playbooks", _playbooks, "id"],
    ["ops_metrics_baseline", _baselines, "metric_name"],
  ];
  for (const [table, map, key] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r[key], r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Metrics Baseline ───────────────────────────────────── */

export function updateBaseline(db, metricName, values) {
  if (!metricName) return { updated: false, reason: "missing_metric_name" };
  if (!Array.isArray(values) || values.length === 0)
    return { updated: false, reason: "empty_values" };

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean =
    Math.round((sorted.reduce((s, v) => s + v, 0) / n) * 1000) / 1000;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.round(Math.sqrt(variance) * 1000) / 1000;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const now = _now();

  const existing = _baselines.get(metricName);
  if (existing) {
    db.prepare(
      `UPDATE ops_metrics_baseline SET mean = ?, std_dev = ?, q1 = ?, q3 = ?, sample_count = ?, updated_at = ? WHERE metric_name = ?`,
    ).run(mean, stdDev, q1, q3, n, now, metricName);
  } else {
    db.prepare(
      `INSERT INTO ops_metrics_baseline (metric_name, mean, std_dev, q1, q3, sample_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(metricName, mean, stdDev, q1, q3, n, now);
  }

  const baseline = {
    metric_name: metricName,
    mean,
    std_dev: stdDev,
    q1,
    q3,
    sample_count: n,
    updated_at: now,
  };
  _baselines.set(metricName, baseline);
  return { updated: true, baseline };
}

export function getBaseline(db, metricName) {
  const b = _baselines.get(metricName);
  return b ? { ...b } : null;
}

export function listBaselines(db) {
  return [..._baselines.values()].map((b) => ({ ...b }));
}

/* ── Anomaly Detection ──────────────────────────────────── */

export function detectAnomaly(db, { metricName, value, algorithm } = {}) {
  if (!metricName) return { anomaly: false, reason: "missing_metric_name" };
  if (value == null) return { anomaly: false, reason: "missing_value" };

  const baseline = _baselines.get(metricName);
  if (!baseline) return { anomaly: false, reason: "no_baseline" };

  const algo = algorithm || "z_score";
  let isAnomaly = false;
  let score = 0;
  let threshold = 0;

  if (algo === "z_score") {
    if (baseline.std_dev === 0)
      return { anomaly: false, reason: "zero_stddev" };
    score = Math.abs(value - baseline.mean) / baseline.std_dev;
    threshold = 3.0;
    isAnomaly = score > threshold;
  } else if (algo === "iqr") {
    const iqr = baseline.q3 - baseline.q1;
    const lower = baseline.q1 - 1.5 * iqr;
    const upper = baseline.q3 + 1.5 * iqr;
    score =
      value < lower
        ? (lower - value) / (iqr || 1)
        : value > upper
          ? (value - upper) / (iqr || 1)
          : 0;
    threshold = 0;
    isAnomaly = value < lower || value > upper;
  } else {
    return { anomaly: false, reason: "unknown_algorithm" };
  }

  const result = {
    anomaly: isAnomaly,
    metricName,
    value,
    algorithm: algo,
    score: Math.round(score * 1000) / 1000,
    threshold,
    baseline: {
      mean: baseline.mean,
      std_dev: baseline.std_dev,
      q1: baseline.q1,
      q3: baseline.q3,
    },
  };

  // Auto-create incident if anomaly detected
  if (isAnomaly) {
    const severity =
      score > 6 ? "P0" : score > 4 ? "P1" : score > 2 ? "P2" : "P3";
    const inc = createIncident(db, {
      anomalyMetric: metricName,
      severity,
      description: `Anomaly detected: ${metricName}=${value} (${algo} score=${result.score})`,
      anomalyData: JSON.stringify(result),
    });
    result.incidentId = inc.incidentId;
    result.severity = severity;
  }

  return result;
}

/* ── Incidents ──────────────────────────────────────────── */

const VALID_SEVERITIES = new Set(Object.values(SEVERITY));
const VALID_STATUSES = new Set(Object.values(INCIDENT_STATUS));

export function createIncident(
  db,
  { anomalyMetric, severity, description, anomalyData } = {},
) {
  const sev = severity && VALID_SEVERITIES.has(severity) ? severity : "P3";
  const id = _id();
  const now = _now();

  const entry = {
    id,
    anomaly_metric: anomalyMetric || null,
    severity: sev,
    status: "open",
    description: description || null,
    anomaly_data: anomalyData || null,
    remediation_id: null,
    postmortem: null,
    acknowledged_at: null,
    resolved_at: null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO ops_incidents (id, anomaly_metric, severity, status, description, anomaly_data, remediation_id, postmortem, acknowledged_at, resolved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.anomaly_metric,
    sev,
    "open",
    entry.description,
    entry.anomaly_data,
    null,
    null,
    null,
    null,
    now,
  );

  _incidents.set(id, entry);
  return { incidentId: id };
}

export function getIncident(db, id) {
  const i = _incidents.get(id);
  return i ? { ...i } : null;
}

export function acknowledgeIncident(db, id) {
  const i = _incidents.get(id);
  if (!i) return { acknowledged: false, reason: "not_found" };
  if (i.status !== "open") return { acknowledged: false, reason: "not_open" };

  i.status = "acknowledged";
  i.acknowledged_at = _now();
  db.prepare(
    "UPDATE ops_incidents SET status = ?, acknowledged_at = ? WHERE id = ?",
  ).run(i.status, i.acknowledged_at, id);

  return { acknowledged: true };
}

export function resolveIncident(db, id) {
  const i = _incidents.get(id);
  if (!i) return { resolved: false, reason: "not_found" };
  if (i.status !== "open" && i.status !== "acknowledged")
    return { resolved: false, reason: "not_resolvable" };

  i.status = "resolved";
  i.resolved_at = _now();
  db.prepare(
    "UPDATE ops_incidents SET status = ?, resolved_at = ? WHERE id = ?",
  ).run(i.status, i.resolved_at, id);

  return { resolved: true };
}

export function closeIncident(db, id) {
  const i = _incidents.get(id);
  if (!i) return { closed: false, reason: "not_found" };
  if (i.status !== "resolved") return { closed: false, reason: "not_resolved" };

  i.status = "closed";
  db.prepare("UPDATE ops_incidents SET status = ? WHERE id = ?").run(
    "closed",
    id,
  );

  return { closed: true };
}

export function listIncidents(db, { severity, status, limit = 50 } = {}) {
  let incs = [..._incidents.values()];
  if (severity) incs = incs.filter((i) => i.severity === severity);
  if (status) incs = incs.filter((i) => i.status === status);
  return incs
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((i) => ({ ...i }));
}

/* ── Playbooks ──────────────────────────────────────────── */

export function createPlaybook(db, { name, triggerCondition, steps } = {}) {
  if (!name) return { playbookId: null, reason: "missing_name" };

  const id = _id();
  const now = _now();

  const entry = {
    id,
    name,
    trigger_condition: triggerCondition || null,
    steps: steps || null,
    enabled: 1,
    success_count: 0,
    failure_count: 0,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO ops_remediation_playbooks (id, name, trigger_condition, steps, enabled, success_count, failure_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, entry.trigger_condition, entry.steps, 1, 0, 0, now);

  _playbooks.set(id, entry);
  return { playbookId: id };
}

export function getPlaybook(db, id) {
  const p = _playbooks.get(id);
  return p ? { ...p } : null;
}

export function togglePlaybook(db, id, enabled) {
  const p = _playbooks.get(id);
  if (!p) return { toggled: false, reason: "not_found" };

  p.enabled = enabled ? 1 : 0;
  db.prepare(
    "UPDATE ops_remediation_playbooks SET enabled = ? WHERE id = ?",
  ).run(p.enabled, id);

  return { toggled: true, enabled: p.enabled };
}

export function recordPlaybookResult(db, id, success) {
  const p = _playbooks.get(id);
  if (!p) return { recorded: false, reason: "not_found" };

  if (success) p.success_count += 1;
  else p.failure_count += 1;

  db.prepare(
    "UPDATE ops_remediation_playbooks SET success_count = ?, failure_count = ? WHERE id = ?",
  ).run(p.success_count, p.failure_count, id);

  return {
    recorded: true,
    successCount: p.success_count,
    failureCount: p.failure_count,
  };
}

export function listPlaybooks(db, { enabled, limit = 50 } = {}) {
  let pbs = [..._playbooks.values()];
  if (enabled != null) pbs = pbs.filter((p) => p.enabled === (enabled ? 1 : 0));
  return pbs
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((p) => ({ ...p }));
}

/* ── Postmortem ─────────────────────────────────────────── */

export function generatePostmortem(db, id) {
  const i = _incidents.get(id);
  if (!i) return { generated: false, reason: "not_found" };
  if (i.status !== "resolved" && i.status !== "closed")
    return { generated: false, reason: "not_resolved" };

  const durationMs = (i.resolved_at || _now()) - i.created_at;
  const postmortem = {
    incidentId: id,
    severity: i.severity,
    metric: i.anomaly_metric,
    description: i.description,
    timeline: {
      created: i.created_at,
      acknowledged: i.acknowledged_at,
      resolved: i.resolved_at,
      timeToAcknowledgeMs: i.acknowledged_at
        ? i.acknowledged_at - i.created_at
        : null,
      timeToResolveMs: durationMs,
    },
    rootCause: i.anomaly_data
      ? "Anomaly detected via automated monitoring"
      : "Manual incident report",
    impact: `${i.severity} incident on metric ${i.anomaly_metric || "unknown"}`,
    remediation: i.remediation_id || "Manual resolution",
    generatedAt: _now(),
  };

  i.postmortem = JSON.stringify(postmortem);
  db.prepare("UPDATE ops_incidents SET postmortem = ? WHERE id = ?").run(
    i.postmortem,
    id,
  );

  return { generated: true, postmortem };
}

/* ── Stats ──────────────────────────────────────────────── */

export function getOpsStats(db) {
  const incs = [..._incidents.values()];
  const pbs = [..._playbooks.values()];
  const bls = [..._baselines.values()];

  const bySeverity = {};
  for (const sev of Object.values(SEVERITY)) bySeverity[sev] = 0;
  for (const i of incs)
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;

  const byStatus = {};
  for (const st of Object.values(INCIDENT_STATUS)) byStatus[st] = 0;
  for (const i of incs) byStatus[i.status] = (byStatus[i.status] || 0) + 1;

  const resolved = incs.filter((i) => i.resolved_at);
  const avgResolveMs =
    resolved.length > 0
      ? Math.round(
          resolved.reduce((s, i) => s + (i.resolved_at - i.created_at), 0) /
            resolved.length,
        )
      : 0;

  return {
    incidents: {
      total: incs.length,
      bySeverity,
      byStatus,
      avgResolveMs,
    },
    playbooks: {
      total: pbs.length,
      enabled: pbs.filter((p) => p.enabled).length,
      totalSuccess: pbs.reduce((s, p) => s + p.success_count, 0),
      totalFailure: pbs.reduce((s, p) => s + p.failure_count, 0),
    },
    baselines: {
      total: bls.length,
      metrics: bls.map((b) => b.metric_name),
    },
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _incidents.clear();
  _playbooks.clear();
  _baselines.clear();
}

/* ═══════════════════════════════════════════════════════════════
 * V2 SURFACE — Phase 25 AIOps lifecycle state machines
 * ═══════════════════════════════════════════════════════════════
 *
 * V2 adds two parallel lifecycles on top of the legacy incident/playbook
 * store. Nothing above is modified.
 *
 *   Playbook maturity: draft      → { active, retired }
 *                      active     → { deprecated, retired }
 *                      deprecated → { active, retired }
 *                      Terminal:  retired
 *
 *   Remediation exec:  pending    → { executing, aborted }
 *                      executing  → { succeeded, failed, aborted }
 *                      Terminals: succeeded, failed, aborted
 *
 * Caps: per-owner active-playbook count + per-owner in-flight
 *       remediation count.
 *
 * Auto-flip: stale-playbook auto-retire + stuck-remediation auto-timeout.
 *
 * Stats: all enum keys zero-initialized for stable CI regression shape.
 * ═════════════════════════════════════════════════════════════ */

export const PLAYBOOK_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});

export const REMEDIATION_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  EXECUTING: "executing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  ABORTED: "aborted",
});

const PLAYBOOK_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["active", "retired"])],
  ["active", new Set(["deprecated", "retired"])],
  ["deprecated", new Set(["active", "retired"])],
]);
const PLAYBOOK_TERMINALS_V2 = new Set(["retired"]);

const REMEDIATION_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["executing", "aborted"])],
  ["executing", new Set(["succeeded", "failed", "aborted"])],
]);
const REMEDIATION_TERMINALS_V2 = new Set(["succeeded", "failed", "aborted"]);

export const AIOPS_DEFAULT_MAX_ACTIVE_PLAYBOOKS_PER_OWNER = 50;
export const AIOPS_DEFAULT_MAX_PENDING_REMEDIATIONS_PER_OWNER = 10;
export const AIOPS_DEFAULT_PLAYBOOK_STALE_MS = 90 * 86400000; // 90 days
export const AIOPS_DEFAULT_REMEDIATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

let _maxActivePlaybooksPerOwnerV2 =
  AIOPS_DEFAULT_MAX_ACTIVE_PLAYBOOKS_PER_OWNER;
let _maxPendingRemediationsPerOwnerV2 =
  AIOPS_DEFAULT_MAX_PENDING_REMEDIATIONS_PER_OWNER;
let _playbookStaleMsV2 = AIOPS_DEFAULT_PLAYBOOK_STALE_MS;
let _remediationTimeoutMsV2 = AIOPS_DEFAULT_REMEDIATION_TIMEOUT_MS;

const _playbookStatesV2 = new Map(); // playbookId → V2 record
const _remediationStatesV2 = new Map(); // remediationId → V2 record

function _positiveIntV2(n, label) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(num);
}

function _validPlaybookStatusV2(status) {
  return (
    status === "draft" ||
    status === "active" ||
    status === "deprecated" ||
    status === "retired"
  );
}

function _validRemediationStatusV2(status) {
  return (
    status === "pending" ||
    status === "executing" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "aborted"
  );
}

export function getDefaultMaxActivePlaybooksPerOwnerV2() {
  return AIOPS_DEFAULT_MAX_ACTIVE_PLAYBOOKS_PER_OWNER;
}
export function getMaxActivePlaybooksPerOwnerV2() {
  return _maxActivePlaybooksPerOwnerV2;
}
export function setMaxActivePlaybooksPerOwnerV2(n) {
  _maxActivePlaybooksPerOwnerV2 = _positiveIntV2(
    n,
    "maxActivePlaybooksPerOwner",
  );
  return _maxActivePlaybooksPerOwnerV2;
}

export function getDefaultMaxPendingRemediationsPerOwnerV2() {
  return AIOPS_DEFAULT_MAX_PENDING_REMEDIATIONS_PER_OWNER;
}
export function getMaxPendingRemediationsPerOwnerV2() {
  return _maxPendingRemediationsPerOwnerV2;
}
export function setMaxPendingRemediationsPerOwnerV2(n) {
  _maxPendingRemediationsPerOwnerV2 = _positiveIntV2(
    n,
    "maxPendingRemediationsPerOwner",
  );
  return _maxPendingRemediationsPerOwnerV2;
}

export function getDefaultPlaybookStaleMsV2() {
  return AIOPS_DEFAULT_PLAYBOOK_STALE_MS;
}
export function getPlaybookStaleMsV2() {
  return _playbookStaleMsV2;
}
export function setPlaybookStaleMsV2(ms) {
  _playbookStaleMsV2 = _positiveIntV2(ms, "playbookStaleMs");
  return _playbookStaleMsV2;
}

export function getDefaultRemediationTimeoutMsV2() {
  return AIOPS_DEFAULT_REMEDIATION_TIMEOUT_MS;
}
export function getRemediationTimeoutMsV2() {
  return _remediationTimeoutMsV2;
}
export function setRemediationTimeoutMsV2(ms) {
  _remediationTimeoutMsV2 = _positiveIntV2(ms, "remediationTimeoutMs");
  return _remediationTimeoutMsV2;
}

/* ── Playbook V2 ─────────────────────────────────────────── */

export function registerPlaybookV2(db, config = {}) {
  void db;
  const playbookId = String(config.playbookId || "").trim();
  if (!playbookId) throw new Error("playbookId is required");
  const ownerId = String(config.ownerId || "").trim();
  if (!ownerId) throw new Error("ownerId is required");
  if (_playbookStatesV2.has(playbookId)) {
    throw new Error(`Playbook already registered in V2: ${playbookId}`);
  }

  const now = Number(config.now ?? Date.now());
  const initialStatus = config.initialStatus || "draft";
  if (!_validPlaybookStatusV2(initialStatus)) {
    throw new Error(`Invalid initial status: ${initialStatus}`);
  }
  if (initialStatus === "retired") {
    throw new Error("Cannot register playbook in terminal status 'retired'");
  }

  if (initialStatus === "active") {
    let activeCount = 0;
    for (const rec of _playbookStatesV2.values()) {
      if (rec.ownerId === ownerId && rec.status === "active") activeCount += 1;
    }
    if (activeCount >= _maxActivePlaybooksPerOwnerV2) {
      throw new Error(
        `Max active playbooks per owner reached (${_maxActivePlaybooksPerOwnerV2})`,
      );
    }
  }

  const record = {
    playbookId,
    ownerId,
    name: config.name ? String(config.name) : null,
    status: initialStatus,
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    reason: null,
  };
  _playbookStatesV2.set(playbookId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getPlaybookV2(playbookId) {
  const rec = _playbookStatesV2.get(String(playbookId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setPlaybookMaturityV2(db, playbookId, newStatus, patch = {}) {
  void db;
  const id = String(playbookId || "");
  const record = _playbookStatesV2.get(id);
  if (!record) throw new Error(`Playbook not registered in V2: ${id}`);
  if (!_validPlaybookStatusV2(newStatus)) {
    throw new Error(`Invalid playbook status: ${newStatus}`);
  }
  if (PLAYBOOK_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Playbook is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = PLAYBOOK_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }

  if (newStatus === "active" && record.status !== "active") {
    let activeCount = 0;
    for (const rec of _playbookStatesV2.values()) {
      if (rec.ownerId === record.ownerId && rec.status === "active")
        activeCount += 1;
    }
    if (activeCount >= _maxActivePlaybooksPerOwnerV2) {
      throw new Error(
        `Max active playbooks per owner reached (${_maxActivePlaybooksPerOwnerV2})`,
      );
    }
  }

  record.status = newStatus;
  record.updatedAt = Number(patch.now ?? Date.now());
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function activatePlaybook(db, playbookId, reason) {
  return setPlaybookMaturityV2(db, playbookId, "active", { reason });
}
export function deprecatePlaybookV2(db, playbookId, reason) {
  return setPlaybookMaturityV2(db, playbookId, "deprecated", { reason });
}
export function retirePlaybook(db, playbookId, reason) {
  return setPlaybookMaturityV2(db, playbookId, "retired", { reason });
}

export function touchPlaybookActivity(playbookId) {
  const rec = _playbookStatesV2.get(String(playbookId || ""));
  if (!rec) throw new Error(`Playbook not registered in V2: ${playbookId}`);
  rec.lastUsedAt = Date.now();
  return { ...rec, metadata: { ...rec.metadata } };
}

/* ── Remediation V2 ──────────────────────────────────────── */

export function submitRemediationV2(db, config = {}) {
  void db;
  const remediationId = String(config.remediationId || "").trim();
  if (!remediationId) throw new Error("remediationId is required");
  const ownerId = String(config.ownerId || "").trim();
  if (!ownerId) throw new Error("ownerId is required");
  const playbookId = String(config.playbookId || "").trim();
  if (!playbookId) throw new Error("playbookId is required");

  if (_remediationStatesV2.has(remediationId)) {
    throw new Error(`Remediation already registered in V2: ${remediationId}`);
  }

  const playbook = _playbookStatesV2.get(playbookId);
  if (!playbook) {
    throw new Error(`Playbook not registered in V2: ${playbookId}`);
  }
  if (playbook.status !== "active" && playbook.status !== "deprecated") {
    throw new Error(
      `Playbook is ${playbook.status}, cannot submit remediation`,
    );
  }

  let inflightCount = 0;
  for (const rec of _remediationStatesV2.values()) {
    if (
      rec.ownerId === ownerId &&
      (rec.status === "pending" || rec.status === "executing")
    ) {
      inflightCount += 1;
    }
  }
  if (inflightCount >= _maxPendingRemediationsPerOwnerV2) {
    throw new Error(
      `Max pending remediations per owner reached (${_maxPendingRemediationsPerOwnerV2})`,
    );
  }

  const now = Number(config.now ?? Date.now());
  const record = {
    remediationId,
    ownerId,
    playbookId,
    incidentId: config.incidentId ? String(config.incidentId) : null,
    status: "pending",
    metadata: config.metadata ? { ...config.metadata } : {},
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    reason: null,
  };
  _remediationStatesV2.set(remediationId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getRemediationV2(remediationId) {
  const rec = _remediationStatesV2.get(String(remediationId || ""));
  if (!rec) return null;
  return { ...rec, metadata: { ...rec.metadata } };
}

export function setRemediationStatusV2(
  db,
  remediationId,
  newStatus,
  patch = {},
) {
  void db;
  const id = String(remediationId || "");
  const record = _remediationStatesV2.get(id);
  if (!record) throw new Error(`Remediation not registered in V2: ${id}`);
  if (!_validRemediationStatusV2(newStatus)) {
    throw new Error(`Invalid remediation status: ${newStatus}`);
  }
  if (REMEDIATION_TERMINALS_V2.has(record.status)) {
    throw new Error(
      `Remediation is in terminal status '${record.status}' and cannot transition`,
    );
  }
  const allowed = REMEDIATION_TRANSITIONS_V2.get(record.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} → ${newStatus}`);
  }
  const now = Number(patch.now ?? Date.now());
  record.status = newStatus;
  record.updatedAt = now;
  if (newStatus === "executing" && record.startedAt === null) {
    record.startedAt = now;
  }
  if (REMEDIATION_TERMINALS_V2.has(newStatus)) {
    record.completedAt = now;
  }
  if (patch.reason !== undefined) record.reason = patch.reason;
  if (patch.metadata && typeof patch.metadata === "object") {
    record.metadata = { ...record.metadata, ...patch.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

export function startRemediation(db, remediationId, reason) {
  return setRemediationStatusV2(db, remediationId, "executing", { reason });
}
export function completeRemediation(db, remediationId, reason) {
  return setRemediationStatusV2(db, remediationId, "succeeded", { reason });
}
export function failRemediation(db, remediationId, reason) {
  return setRemediationStatusV2(db, remediationId, "failed", { reason });
}
export function abortRemediation(db, remediationId, reason) {
  return setRemediationStatusV2(db, remediationId, "aborted", { reason });
}

/* ── Counts ──────────────────────────────────────────────── */

export function getActivePlaybookCount(ownerId) {
  let n = 0;
  for (const rec of _playbookStatesV2.values()) {
    if (rec.status !== "active") continue;
    if (ownerId !== undefined && rec.ownerId !== String(ownerId)) continue;
    n += 1;
  }
  return n;
}

export function getPendingRemediationCount(ownerId) {
  let n = 0;
  for (const rec of _remediationStatesV2.values()) {
    if (rec.status !== "pending" && rec.status !== "executing") continue;
    if (ownerId !== undefined && rec.ownerId !== String(ownerId)) continue;
    n += 1;
  }
  return n;
}

/* ── Auto-flip Bulk Ops ──────────────────────────────────── */

export function autoRetireStalePlaybooks(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _playbookStatesV2.values()) {
    if (PLAYBOOK_TERMINALS_V2.has(rec.status)) continue;
    if (now - rec.lastUsedAt > _playbookStaleMsV2) {
      rec.status = "retired";
      rec.updatedAt = now;
      rec.reason = "stale";
      flipped.push(rec.playbookId);
    }
  }
  return flipped;
}

export function autoTimeoutStuckRemediations(db, nowMs) {
  void db;
  const now = Number(nowMs ?? Date.now());
  const flipped = [];
  for (const rec of _remediationStatesV2.values()) {
    if (rec.status !== "executing") continue;
    const startedAt = rec.startedAt ?? rec.createdAt;
    if (now - startedAt > _remediationTimeoutMsV2) {
      rec.status = "failed";
      rec.updatedAt = now;
      rec.completedAt = now;
      rec.reason = "timeout";
      flipped.push(rec.remediationId);
    }
  }
  return flipped;
}

/* ── Stats V2 ────────────────────────────────────────────── */

export function getAiOpsStatsV2() {
  const playbooksByStatus = {
    draft: 0,
    active: 0,
    deprecated: 0,
    retired: 0,
  };
  const remediationsByStatus = {
    pending: 0,
    executing: 0,
    succeeded: 0,
    failed: 0,
    aborted: 0,
  };
  for (const rec of _playbookStatesV2.values()) {
    if (playbooksByStatus[rec.status] !== undefined) {
      playbooksByStatus[rec.status] += 1;
    }
  }
  for (const rec of _remediationStatesV2.values()) {
    if (remediationsByStatus[rec.status] !== undefined) {
      remediationsByStatus[rec.status] += 1;
    }
  }
  return {
    totalPlaybooksV2: _playbookStatesV2.size,
    totalRemediationsV2: _remediationStatesV2.size,
    maxActivePlaybooksPerOwner: _maxActivePlaybooksPerOwnerV2,
    maxPendingRemediationsPerOwner: _maxPendingRemediationsPerOwnerV2,
    playbookStaleMs: _playbookStaleMsV2,
    remediationTimeoutMs: _remediationTimeoutMsV2,
    playbooksByStatus,
    remediationsByStatus,
  };
}

/* ── Reset V2 (tests) ────────────────────────────────────── */

export function _resetStateV2() {
  _playbookStatesV2.clear();
  _remediationStatesV2.clear();
  _maxActivePlaybooksPerOwnerV2 = AIOPS_DEFAULT_MAX_ACTIVE_PLAYBOOKS_PER_OWNER;
  _maxPendingRemediationsPerOwnerV2 =
    AIOPS_DEFAULT_MAX_PENDING_REMEDIATIONS_PER_OWNER;
  _playbookStaleMsV2 = AIOPS_DEFAULT_PLAYBOOK_STALE_MS;
  _remediationTimeoutMsV2 = AIOPS_DEFAULT_REMEDIATION_TIMEOUT_MS;
}

// =====================================================================
// aiops V2 governance overlay (iter18)
// =====================================================================
export const AIOPSGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const AIOPSGOV_INCIDENT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  TRIAGING: "triaging",
  TRIAGED: "triaged",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _aiopsgovPTrans = new Map([
  [
    AIOPSGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE,
      AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      AIOPSGOV_PROFILE_MATURITY_V2.STALE,
      AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    AIOPSGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE,
      AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _aiopsgovPTerminal = new Set([AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _aiopsgovJTrans = new Map([
  [
    AIOPSGOV_INCIDENT_LIFECYCLE_V2.QUEUED,
    new Set([
      AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGING,
      AIOPSGOV_INCIDENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGING,
    new Set([
      AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGED,
      AIOPSGOV_INCIDENT_LIFECYCLE_V2.FAILED,
      AIOPSGOV_INCIDENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGED, new Set()],
  [AIOPSGOV_INCIDENT_LIFECYCLE_V2.FAILED, new Set()],
  [AIOPSGOV_INCIDENT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _aiopsgovPsV2 = new Map();
const _aiopsgovJsV2 = new Map();
let _aiopsgovMaxActive = 6,
  _aiopsgovMaxPending = 15,
  _aiopsgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _aiopsgovStuckMs = 60 * 1000;
function _aiopsgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _aiopsgovCheckP(from, to) {
  const a = _aiopsgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid aiopsgov profile transition ${from} → ${to}`);
}
function _aiopsgovCheckJ(from, to) {
  const a = _aiopsgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid aiopsgov incident transition ${from} → ${to}`);
}
function _aiopsgovCountActive(owner) {
  let c = 0;
  for (const p of _aiopsgovPsV2.values())
    if (p.owner === owner && p.status === AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _aiopsgovCountPending(profileId) {
  let c = 0;
  for (const j of _aiopsgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === AIOPSGOV_INCIDENT_LIFECYCLE_V2.QUEUED ||
        j.status === AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGING)
    )
      c++;
  return c;
}
export function setMaxActiveAiopsgovProfilesPerOwnerV2(n) {
  _aiopsgovMaxActive = _aiopsgovPos(n, "maxActiveAiopsgovProfilesPerOwner");
}
export function getMaxActiveAiopsgovProfilesPerOwnerV2() {
  return _aiopsgovMaxActive;
}
export function setMaxPendingAiopsgovIncidentsPerProfileV2(n) {
  _aiopsgovMaxPending = _aiopsgovPos(
    n,
    "maxPendingAiopsgovIncidentsPerProfile",
  );
}
export function getMaxPendingAiopsgovIncidentsPerProfileV2() {
  return _aiopsgovMaxPending;
}
export function setAiopsgovProfileIdleMsV2(n) {
  _aiopsgovIdleMs = _aiopsgovPos(n, "aiopsgovProfileIdleMs");
}
export function getAiopsgovProfileIdleMsV2() {
  return _aiopsgovIdleMs;
}
export function setAiopsgovIncidentStuckMsV2(n) {
  _aiopsgovStuckMs = _aiopsgovPos(n, "aiopsgovIncidentStuckMs");
}
export function getAiopsgovIncidentStuckMsV2() {
  return _aiopsgovStuckMs;
}
export function _resetStateAiopsGovV2() {
  _aiopsgovPsV2.clear();
  _aiopsgovJsV2.clear();
  _aiopsgovMaxActive = 6;
  _aiopsgovMaxPending = 15;
  _aiopsgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _aiopsgovStuckMs = 60 * 1000;
}
export function registerAiopsgovProfileV2({ id, owner, mode, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_aiopsgovPsV2.has(id))
    throw new Error(`aiopsgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    mode: mode || "monitor",
    status: AIOPSGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _aiopsgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateAiopsgovProfileV2(id) {
  const p = _aiopsgovPsV2.get(id);
  if (!p) throw new Error(`aiopsgov profile ${id} not found`);
  const isInitial = p.status === AIOPSGOV_PROFILE_MATURITY_V2.PENDING;
  _aiopsgovCheckP(p.status, AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _aiopsgovCountActive(p.owner) >= _aiopsgovMaxActive)
    throw new Error(
      `max active aiopsgov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleAiopsgovProfileV2(id) {
  const p = _aiopsgovPsV2.get(id);
  if (!p) throw new Error(`aiopsgov profile ${id} not found`);
  _aiopsgovCheckP(p.status, AIOPSGOV_PROFILE_MATURITY_V2.STALE);
  p.status = AIOPSGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveAiopsgovProfileV2(id) {
  const p = _aiopsgovPsV2.get(id);
  if (!p) throw new Error(`aiopsgov profile ${id} not found`);
  _aiopsgovCheckP(p.status, AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = AIOPSGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchAiopsgovProfileV2(id) {
  const p = _aiopsgovPsV2.get(id);
  if (!p) throw new Error(`aiopsgov profile ${id} not found`);
  if (_aiopsgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal aiopsgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getAiopsgovProfileV2(id) {
  const p = _aiopsgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listAiopsgovProfilesV2() {
  return [..._aiopsgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createAiopsgovIncidentV2({
  id,
  profileId,
  summary,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_aiopsgovJsV2.has(id))
    throw new Error(`aiopsgov incident ${id} already exists`);
  if (!_aiopsgovPsV2.has(profileId))
    throw new Error(`aiopsgov profile ${profileId} not found`);
  if (_aiopsgovCountPending(profileId) >= _aiopsgovMaxPending)
    throw new Error(
      `max pending aiopsgov incidents for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    summary: summary || "",
    status: AIOPSGOV_INCIDENT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _aiopsgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function triagingAiopsgovIncidentV2(id) {
  const j = _aiopsgovJsV2.get(id);
  if (!j) throw new Error(`aiopsgov incident ${id} not found`);
  _aiopsgovCheckJ(j.status, AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGING);
  const now = Date.now();
  j.status = AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeIncidentAiopsgovV2(id) {
  const j = _aiopsgovJsV2.get(id);
  if (!j) throw new Error(`aiopsgov incident ${id} not found`);
  _aiopsgovCheckJ(j.status, AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGED);
  const now = Date.now();
  j.status = AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failAiopsgovIncidentV2(id, reason) {
  const j = _aiopsgovJsV2.get(id);
  if (!j) throw new Error(`aiopsgov incident ${id} not found`);
  _aiopsgovCheckJ(j.status, AIOPSGOV_INCIDENT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = AIOPSGOV_INCIDENT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelAiopsgovIncidentV2(id, reason) {
  const j = _aiopsgovJsV2.get(id);
  if (!j) throw new Error(`aiopsgov incident ${id} not found`);
  _aiopsgovCheckJ(j.status, AIOPSGOV_INCIDENT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = AIOPSGOV_INCIDENT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getAiopsgovIncidentV2(id) {
  const j = _aiopsgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listAiopsgovIncidentsV2() {
  return [..._aiopsgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleAiopsgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _aiopsgovPsV2.values())
    if (
      p.status === AIOPSGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _aiopsgovIdleMs
    ) {
      p.status = AIOPSGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckAiopsgovIncidentsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _aiopsgovJsV2.values())
    if (
      j.status === AIOPSGOV_INCIDENT_LIFECYCLE_V2.TRIAGING &&
      j.startedAt != null &&
      t - j.startedAt >= _aiopsgovStuckMs
    ) {
      j.status = AIOPSGOV_INCIDENT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getAiopsGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(AIOPSGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _aiopsgovPsV2.values()) profilesByStatus[p.status]++;
  const incidentsByStatus = {};
  for (const v of Object.values(AIOPSGOV_INCIDENT_LIFECYCLE_V2))
    incidentsByStatus[v] = 0;
  for (const j of _aiopsgovJsV2.values()) incidentsByStatus[j.status]++;
  return {
    totalAiopsgovProfilesV2: _aiopsgovPsV2.size,
    totalAiopsgovIncidentsV2: _aiopsgovJsV2.size,
    maxActiveAiopsgovProfilesPerOwner: _aiopsgovMaxActive,
    maxPendingAiopsgovIncidentsPerProfile: _aiopsgovMaxPending,
    aiopsgovProfileIdleMs: _aiopsgovIdleMs,
    aiopsgovIncidentStuckMs: _aiopsgovStuckMs,
    profilesByStatus,
    incidentsByStatus,
  };
}
