/**
 * 工具掩码系统
 *
 * 基于 Manus AI 的最佳实践：通过掩码控制工具可用性，而非动态修改工具定义。
 *
 * 核心原则：
 * 1. 工具定义保持不变 - 避免破坏 KV-Cache
 * 2. 通过掩码控制可用性 - 在推理时过滤
 * 3. 使用一致的命名前缀 - 便于批量控制
 * 4. 支持状态机驱动 - 根据任务阶段自动调整
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require("events");

/**
 * 工具掩码管理器
 */
class ToolMaskingSystem extends EventEmitter {
  constructor(options = {}) {
    super();

    // 所有注册的工具（定义不变）
    this.allTools = new Map();

    // 当前可用工具掩码
    this.availableMask = new Set();

    // 工具分组（按前缀）
    this.toolGroups = new Map();

    // 状态机配置
    this.stateMachine = null;
    this.currentState = null;

    // 配置
    this.config = {
      // 是否启用状态机
      enableStateMachine: options.enableStateMachine || false,
      // 是否记录掩码变化
      logMaskChanges: options.logMaskChanges !== false,
      // 默认工具可用性
      defaultAvailable: options.defaultAvailable !== false,
    };

    // 统计
    this.stats = {
      totalTools: 0,
      availableTools: 0,
      blockedCalls: 0,
      maskChanges: 0,
    };
  }

  /**
   * 注册工具
   * @param {Object} tool - 工具定义
   * @param {string} tool.name - 工具名称（建议使用前缀，如 browser_navigate）
   * @param {string} tool.description - 工具描述
   * @param {Object} tool.parameters - 参数定义
   * @param {Function} tool.handler - 处理函数
   */
  registerTool(tool) {
    const { name } = tool;

    if (!name) {
      throw new Error("Tool must have a name");
    }

    // 存储工具定义
    this.allTools.set(name, {
      ...tool,
      registeredAt: Date.now(),
    });

    // 默认可用性
    if (this.config.defaultAvailable) {
      this.availableMask.add(name);
    }

    // 提取前缀并分组
    const prefix = this._extractPrefix(name);
    if (prefix) {
      if (!this.toolGroups.has(prefix)) {
        this.toolGroups.set(prefix, new Set());
      }
      this.toolGroups.get(prefix).add(name);
    }

    this.stats.totalTools++;
    this._updateAvailableCount();

    if (this.config.logMaskChanges) {
      logger.info(`[ToolMasking] 注册工具: ${name} (前缀: ${prefix || "none"})`);
    }
  }

  /**
   * 批量注册工具
   * @param {Array} tools - 工具数组
   */
  registerTools(tools) {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * 提取工具名称前缀
   * @private
   */
  _extractPrefix(name) {
    // 支持 snake_case 和 camelCase
    const snakeMatch = name.match(/^([a-z]+)_/);
    if (snakeMatch) {return snakeMatch[1];}

    const camelMatch = name.match(/^([a-z]+)[A-Z]/);
    if (camelMatch) {return camelMatch[1];}

    return null;
  }

  /**
   * 更新可用工具计数
   * @private
   */
  _updateAvailableCount() {
    this.stats.availableTools = this.availableMask.size;
  }

  // ==========================================
  // 工具可用性控制
  // ==========================================

  /**
   * 设置单个工具的可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用
   */
  setToolAvailability(toolName, available) {
    if (!this.allTools.has(toolName)) {
      logger.warn(`[ToolMasking] 未知工具: ${toolName}`);
      return;
    }

    const wasAvailable = this.availableMask.has(toolName);

    if (available) {
      this.availableMask.add(toolName);
    } else {
      this.availableMask.delete(toolName);
    }

    if (wasAvailable !== available) {
      this.stats.maskChanges++;
      this._updateAvailableCount();

      if (this.config.logMaskChanges) {
        logger.info(
          `[ToolMasking] ${toolName}: ${wasAvailable ? "启用" : "禁用"} → ${available ? "启用" : "禁用"}`,
        );
      }

      this.emit("mask-changed", {
        tool: toolName,
        available,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 按前缀批量设置工具可用性
   * @param {string} prefix - 工具前缀（如 browser, file, git）
   * @param {boolean} available - 是否可用
   */
  setToolsByPrefix(prefix, available) {
    const group = this.toolGroups.get(prefix);
    if (!group) {
      logger.warn(`[ToolMasking] 未知前缀: ${prefix}`);
      return;
    }

    for (const toolName of group) {
      this.setToolAvailability(toolName, available);
    }

    if (this.config.logMaskChanges) {
      logger.info(
        `[ToolMasking] 前缀 "${prefix}" (${group.size} 个工具): ${available ? "启用" : "禁用"}`,
      );
    }
  }

  /**
   * 设置多个工具的可用性
   * @param {Object} mask - 掩码对象 { toolName: boolean, ... }
   */
  setMask(mask) {
    for (const [toolName, available] of Object.entries(mask)) {
      this.setToolAvailability(toolName, available);
    }
  }

  /**
   * 启用所有工具
   */
  enableAll() {
    for (const name of this.allTools.keys()) {
      this.availableMask.add(name);
    }
    this._updateAvailableCount();

    if (this.config.logMaskChanges) {
      logger.info(`[ToolMasking] 启用所有工具 (${this.stats.availableTools})`);
    }
  }

  /**
   * 禁用所有工具
   */
  disableAll() {
    this.availableMask.clear();
    this._updateAvailableCount();

    if (this.config.logMaskChanges) {
      logger.info("[ToolMasking] 禁用所有工具");
    }
  }

  /**
   * 只启用指定的工具
   * @param {Array<string>} toolNames - 要启用的工具名称
   */
  setOnlyAvailable(toolNames) {
    this.disableAll();
    for (const name of toolNames) {
      if (this.allTools.has(name)) {
        this.availableMask.add(name);
      }
    }
    this._updateAvailableCount();
  }

  // ==========================================
  // 工具查询
  // ==========================================

  /**
   * 检查工具是否可用
   * @param {string} toolName - 工具名称
   * @returns {boolean}
   */
  isToolAvailable(toolName) {
    return this.availableMask.has(toolName);
  }

  /**
   * 获取工具定义（始终返回完整列表，用于 LLM 上下文）
   * @returns {Array} 所有工具定义
   */
  getAllToolDefinitions() {
    return Array.from(this.allTools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * 获取可用工具定义（用于验证）
   * @returns {Array} 可用工具定义
   */
  getAvailableToolDefinitions() {
    return Array.from(this.allTools.values())
      .filter((tool) => this.availableMask.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  /**
   * 获取当前掩码
   * @returns {Set} 可用工具名称集合
   */
  getAvailabilityMask() {
    return new Set(this.availableMask);
  }

  /**
   * 获取所有工具分组
   * @returns {Object} 分组信息
   */
  getToolGroups() {
    const groups = {};
    for (const [prefix, tools] of this.toolGroups) {
      groups[prefix] = {
        tools: Array.from(tools),
        count: tools.size,
        availableCount: Array.from(tools).filter((t) =>
          this.availableMask.has(t),
        ).length,
      };
    }
    return groups;
  }

  // ==========================================
  // 工具调用验证
  // ==========================================

  /**
   * 验证工具调用是否被允许
   * @param {string} toolName - 工具名称
   * @returns {Object} 验证结果
   */
  validateCall(toolName) {
    if (!this.allTools.has(toolName)) {
      return {
        allowed: false,
        reason: "tool_not_found",
        message: `工具 "${toolName}" 不存在`,
      };
    }

    if (!this.availableMask.has(toolName)) {
      this.stats.blockedCalls++;
      return {
        allowed: false,
        reason: "tool_masked",
        message: `工具 "${toolName}" 当前被禁用`,
      };
    }

    return {
      allowed: true,
      tool: this.allTools.get(toolName),
    };
  }

  /**
   * 执行工具调用（带掩码验证）
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<any>} 执行结果
   */
  async executeWithMask(toolName, params, context) {
    const validation = this.validateCall(toolName);

    if (!validation.allowed) {
      throw new Error(validation.message);
    }

    const tool = validation.tool;
    return await tool.handler(params, context);
  }

  // ==========================================
  // 状态机支持
  // ==========================================

  /**
   * 配置状态机
   *
   * 状态机定义示例：
   * {
   *   states: {
   *     'planning': {
   *       availableTools: ['file_reader', 'info_searcher'],
   *       availablePrefixes: ['search']
   *     },
   *     'executing': {
   *       availableTools: ['file_writer', 'git_commit'],
   *       availablePrefixes: ['file', 'git']
   *     },
   *     'reviewing': {
   *       availableTools: ['file_reader'],
   *       availablePrefixes: ['search']
   *     }
   *   },
   *   transitions: {
   *     'planning': ['executing'],
   *     'executing': ['reviewing', 'planning'],
   *     'reviewing': ['executing', 'planning']
   *   }
   * }
   *
   * @param {Object} config - 状态机配置
   */
  configureStateMachine(config) {
    this.stateMachine = config;
    this.config.enableStateMachine = true;

    if (this.config.logMaskChanges) {
      logger.info(
        `[ToolMasking] 状态机已配置: ${Object.keys(config.states || {}).length} 个状态`,
      );
    }
  }

  /**
   * 切换到指定状态
   * @param {string} state - 目标状态
   */
  transitionTo(state) {
    if (!this.stateMachine) {
      logger.warn("[ToolMasking] 状态机未配置");
      return false;
    }

    const stateConfig = this.stateMachine.states[state];
    if (!stateConfig) {
      logger.warn(`[ToolMasking] 未知状态: ${state}`);
      return false;
    }

    // 检查转换是否合法
    if (this.currentState) {
      const allowedTransitions =
        this.stateMachine.transitions?.[this.currentState] || [];
      if (!allowedTransitions.includes(state)) {
        logger.warn(
          `[ToolMasking] 非法转换: ${this.currentState} → ${state}`,
        );
        return false;
      }
    }

    // 应用状态配置
    this.disableAll();

    // 启用指定工具
    if (stateConfig.availableTools) {
      for (const tool of stateConfig.availableTools) {
        this.setToolAvailability(tool, true);
      }
    }

    // 启用指定前缀
    if (stateConfig.availablePrefixes) {
      for (const prefix of stateConfig.availablePrefixes) {
        this.setToolsByPrefix(prefix, true);
      }
    }

    const previousState = this.currentState;
    this.currentState = state;

    if (this.config.logMaskChanges) {
      logger.info(
        `[ToolMasking] 状态转换: ${previousState || "initial"} → ${state}`,
      );
    }

    this.emit("state-changed", {
      from: previousState,
      to: state,
      availableTools: this.stats.availableTools,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 获取当前状态
   * @returns {string|null} 当前状态
   */
  getCurrentState() {
    return this.currentState;
  }

  /**
   * 获取可用的状态转换
   * @returns {Array<string>} 可转换的目标状态
   */
  getAvailableTransitions() {
    if (!this.stateMachine || !this.currentState) {
      return [];
    }
    return this.stateMachine.transitions?.[this.currentState] || [];
  }

  // ==========================================
  // 统计和调试
  // ==========================================

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    return {
      ...this.stats,
      currentState: this.currentState,
      availableRatio:
        this.stats.totalTools > 0
          ? (this.stats.availableTools / this.stats.totalTools).toFixed(2)
          : 0,
    };
  }

  /**
   * 导出当前配置（用于调试）
   * @returns {Object} 配置快照
   */
  exportConfig() {
    return {
      tools: Array.from(this.allTools.entries()).map(([name, tool]) => ({
        name,
        available: this.availableMask.has(name),
        prefix: this._extractPrefix(name),
      })),
      groups: this.getToolGroups(),
      stateMachine: this.stateMachine,
      currentState: this.currentState,
      stats: this.getStats(),
    };
  }

  /**
   * 重置系统
   */
  reset() {
    this.availableMask.clear();
    this.currentState = null;
    this.stats.blockedCalls = 0;
    this.stats.maskChanges = 0;

    // 恢复默认可用性
    if (this.config.defaultAvailable) {
      this.enableAll();
    }

    if (this.config.logMaskChanges) {
      logger.info("[ToolMasking] 系统已重置");
    }
  }
}

// 预定义的任务阶段状态机
const TASK_PHASE_STATE_MACHINE = {
  states: {
    // 规划阶段：只允许读取和搜索
    planning: {
      availableTools: ["file_reader", "info_searcher", "format_output"],
      availablePrefixes: ["search", "query"],
    },
    // 执行阶段：允许写入和修改
    executing: {
      availableTools: [
        "file_reader",
        "file_writer",
        "file_editor",
        "html_generator",
        "css_generator",
        "js_generator",
        "create_project_structure",
      ],
      availablePrefixes: ["file", "html", "css", "js", "git", "code"],
    },
    // 验证阶段：只允许读取和测试
    validating: {
      availableTools: ["file_reader", "format_output"],
      availablePrefixes: ["test", "validate", "check"],
    },
    // 提交阶段：允许 Git 操作
    committing: {
      availableTools: ["git_init", "git_commit", "file_reader"],
      availablePrefixes: ["git"],
    },
  },
  transitions: {
    planning: ["executing"],
    executing: ["validating", "planning"],
    validating: ["committing", "executing", "planning"],
    committing: ["planning"],
  },
};

// 单例
let toolMaskingInstance = null;

/**
 * 获取工具掩码系统单例
 * @param {Object} options - 配置选项
 * @returns {ToolMaskingSystem}
 */
function getToolMaskingSystem(options = {}) {
  if (!toolMaskingInstance) {
    toolMaskingInstance = new ToolMaskingSystem(options);
  }
  return toolMaskingInstance;
}

module.exports = {
  ToolMaskingSystem,
  getToolMaskingSystem,
  TASK_PHASE_STATE_MACHINE,
};
