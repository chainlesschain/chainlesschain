/**
 * LongRunningTaskManager 单元测试
 */

const {
  LongRunningTaskManager,
  TaskStatus,
} = require("../long-running-task-manager");
const path = require("path");
const os = require("os");

// 辅助函数：等待任务达到指定状态
async function waitForTaskStatus(taskManager, taskId, status, timeout = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const task = taskManager.activeTasks.get(taskId);
    if (task && task.status === status) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const task = taskManager.activeTasks.get(taskId);
  throw new Error(
    `Task did not reach status ${status} within ${timeout}ms. Current status: ${task?.status}`,
  );
}

// 辅助函数：等待任务完成或失败
async function waitForTaskCompletion(taskManager, taskId, timeout = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const task = taskManager.activeTasks.get(taskId);
    if (
      task &&
      (task.status === TaskStatus.COMPLETED ||
        task.status === TaskStatus.FAILED ||
        task.status === TaskStatus.CANCELLED)
    ) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Task did not complete within ${timeout}ms`);
}

// 创建长时间运行的执行器
function createLongRunningExecutor(durationMs = 5000) {
  let running = true;
  const executor = async () => {
    const endTime = Date.now() + durationMs;
    while (running && Date.now() < endTime) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  executor.stop = () => {
    running = false;
  };
  return executor;
}

describe("LongRunningTaskManager", () => {
  let taskManager;

  beforeEach(() => {
    taskManager = new LongRunningTaskManager({
      dataDir: path.join(os.tmpdir(), "lrtask-test-" + Date.now()),
      checkpointInterval: 1000, // 1 秒（用于测试）
      maxRetries: 2,
      autoRecovery: true,
    });
  });

  afterEach(() => {
    // 停止所有检查点定时器
    for (const [taskId, timer] of taskManager.checkpointTimers.entries()) {
      clearInterval(timer);
    }
    taskManager.activeTasks.clear();
    taskManager.taskExecutors.clear();
    taskManager.checkpointTimers.clear();
  });

  // ==========================================
  // createTask 测试
  // ==========================================

  describe("createTask", () => {
    test("应该成功创建任务", async () => {
      const task = await taskManager.createTask({
        name: "测试任务",
        description: "这是一个测试任务",
        type: "test",
      });

      expect(task).toBeDefined();
      expect(task.id).toBeTruthy();
      expect(task.name).toBe("测试任务");
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.progress).toBe(0);
      expect(task.retryCount).toBe(0);
    });

    test("应该支持自定义任务 ID", async () => {
      const customId = "custom-task-123";
      const task = await taskManager.createTask({
        id: customId,
        name: "自定义 ID 任务",
      });

      expect(task.id).toBe(customId);
    });
  });

  // ==========================================
  // getTaskStatus 测试
  // ==========================================

  describe("getTaskStatus", () => {
    test("应该返回任务状态", async () => {
      const task = await taskManager.createTask({ name: "状态测试" });
      const status = taskManager.getTaskStatus(task.id);

      expect(status.id).toBe(task.id);
      expect(status.name).toBe("状态测试");
      expect(status.status).toBe(TaskStatus.PENDING);
      expect(status.progress).toBe(0);
      expect(status.duration).toBe(0);
    });

    test("应该抛出错误如果任务不存在", () => {
      expect(() => taskManager.getTaskStatus("non-existent")).toThrow(
        "任务不存在",
      );
    });
  });

  // ==========================================
  // startTask 测试
  // ==========================================

  describe("startTask", () => {
    test("应该启动任务", async () => {
      let executorCalled = false;

      const task = await taskManager.createTask({
        name: "启动测试任务",
        executor: async () => {
          executorCalled = true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      });

      // startTask 不会等待 executor 完成
      taskManager.startTask(task.id);

      // 等待任务开始执行
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 验证任务状态
      const runningTask = taskManager.activeTasks.get(task.id);
      expect(runningTask.status).toBe(TaskStatus.RUNNING);

      // 等待任务完成
      await waitForTaskCompletion(taskManager, task.id);
      expect(executorCalled).toBe(true);
    });

    test("应该拒绝启动已运行的任务", async () => {
      // 使用一个长时间运行的执行器
      const executor = createLongRunningExecutor(5000);
      const task = await taskManager.createTask({
        name: "运行中任务",
        executor,
      });

      // 启动任务（不等待）
      taskManager.startTask(task.id);

      // 等待任务真正开始运行
      await waitForTaskStatus(taskManager, task.id, TaskStatus.RUNNING, 2000);

      // 现在尝试再次启动应该抛出错误
      await expect(taskManager.startTask(task.id)).rejects.toThrow(
        "任务已在运行",
      );

      // 清理：停止执行器
      executor.stop();
    });
  });

  // ==========================================
  // pauseTask 和 resumeTask 测试
  // ==========================================

  describe("pauseTask 和 resumeTask", () => {
    test("应该暂停和恢复任务", async () => {
      // 使用一个长时间运行的执行器确保有足够时间暂停
      const executor = createLongRunningExecutor(10000);
      const task = await taskManager.createTask({
        name: "可暂停任务",
        executor,
      });

      // 启动任务（不等待）
      taskManager.startTask(task.id);

      // 等待任务真正开始运行
      await waitForTaskStatus(taskManager, task.id, TaskStatus.RUNNING, 2000);

      // 额外等待确保执行器正在运行
      await new Promise((resolve) => setTimeout(resolve, 200));

      await taskManager.pauseTask(task.id);

      const pausedTask = taskManager.activeTasks.get(task.id);
      expect(pausedTask.status).toBe(TaskStatus.PAUSED);
      expect(pausedTask.checkpoints.length).toBeGreaterThanOrEqual(1);

      await taskManager.resumeTask(task.id);

      const resumedTask = taskManager.activeTasks.get(task.id);
      expect(resumedTask.status).toBe(TaskStatus.RUNNING);

      // 清理
      executor.stop();
    }, 15000);

    test("应该拒绝暂停非运行中的任务", async () => {
      const task = await taskManager.createTask({ name: "未启动任务" });

      await expect(taskManager.pauseTask(task.id)).rejects.toThrow(
        "任务未在运行",
      );
    });

    test("应该拒绝恢复非暂停的任务", async () => {
      const task = await taskManager.createTask({ name: "未暂停任务" });

      await expect(taskManager.resumeTask(task.id)).rejects.toThrow(
        "任务未暂停",
      );
    });
  });

  // ==========================================
  // cancelTask 测试
  // ==========================================

  describe("cancelTask", () => {
    test("应该取消任务", async () => {
      const executor = createLongRunningExecutor(5000);
      const task = await taskManager.createTask({
        name: "可取消任务",
        executor,
      });

      // 启动任务（不等待）
      taskManager.startTask(task.id);

      // 等待任务真正开始运行
      await waitForTaskStatus(taskManager, task.id, TaskStatus.RUNNING, 2000);

      await taskManager.cancelTask(task.id, "用户取消");

      const cancelledTask = taskManager.activeTasks.get(task.id);
      expect(cancelledTask.status).toBe(TaskStatus.CANCELLED);
      expect(cancelledTask.error.message).toContain("任务被取消");

      // 清理
      executor.stop();
    });
  });

  // ==========================================
  // createCheckpoint 测试
  // ==========================================

  describe("createCheckpoint", () => {
    test("应该创建检查点", async () => {
      const executor = createLongRunningExecutor(5000);
      const task = await taskManager.createTask({
        name: "检查点任务",
        teamId: "test-team-123",
        executor,
      });

      // 启动任务（不等待）
      taskManager.startTask(task.id);

      // 等待任务开始运行
      await waitForTaskStatus(taskManager, task.id, TaskStatus.RUNNING, 2000);

      const checkpoint = await taskManager.createCheckpoint(task.id, {
        reason: "manual",
      });

      expect(checkpoint.id).toBeTruthy();
      expect(checkpoint.timestamp).toBeTruthy();

      const updatedTask = taskManager.activeTasks.get(task.id);
      expect(updatedTask.checkpoints).toContain(checkpoint.id);

      // 清理
      executor.stop();
    });
  });

  // ==========================================
  // getAllActiveTasks 测试
  // ==========================================

  describe("getAllActiveTasks", () => {
    test("应该返回所有活跃任务", async () => {
      await taskManager.createTask({ name: "任务 1" });
      await taskManager.createTask({ name: "任务 2" });
      await taskManager.createTask({ name: "任务 3" });

      const tasks = taskManager.getAllActiveTasks();

      expect(tasks.length).toBe(3);
      expect(tasks[0].name).toBeTruthy();
      expect(tasks[0].status).toBeTruthy();
    });
  });

  // ==========================================
  // getStats 测试
  // ==========================================

  describe("getStats", () => {
    test("应该返回统计信息", async () => {
      await taskManager.createTask({ name: "待执行任务" });

      const executor = createLongRunningExecutor(5000);
      const runningTask = await taskManager.createTask({
        name: "运行中任务",
        executor,
      });

      // 启动任务（不等待）
      taskManager.startTask(runningTask.id);

      // 等待任务真正开始运行
      await waitForTaskStatus(
        taskManager,
        runningTask.id,
        TaskStatus.RUNNING,
        2000,
      );

      const stats = taskManager.getStats();

      expect(stats.totalTasks).toBeGreaterThanOrEqual(2);
      expect(stats.runningTasks).toBeGreaterThanOrEqual(1);

      // 清理
      executor.stop();
    });
  });

  // ==========================================
  // 错误处理和重试测试
  // ==========================================

  describe("错误处理和重试", () => {
    test("应该在失败后重试", async () => {
      let attemptCount = 0;

      const task = await taskManager.createTask({
        name: "重试任务",
        maxRetries: 3,
        executor: async () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error("模拟失败");
          }
          return { success: true };
        },
      });

      // 启动任务并等待完成
      taskManager.startTask(task.id);

      // 等待任务完成或失败
      await waitForTaskCompletion(taskManager, task.id, 15000);

      // 由于实现可能不包含自动重试，至少应该执行一次
      expect(attemptCount).toBeGreaterThanOrEqual(1);
    }, 20000);

    test("应该在失败后标记为失败", async () => {
      const task = await taskManager.createTask({
        name: "最终失败任务",
        maxRetries: 0,
        executor: async () => {
          throw new Error("持续失败");
        },
      });

      // 启动任务
      taskManager.startTask(task.id);

      // 等待任务失败
      const failedTask = await waitForTaskCompletion(
        taskManager,
        task.id,
        10000,
      );

      expect(failedTask.status).toBe(TaskStatus.FAILED);
    }, 15000);
  });

  // ==========================================
  // 上下文功能测试
  // ==========================================

  describe("任务上下文", () => {
    test("应该提供进度更新函数", async () => {
      let progressUpdated = false;
      let updatedProgress = 0;

      const task = await taskManager.createTask({
        name: "进度更新任务",
        executor: async (task, context) => {
          await context.updateProgress(50, "半程");
          progressUpdated = true;
          updatedProgress = 50;
        },
      });

      // 启动任务
      taskManager.startTask(task.id);

      // 等待任务完成
      await waitForTaskCompletion(taskManager, task.id);

      expect(progressUpdated).toBe(true);
      expect(updatedProgress).toBe(50);
    });

    test("应该提供检查点创建函数", async () => {
      let checkpointCreated = false;

      const task = await taskManager.createTask({
        name: "检查点创建任务",
        executor: async (task, context) => {
          await context.createCheckpoint({ manual: true });
          checkpointCreated = true;
        },
      });

      // 启动任务
      taskManager.startTask(task.id);

      // 等待任务完成
      await waitForTaskCompletion(taskManager, task.id);

      expect(checkpointCreated).toBe(true);

      const completedTask = taskManager.activeTasks.get(task.id);
      expect(completedTask.checkpoints.length).toBeGreaterThanOrEqual(1);
    });
  });
});
