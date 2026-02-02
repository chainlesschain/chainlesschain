/**
 * Response Cache IPC 处理器
 *
 * 提供 LLM 响应缓存的前端访问接口
 * 支持缓存查询、统计、清理、配置管理
 *
 * 功能：
 * - 缓存统计和监控
 * - 缓存配置管理
 * - 手动缓存操作
 * - 按提供商统计
 *
 * @module response-cache-ipc
 */

const { logger } = require('../utils/logger.js');
const defaultIpcGuard = require('../ipc/ipc-guard');

// 模块级别的实例引用
let responseCacheInstance = null;

/**
 * 设置 ResponseCache 实例
 * @param {Object} cache - ResponseCache 实例
 */
function setResponseCacheInstance(cache) {
  responseCacheInstance = cache;
}

/**
 * 获取 ResponseCache 实例
 * @returns {Object|null}
 */
function getResponseCacheInstance() {
  return responseCacheInstance;
}

/**
 * 注册 Response Cache IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.responseCache] - ResponseCache 实例
 * @param {Object} [dependencies.database] - 数据库实例（用于创建新的 ResponseCache）
 */
function registerResponseCacheIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  responseCache,
  database,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('response-cache-ipc')) {
    logger.info('[Response Cache IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 设置实例
  if (responseCache) {
    setResponseCacheInstance(responseCache);
  }

  logger.info('[Response Cache IPC] Registering handlers...');

  // ============================================================
  // 辅助函数
  // ============================================================

  /**
   * 获取缓存实例，如果不存在则返回错误
   */
  function getCacheOrError() {
    const cache = getResponseCacheInstance();
    if (!cache) {
      return {
        success: false,
        error: 'Response cache not initialized',
      };
    }
    return { success: true, cache };
  }

  // ============================================================
  // 统计信息 (Statistics) - 3 handlers
  // ============================================================

  /**
   * 获取缓存统计信息
   * Channel: 'cache:get-stats'
   *
   * @returns {Object} 统计数据（运行时统计、数据库统计、配置）
   */
  ipcMain.handle('cache:get-stats', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const stats = await result.cache.getStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 获取统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取按提供商的缓存统计
   * Channel: 'cache:get-stats-by-provider'
   *
   * @returns {Object} 各提供商的缓存统计
   */
  ipcMain.handle('cache:get-stats-by-provider', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const stats = await result.cache.getStatsByProvider();
      return {
        success: true,
        providers: stats,
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 获取提供商统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取缓存命中率趋势
   * Channel: 'cache:get-hit-rate-trend'
   *
   * @returns {Object} 命中率和趋势数据
   */
  ipcMain.handle('cache:get-hit-rate-trend', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const stats = await result.cache.getStats();

      // 计算命中率
      const runtime = stats.runtime;
      const totalRequests = runtime.hits + runtime.misses;
      const hitRate = totalRequests > 0 ? (runtime.hits / totalRequests) * 100 : 0;

      return {
        success: true,
        hitRate: {
          current: hitRate.toFixed(2),
          hits: runtime.hits,
          misses: runtime.misses,
          totalRequests,
        },
        savings: {
          totalTokensSaved: stats.database.totalTokensSaved || 0,
          totalEntries: stats.database.totalEntries || 0,
        },
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 获取命中率趋势失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 配置管理 (Configuration) - 2 handlers
  // ============================================================

  /**
   * 获取缓存配置
   * Channel: 'cache:get-config'
   *
   * @returns {Object} 当前配置
   */
  ipcMain.handle('cache:get-config', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const cache = result.cache;

      return {
        success: true,
        config: {
          ttl: cache.ttl,
          ttlDays: cache.ttl / 1000 / 60 / 60 / 24,
          maxSize: cache.maxSize,
          enableAutoCleanup: cache.enableAutoCleanup,
          cleanupInterval: cache.cleanupInterval,
          cleanupIntervalMinutes: cache.cleanupInterval / 1000 / 60,
        },
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 获取配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新缓存配置
   * Channel: 'cache:set-config'
   *
   * 注意：部分配置（如 TTL、maxSize）需要重启缓存才能生效
   *
   * @param {Object} config - 新配置
   * @returns {Object} 更新结果
   */
  ipcMain.handle('cache:set-config', async (_event, config) => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const cache = result.cache;

      // 只允许更新安全的配置项
      if (config.enableAutoCleanup !== undefined) {
        if (config.enableAutoCleanup && !cache.enableAutoCleanup) {
          cache.enableAutoCleanup = true;
          cache._startAutoCleanup();
        } else if (!config.enableAutoCleanup && cache.enableAutoCleanup) {
          cache.stopAutoCleanup();
          cache.enableAutoCleanup = false;
        }
      }

      // TTL 和 maxSize 的更改将影响新条目
      if (config.ttlDays !== undefined && config.ttlDays > 0) {
        cache.ttl = config.ttlDays * 24 * 60 * 60 * 1000;
      }

      if (config.maxSize !== undefined && config.maxSize > 0) {
        cache.maxSize = config.maxSize;
      }

      logger.info('[Response Cache IPC] 配置已更新:', config);

      return {
        success: true,
        message: 'Configuration updated',
        config: {
          ttl: cache.ttl,
          ttlDays: cache.ttl / 1000 / 60 / 60 / 24,
          maxSize: cache.maxSize,
          enableAutoCleanup: cache.enableAutoCleanup,
        },
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 设置配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 缓存操作 (Cache Operations) - 4 handlers
  // ============================================================

  /**
   * 清除所有缓存
   * Channel: 'cache:clear-all'
   *
   * @returns {Object} 清除结果
   */
  ipcMain.handle('cache:clear-all', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const deletedCount = await result.cache.clear();

      logger.info('[Response Cache IPC] 所有缓存已清除，共', deletedCount, '条');

      return {
        success: true,
        deletedCount,
        message: `Cleared ${deletedCount} cache entries`,
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 清除缓存失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清除过期缓存
   * Channel: 'cache:clear-expired'
   *
   * @returns {Object} 清除结果
   */
  ipcMain.handle('cache:clear-expired', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const deletedCount = await result.cache.clearExpired();

      logger.info('[Response Cache IPC] 过期缓存已清除，共', deletedCount, '条');

      return {
        success: true,
        deletedCount,
        message: `Cleared ${deletedCount} expired cache entries`,
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 清除过期缓存失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 检查特定请求是否有缓存
   * Channel: 'cache:check'
   *
   * @param {Object} options - 检查选项
   * @param {string} options.provider - 提供商
   * @param {string} options.model - 模型
   * @param {Array} options.messages - 消息数组
   * @returns {Object} 缓存状态
   */
  ipcMain.handle('cache:check', async (_event, options = {}) => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const { provider, model, messages } = options;

      if (!provider || !model || !Array.isArray(messages)) {
        return {
          success: false,
          error: 'provider, model, and messages are required',
        };
      }

      const cacheResult = await result.cache.get(provider, model, messages);

      return {
        success: true,
        cached: cacheResult.hit,
        cacheAge: cacheResult.cacheAge,
        tokensSaved: cacheResult.tokensSaved,
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 检查缓存失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 预热缓存（可选功能，用于预加载常用响应）
   * Channel: 'cache:warmup-status'
   *
   * @returns {Object} 预热状态
   */
  ipcMain.handle('cache:warmup-status', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const stats = await result.cache.getStats();

      // 计算缓存健康度
      const totalEntries = stats.database.totalEntries || 0;
      const expiredEntries = stats.database.expiredEntries || 0;
      const healthyEntries = totalEntries - expiredEntries;
      const healthPercent = totalEntries > 0 ? (healthyEntries / totalEntries) * 100 : 100;

      return {
        success: true,
        status: {
          totalEntries,
          healthyEntries,
          expiredEntries,
          healthPercent: healthPercent.toFixed(2),
          recommendation: healthPercent < 50
            ? 'Consider clearing expired entries'
            : healthPercent < 80
              ? 'Cache is moderately healthy'
              : 'Cache is healthy',
        },
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 获取预热状态失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 控制操作 (Control Operations) - 2 handlers
  // ============================================================

  /**
   * 启动自动清理
   * Channel: 'cache:start-auto-cleanup'
   *
   * @returns {Object} 操作结果
   */
  ipcMain.handle('cache:start-auto-cleanup', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const cache = result.cache;

      if (cache.enableAutoCleanup) {
        return {
          success: true,
          message: 'Auto cleanup is already running',
        };
      }

      cache.enableAutoCleanup = true;
      cache._startAutoCleanup();

      logger.info('[Response Cache IPC] 自动清理已启动');

      return {
        success: true,
        message: 'Auto cleanup started',
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 启动自动清理失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 停止自动清理
   * Channel: 'cache:stop-auto-cleanup'
   *
   * @returns {Object} 操作结果
   */
  ipcMain.handle('cache:stop-auto-cleanup', async () => {
    try {
      const result = getCacheOrError();
      if (!result.success) return result;

      const cache = result.cache;

      if (!cache.enableAutoCleanup) {
        return {
          success: true,
          message: 'Auto cleanup is already stopped',
        };
      }

      cache.stopAutoCleanup();
      cache.enableAutoCleanup = false;

      logger.info('[Response Cache IPC] 自动清理已停止');

      return {
        success: true,
        message: 'Auto cleanup stopped',
      };
    } catch (error) {
      logger.error('[Response Cache IPC] 停止自动清理失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('response-cache-ipc');

  logger.info('[Response Cache IPC] ✓ All handlers registered (11 handlers: 3 stats + 2 config + 4 operations + 2 control)');
}

/**
 * 注销 Response Cache IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterResponseCacheIPC({ ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard } = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered('response-cache-ipc')) {
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    'cache:get-stats',
    'cache:get-stats-by-provider',
    'cache:get-hit-rate-trend',
    'cache:get-config',
    'cache:set-config',
    'cache:clear-all',
    'cache:clear-expired',
    'cache:check',
    'cache:warmup-status',
    'cache:start-auto-cleanup',
    'cache:stop-auto-cleanup',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcGuard.unmarkModuleRegistered('response-cache-ipc');
  logger.info('[Response Cache IPC] Handlers unregistered');
}

module.exports = {
  registerResponseCacheIPC,
  unregisterResponseCacheIPC,
  setResponseCacheInstance,
  getResponseCacheInstance,
};
