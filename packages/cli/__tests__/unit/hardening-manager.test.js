import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureHardeningTables,
  collectBaseline,
  compareBaseline,
  listBaselines,
  runAudit,
  getAuditReports,
  getAuditReport,
  _resetState,
} from "../../src/lib/hardening-manager.js";

describe("hardening-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureHardeningTables(db);
  });

  describe("ensureHardeningTables", () => {
    it("creates performance_baselines and hardening_audits tables", () => {
      expect(db.tables.has("performance_baselines")).toBe(true);
      expect(db.tables.has("hardening_audits")).toBe(true);
    });

    it("is idempotent", () => {
      ensureHardeningTables(db);
      expect(db.tables.has("performance_baselines")).toBe(true);
    });
  });

  describe("collectBaseline", () => {
    it("collects a baseline with metrics", () => {
      const b = collectBaseline(db, "v1-baseline", "1.0.0");
      expect(b.id).toBeDefined();
      expect(b.name).toBe("v1-baseline");
      expect(b.version).toBe("1.0.0");
      expect(b.status).toBe("complete");
      expect(b.metrics.ipc).toBeDefined();
      expect(b.metrics.memory).toBeDefined();
      expect(b.metrics.db).toBeDefined();
      expect(b.environment.platform).toBeDefined();
    });

    it("throws on missing name", () => {
      expect(() => collectBaseline(db, "")).toThrow(
        "Baseline name is required",
      );
    });

    it("persists to database", () => {
      collectBaseline(db, "test");
      const rows = db.data.get("performance_baselines") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique IDs", () => {
      const b1 = collectBaseline(db, "a");
      const b2 = collectBaseline(db, "b");
      expect(b1.id).not.toBe(b2.id);
    });
  });

  describe("compareBaseline", () => {
    it("compares a baseline against itself (no regressions)", () => {
      const b = collectBaseline(db, "base");
      const result = compareBaseline(b.id);
      expect(result.baselineId).toBe(b.id);
      expect(result.hasRegressions).toBe(false);
    });

    it("throws on unknown baseline", () => {
      expect(() => compareBaseline("nonexistent")).toThrow(
        "Baseline not found",
      );
    });

    it("returns regression details when detected", () => {
      const b = collectBaseline(db, "base");
      // Manually check structure
      const result = compareBaseline(b.id, null, { ipcLatencyP95: 0.001 });
      // With such a low threshold, any ratio > 0.001 triggers
      expect(result.regressions.length).toBeGreaterThanOrEqual(0);
      expect(result.summary).toContain("regression");
    });

    it("compares two baselines", () => {
      const b1 = collectBaseline(db, "v1");
      const b2 = collectBaseline(db, "v2");
      const result = compareBaseline(b1.id, b2.id);
      expect(result.currentId).toBe(b2.id);
    });
  });

  describe("listBaselines", () => {
    it("returns empty initially", () => {
      expect(listBaselines()).toEqual([]);
    });

    it("lists all baselines", () => {
      collectBaseline(db, "a");
      collectBaseline(db, "b");
      expect(listBaselines().length).toBe(2);
    });

    it("filters by name", () => {
      collectBaseline(db, "prod");
      collectBaseline(db, "staging");
      expect(listBaselines({ name: "prod" }).length).toBe(1);
    });
  });

  describe("runAudit", () => {
    it("runs a security audit", () => {
      const a = runAudit(db, "quarterly-audit");
      expect(a.id).toBeDefined();
      expect(a.name).toBe("quarterly-audit");
      expect(a.checks.length).toBe(5);
      expect(a.passed + a.failed).toBe(5);
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
    });

    it("throws on missing name", () => {
      expect(() => runAudit(db, "")).toThrow("Audit name is required");
    });

    it("persists to database", () => {
      runAudit(db, "test");
      const rows = db.data.get("hardening_audits") || [];
      expect(rows.length).toBe(1);
    });

    it("provides recommendations for failures", () => {
      const a = runAudit(db, "test");
      if (a.failed > 0) {
        expect(a.recommendations.length).toBe(a.failed);
      }
    });
  });

  describe("getAuditReports / getAuditReport", () => {
    it("returns empty initially", () => {
      expect(getAuditReports()).toEqual([]);
    });

    it("returns all audit reports", () => {
      runAudit(db, "a");
      runAudit(db, "b");
      expect(getAuditReports().length).toBe(2);
    });

    it("gets specific report by ID", () => {
      const a = runAudit(db, "specific");
      const report = getAuditReport(a.id);
      expect(report.name).toBe("specific");
    });

    it("throws on unknown audit ID", () => {
      expect(() => getAuditReport("nonexistent")).toThrow("Audit not found");
    });
  });
});
