/**
 * Stream Controller IPC 处理器
 *
 * 提供流式输出控制的前端访问接口
 * 支持暂停、恢复、取消等流式输出控制功能
 *
 * 功能：
 * - 流状态查询和控制
 * - 暂停/恢复流式输出
 * - 取消流式输出
 * - 流统计信息
 *
 * @module stream-controller-ipc
 */

const { logger } = require('../utils/logger.js');
const defaultIpcGuard = require('../ipc/ipc-guard');
const { StreamController, StreamStatus, createStreamController } = require('./stream-controller.js');

// 活跃的流控制器管理
const activeControllers = new Map();

/**
 * 创建或获取流控制器
 * @param {string} streamId - 流 ID
 * @param {Object} options - 配置选项
 * @returns {StreamController} 控制器实例
 */
function getOrCreateController(streamId, options = {}) {
  if (!activeControllers.has(streamId)) {
    const controller = createStreamController(options);
    activeControllers.set(streamId, controller);

    // 监听完成/取消/错误事件，自动清理
    const cleanup = () => {
      setTimeout(() => {
        if (activeControllers.has(streamId)) {
          const ctrl = activeControllers.get(streamId);
          if (ctrl.status === StreamStatus.COMPLETED ||
              ctrl.status === StreamStatus.CANCELLED ||
              ctrl.status === StreamStatus.ERROR) {
            activeControllers.delete(streamId);
          }
        }
      }, 30000); // 30秒后清理已完成的控制器
    };

    controller.on('complete', cleanup);
    controller.on('cancel', cleanup);
    controller.on('stream-error', cleanup);
  }

  return activeControllers.get(streamId);
}

/**
 * 注册 Stream Controller IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.mainWindow] - 主窗口（用于发送事件）
 */
function registerStreamControllerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  mainWindow,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('stream-controller-ipc')) {
    logger.info('[Stream Controller IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info('[Stream Controller IPC] Registering handlers...');

  // ============================================================
  // 流生命周期 (Lifecycle) - 4 handlers
  // ============================================================

  /**
   * 创建新的流控制器
   * Channel: 'stream:create'
   *
   * @param {Object} options - 配置选项
   * @param {string} [options.streamId] - 自定义流 ID（默认自动生成）
   * @param {boolean} [options.enableBuffering] - 启用内容缓冲
   * @returns {Object} 创建结果
   */
  ipcMain.handle('stream:create', async (_event, options = {}) => {
    try {
      const streamId = options.streamId || `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (activeControllers.has(streamId)) {
        return {
          success: false,
          error: `Stream ${streamId} already exists`,
        };
      }

      const controller = getOrCreateController(streamId, {
        enableBuffering: options.enableBuffering || false,
      });

      logger.info('[Stream Controller IPC] 流控制器已创建:', streamId);

      return {
        success: true,
        streamId,
        status: controller.status,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 创建流控制器失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 启动流
   * Channel: 'stream:start'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 启动结果
   */
  ipcMain.handle('stream:start', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      controller.start();

      logger.info('[Stream Controller IPC] 流已启动:', streamId);

      return {
        success: true,
        streamId,
        status: controller.status,
        startTime: controller.startTime,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 启动流失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 完成流
   * Channel: 'stream:complete'
   *
   * @param {string} streamId - 流 ID
   * @param {Object} [result] - 最终结果
   * @returns {Object} 完成结果
   */
  ipcMain.handle('stream:complete', async (_event, streamId, result = {}) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      controller.complete(result);
      const stats = controller.getStats();

      logger.info('[Stream Controller IPC] 流已完成:', streamId, stats);

      return {
        success: true,
        streamId,
        status: controller.status,
        stats,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 完成流失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 销毁流控制器
   * Channel: 'stream:destroy'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 销毁结果
   */
  ipcMain.handle('stream:destroy', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: true,
          message: `Stream ${streamId} not found or already destroyed`,
        };
      }

      controller.destroy();
      activeControllers.delete(streamId);

      logger.info('[Stream Controller IPC] 流控制器已销毁:', streamId);

      return {
        success: true,
        streamId,
        message: 'Stream controller destroyed',
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 销毁流控制器失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 流控制 (Control) - 3 handlers
  // ============================================================

  /**
   * 暂停流
   * Channel: 'stream:pause'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 暂停结果
   */
  ipcMain.handle('stream:pause', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      controller.pause();

      logger.info('[Stream Controller IPC] 流已暂停:', streamId);

      return {
        success: true,
        streamId,
        status: controller.status,
        isPaused: controller.isPaused,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 暂停流失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 恢复流
   * Channel: 'stream:resume'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 恢复结果
   */
  ipcMain.handle('stream:resume', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      controller.resume();

      logger.info('[Stream Controller IPC] 流已恢复:', streamId);

      return {
        success: true,
        streamId,
        status: controller.status,
        isPaused: controller.isPaused,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 恢复流失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 取消流
   * Channel: 'stream:cancel'
   *
   * @param {string} streamId - 流 ID
   * @param {string} [reason] - 取消原因
   * @returns {Object} 取消结果
   */
  ipcMain.handle('stream:cancel', async (_event, streamId, reason = '用户取消') => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      controller.cancel(reason);
      const stats = controller.getStats();

      logger.info('[Stream Controller IPC] 流已取消:', streamId, reason);

      return {
        success: true,
        streamId,
        status: controller.status,
        reason,
        stats,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 取消流失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 状态查询 (Status) - 3 handlers
  // ============================================================

  /**
   * 获取流状态
   * Channel: 'stream:get-status'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 流状态
   */
  ipcMain.handle('stream:get-status', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      return {
        success: true,
        streamId,
        status: controller.status,
        isPaused: controller.isPaused,
        processedChunks: controller.processedChunks,
        totalChunks: controller.totalChunks,
        startTime: controller.startTime,
        endTime: controller.endTime,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 获取流状态失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取流统计
   * Channel: 'stream:get-stats'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 流统计信息
   */
  ipcMain.handle('stream:get-stats', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      const stats = controller.getStats();

      return {
        success: true,
        streamId,
        stats,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 获取流统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 列出所有活跃的流
   * Channel: 'stream:list-active'
   *
   * @returns {Object} 活跃流列表
   */
  ipcMain.handle('stream:list-active', async () => {
    try {
      const streams = [];

      for (const [streamId, controller] of activeControllers.entries()) {
        streams.push({
          streamId,
          status: controller.status,
          isPaused: controller.isPaused,
          processedChunks: controller.processedChunks,
          startTime: controller.startTime,
        });
      }

      return {
        success: true,
        count: streams.length,
        streams,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 列出活跃流失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 缓冲操作 (Buffer) - 2 handlers
  // ============================================================

  /**
   * 获取缓冲内容
   * Channel: 'stream:get-buffer'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 缓冲内容
   */
  ipcMain.handle('stream:get-buffer', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      const buffer = controller.getBuffer();

      return {
        success: true,
        streamId,
        buffer,
        bufferSize: buffer.length,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 获取缓冲内容失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清空缓冲
   * Channel: 'stream:clear-buffer'
   *
   * @param {string} streamId - 流 ID
   * @returns {Object} 清空结果
   */
  ipcMain.handle('stream:clear-buffer', async (_event, streamId) => {
    try {
      if (!streamId) {
        return {
          success: false,
          error: 'streamId is required',
        };
      }

      const controller = activeControllers.get(streamId);
      if (!controller) {
        return {
          success: false,
          error: `Stream ${streamId} not found`,
        };
      }

      const previousSize = controller.getBuffer().length;
      controller.clearBuffer();

      logger.info('[Stream Controller IPC] 缓冲已清空:', streamId);

      return {
        success: true,
        streamId,
        message: 'Buffer cleared',
        previousSize,
      };
    } catch (error) {
      logger.error('[Stream Controller IPC] 清空缓冲失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('stream-controller-ipc');

  logger.info('[Stream Controller IPC] ✓ All handlers registered (12 handlers: 4 lifecycle + 3 control + 3 status + 2 buffer)');
}

/**
 * 注销 Stream Controller IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterStreamControllerIPC({ ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard } = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered('stream-controller-ipc')) {
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    // Lifecycle
    'stream:create',
    'stream:start',
    'stream:complete',
    'stream:destroy',
    // Control
    'stream:pause',
    'stream:resume',
    'stream:cancel',
    // Status
    'stream:get-status',
    'stream:get-stats',
    'stream:list-active',
    // Buffer
    'stream:get-buffer',
    'stream:clear-buffer',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  // 清理所有活跃的控制器
  for (const [streamId, controller] of activeControllers.entries()) {
    controller.destroy();
  }
  activeControllers.clear();

  ipcGuard.unmarkModuleRegistered('stream-controller-ipc');
  logger.info('[Stream Controller IPC] Handlers unregistered');
}

/**
 * 获取活跃控制器（用于测试或内部访问）
 * @param {string} streamId - 流 ID
 * @returns {StreamController|undefined}
 */
function getActiveController(streamId) {
  return activeControllers.get(streamId);
}

/**
 * 获取所有活跃控制器数量
 * @returns {number}
 */
function getActiveControllerCount() {
  return activeControllers.size;
}

module.exports = {
  registerStreamControllerIPC,
  unregisterStreamControllerIPC,
  getOrCreateController,
  getActiveController,
  getActiveControllerCount,
  StreamStatus,
};
