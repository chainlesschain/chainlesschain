/**
 * UsageReportGenerator - Usage Analytics and Report Generation
 *
 * Generates comprehensive usage reports:
 * - Weekly and monthly usage reports
 * - LLM cost analysis and optimization recommendations
 * - Feature usage statistics
 * - Export to Markdown, JSON, CSV formats
 *
 * @module usage-report-generator
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * UsageReportGenerator class
 */
class UsageReportGenerator extends EventEmitter {
  /**
   * Create a UsageReportGenerator instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.reportsDir - Directory for report files
   * @param {Object} [options.tokenTracker] - TokenTracker instance for LLM stats
   * @param {Object} [options.configManager] - UnifiedConfigManager instance
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[UsageReportGenerator] database parameter is required");
    }

    this.db = options.database;
    this.reportsDir =
      options.reportsDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "reports");
    this.tokenTracker = options.tokenTracker || null;
    this.configManager = options.configManager || null;

    // Exchange rate for USD to CNY
    this.exchangeRate = 7.2;

    // Schedule timer
    this.scheduleTimer = null;
    this.scheduleCheckInterval = 60 * 60 * 1000; // Check every hour

    logger.info("[UsageReportGenerator] Initialized", {
      reportsDir: this.reportsDir,
      hasTokenTracker: !!this.tokenTracker,
    });
  }

  /**
   * Initialize the generator
   */
  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(this.reportsDir, { recursive: true });

      // Ensure tables exist
      await this._ensureTables();

      // Start schedule checker
      this._startScheduleChecker();

      logger.info("[UsageReportGenerator] Initialization complete");
    } catch (error) {
      logger.error("[UsageReportGenerator] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Ensure database tables exist
   * @private
   */
  async _ensureTables() {
    try {
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='usage_reports'
      `);
      const exists = tableCheck.get();

      if (!exists) {
        // Create usage_reports table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS usage_reports (
            id TEXT PRIMARY KEY,
            report_type TEXT NOT NULL,
            report_scope TEXT NOT NULL,
            period_start INTEGER NOT NULL,
            period_end INTEGER NOT NULL,
            summary TEXT NOT NULL,
            details TEXT,
            recommendations TEXT,
            file_path TEXT,
            format TEXT DEFAULT 'markdown',
            generation_time_ms INTEGER,
            generated_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create report_subscriptions table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS report_subscriptions (
            id TEXT PRIMARY KEY,
            subscription_name TEXT NOT NULL,
            report_type TEXT NOT NULL,
            report_scope TEXT DEFAULT 'full',
            frequency TEXT NOT NULL,
            day_of_week INTEGER DEFAULT 1,
            day_of_month INTEGER DEFAULT 1,
            hour INTEGER DEFAULT 9,
            export_format TEXT DEFAULT 'markdown',
            auto_export INTEGER DEFAULT 1,
            export_directory TEXT,
            is_enabled INTEGER DEFAULT 1,
            last_generated_at INTEGER,
            last_report_id TEXT,
            next_generation_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create indexes
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_usage_reports_type ON usage_reports(report_type, period_start DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_report_subscriptions_enabled ON report_subscriptions(is_enabled, next_generation_at)`,
          )
          .run();

        logger.info("[UsageReportGenerator] Database tables created");
      }
    } catch (error) {
      logger.error("[UsageReportGenerator] Failed to ensure tables:", error);
      throw error;
    }
  }

  /**
   * Start schedule checker
   * @private
   */
  _startScheduleChecker() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
    }

    this.scheduleTimer = setInterval(async () => {
      await this._checkAndRunSubscriptions();
    }, this.scheduleCheckInterval);

    logger.info("[UsageReportGenerator] Schedule checker started");
  }

  /**
   * Stop schedule checker
   */
  stopScheduleChecker() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
      logger.info("[UsageReportGenerator] Schedule checker stopped");
    }
  }

  /**
   * Check and run due subscriptions
   * @private
   */
  async _checkAndRunSubscriptions() {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        SELECT * FROM report_subscriptions
        WHERE is_enabled = 1 AND next_generation_at <= ?
      `);
      const dueSubscriptions = stmt.all(now);

      for (const sub of dueSubscriptions) {
        logger.info(
          `[UsageReportGenerator] Running subscription: ${sub.subscription_name}`,
        );

        try {
          let report;
          if (sub.report_type === "weekly") {
            report = await this.generateWeeklyReport({
              scope: sub.report_scope,
            });
          } else if (sub.report_type === "monthly") {
            report = await this.generateMonthlyReport({
              scope: sub.report_scope,
            });
          }

          // Export if auto_export is enabled
          if (report && sub.auto_export) {
            await this.exportReport(report.id, {
              format: sub.export_format,
              directory: sub.export_directory,
            });
          }

          // Update subscription
          const nextGen = this._calculateNextGeneration(sub);
          this.db
            .prepare(
              `
            UPDATE report_subscriptions
            SET last_generated_at = ?, last_report_id = ?, next_generation_at = ?, updated_at = ?
            WHERE id = ?
          `,
            )
            .run(now, report?.id, nextGen, now, sub.id);

          this.emit("subscription-completed", { subscription: sub, report });
        } catch (error) {
          logger.error(
            `[UsageReportGenerator] Subscription failed: ${sub.subscription_name}`,
            error,
          );
          this.emit("subscription-failed", {
            subscription: sub,
            error: error.message,
          });
        }
      }
    } catch (error) {
      logger.error("[UsageReportGenerator] Schedule check failed:", error);
    }
  }

  /**
   * Calculate next generation time
   * @param {Object} subscription - Subscription config
   * @returns {number} Next generation timestamp
   * @private
   */
  _calculateNextGeneration(subscription) {
    const now = new Date();
    const next = new Date();

    if (subscription.frequency === "weekly") {
      // Find next occurrence of day_of_week
      const daysUntilNext =
        (7 + (subscription.day_of_week || 1) - now.getDay()) % 7 || 7;
      next.setDate(next.getDate() + daysUntilNext);
      next.setHours(subscription.hour || 9);
      next.setMinutes(0);
      next.setSeconds(0);
    } else if (subscription.frequency === "monthly") {
      // Find next occurrence of day_of_month
      next.setMonth(next.getMonth() + 1);
      next.setDate(subscription.day_of_month || 1);
      next.setHours(subscription.hour || 9);
      next.setMinutes(0);
      next.setSeconds(0);
    }

    return next.getTime();
  }

  /**
   * Generate a weekly report
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Generated report
   */
  async generateWeeklyReport(options = {}) {
    const { scope = "full", endDate = Date.now() } = options;
    const startDate = endDate - 7 * 24 * 60 * 60 * 1000;

    logger.info(
      `[UsageReportGenerator] Generating weekly report: scope=${scope}`,
    );
    const startTime = Date.now();

    try {
      // Gather LLM usage statistics
      const llmStats = await this._getLLMStats(startDate, endDate);

      // Gather feature usage statistics
      const featureStats = await this._getFeatureStats(startDate, endDate);

      // Generate recommendations
      const recommendations = this._generateRecommendations(
        llmStats,
        featureStats,
      );

      // Build summary
      const summary = {
        periodStart: startDate,
        periodEnd: endDate,
        periodLabel: this._formatPeriodLabel(startDate, endDate),
        llm: {
          totalCalls: llmStats.totalCalls,
          totalTokens: llmStats.totalTokens,
          totalCostUsd: llmStats.totalCostUsd,
          totalCostCny: llmStats.totalCostCny,
          cacheHitRate: llmStats.cacheHitRate,
          avgResponseTime: llmStats.avgResponseTime,
        },
        features: {
          totalActions: featureStats.totalActions,
          topFeatures: featureStats.topFeatures,
          successRate: featureStats.successRate,
        },
      };

      // Build details
      const details = {
        llmByProvider: llmStats.byProvider,
        llmByModel: llmStats.byModel,
        llmDailyTrend: llmStats.dailyTrend,
        featureBreakdown: featureStats.breakdown,
      };

      // Save report
      const report = await this._saveReport({
        type: "weekly",
        scope,
        periodStart: startDate,
        periodEnd: endDate,
        summary,
        details,
        recommendations,
        generationTimeMs: Date.now() - startTime,
      });

      this.emit("report-generated", report);
      logger.info(
        `[UsageReportGenerator] Weekly report generated: ${report.id}`,
      );

      return report;
    } catch (error) {
      logger.error("[UsageReportGenerator] Weekly report failed:", error);
      throw error;
    }
  }

  /**
   * Generate a monthly report
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Generated report
   */
  async generateMonthlyReport(options = {}) {
    const { scope = "full", endDate = Date.now() } = options;
    const startDate = endDate - 30 * 24 * 60 * 60 * 1000;

    logger.info(
      `[UsageReportGenerator] Generating monthly report: scope=${scope}`,
    );
    const startTime = Date.now();

    try {
      // Gather LLM usage statistics
      const llmStats = await this._getLLMStats(startDate, endDate);

      // Gather feature usage statistics
      const featureStats = await this._getFeatureStats(startDate, endDate);

      // Generate recommendations
      const recommendations = this._generateRecommendations(
        llmStats,
        featureStats,
      );

      // Build summary
      const summary = {
        periodStart: startDate,
        periodEnd: endDate,
        periodLabel: this._formatPeriodLabel(startDate, endDate),
        llm: {
          totalCalls: llmStats.totalCalls,
          totalTokens: llmStats.totalTokens,
          totalCostUsd: llmStats.totalCostUsd,
          totalCostCny: llmStats.totalCostCny,
          cacheHitRate: llmStats.cacheHitRate,
          avgResponseTime: llmStats.avgResponseTime,
          weeklyTrend: llmStats.weeklyTrend,
        },
        features: {
          totalActions: featureStats.totalActions,
          topFeatures: featureStats.topFeatures,
          successRate: featureStats.successRate,
        },
      };

      // Build details
      const details = {
        llmByProvider: llmStats.byProvider,
        llmByModel: llmStats.byModel,
        llmWeeklyTrend: llmStats.weeklyTrend,
        featureBreakdown: featureStats.breakdown,
      };

      // Save report
      const report = await this._saveReport({
        type: "monthly",
        scope,
        periodStart: startDate,
        periodEnd: endDate,
        summary,
        details,
        recommendations,
        generationTimeMs: Date.now() - startTime,
      });

      this.emit("report-generated", report);
      logger.info(
        `[UsageReportGenerator] Monthly report generated: ${report.id}`,
      );

      return report;
    } catch (error) {
      logger.error("[UsageReportGenerator] Monthly report failed:", error);
      throw error;
    }
  }

  /**
   * Generate cost analysis
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {Promise<Object>} Cost analysis
   */
  async generateCostAnalysis(startDate, endDate) {
    logger.info("[UsageReportGenerator] Generating cost analysis");

    try {
      const llmStats = await this._getLLMStats(startDate, endDate);

      // Calculate cost projections
      const daysInPeriod = (endDate - startDate) / (24 * 60 * 60 * 1000);
      const dailyAverage = llmStats.totalCostUsd / daysInPeriod;
      const weeklyProjection = dailyAverage * 7;
      const monthlyProjection = dailyAverage * 30;

      // Identify cost optimization opportunities
      const optimizations = [];

      // Check if local models could save costs
      const _ollamaUsage = llmStats.byProvider.find(
        (p) => p.provider === "ollama",
      );
      const cloudProviders = llmStats.byProvider.filter(
        (p) => p.provider !== "ollama" && p.cost_usd > 0,
      );

      if (cloudProviders.length > 0) {
        const totalCloudCost = cloudProviders.reduce(
          (sum, p) => sum + p.cost_usd,
          0,
        );
        optimizations.push({
          type: "use_local_models",
          description: "Consider using local Ollama models for simple queries",
          potentialSavings: totalCloudCost * 0.3, // Assume 30% could be offloaded
          priority: "high",
        });
      }

      // Check cache utilization
      if (llmStats.cacheHitRate < 30) {
        optimizations.push({
          type: "improve_caching",
          description:
            "Enable prompt caching to reduce costs for repeated queries",
          potentialSavings: llmStats.totalCostUsd * 0.15,
          priority: "medium",
        });
      }

      // Check for expensive model usage
      const expensiveModels = llmStats.byModel.filter((m) => m.cost_usd > 1);
      if (expensiveModels.length > 0) {
        optimizations.push({
          type: "model_selection",
          description:
            "Review usage of expensive models - consider smaller models for simple tasks",
          potentialSavings:
            expensiveModels.reduce((sum, m) => sum + m.cost_usd, 0) * 0.4,
          priority: "high",
        });
      }

      return {
        period: { start: startDate, end: endDate, days: daysInPeriod },
        totals: {
          costUsd: llmStats.totalCostUsd,
          costCny: llmStats.totalCostCny,
          tokens: llmStats.totalTokens,
          calls: llmStats.totalCalls,
        },
        projections: {
          daily: dailyAverage,
          weekly: weeklyProjection,
          monthly: monthlyProjection,
        },
        byProvider: llmStats.byProvider,
        byModel: llmStats.byModel,
        optimizations,
        cacheHitRate: llmStats.cacheHitRate,
      };
    } catch (error) {
      logger.error("[UsageReportGenerator] Cost analysis failed:", error);
      throw error;
    }
  }

  /**
   * Export report to file
   * @param {string} reportId - Report ID
   * @param {Object} options - Export options
   * @returns {Promise<Object>} Export result
   */
  async exportReport(reportId, options = {}) {
    const { format = "markdown", directory } = options;

    try {
      const report = this.db
        .prepare(`SELECT * FROM usage_reports WHERE id = ?`)
        .get(reportId);

      if (!report) {
        throw new Error("Report not found");
      }

      const summary = JSON.parse(report.summary);
      const details = JSON.parse(report.details || "{}");
      const recommendations = JSON.parse(report.recommendations || "[]");

      let content;
      let extension;

      switch (format) {
        case "markdown":
          content = this._formatMarkdownReport(
            report,
            summary,
            details,
            recommendations,
          );
          extension = "md";
          break;
        case "json":
          content = JSON.stringify(
            { report, summary, details, recommendations },
            null,
            2,
          );
          extension = "json";
          break;
        case "csv":
          content = this._formatCSVReport(summary, details);
          extension = "csv";
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      // Generate filename
      const dateStr = new Date(report.period_start).toISOString().split("T")[0];
      const filename = `${report.report_type}-report-${dateStr}.${extension}`;
      const exportDir = directory || this.reportsDir;
      const filePath = path.join(exportDir, filename);

      // Write file
      await fs.mkdir(exportDir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");

      // Update report with file path
      this.db
        .prepare(
          `UPDATE usage_reports SET file_path = ?, format = ? WHERE id = ?`,
        )
        .run(filePath, format, reportId);

      logger.info(`[UsageReportGenerator] Report exported: ${filePath}`);

      return { success: true, filePath, format };
    } catch (error) {
      logger.error("[UsageReportGenerator] Export failed:", error);
      throw error;
    }
  }

  /**
   * Get LLM usage statistics
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {Promise<Object>} LLM statistics
   * @private
   */
  async _getLLMStats(startDate, endDate) {
    try {
      // Check if llm_usage_log table exists
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='llm_usage_log'
      `);
      if (!tableCheck.get()) {
        return this._getEmptyLLMStats();
      }

      // Total statistics
      const totalStmt = this.db.prepare(`
        SELECT
          COUNT(*) as total_calls,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as total_cost_usd,
          COALESCE(SUM(cost_cny), 0) as total_cost_cny,
          COALESCE(SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END), 0) as cached_calls,
          AVG(response_time) as avg_response_time
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
      `);
      const totals = totalStmt.get(startDate, endDate);

      // By provider
      const providerStmt = this.db.prepare(`
        SELECT
          provider,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider
        ORDER BY cost_usd DESC
      `);
      const byProvider = providerStmt.all(startDate, endDate);

      // By model
      const modelStmt = this.db.prepare(`
        SELECT
          provider,
          model,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC
        LIMIT 10
      `);
      const byModel = modelStmt.all(startDate, endDate);

      // Daily trend
      const dailyStmt = this.db.prepare(`
        SELECT
          date(created_at / 1000, 'unixepoch') as date,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY date
        ORDER BY date
      `);
      const dailyTrend = dailyStmt.all(startDate, endDate);

      // Weekly trend (for monthly reports)
      const weeklyStmt = this.db.prepare(`
        SELECT
          strftime('%Y-W%W', created_at / 1000, 'unixepoch') as week,
          COUNT(*) as calls,
          SUM(total_tokens) as tokens,
          SUM(cost_usd) as cost_usd
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY week
        ORDER BY week
      `);
      const weeklyTrend = weeklyStmt.all(startDate, endDate);

      return {
        totalCalls: totals.total_calls || 0,
        totalInputTokens: totals.total_input_tokens || 0,
        totalOutputTokens: totals.total_output_tokens || 0,
        totalTokens: totals.total_tokens || 0,
        totalCostUsd: totals.total_cost_usd || 0,
        totalCostCny: totals.total_cost_cny || 0,
        cachedCalls: totals.cached_calls || 0,
        cacheHitRate:
          totals.total_calls > 0
            ? ((totals.cached_calls / totals.total_calls) * 100).toFixed(2)
            : 0,
        avgResponseTime: Math.round(totals.avg_response_time || 0),
        byProvider,
        byModel,
        dailyTrend,
        weeklyTrend,
      };
    } catch (error) {
      logger.error("[UsageReportGenerator] Failed to get LLM stats:", error);
      return this._getEmptyLLMStats();
    }
  }

  /**
   * Get empty LLM stats
   * @private
   */
  _getEmptyLLMStats() {
    return {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      totalCostCny: 0,
      cachedCalls: 0,
      cacheHitRate: 0,
      avgResponseTime: 0,
      byProvider: [],
      byModel: [],
      dailyTrend: [],
      weeklyTrend: [],
    };
  }

  /**
   * Get feature usage statistics
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {Promise<Object>} Feature statistics
   * @private
   */
  async _getFeatureStats(startDate, endDate) {
    try {
      // Check if usage_history table exists
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='usage_history'
      `);
      if (!tableCheck.get()) {
        return this._getEmptyFeatureStats();
      }

      // Total statistics
      const totalStmt = this.db.prepare(`
        SELECT
          COUNT(*) as total_actions,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
        FROM usage_history
        WHERE created_at >= ? AND created_at <= ?
      `);
      const totals = totalStmt.get(startDate, endDate);

      // By feature
      const featureStmt = this.db.prepare(`
        SELECT
          feature,
          action,
          COUNT(*) as count,
          SUM(duration_ms) as total_duration,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
        FROM usage_history
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY feature, action
        ORDER BY count DESC
      `);
      const breakdown = featureStmt.all(startDate, endDate);

      // Top features
      const topStmt = this.db.prepare(`
        SELECT feature, COUNT(*) as count
        FROM usage_history
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY feature
        ORDER BY count DESC
        LIMIT 5
      `);
      const topFeatures = topStmt.all(startDate, endDate);

      return {
        totalActions: totals.total_actions || 0,
        successRate:
          totals.total_actions > 0
            ? ((totals.success_count / totals.total_actions) * 100).toFixed(2)
            : 0,
        topFeatures,
        breakdown,
      };
    } catch (error) {
      logger.error(
        "[UsageReportGenerator] Failed to get feature stats:",
        error,
      );
      return this._getEmptyFeatureStats();
    }
  }

  /**
   * Get empty feature stats
   * @private
   */
  _getEmptyFeatureStats() {
    return {
      totalActions: 0,
      successRate: 0,
      topFeatures: [],
      breakdown: [],
    };
  }

  /**
   * Generate recommendations based on stats
   * @param {Object} llmStats - LLM statistics
   * @param {Object} featureStats - Feature statistics
   * @returns {Array} Recommendations
   * @private
   */
  _generateRecommendations(llmStats, featureStats) {
    const recommendations = [];

    // LLM recommendations
    if (llmStats.totalCostUsd > 10) {
      recommendations.push({
        category: "cost",
        priority: "high",
        title: "Consider using local models",
        description:
          "Your LLM costs are significant. Consider using local Ollama models for simpler queries to reduce costs.",
      });
    }

    if (parseFloat(llmStats.cacheHitRate) < 20) {
      recommendations.push({
        category: "performance",
        priority: "medium",
        title: "Enable response caching",
        description:
          "Your cache hit rate is low. Enable response caching to improve performance and reduce costs.",
      });
    }

    if (llmStats.avgResponseTime > 5000) {
      recommendations.push({
        category: "performance",
        priority: "medium",
        title: "Optimize response times",
        description:
          "Average response times are high. Consider using faster models or enabling streaming.",
      });
    }

    // Feature recommendations
    if (parseFloat(featureStats.successRate) < 90) {
      recommendations.push({
        category: "quality",
        priority: "high",
        title: "Review error patterns",
        description:
          "Success rate is below 90%. Review the error monitor for common issues.",
      });
    }

    return recommendations;
  }

  /**
   * Format period label
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {string} Period label
   * @private
   */
  _formatPeriodLabel(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const format = (d) => d.toISOString().split("T")[0];
    return `${format(start)} - ${format(end)}`;
  }

  /**
   * Format Markdown report
   * @private
   */
  _formatMarkdownReport(report, summary, details, recommendations) {
    const lines = [];
    const type = report.report_type === "weekly" ? "Weekly" : "Monthly";

    lines.push(`# ${type} Usage Report`);
    lines.push(`**Period**: ${summary.periodLabel}`);
    lines.push(`**Generated**: ${new Date(report.generated_at).toISOString()}`);
    lines.push("");

    // Summary section
    lines.push("## Summary");
    lines.push("");
    lines.push("### LLM Usage");
    lines.push(`- **Total Calls**: ${summary.llm.totalCalls.toLocaleString()}`);
    lines.push(
      `- **Total Tokens**: ${summary.llm.totalTokens.toLocaleString()}`,
    );
    lines.push(
      `- **Total Cost (USD)**: $${summary.llm.totalCostUsd.toFixed(2)}`,
    );
    lines.push(
      `- **Total Cost (CNY)**: ¥${summary.llm.totalCostCny.toFixed(2)}`,
    );
    lines.push(`- **Cache Hit Rate**: ${summary.llm.cacheHitRate}%`);
    lines.push(`- **Avg Response Time**: ${summary.llm.avgResponseTime}ms`);
    lines.push("");

    lines.push("### Feature Usage");
    lines.push(
      `- **Total Actions**: ${summary.features.totalActions.toLocaleString()}`,
    );
    lines.push(`- **Success Rate**: ${summary.features.successRate}%`);
    lines.push("");

    // LLM breakdown
    if (details.llmByProvider && details.llmByProvider.length > 0) {
      lines.push("## LLM Usage by Provider");
      lines.push("");
      lines.push("| Provider | Calls | Tokens | Cost (USD) |");
      lines.push("|----------|-------|--------|------------|");
      for (const p of details.llmByProvider) {
        lines.push(
          `| ${p.provider} | ${p.calls.toLocaleString()} | ${p.tokens.toLocaleString()} | $${p.cost_usd.toFixed(2)} |`,
        );
      }
      lines.push("");
    }

    if (details.llmByModel && details.llmByModel.length > 0) {
      lines.push("## Top Models by Cost");
      lines.push("");
      lines.push("| Provider | Model | Calls | Cost (USD) |");
      lines.push("|----------|-------|-------|------------|");
      for (const m of details.llmByModel.slice(0, 10)) {
        lines.push(
          `| ${m.provider} | ${m.model} | ${m.calls.toLocaleString()} | $${m.cost_usd.toFixed(2)} |`,
        );
      }
      lines.push("");
    }

    // Recommendations
    if (recommendations && recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (const rec of recommendations) {
        lines.push(`### ${rec.priority === "high" ? "⚠️" : "💡"} ${rec.title}`);
        lines.push(rec.description);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("*Generated by ChainlessChain Usage Report Generator*");

    return lines.join("\n");
  }

  /**
   * Format CSV report
   * @private
   */
  _formatCSVReport(summary, details) {
    const lines = [];

    // Header
    lines.push("Metric,Value");

    // Summary
    lines.push(`Total LLM Calls,${summary.llm.totalCalls}`);
    lines.push(`Total Tokens,${summary.llm.totalTokens}`);
    lines.push(`Total Cost USD,$${summary.llm.totalCostUsd.toFixed(2)}`);
    lines.push(`Total Cost CNY,¥${summary.llm.totalCostCny.toFixed(2)}`);
    lines.push(`Cache Hit Rate,${summary.llm.cacheHitRate}%`);
    lines.push(`Avg Response Time,${summary.llm.avgResponseTime}ms`);
    lines.push(`Total Feature Actions,${summary.features.totalActions}`);
    lines.push(`Feature Success Rate,${summary.features.successRate}%`);

    // Provider breakdown
    lines.push("");
    lines.push("Provider,Calls,Tokens,Cost USD");
    if (details.llmByProvider) {
      for (const p of details.llmByProvider) {
        lines.push(
          `${p.provider},${p.calls},${p.tokens},$${p.cost_usd.toFixed(2)}`,
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * Save report to database
   * @param {Object} reportData - Report data
   * @returns {Promise<Object>} Saved report
   * @private
   */
  async _saveReport(reportData) {
    const id = uuidv4();
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO usage_reports (
        id, report_type, report_scope, period_start, period_end,
        summary, details, recommendations, generation_time_ms,
        generated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        reportData.type,
        reportData.scope,
        reportData.periodStart,
        reportData.periodEnd,
        JSON.stringify(reportData.summary),
        JSON.stringify(reportData.details),
        JSON.stringify(reportData.recommendations),
        reportData.generationTimeMs,
        now,
        now,
      );

    return {
      id,
      type: reportData.type,
      scope: reportData.scope,
      periodStart: reportData.periodStart,
      periodEnd: reportData.periodEnd,
      summary: reportData.summary,
      generatedAt: now,
    };
  }

  /**
   * Get report by ID
   * @param {string} reportId - Report ID
   * @returns {Promise<Object|null>} Report or null
   */
  async getReport(reportId) {
    try {
      const report = this.db
        .prepare(`SELECT * FROM usage_reports WHERE id = ?`)
        .get(reportId);

      if (!report) {
        return null;
      }

      return {
        id: report.id,
        type: report.report_type,
        scope: report.report_scope,
        periodStart: report.period_start,
        periodEnd: report.period_end,
        summary: JSON.parse(report.summary),
        details: JSON.parse(report.details || "{}"),
        recommendations: JSON.parse(report.recommendations || "[]"),
        filePath: report.file_path,
        format: report.format,
        generationTimeMs: report.generation_time_ms,
        generatedAt: report.generated_at,
      };
    } catch (error) {
      logger.error("[UsageReportGenerator] Failed to get report:", error);
      return null;
    }
  }

  /**
   * List reports
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of reports
   */
  async listReports(options = {}) {
    const { type, limit = 20 } = options;

    try {
      let sql = `SELECT * FROM usage_reports WHERE 1=1`;
      const params = [];

      if (type) {
        sql += ` AND report_type = ?`;
        params.push(type);
      }

      sql += ` ORDER BY generated_at DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(sql);
      return stmt.all(...params).map((r) => ({
        id: r.id,
        type: r.report_type,
        scope: r.report_scope,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        filePath: r.file_path,
        format: r.format,
        generatedAt: r.generated_at,
      }));
    } catch (error) {
      logger.error("[UsageReportGenerator] Failed to list reports:", error);
      return [];
    }
  }

  /**
   * Configure subscription
   * @param {Object} config - Subscription config
   * @returns {Promise<Object>} Created subscription
   */
  async configureSubscription(config) {
    const {
      name,
      reportType = "weekly",
      scope = "full",
      frequency,
      dayOfWeek = 1,
      dayOfMonth = 1,
      hour = 9,
      exportFormat = "markdown",
      autoExport = true,
      exportDirectory,
      enabled = true,
    } = config;

    if (!name) {
      throw new Error("Subscription name is required");
    }

    const id = uuidv4();
    const now = Date.now();

    const sub = {
      frequency: frequency || reportType,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth,
      hour,
    };
    const nextGen = this._calculateNextGeneration(sub);

    try {
      this.db
        .prepare(
          `
        INSERT INTO report_subscriptions (
          id, subscription_name, report_type, report_scope, frequency,
          day_of_week, day_of_month, hour, export_format, auto_export,
          export_directory, is_enabled, next_generation_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          name,
          reportType,
          scope,
          frequency || reportType,
          dayOfWeek,
          dayOfMonth,
          hour,
          exportFormat,
          autoExport ? 1 : 0,
          exportDirectory || null,
          enabled ? 1 : 0,
          nextGen,
          now,
          now,
        );

      logger.info(`[UsageReportGenerator] Subscription created: ${name}`);

      return {
        id,
        name,
        reportType,
        scope,
        frequency: frequency || reportType,
        nextGenerationAt: nextGen,
        enabled,
      };
    } catch (error) {
      logger.error(
        "[UsageReportGenerator] Failed to create subscription:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get subscriptions
   * @returns {Promise<Array>} List of subscriptions
   */
  async getSubscriptions() {
    try {
      const stmt = this.db.prepare(
        `SELECT * FROM report_subscriptions ORDER BY created_at DESC`,
      );
      return stmt.all().map((s) => ({
        id: s.id,
        name: s.subscription_name,
        reportType: s.report_type,
        scope: s.report_scope,
        frequency: s.frequency,
        dayOfWeek: s.day_of_week,
        dayOfMonth: s.day_of_month,
        hour: s.hour,
        exportFormat: s.export_format,
        autoExport: s.auto_export === 1,
        exportDirectory: s.export_directory,
        enabled: s.is_enabled === 1,
        lastGeneratedAt: s.last_generated_at,
        nextGenerationAt: s.next_generation_at,
      }));
    } catch (error) {
      logger.error(
        "[UsageReportGenerator] Failed to get subscriptions:",
        error,
      );
      return [];
    }
  }

  /**
   * Delete subscription
   * @param {string} id - Subscription ID
   */
  async deleteSubscription(id) {
    try {
      this.db.prepare(`DELETE FROM report_subscriptions WHERE id = ?`).run(id);
      logger.info(`[UsageReportGenerator] Subscription deleted: ${id}`);
    } catch (error) {
      logger.error(
        "[UsageReportGenerator] Failed to delete subscription:",
        error,
      );
      throw error;
    }
  }
}

module.exports = {
  UsageReportGenerator,
};
