/**
 * Postmortem Generator — LLM-based Incident Report (v3.3)
 *
 * Generates structured postmortem reports for resolved incidents:
 * - Collects incident timeline, remediation steps, metrics
 * - Uses LLM to generate root cause analysis and recommendations
 * - Produces Markdown-formatted reports
 * - Stores reports for historical reference
 *
 * @module ai-engine/cowork/postmortem-generator
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const REPORT_STATUS = {
  GENERATING: "generating",
  COMPLETED: "completed",
  FAILED: "failed",
};

const REPORT_SECTIONS = [
  "summary",
  "timeline",
  "root-cause",
  "impact",
  "remediation",
  "lessons-learned",
  "action-items",
];

const DEFAULT_CONFIG = {
  enableLLMAnalysis: true,
  includeMetrics: true,
  includeTimeline: true,
  includeRecommendations: true,
  maxTimelineEntries: 50,
  reportFormat: "markdown",
};

// ============================================================
// PostmortemGenerator Class
// ============================================================

class PostmortemGenerator extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.llmService = null;
    this.incidentClassifier = null;
    this.config = { ...DEFAULT_CONFIG };
    this.reports = new Map();
    this.stats = {
      totalReports: 0,
      averageGenerationTimeMs: 0,
    };
    this._genTimes = [];
  }

  /**
   * Initialize
   * @param {Object} db
   * @param {Object} deps
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.llmService = deps.llmService || null;
    this.incidentClassifier = deps.incidentClassifier || null;
    logger.info("[PostmortemGenerator] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Generate a postmortem report for an incident
   * @param {Object} options
   * @param {string} options.incidentId
   * @returns {Object} Generated report
   */
  async generate(options = {}) {
    if (!this.initialized) {
      throw new Error("PostmortemGenerator not initialized");
    }

    const { incidentId } = options;
    if (!incidentId) {
      throw new Error("incidentId is required");
    }

    const startTime = Date.now();
    const reportId = `pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      // Get incident details
      let incident = null;
      if (this.incidentClassifier?.initialized) {
        incident = this.incidentClassifier.getIncident(incidentId);
      }
      if (!incident) {
        throw new Error(`Incident not found: ${incidentId}`);
      }

      // Build report sections
      const sections = {};

      // Summary
      sections.summary = this._buildSummary(incident);

      // Timeline
      if (this.config.includeTimeline) {
        sections.timeline = this._buildTimeline(incident);
      }

      // Impact
      sections.impact = this._buildImpact(incident);

      // Remediation
      sections.remediation = this._buildRemediation(incident);

      // LLM analysis for root cause and recommendations
      if (this.config.enableLLMAnalysis && this.llmService) {
        const llmAnalysis = await this._llmAnalyze(incident, sections);
        sections.rootCause =
          llmAnalysis.rootCause || "需要人工分析确定根本原因";
        sections.lessonsLearned = llmAnalysis.lessonsLearned || [];
        sections.actionItems = llmAnalysis.actionItems || [];
      } else {
        sections.rootCause = "LLM 分析不可用 — 需要人工填写根本原因";
        sections.lessonsLearned = [];
        sections.actionItems = [
          { priority: "high", action: "人工分析本次事故的根本原因" },
          { priority: "medium", action: "评估是否需要增加监控覆盖" },
        ];
      }

      // Render to markdown
      const markdown = this._renderMarkdown(reportId, incident, sections);

      const elapsed = Date.now() - startTime;
      this._genTimes.push(elapsed);
      if (this._genTimes.length > 50) {
        this._genTimes.shift();
      }
      this.stats.totalReports++;
      this.stats.averageGenerationTimeMs = Math.round(
        this._genTimes.reduce((a, b) => a + b, 0) / this._genTimes.length,
      );

      const report = {
        id: reportId,
        incidentId,
        severity: incident.severity,
        status: REPORT_STATUS.COMPLETED,
        sections,
        markdown,
        generatedAt: new Date().toISOString(),
        duration: elapsed,
      };

      this.reports.set(reportId, report);
      this.emit("postmortem:generated", { reportId, incidentId, elapsed });

      logger.info(
        `[PostmortemGenerator] Report generated: ${reportId} (${elapsed}ms)`,
      );

      return report;
    } catch (error) {
      logger.error(`[PostmortemGenerator] Generation error: ${error.message}`);
      return {
        id: reportId,
        incidentId,
        status: REPORT_STATUS.FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Get a previously generated report
   */
  getReport(reportId) {
    return this.reports.get(reportId) || null;
  }

  getStats() {
    return { ...this.stats, reportCount: this.reports.size };
  }

  getConfig() {
    return { ...this.config };
  }

  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Section Builders
  // ============================================================

  _buildSummary(incident) {
    return {
      severity: incident.severity,
      metricName: incident.metricName,
      description:
        incident.description ||
        `${incident.severity} incident on ${incident.metricName}`,
      detectedAt: incident.createdAt,
      resolvedAt: incident.resolvedAt || null,
      duration: incident.resolvedAt
        ? new Date(incident.resolvedAt) - new Date(incident.createdAt)
        : null,
      status: incident.status,
    };
  }

  _buildTimeline(incident) {
    const entries = [];

    entries.push({
      time: incident.createdAt,
      event: "incident-detected",
      description: `异常检测触发 ${incident.severity} 告警`,
    });

    if (incident.timeline) {
      const timeline = Array.isArray(incident.timeline)
        ? incident.timeline
        : [];
      for (const entry of timeline.slice(0, this.config.maxTimelineEntries)) {
        entries.push(entry);
      }
    }

    if (incident.acknowledgedAt) {
      entries.push({
        time: incident.acknowledgedAt,
        event: "acknowledged",
        description: `事件已确认: ${incident.acknowledgedBy || "system"}`,
      });
    }

    if (incident.resolvedAt) {
      entries.push({
        time: incident.resolvedAt,
        event: "resolved",
        description: `事件已解决: ${incident.resolvedBy || "auto"}`,
      });
    }

    return entries.sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  _buildImpact(incident) {
    return {
      severity: incident.severity,
      affectedMetric: incident.metricName,
      anomalyCount: incident.anomalies?.length || 1,
      userImpact:
        incident.severity === "P0" || incident.severity === "P1"
          ? "high"
          : "low",
    };
  }

  _buildRemediation(incident) {
    return {
      remediationAttempted: Boolean(incident.remediationResult),
      remediationResult: incident.remediationResult || null,
      rollbackExecuted: Boolean(incident.rollbackExecuted),
      manualIntervention: incident.status === "escalated",
    };
  }

  // ============================================================
  // LLM Analysis
  // ============================================================

  async _llmAnalyze(incident, sections) {
    try {
      const prompt = `Analyze this production incident and provide a postmortem analysis.

Incident:
- Severity: ${incident.severity}
- Metric: ${incident.metricName}
- Description: ${incident.description || "N/A"}
- Status: ${incident.status}
- Duration: ${sections.summary.duration ? Math.round(sections.summary.duration / 1000) + "s" : "ongoing"}
- Remediation attempted: ${sections.remediation.remediationAttempted}
- Rollback executed: ${sections.remediation.rollbackExecuted}

Provide in JSON format:
{
  "rootCause": "string describing the likely root cause",
  "lessonsLearned": ["lesson1", "lesson2"],
  "actionItems": [{"priority": "high|medium|low", "action": "description"}]
}`;

      const result = await this.llmService.query(prompt, {
        systemPrompt:
          "You are an SRE expert. Analyze incidents and provide actionable postmortem insights. Respond only in valid JSON.",
        temperature: 0.3,
      });

      if (result) {
        try {
          return typeof result === "string" ? JSON.parse(result) : result;
        } catch {
          return { rootCause: result, lessonsLearned: [], actionItems: [] };
        }
      }
      return {};
    } catch (error) {
      logger.warn(
        `[PostmortemGenerator] LLM analysis failed: ${error.message}`,
      );
      return {};
    }
  }

  // ============================================================
  // Markdown Renderer
  // ============================================================

  _renderMarkdown(reportId, incident, sections) {
    const lines = [];

    lines.push(`# 事故报告 — ${reportId}`);
    lines.push("");
    lines.push(`**严重度**: ${incident.severity}`);
    lines.push(`**受影响指标**: ${incident.metricName}`);
    lines.push(`**生成时间**: ${new Date().toISOString()}`);
    lines.push("");

    // Summary
    lines.push("## 概述");
    lines.push("");
    lines.push(sections.summary.description);
    if (sections.summary.duration) {
      lines.push(
        `- **持续时长**: ${Math.round(sections.summary.duration / 1000)} 秒`,
      );
    }
    lines.push(`- **状态**: ${sections.summary.status}`);
    lines.push("");

    // Timeline
    if (sections.timeline?.length > 0) {
      lines.push("## 时间线");
      lines.push("");
      lines.push("| 时间 | 事件 | 描述 |");
      lines.push("|------|------|------|");
      for (const entry of sections.timeline) {
        lines.push(`| ${entry.time} | ${entry.event} | ${entry.description} |`);
      }
      lines.push("");
    }

    // Root Cause
    lines.push("## 根本原因");
    lines.push("");
    lines.push(sections.rootCause || "待分析");
    lines.push("");

    // Impact
    lines.push("## 影响范围");
    lines.push("");
    lines.push(`- **严重度**: ${sections.impact.severity}`);
    lines.push(`- **受影响指标**: ${sections.impact.affectedMetric}`);
    lines.push(`- **用户影响**: ${sections.impact.userImpact}`);
    lines.push("");

    // Remediation
    lines.push("## 修复措施");
    lines.push("");
    lines.push(
      `- **自动修复**: ${sections.remediation.remediationAttempted ? "是" : "否"}`,
    );
    lines.push(
      `- **回滚执行**: ${sections.remediation.rollbackExecuted ? "是" : "否"}`,
    );
    lines.push(
      `- **人工干预**: ${sections.remediation.manualIntervention ? "是" : "否"}`,
    );
    lines.push("");

    // Lessons Learned
    if (sections.lessonsLearned?.length > 0) {
      lines.push("## 经验教训");
      lines.push("");
      for (const lesson of sections.lessonsLearned) {
        lines.push(`- ${lesson}`);
      }
      lines.push("");
    }

    // Action Items
    if (sections.actionItems?.length > 0) {
      lines.push("## 后续行动");
      lines.push("");
      lines.push("| 优先级 | 行动 |");
      lines.push("|--------|------|");
      for (const item of sections.actionItems) {
        lines.push(`| ${item.priority} | ${item.action} |`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getPostmortemGenerator() {
  if (!instance) {
    instance = new PostmortemGenerator();
  }
  return instance;
}

module.exports = {
  PostmortemGenerator,
  getPostmortemGenerator,
  REPORT_STATUS,
};
