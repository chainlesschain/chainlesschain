/**
 * 托管管理 IPC 处理器
 * 处理所有 escrow: 相关的 IPC 通信
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * 注册托管管理相关的 IPC 处理器
 * @param {Object} escrowManager - 托管管理器实例
 */
function registerEscrowIPC(escrowManager) {
  // ==================== 托管管理 ====================

  // 获取托管详情
  ipcMain.handle("escrow:get", async (_event, escrowId) => {
    try {
      if (!escrowManager) {
        return null;
      }

      return await escrowManager.getEscrow(escrowId);
    } catch (error) {
      logger.error("[Main] 获取托管详情失败:", error);
      throw error;
    }
  });

  // 获取托管列表
  ipcMain.handle("escrow:get-list", async (_event, filters) => {
    try {
      if (!escrowManager) {
        return [];
      }

      return await escrowManager.getEscrows(filters);
    } catch (error) {
      logger.error("[Main] 获取托管列表失败:", error);
      throw error;
    }
  });

  // 获取托管历史
  ipcMain.handle("escrow:get-history", async (_event, escrowId) => {
    try {
      if (!escrowManager) {
        return [];
      }

      return await escrowManager.getEscrowHistory(escrowId);
    } catch (error) {
      logger.error("[Main] 获取托管历史失败:", error);
      throw error;
    }
  });

  // 发起争议
  ipcMain.handle("escrow:dispute", async (_event, escrowId, reason) => {
    try {
      if (!escrowManager) {
        throw new Error("托管管理器未初始化");
      }

      return await escrowManager.disputeEscrow(escrowId, reason);
    } catch (error) {
      logger.error("[Main] 发起争议失败:", error);
      throw error;
    }
  });

  // 获取托管统计信息
  ipcMain.handle("escrow:get-statistics", async () => {
    try {
      if (!escrowManager) {
        return { total: 0, locked: 0, released: 0, refunded: 0, disputed: 0 };
      }

      return await escrowManager.getStatistics();
    } catch (error) {
      logger.error("[Main] 获取托管统计信息失败:", error);
      throw error;
    }
  });

  logger.info("[Escrow IPC] 托管管理 IPC 处理器注册完成 (5个处理器)");
}

module.exports = { registerEscrowIPC };
