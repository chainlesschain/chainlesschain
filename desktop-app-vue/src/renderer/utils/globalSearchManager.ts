/**
 * 全局搜索管理器
 * 提供跨模块的统一搜索功能
 */

import { logger } from '@/utils/logger';
import { ref, computed, type Ref, type ComputedRef } from 'vue';

// ==================== 类型定义 ====================

/**
 * 搜索类型枚举
 */
export const SearchType = {
  ALL: 'all',
  NOTES: 'notes',
  FILES: 'files',
  CHATS: 'chats',
  PROJECTS: 'projects',
  CONTACTS: 'contacts',
  COMMANDS: 'commands',
} as const;

export type SearchTypeValue = typeof SearchType[keyof typeof SearchType];

/**
 * 搜索结果选项
 */
export interface SearchResultOptions {
  id?: string;
  type?: SearchTypeValue;
  title?: string;
  description?: string;
  content?: string;
  path?: string | null;
  score?: number;
  metadata?: Record<string, any>;
  timestamp?: number;
  icon?: string | null;
  action?: (() => void) | null;
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  type?: SearchTypeValue;
  limit?: number;
  limitPerType?: number;
  rebuild?: boolean;
}

/**
 * 搜索历史项
 */
export interface SearchHistoryItem {
  query: string;
  timestamp: number;
}

/**
 * 搜索提供者函数
 */
export type SearchProvider = (query: string, options?: SearchOptions) => Promise<SearchResultOptions[]>;

/**
 * 搜索统计
 */
export type SearchStatistics = Record<SearchTypeValue, number>;

/**
 * useGlobalSearch 返回类型
 */
export interface UseGlobalSearchReturn {
  isSearching: ComputedRef<boolean>;
  searchHistory: ComputedRef<SearchHistoryItem[]>;
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  addToIndex: (type: SearchTypeValue, item: SearchResultOptions) => void;
  addBatchToIndex: (type: SearchTypeValue, items: SearchResultOptions[]) => void;
  removeFromIndex: (type: SearchTypeValue, itemId: string) => void;
  registerProvider: (type: SearchTypeValue, provider: SearchProvider) => void;
  clearHistory: () => void;
  getSuggestions: (query: string, limit?: number) => string[];
  getStatistics: () => SearchStatistics;
  rebuildIndex: (type: SearchTypeValue) => Promise<void>;
}

// ==================== 类实现 ====================

/**
 * 搜索结果类
 */
class SearchResult {
  id: string;
  type: SearchTypeValue;
  title: string;
  description: string;
  content: string;
  path: string | null;
  score: number;
  metadata: Record<string, any>;
  timestamp: number;
  icon: string | null;
  action: (() => void) | null;

  constructor(options: SearchResultOptions = {}) {
    this.id = options.id || `result-${Date.now()}-${Math.random()}`;
    this.type = options.type || SearchType.NOTES;
    this.title = options.title || '';
    this.description = options.description || '';
    this.content = options.content || '';
    this.path = options.path || null;
    this.score = options.score || 0;
    this.metadata = options.metadata || {};
    this.timestamp = options.timestamp || Date.now();
    this.icon = options.icon || null;
    this.action = options.action || null;
  }
}

/**
 * 搜索索引类
 */
class SearchIndex {
  private items: Map<string, SearchResult>;
  private invertedIndex: Map<string, Set<string>>;

  constructor() {
    this.items = new Map();
    this.invertedIndex = new Map();
  }

  /**
   * 添加项目到索引
   */
  add(item: SearchResult): void {
    this.items.set(item.id, item);

    const words = this.tokenize(item.title + ' ' + item.description + ' ' + item.content);
    words.forEach(word => {
      if (!this.invertedIndex.has(word)) {
        this.invertedIndex.set(word, new Set());
      }
      this.invertedIndex.get(word)!.add(item.id);
    });
  }

  /**
   * 从索引中移除项目
   */
  remove(itemId: string): void {
    const item = this.items.get(itemId);
    if (!item) return;

    const words = this.tokenize(item.title + ' ' + item.description + ' ' + item.content);
    words.forEach(word => {
      const ids = this.invertedIndex.get(word);
      if (ids) {
        ids.delete(itemId);
        if (ids.size === 0) {
          this.invertedIndex.delete(word);
        }
      }
    });

    this.items.delete(itemId);
  }

  /**
   * 搜索
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const words = this.tokenize(query);
    if (words.length === 0) return [];

    const candidateIds = new Set<string>();
    words.forEach(word => {
      const ids = this.invertedIndex.get(word);
      if (ids) {
        ids.forEach(id => candidateIds.add(id));
      }
    });

    const results: SearchResult[] = [];
    candidateIds.forEach(id => {
      const item = this.items.get(id);
      if (!item) return;

      if (options.type && item.type !== options.type) return;

      const score = this.calculateScore(item, words);
      if (score > 0) {
        results.push({
          ...item,
          score,
        });
      }
    });

    results.sort((a, b) => b.score - a.score);

    if (options.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * 分词
   */
  private tokenize(text: string): string[] {
    if (!text) return [];

    text = text.toLowerCase();
    text = text.replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');

    const words = text.split(/\s+/).filter(w => w.length > 0);

    return [...new Set(words)];
  }

  /**
   * 计算相关性分数
   */
  private calculateScore(item: SearchResult, queryWords: string[]): number {
    let score = 0;

    queryWords.forEach(word => {
      if (item.title.toLowerCase().includes(word)) {
        score += 10;
      }

      if (item.description.toLowerCase().includes(word)) {
        score += 5;
      }

      if (item.content.toLowerCase().includes(word)) {
        score += 1;
      }

      const text = (item.title + ' ' + item.description + ' ' + item.content).toLowerCase();
      if (text.includes(word)) {
        score += 2;
      }
    });

    return score;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.items.clear();
    this.invertedIndex.clear();
  }

  /**
   * 获取索引大小
   */
  size(): number {
    return this.items.size;
  }
}

/**
 * 全局搜索管理器
 */
class GlobalSearchManager {
  private indexes: Map<SearchTypeValue, SearchIndex>;
  searchHistory: Ref<SearchHistoryItem[]>;
  private maxHistorySize: number;
  isSearching: Ref<boolean>;
  private searchProviders: Map<SearchTypeValue, SearchProvider>;

  constructor() {
    this.indexes = new Map();
    this.searchHistory = ref([]);
    this.maxHistorySize = 50;
    this.isSearching = ref(false);
    this.searchProviders = new Map();

    Object.values(SearchType).forEach(type => {
      if (type !== SearchType.ALL) {
        this.indexes.set(type, new SearchIndex());
      }
    });

    this.loadHistory();
  }

  /**
   * 注册搜索提供者
   */
  registerProvider(type: SearchTypeValue, provider: SearchProvider): void {
    this.searchProviders.set(type, provider);
  }

  /**
   * 添加项目到索引
   */
  addToIndex(type: SearchTypeValue, item: SearchResultOptions): void {
    const index = this.indexes.get(type);
    if (index) {
      index.add(new SearchResult({ ...item, type }));
    }
  }

  /**
   * 批量添加项目到索引
   */
  addBatchToIndex(type: SearchTypeValue, items: SearchResultOptions[]): void {
    items.forEach(item => this.addToIndex(type, item));
  }

  /**
   * 从索引中移除项目
   */
  removeFromIndex(type: SearchTypeValue, itemId: string): void {
    const index = this.indexes.get(type);
    if (index) {
      index.remove(itemId);
    }
  }

  /**
   * 全局搜索
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    this.isSearching.value = true;

    try {
      const results: SearchResult[] = [];
      const searchType = options.type || SearchType.ALL;

      this.addToHistory(query);

      if (searchType === SearchType.ALL) {
        for (const [type, index] of this.indexes) {
          const typeResults = index.search(query, { limit: options.limitPerType || 10 });
          results.push(...typeResults);
        }

        for (const [type, provider] of this.searchProviders) {
          try {
            const providerResults = await provider(query, options);
            if (Array.isArray(providerResults)) {
              results.push(...providerResults.map(r => new SearchResult({ ...r, type })));
            }
          } catch (error) {
            logger.error(`[GlobalSearch] Provider error for ${type}:`, error);
          }
        }
      } else {
        const index = this.indexes.get(searchType);
        if (index) {
          const typeResults = index.search(query, options);
          results.push(...typeResults);
        }

        const provider = this.searchProviders.get(searchType);
        if (provider) {
          try {
            const providerResults = await provider(query, options);
            if (Array.isArray(providerResults)) {
              results.push(...providerResults.map(r => new SearchResult({ ...r, type: searchType })));
            }
          } catch (error) {
            logger.error(`[GlobalSearch] Provider error for ${searchType}:`, error);
          }
        }
      }

      results.sort((a, b) => b.score - a.score);

      const limit = options.limit || 50;
      return results.slice(0, limit);
    } finally {
      this.isSearching.value = false;
    }
  }

  /**
   * 添加到搜索历史
   */
  private addToHistory(query: string): void {
    this.searchHistory.value = this.searchHistory.value.filter(h => h.query !== query);

    this.searchHistory.value.unshift({
      query,
      timestamp: Date.now(),
    });

    if (this.searchHistory.value.length > this.maxHistorySize) {
      this.searchHistory.value = this.searchHistory.value.slice(0, this.maxHistorySize);
    }

    this.saveHistory();
  }

  /**
   * 清空搜索历史
   */
  clearHistory(): void {
    this.searchHistory.value = [];
    this.saveHistory();
  }

  /**
   * 获取搜索建议
   */
  getSuggestions(query: string, limit: number = 5): string[] {
    if (!query) return [];

    const lowerQuery = query.toLowerCase();
    return this.searchHistory.value
      .filter(h => h.query.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(h => h.query);
  }

  /**
   * 获取索引统计
   */
  getStatistics(): SearchStatistics {
    const stats: Partial<SearchStatistics> = {};
    for (const [type, index] of this.indexes) {
      stats[type] = index.size();
    }
    return stats as SearchStatistics;
  }

  /**
   * 重建索引
   */
  async rebuildIndex(type: SearchTypeValue): Promise<void> {
    const index = this.indexes.get(type);
    if (!index) return;

    index.clear();

    const provider = this.searchProviders.get(type);
    if (provider) {
      try {
        const items = await provider('', { rebuild: true });
        if (Array.isArray(items)) {
          items.forEach(item => index.add(new SearchResult({ ...item, type })));
        }
      } catch (error) {
        logger.error(`[GlobalSearch] Rebuild index error for ${type}:`, error);
      }
    }
  }

  /**
   * 保存搜索历史
   */
  private saveHistory(): void {
    try {
      localStorage.setItem('search-history', JSON.stringify(this.searchHistory.value));
    } catch (error) {
      logger.error('[GlobalSearch] Save history error:', error);
    }
  }

  /**
   * 加载搜索历史
   */
  private loadHistory(): void {
    try {
      const stored = localStorage.getItem('search-history');
      if (stored) {
        this.searchHistory.value = JSON.parse(stored);
      }
    } catch (error) {
      logger.error('[GlobalSearch] Load history error:', error);
    }
  }
}

// 创建全局实例
const globalSearchManager = new GlobalSearchManager();

/**
 * 组合式函数：使用全局搜索
 */
export function useGlobalSearch(): UseGlobalSearchReturn {
  return {
    isSearching: computed(() => globalSearchManager.isSearching.value),
    searchHistory: computed(() => globalSearchManager.searchHistory.value),
    search: (query: string, options?: SearchOptions) => globalSearchManager.search(query, options),
    addToIndex: (type: SearchTypeValue, item: SearchResultOptions) => globalSearchManager.addToIndex(type, item),
    addBatchToIndex: (type: SearchTypeValue, items: SearchResultOptions[]) => globalSearchManager.addBatchToIndex(type, items),
    removeFromIndex: (type: SearchTypeValue, itemId: string) => globalSearchManager.removeFromIndex(type, itemId),
    registerProvider: (type: SearchTypeValue, provider: SearchProvider) => globalSearchManager.registerProvider(type, provider),
    clearHistory: () => globalSearchManager.clearHistory(),
    getSuggestions: (query: string, limit?: number) => globalSearchManager.getSuggestions(query, limit),
    getStatistics: () => globalSearchManager.getStatistics(),
    rebuildIndex: (type: SearchTypeValue) => globalSearchManager.rebuildIndex(type),
  };
}

export default globalSearchManager;
