/**
 * LRU (Least Recently Used) Cache Implementation
 * 用于缓存文件元数据、文件类型检测结果等昂贵的计算
 */

export class LRUCache {
  /**
   * @param {number} capacity - 缓存容量（最大条目数）
   * @param {number} ttl - 缓存过期时间（毫秒），默认5分钟
   */
  constructor(capacity = 100, ttl = 5 * 60 * 1000) {
    this.capacity = capacity;
    this.ttl = ttl;
    this.cache = new Map();
    this.accessOrder = [];
  }

  /**
   * 获取缓存值
   * @param {string} key - 缓存键
   * @returns {any} 缓存值，如果不存在或已过期则返回 undefined
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const entry = this.cache.get(key);

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return undefined;
    }

    // 更新访问顺序（移到最前面）
    this._updateAccessOrder(key);

    return entry.value;
  }

  /**
   * 设置缓存值
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   */
  set(key, value) {
    // 如果已存在，先删除旧的
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // 如果达到容量上限，删除最久未使用的条目
    if (this.cache.size >= this.capacity) {
      const lruKey = this.accessOrder[0];
      this.delete(lruKey);
    }

    // 添加新条目
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });

    this.accessOrder.push(key);
  }

  /**
   * 删除缓存条目
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.cache.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * 获取缓存大小
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }

  /**
   * 检查键是否存在且未过期
   * @param {string} key - 缓存键
   * @returns {boolean}
   */
  has(key) {
    if (!this.cache.has(key)) {
      return false;
    }

    const entry = this.cache.get(key);
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 更新访问顺序
   * @private
   */
  _updateAccessOrder(key) {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      size: this.cache.size,
      capacity: this.capacity,
      usage: ((this.cache.size / this.capacity) * 100).toFixed(2) + '%',
      ttl: this.ttl,
    };
  }
}

/**
 * 文件元数据缓存管理器
 * 专门用于缓存文件类型检测、语法高亮配置等昂贵操作
 */
export class FileMetadataCache {
  constructor() {
    // 文件类型检测缓存（容量500，TTL 10分钟）
    this.typeCache = new LRUCache(500, 10 * 60 * 1000);

    // 文件统计信息缓存（容量200，TTL 5分钟）
    this.statsCache = new LRUCache(200, 5 * 60 * 1000);

    // 语法高亮配置缓存（容量100，TTL 15分钟）
    this.syntaxCache = new LRUCache(100, 15 * 60 * 1000);

    // OCR结果缓存（容量50，TTL 30分钟）
    this.ocrCache = new LRUCache(50, 30 * 60 * 1000);

    // 缓存命中统计
    this.stats = {
      typeHits: 0,
      typeMisses: 0,
      statsHits: 0,
      statsMisses: 0,
      syntaxHits: 0,
      syntaxMisses: 0,
      ocrHits: 0,
      ocrMisses: 0,
    };
  }

  /**
   * 获取文件类型信息
   * @param {string} filePath - 文件路径
   * @returns {Object|undefined}
   */
  getFileType(filePath) {
    const result = this.typeCache.get(filePath);
    if (result) {
      this.stats.typeHits++;
    } else {
      this.stats.typeMisses++;
    }
    return result;
  }

  /**
   * 设置文件类型信息
   * @param {string} filePath - 文件路径
   * @param {Object} typeInfo - 类型信息
   */
  setFileType(filePath, typeInfo) {
    this.typeCache.set(filePath, typeInfo);
  }

  /**
   * 获取文件统计信息
   * @param {string} filePath - 文件路径
   * @returns {Object|undefined}
   */
  getFileStats(filePath) {
    const result = this.statsCache.get(filePath);
    if (result) {
      this.stats.statsHits++;
    } else {
      this.stats.statsMisses++;
    }
    return result;
  }

  /**
   * 设置文件统计信息
   * @param {string} filePath - 文件路径
   * @param {Object} stats - 统计信息
   */
  setFileStats(filePath, stats) {
    this.statsCache.set(filePath, stats);
  }

  /**
   * 获取语法高亮配置
   * @param {string} language - 语言类型
   * @returns {Object|undefined}
   */
  getSyntaxConfig(language) {
    const result = this.syntaxCache.get(language);
    if (result) {
      this.stats.syntaxHits++;
    } else {
      this.stats.syntaxMisses++;
    }
    return result;
  }

  /**
   * 设置语法高亮配置
   * @param {string} language - 语言类型
   * @param {Object} config - 配置信息
   */
  setSyntaxConfig(language, config) {
    this.syntaxCache.set(language, config);
  }

  /**
   * 获取OCR结果
   * @param {string} imageHash - 图片哈希
   * @returns {string|undefined}
   */
  getOCRResult(imageHash) {
    const result = this.ocrCache.get(imageHash);
    if (result) {
      this.stats.ocrHits++;
    } else {
      this.stats.ocrMisses++;
    }
    return result;
  }

  /**
   * 设置OCR结果
   * @param {string} imageHash - 图片哈希
   * @param {string} text - OCR识别文本
   */
  setOCRResult(imageHash, text) {
    this.ocrCache.set(imageHash, text);
  }

  /**
   * 清空所有缓存
   */
  clearAll() {
    this.typeCache.clear();
    this.statsCache.clear();
    this.syntaxCache.clear();
    this.ocrCache.clear();
  }

  /**
   * 获取缓存统计信息
   * @returns {Object}
   */
  getStats() {
    const typeHitRate = this.stats.typeHits + this.stats.typeMisses > 0
      ? ((this.stats.typeHits / (this.stats.typeHits + this.stats.typeMisses)) * 100).toFixed(2)
      : 0;

    const statsHitRate = this.stats.statsHits + this.stats.statsMisses > 0
      ? ((this.stats.statsHits / (this.stats.statsHits + this.stats.statsMisses)) * 100).toFixed(2)
      : 0;

    const syntaxHitRate = this.stats.syntaxHits + this.stats.syntaxMisses > 0
      ? ((this.stats.syntaxHits / (this.stats.syntaxHits + this.stats.syntaxMisses)) * 100).toFixed(2)
      : 0;

    const ocrHitRate = this.stats.ocrHits + this.stats.ocrMisses > 0
      ? ((this.stats.ocrHits / (this.stats.ocrHits + this.stats.ocrMisses)) * 100).toFixed(2)
      : 0;

    return {
      type: {
        ...this.typeCache.getStats(),
        hits: this.stats.typeHits,
        misses: this.stats.typeMisses,
        hitRate: typeHitRate + '%',
      },
      stats: {
        ...this.statsCache.getStats(),
        hits: this.stats.statsHits,
        misses: this.stats.statsMisses,
        hitRate: statsHitRate + '%',
      },
      syntax: {
        ...this.syntaxCache.getStats(),
        hits: this.stats.syntaxHits,
        misses: this.stats.syntaxMisses,
        hitRate: syntaxHitRate + '%',
      },
      ocr: {
        ...this.ocrCache.getStats(),
        hits: this.stats.ocrHits,
        misses: this.stats.ocrMisses,
        hitRate: ocrHitRate + '%',
      },
    };
  }
}

// 导出单例实例
export const fileMetadataCache = new FileMetadataCache();
