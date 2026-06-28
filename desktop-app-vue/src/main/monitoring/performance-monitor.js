const { logger } = require("../utils/logger.js");

/** Tolerant JSON column parse — a corrupt row must not abort a list-load loop. */
function safeParse(raw, fallback) {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[PerformanceMonitor] Bad JSON column, fallback: ${err.message}`,
    );
    return fallback;
  }
}

/**
 * 性能监控系统 (Performance Monitor)
 * 记录和分析AI Pipeline各阶段的性能指标
 *
 * 核心功能:
 * 1. 记录各阶段耗时 (意图识别、任务规划、工具执行、RAG检索、LLM调用)
 * 2. 生成性能报告 (P50/P90/P95/P99分位数)
 * 3. 识别性能瓶颈
 * 4. 生成优化建议
 * 5. 长期趋势分析
 */

class PerformanceMonitor {
  constructor(database) {
    this.database = database;

    // 内存缓存（用于快速统计）
    this.metrics = {
      intent_recognition: [],
      task_planning: [],
      tool_execution: [],
      rag_retrieval: [],
      llm_calls: [],
      total_pipeline: [],
    };

    // 性能阈值配置
    this.thresholds = {
      intent_recognition: { warning: 1500, critical: 3000 }, // ms
      task_planning: { warning: 4000, critical: 8000 },
      tool_execution: { warning: 5000, critical: 10000 },
      rag_retrieval: { warning: 2000, critical: 5000 },
      llm_calls: { warning: 3000, critical: 6000 },
      total_pipeline: { warning: 10000, critical: 20000 },
    };

    // 初始化数据库表
    this.initDatabase();
  }

  /**
   * 初始化数据库表
   * @private
   */
  async initDatabase() {
    if (!this.database) {
      return;
    }

    try {
      // 创建性能指标表
      await this.database.exec(`
        CREATE TABLE IF NOT EXISTS performance_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phase TEXT NOT NULL,
          duration REAL NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          user_id TEXT,
          session_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_phase_created
        ON performance_metrics(phase, created_at);

        CREATE INDEX IF NOT EXISTS idx_session
        ON performance_metrics(session_id);
      `);

      logger.info("[PerformanceMonitor] 数据库表初始化完成");
    } catch (error) {
      logger.error("[PerformanceMonitor] 数据库初始化失败:", error);
    }
  }

  /**
   * 记录阶段性能
   * @param {string} phase - 阶段名称
   * @param {number} duration - 耗时（毫秒）
   * @param {Object} metadata - 元数据
   * @param {string} userId - 用户ID
   * @param {string} sessionId - 会话ID
   */
  async recordPhase(
    phase,
    duration,
    metadata = {},
    userId = null,
    sessionId = null,
  ) {
    const record = {
      phase,
      duration,
      metadata,
      timestamp: Date.now(),
      userId,
      sessionId,
    };

    // 添加到内存缓存
    if (this.metrics[phase]) {
      this.metrics[phase].push(record);

      // 限制内存缓存大小（最多保留最近1000条）
      if (this.metrics[phase].length > 1000) {
        this.metrics[phase].shift();
      }
    }

    // 持久化到数据库
    if (this.database) {
      try {
        await this.database.run(
          `
          INSERT INTO performance_metrics (phase, duration, metadata, created_at, user_id, session_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          [
            phase,
            duration,
            JSON.stringify(metadata),
            record.timestamp,
            userId,
            sessionId,
          ],
        );
      } catch (error) {
        logger.error("[PerformanceMonitor] 记录性能失败:", error);
      }
    }

    // 检查是否超过阈值
    this.checkThreshold(phase, duration, metadata);
  }

  /**
   * 检查性能阈值
   * @private
   */
  checkThreshold(phase, duration, metadata) {
    const threshold = this.thresholds[phase];
    if (!threshold) {
      return;
    }

    if (duration > threshold.critical) {
      logger.error(
        `[PerformanceMonitor] 🔴 严重: ${phase} 耗时 ${duration}ms (阈值: ${threshold.critical}ms)`,
      );
      logger.error(`[PerformanceMonitor] 元数据:`, metadata);
    } else if (duration > threshold.warning) {
      logger.warn(
        `[PerformanceMonitor] ⚠️ 警告: ${phase} 耗时 ${duration}ms (阈值: ${threshold.warning}ms)`,
      );
    }
  }

  /**
   * 生成性能报告
   * @param {number} timeRange - 时间范围（毫秒），默认7天
   * @returns {Promise<Object>} 性能报告
   */
  async generateReport(timeRange = 7 * 24 * 60 * 60 * 1000) {
    const since = Date.now() - timeRange;
    const report = {
      timeRange: this.formatTimeRange(timeRange),
      generatedAt: new Date().toISOString(),
      phases: {},
    };

    for (const phase of Object.keys(this.metrics)) {
      const phaseReport = await this.generatePhaseReport(phase, since);
      if (phaseReport) {
        report.phases[phase] = phaseReport;
      }
    }

    return report;
  }

  /**
   * 生成单个阶段的报告
   * @private
   */
  async generatePhaseReport(phase, since) {
    if (!this.database) {
      return null;
    }

    try {
      const rows = await this.database.all(
        `
        SELECT duration, metadata
        FROM performance_metrics
        WHERE phase = ? AND created_at > ?
        ORDER BY created_at DESC
      `,
        [phase, since],
      );

      if (rows.length === 0) {
        return null;
      }

      const durations = rows.map((r) => r.duration);

      return {
        count: rows.length,
        avg: Math.round(this.average(durations)),
        p50: Math.round(this.percentile(durations, 50)),
        p90: Math.round(this.percentile(durations, 90)),
        p95: Math.round(this.percentile(durations, 95)),
        p99: Math.round(this.percentile(durations, 99)),
        max: Math.round(Math.max(...durations)),
        min: Math.round(Math.min(...durations)),
        unit: "ms",
      };
    } catch (error) {
      logger.error(`[PerformanceMonitor] 生成${phase}报告失败:`, error);
      return null;
    }
  }

  /**
   * 识别性能瓶颈
   * @param {number} threshold - 慢查询阈值（毫秒），默认5秒
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 慢查询列表
   */
  async findBottlenecks(threshold = 5000, limit = 20) {
    if (!this.database) {
      return [];
    }

    try {
      const slowQueries = await this.database.all(
        `
        SELECT phase, duration, metadata, created_at, session_id
        FROM performance_metrics
        WHERE duration > ?
        ORDER BY duration DESC
        LIMIT ?
      `,
        [threshold, limit],
      );

      return slowQueries.map((q) => {
        // Validate timestamp
        let timestamp;
        try {
          const date = new Date(q.created_at);
          timestamp = isNaN(date.getTime())
            ? new Date().toISOString()
            : date.toISOString();
        } catch (e) {
          timestamp = new Date().toISOString();
        }

        return {
          phase: q.phase,
          duration: Math.round(q.duration),
          metadata: JSON.parse(q.metadata || "{}"),
          timestamp,
          sessionId: q.session_id,
        };
      });
    } catch (error) {
      logger.error("[PerformanceMonitor] 查找瓶颈失败:", error);
      return [];
    }
  }

  /**
   * 生成优化建议
   * @param {Object} report - 性能报告
   * @returns {Array} 优化建议列表
   */
  generateOptimizationSuggestions(report) {
    const suggestions = [];

    if (!report || !report.phases) {
      return suggestions;
    }

    // 意图识别优化建议
    if (report.phases.intent_recognition?.p90 > 2000) {
      suggestions.push({
        phase: "intent_recognition",
        severity: "medium",
        issue: `意图识别P90耗时 ${report.phases.intent_recognition.p90}ms，超过建议阈值2000ms`,
        suggestions: [
          "增加关键词规则覆盖率，减少LLM调用频率",
          "启用本地缓存，相同输入直接返回结果",
          "使用更快的模型（如Qwen2:1.5B替代7B）",
          "考虑使用Few-shot模板预加载",
        ],
        priority: "high",
      });
    }

    // 任务规划优化建议
    if (report.phases.task_planning?.p90 > 5000) {
      suggestions.push({
        phase: "task_planning",
        severity: "high",
        issue: `任务规划P90耗时 ${report.phases.task_planning.p90}ms，超过建议阈值5000ms`,
        suggestions: [
          "RAG检索结果限制在3个文档以内",
          "使用快速拆解模式作为默认，LLM作为增强",
          "预加载常用模板，避免实时生成",
          "启用任务规划缓存（相似任务重用）",
          "减少Few-shot示例数量（从5个降至3个）",
        ],
        priority: "critical",
      });
    }

    // RAG检索优化建议
    if (report.phases.rag_retrieval?.p90 > 3000) {
      suggestions.push({
        phase: "rag_retrieval",
        severity: "medium",
        issue: `RAG检索P90耗时 ${report.phases.rag_retrieval.p90}ms，超过建议阈值3000ms`,
        suggestions: [
          "启用ChromaDB索引优化",
          "减少rerank文档数量（当前5个，可降至3个）",
          "考虑禁用query rewrite（牺牲准确率换速度）",
          "使用更快的embedding模型",
          "启用向量缓存机制",
        ],
        priority: "high",
      });
    }

    // 工具执行优化建议
    if (report.phases.tool_execution?.p90 > 5000) {
      suggestions.push({
        phase: "tool_execution",
        severity: "medium",
        issue: `工具执行P90耗时 ${report.phases.tool_execution.p90}ms，超过建议阈值5000ms`,
        suggestions: [
          "启用工具执行并行化（独立工具同时运行）",
          "优化文件I/O操作（批量读写）",
          "减少不必要的文件系统调用",
          "使用流式处理代替全量加载",
        ],
        priority: "medium",
      });
    }

    // LLM调用优化建议
    if (report.phases.llm_calls?.p90 > 3000) {
      suggestions.push({
        phase: "llm_calls",
        severity: "medium",
        issue: `LLM调用P90耗时 ${report.phases.llm_calls.p90}ms，超过建议阈值3000ms`,
        suggestions: [
          "降低max_tokens限制（减少生成量）",
          "启用流式响应（提升用户体验）",
          "使用更快的模型（牺牲质量换速度）",
          "启用LLM响应缓存（相同prompt重用）",
          "考虑批量调用（多个请求合并）",
        ],
        priority: "high",
      });
    }

    // 整体Pipeline优化建议
    if (report.phases.total_pipeline?.p90 > 12000) {
      suggestions.push({
        phase: "total_pipeline",
        severity: "high",
        issue: `整体Pipeline P90耗时 ${report.phases.total_pipeline.p90}ms，超过建议阈值12000ms`,
        suggestions: [
          "启用阶段并行执行（意图识别 + RAG检索同时进行）",
          "实施渐进式响应（先返回初步结果，再优化）",
          "优化数据流（减少中间序列化/反序列化）",
          "启用预测性预加载（提前准备常用资源）",
        ],
        priority: "critical",
      });
    }

    return suggestions;
  }

  /**
   * 获取会话性能详情
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 会话性能数据
   */
  async getSessionPerformance(sessionId) {
    if (!this.database) {
      return null;
    }

    try {
      const rows = await this.database.all(
        `
        SELECT phase, duration, metadata, created_at
        FROM performance_metrics
        WHERE session_id = ?
        ORDER BY created_at ASC
      `,
        [sessionId],
      );

      if (rows.length === 0) {
        return null;
      }

      const phaseBreakdown = {};
      let totalDuration = 0;

      for (const row of rows) {
        const phase = row.phase;
        totalDuration += row.duration;

        if (!phaseBreakdown[phase]) {
          phaseBreakdown[phase] = {
            count: 0,
            totalDuration: 0,
            records: [],
          };
        }

        phaseBreakdown[phase].count++;
        phaseBreakdown[phase].totalDuration += row.duration;
        phaseBreakdown[phase].records.push({
          duration: row.duration,
          metadata: safeParse(row.metadata, {}),
          timestamp: row.created_at,
        });
      }

      return {
        sessionId,
        totalDuration: Math.round(totalDuration),
        phaseCount: Object.keys(phaseBreakdown).length,
        recordCount: rows.length,
        phaseBreakdown,
        timeline: rows.map((r) => ({
          phase: r.phase,
          duration: r.duration,
          timestamp: r.created_at,
        })),
      };
    } catch (error) {
      logger.error("[PerformanceMonitor] 获取会话性能失败:", error);
      return null;
    }
  }

  /**
   * 比较两个时间段的性能
   * @param {number} period1Start - 时期1开始时间
   * @param {number} period1End - 时期1结束时间
   * @param {number} period2Start - 时期2开始时间
   * @param {number} period2End - 时期2结束时间
   * @returns {Promise<Object>} 对比结果
   */
  async comparePerformance(period1Start, period1End, period2Start, period2End) {
    if (!this.database) {
      return null;
    }

    const comparison = {};

    for (const phase of Object.keys(this.metrics)) {
      const period1Stats = await this.getPhaseStats(
        phase,
        period1Start,
        period1End,
      );
      const period2Stats = await this.getPhaseStats(
        phase,
        period2Start,
        period2End,
      );

      if (period1Stats && period2Stats) {
        comparison[phase] = {
          period1: period1Stats,
          period2: period2Stats,
          improvement: {
            avg: this.calculateImprovement(period1Stats.avg, period2Stats.avg),
            p90: this.calculateImprovement(period1Stats.p90, period2Stats.p90),
            p95: this.calculateImprovement(period1Stats.p95, period2Stats.p95),
          },
        };
      }
    }

    return comparison;
  }

  /**
   * 获取阶段统计
   * @private
   */
  async getPhaseStats(phase, startTime, endTime) {
    if (!this.database) {
      return null;
    }

    try {
      const rows = await this.database.all(
        `
        SELECT duration
        FROM performance_metrics
        WHERE phase = ? AND created_at >= ? AND created_at <= ?
      `,
        [phase, startTime, endTime],
      );

      if (rows.length === 0) {
        return null;
      }

      const durations = rows.map((r) => r.duration);

      return {
        count: rows.length,
        avg: this.average(durations),
        p90: this.percentile(durations, 90),
        p95: this.percentile(durations, 95),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 计算性能提升百分比
   * @private
   */
  calculateImprovement(before, after) {
    if (before === 0) {
      return 0;
    }
    const improvement = (((before - after) / before) * 100).toFixed(1);
    return parseFloat(improvement);
  }

  /**
   * 计算平均值
   * @private
   */
  average(arr) {
    if (arr.length === 0) {
      return 0;
    }
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }

  /**
   * 计算分位数
   * @private
   */
  percentile(arr, p) {
    if (arr.length === 0) {
      return 0;
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * 格式化时间范围
   * @private
   */
  formatTimeRange(ms) {
    const hours = ms / (1000 * 60 * 60);

    if (hours < 24) {
      return `最近${Math.round(hours)}小时`;
    }

    const days = Math.round(hours / 24);
    return `最近${days}天`;
  }

  /**
   * 清理旧数据
   * @param {number} keepDays - 保留天数
   */
  async cleanOldData(keepDays = 30) {
    if (!this.database) {
      return;
    }

    try {
      const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;

      const result = await this.database.run(
        `
        DELETE FROM performance_metrics
        WHERE created_at < ?
      `,
        [cutoff],
      );

      logger.info(
        `[PerformanceMonitor] 清理旧数据完成，删除 ${result.changes} 条记录`,
      );
    } catch (error) {
      logger.error("[PerformanceMonitor] 清理旧数据失败:", error);
    }
  }

  /**
   * 导出性能数据（用于外部分析）
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Array>} 原始性能数据
   */
  async exportData(timeRange = 7 * 24 * 60 * 60 * 1000) {
    if (!this.database) {
      return [];
    }

    try {
      const since = Date.now() - timeRange;

      const rows = await this.database.all(
        `
        SELECT *
        FROM performance_metrics
        WHERE created_at > ?
        ORDER BY created_at DESC
      `,
        [since],
      );

      return rows.map((row) => ({
        ...row,
        metadata: safeParse(row.metadata, {}),
        created_at: new Date(row.created_at).toISOString(),
      }));
    } catch (error) {
      logger.error("[PerformanceMonitor] 导出数据失败:", error);
      return [];
    }
  }
}

module.exports = PerformanceMonitor;
