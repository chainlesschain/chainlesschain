/**
 * SkillToolIPC 单元测试
 *
 * 测试技能-工具系统的IPC通信处理
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ===================== MOCK FACTORIES =====================

const createMockIpcMain = () => {
  const handlers = new Map();

  return {
    handle: vi.fn((channel, handler) => {
      handlers.set(channel, handler);
    }),
    // Helper method to get registered handler
    getHandler: (channel) => handlers.get(channel),
    // Helper to simulate IPC call
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler for ${channel}`);
      }
      return handler({}, ...args);
    },
  };
};

const createMockSkillManager = () => ({
  getAllSkills: vi.fn().mockResolvedValue({
    success: true,
    skills: [
      { id: "skill-1", name: "test_skill", enabled: 1, category: "test" },
    ],
  }),
  getSkill: vi.fn().mockResolvedValue({ id: "skill-1", name: "test_skill" }),
  getSkillsByCategory: vi.fn().mockResolvedValue({
    success: true,
    skills: [],
  }),
  enableSkill: vi.fn().mockResolvedValue(true),
  disableSkill: vi.fn().mockResolvedValue(true),
  updateSkill: vi.fn().mockResolvedValue(true),
  getSkillStats: vi.fn().mockResolvedValue({ total: 10, success: 8 }),
  getSkillTools: vi
    .fn()
    .mockResolvedValue([{ id: "tool-1", name: "test_tool", role: "primary" }]),
  addToolToSkill: vi.fn().mockResolvedValue(true),
  removeToolFromSkill: vi.fn().mockResolvedValue(true),
  getSkillDoc: vi.fn().mockResolvedValue("# Test Skill Documentation"),
  getEnabledSkills: vi
    .fn()
    .mockResolvedValue([
      { id: "skill-1", name: "test_skill", enabled: 1, category: "test" },
    ]),
});

const createMockToolManager = () => ({
  getAllTools: vi.fn().mockResolvedValue({
    success: true,
    tools: [
      {
        id: "tool-1",
        name: "test_tool",
        enabled: 1,
        category: "test",
        usage_count: 5,
        success_count: 4,
        avg_execution_time: 100,
      },
    ],
  }),
  getTool: vi.fn().mockResolvedValue({ id: "tool-1", name: "test_tool" }),
  getToolsByCategory: vi.fn().mockResolvedValue({
    success: true,
    tools: [],
  }),
  getToolsBySkill: vi.fn().mockResolvedValue([]),
  enableTool: vi.fn().mockResolvedValue(true),
  disableTool: vi.fn().mockResolvedValue(true),
  updateTool: vi.fn().mockResolvedValue(true),
  getToolStats: vi.fn().mockResolvedValue({ total: 5, success: 4 }),
  getToolDoc: vi.fn().mockResolvedValue("# Test Tool Documentation"),
  functionCaller: {
    hasTool: vi.fn().mockReturnValue(true),
    call: vi.fn().mockResolvedValue({ result: "test" }),
  },
});

const createMockSkillRecommender = () => ({
  recommendSkills: vi.fn().mockResolvedValue([{ id: "skill-1", score: 0.95 }]),
  getPopularSkills: vi
    .fn()
    .mockResolvedValue([{ id: "skill-1", usage_count: 100 }]),
  getRelatedSkills: vi
    .fn()
    .mockResolvedValue([{ id: "skill-2", similarity: 0.85 }]),
  searchSkills: vi.fn().mockResolvedValue([{ id: "skill-1", relevance: 0.92 }]),
});

const createMockConfigManager = () => ({
  exportSkills: vi.fn().mockResolvedValue({ skills: [] }),
  exportTools: vi.fn().mockResolvedValue({ tools: [] }),
  exportToFile: vi.fn().mockResolvedValue({ success: true }),
  importFromFile: vi.fn().mockResolvedValue({ imported: 5 }),
  importConfig: vi.fn().mockResolvedValue({ imported: 3 }),
  createTemplate: vi.fn().mockReturnValue({ template: "data" }),
});

// ===================== TESTS =====================

describe("SkillToolIPC", () => {
  let mockIpcMain;
  let mockSkillMgr;
  let mockToolMgr;
  let registerSkillToolIPC;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockIpcMain = createMockIpcMain();
    mockSkillMgr = createMockSkillManager();
    mockToolMgr = createMockToolManager();

    // Reset global objects
    global.skillRecommender = undefined;
    global.configManager = undefined;

    // 动态导入模块
    const module =
      await import("../../../src/main/skill-tool-system/skill-tool-ipc.js");
    registerSkillToolIPC = module.registerSkillToolIPC;

    // 注册 Skill Tool IPC 并注入 mock 对象
    registerSkillToolIPC({
      ipcMain: mockIpcMain,
      skillManager: mockSkillMgr,
      toolManager: mockToolMgr,
    });
  });

  describe("registerSkillToolIPC()", () => {
    it("should register all IPC handlers", () => {
      const testIpcMain = createMockIpcMain();
      registerSkillToolIPC({
        ipcMain: testIpcMain,
        skillManager: mockSkillMgr,
        toolManager: mockToolMgr,
      });

      expect(testIpcMain.handle).toHaveBeenCalled();
      expect(testIpcMain.handle.mock.calls.length).toBeGreaterThan(30);
    });

    it("should register skill handlers", () => {
      const testIpcMain = createMockIpcMain();
      registerSkillToolIPC({
        ipcMain: testIpcMain,
        skillManager: mockSkillMgr,
        toolManager: mockToolMgr,
      });

      const skillHandlers = [
        "skill:get-all",
        "skill:get-by-id",
        "skill:get-by-category",
        "skill:enable",
        "skill:disable",
        "skill:update-config",
        "skill:update",
        "skill:get-stats",
        "skill:get-tools",
        "skill:add-tool",
        "skill:remove-tool",
        "skill:get-doc",
      ];

      skillHandlers.forEach((channel) => {
        expect(mockIpcMain.getHandler(channel)).toBeDefined();
      });
    });

    it("should register tool handlers", () => {
      const testIpcMain = createMockIpcMain();
      registerSkillToolIPC({
        ipcMain: testIpcMain,
        skillManager: mockSkillMgr,
        toolManager: mockToolMgr,
      });

      const toolHandlers = [
        "tool:get-all",
        "tool:get-by-id",
        "tool:get-by-category",
        "tool:get-by-skill",
        "tool:enable",
        "tool:disable",
        "tool:update-config",
        "tool:update-schema",
        "tool:update",
        "tool:get-stats",
        "tool:get-doc",
        "tool:test",
      ];

      toolHandlers.forEach((channel) => {
        expect(testIpcMain.getHandler(channel)).toBeDefined();
      });
    });

    it("should register analytics handlers", () => {
      const testIpcMain = createMockIpcMain();
      registerSkillToolIPC({
        ipcMain: testIpcMain,
        skillManager: mockSkillMgr,
        toolManager: mockToolMgr,
      });

      const analyticsHandlers = [
        "skill-tool:get-dependency-graph",
        "skill-tool:get-usage-analytics",
        "skill-tool:get-category-stats",
      ];

      analyticsHandlers.forEach((channel) => {
        expect(testIpcMain.getHandler(channel)).toBeDefined();
      });
    });
  });

  describe("Skill IPC Handlers", () => {
    // beforeEach in parent scope already registered IPC handlers

    it("should handle skill:get-all", async () => {
      const result = await mockIpcMain.invoke("skill:get-all");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockSkillMgr.getAllSkills).toHaveBeenCalled();
    });

    it("should handle skill:get-by-id", async () => {
      const result = await mockIpcMain.invoke("skill:get-by-id", "skill-1");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockSkillMgr.getSkill).toHaveBeenCalledWith("skill-1");
    });

    it("should handle skill:enable", async () => {
      const result = await mockIpcMain.invoke("skill:enable", "skill-1");

      expect(result.success).toBe(true);
      expect(mockSkillMgr.enableSkill).toHaveBeenCalledWith("skill-1");
    });

    it("should handle skill:disable", async () => {
      const result = await mockIpcMain.invoke("skill:disable", "skill-1");

      expect(result.success).toBe(true);
      expect(mockSkillMgr.disableSkill).toHaveBeenCalledWith("skill-1");
    });

    it("should handle skill:update-config", async () => {
      const config = { timeout: 5000 };
      const result = await mockIpcMain.invoke(
        "skill:update-config",
        "skill-1",
        config,
      );

      expect(result.success).toBe(true);
      expect(mockSkillMgr.updateSkill).toHaveBeenCalledWith("skill-1", {
        config,
      });
    });

    it("should handle skill:get-stats", async () => {
      const result = await mockIpcMain.invoke("skill:get-stats", "skill-1");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockSkillMgr.getSkillStats).toHaveBeenCalled();
    });

    it("should handle skill:get-tools", async () => {
      const result = await mockIpcMain.invoke("skill:get-tools", "skill-1");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockSkillMgr.getSkillTools).toHaveBeenCalled();
    });

    it("should handle errors in skill handlers", async () => {
      mockSkillMgr.getSkill.mockRejectedValueOnce(new Error("Skill not found"));

      const result = await mockIpcMain.invoke("skill:get-by-id", "nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Skill not found");
    });
  });

  describe("Tool IPC Handlers", () => {
    // beforeEach in parent scope already registered IPC handlers

    it("should handle tool:get-all", async () => {
      const result = await mockIpcMain.invoke("tool:get-all");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockToolMgr.getAllTools).toHaveBeenCalled();
    });

    it("should handle tool:get-by-id", async () => {
      const result = await mockIpcMain.invoke("tool:get-by-id", "tool-1");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockToolMgr.getTool).toHaveBeenCalledWith("tool-1");
    });

    it("should handle tool:enable", async () => {
      const result = await mockIpcMain.invoke("tool:enable", "tool-1");

      expect(result.success).toBe(true);
      expect(mockToolMgr.enableTool).toHaveBeenCalledWith("tool-1");
    });

    it("should handle tool:disable", async () => {
      const result = await mockIpcMain.invoke("tool:disable", "tool-1");

      expect(result.success).toBe(true);
      expect(mockToolMgr.disableTool).toHaveBeenCalledWith("tool-1");
    });

    it("should handle tool:update-schema", async () => {
      const schema = { type: "object", properties: {} };
      const result = await mockIpcMain.invoke(
        "tool:update-schema",
        "tool-1",
        schema,
      );

      expect(result.success).toBe(true);
      expect(mockToolMgr.updateTool).toHaveBeenCalledWith("tool-1", {
        parameters_schema: schema,
      });
    });

    it("should handle tool:test", async () => {
      const params = { input: "test" };
      const result = await mockIpcMain.invoke("tool:test", "tool-1", params);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockToolMgr.getTool).toHaveBeenCalled();
      expect(mockToolMgr.functionCaller.call).toHaveBeenCalled();
    });

    it("should handle tool:test when tool not found", async () => {
      mockToolMgr.getTool.mockResolvedValueOnce(null);

      const result = await mockIpcMain.invoke("tool:test", "nonexistent", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("工具不存在");
    });

    it("should handle errors in tool handlers", async () => {
      mockToolMgr.getTool.mockRejectedValueOnce(new Error("Tool not found"));

      const result = await mockIpcMain.invoke("tool:get-by-id", "nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool not found");
    });
  });

  describe("Analytics IPC Handlers", () => {
    // beforeEach in parent scope already registered IPC handlers

    it("should handle skill-tool:get-dependency-graph", async () => {
      const result = await mockIpcMain.invoke(
        "skill-tool:get-dependency-graph",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.nodes).toBeDefined();
      expect(result.data.edges).toBeDefined();
    });

    it("should build dependency graph correctly", async () => {
      const result = await mockIpcMain.invoke(
        "skill-tool:get-dependency-graph",
      );

      expect(result.success).toBe(true);
      const graph = result.data;

      // Should have skill nodes
      const skillNodes = graph.nodes.filter((n) => n.type === "skill");
      expect(skillNodes.length).toBeGreaterThan(0);

      // Should have tool nodes
      const toolNodes = graph.nodes.filter((n) => n.type === "tool");
      expect(toolNodes.length).toBeGreaterThan(0);

      // Should have edges
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it("should handle skill-tool:get-usage-analytics", async () => {
      const result = await mockIpcMain.invoke("skill-tool:get-usage-analytics");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.totalSkills).toBeDefined();
      expect(result.data.totalTools).toBeDefined();
      expect(result.data.topSkills).toBeDefined();
      expect(result.data.topTools).toBeDefined();
    });

    it("should calculate usage analytics correctly", async () => {
      const result = await mockIpcMain.invoke("skill-tool:get-usage-analytics");

      expect(result.success).toBe(true);
      const analytics = result.data;

      expect(analytics.totalSkills).toBe(1);
      expect(analytics.totalTools).toBe(1);
      expect(Array.isArray(analytics.topSkills)).toBe(true);
      expect(Array.isArray(analytics.topTools)).toBe(true);
    });

    it("should handle skill-tool:get-category-stats", async () => {
      const result = await mockIpcMain.invoke("skill-tool:get-category-stats");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.skillCategories).toBeDefined();
      expect(result.data.toolCategories).toBeDefined();
    });
  });

  describe("Recommendation IPC Handlers", () => {
    beforeEach(() => {
      global.skillRecommender = createMockSkillRecommender();
      // beforeEach in parent scope already registered IPC handlers
    });

    it("should handle skill:recommend", async () => {
      const result = await mockIpcMain.invoke("skill:recommend", "test input");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.skillRecommender.recommendSkills).toHaveBeenCalled();
    });

    it("should handle skill:get-popular", async () => {
      const result = await mockIpcMain.invoke("skill:get-popular", 10);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.skillRecommender.getPopularSkills).toHaveBeenCalledWith(10);
    });

    it("should handle skill:get-related", async () => {
      const result = await mockIpcMain.invoke(
        "skill:get-related",
        "skill-1",
        5,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.skillRecommender.getRelatedSkills).toHaveBeenCalledWith(
        "skill-1",
        5,
      );
    });

    it("should handle skill:search", async () => {
      const result = await mockIpcMain.invoke("skill:search", "query");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.skillRecommender.searchSkills).toHaveBeenCalled();
    });

    it("should handle missing recommender", async () => {
      global.skillRecommender = undefined;

      const result = await mockIpcMain.invoke("skill:recommend", "test");

      expect(result.success).toBe(false);
      expect(result.error).toContain("推荐引擎未初始化");
    });
  });

  describe("Config IPC Handlers", () => {
    beforeEach(() => {
      global.configManager = createMockConfigManager();
      // beforeEach in parent scope already registered IPC handlers
    });

    it("should handle config:export-skills", async () => {
      const result = await mockIpcMain.invoke("config:export-skills", [
        "skill-1",
      ]);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.configManager.exportSkills).toHaveBeenCalled();
    });

    it("should handle config:export-tools", async () => {
      const result = await mockIpcMain.invoke("config:export-tools", [
        "tool-1",
      ]);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.configManager.exportTools).toHaveBeenCalled();
    });

    it("should handle config:export-to-file", async () => {
      const data = { skills: [] };
      const result = await mockIpcMain.invoke(
        "config:export-to-file",
        data,
        "/path/to/file.json",
        "json",
      );

      expect(result.success).toBe(true);
      expect(global.configManager.exportToFile).toHaveBeenCalledWith(
        data,
        "/path/to/file.json",
        "json",
      );
    });

    it("should handle config:import-from-file", async () => {
      const result = await mockIpcMain.invoke(
        "config:import-from-file",
        "/path/to/file.json",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.configManager.importFromFile).toHaveBeenCalled();
    });

    it("should handle config:import", async () => {
      const data = { skills: [] };
      const result = await mockIpcMain.invoke("config:import", data);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.configManager.importConfig).toHaveBeenCalled();
    });

    it("should handle config:create-template", async () => {
      const result = await mockIpcMain.invoke(
        "config:create-template",
        "skill",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(global.configManager.createTemplate).toHaveBeenCalledWith("skill");
    });

    it("should handle missing config manager", async () => {
      global.configManager = undefined;

      const result = await mockIpcMain.invoke("config:export-skills", [
        "skill-1",
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("配置管理器未初始化");
    });
  });

  describe("Error Handling", () => {
    // beforeEach in parent scope already registered IPC handlers

    it("should handle async errors in skill handlers", async () => {
      mockSkillMgr.getAllSkills.mockRejectedValueOnce(
        new Error("Database error"),
      );

      const result = await mockIpcMain.invoke("skill:get-all");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database error");
    });

    it("should handle async errors in tool handlers", async () => {
      mockToolMgr.getAllTools.mockRejectedValueOnce(
        new Error("Database error"),
      );

      const result = await mockIpcMain.invoke("tool:get-all");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database error");
    });

    it("should handle errors in analytics handlers", async () => {
      mockSkillMgr.getEnabledSkills.mockRejectedValueOnce(
        new Error("Query failed"),
      );

      const result = await mockIpcMain.invoke(
        "skill-tool:get-dependency-graph",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Query failed");
    });
  });
});
