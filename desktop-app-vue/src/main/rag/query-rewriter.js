/**
 * QueryRewriter - 查询重写器
 * 使用LLM生成查询变体，提升召回率和检索质量
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');

/**
 * 查询重写配置
 */
const DEFAULT_REWRITER_CONFIG = {
  enabled: true,
  method: 'multi_query',  // 'multi_query' | 'hyde' | 'step_back' | 'decompose'
  maxVariants: 3,         // 最大查询变体数量
  temperature: 0.7,       // LLM温度参数
  enableCache: true,      // 是否启用缓存
};

/**
 * 查询重写器类
 */
class QueryRewriter extends EventEmitter {
  constructor(llmManager, config = {}) {
    super();
    this.llmManager = llmManager;
    this.config = { ...DEFAULT_REWRITER_CONFIG, ...config };

    // 缓存重写结果
    this.cache = new Map();
  }

  /**
   * 重写查询
   * @param {string} query - 原始查询
   * @param {Object} options - 重写选项
   * @returns {Promise<Object>} 重写结果
   */
  async rewriteQuery(query, options = {}) {
    if (!this.config.enabled) {
      return {
        originalQuery: query,
        rewrittenQueries: [query],
        method: 'none',
      };
    }

    const method = options.method || this.config.method;

    // 检查缓存
    const cacheKey = `${method}:${query}`;
    if (this.config.enableCache && this.cache.has(cacheKey)) {
      logger.info('[QueryRewriter] 使用缓存的重写结果');
      return this.cache.get(cacheKey);
    }

    let result;
    try {
      this.emit('rewrite-start', { query, method });

      switch (method) {
        case 'multi_query':
          result = await this.multiQueryRewrite(query, options);
          break;
        case 'hyde':
          result = await this.hydeRewrite(query, options);
          break;
        case 'step_back':
          result = await this.stepBackRewrite(query, options);
          break;
        case 'decompose':
          result = await this.decomposeQuery(query, options);
          break;
        default:
          logger.warn(`[QueryRewriter] 未知的重写方法: ${method}`);
          result = {
            originalQuery: query,
            rewrittenQueries: [query],
            method: 'none',
          };
      }

      // 缓存结果
      if (this.config.enableCache) {
        this.cache.set(cacheKey, result);

        // 限制缓存大小
        if (this.cache.size > 100) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
      }

      this.emit('rewrite-complete', {
        query,
        method,
        variantCount: result.rewrittenQueries.length,
      });

      return result;
    } catch (error) {
      logger.error('[QueryRewriter] 重写失败:', error);
      this.emit('rewrite-error', { query, method, error });

      // 失败时返回原始查询
      return {
        originalQuery: query,
        rewrittenQueries: [query],
        method: 'fallback',
        error: error.message,
      };
    }
  }

  /**
   * 多查询重写（Multi-Query）
   * 生成多个语义相似但表达不同的查询
   */
  async multiQueryRewrite(query, options = {}) {
    const maxVariants = options.maxVariants || this.config.maxVariants;

    const prompt = `你是一个查询重写专家。请为以下查询生成${maxVariants}个语义相似但表达方式不同的查询变体。

原始查询: "${query}"

要求:
1. 保持原始查询的核心意图
2. 使用不同的词汇和表达方式
3. 每个变体应该独立成句
4. 不要添加额外的解释

请以JSON数组格式返回，例如: ["变体1", "变体2", "变体3"]

查询变体:`;

    const response = await this.llmManager.query(prompt, {
      temperature: this.config.temperature,
      maxTokens: 300,
    });

    // 解析LLM响应
    const variants = this.parseQueryVariants(response, maxVariants);

    return {
      originalQuery: query,
      rewrittenQueries: [query, ...variants],
      method: 'multi_query',
      variants: variants,
    };
  }

  /**
   * HyDE重写（Hypothetical Document Embeddings）
   * 生成假设的答案文档，然后用文档作为查询
   */
  async hydeRewrite(query, options = {}) {
    const prompt = `你是一个知识库专家。请根据以下问题，生成一个详细的假设答案。

问题: "${query}"

要求:
1. 假设你已经知道答案，直接给出详细回答
2. 回答应该包含相关的关键信息和细节
3. 长度控制在100-200字
4. 不要说"我不知道"或"需要更多信息"

假设答案:`;

    const hypotheticalAnswer = await this.llmManager.query(prompt, {
      temperature: 0.5,
      maxTokens: 300,
    });

    return {
      originalQuery: query,
      rewrittenQueries: [query, hypotheticalAnswer.trim()],
      method: 'hyde',
      hypotheticalDocument: hypotheticalAnswer.trim(),
    };
  }

  /**
   * Step-Back重写
   * 生成更抽象、更高层次的查询
   */
  async stepBackRewrite(query, options = {}) {
    const prompt = `你是一个查询抽象专家。请将以下具体查询转换为更抽象、更高层次的问题。

具体查询: "${query}"

要求:
1. 提炼出查询背后的核心概念
2. 去除具体的细节，保留本质问题
3. 使查询更加通用和概括

例如:
- 具体: "如何在Python中读取CSV文件?"
- 抽象: "Python中的文件读取方法"

抽象查询:`;

    const abstractQuery = await this.llmManager.query(prompt, {
      temperature: 0.3,
      maxTokens: 100,
    });

    return {
      originalQuery: query,
      rewrittenQueries: [query, abstractQuery.trim()],
      method: 'step_back',
      abstractQuery: abstractQuery.trim(),
    };
  }

  /**
   * 查询分解
   * 将复杂查询分解为多个子查询
   */
  async decomposeQuery(query, options = {}) {
    const prompt = `你是一个查询分解专家。请将以下复杂查询分解为多个简单的子查询。

复杂查询: "${query}"

要求:
1. 识别查询中的多个独立部分
2. 将每个部分转换为独立的子查询
3. 每个子查询应该简单明确
4. 以JSON数组格式返回

例如:
输入: "RAG系统的实现原理和优化方法"
输出: ["RAG系统的实现原理是什么", "RAG系统有哪些优化方法"]

子查询:`;

    const response = await this.llmManager.query(prompt, {
      temperature: 0.5,
      maxTokens: 200,
    });

    const subQueries = this.parseQueryVariants(response, 5);

    return {
      originalQuery: query,
      rewrittenQueries: [query, ...subQueries],
      method: 'decompose',
      subQueries: subQueries,
    };
  }

  /**
   * 解析LLM返回的查询变体
   * @private
   */
  parseQueryVariants(response, maxCount = 3) {
    const variants = [];

    try {
      // 尝试解析JSON数组
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          variants.push(...parsed.slice(0, maxCount));
        }
      }
    } catch (error) {
      logger.info('[QueryRewriter] JSON解析失败，尝试按行解析');
    }

    // 如果JSON解析失败，尝试按行分割
    if (variants.length === 0) {
      const lines = response
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
          // 过滤掉空行、JSON符号、编号等
          return line &&
                 line.length > 5 &&
                 !['[', ']', '{', '}'].includes(line) &&
                 !line.match(/^\d+[.)、]/) &&
                 !line.match(/^[-*]/) &&
                 line !== response.trim(); // 排除完整响应
        });

      for (const line of lines) {
        // 清理引号
        let cleaned = line.replace(/^["']|["']$/g, '').trim();

        // 移除列表标记
        cleaned = cleaned.replace(/^[-*•]\s*/, '');
        cleaned = cleaned.replace(/^\d+[.)、]\s*/, '');

        if (cleaned.length > 5) {
          variants.push(cleaned);
        }

        if (variants.length >= maxCount) {
          break;
        }
      }
    }

    // 如果还是没有解析出来，返回清理后的完整响应
    if (variants.length === 0) {
      const cleaned = response.trim().replace(/^["']|["']$/g, '');
      if (cleaned.length > 5) {
        variants.push(cleaned);
      }
    }

    return variants.slice(0, maxCount);
  }

  /**
   * 批量重写查询
   */
  async rewriteQueries(queries, options = {}) {
    const results = [];

    for (const query of queries) {
      const result = await this.rewriteQuery(query, options);
      results.push(result);
    }

    return results;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    logger.info('[QueryRewriter] 缓存已清除');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: 100,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('[QueryRewriter] 配置已更新:', this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * 启用/禁用查询重写
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    logger.info(`[QueryRewriter] 查询重写${enabled ? '已启用' : '已禁用'}`);
  }
}

module.exports = {
  QueryRewriter,
  DEFAULT_REWRITER_CONFIG,
};
