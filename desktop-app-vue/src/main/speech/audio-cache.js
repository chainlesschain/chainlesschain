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
    this.maxCacheSize = options.maxCacheSize || 100 * 1024 * 1024; // 100MB
    this.maxCacheAge = options.maxCacheAge || 30 * 24 * 60 * 60 * 1000; // 30天
    this.memoryCache = new Map(); // 内存缓存
    this.maxMemoryEntries = options.maxMemoryEntries || 50;
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
   * 计算文件MD5哈希
   * @param {string|Buffer} input - 文件路径或Buffer
   * @returns {Promise<string>} MD5哈希
   */
  async calculateHash(input) {
    const hash = crypto.createHash('md5');

    if (Buffer.isBuffer(input)) {
      hash.update(input);
    } else if (typeof input === 'string') {
      const data = await fs.readFile(input);
      hash.update(data);
    } else {
      throw new Error('输入必须是文件路径或Buffer');
    }

    return hash.digest('hex');
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
   * 获取缓存
   * @param {string} hash - 文件哈希
   * @returns {Promise<Object|null>} 缓存的转录结果
   */
  async get(hash) {
    // 先检查内存缓存
    if (this.memoryCache.has(hash)) {
      const entry = this.memoryCache.get(hash);

      // 更新访问时间
      entry.lastAccessed = Date.now();

      console.log('[AudioCache] 内存缓存命中:', hash);
      return entry.data;
    }

    // 检查磁盘缓存
    const cachePath = this.getCachePath(hash);
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      const cacheEntry = JSON.parse(data);

      // 检查是否过期
      if (Date.now() - cacheEntry.timestamp > this.maxCacheAge) {
        console.log('[AudioCache] 缓存已过期:', hash);
        await fs.unlink(cachePath);
        return null;
      }

      // 加载到内存缓存
      this.memoryCache.set(hash, {
        data: cacheEntry.result,
        timestamp: cacheEntry.timestamp,
        lastAccessed: Date.now()
      });

      // 限制内存缓存大小
      this.evictMemoryCache();

      console.log('[AudioCache] 磁盘缓存命中:', hash);
      return cacheEntry.result;

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[AudioCache] 读取缓存失败:', error);
      }
      return null;
    }
  }

  /**
   * 保存缓存
   * @param {string} hash - 文件哈希
   * @param {Object} result - 转录结果
   * @returns {Promise<void>}
   */
  async set(hash, result) {
    const cacheEntry = {
      hash: hash,
      result: result,
      timestamp: Date.now()
    };

    // 保存到内存缓存
    this.memoryCache.set(hash, {
      data: result,
      timestamp: cacheEntry.timestamp,
      lastAccessed: Date.now()
    });

    // 限制内存缓存大小
    this.evictMemoryCache();

    // 保存到磁盘缓存
    const cachePath = this.getCachePath(hash);
    try {
      await fs.writeFile(cachePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
      console.log('[AudioCache] 缓存已保存:', hash);
    } catch (error) {
      console.error('[AudioCache] 保存缓存失败:', error);
    }
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
   * 内存缓存驱逐策略 (LRU)
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
    toDelete.forEach(([hash]) => {
      this.memoryCache.delete(hash);
    });

    console.log(`[AudioCache] 驱逐了 ${toDelete.length} 个内存缓存条目`);
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
