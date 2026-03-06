import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-audit-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockGetStmt, mockDb;
let SecurityAuditor,
  getSecurityAuditor,
  AUDIT_STATUS,
  RISK_LEVELS,
  AUDIT_CATEGORIES;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockGetStmt = { get: vi.fn(() => null) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT") && sql.includes("WHERE id")) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod = await import("../../../src/main/audit/security-auditor.js");
  SecurityAuditor = mod.SecurityAuditor;
  getSecurityAuditor = mod.getSecurityAuditor;
  AUDIT_STATUS = mod.AUDIT_STATUS;
  RISK_LEVELS = mod.RISK_LEVELS;
  AUDIT_CATEGORIES = mod.AUDIT_CATEGORIES;
});

describe("Constants", () => {
  it("should define AUDIT_STATUS", () => {
    expect(AUDIT_STATUS.RUNNING).toBe("running");
    expect(AUDIT_STATUS.COMPLETE).toBe("complete");
  });

  it("should define RISK_LEVELS", () => {
    expect(RISK_LEVELS.CRITICAL).toBe("critical");
    expect(RISK_LEVELS.HIGH).toBe("high");
    expect(RISK_LEVELS.LOW).toBe("low");
  });

  it("should define AUDIT_CATEGORIES", () => {
    expect(AUDIT_CATEGORIES.CONFIG).toBe("config");
    expect(AUDIT_CATEGORIES.CRYPTO).toBe("crypto");
    expect(AUDIT_CATEGORIES.DEPENDENCY).toBe("dependency");
  });
});

describe("SecurityAuditor", () => {
  let auditor;

  beforeEach(() => {
    auditor = new SecurityAuditor({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(auditor.initialized).toBe(false);
      expect(auditor._reports).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await auditor.initialize();
      expect(auditor.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create audit tables", () => {
      auditor._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS security_audit_reports",
      );
    });

    it("should not throw if database is null", () => {
      const a = new SecurityAuditor(null);
      expect(() => a._ensureTables()).not.toThrow();
    });
  });

  describe("runAudit()", () => {
    it("should run audit with defaults", async () => {
      const report = await auditor.runAudit();
      expect(report.status).toBe("complete");
      expect(report.findings).toBeInstanceOf(Array);
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.risk_score).toBeDefined();
    });

    it("should run audit with specific categories", async () => {
      const report = await auditor.runAudit({ categories: ["config"] });
      expect(report.findings.length).toBeGreaterThan(0);
    });

    it("should persist to DB", async () => {
      await auditor.runAudit();
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("getReports()", () => {
    it("should return reports from in-memory", async () => {
      const a = new SecurityAuditor(null);
      a._reports.set("r1", { id: "r1", created_at: 1000 });
      const reports = await a.getReports();
      expect(reports).toHaveLength(1);
    });
  });

  describe("getReport()", () => {
    it("should throw if reportId is missing", async () => {
      await expect(auditor.getReport()).rejects.toThrow(
        "Report ID is required",
      );
    });

    it("should return report from memory", async () => {
      auditor._reports.set("r1", { id: "r1" });
      const report = await auditor.getReport("r1");
      expect(report.id).toBe("r1");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      auditor._reports.set("r1", {});
      await auditor.close();
      expect(auditor._reports.size).toBe(0);
      expect(auditor.initialized).toBe(false);
    });
  });

  describe("getSecurityAuditor singleton", () => {
    it("should return an instance", () => {
      const instance = getSecurityAuditor();
      expect(instance).toBeInstanceOf(SecurityAuditor);
    });
  });
});
