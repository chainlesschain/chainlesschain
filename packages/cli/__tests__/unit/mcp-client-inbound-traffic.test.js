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
const TRAFFIC_CANARY = "INBOUND_TRAFFIC_SECRET_CANARY";

function handshakeResult(method) {
  return {
    initialize: {
      protocolVersion: "2025-11-25",
      serverInfo: { name: "budget-fixture", version: "1" },
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

class BudgetWebSocket extends EventEmitter {
  static instances = [];

  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
    BudgetWebSocket.instances.push(this);
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
  const messages = [];
  const process = {
    killed: false,
    kill: vi.fn(() => {
      process.killed = true;
    }),
    stdin: {
      write: vi.fn((wire) => {
        messages.push(JSON.parse(String(wire).trim()));
        return true;
      }),
    },
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
  return { entry, messages, process };
}

function notification(index, padding = "") {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/test",
    params: { index, padding },
  });
}

function addHttpEntry(client, config = {}) {
  const entry = {
    config,
    state: ServerState.CONNECTED,
    transportKind: "https",
    process: null,
    socket: null,
    httpUrl: "https://mcp.example.test/rpc?token=secret",
    httpHeaders: {},
    httpSessionId: "session-1",
    protocolVersion: "2025-11-25",
    _httpMessageStream: null,
    _pending: new Map(),
  };
  client.servers.set("sse", entry);
  return entry;
}

function sseResponse(wire, cancel = vi.fn()) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
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

async function captureError(promise) {
  try {
    await promise;
    throw new Error("expected MCP inbound budget rejection");
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  _deps.fetch = originalFetch;
  _deps.WebSocket = originalWebSocket;
  BudgetWebSocket.instances = [];
});

afterEach(async () => {
  vi.useRealTimers();
  for (const client of clients) await client.disconnectAll();
  clients.clear();
  _deps.fetch = originalFetch;
  _deps.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("MCPClient host-owned inbound traffic budgets", () => {
  it("fails stdio at a tightened message rate without replaying pending work", async () => {
    const client = new MCPClient();
    clients.add(client);
    const { entry, process } = addStdioEntry(client, {
      maxInboundMessagesPerSecond: 2,
    });
    const notifications = [];
    const serverErrors = [];
    client.on("notification", (event) => notifications.push(event));
    client.on("server-error", (event) => serverErrors.push(event));
    const reconnector = vi.fn();
    client.setReconnector("stdio", reconnector);

    const pending = client.callTool("stdio", "mutate", {});
    client._handleData("stdio", `${notification(1)}\n`);
    client._handleData("stdio", `${notification(2)}\n`);
    client._handleData("stdio", `${notification(3, TRAFFIC_CANARY)}\n`);
    const error = await captureError(pending);

    expect(error).toMatchObject({
      code: "CC_MCP_INBOUND_RATE_EXCEEDED",
      limitMessages: 2,
      windowMs: 1000,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(isLikelyConnectionError(error)).toBe(false);
    expect(isTransientMcpError(error)).toBe(false);
    expect(error.message).not.toContain(TRAFFIC_CANARY);
    expect(notifications).toHaveLength(2);
    expect(serverErrors).toEqual([
      expect.objectContaining({
        code: "CC_MCP_INBOUND_RATE_EXCEEDED",
        limitMessages: 2,
        windowMs: 1000,
      }),
    ]);
    expect(entry.state).toBe(ServerState.ERROR);
    expect(entry._pending.size).toBe(0);
    expect(process.kill).toHaveBeenCalledOnce();
    expect(reconnector).not.toHaveBeenCalled();
  });

  it("refills the stdio rolling byte budget and then fails the next burst", () => {
    vi.useFakeTimers();
    const client = new MCPClient();
    clients.add(client);
    const frame = notification(1);
    const frameBytes = Buffer.byteLength(frame, "utf8");
    const { entry } = addStdioEntry(client, {
      maxInboundBytesPerMinute: frameBytes * 2,
    });

    client._handleData("stdio", `${frame}\n${frame}\n`);
    expect(entry.state).toBe(ServerState.CONNECTED);

    vi.advanceTimersByTime(30_000);
    client._handleData("stdio", `${frame}\n`);
    expect(entry.state).toBe(ServerState.CONNECTED);

    client._handleData("stdio", `${notification(4, TRAFFIC_CANARY)}\n`);
    expect(entry._stdioFrameError).toMatchObject({
      code: "CC_MCP_INBOUND_TRAFFIC_EXCEEDED",
      limitBytes: frameBytes * 2,
      windowMs: 60_000,
    });
    expect(entry._stdioFrameError.message).not.toContain(TRAFFIC_CANARY);
  });

  it("refills message tokens so a bounded long-lived stream stays healthy", () => {
    vi.useFakeTimers();
    const client = new MCPClient();
    clients.add(client);
    const { entry } = addStdioEntry(client, {
      maxInboundMessagesPerSecond: 2,
    });

    client._handleData("stdio", `${notification(1)}\n${notification(2)}\n`);
    vi.advanceTimersByTime(500);
    client._handleData("stdio", `${notification(3)}\n`);
    vi.advanceTimersByTime(500);
    client._handleData("stdio", `${notification(4)}\n`);

    expect(entry.state).toBe(ServerState.CONNECTED);
    expect(entry._stdioFrameError).toBeNull();
    expect(entry._inboundTrafficBudget.messageTokens).toBe(0);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])(
    "does not let config value %s disable or raise either host ceiling",
    (configured) => {
      const client = new MCPClient();
      clients.add(client);
      const { entry } = addStdioEntry(client, {
        maxInboundMessagesPerSecond: configured,
        maxInboundBytesPerMinute: configured,
      });

      client._handleData("stdio", `${notification(1)}\n`);

      expect(entry._inboundTrafficBudget).toMatchObject({
        messageCapacity: 128,
        byteCapacity: 64 * 1024 * 1024,
      });
    },
  );

  it("stops background SSE on a message-rate burst before the excess dispatch", async () => {
    const events = [1, 2, 3]
      .map((index) => `data: ${notification(index)}\n\n`)
      .join("");
    const cancel = vi.fn();
    _deps.fetch = vi.fn(async () => sseResponse(events, cancel));
    const client = new MCPClient();
    clients.add(client);
    const entry = addHttpEntry(client, {
      maxInboundMessagesPerSecond: 2,
    });
    const notifications = [];
    client.on("notification", (event) => notifications.push(event));
    const streamError = new Promise((resolve) =>
      client.once("server-stream-error", resolve),
    );

    expect(client._ensureHttpMessageStream("sse")).toBe(true);
    const stream = entry._httpMessageStream;
    const errorEvent = await streamError;
    await stream.promise;

    expect(errorEvent).toEqual({
      name: "sse",
      code: "CC_MCP_INBOUND_RATE_EXCEEDED",
      error:
        'MCP server "sse" exceeded the 2-message/1000ms host inbound rate budget',
      limitMessages: 2,
      windowMs: 1000,
    });
    expect(notifications).toHaveLength(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(_deps.fetch).toHaveBeenCalledOnce();
    expect(entry._httpMessageStream).toBeNull();
  });

  it("stops background SSE on cumulative bytes without surfacing payload", async () => {
    const event = `data: ${notification(1, TRAFFIC_CANARY)}\n\n`;
    const cancel = vi.fn();
    _deps.fetch = vi.fn(async () => sseResponse(event, cancel));
    const client = new MCPClient();
    clients.add(client);
    const entry = addHttpEntry(client, { maxInboundBytesPerMinute: 32 });
    const streamError = new Promise((resolve) =>
      client.once("server-stream-error", resolve),
    );

    client._ensureHttpMessageStream("sse");
    const stream = entry._httpMessageStream;
    const errorEvent = await streamError;
    await stream.promise;

    expect(errorEvent).toMatchObject({
      code: "CC_MCP_INBOUND_TRAFFIC_EXCEEDED",
      limitBytes: 32,
      windowMs: 60_000,
    });
    expect(JSON.stringify(errorEvent)).not.toContain(TRAFFIC_CANARY);
    expect(cancel).toHaveBeenCalledOnce();
    expect(entry._httpMessageStream).toBeNull();
  });

  it("closes WebSocket with policy code on a rate burst and fences replay", async () => {
    _deps.WebSocket = BudgetWebSocket;
    const client = new MCPClient();
    clients.add(client);
    await client.connect("ws", {
      transport: "ws",
      url: "ws://mcp.example.test/rpc",
    });
    const entry = client.servers.get("ws");
    entry.config = { ...entry.config, maxInboundMessagesPerSecond: 2 };
    entry._inboundTrafficBudget = null;
    const socket = BudgetWebSocket.instances[0];
    const notifications = [];
    const serverErrors = [];
    const disconnected = [];
    client.on("notification", (event) => notifications.push(event));
    client.on("server-error", (event) => serverErrors.push(event));
    client.on("server-disconnected", (event) => disconnected.push(event));
    const reconnector = vi.fn();
    client.setReconnector("ws", reconnector);

    const pending = client.callTool("ws", "mutate", {});
    for (let index = 1; index <= 3; index += 1) {
      socket.emit(
        "message",
        Buffer.from(notification(index, index === 3 ? TRAFFIC_CANARY : "")),
        false,
      );
    }
    const error = await captureError(pending);
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toMatchObject({
      code: "CC_MCP_INBOUND_RATE_EXCEEDED",
      limitMessages: 2,
      windowMs: 1000,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(socket.closed).toEqual({
      code: 1008,
      reason: "inbound budget exceeded",
    });
    expect(notifications).toHaveLength(2);
    expect(serverErrors).toHaveLength(1);
    expect(disconnected).toEqual([
      expect.objectContaining({
        reason: "inbound_budget_exceeded",
        errorCode: "CC_MCP_INBOUND_RATE_EXCEEDED",
      }),
    ]);
    expect(entry.state).toBe(ServerState.ERROR);
    expect(reconnector).not.toHaveBeenCalled();
    expect(
      JSON.stringify({ error: error.message, serverErrors, disconnected }),
    ).not.toContain(TRAFFIC_CANARY);
  });

  it("closes WebSocket when one text message exhausts cumulative bytes", async () => {
    _deps.WebSocket = BudgetWebSocket;
    const client = new MCPClient();
    clients.add(client);
    await client.connect("ws", {
      transport: "ws",
      url: "ws://mcp.example.test/rpc",
    });
    const entry = client.servers.get("ws");
    entry.config = { ...entry.config, maxInboundBytesPerMinute: 32 };
    entry._inboundTrafficBudget = null;
    const socket = BudgetWebSocket.instances[0];
    const serverError = new Promise((resolve) =>
      client.once("server-error", resolve),
    );

    socket.emit("message", Buffer.from(notification(1, TRAFFIC_CANARY)), false);
    const errorEvent = await serverError;

    expect(errorEvent).toMatchObject({
      code: "CC_MCP_INBOUND_TRAFFIC_EXCEEDED",
      limitBytes: 32,
      windowMs: 60_000,
    });
    expect(JSON.stringify(errorEvent)).not.toContain(TRAFFIC_CANARY);
    expect(socket.closed?.code).toBe(1008);
    expect(entry.state).toBe(ServerState.ERROR);
  });
});
