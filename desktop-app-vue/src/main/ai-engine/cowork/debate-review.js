/**
 * Debate Review — v2.1.0
 *
 * Multi-agent debate code review system. Spawns 3 reviewer agents
 * (performance, security, maintainability), runs structured reviews,
 * collects votes, and produces a consensus verdict.
 *
 * Uses TeammateTool for agent coordination and records decisions
 * to DecisionKnowledgeBase.
 *
 * @module ai-engine/cowork/debate-review
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

// ============================================================
// Constants
// ============================================================

const DEFAULT_PERSPECTIVES = ["performance", "security", "maintainability"];

const VERDICT_THRESHOLDS = {
  APPROVE: 0.7,
  NEEDS_WORK: 0.4,
};

const REVIEWER_PROMPTS = {
  performance: `You are a performance-focused code reviewer. Analyze the code for:
- Time complexity and algorithmic efficiency
- Memory usage and potential leaks
- I/O bottlenecks and unnecessary operations
- Caching opportunities
- Database query efficiency
Rate each issue as: critical, warning, or info. Conclude with APPROVE, NEEDS_WORK, or REJECT.`,

  security: `You are a security-focused code reviewer. Analyze the code for:
- Input validation and sanitization
- Authentication/authorization issues
- Injection vulnerabilities (SQL, XSS, command)
- Sensitive data exposure
- OWASP Top 10 compliance
Rate each issue as: critical, warning, or info. Conclude with APPROVE, NEEDS_WORK, or REJECT.`,

  maintainability: `You are a maintainability-focused code reviewer. Analyze the code for:
- Code readability and naming conventions
- DRY violations and code duplication
- Single responsibility principle adherence
- Error handling completeness
- Test coverage implications
Rate each issue as: critical, warning, or info. Conclude with APPROVE, NEEDS_WORK, or REJECT.`,
};

// ============================================================
// DebateReview
// ============================================================

class DebateReview {
  constructor() {
    this.db = null;
    this.teammateTool = null;
    this.decisionKB = null;
    this.initialized = false;
  }

  /**
   * Initialize with dependencies
   * @param {Object} db - Database manager
   * @param {Object} teammateTool - TeammateTool instance (optional)
   * @param {Object} decisionKB - DecisionKnowledgeBase instance (optional)
   */
  async initialize(db, teammateTool = null, decisionKB = null) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.teammateTool = teammateTool;
    this.decisionKB = decisionKB;

    this._ensureTables();
    this.initialized = true;
    logger.info("[DebateReview] Initialized");
  }

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS debate_reviews (
          id TEXT PRIMARY KEY,
          target TEXT NOT NULL,
          reviews TEXT DEFAULT '[]',
          votes TEXT DEFAULT '[]',
          verdict TEXT,
          consensus_score REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_debate_target ON debate_reviews(target);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[DebateReview] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Main API
  // ============================================================

  /**
   * Start a multi-agent debate review
   * @param {Object} data - { target, code, perspectives, context }
   *   target: file path or description
   *   code: code content (or will read from target path)
   *   perspectives: array of reviewer types (default: performance, security, maintainability)
   *   context: additional context for reviewers
   * @returns {Object} Debate result with reviews, votes, and verdict
   */
  async startDebate(data) {
    const id = uuidv4();
    const startTime = Date.now();
    const perspectives = data.perspectives || DEFAULT_PERSPECTIVES;
    const target = data.target || "unknown";

    logger.info(
      `[DebateReview] Starting debate ${id} on "${target}" with perspectives: ${perspectives.join(", ")}`,
    );

    // Resolve code content
    let code = data.code || "";
    if (!code && target && fs.existsSync(target)) {
      try {
        code = fs.readFileSync(target, "utf-8");
      } catch (e) {
        logger.warn(`[DebateReview] Could not read ${target}: ${e.message}`);
      }
    }

    if (!code) {
      return {
        id,
        target,
        error: "No code content provided or readable",
        verdict: "ERROR",
      };
    }

    // Truncate very large files
    const maxCodeLen = 10000;
    const truncatedCode =
      code.length > maxCodeLen
        ? code.substring(0, maxCodeLen) + "\n\n... (truncated)"
        : code;

    // Run reviews (sequentially if no TeammateTool, parallel otherwise)
    const reviews = [];

    for (const perspective of perspectives) {
      const review = await this._runReview(
        perspective,
        truncatedCode,
        target,
        data.context,
      );
      reviews.push(review);
    }

    // Collect votes
    const votes = reviews.map((r) => ({
      perspective: r.perspective,
      vote: r.vote,
      issues: r.issues || [],
    }));

    // Calculate consensus
    const { verdict, consensusScore } = this._calculateConsensus(votes);

    const duration = Date.now() - startTime;

    // Save to database
    const result = {
      id,
      target,
      reviews,
      votes,
      verdict,
      consensusScore,
      duration,
      createdAt: new Date().toISOString(),
    };

    this._saveDebate(result);

    // Record to DecisionKnowledgeBase
    if (this.decisionKB) {
      try {
        this.decisionKB.recordDecision({
          problem: `Code review: ${target}`,
          problemCategory: "code-review",
          solutions: perspectives,
          chosenSolution: verdict,
          outcome: verdict,
          context: {
            consensusScore,
            issueCount: votes.reduce(
              (sum, v) => sum + (v.issues?.length || 0),
              0,
            ),
          },
          agents: perspectives,
          source: "voting",
          successRate:
            verdict === "APPROVE" ? 1.0 : verdict === "NEEDS_WORK" ? 0.5 : 0.0,
        });
      } catch (e) {
        logger.warn("[DebateReview] DecisionKB record error:", e.message);
      }
    }

    logger.info(
      `[DebateReview] Debate ${id} complete: ${verdict} (consensus: ${consensusScore.toFixed(2)}, ${duration}ms)`,
    );

    return result;
  }

  /**
   * Get debate history
   * @param {Object} filters - { limit, offset }
   * @returns {Array} Past debates
   */
  getDebateHistory(filters = {}) {
    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM debate_reviews ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(limit, offset);
      return rows.map(this._rowToDebate);
    } catch (e) {
      logger.error("[DebateReview] getHistory error:", e.message);
      return [];
    }
  }

  /**
   * Get statistics
   * @returns {Object} Stats
   */
  getStats() {
    try {
      const total = this.db
        .prepare("SELECT COUNT(*) as count FROM debate_reviews")
        .get().count;
      const byVerdict = this.db
        .prepare(
          "SELECT verdict, COUNT(*) as count FROM debate_reviews GROUP BY verdict",
        )
        .all();
      const avgConsensus = this.db
        .prepare("SELECT AVG(consensus_score) as avg FROM debate_reviews")
        .get();

      return {
        totalDebates: total,
        byVerdict: byVerdict.reduce((acc, r) => {
          acc[r.verdict] = r.count;
          return acc;
        }, {}),
        avgConsensusScore: avgConsensus?.avg
          ? parseFloat(avgConsensus.avg.toFixed(3))
          : 0,
      };
    } catch (e) {
      logger.error("[DebateReview] stats error:", e.message);
      return { totalDebates: 0, byVerdict: {}, avgConsensusScore: 0 };
    }
  }

  // ============================================================
  // Internal: Review Execution
  // ============================================================

  async _runReview(perspective, code, target, extraContext) {
    const prompt =
      REVIEWER_PROMPTS[perspective] || REVIEWER_PROMPTS.maintainability;
    const contextStr = extraContext
      ? `\nAdditional context: ${extraContext}`
      : "";

    const fullPrompt = `${prompt}\n\n## Code to Review\nFile: ${target}\n\`\`\`\n${code}\n\`\`\`${contextStr}\n\nProvide your review as structured JSON: { "perspective": "${perspective}", "vote": "APPROVE|NEEDS_WORK|REJECT", "issues": [{"severity": "critical|warning|info", "line": null, "description": "..."}], "summary": "..." }`;

    // If TeammateTool is available, spawn an agent
    if (
      this.teammateTool &&
      typeof this.teammateTool.spawnTeam === "function"
    ) {
      try {
        const team = await this.teammateTool.spawnTeam({
          agents: [
            {
              name: `reviewer-${perspective}`,
              role: "code-review",
              prompt: fullPrompt,
            },
          ],
        });

        if (team?.results?.[0]) {
          const parsed = this._parseReviewResult(team.results[0], perspective);
          return parsed;
        }
      } catch (e) {
        logger.warn(
          `[DebateReview] TeammateTool review error (${perspective}):`,
          e.message,
        );
      }
    }

    // Fallback: simulate a review based on code analysis
    return this._simulateReview(perspective, code, target);
  }

  _simulateReview(perspective, code, target) {
    const issues = [];
    const lines = code.split("\n");

    if (perspective === "performance") {
      // Check for common performance issues
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("forEach") && lines[i].includes("await")) {
          issues.push({
            severity: "warning",
            line: i + 1,
            description:
              "Await inside forEach — use Promise.all or for...of loop",
          });
        }
        if (/\.filter\(.*\)\.map\(/.test(lines[i])) {
          issues.push({
            severity: "info",
            line: i + 1,
            description: "Chained filter+map — consider combining into reduce",
          });
        }
      }
    } else if (perspective === "security") {
      for (let i = 0; i < lines.length; i++) {
        if (/eval\s*\(/.test(lines[i])) {
          issues.push({
            severity: "critical",
            line: i + 1,
            description:
              "Dynamic code evaluation — potential code injection vulnerability",
          });
        }
        if (/innerHTML\s*=/.test(lines[i])) {
          issues.push({
            severity: "warning",
            line: i + 1,
            description: "Direct innerHTML assignment — potential XSS risk",
          });
        }
      }
    } else {
      // maintainability
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 120) {
          issues.push({
            severity: "info",
            line: i + 1,
            description: "Line exceeds 120 characters — consider breaking up",
          });
        }
      }
      if (lines.length > 300) {
        issues.push({
          severity: "warning",
          line: null,
          description: `File has ${lines.length} lines — consider splitting into smaller modules`,
        });
      }
    }

    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarning = issues.some((i) => i.severity === "warning");
    const vote = hasCritical ? "REJECT" : hasWarning ? "NEEDS_WORK" : "APPROVE";

    return {
      perspective,
      vote,
      issues,
      summary: `${perspective} review: ${issues.length} issue(s) found. Verdict: ${vote}`,
    };
  }

  _parseReviewResult(result, perspective) {
    if (typeof result === "object" && result.vote) {
      return {
        perspective: result.perspective || perspective,
        vote: result.vote,
        issues: result.issues || [],
        summary: result.summary || "",
      };
    }

    // Try parsing as JSON from string
    if (typeof result === "string") {
      try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            perspective: parsed.perspective || perspective,
            vote: parsed.vote || "NEEDS_WORK",
            issues: parsed.issues || [],
            summary: parsed.summary || result.substring(0, 200),
          };
        }
      } catch {
        // fall through
      }
    }

    return {
      perspective,
      vote: "NEEDS_WORK",
      issues: [],
      summary: String(result).substring(0, 500),
    };
  }

  // ============================================================
  // Consensus Calculation
  // ============================================================

  _calculateConsensus(votes) {
    if (!votes || votes.length === 0) {
      return { verdict: "NO_REVIEWS", consensusScore: 0 };
    }

    const voteValues = { APPROVE: 1.0, NEEDS_WORK: 0.5, REJECT: 0.0 };
    let totalScore = 0;

    for (const vote of votes) {
      totalScore += voteValues[vote.vote] ?? 0.5;
    }

    const avgScore = totalScore / votes.length;

    let verdict;
    if (avgScore >= VERDICT_THRESHOLDS.APPROVE) {
      verdict = "APPROVE";
    } else if (avgScore >= VERDICT_THRESHOLDS.NEEDS_WORK) {
      verdict = "NEEDS_WORK";
    } else {
      verdict = "REJECT";
    }

    // Consensus score: how much reviewers agree (1.0 = unanimous)
    const voteSet = new Set(votes.map((v) => v.vote));
    const consensusScore =
      voteSet.size === 1 ? 1.0 : 1.0 - (voteSet.size - 1) * 0.3;

    return { verdict, consensusScore: Math.max(0, consensusScore) };
  }

  // ============================================================
  // Persistence
  // ============================================================

  _saveDebate(result) {
    try {
      this.db.run(
        `INSERT INTO debate_reviews (id, target, reviews, votes, verdict, consensus_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          result.id,
          result.target,
          JSON.stringify(result.reviews),
          JSON.stringify(result.votes),
          result.verdict,
          result.consensusScore,
          result.createdAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[DebateReview] Save error:", e.message);
    }
  }

  _rowToDebate(row) {
    return {
      id: row.id,
      target: row.target,
      reviews: safeParseJSON(row.reviews),
      votes: safeParseJSON(row.votes),
      verdict: row.verdict,
      consensusScore: row.consensus_score,
      createdAt: row.created_at,
    };
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str) {
  if (!str) {
    return [];
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return [];
  }
}

// Singleton
let instance = null;

function getDebateReview() {
  if (!instance) {
    instance = new DebateReview();
  }
  return instance;
}

module.exports = {
  DebateReview,
  getDebateReview,
  DEFAULT_PERSPECTIVES,
};
