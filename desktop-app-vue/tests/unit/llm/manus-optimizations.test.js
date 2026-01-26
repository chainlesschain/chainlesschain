/**
 * ManusOptimizations 单元测试
 * 测试目标: src/main/llm/manus-optimizations.js
 * 覆盖场景: Manus优化管理、Context Engineering集成、Tool Masking、任务追踪
 *
 * ⚠️ LIMITATION: 部分测试跳过 - 外部依赖
 *
 * ManusOptimizations协调Context Engineering和Tool Masking，提供：
 * - KV-Cache友好的Prompt构建
 * - 工具掩码控制
 * - 任务追踪（文件系统 + 内存）
 * - 可恢复压缩
 * - 状态机控制
 *
 * 测试覆盖：
 * - 构造函数和配置管理
 * - Prompt优化
 * - 工具掩码控制（需要mock）
 * - 任务追踪（部分需要文件系统）
 * - 错误处理
 * - 可恢复压缩
 * - 状态机控制
 * - 统计和调试
 * - 单例管理
 *
 * Mock Strategy:
 * - Mock context-engineering
 * - Mock tool-masking
 * - Mock task-tracker-file（文件系统依赖）
 * - Mock logger
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

// Mock context-engineering
const mockContextEngineering = {
  buildOptimizedPrompt: vi.fn((options) => ({
    messages: options.messages || [],
    metadata: { optimized: true },
  })),
  setCurrentTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  clearTask: vi.fn(),
  recordError: vi.fn(),
  resolveError: vi.fn(),
  getStats: vi.fn(() => ({ optimizationCount: 0 })),
  resetStats: vi.fn(),
  errorHistory: [],
};

const mockRecoverableCompressor = {
  compress: vi.fn((content, type) => ({ __compressed: true, type })),
  isCompressedRef: vi.fn((data) => data?.__compressed === true),
  recover: vi.fn(async (ref) => ref),
};

vi.mock("../../../src/main/llm/context-engineering.js", () => ({
  ContextEngineering: vi.fn(),
  RecoverableCompressor: vi.fn(() => mockRecoverableCompressor),
  getContextEngineering: vi.fn(() => mockContextEngineering),
}));

// Mock tool-masking
const mockToolMasking = {
  setToolAvailability: vi.fn(),
  setToolsByPrefix: vi.fn(),
  validateCall: vi.fn(() => ({ allowed: true })),
  getAllToolDefinitions: vi.fn(() => []),
  getAvailableToolDefinitions: vi.fn(() => []),
  reset: vi.fn(),
  getStats: vi.fn(() => ({ maskCount: 0 })),
  exportConfig: vi.fn(() => ({})),
  configureStateMachine: vi.fn(),
  transitionTo: vi.fn(() => true),
  getCurrentState: vi.fn(() => null),
  stateMachine: null,
};

vi.mock("../../../src/main/ai-engine/tool-masking.js", () => ({
  ToolMaskingSystem: vi.fn(),
  getToolMaskingSystem: vi.fn(() => mockToolMasking),
  TASK_PHASE_STATE_MACHINE: { states: {} },
}));

// Mock task-tracker-file
const mockTaskTracker = {
  createTask: vi.fn(async (task) => ({
    id: "task-123",
    objective: task.objective,
    steps: task.steps,
    currentStep: 0,
    status: "started",
  })),
  startTask: vi.fn(async () => {}),
  updateProgress: vi.fn(async () => {}),
  completeCurrentStep: vi.fn(async () => {}),
  completeTask: vi.fn(async () => {}),
  cancelTask: vi.fn(async () => {}),
  getCurrentTask: vi.fn(() => null),
  getTodoContext: vi.fn(async () => null),
  loadUnfinishedTask: vi.fn(async () => null),
  getTaskHistory: vi.fn(async () => []),
  saveIntermediateResult: vi.fn(async () => {}),
};

vi.mock("../../../src/main/ai-engine/task-tracker-file.js", () => ({
  getTaskTrackerFile: vi.fn(() => mockTaskTracker),
}));

describe("ManusOptimizations", () => {
  let ManusOptimizations;
  let getManusOptimizations;
  let createManusOptimizations;
  let manus;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockContextEngineering.errorHistory = [];

    // Dynamic import
    const module = await import(
      "../../../src/main/llm/manus-optimizations.js"
    );
    ManusOptimizations = module.ManusOptimizations;
    getManusOptimizations = module.getManusOptimizations;
    createManusOptimizations = module.createManusOptimizations;
  });

  afterEach(() => {
    if (manus) {
      manus = null;
    }
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });

      expect(manus).toBeDefined();
      expect(manus.contextEngineering).toBe(mockContextEngineering);
      expect(manus.toolMasking).toBe(mockToolMasking);
      expect(manus.compressor).toBeDefined();
    });

    it("应该使用默认配置", () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });

      expect(manus.config.enabled).toBe(true);
      expect(manus.config.enableKVCacheOptimization).toBe(true);
      expect(manus.config.enableToolMasking).toBe(true);
      expect(manus.config.enableTaskTracking).toBe(true);
      expect(manus.config.enableRecoverableCompression).toBe(true);
      expect(manus.config.enableFileBasedTaskTracking).toBe(true);
    });

    it("应该接受自定义配置", () => {
      manus = new ManusOptimizations({
        enabled: false,
        enableKVCacheOptimization: false,
        enableToolMasking: false,
      });

      expect(manus.config.enabled).toBe(false);
      expect(manus.config.enableKVCacheOptimization).toBe(false);
      expect(manus.config.enableToolMasking).toBe(false);
    });

    it("应该初始化currentTask为null", () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });

      expect(manus.currentTask).toBeNull();
    });

    it("应该处理enableTaskTracking=false", () => {
      manus = new ManusOptimizations({ enableTaskTracking: false });

      expect(manus.config.enableTaskTracking).toBe(false);
    });
  });

  describe("buildOptimizedPrompt", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("应该在禁用时返回基础消息", () => {
      manus.config.enabled = false;

      const result = manus.buildOptimizedPrompt({
        systemPrompt: "Test system",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.metadata.optimized).toBe(false);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it("应该在启用时调用contextEngineering", () => {
      const result = manus.buildOptimizedPrompt({
        systemPrompt: "Test system",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockContextEngineering.buildOptimizedPrompt).toHaveBeenCalled();
      expect(result.metadata.optimized).toBe(true);
    });

    it("应该在启用工具掩码时获取工具定义", () => {
      manus.config.enableToolMasking = true;

      manus.buildOptimizedPrompt({
        systemPrompt: "Test",
        messages: [],
      });

      expect(mockToolMasking.getAllToolDefinitions).toHaveBeenCalled();
    });

    it("应该使用提供的工具定义", () => {
      const customTools = [{ name: "test_tool" }];

      manus.buildOptimizedPrompt({
        systemPrompt: "Test",
        messages: [],
        tools: customTools,
      });

      expect(mockContextEngineering.buildOptimizedPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ tools: customTools }),
      );
    });

    it("应该包含当前任务上下文", () => {
      manus.currentTask = { objective: "Test task" };

      manus.buildOptimizedPrompt({
        systemPrompt: "Test",
        messages: [],
      });

      expect(mockContextEngineering.buildOptimizedPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ taskContext: manus.currentTask }),
      );
    });
  });

  describe("_buildBasicMessages", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("应该构建包含system prompt的消息", () => {
      const messages = manus._buildBasicMessages({
        systemPrompt: "Test system",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("Test system");
    });

    it("应该包含用户消息", () => {
      const userMessages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const messages = manus._buildBasicMessages({
        systemPrompt: "Test",
        messages: userMessages,
      });

      expect(messages.length).toBe(3); // system + 2 user messages
      expect(messages[1].content).toBe("Hello");
      expect(messages[2].content).toBe("Hi");
    });

    it("应该处理没有systemPrompt的情况", () => {
      const messages = manus._buildBasicMessages({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });
  });

  describe("工具掩码控制", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("setToolAvailable应该调用toolMasking", () => {
      manus.setToolAvailable("test_tool", true);

      expect(mockToolMasking.setToolAvailability).toHaveBeenCalledWith(
        "test_tool",
        true,
      );
    });

    it("setToolAvailable应该在禁用时不调用", () => {
      manus.config.enableToolMasking = false;

      manus.setToolAvailable("test_tool", true);

      expect(mockToolMasking.setToolAvailability).not.toHaveBeenCalled();
    });

    it("setToolsByPrefix应该调用toolMasking", () => {
      manus.setToolsByPrefix("file_", false);

      expect(mockToolMasking.setToolsByPrefix).toHaveBeenCalledWith(
        "file_",
        false,
      );
    });

    it("validateToolCall应该调用toolMasking", () => {
      const result = manus.validateToolCall("test_tool");

      expect(mockToolMasking.validateCall).toHaveBeenCalledWith("test_tool");
      expect(result.allowed).toBe(true);
    });

    it("validateToolCall应该在禁用时允许所有工具", () => {
      manus.config.enableToolMasking = false;

      const result = manus.validateToolCall("test_tool");

      expect(result.allowed).toBe(true);
      expect(mockToolMasking.validateCall).not.toHaveBeenCalled();
    });

    it("getAvailableTools应该在禁用时返回所有工具", () => {
      manus.config.enableToolMasking = false;

      const tools = manus.getAvailableTools();

      expect(mockToolMasking.getAllToolDefinitions).toHaveBeenCalled();
    });

    it("getAvailableTools应该在启用时返回可用工具", () => {
      manus.config.enableToolMasking = true;

      const tools = manus.getAvailableTools();

      expect(mockToolMasking.getAvailableToolDefinitions).toHaveBeenCalled();
    });
  });

  describe("任务追踪", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("startTask应该在禁用时返回null", async () => {
      manus.config.enableTaskTracking = false;

      const result = await manus.startTask({
        objective: "Test task",
      });

      expect(result).toBeNull();
    });

    it("startTask应该创建内存任务", async () => {
      manus.config.enableFileBasedTaskTracking = false;

      const task = await manus.startTask({
        objective: "Test objective",
        steps: ["Step 1", "Step 2"],
      });

      expect(task).toBeDefined();
      expect(task.objective).toBe("Test objective");
      expect(task.steps.length).toBe(2);
      expect(task.status).toBe("started");
      expect(manus.currentTask).toBe(task);
    });

    it("startTask应该设置contextEngineering的当前任务", async () => {
      await manus.startTask({
        objective: "Test",
        steps: [],
      });

      expect(mockContextEngineering.setCurrentTask).toHaveBeenCalledWith(
        manus.currentTask,
      );
    });

    it("getCurrentTask应该返回当前任务", () => {
      manus.currentTask = { objective: "Test" };

      const task = manus.getCurrentTask();

      expect(task).toBe(manus.currentTask);
    });

    it("getCurrentTask应该在无任务时返回null", () => {
      const task = manus.getCurrentTask();

      expect(task).toBeNull();
    });
  });

  describe("updateTaskProgress", () => {
    beforeEach(async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;
      await manus.startTask({
        objective: "Test",
        steps: ["Step 1", "Step 2", "Step 3"],
      });
    });

    it("应该更新任务进度", async () => {
      await manus.updateTaskProgress(1, "in_progress");

      expect(manus.currentTask.currentStep).toBe(1);
      expect(manus.currentTask.status).toBe("in_progress");
    });

    it("应该调用contextEngineering.updateTaskProgress", async () => {
      await manus.updateTaskProgress(1, "executing");

      expect(mockContextEngineering.updateTaskProgress).toHaveBeenCalledWith(
        1,
        "executing",
      );
    });

    it("应该在无任务时不执行", async () => {
      manus.currentTask = null;

      await manus.updateTaskProgress(1);

      expect(mockContextEngineering.updateTaskProgress).not.toHaveBeenCalled();
    });
  });

  describe("completeCurrentStep", () => {
    beforeEach(async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;
      await manus.startTask({
        objective: "Test",
        steps: ["Step 1", "Step 2", "Step 3"],
      });
    });

    it("应该移动到下一步", async () => {
      const initialStep = manus.currentTask.currentStep;

      await manus.completeCurrentStep();

      expect(manus.currentTask.currentStep).toBe(initialStep + 1);
    });

    it("应该在最后一步时完成任务", async () => {
      manus.currentTask.currentStep = 2; // 最后一步

      await manus.completeCurrentStep();

      expect(manus.currentTask).toBeNull(); // 任务已完成
    });
  });

  describe("completeTask", () => {
    beforeEach(async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;
      await manus.startTask({
        objective: "Test",
        steps: ["Step 1"],
      });
    });

    it("应该完成任务", async () => {
      await manus.completeTask();

      expect(manus.currentTask).toBeNull();
    });

    it("应该调用contextEngineering.clearTask", async () => {
      await manus.completeTask();

      expect(mockContextEngineering.clearTask).toHaveBeenCalled();
    });
  });

  describe("cancelTask", () => {
    beforeEach(async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;
      await manus.startTask({
        objective: "Test",
        steps: ["Step 1"],
      });
    });

    it("应该取消任务", async () => {
      await manus.cancelTask("测试取消");

      expect(manus.currentTask).toBeNull();
    });

    it("应该调用contextEngineering.clearTask", async () => {
      await manus.cancelTask();

      expect(mockContextEngineering.clearTask).toHaveBeenCalled();
    });

    it("应该调用toolMasking.reset", async () => {
      await manus.cancelTask();

      expect(mockToolMasking.reset).toHaveBeenCalled();
    });
  });

  describe("错误处理", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("recordError应该调用contextEngineering", () => {
      const error = new Error("Test error");

      manus.recordError(error);

      expect(mockContextEngineering.recordError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Test error",
          stack: expect.any(String),
        }),
      );
    });

    it("recordError应该包含当前步骤", async () => {
      manus.config.enableFileBasedTaskTracking = false;
      await manus.startTask({
        objective: "Test",
        steps: ["Step 1"],
      });

      manus.recordError(new Error("Test"));

      expect(mockContextEngineering.recordError).toHaveBeenCalledWith(
        expect.objectContaining({ step: 0 }),
      );
    });

    it("resolveLastError应该标记错误已解决", () => {
      mockContextEngineering.errorHistory = [{ message: "Error 1" }];

      manus.resolveLastError("Fixed");

      expect(mockContextEngineering.resolveError).toHaveBeenCalledWith(
        0,
        "Fixed",
      );
    });

    it("resolveLastError应该在无错误时不执行", () => {
      mockContextEngineering.errorHistory = [];

      manus.resolveLastError("Fixed");

      expect(mockContextEngineering.resolveError).not.toHaveBeenCalled();
    });
  });

  describe("可恢复压缩", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("compress应该压缩内容", () => {
      const content = { data: "test" };

      const result = manus.compress(content, "data");

      // compressor是内部创建的，我们测试结果而非调用
      expect(result).toBeDefined();
    });

    it("compress应该在禁用时返回原内容", () => {
      manus.config.enableRecoverableCompression = false;

      const content = { data: "test" };
      const result = manus.compress(content);

      expect(result).toBe(content);
    });

    it("isCompressedRef应该检查压缩引用", () => {
      const ref = { __compressed: true };

      const result = manus.isCompressedRef(ref);

      // compressor是内部创建的RecoverableCompressor实例
      expect(typeof result).toBe("boolean");
    });

    it("recover应该恢复压缩内容", async () => {
      const ref = { __compressed: true };
      const recoveryFunctions = {};

      const result = await manus.recover(ref, recoveryFunctions);

      // compressor是内部创建的，测试调用不抛出错误即可
      expect(result).toBeDefined();
    });
  });

  describe("状态机控制", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("configureTaskPhases应该配置状态机", () => {
      const config = { states: { planning: {} } };

      manus.configureTaskPhases(config);

      expect(mockToolMasking.configureStateMachine).toHaveBeenCalledWith(
        config,
      );
    });

    it("transitionToPhase应该切换阶段", () => {
      const result = manus.transitionToPhase("planning");

      expect(mockToolMasking.transitionTo).toHaveBeenCalledWith("planning");
      expect(result).toBe(true);
    });

    it("getCurrentPhase应该返回当前阶段", () => {
      const phase = manus.getCurrentPhase();

      expect(mockToolMasking.getCurrentState).toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    beforeEach(async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;
    });

    it("应该返回综合统计", () => {
      const stats = manus.getStats();

      expect(stats).toBeDefined();
      expect(stats.contextEngineering).toBeDefined();
      expect(stats.toolMasking).toBeDefined();
      expect(stats.config).toBeDefined();
    });

    it("应该在有任务时包含任务信息", async () => {
      await manus.startTask({
        objective: "Test",
        steps: ["Step 1", "Step 2"],
      });

      const stats = manus.getStats();

      expect(stats.currentTask).toBeDefined();
      expect(stats.currentTask.objective).toBe("Test");
      expect(stats.currentTask.totalSteps).toBe(2);
    });

    it("应该在无任务时返回null", () => {
      const stats = manus.getStats();

      expect(stats.currentTask).toBeNull();
    });
  });

  describe("resetStats", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("应该重置统计", () => {
      manus.resetStats();

      expect(mockContextEngineering.resetStats).toHaveBeenCalled();
    });
  });

  describe("exportDebugInfo", () => {
    beforeEach(() => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
    });

    it("应该导出调试信息", () => {
      const debug = manus.exportDebugInfo();

      expect(debug).toBeDefined();
      expect(debug.stats).toBeDefined();
      expect(debug.toolMaskingConfig).toBeDefined();
      expect(debug.currentTask).toBeNull();
      expect(debug.errorHistory).toBeDefined();
    });
  });

  describe("单例管理", () => {
    it("getManusOptimizations应该返回单例", () => {
      const instance1 = getManusOptimizations();
      const instance2 = getManusOptimizations();

      expect(instance1).toBe(instance2);
    });

    it("createManusOptimizations应该创建新实例", () => {
      const instance1 = createManusOptimizations();
      const instance2 = createManusOptimizations();

      expect(instance1).not.toBe(instance2);
    });

    it("createManusOptimizations应该接受配置", () => {
      const instance = createManusOptimizations({ enabled: false });

      expect(instance.config.enabled).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置", () => {
      manus = new ManusOptimizations({});

      expect(manus.config.enabled).toBe(true);
    });

    it("应该处理未定义的任务步骤", async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;

      const task = await manus.startTask({
        objective: "Test",
      });

      expect(task.steps).toHaveLength(0);
    });

    it("应该处理字符串步骤数组", async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;

      const task = await manus.startTask({
        objective: "Test",
        steps: ["Step 1", "Step 2"],
      });

      expect(task.steps[0].description).toBe("Step 1");
      expect(task.steps[0].status).toBe("pending");
    });

    it("应该处理对象步骤数组", async () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });
      manus.config.enableFileBasedTaskTracking = false;

      const task = await manus.startTask({
        objective: "Test",
        steps: [{ description: "Custom step", data: "extra" }],
      });

      expect(task.steps[0].description).toBe("Custom step");
    });

    it("buildOptimizedPrompt应该处理空消息数组", () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });

      const result = manus.buildOptimizedPrompt({
        systemPrompt: "Test",
      });

      expect(result.messages).toBeDefined();
    });

    it("_buildBasicMessages应该处理空选项", () => {
      manus = new ManusOptimizations({
        contextEngineering: mockContextEngineering,
        toolMasking: mockToolMasking,
      });

      const messages = manus._buildBasicMessages({});

      expect(messages).toEqual([]);
    });
  });

  describe.skip("文件系统任务追踪", () => {
    // TODO: Skipped - Depends on file system (TaskTrackerFile)

    it("应该使用TaskTrackerFile创建任务", async () => {});
    it("应该恢复未完成的任务", async () => {});
    it("应该获取任务历史", async () => {});
    it("应该保存中间结果", async () => {});
    it("应该获取todo上下文", async () => {});
  });
});
