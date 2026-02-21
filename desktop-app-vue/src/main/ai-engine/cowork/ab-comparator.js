/**
 * A/B Comparator — v2.1.0
 *
 * Generates N variants of a solution via different agents, benchmarks
 * each with verification-loop patterns, and ranks the results.
 * Records outcomes to DecisionKnowledgeBase for future reference.
 *
 * @module ai-engine/cowork/ab-comparator
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const DEFAULT_VARIANT_COUNT = 3;
const MAX_VARIANTS = 5;

const AGENT_PROFILES = [
  {
    name: "concise-agent",
    style:
      "Write the most concise, minimal solution possible. Prefer one-liners and built-in methods.",
  },
  {
    name: "robust-agent",
    style:
      "Write the most robust, defensive solution with comprehensive error handling and edge cases.",
  },
  {
    name: "readable-agent",
    style:
      "Write the most readable, self-documenting solution. Prioritize clarity over brevity.",
  },
  {
    name: "performant-agent",
    style:
      "Write the most performance-optimized solution. Minimize allocations and complexity.",
  },
  {
    name: "testable-agent",
    style:
      "Write the most testable solution with clear interfaces, dependency injection, and pure functions.",
  },
];

// ============================================================
// ABComparator
// ============================================================

class ABComparator {
  constructor() {
    this.db = null;
    this.agentCoordinator = null;
    this.decisionKB = null;
    this.initialized = false;
  }

  /**
   * Initialize with dependencies
   * @param {Object} db - Database manager
   * @param {Object} agentCoordinator - AgentCoordinator instance (optional)
   * @param {Object} decisionKB - DecisionKnowledgeBase instance (optional)
   */
  async initialize(db, agentCoordinator = null, decisionKB = null) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.agentCoordinator = agentCoordinator;
    this.decisionKB = decisionKB;

    this._ensureTables();
    this.initialized = true;
    logger.info("[ABComparator] Initialized");
  }

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ab_comparisons (
          id TEXT PRIMARY KEY,
          task_description TEXT NOT NULL,
          variants TEXT DEFAULT '[]',
          winner TEXT,
          scores TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ab_task ON ab_comparisons(task_description);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ABComparator] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Main API
  // ============================================================

  /**
   * Run an A/B comparison
   * @param {Object} data - { taskDescription, variantCount, benchmark, context }
   *   taskDescription: what to implement
   *   variantCount: number of variants (default 3, max 5)
   *   benchmark: whether to run verification-style benchmarks
   *   context: additional context (language, framework, etc.)
   * @returns {Object} Comparison result with variants, scores, and winner
   */
  async compare(data) {
    const id = uuidv4();
    const startTime = Date.now();
    const taskDescription = data.taskDescription;
    const variantCount = Math.min(
      data.variantCount || DEFAULT_VARIANT_COUNT,
      MAX_VARIANTS,
    );
    const shouldBenchmark = data.benchmark !== false;

    if (!taskDescription) {
      return { id, error: "taskDescription is required" };
    }

    logger.info(
      `[ABComparator] Starting comparison ${id}: "${taskDescription}" (${variantCount} variants)`,
    );

    // Generate variants
    const profiles = AGENT_PROFILES.slice(0, variantCount);
    const variants = [];

    for (const profile of profiles) {
      const variant = await this._generateVariant(
        profile,
        taskDescription,
        data.context,
      );
      variants.push(variant);
    }

    // Benchmark variants
    const scores = {};
    if (shouldBenchmark) {
      for (const variant of variants) {
        scores[variant.name] = this._benchmarkVariant(variant);
      }
    }

    // Determine winner
    let winner = null;
    let bestScore = -1;
    for (const [name, score] of Object.entries(scores)) {
      if (score.total > bestScore) {
        bestScore = score.total;
        winner = name;
      }
    }

    // If no benchmarking, winner is based on code length heuristic
    if (!shouldBenchmark && variants.length > 0) {
      winner = variants[0].name;
    }

    const duration = Date.now() - startTime;

    const result = {
      id,
      taskDescription,
      variants,
      winner,
      scores,
      duration,
      createdAt: new Date().toISOString(),
    };

    // Save to database
    this._saveComparison(result);

    // Record to DecisionKnowledgeBase
    if (this.decisionKB) {
      try {
        this.decisionKB.recordDecision({
          problem: `A/B comparison: ${taskDescription}`,
          problemCategory: "implementation",
          solutions: variants.map((v) => v.name),
          chosenSolution: winner,
          outcome: "compared",
          context: {
            scores,
            variantCount,
            duration,
          },
          agents: variants.map((v) => v.name),
          source: "voting",
          successRate: bestScore > 0 ? bestScore / 100 : 0,
        });
      } catch (e) {
        logger.warn("[ABComparator] DecisionKB record error:", e.message);
      }
    }

    logger.info(
      `[ABComparator] Comparison ${id} complete: winner=${winner} (${duration}ms)`,
    );

    return result;
  }

  /**
   * Get comparison history
   * @param {Object} filters - { limit, offset }
   * @returns {Array} Past comparisons
   */
  getComparisonHistory(filters = {}) {
    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM ab_comparisons ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(limit, offset);
      return rows.map(this._rowToComparison);
    } catch (e) {
      logger.error("[ABComparator] getHistory error:", e.message);
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
        .prepare("SELECT COUNT(*) as count FROM ab_comparisons")
        .get().count;
      const withWinner = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM ab_comparisons WHERE winner IS NOT NULL",
        )
        .get().count;

      // Count wins per agent profile
      const winCounts = {};
      const rows = this.db
        .prepare("SELECT winner FROM ab_comparisons WHERE winner IS NOT NULL")
        .all();
      for (const row of rows) {
        winCounts[row.winner] = (winCounts[row.winner] || 0) + 1;
      }

      return {
        totalComparisons: total,
        withWinner,
        winsByAgent: winCounts,
      };
    } catch (e) {
      logger.error("[ABComparator] stats error:", e.message);
      return { totalComparisons: 0, withWinner: 0, winsByAgent: {} };
    }
  }

  // ============================================================
  // Variant Generation
  // ============================================================

  async _generateVariant(profile, taskDescription, context) {
    const contextStr = context
      ? `\nContext: ${typeof context === "string" ? context : JSON.stringify(context)}`
      : "";

    const prompt = `${profile.style}\n\nTask: ${taskDescription}${contextStr}\n\nProvide your implementation as a code block.`;

    // If AgentCoordinator is available, use it
    if (this.agentCoordinator) {
      try {
        const result = await this.agentCoordinator.assignTask({
          agentType: "code-generation",
          description: prompt,
        });
        if (result?.output) {
          return {
            name: profile.name,
            style: profile.style,
            code: this._extractCode(result.output),
            rawOutput: result.output,
          };
        }
      } catch (e) {
        logger.warn(
          `[ABComparator] Agent generation error (${profile.name}):`,
          e.message,
        );
      }
    }

    // Fallback: generate a placeholder variant
    return {
      name: profile.name,
      style: profile.style,
      code: `// Variant: ${profile.name}\n// Task: ${taskDescription}\n// Style: ${profile.style}\n// (Agent not available — placeholder)`,
      rawOutput: null,
    };
  }

  // ============================================================
  // Benchmarking
  // ============================================================

  _benchmarkVariant(variant) {
    const code = variant.code || "";
    const lines = code.split("\n").filter((l) => l.trim().length > 0);

    // Scoring criteria (0-100 each, weighted)
    const scores = {
      conciseness: Math.max(0, 100 - lines.length * 2), // fewer lines = higher
      errorHandling: this._scoreErrorHandling(code),
      readability: this._scoreReadability(code),
      total: 0,
    };

    scores.total = Math.round(
      scores.conciseness * 0.3 +
        scores.errorHandling * 0.35 +
        scores.readability * 0.35,
    );

    return scores;
  }

  _scoreErrorHandling(code) {
    let score = 50; // baseline
    if (/try\s*\{/.test(code)) {
      score += 15;
    }
    if (/catch\s*\(/.test(code)) {
      score += 15;
    }
    if (/throw\s+new\s+Error/.test(code)) {
      score += 10;
    }
    if (/if\s*\(!/.test(code)) {
      score += 10;
    } // null checks
    return Math.min(100, score);
  }

  _scoreReadability(code) {
    let score = 60;
    const lines = code.split("\n");

    // Shorter lines are more readable
    const avgLineLen =
      lines.reduce((sum, l) => sum + l.length, 0) / Math.max(lines.length, 1);
    if (avgLineLen < 80) {
      score += 15;
    } else if (avgLineLen > 120) {
      score -= 15;
    }

    // Comments are good
    const commentLines = lines.filter(
      (l) => l.trim().startsWith("//") || l.trim().startsWith("*"),
    );
    if (commentLines.length > 0) {
      score += 10;
    }

    // Named functions/variables (good naming heuristic)
    const descriptiveNames = code.match(/[a-z][a-zA-Z]{7,}/g) || [];
    if (descriptiveNames.length > 2) {
      score += 15;
    }

    return Math.min(100, Math.max(0, score));
  }

  _extractCode(output) {
    if (!output) {
      return "";
    }

    // Extract from markdown code block
    const codeBlockMatch = output.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    return output;
  }

  // ============================================================
  // Persistence
  // ============================================================

  _saveComparison(result) {
    try {
      this.db.run(
        `INSERT INTO ab_comparisons (id, task_description, variants, winner, scores, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          result.id,
          result.taskDescription,
          JSON.stringify(result.variants),
          result.winner,
          JSON.stringify(result.scores),
          result.createdAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ABComparator] Save error:", e.message);
    }
  }

  _rowToComparison(row) {
    return {
      id: row.id,
      taskDescription: row.task_description,
      variants: safeParseJSON(row.variants),
      winner: row.winner,
      scores: safeParseJSON(row.scores),
      createdAt: row.created_at,
    };
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str) {
  if (!str) {
    return {};
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// Singleton
let instance = null;

function getABComparator() {
  if (!instance) {
    instance = new ABComparator();
  }
  return instance;
}

module.exports = {
  ABComparator,
  getABComparator,
};
