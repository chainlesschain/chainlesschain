/**
 * community-ipc dual-track (Phase A gossip + Phase B MTC) integration test
 *
 * Verifies that registerCommunityIPC, when both gossipProtocol and
 * mtcFederationManager are present, dispatches community/channel operations
 * to BOTH transports. Failure on one transport must not block the other.
 *
 * Captures handler functions via the shared electron mock's ipcMain.handle
 * spy, then invokes them directly with synthesized payloads.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import EventEmitter from "events";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// community-ipc.js now accepts ipcMain as a DI dep — pass our own mock and
// skip electron's alias gymnastics.
const ipcMainMock = {
  handle: vi.fn(),
  removeHandler: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
};
const { registerCommunityIPC } = require("../community-ipc.js");

function createGossipMock() {
  const ee = new EventEmitter();
  ee.subscribe = vi.fn();
  ee.unsubscribe = vi.fn();
  ee.broadcast = vi.fn(async () => ({ success: true, peersReached: 1 }));
  return ee;
}

function createMtcFedMock(opts = {}) {
  return {
    isInitialized: vi.fn(() => opts.initialized !== false),
    subscribeCommunity: vi.fn(async () => undefined),
    unsubscribeCommunity: vi.fn(),
    publishCommunityEvent: vi.fn(async () => ({ recipients: 1 })),
  };
}

function createChannelManagerMock() {
  return {
    sendMessage: vi.fn(async (opts) => ({
      id: "msg-" + Math.random().toString(36).slice(2),
      channel_id: opts.channelId,
      sender_did: "did:test:alice",
      content: opts.content || "hello",
      message_type: "text",
      created_at: Date.now(),
    })),
    handleMessageReceived: vi.fn(async () => undefined),
    database: {
      db: {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ community_id: "comm-X" }),
        }),
      },
    },
  };
}

function createCommunityManagerMock() {
  return {
    joinCommunity: vi.fn(async (id) => ({ joined: true, communityId: id })),
    leaveCommunity: vi.fn(async (id) => ({ left: true, communityId: id })),
  };
}

function captureHandlers() {
  const handlers = new Map();
  ipcMainMock.handle.mockImplementation((channel, fn) => {
    handlers.set(channel, fn);
  });
  return handlers;
}

describe("community-ipc dual-track (Phase A gossip + Phase B MTC)", () => {
  let handlers;
  let gossip;
  let mtcFed;
  let channelManager;
  let communityManager;

  beforeEach(() => {
    ipcMainMock.handle.mockReset();
    handlers = captureHandlers();
    gossip = createGossipMock();
    mtcFed = createMtcFedMock();
    channelManager = createChannelManagerMock();
    communityManager = createCommunityManagerMock();

    registerCommunityIPC({
      communityManager,
      channelManager,
      governanceEngine: null,
      gossipProtocol: gossip,
      contentModerator: null,
      mtcFederationManager: mtcFed,
      ipcMain: ipcMainMock,
    });
  });

  describe("community:join", () => {
    it("subscribes BOTH gossip and MTC", async () => {
      const join = handlers.get("community:join");
      const result = await join({}, "comm-1");
      expect(result).toEqual({ joined: true, communityId: "comm-1" });
      expect(gossip.subscribe).toHaveBeenCalledWith("comm-1");
      expect(mtcFed.subscribeCommunity).toHaveBeenCalledWith(
        "comm-1",
        expect.any(Function),
      );
    });

    it("MTC subscribe failure does NOT prevent join (gossip path still active)", async () => {
      mtcFed.subscribeCommunity.mockRejectedValueOnce(new Error("MTC down"));
      const join = handlers.get("community:join");
      const result = await join({}, "comm-2");
      expect(result).toEqual({ joined: true, communityId: "comm-2" });
      expect(gossip.subscribe).toHaveBeenCalledWith("comm-2");
    });

    it("MTC manager not initialized → only gossip subscribes", async () => {
      mtcFed.isInitialized.mockReturnValue(false);
      const join = handlers.get("community:join");
      await join({}, "comm-3");
      expect(gossip.subscribe).toHaveBeenCalledOnce();
      expect(mtcFed.subscribeCommunity).not.toHaveBeenCalled();
    });

    it("MTC subscribe handler routes channel_message → channelManager.handleMessageReceived", async () => {
      const join = handlers.get("community:join");
      await join({}, "comm-4");
      const [, mtcHandler] = mtcFed.subscribeCommunity.mock.calls[0];

      mtcHandler({
        type: "channel_message",
        channelId: "ch-X",
        message: {
          id: "remote-msg-mtc-1",
          sender_did: "did:test:alice",
          content: "via MTC",
          message_type: "text",
          created_at: Date.now(),
        },
      });

      // handler is sync but calls async handleMessageReceived
      await new Promise((r) => setImmediate(r));

      expect(channelManager.handleMessageReceived).toHaveBeenCalledWith(
        "ch-X",
        expect.objectContaining({ id: "remote-msg-mtc-1" }),
      );
    });

    it("MTC handler ignores non-channel_message payloads", async () => {
      const join = handlers.get("community:join");
      await join({}, "comm-5");
      const [, mtcHandler] = mtcFed.subscribeCommunity.mock.calls[0];

      mtcHandler({ type: "presence_announce", sender: "did:test:alice" });
      await new Promise((r) => setImmediate(r));

      expect(channelManager.handleMessageReceived).not.toHaveBeenCalled();
    });
  });

  describe("community:leave", () => {
    it("unsubscribes BOTH transports", async () => {
      const leave = handlers.get("community:leave");
      await leave({}, "comm-1");
      expect(gossip.unsubscribe).toHaveBeenCalledWith("comm-1");
      expect(mtcFed.unsubscribeCommunity).toHaveBeenCalledWith("comm-1");
    });

    it("MTC unsubscribe error swallowed — leave still succeeds", async () => {
      mtcFed.unsubscribeCommunity.mockImplementationOnce(() => {
        throw new Error("oops");
      });
      const leave = handlers.get("community:leave");
      const result = await leave({}, "comm-1");
      expect(result).toEqual({ left: true, communityId: "comm-1" });
    });
  });

  describe("channel:send-message", () => {
    it("publishes on BOTH gossip.broadcast and mtcFed.publishCommunityEvent", async () => {
      const send = handlers.get("channel:send-message");
      const message = await send({}, { channelId: "ch-1", content: "hello" });

      expect(message.id).toBeDefined();
      expect(gossip.broadcast).toHaveBeenCalledWith(
        "comm-X",
        expect.objectContaining({
          type: "channel_message",
          channelId: "ch-1",
          message: expect.objectContaining({ id: message.id }),
        }),
      );
      expect(mtcFed.publishCommunityEvent).toHaveBeenCalledWith(
        "comm-X",
        expect.objectContaining({
          type: "channel_message",
          channelId: "ch-1",
          message: expect.objectContaining({ id: message.id }),
        }),
      );
    });

    it("gossip failure does NOT block MTC publish", async () => {
      gossip.broadcast.mockRejectedValueOnce(new Error("no peers"));
      const send = handlers.get("channel:send-message");
      const message = await send({}, { channelId: "ch-1", content: "x" });
      expect(message.id).toBeDefined();
      expect(mtcFed.publishCommunityEvent).toHaveBeenCalledOnce();
    });

    it("MTC failure does NOT block gossip", async () => {
      mtcFed.publishCommunityEvent.mockRejectedValueOnce(
        new Error("topic err"),
      );
      const send = handlers.get("channel:send-message");
      const message = await send({}, { channelId: "ch-1", content: "x" });
      expect(message.id).toBeDefined();
      expect(gossip.broadcast).toHaveBeenCalledOnce();
    });

    it("only Phase A path runs when MTC manager is null", async () => {
      ipcMainMock.handle.mockReset();
      handlers = captureHandlers();
      registerCommunityIPC({
        communityManager,
        channelManager,
        governanceEngine: null,
        gossipProtocol: gossip,
        contentModerator: null,
        mtcFederationManager: null,
        ipcMain: ipcMainMock,
      });
      const send = handlers.get("channel:send-message");
      await send({}, { channelId: "ch-1", content: "x" });
      expect(gossip.broadcast).toHaveBeenCalledOnce();
    });

    it("only Phase B path runs when gossip is null", async () => {
      ipcMainMock.handle.mockReset();
      handlers = captureHandlers();
      registerCommunityIPC({
        communityManager,
        channelManager,
        governanceEngine: null,
        gossipProtocol: null,
        contentModerator: null,
        mtcFederationManager: mtcFed,
        ipcMain: ipcMainMock,
      });
      const send = handlers.get("channel:send-message");
      await send({}, { channelId: "ch-1", content: "x" });
      expect(mtcFed.publishCommunityEvent).toHaveBeenCalledOnce();
    });
  });
});
