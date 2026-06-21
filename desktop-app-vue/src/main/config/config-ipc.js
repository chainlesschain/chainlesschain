/**
 * 配置 IPC 处理器
 * 负责处理应用配置相关的前后端通信
 *
 * @module config-ipc
 * @description 提供应用配置的读取和设置 IPC 接口
 */

const { logger } = require("../utils/logger.js");

// 防止重复注册的标志
let isRegistered = false;

/**
 * config 写保护命名空间（IPC 安全发现 #4）。
 * 渲染层只合法写入少数 UI/项目配置项（如 project.rootPath / ui.useWebShellExperimental），
 * 从不写入数据库敏感配置。`database`（含 `database.sqlcipherKey` —— SQLCipher 主密钥）
 * 必须由主进程/keychain 管理，绝不接受渲染层经 config:set / config:update 写入/篡改
 * （防止被恶意或被攻陷的渲染帧改写加密密钥造成数据库不可解/篡改）。
 *
 * 同时匹配「整命名空间」(`config:update` 传 key="database" + 整对象) 和「点分子键」
 * (`config:set` 传 "database.sqlcipherKey")。
 */
const PROTECTED_CONFIG_NAMESPACES = ["database"];

function isProtectedConfigKey(key) {
  if (typeof key !== "string") {
    return false;
  }
  return PROTECTED_CONFIG_NAMESPACES.some(
    (ns) => key === ns || key.startsWith(`${ns}.`),
  );
}

/**
 * 注册所有配置 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.appConfig - 应用配置管理器实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）
 */
function registerConfigIPC({ appConfig, ipcMain: injectedIpcMain }) {
  if (isRegistered) {
    logger.info("[Config IPC] Handlers already registered, skipping...");
    return;
  }

  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require("electron").ipcMain;

  logger.info("[Config IPC] Registering Config IPC handlers...");

  /**
   * 获取配置项
   * Channel: 'config:get'
   *
   * @param {string} key - 配置键（支持点分隔符，如 'app.theme'）
   * @param {any} defaultValue - 默认值（可选）
   * @returns {Promise<any>} 配置值
   */
  ipcMain.handle("config:get", async (_event, key, defaultValue = null) => {
    try {
      if (!appConfig) {
        logger.warn(
          "[Config IPC] AppConfig not initialized, returning default value",
        );
        return defaultValue;
      }

      const value = appConfig.get(key, defaultValue);
      return value;
    } catch (error) {
      logger.error("[Config IPC] 获取配置失败:", error);
      return defaultValue;
    }
  });

  /**
   * 设置配置项
   * Channel: 'config:set'
   *
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle("config:set", async (_event, key, value) => {
    try {
      if (!appConfig) {
        throw new Error("AppConfig未初始化");
      }

      // 写保护（#4）：拒绝渲染层写入敏感配置（如 database.* 加密密钥）。
      if (isProtectedConfigKey(key)) {
        logger.warn(`[Config IPC] 拒绝写入受保护配置项: ${key}`);
        return {
          success: false,
          error: `Refused to set protected config key: ${key}`,
        };
      }

      appConfig.set(key, value);
      return { success: true };
    } catch (error) {
      logger.error("[Config IPC] 设置配置失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取全部配置
   * Channel: 'config:get-all'
   *
   * @returns {Promise<Object>} 全部配置对象
   */
  ipcMain.handle("config:get-all", async () => {
    try {
      if (!appConfig) {
        logger.warn(
          "[Config IPC] AppConfig not initialized, returning empty config",
        );
        return {};
      }

      const allConfig = appConfig.getAll();

      // 🔥 从llm-config.json加载LLM配置并合并
      try {
        const { getLLMConfig } = require("../llm/llm-config");
        const llmConfig = getLLMConfig();
        const llmData = llmConfig.getAll();

        logger.info("[Config IPC] 从llm-config.json加载LLM配置:", {
          provider: llmData.provider,
          volcengineModel: llmData.volcengine?.model,
        });

        // 映射LLM配置到前端格式
        const mappedLLMConfig = {
          provider: llmData.provider,
          priority: llmData.priority || [],
          autoSelect: llmData.autoSelect,
          autoFallback: llmData.autoFallback,
          selectionStrategy: llmData.selectionStrategy,

          // Ollama
          ollamaHost: llmData.ollama?.url || llmData.ollama?.host || "",
          ollamaModel: llmData.ollama?.model || "",
          ollamaEmbeddingModel: llmData.ollama?.embeddingModel || "",

          // OpenAI
          openaiApiKey: llmData.openai?.apiKey || "",
          openaiBaseUrl: llmData.openai?.baseURL || "",
          openaiModel: llmData.openai?.model || "",
          openaiEmbeddingModel: llmData.openai?.embeddingModel || "",

          // Anthropic
          anthropicApiKey: llmData.anthropic?.apiKey || "",
          anthropicBaseUrl: llmData.anthropic?.baseURL || "",
          anthropicModel: llmData.anthropic?.model || "",
          anthropicEmbeddingModel: llmData.anthropic?.embeddingModel || "",

          // DeepSeek
          deepseekApiKey: llmData.deepseek?.apiKey || "",
          deepseekModel: llmData.deepseek?.model || "",
          deepseekEmbeddingModel: llmData.deepseek?.embeddingModel || "",

          // Volcengine
          volcengineApiKey: llmData.volcengine?.apiKey || "",
          volcengineModel: llmData.volcengine?.model || "",
          volcengineEmbeddingModel: llmData.volcengine?.embeddingModel || "",

          // Dashscope
          dashscopeApiKey: llmData.dashscope?.apiKey || "",
          dashscopeModel: llmData.dashscope?.model || "",
          dashscopeEmbeddingModel: llmData.dashscope?.embeddingModel || "",

          // Zhipu
          zhipuApiKey: llmData.zhipu?.apiKey || "",
          zhipuModel: llmData.zhipu?.model || "",
          zhipuEmbeddingModel: llmData.zhipu?.embeddingModel || "",
        };

        // 合并LLM配置
        allConfig.llm = { ...allConfig.llm, ...mappedLLMConfig };

        logger.info("[Config IPC] LLM配置已合并到返回数据");
      } catch (llmError) {
        logger.error("[Config IPC] 加载LLM配置失败:", llmError);
        // 即使失败也继续返回其他配置
      }

      return allConfig;
    } catch (error) {
      logger.error("[Config IPC] 获取全部配置失败:", error);
      return {};
    }
  });

  /**
   * 更新配置（批量设置）
   * Channel: 'config:update'
   *
   * @param {Object} config - 配置对象（可包含多个键值对）
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle("config:update", async (_event, config) => {
    try {
      if (!appConfig) {
        throw new Error("AppConfig未初始化");
      }

      // 批量更新配置（跳过受保护命名空间，防止经 config:update 绕过 config:set 写保护）
      if (config && typeof config === "object") {
        for (const [key, value] of Object.entries(config)) {
          if (isProtectedConfigKey(key)) {
            logger.warn(`[Config IPC] config:update 跳过受保护配置项: ${key}`);
            continue;
          }
          appConfig.set(key, value);
        }
      }

      // 🔥 同步LLM配置到专用的llm-config.json文件
      if (config.llm && typeof config.llm === "object") {
        try {
          const { getLLMConfig } = require("../llm/llm-config");
          const llmConfig = getLLMConfig();

          logger.info("[Config IPC] 检测到LLM配置更新，同步到llm-config.json");

          // 更新LLM配置
          if (config.llm.provider) {
            llmConfig.setProvider(config.llm.provider);
          }

          // 更新各提供商的配置
          const providers = [
            "ollama",
            "openai",
            "anthropic",
            "deepseek",
            "volcengine",
            "dashscope",
            "zhipu",
          ];
          providers.forEach((provider) => {
            if (
              config.llm[`${provider}ApiKey`] !== undefined ||
              config.llm[`${provider}Model`] !== undefined ||
              config.llm[`${provider}BaseUrl`] !== undefined ||
              config.llm[`${provider}EmbeddingModel`] !== undefined
            ) {
              const providerConfig = {};

              // 映射配置键名
              if (config.llm[`${provider}ApiKey`] !== undefined) {
                providerConfig.apiKey = config.llm[`${provider}ApiKey`];
              }
              if (config.llm[`${provider}Model`] !== undefined) {
                providerConfig.model = config.llm[`${provider}Model`];
              }
              if (config.llm[`${provider}BaseUrl`] !== undefined) {
                providerConfig.baseURL = config.llm[`${provider}BaseUrl`];
              }
              if (config.llm[`${provider}EmbeddingModel`] !== undefined) {
                providerConfig.embeddingModel =
                  config.llm[`${provider}EmbeddingModel`];
              }

              // Ollama 特殊处理
              if (provider === "ollama" && config.llm.ollamaHost) {
                providerConfig.url = config.llm.ollamaHost;
              }

              llmConfig.setProviderConfig(provider, providerConfig);
              logger.info(
                `[Config IPC] 已更新 ${provider} 配置:`,
                providerConfig,
              );
            }
          });

          // 更新选项
          if (config.llm.priority) {
            llmConfig.set("priority", config.llm.priority);
          }
          if (config.llm.autoSelect !== undefined) {
            llmConfig.set("autoSelect", config.llm.autoSelect);
          }
          if (config.llm.autoFallback !== undefined) {
            llmConfig.set("autoFallback", config.llm.autoFallback);
          }
          if (config.llm.selectionStrategy) {
            llmConfig.set("selectionStrategy", config.llm.selectionStrategy);
          }

          logger.info("[Config IPC] LLM配置已同步到llm-config.json");
        } catch (llmError) {
          logger.error("[Config IPC] 同步LLM配置失败:", llmError);
          // 不抛出错误，允许通用配置继续保存
        }
      }

      return { success: true };
    } catch (error) {
      logger.error("[Config IPC] 更新配置失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 重置配置为默认值
   * Channel: 'config:reset'
   *
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle("config:reset", async () => {
    try {
      if (!appConfig) {
        throw new Error("AppConfig未初始化");
      }

      appConfig.reset();
      return { success: true };
    } catch (error) {
      logger.error("[Config IPC] 重置配置失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ========================================
  // UnifiedConfigManager IPC Handlers
  // ========================================

  /**
   * 获取统一配置摘要
   * Channel: 'unified-config:get-summary'
   * @returns {Promise<Object>} 配置摘要
   */
  ipcMain.handle("unified-config:get-summary", async () => {
    try {
      const { getUnifiedConfigManager } = require("./unified-config-manager");
      const configManager = getUnifiedConfigManager();
      return configManager.getConfigSummary();
    } catch (error) {
      logger.error("[Config IPC] 获取统一配置摘要失败:", error);
      return { error: error.message };
    }
  });

  /**
   * 获取目录统计信息
   * Channel: 'unified-config:get-directory-stats'
   * @returns {Promise<Object>} 目录统计
   */
  ipcMain.handle("unified-config:get-directory-stats", async () => {
    try {
      const { getUnifiedConfigManager } = require("./unified-config-manager");
      const configManager = getUnifiedConfigManager();
      return configManager.getDirectoryStats();
    } catch (error) {
      logger.error("[Config IPC] 获取目录统计失败:", error);
      return { error: error.message };
    }
  });

  /**
   * 获取统一配置路径
   * Channel: 'unified-config:get-paths'
   * @returns {Promise<Object>} 路径配置
   */
  ipcMain.handle("unified-config:get-paths", async () => {
    try {
      const { getUnifiedConfigManager } = require("./unified-config-manager");
      const configManager = getUnifiedConfigManager();
      return configManager.getPaths();
    } catch (error) {
      logger.error("[Config IPC] 获取路径配置失败:", error);
      return { error: error.message };
    }
  });

  /**
   * 清理缓存
   * Channel: 'unified-config:clear-cache'
   * @param {string} type - 缓存类型：'all', 'embeddings', 'queryResults', 'modelOutputs'
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle("unified-config:clear-cache", async (_event, type = "all") => {
    try {
      const { getUnifiedConfigManager } = require("./unified-config-manager");
      const configManager = getUnifiedConfigManager();
      return configManager.clearCache(type);
    } catch (error) {
      logger.error("[Config IPC] 清理缓存失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 清理旧日志
   * Channel: 'unified-config:clean-old-logs'
   * @param {number} maxFiles - 保留的最大文件数
   * @returns {Promise<Object>} { success: boolean, cleaned: number }
   */
  ipcMain.handle(
    "unified-config:clean-old-logs",
    async (_event, maxFiles = 30) => {
      try {
        const { getUnifiedConfigManager } = require("./unified-config-manager");
        const configManager = getUnifiedConfigManager();
        return configManager.cleanOldLogs(maxFiles);
      } catch (error) {
        logger.error("[Config IPC] 清理日志失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info(
    "[Config IPC] Registered 5 config: handlers + 5 unified-config: handlers",
  );
  logger.info("[Config IPC] - config:get");
  logger.info("[Config IPC] - config:set");
  logger.info("[Config IPC] - config:get-all");
  logger.info("[Config IPC] - config:update");
  logger.info("[Config IPC] - config:reset");
  logger.info("[Config IPC] - unified-config:get-summary");
  logger.info("[Config IPC] - unified-config:get-directory-stats");
  logger.info("[Config IPC] - unified-config:get-paths");
  logger.info("[Config IPC] - unified-config:clear-cache");
  logger.info("[Config IPC] - unified-config:clean-old-logs");

  isRegistered = true;
  logger.info("[Config IPC] ✓ All handlers registered successfully");
}

module.exports = { registerConfigIPC };
