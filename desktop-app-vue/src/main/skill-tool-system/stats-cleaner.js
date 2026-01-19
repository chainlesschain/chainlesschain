/**
 * 统计数据清理器
 * 定期清理过期的统计数据,优化数据库性能
 */

const cron = require('node-cron');

class StatsCleaner {
  constructor(database, skillManager, toolManager) {
    this.db = database;
    this.skillManager = skillManager;
    this.toolManager = toolManager;
    this.cleanupTasks = new Map();
    this.config = {
      // 保留天数配置
      usageLogsRetentionDays: 30,      // 使用记录保留30天
      dailyStatsRetentionDays: 90,     // 每日统计保留90天
      executionLogsRetentionDays: 15,  // 执行日志保留15天

      // 定时任务配置
      schedules: {
        daily: '0 2 * * *',            // 每天凌晨2点
        weekly: '0 3 * * 0',           // 每周日凌晨3点
        monthly: '0 4 1 * *'           // 每月1号凌晨4点
      }
    };
  }

  /**
   * 初始化并启动定时清理任务
   */
  initialize() {
    console.log('[StatsCleaner] 初始化统计数据清理器...');

    // 每日清理任务 - 清理过期的使用日志
    this.scheduleDailyCleanup();

    // 每周清理任务 - 汇总统计数据
    this.scheduleWeeklyAggregation();

    // 每月清理任务 - 清理旧的统计数据
    this.scheduleMonthlyCleanup();

    console.log('[StatsCleaner] 统计数据清理器已启动');
  }

  /**
   * 每日清理任务
   */
  scheduleDailyCleanup() {
    const task = cron.schedule(this.config.schedules.daily, async () => {
      console.log('[StatsCleaner] 开始每日清理任务...');
      try {
        await this.cleanupUsageLogs();
        await this.cleanupExecutionLogs();
        await this.aggregateDailyStats();
        console.log('[StatsCleaner] 每日清理任务完成');
      } catch (error) {
        console.error('[StatsCleaner] 每日清理任务失败:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    this.cleanupTasks.set('daily', task);
  }

  /**
   * 每周汇总任务
   */
  scheduleWeeklyAggregation() {
    const task = cron.schedule(this.config.schedules.weekly, async () => {
      console.log('[StatsCleaner] 开始每周汇总任务...');
      try {
        await this.aggregateWeeklyStats();
        await this.optimizeDatabase();
        console.log('[StatsCleaner] 每周汇总任务完成');
      } catch (error) {
        console.error('[StatsCleaner] 每周汇总任务失败:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    this.cleanupTasks.set('weekly', task);
  }

  /**
   * 每月清理任务
   */
  scheduleMonthlyCleanup() {
    const task = cron.schedule(this.config.schedules.monthly, async () => {
      console.log('[StatsCleaner] 开始每月清理任务...');
      try {
        await this.cleanupOldStats();
        await this.vacuumDatabase();
        console.log('[StatsCleaner] 每月清理任务完成');
      } catch (error) {
        console.error('[StatsCleaner] 每月清理任务失败:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    this.cleanupTasks.set('monthly', task);
  }

  /**
   * 清理过期的使用日志
   */
  async cleanupUsageLogs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.usageLogsRetentionDays);
    const cutoffTimestamp = cutoffDate.getTime();

    const result = await this.db.run(
      'DELETE FROM skill_tool_usage_logs WHERE created_at < ?',
      [cutoffTimestamp]
    );

    console.log(`[StatsCleaner] 清理了 ${result.changes} 条过期使用日志`);
    return result.changes;
  }

  /**
   * 清理过期的执行日志
   */
  async cleanupExecutionLogs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.executionLogsRetentionDays);
    const cutoffTimestamp = cutoffDate.getTime();

    const result = await this.db.run(
      'DELETE FROM tool_executions WHERE created_at < ? AND status = ?',
      [cutoffTimestamp, 'success']
    );

    console.log(`[StatsCleaner] 清理了 ${result.changes} 条过期执行日志`);
    return result.changes;
  }

  /**
   * 汇总每日统计数据
   */
  async aggregateDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[StatsCleaner] 汇总 ${today} 的统计数据...`);

    // 汇总技能统计
    await this.aggregateSkillStats(today);

    // 汇总工具统计
    await this.aggregateToolStats(today);
  }

  /**
   * 汇总技能统计
   */
  async aggregateSkillStats(date) {
    const startOfDay = new Date(date).setHours(0, 0, 0, 0);
    const endOfDay = new Date(date).setHours(23, 59, 59, 999);

    const skills = await this.skillManager.getAllSkills();

    for (const skill of skills) {
      // 查询当天的使用记录
      const logs = await this.db.all(
        `SELECT status, execution_time
         FROM skill_tool_usage_logs
         WHERE skill_id = ? AND created_at BETWEEN ? AND ?`,
        [skill.id, startOfDay, endOfDay]
      );

      if (logs.length === 0) {continue;}

      const successCount = logs.filter(l => l.status === 'success').length;
      const failureCount = logs.filter(l => l.status === 'failure').length;
      const totalDuration = logs.reduce((sum, l) => sum + (l.execution_time || 0), 0);
      const avgDuration = totalDuration / logs.length;

      // 插入或更新统计记录
      await this.db.run(
        `INSERT OR REPLACE INTO skill_stats
         (id, skill_id, stat_date, invoke_count, success_count, failure_count,
          avg_duration, total_duration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${skill.id}_${date}`,
          skill.id,
          date,
          logs.length,
          successCount,
          failureCount,
          avgDuration / 1000, // 转换为秒
          totalDuration / 1000,
          Date.now(),
          Date.now()
        ]
      );
    }

    console.log(`[StatsCleaner] 汇总了 ${skills.length} 个技能的统计数据`);
  }

  /**
   * 汇总工具统计
   */
  async aggregateToolStats(date) {
    const startOfDay = new Date(date).setHours(0, 0, 0, 0);
    const endOfDay = new Date(date).setHours(23, 59, 59, 999);

    const tools = await this.toolManager.getAllTools();

    for (const tool of tools) {
      // 查询当天的使用记录
      const logs = await this.db.all(
        `SELECT status, execution_time, error_message
         FROM skill_tool_usage_logs
         WHERE tool_id = ? AND created_at BETWEEN ? AND ?`,
        [tool.id, startOfDay, endOfDay]
      );

      if (logs.length === 0) {continue;}

      const successCount = logs.filter(l => l.status === 'success').length;
      const failureCount = logs.filter(l => l.status === 'failure').length;
      const totalDuration = logs.reduce((sum, l) => sum + (l.execution_time || 0), 0);
      const avgDuration = totalDuration / logs.length;

      // 统计错误类型
      const errorTypes = {};
      logs.filter(l => l.error_message).forEach(l => {
        const errorType = this.extractErrorType(l.error_message);
        errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
      });

      // 插入或更新统计记录
      await this.db.run(
        `INSERT OR REPLACE INTO tool_stats
         (id, tool_id, stat_date, invoke_count, success_count, failure_count,
          avg_duration, total_duration, error_types, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${tool.id}_${date}`,
          tool.id,
          date,
          logs.length,
          successCount,
          failureCount,
          avgDuration / 1000,
          totalDuration / 1000,
          JSON.stringify(errorTypes),
          Date.now(),
          Date.now()
        ]
      );
    }

    console.log(`[StatsCleaner] 汇总了 ${tools.length} 个工具的统计数据`);
  }

  /**
   * 汇总每周统计数据
   */
  async aggregateWeeklyStats() {
    console.log('[StatsCleaner] 汇总每周统计数据...');
    // 可以在这里添加周报生成逻辑
    // 例如:生成最受欢迎的技能、工具使用趋势等
  }

  /**
   * 清理旧的统计数据
   */
  async cleanupOldStats() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.dailyStatsRetentionDays);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    // 清理旧的技能统计
    const skillStatsResult = await this.db.run(
      'DELETE FROM skill_stats WHERE stat_date < ?',
      [cutoffDateStr]
    );

    // 清理旧的工具统计
    const toolStatsResult = await this.db.run(
      'DELETE FROM tool_stats WHERE stat_date < ?',
      [cutoffDateStr]
    );

    console.log(`[StatsCleaner] 清理了 ${skillStatsResult.changes} 条旧技能统计, ${toolStatsResult.changes} 条旧工具统计`);
  }

  /**
   * 优化数据库
   */
  async optimizeDatabase() {
    console.log('[StatsCleaner] 优化数据库索引...');

    // 重建索引
    await this.db.run('REINDEX');

    // 分析表以更新统计信息
    await this.db.run('ANALYZE');

    console.log('[StatsCleaner] 数据库优化完成');
  }

  /**
   * 执行数据库VACUUM
   */
  async vacuumDatabase() {
    console.log('[StatsCleaner] 执行数据库VACUUM...');
    await this.db.run('VACUUM');
    console.log('[StatsCleaner] 数据库VACUUM完成');
  }

  /**
   * 提取错误类型
   */
  extractErrorType(errorMessage) {
    if (!errorMessage) {return 'Unknown';}

    if (errorMessage.includes('timeout')) {return 'Timeout';}
    if (errorMessage.includes('permission')) {return 'Permission';}
    if (errorMessage.includes('not found')) {return 'NotFound';}
    if (errorMessage.includes('invalid')) {return 'InvalidParameter';}

    return 'Other';
  }

  /**
   * 手动触发清理
   */
  async manualCleanup() {
    console.log('[StatsCleaner] 手动触发清理任务...');

    try {
      await this.cleanupUsageLogs();
      await this.cleanupExecutionLogs();
      await this.aggregateDailyStats();
      await this.cleanupOldStats();
      await this.optimizeDatabase();

      console.log('[StatsCleaner] 手动清理完成');
      return { success: true };
    } catch (error) {
      console.error('[StatsCleaner] 手动清理失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取清理统计
   */
  async getCleanupStats() {
    // 统计各表的记录数
    const usageLogsCount = await this.db.get('SELECT COUNT(*) as count FROM skill_tool_usage_logs');
    const executionLogsCount = await this.db.get('SELECT COUNT(*) as count FROM tool_executions');
    const skillStatsCount = await this.db.get('SELECT COUNT(*) as count FROM skill_stats');
    const toolStatsCount = await this.db.get('SELECT COUNT(*) as count FROM tool_stats');

    return {
      usageLogs: usageLogsCount.count,
      executionLogs: executionLogsCount.count,
      skillStats: skillStatsCount.count,
      toolStats: toolStatsCount.count,
      config: this.config,
      scheduledTasks: Array.from(this.cleanupTasks.keys())
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[StatsCleaner] 配置已更新:', this.config);
  }

  /**
   * 停止所有定时任务
   */
  stopAll() {
    for (const [name, task] of this.cleanupTasks.entries()) {
      task.stop();
      console.log(`[StatsCleaner] 停止定时任务: ${name}`);
    }
    this.cleanupTasks.clear();
    console.log('[StatsCleaner] 所有定时任务已停止');
  }
}

module.exports = StatsCleaner;
