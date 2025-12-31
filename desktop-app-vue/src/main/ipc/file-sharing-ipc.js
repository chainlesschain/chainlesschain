/**
 * 文件共享 IPC 处理器
 * Phase 2 - v0.18.0
 *
 * 注册所有文件共享相关的IPC接口（12个）
 */

const { ipcMain } = require('electron');

/**
 * 注册文件共享IPC处理器
 * @param {Object} app - ChainlessChainApp实例
 */
function registerFileSharingIPC(app) {
  console.log('[IPC] 注册文件共享IPC处理器...');

  // ==================== 文件管理IPC（6个）====================

  /**
   * 上传文件
   */
  ipcMain.handle('file:upload', async (event, { fileData }) => {
    try {
      if (!app.fileManager) {
        return { success: false, error: '文件管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const file = await app.fileManager.uploadFile(fileData, currentIdentity.did);

      return { success: true, file };
    } catch (error) {
      console.error('[IPC] 上传文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取文件列表
   */
  ipcMain.handle('file:list', async (event, { filters }) => {
    try {
      if (!app.fileManager) {
        return { success: false, error: '文件管理器未初始化' };
      }

      const files = app.fileManager.getFiles(filters);

      return { success: true, files };
    } catch (error) {
      console.error('[IPC] 获取文件列表失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取文件详情
   */
  ipcMain.handle('file:detail', async (event, { fileId }) => {
    try {
      if (!app.fileManager) {
        return { success: false, error: '文件管理器未初始化' };
      }

      const file = app.fileManager.getFile(fileId);

      return { success: true, file };
    } catch (error) {
      console.error('[IPC] 获取文件详情失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除文件
   */
  ipcMain.handle('file:delete', async (event, { fileId }) => {
    try {
      if (!app.fileManager) {
        return { success: false, error: '文件管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.fileManager.deleteFile(fileId, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 删除文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 锁定文件
   */
  ipcMain.handle('file:lock', async (event, { fileId, expiresIn }) => {
    try {
      if (!app.fileManager) {
        return { success: false, error: '文件管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.fileManager.lockFile(fileId, currentIdentity.did, expiresIn);

      return result;
    } catch (error) {
      console.error('[IPC] 锁定文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 解锁文件
   */
  ipcMain.handle('file:unlock', async (event, { fileId }) => {
    try {
      if (!app.fileManager) {
        return { success: false, error: '文件管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const result = await app.fileManager.unlockFile(fileId, currentIdentity.did);

      return result;
    } catch (error) {
      console.error('[IPC] 解锁文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ==================== 版本控制IPC（3个）====================

  /**
   * 获取文件版本列表
   */
  ipcMain.handle('file:versions', async (event, { fileId }) => {
    try {
      if (!app.versionManager) {
        return { success: false, error: '版本管理器未初始化' };
      }

      const versions = app.versionManager.getFileVersions(fileId);

      return { success: true, versions };
    } catch (error) {
      console.error('[IPC] 获取文件版本失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 回滚到指定版本
   */
  ipcMain.handle('file:rollback', async (event, { fileId, targetVersion }) => {
    try {
      if (!app.versionManager) {
        return { success: false, error: '版本管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const newVersion = app.versionManager.rollbackToVersion(
        fileId,
        targetVersion,
        currentIdentity.did
      );

      return { success: true, version: newVersion };
    } catch (error) {
      console.error('[IPC] 回滚版本失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 比较两个版本
   */
  ipcMain.handle('file:compareVersions', async (event, { fileId, version1, version2 }) => {
    try {
      if (!app.versionManager) {
        return { success: false, error: '版本管理器未初始化' };
      }

      const comparison = app.versionManager.compareVersions(fileId, version1, version2);

      return { success: true, comparison };
    } catch (error) {
      console.error('[IPC] 比较版本失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ==================== 权限管理IPC（3个）====================

  /**
   * 授予文件权限
   */
  ipcMain.handle('file:grantPermission', async (event, { permissionData }) => {
    try {
      if (!app.filePermissionManager) {
        return { success: false, error: '权限管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const permission = await app.filePermissionManager.grantPermission(
        permissionData,
        currentIdentity.did
      );

      return { success: true, permission };
    } catch (error) {
      console.error('[IPC] 授予权限失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 共享文件
   */
  ipcMain.handle('file:share', async (event, { shareData }) => {
    try {
      if (!app.filePermissionManager) {
        return { success: false, error: '权限管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const share = await app.filePermissionManager.shareFile(
        shareData,
        currentIdentity.did
      );

      return { success: true, share };
    } catch (error) {
      console.error('[IPC] 共享文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取共享的文件列表
   */
  ipcMain.handle('file:sharedFiles', async (event, { orgId }) => {
    try {
      if (!app.filePermissionManager) {
        return { success: false, error: '权限管理器未初始化' };
      }

      const currentIdentity = await app.didManager.getDefaultIdentity();
      if (!currentIdentity) {
        return { success: false, error: '未找到当前用户身份' };
      }

      const files = await app.filePermissionManager.getSharedFilesForUser(
        currentIdentity.did,
        orgId
      );

      return { success: true, files };
    } catch (error) {
      console.error('[IPC] 获取共享文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC] ✓ 文件共享IPC处理器注册完成 (12个接口)');
}

module.exports = {
  registerFileSharingIPC
};
