/**
 * community-ipc B4-merkle integration test — verifies channel:send-message
 * enqueues the signed message into ChannelEventBatcher in addition to
 * the Phase A gossip / Phase B MTC dual-publish.
 *
 * Mocks the batcher to assert enqueueEvent contract:
 *   - called with (community_id, message)
 *   - message has sender_pubkey + signature populated
 *   - skipped when message is unsigned
 *   - failure swallowed (does not block IPC return)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import EventEmitter from "events";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

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

function createBatcherMock(opts = {}) {
  return {
    enqueueEvent: opts.throwOnEnqueue
      ? vi.fn(() => {
          throw new Error("disk full");
        })
      : vi.fn(() => ({ queued: true, stagedCount: 1 })),
  };
}

function createSignedChannelManagerMock() {
  return {
    sendMessage: vi.fn(async (opts) => ({
      id: "msg-" + Math.random().toString(36).slice(2),
      channel_id: opts.channelId,
      sender_did: "did:test:alice",
      content: opts.content || "hello",
      message_type: "text",
      created_at: Date.now(),
      sender_pubkey: "BASE64_PUBKEY_44CHARSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX==",
      signature:
        "BASE64_SIG_88CHARSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX==",
    })),
    handleMessageReceived: vi.fn(async () => undefined),
    database: {
      db: {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ community_id: "comm-batcher-1" }),
        }),
      },
    },
  };
}

function createUnsignedChannelManagerMock() {
  const m = createSignedChannelManagerMock();
  m.sendMessage = vi.fn(async (opts) => ({
    id: "msg-unsigned-" + Math.random().toString(36).slice(2),
    channel_id: opts.channelId,
    sender_did: "did:test:nokeys",
    content: opts.content || "no sig",
    created_at: Date.now(),
    sender_pubkey: null,
    signature: null,
  }));
  return m;
}

function captureHandlers() {
  const handlers = new Map();
  ipcMainMock.handle.mockImplementation((channel, fn) => {
    handlers.set(channel, fn);
  });
  return handlers;
}

describe("community-ipc B4-merkle enqueue (channel:send-message)", () => {
  let handlers;
  let gossip;
  let batcher;
  let channelManager;

  beforeEach(() => {
    ipcMainMock.handle.mockReset();
    handlers = captureHandlers();
    gossip = createGossipMock();
    batcher = createBatcherMock();
    channelManager = createSignedChannelManagerMock();
    registerCommunityIPC({
      communityManager: { joinCommunity: vi.fn(), leaveCommunity: vi.fn() },
      channelManager,
      governanceEngine: null,
      gossipProtocol: gossip,
      contentModerator: null,
      mtcFederationManager: null,
      channelEventBatcher: batcher,
      ipcMain: ipcMainMock,
    });
  });

  it("enqueues the signed message into batcher with (community_id, message)", async () => {
    const send = handlers.get("channel:send-message");
    const message = await send({}, { channelId: "ch-1", content: "hello" });

    expect(batcher.enqueueEvent).toHaveBeenCalledOnce();
    const [communityId, enqueuedMsg] = batcher.enqueueEvent.mock.calls[0];
    expect(communityId).toBe("comm-batcher-1");
    expect(enqueuedMsg.id).toBe(message.id);
    expect(enqueuedMsg.sender_pubkey).toBeTruthy();
    expect(enqueuedMsg.signature).toBeTruthy();
  });

  it("skips enqueue when sendMessage produces an unsigned message", async () => {
    ipcMainMock.handle.mockReset();
    handlers = captureHandlers();
    registerCommunityIPC({
      communityManager: { joinCommunity: vi.fn(), leaveCommunity: vi.fn() },
      channelManager: createUnsignedChannelManagerMock(),
      governanceEngine: null,
      gossipProtocol: gossip,
      contentModerator: null,
      mtcFederationManager: null,
      channelEventBatcher: batcher,
      ipcMain: ipcMainMock,
    });
    const send = handlers.get("channel:send-message");
    await send({}, { channelId: "ch-1", content: "no sig" });
    expect(batcher.enqueueEvent).not.toHaveBeenCalled();
  });

  it("batcher.enqueueEvent throwing does NOT propagate (IPC still returns)", async () => {
    ipcMainMock.handle.mockReset();
    handlers = captureHandlers();
    const breakingBatcher = createBatcherMock({ throwOnEnqueue: true });
    registerCommunityIPC({
      communityManager: { joinCommunity: vi.fn(), leaveCommunity: vi.fn() },
      channelManager,
      governanceEngine: null,
      gossipProtocol: gossip,
      contentModerator: null,
      mtcFederationManager: null,
      channelEventBatcher: breakingBatcher,
      ipcMain: ipcMainMock,
    });
    const send = handlers.get("channel:send-message");
    const result = await send({}, { channelId: "ch-1", content: "boom" });
    expect(result.id).toBeTruthy(); // IPC still returns the message
    expect(breakingBatcher.enqueueEvent).toHaveBeenCalledOnce();
  });

  it("no batcher (null DI) → channel:send-message still works without enqueue", async () => {
    ipcMainMock.handle.mockReset();
    handlers = captureHandlers();
    registerCommunityIPC({
      communityManager: { joinCommunity: vi.fn(), leaveCommunity: vi.fn() },
      channelManager,
      governanceEngine: null,
      gossipProtocol: gossip,
      contentModerator: null,
      mtcFederationManager: null,
      channelEventBatcher: null,
      ipcMain: ipcMainMock,
    });
    const send = handlers.get("channel:send-message");
    const result = await send({}, { channelId: "ch-1", content: "no batcher" });
    expect(result.id).toBeTruthy();
  });

  describe("channel:get-message-envelope IPC", () => {
    it("delegates to batcher.loadEnvelopeAndLandmark", async () => {
      const fakeEnvelope = {
        envelope: { tree_head_id: "thid", inclusion_proof: { leaf_index: 0 } },
        landmark: { snapshots: [{ tree_head_id: "thid" }] },
        treeHeadId: "thid",
        batchId: "000001",
        leafIndex: 0,
        found: true,
      };
      batcher.loadEnvelopeAndLandmark = vi.fn().mockReturnValue(fakeEnvelope);
      const get = handlers.get("channel:get-message-envelope");
      const result = await get({}, "comm-X", "msg-X");
      expect(batcher.loadEnvelopeAndLandmark).toHaveBeenCalledWith(
        "comm-X",
        "msg-X",
      );
      expect(result).toEqual(fakeEnvelope);
    });

    it("returns {found:false, reason} when batcher missing", async () => {
      ipcMainMock.handle.mockReset();
      handlers = captureHandlers();
      registerCommunityIPC({
        communityManager: { joinCommunity: vi.fn(), leaveCommunity: vi.fn() },
        channelManager,
        governanceEngine: null,
        gossipProtocol: gossip,
        contentModerator: null,
        mtcFederationManager: null,
        channelEventBatcher: null,
        ipcMain: ipcMainMock,
      });
      const get = handlers.get("channel:get-message-envelope");
      const result = await get({}, "comm-X", "msg-X");
      expect(result.found).toBe(false);
      expect(result.reason).toMatch(/not initialized/);
    });

    it("returns {found:false, reason} on missing args", async () => {
      const get = handlers.get("channel:get-message-envelope");
      const result1 = await get({}, "", "msg-X");
      expect(result1.found).toBe(false);
      const result2 = await get({}, "comm-X", "");
      expect(result2.found).toBe(false);
    });

    it("returns {found:false, reason} when batcher throws", async () => {
      batcher.loadEnvelopeAndLandmark = vi.fn(() => {
        throw new Error("disk corrupt");
      });
      const get = handlers.get("channel:get-message-envelope");
      const result = await get({}, "comm-X", "msg-X");
      expect(result.found).toBe(false);
      expect(result.reason).toMatch(/disk corrupt/);
    });
  });
});
