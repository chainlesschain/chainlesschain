/**
 * 对话管理服务 (移动端版本)
 *
 * 功能:
 * - 对话生命周期管理
 * - 消息持久化存储
 * - 上下文管理
 * - 历史记录管理
 * - 多会话管理
 *
 * 对齐桌面端功能
 */

import { db as database } from '../database.js'
import { getLLMManager } from './llm-manager.js'

/**
 * 对话管理器类
 */
class ConversationManager {
  constructor(config = {}) {
    this.config = {
      // 最大上下文窗口大小
      maxContextWindow: config.maxContextWindow || 10,

      // 是否自动保存
      autoSave: config.autoSave !== false,

      // 默认标题
      defaultTitle: config.defaultTitle || '新对话',

      // 上下文策略
      contextStrategy: config.contextStrategy || 'sliding', // sliding | fixed | smart

      // 最大token限制
      maxTokens: config.maxTokens || 2000,

      ...config
    }

    // LLM管理器
    this.llmManager = getLLMManager(config.llm)

    // 活跃对话缓存 (conversationId -> messages)
    this.activeConversations = new Map()

    // 初始化状态
    this.isInitialized = false

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalConversations: 0,
      totalMessages: 0,
      activeConversations: 0
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
      console.log('[ConversationManager] 初始化对话管理器...')

      // 初始化LLM管理器
      await this.llmManager.initialize()

      // 创建必要的数据库表
      await this.initializeDatabase()

      // 加载统计信息
      await this.loadStats()

      this.isInitialized = true

      console.log('[ConversationManager] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[ConversationManager] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 初始化数据库表
   * @returns {Promise<void>}
   * @private
   */
  async initializeDatabase() {
    // 对话表
    await database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        knowledge_id TEXT,
        project_id TEXT,
        context_type TEXT DEFAULT 'global',
        context_data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 消息表
    await database.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `)

    // 创建索引
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)
    `)
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)
    `)
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp ASC)
    `)
  }

  /**
   * 加载统计信息
   * @returns {Promise<void>}
   * @private
   */
  async loadStats() {
    const convResult = await database.exec(
      'SELECT COUNT(*) as count FROM conversations WHERE deleted = 0'
    )
    this.stats.totalConversations = convResult[0]?.count || 0

    const msgResult = await database.exec(
      'SELECT COUNT(*) as count FROM messages'
    )
    this.stats.totalMessages = msgResult[0]?.count || 0

    this.stats.activeConversations = this.activeConversations.size
  }

  /**
   * 创建新对话
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async createConversation(options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      title = this.config.defaultTitle,
      knowledge_id = null,
      project_id = null,
      context_type = 'global',
      context_data = null,
      system_message = null
    } = options

    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
    const now = Date.now()

    try {
      // 保存到数据库
      await database.exec(`
        INSERT INTO conversations (
          id, title, knowledge_id, project_id, context_type, context_data,
          created_at, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [
        id,
        title,
        knowledge_id,
        project_id,
        context_type,
        context_data ? JSON.stringify(context_data) : null,
        now,
        now
      ])

      // 如果有系统消息，添加到对话
      if (system_message) {
        await this.addMessage(id, {
          role: 'system',
          content: system_message
        })
      }

      // 初始化活跃对话缓存
      this.activeConversations.set(id, [])

      this.stats.totalConversations++
      this.stats.activeConversations = this.activeConversations.size

      console.log('[ConversationManager] ✅ 创建对话:', id)

      this.emit('conversation-created', { id, title })

      return {
        success: true,
        id,
        title,
        created_at: now
      }
    } catch (error) {
      console.error('[ConversationManager] 创建对话失败:', error)
      throw error
    }
  }

  /**
   * 获取对话详情
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object|null>}
   */
  async getConversation(conversationId) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      const results = await database.exec(
        'SELECT * FROM conversations WHERE id = ? AND deleted = 0',
        [conversationId]
      )

      if (!results || results.length === 0) {
        return null
      }

      const conversation = results[0]

      // 解析context_data
      if (conversation.context_data) {
        try {
          conversation.context_data = JSON.parse(conversation.context_data)
        } catch (e) {
          console.error('[ConversationManager] 解析context_data失败:', e)
        }
      }

      return conversation
    } catch (error) {
      console.error('[ConversationManager] 获取对话失败:', error)
      throw error
    }
  }

  /**
   * 获取对话列表
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getConversations(options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      project_id = null,
      knowledge_id = null,
      context_type = null,
      limit = 50,
      offset = 0
    } = options

    try {
      let query = 'SELECT * FROM conversations WHERE deleted = 0'
      const params = []

      if (project_id) {
        query += ' AND project_id = ?'
        params.push(project_id)
      }

      if (knowledge_id) {
        query += ' AND knowledge_id = ?'
        params.push(knowledge_id)
      }

      if (context_type) {
        query += ' AND context_type = ?'
        params.push(context_type)
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const results = await database.exec(query, params)

      // 解析context_data
      return results.map(conv => {
        if (conv.context_data) {
          try {
            conv.context_data = JSON.parse(conv.context_data)
          } catch (e) {
            console.error('[ConversationManager] 解析context_data失败:', e)
          }
        }
        return conv
      })
    } catch (error) {
      console.error('[ConversationManager] 获取对话列表失败:', error)
      throw error
    }
  }

  /**
   * 更新对话
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object|null>}
   */
  async updateConversation(conversationId, updates) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const fields = []
    const values = []

    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }

    if (updates.context_type !== undefined) {
      fields.push('context_type = ?')
      values.push(updates.context_type)
    }

    if (updates.context_data !== undefined) {
      fields.push('context_data = ?')
      values.push(JSON.stringify(updates.context_data))
    }

    if (fields.length === 0) {
      return await this.getConversation(conversationId)
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(conversationId)

    try {
      await database.exec(
        `UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`,
        values
      )

      console.log('[ConversationManager] ✅ 更新对话:', conversationId)

      this.emit('conversation-updated', { id: conversationId, updates })

      return await this.getConversation(conversationId)
    } catch (error) {
      console.error('[ConversationManager] 更新对话失败:', error)
      throw error
    }
  }

  /**
   * 删除对话
   * @param {string} conversationId - 对话ID
   * @returns {Promise<boolean>}
   */
  async deleteConversation(conversationId) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      // 软删除
      await database.exec(
        'UPDATE conversations SET deleted = 1, updated_at = ? WHERE id = ?',
        [Date.now(), conversationId]
      )

      // 移除缓存
      this.activeConversations.delete(conversationId)

      this.stats.totalConversations--
      this.stats.activeConversations = this.activeConversations.size

      console.log('[ConversationManager] ✅ 删除对话:', conversationId)

      this.emit('conversation-deleted', { id: conversationId })

      return true
    } catch (error) {
      console.error('[ConversationManager] 删除对话失败:', error)
      throw error
    }
  }

  /**
   * 添加消息
   * @param {string} conversationId - 对话ID
   * @param {Object} messageData - 消息数据
   * @returns {Promise<Object>}
   */
  async addMessage(conversationId, messageData) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const { role, content, tokens = null } = messageData

    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
    const timestamp = Date.now()

    try {
      // 保存到数据库
      await database.exec(`
        INSERT INTO messages (
          id, conversation_id, role, content, timestamp, tokens
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [id, conversationId, role, content, timestamp, tokens])

      // 更新对话的updated_at
      await database.exec(
        'UPDATE conversations SET updated_at = ? WHERE id = ?',
        [timestamp, conversationId]
      )

      // 更新缓存
      if (this.activeConversations.has(conversationId)) {
        const messages = this.activeConversations.get(conversationId)
        messages.push({ id, role, content, timestamp, tokens })

        // 限制缓存大小
        if (messages.length > this.config.maxContextWindow * 2) {
          messages.splice(0, messages.length - this.config.maxContextWindow * 2)
        }
      }

      this.stats.totalMessages++

      console.log('[ConversationManager] ✅ 添加消息:', id)

      this.emit('message-added', { id, conversationId, role })

      return {
        success: true,
        id,
        conversation_id: conversationId,
        role,
        content,
        timestamp,
        tokens
      }
    } catch (error) {
      console.error('[ConversationManager] 添加消息失败:', error)
      throw error
    }
  }

  /**
   * 获取对话的所有消息
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 选项
   * @returns {Promise<Array>}
   */
  async getMessages(conversationId, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const { limit = null, offset = 0 } = options

    try {
      // 先检查缓存
      if (this.activeConversations.has(conversationId) && !limit && !offset) {
        return this.activeConversations.get(conversationId)
      }

      // 从数据库查询
      let query = 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC'
      const params = [conversationId]

      if (limit) {
        query += ' LIMIT ? OFFSET ?'
        params.push(limit, offset)
      }

      const messages = await database.exec(query, params)

      // 更新缓存（如果没有分页）
      if (!limit && !offset) {
        this.activeConversations.set(conversationId, messages)
      }

      return messages
    } catch (error) {
      console.error('[ConversationManager] 获取消息失败:', error)
      throw error
    }
  }

  /**
   * 清空对话消息
   * @param {string} conversationId - 对话ID
   * @returns {Promise<boolean>}
   */
  async clearMessages(conversationId) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      await database.exec(
        'DELETE FROM messages WHERE conversation_id = ?',
        [conversationId]
      )

      // 清除缓存
      if (this.activeConversations.has(conversationId)) {
        this.activeConversations.set(conversationId, [])
      }

      console.log('[ConversationManager] ✅ 清空消息:', conversationId)

      this.emit('messages-cleared', { id: conversationId })

      return true
    } catch (error) {
      console.error('[ConversationManager] 清空消息失败:', error)
      throw error
    }
  }

  /**
   * 发送消息并获取AI回复
   * @param {string} conversationId - 对话ID
   * @param {string} userMessage - 用户消息
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async sendMessage(conversationId, userMessage, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      console.log('[ConversationManager] 发送消息:', conversationId)

      this.emit('message-sending', { conversationId, userMessage })

      // 1. 保存用户消息
      await this.addMessage(conversationId, {
        role: 'user',
        content: userMessage
      })

      // 2. 获取上下文消息
      const contextMessages = await this.getContextMessages(conversationId, options)

      // 3. 调用LLM
      const response = await this.llmManager.chat(contextMessages, options)

      // 4. 保存AI回复
      await this.addMessage(conversationId, {
        role: 'assistant',
        content: response.content,
        tokens: response.usage?.total_tokens || null
      })

      console.log('[ConversationManager] ✅ 消息完成')

      this.emit('message-complete', {
        conversationId,
        userMessage,
        assistantMessage: response.content
      })

      return {
        success: true,
        conversationId,
        userMessage,
        assistantMessage: response.content,
        usage: response.usage,
        model: response.model,
        mode: response.mode
      }
    } catch (error) {
      console.error('[ConversationManager] 发送消息失败:', error)

      this.emit('message-error', { conversationId, error })

      throw error
    }
  }

  /**
   * 流式发送消息并获取AI回复
   * @param {string} conversationId - 对话ID
   * @param {string} userMessage - 用户消息
   * @param {Object} options - 选项
   * @param {Function} options.onStart - 开始回调
   * @param {Function} options.onChunk - 数据块回调 (chunk, buffer)
   * @param {Function} options.onComplete - 完成回调
   * @param {Function} options.onError - 错误回调
   * @returns {Promise<Object>}
   */
  async sendMessageStream(conversationId, userMessage, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      console.log('[ConversationManager] 流式发送消息:', conversationId)

      this.emit('message-stream-start', { conversationId, userMessage })

      // 1. 保存用户消息
      await this.addMessage(conversationId, {
        role: 'user',
        content: userMessage
      })

      // 2. 获取上下文消息
      const contextMessages = await this.getContextMessages(conversationId, options)

      // 3. 流式调用LLM
      let assistantMessage = ''

      const response = await this.llmManager.chatStream(contextMessages, {
        ...options,
        onStart: (data) => {
          if (options.onStart) {
            options.onStart(data)
          }
        },
        onChunk: (data) => {
          assistantMessage = data.buffer || data.content

          if (options.onChunk) {
            options.onChunk({
              chunk: data.content,
              buffer: assistantMessage,
              progress: data.progress
            })
          }

          this.emit('message-stream-chunk', {
            conversationId,
            chunk: data.content,
            buffer: assistantMessage
          })
        },
        onComplete: (data) => {
          if (options.onComplete) {
            options.onComplete(data)
          }
        },
        onError: (error) => {
          if (options.onError) {
            options.onError(error)
          }
        }
      })

      // 4. 保存AI回复
      await this.addMessage(conversationId, {
        role: 'assistant',
        content: response.content || assistantMessage,
        tokens: response.usage?.total_tokens || null
      })

      console.log('[ConversationManager] ✅ 流式消息完成')

      this.emit('message-stream-complete', {
        conversationId,
        userMessage,
        assistantMessage: response.content || assistantMessage
      })

      return {
        success: true,
        conversationId,
        userMessage,
        assistantMessage: response.content || assistantMessage,
        usage: response.usage,
        sessionId: response.sessionId
      }
    } catch (error) {
      console.error('[ConversationManager] 流式发送消息失败:', error)

      this.emit('message-stream-error', { conversationId, error })

      throw error
    }
  }

  /**
   * 获取上下文消息
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 选项
   * @returns {Promise<Array>}
   * @private
   */
  async getContextMessages(conversationId, options = {}) {
    const strategy = options.contextStrategy || this.config.contextStrategy
    const maxWindow = options.maxContextWindow || this.config.maxContextWindow

    // 获取所有消息
    const allMessages = await this.getMessages(conversationId)

    let contextMessages = []

    switch (strategy) {
      case 'sliding':
        // 滑动窗口：取最近N条消息
        contextMessages = allMessages.slice(-maxWindow)
        break

      case 'fixed':
        // 固定窗口：系统消息 + 最近N条
        const systemMessages = allMessages.filter(m => m.role === 'system')
        const recentMessages = allMessages.filter(m => m.role !== 'system').slice(-maxWindow)
        contextMessages = [...systemMessages, ...recentMessages]
        break

      case 'smart':
        // 智能选择：系统消息 + 重要消息 + 最近消息
        // TODO: 实现智能选择算法（基于相关性、重要性等）
        contextMessages = allMessages.slice(-maxWindow)
        break

      default:
        contextMessages = allMessages.slice(-maxWindow)
    }

    // 转换为LLM格式
    return contextMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  }

  /**
   * 生成对话标题
   * @param {string} conversationId - 对话ID
   * @returns {Promise<string>}
   */
  async generateTitle(conversationId) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      // 获取对话的前几条消息
      const messages = await this.getMessages(conversationId, { limit: 5 })

      if (messages.length === 0) {
        return this.config.defaultTitle
      }

      // 使用第一条用户消息作为标题
      const firstUserMessage = messages.find(m => m.role === 'user')
      if (firstUserMessage) {
        // 截取前30个字符作为标题
        let title = firstUserMessage.content.trim()
        if (title.length > 30) {
          title = title.substring(0, 30) + '...'
        }
        return title
      }

      return this.config.defaultTitle
    } catch (error) {
      console.error('[ConversationManager] 生成标题失败:', error)
      return this.config.defaultTitle
    }
  }

  /**
   * 自动生成并更新对话标题
   * @param {string} conversationId - 对话ID
   * @returns {Promise<string>}
   */
  async autoGenerateTitle(conversationId) {
    const title = await this.generateTitle(conversationId)
    await this.updateConversation(conversationId, { title })
    return title
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalConversations: this.stats.totalConversations,
      totalMessages: this.stats.totalMessages,
      activeConversations: this.stats.activeConversations,
      llmStats: this.llmManager.getStats()
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
        console.error('[ConversationManager] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.activeConversations.clear()
    await this.llmManager.terminate()
    this.isInitialized = false
    console.log('[ConversationManager] 资源已清理')
  }
}

// 创建单例
let conversationManagerInstance = null

/**
 * 获取对话管理器实例
 * @param {Object} config - 配置
 * @returns {ConversationManager}
 */
export function getConversationManager(config) {
  if (!conversationManagerInstance) {
    conversationManagerInstance = new ConversationManager(config)
  }
  return conversationManagerInstance
}

export default ConversationManager
