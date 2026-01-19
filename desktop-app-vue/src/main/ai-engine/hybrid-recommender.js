/**
 * HybridRecommender - 混合推荐系统
 * P2智能层Phase 4 - 推荐系统
 *
 * 功能:
 * - 融合ML推荐、协同过滤、内容推荐
 * - 动态权重调整
 * - 多样性优化
 * - 增强推荐解释
 *
 * Version: v0.24.0
 * Date: 2026-01-02
 */

const MLToolMatcher = require('./ml-tool-matcher');
const CollaborativeFilter = require('./collaborative-filter');
const ContentRecommender = require('./content-recommender');

class HybridRecommender {
  constructor(config = {}) {
    this.config = {
      topK: 5,                   // 推荐数量
      minConfidence: 0.15,       // 最小置信度
      weights: {
        ml: 0.4,                 // ML推荐权重
        collaborative: 0.35,     // 协同过滤权重
        content: 0.25            // 内容推荐权重
      },
      enableDiversity: true,     // 启用多样性优化
      diversityPenalty: 0.1,     // 多样性惩罚系数
      enableAdaptiveWeights: false, // 启用自适应权重
      ...config
    };

    this.mlMatcher = new MLToolMatcher();
    this.collaborativeFilter = new CollaborativeFilter();
    this.contentRecommender = new ContentRecommender();

    this.db = null;

    this.stats = {
      totalRecommendations: 0,
      mlContributions: 0,
      collaborativeContributions: 0,
      contentContributions: 0,
      avgConfidence: 0,
      diversityScore: 0
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
    this.mlMatcher.setDatabase(db);
    this.collaborativeFilter.setDatabase(db);
    this.contentRecommender.setDatabase(db);
  }

  /**
   * 混合推荐
   * @param {Object} task - 任务对象
   * @param {string} userId - 用户ID
   * @returns {Array} 推荐列表
   */
  async recommend(task, userId) {
    try {
      console.log('[HybridRecommender] 开始混合推荐...');

      // 1. 获取三种算法的推荐结果
      const [mlRecs, cfRecs, cbRecs] = await Promise.all([
        this.mlMatcher.recommendTools(task, userId).catch(() => []),
        this.collaborativeFilter.recommendTools(userId, 10).catch(() => []),
        this.contentRecommender.recommendTools(userId, 10).catch(() => [])
      ]);

      console.log(`[HybridRecommender] ML: ${mlRecs.length}, CF: ${cfRecs.length}, CB: ${cbRecs.length}`);

      // 2. 计算权重 (可选自适应)
      const weights = this.config.enableAdaptiveWeights
        ? this.calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs)
        : this.config.weights;

      // 3. 融合评分
      const fusedScores = this.fuseRecommendations(
        mlRecs,
        cfRecs,
        cbRecs,
        weights
      );

      // 4. 多样性优化
      let recommendations = Array.from(fusedScores.values());

      if (this.config.enableDiversity) {
        recommendations = this.optimizeDiversity(recommendations);
      }

      // 5. 过滤和排序
      recommendations = recommendations
        .filter(r => r.confidence >= this.config.minConfidence)
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, this.config.topK);

      // 6. 增强推荐解释
      for (const rec of recommendations) {
        rec.reason = this.generateEnhancedExplanation(rec);
      }

      // 7. 统计
      this.updateStats(recommendations);

      console.log(`[HybridRecommender] 最终推荐${recommendations.length}个工具`);

      return recommendations;
    } catch (error) {
      console.error('[HybridRecommender] 推荐失败:', error);
      return [];
    }
  }

  /**
   * 融合推荐结果
   */
  fuseRecommendations(mlRecs, cfRecs, cbRecs, weights) {
    const fusedScores = new Map();

    // 归一化函数
    const normalize = (recs) => {
      if (recs.length === 0) {return [];}
      const maxScore = Math.max(...recs.map(r => r.score || r.confidence || 1));
      return recs.map(r => ({
        ...r,
        normalizedScore: (r.score || r.confidence || 0) / maxScore
      }));
    };

    // 归一化所有推荐
    const normalizedML = normalize(mlRecs);
    const normalizedCF = normalize(cfRecs);
    const normalizedCB = normalize(cbRecs);

    // 融合ML推荐
    for (const rec of normalizedML) {
      const tool = rec.tool;
      if (!fusedScores.has(tool)) {
        fusedScores.set(tool, this.createFusedEntry(tool));
      }

      const entry = fusedScores.get(tool);
      entry.mlScore = rec.normalizedScore;
      entry.mlConfidence = rec.confidence || rec.normalizedScore;
      entry.mlReason = rec.reason || '';
      entry.mlBreakdown = rec.breakdown;
      this.stats.mlContributions++;
    }

    // 融合协同过滤推荐
    for (const rec of normalizedCF) {
      const tool = rec.tool;
      if (!fusedScores.has(tool)) {
        fusedScores.set(tool, this.createFusedEntry(tool));
      }

      const entry = fusedScores.get(tool);
      entry.cfScore = rec.normalizedScore;
      entry.cfConfidence = rec.confidence || rec.normalizedScore;
      entry.cfReason = rec.reason || '';
      entry.cfSupportingUsers = rec.supportingUsers;
      this.stats.collaborativeContributions++;
    }

    // 融合内容推荐
    for (const rec of normalizedCB) {
      const tool = rec.tool;
      if (!fusedScores.has(tool)) {
        fusedScores.set(tool, this.createFusedEntry(tool));
      }

      const entry = fusedScores.get(tool);
      entry.cbScore = rec.normalizedScore;
      entry.cbConfidence = rec.confidence || rec.normalizedScore;
      entry.cbReason = rec.reason || '';
      this.stats.contentContributions++;
    }

    // 计算最终评分
    for (const [_, entry] of fusedScores.entries()) {
      entry.finalScore =
        entry.mlScore * weights.ml +
        entry.cfScore * weights.collaborative +
        entry.cbScore * weights.content;

      entry.confidence =
        (entry.mlConfidence * weights.ml +
          entry.cfConfidence * weights.collaborative +
          entry.cbConfidence * weights.content) /
        (weights.ml + weights.collaborative + weights.content);

      entry.algorithmCount = [
        entry.mlScore > 0,
        entry.cfScore > 0,
        entry.cbScore > 0
      ].filter(Boolean).length;

      entry.weights = { ...weights };
    }

    return fusedScores;
  }

  /**
   * 创建融合条目
   */
  createFusedEntry(tool) {
    return {
      tool,
      mlScore: 0,
      cfScore: 0,
      cbScore: 0,
      mlConfidence: 0,
      cfConfidence: 0,
      cbConfidence: 0,
      mlReason: '',
      cfReason: '',
      cbReason: '',
      finalScore: 0,
      confidence: 0,
      algorithmCount: 0,
      category: null,
      weights: {}
    };
  }

  /**
   * 计算自适应权重
   */
  calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs) {
    // 根据推荐数量和质量动态调整权重
    const mlQuality = mlRecs.length > 0
      ? mlRecs.reduce((sum, r) => sum + (r.confidence || 0), 0) / mlRecs.length
      : 0;
    const cfQuality = cfRecs.length > 0
      ? cfRecs.reduce((sum, r) => sum + (r.confidence || 0), 0) / cfRecs.length
      : 0;
    const cbQuality = cbRecs.length > 0
      ? cbRecs.reduce((sum, r) => sum + (r.confidence || 0), 0) / cbRecs.length
      : 0;

    const totalQuality = mlQuality + cfQuality + cbQuality;

    if (totalQuality === 0) {
      return this.config.weights;
    }

    return {
      ml: mlQuality / totalQuality,
      collaborative: cfQuality / totalQuality,
      content: cbQuality / totalQuality
    };
  }

  /**
   * 多样性优化
   */
  optimizeDiversity(recommendations) {
    if (recommendations.length <= 1) {
      return recommendations;
    }

    // 基于类别多样性重新评分
    const categoryCount = new Map();

    for (const rec of recommendations) {
      // 假设从工具特征获取类别
      const category = this.getToolCategory(rec.tool);
      rec.category = category;

      categoryCount.set(
        category,
        (categoryCount.get(category) || 0) + 1
      );
    }

    // 对重复类别的工具施加惩罚
    for (const rec of recommendations) {
      const count = categoryCount.get(rec.category) || 1;
      const penalty = 1 - (count - 1) * this.config.diversityPenalty;
      rec.finalScore *= Math.max(penalty, 0.5); // 最多惩罚50%
    }

    // 计算多样性分数
    const uniqueCategories = categoryCount.size;
    const totalTools = recommendations.length;
    this.stats.diversityScore = uniqueCategories / Math.max(totalTools, 1);

    return recommendations;
  }

  /**
   * 获取工具类别
   */
  getToolCategory(toolName) {
    const categoryMap = {
      codeGeneration: 'development',
      fileWrite: 'development',
      fileRead: 'development',
      formatCode: 'development',
      debugging: 'development',
      testing: 'development',
      dataAnalysis: 'data',
      chartGeneration: 'data',
      documentation: 'writing',
      markdown: 'writing'
    };

    return categoryMap[toolName] || 'general';
  }

  /**
   * 生成增强推荐解释
   */
  generateEnhancedExplanation(rec) {
    const reasons = [];

    // ML推荐理由
    if (rec.mlScore > 0 && rec.mlReason) {
      reasons.push(`ML: ${rec.mlReason}`);
    }

    // 协同过滤理由
    if (rec.cfScore > 0 && rec.cfReason) {
      reasons.push(`CF: ${rec.cfReason}`);
    }

    // 内容推荐理由
    if (rec.cbScore > 0 && rec.cbReason) {
      reasons.push(`CB: ${rec.cbReason}`);
    }

    // 多算法一致性
    if (rec.algorithmCount >= 2) {
      reasons.push(`${rec.algorithmCount}个算法一致推荐`);
    }

    return reasons.length > 0 ? reasons.join(' | ') : '系统推荐';
  }

  /**
   * 更新统计信息
   */
  updateStats(recommendations) {
    this.stats.totalRecommendations++;

    if (recommendations.length > 0) {
      const totalConfidence = recommendations.reduce(
        (sum, r) => sum + r.confidence,
        0
      );
      const avgConfidence = totalConfidence / recommendations.length;

      this.stats.avgConfidence =
        (this.stats.avgConfidence * (this.stats.totalRecommendations - 1) +
          avgConfidence) / this.stats.totalRecommendations;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.stats.mlContributions +
      this.stats.collaborativeContributions +
      this.stats.contentContributions;

    return {
      ...this.stats,
      avgConfidence: (this.stats.avgConfidence * 100).toFixed(1) + '%',
      diversityScore: (this.stats.diversityScore * 100).toFixed(1) + '%',
      algorithmDistribution: total > 0 ? {
        ml: ((this.stats.mlContributions / total) * 100).toFixed(1) + '%',
        collaborative: ((this.stats.collaborativeContributions / total) * 100).toFixed(1) + '%',
        content: ((this.stats.contentContributions / total) * 100).toFixed(1) + '%'
      } : null,
      mlStats: this.mlMatcher.getStats(),
      cfStats: this.collaborativeFilter.getStats(),
      cbStats: this.contentRecommender.getStats()
    };
  }

  /**
   * 调整权重
   */
  setWeights(weights) {
    this.config.weights = { ...this.config.weights, ...weights };
  }

  /**
   * 初始化推荐器
   */
  async initialize() {
    console.log('[HybridRecommender] 初始化推荐器...');
    await Promise.all([
      this.collaborativeFilter.buildUserToolMatrix().catch(e =>
        console.log('[HybridRecommender] CF矩阵构建失败:', e.message)
      ),
      this.contentRecommender.buildToolFeatures().catch(e =>
        console.log('[HybridRecommender] CB特征构建失败:', e.message)
      ),
      this.contentRecommender.buildToolChains().catch(e =>
        console.log('[HybridRecommender] 工具链构建失败:', e.message)
      )
    ]);
    console.log('[HybridRecommender] 初始化完成');
  }
}

module.exports = HybridRecommender;
