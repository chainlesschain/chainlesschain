/**
 * Context Engineering 模块
 *
 * 基于 Manus AI 的最佳实践，优化 LLM 上下文构建以最大化 KV-Cache 命中率。
 *
 * 核心原则（来自 Manus Blog）：
 * 1. 保持 prompt 前缀稳定 - 避免时间戳等动态内容破坏缓存
 * 2. 采用只读追加模式 - 确保序列化确定性
 * 3. 显式标记缓存断点 - 优化缓存边界
 * 4. 将任务目标重述到上下文末尾 - 解决"丢失中间"问题
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

const crypto = require("crypto");

/**
 * 上下文工程管理器
 */
class ContextEngineering {
  constructor(options = {}) {
    // 配置
    this.config = {
      // 是否启用 KV-Cache 优化
      enableKVCacheOptimization: options.enableKVCacheOptimization !== false,
      // 是否启用 todo.md 机制
      enableTodoMechanism: options.enableTodoMechanism !== false,
      // 最大历史消息数（超过后触发压缩）
      maxHistoryMessages: options.maxHistoryMessages || 50,
      // 缓存断点位置
      cacheBreakpoints: [],
      // 是否保留错误信息（Manus 建议保留）
      preserveErrors: options.preserveErrors !== false,
      // 最大保留的错误数
      maxPreservedErrors: options.maxPreservedErrors || 5,
    };

    // 静态 prompt 缓存（用于检测变化）
    this.staticPromptHash = null;

    // 工具定义缓存
    this.toolDefinitionsHash = null;
    this.cachedToolDefinitions = null;

    // 错误历史（用于模型学习）
    this.errorHistory = [];

    // 任务追踪状态
    this.currentTask = null;

    // 统计
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      totalCalls: 0,
      compressionSavings: 0,
    };
  }

  /**
   * 构建 KV-Cache 友好的 Prompt
   *
   * 关键策略：
   * - 静态部分（system prompt + 工具定义）放在最前面
   * - 动态部分（对话历史 + 用户输入）追加在后面
   * - 任务目标重述在最末尾
   *
   * @param {Object} options - 构建选项
   * @param {string} options.systemPrompt - 系统提示词
   * @param {Array} options.messages - 对话历史
   * @param {Array} options.tools - 工具定义
   * @param {Object} options.taskContext - 任务上下文
   * @returns {Object} 优化后的消息数组和元数据
   */
  buildOptimizedPrompt(options) {
    const {
      systemPrompt,
      messages = [],
      tools = [],
      taskContext = null,
      unifiedRegistry = null,
    } = options;

    this.stats.totalCalls++;

    const result = {
      messages: [],
      metadata: {
        cacheBreakpoints: [],
        staticPartLength: 0,
        dynamicPartLength: 0,
        wasCacheOptimized: false,
      },
    };

    // === 第一部分：静态内容（高度稳定，可缓存） ===

    // 1. System Prompt（不包含时间戳等动态内容）
    const cleanedSystemPrompt = this._cleanSystemPrompt(systemPrompt);
    result.messages.push({
      role: "system",
      content: cleanedSystemPrompt,
    });

    // 2. 工具定义（确定性序列化，优先使用统一注册表的技能分组）
    if (unifiedRegistry && unifiedRegistry.skills?.size > 0) {
      const toolDefinitions =
        this._serializeToolsWithSkillContext(unifiedRegistry);
      result.messages.push({
        role: "system",
        content: `## Available Tools (by Skill)\n${toolDefinitions}`,
      });
    } else if (tools.length > 0) {
      const toolDefinitions = this._serializeToolDefinitions(tools);
      result.messages.push({
        role: "system",
        content: `## Available Tools\n${toolDefinitions}`,
      });
    }

    // 标记静态部分结束位置（缓存断点）
    result.metadata.cacheBreakpoints.push(result.messages.length);
    result.metadata.staticPartLength = result.messages.length;

    // === 第二部分：动态内容（只追加，不修改） ===

    // 3. 对话历史（清理后追加）
    const cleanedMessages = this._cleanMessages(messages);
    result.messages.push(...cleanedMessages);

    // 4. 错误上下文（如果启用且有错误历史）
    if (this.config.preserveErrors && this.errorHistory.length > 0) {
      const errorContext = this._buildErrorContext();
      result.messages.push({
        role: "system",
        content: errorContext,
      });
    }

    // === 第三部分：任务重述（解决"丢失中间"问题） ===

    // 5. 任务目标重述（如果有任务上下文）
    if (taskContext && this.config.enableTodoMechanism) {
      const taskReminder = this._buildTaskReminder(taskContext);
      result.messages.push({
        role: "system",
        content: taskReminder,
      });
    }

    result.metadata.dynamicPartLength =
      result.messages.length - result.metadata.staticPartLength;

    // 检查是否命中缓存（静态部分未变化）
    const currentHash = this._computeStaticHash(cleanedSystemPrompt, tools);
    if (this.staticPromptHash === currentHash) {
      this.stats.cacheHits++;
      result.metadata.wasCacheOptimized = true;
    } else {
      this.stats.cacheMisses++;
      this.staticPromptHash = currentHash;
    }

    return result;
  }

  /**
   * 清理 System Prompt，移除动态内容
   * @private
   */
  _cleanSystemPrompt(systemPrompt) {
    if (!systemPrompt) {
      return "";
    }

    let cleaned = systemPrompt;

    // 移除时间戳模式
    cleaned = cleaned.replace(
      /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?\b/g,
      "[DATE]",
    );
    cleaned = cleaned.replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, "[TIME]");

    // 移除随机 ID 模式
    cleaned = cleaned.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[UUID]",
    );

    // 移除会话 ID 等动态标识
    cleaned = cleaned.replace(
      /session[_-]?id\s*[:=]\s*\S+/gi,
      "session_id: [SESSION]",
    );

    return cleaned;
  }

  /**
   * 序列化工具定义（确保确定性）
   * @private
   */
  _serializeToolDefinitions(tools) {
    // 按名称排序，确保顺序一致
    const sorted = [...tools].sort((a, b) => {
      const nameA = a.name || a.function?.name || "";
      const nameB = b.name || b.function?.name || "";
      return nameA.localeCompare(nameB);
    });

    // 计算哈希检查是否需要重新序列化
    const hash = this._computeHash(JSON.stringify(sorted));
    if (hash === this.toolDefinitionsHash && this.cachedToolDefinitions) {
      return this.cachedToolDefinitions;
    }

    // 生成格式化的工具定义
    const definitions = sorted.map((tool, index) => {
      const name = tool.name || tool.function?.name || `tool_${index}`;
      const description =
        tool.description || tool.function?.description || "No description";
      const parameters =
        tool.parameters || tool.function?.parameters || tool.input_schema || {};

      return `### ${name}
${description}

Parameters:
${JSON.stringify(parameters, null, 2)}`;
    });

    this.toolDefinitionsHash = hash;
    this.cachedToolDefinitions = definitions.join("\n\n");

    return this.cachedToolDefinitions;
  }

  /**
   * Serialize tools grouped by skill with instructions and examples
   * @private
   * @param {Object} registry - UnifiedToolRegistry instance
   * @returns {string} Formatted tool definitions grouped by skill
   */
  _serializeToolsWithSkillContext(registry) {
    const MAX_INSTRUCTIONS_LENGTH = 200;
    const MAX_EXAMPLES_PER_SKILL = 3;
    const MAX_PARAMS_LENGTH = 500;

    const skills = registry.getSkillManifest();
    const allTools = registry.getAllTools();

    // Sort skills by name for deterministic output
    skills.sort((a, b) => a.name.localeCompare(b.name));

    const sections = [];

    for (const skill of skills) {
      const skillTools = skill.toolNames
        .map((tn) => allTools.find((t) => t.name === tn))
        .filter((t) => t && t.available !== false);

      if (skillTools.length === 0) {
        continue;
      }

      let section = `## Skill: ${skill.displayName || skill.name}\n${skill.description || ""}`;

      // Add instructions (truncated)
      if (skill.instructions) {
        const instr =
          skill.instructions.length > MAX_INSTRUCTIONS_LENGTH
            ? skill.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH) + "..."
            : skill.instructions;
        section += `\n\n### Instructions\n${instr}`;
      }

      // Add examples (limited)
      if (skill.examples && skill.examples.length > 0) {
        const exampleLines = skill.examples
          .slice(0, MAX_EXAMPLES_PER_SKILL)
          .map((ex) => {
            const params = ex.params ? JSON.stringify(ex.params) : "";
            return `- "${ex.input}" → ${ex.tool}${params ? " " + params : ""}`;
          });
        section += `\n\n### Examples\n${exampleLines.join("\n")}`;
      }

      // Add tool definitions
      section += "\n\n### Tools";
      for (const tool of skillTools) {
        let paramStr = "";
        try {
          paramStr = JSON.stringify(tool.parameters || {}, null, 2);
          if (paramStr.length > MAX_PARAMS_LENGTH) {
            paramStr = paramStr.slice(0, MAX_PARAMS_LENGTH) + "\n...}";
          }
        } catch {
          paramStr = "{}";
        }
        section += `\n#### ${tool.name}\n${tool.description || "No description"}\nParameters:\n${paramStr}`;
      }

      sections.push(section);
    }

    // Add ungrouped tools (those without a skill)
    const ungroupedTools = allTools.filter(
      (t) => !t.skillName && t.available !== false,
    );
    if (ungroupedTools.length > 0) {
      let section = "## Other Tools";
      for (const tool of ungroupedTools) {
        let paramStr = "";
        try {
          paramStr = JSON.stringify(tool.parameters || {}, null, 2);
          if (paramStr.length > MAX_PARAMS_LENGTH) {
            paramStr = paramStr.slice(0, MAX_PARAMS_LENGTH) + "\n...}";
          }
        } catch {
          paramStr = "{}";
        }
        section += `\n### ${tool.name}\n${tool.description || "No description"}\nParameters:\n${paramStr}`;
      }
      sections.push(section);
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * 清理消息数组，移除动态内容
   * @private
   */
  _cleanMessages(messages) {
    return messages.map((msg) => {
      const cleaned = { ...msg };

      // 移除不必要的元数据
      delete cleaned.timestamp;
      delete cleaned.id;
      delete cleaned.messageId;

      // 保留核心字段
      return {
        role: cleaned.role,
        content: cleaned.content,
        // 保留 function/tool 调用信息
        ...(cleaned.function_call && { function_call: cleaned.function_call }),
        ...(cleaned.tool_calls && { tool_calls: cleaned.tool_calls }),
        ...(cleaned.name && { name: cleaned.name }),
      };
    });
  }

  /**
   * 构建错误上下文（供模型学习）
   * @private
   */
  _buildErrorContext() {
    if (this.errorHistory.length === 0) {
      return "";
    }

    const errors = this.errorHistory.slice(-this.config.maxPreservedErrors);

    const lines = ["## Recent Errors (for learning)", ""];

    errors.forEach((error, index) => {
      lines.push(`### Error ${index + 1}`);
      lines.push(`- Step: ${error.step || "unknown"}`);
      lines.push(`- Error: ${error.message}`);
      if (error.resolution) {
        lines.push(`- Resolution: ${error.resolution}`);
      }
      lines.push("");
    });

    return lines.join("\n");
  }

  /**
   * 构建任务提醒（重述目标到上下文末尾）
   * @private
   */
  _buildTaskReminder(taskContext) {
    const lines = [
      "## Current Task Status",
      "",
      `**Objective**: ${taskContext.objective || "Complete the user request"}`,
      "",
    ];

    if (taskContext.steps && taskContext.steps.length > 0) {
      lines.push("**Progress**:");
      taskContext.steps.forEach((step, index) => {
        const marker =
          index < taskContext.currentStep
            ? "[x]"
            : index === taskContext.currentStep
              ? "[>]"
              : "[ ]";
        lines.push(`${marker} Step ${index + 1}: ${step.description || step}`);
      });
      lines.push("");
    }

    if (taskContext.currentStep !== undefined && taskContext.steps) {
      const currentStepDesc =
        taskContext.steps[taskContext.currentStep]?.description ||
        taskContext.steps[taskContext.currentStep] ||
        "unknown";
      lines.push(
        `**Current Focus**: Step ${taskContext.currentStep + 1} - ${currentStepDesc}`,
      );
    }

    return lines.join("\n");
  }

  /**
   * 计算静态部分的哈希值
   * @private
   */
  _computeStaticHash(systemPrompt, tools) {
    const content = JSON.stringify({ systemPrompt, tools });
    return this._computeHash(content);
  }

  /**
   * 计算字符串哈希
   * @private
   */
  _computeHash(content) {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /**
   * 记录错误（供模型学习）
   * @param {Object} error - 错误信息
   */
  recordError(error) {
    this.errorHistory.push({
      step: error.step,
      message: error.message || String(error),
      timestamp: Date.now(),
      resolution: error.resolution,
    });

    // 保持历史记录在限制内
    if (this.errorHistory.length > this.config.maxPreservedErrors * 2) {
      this.errorHistory = this.errorHistory.slice(
        -this.config.maxPreservedErrors,
      );
    }
  }

  /**
   * 标记错误已解决
   * @param {number} errorIndex - 错误索引
   * @param {string} resolution - 解决方案
   */
  resolveError(errorIndex, resolution) {
    if (this.errorHistory[errorIndex]) {
      this.errorHistory[errorIndex].resolution = resolution;
    }
  }

  /**
   * 设置当前任务上下文
   * @param {Object} task - 任务信息
   */
  setCurrentTask(task) {
    this.currentTask = task;
  }

  /**
   * 更新任务进度
   * @param {number} currentStep - 当前步骤
   * @param {string} status - 状态
   */
  updateTaskProgress(currentStep, status) {
    if (this.currentTask) {
      this.currentTask.currentStep = currentStep;
      this.currentTask.status = status;
    }
  }

  /**
   * 获取当前任务上下文
   * @returns {Object|null} 任务上下文
   */
  getCurrentTask() {
    return this.currentTask;
  }

  /**
   * 清除任务上下文
   */
  clearTask() {
    this.currentTask = null;
  }

  /**
   * 清除错误历史
   */
  clearErrors() {
    this.errorHistory = [];
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    const hitRate =
      this.stats.totalCalls > 0
        ? this.stats.cacheHits / this.stats.totalCalls
        : 0;

    return {
      ...this.stats,
      cacheHitRate: hitRate,
      cacheHitRatePercent: (hitRate * 100).toFixed(2) + "%",
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      totalCalls: 0,
      compressionSavings: 0,
    };
  }
}

/**
 * 可恢复压缩器
 *
 * Manus 策略：超长观察数据使用可恢复的压缩——保留 URL/路径，丢弃内容本体
 */
class RecoverableCompressor {
  constructor() {
    // 压缩阈值（字符数）
    this.thresholds = {
      webpage: 2000,
      file: 5000,
      dbResult: 1000,
      default: 3000,
    };
  }

  /**
   * 压缩内容，保留可恢复的引用
   * @param {any} content - 原始内容
   * @param {string} type - 内容类型
   * @returns {Object} 压缩后的引用
   */
  compress(content, type = "default") {
    if (!content) {
      return content;
    }

    const threshold = this.thresholds[type] || this.thresholds.default;

    // 如果内容较短，不压缩
    if (typeof content === "string" && content.length < threshold) {
      return content;
    }

    switch (type) {
      case "webpage":
        return this._compressWebpage(content);
      case "file":
        return this._compressFile(content);
      case "dbResult":
        return this._compressDbResult(content);
      default:
        return this._compressDefault(content);
    }
  }

  _compressWebpage(data) {
    if (typeof data === "string") {
      return {
        _type: "compressed_ref",
        refType: "webpage",
        preview: data.slice(0, 500) + "...",
        originalLength: data.length,
        recoverable: false, // 需要 URL 才能恢复
      };
    }

    return {
      _type: "compressed_ref",
      refType: "webpage",
      url: data.url,
      title: data.title,
      summary: data.summary?.slice(0, 200),
      originalLength: data.content?.length,
      recoverable: !!data.url,
    };
  }

  _compressFile(data) {
    if (typeof data === "string") {
      return {
        _type: "compressed_ref",
        refType: "file",
        preview: data.slice(0, 1000) + "...",
        originalLength: data.length,
        recoverable: false,
      };
    }

    return {
      _type: "compressed_ref",
      refType: "file",
      path: data.path,
      name: data.name || data.path?.split("/").pop(),
      size: data.size || data.content?.length,
      preview: data.content?.slice(0, 500),
      recoverable: !!data.path,
    };
  }

  _compressDbResult(data) {
    const MAX_ROWS = 10;

    if (Array.isArray(data)) {
      return {
        _type: "compressed_ref",
        refType: "dbResult",
        totalRows: data.length,
        preview: data.slice(0, MAX_ROWS),
        recoverable: false,
      };
    }

    return {
      _type: "compressed_ref",
      refType: "dbResult",
      query: data.query,
      totalRows: data.rows?.length,
      columns: data.columns,
      preview: data.rows?.slice(0, MAX_ROWS),
      recoverable: !!data.query,
    };
  }

  _compressDefault(content) {
    if (typeof content === "string") {
      return {
        _type: "compressed_ref",
        refType: "text",
        preview: content.slice(0, 1000) + "...",
        originalLength: content.length,
        recoverable: false,
      };
    }

    try {
      const str = JSON.stringify(content);
      return {
        _type: "compressed_ref",
        refType: "object",
        preview: str.slice(0, 1000) + "...",
        originalLength: str.length,
        recoverable: false,
      };
    } catch {
      return {
        _type: "compressed_ref",
        refType: "unknown",
        preview: String(content).slice(0, 500),
        recoverable: false,
      };
    }
  }

  /**
   * 检查是否为压缩引用
   * @param {any} data - 数据
   * @returns {boolean}
   */
  isCompressedRef(data) {
    return data && data._type === "compressed_ref";
  }

  /**
   * 恢复压缩内容
   * @param {Object} ref - 压缩引用
   * @param {Object} recoveryFunctions - 恢复函数集
   * @returns {Promise<any>} 恢复的内容
   */
  async recover(ref, recoveryFunctions = {}) {
    if (!this.isCompressedRef(ref)) {
      return ref;
    }

    if (!ref.recoverable) {
      throw new Error(`Content is not recoverable: ${ref.refType}`);
    }

    switch (ref.refType) {
      case "webpage":
        if (recoveryFunctions.fetchWebpage) {
          return await recoveryFunctions.fetchWebpage(ref.url);
        }
        break;
      case "file":
        if (recoveryFunctions.readFile) {
          return await recoveryFunctions.readFile(ref.path);
        }
        break;
      case "dbResult":
        if (recoveryFunctions.runQuery) {
          return await recoveryFunctions.runQuery(ref.query);
        }
        break;
    }

    throw new Error(`No recovery function for type: ${ref.refType}`);
  }
}

// 单例
let contextEngineeringInstance = null;

/**
 * 获取 Context Engineering 单例
 * @param {Object} options - 配置选项
 * @returns {ContextEngineering}
 */
function getContextEngineering(options = {}) {
  if (!contextEngineeringInstance) {
    contextEngineeringInstance = new ContextEngineering(options);
  }
  return contextEngineeringInstance;
}

module.exports = {
  ContextEngineering,
  RecoverableCompressor,
  getContextEngineering,
};
