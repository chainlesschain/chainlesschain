/**
 * Manus 优化 IPC 处理器
 *
 * 提供前端访问 Context Engineering 和 Tool Masking 功能的接口
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const { getManusOptimizations } = require("./manus-optimizations");
const { getLLMManager } = require("./llm-manager");

/**
 * 注册 Manus 优化相关的 IPC 处理器
 */
function registerManusIPC() {
  logger.info("[ManusIPC] 注册 Manus 优化 IPC 处理器...");

  // ==========================================
  // 任务追踪 API
  // ==========================================

  /**
   * 开始任务追踪
   * @param {Object} task - 任务信息
   * @param {string} task.objective - 任务目标
   * @param {Array} task.steps - 任务步骤
   */
  ipcMain.handle("manus:start-task", async (event, task) => {
    try {
      const manus = getManusOptimizations();
      const result = manus.startTask(task);
      return { success: true, task: result };
    } catch (error) {
      logger.error("[ManusIPC] 开始任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新任务进度
   * @param {number} stepIndex - 当前步骤索引
   * @param {string} status - 状态
   */
  ipcMain.handle(
    "manus:update-progress",
    async (event, { stepIndex, status }) => {
      try {
        const manus = getManusOptimizations();
        manus.updateTaskProgress(stepIndex, status);
        return { success: true };
      } catch (error) {
        logger.error("[ManusIPC] 更新进度失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 完成当前步骤
   */
  ipcMain.handle("manus:complete-step", async (event) => {
    try {
      const manus = getManusOptimizations();
      manus.completeCurrentStep();
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 完成步骤失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 完成任务
   */
  ipcMain.handle("manus:complete-task", async (event) => {
    try {
      const manus = getManusOptimizations();
      manus.completeTask();
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 完成任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 取消任务
   */
  ipcMain.handle("manus:cancel-task", async (event) => {
    try {
      const manus = getManusOptimizations();
      manus.cancelTask();
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 取消任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取当前任务
   */
  ipcMain.handle("manus:get-current-task", async (event) => {
    try {
      const manus = getManusOptimizations();
      const task = manus.getCurrentTask();
      return { success: true, task };
    } catch (error) {
      logger.error("[ManusIPC] 获取任务失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 工具掩码 API
  // ==========================================

  /**
   * 设置工具可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用
   */
  ipcMain.handle(
    "manus:set-tool-available",
    async (event, { toolName, available }) => {
      try {
        const manus = getManusOptimizations();
        manus.setToolAvailable(toolName, available);
        return { success: true };
      } catch (error) {
        logger.error("[ManusIPC] 设置工具可用性失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 按前缀设置工具可用性
   * @param {string} prefix - 工具前缀
   * @param {boolean} available - 是否可用
   */
  ipcMain.handle(
    "manus:set-tools-by-prefix",
    async (event, { prefix, available }) => {
      try {
        const manus = getManusOptimizations();
        manus.setToolsByPrefix(prefix, available);
        return { success: true };
      } catch (error) {
        logger.error("[ManusIPC] 设置前缀工具可用性失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 验证工具调用
   * @param {string} toolName - 工具名称
   */
  ipcMain.handle("manus:validate-tool-call", async (event, { toolName }) => {
    try {
      const manus = getManusOptimizations();
      const result = manus.validateToolCall(toolName);
      return { success: true, validation: result };
    } catch (error) {
      logger.error("[ManusIPC] 验证工具调用失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取可用工具列表
   */
  ipcMain.handle("manus:get-available-tools", async (event) => {
    try {
      const manus = getManusOptimizations();
      const tools = manus.getAvailableTools();
      return { success: true, tools };
    } catch (error) {
      logger.error("[ManusIPC] 获取可用工具失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 阶段状态机 API
  // ==========================================

  /**
   * 配置任务阶段状态机
   * @param {Object} config - 状态机配置（可选）
   */
  ipcMain.handle("manus:configure-phases", async (event, config) => {
    try {
      const manus = getManusOptimizations();
      manus.configureTaskPhases(config);
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 配置阶段失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 切换到指定阶段
   * @param {string} phase - 阶段名称
   */
  ipcMain.handle("manus:transition-to-phase", async (event, { phase }) => {
    try {
      const manus = getManusOptimizations();
      const success = manus.transitionToPhase(phase);
      return { success, phase: manus.getCurrentPhase() };
    } catch (error) {
      logger.error("[ManusIPC] 切换阶段失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取当前阶段
   */
  ipcMain.handle("manus:get-current-phase", async (event) => {
    try {
      const manus = getManusOptimizations();
      const phase = manus.getCurrentPhase();
      return { success: true, phase };
    } catch (error) {
      logger.error("[ManusIPC] 获取阶段失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 错误记录 API
  // ==========================================

  /**
   * 记录错误
   * @param {Object} error - 错误信息
   */
  ipcMain.handle("manus:record-error", async (event, error) => {
    try {
      const manus = getManusOptimizations();
      manus.recordError(error);
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 记录错误失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 标记错误已解决
   * @param {string} resolution - 解决方案
   */
  ipcMain.handle("manus:resolve-error", async (event, { resolution }) => {
    try {
      const manus = getManusOptimizations();
      manus.resolveLastError(resolution);
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 解决错误失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 统计 API
  // ==========================================

  /**
   * 获取 Manus 优化统计
   */
  ipcMain.handle("manus:get-stats", async (event) => {
    try {
      const manus = getManusOptimizations();
      const stats = manus.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[ManusIPC] 获取统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 重置统计
   */
  ipcMain.handle("manus:reset-stats", async (event) => {
    try {
      const manus = getManusOptimizations();
      manus.resetStats();
      return { success: true };
    } catch (error) {
      logger.error("[ManusIPC] 重置统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 导出调试信息
   */
  ipcMain.handle("manus:export-debug-info", async (event) => {
    try {
      const manus = getManusOptimizations();
      const debugInfo = manus.exportDebugInfo();
      return { success: true, debugInfo };
    } catch (error) {
      logger.error("[ManusIPC] 导出调试信息失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // 优化 Prompt 构建 API
  // ==========================================

  /**
   * 构建优化后的 Prompt
   * @param {Object} options - 构建选项
   */
  ipcMain.handle("manus:build-optimized-prompt", async (event, options) => {
    try {
      const llmManager = getLLMManager();
      const result = llmManager.buildOptimizedPrompt(options);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[ManusIPC] 构建优化 Prompt 失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 压缩内容
   * @param {any} content - 原始内容
   * @param {string} type - 内容类型
   */
  ipcMain.handle("manus:compress-content", async (event, { content, type }) => {
    try {
      const manus = getManusOptimizations();
      const compressed = manus.compress(content, type);
      return { success: true, compressed };
    } catch (error) {
      logger.error("[ManusIPC] 压缩内容失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[ManusIPC] Manus 优化 IPC 处理器注册完成");
}

module.exports = { registerManusIPC };
