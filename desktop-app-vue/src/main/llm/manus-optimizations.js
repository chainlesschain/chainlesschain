/**
 * Manus 优化集成模块
 *
 * 将 Context Engineering 和 Tool Masking 集成到 LLM 调用流程中。
 *
 * 主要功能：
 * 1. KV-Cache 友好的 Prompt 构建
 * 2. 工具掩码控制
 * 3. 任务追踪和目标重述
 * 4. 可恢复压缩
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

const {
  ContextEngineering,
  RecoverableCompressor,
  getContextEngineering,
} = require("./context-engineering");

const {
  ToolMaskingSystem,
  getToolMaskingSystem,
  TASK_PHASE_STATE_MACHINE,
} = require("../ai-engine/tool-masking");

// 🔥 任务追踪文件系统 (todo.md 机制)
const { logger } = require("../utils/logger.js");
const { getTaskTrackerFile } = require("../ai-engine/task-tracker-file");

/**
 * Manus 优化管理器
 *
 * 协调 Context Engineering 和 Tool Masking 的工作
 */
class ManusOptimizations {
  constructor(options = {}) {
    // 初始化 Context Engineering
    this.contextEngineering =
      options.contextEngineering ||
      getContextEngineering({
        enableKVCacheOptimization: options.enableKVCacheOptimization !== false,
        enableTodoMechanism: options.enableTodoMechanism !== false,
        preserveErrors: options.preserveErrors !== false,
        maxPreservedErrors: options.maxPreservedErrors || 5,
      });

    // 初始化 Tool Masking
    this.toolMasking =
      options.toolMasking ||
      getToolMaskingSystem({
        enableStateMachine: options.enableStateMachine || false,
        logMaskChanges: options.logMaskChanges !== false,
        defaultAvailable: options.defaultToolsAvailable !== false,
      });

    // 初始化可恢复压缩器
    this.compressor = new RecoverableCompressor();

    // 🔥 初始化任务追踪文件系统
    this.taskTracker = null;
    if (options.enableTaskTracking !== false) {
      try {
        this.taskTracker = getTaskTrackerFile({
          autoSave: options.autoSaveTask !== false,
          preserveHistory: options.preserveTaskHistory !== false,
        });
      } catch (error) {
        logger.warn(
          "[ManusOptimizations] TaskTrackerFile 初始化失败:",
          error.message,
        );
      }
    }

    // 配置
    this.config = {
      enabled: options.enabled !== false,
      enableKVCacheOptimization: options.enableKVCacheOptimization !== false,
      enableToolMasking: options.enableToolMasking !== false,
      enableTaskTracking: options.enableTaskTracking !== false,
      enableRecoverableCompression:
        options.enableRecoverableCompression !== false,
      // 🔥 使用文件系统持久化任务
      enableFileBasedTaskTracking:
        options.enableFileBasedTaskTracking !== false,
    };

    // 当前任务上下文
    this.currentTask = null;

    /** @type {Object|null} UnifiedToolRegistry for skill-aware prompts */
    this.unifiedRegistry = null;

    logger.info("[ManusOptimizations] 初始化完成", {
      kvCache: this.config.enableKVCacheOptimization,
      toolMasking: this.config.enableToolMasking,
      taskTracking: this.config.enableTaskTracking,
      fileBasedTask:
        this.config.enableFileBasedTaskTracking && !!this.taskTracker,
    });
  }

  // ==========================================
  // Registry Binding
  // ==========================================

  /**
   * Bind UnifiedToolRegistry for skill-aware prompt building.
   * When bound, buildOptimizedPrompt will include skill context (instructions, examples).
   * @param {Object} registry - UnifiedToolRegistry instance
   */
  bindUnifiedRegistry(registry) {
    this.unifiedRegistry = registry;
    logger.info("[ManusOptimizations] UnifiedToolRegistry bound");
  }

  // ==========================================
  // Prompt 优化
  // ==========================================

  /**
   * 构建优化后的 Prompt
   *
   * @param {Object} options - 构建选项
   * @param {string} options.systemPrompt - 系统提示词
   * @param {Array} options.messages - 对话历史
   * @param {Array} options.tools - 工具定义（可选，默认使用掩码系统的工具）
   * @returns {Object} 优化后的消息和元数据
   */
  buildOptimizedPrompt(options) {
    if (!this.config.enabled || !this.config.enableKVCacheOptimization) {
      // 不优化，直接返回原始消息
      return {
        messages: this._buildBasicMessages(options),
        metadata: { optimized: false },
      };
    }

    // 获取工具定义
    const tools =
      options.tools ||
      (this.config.enableToolMasking
        ? this.toolMasking.getAllToolDefinitions()
        : []);

    // 使用 Context Engineering 构建优化 Prompt
    // Pass unifiedRegistry so skill context (instructions, examples) is injected into the prompt
    return this.contextEngineering.buildOptimizedPrompt({
      systemPrompt: options.systemPrompt,
      messages: options.messages || [],
      tools,
      taskContext: this.currentTask,
      unifiedRegistry: this.unifiedRegistry,
    });
  }

  /**
   * 构建基础消息（不优化）
   * @private
   */
  _buildBasicMessages(options) {
    const messages = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    if (options.messages) {
      messages.push(...options.messages);
    }

    return messages;
  }

  // ==========================================
  // 工具掩码控制
  // ==========================================

  /**
   * 设置工具可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用
   */
  setToolAvailable(toolName, available) {
    if (!this.config.enableToolMasking) {
      return;
    }
    this.toolMasking.setToolAvailability(toolName, available);
  }

  /**
   * 按前缀设置工具可用性
   * @param {string} prefix - 工具前缀
   * @param {boolean} available - 是否可用
   */
  setToolsByPrefix(prefix, available) {
    if (!this.config.enableToolMasking) {
      return;
    }
    this.toolMasking.setToolsByPrefix(prefix, available);
  }

  /**
   * 验证工具调用
   * @param {string} toolName - 工具名称
   * @returns {Object} 验证结果
   */
  validateToolCall(toolName) {
    if (!this.config.enableToolMasking) {
      return { allowed: true };
    }
    return this.toolMasking.validateCall(toolName);
  }

  /**
   * 获取可用工具列表
   * @returns {Array} 工具定义
   */
  getAvailableTools() {
    if (!this.config.enableToolMasking) {
      return this.toolMasking.getAllToolDefinitions();
    }
    return this.toolMasking.getAvailableToolDefinitions();
  }

  // ==========================================
  // 任务追踪 (集成 TaskTrackerFile)
  // ==========================================

  /**
   * 开始新任务
   * @param {Object} task - 任务信息
   * @param {string} task.objective - 任务目标
   * @param {Array} task.steps - 任务步骤
   */
  async startTask(task) {
    if (!this.config.enableTaskTracking) {
      return null;
    }

    // 🔥 使用文件系统持久化
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      try {
        const createdTask = await this.taskTracker.createTask({
          objective: task.objective,
          steps: task.steps || [],
          metadata: task.metadata || {},
        });
        await this.taskTracker.startTask();
        this.currentTask = createdTask;
      } catch (error) {
        logger.warn(
          "[ManusOptimizations] TaskTrackerFile 创建失败，使用内存模式:",
          error.message,
        );
        this._createMemoryTask(task);
      }
    } else {
      this._createMemoryTask(task);
    }

    this.contextEngineering.setCurrentTask(this.currentTask);

    // 如果启用状态机，切换到规划阶段
    if (this.config.enableToolMasking && this.toolMasking.stateMachine) {
      this.toolMasking.transitionTo("planning");
    }

    logger.info(`[ManusOptimizations] 开始任务: ${task.objective}`);
    return this.currentTask;
  }

  /**
   * 创建内存任务（备用）
   * @private
   */
  _createMemoryTask(task) {
    this.currentTask = {
      id: Date.now().toString(36),
      objective: task.objective,
      steps: (task.steps || []).map((step, index) => ({
        index,
        description: typeof step === "string" ? step : step.description,
        status: "pending",
      })),
      currentStep: 0,
      status: "started",
      startedAt: Date.now(),
    };
  }

  /**
   * 更新任务进度
   * @param {number} stepIndex - 当前步骤索引
   * @param {string} status - 状态
   */
  async updateTaskProgress(stepIndex, status = "in_progress") {
    if (!this.config.enableTaskTracking || !this.currentTask) {
      return;
    }

    // 🔥 使用文件系统更新
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      try {
        await this.taskTracker.updateProgress(stepIndex, status);
      } catch (error) {
        logger.warn(
          "[ManusOptimizations] TaskTrackerFile 更新失败:",
          error.message,
        );
      }
    }

    this.currentTask.currentStep = stepIndex;
    this.currentTask.status = status;

    this.contextEngineering.updateTaskProgress(stepIndex, status);

    // 根据状态自动切换工具掩码
    if (this.config.enableToolMasking && this.toolMasking.stateMachine) {
      if (status === "executing") {
        this.toolMasking.transitionTo("executing");
      } else if (status === "validating") {
        this.toolMasking.transitionTo("validating");
      }
    }

    logger.info(
      `[ManusOptimizations] 任务进度: 步骤 ${stepIndex + 1}, 状态: ${status}`,
    );
  }

  /**
   * 完成当前步骤
   * @param {Object} result - 步骤结果
   */
  async completeCurrentStep(result = null) {
    if (!this.currentTask) {
      return;
    }

    // 🔥 使用文件系统完成步骤
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      try {
        await this.taskTracker.completeCurrentStep(result);
        this.currentTask = this.taskTracker.getCurrentTask();
        return;
      } catch (error) {
        logger.warn(
          "[ManusOptimizations] TaskTrackerFile 完成步骤失败:",
          error.message,
        );
      }
    }

    const currentStep = this.currentTask.currentStep;
    if (currentStep < this.currentTask.steps.length - 1) {
      await this.updateTaskProgress(currentStep + 1, "in_progress");
    } else {
      await this.completeTask();
    }
  }

  /**
   * 完成任务
   * @param {Object} result - 任务结果
   */
  async completeTask(result = null) {
    if (!this.currentTask) {
      return;
    }

    // 🔥 使用文件系统完成任务
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      try {
        await this.taskTracker.completeTask(result);
      } catch (error) {
        logger.warn(
          "[ManusOptimizations] TaskTrackerFile 完成任务失败:",
          error.message,
        );
      }
    }

    this.currentTask.status = "completed";
    this.currentTask.completedAt = Date.now();

    logger.info(`[ManusOptimizations] 任务完成: ${this.currentTask.objective}`);

    // 切换到提交阶段
    if (this.config.enableToolMasking && this.toolMasking.stateMachine) {
      this.toolMasking.transitionTo("committing");
    }

    this.contextEngineering.clearTask();
    this.currentTask = null;
  }

  /**
   * 取消任务
   * @param {string} reason - 取消原因
   */
  async cancelTask(reason = "用户取消") {
    if (!this.currentTask) {
      return;
    }

    // 🔥 使用文件系统取消任务
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      try {
        await this.taskTracker.cancelTask(reason);
      } catch (error) {
        logger.warn(
          "[ManusOptimizations] TaskTrackerFile 取消任务失败:",
          error.message,
        );
      }
    }

    this.currentTask.status = "cancelled";
    this.currentTask.cancelledAt = Date.now();

    logger.info(`[ManusOptimizations] 任务取消: ${this.currentTask.objective}`);

    this.contextEngineering.clearTask();
    this.currentTask = null;

    // 重置工具掩码
    if (this.config.enableToolMasking) {
      this.toolMasking.reset();
    }
  }

  /**
   * 获取当前任务
   * @returns {Object|null} 当前任务
   */
  getCurrentTask() {
    return this.currentTask;
  }

  /**
   * 获取 todo.md 上下文（用于注入到 prompt 末尾）
   * @returns {Promise<string|null>}
   */
  async getTodoContext() {
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      return await this.taskTracker.getTodoContext();
    }
    return null;
  }

  /**
   * 恢复未完成的任务
   * @returns {Promise<Object|null>}
   */
  async resumeUnfinishedTask() {
    if (!this.config.enableFileBasedTaskTracking || !this.taskTracker) {
      return null;
    }

    try {
      const task = await this.taskTracker.loadUnfinishedTask();
      if (task) {
        this.currentTask = task;
        this.contextEngineering.setCurrentTask(task);
        logger.info(`[ManusOptimizations] 已恢复未完成任务: ${task.objective}`);
        return task;
      }
    } catch (error) {
      logger.warn("[ManusOptimizations] 恢复任务失败:", error.message);
    }

    return null;
  }

  /**
   * 获取任务历史
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}
   */
  async getTaskHistory(limit = 10) {
    if (!this.config.enableFileBasedTaskTracking || !this.taskTracker) {
      return [];
    }

    try {
      return await this.taskTracker.getTaskHistory(limit);
    } catch (error) {
      logger.warn("[ManusOptimizations] 获取任务历史失败:", error.message);
      return [];
    }
  }

  /**
   * 保存中间结果
   * @param {number} stepIndex - 步骤索引
   * @param {Object} result - 结果数据
   */
  async saveIntermediateResult(stepIndex, result) {
    if (this.config.enableFileBasedTaskTracking && this.taskTracker) {
      await this.taskTracker.saveIntermediateResult(stepIndex, result);
    }
  }

  // ==========================================
  // 错误处理
  // ==========================================

  /**
   * 记录错误（供模型学习）
   * @param {Object} error - 错误信息
   */
  recordError(error) {
    this.contextEngineering.recordError({
      step: this.currentTask?.currentStep,
      message: error.message || String(error),
      stack: error.stack,
    });
  }

  /**
   * 标记错误已解决
   * @param {string} resolution - 解决方案
   */
  resolveLastError(resolution) {
    const errors = this.contextEngineering.errorHistory;
    if (errors.length > 0) {
      this.contextEngineering.resolveError(errors.length - 1, resolution);
    }
  }

  // ==========================================
  // 可恢复压缩
  // ==========================================

  /**
   * 压缩内容
   * @param {any} content - 原始内容
   * @param {string} type - 内容类型
   * @returns {Object} 压缩后的引用
   */
  compress(content, type = "default") {
    if (!this.config.enableRecoverableCompression) {
      return content;
    }
    return this.compressor.compress(content, type);
  }

  /**
   * 检查是否为压缩引用
   * @param {any} data - 数据
   * @returns {boolean}
   */
  isCompressedRef(data) {
    return this.compressor.isCompressedRef(data);
  }

  /**
   * 恢复压缩内容
   * @param {Object} ref - 压缩引用
   * @param {Object} recoveryFunctions - 恢复函数集
   * @returns {Promise<any>}
   */
  async recover(ref, recoveryFunctions) {
    return await this.compressor.recover(ref, recoveryFunctions);
  }

  // ==========================================
  // 状态机控制
  // ==========================================

  /**
   * 配置任务阶段状态机
   * @param {Object} config - 状态机配置（可选，默认使用预定义配置）
   */
  configureTaskPhases(config = null) {
    this.toolMasking.configureStateMachine(config || TASK_PHASE_STATE_MACHINE);
  }

  /**
   * 切换到指定阶段
   * @param {string} phase - 阶段名称
   * @returns {boolean} 是否成功
   */
  transitionToPhase(phase) {
    return this.toolMasking.transitionTo(phase);
  }

  /**
   * 获取当前阶段
   * @returns {string|null}
   */
  getCurrentPhase() {
    return this.toolMasking.getCurrentState();
  }

  // ==========================================
  // 统计和调试
  // ==========================================

  /**
   * 获取综合统计
   * @returns {Object} 统计数据
   */
  getStats() {
    return {
      contextEngineering: this.contextEngineering.getStats(),
      toolMasking: this.toolMasking.getStats(),
      currentTask: this.currentTask
        ? {
            id: this.currentTask.id,
            objective: this.currentTask.objective,
            currentStep: this.currentTask.currentStep,
            totalSteps: this.currentTask.steps?.length || 0,
            status: this.currentTask.status,
          }
        : null,
      config: this.config,
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.contextEngineering.resetStats();
  }

  /**
   * 导出调试信息
   * @returns {Object}
   */
  exportDebugInfo() {
    return {
      stats: this.getStats(),
      toolMaskingConfig: this.toolMasking.exportConfig(),
      currentTask: this.currentTask,
      errorHistory: this.contextEngineering.errorHistory,
    };
  }
}

// 单例
let manusOptimizationsInstance = null;

/**
 * 获取 Manus 优化管理器单例
 * @param {Object} options - 配置选项
 * @returns {ManusOptimizations}
 */
function getManusOptimizations(options = {}) {
  if (!manusOptimizationsInstance) {
    manusOptimizationsInstance = new ManusOptimizations(options);
  }
  return manusOptimizationsInstance;
}

/**
 * 创建新的 Manus 优化管理器实例（非单例）
 * @param {Object} options - 配置选项
 * @returns {ManusOptimizations}
 */
function createManusOptimizations(options = {}) {
  return new ManusOptimizations(options);
}

module.exports = {
  ManusOptimizations,
  getManusOptimizations,
  createManusOptimizations,
  // 重新导出子模块
  ContextEngineering,
  RecoverableCompressor,
  getContextEngineering,
  ToolMaskingSystem,
  getToolMaskingSystem,
  TASK_PHASE_STATE_MACHINE,
};
