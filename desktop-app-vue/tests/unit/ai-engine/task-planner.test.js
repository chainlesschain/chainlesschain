/**
 * TaskPlanner 单元测试
 * 测试AI任务智能拆解系统的所有功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("TaskPlanner", () => {
  let TaskPlanner;
  let getTaskPlanner;
  let taskPlanner;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import("../../../src/main/ai-engine/task-planner.js");
    TaskPlanner = module.TaskPlanner;
    getTaskPlanner = module.getTaskPlanner;

    taskPlanner = new TaskPlanner();
  });

  describe("初始化", () => {
    it("应该创建TaskPlanner实例", () => {
      expect(taskPlanner.initialized).toBe(false);
      expect(taskPlanner.llmService).toBeNull();
      expect(taskPlanner.ragManager).toBeNull();
    });
  });

  describe("工具推荐 - recommendTool", () => {
    it("应该推荐web-engine用于网页任务", () => {
      expect(taskPlanner.recommendTool("创建一个网页")).toBe("web-engine");
      expect(taskPlanner.recommendTool("生成HTML页面")).toBe("web-engine");
      expect(taskPlanner.recommendTool("build a website")).toBe("web-engine");
    });

    it("应该推荐ppt-engine用于演示文稿", () => {
      expect(taskPlanner.recommendTool("制作PPT")).toBe("ppt-engine");
      expect(taskPlanner.recommendTool("创建演示文稿")).toBe("ppt-engine");
      expect(taskPlanner.recommendTool("生成幻灯片")).toBe("ppt-engine");
    });

    it("应该推荐data-engine用于数据分析", () => {
      expect(taskPlanner.recommendTool("Excel数据分析")).toBe("data-engine");
      expect(taskPlanner.recommendTool("生成表格")).toBe("data-engine");
      expect(taskPlanner.recommendTool("创建数据图表")).toBe("data-engine");
    });

    it("应该推荐document-engine用于文档", () => {
      expect(taskPlanner.recommendTool("生成Word文档")).toBe("document-engine");
      expect(taskPlanner.recommendTool("创建PDF报告")).toBe("document-engine");
      expect(taskPlanner.recommendTool("撰写文档")).toBe("document-engine");
    });

    it("应该推荐code-engine用于代码", () => {
      expect(taskPlanner.recommendTool("写一个function")).toBe("code-engine");
      expect(taskPlanner.recommendTool("生成程序代码")).toBe("code-engine");
      expect(taskPlanner.recommendTool("create a class")).toBe("code-engine");
    });

    it("应该推荐image-engine用于图像", () => {
      expect(taskPlanner.recommendTool("设计logo")).toBe("image-engine");
      expect(taskPlanner.recommendTool("生成图片")).toBe("image-engine");
      expect(taskPlanner.recommendTool("图像设计")).toBe("image-engine");
    });

    it("应该推荐video-engine用于视频", () => {
      expect(taskPlanner.recommendTool("制作视频")).toBe("video-engine");
      expect(taskPlanner.recommendTool("video editing")).toBe("video-engine");
    });

    it("应该默认推荐code-engine", () => {
      expect(taskPlanner.recommendTool("做一些其他事情")).toBe("code-engine");
    });
  });

  describe("复杂度评估 - assessComplexity", () => {
    it("应该评估简单任务", () => {
      const result = taskPlanner.assessComplexity("短任务");

      expect(result.complexity).toBe("simple");
      expect(result.estimatedTokens).toBe(1000);
      expect(result.estimatedDuration).toBe(20); // 1000/50 = 20
    });

    it("应该评估中等复杂度任务", () => {
      const mediumTask = "这是一个中等长度的任务描述".repeat(10);
      const result = taskPlanner.assessComplexity(mediumTask);

      expect(result.complexity).toBe("medium");
      expect(result.estimatedTokens).toBe(2000);
      expect(result.estimatedDuration).toBe(40); // 2000/50 = 40
    });

    it("应该评估复杂任务", () => {
      const complexTask = "这是一个很长的任务描述，包含了很多细节和要求".repeat(20);
      const result = taskPlanner.assessComplexity(complexTask);

      expect(result.complexity).toBe("complex");
      expect(result.estimatedTokens).toBe(4000);
      expect(result.estimatedDuration).toBe(80); // 4000/50 = 80
    });
  });

  describe("获取任务类型 - getTaskTypeFromTool", () => {
    it("应该将web-engine映射为web", () => {
      expect(taskPlanner.getTaskTypeFromTool("web-engine")).toBe("web");
    });

    it("应该将document-engine映射为document", () => {
      expect(taskPlanner.getTaskTypeFromTool("document-engine")).toBe("document");
    });

    it("应该将data-engine映射为data", () => {
      expect(taskPlanner.getTaskTypeFromTool("data-engine")).toBe("data");
    });

    it("应该将ppt-engine映射为ppt", () => {
      expect(taskPlanner.getTaskTypeFromTool("ppt-engine")).toBe("ppt");
    });

    it("应该将code-engine映射为code", () => {
      expect(taskPlanner.getTaskTypeFromTool("code-engine")).toBe("code");
    });

    it("应该将image-engine映射为image", () => {
      expect(taskPlanner.getTaskTypeFromTool("image-engine")).toBe("image");
    });

    it("应该将video-engine映射为video", () => {
      expect(taskPlanner.getTaskTypeFromTool("video-engine")).toBe("video");
    });

    it("应该为未知工具返回mixed", () => {
      expect(taskPlanner.getTaskTypeFromTool("unknown-engine")).toBe("mixed");
    });
  });

  describe("快速拆解 - quickDecompose", () => {
    it("应该生成基本的任务计划", () => {
      const userRequest = "创建一个网页";
      const projectContext = {
        projectId: "proj_123",
        projectName: "测试项目",
      };

      const result = taskPlanner.quickDecompose(userRequest, projectContext);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("task_title");
      expect(result).toHaveProperty("task_type");
      expect(result).toHaveProperty("estimated_duration");
      expect(result).toHaveProperty("status", "pending");
      expect(result).toHaveProperty("progress_percentage", 0);
      expect(result).toHaveProperty("current_step", 0);
      expect(result).toHaveProperty("total_steps", 1);
      expect(result).toHaveProperty("project_id", "proj_123");
      expect(result).toHaveProperty("project_name", "测试项目");
      expect(result.subtasks).toHaveLength(1);
    });

    it("应该为网页任务推荐web-engine", () => {
      const result = taskPlanner.quickDecompose("创建HTML页面", { projectId: "p1" });

      expect(result.subtasks[0].tool).toBe("web-engine");
      expect(result.task_type).toBe("web");
    });

    it("应该截断超长的任务标题", () => {
      const longRequest = "这是一个非常非常长的任务描述".repeat(10);
      const result = taskPlanner.quickDecompose(longRequest, { projectId: "p1" });

      expect(result.task_title).toHaveLength(53); // 50 + '...'
      expect(result.task_title).toMatch(/\.\.\.$/);
    });

    it("应该包含所有必需的子任务字段", () => {
      const result = taskPlanner.quickDecompose("测试任务", { projectId: "p1" });
      const subtask = result.subtasks[0];

      expect(subtask).toHaveProperty("id");
      expect(subtask).toHaveProperty("step", 1);
      expect(subtask).toHaveProperty("title");
      expect(subtask).toHaveProperty("description");
      expect(subtask).toHaveProperty("tool");
      expect(subtask).toHaveProperty("estimated_tokens");
      expect(subtask).toHaveProperty("dependencies");
      expect(subtask).toHaveProperty("output_files");
      expect(subtask).toHaveProperty("status", "pending");
      expect(subtask).toHaveProperty("started_at", null);
      expect(subtask).toHaveProperty("completed_at", null);
      expect(subtask).toHaveProperty("result", null);
      expect(subtask).toHaveProperty("error", null);
      expect(subtask).toHaveProperty("command", null);
    });
  });

  describe("验证和增强计划 - validateAndEnhancePlan", () => {
    it("应该为计划添加必需的字段", () => {
      const basicPlan = {
        task_title: "测试任务",
        task_type: "web",
        estimated_duration: 20,
        subtasks: [
          {
            title: "子任务1",
            description: "描述",
            tool: "web-engine",
          },
        ],
        final_deliverables: ["index.html"],
      };

      const projectContext = {
        projectId: "proj_123",
        projectName: "测试项目",
      };

      const result = taskPlanner.validateAndEnhancePlan(basicPlan, projectContext);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("status", "pending");
      expect(result).toHaveProperty("progress_percentage", 0);
      expect(result).toHaveProperty("current_step", 0);
      expect(result).toHaveProperty("total_steps", 1);
      expect(result).toHaveProperty("created_at");
      expect(result).toHaveProperty("started_at", null);
      expect(result).toHaveProperty("completed_at", null);
      expect(result).toHaveProperty("project_id", "proj_123");
      expect(result).toHaveProperty("project_name", "测试项目");
    });

    it("应该为每个子任务添加ID和状态", () => {
      const plan = {
        task_title: "测试",
        subtasks: [
          { title: "子任务1" },
          { title: "子任务2" },
        ],
      };

      const result = taskPlanner.validateAndEnhancePlan(plan, { projectId: "p1" });

      expect(result.subtasks).toHaveLength(2);
      result.subtasks.forEach((subtask, index) => {
        expect(subtask).toHaveProperty("id");
        expect(subtask).toHaveProperty("step", index + 1);
        expect(subtask).toHaveProperty("status", "pending");
        expect(subtask).toHaveProperty("started_at", null);
        expect(subtask).toHaveProperty("completed_at", null);
        expect(subtask).toHaveProperty("result", null);
        expect(subtask).toHaveProperty("error", null);
        expect(subtask).toHaveProperty("command", null);
      });
    });

    it("应该使用默认值填充缺失的task_title", () => {
      const plan = {
        subtasks: [{ title: "子任务" }],
      };

      const result = taskPlanner.validateAndEnhancePlan(plan, { projectId: "p1" });

      expect(result.task_title).toBe("未命名任务");
    });

    it("应该使用默认值填充缺失的task_type", () => {
      const plan = {
        task_title: "测试",
        subtasks: [{ title: "子任务" }],
      };

      const result = taskPlanner.validateAndEnhancePlan(plan, { projectId: "p1" });

      expect(result.task_type).toBe("mixed");
    });

    it("应该在没有子任务时抛出错误", () => {
      const plan = {
        task_title: "测试",
      };

      expect(() => {
        taskPlanner.validateAndEnhancePlan(plan, { projectId: "p1" });
      }).toThrow("任务计划必须包含至少一个子任务");
    });

    it("应该在子任务为空数组时抛出错误", () => {
      const plan = {
        task_title: "测试",
        subtasks: [],
      };

      expect(() => {
        taskPlanner.validateAndEnhancePlan(plan, { projectId: "p1" });
      }).toThrow("任务计划必须包含至少一个子任务");
    });
  });

  describe("系统提示词 - getSystemPrompt", () => {
    it("应该返回包含核心能力的提示词", () => {
      const prompt = taskPlanner.getSystemPrompt();

      expect(prompt).toContain("核心能力");
      expect(prompt).toContain("理解用户意图");
      expect(prompt).toContain("拆解");
    });

    it("应该列出所有可用工具引擎", () => {
      const prompt = taskPlanner.getSystemPrompt();

      expect(prompt).toContain("web-engine");
      expect(prompt).toContain("document-engine");
      expect(prompt).toContain("data-engine");
      expect(prompt).toContain("ppt-engine");
      expect(prompt).toContain("code-engine");
      expect(prompt).toContain("image-engine");
      expect(prompt).toContain("video-engine");
    });

    it("应该包含JSON格式要求", () => {
      const prompt = taskPlanner.getSystemPrompt();

      expect(prompt).toContain("JSON");
      expect(prompt).toContain("task_title");
      expect(prompt).toContain("subtasks");
      expect(prompt).toContain("final_deliverables");
    });
  });

  describe("单例模式 - getTaskPlanner", () => {
    it("应该返回同一个实例", () => {
      const instance1 = getTaskPlanner();
      const instance2 = getTaskPlanner();

      expect(instance1).toBe(instance2);
    });

    it("应该返回TaskPlanner的实例", () => {
      const instance = getTaskPlanner();

      expect(instance).toBeInstanceOf(TaskPlanner);
    });
  });

  describe("边界情况", () => {
    it("应该处理空的项目上下文", () => {
      const result = taskPlanner.quickDecompose("测试", {});

      expect(result.project_id).toBeUndefined();
      expect(result.project_name).toBeUndefined();
    });
  });

  describe("提示词构建 - buildDecompositionPrompt", () => {
    it("应该包含用户需求", () => {
      const prompt = taskPlanner.buildDecompositionPrompt(
        "创建网页",
        { type: "web" },
        ""
      );

      expect(prompt).toContain("用户需求");
      expect(prompt).toContain("创建网页");
    });

    it("应该包含项目信息", () => {
      const prompt = taskPlanner.buildDecompositionPrompt(
        "创建网页",
        { type: "web", description: "测试项目" },
        ""
      );

      expect(prompt).toContain("项目信息");
      expect(prompt).toContain("web");
      expect(prompt).toContain("测试项目");
    });

    it("应该包含RAG增强的上下文", () => {
      const enhancedContext = "\n\n## 相关知识:\n1. 示例知识";
      const prompt = taskPlanner.buildDecompositionPrompt(
        "创建网页",
        { type: "web" },
        enhancedContext
      );

      expect(prompt).toContain("相关知识");
      expect(prompt).toContain("示例知识");
    });

    it("应该包含任务要求", () => {
      const prompt = taskPlanner.buildDecompositionPrompt(
        "创建网页",
        { type: "web" },
        ""
      );

      expect(prompt).toContain("任务要求");
      expect(prompt).toContain("JSON");
    });
  });

  describe("ID生成", () => {
    it("应该为每个计划生成唯一ID", () => {
      const plan1 = taskPlanner.quickDecompose("测试1", { projectId: "p1" });
      const plan2 = taskPlanner.quickDecompose("测试2", { projectId: "p1" });

      expect(plan1.id).not.toBe(plan2.id);
      expect(plan1.id).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it("应该为每个子任务生成唯一ID", () => {
      const plan = {
        task_title: "测试",
        subtasks: [
          { title: "子任务1" },
          { title: "子任务2" },
        ],
      };

      const result = taskPlanner.validateAndEnhancePlan(plan, { projectId: "p1" });

      expect(result.subtasks[0].id).not.toBe(result.subtasks[1].id);
      expect(result.subtasks[0].id).toMatch(/^subtask_\d+_\d+$/);
    });
  });
});
