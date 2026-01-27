/**
 * LongRunningTaskManager - 长时运行任务管理器
 *
 * 支持复杂任务的长时间执行，具备检查点、恢复、暂停/继续等功能。
 *
 * 核心功能：
 * 1. 任务生命周期管理
 * 2. 检查点创建和恢复
 * 3. 后台执行
 * 4. 进度跟踪
 * 5. 错误处理和重试
 *
 * @module ai-engine/cowork/long-running-task-manager
 */

const { logger } = require('../../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');

/**
 * 任务状态
 */
const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * LongRunningTaskManager 类
 */
class LongRunningTaskManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 数据存储路径
      dataDir: options.dataDir || path.join(process.cwd(), '.chainlesschain', 'cowork', 'tasks'),
      // 检查点间隔（毫秒）
      checkpointInterval: options.checkpointInterval || 60000, // 1分钟
      // 最大重试次数
      maxRetries: options.maxRetries || 3,
      // 重试延迟（毫秒）
      retryDelay: options.retryDelay || 5000,
      // 任务超时（毫秒，0表示无限制）
      taskTimeout: options.taskTimeout || 0,
      // 是否自动恢复失败的任务
      autoRecovery: options.autoRecovery !== false,
      // 保留已完成任务的天数
      retentionDays: options.retentionDays || 7,
      ...options,
    };

    // 活跃任务: taskId -> Task
    this.activeTasks = new Map();

    // 任务执行器: taskId -> Promise
    this.taskExecutors = new Map();

    // 检查点定时器: taskId -> Timer
    this.checkpointTimers = new Map();

    // 数据库实例（延迟注入）
    this.db = null;

    this._log('LongRunningTaskManager 已初始化');
  }

  /**
   * 设置数据库实例
   * @param {Object} db - 数据库实例
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 初始化存储目录
   * @private
   */
  async _ensureDataDir() {
    try {
      await fs.mkdir(this.options.dataDir, { recursive: true });
      await fs.mkdir(path.join(this.options.dataDir, 'checkpoints'), { recursive: true });
      await fs.mkdir(path.join(this.options.dataDir, 'results'), { recursive: true });
    } catch (error) {
      this._log(`初始化数据目录失败: ${error.message}`, 'error');
      throw error;
    }
  }

  // ==========================================
  // 任务管理
  // ==========================================

  /**
   * 创建长时运行任务
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<Object>} 任务对象
   */
  async createTask(taskConfig) {
    await this._ensureDataDir();

    const taskId = taskConfig.id || `lrtask_${Date.now()}_${uuidv4().slice(0, 8)}`;

    const task = {
      id: taskId,
      teamId: taskConfig.teamId || null,
      name: taskConfig.name || 'Unnamed Task',
      description: taskConfig.description || '',
      type: taskConfig.type || 'general',
      status: TaskStatus.PENDING,
      priority: taskConfig.priority || 0,

      // 执行配置
      executor: taskConfig.executor || null, // 执行函数
      steps: taskConfig.steps || [], // 任务步骤列表
      currentStep: 0,
      totalSteps: taskConfig.steps?.length || 0,

      // 进度跟踪
      progress: 0, // 0-100
      progressMessage: '',

      // 结果
      result: null,
      error: null,

      // 检查点
      checkpoints: [],
      lastCheckpointAt: null,

      // 重试
      retryCount: 0,
      maxRetries: taskConfig.maxRetries || this.options.maxRetries,

      // 时间
      createdAt: Date.now(),
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      estimatedDuration: taskConfig.estimatedDuration || null,

      // 元数据
      metadata: {
        ...taskConfig.metadata,
      },
    };

    this.activeTasks.set(taskId, task);

    // 保存任务文件
    await this._saveTask(task);

    this._log(`任务已创建: ${task.name} (${taskId})`);
    this.emit('task-created', { task });

    return task;
  }

  /**
   * 启动任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<void>}
   */
  async startTask(taskId) {
    const task = this.activeTasks.get(taskId);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    if (task.status === TaskStatus.RUNNING) {
      throw new Error(`任务已在运行: ${taskId}`);
    }

    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();

    await this._saveTask(task);

    this._log(`任务已启动: ${task.name} (${taskId})`);
    this.emit('task-started', { task });

    // 启动检查点定时器
    this._startCheckpointTimer(taskId);

    // 在后台执行任务
    const executorPromise = this._executeTask(task);
    this.taskExecutors.set(taskId, executorPromise);

    // 如果设置了超时，添加超时处理
    if (this.options.taskTimeout > 0) {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('任务超时')), this.options.taskTimeout)
      );

      Promise.race([executorPromise, timeoutPromise])
        .catch(error => {
          if (error.message === '任务超时') {
            this._handleTaskFailure(task, error);
          }
        });
    }
  }

  /**
   * 暂停任务
   * @param {string} taskId - 任务 ID
   */
  async pauseTask(taskId) {
    const task = this.activeTasks.get(taskId);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    if (task.status !== TaskStatus.RUNNING) {
      throw new Error(`任务未在运行: ${taskId}`);
    }

    task.status = TaskStatus.PAUSED;
    task.pausedAt = Date.now();

    // 创建暂停检查点
    await this.createCheckpoint(taskId, { reason: 'pause' });

    // 停止检查点定时器
    this._stopCheckpointTimer(taskId);

    await this._saveTask(task);

    this._log(`任务已暂停: ${task.name} (${taskId})`);
    this.emit('task-paused', { task });
  }

  /**
   * 继续任务
   * @param {string} taskId - 任务 ID
   */
  async resumeTask(taskId) {
    const task = this.activeTasks.get(taskId);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    if (task.status !== TaskStatus.PAUSED) {
      throw new Error(`任务未暂停: ${taskId}`);
    }

    task.status = TaskStatus.RUNNING;
    task.pausedAt = null;

    await this._saveTask(task);

    this._log(`任务已继续: ${task.name} (${taskId})`);
    this.emit('task-resumed', { task });

    // 重启检查点定时器
    this._startCheckpointTimer(taskId);

    // 继续执行
    const executorPromise = this._executeTask(task);
    this.taskExecutors.set(taskId, executorPromise);
  }

  /**
   * 取消任务
   * @param {string} taskId - 任务 ID
   * @param {string} reason - 取消原因
   */
  async cancelTask(taskId, reason = '') {
    const task = this.activeTasks.get(taskId);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    task.status = TaskStatus.CANCELLED;
    task.completedAt = Date.now();
    task.error = { message: `任务被取消: ${reason}` };

    // 停止检查点定时器
    this._stopCheckpointTimer(taskId);

    // 移除执行器
    this.taskExecutors.delete(taskId);

    await this._saveTask(task);

    this._log(`任务已取消: ${task.name} (${taskId}), 原因: ${reason}`);
    this.emit('task-cancelled', { task, reason });
  }

  /**
   * 获取任务状态
   * @param {string} taskId - 任务 ID
   * @returns {Object} 任务状态
   */
  getTaskStatus(taskId) {
    const task = this.activeTasks.get(taskId);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    const duration = task.completedAt
      ? task.completedAt - task.startedAt
      : task.startedAt
      ? Date.now() - task.startedAt
      : 0;

    return {
      id: task.id,
      name: task.name,
      status: task.status,
      progress: task.progress,
      progressMessage: task.progressMessage,
      currentStep: task.currentStep,
      totalSteps: task.totalSteps,
      duration,
      estimatedTimeRemaining: this._estimateTimeRemaining(task),
      checkpointCount: task.checkpoints.length,
      retryCount: task.retryCount,
      error: task.error,
    };
  }

  // ==========================================
  // 任务执行
  // ==========================================

  /**
   * 执行任务
   * @private
   */
  async _executeTask(task) {
    try {
      this._log(`开始执行任务: ${task.name} (${task.id})`);

      // 如果有自定义执行器，使用它
      if (task.executor && typeof task.executor === 'function') {
        const result = await task.executor(task, this._createTaskContext(task));
        await this._handleTaskSuccess(task, result);
        return;
      }

      // 否则，按步骤执行
      if (task.steps && task.steps.length > 0) {
        await this._executeSteps(task);
        return;
      }

      throw new Error('任务没有执行器或步骤');
    } catch (error) {
      await this._handleTaskFailure(task, error);
    }
  }

  /**
   * 按步骤执行任务
   * @private
   */
  async _executeSteps(task) {
    const context = this._createTaskContext(task);

    for (let i = task.currentStep; i < task.steps.length; i++) {
      // 检查是否已暂停或取消
      if (task.status !== TaskStatus.RUNNING) {
        this._log(`任务被中断: ${task.name}, 状态: ${task.status}`);
        return;
      }

      const step = task.steps[i];
      task.currentStep = i;
      task.progress = Math.round(((i + 1) / task.steps.length) * 100);
      task.progressMessage = step.name || `步骤 ${i + 1}/${task.steps.length}`;

      this._log(`执行步骤 ${i + 1}/${task.steps.length}: ${step.name}`);
      this.emit('task-progress', { task, step: i + 1, total: task.steps.length });

      try {
        if (typeof step.execute === 'function') {
          const stepResult = await step.execute(context);
          context.stepResults.push(stepResult);
        }
      } catch (error) {
        this._log(`步骤执行失败: ${step.name}, 错误: ${error.message}`, 'error');

        if (step.required !== false) {
          throw error;
        } else {
          this._log(`步骤失败但非必需，继续执行`, 'warn');
          context.stepResults.push({ error: error.message });
        }
      }

      await this._saveTask(task);
    }

    // 所有步骤完成
    await this._handleTaskSuccess(task, { stepResults: context.stepResults });
  }

  /**
   * 创建任务上下文
   * @private
   */
  _createTaskContext(task) {
    return {
      taskId: task.id,
      teamId: task.teamId,
      metadata: task.metadata,
      stepResults: [],

      // 进度更新函数
      updateProgress: async (progress, message) => {
        task.progress = Math.min(100, Math.max(0, progress));
        task.progressMessage = message || '';
        await this._saveTask(task);
        this.emit('task-progress', { task, progress, message });
      },

      // 创建检查点函数
      createCheckpoint: async (metadata) => {
        return await this.createCheckpoint(task.id, metadata);
      },

      // 日志函数
      log: (message, level = 'info') => {
        this._log(`[Task ${task.id}] ${message}`, level);
      },
    };
  }

  /**
   * 处理任务成功
   * @private
   */
  async _handleTaskSuccess(task, result) {
    task.status = TaskStatus.COMPLETED;
    task.completedAt = Date.now();
    task.progress = 100;
    task.progressMessage = '已完成';
    task.result = result;

    // 停止检查点定时器
    this._stopCheckpointTimer(task.id);

    // 保存结果
    await this._saveTaskResult(task);
    await this._saveTask(task);

    this._log(`任务完成: ${task.name} (${task.id})`);
    this.emit('task-completed', { task, result });
  }

  /**
   * 处理任务失败
   * @private
   */
  async _handleTaskFailure(task, error) {
    this._log(`任务失败: ${task.name}, 错误: ${error.message}`, 'error');

    task.retryCount++;

    // 如果还可以重试
    if (task.retryCount <= task.maxRetries && this.options.autoRecovery) {
      this._log(`准备重试任务 (${task.retryCount}/${task.maxRetries})`, 'warn');
      task.status = TaskStatus.PAUSED;
      await this._saveTask(task);

      // 延迟后重试
      setTimeout(async () => {
        try {
          await this.resumeTask(task.id);
        } catch (retryError) {
          this._log(`重试任务失败: ${retryError.message}`, 'error');
          await this._markTaskFailed(task, retryError);
        }
      }, this.options.retryDelay);
    } else {
      // 标记为失败
      await this._markTaskFailed(task, error);
    }
  }

  /**
   * 标记任务失败
   * @private
   */
  async _markTaskFailed(task, error) {
    task.status = TaskStatus.FAILED;
    task.completedAt = Date.now();
    task.error = {
      message: error.message,
      stack: error.stack,
      retryCount: task.retryCount,
    };

    // 停止检查点定时器
    this._stopCheckpointTimer(task.id);

    await this._saveTask(task);

    this.emit('task-failed', { task, error });
  }

  // ==========================================
  // 检查点管理
  // ==========================================

  /**
   * 创建检查点
   * @param {string} taskId - 任务 ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 检查点信息
   */
  async createCheckpoint(taskId, metadata = {}) {
    const task = this.activeTasks.get(taskId);

    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    const checkpointId = `cp_${Date.now()}_${uuidv4().slice(0, 8)}`;

    const checkpoint = {
      id: checkpointId,
      taskId,
      taskState: JSON.parse(JSON.stringify(task)), // 深拷贝
      timestamp: Date.now(),
      metadata,
    };

    task.checkpoints.push(checkpointId);
    task.lastCheckpointAt = Date.now();

    // 保存检查点到文件
    const checkpointFile = path.join(
      this.options.dataDir,
      'checkpoints',
      `${checkpointId}.json`
    );
    await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf-8');

    // 保存到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_checkpoints (id, team_id, task_id, checkpoint_data, timestamp, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [checkpointId, task.teamId, taskId, JSON.stringify(checkpoint.taskState), checkpoint.timestamp, JSON.stringify(metadata)]
        );
      } catch (error) {
        this._log(`保存检查点到数据库失败: ${error.message}`, 'error');
      }
    }

    this._log(`检查点已创建: ${checkpointId}`);
    this.emit('checkpoint-created', { taskId, checkpointId, checkpoint });

    return { id: checkpointId, timestamp: checkpoint.timestamp };
  }

  /**
   * 从检查点恢复任务
   * @param {string} checkpointId - 检查点 ID
   * @returns {Promise<Object>} 恢复的任务
   */
  async restoreFromCheckpoint(checkpointId) {
    const checkpointFile = path.join(
      this.options.dataDir,
      'checkpoints',
      `${checkpointId}.json`
    );

    try {
      const checkpointData = await fs.readFile(checkpointFile, 'utf-8');
      const checkpoint = JSON.parse(checkpointData);

      const task = checkpoint.taskState;
      task.status = TaskStatus.PAUSED; // 恢复后处于暂停状态
      task.metadata.restoredFrom = checkpointId;
      task.metadata.restoredAt = Date.now();

      this.activeTasks.set(task.id, task);

      this._log(`任务已从检查点恢复: ${task.name} (${task.id})`);
      this.emit('task-restored', { task, checkpointId });

      return task;
    } catch (error) {
      this._log(`恢复检查点失败: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 启动检查点定时器
   * @private
   */
  _startCheckpointTimer(taskId) {
    if (this.checkpointTimers.has(taskId)) {
      return; // 已有定时器
    }

    const timer = setInterval(async () => {
      try {
        await this.createCheckpoint(taskId, { auto: true });
      } catch (error) {
        this._log(`自动创建检查点失败: ${error.message}`, 'error');
      }
    }, this.options.checkpointInterval);

    this.checkpointTimers.set(taskId, timer);
  }

  /**
   * 停止检查点定时器
   * @private
   */
  _stopCheckpointTimer(taskId) {
    const timer = this.checkpointTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.checkpointTimers.delete(taskId);
    }
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 保存任务到文件
   * @private
   */
  async _saveTask(task) {
    const taskFile = path.join(this.options.dataDir, `${task.id}.json`);
    await fs.writeFile(taskFile, JSON.stringify(task, null, 2), 'utf-8');
  }

  /**
   * 保存任务结果
   * @private
   */
  async _saveTaskResult(task) {
    if (!task.result) {
      return;
    }

    const resultFile = path.join(this.options.dataDir, 'results', `${task.id}_result.json`);
    await fs.writeFile(resultFile, JSON.stringify(task.result, null, 2), 'utf-8');
  }

  /**
   * 估算剩余时间
   * @private
   */
  _estimateTimeRemaining(task) {
    if (!task.startedAt || task.progress === 0) {
      return task.estimatedDuration || null;
    }

    const elapsed = Date.now() - task.startedAt;
    const estimatedTotal = (elapsed / task.progress) * 100;
    const remaining = estimatedTotal - elapsed;

    return Math.max(0, Math.round(remaining));
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = 'info') {
    if (level === 'error') {
      logger.error(`[LongRunningTaskManager] ${message}`);
    } else if (level === 'warn') {
      logger.warn(`[LongRunningTaskManager] ${message}`);
    } else {
      logger.info(`[LongRunningTaskManager] ${message}`);
    }
  }

  /**
   * 获取所有活跃任务
   * @returns {Array}
   */
  getAllActiveTasks() {
    return Array.from(this.activeTasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      progress: t.progress,
      progressMessage: t.progressMessage,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
    }));
  }

  /**
   * 清理已完成的任务
   */
  async cleanupCompletedTasks() {
    const now = Date.now();
    const retentionTime = this.options.retentionDays * 24 * 60 * 60 * 1000;

    const toDelete = [];

    for (const [taskId, task] of this.activeTasks.entries()) {
      if (
        (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) &&
        task.completedAt &&
        now - task.completedAt > retentionTime
      ) {
        toDelete.push(taskId);
      }
    }

    for (const taskId of toDelete) {
      this.activeTasks.delete(taskId);

      // 删除任务文件
      const taskFile = path.join(this.options.dataDir, `${taskId}.json`);
      try {
        await fs.unlink(taskFile);
      } catch (error) {
        // 忽略文件不存在的错误
      }
    }

    this._log(`已清理 ${toDelete.length} 个已完成的任务`);
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const tasks = Array.from(this.activeTasks.values());

    return {
      totalTasks: tasks.length,
      runningTasks: tasks.filter(t => t.status === TaskStatus.RUNNING).length,
      pausedTasks: tasks.filter(t => t.status === TaskStatus.PAUSED).length,
      completedTasks: tasks.filter(t => t.status === TaskStatus.COMPLETED).length,
      failedTasks: tasks.filter(t => t.status === TaskStatus.FAILED).length,
      cancelledTasks: tasks.filter(t => t.status === TaskStatus.CANCELLED).length,
      totalCheckpoints: tasks.reduce((sum, t) => sum + t.checkpoints.length, 0),
    };
  }
}

module.exports = { LongRunningTaskManager, TaskStatus };
