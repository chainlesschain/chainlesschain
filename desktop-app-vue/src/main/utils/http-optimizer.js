/**
 * HTTP服务器性能优化模块
 * 优化请求处理、连接管理和响应速度
 */

const { logger, createLogger } = require('./logger.js');
const { EventEmitter } = require('events');

class HTTPServerOptimizer extends EventEmitter {
  constructor() {
    super();

    // 配置
    this.config = {
      // 连接池配置
      maxConnections: 100,
      connectionTimeout: 30000,
      keepAliveTimeout: 5000,

      // 请求限流
      rateLimit: {
        windowMs: 60000, // 1分钟
        maxRequests: 100, // 每分钟最多100个请求
      },

      // 缓存配置
      enableCache: true,
      cacheMaxAge: 300000, // 5分钟

      // 压缩配置
      enableCompression: true,
      compressionThreshold: 1024, // 1KB

      // 批处理配置
      batchSize: 10,
      batchTimeout: 1000,
    };

    // 连接池
    this.connections = new Map();
    this.activeConnections = 0;

    // 请求限流
    this.requestCounts = new Map();

    // 响应缓存
    this.responseCache = new Map();

    // 批处理队列
    this.batchQueue = [];
    this.batchTimer = null;

    // 性能指标
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      responseTimes: [],
      cacheHits: 0,
      rateLimitHits: 0,
    };
  }

  /**
   * 请求限流检查
   */
  checkRateLimit(clientId) {
    const now = Date.now();
    const windowStart = now - this.config.rateLimit.windowMs;

    // 清理过期记录
    if (this.requestCounts.has(clientId)) {
      const requests = this.requestCounts.get(clientId);
      const validRequests = requests.filter(time => time > windowStart);
      this.requestCounts.set(clientId, validRequests);
    } else {
      this.requestCounts.set(clientId, []);
    }

    const requests = this.requestCounts.get(clientId);

    // 检查是否超过限制
    if (requests.length >= this.config.rateLimit.maxRequests) {
      this.metrics.rateLimitHits++;
      return false;
    }

    // 记录请求
    requests.push(now);
    return true;
  }

  /**
   * 响应缓存
   */
  getCachedResponse(cacheKey) {
    if (!this.config.enableCache) {
      return null;
    }

    if (this.responseCache.has(cacheKey)) {
      const cached = this.responseCache.get(cacheKey);

      // 检查是否过期
      if (Date.now() - cached.timestamp < this.config.cacheMaxAge) {
        this.metrics.cacheHits++;
        return cached.response;
      } else {
        this.responseCache.delete(cacheKey);
      }
    }

    return null;
  }

  /**
   * 保存响应到缓存
   */
  cacheResponse(cacheKey, response) {
    if (!this.config.enableCache) {
      return;
    }

    this.responseCache.set(cacheKey, {
      response,
      timestamp: Date.now(),
    });

    // 限制缓存大小
    if (this.responseCache.size > 1000) {
      const firstKey = this.responseCache.keys().next().value;
      this.responseCache.delete(firstKey);
    }
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(method, path, body) {
    const bodyStr = body ? JSON.stringify(body) : '';
    return `${method}:${path}:${bodyStr}`;
  }

  /**
   * 响应压缩
   */
  async compressResponse(data) {
    if (!this.config.enableCompression) {
      return data;
    }

    const dataStr = JSON.stringify(data);

    // 只压缩大于阈值的响应
    if (dataStr.length < this.config.compressionThreshold) {
      return data;
    }

    try {
      const zlib = require('zlib');
      const compressed = await new Promise((resolve, reject) => {
        zlib.gzip(dataStr, (err, result) => {
          if (err) {reject(err);}
          else {resolve(result);}
        });
      });

      logger.info(`[HTTPOptimizer] 压缩: ${dataStr.length} -> ${compressed.length} bytes`);

      return {
        compressed: true,
        data: compressed.toString('base64'),
      };
    } catch (error) {
      logger.error('[HTTPOptimizer] 压缩失败:', error);
      return data;
    }
  }

  /**
   * 批处理请求
   */
  addToBatch(request) {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({
        request,
        resolve,
        reject,
      });

      // 如果达到批处理大小，立即处理
      if (this.batchQueue.length >= this.config.batchSize) {
        this.processBatch();
      } else {
        // 否则设置定时器
        if (!this.batchTimer) {
          this.batchTimer = setTimeout(() => {
            this.processBatch();
          }, this.config.batchTimeout);
        }
      }
    });
  }

  /**
   * 处理批处理队列
   */
  async processBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchQueue.length === 0) {
      return;
    }

    const batch = this.batchQueue.splice(0, this.config.batchSize);
    logger.info(`[HTTPOptimizer] 处理批次: ${batch.length} 个请求`);

    // 并行处理所有请求
    const results = await Promise.allSettled(
      batch.map(item => this.processRequest(item.request))
    );

    // 返回结果
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        batch[index].resolve(result.value);
      } else {
        batch[index].reject(result.reason);
      }
    });
  }

  /**
   * 处理单个请求（示例）
   */
  async processRequest(request) {
    // 实际处理逻辑
    return { success: true, data: request };
  }

  /**
   * 连接池管理
   */
  acquireConnection(clientId) {
    // 检查连接数限制
    if (this.activeConnections >= this.config.maxConnections) {
      throw new Error('连接池已满');
    }

    // 创建或复用连接
    if (!this.connections.has(clientId)) {
      this.connections.set(clientId, {
        id: clientId,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      });
      this.activeConnections++;
    } else {
      const conn = this.connections.get(clientId);
      conn.lastUsed = Date.now();
    }

    return this.connections.get(clientId);
  }

  /**
   * 释放连接
   */
  releaseConnection(clientId) {
    if (this.connections.has(clientId)) {
      this.connections.delete(clientId);
      this.activeConnections--;
    }
  }

  /**
   * 清理空闲连接
   */
  cleanupIdleConnections() {
    const now = Date.now();
    const timeout = this.config.keepAliveTimeout;

    for (const [clientId, conn] of this.connections.entries()) {
      if (now - conn.lastUsed > timeout) {
        this.releaseConnection(clientId);
      }
    }
  }

  /**
   * 记录请求时间
   */
  recordRequestTime(time, success = true) {
    this.metrics.totalRequests++;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    this.metrics.responseTimes.push(time);

    // 只保留最近1000次
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes.shift();
    }

    // 计算平均时间
    const sum = this.metrics.responseTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageResponseTime = sum / this.metrics.responseTimes.length;
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    const successRate = this.metrics.totalRequests > 0
      ? (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2)
      : 0;

    const cacheHitRate = this.metrics.totalRequests > 0
      ? (this.metrics.cacheHits / this.metrics.totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.metrics,
      successRate: `${successRate}%`,
      cacheHitRate: `${cacheHitRate}%`,
      activeConnections: this.activeConnections,
      cacheSize: this.responseCache.size,
      queueSize: this.batchQueue.length,
    };
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.responseCache.clear();
    logger.info('[HTTPOptimizer] 缓存已清理');
  }

  /**
   * 重置指标
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      responseTimes: [],
      cacheHits: 0,
      rateLimitHits: 0,
    };
  }
}

// 导出单例
const httpOptimizer = new HTTPServerOptimizer();

// 定期清理空闲连接（每30秒）
setInterval(() => {
  httpOptimizer.cleanupIdleConnections();
}, 30000);

module.exports = httpOptimizer;
