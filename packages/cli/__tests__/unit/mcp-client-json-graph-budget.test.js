import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCPClient,
  ServerState,
  _deps,
  isLikelyConnectionError,
  isTransientMcpError,
} from "../../src/harness/mcp-client.js";

const originalFetch = _deps.fetch;
const originalWebSocket = _deps.WebSocket;
const clients = new Set();
const GRAPH_CANARY = "MCP_JSON_GRAPH_SECRET_CANARY";

function handshakeResult(method) {
  return {
    initialize: {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "graph-fixture", version: "1" },
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
    "tools/list": {
      tools: [{ name: "mutate", inputSchema: { type: "object" } }],
    },
    "resources/list": { resources: [] },
    "resources/templates/list": { resourceTemplates: [] },
    "prompts/list": { prompts: [] },
  }[method];
}

class GraphWebSocket extends EventEmitter {
  static instances = [];

  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
    GraphWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open");
    });
  }

  send(wire, callback) {
    const message = JSON.parse(String(wire));
    this.sent.push(message);
    callback?.();
    if (message.id == null || message.method === "tools/call") return;
    const result = handshakeResult(message.method);
    queueMicrotask(() => {
      this.emit(
        "message",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result })),
        false,
      );
    });
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.closed = { code, reason };
    queueMicrotask(() => {
      this.readyState = 3;
      this.emit("close", code);
    });
  }

  terminate() {
    this.close(1006, "terminated");
  }
}

function addStdioEntry(client, config = {}) {
  const process = {
    kill: vi.fn(),
    stdin: { write: vi.fn(() => true) },
  };
  const entry = {
    config: { longRunning: true, requestTimeoutMs: 0, ...config },
    state: ServerState.CONNECTED,
    transportKind: "stdio",
    process,
    socket: null,
    _pending: new Map(),
    _buffer: "",
    _bufferBytes: 0,
    _stdioFrameError: null,
    _malformedFrameBytes: 0,
    _malformedFrameCount: 0,
    _stderrBytes: 0,
    _stderrNotified: false,
  };
  client.servers.set("stdio", entry);
  return { entry, process };
}

function addHttpEntry(client, name, config = {}) {
  const entry = {
    config,
    state: ServerState.CONNECTED,
    transportKind: "https",
    process: null,
    socket: null,
    httpUrl: `https://${name}.example.test/rpc?token=secret`,
    httpHeaders: {},
    httpSessionId: null,
    protocolVersion: "2025-11-25",
    _httpMessageStream: null,
    _pending: new Map(),
  };
  client.servers.set(name, entry);
  return entry;
}

function readerResponse(wire, contentType, cancel = vi.fn()) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? contentType
          : null;
      },
    },
    body: {
      getReader() {
        let read = false;
        return {
          async read() {
            if (read) return { done: true };
            read = true;
            return { done: false, value: Buffer.from(wire) };
          },
          cancel,
          releaseLock: vi.fn(),
        };
      },
    },
  };
}

function deepResultWire(id, arrayDepth, leaf = GRAPH_CANARY) {
  return `{"jsonrpc":"2.0","id":${id},"result":${"[".repeat(arrayDepth)}${JSON.stringify(leaf)}${"]".repeat(arrayDepth)}}`;
}

function wideResultWire(id, valueCount) {
  return `{"jsonrpc":"2.0","id":${id},"result":[${Array(valueCount).fill("0").join(",")}]}`;
}

function deepResult(arrayDepth, leaf = GRAPH_CANARY) {
  let result = leaf;
  for (let index = 0; index < arrayDepth; index += 1) result = [result];
  return result;
}

async function captureError(promise) {
  try {
    await promise;
    throw new Error("expected MCP JSON graph rejection");
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  _deps.fetch = originalFetch;
  _deps.WebSocket = originalWebSocket;
  GraphWebSocket.instances = [];
});

afterEach(async () => {
  for (const client of clients) await client.disconnectAll();
  clients.clear();
  _deps.fetch = originalFetch;
  _deps.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("MCPClient host-owned JSON object graph budgets", () => {
  it("rejects a deep stdio response before JSON.parse dispatch and kills the peer", async () => {
    const client = new MCPClient();
    clients.add(client);
    const { entry, process } = addStdioEntry(client, { maxJsonDepth: 4 });
    const serverErrors = [];
    client.on("server-error", (event) => serverErrors.push(event));
    const pending = client._sendRequest("stdio", "tools/call", {});

    client._handleData("stdio", `${deepResultWire(1, 4)}\n`);
    const error = await captureError(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_JSON_DEPTH_EXCEEDED",
      limitDepth: 4,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(isLikelyConnectionError(error)).toBe(false);
    expect(isTransientMcpError(error)).toBe(false);
    expect(error.message).not.toContain(GRAPH_CANARY);
    expect(entry.state).toBe(ServerState.ERROR);
    expect(entry._pending.size).toBe(0);
    expect(process.kill).toHaveBeenCalledOnce();
    expect(serverErrors).toEqual([
      expect.objectContaining({
        code: "CC_MCP_JSON_DEPTH_EXCEEDED",
        limitDepth: 4,
      }),
    ]);
    expect(JSON.stringify(serverErrors)).not.toContain(GRAPH_CANARY);
  });

  it("keeps the 100000-node host ceiling when config tries to raise it", async () => {
    const client = new MCPClient();
    clients.add(client);
    const { entry } = addStdioEntry(client, {
      maxJsonNodes: Number.MAX_SAFE_INTEGER,
    });
    const pending = client._sendRequest("stdio", "tools/call", {});

    client._handleData("stdio", `${wideResultWire(1, 100_000)}\n`);
    const error = await captureError(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_JSON_NODES_EXCEEDED",
      limitNodes: 100_000,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(entry._pending.size).toBe(0);
  });

  it("rejects a deep application/json response with fixed HTTP diagnostics", async () => {
    _deps.fetch = vi.fn(async () =>
      readerResponse(deepResultWire(1, 4), "application/json"),
    );
    const client = new MCPClient();
    clients.add(client);
    addHttpEntry(client, "json", { maxJsonDepth: 4 });

    const error = await captureError(
      client._sendRequest("json", "tools/call", {}),
    );

    expect(error).toMatchObject({
      code: "CC_MCP_JSON_DEPTH_EXCEEDED",
      limitDepth: 4,
      dispatched: true,
      outcomeUnknown: true,
      url: "https://json.example.test/rpc",
    });
    expect(error.message).not.toContain(GRAPH_CANARY);
    expect(_deps.fetch).toHaveBeenCalledOnce();
  });

  it("rejects an oversized request-scoped SSE graph before matching its id", async () => {
    const wire = `data: ${wideResultWire(1, 8)}\n\n`;
    _deps.fetch = vi.fn(async () => readerResponse(wire, "text/event-stream"));
    const client = new MCPClient();
    clients.add(client);
    addHttpEntry(client, "request-sse", { maxJsonNodes: 10 });

    const error = await captureError(
      client._sendRequest("request-sse", "tools/call", {}),
    );

    expect(error).toMatchObject({
      code: "CC_MCP_JSON_NODES_EXCEEDED",
      limitNodes: 10,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(_deps.fetch).toHaveBeenCalledOnce();
  });

  it("stops background SSE without dispatch or reconnect on a wide graph", async () => {
    const params = Array(8).fill(0).join(",");
    const wire = `data: {"jsonrpc":"2.0","method":"notifications/test","params":[${params}]}\n\n`;
    const cancel = vi.fn();
    _deps.fetch = vi.fn(async () =>
      readerResponse(wire, "text/event-stream", cancel),
    );
    const client = new MCPClient();
    clients.add(client);
    const entry = addHttpEntry(client, "background", { maxJsonNodes: 10 });
    const notifications = [];
    client.on("notification", (event) => notifications.push(event));
    const streamError = new Promise((resolve) =>
      client.once("server-stream-error", resolve),
    );

    expect(client._ensureHttpMessageStream("background")).toBe(true);
    const stream = entry._httpMessageStream;
    const errorEvent = await streamError;
    await stream.promise;

    expect(errorEvent).toMatchObject({
      code: "CC_MCP_JSON_NODES_EXCEEDED",
      limitNodes: 10,
    });
    expect(JSON.stringify(errorEvent)).not.toContain(GRAPH_CANARY);
    expect(notifications).toHaveLength(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(_deps.fetch).toHaveBeenCalledOnce();
    expect(entry._httpMessageStream).toBeNull();
  });

  it("closes WebSocket with policy code and fences a pending mutation", async () => {
    _deps.WebSocket = GraphWebSocket;
    const client = new MCPClient();
    clients.add(client);
    await client.connect("ws", {
      transport: "ws",
      url: "ws://graph.example.test/rpc",
    });
    const entry = client.servers.get("ws");
    entry.config = { ...entry.config, maxJsonDepth: 4 };
    const socket = GraphWebSocket.instances[0];
    const serverErrors = [];
    const disconnected = [];
    client.on("server-error", (event) => serverErrors.push(event));
    client.on("server-disconnected", (event) => disconnected.push(event));
    const pending = client.callTool("ws", "mutate", {});
    const requestId = socket.sent.find(
      (message) => message.method === "tools/call",
    ).id;

    socket.emit("message", Buffer.from(deepResultWire(requestId, 4)), false);
    const error = await captureError(pending);
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toMatchObject({
      code: "CC_MCP_JSON_DEPTH_EXCEEDED",
      limitDepth: 4,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(socket.closed).toEqual({
      code: 1008,
      reason: "inbound budget exceeded",
    });
    expect(entry.state).toBe(ServerState.ERROR);
    expect(serverErrors).toEqual([
      expect.objectContaining({
        code: "CC_MCP_JSON_DEPTH_EXCEEDED",
        limitDepth: 4,
      }),
    ]);
    expect(disconnected).toEqual([
      expect.objectContaining({
        reason: "inbound_budget_exceeded",
        errorCode: "CC_MCP_JSON_DEPTH_EXCEEDED",
        limitDepth: 4,
      }),
    ]);
    expect(JSON.stringify({ serverErrors, disconnected })).not.toContain(
      GRAPH_CANARY,
    );
  });

  it("does not count brackets, braces, or escaped quotes inside JSON strings", () => {
    const client = new MCPClient();
    clients.add(client);
    const { entry } = addStdioEntry(client, {
      maxJsonDepth: 2,
      maxJsonNodes: 9,
    });
    const notifications = [];
    client.on("notification", (event) => notifications.push(event));
    const text = `${"[{".repeat(200)}\\"${"]}".repeat(200)}`;
    const wire = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/test",
      params: { text },
    });

    client._handleData("stdio", `${wire}\n`);

    expect(entry.state).toBe(ServerState.CONNECTED);
    expect(entry._stdioFrameError).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].params.text).toBe(text);
  });

  it("bounds a directly injected deep graph without recursive traversal", async () => {
    const client = new MCPClient();
    clients.add(client);
    let rejectPending;
    const pending = new Promise((_, reject) => {
      rejectPending = reject;
    });
    client.servers.set("direct", {
      config: { maxJsonDepth: 4 },
      state: ServerState.CONNECTED,
      transportKind: "custom",
      _pending: new Map([
        [7, { resolve: vi.fn(), reject: rejectPending, timeout: null }],
      ]),
    });

    client._handleMessage("direct", {
      jsonrpc: "2.0",
      id: 7,
      result: deepResult(4),
    });
    const error = await captureError(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_JSON_DEPTH_EXCEEDED",
      limitDepth: 4,
    });
    expect(client.servers.get("direct").state).toBe(ServerState.ERROR);
  });

  it("rejects a Proxy result without executing its traps", async () => {
    const client = new MCPClient();
    clients.add(client);
    let trapReads = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          trapReads += 1;
          throw new Error(GRAPH_CANARY);
        },
        ownKeys() {
          trapReads += 1;
          throw new Error(GRAPH_CANARY);
        },
      },
    );
    let rejectPending;
    const pending = new Promise((_, reject) => {
      rejectPending = reject;
    });
    client.servers.set("direct", {
      config: {},
      state: ServerState.CONNECTED,
      _pending: new Map([
        [7, { resolve: vi.fn(), reject: rejectPending, timeout: null }],
      ]),
    });

    client._handleMessage("direct", {
      jsonrpc: "2.0",
      id: 7,
      result: hostile,
    });
    const error = await captureError(pending);

    expect(trapReads).toBe(0);
    expect(error).toMatchObject({
      code: "CC_MCP_RPC_RESPONSE_INVALID",
    });
    expect(error.message).not.toContain(GRAPH_CANARY);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])(
    "does not let config value %s disable or raise the depth cap",
    async (value) => {
      const client = new MCPClient();
      clients.add(client);
      let rejectPending;
      const pending = new Promise((_, reject) => {
        rejectPending = reject;
      });
      client.servers.set("direct", {
        config: { maxJsonDepth: value, maxJsonNodes: value },
        state: ServerState.CONNECTED,
        _pending: new Map([
          [7, { resolve: vi.fn(), reject: rejectPending, timeout: null }],
        ]),
      });

      client._handleMessage("direct", {
        jsonrpc: "2.0",
        id: 7,
        result: deepResult(100),
      });
      const error = await captureError(pending);

      expect(error).toMatchObject({
        code: "CC_MCP_JSON_DEPTH_EXCEEDED",
        limitDepth: 100,
      });
    },
  );
});
