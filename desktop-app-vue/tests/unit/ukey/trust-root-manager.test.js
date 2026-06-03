import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let TrustRootManager, getTrustRootManager;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("REPLACE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod = await import("../../../src/main/ukey/trust-root-manager.js");
  TrustRootManager = mod.TrustRootManager;
  getTrustRootManager = mod.getTrustRootManager;
});

describe("TrustRootManager", () => {
  let manager;
  beforeEach(() => {
    manager = new TrustRootManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._attestations).toBeInstanceOf(Map);
      expect(manager._syncRecords).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      manager._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS trust_root_attestations",
      );
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS cross_device_key_sync");
    });
  });

  describe("getStatus()", () => {
    it("should return empty status", async () => {
      const status = await manager.getStatus();
      expect(status.totalDevices).toBe(0);
      expect(status.verified).toBe(0);
    });
  });

  describe("verifyChain()", () => {
    it("should throw if deviceId is missing", async () => {
      await expect(manager.verifyChain()).rejects.toThrow(
        "Device ID is required",
      );
    });

    it("should verify chain for device", async () => {
      const result = await manager.verifyChain("device-1");
      expect(result.device_id).toBe("device-1");
      expect(result.trust_level).toBe("verified");
      expect(result.boot_verified).toBe(1);
    });

    it("should persist to DB", async () => {
      await manager.verifyChain("device-1");
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("syncKeys()", () => {
    it("should throw if source or target missing", async () => {
      await expect(manager.syncKeys({})).rejects.toThrow(
        "Source and target devices are required",
      );
    });

    it("should sync keys between devices", async () => {
      const result = await manager.syncKeys({
        sourceDevice: "dev-a",
        targetDevice: "dev-b",
      });
      expect(result.sync_status).toBe("completed");
      expect(result.verified).toBe(1);
    });
  });

  describe("bindFingerprint()", () => {
    it("should throw if deviceId missing", async () => {
      await expect(manager.bindFingerprint()).rejects.toThrow(
        "Device ID is required",
      );
    });

    it("should throw if fingerprint missing", async () => {
      await expect(manager.bindFingerprint("dev-1")).rejects.toThrow(
        "Fingerprint is required",
      );
    });

    it("should create new attestation if none exists", async () => {
      const result = await manager.bindFingerprint("dev-1", "fp-123");
      expect(result.device_id).toBe("dev-1");
      expect(result.trust_level).toBe("verified");
    });
  });

  describe("getBootStatus()", () => {
    it("should return empty boot status", async () => {
      const status = await manager.getBootStatus();
      expect(status.totalDevices).toBe(0);
      expect(status.bootVerified).toBe(0);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._attestations.set("a1", {});
      manager._syncRecords.set("s1", {});
      await manager.close();
      expect(manager._attestations.size).toBe(0);
      expect(manager._syncRecords.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getTrustRootManager();
      expect(instance).toBeInstanceOf(TrustRootManager);
    });
  });
});
