/**
 * 图片上传管理器
 *
 * 整合图片处理、OCR 识别、存储管理等功能
 *
 * v0.17.0: 集成文件安全验证
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const ImageProcessor = require('./image-processor');
const OCRService = require('./ocr-service');
const ImageStorage = require('./image-storage');
const FileValidator = require('../security/file-validator');

/**
 * 上传配置
 */
const DEFAULT_CONFIG = {
  // 自动处理选项
  autoCompress: true,           // 自动压缩
  autoGenerateThumbnail: true,  // 自动生成缩略图
  autoOCR: true,                // 自动 OCR 识别

  // OCR 选项
  ocrLanguages: ['chi_sim', 'eng'],  // OCR 语言

  // 知识库集成
  autoAddToKnowledge: true,     // 自动添加到知识库
  autoIndex: true,              // 自动添加到 RAG 索引
};

/**
 * 图片上传管理器类
 */
class ImageUploader extends EventEmitter {
  constructor(databaseManager, ragManager, config = {}) {
    super();
    this.db = databaseManager;
    this.ragManager = ragManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化子模块
    this.processor = new ImageProcessor();
    this.ocrService = new OCRService({
      languages: this.config.ocrLanguages,
    });
    this.storage = new ImageStorage(databaseManager);

    // 转发子模块事件
    this.setupEventForwarding();
  }

  /**
   * 设置事件转发
   */
  setupEventForwarding() {
    // ImageProcessor 事件
    this.processor.on('compress-start', (data) => this.emit('process:compress-start', data));
    this.processor.on('compress-complete', (data) => this.emit('process:compress-complete', data));
    this.processor.on('thumbnail-complete', (data) => this.emit('process:thumbnail-complete', data));

    // OCRService 事件
    this.ocrService.on('initialize-start', () => this.emit('ocr:initialize-start'));
    this.ocrService.on('initialize-complete', () => this.emit('ocr:initialize-complete'));
    this.ocrService.on('recognize-start', (data) => this.emit('ocr:recognize-start', data));
    this.ocrService.on('recognize-complete', (data) => this.emit('ocr:recognize-complete', data));
    this.ocrService.on('progress', (data) => this.emit('ocr:progress', data));
  }

  /**
   * 初始化
   */
  async initialize() {
    try {
      console.log('[ImageUploader] 初始化图片上传器...');

      // 初始化存储
      await this.storage.initialize();

      // 初始化 OCR (延迟初始化，首次使用时再初始化)
      // await this.ocrService.initialize();

      console.log('[ImageUploader] 图片上传器初始化成功');
      return true;
    } catch (error) {
      console.error('[ImageUploader] 初始化失败:', error);
      return false;
    }
  }

  /**
   * 上传单个图片
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 上传选项
   * @returns {Promise<Object>} 上传结果
   */
  async uploadImage(imagePath, options = {}) {
    const {
      compress = this.config.autoCompress,
      generateThumbnail = this.config.autoGenerateThumbnail,
      performOCR = this.config.autoOCR,
      addToKnowledge = this.config.autoAddToKnowledge,
      addToIndex = this.config.autoIndex,
      knowledgeType = 'note',
      tags = [],
      title = null,
      skipValidation = false, // 是否跳过安全验证
    } = options;

    try {
      console.log('[ImageUploader] 开始上传图片:', path.basename(imagePath));
      this.emit('upload-start', { imagePath });

      // 🔒 安全验证: 验证图片文件安全性
      if (!skipValidation) {
        console.log(`[ImageUploader] 验证图片文件安全性: ${imagePath}`);
        const validation = await FileValidator.validateFile(imagePath, 'image');

        if (!validation.valid) {
          const errorMsg = `图片验证失败: ${validation.errors.join(', ')}`;
          console.error(`[ImageUploader] ${errorMsg}`);
          this.emit('upload-error', { imagePath, error: errorMsg });
          throw new Error(errorMsg);
        }

        // 记录警告信息（如SVG脚本注入）
        if (validation.warnings && validation.warnings.length > 0) {
          console.warn(`[ImageUploader] 图片安全警告:`, validation.warnings);
          this.emit('upload-warning', {
            imagePath,
            warnings: validation.warnings,
          });
        }

        // 记录验证信息
        console.log(`[ImageUploader] 图片验证通过:`, {
          hash: validation.fileInfo.hash,
          size: validation.fileInfo.size,
          extension: validation.fileInfo.extension,
          signature: validation.fileInfo.signature,
        });
      }

      const imageId = uuidv4();
      const tempDir = os.tmpdir();

      // 1. 获取原始图片元信息
      const originalMetadata = await this.processor.getMetadata(imagePath);
      console.log('[ImageUploader] 原始图片信息:', originalMetadata);

      let processedImagePath = imagePath;
      let thumbnailPath = null;
      let compressionResult = null;

      // 2. 压缩图片 (可选)
      if (compress) {
        const compressedPath = path.join(tempDir, `compressed_${imageId}.jpg`);
        compressionResult = await this.processor.compress(imagePath, compressedPath);
        processedImagePath = compressedPath;
        console.log('[ImageUploader] 图片已压缩:', compressionResult.compressionRatio + '%');
      }

      // 3. 生成缩略图 (可选)
      if (generateThumbnail) {
        thumbnailPath = path.join(tempDir, `thumb_${imageId}.jpg`);
        await this.processor.generateThumbnail(processedImagePath, thumbnailPath);
        console.log('[ImageUploader] 缩略图已生成');
      }

      // 4. OCR 识别 (可选)
      let ocrResult = null;
      if (performOCR) {
        try {
          ocrResult = await this.ocrService.recognize(processedImagePath);
          console.log('[ImageUploader] OCR 识别完成:', ocrResult.text.length, '字符');
          console.log('[ImageUploader] OCR 置信度:', ocrResult.confidence.toFixed(2) + '%');
        } catch (error) {
          console.error('[ImageUploader] OCR 识别失败:', error);
          ocrResult = null;
        }
      }

      // 5. 保存图片到存储
      const metadata = {
        id: imageId,
        width: compressionResult ? compressionResult.compressedWidth : originalMetadata.width,
        height: compressionResult ? compressionResult.compressedHeight : originalMetadata.height,
        format: originalMetadata.format,
        ocrText: ocrResult ? ocrResult.text : null,
        ocrConfidence: ocrResult ? ocrResult.confidence : null,
      };

      const saveResult = await this.storage.saveImage(processedImagePath, metadata);
      console.log('[ImageUploader] 图片已保存:', saveResult.filename);

      // 6. 保存缩略图
      if (thumbnailPath) {
        await this.storage.saveThumbnail(imageId, thumbnailPath);
      }

      // 7. 添加到知识库 (可选)
      let knowledgeId = null;
      if (addToKnowledge && ocrResult && ocrResult.text.trim().length > 0) {
        const knowledgeItem = {
          title: title || `图片: ${path.basename(imagePath)}`,
          content: ocrResult.text,
          type: knowledgeType,
          tags: tags,
          source: imagePath,
          image_id: imageId,
        };

        const addedItem = await this.db.addKnowledgeItem(knowledgeItem);
        knowledgeId = addedItem.id;
        console.log('[ImageUploader] 已添加到知识库:', knowledgeId);

        // 更新图片记录关联
        await this.storage.updateImageRecord(imageId, {
          knowledge_id: knowledgeId,
        });

        // 8. 添加到 RAG 索引 (可选)
        if (addToIndex && this.ragManager) {
          try {
            await this.ragManager.addToIndex(addedItem);
            console.log('[ImageUploader] 已添加到 RAG 索引');
          } catch (error) {
            console.error('[ImageUploader] 添加到 RAG 索引失败:', error);
          }
        }
      }

      // 9. 清理临时文件
      if (compress && processedImagePath !== imagePath) {
        try {
          await fs.unlink(processedImagePath);
        } catch (error) {
          console.warn('[ImageUploader] 清理临时文件失败:', error);
        }
      }

      // 构建结果
      const result = {
        success: true,
        imageId: imageId,
        knowledgeId: knowledgeId,
        filename: saveResult.filename,
        path: saveResult.path,
        size: saveResult.size,
        originalSize: originalMetadata.size,
        compressionRatio: compressionResult ? compressionResult.compressionRatio : 0,
        ocrText: ocrResult ? ocrResult.text : null,
        ocrConfidence: ocrResult ? ocrResult.confidence : null,
        ocrQuality: ocrResult ? this.ocrService.evaluateQuality(ocrResult) : null,
      };

      this.emit('upload-complete', result);
      console.log('[ImageUploader] 上传完成');

      return result;
    } catch (error) {
      console.error('[ImageUploader] 上传失败:', error);
      this.emit('upload-error', { imagePath, error });
      throw error;
    }
  }

  /**
   * 批量上传图片
   * @param {Array} imagePaths - 图片路径列表
   * @param {Object} options - 上传选项
   * @returns {Promise<Array>} 上传结果列表
   */
  async uploadImages(imagePaths, options = {}) {
    console.log(`[ImageUploader] 开始批量上传 ${imagePaths.length} 张图片`);
    this.emit('batch-start', { total: imagePaths.length });

    const results = [];

    for (let i = 0; i < imagePaths.length; i++) {
      try {
        this.emit('batch-progress', {
          current: i + 1,
          total: imagePaths.length,
          percentage: Math.round(((i + 1) / imagePaths.length) * 100),
        });

        const result = await this.uploadImage(imagePaths[i], options);
        results.push({
          success: true,
          path: imagePaths[i],
          ...result,
        });
      } catch (error) {
        results.push({
          success: false,
          path: imagePaths[i],
          error: error.message,
        });
      }
    }

    const summary = {
      total: imagePaths.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };

    this.emit('batch-complete', summary);
    console.log('[ImageUploader] 批量上传完成:', summary);

    return results;
  }

  /**
   * 仅执行 OCR (不保存图片)
   * @param {string} imagePath - 图片路径
   * @returns {Promise<Object>} OCR 结果
   */
  async performOCR(imagePath) {
    try {
      console.log('[ImageUploader] 执行 OCR:', path.basename(imagePath));

      const result = await this.ocrService.recognize(imagePath);
      const quality = this.ocrService.evaluateQuality(result);

      return {
        success: true,
        text: result.text,
        confidence: result.confidence,
        quality: quality,
        words: result.words,
        lines: result.lines,
      };
    } catch (error) {
      console.error('[ImageUploader] OCR 失败:', error);
      throw error;
    }
  }

  /**
   * 获取图片信息
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object|null>}
   */
  async getImageInfo(imageId) {
    return await this.storage.getImageRecord(imageId);
  }

  /**
   * 获取所有图片
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getAllImages(options = {}) {
    return await this.storage.getAllImages(options);
  }

  /**
   * 搜索图片 (通过 OCR 文本)
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>}
   */
  async searchImages(query) {
    return await this.storage.searchImages(query);
  }

  /**
   * 删除图片
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object>}
   */
  async deleteImage(imageId) {
    return await this.storage.deleteImage(imageId);
  }

  /**
   * 获取统计信息
   * @returns {Promise<Object>}
   */
  async getStats() {
    return await this.storage.getStats();
  }

  /**
   * 获取支持的图片格式
   * @returns {Array}
   */
  getSupportedFormats() {
    return this.processor.getSupportedFormats();
  }

  /**
   * 获取支持的 OCR 语言
   * @returns {Array}
   */
  getSupportedLanguages() {
    return this.ocrService.getSupportedLanguages();
  }

  /**
   * 更新配置
   * @param {Object} newConfig
   */
  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    // 更新子模块配置
    if (newConfig.ocrLanguages) {
      await this.ocrService.updateConfig({
        languages: newConfig.ocrLanguages,
      });
    }

    console.log('[ImageUploader] 配置已更新:', this.config);
  }

  /**
   * 终止服务
   */
  async terminate() {
    console.log('[ImageUploader] 终止服务...');
    await this.ocrService.terminate();
  }
}

module.exports = ImageUploader;
