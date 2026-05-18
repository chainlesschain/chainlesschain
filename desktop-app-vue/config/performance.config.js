/**
 * 性能优化统一配置文件
 * 所有性能相关的参数都在这里集中管理
 *
 * 使用方式：
 * const { graphConfig, dbConfig, p2pConfig } = require('./config/performance.config');
 */

module.exports = {
  /**
   * 知识图谱渲染优化配置
   */
  graph: {
    // LOD (Level of Detail) 配置
    lod: {
      // 全量渲染阈值（节点数）
      maxNodesForFull: parseInt(process.env.GRAPH_LOD_FULL) || 200,

      // 简化渲染阈值（节点数）
      maxNodesForSimplified: parseInt(process.env.GRAPH_LOD_SIMPLIFIED) || 500,

      // 节点聚合阈值（节点数）
      clusterThreshold: parseInt(process.env.GRAPH_CLUSTER_THRESHOLD) || 1000,

      // 渐进加载块大小
      progressiveChunkSize: parseInt(process.env.GRAPH_PROGRESSIVE_CHUNK) || 100,
    },

    // 渲染配置
    rendering: {
      // 是否默认启用聚合
      enableClusteringByDefault: process.env.GRAPH_CLUSTERING === 'true' || false,

      // 是否默认启用渐进渲染
      enableProgressiveByDefault: process.env.GRAPH_PROGRESSIVE === 'true' || true,

      // 目标FPS
      targetFPS: parseInt(process.env.GRAPH_TARGET_FPS) || 30,

      // 最大渲染时间（毫秒）
      maxRenderTime: parseInt(process.env.GRAPH_MAX_RENDER_TIME) || 500,
    },

    // 力导向布局配置
    force: {
      // 节点排斥力（根据节点数量自动调整）
      repulsion: {
        small: 300,   // <200 节点
        medium: 200,  // 200-500 节点
        large: 150,   // >500 节点
      },

      // 边长度
      edgeLength: {
        small: 150,
        medium: 120,
        large: 100,
      },

      // 重力
      gravity: 0.1,

      // 摩擦力
      friction: 0.6,

      // 是否启用布局动画（大图关闭）
      animationThreshold: 300,
    },

    // 性能监控
    monitoring: {
      // 是否显示性能统计
      showStats: process.env.GRAPH_SHOW_STATS === 'true' || true,

      // FPS监控间隔（毫秒）
      fpsMonitorInterval: 1000,

      // 是否记录性能日志
      enableLogging: process.env.GRAPH_PERF_LOGGING === 'true' || false,
    },
  },

  /**
   * 数据库查询优化配置
   */
  database: {
    // 查询优化
    query: {
      // 默认查询限制
      defaultLimit: parseInt(process.env.DB_DEFAULT_LIMIT) || 100,

      // 最大查询限制
      maxLimit: parseInt(process.env.DB_MAX_LIMIT) || 1000,

      // 是否启用查询缓存
      enableCache: process.env.DB_ENABLE_CACHE !== 'false',

      // 缓存过期时间（毫秒）
      cacheExpiry: parseInt(process.env.DB_CACHE_EXPIRY) || 300000, // 5分钟

      // 缓存最大条目数
      maxCacheSize: parseInt(process.env.DB_MAX_CACHE_SIZE) || 100,
    },

    // 分页配置
    pagination: {
      // 默认每页数量
      defaultPageSize: parseInt(process.env.DB_PAGE_SIZE) || 50,

      // 消息分页大小
      messagesPageSize: parseInt(process.env.DB_MESSAGES_PAGE_SIZE) || 50,

      // 图谱分页大小
      graphPageSize: parseInt(process.env.DB_GRAPH_PAGE_SIZE) || 500,
    },

    // 索引优化
    indexes: {
      // 是否启用自动索引优化
      autoOptimize: process.env.DB_AUTO_OPTIMIZE === 'true' || false,

      // 自动ANALYZE间隔（毫秒）
      analyzeInterval: parseInt(process.env.DB_ANALYZE_INTERVAL) || 3600000, // 1小时

      // 自动VACUUM间隔（毫秒）
      vacuumInterval: parseInt(process.env.DB_VACUUM_INTERVAL) || 86400000, // 24小时
    },

    // 性能监控
    monitoring: {
      // 是否启用慢查询日志
      enableSlowQueryLog: process.env.DB_SLOW_QUERY_LOG === 'true' || true,

      // 慢查询阈值（毫秒）
      slowQueryThreshold: parseInt(process.env.DB_SLOW_QUERY_THRESHOLD) || 100,

      // 是否记录查询计划
      logQueryPlan: process.env.DB_LOG_QUERY_PLAN === 'true' || false,
    },
  },

  /**
   * P2P连接池优化配置
   */
  p2p: {
    // 连接池配置
    pool: {
      // 最大连接数
      maxConnections: parseInt(process.env.P2P_MAX_CONNECTIONS) || 100,

      // 最小保持连接数
      minConnections: parseInt(process.env.P2P_MIN_CONNECTIONS) || 10,

      // 最大空闲时间（毫秒）
      maxIdleTime: parseInt(process.env.P2P_MAX_IDLE_TIME) || 300000, // 5分钟

      // 连接超时（毫秒）
      connectionTimeout: parseInt(process.env.P2P_CONNECTION_TIMEOUT) || 30000, // 30秒

      // 最大重试次数
      maxRetries: parseInt(process.env.P2P_MAX_RETRIES) || 3,
    },

    // 健康检查配置
    healthCheck: {
      // 健康检查间隔（毫秒）
      interval: parseInt(process.env.P2P_HEALTH_CHECK_INTERVAL) || 60000, // 1分钟

      // 是否启用健康检查
      enabled: process.env.P2P_HEALTH_CHECK_ENABLED !== 'false',

      // 不健康连接关闭延迟（毫秒）
      closeDelay: parseInt(process.env.P2P_CLOSE_DELAY) || 5000,
    },

    // 自动清理配置
    cleanup: {
      // 清理间隔（毫秒）
      interval: parseInt(process.env.P2P_CLEANUP_INTERVAL) || 60000, // 1分钟

      // 是否启用自动清理
      enabled: process.env.P2P_CLEANUP_ENABLED !== 'false',

      // 清理策略
      strategy: process.env.P2P_CLEANUP_STRATEGY || 'lru', // lru, lfu, fifo
    },

    // 性能监控
    monitoring: {
      // 是否启用统计
      enableStats: process.env.P2P_ENABLE_STATS !== 'false',

      // 统计上报间隔（毫秒）
      statsInterval: parseInt(process.env.P2P_STATS_INTERVAL) || 300000, // 5分钟

      // 是否记录连接详情
      logConnectionDetails: process.env.P2P_LOG_DETAILS === 'true' || false,
    },
  },

  /**
   * 聊天历史加载优化配置
   */
  chat: {
    // 分页配置
    pagination: {
      // 默认每页消息数
      messagesPerPage: parseInt(process.env.CHAT_MESSAGES_PER_PAGE) || 50,

      // 初始加载消息数
      initialLoadCount: parseInt(process.env.CHAT_INITIAL_LOAD) || 30,

      // 预加载阈值（距离底部多少条时触发加载）
      preloadThreshold: parseInt(process.env.CHAT_PRELOAD_THRESHOLD) || 10,

      // 最大缓存消息数
      maxCachedMessages: parseInt(process.env.CHAT_MAX_CACHED) || 500,
    },

    // 加载策略
    loading: {
      // 是否启用虚拟滚动
      enableVirtualScroll: process.env.CHAT_VIRTUAL_SCROLL === 'true' || true,

      // 是否启用无限滚动
      enableInfiniteScroll: process.env.CHAT_INFINITE_SCROLL !== 'false',

      // 加载动画延迟（毫秒）
      loadingDelay: parseInt(process.env.CHAT_LOADING_DELAY) || 300,
    },

    // 性能优化
    optimization: {
      // 是否启用消息合并
      enableMessageMerge: process.env.CHAT_MESSAGE_MERGE === 'true' || true,

      // 消息合并时间窗口（毫秒）
      mergeWindow: parseInt(process.env.CHAT_MERGE_WINDOW) || 60000, // 1分钟

      // 是否启用懒加载图片
      lazyLoadImages: process.env.CHAT_LAZY_IMAGES !== 'false',
    },
  },

  /**
   * 全局性能配置
   */
  global: {
    // 是否启用性能模式
    performanceMode: process.env.PERFORMANCE_MODE === 'true' || false,

    // 性能模式等级（1-3，3最激进）
    performanceLevel: parseInt(process.env.PERFORMANCE_LEVEL) || 2,

    // 是否启用开发者工具
    devTools: process.env.ENABLE_DEV_TOOLS === 'true' || false,

    // 日志级别
    logLevel: process.env.LOG_LEVEL || 'info', // debug, info, warn, error

    // 是否启用性能追踪
    enableTracing: process.env.ENABLE_TRACING === 'true' || false,
  },
};
