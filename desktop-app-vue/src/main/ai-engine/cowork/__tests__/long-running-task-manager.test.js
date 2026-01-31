/**
 * LongRunningTaskManager 单元测试
 */

const { LongRunningTaskManager, TaskStatus } = require('../long-running-task-manager');
const path = require('path');
const os = require('os');

describe('LongRunningTaskManager', () => {
  let taskManager;

  beforeEach(() => {
    taskManager = new LongRunningTaskManager({
      dataDir: path.join(os.tmpdir(), 'lrtask-test-' + Date.now()),
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

  describe('createTask', () => {
    test('应该成功创建任务', async () => {
      const task = await taskManager.createTask({
        name: '测试任务',
        description: '这是一个测试任务',
        type: 'test',
      });

      expect(task).toBeDefined();
      expect(task.id).toBeTruthy();
      expect(task.name).toBe('测试任务');
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.progress).toBe(0);
      expect(task.retryCount).toBe(0);
    });

    test('应该支持自定义任务 ID', async () => {
      const customId = 'custom-task-123';
      const task = await taskManager.createTask({
        id: customId,
        name: '自定义 ID 任务',
      });

      expect(task.id).toBe(customId);
    });
  });

  // ==========================================
  // getTaskStatus 测试
  // ==========================================

  describe('getTaskStatus', () => {
    test('应该返回任务状态', async () => {
      const task = await taskManager.createTask({ name: '状态测试' });
      const status = taskManager.getTaskStatus(task.id);

      expect(status.id).toBe(task.id);
      expect(status.name).toBe('状态测试');
      expect(status.status).toBe(TaskStatus.PENDING);
      expect(status.progress).toBe(0);
      expect(status.duration).toBe(0);
    });

    test('应该抛出错误如果任务不存在', () => {
      expect(() => taskManager.getTaskStatus('non-existent')).toThrow('任务不存在');
    });
  });

  // ==========================================
  // startTask 测试
  // ==========================================

  describe('startTask', () => {
    test('应该启动带步骤的任务', async () => {
      let step1Executed = false;
      let step2Executed = false;

      const task = await taskManager.createTask({
        name: '步骤任务',
        steps: [
          {
            name: '步骤 1',
            execute: async (context) => {
              step1Executed = true;
              context.updateProgress(50, '步骤 1 完成');
              return { step: 1 };
            },
          },
          {
            name: '步骤 2',
            execute: async (context) => {
              step2Executed = true;
              context.updateProgress(100, '步骤 2 完成');
              return { step: 2 };
            },
          },
        ],
      });

      await taskManager.startTask(task.id);

      // 等待任务完成
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updatedTask = taskManager.activeTasks.get(task.id);
          if (updatedTask && updatedTask.status === TaskStatus.COMPLETED) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      expect(step1Executed).toBe(true);
      expect(step2Executed).toBe(true);

      const completedTask = taskManager.activeTasks.get(task.id);
      expect(completedTask.status).toBe(TaskStatus.COMPLETED);
      expect(completedTask.progress).toBe(100);
    });

    test('应该启动自定义执行器任务', async () => {
      let executorCalled = false;

      const task = await taskManager.createTask({
        name: '执行器任务',
        executor: async (task, context) => {
          executorCalled = true;
          context.updateProgress(100, '完成');
          return { success: true };
        },
      });

      await taskManager.startTask(task.id);

      // 等待任务完成
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updatedTask = taskManager.activeTasks.get(task.id);
          if (updatedTask && updatedTask.status === TaskStatus.COMPLETED) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      expect(executorCalled).toBe(true);
    });

    test('应该拒绝启动已运行的任务', async () => {
      const task = await taskManager.createTask({
        name: '运行中任务',
        executor: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
        },
      });

      await taskManager.startTask(task.id);

      await expect(taskManager.startTask(task.id)).rejects.toThrow('任务已在运行');
    });
  });

  // ==========================================
  // pauseTask 和 resumeTask 测试
  // ==========================================

  describe('pauseTask 和 resumeTask', () => {
    test('应该暂停和恢复任务', async () => {
      const task = await taskManager.createTask({
        name: '可暂停任务',
        executor: async (task, context) => {
          for (let i = 0; i < 100; i++) {
            if (task.status === TaskStatus.PAUSED) {
              break;
            }
            context.updateProgress(i, `进度 ${i}%`);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        },
      });

      await taskManager.startTask(task.id);

      // 等待任务开始执行
      await new Promise(resolve => setTimeout(resolve, 50));

      await taskManager.pauseTask(task.id);

      const pausedTask = taskManager.activeTasks.get(task.id);
      expect(pausedTask.status).toBe(TaskStatus.PAUSED);
      expect(pausedTask.checkpoints.length).toBeGreaterThanOrEqual(1);

      await taskManager.resumeTask(task.id);

      const resumedTask = taskManager.activeTasks.get(task.id);
      expect(resumedTask.status).toBe(TaskStatus.RUNNING);
    });

    test('应该拒绝暂停非运行中的任务', async () => {
      const task = await taskManager.createTask({ name: '未启动任务' });

      await expect(taskManager.pauseTask(task.id)).rejects.toThrow('任务未在运行');
    });

    test('应该拒绝恢复非暂停的任务', async () => {
      const task = await taskManager.createTask({ name: '未暂停任务' });

      await expect(taskManager.resumeTask(task.id)).rejects.toThrow('任务未暂停');
    });
  });

  // ==========================================
  // cancelTask 测试
  // ==========================================

  describe('cancelTask', () => {
    test('应该取消任务', async () => {
      const task = await taskManager.createTask({
        name: '可取消任务',
        executor: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000));
        },
      });

      await taskManager.startTask(task.id);
      await new Promise(resolve => setTimeout(resolve, 50));

      await taskManager.cancelTask(task.id, '用户取消');

      const cancelledTask = taskManager.activeTasks.get(task.id);
      expect(cancelledTask.status).toBe(TaskStatus.CANCELLED);
      expect(cancelledTask.error.message).toContain('任务被取消');
    });
  });

  // ==========================================
  // createCheckpoint 测试
  // ==========================================

  describe('createCheckpoint', () => {
    test('应该创建检查点', async () => {
      const task = await taskManager.createTask({ name: '检查点任务' });
      await taskManager.startTask(task.id);

      const checkpoint = await taskManager.createCheckpoint(task.id, {
        reason: 'manual',
      });

      expect(checkpoint.id).toBeTruthy();
      expect(checkpoint.teamId).toBe(task.teamId);
      expect(checkpoint.timestamp).toBeTruthy();

      const updatedTask = taskManager.activeTasks.get(task.id);
      expect(updatedTask.checkpoints).toContain(checkpoint.id);
    });
  });

  // ==========================================
  // getAllActiveTasks 测试
  // ==========================================

  describe('getAllActiveTasks', () => {
    test('应该返回所有活跃任务', async () => {
      await taskManager.createTask({ name: '任务 1' });
      await taskManager.createTask({ name: '任务 2' });
      await taskManager.createTask({ name: '任务 3' });

      const tasks = taskManager.getAllActiveTasks();

      expect(tasks.length).toBe(3);
      expect(tasks[0].name).toBeTruthy();
      expect(tasks[0].status).toBeTruthy();
    });
  });

  // ==========================================
  // getStats 测试
  // ==========================================

  describe('getStats', () => {
    test('应该返回统计信息', async () => {
      await taskManager.createTask({ name: '待执行任务' });

      const runningTask = await taskManager.createTask({
        name: '运行中任务',
        executor: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000));
        },
      });
      await taskManager.startTask(runningTask.id);

      const stats = taskManager.getStats();

      expect(stats.totalTasks).toBeGreaterThanOrEqual(2);
      expect(stats.runningTasks).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // 错误处理和重试测试
  // ==========================================

  describe('错误处理和重试', () => {
    test('应该在失败后重试', async () => {
      let attemptCount = 0;

      const task = await taskManager.createTask({
        name: '重试任务',
        maxRetries: 2,
        executor: async () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new Error('模拟失败');
          }
          return { success: true };
        },
      });

      await taskManager.startTask(task.id);

      // 等待任务重试并完成
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updatedTask = taskManager.activeTasks.get(task.id);
          if (updatedTask && (updatedTask.status === TaskStatus.COMPLETED || updatedTask.status === TaskStatus.FAILED)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      expect(attemptCount).toBeGreaterThanOrEqual(2);
    }, 10000); // 增加超时时间

    test('应该在重试次数用尽后标记为失败', async () => {
      let attemptCount = 0;

      const task = await taskManager.createTask({
        name: '最终失败任务',
        maxRetries: 1,
        executor: async () => {
          attemptCount++;
          throw new Error('持续失败');
        },
      });

      await taskManager.startTask(task.id);

      // 等待任务失败
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updatedTask = taskManager.activeTasks.get(task.id);
          if (updatedTask && updatedTask.status === TaskStatus.FAILED) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      const failedTask = taskManager.activeTasks.get(task.id);
      expect(failedTask.status).toBe(TaskStatus.FAILED);
      expect(failedTask.retryCount).toBeGreaterThanOrEqual(1);
    }, 10000); // 增加超时时间
  });

  // ==========================================
  // 上下文功能测试
  // ==========================================

  describe('任务上下文', () => {
    test('应该提供进度更新函数', async () => {
      let progressUpdated = false;

      const task = await taskManager.createTask({
        name: '进度更新任务',
        executor: async (task, context) => {
          await context.updateProgress(50, '半程');
          progressUpdated = true;
        },
      });

      await taskManager.startTask(task.id);

      // 等待任务完成
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updatedTask = taskManager.activeTasks.get(task.id);
          if (updatedTask && updatedTask.status === TaskStatus.COMPLETED) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      expect(progressUpdated).toBe(true);

      const completedTask = taskManager.activeTasks.get(task.id);
      expect(completedTask.progress).toBeGreaterThanOrEqual(50);
    });

    test('应该提供检查点创建函数', async () => {
      let checkpointCreated = false;

      const task = await taskManager.createTask({
        name: '检查点创建任务',
        executor: async (task, context) => {
          await context.createCheckpoint({ manual: true });
          checkpointCreated = true;
        },
      });

      await taskManager.startTask(task.id);

      // 等待任务完成
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const updatedTask = taskManager.activeTasks.get(task.id);
          if (updatedTask && updatedTask.status === TaskStatus.COMPLETED) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      expect(checkpointCreated).toBe(true);

      const completedTask = taskManager.activeTasks.get(task.id);
      expect(completedTask.checkpoints.length).toBeGreaterThanOrEqual(1);
    });
  });
});
