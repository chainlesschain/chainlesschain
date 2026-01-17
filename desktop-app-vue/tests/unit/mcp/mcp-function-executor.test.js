/**
 * MCP Function Executor Unit Tests
 *
 * Tests for MCP tool to LLM Function Calling conversion and execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the MCP client manager
const mockMCPClientManager = {
  getConnectedServers: vi.fn().mockReturnValue(["filesystem"]),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "File content here" }],
    isError: false,
  }),
};

// Mock the tool manager
const mockToolManager = {
  getTool: vi.fn().mockResolvedValue({
    name: "mcp_filesystem_read_file",
    description: "Read a file from the filesystem",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
      },
      required: ["path"],
    },
  }),
};

// Mock the MCP tool adapter
const mockMCPToolAdapter = {
  getMCPTools: vi.fn().mockReturnValue([
    {
      toolId: "tool_filesystem_read_file",
      serverName: "filesystem",
      originalToolName: "read_file",
    },
    {
      toolId: "tool_filesystem_list_directory",
      serverName: "filesystem",
      originalToolName: "list_directory",
    },
  ]),
  toolManager: mockToolManager,
};

// Import the executor
const MCPFunctionExecutor = require("../../../src/main/mcp/mcp-function-executor");

describe("MCPFunctionExecutor", () => {
  let executor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new MCPFunctionExecutor(mockMCPClientManager, mockMCPToolAdapter);
  });

  afterEach(() => {
    executor = null;
  });

  describe("Constructor", () => {
    it("should initialize with provided dependencies", () => {
      expect(executor.mcpClientManager).toBe(mockMCPClientManager);
      expect(executor.mcpToolAdapter).toBe(mockMCPToolAdapter);
    });

    it("should initialize with empty cache", () => {
      expect(executor._cachedFunctions).toBeNull();
      expect(executor._cacheTimestamp).toBeNull();
    });
  });

  describe("getFunctions", () => {
    it("should return MCP tools in OpenAI function format", async () => {
      const functions = await executor.getFunctions();

      expect(functions).toBeDefined();
      expect(Array.isArray(functions)).toBe(true);
      expect(functions.length).toBe(2);
    });

    it("should cache functions after first call", async () => {
      await executor.getFunctions();
      const cachedFunctions = executor._cachedFunctions;

      expect(cachedFunctions).toBeDefined();
      expect(executor._cacheTimestamp).toBeDefined();
    });

    it("should return cached functions on subsequent calls", async () => {
      await executor.getFunctions();
      mockMCPToolAdapter.getMCPTools.mockClear();

      await executor.getFunctions();

      // getMCPTools should only be called once due to caching
      expect(mockMCPToolAdapter.getMCPTools).not.toHaveBeenCalled();
    });

    it("should include name, description, and parameters in each function", async () => {
      const functions = await executor.getFunctions();

      for (const func of functions) {
        expect(func).toHaveProperty("name");
        expect(func).toHaveProperty("description");
        expect(func).toHaveProperty("parameters");
      }
    });
  });

  describe("clearCache", () => {
    it("should clear the cached functions", async () => {
      await executor.getFunctions();
      expect(executor._cachedFunctions).not.toBeNull();

      executor.clearCache();

      expect(executor._cachedFunctions).toBeNull();
      expect(executor._cacheTimestamp).toBeNull();
    });
  });

  describe("execute", () => {
    it("should execute MCP tool via client manager", async () => {
      const params = { path: "/test.txt" };

      await executor.execute("mcp_filesystem_read_file", params);

      expect(mockMCPClientManager.callTool).toHaveBeenCalledWith(
        "filesystem",
        "read_file",
        params
      );
    });

    it("should return transformed result for successful execution", async () => {
      const result = await executor.execute("mcp_filesystem_read_file", {
        path: "/test.txt",
      });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("data");
      expect(result.data).toBe("File content here");
    });

    it("should return error for failed execution", async () => {
      mockMCPClientManager.callTool.mockResolvedValueOnce({
        content: [{ type: "text", text: "Error: File not found" }],
        isError: true,
      });

      const result = await executor.execute("mcp_filesystem_read_file", {
        path: "/nonexistent.txt",
      });

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error");
    });

    it("should throw error for unknown function name", async () => {
      await expect(
        executor.execute("unknown_function", {})
      ).rejects.toThrow("Unknown MCP function");
    });

    it("should throw error for malformed function name", async () => {
      await expect(executor.execute("not_mcp_format", {})).rejects.toThrow(
        "Unknown MCP function"
      );
    });
  });

  describe("_parseFunctionName", () => {
    it("should parse valid MCP function name", () => {
      const result = executor._parseFunctionName("mcp_filesystem_read_file");

      expect(result).toEqual({
        serverName: "filesystem",
        toolName: "read_file",
      });
    });

    it("should handle tool names with underscores", () => {
      const result = executor._parseFunctionName(
        "mcp_filesystem_list_all_files"
      );

      expect(result).toEqual({
        serverName: "filesystem",
        toolName: "list_all_files",
      });
    });

    it("should return null for invalid function name", () => {
      const result = executor._parseFunctionName("invalid_name");

      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = executor._parseFunctionName("");

      expect(result).toBeNull();
    });
  });

  describe("_transformResult", () => {
    it("should transform successful MCP result", () => {
      const mcpResult = {
        content: [{ type: "text", text: "Success!" }],
        isError: false,
      };

      const result = executor._transformResult(mcpResult);

      expect(result.success).toBe(true);
      expect(result.data).toBe("Success!");
    });

    it("should transform error MCP result", () => {
      const mcpResult = {
        content: [{ type: "text", text: "Error occurred" }],
        isError: true,
      };

      const result = executor._transformResult(mcpResult);

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

      const result = executor._transformResult(mcpResult);

      expect(result.success).toBe(true);
      expect(result.data).toBe("Line 1\nLine 2");
    });
  });

  describe("hasTools", () => {
    it("should return true when MCP tools are available", () => {
      expect(executor.hasTools()).toBe(true);
    });

    it("should return false when no MCP tools are available", () => {
      mockMCPToolAdapter.getMCPTools.mockReturnValueOnce([]);
      const emptyExecutor = new MCPFunctionExecutor(
        mockMCPClientManager,
        { ...mockMCPToolAdapter, getMCPTools: () => [] }
      );

      expect(emptyExecutor.hasTools()).toBe(false);
    });
  });

  describe("getConnectedServerCount", () => {
    it("should return number of connected servers", () => {
      expect(executor.getConnectedServerCount()).toBe(1);
    });

    it("should return 0 when no servers connected", () => {
      mockMCPClientManager.getConnectedServers.mockReturnValueOnce([]);
      expect(executor.getConnectedServerCount()).toBe(0);
    });
  });
});
