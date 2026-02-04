/**
 * TaskExecutor 单元测试
 * 测试任务并行执行器的所有功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("TaskExecutor", () => {
  let TaskExecutor, TaskStatus, TaskNode, EXECUTOR_CONFIG;
  let executor;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import("../../../src/main/ai-engine/task-executor.js");
    TaskExecutor = module.TaskExecutor;
    TaskStatus = module.TaskStatus;
    TaskNode = module.TaskNode;
    EXECUTOR_CONFIG = module.EXECUTOR_CONFIG;

    executor = new TaskExecutor();
  });

  describe("TaskNode - 任务节点", () => {
    it("应该创建任务节点", () => {
      const task = { id: "test-1", priority: 5, dependencies: ["dep-1"] };
      const node = new TaskNode(task);

      expect(node.id).toBe("test-1");
      expect(node.task).toEqual(task);
      expect(node.status).toBe(TaskStatus.PENDING);
      expect(node.dependencies).toEqual(["dep-1"]);
      expect(node.dependents).toEqual([]);
      expect(node.priority).toBe(5);
      expect(node.retries).toBe(0);
      expect(node.startTime).toBeNull();
      expect(node.endTime).toBeNull();
      expect(node.result).toBeNull();
      expect(node.error).toBeNull();
    });

    it("应该自动生成ID", () => {
      const task = { priority: 1 };
      const node = new TaskNode(task);

      expect(node.id).toMatch(/^task-\d+-[a-z0-9]+$/);
    });

    it("应该使用默认值", () => {
      const task = {};
      const node = new TaskNode(task);

      expect(node.dependencies).toEqual([]);
      expect(node.priority).toBe(0);
      expect(node.maxRetries).toBe(EXECUTOR_CONFIG.MAX_RETRIES);
    });

    it("应该检查是否可执行", () => {
      const task = { id: "test-1", dependencies: ["dep-1", "dep-2"] };
      const node = new TaskNode(task);

      const completedTasks = new Set();
      expect(node.isReady(completedTasks)).toBe(false);

      completedTasks.add("dep-1");
      expect(node.isReady(completedTasks)).toBe(false);

      completedTasks.add("dep-2");
      expect(node.isReady(completedTasks)).toBe(true);
    });

    it("应该正确标记状态", () => {
      const node = new TaskNode({ id: "test-1" });

      node.markReady();
      expect(node.status).toBe(TaskStatus.READY);

      node.markRunning();
      expect(node.status).toBe(TaskStatus.RUNNING);
      expect(node.startTime).toBeTruthy();

      const result = { data: "success" };
      node.markCompleted(result);
      expect(node.status).toBe(TaskStatus.COMPLETED);
      expect(node.result).toEqual(result);
      expect(node.endTime).toBeTruthy();
    });

    it("应该标记失败", () => {
      const node = new TaskNode({ id: "test-1" });
      node.markRunning();

      const error = new Error("Task failed");
      node.markFailed(error);

      expect(node.status).toBe(TaskStatus.FAILED);
      expect(node.error).toEqual(error);
      expect(node.endTime).toBeTruthy();
    });

    it("应该计算执行时长", () => {
      const node = new TaskNode({ id: "test-1" });

      expect(node.getDuration()).toBeNull();

      node.startTime = 1000;
      node.endTime = 1500;

      expect(node.getDuration()).toBe(500);
    });
  });

  describe("TaskExecutor - 初始化", () => {
    it("应该使用默认配置创建", () => {
      expect(executor.config.MAX_CONCURRENCY).toBe(
        EXECUTOR_CONFIG.MAX_CONCURRENCY,
      );
      expect(executor.config.TASK_TIMEOUT).toBe(EXECUTOR_CONFIG.TASK_TIMEOUT);
      expect(executor.config.MAX_RETRIES).toBe(EXECUTOR_CONFIG.MAX_RETRIES);
      expect(executor.taskGraph).toBeInstanceOf(Map);
      expect(executor.completedTasks).toBeInstanceOf(Set);
      expect(executor.runningTasks).toBeInstanceOf(Set);
      expect(executor.failedTasks).toBeInstanceOf(Set);
    });

    it("应该支持自定义配置", () => {
      const customExecutor = new TaskExecutor({
        MAX_CONCURRENCY: 5,
        TASK_TIMEOUT: 10000,
      });

      expect(customExecutor.config.MAX_CONCURRENCY).toBe(5);
      expect(customExecutor.config.TASK_TIMEOUT).toBe(10000);
    });

    it("应该初始化统计信息", () => {
      expect(executor.stats).toEqual({
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        totalDuration: 0,
      });
    });
  });

  describe("addTask - 添加任务", () => {
    it("应该添加单个任务", () => {
      const task = { id: "task-1", priority: 5 };
      const taskId = executor.addTask(task);

      expect(taskId).toBe("task-1");
      expect(executor.taskGraph.size).toBe(1);
      expect(executor.stats.total).toBe(1);

      const node = executor.taskGraph.get(taskId);
      expect(node).toBeDefined();
      expect(node.task).toEqual(task);
    });

    it("应该批量添加任务", () => {
      const tasks = [{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }];

      const taskIds = executor.addTasks(tasks);

      expect(taskIds).toHaveLength(3);
      expect(executor.taskGraph.size).toBe(3);
      expect(executor.stats.total).toBe(3);
    });
  });

  describe("buildDependencyGraph - 构建依赖图", () => {
    it("应该构建正确的依赖关系", () => {
      executor.addTasks([
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: ["task-1"] },
        { id: "task-3", dependencies: ["task-1", "task-2"] },
      ]);

      const task1 = executor.taskGraph.get("task-1");
      const task2 = executor.taskGraph.get("task-2");
      const task3 = executor.taskGraph.get("task-3");

      expect(task1.dependents).toEqual(["task-2", "task-3"]);
      expect(task2.dependents).toEqual(["task-3"]);
      expect(task3.dependents).toEqual([]);
    });

    it("应该处理不存在的依赖", () => {
      executor.addTask({ id: "task-1", dependencies: ["nonexistent"] });

      const task1 = executor.taskGraph.get("task-1");
      expect(task1.dependencies).toEqual(["nonexistent"]);
    });
  });

  describe("detectCyclicDependencies - 循环依赖检测", () => {
    it("应该检测简单的循环依赖", () => {
      executor.addTasks([
        { id: "task-1", dependencies: ["task-2"] },
        { id: "task-2", dependencies: ["task-1"] },
      ]);

      expect(() => executor.detectCyclicDependencies()).toThrow(
        "检测到循环依赖",
      );
    });

    it("应该检测复杂的循环依赖", () => {
      executor.addTasks([
        { id: "task-1", dependencies: ["task-2"] },
        { id: "task-2", dependencies: ["task-3"] },
        { id: "task-3", dependencies: ["task-1"] },
      ]);

      expect(() => executor.detectCyclicDependencies()).toThrow(
        "检测到循环依赖",
      );
    });

    it("应该通过无循环依赖的检查", () => {
      executor.addTasks([
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: ["task-1"] },
        { id: "task-3", dependencies: ["task-2"] },
      ]);

      expect(() => executor.detectCyclicDependencies()).not.toThrow();
    });
  });

  describe("getReadyTasks - 获取可执行任务", () => {
    it("应该返回无依赖的任务", () => {
      executor.addTasks([
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: ["task-1"] },
      ]);

      const readyTasks = executor.getReadyTasks();

      expect(readyTasks).toHaveLength(1);
      expect(readyTasks[0].id).toBe("task-1");
      expect(readyTasks[0].status).toBe(TaskStatus.READY);
    });

    it("应该按优先级排序", () => {
      executor.addTasks([
        { id: "task-1", priority: 1 },
        { id: "task-2", priority: 5 },
        { id: "task-3", priority: 3 },
      ]);

      const readyTasks = executor.getReadyTasks();

      expect(readyTasks[0].id).toBe("task-2"); // priority 5
      expect(readyTasks[1].id).toBe("task-3"); // priority 3
      expect(readyTasks[2].id).toBe("task-1"); // priority 1
    });

    it("应该返回依赖已满足的任务", () => {
      executor.addTasks([
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: ["task-1"] },
      ]);

      // Mark task-1 as already ready (so it won't be returned again)
      const task1 = executor.taskGraph.get("task-1");
      task1.status = TaskStatus.COMPLETED;
      executor.completedTasks.add("task-1");

      const readyTasks = executor.getReadyTasks();

      expect(readyTasks).toHaveLength(1);
      expect(readyTasks[0].id).toBe("task-2");
    });
  });

  describe("executeTask - 执行任务", () => {
    it("应该成功执行任务", async () => {
      const task = { id: "task-1", data: "test" };
      const node = new TaskNode(task);
      executor.taskGraph.set(node.id, node);

      const mockExecutor = vi.fn().mockResolvedValue({ result: "success" });

      const result = await executor.executeTask(node, mockExecutor);

      expect(result).toEqual({ result: "success" });
      expect(node.status).toBe(TaskStatus.COMPLETED);
      expect(executor.completedTasks.has(node.id)).toBe(true);
      expect(executor.stats.completed).toBe(1);
      expect(mockExecutor).toHaveBeenCalledWith(task);
    });

    it("应该处理任务失败", async () => {
      const task = { id: "task-1" };
      const node = new TaskNode(task, { maxRetries: 0 });
      executor.taskGraph.set(node.id, node);

      const mockExecutor = vi.fn().mockRejectedValue(new Error("Task failed"));

      await expect(executor.executeTask(node, mockExecutor)).rejects.toThrow(
        "Task failed",
      );

      expect(node.status).toBe(TaskStatus.FAILED);
      expect(executor.failedTasks.has(node.id)).toBe(true);
      expect(executor.stats.failed).toBe(1);
    });

    it("应该重试失败的任务", async () => {
      const task = { id: "task-1" };
      const node = new TaskNode(task, { maxRetries: 2 });
      executor.taskGraph.set(node.id, node);

      // Disable smart retry to ensure traditional retry is used
      executor.useSmartRetry = false;

      let attempts = 0;
      const mockExecutor = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error("Fail"));
        }
        return Promise.resolve({ result: "success" });
      });

      const result = await executor.executeTask(node, mockExecutor);

      expect(result).toEqual({ result: "success" });
      expect(attempts).toBe(3);
      expect(node.retries).toBe(2);
      expect(mockExecutor).toHaveBeenCalledTimes(3);
    });

    it("应该在超时后失败", async () => {
      const task = { id: "task-1" };
      const node = new TaskNode(task, { maxRetries: 0 });
      executor.config.TASK_TIMEOUT = 100;
      executor.taskGraph.set(node.id, node);

      const mockExecutor = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 200)),
        );

      await expect(executor.executeTask(node, mockExecutor)).rejects.toThrow(
        "任务执行超时",
      );

      expect(node.status).toBe(TaskStatus.FAILED);
    });

    it("应该发射任务事件", async () => {
      const task = { id: "task-1" };
      const node = new TaskNode(task);
      executor.taskGraph.set(node.id, node);

      const onTaskStarted = vi.fn();
      const onTaskCompleted = vi.fn();
      executor.on("task-started", onTaskStarted);
      executor.on("task-completed", onTaskCompleted);

      const mockExecutor = vi.fn().mockResolvedValue({ result: "success" });

      await executor.executeTask(node, mockExecutor);

      expect(onTaskStarted).toHaveBeenCalledWith({
        taskId: "task-1",
        task,
        attempt: 1,
      });

      expect(onTaskCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          task,
          result: { result: "success" },
        }),
      );
    });
  });

  describe("executeAll - 并行执行所有任务", () => {
    it("应该执行所有任务", async () => {
      executor.addTasks([
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: [] },
        { id: "task-3", dependencies: [] },
      ]);

      const mockExecutor = vi.fn().mockResolvedValue({ result: "success" });

      const result = await executor.executeAll(mockExecutor);

      expect(result.success).toBe(true);
      expect(result.results.size).toBe(3);
      expect(executor.stats.completed).toBe(3);
      expect(mockExecutor).toHaveBeenCalledTimes(3);
    });

    it("应该按依赖顺序执行", async () => {
      executor.addTasks([
        { id: "task-1", dependencies: [] },
        { id: "task-2", dependencies: ["task-1"] },
        { id: "task-3", dependencies: ["task-2"] },
      ]);

      const executionOrder = [];
      const mockExecutor = vi.fn().mockImplementation((task) => {
        executionOrder.push(task.id);
        return Promise.resolve({ result: "success" });
      });

      await executor.executeAll(mockExecutor);

      expect(executionOrder).toEqual(["task-1", "task-2", "task-3"]);
    });

    it("应该限制并发数", async () => {
      // Create a new executor with fixed concurrency (disable dynamic concurrency)
      const fixedExecutor = new TaskExecutor({
        MAX_CONCURRENCY: 2,
        useDynamicConcurrency: false,
      });

      fixedExecutor.addTasks([
        { id: "task-1" },
        { id: "task-2" },
        { id: "task-3" },
        { id: "task-4" },
      ]);

      let currentRunning = 0;
      let maxConcurrent = 0;
      const concurrentSnapshots = [];

      const mockExecutor = vi.fn().mockImplementation(() => {
        currentRunning++;
        const snapshot = currentRunning;
        concurrentSnapshots.push(snapshot);
        maxConcurrent = Math.max(maxConcurrent, currentRunning);
        return new Promise((resolve) =>
          setTimeout(() => {
            currentRunning--;
            resolve({ result: "success" });
          }, 100),
        );
      });

      await fixedExecutor.executeAll(mockExecutor);

      // Check that max concurrency never exceeded 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
      // Also verify all snapshots were within limit
      concurrentSnapshots.forEach(snapshot => {
        expect(snapshot).toBeLessThanOrEqual(2);
      });
    });

    it("应该检测循环依赖", async () => {
      executor.addTasks([
        { id: "task-1", dependencies: ["task-2"] },
        { id: "task-2", dependencies: ["task-1"] },
      ]);

      const mockExecutor = vi.fn();

      await expect(executor.executeAll(mockExecutor)).rejects.toThrow(
        "检测到循环依赖",
      );
    });

    it("应该处理部分失败", async () => {
      executor.addTasks([{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }]);

      const mockExecutor = vi.fn().mockImplementation((task) => {
        if (task.id === "task-2") {
          return Promise.reject(new Error("Task 2 failed"));
        }
        return Promise.resolve({ result: "success" });
      });

      const result = await executor.executeAll(mockExecutor);

      expect(result.success).toBe(false);
      expect(result.results.size).toBe(2);
      expect(result.errors.size).toBe(1);
      expect(executor.stats.completed).toBe(2);
      expect(executor.stats.failed).toBe(1);
    });

    it("应该支持stopOnFailure选项", async () => {
      executor.addTasks([{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }]);

      const mockExecutor = vi.fn().mockImplementation((task) => {
        if (task.id === "task-2") {
          return Promise.reject(new Error("Task 2 failed"));
        }
        return new Promise((resolve) =>
          setTimeout(() => resolve({ result: "success" }), 50),
        );
      });

      const result = await executor.executeAll(mockExecutor, {
        stopOnFailure: true,
      });

      // stopOnFailure sets cancelled flag but executeAll still returns normally
      // It just stops scheduling new tasks, existing ones may complete
      expect(executor.cancelled).toBe(true);
      expect(result.errors.size).toBeGreaterThan(0);
    });

    it("应该发射执行事件", async () => {
      executor.addTasks([{ id: "task-1" }]);

      const onExecutionStarted = vi.fn();
      const onExecutionCompleted = vi.fn();
      const onProgress = vi.fn();

      executor.on("execution-started", onExecutionStarted);
      executor.on("execution-completed", onExecutionCompleted);
      executor.on("progress", onProgress);

      const mockExecutor = vi.fn().mockResolvedValue({ result: "success" });

      await executor.executeAll(mockExecutor);

      expect(onExecutionStarted).toHaveBeenCalledWith({ totalTasks: 1 });
      expect(onExecutionCompleted).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalled();
    });

    it("应该防止重复执行", async () => {
      executor.addTasks([{ id: "task-1" }]);

      const mockExecutor = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        );

      const promise1 = executor.executeAll(mockExecutor);

      await expect(executor.executeAll(mockExecutor)).rejects.toThrow(
        "任务执行器已在运行中",
      );

      await promise1;
    });
  });

  describe("cancel - 取消执行", () => {
    it("应该取消执行", () => {
      executor.addTasks([{ id: "task-1" }, { id: "task-2" }]);

      executor.completedTasks.add("task-1");

      const onCancelled = vi.fn();
      executor.on("execution-cancelled", onCancelled);

      executor.cancel();

      expect(executor.cancelled).toBe(true);
      expect(executor.stats.cancelled).toBe(1);
      expect(onCancelled).toHaveBeenCalledWith({
        completed: 1,
        cancelled: 1,
      });
    });
  });

  describe("getStats - 获取统计信息", () => {
    it("应该返回统计信息", () => {
      executor.stats = {
        total: 10,
        completed: 8,
        failed: 2,
        cancelled: 0,
        totalDuration: 4000,
      };

      const stats = executor.getStats();

      expect(stats.total).toBe(10);
      expect(stats.completed).toBe(8);
      expect(stats.failed).toBe(2);
      expect(stats.averageDuration).toBe("500.00");
      expect(stats.successRate).toBe("80.00");
    });

    it("应该处理零除错误", () => {
      const stats = executor.getStats();

      expect(stats.averageDuration).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });

  describe("reset - 重置执行器", () => {
    it("应该重置所有状态", () => {
      executor.addTasks([{ id: "task-1" }]);
      executor.completedTasks.add("task-1");
      executor.stats.completed = 1;

      executor.reset();

      expect(executor.taskGraph.size).toBe(0);
      expect(executor.completedTasks.size).toBe(0);
      expect(executor.runningTasks.size).toBe(0);
      expect(executor.failedTasks.size).toBe(0);
      expect(executor.stats.total).toBe(0);
      expect(executor.stats.completed).toBe(0);
      expect(executor.isExecuting).toBe(false);
      expect(executor.cancelled).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该处理空任务列表", async () => {
      const mockExecutor = vi.fn();
      const result = await executor.executeAll(mockExecutor);

      expect(result.success).toBe(true);
      expect(result.results.size).toBe(0);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it("应该处理只有依赖关系的任务", async () => {
      executor.addTasks([{ id: "task-1", dependencies: ["task-2"] }]);

      const mockExecutor = vi.fn().mockResolvedValue({ result: "success" });

      const result = await executor.executeAll(mockExecutor);

      // 任务无法执行，因为依赖不满足
      expect(result.results.size).toBe(0);
      expect(executor.completedTasks.size).toBe(0);
    });

    it("应该处理同时完成的多个任务", async () => {
      executor.addTasks([{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }]);

      const mockExecutor = vi
        .fn()
        .mockImplementation(() => Promise.resolve({ result: "success" }));

      const result = await executor.executeAll(mockExecutor);

      expect(result.success).toBe(true);
      expect(result.results.size).toBe(3);
    });
  });

  describe("visualize - 可视化任务图", () => {
    it("应该可视化任务图", () => {
      executor.addTasks([
        { id: "task-1", priority: 5, dependencies: [] },
        { id: "task-2", priority: 3, dependencies: ["task-1"] },
      ]);

      executor.completedTasks.add("task-1");
      const task1 = executor.taskGraph.get("task-1");
      task1.status = TaskStatus.COMPLETED;

      expect(() => executor.visualize()).not.toThrow();
    });
  });
});
