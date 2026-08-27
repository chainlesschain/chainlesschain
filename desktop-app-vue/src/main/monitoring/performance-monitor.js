const { logger } = require("../utils/logger.js");

const DEFAULT_PERFORMANCE_MONITOR_LIMITS = Object.freeze({
  maxSamplesPerPhase: 1000,
  maxMetadataBytes: 32 * 1024,
  maxRetainedBytes: 4 * 1024 * 1024,
  maxIdentifierChars: 256,
  maxReportRowsPerPhase: 10_000,
  maxSessionRows: 10_000,
  maxExportRows: 10_000,
  maxBottleneckRows: 100,
  maxTimeRangeMs: 365 * 24 * 60 * 60 * 1000,
});

const HARD_PERFORMANCE_MONITOR_LIMITS = Object.freeze({
  maxSamplesPerPhase: 10_000,
  maxMetadataBytes: 1024 * 1024,
  maxRetainedBytes: 64 * 1024 * 1024,
  maxIdentifierChars: 2048,
  maxReportRowsPerPhase: 100_000,
  maxSessionRows: 100_000,
  maxExportRows: 100_000,
  maxBottleneckRows: 1000,
  maxTimeRangeMs: 10 * 365 * 24 * 60 * 60 * 1000,
});

class PerformanceMonitorError extends Error {
  constructor(message, { code, scope, retryAfterMs, limit } = {}) {
    super(message);
    this.name = "PerformanceMonitorError";
    this.code = code;
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
    this.limit = limit;
  }
}

function boundedPositiveInteger(value, fallback, hardLimit) {
  const boundedFallback = Math.min(fallback, hardLimit);
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return boundedFallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return boundedFallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function boundedNonNegativeNumber(value, fallback, hardLimit) {
  const boundedFallback = Math.min(fallback, hardLimit);
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return boundedFallback;
  }
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return boundedFallback;
  }
  return Math.min(numericValue, hardLimit);
}

function cloneBoundedJson(value, maxBytes) {
  const seen = new WeakSet();
  let nodes = 0;
  let estimatedBytes = 0;

  const clone = (current, depth) => {
    nodes++;
    if (nodes > 10_000 || depth > 32) {
      throw new Error("metadata structure is too deep or complex");
    }
    if (current === null) {
      estimatedBytes += 4;
      return null;
    }
    if (typeof current === "string") {
      estimatedBytes += Buffer.byteLength(current, "utf8") + 2;
      if (estimatedBytes > maxBytes) {
        throw new Error("metadata exceeds byte limit");
      }
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error("metadata contains a non-finite number");
      }
      estimatedBytes += 24;
      return current;
    }
    if (typeof current === "boolean") {
      estimatedBytes += 5;
      return current;
    }
    if (typeof current !== "object") {
      throw new Error("metadata contains a non-JSON value");
    }
    if (seen.has(current)) {
      throw new Error("metadata contains a cycle");
    }
    seen.add(current);

    if (Array.isArray(current)) {
      estimatedBytes += current.length + 2;
      if (estimatedBytes > maxBytes) {
        throw new Error("metadata exceeds byte limit");
      }
      const result = current.map((item) => clone(item, depth + 1));
      seen.delete(current);
      return result;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("metadata must contain only plain JSON objects");
    }
    const result = {};
    for (const key of Object.keys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new Error("metadata accessors are not allowed");
      }
      estimatedBytes += Buffer.byteLength(key, "utf8") + 3;
      if (estimatedBytes > maxBytes) {
        throw new Error("metadata exceeds byte limit");
      }
      Object.defineProperty(result, key, {
        value: clone(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(current);
    return result;
  };

  const cloned = clone(value ?? {}, 0);
  const serialized = JSON.stringify(cloned);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) {
    throw new Error("metadata exceeds byte limit");
  }
  return { value: cloned, serialized, bytes };
}

/** Tolerant JSON column parse — a corrupt row must not abort a list-load loop. */
function safeParse(raw, fallback, maxBytes = Infinity) {
  if (raw == null || raw === "") {
    return fallback;
  }
  if (Buffer.byteLength(String(raw), "utf8") > maxBytes) {
    return fallback;
  }
  try {
    return cloneBoundedJson(JSON.parse(raw), maxBytes).value;
  } catch (err) {
    logger.warn(
      `[PerformanceMonitor] Bad JSON column, fallback: ${err.message}`,
    );
    return fallback;
  }
}

const PERFORMANCE_PHASES = Object.freeze([
  "intent_recognition",
  "multi_intent_recognition",
  "task_planning",
  "hierarchical_planning",
  "tool_execution",
  "rag_retrieval",
  "llm_calls",
  "total_pipeline",
  "total_pipeline_p1",
]);

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
  constructor(database, options = {}) {
    this.database = database;
    this.limits = {
      maxSamplesPerPhase: boundedPositiveInteger(
        options.maxSamplesPerPhase,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxSamplesPerPhase,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxSamplesPerPhase,
      ),
      maxMetadataBytes: boundedPositiveInteger(
        options.maxMetadataBytes,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxMetadataBytes,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxMetadataBytes,
      ),
      maxRetainedBytes: boundedPositiveInteger(
        options.maxRetainedBytes,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxRetainedBytes,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxRetainedBytes,
      ),
      maxIdentifierChars: boundedPositiveInteger(
        options.maxIdentifierChars,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxIdentifierChars,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxIdentifierChars,
      ),
      maxReportRowsPerPhase: boundedPositiveInteger(
        options.maxReportRowsPerPhase,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxReportRowsPerPhase,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxReportRowsPerPhase,
      ),
      maxSessionRows: boundedPositiveInteger(
        options.maxSessionRows,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxSessionRows,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxSessionRows,
      ),
      maxExportRows: boundedPositiveInteger(
        options.maxExportRows,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxExportRows,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxExportRows,
      ),
      maxBottleneckRows: boundedPositiveInteger(
        options.maxBottleneckRows,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxBottleneckRows,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxBottleneckRows,
      ),
      maxTimeRangeMs: boundedPositiveInteger(
        options.maxTimeRangeMs,
        DEFAULT_PERFORMANCE_MONITOR_LIMITS.maxTimeRangeMs,
        HARD_PERFORMANCE_MONITOR_LIMITS.maxTimeRangeMs,
      ),
    };
    this.metricSizes = new WeakMap();
    this.retainedMetricBytes = 0;

    // 内存缓存（用于快速统计）
    this.metrics = {
      intent_recognition: [],
      multi_intent_recognition: [],
      task_planning: [],
      hierarchical_planning: [],
      tool_execution: [],
      rag_retrieval: [],
      llm_calls: [],
      total_pipeline: [],
      total_pipeline_p1: [],
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
    if (!PERFORMANCE_PHASES.includes(phase)) {
      throw new PerformanceMonitorError("Unknown performance phase", {
        code: "INVALID_ARGUMENT",
        scope: "performance_phase",
      });
    }
    let normalizedDuration;
    try {
      normalizedDuration = Number(duration);
    } catch {
      normalizedDuration = NaN;
    }
    if (
      !Number.isFinite(normalizedDuration) ||
      normalizedDuration < 0 ||
      normalizedDuration > this.limits.maxTimeRangeMs
    ) {
      throw new PerformanceMonitorError("Invalid performance duration", {
        code: "INVALID_ARGUMENT",
        scope: "performance_duration",
        limit: { maxDurationMs: this.limits.maxTimeRangeMs },
      });
    }
    const normalizeIdentifier = (value, name) => {
      if (value == null) {
        return null;
      }
      if (
        typeof value !== "string" ||
        value.length > this.limits.maxIdentifierChars
      ) {
        throw new PerformanceMonitorError(`Invalid ${name}`, {
          code: "INVALID_ARGUMENT",
          scope: "performance_identifier",
          limit: { maxIdentifierChars: this.limits.maxIdentifierChars },
        });
      }
      return value;
    };
    let normalizedMetadata;
    try {
      normalizedMetadata = cloneBoundedJson(
        metadata,
        this.limits.maxMetadataBytes,
      );
    } catch (error) {
      throw new PerformanceMonitorError(
        `Invalid performance metadata: ${error.message}`,
        {
          code: "INVALID_ARGUMENT",
          scope: "performance_metadata",
          limit: { maxMetadataBytes: this.limits.maxMetadataBytes },
        },
      );
    }
    const normalizedUserId = normalizeIdentifier(userId, "userId");
    const normalizedSessionId = normalizeIdentifier(sessionId, "sessionId");
    const record = {
      phase,
      duration: normalizedDuration,
      metadata: normalizedMetadata.value,
      timestamp: Date.now(),
      userId: normalizedUserId,
      sessionId: normalizedSessionId,
    };

    // 添加到内存缓存
    if (this.metrics[phase]) {
      const retainedBytes =
        normalizedMetadata.bytes +
        Buffer.byteLength(phase, "utf8") +
        Buffer.byteLength(normalizedUserId || "", "utf8") +
        Buffer.byteLength(normalizedSessionId || "", "utf8") +
        64;
      this._retainRecord(phase, record, retainedBytes);

      // 限制内存缓存大小（最多保留最近1000条）
      // Count and global-byte pruning are handled together by _retainRecord.
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
            normalizedDuration,
            normalizedMetadata.serialized,
            record.timestamp,
            normalizedUserId,
            normalizedSessionId,
          ],
        );
      } catch (error) {
        logger.error("[PerformanceMonitor] 记录性能失败:", error);
      }
    }

    // 检查是否超过阈值
    this.checkThreshold(phase, normalizedDuration, normalizedMetadata.value);
  }

  _retainRecord(phase, record, retainedBytes) {
    const records = this.metrics[phase];
    records.push(record);
    this.metricSizes.set(record, retainedBytes);
    this.retainedMetricBytes += retainedBytes;

    while (records.length > this.limits.maxSamplesPerPhase) {
      this._evictRecord(records.shift());
    }
    while (this.retainedMetricBytes > this.limits.maxRetainedBytes) {
      let oldestPhase = null;
      let oldestTimestamp = Infinity;
      for (const candidatePhase of PERFORMANCE_PHASES) {
        const candidate = this.metrics[candidatePhase][0];
        if (candidate && candidate.timestamp < oldestTimestamp) {
          oldestTimestamp = candidate.timestamp;
          oldestPhase = candidatePhase;
        }
      }
      if (!oldestPhase) {
        this.retainedMetricBytes = 0;
        break;
      }
      this._evictRecord(this.metrics[oldestPhase].shift());
    }
  }

  _evictRecord(record) {
    if (!record) {
      return;
    }
    this.retainedMetricBytes = Math.max(
      0,
      this.retainedMetricBytes - (this.metricSizes.get(record) || 0),
    );
    this.metricSizes.delete(record);
  }

  getRetentionStats() {
    return {
      retainedBytes: this.retainedMetricBytes,
      maxRetainedBytes: this.limits.maxRetainedBytes,
      maxSamplesPerPhase: this.limits.maxSamplesPerPhase,
      samplesByPhase: Object.fromEntries(
        PERFORMANCE_PHASES.map((phase) => [phase, this.metrics[phase].length]),
      ),
    };
  }

  clearMemoryMetrics() {
    for (const phase of PERFORMANCE_PHASES) {
      this.metrics[phase] = [];
    }
    this.metricSizes = new WeakMap();
    this.retainedMetricBytes = 0;
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
    const normalizedTimeRange = boundedNonNegativeNumber(
      timeRange,
      7 * 24 * 60 * 60 * 1000,
      this.limits.maxTimeRangeMs,
    );
    const since = Date.now() - normalizedTimeRange;
    const report = {
      timeRange: this.formatTimeRange(normalizedTimeRange),
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
        SELECT duration
        FROM performance_metrics
        WHERE phase = ? AND created_at > ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
        [phase, since, this.limits.maxReportRowsPerPhase],
      );

      const boundedRows = rows.slice(0, this.limits.maxReportRowsPerPhase);
      if (boundedRows.length === 0) {
        return null;
      }

      const durations = boundedRows.map((r) => r.duration);

      return {
        count: boundedRows.length,
        avg: Math.round(this.average(durations)),
        p50: Math.round(this.percentile(durations, 50)),
        p90: Math.round(this.percentile(durations, 90)),
        p95: Math.round(this.percentile(durations, 95)),
        p99: Math.round(this.percentile(durations, 99)),
        max: Math.round(durations.reduce((max, value) => Math.max(max, value))),
        min: Math.round(durations.reduce((min, value) => Math.min(min, value))),
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
      const normalizedThreshold = boundedNonNegativeNumber(
        threshold,
        5000,
        this.limits.maxTimeRangeMs,
      );
      const normalizedLimit = boundedPositiveInteger(
        limit,
        20,
        this.limits.maxBottleneckRows,
      );
      const slowQueries = await this.database.all(
        `
        SELECT substr(phase, 1, 64) AS phase, duration,
               substr(metadata, 1, ?) AS metadata, created_at,
               substr(session_id, 1, ?) AS session_id
        FROM performance_metrics
        WHERE duration > ?
        ORDER BY duration DESC
        LIMIT ?
      `,
        [
          this.limits.maxMetadataBytes,
          this.limits.maxIdentifierChars,
          normalizedThreshold,
          normalizedLimit,
        ],
      );

      return slowQueries.slice(0, normalizedLimit).map((q) => {
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
          metadata: safeParse(q.metadata, {}, this.limits.maxMetadataBytes),
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
    if (
      typeof sessionId !== "string" ||
      !sessionId ||
      sessionId.length > this.limits.maxIdentifierChars
    ) {
      throw new PerformanceMonitorError("Invalid sessionId", {
        code: "INVALID_ARGUMENT",
        scope: "performance_identifier",
        limit: { maxIdentifierChars: this.limits.maxIdentifierChars },
      });
    }

    try {
      const rows = await this.database.all(
        `
        SELECT substr(phase, 1, 64) AS phase, duration,
               substr(metadata, 1, ?) AS metadata, created_at
        FROM performance_metrics
        WHERE session_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
        [this.limits.maxMetadataBytes, sessionId, this.limits.maxSessionRows],
      );

      const boundedRows = rows.slice(0, this.limits.maxSessionRows);
      if (boundedRows.length === 0) {
        return null;
      }

      const phaseBreakdown = Object.create(null);
      let totalDuration = 0;

      for (const row of boundedRows) {
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
          metadata: safeParse(row.metadata, {}, this.limits.maxMetadataBytes),
          timestamp: row.created_at,
        });
      }

      return {
        sessionId,
        totalDuration: Math.round(totalDuration),
        phaseCount: Object.keys(phaseBreakdown).length,
        recordCount: boundedRows.length,
        phaseBreakdown,
        timeline: boundedRows.map((r) => ({
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
        ORDER BY created_at DESC
        LIMIT ?
      `,
        [phase, startTime, endTime, this.limits.maxReportRowsPerPhase],
      );

      const boundedRows = rows.slice(0, this.limits.maxReportRowsPerPhase);
      if (boundedRows.length === 0) {
        return null;
      }

      const durations = boundedRows.map((r) => r.duration);

      return {
        count: boundedRows.length,
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
      const normalizedTimeRange = boundedNonNegativeNumber(
        timeRange,
        7 * 24 * 60 * 60 * 1000,
        this.limits.maxTimeRangeMs,
      );
      const since = Date.now() - normalizedTimeRange;

      const rows = await this.database.all(
        `
        SELECT id, substr(phase, 1, 64) AS phase, duration,
               substr(metadata, 1, ?) AS metadata, created_at,
               substr(user_id, 1, ?) AS user_id,
               substr(session_id, 1, ?) AS session_id
        FROM performance_metrics
        WHERE created_at > ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
        [
          this.limits.maxMetadataBytes,
          this.limits.maxIdentifierChars,
          this.limits.maxIdentifierChars,
          since,
          this.limits.maxExportRows,
        ],
      );

      return rows.slice(0, this.limits.maxExportRows).map((row) => {
        const createdAt = new Date(row.created_at);
        return {
          ...row,
          metadata: safeParse(row.metadata, {}, this.limits.maxMetadataBytes),
          created_at: Number.isNaN(createdAt.getTime())
            ? null
            : createdAt.toISOString(),
        };
      });
    } catch (error) {
      logger.error("[PerformanceMonitor] 导出数据失败:", error);
      return [];
    }
  }
}

module.exports = PerformanceMonitor;
module.exports.PerformanceMonitorError = PerformanceMonitorError;
module.exports.DEFAULT_PERFORMANCE_MONITOR_LIMITS =
  DEFAULT_PERFORMANCE_MONITOR_LIMITS;
module.exports.HARD_PERFORMANCE_MONITOR_LIMITS =
  HARD_PERFORMANCE_MONITOR_LIMITS;
module.exports.PERFORMANCE_PHASES = PERFORMANCE_PHASES;
