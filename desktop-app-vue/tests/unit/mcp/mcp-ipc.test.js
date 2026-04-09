import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const ipcHandlers = {};
  const mockIpcMain = {
    handle: vi.fn((channel, handler) => {
      ipcHandlers[channel] = handler;
    }),
    removeHandler: vi.fn(),
  };

  return { ipcHandlers, mockIpcMain };
});

vi.mock("electron", () => ({
  ipcMain: hoisted.mockIpcMain,
}));

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("MCP IPC", () => {
  let registerMCPIPC;
  let mockMcpManager;
  let mockMcpAdapter;
  let mockSecurityPolicy;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(hoisted.ipcHandlers).forEach((key) => {
      delete hoisted.ipcHandlers[key];
    });
    hoisted.mockIpcMain.handle.mockImplementation((channel, handler) => {
      hoisted.ipcHandlers[channel] = handler;
    });

    mockMcpManager = {
      servers: new Map([
        ["filesystem", {}],
        ["fetch", {}],
      ]),
      listTools: vi.fn(async (serverName) => {
        if (serverName === "filesystem") {
          return [
            {
              name: "read_file",
              description: "Read from filesystem",
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
              category: "read",
              riskLevel: "low",
              isReadOnly: true,
            },
          ];
        }

        if (serverName === "fetch") {
          return [
            {
              name: "fetch_url",
              title: "Fetch URL",
              description: "Fetch remote URL",
              inputSchema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                },
                required: ["url"],
              },
            },
          ];
        }

        return [];
      }),
      callTool: vi.fn(),
      connectServer: vi.fn(),
      disconnectServer: vi.fn(),
      getServerInfo: vi.fn(),
      metrics: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalLatency: 0,
        toolCallLatencies: new Map(),
        connectionTimes: new Map(),
        errorCounts: new Map(),
      },
    };

    mockMcpAdapter = {
      registerMCPServerTools: vi.fn(),
      unregisterMCPServerTools: vi.fn(),
    };

    mockSecurityPolicy = {
      validateToolCall: vi.fn(() => ({ permitted: true })),
      getPendingConsentRequests: vi.fn(() => []),
      handleConsentResponse: vi.fn(() => ({ success: true, allowed: true })),
    };

    const mod = await import("../../../src/main/mcp/mcp-ipc.js");
    registerMCPIPC = mod.registerMCPIPC;
    registerMCPIPC(
      mockMcpManager,
      mockMcpAdapter,
      mockSecurityPolicy,
      { ipcMain: hoisted.mockIpcMain },
    );
  });

  it("registers the mcp:list-tools handler", () => {
    expect(hoisted.ipcHandlers["mcp:list-tools"]).toBeTypeOf("function");
  });

  it("serializes canonical tool metadata for a specific server", async () => {
    const handler = hoisted.ipcHandlers["mcp:list-tools"];

    const result = await handler(null, { serverName: "filesystem" });

    expect(result.success).toBe(true);
    expect(result.tools).toEqual([
      {
        name: "read_file",
        title: "Read File",
        description: "Read from filesystem",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
        kind: "mcp",
        source: "mcp",
        category: "read",
        riskLevel: "low",
        isReadOnly: true,
      },
    ]);
  });

  it("aggregates tools across servers and includes serverName for global listings", async () => {
    const handler = hoisted.ipcHandlers["mcp:list-tools"];

    const result = await handler(null, {});

    expect(result.success).toBe(true);
    expect(mockMcpManager.listTools).toHaveBeenCalledWith("filesystem");
    expect(mockMcpManager.listTools).toHaveBeenCalledWith("fetch");
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "read_file",
          serverName: "filesystem",
          category: "read",
          riskLevel: "low",
          isReadOnly: true,
        }),
        expect.objectContaining({
          name: "fetch_url",
          title: "Fetch URL",
          serverName: "fetch",
          category: "execute",
          riskLevel: "medium",
          isReadOnly: false,
        }),
      ]),
    );
    expect(result.tools[1].parameters).toEqual(result.tools[1].inputSchema);
  });

  describe("serializeToolForIPC edge cases", () => {
    it("falls back to legacy parameters when inputSchema is absent", async () => {
      mockMcpManager.listTools = vi.fn(async () => [
        {
          name: "legacy_tool",
          description: "Legacy",
          // No inputSchema — only legacy parameters
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ]);
      mockMcpManager.servers = new Map([["legacy-srv", {}]]);

      const handler = hoisted.ipcHandlers["mcp:list-tools"];
      const result = await handler(null, { serverName: "legacy-srv" });

      expect(result.success).toBe(true);
      expect(result.tools[0].inputSchema).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
      });
      expect(result.tools[0].parameters).toEqual(result.tools[0].inputSchema);
    });

    it("applies canonical defaults when risk / category / title are missing", async () => {
      mockMcpManager.listTools = vi.fn(async () => [
        {
          name: "minimal_tool",
          description: "Bare minimum",
          inputSchema: { type: "object" },
        },
      ]);
      mockMcpManager.servers = new Map([["bare", {}]]);

      const handler = hoisted.ipcHandlers["mcp:list-tools"];
      const result = await handler(null, { serverName: "bare" });

      const tool = result.tools[0];
      // Title humanized from snake_case name
      expect(tool.title).toBe("Minimal Tool");
      // Non read-only default → riskLevel medium, category execute
      expect(tool.isReadOnly).toBe(false);
      expect(tool.riskLevel).toBe("medium");
      expect(tool.category).toBe("execute");
      // Source / kind are canonical
      expect(tool.source).toBe("mcp");
      expect(tool.kind).toBe("mcp");
    });

    it("omits serverName when serializing for a specific server-scoped request", async () => {
      const handler = hoisted.ipcHandlers["mcp:list-tools"];
      const result = await handler(null, { serverName: "filesystem" });
      // Scoped listing does not inject serverName into individual tool entries
      expect(result.tools[0].serverName).toBeUndefined();
    });

    it("infers read category when isReadOnly is true but category is missing", async () => {
      mockMcpManager.listTools = vi.fn(async () => [
        {
          name: "inspect_tool",
          description: "Read-only inspection",
          inputSchema: { type: "object" },
          isReadOnly: true,
        },
      ]);
      mockMcpManager.servers = new Map([["inspect", {}]]);

      const handler = hoisted.ipcHandlers["mcp:list-tools"];
      const result = await handler(null, { serverName: "inspect" });

      expect(result.tools[0].category).toBe("read");
      expect(result.tools[0].riskLevel).toBe("low");
    });
  });
});
