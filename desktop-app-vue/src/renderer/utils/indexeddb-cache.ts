/**
 * IndexedDB Cache Manager
 * 用于缓存文件内容、解析结果等大数据，支持离线访问
 */

import { logger } from '@/utils/logger';

// ==================== 常量定义 ====================

const DB_NAME = 'ChainlessChainCache';
const DB_VERSION = 1;

/**
 * 存储对象名称
 */
export const STORES = {
  FILE_CONTENT: 'fileContent',
  FILE_METADATA: 'fileMetadata',
  PARSE_RESULTS: 'parseResults',
  SYNTAX_CACHE: 'syntaxCache',
  THUMBNAILS: 'thumbnails',
} as const;

export type StoreName = typeof STORES[keyof typeof STORES];

// ==================== 类型定义 ====================

/**
 * 文件内容数据
 */
export interface FileContentData {
  id: string;
  projectId: string;
  filePath: string;
  content: string;
  metadata: Record<string, any>;
  size: number;
  timestamp: number;
}

/**
 * 文件元数据
 */
export interface FileMetadataData {
  id: string;
  projectId: string;
  filePath: string;
  [key: string]: any;
}

/**
 * 解析结果数据
 */
export interface ParseResultData {
  id: string;
  fileId: string;
  fileType: string;
  result: any;
  timestamp: number;
}

/**
 * 语法高亮缓存数据
 */
export interface SyntaxCacheData {
  id: string;
  fileId: string;
  language: string;
  result: any;
  timestamp: number;
}

/**
 * 缩略图数据
 */
export interface ThumbnailData {
  id: string;
  fileId: string;
  data: string | Blob;
  timestamp: number;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  fileContents: {
    count: number;
    size: number;
    sizeFormatted: string;
  };
  parseResults: {
    count: number;
  };
  syntaxCache: {
    count: number;
  };
  maxCacheSize: number;
  maxCacheSizeFormatted: string;
  usage: string;
}

/**
 * IDB事务模式
 */
type IDBTransactionMode = 'readonly' | 'readwrite';

// ==================== IndexedDB 包装器类 ====================

/**
 * IndexedDB包装器
 */
class IndexedDBWrapper {
  private db: IDBDatabase | null = null;
  private initialized: boolean = false;
  private initPromise: Promise<IDBDatabase> | null = null;

  /**
   * 初始化数据库
   */
  async init(): Promise<IDBDatabase> {
    if (this.initialized && this.db) {
      return this.db;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error('IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        logger.info('IndexedDB initialized successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

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

        logger.info('IndexedDB schema upgraded to version', DB_VERSION);
      };
    });

    return this.initPromise;
  }

  /**
   * 获取对象存储
   */
  async getStore(storeName: StoreName, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    await this.init();
    const transaction = this.db!.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  /**
   * 添加或更新数据
   */
  async put<T>(storeName: StoreName, data: T): Promise<IDBValidKey> {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.put(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取数据
   */
  async get<T>(storeName: StoreName, key: string): Promise<T | undefined> {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除数据
   */
  async delete(storeName: StoreName, key: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 通过索引查询数据
   */
  async getByIndex<T>(storeName: StoreName, indexName: string, value: IDBValidKey): Promise<T[]> {
    const store = await this.getStore(storeName, 'readonly');
    const index = store.index(indexName);

    return new Promise((resolve, reject) => {
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 清空存储
   */
  async clear(storeName: StoreName): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');

    return new Promise((resolve, reject) => {
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取所有数据
   */
  async getAll<T>(storeName: StoreName): Promise<T[]> {
    const store = await this.getStore(storeName, 'readonly');

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }
}

// ==================== 文件缓存管理器类 ====================

/**
 * 文件缓存管理器
 */
export class FileCacheManager {
  private db: IndexedDBWrapper;
  private maxCacheSize: number;
  private maxCacheAge: number;

  constructor() {
    this.db = new IndexedDBWrapper();
    this.maxCacheSize = 100 * 1024 * 1024; // 100MB
    this.maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7天
  }

  /**
   * 生成缓存键
   */
  generateKey(projectId: string, filePath: string): string {
    return `${projectId}:${filePath}`;
  }

  /**
   * 缓存文件内容
   */
  async cacheFileContent(
    projectId: string,
    filePath: string,
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const id = this.generateKey(projectId, filePath);

    const data: FileContentData = {
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
      logger.info(`Cached file content: ${filePath} (${data.size} bytes)`);

      // 检查缓存大小
      await this.checkCacheSize();
    } catch (error) {
      logger.error('Failed to cache file content:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的文件内容
   */
  async getCachedFileContent(projectId: string, filePath: string): Promise<FileContentData | null> {
    const id = this.generateKey(projectId, filePath);

    try {
      const data = await this.db.get<FileContentData>(STORES.FILE_CONTENT, id);

      if (!data) {
        return null;
      }

      // 检查是否过期
      if (Date.now() - data.timestamp > this.maxCacheAge) {
        await this.db.delete(STORES.FILE_CONTENT, id);
        return null;
      }

      logger.info(`Cache hit: ${filePath}`);
      return data;
    } catch (error) {
      logger.error('Failed to get cached file content:', error);
      return null;
    }
  }

  /**
   * 缓存解析结果
   */
  async cacheParseResult(fileId: string, fileType: string, result: any): Promise<void> {
    const id = `${fileId}:${fileType}`;

    const data: ParseResultData = {
      id,
      fileId,
      fileType,
      result,
      timestamp: Date.now(),
    };

    try {
      await this.db.put(STORES.PARSE_RESULTS, data);
      logger.info(`Cached parse result: ${fileId} (${fileType})`);
    } catch (error) {
      logger.error('Failed to cache parse result:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的解析结果
   */
  async getCachedParseResult(fileId: string, fileType: string): Promise<any | null> {
    const id = `${fileId}:${fileType}`;

    try {
      const data = await this.db.get<ParseResultData>(STORES.PARSE_RESULTS, id);

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
      logger.error('Failed to get cached parse result:', error);
      return null;
    }
  }

  /**
   * 缓存语法高亮结果
   */
  async cacheSyntaxResult(fileId: string, language: string, result: any): Promise<void> {
    const id = `${fileId}:${language}`;

    const data: SyntaxCacheData = {
      id,
      fileId,
      language,
      result,
      timestamp: Date.now(),
    };

    try {
      await this.db.put(STORES.SYNTAX_CACHE, data);
      logger.info(`Cached syntax result: ${fileId} (${language})`);
    } catch (error) {
      logger.error('Failed to cache syntax result:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的语法高亮结果
   */
  async getCachedSyntaxResult(fileId: string, language: string): Promise<any | null> {
    const id = `${fileId}:${language}`;

    try {
      const data = await this.db.get<SyntaxCacheData>(STORES.SYNTAX_CACHE, id);

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
      logger.error('Failed to get cached syntax result:', error);
      return null;
    }
  }

  /**
   * 删除项目的所有缓存
   */
  async clearProjectCache(projectId: string): Promise<void> {
    try {
      const files = await this.db.getByIndex<FileContentData>(
        STORES.FILE_CONTENT,
        'projectId',
        projectId
      );

      for (const file of files) {
        await this.db.delete(STORES.FILE_CONTENT, file.id);
      }

      logger.info(`Cleared cache for project: ${projectId}`);
    } catch (error) {
      logger.error('Failed to clear project cache:', error);
      throw error;
    }
  }

  /**
   * 检查并清理缓存大小
   */
  async checkCacheSize(): Promise<void> {
    try {
      const allFiles = await this.db.getAll<FileContentData>(STORES.FILE_CONTENT);

      // 计算总大小
      const totalSize = allFiles.reduce((sum, file) => sum + (file.size || 0), 0);

      if (totalSize > this.maxCacheSize) {
        logger.info(`Cache size (${totalSize}) exceeds limit (${this.maxCacheSize}), cleaning...`);

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

        logger.info(`Cleaned ${index} old cache entries`);
      }
    } catch (error) {
      logger.error('Failed to check cache size:', error);
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<CacheStats | null> {
    try {
      const fileContents = await this.db.getAll<FileContentData>(STORES.FILE_CONTENT);
      const parseResults = await this.db.getAll<ParseResultData>(STORES.PARSE_RESULTS);
      const syntaxCache = await this.db.getAll<SyntaxCacheData>(STORES.SYNTAX_CACHE);

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
      logger.error('Failed to get cache stats:', error);
      return null;
    }
  }

  /**
   * 格式化大小
   */
  formatSize(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * 清空所有缓存
   */
  async clearAll(): Promise<void> {
    try {
      await this.db.clear(STORES.FILE_CONTENT);
      await this.db.clear(STORES.FILE_METADATA);
      await this.db.clear(STORES.PARSE_RESULTS);
      await this.db.clear(STORES.SYNTAX_CACHE);
      await this.db.clear(STORES.THUMBNAILS);

      logger.info('All caches cleared');
    } catch (error) {
      logger.error('Failed to clear all caches:', error);
      throw error;
    }
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}

// 导出单例实例
export const fileCacheManager = new FileCacheManager();
