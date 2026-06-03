/**
 * 多模态管理器 (移动端版本)
 *
 * 功能:
 * - 图像+文本混合输入
 * - GPT-4V图像理解
 * - Claude 3视觉能力
 * - Qwen-VL多模态
 * - 图像预处理和优化
 * - 图像缓存
 * - 统一的多模态接口
 */

/**
 * 多模态管理器类
 */
class MultimodalManager {
  constructor(config = {}) {
    this.config = {
      // 支持的模型
      supportedModels: {
        'gpt-4-vision-preview': { provider: 'openai', type: 'vision' },
        'gpt-4o': { provider: 'openai', type: 'vision' },
        'claude-3-opus': { provider: 'anthropic', type: 'vision' },
        'claude-3-sonnet': { provider: 'anthropic', type: 'vision' },
        'claude-3-haiku': { provider: 'anthropic', type: 'vision' },
        'qwen-vl-plus': { provider: 'dashscope', type: 'vision' },
        'qwen-vl-max': { provider: 'dashscope', type: 'vision' }
      },

      // 默认模型
      defaultModel: config.defaultModel || 'gpt-4-vision-preview',

      // 图像处理配置
      imageProcessing: {
        // 最大尺寸（像素）
        maxSize: config.maxImageSize || 2048,

        // 最大文件大小（字节）
        maxFileSize: config.maxFileSize || 5 * 1024 * 1024, // 5MB

        // 压缩质量 (0-1)
        quality: config.imageQuality || 0.8,

        // 支持的格式
        supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp']
      },

      // 缓存配置
      enableCache: config.enableCache !== false,
      cacheSize: config.cacheSize || 50,

      // API配置
      apiKeys: {
        openai: config.openaiApiKey || '',
        anthropic: config.anthropicApiKey || '',
        dashscope: config.dashscopeApiKey || ''
      },

      // API端点
      apiEndpoints: {
        openai: config.openaiEndpoint || 'https://api.openai.com/v1/chat/completions',
        anthropic: config.anthropicEndpoint || 'https://api.anthropic.com/v1/messages',
        dashscope: config.dashscopeEndpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
      },

      ...config
    }

    // 缓存
    this.imageCache = new Map()
    this.cacheKeys = [] // LRU队列

    // 初始化状态
    this.isInitialized = false

    // 统计
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      imagesProcessed: 0,
      cacheHits: 0,
      cacheMisses: 0
    }

    // 事件监听器
    this.listeners = new Map()
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
      console.log('[MultimodalManager] 初始化多模态管理器...')

      // 验证API密钥
      const hasValidKey =
        this.config.apiKeys.openai ||
        this.config.apiKeys.anthropic ||
        this.config.apiKeys.dashscope

      if (!hasValidKey) {
        console.warn('[MultimodalManager] 未配置API密钥，部分功能可能不可用')
      }

      this.isInitialized = true

      console.log('[MultimodalManager] ✅ 初始化成功')

      return {
        success: true,
        supportedModels: Object.keys(this.config.supportedModels)
      }
    } catch (error) {
      console.error('[MultimodalManager] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 多模态聊天（图像+文本）
   * @param {Array} messages - 消息列表（可包含图像）
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async chat(messages, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    this.stats.totalRequests++

    const model = options.model || this.config.defaultModel
    const modelInfo = this.config.supportedModels[model]

    if (!modelInfo) {
      throw new Error(`不支持的模型: ${model}`)
    }

    try {
      console.log('[MultimodalManager] 多模态聊天:', { model, messages: messages.length })

      // 预处理消息（处理图像）
      const processedMessages = await this.preprocessMessages(messages)

      // 根据提供商调用对应API
      let result
      switch (modelInfo.provider) {
        case 'openai':
          result = await this.chatWithOpenAI(processedMessages, model, options)
          break

        case 'anthropic':
          result = await this.chatWithAnthropic(processedMessages, model, options)
          break

        case 'dashscope':
          result = await this.chatWithDashScope(processedMessages, model, options)
          break

        default:
          throw new Error(`不支持的提供商: ${modelInfo.provider}`)
      }

      this.stats.successfulRequests++

      console.log('[MultimodalManager] ✅ 聊天成功')

      this.emit('chat-success', { model, result })

      return {
        success: true,
        content: result.content,
        model,
        usage: result.usage
      }
    } catch (error) {
      this.stats.failedRequests++

      console.error('[MultimodalManager] 聊天失败:', error)

      this.emit('chat-error', { model, error })

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 预处理消息（处理图像）
   * @param {Array} messages - 原始消息
   * @returns {Promise<Array>}
   * @private
   */
  async preprocessMessages(messages) {
    const processed = []

    for (const message of messages) {
      if (message.role === 'user' && message.images) {
        // 处理包含图像的消息
        const processedImages = await this.processImages(message.images)

        processed.push({
          role: 'user',
          content: message.content || '',
          images: processedImages
        })
      } else {
        // 纯文本消息
        processed.push(message)
      }
    }

    return processed
  }

  /**
   * 处理图像列表
   * @param {Array} images - 图像列表（路径或base64）
   * @returns {Promise<Array>}
   * @private
   */
  async processImages(images) {
    const processed = []

    for (const image of images) {
      try {
        // 检查缓存
        const cached = this.getFromCache(image)
        if (cached) {
          this.stats.cacheHits++
          processed.push(cached)
          continue
        }

        this.stats.cacheMisses++

        // 处理图像
        const processedImage = await this.processImage(image)

        // 缓存
        if (this.config.enableCache) {
          this.addToCache(image, processedImage)
        }

        processed.push(processedImage)
        this.stats.imagesProcessed++
      } catch (error) {
        console.error('[MultimodalManager] 图像处理失败:', error)
        // 跳过失败的图像
      }
    }

    return processed
  }

  /**
   * 处理单个图像
   * @param {string} image - 图像（路径或base64）
   * @returns {Promise<Object>}
   * @private
   */
  async processImage(image) {
    // 如果已经是base64，直接返回
    if (image.startsWith('data:image/')) {
      return {
        type: 'base64',
        data: image
      }
    }

    // 如果是URL
    if (image.startsWith('http://') || image.startsWith('https://')) {
      return {
        type: 'url',
        data: image
      }
    }

    // 如果是本地文件路径，读取并转换为base64
    return await this.loadLocalImage(image)
  }

  /**
   * 加载本地图像
   * @param {string} path - 图像路径
   * @returns {Promise<Object>}
   * @private
   */
  async loadLocalImage(path) {
    return new Promise((resolve, reject) => {
      // 使用uni.getFileSystemManager读取文件
      const fs = uni.getFileSystemManager()

      fs.readFile({
        filePath: path,
        encoding: 'base64',
        success: (res) => {
          // 检测文件格式
          const ext = path.split('.').pop().toLowerCase()
          const mimeType = this.getMimeType(ext)

          // 构建base64数据URI
          const base64 = `data:${mimeType};base64,${res.data}`

          // 检查文件大小
          if (res.data.length * 0.75 > this.config.imageProcessing.maxFileSize) {
            console.warn('[MultimodalManager] 图像文件过大，可能需要压缩')
          }

          resolve({
            type: 'base64',
            data: base64,
            size: res.data.length
          })
        },
        fail: (error) => {
          reject(new Error(`读取图像失败: ${error.errMsg}`))
        }
      })
    })
  }

  /**
   * 获取MIME类型
   * @param {string} ext - 文件扩展名
   * @returns {string}
   * @private
   */
  getMimeType(ext) {
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp'
    }

    return mimeTypes[ext] || 'image/jpeg'
  }

  /**
   * 使用OpenAI API聊天
   * @param {Array} messages - 消息列表
   * @param {string} model - 模型名称
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithOpenAI(messages, model, options) {
    // 构建OpenAI格式的消息
    const openaiMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        // 包含图像的消息
        const content = [
          { type: 'text', text: msg.content || '请描述这些图像' }
        ]

        for (const image of msg.images) {
          if (image.type === 'url') {
            content.push({
              type: 'image_url',
              image_url: { url: image.data }
            })
          } else if (image.type === 'base64') {
            content.push({
              type: 'image_url',
              image_url: { url: image.data }
            })
          }
        }

        return { role: msg.role, content }
      } else {
        // 纯文本消息
        return { role: msg.role, content: msg.content }
      }
    })

    // 调用OpenAI API
    const response = await uni.request({
      url: this.config.apiEndpoints.openai,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKeys.openai}`
      },
      data: {
        model,
        messages: openaiMessages,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7
      }
    })

    if (response.statusCode !== 200) {
      throw new Error(`OpenAI API错误: ${response.statusCode}`)
    }

    const result = response.data

    return {
      content: result.choices[0].message.content,
      usage: result.usage
    }
  }

  /**
   * 使用Anthropic API聊天
   * @param {Array} messages - 消息列表
   * @param {string} model - 模型名称
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithAnthropic(messages, model, options) {
    // 构建Anthropic格式的消息
    const anthropicMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        // 包含图像的消息
        const content = []

        // 添加文本
        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content
          })
        }

        // 添加图像
        for (const image of msg.images) {
          if (image.type === 'base64') {
            // 提取base64数据和媒体类型
            const match = image.data.match(/data:(image\/\w+);base64,(.+)/)
            if (match) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2]
                }
              })
            }
          } else if (image.type === 'url') {
            // Claude 3需要先下载URL图像转为base64
            console.warn('[MultimodalManager] Anthropic暂不支持URL图像，请使用base64')
          }
        }

        return { role: msg.role, content }
      } else {
        // 纯文本消息
        return { role: msg.role, content: msg.content }
      }
    })

    // 调用Anthropic API
    const response = await uni.request({
      url: this.config.apiEndpoints.anthropic,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKeys.anthropic,
        'anthropic-version': '2023-06-01'
      },
      data: {
        model,
        messages: anthropicMessages,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7
      }
    })

    if (response.statusCode !== 200) {
      throw new Error(`Anthropic API错误: ${response.statusCode}`)
    }

    const result = response.data

    return {
      content: result.content[0].text,
      usage: result.usage
    }
  }

  /**
   * 使用DashScope API聊天（Qwen-VL）
   * @param {Array} messages - 消息列表
   * @param {string} model - 模型名称
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithDashScope(messages, model, options) {
    // 构建DashScope格式的消息
    const dashscopeMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        // 包含图像的消息
        const content = []

        // 添加图像
        for (const image of msg.images) {
          if (image.type === 'url') {
            content.push({ image: image.data })
          } else if (image.type === 'base64') {
            // Qwen-VL也支持base64
            content.push({ image: image.data })
          }
        }

        // 添加文本
        if (msg.content) {
          content.push({ text: msg.content })
        }

        return { role: msg.role, content }
      } else {
        // 纯文本消息
        return { role: msg.role, content: [{ text: msg.content }] }
      }
    })

    // 调用DashScope API
    const response = await uni.request({
      url: this.config.apiEndpoints.dashscope,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKeys.dashscope}`
      },
      data: {
        model,
        input: {
          messages: dashscopeMessages
        },
        parameters: {
          max_tokens: options.maxTokens || 1000,
          temperature: options.temperature || 0.7
        }
      }
    })

    if (response.statusCode !== 200) {
      throw new Error(`DashScope API错误: ${response.statusCode}`)
    }

    const result = response.data

    return {
      content: result.output.choices[0].message.content[0].text,
      usage: result.usage
    }
  }

  /**
   * 图像问答（便捷方法）
   * @param {string|Array} images - 图像路径或路径列表
   * @param {string} question - 问题
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async askAboutImage(images, question, options = {}) {
    // 确保images是数组
    const imageList = Array.isArray(images) ? images : [images]

    const messages = [
      {
        role: 'user',
        content: question,
        images: imageList
      }
    ]

    return await this.chat(messages, options)
  }

  /**
   * 图像描述（便捷方法）
   * @param {string|Array} images - 图像路径或路径列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async describeImage(images, options = {}) {
    return await this.askAboutImage(
      images,
      '请详细描述这张图片的内容。',
      options
    )
  }

  /**
   * 图像OCR（便捷方法）
   * @param {string|Array} images - 图像路径或路径列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async extractTextFromImage(images, options = {}) {
    return await this.askAboutImage(
      images,
      '请提取图片中的所有文字内容，保持原有格式。',
      options
    )
  }

  /**
   * 图像分析（便捷方法）
   * @param {string|Array} images - 图像路径或路径列表
   * @param {string} aspect - 分析方面（如"情感"、"物体"、"场景"等）
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async analyzeImage(images, aspect = '内容', options = {}) {
    return await this.askAboutImage(
      images,
      `请分析图片的${aspect}。`,
      options
    )
  }

  /**
   * 从缓存获取
   * @param {string} key - 缓存键
   * @returns {Object|null}
   * @private
   */
  getFromCache(key) {
    return this.imageCache.get(key) || null
  }

  /**
   * 添加到缓存（LRU）
   * @param {string} key - 缓存键
   * @param {Object} value - 缓存值
   * @private
   */
  addToCache(key, value) {
    // 如果缓存已满，删除最旧的
    if (this.imageCache.size >= this.config.cacheSize) {
      const oldestKey = this.cacheKeys.shift()
      this.imageCache.delete(oldestKey)
    }

    this.imageCache.set(key, value)
    this.cacheKeys.push(key)
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.imageCache.clear()
    this.cacheKeys = []
    console.log('[MultimodalManager] 缓存已清除')
  }

  /**
   * 获取支持的模型列表
   * @returns {Array}
   */
  getSupportedModels() {
    return Object.keys(this.config.supportedModels).map(modelName => ({
      name: modelName,
      ...this.config.supportedModels[modelName]
    }))
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalRequests: this.stats.totalRequests,
      successfulRequests: this.stats.successfulRequests,
      failedRequests: this.stats.failedRequests,
      successRate: this.stats.totalRequests > 0
        ? ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      imagesProcessed: this.stats.imagesProcessed,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      cacheHitRate: (this.stats.cacheHits + this.stats.cacheMisses) > 0
        ? ((this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100).toFixed(2) + '%'
        : '0%',
      cacheSize: this.imageCache.size
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
        console.error('[MultimodalManager] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.clearCache()
    this.isInitialized = false
    console.log('[MultimodalManager] 资源已清理')
  }
}

// 创建单例
let multimodalManagerInstance = null

/**
 * 获取多模态管理器实例
 * @param {Object} config - 配置
 * @returns {MultimodalManager}
 */
export function getMultimodalManager(config) {
  if (!multimodalManagerInstance) {
    multimodalManagerInstance = new MultimodalManager(config)
  }
  return multimodalManagerInstance
}

export default MultimodalManager
