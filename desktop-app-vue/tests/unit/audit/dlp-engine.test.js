import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-001"),
}));

let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;

let DLPEngine, getDLPEngine, DLP_ACTIONS, DLP_CHANNELS;

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

  const mod = await import("../../../src/main/audit/dlp-engine.js");
  DLPEngine = mod.DLPEngine;
  getDLPEngine = mod.getDLPEngine;
  DLP_ACTIONS = mod.DLP_ACTIONS;
  DLP_CHANNELS = mod.DLP_CHANNELS;
});

describe("DLP_ACTIONS constants", () => {
  it("should have allow, alert, block, quarantine", () => {
    expect(DLP_ACTIONS.ALLOW).toBe("allow");
    expect(DLP_ACTIONS.ALERT).toBe("alert");
    expect(DLP_ACTIONS.BLOCK).toBe("block");
    expect(DLP_ACTIONS.QUARANTINE).toBe("quarantine");
  });
});

describe("DLP_CHANNELS constants", () => {
  it("should have 5 channels", () => {
    expect(DLP_CHANNELS.EMAIL).toBe("email");
    expect(DLP_CHANNELS.CHAT).toBe("chat");
    expect(DLP_CHANNELS.FILE_TRANSFER).toBe("file_transfer");
    expect(DLP_CHANNELS.CLIPBOARD).toBe("clipboard");
    expect(DLP_CHANNELS.EXPORT).toBe("export");
    expect(Object.keys(DLP_CHANNELS)).toHaveLength(5);
  });
});

describe("DLPEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new DLPEngine({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(engine.initialized).toBe(false);
      expect(engine._policyManager).toBeNull();
      expect(engine._stats).toEqual({ scanned: 0, blocked: 0, alerted: 0 });
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true and call _ensureTables", async () => {
      const spy = vi.spyOn(engine, "_ensureTables");
      await engine.initialize();
      expect(engine.initialized).toBe(true);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE dlp_incidents", () => {
      engine._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS dlp_incidents");
      expect(sql).toContain("idx_dlp_incidents_policy_id");
    });

    it("should not throw if database is null", () => {
      const e = new DLPEngine(null);
      expect(() => e._ensureTables()).not.toThrow();
    });
  });

  describe("setPolicyManager()", () => {
    it("should set _policyManager", () => {
      const pm = { getActivePoliciesForChannel: vi.fn() };
      engine.setPolicyManager(pm);
      expect(engine._policyManager).toBe(pm);
    });
  });

  describe("scanContent()", () => {
    it("should return allowed=true with no policy manager", async () => {
      const result = await engine.scanContent({
        content: "hello",
        channel: "chat",
      });
      expect(result.allowed).toBe(true);
      expect(result.action).toBe("allow");
      expect(result.matchedPolicies).toEqual([]);
      expect(result.incidents).toEqual([]);
    });

    it("should return allowed=true for empty content", async () => {
      const result = await engine.scanContent({ content: "", channel: "chat" });
      expect(result.allowed).toBe(true);
    });

    it("should detect regex patterns and return correct action/matches with policy manager", async () => {
      const mockPolicyManager = {
        getActivePoliciesForChannel: vi.fn(() => [
          {
            id: "p1",
            name: "SSN Policy",
            patterns: ["\\b\\d{3}-\\d{2}-\\d{4}\\b"],
            keywords: [],
            action: "block",
            severity: "high",
            channels: ["chat"],
          },
        ]),
      };
      engine.setPolicyManager(mockPolicyManager);

      const result = await engine.scanContent({
        content: "My SSN is 123-45-6789",
        channel: "chat",
        userId: "user1",
      });

      expect(result.allowed).toBe(false);
      expect(result.action).toBe("block");
      expect(result.matchedPolicies).toHaveLength(1);
      expect(result.matchedPolicies[0].policyId).toBe("p1");
      expect(result.matchedPolicies[0].matches).toHaveLength(1);
      expect(result.matchedPolicies[0].matches[0].pattern).toBe(
        "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      );
      expect(result.incidents).toHaveLength(1);
      expect(engine._stats.blocked).toBe(1);
    });

    it("should increment alerted stat for alert action", async () => {
      const mockPolicyManager = {
        getActivePoliciesForChannel: vi.fn(() => [
          {
            id: "p2",
            name: "Alert Policy",
            patterns: ["secret"],
            keywords: [],
            action: "alert",
            severity: "low",
            channels: ["chat"],
          },
        ]),
      };
      engine.setPolicyManager(mockPolicyManager);

      await engine.scanContent({
        content: "this is a secret document",
        channel: "chat",
      });
      expect(engine._stats.alerted).toBe(1);
    });

    it("should detect keyword matches", async () => {
      const mockPolicyManager = {
        getActivePoliciesForChannel: vi.fn(() => [
          {
            id: "p3",
            name: "Keyword Policy",
            patterns: [],
            keywords: ["confidential"],
            action: "alert",
            severity: "medium",
            channels: ["email"],
          },
        ]),
      };
      engine.setPolicyManager(mockPolicyManager);

      const result = await engine.scanContent({
        content: "This is CONFIDENTIAL data",
        channel: "email",
      });
      expect(result.matchedPolicies).toHaveLength(1);
      expect(result.action).toBe("alert");
      expect(result.allowed).toBe(true); // alert still allows
    });

    it("should increment scanned stat on each call", async () => {
      await engine.scanContent({ content: "test1", channel: "chat" });
      await engine.scanContent({ content: "test2", channel: "chat" });
      expect(engine._stats.scanned).toBe(2);
    });
  });

  describe("getIncidents()", () => {
    it("should query DB with filters", async () => {
      // getIncidents calls prepare twice: once for COUNT (uses get) and once for SELECT * (uses all)
      // Both contain 'SELECT' and the count query contains '= ?' for filters
      const mockCountStmt = { get: vi.fn(() => ({ total: 5 })) };
      const mockSelectStmt = { all: vi.fn(() => [{ id: "inc1" }]) };
      let callCount = 0;
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("COUNT")) {
          return mockCountStmt;
        }
        if (sql.includes("SELECT *")) {
          return mockSelectStmt;
        }
        callCount++;
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      });

      const result = await engine.getIncidents({
        channel: "chat",
        severity: "high",
        limit: 10,
        offset: 0,
      });

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(result).toHaveProperty("incidents");
      expect(result).toHaveProperty("total");
      expect(result.total).toBe(5);
      expect(result.incidents).toHaveLength(1);
    });

    it("should return empty when no database", async () => {
      const e = new DLPEngine(null);
      const result = await e.getIncidents();
      expect(result).toEqual({ incidents: [], total: 0 });
    });
  });

  describe("resolveIncident()", () => {
    it("should call UPDATE with resolved_at and resolution", async () => {
      const result = await engine.resolveIncident("inc1", "false positive");
      expect(mockDb.prepare).toHaveBeenCalled();
      const updateCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE"),
      );
      expect(updateCall).toBeTruthy();
      expect(mockRunStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        "false positive",
        "inc1",
      );
      expect(result).toEqual({ success: true });
    });

    it("should throw when database not available", async () => {
      const e = new DLPEngine(null);
      await expect(e.resolveIncident("inc1", "test")).rejects.toThrow(
        "Database not available",
      );
    });
  });

  describe("getStats()", () => {
    it("should return stats object with scanned/blocked/alerted and DB counts", async () => {
      mockGetStmt.get
        .mockReturnValueOnce({ total: 10 })
        .mockReturnValueOnce({ total: 3 });

      const stats = await engine.getStats();
      expect(stats).toHaveProperty("scanned");
      expect(stats).toHaveProperty("blocked");
      expect(stats).toHaveProperty("alerted");
      expect(stats).toHaveProperty("totalIncidents");
      expect(stats).toHaveProperty("unresolvedIncidents");
    });

    it("should return zeroes when no database", async () => {
      const e = new DLPEngine(null);
      const stats = await e.getStats();
      expect(stats.totalIncidents).toBe(0);
      expect(stats.unresolvedIncidents).toBe(0);
    });
  });

  describe("_matchPatterns()", () => {
    it("should match regex patterns against content", () => {
      const results = engine._matchPatterns("Call 555-1234 or 555-5678", [
        "\\d{3}-\\d{4}",
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].pattern).toBe("\\d{3}-\\d{4}");
      expect(results[0].matches).toContain("555-1234");
    });

    it("should return empty for no matches", () => {
      const results = engine._matchPatterns("hello world", ["\\d{3}-\\d{4}"]);
      expect(results).toHaveLength(0);
    });

    it("should handle invalid regex gracefully", () => {
      const results = engine._matchPatterns("test", ["[invalid"]);
      expect(results).toHaveLength(0);
    });

    it("should return empty for null/undefined patterns", () => {
      expect(engine._matchPatterns("test", null)).toEqual([]);
      expect(engine._matchPatterns("test", undefined)).toEqual([]);
    });
  });

  describe("_hashContent()", () => {
    it("should return consistent sha256 hex", () => {
      const hash1 = engine._hashContent("hello");
      const hash2 = engine._hashContent("hello");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce different hashes for different content", () => {
      const hash1 = engine._hashContent("hello");
      const hash2 = engine._hashContent("world");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getDLPEngine singleton", () => {
    it("should return the same instance on repeated calls", () => {
      const a = getDLPEngine();
      const b = getDLPEngine();
      expect(a).toBe(b);
    });
  });
});
