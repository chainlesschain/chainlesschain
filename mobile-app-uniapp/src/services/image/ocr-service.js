/**
 * OCR文字识别服务 (移动端版本)
 *
 * 支持多种OCR引擎:
 * - tesseract: Tesseract.js (H5环境)
 * - api: 后端OCR API
 * - baidu: 百度OCR (需配置API Key)
 * - tencent: 腾讯OCR (需配置API Key)
 *
 * 功能对齐桌面端
 */

/**
 * OCR服务类
 */
class OCRService {
  constructor(config = {}) {
    this.config = {
      // OCR引擎模式
      mode: config.mode || 'auto',  // auto | tesseract | api | baidu | tencent

      // 语言设置
      languages: config.languages || ['chi_sim', 'eng'],

      // API配置
      apiEndpoint: config.apiEndpoint || 'http://localhost:8000/api/ocr',

      // 百度OCR配置
      baiduApiKey: config.baiduApiKey || '',
      baiduSecretKey: config.baiduSecretKey || '',

      // 腾讯OCR配置
      tencentSecretId: config.tencentSecretId || '',
      tencentSecretKey: config.tencentSecretKey || '',

      ...config
    }

    // 当前使用的模式
    this.currentMode = null

    // 初始化状态
    this.isInitialized = false

    // Tesseract Worker (仅H5)
    this.tesseractWorker = null

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalRecognitions: 0,
      successCount: 0,
      failCount: 0
    }
  }

  /**
   * 初始化OCR服务
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true, mode: this.currentMode }
    }

    try {
      console.log('[OCRService] 初始化OCR服务...')
      this.emit('initialize-start')

      // 自动检测最佳模式
      if (this.config.mode === 'auto') {
        this.currentMode = await this.detectBestMode()
      } else {
        this.currentMode = this.config.mode
      }

      console.log('[OCRService] 使用模式:', this.currentMode)

      // 根据模式初始化
      if (this.currentMode === 'tesseract') {
        await this.initializeTesseract()
      }

      this.isInitialized = true

      console.log('[OCRService] ✅ OCR服务初始化成功')
      this.emit('initialize-complete', { mode: this.currentMode })

      return {
        success: true,
        mode: this.currentMode
      }
    } catch (error) {
      console.error('[OCRService] 初始化失败:', error)
      this.isInitialized = false
      this.emit('initialize-error', error)

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 检测最佳OCR模式
   * @returns {Promise<string>}
   * @private
   */
  async detectBestMode() {
    // #ifdef H5
    // H5环境优先使用Tesseract.js
    try {
      if (typeof window !== 'undefined' && window.Tesseract) {
        console.log('[OCRService] 检测到Tesseract.js')
        return 'tesseract'
      }
    } catch (e) {}
    // #endif

    // 检测后端API
    if (this.config.apiEndpoint) {
      try {
        const response = await uni.request({
          url: this.config.apiEndpoint + '/health',
          method: 'GET',
          timeout: 3000
        })

        if (response.statusCode === 200) {
          console.log('[OCRService] 检测到后端API')
          return 'api'
        }
      } catch (e) {}
    }

    // 检测百度OCR
    if (this.config.baiduApiKey && this.config.baiduSecretKey) {
      console.log('[OCRService] 使用百度OCR')
      return 'baidu'
    }

    // 检测腾讯OCR
    if (this.config.tencentSecretId && this.config.tencentSecretKey) {
      console.log('[OCRService] 使用腾讯OCR')
      return 'tencent'
    }

    // 默认使用API模式
    return 'api'
  }

  /**
   * 初始化Tesseract.js (仅H5)
   * @returns {Promise<void>}
   * @private
   */
  async initializeTesseract() {
    // #ifdef H5
    try {
      console.log('[OCRService] 初始化Tesseract Worker...')

      if (!window.Tesseract) {
        throw new Error('Tesseract.js未加载')
      }

      this.tesseractWorker = await window.Tesseract.createWorker({
        logger: (m) => {
          if (m.status === 'recognizing text') {
            this.emit('progress', {
              status: m.status,
              progress: m.progress || 0
            })
          }
        }
      })

      // 加载语言
      const languageString = this.config.languages.join('+')
      await this.tesseractWorker.loadLanguage(languageString)
      await this.tesseractWorker.initialize(languageString)

      console.log('[OCRService] Tesseract Worker初始化成功')
    } catch (error) {
      console.error('[OCRService] Tesseract初始化失败:', error)
      throw error
    }
    // #endif

    // #ifndef H5
    throw new Error('Tesseract.js仅在H5环境可用')
    // #endif
  }

  /**
   * 识别图像中的文字
   * @param {string} imagePath - 图像路径
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>}
   */
  async recognize(imagePath, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    this.stats.totalRecognitions++

    try {
      console.log('[OCRService] 开始识别:', imagePath)
      this.emit('recognize-start', { imagePath })

      let result

      switch (this.currentMode) {
        case 'tesseract':
          result = await this.recognizeWithTesseract(imagePath, options)
          break

        case 'api':
          result = await this.recognizeWithAPI(imagePath, options)
          break

        case 'baidu':
          result = await this.recognizeWithBaidu(imagePath, options)
          break

        case 'tencent':
          result = await this.recognizeWithTencent(imagePath, options)
          break

        default:
          throw new Error(`未知的OCR模式: ${this.currentMode}`)
      }

      this.stats.successCount++

      console.log('[OCRService] ✅ 识别完成')
      console.log('[OCRService] 识别到文本长度:', result.text.length)
      console.log('[OCRService] 置信度:', result.confidence)

      this.emit('recognize-complete', result)

      return result
    } catch (error) {
      this.stats.failCount++

      console.error('[OCRService] 识别失败:', error)
      this.emit('recognize-error', { imagePath, error })

      throw error
    }
  }

  /**
   * 使用Tesseract.js识别 (H5)
   * @param {string} imagePath - 图像路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async recognizeWithTesseract(imagePath, options) {
    // #ifdef H5
    if (!this.tesseractWorker) {
      throw new Error('Tesseract Worker未初始化')
    }

    const { data } = await this.tesseractWorker.recognize(imagePath)

    return {
      text: data.text.trim(),
      confidence: data.confidence,
      words: data.words.map(word => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      })),
      lines: data.lines.map(line => ({
        text: line.text,
        confidence: line.confidence,
        bbox: line.bbox
      })),
      mode: 'tesseract'
    }
    // #endif

    // #ifndef H5
    throw new Error('Tesseract仅在H5环境可用')
    // #endif
  }

  /**
   * 使用后端API识别
   * @param {string} imagePath - 图像路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async recognizeWithAPI(imagePath, options) {
    // 读取图像文件
    const base64 = await this.imageToBase64(imagePath)

    const response = await uni.request({
      url: this.config.apiEndpoint,
      method: 'POST',
      data: {
        image: base64,
        languages: options.languages || this.config.languages
      },
      timeout: 30000
    })

    if (response.statusCode !== 200) {
      throw new Error(`API请求失败: ${response.statusCode}`)
    }

    const data = response.data

    return {
      text: data.text || '',
      confidence: data.confidence || 0,
      words: data.words || [],
      lines: data.lines || [],
      mode: 'api'
    }
  }

  /**
   * 使用百度OCR识别
   * @param {string} imagePath - 图像路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async recognizeWithBaidu(imagePath, options) {
    // 获取Access Token
    const accessToken = await this.getBaiduAccessToken()

    // 读取图像
    const base64 = await this.imageToBase64(imagePath)

    // 调用百度OCR API
    const response = await uni.request({
      url: `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`,
      method: 'POST',
      header: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: {
        image: base64
      },
      timeout: 30000
    })

    if (response.statusCode !== 200 || response.data.error_code) {
      throw new Error(`百度OCR失败: ${response.data.error_msg || '未知错误'}`)
    }

    const words = response.data.words_result || []

    // 转换格式
    const text = words.map(w => w.words).join('\n')
    const confidence = words.length > 0
      ? words.reduce((sum, w) => sum + (w.probability?.average || 0), 0) / words.length
      : 0

    return {
      text,
      confidence: confidence * 100,
      words: words.map(w => ({
        text: w.words,
        confidence: (w.probability?.average || 0) * 100,
        bbox: w.location
      })),
      lines: words.map(w => ({
        text: w.words,
        confidence: (w.probability?.average || 0) * 100,
        bbox: w.location
      })),
      mode: 'baidu'
    }
  }

  /**
   * 使用腾讯OCR识别
   * @param {string} imagePath - 图像路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async recognizeWithTencent(imagePath, options) {
    // TODO: 实现腾讯OCR
    throw new Error('腾讯OCR暂未实现')
  }

  /**
   * 获取百度Access Token
   * @returns {Promise<string>}
   * @private
   */
  async getBaiduAccessToken() {
    const response = await uni.request({
      url: 'https://aip.baidubce.com/oauth/2.0/token',
      method: 'POST',
      data: {
        grant_type: 'client_credentials',
        client_id: this.config.baiduApiKey,
        client_secret: this.config.baiduSecretKey
      }
    })

    if (response.statusCode !== 200 || response.data.error) {
      throw new Error(`获取百度Access Token失败: ${response.data.error_description || '未知错误'}`)
    }

    return response.data.access_token
  }

  /**
   * 图像转Base64
   * @param {string} imagePath - 图像路径
   * @returns {Promise<string>}
   * @private
   */
  async imageToBase64(imagePath) {
    return new Promise((resolve, reject) => {
      uni.getFileSystemManager().readFile({
        filePath: imagePath,
        encoding: 'base64',
        success: (res) => {
          resolve(res.data)
        },
        fail: (err) => {
          reject(new Error(`读取图像失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 批量识别
   * @param {Array} images - 图像路径列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array>}
   */
  async recognizeBatch(images, options = {}) {
    console.log('[OCRService] 批量识别:', images.length, '个图像')

    const results = []

    for (let i = 0; i < images.length; i++) {
      try {
        this.emit('batch-progress', {
          current: i + 1,
          total: images.length,
          percentage: Math.round(((i + 1) / images.length) * 100)
        })

        const result = await this.recognize(images[i], options)

        results.push({
          success: true,
          image: images[i],
          ...result
        })
      } catch (error) {
        results.push({
          success: false,
          image: images[i],
          error: error.message
        })
      }
    }

    this.emit('batch-complete', {
      total: images.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    })

    return results
  }

  /**
   * 评估识别质量
   * @param {Object} result - 识别结果
   * @returns {Object}
   */
  evaluateQuality(result) {
    const { confidence, words } = result

    if (!words || words.length === 0) {
      return {
        quality: 'unknown',
        confidence: 0,
        recommendation: '无法识别到文字'
      }
    }

    // 计算低置信度单词比例
    const lowConfidenceWords = words.filter(w => w.confidence < 60).length
    const lowConfidenceRatio = (lowConfidenceWords / words.length) * 100

    // 质量等级
    let quality = 'unknown'
    if (confidence >= 80) {
      quality = 'high'
    } else if (confidence >= 60) {
      quality = 'medium'
    } else if (confidence >= 40) {
      quality = 'low'
    } else {
      quality = 'very_low'
    }

    const recommendations = {
      high: '识别质量良好，可直接使用',
      medium: '识别质量一般，建议检查并修正',
      low: '识别质量较差，建议重新拍摄或手动输入',
      very_low: '识别质量很差，建议重新拍摄清晰图片'
    }

    return {
      quality,
      confidence,
      lowConfidenceRatio: lowConfidenceRatio.toFixed(2),
      wordCount: words.length,
      recommendation: recommendations[quality] || '无法评估质量'
    }
  }

  /**
   * 获取支持的语言
   * @returns {Array}
   */
  getSupportedLanguages() {
    return [
      { code: 'chi_sim', name: '简体中文' },
      { code: 'chi_tra', name: '繁体中文' },
      { code: 'eng', name: '英语' },
      { code: 'jpn', name: '日语' },
      { code: 'kor', name: '韩语' },
      { code: 'fra', name: '法语' },
      { code: 'deu', name: '德语' },
      { code: 'spa', name: '西班牙语' },
      { code: 'rus', name: '俄语' },
      { code: 'ara', name: '阿拉伯语' }
    ]
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      mode: this.currentMode,
      totalRecognitions: this.stats.totalRecognitions,
      successCount: this.stats.successCount,
      failCount: this.stats.failCount,
      successRate: this.stats.totalRecognitions > 0
        ? ((this.stats.successCount / this.stats.totalRecognitions) * 100).toFixed(2) + '%'
        : '0%'
    }
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
        console.error('[OCRService] 事件回调失败:', error)
      }
    }
  }

  /**
   * 终止OCR服务
   * @returns {Promise<void>}
   */
  async terminate() {
    // #ifdef H5
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate()
      this.tesseractWorker = null
    }
    // #endif

    this.isInitialized = false
    console.log('[OCRService] OCR服务已终止')
  }

  /**
   * 更新配置
   * @param {Object} newConfig
   */
  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig }

    // 如果模式改变，重新初始化
    if (newConfig.mode && newConfig.mode !== this.currentMode) {
      await this.terminate()
      this.isInitialized = false
    }

    console.log('[OCRService] 配置已更新')
  }
}

// 创建单例
let ocrServiceInstance = null

/**
 * 获取OCR服务实例
 * @param {Object} config - 配置
 * @returns {OCRService}
 */
export function getOCRService(config) {
  if (!ocrServiceInstance) {
    ocrServiceInstance = new OCRService(config)
  }
  return ocrServiceInstance
}

export default OCRService
