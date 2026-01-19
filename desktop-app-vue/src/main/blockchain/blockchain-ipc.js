/**
 * 区块链相关 IPC 处理器
 * 处理区块链操作、合约部署、资产管理等功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * 注册区块链相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.blockchainAdapter - 区块链适配器实例
 * @param {Object} dependencies.transactionMonitor - 交易监控器实例
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.mainWindow - 主窗口实例
 */
function registerBlockchainIPC({ blockchainAdapter, transactionMonitor, database, mainWindow }) {
  // 切换区块链网络
  ipcMain.handle('blockchain:switch-chain', async (_event, { chainId }) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      await blockchainAdapter.switchChain(chainId);
      return { success: true };
    } catch (error) {
      logger.error('[Main] 切换网络失败:', error);
      throw error;
    }
  });

  // 获取交易历史
  ipcMain.handle('blockchain:get-tx-history', async (_event, { address, chainId, limit = 100, offset = 0 }) => {
    try {
      if (!transactionMonitor) {
        throw new Error('交易监控器未初始化');
      }

      return await transactionMonitor.getTxHistory({ address, chainId, limit, offset });
    } catch (error) {
      logger.error('[Main] 获取交易历史失败:', error);
      throw error;
    }
  });

  // 获取交易详情
  ipcMain.handle('blockchain:get-transaction', async (_event, { txHash }) => {
    try {
      if (!transactionMonitor) {
        throw new Error('交易监控器未初始化');
      }

      return await transactionMonitor.getTxDetail(txHash);
    } catch (error) {
      logger.error('[Main] 获取交易详情失败:', error);
      throw error;
    }
  });

  // 部署 ERC-20 代币
  ipcMain.handle('blockchain:deploy-token', async (_event, options) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      const { walletId, name, symbol, decimals, initialSupply, chainId } = options;
      return await blockchainAdapter.deployERC20Token(walletId, {
        name,
        symbol,
        decimals,
        initialSupply,
        chainId,
      });
    } catch (error) {
      logger.error('[Main] 部署 ERC-20 代币失败:', error);
      throw error;
    }
  });

  // 部署 NFT
  ipcMain.handle('blockchain:deploy-nft', async (_event, options) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      const { walletId, name, symbol, chainId } = options;
      return await blockchainAdapter.deployNFT(walletId, {
        name,
        symbol,
        chainId,
      });
    } catch (error) {
      logger.error('[Main] 部署 NFT 失败:', error);
      throw error;
    }
  });

  // 铸造 NFT
  ipcMain.handle('blockchain:mint-nft', async (_event, options) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      const { walletId, contractAddress, to, metadataURI, chainId } = options;
      return await blockchainAdapter.mintNFT(walletId, contractAddress, to, metadataURI, chainId);
    } catch (error) {
      logger.error('[Main] 铸造 NFT 失败:', error);
      throw error;
    }
  });

  // 转账代币
  ipcMain.handle('blockchain:transfer-token', async (_event, options) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      const { walletId, tokenAddress, to, amount, chainId } = options;
      return await blockchainAdapter.transferToken(walletId, tokenAddress, to, amount, chainId);
    } catch (error) {
      logger.error('[Main] 转账代币失败:', error);
      throw error;
    }
  });

  // 获取 Gas 价格
  ipcMain.handle('blockchain:get-gas-price', async (_event, { chainId }) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      return await blockchainAdapter.getGasPrice(chainId);
    } catch (error) {
      logger.error('[Main] 获取 Gas 价格失败:', error);
      throw error;
    }
  });

  // 估算 Gas
  ipcMain.handle('blockchain:estimate-gas', async (_event, { transaction, chainId }) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      return await blockchainAdapter.estimateGas(transaction, chainId);
    } catch (error) {
      logger.error('[Main] 估算 Gas 失败:', error);
      throw error;
    }
  });

  // 获取区块信息
  ipcMain.handle('blockchain:get-block', async (_event, { blockNumber, chainId }) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      return await blockchainAdapter.getBlock(blockNumber, chainId);
    } catch (error) {
      logger.error('[Main] 获取区块信息失败:', error);
      throw error;
    }
  });

  // 获取当前区块号
  ipcMain.handle('blockchain:get-block-number', async (_event, { chainId }) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      return await blockchainAdapter.getBlockNumber(chainId);
    } catch (error) {
      logger.error('[Main] 获取区块号失败:', error);
      throw error;
    }
  });

  // 监听合约事件
  ipcMain.handle('blockchain:listen-events', async (_event, { contractAddress, eventName, abi, chainId }) => {
    try {
      if (!blockchainAdapter) {
        throw new Error('区块链适配器未初始化');
      }

      await blockchainAdapter.listenToEvents(contractAddress, eventName, abi, chainId, (event) => {
        // 发送事件到渲染进程
        if (mainWindow) {
          mainWindow.webContents.send('blockchain:event', {
            contractAddress,
            eventName,
            data: event,
          });
        }
      });

      return { success: true };
    } catch (error) {
      logger.error('[Main] 监听合约事件失败:', error);
      throw error;
    }
  });

  // 获取合约部署记录
  ipcMain.handle('blockchain:get-deployed-contracts', async (_event, { chainId = null }) => {
    try {
      return new Promise((resolve, reject) => {
        let sql = 'SELECT * FROM deployed_contracts WHERE 1=1';
        const params = [];

        if (chainId !== null) {
          sql += ' AND chain_id = ?';
          params.push(chainId);
        }

        sql += ' ORDER BY deployed_at DESC';

        database.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        });
      });
    } catch (error) {
      logger.error('[Main] 获取合约部署记录失败:', error);
      throw error;
    }
  });

  // 获取链上资产
  ipcMain.handle('blockchain:get-deployed-assets', async (_event, { chainId = null }) => {
    try {
      return new Promise((resolve, reject) => {
        let sql = 'SELECT * FROM blockchain_assets WHERE 1=1';
        const params = [];

        if (chainId !== null) {
          sql += ' AND chain_id = ?';
          params.push(chainId);
        }

        sql += ' ORDER BY deployed_at DESC';

        database.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        });
      });
    } catch (error) {
      logger.error('[Main] 获取链上资产失败:', error);
      throw error;
    }
  });

  logger.info('[Blockchain IPC] 已注册 14 个区块链 IPC 处理器');
}

module.exports = { registerBlockchainIPC };
