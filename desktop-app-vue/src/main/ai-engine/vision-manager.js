/**
 * Vision Manager - 统一视觉接口管理器
 *
 * 支持本地 LLaVA 和云端视觉 API（如火山引擎）
 * 提供图片分析、OCR、视觉问答等功能
 *
 * @module vision-manager
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * 视觉提供商类型
 */
const VisionProviders = {
  LOCAL: 'local',      // 本地 LLaVA
  VOLCENGINE: 'volcengine', // 火山引擎
  OPENAI: 'openai',    // OpenAI GPT-4V
};

/**
 * 分析类型
 */
const AnalysisTypes = {
  DESCRIBE: 'describe',     // 图片描述
  OCR: 'ocr',               // 文字识别
  VQA: 'vqa',               // 视觉问答
  ANALYZE: 'analyze',       // 通用分析
  COMPARE: 'compare',       // 图片对比
  EXTRACT: 'extract',       // 信息提取
};

/**
 * Vision Manager 类
 */
class VisionManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enableLocalVision: config.enableLocalVision !== false,
      localModel: config.localModel || 'llava:7b',
      fallbackToCloud: config.fallbackToCloud !== false,
      cloudProvider: config.cloudProvider || VisionProviders.VOLCENGINE,
      maxImageSize: config.maxImageSize || 5 * 1024 * 1024,
      timeout: config.timeout || 180000,
      cacheResults: config.cacheResults !== false,
      cacheMaxAge: config.cacheMaxAge || 3600000, // 1小时
      ...config,
    };

    // 客户端实例
    this.llavaClient = null;
    this.cloudClient = null;

    // 结果缓存
    this.cache = new Map();

    // 统计数据
    this.stats = {
      localAnalyses: 0,
      cloudAnalyses: 0,
      cacheHits: 0,
      errors: 0,
      totalDuration: 0,
    };

    this.isInitialized = false;
  }

  /**
   * 初始化 Vision Manager
   * @param {Object} dependencies - 依赖注入
   */
  async initialize(dependencies = {}) {
    logger.info('[VisionManager] 开始初始化...');

    try {
      // 初始化本地 LLaVA 客户端
      if (this.config.enableLocalVision) {
        const { LLaVAClient } = require('../llm/llava-client');
        this.llavaClient = new LLaVAClient({
          baseURL: this.config.ollamaURL || 'http://localhost:11434',
          model: this.config.localModel,
          timeout: this.config.timeout,
          maxImageSize: this.config.maxImageSize,
        });

        // 检查本地服务状态
        const status = await this.llavaClient.checkStatus();
        if (status.available && status.hasVisionModel) {
          logger.info(`[VisionManager] 本地视觉模型可用: ${status.visionModels.join(', ')}`);
        } else if (status.available) {
          logger.warn('[VisionManager] Ollama 可用，但无视觉模型。建议运行: ollama pull llava:7b');
        } else {
          logger.warn('[VisionManager] 本地 Ollama 服务不可用');
        }
      }

      // 初始化云端客户端（如果提供）
      if (dependencies.llmManager && this.config.fallbackToCloud) {
        this.cloudClient = dependencies.llmManager;
        logger.info(`[VisionManager] 云端视觉服务已配置: ${this.config.cloudProvider}`);
      }

      this.isInitialized = true;
      this.emit('initialized', { config: this.config });
      logger.info('[VisionManager] 初始化完成');

      return true;
    } catch (error) {
      logger.error('[VisionManager] 初始化失败:', error);
      this.emit('initialization-error', { error });
      throw error;
    }
  }

  /**
   * 分析图片（统一入口）
   * @param {Object} params - 分析参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.type] - 分析类型
   * @param {string} [params.prompt] - 自定义提示词
   * @param {string} [params.question] - 问题（VQA 用）
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeImage(params, options = {}) {
    const startTime = Date.now();
    const analysisType = params.type || AnalysisTypes.ANALYZE;

    this.emit('analysis-start', { params, analysisType });

    try {
      // 检查缓存
      if (this.config.cacheResults && !options.skipCache) {
        const cacheKey = this._generateCacheKey(params);
        const cached = this._getFromCache(cacheKey);
        if (cached) {
          this.stats.cacheHits++;
          logger.info('[VisionManager] 缓存命中');
          return { ...cached, fromCache: true };
        }
      }

      let result;

      // 优先使用本地模型
      if (this.llavaClient && this.config.enableLocalVision) {
        try {
          result = await this._analyzeWithLocal(params, analysisType, options);
          this.stats.localAnalyses++;
        } catch (localError) {
          logger.warn('[VisionManager] 本地分析失败，尝试云端回退:', localError.message);

          // 回退到云端
          if (this.config.fallbackToCloud && this.cloudClient) {
            result = await this._analyzeWithCloud(params, analysisType, options);
            this.stats.cloudAnalyses++;
          } else {
            throw localError;
          }
        }
      } else if (this.cloudClient) {
        // 仅云端
        result = await this._analyzeWithCloud(params, analysisType, options);
        this.stats.cloudAnalyses++;
      } else {
        throw new Error('无可用的视觉服务（本地和云端均未配置）');
      }

      // 更新统计
      const duration = Date.now() - startTime;
      this.stats.totalDuration += duration;

      // 缓存结果
      if (this.config.cacheResults && result) {
        const cacheKey = this._generateCacheKey(params);
        this._setToCache(cacheKey, result);
      }

      const finalResult = {
        ...result,
        analysisType,
        duration,
        timestamp: Date.now(),
      };

      this.emit('analysis-complete', finalResult);
      return finalResult;
    } catch (error) {
      this.stats.errors++;
      logger.error('[VisionManager] 图片分析失败:', error);
      this.emit('analysis-error', { error, params, analysisType });
      throw error;
    }
  }

  /**
   * 使用本地模型分析
   * @private
   */
  async _analyzeWithLocal(params, analysisType, options) {
    switch (analysisType) {
      case AnalysisTypes.DESCRIBE:
        return this.llavaClient.describeImage({
          imagePath: params.imagePath,
          imageBase64: params.imageBase64,
          style: params.style || 'detailed',
        }, options);

      case AnalysisTypes.OCR:
        return this.llavaClient.performOCR({
          imagePath: params.imagePath,
          imageBase64: params.imageBase64,
          language: params.language,
        }, options);

      case AnalysisTypes.VQA:
        if (!params.question) {
          throw new Error('VQA 分析需要提供问题');
        }
        return this.llavaClient.visualQA({
          imagePath: params.imagePath,
          imageBase64: params.imageBase64,
          question: params.question,
        }, options);

      case AnalysisTypes.ANALYZE:
      default:
        return this.llavaClient.analyzeImage({
          imagePath: params.imagePath,
          imageBase64: params.imageBase64,
          prompt: params.prompt || '请详细分析这张图片',
        }, options);
    }
  }

  /**
   * 使用云端服务分析
   * @private
   */
  async _analyzeWithCloud(params, analysisType, options) {
    // 准备图片数据
    let imageBase64 = params.imageBase64;
    if (!imageBase64 && params.imagePath) {
      const imageBuffer = await fs.readFile(params.imagePath);
      imageBase64 = imageBuffer.toString('base64');
    }

    // 根据分析类型构建提示词
    let prompt;
    switch (analysisType) {
      case AnalysisTypes.DESCRIBE:
        prompt = params.style === 'brief'
          ? '请用一到两句话简要描述这张图片的主要内容。'
          : '请详细描述这张图片的内容，包括主体、细节、背景和氛围。';
        break;

      case AnalysisTypes.OCR:
        prompt = `请识别并提取图片中的所有文字内容，保持原文格式。主要识别${params.language || '中文和英文'}文字。`;
        break;

      case AnalysisTypes.VQA:
        prompt = `请根据图片回答以下问题：${params.question}`;
        break;

      case AnalysisTypes.ANALYZE:
      default:
        prompt = params.prompt || '请详细分析这张图片';
    }

    // 调用云端 API
    if (this.config.cloudProvider === VisionProviders.VOLCENGINE && this.cloudClient.chatWithImageProcess) {
      // 火山引擎图像处理
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ];

      const response = await this.cloudClient.chatWithImageProcess(messages, options);
      return {
        text: response.choices?.[0]?.message?.content || response.text,
        model: response.model,
        provider: 'cloud',
        tokens: response.usage?.total_tokens || 0,
      };
    } else {
      // 通用 OpenAI 兼容 API
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ];

      const response = await this.cloudClient.chatWithMessages(messages, {
        ...options,
        model: options.model || 'gpt-4-vision-preview',
      });

      return {
        text: response.text || response.message?.content,
        model: response.model,
        provider: 'cloud',
        tokens: response.tokens || 0,
      };
    }
  }

  /**
   * 图片描述（便捷方法）
   */
  async describeImage(params, options = {}) {
    return this.analyzeImage({ ...params, type: AnalysisTypes.DESCRIBE }, options);
  }

  /**
   * OCR 文字识别（便捷方法）
   */
  async performOCR(params, options = {}) {
    return this.analyzeImage({ ...params, type: AnalysisTypes.OCR }, options);
  }

  /**
   * 视觉问答（便捷方法）
   */
  async visualQA(params, options = {}) {
    return this.analyzeImage({ ...params, type: AnalysisTypes.VQA }, options);
  }

  /**
   * 流式分析图片
   * @param {Object} params - 分析参数
   * @param {Function} onChunk - 流式回调
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 完整结果
   */
  async analyzeImageStream(params, onChunk, options = {}) {
    if (!this.llavaClient) {
      throw new Error('流式分析需要本地 LLaVA 模型');
    }

    this.emit('stream-start', { params });

    try {
      const result = await this.llavaClient.analyzeImageStream(
        {
          imagePath: params.imagePath,
          imageBase64: params.imageBase64,
          prompt: params.prompt || '请详细分析这张图片',
        },
        onChunk,
        options
      );

      this.emit('stream-complete', result);
      return result;
    } catch (error) {
      this.emit('stream-error', { error, params });
      throw error;
    }
  }

  /**
   * 批量分析图片
   * @param {Array} imageList - 图片列表
   * @param {Object} [options] - 选项
   * @returns {Promise<Array>} 分析结果列表
   */
  async batchAnalyze(imageList, options = {}) {
    const results = [];
    const concurrency = options.concurrency || 2;

    // 分批处理
    for (let i = 0; i < imageList.length; i += concurrency) {
      const batch = imageList.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(params => this.analyzeImage(params, options).catch(error => ({
          error: error.message,
          imagePath: params.imagePath,
        })))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 检查服务状态
   * @returns {Promise<Object>} 服务状态
   */
  async checkStatus() {
    const status = {
      initialized: this.isInitialized,
      localAvailable: false,
      cloudAvailable: false,
      visionModels: [],
    };

    if (this.llavaClient) {
      const localStatus = await this.llavaClient.checkStatus();
      status.localAvailable = localStatus.available && localStatus.hasVisionModel;
      status.visionModels = localStatus.visionModels || [];
    }

    if (this.cloudClient) {
      status.cloudAvailable = true;
      status.cloudProvider = this.config.cloudProvider;
    }

    return status;
  }

  /**
   * 获取统计数据
   * @returns {Object} 统计数据
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      config: {
        enableLocalVision: this.config.enableLocalVision,
        fallbackToCloud: this.config.fallbackToCloud,
        localModel: this.config.localModel,
      },
    };
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    logger.info('[VisionManager] 缓存已清除');
  }

  /**
   * 更新配置
   * @param {Object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    if (this.llavaClient && newConfig.localModel) {
      this.llavaClient.updateConfig({ model: newConfig.localModel });
    }

    logger.info('[VisionManager] 配置已更新');
  }

  // ====== 私有方法 ======

  _generateCacheKey(params) {
    const { imagePath, imageBase64, type, prompt, question } = params;
    const imageKey = imagePath || (imageBase64 ? imageBase64.substring(0, 100) : '');
    return `${imageKey}:${type || 'analyze'}:${prompt || question || ''}`;
  }

  _getFromCache(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.config.cacheMaxAge) {
      this.cache.delete(key);
      return null;
    }

    return cached.result;
  }

  _setToCache(key, result) {
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });

    // 限制缓存大小
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
}

// 单例实例
let visionManagerInstance = null;

/**
 * 获取 VisionManager 单例
 * @param {Object} config - 配置（仅首次调用时生效）
 * @returns {VisionManager}
 */
function getVisionManager(config = {}) {
  if (!visionManagerInstance) {
    visionManagerInstance = new VisionManager(config);
  }
  return visionManagerInstance;
}

module.exports = {
  VisionManager,
  VisionProviders,
  AnalysisTypes,
  getVisionManager,
};
