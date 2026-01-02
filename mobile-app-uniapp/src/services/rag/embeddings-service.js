/**
 * 嵌入向量服务 (移动端版本)
 *
 * 支持多种向量生成方式：
 * 1. transformers.js (H5环境，本地运行)
 * 2. 后端API (所有环境，云端生成)
 * 3. 简单TF-IDF (降级方案)
 *
 * 功能对齐桌面端
 */

/**
 * 嵌入向量服务类
 */
class EmbeddingsService {
  constructor(config = {}) {
    this.config = {
      // 向量生成模式: 'transformers' | 'api' | 'tfidf'
      mode: config.mode || 'auto',

      // transformers.js配置
      modelName: config.modelName || 'Xenova/all-MiniLM-L6-v2', // 轻量级384维模型

      // API配置
      apiEndpoint: config.apiEndpoint || 'http://localhost:8000/api/embeddings',

      // 缓存配置
      enableCache: config.enableCache !== false,
      maxCacheSize: config.maxCacheSize || 2000,
      cacheExpiry: config.cacheExpiry || 3600000, // 1小时

      ...config
    }

    // 缓存
    this.cache = new Map()
    this.cacheStats = {
      hits: 0,
      misses: 0,
      size: 0
    }

    // 运行时状态
    this.isInitialized = false
    this.currentMode = null
    this.transformer = null
    this.tokenizer = null

    // TF-IDF词汇表（降级方案）
    this.vocabulary = new Map()
    this.idf = new Map()
    this.docCount = 0
  }

  /**
   * 初始化服务
   */
  async initialize() {
    console.log('[EmbeddingsService] 初始化嵌入向量服务...')

    try {
      // 自动检测最佳模式
      if (this.config.mode === 'auto') {
        this.currentMode = await this.detectBestMode()
      } else {
        this.currentMode = this.config.mode
      }

      console.log(`[EmbeddingsService] 使用模式: ${this.currentMode}`)

      // 根据模式初始化
      switch (this.currentMode) {
        case 'transformers':
          await this.initializeTransformers()
          break

        case 'api':
          await this.testAPIConnection()
          break

        case 'tfidf':
          this.initializeTFIDF()
          break

        default:
          throw new Error(`未知的模式: ${this.currentMode}`)
      }

      this.isInitialized = true
      console.log('[EmbeddingsService] ✅ 初始化成功')
      return true
    } catch (error) {
      console.error('[EmbeddingsService] ❌ 初始化失败:', error)

      // 降级到TF-IDF
      if (this.currentMode !== 'tfidf') {
        console.log('[EmbeddingsService] 降级到TF-IDF模式')
        this.currentMode = 'tfidf'
        this.initializeTFIDF()
        this.isInitialized = true
        return true
      }

      return false
    }
  }

  /**
   * 检测最佳模式
   */
  async detectBestMode() {
    // #ifdef H5
    // H5环境优先尝试transformers.js
    try {
      if (typeof window !== 'undefined' && window.transformers) {
        return 'transformers'
      }
    } catch (e) {
      console.log('[EmbeddingsService] transformers.js不可用')
    }
    // #endif

    // 尝试API模式
    try {
      const response = await uni.request({
        url: this.config.apiEndpoint,
        method: 'POST',
        data: { text: 'test' },
        timeout: 3000
      })

      if (response.statusCode === 200) {
        return 'api'
      }
    } catch (e) {
      console.log('[EmbeddingsService] API不可用')
    }

    // 降级到TF-IDF
    return 'tfidf'
  }

  /**
   * 初始化transformers.js
   */
  async initializeTransformers() {
    console.log('[EmbeddingsService] 加载transformers.js模型...')

    // #ifdef H5
    if (typeof window === 'undefined' || !window.transformers) {
      throw new Error('transformers.js不可用')
    }

    const { pipeline } = window.transformers

    // 使用feature-extraction pipeline
    this.transformer = await pipeline(
      'feature-extraction',
      this.config.modelName,
      {
        quantized: true, // 使用量化模型减小体积
        progress_callback: (progress) => {
          console.log(`[EmbeddingsService] 模型加载: ${Math.round(progress.progress * 100)}%`)
        }
      }
    )

    console.log('[EmbeddingsService] ✅ transformers.js模型已加载')
    // #endif

    // #ifndef H5
    throw new Error('transformers.js仅支持H5环境')
    // #endif
  }

  /**
   * 测试API连接
   */
  async testAPIConnection() {
    console.log('[EmbeddingsService] 测试API连接...')

    const response = await uni.request({
      url: this.config.apiEndpoint,
      method: 'POST',
      data: { text: 'test connection' },
      timeout: 5000
    })

    if (response.statusCode !== 200) {
      throw new Error('API连接失败')
    }

    console.log('[EmbeddingsService] ✅ API连接正常')
  }

  /**
   * 初始化TF-IDF
   */
  initializeTFIDF() {
    console.log('[EmbeddingsService] 初始化TF-IDF向量化...')
    // TF-IDF无需特别初始化，运行时计算
    console.log('[EmbeddingsService] ✅ TF-IDF已就绪')
  }

  /**
   * 生成文本嵌入向量
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 向量数组
   */
  async generateEmbedding(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('文本内容不能为空')
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(text)
    if (this.config.enableCache && !options.skipCache) {
      const cached = this.getFromCache(cacheKey)
      if (cached) {
        this.cacheStats.hits++
        return cached
      }
    }

    this.cacheStats.misses++

    try {
      let embedding

      // 根据模式生成向量
      switch (this.currentMode) {
        case 'transformers':
          embedding = await this.generateWithTransformers(text)
          break

        case 'api':
          embedding = await this.generateWithAPI(text)
          break

        case 'tfidf':
          embedding = this.generateWithTFIDF(text)
          break

        default:
          throw new Error(`未知的模式: ${this.currentMode}`)
      }

      // 缓存结果
      if (this.config.enableCache) {
        this.addToCache(cacheKey, embedding)
      }

      return embedding
    } catch (error) {
      console.error('[EmbeddingsService] 生成向量失败:', error)

      // 降级到TF-IDF
      if (this.currentMode !== 'tfidf') {
        console.log('[EmbeddingsService] 降级到TF-IDF')
        return this.generateWithTFIDF(text)
      }

      throw error
    }
  }

  /**
   * 使用transformers.js生成向量
   */
  async generateWithTransformers(text) {
    if (!this.transformer) {
      throw new Error('transformers.js未初始化')
    }

    // 生成向量（返回tensor）
    const output = await this.transformer(text, {
      pooling: 'mean', // 平均池化
      normalize: true  // 归一化
    })

    // 转换为数组
    const embedding = Array.from(output.data)

    console.log(`[EmbeddingsService] transformers.js生成向量: ${embedding.length}维`)
    return embedding
  }

  /**
   * 使用API生成向量
   */
  async generateWithAPI(text) {
    const response = await uni.request({
      url: this.config.apiEndpoint,
      method: 'POST',
      data: { text },
      timeout: 10000
    })

    if (response.statusCode !== 200) {
      throw new Error('API请求失败')
    }

    const embedding = response.data.embedding || response.data.data

    if (!Array.isArray(embedding)) {
      throw new Error('API返回格式错误')
    }

    console.log(`[EmbeddingsService] API生成向量: ${embedding.length}维`)
    return embedding
  }

  /**
   * 使用TF-IDF生成向量 (降级方案)
   */
  generateWithTFIDF(text) {
    // 分词（简单空格分割）
    const tokens = this.tokenize(text)

    // 计算TF（词频）
    const tf = new Map()
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1)
    }

    // 归一化TF
    const maxFreq = Math.max(...tf.values())
    for (const [token, freq] of tf) {
      tf.set(token, freq / maxFreq)
    }

    // 构建稀疏向量（仅保留有值的维度）
    const sparseVector = {}
    for (const [token, tfValue] of tf) {
      const idfValue = this.idf.get(token) || 0
      sparseVector[token] = tfValue * idfValue
    }

    // 转换为密集向量（固定384维，与transformers模型对齐）
    const embedding = this.sparseToDense(sparseVector, 384)

    console.log(`[EmbeddingsService] TF-IDF生成向量: ${embedding.length}维`)
    return embedding
  }

  /**
   * 批量生成嵌入向量
   */
  async generateEmbeddings(texts, options = {}) {
    const embeddings = []

    for (const text of texts) {
      try {
        const embedding = await this.generateEmbedding(text, options)
        embeddings.push(embedding)
      } catch (error) {
        console.error('[EmbeddingsService] 批量生成失败:', error)
        embeddings.push(null)
      }
    }

    return embeddings
  }

  /**
   * 计算余弦相似度
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
      return 0
    }

    let dotProduct = 0
    let norm1 = 0
    let norm2 = 0

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i]
      norm1 += vec1[i] * vec1[i]
      norm2 += vec2[i] * vec2[i]
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2)
    return denominator === 0 ? 0 : dotProduct / denominator
  }

  /**
   * 更新IDF统计（用于TF-IDF）
   */
  updateIDF(documents) {
    this.docCount = documents.length

    // 统计每个词出现的文档数
    const docFreq = new Map()

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc))
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1)
      }
    }

    // 计算IDF
    for (const [token, freq] of docFreq) {
      this.idf.set(token, Math.log(this.docCount / freq))
    }

    console.log(`[EmbeddingsService] IDF更新: ${this.idf.size}个词`)
  }

  /**
   * 分词
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ') // 保留中英文和空格
      .split(/\s+/)
      .filter(token => token.length > 0)
  }

  /**
   * 稀疏向量转密集向量
   */
  sparseToDense(sparseVector, dimensions) {
    const dense = new Array(dimensions).fill(0)

    // 使用哈希函数将token映射到固定维度
    for (const [token, value] of Object.entries(sparseVector)) {
      const hash = this.hashString(token)
      const index = hash % dimensions
      dense[index] += value
    }

    // 归一化
    const norm = Math.sqrt(dense.reduce((sum, v) => sum + v * v, 0))
    if (norm > 0) {
      for (let i = 0; i < dense.length; i++) {
        dense[i] /= norm
      }
    }

    return dense
  }

  /**
   * 字符串哈希函数
   */
  hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转换为32位整数
    }
    return Math.abs(hash)
  }

  /**
   * 缓存相关
   */
  getCacheKey(text) {
    // 简单哈希作为缓存键
    return `emb_${this.hashString(text)}`
  }

  getFromCache(key) {
    const item = this.cache.get(key)
    if (!item) return null

    // 检查是否过期
    if (Date.now() - item.timestamp > this.config.cacheExpiry) {
      this.cache.delete(key)
      return null
    }

    return item.value
  }

  addToCache(key, value) {
    // 限制缓存大小
    if (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    })

    this.cacheStats.size = this.cache.size
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear()
    this.cacheStats = {
      hits: 0,
      misses: 0,
      size: 0
    }
    console.log('[EmbeddingsService] 缓存已清除')
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      mode: this.currentMode,
      isInitialized: this.isInitialized,
      cache: {
        ...this.cacheStats,
        hitRate: this.cacheStats.hits + this.cacheStats.misses > 0
          ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(2) + '%'
          : '0%'
      },
      tfidf: {
        vocabulary: this.vocabulary.size,
        docCount: this.docCount
      }
    }
  }
}

export default EmbeddingsService
