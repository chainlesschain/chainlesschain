const { logger, createLogger } = require('../utils/logger.js');

/**
 * Credit Score System IPC Handlers
 * 信用评分系统 IPC 处理器
 *
 * 提供7个IPC处理器用于信用评分的管理、查询和统计
 */

/**
 * 注册信用评分相关的IPC处理器
 * @param {Object} context - 上下文对象
 * @param {Object} context.creditScoreManager - 信用评分管理器实例
 * @param {Object} context.ipcMain - (可选) ipcMain实例，用于测试时注入mock
 */
function registerCreditIPC(context) {
  const { creditScoreManager, ipcMain: injectedIpcMain } = context;

  // 支持依赖注入，用于测试
  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 1. 获取用户信用信息
  ipcMain.handle('credit:get-user-credit', async (_event, userDid) => {
    try {
      if (!creditScoreManager) {
        return null;
      }
      return await creditScoreManager.getUserCredit(userDid);
    } catch (error) {
      logger.error('[Credit IPC] 获取用户信用失败:', error);
      return null;
    }
  });

  // 2. 更新信用评分
  ipcMain.handle('credit:update-score', async (_event, userDid) => {
    try {
      if (!creditScoreManager) {
        throw new Error('信用评分管理器未初始化');
      }
      return await creditScoreManager.calculateScore(userDid);
    } catch (error) {
      logger.error('[Credit IPC] 更新信用评分失败:', error);
      throw error;
    }
  });

  // 3. 获取评分历史记录
  ipcMain.handle('credit:get-score-history', async (_event, userDid, limit) => {
    try {
      if (!creditScoreManager) {
        return [];
      }
      return await creditScoreManager.getScoreHistory(userDid, limit);
    } catch (error) {
      logger.error('[Credit IPC] 获取评分历史失败:', error);
      return [];
    }
  });

  // 4. 获取信用等级
  ipcMain.handle('credit:get-credit-level', async (_event, score) => {
    try {
      if (!creditScoreManager) {
        return null;
      }
      return await creditScoreManager.getCreditLevel(score);
    } catch (error) {
      logger.error('[Credit IPC] 获取信用等级失败:', error);
      return null;
    }
  });

  // 5. 获取信用排行榜
  ipcMain.handle('credit:get-leaderboard', async (_event, limit) => {
    try {
      if (!creditScoreManager) {
        return [];
      }
      return await creditScoreManager.getLeaderboard(limit);
    } catch (error) {
      logger.error('[Credit IPC] 获取排行榜失败:', error);
      return [];
    }
  });

  // 6. 获取用户信用权益
  ipcMain.handle('credit:get-benefits', async (_event, userDid) => {
    try {
      if (!creditScoreManager) {
        return [];
      }
      const credit = await creditScoreManager.getUserCredit(userDid);
      if (!credit) {return [];}
      const level = await creditScoreManager.getCreditLevel(credit.credit_score);
      return level ? level.benefits : [];
    } catch (error) {
      logger.error('[Credit IPC] 获取信用权益失败:', error);
      return [];
    }
  });

  // 7. 获取信用统计信息
  ipcMain.handle('credit:get-statistics', async () => {
    try {
      if (!creditScoreManager) {
        return null;
      }
      return await creditScoreManager.getStatistics();
    } catch (error) {
      logger.error('[Credit IPC] 获取统计信息失败:', error);
      return null;
    }
  });

  logger.info('[Credit IPC] 已注册 7 个信用评分 IPC 处理器');
}

module.exports = {
  registerCreditIPC
};
