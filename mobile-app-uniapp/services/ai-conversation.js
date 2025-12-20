/**
 * AI对话服务
 *
 * 功能：
 * - AI对话会话管理
 * - 多轮对话上下文
 * - 对话历史存储
 * - 会话导出/导入
 */

import database from './database'
import { llm } from './llm'
import didService from './did'

class AIConversationService {
  constructor() {
    this.currentConversation = null
    this.conversations = []
  }

  /**
   * 初始化对话服务
   */
  async init() {
    try {
      // 确保数据库已初始化
      if (!database.isOpen) {
        await database.initWithoutPin()
      }

      await this.loadConversations()
      console.log('AI对话服务初始化完成')
    } catch (error) {
      console.error('AI对话服务初始化失败:', error)
    }
  }

  /**
   * 创建新对话
   * @param {Object} options - 对话配置
   * @returns {Promise<Object>}
   */
  async createConversation(options = {}) {
    try {
      const {
        title = '新对话',
        systemPrompt = '你是一个helpful的AI助手，能够帮助用户解答问题、提供建议和完成各种任务。',
        model = llm.config[llm.provider].model,
        temperature = 0.7
      } = options

      // 获取当前用户身份（可选）
      let userDid = null
      try {
        const identity = await didService.getCurrentIdentity()
        userDid = identity?.did
      } catch (e) {
        // 未登录时userDid为null
      }

      const conversation = {
        id: `ai_conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title,
        systemPrompt,
        model,
        temperature,
        userDid,
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: null
      }

      // 保存到数据库
      await database.saveAIConversation(conversation)

      // 设置为当前对话
      this.currentConversation = conversation

      // 重新加载对话列表
      await this.loadConversations()

      return conversation
    } catch (error) {
      console.error('创建对话失败:', error)
      throw error
    }
  }

  /**
   * 发送消息
   * @param {string} conversationId - 对话ID
   * @param {string} message - 用户消息
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async sendMessage(conversationId, message, options = {}) {
    try {
      // 获取对话信息
      const conversation = await database.getAIConversation(conversationId)
      if (!conversation) {
        throw new Error('对话不存在')
      }

      // 保存用户消息
      const userMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationId,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString()
      }
      await database.saveAIMessage(userMessage)

      // 获取对话历史（用于上下文）
      const history = await this.getConversationHistory(conversationId, 10)

      // 构建消息上下文
      const context = history.map(m => ({
        role: m.role,
        content: m.content
      }))

      // 调用LLM
      const {
        onChunk = null,
        stream = false
      } = options

      let aiResponse
      if (stream && onChunk) {
        // 流式响应（如果支持）
        aiResponse = await llm.queryStream(message, context, onChunk, {
          temperature: conversation.temperature
        })
      } else {
        // 普通响应
        aiResponse = await llm.query(message, context, {
          temperature: conversation.temperature
        })
      }

      // 保存AI回复
      const assistantMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationId,
        role: 'assistant',
        content: aiResponse.content,
        model: aiResponse.model,
        tokens: aiResponse.tokens,
        createdAt: new Date().toISOString()
      }
      await database.saveAIMessage(assistantMessage)

      // 更新对话信息
      await database.updateAIConversation(conversationId, {
        messageCount: conversation.messageCount + 2,
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })

      // 重新加载对话列表
      await this.loadConversations()

      return {
        userMessage,
        assistantMessage
      }
    } catch (error) {
      console.error('发送消息失败:', error)
      throw error
    }
  }

  /**
   * 获取对话历史
   * @param {string} conversationId - 对话ID
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}
   */
  async getConversationHistory(conversationId, limit = 50) {
    try {
      const messages = await database.getAIMessages(conversationId, { limit })
      return messages
    } catch (error) {
      console.error('获取对话历史失败:', error)
      return []
    }
  }

  /**
   * 获取对话列表
   * @returns {Promise<Array>}
   */
  async getConversations() {
    try {
      await this.loadConversations()
      return [...this.conversations]
    } catch (error) {
      console.error('获取对话列表失败:', error)
      return []
    }
  }

  /**
   * 删除对话
   * @param {string} conversationId - 对话ID
   * @returns {Promise<void>}
   */
  async deleteConversation(conversationId) {
    try {
      // 删除对话和相关消息
      await database.deleteAIConversation(conversationId)

      // 如果是当前对话，清空
      if (this.currentConversation?.id === conversationId) {
        this.currentConversation = null
      }

      // 重新加载对话列表
      await this.loadConversations()
    } catch (error) {
      console.error('删除对话失败:', error)
      throw error
    }
  }

  /**
   * 更新对话标题
   * @param {string} conversationId - 对话ID
   * @param {string} title - 新标题
   * @returns {Promise<void>}
   */
  async updateConversationTitle(conversationId, title) {
    try {
      await database.updateAIConversation(conversationId, {
        title,
        updatedAt: new Date().toISOString()
      })

      // 重新加载对话列表
      await this.loadConversations()
    } catch (error) {
      console.error('更新标题失败:', error)
      throw error
    }
  }

  /**
   * 自动生成对话标题
   * @param {string} conversationId - 对话ID
   * @returns {Promise<string>}
   */
  async generateConversationTitle(conversationId) {
    try {
      const messages = await this.getConversationHistory(conversationId, 5)

      if (messages.length === 0) {
        return '新对话'
      }

      // 获取前几条消息生成标题
      const firstUserMessage = messages.find(m => m.role === 'user')
      if (!firstUserMessage) {
        return '新对话'
      }

      // 如果第一条消息很短，直接用作标题
      if (firstUserMessage.content.length <= 30) {
        return firstUserMessage.content
      }

      // 否则使用AI生成标题
      try {
        const response = await llm.query(
          `请为以下对话生成一个简短的标题（不超过15个字）。只返回标题，不要引号和其他说明。\n\n对话内容：${firstUserMessage.content.substring(0, 200)}`,
          []
        )

        const title = response.content.trim().replace(/^["'《「『]|["'》」』]$/g, '')
        return title.substring(0, 30)
      } catch (e) {
        // AI生成失败，使用默认方式
        return firstUserMessage.content.substring(0, 30) + '...'
      }
    } catch (error) {
      console.error('生成标题失败:', error)
      return '新对话'
    }
  }

  /**
   * 导出对话
   * @param {string} conversationId - 对话ID
   * @param {string} format - 导出格式 (json, markdown, txt)
   * @returns {Promise<string>}
   */
  async exportConversation(conversationId, format = 'markdown') {
    try {
      const conversation = await database.getAIConversation(conversationId)
      if (!conversation) {
        throw new Error('对话不存在')
      }

      const messages = await this.getConversationHistory(conversationId)

      switch (format) {
        case 'json':
          return JSON.stringify({ conversation, messages }, null, 2)

        case 'markdown':
          let md = `# ${conversation.title}\n\n`
          md += `**创建时间**: ${new Date(conversation.createdAt).toLocaleString()}\n`
          md += `**模型**: ${conversation.model}\n\n`
          md += `---\n\n`

          for (const msg of messages) {
            const role = msg.role === 'user' ? '👤 用户' : '🤖 AI助手'
            md += `### ${role}\n\n${msg.content}\n\n`
          }

          return md

        case 'txt':
          let txt = `${conversation.title}\n`
          txt += `创建时间: ${new Date(conversation.createdAt).toLocaleString()}\n`
          txt += `模型: ${conversation.model}\n\n`
          txt += `${'='.repeat(50)}\n\n`

          for (const msg of messages) {
            const role = msg.role === 'user' ? '用户' : 'AI助手'
            txt += `[${role}]\n${msg.content}\n\n`
          }

          return txt

        default:
          throw new Error(`不支持的格式: ${format}`)
      }
    } catch (error) {
      console.error('导出对话失败:', error)
      throw error
    }
  }

  /**
   * 清空对话消息（保留对话本身）
   * @param {string} conversationId - 对话ID
   * @returns {Promise<void>}
   */
  async clearConversationMessages(conversationId) {
    try {
      await database.clearAIMessages(conversationId)

      await database.updateAIConversation(conversationId, {
        messageCount: 0,
        lastMessageAt: null,
        updatedAt: new Date().toISOString()
      })

      // 重新加载对话列表
      await this.loadConversations()
    } catch (error) {
      console.error('清空消息失败:', error)
      throw error
    }
  }

  /**
   * 加载对话列表
   * @private
   */
  async loadConversations() {
    try {
      this.conversations = await database.getAIConversations()
    } catch (error) {
      console.error('加载对话列表失败:', error)
      this.conversations = []
    }
  }

  /**
   * 获取对话统计
   * @returns {Promise<Object>}
   */
  async getStatistics() {
    try {
      const conversations = await this.getConversations()

      const totalMessages = conversations.reduce((sum, conv) => sum + conv.messageCount, 0)
      const totalConversations = conversations.length

      return {
        totalConversations,
        totalMessages,
        averageMessagesPerConversation: totalConversations > 0
          ? Math.round(totalMessages / totalConversations)
          : 0
      }
    } catch (error) {
      console.error('获取统计失败:', error)
      return {
        totalConversations: 0,
        totalMessages: 0,
        averageMessagesPerConversation: 0
      }
    }
  }
}

// 导出单例
export default new AIConversationService()
