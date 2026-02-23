/**
 * GroupBuyingManager 单元测试
 *
 * 覆盖：initialize、createGroupBuy、joinGroupBuy、leaveGroupBuy、
 *       getGroupBuy、listGroupBuys、finalizeGroupBuy、cancelGroupBuy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { GroupBuyingManager } = require("../group-buying-manager");

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

describe("GroupBuyingManager", () => {
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
    manager = new GroupBuyingManager(mockDb, mockEscrow, mockAsset);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with dependencies", () => {
      expect(manager).toBeDefined();
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates group_buys and group_buy_members tables", async () => {
      await manager.initialize();
      // _initializeTables calls exec twice
      expect(mockDb.db.exec).toHaveBeenCalledTimes(2);
      const sqls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(sqls.some((s) => s.includes("group_buys"))).toBe(true);
      expect(sqls.some((s) => s.includes("group_buy_members"))).toBe(true);
    });
  });

  // ── createGroupBuy ────────────────────────────────────────────────────────────

  describe("createGroupBuy()", () => {
    const validParams = {
      creatorId: "creator-1",
      itemId: "item-1",
      originalPrice: 200,
      targetPrice: 150,
      minMembers: 3,
      maxMembers: 10,
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days in the future
    };

    it("creates group buy and returns group object", async () => {
      const groupRow = {
        id: "gb-1",
        creator_id: "creator-1",
        status: "active",
        current_members: 0,
      };
      mockDb._prep.get.mockReturnValue(groupRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.createGroupBuy(validParams);
      expect(result).toBeDefined();
      expect(result.creator_id).toBe("creator-1");
    });

    it("throws when target price >= original price", async () => {
      await manager.initialize();
      await expect(
        manager.createGroupBuy({ ...validParams, targetPrice: 200 }),
      ).rejects.toThrow("Target price must be less than original price");
    });

    it("throws when minMembers < 2", async () => {
      await manager.initialize();
      await expect(
        manager.createGroupBuy({ ...validParams, minMembers: 1 }),
      ).rejects.toThrow("Minimum members must be at least 2");
    });

    it("throws when maxMembers < minMembers", async () => {
      await manager.initialize();
      await expect(
        manager.createGroupBuy({
          ...validParams,
          minMembers: 10,
          maxMembers: 5,
        }),
      ).rejects.toThrow("Max members must be >= min members");
    });

    it("throws when deadline is in the past", async () => {
      await manager.initialize();
      await expect(
        manager.createGroupBuy({ ...validParams, deadline: Date.now() - 1000 }),
      ).rejects.toThrow("Deadline must be in the future");
    });

    it("throws when required fields are missing", async () => {
      await manager.initialize();
      await expect(
        manager.createGroupBuy({ creatorId: "c1" }), // missing itemId, prices
      ).rejects.toThrow("Missing required fields");
    });
  });

  // ── joinGroupBuy ──────────────────────────────────────────────────────────────

  describe("joinGroupBuy()", () => {
    const activeGroup = {
      id: "gb-1",
      creator_id: "creator-1",
      status: "active",
      current_members: 2,
      max_members: 10,
      min_members: 3,
    };

    it("joins active group buy and returns memberId", async () => {
      // getGroupBuy() calls: .get() for group row, .all() for members
      // existing member check: .get() → null (not joined)
      // after insert: another getGroupBuy() .get() + .all()
      mockDb._prep.get
        .mockReturnValueOnce(activeGroup) // getGroupBuy group row
        .mockReturnValueOnce(null) // existing member check
        .mockReturnValueOnce(activeGroup); // second getGroupBuy after update
      mockDb._prep.all.mockReturnValue([]); // members array for all getGroupBuy calls
      await manager.initialize();
      const result = await manager.joinGroupBuy("gb-1", "user-1", 1);
      expect(result).toBeDefined();
      expect(result.groupId).toBe("gb-1");
      expect(result.userId).toBe("user-1");
    });

    it("throws when group buy not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(
        manager.joinGroupBuy("nonexistent", "user-1", 1),
      ).rejects.toThrow("Group buy not found");
    });

    it("throws when group buy is not active", async () => {
      mockDb._prep.get.mockReturnValue({ ...activeGroup, status: "success" });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.joinGroupBuy("gb-1", "user-1", 1)).rejects.toThrow(
        "not active",
      );
    });

    it("throws when creator tries to join own group", async () => {
      mockDb._prep.get.mockReturnValue(activeGroup);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(
        manager.joinGroupBuy("gb-1", "creator-1", 1), // creator-1 is the creator
      ).rejects.toThrow("Creator cannot join");
    });

    it("throws when group buy is full", async () => {
      const fullGroup = {
        ...activeGroup,
        current_members: 10,
        max_members: 10,
      };
      mockDb._prep.get
        .mockReturnValueOnce(fullGroup) // getGroupBuy row
        .mockReturnValueOnce(null); // existing member check (not joined - reaches full check)
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.joinGroupBuy("gb-1", "user-1", 1)).rejects.toThrow(
        "full",
      );
    });

    it("throws when already joined", async () => {
      // getGroupBuy: .get() → activeGroup, .all() → []
      // existing member check: .get() → { id: "member-1" } (already joined)
      mockDb._prep.get
        .mockReturnValueOnce(activeGroup) // getGroupBuy group row
        .mockReturnValueOnce({ id: "member-1" }); // existing member check
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.joinGroupBuy("gb-1", "user-2", 1)).rejects.toThrow(
        "Already joined",
      );
    });
  });

  // ── leaveGroupBuy ─────────────────────────────────────────────────────────────

  describe("leaveGroupBuy()", () => {
    it("leaves group buy (marks as left)", async () => {
      const group = {
        id: "gb-1",
        status: "active",
        current_members: 3,
        creator_id: "c1",
      };
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.run.mockReturnValue({ changes: 1 });
      await manager.initialize();
      const result = await manager.leaveGroupBuy("gb-1", "user-1");
      expect(result).toBe(true);
    });

    it("returns false when user was not a member", async () => {
      const group = {
        id: "gb-1",
        status: "active",
        current_members: 2,
        creator_id: "c1",
      };
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.run.mockReturnValue({ changes: 0 });
      await manager.initialize();
      const result = await manager.leaveGroupBuy("gb-1", "user-1");
      expect(result).toBe(false);
    });

    it("throws when group buy not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(
        manager.leaveGroupBuy("nonexistent", "user-1"),
      ).rejects.toThrow("Group buy not found");
    });
  });

  // ── getGroupBuy ───────────────────────────────────────────────────────────────

  describe("getGroupBuy()", () => {
    it("returns group buy with members", () => {
      const group = {
        id: "gb-1",
        creator_id: "c1",
        status: "active",
        current_members: 2,
      };
      const members = [{ user_id: "u1" }, { user_id: "u2" }];
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue(members);
      const result = manager.getGroupBuy("gb-1");
      expect(result.id).toBe("gb-1");
      expect(result.members).toHaveLength(2);
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getGroupBuy("nonexistent")).toBeNull();
    });
  });

  // ── listGroupBuys ─────────────────────────────────────────────────────────────

  describe("listGroupBuys()", () => {
    it("returns groupBuys and total", async () => {
      mockDb._prep.all.mockReturnValue([{ id: "gb-1" }, { id: "gb-2" }]);
      mockDb._prep.get.mockReturnValue({ total: 2 });
      await manager.initialize();
      const result = await manager.listGroupBuys({});
      expect(result.groupBuys).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.get.mockReturnValue({ total: 0 });
      await manager.initialize();
      const result = await manager.listGroupBuys({ status: "success" });
      expect(result.groupBuys).toHaveLength(0);
    });
  });

  // ── finalizeGroupBuy ──────────────────────────────────────────────────────────

  describe("finalizeGroupBuy()", () => {
    it("finalizes with status 'success' when enough members", async () => {
      const group = {
        id: "gb-1",
        status: "active",
        min_members: 3,
        current_members: 5,
        creator_id: "c1",
      };
      const successGroup = { ...group, status: "success" };
      mockDb._prep.get
        .mockReturnValueOnce(group) // first getGroupBuy
        .mockReturnValueOnce(successGroup); // second getGroupBuy (return)
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.finalizeGroupBuy("gb-1");
      expect(result).toBeDefined();
      // run() should have been called with 'success'
      expect(mockDb._prep.run).toHaveBeenCalledWith(
        "success",
        expect.any(Number),
        "gb-1",
      );
    });

    it("finalizes with status 'failed' when not enough members", async () => {
      const group = {
        id: "gb-1",
        status: "active",
        min_members: 10,
        current_members: 2,
        creator_id: "c1",
      };
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await manager.finalizeGroupBuy("gb-1");
      expect(mockDb._prep.run).toHaveBeenCalledWith(
        "failed",
        expect.any(Number),
        "gb-1",
      );
    });

    it("throws when group buy not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.finalizeGroupBuy("nonexistent")).rejects.toThrow(
        "Group buy not found",
      );
    });

    it("returns group without modifying when already finalized", async () => {
      const group = {
        id: "gb-1",
        status: "success",
        min_members: 3,
        current_members: 5,
        creator_id: "c1",
      };
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.finalizeGroupBuy("gb-1");
      expect(result).toBeDefined();
      // run() should NOT have been called since status !== 'active'
    });
  });

  // ── cancelGroupBuy ────────────────────────────────────────────────────────────

  describe("cancelGroupBuy()", () => {
    it("creator can cancel active group buy", async () => {
      const group = {
        id: "gb-1",
        creator_id: "creator-1",
        status: "active",
        current_members: 2,
      };
      const cancelledGroup = { ...group, status: "cancelled" };
      mockDb._prep.get
        .mockReturnValueOnce(group)
        .mockReturnValueOnce([]) // members in getGroupBuy
        .mockReturnValueOnce(cancelledGroup) // final getGroupBuy
        .mockReturnValueOnce([]); // members
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.cancelGroupBuy("gb-1", "creator-1");
      expect(result).toBeDefined();
      expect(mockDb._prep.run).toHaveBeenCalled();
    });

    it("throws when non-creator tries to cancel", async () => {
      const group = {
        id: "gb-1",
        creator_id: "creator-1",
        status: "active",
        current_members: 0,
      };
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(
        manager.cancelGroupBuy("gb-1", "other-user"),
      ).rejects.toThrow("Only creator can cancel");
    });

    it("throws when group buy is not active", async () => {
      const group = {
        id: "gb-1",
        creator_id: "creator-1",
        status: "success",
        current_members: 5,
      };
      mockDb._prep.get.mockReturnValue(group);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.cancelGroupBuy("gb-1", "creator-1")).rejects.toThrow(
        "not active",
      );
    });
  });
});
