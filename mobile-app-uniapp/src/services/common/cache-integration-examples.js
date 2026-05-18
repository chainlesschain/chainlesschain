/**
 * 缓存管理器集成示例
 *
 * 展示如何将CacheManager集成到各个服务中
 */

import { getCacheManager } from './cache-manager.js'

/**
 * 示例1: LLM服务集成缓存
 */
export class LLMServiceWithCache {
  constructor(config = {}) {
    // 创建LLM专用缓存（独立命名空间）
    this.cache = getCacheManager('llm', {
      l1MaxSize: 50,
      l1DefaultTTL: 10 * 60 * 1000, // 10分钟
      l2DefaultTTL: 60 * 60 * 1000  // 1小时
    })

    this.config = config
  }

  async initialize() {
    await this.cache.initialize()
  }

  /**
   * 聊天（带缓存）
   */
  async chat(messages, options = {}) {
    // 生成缓存键（基于消息内容和选项）
    const cacheKey = this.generateCacheKey(messages, options)

    // 检查缓存
    if (!options.skipCache) {
      const cached = await this.cache.get(cacheKey)
      if (cached) {
        console.log('[LLM] 使用缓存响应')
        return cached
      }
    }

    // 调用实际API
    const response = await this.callLLMAPI(messages, options)

    // 缓存结果
    await this.cache.set(cacheKey, response, {
      ttl: options.cacheTTL || 10 * 60 * 1000
    })

    return response
  }

  generateCacheKey(messages, options) {
    const content = JSON.stringify({ messages, options })
    // 简单hash函数
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i)
      hash |= 0
    }
    return `chat_${hash}`
  }

  async callLLMAPI(messages, options) {
    // 实际的LLM API调用
    // ...
    return { content: 'AI回复...' }
  }
}

/**
 * 示例2: RAG服务集成缓存
 */
export class RAGServiceWithCache {
  constructor(config = {}) {
    // 创建RAG专用缓存
    this.cache = getCacheManager('rag', {
      l1MaxSize: 100,
      l1DefaultTTL: 30 * 60 * 1000, // 30分钟
      l2DefaultTTL: 24 * 60 * 60 * 1000 // 24小时
    })

    // 创建向量缓存（独立命名空间）
    this.vectorCache = getCacheManager('rag-vectors', {
      l1MaxSize: 200,
      l1MaxMemory: 100 * 1024 * 1024, // 100MB
      l2DefaultTTL: 7 * 24 * 60 * 60 * 1000 // 7天
    })
  }

  async initialize() {
    await Promise.all([
      this.cache.initialize(),
      this.vectorCache.initialize()
    ])
  }

  /**
   * 检索（带缓存）
   */
  async retrieve(query, options = {}) {
    const cacheKey = `retrieve_${query}`

    // 检查缓存
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      console.log('[RAG] 使用缓存检索结果')
      return cached
    }

    // 执行实际检索
    const results = await this.doRetrieve(query, options)

    // 缓存结果
    await this.cache.set(cacheKey, results, {
      ttl: 30 * 60 * 1000
    })

    return results
  }

  /**
   * 生成向量（带缓存）
   */
  async generateEmbedding(text) {
    const cacheKey = `embedding_${text}`

    // 检查向量缓存
    const cached = await this.vectorCache.get(cacheKey)
    if (cached) {
      console.log('[RAG] 使用缓存向量')
      return cached
    }

    // 生成向量
    const embedding = await this.callEmbeddingAPI(text)

    // 缓存向量（长期保存）
    await this.vectorCache.set(cacheKey, embedding, {
      ttl: 7 * 24 * 60 * 60 * 1000,
      persist: true // 持久化到L2
    })

    return embedding
  }

  async doRetrieve(query, options) {
    // 实际检索逻辑
    return []
  }

  async callEmbeddingAPI(text) {
    // 实际向量生成
    return []
  }
}

/**
 * 示例3: 图像服务集成缓存
 */
export class ImageServiceWithCache {
  constructor(config = {}) {
    // 图像缓存（大容量）
    this.cache = getCacheManager('images', {
      l1MaxSize: 20,
      l1MaxMemory: 50 * 1024 * 1024, // 50MB
      l2DefaultTTL: 30 * 24 * 60 * 60 * 1000 // 30天
    })

    // OCR结果缓存
    this.ocrCache = getCacheManager('ocr', {
      l1MaxSize: 50,
      l2DefaultTTL: 7 * 24 * 60 * 60 * 1000 // 7天
    })
  }

  async initialize() {
    await Promise.all([
      this.cache.initialize(),
      this.ocrCache.initialize()
    ])
  }

  /**
   * 加载图像（带缓存）
   */
  async loadImage(url) {
    const cacheKey = `image_${url}`

    // 检查缓存
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      console.log('[Image] 使用缓存图像')
      return cached
    }

    // 下载图像
    const imageData = await this.downloadImage(url)

    // 缓存图像
    await this.cache.set(cacheKey, imageData, {
      persist: true // 持久化
    })

    return imageData
  }

  /**
   * OCR识别（带缓存）
   */
  async performOCR(imagePath) {
    const cacheKey = `ocr_${imagePath}`

    // 检查缓存
    const cached = await this.ocrCache.get(cacheKey)
    if (cached) {
      console.log('[Image] 使用缓存OCR结果')
      return cached
    }

    // 执行OCR
    const text = await this.callOCRAPI(imagePath)

    // 缓存结果
    await this.ocrCache.set(cacheKey, text, {
      persist: true
    })

    return text
  }

  async downloadImage(url) {
    // 实际下载逻辑
    return {}
  }

  async callOCRAPI(imagePath) {
    // 实际OCR逻辑
    return ''
  }
}

/**
 * 示例4: 用户数据缓存
 */
export class UserDataServiceWithCache {
  constructor(config = {}) {
    // 用户数据缓存
    this.cache = getCacheManager('user-data', {
      l1MaxSize: 50,
      l1DefaultTTL: 5 * 60 * 1000, // 5分钟
      l2DefaultTTL: 60 * 60 * 1000, // 1小时

      // 预热常用数据
      preload: [
        {
          key: 'current-user',
          loader: () => this.loadCurrentUser(),
          ttl: 5 * 60 * 1000
        },
        {
          key: 'user-settings',
          loader: () => this.loadUserSettings(),
          ttl: 30 * 60 * 1000
        }
      ]
    })
  }

  async initialize() {
    await this.cache.initialize()
  }

  /**
   * 获取当前用户
   */
  async getCurrentUser() {
    const cached = await this.cache.get('current-user')
    if (cached) {
      return cached
    }

    const user = await this.loadCurrentUser()
    await this.cache.set('current-user', user, {
      ttl: 5 * 60 * 1000
    })

    return user
  }

  /**
   * 更新用户数据（清除缓存）
   */
  async updateUser(userId, data) {
    // 更新数据库
    await this.updateDatabase(userId, data)

    // 清除相关缓存
    await this.cache.delete('current-user')
    await this.cache.delete(`user-${userId}`)
  }

  async loadCurrentUser() {
    // 从数据库加载
    return {}
  }

  async loadUserSettings() {
    // 从数据库加载
    return {}
  }

  async updateDatabase(userId, data) {
    // 更新数据库
  }
}

/**
 * 示例5: API响应缓存（通用）
 */
export class APIServiceWithCache {
  constructor(config = {}) {
    this.cache = getCacheManager('api', {
      l1MaxSize: 100,
      l1DefaultTTL: 5 * 60 * 1000,
      l2DefaultTTL: 30 * 60 * 1000
    })
  }

  async initialize() {
    await this.cache.initialize()
  }

  /**
   * 通用API请求（带缓存）
   */
  async request(url, options = {}) {
    const cacheKey = this.generateRequestKey(url, options)

    // 检查缓存
    if (!options.skipCache) {
      const cached = await this.cache.get(cacheKey)
      if (cached) {
        console.log('[API] 使用缓存响应')
        return cached
      }
    }

    // 发送请求
    const response = await uni.request({
      url,
      ...options
    })

    // 缓存响应
    if (response.statusCode === 200) {
      await this.cache.set(cacheKey, response.data, {
        ttl: options.cacheTTL || 5 * 60 * 1000
      })
    }

    return response.data
  }

  generateRequestKey(url, options) {
    const key = `${options.method || 'GET'}_${url}_${JSON.stringify(options.data || {})}`
    return key.substring(0, 100) // 限制长度
  }
}

/**
 * 示例6: 多级缓存策略
 */
export class MultiLayerCacheExample {
  constructor() {
    // 热数据缓存（L1为主）
    this.hotCache = getCacheManager('hot-data', {
      l1MaxSize: 200,
      l1DefaultTTL: 1 * 60 * 1000, // 1分钟
      l2Enabled: false // 不使用L2
    })

    // 温数据缓存（L1+L2）
    this.warmCache = getCacheManager('warm-data', {
      l1MaxSize: 100,
      l1DefaultTTL: 10 * 60 * 1000, // 10分钟
      l2DefaultTTL: 60 * 60 * 1000  // 1小时
    })

    // 冷数据缓存（L2为主）
    this.coldCache = getCacheManager('cold-data', {
      l1MaxSize: 20,
      l1DefaultTTL: 30 * 60 * 1000, // 30分钟
      l2DefaultTTL: 7 * 24 * 60 * 60 * 1000 // 7天
    })
  }

  async initialize() {
    await Promise.all([
      this.hotCache.initialize(),
      this.warmCache.initialize(),
      this.coldCache.initialize()
    ])
  }

  /**
   * 根据数据特性选择缓存层
   */
  async getData(key, type = 'warm') {
    switch (type) {
      case 'hot':
        return await this.hotCache.get(key)
      case 'warm':
        return await this.warmCache.get(key)
      case 'cold':
        return await this.coldCache.get(key)
      default:
        return await this.warmCache.get(key)
    }
  }

  async setData(key, value, type = 'warm') {
    switch (type) {
      case 'hot':
        await this.hotCache.set(key, value)
        break
      case 'warm':
        await this.warmCache.set(key, value)
        break
      case 'cold':
        await this.coldCache.set(key, value, { persist: true })
        break
      default:
        await this.warmCache.set(key, value)
    }
  }
}

/**
 * 示例7: 缓存监控和告警
 */
export class CacheMonitor {
  constructor(cacheManager) {
    this.cache = cacheManager

    // 监听缓存事件
    this.cache.on('cache-hit', (data) => {
      console.log('[Monitor] 缓存命中:', data)
    })

    this.cache.on('cache-miss', (data) => {
      console.log('[Monitor] 缓存未命中:', data)
    })

    this.cache.on('cache-evict', (data) => {
      console.log('[Monitor] 缓存淘汰:', data)
      this.checkEvictionRate()
    })

    this.cache.on('cache-cleanup', (data) => {
      console.log('[Monitor] 清理过期缓存:', data.cleaned, '个')
    })

    // 定期检查统计
    this.startMonitoring()
  }

  startMonitoring() {
    setInterval(() => {
      const stats = this.cache.getStats()

      console.log('[Monitor] 缓存统计:', stats)

      // 告警检查
      this.checkAlerts(stats)
    }, 60000) // 每分钟检查一次
  }

  checkAlerts(stats) {
    // 检查命中率
    const hitRate = parseFloat(stats.overall.hitRate)
    if (hitRate < 50) {
      console.warn('[Monitor] ⚠️ 缓存命中率过低:', stats.overall.hitRate)
    }

    // 检查内存占用
    if (stats.l1.memory > stats.l1.maxMemory * 0.9) {
      console.warn('[Monitor] ⚠️ L1内存占用过高:', stats.l1.memory, '/', stats.l1.maxMemory)
    }

    // 检查淘汰率
    if (stats.overall.evictions > 100) {
      console.warn('[Monitor] ⚠️ 缓存淘汰次数过多:', stats.overall.evictions)
    }
  }

  checkEvictionRate() {
    // 检查淘汰率是否过高
    // 如果过高，可能需要增加缓存大小
  }
}

// 导出所有示例
export default {
  LLMServiceWithCache,
  RAGServiceWithCache,
  ImageServiceWithCache,
  UserDataServiceWithCache,
  APIServiceWithCache,
  MultiLayerCacheExample,
  CacheMonitor
}
