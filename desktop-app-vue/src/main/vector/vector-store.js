/**
 * 向量存储服务
 *
 * 使用ChromaDB进行向量存储和检索
 */

const { logger } = require("../utils/logger.js");
const { ChromaClient } = require("chromadb");
const EventEmitter = require("events");
const path = require("path");
const { app } = require("electron");
const fs = require("fs");

/**
 * 向量存储配置
 */
const DEFAULT_CONFIG = {
  // ChromaDB配置
  chromaUrl: "http://localhost:8000", // ChromaDB服务地址
  collectionName: "knowledge_base", // 集合名称

  // 向量参数
  embeddingDimension: 768, // 向量维度 (bge-small-zh-v1.5)
  distanceMetric: "cosine", // 距离度量: cosine, l2, ip

  // 检索参数
  topK: 5, // 返回Top-K结果
  similarityThreshold: 0.7, // 相似度阈值

  // 本地缓存
  enableCache: true, // 是否启用本地缓存
  cacheDir: null, // 缓存目录 (自动设置)
};

/**
 * 向量存储管理类
 */
class VectorStore extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };

    // 设置缓存目录
    if (!this.config.cacheDir) {
      const userDataPath = app.getPath("userData");
      this.config.cacheDir = path.join(userDataPath, "vector-cache");
    }

    this.client = null;
    this.collection = null;
    this.isInitialized = false;

    // 内存缓存
    this.memoryCache = new Map();
  }

  /**
   * 初始化向量存储
   */
  async initialize() {
    logger.info("[VectorStore] 初始化向量存储...");
    logger.info("[VectorStore] ChromaDB地址:", this.config.chromaUrl);

    try {
      // 确保缓存目录存在
      if (this.config.enableCache && !fs.existsSync(this.config.cacheDir)) {
        fs.mkdirSync(this.config.cacheDir, { recursive: true });
      }

      // 连接ChromaDB (使用新的host/port配置而不是废弃的path参数)
      const url = new URL(this.config.chromaUrl);
      this.client = new ChromaClient({
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 8000),
      });

      // 检查连接
      await this.checkConnection();

      // 获取或创建集合
      await this.getOrCreateCollection();

      this.isInitialized = true;
      logger.info("[VectorStore] 向量存储初始化成功");
      this.emit("initialized");

      return true;
    } catch (error) {
      logger.error("[VectorStore] 初始化失败:", error);

      // 如果ChromaDB未运行，使用内存模式
      logger.warn("[VectorStore] 切换到内存模式");
      this.isInitialized = false;
      this.emit("fallback-memory");

      return false;
    }
  }

  /**
   * 检查ChromaDB连接
   */
  async checkConnection() {
    try {
      const version = await this.client.version();
      logger.info("[VectorStore] ChromaDB版本:", version);
      return true;
    } catch (error) {
      throw new Error("无法连接到ChromaDB服务");
    }
  }

  /**
   * 获取或创建集合
   */
  async getOrCreateCollection() {
    try {
      // 尝试获取现有集合
      this.collection = await this.client.getCollection({
        name: this.config.collectionName,
      });

      logger.info("[VectorStore] 使用现有集合:", this.config.collectionName);
    } catch (error) {
      // 集合不存在，创建新集合
      logger.info("[VectorStore] 创建新集合:", this.config.collectionName);

      this.collection = await this.client.createCollection({
        name: this.config.collectionName,
        metadata: {
          "hnsw:space": this.config.distanceMetric,
          description: "ChainlessChain知识库向量存储",
        },
      });
    }

    // 获取集合统计
    const count = await this.collection.count();
    logger.info("[VectorStore] 集合中的向量数:", count);
  }

  /**
   * 添加向量
   * @param {Object} item - 知识库项
   * @param {Array} embedding - 嵌入向量
   */
  async addVector(item, embedding) {
    if (!this.isInitialized || !this.collection) {
      // 内存模式
      this.memoryCache.set(item.id, { item, embedding });
      return;
    }

    try {
      await this.collection.add({
        ids: [item.id],
        embeddings: [embedding],
        metadatas: [
          {
            title: item.title,
            type: item.type,
            created_at: item.created_at,
            updated_at: item.updated_at,
          },
        ],
        documents: [item.content || item.title],
      });

      logger.info(`[VectorStore] 添加向量: ${item.title}`);
      this.emit("vector-added", item.id);

      return true;
    } catch (error) {
      logger.error("[VectorStore] 添加向量失败:", error);
      throw error;
    }
  }

  /**
   * 批量添加向量
   * @param {Array} items - 知识库项数组
   * @param {Array} embeddings - 嵌入向量数组
   */
  async addVectorsBatch(items, embeddings) {
    if (!this.isInitialized || !this.collection) {
      // 内存模式
      items.forEach((item, index) => {
        this.memoryCache.set(item.id, { item, embedding: embeddings[index] });
      });
      return items.length;
    }

    try {
      const ids = items.map((item) => item.id);
      const metadatas = items.map((item) => ({
        title: item.title,
        type: item.type,
        created_at: item.created_at,
        updated_at: item.updated_at,
      }));
      const documents = items.map((item) => item.content || item.title);

      await this.collection.add({
        ids,
        embeddings,
        metadatas,
        documents,
      });

      logger.info(`[VectorStore] 批量添加 ${items.length} 个向量`);
      this.emit("vectors-added-batch", items.length);

      return items.length;
    } catch (error) {
      logger.error("[VectorStore] 批量添加向量失败:", error);
      throw error;
    }
  }

  /**
   * 更新向量
   * @param {string} id - 项目ID
   * @param {Array} embedding - 新的嵌入向量
   * @param {Object} metadata - 新的元数据
   */
  async updateVector(id, embedding, metadata) {
    if (!this.isInitialized || !this.collection) {
      // 内存模式
      if (this.memoryCache.has(id)) {
        const cached = this.memoryCache.get(id);
        cached.embedding = embedding;
        if (metadata) {
          Object.assign(cached.item, metadata);
        }
      }
      return;
    }

    try {
      await this.collection.update({
        ids: [id],
        embeddings: [embedding],
        metadatas: metadata ? [metadata] : undefined,
      });

      logger.info(`[VectorStore] 更新向量: ${id}`);
      this.emit("vector-updated", id);

      return true;
    } catch (error) {
      logger.error("[VectorStore] 更新向量失败:", error);
      throw error;
    }
  }

  /**
   * 删除向量
   * @param {string} id - 项目ID
   */
  async deleteVector(id) {
    if (!this.isInitialized || !this.collection) {
      // 内存模式
      this.memoryCache.delete(id);
      return;
    }

    try {
      await this.collection.delete({
        ids: [id],
      });

      logger.info(`[VectorStore] 删除向量: ${id}`);
      this.emit("vector-deleted", id);

      return true;
    } catch (error) {
      logger.error("[VectorStore] 删除向量失败:", error);
      throw error;
    }
  }

  /**
   * 搜索相似向量
   * @param {Array} queryEmbedding - 查询向量
   * @param {number} topK - 返回数量
   * @param {Object} filter - 过滤条件
   */
  async search(queryEmbedding, topK = null, filter = null) {
    topK = topK || this.config.topK;

    if (!this.isInitialized || !this.collection) {
      // 内存模式 - 简单的余弦相似度搜索
      return this.searchMemory(queryEmbedding, topK);
    }

    try {
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: filter,
      });

      // 格式化结果
      const formatted = [];
      if (results.ids && results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          const similarity = 1 - (results.distances[0][i] || 0); // 转换距离为相似度

          // 过滤低于阈值的结果
          if (similarity >= this.config.similarityThreshold) {
            formatted.push({
              id: results.ids[0][i],
              score: similarity,
              metadata: results.metadatas[0][i],
              document: results.documents[0][i],
            });
          }
        }
      }

      logger.info(`[VectorStore] 搜索返回 ${formatted.length} 个结果`);

      return formatted;
    } catch (error) {
      logger.error("[VectorStore] 搜索失败:", error);
      throw error;
    }
  }

  /**
   * 内存模式搜索
   * @param {Array} queryEmbedding - 查询向量
   * @param {number} topK - 返回数量
   */
  searchMemory(queryEmbedding, topK) {
    const results = [];

    for (const [id, data] of this.memoryCache) {
      const similarity = this.cosineSimilarity(queryEmbedding, data.embedding);

      if (similarity >= this.config.similarityThreshold) {
        results.push({
          id,
          score: similarity,
          metadata: {
            title: data.item.title,
            type: data.item.type,
          },
          document: data.item.content || data.item.title,
        });
      }
    }

    // 按相似度排序
    results.sort((a, b) => b.score - a.score);

    // 返回Top-K
    return results.slice(0, topK);
  }

  /**
   * 计算余弦相似度
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    if (!this.isInitialized || !this.collection) {
      return {
        mode: "memory",
        count: this.memoryCache.size,
        collectionName: this.config.collectionName,
      };
    }

    try {
      const count = await this.collection.count();

      return {
        mode: "chromadb",
        count,
        collectionName: this.config.collectionName,
        chromaUrl: this.config.chromaUrl,
      };
    } catch (error) {
      logger.error("[VectorStore] 获取统计失败:", error);
      return {
        mode: "error",
        error: error.message,
      };
    }
  }

  /**
   * 清空所有向量
   */
  async clear() {
    if (!this.isInitialized || !this.collection) {
      this.memoryCache.clear();
      return true;
    }

    try {
      // 删除集合并重新创建
      await this.client.deleteCollection({
        name: this.config.collectionName,
      });

      await this.getOrCreateCollection();

      logger.info("[VectorStore] 向量存储已清空");
      this.emit("cleared");

      return true;
    } catch (error) {
      logger.error("[VectorStore] 清空失败:", error);
      throw error;
    }
  }

  /**
   * 重建索引
   * @param {Array} items - 所有知识库项
   * @param {Function} embeddingFn - 嵌入函数
   */
  async rebuildIndex(items, embeddingFn) {
    logger.info(`[VectorStore] 开始重建索引，共 ${items.length} 项`);

    try {
      // 清空现有索引
      await this.clear();

      // 批量生成嵌入并添加
      const batchSize = 10;
      let processed = 0;

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        // 生成嵌入
        const texts = batch.map(
          (item) => `${item.title}\n${item.content || ""}`,
        );
        const embeddings = await Promise.all(
          texts.map((text) => embeddingFn(text)),
        );

        // 添加到向量存储
        await this.addVectorsBatch(batch, embeddings);

        processed += batch.length;
        this.emit("rebuild-progress", {
          processed,
          total: items.length,
          percentage: Math.round((processed / items.length) * 100),
        });

        logger.info(`[VectorStore] 重建进度: ${processed}/${items.length}`);
      }

      logger.info("[VectorStore] 索引重建完成");
      this.emit("rebuild-complete");

      return true;
    } catch (error) {
      logger.error("[VectorStore] 重建索引失败:", error);
      throw error;
    }
  }

  /**
   * 关闭连接
   */
  async close() {
    logger.info("[VectorStore] 关闭向量存储");

    this.client = null;
    this.collection = null;
    this.isInitialized = false;
    this.memoryCache.clear();

    this.emit("closed");
  }
}

module.exports = VectorStore;
