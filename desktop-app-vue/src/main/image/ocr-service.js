/**
 * OCR 服务
 *
 * 使用 Tesseract.js 进行图片文字识别
 */

const { logger, createLogger } = require('../utils/logger.js');
const defaultTesseract = require("tesseract.js");
const { EventEmitter } = require("events");

/**
 * OCR 配置
 */
const DEFAULT_CONFIG = {
  // 语言设置
  languages: ["chi_sim", "eng"], // 中文简体 + 英文

  // Tesseract 配置
  tessedit_pageseg_mode: "1", // 页面分割模式 (1=自动)
  tessedit_char_whitelist: "", // 字符白名单 (空=全部)

  // 性能配置
  workerCount: 1, // Worker 数量
  cacheMethod: "refresh", // 缓存策略
};

/**
 * OCR 服务类
 */
class OCRService extends EventEmitter {
  /**
   * @param {Object} config - OCR配置
   * @param {Object} tesseract - Tesseract模块 (可选，用于测试注入)
   */
  constructor(config = {}, tesseract = null) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.worker = null;
    this.isInitialized = false;
    // Support dependency injection for testing
    this._tesseract = tesseract || defaultTesseract;
  }

  /**
   * 初始化 OCR Worker
   */
  async initialize() {
    if (this.isInitialized && this.worker) {
      return;
    }

    try {
      logger.info("[OCRService] 初始化 OCR Worker...");
      this.emit("initialize-start");

      // 创建 Worker (使用注入的tesseract模块或默认模块)
      this.worker = await this._tesseract.createWorker({
        logger: (m) => {
          // 进度日志
          if (m.status === "recognizing text") {
            this.emit("progress", {
              status: m.status,
              progress: m.progress || 0,
            });
          }
          logger.info("[OCRService]", m);
        },
        errorHandler: (err) => {
          logger.error("[OCRService] Worker 错误:", err);
          this.emit("error", err);
        },
      });

      // 加载语言
      const languageString = this.config.languages.join("+");
      logger.info(`[OCRService] 加载语言: ${languageString}`);
      await this.worker.loadLanguage(languageString);
      await this.worker.initialize(languageString);

      // 设置参数
      await this.worker.setParameters({
        tessedit_pageseg_mode: this.config.tessedit_pageseg_mode,
      });

      this.isInitialized = true;
      logger.info("[OCRService] OCR Worker 初始化成功");
      this.emit("initialize-complete");
    } catch (error) {
      logger.error("[OCRService] 初始化失败:", error);
      this.isInitialized = false;
      this.emit("initialize-error", error);
      throw error;
    }
  }

  /**
   * 识别图片中的文字
   * @param {string|Buffer} image - 图片路径或 Buffer
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>} 识别结果
   */
  async recognize(image, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const {
      languages = null, // 特定语言（覆盖默认）
      rectangle = null, // 识别区域 {left, top, width, height}
    } = options;

    try {
      logger.info("[OCRService] 开始识别...");
      this.emit("recognize-start", { image });

      // 如果指定了特定语言，重新加载
      if (
        languages &&
        languages.join("+") !== this.config.languages.join("+")
      ) {
        logger.info(`[OCRService] 切换语言: ${languages.join("+")}`);
        await this.worker.loadLanguage(languages.join("+"));
        await this.worker.initialize(languages.join("+"));
      }

      // 执行识别
      const recognizeOptions = {};
      if (rectangle) {
        recognizeOptions.rectangle = rectangle;
      }

      const { data } = await this.worker.recognize(image, recognizeOptions);

      // 解析结果
      const result = {
        text: data.text.trim(),
        confidence: data.confidence,
        words: data.words.map((word) => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox,
        })),
        lines: data.lines.map((line) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
        })),
        paragraphs: data.paragraphs.map((para) => ({
          text: para.text,
          confidence: para.confidence,
          bbox: para.bbox,
        })),
        blocks: data.blocks.map((block) => ({
          text: block.text,
          confidence: block.confidence,
          bbox: block.bbox,
        })),
      };

      logger.info("[OCRService] 识别完成");
      logger.info(`[OCRService] 识别到 ${result.words.length} 个单词`);
      logger.info(`[OCRService] 平均置信度: ${result.confidence.toFixed(2)}%`);

      this.emit("recognize-complete", result);
      return result;
    } catch (error) {
      logger.error("[OCRService] 识别失败:", error);
      this.emit("recognize-error", { image, error });
      throw error;
    }
  }

  /**
   * 批量识别多张图片
   * @param {Array} images - 图片列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array>} 识别结果列表
   */
  async recognizeBatch(images, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const results = [];

    for (let i = 0; i < images.length; i++) {
      try {
        this.emit("batch-progress", {
          current: i + 1,
          total: images.length,
          percentage: Math.round(((i + 1) / images.length) * 100),
        });

        const result = await this.recognize(images[i], options);
        results.push({
          success: true,
          image: images[i],
          ...result,
        });
      } catch (error) {
        results.push({
          success: false,
          image: images[i],
          error: error.message,
        });
      }
    }

    this.emit("batch-complete", {
      total: images.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });

    return results;
  }

  /**
   * 检测图片中的文字区域
   * @param {string|Buffer} image - 图片路径或 Buffer
   * @returns {Promise<Array>} 文字区域列表
   */
  async detectTextRegions(image) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const { data } = await this.worker.recognize(image);

      // 提取所有文字区域
      const regions = data.blocks.map((block) => ({
        bbox: block.bbox,
        text: block.text,
        confidence: block.confidence,
      }));

      return regions;
    } catch (error) {
      logger.error("[OCRService] 检测文字区域失败:", error);
      throw error;
    }
  }

  /**
   * 获取支持的语言列表
   * @returns {Array} 语言代码列表
   */
  getSupportedLanguages() {
    return [
      { code: "chi_sim", name: "简体中文" },
      { code: "chi_tra", name: "繁体中文" },
      { code: "eng", name: "英语" },
      { code: "jpn", name: "日语" },
      { code: "kor", name: "韩语" },
      { code: "fra", name: "法语" },
      { code: "deu", name: "德语" },
      { code: "spa", name: "西班牙语" },
      { code: "rus", name: "俄语" },
      { code: "ara", name: "阿拉伯语" },
    ];
  }

  /**
   * 评估识别质量
   * @param {Object} result - 识别结果
   * @returns {Object} 质量评估
   */
  evaluateQuality(result) {
    const { confidence, words } = result;

    // 计算低置信度单词比例
    const lowConfidenceWords = words.filter((w) => w.confidence < 60).length;
    const lowConfidenceRatio =
      words.length > 0 ? (lowConfidenceWords / words.length) * 100 : 0;

    // 质量等级
    let quality = "unknown";
    if (confidence >= 80) {
      quality = "high";
    } else if (confidence >= 60) {
      quality = "medium";
    } else if (confidence >= 40) {
      quality = "low";
    } else {
      quality = "very_low";
    }

    return {
      quality: quality,
      confidence: confidence,
      lowConfidenceRatio: lowConfidenceRatio.toFixed(2),
      wordCount: words.length,
      recommendation: this.getQualityRecommendation(quality),
    };
  }

  /**
   * 获取质量建议
   * @param {string} quality - 质量等级
   * @returns {string}
   */
  getQualityRecommendation(quality) {
    const recommendations = {
      high: "识别质量良好，可直接使用",
      medium: "识别质量一般，建议检查并修正",
      low: "识别质量较差，建议重新拍摄或手动输入",
      very_low: "识别质量很差，建议重新拍摄清晰图片",
      unknown: "无法评估质量",
    };

    return recommendations[quality] || recommendations.unknown;
  }

  /**
   * 终止 OCR Worker
   */
  async terminate() {
    if (this.worker) {
      try {
        logger.info("[OCRService] 终止 OCR Worker...");
        await this.worker.terminate();
        this.worker = null;
        this.isInitialized = false;
        logger.info("[OCRService] OCR Worker 已终止");
      } catch (error) {
        logger.error("[OCRService] 终止 Worker 失败:", error);
      }
    }
  }

  /**
   * 更新配置
   * @param {Object} newConfig
   */
  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    // 如果语言配置改变，需要重新初始化
    if (newConfig.languages && this.isInitialized) {
      logger.info("[OCRService] 语言配置改变，重新初始化...");
      await this.terminate();
      await this.initialize();
    }

    logger.info("[OCRService] 配置已更新:", this.config);
  }

  /**
   * 获取当前配置
   * @returns {Object}
   */
  getConfig() {
    return { ...this.config };
  }
}

module.exports = OCRService;
