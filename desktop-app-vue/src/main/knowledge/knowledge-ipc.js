/**
 * 知识管理 IPC
 * 处理知识库标签、版本管理、付费内容等操作
 *
 * @module knowledge-ipc
 * @description 知识管理模块，提供标签管理、版本控制、付费内容管理等功能
 */

/**
 * 注册知识管理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.dbManager - 数据库管理器实例
 * @param {Object} dependencies.versionManager - 版本管理器实例
 * @param {Object} dependencies.knowledgePaymentManager - 知识付费管理器实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerKnowledgeIPC({
  dbManager,
  versionManager,
  knowledgePaymentManager,
  ipcMain: injectedIpcMain
}) {
  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require('electron').ipcMain;

  console.log('[Knowledge IPC] Registering Knowledge IPC handlers...');

  // ============================================================
  // 标签管理操作 (1 handler)
  // ============================================================

  /**
   * 获取标签列表
   */
  ipcMain.handle('knowledge:get-tags', async (_event) => {
    try {
      const db = dbManager.db;
      const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
      return { success: true, tags };
    } catch (error) {
      console.error('[Knowledge] 获取标签列表失败:', error);
      return { success: false, error: error.message, tags: [] };
    }
  });

  // ============================================================
  // 版本管理操作 (3 handlers)
  // ============================================================

  /**
   * 获取版本历史
   */
  ipcMain.handle('knowledge:get-version-history', async (_event, params) => {
    try {
      const { knowledgeId, limit = 50 } = params;

      if (!versionManager) {
        return { success: false, error: '版本管理器未初始化', versions: [] };
      }

      // 使用版本管理器获取完整版本历史
      const versions = versionManager.getVersionHistory(knowledgeId, limit);

      // 获取版本统计信息
      const stats = versionManager.getVersionStats(knowledgeId);

      return { success: true, versions, stats };
    } catch (error) {
      console.error('[Knowledge] 获取版本历史失败:', error);
      return { success: false, error: error.message, versions: [] };
    }
  });

  /**
   * 恢复版本
   */
  ipcMain.handle('knowledge:restore-version', async (_event, params) => {
    try {
      const { knowledgeId, versionId, restoredBy } = params;

      if (!versionManager) {
        return { success: false, error: '版本管理器未初始化' };
      }

      // 使用版本管理器恢复版本
      const result = await versionManager.restoreVersion(
        knowledgeId,
        versionId,
        restoredBy
      );

      return result;
    } catch (error) {
      console.error('[Knowledge] 恢复版本失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 对比版本
   */
  ipcMain.handle('knowledge:compare-versions', async (_event, params) => {
    try {
      const { versionId1, versionId2 } = params;

      if (!versionManager) {
        return { success: false, error: '版本管理器未初始化' };
      }

      // 使用版本管理器对比版本
      const result = versionManager.compareVersions(versionId1, versionId2);

      return result;
    } catch (error) {
      console.error('[Knowledge] 对比版本失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 付费内容管理操作 (13 handlers)
  // ============================================================

  /**
   * 创建付费内容
   */
  ipcMain.handle('knowledge:create-content', async (_event, options) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.createPaidContent(options);
    } catch (error) {
      console.error('[Knowledge] 创建付费内容失败:', error);
      throw error;
    }
  });

  /**
   * 更新内容
   */
  ipcMain.handle('knowledge:update-content', async (_event, contentId, updates) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.updateContent(contentId, updates);
    } catch (error) {
      console.error('[Knowledge] 更新内容失败:', error);
      throw error;
    }
  });

  /**
   * 删除内容
   */
  ipcMain.handle('knowledge:delete-content', async (_event, contentId) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.deleteContent(contentId);
    } catch (error) {
      console.error('[Knowledge] 删除内容失败:', error);
      throw error;
    }
  });

  /**
   * 获取内容
   */
  ipcMain.handle('knowledge:get-content', async (_event, contentId) => {
    try {
      if (!knowledgePaymentManager) {
        return null;
      }
      return await knowledgePaymentManager.getContent(contentId);
    } catch (error) {
      console.error('[Knowledge] 获取内容失败:', error);
      return null;
    }
  });

  /**
   * 列出内容
   */
  ipcMain.handle('knowledge:list-contents', async (_event, filters) => {
    try {
      if (!knowledgePaymentManager) {
        return {
          success: true,
          contents: [],
        };
      }
      const contents = await knowledgePaymentManager.listContents(filters);
      return {
        success: true,
        contents: contents || [],
      };
    } catch (error) {
      console.error('[Knowledge] 列出内容失败:', error);
      return {
        success: false,
        contents: [],
        error: error.message,
      };
    }
  });

  /**
   * 购买内容
   */
  ipcMain.handle('knowledge:purchase-content', async (_event, contentId, paymentAssetId) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.purchaseContent(contentId, paymentAssetId);
    } catch (error) {
      console.error('[Knowledge] 购买内容失败:', error);
      throw error;
    }
  });

  /**
   * 订阅
   */
  ipcMain.handle('knowledge:subscribe', async (_event, planId, paymentAssetId) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.subscribe(planId, paymentAssetId);
    } catch (error) {
      console.error('[Knowledge] 订阅失败:', error);
      throw error;
    }
  });

  /**
   * 取消订阅
   */
  ipcMain.handle('knowledge:unsubscribe', async (_event, planId) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.unsubscribe(planId);
    } catch (error) {
      console.error('[Knowledge] 取消订阅失败:', error);
      throw error;
    }
  });

  /**
   * 获取我的购买记录
   */
  ipcMain.handle('knowledge:get-my-purchases', async (_event, userDid) => {
    try {
      if (!knowledgePaymentManager) {
        return [];
      }
      return await knowledgePaymentManager.getMyPurchases(userDid);
    } catch (error) {
      console.error('[Knowledge] 获取购买记录失败:', error);
      return [];
    }
  });

  /**
   * 获取我的订阅记录
   */
  ipcMain.handle('knowledge:get-my-subscriptions', async (_event, userDid) => {
    try {
      if (!knowledgePaymentManager) {
        return [];
      }
      return await knowledgePaymentManager.getMySubscriptions(userDid);
    } catch (error) {
      console.error('[Knowledge] 获取订阅记录失败:', error);
      return [];
    }
  });

  /**
   * 访问内容
   */
  ipcMain.handle('knowledge:access-content', async (_event, contentId) => {
    try {
      if (!knowledgePaymentManager) {
        throw new Error('知识付费管理器未初始化');
      }
      return await knowledgePaymentManager.accessContent(contentId);
    } catch (error) {
      console.error('[Knowledge] 访问内容失败:', error);
      throw error;
    }
  });

  /**
   * 检查访问权限
   */
  ipcMain.handle('knowledge:check-access', async (_event, contentId, userDid) => {
    try {
      if (!knowledgePaymentManager) {
        return false;
      }
      return await knowledgePaymentManager.checkAccess(contentId, userDid);
    } catch (error) {
      console.error('[Knowledge] 检查访问权限失败:', error);
      return false;
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle('knowledge:get-statistics', async (_event, creatorDid) => {
    try {
      if (!knowledgePaymentManager) {
        return null;
      }
      return await knowledgePaymentManager.getStatistics(creatorDid);
    } catch (error) {
      console.error('[Knowledge] 获取统计信息失败:', error);
      return null;
    }
  });

  console.log('[Knowledge IPC] ✓ 17 handlers registered');
  console.log('[Knowledge IPC] - 1 tag management handler');
  console.log('[Knowledge IPC] - 3 version management handlers');
  console.log('[Knowledge IPC] - 13 paid content handlers');
}

module.exports = {
  registerKnowledgeIPC
};
