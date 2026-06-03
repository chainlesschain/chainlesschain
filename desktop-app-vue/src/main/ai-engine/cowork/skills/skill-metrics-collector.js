/**
 * SkillMetricsCollector - 技能指标采集器
 *
 * 监听技能执行和流水线事件，采集性能指标，
 * 定期刷入 SQLite 持久化存储。
 *
 * @module ai-engine/cowork/skills/skill-metrics-collector
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../../utils/logger.js");

class SkillMetricsCollector extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} [options.database] - Database instance
   * @param {Object} [options.skillRegistry] - SkillRegistry instance
   * @param {Object} [options.pipelineEngine] - SkillPipelineEngine instance
   * @param {number} [options.flushInterval=60000] - Flush to DB interval (ms)
   * @param {number} [options.maxBufferSize=500] - Max buffer before forced flush
   */
  constructor(options = {}) {
    super();
    this.database = options.database || null;
    this.skillRegistry = options.skillRegistry || null;
    this.pipelineEngine = options.pipelineEngine || null;
    this.flushInterval = options.flushInterval || 60000;
    this.maxBufferSize = options.maxBufferSize || 500;

    /** @type {Map<string, object>} In-memory aggregated metrics by skillId */
    this.skillMetrics = new Map();

    /** @type {Map<string, object>} Pipeline metrics by pipelineId */
    this.pipelineMetrics = new Map();

    /** @type {Array} Buffer for DB flush */
    this._buffer = [];

    /** @type {NodeJS.Timeout|null} Periodic flush timer */
    this._flushTimer = null;

    this._initialized = false;
  }

  /**
   * Initialize the collector: bind listeners and start flush timer
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    // Listen to SkillRegistry events
    if (this.skillRegistry) {
      this.skillRegistry.on("skill-started", (data) => {
        this._onSkillStarted(data);
      });
      this.skillRegistry.on("skill-completed", (data) => {
        this._onSkillCompleted(data);
      });
      this.skillRegistry.on("skill-failed", (data) => {
        this._onSkillFailed(data);
      });
    }

    // Listen to PipelineEngine events
    if (this.pipelineEngine) {
      this.pipelineEngine.on("pipeline:completed", (data) => {
        this._onPipelineCompleted(data);
      });
      this.pipelineEngine.on("pipeline:failed", (data) => {
        this._onPipelineFailed(data);
      });
      this.pipelineEngine.on("pipeline:step-completed", (data) => {
        this._onPipelineStepCompleted(data);
      });
    }

    // Start periodic flush
    this._flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error(`[SkillMetricsCollector] Flush error: ${err.message}`);
      });
    }, this.flushInterval);

    this._initialized = true;
    logger.info("[SkillMetricsCollector] Initialized");
  }

  /**
   * Record a skill execution metric
   * @param {string} skillId
   * @param {object} data - { duration, tokensUsed, success, pipelineId?, cost? }
   */
  recordExecution(skillId, data = {}) {
    const record = {
      id: uuidv4(),
      skillId,
      pipelineId: data.pipelineId || null,
      startedAt: Date.now() - (data.duration || 0),
      completedAt: Date.now(),
      durationMs: data.duration || 0,
      success: data.success !== false ? 1 : 0,
      tokensInput: data.tokensInput || 0,
      tokensOutput: data.tokensOutput || 0,
      costUsd: data.cost || 0,
      errorMessage: data.error || null,
      contextJson: data.context ? JSON.stringify(data.context) : null,
    };

    // Update in-memory aggregation
    this._updateAggregation(skillId, record);

    // Buffer for DB flush
    this._buffer.push(record);

    // Force flush if buffer is large
    if (this._buffer.length >= this.maxBufferSize) {
      this.flush().catch((err) => {
        logger.error(
          `[SkillMetricsCollector] Force flush error: ${err.message}`,
        );
      });
    }

    this.emit("metric-recorded", { skillId, record });
  }

  /**
   * Get aggregated metrics for a single skill
   * @param {string} skillId
   * @param {object} [timeRange] - { from, to } timestamps
   * @returns {object}
   */
  getSkillMetrics(skillId, timeRange = null) {
    const metrics = this.skillMetrics.get(skillId);
    if (!metrics) {
      return {
        skillId,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgDurationMs: 0,
        totalTokens: 0,
        totalCost: 0,
        successRate: 0,
        lastExecutedAt: null,
      };
    }
    return { skillId, ...metrics };
  }

  /**
   * Get aggregated metrics for pipelines
   * @param {string} [pipelineId] - Optional specific pipeline
   * @returns {object|object[]}
   */
  getPipelineMetrics(pipelineId = null) {
    if (pipelineId) {
      return (
        this.pipelineMetrics.get(pipelineId) || {
          pipelineId,
          totalExecutions: 0,
          successCount: 0,
          failureCount: 0,
          avgDurationMs: 0,
        }
      );
    }
    return Array.from(this.pipelineMetrics.values());
  }

  /**
   * Get top skills by a given metric
   * @param {number} limit
   * @param {'executions'|'duration'|'cost'|'tokens'|'failures'} metric
   * @returns {object[]}
   */
  getTopSkills(limit = 10, metric = "executions") {
    const entries = Array.from(this.skillMetrics.entries());
    const sortFns = {
      executions: (a, b) => b[1].totalExecutions - a[1].totalExecutions,
      duration: (a, b) => b[1].avgDurationMs - a[1].avgDurationMs,
      cost: (a, b) => b[1].totalCost - a[1].totalCost,
      tokens: (a, b) => b[1].totalTokens - a[1].totalTokens,
      failures: (a, b) => b[1].failureCount - a[1].failureCount,
    };

    const sortFn = sortFns[metric] || sortFns.executions;
    entries.sort(sortFn);

    return entries.slice(0, limit).map(([skillId, data]) => ({
      skillId,
      ...data,
    }));
  }

  /**
   * Get time series data for charts
   * @param {string} skillId
   * @param {'hour'|'day'|'week'} interval
   * @returns {object[]}
   */
  getTimeSeriesData(skillId, interval = "day") {
    // Time series from buffer (in-memory data)
    const intervalMs =
      {
        hour: 3600000,
        day: 86400000,
        week: 604800000,
      }[interval] || 86400000;

    const now = Date.now();
    const buckets = new Map();

    for (const record of this._buffer) {
      if (skillId && record.skillId !== skillId) {
        continue;
      }

      const bucketKey = Math.floor(record.startedAt / intervalMs) * intervalMs;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          timestamp: bucketKey,
          executions: 0,
          successes: 0,
          failures: 0,
          totalDuration: 0,
          totalTokens: 0,
        });
      }

      const bucket = buckets.get(bucketKey);
      bucket.executions++;
      if (record.success) {
        bucket.successes++;
      } else {
        bucket.failures++;
      }
      bucket.totalDuration += record.durationMs;
      bucket.totalTokens += record.tokensInput + record.tokensOutput;
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((b) => ({
        ...b,
        avgDuration:
          b.executions > 0 ? Math.round(b.totalDuration / b.executions) : 0,
        successRate:
          b.executions > 0 ? Math.round((b.successes / b.executions) * 100) : 0,
      }));
  }

  /**
   * Export all metrics
   * @returns {object}
   */
  exportMetrics() {
    return {
      exportedAt: Date.now(),
      skills: Object.fromEntries(this.skillMetrics),
      pipelines: Object.fromEntries(this.pipelineMetrics),
      buffer: this._buffer,
      bufferSize: this._buffer.length,
    };
  }

  /**
   * Flush buffered metrics to database
   * @returns {Promise<number>} Number of records flushed
   */
  async flush() {
    if (this._buffer.length === 0) {
      return 0;
    }
    if (!this.database) {
      // No database — just clear the oldest records to prevent memory growth
      if (this._buffer.length > this.maxBufferSize * 2) {
        this._buffer = this._buffer.slice(-this.maxBufferSize);
      }
      return 0;
    }

    const records = [...this._buffer];
    this._buffer = [];

    let flushed = 0;
    for (const record of records) {
      try {
        await this.database.run(
          `INSERT OR IGNORE INTO skill_execution_metrics
           (id, skill_id, pipeline_id, started_at, completed_at, duration_ms,
            success, tokens_input, tokens_output, cost_usd, error_message, context_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            record.skillId,
            record.pipelineId,
            record.startedAt,
            record.completedAt,
            record.durationMs,
            record.success,
            record.tokensInput,
            record.tokensOutput,
            record.costUsd,
            record.errorMessage,
            record.contextJson,
          ],
        );
        flushed++;
      } catch (error) {
        logger.error(
          `[SkillMetricsCollector] DB insert error: ${error.message}`,
        );
      }
    }

    logger.info(
      `[SkillMetricsCollector] Flushed ${flushed}/${records.length} records to DB`,
    );
    return flushed;
  }

  /**
   * Destroy the collector, stop timers
   */
  destroy() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    this.flush().catch(() => {});
    this._initialized = false;
    logger.info("[SkillMetricsCollector] Destroyed");
  }

  // ==========================================
  // Private
  // ==========================================

  /** @private */
  _updateAggregation(skillId, record) {
    let agg = this.skillMetrics.get(skillId);
    if (!agg) {
      agg = {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        totalTokens: 0,
        totalCost: 0,
        successRate: 0,
        lastExecutedAt: null,
      };
      this.skillMetrics.set(skillId, agg);
    }

    agg.totalExecutions++;
    if (record.success) {
      agg.successCount++;
    } else {
      agg.failureCount++;
    }
    agg.totalDurationMs += record.durationMs;
    agg.avgDurationMs = Math.round(agg.totalDurationMs / agg.totalExecutions);
    agg.totalTokens += record.tokensInput + record.tokensOutput;
    agg.totalCost += record.costUsd;
    agg.successRate = Math.round(
      (agg.successCount / agg.totalExecutions) * 100,
    );
    agg.lastExecutedAt = record.completedAt;
  }

  /** @private */
  _onSkillStarted(data) {
    // No-op: start time tracked in record
  }

  /** @private */
  _onSkillCompleted(data) {
    if (data.skillId && data.metrics) {
      this.recordExecution(data.skillId, {
        duration: data.metrics.executionTime || 0,
        success: true,
        tokensInput: data.metrics.tokensInput || 0,
        tokensOutput: data.metrics.tokensOutput || 0,
      });
    }
  }

  /** @private */
  _onSkillFailed(data) {
    if (data.skillId) {
      this.recordExecution(data.skillId, {
        duration: data.metrics?.executionTime || 0,
        success: false,
        error: data.error || "Unknown error",
      });
    }
  }

  /** @private */
  _onPipelineCompleted(data) {
    this._updatePipelineAgg(data.pipelineId, data.duration, true);
  }

  /** @private */
  _onPipelineFailed(data) {
    this._updatePipelineAgg(data.pipelineId, data.duration, false);
  }

  /** @private */
  _onPipelineStepCompleted(data) {
    // Individual step metrics already handled by recordExecution
  }

  /** @private */
  _updatePipelineAgg(pipelineId, duration, success) {
    let agg = this.pipelineMetrics.get(pipelineId);
    if (!agg) {
      agg = {
        pipelineId,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        lastExecutedAt: null,
      };
      this.pipelineMetrics.set(pipelineId, agg);
    }
    agg.totalExecutions++;
    if (success) {
      agg.successCount++;
    } else {
      agg.failureCount++;
    }
    agg.totalDurationMs += duration || 0;
    agg.avgDurationMs = Math.round(agg.totalDurationMs / agg.totalExecutions);
    agg.lastExecutedAt = Date.now();
  }
}

module.exports = { SkillMetricsCollector };
