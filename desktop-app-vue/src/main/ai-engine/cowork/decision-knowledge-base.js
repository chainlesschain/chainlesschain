/**
 * Decision Knowledge Base — v2.1.0
 *
 * Accumulates historical decision records from voting, orchestrate
 * outcomes, instinct evolution, and manual entries.  Enables
 * similarity search to inform future decisions.
 *
 * Integrates with HookSystem to auto-record PostToolUse events
 * for voteOnDecision and orchestrate results.
 *
 * @module ai-engine/cowork/decision-knowledge-base
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const DECISION_SOURCES = {
  MANUAL: "manual",
  VOTING: "voting",
  ORCHESTRATE: "orchestrate",
  INSTINCT: "instinct",
};

const PROBLEM_CATEGORIES = [
  "architecture",
  "implementation",
  "testing",
  "performance",
  "security",
  "refactoring",
  "tooling",
  "deployment",
  "general",
];

// ============================================================
// DecisionKnowledgeBase
// ============================================================

class DecisionKnowledgeBase {
  constructor() {
    this.db = null;
    this.hookSystem = null;
    this.initialized = false;
    this._hookHandles = [];
  }

  /**
   * Initialize with database and optional hook system
   * @param {Object} db - Database manager
   * @param {Object} hookSystem - HookSystem (optional)
   */
  async initialize(db, hookSystem = null) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.hookSystem = hookSystem;

    this._ensureTables();

    if (this.hookSystem) {
      this._registerHooks();
    }

    this.initialized = true;
    const count = this._getCount();
    logger.info(`[DecisionKB] Initialized with ${count} decision records`);
  }

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS decision_records (
          id TEXT PRIMARY KEY,
          problem TEXT NOT NULL,
          problem_category TEXT,
          solutions TEXT DEFAULT '[]',
          chosen_solution TEXT,
          outcome TEXT,
          context TEXT DEFAULT '{}',
          agents TEXT DEFAULT '[]',
          source TEXT DEFAULT 'manual',
          success_rate REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_decisions_category ON decision_records(problem_category);
        CREATE INDEX IF NOT EXISTS idx_decisions_source ON decision_records(source);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[DecisionKB] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Record Operations
  // ============================================================

  /**
   * Record a decision manually
   * @param {Object} data - { problem, problemCategory, solutions, chosenSolution, outcome, context, agents }
   * @returns {Object} Created record
   */
  recordDecision(data) {
    if (!data.problem) {
      throw new Error("Problem description is required");
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const record = {
      id,
      problem: data.problem,
      problemCategory: data.problemCategory || "general",
      solutions: data.solutions || [],
      chosenSolution: data.chosenSolution || null,
      outcome: data.outcome || null,
      context: data.context || {},
      agents: data.agents || [],
      source: data.source || DECISION_SOURCES.MANUAL,
      successRate: data.successRate || 0,
      createdAt: now,
    };

    try {
      this.db.run(
        `INSERT INTO decision_records (id, problem, problem_category, solutions, chosen_solution, outcome, context, agents, source, success_rate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          record.problem,
          record.problemCategory,
          JSON.stringify(record.solutions),
          record.chosenSolution,
          record.outcome,
          JSON.stringify(record.context),
          JSON.stringify(record.agents),
          record.source,
          record.successRate,
          now,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.info(
        `[DecisionKB] Recorded decision: ${id} (${record.source}/${record.problemCategory})`,
      );
      return record;
    } catch (e) {
      logger.error("[DecisionKB] Record error:", e.message);
      throw e;
    }
  }

  /**
   * Record a voting result from TeammateTool.voteOnDecision
   * @param {Object} votingData - { question, options, votes, winner }
   * @returns {Object} Created record
   */
  recordVotingResult(votingData) {
    return this.recordDecision({
      problem: votingData.question || votingData.problem || "Voting decision",
      problemCategory: votingData.category || "general",
      solutions: votingData.options || [],
      chosenSolution: votingData.winner || null,
      outcome: votingData.outcome || "decided",
      context: { votes: votingData.votes || {} },
      agents: votingData.agents || [],
      source: DECISION_SOURCES.VOTING,
      successRate: votingData.consensusScore || 0,
    });
  }

  /**
   * Record a workflow/orchestrate verdict
   * @param {Object} workflowData - { template, description, verdict, steps, duration }
   * @returns {Object} Created record
   */
  recordWorkflowVerdict(workflowData) {
    const isSuccess =
      workflowData.verdict === "SHIP" || workflowData.verdict === "success";
    return this.recordDecision({
      problem: workflowData.description || "Workflow execution",
      problemCategory: workflowData.template || "general",
      solutions: [workflowData.template],
      chosenSolution: workflowData.template,
      outcome: workflowData.verdict || "unknown",
      context: {
        steps: workflowData.steps || [],
        duration: workflowData.duration || 0,
      },
      agents: (workflowData.steps || []).map((s) => s.agent || s.role),
      source: DECISION_SOURCES.ORCHESTRATE,
      successRate: isSuccess ? 1.0 : 0.0,
    });
  }

  // ============================================================
  // Retrieval
  // ============================================================

  /**
   * Find similar past decisions using keyword matching
   * @param {string} problem - Current problem description
   * @param {number} limit - Max results
   * @returns {Array} Similar decisions sorted by relevance
   */
  findSimilarDecisions(problem, limit = 5) {
    if (!problem) {
      return [];
    }

    const words = problem
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    try {
      const allRecords = this.db
        .prepare(
          "SELECT * FROM decision_records ORDER BY created_at DESC LIMIT 500",
        )
        .all();

      const scored = [];
      for (const row of allRecords) {
        const record = this._rowToRecord(row);
        const text =
          `${record.problem} ${record.problemCategory} ${record.chosenSolution || ""} ${record.outcome || ""}`.toLowerCase();

        let score = 0;
        for (const word of words) {
          if (text.includes(word)) {
            score += 1;
          }
        }

        // Boost successful decisions
        if (record.successRate > 0.5) {
          score *= 1.2;
        }

        if (score > 0) {
          scored.push({ record, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.record);
    } catch (e) {
      logger.error("[DecisionKB] findSimilar error:", e.message);
      return [];
    }
  }

  /**
   * Get decision history with filters
   * @param {Object} filters - { category, source, limit, offset }
   * @returns {Array} Decision records
   */
  getDecisionHistory(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.category) {
      conditions.push("problem_category = ?");
      params.push(filters.category);
    }
    if (filters.source) {
      conditions.push("source = ?");
      params.push(filters.source);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM decision_records ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return rows.map(this._rowToRecord);
    } catch (e) {
      logger.error("[DecisionKB] getHistory error:", e.message);
      return [];
    }
  }

  /**
   * Get the best practice for a problem category
   * @param {string} category - Problem category
   * @returns {Object|null} Best decision record by success rate
   */
  getBestPractice(category) {
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM decision_records WHERE problem_category = ? AND success_rate > 0
           ORDER BY success_rate DESC, created_at DESC LIMIT 1`,
        )
        .get(category);
      return row ? this._rowToRecord(row) : null;
    } catch (e) {
      logger.error("[DecisionKB] getBestPractice error:", e.message);
      return null;
    }
  }

  /**
   * Get success rates aggregated by category
   * @returns {Object} { category: { count, avgSuccessRate } }
   */
  getSuccessRateByCategory() {
    try {
      const rows = this.db
        .prepare(
          `SELECT problem_category, COUNT(*) as count, AVG(success_rate) as avg_rate
           FROM decision_records GROUP BY problem_category`,
        )
        .all();

      const result = {};
      for (const row of rows) {
        result[row.problem_category] = {
          count: row.count,
          avgSuccessRate: parseFloat((row.avg_rate || 0).toFixed(3)),
        };
      }
      return result;
    } catch (e) {
      logger.error("[DecisionKB] getSuccessRate error:", e.message);
      return {};
    }
  }

  /**
   * Get statistics
   * @returns {Object} Stats
   */
  getStats() {
    try {
      const total = this._getCount();
      const bySource = this.db
        .prepare(
          "SELECT source, COUNT(*) as count FROM decision_records GROUP BY source",
        )
        .all();
      const byCategory = this.db
        .prepare(
          "SELECT problem_category, COUNT(*) as count FROM decision_records GROUP BY problem_category",
        )
        .all();
      const avgSuccess = this.db
        .prepare(
          "SELECT AVG(success_rate) as avg FROM decision_records WHERE success_rate > 0",
        )
        .get();

      return {
        totalDecisions: total,
        bySource: bySource.reduce((acc, r) => {
          acc[r.source] = r.count;
          return acc;
        }, {}),
        byCategory: byCategory.reduce((acc, r) => {
          acc[r.problem_category] = r.count;
          return acc;
        }, {}),
        avgSuccessRate: avgSuccess?.avg
          ? parseFloat(avgSuccess.avg.toFixed(3))
          : 0,
      };
    } catch (e) {
      logger.error("[DecisionKB] stats error:", e.message);
      return {
        totalDecisions: 0,
        bySource: {},
        byCategory: {},
        avgSuccessRate: 0,
      };
    }
  }

  // ============================================================
  // Hook integration
  // ============================================================

  _registerHooks() {
    if (!this.hookSystem || !this.hookSystem.registry) {
      return;
    }
    const registry = this.hookSystem.registry;

    // Observe PostToolUse for voting and orchestrate events
    try {
      registry.register({
        event: "PostToolUse",
        name: "decisionkb:tool-observer",
        type: "async",
        priority: 1000,
        handler: async ({ data }) => {
          try {
            if (data?.toolName === "voteOnDecision" && data?.result) {
              this.recordVotingResult(data.result);
            }
            if (data?.toolName === "orchestrate" && data?.result) {
              this.recordWorkflowVerdict(data.result);
            }
          } catch (e) {
            logger.warn("[DecisionKB] Hook observation error:", e.message);
          }
          return { result: "continue" };
        },
      });
    } catch (e) {
      logger.warn("[DecisionKB] Hook registration error:", e.message);
    }

    logger.info("[DecisionKB] Hooks registered");
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  _getCount() {
    try {
      return this.db
        .prepare("SELECT COUNT(*) as count FROM decision_records")
        .get().count;
    } catch {
      return 0;
    }
  }

  _rowToRecord(row) {
    return {
      id: row.id,
      problem: row.problem,
      problemCategory: row.problem_category,
      solutions: safeParseJSON(row.solutions),
      chosenSolution: row.chosen_solution,
      outcome: row.outcome,
      context: safeParseJSON(row.context),
      agents: safeParseJSON(row.agents),
      source: row.source,
      successRate: row.success_rate,
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

function getDecisionKnowledgeBase() {
  if (!instance) {
    instance = new DecisionKnowledgeBase();
  }
  return instance;
}

module.exports = {
  DecisionKnowledgeBase,
  getDecisionKnowledgeBase,
  DECISION_SOURCES,
  PROBLEM_CATEGORIES,
};
