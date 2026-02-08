const { logger } = require("../utils/logger.js");

/**
 * 数据同步 IPC 处理器
 * 负责处理所有数据同步相关的前后端通信
 *
 * @module sync-ipc
 * @description 提供数据同步启动、状态查询、增量同步、冲突解决等 IPC 接口
 */

/**
 * 注册所有数据同步 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.syncManager - 同步管理器实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerSyncIPC({ syncManager, ipcMain: injectedIpcMain }) {
  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require("electron").ipcMain;

  logger.info("[Sync IPC] Registering Sync IPC handlers...");

  // ============================================================
  // 同步控制 (Sync Control)
  // ============================================================

  /**
   * 启动数据同步
   * Channel: 'sync:start'
   *
   * @param {string} deviceId - 设备ID（可选，不提供则自动生成）
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle("sync:start", async (_event, deviceId) => {
    try {
      if (!syncManager) {
        return { success: false, error: "同步管理器未初始化" };
      }

      const finalDeviceId = deviceId || `device-${Date.now()}`;
      logger.info("[Sync IPC] 启动数据同步, 设备ID:", finalDeviceId);

      await syncManager.initialize(finalDeviceId);
      await syncManager.syncAfterLogin();

      logger.info("[Sync IPC] 数据同步完成");
      return { success: true };
    } catch (error) {
      logger.error("[Sync IPC] 同步失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取同步状态
   * Channel: 'sync:get-status'
   *
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle("sync:get-status", async () => {
    try {
      if (!syncManager || !syncManager.httpClient) {
        return { success: false, error: "同步管理器未初始化" };
      }

      const status = await syncManager.httpClient.getSyncStatus(
        syncManager.deviceId,
      );
      return { success: true, data: status };
    } catch (error) {
      logger.error("[Sync IPC] 获取同步状态失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 手动触发增量同步
   * Channel: 'sync:incremental'
   *
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle("sync:incremental", async () => {
    try {
      if (!syncManager) {
        return { success: false, error: "同步管理器未初始化" };
      }

      logger.info("[Sync IPC] 手动触发增量同步");
      await syncManager.syncIncremental();

      return { success: true };
    } catch (error) {
      logger.error("[Sync IPC] 增量同步失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 冲突解决 (Conflict Resolution)
  // ============================================================

  /**
   * 解决同步冲突
   * Channel: 'sync:resolve-conflict'
   *
   * NOTE: There's a commented-out duplicate handler in index.js at line 2011.
   * The actual implementation is located at line 3491 (mentioned in comments).
   * This handler is kept here for future migration when the main implementation
   * is moved from index.js.
   *
   * @param {string} conflictId - 冲突ID
   * @param {string} resolution - 解决方案 ('local' | 'remote' | 'merge')
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle(
    "sync:resolve-conflict",
    async (_event, conflictId, resolution) => {
      try {
        if (!syncManager) {
          return { success: false, error: "同步管理器未初始化" };
        }

        logger.info("[Sync IPC] 解决冲突:", conflictId, resolution);
        await syncManager.resolveConflict(conflictId, resolution);

        return { success: true };
      } catch (error) {
        logger.error("[Sync IPC] 解决冲突失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // 认证管理 (Authentication Management)
  // ============================================================

  /**
   * 设置同步认证Token
   * Channel: 'sync:set-auth-token'
   *
   * @param {string} token - JWT token
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle("sync:set-auth-token", async (_event, token) => {
    try {
      if (!syncManager) {
        return { success: false, error: "同步管理器未初始化" };
      }

      if (!token || typeof token !== "string") {
        return { success: false, error: "无效的Token" };
      }

      syncManager.setAuthToken(token);
      logger.info("[Sync IPC] 认证Token已设置");

      return { success: true, hasAuth: syncManager.hasAuth() };
    } catch (error) {
      logger.error("[Sync IPC] 设置认证Token失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 清除同步认证Token
   * Channel: 'sync:clear-auth-token'
   *
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle("sync:clear-auth-token", async () => {
    try {
      if (!syncManager) {
        return { success: false, error: "同步管理器未初始化" };
      }

      syncManager.setAuthToken(null);
      logger.info("[Sync IPC] 认证Token已清除");

      return { success: true };
    } catch (error) {
      logger.error("[Sync IPC] 清除认证Token失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 检查同步认证状态
   * Channel: 'sync:has-auth'
   *
   * @returns {Promise<Object>} { success: boolean, hasAuth: boolean, error?: string }
   */
  ipcMain.handle("sync:has-auth", async () => {
    try {
      if (!syncManager) {
        return { success: false, hasAuth: false, error: "同步管理器未初始化" };
      }

      const hasAuth = syncManager.hasAuth();
      return { success: true, hasAuth };
    } catch (error) {
      logger.error("[Sync IPC] 检查认证状态失败:", error);
      return { success: false, hasAuth: false, error: error.message };
    }
  });

  /**
   * 获取同步配置信息
   * Channel: 'sync:get-config'
   *
   * @returns {Promise<Object>} { success: boolean, config: Object, error?: string }
   */
  ipcMain.handle("sync:get-config", async () => {
    try {
      if (!syncManager || !syncManager.httpClient) {
        return { success: false, error: "同步管理器未初始化" };
      }

      const config = syncManager.httpClient.getConfig();
      return {
        success: true,
        config: {
          ...config,
          deviceId: syncManager.deviceId,
          isOnline: syncManager.isOnline,
          isAuthenticated: syncManager.hasAuth(),
        },
      };
    } catch (error) {
      logger.error("[Sync IPC] 获取同步配置失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[Sync IPC] Registered 8 sync: handlers");
  logger.info("[Sync IPC] - sync:start");
  logger.info("[Sync IPC] - sync:get-status");
  logger.info("[Sync IPC] - sync:incremental");
  logger.info("[Sync IPC] - sync:resolve-conflict");
  logger.info("[Sync IPC] - sync:set-auth-token");
  logger.info("[Sync IPC] - sync:clear-auth-token");
  logger.info("[Sync IPC] - sync:has-auth");
  logger.info("[Sync IPC] - sync:get-config");
}

module.exports = { registerSyncIPC };
