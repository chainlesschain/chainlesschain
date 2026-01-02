/**
 * Identity Context IPC 处理器
 * 负责处理身份上下文切换相关的前后端通信（企业版功能）
 *
 * @module identity-context-ipc
 * @description 提供身份上下文的创建、切换、删除、历史记录等 IPC 接口
 */

const { ipcMain } = require('electron');

/**
 * 注册所有 Identity Context IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.identityContextManager - 身份上下文管理器
 */
function registerIdentityContextIPC({ identityContextManager }) {
  console.log('[Identity Context IPC] Registering Identity Context IPC handlers...');

  // ============================================================
  // 身份上下文管理 (Identity Context Management)
  // ============================================================

  /**
   * 获取所有身份上下文
   * Channel: 'identity:get-all-contexts'
   */
  ipcMain.handle('identity:get-all-contexts', async (_event, { userDID }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化', contexts: [] };
      }

      const contexts = identityContextManager.getAllContexts(userDID);
      return { success: true, contexts };
    } catch (error) {
      console.error('[Identity Context IPC] 获取身份上下文列表失败:', error);
      return { success: false, error: error.message, contexts: [] };
    }
  });

  /**
   * 获取当前激活的上下文
   * Channel: 'identity:get-active-context'
   */
  ipcMain.handle('identity:get-active-context', async (_event, { userDID }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化' };
      }

      const context = identityContextManager.getActiveContext(userDID);
      return { success: true, context };
    } catch (error) {
      console.error('[Identity Context IPC] 获取当前上下文失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建个人上下文
   * Channel: 'identity:create-personal-context'
   */
  ipcMain.handle('identity:create-personal-context', async (_event, { userDID, displayName }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化' };
      }

      return await identityContextManager.createPersonalContext(userDID, displayName);
    } catch (error) {
      console.error('[Identity Context IPC] 创建个人上下文失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建组织上下文
   * Channel: 'identity:create-organization-context'
   */
  ipcMain.handle('identity:create-organization-context', async (_event, { userDID, orgId, orgDID, displayName, avatar }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化' };
      }

      return await identityContextManager.createOrganizationContext(userDID, orgId, orgDID, displayName, avatar);
    } catch (error) {
      console.error('[Identity Context IPC] 创建组织上下文失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 切换身份上下文
   * Channel: 'identity:switch-context'
   */
  ipcMain.handle('identity:switch-context', async (_event, { userDID, targetContextId }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化' };
      }

      return await identityContextManager.switchContext(userDID, targetContextId);
    } catch (error) {
      console.error('[Identity Context IPC] 切换身份上下文失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 删除组织上下文
   * Channel: 'identity:delete-organization-context'
   */
  ipcMain.handle('identity:delete-organization-context', async (_event, { userDID, orgId }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化' };
      }

      return await identityContextManager.deleteOrganizationContext(userDID, orgId);
    } catch (error) {
      console.error('[Identity Context IPC] 删除组织上下文失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取切换历史
   * Channel: 'identity:get-switch-history'
   */
  ipcMain.handle('identity:get-switch-history', async (_event, { userDID, limit }) => {
    try {
      if (!identityContextManager) {
        return { success: false, error: '身份上下文管理器未初始化', history: [] };
      }

      const history = identityContextManager.getSwitchHistory(userDID, limit);
      return { success: true, history };
    } catch (error) {
      console.error('[Identity Context IPC] 获取切换历史失败:', error);
      return { success: false, error: error.message, history: [] };
    }
  });

  console.log('[Identity Context IPC] ✓ All Identity Context IPC handlers registered successfully (7 handlers)');
}

module.exports = {
  registerIdentityContextIPC
};
