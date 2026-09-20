/**
 * LLM IPC handlers — selector group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-selector
 */
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const {
  normalizeProvider,
  normalizeSelectionOptions,
  normalizeTaskType,
  projectSelectedProvider,
  projectSelectionReport,
  projectSelectorInfo,
} = require("./llm-selector-success-projection");

function registerSelectorHandlers(ctx) {
  const getConfiguration =
    ctx.getLLMConfig || (() => require("./llm-config").getLLMConfig());
  const { ipcMain, managerRef, llmSelector, database, app } = ctx;
  const privacy = ctx.llmPrivacy || createLlmIpcPrivacy("selector");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM selector IPC authorization is required");
  }
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^llm:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          await authorization.authorize(event, operation);
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        return handler(event, ...args);
      });
    },
  };

  // ============================================================
  // LLM 智能选择
  // ============================================================

  /**
   * 获取 LLM 选择器信息
   * Channel: 'llm:get-selector-info'
   */
  authorizedIpcMain.handle("llm:get-selector-info", async () => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      return projectSelectorInfo(
        llmSelector.getAllCharacteristics(),
        llmSelector.getTaskTypes(),
      );
    } catch {
      throw privacy.failure("get-selector-info");
    }
  });

  /**
   * 智能选择最优 LLM
   * Channel: 'llm:select-best'
   */
  authorizedIpcMain.handle(
    "llm:select-best",
    async (_event, options = {}) => {
      try {
        if (!llmSelector) {
          throw new Error("LLM选择器未初始化");
        }

        const provider = llmSelector.selectBestLLM(
          normalizeSelectionOptions(options),
        );
        return projectSelectedProvider(provider);
      } catch {
        throw privacy.failure("select-best");
      }
    },
  );

  /**
   * 生成 LLM 选择报告
   * Channel: 'llm:generate-report'
   */
  authorizedIpcMain.handle(
    "llm:generate-report",
    async (_event, taskType = "chat") => {
      try {
        if (!llmSelector) {
          throw new Error("LLM选择器未初始化");
        }

        return projectSelectionReport(
          llmSelector.generateSelectionReport(normalizeTaskType(taskType)),
        );
      } catch {
        throw privacy.failure("generate-report");
      }
    },
  );

  /**
   * 切换 LLM 提供商
   * Channel: 'llm:switch-provider'
   */
  authorizedIpcMain.handle("llm:switch-provider", async (_event, provider) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }
      const safeProvider = normalizeProvider(provider);

      const {
        createLLMManagerReplacement,
        _setLLMManagerInstance,
      } = require("./llm-manager");

      // 保存新的提供商到llm-config.json
      const llmConfig = getConfiguration();
      llmConfig.setProvider(safeProvider);

      // 重新初始化LLM管理器
      const previousManager = managerRef.current;

      const managerConfig = llmConfig.getManagerConfig();
      const newManager = createLLMManagerReplacement(
        previousManager,
        managerConfig,
      );
      await newManager.initialize();
      if (managerRef.current !== previousManager) {
        throw new Error("LLM manager changed during provider switch");
      }

      // 更新引用容器
      managerRef.current = newManager;
      _setLLMManagerInstance(newManager);
      if (newManager.promptCompressor) {
        newManager.promptCompressor.llmManager = newManager;
      }

      // 如果有 app 实例，也更新 app 上的引用
      if (app) {
        app.llmManager = newManager;
      }

      privacy.success("switch-provider");
      return Object.freeze({ success: true });
    } catch {
      throw privacy.failure("switch-provider");
    }
  });
}

module.exports = { registerSelectorHandlers };
