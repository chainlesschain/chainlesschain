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

  /**
   * memory:update-memory
   * 更新 MEMORY.md（完整覆盖）
   */
  ipcMain.handle("memory:update-memory", async (event, { content }) => {
    try {
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
   * memory:get-memory-sections
   * 获取 MEMORY.md 的章节列表
   */
  ipcMain.handle("memory:get-memory-sections", async (event) => {
    try {
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
 * 注册高级搜索和分析 IPC 通道 (Phase 7)
 * @param {Object} advancedSearch - AdvancedMemorySearch 实例
 * @param {Object} memoryAnalytics - MemoryAnalytics 实例
 * @param {Object} semanticChunker - SemanticChunker 实例
 */
function registerAdvancedMemoryIPC(advancedSearch, memoryAnalytics, semanticChunker) {
  logger.info("[PermanentMemoryIPC] 注册高级搜索和分析 IPC 通道");

  // ============================================
  // 高级搜索 (Phase 7)
  // ============================================

  if (advancedSearch) {
    /**
     * memory:advanced-search
     * 高级搜索 - 支持时间过滤、分面搜索、层级搜索
     */
    ipcMain.handle(
      "memory:advanced-search",
      async (event, { query, options = {} }) => {
        try {
          const results = await advancedSearch.search(query, options);
          return { success: true, ...results };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 高级搜索失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:search-by-tier
     * 按记忆层级搜索 (working, recall, archival)
     */
    ipcMain.handle(
      "memory:search-by-tier",
      async (event, { query, tier, options = {} }) => {
        try {
          const results = await advancedSearch.searchByTier(query, tier, options);
          return { success: true, ...results };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 层级搜索失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:search-by-date-range
     * 按时间范围搜索
     */
    ipcMain.handle(
      "memory:search-by-date-range",
      async (event, { query, dateFrom, dateTo, options = {} }) => {
        try {
          const results = await advancedSearch.searchByDateRange(
            query,
            dateFrom,
            dateTo,
            options,
          );
          return { success: true, ...results };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 时间范围搜索失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:get-important-memories
     * 获取重要记忆
     */
    ipcMain.handle(
      "memory:get-important-memories",
      async (event, { minImportance = 4, limit = 50 }) => {
        try {
          const memories = await advancedSearch.getImportantMemories({
            minImportance,
            limit,
          });
          return { success: true, memories };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 获取重要记忆失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:get-recent-memories
     * 获取最近记忆
     */
    ipcMain.handle(
      "memory:get-recent-memories",
      async (event, { days = 7, limit = 50 }) => {
        try {
          const memories = await advancedSearch.getRecentMemories({ days, limit });
          return { success: true, memories };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 获取最近记忆失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:set-importance
     * 设置记忆重要性
     */
    ipcMain.handle(
      "memory:set-importance",
      async (event, { memoryId, importance }) => {
        try {
          const result = await advancedSearch.setImportance(memoryId, importance);
          return { success: result };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 设置重要性失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:get-memory-tier-stats
     * 获取记忆层级统计
     */
    ipcMain.handle("memory:get-memory-tier-stats", async (event) => {
      try {
        const stats = await advancedSearch.getMemoryStats();
        return { success: true, stats };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取层级统计失败:", error);
        return { success: false, error: error.message };
      }
    });
  }

  // ============================================
  // 记忆分析 (Phase 7)
  // ============================================

  if (memoryAnalytics) {
    /**
     * memory:get-dashboard-data
     * 获取综合仪表板数据
     */
    ipcMain.handle("memory:get-dashboard-data", async (event) => {
      try {
        const data = await memoryAnalytics.getDashboardData();
        return { success: true, data };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取仪表板数据失败:", error);
        return { success: false, error: error.message };
      }
    });

    /**
     * memory:get-overview
     * 获取记忆概览
     */
    ipcMain.handle("memory:get-overview", async (event) => {
      try {
        const overview = await memoryAnalytics.getOverview();
        return { success: true, overview };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取概览失败:", error);
        return { success: false, error: error.message };
      }
    });

    /**
     * memory:get-trends
     * 获取趋势数据
     */
    ipcMain.handle("memory:get-trends", async (event, { days = 30 }) => {
      try {
        const trends = await memoryAnalytics.getTrends(days);
        return { success: true, trends };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取趋势数据失败:", error);
        return { success: false, error: error.message };
      }
    });

    /**
     * memory:get-top-keywords
     * 获取热门关键词
     */
    ipcMain.handle("memory:get-top-keywords", async (event, { limit = 10 }) => {
      try {
        const keywords = await memoryAnalytics.getTopKeywords(limit);
        return { success: true, keywords };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取热门关键词失败:", error);
        return { success: false, error: error.message };
      }
    });

    /**
     * memory:get-search-statistics
     * 获取搜索统计
     */
    ipcMain.handle("memory:get-search-statistics", async (event) => {
      try {
        const stats = await memoryAnalytics.getSearchStatistics();
        return { success: true, stats };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取搜索统计失败:", error);
        return { success: false, error: error.message };
      }
    });

    /**
     * memory:get-health-score
     * 获取记忆健康度评分
     */
    ipcMain.handle("memory:get-health-score", async (event) => {
      try {
        const healthScore = await memoryAnalytics.calculateHealthScore();
        return { success: true, healthScore };
      } catch (error) {
        logger.error("[PermanentMemoryIPC] 获取健康度评分失败:", error);
        return { success: false, error: error.message };
      }
    });
  }

  // ============================================
  // 语义分块 (Phase 7)
  // ============================================

  if (semanticChunker) {
    /**
     * memory:chunk-document
     * 对文档进行语义分块
     */
    ipcMain.handle(
      "memory:chunk-document",
      async (event, { content, metadata = {} }) => {
        try {
          const chunks = semanticChunker.chunk(content, metadata);
          return { success: true, chunks };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 语义分块失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    /**
     * memory:update-chunker-config
     * 更新分块器配置
     */
    ipcMain.handle(
      "memory:update-chunker-config",
      async (event, { config }) => {
        try {
          semanticChunker.updateConfig(config);
          return { success: true };
        } catch (error) {
          logger.error("[PermanentMemoryIPC] 更新分块配置失败:", error);
          return { success: false, error: error.message };
        }
      },
    );
  }

  logger.info("[PermanentMemoryIPC] 高级搜索和分析 IPC 通道注册完成");
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
  // Phase 6
  ipcMain.removeHandler("memory:save-to-memory");
  ipcMain.removeHandler("memory:extract-from-conversation");
  ipcMain.removeHandler("memory:get-memory-sections");

  logger.info("[PermanentMemoryIPC] IPC 通道注销完成");
}

/**
 * 注销高级搜索和分析 IPC 通道
 */
function unregisterAdvancedMemoryIPC() {
  logger.info("[PermanentMemoryIPC] 注销高级搜索和分析 IPC 通道");

  // 高级搜索
  ipcMain.removeHandler("memory:advanced-search");
  ipcMain.removeHandler("memory:search-by-tier");
  ipcMain.removeHandler("memory:search-by-date-range");
  ipcMain.removeHandler("memory:get-important-memories");
  ipcMain.removeHandler("memory:get-recent-memories");
  ipcMain.removeHandler("memory:set-importance");
  ipcMain.removeHandler("memory:get-memory-tier-stats");

  // 记忆分析
  ipcMain.removeHandler("memory:get-dashboard-data");
  ipcMain.removeHandler("memory:get-overview");
  ipcMain.removeHandler("memory:get-trends");
  ipcMain.removeHandler("memory:get-top-keywords");
  ipcMain.removeHandler("memory:get-search-statistics");
  ipcMain.removeHandler("memory:get-health-score");

  // 语义分块
  ipcMain.removeHandler("memory:chunk-document");
  ipcMain.removeHandler("memory:update-chunker-config");

  logger.info("[PermanentMemoryIPC] 高级搜索和分析 IPC 通道注销完成");
}

module.exports = {
  registerPermanentMemoryIPC,
  unregisterPermanentMemoryIPC,
  registerAdvancedMemoryIPC,
  unregisterAdvancedMemoryIPC,
};
