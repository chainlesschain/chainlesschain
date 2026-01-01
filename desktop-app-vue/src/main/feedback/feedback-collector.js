/**
 * 用户反馈收集系统
 * 用于收集用户对P0/P1/P2优化功能的反馈
 *
 * 版本: v0.20.1
 * 日期: 2026-01-02
 */

const { app } = require('electron');

class FeedbackCollector {
  constructor(database) {
    this.db = database;
    this.sessionId = `session_${Date.now()}`;
    this.appVersion = app?.getVersion() || 'unknown';
    this.platform = process.platform;
  }

  /**
   * 提交用户反馈
   * @param {Object} feedback - 反馈内容
   * @returns {Promise<Object>} 提交结果
   */
  async submitFeedback(feedback) {
    const {
      type = 'experience',
      title,
      description = '',
      rating = null,
      relatedFeature = 'general',
      userId = null
    } = feedback;

    try {
      const result = await this.db.run(`
        INSERT INTO user_feedback (
          user_id,
          session_id,
          feedback_type,
          title,
          description,
          rating,
          related_feature,
          user_agent,
          app_version,
          platform,
          status,
          priority
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'normal')
      `, [
        userId,
        this.sessionId,
        type,
        title,
        description,
        rating,
        relatedFeature,
        `ChainlessChain/${this.appVersion}`,
        this.appVersion,
        this.platform
      ]);

      console.log('[FeedbackCollector] 用户反馈已提交:', {
        id: result.lastInsertRowid,
        type,
        feature: relatedFeature,
        rating
      });

      return {
        success: true,
        feedbackId: result.lastInsertRowid,
        message: '感谢您的反馈！我们会认真考虑您的意见。'
      };

    } catch (error) {
      console.error('[FeedbackCollector] 提交反馈失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 提交满意度调查
   * @param {Object} survey - 调查结果
   * @returns {Promise<Object>} 提交结果
   */
  async submitSatisfactionSurvey(survey) {
    const {
      userId = null,
      p0Satisfaction = null,
      p1Satisfaction = null,
      p2Satisfaction = null,
      overallSatisfaction = null,
      perceivedSpeed = null,
      taskSuccessRate = null,
      easeOfUse = null,
      likes = '',
      dislikes = '',
      suggestions = ''
    } = survey;

    try {
      const result = await this.db.run(`
        INSERT INTO satisfaction_surveys (
          user_id,
          session_id,
          p0_satisfaction,
          p1_satisfaction,
          p2_satisfaction,
          overall_satisfaction,
          perceived_speed,
          task_success_rate,
          ease_of_use,
          likes,
          dislikes,
          suggestions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId,
        this.sessionId,
        p0Satisfaction,
        p1Satisfaction,
        p2Satisfaction,
        overallSatisfaction,
        perceivedSpeed,
        taskSuccessRate,
        easeOfUse,
        likes,
        dislikes,
        suggestions
      ]);

      console.log('[FeedbackCollector] 满意度调查已提交:', {
        id: result.lastInsertRowid,
        overallScore: overallSatisfaction
      });

      return {
        success: true,
        surveyId: result.lastInsertRowid,
        message: '感谢您参与调查！'
      };

    } catch (error) {
      console.error('[FeedbackCollector] 提交调查失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 记录功能使用情况
   * @param {string} featureName - 功能名称
   * @param {Object} usage - 使用情况
   * @returns {Promise<void>}
   */
  async trackFeatureUsage(featureName, usage) {
    const {
      userId = null,
      success = true,
      durationMs = 0,
      interrupted = false,
      retried = false
    } = usage;

    try {
      // 尝试更新现有记录
      const existingRecord = await this.db.get(`
        SELECT id, usage_count, success_count, failure_count,
               avg_duration_ms, min_duration_ms, max_duration_ms
        FROM feature_usage_tracking
        WHERE feature_name = ? AND session_id = ?
      `, [featureName, this.sessionId]);

      if (existingRecord) {
        // 更新统计
        const newUsageCount = existingRecord.usage_count + 1;
        const newSuccessCount = existingRecord.success_count + (success ? 1 : 0);
        const newFailureCount = existingRecord.failure_count + (success ? 0 : 1);

        const newAvgDuration = (
          (existingRecord.avg_duration_ms * existingRecord.usage_count + durationMs) /
          newUsageCount
        );

        const newMinDuration = Math.min(existingRecord.min_duration_ms || Infinity, durationMs);
        const newMaxDuration = Math.max(existingRecord.max_duration_ms || 0, durationMs);

        await this.db.run(`
          UPDATE feature_usage_tracking
          SET usage_count = ?,
              success_count = ?,
              failure_count = ?,
              avg_duration_ms = ?,
              min_duration_ms = ?,
              max_duration_ms = ?,
              user_interrupted = user_interrupted + ?,
              user_retried = user_retried + ?,
              last_used_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          newUsageCount,
          newSuccessCount,
          newFailureCount,
          newAvgDuration,
          newMinDuration,
          newMaxDuration,
          interrupted ? 1 : 0,
          retried ? 1 : 0,
          existingRecord.id
        ]);

      } else {
        // 创建新记录
        await this.db.run(`
          INSERT INTO feature_usage_tracking (
            user_id,
            session_id,
            feature_name,
            usage_count,
            success_count,
            failure_count,
            avg_duration_ms,
            min_duration_ms,
            max_duration_ms,
            user_interrupted,
            user_retried
          ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          this.sessionId,
          featureName,
          success ? 1 : 0,
          success ? 0 : 1,
          durationMs,
          durationMs,
          durationMs,
          interrupted ? 1 : 0,
          retried ? 1 : 0
        ]);
      }

      console.log(`[FeedbackCollector] 功能使用已记录: ${featureName} (${success ? '成功' : '失败'}, ${durationMs}ms)`);

    } catch (error) {
      console.error('[FeedbackCollector] 记录功能使用失败:', error);
    }
  }

  /**
   * 报告性能问题
   * @param {string} featureName - 功能名称
   * @param {Object} issue - 问题详情
   * @returns {Promise<void>}
   */
  async reportPerformanceIssue(featureName, issue) {
    const {
      type = 'error',
      errorMessage = '',
      stackTrace = '',
      durationMs = 0,
      memoryUsageMb = 0,
      autoRecovered = false,
      reportToUser = false
    } = issue;

    try {
      await this.db.run(`
        INSERT INTO performance_issues (
          session_id,
          feature_name,
          issue_type,
          error_message,
          stack_trace,
          duration_ms,
          memory_usage_mb,
          platform,
          app_version,
          node_version,
          auto_recovered,
          reported_to_user
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        this.sessionId,
        featureName,
        type,
        errorMessage,
        stackTrace,
        durationMs,
        memoryUsageMb,
        this.platform,
        this.appVersion,
        process.version,
        autoRecovered ? 1 : 0,
        reportToUser ? 1 : 0
      ]);

      console.warn(`[FeedbackCollector] 性能问题已报告: ${featureName} - ${type}`);

    } catch (error) {
      console.error('[FeedbackCollector] 报告性能问题失败:', error);
    }
  }

  /**
   * 获取反馈统计
   * @param {number} days - 天数
   * @returns {Promise<Object>} 统计结果
   */
  async getFeedbackStats(days = 7) {
    try {
      const stats = await this.db.get(`
        SELECT
          COUNT(*) as total_feedback,
          AVG(rating) as avg_rating,
          COUNT(CASE WHEN rating >= 4 THEN 1 END) * 100.0 / COUNT(*) as positive_rate,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
        FROM user_feedback
        WHERE created_at >= datetime('now', '-${days} days')
      `);

      return stats || {
        total_feedback: 0,
        avg_rating: 0,
        positive_rate: 0,
        pending_count: 0
      };

    } catch (error) {
      console.error('[FeedbackCollector] 获取统计失败:', error);
      return null;
    }
  }

  /**
   * 获取功能热度排行
   * @returns {Promise<Array>} 功能列表
   */
  async getFeaturePopularity() {
    try {
      const features = await this.db.all(`
        SELECT * FROM v_feature_popularity
        LIMIT 10
      `);

      return features || [];

    } catch (error) {
      console.error('[FeedbackCollector] 获取功能热度失败:', error);
      return [];
    }
  }

  /**
   * 获取性能问题热点
   * @returns {Promise<Array>} 问题列表
   */
  async getPerformanceHotspots() {
    try {
      const hotspots = await this.db.all(`
        SELECT * FROM v_performance_hotspots
        LIMIT 10
      `);

      return hotspots || [];

    } catch (error) {
      console.error('[FeedbackCollector] 获取性能热点失败:', error);
      return [];
    }
  }
}

module.exports = FeedbackCollector;
