/**
 * 语音识别配置管理
 *
 * 管理语音识别系统的所有配置选项
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 默认引擎
  defaultEngine: 'whisper-api',

  // Web Speech API 配置
  webSpeech: {
    lang: 'zh-CN',
    continuous: true,
    interimResults: true,
    maxAlternatives: 1,
  },

  // Whisper API 配置
  whisperAPI: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: 'whisper-1',
    language: 'zh',           // 中文
    temperature: 0,           // 0 = 更准确，1 = 更创造性
    responseFormat: 'json',   // json | text | srt | vtt
    timeout: 60000,           // 60秒超时
  },

  // Whisper Local 配置 (Phase 2)
  whisperLocal: {
    serverUrl: process.env.WHISPER_LOCAL_URL || 'http://localhost:8002',  // 本地 Whisper 服务器
    modelSize: 'base',        // tiny/base/small/medium/large
    device: 'auto',           // auto/cpu/cuda
    timeout: 120000,          // 2分钟超时
  },

  // 音频处理配置
  audio: {
    // Whisper 最佳格式
    targetFormat: 'wav',
    targetSampleRate: 16000,  // 16kHz
    targetChannels: 1,        // 单声道

    // 文件限制
    maxFileSize: 25 * 1024 * 1024,  // 25MB (Whisper API 限制)
    maxDuration: 3600,              // 1小时

    // 分段处理
    segmentDuration: 300,           // 5分钟分段

    // 支持的格式
    supportedFormats: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm'],
  },

  // 存储配置
  storage: {
    savePath: path.join(process.cwd(), 'data', 'audio'),
    keepOriginal: true,          // 保留原始文件
    keepProcessed: false,        // 不保留处理后的文件（节省空间）
    autoCleanup: true,           // 自动清理临时文件
    cleanupAfterDays: 30,        // 30天后清理
  },

  // 知识库集成
  knowledgeIntegration: {
    autoSaveToKnowledge: true,   // 自动保存到知识库
    autoAddToIndex: true,        // 自动添加到 RAG 索引
    defaultType: 'note',         // 默认笔记类型
  },

  // 性能配置
  performance: {
    maxConcurrentJobs: 2,        // 最大并发转录任务
    enableCache: true,           // 启用缓存
    cacheExpiration: 3600000,    // 缓存1小时
  },
};

/**
 * 语音配置管理类
 */
class SpeechConfig {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(process.cwd(), 'data', 'speech-config.json');
    this.config = { ...DEFAULT_CONFIG };
    this.loaded = false;
  }

  /**
   * 加载配置
   */
  async load() {
    try {
      // 检查配置文件是否存在
      const exists = await fs.access(this.configPath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = await fs.readFile(this.configPath, 'utf-8');
        const userConfig = JSON.parse(data);

        // 深度合并配置
        this.config = this.deepMerge(DEFAULT_CONFIG, userConfig);
        console.log('[SpeechConfig] 已加载用户配置');
      } else {
        // 使用默认配置
        this.config = { ...DEFAULT_CONFIG };
        console.log('[SpeechConfig] 使用默认配置');

        // 保存默认配置到文件
        await this.save();
      }

      // 从环境变量更新 API 密钥
      if (process.env.OPENAI_API_KEY) {
        this.config.whisperAPI.apiKey = process.env.OPENAI_API_KEY;
      }

      if (process.env.OPENAI_BASE_URL) {
        this.config.whisperAPI.baseURL = process.env.OPENAI_BASE_URL;
      }

      // 从环境变量读取默认引擎
      if (process.env.SPEECH_DEFAULT_ENGINE) {
        this.config.defaultEngine = process.env.SPEECH_DEFAULT_ENGINE;
      }

      this.loaded = true;
      return this.config;
    } catch (error) {
      console.error('[SpeechConfig] 加载配置失败:', error);
      this.config = { ...DEFAULT_CONFIG };
      this.loaded = true;
      return this.config;
    }
  }

  /**
   * 保存配置
   */
  async save() {
    try {
      // 确保目录存在
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });

      // 保存配置（不包含敏感信息）
      const configToSave = { ...this.config };

      // 移除 API 密钥（从环境变量读取）
      if (configToSave.whisperAPI) {
        delete configToSave.whisperAPI.apiKey;
      }

      await fs.writeFile(
        this.configPath,
        JSON.stringify(configToSave, null, 2),
        'utf-8'
      );

      console.log('[SpeechConfig] 配置已保存');
      return true;
    } catch (error) {
      console.error('[SpeechConfig] 保存配置失败:', error);
      return false;
    }
  }

  /**
   * 获取所有配置
   */
  getAll() {
    if (!this.loaded) {
      console.warn('[SpeechConfig] 配置尚未加载，使用默认配置');
      return { ...DEFAULT_CONFIG };
    }
    return this.config;
  }

  /**
   * 获取单个配置项
   */
  get(key) {
    return this.getNestedValue(this.config, key);
  }

  /**
   * 设置配置项
   */
  set(key, value) {
    this.setNestedValue(this.config, key, value);
  }

  /**
   * 更新配置（批量）
   */
  async update(newConfig) {
    this.config = this.deepMerge(this.config, newConfig);
    await this.save();
    return this.config;
  }

  /**
   * 重置为默认配置
   */
  async reset() {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();
    return this.config;
  }

  /**
   * 获取引擎配置
   */
  getEngineConfig(engineType) {
    switch (engineType) {
      case 'webspeech':
        return this.config.webSpeech;
      case 'whisper-api':
        return this.config.whisperAPI;
      case 'whisper-local':
        return this.config.whisperLocal;
      default:
        console.warn(`[SpeechConfig] 未知引擎类型: ${engineType}，使用默认配置`);
        return {};
    }
  }

  /**
   * 验证配置
   */
  validate() {
    const errors = [];

    // 验证 Whisper API 配置
    if (this.config.defaultEngine === 'whisper-api') {
      if (!this.config.whisperAPI.apiKey) {
        errors.push('Whisper API: 缺少 API 密钥 (OPENAI_API_KEY)');
      }
      if (!this.config.whisperAPI.baseURL) {
        errors.push('Whisper API: 缺少 baseURL');
      }
    }

    // 验证 Whisper Local 配置
    if (this.config.defaultEngine === 'whisper-local') {
      if (!this.config.whisperLocal.modelPath) {
        errors.push('Whisper Local: 缺少模型路径');
      }
    }

    // 验证存储路径
    if (!this.config.storage.savePath) {
      errors.push('存储配置: 缺少保存路径');
    }

    return {
      valid: errors.length === 0,
      errors: errors,
    };
  }

  /**
   * 深度合并对象
   */
  deepMerge(target, source) {
    const output = { ...target };

    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }

    return output;
  }

  /**
   * 检查是否为对象
   */
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * 获取嵌套值
   */
  getNestedValue(obj, key) {
    const keys = key.split('.');
    let value = obj;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * 设置嵌套值
   */
  setNestedValue(obj, key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();
    let target = obj;

    for (const k of keys) {
      if (!(k in target) || typeof target[k] !== 'object') {
        target[k] = {};
      }
      target = target[k];
    }

    target[lastKey] = value;
  }
}

module.exports = SpeechConfig;
