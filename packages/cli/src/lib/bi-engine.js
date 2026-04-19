/**
 * BI Engine — Business intelligence with NL→SQL queries, dashboards,
 * reports, anomaly detection, trend prediction, and scheduling.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _dashboards = new Map();
const _reports = new Map();
const _scheduledReports = new Map();

const _templates = [
  {
    id: "tpl-kpi",
    name: "KPI Dashboard",
    description: "Key performance indicators overview",
    widgets: ["metric-card", "sparkline", "gauge"],
  },
  {
    id: "tpl-sales",
    name: "Sales Report",
    description: "Sales pipeline and revenue analysis",
    widgets: ["bar-chart", "funnel", "table"],
  },
  {
    id: "tpl-ops",
    name: "Operations Dashboard",
    description: "System health and operational metrics",
    widgets: ["heatmap", "timeline", "alert-list"],
  },
  {
    id: "tpl-hr",
    name: "HR Analytics",
    description: "Workforce analytics and headcount",
    widgets: ["pie-chart", "trend-line", "scorecard"],
  },
  {
    id: "tpl-finance",
    name: "Financial Overview",
    description: "Revenue, expenses, and cash flow",
    widgets: ["waterfall", "stacked-bar", "summary-table"],
  },
];

/* ── Schema ────────────────────────────────────────────────── */

export function ensureBITables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bi_dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      widgets TEXT,
      layout TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bi_reports (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      query TEXT,
      result TEXT,
      format TEXT DEFAULT 'pdf',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bi_scheduled (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      cron TEXT NOT NULL,
      recipients TEXT,
      last_run TEXT,
      status TEXT DEFAULT 'active'
    )
  `);
}

/* ── NL → SQL Query ────────────────────────────────────────── */

export function nlQuery(query) {
  if (!query || typeof query !== "string") {
    throw new Error("Query must be a non-empty string");
  }

  // Mock NL→SQL translation: generate a SELECT LIKE query
  const sanitized = query.replace(/['"]/g, "").trim();
  const words = sanitized.split(/\s+/).slice(0, 3).join("_").toLowerCase();
  const generatedSQL = `SELECT * FROM data WHERE content LIKE '%${words}%'`;

  const id = crypto.randomUUID();
  const results = [];
  const visualization = {
    type: "table",
    title: query,
    columns: ["id", "content", "value"],
  };

  return {
    id,
    query,
    generatedSQL,
    results,
    rowCount: results.length,
    visualization,
  };
}

/* ── Reports ───────────────────────────────────────────────── */

export function generateReport(db, name, options) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const format = (options && options.format) || "pdf";

  const sectionNames = (options && options.sections) || [
    "summary",
    "details",
    "conclusion",
  ];
  const sections = sectionNames.map((s) => ({
    name: s,
    content: `Auto-generated ${s} section`,
    generatedAt: now,
  }));

  const report = {
    id,
    name,
    format,
    sections,
    generatedAt: now,
  };

  _reports.set(id, report);

  db.prepare(
    `INSERT INTO bi_reports (id, name, query, result, format, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, "", JSON.stringify(report), format, now);

  return report;
}

/* ── Dashboards ────────────────────────────────────────────── */

export function createDashboard(db, name, widgets, layout) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const dashboard = {
    id,
    name,
    widgets: widgets || [],
    layout: layout || { type: "grid", columns: 2 },
    createdAt: now,
  };

  _dashboards.set(id, dashboard);

  db.prepare(
    `INSERT INTO bi_dashboards (id, name, widgets, layout, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    JSON.stringify(dashboard.widgets),
    JSON.stringify(dashboard.layout),
    now,
    now,
  );

  return dashboard;
}

/* ── Anomaly Detection ─────────────────────────────────────── */

export function detectAnomaly(data, options) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Data must be a non-empty array of numbers");
  }

  const threshold = (options && options.threshold) || 2;
  const n = data.length;
  const mean = data.reduce((s, v) => s + v, 0) / n;
  const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  const anomalies = [];
  if (std > 0) {
    for (let i = 0; i < data.length; i++) {
      const zScore = Math.abs((data[i] - mean) / std);
      if (zScore > threshold) {
        anomalies.push({ index: i, value: data[i], zScore });
      }
    }
  }

  return { anomalies, mean, std, threshold };
}

/* ── Trend Prediction ──────────────────────────────────────── */

export function predictTrend(data, periods) {
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error("Data must be an array with at least 2 points");
  }

  const n = data.length;
  const periodsToPredict = periods || 3;

  // Simple linear regression: y = slope * x + intercept
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const predictions = [];
  for (let i = 0; i < periodsToPredict; i++) {
    const x = n + i;
    predictions.push(Math.round((slope * x + intercept) * 100) / 100);
  }

  let trend;
  if (Math.abs(slope) < 0.001) {
    trend = "flat";
  } else if (slope > 0) {
    trend = "up";
  } else {
    trend = "down";
  }

  return { predictions, trend, slope: Math.round(slope * 1000) / 1000 };
}

/* ── Templates ─────────────────────────────────────────────── */

export function listTemplates() {
  return [..._templates];
}

/* ── Scheduling ────────────────────────────────────────────── */

export function scheduleReport(db, reportId, cron, recipients) {
  const id = crypto.randomUUID();
  const schedule = {
    id,
    reportId,
    cron,
    recipients: recipients || [],
    lastRun: null,
    status: "active",
  };

  _scheduledReports.set(id, schedule);

  db.prepare(
    `INSERT INTO bi_scheduled (id, report_id, cron, recipients, last_run, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, reportId, cron, JSON.stringify(schedule.recipients), "", "active");

  return schedule;
}

/* ── Export ─────────────────────────────────────────────────── */

export function exportReport(reportId, format) {
  const report = _reports.get(reportId);
  if (!report) throw new Error(`Report not found: ${reportId}`);

  const exportFormat = format || report.format || "pdf";
  return {
    reportId,
    format: exportFormat,
    filename: `${report.name.replace(/\s+/g, "_")}.${exportFormat}`,
    size: 0,
    exportedAt: new Date().toISOString(),
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _dashboards.clear();
  _reports.clear();
  _scheduledReports.clear();
}

// ─── Phase 95 V2 surface (strictly additive) ───────────────────────

export const CHART_TYPE = Object.freeze({
  TABLE: "table",
  BAR: "bar",
  LINE: "line",
  PIE: "pie",
  AREA: "area",
  SCATTER: "scatter",
  HEATMAP: "heatmap",
  FUNNEL: "funnel",
  GAUGE: "gauge",
});

export const ANOMALY_METHOD = Object.freeze({
  Z_SCORE: "z_score",
  IQR: "iqr",
});

export const REPORT_FORMAT = Object.freeze({
  PDF: "pdf",
  EXCEL: "excel",
  CSV: "csv",
  JSON: "json",
});

export const REPORT_STATUS = Object.freeze({
  DRAFT: "draft",
  GENERATED: "generated",
  SCHEDULED: "scheduled",
  ARCHIVED: "archived",
});

export const DASHBOARD_LAYOUT = Object.freeze({
  GRID: "grid",
  FLOW: "flow",
  TABS: "tabs",
});

const _reportStatusV2 = new Map();
const _statusHistoryV2 = new Map();

const _allowedReportTransitions = Object.freeze({
  draft: new Set(["generated", "archived"]),
  generated: new Set(["scheduled", "archived", "draft"]),
  scheduled: new Set(["generated", "archived"]),
  archived: new Set(["draft"]),
});

function _quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

export function nlQueryV2({ query, schema } = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("query must be a non-empty string");
  }
  const normalized = query.replace(/['"]/g, "").trim().toLowerCase();
  const tokens = normalized.split(/\s+/);

  // Detect table name from schema (first match) or fall back to "data"
  let table = "data";
  const knownTables =
    schema && Array.isArray(schema.tables)
      ? schema.tables.map((t) => String(t).toLowerCase())
      : [];
  for (const t of knownTables) {
    if (tokens.includes(t)) {
      table = t;
      break;
    }
  }

  // Detect aggregate intent
  let aggregate = null;
  let intent = "list";
  let visualization = CHART_TYPE.TABLE;

  if (/\b(count|how many)\b/.test(normalized)) {
    aggregate = "COUNT(*)";
    intent = "count";
    visualization = CHART_TYPE.BAR;
  } else if (/\b(sum|total)\b/.test(normalized)) {
    aggregate = "SUM(value)";
    intent = "sum";
    visualization = CHART_TYPE.GAUGE;
  } else if (/\b(avg|average|mean)\b/.test(normalized)) {
    aggregate = "AVG(value)";
    intent = "avg";
    visualization = CHART_TYPE.GAUGE;
  } else if (/\b(trend|over time|timeline|history)\b/.test(normalized)) {
    intent = "trend";
    visualization = CHART_TYPE.LINE;
  } else if (/\b(distribution|breakdown)\b/.test(normalized)) {
    intent = "distribution";
    visualization = CHART_TYPE.PIE;
  }

  // Detect top N
  let limit = null;
  const topMatch = normalized.match(/\btop\s+(\d+)\b/);
  if (topMatch) {
    limit = parseInt(topMatch[1], 10);
    if (intent === "list") {
      intent = "top";
      visualization = CHART_TYPE.BAR;
    }
  }

  // Build SQL
  let sql;
  if (aggregate) {
    sql = `SELECT ${aggregate} FROM ${table}`;
  } else {
    sql = `SELECT * FROM ${table}`;
  }
  if (limit !== null) {
    sql += ` ORDER BY value DESC LIMIT ${limit}`;
  } else if (intent === "trend") {
    sql += ` ORDER BY created_at ASC`;
  }

  return {
    id: crypto.randomUUID(),
    query,
    intent,
    sql,
    table,
    aggregate,
    limit,
    visualization,
  };
}

export function detectAnomalyV2({
  data,
  method = ANOMALY_METHOD.Z_SCORE,
  threshold,
} = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("data must be a non-empty array of numbers");
  }
  const valid = Object.values(ANOMALY_METHOD);
  if (!valid.includes(method)) {
    throw new Error(
      `Invalid method '${method}'. Expected one of ${valid.join(", ")}`,
    );
  }

  if (method === ANOMALY_METHOD.Z_SCORE) {
    const t = threshold == null ? 2 : threshold;
    const legacy = detectAnomaly(data, { threshold: t });
    return { method, threshold: t, ...legacy };
  }

  // IQR method
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = _quantile(sorted, 0.25);
  const q3 = _quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const multiplier = threshold == null ? 1.5 : threshold;
  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;

  const anomalies = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lowerBound || data[i] > upperBound) {
      anomalies.push({ index: i, value: data[i] });
    }
  }

  return {
    method,
    threshold: multiplier,
    q1,
    q3,
    iqr,
    lowerBound,
    upperBound,
    anomalies,
  };
}

export function predictTrendV2({ data, periods = 3, method = "linear" } = {}) {
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error("data must be an array with at least 2 points");
  }
  if (method !== "linear") {
    throw new Error(`Invalid method '${method}'. Only 'linear' is supported`);
  }

  const legacy = predictTrend(data, periods);

  // Compute R² (coefficient of determination)
  const n = data.length;
  const meanY = data.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = legacy.slope * i + (meanY - legacy.slope * ((n - 1) / 2));
    ssRes += (data[i] - predicted) ** 2;
    ssTot += (data[i] - meanY) ** 2;
  }
  let r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  if (r2 < 0) r2 = 0;
  if (r2 > 1) r2 = 1;

  return {
    method,
    ...legacy,
    r2: Math.round(r2 * 1000) / 1000,
    confidence: r2 >= 0.7 ? "high" : r2 >= 0.4 ? "medium" : "low",
  };
}

export function recommendChart({ intent, dataShape } = {}) {
  if (intent) {
    const i = String(intent).toLowerCase();
    if (i.includes("trend") || i.includes("time")) return CHART_TYPE.LINE;
    if (i.includes("distribution") || i.includes("share"))
      return CHART_TYPE.PIE;
    if (i.includes("compare") || i.includes("top")) return CHART_TYPE.BAR;
    if (i.includes("correlation")) return CHART_TYPE.SCATTER;
    if (i.includes("funnel")) return CHART_TYPE.FUNNEL;
    if (i.includes("heat")) return CHART_TYPE.HEATMAP;
    if (i.includes("gauge") || i.includes("kpi")) return CHART_TYPE.GAUGE;
  }
  if (dataShape) {
    if (dataShape.dimensions === 1 && dataShape.categorical)
      return CHART_TYPE.PIE;
    if (dataShape.timeseries) return CHART_TYPE.LINE;
    if (dataShape.dimensions === 2) return CHART_TYPE.SCATTER;
  }
  return CHART_TYPE.TABLE;
}

export function createDashboardV2(db, { name, widgets = [], layout } = {}) {
  if (!name) throw new Error("name is required");
  let layoutSpec;
  if (!layout) {
    layoutSpec = { type: DASHBOARD_LAYOUT.GRID, columns: 2 };
  } else if (typeof layout === "string") {
    const valid = Object.values(DASHBOARD_LAYOUT);
    if (!valid.includes(layout)) {
      throw new Error(
        `Invalid layout '${layout}'. Expected one of ${valid.join(", ")}`,
      );
    }
    layoutSpec = { type: layout, columns: 2 };
  } else {
    const type = layout.type || DASHBOARD_LAYOUT.GRID;
    const valid = Object.values(DASHBOARD_LAYOUT);
    if (!valid.includes(type)) {
      throw new Error(
        `Invalid layout type '${type}'. Expected one of ${valid.join(", ")}`,
      );
    }
    layoutSpec = { ...layout, type };
  }
  return createDashboard(db, name, widgets, layoutSpec);
}

export function updateReportStatus(db, { reportId, status } = {}) {
  const valid = Object.values(REPORT_STATUS);
  if (!valid.includes(status)) {
    throw new Error(
      `Invalid status '${status}'. Expected one of ${valid.join(", ")}`,
    );
  }
  const current = _reportStatusV2.get(reportId) || REPORT_STATUS.DRAFT;
  const allowed = _allowedReportTransitions[current];
  if (!allowed.has(status) && current !== status) {
    throw new Error(`Invalid status transition: ${current} → ${status}`);
  }
  _reportStatusV2.set(reportId, status);
  const hist = _statusHistoryV2.get(reportId) || [];
  hist.push({
    from: current,
    to: status,
    at: new Date().toISOString(),
  });
  _statusHistoryV2.set(reportId, hist);
  return { reportId, status, previous: current };
}

export function getReportStatus(reportId) {
  return _reportStatusV2.get(reportId) || REPORT_STATUS.DRAFT;
}

export function getReportStatusHistory(reportId) {
  return (_statusHistoryV2.get(reportId) || []).slice();
}

export function getBIStatsV2(db) {
  const dashboards = db.prepare(`SELECT id FROM bi_dashboards`).all();
  const reports = db.prepare(`SELECT id, format FROM bi_reports`).all();
  const scheduled = db.prepare(`SELECT id FROM bi_scheduled`).all();

  const byStatus = {
    draft: 0,
    generated: 0,
    scheduled: 0,
    archived: 0,
  };
  for (const r of reports) {
    const s = _reportStatusV2.get(r.id) || REPORT_STATUS.DRAFT;
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  const byFormat = {};
  for (const r of reports) {
    const f = r.format || "pdf";
    byFormat[f] = (byFormat[f] || 0) + 1;
  }

  return {
    dashboards: dashboards.length,
    reports: {
      total: reports.length,
      byStatus,
      byFormat,
    },
    scheduled: scheduled.length,
    templates: _templates.length,
    chartTypes: Object.values(CHART_TYPE).length,
  };
}

export function _resetV2State() {
  _reportStatusV2.clear();
  _statusHistoryV2.clear();
}

// ===== V2 Surface: BI Engine governance overlay (CLI v0.135.0) =====
export const BI_DATASET_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const BI_QUERY_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _biDsTrans = new Map([
  [
    BI_DATASET_MATURITY_V2.PENDING,
    new Set([BI_DATASET_MATURITY_V2.ACTIVE, BI_DATASET_MATURITY_V2.ARCHIVED]),
  ],
  [
    BI_DATASET_MATURITY_V2.ACTIVE,
    new Set([BI_DATASET_MATURITY_V2.STALE, BI_DATASET_MATURITY_V2.ARCHIVED]),
  ],
  [
    BI_DATASET_MATURITY_V2.STALE,
    new Set([BI_DATASET_MATURITY_V2.ACTIVE, BI_DATASET_MATURITY_V2.ARCHIVED]),
  ],
  [BI_DATASET_MATURITY_V2.ARCHIVED, new Set()],
]);
const _biDsTerminal = new Set([BI_DATASET_MATURITY_V2.ARCHIVED]);
const _biQTrans = new Map([
  [
    BI_QUERY_LIFECYCLE_V2.QUEUED,
    new Set([BI_QUERY_LIFECYCLE_V2.RUNNING, BI_QUERY_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    BI_QUERY_LIFECYCLE_V2.RUNNING,
    new Set([
      BI_QUERY_LIFECYCLE_V2.COMPLETED,
      BI_QUERY_LIFECYCLE_V2.FAILED,
      BI_QUERY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [BI_QUERY_LIFECYCLE_V2.COMPLETED, new Set()],
  [BI_QUERY_LIFECYCLE_V2.FAILED, new Set()],
  [BI_QUERY_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _biDatasets = new Map();
const _biQueries = new Map();
let _biMaxActivePerOwner = 8;
let _biMaxPendingPerDs = 10;
let _biDsIdleMs = 7 * 24 * 60 * 60 * 1000;
let _biQStuckMs = 5 * 60 * 1000;

function _biPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveBiDatasetsPerOwnerV2(n) {
  _biMaxActivePerOwner = _biPos(n, "maxActiveBiDatasetsPerOwner");
}
export function getMaxActiveBiDatasetsPerOwnerV2() {
  return _biMaxActivePerOwner;
}
export function setMaxPendingBiQueriesPerDatasetV2(n) {
  _biMaxPendingPerDs = _biPos(n, "maxPendingBiQueriesPerDataset");
}
export function getMaxPendingBiQueriesPerDatasetV2() {
  return _biMaxPendingPerDs;
}
export function setBiDatasetIdleMsV2(n) {
  _biDsIdleMs = _biPos(n, "biDatasetIdleMs");
}
export function getBiDatasetIdleMsV2() {
  return _biDsIdleMs;
}
export function setBiQueryStuckMsV2(n) {
  _biQStuckMs = _biPos(n, "biQueryStuckMs");
}
export function getBiQueryStuckMsV2() {
  return _biQStuckMs;
}

export function _resetStateBiEngineV2() {
  _biDatasets.clear();
  _biQueries.clear();
  _biMaxActivePerOwner = 8;
  _biMaxPendingPerDs = 10;
  _biDsIdleMs = 7 * 24 * 60 * 60 * 1000;
  _biQStuckMs = 5 * 60 * 1000;
}

export function registerBiDatasetV2({ id, owner, source, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_biDatasets.has(id))
    throw new Error(`bi dataset ${id} already registered`);
  const now = Date.now();
  const d = {
    id,
    owner,
    source: source || "",
    status: BI_DATASET_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _biDatasets.set(id, d);
  return { ...d, metadata: { ...d.metadata } };
}
function _biCheckD(from, to) {
  const a = _biDsTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid bi dataset transition ${from} → ${to}`);
}
function _biCountActive(owner) {
  let n = 0;
  for (const d of _biDatasets.values())
    if (d.owner === owner && d.status === BI_DATASET_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateBiDatasetV2(id) {
  const d = _biDatasets.get(id);
  if (!d) throw new Error(`bi dataset ${id} not found`);
  _biCheckD(d.status, BI_DATASET_MATURITY_V2.ACTIVE);
  const recovery = d.status === BI_DATASET_MATURITY_V2.STALE;
  if (!recovery) {
    const a = _biCountActive(d.owner);
    if (a >= _biMaxActivePerOwner)
      throw new Error(
        `max active bi datasets per owner (${_biMaxActivePerOwner}) reached for ${d.owner}`,
      );
  }
  const now = Date.now();
  d.status = BI_DATASET_MATURITY_V2.ACTIVE;
  d.updatedAt = now;
  d.lastTouchedAt = now;
  if (!d.activatedAt) d.activatedAt = now;
  return { ...d, metadata: { ...d.metadata } };
}
export function staleBiDatasetV2(id) {
  const d = _biDatasets.get(id);
  if (!d) throw new Error(`bi dataset ${id} not found`);
  _biCheckD(d.status, BI_DATASET_MATURITY_V2.STALE);
  d.status = BI_DATASET_MATURITY_V2.STALE;
  d.updatedAt = Date.now();
  return { ...d, metadata: { ...d.metadata } };
}
export function archiveBiDatasetV2(id) {
  const d = _biDatasets.get(id);
  if (!d) throw new Error(`bi dataset ${id} not found`);
  _biCheckD(d.status, BI_DATASET_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  d.status = BI_DATASET_MATURITY_V2.ARCHIVED;
  d.updatedAt = now;
  if (!d.archivedAt) d.archivedAt = now;
  return { ...d, metadata: { ...d.metadata } };
}
export function touchBiDatasetV2(id) {
  const d = _biDatasets.get(id);
  if (!d) throw new Error(`bi dataset ${id} not found`);
  if (_biDsTerminal.has(d.status))
    throw new Error(`cannot touch terminal bi dataset ${id}`);
  const now = Date.now();
  d.lastTouchedAt = now;
  d.updatedAt = now;
  return { ...d, metadata: { ...d.metadata } };
}
export function getBiDatasetV2(id) {
  const d = _biDatasets.get(id);
  if (!d) return null;
  return { ...d, metadata: { ...d.metadata } };
}
export function listBiDatasetsV2() {
  return [..._biDatasets.values()].map((d) => ({
    ...d,
    metadata: { ...d.metadata },
  }));
}

function _biCountPending(did) {
  let n = 0;
  for (const q of _biQueries.values())
    if (
      q.datasetId === did &&
      (q.status === BI_QUERY_LIFECYCLE_V2.QUEUED ||
        q.status === BI_QUERY_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createBiQueryV2({ id, datasetId, sql, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!datasetId || typeof datasetId !== "string")
    throw new Error("datasetId is required");
  if (_biQueries.has(id)) throw new Error(`bi query ${id} already exists`);
  if (!_biDatasets.has(datasetId))
    throw new Error(`bi dataset ${datasetId} not found`);
  const pending = _biCountPending(datasetId);
  if (pending >= _biMaxPendingPerDs)
    throw new Error(
      `max pending bi queries per dataset (${_biMaxPendingPerDs}) reached for ${datasetId}`,
    );
  const now = Date.now();
  const q = {
    id,
    datasetId,
    sql: sql || "",
    status: BI_QUERY_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _biQueries.set(id, q);
  return { ...q, metadata: { ...q.metadata } };
}
function _biCheckQ(from, to) {
  const a = _biQTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid bi query transition ${from} → ${to}`);
}
export function startBiQueryV2(id) {
  const q = _biQueries.get(id);
  if (!q) throw new Error(`bi query ${id} not found`);
  _biCheckQ(q.status, BI_QUERY_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  q.status = BI_QUERY_LIFECYCLE_V2.RUNNING;
  q.updatedAt = now;
  if (!q.startedAt) q.startedAt = now;
  return { ...q, metadata: { ...q.metadata } };
}
export function completeBiQueryV2(id) {
  const q = _biQueries.get(id);
  if (!q) throw new Error(`bi query ${id} not found`);
  _biCheckQ(q.status, BI_QUERY_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  q.status = BI_QUERY_LIFECYCLE_V2.COMPLETED;
  q.updatedAt = now;
  if (!q.settledAt) q.settledAt = now;
  return { ...q, metadata: { ...q.metadata } };
}
export function failBiQueryV2(id, reason) {
  const q = _biQueries.get(id);
  if (!q) throw new Error(`bi query ${id} not found`);
  _biCheckQ(q.status, BI_QUERY_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  q.status = BI_QUERY_LIFECYCLE_V2.FAILED;
  q.updatedAt = now;
  if (!q.settledAt) q.settledAt = now;
  if (reason) q.metadata.failReason = String(reason);
  return { ...q, metadata: { ...q.metadata } };
}
export function cancelBiQueryV2(id, reason) {
  const q = _biQueries.get(id);
  if (!q) throw new Error(`bi query ${id} not found`);
  _biCheckQ(q.status, BI_QUERY_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  q.status = BI_QUERY_LIFECYCLE_V2.CANCELLED;
  q.updatedAt = now;
  if (!q.settledAt) q.settledAt = now;
  if (reason) q.metadata.cancelReason = String(reason);
  return { ...q, metadata: { ...q.metadata } };
}
export function getBiQueryV2(id) {
  const q = _biQueries.get(id);
  if (!q) return null;
  return { ...q, metadata: { ...q.metadata } };
}
export function listBiQueriesV2() {
  return [..._biQueries.values()].map((q) => ({
    ...q,
    metadata: { ...q.metadata },
  }));
}

export function autoStaleIdleBiDatasetsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const d of _biDatasets.values())
    if (
      d.status === BI_DATASET_MATURITY_V2.ACTIVE &&
      t - d.lastTouchedAt >= _biDsIdleMs
    ) {
      d.status = BI_DATASET_MATURITY_V2.STALE;
      d.updatedAt = t;
      flipped.push(d.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckBiQueriesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const q of _biQueries.values())
    if (
      q.status === BI_QUERY_LIFECYCLE_V2.RUNNING &&
      q.startedAt != null &&
      t - q.startedAt >= _biQStuckMs
    ) {
      q.status = BI_QUERY_LIFECYCLE_V2.FAILED;
      q.updatedAt = t;
      if (!q.settledAt) q.settledAt = t;
      q.metadata.failReason = "auto-fail-stuck";
      flipped.push(q.id);
    }
  return { flipped, count: flipped.length };
}

export function getBiEngineStatsV2() {
  const datasetsByStatus = {};
  for (const s of Object.values(BI_DATASET_MATURITY_V2))
    datasetsByStatus[s] = 0;
  for (const d of _biDatasets.values()) datasetsByStatus[d.status]++;
  const queriesByStatus = {};
  for (const s of Object.values(BI_QUERY_LIFECYCLE_V2)) queriesByStatus[s] = 0;
  for (const q of _biQueries.values()) queriesByStatus[q.status]++;
  return {
    totalDatasetsV2: _biDatasets.size,
    totalQueriesV2: _biQueries.size,
    maxActiveBiDatasetsPerOwner: _biMaxActivePerOwner,
    maxPendingBiQueriesPerDataset: _biMaxPendingPerDs,
    biDatasetIdleMs: _biDsIdleMs,
    biQueryStuckMs: _biQStuckMs,
    datasetsByStatus,
    queriesByStatus,
  };
}

// =====================================================================
// bi-engine V2 governance overlay (iter21)
// =====================================================================
export const BIGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const BIGOV_QUERY_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  QUERYING: "querying",
  QUERIED: "queried",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _bigovPTrans = new Map([
  [
    BIGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      BIGOV_PROFILE_MATURITY_V2.ACTIVE,
      BIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    BIGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      BIGOV_PROFILE_MATURITY_V2.STALE,
      BIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    BIGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      BIGOV_PROFILE_MATURITY_V2.ACTIVE,
      BIGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [BIGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _bigovPTerminal = new Set([BIGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _bigovJTrans = new Map([
  [
    BIGOV_QUERY_LIFECYCLE_V2.QUEUED,
    new Set([
      BIGOV_QUERY_LIFECYCLE_V2.QUERYING,
      BIGOV_QUERY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    BIGOV_QUERY_LIFECYCLE_V2.QUERYING,
    new Set([
      BIGOV_QUERY_LIFECYCLE_V2.QUERIED,
      BIGOV_QUERY_LIFECYCLE_V2.FAILED,
      BIGOV_QUERY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [BIGOV_QUERY_LIFECYCLE_V2.QUERIED, new Set()],
  [BIGOV_QUERY_LIFECYCLE_V2.FAILED, new Set()],
  [BIGOV_QUERY_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _bigovPsV2 = new Map();
const _bigovJsV2 = new Map();
let _bigovMaxActive = 6,
  _bigovMaxPending = 15,
  _bigovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _bigovStuckMs = 60 * 1000;
function _bigovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _bigovCheckP(from, to) {
  const a = _bigovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid bigov profile transition ${from} → ${to}`);
}
function _bigovCheckJ(from, to) {
  const a = _bigovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid bigov query transition ${from} → ${to}`);
}
function _bigovCountActive(owner) {
  let c = 0;
  for (const p of _bigovPsV2.values())
    if (p.owner === owner && p.status === BIGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _bigovCountPending(profileId) {
  let c = 0;
  for (const j of _bigovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === BIGOV_QUERY_LIFECYCLE_V2.QUEUED ||
        j.status === BIGOV_QUERY_LIFECYCLE_V2.QUERYING)
    )
      c++;
  return c;
}
export function setMaxActiveBigovProfilesPerOwnerV2(n) {
  _bigovMaxActive = _bigovPos(n, "maxActiveBigovProfilesPerOwner");
}
export function getMaxActiveBigovProfilesPerOwnerV2() {
  return _bigovMaxActive;
}
export function setMaxPendingBigovQuerysPerProfileV2(n) {
  _bigovMaxPending = _bigovPos(n, "maxPendingBigovQuerysPerProfile");
}
export function getMaxPendingBigovQuerysPerProfileV2() {
  return _bigovMaxPending;
}
export function setBigovProfileIdleMsV2(n) {
  _bigovIdleMs = _bigovPos(n, "bigovProfileIdleMs");
}
export function getBigovProfileIdleMsV2() {
  return _bigovIdleMs;
}
export function setBigovQueryStuckMsV2(n) {
  _bigovStuckMs = _bigovPos(n, "bigovQueryStuckMs");
}
export function getBigovQueryStuckMsV2() {
  return _bigovStuckMs;
}
export function _resetStateBiEngineGovV2() {
  _bigovPsV2.clear();
  _bigovJsV2.clear();
  _bigovMaxActive = 6;
  _bigovMaxPending = 15;
  _bigovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _bigovStuckMs = 60 * 1000;
}
export function registerBigovProfileV2({ id, owner, dataset, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_bigovPsV2.has(id)) throw new Error(`bigov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    dataset: dataset || "default",
    status: BIGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _bigovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateBigovProfileV2(id) {
  const p = _bigovPsV2.get(id);
  if (!p) throw new Error(`bigov profile ${id} not found`);
  const isInitial = p.status === BIGOV_PROFILE_MATURITY_V2.PENDING;
  _bigovCheckP(p.status, BIGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _bigovCountActive(p.owner) >= _bigovMaxActive)
    throw new Error(`max active bigov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = BIGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleBigovProfileV2(id) {
  const p = _bigovPsV2.get(id);
  if (!p) throw new Error(`bigov profile ${id} not found`);
  _bigovCheckP(p.status, BIGOV_PROFILE_MATURITY_V2.STALE);
  p.status = BIGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveBigovProfileV2(id) {
  const p = _bigovPsV2.get(id);
  if (!p) throw new Error(`bigov profile ${id} not found`);
  _bigovCheckP(p.status, BIGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = BIGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchBigovProfileV2(id) {
  const p = _bigovPsV2.get(id);
  if (!p) throw new Error(`bigov profile ${id} not found`);
  if (_bigovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal bigov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getBigovProfileV2(id) {
  const p = _bigovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listBigovProfilesV2() {
  return [..._bigovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createBigovQueryV2({ id, profileId, kpi, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_bigovJsV2.has(id)) throw new Error(`bigov query ${id} already exists`);
  if (!_bigovPsV2.has(profileId))
    throw new Error(`bigov profile ${profileId} not found`);
  if (_bigovCountPending(profileId) >= _bigovMaxPending)
    throw new Error(
      `max pending bigov querys for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    kpi: kpi || "",
    status: BIGOV_QUERY_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _bigovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function queryingBigovQueryV2(id) {
  const j = _bigovJsV2.get(id);
  if (!j) throw new Error(`bigov query ${id} not found`);
  _bigovCheckJ(j.status, BIGOV_QUERY_LIFECYCLE_V2.QUERYING);
  const now = Date.now();
  j.status = BIGOV_QUERY_LIFECYCLE_V2.QUERYING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeQueryBigovV2(id) {
  const j = _bigovJsV2.get(id);
  if (!j) throw new Error(`bigov query ${id} not found`);
  _bigovCheckJ(j.status, BIGOV_QUERY_LIFECYCLE_V2.QUERIED);
  const now = Date.now();
  j.status = BIGOV_QUERY_LIFECYCLE_V2.QUERIED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failBigovQueryV2(id, reason) {
  const j = _bigovJsV2.get(id);
  if (!j) throw new Error(`bigov query ${id} not found`);
  _bigovCheckJ(j.status, BIGOV_QUERY_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = BIGOV_QUERY_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelBigovQueryV2(id, reason) {
  const j = _bigovJsV2.get(id);
  if (!j) throw new Error(`bigov query ${id} not found`);
  _bigovCheckJ(j.status, BIGOV_QUERY_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = BIGOV_QUERY_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getBigovQueryV2(id) {
  const j = _bigovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listBigovQuerysV2() {
  return [..._bigovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleBigovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _bigovPsV2.values())
    if (
      p.status === BIGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _bigovIdleMs
    ) {
      p.status = BIGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckBigovQuerysV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _bigovJsV2.values())
    if (
      j.status === BIGOV_QUERY_LIFECYCLE_V2.QUERYING &&
      j.startedAt != null &&
      t - j.startedAt >= _bigovStuckMs
    ) {
      j.status = BIGOV_QUERY_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getBiEngineGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(BIGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _bigovPsV2.values()) profilesByStatus[p.status]++;
  const querysByStatus = {};
  for (const v of Object.values(BIGOV_QUERY_LIFECYCLE_V2))
    querysByStatus[v] = 0;
  for (const j of _bigovJsV2.values()) querysByStatus[j.status]++;
  return {
    totalBigovProfilesV2: _bigovPsV2.size,
    totalBigovQuerysV2: _bigovJsV2.size,
    maxActiveBigovProfilesPerOwner: _bigovMaxActive,
    maxPendingBigovQuerysPerProfile: _bigovMaxPending,
    bigovProfileIdleMs: _bigovIdleMs,
    bigovQueryStuckMs: _bigovStuckMs,
    profilesByStatus,
    querysByStatus,
  };
}
