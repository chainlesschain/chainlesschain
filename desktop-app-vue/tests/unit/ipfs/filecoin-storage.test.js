import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let FilecoinStorage, getFilecoinStorage;

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
  const mod = await import("../../../src/main/ipfs/filecoin-storage.js");
  FilecoinStorage = mod.FilecoinStorage;
  getFilecoinStorage = mod.getFilecoinStorage;
});

describe("FilecoinStorage", () => {
  let storage;
  beforeEach(() => {
    storage = new FilecoinStorage({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(storage.initialized).toBe(false);
      expect(storage._deals).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await storage.initialize();
      expect(storage.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      storage._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS filecoin_deals");
    });
  });

  describe("storeToFilecoin()", () => {
    it("should throw if cid is missing", async () => {
      await expect(storage.storeToFilecoin({})).rejects.toThrow(
        "CID is required",
      );
    });

    it("should store to filecoin", async () => {
      const result = await storage.storeToFilecoin({ cid: "Qm123abc" });
      expect(result.cid).toBe("Qm123abc");
      expect(result.status).toBe("active");
      expect(result.verified).toBe(1);
      expect(result.miner_id).toBe("f01234");
    });

    it("should persist to DB", async () => {
      await storage.storeToFilecoin({ cid: "Qm123" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should add deal to memory", async () => {
      await storage.storeToFilecoin({ cid: "Qm123" });
      expect(storage._deals.size).toBe(1);
    });
  });

  describe("getDealStatus()", () => {
    it("should throw if dealId missing", async () => {
      await expect(storage.getDealStatus()).rejects.toThrow(
        "Deal ID is required",
      );
    });

    it("should return null for unknown deal", async () => {
      const result = await storage.getDealStatus("unknown-id");
      expect(result).toBeNull();
    });

    it("should return deal status", async () => {
      storage._deals.set("d1", { id: "d1", status: "active" });
      const result = await storage.getDealStatus("d1");
      expect(result.status).toBe("active");
    });
  });

  describe("getStorageStats()", () => {
    it("should return empty stats", async () => {
      const stats = await storage.getStorageStats();
      expect(stats.totalDeals).toBe(0);
      expect(stats.activeDeals).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });

    it("should return stats with deals", async () => {
      await storage.storeToFilecoin({ cid: "Qm1", sizeBytes: 2048 });
      const stats = await storage.getStorageStats();
      expect(stats.totalDeals).toBe(1);
      expect(stats.activeDeals).toBe(1);
      expect(stats.totalSizeBytes).toBe(2048);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      storage._deals.set("d1", {});
      await storage.close();
      expect(storage._deals.size).toBe(0);
      expect(storage.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getFilecoinStorage();
      expect(instance).toBeInstanceOf(FilecoinStorage);
    });
  });
});
