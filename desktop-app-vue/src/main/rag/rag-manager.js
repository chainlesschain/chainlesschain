/**
 * RAG (Retrieval-Augmented Generation) 管理器
 *
 * 负责知识库检索和增强生成
 */

const EventEmitter = require('events');
const { EmbeddingsService } = require('./embeddings-service');

/**
 * RAG配置
 */
const DEFAULT_CONFIG = {
  // 检索参数
  topK: 5, // 返回top-K个最相关结果
  similarityThreshold: 0.3, // 相似度阈值
  maxContextLength: 2000, // 最大上下文长度（字符）

  // 启用选项
  enableRAG: true, // 是否启用RAG
  enableReranking: false, // 是否启用重排序
  enableHybridSearch: true, // 是否启用混合搜索（向量+关键词）

  // 权重
  vectorWeight: 0.7, // 向量搜索权重
  keywordWeight: 0.3, // 关键词搜索权重
};

/**
 * RAG管理器类
 */
class RAGManager extends EventEmitter {
  constructor(databaseManager, llmManager, config = {}) {
    super();

    this.db = databaseManager;
    this.llmManager = llmManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 嵌入服务
    this.embeddingsService = new EmbeddingsService(llmManager);

    // 向量索引缓存
    this.vectorIndex = new Map();

    this.isInitialized = false;
  }

  /**
   * 初始化RAG管理器
   */
  async initialize() {
    console.log('[RAGManager] 初始化RAG管理器...');

    try {
      // 初始化嵌入服务
      await this.embeddingsService.initialize();

      // 构建向量索引
      await this.buildVectorIndex();

      this.isInitialized = true;
      console.log('[RAGManager] RAG管理器初始化成功');

      this.emit('initialized');
      return true;
    } catch (error) {
      console.error('[RAGManager] 初始化失败:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * 构建向量索引
   */
  async buildVectorIndex() {
    if (!this.config.enableRAG) {
      console.log('[RAGManager] RAG未启用，跳过索引构建');
      return;
    }

    console.log('[RAGManager] 开始构建向量索引...');

    try {
      // 获取所有知识库项（使用getKnowledgeItems方法）
      const items = this.db ? this.db.getKnowledgeItems(10000, 0) : [];

      if (!items || items.length === 0) {
        console.log('[RAGManager] 知识库为空');
        return;
      }

      console.log(`[RAGManager] 为 ${items.length} 个项目生成向量...`);

      let processed = 0;
      for (const item of items) {
        try {
          // 合并标题和内容
          const text = `${item.title}\n${item.content || ''}`;

          // 生成向量
          const embedding = await this.embeddingsService.generateEmbedding(text);

          // 存储到索引
          this.vectorIndex.set(item.id, {
            id: item.id,
            title: item.title,
            content: item.content,
            type: item.type,
            embedding: embedding,
            created_at: item.created_at,
          });

          processed++;

          if (processed % 10 === 0) {
            console.log(`[RAGManager] 已处理 ${processed}/${items.length} 个项目`);
          }
        } catch (error) {
          console.error(`[RAGManager] 处理项目 ${item.id} 失败:`, error);
        }
      }

      console.log(`[RAGManager] 向量索引构建完成，共 ${this.vectorIndex.size} 个项目`);
    } catch (error) {
      console.error('[RAGManager] 构建向量索引失败:', error);
      throw error;
    }
  }

  /**
   * 检索相关知识
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 相关知识列表
   */
  async retrieve(query, options = {}) {
    if (!this.config.enableRAG) {
      return [];
    }

    const {
      topK = this.config.topK,
      similarityThreshold = this.config.similarityThreshold,
      useHybridSearch = this.config.enableHybridSearch,
    } = options;

    console.log(`[RAGManager] 检索查询: "${query}"`);

    try {
      let results = [];

      if (useHybridSearch) {
        // 混合搜索：向量搜索 + 关键词搜索
        const vectorResults = await this.vectorSearch(query, topK * 2);
        const keywordResults = await this.keywordSearch(query, topK * 2);

        // 合并和重排序
        results = this.mergeResults(vectorResults, keywordResults);
      } else {
        // 仅向量搜索
        results = await this.vectorSearch(query, topK * 2);
      }

      // 过滤低相似度结果
      results = results.filter((r) => r.score >= similarityThreshold);

      // 限制数量
      results = results.slice(0, topK);

      console.log(`[RAGManager] 检索到 ${results.length} 个相关项目`);

      return results;
    } catch (error) {
      console.error('[RAGManager] 检索失败:', error);
      return [];
    }
  }

  /**
   * 向量搜索
   * @param {string} query - 查询文本
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 搜索结果
   */
  async vectorSearch(query, topK = 5) {
    // 生成查询向量
    const queryEmbedding = await this.embeddingsService.generateEmbedding(query);

    // 计算相似度
    const similarities = [];

    for (const [id, item] of this.vectorIndex) {
      const similarity = this.embeddingsService.cosineSimilarity(
        queryEmbedding,
        item.embedding
      );

      similarities.push({
        id: item.id,
        title: item.title,
        content: item.content,
        type: item.type,
        score: similarity,
        source: 'vector',
      });
    }

    // 排序
    similarities.sort((a, b) => b.score - a.score);

    return similarities.slice(0, topK);
  }

  /**
   * 关键词搜索
   * @param {string} query - 查询文本
   * @param {number} topK - 返回数量
   * @returns {Promise<Array>} 搜索结果
   */
  async keywordSearch(query, topK = 5) {
    try {
      // 使用数据库的FTS搜索
      const results = this.db.searchKnowledgeItems(query);

      return results.slice(0, topK).map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        type: item.type,
        score: item.rank || 0.5, // FTS rank分数
        source: 'keyword',
      }));
    } catch (error) {
      console.error('[RAGManager] 关键词搜索失败:', error);
      return [];
    }
  }

  /**
   * 合并搜索结果
   * @param {Array} vectorResults - 向量搜索结果
   * @param {Array} keywordResults - 关键词搜索结果
   * @returns {Array} 合并后的结果
   */
  mergeResults(vectorResults, keywordResults) {
    const merged = new Map();

    // 添加向量搜索结果
    for (const result of vectorResults) {
      merged.set(result.id, {
        ...result,
        vectorScore: result.score * this.config.vectorWeight,
        keywordScore: 0,
      });
    }

    // 合并关键词搜索结果
    for (const result of keywordResults) {
      if (merged.has(result.id)) {
        const existing = merged.get(result.id);
        existing.keywordScore = result.score * this.config.keywordWeight;
        existing.score = existing.vectorScore + existing.keywordScore;
        existing.source = 'hybrid';
      } else {
        merged.set(result.id, {
          ...result,
          vectorScore: 0,
          keywordScore: result.score * this.config.keywordWeight,
          score: result.score * this.config.keywordWeight,
        });
      }
    }

    // 转换为数组并排序
    const results = Array.from(merged.values());
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * 构建增强上下文
   * @param {string} query - 用户查询
   * @param {Array} retrievedDocs - 检索到的文档
   * @returns {string} 增强上下文
   */
  buildEnhancedContext(query, retrievedDocs) {
    if (!retrievedDocs || retrievedDocs.length === 0) {
      return '';
    }

    let context = '# 相关知识库内容\n\n';

    let currentLength = context.length;

    for (const doc of retrievedDocs) {
      const docText = `## ${doc.title}\n${doc.content || ''}\n\n`;

      // 检查长度限制
      if (currentLength + docText.length > this.config.maxContextLength) {
        break;
      }

      context += docText;
      currentLength += docText.length;
    }

    context += `\n# 用户问题\n${query}\n\n请基于以上知识库内容回答用户问题。`;

    return context;
  }

  /**
   * RAG增强查询
   * @param {string} query - 用户查询
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 增强后的查询信息
   */
  async enhanceQuery(query, options = {}) {
    if (!this.config.enableRAG) {
      return {
        query: query,
        context: '',
        retrievedDocs: [],
      };
    }

    try {
      // 检索相关知识
      const retrievedDocs = await this.retrieve(query, options);

      // 构建增强上下文
      const context = this.buildEnhancedContext(query, retrievedDocs);

      return {
        query: query,
        context: context,
        retrievedDocs: retrievedDocs,
      };
    } catch (error) {
      console.error('[RAGManager] 增强查询失败:', error);
      return {
        query: query,
        context: '',
        retrievedDocs: [],
      };
    }
  }

  /**
   * 添加文档到索引
   * @param {Object} item - 知识库项
   */
  async addToIndex(item) {
    if (!this.config.enableRAG) {
      return;
    }

    try {
      const text = `${item.title}\n${item.content || ''}`;
      const embedding = await this.embeddingsService.generateEmbedding(text);

      this.vectorIndex.set(item.id, {
        id: item.id,
        title: item.title,
        content: item.content,
        type: item.type,
        embedding: embedding,
        created_at: item.created_at,
      });

      console.log(`[RAGManager] 添加项目到索引: ${item.id}`);
    } catch (error) {
      console.error('[RAGManager] 添加到索引失败:', error);
    }
  }

  /**
   * 从索引中移除文档
   * @param {number} itemId - 知识库项ID
   */
  removeFromIndex(itemId) {
    if (this.vectorIndex.has(itemId)) {
      this.vectorIndex.delete(itemId);
      console.log(`[RAGManager] 从索引移除项目: ${itemId}`);
    }
  }

  /**
   * 更新索引中的文档
   * @param {Object} item - 知识库项
   */
  async updateIndex(item) {
    await this.removeFromIndex(item.id);
    await this.addToIndex(item);
  }

  /**
   * 重建索引
   */
  async rebuildIndex() {
    console.log('[RAGManager] 重建向量索引...');
    this.vectorIndex.clear();
    this.embeddingsService.clearCache();
    await this.buildVectorIndex();
  }

  /**
   * 获取索引统计
   */
  getIndexStats() {
    return {
      totalItems: this.vectorIndex.size,
      cacheStats: this.embeddingsService.getCacheStats(),
      config: this.config,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[RAGManager] 配置已更新:', this.config);
  }
}

module.exports = {
  RAGManager,
  DEFAULT_CONFIG,
};
