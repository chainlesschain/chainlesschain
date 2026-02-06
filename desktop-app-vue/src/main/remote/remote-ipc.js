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

  // 8. 断开设备连接
  ipcMain.handle('remote:disconnect-device', async (event, { peerId }) => {
    try {
      logger.info(`[RemoteIPC] 断开设备: ${peerId}`);

      if (!gateway) {
        return { success: false, error: '远程网关未初始化' };
      }

      const result = await gateway.disconnectDevice(peerId);
      return result;
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

  // ============================================================
  // 文件传输相关 IPC 处理器
  // ============================================================

  // 19. 列出可用的上传/下载目录
  ipcMain.handle('remote:file:list-directories', async () => {
    try {
      const fileHandler = gateway.handlers.file;
      if (!fileHandler) {
        throw new Error('File transfer handler not initialized');
      }

      return {
        success: true,
        data: {
          uploadDir: fileHandler.uploadDir,
          downloadDir: fileHandler.downloadDir,
        },
      };
    } catch (error) {
      logger.error('[RemoteIPC] 获取目录列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 20. 列出可下载的文件
  ipcMain.handle('remote:file:list-available', async (event, { directory = 'uploads' }) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const fileHandler = gateway.handlers.file;

      if (!fileHandler) {
        throw new Error('File transfer handler not initialized');
      }

      const targetDir = directory === 'downloads' ? fileHandler.downloadDir : fileHandler.uploadDir;

      // 读取目录内容
      const files = await fs.readdir(targetDir);
      const fileStats = await Promise.all(
        files.map(async (fileName) => {
          const filePath = path.join(targetDir, fileName);
          const stats = await fs.stat(filePath);

          if (stats.isFile()) {
            return {
              fileName,
              filePath,
              fileSize: stats.size,
              createdAt: stats.birthtimeMs,
              modifiedAt: stats.mtimeMs,
            };
          }

          return null;
        })
      );

      // 过滤掉 null（目录）
      const validFiles = fileStats.filter((file) => file !== null);

      return { success: true, data: validFiles };
    } catch (error) {
      logger.error('[RemoteIPC] 列出文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 21. 开始文件下载（PC → Android）
  ipcMain.handle('remote:file:start-download', async (event, { peerId, filePath, fileName }) => {
    try {
      logger.info(`[RemoteIPC] 开始文件下载: ${filePath} to ${peerId}`);

      const response = await gateway.sendCommand(peerId, 'file.requestDownload', {
        filePath,
        fileName,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 开始下载失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 22. 查询文件传输状态
  ipcMain.handle('remote:file:get-transfer-status', async (event, { peerId, transferId }) => {
    try {
      const fileHandler = gateway.handlers.file;

      if (!fileHandler) {
        throw new Error('File transfer handler not initialized');
      }

      // 从内存中获取传输状态
      const transfer = fileHandler.transfers.get(transferId);

      if (transfer) {
        return {
          success: true,
          data: {
            transferId: transfer.transferId,
            status: transfer.status,
            progress: transfer.progress,
            fileName: transfer.fileName,
            fileSize: transfer.fileSize,
            direction: transfer.direction,
          },
        };
      }

      // 如果内存中没有，从数据库查询
      const dbTransfer = gateway.database
        .prepare(
          `
          SELECT id, direction, file_name, file_size, status, progress, created_at, updated_at, completed_at, error
          FROM file_transfers
          WHERE id = ?
        `
        )
        .get(transferId);

      if (dbTransfer) {
        return { success: true, data: dbTransfer };
      }

      throw new Error(`Transfer not found: ${transferId}`);
    } catch (error) {
      logger.error('[RemoteIPC] 获取传输状态失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 23. 列出设备的传输历史
  ipcMain.handle('remote:file:list-transfers', async (event, { peerId, status, limit, offset }) => {
    try {
      // 获取设备的 DID
      const devices = gateway.getConnectedDevices();
      const device = devices.find((d) => d.peerId === peerId);

      if (!device || !device.did) {
        throw new Error('Device not found or DID not available');
      }

      // 查询传输历史
      const response = await gateway.sendCommand(peerId, 'file.listTransfers', {
        status,
        limit,
        offset,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 列出传输历史失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 24. 取消文件传输
  ipcMain.handle('remote:file:cancel-transfer', async (event, { peerId, transferId }) => {
    try {
      logger.info(`[RemoteIPC] 取消传输: ${transferId}`);

      const response = await gateway.sendCommand(peerId, 'file.cancelTransfer', {
        transferId,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 取消传输失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 25. 获取本地传输历史（PC 端数据库）
  ipcMain.handle('remote:file:get-local-transfers', async (event, { did, status, limit = 50, offset = 0 }) => {
    try {
      let query = `
        SELECT id, device_did, direction, file_name, file_size, total_chunks, status, progress, created_at, updated_at, completed_at, error
        FROM file_transfers
      `;
      const queryParams = [];

      // 构建 WHERE 子句
      const conditions = [];

      if (did) {
        conditions.push('device_did = ?');
        queryParams.push(did);
      }

      if (status) {
        conditions.push('status = ?');
        queryParams.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      // 排序和分页
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);

      const transfers = gateway.database.prepare(query).all(...queryParams);

      return { success: true, data: transfers };
    } catch (error) {
      logger.error('[RemoteIPC] 获取本地传输历史失败:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[RemoteIPC] ✅ 文件传输 IPC 处理器已注册 (7 handlers)');

  // ============================================================
  // 远程桌面相关 IPC 处理器
  // ============================================================

  // 26. 开始远程桌面会话
  ipcMain.handle('remote:desktop:start-session', async (event, { peerId, displayId, quality, maxFps }) => {
    try {
      logger.info(`[RemoteIPC] 开始远程桌面会话: ${peerId}`);

      const response = await gateway.sendCommand(peerId, 'desktop.startSession', {
        displayId,
        quality,
        maxFps,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 开始会话失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 27. 停止远程桌面会话
  ipcMain.handle('remote:desktop:stop-session', async (event, { peerId, sessionId }) => {
    try {
      logger.info(`[RemoteIPC] 停止远程桌面会话: ${sessionId}`);

      const response = await gateway.sendCommand(peerId, 'desktop.stopSession', {
        sessionId,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 停止会话失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 28. 获取屏幕帧
  ipcMain.handle('remote:desktop:get-frame', async (event, { peerId, sessionId, displayId }) => {
    try {
      const response = await gateway.sendCommand(peerId, 'desktop.getFrame', {
        sessionId,
        displayId,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 获取屏幕帧失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 29. 发送输入事件
  ipcMain.handle('remote:desktop:send-input', async (event, { peerId, sessionId, type, data }) => {
    try {
      const response = await gateway.sendCommand(peerId, 'desktop.sendInput', {
        sessionId,
        type,
        data,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 发送输入失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 30. 获取显示器列表
  ipcMain.handle('remote:desktop:get-displays', async (event, { peerId }) => {
    try {
      const response = await gateway.sendCommand(peerId, 'desktop.getDisplays', {});

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 获取显示器列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 31. 切换显示器
  ipcMain.handle('remote:desktop:switch-display', async (event, { peerId, sessionId, displayId }) => {
    try {
      const response = await gateway.sendCommand(peerId, 'desktop.switchDisplay', {
        sessionId,
        displayId,
      });

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 切换显示器失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 32. 获取远程桌面统计
  ipcMain.handle('remote:desktop:get-stats', async (event, { peerId }) => {
    try {
      const response = await gateway.sendCommand(peerId, 'desktop.getStats', {});

      return { success: true, data: response };
    } catch (error) {
      logger.error('[RemoteIPC] 获取统计失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 33. 获取本地桌面会话历史
  ipcMain.handle('remote:desktop:get-local-sessions', async (event, { did, status, limit = 50, offset = 0 }) => {
    try {
      let query = `
        SELECT id, device_did, display_id, quality, max_fps, status, started_at, stopped_at, duration, frame_count, bytes_sent
        FROM remote_desktop_sessions
      `;
      const queryParams = [];

      // 构建 WHERE 子句
      const conditions = [];

      if (did) {
        conditions.push('device_did = ?');
        queryParams.push(did);
      }

      if (status) {
        conditions.push('status = ?');
        queryParams.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      // 排序和分页
      query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);

      const sessions = gateway.database.prepare(query).all(...queryParams);

      return { success: true, data: sessions };
    } catch (error) {
      logger.error('[RemoteIPC] 获取本地会话历史失败:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[RemoteIPC] ✅ 远程桌面 IPC 处理器已注册 (8 handlers)');

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

  // 文件传输处理器
  ipcMain.removeHandler('remote:file:list-directories');
  ipcMain.removeHandler('remote:file:list-available');
  ipcMain.removeHandler('remote:file:start-download');
  ipcMain.removeHandler('remote:file:get-transfer-status');
  ipcMain.removeHandler('remote:file:list-transfers');
  ipcMain.removeHandler('remote:file:cancel-transfer');
  ipcMain.removeHandler('remote:file:get-local-transfers');

  // 远程桌面处理器
  ipcMain.removeHandler('remote:desktop:start-session');
  ipcMain.removeHandler('remote:desktop:stop-session');
  ipcMain.removeHandler('remote:desktop:get-frame');
  ipcMain.removeHandler('remote:desktop:send-input');
  ipcMain.removeHandler('remote:desktop:get-displays');
  ipcMain.removeHandler('remote:desktop:switch-display');
  ipcMain.removeHandler('remote:desktop:get-stats');
  ipcMain.removeHandler('remote:desktop:get-local-sessions');

  logger.info('[RemoteIPC] IPC 处理器已移除');
}

module.exports = {
  registerRemoteIPCHandlers,
  removeRemoteIPCHandlers
};
