/**
 * 远程控制系统性能配置
 *
 * 集中管理性能相关的配置参数
 *
 * @module remote/logging/performance-config
 */

/**
 * 性能配置
 */
const PerformanceConfig = {
  // ==================== 日志批处理配置 ====================
  logging: {
    // 批处理设置
    batchSize: 50, // 批量写入的日志数量
    batchInterval: 1000, // 批处理间隔（毫秒）
    maxBatchWait: 5000, // 最大等待时间（毫秒）

    // 日志保留
    maxLogAge: 30 * 24 * 60 * 60 * 1000, // 30 天
    maxLogCount: 100000, // 最多保留 10 万条

    // 自动清理
    autoCleanupInterval: 24 * 60 * 60 * 1000, // 24 小时
    enableAutoCleanup: true
  },

  // ==================== 统计聚合配置 ====================
  statistics: {
    // 聚合设置
    aggregationInterval: 5 * 60 * 1000, // 5 分钟聚合一次
    enableAsyncAggregation: true, // 启用异步聚合

    // 实时统计
    realTimeStatsInterval: 1000, // 实时统计更新间隔（毫秒）

    // 缓存设置
    enableCache: true,
    cacheTTL: 60 * 1000, // 缓存有效期 60 秒

    // 数据保留
    maxStatsAge: 90 * 24 * 60 * 60 * 1000 // 90 天
  },

  // ==================== 数据库优化配置 ====================
  database: {
    // 连接池
    poolSize: 5,

    // 写入优化
    enableWAL: true, // Write-Ahead Logging
    synchronous: 'NORMAL', // 同步模式: OFF, NORMAL, FULL
    journalMode: 'WAL', // 日志模式

    // 缓存
    cacheSize: 10000, // 页面缓存大小（页数）

    // 批量操作
    useBatchInsert: true,
    batchCommitSize: 100
  },

  // ==================== Android 端优化配置 ====================
  android: {
    // Paging 配置
    paging: {
      pageSize: 20,
      prefetchDistance: 10,
      maxSize: 200,
      enablePlaceholders: false
    },

    // 图片缓存
    imageCache: {
      maxMemorySize: 50 * 1024 * 1024, // 50 MB
      maxDiskSize: 200 * 1024 * 1024, // 200 MB
      compressionQuality: 85 // 85%
    },

    // Compose 优化
    compose: {
      enableStabilityAnnotations: true,
      enableSkipping: true
    },

    // 数据库优化
    room: {
      enableMultiInstanceInvalidation: false,
      enableAutoMigration: true,
      journalMode: 'WAL'
    }
  },

  // ==================== 网络优化配置 ====================
  network: {
    // WebRTC 优化
    webrtc: {
      enableCompression: true,
      compressionLevel: 6, // 0-9
      maxMessageSize: 256 * 1024, // 256 KB
      chunkSize: 16 * 1024 // 16 KB 分块传输
    },

    // 心跳配置
    heartbeat: {
      interval: 30 * 1000, // 30 秒
      timeout: 10 * 1000, // 10 秒超时
      maxRetries: 3
    },

    // 重试策略
    retry: {
      maxRetries: 3,
      initialDelay: 1000, // 初始延迟 1 秒
      maxDelay: 10000, // 最大延迟 10 秒
      backoffMultiplier: 2, // 指数退避倍数
      enableJitter: true // 启用抖动
    },

    // 并发控制
    concurrency: {
      maxConcurrentCommands: 10,
      commandQueueSize: 100,
      enableThrottling: true,
      throttleInterval: 100 // 100ms 节流
    }
  },

  // ==================== 内存优化配置 ====================
  memory: {
    // 对象池
    enableObjectPool: true,
    objectPoolSize: 100,

    // 垃圾回收
    enableManualGC: false,
    gcInterval: 5 * 60 * 1000, // 5 分钟

    // 内存限制
    maxMemoryUsage: 512 * 1024 * 1024, // 512 MB
    warningThreshold: 0.8 // 80% 警告
  },

  // ==================== 监控配置 ====================
  monitoring: {
    // 性能监控
    enablePerformanceMonitoring: true,
    metricsInterval: 60 * 1000, // 60 秒

    // 慢查询
    slowQueryThreshold: 1000, // 1 秒

    // 慢命令
    slowCommandThreshold: 5000 // 5 秒
  }
};

/**
 * 获取配置值
 * @param {string} path - 配置路径，如 'logging.batchSize'
 * @param {*} defaultValue - 默认值
 * @returns {*} 配置值
 */
function getConfig(path, defaultValue = undefined) {
  const keys = path.split('.');
  let value = PerformanceConfig;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }

  return value;
}

/**
 * 设置配置值
 * @param {string} path - 配置路径
 * @param {*} value - 配置值
 */
function setConfig(path, value) {
  const keys = path.split('.');
  let obj = PerformanceConfig;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in obj)) {
      obj[key] = {};
    }
    obj = obj[key];
  }

  obj[keys[keys.length - 1]] = value;
}

/**
 * 应用数据库优化设置
 * @param {Object} database - better-sqlite3 数据库实例
 */
function applyDatabaseOptimizations(database) {
  const config = PerformanceConfig.database;

  try {
    // 启用 WAL 模式
    if (config.enableWAL) {
      database.pragma(`journal_mode = ${config.journalMode}`);
    }

    // 设置同步模式
    database.pragma(`synchronous = ${config.synchronous}`);

    // 设置缓存大小
    database.pragma(`cache_size = ${config.cacheSize}`);

    // 设置临时存储为内存
    database.pragma('temp_store = MEMORY');

    // 启用内存映射 I/O
    database.pragma('mmap_size = 30000000000'); // 30 GB

    console.log('[PerformanceConfig] 数据库优化设置已应用');
  } catch (error) {
    console.error('[PerformanceConfig] 应用数据库优化失败:', error);
  }
}

/**
 * 获取性能配置摘要
 * @returns {Object} 配置摘要
 */
function getConfigSummary() {
  return {
    logging: {
      batchSize: PerformanceConfig.logging.batchSize,
      batchInterval: PerformanceConfig.logging.batchInterval
    },
    statistics: {
      aggregationInterval: PerformanceConfig.statistics.aggregationInterval,
      enableAsyncAggregation: PerformanceConfig.statistics.enableAsyncAggregation
    },
    database: {
      enableWAL: PerformanceConfig.database.enableWAL,
      synchronous: PerformanceConfig.database.synchronous
    },
    network: {
      enableCompression: PerformanceConfig.network.webrtc.enableCompression,
      heartbeatInterval: PerformanceConfig.network.heartbeat.interval
    }
  };
}

module.exports = {
  PerformanceConfig,
  getConfig,
  setConfig,
  applyDatabaseOptimizations,
  getConfigSummary
};
