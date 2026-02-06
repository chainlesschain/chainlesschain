/**
 * Memory Store - Pinia 状态管理
 * 管理永久记忆相关状态：Daily Notes、MEMORY.md、混合搜索
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * Daily Note
 */
export interface DailyNote {
  date: string;
  content: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Memory Section
 */
export interface MemorySection {
  title: string;
  index: number;
  content?: string;
}

/**
 * 搜索结果项
 */
export interface SearchResult {
  id: string;
  type: 'daily' | 'memory';
  title: string;
  content: string;
  score: number;
  date?: string;
  section?: string;
  highlights?: string[];
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  vectorWeight: number;
  textWeight: number;
  searchDailyNotes: boolean;
  searchMemory: boolean;
  limit: number;
}

/**
 * 统计信息
 */
export interface MemoryStats {
  dailyNotesCount: number;
  memorySectionsCount: number;
  cachedEmbeddingsCount: number;
  indexedFilesCount: number;
}

/**
 * 索引统计
 */
export interface IndexStats {
  embeddingCache: any | null;
  fileWatcher: any | null;
  indexedFiles: number;
}

/**
 * 加载状态
 */
export interface LoadingState {
  dailyNotes: boolean;
  memory: boolean;
  search: boolean;
  stats: boolean;
  write: boolean;
  index: boolean;
}

/**
 * 格式化的统计信息
 */
export interface FormattedStats {
  dailyNotes: string;
  sections: string;
  embeddings: string;
  indexed: string;
}

/**
 * IPC 结果类型
 */
interface IpcResult<T = any> {
  success: boolean;
  content?: T;
  notes?: DailyNote[];
  results?: SearchResult[];
  stats?: MemoryStats;
  sections?: MemorySection[];
  result?: any;
  error?: string;
}

/**
 * Memory Store 状态
 */
export interface MemoryState {
  dailyNotes: DailyNote[];
  currentDailyNote: string | null;
  selectedDate: string;
  memoryContent: string;
  memorySections: MemorySection[];
  searchQuery: string;
  searchResults: SearchResult[];
  searchOptions: SearchOptions;
  stats: MemoryStats;
  indexStats: IndexStats;
  loading: LoadingState;
  error: string | null;
  activeTab: 'daily' | 'memory' | 'search';
  isEditing: boolean;
  editingContent: string;
}

// ==================== Helper Functions ====================

/**
 * 安全的 IPC 调用封装
 */
async function safeIpcInvoke<T = any>(channel: string, ...args: any[]): Promise<IpcResult<T> | null> {
  if (!(window as any).electronAPI?.invoke) {
    console.warn(`[MemoryStore] IPC 未就绪: ${channel}`);
    return null;
  }
  try {
    return await (window as any).electronAPI.invoke(channel, ...args);
  } catch (error) {
    console.error(`[MemoryStore] IPC 调用失败: ${channel}`, error);
    throw error;
  }
}

// ==================== Store ====================

export const useMemoryStore = defineStore('memory', {
  state: (): MemoryState => ({
    // Daily Notes
    dailyNotes: [],
    currentDailyNote: null,
    selectedDate: new Date().toISOString().split('T')[0],

    // MEMORY.md
    memoryContent: '',
    memorySections: [],

    // 搜索
    searchQuery: '',
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
    activeTab: 'daily',
    isEditing: false,
    editingContent: '',
  }),

  getters: {
    /**
     * 今日日期
     */
    today(): string {
      return new Date().toISOString().split('T')[0];
    },

    /**
     * 当前 Daily Note 是否存在
     */
    hasDailyNote(): boolean {
      return !!this.currentDailyNote;
    },

    /**
     * MEMORY.md 章节列表
     */
    sectionList(): MemorySection[] {
      const sections: MemorySection[] = [];
      const regex = /^## (.+)$/gm;
      let match;
      while ((match = regex.exec(this.memoryContent)) !== null) {
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
    hasSearchResults(): boolean {
      return this.searchResults.length > 0;
    },

    /**
     * 是否正在加载任何内容
     */
    isLoading(): boolean {
      return Object.values(this.loading).some((v) => v);
    },

    /**
     * 格式化的统计信息
     */
    formattedStats(): FormattedStats {
      return {
        dailyNotes: `${this.stats.dailyNotesCount} 篇`,
        sections: `${this.stats.memorySectionsCount} 个章节`,
        embeddings: `${this.stats.cachedEmbeddingsCount} 条缓存`,
        indexed: `${this.stats.indexedFilesCount} 个文件`,
      };
    },
  },

  actions: {
    /**
     * 加载指定日期的 Daily Note
     */
    async loadDailyNote(date: string | null = null): Promise<void> {
      const targetDate = date || this.selectedDate;
      this.loading.dailyNotes = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:read-daily-note', {
          date: targetDate,
        });

        if (result?.success) {
          this.currentDailyNote = result.content as string;
          this.selectedDate = targetDate;
        } else {
          this.currentDailyNote = null;
        }
      } catch (error) {
        this.error = (error as Error).message;
        this.currentDailyNote = null;
      } finally {
        this.loading.dailyNotes = false;
      }
    },

    /**
     * 加载最近的 Daily Notes 列表
     */
    async loadRecentDailyNotes(limit: number = 7): Promise<void> {
      this.loading.dailyNotes = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:get-recent-daily-notes', {
          limit,
        });

        if (result?.success) {
          this.dailyNotes = result.notes || [];
        }
      } catch (error) {
        this.error = (error as Error).message;
      } finally {
        this.loading.dailyNotes = false;
      }
    },

    /**
     * 写入 Daily Note
     */
    async writeDailyNote(
      content: string,
      options: { append: boolean } = { append: true }
    ): Promise<boolean> {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:write-daily-note', {
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
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 加载 MEMORY.md 内容
     */
    async loadMemory(): Promise<void> {
      this.loading.memory = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:read-memory');

        if (result?.success) {
          this.memoryContent = (result.content as string) || '';
        }
      } catch (error) {
        this.error = (error as Error).message;
      } finally {
        this.loading.memory = false;
      }
    },

    /**
     * 追加内容到 MEMORY.md
     */
    async appendToMemory(content: string, section: string | null = null): Promise<boolean> {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:append-to-memory', {
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
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 执行混合搜索
     */
    async search(query: string | null = null, options: Partial<SearchOptions> = {}): Promise<void> {
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

        const result = await safeIpcInvoke('memory:search', {
          query: searchQuery,
          options: searchOptions,
        });

        if (result?.success) {
          this.searchResults = result.results || [];
          this.searchQuery = searchQuery;
        }
      } catch (error) {
        this.error = (error as Error).message;
        this.searchResults = [];
      } finally {
        this.loading.search = false;
      }
    },

    /**
     * 更新搜索权重
     */
    updateSearchWeights(vectorWeight: number, textWeight: number): void {
      this.searchOptions.vectorWeight = vectorWeight;
      this.searchOptions.textWeight = textWeight;
    },

    /**
     * 加载统计信息
     */
    async loadStats(): Promise<void> {
      this.loading.stats = true;

      try {
        const result = await safeIpcInvoke('memory:get-stats');

        if (result?.success) {
          this.stats = result.stats || this.stats;
        }
      } catch (error) {
        console.error('[MemoryStore] 加载统计失败:', error);
      } finally {
        this.loading.stats = false;
      }
    },

    /**
     * 加载索引统计
     */
    async loadIndexStats(): Promise<void> {
      try {
        const result = await safeIpcInvoke('memory:get-index-stats');

        if (result?.success) {
          this.indexStats = result.stats || this.indexStats;
        }
      } catch (error) {
        console.error('[MemoryStore] 加载索引统计失败:', error);
      }
    },

    /**
     * 重建索引
     */
    async rebuildIndex(): Promise<any | null> {
      this.loading.index = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:rebuild-index');

        if (result?.success) {
          // 重新加载统计
          await this.loadStats();
          await this.loadIndexStats();
          return result.result;
        }
        return null;
      } catch (error) {
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading.index = false;
      }
    },

    /**
     * 从会话提取记忆
     */
    async extractFromSession(sessionId: string): Promise<boolean> {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:extract-from-session', {
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
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 保存内容到永久记忆
     */
    async saveToMemory(
      content: string,
      type: 'daily' | 'discovery' | 'solution' | 'preference' = 'daily',
      section: string | null = null
    ): Promise<any | null> {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:save-to-memory', {
          content,
          type,
          section,
        });

        if (result?.success) {
          // 重新加载相关数据
          if (result.result.savedTo === 'daily_notes') {
            await this.loadDailyNote(this.today);
            await this.loadRecentDailyNotes();
          } else {
            await this.loadMemory();
          }
          return result.result;
        }
        return null;
      } catch (error) {
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 从对话中提取并保存记忆
     */
    async extractFromConversation(
      messages: Array<{ role: string; content: string }>,
      title: string = ''
    ): Promise<any | null> {
      this.loading.write = true;
      this.error = null;

      try {
        const result = await safeIpcInvoke('memory:extract-from-conversation', {
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
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading.write = false;
      }
    },

    /**
     * 获取 MEMORY.md 章节列表
     */
    async loadMemorySections(): Promise<MemorySection[]> {
      try {
        const result = await safeIpcInvoke('memory:get-memory-sections');

        if (result?.success) {
          this.memorySections = result.sections || [];
          return this.memorySections;
        }
        return [];
      } catch (error) {
        console.error('[MemoryStore] 加载章节列表失败:', error);
        return [];
      }
    },

    /**
     * 切换标签页
     */
    setActiveTab(tab: 'daily' | 'memory' | 'search'): void {
      this.activeTab = tab;
    },

    /**
     * 开始编辑
     */
    startEditing(): void {
      this.isEditing = true;
      this.editingContent =
        this.activeTab === 'memory' ? this.memoryContent : this.currentDailyNote || '';
    },

    /**
     * 取消编辑
     */
    cancelEditing(): void {
      this.isEditing = false;
      this.editingContent = '';
    },

    /**
     * 保存编辑
     */
    async saveEditing(): Promise<void> {
      if (this.activeTab === 'memory') {
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
     */
    async updateMemory(content: string): Promise<boolean> {
      this.loading.memory = true;
      try {
        const result = await (window as any).electron.ipcRenderer.invoke('memory:update-memory', {
          content,
        });
        if (result.success) {
          this.memoryContent = content;
          return true;
        } else {
          this.error = result.error || '更新失败';
          return false;
        }
      } catch (error) {
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading.memory = false;
      }
    },

    /**
     * 选择日期
     */
    selectDate(date: string): void {
      this.selectedDate = date;
      this.loadDailyNote(date);
    },

    /**
     * 清除搜索结果
     */
    clearSearch(): void {
      this.searchQuery = '';
      this.searchResults = [];
    },

    /**
     * 清除错误
     */
    clearError(): void {
      this.error = null;
    },

    /**
     * 初始化 store
     */
    async initialize(): Promise<void> {
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
