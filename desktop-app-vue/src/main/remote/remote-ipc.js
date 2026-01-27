/**
 * 远程控制 IPC 处理器
 *
 * 为渲染进程提供远程控制功能的 IPC 接口
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger');

/**
 * 注册远程控制 IPC 处理器
 *
 * @param {Object} gateway - 远程网关实例
 * @param {Object} loggingManager - 日志管理器实例（可选）
 */
function registerRemoteIPCHandlers(gateway, loggingManager = null) {
  logger.info('[RemoteIPC] 注册 IPC 处理器...');

  // 1. 获取已连接设备列表
  ipcMain.handle('remote:get-connected-devices', async () => {
    try {
      const devices = gateway.getConnectedDevices();
      return { success: true, data: devices };
    } catch (error) {
      logger.error('[RemoteIPC] 获取设备列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 2. 发送命令到设备
  ipcMain.handle('remote:send-command', async (event, { peerId, method, params, timeout }) => {
    try {
      logger.info(`[RemoteIPC] 发送命令: ${method} to ${peerId}`);

      const response = await gateway.sendCommand(peerId, method, params, { timeout });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 发送命令失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 3. 广播事件
  ipcMain.handle('remote:broadcast-event', async (event, { method, params, targetDevices }) => {
    try {
      logger.info(`[RemoteIPC] 广播事件: ${method}`);

      gateway.broadcastEvent(method, params, targetDevices);

      return { success: true };
    } catch (error) {
      logger.error('[RemoteIPC] 广播事件失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 4. 设置设备权限
  ipcMain.handle('remote:set-device-permission', async (event, { did, level, options }) => {
    try {
      logger.info(`[RemoteIPC] 设置设备权限: ${did} -> Level ${level}`);

      await gateway.setDevicePermission(did, level, options);

      return { success: true };
    } catch (error) {
      logger.error('[RemoteIPC] 设置设备权限失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 5. 获取设备权限
  ipcMain.handle('remote:get-device-permission', async (event, { did }) => {
    try {
      const level = await gateway.getDevicePermission(did);

      return { success: true, data: { level } };
    } catch (error) {
      logger.error('[RemoteIPC] 获取设备权限失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 6. 获取审计日志
  ipcMain.handle('remote:get-audit-logs', async (event, options) => {
    try {
      const logs = gateway.getAuditLogs(options);

      return { success: true, data: logs };
    } catch (error) {
      logger.error('[RemoteIPC] 获取审计日志失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 7. 获取统计信息
  ipcMain.handle('remote:get-stats', async () => {
    try {
      const stats = gateway.getStats();

      return { success: true, data: stats };
    } catch (error) {
      logger.error('[RemoteIPC] 获取统计信息失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 8. 断开设备连接（如果支持）
  ipcMain.handle('remote:disconnect-device', async (event, { peerId }) => {
    try {
      logger.info(`[RemoteIPC] 断开设备: ${peerId}`);

      // TODO: 实现设备断开逻辑
      // gateway.disconnectDevice(peerId);

      return { success: true };
    } catch (error) {
      logger.error('[RemoteIPC] 断开设备失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 命令日志相关 IPC 处理器（LoggingManager 集成）
  // ============================================================

  if (loggingManager) {
    // 9. 查询命令日志（支持分页、过滤、搜索）
    ipcMain.handle('remote:logs:query', async (event, options = {}) => {
      try {
        const logs = await loggingManager.queryLogs(options);
        return { success: true, data: logs };
      } catch (error) {
        logger.error('[RemoteIPC] 查询命令日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 10. 获取最近日志（用于实时显示）
    ipcMain.handle('remote:logs:recent', async (event, limit = 20) => {
      try {
        const logs = await loggingManager.getRecentLogs(limit);
        return { success: true, data: logs };
      } catch (error) {
        logger.error('[RemoteIPC] 获取最近日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 11. 获取日志详情
    ipcMain.handle('remote:logs:get', async (event, id) => {
      try {
        const log = await loggingManager.getLog(id);
        return { success: true, data: log };
      } catch (error) {
        logger.error('[RemoteIPC] 获取日志详情失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 12. 导出日志
    ipcMain.handle('remote:logs:export', async (event, options = {}) => {
      try {
        const result = await loggingManager.exportLogs(options);
        return { success: true, data: result };
      } catch (error) {
        logger.error('[RemoteIPC] 导出日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 13. 获取日志统计信息
    ipcMain.handle('remote:logs:stats', async (event, options = {}) => {
      try {
        const stats = await loggingManager.getLogStats(options);
        return { success: true, data: stats };
      } catch (error) {
        logger.error('[RemoteIPC] 获取日志统计失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 14. 获取实时统计数据（内存中的统计）
    ipcMain.handle('remote:logs:realtime-stats', async () => {
      try {
        const stats = loggingManager.getRealTimeStats();
        return { success: true, data: stats };
      } catch (error) {
        logger.error('[RemoteIPC] 获取实时统计失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 15. 获取仪表盘数据（整合数据）
    ipcMain.handle('remote:logs:dashboard', async (event, options = {}) => {
      try {
        const dashboard = await loggingManager.getDashboard(options);
        return { success: true, data: dashboard };
      } catch (error) {
        logger.error('[RemoteIPC] 获取仪表盘数据失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 16. 获取设备活跃度统计
    ipcMain.handle('remote:logs:device-activity', async (event, days = 7) => {
      try {
        const activity = await loggingManager.getDeviceActivity(days);
        return { success: true, data: activity };
      } catch (error) {
        logger.error('[RemoteIPC] 获取设备活跃度失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 17. 获取命令排行
    ipcMain.handle('remote:logs:command-ranking', async (event, topN = 10) => {
      try {
        const ranking = await loggingManager.getCommandRanking(topN);
        return { success: true, data: ranking };
      } catch (error) {
        logger.error('[RemoteIPC] 获取命令排行失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 18. 获取趋势数据
    ipcMain.handle('remote:logs:trend', async (event, { period, days }) => {
      try {
        const trend = await loggingManager.getTrend(period, days);
        return { success: true, data: trend };
      } catch (error) {
        logger.error('[RemoteIPC] 获取趋势数据失败:', error);
        return { success: false, error: error.message };
      }
    });

    logger.info('[RemoteIPC] ✅ 命令日志 IPC 处理器已注册 (10 handlers)');
  } else {
    logger.info('[RemoteIPC] ⚠️  LoggingManager 未提供，跳过命令日志 IPC 注册');
  }

  logger.info('[RemoteIPC] ✅ IPC 处理器注册完成');
}

/**
 * 移除远程控制 IPC 处理器
 */
function removeRemoteIPCHandlers() {
  logger.info('[RemoteIPC] 移除 IPC 处理器...');

  // 基础处理器
  ipcMain.removeHandler('remote:get-connected-devices');
  ipcMain.removeHandler('remote:send-command');
  ipcMain.removeHandler('remote:broadcast-event');
  ipcMain.removeHandler('remote:set-device-permission');
  ipcMain.removeHandler('remote:get-device-permission');
  ipcMain.removeHandler('remote:get-audit-logs');
  ipcMain.removeHandler('remote:get-stats');
  ipcMain.removeHandler('remote:disconnect-device');

  // 命令日志处理器
  ipcMain.removeHandler('remote:logs:query');
  ipcMain.removeHandler('remote:logs:recent');
  ipcMain.removeHandler('remote:logs:get');
  ipcMain.removeHandler('remote:logs:export');
  ipcMain.removeHandler('remote:logs:stats');
  ipcMain.removeHandler('remote:logs:realtime-stats');
  ipcMain.removeHandler('remote:logs:dashboard');
  ipcMain.removeHandler('remote:logs:device-activity');
  ipcMain.removeHandler('remote:logs:command-ranking');
  ipcMain.removeHandler('remote:logs:trend');

  logger.info('[RemoteIPC] IPC 处理器已移除');
}

module.exports = {
  registerRemoteIPCHandlers,
  removeRemoteIPCHandlers
};
