/**
 * BIEngine unit tests — Phase 95
 *
 * Covers: initialize, nlQuery, generateReport, createDashboard, detectAnomaly,
 *         predictTrend, listTemplates, exportReport, scheduleReport
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { BIEngine } = require("../bi-engine");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("BIEngine", () => {
  let bi;
  let db;

  beforeEach(() => {
    bi = new BIEngine();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(bi.initialized).toBe(false);
    expect(bi._dashboards.size).toBe(0);
    expect(bi._reports.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize and load default templates", async () => {
    await bi.initialize(db);
    expect(bi.initialized).toBe(true);
    expect(bi._templates.size).toBe(5);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await bi.initialize(db);
    await bi.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── nlQuery ──────────────────────────────────────────────────────────────
  it("should translate natural language to SQL", async () => {
    await bi.initialize(db);
    const result = await bi.nlQuery("show me all sales");
    expect(result.id).toMatch(/^query-/);
    expect(result.query).toBe("show me all sales");
    expect(result.generatedSQL).toContain("SELECT");
    expect(result.visualization).toBeDefined();
  });

  it("should emit bi:query-executed event", async () => {
    await bi.initialize(db);
    const listener = vi.fn();
    bi.on("bi:query-executed", listener);
    await bi.nlQuery("total revenue");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ query: "total revenue" }),
    );
  });

  // ── generateReport ───────────────────────────────────────────────────────
  it("should generate a report", async () => {
    await bi.initialize(db);
    const report = await bi.generateReport("Q1 Sales", { format: "xlsx" });
    expect(report.id).toMatch(/^report-/);
    expect(report.name).toBe("Q1 Sales");
    expect(report.format).toBe("xlsx");
    expect(report.sections).toContain("summary");
  });

  it("should default to pdf format", async () => {
    await bi.initialize(db);
    const report = await bi.generateReport("Test");
    expect(report.format).toBe("pdf");
  });

  it("should emit bi:report-generated event", async () => {
    await bi.initialize(db);
    const listener = vi.fn();
    bi.on("bi:report-generated", listener);
    await bi.generateReport("Test");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test" }),
    );
  });

  // ── createDashboard ──────────────────────────────────────────────────────
  it("should create a dashboard", async () => {
    await bi.initialize(db);
    const widgets = ["chart-1", "table-1"];
    const dash = bi.createDashboard("Sales Dashboard", widgets, { columns: 2 });
    expect(dash.id).toMatch(/^dash-/);
    expect(dash.name).toBe("Sales Dashboard");
    expect(dash.widgets).toEqual(widgets);
  });

  it("should emit bi:dashboard-created event", async () => {
    await bi.initialize(db);
    const listener = vi.fn();
    bi.on("bi:dashboard-created", listener);
    bi.createDashboard("Test", []);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test" }),
    );
  });

  // ── detectAnomaly ────────────────────────────────────────────────────────
  it("should detect anomalies in data", () => {
    const data = [10, 11, 10, 12, 10, 11, 100]; // 100 is an outlier
    const result = bi.detectAnomaly(data);
    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies[0].value).toBe(100);
    expect(result.mean).toBeDefined();
    expect(result.std).toBeDefined();
  });

  it("should return no anomalies for uniform data", () => {
    const data = [10, 10, 10, 10, 10];
    const result = bi.detectAnomaly(data);
    expect(result.anomalies).toHaveLength(0);
  });

  it("should return insufficient data message for small datasets", () => {
    const result = bi.detectAnomaly([1, 2]);
    expect(result.message).toMatch(/Insufficient/);
    expect(result.anomalies).toHaveLength(0);
  });

  // ── predictTrend ─────────────────────────────────────────────────────────
  it("should predict upward trend", () => {
    const data = [10, 20, 30, 40, 50];
    const result = bi.predictTrend(data, 3);
    expect(result.trend).toBe("upward");
    expect(result.predictions).toHaveLength(3);
    expect(result.slope).toBeGreaterThan(0);
  });

  it("should predict downward trend", () => {
    const data = [50, 40, 30, 20, 10];
    const result = bi.predictTrend(data, 2);
    expect(result.trend).toBe("downward");
    expect(result.slope).toBeLessThan(0);
  });

  it("should return insufficient data message for single point", () => {
    const result = bi.predictTrend([10]);
    expect(result.message).toMatch(/Insufficient/);
  });

  // ── listTemplates ────────────────────────────────────────────────────────
  it("should list default templates", async () => {
    await bi.initialize(db);
    const templates = bi.listTemplates();
    expect(templates.length).toBe(5);
    expect(templates.find((t) => t.id === "tmpl-kpi")).toBeDefined();
    expect(templates.find((t) => t.id === "tmpl-sales")).toBeDefined();
  });

  // ── exportReport ─────────────────────────────────────────────────────────
  it("should export existing report", async () => {
    await bi.initialize(db);
    const report = await bi.generateReport("Test");
    const exported = bi.exportReport(report.id, "csv");
    expect(exported.exportFormat).toBe("csv");
    expect(exported.exportedAt).toBeDefined();
  });

  it("should return null for unknown report", async () => {
    await bi.initialize(db);
    expect(bi.exportReport("nonexistent")).toBeNull();
  });

  // ── scheduleReport ───────────────────────────────────────────────────────
  it("should schedule a report", async () => {
    await bi.initialize(db);
    const report = await bi.generateReport("Weekly");
    const scheduled = bi.scheduleReport(report.id, "0 9 * * 1", [
      "admin@test.com",
    ]);
    expect(scheduled.id).toMatch(/^sched-/);
    expect(scheduled.cron).toBe("0 9 * * 1");
    expect(scheduled.recipients).toContain("admin@test.com");
    expect(scheduled.status).toBe("active");
  });
});
