/**
 * 语音识别引擎
 *
 * 支持多种语音识别引擎的统一接口
 * - Whisper API (OpenAI)
 * - Whisper Local (本地模型)
 * - Web Speech API (浏览器)
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

/**
 * 基础识别器接口
 */
class BaseSpeechRecognizer {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 识别音频
   * @param {string|Buffer} audio - 音频数据
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>} 识别结果
   */
  async recognize(audio, options = {}) {
    throw new Error('recognize() 方法需要被子类实现');
  }

  /**
   * 获取引擎名称
   */
  getEngineName() {
    return 'base';
  }

  /**
   * 检查是否可用
   */
  async isAvailable() {
    return true;
  }
}

/**
 * Whisper API 识别器 (OpenAI)
 */
class WhisperAPIRecognizer extends BaseSpeechRecognizer {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = config.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.model = config.model || 'whisper-1';
    this.timeout = config.timeout || 60000;
  }

  /**
   * 识别音频文件
   * @param {string} audioPath - 音频文件路径
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>}
   */
  async recognize(audioPath, options = {}) {
    const {
      language = 'zh',           // 中文
      prompt = null,              // 可选的提示文本
      temperature = 0,            // 0 = 更准确
      responseFormat = 'json',    // json | text | srt | vtt
    } = options;

    try {
      console.log('[WhisperAPI] 开始识别:', path.basename(audioPath));

      // 检查 API 密钥
      if (!this.apiKey) {
        throw new Error('缺少 OpenAI API 密钥。请在 .env 文件中设置 OPENAI_API_KEY');
      }

      // 检查文件是否存在
      const fileExists = await fs.promises.access(audioPath)
        .then(() => true)
        .catch(() => false);

      if (!fileExists) {
        throw new Error(`音频文件不存在: ${audioPath}`);
      }

      // 获取文件大小
      const stats = await fs.promises.stat(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      console.log(`[WhisperAPI] 文件大小: ${fileSizeMB.toFixed(2)} MB`);

      // 检查文件大小限制 (25MB)
      if (stats.size > 25 * 1024 * 1024) {
        throw new Error('文件大小超过 25MB 限制。请使用音频分段功能。');
      }

      // 创建表单数据
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioPath));
      formData.append('model', this.model);
      formData.append('language', language);
      formData.append('response_format', responseFormat);

      if (temperature !== undefined) {
        formData.append('temperature', temperature.toString());
      }

      if (prompt) {
        formData.append('prompt', prompt);
      }

      // 发送请求
      const startTime = Date.now();

      const response = await axios.post(
        `${this.baseURL}/audio/transcriptions`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            ...formData.getHeaders(),
          },
          timeout: this.timeout,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );

      const duration = Date.now() - startTime;

      console.log(`[WhisperAPI] 识别完成，耗时: ${duration}ms`);

      // 解析响应
      let text = '';
      let language_detected = language;

      if (responseFormat === 'json') {
        text = response.data.text || '';
        language_detected = response.data.language || language;
      } else {
        text = response.data || '';
      }

      return {
        success: true,
        text: text,
        language: language_detected,
        engine: 'whisper-api',
        model: this.model,
        duration: duration,
        confidence: 0.95,  // Whisper API 不返回置信度，使用默认值
        responseFormat: responseFormat,
      };
    } catch (error) {
      console.error('[WhisperAPI] 识别失败:', error);

      // 处理特定错误
      let errorMessage = error.message;

      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 401) {
          errorMessage = 'API 密钥无效或已过期';
        } else if (status === 429) {
          errorMessage = '请求过于频繁，请稍后再试';
        } else if (status === 413) {
          errorMessage = '文件过大，请使用较小的文件或分段处理';
        } else if (data && data.error) {
          errorMessage = data.error.message || data.error;
        }
      }

      throw new Error(errorMessage);
    }
  }

  getEngineName() {
    return 'whisper-api';
  }

  async isAvailable() {
    return !!this.apiKey;
  }

  /**
   * 批量识别（自动处理速率限制）
   * @param {Array} audioPaths - 音频文件路径列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array>}
   */
  async recognizeBatch(audioPaths, options = {}) {
    const results = [];
    const delay = options.delay || 1000;  // 默认1秒延迟

    for (let i = 0; i < audioPaths.length; i++) {
      try {
        const result = await this.recognize(audioPaths[i], options);
        results.push({
          success: true,
          path: audioPaths[i],
          ...result,
        });

        // 延迟，避免触发速率限制
        if (i < audioPaths.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        results.push({
          success: false,
          path: audioPaths[i],
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * 自动检测音频语言
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>} 语言检测结果
   */
  async detectLanguage(audioPath) {
    try {
      console.log('[WhisperAPI] 开始检测语言:', path.basename(audioPath));

      // 不指定语言参数，让 Whisper 自动检测
      const result = await this.recognize(audioPath, {
        language: undefined,  // 不指定语言
        responseFormat: 'json',
      });

      return {
        success: true,
        language: result.language,
        languageName: this.getLanguageName(result.language),
        confidence: 0.9,
        text: result.text,
      };
    } catch (error) {
      console.error('[WhisperAPI] 语言检测失败:', error);
      throw error;
    }
  }

  /**
   * 获取语言名称
   * @param {string} code - 语言代码
   * @returns {string}
   */
  getLanguageName(code) {
    const languages = {
      'zh': '中文',
      'en': 'English',
      'ja': '日本語',
      'ko': '한국어',
      'fr': 'Français',
      'de': 'Deutsch',
      'es': 'Español',
      'ru': 'Русский',
      'ar': 'العربية',
      'pt': 'Português',
      'it': 'Italiano',
      'nl': 'Nederlands',
      'pl': 'Polski',
      'tr': 'Türkçe',
      'vi': 'Tiếng Việt',
      'th': 'ไทย',
      'id': 'Bahasa Indonesia',
      'ms': 'Bahasa Melayu',
      'hi': 'हिन्दी',
      'bn': 'বাংলা',
      'ta': 'தமிழ்',
      'te': 'తెలుగు',
      'ur': 'اردو',
      'fa': 'فارسی',
      'he': 'עברית',
      'uk': 'Українська',
      'cs': 'Čeština',
      'sv': 'Svenska',
      'no': 'Norsk',
      'da': 'Dansk',
      'fi': 'Suomi',
      'el': 'Ελληνικά',
      'hu': 'Magyar',
      'ro': 'Română',
      'bg': 'Български',
      'hr': 'Hrvatski',
      'sr': 'Српски',
      'sk': 'Slovenčina',
      'sl': 'Slovenščina',
      'lt': 'Lietuvių',
      'lv': 'Latviešu',
      'et': 'Eesti',
    };

    return languages[code] || code;
  }

  /**
   * 批量语言检测
   * @param {Array} audioPaths - 音频文件路径列表
   * @returns {Promise<Array>}
   */
  async detectLanguages(audioPaths) {
    const results = [];
    const delay = 1000;

    for (let i = 0; i < audioPaths.length; i++) {
      try {
        const result = await this.detectLanguage(audioPaths[i]);
        results.push({
          success: true,
          path: audioPaths[i],
          ...result,
        });

        if (i < audioPaths.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        results.push({
          success: false,
          path: audioPaths[i],
          error: error.message,
        });
      }
    }

    return results;
  }
}

/**
 * Whisper Local 识别器（本地模型）
 * Phase 2 实现
 */
class WhisperLocalRecognizer extends BaseSpeechRecognizer {
  constructor(config = {}) {
    super(config);
    this.modelPath = config.modelPath || '';
    this.modelSize = config.modelSize || 'base';  // tiny/base/small/medium/large
    this.device = config.device || 'cpu';
  }

  async recognize(audioPath, options = {}) {
    throw new Error('Whisper Local 识别器尚未实现。请使用 Whisper API 或等待 Phase 2 更新。');
  }

  getEngineName() {
    return 'whisper-local';
  }

  async isAvailable() {
    // 检查模型文件是否存在
    if (!this.modelPath) {
      return false;
    }

    try {
      await fs.promises.access(this.modelPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Web Speech API 识别器
 * 注意：此引擎在浏览器端使用，这里仅作为占位符
 */
class WebSpeechRecognizer extends BaseSpeechRecognizer {
  constructor(config = {}) {
    super(config);
    this.lang = config.lang || 'zh-CN';
  }

  async recognize(audioPath, options = {}) {
    // Web Speech API 在浏览器端实现
    // 主进程中无法使用
    throw new Error('Web Speech API 仅在浏览器端可用，请在前端组件中使用');
  }

  getEngineName() {
    return 'webspeech';
  }

  async isAvailable() {
    return false;  // 主进程中不可用
  }
}

/**
 * 语音识别器工厂类
 */
class SpeechRecognizer {
  constructor(engineType = 'whisper-api', config = {}) {
    this.engineType = engineType;
    this.config = config;
    this.engine = this.createEngine(engineType, config);
  }

  /**
   * 创建识别引擎
   * @param {string} engineType - 引擎类型
   * @param {Object} config - 引擎配置
   * @returns {BaseSpeechRecognizer}
   */
  createEngine(engineType, config) {
    switch (engineType) {
      case 'whisper-api':
        return new WhisperAPIRecognizer(config);
      case 'whisper-local':
        return new WhisperLocalRecognizer(config);
      case 'webspeech':
        return new WebSpeechRecognizer(config);
      default:
        console.warn(`[SpeechRecognizer] 未知引擎类型: ${engineType}，使用默认 Whisper API`);
        return new WhisperAPIRecognizer(config);
    }
  }

  /**
   * 识别音频
   * @param {string} audioPath - 音频文件路径
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>}
   */
  async recognize(audioPath, options = {}) {
    const available = await this.engine.isAvailable();

    if (!available) {
      throw new Error(`识别引擎 ${this.engineType} 不可用。请检查配置。`);
    }

    return await this.engine.recognize(audioPath, options);
  }

  /**
   * 切换识别引擎
   * @param {string} engineType - 引擎类型
   * @param {Object} config - 引擎配置
   */
  switchEngine(engineType, config = {}) {
    this.engineType = engineType;
    this.config = config;
    this.engine = this.createEngine(engineType, config);
    console.log(`[SpeechRecognizer] 已切换到引擎: ${engineType}`);
  }

  /**
   * 获取可用的引擎列表
   * @returns {Promise<Array>}
   */
  async getAvailableEngines() {
    const engines = [];

    // 检查 Whisper API
    const whisperAPI = new WhisperAPIRecognizer(this.config);
    if (await whisperAPI.isAvailable()) {
      engines.push({
        type: 'whisper-api',
        name: 'Whisper API (OpenAI)',
        available: true,
        description: '高精度云端识别，支持多语言',
      });
    } else {
      engines.push({
        type: 'whisper-api',
        name: 'Whisper API (OpenAI)',
        available: false,
        description: '需要 OpenAI API 密钥',
      });
    }

    // 检查 Whisper Local
    const whisperLocal = new WhisperLocalRecognizer(this.config);
    if (await whisperLocal.isAvailable()) {
      engines.push({
        type: 'whisper-local',
        name: 'Whisper Local',
        available: true,
        description: '本地离线识别',
      });
    } else {
      engines.push({
        type: 'whisper-local',
        name: 'Whisper Local',
        available: false,
        description: '需要下载模型文件（Phase 2）',
      });
    }

    // Web Speech API
    engines.push({
      type: 'webspeech',
      name: 'Web Speech API',
      available: true,
      description: '浏览器端实时识别',
      note: '仅在前端组件中可用',
    });

    return engines;
  }

  /**
   * 获取当前引擎名称
   */
  getCurrentEngine() {
    return {
      type: this.engineType,
      name: this.engine.getEngineName(),
      config: this.config,
    };
  }

  /**
   * 批量识别
   */
  async recognizeBatch(audioPaths, options = {}) {
    if (this.engine.recognizeBatch) {
      return await this.engine.recognizeBatch(audioPaths, options);
    }

    // 默认实现
    const results = [];
    for (const audioPath of audioPaths) {
      try {
        const result = await this.recognize(audioPath, options);
        results.push({
          success: true,
          path: audioPath,
          ...result,
        });
      } catch (error) {
        results.push({
          success: false,
          path: audioPath,
          error: error.message,
        });
      }
    }

    return results;
  }
}

module.exports = {
  SpeechRecognizer,
  WhisperAPIRecognizer,
  WhisperLocalRecognizer,
  WebSpeechRecognizer,
  BaseSpeechRecognizer,
};
