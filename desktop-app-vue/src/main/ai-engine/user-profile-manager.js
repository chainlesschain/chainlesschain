const { logger } = require("../utils/logger.js");

/**
 * UserProfileManager - 用户画像管理器
 * P2智能层用户画像系统
 *
 * 功能:
 * - 用户画像CRUD操作
 * - 技能水平评估
 * - 偏好提取与分析
 * - 时间模式识别
 * - 自动画像更新
 * - LRU缓存优化
 *
 * Version: v0.21.0
 * Date: 2026-01-02
 */

/**
 * 简单LRU缓存实现
 */
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

class UserProfileManager {
  constructor(config = {}) {
    this.config = {
      updateInterval: 3600000, // 1小时更新一次
      minDataPoints: 10, // 最少10个数据点才建立画像
      enableTemporalAnalysis: true, // 启用时间模式分析
      cacheSize: 1000, // 缓存大小
      skillLevelThresholds: {
        // 技能水平阈值
        beginner: 0.4,
        intermediate: 0.7,
        advanced: 0.9,
      },
      ...config,
    };

    this.db = null;
    this.cache = new LRUCache(this.config.cacheSize);

    this.stats = {
      totalProfiles: 0,
      cacheHits: 0,
      cacheMisses: 0,
      profilesCreated: 0,
      profilesUpdated: 0,
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 获取用户画像
   * @param {string} userId - 用户ID
   * @returns {Object} 用户画像对象
   */
  async getProfile(userId) {
    // 1. 检查缓存
    if (this.cache.has(userId)) {
      this.stats.cacheHits++;
      return this.cache.get(userId);
    }

    this.stats.cacheMisses++;

    // 2. 从数据库加载
    let profile = await this.loadProfileFromDB(userId);

    // 3. 如果不存在，创建新画像
    if (!profile) {
      profile = await this.buildNewProfile(userId);
    }

    // 4. 缓存并返回
    this.cache.set(userId, profile);
    return profile;
  }

  /**
   * 从数据库加载用户画像
   */
  async loadProfileFromDB(userId) {
    if (!this.db) {
      return null;
    }

    try {
      const row = this.db
        .prepare(
          `
        SELECT * FROM user_profiles WHERE user_id = ?
      `,
        )
        .get(userId);

      if (!row) {
        return null;
      }

      return {
        userId: row.user_id,
        skillLevel: {
          overall: row.overall_skill_level,
          domains: row.domain_skills ? JSON.parse(row.domain_skills) : {},
        },
        preferences: {
          preferredTools: row.preferred_tools
            ? JSON.parse(row.preferred_tools)
            : [],
          preferredWorkflow: row.preferred_workflow,
          responseExpectation: row.response_expectation,
        },
        statistics: {
          totalTasks: row.total_tasks,
          successRate: row.success_rate,
          avgTaskDuration: row.avg_task_duration,
          mostUsedTools: row.most_used_tools
            ? JSON.parse(row.most_used_tools)
            : [],
        },
        temporalPatterns: {
          activeHours: row.active_hours ? JSON.parse(row.active_hours) : [],
          patterns: row.temporal_patterns
            ? JSON.parse(row.temporal_patterns)
            : {},
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logger.error("[UserProfileManager] 加载画像失败:", error);
      return null;
    }
  }

  /**
   * 构建新用户画像
   */
  async buildNewProfile(userId) {
    if (!this.db) {
      return this.createDefaultProfile(userId);
    }

    try {
      // 从历史数据构建画像
      const history = await this.loadUserHistory(userId);

      if (history.length < this.config.minDataPoints) {
        logger.info(
          `[UserProfileManager] 数据点不足(${history.length}/${this.config.minDataPoints})，使用默认画像`,
        );
        return await this.createDefaultProfile(userId);
      }

      const profile = {
        userId,
        skillLevel: this.assessSkillLevel(history),
        preferences: this.extractPreferences(history),
        statistics: this.calculateStatistics(history),
        temporalPatterns: this.config.enableTemporalAnalysis
          ? this.analyzeTemporalPatterns(history)
          : { activeHours: [], patterns: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 保存到数据库
      await this.saveProfile(profile);
      this.stats.profilesCreated++;

      logger.info(`[UserProfileManager] 创建用户画像: ${userId}`);
      return profile;
    } catch (error) {
      logger.error("[UserProfileManager] 构建画像失败:", error);
      return this.createDefaultProfile(userId);
    }
  }

  /**
   * 创建默认画像
   */
  createDefaultProfile(userId) {
    return {
      userId,
      skillLevel: {
        overall: "intermediate",
        domains: {},
      },
      preferences: {
        preferredTools: [],
        preferredWorkflow: "sequential",
        responseExpectation: "balanced",
      },
      statistics: {
        totalTasks: 0,
        successRate: 0,
        avgTaskDuration: 0,
        mostUsedTools: [],
      },
      temporalPatterns: {
        activeHours: [],
        patterns: {},
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 加载用户历史数据
   */
  async loadUserHistory(userId) {
    if (!this.db) {
      return [];
    }

    try {
      const events = this.db
        .prepare(
          `
        SELECT * FROM tool_usage_events
        WHERE user_id = ?
        ORDER BY timestamp DESC
        LIMIT 1000
      `,
        )
        .all(userId);

      return events.map((e) => ({
        toolName: e.tool_name,
        toolCategory: e.tool_category,
        taskType: e.task_type,
        executionTime: e.execution_time,
        success: e.success === 1,
        timestamp: e.timestamp,
      }));
    } catch (error) {
      logger.error("[UserProfileManager] 加载历史数据失败:", error);
      return [];
    }
  }

  /**
   * 评估技能水平
   */
  assessSkillLevel(history) {
    if (history.length === 0) {
      return { overall: "intermediate", domains: {} };
    }

    // 计算成功率
    const successRate =
      history.filter((h) => h.success).length / history.length;

    // 计算平均执行时间
    const avgTime =
      history.reduce((sum, h) => sum + (h.executionTime || 0), 0) /
      history.length;

    // 计算任务复杂度（基于工具类别分布）
    const categories = new Set(
      history.map((h) => h.toolCategory).filter(Boolean),
    );
    const complexityScore = Math.min(categories.size / 5, 1);

    // 综合评分
    const overallScore =
      successRate * 0.5 +
      (avgTime < 3000 ? 0.3 : avgTime < 5000 ? 0.2 : 0.1) +
      complexityScore * 0.2;

    let overall = "beginner";
    if (overallScore >= this.config.skillLevelThresholds.advanced) {
      overall = "advanced";
    } else if (overallScore >= this.config.skillLevelThresholds.intermediate) {
      overall = "intermediate";
    }

    // 领域技能评估
    const domains = this.assessDomainSkills(history);

    return { overall, domains };
  }

  /**
   * 评估领域技能
   */
  assessDomainSkills(history) {
    const domainMap = {
      development: ["codeGeneration", "debugging", "testing"],
      data: ["dataAnalysis", "visualization", "query"],
      design: ["uiDesign", "prototyping", "styling"],
      writing: ["documentation", "copywriting", "translation"],
    };

    const domains = {};

    for (const [domain, tools] of Object.entries(domainMap)) {
      const domainEvents = history.filter((h) =>
        tools.some((tool) =>
          h.toolName.toLowerCase().includes(tool.toLowerCase()),
        ),
      );

      if (domainEvents.length > 0) {
        const successRate =
          domainEvents.filter((e) => e.success).length / domainEvents.length;
        const usage = Math.min(domainEvents.length / history.length, 1);
        domains[domain] = successRate * 0.7 + usage * 0.3;
      }
    }

    return domains;
  }

  /**
   * 提取用户偏好
   */
  extractPreferences(history) {
    if (history.length === 0) {
      return {
        preferredTools: [],
        preferredWorkflow: "sequential",
        responseExpectation: "balanced",
      };
    }

    // 统计工具使用频率
    const toolFrequency = {};
    history.forEach((h) => {
      toolFrequency[h.toolName] = (toolFrequency[h.toolName] || 0) + 1;
    });

    // 排序并取前5个
    const preferredTools = Object.entries(toolFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool]) => tool);

    // 推断工作流偏好（简化版）
    const avgTime =
      history.reduce((sum, h) => sum + (h.executionTime || 0), 0) /
      history.length;
    const preferredWorkflow = avgTime < 2000 ? "parallel" : "sequential";

    // 推断响应时间期望
    const responseExpectation =
      avgTime < 1500 ? "fast" : avgTime < 3000 ? "balanced" : "thorough";

    return {
      preferredTools,
      preferredWorkflow,
      responseExpectation,
    };
  }

  /**
   * 计算统计信息
   */
  calculateStatistics(history) {
    if (history.length === 0) {
      return {
        totalTasks: 0,
        successRate: 0,
        avgTaskDuration: 0,
        mostUsedTools: [],
      };
    }

    const successCount = history.filter((h) => h.success).length;
    const totalTime = history.reduce(
      (sum, h) => sum + (h.executionTime || 0),
      0,
    );

    // 统计最常用工具
    const toolStats = {};
    history.forEach((h) => {
      if (!toolStats[h.toolName]) {
        toolStats[h.toolName] = { count: 0, successCount: 0 };
      }
      toolStats[h.toolName].count++;
      if (h.success) {
        toolStats[h.toolName].successCount++;
      }
    });

    const mostUsedTools = Object.entries(toolStats)
      .map(([tool, stats]) => ({
        tool,
        count: stats.count,
        successRate: stats.successCount / stats.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalTasks: history.length,
      successRate: successCount / history.length,
      avgTaskDuration: Math.round(totalTime / history.length),
      mostUsedTools,
    };
  }

  /**
   * 分析时间模式
   */
  analyzeTemporalPatterns(history) {
    if (history.length === 0) {
      return { activeHours: [], patterns: {} };
    }

    // 统计活跃时段
    const hourCounts = new Array(24).fill(0);
    const dayActivity = {
      Mon: 0,
      Tue: 0,
      Wed: 0,
      Thu: 0,
      Fri: 0,
      Sat: 0,
      Sun: 0,
    };

    history.forEach((h) => {
      const date = new Date(h.timestamp);
      const hour = date.getHours();
      hourCounts[hour]++;

      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const day = days[date.getDay()];
      dayActivity[day]++;
    });

    // 找出活跃时段（使用量>平均值）
    const avgCount = hourCounts.reduce((a, b) => a + b, 0) / 24;
    const activeHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter((h) => h.count > avgCount)
      .map((h) => h.hour);

    // 归一化日活跃度
    const totalDays = Object.values(dayActivity).reduce((a, b) => a + b, 0);
    Object.keys(dayActivity).forEach((day) => {
      dayActivity[day] = totalDays > 0 ? dayActivity[day] / totalDays : 0;
    });

    return {
      activeHours,
      patterns: {
        weekdayActivity: dayActivity,
        peakHour: hourCounts.indexOf(Math.max(...hourCounts)),
      },
    };
  }

  /**
   * 保存用户画像
   */
  async saveProfile(profile) {
    if (!this.db) {
      return;
    }

    try {
      const existing = this.db
        .prepare("SELECT id FROM user_profiles WHERE user_id = ?")
        .get(profile.userId);

      if (existing) {
        // 更新
        const updateStmt = this.db.prepare(`
          UPDATE user_profiles
          SET
            overall_skill_level = ?,
            domain_skills = ?,
            preferred_tools = ?,
            preferred_workflow = ?,
            response_expectation = ?,
            total_tasks = ?,
            success_rate = ?,
            avg_task_duration = ?,
            most_used_tools = ?,
            active_hours = ?,
            temporal_patterns = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `);

        updateStmt.run(
          profile.skillLevel.overall,
          JSON.stringify(profile.skillLevel.domains),
          JSON.stringify(profile.preferences.preferredTools),
          profile.preferences.preferredWorkflow,
          profile.preferences.responseExpectation,
          profile.statistics.totalTasks,
          profile.statistics.successRate,
          profile.statistics.avgTaskDuration,
          JSON.stringify(profile.statistics.mostUsedTools),
          JSON.stringify(profile.temporalPatterns.activeHours),
          JSON.stringify(profile.temporalPatterns.patterns),
          profile.userId,
        );

        this.stats.profilesUpdated++;
      } else {
        // 插入
        const insertStmt = this.db.prepare(`
          INSERT INTO user_profiles (
            user_id, overall_skill_level, domain_skills,
            preferred_tools, preferred_workflow, response_expectation,
            total_tasks, success_rate, avg_task_duration,
            most_used_tools, active_hours, temporal_patterns
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertStmt.run(
          profile.userId,
          profile.skillLevel.overall,
          JSON.stringify(profile.skillLevel.domains),
          JSON.stringify(profile.preferences.preferredTools),
          profile.preferences.preferredWorkflow,
          profile.preferences.responseExpectation,
          profile.statistics.totalTasks,
          profile.statistics.successRate,
          profile.statistics.avgTaskDuration,
          JSON.stringify(profile.statistics.mostUsedTools),
          JSON.stringify(profile.temporalPatterns.activeHours),
          JSON.stringify(profile.temporalPatterns.patterns),
        );

        this.stats.profilesCreated++;
      }

      // 更新缓存
      this.cache.set(profile.userId, profile);
    } catch (error) {
      logger.error("[UserProfileManager] 保存画像失败:", error);
    }
  }

  /**
   * 更新用户画像（增量更新）
   */
  async updateProfile(userId, newData) {
    const profile = await this.getProfile(userId);

    // 合并新数据
    if (newData.taskIncrement) {
      profile.statistics.totalTasks += newData.taskIncrement;
    }

    if (newData.successRate !== undefined) {
      profile.statistics.successRate = newData.successRate;
    }

    if (newData.avgTaskDuration !== undefined) {
      profile.statistics.avgTaskDuration = newData.avgTaskDuration;
    }

    profile.updatedAt = new Date().toISOString();

    // 保存更新
    await this.saveProfile(profile);

    return profile;
  }

  /**
   * 重新评估用户画像（基于最新历史数据）
   */
  async reassessProfile(userId) {
    const history = await this.loadUserHistory(userId);

    if (history.length < this.config.minDataPoints) {
      logger.info(`[UserProfileManager] 数据点不足，跳过重新评估`);
      return null;
    }

    const profile = {
      userId,
      skillLevel: this.assessSkillLevel(history),
      preferences: this.extractPreferences(history),
      statistics: this.calculateStatistics(history),
      temporalPatterns: this.config.enableTemporalAnalysis
        ? this.analyzeTemporalPatterns(history)
        : { activeHours: [], patterns: {} },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveProfile(profile);
    logger.info(`[UserProfileManager] 重新评估画像: ${userId}`);

    return profile;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate:
        this.stats.cacheHits + this.stats.cacheMisses > 0
          ? (
              (this.stats.cacheHits /
                (this.stats.cacheHits + this.stats.cacheMisses)) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[UserProfileManager] 清理资源...");
    this.cache.clear();
    this.db = null;
    logger.info("[UserProfileManager] 资源清理完成");
  }
}

module.exports = { UserProfileManager, LRUCache };
