/**
 * RPC 提供商管理器
 *
 * 负责管理多个 RPC 节点，实现：
 * - 负载均衡
 * - 健康检查
 * - 自动故障转移
 * - 性能监控
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');

class RPCManager extends EventEmitter {
  constructor(chainId, rpcUrls) {
    super();

    this.chainId = chainId;
    this.rpcUrls = rpcUrls;

    // RPC 节点状态 (url => {provider, healthy, latency, lastCheck, failureCount})
    this.nodes = new Map();

    // 当前活跃节点索引
    this.currentNodeIndex = 0;

    // 健康检查配置
    this.healthCheckInterval = 60000; // 60秒
    this.healthCheckTimeout = 5000; // 5秒超时
    this.maxFailures = 3; // 最大失败次数

    // 健康检查定时器
    this.healthCheckTimer = null;

    this.initialized = false;
  }

  /**
   * 初始化 RPC 管理器
   */
  async initialize() {
    console.log(`[RPCManager] 初始化 RPC 管理器 (Chain ${this.chainId})...`);

    try {
      // 初始化所有节点
      for (const url of this.rpcUrls) {
        // 跳过包含占位符的 URL
        if (url.includes('your-api-key') || url.includes('YOUR_')) {
          console.log(`[RPCManager] 跳过占位符 URL: ${url}`);
          continue;
        }

        try {
          const provider = new ethers.JsonRpcProvider(url);

          // 测试连接
          const latency = await this.measureLatency(provider);

          this.nodes.set(url, {
            provider,
            healthy: true,
            latency,
            lastCheck: Date.now(),
            failureCount: 0,
            requestCount: 0,
            errorCount: 0,
          });

          console.log(`[RPCManager] 节点初始化成功: ${url} (延迟: ${latency}ms)`);
        } catch (error) {
          console.warn(`[RPCManager] 节点初始化失败: ${url}`, error.message);

          // 仍然添加到节点列表，但标记为不健康
          this.nodes.set(url, {
            provider: null,
            healthy: false,
            latency: Infinity,
            lastCheck: Date.now(),
            failureCount: 1,
            requestCount: 0,
            errorCount: 0,
          });
        }
      }

      if (this.getHealthyNodes().length === 0) {
        throw new Error('没有可用的 RPC 节点');
      }

      // 启动健康检查
      this.startHealthCheck();

      this.initialized = true;
      console.log(`[RPCManager] RPC 管理器初始化成功，${this.getHealthyNodes().length}/${this.nodes.size} 个节点可用`);
    } catch (error) {
      console.error('[RPCManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 测量节点延迟
   * @param {ethers.JsonRpcProvider} provider - 提供者
   * @returns {Promise<number>} 延迟（毫秒）
   */
  async measureLatency(provider) {
    const start = Date.now();

    try {
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('超时')), this.healthCheckTimeout)
        )
      ]);

      return Date.now() - start;
    } catch (error) {
      return Infinity;
    }
  }

  /**
   * 获取最佳节点
   * @returns {ethers.JsonRpcProvider} 提供者
   */
  getBestProvider() {
    const healthyNodes = this.getHealthyNodes();

    if (healthyNodes.length === 0) {
      throw new Error('没有可用的 RPC 节点');
    }

    // 按延迟排序，选择最快的节点
    healthyNodes.sort((a, b) => a.latency - b.latency);

    const bestNode = healthyNodes[0];
    console.log(`[RPCManager] 使用最佳节点: ${bestNode.url} (延迟: ${bestNode.latency}ms)`);

    return bestNode.provider;
  }

  /**
   * 获取下一个可用节点（轮询）
   * @returns {ethers.JsonRpcProvider} 提供者
   */
  getNextProvider() {
    const healthyNodes = this.getHealthyNodes();

    if (healthyNodes.length === 0) {
      throw new Error('没有可用的 RPC 节点');
    }

    // 轮询选择
    this.currentNodeIndex = (this.currentNodeIndex + 1) % healthyNodes.length;
    const node = healthyNodes[this.currentNodeIndex];

    console.log(`[RPCManager] 使用节点 ${this.currentNodeIndex + 1}/${healthyNodes.length}: ${node.url}`);

    return node.provider;
  }

  /**
   * 获取健康节点列表
   * @returns {Array} 健康节点列表
   */
  getHealthyNodes() {
    const nodes = [];

    for (const [url, node] of this.nodes.entries()) {
      if (node.healthy && node.provider) {
        nodes.push({ url, ...node });
      }
    }

    return nodes;
  }

  /**
   * 执行带故障转移的请求
   * @param {Function} requestFn - 请求函数
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<any>} 请求结果
   */
  async executeWithFailover(requestFn, maxRetries = 3) {
    const healthyNodes = this.getHealthyNodes();

    if (healthyNodes.length === 0) {
      throw new Error('没有可用的 RPC 节点');
    }

    let lastError;
    let attemptCount = 0;

    // 尝试所有健康节点
    for (let i = 0; i < Math.min(maxRetries, healthyNodes.length); i++) {
      const node = healthyNodes[i];
      attemptCount++;

      try {
        console.log(`[RPCManager] 尝试节点 ${i + 1}/${healthyNodes.length}: ${node.url}`);

        // 更新请求计数
        node.requestCount++;

        // 执行请求
        const result = await requestFn(node.provider);

        console.log(`[RPCManager] 请求成功: ${node.url}`);
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`[RPCManager] 节点请求失败 (尝试 ${attemptCount}): ${node.url}`, error.message);

        // 更新错误计数
        node.errorCount++;
        node.failureCount++;

        // 如果失败次数过多，标记为不健康
        if (node.failureCount >= this.maxFailures) {
          console.warn(`[RPCManager] 节点标记为不健康: ${node.url}`);
          node.healthy = false;
          this.emit('node:unhealthy', { url: node.url, chainId: this.chainId });
        }

        // 继续尝试下一个节点
        continue;
      }
    }

    // 所有节点都失败
    console.error(`[RPCManager] 所有节点请求失败 (${attemptCount} 次尝试)`);
    throw lastError || new Error('所有 RPC 节点请求失败');
  }

  /**
   * 启动健康检查
   */
  startHealthCheck() {
    if (this.healthCheckTimer) {
      return;
    }

    console.log(`[RPCManager] 启动健康检查 (间隔: ${this.healthCheckInterval}ms)`);

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('[RPCManager] 健康检查已停止');
    }
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    console.log(`[RPCManager] 执行健康检查 (Chain ${this.chainId})...`);

    for (const [url, node] of this.nodes.entries()) {
      try {
        // 如果节点没有 provider，尝试重新创建
        if (!node.provider) {
          node.provider = new ethers.JsonRpcProvider(url);
        }

        // 测量延迟
        const latency = await this.measureLatency(node.provider);

        if (latency < Infinity) {
          // 节点健康
          if (!node.healthy) {
            console.log(`[RPCManager] 节点恢复健康: ${url}`);
            this.emit('node:recovered', { url, chainId: this.chainId });
          }

          node.healthy = true;
          node.latency = latency;
          node.failureCount = 0;
        } else {
          // 节点不健康
          if (node.healthy) {
            console.warn(`[RPCManager] 节点变为不健康: ${url}`);
            this.emit('node:unhealthy', { url, chainId: this.chainId });
          }

          node.healthy = false;
          node.failureCount++;
        }

        node.lastCheck = Date.now();
      } catch (error) {
        console.warn(`[RPCManager] 健康检查失败: ${url}`, error.message);

        node.healthy = false;
        node.failureCount++;
        node.lastCheck = Date.now();
      }
    }

    // 发出健康检查完成事件
    const healthyCount = this.getHealthyNodes().length;
    this.emit('health:checked', {
      chainId: this.chainId,
      totalNodes: this.nodes.size,
      healthyNodes: healthyCount,
    });

    console.log(`[RPCManager] 健康检查完成: ${healthyCount}/${this.nodes.size} 个节点健康`);
  }

  /**
   * 获取节点统计信息
   * @returns {Array} 节点统计
   */
  getNodeStats() {
    const stats = [];

    for (const [url, node] of this.nodes.entries()) {
      stats.push({
        url,
        healthy: node.healthy,
        latency: node.latency,
        lastCheck: node.lastCheck,
        failureCount: node.failureCount,
        requestCount: node.requestCount,
        errorCount: node.errorCount,
        errorRate: node.requestCount > 0
          ? (node.errorCount / node.requestCount * 100).toFixed(2) + '%'
          : '0%',
      });
    }

    return stats;
  }

  /**
   * 重置节点统计
   * @param {string} url - 节点 URL（可选，不提供则重置所有）
   */
  resetStats(url = null) {
    if (url) {
      const node = this.nodes.get(url);
      if (node) {
        node.requestCount = 0;
        node.errorCount = 0;
        node.failureCount = 0;
        console.log(`[RPCManager] 已重置节点统计: ${url}`);
      }
    } else {
      for (const node of this.nodes.values()) {
        node.requestCount = 0;
        node.errorCount = 0;
        node.failureCount = 0;
      }
      console.log('[RPCManager] 已重置所有节点统计');
    }
  }

  /**
   * 添加新节点
   * @param {string} url - RPC URL
   */
  async addNode(url) {
    if (this.nodes.has(url)) {
      console.warn(`[RPCManager] 节点已存在: ${url}`);
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(url);
      const latency = await this.measureLatency(provider);

      this.nodes.set(url, {
        provider,
        healthy: true,
        latency,
        lastCheck: Date.now(),
        failureCount: 0,
        requestCount: 0,
        errorCount: 0,
      });

      console.log(`[RPCManager] 新节点已添加: ${url} (延迟: ${latency}ms)`);
      this.emit('node:added', { url, chainId: this.chainId });
    } catch (error) {
      console.error(`[RPCManager] 添加节点失败: ${url}`, error);
      throw error;
    }
  }

  /**
   * 移除节点
   * @param {string} url - RPC URL
   */
  async removeNode(url) {
    const node = this.nodes.get(url);

    if (!node) {
      console.warn(`[RPCManager] 节点不存在: ${url}`);
      return;
    }

    try {
      if (node.provider) {
        await node.provider.destroy();
      }

      this.nodes.delete(url);
      console.log(`[RPCManager] 节点已移除: ${url}`);
      this.emit('node:removed', { url, chainId: this.chainId });
    } catch (error) {
      console.error(`[RPCManager] 移除节点失败: ${url}`, error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    console.log('[RPCManager] 清理资源...');

    // 停止健康检查
    this.stopHealthCheck();

    // 销毁所有提供者
    for (const [url, node] of this.nodes.entries()) {
      try {
        if (node.provider) {
          await node.provider.destroy();
        }
      } catch (error) {
        console.error(`[RPCManager] 清理节点失败: ${url}`, error);
      }
    }

    this.nodes.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = RPCManager;
