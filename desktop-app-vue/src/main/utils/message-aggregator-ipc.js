/**
 * Message Aggregator IPC 处理器
 *
 * 提供消息批量聚合的前端访问接口
 * 支持消息队列管理、统计信息、配置调整
 *
 * 功能：
 * - 消息推送到聚合队列
 * - 手动/自动刷新队列
 * - 统计信息查询
 * - 配置管理（批量间隔、最大批量大小）
 *
 * @module message-aggregator-ipc
 */

const { logger } = require('./logger.js');
const defaultIpcGuard = require('../ipc/ipc-guard');
const { MessageAggregator, getMessageAggregator, destroyGlobalAggregator } = require('./message-aggregator.js');

// 模块级别的实例引用
let messageAggregatorInstance = null;

/**
 * 设置 MessageAggregator 实例
 * @param {Object} aggregator - MessageAggregator 实例
 */
function setMessageAggregatorInstance(aggregator) {
  messageAggregatorInstance = aggregator;
}

/**
 * 获取 MessageAggregator 实例
 * @returns {Object|null}
 */
function getMessageAggregatorInstance() {
  return messageAggregatorInstance || getMessageAggregator();
}

/**
 * 注册 Message Aggregator IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.messageAggregator] - MessageAggregator 实例
 * @param {Object} [dependencies.mainWindow] - 主窗口
 */
function registerMessageAggregatorIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  messageAggregator,
  mainWindow,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('message-aggregator-ipc')) {
    logger.info('[Message Aggregator IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 设置实例
  if (messageAggregator) {
    setMessageAggregatorInstance(messageAggregator);
  } else if (mainWindow) {
    // 如果没有提供实例但有窗口，创建一个
    const aggregator = getMessageAggregator(mainWindow);
    setMessageAggregatorInstance(aggregator);
  }

  logger.info('[Message Aggregator IPC] Registering handlers...');

  // ============================================================
  // 辅助函数
  // ============================================================

  /**
   * 获取 Aggregator 实例
   */
  function getAggregator() {
    return getMessageAggregatorInstance();
  }

  // ============================================================
  // 消息操作 (Message Operations) - 3 handlers
  // ============================================================

  /**
   * 推送消息到聚合队列
   * Channel: 'aggregator:push'
   *
   * @param {Object} params - 消息参数
   * @param {string} params.event - 事件名称
   * @param {any} params.data - 消息数据
   * @returns {Object} 推送结果
   */
  ipcMain.handle('aggregator:push', async (_event, params = {}) => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      const { event, data } = params;

      if (!event) {
        return {
          success: false,
          error: 'event is required',
        };
      }

      aggregator.push(event, data);

      return {
        success: true,
        message: 'Message pushed to queue',
        queueSize: aggregator.messageQueue.length,
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 推送消息失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 批量推送消息
   * Channel: 'aggregator:push-batch'
   *
   * @param {Array} messages - 消息数组 [{event, data}, ...]
   * @returns {Object} 推送结果
   */
  ipcMain.handle('aggregator:push-batch', async (_event, messages = []) => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      if (!Array.isArray(messages)) {
        return {
          success: false,
          error: 'messages must be an array',
        };
      }

      let pushed = 0;
      for (const msg of messages) {
        if (msg.event) {
          aggregator.push(msg.event, msg.data);
          pushed++;
        }
      }

      return {
        success: true,
        message: `${pushed} messages pushed to queue`,
        pushed,
        queueSize: aggregator.messageQueue.length,
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 批量推送消息失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 刷新队列（发送所有待处理消息）
   * Channel: 'aggregator:flush'
   *
   * @returns {Object} 刷新结果
   */
  ipcMain.handle('aggregator:flush', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      const queueSizeBefore = aggregator.messageQueue.length;
      aggregator.flushNow();

      return {
        success: true,
        message: 'Queue flushed',
        flushedCount: queueSizeBefore,
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 刷新队列失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 统计信息 (Statistics) - 2 handlers
  // ============================================================

  /**
   * 获取统计信息
   * Channel: 'aggregator:get-stats'
   *
   * @returns {Object} 统计数据
   */
  ipcMain.handle('aggregator:get-stats', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      const stats = aggregator.getStats();

      return {
        success: true,
        stats: {
          ...stats,
          avgBatchSize: Math.round(stats.avgBatchSize * 100) / 100,
          efficiency: stats.totalMessages > 0
            ? Math.round((1 - stats.totalBatches / stats.totalMessages) * 100)
            : 0,
        },
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 获取统计信息失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重置统计信息
   * Channel: 'aggregator:reset-stats'
   *
   * @returns {Object} 重置结果
   */
  ipcMain.handle('aggregator:reset-stats', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      aggregator.resetStats();

      logger.info('[Message Aggregator IPC] 统计信息已重置');

      return {
        success: true,
        message: 'Statistics reset',
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 重置统计信息失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 配置管理 (Configuration) - 3 handlers
  // ============================================================

  /**
   * 获取配置
   * Channel: 'aggregator:get-config'
   *
   * @returns {Object} 当前配置
   */
  ipcMain.handle('aggregator:get-config', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      return {
        success: true,
        config: {
          batchInterval: aggregator.batchInterval,
          maxBatchSize: aggregator.maxBatchSize,
          hasWindow: !!aggregator.window,
        },
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 获取配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置配置
   * Channel: 'aggregator:set-config'
   *
   * @param {Object} config - 新配置
   * @param {number} [config.batchInterval] - 批量间隔（毫秒）
   * @param {number} [config.maxBatchSize] - 最大批量大小
   * @returns {Object} 更新结果
   */
  ipcMain.handle('aggregator:set-config', async (_event, config = {}) => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      if (config.batchInterval !== undefined && config.batchInterval > 0) {
        aggregator.batchInterval = config.batchInterval;
      }

      if (config.maxBatchSize !== undefined && config.maxBatchSize > 0) {
        aggregator.maxBatchSize = config.maxBatchSize;
      }

      logger.info('[Message Aggregator IPC] 配置已更新:', config);

      return {
        success: true,
        message: 'Configuration updated',
        config: {
          batchInterval: aggregator.batchInterval,
          maxBatchSize: aggregator.maxBatchSize,
        },
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 设置配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取队列状态
   * Channel: 'aggregator:get-queue-status'
   *
   * @returns {Object} 队列状态
   */
  ipcMain.handle('aggregator:get-queue-status', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      // 按事件类型统计队列中的消息
      const eventCounts = {};
      for (const msg of aggregator.messageQueue) {
        if (!eventCounts[msg.event]) {
          eventCounts[msg.event] = 0;
        }
        eventCounts[msg.event]++;
      }

      return {
        success: true,
        queue: {
          size: aggregator.messageQueue.length,
          isActive: aggregator.timer !== null,
          eventTypes: Object.keys(eventCounts).length,
          eventCounts,
          oldestMessage: aggregator.messageQueue.length > 0
            ? aggregator.messageQueue[0].timestamp
            : null,
          newestMessage: aggregator.messageQueue.length > 0
            ? aggregator.messageQueue[aggregator.messageQueue.length - 1].timestamp
            : null,
        },
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 获取队列状态失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 生命周期 (Lifecycle) - 2 handlers
  // ============================================================

  /**
   * 设置窗口
   * Channel: 'aggregator:set-window'
   *
   * 注意：通常不需要从前端调用，但提供此接口以支持动态窗口设置
   *
   * @returns {Object} 设置结果
   */
  ipcMain.handle('aggregator:set-window', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: false,
          error: 'Message aggregator not initialized',
        };
      }

      // 从 BrowserWindow 获取当前焦点窗口
      const { BrowserWindow } = electron;
      const focusedWindow = BrowserWindow.getFocusedWindow();

      if (focusedWindow) {
        aggregator.setWindow(focusedWindow);
        logger.info('[Message Aggregator IPC] 窗口已设置');
        return {
          success: true,
          message: 'Window set',
          windowId: focusedWindow.id,
        };
      }

      return {
        success: false,
        error: 'No focused window available',
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 设置窗口失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 销毁聚合器
   * Channel: 'aggregator:destroy'
   *
   * @returns {Object} 销毁结果
   */
  ipcMain.handle('aggregator:destroy', async () => {
    try {
      const aggregator = getAggregator();

      if (!aggregator) {
        return {
          success: true,
          message: 'Aggregator not initialized or already destroyed',
        };
      }

      aggregator.destroy();
      destroyGlobalAggregator();
      messageAggregatorInstance = null;

      logger.info('[Message Aggregator IPC] 聚合器已销毁');

      return {
        success: true,
        message: 'Aggregator destroyed',
      };
    } catch (error) {
      logger.error('[Message Aggregator IPC] 销毁聚合器失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('message-aggregator-ipc');

  logger.info('[Message Aggregator IPC] ✓ All handlers registered (10 handlers: 3 operations + 2 stats + 3 config + 2 lifecycle)');
}

/**
 * 注销 Message Aggregator IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterMessageAggregatorIPC({ ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard } = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered('message-aggregator-ipc')) {
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    // Operations
    'aggregator:push',
    'aggregator:push-batch',
    'aggregator:flush',
    // Statistics
    'aggregator:get-stats',
    'aggregator:reset-stats',
    // Configuration
    'aggregator:get-config',
    'aggregator:set-config',
    'aggregator:get-queue-status',
    // Lifecycle
    'aggregator:set-window',
    'aggregator:destroy',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcGuard.unmarkModuleRegistered('message-aggregator-ipc');
  logger.info('[Message Aggregator IPC] Handlers unregistered');
}

module.exports = {
  registerMessageAggregatorIPC,
  unregisterMessageAggregatorIPC,
  setMessageAggregatorInstance,
  getMessageAggregatorInstance,
};
