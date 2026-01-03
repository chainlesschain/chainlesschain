/**
 * P2P连接池管理器
 * 优化P2P连接的生命周期管理、健康检查和资源复用
 */

const EventEmitter = require('events');

/**
 * 连接状态枚举
 */
const ConnectionState = {
  IDLE: 'idle',
  ACTIVE: 'active',
  CLOSING: 'closing',
  CLOSED: 'closed',
  ERROR: 'error',
};

/**
 * 连接包装类
 */
class Connection {
  constructor(peerId, connection, options = {}) {
    this.peerId = peerId;
    this.connection = connection;
    this.state = ConnectionState.IDLE;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.usageCount = 0;
    this.errorCount = 0;
    this.metadata = options.metadata || {};
  }

  /**
   * 标记连接为活跃状态
   */
  markActive() {
    this.state = ConnectionState.ACTIVE;
    this.lastActivity = Date.now();
    this.usageCount++;
  }

  /**
   * 标记连接为空闲状态
   */
  markIdle() {
    this.state = ConnectionState.IDLE;
    this.lastActivity = Date.now();
  }

  /**
   * 检查连接是否空闲
   */
  isIdle() {
    return this.state === ConnectionState.IDLE;
  }

  /**
   * 检查连接是否超时
   */
  isTimedOut(maxIdleTime) {
    return Date.now() - this.lastActivity > maxIdleTime;
  }

  /**
   * 检查连接是否健康
   */
  isHealthy() {
    return this.state !== ConnectionState.ERROR &&
           this.state !== ConnectionState.CLOSED &&
           this.errorCount < 3;
  }

  /**
   * 记录错误
   */
  recordError() {
    this.errorCount++;
    if (this.errorCount >= 3) {
      this.state = ConnectionState.ERROR;
    }
  }

  /**
   * 重置错误计数
   */
  resetErrors() {
    this.errorCount = 0;
  }
}

/**
 * P2P连接池管理器
 */
class ConnectionPool extends EventEmitter {
  constructor(options = {}) {
    super();

    // 配置选项
    this.maxConnections = options.maxConnections || 100;
    this.minConnections = options.minConnections || 10;
    this.maxIdleTime = options.maxIdleTime || 300000; // 5分钟
    this.healthCheckInterval = options.healthCheckInterval || 60000; // 1分钟
    this.connectionTimeout = options.connectionTimeout || 30000; // 30秒
    this.maxRetries = options.maxRetries || 3;

    // 连接存储
    this.connections = new Map(); // peerId -> Connection
    this.activeConnections = new Set(); // 活跃连接的peerId
    this.idleConnections = new Set(); // 空闲连接的peerId

    // 统计信息
    this.stats = {
      totalCreated: 0,
      totalClosed: 0,
      totalErrors: 0,
      currentActive: 0,
      currentIdle: 0,
      totalHits: 0, // 连接复用次数
      totalMisses: 0, // 新建连接次数
    };

    // 健康检查定时器
    this.healthCheckTimer = null;
    this.cleanupTimer = null;
  }

  /**
   * 初始化连接池
   */
  async initialize() {
    console.log('[ConnectionPool] 初始化连接池...');

    // 启动健康检查
    this.startHealthCheck();

    // 启动清理任务
    this.startCleanup();

    this.emit('initialized');
  }

  /**
   * 获取连接（支持连接复用）
   */
  async acquireConnection(peerId, createConnectionFn) {
    // 1. 尝试复用现有连接
    if (this.connections.has(peerId)) {
      const conn = this.connections.get(peerId);

      if (conn.isHealthy() && conn.isIdle()) {
        // 连接可用，复用
        conn.markActive();
        this.idleConnections.delete(peerId);
        this.activeConnections.add(peerId);
        this.stats.totalHits++;
        this.updateStats();

        console.log(`[ConnectionPool] 复用连接: ${peerId}`);
        return conn.connection;
      } else if (!conn.isHealthy()) {
        // 连接不健康，关闭并重建
        console.log(`[ConnectionPool] 连接不健康，重建: ${peerId}`);
        await this.closeConnection(peerId);
      }
    }

    // 2. 检查连接池容量
    if (this.connections.size >= this.maxConnections) {
      // 连接池已满，尝试清理空闲连接
      await this.evictIdleConnections(1);

      if (this.connections.size >= this.maxConnections) {
        throw new Error('连接池已满，无法创建新连接');
      }
    }

    // 3. 创建新连接
    try {
      console.log(`[ConnectionPool] 创建新连接: ${peerId}`);
      const connection = await this.createConnection(peerId, createConnectionFn);
      this.stats.totalMisses++;
      return connection;
    } catch (error) {
      this.stats.totalErrors++;
      console.error(`[ConnectionPool] 创建连接失败: ${peerId}`, error);
      throw error;
    }
  }

  /**
   * 创建新连接
   */
  async createConnection(peerId, createConnectionFn) {
    if (!createConnectionFn) {
      throw new Error('未提供连接创建函数');
    }

    // 设置超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('连接超时')), this.connectionTimeout);
    });

    try {
      // 执行连接创建（带超时）
      const connection = await Promise.race([
        createConnectionFn(peerId),
        timeoutPromise,
      ]);

      // 包装连接
      const conn = new Connection(peerId, connection);
      conn.markActive();

      // 存储连接
      this.connections.set(peerId, conn);
      this.activeConnections.add(peerId);
      this.stats.totalCreated++;
      this.updateStats();

      this.emit('connection:created', { peerId });

      return connection;
    } catch (error) {
      this.stats.totalErrors++;
      throw error;
    }
  }

  /**
   * 释放连接（标记为空闲，但不关闭）
   */
  releaseConnection(peerId) {
    const conn = this.connections.get(peerId);

    if (conn && conn.state === ConnectionState.ACTIVE) {
      conn.markIdle();
      this.activeConnections.delete(peerId);
      this.idleConnections.add(peerId);
      this.updateStats();

      console.log(`[ConnectionPool] 释放连接: ${peerId}`);
      this.emit('connection:released', { peerId });
    }
  }

  /**
   * 关闭连接
   */
  async closeConnection(peerId) {
    const conn = this.connections.get(peerId);

    if (!conn) return;

    try {
      conn.state = ConnectionState.CLOSING;

      // 关闭底层连接
      if (conn.connection && typeof conn.connection.close === 'function') {
        await conn.connection.close();
      }

      conn.state = ConnectionState.CLOSED;
    } catch (error) {
      console.error(`[ConnectionPool] 关闭连接失败: ${peerId}`, error);
      conn.state = ConnectionState.ERROR;
    } finally {
      // 从连接池移除
      this.connections.delete(peerId);
      this.activeConnections.delete(peerId);
      this.idleConnections.delete(peerId);
      this.stats.totalClosed++;
      this.updateStats();

      this.emit('connection:closed', { peerId });
    }
  }

  /**
   * 驱逐空闲连接
   */
  async evictIdleConnections(count = 1) {
    const idleConnections = Array.from(this.idleConnections);

    // 按最后活动时间排序（最旧的优先驱逐）
    idleConnections.sort((a, b) => {
      const connA = this.connections.get(a);
      const connB = this.connections.get(b);
      return connA.lastActivity - connB.lastActivity;
    });

    const toEvict = idleConnections.slice(0, count);

    for (const peerId of toEvict) {
      console.log(`[ConnectionPool] 驱逐空闲连接: ${peerId}`);
      await this.closeConnection(peerId);
    }

    return toEvict.length;
  }

  /**
   * 健康检查
   */
  async performHealthCheck() {
    const now = Date.now();
    const unhealthyConnections = [];

    for (const [peerId, conn] of this.connections.entries()) {
      // 检查连接是否超时
      if (conn.isIdle() && conn.isTimedOut(this.maxIdleTime)) {
        console.log(`[ConnectionPool] 连接超时: ${peerId}`);
        unhealthyConnections.push(peerId);
        continue;
      }

      // 检查连接健康状态
      if (!conn.isHealthy()) {
        console.log(`[ConnectionPool] 连接不健康: ${peerId}`);
        unhealthyConnections.push(peerId);
      }
    }

    // 关闭不健康的连接
    for (const peerId of unhealthyConnections) {
      await this.closeConnection(peerId);
    }

    console.log(`[ConnectionPool] 健康检查完成，关闭 ${unhealthyConnections.length} 个连接`);
  }

  /**
   * 启动健康检查
   */
  startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);

    console.log('[ConnectionPool] 健康检查已启动');
  }

  /**
   * 启动清理任务
   */
  startCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // 每分钟执行一次清理
    this.cleanupTimer = setInterval(() => {
      // 如果空闲连接过多，清理一部分
      if (this.idleConnections.size > this.minConnections) {
        const toEvict = this.idleConnections.size - this.minConnections;
        this.evictIdleConnections(toEvict);
      }
    }, 60000);

    console.log('[ConnectionPool] 清理任务已启动');
  }

  /**
   * 更新统计信息
   */
  updateStats() {
    this.stats.currentActive = this.activeConnections.size;
    this.stats.currentIdle = this.idleConnections.size;
  }

  /**
   * 获取连接池统计
   */
  getStats() {
    this.updateStats();
    return {
      ...this.stats,
      total: this.connections.size,
      hitRate: this.stats.totalHits > 0
        ? (this.stats.totalHits / (this.stats.totalHits + this.stats.totalMisses) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * 获取连接详情
   */
  getConnectionDetails() {
    const details = [];

    for (const [peerId, conn] of this.connections.entries()) {
      details.push({
        peerId,
        state: conn.state,
        createdAt: conn.createdAt,
        lastActivity: conn.lastActivity,
        usageCount: conn.usageCount,
        errorCount: conn.errorCount,
        idleTime: Date.now() - conn.lastActivity,
      });
    }

    return details;
  }

  /**
   * 关闭所有连接
   */
  async closeAll() {
    console.log('[ConnectionPool] 关闭所有连接...');

    const peerIds = Array.from(this.connections.keys());

    for (const peerId of peerIds) {
      await this.closeConnection(peerId);
    }

    console.log(`[ConnectionPool] 已关闭 ${peerIds.length} 个连接`);
  }

  /**
   * 销毁连接池
   */
  async destroy() {
    console.log('[ConnectionPool] 销毁连接池...');

    // 停止定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 关闭所有连接
    await this.closeAll();

    this.emit('destroyed');
  }
}

module.exports = {
  ConnectionPool,
  ConnectionState,
  Connection,
};
