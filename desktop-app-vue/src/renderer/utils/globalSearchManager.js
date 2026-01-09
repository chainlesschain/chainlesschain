/**
 * 全局搜索管理器
 * 提供跨模块的统一搜索功能
 */

import { ref, computed } from 'vue';

/**
 * 搜索类型
 */
export const SearchType = {
  ALL: 'all',
  NOTES: 'notes',
  FILES: 'files',
  CHATS: 'chats',
  PROJECTS: 'projects',
  CONTACTS: 'contacts',
  COMMANDS: 'commands',
};

/**
 * 搜索结果类
 */
class SearchResult {
  constructor(options = {}) {
    this.id = options.id || `result-${Date.now()}-${Math.random()}`;
    this.type = options.type || SearchType.NOTES;
    this.title = options.title || '';
    this.description = options.description || '';
    this.content = options.content || '';
    this.path = options.path || null;
    this.score = options.score || 0; // 相关性分数
    this.metadata = options.metadata || {};
    this.timestamp = options.timestamp || Date.now();
    this.icon = options.icon || null;
    this.action = options.action || null; // 点击后的操作
  }
}

/**
 * 搜索索引类
 */
class SearchIndex {
  constructor() {
    this.items = new Map(); // id -> item
    this.invertedIndex = new Map(); // word -> Set(ids)
  }

  /**
   * 添加项目到索引
   */
  add(item) {
    this.items.set(item.id, item);

    // 分词并建立倒排索引
    const words = this.tokenize(item.title + ' ' + item.description + ' ' + item.content);
    words.forEach(word => {
      if (!this.invertedIndex.has(word)) {
        this.invertedIndex.set(word, new Set());
      }
      this.invertedIndex.get(word).add(item.id);
    });
  }

  /**
   * 从索引中移除项目
   */
  remove(itemId) {
    const item = this.items.get(itemId);
    if (!item) return;

    // 从倒排索引中移除
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
  search(query, options = {}) {
    const words = this.tokenize(query);
    if (words.length === 0) return [];

    // 找到包含任意关键词的文档
    const candidateIds = new Set();
    words.forEach(word => {
      const ids = this.invertedIndex.get(word);
      if (ids) {
        ids.forEach(id => candidateIds.add(id));
      }
    });

    // 计算相关性分数
    const results = [];
    candidateIds.forEach(id => {
      const item = this.items.get(id);
      if (!item) return;

      // 类型过滤
      if (options.type && item.type !== options.type) return;

      const score = this.calculateScore(item, words);
      if (score > 0) {
        results.push({
          ...item,
          score,
        });
      }
    });

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    // 限制结果数量
    if (options.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * 分词
   */
  tokenize(text) {
    if (!text) return [];

    // 转小写
    text = text.toLowerCase();

    // 移除标点符号
    text = text.replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');

    // 分词
    const words = text.split(/\s+/).filter(w => w.length > 0);

    // 去重
    return [...new Set(words)];
  }

  /**
   * 计算相关性分数
   */
  calculateScore(item, queryWords) {
    let score = 0;
    const text = (item.title + ' ' + item.description + ' ' + item.content).toLowerCase();

    queryWords.forEach(word => {
      // 标题匹配权重更高
      if (item.title.toLowerCase().includes(word)) {
        score += 10;
      }

      // 描述匹配
      if (item.description.toLowerCase().includes(word)) {
        score += 5;
      }

      // 内容匹配
      if (item.content.toLowerCase().includes(word)) {
        score += 1;
      }

      // 完全匹配加分
      if (text.includes(word)) {
        score += 2;
      }
    });

    return score;
  }

  /**
   * 清空索引
   */
  clear() {
    this.items.clear();
    this.invertedIndex.clear();
  }

  /**
   * 获取索引大小
   */
  size() {
    return this.items.size;
  }
}

/**
 * 全局搜索管理器
 */
class GlobalSearchManager {
  constructor() {
    this.indexes = new Map(); // type -> SearchIndex
    this.searchHistory = ref([]);
    this.maxHistorySize = 50;
    this.isSearching = ref(false);
    this.searchProviders = new Map(); // type -> provider function

    // 初始化各类型索引
    Object.values(SearchType).forEach(type => {
      if (type !== SearchType.ALL) {
        this.indexes.set(type, new SearchIndex());
      }
    });

    // 从本地存储加载搜索历史
    this.loadHistory();
  }

  /**
   * 注册搜索提供者
   */
  registerProvider(type, provider) {
    this.searchProviders.set(type, provider);
  }

  /**
   * 添加项目到索引
   */
  addToIndex(type, item) {
    const index = this.indexes.get(type);
    if (index) {
      index.add(new SearchResult({ ...item, type }));
    }
  }

  /**
   * 批量添加项目到索引
   */
  addBatchToIndex(type, items) {
    items.forEach(item => this.addToIndex(type, item));
  }

  /**
   * 从索引中移除项目
   */
  removeFromIndex(type, itemId) {
    const index = this.indexes.get(type);
    if (index) {
      index.remove(itemId);
    }
  }

  /**
   * 全局搜索
   */
  async search(query, options = {}) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    this.isSearching.value = true;

    try {
      const results = [];
      const searchType = options.type || SearchType.ALL;

      // 添加到搜索历史
      this.addToHistory(query);

      if (searchType === SearchType.ALL) {
        // 搜索所有类型
        for (const [type, index] of this.indexes) {
          const typeResults = index.search(query, { limit: options.limitPerType || 10 });
          results.push(...typeResults);
        }

        // 调用所有搜索提供者
        for (const [type, provider] of this.searchProviders) {
          try {
            const providerResults = await provider(query, options);
            if (Array.isArray(providerResults)) {
              results.push(...providerResults.map(r => new SearchResult({ ...r, type })));
            }
          } catch (error) {
            console.error(`[GlobalSearch] Provider error for ${type}:`, error);
          }
        }
      } else {
        // 搜索特定类型
        const index = this.indexes.get(searchType);
        if (index) {
          const typeResults = index.search(query, options);
          results.push(...typeResults);
        }

        // 调用特定类型的搜索提供者
        const provider = this.searchProviders.get(searchType);
        if (provider) {
          try {
            const providerResults = await provider(query, options);
            if (Array.isArray(providerResults)) {
              results.push(...providerResults.map(r => new SearchResult({ ...r, type: searchType })));
            }
          } catch (error) {
            console.error(`[GlobalSearch] Provider error for ${searchType}:`, error);
          }
        }
      }

      // 按分数排序
      results.sort((a, b) => b.score - a.score);

      // 限制总结果数量
      const limit = options.limit || 50;
      return results.slice(0, limit);
    } finally {
      this.isSearching.value = false;
    }
  }

  /**
   * 添加到搜索历史
   */
  addToHistory(query) {
    // 移除已存在的相同查询
    this.searchHistory.value = this.searchHistory.value.filter(h => h.query !== query);

    // 添加到开头
    this.searchHistory.value.unshift({
      query,
      timestamp: Date.now(),
    });

    // 限制历史大小
    if (this.searchHistory.value.length > this.maxHistorySize) {
      this.searchHistory.value = this.searchHistory.value.slice(0, this.maxHistorySize);
    }

    // 保存到本地存储
    this.saveHistory();
  }

  /**
   * 清空搜索历史
   */
  clearHistory() {
    this.searchHistory.value = [];
    this.saveHistory();
  }

  /**
   * 获取搜索建议
   */
  getSuggestions(query, limit = 5) {
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
  getStatistics() {
    const stats = {};
    for (const [type, index] of this.indexes) {
      stats[type] = index.size();
    }
    return stats;
  }

  /**
   * 重建索引
   */
  async rebuildIndex(type) {
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
        console.error(`[GlobalSearch] Rebuild index error for ${type}:`, error);
      }
    }
  }

  /**
   * 保存搜索历史
   */
  saveHistory() {
    try {
      localStorage.setItem('search-history', JSON.stringify(this.searchHistory.value));
    } catch (error) {
      console.error('[GlobalSearch] Save history error:', error);
    }
  }

  /**
   * 加载搜索历史
   */
  loadHistory() {
    try {
      const stored = localStorage.getItem('search-history');
      if (stored) {
        this.searchHistory.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error('[GlobalSearch] Load history error:', error);
    }
  }
}

// 创建全局实例
const globalSearchManager = new GlobalSearchManager();

/**
 * 组合式函数：使用全局搜索
 */
export function useGlobalSearch() {
  return {
    isSearching: computed(() => globalSearchManager.isSearching.value),
    searchHistory: computed(() => globalSearchManager.searchHistory.value),
    search: (query, options) => globalSearchManager.search(query, options),
    addToIndex: (type, item) => globalSearchManager.addToIndex(type, item),
    addBatchToIndex: (type, items) => globalSearchManager.addBatchToIndex(type, items),
    removeFromIndex: (type, itemId) => globalSearchManager.removeFromIndex(type, itemId),
    registerProvider: (type, provider) => globalSearchManager.registerProvider(type, provider),
    clearHistory: () => globalSearchManager.clearHistory(),
    getSuggestions: (query, limit) => globalSearchManager.getSuggestions(query, limit),
    getStatistics: () => globalSearchManager.getStatistics(),
    rebuildIndex: (type) => globalSearchManager.rebuildIndex(type),
  };
}

export default globalSearchManager;
