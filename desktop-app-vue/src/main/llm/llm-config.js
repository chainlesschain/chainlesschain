/**
 * LLM配置管理
 * 支持敏感信息（API Keys）加密存储
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const {
  getSecureConfigStorage,
  extractSensitiveFields,
  mergeSensitiveFields,
  sanitizeConfig,
  SENSITIVE_FIELDS,
} = require("./secure-config-storage");

const normalizeProvider = (provider) => {
  if (!provider) {
    return provider;
  }
  return provider === "claude" ? "anthropic" : provider;
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 提供商
  provider: "volcengine", // 'volcengine' | 'ollama' | 'openai' | 'deepseek' | 'custom'

  // Ollama配置
  ollama: {
    url: "http://localhost:11434",
    model: "llama2",
    embeddingModel: "nomic-embed-text", // Ollama嵌入模型
  },

  // OpenAI配置
  openai: {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-3.5-turbo",
    embeddingModel: "text-embedding-3-small", // OpenAI嵌入模型
    organization: "",
  },

  // Anthropic Claude配置
  anthropic: {
    apiKey: "",
    baseURL: "https://api.anthropic.com",
    model: "claude-3-opus-20240229",
    embeddingModel: "", // Anthropic目前无嵌入模型API，使用外部服务
    version: "2023-06-01",
  },

  // DeepSeek配置
  deepseek: {
    apiKey: "",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    embeddingModel: "", // DeepSeek嵌入模型（若支持）
  },

  // 豆包（火山引擎）配置
  volcengine: {
    apiKey: "7185ce7d-9775-450c-8450-783176be6265", // 默认测试API密钥
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-251015", // 使用最新版本（注意：下划线格式，带版本号）
    embeddingModel: "doubao-embedding-text-240715", // 嵌入模型（最新版本，支持中英双语）
  },

  // 自定义配置
  custom: {
    apiKey: "",
    baseURL: "",
    model: "",
    embeddingModel: "",
    name: "Custom Provider",
  },

  // 通用选项
  options: {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    timeout: 300000, // 5分钟
  },

  // 系统提示词
  systemPrompt:
    "You are a helpful AI assistant for a knowledge management system.",

  // 流式输出
  streamEnabled: true,

  // 自动保存对话
  autoSaveConversations: true,
};

/**
 * LLM配置管理器
 */
class LLMConfig {
  constructor() {
    this.configPath = this.getConfigPath();
    this.config = { ...DEFAULT_CONFIG };
    this.loaded = false;
    this.secureStorage = getSecureConfigStorage();
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    const userDataPath = app.getPath("userData");
    return path.join(userDataPath, "llm-config.json");
  }

  /**
   * 加载配置
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf8");
        const savedConfig = JSON.parse(content);

        this.config = {
          ...DEFAULT_CONFIG,
          ...savedConfig,
          ollama: { ...DEFAULT_CONFIG.ollama, ...(savedConfig.ollama || {}) },
          openai: { ...DEFAULT_CONFIG.openai, ...(savedConfig.openai || {}) },
          anthropic: {
            ...DEFAULT_CONFIG.anthropic,
            ...(savedConfig.anthropic || {}),
          },
          deepseek: {
            ...DEFAULT_CONFIG.deepseek,
            ...(savedConfig.deepseek || {}),
          },
          volcengine: {
            ...DEFAULT_CONFIG.volcengine,
            ...(savedConfig.volcengine || {}),
          },
          custom: { ...DEFAULT_CONFIG.custom, ...(savedConfig.custom || {}) },
          options: {
            ...DEFAULT_CONFIG.options,
            ...(savedConfig.options || {}),
          },
        };

        this.config.provider = normalizeProvider(this.config.provider);

        // 🔥 自动迁移旧的火山引擎模型名称
        let needsMigration = false;
        if (this.config.volcengine) {
          // 迁移对话模型
          const oldModel = this.config.volcengine.model;
          if (
            oldModel &&
            (oldModel.includes("doubao-seed-1.6-flash") ||
              oldModel.includes("doubao-seed-1.6-lite") ||
              oldModel === "doubao-seed-1.6" ||
              !oldModel.match(/-\d{6}$/)) // 没有版本号后缀
          ) {
            logger.info(
              `[LLMConfig] 迁移旧模型: ${oldModel} → doubao-seed-1-6-251015`,
            );
            this.config.volcengine.model = "doubao-seed-1-6-251015";
            needsMigration = true;
          }

          // 迁移嵌入模型
          const oldEmbedding = this.config.volcengine.embeddingModel;
          if (
            oldEmbedding &&
            (oldEmbedding === "doubao-embedding" ||
              oldEmbedding === "doubao-embedding-large" ||
              !oldEmbedding.match(/-\d{6}$/)) // 没有版本号后缀
          ) {
            logger.info(
              `[LLMConfig] 迁移旧嵌入模型: ${oldEmbedding} → doubao-embedding-text-240715`,
            );
            this.config.volcengine.embeddingModel =
              "doubao-embedding-text-240715";
            needsMigration = true;
          }
        }

        // 如果有迁移，自动保存新配置
        if (needsMigration) {
          logger.info("[LLMConfig] 检测到旧配置，已自动迁移并保存");
          this.save();
        }

        // 从安全存储加载敏感字段
        this._loadSensitiveFields();

        this.loaded = true;
        logger.info("[LLMConfig] 配置加载成功");
      } else {
        logger.info("[LLMConfig] 配置文件不存在，使用默认配置");
        // 尝试从安全存储恢复敏感字段
        this._loadSensitiveFields();
        this.loaded = false;
      }
    } catch (error) {
      logger.error("[LLMConfig] 配置加载失败:", error);
      this.config = { ...DEFAULT_CONFIG };
      this.loaded = false;
    }

    return this.config;
  }

  /**
   * 从安全存储加载敏感字段
   * @private
   */
  _loadSensitiveFields() {
    try {
      const sensitiveData = this.secureStorage.load();
      if (sensitiveData) {
        mergeSensitiveFields(this.config, sensitiveData);
        logger.info("[LLMConfig] 敏感配置已从安全存储加载");
      }
    } catch (error) {
      logger.warn("[LLMConfig] 加载敏感配置失败:", error.message);
    }
  }

  /**
   * 保存配置
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 提取敏感字段并保存到安全存储
      const sensitiveData = extractSensitiveFields(this.config);
      if (Object.keys(sensitiveData).length > 0) {
        const secureResult = this.secureStorage.save(sensitiveData);
        if (secureResult) {
          logger.info("[LLMConfig] 敏感配置已加密保存");
        }
      }

      // 脱敏后保存到普通配置文件
      const configToSave = sanitizeConfig(this.config);

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(configToSave, null, 2),
        "utf8",
      );

      logger.info("[LLMConfig] 配置保存成功");
      return true;
    } catch (error) {
      logger.error("[LLMConfig] 配置保存失败:", error);
      return false;
    }
  }

  /**
   * 获取配置项
   */
  get(key, defaultValue = null) {
    const keys = key.split(".");
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 设置配置项
   */
  set(key, value) {
    const keys = key.split(".");
    let target = this.config;

    if (keys.length === 1 && keys[0] === "provider") {
      value = normalizeProvider(value);
    }

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== "object") {
        target[k] = {};
      }
      target = target[k];
    }

    target[keys[keys.length - 1]] = value;
  }

  /**
   * 获取全部配置
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * 重置为默认配置
   */
  reset() {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
  }

  // 便捷方法

  getProvider() {
    return normalizeProvider(this.config.provider);
  }

  setProvider(provider) {
    this.config.provider = normalizeProvider(provider);
    this.save();
  }

  getProviderConfig(provider = null) {
    const p = normalizeProvider(provider || this.config.provider);

    switch (p) {
      case "ollama":
        return this.config.ollama;
      case "openai":
        return this.config.openai;
      case "anthropic":
        return this.config.anthropic;
      case "deepseek":
        return this.config.deepseek;
      case "volcengine":
        return this.config.volcengine;
      case "custom":
        return this.config.custom;
      default:
        return {};
    }
  }

  setProviderConfig(provider, config) {
    const normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider in this.config) {
      this.config[normalizedProvider] = {
        ...this.config[normalizedProvider],
        ...config,
      };
      this.save();
    }
  }

  getOptions() {
    return this.config.options;
  }

  setOptions(options) {
    this.config.options = { ...this.config.options, ...options };
    this.save();
  }

  getSystemPrompt() {
    return this.config.systemPrompt;
  }

  setSystemPrompt(prompt) {
    this.config.systemPrompt = prompt;
    this.save();
  }

  isStreamEnabled() {
    return this.config.streamEnabled === true;
  }

  setStreamEnabled(enabled) {
    this.config.streamEnabled = enabled;
    this.save();
  }

  isAutoSaveEnabled() {
    return this.config.autoSaveConversations === true;
  }

  setAutoSave(enabled) {
    this.config.autoSaveConversations = enabled;
    this.save();
  }

  /**
   * 验证配置
   */
  validate() {
    const errors = [];

    switch (normalizeProvider(this.config.provider)) {
      case "ollama":
        if (!this.config.ollama.url) {
          errors.push("Ollama URL未配置");
        }
        break;

      case "openai":
        if (!this.config.openai.apiKey) {
          errors.push("OpenAI API Key未配置");
        }
        break;

      case "anthropic":
        if (!this.config.anthropic.apiKey) {
          errors.push("Anthropic API Key未配置");
        }
        break;

      case "deepseek":
        if (!this.config.deepseek.apiKey) {
          errors.push("DeepSeek API Key未配置");
        }
        break;

      case "volcengine":
        if (!this.config.volcengine.apiKey) {
          errors.push("豆包（火山引擎）API Key未配置");
        }
        break;

      case "custom":
        if (!this.config.custom.baseURL) {
          errors.push("自定义API URL未配置");
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取管理器配置
   */
  getManagerConfig() {
    const providerConfig = this.getProviderConfig();

    const baseConfig = {
      provider: normalizeProvider(this.config.provider),
      timeout: this.config.options.timeout,
    };

    switch (normalizeProvider(this.config.provider)) {
      case "ollama":
        return {
          ...baseConfig,
          ollamaURL: providerConfig.url,
          model: providerConfig.model,
          embeddingModel: providerConfig.embeddingModel,
        };

      case "openai":
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          model: providerConfig.model,
          embeddingModel: providerConfig.embeddingModel,
          organization: providerConfig.organization,
        };

      case "anthropic":
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL || "https://api.anthropic.com",
          model: providerConfig.model,
          embeddingModel: providerConfig.embeddingModel,
          anthropicVersion: providerConfig.version,
        };

      case "deepseek":
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL || "https://api.deepseek.com/v1",
          model: providerConfig.model,
          embeddingModel: providerConfig.embeddingModel,
        };

      case "volcengine":
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL:
            providerConfig.baseURL ||
            "https://ark.cn-beijing.volces.com/api/v3",
          model: providerConfig.model,
          embeddingModel: providerConfig.embeddingModel,
        };

      case "custom":
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          model: providerConfig.model,
          embeddingModel: providerConfig.embeddingModel,
        };

      default:
        return baseConfig;
    }
  }
}

// 单例
let instance = null;

function getLLMConfig() {
  if (!instance) {
    instance = new LLMConfig();
    instance.load();
  }
  return instance;
}

module.exports = {
  LLMConfig,
  getLLMConfig,
  DEFAULT_CONFIG,
};
