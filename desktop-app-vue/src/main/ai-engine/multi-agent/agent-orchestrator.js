/**
 * 多 Agent 协调器
 *
 * 基于 OpenManus 的多 Agent 架构设计，实现 Agent 的注册、分发和协作。
 *
 * 核心功能：
 * 1. Agent 注册和管理
 * 2. 任务分发和路由
 * 3. Agent 间通信
 * 4. 并行执行协调
 *
 * @see https://github.com/FoundationAgents/OpenManus
 */

const EventEmitter = require("events");

/**
 * Agent 协调器
 */
class AgentOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();

    // 注册的 Agent
    this.agents = new Map();

    // 消息队列
    this.messageQueue = [];

    // 执行历史
    this.executionHistory = [];

    // 配置
    this.config = {
      // 最大并行 Agent 数
      maxParallelAgents: options.maxParallelAgents || 3,
      // 单个 Agent 超时时间（毫秒）
      agentTimeout: options.agentTimeout || 60000,
      // 是否启用日志
      enableLogging: options.enableLogging !== false,
      // 最大历史记录数
      maxHistory: options.maxHistory || 100,
    };

    // 活跃执行
    this.activeExecutions = new Map();

    // 统计
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      agentUsage: {},
    };
  }

  // ==========================================
  // Agent 注册
  // ==========================================

  /**
   * 注册 Agent
   * @param {SpecializedAgent} agent - Agent 实例
   */
  registerAgent(agent) {
    if (!agent.agentId) {
      throw new Error("Agent must have an agentId");
    }

    if (this.agents.has(agent.agentId)) {
      this._log(`Agent "${agent.agentId}" 已存在，将被覆盖`);
    }

    this.agents.set(agent.agentId, agent);

    // 初始化使用统计
    if (!this.stats.agentUsage[agent.agentId]) {
      this.stats.agentUsage[agent.agentId] = {
        invocations: 0,
        successes: 0,
        failures: 0,
        totalTime: 0,
      };
    }

    this._log(`Agent 已注册: ${agent.agentId} (capabilities: ${agent.capabilities?.join(", ")})`);

    this.emit("agent-registered", { agentId: agent.agentId, agent });
  }

  /**
   * 批量注册 Agent
   * @param {Array<SpecializedAgent>} agents - Agent 数组
   */
  registerAgents(agents) {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  /**
   * 注销 Agent
   * @param {string} agentId - Agent ID
   */
  unregisterAgent(agentId) {
    if (this.agents.has(agentId)) {
      this.agents.delete(agentId);
      this._log(`Agent 已注销: ${agentId}`);
      this.emit("agent-unregistered", { agentId });
    }
  }

  /**
   * 获取 Agent
   * @param {string} agentId - Agent ID
   * @returns {SpecializedAgent|undefined}
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  /**
   * 获取所有 Agent
   * @returns {Array<SpecializedAgent>}
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  // ==========================================
  // 任务分发
  // ==========================================

  /**
   * 分发任务到最合适的 Agent
   * @param {Object} task - 任务对象
   * @param {string} task.type - 任务类型
   * @param {any} task.input - 任务输入
   * @param {Object} task.context - 任务上下文
   * @returns {Promise<any>} 执行结果
   */
  async dispatch(task) {
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    this.stats.totalTasks++;

    try {
      // 选择最合适的 Agent
      const agentId = this.selectAgent(task);

      if (!agentId) {
        throw new Error(`没有 Agent 能处理任务类型: ${task.type}`);
      }

      const agent = this.agents.get(agentId);

      // 记录执行
      this.activeExecutions.set(executionId, {
        task,
        agentId,
        startTime,
      });

      this._log(`任务分发: ${task.type} -> ${agentId}`);

      // 执行任务（带超时）
      const result = await this._executeWithTimeout(
        agent.execute(task),
        this.config.agentTimeout,
        `Agent ${agentId} 执行超时`
      );

      // 更新统计
      const duration = Date.now() - startTime;
      this._updateStats(agentId, true, duration);

      // 记录历史
      this._recordHistory(executionId, task, agentId, result, null, duration);

      this.activeExecutions.delete(executionId);
      this.stats.completedTasks++;

      this.emit("task-completed", { executionId, task, agentId, result, duration });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 更新统计
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        this._updateStats(execution.agentId, false, duration);
      }

      // 记录历史
      this._recordHistory(
        executionId,
        task,
        execution?.agentId,
        null,
        error,
        duration
      );

      this.activeExecutions.delete(executionId);
      this.stats.failedTasks++;

      this.emit("task-failed", { executionId, task, error, duration });

      throw error;
    }
  }

  /**
   * 选择最适合的 Agent
   * @param {Object} task - 任务对象
   * @returns {string|null} Agent ID
   */
  selectAgent(task) {
    const agentScores = new Map();

    for (const [agentId, agent] of this.agents) {
      const score = agent.canHandle(task);
      if (score > 0) {
        agentScores.set(agentId, score);
      }
    }

    if (agentScores.size === 0) {
      return null;
    }

    // 返回得分最高的 Agent
    let bestAgent = null;
    let bestScore = 0;

    for (const [agentId, score] of agentScores) {
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agentId;
      }
    }

    return bestAgent;
  }

  /**
   * 获取能处理任务的所有 Agent
   * @param {Object} task - 任务对象
   * @returns {Array<{agentId: string, score: number}>}
   */
  getCapableAgents(task) {
    const capable = [];

    for (const [agentId, agent] of this.agents) {
      const score = agent.canHandle(task);
      if (score > 0) {
        capable.push({ agentId, score, agent });
      }
    }

    // 按得分排序
    capable.sort((a, b) => b.score - a.score);

    return capable;
  }

  // ==========================================
  // 并行执行
  // ==========================================

  /**
   * 并行执行多个任务
   * @param {Array<Object>} tasks - 任务数组
   * @param {Object} options - 执行选项
   * @returns {Promise<Array>} 结果数组
   */
  async executeParallel(tasks, options = {}) {
    const maxConcurrency = options.maxConcurrency || this.config.maxParallelAgents;
    const stopOnError = options.stopOnError || false;

    const results = [];
    const errors = [];
    let activeCount = 0;
    let taskIndex = 0;

    return new Promise((resolve, reject) => {
      const executeNext = async () => {
        if (taskIndex >= tasks.length && activeCount === 0) {
          // 所有任务完成
          if (stopOnError && errors.length > 0) {
            reject(errors[0]);
          } else {
            resolve(results);
          }
          return;
        }

        while (activeCount < maxConcurrency && taskIndex < tasks.length) {
          const currentIndex = taskIndex++;
          const task = tasks[currentIndex];
          activeCount++;

          this.dispatch(task)
            .then((result) => {
              results[currentIndex] = { success: true, result };
            })
            .catch((error) => {
              results[currentIndex] = { success: false, error: error.message };
              errors.push(error);

              if (stopOnError) {
                reject(error);
                return;
              }
            })
            .finally(() => {
              activeCount--;
              executeNext();
            });
        }
      };

      executeNext();
    });
  }

  /**
   * 链式执行任务（前一个任务的输出作为下一个任务的输入）
   * @param {Array<Object>} tasks - 任务数组
   * @returns {Promise<any>} 最终结果
   */
  async executeChain(tasks) {
    let previousResult = null;

    for (let i = 0; i < tasks.length; i++) {
      const task = { ...tasks[i] };

      // 将前一个任务的结果注入到上下文
      if (previousResult) {
        task.context = {
          ...task.context,
          previousResult,
          chainIndex: i,
        };
      }

      previousResult = await this.dispatch(task);
    }

    return previousResult;
  }

  // ==========================================
  // Agent 间通信
  // ==========================================

  /**
   * 发送消息给特定 Agent
   * @param {string} fromAgent - 发送者 Agent ID
   * @param {string} toAgent - 接收者 Agent ID
   * @param {Object} message - 消息内容
   * @returns {Promise<any>} 响应
   */
  async sendMessage(fromAgent, toAgent, message) {
    const targetAgent = this.agents.get(toAgent);

    if (!targetAgent) {
      throw new Error(`目标 Agent 不存在: ${toAgent}`);
    }

    // 记录消息
    const messageRecord = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: fromAgent,
      to: toAgent,
      message,
      timestamp: Date.now(),
    };

    this.messageQueue.push(messageRecord);

    // 限制队列长度
    if (this.messageQueue.length > 1000) {
      this.messageQueue = this.messageQueue.slice(-500);
    }

    this._log(`消息: ${fromAgent} -> ${toAgent}`);

    // 如果 Agent 有 receiveMessage 方法，调用它
    if (typeof targetAgent.receiveMessage === "function") {
      return await targetAgent.receiveMessage(message, { from: fromAgent });
    }

    return null;
  }

  /**
   * 广播消息给所有 Agent
   * @param {string} fromAgent - 发送者 Agent ID
   * @param {Object} message - 消息内容
   */
  async broadcast(fromAgent, message) {
    const results = [];

    for (const [agentId, agent] of this.agents) {
      if (agentId !== fromAgent && typeof agent.receiveMessage === "function") {
        try {
          const result = await agent.receiveMessage(message, { from: fromAgent });
          results.push({ agentId, result });
        } catch (error) {
          results.push({ agentId, error: error.message });
        }
      }
    }

    return results;
  }

  /**
   * 获取消息历史
   * @param {string} agentId - Agent ID（可选，不传返回所有）
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getMessageHistory(agentId = null, limit = 50) {
    let messages = this.messageQueue;

    if (agentId) {
      messages = messages.filter(
        (m) => m.from === agentId || m.to === agentId
      );
    }

    return messages.slice(-limit);
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 带超时的执行
   * @private
   */
  _executeWithTimeout(promise, timeout, timeoutMessage) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), timeout)
      ),
    ]);
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats(agentId, success, duration) {
    if (!this.stats.agentUsage[agentId]) {
      this.stats.agentUsage[agentId] = {
        invocations: 0,
        successes: 0,
        failures: 0,
        totalTime: 0,
      };
    }

    const usage = this.stats.agentUsage[agentId];
    usage.invocations++;
    usage.totalTime += duration;

    if (success) {
      usage.successes++;
    } else {
      usage.failures++;
    }
  }

  /**
   * 记录执行历史
   * @private
   */
  _recordHistory(executionId, task, agentId, result, error, duration) {
    this.executionHistory.push({
      executionId,
      task: { type: task.type, input: task.input },
      agentId,
      result: error ? null : result,
      error: error ? error.message : null,
      duration,
      timestamp: Date.now(),
    });

    // 限制历史长度
    if (this.executionHistory.length > this.config.maxHistory) {
      this.executionHistory = this.executionHistory.slice(-this.config.maxHistory);
    }
  }

  /**
   * 日志输出
   * @private
   */
  _log(message) {
    if (this.config.enableLogging) {
      console.log(`[AgentOrchestrator] ${message}`);
    }
  }

  // ==========================================
  // 统计和调试
  // ==========================================

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      registeredAgents: this.agents.size,
      activeExecutions: this.activeExecutions.size,
      messageQueueSize: this.messageQueue.length,
      successRate:
        this.stats.totalTasks > 0
          ? (this.stats.completedTasks / this.stats.totalTasks * 100).toFixed(2) + "%"
          : "N/A",
    };
  }

  /**
   * 获取执行历史
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getExecutionHistory(limit = 20) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      agentUsage: {},
    };

    // 重新初始化 Agent 使用统计
    for (const agentId of this.agents.keys()) {
      this.stats.agentUsage[agentId] = {
        invocations: 0,
        successes: 0,
        failures: 0,
        totalTime: 0,
      };
    }
  }

  /**
   * 导出调试信息
   * @returns {Object}
   */
  exportDebugInfo() {
    return {
      agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
        id,
        capabilities: agent.capabilities,
        description: agent.description,
      })),
      stats: this.getStats(),
      recentHistory: this.getExecutionHistory(10),
      activeExecutions: Array.from(this.activeExecutions.entries()),
    };
  }
}

module.exports = { AgentOrchestrator };
