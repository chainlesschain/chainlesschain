/**
 * 数据库 IPC 处理器
 * 负责处理所有数据库相关的前后端通信
 *
 * @module database-ipc
 * @description 提供知识库 CRUD、标签管理、统计、备份恢复、多身份切换等 IPC 接口
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');
const ipcGuard = require('../ipc/ipc-guard');

/**
 * 注册所有数据库 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} [dependencies.ragManager] - RAG 管理器（用于知识库同步）
 * @param {Function} dependencies.getAppConfig - 获取应用配置函数
 */
function registerDatabaseIPC({ database, ragManager, getAppConfig }) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered('database-ipc')) {
    logger.info('[Database IPC] Handlers already registered, skipping...');
    return;
  }

  logger.info('[Database IPC] Registering Database IPC handlers...');

  // ============================================================
  // 知识库操作 (Knowledge Items CRUD)
  // ============================================================

  /**
   * 获取知识库项列表（分页）
   * Channel: 'db:get-knowledge-items'
   */
  ipcMain.handle('db:get-knowledge-items', async (_event, limit, offset) => {
    try {
      return database?.getKnowledgeItems(limit, offset) || [];
    } catch (error) {
      logger.error('[Database IPC] 获取知识库项失败:', error);
      return [];
    }
  });

  /**
   * 根据 ID 获取知识库项
   * Channel: 'db:get-knowledge-item-by-id'
   */
  ipcMain.handle('db:get-knowledge-item-by-id', async (_event, id) => {
    try {
      return database?.getKnowledgeItemById(id) || null;
    } catch (error) {
      logger.error('[Database IPC] 获取知识库项失败:', error);
      return null;
    }
  });

  /**
   * 添加知识库项（自动同步到 RAG 索引）
   * Channel: 'db:add-knowledge-item'
   */
  ipcMain.handle('db:add-knowledge-item', async (_event, item) => {
    try {
      const newItem = database?.addKnowledgeItem(item);

      // 添加到RAG索引
      if (newItem && ragManager) {
        await ragManager.addToIndex(newItem);
      }

      return newItem;
    } catch (error) {
      logger.error('[Database IPC] 添加知识库项失败:', error);
      throw error;
    }
  });

  /**
   * 更新知识库项（自动更新 RAG 索引）
   * Channel: 'db:update-knowledge-item'
   */
  ipcMain.handle('db:update-knowledge-item', async (_event, id, updates) => {
    try {
      const updatedItem = database?.updateKnowledgeItem(id, updates);

      // 更新RAG索引
      if (updatedItem && ragManager) {
        await ragManager.updateIndex(updatedItem);
      }

      return updatedItem;
    } catch (error) {
      logger.error('[Database IPC] 更新知识库项失败:', error);
      throw error;
    }
  });

  /**
   * 删除知识库项（自动从 RAG 索引移除）
   * Channel: 'db:delete-knowledge-item'
   */
  ipcMain.handle('db:delete-knowledge-item', async (_event, id) => {
    try {
      const result = database?.deleteKnowledgeItem(id);

      // 从RAG索引移除
      if (result && ragManager) {
        ragManager.removeFromIndex(id);
      }

      return result;
    } catch (error) {
      logger.error('[Database IPC] 删除知识库项失败:', error);
      return false;
    }
  });

  /**
   * 搜索知识库项
   * Channel: 'db:search-knowledge-items'
   */
  ipcMain.handle('db:search-knowledge-items', async (_event, query) => {
    try {
      return database?.searchKnowledge(query) || [];
    } catch (error) {
      logger.error('[Database IPC] 搜索知识库项失败:', error);
      return [];
    }
  });

  // ============================================================
  // 标签操作 (Tags Management)
  // ============================================================

  /**
   * 获取所有标签
   * Channel: 'db:get-all-tags'
   */
  ipcMain.handle('db:get-all-tags', async () => {
    try {
      return database?.getAllTags() || [];
    } catch (error) {
      logger.error('[Database IPC] 获取标签失败:', error);
      return [];
    }
  });

  /**
   * 创建新标签
   * Channel: 'db:create-tag'
   */
  ipcMain.handle('db:create-tag', async (_event, name, color) => {
    try {
      return database?.createTag(name, color);
    } catch (error) {
      logger.error('[Database IPC] 创建标签失败:', error);
      throw error;
    }
  });

  /**
   * 获取知识库项的标签
   * Channel: 'db:get-knowledge-tags'
   */
  ipcMain.handle('db:get-knowledge-tags', async (_event, knowledgeId) => {
    try {
      return database?.getKnowledgeTags(knowledgeId) || [];
    } catch (error) {
      logger.error('[Database IPC] 获取知识库项标签失败:', error);
      return [];
    }
  });

  // ============================================================
  // 数据库统计 (Statistics)
  // ============================================================

  /**
   * 获取数据库统计数据
   * Channel: 'db:get-statistics'
   */
  ipcMain.handle('db:get-statistics', async () => {
    try {
      return database?.getStatistics() || { total: 0, today: 0, byType: {} };
    } catch (error) {
      logger.error('[Database IPC] 获取统计数据失败:', error);
      return { total: 0, today: 0, byType: {} };
    }
  });

  /**
   * 获取数据库详细统计信息（调试用）
   * Channel: 'database:get-stats'
   */
  ipcMain.handle('database:get-stats', async () => {
    try {
      if (!database) {
        return { error: '数据库未初始化' };
      }
      return database.getDatabaseStats();
    } catch (error) {
      logger.error('[Database IPC] 获取数据库统计失败:', error);
      return { error: error.message };
    }
  });

  // ============================================================
  // 数据库路径与切换 (Path & Switching)
  // ============================================================

  /**
   * 获取数据库路径
   * Channel: 'db:get-path'
   */
  ipcMain.handle('db:get-path', async () => {
    return database?.getDatabasePath() || null;
  });

  /**
   * 获取当前数据库路径
   * Channel: 'db:get-current-path'
   */
  ipcMain.handle('db:get-current-path', async () => {
    try {
      return database?.getCurrentDatabasePath() || null;
    } catch (error) {
      logger.error('[Database IPC] 获取当前数据库路径失败:', error);
      return null;
    }
  });

  /**
   * 获取身份上下文对应的数据库路径
   * Channel: 'db:get-context-path'
   */
  ipcMain.handle('db:get-context-path', async (_event, contextId) => {
    try {
      if (!database) {
        return null;
      }
      return database.getDatabasePath(contextId);
    } catch (error) {
      logger.error('[Database IPC] 获取数据库路径失败:', error);
      return null;
    }
  });

  /**
   * 切换数据库（企业版多身份功能）
   * Channel: 'db:switch-database'
   */
  ipcMain.handle('db:switch-database', async (_event, contextId, options = {}) => {
    try {
      if (!database) {
        throw new Error('数据库管理器未初始化');
      }

      // 获取新数据库路径
      const newDbPath = database.getDatabasePath(contextId);
      logger.info('[Database IPC] 切换数据库到:', newDbPath, 'contextId:', contextId);

      // 切换数据库
      await database.switchDatabase(newDbPath, options);

      logger.info('[Database IPC] ✓ 数据库切换成功');
      return { success: true, path: newDbPath };
    } catch (error) {
      logger.error('[Database IPC] 切换数据库失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 数据库备份与恢复 (Backup & Restore)
  // ============================================================

  /**
   * 备份数据库到指定路径
   * Channel: 'db:backup'
   */
  ipcMain.handle('db:backup', async (_event, backupPath) => {
    try {
      await database?.backup(backupPath);
      return true;
    } catch (error) {
      logger.error('[Database IPC] 备份数据库失败:', error);
      return false;
    }
  });

  /**
   * 创建数据库备份（自动路径）
   * Channel: 'database:create-backup'
   */
  ipcMain.handle('database:create-backup', async () => {
    try {
      const appConfig = getAppConfig();
      const backupPath = appConfig.createDatabaseBackup();
      return backupPath;
    } catch (error) {
      logger.error('[Database IPC] 创建数据库备份失败:', error);
      throw error;
    }
  });

  /**
   * 列出所有数据库备份
   * Channel: 'database:list-backups'
   */
  ipcMain.handle('database:list-backups', async () => {
    try {
      const appConfig = getAppConfig();
      return appConfig.listBackups();
    } catch (error) {
      logger.error('[Database IPC] 列出备份失败:', error);
      throw error;
    }
  });

  /**
   * 从备份恢复数据库
   * Channel: 'database:restore-backup'
   */
  ipcMain.handle('database:restore-backup', async (_event, backupPath) => {
    try {
      const appConfig = getAppConfig();
      appConfig.restoreFromBackup(backupPath);

      // 需要重启应用才能加载恢复的数据库
      logger.info('[Database IPC] ✓ 数据库恢复成功，需要重启应用');
      return { success: true, needsRestart: true };
    } catch (error) {
      logger.error('[Database IPC] 恢复数据库失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 数据库配置 (Configuration)
  // ============================================================

  /**
   * 获取数据库配置
   * Channel: 'database:get-config'
   */
  ipcMain.handle('database:get-config', async () => {
    try {
      const appConfig = getAppConfig();
      return {
        path: appConfig.getDatabasePath(),
        defaultPath: appConfig.getDefaultDatabasePath(),
        exists: appConfig.databaseExists(),
        autoBackup: appConfig.get('database.autoBackup'),
        maxBackups: appConfig.get('database.maxBackups'),
      };
    } catch (error) {
      logger.error('[Database IPC] 获取数据库配置失败:', error);
      throw error;
    }
  });

  /**
   * 设置数据库路径（需要重启应用）
   * Channel: 'database:set-path'
   */
  ipcMain.handle('database:set-path', async (_event, newPath) => {
    try {
      const appConfig = getAppConfig();
      appConfig.setDatabasePath(newPath);
      logger.info(`[Database IPC] 数据库路径已设置为: ${newPath}`);
      return true;
    } catch (error) {
      logger.error('[Database IPC] 设置数据库路径失败:', error);
      throw error;
    }
  });

  /**
   * 迁移数据库到新位置
   * Channel: 'database:migrate'
   */
  ipcMain.handle('database:migrate', async (_event, newPath) => {
    try {
      const appConfig = getAppConfig();

      // 先备份当前数据库
      const backupPath = appConfig.createDatabaseBackup();
      logger.info(`[Database IPC] 已创建备份: ${backupPath}`);

      // 执行迁移
      await appConfig.migrateDatabaseTo(newPath);

      logger.info(`[Database IPC] 数据库已迁移到: ${newPath}`);

      return {
        success: true,
        newPath,
        backupPath,
      };
    } catch (error) {
      logger.error('[Database IPC] 数据库迁移失败:', error);
      throw error;
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered('database-ipc');

  logger.info('[Database IPC] ✓ All Database IPC handlers registered successfully (22 handlers)');
}

module.exports = {
  registerDatabaseIPC
};
