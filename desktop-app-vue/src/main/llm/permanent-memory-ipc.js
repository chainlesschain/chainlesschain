/**
 * PermanentMemory IPC 处理器
 *
 * 处理前端与 PermanentMemoryManager 的通信
 *
 * @module permanent-memory-ipc
 * @version 0.1.0
 * @since 2026-02-01
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * 注册 PermanentMemory IPC 通道
 * @param {PermanentMemoryManager} permanentMemory - PermanentMemoryManager 实例
 */
function registerPermanentMemoryIPC(permanentMemory) {
  if (!permanentMemory) {
    logger.error('[PermanentMemoryIPC] permanentMemory 实例未提供');
    return;
  }

  logger.info('[PermanentMemoryIPC] 注册 IPC 通道');

  // ============================================
  // Daily Notes 相关
  // ============================================

  /**
   * memory:write-daily-note
   * 写入今日 Daily Note
   */
  ipcMain.handle('memory:write-daily-note', async (event, { content, append = true }) => {
    try {
      const filePath = await permanentMemory.writeDailyNote(content, { append });
      return { success: true, filePath };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 写入 Daily Note 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:read-daily-note
   * 读取指定日期的 Daily Note
   */
  ipcMain.handle('memory:read-daily-note', async (event, { date }) => {
    try {
      const content = await permanentMemory.readDailyNote(date);
      return { success: true, content };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 读取 Daily Note 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:get-recent-daily-notes
   * 获取最近的 Daily Notes
   */
  ipcMain.handle('memory:get-recent-daily-notes', async (event, { limit = 7 }) => {
    try {
      const notes = await permanentMemory.getRecentDailyNotes(limit);
      return { success: true, notes };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 获取最近 Daily Notes 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // MEMORY.md 相关
  // ============================================

  /**
   * memory:read-memory
   * 读取 MEMORY.md
   */
  ipcMain.handle('memory:read-memory', async (event) => {
    try {
      const content = await permanentMemory.readMemory();
      return { success: true, content };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 读取 MEMORY.md 失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:append-to-memory
   * 追加到 MEMORY.md
   */
  ipcMain.handle('memory:append-to-memory', async (event, { content, section }) => {
    try {
      await permanentMemory.appendToMemory(content, { section });
      return { success: true };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 追加到 MEMORY.md 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // 统计相关
  // ============================================

  /**
   * memory:get-stats
   * 获取记忆统计
   */
  ipcMain.handle('memory:get-stats', async (event) => {
    try {
      const stats = await permanentMemory.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 获取统计失败:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // 工具方法
  // ============================================

  /**
   * memory:get-today-date
   * 获取今日日期 (YYYY-MM-DD)
   */
  ipcMain.handle('memory:get-today-date', async (event) => {
    try {
      const today = permanentMemory.getTodayDate();
      return { success: true, date: today };
    } catch (error) {
      logger.error('[PermanentMemoryIPC] 获取今日日期失败:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[PermanentMemoryIPC] IPC 通道注册完成');
}

/**
 * 注销 PermanentMemory IPC 通道
 */
function unregisterPermanentMemoryIPC() {
  logger.info('[PermanentMemoryIPC] 注销 IPC 通道');

  ipcMain.removeHandler('memory:write-daily-note');
  ipcMain.removeHandler('memory:read-daily-note');
  ipcMain.removeHandler('memory:get-recent-daily-notes');
  ipcMain.removeHandler('memory:read-memory');
  ipcMain.removeHandler('memory:append-to-memory');
  ipcMain.removeHandler('memory:get-stats');
  ipcMain.removeHandler('memory:get-today-date');

  logger.info('[PermanentMemoryIPC] IPC 通道注销完成');
}

module.exports = {
  registerPermanentMemoryIPC,
  unregisterPermanentMemoryIPC,
};
