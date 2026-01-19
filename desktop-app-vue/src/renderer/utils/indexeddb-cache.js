/**
 * IndexedDB Cache Manager
 * 用于缓存文件内容、解析结果等大数据，支持离线访问
 */

const DB_NAME = 'ChainlessChainCache';
const DB_VERSION = 1;

// 存储对象名称
const STORES = {
  FILE_CONTENT: 'fileContent',
  FILE_METADATA: 'fileMetadata',
  PARSE_RESULTS: 'parseResults',
  SYNTAX_CACHE: 'syntaxCache',
  THUMBNAILS: 'thumbnails',
};

/**
 * IndexedDB包装器
 */
class IndexedDBWrapper {
  constructor() {
    this.db = null;
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * 初始化数据库
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.initialized && this.db) {
      return this.db;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        console.log('IndexedDB initialized successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 创建文件内容存储
        if (!db.objectStoreNames.contains(STORES.FILE_CONTENT)) {
          const fileContentStore = db.createObjectStore(STORES.FILE_CONTENT, {
            keyPath: 'id',
          });
          fileContentStore.createIndex('projectId', 'projectId', { unique: false });
          fileContentStore.createIndex('filePath', 'filePath', { unique: false });
          fileContentStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 创建文件元数据存储
        if (!db.objectStoreNames.contains(STORES.FILE_METADATA)) {
          const metadataStore = db.createObjectStore(STORES.FILE_METADATA, {
            keyPath: 'id',
          });
          metadataStore.createIndex('projectId', 'projectId', { unique: false });
          metadataStore.createIndex('filePath', 'filePath', { unique: false });
        }

        // 创建解析结果存储
        if (!db.objectStoreNames.contains(STORES.PARSE_RESULTS)) {
          const parseStore = db.createObjectStore(STORES.PARSE_RESULTS, {
            keyPath: 'id',
          });
          parseStore.createIndex('fileId', 'fileId', { unique: false });
          parseStore.createIndex('fileType', 'fileType', { unique: false });
        }

        // 创建语法高亮缓存存储
        if (!db.objectStoreNames.contains(STORES.SYNTAX_CACHE)) {
          const syntaxStore = db.createObjectStore(STORES.SYNTAX_CACHE, {
            keyPath: 'id',
          });
          syntaxStore.createIndex('fileId', 'fileId', { unique: false });
          syntaxStore.createIndex('language', 'language', { unique: false });
        }

        // 创建缩略图存储
        if (!db.objectStoreNames.contains(STORES.THUMBNAILS)) {
          const thumbnailStore = db.createObjectStore(STORES.THUMBNAILS, {
            keyPath: 'id',
          });
          thumbnailStore.createIndex('fileId', 'fileId', { unique: false });
        }

        console.log('IndexedDB schema upgraded to version', DB_VERSION);
      };
    });

    return this.initPromise;
  }

  /**
   * 获取对象存储
   * @param {string} storeName - 存储名称
   * @param {string} mode - 访问模式 ('readonly' | 'readwrite')
   * @returns {Promise<IDBObjectStore>}
   */
  async getStore(storeName, mode = 'readonly') {
    await this.init();
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  /**
   * 添加或更新数据
   * @param {string} storeName - 存储名称
   * @param {Object} data - 数据对象
   * @returns {Promise<any>}
   */
  async put(storeName, data) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.put(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取数据
   * @param {string} storeName - 存储名称
   * @param {string} key - 键
   * @returns {Promise<any>}
   */
  async get(storeName, key) {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除数据
   * @param {string} storeName - 存储名称
   * @param {string} key - 键
   * @returns {Promise<void>}
   */
  async delete(storeName, key) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 通过索引查询数据
   * @param {string} storeName - 存储名称
   * @param {string} indexName - 索引名称
   * @param {any} value - 索引值
   * @returns {Promise<Array>}
   */
  async getByIndex(storeName, indexName, value) {
    const store = await this.getStore(storeName, 'readonly');
    const index = store.index(indexName);

    return new Promise((resolve, reject) => {
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 清空存储
   * @param {string} storeName - 存储名称
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取所有数据
   * @param {string} storeName - 存储名称
   * @returns {Promise<Array>}
   */
  async getAll(storeName) {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 关闭数据库
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }
}

/**
 * 文件缓存管理器
 */
export class FileCacheManager {
  constructor() {
    this.db = new IndexedDBWrapper();
    this.maxCacheSize = 100 * 1024 * 1024; // 100MB
    this.maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7天
  }

  /**
   * 生成缓存键
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @returns {string}
   */
  generateKey(projectId, filePath) {
    return `${projectId}:${filePath}`;
  }

  /**
   * 缓存文件内容
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @param {Object} metadata - 元数据
   * @returns {Promise<void>}
   */
  async cacheFileContent(projectId, filePath, content, metadata = {}) {
    const id = this.generateKey(projectId, filePath);

    const data = {
      id,
      projectId,
      filePath,
      content,
      metadata,
      size: content.length,
      timestamp: Date.now(),
    };

    try {
      await this.db.put(STORES.FILE_CONTENT, data);
      console.log(`Cached file content: ${filePath} (${data.size} bytes)`);

      // 检查缓存大小
      await this.checkCacheSize();
    } catch (error) {
      console.error('Failed to cache file content:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的文件内容
   * @param {string} projectId - 项目ID
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object|null>}
   */
  async getCachedFileContent(projectId, filePath) {
    const id = this.generateKey(projectId, filePath);

    try {
      const data = await this.db.get(STORES.FILE_CONTENT, id);

      if (!data) {
        return null;
      }

      // 检查是否过期
      if (Date.now() - data.timestamp > this.maxCacheAge) {
        await this.db.delete(STORES.FILE_CONTENT, id);
        return null;
      }

      console.log(`Cache hit: ${filePath}`);
      return data;
    } catch (error) {
      console.error('Failed to get cached file content:', error);
      return null;
    }
  }

  /**
   * 缓存解析结果
   * @param {string} fileId - 文件ID
   * @param {string} fileType - 文件类型
   * @param {Object} result - 解析结果
   * @returns {Promise<void>}
   */
  async cacheParseResult(fileId, fileType, result) {
    const id = `${fileId}:${fileType}`;

    const data = {
      id,
      fileId,
      fileType,
      result,
      timestamp: Date.now(),
    };

    try {
      await this.db.put(STORES.PARSE_RESULTS, data);
      console.log(`Cached parse result: ${fileId} (${fileType})`);
    } catch (error) {
      console.error('Failed to cache parse result:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的解析结果
   * @param {string} fileId - 文件ID
   * @param {string} fileType - 文件类型
   * @returns {Promise<Object|null>}
   */
  async getCachedParseResult(fileId, fileType) {
    const id = `${fileId}:${fileType}`;

    try {
      const data = await this.db.get(STORES.PARSE_RESULTS, id);

      if (!data) {
        return null;
      }

      // 检查是否过期
      if (Date.now() - data.timestamp > this.maxCacheAge) {
        await this.db.delete(STORES.PARSE_RESULTS, id);
        return null;
      }

      return data.result;
    } catch (error) {
      console.error('Failed to get cached parse result:', error);
      return null;
    }
  }

  /**
   * 缓存语法高亮结果
   * @param {string} fileId - 文件ID
   * @param {string} language - 语言类型
   * @param {Object} result - 高亮结果
   * @returns {Promise<void>}
   */
  async cacheSyntaxResult(fileId, language, result) {
    const id = `${fileId}:${language}`;

    const data = {
      id,
      fileId,
      language,
      result,
      timestamp: Date.now(),
    };

    try {
      await this.db.put(STORES.SYNTAX_CACHE, data);
      console.log(`Cached syntax result: ${fileId} (${language})`);
    } catch (error) {
      console.error('Failed to cache syntax result:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的语法高亮结果
   * @param {string} fileId - 文件ID
   * @param {string} language - 语言类型
   * @returns {Promise<Object|null>}
   */
  async getCachedSyntaxResult(fileId, language) {
    const id = `${fileId}:${language}`;

    try {
      const data = await this.db.get(STORES.SYNTAX_CACHE, id);

      if (!data) {
        return null;
      }

      // 检查是否过期
      if (Date.now() - data.timestamp > this.maxCacheAge) {
        await this.db.delete(STORES.SYNTAX_CACHE, id);
        return null;
      }

      return data.result;
    } catch (error) {
      console.error('Failed to get cached syntax result:', error);
      return null;
    }
  }

  /**
   * 删除项目的所有缓存
   * @param {string} projectId - 项目ID
   * @returns {Promise<void>}
   */
  async clearProjectCache(projectId) {
    try {
      const files = await this.db.getByIndex(STORES.FILE_CONTENT, 'projectId', projectId);

      for (const file of files) {
        await this.db.delete(STORES.FILE_CONTENT, file.id);
      }

      console.log(`Cleared cache for project: ${projectId}`);
    } catch (error) {
      console.error('Failed to clear project cache:', error);
      throw error;
    }
  }

  /**
   * 检查并清理缓存大小
   * @returns {Promise<void>}
   */
  async checkCacheSize() {
    try {
      const allFiles = await this.db.getAll(STORES.FILE_CONTENT);

      // 计算总大小
      const totalSize = allFiles.reduce((sum, file) => sum + (file.size || 0), 0);

      if (totalSize > this.maxCacheSize) {
        console.log(`Cache size (${totalSize}) exceeds limit (${this.maxCacheSize}), cleaning...`);

        // 按时间戳排序，删除最旧的
        allFiles.sort((a, b) => a.timestamp - b.timestamp);

        let currentSize = totalSize;
        let index = 0;

        while (currentSize > this.maxCacheSize * 0.8 && index < allFiles.length) {
          const file = allFiles[index];
          await this.db.delete(STORES.FILE_CONTENT, file.id);
          currentSize -= file.size || 0;
          index++;
        }

        console.log(`Cleaned ${index} old cache entries`);
      }
    } catch (error) {
      console.error('Failed to check cache size:', error);
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const fileContents = await this.db.getAll(STORES.FILE_CONTENT);
      const parseResults = await this.db.getAll(STORES.PARSE_RESULTS);
      const syntaxCache = await this.db.getAll(STORES.SYNTAX_CACHE);

      const totalSize = fileContents.reduce((sum, file) => sum + (file.size || 0), 0);

      return {
        fileContents: {
          count: fileContents.length,
          size: totalSize,
          sizeFormatted: this.formatSize(totalSize),
        },
        parseResults: {
          count: parseResults.length,
        },
        syntaxCache: {
          count: syntaxCache.length,
        },
        maxCacheSize: this.maxCacheSize,
        maxCacheSizeFormatted: this.formatSize(this.maxCacheSize),
        usage: ((totalSize / this.maxCacheSize) * 100).toFixed(2) + '%',
      };
    } catch (error) {
      console.error('Failed to get cache stats:', error);
      return null;
    }
  }

  /**
   * 格式化大小
   * @param {number} bytes - 字节数
   * @returns {string}
   */
  formatSize(bytes) {
    if (bytes === 0) {return '0 B';}

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * 清空所有缓存
   * @returns {Promise<void>}
   */
  async clearAll() {
    try {
      await this.db.clear(STORES.FILE_CONTENT);
      await this.db.clear(STORES.FILE_METADATA);
      await this.db.clear(STORES.PARSE_RESULTS);
      await this.db.clear(STORES.SYNTAX_CACHE);
      await this.db.clear(STORES.THUMBNAILS);

      console.log('All caches cleared');
    } catch (error) {
      console.error('Failed to clear all caches:', error);
      throw error;
    }
  }

  /**
   * 关闭数据库
   */
  close() {
    this.db.close();
  }
}

// 导出单例实例
export const fileCacheManager = new FileCacheManager();
