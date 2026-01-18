/**
 * MCP Tool Adapter Unit Tests
 *
 * Tests for MCP to ChainlessChain tool format conversion and registration.
 * Updated to match actual MCPToolAdapter implementation API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the tool manager
const mockToolManager = {
  registerTool: vi.fn().mockResolvedValue("tool-id-123"),
  unregisterTool: vi.fn().mockResolvedValue(true),
  executeTool: vi.fn().mockResolvedValue({ success: true }),
  hasTool: vi.fn().mockReturnValue(false),
};

// Mock the MCP client manager
const mockMCPClientManager = {
  on: vi.fn(),
  off: vi.fn(),
  getConnectedServers: vi.fn().mockReturnValue([]),
  listTools: vi.fn().mockResolvedValue([]),
  callTool: vi.fn().mockResolvedValue({ content: [{ text: "result" }] }),
  servers: new Map(),
  connectServer: vi.fn().mockResolvedValue({ tools: [], resources: [] }),
  disconnectServer: vi.fn().mockResolvedValue(undefined),
};

// Mock the security policy
const mockSecurityPolicy = {
  validateToolExecution: vi.fn().mockResolvedValue({ allowed: true }),
};

// Import the adapter (no mocking needed - we pass deps directly)
const { MCPToolAdapter } = require("../../../src/main/mcp/mcp-tool-adapter");

describe("MCPToolAdapter", () => {
  let adapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new MCPToolAdapter(
      mockToolManager,
      mockMCPClientManager,
      mockSecurityPolicy,
    );
  });

  afterEach(() => {
    adapter = null;
  });

  describe("Constructor", () => {
    it("should initialize with provided dependencies", () => {
      expect(adapter.toolManager).toBe(mockToolManager);
      expect(adapter.mcpClientManager).toBe(mockMCPClientManager);
      expect(adapter.securityPolicy).toBe(mockSecurityPolicy);
    });

    it("should initialize empty tool registries", () => {
      expect(adapter.mcpToolRegistry).toBeDefined();
      expect(adapter.mcpToolRegistry instanceof Map).toBe(true);
    });

    it("should initialize empty serverTools map", () => {
      expect(adapter.serverTools).toBeDefined();
      expect(adapter.serverTools instanceof Map).toBe(true);
    });
  });

  describe("Tool Conversion", () => {
    it("should convert MCP tool to ChainlessChain format", () => {
      const mcpTool = {
        name: "read_file",
        description: "Read a file from the filesystem",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      };

      const converted = adapter._convertMCPToolFormat("filesystem", mcpTool);

      expect(converted.name).toBe("mcp_filesystem_read_file");
      expect(converted.description).toBe("Read a file from the filesystem");
      expect(converted.category).toBe("mcp");
      expect(converted.tool_type).toBe("mcp-proxy");
      expect(converted.parameters_schema).toBeDefined();
    });

    it("should prefix tool name with mcp_servername_", () => {
      const mcpTool = {
        name: "my_tool",
        description: "A tool",
        inputSchema: {},
      };

      const converted = adapter._convertMCPToolFormat("server", mcpTool);

      expect(converted.name).toBe("mcp_server_my_tool");
    });

    it("should handle tools without input schema", () => {
      const mcpTool = {
        name: "simple_tool",
        description: "A simple tool",
      };

      const converted = adapter._convertMCPToolFormat("server", mcpTool);

      expect(converted.parameters_schema).toBeDefined();
      expect(converted.parameters_schema.type).toBe("object");
    });

    it("should include MCP metadata in config", () => {
      const mcpTool = {
        name: "test_tool",
        description: "A test tool",
      };

      const converted = adapter._convertMCPToolFormat("test-server", mcpTool);

      const config = JSON.parse(converted.config);
      expect(config.mcpServer).toBe("test-server");
      expect(config.originalToolName).toBe("test_tool");
      expect(config.isMCPTool).toBe(true);
    });
  });

  describe("Tool Registration", () => {
    it("should register tools from a server", async () => {
      const mcpTools = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: {},
        },
        {
          name: "tool2",
          description: "Tool 2",
          inputSchema: {},
        },
      ];

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: mcpTools,
        resources: [],
      });

      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      expect(mockToolManager.registerTool).toHaveBeenCalledTimes(2);
    });

    it("should track registered tools in registry", async () => {
      const mcpTools = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: {},
        },
      ];

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: mcpTools,
        resources: [],
      });
      mockToolManager.registerTool.mockResolvedValueOnce(
        "mcp_test-server_tool1",
      );

      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      expect(adapter.mcpToolRegistry.has("mcp_test-server_tool1")).toBe(true);
    });

    it("should track server -> tools mapping", async () => {
      const mcpTools = [
        { name: "tool1", description: "Tool 1", inputSchema: {} },
        { name: "tool2", description: "Tool 2", inputSchema: {} },
      ];

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: mcpTools,
        resources: [],
      });
      mockToolManager.registerTool
        .mockResolvedValueOnce("mcp_server-a_tool1")
        .mockResolvedValueOnce("mcp_server-a_tool2");

      await adapter.registerMCPServerTools("server-a", {
        command: "npx",
        args: [],
      });

      const serverTools = adapter.serverTools.get("server-a");
      expect(serverTools).toContain("mcp_server-a_tool1");
      expect(serverTools).toContain("mcp_server-a_tool2");
    });

    it("should emit server-registered event", async () => {
      const mcpTools = [
        { name: "tool1", description: "Tool 1", inputSchema: {} },
      ];

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: mcpTools,
        resources: [],
      });

      const eventPromise = new Promise((resolve) => {
        adapter.once("server-registered", resolve);
      });

      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      const event = await eventPromise;
      expect(event.serverName).toBe("test-server");
      expect(event.toolIds).toBeDefined();
    });
  });

  describe("Tool Unregistration", () => {
    it("should unregister tools when server disconnects", async () => {
      // First register some tools
      const mcpTools = [
        { name: "tool1", description: "Tool 1", inputSchema: {} },
      ];

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: mcpTools,
        resources: [],
      });
      mockToolManager.registerTool.mockResolvedValueOnce(
        "mcp_test-server_tool1",
      );

      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      // Then unregister
      await adapter.unregisterMCPServerTools("test-server");

      expect(mockToolManager.unregisterTool).toHaveBeenCalled();
    });

    it("should remove tools from registry on unregistration", async () => {
      const mcpTools = [
        { name: "tool1", description: "Tool 1", inputSchema: {} },
      ];

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: mcpTools,
        resources: [],
      });
      mockToolManager.registerTool.mockResolvedValueOnce(
        "mcp_test-server_tool1",
      );

      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });
      await adapter.unregisterMCPServerTools("test-server");

      expect(adapter.mcpToolRegistry.has("mcp_test-server_tool1")).toBe(false);
    });

    it("should disconnect from MCP server on unregistration", async () => {
      // First register
      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: [],
        resources: [],
      });
      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      // Then unregister
      await adapter.unregisterMCPServerTools("test-server");

      expect(mockMCPClientManager.disconnectServer).toHaveBeenCalledWith(
        "test-server",
      );
    });

    it("should emit server-unregistered event", async () => {
      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: [],
        resources: [],
      });
      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      const eventPromise = new Promise((resolve) => {
        adapter.once("server-unregistered", resolve);
      });

      await adapter.unregisterMCPServerTools("test-server");

      const event = await eventPromise;
      expect(event.serverName).toBe("test-server");
    });
  });

  describe("Get MCP Tools", () => {
    it("should return all registered MCP tools", () => {
      adapter.mcpToolRegistry.set("mcp_tool1", {
        serverName: "server1",
        originalToolName: "tool1",
      });
      adapter.mcpToolRegistry.set("mcp_tool2", {
        serverName: "server2",
        originalToolName: "tool2",
      });

      const allTools = adapter.getMCPTools();

      expect(allTools.length).toBe(2);
      expect(allTools[0].toolId).toBe("mcp_tool1");
      expect(allTools[1].toolId).toBe("mcp_tool2");
    });

    it("should return empty array when no tools registered", () => {
      const allTools = adapter.getMCPTools();
      expect(allTools).toEqual([]);
    });
  });

  describe("isMCPTool", () => {
    it("should return true for registered MCP tool", () => {
      adapter.mcpToolRegistry.set("mcp_tool1", { serverName: "server1" });

      expect(adapter.isMCPTool("mcp_tool1")).toBe(true);
    });

    it("should return false for non-MCP tool", () => {
      expect(adapter.isMCPTool("regular_tool")).toBe(false);
    });
  });

  describe("getToolServer", () => {
    it("should return server name for MCP tool", () => {
      adapter.mcpToolRegistry.set("mcp_tool1", {
        serverName: "test-server",
        originalToolName: "tool1",
      });

      expect(adapter.getToolServer("mcp_tool1")).toBe("test-server");
    });

    it("should return null for non-MCP tool", () => {
      expect(adapter.getToolServer("unknown_tool")).toBeNull();
    });
  });

  describe("Initialization", () => {
    it("should initialize servers from config", async () => {
      const config = {
        servers: {
          filesystem: {
            enabled: true,
            autoConnect: true,
            command: "npx",
            args: [],
          },
        },
      };

      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: [],
        resources: [],
      });

      await adapter.initializeServers(config);

      expect(mockMCPClientManager.connectServer).toHaveBeenCalled();
    });

    it("should skip disabled servers", async () => {
      const config = {
        servers: {
          filesystem: {
            enabled: false,
            autoConnect: true,
          },
        },
      };

      await adapter.initializeServers(config);

      expect(mockMCPClientManager.connectServer).not.toHaveBeenCalled();
    });

    it("should skip servers without autoConnect", async () => {
      const config = {
        servers: {
          filesystem: {
            enabled: true,
            autoConnect: false,
          },
        },
      };

      await adapter.initializeServers(config);

      expect(mockMCPClientManager.connectServer).not.toHaveBeenCalled();
    });

    it("should handle empty config gracefully", async () => {
      await adapter.initializeServers(null);
      await adapter.initializeServers({});
      await adapter.initializeServers({ servers: null });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("Refresh Server Tools", () => {
    it("should refresh tools from server", async () => {
      // First register initial tools
      mockMCPClientManager.connectServer.mockResolvedValueOnce({
        tools: [{ name: "tool1", description: "Tool 1", inputSchema: {} }],
        resources: [],
      });
      mockToolManager.registerTool.mockResolvedValueOnce(
        "mcp_test-server_tool1",
      );

      await adapter.registerMCPServerTools("test-server", {
        command: "npx",
        args: [],
      });

      // Now refresh with new tool
      mockMCPClientManager.listTools.mockResolvedValueOnce([
        { name: "tool1", description: "Tool 1", inputSchema: {} },
        { name: "tool2", description: "Tool 2 (new)", inputSchema: {} },
      ]);
      mockToolManager.registerTool.mockResolvedValueOnce(
        "mcp_test-server_tool2",
      );

      await adapter.refreshServerTools("test-server");

      // Should have registered the new tool
      expect(mockToolManager.registerTool).toHaveBeenCalledTimes(2);
    });
  });

  describe("Result Transformation", () => {
    it("should transform successful MCP result", () => {
      const mcpResult = {
        content: [{ type: "text", text: "Success!" }],
        isError: false,
      };

      const result = adapter._transformMCPResult(mcpResult);

      expect(result.success).toBe(true);
      expect(result.data).toBe("Success!");
    });

    it("should transform error MCP result", () => {
      const mcpResult = {
        content: [{ type: "text", text: "Error occurred" }],
        isError: true,
      };

      const result = adapter._transformMCPResult(mcpResult);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Error occurred");
    });

    it("should handle multiple content items", () => {
      const mcpResult = {
        content: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
        isError: false,
      };

      const result = adapter._transformMCPResult(mcpResult);

      expect(result.success).toBe(true);
      expect(result.data).toBe("Line 1\nLine 2");
    });
  });
});
