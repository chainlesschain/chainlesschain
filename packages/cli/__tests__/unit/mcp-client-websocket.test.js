import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  MCPClient,
  ServerState,
  inferTransport,
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

  it("rejects an in-flight request with structured close diagnostics", async () => {
    const { url } = await startMcpWebSocket((socket, message) => {
      if (message.method === "tools/call") {
        socket.close(1011, "fixture failure");
        return true;
      }
      return false;
    });
    const client = new MCPClient();
    await client.connect("closing", {
      transport: "ws",
      url,
      requestTimeoutMs: 1000,
    });
    await expect(client.callTool("closing", "echo", {})).rejects.toMatchObject({
      code: "CC_MCP_WS_CLOSED",
      closeCode: 1011,
    });
  });

  it("times out an unanswered request with a structured diagnostic", async () => {
    const { url } = await startMcpWebSocket((_socket, message) =>
      message.method === "tools/call" ? true : false,
    );
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
    await client.disconnectAll();
  });
});
