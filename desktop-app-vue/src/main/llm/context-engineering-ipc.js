/**
 * Context Engineering IPC 处理器
 *
 * 提供 Context Window Optimization 的前端访问接口
 * 基于 Manus AI 最佳实践，优化 LLM 上下文构建以最大化 KV-Cache 命中率
 *
 * 功能：
 * - KV-Cache 优化统计和控制
 * - 任务上下文管理
 * - 错误历史追踪（供模型学习）
 * - 内容压缩和恢复
 * - Token 预估
 *
 * @module context-engineering-ipc
 */

const { logger } = require("../utils/logger.js");
const defaultIpcGuard = require("../ipc/ipc-guard");
const {
  ContextEngineering,
  RecoverableCompressor,
  getContextEngineering,
} = require("./context-engineering");

// 模块级别的实例
let contextEngineeringInstance = null;
let compressorInstance = null;

/**
 * 获取或创建 ContextEngineering 实例
 * @param {Object} options - 配置选项
 * @returns {ContextEngineering}
 */
function getOrCreateContextEngineering(options = {}) {
  if (!contextEngineeringInstance) {
    contextEngineeringInstance = getContextEngineering(options);
  }
  return contextEngineeringInstance;
}

/**
 * 获取或创建 RecoverableCompressor 实例
 * @returns {RecoverableCompressor}
 */
function getOrCreateCompressor() {
  if (!compressorInstance) {
    compressorInstance = new RecoverableCompressor();
  }
  return compressorInstance;
}

/**
 * 简单的 Token 估算器（基于字符数）
 * 实际项目中应使用 tiktoken 或类似库
 */
class TokenEstimator {
  constructor() {
    // 不同语言的字符/token 比率
    this.ratios = {
      english: 4.0, // 平均 4 个字符 = 1 个 token
      chinese: 1.5, // 平均 1.5 个中文字符 = 1 个 token
      mixed: 2.5, // 混合内容
    };
  }

  /**
   * 估算内容的 token 数量
   * @param {string|Object} content - 内容
   * @param {string} [lang='mixed'] - 语言类型
   * @returns {number} 估算的 token 数
   */
  estimate(content, lang = "mixed") {
    if (!content) {
      return 0;
    }

    const text =
      typeof content === "string" ? content : JSON.stringify(content);

    // 检测语言
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = text.length;
    const chineseRatio = chineseChars / totalChars;

    // 根据中文比例选择比率
    let ratio;
    if (chineseRatio > 0.5) {
      ratio = this.ratios.chinese;
    } else if (chineseRatio < 0.1) {
      ratio = this.ratios.english;
    } else {
      ratio = this.ratios.mixed;
    }

    return Math.ceil(totalChars / ratio);
  }

  /**
   * 估算消息数组的 token 数量
   * @param {Array} messages - 消息数组
   * @returns {Object} token 统计
   */
  estimateMessages(messages) {
    if (!Array.isArray(messages)) {
      return { total: 0, byRole: {} };
    }

    const stats = {
      total: 0,
      byRole: {},
      byMessage: [],
    };

    for (const msg of messages) {
      const content = msg.content || "";
      const tokens = this.estimate(content);

      stats.total += tokens;
      stats.byRole[msg.role] = (stats.byRole[msg.role] || 0) + tokens;
      stats.byMessage.push({
        role: msg.role,
        tokens,
        preview:
          typeof content === "string" ? content.slice(0, 50) : "[object]",
      });
    }

    return stats;
  }
}

// Token 估算器单例
let tokenEstimatorInstance = null;

function getTokenEstimator() {
  if (!tokenEstimatorInstance) {
    tokenEstimatorInstance = new TokenEstimator();
  }
  return tokenEstimatorInstance;
}

/**
 * 注册 Context Engineering IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.contextEngineering] - Context Engineering 实例
 * @param {Object} [dependencies.compressor] - Compressor 实例
 */
function registerContextEngineeringIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  contextEngineering: injectedContextEngineering,
  compressor: injectedCompressor,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("context-engineering-ipc")) {
    logger.info(
      "[Context Engineering IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 使用注入的实例或创建新实例
  const contextEngineering =
    injectedContextEngineering || getOrCreateContextEngineering();
  const compressor = injectedCompressor || getOrCreateCompressor();
  const tokenEstimator = getTokenEstimator();

  logger.info("[Context Engineering IPC] Registering handlers...");

  // ============================================================
  // 统计和配置 (Stats & Config) - 4 handlers
  // ============================================================

  /**
   * 获取 Context Engineering 统计信息
   * Channel: 'context:get-stats'
   *
   * @returns {Object} 统计数据，包括缓存命中率、总调用数等
   */
  ipcMain.handle("context:get-stats", async () => {
    try {
      const stats = contextEngineering.getStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 获取统计失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重置统计数据
   * Channel: 'context:reset-stats'
   *
   * @returns {Object} 操作结果
   */
  ipcMain.handle("context:reset-stats", async () => {
    try {
      contextEngineering.resetStats();
      return {
        success: true,
        message: "Stats reset successfully",
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 重置统计失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取 Context Engineering 配置
   * Channel: 'context:get-config'
   *
   * @returns {Object} 当前配置
   */
  ipcMain.handle("context:get-config", async () => {
    try {
      return {
        success: true,
        config: contextEngineering.config,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 获取配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新 Context Engineering 配置
   * Channel: 'context:set-config'
   *
   * @param {Object} newConfig - 新配置（部分更新）
   * @returns {Object} 更新后的配置
   */
  ipcMain.handle("context:set-config", async (_event, newConfig) => {
    try {
      if (!newConfig || typeof newConfig !== "object") {
        throw new Error("Invalid config: must be an object");
      }

      // 合并配置
      Object.assign(contextEngineering.config, newConfig);

      logger.info("[Context Engineering IPC] 配置已更新:", newConfig);

      return {
        success: true,
        config: contextEngineering.config,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 设置配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // Prompt 优化 (Prompt Optimization) - 2 handlers
  // ============================================================

  /**
   * 优化消息数组（构建 KV-Cache 友好的 Prompt）
   * Channel: 'context:optimize-messages'
   *
   * @param {Object} options - 优化选项
   * @param {string} options.systemPrompt - 系统提示词
   * @param {Array} options.messages - 消息数组
   * @param {Array} options.tools - 工具定义
   * @param {Object} options.taskContext - 任务上下文
   * @returns {Object} 优化后的消息和元数据
   */
  ipcMain.handle("context:optimize-messages", async (_event, options = {}) => {
    try {
      const result = contextEngineering.buildOptimizedPrompt(options);

      // 添加 token 估算
      const tokenStats = tokenEstimator.estimateMessages(result.messages);
      result.metadata.estimatedTokens = tokenStats.total;
      result.metadata.tokensByRole = tokenStats.byRole;

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 优化消息失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 估算内容的 Token 数量
   * Channel: 'context:estimate-tokens'
   *
   * @param {Object} options - 估算选项
   * @param {string|Array} options.content - 内容（字符串或消息数组）
   * @param {string} [options.lang='mixed'] - 语言类型
   * @returns {Object} Token 估算结果
   */
  ipcMain.handle("context:estimate-tokens", async (_event, options = {}) => {
    try {
      const { content, lang = "mixed" } = options;

      if (Array.isArray(content)) {
        // 消息数组
        const stats = tokenEstimator.estimateMessages(content);
        return {
          success: true,
          tokens: stats.total,
          breakdown: stats,
        };
      } else {
        // 单个内容
        const tokens = tokenEstimator.estimate(content, lang);
        return {
          success: true,
          tokens,
          charCount:
            typeof content === "string"
              ? content.length
              : JSON.stringify(content).length,
        };
      }
    } catch (error) {
      logger.error("[Context Engineering IPC] 估算 Token 失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 任务上下文管理 (Task Context Management) - 4 handlers
  // ============================================================

  /**
   * 设置当前任务上下文
   * Channel: 'context:set-task'
   *
   * @param {Object} task - 任务信息
   * @param {string} task.objective - 任务目标
   * @param {Array} task.steps - 任务步骤
   * @param {number} task.currentStep - 当前步骤索引
   * @returns {Object} 操作结果
   */
  ipcMain.handle("context:set-task", async (_event, task) => {
    try {
      if (!task || typeof task !== "object") {
        throw new Error("Invalid task: must be an object");
      }

      contextEngineering.setCurrentTask({
        objective: task.objective || "Complete the task",
        steps: task.steps || [],
        currentStep: task.currentStep || 0,
        status: task.status || "in_progress",
        createdAt: Date.now(),
      });

      logger.info(
        "[Context Engineering IPC] 任务上下文已设置:",
        task.objective,
      );

      return {
        success: true,
        task: contextEngineering.getCurrentTask(),
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 设置任务失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新任务进度
   * Channel: 'context:update-task-progress'
   *
   * @param {Object} options - 更新选项
   * @param {number} options.currentStep - 当前步骤索引
   * @param {string} options.status - 状态
   * @returns {Object} 更新后的任务
   */
  ipcMain.handle(
    "context:update-task-progress",
    async (_event, options = {}) => {
      try {
        const { currentStep, status } = options;

        if (currentStep !== undefined) {
          contextEngineering.updateTaskProgress(currentStep, status);
        }

        const task = contextEngineering.getCurrentTask();

        if (!task) {
          return {
            success: false,
            error: "No active task",
          };
        }

        return {
          success: true,
          task,
        };
      } catch (error) {
        logger.error("[Context Engineering IPC] 更新任务进度失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 获取当前任务上下文
   * Channel: 'context:get-task'
   *
   * @returns {Object} 当前任务或 null
   */
  ipcMain.handle("context:get-task", async () => {
    try {
      const task = contextEngineering.getCurrentTask();
      return {
        success: true,
        task,
        hasActiveTask: !!task,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 获取任务失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清除任务上下文
   * Channel: 'context:clear-task'
   *
   * @returns {Object} 操作结果
   */
  ipcMain.handle("context:clear-task", async () => {
    try {
      contextEngineering.clearTask();
      logger.info("[Context Engineering IPC] 任务上下文已清除");
      return {
        success: true,
        message: "Task context cleared",
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 清除任务失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 错误历史管理 (Error History Management) - 4 handlers
  // ============================================================

  /**
   * 记录错误（供模型学习）
   * Channel: 'context:record-error'
   *
   * @param {Object} error - 错误信息
   * @param {string} error.step - 发生错误的步骤
   * @param {string} error.message - 错误消息
   * @param {string} [error.resolution] - 解决方案
   * @returns {Object} 操作结果
   */
  ipcMain.handle("context:record-error", async (_event, error) => {
    try {
      if (!error || typeof error !== "object") {
        throw new Error("Invalid error: must be an object");
      }

      contextEngineering.recordError({
        step: error.step || "unknown",
        message: error.message || String(error),
        resolution: error.resolution,
      });

      logger.info(
        "[Context Engineering IPC] 错误已记录:",
        error.message?.slice(0, 100),
      );

      return {
        success: true,
        errorCount: contextEngineering.errorHistory.length,
      };
    } catch (err) {
      logger.error("[Context Engineering IPC] 记录错误失败:", err);
      return {
        success: false,
        error: err.message,
      };
    }
  });

  /**
   * 标记错误已解决
   * Channel: 'context:resolve-error'
   *
   * @param {Object} options - 选项
   * @param {number} options.errorIndex - 错误索引
   * @param {string} options.resolution - 解决方案
   * @returns {Object} 操作结果
   */
  ipcMain.handle("context:resolve-error", async (_event, options = {}) => {
    try {
      const { errorIndex, resolution } = options;

      if (errorIndex === undefined || !resolution) {
        throw new Error("errorIndex and resolution are required");
      }

      contextEngineering.resolveError(errorIndex, resolution);

      return {
        success: true,
        message: "Error marked as resolved",
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 标记错误解决失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取错误历史
   * Channel: 'context:get-errors'
   *
   * @param {Object} [options] - 选项
   * @param {number} [options.limit] - 限制数量
   * @returns {Object} 错误历史
   */
  ipcMain.handle("context:get-errors", async (_event, options = {}) => {
    try {
      let errors = [...contextEngineering.errorHistory];

      if (options.limit && options.limit > 0) {
        errors = errors.slice(-options.limit);
      }

      return {
        success: true,
        errors,
        totalCount: contextEngineering.errorHistory.length,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 获取错误历史失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 清除错误历史
   * Channel: 'context:clear-errors'
   *
   * @returns {Object} 操作结果
   */
  ipcMain.handle("context:clear-errors", async () => {
    try {
      const count = contextEngineering.errorHistory.length;
      contextEngineering.clearErrors();
      logger.info("[Context Engineering IPC] 错误历史已清除，共", count, "条");
      return {
        success: true,
        clearedCount: count,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 清除错误历史失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 内容压缩 (Content Compression) - 3 handlers
  // ============================================================

  /**
   * 压缩内容
   * Channel: 'context:compress'
   *
   * @param {Object} options - 压缩选项
   * @param {any} options.content - 要压缩的内容
   * @param {string} options.type - 内容类型 (webpage/file/dbResult/default)
   * @returns {Object} 压缩结果
   */
  ipcMain.handle("context:compress", async (_event, options = {}) => {
    try {
      const { content, type = "default" } = options;

      if (content === undefined || content === null) {
        throw new Error("content is required");
      }

      const compressed = compressor.compress(content, type);
      const isCompressed = compressor.isCompressedRef(compressed);

      return {
        success: true,
        compressed,
        wasCompressed: isCompressed,
        originalSize:
          typeof content === "string"
            ? content.length
            : JSON.stringify(content).length,
        compressedSize: isCompressed
          ? JSON.stringify(compressed).length
          : typeof compressed === "string"
            ? compressed.length
            : JSON.stringify(compressed).length,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 压缩内容失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 检查是否为压缩引用
   * Channel: 'context:is-compressed'
   *
   * @param {any} data - 数据
   * @returns {Object} 检查结果
   */
  ipcMain.handle("context:is-compressed", async (_event, data) => {
    try {
      const isCompressed = compressor.isCompressedRef(data);
      return {
        success: true,
        isCompressed,
        refType: isCompressed ? data.refType : null,
        recoverable: isCompressed ? data.recoverable : false,
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 检查压缩状态失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 尝试恢复压缩内容
   * Channel: 'context:decompress'
   *
   * 注意：只有标记为 recoverable 的内容才能恢复
   *
   * @param {Object} ref - 压缩引用
   * @returns {Object} 恢复结果或错误
   */
  ipcMain.handle("context:decompress", async (_event, ref) => {
    try {
      if (!compressor.isCompressedRef(ref)) {
        return {
          success: true,
          content: ref,
          wasDecompressed: false,
        };
      }

      if (!ref.recoverable) {
        return {
          success: false,
          error: "Content is not recoverable",
          preview: ref.preview,
        };
      }

      // 目前只返回恢复信息，实际恢复需要外部函数支持
      return {
        success: false,
        error:
          "Recovery requires external functions (fetchWebpage, readFile, runQuery)",
        refType: ref.refType,
        recoveryInfo: {
          url: ref.url,
          path: ref.path,
          query: ref.query,
        },
      };
    } catch (error) {
      logger.error("[Context Engineering IPC] 解压缩失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("context-engineering-ipc");

  logger.info(
    "[Context Engineering IPC] ✓ All handlers registered (17 handlers: 4 stats/config + 2 optimization + 4 task + 4 error + 3 compression)",
  );
}

/**
 * 注销 Context Engineering IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterContextEngineeringIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered("context-engineering-ipc")) {
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    "context:get-stats",
    "context:reset-stats",
    "context:get-config",
    "context:set-config",
    "context:optimize-messages",
    "context:estimate-tokens",
    "context:set-task",
    "context:update-task-progress",
    "context:get-task",
    "context:clear-task",
    "context:record-error",
    "context:resolve-error",
    "context:get-errors",
    "context:clear-errors",
    "context:compress",
    "context:is-compressed",
    "context:decompress",
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcGuard.unmarkModuleRegistered("context-engineering-ipc");
  logger.info("[Context Engineering IPC] Handlers unregistered");
}

module.exports = {
  registerContextEngineeringIPC,
  unregisterContextEngineeringIPC,
  // 导出用于测试
  getOrCreateContextEngineering,
  getOrCreateCompressor,
  getTokenEstimator,
  TokenEstimator,
};
