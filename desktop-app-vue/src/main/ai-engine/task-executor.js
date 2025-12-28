/**
 * AI任务并行执行器
 * 支持依赖分析、并发控制、优先级队列
 */

const EventEmitter = require('events');

/**
 * 任务执行器配置
 */
const EXECUTOR_CONFIG = {
  // 最大并发数
  MAX_CONCURRENCY: 3,
  // 任务超时时间（5分钟）
  TASK_TIMEOUT: 5 * 60 * 1000,
  // 重试次数
  MAX_RETRIES: 2,
  // 重试延迟（毫秒）
  RETRY_DELAY: 1000,
};

/**
 * 任务状态
 */
const TaskStatus = {
  PENDING: 'pending',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * 任务节点
 */
class TaskNode {
  constructor(task, config = {}) {
    this.id = task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.task = task;
    this.status = TaskStatus.PENDING;
    this.dependencies = task.dependencies || [];
    this.dependents = []; // 依赖于此任务的任务列表
    this.priority = task.priority || 0;
    this.retries = 0;
    this.maxRetries = config.maxRetries || EXECUTOR_CONFIG.MAX_RETRIES;
    this.startTime = null;
    this.endTime = null;
    this.result = null;
    this.error = null;
  }

  /**
   * 检查是否可以执行
   */
  isReady(completedTasks) {
    if (this.status !== TaskStatus.PENDING) {
      return false;
    }

    // 检查所有依赖是否已完成
    return this.dependencies.every((depId) => completedTasks.has(depId));
  }

  /**
   * 标记为可执行
   */
  markReady() {
    if (this.status === TaskStatus.PENDING) {
      this.status = TaskStatus.READY;
    }
  }

  /**
   * 开始执行
   */
  markRunning() {
    this.status = TaskStatus.RUNNING;
    this.startTime = Date.now();
  }

  /**
   * 标记完成
   */
  markCompleted(result) {
    this.status = TaskStatus.COMPLETED;
    this.endTime = Date.now();
    this.result = result;
  }

  /**
   * 标记失败
   */
  markFailed(error) {
    this.status = TaskStatus.FAILED;
    this.endTime = Date.now();
    this.error = error;
  }

  /**
   * 获取执行时长
   */
  getDuration() {
    if (this.startTime && this.endTime) {
      return this.endTime - this.startTime;
    }
    return null;
  }
}

/**
 * 任务执行器
 */
class TaskExecutor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...EXECUTOR_CONFIG,
      ...config,
    };

    this.taskGraph = new Map(); // 任务图：taskId => TaskNode
    this.completedTasks = new Set(); // 已完成的任务ID集合
    this.runningTasks = new Set(); // 正在运行的任务ID集合
    this.failedTasks = new Set(); // 失败的任务ID集合

    this.isExecuting = false;
    this.cancelled = false;

    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalDuration: 0,
    };
  }

  /**
   * 添加任务
   */
  addTask(task) {
    const node = new TaskNode(task, this.config);
    this.taskGraph.set(node.id, node);
    this.stats.total++;

    console.log(`[TaskExecutor] 添加任务: ${node.id}, 依赖: [${node.dependencies.join(', ')}]`);

    return node.id;
  }

  /**
   * 批量添加任务
   */
  addTasks(tasks) {
    const taskIds = [];

    for (const task of tasks) {
      const taskId = this.addTask(task);
      taskIds.push(taskId);
    }

    // 构建依赖图
    this.buildDependencyGraph();

    return taskIds;
  }

  /**
   * 构建依赖图
   */
  buildDependencyGraph() {
    // 清空所有节点的dependents
    for (const node of this.taskGraph.values()) {
      node.dependents = [];
    }

    // 构建依赖关系
    for (const node of this.taskGraph.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.taskGraph.get(depId);
        if (depNode) {
          depNode.dependents.push(node.id);
        } else {
          console.warn(`[TaskExecutor] 任务 ${node.id} 的依赖 ${depId} 不存在`);
        }
      }
    }
  }

  /**
   * 检测循环依赖
   */
  detectCyclicDependencies() {
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (nodeId) => {
      if (recursionStack.has(nodeId)) {
        return true; // 发现循环
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.taskGraph.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (hasCycle(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.taskGraph.keys()) {
      if (hasCycle(nodeId)) {
        throw new Error(`检测到循环依赖，涉及任务: ${nodeId}`);
      }
    }

    console.log('[TaskExecutor] 依赖检查通过，无循环依赖');
  }

  /**
   * 获取可执行的任务
   */
  getReadyTasks() {
    const readyTasks = [];

    for (const node of this.taskGraph.values()) {
      if (node.isReady(this.completedTasks)) {
        node.markReady();
        readyTasks.push(node);
      }
    }

    // 按优先级排序（优先级高的先执行）
    readyTasks.sort((a, b) => b.priority - a.priority);

    return readyTasks;
  }

  /**
   * 执行单个任务
   */
  async executeTask(node, executor) {
    const taskId = node.id;

    console.log(`[TaskExecutor] 开始执行任务: ${taskId}`);

    node.markRunning();
    this.runningTasks.add(taskId);

    this.emit('task-started', {
      taskId,
      task: node.task,
      attempt: node.retries + 1,
    });

    try {
      // 创建超时Promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('任务执行超时')), this.config.TASK_TIMEOUT);
      });

      // 执行任务
      const executionPromise = executor(node.task);

      // 竞速：先完成的胜出
      const result = await Promise.race([executionPromise, timeoutPromise]);

      // 成功
      node.markCompleted(result);
      this.runningTasks.delete(taskId);
      this.completedTasks.add(taskId);
      this.stats.completed++;
      this.stats.totalDuration += node.getDuration();

      console.log(`[TaskExecutor] 任务完成: ${taskId}, 耗时: ${node.getDuration()}ms`);

      this.emit('task-completed', {
        taskId,
        task: node.task,
        result,
        duration: node.getDuration(),
      });

      return result;
    } catch (error) {
      console.error(`[TaskExecutor] 任务失败: ${taskId}, 错误:`, error.message);

      // 重试逻辑
      if (node.retries < node.maxRetries) {
        node.retries++;
        node.status = TaskStatus.PENDING;
        this.runningTasks.delete(taskId);

        console.log(`[TaskExecutor] 任务重试 (${node.retries}/${node.maxRetries}): ${taskId}`);

        this.emit('task-retry', {
          taskId,
          task: node.task,
          attempt: node.retries,
          error: error.message,
        });

        // 延迟后重试
        await new Promise((resolve) => setTimeout(resolve, this.config.RETRY_DELAY * node.retries));

        return await this.executeTask(node, executor);
      }

      // 失败
      node.markFailed(error);
      this.runningTasks.delete(taskId);
      this.failedTasks.add(taskId);
      this.stats.failed++;

      this.emit('task-failed', {
        taskId,
        task: node.task,
        error: error.message,
        duration: node.getDuration(),
      });

      throw error;
    }
  }

  /**
   * 并行执行所有任务
   */
  async executeAll(executor, options = {}) {
    if (this.isExecuting) {
      throw new Error('任务执行器已在运行中');
    }

    this.isExecuting = true;
    this.cancelled = false;

    console.log(`[TaskExecutor] 开始执行任务图，共 ${this.taskGraph.size} 个任务`);
    console.log(`[TaskExecutor] 并发数: ${this.config.MAX_CONCURRENCY}`);

    // 检测循环依赖
    this.detectCyclicDependencies();

    this.emit('execution-started', {
      totalTasks: this.taskGraph.size,
    });

    const results = new Map();
    const errors = new Map();

    try {
      while (this.completedTasks.size + this.failedTasks.size < this.taskGraph.size) {
        if (this.cancelled) {
          throw new Error('执行已取消');
        }

        // 获取可执行的任务
        const readyTasks = this.getReadyTasks();

        if (readyTasks.length === 0 && this.runningTasks.size === 0) {
          // 没有可执行的任务，且没有正在运行的任务
          // 可能存在未满足依赖的任务
          console.warn('[TaskExecutor] 无法继续执行，可能存在依赖问题');
          break;
        }

        // 限制并发数
        const availableSlots = this.config.MAX_CONCURRENCY - this.runningTasks.size;
        const tasksToExecute = readyTasks.slice(0, availableSlots);

        if (tasksToExecute.length === 0) {
          // 没有空闲槽位，等待
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        // 并发执行任务
        const executionPromises = tasksToExecute.map((node) =>
          this.executeTask(node, executor)
            .then((result) => {
              results.set(node.id, result);
            })
            .catch((error) => {
              errors.set(node.id, error);

              // 如果设置了失败即停止
              if (options.stopOnFailure) {
                this.cancelled = true;
              }
            })
        );

        await Promise.allSettled(executionPromises);

        // 更新进度
        const progress = ((this.completedTasks.size + this.failedTasks.size) / this.taskGraph.size) * 100;

        this.emit('progress', {
          completed: this.completedTasks.size,
          failed: this.failedTasks.size,
          total: this.taskGraph.size,
          progress: progress.toFixed(2),
        });
      }

      console.log('[TaskExecutor] 任务图执行完成');
      console.log(`[TaskExecutor] 成功: ${this.stats.completed}, 失败: ${this.stats.failed}`);

      this.emit('execution-completed', {
        results,
        errors,
        stats: this.getStats(),
      });

      return {
        success: errors.size === 0,
        results,
        errors,
        stats: this.getStats(),
      };
    } catch (error) {
      console.error('[TaskExecutor] 执行失败:', error);

      this.emit('execution-failed', {
        error: error.message,
        results,
        errors,
      });

      throw error;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * 取消执行
   */
  cancel() {
    this.cancelled = true;
    this.stats.cancelled = this.taskGraph.size - this.completedTasks.size - this.failedTasks.size;

    console.log('[TaskExecutor] 执行已取消');

    this.emit('execution-cancelled', {
      completed: this.completedTasks.size,
      cancelled: this.stats.cancelled,
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      averageDuration: this.stats.completed > 0 ? (this.stats.totalDuration / this.stats.completed).toFixed(2) : 0,
      successRate: this.stats.total > 0 ? ((this.stats.completed / this.stats.total) * 100).toFixed(2) : 0,
    };
  }

  /**
   * 重置执行器
   */
  reset() {
    this.taskGraph.clear();
    this.completedTasks.clear();
    this.runningTasks.clear();
    this.failedTasks.clear();

    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalDuration: 0,
    };

    this.isExecuting = false;
    this.cancelled = false;
  }

  /**
   * 可视化任务图
   */
  visualize() {
    console.log('\n=== 任务执行图 ===\n');

    for (const node of this.taskGraph.values()) {
      const statusIcon = {
        [TaskStatus.PENDING]: '⏸️',
        [TaskStatus.READY]: '🔵',
        [TaskStatus.RUNNING]: '🔄',
        [TaskStatus.COMPLETED]: '✅',
        [TaskStatus.FAILED]: '❌',
        [TaskStatus.CANCELLED]: '⛔',
      }[node.status];

      console.log(`${statusIcon} ${node.id}`);
      console.log(`   优先级: ${node.priority}`);
      console.log(`   依赖: [${node.dependencies.join(', ') || '无'}]`);
      console.log(`   被依赖: [${node.dependents.join(', ') || '无'}]`);

      if (node.getDuration()) {
        console.log(`   耗时: ${node.getDuration()}ms`);
      }

      console.log('');
    }
  }
}

module.exports = {
  TaskExecutor,
  TaskStatus,
  TaskNode,
  EXECUTOR_CONFIG,
};
