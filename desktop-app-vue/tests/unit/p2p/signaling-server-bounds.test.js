// @vitest-environment node

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const WebSocket = require("ws");
const SignalingServer = require("../../../src/main/p2p/signaling-server");

const servers = [];

function createServer(options = {}) {
  const server = new SignalingServer(options);
  servers.push(server);
  return server;
}

function socket(overrides = {}) {
  const value = new EventEmitter();
  value.readyState = WebSocket.OPEN;
  value.bufferedAmount = 0;
  value.sent = [];
  value.send = vi.fn((payload) => value.sent.push(JSON.parse(payload)));
  value.close = vi.fn();
  value.terminate = vi.fn();
  value.ping = vi.fn();
  return Object.assign(value, overrides);
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.registry.stop();
    server.messageQueue.stop();
  }
});

describe("embedded signaling server boundaries", () => {
  it("requires registration before transport messages", () => {
    const server = createServer();
    const client = socket();
    server.handleMessage(client, {
      type: "message",
      from: "spoofed",
      to: "target",
      payload: { text: "hello" },
    });
    expect(client.sent[0]).toMatchObject({
      type: "error",
      code: "REGISTRATION_REQUIRED",
    });
    expect(server.messageQueue.getTotalMessageCount()).toBe(0);
  });

  it("keeps a socket identity immutable and rejects oversized target keys", () => {
    const server = createServer({ maxPeerIdBytes: 8 });
    const client = socket({ peerId: "peer-a" });
    server.handleMessage(client, { type: "register", peerId: "peer-b" });
    server.handleMessage(client, {
      type: "message",
      to: "target-too-long",
      payload: {},
    });
    expect(client.sent[0]).toMatchObject({
      code: "INVALID_REGISTRATION",
      error: "A connection cannot change peerId",
    });
    expect(client.sent[1]).toMatchObject({
      code: "INVALID_MESSAGE",
      error: "Target peerId is invalid or exceeds the byte limit",
    });
    expect(server.messageQueue.getTotalMessageCount()).toBe(0);
  });

  it("rejects connections at the admission cap with retryable overload", () => {
    const server = createServer({ maxConnections: 1 });
    server.activeSockets.add(socket());
    const rejected = socket();
    server.handleConnection(rejected, { socket: { remoteAddress: "test" } });
    expect(rejected.sent[0]).toMatchObject({
      code: "OVERLOADED",
      reason: "CONNECTION_LIMIT",
    });
    expect(rejected.close).toHaveBeenCalledWith(1013, "Server at capacity");
    expect(server.activeSockets.size).toBe(1);
  });

  it("closes a slow consumer without growing its buffered output", () => {
    const server = createServer({ maxBufferedAmount: 10 });
    const client = socket({ bufferedAmount: 11 });
    expect(server.sendMessage(client, { type: "test" })).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(1013, "Slow consumer");
  });

  it("rate-limits by message count with an explicit retry hint", () => {
    const server = createServer({ maxMessagesPerWindow: 1 });
    const client = socket({
      signalingRate: { windowStartedAt: Date.now(), messages: 0, bytes: 0 },
    });
    expect(server.recordInbound(client, 5)).toBe(true);
    expect(server.recordInbound(client, 5)).toBe(false);
    expect(client.sent[0]).toMatchObject({
      code: "OVERLOADED",
      reason: "RATE_LIMIT",
    });
    expect(client.close).toHaveBeenCalledWith(1013, "Rate limit exceeded");
  });

  it("does not let a replaced socket unregister the current peer", () => {
    const server = createServer();
    const oldSocket = socket({ connectionId: "old", peerId: "p1" });
    const newSocket = socket({ connectionId: "new", peerId: "p1" });
    server.activeSockets.add(oldSocket);
    server.registry.register("p1", oldSocket);
    server.registry.register("p1", newSocket);
    server.broadcastPeerStatus = vi.fn();

    server.handleDisconnection(oldSocket, 1000, "replaced");

    expect(server.registry.getPeer("p1").socket).toBe(newSocket);
    expect(server.broadcastPeerStatus).not.toHaveBeenCalled();
  });
});
