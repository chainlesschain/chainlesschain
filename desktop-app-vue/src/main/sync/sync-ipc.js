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
  const ipcMain = injectedIpcMain || require('electron').ipcMain;

  console.log('[Sync IPC] Registering Sync IPC handlers...');

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
  ipcMain.handle('sync:start', async (_event, deviceId) => {
    try {
      if (!syncManager) {
        return { success: false, error: '同步管理器未初始化' };
      }

      const finalDeviceId = deviceId || `device-${Date.now()}`;
      console.log('[Sync IPC] 启动数据同步, 设备ID:', finalDeviceId);

      await syncManager.initialize(finalDeviceId);
      await syncManager.syncAfterLogin();

      console.log('[Sync IPC] 数据同步完成');
      return { success: true };
    } catch (error) {
      console.error('[Sync IPC] 同步失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取同步状态
   * Channel: 'sync:get-status'
   *
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle('sync:get-status', async () => {
    try {
      if (!syncManager || !syncManager.httpClient) {
        return { success: false, error: '同步管理器未初始化' };
      }

      const status = await syncManager.httpClient.getSyncStatus(syncManager.deviceId);
      return { success: true, data: status };
    } catch (error) {
      console.error('[Sync IPC] 获取同步状态失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 手动触发增量同步
   * Channel: 'sync:incremental'
   *
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle('sync:incremental', async () => {
    try {
      if (!syncManager) {
        return { success: false, error: '同步管理器未初始化' };
      }

      console.log('[Sync IPC] 手动触发增量同步');
      await syncManager.syncIncremental();

      return { success: true };
    } catch (error) {
      console.error('[Sync IPC] 增量同步失败:', error);
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
  ipcMain.handle('sync:resolve-conflict', async (_event, conflictId, resolution) => {
    try {
      if (!syncManager) {
        return { success: false, error: '同步管理器未初始化' };
      }

      console.log('[Sync IPC] 解决冲突:', conflictId, resolution);
      await syncManager.resolveConflict(conflictId, resolution);

      return { success: true };
    } catch (error) {
      console.error('[Sync IPC] 解决冲突失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Sync IPC] Registered 4 sync: handlers');
  console.log('[Sync IPC] - sync:start');
  console.log('[Sync IPC] - sync:get-status');
  console.log('[Sync IPC] - sync:incremental');
  console.log('[Sync IPC] - sync:resolve-conflict (MAIN IMPL at index.js:3491)');
}

module.exports = { registerSyncIPC };
