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
