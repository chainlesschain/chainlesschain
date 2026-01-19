/**
 * 跨链桥 IPC 处理器
 * 处理所有 bridge: 相关的 IPC 通信
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * 注册跨链桥相关的 IPC 处理器
 * @param {Object} bridgeManager - 跨链桥管理器实例
 */
function registerBridgeIPC(bridgeManager) {
  // ==================== 跨链桥 ====================

  // 桥接资产
  ipcMain.handle('bridge:transfer', async (_event, options) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      return await bridgeManager.bridgeAsset(options);
    } catch (error) {
      logger.error('[Main] 桥接资产失败:', error);
      throw error;
    }
  });

  // 获取桥接历史
  ipcMain.handle('bridge:get-history', async (_event, filters = {}) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      return await bridgeManager.getBridgeHistory(filters);
    } catch (error) {
      logger.error('[Main] 获取桥接历史失败:', error);
      throw error;
    }
  });

  // 获取桥接记录详情
  ipcMain.handle('bridge:get-record', async (_event, { bridgeId }) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      return await bridgeManager.getBridgeRecord(bridgeId);
    } catch (error) {
      logger.error('[Main] 获取桥接记录失败:', error);
      throw error;
    }
  });

  // 注册桥接合约
  ipcMain.handle('bridge:register-contract', async (_event, { chainId, contractAddress }) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      bridgeManager.registerBridgeContract(chainId, contractAddress);
      return { success: true };
    } catch (error) {
      logger.error('[Main] 注册桥接合约失败:', error);
      throw error;
    }
  });

  // 查询资产余额
  ipcMain.handle('bridge:get-balance', async (_event, { address, tokenAddress, chainId }) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      return await bridgeManager.getAssetBalance(address, tokenAddress, chainId);
    } catch (error) {
      logger.error('[Main] 查询资产余额失败:', error);
      throw error;
    }
  });

  // 批量查询余额
  ipcMain.handle('bridge:get-batch-balances', async (_event, { address, assets }) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      return await bridgeManager.getBatchBalances(address, assets);
    } catch (error) {
      logger.error('[Main] 批量查询余额失败:', error);
      throw error;
    }
  });

  // 查询锁定余额
  ipcMain.handle('bridge:get-locked-balance', async (_event, { tokenAddress, chainId }) => {
    try {
      if (!bridgeManager) {
        throw new Error('跨链桥管理器未初始化');
      }

      return await bridgeManager.getLockedBalance(tokenAddress, chainId);
    } catch (error) {
      logger.error('[Main] 查询锁定余额失败:', error);
      throw error;
    }
  });

  logger.info('[Bridge IPC] 跨链桥 IPC 处理器注册完成 (7个处理器)');
}

module.exports = { registerBridgeIPC };
