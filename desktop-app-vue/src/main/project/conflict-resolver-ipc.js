/**
 * 冲突解决器 IPC 处理器
 *
 * @version 0.27.0
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');
const { getConflictResolver, ResolutionStrategy } = require('./conflict-resolver.js');

/**
 * 注册冲突解决器 IPC 处理器
 *
 * @param {Object} dependencies - 依赖对象
 */
function registerConflictResolverIPC({ database }) {
  logger.info('[Conflict Resolver IPC] 注册冲突解决器 IPC 处理器...');

  const conflictResolver = getConflictResolver(database);

  /**
   * 检测文件更新冲突
   * Channel: 'conflict:detect'
   */
  ipcMain.handle('conflict:detect', async (_event, params) => {
    try {
      logger.info('[Conflict] 检测冲突:', params.fileId);
      const result = await conflictResolver.detectConflict(params);

      if (result.hasConflict) {
        logger.warn('[Conflict] 检测到冲突:', {
          fileId: params.fileId,
          type: result.conflict.type,
        });

        return {
          hasConflict: true,
          conflict: result.conflict.toJSON(),
          autoMergeResult: result.autoMergeResult,
        };
      }

      return { hasConflict: false };
    } catch (error) {
      logger.error('[Conflict] 检测冲突失败:', error);
      throw error;
    }
  });

  /**
   * 解决冲突
   * Channel: 'conflict:resolve'
   */
  ipcMain.handle('conflict:resolve', async (_event, fileId, strategy, mergedContent) => {
    try {
      logger.info('[Conflict] 解决冲突:', { fileId, strategy });

      const result = await conflictResolver.resolveConflict(fileId, strategy, mergedContent);

      return {
        success: true,
        content: result.content,
        newVersion: result.newVersion,
      };
    } catch (error) {
      logger.error('[Conflict] 解决冲突失败:', error);
      throw error;
    }
  });

  /**
   * 获取所有活跃冲突
   * Channel: 'conflict:get-active'
   */
  ipcMain.handle('conflict:get-active', async (_event) => {
    try {
      const conflicts = conflictResolver.getActiveConflicts();
      logger.info(`[Conflict] 获取活跃冲突: ${conflicts.length} 个`);
      return conflicts;
    } catch (error) {
      logger.error('[Conflict] 获取活跃冲突失败:', error);
      throw error;
    }
  });

  /**
   * 获取冲突历史
   * Channel: 'conflict:get-history'
   */
  ipcMain.handle('conflict:get-history', async (_event, limit = 50) => {
    try {
      const history = conflictResolver.getConflictHistory(limit);
      logger.info(`[Conflict] 获取冲突历史: ${history.length} 条`);
      return history;
    } catch (error) {
      logger.error('[Conflict] 获取冲突历史失败:', error);
      throw error;
    }
  });

  /**
   * 清除冲突历史
   * Channel: 'conflict:clear-history'
   */
  ipcMain.handle('conflict:clear-history', async (_event) => {
    try {
      conflictResolver.clearHistory();
      logger.info('[Conflict] 冲突历史已清除');
      return { success: true };
    } catch (error) {
      logger.error('[Conflict] 清除冲突历史失败:', error);
      throw error;
    }
  });

  logger.info('[Conflict Resolver IPC] ✓ 冲突解决器 IPC 处理器注册成功 (5 handlers)');
}

module.exports = {
  registerConflictResolverIPC,
};
