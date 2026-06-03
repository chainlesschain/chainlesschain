/**
 * LLM IPC handlers — selector group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-selector
 */
const { logger } = require("../utils/logger.js");

function registerSelectorHandlers(ctx) {
  const { ipcMain, managerRef, llmSelector, database, app } = ctx;

  // ============================================================
  // LLM 智能选择
  // ============================================================

  /**
   * 获取 LLM 选择器信息
   * Channel: 'llm:get-selector-info'
   */
  ipcMain.handle("llm:get-selector-info", async () => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      return {
        characteristics: llmSelector.getAllCharacteristics(),
        taskTypes: llmSelector.getTaskTypes(),
      };
    } catch (error) {
      logger.error("[LLM IPC] 获取LLM选择器信息失败:", error);
      throw error;
    }
  });

  /**
   * 智能选择最优 LLM
   * Channel: 'llm:select-best'
   */
  ipcMain.handle("llm:select-best", async (_event, options = {}) => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      const provider = llmSelector.selectBestLLM(options);
      return provider;
    } catch (error) {
      logger.error("[LLM IPC] 智能选择LLM失败:", error);
      throw error;
    }
  });

  /**
   * 生成 LLM 选择报告
   * Channel: 'llm:generate-report'
   */
  ipcMain.handle("llm:generate-report", async (_event, taskType = "chat") => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      return llmSelector.generateSelectionReport(taskType);
    } catch (error) {
      logger.error("[LLM IPC] 生成LLM选择报告失败:", error);
      throw error;
    }
  });

  /**
   * 切换 LLM 提供商
   * Channel: 'llm:switch-provider'
   */
  ipcMain.handle("llm:switch-provider", async (_event, provider) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { getLLMConfig } = require("./llm-config");
      const { LLMManager } = require("./llm-manager");

      // 保存新的提供商到llm-config.json
      const llmConfig = getLLMConfig();
      llmConfig.setProvider(provider);

      // 重新初始化LLM管理器
      if (managerRef.current) {
        await managerRef.current.close();
      }

      const managerConfig = llmConfig.getManagerConfig();
      logger.info(`[LLM IPC] 切换到LLM提供商: ${provider}, 配置:`, {
        model: managerConfig.model,
        baseURL: managerConfig.baseURL,
      });

      const newManager = new LLMManager(managerConfig);
      await newManager.initialize();

      // 更新引用容器
      managerRef.current = newManager;

      // 如果有 app 实例，也更新 app 上的引用
      if (app) {
        app.llmManager = newManager;
      }

      logger.info(`[LLM IPC] 已切换到LLM提供商: ${provider}`);
      return true;
    } catch (error) {
      logger.error("[LLM IPC] 切换LLM提供商失败:", error);
      throw error;
    }
  });
}

module.exports = { registerSelectorHandlers };
