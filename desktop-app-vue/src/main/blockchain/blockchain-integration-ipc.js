/**
 * 区块链集成 IPC 处理器
 *
 * 提供前端调用区块链集成功能的接口
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

class BlockchainIntegrationIPC {
  constructor(blockchainIntegration) {
    this.integration = blockchainIntegration;
  }

  /**
   * 注册所有IPC处理器
   */
  registerHandlers() {
    logger.info("[BlockchainIntegrationIPC] 注册IPC处理器...");

    // ==================== 资产相关 ====================

    // 创建链上Token
    ipcMain.handle(
      "blockchain-integration:create-token",
      async (event, localAssetId, options) => {
        try {
          return await this.integration.createOnChainToken(
            localAssetId,
            options,
          );
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 创建Token失败:", error);
          throw error;
        }
      },
    );

    // 创建链上NFT
    ipcMain.handle(
      "blockchain-integration:create-nft",
      async (event, localAssetId, options) => {
        try {
          return await this.integration.createOnChainNFT(localAssetId, options);
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 创建NFT失败:", error);
          throw error;
        }
      },
    );

    // 转账链上资产
    ipcMain.handle(
      "blockchain-integration:transfer-asset",
      async (event, localAssetId, options) => {
        try {
          return await this.integration.transferOnChainAsset(
            localAssetId,
            options,
          );
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 转账失败:", error);
          throw error;
        }
      },
    );

    // 同步资产余额
    ipcMain.handle(
      "blockchain-integration:sync-balance",
      async (event, localAssetId, ownerAddress) => {
        try {
          return await this.integration.syncAssetBalance(
            localAssetId,
            ownerAddress,
          );
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 同步余额失败:", error);
          throw error;
        }
      },
    );

    // 获取资产映射
    ipcMain.handle(
      "blockchain-integration:get-asset-mapping",
      async (event, localAssetId) => {
        try {
          return this.integration.getAssetMapping(localAssetId);
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 获取资产映射失败:", error);
          throw error;
        }
      },
    );

    // 获取所有链上资产
    ipcMain.handle("blockchain-integration:get-all-assets", async () => {
      try {
        return this.integration.getAllOnChainAssets();
      } catch (error) {
        logger.error("[BlockchainIntegrationIPC] 获取资产列表失败:", error);
        throw error;
      }
    });

    // ==================== 托管相关 ====================

    // 创建链上托管
    ipcMain.handle(
      "blockchain-integration:create-escrow",
      async (event, localEscrowId, options) => {
        try {
          return await this.integration.createOnChainEscrow(
            localEscrowId,
            options,
          );
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 创建托管失败:", error);
          throw error;
        }
      },
    );

    // 同步托管状态
    ipcMain.handle(
      "blockchain-integration:sync-escrow",
      async (event, localEscrowId) => {
        try {
          return await this.integration.syncEscrowStatus(localEscrowId);
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 同步托管失败:", error);
          throw error;
        }
      },
    );

    // 获取托管映射
    ipcMain.handle(
      "blockchain-integration:get-escrow-mapping",
      async (event, localEscrowId) => {
        try {
          return this.integration.getEscrowMapping(localEscrowId);
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 获取托管映射失败:", error);
          throw error;
        }
      },
    );

    // ==================== 交易相关 ====================

    // 监控交易
    ipcMain.handle(
      "blockchain-integration:monitor-transaction",
      async (event, txHash, confirmations) => {
        try {
          return await this.integration.monitorTransaction(
            txHash,
            confirmations,
          );
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 监控交易失败:", error);
          throw error;
        }
      },
    );

    // 获取交易映射
    ipcMain.handle(
      "blockchain-integration:get-transaction-mapping",
      async (event, localTxId) => {
        try {
          return this.integration.getTransactionMapping(localTxId);
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 获取交易映射失败:", error);
          throw error;
        }
      },
    );

    // 获取待确认交易
    ipcMain.handle(
      "blockchain-integration:get-pending-transactions",
      async () => {
        try {
          return this.integration.getPendingTransactions();
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 获取待确认交易失败:", error);
          throw error;
        }
      },
    );

    // ==================== 同步相关 ====================

    // 手动触发全量同步
    ipcMain.handle("blockchain-integration:sync-all", async () => {
      try {
        return await this.integration.syncAll();
      } catch (error) {
        logger.error("[BlockchainIntegrationIPC] 全量同步失败:", error);
        throw error;
      }
    });

    // 启动自动同步
    ipcMain.handle(
      "blockchain-integration:start-auto-sync",
      async (event, interval) => {
        try {
          this.integration.startAutoSync(interval);
          return { success: true };
        } catch (error) {
          logger.error("[BlockchainIntegrationIPC] 启动自动同步失败:", error);
          throw error;
        }
      },
    );

    // 停止自动同步
    ipcMain.handle("blockchain-integration:stop-auto-sync", async () => {
      try {
        this.integration.stopAutoSync();
        return { success: true };
      } catch (error) {
        logger.error("[BlockchainIntegrationIPC] 停止自动同步失败:", error);
        throw error;
      }
    });

    // ==================== 事件转发 ====================

    // 将集成模块的事件转发到渲染进程
    this.integration.on("asset:deployed", (data) => {
      this.sendToRenderer("blockchain-integration:asset-deployed", data);
    });

    this.integration.on("asset:transferred", (data) => {
      this.sendToRenderer("blockchain-integration:asset-transferred", data);
    });

    this.integration.on("escrow:created", (data) => {
      this.sendToRenderer("blockchain-integration:escrow-created", data);
    });

    this.integration.on("transaction:update", (data) => {
      this.sendToRenderer("blockchain-integration:transaction-update", data);
    });

    this.integration.on("sync:completed", (data) => {
      this.sendToRenderer("blockchain-integration:sync-completed", data);
    });

    logger.info("[BlockchainIntegrationIPC] IPC处理器注册完成");
  }

  /**
   * 发送事件到渲染进程
   * @param {string} channel - 频道名称
   * @param {any} data - 数据
   */
  sendToRenderer(channel, data) {
    const { BrowserWindow } = require("electron");
    const windows = BrowserWindow.getAllWindows();

    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    });
  }

  /**
   * 移除所有处理器
   */
  removeHandlers() {
    logger.info("[BlockchainIntegrationIPC] 移除IPC处理器...");

    const handlers = [
      "blockchain-integration:create-token",
      "blockchain-integration:create-nft",
      "blockchain-integration:transfer-asset",
      "blockchain-integration:sync-balance",
      "blockchain-integration:get-asset-mapping",
      "blockchain-integration:get-all-assets",
      "blockchain-integration:create-escrow",
      "blockchain-integration:sync-escrow",
      "blockchain-integration:get-escrow-mapping",
      "blockchain-integration:monitor-transaction",
      "blockchain-integration:get-transaction-mapping",
      "blockchain-integration:get-pending-transactions",
      "blockchain-integration:sync-all",
      "blockchain-integration:start-auto-sync",
      "blockchain-integration:stop-auto-sync",
    ];

    handlers.forEach((handler) => {
      ipcMain.removeHandler(handler);
    });

    logger.info("[BlockchainIntegrationIPC] IPC处理器移除完成");
  }
}

module.exports = BlockchainIntegrationIPC;
