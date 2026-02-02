/**
 * BM25Search - BM25 全文搜索引擎
 *
 * 基于 Okapi BM25 算法实现关键词匹配搜索
 * 用于与 Vector Search 结合，提升混合搜索的召回率
 *
 * BM25 算法:
 * score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgdl))
 *
 * @module rag/bm25-search
 * @version 0.1.0
 * @since 2026-02-01
 */

const { logger } = require("../utils/logger.js");
const natural = require("natural");

/**
 * BM25Search 类
 */
class BM25Search {
  /**
   * 创建 BM25 搜索引擎
   * @param {Object} options - 配置选项
   * @param {number} [options.k1=1.5] - BM25 k1 参数 (词频饱和度)
   * @param {number} [options.b=0.75] - BM25 b 参数 (文档长度归一化)
   * @param {string} [options.language='zh'] - 语言 ('zh' 或 'en')
   */
  constructor(options = {}) {
    this.k1 = options.k1 || 1.5;
    this.b = options.b || 0.75;
    this.language = options.language || "zh";

    // TF-IDF 实例
    this.tfidf = new natural.TfIdf();

    // 文档列表
    this.documents = [];

    // 文档元数据
    this.docMetadata = new Map();

    // 平均文档长度
    this.avgDocLength = 0;

    // 文档长度列表
    this.docLengths = [];

    // 分词器
    this.tokenizer = this.createTokenizer();

    logger.info("[BM25Search] 初始化完成", {
      k1: this.k1,
      b: this.b,
      language: this.language,
    });
  }

  /**
   * 创建分词器
   */
  createTokenizer() {
    if (this.language === "zh") {
      // 中文分词（简单实现：按字符和标点分割）
      return (text) => {
        // 移除标点和特殊字符
        const cleaned = text.replace(/[，。！？；：""''（）《》、\s]+/g, " ");
        // 分割为单字和词组
        const chars = cleaned.split("").filter((c) => c.trim());
        const words = cleaned
          .split(/\s+/)
          .filter((w) => w.trim() && w.length > 1);
        return [...new Set([...chars, ...words])];
      };
    } else {
      // 英文分词
      const tokenizer = new natural.WordTokenizer();
      return (text) => {
        return tokenizer.tokenize(text.toLowerCase());
      };
    }
  }

  /**
   * 索引文档
   * @param {Array<Object>} documents - 文档列表
   * @param {string} documents[].id - 文档 ID
   * @param {string} documents[].content - 文档内容
   * @param {Object} [documents[].metadata] - 文档元数据
   */
  indexDocuments(documents) {
    logger.info("[BM25Search] 开始索引文档:", documents.length);

    // 清空现有索引
    this.tfidf = new natural.TfIdf();
    this.documents = [];
    this.docMetadata.clear();
    this.docLengths = [];

    // 添加文档到 TF-IDF
    documents.forEach((doc, idx) => {
      const tokens = this.tokenizer(doc.content);
      this.tfidf.addDocument(tokens);

      this.documents.push(doc);
      this.docMetadata.set(doc.id, {
        index: idx,
        metadata: doc.metadata || {},
      });
      this.docLengths.push(tokens.length);
    });

    // 计算平均文档长度
    this.avgDocLength =
      this.docLengths.reduce((sum, len) => sum + len, 0) /
        this.docLengths.length || 1;

    logger.info("[BM25Search] 索引完成", {
      文档数: this.documents.length,
      平均长度: Math.round(this.avgDocLength),
    });
  }

  /**
   * 搜索文档
   * @param {string} query - 查询字符串
   * @param {Object} options - 搜索选项
   * @param {number} [options.limit=10] - 返回结果数量
   * @param {number} [options.threshold=0] - 最低分数阈值
   * @returns {Array<Object>} 搜索结果
   */
  search(query, options = {}) {
    const limit = options.limit || 10;
    const threshold = options.threshold || 0;

    if (this.documents.length === 0) {
      logger.warn("[BM25Search] 索引为空，无法搜索");
      return [];
    }

    // 分词
    const queryTokens = this.tokenizer(query);

    if (queryTokens.length === 0) {
      logger.warn("[BM25Search] 查询分词为空");
      return [];
    }

    // 计算 BM25 分数
    const results = [];

    this.documents.forEach((doc, docIdx) => {
      const score = this.calculateBM25Score(queryTokens, docIdx);

      if (score > threshold) {
        results.push({
          document: doc,
          score: score,
          source: "bm25",
          metadata: this.docMetadata.get(doc.id)?.metadata || {},
        });
      }
    });

    // 降序排序
    results.sort((a, b) => b.score - a.score);

    // 返回 top-k
    return results.slice(0, limit);
  }

  /**
   * 计算 BM25 分数
   * @param {Array<string>} queryTokens - 查询词列表
   * @param {number} docIdx - 文档索引
   * @returns {number} BM25 分数
   */
  calculateBM25Score(queryTokens, docIdx) {
    const N = this.documents.length;
    const docLength = this.docLengths[docIdx];
    const avgDocLength = this.avgDocLength;

    let score = 0;

    queryTokens.forEach((term) => {
      // 获取词频 (TF)
      const tf = this.getTermFrequency(term, docIdx);

      // 获取逆文档频率 (IDF)
      const df = this.getDocumentFrequency(term);
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      // BM25 公式
      const numerator = tf * (this.k1 + 1);
      const denominator =
        tf + this.k1 * (1 - this.b + (this.b * docLength) / avgDocLength);

      score += idf * (numerator / denominator);
    });

    return score;
  }

  /**
   * 获取词频 (TF)
   * @param {string} term - 词项
   * @param {number} docIdx - 文档索引
   * @returns {number} 词频
   */
  getTermFrequency(term, docIdx) {
    const doc = this.documents[docIdx];
    const tokens = this.tokenizer(doc.content);
    return tokens.filter((t) => t === term).length;
  }

  /**
   * 获取文档频率 (DF)
   * @param {string} term - 词项
   * @returns {number} 包含该词的文档数
   */
  getDocumentFrequency(term) {
    let count = 0;

    this.documents.forEach((doc) => {
      const tokens = this.tokenizer(doc.content);
      if (tokens.includes(term)) {
        count++;
      }
    });

    return count;
  }

  /**
   * 添加单个文档到索引
   * @param {Object} document - 文档对象
   */
  addDocument(document) {
    const tokens = this.tokenizer(document.content);
    this.tfidf.addDocument(tokens);

    const idx = this.documents.length;
    this.documents.push(document);
    this.docMetadata.set(document.id, {
      index: idx,
      metadata: document.metadata || {},
    });
    this.docLengths.push(tokens.length);

    // 重新计算平均长度
    this.avgDocLength =
      this.docLengths.reduce((sum, len) => sum + len, 0) /
      this.docLengths.length;

    logger.info("[BM25Search] 添加文档:", document.id);
  }

  /**
   * 移除文档
   * @param {string} documentId - 文档 ID
   */
  removeDocument(documentId) {
    const meta = this.docMetadata.get(documentId);
    if (!meta) {
      logger.warn("[BM25Search] 文档不存在:", documentId);
      return;
    }

    const idx = meta.index;

    // 从数组中移除
    this.documents.splice(idx, 1);
    this.docLengths.splice(idx, 1);
    this.docMetadata.delete(documentId);

    // 重建索引（因为 natural 的 TfIdf 不支持删除）
    const remainingDocs = [...this.documents];
    this.indexDocuments(remainingDocs);

    logger.info("[BM25Search] 移除文档:", documentId);
  }

  /**
   * 清空索引
   */
  clear() {
    this.tfidf = new natural.TfIdf();
    this.documents = [];
    this.docMetadata.clear();
    this.docLengths = [];
    this.avgDocLength = 0;

    logger.info("[BM25Search] 索引已清空");
  }

  /**
   * 获取索引统计
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      documentCount: this.documents.length,
      avgDocLength: Math.round(this.avgDocLength),
      k1: this.k1,
      b: this.b,
      language: this.language,
    };
  }
}

module.exports = {
  BM25Search,
};
