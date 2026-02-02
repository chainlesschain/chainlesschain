/**
 * PermanentMemory IPC 处理器
 *
 * 处理前端与 PermanentMemoryManager 的通信
 *
 * @module permanent-memory-ipc
 * @version 0.1.0
 * @since 2026-02-01
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * 注册 PermanentMemory IPC 通道
 * @param {PermanentMemoryManager} permanentMemory - PermanentMemoryManager 实例
 */
function registerPermanentMemoryIPC(permanentMemory) {
  if (!permanentMemory) {
    logger.error("[PermanentMemoryIPC] permanentMemory 实例未提供");
    return;
  }

  logger.info("[PermanentMemoryIPC] 注册 IPC 通道");

  // ============================================
  // Daily Notes 相关
  // ============================================

  /**
   * memory:write-daily-note
   * 写入今日 Daily Note
   */
  ipcMain.handle(
    "memory:write-daily-note",
    async (event, { content, append = true }) => {
      try {
        const filePath = await permanentMemory.writeDailyNote(content, {
          append,
        });
        return { success: true, filePath };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 写入 Daily Note 失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * memory:read-daily-note
   * 读取指定日期的 Daily Note
   */
  ipcMain.handle("memory:read-daily-note", async (event, { date }) => {
    try {
      const content = await permanentMemory.readDailyNote(date);
      return { success: true, content };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 读取 Daily Note 失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:get-recent-daily-notes
   * 获取最近的 Daily Notes
   */
  ipcMain.handle(
    "memory:get-recent-daily-notes",
    async (event, { limit = 7 }) => {
      try {
        const notes = await permanentMemory.getRecentDailyNotes(limit);
        return { success: true, notes };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取最近 Daily Notes 失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================
  // MEMORY.md 相关
  // ============================================

  /**
   * memory:read-memory
   * 读取 MEMORY.md
   */
  ipcMain.handle("memory:read-memory", async (event) => {
    try {
      const content = await permanentMemory.readMemory();
      return { success: true, content };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 读取 MEMORY.md 失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:append-to-memory
   * 追加到 MEMORY.md
   */
  ipcMain.handle(
    "memory:append-to-memory",
    async (event, { content, section }) => {
      try {
        await permanentMemory.appendToMemory(content, { section });
        return { success: true };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 追加到 MEMORY.md 失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================
  // 统计相关
  // ============================================

  /**
   * memory:get-stats
   * 获取记忆统计
   */
  ipcMain.handle("memory:get-stats", async (event) => {
    try {
      const stats = await permanentMemory.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 获取统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // 搜索相关 (Phase 2)
  // ============================================

  /**
   * memory:search
   * 混合搜索记忆 (Vector + BM25)
   */
  ipcMain.handle("memory:search", async (event, { query, options = {} }) => {
    try {
      const results = await permanentMemory.searchMemory(query, options);
      return { success: true, results };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 搜索记忆失败:", error);
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
  ipcMain.handle("memory:get-today-date", async (event) => {
    try {
      const today = permanentMemory.getTodayDate();
      return { success: true, date: today };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 获取今日日期失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // 索引相关 (Phase 4 & 5)
  // ============================================

  /**
   * memory:get-index-stats
   * 获取索引统计信息
   */
  ipcMain.handle("memory:get-index-stats", async (event) => {
    try {
      const stats = permanentMemory.getIndexStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 获取索引统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:rebuild-index
   * 全量重建索引
   */
  ipcMain.handle("memory:rebuild-index", async (event) => {
    try {
      const result = await permanentMemory.rebuildIndex();
      return { success: true, result };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 重建索引失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:start-file-watcher
   * 启动文件监听
   */
  ipcMain.handle("memory:start-file-watcher", async (event) => {
    try {
      await permanentMemory.startFileWatcher();
      return { success: true };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 启动文件监听失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:stop-file-watcher
   * 停止文件监听
   */
  ipcMain.handle("memory:stop-file-watcher", async (event) => {
    try {
      await permanentMemory.stopFileWatcher();
      return { success: true };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 停止文件监听失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:get-embedding-cache-stats
   * 获取 Embedding 缓存统计
   */
  ipcMain.handle("memory:get-embedding-cache-stats", async (event) => {
    try {
      if (!permanentMemory.embeddingCache) {
        return { success: false, error: "Embedding 缓存未启用" };
      }
      const stats = permanentMemory.embeddingCache.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 获取 Embedding 缓存统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:clear-embedding-cache
   * 清空 Embedding 缓存
   */
  ipcMain.handle("memory:clear-embedding-cache", async (event) => {
    try {
      if (!permanentMemory.embeddingCache) {
        return { success: false, error: "Embedding 缓存未启用" };
      }
      const deleted = permanentMemory.embeddingCache.clear();
      return { success: true, deleted };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 清空 Embedding 缓存失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[PermanentMemoryIPC] IPC 通道注册完成 (含混合搜索、索引管理)");
}

/**
 * 注销 PermanentMemory IPC 通道
 */
function unregisterPermanentMemoryIPC() {
  logger.info("[PermanentMemoryIPC] 注销 IPC 通道");

  ipcMain.removeHandler("memory:write-daily-note");
  ipcMain.removeHandler("memory:read-daily-note");
  ipcMain.removeHandler("memory:get-recent-daily-notes");
  ipcMain.removeHandler("memory:read-memory");
  ipcMain.removeHandler("memory:append-to-memory");
  ipcMain.removeHandler("memory:get-stats");
  ipcMain.removeHandler("memory:search");
  ipcMain.removeHandler("memory:get-today-date");
  // Phase 4 & 5
  ipcMain.removeHandler("memory:get-index-stats");
  ipcMain.removeHandler("memory:rebuild-index");
  ipcMain.removeHandler("memory:start-file-watcher");
  ipcMain.removeHandler("memory:stop-file-watcher");
  ipcMain.removeHandler("memory:get-embedding-cache-stats");
  ipcMain.removeHandler("memory:clear-embedding-cache");

  logger.info("[PermanentMemoryIPC] IPC 通道注销完成");
}

module.exports = {
  registerPermanentMemoryIPC,
  unregisterPermanentMemoryIPC,
};
