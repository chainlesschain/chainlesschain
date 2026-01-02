/**
 * 统一缓存管理器 (移动端版本)
 *
 * 功能:
 * - 多级缓存（内存 + IndexedDB）
 * - LRU淘汰策略
 * - 持久化存储
 * - TTL过期机制
 * - 缓存预热
 * - 命名空间隔离
 * - 统计和监控
 */

/**
 * 缓存项结构
 * @typedef {Object} CacheItem
 * @property {string} key - 缓存键
 * @property {*} value - 缓存值
 * @property {number} timestamp - 创建时间
 * @property {number} ttl - 过期时间（毫秒）
 * @property {number} hits - 命中次数
 * @property {number} size - 数据大小（字节）
 */

/**
 * 缓存管理器类
 */
class CacheManager {
  constructor(config = {}) {
    this.config = {
      // 命名空间（用于隔离不同模块的缓存）
      namespace: config.namespace || 'default',

      // L1缓存（内存）配置
      l1: {
        enabled: config.l1Enabled !== false,
        maxSize: config.l1MaxSize || 100, // 最大项数
        maxMemory: config.l1MaxMemory || 50 * 1024 * 1024, // 最大内存（50MB）
        defaultTTL: config.l1DefaultTTL || 5 * 60 * 1000 // 默认过期时间（5分钟）
      },

      // L2缓存（IndexedDB）配置
      l2: {
        enabled: config.l2Enabled !== false,
        dbName: config.dbName || 'CacheDB',
        storeName: config.storeName || 'cache',
        maxSize: config.l2MaxSize || 1000, // 最大项数
        defaultTTL: config.l2DefaultTTL || 24 * 60 * 60 * 1000 // 默认过期时间（24小时）
      },

      // 自动清理配置
      autoCleanup: config.autoCleanup !== false,
      cleanupInterval: config.cleanupInterval || 5 * 60 * 1000, // 清理间隔（5分钟）

      // 预热配置
      preload: config.preload || [],

      ...config
    }

    // L1缓存（内存）
    this.l1Cache = new Map()
    this.l1Keys = [] // LRU队列
    this.l1Memory = 0 // 当前内存占用

    // L2缓存（IndexedDB）
    this.db = null
    this.dbReady = false

    // 清理定时器
    this.cleanupTimer = null

    // 初始化状态
    this.isInitialized = false

    // 统计
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalMemory: 0
    }

    // 事件监听器
    this.listeners = new Map()
  }

  /**
   * 初始化
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true }
    }

    try {
      console.log('[CacheManager] 初始化缓存管理器...', this.config.namespace)

      // 初始化L2缓存（IndexedDB）
      if (this.config.l2.enabled) {
        await this.initIndexedDB()
      }

      // 预热缓存
      if (this.config.preload.length > 0) {
        await this.preloadCache()
      }

      // 启动自动清理
      if (this.config.autoCleanup) {
        this.startAutoCleanup()
      }

      this.isInitialized = true

      console.log('[CacheManager] ✅ 初始化成功')

      return {
        success: true,
        namespace: this.config.namespace,
        l1Enabled: this.config.l1.enabled,
        l2Enabled: this.config.l2.enabled
      }
    } catch (error) {
      console.error('[CacheManager] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 初始化IndexedDB
   * @returns {Promise<void>}
   * @private
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      // uni-app中使用plus.indexedDB
      if (typeof plus !== 'undefined' && plus.indexedDB) {
        const request = plus.indexedDB.open(this.config.l2.dbName, 1)

        request.onsuccess = (event) => {
          this.db = event.target.result
          this.dbReady = true
          console.log('[CacheManager] IndexedDB已连接')
          resolve()
        }

        request.onerror = (event) => {
          console.error('[CacheManager] IndexedDB连接失败:', event)
          reject(new Error('IndexedDB连接失败'))
        }

        request.onupgradeneeded = (event) => {
          const db = event.target.result

          // 创建缓存存储
          if (!db.objectStoreNames.contains(this.config.l2.storeName)) {
            const store = db.createObjectStore(this.config.l2.storeName, { keyPath: 'key' })
            store.createIndex('namespace', 'namespace', { unique: false })
            store.createIndex('timestamp', 'timestamp', { unique: false })
            store.createIndex('ttl', 'ttl', { unique: false })
          }
        }
      } else {
        // 降级：使用localStorage模拟
        console.warn('[CacheManager] IndexedDB不可用，使用localStorage模拟')
        this.dbReady = true
        resolve()
      }
    })
  }

  /**
   * 获取缓存
   * @param {string} key - 缓存键
   * @param {Object} options - 选项
   * @returns {Promise<*>}
   */
  async get(key, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const fullKey = this.makeKey(key)

    // 1. 尝试从L1缓存获取
    if (this.config.l1.enabled) {
      const l1Value = this.getFromL1(fullKey)

      if (l1Value !== null) {
        this.stats.l1Hits++
        this.emit('cache-hit', { level: 'L1', key })
        return l1Value
      }

      this.stats.l1Misses++
    }

    // 2. 尝试从L2缓存获取
    if (this.config.l2.enabled && this.dbReady) {
      const l2Value = await this.getFromL2(fullKey)

      if (l2Value !== null) {
        this.stats.l2Hits++

        // 提升到L1缓存
        if (this.config.l1.enabled) {
          this.setToL1(fullKey, l2Value, options.ttl)
        }

        this.emit('cache-hit', { level: 'L2', key })
        return l2Value
      }

      this.stats.l2Misses++
    }

    this.emit('cache-miss', { key })
    return null
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {*} value - 缓存值
   * @param {Object} options - 选项
   * @returns {Promise<void>}
   */
  async set(key, value, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const fullKey = this.makeKey(key)
    const ttl = options.ttl || this.config.l1.defaultTTL

    this.stats.sets++

    // 1. 设置到L1缓存
    if (this.config.l1.enabled && !options.l2Only) {
      this.setToL1(fullKey, value, ttl)
    }

    // 2. 设置到L2缓存
    if (this.config.l2.enabled && this.dbReady && options.persist !== false) {
      await this.setToL2(fullKey, value, options.ttl || this.config.l2.defaultTTL)
    }

    this.emit('cache-set', { key, ttl })
  }

  /**
   * 删除缓存
   * @param {string} key - 缓存键
   * @returns {Promise<void>}
   */
  async delete(key) {
    const fullKey = this.makeKey(key)

    this.stats.deletes++

    // 从L1删除
    if (this.config.l1.enabled) {
      this.deleteFromL1(fullKey)
    }

    // 从L2删除
    if (this.config.l2.enabled && this.dbReady) {
      await this.deleteFromL2(fullKey)
    }

    this.emit('cache-delete', { key })
  }

  /**
   * 清空缓存
   * @param {Object} options - 选项
   * @returns {Promise<void>}
   */
  async clear(options = {}) {
    // 清空L1
    if (this.config.l1.enabled && !options.l2Only) {
      this.l1Cache.clear()
      this.l1Keys = []
      this.l1Memory = 0
    }

    // 清空L2
    if (this.config.l2.enabled && this.dbReady && !options.l1Only) {
      await this.clearL2()
    }

    this.emit('cache-clear', options)
  }

  /**
   * 从L1缓存获取
   * @param {string} key - 缓存键
   * @returns {*}
   * @private
   */
  getFromL1(key) {
    const item = this.l1Cache.get(key)

    if (!item) {
      return null
    }

    // 检查过期
    if (this.isExpired(item)) {
      this.deleteFromL1(key)
      return null
    }

    // 更新访问信息
    item.hits++
    item.lastAccess = Date.now()

    // 更新LRU
    this.updateL1LRU(key)

    return item.value
  }

  /**
   * 设置到L1缓存
   * @param {string} key - 缓存键
   * @param {*} value - 缓存值
   * @param {number} ttl - 过期时间
   * @private
   */
  setToL1(key, value, ttl) {
    // 计算数据大小
    const size = this.calculateSize(value)

    // 检查是否需要淘汰
    while (
      (this.l1Cache.size >= this.config.l1.maxSize ||
        this.l1Memory + size > this.config.l1.maxMemory) &&
      this.l1Keys.length > 0
    ) {
      this.evictL1()
    }

    // 创建缓存项
    const item = {
      key,
      value,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      lastAccess: Date.now(),
      size
    }

    // 如果键已存在，先删除旧的
    if (this.l1Cache.has(key)) {
      this.deleteFromL1(key)
    }

    // 添加到缓存
    this.l1Cache.set(key, item)
    this.l1Keys.push(key)
    this.l1Memory += size

    this.stats.totalMemory = this.l1Memory
  }

  /**
   * 从L1缓存删除
   * @param {string} key - 缓存键
   * @private
   */
  deleteFromL1(key) {
    const item = this.l1Cache.get(key)

    if (!item) {
      return
    }

    // 删除缓存
    this.l1Cache.delete(key)

    // 从LRU队列删除
    const index = this.l1Keys.indexOf(key)
    if (index > -1) {
      this.l1Keys.splice(index, 1)
    }

    // 更新内存占用
    this.l1Memory -= item.size
    this.stats.totalMemory = this.l1Memory
  }

  /**
   * 淘汰L1缓存（LRU）
   * @private
   */
  evictL1() {
    if (this.l1Keys.length === 0) {
      return
    }

    // 淘汰最久未使用的
    const key = this.l1Keys.shift()
    const item = this.l1Cache.get(key)

    if (item) {
      this.l1Cache.delete(key)
      this.l1Memory -= item.size
      this.stats.evictions++

      console.log('[CacheManager] L1淘汰:', key)

      this.emit('cache-evict', { level: 'L1', key })
    }
  }

  /**
   * 更新L1 LRU队列
   * @param {string} key - 缓存键
   * @private
   */
  updateL1LRU(key) {
    const index = this.l1Keys.indexOf(key)

    if (index > -1) {
      // 移到队列末尾（最近使用）
      this.l1Keys.splice(index, 1)
      this.l1Keys.push(key)
    }
  }

  /**
   * 从L2缓存获取
   * @param {string} key - 缓存键
   * @returns {Promise<*>}
   * @private
   */
  async getFromL2(key) {
    if (!this.db) {
      // 降级：使用localStorage
      return this.getFromLocalStorage(key)
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.config.l2.storeName], 'readonly')
        const store = transaction.objectStore(this.config.l2.storeName)
        const request = store.get(key)

        request.onsuccess = (event) => {
          const item = event.target.result

          if (!item) {
            resolve(null)
            return
          }

          // 检查命名空间
          if (item.namespace !== this.config.namespace) {
            resolve(null)
            return
          }

          // 检查过期
          if (this.isExpired(item)) {
            this.deleteFromL2(key)
            resolve(null)
            return
          }

          // 更新访问信息
          item.hits++
          item.lastAccess = Date.now()

          // 回写
          const updateTransaction = this.db.transaction([this.config.l2.storeName], 'readwrite')
          const updateStore = updateTransaction.objectStore(this.config.l2.storeName)
          updateStore.put(item)

          resolve(item.value)
        }

        request.onerror = () => {
          resolve(null)
        }
      } catch (error) {
        console.error('[CacheManager] L2读取失败:', error)
        resolve(null)
      }
    })
  }

  /**
   * 设置到L2缓存
   * @param {string} key - 缓存键
   * @param {*} value - 缓存值
   * @param {number} ttl - 过期时间
   * @returns {Promise<void>}
   * @private
   */
  async setToL2(key, value, ttl) {
    if (!this.db) {
      // 降级：使用localStorage
      return this.setToLocalStorage(key, value, ttl)
    }

    return new Promise((resolve, reject) => {
      try {
        const item = {
          key,
          namespace: this.config.namespace,
          value,
          timestamp: Date.now(),
          ttl,
          hits: 0,
          lastAccess: Date.now(),
          size: this.calculateSize(value)
        }

        const transaction = this.db.transaction([this.config.l2.storeName], 'readwrite')
        const store = transaction.objectStore(this.config.l2.storeName)
        const request = store.put(item)

        request.onsuccess = () => {
          resolve()
        }

        request.onerror = (error) => {
          console.error('[CacheManager] L2写入失败:', error)
          reject(error)
        }
      } catch (error) {
        console.error('[CacheManager] L2写入异常:', error)
        reject(error)
      }
    })
  }

  /**
   * 从L2缓存删除
   * @param {string} key - 缓存键
   * @returns {Promise<void>}
   * @private
   */
  async deleteFromL2(key) {
    if (!this.db) {
      // 降级：使用localStorage
      return this.deleteFromLocalStorage(key)
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.config.l2.storeName], 'readwrite')
        const store = transaction.objectStore(this.config.l2.storeName)
        const request = store.delete(key)

        request.onsuccess = () => {
          resolve()
        }

        request.onerror = () => {
          resolve()
        }
      } catch (error) {
        console.error('[CacheManager] L2删除失败:', error)
        resolve()
      }
    })
  }

  /**
   * 清空L2缓存
   * @returns {Promise<void>}
   * @private
   */
  async clearL2() {
    if (!this.db) {
      // 降级：清空localStorage中的缓存
      const prefix = `cache_${this.config.namespace}_`
      const keys = []

      for (let i = 0; i < uni.getStorageInfoSync().keys.length; i++) {
        const key = uni.getStorageInfoSync().keys[i]
        if (key.startsWith(prefix)) {
          keys.push(key)
        }
      }

      for (const key of keys) {
        uni.removeStorageSync(key)
      }

      return
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.config.l2.storeName], 'readwrite')
        const store = transaction.objectStore(this.config.l2.storeName)
        const index = store.index('namespace')
        const request = index.openCursor(IDBKeyRange.only(this.config.namespace))

        request.onsuccess = (event) => {
          const cursor = event.target.result

          if (cursor) {
            cursor.delete()
            cursor.continue()
          } else {
            resolve()
          }
        }

        request.onerror = () => {
          resolve()
        }
      } catch (error) {
        console.error('[CacheManager] L2清空失败:', error)
        resolve()
      }
    })
  }

  /**
   * 使用localStorage作为降级方案获取
   * @param {string} key - 缓存键
   * @returns {*}
   * @private
   */
  getFromLocalStorage(key) {
    try {
      const storageKey = `cache_${this.config.namespace}_${key}`
      const data = uni.getStorageSync(storageKey)

      if (!data) {
        return null
      }

      const item = JSON.parse(data)

      // 检查过期
      if (this.isExpired(item)) {
        uni.removeStorageSync(storageKey)
        return null
      }

      return item.value
    } catch (error) {
      console.error('[CacheManager] localStorage读取失败:', error)
      return null
    }
  }

  /**
   * 使用localStorage作为降级方案设置
   * @param {string} key - 缓存键
   * @param {*} value - 缓存值
   * @param {number} ttl - 过期时间
   * @private
   */
  setToLocalStorage(key, value, ttl) {
    try {
      const storageKey = `cache_${this.config.namespace}_${key}`
      const item = {
        key,
        namespace: this.config.namespace,
        value,
        timestamp: Date.now(),
        ttl
      }

      uni.setStorageSync(storageKey, JSON.stringify(item))
    } catch (error) {
      console.error('[CacheManager] localStorage写入失败:', error)
    }
  }

  /**
   * 使用localStorage作为降级方案删除
   * @param {string} key - 缓存键
   * @private
   */
  deleteFromLocalStorage(key) {
    try {
      const storageKey = `cache_${this.config.namespace}_${key}`
      uni.removeStorageSync(storageKey)
    } catch (error) {
      console.error('[CacheManager] localStorage删除失败:', error)
    }
  }

  /**
   * 检查是否过期
   * @param {Object} item - 缓存项
   * @returns {boolean}
   * @private
   */
  isExpired(item) {
    if (!item.ttl || item.ttl === 0) {
      return false
    }

    return Date.now() - item.timestamp > item.ttl
  }

  /**
   * 生成完整的缓存键
   * @param {string} key - 原始键
   * @returns {string}
   * @private
   */
  makeKey(key) {
    return `${this.config.namespace}:${key}`
  }

  /**
   * 计算数据大小（字节）
   * @param {*} value - 数据
   * @returns {number}
   * @private
   */
  calculateSize(value) {
    try {
      const str = JSON.stringify(value)
      return new Blob([str]).size
    } catch (error) {
      // 降级估算
      return JSON.stringify(value).length * 2
    }
  }

  /**
   * 预热缓存
   * @returns {Promise<void>}
   * @private
   */
  async preloadCache() {
    console.log('[CacheManager] 开始预热缓存...')

    for (const item of this.config.preload) {
      try {
        if (typeof item.loader === 'function') {
          const value = await item.loader()
          await this.set(item.key, value, { ttl: item.ttl })
        }
      } catch (error) {
        console.error('[CacheManager] 预热失败:', item.key, error)
      }
    }

    console.log('[CacheManager] ✅ 缓存预热完成')
  }

  /**
   * 启动自动清理
   * @private
   */
  startAutoCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * 清理过期缓存
   */
  cleanup() {
    let cleaned = 0

    // 清理L1
    if (this.config.l1.enabled) {
      for (const [key, item] of this.l1Cache.entries()) {
        if (this.isExpired(item)) {
          this.deleteFromL1(key)
          cleaned++
        }
      }
    }

    if (cleaned > 0) {
      console.log('[CacheManager] 清理了', cleaned, '个过期缓存')
      this.emit('cache-cleanup', { cleaned })
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const l1HitRate = this.stats.l1Hits + this.stats.l1Misses > 0
      ? ((this.stats.l1Hits / (this.stats.l1Hits + this.stats.l1Misses)) * 100).toFixed(2) + '%'
      : '0%'

    const l2HitRate = this.stats.l2Hits + this.stats.l2Misses > 0
      ? ((this.stats.l2Hits / (this.stats.l2Hits + this.stats.l2Misses)) * 100).toFixed(2) + '%'
      : '0%'

    const overallHitRate =
      (this.stats.l1Hits + this.stats.l1Misses + this.stats.l2Hits + this.stats.l2Misses) > 0
        ? (((this.stats.l1Hits + this.stats.l2Hits) /
            (this.stats.l1Hits + this.stats.l1Misses + this.stats.l2Hits + this.stats.l2Misses)) * 100).toFixed(2) + '%'
        : '0%'

    return {
      namespace: this.config.namespace,
      l1: {
        enabled: this.config.l1.enabled,
        size: this.l1Cache.size,
        maxSize: this.config.l1.maxSize,
        memory: this.l1Memory,
        maxMemory: this.config.l1.maxMemory,
        hits: this.stats.l1Hits,
        misses: this.stats.l1Misses,
        hitRate: l1HitRate
      },
      l2: {
        enabled: this.config.l2.enabled,
        ready: this.dbReady,
        hits: this.stats.l2Hits,
        misses: this.stats.l2Misses,
        hitRate: l2HitRate
      },
      overall: {
        hits: this.stats.l1Hits + this.stats.l2Hits,
        misses: this.stats.l1Misses + this.stats.l2Misses,
        hitRate: overallHitRate,
        sets: this.stats.sets,
        deletes: this.stats.deletes,
        evictions: this.stats.evictions
      }
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return

    const callbacks = this.listeners.get(event)
    for (const callback of callbacks) {
      try {
        callback(data)
      } catch (error) {
        console.error('[CacheManager] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止自动清理
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    // 清空L1
    this.l1Cache.clear()
    this.l1Keys = []
    this.l1Memory = 0

    // 关闭IndexedDB
    if (this.db) {
      this.db.close()
      this.db = null
      this.dbReady = false
    }

    this.isInitialized = false

    console.log('[CacheManager] 资源已清理')
  }
}

// 缓存管理器实例池
const cacheManagers = new Map()

/**
 * 获取缓存管理器实例
 * @param {string} namespace - 命名空间
 * @param {Object} config - 配置
 * @returns {CacheManager}
 */
export function getCacheManager(namespace = 'default', config = {}) {
  if (!cacheManagers.has(namespace)) {
    cacheManagers.set(namespace, new CacheManager({
      ...config,
      namespace
    }))
  }
  return cacheManagers.get(namespace)
}

export default CacheManager
