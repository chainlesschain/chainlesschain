/**
 * Reranker (重排序器)
 *
 * 对检索结果进行二次排序，提升检索质量
 * 支持多种重排序策略
 *
 * 功能对齐桌面端
 */

/**
 * Reranker类
 */
class Reranker {
  constructor(config = {}) {
    this.config = {
      // 重排序方法: 'keyword' | 'hybrid' | 'llm'
      method: config.method || 'hybrid',

      // 参数
      topK: config.topK || 5,
      scoreThreshold: config.scoreThreshold || 0.3,

      // 权重（hybrid模式）
      vectorWeight: config.vectorWeight || 0.6,
      keywordWeight: config.keywordWeight || 0.4,

      // LLM配置（仅llm模式）
      llmEndpoint: config.llmEndpoint || null,

      ...config
    }

    this.enabled = config.enabled !== false
  }

  /**
   * 重排序
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 重排序后的文档
   */
  async rerank(query, documents, options = {}) {
    if (!this.enabled || !documents || documents.length === 0) {
      return documents
    }

    console.log(`[Reranker] 重排序 ${documents.length} 个文档，方法: ${this.config.method}`)

    const method = options.method || this.config.method

    try {
      let reranked

      switch (method) {
        case 'keyword':
          reranked = this.rerankByKeyword(query, documents)
          break

        case 'hybrid':
          reranked = this.rerankHybrid(query, documents)
          break

        case 'llm':
          reranked = await this.rerankByLLM(query, documents)
          break

        default:
          console.warn(`[Reranker] 未知的方法: ${method}，使用keyword`)
          reranked = this.rerankByKeyword(query, documents)
      }

      // 过滤低分文档
      const filtered = reranked.filter(doc =>
        doc.rerank_score >= this.config.scoreThreshold
      )

      // 返回Top-K
      const topK = options.topK || this.config.topK
      const result = filtered.slice(0, topK)

      console.log(`[Reranker] ✅ 重排序完成: ${documents.length} -> ${result.length}`)

      return result
    } catch (error) {
      console.error('[Reranker] 重排序失败:', error)
      return documents.slice(0, this.config.topK)
    }
  }

  /**
   * 基于关键词的重排序
   */
  rerankByKeyword(query, documents) {
    const queryTokens = this.tokenize(query.toLowerCase())
    const querySet = new Set(queryTokens)

    return documents.map(doc => {
      const text = `${doc.metadata?.title || ''} ${doc.metadata?.content || ''}`.toLowerCase()
      const docTokens = this.tokenize(text)

      // 计算关键词匹配分数
      let matchCount = 0
      let positionScore = 0

      for (let i = 0; i < docTokens.length; i++) {
        if (querySet.has(docTokens[i])) {
          matchCount++
          // 位置权重：越靠前的匹配权重越高
          positionScore += 1 / (i + 1)
        }
      }

      // 归一化分数
      const matchRatio = matchCount / queryTokens.length
      const normalizedPosition = positionScore / queryTokens.length

      // 综合分数
      const keywordScore = matchRatio * 0.7 + normalizedPosition * 0.3

      return {
        ...doc,
        rerank_score: keywordScore,
        match_count: matchCount
      }
    }).sort((a, b) => b.rerank_score - a.rerank_score)
  }

  /**
   * 混合重排序（向量相似度 + 关键词匹配）
   */
  rerankHybrid(query, documents) {
    // 先进行关键词重排序
    const keywordRanked = this.rerankByKeyword(query, documents)

    // 混合原始向量分数和关键词分数
    return keywordRanked.map(doc => {
      const vectorScore = doc.similarity || 0
      const keywordScore = doc.rerank_score || 0

      const hybridScore =
        vectorScore * this.config.vectorWeight +
        keywordScore * this.config.keywordWeight

      return {
        ...doc,
        rerank_score: hybridScore,
        vector_score: vectorScore,
        keyword_score: keywordScore
      }
    }).sort((a, b) => b.rerank_score - a.rerank_score)
  }

  /**
   * 基于LLM的重排序（云端API）
   */
  async rerankByLLM(query, documents) {
    if (!this.config.llmEndpoint) {
      console.warn('[Reranker] LLM端点未配置，降级到keyword')
      return this.rerankByKeyword(query, documents)
    }

    try {
      // 准备文档文本
      const docTexts = documents.map(doc =>
        `${doc.metadata?.title || ''}\n${doc.metadata?.content || ''}`
      )

      // 调用LLM API
      const response = await uni.request({
        url: this.config.llmEndpoint,
        method: 'POST',
        data: {
          query,
          documents: docTexts
        },
        timeout: 10000
      })

      if (response.statusCode !== 200) {
        throw new Error('LLM API请求失败')
      }

      const scores = response.data.scores

      // 合并分数
      return documents.map((doc, i) => ({
        ...doc,
        rerank_score: scores[i] || 0
      })).sort((a, b) => b.rerank_score - a.rerank_score)

    } catch (error) {
      console.error('[Reranker] LLM重排序失败:', error)
      return this.rerankByKeyword(query, documents)
    }
  }

  /**
   * 分词
   */
  tokenize(text) {
    return text
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0)
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config }
    console.log('[Reranker] 配置已更新:', this.config)
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled) {
    this.enabled = enabled
    console.log(`[Reranker] ${enabled ? '已启用' : '已禁用'}`)
  }
}

export default Reranker
