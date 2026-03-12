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
