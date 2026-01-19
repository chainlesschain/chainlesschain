/**
 * 图片优化工具
 *
 * 提供图片压缩、格式转换(WebP)、尺寸调整等功能
 * 跨平台支持：App (plus.zip), H5 (Canvas), 小程序 (限制版)
 */

/**
 * 检测浏览器是否支持 WebP
 * @returns {Promise<boolean>}
 */
export function checkWebPSupport() {
  return new Promise((resolve) => {
    // #ifdef H5
    const img = new Image()
    img.onload = () => {
      resolve(img.width > 0 && img.height > 0)
    }
    img.onerror = () => {
      resolve(false)
    }
    img.src =
      'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA='
    // #endif

    // #ifdef APP-PLUS
    // App平台默认支持WebP
    resolve(true)
    // #endif

    // #ifdef MP-WEIXIN
    // 微信小程序支持WebP
    resolve(true)
    // #endif

    // #ifndef H5 || APP-PLUS || MP-WEIXIN
    resolve(false)
    // #endif
  })
}

/**
 * 获取图片信息
 * @param {String} path - 图片路径
 * @returns {Promise<Object>}
 */
export function getImageInfo(path) {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src: path,
      success: (res) => {
        resolve({
          width: res.width,
          height: res.height,
          path: res.path,
          type: res.type || 'unknown'
        })
      },
      fail: reject
    })
  })
}

/**
 * 计算缩放后的尺寸
 * @param {Number} width - 原始宽度
 * @param {Number} height - 原始高度
 * @param {Number} maxWidth - 最大宽度
 * @param {Number} maxHeight - 最大高度
 * @returns {Object}
 */
export function calculateResizeDimensions(
  width,
  height,
  maxWidth = 1920,
  maxHeight = 1920
) {
  let newWidth = width
  let newHeight = height

  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height)
    newWidth = Math.floor(width * ratio)
    newHeight = Math.floor(height * ratio)
  }

  return { width: newWidth, height: newHeight }
}

/**
 * App平台：使用 plus.zip.compressImage 压缩图片
 * @param {String} src - 源图片路径
 * @param {Object} options - 压缩选项
 * @returns {Promise<String>}
 */
function compressImageApp(src, options = {}) {
  return new Promise(async (resolve, reject) => {
    // #ifdef APP-PLUS
    const { quality = 0.8, maxWidth = 1920, maxHeight = 1920, format = 'jpg' } = options

    try {
      // 获取图片信息
      const info = await getImageInfo(src)
      const { width, height } = calculateResizeDimensions(
        info.width,
        info.height,
        maxWidth,
        maxHeight
      )

      // 生成输出路径
      const timestamp = Date.now()
      const ext = format === 'webp' ? '.webp' : '.jpg'
      const destPath = `_doc/temp_compressed_${timestamp}${ext}`

      // 压缩图片
      plus.zip.compressImage(
        {
          src,
          dst: destPath,
          quality,
          width: width.toString(),
          height: height.toString(),
          format: format === 'webp' ? 'webp' : 'jpg'
        },
        (event) => {
          resolve(event.target)
        },
        (error) => {
          console.error('[ImageOptimizer] App压缩失败:', error)
          reject(error)
        }
      )
    } catch (error) {
      reject(error)
    }
    // #endif

    // #ifndef APP-PLUS
    reject(new Error('此方法仅在App平台可用'))
    // #endif
  })
}

/**
 * H5平台：使用 Canvas 压缩图片并转换为WebP
 * @param {String} src - 源图片路径
 * @param {Object} options - 压缩选项
 * @returns {Promise<Blob>}
 */
function compressImageH5(src, options = {}) {
  return new Promise(async (resolve, reject) => {
    // #ifdef H5
    const { quality = 0.8, maxWidth = 1920, maxHeight = 1920, format = 'webp' } = options

    try {
      // 创建图片对象
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        try {
          // 计算新尺寸
          const { width, height } = calculateResizeDimensions(
            img.width,
            img.height,
            maxWidth,
            maxHeight
          )

          // 创建Canvas
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          canvas.width = width
          canvas.height = height

          // 绘制图片
          ctx.drawImage(img, 0, 0, width, height)

          // 转换为Blob
          const mimeType = format === 'webp' ? 'image/webp' : 'image/jpeg'
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob)
              } else {
                reject(new Error('Canvas转换失败'))
              }
            },
            mimeType,
            quality
          )
        } catch (error) {
          reject(error)
        }
      }

      img.onerror = () => {
        reject(new Error('图片加载失败'))
      }

      img.src = src
    } catch (error) {
      reject(error)
    }
    // #endif

    // #ifndef H5
    reject(new Error('此方法仅在H5平台可用'))
    // #endif
  })
}

/**
 * 小程序平台：压缩图片（不支持WebP转换）
 * @param {String} src - 源图片路径
 * @param {Object} options - 压缩选项
 * @returns {Promise<String>}
 */
function compressImageMp(src, options = {}) {
  return new Promise(async (resolve, reject) => {
    // #ifdef MP-WEIXIN
    const { quality = 80, maxWidth = 1920, maxHeight = 1920 } = options

    try {
      const info = await getImageInfo(src)
      const { width, height } = calculateResizeDimensions(
        info.width,
        info.height,
        maxWidth,
        maxHeight
      )

      // 小程序使用 compressImage API
      uni.compressImage({
        src,
        quality,
        compressedWidth: width,
        compressedHeight: height,
        success: (res) => {
          resolve(res.tempFilePath)
        },
        fail: reject
      })
    } catch (error) {
      reject(error)
    }
    // #endif

    // #ifndef MP-WEIXIN
    reject(new Error('此方法仅在小程序平台可用'))
    // #endif
  })
}

/**
 * 压缩并优化图片（跨平台）
 * @param {String} imagePath - 图片路径
 * @param {Object} options - 压缩选项
 * @param {Number} options.quality - 质量 0-1 (H5/App) 或 0-100 (小程序)
 * @param {Number} options.maxWidth - 最大宽度
 * @param {Number} options.maxHeight - 最大高度
 * @param {String} options.format - 输出格式 'webp' 或 'jpg'
 * @param {Boolean} options.useWebP - 是否优先使用WebP（自动检测支持）
 * @returns {Promise<String|Blob>}
 */
export async function optimizeImage(imagePath, options = {}) {
  const defaultOptions = {
    quality: 0.8,
    maxWidth: 1920,
    maxHeight: 1920,
    format: 'webp',
    useWebP: true
  }

  const opts = { ...defaultOptions, ...options }

  // 检测WebP支持
  if (opts.useWebP) {
    const supportsWebP = await checkWebPSupport()
    if (!supportsWebP) {
      opts.format = 'jpg'
    }
  }

  // #ifdef APP-PLUS
  return await compressImageApp(imagePath, opts)
  // #endif

  // #ifdef H5
  return await compressImageH5(imagePath, opts)
  // #endif

  // #ifdef MP-WEIXIN
  // 小程序不支持WebP转换，使用普通压缩
  return await compressImageMp(imagePath, { ...opts, quality: opts.quality * 100 })
  // #endif

  // #ifndef APP-PLUS || H5 || MP-WEIXIN
  throw new Error('不支持的平台')
  // #endif
}

/**
 * 批量优化图片
 * @param {Array<String>} imagePaths - 图片路径数组
 * @param {Object} options - 压缩选项
 * @param {Function} onProgress - 进度回调 (current, total, result)
 * @returns {Promise<Array>}
 */
export async function batchOptimizeImages(imagePaths, options = {}, onProgress = null) {
  const results = []
  const total = imagePaths.length

  for (let i = 0; i < total; i++) {
    try {
      const result = await optimizeImage(imagePaths[i], options)
      results.push({ success: true, path: imagePaths[i], result })

      if (onProgress) {
        onProgress(i + 1, total, result)
      }
    } catch (error) {
      console.error(`[ImageOptimizer] 图片优化失败: ${imagePaths[i]}`, error)
      results.push({ success: false, path: imagePaths[i], error: error.message })

      if (onProgress) {
        onProgress(i + 1, total, null)
      }
    }
  }

  return results
}

/**
 * 获取图片大小（字节）
 * @param {String} path - 图片路径
 * @returns {Promise<Number>}
 */
export function getImageSize(path) {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    plus.io.resolveLocalFileSystemURL(
      path,
      (entry) => {
        entry.file(
          (file) => {
            resolve(file.size)
          },
          reject
        )
      },
      reject
    )
    // #endif

    // #ifdef H5
    fetch(path)
      .then((res) => res.blob())
      .then((blob) => resolve(blob.size))
      .catch(reject)
    // #endif

    // #ifdef MP-WEIXIN
    uni.getFileInfo({
      filePath: path,
      success: (res) => {
        resolve(res.size)
      },
      fail: reject
    })
    // #endif

    // #ifndef APP-PLUS || H5 || MP-WEIXIN
    reject(new Error('不支持的平台'))
    // #endif
  })
}

/**
 * 格式化文件大小
 * @param {Number} bytes - 字节数
 * @returns {String}
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * 计算压缩率
 * @param {Number} originalSize - 原始大小
 * @param {Number} compressedSize - 压缩后大小
 * @returns {String}
 */
export function calculateCompressionRatio(originalSize, compressedSize) {
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2)
  return `${ratio}%`
}

export default {
  checkWebPSupport,
  getImageInfo,
  optimizeImage,
  batchOptimizeImages,
  getImageSize,
  formatFileSize,
  calculateCompressionRatio
}
