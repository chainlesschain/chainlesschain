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
} from "../../src/lib/bi-engine.js";

describe("bi-engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
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
});
