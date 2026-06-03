/**
 * 文件内容缓存服务（LRU缓存）
 *
 * 功能：
 * - 缓存文件内容，避免重复加载
 * - LRU（最近最少使用）淘汰策略
 * - 可配置最大缓存数量和单个文件大小限制
 * - 自动清理过期缓存
 */

class FileCache {
  constructor(options = {}) {
    // 配置
    this.maxSize = options.maxSize || 50 // 最大缓存文件数
    this.maxFileSize = options.maxFileSize || 1024 * 1024 // 单个文件最大1MB
    this.ttl = options.ttl || 30 * 60 * 1000 // 缓存过期时间（30分钟）

    // 缓存存储
    this.cache = new Map() // key -> {data, timestamp, accessCount}

    // 统计信息
    this.stats = {
      hits: 0,        // 命中次数
      misses: 0,      // 未命中次数
      evictions: 0,   // 淘汰次数
      totalSize: 0    // 当前缓存总大小（估算）
    }
  }

  /**
   * 生成缓存键
   */
  generateKey(peerId, projectId, filePath) {
    return `${peerId}:${projectId}:${filePath}`
  }

  /**
   * 获取缓存
   */
  get(peerId, projectId, filePath) {
    const key = this.generateKey(peerId, projectId, filePath)
    const item = this.cache.get(key)

    if (!item) {
      this.stats.misses++
      return null
    }

    // 检查是否过期
    const now = Date.now()
    if (now - item.timestamp > this.ttl) {
      this.delete(key)
      this.stats.misses++
      return null
    }

    // 命中，更新访问时间和计数
    item.timestamp = now
    item.accessCount++
    this.stats.hits++

    return item.data
  }

  /**
   * 设置缓存
   */
  set(peerId, projectId, filePath, data) {
    const key = this.generateKey(peerId, projectId, filePath)

    // 检查文件大小限制
    const dataSize = this.estimateSize(data)
    if (dataSize > this.maxFileSize) {
      console.log('[FileCache] 文件过大，不缓存:', filePath, `${(dataSize / 1024).toFixed(2)}KB`)
      return false
    }

    // 如果缓存已满，淘汰最久未使用的项
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    // 保存到缓存
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1,
      size: dataSize
    })

    this.stats.totalSize += dataSize

    console.log('[FileCache] 缓存文件:', filePath, `缓存数: ${this.cache.size}`)

    return true
  }

  /**
   * 删除缓存
   */
  delete(key) {
    const item = this.cache.get(key)
    if (item) {
      this.stats.totalSize -= item.size
      this.cache.delete(key)
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear()
    this.stats.totalSize = 0
    console.log('[FileCache] 缓存已清空')
  }

  /**
   * 清理过期缓存
   */
  cleanExpired() {
    const now = Date.now()
    let cleaned = 0

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.ttl) {
        this.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log('[FileCache] 清理过期缓存:', cleaned)
    }

    return cleaned
  }

  /**
   * LRU淘汰策略
   */
  evictLRU() {
    let lruKey = null
    let lruTime = Infinity

    // 找到最久未访问的项
    for (const [key, item] of this.cache.entries()) {
      if (item.timestamp < lruTime) {
        lruTime = item.timestamp
        lruKey = key
      }
    }

    if (lruKey) {
      console.log('[FileCache] LRU淘汰:', lruKey)
      this.delete(lruKey)
      this.stats.evictions++
    }
  }

  /**
   * 估算数据大小（字节）
   */
  estimateSize(data) {
    if (!data) return 0

    if (typeof data === 'string') {
      // 字符串：UTF-8编码，一般字符1字节，中文3字节，简单估算 * 2
      return data.length * 2
    }

    if (typeof data === 'object') {
      // 对象：JSON序列化后的大小
      try {
        return JSON.stringify(data).length * 2
      } catch (error) {
        return 0
      }
    }

    return 0
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
        : '0%',
      totalSizeKB: (this.stats.totalSize / 1024).toFixed(2) + 'KB'
    }
  }

  /**
   * 打印缓存统计
   */
  printStats() {
    const stats = this.getStats()
    console.log('[FileCache] 缓存统计:', stats)
    return stats
  }
}

// 导出单例
export default new FileCache({
  maxSize: 50,                // 最多缓存50个文件
  maxFileSize: 1024 * 1024,   // 单个文件最大1MB
  ttl: 30 * 60 * 1000         // 30分钟过期
})
