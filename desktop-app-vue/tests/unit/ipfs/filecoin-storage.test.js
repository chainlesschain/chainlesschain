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

  // ── verifyStorageProof ────────────────────────────────────────────────
  describe("verifyStorageProof()", () => {
    it("should throw if dealId missing", async () => {
      await expect(storage.verifyStorageProof()).rejects.toThrow(
        "Deal ID is required",
      );
    });

    it("should throw for unknown deal", async () => {
      await expect(storage.verifyStorageProof("ghost", {})).rejects.toThrow(
        "not found",
      );
    });

    it("should reject empty proof data", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmProof1" });
      const result = await storage.verifyStorageProof(deal.id, {
        proofType: "porep",
        proofData: "",
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("should reject unknown proof type", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmProof2" });
      await expect(
        storage.verifyStorageProof(deal.id, {
          proofType: "invalid",
          proofData: "abc",
        }),
      ).rejects.toThrow("Unknown proof type");
    });

    it("should verify valid proof data (length >= 32)", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmProof3" });
      const longProof = "a".repeat(32);
      const result = await storage.verifyStorageProof(deal.id, {
        proofType: "porep",
        proofData: longProof,
      });
      expect(result.valid).toBe(true);
      expect(result.proofType).toBe("porep");
      expect(result.verifiedAt).toBeTruthy();
    });

    it("should update deal verified status in DB", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmProof4" });
      await storage.verifyStorageProof(deal.id, {
        proofType: "post",
        proofData: "x".repeat(64),
      });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should emit proof-verified event", async () => {
      const handler = vi.fn();
      storage.on("proof-verified", handler);
      const deal = await storage.storeToFilecoin({ cid: "QmProof5" });
      await storage.verifyStorageProof(deal.id, {
        proofType: "porep",
        proofData: "x".repeat(32),
      });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ valid: true }),
      );
    });
  });

  // ── renewDeal ───────────────────────────────────────────────────────────
  describe("renewDeal()", () => {
    it("should throw if dealId missing", async () => {
      await expect(storage.renewDeal()).rejects.toThrow("Deal ID is required");
    });

    it("should throw if additionalEpochs not positive", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmRenew1" });
      await expect(storage.renewDeal(deal.id, 0)).rejects.toThrow("positive");
    });

    it("should throw for unknown deal", async () => {
      await expect(storage.renewDeal("ghost", 1000)).rejects.toThrow(
        "not found",
      );
    });

    it("should throw for non-active deal", async () => {
      storage._deals.set("expired-deal", {
        id: "expired-deal",
        status: "expired",
      });
      await expect(storage.renewDeal("expired-deal", 1000)).rejects.toThrow(
        "not active",
      );
    });

    it("should extend deal duration and increment renewal count", async () => {
      const deal = await storage.storeToFilecoin({
        cid: "QmRenew2",
        durationEpochs: 100000,
      });
      const originalDuration = deal.duration_epochs;
      const result = await storage.renewDeal(deal.id, 50000);
      expect(result.newDuration).toBe(originalDuration + 50000);
      expect(result.renewalCount).toBe(1);
    });

    it("should persist renewal to DB", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmRenew3" });
      await storage.renewDeal(deal.id, 10000);
      // INSERT for store + UPDATE for renew
      expect(mockRunStmt.run).toHaveBeenCalledTimes(2);
    });

    it("should emit deal-renewed event", async () => {
      const handler = vi.fn();
      storage.on("deal-renewed", handler);
      const deal = await storage.storeToFilecoin({ cid: "QmRenew4" });
      await storage.renewDeal(deal.id, 10000);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ additionalEpochs: 10000 }),
      );
    });
  });

  // ── listDeals ───────────────────────────────────────────────────────────
  describe("listDeals()", () => {
    it("should return empty array when no deals", async () => {
      const deals = await storage.listDeals();
      expect(deals).toEqual([]);
    });

    it("should return all deals without filters", async () => {
      storage._deals.set("d1", {
        id: "d1",
        cid: "QmList1",
        status: "active",
        created_at: 2,
      });
      storage._deals.set("d2", {
        id: "d2",
        cid: "QmList2",
        status: "active",
        created_at: 1,
      });
      const deals = await storage.listDeals();
      expect(deals.length).toBe(2);
    });

    it("should filter by status", async () => {
      await storage.storeToFilecoin({ cid: "QmFilter1" });
      storage._deals.set("expired-1", {
        id: "expired-1",
        status: "expired",
        cid: "QmExp",
        created_at: 1,
      });
      const active = await storage.listDeals({ status: "active" });
      expect(active.length).toBe(1);
      expect(active[0].cid).toBe("QmFilter1");
    });

    it("should filter by CID", async () => {
      // Manually add deals with different IDs since uuid mock returns same value
      storage._deals.set("d-target", {
        id: "d-target",
        cid: "QmTarget",
        status: "active",
        created_at: 2,
      });
      storage._deals.set("d-other", {
        id: "d-other",
        cid: "QmOther",
        status: "active",
        created_at: 1,
      });
      const deals = await storage.listDeals({ cid: "QmTarget" });
      expect(deals.length).toBe(1);
    });

    it("should filter by minerId", async () => {
      storage._deals.set("d-m1", {
        id: "d-m1",
        cid: "Qm1",
        miner_id: "f099",
        status: "active",
        created_at: 2,
      });
      storage._deals.set("d-m2", {
        id: "d-m2",
        cid: "Qm2",
        miner_id: "f01234",
        status: "active",
        created_at: 1,
      });
      const deals = await storage.listDeals({ minerId: "f099" });
      expect(deals.length).toBe(1);
      expect(deals[0].miner_id).toBe("f099");
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getFilecoinStorage();
      expect(instance).toBeInstanceOf(FilecoinStorage);
    });
  });
});
