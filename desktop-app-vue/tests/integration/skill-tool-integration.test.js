/**
 * 技能工具系统集成测试
 * 测试技能-工具-执行器的完整工作流程
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "path.js";
const fs = require("fs").promises;
import Database from "better-sqlite3-multiple-ciphers.js";

// 导入核心模块
import SkillManager from "../../src/main/skill-tool-system/skill-manager.js";
import ToolManager from "../../src/main/skill-tool-system/tool-manager.js";
import SkillExecutor from "../../src/main/skill-tool-system/skill-executor.js";
import StatsCleaner from "../../src/main/skill-tool-system/stats-cleaner.js";

describe("技能工具系统集成测试", () => {
  let db;
  let skillManager;
  let toolManager;
  let skillExecutor;
  let statsCleaner;
  let testDbPath;

  beforeAll(async () => {
    // 创建测试数据库
    testDbPath = path.join(__dirname, "test-integration.db");
    db = new Database(testDbPath);

    // 初始化数据库schema
    await initializeDatabase(db);

    // 创建mock FunctionCaller
    const mockFunctionCaller = createMockFunctionCaller();

    // 初始化管理器
    toolManager = new ToolManager(db, mockFunctionCaller);
    skillManager = new SkillManager(db, toolManager);
    skillExecutor = new SkillExecutor(skillManager, toolManager);
    statsCleaner = new StatsCleaner(db, skillManager, toolManager);

    await toolManager.initialize();
    await skillManager.initialize();
  });

  afterAll(async () => {
    // 清理测试数据库
    db.close();
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // 忽略删除错误
    }
  });

  beforeEach(() => {
    // 清理测试数据
    db.exec("DELETE FROM skill_tools");
    db.exec("DELETE FROM skills WHERE is_builtin = 0");
    db.exec("DELETE FROM tools WHERE is_builtin = 0");
    db.exec("DELETE FROM skill_tool_usage_logs");
  });

  describe("技能-工具关联流程", () => {
    it("应该成功创建技能并关联工具", async () => {
      // 1. 注册工具
      const tool = await toolManager.registerTool(
        {
          id: "test_tool_1",
          name: "test_tool_1",
          description: "测试工具1",
          parameters_schema: JSON.stringify({
            type: "object",
            properties: {
              input: { type: "string" },
            },
          }),
          is_builtin: 0,
        },
        async (params) => {
          return { result: "success", input: params.input };
        },
      );

      expect(tool).toBeDefined();
      expect(tool.id).toBe("test_tool_1");

      // 2. 注册技能
      const skill = await skillManager.registerSkill({
        id: "test_skill_1",
        name: "测试技能1",
        category: "test",
        description: "集成测试技能",
        is_builtin: 0,
      });

      expect(skill).toBeDefined();
      expect(skill.id).toBe("test_skill_1");

      // 3. 关联技能和工具
      await skillManager.addToolToSkill(skill.id, tool.id, "primary");

      // 4. 验证关联
      const skillTools = await skillManager.getSkillTools(skill.id);
      expect(skillTools).toHaveLength(1);
      expect(skillTools[0].tool_id).toBe(tool.id);
      expect(skillTools[0].role).toBe("primary");
    });

    it("应该能够移除技能-工具关联", async () => {
      // 准备
      const tool = await toolManager.registerTool(
        {
          id: "test_tool_2",
          name: "test_tool_2",
          description: "测试工具2",
          parameters_schema: JSON.stringify({}),
          is_builtin: 0,
        },
        async () => ({ result: "ok" }),
      );

      const skill = await skillManager.registerSkill({
        id: "test_skill_2",
        name: "测试技能2",
        category: "test",
        is_builtin: 0,
      });

      await skillManager.addToolToSkill(skill.id, tool.id);

      // 执行
      await skillManager.removeToolFromSkill(skill.id, tool.id);

      // 验证
      const skillTools = await skillManager.getSkillTools(skill.id);
      expect(skillTools).toHaveLength(0);
    });

    it("应该支持一个技能关联多个工具", async () => {
      const skill = await skillManager.registerSkill({
        id: "test_skill_multi",
        name: "多工具技能",
        category: "test",
        is_builtin: 0,
      });

      // 注册3个工具
      for (let i = 1; i <= 3; i++) {
        const tool = await toolManager.registerTool(
          {
            id: `multi_tool_${i}`,
            name: `multi_tool_${i}`,
            description: `多工具测试${i}`,
            parameters_schema: JSON.stringify({}),
            is_builtin: 0,
          },
          async () => ({ result: i }),
        );

        await skillManager.addToolToSkill(
          skill.id,
          tool.id,
          i === 1 ? "primary" : "secondary",
        );
      }

      const skillTools = await skillManager.getSkillTools(skill.id);
      expect(skillTools).toHaveLength(3);
      expect(skillTools.find((t) => t.role === "primary")).toBeDefined();
      expect(skillTools.filter((t) => t.role === "secondary")).toHaveLength(2);
    });
  });

  describe("技能执行流程", () => {
    it("应该成功执行包含单个工具的技能", async () => {
      // 准备
      const tool = await toolManager.registerTool(
        {
          id: "exec_tool_1",
          name: "exec_tool_1",
          description: "执行测试工具",
          parameters_schema: JSON.stringify({
            type: "object",
            properties: {
              value: { type: "number" },
            },
          }),
          is_builtin: 0,
        },
        async (params) => {
          return { result: params.value * 2 };
        },
      );

      const skill = await skillManager.registerSkill({
        id: "exec_skill_1",
        name: "执行测试技能",
        category: "test",
        is_builtin: 0,
      });

      await skillManager.addToolToSkill(skill.id, tool.id);

      // 执行
      const result = await skillExecutor.executeSkill(skill.id, { value: 5 });

      // 验证
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].result.result).toBe(10);
    });

    it("应该按优先级顺序执行多个工具", async () => {
      const skill = await skillManager.registerSkill({
        id: "exec_skill_multi",
        name: "多工具执行测试",
        category: "test",
        is_builtin: 0,
      });

      const executionOrder = [];

      // 注册3个工具,优先级不同
      for (let i = 1; i <= 3; i++) {
        const tool = await toolManager.registerTool(
          {
            id: `priority_tool_${i}`,
            name: `priority_tool_${i}`,
            description: `优先级测试${i}`,
            parameters_schema: JSON.stringify({}),
            is_builtin: 0,
          },
          async () => {
            executionOrder.push(i);
            return { executed: i };
          },
        );

        await skillManager.addToolToSkill(skill.id, tool.id, "primary", 4 - i); // 优先级: 3, 2, 1
      }

      // 执行
      await skillExecutor.executeSkill(skill.id, {});

      // 验证执行顺序(应该是3, 2, 1)
      expect(executionOrder).toEqual([3, 2, 1]);
    });

    it("应该记录技能执行统计", async () => {
      const tool = await toolManager.registerTool(
        {
          id: "stats_tool",
          name: "stats_tool",
          description: "统计测试工具",
          parameters_schema: JSON.stringify({}),
          is_builtin: 0,
        },
        async () => ({ result: "ok" }),
      );

      const skill = await skillManager.registerSkill({
        id: "stats_skill",
        name: "统计测试技能",
        category: "test",
        is_builtin: 0,
      });

      await skillManager.addToolToSkill(skill.id, tool.id);

      // 初始统计
      const beforeStats = await skillManager.getSkillById(skill.id);
      expect(beforeStats.usage_count).toBe(0);

      // 执行技能
      await skillExecutor.executeSkill(skill.id, {});

      // 验证统计更新
      const afterStats = await skillManager.getSkillById(skill.id);
      expect(afterStats.usage_count).toBe(1);
      expect(afterStats.success_count).toBe(1);
    });

    it("应该正确处理执行失败的情况", async () => {
      const tool = await toolManager.registerTool(
        {
          id: "fail_tool",
          name: "fail_tool",
          description: "失败测试工具",
          parameters_schema: JSON.stringify({}),
          is_builtin: 0,
        },
        async () => {
          throw new Error("工具执行失败");
        },
      );

      const skill = await skillManager.registerSkill({
        id: "fail_skill",
        name: "失败测试技能",
        category: "test",
        is_builtin: 0,
      });

      await skillManager.addToolToSkill(skill.id, tool.id);

      // 执行(应该失败)
      const result = await skillExecutor.executeSkill(skill.id, {});

      // 验证结果
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("统计数据清理", () => {
    it("应该清理过期的使用日志", async () => {
      // 插入旧的使用日志
      const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31天前
      db.exec(`
        INSERT INTO skill_tool_usage_logs (id, skill_id, tool_id, status, created_at)
        VALUES ('old_log_1', 'skill_1', 'tool_1', 'success', ${oldTimestamp})
      `);

      // 插入新的使用日志
      db.exec(`
        INSERT INTO skill_tool_usage_logs (id, skill_id, tool_id, status, created_at)
        VALUES ('new_log_1', 'skill_1', 'tool_1', 'success', ${Date.now()})
      `);

      // 执行清理
      const cleaned = await statsCleaner.cleanupUsageLogs();

      // 验证
      expect(cleaned).toBeGreaterThan(0);
      const remaining = db
        .prepare("SELECT COUNT(*) as count FROM skill_tool_usage_logs")
        .get();
      expect(remaining.count).toBe(1);
    });

    it("应该汇总每日统计数据", async () => {
      // 创建测试技能
      const skill = await skillManager.registerSkill({
        id: "daily_stats_skill",
        name: "每日统计测试",
        category: "test",
        is_builtin: 0,
      });

      // 插入今天的使用日志
      const today = new Date().toISOString().split("T")[0];
      const todayStart = new Date(today).getTime();

      for (let i = 0; i < 5; i++) {
        db.exec(`
          INSERT INTO skill_tool_usage_logs (id, skill_id, status, execution_time, created_at)
          VALUES ('log_${i}', '${skill.id}', 'success', 100, ${todayStart + i * 1000})
        `);
      }

      // 汇总统计
      await statsCleaner.aggregateDailyStats();

      // 验证
      const stats = db
        .prepare(
          "SELECT * FROM skill_stats WHERE skill_id = ? AND stat_date = ?",
        )
        .get(skill.id, today);

      expect(stats).toBeDefined();
      expect(stats.invoke_count).toBe(5);
      expect(stats.success_count).toBe(5);
    });
  });

  describe("定时任务调度", () => {
    it("应该能够调度定时工作流", async () => {
      const skill = await skillManager.registerSkill({
        id: "scheduled_skill",
        name: "定时任务测试",
        category: "test",
        is_builtin: 0,
      });

      // 调度任务(每分钟执行)
      const taskId = skillExecutor.scheduleWorkflow({
        name: "test-workflow",
        schedule: "* * * * *",
        skillId: skill.id,
        params: {},
        enabled: true,
      });

      expect(taskId).toBeDefined();

      // 验证任务列表
      const workflows = skillExecutor.getScheduledWorkflows();
      expect(workflows).toHaveLength(1);
      expect(workflows[0].name).toBe("test-workflow");

      // 清理
      skillExecutor.stopWorkflow(taskId);
    });

    it("应该能够停止定时任务", async () => {
      const skill = await skillManager.registerSkill({
        id: "stop_test_skill",
        name: "停止任务测试",
        category: "test",
        is_builtin: 0,
      });

      const taskId = skillExecutor.scheduleWorkflow({
        name: "stop-test",
        schedule: "* * * * *",
        skillId: skill.id,
        enabled: true,
      });

      // 停止任务
      skillExecutor.stopWorkflow(taskId);

      // 验证任务已移除
      const workflows = skillExecutor.getScheduledWorkflows();
      expect(workflows).toHaveLength(0);
    });
  });

  describe("插件扩展集成", () => {
    it("应该能够通过插件注册技能和工具", async () => {
      // 模拟插件配置
      const pluginConfig = {
        tools: [
          {
            name: "plugin_tool_1",
            description: "插件工具1",
            parameters: {
              type: "object",
              properties: {
                input: { type: "string" },
              },
            },
          },
        ],
        skills: [
          {
            id: "plugin_skill_1",
            name: "插件技能1",
            description: "来自插件的技能",
            category: "plugin",
            tools: ["plugin_tool_1"],
          },
        ],
      };

      const pluginId = "test_plugin";

      // 注册插件工具
      for (const toolDef of pluginConfig.tools) {
        await toolManager.registerTool(
          {
            id: `${pluginId}_${toolDef.name}`,
            name: toolDef.name,
            description: toolDef.description,
            parameters_schema: JSON.stringify(toolDef.parameters),
            plugin_id: pluginId,
            is_builtin: 0,
            enabled: 1,
          },
          async (params) => ({ result: "plugin_result" }),
        );
      }

      // 注册插件技能
      for (const skillDef of pluginConfig.skills) {
        await skillManager.registerSkill({
          id: `${pluginId}_${skillDef.id}`,
          name: skillDef.name,
          description: skillDef.description,
          category: skillDef.category,
          plugin_id: pluginId,
          is_builtin: 0,
          enabled: 1,
        });

        // 关联工具
        for (const toolName of skillDef.tools || []) {
          await skillManager.addToolToSkill(
            `${pluginId}_${skillDef.id}`,
            `${pluginId}_${toolName}`,
          );
        }
      }

      // 验证
      const skill = await skillManager.getSkillById(
        `${pluginId}_plugin_skill_1`,
      );
      expect(skill).toBeDefined();
      expect(skill.plugin_id).toBe(pluginId);

      const skillTools = await skillManager.getSkillTools(skill.id);
      expect(skillTools).toHaveLength(1);

      const tool = await toolManager.getToolById(`${pluginId}_plugin_tool_1`);
      expect(tool).toBeDefined();
      expect(tool.plugin_id).toBe(pluginId);
    });
  });
});

// 辅助函数
async function initializeDatabase(db) {
  // 创建表(简化版schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      is_builtin INTEGER DEFAULT 0,
      plugin_id TEXT,
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      parameters_schema TEXT,
      enabled INTEGER DEFAULT 1,
      is_builtin INTEGER DEFAULT 0,
      plugin_id TEXT,
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_tools (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      role TEXT DEFAULT 'primary',
      priority INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE (skill_id, tool_id)
    );

    CREATE TABLE IF NOT EXISTS skill_tool_usage_logs (
      id TEXT PRIMARY KEY,
      skill_id TEXT,
      tool_id TEXT,
      status TEXT,
      execution_time REAL,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_stats (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      stat_date TEXT NOT NULL,
      invoke_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      avg_duration REAL DEFAULT 0,
      total_duration REAL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (skill_id, stat_date)
    );

    CREATE TABLE IF NOT EXISTS tool_stats (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL,
      stat_date TEXT NOT NULL,
      invoke_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (tool_id, stat_date)
    );
  `);
}

function createMockFunctionCaller() {
  const tools = new Map();

  return {
    registerTool: (name, handler, metadata) => {
      tools.set(name, { handler, metadata });
    },
    call: async (toolName, params) => {
      const tool = tools.get(toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }
      return await tool.handler(params);
    },
    hasToolRegistered: (name) => tools.has(name),
    getAllTools: () => Array.from(tools.keys()),
  };
}
