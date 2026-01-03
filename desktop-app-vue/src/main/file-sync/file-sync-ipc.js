/**
 * 文件同步 IPC 处理器
 * 负责处理所有文件同步相关的前后端通信
 *
 * @module file-sync-ipc
 * @description 提供文件监听、同步状态查询等 IPC 接口
 */

/**
 * 注册所有文件同步 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器实例
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerFileSyncIPC({ fileSyncManager, database, ipcMain: injectedIpcMain }) {
  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require('electron').ipcMain;

  console.log('[File Sync IPC] Registering File Sync IPC handlers...');

  // ============================================================
  // 文件监听控制 (File Watching)
  // ============================================================

  /**
   * 启动项目文件监听
   * Channel: 'file-sync:watch-project'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle('file-sync:watch-project', async (_event, projectId) => {
    try {
      if (!fileSyncManager) {
        return { success: false, error: '文件同步管理器未初始化' };
      }

      if (!projectId) {
        return { success: false, error: '项目ID不能为空' };
      }

      console.log('[File Sync IPC] 启动项目文件监听:', projectId);

      // 获取项目信息
      const project = database.db.prepare('SELECT id, root_path FROM projects WHERE id = ?').get(projectId);

      if (!project) {
        return { success: false, error: '项目不存在' };
      }

      if (!project.root_path) {
        return { success: false, error: '项目未设置根目录' };
      }

      // 启动文件监听
      await fileSyncManager.watchProject(projectId, project.root_path);

      console.log('[File Sync IPC] 文件监听已启动:', projectId);
      return { success: true };
    } catch (error) {
      console.error('[File Sync IPC] 启动文件监听失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 停止项目文件监听
   * Channel: 'file-sync:stop-watch'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle('file-sync:stop-watch', async (_event, projectId) => {
    try {
      if (!fileSyncManager) {
        return { success: false, error: '文件同步管理器未初始化' };
      }

      if (!projectId) {
        return { success: false, error: '项目ID不能为空' };
      }

      console.log('[File Sync IPC] 停止项目文件监听:', projectId);

      // 停止文件监听
      if (fileSyncManager.stopWatching) {
        fileSyncManager.stopWatching(projectId);
      }

      console.log('[File Sync IPC] 文件监听已停止:', projectId);
      return { success: true };
    } catch (error) {
      console.error('[File Sync IPC] 停止文件监听失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取文件同步状态
   * Channel: 'file-sync:get-status'
   *
   * @param {string} fileId - 文件ID
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle('file-sync:get-status', async (_event, fileId) => {
    try {
      if (!database) {
        return { success: false, error: '数据库未初始化' };
      }

      if (!fileId) {
        return { success: false, error: '文件ID不能为空' };
      }

      const status = database.db.prepare(`
        SELECT * FROM file_sync_state WHERE file_id = ?
      `).get(fileId);

      return { success: true, data: status || null };
    } catch (error) {
      console.error('[File Sync IPC] 获取同步状态失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[File Sync IPC] Registered 3 file-sync: handlers');
  console.log('[File Sync IPC] - file-sync:watch-project');
  console.log('[File Sync IPC] - file-sync:stop-watch');
  console.log('[File Sync IPC] - file-sync:get-status');
}

module.exports = { registerFileSyncIPC };
