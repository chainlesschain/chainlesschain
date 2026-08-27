import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEBSOCKET_DEBUG_LIMITS,
  HARD_WEBSOCKET_DEBUG_LIMITS,
  WEBSOCKET_SANITIZATION_LIMITS,
  WebSocketDebugRegistry,
  sanitizeWebSocketConnection,
  sanitizeWebSocketFrame,
  validateWebSocketConnectionId,
  validateWebSocketOutboundData,
} from "../../../../../src/main/remote/browser-extension/handlers/websocket-debug-registry.js";

describe("WebSocketDebugRegistry", () => {
  it("uses finite defaults and clamps all configurable limits", () => {
    expect(new WebSocketDebugRegistry().getStats().limits).toEqual(
      DEFAULT_WEBSOCKET_DEBUG_LIMITS,
    );
    const hard = new WebSocketDebugRegistry(
      Object.fromEntries(
        Object.keys(HARD_WEBSOCKET_DEBUG_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );
    expect(hard.getStats().limits).toEqual(HARD_WEBSOCKET_DEBUG_LIMITS);
  });

  it("holds per-tab and global admission through start and stop", () => {
    const registry = new WebSocketDebugRegistry({ maxActiveTabs: 1 });
    const first = registry.admit(1);
    expect(first.accepted).toBe(true);
    expect(registry.admit(1)).toMatchObject({
      code: "OVERLOADED",
      scope: "websocket_debug_tab",
    });
    expect(registry.admit(2)).toMatchObject({
      code: "OVERLOADED",
      scope: "websocket_debug_tabs",
    });
    expect(registry.beginStop(1)).toMatchObject({
      code: "WEBSOCKET_DEBUG_BUSY",
    });
    registry.markActive(first.lease);
    expect(registry.beginStop(1)).toMatchObject({
      accepted: true,
      capture: { status: "stopping" },
    });
    registry.complete(first.lease);
    expect(registry.getStats()).toMatchObject({ activeTabs: 0, totalBytes: 0 });
  });

  it("retains bounded newest frame rings per connection and tab", () => {
    const registry = new WebSocketDebugRegistry({
      maxMessagesPerConnection: 2,
      maxMessagesPerTab: 3,
      maxBytesPerConnection: 1000,
      maxBytesPerTab: 2000,
      maxTotalBytes: 2000,
      maxEntryBytes: 1000,
    });
    const admission = registry.admit(3);
    registry.markActive(admission.lease);
    registry.recordConnection(admission.lease, {
      id: "socket-1",
      url: "wss://example.test/one",
    });
    registry.recordConnection(admission.lease, {
      id: "socket-2",
      url: "wss://example.test/two",
    });

    for (const [connectionId, data] of [
      ["socket-1", "one"],
      ["socket-2", "two"],
      ["socket-1", "three"],
      ["socket-1", "four"],
    ]) {
      registry.recordFrame(admission.lease, {
        connectionId,
        type: "received",
        data,
      });
    }

    expect(registry.getMessages(3, "socket-1")).toMatchObject({
      messages: [{ data: "three" }, { data: "four" }],
      droppedMessages: 1,
    });
    expect(registry.getConnections(3)).toMatchObject({
      droppedMessages: 1,
      status: "active",
    });
    expect(registry.getConnections(3).connections).toHaveLength(2);
  });

  it("evicts closed connections before accepting new connection metadata", () => {
    let now = 10;
    const registry = new WebSocketDebugRegistry({
      maxConnectionsPerTab: 2,
      now: () => ++now,
    });
    const admission = registry.admit(4);
    registry.markActive(admission.lease);
    registry.recordConnection(admission.lease, { id: "one", url: "one" });
    registry.recordConnection(admission.lease, { id: "two", url: "two" });
    registry.closeConnection(admission.lease, "one");
    expect(
      registry.recordConnection(admission.lease, { id: "three", url: "three" }),
    ).toBe(true);

    expect(registry.getConnections(4).connections.map(({ id }) => id)).toEqual([
      "two",
      "three",
    ]);
    expect(registry.getConnections(4).droppedConnections).toBe(1);
  });

  it("drops untracked and oversized frames without retaining payloads", () => {
    const registry = new WebSocketDebugRegistry({
      maxBytesPerConnection: 40,
      maxBytesPerTab: 100,
      maxTotalBytes: 100,
      maxEntryBytes: 40,
    });
    const admission = registry.admit(5);
    registry.markActive(admission.lease);
    expect(
      registry.recordFrame(admission.lease, {
        connectionId: "missing",
        data: "ignored",
      }),
    ).toBe(false);
    registry.recordConnection(admission.lease, { id: "tracked", url: "" });
    expect(
      registry.recordFrame(admission.lease, {
        connectionId: "tracked",
        data: "x".repeat(100),
      }),
    ).toBe(false);
    expect(registry.getMessages(5, "tracked").messages).toEqual([]);
    expect(registry.getConnections(5).droppedMessages).toBe(2);
  });
});

describe("WebSocket debugging input boundaries", () => {
  it("sanitizes initiator metadata and truncates retained frame payloads", () => {
    const long = "x".repeat(WEBSOCKET_SANITIZATION_LIMITS.maxUrlChars + 10);
    const connection = sanitizeWebSocketConnection(
      {
        requestId: long,
        url: long,
        initiator: {
          type: long,
          url: long,
          stack: { callFrames: [{ url: long }] },
        },
      },
      () => 1,
    );
    expect(connection.id).toHaveLength(
      WEBSOCKET_SANITIZATION_LIMITS.maxIdChars,
    );
    expect(connection.url).toHaveLength(
      WEBSOCKET_SANITIZATION_LIMITS.maxUrlChars,
    );
    expect(connection.initiator).not.toHaveProperty("stack");

    const frame = sanitizeWebSocketFrame("Network.webSocketFrameReceived", {
      requestId: "socket",
      response: {
        payloadData: "p".repeat(
          WEBSOCKET_SANITIZATION_LIMITS.maxPayloadChars + 1,
        ),
        opcode: 1,
      },
      timestamp: 2,
    });
    expect(frame.data).toHaveLength(
      WEBSOCKET_SANITIZATION_LIMITS.maxPayloadChars,
    );
    expect(frame.truncated).toBe(true);
  });

  it("rejects oversized and non-primitive outbound payloads", () => {
    expect(validateWebSocketConnectionId(123)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      validateWebSocketConnectionId(
        "x".repeat(WEBSOCKET_SANITIZATION_LIMITS.maxIdChars + 1),
      ),
    ).toMatchObject({
      code: "OVERLOADED",
      scope: "websocket_connection_id",
    });
    expect(
      validateWebSocketOutboundData({ value: "not-a-string" }),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(
      validateWebSocketOutboundData(
        "你".repeat(WEBSOCKET_SANITIZATION_LIMITS.maxOutboundBytes / 2),
      ),
    ).toMatchObject({ code: "OVERLOADED", scope: "websocket_payload" });
    expect(validateWebSocketOutboundData("hello")).toEqual({
      accepted: true,
      data: "hello",
      bytes: 5,
    });
  });
});
