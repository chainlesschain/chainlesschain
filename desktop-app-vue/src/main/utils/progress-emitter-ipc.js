/**
 * Progress Emitter IPC Module
 *
 * 将统一进度通知系统暴露给渲染进程
 *
 * IPC Handlers (12):
 * - Task Management (4):
 *   - progress:create-task - 创建任务追踪器
 *   - progress:get-task - 获取单个任务信息
 *   - progress:get-active-tasks - 获取所有活动任务
 *   - progress:remove-task - 移除任务
 *
 * - Progress Updates (3):
 *   - progress:step - 更新步进
 *   - progress:set-percent - 设置百分比
 *   - progress:set-stage - 设置阶段
 *
 * - Task Completion (3):
 *   - progress:complete - 完成任务
 *   - progress:error - 任务失败
 *   - progress:cancel - 取消任务
 *
 * - Control (2):
 *   - progress:clear-all - 清空所有任务
 *   - progress:get-config - 获取配置
 *
 * v0.26.3: 新建文件，统一进度通知 IPC 接口
 */

const { logger } = require('./logger.js');
const ProgressEmitter = require('./progress-emitter.js');

// 单例实例
let progressEmitter = null;

// 活动追踪器映射（taskId -> tracker object）
const activeTrackers = new Map();

/**
 * 获取或创建 ProgressEmitter 实例
 * @returns {ProgressEmitter}
 */
function getProgressEmitter() {
  if (!progressEmitter) {
    progressEmitter = new ProgressEmitter();
  }
  return progressEmitter;
}

/**
 * 注册 Progress Emitter IPC handlers
 * @param {Object} options - 注册选项
 * @param {Object} options.ipcMain - Electron ipcMain
 * @param {Object} options.ipcGuard - IPC 防重复注册守卫
 * @param {BrowserWindow} options.mainWindow - 主窗口（可选）
 */
function registerProgressEmitterIPC(options = {}) {
  const { ipcMain, ipcGuard, mainWindow } = options;

  if (!ipcMain) {
    throw new Error('ipcMain is required for registerProgressEmitterIPC');
  }

  // 防止重复注册
  if (ipcGuard && ipcGuard.isModuleRegistered('progress-emitter')) {
    logger.info('[ProgressEmitter-IPC] 模块已注册，跳过');
    return;
  }

  logger.info('[ProgressEmitter-IPC] 注册 IPC handlers...');

  const emitter = getProgressEmitter();

  // 设置主窗口（如果提供）
  if (mainWindow) {
    emitter.setMainWindow(mainWindow);
  }

  // ==================== Task Management ====================

  /**
   * 创建任务追踪器
   * @param {string} taskId - 任务ID
   * @param {Object} options - 任务选项
   * @returns {Object} { success, taskInfo }
   */
  ipcMain.handle('progress:create-task', async (event, taskId, taskOptions = {}) => {
    try {
      if (!taskId || typeof taskId !== 'string') {
        return {
          success: false,
          error: '任务ID必须是非空字符串',
        };
      }

      // 检查是否已存在
      if (activeTrackers.has(taskId)) {
        return {
          success: false,
          error: `任务 ${taskId} 已存在`,
        };
      }

      const tracker = emitter.createTracker(taskId, taskOptions);
      activeTrackers.set(taskId, tracker);

      const taskInfo = tracker.getInfo();

      logger.info(`[ProgressEmitter-IPC] 创建任务: ${taskId}`);

      return {
        success: true,
        taskInfo: {
          taskId: taskInfo.taskId,
          title: taskInfo.title,
          description: taskInfo.description,
          stage: taskInfo.stage,
          percent: taskInfo.percent,
          totalSteps: taskInfo.totalSteps,
          startTime: taskInfo.startTime,
          metadata: taskInfo.metadata,
        },
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 创建任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取单个任务信息
   * @param {string} taskId - 任务ID
   * @returns {Object} { success, task }
   */
  ipcMain.handle('progress:get-task', async (event, taskId) => {
    try {
      if (!taskId) {
        return {
          success: false,
          error: '任务ID不能为空',
        };
      }

      const task = emitter.getTask(taskId);

      if (!task) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在`,
        };
      }

      return {
        success: true,
        task: {
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          stage: task.stage,
          percent: task.percent,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          startTime: task.startTime,
          endTime: task.endTime,
          duration: task.duration,
          message: task.message,
          metadata: task.metadata,
          parentTaskId: task.parentTaskId,
          childTasks: task.childTasks,
          error: task.error,
        },
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 获取任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取所有活动任务
   * @returns {Object} { success, tasks, count }
   */
  ipcMain.handle('progress:get-active-tasks', async () => {
    try {
      const tasks = emitter.getActiveTasks();

      return {
        success: true,
        tasks: tasks.map((task) => ({
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          stage: task.stage,
          percent: task.percent,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          startTime: task.startTime,
          message: task.message,
          parentTaskId: task.parentTaskId,
          childTasks: task.childTasks,
        })),
        count: tasks.length,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 获取活动任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 移除任务
   * @param {string} taskId - 任务ID
   * @returns {Object} { success }
   */
  ipcMain.handle('progress:remove-task', async (event, taskId) => {
    try {
      if (!taskId) {
        return {
          success: false,
          error: '任务ID不能为空',
        };
      }

      emitter.removeTask(taskId);
      activeTrackers.delete(taskId);

      logger.info(`[ProgressEmitter-IPC] 移除任务: ${taskId}`);

      return {
        success: true,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 移除任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== Progress Updates ====================

  /**
   * 更新步进
   * @param {string} taskId - 任务ID
   * @param {string} message - 进度消息
   * @param {number} increment - 步进增量
   * @returns {Object} { success, percent }
   */
  ipcMain.handle('progress:step', async (event, taskId, message = '', increment = 1) => {
    try {
      const tracker = activeTrackers.get(taskId);
      if (!tracker) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在或未创建追踪器`,
        };
      }

      tracker.step(message, increment);

      const taskInfo = tracker.getInfo();

      return {
        success: true,
        percent: taskInfo ? taskInfo.percent : 0,
        currentStep: taskInfo ? taskInfo.currentStep : 0,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 更新步进失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置百分比
   * @param {string} taskId - 任务ID
   * @param {number} percent - 百分比 (0-100)
   * @param {string} message - 进度消息
   * @returns {Object} { success, percent }
   */
  ipcMain.handle('progress:set-percent', async (event, taskId, percent, message = '') => {
    try {
      const tracker = activeTrackers.get(taskId);
      if (!tracker) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在或未创建追踪器`,
        };
      }

      if (typeof percent !== 'number' || percent < 0 || percent > 100) {
        return {
          success: false,
          error: '百分比必须是 0-100 之间的数字',
        };
      }

      tracker.setPercent(percent, message);

      const taskInfo = tracker.getInfo();

      return {
        success: true,
        percent: taskInfo ? taskInfo.percent : percent,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 设置百分比失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置阶段
   * @param {string} taskId - 任务ID
   * @param {string} stage - 阶段
   * @param {string} message - 消息
   * @returns {Object} { success, stage }
   */
  ipcMain.handle('progress:set-stage', async (event, taskId, stage, message = '') => {
    try {
      const tracker = activeTrackers.get(taskId);
      if (!tracker) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在或未创建追踪器`,
        };
      }

      const validStages = Object.values(ProgressEmitter.Stage);
      if (!validStages.includes(stage)) {
        return {
          success: false,
          error: `无效阶段: ${stage}，有效值: ${validStages.join(', ')}`,
        };
      }

      tracker.setStage(stage, message);

      const taskInfo = tracker.getInfo();

      return {
        success: true,
        stage: taskInfo ? taskInfo.stage : stage,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 设置阶段失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== Task Completion ====================

  /**
   * 完成任务
   * @param {string} taskId - 任务ID
   * @param {Object} result - 任务结果
   * @returns {Object} { success, duration }
   */
  ipcMain.handle('progress:complete', async (event, taskId, result = {}) => {
    try {
      const tracker = activeTrackers.get(taskId);
      if (!tracker) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在或未创建追踪器`,
        };
      }

      tracker.complete(result);

      const taskInfo = tracker.getInfo();

      // 延迟清理追踪器
      setTimeout(() => {
        activeTrackers.delete(taskId);
      }, 5000);

      logger.info(`[ProgressEmitter-IPC] 任务完成: ${taskId}`);

      return {
        success: true,
        duration: taskInfo ? taskInfo.duration : 0,
        stage: ProgressEmitter.Stage.COMPLETED,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 完成任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 任务失败
   * @param {string} taskId - 任务ID
   * @param {string} errorMessage - 错误消息
   * @returns {Object} { success }
   */
  ipcMain.handle('progress:error', async (event, taskId, errorMessage) => {
    try {
      const tracker = activeTrackers.get(taskId);
      if (!tracker) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在或未创建追踪器`,
        };
      }

      tracker.error(errorMessage || '未知错误');

      const taskInfo = tracker.getInfo();

      // 延迟清理追踪器
      setTimeout(() => {
        activeTrackers.delete(taskId);
      }, 10000);

      logger.info(`[ProgressEmitter-IPC] 任务失败: ${taskId} - ${errorMessage}`);

      return {
        success: true,
        duration: taskInfo ? taskInfo.duration : 0,
        stage: ProgressEmitter.Stage.FAILED,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 标记任务失败出错:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 取消任务
   * @param {string} taskId - 任务ID
   * @param {string} reason - 取消原因
   * @returns {Object} { success }
   */
  ipcMain.handle('progress:cancel', async (event, taskId, reason = '用户取消') => {
    try {
      const tracker = activeTrackers.get(taskId);
      if (!tracker) {
        return {
          success: false,
          error: `任务 ${taskId} 不存在或未创建追踪器`,
        };
      }

      tracker.cancel(reason);

      const taskInfo = tracker.getInfo();

      // 延迟清理追踪器
      setTimeout(() => {
        activeTrackers.delete(taskId);
      }, 5000);

      logger.info(`[ProgressEmitter-IPC] 任务取消: ${taskId} - ${reason}`);

      return {
        success: true,
        duration: taskInfo ? taskInfo.duration : 0,
        stage: ProgressEmitter.Stage.CANCELLED,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 取消任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== Control ====================

  /**
   * 清空所有任务
   * @returns {Object} { success }
   */
  ipcMain.handle('progress:clear-all', async () => {
    try {
      const count = activeTrackers.size;

      emitter.clearAll();
      activeTrackers.clear();

      logger.info(`[ProgressEmitter-IPC] 清空所有任务: ${count} 个`);

      return {
        success: true,
        clearedCount: count,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 清空任务失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取配置
   * @returns {Object} { success, config, stages }
   */
  ipcMain.handle('progress:get-config', async () => {
    try {
      return {
        success: true,
        config: { ...emitter.config },
        stages: { ...ProgressEmitter.Stage },
        activeTaskCount: emitter.getActiveTasks().length,
        trackerCount: activeTrackers.size,
      };
    } catch (error) {
      logger.error('[ProgressEmitter-IPC] 获取配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块已注册
  if (ipcGuard) {
    ipcGuard.markModuleRegistered('progress-emitter');
  }

  logger.info('[ProgressEmitter-IPC] 12 个 IPC handlers 注册完成');
}

/**
 * 注销 Progress Emitter IPC handlers
 * @param {Object} options - 注销选项
 */
function unregisterProgressEmitterIPC(options = {}) {
  const { ipcMain, ipcGuard } = options;

  if (!ipcMain) {
    return;
  }

  const channels = [
    // Task Management
    'progress:create-task',
    'progress:get-task',
    'progress:get-active-tasks',
    'progress:remove-task',
    // Progress Updates
    'progress:step',
    'progress:set-percent',
    'progress:set-stage',
    // Task Completion
    'progress:complete',
    'progress:error',
    'progress:cancel',
    // Control
    'progress:clear-all',
    'progress:get-config',
  ];

  for (const channel of channels) {
    try {
      ipcMain.removeHandler(channel);
    } catch (e) {
      // 忽略移除错误
    }
  }

  // 清理追踪器
  activeTrackers.clear();

  // 清理单例
  if (progressEmitter) {
    progressEmitter.clearAll();
    progressEmitter = null;
  }

  if (ipcGuard) {
    ipcGuard.unmarkModuleRegistered('progress-emitter');
  }

  logger.info('[ProgressEmitter-IPC] IPC handlers 已注销');
}

/**
 * 获取 ProgressEmitter 实例（供其他模块使用）
 * @returns {ProgressEmitter}
 */
function getProgressEmitterInstance() {
  return getProgressEmitter();
}

/**
 * 设置主窗口
 * @param {BrowserWindow} mainWindow - Electron 主窗口
 */
function setProgressMainWindow(mainWindow) {
  const emitter = getProgressEmitter();
  emitter.setMainWindow(mainWindow);
}

module.exports = {
  registerProgressEmitterIPC,
  unregisterProgressEmitterIPC,
  getProgressEmitterInstance,
  setProgressMainWindow,
  ProgressStage: ProgressEmitter.Stage,
};
