/**
 * RAG (Retrieval-Augmented Generation) 管理器
 *
 * 负责知识库检索和增强生成
 */

const EventEmitter = require('events');
const { EmbeddingsService } = require('./embeddings-service');
const VectorStore = require('../vector/vector-store');
const Reranker = require('./reranker');
const { RecursiveCharacterTextSplitter } = require('./text-splitter');
const { QueryRewriter } = require('./query-rewriter');
const { RAGMetrics, MetricTypes } = require('./metrics');

/**
 * RAG配置
 */
const DEFAULT_CONFIG = {
  // 检索参数
  topK: 10, // 返回top-K个最相关结果 (增加召回量)
  similarityThreshold: 0.6, // 相似度阈值 (稍微放宽以获得更多候选)
  maxContextLength: 6000, // 最大上下文长度（字符） (增加以支持更长上下文)

  // 启用选项
  enableRAG: true, // 是否启用RAG
  enableReranking: true, // 🔥 启用重排序以提升检索质量
  enableHybridSearch: true, // 是否启用混合搜索（向量+关键词）

  // 重排序配置
  rerankMethod: 'hybrid', // 重排序方法: 'llm' | 'crossencoder' | 'hybrid' | 'keyword' (混合策略更平衡)
  rerankTopK: 5, // 重排序后保留的文档数量
  rerankScoreThreshold: 0.3, // 重排序最低分数阈值

  // 权重
  vectorWeight: 0.6, // 向量搜索权重 (稍微降低)
  keywordWeight: 0.4, // 关键词搜索权重 (提升以增强关键词匹配)

  // 向量存储配置
  chromaUrl: 'http://localhost:8000', // ChromaDB地址
  useChromaDB: true, // 是否使用ChromaDB (false则使用内存)

  // 文档分块配置
  enableChunking: true, // 是否启用文档分块
  chunkSize: 500,
  chunkOverlap: 50,

  // 查询重写配置
  enableQueryRewrite: false, // 是否启用查询重写
  queryRewriteMethod: 'multi_query', // 'multi_query' | 'hyde' | 'step_back' | 'decompose'

  // 性能监控配置
  enableMetrics: true, // 是否启用性能监控
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

    // 向量存储
    this.vectorStore = new VectorStore({
      chromaUrl: this.config.chromaUrl,
      similarityThreshold: this.config.similarityThreshold,
      topK: this.config.topK,
    });

    // 重排序器
    this.reranker = new Reranker(llmManager);
    this.reranker.updateConfig({
      enabled: this.config.enableReranking,
      method: this.config.rerankMethod,
      topK: this.config.rerankTopK,
      scoreThreshold: this.config.rerankScoreThreshold,
    });

    // 文档分块器
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
    });

    // 查询重写器
    this.queryRewriter = new QueryRewriter(llmManager, {
      enabled: this.config.enableQueryRewrite,
      method: this.config.queryRewriteMethod,
    });

    // 性能监控
    this.metrics = new RAGMetrics();
    this.metricsEnabled = this.config.enableMetrics;

    // 向量索引缓存 (降级方案)
    this.vectorIndex = new Map();

    this.isInitialized = false;
    this.useChromaDB = false; // 实际是否使用ChromaDB
  }

  /**
   * 初始化RAG管理器
   */
  async initialize() {
    console.log('[RAGManager] 初始化RAG管理器...');

    try {
      // 初始化嵌入服务
      await this.embeddingsService.initialize();

      // 尝试初始化ChromaDB向量存储
      if (this.config.useChromaDB) {
        this.useChromaDB = await this.vectorStore.initialize();

        if (this.useChromaDB) {
          console.log('[RAGManager] 使用ChromaDB向量存储');
        } else {
          console.warn('[RAGManager] ChromaDB不可用，使用内存存储');
        }
      }

      // 构建向量索引
      await this.buildVectorIndex();

      this.isInitialized = true;
      console.log('[RAGManager] RAG管理器初始化成功');
      console.log('[RAGManager] 存储模式:', this.useChromaDB ? 'ChromaDB' : 'Memory');

      this.emit('initialized', {
        useChromaDB: this.useChromaDB,
        indexSize: this.useChromaDB ?
          (await this.vectorStore.getStats()).count :
          this.vectorIndex.size,
      });
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
      // 获取所有知识库项
      const items = this.db ? this.db.getKnowledgeItems(10000, 0) : [];

      if (!items || items.length === 0) {
        console.log('[RAGManager] 知识库为空');
        return;
      }

      console.log(`[RAGManager] 为 ${items.length} 个项目生成向量...`);

      // 批量处理 (优化批次大小以提升性能)
      const batchSize = 20;
      let processed = 0;

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        try {
          // 生成嵌入向量
          const embeddings = await Promise.all(
            batch.map(async (item) => {
              const text = `${item.title}\n${item.content || ''}`;
              return await this.embeddingsService.generateEmbedding(text);
            })
          );

          // 存储向量
          if (this.useChromaDB) {
            // 使用ChromaDB
            await this.vectorStore.addVectorsBatch(batch, embeddings);
          } else {
            // 使用内存存储
            batch.forEach((item, index) => {
              this.vectorIndex.set(item.id, {
                id: item.id,
                title: item.title,
                content: item.content,
                type: item.type,
                embedding: embeddings[index],
                created_at: item.created_at,
              });
            });
          }

          processed += batch.length;

          if (processed % 10 === 0) {
            console.log(`[RAGManager] 已处理 ${processed}/${items.length} 个项目`);
            this.emit('index-progress', {
              processed,
              total: items.length,
              percentage: Math.round((processed / items.length) * 100),
            });
          }
        } catch (error) {
          console.error(`[RAGManager] 处理批次失败:`, error);
        }
      }

      const finalCount = this.useChromaDB ?
        (await this.vectorStore.getStats()).count :
        this.vectorIndex.size;

      console.log(`[RAGManager] 向量索引构建完成，共 ${finalCount} 个项目`);
      this.emit('index-complete', { count: finalCount });
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
    // 开始总计时
    const totalTimer = this.metricsEnabled ? this.metrics.startTimer(MetricTypes.TOTAL) : null;

    if (!this.config.enableRAG) {
      return [];
    }

    const {
      topK = this.config.topK,
      similarityThreshold = this.config.similarityThreshold,
      useHybridSearch = this.config.enableHybridSearch,
      enableQueryRewrite = this.config.enableQueryRewrite,
    } = options;

    console.log(`[RAGManager] 检索查询: "${query}"`);

    try {
      let queries = [query];

      // 查询重写（如果启用）
      if (enableQueryRewrite && this.queryRewriter) {
        const rewriteTimer = this.metricsEnabled ? this.metrics.startTimer(MetricTypes.QUERY_REWRITE) : null;
        try {
          const rewriteResult = await this.queryRewriter.rewriteQuery(query, options);
          queries = rewriteResult.rewrittenQueries || [query];
          console.log(`[RAGManager] 查询重写生成 ${queries.length} 个变体`);
          if (rewriteTimer) rewriteTimer({ queryCount: queries.length });
        } catch (error) {
          console.error('[RAGManager] 查询重写失败:', error);
          if (this.metricsEnabled) this.metrics.recordError('query_rewrite', error);
          if (rewriteTimer) rewriteTimer();
        }
      }

      // 对每个查询执行检索
      let allResults = [];
      const retrievalTimer = this.metricsEnabled ? this.metrics.startTimer(MetricTypes.RETRIEVAL) : null;

      for (const q of queries) {
        let results = [];

        if (useHybridSearch) {
          // 混合搜索：向量搜索 + 关键词搜索
          const vectorResults = await this.vectorSearch(q, topK * 2);
          const keywordResults = await this.keywordSearch(q, topK * 2);

          // 合并和重排序
          results = this.mergeResults(vectorResults, keywordResults);
        } else {
          // 仅向量搜索
          results = await this.vectorSearch(q, topK * 2);
        }

        allResults.push(...results);
      }

      if (retrievalTimer) retrievalTimer({ resultCount: allResults.length });

      // 去重（根据ID）
      const uniqueResults = this._deduplicateResults(allResults);

      // 应用重排序 (如果启用)
      let finalResults = uniqueResults;
      if (this.config.enableReranking && uniqueResults.length > 0) {
        const rerankTimer = this.metricsEnabled ? this.metrics.startTimer(MetricTypes.RERANK) : null;
        console.log(`[RAGManager] 应用重排序，方法: ${this.config.rerankMethod}`);
        try {
          finalResults = await this.reranker.rerank(query, uniqueResults, {
            topK: this.config.rerankTopK || topK,
            method: this.config.rerankMethod,
          });
          console.log(`[RAGManager] 重排序后剩余 ${finalResults.length} 个文档`);
          if (rerankTimer) rerankTimer({ rerankCount: finalResults.length });
        } catch (error) {
          console.error('[RAGManager] 重排序失败，使用原始结果:', error);
          if (this.metricsEnabled) this.metrics.recordError('rerank', error);
          if (rerankTimer) rerankTimer();
        }
      }

      // 过滤低相似度结果
      finalResults = finalResults.filter((r) => r.score >= similarityThreshold);

      // 限制数量
      finalResults = finalResults.slice(0, topK);

      console.log(`[RAGManager] 检索到 ${finalResults.length} 个相关项目`);

      // 记录总时间
      if (totalTimer) totalTimer({ resultCount: finalResults.length });

      return finalResults;
    } catch (error) {
      console.error('[RAGManager] 检索失败:', error);
      if (this.metricsEnabled) this.metrics.recordError('retrieve', error);
      if (totalTimer) totalTimer();
      return [];
    }
  }

  /**
   * 去重结果
   * @private
   */
  _deduplicateResults(results) {
    const seen = new Set();
    const unique = [];

    for (const result of results) {
      const id = result.id;
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(result);
      } else {
        // 如果已存在，保留分数更高的
        const existingIndex = unique.findIndex(r => r.id === id);
        if (existingIndex !== -1 && result.score > unique[existingIndex].score) {
          unique[existingIndex] = result;
        }
      }
    }

    return unique;
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

    let results = [];

    if (this.useChromaDB) {
      // 使用ChromaDB搜索
      const chromaResults = await this.vectorStore.search(queryEmbedding, topK);

      results = chromaResults.map(r => ({
        id: r.id,
        title: r.metadata?.title || '',
        content: r.document || '',
        type: r.metadata?.type || 'note',
        score: r.score,
        source: 'vector',
      }));
    } else {
      // 使用内存搜索
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

      results = similarities.slice(0, topK);
    }

    return results;
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

    const embeddingTimer = this.metricsEnabled ? this.metrics.startTimer(MetricTypes.EMBEDDING) : null;

    try {
      const text = `${item.title}\n${item.content || ''}`;

      // 如果启用分块且文档较长
      if (this.config.enableChunking && text.length > this.config.chunkSize) {
        console.log(`[RAGManager] 文档较长 (${text.length}字符)，启用分块`);

        const chunks = this.textSplitter.splitText(text, {
          sourceId: item.id,
          sourceTitle: item.title,
          sourceType: item.type,
        });

        console.log(`[RAGManager] 分块为 ${chunks.length} 个片段`);

        // 为每个块生成嵌入并添加
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkId = `${item.id}_chunk_${i}`;

          const embedding = await this.embeddingsService.generateEmbedding(chunk.content);

          const chunkItem = {
            id: chunkId,
            title: `${item.title} (${i + 1}/${chunks.length})`,
            content: chunk.content,
            type: item.type,
            parentId: item.id,
            chunkIndex: i,
            totalChunks: chunks.length,
            created_at: item.created_at,
          };

          if (this.useChromaDB) {
            await this.vectorStore.addVector(chunkItem, embedding);
          } else {
            this.vectorIndex.set(chunkId, {
              ...chunkItem,
              embedding: embedding,
            });
          }
        }

        console.log(`[RAGManager] 添加 ${chunks.length} 个文档块到索引: ${item.id}`);
      } else {
        // 正常添加（不分块）
        const embedding = await this.embeddingsService.generateEmbedding(text);

        if (this.useChromaDB) {
          await this.vectorStore.addVector(item, embedding);
        } else {
          this.vectorIndex.set(item.id, {
            id: item.id,
            title: item.title,
            content: item.content,
            type: item.type,
            embedding: embedding,
            created_at: item.created_at,
          });
        }

        console.log(`[RAGManager] 添加项目到索引: ${item.id}`);
      }

      if (embeddingTimer) embeddingTimer();
    } catch (error) {
      console.error('[RAGManager] 添加到索引失败:', error);
      if (this.metricsEnabled) this.metrics.recordError('add_to_index', error);
      if (embeddingTimer) embeddingTimer();
    }
  }

  /**
   * 从索引中移除文档
   * @param {string} itemId - 知识库项ID
   */
  async removeFromIndex(itemId) {
    try {
      if (this.useChromaDB) {
        await this.vectorStore.deleteVector(itemId);
      } else {
        if (this.vectorIndex.has(itemId)) {
          this.vectorIndex.delete(itemId);
        }
      }
      console.log(`[RAGManager] 从索引移除项目: ${itemId}`);
    } catch (error) {
      console.error(`[RAGManager] 移除项目失败:`, error);
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
  async getIndexStats() {
    let vectorStats;

    if (this.useChromaDB) {
      vectorStats = await this.vectorStore.getStats();
    } else {
      vectorStats = {
        mode: 'memory',
        count: this.vectorIndex.size,
      };
    }

    return {
      totalItems: vectorStats.count,
      storageMode: vectorStats.mode,
      cacheStats: this.embeddingsService.getCacheStats(),
      config: this.config,
      chromaUrl: vectorStats.chromaUrl,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    // 更新重排序器配置
    if (this.reranker) {
      this.reranker.updateConfig({
        enabled: this.config.enableReranking,
        method: this.config.rerankMethod,
        topK: this.config.rerankTopK,
        scoreThreshold: this.config.rerankScoreThreshold,
      });
    }

    console.log('[RAGManager] 配置已更新:', this.config);
  }

  /**
   * 获取重排序器配置
   */
  getRerankConfig() {
    return this.reranker ? this.reranker.getConfig() : null;
  }

  /**
   * 启用/禁用重排序
   */
  setRerankingEnabled(enabled) {
    this.config.enableReranking = enabled;
    if (this.reranker) {
      this.reranker.setEnabled(enabled);
    }
    console.log(`[RAGManager] 重排序${enabled ? '已启用' : '已禁用'}`);
  }

  /**
   * 获取性能指标
   * @param {string} type - 指标类型（可选）
   * @returns {Object} 性能统计
   */
  getPerformanceMetrics(type = null) {
    if (!this.metricsEnabled || !this.metrics) {
      return {
        enabled: false,
        message: '性能监控未启用',
      };
    }

    return {
      enabled: true,
      ...this.metrics.getStats(type),
    };
  }

  /**
   * 获取实时性能概览
   * @returns {Object} 实时性能数据
   */
  getRealTimeMetrics() {
    if (!this.metricsEnabled || !this.metrics) {
      return { enabled: false };
    }

    return {
      enabled: true,
      ...this.metrics.getRealTimeOverview(),
    };
  }

  /**
   * 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Object} 性能报告
   */
  getPerformanceReport(timeRange = 3600000) {
    if (!this.metricsEnabled || !this.metrics) {
      return { enabled: false };
    }

    return {
      enabled: true,
      ...this.metrics.getPerformanceReport(timeRange),
    };
  }

  /**
   * 重置性能指标
   */
  resetMetrics() {
    if (this.metricsEnabled && this.metrics) {
      this.metrics.reset();
      console.log('[RAGManager] 性能指标已重置');
    }
  }

  /**
   * 启用/禁用性能监控
   */
  setMetricsEnabled(enabled) {
    this.metricsEnabled = enabled;
    console.log(`[RAGManager] 性能监控${enabled ? '已启用' : '已禁用'}`);
  }

  /**
   * 添加文档（兼容ProjectRAG接口）
   * @param {Object} doc - 文档对象
   * @returns {Promise<void>}
   */
  async addDocument(doc) {
    const item = {
      id: doc.id,
      title: doc.metadata?.title || doc.metadata?.fileName || 'Untitled',
      content: doc.content || '',
      type: doc.metadata?.type || 'document',
      created_at: doc.metadata?.createdAt || new Date().toISOString(),
      updated_at: doc.metadata?.updatedAt || new Date().toISOString(),
    };

    await this.addToIndex(item);
    console.log(`[RAGManager] 添加文档: ${item.id}`);
  }

  /**
   * 获取文档（兼容ProjectRAG接口）
   * @param {string} id - 文档ID
   * @returns {Promise<Object|null>}
   */
  async getDocument(id) {
    try {
      if (this.useChromaDB) {
        // 从ChromaDB/Qdrant获取
        const results = await this.vectorStore.collection?.get({
          ids: [id],
        });

        if (results && results.ids && results.ids.length > 0) {
          return {
            id: results.ids[0],
            content: results.documents[0],
            metadata: results.metadatas[0],
          };
        }
      } else {
        // 从内存索引获取
        const item = this.vectorIndex.get(id);
        if (item) {
          return {
            id: item.id,
            content: item.content,
            metadata: {
              title: item.title,
              type: item.type,
              created_at: item.created_at,
            },
          };
        }
      }

      return null;
    } catch (error) {
      console.error(`[RAGManager] 获取文档失败 ${id}:`, error);
      return null;
    }
  }

  /**
   * 删除文档（兼容ProjectRAG接口）
   * @param {string} id - 文档ID
   * @returns {Promise<void>}
   */
  async deleteDocument(id) {
    await this.removeFromIndex(id);
    console.log(`[RAGManager] 删除文档: ${id}`);
  }

  /**
   * 搜索文档（兼容ProjectRAG接口）
   * @param {string} query - 查询文本
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>}
   */
  async search(query, options = {}) {
    const {
      filter = null,
      limit = this.config.topK,
      useHybridSearch = this.config.enableHybridSearch,
    } = options;

    // 调用retrieve方法
    const results = await this.retrieve(query, {
      topK: limit,
      useHybridSearch,
    });

    // 应用过滤条件（如果有）
    if (filter) {
      return results.filter(result => {
        // 检查metadata是否匹配filter
        for (const [key, value] of Object.entries(filter)) {
          const metadataValue = result[key] || result.metadata?.[key];
          if (metadataValue !== value) {
            return false;
          }
        }
        return true;
      });
    }

    return results;
  }

  /**
   * 重排序文档（兼容ProjectRAG接口）
   * @param {string} query - 查询文本
   * @param {Array} documents - 文档列表
   * @param {Object} options - 重排序选项
   * @returns {Promise<Array>}
   */
  async rerank(query, documents, options = {}) {
    if (!this.config.enableReranking || !this.reranker) {
      console.log('[RAGManager] 重排序未启用，返回原始结果');
      return documents;
    }

    try {
      return await this.reranker.rerank(query, documents, {
        topK: options.topK || this.config.rerankTopK,
        method: options.method || this.config.rerankMethod,
      });
    } catch (error) {
      console.error('[RAGManager] 重排序失败:', error);
      return documents;
    }
  }
}

// 单例实例
let ragManagerInstance = null;

/**
 * 获取RAG管理器单例实例
 * @param {Object} databaseManager - 数据库管理器
 * @param {Object} llmManager - LLM管理器
 * @param {Object} config - 配置选项
 * @returns {RAGManager}
 */
function getRAGManager(databaseManager = null, llmManager = null, config = {}) {
  if (!ragManagerInstance && databaseManager && llmManager) {
    ragManagerInstance = new RAGManager(databaseManager, llmManager, config);
  }
  return ragManagerInstance;
}

module.exports = {
  RAGManager,
  DEFAULT_CONFIG,
  getRAGManager,
};
