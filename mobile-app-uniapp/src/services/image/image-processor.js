/**
 * 图像处理服务 (移动端版本)
 *
 * 使用uni-app Canvas API实现图像处理功能
 * 功能对齐桌面端（Sharp库）
 *
 * 核心功能:
 * - 图像压缩
 * - 缩略图生成
 * - 图像裁剪
 * - 图像旋转
 * - 格式转换
 */

/**
 * 图像处理器类
 */
class ImageProcessor {
  constructor(config = {}) {
    this.config = {
      // 压缩配置
      maxWidth: config.maxWidth || 1920,
      maxHeight: config.maxHeight || 1080,
      quality: config.quality || 0.85,

      // 缩略图配置
      thumbnailWidth: config.thumbnailWidth || 200,
      thumbnailHeight: config.thumbnailHeight || 200,

      // 支持的格式
      supportedFormats: ['jpg', 'jpeg', 'png', 'webp'],

      // 输出格式
      outputFormat: config.outputFormat || 'jpg',

      ...config
    }

    // 事件监听器
    this.listeners = new Map()
  }

  /**
   * 获取图像信息
   * @param {string} imagePath - 图像路径
   * @returns {Promise<Object>}
   */
  async getImageInfo(imagePath) {
    return new Promise((resolve, reject) => {
      uni.getImageInfo({
        src: imagePath,
        success: (res) => {
          resolve({
            width: res.width,
            height: res.height,
            path: res.path,
            orientation: res.orientation || 'up',
            type: res.type || 'unknown'
          })
        },
        fail: (err) => {
          reject(new Error(`获取图像信息失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 压缩图像
   * @param {string} imagePath - 输入图像路径
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>}
   */
  async compress(imagePath, options = {}) {
    const {
      maxWidth = this.config.maxWidth,
      maxHeight = this.config.maxHeight,
      quality = this.config.quality,
      format = this.config.outputFormat
    } = options

    try {
      console.log('[ImageProcessor] 开始压缩图像:', imagePath)
      this.emit('compress-start', { imagePath })

      // 获取原始图像信息
      const imageInfo = await this.getImageInfo(imagePath)

      console.log('[ImageProcessor] 原始图像:', {
        width: imageInfo.width,
        height: imageInfo.height
      })

      // 计算缩放后的尺寸
      const { width, height } = this.calculateResizeSize(
        imageInfo.width,
        imageInfo.height,
        maxWidth,
        maxHeight
      )

      console.log('[ImageProcessor] 目标尺寸:', { width, height })

      // 使用Canvas进行压缩
      const compressedPath = await this.compressWithCanvas(
        imagePath,
        width,
        height,
        quality,
        format
      )

      // 获取压缩后的图像信息
      const compressedInfo = await this.getImageInfo(compressedPath)

      // 获取文件大小
      const originalSize = await this.getFileSize(imagePath)
      const compressedSize = await this.getFileSize(compressedPath)

      const result = {
        success: true,
        originalPath: imagePath,
        compressedPath: compressedPath,
        originalWidth: imageInfo.width,
        originalHeight: imageInfo.height,
        compressedWidth: compressedInfo.width,
        compressedHeight: compressedInfo.height,
        originalSize,
        compressedSize,
        compressionRatio: ((1 - compressedSize / originalSize) * 100).toFixed(2) + '%',
        quality
      }

      console.log('[ImageProcessor] ✅ 压缩完成:', result)
      this.emit('compress-complete', result)

      return result
    } catch (error) {
      console.error('[ImageProcessor] 压缩失败:', error)
      this.emit('compress-error', { imagePath, error })
      throw error
    }
  }

  /**
   * 使用Canvas压缩图像
   * @param {string} imagePath - 图像路径
   * @param {number} width - 目标宽度
   * @param {number} height - 目标高度
   * @param {number} quality - 质量 (0-1)
   * @param {string} format - 输出格式
   * @returns {Promise<string>}
   * @private
   */
  async compressWithCanvas(imagePath, width, height, quality, format) {
    return new Promise((resolve, reject) => {
      const canvasId = `canvas-compress-${Date.now()}`

      // 创建Canvas上下文
      const ctx = uni.createCanvasContext(canvasId)

      // 加载图像
      ctx.drawImage(imagePath, 0, 0, width, height)

      // 绘制完成后导出
      ctx.draw(false, () => {
        // 导出图像
        uni.canvasToTempFilePath({
          canvasId,
          width,
          height,
          destWidth: width,
          destHeight: height,
          quality,
          fileType: format === 'png' ? 'png' : 'jpg',
          success: (res) => {
            resolve(res.tempFilePath)
          },
          fail: (err) => {
            reject(new Error(`Canvas导出失败: ${err.errMsg}`))
          }
        })
      })
    })
  }

  /**
   * 生成缩略图
   * @param {string} imagePath - 输入图像路径
   * @param {Object} options - 缩略图选项
   * @returns {Promise<Object>}
   */
  async generateThumbnail(imagePath, options = {}) {
    const {
      width = this.config.thumbnailWidth,
      height = this.config.thumbnailHeight,
      fit = 'cover'  // cover | contain | fill
    } = options

    try {
      console.log('[ImageProcessor] 生成缩略图:', imagePath)
      this.emit('thumbnail-start', { imagePath })

      // 获取原始图像信息
      const imageInfo = await this.getImageInfo(imagePath)

      // 计算裁剪/缩放参数
      const params = this.calculateThumbnailParams(
        imageInfo.width,
        imageInfo.height,
        width,
        height,
        fit
      )

      // 使用Canvas生成缩略图
      const thumbnailPath = await this.createThumbnailWithCanvas(
        imagePath,
        params
      )

      const thumbnailInfo = await this.getImageInfo(thumbnailPath)
      const size = await this.getFileSize(thumbnailPath)

      const result = {
        success: true,
        originalPath: imagePath,
        thumbnailPath,
        width: thumbnailInfo.width,
        height: thumbnailInfo.height,
        size,
        fit
      }

      console.log('[ImageProcessor] ✅ 缩略图生成完成')
      this.emit('thumbnail-complete', result)

      return result
    } catch (error) {
      console.error('[ImageProcessor] 生成缩略图失败:', error)
      this.emit('thumbnail-error', { imagePath, error })
      throw error
    }
  }

  /**
   * 使用Canvas创建缩略图
   * @param {string} imagePath - 图像路径
   * @param {Object} params - 参数
   * @returns {Promise<string>}
   * @private
   */
  async createThumbnailWithCanvas(imagePath, params) {
    return new Promise((resolve, reject) => {
      const canvasId = `canvas-thumb-${Date.now()}`
      const ctx = uni.createCanvasContext(canvasId)

      const { sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight, canvasWidth, canvasHeight } = params

      // 绘制图像
      ctx.drawImage(imagePath, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)

      ctx.draw(false, () => {
        uni.canvasToTempFilePath({
          canvasId,
          width: canvasWidth,
          height: canvasHeight,
          destWidth: canvasWidth,
          destHeight: canvasHeight,
          quality: 0.8,
          fileType: 'jpg',
          success: (res) => {
            resolve(res.tempFilePath)
          },
          fail: (err) => {
            reject(new Error(`Canvas导出失败: ${err.errMsg}`))
          }
        })
      })
    })
  }

  /**
   * 裁剪图像
   * @param {string} imagePath - 输入图像路径
   * @param {Object} region - 裁剪区域 {left, top, width, height}
   * @returns {Promise<Object>}
   */
  async crop(imagePath, region) {
    const { left, top, width, height } = region

    try {
      console.log('[ImageProcessor] 裁剪图像:', region)

      const canvasId = `canvas-crop-${Date.now()}`
      const ctx = uni.createCanvasContext(canvasId)

      // 绘制裁剪区域
      ctx.drawImage(imagePath, left, top, width, height, 0, 0, width, height)

      const croppedPath = await new Promise((resolve, reject) => {
        ctx.draw(false, () => {
          uni.canvasToTempFilePath({
            canvasId,
            x: 0,
            y: 0,
            width,
            height,
            destWidth: width,
            destHeight: height,
            quality: 0.9,
            fileType: 'jpg',
            success: (res) => resolve(res.tempFilePath),
            fail: (err) => reject(new Error(`裁剪失败: ${err.errMsg}`))
          })
        })
      })

      return {
        success: true,
        originalPath: imagePath,
        croppedPath,
        region
      }
    } catch (error) {
      console.error('[ImageProcessor] 裁剪失败:', error)
      throw error
    }
  }

  /**
   * 旋转图像
   * @param {string} imagePath - 输入图像路径
   * @param {number} angle - 旋转角度 (90, 180, 270)
   * @returns {Promise<Object>}
   */
  async rotate(imagePath, angle) {
    try {
      console.log('[ImageProcessor] 旋转图像:', angle)

      const imageInfo = await this.getImageInfo(imagePath)

      const canvasId = `canvas-rotate-${Date.now()}`
      const ctx = uni.createCanvasContext(canvasId)

      // 计算旋转后的画布尺寸
      let canvasWidth = imageInfo.width
      let canvasHeight = imageInfo.height

      if (angle === 90 || angle === 270) {
        // 90度和270度旋转需要交换宽高
        canvasWidth = imageInfo.height
        canvasHeight = imageInfo.width
      }

      // 设置旋转中心
      const centerX = canvasWidth / 2
      const centerY = canvasHeight / 2

      // 应用旋转
      ctx.translate(centerX, centerY)
      ctx.rotate(angle * Math.PI / 180)
      ctx.drawImage(imagePath, -imageInfo.width / 2, -imageInfo.height / 2, imageInfo.width, imageInfo.height)

      const rotatedPath = await new Promise((resolve, reject) => {
        ctx.draw(false, () => {
          uni.canvasToTempFilePath({
            canvasId,
            width: canvasWidth,
            height: canvasHeight,
            destWidth: canvasWidth,
            destHeight: canvasHeight,
            quality: 0.9,
            fileType: 'jpg',
            success: (res) => resolve(res.tempFilePath),
            fail: (err) => reject(new Error(`旋转失败: ${err.errMsg}`))
          })
        })
      })

      return {
        success: true,
        originalPath: imagePath,
        rotatedPath,
        angle
      }
    } catch (error) {
      console.error('[ImageProcessor] 旋转失败:', error)
      throw error
    }
  }

  /**
   * 批量处理图像
   * @param {Array} images - 图像列表 [{path, options}]
   * @param {string} operation - 操作类型
   * @returns {Promise<Array>}
   */
  async batchProcess(images, operation = 'compress') {
    console.log('[ImageProcessor] 批量处理:', images.length, '个图像')

    const results = []

    for (let i = 0; i < images.length; i++) {
      const { path, options } = images[i]

      try {
        this.emit('batch-progress', {
          current: i + 1,
          total: images.length,
          percentage: Math.round(((i + 1) / images.length) * 100)
        })

        let result

        switch (operation) {
          case 'compress':
            result = await this.compress(path, options)
            break
          case 'thumbnail':
            result = await this.generateThumbnail(path, options)
            break
          case 'crop':
            result = await this.crop(path, options.region)
            break
          case 'rotate':
            result = await this.rotate(path, options.angle)
            break
          default:
            throw new Error(`未知操作: ${operation}`)
        }

        results.push({
          success: true,
          path,
          ...result
        })
      } catch (error) {
        results.push({
          success: false,
          path,
          error: error.message
        })
      }
    }

    this.emit('batch-complete', {
      total: images.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    })

    console.log('[ImageProcessor] ✅ 批量处理完成')

    return results
  }

  /**
   * 计算调整后的尺寸（保持宽高比）
   * @param {number} originalWidth - 原始宽度
   * @param {number} originalHeight - 原始高度
   * @param {number} maxWidth - 最大宽度
   * @param {number} maxHeight - 最大高度
   * @returns {Object}
   * @private
   */
  calculateResizeSize(originalWidth, originalHeight, maxWidth, maxHeight) {
    let width = originalWidth
    let height = originalHeight

    // 计算缩放比例
    if (width > maxWidth || height > maxHeight) {
      const widthRatio = maxWidth / width
      const heightRatio = maxHeight / height
      const ratio = Math.min(widthRatio, heightRatio)

      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
    }

    return { width, height }
  }

  /**
   * 计算缩略图参数
   * @param {number} srcWidth - 源图像宽度
   * @param {number} srcHeight - 源图像高度
   * @param {number} targetWidth - 目标宽度
   * @param {number} targetHeight - 目标高度
   * @param {string} fit - 适配模式
   * @returns {Object}
   * @private
   */
  calculateThumbnailParams(srcWidth, srcHeight, targetWidth, targetHeight, fit) {
    let sx = 0, sy = 0, sWidth = srcWidth, sHeight = srcHeight
    let dx = 0, dy = 0, dWidth = targetWidth, dHeight = targetHeight
    let canvasWidth = targetWidth, canvasHeight = targetHeight

    if (fit === 'cover') {
      // 填充模式：裁剪图像以填满目标尺寸
      const srcRatio = srcWidth / srcHeight
      const targetRatio = targetWidth / targetHeight

      if (srcRatio > targetRatio) {
        // 源图像更宽，裁剪左右
        sWidth = srcHeight * targetRatio
        sx = (srcWidth - sWidth) / 2
      } else {
        // 源图像更高，裁剪上下
        sHeight = srcWidth / targetRatio
        sy = (srcHeight - sHeight) / 2
      }
    } else if (fit === 'contain') {
      // 包含模式：完整显示图像，可能留白
      const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight)
      dWidth = srcWidth * scale
      dHeight = srcHeight * scale
      dx = (targetWidth - dWidth) / 2
      dy = (targetHeight - dHeight) / 2
    } else if (fit === 'fill') {
      // 填充模式：拉伸图像以填满目标尺寸
      // 使用默认值即可
    }

    return { sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight, canvasWidth, canvasHeight }
  }

  /**
   * 获取文件大小
   * @param {string} filePath - 文件路径
   * @returns {Promise<number>}
   * @private
   */
  async getFileSize(filePath) {
    return new Promise((resolve, reject) => {
      uni.getFileInfo({
        filePath,
        success: (res) => {
          resolve(res.size)
        },
        fail: () => {
          // 如果获取失败，返回0
          resolve(0)
        }
      })
    })
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return

    const callbacks = this.listeners.get(event)
    for (const callback of callbacks) {
      try {
        callback(data)
      } catch (error) {
        console.error('[ImageProcessor] 事件回调失败:', error)
      }
    }
  }

  /**
   * 获取支持的格式
   * @returns {Array}
   */
  getSupportedFormats() {
    return [...this.config.supportedFormats]
  }

  /**
   * 更新配置
   * @param {Object} newConfig
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig }
    console.log('[ImageProcessor] 配置已更新')
  }
}

// 创建单例
let imageProcessorInstance = null

/**
 * 获取图像处理器实例
 * @param {Object} config - 配置
 * @returns {ImageProcessor}
 */
export function getImageProcessor(config) {
  if (!imageProcessorInstance) {
    imageProcessorInstance = new ImageProcessor(config)
  }
  return imageProcessorInstance
}

export default ImageProcessor
