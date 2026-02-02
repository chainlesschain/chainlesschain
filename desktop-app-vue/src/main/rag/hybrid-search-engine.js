/**
 * HybridSearchEngine - 混合搜索引擎
 *
 * 结合 Vector Search (语义相似度) 和 BM25 Search (关键词匹配)
 * 使用 Reciprocal Rank Fusion (RRF) 算法融合结果
 *
 * 参考: Clawdbot Memory System
 * https://docs.openclaw.ai/concepts/memory
 *
 * @module rag/hybrid-search-engine
 * @version 0.1.0
 * @since 2026-02-01
 */

const { logger } = require("../utils/logger.js");
const { BM25Search } = require("./bm25-search");

/**
 * HybridSearchEngine 类
 */
class HybridSearchEngine {
  /**
   * 创建混合搜索引擎
   * @param {Object} options - 配置选项
   * @param {Object} options.ragManager - RAG 管理器实例 (提供 Vector Search)
   * @param {number} [options.vectorWeight=0.6] - Vector Search 权重
   * @param {number} [options.textWeight=0.4] - BM25 Search 权重
   * @param {number} [options.rrfK=60] - RRF 参数 k
   * @param {number} [options.bm25K1=1.5] - BM25 k1 参数
   * @param {number} [options.bm25B=0.75] - BM25 b 参数
   * @param {string} [options.language='zh'] - 语言
   */
  constructor(options = {}) {
    if (!options.ragManager) {
      throw new Error("[HybridSearchEngine] ragManager 参数是必需的");
    }

    this.ragManager = options.ragManager;
    this.vectorWeight = options.vectorWeight || 0.6;
    this.textWeight = options.textWeight || 0.4;
    this.rrfK = options.rrfK || 60;

    // 创建 BM25 搜索引擎
    this.bm25Search = new BM25Search({
      k1: options.bm25K1 || 1.5,
      b: options.bm25B || 0.75,
      language: options.language || "zh",
    });

    // 文档缓存
    this.documents = [];

    logger.info("[HybridSearchEngine] 初始化完成", {
      vectorWeight: this.vectorWeight,
      textWeight: this.textWeight,
      rrfK: this.rrfK,
    });
  }

  /**
   * 索引文档
   * @param {Array<Object>} documents - 文档列表
   * @param {string} documents[].id - 文档 ID
   * @param {string} documents[].content - 文档内容
   * @param {Object} [documents[].metadata] - 文档元数据
   */
  async indexDocuments(documents) {
    logger.info("[HybridSearchEngine] 开始索引文档:", documents.length);

    // 缓存文档
    this.documents = documents;

    // BM25 索引
    this.bm25Search.indexDocuments(documents);

    // Vector 索引（通过 RAG Manager）
    // 注意：RAG Manager 应该已经有自己的索引机制
    // 这里我们假设文档已经在 RAG Manager 中索引

    logger.info("[HybridSearchEngine] 索引完成");
  }

  /**
   * 混合搜索
   * @param {string} query - 查询字符串
   * @param {Object} options - 搜索选项
   * @param {number} [options.limit=10] - 返回结果数量
   * @param {number} [options.vectorLimit=20] - Vector Search 返回数量
   * @param {number} [options.bm25Limit=20] - BM25 Search 返回数量
   * @param {number} [options.threshold=0] - 最低分数阈值
   * @param {boolean} [options.enableVector=true] - 启用 Vector Search
   * @param {boolean} [options.enableBM25=true] - 启用 BM25 Search
   * @returns {Promise<Array<Object>>} 搜索结果
   */
  async search(query, options = {}) {
    const limit = options.limit || 10;
    const vectorLimit = options.vectorLimit || 20;
    const bm25Limit = options.bm25Limit || 20;
    const threshold = options.threshold || 0;
    const enableVector = options.enableVector !== false;
    const enableBM25 = options.enableBM25 !== false;

    logger.info("[HybridSearchEngine] 执行混合搜索:", query);

    const startTime = Date.now();

    try {
      // 并行执行 Vector Search 和 BM25 Search
      const [vectorResults, bm25Results] = await Promise.all([
        enableVector
          ? this.vectorSearch(query, vectorLimit)
          : Promise.resolve([]),
        enableBM25
          ? this.bm25Search.search(query, { limit: bm25Limit })
          : Promise.resolve([]),
      ]);

      logger.info("[HybridSearchEngine] 搜索结果:", {
        vector: vectorResults.length,
        bm25: bm25Results.length,
      });

      // RRF 融合
      const fusedResults = this.fusionRank(vectorResults, bm25Results, {
        k: this.rrfK,
        vectorWeight: this.vectorWeight,
        textWeight: this.textWeight,
      });

      // 过滤低分结果
      const filteredResults = fusedResults.filter((r) => r.score > threshold);

      // 返回 top-k
      const finalResults = filteredResults.slice(0, limit);

      const elapsed = Date.now() - startTime;
      logger.info("[HybridSearchEngine] 搜索完成", {
        耗时: `${elapsed}ms`,
        结果数: finalResults.length,
      });

      return finalResults;
    } catch (error) {
      logger.error("[HybridSearchEngine] 搜索失败:", error);
      throw error;
    }
  }

  /**
   * Vector Search (通过 RAG Manager)
   * @param {string} query - 查询字符串
   * @param {number} limit - 返回数量
   * @returns {Promise<Array<Object>>} Vector 搜索结果
   */
  async vectorSearch(query, limit) {
    try {
      // 调用 RAG Manager 的搜索功能
      // 注意：这里假设 RAG Manager 有 search 方法
      // 实际实现需要根据 RAG Manager 的 API 调整

      const results = await this.ragManager.search({
        query,
        limit,
        threshold: 0.5, // 可配置
      });

      // 转换为统一格式
      return results.map((result) => ({
        document: {
          id: result.id || result.noteId,
          content: result.content,
          metadata: result.metadata || {},
        },
        score: result.score || result.similarity,
        source: "vector",
      }));
    } catch (error) {
      logger.error("[HybridSearchEngine] Vector Search 失败:", error);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) 算法
   * @param {Array<Object>} vectorResults - Vector 搜索结果
   * @param {Array<Object>} bm25Results - BM25 搜索结果
   * @param {Object} options - 融合选项
   * @param {number} options.k - RRF 参数 k
   * @param {number} options.vectorWeight - Vector 权重
   * @param {number} options.textWeight - BM25 权重
   * @returns {Array<Object>} 融合后的结果
   */
  fusionRank(vectorResults, bm25Results, options) {
    const { k, vectorWeight, textWeight } = options;

    // 构建文档 ID → 分数映射
    const scoreMap = new Map();
    const docMap = new Map();

    // Vector Search 分数
    vectorResults.forEach((result, rank) => {
      const docId = result.document.id;
      const score = vectorWeight / (k + rank + 1);

      scoreMap.set(docId, (scoreMap.get(docId) || 0) + score);
      docMap.set(docId, result.document);
    });

    // BM25 Search 分数
    bm25Results.forEach((result, rank) => {
      const docId = result.document.id;
      const score = textWeight / (k + rank + 1);

      scoreMap.set(docId, (scoreMap.get(docId) || 0) + score);

      // 如果 Vector 没有该文档，添加到 docMap
      if (!docMap.has(docId)) {
        docMap.set(docId, result.document);
      }
    });

    // 排序并返回
    const mergedResults = Array.from(scoreMap.entries())
      .map(([docId, score]) => ({
        document: docMap.get(docId),
        score: score,
        source: "hybrid",
      }))
      .sort((a, b) => b.score - a.score);

    return mergedResults;
  }

  /**
   * 添加单个文档
   * @param {Object} document - 文档对象
   */
  addDocument(document) {
    this.documents.push(document);
    this.bm25Search.addDocument(document);
    logger.info("[HybridSearchEngine] 添加文档:", document.id);
  }

  /**
   * 移除文档
   * @param {string} documentId - 文档 ID
   */
  removeDocument(documentId) {
    this.documents = this.documents.filter((doc) => doc.id !== documentId);
    this.bm25Search.removeDocument(documentId);
    logger.info("[HybridSearchEngine] 移除文档:", documentId);
  }

  /**
   * 清空索引
   */
  clear() {
    this.documents = [];
    this.bm25Search.clear();
    logger.info("[HybridSearchEngine] 索引已清空");
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      documentCount: this.documents.length,
      vectorWeight: this.vectorWeight,
      textWeight: this.textWeight,
      rrfK: this.rrfK,
      bm25Stats: this.bm25Search.getStats(),
    };
  }

  /**
   * 更新权重
   * @param {number} vectorWeight - Vector 权重
   * @param {number} textWeight - BM25 权重
   */
  updateWeights(vectorWeight, textWeight) {
    this.vectorWeight = vectorWeight;
    this.textWeight = textWeight;

    logger.info("[HybridSearchEngine] 权重已更新", {
      vectorWeight,
      textWeight,
    });
  }
}

module.exports = {
  HybridSearchEngine,
};
