/**
 * LLM配置管理
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const normalizeProvider = (provider) => {
  if (!provider) return provider;
  return provider === 'claude' ? 'anthropic' : provider;
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 提供商
  provider: 'ollama', // 'ollama' | 'openai' | 'deepseek' | 'custom'

  // Ollama配置
  ollama: {
    url: 'http://localhost:11434',
    model: 'llama2',
    embeddingModel: 'nomic-embed-text', // Ollama嵌入模型
  },

  // OpenAI配置
  openai: {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    embeddingModel: 'text-embedding-3-small', // OpenAI嵌入模型
    organization: '',
  },

  // Anthropic Claude配置
  anthropic: {
    apiKey: '',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-3-opus-20240229',
    embeddingModel: '', // Anthropic目前无嵌入模型API，使用外部服务
    version: '2023-06-01',
  },

  // DeepSeek配置
  deepseek: {
    apiKey: '',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    embeddingModel: '', // DeepSeek嵌入模型（若支持）
  },

  // 豆包（火山引擎）配置
  volcengine: {
    apiKey: '',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-lite-251015',
    embeddingModel: 'doubao-embedding', // 火山引擎嵌入模型
  },

  // 自定义配置
  custom: {
    apiKey: '',
    baseURL: '',
    model: '',
    embeddingModel: '',
    name: 'Custom Provider',
  },

  // 通用选项
  options: {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    timeout: 120000, // 2分钟
  },

  // 系统提示词
  systemPrompt: 'You are a helpful AI assistant for a knowledge management system.',

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
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'llm-config.json');
  }

  /**
   * 加载配置
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const savedConfig = JSON.parse(content);

        this.config = {
          ...DEFAULT_CONFIG,
          ...savedConfig,
          ollama: { ...DEFAULT_CONFIG.ollama, ...(savedConfig.ollama || {}) },
          openai: { ...DEFAULT_CONFIG.openai, ...(savedConfig.openai || {}) },
          anthropic: { ...DEFAULT_CONFIG.anthropic, ...(savedConfig.anthropic || {}) },
          deepseek: { ...DEFAULT_CONFIG.deepseek, ...(savedConfig.deepseek || {}) },
          volcengine: { ...DEFAULT_CONFIG.volcengine, ...(savedConfig.volcengine || {}) },
          custom: { ...DEFAULT_CONFIG.custom, ...(savedConfig.custom || {}) },
          options: { ...DEFAULT_CONFIG.options, ...(savedConfig.options || {}) },
        };

        this.config.provider = normalizeProvider(this.config.provider);
        this.loaded = true;
        console.log('[LLMConfig] 配置加载成功');
      } else {
        console.log('[LLMConfig] 配置文件不存在，使用默认配置');
        this.loaded = false;
      }
    } catch (error) {
      console.error('[LLMConfig] 配置加载失败:', error);
      this.config = { ...DEFAULT_CONFIG };
      this.loaded = false;
    }

    return this.config;
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

      // 保存时过滤敏感信息到安全存储（TODO: 加密存储）
      const configToSave = JSON.parse(JSON.stringify(this.config));

      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), 'utf8');

      console.log('[LLMConfig] 配置保存成功');
      return true;
    } catch (error) {
      console.error('[LLMConfig] 配置保存失败:', error);
      return false;
    }
  }

  /**
   * 获取配置项
   */
  get(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
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
    const keys = key.split('.');
    let target = this.config;

    if (keys.length === 1 && keys[0] === 'provider') {
      value = normalizeProvider(value);
    }

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== 'object') {
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
      case 'ollama':
        return this.config.ollama;
      case 'openai':
        return this.config.openai;
      case 'anthropic':
        return this.config.anthropic;
      case 'deepseek':
        return this.config.deepseek;
      case 'volcengine':
        return this.config.volcengine;
      case 'custom':
        return this.config.custom;
      default:
        return {};
    }
  }

  setProviderConfig(provider, config) {
    const normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider in this.config) {
      this.config[normalizedProvider] = { ...this.config[normalizedProvider], ...config };
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
      case 'ollama':
        if (!this.config.ollama.url) {
          errors.push('Ollama URL未配置');
        }
        break;

      case 'openai':
        if (!this.config.openai.apiKey) {
          errors.push('OpenAI API Key未配置');
        }
        break;

      case 'anthropic':
        if (!this.config.anthropic.apiKey) {
          errors.push('Anthropic API Key未配置');
        }
        break;

      case 'deepseek':
        if (!this.config.deepseek.apiKey) {
          errors.push('DeepSeek API Key未配置');
        }
        break;

      case 'volcengine':
        if (!this.config.volcengine.apiKey) {
          errors.push('豆包（火山引擎）API Key未配置');
        }
        break;

      case 'custom':
        if (!this.config.custom.baseURL) {
          errors.push('自定义API URL未配置');
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
      case 'ollama':
        return {
          ...baseConfig,
          ollamaURL: providerConfig.url,
          model: providerConfig.model,
        };

      case 'openai':
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          model: providerConfig.model,
          organization: providerConfig.organization,
        };

      case 'anthropic':
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL || 'https://api.anthropic.com',
          model: providerConfig.model,
          anthropicVersion: providerConfig.version,
        };

      case 'deepseek':
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL || 'https://api.deepseek.com/v1',
          model: providerConfig.model,
        };

      case 'volcengine':
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL || 'https://ark.cn-beijing.volces.com/api/v3',
          model: providerConfig.model,
        };

      case 'custom':
        return {
          ...baseConfig,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          model: providerConfig.model,
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
