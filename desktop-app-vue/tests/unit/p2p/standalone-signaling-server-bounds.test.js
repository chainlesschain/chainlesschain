// @vitest-environment node

import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const SignalingServer = require("../../../../signaling-server/index.js");
const OfflineMessageStore = require("../../../../signaling-server/offline-message-store.js");
const {
  HARD_LIMITS,
  resolveLimits,
} = require("../../../../signaling-server/boundaries.js");

const websocketModule = { OPEN: 1, CLOSING: 2, CLOSED: 3, Server: class {} };

function socket(overrides = {}) {
  const value = new EventEmitter();
  value.readyState = websocketModule.OPEN;
  value.bufferedAmount = 0;
  value.sent = [];
  value.send = vi.fn((payload) => value.sent.push(JSON.parse(payload)));
  value.close = vi.fn();
  value.terminate = vi.fn();
  value.ping = vi.fn();
  return Object.assign(value, overrides);
}

function server(options = {}) {
  return new SignalingServer({ websocketModule, ...options });
}

describe("standalone signaling retained-state boundaries", () => {
  it("rolls back the health listener when WebSocket startup fails", () => {
    const healthServer = {
      on: vi.fn(),
      listen: vi.fn((_port, callback) => callback()),
      close: vi.fn(),
    };
    const FailingServer = class {
      constructor() {
        throw new Error("bind failed");
      }
    };
    const instance = new SignalingServer({
      websocketModule: { ...websocketModule, Server: FailingServer },
      httpModule: { createServer: () => healthServer },
    });

    expect(() => instance.start()).toThrow("bind failed");
    expect(healthServer.close).toHaveBeenCalledOnce();
    expect(instance.healthServer).toBeNull();
    expect(instance.heartbeatTimer).toBeNull();
    expect(instance.cleanupTimer).toBeNull();
  });

  it("rejects unsafe configuration above hard limits", () => {
    expect(() =>
      resolveLimits({ maxConnections: HARD_LIMITS.maxConnections + 1 }),
    ).toThrow(/hard maximum/);
  });

  it("rejects queue admission atomically at peer and message caps", () => {
    const limits = resolveLimits({
      maxQueuePeers: 1,
      maxQueueSize: 2,
      maxTotalMessages: 2,
    });
    const store = new OfflineMessageStore(limits);
    expect(store.enqueue("a", { n: 1 }).success).toBe(true);
    expect(store.enqueue("b", { n: 2 })).toMatchObject({
      success: false,
      code: "OVERLOADED",
      reason: "OFFLINE_PEER_LIMIT",
    });
    expect(store.enqueue("a", { n: 2 }).success).toBe(true);
    expect(store.enqueue("a", { n: 3 })).toMatchObject({
      success: false,
      reason: "PEER_MESSAGE_LIMIT",
    });
    expect(store.getStats()).toMatchObject({
      peerQueues: 1,
      totalMessages: 2,
      totalRejected: 2,
    });
  });

  it("retains an offline message until delivery succeeds", () => {
    const instance = server();
    instance.storeOfflineMessage("target", { type: "offer" });
    const target = socket({ peerId: "target" });
    target.send.mockImplementationOnce(() => {
      throw new Error("backpressure");
    });
    instance.clients.set("target", { ws: target });

    instance.deliverOfflineMessages("target");
    expect(instance.offlineStore.totalMessages).toBe(1);

    instance.deliverOfflineMessages("target");
    expect(instance.offlineStore.totalMessages).toBe(0);
  });

  it("requires registration and forces the registered sender identity", () => {
    const instance = server();
    const sender = socket();
    instance.handleMessage(sender, {
      type: "message",
      to: "target",
      payload: {},
    });
    expect(sender.sent[0]).toMatchObject({ code: "REGISTRATION_REQUIRED" });

    sender.peerId = "registered";
    const target = socket();
    instance.clients.set("target", { ws: target });
    instance.handleSignaling(sender, {
      type: "offer",
      from: "spoofed",
      to: "target",
      sdp: { type: "offer" },
    });
    expect(target.sent[0].from).toBe("registered");
  });

  it("rejects peer identity changes and oversized offline queue keys", () => {
    const instance = server({ maxPeerIdBytes: 8 });
    const client = socket({ peerId: "peer-a" });
    instance.clients.set("peer-a", { ws: client });
    instance.handleRegister(client, { type: "register", peerId: "peer-b" });
    instance.handleMessage(client, {
      type: "message",
      to: "target-too-long",
      payload: {},
    });
    expect(client.sent[0]).toMatchObject({
      code: "INVALID_REGISTRATION",
      error: "A connection cannot change peerId",
    });
    expect(client.sent[1]).toMatchObject({ code: "INVALID_MESSAGE" });
    expect(instance.offlineStore.totalMessages).toBe(0);
  });

  it("keeps the replacement registration when the old socket closes", () => {
    const instance = server();
    const oldSocket = socket({ peerId: "p1" });
    const newSocket = socket({ peerId: "p1" });
    instance.connections.add(oldSocket);
    instance.connections.add(newSocket);
    instance.clients.set("p1", { ws: newSocket });
    instance.handleDisconnection(oldSocket);
    expect(instance.clients.get("p1").ws).toBe(newSocket);
    expect(instance.connections.has(newSocket)).toBe(true);
  });

  it("bounds connection admission and peer discovery pages", () => {
    const instance = server({ maxConnections: 1, peerListPageSize: 1 });
    instance.connections.add(socket());
    const rejected = socket();
    instance.handleConnection(rejected, {
      socket: { remoteAddress: "test" },
    });
    expect(rejected.sent[0]).toMatchObject({
      code: "OVERLOADED",
      reason: "CONNECTION_LIMIT",
    });
    expect(rejected.close).toHaveBeenCalledWith(1013, "Server at capacity");

    const requester = socket({ peerId: "self" });
    instance.clients.set("self", { ws: requester });
    instance.clients.set("a", {
      ws: socket(),
      deviceType: "desktop",
      deviceInfo: {},
      connectedAt: 1,
    });
    instance.clients.set("b", {
      ws: socket(),
      deviceType: "mobile",
      deviceInfo: {},
      connectedAt: 2,
    });
    instance.handleGetPeers(requester, { limit: 1 });
    expect(requester.sent[0]).toMatchObject({
      count: 1,
      total: 2,
      nextCursor: 1,
    });
  });
});
