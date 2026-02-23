/**
 * ChannelManager Unit Tests
 *
 * Covers:
 * - initialize() / initializeTables() table creation
 * - createChannel() happy path, permission check, name validation
 * - getChannels() array return
 * - sendMessage() happy path, empty content, announcement permissions
 * - getMessages() array return, pagination support
 * - pinMessage() / unpinMessage() permission and is_pinned update
 * - addReaction() / removeReaction() JSON reaction parsing
 * - deleteMessage() own message, moderator delete, permission error
 * - Event emissions
 * - Error propagation
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

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Import module under test ─────────────────────────────────────────────────
const { ChannelManager, ChannelType, MessageType } = require("../channel-manager");

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
      run: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    saveToFile: vi.fn(),
  };
}

function createMockDIDManager(did = "did:test:alice") {
  return {
    getCurrentIdentity: vi.fn().mockReturnValue({ did }),
  };
}

function createMockP2PManager() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    broadcast: vi.fn(),
    sendMessage: vi.fn(),
  };
}

function makeChannelRow(overrides = {}) {
  return {
    id: "channel-001",
    community_id: "community-001",
    name: "general",
    description: "General discussion",
    type: "discussion",
    sort_order: 0,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

function makeMessageRow(overrides = {}) {
  return {
    id: "message-001",
    channel_id: "channel-001",
    sender_did: "did:test:alice",
    content: "Hello World",
    message_type: "text",
    reply_to: null,
    is_pinned: 0,
    reactions: "{}",
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

function makeMemberRow(overrides = {}) {
  return {
    id: "member-001",
    community_id: "community-001",
    member_did: "did:test:alice",
    role: "member",
    nickname: null,
    status: "active",
    joined_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChannelManager", () => {
  let manager;
  let mockDatabase;
  let mockDIDManager;
  let mockP2PManager;

  beforeEach(() => {
    uuidCounter = 0;
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    mockP2PManager = createMockP2PManager();
    manager = new ChannelManager(mockDatabase, mockDIDManager, mockP2PManager);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create channels and channel_messages tables via db.exec", async () => {
      await manager.initialize();

      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const allSql = execCalls.join("\n");

      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS channels");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS channel_messages");
      expect(manager.initialized).toBe(true);
    });

    it("should create all required indexes", async () => {
      await manager.initialize();

      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const allSql = execCalls.join("\n");

      expect(allSql).toContain("idx_channels_community");
      expect(allSql).toContain("idx_channel_messages_channel");
    });

    it("should set initialized = true", async () => {
      expect(manager.initialized).toBe(false);
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should register P2P listener for channel:message-received", async () => {
      await manager.initialize();
      expect(mockP2PManager.on).toHaveBeenCalledWith(
        "channel:message-received",
        expect.any(Function),
      );
    });

    it("should skip P2P setup when no p2pManager", async () => {
      const managerNoPeer = new ChannelManager(mockDatabase, mockDIDManager, null);
      await managerNoPeer.initialize();
      expect(managerNoPeer.initialized).toBe(true);
    });

    it("should throw when db.exec throws", async () => {
      mockDatabase.db.exec.mockImplementation(() => {
        throw new Error("DB exec failure");
      });
      await expect(manager.initialize()).rejects.toThrow("DB exec failure");
      expect(manager.initialized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createChannel()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createChannel()", () => {
    beforeEach(async () => {
      await manager.initialize();
      // Setup: user is an owner member
      mockDatabase.db._prep.get.mockReturnValue(makeMemberRow({ role: "owner" }));
    });

    it("should create a channel and return a channel object", async () => {
      const channel = await manager.createChannel({
        communityId: "community-001",
        name: "announcements",
        description: "Official announcements",
        type: ChannelType.ANNOUNCEMENT,
      });

      expect(channel).toMatchObject({
        community_id: "community-001",
        name: "announcements",
        description: "Official announcements",
        type: ChannelType.ANNOUNCEMENT,
      });
      expect(channel.id).toBeTruthy();
    });

    it("should use discussion type by default", async () => {
      const channel = await manager.createChannel({
        communityId: "community-001",
        name: "general",
      });
      expect(channel.type).toBe(ChannelType.DISCUSSION);
    });

    it("should emit channel:created event", async () => {
      const listener = vi.fn();
      manager.on("channel:created", listener);

      const channel = await manager.createChannel({
        communityId: "community-001",
        name: "test-channel",
      });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ channel });
    });

    it("should insert into channels table", async () => {
      await manager.createChannel({ communityId: "community-001", name: "general" });

      const insertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO channels"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should call saveToFile after creating channel", async () => {
      await manager.createChannel({ communityId: "community-001", name: "general" });
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });

    it("should throw if channel name is empty", async () => {
      await expect(
        manager.createChannel({ communityId: "community-001", name: "" }),
      ).rejects.toThrow("Channel name cannot be empty");
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(
        manager.createChannel({ communityId: "community-001", name: "general" }),
      ).rejects.toThrow("User not logged in");
    });

    it("should throw if user lacks admin/owner role", async () => {
      // Override: user is just a member
      mockDatabase.db._prep.get.mockReturnValue(makeMemberRow({ role: "member" }));
      await expect(
        manager.createChannel({ communityId: "community-001", name: "general" }),
      ).rejects.toThrow("Insufficient permissions to create channels");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getChannels()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getChannels()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return channels for a community", async () => {
      const rows = [
        makeChannelRow(),
        makeChannelRow({ id: "channel-002", name: "random" }),
      ];
      mockDatabase.db._prep.all.mockReturnValue(rows);

      const result = await manager.getChannels("community-001");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("general");
    });

    it("should return empty array when no channels exist", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await manager.getChannels("community-001");
      expect(result).toEqual([]);
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await manager.getChannels("community-001");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sendMessage()
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendMessage()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should send a message in a discussion channel and return the message object", async () => {
      const channel = makeChannelRow({ type: "discussion" });
      const member = makeMemberRow({ role: "member" });
      // checkWritePermission: channel lookup, then member lookup
      mockDatabase.db._prep.get
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      const message = await manager.sendMessage({
        channelId: "channel-001",
        content: "Hello World",
      });

      expect(message).toMatchObject({
        channel_id: "channel-001",
        sender_did: "did:test:alice",
        content: "Hello World",
        message_type: MessageType.TEXT,
        is_pinned: 0,
      });
      expect(message.id).toBeTruthy();
    });

    it("should emit channel:message-sent event", async () => {
      const channel = makeChannelRow({ type: "discussion" });
      const member = makeMemberRow({ role: "member" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      const listener = vi.fn();
      manager.on("channel:message-sent", listener);

      const message = await manager.sendMessage({ channelId: "channel-001", content: "Hi" });
      expect(listener).toHaveBeenCalledWith({ channelId: "channel-001", message });
    });

    it("should insert into channel_messages table", async () => {
      const channel = makeChannelRow({ type: "discussion" });
      const member = makeMemberRow({ role: "member" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      await manager.sendMessage({ channelId: "channel-001", content: "Test" });

      const insertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO channel_messages"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should throw if content is empty", async () => {
      await expect(
        manager.sendMessage({ channelId: "channel-001", content: "" }),
      ).rejects.toThrow("Message content cannot be empty");
    });

    it("should throw if content is only whitespace", async () => {
      await expect(
        manager.sendMessage({ channelId: "channel-001", content: "   " }),
      ).rejects.toThrow("Message content cannot be empty");
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(
        manager.sendMessage({ channelId: "channel-001", content: "Hi" }),
      ).rejects.toThrow("User not logged in");
    });

    it("should throw when posting to announcement channel as a regular member", async () => {
      const channel = makeChannelRow({ type: "announcement" });
      const member = makeMemberRow({ role: "member" }); // Not admin/mod/owner
      mockDatabase.db._prep.get
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      await expect(
        manager.sendMessage({ channelId: "channel-001", content: "Hi" }),
      ).rejects.toThrow("Only admins can post in announcement channels");
    });

    it("should allow admin to post in announcement channel", async () => {
      const channel = makeChannelRow({ type: "announcement" });
      const member = makeMemberRow({ role: "admin" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      const message = await manager.sendMessage({ channelId: "channel-001", content: "Announcement!" });
      expect(message.content).toBe("Announcement!");
    });

    it("should throw if channel is readonly", async () => {
      const channel = makeChannelRow({ type: "readonly" });
      const member = makeMemberRow({ role: "owner" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      await expect(
        manager.sendMessage({ channelId: "channel-001", content: "Hi" }),
      ).rejects.toThrow("This channel is read-only");
    });

    it("should throw if channel is not found during permission check", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(
        manager.sendMessage({ channelId: "nonexistent", content: "Hi" }),
      ).rejects.toThrow("Channel not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getMessages()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getMessages()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return messages with parsed reactions", async () => {
      const rows = [
        makeMessageRow({ reactions: '{"👍":["did:test:alice"]}' }),
        makeMessageRow({ id: "message-002", reactions: "{}" }),
      ];
      mockDatabase.db._prep.all.mockReturnValue(rows);

      const result = await manager.getMessages("channel-001");
      expect(result).toHaveLength(2);
      expect(result[0].reactions).toEqual({ "👍": ["did:test:alice"] });
      expect(result[1].reactions).toEqual({});
    });

    it("should return empty array when no messages", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await manager.getMessages("channel-001");
      expect(result).toEqual([]);
    });

    it("should use pagination options", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      await manager.getMessages("channel-001", { limit: 10, offset: 20 });

      const prepareCalls = mockDatabase.db.prepare.mock.calls.map((c) => c[0]);
      const messagesQuery = prepareCalls.find((q) => q.includes("channel_messages"));
      expect(messagesQuery).toBeTruthy();
      expect(messagesQuery).toContain("LIMIT");
      expect(messagesQuery).toContain("OFFSET");
    });

    it("should support 'before' cursor for pagination", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      await manager.getMessages("channel-001", { before: 1700000000000 });

      const prepareCalls = mockDatabase.db.prepare.mock.calls.map((c) => c[0]);
      const messagesQuery = prepareCalls.find((q) => q.includes("created_at < ?"));
      expect(messagesQuery).toBeTruthy();
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await manager.getMessages("channel-001");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // pinMessage()
  // ─────────────────────────────────────────────────────────────────────────
  describe("pinMessage()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update is_pinned = 1 for a message", async () => {
      const message = makeMessageRow();
      const channel = makeChannelRow();
      const member = makeMemberRow({ role: "moderator" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(message) // message lookup
        .mockReturnValueOnce(channel) // channel lookup
        .mockReturnValueOnce(member); // member lookup

      const listener = vi.fn();
      manager.on("channel:message-pinned", listener);

      const result = await manager.pinMessage("message-001");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        messageId: "message-001",
        channelId: "channel-001",
      });

      const pinUpdate = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("is_pinned = 1"),
      );
      expect(pinUpdate).toBeTruthy();
    });

    it("should throw if message is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(manager.pinMessage("nonexistent")).rejects.toThrow("Message not found");
    });

    it("should throw if user is a regular member (insufficient permissions)", async () => {
      const message = makeMessageRow();
      const channel = makeChannelRow();
      const member = makeMemberRow({ role: "member" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(message)
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      await expect(manager.pinMessage("message-001")).rejects.toThrow(
        "Insufficient permissions to pin messages",
      );
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.pinMessage("message-001")).rejects.toThrow("User not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // unpinMessage()
  // ─────────────────────────────────────────────────────────────────────────
  describe("unpinMessage()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should update is_pinned = 0 for a pinned message", async () => {
      const message = makeMessageRow({ is_pinned: 1 });
      const channel = makeChannelRow();
      const member = makeMemberRow({ role: "admin" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(message)
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      const listener = vi.fn();
      manager.on("channel:message-unpinned", listener);

      const result = await manager.unpinMessage("message-001");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        messageId: "message-001",
        channelId: "channel-001",
      });

      const unpinUpdate = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("is_pinned = 0"),
      );
      expect(unpinUpdate).toBeTruthy();
    });

    it("should throw if message is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(manager.unpinMessage("nonexistent")).rejects.toThrow("Message not found");
    });

    it("should throw if user lacks moderator permissions", async () => {
      const message = makeMessageRow({ is_pinned: 1 });
      const channel = makeChannelRow();
      const member = makeMemberRow({ role: "member" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(message)
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      await expect(manager.unpinMessage("message-001")).rejects.toThrow(
        "Insufficient permissions to unpin messages",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // addReaction()
  // ─────────────────────────────────────────────────────────────────────────
  describe("addReaction()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should add a reaction emoji, parsing and updating JSON column", async () => {
      const message = makeMessageRow({ reactions: "{}" });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      const listener = vi.fn();
      manager.on("channel:reaction-added", listener);

      const result = await manager.addReaction("message-001", "👍");
      expect(result.success).toBe(true);
      expect(result.reactions["👍"]).toContain("did:test:alice");
      expect(listener).toHaveBeenCalledWith({
        messageId: "message-001",
        emoji: "👍",
        userDid: "did:test:alice",
      });

      // Should persist updated reactions JSON
      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE channel_messages SET reactions = ?"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should not duplicate a DID in the same emoji reaction", async () => {
      // Alice has already reacted
      const message = makeMessageRow({ reactions: '{"👍":["did:test:alice"]}' });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      const result = await manager.addReaction("message-001", "👍");
      // DID should appear only once
      expect(result.reactions["👍"].filter((d) => d === "did:test:alice")).toHaveLength(1);
    });

    it("should add a new emoji key when emoji does not exist yet", async () => {
      const message = makeMessageRow({ reactions: '{"👎":["did:test:bob"]}' });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      const result = await manager.addReaction("message-001", "❤️");
      expect(result.reactions["❤️"]).toContain("did:test:alice");
      expect(result.reactions["👎"]).toContain("did:test:bob");
    });

    it("should throw if message is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(manager.addReaction("nonexistent", "👍")).rejects.toThrow("Message not found");
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.addReaction("message-001", "👍")).rejects.toThrow("User not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // removeReaction()
  // ─────────────────────────────────────────────────────────────────────────
  describe("removeReaction()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should remove the current user DID from the emoji reaction list", async () => {
      const message = makeMessageRow({
        reactions: '{"👍":["did:test:alice","did:test:bob"]}',
      });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      const listener = vi.fn();
      manager.on("channel:reaction-removed", listener);

      const result = await manager.removeReaction("message-001", "👍");
      expect(result.success).toBe(true);
      expect(result.reactions["👍"]).not.toContain("did:test:alice");
      expect(result.reactions["👍"]).toContain("did:test:bob");
      expect(listener).toHaveBeenCalledWith({
        messageId: "message-001",
        emoji: "👍",
        userDid: "did:test:alice",
      });
    });

    it("should delete the emoji key when the last DID is removed", async () => {
      const message = makeMessageRow({ reactions: '{"👍":["did:test:alice"]}' });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      const result = await manager.removeReaction("message-001", "👍");
      expect(result.reactions["👍"]).toBeUndefined();
    });

    it("should handle removing a reaction for an emoji the user did not react to", async () => {
      const message = makeMessageRow({ reactions: '{"👍":["did:test:bob"]}' });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      // Should not throw — alice is simply not in the list
      const result = await manager.removeReaction("message-001", "👍");
      expect(result.success).toBe(true);
      expect(result.reactions["👍"]).toContain("did:test:bob"); // Bob's reaction unchanged
    });

    it("should throw if message is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(manager.removeReaction("nonexistent", "👍")).rejects.toThrow("Message not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deleteMessage()
  // ─────────────────────────────────────────────────────────────────────────
  describe("deleteMessage()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should allow the sender to delete their own message", async () => {
      const message = makeMessageRow({ sender_did: "did:test:alice" });
      mockDatabase.db._prep.get.mockReturnValueOnce(message);

      const listener = vi.fn();
      manager.on("channel:message-deleted", listener);

      const result = await manager.deleteMessage("message-001");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        messageId: "message-001",
        channelId: "channel-001",
      });

      const deleteCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("DELETE FROM channel_messages WHERE id = ?"),
      );
      expect(deleteCall).toBeTruthy();
    });

    it("should allow a moderator to delete another user's message", async () => {
      const message = makeMessageRow({ sender_did: "did:test:bob" }); // not alice
      const channel = makeChannelRow();
      const member = makeMemberRow({ role: "moderator" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(message)
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      const result = await manager.deleteMessage("message-001");
      expect(result).toEqual({ success: true });
    });

    it("should throw if regular member tries to delete another user's message", async () => {
      const message = makeMessageRow({ sender_did: "did:test:bob" }); // not alice
      const channel = makeChannelRow();
      const member = makeMemberRow({ role: "member" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(message)
        .mockReturnValueOnce(channel)
        .mockReturnValueOnce(member);

      await expect(manager.deleteMessage("message-001")).rejects.toThrow(
        "Insufficient permissions to delete this message",
      );
    });

    it("should throw if message is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(manager.deleteMessage("nonexistent")).rejects.toThrow("Message not found");
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(manager.deleteMessage("message-001")).rejects.toThrow("User not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Exported Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("exported constants", () => {
    it("should export ChannelType with expected values", () => {
      expect(ChannelType.ANNOUNCEMENT).toBe("announcement");
      expect(ChannelType.DISCUSSION).toBe("discussion");
      expect(ChannelType.READONLY).toBe("readonly");
      expect(ChannelType.SUBSCRIPTION).toBe("subscription");
    });

    it("should export MessageType with expected values", () => {
      expect(MessageType.TEXT).toBe("text");
      expect(MessageType.IMAGE).toBe("image");
      expect(MessageType.FILE).toBe("file");
      expect(MessageType.SYSTEM).toBe("system");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor / EventEmitter
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should be an EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });

    it("should store injected dependencies", () => {
      expect(manager.database).toBe(mockDatabase);
      expect(manager.didManager).toBe(mockDIDManager);
      expect(manager.p2pManager).toBe(mockP2PManager);
    });

    it("should start with initialized = false", () => {
      const fresh = new ChannelManager(mockDatabase, mockDIDManager);
      expect(fresh.initialized).toBe(false);
    });
  });
});
