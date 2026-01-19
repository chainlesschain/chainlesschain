/**
 * 资产管理 IPC
 * 处理资产创建、铸造、转账、销毁等操作
 */
const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

function registerAssetIPC({ assetManager }) {
  logger.info('[Asset IPC] Registering Asset IPC handlers...');

  // 创建资产
  ipcMain.handle('asset:create', async (_event, options) => {
    try {
      if (!assetManager) {
        throw new Error('资产管理器未初始化');
      }

      return await assetManager.createAsset(options);
    } catch (error) {
      logger.error('[Main] 创建资产失败:', error);
      throw error;
    }
  });

  // 铸造资产
  ipcMain.handle('asset:mint', async (_event, assetId, toDid, amount) => {
    try {
      if (!assetManager) {
        throw new Error('资产管理器未初始化');
      }

      return await assetManager.mintAsset(assetId, toDid, amount);
    } catch (error) {
      logger.error('[Main] 铸造资产失败:', error);
      throw error;
    }
  });

  // 转账资产
  ipcMain.handle('asset:transfer', async (_event, assetId, toDid, amount, memo) => {
    try {
      if (!assetManager) {
        throw new Error('资产管理器未初始化');
      }

      return await assetManager.transferAsset(assetId, toDid, amount, memo);
    } catch (error) {
      logger.error('[Main] 转账失败:', error);
      throw error;
    }
  });

  // 销毁资产
  ipcMain.handle('asset:burn', async (_event, assetId, amount) => {
    try {
      if (!assetManager) {
        throw new Error('资产管理器未初始化');
      }

      return await assetManager.burnAsset(assetId, amount);
    } catch (error) {
      logger.error('[Main] 销毁资产失败:', error);
      throw error;
    }
  });

  // 获取资产信息
  ipcMain.handle('asset:get', async (_event, assetId) => {
    try {
      if (!assetManager) {
        return null;
      }

      return await assetManager.getAsset(assetId);
    } catch (error) {
      logger.error('[Main] 获取资产失败:', error);
      throw error;
    }
  });

  // 获取用户资产列表
  ipcMain.handle('asset:get-by-owner', async (_event, ownerDid) => {
    try {
      if (!assetManager) {
        return [];
      }

      return await assetManager.getAssetsByOwner(ownerDid);
    } catch (error) {
      logger.error('[Main] 获取资产列表失败:', error);
      throw error;
    }
  });

  // 获取所有资产
  ipcMain.handle('asset:get-all', async (_event, filters) => {
    try {
      if (!assetManager) {
        return [];
      }

      return await assetManager.getAllAssets(filters);
    } catch (error) {
      logger.error('[Main] 获取所有资产失败:', error);
      throw error;
    }
  });

  // 获取资产历史
  ipcMain.handle('asset:get-history', async (_event, assetId, limit) => {
    try {
      if (!assetManager) {
        return [];
      }

      return await assetManager.getAssetHistory(assetId, limit);
    } catch (error) {
      logger.error('[Main] 获取资产历史失败:', error);
      throw error;
    }
  });

  // 获取余额
  ipcMain.handle('asset:get-balance', async (_event, ownerDid, assetId) => {
    try {
      if (!assetManager) {
        return 0;
      }

      return await assetManager.getBalance(ownerDid, assetId);
    } catch (error) {
      logger.error('[Main] 获取余额失败:', error);
      return 0;
    }
  });

  // 获取资产的区块链部署信息
  ipcMain.handle('asset:get-blockchain-info', async (_event, assetId) => {
    try {
      if (!assetManager) {
        return null;
      }

      return await assetManager._getBlockchainAsset(assetId);
    } catch (error) {
      logger.error('[Main] 获取区块链资产信息失败:', error);
      return null;
    }
  });

  logger.info('[Asset IPC] ✓ 10 handlers registered');
}

module.exports = { registerAssetIPC };
