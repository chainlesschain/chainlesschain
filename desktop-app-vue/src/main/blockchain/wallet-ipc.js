/**
 * 钱包管理 IPC
 * 处理钱包创建、导入、签名等操作
 */
const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

function registerWalletIPC({ walletManager, externalWalletConnector }) {
  logger.info('[Wallet IPC] Registering Wallet IPC handlers...');

  // 创建钱包
  ipcMain.handle('wallet:create', async (_event, { password, chainId = 1 }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.createWallet(password, chainId);
    } catch (error) {
      logger.error('[Main] 创建钱包失败:', error);
      throw error;
    }
  });

  // 从助记词导入钱包
  ipcMain.handle('wallet:import-mnemonic', async (_event, { mnemonic, password, chainId = 1 }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.importFromMnemonic(mnemonic, password, chainId);
    } catch (error) {
      logger.error('[Main] 导入钱包失败:', error);
      throw error;
    }
  });

  // 从私钥导入钱包
  ipcMain.handle('wallet:import-private-key', async (_event, { privateKey, password, chainId = 1 }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.importFromPrivateKey(privateKey, password, chainId);
    } catch (error) {
      logger.error('[Main] 从私钥导入钱包失败:', error);
      throw error;
    }
  });

  // 解锁钱包
  ipcMain.handle('wallet:unlock', async (_event, { walletId, password }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      const wallet = await walletManager.unlockWallet(walletId, password);
      return { address: wallet.address };
    } catch (error) {
      logger.error('[Main] 解锁钱包失败:', error);
      throw error;
    }
  });

  // 锁定钱包
  ipcMain.handle('wallet:lock', async (_event, { walletId }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      walletManager.lockWallet(walletId);
      return { success: true };
    } catch (error) {
      logger.error('[Main] 锁定钱包失败:', error);
      throw error;
    }
  });

  // 签名交易
  ipcMain.handle('wallet:sign-transaction', async (_event, { walletId, transaction, useUKey = false }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.signTransaction(walletId, transaction, useUKey);
    } catch (error) {
      logger.error('[Main] 签名交易失败:', error);
      throw error;
    }
  });

  // 签名消息
  ipcMain.handle('wallet:sign-message', async (_event, { walletId, message, useUKey = false }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.signMessage(walletId, message, useUKey);
    } catch (error) {
      logger.error('[Main] 签名消息失败:', error);
      throw error;
    }
  });

  // 获取余额
  ipcMain.handle('wallet:get-balance', async (_event, { address, chainId, tokenAddress = null }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.getBalance(address, chainId, tokenAddress);
    } catch (error) {
      logger.error('[Main] 获取余额失败:', error);
      throw error;
    }
  });

  // 获取所有钱包
  ipcMain.handle('wallet:get-all', async () => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.getAllWallets();
    } catch (error) {
      logger.error('[Main] 获取钱包列表失败:', error);
      throw error;
    }
  });

  // 获取钱包详情
  ipcMain.handle('wallet:get', async (_event, { walletId }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.getWallet(walletId);
    } catch (error) {
      logger.error('[Main] 获取钱包详情失败:', error);
      throw error;
    }
  });

  // 设置默认钱包
  ipcMain.handle('wallet:set-default', async (_event, { walletId }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      await walletManager.setDefaultWallet(walletId);
      return { success: true };
    } catch (error) {
      logger.error('[Main] 设置默认钱包失败:', error);
      throw error;
    }
  });

  // 删除钱包
  ipcMain.handle('wallet:delete', async (_event, { walletId }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      await walletManager.deleteWallet(walletId);
      return { success: true };
    } catch (error) {
      logger.error('[Main] 删除钱包失败:', error);
      throw error;
    }
  });

  // 导出私钥
  ipcMain.handle('wallet:export-private-key', async (_event, { walletId, password }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.exportPrivateKey(walletId, password);
    } catch (error) {
      logger.error('[Main] 导出私钥失败:', error);
      throw error;
    }
  });

  // 导出助记词
  ipcMain.handle('wallet:export-mnemonic', async (_event, { walletId, password }) => {
    try {
      if (!walletManager) {
        throw new Error('钱包管理器未初始化');
      }

      return await walletManager.exportMnemonic(walletId, password);
    } catch (error) {
      logger.error('[Main] 导出助记词失败:', error);
      throw error;
    }
  });

  // 保存外部钱包
  ipcMain.handle('wallet:save-external', async (_event, { address, provider, chainId }) => {
    try {
      if (!externalWalletConnector) {
        throw new Error('外部钱包连接器未初始化');
      }

      await externalWalletConnector._saveExternalWallet({ address, provider, chainId });
      return { success: true };
    } catch (error) {
      logger.error('[Main] 保存外部钱包失败:', error);
      throw error;
    }
  });

  logger.info('[Wallet IPC] ✓ 15 handlers registered');
}

module.exports = { registerWalletIPC };
