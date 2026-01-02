/**
 * 混合检索模块 (移动端版本)
 *
 * 功能:
 * - 向量检索 + BM25关键词检索
 * - 结果融合（Reciprocal Rank Fusion）
 * - 查询扩展和改写
 * - 多级缓存
 * - 性能优化
 */

import { getEmbeddingsService } from './embeddings-service.js'
import { getVectorStore } from './vector-store.js'

/**
 * BM25算法实现
 */
class BM25 {
  constructor(documents, k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
    this.documents = documents
    this.avgDocLength = 0
    this.docLengths = []
    this.idf = new Map()

    this.preprocess()
  }

  /**
   * 预处理文档
   * @private
   */
  preprocess() {
    // 分词并计算文档长度
    const tokenizedDocs = []
    let totalLength = 0

    for (const doc of this.documents) {
      const tokens = this.tokenize(doc.content)
      tokenizedDocs.push(tokens)
      this.docLengths.push(tokens.length)
      totalLength += tokens.length
    }

    this.avgDocLength = totalLength / this.documents.length
    this.tokenizedDocs = tokenizedDocs

    // 计算IDF
    const df = new Map() // 文档频率

    for (const tokens of tokenizedDocs) {
      const uniqueTokens = new Set(tokens)
      for (const token of uniqueTokens) {
        df.set(token, (df.get(token) || 0) + 1)
      }
    }

    const N = this.documents.length
    for (const [token, freq] of df.entries()) {
      this.idf.set(token, Math.log((N - freq + 0.5) / (freq + 0.5) + 1))
    }
  }

  /**
   * 分词
   * @param {string} text - 文本
   * @returns {Array<string>}
   * @private
   */
  tokenize(text) {
    // 简单的中英文分词
    // 中文按字符，英文按单词
    const tokens = []

    // 提取英文单词
    const words = text.toLowerCase().match(/[a-z]+/g) || []
    tokens.push(...words)

    // 提取中文字符（双字符为主）
    const chinese = text.match(/[\u4e00-\u9fa5]/g) || []
    for (let i = 0; i < chinese.length - 1; i++) {
      tokens.push(chinese[i] + chinese[i + 1])
    }

    return tokens
  }

  /**
   * 计算查询的BM25分数
   * @param {string} query - 查询文本
   * @param {number} topK - 返回结果数
   * @returns {Array}
   */
  search(query, topK = 10) {
    const queryTokens = this.tokenize(query)
    const scores = []

    for (let i = 0; i < this.documents.length; i++) {
      const docTokens = this.tokenizedDocs[i]
      const docLength = this.docLengths[i]

      let score = 0

      for (const token of queryTokens) {
        const idf = this.idf.get(token) || 0
        const tf = docTokens.filter(t => t === token).length

        // BM25公式
        score += idf * (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength)))
      }

      scores.push({
        index: i,
        document: this.documents[i],
        score
      })
    }

    // 排序并返回topK
    scores.sort((a, b) => b.score - a.score)
    return scores.slice(0, topK)
  }
}

/**
 * 混合检索类
 */
class HybridSearch {
  constructor(config = {}) {
    this.config = {
      // 向量检索权重
      vectorWeight: config.vectorWeight || 0.7,

      // BM25权重
      bm25Weight: config.bm25Weight || 0.3,

      // 是否启用查询扩展
      enableQueryExpansion: config.enableQueryExpansion !== false,

      // 是否启用缓存
      enableCache: config.enableCache !== false,

      // 缓存大小
      cacheSize: config.cacheSize || 100,

      // BM25参数
      bm25K1: config.bm25K1 || 1.5,
      bm25B: config.bm25B || 0.75,

      ...config
    }

    // 服务
    this.embeddingsService = getEmbeddingsService()
    this.vectorStore = getVectorStore()

    // BM25索引
    this.bm25Index = null

    // 缓存
    this.cache = new Map()
    this.cacheKeys = [] // LRU队列

    // 初始化状态
    this.isInitialized = false

    // 统计
    this.stats = {
      totalSearches: 0,
      cacheHits: 0,
      vectorSearches: 0,
      bm25Searches: 0
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
      console.log('[HybridSearch] 初始化混合检索...')

      // 初始化embeddings服务
      await this.embeddingsService.initialize()

      // 初始化向量存储
      await this.vectorStore.initialize()

      this.isInitialized = true

      console.log('[HybridSearch] ✅ 初始化成功')

      return { success: true }
    } catch (error) {
      console.error('[HybridSearch] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 构建BM25索引
   * @param {Array} documents - 文档列表
   * @returns {Promise<void>}
   */
  async buildBM25Index(documents) {
    console.log('[HybridSearch] 构建BM25索引...', documents.length, '个文档')

    this.bm25Index = new BM25(documents, this.config.bm25K1, this.config.bm25B)

    console.log('[HybridSearch] ✅ BM25索引构建完成')
  }

  /**
   * 混合检索
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async search(query, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const {
      topK = 10,
      useCache = this.config.enableCache,
      expandQuery = this.config.enableQueryExpansion
    } = options

    this.stats.totalSearches++

    // 检查缓存
    if (useCache) {
      const cached = this.getFromCache(query)
      if (cached) {
        this.stats.cacheHits++
        console.log('[HybridSearch] 缓存命中')
        return cached
      }
    }

    try {
      console.log('[HybridSearch] 混合检索:', query)

      let searchQuery = query

      // 查询扩展
      if (expandQuery) {
        searchQuery = await this.expandQuery(query)
        console.log('[HybridSearch] 扩展查询:', searchQuery)
      }

      // 1. 向量检索
      const vectorResults = await this.vectorSearch(searchQuery, topK * 2)
      this.stats.vectorSearches++

      // 2. BM25检索
      let bm25Results = []
      if (this.bm25Index) {
        bm25Results = this.bm25Search(searchQuery, topK * 2)
        this.stats.bm25Searches++
      }

      // 3. 融合结果
      const fusedResults = this.fuseResults(vectorResults, bm25Results, topK)

      const result = {
        query,
        expandedQuery: searchQuery,
        results: fusedResults,
        total: fusedResults.length,
        vectorCount: vectorResults.length,
        bm25Count: bm25Results.length
      }

      // 缓存结果
      if (useCache) {
        this.addToCache(query, result)
      }

      console.log('[HybridSearch] ✅ 检索完成，返回', fusedResults.length, '个结果')

      return result
    } catch (error) {
      console.error('[HybridSearch] 检索失败:', error)
      throw error
    }
  }

  /**
   * 向量检索
   * @param {string} query - 查询
   * @param {number} topK - 结果数
   * @returns {Promise<Array>}
   * @private
   */
  async vectorSearch(query, topK) {
    // 生成查询向量
    const queryEmbedding = await this.embeddingsService.generateEmbedding(query)

    // 向量检索
    const results = await this.vectorStore.search(queryEmbedding, topK)

    return results.map(result => ({
      ...result,
      source: 'vector'
    }))
  }

  /**
   * BM25检索
   * @param {string} query - 查询
   * @param {number} topK - 结果数
   * @returns {Array}
   * @private
   */
  bm25Search(query, topK) {
    if (!this.bm25Index) {
      return []
    }

    const results = this.bm25Index.search(query, topK)

    return results.map(result => ({
      ...result.document,
      score: result.score,
      source: 'bm25'
    }))
  }

  /**
   * 融合检索结果（Reciprocal Rank Fusion）
   * @param {Array} vectorResults - 向量检索结果
   * @param {Array} bm25Results - BM25检索结果
   * @param {number} topK - 最终返回数量
   * @returns {Array}
   * @private
   */
  fuseResults(vectorResults, bm25Results, topK) {
    const k = 60 // RRF常数
    const scores = new Map()

    // 计算向量检索的RRF分数
    vectorResults.forEach((result, rank) => {
      const id = result.id
      const rrfScore = this.config.vectorWeight / (k + rank + 1)

      scores.set(id, {
        ...result,
        rrfScore: (scores.get(id)?.rrfScore || 0) + rrfScore,
        vectorRank: rank + 1,
        vectorScore: result.score
      })
    })

    // 计算BM25的RRF分数
    bm25Results.forEach((result, rank) => {
      const id = result.id
      const rrfScore = this.config.bm25Weight / (k + rank + 1)

      const existing = scores.get(id)
      if (existing) {
        existing.rrfScore += rrfScore
        existing.bm25Rank = rank + 1
        existing.bm25Score = result.score
      } else {
        scores.set(id, {
          ...result,
          rrfScore,
          bm25Rank: rank + 1,
          bm25Score: result.score
        })
      }
    })

    // 排序并返回topK
    const fusedResults = Array.from(scores.values())
    fusedResults.sort((a, b) => b.rrfScore - a.rrfScore)

    return fusedResults.slice(0, topK)
  }

  /**
   * 查询扩展
   * @param {string} query - 原始查询
   * @returns {Promise<string>}
   * @private
   */
  async expandQuery(query) {
    // 简单的查询扩展：添加同义词和相关词
    // 实际应用中可以使用WordNet或LLM生成

    const expansions = []

    // 添加原始查询
    expansions.push(query)

    // 简单的同义词映射（示例）
    const synonyms = {
      '学习': ['学', '研究', '掌握'],
      '教程': ['指南', '文档', '手册'],
      'JavaScript': ['JS', 'ECMAScript'],
      'React': ['ReactJS'],
      'Vue': ['VueJS']
    }

    for (const [word, syns] of Object.entries(synonyms)) {
      if (query.includes(word)) {
        expansions.push(...syns.map(syn => query.replace(word, syn)))
      }
    }

    // 返回扩展后的查询（取前3个）
    return expansions.slice(0, 3).join(' ')
  }

  /**
   * 从缓存获取
   * @param {string} query - 查询
   * @returns {Object|null}
   * @private
   */
  getFromCache(query) {
    return this.cache.get(query) || null
  }

  /**
   * 添加到缓存（LRU）
   * @param {string} query - 查询
   * @param {Object} result - 结果
   * @private
   */
  addToCache(query, result) {
    // 如果缓存已满，删除最旧的
    if (this.cache.size >= this.config.cacheSize) {
      const oldestKey = this.cacheKeys.shift()
      this.cache.delete(oldestKey)
    }

    this.cache.set(query, result)
    this.cacheKeys.push(query)
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear()
    this.cacheKeys = []
    console.log('[HybridSearch] 缓存已清除')
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalSearches: this.stats.totalSearches,
      cacheHits: this.stats.cacheHits,
      cacheHitRate: this.stats.totalSearches > 0
        ? ((this.stats.cacheHits / this.stats.totalSearches) * 100).toFixed(2) + '%'
        : '0%',
      vectorSearches: this.stats.vectorSearches,
      bm25Searches: this.stats.bm25Searches,
      cacheSize: this.cache.size,
      maxCacheSize: this.config.cacheSize,
      hasBM25Index: !!this.bm25Index
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.clearCache()
    this.bm25Index = null
    this.isInitialized = false
    console.log('[HybridSearch] 资源已清理')
  }
}

// 创建单例
let hybridSearchInstance = null

/**
 * 获取混合检索实例
 * @param {Object} config - 配置
 * @returns {HybridSearch}
 */
export function getHybridSearch(config) {
  if (!hybridSearchInstance) {
    hybridSearchInstance = new HybridSearch(config)
  }
  return hybridSearchInstance
}

export default HybridSearch
