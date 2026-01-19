const { logger, createLogger } = require('../utils/logger.js');

/**
 * DataCollector - 数据收集模块
 * P2智能层数据收集基础设施
 *
 * 功能:
 * - 收集工具使用事件
 * - 记录推荐行为
 * - 更新用户画像
 * - 数据验证与清洗
 * - 批量写入优化
 *
 * Version: v0.21.0
 * Date: 2026-01-02
 */

class DataCollector {
  constructor(config = {}) {
    this.config = {
      enableCollection: true,
      batchSize: 50,              // 批量写入大小
      flushInterval: 5000,        // 5秒刷新一次
      enableValidation: true,
      enableAnonymization: false,  // 数据匿名化
      ...config
    };

    this.db = null;
    this.eventBuffer = [];
    this.flushTimer = null;
    this.stats = {
      totalEvents: 0,
      successfulWrites: 0,
      failedWrites: 0,
      validationErrors: 0
    };
  }

  /**
   * 设置数据库连接
   */
  setDatabase(db) {
    this.db = db;

    // 启动定时刷新
    if (this.config.enableCollection) {
      this.startFlushTimer();
    }
  }

  /**
   * 收集工具使用事件
   * @param {Object} event - 事件对象
   */
  async collectToolUsage(event) {
    if (!this.config.enableCollection || !this.db) {
      return;
    }

    try {
      // 验证事件数据
      if (this.config.enableValidation) {
        const validation = this.validateToolUsageEvent(event);
        if (!validation.valid) {
          logger.warn('[DataCollector] 事件验证失败:', validation.errors);
          this.stats.validationErrors++;
          return;
        }
      }

      // 数据清洗
      const cleanedEvent = this.cleanToolUsageEvent(event);

      // 添加到缓冲区
      this.eventBuffer.push({
        type: 'tool_usage',
        data: cleanedEvent,
        timestamp: Date.now()
      });

      this.stats.totalEvents++;

      // 如果缓冲区满了，立即刷新
      if (this.eventBuffer.length >= this.config.batchSize) {
        await this.flush();
      }
    } catch (error) {
      logger.error('[DataCollector] 收集工具使用事件失败:', error);
      this.stats.failedWrites++;
    }
  }

  /**
   * 记录推荐事件
   * @param {Object} recommendation - 推荐对象
   */
  async collectRecommendation(recommendation) {
    if (!this.config.enableCollection || !this.db) {
      return;
    }

    try {
      const validation = this.validateRecommendation(recommendation);
      if (!validation.valid) {
        logger.warn('[DataCollector] 推荐验证失败:', validation.errors);
        this.stats.validationErrors++;
        return;
      }

      const cleanedRec = this.cleanRecommendation(recommendation);

      this.eventBuffer.push({
        type: 'recommendation',
        data: cleanedRec,
        timestamp: Date.now()
      });

      this.stats.totalEvents++;

      if (this.eventBuffer.length >= this.config.batchSize) {
        await this.flush();
      }
    } catch (error) {
      logger.error('[DataCollector] 收集推荐事件失败:', error);
      this.stats.failedWrites++;
    }
  }

  /**
   * 更新用户画像统计
   * @param {string} userId - 用户ID
   * @param {Object} updates - 更新数据
   */
  async updateUserProfile(userId, updates) {
    if (!this.db) {return;}

    try {
      // 检查用户画像是否存在
      const existing = this.db.prepare(`
        SELECT * FROM user_profiles WHERE user_id = ?
      `).get(userId);

      if (existing) {
        // 增量更新
        const updateStmt = this.db.prepare(`
          UPDATE user_profiles
          SET
            total_tasks = total_tasks + ?,
            success_rate = ?,
            avg_task_duration = ?,
            most_used_tools = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `);

        updateStmt.run(
          updates.taskIncrement || 0,
          updates.successRate || existing.success_rate,
          updates.avgTaskDuration || existing.avg_task_duration,
          updates.mostUsedTools ? JSON.stringify(updates.mostUsedTools) : existing.most_used_tools,
          userId
        );
      } else {
        // 创建新画像
        await this.createUserProfile(userId, updates);
      }

      this.stats.successfulWrites++;
    } catch (error) {
      logger.error('[DataCollector] 更新用户画像失败:', error);
      this.stats.failedWrites++;
    }
  }

  /**
   * 创建新用户画像
   */
  async createUserProfile(userId, initialData = {}) {
    if (!this.db) {return;}

    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO user_profiles (
          user_id,
          overall_skill_level,
          preferred_workflow,
          response_expectation,
          total_tasks,
          success_rate
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        userId,
        initialData.skillLevel || 'intermediate',
        initialData.preferredWorkflow || 'sequential',
        initialData.responseExpectation || 'balanced',
        initialData.totalTasks || 0,
        initialData.successRate || 0
      );

      logger.info(`[DataCollector] 创建用户画像: ${userId}`);
      this.stats.successfulWrites++;
    } catch (error) {
      logger.error('[DataCollector] 创建用户画像失败:', error);
      this.stats.failedWrites++;
    }
  }

  /**
   * 刷新缓冲区到数据库
   */
  async flush() {
    if (!this.db || this.eventBuffer.length === 0) {
      return;
    }

    const eventsToWrite = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      // 使用事务批量写入
      const transaction = this.db.transaction((events) => {
        for (const event of events) {
          if (event.type === 'tool_usage') {
            this.writeToolUsageEvent(event.data);
          } else if (event.type === 'recommendation') {
            this.writeRecommendation(event.data);
          }
        }
      });

      transaction(eventsToWrite);
      this.stats.successfulWrites += eventsToWrite.length;

      logger.info(`[DataCollector] 刷新 ${eventsToWrite.length} 个事件到数据库`);
    } catch (error) {
      logger.error('[DataCollector] 刷新缓冲区失败:', error);
      this.stats.failedWrites += eventsToWrite.length;

      // 失败的事件放回缓冲区
      this.eventBuffer.unshift(...eventsToWrite);
    }
  }

  /**
   * 写入工具使用事件
   */
  writeToolUsageEvent(event) {
    const insertStmt = this.db.prepare(`
      INSERT INTO tool_usage_events (
        user_id,
        session_id,
        tool_name,
        tool_category,
        task_type,
        task_context,
        execution_time,
        success,
        error_message,
        user_feedback,
        explicit_rating,
        previous_tool,
        next_tool,
        is_recommended,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      event.userId,
      event.sessionId,
      event.toolName,
      event.toolCategory || null,
      event.taskType || null,
      event.taskContext ? JSON.stringify(event.taskContext) : null,
      event.executionTime || null,
      event.success ? 1 : 0,
      event.errorMessage || null,
      event.userFeedback || null,
      event.explicitRating || null,
      event.previousTool || null,
      event.nextTool || null,
      event.isRecommended ? 1 : 0,
      event.timestamp || new Date().toISOString()
    );
  }

  /**
   * 写入推荐记录
   */
  writeRecommendation(rec) {
    const insertStmt = this.db.prepare(`
      INSERT INTO tool_recommendations (
        user_id,
        session_id,
        task_description,
        task_context,
        recommended_tools,
        recommendation_scores,
        algorithm_used,
        recommendation_reasons,
        user_action,
        actual_tools_used,
        time_to_action,
        recommendation_quality,
        was_helpful
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      rec.userId,
      rec.sessionId,
      rec.taskDescription,
      rec.taskContext ? JSON.stringify(rec.taskContext) : null,
      JSON.stringify(rec.recommendedTools),
      rec.recommendationScores ? JSON.stringify(rec.recommendationScores) : null,
      rec.algorithmUsed || null,
      rec.recommendationReasons ? JSON.stringify(rec.recommendationReasons) : null,
      rec.userAction || null,
      rec.actualToolsUsed ? JSON.stringify(rec.actualToolsUsed) : null,
      rec.timeToAction || null,
      rec.recommendationQuality || null,
      rec.wasHelpful !== undefined ? (rec.wasHelpful ? 1 : 0) : null
    );
  }

  /**
   * 验证工具使用事件
   */
  validateToolUsageEvent(event) {
    const errors = [];

    if (!event.userId) {errors.push('缺少userId');}
    if (!event.sessionId) {errors.push('缺少sessionId');}
    if (!event.toolName) {errors.push('缺少toolName');}
    if (event.success === undefined) {errors.push('缺少success状态');}

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证推荐记录
   */
  validateRecommendation(rec) {
    const errors = [];

    if (!rec.userId) {errors.push('缺少userId');}
    if (!rec.sessionId) {errors.push('缺少sessionId');}
    if (!rec.taskDescription) {errors.push('缺少taskDescription');}
    if (!rec.recommendedTools || rec.recommendedTools.length === 0) {
      errors.push('缺少recommendedTools');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 清洗工具使用事件数据
   */
  cleanToolUsageEvent(event) {
    return {
      userId: this.anonymizeIfNeeded(event.userId),
      sessionId: event.sessionId,
      toolName: event.toolName.trim(),
      toolCategory: event.toolCategory,
      taskType: event.taskType,
      taskContext: this.sanitizeContext(event.taskContext),
      executionTime: Math.max(0, event.executionTime || 0),
      success: Boolean(event.success),
      errorMessage: event.errorMessage ? event.errorMessage.substring(0, 500) : null,
      userFeedback: event.userFeedback,
      explicitRating: event.explicitRating ? Math.min(5, Math.max(1, event.explicitRating)) : null,
      previousTool: event.previousTool,
      nextTool: event.nextTool,
      isRecommended: Boolean(event.isRecommended),
      timestamp: event.timestamp || new Date().toISOString()
    };
  }

  /**
   * 清洗推荐数据
   */
  cleanRecommendation(rec) {
    return {
      userId: this.anonymizeIfNeeded(rec.userId),
      sessionId: rec.sessionId,
      taskDescription: rec.taskDescription.substring(0, 1000),
      taskContext: this.sanitizeContext(rec.taskContext),
      recommendedTools: rec.recommendedTools,
      recommendationScores: rec.recommendationScores,
      algorithmUsed: rec.algorithmUsed,
      recommendationReasons: rec.recommendationReasons,
      userAction: rec.userAction,
      actualToolsUsed: rec.actualToolsUsed,
      timeToAction: rec.timeToAction ? Math.max(0, rec.timeToAction) : null,
      recommendationQuality: rec.recommendationQuality,
      wasHelpful: rec.wasHelpful
    };
  }

  /**
   * 匿名化用户ID（如果启用）
   */
  anonymizeIfNeeded(userId) {
    if (!this.config.enableAnonymization) {
      return userId;
    }

    // 简单哈希
    return 'anon_' + Buffer.from(userId).toString('base64').substring(0, 16);
  }

  /**
   * 清理上下文数据
   */
  sanitizeContext(context) {
    if (!context) {return null;}

    // 移除敏感信息
    const cleaned = { ...context };
    delete cleaned.password;
    delete cleaned.apiKey;
    delete cleaned.token;

    return cleaned;
  }

  /**
   * 启动定时刷新
   */
  startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        logger.error('[DataCollector] 定时刷新失败:', error);
      });
    }, this.config.flushInterval);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.eventBuffer.length,
      collectionRate: this.stats.totalEvents > 0
        ? ((this.stats.successfulWrites / this.stats.totalEvents) * 100).toFixed(2) + '%'
        : '0%',
      errorRate: this.stats.totalEvents > 0
        ? ((this.stats.failedWrites / this.stats.totalEvents) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info('[DataCollector] 清理资源...');

    // 停止定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 刷新剩余事件
    await this.flush();

    this.db = null;
    logger.info('[DataCollector] 资源清理完成');
  }
}

module.exports = DataCollector;
