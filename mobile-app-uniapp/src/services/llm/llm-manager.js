/**
 * LLM服务管理器 (移动端版本)
 *
 * 支持模式:
 * - webllm: Web LLM (H5环境，基于WebGPU)
 * - api: 后端LLM API
 * - openai: OpenAI API
 * - anthropic: Anthropic (Claude) API
 *
 * 功能对齐桌面端
 */

import { getStreamManager } from './stream-manager.js'

/**
 * LLM管理器类
 */
class LLMManager {
  constructor(config = {}) {
    this.config = {
      // LLM模式
      mode: config.mode || 'auto',  // auto | webllm | api | openai | anthropic

      // Web LLM配置 (仅H5)
      webllmModel: config.webllmModel || 'Llama-3-8B-Instruct-q4f32_1',

      // API配置
      apiEndpoint: config.apiEndpoint || 'http://localhost:8000/api/chat',

      // OpenAI配置
      openaiApiKey: config.openaiApiKey || '',
      openaiModel: config.openaiModel || 'gpt-3.5-turbo',
      openaiBaseURL: config.openaiBaseURL || 'https://api.openai.com/v1',

      // Anthropic配置
      anthropicApiKey: config.anthropicApiKey || '',
      anthropicModel: config.anthropicModel || 'claude-3-5-sonnet-20241022',

      // 通用配置
      maxTokens: config.maxTokens || 2000,
      temperature: config.temperature || 0.7,
      timeout: config.timeout || 30000,

      ...config
    }

    // 当前使用的模式
    this.currentMode = null

    // Web LLM引擎 (仅H5)
    this.webllmEngine = null

    // 流式输出管理器
    this.streamManager = getStreamManager(config.stream)

    // 初始化状态
    this.isInitialized = false

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalRequests: 0,
      successCount: 0,
      failCount: 0,
      streamRequests: 0
    }
  }

  /**
   * 初始化LLM服务
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true, mode: this.currentMode }
    }

    try {
      console.log('[LLMManager] 初始化LLM服务...')
      this.emit('initialize-start')

      // 自动检测最佳模式
      if (this.config.mode === 'auto') {
        this.currentMode = await this.detectBestMode()
      } else {
        this.currentMode = this.config.mode
      }

      console.log('[LLMManager] 使用模式:', this.currentMode)

      // 根据模式初始化
      if (this.currentMode === 'webllm') {
        await this.initializeWebLLM()
      }

      this.isInitialized = true

      console.log('[LLMManager] ✅ LLM服务初始化成功')
      this.emit('initialize-complete', { mode: this.currentMode })

      return {
        success: true,
        mode: this.currentMode
      }
    } catch (error) {
      console.error('[LLMManager] 初始化失败:', error)
      this.isInitialized = false
      this.emit('initialize-error', error)

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 检测最佳LLM模式
   * @returns {Promise<string>}
   * @private
   */
  async detectBestMode() {
    // #ifdef H5
    // H5环境检测WebGPU支持
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        console.log('[LLMManager] 检测到WebGPU支持，使用Web LLM')
        return 'webllm'
      }
    } catch (e) {}
    // #endif

    // 检测OpenAI API
    if (this.config.openaiApiKey) {
      console.log('[LLMManager] 使用OpenAI API')
      return 'openai'
    }

    // 检测Anthropic API
    if (this.config.anthropicApiKey) {
      console.log('[LLMManager] 使用Anthropic API')
      return 'anthropic'
    }

    // 检测后端API
    if (this.config.apiEndpoint) {
      try {
        const response = await uni.request({
          url: this.config.apiEndpoint + '/health',
          method: 'GET',
          timeout: 3000
        })

        if (response.statusCode === 200) {
          console.log('[LLMManager] 使用后端API')
          return 'api'
        }
      } catch (e) {}
    }

    // 默认使用API模式
    return 'api'
  }

  /**
   * 初始化Web LLM (仅H5)
   * @returns {Promise<void>}
   * @private
   */
  async initializeWebLLM() {
    // #ifdef H5
    try {
      console.log('[LLMManager] 初始化Web LLM引擎...')

      if (!window.webllm) {
        throw new Error('Web LLM库未加载')
      }

      // 创建引擎
      this.webllmEngine = await window.webllm.CreateMLCEngine(
        this.config.webllmModel,
        {
          initProgressCallback: (progress) => {
            this.emit('model-loading', {
              progress: progress.progress || 0,
              text: progress.text || ''
            })
            console.log('[LLMManager] 模型加载:', progress.text)
          }
        }
      )

      console.log('[LLMManager] Web LLM引擎初始化成功')
    } catch (error) {
      console.error('[LLMManager] Web LLM初始化失败:', error)
      throw error
    }
    // #endif

    // #ifndef H5
    throw new Error('Web LLM仅在H5环境可用')
    // #endif
  }

  /**
   * 聊天补全
   * @param {Array} messages - 消息列表 [{role: 'user|assistant|system', content: 'text'}]
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async chat(messages, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    this.stats.totalRequests++

    try {
      console.log('[LLMManager] 开始聊天，消息数:', messages.length)
      this.emit('chat-start', { messages })

      let response

      switch (this.currentMode) {
        case 'webllm':
          response = await this.chatWithWebLLM(messages, options)
          break

        case 'api':
          response = await this.chatWithAPI(messages, options)
          break

        case 'openai':
          response = await this.chatWithOpenAI(messages, options)
          break

        case 'anthropic':
          response = await this.chatWithAnthropic(messages, options)
          break

        default:
          throw new Error(`未知的LLM模式: ${this.currentMode}`)
      }

      this.stats.successCount++

      console.log('[LLMManager] ✅ 聊天完成')
      this.emit('chat-complete', response)

      return response
    } catch (error) {
      this.stats.failCount++

      console.error('[LLMManager] 聊天失败:', error)
      this.emit('chat-error', { messages, error })

      throw error
    }
  }

  /**
   * 使用Web LLM聊天 (H5)
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithWebLLM(messages, options) {
    // #ifdef H5
    if (!this.webllmEngine) {
      throw new Error('Web LLM引擎未初始化')
    }

    const response = await this.webllmEngine.chat.completions.create({
      messages,
      temperature: options.temperature || this.config.temperature,
      max_tokens: options.maxTokens || this.config.maxTokens
    })

    return {
      content: response.choices[0].message.content,
      model: this.config.webllmModel,
      usage: response.usage,
      mode: 'webllm'
    }
    // #endif

    // #ifndef H5
    throw new Error('Web LLM仅在H5环境可用')
    // #endif
  }

  /**
   * 使用后端API聊天
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithAPI(messages, options) {
    const response = await uni.request({
      url: this.config.apiEndpoint,
      method: 'POST',
      data: {
        messages,
        temperature: options.temperature || this.config.temperature,
        max_tokens: options.maxTokens || this.config.maxTokens
      },
      timeout: this.config.timeout
    })

    if (response.statusCode !== 200) {
      throw new Error(`API请求失败: ${response.statusCode}`)
    }

    const data = response.data

    return {
      content: data.content || data.message || '',
      model: data.model || 'unknown',
      usage: data.usage || {},
      mode: 'api'
    }
  }

  /**
   * 使用OpenAI API聊天
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithOpenAI(messages, options) {
    const response = await uni.request({
      url: `${this.config.openaiBaseURL}/chat/completions`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.openaiApiKey}`
      },
      data: {
        model: this.config.openaiModel,
        messages,
        temperature: options.temperature || this.config.temperature,
        max_tokens: options.maxTokens || this.config.maxTokens
      },
      timeout: this.config.timeout
    })

    if (response.statusCode !== 200) {
      throw new Error(`OpenAI API请求失败: ${response.statusCode}`)
    }

    const data = response.data

    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: data.usage,
      mode: 'openai'
    }
  }

  /**
   * 使用Anthropic API聊天
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>}
   * @private
   */
  async chatWithAnthropic(messages, options) {
    // 转换消息格式（Anthropic API格式不同）
    const systemMessage = messages.find(m => m.role === 'system')
    const chatMessages = messages.filter(m => m.role !== 'system')

    const response = await uni.request({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      data: {
        model: this.config.anthropicModel,
        messages: chatMessages,
        system: systemMessage?.content || undefined,
        max_tokens: options.maxTokens || this.config.maxTokens,
        temperature: options.temperature || this.config.temperature
      },
      timeout: this.config.timeout
    })

    if (response.statusCode !== 200) {
      throw new Error(`Anthropic API请求失败: ${response.statusCode}`)
    }

    const data = response.data

    return {
      content: data.content[0].text,
      model: data.model,
      usage: data.usage,
      mode: 'anthropic'
    }
  }

  /**
   * 流式聊天
   * @param {Array} messages - 消息列表
   * @param {Object} options - 选项
   * @param {Function} options.onStart - 开始回调
   * @param {Function} options.onChunk - 数据块回调
   * @param {Function} options.onComplete - 完成回调
   * @param {Function} options.onError - 错误回调
   * @returns {Promise<Object>}
   */
  async chatStream(messages, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    this.stats.totalRequests++
    this.stats.streamRequests++

    try {
      console.log('[LLMManager] 开始流式聊天，消息数:', messages.length)
      this.emit('chat-stream-start', { messages })

      let response

      switch (this.currentMode) {
        case 'webllm':
          // Web LLM暂不支持流式（TODO）
          console.warn('[LLMManager] Web LLM暂不支持流式，使用模拟')
          response = await this.chatStreamSimulated(messages, options)
          break

        case 'api':
          // 后端API使用WebSocket流式
          response = await this.chatStreamWithAPI(messages, options)
          break

        case 'openai':
          response = await this.streamManager.streamWithOpenAI(messages, {
            apiKey: this.config.openaiApiKey,
            model: this.config.openaiModel,
            baseURL: this.config.openaiBaseURL,
            maxTokens: options.maxTokens || this.config.maxTokens,
            temperature: options.temperature || this.config.temperature,
            ...options
          })
          break

        case 'anthropic':
          response = await this.streamManager.streamWithAnthropic(messages, {
            apiKey: this.config.anthropicApiKey,
            model: this.config.anthropicModel,
            maxTokens: options.maxTokens || this.config.maxTokens,
            temperature: options.temperature || this.config.temperature,
            ...options
          })
          break

        default:
          throw new Error(`未知的LLM模式: ${this.currentMode}`)
      }

      this.stats.successCount++

      console.log('[LLMManager] ✅ 流式聊天完成')
      this.emit('chat-stream-complete', response)

      return response
    } catch (error) {
      this.stats.failCount++

      console.error('[LLMManager] 流式聊天失败:', error)
      this.emit('chat-stream-error', { messages, error })

      throw error
    }
  }

  /**
   * 后端API流式聊天
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>}
   * @private
   */
  async chatStreamWithAPI(messages, options) {
    // 使用WebSocket流式传输
    return await this.streamManager.streamWithWebSocket(messages, {
      ...options,
      temperature: options.temperature || this.config.temperature,
      maxTokens: options.maxTokens || this.config.maxTokens
    })
  }

  /**
   * 模拟流式聊天（用于不支持流式的LLM）
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>}
   * @private
   */
  async chatStreamSimulated(messages, options) {
    // 先获取完整响应
    const response = await this.chat(messages, options)

    // 创建流式会话
    const sessionId = this.streamManager.createSession({ mode: 'simulated' })

    // 模拟流式输出
    await this.streamManager.simulateStream(sessionId, response.content, {
      onStart: options.onStart,
      onChunk: options.onChunk,
      onComplete: options.onComplete
    })

    return {
      ...response,
      sessionId,
      mode: this.currentMode
    }
  }

  /**
   * 获取可用模型列表
   * @returns {Promise<Array>}
   */
  async getModels() {
    const models = []

    // Web LLM模型
    // #ifdef H5
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      models.push(
        { id: 'Llama-3-8B-Instruct-q4f32_1', name: 'Llama 3 8B', mode: 'webllm' },
        { id: 'Phi-3-mini-4k-instruct-q4f16_1', name: 'Phi 3 Mini', mode: 'webllm' },
        { id: 'TinyLlama-1.1B-Chat-v1.0-q4f16_1', name: 'TinyLlama 1.1B', mode: 'webllm' }
      )
    }
    // #endif

    // OpenAI模型
    if (this.config.openaiApiKey) {
      models.push(
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', mode: 'openai' },
        { id: 'gpt-4', name: 'GPT-4', mode: 'openai' }
      )
    }

    // Anthropic模型
    if (this.config.anthropicApiKey) {
      models.push(
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', mode: 'anthropic' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', mode: 'anthropic' }
      )
    }

    return models
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      mode: this.currentMode,
      totalRequests: this.stats.totalRequests,
      successCount: this.stats.successCount,
      failCount: this.stats.failCount,
      successRate: this.stats.totalRequests > 0
        ? ((this.stats.successCount / this.stats.totalRequests) * 100).toFixed(2) + '%'
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
        console.error('[LLMManager] 事件回调失败:', error)
      }
    }
  }

  /**
   * 终止LLM服务
   * @returns {Promise<void>}
   */
  async terminate() {
    // #ifdef H5
    if (this.webllmEngine) {
      // Web LLM可能没有terminate方法
      this.webllmEngine = null
    }
    // #endif

    this.isInitialized = false
    console.log('[LLMManager] LLM服务已终止')
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

    console.log('[LLMManager] 配置已更新')
  }
}

// 创建单例
let llmManagerInstance = null

/**
 * 获取LLM管理器实例
 * @param {Object} config - 配置
 * @returns {LLMManager}
 */
export function getLLMManager(config) {
  if (!llmManagerInstance) {
    llmManagerInstance = new LLMManager(config)
  }
  return llmManagerInstance
}

export default LLMManager
