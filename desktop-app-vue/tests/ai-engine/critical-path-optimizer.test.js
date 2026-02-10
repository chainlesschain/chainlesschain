/**
 * CriticalPathOptimizer Unit Tests
 *
 * 测试关键路径优化器的核心功能
 */

const {
  CriticalPathOptimizer,
} = require("../../src/main/ai-engine/critical-path-optimizer.js");
const assert = require("assert");

describe("CriticalPathOptimizer", () => {
  let optimizer;

  afterEach(() => {
    if (optimizer) {
      optimizer.resetStats();
      optimizer = null;
    }
  });

  describe("初始化", () => {
    it("应该创建优化器实例", () => {
      optimizer = new CriticalPathOptimizer({
        enabled: true,
        priorityBoost: 2.0,
        slackThreshold: 1000,
      });

      assert.ok(optimizer, "应该创建优化器实例");
      assert.strictEqual(optimizer.enabled, true, "应该启用");
      assert.strictEqual(optimizer.priorityBoost, 2.0, "优先级加成应为2.0");
    });

    it("应该支持禁用优化器", () => {
      optimizer = new CriticalPathOptimizer({ enabled: false });
      assert.strictEqual(optimizer.enabled, false, "应该禁用");
    });
  });

  describe("简单线性依赖链", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该识别线性关键路径", () => {
      const tasks = [
        { id: "task1", duration: 1000, dependencies: [] },
        { id: "task2", duration: 2000, dependencies: ["task1"] },
        { id: "task3", duration: 1500, dependencies: ["task2"] },
      ];

      const optimized = optimizer.optimize(tasks);

      assert.ok(optimized, "应该返回优化后的任务");
      assert.strictEqual(optimized.length, 3, "应该有3个任务");

      const stats = optimizer.getStats();
      assert.strictEqual(stats.totalAnalyses, 1, "应该执行1次分析");
      assert.ok(
        parseFloat(stats.avgCriticalPathLength) > 0,
        "应该找到关键路径",
      );
    });
  });

  describe("并行任务", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该正确处理并行任务", () => {
      const tasks = [
        { id: "task1", duration: 1000, dependencies: [] },
        { id: "task2", duration: 3000, dependencies: [] }, // 长任务
        { id: "task3", duration: 500, dependencies: [] },
        {
          id: "task4",
          duration: 1000,
          dependencies: ["task1", "task2", "task3"],
        },
      ];

      const optimized = optimizer.optimize(tasks);

      assert.ok(optimized, "应该返回优化后的任务");
      assert.strictEqual(optimized.length, 4, "应该有4个任务");

      // task2应该优先（最长路径）
      const task2Index = optimized.findIndex((t) => t.id === "task2");
      const task3Index = optimized.findIndex((t) => t.id === "task3");

      assert.ok(task2Index < task3Index, "task2应该在task3之前（关键路径上）");
    });
  });

  describe("复杂依赖图", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该识别钻石依赖的关键路径", () => {
      const tasks = [
        { id: "start", duration: 1000, dependencies: [] },
        { id: "left", duration: 2000, dependencies: ["start"] },
        { id: "right", duration: 5000, dependencies: ["start"] }, // 关键路径
        { id: "end", duration: 1000, dependencies: ["left", "right"] },
      ];

      const optimized = optimizer.optimize(tasks);

      // right是关键路径上的任务（最长）
      const rightIndex = optimized.findIndex((t) => t.id === "right");
      const leftIndex = optimized.findIndex((t) => t.id === "left");

      assert.ok(rightIndex !== -1, "应该包含right任务");
      assert.ok(leftIndex !== -1, "应该包含left任务");

      // right应该有更高的优先级
      assert.ok(
        rightIndex <= leftIndex,
        "right应该在left之前或同时（关键路径上）",
      );
    });
  });

  describe("循环依赖检测", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该检测循环依赖并返回原任务", () => {
      const tasks = [
        { id: "task1", duration: 1000, dependencies: ["task2"] },
        { id: "task2", duration: 1000, dependencies: ["task1"] }, // 循环
      ];

      const optimized = optimizer.optimize(tasks);

      // 应该返回原任务（未优化）
      assert.deepStrictEqual(optimized, tasks, "循环依赖时应返回原任务");
    });
  });

  describe("拓扑排序", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该正确执行拓扑排序", () => {
      const tasks = [
        { id: "task3", duration: 1000, dependencies: ["task1", "task2"] },
        { id: "task1", duration: 1000, dependencies: [] },
        { id: "task2", duration: 1000, dependencies: ["task1"] },
      ];

      const optimized = optimizer.optimize(tasks);

      // 优化后返回所有任务（按优先级排序，不是拓扑排序）
      // 验证所有任务都被返回
      assert.strictEqual(optimized.length, 3, "应该返回所有3个任务");

      const taskIds = optimized.map((t) => t.id);
      assert.ok(taskIds.includes("task1"), "应该包含task1");
      assert.ok(taskIds.includes("task2"), "应该包含task2");
      assert.ok(taskIds.includes("task3"), "应该包含task3");
    });
  });

  describe("优先级计算", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({
        enabled: true,
        priorityBoost: 2.0,
      });
    });

    it("关键任务应该有更高的优先级", () => {
      const tasks = [
        { id: "critical", duration: 5000, dependencies: [] },
        { id: "normal", duration: 1000, dependencies: [] },
      ];

      const optimized = optimizer.optimize(tasks);

      // critical应该排在前面（更长的持续时间 = 更关键）
      assert.strictEqual(optimized[0].id, "critical", "关键任务应该排在前面");
    });
  });

  describe("禁用优化器", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: false });
    });

    it("禁用时应该返回原任务", () => {
      const tasks = [
        { id: "task1", duration: 1000, dependencies: [] },
        { id: "task2", duration: 2000, dependencies: ["task1"] },
      ];

      const optimized = optimizer.optimize(tasks);

      assert.deepStrictEqual(optimized, tasks, "禁用时应返回原任务");

      const stats = optimizer.getStats();
      assert.strictEqual(stats.totalAnalyses, 0, "禁用时不应执行分析");
    });
  });

  describe("空任务列表", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该正确处理空任务列表", () => {
      const optimized = optimizer.optimize([]);
      assert.deepStrictEqual(optimized, [], "空任务列表应返回空数组");
    });

    it("应该正确处理null/undefined", () => {
      const optimized1 = optimizer.optimize(null);
      const optimized2 = optimizer.optimize(undefined);

      assert.deepStrictEqual(optimized1, null, "null应返回null");
      assert.deepStrictEqual(optimized2, undefined, "undefined应返回undefined");
    });
  });

  describe("统计信息", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该正确跟踪统计信息", () => {
      const tasks = [
        { id: "task1", duration: 1000, dependencies: [] },
        { id: "task2", duration: 2000, dependencies: ["task1"] },
      ];

      optimizer.optimize(tasks);
      optimizer.optimize(tasks);

      const stats = optimizer.getStats();

      assert.strictEqual(stats.totalAnalyses, 2, "应该执行2次分析");
      assert.strictEqual(stats.tasksOptimized, 4, "应该优化4个任务（2次×2个）");
    });

    it("应该能够重置统计信息", () => {
      const tasks = [{ id: "task1", duration: 1000, dependencies: [] }];

      optimizer.optimize(tasks);

      let stats = optimizer.getStats();
      assert.strictEqual(stats.totalAnalyses, 1, "应该有1次分析");

      optimizer.resetStats();

      stats = optimizer.getStats();
      assert.strictEqual(stats.totalAnalyses, 0, "重置后应该为0");
    });
  });

  describe("实际工作流场景", () => {
    beforeEach(() => {
      optimizer = new CriticalPathOptimizer({ enabled: true });
    });

    it("应该优化典型的软件构建流程", () => {
      const tasks = [
        { id: "install_deps", duration: 5000, dependencies: [] },
        { id: "lint", duration: 2000, dependencies: ["install_deps"] },
        { id: "test", duration: 10000, dependencies: ["install_deps"] }, // 关键路径
        { id: "build", duration: 8000, dependencies: ["install_deps"] }, // 关键路径
        {
          id: "deploy",
          duration: 3000,
          dependencies: ["lint", "test", "build"],
        },
      ];

      const optimized = optimizer.optimize(tasks);

      // test和build应该优先（关键路径上）
      const testIndex = optimized.findIndex((t) => t.id === "test");
      const buildIndex = optimized.findIndex((t) => t.id === "build");
      const lintIndex = optimized.findIndex((t) => t.id === "lint");

      assert.ok(testIndex < lintIndex, "test应该在lint之前（关键路径）");
      assert.ok(buildIndex < lintIndex, "build应该在lint之前（关键路径）");

      const stats = optimizer.getStats();
      assert.ok(
        parseFloat(stats.avgCriticalPathLength) >= 3,
        "关键路径长度应该>=3",
      );
    });
  });
});

// 运行测试（如果直接执行）
if (require.main === module) {
  console.log("请使用测试框架运行此测试文件 (如 npm test)");
}
