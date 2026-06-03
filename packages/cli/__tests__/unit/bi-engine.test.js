import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureBITables,
  nlQuery,
  createDashboard,
  generateReport,
  scheduleReport,
  detectAnomaly,
  predictTrend,
  listTemplates,
  exportReport,
  _resetState,
  // Phase 95 V2
  CHART_TYPE,
  ANOMALY_METHOD,
  REPORT_FORMAT,
  REPORT_STATUS,
  DASHBOARD_LAYOUT,
  nlQueryV2,
  detectAnomalyV2,
  predictTrendV2,
  recommendChart,
  createDashboardV2,
  updateReportStatus,
  getReportStatus,
  getReportStatusHistory,
  getBIStatsV2,
  _resetV2State,
} from "../../src/lib/bi-engine.js";

describe("bi-engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    _resetV2State();
    ensureBITables(db);
  });

  // ─── ensureBITables ───────────────────────────────────────

  describe("ensureBITables", () => {
    it("creates all 3 BI tables", () => {
      expect(db.tables.has("bi_dashboards")).toBe(true);
      expect(db.tables.has("bi_reports")).toBe(true);
      expect(db.tables.has("bi_scheduled")).toBe(true);
    });

    it("is idempotent", () => {
      ensureBITables(db);
      ensureBITables(db);
      expect(db.tables.has("bi_dashboards")).toBe(true);
    });
  });

  // ─── nlQuery ──────────────────────────────────────────────

  describe("nlQuery", () => {
    it("translates a natural language query to SQL", () => {
      const result = nlQuery("show all active users");
      expect(result.generatedSQL).toContain("SELECT");
      expect(result.generatedSQL).toContain("LIKE");
      expect(result.query).toBe("show all active users");
    });

    it("returns query ID", () => {
      const result = nlQuery("total revenue");
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
    });

    it("returns visualization metadata", () => {
      const result = nlQuery("count records");
      expect(result.visualization).toBeDefined();
      expect(result.visualization.type).toBe("table");
    });

    it("returns rowCount", () => {
      const result = nlQuery("some data");
      expect(result.rowCount).toBe(0);
    });

    it("throws on empty query", () => {
      expect(() => nlQuery("")).toThrow("non-empty string");
    });

    it("throws on null query", () => {
      expect(() => nlQuery(null)).toThrow("non-empty string");
    });
  });

  // ─── createDashboard ─────────────────────────────────────

  describe("createDashboard", () => {
    it("creates a dashboard with widgets", () => {
      const d = createDashboard(db, "My Dashboard", ["chart", "table"], {
        type: "flex",
      });
      expect(d.id).toBeDefined();
      expect(d.name).toBe("My Dashboard");
      expect(d.widgets).toEqual(["chart", "table"]);
      expect(d.layout.type).toBe("flex");
    });

    it("uses default layout when none provided", () => {
      const d = createDashboard(db, "Default", []);
      expect(d.layout.type).toBe("grid");
      expect(d.layout.columns).toBe(2);
    });

    it("persists to database", () => {
      createDashboard(db, "Persisted", ["widget"]);
      const rows = db.data.get("bi_dashboards") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Persisted");
    });

    it("generates unique IDs", () => {
      const d1 = createDashboard(db, "A", []);
      const d2 = createDashboard(db, "B", []);
      expect(d1.id).not.toBe(d2.id);
    });
  });

  // ─── generateReport ──────────────────────────────────────

  describe("generateReport", () => {
    it("generates a report with default sections", () => {
      const r = generateReport(db, "Monthly Report", {});
      expect(r.id).toBeDefined();
      expect(r.name).toBe("Monthly Report");
      expect(r.format).toBe("pdf");
      expect(r.sections.length).toBe(3);
      expect(r.sections.map((s) => s.name)).toEqual([
        "summary",
        "details",
        "conclusion",
      ]);
    });

    it("uses custom format", () => {
      const r = generateReport(db, "Excel Report", { format: "excel" });
      expect(r.format).toBe("excel");
    });

    it("uses custom sections", () => {
      const r = generateReport(db, "Custom", { sections: ["intro", "body"] });
      expect(r.sections.length).toBe(2);
      expect(r.sections[0].name).toBe("intro");
    });

    it("includes generatedAt timestamp", () => {
      const r = generateReport(db, "Timed", {});
      expect(r.generatedAt).toBeDefined();
    });

    it("persists to database", () => {
      generateReport(db, "Persisted", {});
      const rows = db.data.get("bi_reports") || [];
      expect(rows.length).toBe(1);
    });
  });

  // ─── detectAnomaly ────────────────────────────────────────

  describe("detectAnomaly", () => {
    it("detects no anomalies in uniform data", () => {
      const result = detectAnomaly([5, 5, 5, 5, 5]);
      expect(result.anomalies.length).toBe(0);
      expect(result.mean).toBe(5);
      expect(result.std).toBe(0);
    });

    it("detects outlier in data", () => {
      const data = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100];
      const result = detectAnomaly(data);
      expect(result.anomalies.length).toBeGreaterThan(0);
      const outlier = result.anomalies.find((a) => a.value === 100);
      expect(outlier).toBeDefined();
    });

    it("respects custom threshold", () => {
      const data = [10, 10, 10, 10, 10, 10, 10, 10, 10, 25];
      const loose = detectAnomaly(data, { threshold: 5 });
      const strict = detectAnomaly(data, { threshold: 1 });
      expect(strict.anomalies.length).toBeGreaterThanOrEqual(
        loose.anomalies.length,
      );
    });

    it("returns mean, std, and threshold", () => {
      const result = detectAnomaly([1, 2, 3, 4, 5]);
      expect(result.mean).toBe(3);
      expect(result.std).toBeGreaterThan(0);
      expect(result.threshold).toBe(2);
    });

    it("throws on empty data", () => {
      expect(() => detectAnomaly([])).toThrow("non-empty array");
    });

    it("throws on non-array data", () => {
      expect(() => detectAnomaly("not-array")).toThrow("non-empty array");
    });

    it("handles all-same values (std=0) without false positives", () => {
      const result = detectAnomaly([7, 7, 7, 7]);
      expect(result.anomalies.length).toBe(0);
    });
  });

  // ─── predictTrend ─────────────────────────────────────────

  describe("predictTrend", () => {
    it("predicts upward trend", () => {
      const result = predictTrend([1, 2, 3, 4, 5]);
      expect(result.trend).toBe("up");
      expect(result.slope).toBeGreaterThan(0);
      expect(result.predictions.length).toBe(3);
      // Predictions should be > 5
      expect(result.predictions[0]).toBeGreaterThan(5);
    });

    it("predicts downward trend", () => {
      const result = predictTrend([10, 8, 6, 4, 2]);
      expect(result.trend).toBe("down");
      expect(result.slope).toBeLessThan(0);
    });

    it("predicts flat trend", () => {
      const result = predictTrend([5, 5, 5, 5]);
      expect(result.trend).toBe("flat");
    });

    it("respects periods parameter", () => {
      const result = predictTrend([1, 2, 3], 5);
      expect(result.predictions.length).toBe(5);
    });

    it("defaults to 3 prediction periods", () => {
      const result = predictTrend([1, 2, 3]);
      expect(result.predictions.length).toBe(3);
    });

    it("throws on insufficient data", () => {
      expect(() => predictTrend([1])).toThrow("at least 2 points");
    });

    it("throws on non-array data", () => {
      expect(() => predictTrend("not-array")).toThrow("at least 2 points");
    });
  });

  // ─── listTemplates ────────────────────────────────────────

  describe("listTemplates", () => {
    it("returns 5 templates", () => {
      const templates = listTemplates();
      expect(templates.length).toBe(5);
    });

    it("includes expected template names", () => {
      const names = listTemplates().map((t) => t.name);
      expect(names).toContain("KPI Dashboard");
      expect(names).toContain("Sales Report");
      expect(names).toContain("Operations Dashboard");
      expect(names).toContain("HR Analytics");
      expect(names).toContain("Financial Overview");
    });

    it("each template has id, name, description, widgets", () => {
      for (const t of listTemplates()) {
        expect(t.id).toBeDefined();
        expect(t.name).toBeDefined();
        expect(t.description).toBeDefined();
        expect(Array.isArray(t.widgets)).toBe(true);
      }
    });
  });

  // ─── scheduleReport ───────────────────────────────────────

  describe("scheduleReport", () => {
    it("schedules a report with cron expression", () => {
      const s = scheduleReport(db, "rpt-1", "0 9 * * 1", ["admin@test.com"]);
      expect(s.id).toBeDefined();
      expect(s.reportId).toBe("rpt-1");
      expect(s.cron).toBe("0 9 * * 1");
      expect(s.recipients).toEqual(["admin@test.com"]);
      expect(s.status).toBe("active");
    });

    it("defaults recipients to empty", () => {
      const s = scheduleReport(db, "rpt-2", "0 0 * * *");
      expect(s.recipients).toEqual([]);
    });

    it("persists to database", () => {
      scheduleReport(db, "rpt-3", "0 0 * * *", []);
      const rows = db.data.get("bi_scheduled") || [];
      expect(rows.length).toBe(1);
    });
  });

  // ─── exportReport ─────────────────────────────────────────

  describe("exportReport", () => {
    it("exports an existing report", () => {
      const r = generateReport(db, "Export Test", { format: "pdf" });
      const exp = exportReport(r.id, "pdf");
      expect(exp.reportId).toBe(r.id);
      expect(exp.format).toBe("pdf");
      expect(exp.filename).toContain("Export_Test");
    });

    it("throws on unknown report", () => {
      expect(() => exportReport("nonexistent", "pdf")).toThrow(
        "Report not found",
      );
    });

    it("uses report format when not specified", () => {
      const r = generateReport(db, "Default Format", { format: "excel" });
      const exp = exportReport(r.id);
      expect(exp.format).toBe("excel");
    });
  });

  // ─── V2 frozen enums ─────────────────────────────────────

  describe("V2 frozen enums", () => {
    it("CHART_TYPE has 9 chart types and is frozen", () => {
      expect(Object.isFrozen(CHART_TYPE)).toBe(true);
      expect(Object.values(CHART_TYPE).length).toBe(9);
      expect(CHART_TYPE.LINE).toBe("line");
      expect(CHART_TYPE.BAR).toBe("bar");
    });

    it("ANOMALY_METHOD has 2 methods and is frozen", () => {
      expect(Object.isFrozen(ANOMALY_METHOD)).toBe(true);
      expect(ANOMALY_METHOD.Z_SCORE).toBe("z_score");
      expect(ANOMALY_METHOD.IQR).toBe("iqr");
    });

    it("REPORT_FORMAT covers pdf/excel/csv/json", () => {
      expect(Object.isFrozen(REPORT_FORMAT)).toBe(true);
      expect(Object.values(REPORT_FORMAT).sort()).toEqual([
        "csv",
        "excel",
        "json",
        "pdf",
      ]);
    });

    it("REPORT_STATUS covers 4 canonical states", () => {
      expect(Object.isFrozen(REPORT_STATUS)).toBe(true);
      expect(REPORT_STATUS.DRAFT).toBe("draft");
      expect(REPORT_STATUS.GENERATED).toBe("generated");
      expect(REPORT_STATUS.SCHEDULED).toBe("scheduled");
      expect(REPORT_STATUS.ARCHIVED).toBe("archived");
    });

    it("DASHBOARD_LAYOUT covers grid/flow/tabs", () => {
      expect(Object.isFrozen(DASHBOARD_LAYOUT)).toBe(true);
      expect(DASHBOARD_LAYOUT.GRID).toBe("grid");
      expect(DASHBOARD_LAYOUT.FLOW).toBe("flow");
      expect(DASHBOARD_LAYOUT.TABS).toBe("tabs");
    });
  });

  // ─── nlQueryV2 ───────────────────────────────────────────

  describe("nlQueryV2", () => {
    it("detects count intent and picks BAR chart", () => {
      const r = nlQueryV2({ query: "count of users" });
      expect(r.intent).toBe("count");
      expect(r.aggregate).toBe("COUNT(*)");
      expect(r.visualization).toBe(CHART_TYPE.BAR);
    });

    it("detects sum intent and picks GAUGE chart", () => {
      const r = nlQueryV2({ query: "total revenue" });
      expect(r.intent).toBe("sum");
      expect(r.visualization).toBe(CHART_TYPE.GAUGE);
    });

    it("detects avg intent", () => {
      const r = nlQueryV2({ query: "average order value" });
      expect(r.intent).toBe("avg");
      expect(r.aggregate).toContain("AVG");
    });

    it("detects trend intent and picks LINE chart", () => {
      const r = nlQueryV2({ query: "revenue trend over time" });
      expect(r.intent).toBe("trend");
      expect(r.visualization).toBe(CHART_TYPE.LINE);
      expect(r.sql).toContain("ORDER BY created_at");
    });

    it("detects top N and builds LIMIT clause", () => {
      const r = nlQueryV2({ query: "top 5 products" });
      expect(r.intent).toBe("top");
      expect(r.limit).toBe(5);
      expect(r.sql).toContain("LIMIT 5");
      expect(r.visualization).toBe(CHART_TYPE.BAR);
    });

    it("defaults to TABLE + SELECT * for generic list queries", () => {
      const r = nlQueryV2({ query: "show me users" });
      expect(r.intent).toBe("list");
      expect(r.visualization).toBe(CHART_TYPE.TABLE);
      expect(r.sql).toContain("SELECT *");
    });

    it("picks table name from schema when query mentions it", () => {
      const r = nlQueryV2({
        query: "list all orders",
        schema: { tables: ["users", "orders", "products"] },
      });
      expect(r.table).toBe("orders");
      expect(r.sql).toContain("FROM orders");
    });

    it("falls back to 'data' when schema match not found", () => {
      const r = nlQueryV2({
        query: "show widgets",
        schema: { tables: ["users", "orders"] },
      });
      expect(r.table).toBe("data");
    });

    it("throws on empty query", () => {
      expect(() => nlQueryV2({ query: "" })).toThrow("non-empty string");
    });

    it("throws on non-string query", () => {
      expect(() => nlQueryV2({ query: 123 })).toThrow("non-empty string");
    });
  });

  // ─── detectAnomalyV2 ─────────────────────────────────────

  describe("detectAnomalyV2", () => {
    it("defaults to z_score method", () => {
      const r = detectAnomalyV2({ data: [1, 2, 3, 100, 4, 5] });
      expect(r.method).toBe(ANOMALY_METHOD.Z_SCORE);
      expect(r.anomalies.length).toBeGreaterThan(0);
    });

    it("supports IQR method and finds outliers", () => {
      const data = [10, 12, 14, 13, 15, 11, 100];
      const r = detectAnomalyV2({ data, method: ANOMALY_METHOD.IQR });
      expect(r.method).toBe("iqr");
      expect(r.q1).toBeDefined();
      expect(r.q3).toBeDefined();
      expect(r.iqr).toBeGreaterThan(0);
      const flagged = r.anomalies.map((a) => a.value);
      expect(flagged).toContain(100);
    });

    it("IQR returns no anomalies for uniform data", () => {
      const data = [10, 10, 11, 10, 11, 10, 11];
      const r = detectAnomalyV2({ data, method: ANOMALY_METHOD.IQR });
      expect(r.anomalies.length).toBe(0);
    });

    it("rejects unknown method", () => {
      expect(() =>
        detectAnomalyV2({ data: [1, 2, 3], method: "random" }),
      ).toThrow("Invalid method");
    });

    it("rejects empty data", () => {
      expect(() => detectAnomalyV2({ data: [] })).toThrow("non-empty array");
    });

    it("respects custom IQR multiplier", () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 25];
      const strict = detectAnomalyV2({
        data,
        method: ANOMALY_METHOD.IQR,
        threshold: 1.0,
      });
      const loose = detectAnomalyV2({
        data,
        method: ANOMALY_METHOD.IQR,
        threshold: 3.0,
      });
      expect(strict.anomalies.length).toBeGreaterThanOrEqual(
        loose.anomalies.length,
      );
    });
  });

  // ─── predictTrendV2 ──────────────────────────────────────

  describe("predictTrendV2", () => {
    it("returns r² and confidence for linear trend", () => {
      const r = predictTrendV2({ data: [1, 2, 3, 4, 5] });
      expect(r.r2).toBeGreaterThanOrEqual(0.95);
      expect(r.confidence).toBe("high");
      expect(r.trend).toBe("up");
    });

    it("labels noisy data as medium or low confidence", () => {
      const r = predictTrendV2({ data: [1, 9, 2, 8, 3, 7] });
      expect(["medium", "low"]).toContain(r.confidence);
    });

    it("defaults to 3 prediction periods", () => {
      const r = predictTrendV2({ data: [1, 2, 3] });
      expect(r.predictions.length).toBe(3);
    });

    it("rejects non-linear method", () => {
      expect(() =>
        predictTrendV2({ data: [1, 2], method: "polynomial" }),
      ).toThrow("Only 'linear' is supported");
    });

    it("rejects insufficient data", () => {
      expect(() => predictTrendV2({ data: [5] })).toThrow("at least 2 points");
    });

    it("clamps r² into [0,1] for constant data", () => {
      const r = predictTrendV2({ data: [5, 5, 5, 5] });
      expect(r.r2).toBeGreaterThanOrEqual(0);
      expect(r.r2).toBeLessThanOrEqual(1);
    });
  });

  // ─── recommendChart ──────────────────────────────────────

  describe("recommendChart", () => {
    it("picks LINE for trend intent", () => {
      expect(recommendChart({ intent: "trend" })).toBe(CHART_TYPE.LINE);
    });

    it("picks PIE for distribution intent", () => {
      expect(recommendChart({ intent: "distribution" })).toBe(CHART_TYPE.PIE);
    });

    it("picks BAR for compare/top intent", () => {
      expect(recommendChart({ intent: "compare monthly" })).toBe(
        CHART_TYPE.BAR,
      );
      expect(recommendChart({ intent: "top N sellers" })).toBe(CHART_TYPE.BAR);
    });

    it("picks SCATTER for correlation intent", () => {
      expect(recommendChart({ intent: "correlation x vs y" })).toBe(
        CHART_TYPE.SCATTER,
      );
    });

    it("picks LINE when dataShape is timeseries", () => {
      expect(recommendChart({ dataShape: { timeseries: true } })).toBe(
        CHART_TYPE.LINE,
      );
    });

    it("falls back to TABLE when no signal", () => {
      expect(recommendChart({})).toBe(CHART_TYPE.TABLE);
    });
  });

  // ─── createDashboardV2 ───────────────────────────────────

  describe("createDashboardV2", () => {
    it("creates dashboard with default grid layout", () => {
      const d = createDashboardV2(db, { name: "D1" });
      expect(d.layout.type).toBe("grid");
    });

    it("accepts layout as string", () => {
      const d = createDashboardV2(db, { name: "D2", layout: "flow" });
      expect(d.layout.type).toBe("flow");
    });

    it("accepts layout as object", () => {
      const d = createDashboardV2(db, {
        name: "D3",
        layout: { type: "tabs", columns: 3 },
      });
      expect(d.layout.type).toBe("tabs");
      expect(d.layout.columns).toBe(3);
    });

    it("rejects invalid layout string", () => {
      expect(() =>
        createDashboardV2(db, { name: "bad", layout: "masonry" }),
      ).toThrow("Invalid layout");
    });

    it("rejects missing name", () => {
      expect(() => createDashboardV2(db, {})).toThrow("name is required");
    });
  });

  // ─── updateReportStatus state machine ────────────────────

  describe("updateReportStatus", () => {
    it("transitions draft → generated", () => {
      const r = updateReportStatus(db, {
        reportId: "r1",
        status: REPORT_STATUS.GENERATED,
      });
      expect(r.previous).toBe("draft");
      expect(r.status).toBe("generated");
    });

    it("transitions generated → scheduled", () => {
      updateReportStatus(db, {
        reportId: "r2",
        status: REPORT_STATUS.GENERATED,
      });
      const r = updateReportStatus(db, {
        reportId: "r2",
        status: REPORT_STATUS.SCHEDULED,
      });
      expect(r.status).toBe("scheduled");
    });

    it("rejects draft → scheduled (must go through generated)", () => {
      expect(() =>
        updateReportStatus(db, {
          reportId: "r3",
          status: REPORT_STATUS.SCHEDULED,
        }),
      ).toThrow("Invalid status transition");
    });

    it("rejects archived → generated (must go via draft)", () => {
      updateReportStatus(db, {
        reportId: "r4",
        status: REPORT_STATUS.ARCHIVED,
      });
      expect(() =>
        updateReportStatus(db, {
          reportId: "r4",
          status: REPORT_STATUS.GENERATED,
        }),
      ).toThrow("Invalid status transition");
    });

    it("allows archived → draft", () => {
      updateReportStatus(db, {
        reportId: "r5",
        status: REPORT_STATUS.ARCHIVED,
      });
      const r = updateReportStatus(db, {
        reportId: "r5",
        status: REPORT_STATUS.DRAFT,
      });
      expect(r.status).toBe("draft");
    });

    it("records transition history", () => {
      updateReportStatus(db, {
        reportId: "r6",
        status: REPORT_STATUS.GENERATED,
      });
      updateReportStatus(db, {
        reportId: "r6",
        status: REPORT_STATUS.ARCHIVED,
      });
      const hist = getReportStatusHistory("r6");
      expect(hist).toHaveLength(2);
      expect(hist[0].from).toBe("draft");
      expect(hist[0].to).toBe("generated");
    });

    it("getReportStatus returns draft by default", () => {
      expect(getReportStatus("never-touched")).toBe("draft");
    });

    it("rejects invalid status value", () => {
      expect(() =>
        updateReportStatus(db, { reportId: "r7", status: "published" }),
      ).toThrow("Invalid status");
    });
  });

  // ─── getBIStatsV2 ────────────────────────────────────────

  describe("getBIStatsV2", () => {
    it("returns zeros for empty DB", () => {
      const s = getBIStatsV2(db);
      expect(s.dashboards).toBe(0);
      expect(s.reports.total).toBe(0);
      expect(s.scheduled).toBe(0);
      expect(s.templates).toBe(5);
      expect(s.chartTypes).toBe(9);
    });

    it("aggregates dashboards + reports + scheduled counts", () => {
      createDashboardV2(db, { name: "D1" });
      createDashboardV2(db, { name: "D2" });
      const r1 = generateReport(db, "R1", { format: "pdf" });
      const r2 = generateReport(db, "R2", { format: "excel" });
      scheduleReport(db, r1.id, "0 0 * * *");
      updateReportStatus(db, {
        reportId: r1.id,
        status: REPORT_STATUS.GENERATED,
      });
      updateReportStatus(db, {
        reportId: r2.id,
        status: REPORT_STATUS.ARCHIVED,
      });

      const s = getBIStatsV2(db);
      expect(s.dashboards).toBe(2);
      expect(s.reports.total).toBe(2);
      expect(s.scheduled).toBe(1);
      expect(s.reports.byStatus.generated).toBe(1);
      expect(s.reports.byStatus.archived).toBe(1);
      expect(s.reports.byFormat.pdf).toBe(1);
      expect(s.reports.byFormat.excel).toBe(1);
    });
  });
});
