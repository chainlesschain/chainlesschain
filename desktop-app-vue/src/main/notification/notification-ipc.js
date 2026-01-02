/**
 * 通知 IPC 处理器
 * 负责处理所有通知相关的前后端通信
 *
 * @module notification-ipc
 * @description 提供通知标记、未读计数、桌面通知等 IPC 接口
 */

const { ipcMain, Notification } = require('electron');
const path = require('path');

/**
 * 注册所有通知 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器实例
 */
function registerNotificationIPC({ database }) {
  console.log('[Notification IPC] Registering Notification IPC handlers...');

  // ============================================================
  // 通知管理 (Notification Management)
  // ============================================================

  /**
   * 标记单个通知为已读
   * Channel: 'notification:mark-read'
   *
   * @param {number} id - 通知ID
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('notification:mark-read', async (_event, id) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      database.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
      database.saveToFile();

      return { success: true };
    } catch (error) {
      console.error('[Notification IPC] 标记通知已读失败:', error);
      throw error;
    }
  });

  /**
   * 标记所有通知为已读
   * Channel: 'notification:mark-all-read'
   *
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('notification:mark-all-read', async () => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      database.db.prepare('UPDATE notifications SET is_read = 1').run();
      database.saveToFile();

      return { success: true };
    } catch (error) {
      console.error('[Notification IPC] 全部标记已读失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 通知查询 (Notification Query)
  // ============================================================

  /**
   * 获取所有通知
   * Channel: 'notification:get-all'
   *
   * @param {Object} options - 查询选项 (limit, offset, isRead)
   * @returns {Promise<Array>} 通知列表
   */
  ipcMain.handle('notification:get-all', async (_event, options = {}) => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      const { limit = 50, offset = 0, isRead } = options;

      let query = 'SELECT * FROM notifications';
      const params = [];

      if (isRead !== undefined) {
        query += ' WHERE is_read = ?';
        params.push(isRead ? 1 : 0);
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const notifications = database.db.prepare(query).all(...params);

      return {
        success: true,
        notifications: notifications || [],
      };
    } catch (error) {
      console.error('[Notification IPC] 获取通知列表失败:', error);
      return {
        success: false,
        notifications: [],
        error: error.message,
      };
    }
  });

  /**
   * 获取未读通知数量
   * Channel: 'notification:get-unread-count'
   *
   * @returns {Promise<{success: boolean, count: number}>} 未读通知数量
   */
  ipcMain.handle('notification:get-unread-count', async () => {
    try {
      if (!database || !database.db) {
        throw new Error('数据库未初始化');
      }

      const result = database.db
        .prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0')
        .get();

      return {
        success: true,
        count: result.count || 0,
      };
    } catch (error) {
      console.error('[Notification IPC] 获取未读数量失败:', error);
      return {
        success: false,
        count: 0,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 桌面通知 (Desktop Notification)
  // ============================================================

  /**
   * 发送系统桌面通知
   * Channel: 'notification:send-desktop'
   *
   * @param {string} title - 通知标题
   * @param {string} body - 通知内容
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle('notification:send-desktop', async (_event, title, body) => {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: title,
          body: body,
          icon: path.join(__dirname, '../../resources/icon.png'), // 确保有icon文件
        });

        notification.show();
      }

      return { success: true };
    } catch (error) {
      console.error('[Notification IPC] 发送桌面通知失败:', error);
      // 不抛出错误，允许通知失败时应用继续运行
      return { success: false, error: error.message };
    }
  });

  console.log('[Notification IPC] Registered 5 notification: handlers');
  console.log('[Notification IPC] - notification:get-all');
  console.log('[Notification IPC] - notification:mark-read');
  console.log('[Notification IPC] - notification:mark-all-read');
  console.log('[Notification IPC] - notification:get-unread-count');
  console.log('[Notification IPC] - notification:send-desktop');
}

module.exports = { registerNotificationIPC };
