/**
 * Social IPC Unit Tests
 *
 * Covers:
 * - registerSocialIPC registers all expected IPC channels
 * - Contact handlers delegate to contactManager
 * - Friend handlers delegate to friendManager
 * - Trust handlers delegate to friendManager trust methods
 * - Post handlers delegate to postManager
 * - Null manager graceful fallbacks
 * - Error propagation from managers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
    emit: vi.fn(),
  };
}

const { registerSocialIPC } = await import("../social-ipc.js");

// ── Mock managers ────────────────────────────────────────────────────────
const mockEvent = {};

function createMockContact() {
  return {
    addContact: vi.fn().mockResolvedValue({ success: true }),
    addContactFromQR: vi.fn().mockResolvedValue({ success: true }),
    getAllContacts: vi.fn().mockReturnValue([{ did: "did:test:bob" }]),
    getContactByDID: vi.fn().mockReturnValue({ did: "did:test:bob" }),
    updateContact: vi.fn().mockResolvedValue({ success: true }),
    deleteContact: vi.fn().mockResolvedValue({ success: true }),
    searchContacts: vi.fn().mockReturnValue([]),
    getFriends: vi.fn().mockReturnValue([]),
    getStatistics: vi
      .fn()
      .mockReturnValue({ total: 5, friends: 3, byRelationship: {} }),
  };
}

function createMockFriend() {
  return {
    sendFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    acceptFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    rejectFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    getPendingFriendRequests: vi.fn().mockResolvedValue([]),
    getFriends: vi.fn().mockResolvedValue([]),
    removeFriend: vi.fn().mockResolvedValue({ success: true }),
    updateFriendNickname: vi.fn().mockResolvedValue({ success: true }),
    updateFriendGroup: vi.fn().mockResolvedValue({ success: true }),
    getStatistics: vi
      .fn()
      .mockResolvedValue({ total: 0, online: 0, offline: 0, byGroup: {} }),
    getTrustScore: vi.fn().mockResolvedValue(0.7),
    updateTrustScore: vi.fn().mockResolvedValue(undefined),
    recordTrustInteraction: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPost() {
  return {
    createPost: vi.fn().mockResolvedValue({ id: "p1", content: "test" }),
    getFeed: vi.fn().mockResolvedValue([]),
    getPost: vi.fn().mockResolvedValue({ id: "p1" }),
    deletePost: vi.fn().mockResolvedValue({ success: true }),
    likePost: vi.fn().mockResolvedValue({ success: true }),
    unlikePost: vi.fn().mockResolvedValue({ success: true }),
    getLikes: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue({ id: "c1" }),
    getComments: vi.fn().mockResolvedValue([]),
    deleteComment: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockDb() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
    },
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
  };
}

describe("Social IPC", () => {
  let mockIpcMain;
  let handlers;
  let mockContact;
  let mockFriend;
  let mockPost;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain = createMockIpcMain();
    mockContact = createMockContact();
    mockFriend = createMockFriend();
    mockPost = createMockPost();
    mockDb = createMockDb();

    registerSocialIPC({
      contactManager: mockContact,
      friendManager: mockFriend,
      postManager: mockPost,
      database: mockDb,
      groupChatManager: null,
      ipcMain: mockIpcMain,
    });

    handlers = mockIpcMain.handlers;
  });

  // ── Registration ─────────────────────────────────────────────────────
  describe("registerSocialIPC", () => {
    it("should register handlers", () => {
      expect(Object.keys(handlers).length).toBeGreaterThan(0);
    });

    it("should register all expected contact channels", () => {
      const channels = [
        "contact:add",
        "contact:add-from-qr",
        "contact:get-all",
        "contact:get",
        "contact:update",
        "contact:delete",
        "contact:search",
        "contact:get-friends",
        "contact:get-statistics",
      ];
      for (const ch of channels) {
        expect(handlers[ch], `handler for ${ch}`).toBeDefined();
      }
    });

    it("should register all expected friend channels", () => {
      const channels = [
        "friend:send-request",
        "friend:accept-request",
        "friend:reject-request",
        "friend:get-pending-requests",
        "friend:get-friends",
        "friend:get-list",
        "friend:remove",
        "friend:update-nickname",
        "friend:update-group",
        "friend:get-statistics",
      ];
      for (const ch of channels) {
        expect(handlers[ch], `handler for ${ch}`).toBeDefined();
      }
    });

    it("should register all expected trust channels", () => {
      const channels = [
        "social:getTrustScore",
        "social:updateTrustScore",
        "social:recordTrustInteraction",
      ];
      for (const ch of channels) {
        expect(handlers[ch], `handler for ${ch}`).toBeDefined();
      }
    });

    it("should register all expected post channels", () => {
      const channels = [
        "post:create",
        "post:get-feed",
        "post:get",
        "post:delete",
        "post:like",
        "post:unlike",
        "post:get-likes",
        "post:add-comment",
        "post:get-comments",
        "post:delete-comment",
      ];
      for (const ch of channels) {
        expect(handlers[ch], `handler for ${ch}`).toBeDefined();
      }
    });

    it("should register chat channels", () => {
      const channels = [
        "chat:get-sessions",
        "chat:get-messages",
        "chat:save-message",
        "chat:update-message-status",
        "chat:mark-as-read",
      ];
      for (const ch of channels) {
        expect(handlers[ch], `handler for ${ch}`).toBeDefined();
      }
    });
  });

  // ── Contact handlers ─────────────────────────────────────────────────
  describe("contact handlers", () => {
    it("contact:add should call contactManager.addContact", async () => {
      const result = await handlers["contact:add"](mockEvent, {
        did: "did:test:bob",
      });
      expect(mockContact.addContact).toHaveBeenCalledWith({
        did: "did:test:bob",
      });
      expect(result.success).toBe(true);
    });

    it("contact:get-all should return contacts list", async () => {
      const result = await handlers["contact:get-all"](mockEvent);
      expect(result.success).toBe(true);
      expect(result.contacts).toHaveLength(1);
    });

    it("contact:get should call getContactByDID", async () => {
      const result = await handlers["contact:get"](mockEvent, "did:test:bob");
      expect(mockContact.getContactByDID).toHaveBeenCalledWith("did:test:bob");
      expect(result.did).toBe("did:test:bob");
    });
  });

  // ── Friend handlers ──────────────────────────────────────────────────
  describe("friend handlers", () => {
    it("friend:send-request should call sendFriendRequest", async () => {
      const result = await handlers["friend:send-request"](
        mockEvent,
        "did:test:bob",
        "hello",
      );
      expect(mockFriend.sendFriendRequest).toHaveBeenCalledWith(
        "did:test:bob",
        "hello",
      );
      expect(result.success).toBe(true);
    });

    it("friend:accept-request should call acceptFriendRequest", async () => {
      await handlers["friend:accept-request"](mockEvent, 1);
      expect(mockFriend.acceptFriendRequest).toHaveBeenCalledWith(1);
    });

    it("friend:reject-request should call rejectFriendRequest", async () => {
      await handlers["friend:reject-request"](mockEvent, 1);
      expect(mockFriend.rejectFriendRequest).toHaveBeenCalledWith(1);
    });

    it("friend:get-friends should call getFriends with groupName", async () => {
      await handlers["friend:get-friends"](mockEvent, "VIP");
      expect(mockFriend.getFriends).toHaveBeenCalledWith("VIP");
    });

    it("friend:get-list should return wrapped format", async () => {
      mockFriend.getFriends.mockResolvedValueOnce([
        { friend_did: "did:test:bob" },
      ]);
      const result = await handlers["friend:get-list"](mockEvent);
      expect(result.success).toBe(true);
      expect(result.friends).toHaveLength(1);
    });

    it("friend:remove should call removeFriend", async () => {
      await handlers["friend:remove"](mockEvent, "did:test:bob");
      expect(mockFriend.removeFriend).toHaveBeenCalledWith("did:test:bob");
    });

    it("friend:update-nickname should call updateFriendNickname", async () => {
      await handlers["friend:update-nickname"](
        mockEvent,
        "did:test:bob",
        "Bobby",
      );
      expect(mockFriend.updateFriendNickname).toHaveBeenCalledWith(
        "did:test:bob",
        "Bobby",
      );
    });

    it("friend:update-group should call updateFriendGroup", async () => {
      await handlers["friend:update-group"](mockEvent, "did:test:bob", "VIP");
      expect(mockFriend.updateFriendGroup).toHaveBeenCalledWith(
        "did:test:bob",
        "VIP",
      );
    });

    it("friend:get-statistics should return statistics", async () => {
      const result = await handlers["friend:get-statistics"](mockEvent);
      expect(result.total).toBe(0);
    });

    it("friend:get-pending-requests should return pending requests", async () => {
      const result = await handlers["friend:get-pending-requests"](mockEvent);
      expect(result).toEqual([]);
    });
  });

  // ── Trust handlers ───────────────────────────────────────────────────
  describe("trust handlers", () => {
    it("social:getTrustScore should return trust score", async () => {
      const result = await handlers["social:getTrustScore"](
        mockEvent,
        "did:test:bob",
      );
      expect(mockFriend.getTrustScore).toHaveBeenCalledWith("did:test:bob");
      expect(result).toBe(0.7);
    });

    it("social:updateTrustScore should call updateTrustScore", async () => {
      const result = await handlers["social:updateTrustScore"](
        mockEvent,
        "did:test:bob",
        0.9,
      );
      expect(mockFriend.updateTrustScore).toHaveBeenCalledWith(
        "did:test:bob",
        0.9,
      );
      expect(result.success).toBe(true);
    });

    it("social:recordTrustInteraction should call recordTrustInteraction", async () => {
      const result = await handlers["social:recordTrustInteraction"](
        mockEvent,
        "did:test:bob",
        "message_sent",
        1.0,
      );
      expect(mockFriend.recordTrustInteraction).toHaveBeenCalledWith(
        "did:test:bob",
        "message_sent",
        1.0,
      );
      expect(result.success).toBe(true);
    });
  });

  // ── Post handlers ────────────────────────────────────────────────────
  describe("post handlers", () => {
    it("post:create should call createPost", async () => {
      const opts = { content: "hello" };
      const result = await handlers["post:create"](mockEvent, opts);
      expect(mockPost.createPost).toHaveBeenCalledWith(opts);
      expect(result.id).toBe("p1");
    });

    it("post:get-feed should call getFeed", async () => {
      await handlers["post:get-feed"](mockEvent, { limit: 10 });
      expect(mockPost.getFeed).toHaveBeenCalledWith({ limit: 10 });
    });

    it("post:get should call getPost", async () => {
      await handlers["post:get"](mockEvent, "p1");
      expect(mockPost.getPost).toHaveBeenCalledWith("p1");
    });

    it("post:delete should call deletePost", async () => {
      await handlers["post:delete"](mockEvent, "p1");
      expect(mockPost.deletePost).toHaveBeenCalledWith("p1");
    });

    it("post:like should call likePost", async () => {
      await handlers["post:like"](mockEvent, "p1");
      expect(mockPost.likePost).toHaveBeenCalledWith("p1");
    });

    it("post:unlike should call unlikePost", async () => {
      await handlers["post:unlike"](mockEvent, "p1");
      expect(mockPost.unlikePost).toHaveBeenCalledWith("p1");
    });

    it("post:add-comment should call addComment with all args", async () => {
      await handlers["post:add-comment"](mockEvent, "p1", "nice", "parent-c1");
      expect(mockPost.addComment).toHaveBeenCalledWith(
        "p1",
        "nice",
        "parent-c1",
      );
    });

    it("post:get-comments should call getComments", async () => {
      await handlers["post:get-comments"](mockEvent, "p1");
      expect(mockPost.getComments).toHaveBeenCalledWith("p1");
    });

    it("post:delete-comment should call deleteComment", async () => {
      await handlers["post:delete-comment"](mockEvent, "c1");
      expect(mockPost.deleteComment).toHaveBeenCalledWith("c1");
    });
  });

  // ── Null manager fallbacks ───────────────────────────────────────────
  describe("null manager fallbacks", () => {
    let nullHandlers;

    beforeEach(() => {
      const nullIpc = createMockIpcMain();
      registerSocialIPC({
        contactManager: null,
        friendManager: null,
        postManager: null,
        database: null,
        groupChatManager: null,
        ipcMain: nullIpc,
      });
      nullHandlers = nullIpc.handlers;
    });

    it("contact:add should throw when contactManager is null", async () => {
      await expect(
        nullHandlers["contact:add"](mockEvent, {}),
      ).rejects.toThrow();
    });

    it("contact:get-all should return empty contacts when contactManager is null", async () => {
      const result = await nullHandlers["contact:get-all"](mockEvent);
      expect(result.success).toBe(true);
      expect(result.contacts).toEqual([]);
    });

    it("friend:send-request should throw when friendManager is null", async () => {
      await expect(
        nullHandlers["friend:send-request"](mockEvent, "did:test:bob"),
      ).rejects.toThrow();
    });

    it("friend:get-pending-requests should return empty when friendManager is null", async () => {
      const result =
        await nullHandlers["friend:get-pending-requests"](mockEvent);
      expect(result).toEqual([]);
    });

    it("social:getTrustScore should return 0.5 when friendManager is null", async () => {
      const result = await nullHandlers["social:getTrustScore"](
        mockEvent,
        "did:test:bob",
      );
      expect(result).toBe(0.5);
    });

    it("post:create should throw when postManager is null", async () => {
      await expect(
        nullHandlers["post:create"](mockEvent, { content: "test" }),
      ).rejects.toThrow();
    });

    it("post:get-feed should return empty when postManager is null", async () => {
      const result = await nullHandlers["post:get-feed"](mockEvent);
      expect(result).toEqual([]);
    });

    it("post:get should return null when postManager is null", async () => {
      const result = await nullHandlers["post:get"](mockEvent, "p1");
      expect(result).toBeNull();
    });
  });

  // ── Error propagation ────────────────────────────────────────────────
  describe("error propagation", () => {
    it("should propagate errors from friend manager", async () => {
      mockFriend.sendFriendRequest.mockRejectedValueOnce(
        new Error("network error"),
      );
      await expect(
        handlers["friend:send-request"](mockEvent, "did:test:bob"),
      ).rejects.toThrow("network error");
    });

    it("should propagate errors from post manager", async () => {
      mockPost.deletePost.mockRejectedValueOnce(new Error("not found"));
      await expect(handlers["post:delete"](mockEvent, "p1")).rejects.toThrow(
        "not found",
      );
    });
  });
});
