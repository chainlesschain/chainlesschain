const { logger, createLogger } = require('../utils/logger.js');

/**
 * ContentRecommender - 基于内容的推荐算法
 * P2智能层Phase 4 - 推荐系统
 *
 * 功能:
 * - 工具特征提取
 * - 工具相似度计算
 * - 基于内容的推荐
 * - 工具链推荐
 *
 * Version: v0.24.0
 * Date: 2026-01-02
 */

class ContentRecommender {
  constructor(config = {}) {
    this.config = {
      minSimilarity: 0.2,      // 最小相似度阈值
      topKSimilar: 5,          // 考虑Top-K相似工具
      enableToolChain: true,   // 启用工具链推荐
      ...config
    };

    this.db = null;
    this.toolFeatures = new Map();     // 工具特征映射
    this.toolSimilarity = new Map();   // 工具相似度矩阵
    this.toolChains = new Map();       // 工具链统计

    this.stats = {
      totalRecommendations: 0,
      toolChainRecommendations: 0,
      avgSimilarity: 0
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 构建工具特征
   */
  async buildToolFeatures() {
    logger.info('[ContentRecommender] 构建工具特征...');

    // 默认工具特征库
    const defaultTools = [
      {
        name: 'codeGeneration',
        category: 'development',
        tags: ['code', 'generate', 'function', 'class'],
        description: '代码生成工具，自动生成函数、类等代码结构'
      },
      {
        name: 'fileWrite',
        category: 'development',
        tags: ['file', 'write', 'save', 'create'],
        description: '文件写入工具，创建和保存文件内容'
      },
      {
        name: 'fileRead',
        category: 'development',
        tags: ['file', 'read', 'load', 'open'],
        description: '文件读取工具，加载和读取文件内容'
      },
      {
        name: 'formatCode',
        category: 'development',
        tags: ['format', 'code', 'style', 'beautify'],
        description: '代码格式化工具，美化代码风格'
      },
      {
        name: 'debugging',
        category: 'development',
        tags: ['debug', 'fix', 'error', 'troubleshoot'],
        description: '调试工具，帮助排查和修复代码错误'
      },
      {
        name: 'testing',
        category: 'development',
        tags: ['test', 'unittest', 'qa', 'verify'],
        description: '测试工具，编写和运行单元测试'
      },
      {
        name: 'dataAnalysis',
        category: 'data',
        tags: ['data', 'analysis', 'statistics', 'explore'],
        description: '数据分析工具，统计分析和探索数据'
      },
      {
        name: 'chartGeneration',
        category: 'data',
        tags: ['chart', 'visualization', 'graph', 'plot'],
        description: '图表生成工具，可视化数据生成图表'
      },
      {
        name: 'documentation',
        category: 'writing',
        tags: ['doc', 'document', 'write', 'readme'],
        description: '文档编写工具，生成项目文档和说明'
      },
      {
        name: 'markdown',
        category: 'writing',
        tags: ['markdown', 'format', 'text', 'note'],
        description: 'Markdown编辑工具，格式化文本内容'
      }
    ];

    this.toolFeatures.clear();
    for (const tool of defaultTools) {
      this.toolFeatures.set(tool.name, {
        category: tool.category,
        tags: new Set(tool.tags),
        description: tool.description,
        vector: this.createFeatureVector(tool)
      });
    }

    logger.info(`[ContentRecommender] 工具特征构建完成: ${this.toolFeatures.size}个工具`);
    return this.toolFeatures;
  }

  /**
   * 创建工具特征向量
   */
  createFeatureVector(tool) {
    const vector = [];

    // 1. 类别编码
    const categories = ['development', 'data', 'design', 'writing', 'testing', 'deployment'];
    const categoryIndex = categories.indexOf(tool.category);
    for (let i = 0; i < categories.length; i++) {
      vector.push(i === categoryIndex ? 1 : 0);
    }

    // 2. 标签特征 (TF-IDF简化版本)
    const allTags = ['code', 'file', 'data', 'test', 'doc', 'format', 'debug', 'chart'];
    for (const tag of allTags) {
      vector.push(tool.tags.includes(tag) ? 1 : 0);
    }

    return vector;
  }

  /**
   * 计算工具相似度 (余弦相似度)
   * @param {string} tool1 - 工具1
   * @param {string} tool2 - 工具2
   * @returns {number} 相似度 [0, 1]
   */
  calculateToolSimilarity(tool1, tool2) {
    const cacheKey = `${tool1}:${tool2}`;
    if (this.toolSimilarity.has(cacheKey)) {
      return this.toolSimilarity.get(cacheKey);
    }

    const features1 = this.toolFeatures.get(tool1);
    const features2 = this.toolFeatures.get(tool2);

    if (!features1 || !features2) {
      return 0;
    }

    // 1. 类别相似度
    const categorySimilarity = features1.category === features2.category ? 1 : 0;

    // 2. 标签相似度 (Jaccard)
    const tags1 = features1.tags;
    const tags2 = features2.tags;
    const intersection = new Set([...tags1].filter(t => tags2.has(t)));
    const union = new Set([...tags1, ...tags2]);
    const tagSimilarity = union.size > 0 ? intersection.size / union.size : 0;

    // 3. 特征向量余弦相似度
    const vector1 = features1.vector;
    const vector2 = features2.vector;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      norm1 += vector1[i] * vector1[i];
      norm2 += vector2[i] * vector2[i];
    }

    const vectorSimilarity = (norm1 === 0 || norm2 === 0)
      ? 0
      : dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));

    // 加权平均
    const similarity = categorySimilarity * 0.4 + tagSimilarity * 0.3 + vectorSimilarity * 0.3;

    // 缓存结果
    this.toolSimilarity.set(cacheKey, similarity);
    this.toolSimilarity.set(`${tool2}:${tool1}`, similarity); // 对称性

    return similarity;
  }

  /**
   * 查找相似工具
   * @param {string} toolName - 工具名称
   * @returns {Array} 相似工具列表 [{tool, similarity}]
   */
  findSimilarTools(toolName) {
    if (this.toolFeatures.size === 0) {
      this.buildToolFeatures();
    }

    const similarTools = [];

    for (const [otherTool, _] of this.toolFeatures.entries()) {
      if (otherTool === toolName) {continue;}

      const similarity = this.calculateToolSimilarity(toolName, otherTool);

      if (similarity >= this.config.minSimilarity) {
        similarTools.push({ tool: otherTool, similarity });
      }
    }

    similarTools.sort((a, b) => b.similarity - a.similarity);
    return similarTools.slice(0, this.config.topKSimilar);
  }

  /**
   * 构建工具链统计
   */
  async buildToolChains() {
    if (!this.db) {return;}

    logger.info('[ContentRecommender] 构建工具链统计...');

    try {
      // 查询工具序列 (previous_tool → tool_name → next_tool)
      const chains = this.db.prepare(`
        SELECT
          previous_tool,
          tool_name,
          COUNT(*) as count
        FROM tool_usage_events
        WHERE previous_tool IS NOT NULL
        GROUP BY previous_tool, tool_name
        ORDER BY count DESC
      `).all();

      this.toolChains.clear();

      for (const chain of chains) {
        if (!this.toolChains.has(chain.previous_tool)) {
          this.toolChains.set(chain.previous_tool, []);
        }

        this.toolChains.get(chain.previous_tool).push({
          nextTool: chain.tool_name,
          count: chain.count,
          probability: 0 // 后续计算
        });
      }

      // 计算条件概率
      for (const [prevTool, nextTools] of this.toolChains.entries()) {
        const totalCount = nextTools.reduce((sum, t) => sum + t.count, 0);
        for (const tool of nextTools) {
          tool.probability = tool.count / totalCount;
        }
      }

      logger.info(`[ContentRecommender] 工具链构建完成: ${this.toolChains.size}个起始工具`);
    } catch (error) {
      logger.error('[ContentRecommender] 构建工具链失败:', error);
    }
  }

  /**
   * 基于内容推荐工具
   * @param {string} userId - 用户ID
   * @param {number} topK - 推荐数量
   * @returns {Array} 推荐列表
   */
  async recommendTools(userId, topK = 5) {
    if (!this.db) {
      return [];
    }

    if (this.toolFeatures.size === 0) {
      await this.buildToolFeatures();
    }

    try {
      // 1. 获取用户最近使用的工具
      const recentTools = this.db.prepare(`
        SELECT DISTINCT tool_name, MAX(timestamp) as last_used
        FROM tool_usage_events
        WHERE user_id = ?
          AND timestamp >= datetime('now', '-7 days')
        GROUP BY tool_name
        ORDER BY last_used DESC
        LIMIT 5
      `).all(userId);

      if (recentTools.length === 0) {
        logger.info('[ContentRecommender] 用户无最近使用记录');
        return [];
      }

      // 2. 基于相似度推荐
      const toolScores = new Map();

      for (const { tool_name } of recentTools) {
        const similarTools = this.findSimilarTools(tool_name);

        for (const { tool, similarity } of similarTools) {
          if (!toolScores.has(tool)) {
            toolScores.set(tool, {
              totalScore: 0,
              count: 0,
              basedOnTools: []
            });
          }

          const data = toolScores.get(tool);
          data.totalScore += similarity;
          data.count++;
          data.basedOnTools.push({ tool: tool_name, similarity });
        }
      }

      // 3. 计算最终评分
      const recommendations = [];
      for (const [tool, data] of toolScores.entries()) {
        const avgScore = data.totalScore / data.count;

        recommendations.push({
          tool,
          score: avgScore,
          confidence: Math.min(data.count / recentTools.length, 1.0),
          reason: this.generateReason(data.basedOnTools),
          algorithm: 'content_based'
        });
      }

      recommendations.sort((a, b) => b.score - a.score);

      this.stats.totalRecommendations++;
      if (recommendations.length > 0) {
        this.stats.avgSimilarity =
          (this.stats.avgSimilarity * (this.stats.totalRecommendations - 1) +
            recommendations[0].score) / this.stats.totalRecommendations;
      }

      return recommendations.slice(0, topK);
    } catch (error) {
      logger.error('[ContentRecommender] 推荐失败:', error);
      return [];
    }
  }

  /**
   * 工具链推荐
   * @param {string} currentTool - 当前工具
   * @param {number} topK - 推荐数量
   * @returns {Array} 推荐列表
   */
  async recommendNextTools(currentTool, topK = 3) {
    if (this.toolChains.size === 0) {
      await this.buildToolChains();
    }

    const nextTools = this.toolChains.get(currentTool);

    if (!nextTools || nextTools.length === 0) {
      return [];
    }

    const recommendations = nextTools.slice(0, topK).map(t => ({
      tool: t.nextTool,
      score: t.probability,
      confidence: t.probability,
      reason: `${(t.probability * 100).toFixed(0)}%用户在${currentTool}后使用`,
      algorithm: 'tool_chain'
    }));

    this.stats.toolChainRecommendations++;

    return recommendations;
  }

  /**
   * 生成推荐理由
   */
  generateReason(basedOnTools) {
    if (basedOnTools.length === 0) {
      return '基于内容推荐';
    }

    const topTool = basedOnTools[0];
    const similarity = (topTool.similarity * 100).toFixed(0);

    return `与${topTool.tool}相似 (${similarity}%)`;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      toolCount: this.toolFeatures.size,
      toolChainCount: this.toolChains.size,
      avgSimilarity: (this.stats.avgSimilarity * 100).toFixed(1) + '%'
    };
  }
}

module.exports = ContentRecommender;
