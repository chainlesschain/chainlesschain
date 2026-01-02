/**
 * 重试管理器 (移动端版本)
 *
 * 功能:
 * - 指数退避重试
 * - 自定义重试策略
 * - 错误分类
 * - 断路器模式
 * - 请求去重
 */

/**
 * 重试管理器类
 */
class RetryManager {
  constructor(config = {}) {
    this.config = {
      // 最大重试次数
      maxRetries: config.maxRetries || 3,

      // 初始延迟（ms）
      initialDelay: config.initialDelay || 1000,

      // 最大延迟（ms）
      maxDelay: config.maxDelay || 30000,

      // 退避倍数
      backoffMultiplier: config.backoffMultiplier || 2,

      // 抖动系数（0-1）
      jitterFactor: config.jitterFactor || 0.1,

      // 是否启用断路器
      enableCircuitBreaker: config.enableCircuitBreaker !== false,

      // 断路器失败阈值
      circuitBreakerThreshold: config.circuitBreakerThreshold || 5,

      // 断路器恢复时间（ms）
      circuitBreakerTimeout: config.circuitBreakerTimeout || 60000,

      ...config
    }

    // 断路器状态
    this.circuitBreakers = new Map()

    // 请求去重
    this.pendingRequests = new Map()

    // 统计
    this.stats = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      circuitBreakerTrips: 0
    }

    // 事件监听器
    this.listeners = new Map()
  }

  /**
   * 执行带重试的操作
   * @param {Function} operation - 要执行的操作
   * @param {Object} options - 选项
   * @returns {Promise<any>}
   */
  async execute(operation, options = {}) {
    const {
      key = null, // 用于断路器和去重
      maxRetries = this.config.maxRetries,
      shouldRetry = this.defaultShouldRetry,
      onRetry = null
    } = options

    // 检查断路器
    if (key && this.isCircuitBreakerOpen(key)) {
      throw new Error(`Circuit breaker is open for: ${key}`)
    }

    // 请求去重
    if (key && this.pendingRequests.has(key)) {
      console.log('[RetryManager] 复用pending请求:', key)
      return await this.pendingRequests.get(key)
    }

    // 创建执行promise
    const executionPromise = this.executeWithRetry(
      operation,
      {
        key,
        maxRetries,
        shouldRetry,
        onRetry
      }
    )

    // 记录pending请求
    if (key) {
      this.pendingRequests.set(key, executionPromise)

      // 完成后清理
      executionPromise.finally(() => {
        this.pendingRequests.delete(key)
      })
    }

    return await executionPromise
  }

  /**
   * 执行带重试的操作（内部方法）
   * @param {Function} operation - 操作
   * @param {Object} options - 选项
   * @returns {Promise<any>}
   * @private
   */
  async executeWithRetry(operation, options) {
    const { key, maxRetries, shouldRetry, onRetry } = options

    let lastError = null
    let attempt = 0

    while (attempt <= maxRetries) {
      this.stats.totalAttempts++

      try {
        if (attempt > 0) {
          console.log(`[RetryManager] 重试 ${attempt}/${maxRetries}${key ? ` (${key})` : ''}`)

          this.emit('retry-attempt', {
            key,
            attempt,
            maxRetries
          })

          if (onRetry) {
            onRetry(attempt, lastError)
          }
        }

        // 执行操作
        const result = await operation()

        // 成功
        if (attempt > 0) {
          this.stats.successfulRetries++

          console.log('[RetryManager] ✅ 重试成功')

          this.emit('retry-success', {
            key,
            attempt,
            result
          })
        }

        // 重置断路器
        if (key) {
          this.resetCircuitBreaker(key)
        }

        return result
      } catch (error) {
        lastError = error

        console.error(`[RetryManager] 尝试 ${attempt + 1} 失败:`, error.message)

        // 检查是否应该重试
        if (!shouldRetry(error, attempt)) {
          console.log('[RetryManager] 不应重试，直接抛出错误')
          break
        }

        // 最后一次尝试失败
        if (attempt >= maxRetries) {
          break
        }

        // 计算延迟
        const delay = this.calculateDelay(attempt)

        console.log(`[RetryManager] 等待 ${delay}ms 后重试...`)

        // 延迟
        await this.delay(delay)

        attempt++
      }
    }

    // 所有重试都失败
    this.stats.failedRetries++

    // 触发断路器
    if (key) {
      this.tripCircuitBreaker(key)
    }

    console.error('[RetryManager] ❌ 所有重试都失败')

    this.emit('retry-failed', {
      key,
      attempts: attempt + 1,
      error: lastError
    })

    throw lastError
  }

  /**
   * 计算重试延迟（指数退避 + 抖动）
   * @param {number} attempt - 尝试次数
   * @returns {number}
   * @private
   */
  calculateDelay(attempt) {
    // 指数退避
    const exponentialDelay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt),
      this.config.maxDelay
    )

    // 添加抖动
    const jitter = exponentialDelay * this.config.jitterFactor * (Math.random() - 0.5) * 2

    return Math.max(0, Math.round(exponentialDelay + jitter))
  }

  /**
   * 默认重试策略
   * @param {Error} error - 错误对象
   * @param {number} attempt - 尝试次数
   * @returns {boolean}
   * @private
   */
  defaultShouldRetry(error, attempt) {
    // 网络错误应该重试
    if (error.message.includes('网络') || error.message.includes('timeout')) {
      return true
    }

    // 5xx服务器错误应该重试
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return true
    }

    // 429限流应该重试
    if (error.statusCode === 429) {
      return true
    }

    // 4xx客户端错误不应该重试
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false
    }

    // 默认不重试
    return false
  }

  /**
   * 检查断路器是否打开
   * @param {string} key - 断路器键
   * @returns {boolean}
   * @private
   */
  isCircuitBreakerOpen(key) {
    if (!this.config.enableCircuitBreaker) {
      return false
    }

    const breaker = this.circuitBreakers.get(key)
    if (!breaker) {
      return false
    }

    // 检查是否到恢复时间
    if (Date.now() - breaker.openedAt > this.config.circuitBreakerTimeout) {
      console.log('[RetryManager] 断路器恢复:', key)
      this.resetCircuitBreaker(key)
      return false
    }

    return breaker.isOpen
  }

  /**
   * 触发断路器
   * @param {string} key - 断路器键
   * @private
   */
  tripCircuitBreaker(key) {
    if (!this.config.enableCircuitBreaker) {
      return
    }

    const breaker = this.circuitBreakers.get(key) || {
      failureCount: 0,
      isOpen: false
    }

    breaker.failureCount++

    if (breaker.failureCount >= this.config.circuitBreakerThreshold) {
      breaker.isOpen = true
      breaker.openedAt = Date.now()

      this.stats.circuitBreakerTrips++

      console.warn('[RetryManager] ⚡ 断路器打开:', key)

      this.emit('circuit-breaker-open', { key })
    }

    this.circuitBreakers.set(key, breaker)
  }

  /**
   * 重置断路器
   * @param {string} key - 断路器键
   * @private
   */
  resetCircuitBreaker(key) {
    if (!this.config.enableCircuitBreaker) {
      return
    }

    const breaker = this.circuitBreakers.get(key)
    if (breaker && breaker.isOpen) {
      console.log('[RetryManager] 断路器关闭:', key)

      this.emit('circuit-breaker-close', { key })
    }

    this.circuitBreakers.set(key, {
      failureCount: 0,
      isOpen: false
    })
  }

  /**
   * 延迟
   * @param {number} ms - 毫秒
   * @returns {Promise<void>}
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 批量执行（带并发控制）
   * @param {Array<Function>} operations - 操作列表
   * @param {Object} options - 选项
   * @returns {Promise<Array>}
   */
  async executeBatch(operations, options = {}) {
    const { concurrency = 3, stopOnError = false } = options

    const results = []
    const errors = []

    // 分批执行
    for (let i = 0; i < operations.length; i += concurrency) {
      const batch = operations.slice(i, i + concurrency)

      const batchResults = await Promise.allSettled(
        batch.map(op => this.execute(op, options))
      )

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          errors.push(result.reason)

          if (stopOnError) {
            throw result.reason
          }
        }
      }
    }

    return {
      results,
      errors,
      successCount: results.length,
      failureCount: errors.length
    }
  }

  /**
   * 获取断路器状态
   * @param {string} key - 断路器键
   * @returns {Object}
   */
  getCircuitBreakerStatus(key) {
    const breaker = this.circuitBreakers.get(key)

    if (!breaker) {
      return {
        exists: false,
        isOpen: false,
        failureCount: 0
      }
    }

    return {
      exists: true,
      isOpen: breaker.isOpen,
      failureCount: breaker.failureCount,
      openedAt: breaker.openedAt,
      remainingTime: breaker.isOpen
        ? Math.max(0, this.config.circuitBreakerTimeout - (Date.now() - breaker.openedAt))
        : 0
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalAttempts: this.stats.totalAttempts,
      successfulRetries: this.stats.successfulRetries,
      failedRetries: this.stats.failedRetries,
      retryRate: this.stats.totalAttempts > 0
        ? (((this.stats.successfulRetries + this.stats.failedRetries) / this.stats.totalAttempts) * 100).toFixed(2) + '%'
        : '0%',
      circuitBreakerTrips: this.stats.circuitBreakerTrips,
      activeCircuitBreakers: Array.from(this.circuitBreakers.values()).filter(b => b.isOpen).length,
      pendingRequests: this.pendingRequests.size
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
        console.error('[RetryManager] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.circuitBreakers.clear()
    this.pendingRequests.clear()
    console.log('[RetryManager] 资源已清理')
  }
}

// 创建单例
let retryManagerInstance = null

/**
 * 获取重试管理器实例
 * @param {Object} config - 配置
 * @returns {RetryManager}
 */
export function getRetryManager(config) {
  if (!retryManagerInstance) {
    retryManagerInstance = new RetryManager(config)
  }
  return retryManagerInstance
}

export default RetryManager
