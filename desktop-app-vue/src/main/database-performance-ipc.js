/**
 * 数据库性能监控 IPC 接口
 *
 * 提供前端访问数据库性能统计和优化功能的接口
 */

const { ipcMain } = require('electron');
const { getLogger } = require('./logger');

const logger = getLogger('DatabasePerformanceIPC');

/**
 * 注册数据库性能监控 IPC 处理器
 * @param {DatabaseOptimizer} optimizer - 数据库优化器实例
 */
function registerDatabasePerformanceIPC(optimizer) {
  if (!optimizer) {
    logger.warn('Database optimizer not provided, IPC handlers not registered');
    return;
  }

  /**
   * 获取性能统计
   */
  ipcMain.handle('db-performance:get-stats', async () => {
    try {
      const stats = optimizer.getStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      logger.error('Failed to get performance stats', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 重置统计信息
   */
  ipcMain.handle('db-performance:reset-stats', async () => {
    try {
      optimizer.resetStats();
      return {
        success: true,
        message: 'Statistics reset successfully'
      };
    } catch (error) {
      logger.error('Failed to reset stats', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 获取慢查询日志
   */
  ipcMain.handle('db-performance:get-slow-queries', async (event, limit = 20) => {
    try {
      const slowQueries = optimizer.getSlowQueries(limit);
      return {
        success: true,
        data: slowQueries
      };
    } catch (error) {
      logger.error('Failed to get slow queries', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 获取索引建议
   */
  ipcMain.handle('db-performance:get-index-suggestions', async () => {
    try {
      const suggestions = optimizer.getIndexSuggestions();
      return {
        success: true,
        data: suggestions
      };
    } catch (error) {
      logger.error('Failed to get index suggestions', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 应用索引建议
   */
  ipcMain.handle('db-performance:apply-index-suggestion', async (event, suggestion) => {
    try {
      const result = optimizer.applyIndexSuggestion(suggestion);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      logger.error('Failed to apply index suggestion', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 应用所有索引建议
   */
  ipcMain.handle('db-performance:apply-all-index-suggestions', async () => {
    try {
      const results = optimizer.applyAllIndexSuggestions();
      return {
        success: true,
        data: results
      };
    } catch (error) {
      logger.error('Failed to apply all index suggestions', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 分析表性能
   */
  ipcMain.handle('db-performance:analyze-table', async (event, tableName) => {
    try {
      const analysis = optimizer.analyzeTable(tableName);
      return {
        success: true,
        data: analysis
      };
    } catch (error) {
      logger.error('Failed to analyze table', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 优化数据库
   */
  ipcMain.handle('db-performance:optimize', async () => {
    try {
      const result = await optimizer.optimize();
      return {
        success: true,
        data: result
      };
    } catch (error) {
      logger.error('Failed to optimize database', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 清空查询缓存
   */
  ipcMain.handle('db-performance:clear-cache', async () => {
    try {
      optimizer.queryCache.clear();
      return {
        success: true,
        message: 'Query cache cleared successfully'
      };
    } catch (error) {
      logger.error('Failed to clear cache', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * 使缓存失效（支持模式匹配）
   */
  ipcMain.handle('db-performance:invalidate-cache', async (event, pattern) => {
    try {
      optimizer.queryCache.invalidate(pattern);
      return {
        success: true,
        message: 'Cache invalidated successfully'
      };
    } catch (error) {
      logger.error('Failed to invalidate cache', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.info('Database performance IPC handlers registered');
}

module.exports = {
  registerDatabasePerformanceIPC
};
