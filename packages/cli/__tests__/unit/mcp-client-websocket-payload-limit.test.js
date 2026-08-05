import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  MCPClient,
  ServerState,
  _deps,
  isLikelyConnectionError,
} from "../../src/harness/mcp-client.js";
import { loadMcpConfig } from "../../src/runtime/mcp-config.js";

const WEBSOCKET_HARD_LIMIT_BYTES = 16 * 1024 * 1024;
const PAYLOAD_CANARY = "OVERSIZED_WS_PAYLOAD_CANARY_MUST_NOT_SURFACE";
const originalWebSocket = _deps.WebSocket;
const clients = new Set();
const servers = new Set();

async function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
}

function resultFor(method) {
  return {
    initialize: {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "payload-fixture", version: "1" },
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
    "tools/list": {
      tools: [{ name: "explode", inputSchema: { type: "object" } }],
    },
    "resources/list": { resources: [] },
    "resources/templates/list": { resourceTemplates: [] },
    "prompts/list": { prompts: [] },
  }[method];
}

async function startPayloadServer({
  perMessageDeflate = false,
  closeWith1009 = false,
} = {}) {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    perMessageDeflate,
  });
  servers.add(server);
  let resolvePeerClose;
  const peerClose = new Promise((resolve) => {
    resolvePeerClose = resolve;
  });
  const state = {
    extensions: "",
    toolCalls: 0,
  };

  server.on("connection", (socket) => {
    state.extensions = socket.extensions;
    socket.on("close", (code, reason) => {
      resolvePeerClose({ code, reason: String(reason || "") });
    });
    socket.on("message", (data, binary) => {
      if (binary) return;
      const message = JSON.parse(String(data));
      if (message.id == null) return;
      if (message.method === "tools/call") {
        state.toolCalls += 1;
        if (closeWith1009) {
          socket.close(1009, PAYLOAD_CANARY);
          return;
        }
        const text = `${PAYLOAD_CANARY}:${"x".repeat(8 * 1024)}`;
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text }] },
          }),
          { compress: perMessageDeflate },
          () => {},
        );
        return;
      }
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: resultFor(message.method) || {},
        }),
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  return {
    state,
    url: `ws://127.0.0.1:${address.port}/mcp`,
    waitForPeerClose: () => withTimeout(peerClose, "peer close"),
  };
}

async function captureError(promise) {
  try {
    await promise;
    throw new Error("expected WebSocket payload rejection");
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  _deps.WebSocket = originalWebSocket;
});

afterEach(async () => {
  _deps.WebSocket = originalWebSocket;
  for (const client of clients) await client.disconnectAll();
  clients.clear();
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise((resolve) => {
          for (const socket of server.clients) socket.terminate();
          server.close(resolve);
        }),
    ),
  );
  servers.clear();
});

describe("MCPClient WebSocket host-owned payload limit", () => {
  it("propagates a tighter ordinary config-file limit to the socket sink", async () => {
    const observed = [];
    _deps.WebSocket = class RejectingWebSocket {
      constructor(_url, options) {
        observed.push(options.maxPayload);
        throw new Error("fixture constructor stop");
      }
    };
    const errors = [];

    const loaded = await loadMcpConfig("fixture.json", {
      readFile: () =>
        JSON.stringify({
          mcpServers: {
            limited: {
              transport: "ws",
              url: "ws://mcp.example.test/rpc",
              headers: { Authorization: "Bearer fixture" },
              maxPayloadBytes: 2048,
            },
          },
        }),
      writeErr: (line) => errors.push(line),
    });

    expect(observed).toEqual([2048]);
    expect(loaded.connected).toEqual([]);
    expect(errors.join("")).toContain("fixture constructor stop");
  });

  it("clamps disabled, invalid, and oversized config before construction", async () => {
    const observed = [];
    _deps.WebSocket = class RejectingWebSocket {
      constructor(_url, options) {
        observed.push(options.maxPayload);
        throw new Error("fixture constructor stop");
      }
    };
    const configuredValues = [
      [undefined, WEBSOCKET_HARD_LIMIT_BYTES],
      [0, 1024],
      [-1, 1024],
      [1, 1024],
      [Number.NaN, WEBSOCKET_HARD_LIMIT_BYTES],
      [Number.POSITIVE_INFINITY, WEBSOCKET_HARD_LIMIT_BYTES],
      [Number.NEGATIVE_INFINITY, WEBSOCKET_HARD_LIMIT_BYTES],
      [WEBSOCKET_HARD_LIMIT_BYTES + 1, WEBSOCKET_HARD_LIMIT_BYTES],
      [2 ** 32, WEBSOCKET_HARD_LIMIT_BYTES],
      [Number.MAX_SAFE_INTEGER, WEBSOCKET_HARD_LIMIT_BYTES],
    ];

    for (const [index, [maxPayloadBytes]] of configuredValues.entries()) {
      const client = new MCPClient();
      await expect(
        client.connect(`clamped-${index}`, {
          transport: "ws",
          url: "ws://mcp.example.test/rpc",
          maxPayloadBytes,
        }),
      ).rejects.toThrow("fixture constructor stop");
    }

    const tighteningClient = new MCPClient();
    await expect(
      tighteningClient.connect("tightened", {
        transport: "ws",
        url: "ws://mcp.example.test/rpc",
        maxPayloadBytes: 1024,
      }),
    ).rejects.toThrow("fixture constructor stop");
    expect(observed.slice(0, configuredValues.length)).toEqual(
      configuredValues.map(([, expected]) => expected),
    );
    expect(observed.at(-1)).toBe(1024);
  });

  it.each([
    ["uncompressed", false],
    ["permessage-deflate", true],
  ])(
    "rejects an oversized %s response without dispatch or reconnect",
    async (_label, perMessageDeflate) => {
      const fixture = await startPayloadServer({ perMessageDeflate });
      const client = new MCPClient();
      clients.add(client);
      const serverErrors = [];
      const disconnected = [];
      const notifications = [];
      let resolveDisconnected;
      const disconnectedEvent = new Promise((resolve) => {
        resolveDisconnected = resolve;
      });
      let reconnectCalls = 0;
      client.on("server-error", (event) => serverErrors.push(event));
      client.on("server-disconnected", (event) => {
        disconnected.push(event);
        resolveDisconnected(event);
      });
      client.on("notification", (event) => notifications.push(event));
      await client.connect("payload", {
        transport: "ws",
        url: fixture.url,
        maxPayloadBytes: 1024,
        requestTimeoutMs: 2000,
      });
      client.setReconnector("payload", async () => {
        reconnectCalls += 1;
        return null;
      });

      const error = await captureError(
        client.callTool("payload", "explode", {}),
      );
      const peerClose = await fixture.waitForPeerClose();
      await withTimeout(disconnectedEvent, "client disconnect event");

      expect(error).toMatchObject({
        code: "CC_MCP_WS_PAYLOAD_TOO_LARGE",
        closeCode: 1009,
        limitBytes: 1024,
      });
      expect(isLikelyConnectionError(error)).toBe(false);
      expect(peerClose.code).toBe(1009);
      expect(fixture.state.toolCalls).toBe(1);
      expect(reconnectCalls).toBe(0);
      expect(notifications).toHaveLength(0);
      expect(serverErrors).toHaveLength(1);
      expect(serverErrors[0]).toMatchObject({
        code: "CC_MCP_WS_PAYLOAD_TOO_LARGE",
        limitBytes: 1024,
      });
      expect(disconnected).toHaveLength(1);
      expect(disconnected[0]).toMatchObject({
        errorCode: "CC_MCP_WS_PAYLOAD_TOO_LARGE",
        limitBytes: 1024,
      });
      expect(client.servers.get("payload")).toMatchObject({
        state: ServerState.ERROR,
      });
      expect(client.servers.get("payload")._pending.size).toBe(0);
      if (perMessageDeflate) {
        expect(fixture.state.extensions).toContain("permessage-deflate");
      } else {
        expect(fixture.state.extensions).toBe("");
      }
      const observable = [
        error.message,
        ...serverErrors.map((event) => JSON.stringify(event)),
        ...disconnected.map((event) => JSON.stringify(event)),
      ].join("\n");
      expect(observable).not.toContain(PAYLOAD_CANARY);
    },
    10000,
  );

  it("maps a remote close code 1009 without exposing its reason", async () => {
    const fixture = await startPayloadServer({ closeWith1009: true });
    const client = new MCPClient();
    clients.add(client);
    const serverErrors = [];
    const disconnected = [];
    client.on("server-error", (event) => serverErrors.push(event));
    client.on("server-disconnected", (event) => disconnected.push(event));
    await client.connect("remote-1009", {
      transport: "ws",
      url: fixture.url,
      maxPayloadBytes: 1024,
      requestTimeoutMs: 2000,
    });

    const error = await captureError(
      client.callTool("remote-1009", "explode", {}),
    );
    await fixture.waitForPeerClose();
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toMatchObject({
      code: "CC_MCP_WS_PAYLOAD_TOO_LARGE",
      closeCode: 1009,
      limitBytes: 1024,
    });
    expect(serverErrors).toHaveLength(1);
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]).toMatchObject({
      code: 1009,
      reason: "payload too large",
      errorCode: "CC_MCP_WS_PAYLOAD_TOO_LARGE",
      limitBytes: 1024,
    });
    expect(
      [
        error.message,
        ...serverErrors.map((event) => JSON.stringify(event)),
        ...disconnected.map((event) => JSON.stringify(event)),
      ].join("\n"),
    ).not.toContain(PAYLOAD_CANARY);
  });

  it("maps an unsupported declared payload length to the same stable error", async () => {
    class DeclaredLengthSocket extends EventEmitter {
      constructor() {
        super();
        this.readyState = WebSocket.CONNECTING;
        queueMicrotask(() => {
          this.readyState = WebSocket.OPEN;
          this.emit("open");
        });
      }

      send(_message, callback) {
        callback?.();
        queueMicrotask(() => {
          const error = new RangeError("remote detail must not surface");
          error.code = "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH";
          this.emit("error", error);
        });
      }

      close() {}

      terminate() {}
    }
    _deps.WebSocket = DeclaredLengthSocket;

    const error = await captureError(
      new MCPClient().connect("declared-length", {
        transport: "ws",
        url: "ws://mcp.example.test/rpc",
        maxPayloadBytes: 2048,
      }),
    );

    expect(error).toMatchObject({
      code: "CC_MCP_WS_PAYLOAD_TOO_LARGE",
      closeCode: 1009,
      limitBytes: 2048,
    });
    expect(error.message).not.toContain("remote detail");
  });
});
