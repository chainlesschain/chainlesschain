/**
 * LLM流式输出管理器 (移动端版本)
 *
 * 功能:
 * - WebSocket流式传输
 * - 模拟流式输出（分段返回）
 * - 流式解析和处理
 * - 实时进度回调
 *
 * 解决uni-app不支持SSE的问题
 */

/**
 * 流式输出管理器类
 */
class StreamManager {
  constructor(config = {}) {
    this.config = {
      // WebSocket端点
      wsEndpoint: config.wsEndpoint || 'ws://localhost:8000/ws/chat',

      // 模拟流式的分段大小（字符数）
      chunkSize: config.chunkSize || 10,

      // 模拟流式的延迟（ms）
      chunkDelay: config.chunkDelay || 50,

      // 是否启用WebSocket
      enableWebSocket: config.enableWebSocket !== false,

      // 超时时间
      timeout: config.timeout || 60000,

      ...config
    }

    // WebSocket连接池
    this.wsConnections = new Map()

    // 流式会话
    this.activeSessions = new Map()

    // 初始化状态
    this.isInitialized = false

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalStreams: 0,
      activeStreams: 0,
      errors: 0
    }
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
      console.log('[StreamManager] 初始化流式输出管理器...')

      this.isInitialized = true

      console.log('[StreamManager] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[StreamManager] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 创建流式会话
   * @param {Object} options - 选项
   * @returns {string} 会话ID
   */
  createSession(options = {}) {
    const sessionId = 'stream_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)

    this.activeSessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      buffer: '',
      completed: false,
      error: null,
      ...options
    })

    this.stats.totalStreams++
    this.stats.activeStreams++

    return sessionId
  }

  /**
   * WebSocket流式传输
   * @param {Array} messages - 消息列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async streamWithWebSocket(messages, options = {}) {
    if (!this.config.enableWebSocket) {
      throw new Error('WebSocket未启用')
    }

    const sessionId = this.createSession({ mode: 'websocket' })

    return new Promise((resolve, reject) => {
      const {
        onStart = () => {},
        onChunk = () => {},
        onComplete = () => {},
        onError = () => {}
      } = options

      try {
        // 创建WebSocket连接
        const ws = uni.connectSocket({
          url: this.config.wsEndpoint,
          success: () => {
            console.log('[StreamManager] WebSocket连接成功')
          },
          fail: (error) => {
            console.error('[StreamManager] WebSocket连接失败:', error)
            this.handleError(sessionId, error)
            onError(error)
            reject(error)
          }
        })

        // 监听打开
        ws.onOpen(() => {
          console.log('[StreamManager] WebSocket已打开')

          // 发送消息
          ws.send({
            data: JSON.stringify({
              messages,
              stream: true,
              ...options
            }),
            success: () => {
              console.log('[StreamManager] 消息已发送')
              onStart({ sessionId })
            },
            fail: (error) => {
              console.error('[StreamManager] 发送失败:', error)
              onError(error)
              reject(error)
            }
          })
        })

        // 监听消息
        ws.onMessage((event) => {
          try {
            const data = JSON.parse(event.data)

            if (data.type === 'chunk') {
              // 流式数据块
              const session = this.activeSessions.get(sessionId)
              if (session) {
                session.buffer += data.content
                onChunk({
                  sessionId,
                  content: data.content,
                  buffer: session.buffer
                })
              }
            } else if (data.type === 'done') {
              // 完成
              const session = this.activeSessions.get(sessionId)
              if (session) {
                session.completed = true
                this.stats.activeStreams--

                onComplete({
                  sessionId,
                  content: session.buffer,
                  usage: data.usage
                })

                resolve({
                  success: true,
                  sessionId,
                  content: session.buffer,
                  usage: data.usage
                })
              }

              // 关闭连接
              ws.close()
            } else if (data.type === 'error') {
              // 错误
              this.handleError(sessionId, new Error(data.message))
              onError(new Error(data.message))
              reject(new Error(data.message))

              // 关闭连接
              ws.close()
            }
          } catch (error) {
            console.error('[StreamManager] 解析消息失败:', error)
          }
        })

        // 监听错误
        ws.onError((error) => {
          console.error('[StreamManager] WebSocket错误:', error)
          this.handleError(sessionId, error)
          onError(error)
          reject(error)
        })

        // 监听关闭
        ws.onClose(() => {
          console.log('[StreamManager] WebSocket已关闭')
          this.wsConnections.delete(sessionId)
        })

        // 保存连接
        this.wsConnections.set(sessionId, ws)

        // 设置超时
        setTimeout(() => {
          const session = this.activeSessions.get(sessionId)
          if (session && !session.completed) {
            const error = new Error('流式传输超时')
            this.handleError(sessionId, error)
            onError(error)
            reject(error)
            ws.close()
          }
        }, this.config.timeout)
      } catch (error) {
        console.error('[StreamManager] WebSocket流式传输失败:', error)
        this.handleError(sessionId, error)
        onError(error)
        reject(error)
      }
    })
  }

  /**
   * OpenAI流式传输 (SSE)
   * @param {Array} messages - 消息列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async streamWithOpenAI(messages, options = {}) {
    const sessionId = this.createSession({ mode: 'openai' })

    return new Promise((resolve, reject) => {
      const {
        apiKey,
        model = 'gpt-3.5-turbo',
        baseURL = 'https://api.openai.com/v1',
        onStart = () => {},
        onChunk = () => {},
        onComplete = () => {},
        onError = () => {}
      } = options

      try {
        // uni.request不支持SSE，使用轮询模拟
        // 实际应该使用WebSocket代理或chunked transfer encoding
        console.warn('[StreamManager] uni.request不支持SSE，使用模拟流式输出')

        // 先调用非流式API
        uni.request({
          url: `${baseURL}/chat/completions`,
          method: 'POST',
          header: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          data: {
            model,
            messages,
            stream: false // 改为非流式
          },
          success: async (res) => {
            if (res.statusCode === 200) {
              const content = res.data.choices[0].message.content

              // 模拟流式输出
              await this.simulateStream(sessionId, content, {
                onStart,
                onChunk,
                onComplete
              })

              resolve({
                success: true,
                sessionId,
                content,
                usage: res.data.usage
              })
            } else {
              const error = new Error(`OpenAI API错误: ${res.statusCode}`)
              this.handleError(sessionId, error)
              onError(error)
              reject(error)
            }
          },
          fail: (error) => {
            console.error('[StreamManager] OpenAI API调用失败:', error)
            this.handleError(sessionId, error)
            onError(error)
            reject(error)
          }
        })
      } catch (error) {
        console.error('[StreamManager] OpenAI流式传输失败:', error)
        this.handleError(sessionId, error)
        onError(error)
        reject(error)
      }
    })
  }

  /**
   * Anthropic流式传输
   * @param {Array} messages - 消息列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async streamWithAnthropic(messages, options = {}) {
    const sessionId = this.createSession({ mode: 'anthropic' })

    return new Promise((resolve, reject) => {
      const {
        apiKey,
        model = 'claude-3-5-sonnet-20241022',
        onStart = () => {},
        onChunk = () => {},
        onComplete = () => {},
        onError = () => {}
      } = options

      try {
        // Anthropic也不支持uni.request的SSE，使用模拟
        console.warn('[StreamManager] 使用模拟流式输出')

        const systemMessage = messages.find(m => m.role === 'system')
        const chatMessages = messages.filter(m => m.role !== 'system')

        uni.request({
          url: 'https://api.anthropic.com/v1/messages',
          method: 'POST',
          header: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          data: {
            model,
            messages: chatMessages,
            system: systemMessage?.content,
            max_tokens: options.maxTokens || 2000,
            stream: false // 改为非流式
          },
          success: async (res) => {
            if (res.statusCode === 200) {
              const content = res.data.content[0].text

              // 模拟流式输出
              await this.simulateStream(sessionId, content, {
                onStart,
                onChunk,
                onComplete
              })

              resolve({
                success: true,
                sessionId,
                content,
                usage: res.data.usage
              })
            } else {
              const error = new Error(`Anthropic API错误: ${res.statusCode}`)
              this.handleError(sessionId, error)
              onError(error)
              reject(error)
            }
          },
          fail: (error) => {
            console.error('[StreamManager] Anthropic API调用失败:', error)
            this.handleError(sessionId, error)
            onError(error)
            reject(error)
          }
        })
      } catch (error) {
        console.error('[StreamManager] Anthropic流式传输失败:', error)
        this.handleError(sessionId, error)
        onError(error)
        reject(error)
      }
    })
  }

  /**
   * 模拟流式输出
   * @param {string} sessionId - 会话ID
   * @param {string} content - 完整内容
   * @param {Object} callbacks - 回调函数
   * @returns {Promise<void>}
   * @private
   */
  async simulateStream(sessionId, content, callbacks = {}) {
    const {
      onStart = () => {},
      onChunk = () => {},
      onComplete = () => {}
    } = callbacks

    const session = this.activeSessions.get(sessionId)
    if (!session) return

    onStart({ sessionId })

    // 分段发送
    const chunks = this.splitIntoChunks(content, this.config.chunkSize)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]

      // 延迟发送
      await this.delay(this.config.chunkDelay)

      // 更新缓冲区
      session.buffer += chunk

      // 触发回调
      onChunk({
        sessionId,
        content: chunk,
        buffer: session.buffer,
        progress: ((i + 1) / chunks.length * 100).toFixed(2)
      })
    }

    // 完成
    session.completed = true
    this.stats.activeStreams--

    onComplete({
      sessionId,
      content: session.buffer
    })
  }

  /**
   * 分割文本为块
   * @param {string} text - 文本
   * @param {number} chunkSize - 块大小
   * @returns {Array<string>}
   * @private
   */
  splitIntoChunks(text, chunkSize) {
    const chunks = []
    let i = 0

    while (i < text.length) {
      // 尝试在单词边界分割
      let end = Math.min(i + chunkSize, text.length)

      if (end < text.length) {
        // 查找最近的空格或标点
        const subText = text.substring(i, end + 10)
        const match = subText.match(/[\s,，.。!！?？;；:：\n]/)

        if (match && match.index > 0) {
          end = i + match.index + 1
        }
      }

      chunks.push(text.substring(i, end))
      i = end
    }

    return chunks
  }

  /**
   * 延迟
   * @param {number} ms - 毫秒
   * @returns {Promise<void>}
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 处理错误
   * @param {string} sessionId - 会话ID
   * @param {Error} error - 错误对象
   * @private
   */
  handleError(sessionId, error) {
    const session = this.activeSessions.get(sessionId)
    if (session) {
      session.error = error
      session.completed = true
      this.stats.activeStreams--
    }

    this.stats.errors++

    console.error('[StreamManager] 会话错误:', sessionId, error)

    this.emit('error', { sessionId, error })
  }

  /**
   * 取消流式会话
   * @param {string} sessionId - 会话ID
   * @returns {boolean}
   */
  cancelSession(sessionId) {
    const session = this.activeSessions.get(sessionId)
    if (!session) return false

    // 关闭WebSocket连接
    const ws = this.wsConnections.get(sessionId)
    if (ws) {
      ws.close()
      this.wsConnections.delete(sessionId)
    }

    // 标记为已完成
    session.completed = true
    session.error = new Error('用户取消')
    this.stats.activeStreams--

    console.log('[StreamManager] 会话已取消:', sessionId)

    return true
  }

  /**
   * 获取会话信息
   * @param {string} sessionId - 会话ID
   * @returns {Object|null}
   */
  getSession(sessionId) {
    return this.activeSessions.get(sessionId) || null
  }

  /**
   * 清理已完成的会话
   * @param {number} maxAge - 最大保留时间（ms）
   */
  cleanupSessions(maxAge = 3600000) {
    const now = Date.now()

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.completed && (now - session.createdAt > maxAge)) {
        this.activeSessions.delete(sessionId)
      }
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalStreams: this.stats.totalStreams,
      activeStreams: this.stats.activeStreams,
      errors: this.stats.errors,
      activeSessions: this.activeSessions.size,
      wsConnections: this.wsConnections.size
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
        console.error('[StreamManager] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 关闭所有WebSocket连接
    for (const ws of this.wsConnections.values()) {
      ws.close()
    }

    this.wsConnections.clear()
    this.activeSessions.clear()
    this.isInitialized = false

    console.log('[StreamManager] 资源已清理')
  }
}

// 创建单例
let streamManagerInstance = null

/**
 * 获取流式输出管理器实例
 * @param {Object} config - 配置
 * @returns {StreamManager}
 */
export function getStreamManager(config) {
  if (!streamManagerInstance) {
    streamManagerInstance = new StreamManager(config)
  }
  return streamManagerInstance
}

export default StreamManager
