/**
 * Review System IPC Handlers
 * 评价反馈系统相关的 IPC 处理函数
 *
 * 包含10个评价管理handlers:
 * - review:create - 创建评价
 * - review:update - 更新评价
 * - review:delete - 删除评价
 * - review:get - 获取评价
 * - review:get-by-target - 根据目标获取评价列表
 * - review:reply - 回复评价
 * - review:mark-helpful - 标记评价是否有帮助
 * - review:report - 举报评价
 * - review:get-statistics - 获取评价统计信息
 * - review:get-my-reviews - 获取我的评价列表
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * 注册所有评价系统相关的 IPC handlers
 * @param {Object} context - 上下文对象，包含 reviewManager 等
 */
function registerReviewIPC(context) {
  const { reviewManager } = context;

  // 创建评价
  ipcMain.handle('review:create', async (_event, options) => {
    try {
      if (!reviewManager) {
        throw new Error('评价管理器未初始化');
      }
      return await reviewManager.createReview(options);
    } catch (error) {
      logger.error('[Main] 创建评价失败:', error);
      throw error;
    }
  });

  // 更新评价
  ipcMain.handle('review:update', async (_event, reviewId, updates) => {
    try {
      if (!reviewManager) {
        throw new Error('评价管理器未初始化');
      }
      return await reviewManager.updateReview(reviewId, updates);
    } catch (error) {
      logger.error('[Main] 更新评价失败:', error);
      throw error;
    }
  });

  // 删除评价
  ipcMain.handle('review:delete', async (_event, reviewId) => {
    try {
      if (!reviewManager) {
        throw new Error('评价管理器未初始化');
      }
      return await reviewManager.deleteReview(reviewId);
    } catch (error) {
      logger.error('[Main] 删除评价失败:', error);
      throw error;
    }
  });

  // 获取评价
  ipcMain.handle('review:get', async (_event, reviewId) => {
    try {
      if (!reviewManager) {
        return null;
      }
      return await reviewManager.getReview(reviewId);
    } catch (error) {
      logger.error('[Main] 获取评价失败:', error);
      return null;
    }
  });

  // 根据目标获取评价列表
  ipcMain.handle('review:get-by-target', async (_event, targetId, targetType, filters) => {
    try {
      if (!reviewManager) {
        return [];
      }
      return await reviewManager.getReviewsByTarget(targetId, targetType, filters);
    } catch (error) {
      logger.error('[Main] 获取目标评价失败:', error);
      return [];
    }
  });

  // 回复评价
  ipcMain.handle('review:reply', async (_event, reviewId, content) => {
    try {
      if (!reviewManager) {
        throw new Error('评价管理器未初始化');
      }
      return await reviewManager.replyToReview(reviewId, content);
    } catch (error) {
      logger.error('[Main] 回复评价失败:', error);
      throw error;
    }
  });

  // 标记评价是否有帮助
  ipcMain.handle('review:mark-helpful', async (_event, reviewId, helpful) => {
    try {
      if (!reviewManager) {
        throw new Error('评价管理器未初始化');
      }
      return await reviewManager.markHelpful(reviewId, helpful);
    } catch (error) {
      logger.error('[Main] 标记有帮助失败:', error);
      throw error;
    }
  });

  // 举报评价
  ipcMain.handle('review:report', async (_event, reviewId, reason, description) => {
    try {
      if (!reviewManager) {
        throw new Error('评价管理器未初始化');
      }
      return await reviewManager.reportReview(reviewId, reason, description);
    } catch (error) {
      logger.error('[Main] 举报评价失败:', error);
      throw error;
    }
  });

  // 获取评价统计信息
  ipcMain.handle('review:get-statistics', async (_event, targetId, targetType) => {
    try {
      if (!reviewManager) {
        return null;
      }
      return await reviewManager.getStatistics(targetId, targetType);
    } catch (error) {
      logger.error('[Main] 获取评价统计失败:', error);
      return null;
    }
  });

  // 获取我的评价列表
  ipcMain.handle('review:get-my-reviews', async (_event, userDid) => {
    try {
      if (!reviewManager) {
        return [];
      }
      return await reviewManager.getMyReviews(userDid);
    } catch (error) {
      logger.error('[Main] 获取我的评价失败:', error);
      return [];
    }
  });

  logger.info('[IPC] 评价系统IPC handlers已注册 (10个)');
}

module.exports = {
  registerReviewIPC
};
