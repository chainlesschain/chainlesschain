import { describe, expect, it, vi } from "vitest";
import { createMcpTopicHandlers } from "../../src/gateways/ws/mcp-topic-handlers.js";

function configuredStore(rows) {
  return { list: vi.fn(() => rows) };
}

function connectedClient(overrides = {}) {
  return {
    listServers: vi.fn(() => [{ name: "erp01", state: "connected", tools: 1 }]),
    listTools: vi.fn(() => [
      {
        name: "list_orders",
        description: "List ERP orders",
        inputSchema: { type: "object" },
      },
    ]),
    listResources: vi.fn(() => []),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
    readResource: vi.fn(async () => ({ contents: [] })),
    ...overrides,
  };
}

const ERP_CONFIG = {
  name: "erp01",
  command: "node",
  args: ["D:/erp01-mcp-server/index.js", "--stdio"],
  transport: "stdio",
  autoConnect: true,
  configScope: "user",
  configSource: "user-database",
};

describe("standalone UI MCP topics", () => {
  it("returns one configured server instead of parsing CLI log lines", async () => {
    const store = configuredStore([ERP_CONFIG]);
    const handlers = createMcpTopicHandlers({
      configStore: store,
      cwd: "D:/ESun/AIDev/erp01",
    });

    const result = await handlers["mcp.list_tools"]({});

    expect(store.list).toHaveBeenCalledWith({ cwd: "D:/ESun/AIDev/erp01" });
    expect(result.servers).toEqual([
      expect.objectContaining({
        name: "erp01",
        command: "node",
        args: ["D:/erp01-mcp-server/index.js", "--stdio"],
        configScope: "user",
        autoConnect: true,
        state: "disconnected",
        tools: [],
      }),
    ]);
  });

  it("merges configured metadata with tools from the persistent client", async () => {
    const client = connectedClient();
    const handlers = createMcpTopicHandlers({
      configStore: configuredStore([ERP_CONFIG]),
      mcpClient: client,
    });

    const result = await handlers["mcp.list_tools"]({});

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      name: "erp01",
      state: "connected",
      configScope: "user",
      tools: [
        {
          name: "list_orders",
          description: "List ERP orders",
          inputSchema: { type: "object" },
        },
      ],
    });
    expect(client.listTools).toHaveBeenCalledWith("erp01");
  });

  it("keeps a connected server even when it has no persisted row", async () => {
    const handlers = createMcpTopicHandlers({
      configStore: configuredStore([]),
      mcpClient: connectedClient(),
    });

    const result = await handlers["mcp.list_tools"]({});

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      name: "erp01",
      state: "connected",
    });
  });

  it("isolates a per-server tool-list failure", async () => {
    const handlers = createMcpTopicHandlers({
      configStore: configuredStore([ERP_CONFIG]),
      mcpClient: connectedClient({
        listTools: vi.fn(() => {
          throw new Error("tools/list failed");
        }),
      }),
    });

    const result = await handlers["mcp.list_tools"]({});

    expect(result.servers[0]).toMatchObject({
      name: "erp01",
      state: "connected",
      tools: [],
      error: "tools/list failed",
    });
  });

  it("calls a tool through the same long-lived client", async () => {
    const client = connectedClient();
    const handlers = createMcpTopicHandlers({ mcpClient: client });

    await expect(
      handlers["mcp.call_tool"]({
        serverName: "erp01",
        toolName: "list_orders",
        params: { limit: 5 },
      }),
    ).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(client.callTool).toHaveBeenCalledWith("erp01", "list_orders", {
      limit: 5,
    });
  });

  it("fails closed when no persistent MCP client is available", async () => {
    const handlers = createMcpTopicHandlers();
    await expect(
      handlers["mcp.call_tool"]({
        serverName: "erp01",
        toolName: "list_orders",
      }),
    ).rejects.toThrow("mcp_unavailable");
  });
});
