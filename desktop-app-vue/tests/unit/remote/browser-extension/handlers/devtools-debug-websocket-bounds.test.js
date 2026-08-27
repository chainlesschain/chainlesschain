import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disableWebSocketDebugging,
  enableWebSocketDebugging,
  getWebSocketConnections,
  getWebSocketMessages,
  sendWebSocketMessage,
} from "../../../../../src/main/remote/browser-extension/handlers/devtools-debug.js";
import { WEBSOCKET_SANITIZATION_LIMITS } from "../../../../../src/main/remote/browser-extension/handlers/websocket-debug-registry.js";

function createChromeMock({
  failNetworkEnable = false,
  alreadyAttached = false,
} = {}) {
  const eventListeners = new Set();
  const detachListeners = new Set();
  const onEvent = {
    addListener: vi.fn((listener) => eventListeners.add(listener)),
    removeListener: vi.fn((listener) => eventListeners.delete(listener)),
  };
  const onDetach = {
    addListener: vi.fn((listener) => detachListeners.add(listener)),
    removeListener: vi.fn((listener) => detachListeners.delete(listener)),
  };
  const emitDetach = (tabId) => {
    for (const listener of [...detachListeners]) {
      listener({ tabId }, "target_closed");
    }
  };
  const debuggerApi = {
    attach: alreadyAttached
      ? vi
          .fn()
          .mockRejectedValue(new Error("Another debugger is already attached"))
      : vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(async ({ tabId }) => emitDetach(tabId)),
    sendCommand: vi.fn(async (_source, method) => {
      if (method === "Network.enable" && failNetworkEnable) {
        throw new Error("network enable failed");
      }
    }),
    onEvent,
    onDetach,
  };
  const executeScript = vi.fn(async ({ args }) => [
    { result: { success: true, payload: args?.[1] } },
  ]);
  vi.stubGlobal("chrome", {
    debugger: debuggerApi,
    scripting: { executeScript },
  });
  return {
    debuggerApi,
    executeScript,
    eventListeners,
    detachListeners,
    emitEvent(tabId, method, params) {
      for (const listener of [...eventListeners]) {
        listener({ tabId }, method, params);
      }
    },
    emitDetach,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded WebSocket debugging", () => {
  it("captures bounded connections and frames with removable listeners", async () => {
    const mock = createChromeMock();
    await expect(enableWebSocketDebugging(601)).resolves.toMatchObject({
      success: true,
      limits: { maxActiveTabs: 8, maxMessagesPerConnection: 500 },
    });
    await expect(enableWebSocketDebugging(601)).resolves.toEqual({
      success: true,
      message: "Already enabled",
    });
    expect(mock.eventListeners.size).toBe(1);
    expect(mock.detachListeners.size).toBe(1);

    mock.emitEvent(601, "Network.webSocketCreated", {
      requestId: "socket-1",
      url: "wss://example.test/socket",
      initiator: {
        type: "script",
        stack: { callFrames: [{ url: "must-not-be-retained" }] },
      },
    });
    mock.emitEvent(601, "Network.webSocketFrameReceived", {
      requestId: "socket-1",
      response: {
        payloadData: "x".repeat(
          WEBSOCKET_SANITIZATION_LIMITS.maxPayloadChars + 1,
        ),
        opcode: 1,
      },
      timestamp: 2,
    });

    expect(getWebSocketConnections(601)).toMatchObject({
      status: "active",
      connections: [
        {
          id: "socket-1",
          initiator: { type: "script" },
          messageCount: 1,
        },
      ],
    });
    expect(
      getWebSocketConnections(601).connections[0].initiator,
    ).not.toHaveProperty("stack");
    expect(getWebSocketMessages(601, "socket-1")).toMatchObject({
      messages: [{ type: "received", truncated: true }],
    });
    expect(getWebSocketMessages(601, "socket-1").messages[0].data).toHaveLength(
      WEBSOCKET_SANITIZATION_LIMITS.maxPayloadChars,
    );

    await expect(disableWebSocketDebugging(601)).resolves.toEqual({
      success: true,
    });
    expect(mock.eventListeners.size).toBe(0);
    expect(mock.detachListeners.size).toBe(0);
    expect(getWebSocketConnections(601).connections).toEqual([]);
  });

  it("cleans a failed start and releases admission on external detach", async () => {
    const failed = createChromeMock({ failNetworkEnable: true });
    await expect(enableWebSocketDebugging(602)).resolves.toEqual({
      error: "network enable failed",
    });
    expect(failed.eventListeners.size).toBe(0);
    expect(failed.detachListeners.size).toBe(0);

    const recovered = createChromeMock();
    await enableWebSocketDebugging(602);
    recovered.emitDetach(602);
    expect(recovered.eventListeners.size).toBe(0);
    expect(recovered.detachListeners.size).toBe(0);
    expect(getWebSocketConnections(602).status).toBe("inactive");
    await expect(enableWebSocketDebugging(602)).resolves.toMatchObject({
      success: true,
    });
    await disableWebSocketDebugging(602);
  });

  it("does not detach a debugger session it did not attach", async () => {
    const mock = createChromeMock({ alreadyAttached: true });
    await expect(enableWebSocketDebugging(603)).resolves.toMatchObject({
      success: true,
    });
    await expect(disableWebSocketDebugging(603)).resolves.toEqual({
      success: true,
    });
    expect(mock.debuggerApi.detach).not.toHaveBeenCalled();
    expect(mock.eventListeners.size).toBe(0);
  });

  it("rejects oversized outbound payloads before page execution", async () => {
    const mock = createChromeMock();
    await expect(sendWebSocketMessage(604, "", "hello")).resolves.toMatchObject(
      {
        code: "INVALID_ARGUMENT",
      },
    );
    await expect(
      sendWebSocketMessage(
        604,
        "socket",
        "x".repeat(WEBSOCKET_SANITIZATION_LIMITS.maxOutboundBytes + 1),
      ),
    ).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "websocket_payload",
    });
    expect(mock.executeScript).not.toHaveBeenCalled();

    await expect(
      sendWebSocketMessage(604, "socket", "hello"),
    ).resolves.toMatchObject({ success: true, payload: "hello" });
    expect(mock.executeScript).toHaveBeenCalledTimes(1);
  });
});
