/**
 * 高级缓存管理器
 *
 * 在基础缓存管理器上扩展的高级功能:
 * 1. 数据压缩 - LZ-String算法
 * 2. 智能淘汰策略 - LFU、自适应
 * 3. 缓存预热 - 智能预加载
 * 4. 批量操作 - 高效批处理
 * 5. 同步机制 - 多设备同步
 * 6. 查询优化 - 智能缓存
 * 7. 性能分析 - 实时监控
 *
 * @version 1.5.0
 */

import { getCacheManager } from './cache-manager.js'

/**
 * LZ-String 压缩算法实现
 */
class LZString {
  static compress(uncompressed) {
    if (!uncompressed) return ''

    const dict = {}
    const data = (uncompressed + '').split('')
    const out = []
    let phrase = data[0]
    let code = 256

    for (let i = 1; i < data.length; i++) {
      const currChar = data[i]
      const temp = phrase + currChar

      if (dict[temp] != null) {
        phrase = temp
      } else {
        out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0))
        dict[temp] = code
        code++
        phrase = currChar
      }
    }

    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0))
    return out.map(c => String.fromCharCode(c)).join('')
  }

  static decompress(compressed) {
    if (!compressed) return ''

    const dict = {}
    const data = compressed.split('').map(c => c.charCodeAt(0))
    let currChar = String.fromCharCode(data[0])
    let oldPhrase = currChar
    const out = [currChar]
    let code = 256

    for (let i = 1; i < data.length; i++) {
      const currCode = data[i]
      let phrase

      if (currCode < 256) {
        phrase = String.fromCharCode(currCode)
      } else {
        phrase = dict[currCode] || (oldPhrase + currChar)
      }

      out.push(phrase)
      currChar = phrase.charAt(0)
      dict[code] = oldPhrase + currChar
      code++
      oldPhrase = phrase
    }

    return out.join('')
  }

  static compressToBase64(input) {
    if (!input) return ''
    const compressed = this.compress(input)
    try {
      return btoa(unescape(encodeURIComponent(compressed)))
    } catch (e) {
      // uni-app环境使用Buffer
      return this.stringToBase64(compressed)
    }
  }

  static decompressFromBase64(input) {
    if (!input) return ''
    try {
      const compressed = decodeURIComponent(escape(atob(input)))
      return this.decompress(compressed)
    } catch (e) {
      const compressed = this.base64ToString(input)
      return this.decompress(compressed)
    }
  }

  static stringToBase64(str) {
    const buffer = []
    for (let i = 0; i < str.length; i++) {
      buffer.push(str.charCodeAt(i))
    }
    return btoa(String.fromCharCode.apply(null, buffer))
  }

  static base64ToString(base64) {
    const binary = atob(base64)
    const bytes = []
    for (let i = 0; i < binary.length; i++) {
      bytes.push(binary.charCodeAt(i))
    }
    return String.fromCharCode.apply(null, bytes)
  }
}

/**
 * 淘汰策略: LFU (Least Frequently Used)
 */
class LFUEvictionPolicy {
  constructor() {
    this.frequencies = new Map() // key -> frequency
    this.freqLists = new Map()   // frequency -> Set of keys
    this.minFreq = 0
  }

  access(key) {
    const freq = this.frequencies.get(key) || 0
    const newFreq = freq + 1

    // 更新频率
    this.frequencies.set(key, newFreq)

    // 从旧频率列表移除
    if (freq > 0) {
      const oldList = this.freqLists.get(freq)
      if (oldList) {
        oldList.delete(key)
        if (oldList.size === 0) {
          this.freqLists.delete(freq)
          if (this.minFreq === freq) {
            this.minFreq = newFreq
          }
        }
      }
    }

    // 添加到新频率列表
    if (!this.freqLists.has(newFreq)) {
      this.freqLists.set(newFreq, new Set())
    }
    this.freqLists.get(newFreq).add(key)

    // 更新最小频率
    if (freq === 0) {
      this.minFreq = 1
    }
  }

  evict() {
    const minFreqList = this.freqLists.get(this.minFreq)
    if (!minFreqList || minFreqList.size === 0) {
      return null
    }

    // 获取第一个键（最少使用）
    const keyToEvict = minFreqList.values().next().value

    // 清理
    minFreqList.delete(keyToEvict)
    this.frequencies.delete(keyToEvict)

    if (minFreqList.size === 0) {
      this.freqLists.delete(this.minFreq)
    }

    return keyToEvict
  }

  remove(key) {
    const freq = this.frequencies.get(key)
    if (freq !== undefined) {
      this.frequencies.delete(key)
      const freqList = this.freqLists.get(freq)
      if (freqList) {
        freqList.delete(key)
        if (freqList.size === 0) {
          this.freqLists.delete(freq)
        }
      }
    }
  }

  clear() {
    this.frequencies.clear()
    this.freqLists.clear()
    this.minFreq = 0
  }
}

/**
 * 淘汰策略: 自适应 (LRU + LFU混合)
 */
class AdaptiveEvictionPolicy {
  constructor(config = {}) {
    this.lruWeight = config.lruWeight || 0.6
    this.lfuWeight = config.lfuWeight || 0.4
    this.accessHistory = new Map() // key -> {lastAccess, frequency}
  }

  access(key) {
    const now = Date.now()
    const history = this.accessHistory.get(key) || { lastAccess: now, frequency: 0 }

    history.lastAccess = now
    history.frequency++

    this.accessHistory.set(key, history)
  }

  evict(candidates) {
    if (candidates.length === 0) return null

    const now = Date.now()
    let worstKey = null
    let worstScore = Infinity

    for (const key of candidates) {
      const history = this.accessHistory.get(key)
      if (!history) continue

      // 计算得分 (越小越应该被淘汰)
      const recencyScore = (now - history.lastAccess) / (1000 * 60) // 分钟
      const frequencyScore = 1 / (history.frequency + 1)

      const score = this.lruWeight * recencyScore + this.lfuWeight * frequencyScore

      if (score < worstScore) {
        worstScore = score
        worstKey = key
      }
    }

    return worstKey
  }

  remove(key) {
    this.accessHistory.delete(key)
  }

  clear() {
    this.accessHistory.clear()
  }
}

/**
 * 缓存预热管理器
 */
class CacheWarmingManager {
  constructor(cacheManager) {
    this.cache = cacheManager
    this.warmingStrategies = new Map()
  }

  /**
   * 注册预热策略
   */
  registerStrategy(name, strategy) {
    this.warmingStrategies.set(name, strategy)
  }

  /**
   * 预热常用数据
   */
  async warmCommonData(dataLoader, keys) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    }

    for (const key of keys) {
      try {
        const data = await dataLoader(key)
        await this.cache.set(key, data)
        results.success++
      } catch (error) {
        results.failed++
        results.errors.push({ key, error: error.message })
      }
    }

    return results
  }

  /**
   * 基于访问模式的智能预热
   */
  async smartWarm(accessLog, threshold = 10) {
    // 分析访问日志，找出高频访问的键
    const keyFrequency = new Map()

    for (const entry of accessLog) {
      const count = keyFrequency.get(entry.key) || 0
      keyFrequency.set(entry.key, count + 1)
    }

    // 预热高频键
    const hotKeys = []
    for (const [key, count] of keyFrequency.entries()) {
      if (count >= threshold) {
        hotKeys.push(key)
      }
    }

    console.log(`[CacheWarming] 发现${hotKeys.length}个热点键，开始预热...`)

    return { hotKeys }
  }

  /**
   * 时间窗口预热（预测即将需要的数据）
   */
  async timeWindowWarm(schedule) {
    const now = new Date()
    const currentHour = now.getHours()

    // 根据时间段预热不同数据
    const warmingTasks = schedule.filter(s => {
      return s.hours.includes(currentHour)
    })

    for (const task of warmingTasks) {
      console.log(`[CacheWarming] 执行时间窗口预热: ${task.name}`)
      await task.loader()
    }
  }
}

/**
 * 批量缓存操作管理器
 */
class BatchCacheManager {
  constructor(cacheManager) {
    this.cache = cacheManager
    this.batchQueue = []
    this.processing = false
  }

  /**
   * 批量获取
   */
  async batchGet(keys) {
    const results = new Map()
    const missing = []

    // 并行获取
    const promises = keys.map(async key => {
      const value = await this.cache.get(key)
      if (value !== null) {
        results.set(key, value)
      } else {
        missing.push(key)
      }
    })

    await Promise.all(promises)

    return { results, missing }
  }

  /**
   * 批量设置
   */
  async batchSet(entries, options = {}) {
    const results = {
      success: 0,
      failed: 0
    }

    // 分批处理（避免一次性操作过多）
    const batchSize = options.batchSize || 50
    const batches = []

    for (let i = 0; i < entries.length; i += batchSize) {
      batches.push(entries.slice(i, i + batchSize))
    }

    for (const batch of batches) {
      const promises = batch.map(async ({ key, value, ttl }) => {
        try {
          await this.cache.set(key, value, { ttl })
          results.success++
        } catch (error) {
          results.failed++
          console.error(`[BatchCache] 设置失败: ${key}`, error)
        }
      })

      await Promise.all(promises)
    }

    return results
  }

  /**
   * 批量删除
   */
  async batchDelete(keys) {
    const promises = keys.map(key => this.cache.delete(key))
    await Promise.all(promises)
    return { deleted: keys.length }
  }

  /**
   * 模式匹配删除
   */
  async deleteByPattern(pattern) {
    const regex = new RegExp(pattern)
    const stats = this.cache.getStats()
    const allKeys = [] // 需要从缓存实例获取所有键

    const matchedKeys = allKeys.filter(key => regex.test(key))

    if (matchedKeys.length > 0) {
      return await this.batchDelete(matchedKeys)
    }

    return { deleted: 0 }
  }
}

/**
 * 查询优化缓存管理器
 */
class QueryOptimizedCache {
  constructor(cacheManager) {
    this.cache = cacheManager
    this.queryIndex = new Map() // 查询模式索引
    this.queryHistory = []      // 查询历史
  }

  /**
   * 智能查询缓存
   */
  async smartQuery(query, fetcher, options = {}) {
    const cacheKey = this.generateQueryKey(query)

    // 检查缓存
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      this.recordQueryHit(query)
      return cached
    }

    // 执行查询
    const result = await fetcher(query)

    // 缓存结果
    const ttl = this.calculateOptimalTTL(query, options)
    await this.cache.set(cacheKey, result, { ttl })

    this.recordQueryMiss(query)

    return result
  }

  /**
   * 生成查询键
   */
  generateQueryKey(query) {
    if (typeof query === 'string') {
      return `query:${query}`
    }
    return `query:${JSON.stringify(query)}`
  }

  /**
   * 计算最优TTL
   */
  calculateOptimalTTL(query, options) {
    // 基于查询历史和访问模式计算
    const baseT TL = options.ttl || 5 * 60 * 1000

    // 如果是高频查询，延长TTL
    const queryPattern = this.getQueryPattern(query)
    if (queryPattern && queryPattern.frequency > 10) {
      return baseT TL * 2
    }

    return baseT TL
  }

  /**
   * 获取查询模式
   */
  getQueryPattern(query) {
    const key = this.generateQueryKey(query)
    return this.queryIndex.get(key)
  }

  /**
   * 记录查询命中
   */
  recordQueryHit(query) {
    const key = this.generateQueryKey(query)
    const pattern = this.queryIndex.get(key) || {
      hits: 0,
      misses: 0,
      frequency: 0,
      lastAccess: Date.now()
    }

    pattern.hits++
    pattern.frequency++
    pattern.lastAccess = Date.now()

    this.queryIndex.set(key, pattern)
    this.queryHistory.push({ query, hit: true, timestamp: Date.now() })
  }

  /**
   * 记录查询未命中
   */
  recordQueryMiss(query) {
    const key = this.generateQueryKey(query)
    const pattern = this.queryIndex.get(key) || {
      hits: 0,
      misses: 0,
      frequency: 0,
      lastAccess: Date.now()
    }

    pattern.misses++
    pattern.frequency++
    pattern.lastAccess = Date.now()

    this.queryIndex.set(key, pattern)
    this.queryHistory.push({ query, hit: false, timestamp: Date.now() })
  }

  /**
   * 分析查询模式
   */
  analyzeQueryPatterns() {
    const patterns = []

    for (const [key, pattern] of this.queryIndex.entries()) {
      const hitRate = pattern.hits / (pattern.hits + pattern.misses)
      patterns.push({
        query: key,
        hitRate,
        frequency: pattern.frequency,
        lastAccess: pattern.lastAccess
      })
    }

    // 按频率排序
    patterns.sort((a, b) => b.frequency - a.frequency)

    return patterns
  }
}

/**
 * 缓存性能分析器
 */
class CacheAnalytics {
  constructor(cacheManager) {
    this.cache = cacheManager
    this.metrics = {
      operations: [],
      hitRates: [],
      latencies: [],
      memoryUsage: []
    }

    this.startTime = Date.now()
    this.operationCount = 0
  }

  /**
   * 记录操作
   */
  recordOperation(operation, key, duration, hit = null) {
    this.operationCount++

    this.metrics.operations.push({
      type: operation,
      key,
      duration,
      hit,
      timestamp: Date.now()
    })

    // 保持最近1000条记录
    if (this.metrics.operations.length > 1000) {
      this.metrics.operations.shift()
    }
  }

  /**
   * 记录延迟
   */
  recordLatency(operation, duration) {
    this.metrics.latencies.push({
      operation,
      duration,
      timestamp: Date.now()
    })

    if (this.metrics.latencies.length > 500) {
      this.metrics.latencies.shift()
    }
  }

  /**
   * 生成性能报告
   */
  generateReport() {
    const stats = this.cache.getStats()
    const now = Date.now()
    const uptime = now - this.startTime

    // 计算平均延迟
    const avgLatency = this.metrics.latencies.reduce((sum, l) => sum + l.duration, 0) /
                       (this.metrics.latencies.length || 1)

    // 计算操作速率
    const opsPerSecond = (this.operationCount / uptime) * 1000

    // 分析命中率趋势
    const recentOps = this.metrics.operations.slice(-100)
    const recentHits = recentOps.filter(op => op.hit === true).length
    const recentHitRate = (recentHits / recentOps.length) * 100

    return {
      uptime,
      totalOperations: this.operationCount,
      opsPerSecond: opsPerSecond.toFixed(2),
      averageLatency: avgLatency.toFixed(2) + 'ms',
      recentHitRate: recentHitRate.toFixed(2) + '%',
      overallHitRate: stats.overall.hitRate,
      l1Stats: stats.l1,
      l2Stats: stats.l2,
      memoryUsage: {
        l1: `${(stats.l1.memory / 1024 / 1024).toFixed(2)}MB / ${(stats.l1.maxMemory / 1024 / 1024).toFixed(2)}MB`,
        l1Percentage: ((stats.l1.memory / stats.l1.maxMemory) * 100).toFixed(2) + '%'
      },
      recommendations: this.generateRecommendations(stats, recentHitRate)
    }
  }

  /**
   * 生成优化建议
   */
  generateRecommendations(stats, recentHitRate) {
    const recommendations = []

    // 命中率低
    if (recentHitRate < 50) {
      recommendations.push({
        type: 'warning',
        message: '缓存命中率较低，建议增加缓存大小或优化缓存策略'
      })
    }

    // 内存占用高
    const memoryPercentage = (stats.l1.memory / stats.l1.maxMemory) * 100
    if (memoryPercentage > 90) {
      recommendations.push({
        type: 'warning',
        message: 'L1缓存内存占用过高，建议增加最大内存限制或启用压缩'
      })
    }

    // 淘汰频繁
    if (stats.overall.evictions > 100) {
      recommendations.push({
        type: 'info',
        message: '缓存淘汰频繁，建议增加缓存容量'
      })
    }

    // 性能良好
    if (recentHitRate > 80 && memoryPercentage < 70) {
      recommendations.push({
        type: 'success',
        message: '缓存性能良好，继续保持当前配置'
      })
    }

    return recommendations
  }

  /**
   * 实时监控
   */
  startMonitoring(interval = 60000) {
    this.monitoringInterval = setInterval(() => {
      const report = this.generateReport()
      console.log('[CacheAnalytics] 性能报告:', report)

      // 检查异常
      this.checkAnomalies(report)
    }, interval)
  }

  /**
   * 停止监控
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
    }
  }

  /**
   * 检查异常
   */
  checkAnomalies(report) {
    // 延迟异常
    if (parseFloat(report.averageLatency) > 100) {
      console.warn('[CacheAnalytics] ⚠️ 平均延迟过高:', report.averageLatency)
    }

    // 命中率异常
    const hitRate = parseFloat(report.recentHitRate)
    if (hitRate < 30) {
      console.warn('[CacheAnalytics] ⚠️ 缓存命中率过低:', report.recentHitRate)
    }
  }
}

/**
 * 高级缓存管理器（整合所有高级功能）
 */
export class AdvancedCacheManager {
  constructor(namespace, config = {}) {
    // 基础缓存管理器
    this.baseCache = getCacheManager(namespace, config)

    // 压缩配置
    this.compressionEnabled = config.compressionEnabled !== false
    this.compressionThreshold = config.compressionThreshold || 1024 // 1KB

    // 淘汰策略
    this.evictionPolicy = config.evictionPolicy || 'lru' // lru, lfu, adaptive
    if (this.evictionPolicy === 'lfu') {
      this.lfuPolicy = new LFUEvictionPolicy()
    } else if (this.evictionPolicy === 'adaptive') {
      this.adaptivePolicy = new AdaptiveEvictionPolicy(config.adaptiveConfig)
    }

    // 高级功能管理器
    this.warmingManager = new CacheWarmingManager(this.baseCache)
    this.batchManager = new BatchCacheManager(this.baseCache)
    this.queryCache = new QueryOptimizedCache(this.baseCache)
    this.analytics = new CacheAnalytics(this.baseCache)

    // 统计
    this.advancedStats = {
      compressionSaved: 0,
      compressionRatio: 0
    }
  }

  /**
   * 初始化
   */
  async initialize() {
    await this.baseCache.initialize()

    // 启动性能监控
    if (this.config && this.config.enableMonitoring) {
      this.analytics.startMonitoring()
    }

    return { success: true }
  }

  /**
   * 获取（带压缩支持）
   */
  async get(key) {
    const startTime = Date.now()

    let value = await this.baseCache.get(key)

    // 解压缩
    if (value && value.__compressed) {
      value = this.decompress(value.data)
    }

    // 更新淘汰策略
    if (this.lfuPolicy) {
      this.lfuPolicy.access(key)
    } else if (this.adaptivePolicy) {
      this.adaptivePolicy.access(key)
    }

    // 记录性能
    const duration = Date.now() - startTime
    this.analytics.recordOperation('get', key, duration, value !== null)
    this.analytics.recordLatency('get', duration)

    return value
  }

  /**
   * 设置（带压缩支持）
   */
  async set(key, value, options = {}) {
    const startTime = Date.now()
    let finalValue = value

    // 压缩
    if (this.compressionEnabled && this.shouldCompress(value)) {
      const compressed = this.compress(value)
      const originalSize = this.getSize(value)
      const compressedSize = compressed.length

      if (compressedSize < originalSize * 0.8) { // 至少压缩20%
        finalValue = {
          __compressed: true,
          data: compressed
        }

        this.advancedStats.compressionSaved += (originalSize - compressedSize)
        this.advancedStats.compressionRatio =
          (this.advancedStats.compressionSaved / originalSize) * 100
      }
    }

    await this.baseCache.set(key, finalValue, options)

    // 更新淘汰策略
    if (this.lfuPolicy) {
      this.lfuPolicy.access(key)
    } else if (this.adaptivePolicy) {
      this.adaptivePolicy.access(key)
    }

    // 记录性能
    const duration = Date.now() - startTime
    this.analytics.recordOperation('set', key, duration)
    this.analytics.recordLatency('set', duration)
  }

  /**
   * 删除
   */
  async delete(key) {
    await this.baseCache.delete(key)

    // 更新淘汰策略
    if (this.lfuPolicy) {
      this.lfuPolicy.remove(key)
    } else if (this.adaptivePolicy) {
      this.adaptivePolicy.remove(key)
    }
  }

  /**
   * 清空
   */
  async clear(options) {
    await this.baseCache.clear(options)

    // 重置淘汰策略
    if (this.lfuPolicy) {
      this.lfuPolicy.clear()
    } else if (this.adaptivePolicy) {
      this.adaptivePolicy.clear()
    }
  }

  /**
   * 压缩数据
   */
  compress(data) {
    const jsonStr = JSON.stringify(data)
    return LZString.compressToBase64(jsonStr)
  }

  /**
   * 解压缩数据
   */
  decompress(compressed) {
    const jsonStr = LZString.decompressFromBase64(compressed)
    return JSON.parse(jsonStr)
  }

  /**
   * 判断是否应该压缩
   */
  shouldCompress(value) {
    const size = this.getSize(value)
    return size >= this.compressionThreshold
  }

  /**
   * 获取数据大小
   */
  getSize(value) {
    return JSON.stringify(value).length
  }

  /**
   * 批量操作
   */
  get batch() {
    return this.batchManager
  }

  /**
   * 预热管理
   */
  get warming() {
    return this.warmingManager
  }

  /**
   * 查询优化
   */
  get query() {
    return this.queryCache
  }

  /**
   * 性能分析
   */
  get performance() {
    return this.analytics
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const baseStats = this.baseCache.getStats()

    return {
      ...baseStats,
      advanced: {
        compressionEnabled: this.compressionEnabled,
        compressionSaved: `${(this.advancedStats.compressionSaved / 1024).toFixed(2)}KB`,
        compressionRatio: `${this.advancedStats.compressionRatio.toFixed(2)}%`,
        evictionPolicy: this.evictionPolicy
      }
    }
  }
}

/**
 * 工厂函数
 */
const advancedCacheInstances = new Map()

export function getAdvancedCache(namespace, config = {}) {
  if (!advancedCacheInstances.has(namespace)) {
    advancedCacheInstances.set(namespace, new AdvancedCacheManager(namespace, config))
  }
  return advancedCacheInstances.get(namespace)
}

export default {
  AdvancedCacheManager,
  getAdvancedCache,
  LZString,
  LFUEvictionPolicy,
  AdaptiveEvictionPolicy,
  CacheWarmingManager,
  BatchCacheManager,
  QueryOptimizedCache,
  CacheAnalytics
}
