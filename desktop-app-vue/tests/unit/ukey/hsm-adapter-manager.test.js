import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let HsmAdapterManager, getHsmAdapterManager, HSM_VENDOR;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod = await import("../../../src/main/ukey/hsm-adapter-manager.js");
  HsmAdapterManager = mod.HsmAdapterManager;
  getHsmAdapterManager = mod.getHsmAdapterManager;
  HSM_VENDOR = mod.HSM_VENDOR;
});

describe("HsmAdapterManager", () => {
  let manager;
  beforeEach(() => {
    manager = new HsmAdapterManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._adapters).toBeInstanceOf(Map);
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
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS hsm_adapters");
    });
  });

  describe("listAdapters()", () => {
    it("should return empty list", async () => {
      const adapters = await manager.listAdapters();
      expect(adapters).toHaveLength(0);
    });

    it("should filter by vendor", async () => {
      manager._adapters.set("a1", { vendor: "yubikey", status: "connected" });
      manager._adapters.set("a2", { vendor: "ledger", status: "connected" });
      const adapters = await manager.listAdapters({ vendor: "yubikey" });
      expect(adapters).toHaveLength(1);
      expect(adapters[0].vendor).toBe("yubikey");
    });
  });

  describe("connectDevice()", () => {
    it("should throw if vendor is missing", async () => {
      await expect(manager.connectDevice({})).rejects.toThrow(
        "Vendor is required",
      );
    });

    it("should connect device", async () => {
      const result = await manager.connectDevice({ vendor: "yubikey" });
      expect(result.vendor).toBe("yubikey");
      expect(result.status).toBe("connected");
      expect(result.fips_compliant).toBe(1);
    });

    it("should set fips_compliant to 0 for non-yubikey", async () => {
      const result = await manager.connectDevice({ vendor: "ledger" });
      expect(result.fips_compliant).toBe(0);
    });

    it("should persist to DB", async () => {
      await manager.connectDevice({ vendor: "trezor" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("executeOperation()", () => {
    it("should throw if adapterId is missing", async () => {
      await expect(manager.executeOperation({})).rejects.toThrow(
        "Adapter ID is required",
      );
    });

    it("should throw if operation is missing", async () => {
      await expect(
        manager.executeOperation({ adapterId: "a1" }),
      ).rejects.toThrow("Operation is required");
    });

    it("should throw if adapter not found", async () => {
      await expect(
        manager.executeOperation({ adapterId: "a1", operation: "sign" }),
      ).rejects.toThrow("Adapter not found: a1");
    });

    it("should throw if adapter not connected", async () => {
      manager._adapters.set("a1", {
        vendor: "yubikey",
        status: "disconnected",
      });
      await expect(
        manager.executeOperation({ adapterId: "a1", operation: "sign" }),
      ).rejects.toThrow("Adapter is not connected");
    });

    it("should execute operation on connected adapter", async () => {
      manager._adapters.set("a1", { vendor: "yubikey", status: "connected" });
      const result = await manager.executeOperation({
        adapterId: "a1",
        operation: "sign",
      });
      expect(result.operation).toBe("sign");
      expect(result.result).toBe("sign completed");
    });
  });

  describe("getComplianceStatus()", () => {
    it("should return compliance status", async () => {
      const status = await manager.getComplianceStatus();
      expect(status.totalAdapters).toBe(0);
      expect(status.fipsCompliant).toBe(0);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._adapters.set("a1", {});
      await manager.close();
      expect(manager._adapters.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getHsmAdapterManager();
      expect(instance).toBeInstanceOf(HsmAdapterManager);
    });
  });
});
