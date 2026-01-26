/**
 * 外部设备文件IPC处理器
 *
 * 为渲染进程提供文件浏览、同步、传输等功能的IPC接口
 */

const { logger } = require('../utils/logger.js');

/**
 * 注册外部设备文件相关的IPC处理器
 * @param {Object} ipcMain - IPC主进程对象
 * @param {Object} externalFileManager - 外部设备文件管理器实例
 */
function registerExternalDeviceFileIPC(ipcMain, externalFileManager) {
  if (!ipcMain || !externalFileManager) {
    logger.error('[ExternalDeviceFileIPC] IPC或管理器实例无效');
    return;
  }

  /**
   * 获取已连接的设备列表
   */
  ipcMain.handle('external-file:get-devices', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取设备列表');

      // 从P2P管理器获取已连接的设备
      const p2pManager = externalFileManager.p2pManager;
      if (!p2pManager || !p2pManager.deviceManager) {
        return {
          success: false,
          error: 'P2P manager not available',
          devices: [],
        };
      }

      // 获取在线设备
      const devices = await p2pManager.deviceManager.getOnlineDevices();

      // 过滤Android设备
      const androidDevices = devices.filter(
        (device) => device.platform === 'android'
      );

      return {
        success: true,
        devices: androidDevices,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取设备列表失败:', error);
      return {
        success: false,
        error: error.message,
        devices: [],
      };
    }
  });

  /**
   * 获取设备的文件列表
   */
  ipcMain.handle('external-file:get-file-list', async (event, deviceId, filters) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取文件列表:', { deviceId, filters });

      const files = await externalFileManager.getDeviceFiles(deviceId, filters);

      return {
        success: true,
        files,
        total: files.length,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取文件列表失败:', error);
      return {
        success: false,
        error: error.message,
        files: [],
        total: 0,
      };
    }
  });

  /**
   * 请求同步设备文件索引
   */
  ipcMain.handle('external-file:request-sync', async (event, deviceId, options) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 请求同步索引:', { deviceId, options });

      const result = await externalFileManager.syncDeviceFileIndex(
        deviceId,
        options
      );

      return result;
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 同步索引失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 拉取文件到本地缓存
   */
  ipcMain.handle('external-file:pull-file', async (event, fileId, options) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 拉取文件:', { fileId, options });

      const result = await externalFileManager.pullFile(fileId, options);

      return result;
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 拉取文件失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导入文件到RAG知识库
   */
  ipcMain.handle('external-file:import-to-rag', async (event, fileId) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 导入文件到RAG:', fileId);

      const result = await externalFileManager.importToRAG(fileId);

      return result;
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 导入RAG失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导入文件到项目
   */
  ipcMain.handle('external-file:import-to-project', async (event, fileId, projectId) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 导入文件到项目:', { fileId, projectId });

      const result = await externalFileManager.importToProject(fileId, projectId);

      return result;
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 导入项目失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取项目列表（用于导入选择）
   */
  ipcMain.handle('external-file:get-projects', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取项目列表');

      const projects = externalFileManager.db
        .prepare(
          `
        SELECT id, name, description, status, created_at
        FROM projects
        WHERE deleted = 0
        ORDER BY updated_at DESC
        LIMIT 100
      `
        )
        .all();

      return {
        success: true,
        projects,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取项目列表失败:', error);
      return {
        success: false,
        error: error.message,
        projects: [],
      };
    }
  });

  /**
   * 获取文件传输进度
   */
  ipcMain.handle('external-file:get-transfer-progress', async (event, transferId) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取传输进度:', transferId);

      const progress = await externalFileManager.getTransferProgress(transferId);

      return {
        success: true,
        progress,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取传输进度失败:', error);
      return {
        success: false,
        error: error.message,
        progress: null,
      };
    }
  });

  /**
   * 取消文件传输
   */
  ipcMain.handle('external-file:cancel-transfer', async (event, transferId) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 取消传输:', transferId);

      await externalFileManager.cancelTransfer(transferId);

      return {
        success: true,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 取消传输失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 搜索文件
   */
  ipcMain.handle('external-file:search', async (event, query, options) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 搜索文件:', { query, options });

      const files = await externalFileManager.searchFiles(query, options);

      return {
        success: true,
        files,
        total: files.length,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 搜索文件失败:', error);
      return {
        success: false,
        error: error.message,
        files: [],
        total: 0,
      };
    }
  });

  /**
   * 获取文件详情
   */
  ipcMain.handle('external-file:get-file-info', async (event, fileId) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取文件详情:', fileId);

      const file = externalFileManager.db
        .prepare('SELECT * FROM external_device_files WHERE id = ?')
        .get(fileId);

      if (!file) {
        return {
          success: false,
          error: 'File not found',
          file: null,
        };
      }

      // 解析metadata和tags
      file.metadata = file.metadata ? JSON.parse(file.metadata) : {};
      file.tags = file.tags ? JSON.parse(file.tags) : [];

      return {
        success: true,
        file,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取文件详情失败:', error);
      return {
        success: false,
        error: error.message,
        file: null,
      };
    }
  });

  /**
   * 切换文件收藏状态
   */
  ipcMain.handle('external-file:toggle-favorite', async (event, fileId) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 切换收藏状态:', fileId);

      // 获取当前状态
      const file = externalFileManager.db
        .prepare('SELECT is_favorite FROM external_device_files WHERE id = ?')
        .get(fileId);

      if (!file) {
        return {
          success: false,
          error: 'File not found',
        };
      }

      // 切换状态
      const newStatus = file.is_favorite ? 0 : 1;

      externalFileManager.db
        .prepare(
          `
        UPDATE external_device_files
        SET is_favorite = ?, updated_at = ?
        WHERE id = ?
      `
        )
        .run(newStatus, Date.now(), fileId);

      return {
        success: true,
        isFavorite: newStatus === 1,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 切换收藏状态失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新文件标签
   */
  ipcMain.handle('external-file:update-tags', async (event, fileId, tags) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 更新文件标签:', { fileId, tags });

      externalFileManager.db
        .prepare(
          `
        UPDATE external_device_files
        SET tags = ?, updated_at = ?
        WHERE id = ?
      `
        )
        .run(JSON.stringify(tags), Date.now(), fileId);

      return {
        success: true,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 更新文件标签失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清理过期缓存
   */
  ipcMain.handle('external-file:cleanup-cache', async (event, expiry) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 清理过期缓存');

      const result = await externalFileManager.cleanupExpiredCache(expiry);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 清理缓存失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取缓存统计信息
   */
  ipcMain.handle('external-file:get-cache-stats', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取缓存统计');

      const stats = externalFileManager.db
        .prepare(
          `
        SELECT
          COUNT(*) as total_files,
          SUM(CASE WHEN is_cached = 1 THEN 1 ELSE 0 END) as cached_files,
          SUM(CASE WHEN is_cached = 1 THEN file_size ELSE 0 END) as cache_size
        FROM external_device_files
      `
        )
        .get();

      return {
        success: true,
        stats: {
          totalFiles: stats.total_files || 0,
          cachedFiles: stats.cached_files || 0,
          cacheSize: stats.cache_size || 0,
          maxCacheSize: externalFileManager.options.maxCacheSize,
          cacheUsagePercent:
            ((stats.cache_size || 0) / externalFileManager.options.maxCacheSize) *
            100,
        },
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取缓存统计失败:', error);
      return {
        success: false,
        error: error.message,
        stats: null,
      };
    }
  });

  /**
   * 获取同步历史
   */
  ipcMain.handle('external-file:get-sync-history', async (event, deviceId, limit) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取同步历史:', { deviceId, limit });

      let query = `
        SELECT * FROM file_sync_logs
        WHERE device_id = ?
        ORDER BY created_at DESC
      `;

      const params = [deviceId];

      if (limit) {
        query += ' LIMIT ?';
        params.push(limit);
      }

      const history = externalFileManager.db.prepare(query).all(...params);

      return {
        success: true,
        history,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取同步历史失败:', error);
      return {
        success: false,
        error: error.message,
        history: [],
      };
    }
  });

  /**
   * 获取活跃的传输任务
   */
  ipcMain.handle('external-file:get-active-transfers', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取活跃传输任务');

      const tasks = externalFileManager.db
        .prepare(
          `
        SELECT t.*, f.display_name, f.file_size
        FROM file_transfer_tasks t
        LEFT JOIN external_device_files f ON t.file_id = f.id
        WHERE t.status IN ('pending', 'in_progress')
        ORDER BY t.created_at DESC
      `
        )
        .all();

      return {
        success: true,
        tasks,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取活跃传输任务失败:', error);
      return {
        success: false,
        error: error.message,
        tasks: [],
      };
    }
  });

  /**
   * 获取性能统计信息
   */
  ipcMain.handle('external-file:get-performance-stats', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取性能统计');

      const stats = externalFileManager.getPerformanceStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取性能统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取最近的传输记录
   */
  ipcMain.handle('external-file:get-recent-transfers', async (event, limit) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取最近传输记录');

      const transfers = externalFileManager.getRecentTransfers(limit || 10);

      return {
        success: true,
        transfers,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取传输记录失败:', error);
      return {
        success: false,
        error: error.message,
        transfers: [],
      };
    }
  });

  /**
   * 获取最近的同步记录
   */
  ipcMain.handle('external-file:get-recent-syncs', async (event, limit) => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取最近同步记录');

      const syncs = externalFileManager.getRecentSyncs(limit || 10);

      return {
        success: true,
        syncs,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取同步记录失败:', error);
      return {
        success: false,
        error: error.message,
        syncs: [],
      };
    }
  });

  /**
   * 生成性能报告
   */
  ipcMain.handle('external-file:generate-performance-report', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 生成性能报告');

      const report = externalFileManager.generatePerformanceReport();

      return {
        success: true,
        report,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 生成性能报告失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重置性能统计
   */
  ipcMain.handle('external-file:reset-performance-metrics', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 重置性能统计');

      externalFileManager.resetPerformanceMetrics();

      return {
        success: true,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 重置性能统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取重试统计信息
   */
  ipcMain.handle('external-file:get-retry-stats', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 获取重试统计');

      const stats = externalFileManager.getRetryStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 获取重试统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重置重试统计
   */
  ipcMain.handle('external-file:reset-retry-stats', async () => {
    try {
      logger.info('[ExternalDeviceFileIPC] 重置重试统计');

      externalFileManager.resetRetryStats();

      return {
        success: true,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileIPC] 重置重试统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  logger.info('[ExternalDeviceFileIPC] IPC处理器注册完成');
}

module.exports = {
  registerExternalDeviceFileIPC,
};
