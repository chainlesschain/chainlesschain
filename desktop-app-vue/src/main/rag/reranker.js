/**
 * Reranker - 重排序模块
 * 用于对检索结果进行二次排序，提升 RAG 检索质量
 *
 * v0.27.0: 新增 BGE Reranker 支持
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { getBGERerankerClient } = require("./bge-reranker-client");

class Reranker extends EventEmitter {
  constructor(llmManager) {
    super();
    this.llmManager = llmManager;
    this.bgeClient = null; // BGE Reranker 客户端（延迟初始化）
    this.config = {
      enabled: true,
      method: "llm", // 'llm' | 'crossencoder' | 'hybrid' | 'bge' | 'bge-hybrid'
      topK: 5, // 重排序后保留的文档数量
      scoreThreshold: 0.3, // 最低分数阈值
      // BGE 配置
      bgeConfig: {
        enabled: false,
        serverUrl: "http://localhost:8002/rerank",
        modelName: "BAAI/bge-reranker-base",
        hybridWeights: { bge: 0.6, vector: 0.4 },
      },
    };
  }

  /**
   * 重排序检索结果
   * @param {string} query - 用户查询
   * @param {Array} documents - 初步检索的文档列表
   * @param {Object} options - 配置选项
   * @returns {Array} - 重排序后的文档列表
   */
  async rerank(query, documents, options = {}) {
    if (!this.config.enabled || !documents || documents.length === 0) {
      return documents;
    }

    const method = options.method || this.config.method;
    const topK = options.topK || this.config.topK;

    try {
      this.emit("rerank-start", {
        query,
        documentCount: documents.length,
        method,
      });

      let rerankedDocs;
      switch (method) {
        case "llm":
          rerankedDocs = await this.rerankWithLLM(query, documents, topK);
          break;
        case "crossencoder":
          rerankedDocs = await this.rerankWithCrossEncoder(
            query,
            documents,
            topK,
          );
          break;
        case "hybrid":
          rerankedDocs = await this.rerankHybrid(query, documents, topK);
          break;
        case "bge":
          rerankedDocs = await this.rerankWithBGE(query, documents, topK);
          break;
        case "bge-hybrid":
          rerankedDocs = await this.rerankWithBGEHybrid(query, documents, topK);
          break;
        default:
          logger.warn(
            `[Reranker] 未知的重排序方法: ${method}，使用默认 LLM 方法`,
          );
          rerankedDocs = await this.rerankWithLLM(query, documents, topK);
      }

      // 应用分数阈值过滤
      const filtered = rerankedDocs.filter(
        (doc) => doc.score >= this.config.scoreThreshold,
      );

      this.emit("rerank-complete", {
        query,
        originalCount: documents.length,
        rerankedCount: filtered.length,
      });

      return filtered;
    } catch (error) {
      logger.error("[Reranker] 重排序失败:", error);
      this.emit("rerank-error", { query, error });
      // 失败时返回原始结果
      return documents.slice(0, topK);
    }
  }

  /**
   * 使用 LLM 进行重排序
   * 通过 LLM 评估每个文档与查询的相关性
   */
  async rerankWithLLM(query, documents, topK) {
    if (!this.llmManager) {
      logger.warn("[Reranker] LLM 管理器未初始化，跳过重排序");
      return documents.slice(0, topK);
    }

    try {
      // 批量评分（避免多次 LLM 调用）
      const prompt = this.buildRerankPrompt(query, documents);
      const response = await this.llmManager.query(prompt, {
        temperature: 0.1, // 低温度以获得更确定的结果
        maxTokens: 500,
      });

      // 解析 LLM 响应，提取评分
      const scores = this.parseLLMScores(response, documents.length);

      // 将评分应用到文档
      const scoredDocs = documents.map((doc, index) => ({
        ...doc,
        rerankScore: scores[index] || 0,
        originalScore: doc.score || 0,
        score: scores[index] || doc.score || 0, // 使用重排序分数
      }));

      // 按重排序分数排序
      scoredDocs.sort((a, b) => b.rerankScore - a.rerankScore);

      return scoredDocs.slice(0, topK);
    } catch (error) {
      logger.error("[Reranker] LLM 重排序失败:", error);
      return documents.slice(0, topK);
    }
  }

  /**
   * 构建重排序提示词
   */
  buildRerankPrompt(query, documents) {
    const docList = documents
      .map(
        (doc, index) =>
          `文档${index + 1}:\n标题: ${doc.title || "无标题"}\n内容: ${doc.content.substring(0, 200)}...\n`,
      )
      .join("\n");

    return `作为一个信息检索专家，请评估以下文档与用户查询的相关性。

用户查询: "${query}"

候选文档:
${docList}

请为每个文档打分（0-1 之间的小数），分数越高表示越相关。
只返回分数列表，用逗号分隔，例如: 0.9, 0.7, 0.5, 0.3, 0.2

评分标准:
- 0.9-1.0: 非常相关，直接回答了查询
- 0.7-0.8: 相关，包含有用信息
- 0.5-0.6: 部分相关，有一定参考价值
- 0.3-0.4: 弱相关，仅涉及相关主题
- 0.0-0.2: 不相关

分数:`;
  }

  /**
   * 解析 LLM 返回的评分
   */
  parseLLMScores(response, expectedCount) {
    try {
      // 尝试从响应中提取分数
      const scoreMatch = response.match(/[\d.]+(?:\s*,\s*[\d.]+)*/);
      if (!scoreMatch) {
        logger.warn("[Reranker] 无法解析 LLM 评分，使用默认值");
        return Array(expectedCount).fill(0.5);
      }

      const scores = scoreMatch[0]
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((s) => !isNaN(s));

      // 如果分数数量不匹配，补齐或截断
      if (scores.length < expectedCount) {
        const remaining = expectedCount - scores.length;
        scores.push(...Array(remaining).fill(0.3));
      } else if (scores.length > expectedCount) {
        scores.length = expectedCount;
      }

      return scores;
    } catch (error) {
      logger.error("[Reranker] 解析评分失败:", error);
      return Array(expectedCount).fill(0.5);
    }
  }

  /**
   * 使用 Cross-Encoder 模型重排序
   * 支持远程API和本地关键词回退
   */
  async rerankWithCrossEncoder(query, documents, topK) {
    // 尝试调用远程CrossEncoder API
    try {
      const crossEncoderUrl =
        process.env.CROSSENCODER_API_URL || "http://localhost:8001/api/rerank";

      // 准备请求数据
      const requestData = {
        query: query,
        documents: documents.map((doc) => ({
          id: doc.id,
          text: doc.content || doc.text || doc.title,
        })),
        top_k: topK,
      };

      // 调用远程API
      const response = await fetch(crossEncoderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
        timeout: 10000, // 10秒超时
      });

      if (response.ok) {
        const result = await response.json();

        // 将远程结果映射回原始文档
        const rerankedDocs = result.results.map((item) => {
          const originalDoc = documents.find((d) => d.id === item.id);
          return {
            ...originalDoc,
            rerankScore: item.score,
            originalScore: originalDoc.score || 0,
            score: item.score,
          };
        });

        logger.info("[Reranker] CrossEncoder重排序成功");
        return rerankedDocs.slice(0, topK);
      }
    } catch (error) {
      logger.warn(
        "[Reranker] CrossEncoder API调用失败，使用关键词回退:",
        error.message,
      );
    }

    // API不可用时，回退到关键词匹配
    logger.info("[Reranker] 使用关键词匹配作为CrossEncoder回退方案");
    return this.rerankWithKeywordMatch(query, documents, topK);
  }

  /**
   * 混合重排序（结合多种方法）
   */
  async rerankHybrid(query, documents, topK) {
    try {
      // 1. 使用 LLM 重排序
      const llmReranked = await this.rerankWithLLM(query, documents, topK * 2);

      // 2. 结合原始检索分数（如果有）
      const hybridScored = llmReranked.map((doc) => {
        const originalScore = doc.originalScore || 0;
        const rerankScore = doc.rerankScore || 0;
        // 混合权重: 70% 重排序分数 + 30% 原始分数
        const hybridScore = rerankScore * 0.7 + originalScore * 0.3;
        return {
          ...doc,
          score: hybridScore,
        };
      });

      // 3. 按混合分数重新排序
      hybridScored.sort((a, b) => b.score - a.score);

      return hybridScored.slice(0, topK);
    } catch (error) {
      logger.error("[Reranker] 混合重排序失败:", error);
      return documents.slice(0, topK);
    }
  }

  /**
   * 简单的基于关键词匹配的重排序（无需 LLM）
   * 用于快速重排序或 LLM 不可用时
   */
  rerankWithKeywordMatch(query, documents, topK) {
    const queryTokens = this.tokenize(query.toLowerCase());

    const scored = documents.map((doc) => {
      const titleTokens = this.tokenize((doc.title || "").toLowerCase());
      const contentTokens = this.tokenize((doc.content || "").toLowerCase());

      // 计算关键词匹配度
      let matchScore = 0;

      // 标题匹配权重更高
      queryTokens.forEach((token) => {
        if (titleTokens.includes(token)) {
          matchScore += 2.0;
        }
        if (contentTokens.includes(token)) {
          matchScore += 1.0;
        }
      });

      // 归一化分数
      const normalizedScore = Math.min(
        matchScore / (queryTokens.length * 3),
        1.0,
      );

      return {
        ...doc,
        rerankScore: normalizedScore,
        score: normalizedScore,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * 简单分词（按空格和标点分割）
   */
  tokenize(text) {
    return text
      .split(/[\s,，。.!?！？;；:：、]+/)
      .filter((token) => token.length > 0);
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    logger.info("[Reranker] 配置已更新:", this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * 启用/禁用重排序
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    logger.info(`[Reranker] 重排序${enabled ? "已启用" : "已禁用"}`);
  }

  // ========================================
  // BGE Reranker 相关方法 (v0.27.0)
  // ========================================

  /**
   * 初始化 BGE Reranker 客户端
   * @returns {Object} BGE 客户端实例
   */
  _initBGEClient() {
    if (!this.bgeClient) {
      this.bgeClient = getBGERerankerClient({
        serverUrl:
          this.config.bgeConfig?.serverUrl || "http://localhost:8002/rerank",
        modelName: this.config.bgeConfig?.modelName || "BAAI/bge-reranker-base",
      });
      logger.info("[Reranker] BGE Reranker 客户端已初始化");
    }
    return this.bgeClient;
  }

  /**
   * 使用 BGE Reranker 进行重排序
   * @param {string} query - 用户查询
   * @param {Array} documents - 文档列表
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 重排序后的文档列表
   */
  async rerankWithBGE(query, documents, topK) {
    try {
      const client = this._initBGEClient();

      // 检查服务是否可用
      const status = await client.checkStatus();
      if (!status.available) {
        logger.warn("[Reranker] BGE 服务不可用，回退到关键词匹配");
        return this.rerankWithKeywordMatch(query, documents, topK);
      }

      // 调用 BGE Reranker
      const rerankedDocs = await client.rerank(query, documents, { topK });

      logger.info(
        `[Reranker] BGE 重排序完成: ${documents.length} -> ${rerankedDocs.length} 文档`,
      );
      return rerankedDocs;
    } catch (error) {
      logger.error("[Reranker] BGE 重排序失败:", error);
      // 回退到关键词匹配
      return this.rerankWithKeywordMatch(query, documents, topK);
    }
  }

  /**
   * 使用 BGE + 向量相似度混合重排序
   * @param {string} query - 用户查询
   * @param {Array} documents - 文档列表
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 重排序后的文档列表
   */
  async rerankWithBGEHybrid(query, documents, topK) {
    try {
      const client = this._initBGEClient();

      // 检查服务是否可用
      const status = await client.checkStatus();
      if (!status.available) {
        logger.warn("[Reranker] BGE 服务不可用，回退到混合重排序");
        return this.rerankHybrid(query, documents, topK);
      }

      // 先用 BGE 重排序
      const bgeReranked = await client.rerank(query, documents, {
        topK: Math.min(topK * 2, documents.length), // 获取更多用于混合计算
      });

      // 计算混合分数
      const weights = this.config.bgeConfig?.hybridWeights || {
        bge: 0.6,
        vector: 0.4,
      };
      const hybridDocs = client.calculateHybridScore(bgeReranked, weights);

      logger.info(
        `[Reranker] BGE-Hybrid 重排序完成: 权重 BGE=${weights.bge}, Vector=${weights.vector}`,
      );
      return hybridDocs.slice(0, topK);
    } catch (error) {
      logger.error("[Reranker] BGE-Hybrid 重排序失败:", error);
      // 回退到普通混合重排序
      return this.rerankHybrid(query, documents, topK);
    }
  }

  /**
   * 更新 BGE 配置
   * @param {Object} bgeConfig - BGE 配置
   */
  updateBGEConfig(bgeConfig) {
    this.config.bgeConfig = {
      ...this.config.bgeConfig,
      ...bgeConfig,
    };

    // 如果客户端已初始化，更新其配置
    if (this.bgeClient) {
      this.bgeClient.updateConfig({
        serverUrl: bgeConfig.serverUrl,
        modelName: bgeConfig.modelName,
      });
    }

    logger.info("[Reranker] BGE 配置已更新:", this.config.bgeConfig);
  }

  /**
   * 检查 BGE 服务状态
   * @returns {Promise<Object>} BGE 服务状态
   */
  async checkBGEStatus() {
    try {
      const client = this._initBGEClient();
      return await client.checkStatus();
    } catch (error) {
      return {
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取 BGE 统计数据
   * @returns {Object} BGE 统计数据
   */
  getBGEStats() {
    if (!this.bgeClient) {
      return { initialized: false };
    }
    return {
      initialized: true,
      ...this.bgeClient.getStats(),
    };
  }
}

module.exports = Reranker;
