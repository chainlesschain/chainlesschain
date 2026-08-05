import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
  MCPClient,
  ServerState,
  inferTransport,
  isLikelyConnectionError,
  isTransientMcpError,
  isWebSocketTransport,
} from "../../src/harness/mcp-client.js";
import { loadMcpConfig } from "../../src/runtime/mcp-config.js";

const servers = new Set();

afterEach(async () => {
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

async function startMcpWebSocket(handler = null) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.add(server);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket, request) => {
    socket.on("message", (bytes, binary) => {
      if (binary) return;
      const message = JSON.parse(String(bytes));
      if (handler?.(socket, message, request) === true) return;
      if (message.id == null) return;
      const results = {
        initialize: {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "ws-fixture", version: "1.0.0" },
          capabilities: { tools: {}, resources: {}, prompts: {} },
        },
        "tools/list": {
          tools: [
            {
              name: "echo",
              description: "echo input",
              inputSchema: { type: "object" },
            },
          ],
        },
        "resources/list": { resources: [] },
        "resources/templates/list": {
          resourceTemplates: [
            { uriTemplate: "file:///{path}", name: "workspace-file" },
          ],
        },
        "prompts/list": { prompts: [] },
      };
      const result =
        message.method === "tools/call"
          ? { content: [{ type: "text", text: message.params.arguments.text }] }
          : results[message.method] || {};
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  const address = server.address();
  return { server, url: `ws://127.0.0.1:${address.port}/mcp` };
}

describe("MCPClient WebSocket transport contract", () => {
  it("recognizes ws/wss as WebSocket rather than HTTP transports", () => {
    expect(inferTransport({ url: "ws://127.0.0.1/mcp" })).toBe("ws");
    expect(inferTransport({ url: "wss://example.test/mcp" })).toBe("wss");
    expect(isWebSocketTransport("ws")).toBe(true);
    expect(isWebSocketTransport("wss")).toBe(true);
    expect(isWebSocketTransport("https")).toBe(false);
  });

  it("performs initialize, discovery, notifications, and tool calls over a real socket", async () => {
    let authorization = null;
    const notifications = [];
    const { url } = await startMcpWebSocket((socket, message, request) => {
      authorization = request.headers.authorization;
      if (message.id == null) notifications.push(message.method);
      return false;
    });
    const client = new MCPClient();

    const connected = await client.connect("fixture", {
      transport: "ws",
      url,
      headers: { Authorization: "Bearer fixture-token" },
      requestTimeoutMs: 1000,
    });

    expect(connected.state).toBe(ServerState.CONNECTED);
    expect(connected.tools.map((tool) => tool.name)).toEqual(["echo"]);
    expect(connected.resourceTemplates).toEqual([
      { uriTemplate: "file:///{path}", name: "workspace-file" },
    ]);
    expect(authorization).toBe("Bearer fixture-token");
    expect(notifications).toContain("notifications/initialized");
    await expect(
      client.callTool("fixture", "echo", { text: "hello" }),
    ).resolves.toEqual({ content: [{ type: "text", text: "hello" }] });
    expect(notifications).not.toContain("notifications/cancelled");
    await client.disconnectAll();
  });

  it("connects an official type=ws config through the runtime loader", async () => {
    const { url } = await startMcpWebSocket();
    const loaded = await loadMcpConfig("fixture.json", {
      readFile: () =>
        JSON.stringify({
          mcpServers: {
            events: { type: "ws", url },
          },
        }),
    });

    expect(loaded.connected).toEqual([
      { server: "events", tools: 1, resources: 0, prompts: 0 },
    ]);
    expect(loaded.mcpClient.servers.get("events")).toMatchObject({
      transportKind: "ws",
      state: ServerState.CONNECTED,
    });
    await loaded.mcpClient.disconnectAll();
  });

  it("rejects a transport/URL scheme mismatch before opening a socket", async () => {
    const client = new MCPClient();
    await expect(
      client.connect("bad", {
        transport: "ws",
        url: "https://example.test/mcp",
      }),
    ).rejects.toMatchObject({ code: "CC_MCP_WS_SCHEME_MISMATCH" });
    expect(client.servers.has("bad")).toBe(false);
  });

  it("redacts peer close reasons and never replays an outcome-unknown call", async () => {
    const canary = "WS_CLOSE_REASON_SECRET_HTTP_503_ECONNRESET";
    let toolCalls = 0;
    const { url } = await startMcpWebSocket((socket, message) => {
      if (message.method === "tools/call") {
        toolCalls += 1;
        if (toolCalls === 1) {
          socket.close(1011, canary);
          return true;
        }
      }
      return false;
    });
    const client = new MCPClient();
    const disconnected = [];
    client.on("server-disconnected", (event) => disconnected.push(event));
    await client.connect("closing", {
      transport: "ws",
      url,
      requestTimeoutMs: 1000,
    });
    const reconnector = vi.fn(() => ({ transport: "ws", url }));
    client.setReconnector("closing", reconnector);

    let error;
    try {
      await client.callTool("closing", "echo", {});
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      code: "CC_MCP_WS_CLOSED",
      closeCode: 1011,
      dispatched: true,
      outcomeUnknown: true,
    });
    expect(toolCalls).toBe(1);
    expect(reconnector).not.toHaveBeenCalled();
    expect(disconnected).toContainEqual({
      name: "closing",
      code: 1011,
      reason: "peer_closed",
      errorCode: "CC_MCP_WS_CLOSED",
    });
    expect(
      JSON.stringify({
        message: error?.message,
        stack: error?.stack,
        disconnected,
      }),
    ).not.toContain(canary);
    await expect(
      client.callTool("closing", "echo", { text: "fresh-call" }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "fresh-call" }],
    });
    expect(reconnector).toHaveBeenCalledOnce();
    expect(toolCalls).toBe(2);
    await client.disconnectAll();
  });

  it("cancels direct elicitation and URL completion waiters on peer close", async () => {
    const canary = "WS_ELICITATION_CLOSE_SECRET";
    let releaseHandlerStart;
    const handlerStarted = new Promise((resolve) => {
      releaseHandlerStart = resolve;
    });
    const { server, url } = await startMcpWebSocket();
    const client = new MCPClient({
      elicitationHandler: async (request) => {
        if (request.requestId === "hanging-form") {
          releaseHandlerStart();
          return new Promise(() => {});
        }
        return { action: "accept" };
      },
    });
    await client.connect("eliciting", {
      transport: "ws",
      url,
      requestTimeoutMs: 1000,
    });
    await expect(
      client._resolveElicitation("eliciting", "url-flow", {
        mode: "url",
        elicitationId: "close-flow",
        url: "https://example.test/authorize",
        message: "Authorize",
      }),
    ).resolves.toEqual({ action: "accept" });
    const completion = client.waitForElicitationCompletion(
      "close-flow",
      10_000,
    );
    const hanging = client._resolveElicitation("eliciting", "hanging-form", {
      message: "Confirm",
    });
    await handlerStarted;

    const disconnected = new Promise((resolve) => {
      client.once("server-disconnected", resolve);
    });
    [...server.clients][0].close(1011, canary);

    const disconnectedEvent = await disconnected;
    expect(disconnectedEvent).toMatchObject({
      name: "eliciting",
      reason: "peer_closed",
    });
    await expect(hanging).resolves.toEqual({ action: "cancel" });
    await expect(completion).resolves.toBe(false);
    expect(client._activeElicitations).toBe(0);
    expect(client._elicitationDisconnectGuards.size).toBe(0);
    expect(client._urlElicitations.get("close-flow")).toMatchObject({
      server: "eliciting",
      status: "cancel",
    });
    expect(client._urlElicitations.get("close-flow").waiters.size).toBe(0);
    expect(JSON.stringify(disconnectedEvent)).not.toContain(canary);
    await client.disconnectAll();
  });

  it.each([
    {
      label: "malformed JSON text",
      expectedCode: "CC_MCP_WS_INVALID_MESSAGE",
      send(socket, canary) {
        socket.send(`ECONNRESET HTTP 503 ${canary}`);
      },
    },
    {
      label: "binary frame",
      expectedCode: "CC_MCP_WS_BINARY_MESSAGE",
      send(socket, canary) {
        socket.send(Buffer.from(canary));
      },
    },
  ])(
    "does not leak or replay a tool call after a $label",
    async ({ expectedCode, send }) => {
      const canary = `WS_PROTOCOL_SECRET_${expectedCode}`;
      let toolCalls = 0;
      const { url } = await startMcpWebSocket((socket, message) => {
        if (message.method !== "tools/call") return false;
        toolCalls += 1;
        send(socket, canary);
        return true;
      });
      const client = new MCPClient();
      const serverErrors = [];
      client.on("server-error", (event) => serverErrors.push(event));
      await client.connect("invalid-frame", {
        transport: "ws",
        url,
        requestTimeoutMs: 1000,
      });
      const reconnector = vi.fn(() => ({ transport: "ws", url }));
      client.setReconnector("invalid-frame", reconnector);

      let error;
      try {
        await client.callTool("invalid-frame", "echo", {});
      } catch (cause) {
        error = cause;
      }

      expect(error).toMatchObject({ code: expectedCode });
      expect(toolCalls).toBe(1);
      expect(reconnector).not.toHaveBeenCalled();
      expect(isLikelyConnectionError(error)).toBe(false);
      expect(isTransientMcpError(error)).toBe(false);
      expect(
        JSON.stringify({
          message: error?.message,
          stack: error?.stack,
          serverErrors,
        }),
      ).not.toContain(canary);
      await client.disconnectAll();
    },
  );

  it("times out an unanswered request with a structured diagnostic", async () => {
    let requestId = null;
    const cancellations = [];
    let resolveCancellation;
    const cancellationReceived = new Promise((resolve) => {
      resolveCancellation = resolve;
    });
    const { url } = await startMcpWebSocket((_socket, message) => {
      if (message.method === "tools/call") {
        requestId = message.id;
        return true;
      }
      if (message.method === "notifications/cancelled") {
        cancellations.push(message);
        resolveCancellation(message);
        return true;
      }
      return false;
    });
    const client = new MCPClient();
    await client.connect("silent", {
      transport: "ws",
      url,
      requestTimeoutMs: 25,
    });

    await expect(client.callTool("silent", "echo", {})).rejects.toMatchObject({
      code: "CC_MCP_WS_REQUEST_TIMEOUT",
      transport: "ws",
      url,
    });
    expect(client.servers.get("silent")._pending.size).toBe(0);
    const cancellation = await Promise.race([
      cancellationReceived,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("cancellation notification not received")),
          1000,
        ),
      ),
    ]);
    expect(cancellation.params).toEqual({
      requestId,
      reason: "Request timeout: tools/call (WebSocket, no response in 25ms)",
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(cancellations).toHaveLength(1);
    await client.disconnectAll();
  });
});
