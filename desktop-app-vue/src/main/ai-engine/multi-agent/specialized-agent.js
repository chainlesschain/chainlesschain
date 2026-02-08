/**
 * 专用 Agent 基类
 *
 * 所有专用 Agent 的基类，定义了 Agent 的基本接口和行为。
 *
 * @see https://github.com/FoundationAgents/OpenManus
 */

const { logger } = require("../../utils/logger.js");
const EventEmitter = require("events");

/**
 * 专用 Agent 基类
 */
class SpecializedAgent extends EventEmitter {
  /**
   * @param {string} agentId - Agent 唯一标识
   * @param {Object} options - 配置选项
   */
  constructor(agentId, options = {}) {
    super();

    this.agentId = agentId;
    this.capabilities = options.capabilities || [];
    this.description = options.description || "";
    this.priority = options.priority || 0;

    // 状态
    this.state = {
      isActive: false,
      currentTask: null,
      lastExecutionTime: null,
    };

    // 配置
    this.config = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      timeout: options.timeout || 60000,
      ...options.config,
    };

    // 执行统计
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalTime: 0,
    };

    // LLM 管理器引用（由外部注入）
    this.llmManager = null;

    // 工具调用器引用（由外部注入）
    this.functionCaller = null;
  }

  /**
   * 设置 LLM 管理器
   * @param {Object} llmManager - LLM 管理器实例
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
  }

  /**
   * 设置工具调用器
   * @param {Object} functionCaller - FunctionCaller 实例
   */
  setFunctionCaller(functionCaller) {
    this.functionCaller = functionCaller;
  }

  /**
   * 评估处理任务的能力
   * @param {Object} task - 任务对象
   * @returns {number} 0-1 的得分，0 表示无法处理
   */
  canHandle(task) {
    if (!task || !task.type) {
      return 0;
    }

    // 检查任务类型是否在能力范围内
    if (this.capabilities.includes(task.type)) {
      return 1.0;
    }

    // 检查部分匹配
    for (const capability of this.capabilities) {
      if (task.type.includes(capability) || capability.includes(task.type)) {
        return 0.5;
      }
    }

    return 0;
  }

  /**
   * 执行任务（子类必须实现）
   * @param {Object} task - 任务对象
   * @returns {Promise<any>} 执行结果
   */
  async execute(task) {
    throw new Error("子类必须实现 execute 方法");
  }

  /**
   * 带重试的执行
   * @param {Object} task - 任务对象
   * @returns {Promise<any>} 执行结果
   */
  async executeWithRetry(task) {
    let lastError;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const startTime = Date.now();

        this.state.isActive = true;
        this.state.currentTask = task;

        const result = await this.execute(task);

        this.stats.totalExecutions++;
        this.stats.successfulExecutions++;
        this.stats.totalTime += Date.now() - startTime;
        this.state.lastExecutionTime = Date.now();

        this.state.isActive = false;
        this.state.currentTask = null;

        return result;
      } catch (error) {
        lastError = error;
        logger.warn(
          `[${this.agentId}] 执行失败 (attempt ${attempt + 1}):`,
          error.message,
        );

        if (attempt < this.config.maxRetries - 1) {
          await this._delay(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    this.stats.totalExecutions++;
    this.stats.failedExecutions++;
    this.state.isActive = false;
    this.state.currentTask = null;

    throw lastError;
  }

  /**
   * 接收来自其他 Agent 的消息
   * @param {Object} message - 消息内容
   * @param {Object} metadata - 消息元数据
   * @returns {Promise<any>} 响应
   */
  async receiveMessage(message, metadata = {}) {
    // 默认实现：记录消息并返回确认
    logger.info(`[${this.agentId}] 收到消息 from ${metadata.from}:`, message);
    return { received: true, agentId: this.agentId };
  }

  /**
   * 调用 LLM
   * @param {Object} options - LLM 调用选项
   * @returns {Promise<string>} LLM 响应
   */
  async callLLM(options) {
    if (!this.llmManager) {
      throw new Error("LLM 管理器未设置");
    }

    return await this.llmManager.chat({
      messages: options.messages,
      systemPrompt: options.systemPrompt,
      ...options,
    });
  }

  /**
   * 调用工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<any>} 工具执行结果
   */
  async callTool(toolName, params, context = {}) {
    if (!this.functionCaller) {
      throw new Error("FunctionCaller 未设置");
    }

    return await this.functionCaller.call(toolName, params, context);
  }

  /**
   * 延迟
   * @private
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取 Agent 状态
   * @returns {Object}
   */
  getState() {
    return { ...this.state };
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      averageTime:
        this.stats.totalExecutions > 0
          ? this.stats.totalTime / this.stats.totalExecutions
          : 0,
      successRate:
        this.stats.totalExecutions > 0
          ? (
              (this.stats.successfulExecutions / this.stats.totalExecutions) *
              100
            ).toFixed(2) + "%"
          : "N/A",
    };
  }

  /**
   * 获取 Agent 描述信息
   * @returns {Object}
   */
  getInfo() {
    return {
      agentId: this.agentId,
      description: this.description,
      capabilities: this.capabilities,
      priority: this.priority,
      state: this.getState(),
      stats: this.getStats(),
    };
  }

  /**
   * 销毁 Agent
   */
  destroy() {
    this.removeAllListeners();
    this.llmManager = null;
    this.functionCaller = null;
  }
}

module.exports = { SpecializedAgent };
