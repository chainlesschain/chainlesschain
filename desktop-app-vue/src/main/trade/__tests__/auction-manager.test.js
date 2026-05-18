/**
 * AuctionManager 单元测试
 *
 * 覆盖：initialize、createAuction、placeBid、getAuction、listAuctions、
 *       cancelAuction、finalizeAuction、processBuyNow、getMyBids
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AuctionManager } = require("../auction-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    _prep: prepResult,
  };
}

function createMockEscrowManager() {
  return {
    createEscrow: vi.fn().mockResolvedValue({ id: "escrow-1" }),
    releaseEscrow: vi.fn().mockResolvedValue({ success: true }),
    refundEscrow: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockAssetManager() {
  return {
    getAsset: vi.fn().mockResolvedValue({ id: "asset-1" }),
    transferAsset: vi.fn().mockResolvedValue({ success: true }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuctionManager", () => {
  let manager;
  let mockDb;
  let mockEscrow;
  let mockAsset;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDb = createMockDatabase();
    mockEscrow = createMockEscrowManager();
    mockAsset = createMockAssetManager();
    manager = new AuctionManager(mockDb, mockEscrow, mockAsset);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with dependencies", () => {
      expect(manager).toBeDefined();
      expect(manager.database).toBe(mockDb);
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates auctions and auction_bids tables", async () => {
      await manager.initialize();
      expect(mockDb.db.exec).toHaveBeenCalledTimes(2);
      const sqls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(sqls.some((s) => s.includes("auctions"))).toBe(true);
      expect(sqls.some((s) => s.includes("auction_bids"))).toBe(true);
    });

    it("sets initialized flag", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  // ── createAuction ─────────────────────────────────────────────────────────────

  describe("createAuction()", () => {
    const validParams = {
      sellerId: "seller-1",
      itemId: "item-1",
      startPrice: 100,
      reservePrice: 150,
      duration: 24 * 60 * 60 * 1000,
      type: "english",
    };

    it("creates an auction and returns it", async () => {
      const auctionRow = {
        id: "a-1",
        seller_id: "seller-1",
        type: "english",
        status: "active",
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.createAuction(validParams);
      expect(result).toBeDefined();
      expect(result.seller_id).toBe("seller-1");
    });

    it("throws when startPrice <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.createAuction({ ...validParams, startPrice: 0 }),
      ).rejects.toThrow("Start price must be positive");
    });

    it("throws when reservePrice < startPrice", async () => {
      await manager.initialize();
      await expect(
        manager.createAuction({ ...validParams, reservePrice: 50 }),
      ).rejects.toThrow("Reserve price must be >= start price");
    });

    it("throws when required fields missing", async () => {
      await manager.initialize();
      await expect(
        manager.createAuction({ startPrice: 100 }), // missing sellerId, itemId
      ).rejects.toThrow("Missing required fields");
    });

    it("creates auction with buy-now price", async () => {
      const row = { id: "a-1", buy_now_price: 300, status: "active" };
      mockDb._prep.get.mockReturnValue(row);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.createAuction({
        ...validParams,
        buyNowPrice: 300,
      });
      expect(result.buy_now_price).toBe(300);
    });
  });

  // ── placeBid ──────────────────────────────────────────────────────────────────

  describe("placeBid()", () => {
    const activeAuction = {
      id: "a-1",
      seller_id: "seller-1",
      item_id: "item-1",
      type: "english",
      start_price: 100,
      reserve_price: 150,
      buy_now_price: null,
      current_price: 100,
      current_bidder: null,
      bid_count: 0,
      start_time: Math.floor(Date.now() / 1000) - 100,
      end_time: Math.floor(Date.now() / 1000) + 3600,
      status: "active",
      bids: [],
    };

    it("places a valid bid and returns result", async () => {
      mockDb._prep.get.mockReturnValue(activeAuction);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.placeBid("a-1", "bidder-1", 120);
      expect(result.success).toBe(true);
      expect(result.amount).toBe(120);
    });

    it("throws when auction not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.placeBid("nonexistent", "b1", 120)).rejects.toThrow(
        "Auction not found",
      );
    });

    it("throws when auction is not active", async () => {
      mockDb._prep.get.mockReturnValue({
        ...activeAuction,
        status: "ended",
        bids: [],
      });
      await manager.initialize();
      await expect(manager.placeBid("a-1", "b1", 120)).rejects.toThrow(
        "not active",
      );
    });

    it("throws when bid is not higher than current price", async () => {
      mockDb._prep.get.mockReturnValue({
        ...activeAuction,
        current_price: 200,
        bids: [],
      });
      await manager.initialize();
      await expect(manager.placeBid("a-1", "b1", 150)).rejects.toThrow(
        "higher than current price",
      );
    });

    it("throws when seller tries to bid on own auction", async () => {
      mockDb._prep.get.mockReturnValue(activeAuction);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.placeBid("a-1", "seller-1", 120)).rejects.toThrow(
        "Seller cannot bid",
      );
    });
  });

  // ── getAuction ────────────────────────────────────────────────────────────────

  describe("getAuction()", () => {
    it("returns auction with bids", async () => {
      const row = { id: "a-1", seller_id: "s1", status: "active" };
      const bids = [{ id: "b-1", amount: 120 }];
      mockDb._prep.get.mockReturnValue(row);
      mockDb._prep.all.mockReturnValue(bids);
      await manager.initialize();
      const result = await manager.getAuction("a-1");
      expect(result.id).toBe("a-1");
      expect(result.bids).toHaveLength(1);
    });

    it("returns null when not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      expect(await manager.getAuction("nonexistent")).toBeNull();
    });
  });

  // ── listAuctions ──────────────────────────────────────────────────────────────

  describe("listAuctions()", () => {
    it("returns auctions and total", async () => {
      mockDb._prep.all.mockReturnValue([{ id: "a-1" }, { id: "a-2" }]);
      mockDb._prep.get.mockReturnValue({ total: 2 });
      await manager.initialize();
      const result = await manager.listAuctions({});
      expect(result.auctions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.get.mockReturnValue({ total: 0 });
      await manager.initialize();
      const result = await manager.listAuctions({ status: "ended" });
      expect(result.auctions).toHaveLength(0);
    });
  });

  // ── cancelAuction ─────────────────────────────────────────────────────────────

  describe("cancelAuction()", () => {
    it("cancels auction with no bids", async () => {
      const auctionRow = {
        id: "a-1",
        seller_id: "seller-1",
        bid_count: 0,
        status: "active",
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.cancelAuction("a-1", "seller-1");
      expect(result.success).toBe(true);
    });

    it("throws when non-seller tries to cancel", async () => {
      const auctionRow = {
        id: "a-1",
        seller_id: "seller-1",
        bid_count: 0,
        status: "active",
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.cancelAuction("a-1", "other-user")).rejects.toThrow(
        "Only the seller can cancel",
      );
    });

    it("throws when auction has bids", async () => {
      const auctionRow = {
        id: "a-1",
        seller_id: "seller-1",
        bid_count: 3,
        status: "active",
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.cancelAuction("a-1", "seller-1")).rejects.toThrow(
        "Cannot cancel auction that has bids",
      );
    });
  });

  // ── finalizeAuction ───────────────────────────────────────────────────────────

  describe("finalizeAuction()", () => {
    it("finalizes with SOLD when there is a winning bid", async () => {
      const activeAuction = {
        id: "a-1",
        seller_id: "s1",
        status: "active",
        current_bidder: "bidder-1",
        current_price: 200,
        reserve_price: 150,
        bids: [],
      };
      const soldAuction = { ...activeAuction, status: "sold" };
      mockDb._prep.get
        .mockReturnValueOnce(activeAuction)
        .mockReturnValueOnce(soldAuction);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.finalizeAuction("a-1");
      expect(result).toBeDefined();
      expect(mockDb._prep.run).toHaveBeenCalledWith(
        "sold",
        expect.any(Number),
        "a-1",
      );
    });

    it("finalizes with NO_SALE when reserve price not met", async () => {
      const activeAuction = {
        id: "a-1",
        seller_id: "s1",
        status: "active",
        current_bidder: "bidder-1",
        current_price: 100,
        reserve_price: 200, // not met
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(activeAuction);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await manager.finalizeAuction("a-1");
      expect(mockDb._prep.run).toHaveBeenCalledWith(
        "no_sale",
        expect.any(Number),
        "a-1",
      );
    });

    it("finalizes with NO_SALE when no bids placed", async () => {
      const activeAuction = {
        id: "a-1",
        status: "active",
        current_bidder: null,
        current_price: 100,
        reserve_price: null,
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(activeAuction);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await manager.finalizeAuction("a-1");
      expect(mockDb._prep.run).toHaveBeenCalledWith(
        "no_sale",
        expect.any(Number),
        "a-1",
      );
    });
  });

  // ── processBuyNow ─────────────────────────────────────────────────────────────

  describe("processBuyNow()", () => {
    it("processes buy-now purchase", async () => {
      const auctionRow = {
        id: "a-1",
        seller_id: "s1",
        buy_now_price: 300,
        status: "active",
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.processBuyNow("a-1", "buyer-1");
      expect(result.success).toBe(true);
      expect(result.price).toBe(300);
    });

    it("throws when auction has no buy-now price", async () => {
      const auctionRow = {
        id: "a-1",
        buy_now_price: null,
        status: "active",
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.processBuyNow("a-1", "buyer-1")).rejects.toThrow(
        "does not have a buy-now option",
      );
    });

    it("throws when auction is not active", async () => {
      const auctionRow = {
        id: "a-1",
        buy_now_price: 300,
        status: "ended",
        bids: [],
      };
      mockDb._prep.get.mockReturnValue(auctionRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.processBuyNow("a-1", "buyer-1")).rejects.toThrow(
        "not active",
      );
    });
  });

  // ── getMyBids ─────────────────────────────────────────────────────────────────

  describe("getMyBids()", () => {
    it("returns bids for a user", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "bid-1", bidder_id: "user-1", amount: 120 },
        { id: "bid-2", bidder_id: "user-1", amount: 150 },
      ]);
      await manager.initialize();
      const bids = await manager.getMyBids("user-1");
      expect(bids).toHaveLength(2);
    });

    it("returns empty array when no bids", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const bids = await manager.getMyBids("user-1");
      expect(bids).toHaveLength(0);
    });
  });
});
