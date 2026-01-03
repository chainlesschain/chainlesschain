/**
 * 图片处理器
 *
 * 负责图片压缩、缩略图生成、格式转换等
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const { getResourceMonitor } = require('../utils/resource-monitor');

/**
 * 图片处理配置
 */
const DEFAULT_CONFIG = {
  // 压缩配置
  maxWidth: 1920,           // 最大宽度
  maxHeight: 1080,          // 最大高度
  quality: 85,              // JPEG 质量 (0-100)

  // 缩略图配置
  thumbnailWidth: 200,      // 缩略图宽度
  thumbnailHeight: 200,     // 缩略图高度

  // 支持的格式
  supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'],

  // 输出格式
  outputFormat: 'jpeg',     // 默认输出格式
};

/**
 * 图片处理器类
 */
class ImageProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.resourceMonitor = getResourceMonitor();

    // 监听资源水平变化
    this.resourceMonitor.on('level-change', ({ newLevel }) => {
      this.emit('resource-level-change', { level: newLevel });
      console.log(`[ImageProcessor] 资源水平变化: ${newLevel}`);
    });
  }

  /**
   * 检查文件是否为支持的图片格式
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  isSupportedImage(filePath) {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    return this.config.supportedFormats.includes(ext);
  }

  /**
   * 获取图片元信息
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<Object>} 元信息
   */
  async getMetadata(input) {
    try {
      const image = sharp(input);
      const metadata = await image.metadata();

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: metadata.size,
        space: metadata.space,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
      };
    } catch (error) {
      console.error('[ImageProcessor] 获取元信息失败:', error);
      throw error;
    }
  }

  /**
   * 压缩图片
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>} 处理结果
   */
  async compress(input, outputPath, options = {}) {
    // 获取当前资源降级策略
    const strategy = this.resourceMonitor.getDegradationStrategy('imageProcessing');
    const resourceLevel = this.resourceMonitor.currentLevel;

    const {
      maxWidth = options.maxWidth || strategy.maxDimension,
      maxHeight = options.maxHeight || strategy.maxDimension,
      quality = options.quality || strategy.quality,
      format = this.config.outputFormat,
    } = options;

    // 如果资源紧张，发出警告
    if (resourceLevel !== 'normal') {
      this.emit('resource-warning', {
        level: resourceLevel,
        strategy,
        message: `内存${resourceLevel === 'critical' ? '严重' : ''}不足，降级处理参数`
      });
    }

    try {
      this.emit('compress-start', { input, outputPath });

      // 获取原始元信息
      const originalMetadata = await this.getMetadata(input);

      // 创建处理管道
      let pipeline = sharp(input);

      // 调整大小（保持宽高比）
      if (originalMetadata.width > maxWidth || originalMetadata.height > maxHeight) {
        pipeline = pipeline.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // 转换格式和压缩
      if (format === 'jpeg' || format === 'jpg') {
        pipeline = pipeline.jpeg({ quality, progressive: true });
      } else if (format === 'png') {
        pipeline = pipeline.png({ quality, compressionLevel: 9 });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality });
      }

      // 输出文件
      await pipeline.toFile(outputPath);

      // 获取压缩后的元信息
      const compressedMetadata = await this.getMetadata(outputPath);

      // 计算文件大小
      const stats = await fs.stat(outputPath);
      const compressedSize = stats.size;

      const result = {
        success: true,
        originalSize: originalMetadata.size || 0,
        compressedSize: compressedSize,
        originalWidth: originalMetadata.width,
        originalHeight: originalMetadata.height,
        compressedWidth: compressedMetadata.width,
        compressedHeight: compressedMetadata.height,
        compressionRatio: originalMetadata.size ?
          ((1 - compressedSize / originalMetadata.size) * 100).toFixed(2) : 0,
        outputPath: outputPath,
        resourceLevel: resourceLevel,
        degraded: resourceLevel !== 'normal'
      };

      this.emit('compress-complete', result);

      // 如果内存紧张，尝试垃圾回收
      if (resourceLevel === 'critical') {
        this.resourceMonitor.forceGarbageCollection();
      }

      return result;
    } catch (error) {
      console.error('[ImageProcessor] 压缩失败:', error);

      // 如果是内存错误，尝试恢复
      if (error.message && error.message.includes('memory')) {
        this.emit('memory-error', {
          input,
          error,
          memoryStatus: this.resourceMonitor.getMemoryStatus()
        });
      }

      this.emit('compress-error', { input, error });
      throw error;
    }
  }

  /**
   * 生成缩略图
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 缩略图选项
   * @returns {Promise<Object>} 处理结果
   */
  async generateThumbnail(input, outputPath, options = {}) {
    const {
      width = this.config.thumbnailWidth,
      height = this.config.thumbnailHeight,
      fit = 'cover',
    } = options;

    try {
      this.emit('thumbnail-start', { input, outputPath });

      await sharp(input)
        .resize(width, height, {
          fit: fit,
          position: 'center',
        })
        .jpeg({ quality: 80 })
        .toFile(outputPath);

      const stats = await fs.stat(outputPath);

      const result = {
        success: true,
        width: width,
        height: height,
        size: stats.size,
        outputPath: outputPath,
      };

      this.emit('thumbnail-complete', result);
      return result;
    } catch (error) {
      console.error('[ImageProcessor] 生成缩略图失败:', error);
      this.emit('thumbnail-error', { input, error });
      throw error;
    }
  }

  /**
   * 转换图片格式
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {string} format - 目标格式 (jpeg/png/webp)
   * @returns {Promise<Object>}
   */
  async convertFormat(input, outputPath, format) {
    try {
      let pipeline = sharp(input);

      if (format === 'jpeg' || format === 'jpg') {
        pipeline = pipeline.jpeg({ quality: this.config.quality });
      } else if (format === 'png') {
        pipeline = pipeline.png({ compressionLevel: 9 });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality: this.config.quality });
      } else {
        throw new Error(`不支持的格式: ${format}`);
      }

      await pipeline.toFile(outputPath);

      const stats = await fs.stat(outputPath);

      return {
        success: true,
        format: format,
        size: stats.size,
        outputPath: outputPath,
      };
    } catch (error) {
      console.error('[ImageProcessor] 格式转换失败:', error);
      throw error;
    }
  }

  /**
   * 批量处理图片
   * @param {Array} images - 图片列表 [{input, outputPath, options}]
   * @param {string} operation - 操作类型 (compress/thumbnail)
   * @returns {Promise<Array>} 处理结果列表
   */
  async batchProcess(images, operation = 'compress') {
    const results = [];
    const strategy = this.resourceMonitor.getDegradationStrategy('imageProcessing');
    const concurrent = strategy.concurrent;

    console.log(`[ImageProcessor] 批量处理 ${images.length} 张图片，并发数: ${concurrent}`);

    // 分批处理以控制并发
    for (let batchStart = 0; batchStart < images.length; batchStart += concurrent) {
      const batch = images.slice(batchStart, batchStart + concurrent);

      // 并发处理当前批次
      const batchResults = await Promise.allSettled(
        batch.map(async ({ input, outputPath, options }, batchIndex) => {
          const i = batchStart + batchIndex;

          try {
            // 更新进度
            this.emit('batch-progress', {
              current: i + 1,
              total: images.length,
              percentage: Math.round(((i + 1) / images.length) * 100),
              resourceLevel: this.resourceMonitor.currentLevel
            });

            // 执行操作
            let result;
            if (operation === 'compress') {
              result = await this.compress(input, outputPath, options);
            } else if (operation === 'thumbnail') {
              result = await this.generateThumbnail(input, outputPath, options);
            } else {
              throw new Error(`未知操作: ${operation}`);
            }

            return {
              success: true,
              input: input,
              ...result,
            };
          } catch (error) {
            console.error(`[ImageProcessor] 处理失败 [${i + 1}/${images.length}]:`, error);
            return {
              success: false,
              input: input,
              error: error.message,
            };
          }
        })
      );

      // 收集批次结果
      batchResults.forEach(promiseResult => {
        if (promiseResult.status === 'fulfilled') {
          results.push(promiseResult.value);
        } else {
          results.push({
            success: false,
            error: promiseResult.reason?.message || '未知错误'
          });
        }
      });

      // 批次之间检查资源并可能触发垃圾回收
      if (batchStart + concurrent < images.length) {
        const currentLevel = this.resourceMonitor.updateResourceLevel();
        if (currentLevel === 'critical') {
          console.log('[ImageProcessor] 内存临界，暂停并执行垃圾回收');
          this.resourceMonitor.forceGarbageCollection();
          // 暂停 1 秒让系统恢复
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    this.emit('batch-complete', {
      total: images.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });

    return results;
  }

  /**
   * 旋转图片
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {number} angle - 旋转角度 (90, 180, 270)
   * @returns {Promise<Object>}
   */
  async rotate(input, outputPath, angle) {
    try {
      await sharp(input)
        .rotate(angle)
        .toFile(outputPath);

      return {
        success: true,
        angle: angle,
        outputPath: outputPath,
      };
    } catch (error) {
      console.error('[ImageProcessor] 旋转失败:', error);
      throw error;
    }
  }

  /**
   * 裁剪图片
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {Object} region - 裁剪区域 {left, top, width, height}
   * @returns {Promise<Object>}
   */
  async crop(input, outputPath, region) {
    const { left, top, width, height } = region;

    try {
      await sharp(input)
        .extract({ left, top, width, height })
        .toFile(outputPath);

      return {
        success: true,
        region: region,
        outputPath: outputPath,
      };
    } catch (error) {
      console.error('[ImageProcessor] 裁剪失败:', error);
      throw error;
    }
  }

  /**
   * 获取支持的格式列表
   * @returns {Array}
   */
  getSupportedFormats() {
    return [...this.config.supportedFormats];
  }

  /**
   * 更新配置
   * @param {Object} newConfig
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[ImageProcessor] 配置已更新:', this.config);
  }
}

module.exports = ImageProcessor;
