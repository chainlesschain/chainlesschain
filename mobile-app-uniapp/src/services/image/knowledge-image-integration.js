/**
 * 知识库图像集成服务 (移动端版本)
 *
 * 功能:
 * - 图片导入到知识库
 * - 自动OCR文字识别
 * - 图片笔记创建
 * - 批量图片处理
 */

import { getImageProcessor } from './image-processor.js'
import { getOCRService } from './ocr-service.js'
import { db as database } from '../database.js'

/**
 * 知识库图像集成类
 */
class KnowledgeImageIntegration {
  constructor(config = {}) {
    this.config = {
      // 是否启用自动OCR
      enableAutoOCR: config.enableAutoOCR !== false,

      // 是否自动压缩图片
      enableAutoCompress: config.enableAutoCompress !== false,

      // 压缩配置
      compressQuality: config.compressQuality || 0.8,
      maxWidth: config.maxWidth || 1920,
      maxHeight: config.maxHeight || 1080,

      // OCR配置
      ocrMode: config.ocrMode || 'auto',
      ocrLanguages: config.ocrLanguages || ['chi_sim', 'eng'],

      ...config
    }

    // 图像处理器
    this.imageProcessor = getImageProcessor({
      quality: this.config.compressQuality,
      maxWidth: this.config.maxWidth,
      maxHeight: this.config.maxHeight
    })

    // OCR服务
    this.ocrService = getOCRService({
      mode: this.config.ocrMode,
      languages: this.config.ocrLanguages
    })

    // 初始化状态
    this.isInitialized = false
  }

  /**
   * 初始化
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true }
    }

    try {
      console.log('[KnowledgeImage] 初始化图像集成...')

      // 初始化OCR服务（如果启用）
      if (this.config.enableAutoOCR) {
        await this.ocrService.initialize()
      }

      this.isInitialized = true

      console.log('[KnowledgeImage] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[KnowledgeImage] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 导入图片到知识库
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async importImage(imagePath, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      title = '图片笔记',
      enableOCR = this.config.enableAutoOCR,
      enableCompress = this.config.enableAutoCompress,
      tags = ''
    } = options

    try {
      console.log('[KnowledgeImage] 导入图片:', imagePath)

      let processedImagePath = imagePath
      let ocrText = ''
      let ocrConfidence = 0

      // 1. 压缩图片（如果启用）
      if (enableCompress) {
        const compressResult = await this.imageProcessor.compress(imagePath, {
          quality: this.config.compressQuality,
          maxWidth: this.config.maxWidth,
          maxHeight: this.config.maxHeight
        })

        processedImagePath = compressResult.compressedPath
        console.log('[KnowledgeImage] 图片已压缩:', compressResult.compressionRatio)
      }

      // 2. OCR识别（如果启用）
      if (enableOCR) {
        try {
          const ocrResult = await this.ocrService.recognize(processedImagePath)
          ocrText = ocrResult.text
          ocrConfidence = ocrResult.confidence

          console.log('[KnowledgeImage] OCR识别完成，文本长度:', ocrText.length)
        } catch (ocrError) {
          console.error('[KnowledgeImage] OCR识别失败:', ocrError)
          // OCR失败不影响导入
        }
      }

      // 3. 生成笔记内容
      const content = this.generateNoteContent(processedImagePath, ocrText, ocrConfidence)

      // 4. 保存到数据库
      const noteId = 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)

      await database.exec(`
        INSERT INTO notes (id, title, content, type, tags, created_at, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `, [noteId, title, content, 'image', tags, Date.now(), Date.now()])

      console.log('[KnowledgeImage] ✅ 图片笔记已创建:', noteId)

      return {
        success: true,
        noteId,
        imagePath: processedImagePath,
        ocrText,
        ocrConfidence,
        title,
        content
      }
    } catch (error) {
      console.error('[KnowledgeImage] 导入图片失败:', error)
      throw error
    }
  }

  /**
   * 批量导入图片
   * @param {Array} imagePaths - 图片路径列表
   * @param {Object} options - 选项
   * @returns {Promise<Array>}
   */
  async importBatch(imagePaths, options = {}) {
    console.log('[KnowledgeImage] 批量导入图片:', imagePaths.length, '张')

    const results = []

    for (let i = 0; i < imagePaths.length; i++) {
      try {
        const result = await this.importImage(imagePaths[i], {
          ...options,
          title: options.title || `图片笔记 ${i + 1}`
        })

        results.push({
          success: true,
          imagePath: imagePaths[i],
          ...result
        })
      } catch (error) {
        results.push({
          success: false,
          imagePath: imagePaths[i],
          error: error.message
        })
      }
    }

    console.log('[KnowledgeImage] ✅ 批量导入完成:', {
      total: imagePaths.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    })

    return results
  }

  /**
   * 为已有笔记添加OCR文本
   * @param {string} noteId - 笔记ID
   * @param {string} imagePath - 图片路径
   * @returns {Promise<Object>}
   */
  async addOCRToNote(noteId, imagePath) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      console.log('[KnowledgeImage] 为笔记添加OCR:', noteId)

      // OCR识别
      const ocrResult = await this.ocrService.recognize(imagePath)

      // 获取现有笔记
      const notes = await database.exec('SELECT content FROM notes WHERE id = ?', [noteId])

      if (!notes || notes.length === 0) {
        throw new Error('笔记不存在')
      }

      let content = notes[0].content || ''

      // 追加OCR文本
      const ocrSection = `\n\n## OCR识别文本\n\n${ocrResult.text}\n\n*识别置信度: ${ocrResult.confidence.toFixed(2)}%*`
      content += ocrSection

      // 更新笔记
      await database.exec(
        'UPDATE notes SET content = ?, updated_at = ? WHERE id = ?',
        [content, Date.now(), noteId]
      )

      console.log('[KnowledgeImage] ✅ OCR文本已添加')

      return {
        success: true,
        noteId,
        ocrText: ocrResult.text,
        ocrConfidence: ocrResult.confidence
      }
    } catch (error) {
      console.error('[KnowledgeImage] 添加OCR失败:', error)
      throw error
    }
  }

  /**
   * 生成笔记内容
   * @param {string} imagePath - 图片路径
   * @param {string} ocrText - OCR文本
   * @param {number} ocrConfidence - OCR置信度
   * @returns {string}
   * @private
   */
  generateNoteContent(imagePath, ocrText, ocrConfidence) {
    const lines = []

    // 图片
    lines.push(`![图片](${imagePath})`)
    lines.push('')

    // OCR文本（如果有）
    if (ocrText && ocrText.trim()) {
      lines.push('## 识别文本')
      lines.push('')
      lines.push(ocrText)
      lines.push('')
      lines.push(`*OCR识别置信度: ${ocrConfidence.toFixed(2)}%*`)
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * 从相册选择并导入图片
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async chooseAndImportImage(options = {}) {
    return new Promise((resolve, reject) => {
      uni.chooseImage({
        count: options.count || 1,
        sizeType: ['original', 'compressed'],
        sourceType: ['album', 'camera'],
        success: async (res) => {
          try {
            const imagePaths = res.tempFilePaths

            if (imagePaths.length === 1) {
              // 单张图片
              const result = await this.importImage(imagePaths[0], options)
              resolve(result)
            } else {
              // 多张图片
              const results = await this.importBatch(imagePaths, options)
              resolve({
                success: true,
                results,
                total: results.length,
                succeeded: results.filter(r => r.success).length
              })
            }
          } catch (error) {
            reject(error)
          }
        },
        fail: (err) => {
          reject(new Error(`选择图片失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 启用/禁用自动OCR
   * @param {boolean} enabled
   */
  setAutoOCR(enabled) {
    this.config.enableAutoOCR = enabled
    console.log('[KnowledgeImage] 自动OCR:', enabled ? '启用' : '禁用')
  }

  /**
   * 启用/禁用自动压缩
   * @param {boolean} enabled
   */
  setAutoCompress(enabled) {
    this.config.enableAutoCompress = enabled
    console.log('[KnowledgeImage] 自动压缩:', enabled ? '启用' : '禁用')
  }

  /**
   * 获取图像处理器
   * @returns {ImageProcessor}
   */
  getImageProcessor() {
    return this.imageProcessor
  }

  /**
   * 获取OCR服务
   * @returns {OCRService}
   */
  getOCRService() {
    return this.ocrService
  }
}

// 创建单例
let integrationInstance = null

/**
 * 获取知识库图像集成实例
 * @param {Object} config - 配置
 * @returns {KnowledgeImageIntegration}
 */
export function getKnowledgeImageIntegration(config) {
  if (!integrationInstance) {
    integrationInstance = new KnowledgeImageIntegration(config)
  }
  return integrationInstance
}

export default KnowledgeImageIntegration
