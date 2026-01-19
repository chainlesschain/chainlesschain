/**
 * 统一进度通知系统
 *
 * 核心功能：
 * - 标准化进度事件格式
 * - 多任务并发追踪
 * - 层级进度聚合（子任务 -> 父任务）
 * - 进度持久化（可选）
 * - IPC 自动转发（Electron）
 *
 * v0.18.0: 新建文件，统一多媒体处理的进度通知
 */

const { EventEmitter } = require('events');

/**
 * 进度阶段枚举
 */
const ProgressStage = {
  PENDING: 'pending',           // 等待中
  PREPARING: 'preparing',       // 准备中
  PROCESSING: 'processing',     // 处理中
  FINALIZING: 'finalizing',     // 收尾中
  COMPLETED: 'completed',       // 已完成
  FAILED: 'failed',             // 失败
  CANCELLED: 'cancelled',       // 已取消
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  autoForwardToIPC: true,       // 自动转发到 IPC（Electron）
  persistProgress: false,       // 持久化进度
  throttleInterval: 100,        // 节流间隔（毫秒）
  enableHierarchy: true,        // 启用层级进度
};

/**
 * 统一进度通知器类
 */
class ProgressEmitter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 任务追踪
    this.tasks = new Map();
    this.taskHierarchy = new Map(); // taskId -> parentTaskId

    // 节流控制
    this.lastEmitTime = new Map();

    // IPC 窗口引用（Electron）
    this.mainWindow = null;

    console.log('[ProgressEmitter] 初始化统一进度通知系统');
  }

  /**
   * 设置主窗口（用于 IPC 转发）
   * @param {BrowserWindow} window - Electron 主窗口
   */
  setMainWindow(window) {
    this.mainWindow = window;
    console.log('[ProgressEmitter] IPC 转发已启用');
  }

  /**
   * 创建任务追踪器
   * @param {string} taskId - 任务唯一标识
   * @param {Object} options - 任务选项
   * @returns {Object} 任务追踪器
   */
  createTracker(taskId, options = {}) {
    const {
      title = taskId,              // 任务标题
      description = '',            // 任务描述
      totalSteps = 100,            // 总步数（用于计算百分比）
      parentTaskId = null,         // 父任务ID（层级进度）
      metadata = {},               // 元数据
    } = options;

    // 初始化任务信息
    const taskInfo = {
      taskId: taskId,
      title: title,
      description: description,
      stage: ProgressStage.PENDING,
      percent: 0,
      currentStep: 0,
      totalSteps: totalSteps,
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      message: '',
      metadata: metadata,
      parentTaskId: parentTaskId,
      childTasks: [],
      error: null,
    };

    this.tasks.set(taskId, taskInfo);

    // 设置层级关系
    if (parentTaskId) {
      this.taskHierarchy.set(taskId, parentTaskId);
      const parent = this.tasks.get(parentTaskId);
      if (parent) {
        parent.childTasks.push(taskId);
      }
    }

    // 发送初始事件
    this.emitProgress(taskId, {
      stage: ProgressStage.PENDING,
      percent: 0,
      message: `任务创建: ${title}`,
    });

    // 返回追踪器对象
    return {
      /**
       * 更新步进（自动计算百分比）
       * @param {string} message - 进度消息
       * @param {number} increment - 步进增量（默认1）
       */
      step: (message = '', increment = 1) => {
        const task = this.tasks.get(taskId);
        if (!task) {return;}

        task.currentStep = Math.min(task.currentStep + increment, task.totalSteps);
        task.percent = Math.round((task.currentStep / task.totalSteps) * 100);
        task.message = message;

        this.emitProgress(taskId, {
          percent: task.percent,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          message: message,
        });
      },

      /**
       * 直接设置百分比
       * @param {number} percent - 百分比 (0-100)
       * @param {string} message - 进度消息
       */
      setPercent: (percent, message = '') => {
        const task = this.tasks.get(taskId);
        if (!task) {return;}

        task.percent = Math.min(Math.max(percent, 0), 100);
        task.currentStep = Math.round((task.percent / 100) * task.totalSteps);
        task.message = message;

        this.emitProgress(taskId, {
          percent: task.percent,
          message: message,
        });
      },

      /**
       * 设置任务阶段
       * @param {string} stage - 阶段（使用 ProgressStage 枚举）
       * @param {string} message - 消息
       */
      setStage: (stage, message = '') => {
        const task = this.tasks.get(taskId);
        if (!task) {return;}

        task.stage = stage;
        task.message = message;

        this.emitProgress(taskId, {
          stage: stage,
          message: message,
        });
      },

      /**
       * 任务完成
       * @param {Object} result - 任务结果
       */
      complete: (result = {}) => {
        const task = this.tasks.get(taskId);
        if (!task) {return;}

        task.stage = ProgressStage.COMPLETED;
        task.percent = 100;
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        task.message = result.message || '任务完成';

        this.emitProgress(taskId, {
          stage: ProgressStage.COMPLETED,
          percent: 100,
          message: task.message,
          result: result,
          duration: task.duration,
        });

        // 如果有父任务，更新父任务进度
        this.updateParentProgress(taskId);

        // 延迟清理（5秒后）
        setTimeout(() => {
          this.removeTask(taskId);
        }, 5000);
      },

      /**
       * 任务失败
       * @param {Error|string} error - 错误信息
       */
      error: (error) => {
        const task = this.tasks.get(taskId);
        if (!task) {return;}

        const errorMessage = error instanceof Error ? error.message : error;

        task.stage = ProgressStage.FAILED;
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        task.error = errorMessage;
        task.message = `任务失败: ${errorMessage}`;

        this.emitProgress(taskId, {
          stage: ProgressStage.FAILED,
          message: task.message,
          error: errorMessage,
          duration: task.duration,
        });

        // 更新父任务
        this.updateParentProgress(taskId);

        // 延迟清理（10秒后）
        setTimeout(() => {
          this.removeTask(taskId);
        }, 10000);
      },

      /**
       * 取消任务
       * @param {string} reason - 取消原因
       */
      cancel: (reason = '用户取消') => {
        const task = this.tasks.get(taskId);
        if (!task) {return;}

        task.stage = ProgressStage.CANCELLED;
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        task.message = `任务已取消: ${reason}`;

        this.emitProgress(taskId, {
          stage: ProgressStage.CANCELLED,
          message: task.message,
          duration: task.duration,
        });

        // 延迟清理（5秒后）
        setTimeout(() => {
          this.removeTask(taskId);
        }, 5000);
      },

      /**
       * 获取任务信息
       * @returns {Object} 任务信息
       */
      getInfo: () => {
        return this.tasks.get(taskId);
      },
    };
  }

  /**
   * 发送进度事件（带节流）
   * @param {string} taskId - 任务ID
   * @param {Object} progress - 进度数据
   */
  emitProgress(taskId, progress) {
    const task = this.tasks.get(taskId);
    if (!task) {return;}

    // 更新任务信息
    Object.assign(task, progress);

    // 节流控制（除非是完成/失败/取消事件）
    const now = Date.now();
    const lastEmit = this.lastEmitTime.get(taskId) || 0;
    const isTerminalStage = [
      ProgressStage.COMPLETED,
      ProgressStage.FAILED,
      ProgressStage.CANCELLED,
    ].includes(task.stage);

    if (!isTerminalStage && now - lastEmit < this.config.throttleInterval) {
      return; // 节流跳过
    }

    this.lastEmitTime.set(taskId, now);

    // 构建事件数据
    const eventData = {
      taskId: taskId,
      title: task.title,
      description: task.description,
      stage: task.stage,
      percent: task.percent,
      currentStep: task.currentStep,
      totalSteps: task.totalSteps,
      message: task.message,
      startTime: task.startTime,
      duration: task.duration,
      metadata: task.metadata,
      ...progress,
    };

    // 发送本地事件
    this.emit('progress', eventData);
    this.emit(`progress:${taskId}`, eventData);

    // IPC 转发（Electron）
    if (this.config.autoForwardToIPC && this.mainWindow && this.mainWindow.webContents) {
      try {
        this.mainWindow.webContents.send('task-progress', eventData);
        this.mainWindow.webContents.send(`task-progress:${taskId}`, eventData);
      } catch (error) {
        console.warn('[ProgressEmitter] IPC 转发失败:', error.message);
      }
    }

    // 持久化（可选）
    if (this.config.persistProgress) {
      this.persistTaskProgress(taskId, eventData);
    }
  }

  /**
   * 更新父任务进度（聚合子任务）
   * @param {string} childTaskId - 子任务ID
   */
  updateParentProgress(childTaskId) {
    if (!this.config.enableHierarchy) {return;}

    const parentTaskId = this.taskHierarchy.get(childTaskId);
    if (!parentTaskId) {return;}

    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask) {return;}

    // 聚合所有子任务的进度
    const childIds = parentTask.childTasks;
    if (childIds.length === 0) {return;}

    let totalPercent = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (const childId of childIds) {
      const childTask = this.tasks.get(childId);
      if (!childTask) {continue;}

      totalPercent += childTask.percent;

      if (childTask.stage === ProgressStage.COMPLETED) {
        completedCount++;
      } else if (childTask.stage === ProgressStage.FAILED) {
        failedCount++;
      }
    }

    // 计算父任务进度
    const avgPercent = Math.round(totalPercent / childIds.length);

    // 更新父任务
    parentTask.percent = avgPercent;
    parentTask.currentStep = Math.round((avgPercent / 100) * parentTask.totalSteps);

    // 如果所有子任务完成，父任务也完成
    if (completedCount === childIds.length) {
      parentTask.stage = ProgressStage.COMPLETED;
    } else if (failedCount > 0) {
      parentTask.stage = ProgressStage.PROCESSING; // 有失败但继续
    }

    this.emitProgress(parentTaskId, {
      percent: avgPercent,
      message: `子任务进度: ${completedCount}/${childIds.length} 已完成`,
    });
  }

  /**
   * 持久化任务进度（可选）
   * @param {string} taskId - 任务ID
   * @param {Object} eventData - 事件数据
   */
  persistTaskProgress(taskId, eventData) {
    // TODO: 实现进度持久化（如保存到数据库或文件）
    // 这里仅记录日志作为占位
    console.log(`[ProgressEmitter] 持久化进度: ${taskId} - ${eventData.percent}%`);
  }

  /**
   * 移除任务
   * @param {string} taskId - 任务ID
   */
  removeTask(taskId) {
    this.tasks.delete(taskId);
    this.taskHierarchy.delete(taskId);
    this.lastEmitTime.delete(taskId);
  }

  /**
   * 获取所有活动任务
   * @returns {Array} 任务列表
   */
  getActiveTasks() {
    const tasks = [];
    for (const [taskId, taskInfo] of this.tasks.entries()) {
      tasks.push({ ...taskInfo });
    }
    return tasks;
  }

  /**
   * 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {Object|null} 任务信息
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 清空所有任务
   */
  clearAll() {
    this.tasks.clear();
    this.taskHierarchy.clear();
    this.lastEmitTime.clear();
    console.log('[ProgressEmitter] 所有任务已清空');
  }
}

// 导出枚举和类
ProgressEmitter.Stage = ProgressStage;

module.exports = ProgressEmitter;
