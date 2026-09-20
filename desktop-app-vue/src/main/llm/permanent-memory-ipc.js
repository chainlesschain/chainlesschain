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
const {
  resolveDesktopContextMemoryCutover,
} = require("../context-memory/authority.js");
const {
  DesktopCanonicalMemoryAdapter,
} = require("../context-memory/permanent-memory-adapter.js");

/**
 * 注册 PermanentMemory IPC 通道
 * @param {PermanentMemoryManager} permanentMemory - PermanentMemoryManager 实例
 */
function registerPermanentMemoryIPC(permanentMemory, options = {}) {
  const contextMemoryCutover = resolveDesktopContextMemoryCutover({
    scopeKey: "desktop:permanent-memory-ipc",
  });
  const canonicalMemory =
    options.canonicalMemory ||
    new DesktopCanonicalMemoryAdapter({
      getPilot: options.getCanonicalPilot || (() => null),
    });
  if (!permanentMemory) {
    logger.warn(
      "[PermanentMemoryIPC] canonical routes remain available without the legacy manager",
    );
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
        if (!contextMemoryCutover.legacyWritable) {
          const result = await canonicalMemory.writeDailyNote(content, {
            append,
          });
          return {
            success: true,
            canonical: true,
            filePath: `canonical://${result.record.memoryId}`,
            result,
          };
        }
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
      if (!contextMemoryCutover.legacyWritable) {
        const content = await canonicalMemory.readDailyNote(date);
        return { success: true, canonical: true, content };
      }
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
        if (!contextMemoryCutover.legacyWritable) {
          const notes = await canonicalMemory.getRecentDailyNotes(limit);
          return { success: true, canonical: true, notes };
        }
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
  ipcMain.handle("memory:read-memory", async (_event) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        const content = await canonicalMemory.readMemory();
        return { success: true, canonical: true, content };
      }
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
        if (!contextMemoryCutover.legacyWritable) {
          const result = await canonicalMemory.appendToMemory(content, {
            section,
          });
          return { success: true, canonical: true, result };
        }
        await permanentMemory.appendToMemory(content, { section });
        return { success: true };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 追加到 MEMORY.md 失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * memory:update-memory
   * 更新 MEMORY.md（完整覆盖）
   */
  ipcMain.handle("memory:update-memory", async (event, { content }) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        const result = await canonicalMemory.updateMemory(content);
        return { success: true, canonical: true, result };
      }
      await permanentMemory.updateMemory(content);
      return { success: true };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 更新 MEMORY.md 失败:", error);
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
  ipcMain.handle("memory:get-stats", async (_event) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        const stats = await canonicalMemory.getStats();
        return { success: true, canonical: true, stats };
      }
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
      if (!contextMemoryCutover.legacyWritable) {
        const results = await canonicalMemory.search(query, options);
        return { success: true, canonical: true, results };
      }
      const results = await permanentMemory.searchMemory(query, options);
      return { success: true, results };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 搜索记忆失败:", error);
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
  ipcMain.handle("memory:get-index-stats", async (_event) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        const stats = await canonicalMemory.getStats();
        return {
          success: true,
          canonical: true,
          stats: {
            embeddingCache: null,
            fileWatcher: null,
            indexedFiles: stats.canonicalRecordsCount,
            authority: stats.authority,
          },
        };
      }
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
  ipcMain.handle("memory:rebuild-index", async (_event) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        const stats = await canonicalMemory.getStats();
        return {
          success: true,
          canonical: true,
          result: {
            rebuilt: false,
            reason: "canonical authority owns its projection",
            records: stats.canonicalRecordsCount,
          },
        };
      }
      const result = await permanentMemory.rebuildIndex();
      return { success: true, result };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 重建索引失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:clear-embedding-cache
   * 清空 Embedding 缓存
   */
  ipcMain.handle("memory:clear-embedding-cache", async (_event) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        return { success: true, canonical: true, deleted: 0 };
      }
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

  // ============================================
  // 会话记忆提取 (Phase 6)
  // ============================================

  /**
   * memory:save-to-memory
   * 保存内容到永久记忆 (可以是对话摘要、技术发现等)
   */
  ipcMain.handle(
    "memory:save-to-memory",
    async (event, { content, type = "conversation", section = null }) => {
      try {
        if (!contextMemoryCutover.legacyWritable) {
          const result = await canonicalMemory.saveToMemory(content, {
            type,
            section,
          });
          return { success: true, canonical: true, result };
        }
        const result = await permanentMemory.saveToMemory(content, {
          type,
          section,
        });
        return { success: true, result };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 保存到记忆失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * memory:extract-from-conversation
   * 从对话中提取重要信息并保存到永久记忆
   */
  ipcMain.handle(
    "memory:extract-from-conversation",
    async (event, { messages, conversationTitle = "" }) => {
      try {
        if (!contextMemoryCutover.legacyWritable) {
          const result = await canonicalMemory.saveConversation(
            messages,
            conversationTitle,
          );
          return { success: true, canonical: true, result };
        }
        const result = await permanentMemory.extractFromConversation(
          messages,
          conversationTitle,
        );
        return { success: true, result };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 提取对话记忆失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * memory:extract-from-session
   * 兼容旧调用：当前默认未实现，避免 renderer 侧出现 No handler registered
   */
  ipcMain.handle("memory:extract-from-session", async (event, { sessionId }) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        return {
          success: false,
          canonical: true,
          code: "CANONICAL_SESSION_TRANSCRIPT_REQUIRED",
          error:
            "Session extraction requires an explicit transcript; use memory/propose",
          sessionId,
          replacement: "coding-agent:app-server-memory-propose",
        };
      }
      if (typeof permanentMemory.extractFromSession === "function") {
        const result = await permanentMemory.extractFromSession(sessionId);
        return { success: true, result };
      }

      return {
        success: false,
        error:
          "extract-from-session is not supported by current PermanentMemoryManager",
      };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 从会话提取记忆失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * memory:get-memory-sections
   * 获取 MEMORY.md 的章节列表
   */
  ipcMain.handle("memory:get-memory-sections", async (_event) => {
    try {
      if (!contextMemoryCutover.legacyWritable) {
        const sections = await canonicalMemory.getMemorySections();
        return { success: true, canonical: true, sections };
      }
      const sections = await permanentMemory.getMemorySections();
      return { success: true, sections };
    } catch (error) {
      logger.error("[PermanentMemoryIPC] 获取记忆章节失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[PermanentMemoryIPC] IPC 通道注册完成 (含混合搜索、索引管理、会话记忆提取)");
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
  // Phase 4 & 5
  ipcMain.removeHandler("memory:get-index-stats");
  ipcMain.removeHandler("memory:rebuild-index");
  ipcMain.removeHandler("memory:clear-embedding-cache");
  // Phase 6
  ipcMain.removeHandler("memory:save-to-memory");
  ipcMain.removeHandler("memory:extract-from-conversation");
  ipcMain.removeHandler("memory:extract-from-session");
  ipcMain.removeHandler("memory:get-memory-sections");

  logger.info("[PermanentMemoryIPC] IPC 通道注销完成");
}

module.exports = {
  registerPermanentMemoryIPC,
  unregisterPermanentMemoryIPC,
};
