/**
 * ToolManager单元测试
 *
 * 测试工具管理器的核心功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 动态导入CommonJS模块
let ToolManager;

describe("ToolManager", () => {
  let toolManager;
  let mockDatabase;
  let mockFunctionCaller;

  beforeEach(async () => {
    // 动态导入模块
    ToolManager = (
      await import("../../src/main/skill-tool-system/tool-manager.js")
    ).default;

    // 创建模拟对象
    mockDatabase = {
      prepare: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    };

    mockFunctionCaller = {
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      tools: new Map(),
    };

    toolManager = new ToolManager(mockDatabase, mockFunctionCaller);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("registerTool", () => {
    it("应该成功注册新工具", async () => {
      const toolData = {
        id: "test_tool",
        name: "test_tool",
        description: "测试工具",
        category: "test",
        parameters_schema: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
        },
      };

      const handler = async (params) => ({ success: true, result: params });

      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await expect(
        toolManager.registerTool(toolData, handler),
      ).resolves.not.toThrow();
      expect(mockFunctionCaller.registerTool).toHaveBeenCalledWith(
        "test_tool",
        handler,
        expect.any(Object),
      );
    });

    it("应该验证参数Schema", async () => {
      const toolData = {
        id: "test_tool",
        name: "test_tool",
        parameters_schema: "invalid schema", // 无效的schema
      };

      await expect(
        toolManager.registerTool(toolData, () => {}),
      ).rejects.toThrow();
    });

    it("应该验证必填字段", async () => {
      const invalidTool = {
        id: "test_tool",
        // 缺少name
      };

      await expect(
        toolManager.registerTool(invalidTool, () => {}),
      ).rejects.toThrow();
    });
  });

  describe("getTool", () => {
    it("应该返回存在的工具", async () => {
      const mockTool = {
        id: "test_tool",
        name: "test_tool",
        category: "test",
      };

      mockDatabase.get.mockResolvedValue(mockTool);

      const tool = await toolManager.getTool("test_tool");
      expect(tool).toEqual(mockTool);
    });

    it("应该在工具不存在时返回null", async () => {
      mockDatabase.get.mockResolvedValue(null);

      const tool = await toolManager.getTool("nonexistent");
      expect(tool).toBeNull();
    });
  });

  describe("enableTool / disableTool", () => {
    it("应该启用工具", async () => {
      // Mock getTool to return an existing tool
      const mockTool = {
        id: "test_tool",
        name: "test_tool",
        enabled: 0,
      };
      mockDatabase.get.mockResolvedValue(mockTool);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.enableTool("test_tool");

      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it("应该禁用工具", async () => {
      // Mock getTool to return an existing tool
      const mockTool = {
        id: "test_tool",
        name: "test_tool",
        enabled: 1,
      };
      mockDatabase.get.mockResolvedValue(mockTool);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.disableTool("test_tool");

      expect(mockDatabase.run).toHaveBeenCalled();
    });
  });

  describe("getToolsByCategory", () => {
    it("应该返回指定分类的所有工具", async () => {
      const mockTools = [
        { id: "tool1", category: "file" },
        { id: "tool2", category: "file" },
      ];

      mockDatabase.all.mockResolvedValue(mockTools);

      const tools = await toolManager.getToolsByCategory("file");
      expect(tools).toHaveLength(2);
      expect(tools).toEqual(mockTools);
    });
  });

  describe("recordToolUsage", () => {
    it("应该记录工具使用统计", async () => {
      // Mock getToolByName to return an existing tool
      const mockTool = {
        id: "test_tool",
        name: "test_tool",
        usage_count: 0,
        success_count: 0,
        avg_execution_time: 0,
      };
      mockDatabase.get.mockResolvedValue(mockTool);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.recordToolUsage("test_tool", true, 500);

      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it("应该记录失败的工具调用", async () => {
      // Mock getToolByName to return an existing tool
      const mockTool = {
        id: "test_tool",
        name: "test_tool",
        usage_count: 0,
        success_count: 0,
        avg_execution_time: 0,
      };
      mockDatabase.get.mockResolvedValue(mockTool);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.recordToolUsage("test_tool", false, 100, "TypeError");

      expect(mockDatabase.run).toHaveBeenCalled();
    });
  });

  describe("validateParametersSchema", () => {
    it("应该验证有效的JSON Schema", () => {
      const validSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      const result = toolManager.validateParametersSchema(validSchema);
      expect(result).toBe(true);
    });

    it("应该拒绝无效的Schema", () => {
      const invalidSchema = {
        type: "invalid_type",
      };

      // validateParametersSchema returns false for invalid schemas (doesn't throw)
      const result = toolManager.validateParametersSchema(invalidSchema);
      expect(result).toBe(false);
    });
  });
});
