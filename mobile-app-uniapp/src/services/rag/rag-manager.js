/**
 * RAG Manager (移动端版本)
 *
 * 统一管理RAG检索流程
 * 集成Embeddings、VectorStore、Reranker
 *
 * 功能对齐桌面端
 */

import EmbeddingsService from './embeddings-service.js'
import VectorStore from './vector-store.js'
import Reranker from './reranker.js'
import { getHybridSearch } from './hybrid-search.js'
import { db as database } from '../database.js'

/**
 * RAG Manager类
 */
class RAGManager {
  constructor(config = {}) {
    this.config = {
      // 检索参数
      topK: config.topK || 10,
      similarityThreshold: config.similarityThreshold || 0.6,
      maxContextLength: config.maxContextLength || 6000,

      // 启用选项
      enableRAG: config.enableRAG !== false,
      enableReranking: config.enableReranking !== false,
      enableHybridSearch: config.enableHybridSearch !== false,

      // 重排序配置
      rerankMethod: config.rerankMethod || 'hybrid',
      rerankTopK: config.rerankTopK || 5,
      rerankScoreThreshold: config.rerankScoreThreshold || 0.3,

      // 权重
      vectorWeight: config.vectorWeight || 0.6,
      keywordWeight: config.keywordWeight || 0.4,

      // Embeddings配置
      embeddingsMode: config.embeddingsMode || 'auto',
      embeddingsModelName: config.embeddingsModelName || 'Xenova/all-MiniLM-L6-v2',

      ...config
    }

    // 初始化组件
    this.embeddingsService = new EmbeddingsService({
      mode: this.config.embeddingsMode,
      modelName: this.config.embeddingsModelName
    })

    this.vectorStore = new VectorStore({
      topK: this.config.topK,
      similarityThreshold: this.config.similarityThreshold
    })

    this.reranker = new Reranker({
      enabled: this.config.enableReranking,
      method: this.config.rerankMethod,
      topK: this.config.rerankTopK,
      scoreThreshold: this.config.rerankScoreThreshold,
      vectorWeight: this.config.vectorWeight,
      keywordWeight: this.config.keywordWeight
    })

    // 混合检索
    this.hybridSearch = this.config.enableHybridSearch ? getHybridSearch({
      vectorWeight: this.config.vectorWeight,
      bm25Weight: this.config.keywordWeight,
      enableCache: true,
      cacheSize: 100
    }) : null

    // 状态
    this.isInitialized = false
    this.indexBuilding = false

    // 统计
    this.stats = {
      totalQueries: 0,
      avgRetrievalTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    }
  }

  /**
   * 初始化RAG Manager
   */
  async initialize() {
    console.log('[RAGManager] 初始化RAG管理器...')

    try {
      // 初始化Embeddings服务
      await this.embeddingsService.initialize()

      // 初始化VectorStore
      await this.vectorStore.initialize()

      // 构建向量索引
      await this.buildVectorIndex()

      this.isInitialized = true
      console.log('[RAGManager] ✅ RAG管理器初始化成功')

      return {
        success: true,
        mode: this.embeddingsService.currentMode,
        vectorCount: this.vectorStore.stats.totalVectors
      }
    } catch (error) {
      console.error('[RAGManager] ❌ 初始化失败:', error)
      this.isInitialized = false
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 构建向量索引
   */
  async buildVectorIndex() {
    if (!this.config.enableRAG) {
      console.log('[RAGManager] RAG未启用，跳过索引构建')
      return
    }

    if (this.indexBuilding) {
      console.warn('[RAGManager] 索引正在构建中...')
      return
    }

    this.indexBuilding = true
    console.log('[RAGManager] 开始构建向量索引...')

    try {
      // 获取所有知识库项
      const items = await database.exec(`
        SELECT id, title, content, type, tags, created_at
        FROM notes
        WHERE deleted = 0
        ORDER BY updated_at DESC
        LIMIT 10000
      `)

      if (!items || items.length === 0) {
        console.log('[RAGManager] 知识库为空')
        this.indexBuilding = false
        return
      }

      console.log(`[RAGManager] 为 ${items.length} 个项目生成向量...`)

      // 批量处理
      const batchSize = 20
      let processed = 0

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)

        try {
          // 生成嵌入向量
          const embeddings = await Promise.all(
            batch.map(async (item) => {
              const text = `${item.title}\n${item.content || ''}`
              return await this.embeddingsService.generateEmbedding(text)
            })
          )

          // 存储向量
          await this.vectorStore.addVectorsBatch(batch, embeddings)

          processed += batch.length
          console.log(`[RAGManager] 进度: ${processed}/${items.length}`)
        } catch (error) {
          console.error(`[RAGManager] 批次处理失败:`, error)
        }
      }

      // 更新IDF（用于TF-IDF）
      const allTexts = items.map(item => `${item.title}\n${item.content || ''}`)
      this.embeddingsService.updateIDF(allTexts)

      // 构建BM25索引（如果启用混合检索）
      if (this.config.enableHybridSearch && this.hybridSearch) {
        console.log('[RAGManager] 构建BM25索引...')
        await this.hybridSearch.buildBM25Index(items)
        console.log('[RAGManager] ✅ BM25索引构建完成')
      }

      console.log(`[RAGManager] ✅ 索引构建完成: ${processed}/${items.length}`)

      this.indexBuilding = false
    } catch (error) {
      console.error('[RAGManager] 索引构建失败:', error)
      this.indexBuilding = false
      throw error
    }
  }

  /**
   * 检索相关文档
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 检索结果
   */
  async retrieve(query, options = {}) {
    if (!this.isInitialized) {
      console.warn('[RAGManager] RAG未初始化')
      return []
    }

    const startTime = Date.now()

    try {
      let vectorResults = []

      // 1. 使用混合检索或纯向量检索
      if (this.config.enableHybridSearch && this.hybridSearch) {
        console.log('[RAGManager] 使用混合检索（向量+BM25）')

        const hybridResult = await this.hybridSearch.search(query, {
          topK: options.topK || this.config.topK,
          useCache: true,
          expandQuery: true
        })

        vectorResults = hybridResult.results

        console.log('[RAGManager] 混合检索结果:', {
          total: hybridResult.total,
          vector: hybridResult.vectorCount,
          bm25: hybridResult.bm25Count
        })
      } else {
        console.log('[RAGManager] 使用纯向量检索')

        // 生成查询向量
        const queryEmbedding = await this.embeddingsService.generateEmbedding(query)

        // 向量搜索
        vectorResults = await this.vectorStore.search(queryEmbedding, {
          topK: options.topK || this.config.topK,
          similarityThreshold: options.similarityThreshold || this.config.similarityThreshold
        })
      }

      if (vectorResults.length === 0) {
        console.log('[RAGManager] 未找到相关文档')
        return []
      }

      // 2. 重排序
      let finalResults = vectorResults

      if (this.config.enableReranking && vectorResults.length > 1) {
        finalResults = await this.reranker.rerank(query, vectorResults, {
          method: options.rerankMethod || this.config.rerankMethod,
          topK: options.rerankTopK || this.config.rerankTopK
        })
      }

      // 4. 补充完整文档信息
      const enrichedResults = await this.enrichResults(finalResults)

      // 更新统计
      const retrievalTime = Date.now() - startTime
      this.stats.totalQueries++
      this.stats.avgRetrievalTime =
        (this.stats.avgRetrievalTime * (this.stats.totalQueries - 1) + retrievalTime) /
        this.stats.totalQueries

      console.log(`[RAGManager] ✅ 检索完成: ${enrichedResults.length} 个结果，耗时 ${retrievalTime}ms`)

      return enrichedResults
    } catch (error) {
      console.error('[RAGManager] 检索失败:', error)
      return []
    }
  }

  /**
   * 增强查询（生成RAG上下文）
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 增强的查询
   */
  async enhanceQuery(query, options = {}) {
    const retrievedDocs = await this.retrieve(query, options)

    if (retrievedDocs.length === 0) {
      return {
        query,
        context: '',
        retrievedDocs: []
      }
    }

    // 构建上下文
    const context = retrievedDocs
      .map((doc, idx) => {
        const title = doc.title || '无标题'
        const content = doc.content || ''
        const preview = content.substring(0, 500)
        return `[文档${idx + 1}: ${title}]\n${preview}`
      })
      .join('\n\n')

    // 限制上下文长度
    const truncatedContext = context.length > this.config.maxContextLength
      ? context.substring(0, this.config.maxContextLength) + '...'
      : context

    return {
      query,
      context: truncatedContext,
      retrievedDocs: retrievedDocs.map(doc => ({
        id: doc.id,
        title: doc.title,
        content: doc.content?.substring(0, 200),
        score: doc.rerank_score || doc.similarity,
        type: doc.type
      }))
    }
  }

  /**
   * 补充完整文档信息
   */
  async enrichResults(results) {
    const enriched = []

    for (const result of results) {
      try {
        // 从数据库获取完整文档
        const doc = await database.exec(`
          SELECT id, title, content, type, tags, created_at, updated_at
          FROM notes
          WHERE id = ?
        `, [result.id])[0]

        if (doc) {
          enriched.push({
            id: doc.id,
            title: doc.title,
            content: doc.content,
            type: doc.type,
            tags: doc.tags,
            created_at: doc.created_at,
            updated_at: doc.updated_at,
            similarity: result.similarity,
            rerank_score: result.rerank_score,
            match_count: result.match_count
          })
        }
      } catch (error) {
        console.error(`[RAGManager] 补充文档失败: ${result.id}`, error)
      }
    }

    return enriched
  }

  /**
   * 添加文档到索引
   */
  async addDocument(doc) {
    try {
      const text = `${doc.title}\n${doc.content || ''}`
      const embedding = await this.embeddingsService.generateEmbedding(text)

      const metadata = {
        title: doc.title,
        content: doc.content?.substring(0, 200),
        type: doc.type,
        tags: doc.tags,
        created_at: doc.created_at
      }

      await this.vectorStore.addVector(doc.id, embedding, metadata)

      console.log(`[RAGManager] ✅ 文档已添加到索引: ${doc.id}`)
    } catch (error) {
      console.error('[RAGManager] 添加文档失败:', error)
      throw error
    }
  }

  /**
   * 从索引删除文档
   */
  async removeDocument(docId) {
    await this.vectorStore.deleteVector(docId)
    console.log(`[RAGManager] ✅ 文档已从索引删除: ${docId}`)
  }

  /**
   * 重建索引
   */
  async rebuildIndex() {
    console.log('[RAGManager] 开始重建索引...')
    await this.vectorStore.clear()
    await this.buildVectorIndex()
    console.log('[RAGManager] ✅ 索引重建完成')
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config }

    // 更新子组件配置
    if (config.enableReranking !== undefined) {
      this.reranker.setEnabled(config.enableReranking)
    }

    if (config.rerankMethod || config.rerankTopK || config.rerankScoreThreshold) {
      this.reranker.updateConfig({
        method: config.rerankMethod,
        topK: config.rerankTopK,
        scoreThreshold: config.rerankScoreThreshold
      })
    }

    console.log('[RAGManager] 配置已更新')
  }

  /**
   * 获取索引统计
   */
  getIndexStats() {
    return {
      enabled: this.config.enableRAG,
      initialized: this.isInitialized,
      building: this.indexBuilding,
      vectorStore: this.vectorStore.getStats(),
      embeddings: this.embeddingsService.getStats(),
      queries: {
        total: this.stats.totalQueries,
        avgTime: Math.round(this.stats.avgRetrievalTime * 100) / 100
      }
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.embeddingsService.clearCache()
    console.log('[RAGManager] ✅ 缓存已清除')
  }
}

export default RAGManager
