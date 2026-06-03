/**
 * VC (Verifiable Credentials) IPC 处理器
 * 负责处理可验证凭证相关的前后端通信
 *
 * @module vc-ipc
 * @description 提供可验证凭证的创建、验证、撤销、导出、导入、统计等 IPC 接口
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * 注册所有 VC IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.vcManager - 可验证凭证管理器
 */
function registerVCIPC({ vcManager }) {
  logger.info("[VC IPC] Registering VC IPC handlers...");

  // ============================================================
  // 凭证基础操作 (Basic Credential Operations)
  // ============================================================

  /**
   * 创建可验证凭证
   * Channel: 'vc:create'
   */
  ipcMain.handle("vc:create", async (_event, params) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return await vcManager.createCredential(params);
    } catch (error) {
      logger.error("[VC IPC] 创建凭证失败:", error);
      throw error;
    }
  });

  /**
   * 获取所有凭证（支持过滤）
   * Channel: 'vc:get-all'
   */
  ipcMain.handle("vc:get-all", async (_event, filters) => {
    try {
      if (!vcManager) {
        return [];
      }

      return vcManager.getCredentials(filters);
    } catch (error) {
      logger.error("[VC IPC] 获取凭证列表失败:", error);
      return [];
    }
  });

  /**
   * 根据 ID 获取凭证
   * Channel: 'vc:get'
   */
  ipcMain.handle("vc:get", async (_event, id) => {
    try {
      if (!vcManager) {
        return null;
      }

      return vcManager.getCredentialById(id);
    } catch (error) {
      logger.error("[VC IPC] 获取凭证失败:", error);
      return null;
    }
  });

  /**
   * 验证凭证
   * Channel: 'vc:verify'
   */
  ipcMain.handle("vc:verify", async (_event, vcDocument) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return await vcManager.verifyCredential(vcDocument);
    } catch (error) {
      logger.error("[VC IPC] 验证凭证失败:", error);
      return false;
    }
  });

  /**
   * 撤销凭证
   * Channel: 'vc:revoke'
   */
  ipcMain.handle("vc:revoke", async (_event, id, issuerDID) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return await vcManager.revokeCredential(id, issuerDID);
    } catch (error) {
      logger.error("[VC IPC] 撤销凭证失败:", error);
      throw error;
    }
  });

  /**
   * 删除凭证
   * Channel: 'vc:delete'
   */
  ipcMain.handle("vc:delete", async (_event, id) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return await vcManager.deleteCredential(id);
    } catch (error) {
      logger.error("[VC IPC] 删除凭证失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 凭证导入导出 (Import/Export)
  // ============================================================

  /**
   * 导出凭证
   * Channel: 'vc:export'
   */
  ipcMain.handle("vc:export", async (_event, id) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return vcManager.exportCredential(id);
    } catch (error) {
      logger.error("[VC IPC] 导出凭证失败:", error);
      throw error;
    }
  });

  /**
   * 生成分享数据
   * Channel: 'vc:generate-share-data'
   */
  ipcMain.handle("vc:generate-share-data", async (_event, id) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return await vcManager.generateShareData(id);
    } catch (error) {
      logger.error("[VC IPC] 生成分享数据失败:", error);
      throw error;
    }
  });

  /**
   * 从分享数据导入凭证
   * Channel: 'vc:import-from-share'
   */
  ipcMain.handle("vc:import-from-share", async (_event, shareData) => {
    try {
      if (!vcManager) {
        throw new Error("可验证凭证管理器未初始化");
      }

      return await vcManager.importFromShareData(shareData);
    } catch (error) {
      logger.error("[VC IPC] 导入分享凭证失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 凭证统计 (Statistics)
  // ============================================================

  /**
   * 获取凭证统计信息
   * Channel: 'vc:get-statistics'
   */
  ipcMain.handle("vc:get-statistics", async (_event, did) => {
    try {
      if (!vcManager) {
        return { issued: 0, received: 0, total: 0, byType: {} };
      }

      return vcManager.getStatistics(did);
    } catch (error) {
      logger.error("[VC IPC] 获取凭证统计失败:", error);
      return { issued: 0, received: 0, total: 0, byType: {} };
    }
  });

  logger.info(
    "[VC IPC] ✓ All VC IPC handlers registered successfully (10 handlers)",
  );
}

module.exports = {
  registerVCIPC,
};
