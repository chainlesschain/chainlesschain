/**
 * MCP Tool Adapter Unit Tests
 *
 * Tests for MCP to ChainlessChain tool format conversion and registration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the tool manager
const mockToolManager = {
  registerTool: vi.fn().mockResolvedValue(true),
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
};

// Mock the security policy
const mockSecurityPolicy = {
  validateOperation: vi.fn().mockResolvedValue({ allowed: true }),
};

// Import the adapter
vi.mock("../../../src/main/mcp/mcp-client-manager", () => ({
  default: vi.fn().mockImplementation(() => mockMCPClientManager),
}));

const MCPToolAdapter = require("../../../src/main/mcp/mcp-tool-adapter");

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

    it("should set up event listeners on MCP client", () => {
      expect(mockMCPClientManager.on).toHaveBeenCalled();
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

      const converted = adapter._convertToolFormat("filesystem", mcpTool);

      expect(converted.name).toBe("mcp_read_file");
      expect(converted.description).toBe("Read a file from the filesystem");
      expect(converted.source).toBe("mcp");
      expect(converted.serverName).toBe("filesystem");
      expect(converted.originalName).toBe("read_file");
      expect(converted.parameters).toBeDefined();
    });

    it("should prefix tool name with mcp_", () => {
      const mcpTool = {
        name: "my_tool",
        description: "A tool",
        inputSchema: {},
      };

      const converted = adapter._convertToolFormat("server", mcpTool);

      expect(converted.name).toBe("mcp_my_tool");
    });

    it("should handle tools without input schema", () => {
      const mcpTool = {
        name: "simple_tool",
        description: "A simple tool",
      };

      const converted = adapter._convertToolFormat("server", mcpTool);

      expect(converted.parameters).toEqual({});
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

      mockMCPClientManager.listTools.mockResolvedValueOnce(mcpTools);

      await adapter.registerServerTools("test-server");

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

      mockMCPClientManager.listTools.mockResolvedValueOnce(mcpTools);

      await adapter.registerServerTools("test-server");

      expect(adapter.mcpToolRegistry.has("mcp_tool1")).toBe(true);
    });

    it("should handle registration errors gracefully", async () => {
      mockMCPClientManager.listTools.mockRejectedValueOnce(
        new Error("Failed to list tools"),
      );

      // Should not throw
      await expect(
        adapter.registerServerTools("failing-server"),
      ).resolves.not.toThrow();
    });
  });

  describe("Tool Unregistration", () => {
    it("should unregister tools when server disconnects", async () => {
      // First register some tools
      const mcpTools = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: {},
        },
      ];

      mockMCPClientManager.listTools.mockResolvedValueOnce(mcpTools);
      await adapter.registerServerTools("test-server");

      // Then unregister
      await adapter.unregisterServerTools("test-server");

      expect(mockToolManager.unregisterTool).toHaveBeenCalled();
    });

    it("should remove tools from registry on unregistration", async () => {
      const mcpTools = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: {},
        },
      ];

      mockMCPClientManager.listTools.mockResolvedValueOnce(mcpTools);
      await adapter.registerServerTools("test-server");

      await adapter.unregisterServerTools("test-server");

      expect(adapter.mcpToolRegistry.has("mcp_tool1")).toBe(false);
    });
  });

  describe("Tool Execution", () => {
    beforeEach(async () => {
      // Set up a mock server with tools
      adapter.serverToolMap.set("test-server", ["mcp_read_file"]);
      adapter.mcpToolRegistry.set("mcp_read_file", {
        name: "mcp_read_file",
        serverName: "test-server",
        originalName: "read_file",
      });
    });

    it("should execute MCP tool via client manager", async () => {
      const params = { path: "/test.txt" };

      await adapter.executeTool("mcp_read_file", params);

      expect(mockMCPClientManager.callTool).toHaveBeenCalledWith(
        "test-server",
        "read_file",
        params,
      );
    });

    it("should validate operation with security policy", async () => {
      const params = { path: "/test.txt" };

      await adapter.executeTool("mcp_read_file", params);

      expect(mockSecurityPolicy.validateOperation).toHaveBeenCalledWith(
        "test-server",
        "read_file",
        params,
      );
    });

    it("should throw error if security validation fails", async () => {
      mockSecurityPolicy.validateOperation.mockResolvedValueOnce({
        allowed: false,
        reason: "Access denied",
      });

      await expect(
        adapter.executeTool("mcp_read_file", { path: "/secret.txt" }),
      ).rejects.toThrow("Access denied");
    });

    it("should return error for unknown tool", async () => {
      await expect(adapter.executeTool("unknown_tool", {})).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("Server Tools Mapping", () => {
    it("should track which server owns which tools", async () => {
      const mcpTools = [
        { name: "tool1", description: "Tool 1", inputSchema: {} },
        { name: "tool2", description: "Tool 2", inputSchema: {} },
      ];

      mockMCPClientManager.listTools.mockResolvedValueOnce(mcpTools);

      await adapter.registerServerTools("server-a");

      const serverTools = adapter.serverToolMap.get("server-a");
      expect(serverTools).toContain("mcp_tool1");
      expect(serverTools).toContain("mcp_tool2");
    });

    it("should get all MCP tools", () => {
      adapter.mcpToolRegistry.set("mcp_tool1", { name: "mcp_tool1" });
      adapter.mcpToolRegistry.set("mcp_tool2", { name: "mcp_tool2" });

      const allTools = adapter.getAllMCPTools();

      expect(allTools.length).toBe(2);
    });

    it("should check if tool is from MCP", () => {
      adapter.mcpToolRegistry.set("mcp_tool1", { name: "mcp_tool1" });

      expect(adapter.isMCPTool("mcp_tool1")).toBe(true);
      expect(adapter.isMCPTool("regular_tool")).toBe(false);
    });
  });

  describe("Initialization", () => {
    it("should initialize servers on startup", async () => {
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

      adapter.config = config;
      mockMCPClientManager.getConnectedServers.mockReturnValueOnce([]);

      await adapter.initializeServers();

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

      adapter.config = config;
      vi.clearAllMocks();

      await adapter.initializeServers();

      expect(mockMCPClientManager.connectServer).not.toHaveBeenCalled();
    });
  });

  describe("Result Transformation", () => {
    it("should transform MCP result to standard format", () => {
      const mcpResult = {
        content: [{ type: "text", text: "Hello World" }],
      };

      const transformed = adapter._transformResult(mcpResult);

      expect(transformed.success).toBe(true);
      expect(transformed.content).toBeDefined();
    });

    it("should handle error results", () => {
      const mcpResult = {
        isError: true,
        content: [{ type: "text", text: "Error message" }],
      };

      const transformed = adapter._transformResult(mcpResult);

      expect(transformed.success).toBe(false);
      expect(transformed.error).toBeDefined();
    });

    it("should handle empty results", () => {
      const mcpResult = {};

      const transformed = adapter._transformResult(mcpResult);

      expect(transformed.success).toBe(true);
    });
  });

  describe("Cleanup", () => {
    it("should clean up on shutdown", async () => {
      adapter.mcpToolRegistry.set("mcp_tool1", { name: "mcp_tool1" });
      adapter.serverToolMap.set("server1", ["mcp_tool1"]);

      await adapter.shutdown();

      expect(adapter.mcpToolRegistry.size).toBe(0);
      expect(adapter.serverToolMap.size).toBe(0);
    });
  });
});
