/**
 * 音频转录缓存管理器
 *
 * 避免重复转录相同的音频文件
 * 使用MD5哈希作为缓存键
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class AudioCache {
  constructor(cacheDir, options = {}) {
    this.cacheDir = cacheDir || path.join(process.cwd(), '.cache', 'audio-transcripts');
    this.maxCacheSize = options.maxCacheSize || 100 * 1024 * 1024; // 100MB磁盘缓存
    this.maxCacheAge = options.maxCacheAge || 30 * 24 * 60 * 60 * 1000; // 30天

    // 内存缓存配置
    this.memoryCache = new Map();
    this.maxMemoryEntries = options.maxMemoryEntries || 50; // 最大条目数
    this.maxMemorySize = options.maxMemorySize || 50 * 1024 * 1024; // 50MB内存限制
    this.currentMemorySize = 0; // 当前内存使用量

    // 异步写入队列
    this.writeQueue = [];
    this.isWriting = false;
  }

  /**
   * 初始化缓存目录
   */
  async initialize() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      console.log('[AudioCache] 缓存目录初始化:', this.cacheDir);

      // 清理过期缓存
      await this.cleanup();
    } catch (error) {
      console.error('[AudioCache] 初始化失败:', error);
    }
  }

  /**
   * 计算文件MD5哈希（流式处理，降低内存占用）
   * @param {string|Buffer} input - 文件路径或Buffer
   * @returns {Promise<string>} MD5哈希
   */
  async calculateHash(input) {
    const hash = crypto.createHash('md5');

    if (Buffer.isBuffer(input)) {
      hash.update(input);
    } else if (typeof input === 'string') {
      // 使用流式读取，避免大文件全量加载到内存
      const stream = require('fs').createReadStream(input, {
        highWaterMark: 1024 * 1024 // 1MB chunks
      });

      for await (const chunk of stream) {
        hash.update(chunk);
      }
    } else {
      throw new Error('输入必须是文件路径或Buffer');
    }

    return hash.digest('hex');
  }

  /**
   * 生成增强缓存键（包含转录参数）
   * 修复：相同文件不同引擎/语言会误命中
   * @param {string|Buffer} input - 文件路径或Buffer
   * @param {Object} params - 转录参数
   * @param {string} params.engine - 转录引擎 (whisper, azure, etc.)
   * @param {string} params.language - 语言代码
   * @param {string} params.model - 模型名称
   * @returns {Promise<string>} 增强缓存键
   */
  async generateCacheKey(input, params = {}) {
    const fileHash = await this.calculateHash(input);

    // 生成参数哈希
    const paramStr = JSON.stringify({
      engine: params.engine || 'default',
      language: params.language || 'auto',
      model: params.model || 'base'
    });

    const paramHash = crypto.createHash('md5')
      .update(paramStr)
      .digest('hex')
      .slice(0, 8); // 取前8位

    // 格式: 文件哈希_参数哈希
    return `${fileHash}_${paramHash}`;
  }

  /**
   * 检查缓存是否存在
   * @param {string} hash - 文件哈希
   * @returns {Promise<boolean>}
   */
  async has(hash) {
    // 检查内存缓存
    if (this.memoryCache.has(hash)) {
      return true;
    }

    // 检查磁盘缓存
    const cachePath = this.getCachePath(hash);
    try {
      await fs.access(cachePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取缓存（支持新缓存键格式，向后兼容旧格式）
   * @param {string} hash - 文件哈希或缓存键
   * @param {Object} params - 转录参数（可选，用于生成新格式缓存键）
   * @returns {Promise<Object|null>} 缓存的转录结果
   */
  async get(hash, params = null) {
    // 如果提供了params，使用新格式缓存键
    let cacheKey = hash;
    if (params && hash.indexOf('_') === -1) {
      // 旧格式哈希，尝试升级到新格式
      try {
        cacheKey = await this.generateCacheKey(hash, params);
      } catch (error) {
        // 生成新键失败，使用原始哈希
        console.warn('[AudioCache] 生成缓存键失败，使用原始哈希:', error.message);
      }
    }

    // 先检查内存缓存（新格式）
    if (this.memoryCache.has(cacheKey)) {
      const entry = this.memoryCache.get(cacheKey);

      // 更新访问时间
      entry.lastAccessed = Date.now();

      console.log('[AudioCache] 内存缓存命中 (新格式):', cacheKey);
      return entry.data;
    }

    // 检查磁盘缓存（新格式）
    let cachePath = this.getCachePath(cacheKey);
    let foundInDisk = false;
    let cacheEntry = null;

    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      cacheEntry = JSON.parse(data);
      foundInDisk = true;
      console.log('[AudioCache] 磁盘缓存命中 (新格式):', cacheKey);
    } catch (error) {
      // 新格式未找到，尝试旧格式（向后兼容）
      if (error.code === 'ENOENT' && cacheKey !== hash) {
        try {
          cachePath = this.getCachePath(hash);
          const data = await fs.readFile(cachePath, 'utf-8');
          cacheEntry = JSON.parse(data);
          foundInDisk = true;
          console.log('[AudioCache] 磁盘缓存命中 (旧格式，自动迁移):', hash);

          // 自动迁移到新格式
          if (params) {
            await this.set(hash, cacheEntry.result, params);
          }
        } catch (oldError) {
          if (oldError.code !== 'ENOENT') {
            console.error('[AudioCache] 读取旧格式缓存失败:', oldError);
          }
          return null;
        }
      } else if (error.code !== 'ENOENT') {
        console.error('[AudioCache] 读取缓存失败:', error);
        return null;
      } else {
        return null;
      }
    }

    if (foundInDisk && cacheEntry) {
      // 检查是否过期
      if (Date.now() - cacheEntry.timestamp > this.maxCacheAge) {
        console.log('[AudioCache] 缓存已过期:', cacheKey);
        await fs.unlink(cachePath);
        return null;
      }

      // 计算缓存大小
      const entrySize = JSON.stringify(cacheEntry.result).length;

      // 加载到内存缓存
      this.memoryCache.set(cacheKey, {
        data: cacheEntry.result,
        timestamp: cacheEntry.timestamp,
        lastAccessed: Date.now(),
        size: entrySize
      });

      // 更新当前内存使用量
      this.currentMemorySize += entrySize;

      // 限制内存缓存大小（按条目数和总大小）
      this.evictMemoryCache();
      this.evictMemoryCacheBySize();

      return cacheEntry.result;
    }

    return null;
  }

  /**
   * 保存缓存（使用异步写入队列）
   * @param {string} hash - 文件哈希或文件路径
   * @param {Object} result - 转录结果
   * @param {Object} params - 转录参数（可选，用于生成新格式缓存键）
   * @returns {Promise<void>}
   */
  async set(hash, result, params = null) {
    // 生成缓存键
    let cacheKey = hash;
    if (params) {
      try {
        cacheKey = await this.generateCacheKey(hash, params);
      } catch (error) {
        console.warn('[AudioCache] 生成缓存键失败，使用原始哈希:', error.message);
      }
    }

    const cacheEntry = {
      hash: cacheKey,
      result: result,
      timestamp: Date.now()
    };

    // 计算缓存大小
    const entrySize = JSON.stringify(result).length;

    // 保存到内存缓存
    this.memoryCache.set(cacheKey, {
      data: result,
      timestamp: cacheEntry.timestamp,
      lastAccessed: Date.now(),
      size: entrySize
    });

    // 更新当前内存使用量
    this.currentMemorySize += entrySize;

    // 限制内存缓存大小（按条目数和总大小）
    this.evictMemoryCache();
    this.evictMemoryCacheBySize();

    // 使用异步写入队列保存到磁盘
    const cachePath = this.getCachePath(cacheKey);
    this.writeQueue.push({ cachePath, cacheEntry });
    this.processWriteQueue(); // 异步处理，不阻塞

    console.log('[AudioCache] 缓存已加入队列:', cacheKey);
  }

  /**
   * 删除缓存
   * @param {string} hash - 文件哈希
   * @returns {Promise<void>}
   */
  async delete(hash) {
    // 删除内存缓存
    this.memoryCache.delete(hash);

    // 删除磁盘缓存
    const cachePath = this.getCachePath(hash);
    try {
      await fs.unlink(cachePath);
      console.log('[AudioCache] 缓存已删除:', hash);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[AudioCache] 删除缓存失败:', error);
      }
    }
  }

  /**
   * 清理过期缓存
   * @returns {Promise<number>} 清理的文件数
   */
  async cleanup() {
    let cleanedCount = 0;

    try {
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(this.cacheDir, file);

        try {
          const data = await fs.readFile(filePath, 'utf-8');
          const cacheEntry = JSON.parse(data);

          // 检查是否过期
          if (now - cacheEntry.timestamp > this.maxCacheAge) {
            await fs.unlink(filePath);
            cleanedCount++;
          }

        } catch (error) {
          // 文件损坏，删除
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`[AudioCache] 清理了 ${cleanedCount} 个过期缓存`);
      }

    } catch (error) {
      console.error('[AudioCache] 清理失败:', error);
    }

    return cleanedCount;
  }

  /**
   * 内存缓存驱逐策略 (LRU - 按条目数限制)
   */
  evictMemoryCache() {
    if (this.memoryCache.size <= this.maxMemoryEntries) {
      return;
    }

    // 按最后访问时间排序
    const entries = Array.from(this.memoryCache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    // 删除最旧的条目
    const toDelete = entries.slice(0, this.memoryCache.size - this.maxMemoryEntries);
    toDelete.forEach(([hash, entry]) => {
      this.memoryCache.delete(hash);
      // 更新内存使用量
      if (entry.size) {
        this.currentMemorySize -= entry.size;
      }
    });

    if (toDelete.length > 0) {
      console.log(`[AudioCache] 按条目数驱逐了 ${toDelete.length} 个内存缓存`);
    }
  }

  /**
   * 按大小驱逐内存缓存（LRU策略）
   * 当总内存使用量超过限制时触发
   */
  evictMemoryCacheBySize() {
    if (this.currentMemorySize <= this.maxMemorySize) {
      return;
    }

    // 按最后访问时间排序（最旧的在前）
    const entries = Array.from(this.memoryCache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    let freedSize = 0;
    const toDelete = [];

    // 删除最旧的条目，直到降到目标大小（80%）
    const targetSize = this.maxMemorySize * 0.8;
    for (const [hash, entry] of entries) {
      if (this.currentMemorySize - freedSize <= targetSize) {
        break;
      }

      toDelete.push(hash);
      freedSize += entry.size || 0;
    }

    // 执行删除
    toDelete.forEach(hash => {
      const entry = this.memoryCache.get(hash);
      this.memoryCache.delete(hash);
      this.currentMemorySize -= (entry.size || 0);
    });

    if (toDelete.length > 0) {
      console.log(`[AudioCache] 按大小驱逐了 ${toDelete.length} 个条目，释放 ${(freedSize / 1024 / 1024).toFixed(2)}MB`);
      console.log(`[AudioCache] 当前内存使用: ${(this.currentMemorySize / 1024 / 1024).toFixed(2)}MB / ${(this.maxMemorySize / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  /**
   * 异步处理写入队列
   * 批量写入缓存到磁盘，避免同步阻塞
   */
  async processWriteQueue() {
    // 如果正在写入或队列为空，直接返回
    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }

    this.isWriting = true;

    // 逐个处理队列中的写入任务
    while (this.writeQueue.length > 0) {
      const { cachePath, cacheEntry } = this.writeQueue.shift();

      try {
        await fs.writeFile(cachePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
        // console.log('[AudioCache] 缓存已写入磁盘:', cacheEntry.hash); // 减少日志输出
      } catch (error) {
        console.error('[AudioCache] 批量写入失败:', error.message);
      }
    }

    this.isWriting = false;

    // 如果在处理过程中又有新任务加入，递归处理
    if (this.writeQueue.length > 0) {
      setImmediate(() => this.processWriteQueue());
    }
  }

  /**
   * 获取缓存文件路径
   * @param {string} hash - 文件哈希
   * @returns {string}
   */
  getCachePath(hash) {
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * 获取缓存统计
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const files = await fs.readdir(this.cacheDir);
      const cacheFiles = files.filter(f => f.endsWith('.json'));

      let totalSize = 0;
      for (const file of cacheFiles) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }

      return {
        diskEntries: cacheFiles.length,
        memoryEntries: this.memoryCache.size,
        totalSize: totalSize,
        cacheDir: this.cacheDir
      };

    } catch (error) {
      console.error('[AudioCache] 获取统计失败:', error);
      return {
        diskEntries: 0,
        memoryEntries: this.memoryCache.size,
        totalSize: 0,
        cacheDir: this.cacheDir
      };
    }
  }

  /**
   * 清空所有缓存
   * @returns {Promise<void>}
   */
  async clear() {
    // 清空内存缓存
    this.memoryCache.clear();

    // 清空磁盘缓存
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(this.cacheDir, file));
        }
      }
      console.log('[AudioCache] 所有缓存已清空');
    } catch (error) {
      console.error('[AudioCache] 清空缓存失败:', error);
    }
  }
}

module.exports = AudioCache;
