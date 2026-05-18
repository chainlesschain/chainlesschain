import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-siem-uuid-001"),
}));

let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;

let SIEMExporter, getSIEMExporter, SIEM_FORMATS, SIEM_TARGETS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockGetStmt = { get: vi.fn(() => null) };
  mockAllStmt = { all: vi.fn(() => []) };
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
      if (
        sql.includes("SELECT") &&
        (sql.includes("= ?") || sql.includes("id"))
      ) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
    saveToFile: vi.fn(),
  };

  const mod = await import("../../../src/main/audit/siem-exporter.js");
  SIEMExporter = mod.SIEMExporter;
  getSIEMExporter = mod.getSIEMExporter;
  SIEM_FORMATS = mod.SIEM_FORMATS;
  SIEM_TARGETS = mod.SIEM_TARGETS;
});

describe("SIEM_FORMATS constants", () => {
  it("should have json, cef, leef", () => {
    expect(SIEM_FORMATS.JSON).toBe("json");
    expect(SIEM_FORMATS.CEF).toBe("cef");
    expect(SIEM_FORMATS.LEEF).toBe("leef");
  });
});

describe("SIEM_TARGETS constants", () => {
  it("should have splunk_hec, elasticsearch, azure_sentinel", () => {
    expect(SIEM_TARGETS.SPLUNK_HEC).toBe("splunk_hec");
    expect(SIEM_TARGETS.ELASTICSEARCH).toBe("elasticsearch");
    expect(SIEM_TARGETS.AZURE_SENTINEL).toBe("azure_sentinel");
  });
});

describe("SIEMExporter", () => {
  let exporter;

  beforeEach(() => {
    exporter = new SIEMExporter({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(exporter.initialized).toBe(false);
      expect(exporter._targets).toBeInstanceOf(Map);
      expect(exporter._targets.size).toBe(0);
      expect(exporter._batchSize).toBe(100);
      expect(exporter._format).toBe("json");
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true and call _ensureTables", async () => {
      const spy = vi.spyOn(exporter, "_ensureTables");
      await exporter.initialize();
      expect(exporter.initialized).toBe(true);
      expect(spy).toHaveBeenCalled();
    });

    it("should load existing targets from DB", async () => {
      mockAllStmt.all.mockReturnValue([
        {
          id: "t1",
          target_type: "splunk_hec",
          target_url: "https://splunk.example.com",
          format: "json",
          exported_count: 10,
          last_export_at: 1000,
          last_exported_log_id: "log-50",
          status: "active",
          config: "{}",
        },
      ]);

      await exporter.initialize();
      expect(exporter._targets.size).toBe(1);
      expect(exporter._targets.get("t1").type).toBe("splunk_hec");
    });
  });

  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE siem_exports", () => {
      exporter._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS siem_exports");
      expect(sql).toContain("idx_siem_exports_target_type");
    });

    it("should not throw if database is null", () => {
      const e = new SIEMExporter(null);
      expect(() => e._ensureTables()).not.toThrow();
    });
  });

  describe("addTarget()", () => {
    it("should validate target type and throw for invalid", async () => {
      await expect(
        exporter.addTarget({ type: "invalid", url: "http://x.com" }),
      ).rejects.toThrow("Invalid target type");
    });

    it("should throw if URL is missing", async () => {
      await expect(exporter.addTarget({ type: "splunk_hec" })).rejects.toThrow(
        "Target URL is required",
      );
    });

    it("should insert to DB and add to Map", async () => {
      const target = await exporter.addTarget({
        type: "splunk_hec",
        url: "https://splunk.example.com/services/collector",
        format: "cef",
        config: { token: "abc" },
      });

      expect(typeof target.id).toBe("string");
      expect(target.id.length).toBeGreaterThan(0);
      expect(target.type).toBe("splunk_hec");
      expect(target.url).toBe("https://splunk.example.com/services/collector");
      expect(target.format).toBe("cef");
      expect(target.status).toBe("active");
      expect(target.exportedCount).toBe(0);
      expect(mockRunStmt.run).toHaveBeenCalled();
      expect(exporter._targets.has(target.id)).toBe(true);
    });

    it("should default format to json when not specified", async () => {
      const target = await exporter.addTarget({
        type: "elasticsearch",
        url: "https://es.example.com",
      });
      expect(target.format).toBe("json");
    });
  });

  describe("removeTarget()", () => {
    it("should throw if target not found", async () => {
      await expect(exporter.removeTarget("nonexistent")).rejects.toThrow(
        "Target not found",
      );
    });

    it("should remove from Map and update DB", async () => {
      exporter._targets.set("t1", {
        id: "t1",
        type: "splunk_hec",
        url: "http://x.com",
      });

      const removed = await exporter.removeTarget("t1");
      expect(removed.id).toBe("t1");
      expect(exporter._targets.has("t1")).toBe(false);
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe("listTargets()", () => {
    it("should return all targets", async () => {
      exporter._targets.set("t1", { id: "t1", type: "splunk_hec" });
      exporter._targets.set("t2", { id: "t2", type: "elasticsearch" });

      const targets = await exporter.listTargets();
      expect(targets).toHaveLength(2);
    });

    it("should return empty array when no targets", async () => {
      const targets = await exporter.listTargets();
      expect(targets).toEqual([]);
    });
  });

  describe("_toJSON()", () => {
    it("should return object with timestamp, severity, source, message", () => {
      const logEntry = {
        id: "log1",
        created_at: 1700000000000,
        severity: "ERROR",
        source: "audit",
        message: "Test event",
        user_id: "user1",
        action: "login",
        resource: "/api/auth",
        ip_address: "192.168.1.1",
      };

      const result = exporter._toJSON(logEntry);
      expect(result.timestamp).toBe(1700000000000);
      expect(result.severity).toBe("ERROR");
      expect(result.source).toBe("audit");
      expect(result.message).toBe("Test event");
      expect(result.metadata.eventId).toBe("log1");
      expect(result.metadata.userId).toBe("user1");
      expect(result.metadata.action).toBe("login");
    });

    it("should use defaults for missing fields", () => {
      const result = exporter._toJSON({});
      expect(result.severity).toBe("INFO");
      expect(result.source).toBe("chainlesschain-desktop");
      expect(result.message).toBe("");
    });
  });

  describe("_toCEF()", () => {
    it("should return string starting with CEF:0|ChainlessChain", () => {
      const logEntry = {
        id: "log1",
        action: "file_access",
        severity: "WARN",
        ip_address: "10.0.0.1",
        user_id: "user1",
        message: "File accessed",
        created_at: 1700000000000,
      };

      const result = exporter._toCEF(logEntry);
      expect(result).toMatch(/^CEF:0\|ChainlessChain\|Desktop\|1\.1\.0\|/);
      expect(result).toContain("log1");
      expect(result).toContain("file_access");
      expect(result).toContain("suser=user1");
    });
  });

  describe("_toLEEF()", () => {
    it("should return string starting with LEEF:2.0|ChainlessChain", () => {
      const logEntry = {
        id: "log1",
        action: "login",
        user_id: "admin",
        ip_address: "10.0.0.1",
        message: "User logged in",
        created_at: 1700000000000,
      };

      const result = exporter._toLEEF(logEntry);
      expect(result).toMatch(/^LEEF:2\.0\|ChainlessChain\|Desktop\|1\.1\.0\|/);
      expect(result).toContain("log1");
      expect(result).toContain("usrName=admin");
      expect(result).toContain("action=login");
    });
  });

  describe("_formatLog()", () => {
    const logEntry = { id: "log1", action: "test", message: "Test message" };

    it("should dispatch to _toJSON for json format", () => {
      const spy = vi.spyOn(exporter, "_toJSON");
      exporter._formatLog(logEntry, "json");
      expect(spy).toHaveBeenCalledWith(logEntry);
    });

    it("should dispatch to _toCEF for cef format", () => {
      const spy = vi.spyOn(exporter, "_toCEF");
      exporter._formatLog(logEntry, "cef");
      expect(spy).toHaveBeenCalledWith(logEntry);
    });

    it("should dispatch to _toLEEF for leef format", () => {
      const spy = vi.spyOn(exporter, "_toLEEF");
      exporter._formatLog(logEntry, "leef");
      expect(spy).toHaveBeenCalledWith(logEntry);
    });

    it("should default to _toJSON for unknown format", () => {
      const spy = vi.spyOn(exporter, "_toJSON");
      exporter._formatLog(logEntry, "unknown");
      expect(spy).toHaveBeenCalledWith(logEntry);
    });
  });

  describe("getExportStats()", () => {
    it("should return stats for all targets", async () => {
      exporter._targets.set("t1", {
        id: "t1",
        type: "splunk_hec",
        url: "https://splunk.com",
        format: "json",
        exportedCount: 50,
        lastExportAt: 1700000000000,
        status: "active",
      });
      exporter._targets.set("t2", {
        id: "t2",
        type: "elasticsearch",
        url: "https://es.com",
        format: "cef",
        exportedCount: 30,
        lastExportAt: 1700000001000,
        status: "active",
      });

      const stats = await exporter.getExportStats();
      expect(stats).toHaveLength(2);
      expect(stats[0]).toHaveProperty("id");
      expect(stats[0]).toHaveProperty("type");
      expect(stats[0]).toHaveProperty("url");
      expect(stats[0]).toHaveProperty("format");
      expect(stats[0]).toHaveProperty("exportedCount");
      expect(stats[0]).toHaveProperty("lastExportAt");
      expect(stats[0]).toHaveProperty("status");
    });

    it("should return empty array when no targets", async () => {
      const stats = await exporter.getExportStats();
      expect(stats).toEqual([]);
    });
  });

  describe("getSIEMExporter singleton", () => {
    it("should return the same instance on repeated calls", () => {
      const a = getSIEMExporter();
      const b = getSIEMExporter();
      expect(a).toBe(b);
    });
  });
});
