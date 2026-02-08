/**
 * MLToolMatcher - ML工具匹配器
 * P2智能层Phase 3 - 智能工具推荐
 *
 * 功能:
 * - 基于特征的工具推荐
 * - 多因子评分机制
 * - Top-K推荐
 * - 置信度计算
 * - 推荐解释生成
 *
 * Version: v0.23.0
 * Date: 2026-01-02
 */

const { logger } = require("../utils/logger.js");
const FeatureExtractor = require("./feature-extractor");

class MLToolMatcher {
  constructor(config = {}) {
    this.config = {
      topK: 5, // 推荐Top-K工具
      minConfidence: 0.3, // 最小置信度阈值
      enableML: false, // 启用ML模型 (预留)
      mlModelPath: null, // ML模型路径
      scoreWeights: {
        textMatch: 0.3, // 文本匹配权重
        userPreference: 0.35, // 用户偏好权重
        historicalSuccess: 0.25, // 历史成功率权重
        recency: 0.1, // 最近使用权重
      },
      ...config,
    };

    this.featureExtractor = new FeatureExtractor();
    this.db = null;
    this.toolRegistry = null;

    this.stats = {
      totalRecommendations: 0,
      acceptedRecommendations: 0,
      rejectedRecommendations: 0,
      avgConfidence: 0,
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
    this.featureExtractor.setDatabase(db);
  }

  /**
   * 设置工具注册表
   */
  setToolRegistry(toolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * 推荐工具
   * @param {Object} task - 任务对象
   * @param {string} userId - 用户ID
   * @returns {Array} 推荐工具列表
   */
  async recommendTools(task, userId) {
    try {
      // 1. 提取特征
      const features = await this.featureExtractor.extractFeatures(
        task,
        userId,
      );

      // 2. 获取候选工具
      const candidates = this.getCandidateTools(features);

      // 3. 计算每个工具的评分
      const scoredTools = await this.scoreTools(candidates, features, userId);

      // 4. 排序并取Top-K
      const recommendations = scoredTools
        .filter((t) => t.confidence >= this.config.minConfidence)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.topK);

      // 5. 生成推荐解释
      for (const rec of recommendations) {
        rec.reason = this.generateExplanation(rec, features);
      }

      // 6. 记录推荐
      await this.logRecommendation(userId, task, recommendations);

      this.stats.totalRecommendations++;
      this.stats.avgConfidence =
        (this.stats.avgConfidence * (this.stats.totalRecommendations - 1) +
          (recommendations[0]?.confidence || 0)) /
        this.stats.totalRecommendations;

      return recommendations;
    } catch (error) {
      logger.error("[MLToolMatcher] 推荐失败:", error);
      return [];
    }
  }

  /**
   * 获取候选工具
   */
  getCandidateTools(features) {
    if (!this.toolRegistry) {
      // 默认工具列表
      return [
        { name: "codeGeneration", category: "development" },
        { name: "fileWrite", category: "development" },
        { name: "fileRead", category: "development" },
        { name: "formatCode", category: "development" },
        { name: "debugging", category: "development" },
        { name: "testing", category: "development" },
        { name: "dataAnalysis", category: "data" },
        { name: "chartGeneration", category: "data" },
        { name: "documentation", category: "writing" },
        { name: "markdown", category: "writing" },
      ];
    }

    // 从工具注册表获取
    return this.toolRegistry.getAllTools().map((tool) => ({
      name: tool.name,
      category: tool.category,
      description: tool.description,
      keywords: tool.keywords || [],
    }));
  }

  /**
   * 为工具评分
   */
  async scoreTools(candidates, features, userId) {
    const scored = [];

    for (const tool of candidates) {
      const score = await this.calculateToolScore(tool, features, userId);
      scored.push({
        tool: tool.name,
        category: tool.category,
        score: score.total,
        confidence: this.scoreToConfidence(score.total),
        breakdown: score,
        timestamp: Date.now(),
      });
    }

    return scored;
  }

  /**
   * 计算工具评分
   */
  async calculateToolScore(tool, features, userId) {
    const weights = this.config.scoreWeights;

    // 1. 文本匹配评分
    const textScore = this.calculateTextMatchScore(tool, features.text);

    // 2. 用户偏好评分
    const preferenceScore = this.calculatePreferenceScore(tool, features.user);

    // 3. 历史成功率评分
    const successScore = await this.calculateHistoricalSuccessScore(
      tool.name,
      userId,
      features,
    );

    // 4. 最近使用评分
    const recencyScore = this.calculateRecencyScore(tool, features.user);

    // 加权总分
    const total =
      textScore * weights.textMatch +
      preferenceScore * weights.userPreference +
      successScore * weights.historicalSuccess +
      recencyScore * weights.recency;

    return {
      total,
      textMatch: textScore,
      userPreference: preferenceScore,
      historicalSuccess: successScore,
      recency: recencyScore,
    };
  }

  /**
   * 文本匹配评分
   */
  calculateTextMatchScore(tool, textFeatures) {
    let score = 0;

    // 类别匹配
    if (tool.category === textFeatures.detectedCategory) {
      score += 0.5;
    }

    // 关键词匹配
    const toolName = tool.name.toLowerCase();
    const keywords = textFeatures.keywords.map((k) => k.word);

    for (const keyword of keywords) {
      if (toolName.includes(keyword) || keyword.includes(toolName)) {
        score += 0.1;
      }
    }

    // 描述匹配
    if (tool.description) {
      const desc = tool.description.toLowerCase();
      for (const keyword of keywords) {
        if (desc.includes(keyword)) {
          score += 0.05;
        }
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * 用户偏好评分
   */
  calculatePreferenceScore(tool, userFeatures) {
    let score = 0;

    // 偏好工具列表匹配
    if (userFeatures.preferredTools.includes(tool.name)) {
      const index = userFeatures.preferredTools.indexOf(tool.name);
      score += 1.0 - (index / userFeatures.preferredTools.length) * 0.5;
    }

    // 最近使用的工具
    const recentTool = userFeatures.recentTools.find(
      (t) => t.tool === tool.name,
    );
    if (recentTool) {
      score += 0.3 * (recentTool.count / 10);
    }

    return Math.min(score, 1.0);
  }

  /**
   * 历史成功率评分
   */
  async calculateHistoricalSuccessScore(toolName, userId, features) {
    if (!this.db) {
      return 0.5;
    }

    try {
      // 查询该工具的历史成功率
      const stats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
        FROM tool_usage_events
        WHERE user_id = ?
          AND tool_name = ?
          AND tool_category = ?
      `,
        )
        .get(userId, toolName, features.text.detectedCategory);

      if (!stats || stats.total === 0) {
        // 没有历史记录，返回中等分数
        return 0.5;
      }

      const successRate = stats.successes / stats.total;

      // 考虑样本量 (贝叶斯平滑)
      const priorSuccessRate = 0.7; // 先验成功率
      const priorWeight = 10; // 先验权重

      const smoothedRate =
        (successRate * stats.total + priorSuccessRate * priorWeight) /
        (stats.total + priorWeight);

      return smoothedRate;
    } catch (error) {
      logger.error("[MLToolMatcher] 查询历史成功率失败:", error);
      return 0.5;
    }
  }

  /**
   * 最近使用评分
   */
  calculateRecencyScore(tool, userFeatures) {
    const recentTool = userFeatures.recentTools.find(
      (t) => t.tool === tool.name,
    );
    if (!recentTool) {
      return 0;
    }

    // 使用次数归一化
    const normalizedCount = Math.min(recentTool.count / 10, 1.0);

    // 成功率加权
    const weightedScore = normalizedCount * recentTool.successRate;

    return weightedScore;
  }

  /**
   * 评分转置信度
   */
  scoreToConfidence(score) {
    // Sigmoid函数映射到 [0, 1]
    return 1 / (1 + Math.exp(-5 * (score - 0.5)));
  }

  /**
   * 生成推荐解释
   */
  generateExplanation(recommendation, features) {
    const reasons = [];

    // 文本匹配
    if (recommendation.breakdown.textMatch > 0.5) {
      reasons.push(`任务类型匹配 (${features.text.detectedCategory})`);
    }

    // 用户偏好
    if (recommendation.breakdown.userPreference > 0.6) {
      reasons.push("符合您的使用习惯");
    }

    // 历史成功率
    if (recommendation.breakdown.historicalSuccess > 0.7) {
      reasons.push(
        `历史成功率${(recommendation.breakdown.historicalSuccess * 100).toFixed(0)}%`,
      );
    }

    // 最近使用
    if (recommendation.breakdown.recency > 0.5) {
      reasons.push("最近常用");
    }

    return reasons.join(", ") || "系统推荐";
  }

  /**
   * 记录推荐
   */
  async logRecommendation(userId, task, recommendations) {
    if (!this.db) {
      return;
    }

    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO tool_recommendations (
          user_id,
          session_id,
          task_description,
          task_context,
          recommended_tools,
          recommendation_scores,
          algorithm_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        userId,
        task.sessionId || "unknown",
        task.description || "",
        task.context ? JSON.stringify(task.context) : null,
        JSON.stringify(recommendations.map((r) => r.tool)),
        JSON.stringify(
          recommendations.map((r) => ({
            tool: r.tool,
            score: r.score,
            confidence: r.confidence,
          })),
        ),
        this.config.enableML ? "ml_model" : "rule_based",
      );
    } catch (error) {
      logger.error("[MLToolMatcher] 记录推荐失败:", error);
    }
  }

  /**
   * 反馈推荐结果
   */
  async feedbackRecommendation(recommendationId, feedback) {
    if (!this.db) {
      return;
    }

    try {
      this.db
        .prepare(
          `
        UPDATE tool_recommendations
        SET
          user_action = ?,
          actual_tools_used = ?,
          was_helpful = ?
        WHERE id = ?
      `,
        )
        .run(
          feedback.action,
          JSON.stringify(feedback.actualTools || []),
          feedback.wasHelpful ? 1 : 0,
          recommendationId,
        );

      if (feedback.action === "accepted") {
        this.stats.acceptedRecommendations++;
      } else if (feedback.action === "rejected") {
        this.stats.rejectedRecommendations++;
      }
    } catch (error) {
      logger.error("[MLToolMatcher] 反馈失败:", error);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      acceptanceRate:
        this.stats.totalRecommendations > 0
          ? (
              (this.stats.acceptedRecommendations /
                this.stats.totalRecommendations) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * 批量推荐
   */
  async recommendBatch(tasks, userId) {
    const recommendations = [];
    for (const task of tasks) {
      const recs = await this.recommendTools(task, userId);
      recommendations.push({ task, recommendations: recs });
    }
    return recommendations;
  }
}

module.exports = MLToolMatcher;
