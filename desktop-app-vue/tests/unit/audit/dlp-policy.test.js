import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-policy-uuid-001"),
}));

let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;

let DLPPolicyManager, getDLPPolicyManager;

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

  const mod = await import("../../../src/main/audit/dlp-policy.js");
  DLPPolicyManager = mod.DLPPolicyManager;
  getDLPPolicyManager = mod.getDLPPolicyManager;
});

describe("DLPPolicyManager", () => {
  let manager;

  beforeEach(() => {
    manager = new DLPPolicyManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._policies).toBeInstanceOf(Map);
      expect(manager._policies.size).toBe(0);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true and call _ensureTables", async () => {
      const ensureSpy = vi.spyOn(manager, "_ensureTables");
      const loadSpy = vi.spyOn(manager, "_loadPolicies");
      await manager.initialize();
      expect(manager.initialized).toBe(true);
      expect(ensureSpy).toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE dlp_policies", () => {
      manager._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS dlp_policies");
      expect(sql).toContain("idx_dlp_policies_enabled");
    });

    it("should not throw if database is null", () => {
      const m = new DLPPolicyManager(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  describe("createPolicy()", () => {
    it("should throw without name", async () => {
      await expect(
        manager.createPolicy({ patterns: ["\\d+"] }),
      ).rejects.toThrow("Policy name is required");
    });

    it("should throw with empty name", async () => {
      await expect(
        manager.createPolicy({ name: "  ", patterns: ["\\d+"] }),
      ).rejects.toThrow("Policy name is required");
    });

    it("should throw without patterns", async () => {
      await expect(manager.createPolicy({ name: "Test" })).rejects.toThrow(
        "At least one pattern is required",
      );
    });

    it("should throw with empty patterns array", async () => {
      await expect(
        manager.createPolicy({ name: "Test", patterns: [] }),
      ).rejects.toThrow("At least one pattern is required");
    });

    it("should validate regex patterns and throw for invalid ones", async () => {
      await expect(
        manager.createPolicy({ name: "Bad", patterns: ["[invalid"] }),
      ).rejects.toThrow("Invalid regex pattern");
    });

    it("should insert policy to DB and return policy with id", async () => {
      const policy = await manager.createPolicy({
        name: "SSN Detector",
        patterns: ["\\b\\d{3}-\\d{2}-\\d{4}\\b"],
        keywords: ["ssn"],
        action: "block",
        severity: "high",
        channels: ["chat", "email"],
      });

      expect(typeof policy.id).toBe("string");
      expect(policy.id.length).toBeGreaterThan(0);
      expect(policy.name).toBe("SSN Detector");
      expect(policy.enabled).toBe(1);
      expect(policy.action).toBe("block");
      expect(policy.severity).toBe("high");
      expect(JSON.parse(policy.patterns)).toEqual([
        "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      ]);
      expect(JSON.parse(policy.channels)).toEqual(["chat", "email"]);
      expect(mockRunStmt.run).toHaveBeenCalled();
      expect(manager._policies.has(policy.id)).toBe(true);
    });

    it("should use default action and severity", async () => {
      const policy = await manager.createPolicy({
        name: "Default Policy",
        patterns: ["test"],
      });
      expect(policy.action).toBe("alert");
      expect(policy.severity).toBe("medium");
    });
  });

  describe("updatePolicy()", () => {
    it("should throw if policy not found", async () => {
      await expect(
        manager.updatePolicy("nonexistent", { name: "New" }),
      ).rejects.toThrow("Policy not found");
    });

    it("should update specific fields in DB", async () => {
      // Add a policy first
      manager._policies.set("p1", {
        id: "p1",
        name: "Old",
        enabled: 1,
        patterns: '["\\\\d+"]',
        channels: "[]",
        keywords: "[]",
        action: "alert",
        severity: "low",
      });

      const updated = await manager.updatePolicy("p1", {
        name: "Updated",
        severity: "high",
      });

      expect(updated.name).toBe("Updated");
      expect(updated.severity).toBe("high");
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should validate patterns if being updated", async () => {
      manager._policies.set("p1", {
        id: "p1",
        name: "Test",
        patterns: '["\\\\d+"]',
      });

      await expect(
        manager.updatePolicy("p1", { patterns: ["[bad"] }),
      ).rejects.toThrow("Invalid regex pattern");
    });

    it("should return existing policy if no fields to update", async () => {
      const existing = { id: "p1", name: "Test" };
      manager._policies.set("p1", existing);

      const result = await manager.updatePolicy("p1", {});
      expect(result).toBe(existing);
    });
  });

  describe("deletePolicy()", () => {
    it("should throw if policy not found", async () => {
      await expect(manager.deletePolicy("nonexistent")).rejects.toThrow(
        "Policy not found",
      );
    });

    it("should remove from DB and Map", async () => {
      manager._policies.set("p1", { id: "p1", name: "Test" });

      const result = await manager.deletePolicy("p1");
      expect(result).toEqual({ success: true });
      expect(manager._policies.has("p1")).toBe(false);
      expect(mockDb.prepare).toHaveBeenCalled();
      expect(mockRunStmt.run).toHaveBeenCalledWith("p1");
    });
  });

  describe("getPolicy()", () => {
    it("should return from Map if cached", async () => {
      const policy = { id: "p1", name: "Cached" };
      manager._policies.set("p1", policy);

      const result = await manager.getPolicy("p1");
      expect(result).toBe(policy);
    });

    it("should query DB if not in Map", async () => {
      const dbRow = { id: "p2", name: "FromDB" };
      mockGetStmt.get.mockReturnValue(dbRow);

      const result = await manager.getPolicy("p2");
      expect(result).toBe(dbRow);
      expect(manager._policies.has("p2")).toBe(true);
    });

    it("should return null if not found anywhere", async () => {
      mockGetStmt.get.mockReturnValue(null);
      const result = await manager.getPolicy("missing");
      expect(result).toBeNull();
    });
  });

  describe("listPolicies()", () => {
    beforeEach(() => {
      manager._policies.set("p1", { id: "p1", name: "A", enabled: 1 });
      manager._policies.set("p2", { id: "p2", name: "B", enabled: 0 });
      manager._policies.set("p3", { id: "p3", name: "C", enabled: 1 });
    });

    it("should return all policies without filter", async () => {
      const result = await manager.listPolicies();
      expect(result).toHaveLength(3);
    });

    it("should filter by enabled=true", async () => {
      const result = await manager.listPolicies({ enabled: true });
      expect(result).toHaveLength(2);
      expect(result.every((p) => p.enabled === 1)).toBe(true);
    });

    it("should filter by enabled=false", async () => {
      const result = await manager.listPolicies({ enabled: false });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("B");
    });
  });

  describe("getActivePoliciesForChannel()", () => {
    beforeEach(() => {
      manager._policies.set("p1", {
        id: "p1",
        enabled: 1,
        channels: '["chat","email"]',
      });
      manager._policies.set("p2", { id: "p2", enabled: 1, channels: "[]" }); // applies to all
      manager._policies.set("p3", {
        id: "p3",
        enabled: 0,
        channels: '["chat"]',
      }); // disabled
      manager._policies.set("p4", {
        id: "p4",
        enabled: 1,
        channels: '["file_transfer"]',
      });
    });

    it("should return enabled policies matching channel", async () => {
      const result = await manager.getActivePoliciesForChannel("chat");
      expect(result).toHaveLength(2); // p1 (has chat) + p2 (all channels)
      const ids = result.map((p) => p.id);
      expect(ids).toContain("p1");
      expect(ids).toContain("p2");
    });

    it("should not include disabled policies", async () => {
      const result = await manager.getActivePoliciesForChannel("chat");
      const ids = result.map((p) => p.id);
      expect(ids).not.toContain("p3");
    });

    it("should include policies with empty channels (applies to all)", async () => {
      const result = await manager.getActivePoliciesForChannel("clipboard");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p2");
    });
  });

  describe("_validatePatterns()", () => {
    it("should throw for invalid regex", () => {
      expect(() => manager._validatePatterns(["[invalid"])).toThrow(
        "Invalid regex pattern",
      );
    });

    it("should accept valid patterns", () => {
      expect(() =>
        manager._validatePatterns(["\\d+", "\\b\\w+\\b", "test.*pattern"]),
      ).not.toThrow();
    });
  });

  describe("getDLPPolicyManager singleton", () => {
    it("should return the same instance on repeated calls", () => {
      const a = getDLPPolicyManager();
      const b = getDLPPolicyManager();
      expect(a).toBe(b);
    });
  });
});
