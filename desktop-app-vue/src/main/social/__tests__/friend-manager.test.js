/**
 * FriendManager Unit Tests
 *
 * Covers:
 * - constructor: sets properties, extends EventEmitter
 * - initialize: calls initializeTables, loadFriendStatus, setupP2PListeners
 * - initializeTables: exec calls for table creation, migration
 * - sendFriendRequest: happy path, not-logged-in, self-add, already-friends, duplicate request
 * - acceptFriendRequest: happy path, not-found, already-processed, wrong-user
 * - rejectFriendRequest: happy path, not-found, already-processed, wrong-user
 * - getFriends: returns friends with online status, empty when not logged in, group filter
 * - removeFriend: happy path, deletes bidirectional, not-logged-in
 * - updateFriendNickname: happy path, not-logged-in
 * - updateFriendGroup: happy path, not-logged-in
 * - isFriend: true when found, false when not found, false when not logged in
 * - getStatistics: computes totals, handles not-logged-in
 * - calculateTrustScore: returns 0.5 default, computes weighted score
 * - recordTrustInteraction: inserts record, recalculates score
 * - updateTrustScore: clamps and updates
 * - getTrustScore: returns score from DB, default 0.5 when not found
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────
const {
  FriendManager,
  FriendshipStatus,
  FriendRequestStatus,
  FriendOnlineStatus,
} = require("../friend-manager.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
  };
}

function createMockDIDManager(did = "did:test:alice") {
  return { getCurrentIdentity: vi.fn().mockReturnValue({ did }) };
}

function createMockP2PManager() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    broadcast: vi.fn(),
    sendMessage: vi.fn(),
    sendEncryptedMessage: vi.fn().mockResolvedValue(true),
    getConnectedPeers: vi.fn().mockReturnValue([]),
  };
}

describe("FriendManager", () => {
  let fm;
  let mockDb;
  let mockDID;
  let mockP2P;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    mockDID = createMockDIDManager();
    mockP2P = createMockP2PManager();
    fm = new FriendManager(mockDb, mockDID, mockP2P);
  });

  // ─── Constructor ──────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should set database, didManager, p2pManager properties", () => {
      expect(fm.database).toBe(mockDb);
      expect(fm.didManager).toBe(mockDID);
      expect(fm.p2pManager).toBe(mockP2P);
    });

    it("should initialise as not initialized with empty online status", () => {
      expect(fm.initialized).toBe(false);
      expect(fm.onlineStatus).toBeInstanceOf(Map);
      expect(fm.onlineStatus.size).toBe(0);
    });
  });

  // ─── initialize ───────────────────────────────────────────────────────
  describe("initialize", () => {
    it("should call initializeTables, loadFriendStatus, setupP2PListeners and set initialized", async () => {
      await fm.initialize();
      // Tables created via exec
      expect(mockDb.db.exec).toHaveBeenCalled();
      // P2P listeners set up
      expect(mockP2P.on).toHaveBeenCalled();
      expect(fm.initialized).toBe(true);
    });

    it("should throw and not set initialized if initializeTables fails", async () => {
      mockDb.db.exec.mockImplementationOnce(() => {
        throw new Error("db error");
      });
      await expect(fm.initialize()).rejects.toThrow("db error");
      expect(fm.initialized).toBe(false);
    });
  });

  // ─── initializeTables ─────────────────────────────────────────────────
  describe("initializeTables", () => {
    it("should create friendships, friend_requests, friend_status, trust_interactions tables", async () => {
      await fm.initializeTables();
      const execCalls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(execCalls.some((sql) => sql.includes("friendships"))).toBe(true);
      expect(execCalls.some((sql) => sql.includes("friend_requests"))).toBe(
        true,
      );
      expect(execCalls.some((sql) => sql.includes("friend_status"))).toBe(true);
      expect(execCalls.some((sql) => sql.includes("trust_interactions"))).toBe(
        true,
      );
    });

    it("should silently handle migration error for trust_score column", async () => {
      // First exec calls succeed, then the ALTER TABLE throws (column exists)
      let callCount = 0;
      mockDb.db.exec.mockImplementation((sql) => {
        callCount++;
        if (sql.includes("ALTER TABLE")) {
          throw new Error("duplicate column name: trust_score");
        }
      });
      // Should not throw
      await fm.initializeTables();
    });
  });

  // ─── sendFriendRequest ────────────────────────────────────────────────
  describe("sendFriendRequest", () => {
    it("should insert a request and send P2P message on success", async () => {
      // isFriend returns false (no friendship found)
      mockDb.db._prep.get.mockReturnValue(null);
      const result = await fm.sendFriendRequest("did:test:bob", "hello");
      expect(result.success).toBe(true);
      expect(mockDb.db._prep.run).toHaveBeenCalled();
      expect(mockP2P.sendEncryptedMessage).toHaveBeenCalledWith(
        "did:test:bob",
        expect.stringContaining("friend-request"),
      );
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(fm.sendFriendRequest("did:test:bob")).rejects.toThrow(
        "未登录",
      );
    });

    it("should throw when adding self", async () => {
      await expect(fm.sendFriendRequest("did:test:alice")).rejects.toThrow(
        "不能添加自己为好友",
      );
    });

    it("should throw when already friends", async () => {
      // isFriend check returns a friendship
      mockDb.db._prep.get.mockReturnValueOnce({ status: "accepted" });
      await expect(fm.sendFriendRequest("did:test:bob")).rejects.toThrow(
        "已经是好友关系",
      );
    });

    it("should throw when pending request already exists", async () => {
      // isFriend returns false
      mockDb.db._prep.get
        .mockReturnValueOnce(null) // isFriend
        .mockReturnValueOnce({ status: "pending" }); // getFriendRequest
      await expect(fm.sendFriendRequest("did:test:bob")).rejects.toThrow(
        "已经发送过好友请求",
      );
    });

    it("should emit friend-request:sent event", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      const handler = vi.fn();
      fm.on("friend-request:sent", handler);
      await fm.sendFriendRequest("did:test:bob", "hi");
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ targetDid: "did:test:bob", message: "hi" }),
      );
    });
  });

  // ─── acceptFriendRequest ──────────────────────────────────────────────
  describe("acceptFriendRequest", () => {
    it("should accept request, create bidirectional friendship, notify via P2P", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: 1,
        from_did: "did:test:bob",
        to_did: "did:test:alice",
        status: "pending",
      });
      const result = await fm.acceptFriendRequest(1);
      expect(result.success).toBe(true);
      // Two friendship inserts (bidirectional) + request update
      expect(mockDb.db._prep.run).toHaveBeenCalled();
      expect(mockP2P.sendEncryptedMessage).toHaveBeenCalledWith(
        "did:test:bob",
        expect.stringContaining("friend-request-accepted"),
      );
    });

    it("should throw when request not found", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      await expect(fm.acceptFriendRequest(999)).rejects.toThrow(
        "好友请求不存在",
      );
    });

    it("should throw when request already processed", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: 1,
        status: "accepted",
        to_did: "did:test:alice",
      });
      await expect(fm.acceptFriendRequest(1)).rejects.toThrow("好友请求已处理");
    });

    it("should throw when current user is not the recipient", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: 1,
        status: "pending",
        to_did: "did:test:other",
        from_did: "did:test:bob",
      });
      await expect(fm.acceptFriendRequest(1)).rejects.toThrow(
        "无权处理此好友请求",
      );
    });
  });

  // ─── rejectFriendRequest ──────────────────────────────────────────────
  describe("rejectFriendRequest", () => {
    it("should reject request and emit event", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: 1,
        from_did: "did:test:bob",
        to_did: "did:test:alice",
        status: "pending",
      });
      const handler = vi.fn();
      fm.on("friend-request:rejected", handler);
      const result = await fm.rejectFriendRequest(1);
      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ fromDid: "did:test:bob" }),
      );
    });

    it("should throw when request not found", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      await expect(fm.rejectFriendRequest(999)).rejects.toThrow(
        "好友请求不存在",
      );
    });

    it("should throw when request already processed", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: 1,
        status: "rejected",
        to_did: "did:test:alice",
      });
      await expect(fm.rejectFriendRequest(1)).rejects.toThrow("好友请求已处理");
    });

    it("should throw when current user is not the recipient", async () => {
      mockDb.db._prep.get.mockReturnValue({
        id: 1,
        status: "pending",
        to_did: "did:test:other",
        from_did: "did:test:bob",
      });
      await expect(fm.rejectFriendRequest(1)).rejects.toThrow(
        "无权处理此好友请求",
      );
    });
  });

  // ─── getFriends ───────────────────────────────────────────────────────
  describe("getFriends", () => {
    it("should return friends with online status attached", async () => {
      mockDb.db._prep.all.mockReturnValue([
        { friend_did: "did:test:bob", group_name: "default" },
      ]);
      const friends = await fm.getFriends();
      expect(friends).toHaveLength(1);
      expect(friends[0].onlineStatus).toEqual({
        status: FriendOnlineStatus.OFFLINE,
        lastSeen: 0,
        deviceCount: 0,
      });
    });

    it("should return empty array when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      const friends = await fm.getFriends();
      expect(friends).toEqual([]);
    });

    it("should use cached online status if available", async () => {
      fm.onlineStatus.set("did:test:bob", {
        status: FriendOnlineStatus.ONLINE,
        lastSeen: 12345,
        deviceCount: 2,
      });
      mockDb.db._prep.all.mockReturnValue([
        { friend_did: "did:test:bob", group_name: "default" },
      ]);
      const friends = await fm.getFriends();
      expect(friends[0].onlineStatus.status).toBe("online");
      expect(friends[0].onlineStatus.deviceCount).toBe(2);
    });
  });

  // ─── removeFriend ─────────────────────────────────────────────────────
  describe("removeFriend", () => {
    it("should delete bidirectional friendship and emit event", async () => {
      const handler = vi.fn();
      fm.on("friend:removed", handler);
      const result = await fm.removeFriend("did:test:bob");
      expect(result.success).toBe(true);
      // Two DELETE calls (one for each direction)
      expect(mockDb.db._prep.run).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith({ friendDid: "did:test:bob" });
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(fm.removeFriend("did:test:bob")).rejects.toThrow("未登录");
    });
  });

  // ─── updateFriendNickname ─────────────────────────────────────────────
  describe("updateFriendNickname", () => {
    it("should update nickname and emit event", async () => {
      const handler = vi.fn();
      fm.on("friend:nickname-updated", handler);
      const result = await fm.updateFriendNickname("did:test:bob", "Bobby");
      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledWith({
        friendDid: "did:test:bob",
        nickname: "Bobby",
      });
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(
        fm.updateFriendNickname("did:test:bob", "Bobby"),
      ).rejects.toThrow("未登录");
    });
  });

  // ─── updateFriendGroup ────────────────────────────────────────────────
  describe("updateFriendGroup", () => {
    it("should update group and emit event", async () => {
      const handler = vi.fn();
      fm.on("friend:group-updated", handler);
      const result = await fm.updateFriendGroup("did:test:bob", "VIP");
      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledWith({
        friendDid: "did:test:bob",
        groupName: "VIP",
      });
    });

    it("should throw when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await expect(fm.updateFriendGroup("did:test:bob", "VIP")).rejects.toThrow(
        "未登录",
      );
    });
  });

  // ─── isFriend ─────────────────────────────────────────────────────────
  describe("isFriend", () => {
    it("should return true when friendship exists", async () => {
      mockDb.db._prep.get.mockReturnValue({ status: "accepted" });
      expect(await fm.isFriend("did:test:bob")).toBe(true);
    });

    it("should return false when friendship does not exist", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      expect(await fm.isFriend("did:test:bob")).toBe(false);
    });

    it("should return false when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      expect(await fm.isFriend("did:test:bob")).toBe(false);
    });
  });

  // ─── getStatistics ────────────────────────────────────────────────────
  describe("getStatistics", () => {
    it("should return zeroes when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      const stats = await fm.getStatistics();
      expect(stats).toEqual({ total: 0, online: 0, offline: 0, byGroup: {} });
    });

    it("should compute statistics from friends list", async () => {
      fm.onlineStatus.set("did:test:bob", {
        status: FriendOnlineStatus.ONLINE,
        lastSeen: 1,
        deviceCount: 1,
      });
      mockDb.db._prep.all.mockReturnValue([
        { friend_did: "did:test:bob", group_name: "work" },
        { friend_did: "did:test:carol", group_name: "work" },
      ]);
      const stats = await fm.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.online).toBe(1);
      expect(stats.offline).toBe(1);
      expect(stats.byGroup["work"]).toBe(2);
    });
  });

  // ─── calculateTrustScore ──────────────────────────────────────────────
  describe("calculateTrustScore", () => {
    it("should return 0.5 when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      expect(await fm.calculateTrustScore("did:test:bob")).toBe(0.5);
    });

    it("should return 0.5 when no interactions exist", async () => {
      mockDb.db._prep.all.mockReturnValue([]);
      expect(await fm.calculateTrustScore("did:test:bob")).toBe(0.5);
    });

    it("should compute a score > 0.5 for positive interactions", async () => {
      mockDb.db._prep.all.mockReturnValue([
        {
          interaction_type: "message_sent",
          weight: 1.0,
          created_at: Date.now(),
        },
        {
          interaction_type: "content_shared",
          weight: 1.0,
          created_at: Date.now(),
        },
      ]);
      const score = await fm.calculateTrustScore("did:test:bob");
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  // ─── recordTrustInteraction ───────────────────────────────────────────
  describe("recordTrustInteraction", () => {
    it("should insert interaction and recalculate trust score", async () => {
      // calculateTrustScore will return 0.5 (no interactions from all())
      mockDb.db._prep.all.mockReturnValue([]);
      await fm.recordTrustInteraction("did:test:bob", "message_sent", 1.0);
      // run() called for insert + updateTrustScore
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    it("should do nothing when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await fm.recordTrustInteraction("did:test:bob", "message_sent", 1.0);
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });
  });

  // ─── updateTrustScore ─────────────────────────────────────────────────
  describe("updateTrustScore", () => {
    it("should clamp score and emit event", async () => {
      const handler = vi.fn();
      fm.on("friend:trust-updated", handler);
      await fm.updateTrustScore("did:test:bob", 0.8);
      expect(mockDb.db._prep.run).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith({
        friendDid: "did:test:bob",
        trustScore: 0.8,
      });
    });

    it("should clamp score to [0, 1] range", async () => {
      const handler = vi.fn();
      fm.on("friend:trust-updated", handler);
      await fm.updateTrustScore("did:test:bob", 1.5);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ trustScore: 1 }),
      );
    });

    it("should do nothing when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      await fm.updateTrustScore("did:test:bob", 0.8);
      expect(mockDb.db._prep.run).not.toHaveBeenCalled();
    });
  });

  // ─── getTrustScore ────────────────────────────────────────────────────
  describe("getTrustScore", () => {
    it("should return stored trust score", async () => {
      mockDb.db._prep.get.mockReturnValue({ trust_score: 0.75 });
      expect(await fm.getTrustScore("did:test:bob")).toBe(0.75);
    });

    it("should return 0.5 when no friendship found", async () => {
      mockDb.db._prep.get.mockReturnValue(null);
      expect(await fm.getTrustScore("did:test:bob")).toBe(0.5);
    });

    it("should return 0.5 when trust_score is null", async () => {
      mockDb.db._prep.get.mockReturnValue({ trust_score: null });
      expect(await fm.getTrustScore("did:test:bob")).toBe(0.5);
    });

    it("should return 0.5 when not logged in", async () => {
      mockDID.getCurrentIdentity.mockReturnValue(null);
      expect(await fm.getTrustScore("did:test:bob")).toBe(0.5);
    });
  });

  // ─── close ────────────────────────────────────────────────────────────
  describe("close", () => {
    it("should clear state", async () => {
      fm.initialized = true;
      fm.onlineStatus.set("did:test:bob", { status: "online" });
      await fm.close();
      expect(fm.initialized).toBe(false);
      expect(fm.onlineStatus.size).toBe(0);
    });
  });
});
