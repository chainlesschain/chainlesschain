import { describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  ServerState,
  isLikelyConnectionError,
  isTransientMcpError,
} from "../../src/harness/mcp-client.js";

const SERVER_NAME = "remote";
const CALLER_CANARY = "CALLER_SECRET_CANARY";

function addTransportEntry(client, transport) {
  const messages = [];
  const entry = {
    config: {
      longRunning: true,
      requestTimeoutMs: 0,
      ...(transport === "ws"
        ? { url: "ws://mcp.example.test/rpc?token=secret" }
        : { command: "fake-mcp" }),
    },
    state: ServerState.CONNECTED,
    transportKind: transport,
    tools: [],
    resources: [],
    _pending: new Map(),
    _httpDiscardStopping: false,
  };

  if (transport === "ws") {
    entry.socket = {
      readyState: 1,
      send: vi.fn((wire, callback) => {
        messages.push(JSON.parse(wire));
        callback?.();
      }),
    };
    entry.process = null;
  } else {
    entry.socket = null;
    entry.process = {
      stdin: {
        write: vi.fn((wire) => {
          messages.push(JSON.parse(String(wire).trim()));
          return true;
        }),
      },
    };
  }

  client.servers.set(SERVER_NAME, entry);
  return { entry, messages };
}

function messagesFor(messages, method) {
  return messages.filter((message) => message.method === method);
}

describe.each(["ws", "stdio"])(
  "MCPClient %s caller cancellation",
  (transport) => {
    it("rejects an already-aborted tool call before dispatch", async () => {
      const client = new MCPClient();
      const { entry, messages } = addTransportEntry(client, transport);
      const reconnector = vi.fn();
      client.setReconnector(SERVER_NAME, reconnector);
      const controller = new AbortController();
      controller.abort(CALLER_CANARY);

      let error;
      try {
        await client.callTool(
          SERVER_NAME,
          "mutate",
          {},
          {
            signal: controller.signal,
          },
        );
      } catch (cause) {
        error = cause;
      }

      expect(error).toMatchObject({
        code: "CC_MCP_REQUEST_ABORTED",
        dispatched: false,
        outcomeUnknown: false,
      });
      expect(error.message).toBe(
        `MCP request for server "${SERVER_NAME}" was cancelled by its caller`,
      );
      expect(error.message).not.toContain(CALLER_CANARY);
      expect(isLikelyConnectionError(error)).toBe(false);
      expect(isTransientMcpError(error)).toBe(false);
      expect(messages).toEqual([]);
      expect(entry._pending.size).toBe(0);
      expect(reconnector).not.toHaveBeenCalled();
    });

    it("cancels one dispatched tool call without replaying it", async () => {
      const client = new MCPClient();
      const { entry, messages } = addTransportEntry(client, transport);
      const reconnector = vi.fn();
      client.setReconnector(SERVER_NAME, reconnector);
      const controller = new AbortController();
      const removeEventListener = vi.spyOn(
        controller.signal,
        "removeEventListener",
      );

      const pending = client.callTool(
        SERVER_NAME,
        "mutate",
        {},
        {
          signal: controller.signal,
        },
      );
      const request = messagesFor(messages, "tools/call")[0];
      expect(request).toBeDefined();
      expect(entry._pending.size).toBe(1);

      controller.abort(CALLER_CANARY);

      let error;
      try {
        await pending;
      } catch (cause) {
        error = cause;
      }
      expect(error).toMatchObject({
        code: "CC_MCP_REQUEST_ABORTED",
        dispatched: true,
        outcomeUnknown: true,
      });
      expect(error.message).not.toContain(CALLER_CANARY);
      expect(messagesFor(messages, "tools/call")).toHaveLength(1);
      expect(messagesFor(messages, "notifications/cancelled")).toEqual([
        {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: {
            requestId: request.id,
            reason: "Request cancelled by caller: tools/call",
          },
        },
      ]);
      expect(entry._pending.size).toBe(0);
      expect(removeEventListener).toHaveBeenCalledOnce();
      expect(reconnector).not.toHaveBeenCalled();

      client._handleMessage(SERVER_NAME, {
        jsonrpc: "2.0",
        id: request.id,
        result: { committed: true },
      });
      expect(messagesFor(messages, "notifications/cancelled")).toHaveLength(1);
      expect(entry._pending.size).toBe(0);
    });

    it("removes the caller listener when a resource response wins", async () => {
      const client = new MCPClient();
      const { entry, messages } = addTransportEntry(client, transport);
      const controller = new AbortController();
      const removeEventListener = vi.spyOn(
        controller.signal,
        "removeEventListener",
      );

      const pending = client.readResource(
        SERVER_NAME,
        "file:///workspace/README.md",
        { signal: controller.signal },
      );
      const request = messagesFor(messages, "resources/read")[0];
      client._handleMessage(SERVER_NAME, {
        jsonrpc: "2.0",
        id: request.id,
        result: { contents: [{ uri: "file:///workspace/README.md" }] },
      });

      await expect(pending).resolves.toEqual({
        contents: [{ uri: "file:///workspace/README.md" }],
      });
      expect(entry._pending.size).toBe(0);
      expect(removeEventListener).toHaveBeenCalledOnce();

      controller.abort(CALLER_CANARY);
      expect(messagesFor(messages, "notifications/cancelled")).toHaveLength(0);
    });
  },
);
