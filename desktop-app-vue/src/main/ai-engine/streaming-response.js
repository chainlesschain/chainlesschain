/**
 * 流式响应模块 (Streaming Response)
 *
 * 功能:
 * 1. 进度反馈 - 实时报告任务执行进度
 * 2. 取消机制 - 允许用户中断正在执行的任务
 * 3. 部分结果流式返回 - 逐步返回中间结果
 * 4. IPC事件系统 - 与UI层实时通信
 * 5. 状态管理 - 跟踪任务生命周期
 *
 * @module streaming-response
 */

const EventEmitter = require('events');

/**
 * 任务状态
 */
const TaskStatus = {
  PENDING: 'pending',       // 等待中
  RUNNING: 'running',       // 执行中
  COMPLETED: 'completed',   // 已完成
  FAILED: 'failed',         // 失败
  CANCELLED: 'cancelled'    // 已取消
};

/**
 * 进度事件类型
 */
const ProgressEventType = {
  STARTED: 'started',           // 任务开始
  PROGRESS: 'progress',         // 进度更新
  MILESTONE: 'milestone',       // 里程碑达成
  RESULT: 'result',             // 部分结果
  COMPLETED: 'completed',       // 任务完成
  FAILED: 'failed',             // 任务失败
  CANCELLED: 'cancelled'        // 任务取消
};

/**
 * 取消令牌
 * 用于传递取消信号
 */
class CancellationToken {
  constructor() {
    this.cancelled = false;
    this.cancelReason = null;
    this.callbacks = [];
  }

  /**
   * 请求取消
   */
  cancel(reason = 'User cancelled') {
    if (this.cancelled) return;

    this.cancelled = true;
    this.cancelReason = reason;

    // 通知所有监听器
    for (const callback of this.callbacks) {
      try {
        callback(reason);
      } catch (error) {
        console.error('[CancellationToken] 回调执行失败:', error);
      }
    }
  }

  /**
   * 检查是否已取消
   */
  isCancelled() {
    return this.cancelled;
  }

  /**
   * 抛出取消异常（如果已取消）
   */
  throwIfCancelled() {
    if (this.cancelled) {
      const error = new Error(this.cancelReason || 'Operation cancelled');
      error.code = 'CANCELLED';
      throw error;
    }
  }

  /**
   * 注册取消回调
   */
  onCancelled(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    if (this.cancelled) {
      // 如果已经取消，立即执行回调
      callback(this.cancelReason);
    } else {
      this.callbacks.push(callback);
    }

    // 返回取消注册的函数
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index !== -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }
}

/**
 * 流式任务执行器
 */
class StreamingTask extends EventEmitter {
  constructor(taskId, config = {}) {
    super();

    this.taskId = taskId;
    this.status = TaskStatus.PENDING;
    this.progress = 0;
    this.totalSteps = 0;
    this.currentStep = 0;
    this.startTime = null;
    this.endTime = null;
    this.results = [];
    this.error = null;

    this.config = {
      enableProgressTracking: true,
      enablePartialResults: true,
      progressUpdateInterval: 100, // ms
      maxResultBuffer: 100,
      ...config
    };

    // 取消令牌
    this.cancellationToken = new CancellationToken();

    // 上次进度更新时间
    this.lastProgressUpdate = 0;
  }

  /**
   * 开始任务
   */
  start(totalSteps = 0) {
    if (this.status !== TaskStatus.PENDING) {
      throw new Error(`Cannot start task in ${this.status} status`);
    }

    this.status = TaskStatus.RUNNING;
    this.startTime = Date.now();
    this.totalSteps = totalSteps;
    this.currentStep = 0;
    this.progress = 0;

    this._emitEvent(ProgressEventType.STARTED, {
      taskId: this.taskId,
      totalSteps: this.totalSteps,
      timestamp: this.startTime
    });
  }

  /**
   * 更新进度
   */
  updateProgress(step, message = '', metadata = {}) {
    this.cancellationToken.throwIfCancelled();

    if (this.status !== TaskStatus.RUNNING) {
      return;
    }

    this.currentStep = step;

    // 计算进度百分比
    if (this.totalSteps > 0) {
      this.progress = Math.min((step / this.totalSteps) * 100, 100);
    }

    // 节流：避免过于频繁的更新
    const now = Date.now();
    if (this.config.enableProgressTracking &&
        now - this.lastProgressUpdate >= this.config.progressUpdateInterval) {

      this.lastProgressUpdate = now;

      this._emitEvent(ProgressEventType.PROGRESS, {
        taskId: this.taskId,
        step: this.currentStep,
        totalSteps: this.totalSteps,
        progress: this.progress,
        message,
        metadata,
        timestamp: now
      });
    }
  }

  /**
   * 报告里程碑
   */
  milestone(name, data = {}) {
    this.cancellationToken.throwIfCancelled();

    this._emitEvent(ProgressEventType.MILESTONE, {
      taskId: this.taskId,
      name,
      data,
      progress: this.progress,
      timestamp: Date.now()
    });
  }

  /**
   * 添加部分结果
   */
  addResult(result) {
    this.cancellationToken.throwIfCancelled();

    if (!this.config.enablePartialResults) {
      return;
    }

    // 添加到结果缓冲区
    this.results.push(result);

    // 限制缓冲区大小
    if (this.results.length > this.config.maxResultBuffer) {
      this.results.shift();
    }

    this._emitEvent(ProgressEventType.RESULT, {
      taskId: this.taskId,
      result,
      totalResults: this.results.length,
      timestamp: Date.now()
    });
  }

  /**
   * 完成任务
   */
  complete(finalResult = null) {
    if (this.status !== TaskStatus.RUNNING) {
      return;
    }

    this.status = TaskStatus.COMPLETED;
    this.endTime = Date.now();
    this.progress = 100;

    if (finalResult !== null) {
      this.results.push(finalResult);
    }

    this._emitEvent(ProgressEventType.COMPLETED, {
      taskId: this.taskId,
      results: this.results,
      duration: this.endTime - this.startTime,
      timestamp: this.endTime
    });
  }

  /**
   * 任务失败
   */
  fail(error) {
    if (this.status !== TaskStatus.RUNNING) {
      return;
    }

    this.status = TaskStatus.FAILED;
    this.endTime = Date.now();
    this.error = error;

    this._emitEvent(ProgressEventType.FAILED, {
      taskId: this.taskId,
      error: error.message || String(error),
      stack: error.stack,
      duration: this.endTime - this.startTime,
      timestamp: this.endTime
    });
  }

  /**
   * 取消任务
   */
  cancel(reason = 'User cancelled') {
    if (this.status !== TaskStatus.RUNNING && this.status !== TaskStatus.PENDING) {
      return;
    }

    this.cancellationToken.cancel(reason);
    this.status = TaskStatus.CANCELLED;
    this.endTime = Date.now();

    this._emitEvent(ProgressEventType.CANCELLED, {
      taskId: this.taskId,
      reason,
      progress: this.progress,
      duration: this.startTime ? this.endTime - this.startTime : 0,
      timestamp: this.endTime
    });
  }

  /**
   * 获取取消令牌
   */
  getCancellationToken() {
    return this.cancellationToken;
  }

  /**
   * 获取任务状态
   */
  getStatus() {
    return {
      taskId: this.taskId,
      status: this.status,
      progress: this.progress,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime ? this.endTime - this.startTime : (this.startTime ? Date.now() - this.startTime : 0),
      results: this.results,
      error: this.error
    };
  }

  /**
   * 发送事件
   */
  _emitEvent(type, data) {
    this.emit('event', {
      type,
      data,
      taskId: this.taskId,
      timestamp: Date.now()
    });
  }
}

/**
 * 流式响应管理器
 */
class StreamingResponse {
  constructor(config = {}) {
    this.config = {
      enableStreaming: true,
      enableProgressTracking: true,
      enablePartialResults: true,
      maxConcurrentTasks: 10,
      taskTimeout: 300000, // 5分钟
      ...config
    };

    // 活跃任务
    this.activeTasks = new Map();

    // IPC通道（Electron环境）
    this.ipcChannel = null;

    // 数据库连接
    this.db = null;

    // 统计
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      cancelledTasks: 0,
      totalDuration: 0
    };
  }

  /**
   * 设置IPC通道
   * 在Electron环境中用于与渲染进程通信
   */
  setIPC(ipcChannel) {
    this.ipcChannel = ipcChannel;
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 创建流式任务
   */
  createTask(taskId, config = {}) {
    if (this.activeTasks.has(taskId)) {
      throw new Error(`Task ${taskId} already exists`);
    }

    if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
      throw new Error(`Maximum concurrent tasks (${this.config.maxConcurrentTasks}) reached`);
    }

    const task = new StreamingTask(taskId, {
      enableProgressTracking: this.config.enableProgressTracking,
      enablePartialResults: this.config.enablePartialResults,
      ...config
    });

    // 监听任务事件并转发
    task.on('event', (event) => {
      this._handleTaskEvent(event);
    });

    // 设置超时
    if (this.config.taskTimeout > 0) {
      const timeout = setTimeout(() => {
        if (task.status === TaskStatus.RUNNING) {
          task.fail(new Error(`Task timeout after ${this.config.taskTimeout}ms`));
        }
      }, this.config.taskTimeout);

      // 任务完成/失败/取消时清除超时
      task.on('event', (event) => {
        if ([ProgressEventType.COMPLETED, ProgressEventType.FAILED, ProgressEventType.CANCELLED].includes(event.type)) {
          clearTimeout(timeout);
        }
      });
    }

    this.activeTasks.set(taskId, task);
    this.stats.totalTasks++;

    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId) {
    return this.activeTasks.get(taskId);
  }

  /**
   * 取消任务
   */
  cancelTask(taskId, reason = 'User cancelled') {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.cancel(reason);
  }

  /**
   * 清理已完成的任务
   */
  cleanupTask(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return;
    }

    // 只清理已完成/失败/取消的任务
    if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(task.status)) {
      this.activeTasks.delete(taskId);
    }
  }

  /**
   * 处理任务事件
   */
  _handleTaskEvent(event) {
    // 更新统计
    if (event.type === ProgressEventType.COMPLETED) {
      this.stats.completedTasks++;
      this.stats.totalDuration += event.data.duration || 0;
    } else if (event.type === ProgressEventType.FAILED) {
      this.stats.failedTasks++;
      this.stats.totalDuration += event.data.duration || 0;
    } else if (event.type === ProgressEventType.CANCELLED) {
      this.stats.cancelledTasks++;
      this.stats.totalDuration += event.data.duration || 0;
    }

    // 记录到数据库
    this._recordEvent(event);

    // 通过IPC发送到UI层
    this._sendToUI(event);
  }

  /**
   * 记录事件到数据库
   */
  async _recordEvent(event) {
    if (!this.db) {
      return;
    }

    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO streaming_response_events (
          task_id,
          event_type,
          event_data,
          timestamp
        ) VALUES (?, ?, ?, ?)
      `);

      insertStmt.run(
        event.taskId,
        event.type,
        JSON.stringify(event.data),
        new Date(event.timestamp).toISOString()
      );
    } catch (error) {
      console.error('[StreamingResponse] 记录事件失败:', error);
    }
  }

  /**
   * 通过IPC发送事件到UI层
   */
  _sendToUI(event) {
    if (!this.ipcChannel) {
      return;
    }

    try {
      // 在Electron环境中，使用webContents.send发送事件
      if (this.ipcChannel.send) {
        this.ipcChannel.send('streaming-response-event', event);
      }
    } catch (error) {
      console.error('[StreamingResponse] 发送IPC事件失败:', error);
    }
  }

  /**
   * 获取所有活跃任务
   */
  getActiveTasks() {
    const tasks = [];
    for (const [taskId, task] of this.activeTasks.entries()) {
      tasks.push(task.getStatus());
    }
    return tasks;
  }

  /**
   * 获取任务统计
   */
  getStats() {
    return {
      ...this.stats,
      activeTasks: this.activeTasks.size,
      avgDuration: this.stats.completedTasks > 0
        ? this.stats.totalDuration / this.stats.completedTasks
        : 0,
      successRate: this.stats.totalTasks > 0
        ? (this.stats.completedTasks / this.stats.totalTasks * 100).toFixed(2) + '%'
        : '0%',
      cancellationRate: this.stats.totalTasks > 0
        ? (this.stats.cancelledTasks / this.stats.totalTasks * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 获取任务历史（从数据库）
   */
  async getTaskHistory(options = {}) {
    if (!this.db) {
      return [];
    }

    try {
      const { taskId, eventType, limit = 100, offset = 0 } = options;

      let whereClauses = [];
      let params = [];

      if (taskId) {
        whereClauses.push('task_id = ?');
        params.push(taskId);
      }

      if (eventType) {
        whereClauses.push('event_type = ?');
        params.push(eventType);
      }

      const whereClause = whereClauses.length > 0
        ? `WHERE ${whereClauses.join(' AND ')}`
        : '';

      const query = `
        SELECT *
        FROM streaming_response_events
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);

      const events = this.db.prepare(query).all(...params);

      // 解析JSON数据
      return events.map(event => ({
        ...event,
        event_data: JSON.parse(event.event_data)
      }));

    } catch (error) {
      console.error('[StreamingResponse] 获取任务历史失败:', error);
      return [];
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 取消所有活跃任务
    for (const [taskId, task] of this.activeTasks.entries()) {
      if (task.status === TaskStatus.RUNNING) {
        task.cancel('Cleanup');
      }
    }

    this.activeTasks.clear();
    this.ipcChannel = null;
    this.db = null;
  }
}

/**
 * 辅助函数：包装异步函数以支持流式进度
 */
async function withStreaming(taskId, streamingResponse, asyncFn, totalSteps = 0) {
  const task = streamingResponse.createTask(taskId);
  const cancellationToken = task.getCancellationToken();

  try {
    task.start(totalSteps);

    // 执行异步函数，传入任务和取消令牌
    const result = await asyncFn(task, cancellationToken);

    task.complete(result);

    return result;

  } catch (error) {
    if (error.code === 'CANCELLED') {
      // 取消已经由task.cancel()处理
    } else {
      task.fail(error);
    }
    throw error;

  } finally {
    // 清理任务（延迟清理，给UI时间显示完成状态）
    setTimeout(() => {
      streamingResponse.cleanupTask(taskId);
    }, 5000);
  }
}

module.exports = {
  StreamingResponse,
  StreamingTask,
  CancellationToken,
  TaskStatus,
  ProgressEventType,
  withStreaming
};
