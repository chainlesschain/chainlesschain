/**
 * ReflectionEngine — Periodic self-review of accumulated trajectory data.
 *
 * Generates structured reflection reports:
 *   - Tool usage patterns (most used, error-prone)
 *   - Score trends (improving / declining)
 *   - Skill coverage gaps
 *   - Improvement recommendations
 *
 * Trigger: manual via CLI command or scheduled (cron-style)
 * Output: JSON report stored in DB + optional SKILL.md improvements
 */

import { extractToolNames } from "./skill-synthesizer.js";

// ── _deps for test injection ────────────────────────
const _deps = {
  now: () => Date.now(),
};

// ── Helpers ─────────────────────────────────────────

/**
 * Compute tool usage statistics from trajectories.
 * @param {Array<{toolChain:Array<{tool:string, status:string}>}>} trajectories
 * @returns {{toolUsage:Record<string, {count:number, errorRate:number}>, totalTools:number}}
 */
export function computeToolStats(trajectories) {
  const stats = {};
  let totalTools = 0;

  for (const traj of trajectories) {
    for (const step of traj.toolChain || []) {
      totalTools++;
      if (!stats[step.tool]) {
        stats[step.tool] = { count: 0, errors: 0 };
      }
      stats[step.tool].count++;
      if (step.status === "error" || step.status === "failed") {
        stats[step.tool].errors++;
      }
    }
  }

  const toolUsage = {};
  for (const [tool, s] of Object.entries(stats)) {
    toolUsage[tool] = {
      count: s.count,
      errorRate: s.count > 0 ? s.errors / s.count : 0,
    };
  }

  return { toolUsage, totalTools };
}

/**
 * Compute score trend from trajectories (sorted by time).
 * Returns "improving", "declining", or "stable".
 * @param {Array<{outcomeScore:number|null}>} trajectories — ordered oldest→newest
 * @returns {{trend:"improving"|"declining"|"stable", avgScore:number, recentAvg:number}}
 */
export function computeScoreTrend(trajectories) {
  const scored = trajectories.filter((t) => t.outcomeScore != null);
  if (scored.length < 2) {
    const avg = scored.length === 1 ? scored[0].outcomeScore : 0;
    return { trend: "stable", avgScore: avg, recentAvg: avg };
  }

  const allAvg =
    scored.reduce((sum, t) => sum + t.outcomeScore, 0) / scored.length;

  // Split into halves
  const mid = Math.floor(scored.length / 2);
  const firstHalf = scored.slice(0, mid);
  const secondHalf = scored.slice(mid);

  const firstAvg =
    firstHalf.reduce((sum, t) => sum + t.outcomeScore, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((sum, t) => sum + t.outcomeScore, 0) / secondHalf.length;

  const delta = secondAvg - firstAvg;
  let trend = "stable";
  if (delta > 0.05) trend = "improving";
  else if (delta < -0.05) trend = "declining";

  return { trend, avgScore: allAvg, recentAvg: secondAvg };
}

/**
 * Identify error-prone tool patterns (tools with error rate > threshold).
 * @param {Record<string, {count:number, errorRate:number}>} toolUsage
 * @param {number} [threshold=0.3]
 * @returns {Array<{tool:string, errorRate:number, count:number}>}
 */
export function findErrorProneTools(toolUsage, threshold = 0.3) {
  return Object.entries(toolUsage)
    .filter(([, stats]) => stats.errorRate > threshold && stats.count >= 2)
    .map(([tool, stats]) => ({
      tool,
      errorRate: stats.errorRate,
      count: stats.count,
    }))
    .sort((a, b) => b.errorRate - a.errorRate);
}

/**
 * Build LLM prompt for reflection analysis.
 * @param {object} reportData — pre-computed stats
 * @returns {Array<{role:string, content:string}>}
 */
export function buildReflectionPrompt(reportData) {
  return [
    {
      role: "system",
      content: `You are a self-improvement analyst for an AI coding assistant.
Analyze execution statistics and provide actionable recommendations.
Output ONLY valid JSON:
{
  "summary": "2-3 sentence overview",
  "strengths": ["strength 1", ...],
  "weaknesses": ["weakness 1", ...],
  "recommendations": [
    {"action": "what to do", "priority": "high|medium|low", "reason": "why"}
  ]
}`,
    },
    {
      role: "user",
      content: `## Reflection Period Stats
Total trajectories: ${reportData.totalTrajectories}
Scored trajectories: ${reportData.scoredCount}
Average score: ${reportData.avgScore?.toFixed(2) || "N/A"}
Score trend: ${reportData.trend || "unknown"}
Recent average: ${reportData.recentAvg?.toFixed(2) || "N/A"}

## Tool Usage (top 10)
${reportData.topTools?.map((t) => `- ${t.tool}: ${t.count}x (error rate: ${(t.errorRate * 100).toFixed(0)}%)`).join("\n") || "No data"}

## Error-prone Tools
${reportData.errorProneTools?.map((t) => `- ${t.tool}: ${(t.errorRate * 100).toFixed(0)}% error rate (${t.count} calls)`).join("\n") || "None"}

## Synthesized Skills
${reportData.synthesizedCount || 0} skills auto-generated`,
    },
  ];
}

// ── ReflectionEngine class ─────────────────────────

export class ReflectionEngine {
  /**
   * @param {import("better-sqlite3").Database} db
   * @param {function|null} llmChat — async (messages) => string
   * @param {import("./trajectory-store.js").TrajectoryStore} trajectoryStore
   * @param {{reflectionInterval?:number}} [config]
   */
  constructor(db, llmChat, trajectoryStore, config = {}) {
    this.db = db;
    this.llmChat = llmChat;
    this.trajectoryStore = trajectoryStore;
    this.reflectionInterval = config.reflectionInterval || 24 * 60 * 60 * 1000; // 24h default
  }

  /**
   * Run a reflection cycle: gather stats, analyze, produce report.
   * @param {{since?:string, limit?:number}} [options]
   * @returns {Promise<object>} reflection report
   */
  async reflect(options = {}) {
    const limit = options.limit || 200;

    // Gather trajectories
    const trajectories = this.trajectoryStore.getRecent({ limit });
    if (trajectories.length === 0) {
      return this._emptyReport("No trajectories to reflect on");
    }

    // Compute stats
    const { toolUsage, totalTools } = computeToolStats(trajectories);
    const scoreTrend = computeScoreTrend(trajectories);
    const errorProneTools = findErrorProneTools(toolUsage);

    // Top tools by usage
    const topTools = Object.entries(toolUsage)
      .map(([tool, stats]) => ({ tool, ...stats }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const dbStats = this.trajectoryStore.getStats();

    const reportData = {
      totalTrajectories: trajectories.length,
      scoredCount: trajectories.filter((t) => t.outcomeScore != null).length,
      avgScore: scoreTrend.avgScore,
      recentAvg: scoreTrend.recentAvg,
      trend: scoreTrend.trend,
      topTools,
      errorProneTools,
      totalToolCalls: totalTools,
      synthesizedCount: dbStats.synthesized,
    };

    // LLM analysis (optional)
    let llmAnalysis = null;
    if (this.llmChat) {
      llmAnalysis = await this._getLLMAnalysis(reportData);
    }

    const report = {
      timestamp: new Date(_deps.now()).toISOString(),
      ...reportData,
      llmAnalysis,
    };

    // Persist report
    this._saveReport(report);

    return report;
  }

  /**
   * Get the most recent reflection report.
   * @returns {object|null}
   */
  getLatestReport() {
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM skill_improvement_log
           WHERE trigger_type = 'reflection'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get();

      if (!row) return null;
      try {
        return JSON.parse(row.detail);
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Check if a reflection is due based on interval.
   * @returns {boolean}
   */
  isReflectionDue() {
    const latest = this.getLatestReport();
    if (!latest || !latest.timestamp) return true;

    const lastTime = new Date(latest.timestamp).getTime();
    return _deps.now() - lastTime >= this.reflectionInterval;
  }

  // ── Internal ────────────────────────────────────

  /**
   * Get LLM analysis of the report data.
   * @param {object} reportData
   * @returns {Promise<object|null>}
   */
  async _getLLMAnalysis(reportData) {
    try {
      const messages = buildReflectionPrompt(reportData);
      const response = await this.llmChat(messages);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  /**
   * Save report to skill_improvement_log.
   * @param {object} report
   */
  _saveReport(report) {
    try {
      this.db
        .prepare(
          `INSERT INTO skill_improvement_log (skill_name, trigger_type, detail)
           VALUES (?, ?, ?)`,
        )
        .run(
          "_reflection",
          "reflection",
          JSON.stringify(report).slice(0, 5000),
        );
    } catch {
      // Non-critical
    }
  }

  /**
   * Build an empty report for edge cases.
   * @param {string} reason
   * @returns {object}
   */
  _emptyReport(reason) {
    return {
      timestamp: new Date(_deps.now()).toISOString(),
      totalTrajectories: 0,
      scoredCount: 0,
      avgScore: 0,
      recentAvg: 0,
      trend: "stable",
      topTools: [],
      errorProneTools: [],
      totalToolCalls: 0,
      synthesizedCount: 0,
      llmAnalysis: null,
      note: reason,
    };
  }
}

export { _deps };
