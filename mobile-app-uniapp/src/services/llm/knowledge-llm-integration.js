/**
 * 知识库LLM集成服务 (移动端版本)
 *
 * 功能:
 * - AI问答 (基于知识库)
 * - 内容总结
 * - 智能搜索
 * - 笔记增强
 * - 相似内容推荐
 *
 * 整合LLM + RAG + 知识库
 */

import { getLLMManager } from './llm-manager.js'
import { getConversationManager } from './conversation-manager.js'
import { getRAGManager } from '../rag/rag-manager.js'
import { db as database } from '../database.js'

/**
 * 知识库LLM集成类
 */
class KnowledgeLLMIntegration {
  constructor(config = {}) {
    this.config = {
      // 是否启用RAG增强
      enableRAG: config.enableRAG !== false,

      // RAG检索数量
      ragTopK: config.ragTopK || 5,

      // 总结最大长度
      summaryMaxLength: config.summaryMaxLength || 500,

      // 问答上下文窗口
      qaContextWindow: config.qaContextWindow || 3,

      ...config
    }

    // LLM管理器
    this.llmManager = getLLMManager(config.llm)

    // 对话管理器
    this.conversationManager = getConversationManager(config.conversation)

    // RAG管理器 (如果启用)
    this.ragManager = this.config.enableRAG ? getRAGManager(config.rag) : null

    // 初始化状态
    this.isInitialized = false

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
      console.log('[KnowledgeLLM] 初始化知识库LLM集成...')

      // 初始化LLM管理器
      await this.llmManager.initialize()

      // 初始化对话管理器
      await this.conversationManager.initialize()

      // 初始化RAG管理器 (如果启用)
      if (this.ragManager) {
        await this.ragManager.initialize()
      }

      this.isInitialized = true

      console.log('[KnowledgeLLM] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[KnowledgeLLM] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 基于知识库的问答
   * @param {string} question - 问题
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async askQuestion(question, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      conversationId = null,
      useRAG = this.config.enableRAG,
      topK = this.ragTopK,
      includeContext = true
    } = options

    try {
      console.log('[KnowledgeLLM] 问答:', question)

      this.emit('qa-start', { question })

      let context = ''
      let relatedNotes = []

      // 使用RAG检索相关知识
      if (useRAG && this.ragManager) {
        const searchResult = await this.ragManager.search(question, {
          topK,
          enableRerank: true
        })

        relatedNotes = searchResult.results

        if (relatedNotes.length > 0) {
          context = this.buildRAGContext(relatedNotes)
          console.log('[KnowledgeLLM] 找到相关笔记:', relatedNotes.length, '条')
        }
      }

      // 构建提示词
      const prompt = this.buildQAPrompt(question, context, includeContext)

      // 获取或创建对话
      let convId = conversationId
      if (!convId) {
        const conv = await this.conversationManager.createConversation({
          title: question.substring(0, 30) + (question.length > 30 ? '...' : ''),
          context_type: 'knowledge_qa',
          context_data: { question, relatedNotes: relatedNotes.map(n => n.id) }
        })
        convId = conv.id
      }

      // 发送消息
      const response = await this.conversationManager.sendMessage(convId, prompt)

      console.log('[KnowledgeLLM] ✅ 问答完成')

      this.emit('qa-complete', {
        question,
        answer: response.assistantMessage,
        relatedNotes
      })

      return {
        success: true,
        conversationId: convId,
        question,
        answer: response.assistantMessage,
        relatedNotes,
        usage: response.usage
      }
    } catch (error) {
      console.error('[KnowledgeLLM] 问答失败:', error)

      this.emit('qa-error', { question, error })

      throw error
    }
  }

  /**
   * 总结笔记内容
   * @param {string} noteId - 笔记ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async summarizeNote(noteId, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      maxLength = this.config.summaryMaxLength,
      language = 'zh'
    } = options

    try {
      console.log('[KnowledgeLLM] 总结笔记:', noteId)

      this.emit('summarize-start', { noteId })

      // 获取笔记内容
      const note = await this.getNote(noteId)
      if (!note) {
        throw new Error('笔记不存在')
      }

      // 构建提示词
      const prompt = `请总结以下内容，不超过${maxLength}字：\n\n${note.content}`

      // 调用LLM
      const response = await this.llmManager.chat([
        { role: 'user', content: prompt }
      ])

      const summary = response.content

      console.log('[KnowledgeLLM] ✅ 总结完成')

      this.emit('summarize-complete', { noteId, summary })

      return {
        success: true,
        noteId,
        summary,
        originalLength: note.content.length,
        summaryLength: summary.length,
        usage: response.usage
      }
    } catch (error) {
      console.error('[KnowledgeLLM] 总结失败:', error)

      this.emit('summarize-error', { noteId, error })

      throw error
    }
  }

  /**
   * 智能搜索 (LLM增强)
   * @param {string} query - 查询
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async smartSearch(query, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      topK = 10,
      enhanceQuery = true
    } = options

    try {
      console.log('[KnowledgeLLM] 智能搜索:', query)

      this.emit('search-start', { query })

      let searchQuery = query

      // 使用LLM增强查询
      if (enhanceQuery) {
        const enhancePrompt = `将以下用户查询改写为更适合搜索的关键词（只返回关键词，用空格分隔）：\n\n${query}`

        const response = await this.llmManager.chat([
          { role: 'user', content: enhancePrompt }
        ])

        searchQuery = response.content.trim()
        console.log('[KnowledgeLLM] 增强后的查询:', searchQuery)
      }

      // 使用RAG搜索
      let results = []
      if (this.ragManager) {
        const searchResult = await this.ragManager.search(searchQuery, {
          topK,
          enableRerank: true
        })
        results = searchResult.results
      }

      console.log('[KnowledgeLLM] ✅ 搜索完成，找到', results.length, '条结果')

      this.emit('search-complete', { query, results })

      return {
        success: true,
        query,
        enhancedQuery: searchQuery,
        results,
        total: results.length
      }
    } catch (error) {
      console.error('[KnowledgeLLM] 智能搜索失败:', error)

      this.emit('search-error', { query, error })

      throw error
    }
  }

  /**
   * 笔记增强 (添加标签、关键词等)
   * @param {string} noteId - 笔记ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async enhanceNote(noteId, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      generateTags = true,
      generateKeywords = true,
      generateSummary = false
    } = options

    try {
      console.log('[KnowledgeLLM] 增强笔记:', noteId)

      this.emit('enhance-start', { noteId })

      // 获取笔记内容
      const note = await this.getNote(noteId)
      if (!note) {
        throw new Error('笔记不存在')
      }

      const enhancements = {}

      // 生成标签
      if (generateTags) {
        const tagsPrompt = `为以下内容生成3-5个标签（只返回标签，用逗号分隔）：\n\n${note.content.substring(0, 500)}`

        const response = await this.llmManager.chat([
          { role: 'user', content: tagsPrompt }
        ])

        enhancements.tags = response.content.split(',').map(t => t.trim())
      }

      // 生成关键词
      if (generateKeywords) {
        const keywordsPrompt = `提取以下内容的5-10个关键词（只返回关键词，用空格分隔）：\n\n${note.content.substring(0, 500)}`

        const response = await this.llmManager.chat([
          { role: 'user', content: keywordsPrompt }
        ])

        enhancements.keywords = response.content.split(/\s+/).map(k => k.trim())
      }

      // 生成摘要
      if (generateSummary) {
        const summaryResult = await this.summarizeNote(noteId)
        enhancements.summary = summaryResult.summary
      }

      console.log('[KnowledgeLLM] ✅ 笔记增强完成')

      this.emit('enhance-complete', { noteId, enhancements })

      return {
        success: true,
        noteId,
        enhancements
      }
    } catch (error) {
      console.error('[KnowledgeLLM] 笔记增强失败:', error)

      this.emit('enhance-error', { noteId, error })

      throw error
    }
  }

  /**
   * 查找相似笔记
   * @param {string} noteId - 笔记ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async findSimilarNotes(noteId, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const { topK = 5 } = options

    try {
      console.log('[KnowledgeLLM] 查找相似笔记:', noteId)

      // 获取笔记内容
      const note = await this.getNote(noteId)
      if (!note) {
        throw new Error('笔记不存在')
      }

      // 使用RAG查找相似内容
      let similarNotes = []
      if (this.ragManager) {
        const searchResult = await this.ragManager.search(note.content, {
          topK: topK + 1, // +1 因为可能包含自己
          enableRerank: true
        })

        // 过滤掉自己
        similarNotes = searchResult.results.filter(n => n.id !== noteId).slice(0, topK)
      }

      console.log('[KnowledgeLLM] ✅ 找到', similarNotes.length, '条相似笔记')

      return {
        success: true,
        noteId,
        similarNotes,
        total: similarNotes.length
      }
    } catch (error) {
      console.error('[KnowledgeLLM] 查找相似笔记失败:', error)
      throw error
    }
  }

  /**
   * 构建RAG上下文
   * @param {Array} notes - 笔记列表
   * @returns {string}
   * @private
   */
  buildRAGContext(notes) {
    const lines = []

    lines.push('以下是相关的知识库内容：')
    lines.push('')

    notes.forEach((note, index) => {
      lines.push(`[${index + 1}] ${note.title || '无标题'}`)
      lines.push(note.content.substring(0, 300) + (note.content.length > 300 ? '...' : ''))
      lines.push('')
    })

    return lines.join('\n')
  }

  /**
   * 构建问答提示词
   * @param {string} question - 问题
   * @param {string} context - 上下文
   * @param {boolean} includeContext - 是否包含上下文
   * @returns {string}
   * @private
   */
  buildQAPrompt(question, context, includeContext) {
    const lines = []

    if (includeContext && context) {
      lines.push(context)
      lines.push('')
      lines.push('---')
      lines.push('')
      lines.push('基于以上知识库内容，请回答：')
      lines.push('')
    }

    lines.push(question)

    return lines.join('\n')
  }

  /**
   * 获取笔记
   * @param {string} noteId - 笔记ID
   * @returns {Promise<Object|null>}
   * @private
   */
  async getNote(noteId) {
    try {
      const results = await database.exec(
        'SELECT * FROM notes WHERE id = ? AND deleted = 0',
        [noteId]
      )

      return results && results.length > 0 ? results[0] : null
    } catch (error) {
      console.error('[KnowledgeLLM] 获取笔记失败:', error)
      return null
    }
  }

  /**
   * 创建AI助手对话
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async createAssistantChat(options = {}) {
    const {
      title = 'AI助手',
      systemMessage = '你是一个有用的AI助手，可以帮助用户管理和查询知识库。'
    } = options

    return await this.conversationManager.createConversation({
      title,
      context_type: 'assistant',
      system_message: systemMessage
    })
  }

  /**
   * AI助手聊天
   * @param {string} conversationId - 对话ID
   * @param {string} message - 消息
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async chatWithAssistant(conversationId, message, options = {}) {
    return await this.conversationManager.sendMessage(conversationId, message, options)
  }

  /**
   * 获取LLM管理器
   * @returns {LLMManager}
   */
  getLLMManager() {
    return this.llmManager
  }

  /**
   * 获取对话管理器
   * @returns {ConversationManager}
   */
  getConversationManager() {
    return this.conversationManager
  }

  /**
   * 获取RAG管理器
   * @returns {RAGManager|null}
   */
  getRAGManager() {
    return this.ragManager
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
        console.error('[KnowledgeLLM] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    await this.llmManager.terminate()
    await this.conversationManager.cleanup()
    if (this.ragManager) {
      await this.ragManager.cleanup()
    }
    this.isInitialized = false
    console.log('[KnowledgeLLM] 资源已清理')
  }
}

// 创建单例
let knowledgeLLMInstance = null

/**
 * 获取知识库LLM集成实例
 * @param {Object} config - 配置
 * @returns {KnowledgeLLMIntegration}
 */
export function getKnowledgeLLMIntegration(config) {
  if (!knowledgeLLMInstance) {
    knowledgeLLMInstance = new KnowledgeLLMIntegration(config)
  }
  return knowledgeLLMInstance
}

export default KnowledgeLLMIntegration
