/**
 * 向量存储 (移动端版本)
 *
 * 使用内存索引 + IndexedDB持久化
 * 支持向量相似度搜索
 * 功能对齐桌面端的VectorStore
 */

import { db as database } from '../database.js'

/**
 * 向量存储类
 */
class VectorStore {
  constructor(config = {}) {
    this.config = {
      // 检索参数
      topK: config.topK || 10,
      similarityThreshold: config.similarityThreshold || 0.6,

      // 持久化
      enablePersistence: config.enablePersistence !== false,
      persistenceKey: config.persistenceKey || 'vector_store',

      // 性能
      enableIndexing: config.enableIndexing !== false,
      indexDimensions: config.indexDimensions || 384,

      ...config
    }

    // 内存索引
    this.vectors = new Map() // id -> { id, embedding, metadata }

    // 统计信息
    this.stats = {
      totalVectors: 0,
      totalQueries: 0,
      avgQueryTime: 0
    }

    this.isInitialized = false
  }

  /**
   * 初始化向量存储
   */
  async initialize() {
    console.log('[VectorStore] 初始化向量存储...')

    try {
      // 确保数据库表存在
      await this.ensureTable()

      // 从数据库加载向量
      if (this.config.enablePersistence) {
        await this.loadFromDatabase()
      }

      this.isInitialized = true
      console.log(`[VectorStore] ✅ 初始化成功，已加载 ${this.vectors.size} 个向量`)
      return true
    } catch (error) {
      console.error('[VectorStore] ❌ 初始化失败:', error)
      return false
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTable() {
    await database.exec(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // 创建索引
    await database.exec(`
      CREATE INDEX IF NOT EXISTS idx_vector_created
      ON vector_embeddings(created_at DESC)
    `)

    console.log('[VectorStore] 数据库表已就绪')
  }

  /**
   * 从数据库加载向量
   */
  async loadFromDatabase() {
    console.log('[VectorStore] 从数据库加载向量...')

    try {
      const rows = await database.exec(`
        SELECT id, embedding, metadata
        FROM vector_embeddings
        ORDER BY created_at DESC
      `)

      let loaded = 0
      for (const row of rows) {
        try {
          const embedding = JSON.parse(row.embedding)
          const metadata = row.metadata ? JSON.parse(row.metadata) : {}

          this.vectors.set(row.id, {
            id: row.id,
            embedding,
            metadata
          })

          loaded++
        } catch (e) {
          console.error(`[VectorStore] 加载向量失败: ${row.id}`, e)
        }
      }

      this.stats.totalVectors = loaded
      console.log(`[VectorStore] 已加载 ${loaded} 个向量`)
    } catch (error) {
      console.error('[VectorStore] 从数据库加载失败:', error)
    }
  }

  /**
   * 添加向量
   */
  async addVector(id, embedding, metadata = {}) {
    if (!id || !embedding || !Array.isArray(embedding)) {
      throw new Error('无效的向量数据')
    }

    // 添加到内存
    this.vectors.set(id, {
      id,
      embedding,
      metadata
    })

    // 持久化到数据库
    if (this.config.enablePersistence) {
      await this.saveToDatabase(id, embedding, metadata)
    }

    this.stats.totalVectors = this.vectors.size
  }

  /**
   * 批量添加向量
   */
  async addVectorsBatch(items, embeddings) {
    if (!items || !embeddings || items.length !== embeddings.length) {
      throw new Error('items和embeddings长度不匹配')
    }

    const promises = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const embedding = embeddings[i]

      if (!embedding) continue

      const metadata = {
        title: item.title,
        content: item.content?.substring(0, 200),
        type: item.type,
        tags: item.tags,
        created_at: item.created_at
      }

      promises.push(this.addVector(item.id, embedding, metadata))
    }

    await Promise.all(promises)
    console.log(`[VectorStore] 批量添加了 ${promises.length} 个向量`)
  }

  /**
   * 保存到数据库
   */
  async saveToDatabase(id, embedding, metadata) {
    const now = Date.now()

    await database.exec(`
      INSERT OR REPLACE INTO vector_embeddings (
        id, embedding, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      id,
      JSON.stringify(embedding),
      JSON.stringify(metadata),
      now,
      now
    ])
  }

  /**
   * 相似度搜索
   */
  async search(queryEmbedding, options = {}) {
    const startTime = Date.now()

    const topK = options.topK || this.config.topK
    const threshold = options.similarityThreshold || this.config.similarityThreshold

    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      throw new Error('无效的查询向量')
    }

    // 计算所有向量的相似度
    const similarities = []

    for (const [id, item] of this.vectors) {
      const similarity = this.cosineSimilarity(queryEmbedding, item.embedding)

      if (similarity >= threshold) {
        similarities.push({
          id: item.id,
          similarity,
          metadata: item.metadata
        })
      }
    }

    // 按相似度降序排序
    similarities.sort((a, b) => b.similarity - a.similarity)

    // 返回Top-K
    const results = similarities.slice(0, topK)

    // 更新统计
    const queryTime = Date.now() - startTime
    this.stats.totalQueries++
    this.stats.avgQueryTime = (this.stats.avgQueryTime * (this.stats.totalQueries - 1) + queryTime) / this.stats.totalQueries

    console.log(`[VectorStore] 检索完成: 找到 ${results.length} 个结果，耗时 ${queryTime}ms`)

    return results
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
   * 删除向量
   */
  async deleteVector(id) {
    this.vectors.delete(id)

    if (this.config.enablePersistence) {
      await database.exec(`
        DELETE FROM vector_embeddings WHERE id = ?
      `, [id])
    }

    this.stats.totalVectors = this.vectors.size
    console.log(`[VectorStore] 已删除向量: ${id}`)
  }

  /**
   * 清空所有向量
   */
  async clear() {
    this.vectors.clear()

    if (this.config.enablePersistence) {
      await database.exec('DELETE FROM vector_embeddings')
    }

    this.stats.totalVectors = 0
    console.log('[VectorStore] 已清空所有向量')
  }

  /**
   * 重建索引
   */
  async rebuildIndex() {
    console.log('[VectorStore] 重建索引...')
    // 简单实现：重新从数据库加载
    this.vectors.clear()
    await this.loadFromDatabase()
    console.log('[VectorStore] ✅ 索引重建完成')
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalVectors: this.stats.totalVectors,
      totalQueries: this.stats.totalQueries,
      avgQueryTime: Math.round(this.stats.avgQueryTime * 100) / 100,
      memoryUsage: this.vectors.size * 384 * 4, // 估算：384维 * 4字节
      config: this.config
    }
  }

  /**
   * 获取向量
   */
  getVector(id) {
    return this.vectors.get(id)
  }

  /**
   * 检查向量是否存在
   */
  hasVector(id) {
    return this.vectors.has(id)
  }

  /**
   * 获取所有向量ID
   */
  getAllIds() {
    return Array.from(this.vectors.keys())
  }
}

export default VectorStore
