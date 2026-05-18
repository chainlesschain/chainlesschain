/**
 * @module enterprise/bi/bi-engine
 * Phase 95: Business Intelligence - NL->SQL, OLAP, reports, anomaly detection, dashboards
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class BIEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._dashboards = new Map();
    this._reports = new Map();
    this._scheduledReports = new Map();
    this._templates = new Map();
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._llmManager = deps.llmManager || null;
    this._ensureTables();
    this._loadDefaultTemplates();
    this.initialized = true;
    logger.info("[BIEngine] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS bi_dashboards (
          id TEXT PRIMARY KEY, name TEXT, widgets TEXT, layout TEXT,
          created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS bi_reports (
          id TEXT PRIMARY KEY, name TEXT, query TEXT, result TEXT, format TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS bi_scheduled (
          id TEXT PRIMARY KEY, report_id TEXT, cron TEXT, recipients TEXT,
          last_run TEXT, status TEXT DEFAULT 'active'
        );
      `);
    } catch (error) {
      logger.warn("[BIEngine] Table creation warning:", error.message);
    }
  }

  _loadDefaultTemplates() {
    const templates = [
      {
        id: "tmpl-kpi",
        name: "KPI Dashboard",
        widgets: ["metric-card", "trend-chart", "comparison-table"],
      },
      {
        id: "tmpl-sales",
        name: "Sales Report",
        widgets: ["revenue-chart", "pipeline-table", "forecast-line"],
      },
      {
        id: "tmpl-ops",
        name: "Operations Dashboard",
        widgets: ["uptime-gauge", "error-rate-chart", "latency-histogram"],
      },
      {
        id: "tmpl-hr",
        name: "HR Analytics",
        widgets: ["headcount-chart", "retention-metric", "hiring-funnel"],
      },
      {
        id: "tmpl-finance",
        name: "Financial Overview",
        widgets: ["pl-statement", "cashflow-chart", "budget-comparison"],
      },
    ];
    for (const t of templates) {
      this._templates.set(t.id, t);
    }
  }

  // NL -> SQL
  async nlQuery(naturalLanguageQuery) {
    const id = `query-${Date.now()}`;
    // In production, LLM translates NL -> SQL
    const generatedSQL = `SELECT * FROM data WHERE description LIKE '%${naturalLanguageQuery.replace(/'/g, "''")}%' LIMIT 100`;
    const result = {
      id,
      query: naturalLanguageQuery,
      generatedSQL,
      results: [],
      rowCount: 0,
      visualization: { type: "table", title: naturalLanguageQuery },
    };
    this.emit("bi:query-executed", { id, query: naturalLanguageQuery });
    return result;
  }

  async generateReport(name, options = {}) {
    const id = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const report = {
      id,
      name,
      format: options.format || "pdf",
      sections: options.sections || ["summary", "charts", "data"],
      generatedAt: Date.now(),
      data: options.data || {},
    };
    this._reports.set(id, report);
    try {
      this.db
        .prepare(
          "INSERT INTO bi_reports (id, name, query, result, format) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          id,
          name,
          options.query || "",
          JSON.stringify(report),
          report.format,
        );
    } catch (error) {
      logger.error("[BIEngine] Report persist failed:", error.message);
    }
    this.emit("bi:report-generated", { id, name, format: report.format });
    return report;
  }

  createDashboard(name, widgets = [], layout = {}) {
    const id = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dashboard = { id, name, widgets, layout };
    this._dashboards.set(id, dashboard);
    try {
      this.db
        .prepare(
          "INSERT INTO bi_dashboards (id, name, widgets, layout) VALUES (?, ?, ?, ?)",
        )
        .run(id, name, JSON.stringify(widgets), JSON.stringify(layout));
    } catch (error) {
      logger.error("[BIEngine] Dashboard persist failed:", error.message);
    }
    this.emit("bi:dashboard-created", { id, name });
    return dashboard;
  }

  detectAnomaly(data, options = {}) {
    if (!Array.isArray(data) || data.length < 3) {
      return { anomalies: [], message: "Insufficient data" };
    }
    const values = data.map((d) => (typeof d === "number" ? d : d.value || 0));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length,
    );
    const threshold = options.threshold || 2;
    const anomalies = values
      .map((v, i) => ({
        index: i,
        value: v,
        zScore: std > 0 ? (v - mean) / std : 0,
      }))
      .filter((a) => Math.abs(a.zScore) > threshold);
    return { anomalies, mean, std, threshold };
  }

  predictTrend(data, periods = 5) {
    if (!Array.isArray(data) || data.length < 2) {
      return { predictions: [], message: "Insufficient data" };
    }
    const values = data.map((d) => (typeof d === "number" ? d : d.value || 0));
    const n = values.length;
    const slope = (values[n - 1] - values[0]) / (n - 1);
    const lastValue = values[n - 1];
    const predictions = [];
    for (let i = 1; i <= periods; i++) {
      predictions.push({
        period: n + i,
        value: lastValue + slope * i,
        confidence: Math.max(0.5, 1 - i * 0.1),
      });
    }
    return {
      predictions,
      trend: slope > 0 ? "upward" : slope < 0 ? "downward" : "flat",
      slope,
    };
  }

  listTemplates() {
    return Array.from(this._templates.values());
  }

  exportReport(reportId, format) {
    const report = this._reports.get(reportId);
    if (!report) {
      return null;
    }
    return {
      ...report,
      exportFormat: format || report.format,
      exportedAt: Date.now(),
    };
  }

  scheduleReport(reportId, cron, recipients = []) {
    const id = `sched-${Date.now()}`;
    const scheduled = { id, reportId, cron, recipients, status: "active" };
    this._scheduledReports.set(id, scheduled);
    try {
      this.db
        .prepare(
          "INSERT INTO bi_scheduled (id, report_id, cron, recipients, status) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, reportId, cron, JSON.stringify(recipients), "active");
    } catch (error) {
      logger.error("[BIEngine] Schedule persist failed:", error.message);
    }
    return scheduled;
  }
}

let instance = null;
function getBIEngine() {
  if (!instance) {
    instance = new BIEngine();
  }
  return instance;
}
module.exports = { BIEngine, getBIEngine };
