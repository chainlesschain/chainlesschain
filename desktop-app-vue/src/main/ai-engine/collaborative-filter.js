const { logger } = require("../utils/logger.js");

/**
 * CollaborativeFilter - 协同过滤推荐算法
 * P2智能层Phase 4 - 推荐系统
 *
 * 功能:
 * - 用户-工具矩阵构建
 * - 用户相似度计算 (余弦相似度)
 * - 基于相似用户的工具推荐
 * - 评分预测
 *
 * Version: v0.24.0
 * Date: 2026-01-02
 */

class CollaborativeFilter {
  constructor(config = {}) {
    this.config = {
      minSimilarity: 0.1, // 最小相似度阈值
      topKUsers: 10, // 考虑Top-K相似用户
      minCommonTools: 2, // 最小共同工具数
      enableCache: true, // 启用相似度缓存
      ...config,
    };

    this.db = null;
    this.userToolMatrix = new Map(); // 用户-工具矩阵
    this.similarityCache = new Map(); // 相似度缓存

    this.stats = {
      totalRecommendations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgSimilarity: 0,
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 构建用户-工具矩阵
   * @returns {Map<userId, Map<toolName, rating>>}
   */
  async buildUserToolMatrix() {
    if (!this.db) {
      throw new Error("数据库未设置");
    }

    logger.info("[CollaborativeFilter] 构建用户-工具矩阵...");

    try {
      // 查询所有用户的工具使用记录
      const usageData = this.db
        .prepare(
          `
        SELECT
          user_id,
          tool_name,
          COUNT(*) as usage_count,
          AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
          AVG(execution_time) as avg_time
        FROM tool_usage_events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY user_id, tool_name
      `,
        )
        .all();

      this.userToolMatrix.clear();

      for (const row of usageData) {
        if (!this.userToolMatrix.has(row.user_id)) {
          this.userToolMatrix.set(row.user_id, new Map());
        }

        const toolMap = this.userToolMatrix.get(row.user_id);

        // 计算评分: 使用次数 * 成功率 (归一化到1-5)
        const rawRating = Math.log(row.usage_count + 1) * row.success_rate;
        const rating = Math.min(5, Math.max(1, rawRating * 2 + 1));

        toolMap.set(row.tool_name, {
          rating,
          usageCount: row.usage_count,
          successRate: row.success_rate,
          avgTime: row.avg_time,
        });
      }

      logger.info(
        `[CollaborativeFilter] 矩阵构建完成: ${this.userToolMatrix.size}个用户`,
      );
      return this.userToolMatrix;
    } catch (error) {
      logger.error("[CollaborativeFilter] 构建矩阵失败:", error);
      throw error;
    }
  }

  /**
   * 计算两个用户的相似度 (余弦相似度)
   * @param {string} userId1 - 用户1
   * @param {string} userId2 - 用户2
   * @returns {number} 相似度 [0, 1]
   */
  calculateUserSimilarity(userId1, userId2) {
    // 检查缓存
    const cacheKey = `${userId1}:${userId2}`;
    if (this.config.enableCache && this.similarityCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.similarityCache.get(cacheKey);
    }

    this.stats.cacheMisses++;

    const tools1 = this.userToolMatrix.get(userId1);
    const tools2 = this.userToolMatrix.get(userId2);

    if (!tools1 || !tools2) {
      return 0;
    }

    // 找到共同工具
    const commonTools = [];
    for (const [tool, data1] of tools1.entries()) {
      if (tools2.has(tool)) {
        commonTools.push({
          tool,
          rating1: data1.rating,
          rating2: tools2.get(tool).rating,
        });
      }
    }

    // 共同工具数不足
    if (commonTools.length < this.config.minCommonTools) {
      return 0;
    }

    // 计算余弦相似度
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const { rating1, rating2 } of commonTools) {
      dotProduct += rating1 * rating2;
      norm1 += rating1 * rating1;
      norm2 += rating2 * rating2;
    }

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));

    // 缓存结果
    if (this.config.enableCache) {
      this.similarityCache.set(cacheKey, similarity);
      this.similarityCache.set(`${userId2}:${userId1}`, similarity); // 对称性
    }

    return similarity;
  }

  /**
   * 查找相似用户
   * @param {string} userId - 目标用户
   * @returns {Array} 相似用户列表 [{userId, similarity}]
   */
  async findSimilarUsers(userId) {
    if (this.userToolMatrix.size === 0) {
      await this.buildUserToolMatrix();
    }

    const similarUsers = [];

    for (const [otherUserId, _] of this.userToolMatrix.entries()) {
      if (otherUserId === userId) {
        continue;
      }

      const similarity = this.calculateUserSimilarity(userId, otherUserId);

      if (similarity >= this.config.minSimilarity) {
        similarUsers.push({ userId: otherUserId, similarity });
      }
    }

    // 按相似度降序排序，取Top-K
    similarUsers.sort((a, b) => b.similarity - a.similarity);
    return similarUsers.slice(0, this.config.topKUsers);
  }

  /**
   * 基于协同过滤推荐工具
   * @param {string} userId - 目标用户
   * @param {number} topK - 推荐数量
   * @returns {Array} 推荐列表 [{tool, score, reason}]
   */
  async recommendTools(userId, topK = 5) {
    try {
      // 1. 查找相似用户
      const similarUsers = await this.findSimilarUsers(userId);

      if (similarUsers.length === 0) {
        logger.info("[CollaborativeFilter] 未找到相似用户");
        return [];
      }

      // 2. 获取目标用户已使用的工具
      const userTools = this.userToolMatrix.get(userId) || new Map();
      const usedTools = new Set(userTools.keys());

      // 3. 聚合相似用户的工具评分
      const toolScores = new Map();

      for (const { userId: simUserId, similarity } of similarUsers) {
        const simUserTools = this.userToolMatrix.get(simUserId);

        for (const [tool, data] of simUserTools.entries()) {
          // 跳过已使用的工具
          if (usedTools.has(tool)) {
            continue;
          }

          // 加权评分 (评分 * 相似度)
          const weightedScore = data.rating * similarity;

          if (!toolScores.has(tool)) {
            toolScores.set(tool, {
              totalScore: 0,
              count: 0,
              similarUsers: [],
            });
          }

          const toolData = toolScores.get(tool);
          toolData.totalScore += weightedScore;
          toolData.count++;
          toolData.similarUsers.push({
            userId: simUserId,
            similarity,
            rating: data.rating,
          });
        }
      }

      // 4. 计算最终评分并排序
      const recommendations = [];
      for (const [tool, data] of toolScores.entries()) {
        const avgScore = data.totalScore / data.count;
        const confidence = Math.min(data.count / similarUsers.length, 1.0);

        recommendations.push({
          tool,
          score: avgScore,
          confidence,
          supportingUsers: data.count,
          reason: this.generateReason(data.similarUsers),
          algorithm: "collaborative_filtering",
        });
      }

      recommendations.sort((a, b) => b.score - a.score);

      this.stats.totalRecommendations++;
      if (recommendations.length > 0) {
        this.stats.avgSimilarity =
          (this.stats.avgSimilarity * (this.stats.totalRecommendations - 1) +
            similarUsers[0].similarity) /
          this.stats.totalRecommendations;
      }

      return recommendations.slice(0, topK);
    } catch (error) {
      logger.error("[CollaborativeFilter] 推荐失败:", error);
      return [];
    }
  }

  /**
   * 预测用户对工具的评分
   * @param {string} userId - 用户ID
   * @param {string} toolName - 工具名称
   * @returns {number} 预测评分 [1, 5]
   */
  async predictRating(userId, toolName) {
    const similarUsers = await this.findSimilarUsers(userId);

    if (similarUsers.length === 0) {
      return 3; // 默认中等评分
    }

    let weightedSum = 0;
    let similaritySum = 0;

    for (const { userId: simUserId, similarity } of similarUsers) {
      const simUserTools = this.userToolMatrix.get(simUserId);

      if (simUserTools && simUserTools.has(toolName)) {
        const rating = simUserTools.get(toolName).rating;
        weightedSum += rating * similarity;
        similaritySum += similarity;
      }
    }

    if (similaritySum === 0) {
      return 3; // 无相关数据，返回中等评分
    }

    return weightedSum / similaritySum;
  }

  /**
   * 生成推荐理由
   */
  generateReason(similarUsers) {
    if (similarUsers.length === 0) {
      return "基于协同过滤推荐";
    }

    const topUser = similarUsers[0];
    const similarity = (topUser.similarity * 100).toFixed(0);
    const count = similarUsers.length;

    return `${count}个相似用户推荐 (相似度${similarity}%)`;
  }

  /**
   * 获取用户-工具矩阵统计
   */
  getMatrixStats() {
    const userCount = this.userToolMatrix.size;
    let totalTools = 0;
    let maxTools = 0;
    let minTools = Infinity;

    for (const [_, tools] of this.userToolMatrix.entries()) {
      const toolCount = tools.size;
      totalTools += toolCount;
      maxTools = Math.max(maxTools, toolCount);
      minTools = Math.min(minTools, toolCount);
    }

    const avgTools = userCount > 0 ? totalTools / userCount : 0;
    const density = userCount > 0 ? (totalTools / (userCount * 10)) * 100 : 0; // 假设10个工具

    return {
      userCount,
      totalEntries: totalTools,
      avgToolsPerUser: avgTools.toFixed(1),
      maxToolsPerUser: maxTools,
      minToolsPerUser: minTools === Infinity ? 0 : minTools,
      matrixDensity: density.toFixed(1) + "%",
    };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      cacheHitRate:
        this.stats.cacheMisses > 0
          ? (
              (this.stats.cacheHits /
                (this.stats.cacheHits + this.stats.cacheMisses)) *
              100
            ).toFixed(2) + "%"
          : "0%",
      avgSimilarity: (this.stats.avgSimilarity * 100).toFixed(1) + "%",
      matrixStats: this.getMatrixStats(),
    };
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.similarityCache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
    logger.info("[CollaborativeFilter] 缓存已清除");
  }

  /**
   * 刷新矩阵
   */
  async refreshMatrix() {
    this.userToolMatrix.clear();
    this.clearCache();
    await this.buildUserToolMatrix();
  }
}

module.exports = CollaborativeFilter;
