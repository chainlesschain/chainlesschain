import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let AntiCensorshipManager, getAntiCensorshipManager;

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
  const mod =
    await import("../../../src/main/security/anti-censorship-manager.js");
  AntiCensorshipManager = mod.AntiCensorshipManager;
  getAntiCensorshipManager = mod.getAntiCensorshipManager;
});

describe("AntiCensorshipManager", () => {
  let manager;
  beforeEach(() => {
    manager = new AntiCensorshipManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._torStatus.running).toBe(false);
      expect(manager._domainFronting.enabled).toBe(false);
      expect(manager._routes).toBeInstanceOf(Map);
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
        "CREATE TABLE IF NOT EXISTS anti_censorship_routes",
      );
    });
  });

  describe("startTor()", () => {
    it("should start Tor hidden service", async () => {
      const result = await manager.startTor();
      expect(result.running).toBe(true);
      expect(result.onionAddress).toContain(".onion");
      expect(result).toHaveProperty("startedAt");
    });

    it("should persist route to DB", async () => {
      await manager.startTor();
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should add route to memory", async () => {
      await manager.startTor();
      expect(manager._routes.size).toBe(1);
    });
  });

  describe("getTorStatus()", () => {
    it("should return current Tor status", async () => {
      const status = await manager.getTorStatus();
      expect(status.running).toBe(false);
    });

    it("should reflect started state", async () => {
      await manager.startTor();
      const status = await manager.getTorStatus();
      expect(status.running).toBe(true);
    });
  });

  describe("enableDomainFronting()", () => {
    it("should enable domain fronting", async () => {
      const result = await manager.enableDomainFronting({});
      expect(result.enabled).toBe(true);
      expect(result.cdnProvider).toBe("cloudflare");
    });

    it("should use custom provider", async () => {
      const result = await manager.enableDomainFronting({
        cdnProvider: "akamai",
        frontDomain: "cdn.test.com",
      });
      expect(result.cdnProvider).toBe("akamai");
      expect(result.frontDomain).toBe("cdn.test.com");
    });
  });

  describe("startMesh()", () => {
    it("should start mesh network", async () => {
      const result = await manager.startMesh();
      expect(result.status).toBe("scanning");
      expect(result.peers).toBe(0);
      expect(result).toHaveProperty("meshId");
    });
  });

  describe("getConnectivityReport()", () => {
    it("should return connectivity report", async () => {
      const report = await manager.getConnectivityReport();
      expect(report.torAvailable).toBe(false);
      expect(report.domainFrontingEnabled).toBe(false);
      expect(report.totalRoutes).toBe(0);
    });

    it("should reflect active services", async () => {
      await manager.startTor();
      await manager.enableDomainFronting({});
      const report = await manager.getConnectivityReport();
      expect(report.torAvailable).toBe(true);
      expect(report.domainFrontingEnabled).toBe(true);
      expect(report.activeRoutes).toBe(1);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      await manager.startTor();
      await manager.close();
      expect(manager._routes.size).toBe(0);
      expect(manager._torStatus.running).toBe(false);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getAntiCensorshipManager();
      expect(instance).toBeInstanceOf(AntiCensorshipManager);
    });
  });
});
