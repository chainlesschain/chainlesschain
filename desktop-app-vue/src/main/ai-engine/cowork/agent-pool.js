/**
 * AgentPool - 代理池管理器
 *
 * 复用代理实例，减少创建和销毁开销
 *
 * 核心功能:
 * 1. 代理池预创建和复用
 * 2. 动态扩容和缩容
 * 3. 状态隔离确保安全
 * 4. 等待队列处理
 * 5. 统计和监控
 *
 * @module ai-engine/cowork/agent-pool
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

/**
 * 代理状态
 */
const AgentStatus = {
  IDLE: "idle", // 空闲
  BUSY: "busy", // 忙碌
  INITIALIZING: "initializing", // 初始化中
  TERMINATED: "terminated", // 已终止
};

/**
 * AgentPool 类
 */
class AgentPool extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      minSize: options.minSize || 3, // 最小池大小
      maxSize: options.maxSize || 10, // 最大池大小
      idleTimeout: options.idleTimeout || 300000, // 空闲超时5分钟
      warmupOnInit: options.warmupOnInit !== false, // 启动时预热
      enableAutoScaling: options.enableAutoScaling !== false, // 自动伸缩
    };

    // 可用代理池
    this.availableAgents = [];

    // 忙碌代理映射: agentId -> Agent
    this.busyAgents = new Map();

    // 等待队列: { resolve, reject, capabilities, timestamp }
    this.waitQueue = [];

    // 空闲定时器: agentId -> Timer
    this.idleTimers = new Map();

    // 统计信息
    this.stats = {
      created: 0,
      reused: 0,
      destroyed: 0,
      acquisitions: 0,
      releases: 0,
      waitTimeouts: 0,
      currentWaiting: 0,
    };

    // v1.1.0: Capability-based pooling
    this._pools = new Map(); // agentType -> Agent[]
    this._healthCheckInterval = null;
    this._memoryThreshold = options.memoryThreshold || 0.85; // 85% heap usage

    // 初始化完成标志
    this.initialized = false;

    logger.info("[AgentPool] 代理池创建", {
      minSize: this.options.minSize,
      maxSize: this.options.maxSize,
    });
  }

  /**
   * 初始化代理池（预热）
   */
  async initialize() {
    if (this.initialized) {
      logger.warn("[AgentPool] 代理池已初始化");
      return;
    }

    logger.info(
      `[AgentPool] 开始初始化，预创建 ${this.options.minSize} 个代理...`,
    );

    const startTime = Date.now();

    if (this.options.warmupOnInit) {
      const createPromises = [];
      for (let i = 0; i < this.options.minSize; i++) {
        createPromises.push(this._createAgent(`warmup_${i}`));
      }

      const agents = await Promise.all(createPromises);
      this.availableAgents.push(...agents);

      logger.info(
        `[AgentPool] ✅ 初始化完成，耗时: ${Date.now() - startTime}ms, 可用代理: ${this.availableAgents.length}`,
      );
    }

    this.initialized = true;
    this.emit("initialized", { poolSize: this.availableAgents.length });
  }

  /**
   * 获取代理
   * @param {Object} capabilities - 所需能力
   * @param {number} timeout - 等待超时(ms)
   * @returns {Promise<Object>} 代理对象
   */
  async acquireAgent(capabilities = {}, timeout = 30000) {
    this.stats.acquisitions++;

    // 1. 尝试从可用池中获取
    if (this.availableAgents.length > 0) {
      const agent = this.availableAgents.pop();

      // 清除空闲定时器
      this._clearIdleTimer(agent.id);

      // 重置代理状态
      this._resetAgent(agent, capabilities);

      // 移到忙碌池
      this.busyAgents.set(agent.id, agent);

      this.stats.reused++;
      logger.debug(
        `[AgentPool] ♻️ 复用代理: ${agent.id}, 复用次数: ${agent.reuseCount}`,
      );

      this.emit("agent-acquired", { agentId: agent.id, reused: true });

      return agent;
    }

    // 2. 检查是否可以创建新代理
    const totalAgents = this.availableAgents.length + this.busyAgents.size;

    if (totalAgents < this.options.maxSize) {
      const agent = await this._createAgent(uuidv4().slice(0, 8), capabilities);

      this.busyAgents.set(agent.id, agent);

      logger.debug(`[AgentPool] 🆕 创建新代理: ${agent.id}`);

      this.emit("agent-acquired", { agentId: agent.id, reused: false });

      return agent;
    }

    // 3. 池已满，加入等待队列
    logger.warn("[AgentPool] 代理池已满，加入等待队列...", {
      available: this.availableAgents.length,
      busy: this.busyAgents.size,
      waiting: this.waitQueue.length,
    });

    this.stats.currentWaiting++;

    return this._waitForAgent(capabilities, timeout);
  }

  /**
   * 释放代理
   * @param {string} agentId - 代理ID
   */
  releaseAgent(agentId) {
    const agent = this.busyAgents.get(agentId);

    if (!agent) {
      logger.warn(`[AgentPool] 释放未知代理: ${agentId}`);
      return;
    }

    this.busyAgents.delete(agentId);
    this.stats.releases++;

    // 检查等待队列
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      this.stats.currentWaiting--;

      // 重置并分配给等待者
      this._resetAgent(agent, waiter.capabilities);
      this.busyAgents.set(agent.id, agent);

      logger.debug(`[AgentPool] 代理 ${agentId} 分配给等待者`);

      waiter.resolve(agent);
      return;
    }

    // 检查是否超过最小池大小
    if (this.availableAgents.length >= this.options.minSize) {
      // 销毁多余代理
      this._destroyAgent(agent);
      return;
    }

    // 放回可用池
    agent.status = AgentStatus.IDLE;
    agent.lastIdleTime = Date.now();
    this.availableAgents.push(agent);

    // 启动空闲定时器
    this._startIdleTimer(agent.id);

    logger.debug(
      `[AgentPool] ↩️ 代理归还: ${agentId}, 池大小: ${this.availableAgents.length}`,
    );

    this.emit("agent-released", { agentId });
  }

  /**
   * 等待可用代理
   * @private
   */
  _waitForAgent(capabilities, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 从队列中移除
        const index = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
          this.stats.currentWaiting--;
        }

        this.stats.waitTimeouts++;
        logger.error("[AgentPool] 等待代理超时");

        reject(new Error(`等待可用代理超时 (${timeout}ms)`));
      }, timeout);

      this.waitQueue.push({
        resolve,
        reject,
        capabilities,
        timestamp: Date.now(),
        timer,
      });
    });
  }

  /**
   * 创建新代理
   * @private
   */
  async _createAgent(agentId, capabilities = {}) {
    const agent = {
      id: `agent_${agentId}`,
      status: AgentStatus.IDLE,
      capabilities: capabilities.capabilities || [],
      role: capabilities.role || "worker",
      teamId: null,
      taskQueue: [],
      currentTask: null,
      createdAt: Date.now(),
      lastActiveTime: Date.now(),
      lastIdleTime: null,
      reuseCount: 0,
      metadata: {},
    };

    this.stats.created++;

    logger.debug(`[AgentPool] 创建代理: ${agent.id}`);

    this.emit("agent-created", { agentId: agent.id });

    return agent;
  }

  /**
   * 重置代理状态
   * @private
   */
  _resetAgent(agent, capabilities = {}) {
    agent.status = AgentStatus.BUSY;
    agent.capabilities = capabilities.capabilities || [];
    agent.role = capabilities.role || "worker";
    agent.teamId = capabilities.teamId || null;
    agent.taskQueue = [];
    agent.currentTask = null;
    agent.lastActiveTime = Date.now();
    agent.lastIdleTime = null;
    agent.reuseCount++;
    agent.metadata = {};
  }

  /**
   * 销毁代理
   * @private
   */
  _destroyAgent(agent) {
    agent.status = AgentStatus.TERMINATED;

    this._clearIdleTimer(agent.id);

    this.stats.destroyed++;

    logger.debug(
      `[AgentPool] 🗑️ 销毁代理: ${agent.id}, 复用次数: ${agent.reuseCount}`,
    );

    this.emit("agent-destroyed", {
      agentId: agent.id,
      reuseCount: agent.reuseCount,
    });
  }

  /**
   * 启动空闲定时器
   * @private
   */
  _startIdleTimer(agentId) {
    if (this.idleTimers.has(agentId)) {
      return;
    }

    const timer = setTimeout(() => {
      const index = this.availableAgents.findIndex((a) => a.id === agentId);
      if (index !== -1) {
        const agent = this.availableAgents.splice(index, 1)[0];
        this._destroyAgent(agent);
      }
    }, this.options.idleTimeout);

    this.idleTimers.set(agentId, timer);
  }

  /**
   * 清除空闲定时器
   * @private
   */
  _clearIdleTimer(agentId) {
    const timer = this.idleTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(agentId);
    }
  }

  /**
   * 获取池状态
   */
  getStatus() {
    return {
      available: this.availableAgents.length,
      busy: this.busyAgents.size,
      waiting: this.waitQueue.length,
      total: this.availableAgents.length + this.busyAgents.size,
      minSize: this.options.minSize,
      maxSize: this.options.maxSize,
    };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      reuseRate:
        this.stats.acquisitions > 0
          ? ((this.stats.reused / this.stats.acquisitions) * 100).toFixed(2)
          : "0.00",
      avgReuseCount:
        this.stats.destroyed > 0
          ? (this.stats.reused / this.stats.destroyed).toFixed(2)
          : "0.00",
    };
  }

  /**
   * 清空代理池
   */
  async clear() {
    logger.info("[AgentPool] 清空代理池...");

    // v1.1.0: 停止健康检查
    this.stopHealthCheck();

    // 清除所有定时器
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    // 拒绝所有等待请求
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("代理池已清空"));
    }
    this.waitQueue = [];
    this.stats.currentWaiting = 0;

    // 销毁所有代理
    for (const agent of this.availableAgents) {
      this._destroyAgent(agent);
    }
    this.availableAgents = [];

    for (const agent of this.busyAgents.values()) {
      this._destroyAgent(agent);
    }
    this.busyAgents.clear();

    // v1.1.0: 清空能力池
    for (const [type, pool] of this._pools) {
      for (const agent of pool) {
        if (typeof agent.destroy === "function") {
          agent.destroy();
        }
      }
    }
    this._pools.clear();

    this.initialized = false;

    logger.info("[AgentPool] ✅ 代理池已清空");

    this.emit("cleared");
  }

  /**
   * 自动缩容（移除多余空闲代理）
   */
  async shrink() {
    if (!this.options.enableAutoScaling) {
      return;
    }

    const excessCount = this.availableAgents.length - this.options.minSize;

    if (excessCount <= 0) {
      return;
    }

    logger.info(`[AgentPool] 自动缩容，移除 ${excessCount} 个空闲代理`);

    for (let i = 0; i < excessCount; i++) {
      const agent = this.availableAgents.pop();
      if (agent) {
        this._destroyAgent(agent);
      }
    }

    this.emit("shrink", { removed: excessCount });
  }

  // ==========================================
  // v1.1.0: Capability-based pooling & health
  // ==========================================

  /**
   * 按能力获取 Agent（v1.1.0 能力池化）
   * @param {string[]} capabilities - 所需能力列表
   * @returns {Object|null} Agent instance
   */
  acquireByCapabilities(capabilities = []) {
    // Try to find a warm agent with matching capabilities
    for (const [type, pool] of this._pools) {
      for (let i = 0; i < pool.length; i++) {
        const agent = pool[i];
        if (agent._available && this._matchCapabilities(agent, capabilities)) {
          agent._available = false;
          agent._lastUsed = Date.now();
          this._log(`Agent acquired by capability from pool '${type}'`);
          return agent;
        }
      }
    }

    // Fall back to regular acquire
    return this.acquireAgent ? this.acquireAgent() : null;
  }

  /**
   * 温复用 Agent（重置状态但保留连接）
   * @param {Object} agent - Agent instance
   */
  _warmResetAgent(agent) {
    if (!agent) {
      return;
    }

    // Reset task state but keep connections warm
    if (agent.currentTask) {
      agent.currentTask = null;
    }
    if (agent.context) {
      agent.context = {};
    }
    if (agent.taskHistory) {
      agent.taskHistory = [];
    }
    if (typeof agent.resetState === "function") {
      agent.resetState();
    }

    agent._available = true;
    agent._resetAt = Date.now();
    this._log(`Agent warm-reset: ${agent.id || "unknown"}`);
  }

  /**
   * 内存感知缩池
   * @private
   */
  _checkMemoryPressure() {
    const memUsage = process.memoryUsage();
    const heapRatio = memUsage.heapUsed / memUsage.heapTotal;

    if (heapRatio > this._memoryThreshold) {
      this._log(
        `Memory pressure detected: ${(heapRatio * 100).toFixed(1)}% heap used`,
        "warn",
      );

      // Shrink pools - remove idle agents
      let removed = 0;
      for (const [type, pool] of this._pools) {
        const idleAgents = pool.filter(
          (a) => a._available && Date.now() - (a._lastUsed || 0) > 60000,
        );
        for (const agent of idleAgents) {
          const idx = pool.indexOf(agent);
          if (idx >= 0) {
            pool.splice(idx, 1);
            if (typeof agent.destroy === "function") {
              agent.destroy();
            }
            removed++;
          }
        }
      }

      if (removed > 0) {
        this._log(`Memory pressure: removed ${removed} idle agents`);
      }
    }
  }

  /**
   * 启动健康检查定时器
   * @param {number} [intervalMs=60000] - 检查间隔
   */
  startHealthCheck(intervalMs = 60000) {
    if (this._healthCheckInterval) {
      return;
    }

    this._healthCheckInterval = setInterval(() => {
      this._checkMemoryPressure();
      this._pingAgents();
    }, intervalMs);

    this._log("Health check started");
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  /**
   * 探活检查
   * @private
   */
  _pingAgents() {
    for (const [type, pool] of this._pools) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const agent = pool[i];
        if (agent._available && typeof agent.ping === "function") {
          try {
            const alive = agent.ping();
            if (!alive) {
              this._log(`Agent unresponsive, removing from pool '${type}'`);
              pool.splice(i, 1);
              if (typeof agent.destroy === "function") {
                agent.destroy();
              }
            }
          } catch (e) {
            pool.splice(i, 1);
            if (typeof agent.destroy === "function") {
              agent.destroy();
            }
          }
        }
      }
    }
  }

  /**
   * 检查 agent 是否匹配所需能力
   * @private
   */
  _matchCapabilities(agent, requiredCapabilities) {
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return true;
    }
    const agentCaps = agent.capabilities || agent._capabilities || [];
    return requiredCapabilities.every((cap) => agentCaps.includes(cap));
  }

  /**
   * 将 agent 放回类型池
   * @param {string} agentType - Agent 类型
   * @param {Object} agent - Agent 实例
   */
  returnToPool(agentType, agent) {
    if (!this._pools.has(agentType)) {
      this._pools.set(agentType, []);
    }
    this._warmResetAgent(agent);
    this._pools.get(agentType).push(agent);
  }

  /**
   * 获取池状态（v1.1.0 能力池统计）
   * @returns {Object}
   */
  getPoolStats() {
    const stats = {};
    for (const [type, pool] of this._pools) {
      stats[type] = {
        total: pool.length,
        available: pool.filter((a) => a._available).length,
        busy: pool.filter((a) => !a._available).length,
      };
    }

    const memUsage = process.memoryUsage();
    return {
      pools: stats,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        heapRatio:
          ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1) + "%",
        rss: memUsage.rss,
      },
    };
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = "info") {
    if (level === "warn") {
      logger.warn(`[AgentPool] ${message}`);
    } else if (level === "error") {
      logger.error(`[AgentPool] ${message}`);
    } else {
      logger.info(`[AgentPool] ${message}`);
    }
  }
}

module.exports = {
  AgentPool,
  AgentStatus,
};
