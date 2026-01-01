/**
 * ChainlessChain Mobile - 知识库 RAG 服务
 * Retrieval-Augmented Generation (检索增强生成)
 *
 * 功能：
 * - 从知识库检索相关内容
 * - 为AI对话提供上下文
 * - 语义搜索和关键词匹配
 * - 知识图谱遍历
 *
 * 架构：
 * - 优先使用后端AI服务的向量检索（Qdrant + BGE嵌入模型）
 * - 降级到本地关键词检索（离线模式）
 */

import database from './database'
import { llm } from './llm'
import { aiService } from './ai'

// 后端AI服务配置
const AI_SERVICE_BASE_URL = process.env.VUE_APP_AI_SERVICE_URL || 'http://localhost:8001'

class KnowledgeRAGService {
  constructor() {
    this.indexCache = null // 知识索引缓存
    this.lastIndexUpdate = null
    this.backendAvailable = false // 后端服务可用性
    this.lastBackendCheck = null // 最后检查时间
    this.checkInterval = 60000 // 检查间隔（1分钟）

    // 启动时检查后端
    this._checkBackendAvailability()
  }

  /**
   * 检查后端AI服务是否可用
   * @private
   */
  async _checkBackendAvailability() {
    // 避免频繁检查
    if (this.lastBackendCheck && Date.now() - this.lastBackendCheck < this.checkInterval) {
      return this.backendAvailable
    }

    try {
      const response = await uni.request({
        url: `${AI_SERVICE_BASE_URL}/health`,
        method: 'GET',
        timeout: 3000
      })

      this.backendAvailable = response.statusCode === 200 && response.data?.engines?.rag === true
      this.lastBackendCheck = Date.now()

      console.log('[KnowledgeRAG] 后端服务状态:', this.backendAvailable ? '可用' : '不可用')
      return this.backendAvailable
    } catch (error) {
      console.warn('[KnowledgeRAG] 后端服务不可用，使用本地检索:', error.message)
      this.backendAvailable = false
      this.lastBackendCheck = Date.now()
      return false
    }
  }

  /**
   * 向后端同步知识条目（用于向量索引）
   * @param {Object} knowledge - 知识条目
   */
  async syncKnowledgeToBackend(knowledge) {
    try {
      const available = await this._checkBackendAvailability()
      if (!available) {
        console.log('[KnowledgeRAG] 后端不可用，跳过同步')
        return false
      }

      // 调用后端API添加到向量数据库
      const response = await uni.request({
        url: `${AI_SERVICE_BASE_URL}/api/rag/index/update-file`,
        method: 'POST',
        data: {
          project_id: 'mobile_knowledge', // 移动端知识库统一project_id
          file_path: knowledge.id,
          content: `${knowledge.title}\n\n${knowledge.content}`
        },
        timeout: 10000
      })

      if (response.statusCode === 200) {
        console.log('[KnowledgeRAG] 知识已同步到后端向量数据库:', knowledge.id)
        return true
      } else {
        console.error('[KnowledgeRAG] 同步失败:', response.data)
        return false
      }
    } catch (error) {
      console.error('[KnowledgeRAG] 同步到后端失败:', error)
      return false
    }
  }

  /**
   * 从后端删除知识向量
   * @param {string} knowledgeId - 知识ID
   */
  async deleteKnowledgeFromBackend(knowledgeId) {
    try {
      const available = await this._checkBackendAvailability()
      if (!available) {
        return false
      }

      // 注意：当前后端API设计是删除整个project，这里我们暂时不调用
      // TODO: 后端需要提供删除单个文档的API
      console.log('[KnowledgeRAG] 跳过后端删除（需要单文档删除API）')
      return false
    } catch (error) {
      console.error('[KnowledgeRAG] 从后端删除失败:', error)
      return false
    }
  }

  /**
   * 基于查询检索相关知识
   * @param {string} query - 用户查询
   * @param {Object} options - 检索选项
   * @returns {Promise<Array>} 相关知识列表
   */
  async retrieve(query, options = {}) {
    const {
      limit = 5,
      minScore = 0.3, // 最低相关性分数 (0-1)
      includeContent = true,
      includeTags = true,
      searchMode = 'hybrid', // 'keyword', 'semantic', 'hybrid'
      useBackend = true, // 是否尝试使用后端
      useReranker = true // 是否使用重排序（仅后端）
    } = options

    try {
      // 优先尝试后端向量检索
      if (useBackend) {
        const available = await this._checkBackendAvailability()
        if (available) {
          console.log('[KnowledgeRAG] 使用后端向量检索')
          return await this._retrieveFromBackend(query, {
            limit,
            minScore,
            includeContent,
            includeTags,
            useReranker
          })
        }
      }

      // 降级到本地关键词检索
      console.log('[KnowledgeRAG] 使用本地关键词检索')
      return await this._retrieveLocally(query, {
        limit,
        minScore,
        includeContent,
        includeTags,
        searchMode
      })
    } catch (error) {
      console.error('[KnowledgeRAG] 检索失败:', error)
      return []
    }
  }

  /**
   * 从后端向量数据库检索（Qdrant + BGE嵌入）
   * @private
   */
  async _retrieveFromBackend(query, options) {
    const {
      limit = 5,
      minScore = 0.3,
      includeContent = true,
      includeTags = true,
      useReranker = true
    } = options

    try {
      // 调用后端增强RAG查询API
      const response = await uni.request({
        url: `${AI_SERVICE_BASE_URL}/api/rag/query/enhanced`,
        method: 'POST',
        data: {
          project_id: 'mobile_knowledge',
          query,
          top_k: limit,
          use_reranker: useReranker,
          sources: ['project']
        },
        timeout: 10000
      })

      if (response.statusCode !== 200) {
        throw new Error('后端检索失败: ' + response.statusCode)
      }

      const backendResults = response.data?.context || []

      // 将后端结果格式转换为统一格式
      const results = []
      for (const item of backendResults) {
        // 过滤低分结果
        if (item.score < minScore) {
          continue
        }

        // 从后端payload提取知识ID
        const knowledgeId = item.file_path || item.id

        // 从本地数据库获取完整知识信息
        let knowledge = null
        if (knowledgeId) {
          knowledge = await database.getKnowledge(knowledgeId)
        }

        results.push({
          id: knowledgeId,
          title: item.metadata?.title || knowledge?.title || '未命名',
          type: knowledge?.type || 'note',
          score: item.score,
          content: includeContent ? (item.text || knowledge?.content || '') : undefined,
          tags: includeTags && knowledge?.tags ? knowledge.tags : undefined,
          createdAt: knowledge?.createdAt,
          source: 'backend_vector', // 标记来源
          metadata: item.metadata
        })
      }

      console.log(`[KnowledgeRAG] 后端检索返回 ${results.length} 个结果`)
      return results
    } catch (error) {
      console.error('[KnowledgeRAG] 后端检索失败:', error)
      throw error
    }
  }

  /**
   * 本地关键词检索（降级方案）
   * @private
   */
  async _retrieveLocally(query, options) {
    const {
      limit = 5,
      minScore = 0.3,
      includeContent = true,
      includeTags = true,
      searchMode = 'hybrid'
    } = options

    try {
      // 获取所有知识项
      const allKnowledge = await database.getAllKnowledge()

      if (allKnowledge.length === 0) {
        return []
      }

      // 提取查询关键词
      const queryKeywords = await this._extractKeywords(query)

      // 计算每个知识项的相关性分数
      const scoredItems = []
      for (const item of allKnowledge) {
        let score = 0

        // 关键词匹配
        if (searchMode === 'keyword' || searchMode === 'hybrid') {
          score += this._keywordScore(item, query, queryKeywords)
        }

        // 语义相似度（简化版本，使用关键词重叠）
        if (searchMode === 'semantic' || searchMode === 'hybrid') {
          score += await this._semanticScore(item, query, queryKeywords)
        }

        if (score >= minScore) {
          scoredItems.push({
            item,
            score
          })
        }
      }

      // 按分数排序
      scoredItems.sort((a, b) => b.score - a.score)

      // 返回前N个结果
      const results = scoredItems.slice(0, limit).map(({ item, score }) => {
        const result = {
          id: item.id,
          title: item.title,
          type: item.type,
          score,
          createdAt: item.createdAt,
          source: 'local_keyword' // 标记来源
        }

        if (includeContent) {
          result.content = item.content
        }

        if (includeTags && item.tags) {
          result.tags = item.tags
        }

        return result
      })

      console.log(`[KnowledgeRAG] 本地检索返回 ${results.length} 个结果`)
      return results
    } catch (error) {
      console.error('[KnowledgeRAG] 本地检索失败:', error)
      return []
    }
  }

  /**
   * 为AI对话生成上下文
   * @param {string} query - 用户问题
   * @param {Object} options - 选项
   * @returns {Promise<string>} 格式化的上下文文本
   */
  async generateContext(query, options = {}) {
    const {
      maxLength = 2000, // 最大上下文长度（字符数）
      format = 'markdown' // 'text', 'markdown', 'json'
    } = options

    try {
      // 检索相关知识
      const relevantKnowledge = await this.retrieve(query, {
        limit: 5,
        includeContent: true,
        includeTags: true
      })

      if (relevantKnowledge.length === 0) {
        return format === 'json'
          ? JSON.stringify({ message: '未找到相关知识' })
          : '未找到相关知识'
      }

      // 根据格式生成上下文
      let context = ''

      if (format === 'markdown') {
        context = '# 相关知识\n\n'
        for (const item of relevantKnowledge) {
          context += `## ${item.title}\n\n`
          if (item.tags && item.tags.length > 0) {
            context += `**标签**: ${item.tags.map(t => t.name).join(', ')}\n\n`
          }
          context += `${item.content.substring(0, 500)}\n\n`
          context += `---\n\n`
        }
      } else if (format === 'text') {
        context = '相关知识：\n\n'
        for (const item of relevantKnowledge) {
          context += `${item.title}\n`
          context += `${item.content.substring(0, 300)}\n\n`
        }
      } else if (format === 'json') {
        context = JSON.stringify({
          query,
          results: relevantKnowledge.map(item => ({
            title: item.title,
            content: item.content.substring(0, 500),
            tags: item.tags,
            score: item.score
          }))
        }, null, 2)
      }

      // 截断到最大长度
      if (context.length > maxLength) {
        context = context.substring(0, maxLength) + '\n\n...(内容已截断)'
      }

      return context
    } catch (error) {
      console.error('生成上下文失败:', error)
      return ''
    }
  }

  /**
   * RAG增强查询：结合知识库回答问题
   * @param {string} question - 用户问题
   * @param {Object} options - 选项
   * @returns {Promise<Object>} AI回答和引用的知识
   */
  async query(question, options = {}) {
    const {
      temperature = 0.7,
      maxContextLength = 2000
    } = options

    try {
      // 1. 检索相关知识
      const relevantKnowledge = await this.retrieve(question, {
        limit: 5,
        includeContent: true
      })

      // 2. 生成上下文
      const context = await this.generateContext(question, {
        maxLength: maxContextLength,
        format: 'markdown'
      })

      // 3. 构建增强提示词
      const enhancedPrompt = `基于以下知识库内容回答用户的问题。如果知识库中没有相关信息，请明确说明。

${context}

用户问题: ${question}

请基于上述知识库内容回答问题：`

      // 4. 调用LLM
      const response = await llm.query(enhancedPrompt, [], { temperature })

      return {
        answer: response.content,
        sources: relevantKnowledge.map(item => ({
          id: item.id,
          title: item.title,
          score: item.score
        })),
        model: response.model,
        tokens: response.tokens
      }
    } catch (error) {
      console.error('RAG查询失败:', error)
      throw error
    }
  }

  /**
   * 智能问答：结合对话历史和知识库
   * @param {string} question - 用户问题
   * @param {Array} conversationHistory - 对话历史
   * @param {Object} options - 选项
   * @returns {Promise<Object>} AI回答
   */
  async chat(question, conversationHistory = [], options = {}) {
    const {
      useKnowledgeBase = true,
      temperature = 0.7
    } = options

    try {
      let context = ''
      let sources = []

      // 如果启用知识库，检索相关内容
      if (useKnowledgeBase) {
        const relevantKnowledge = await this.retrieve(question, {
          limit: 3,
          includeContent: true
        })

        if (relevantKnowledge.length > 0) {
          context = '\n\n【知识库参考】\n'
          for (const item of relevantKnowledge) {
            context += `\n${item.title}:\n${item.content.substring(0, 300)}\n`
          }

          sources = relevantKnowledge.map(item => ({
            id: item.id,
            title: item.title,
            score: item.score
          }))
        }
      }

      // 构建消息
      const enhancedQuestion = useKnowledgeBase && context
        ? `${question}${context}`
        : question

      // 调用LLM
      const response = await llm.query(
        enhancedQuestion,
        conversationHistory,
        { temperature }
      )

      return {
        answer: response.content,
        sources,
        model: response.model,
        tokens: response.tokens,
        usedKnowledgeBase: sources.length > 0
      }
    } catch (error) {
      console.error('智能问答失败:', error)
      throw error
    }
  }

  /**
   * 基于知识图谱的推荐
   * @param {string} knowledgeId - 知识ID
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 相关知识列表
   */
  async getRelatedKnowledge(knowledgeId, options = {}) {
    const {
      limit = 5,
      includeLinked = true, // 包含显式链接的知识
      includeSimilar = true  // 包含相似知识
    } = options

    try {
      const results = []

      // 获取当前知识
      const currentKnowledge = await database.getKnowledge(knowledgeId)
      if (!currentKnowledge) {
        return []
      }

      // 1. 获取显式链接的知识
      if (includeLinked) {
        const linkedItems = await database.getLinkedKnowledge(knowledgeId)
        for (const item of linkedItems) {
          results.push({
            ...item,
            reason: 'linked',
            score: 1.0
          })
        }
      }

      // 2. 基于标签查找相似知识
      if (includeSimilar && currentKnowledge.tags && currentKnowledge.tags.length > 0) {
        const tagIds = currentKnowledge.tags.map(t => t.id)
        const similarByTags = await database.getKnowledgeByTags(tagIds)

        for (const item of similarByTags) {
          if (item.id !== knowledgeId && !results.find(r => r.id === item.id)) {
            results.push({
              ...item,
              reason: 'similar_tags',
              score: 0.8
            })
          }
        }
      }

      // 3. 基于内容相似度（使用AI）
      if (includeSimilar && results.length < limit) {
        const allKnowledge = await database.getAllKnowledge()
        const similarByContent = await aiService.recommendRelated(
          currentKnowledge.title,
          currentKnowledge.content,
          allKnowledge.filter(k => k.id !== knowledgeId),
          limit - results.length
        )

        for (const id of similarByContent) {
          const item = allKnowledge.find(k => k.id === id)
          if (item && !results.find(r => r.id === item.id)) {
            results.push({
              ...item,
              reason: 'similar_content',
              score: 0.6
            })
          }
        }
      }

      // 按分数排序并限制数量
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    } catch (error) {
      console.error('获取相关知识失败:', error)
      return []
    }
  }

  /**
   * 提取关键词（使用AI或简单分词）
   * @private
   */
  async _extractKeywords(text) {
    try {
      // 使用AI提取关键词
      const keywords = await aiService.extractKeywords(text, 5)
      return keywords
    } catch (error) {
      // 降级到简单分词
      return text
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 1)
        .slice(0, 10)
    }
  }

  /**
   * 计算关键词匹配分数
   * @private
   */
  _keywordScore(item, query, queryKeywords) {
    let score = 0
    const text = `${item.title} ${item.content}`.toLowerCase()
    const queryLower = query.toLowerCase()

    // 完全匹配
    if (text.includes(queryLower)) {
      score += 0.5
    }

    // 标题匹配
    if (item.title.toLowerCase().includes(queryLower)) {
      score += 0.3
    }

    // 关键词匹配
    const matchedKeywords = queryKeywords.filter(keyword =>
      text.includes(keyword.toLowerCase())
    )
    score += (matchedKeywords.length / queryKeywords.length) * 0.3

    // 标签匹配
    if (item.tags && item.tags.length > 0) {
      const tagNames = item.tags.map(t => t.name.toLowerCase())
      const matchedTags = queryKeywords.filter(keyword =>
        tagNames.some(tag => tag.includes(keyword.toLowerCase()))
      )
      score += (matchedTags.length / queryKeywords.length) * 0.2
    }

    return Math.min(score, 1.0)
  }

  /**
   * 计算语义相似度分数（简化版本）
   * @private
   */
  async _semanticScore(item, query, queryKeywords) {
    // 简化版本：基于关键词重叠
    // 生产环境可以使用向量嵌入和余弦相似度

    try {
      const itemKeywords = await this._extractKeywords(
        `${item.title} ${item.content.substring(0, 500)}`
      )

      // 计算关键词重叠度
      const overlap = queryKeywords.filter(qk =>
        itemKeywords.some(ik =>
          ik.toLowerCase().includes(qk.toLowerCase()) ||
          qk.toLowerCase().includes(ik.toLowerCase())
        )
      ).length

      return (overlap / Math.max(queryKeywords.length, 1)) * 0.5
    } catch (error) {
      return 0
    }
  }

  /**
   * 构建知识索引（用于快速检索）
   * @private
   */
  async _buildIndex() {
    try {
      const allKnowledge = await database.getAllKnowledge()

      const index = {
        items: {},
        keywords: {}, // keyword -> [itemIds]
        tags: {}      // tagId -> [itemIds]
      }

      for (const item of allKnowledge) {
        // 存储项目
        index.items[item.id] = {
          title: item.title,
          type: item.type,
          createdAt: item.createdAt
        }

        // 提取并索引关键词
        const keywords = await this._extractKeywords(
          `${item.title} ${item.content.substring(0, 500)}`
        )

        for (const keyword of keywords) {
          const key = keyword.toLowerCase()
          if (!index.keywords[key]) {
            index.keywords[key] = []
          }
          if (!index.keywords[key].includes(item.id)) {
            index.keywords[key].push(item.id)
          }
        }

        // 索引标签
        if (item.tags && item.tags.length > 0) {
          for (const tag of item.tags) {
            if (!index.tags[tag.id]) {
              index.tags[tag.id] = []
            }
            index.tags[tag.id].push(item.id)
          }
        }
      }

      this.indexCache = index
      this.lastIndexUpdate = new Date()

      console.log('[KnowledgeRAG] 索引构建完成:', {
        items: Object.keys(index.items).length,
        keywords: Object.keys(index.keywords).length,
        tags: Object.keys(index.tags).length
      })

      return index
    } catch (error) {
      console.error('[KnowledgeRAG] 索引构建失败:', error)
      return null
    }
  }

  /**
   * 刷新索引
   */
  async refreshIndex() {
    return this._buildIndex()
  }

  /**
   * 获取统计信息
   */
  async getStatistics() {
    try {
      const allKnowledge = await database.getAllKnowledge()

      return {
        totalItems: allKnowledge.length,
        indexedItems: this.indexCache ? Object.keys(this.indexCache.items).length : 0,
        lastIndexUpdate: this.lastIndexUpdate,
        indexStatus: this.indexCache ? 'ready' : 'not_built',
        backendAvailable: this.backendAvailable,
        backendUrl: AI_SERVICE_BASE_URL
      }
    } catch (error) {
      console.error('获取统计失败:', error)
      return {
        totalItems: 0,
        indexedItems: 0,
        lastIndexUpdate: null,
        indexStatus: 'error',
        backendAvailable: false,
        backendUrl: AI_SERVICE_BASE_URL
      }
    }
  }

  /**
   * 获取RAG服务状态
   * @returns {Promise<Object>} 服务状态信息
   */
  async getServiceStatus() {
    const available = await this._checkBackendAvailability()

    return {
      backend: {
        available,
        url: AI_SERVICE_BASE_URL,
        lastCheck: this.lastBackendCheck,
        checkInterval: this.checkInterval
      },
      local: {
        indexCached: this.indexCache !== null,
        lastIndexUpdate: this.lastIndexUpdate
      },
      mode: available ? 'backend_vector' : 'local_keyword',
      capabilities: {
        vectorSearch: available,
        reranking: available,
        hybridSearch: true,
        keywordSearch: true
      }
    }
  }

  /**
   * 强制刷新后端状态
   * @returns {Promise<boolean>} 后端是否可用
   */
  async refreshBackendStatus() {
    this.lastBackendCheck = null // 清除缓存
    return await this._checkBackendAvailability()
  }
}

// 导出单例
export default new KnowledgeRAGService()
