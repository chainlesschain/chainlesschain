/**
 * BGE Reranker 客户端
 *
 * 支持 BAAI/bge-reranker-base 和 bge-reranker-large 模型
 * 用于对 RAG 检索结果进行高质量重排序
 *
 * @module bge-reranker-client
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');
const axios = require('axios');
const { EventEmitter } = require('events');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:8002/rerank',
  modelName: 'BAAI/bge-reranker-base',
  batchSize: 32,
  timeout: 30000,
  maxRetries: 2,
  retryDelay: 1000,
};

/**
 * BGE Reranker 客户端类
 */
class BGERerankerClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.client = axios.create({
      baseURL: this.config.serverUrl.replace('/rerank', ''),
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 统计数据
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalDocuments: 0,
      totalDuration: 0,
    };

    logger.info(`[BGEReranker] 初始化完成，服务地址: ${this.config.serverUrl}`);
  }

  /**
   * 检查服务状态
   * @returns {Promise<Object>} 服务状态
   */
  async checkStatus() {
    try {
      const response = await this.client.get('/health', {
        timeout: 5000,
      });

      return {
        available: true,
        model: this.config.modelName,
        serverUrl: this.config.serverUrl,
        ...response.data,
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        model: this.config.modelName,
        serverUrl: this.config.serverUrl,
      };
    }
  }

  /**
   * 重排序文档
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 重排序后的文档列表
   */
  async rerank(query, documents, options = {}) {
    const startTime = Date.now();
    const topK = options.topK || documents.length;

    this.stats.totalCalls++;

    try {
      this.emit('rerank-start', {
        query,
        documentCount: documents.length,
        topK,
      });

      // 准备请求数据
      const requestData = {
        query,
        passages: documents.map((doc, index) => ({
          id: doc.id || `doc_${index}`,
          text: this._extractText(doc),
          metadata: {
            originalIndex: index,
            originalScore: doc.score || 0,
          },
        })),
        top_k: topK,
        model: options.model || this.config.modelName,
        normalize: options.normalize !== false,
      };

      // 分批处理（如果文档数量过多）
      let results;
      if (documents.length > this.config.batchSize) {
        results = await this._rerankBatch(requestData, options);
      } else {
        results = await this._rerankSingle(requestData, options);
      }

      // 映射回原始文档
      const rerankedDocs = results.map(item => {
        const originalDoc = documents[item.metadata?.originalIndex] || documents.find(d => d.id === item.id);
        return {
          ...originalDoc,
          rerankScore: item.score,
          bgeScore: item.score,
          originalScore: item.metadata?.originalScore || originalDoc?.score || 0,
          score: item.score, // 使用 BGE 分数作为最终分数
        };
      });

      // 按分数排序
      rerankedDocs.sort((a, b) => b.rerankScore - a.rerankScore);

      const duration = Date.now() - startTime;
      this.stats.successfulCalls++;
      this.stats.totalDocuments += documents.length;
      this.stats.totalDuration += duration;

      this.emit('rerank-complete', {
        query,
        originalCount: documents.length,
        resultCount: rerankedDocs.length,
        duration,
      });

      logger.info(`[BGEReranker] 重排序完成: ${documents.length} -> ${rerankedDocs.length} 文档, 耗时 ${duration}ms`);

      return rerankedDocs.slice(0, topK);
    } catch (error) {
      this.stats.failedCalls++;
      logger.error('[BGEReranker] 重排序失败:', error);
      this.emit('rerank-error', { query, error });
      throw error;
    }
  }

  /**
   * 单次重排序请求
   * @private
   */
  async _rerankSingle(requestData, options) {
    let lastError;

    for (let retry = 0; retry <= this.config.maxRetries; retry++) {
      try {
        const response = await this.client.post('/rerank', requestData);

        if (response.data && response.data.results) {
          return response.data.results;
        }

        throw new Error('无效的响应格式');
      } catch (error) {
        lastError = error;

        if (retry < this.config.maxRetries) {
          logger.warn(`[BGEReranker] 重试 ${retry + 1}/${this.config.maxRetries}...`);
          await this._sleep(this.config.retryDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * 批量重排序（大数据集）
   * @private
   */
  async _rerankBatch(requestData, options) {
    const { passages, query, top_k, model, normalize } = requestData;
    const batchSize = this.config.batchSize;
    const allResults = [];

    // 分批处理
    for (let i = 0; i < passages.length; i += batchSize) {
      const batchPassages = passages.slice(i, i + batchSize);

      const batchRequest = {
        query,
        passages: batchPassages,
        top_k: Math.min(top_k, batchPassages.length),
        model,
        normalize,
      };

      const batchResults = await this._rerankSingle(batchRequest, options);
      allResults.push(...batchResults);
    }

    // 合并所有批次结果，再次排序
    allResults.sort((a, b) => b.score - a.score);

    return allResults.slice(0, top_k);
  }

  /**
   * 计算混合分数（BGE + 向量相似度）
   * @param {Array} documents - 已有 BGE 分数的文档列表
   * @param {Object} weights - 权重配置
   * @returns {Array} 带混合分数的文档列表
   */
  calculateHybridScore(documents, weights = { bge: 0.6, vector: 0.4 }) {
    return documents.map(doc => {
      const bgeScore = doc.bgeScore || doc.rerankScore || 0;
      const vectorScore = doc.originalScore || 0;

      // 归一化分数到 0-1 范围
      const normalizedBge = Math.min(Math.max(bgeScore, 0), 1);
      const normalizedVector = Math.min(Math.max(vectorScore, 0), 1);

      // 计算混合分数
      const hybridScore = normalizedBge * weights.bge + normalizedVector * weights.vector;

      return {
        ...doc,
        hybridScore,
        score: hybridScore,
        scoreBreakdown: {
          bge: normalizedBge,
          vector: normalizedVector,
          weights,
        },
      };
    }).sort((a, b) => b.hybridScore - a.hybridScore);
  }

  /**
   * 从文档中提取文本
   * @private
   */
  _extractText(doc) {
    if (typeof doc === 'string') {
      return doc;
    }

    // 优先使用 content，然后是 text，最后是 title
    return doc.content || doc.text || doc.title || JSON.stringify(doc);
  }

  /**
   * 睡眠函数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取统计数据
   * @returns {Object} 统计数据
   */
  getStats() {
    const avgDuration = this.stats.successfulCalls > 0
      ? this.stats.totalDuration / this.stats.successfulCalls
      : 0;

    return {
      ...this.stats,
      averageDuration: avgDuration,
      successRate: this.stats.totalCalls > 0
        ? (this.stats.successfulCalls / this.stats.totalCalls * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * 更新配置
   * @param {Object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    if (newConfig.serverUrl) {
      this.client = axios.create({
        baseURL: this.config.serverUrl.replace('/rerank', ''),
        timeout: this.config.timeout,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.info('[BGEReranker] 配置已更新');
  }

  /**
   * 重置统计数据
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalDocuments: 0,
      totalDuration: 0,
    };
    logger.info('[BGEReranker] 统计数据已重置');
  }
}

// 单例实例
let bgeRerankerInstance = null;

/**
 * 获取 BGERerankerClient 单例
 * @param {Object} config - 配置（仅首次调用时生效）
 * @returns {BGERerankerClient}
 */
function getBGERerankerClient(config = {}) {
  if (!bgeRerankerInstance) {
    bgeRerankerInstance = new BGERerankerClient(config);
  }
  return bgeRerankerInstance;
}

module.exports = {
  BGERerankerClient,
  getBGERerankerClient,
  DEFAULT_CONFIG,
};
