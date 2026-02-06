/**
 * Memory Store - Pinia 状态管理
 * 管理永久记忆相关状态：Daily Notes、MEMORY.md、混合搜索
 *
 * @module memory-store
 * @version 1.0.0
 * @since 2026-02-02
 */

import { defineStore } from "pinia";

// 安全的 IPC 调用封装
const safeIpcInvoke = async (channel, ...args) => {
  if (!window.electronAPI?.invoke) {
    console.warn(`[MemoryStore] IPC 未就绪: ${channel}`);
    return null;
  }
  try {
    return await window.electronAPI.invoke(channel, ...args);
  } catch (error) {
    console.error(`[MemoryStore] IPC 调用失败: ${channel}`, error);
    throw error;
  }
};

export const useMemoryStore = defineStore("memory", {
  state: () => ({
    // Daily Notes
    dailyNotes: [],
    currentDailyNote: null,
    selectedDate: new Date().toISOString().split("T")[0],

    // MEMORY.md
    memoryContent: "",
    memorySections: [],

    // 搜索
    searchQuery: "",
    searchResults: [],
    searchOptions: {
      vectorWeight: 0.6,
      textWeight: 0.4,
      searchDailyNotes: true,
      searchMemory: true,
      limit: 10,
    },

    // 统计
    stats: {
      dailyNotesCount: 0,
      memorySectionsCount: 0,
      cachedEmbeddingsCount: 0,
      indexedFilesCount: 0,
    },

    // 索引统计
    indexStats: {
      embeddingCache: null,
      fileWatcher: null,
      indexedFiles: 0,
    },

    // 加载状态
    loading: {
      dailyNotes: false,
      memory: false,
      search: false,
      stats: false,
      write: false,
      index: false,
    },

    // 错误状态
    error: null,

    // UI 状态
    activeTab: "daily", // 'daily' | 'memory' | 'search'
    isEditing: false,
    editingContent: "",
  }),

  getters: {
    /**
     * 今日日期
     */
    today: () => new Date().toISOString().split("T")[0],

    /**
     * 当前 Daily Note 是否存在
     */
    hasDailyNote: (state) => !!state.currentDailyNote,

    /**
     * MEMORY.md 章节列表
     */
    sectionList: (state) => {
      const sections = [];
      const regex = /^## (.+)$/gm;
      let match;
      while ((match = regex.exec(state.memoryContent)) !== null) {
        sections.push({
          title: match[1],
          index: match.index,
        });
      }
      return sections;
    },

    /**
     * 搜索结果是否为空
     */
    hasSearchResults: (state) => state.searchResults.length > 0,

    /**
     * 是否正在加载任何内容
     */
    isLoading: (state) =>
      Object.values(state.loading).some((v) => v),

    /**
     * 格式化的统计信息
     */
    formattedStats: (state) => ({
      dailyNotes: `${state.stats.dailyNotesCount} 篇`,
      sections: `${state.stats.memorySectionsCount} 个章节`,
      embeddings: `${state.stats.cachedEmbeddingsCount} 条缓存`,
      indexed: `${state.stats.indexedFilesCount} 个文件`,
    }),
  },

  actions: {
    /**
     * 加载指定日期的 Daily Note
     * @param {string} date - 日期 (YYYY-MM-DD)
     */
    async loadDailyNote(date = null) {
      const targetDate = date || this.selectedDate;
      this.loading.dailyNotes = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:read-daily-note", {
          date: targetDate,
        });

        if (result?.success) {
          this.currentDailyNote = result.content;
          this.selectedDate = targetDate;
        } else {
          this.currentDailyNote = null;
        }
      } catch (error) {
        this.error = error.message;
        this.currentDailyNote = null;
      } finally {
        this.loading.dailyNotes = false;
      }
    },

    /**
     * 加载最近的 Daily Notes 列表
     * @param {number} limit - 数量限制
     */
    async loadRecentDailyNotes(limit = 7) {
      this.loading.dailyNotes = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:get-recent-daily-notes", {
          limit,
        });

        if (result?.success) {
          this.dailyNotes = result.notes || [];
        }
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading.dailyNotes = false;
      }
    },

    /**
     * 写入 Daily Note
     * @param {string} content - 内容
     * @param {Object} options - 选项
     */
    async writeDailyNote(content, options = { append: true }) {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:write-daily-note", {
          content,
          append: options.append,
        });

        if (result?.success) {
          // 重新加载当前日期的 Daily Note
          await this.loadDailyNote(this.today);
          // 重新加载列表
          await this.loadRecentDailyNotes();
          return true;
        }
        return false;
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 加载 MEMORY.md 内容
     */
    async loadMemory() {
      this.loading.memory = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:read-memory");

        if (result?.success) {
          this.memoryContent = result.content || "";
        }
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading.memory = false;
      }
    },

    /**
     * 追加内容到 MEMORY.md
     * @param {string} content - 内容
     * @param {string} section - 章节名称（可选）
     */
    async appendToMemory(content, section = null) {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:append-to-memory", {
          content,
          section,
        });

        if (result?.success) {
          // 重新加载 MEMORY.md
          await this.loadMemory();
          return true;
        }
        return false;
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 执行混合搜索
     * @param {string} query - 搜索查询
     * @param {Object} options - 搜索选项
     */
    async search(query = null, options = {}) {
      const searchQuery = query || this.searchQuery;
      if (!searchQuery.trim()) {
        this.searchResults = [];
        return;
      }

      this.loading.search = true;
      this.error = null;

      try {
        const searchOptions = {
          ...this.searchOptions,
          ...options,
        };

        const result = await safeIpcInvoke("memory:search", {
          query: searchQuery,
          options: searchOptions,
        });

        if (result?.success) {
          this.searchResults = result.results || [];
          this.searchQuery = searchQuery;
        }
      } catch (error) {
        this.error = error.message;
        this.searchResults = [];
      } finally {
        this.loading.search = false;
      }
    },

    /**
     * 更新搜索权重
     * @param {number} vectorWeight - Vector 权重
     * @param {number} textWeight - BM25 权重
     */
    updateSearchWeights(vectorWeight, textWeight) {
      this.searchOptions.vectorWeight = vectorWeight;
      this.searchOptions.textWeight = textWeight;
    },

    /**
     * 加载统计信息
     */
    async loadStats() {
      this.loading.stats = true;

      try {
        const result = await safeIpcInvoke("memory:get-stats");

        if (result?.success) {
          this.stats = result.stats || this.stats;
        }
      } catch (error) {
        console.error("[MemoryStore] 加载统计失败:", error);
      } finally {
        this.loading.stats = false;
      }
    },

    /**
     * 加载索引统计
     */
    async loadIndexStats() {
      try {
        const result = await safeIpcInvoke("memory:get-index-stats");

        if (result?.success) {
          this.indexStats = result.stats || this.indexStats;
        }
      } catch (error) {
        console.error("[MemoryStore] 加载索引统计失败:", error);
      }
    },

    /**
     * 重建索引
     */
    async rebuildIndex() {
      this.loading.index = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:rebuild-index");

        if (result?.success) {
          // 重新加载统计
          await this.loadStats();
          await this.loadIndexStats();
          return result.result;
        }
        return null;
      } catch (error) {
        this.error = error.message;
        return null;
      } finally {
        this.loading.index = false;
      }
    },

    /**
     * 从会话提取记忆
     * @param {string} sessionId - 会话 ID
     */
    async extractFromSession(sessionId) {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:extract-from-session", {
          sessionId,
        });

        if (result?.success) {
          // 重新加载 Daily Note 和 MEMORY
          await this.loadDailyNote(this.today);
          await this.loadMemory();
          return true;
        }
        return false;
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 保存内容到永久记忆
     * @param {string} content - 内容
     * @param {string} type - 类型 (daily, discovery, solution, preference)
     * @param {string} section - 章节名 (可选)
     */
    async saveToMemory(content, type = "daily", section = null) {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:save-to-memory", {
          content,
          type,
          section,
        });

        if (result?.success) {
          // 重新加载相关数据
          if (result.result.savedTo === "daily_notes") {
            await this.loadDailyNote(this.today);
            await this.loadRecentDailyNotes();
          } else {
            await this.loadMemory();
          }
          return result.result;
        }
        return null;
      } catch (error) {
        this.error = error.message;
        return null;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 从对话中提取并保存记忆
     * @param {Array} messages - 消息数组 [{role, content}]
     * @param {string} title - 对话标题
     */
    async extractFromConversation(messages, title = "") {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke("memory:extract-from-conversation", {
          messages,
          conversationTitle: title,
        });

        if (result?.success) {
          // 重新加载数据
          await this.loadDailyNote(this.today);
          await this.loadRecentDailyNotes();
          if (result.result.discoveriesExtracted > 0) {
            await this.loadMemory();
          }
          return result.result;
        }
        return null;
      } catch (error) {
        this.error = error.message;
        return null;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 获取 MEMORY.md 章节列表
     */
    async loadMemorySections() {
      try {
        const result = await safeIpcInvoke("memory:get-memory-sections");

        if (result?.success) {
          this.memorySections = result.sections || [];
          return this.memorySections;
        }
        return [];
      } catch (error) {
        console.error("[MemoryStore] 加载章节列表失败:", error);
        return [];
      }
    },

    /**
     * 切换标签页
     * @param {string} tab - 标签页名称
     */
    setActiveTab(tab) {
      this.activeTab = tab;
    },

    /**
     * 开始编辑
     */
    startEditing() {
      this.isEditing = true;
      this.editingContent = this.activeTab === "memory"
        ? this.memoryContent
        : this.currentDailyNote || "";
    },

    /**
     * 取消编辑
     */
    cancelEditing() {
      this.isEditing = false;
      this.editingContent = "";
    },

    /**
     * 保存编辑
     */
    async saveEditing() {
      if (this.activeTab === "memory") {
        // 保存 MEMORY.md - 完整覆盖
        const success = await this.updateMemory(this.editingContent);
        if (success) {
          this.cancelEditing();
        }
      } else {
        // 保存 Daily Note
        await this.writeDailyNote(this.editingContent, { append: false });
        this.cancelEditing();
      }
    },

    /**
     * 更新 MEMORY.md（完整覆盖）
     * @param {string} content - 新的完整内容
     * @returns {Promise<boolean>} 是否成功
     */
    async updateMemory(content) {
      this.loading.memory = true;
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "memory:update-memory",
          { content }
        );
        if (result.success) {
          this.memoryContent = content;
          return true;
        } else {
          this.error = result.error || "更新失败";
          return false;
        }
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.loading.memory = false;
      }
    },

    /**
     * 选择日期
     * @param {string} date - 日期
     */
    selectDate(date) {
      this.selectedDate = date;
      this.loadDailyNote(date);
    },

    /**
     * 清除搜索结果
     */
    clearSearch() {
      this.searchQuery = "";
      this.searchResults = [];
    },

    /**
     * 清除错误
     */
    clearError() {
      this.error = null;
    },

    /**
     * 初始化 store
     */
    async initialize() {
      await Promise.all([
        this.loadRecentDailyNotes(),
        this.loadDailyNote(this.today),
        this.loadMemory(),
        this.loadStats(),
        this.loadMemorySections(),
      ]);
    },
  },
});
