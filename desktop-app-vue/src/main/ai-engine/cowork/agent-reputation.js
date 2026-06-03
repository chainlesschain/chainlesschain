/**
 * Agent Reputation — v4.0.0
 *
 * Manages reputation scores for agents in the decentralized network.
 * Scores are computed as a weighted average of task success rate,
 * response time, quality, and recency. Scores decay over time if
 * the agent is inactive.
 *
 * Score range: 0.0 (untrusted) to 1.0 (trusted).
 *
 * Integrates with CrossOrgTaskRouter for automatic score updates
 * after task completion.
 *
 * @module ai-engine/cowork/agent-reputation
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const REPUTATION_LEVEL = {
  TRUSTED: "trusted",
  RELIABLE: "reliable",
  NEUTRAL: "neutral",
  UNTRUSTED: "untrusted",
};

const DEFAULT_SCORE = 0.5;

const SCORE_WEIGHTS = {
  SUCCESS_RATE: 0.4,
  RESPONSE_TIME: 0.2,
  QUALITY: 0.3,
  RECENCY: 0.1,
};

const DEFAULT_CONFIG = {
  decayIntervalMs: 86400000, // 24 hours
  decayFactor: 0.98,
  minScoreForTrusted: 0.8,
  minScoreForReliable: 0.6,
  minScoreForNeutral: 0.3,
  maxHistoryEntries: 200,
  expectedResponseTimeMs: 60000, // 1 minute baseline
  recencyWindowMs: 604800000, // 7 days
};

// ============================================================
// AgentReputation
// ============================================================

class AgentReputation extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // In-memory cache
    this._scores = new Map(); // agentDID → reputation record
    this._config = { ...DEFAULT_CONFIG };
  }

  /**
   * Initialize with database
   * @param {Object} db - Database manager
   * @param {Object} deps - Optional dependencies (unused, reserved)
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;

    this._ensureTables();
    await this._loadFromDB();

    this.initialized = true;
    logger.info(
      `[AgentReputation] Initialized: ${this._scores.size} agents tracked`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_reputation (
          id TEXT PRIMARY KEY,
          agent_did TEXT NOT NULL UNIQUE,
          score REAL DEFAULT ${DEFAULT_SCORE},
          total_tasks INTEGER DEFAULT 0,
          successful_tasks INTEGER DEFAULT 0,
          failed_tasks INTEGER DEFAULT 0,
          average_response_time_ms REAL DEFAULT 0,
          reliability REAL DEFAULT ${DEFAULT_SCORE},
          quality REAL DEFAULT ${DEFAULT_SCORE},
          last_active TEXT,
          history TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_rep_did ON agent_reputation(agent_did);
        CREATE INDEX IF NOT EXISTS idx_agent_rep_score ON agent_reputation(score);
        CREATE INDEX IF NOT EXISTS idx_agent_rep_active ON agent_reputation(last_active);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentReputation] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   */
  configure(updates = {}) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(updates)) {
      if (validKeys.includes(key)) {
        this._config[key] = updates[key];
      }
    }
    logger.info(
      `[AgentReputation] Configuration updated: ${JSON.stringify(updates)}`,
    );
  }

  // ============================================================
  // Score API
  // ============================================================

  /**
   * Get the reputation score for an agent
   * @param {string} agentDID - Agent DID
   * @returns {Object} Reputation data { score, level, totalTasks, reliability, quality, lastActive }
   */
  getScore(agentDID) {
    if (!agentDID) {
      return null;
    }

    const record = this._scores.get(agentDID);
    if (!record) {
      return {
        agentDID,
        score: DEFAULT_SCORE,
        level: REPUTATION_LEVEL.NEUTRAL,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        reliability: DEFAULT_SCORE,
        quality: DEFAULT_SCORE,
        averageResponseTimeMs: 0,
        lastActive: null,
      };
    }

    return {
      agentDID: record.agentDID,
      score: record.score,
      level: this._scoreToLevel(record.score),
      totalTasks: record.totalTasks,
      successfulTasks: record.successfulTasks,
      failedTasks: record.failedTasks,
      reliability: record.reliability,
      quality: record.quality,
      averageResponseTimeMs: record.averageResponseTimeMs,
      lastActive: record.lastActive,
    };
  }

  /**
   * Get ranked list of agents by reputation
   * @param {Object} options - { limit, minScore, level }
   * @returns {Array} Sorted agents by score descending
   */
  getRanking(options = {}) {
    const limit = options.limit || 50;
    const minScore = options.minScore || 0;

    let agents = Array.from(this._scores.values())
      .map((record) => ({
        agentDID: record.agentDID,
        score: record.score,
        level: this._scoreToLevel(record.score),
        totalTasks: record.totalTasks,
        successfulTasks: record.successfulTasks,
        reliability: record.reliability,
        quality: record.quality,
        lastActive: record.lastActive,
      }))
      .filter((a) => a.score >= minScore);

    if (options.level) {
      agents = agents.filter((a) => a.level === options.level);
    }

    agents.sort((a, b) => b.score - a.score);
    return agents.slice(0, limit);
  }

  /**
   * Update an agent's reputation score based on a task result
   * @param {string} agentDID - Agent DID
   * @param {Object} taskResult - { success, durationMs, quality, taskType, reason }
   * @returns {Object} Updated reputation data
   */
  updateScore(agentDID, taskResult) {
    if (!agentDID) {
      throw new Error("agentDID is required");
    }

    let record = this._scores.get(agentDID);
    const now = new Date().toISOString();

    if (!record) {
      record = this._createRecord(agentDID);
    }

    // Update task counts
    record.totalTasks++;
    if (taskResult.success) {
      record.successfulTasks++;
    } else {
      record.failedTasks++;
    }

    // Update average response time
    if (taskResult.durationMs && taskResult.durationMs > 0) {
      if (record.averageResponseTimeMs === 0) {
        record.averageResponseTimeMs = taskResult.durationMs;
      } else {
        // Exponential moving average
        record.averageResponseTimeMs =
          record.averageResponseTimeMs * 0.8 + taskResult.durationMs * 0.2;
      }
    }

    // Update quality if provided
    if (taskResult.quality !== undefined && taskResult.quality !== null) {
      const qualityValue =
        typeof taskResult.quality === "number"
          ? Math.max(0, Math.min(1, taskResult.quality))
          : taskResult.quality
            ? 0.7
            : 0.3;

      // Exponential moving average for quality
      record.quality = record.quality * 0.7 + qualityValue * 0.3;
    }

    // Recompute the composite score
    record.score = this._computeCompositeScore(record);
    record.reliability = this.computeReliability(agentDID);
    record.lastActive = now;
    record.updatedAt = now;

    // Add history entry
    const historyEntry = {
      timestamp: now,
      success: taskResult.success,
      durationMs: taskResult.durationMs || 0,
      taskType: taskResult.taskType || "unknown",
      scoreAfter: record.score,
    };

    if (!Array.isArray(record.history)) {
      record.history = [];
    }
    record.history.push(historyEntry);

    // Trim history
    if (record.history.length > this._config.maxHistoryEntries) {
      record.history = record.history.slice(
        record.history.length - this._config.maxHistoryEntries,
      );
    }

    // Persist
    this._scores.set(agentDID, record);
    this._persistRecord(record);

    this.emit("reputation:updated", {
      agentDID,
      score: record.score,
      level: this._scoreToLevel(record.score),
      taskResult,
    });

    logger.info(
      `[AgentReputation] Updated ${agentDID}: score=${record.score.toFixed(3)}, tasks=${record.totalTasks}`,
    );

    return this.getScore(agentDID);
  }

  /**
   * Get reputation history for an agent
   * @param {string} agentDID - Agent DID
   * @param {number} limit - Max history entries
   * @returns {Array} History entries
   */
  getHistory(agentDID, limit = 50) {
    const record = this._scores.get(agentDID);
    if (!record || !Array.isArray(record.history)) {
      return [];
    }

    const history = [...record.history];
    history.reverse(); // newest first
    return history.slice(0, limit);
  }

  /**
   * Compute the reliability metric for an agent
   * Reliability = successful_tasks / total_tasks (with Bayesian smoothing)
   * @param {string} agentDID - Agent DID
   * @returns {number} Reliability 0-1
   */
  computeReliability(agentDID) {
    const record = this._scores.get(agentDID);
    if (!record || record.totalTasks === 0) {
      return DEFAULT_SCORE;
    }

    // Bayesian smoothing: (successes + prior_successes) / (total + prior_total)
    const priorTotal = 2;
    const priorSuccesses = 1;

    const smoothedRate =
      (record.successfulTasks + priorSuccesses) /
      (record.totalTasks + priorTotal);

    return parseFloat(smoothedRate.toFixed(4));
  }

  /**
   * Apply decay to all inactive agents
   * Called periodically or manually
   * @returns {number} Number of agents decayed
   */
  applyDecay() {
    const now = Date.now();
    const decayWindow = this._config.decayIntervalMs;
    const factor = this._config.decayFactor;
    let decayed = 0;

    for (const [agentDID, record] of this._scores.entries()) {
      if (!record.lastActive) {
        continue;
      }

      const lastActiveMs = new Date(record.lastActive).getTime();
      const inactiveDuration = now - lastActiveMs;

      if (inactiveDuration > decayWindow) {
        const periods = Math.floor(inactiveDuration / decayWindow);
        const decayMultiplier = Math.pow(factor, periods);

        const oldScore = record.score;
        record.score = parseFloat(
          Math.max(0, record.score * decayMultiplier).toFixed(4),
        );
        record.updatedAt = new Date().toISOString();

        if (record.score !== oldScore) {
          this._persistRecord(record);
          decayed++;
        }
      }
    }

    if (decayed > 0) {
      logger.info(`[AgentReputation] Decayed ${decayed} inactive agents`);
    }

    return decayed;
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get reputation system statistics
   * @returns {Object} Stats
   */
  getStats() {
    try {
      const total = this._scores.size;
      const scores = Array.from(this._scores.values());

      const byLevel = {
        [REPUTATION_LEVEL.TRUSTED]: 0,
        [REPUTATION_LEVEL.RELIABLE]: 0,
        [REPUTATION_LEVEL.NEUTRAL]: 0,
        [REPUTATION_LEVEL.UNTRUSTED]: 0,
      };

      let totalScore = 0;
      let totalTasks = 0;

      for (const record of scores) {
        const level = this._scoreToLevel(record.score);
        byLevel[level]++;
        totalScore += record.score;
        totalTasks += record.totalTasks;
      }

      return {
        totalAgents: total,
        byLevel,
        averageScore:
          total > 0 ? parseFloat((totalScore / total).toFixed(3)) : 0,
        totalTasksRecorded: totalTasks,
      };
    } catch (e) {
      logger.error("[AgentReputation] stats error:", e.message);
      return {
        totalAgents: 0,
        byLevel: {},
        averageScore: 0,
        totalTasksRecorded: 0,
      };
    }
  }

  // ============================================================
  // Score Computation
  // ============================================================

  /**
   * Compute composite score from individual metrics
   * @param {Object} record - Reputation record
   * @returns {number} Composite score 0-1
   */
  _computeCompositeScore(record) {
    // 1. Success rate component (0-1)
    const successRate =
      record.totalTasks > 0
        ? record.successfulTasks / record.totalTasks
        : DEFAULT_SCORE;

    // 2. Response time component (0-1, lower time = higher score)
    const expectedTime = this._config.expectedResponseTimeMs;
    let responseTimeScore;
    if (record.averageResponseTimeMs <= 0) {
      responseTimeScore = DEFAULT_SCORE;
    } else {
      responseTimeScore = Math.max(
        0,
        Math.min(1, expectedTime / record.averageResponseTimeMs),
      );
    }

    // 3. Quality component (0-1)
    const qualityScore = record.quality || DEFAULT_SCORE;

    // 4. Recency component (0-1, more recent = higher)
    let recencyScore = DEFAULT_SCORE;
    if (record.lastActive) {
      const elapsed = Date.now() - new Date(record.lastActive).getTime();
      const window = this._config.recencyWindowMs;
      recencyScore = Math.max(0, 1 - elapsed / window);
    }

    // Weighted average
    const composite =
      successRate * SCORE_WEIGHTS.SUCCESS_RATE +
      responseTimeScore * SCORE_WEIGHTS.RESPONSE_TIME +
      qualityScore * SCORE_WEIGHTS.QUALITY +
      recencyScore * SCORE_WEIGHTS.RECENCY;

    return parseFloat(Math.max(0, Math.min(1, composite)).toFixed(4));
  }

  /**
   * Map a numeric score to a reputation level
   * @param {number} score - Score 0-1
   * @returns {string} Reputation level
   */
  _scoreToLevel(score) {
    if (score >= this._config.minScoreForTrusted) {
      return REPUTATION_LEVEL.TRUSTED;
    }
    if (score >= this._config.minScoreForReliable) {
      return REPUTATION_LEVEL.RELIABLE;
    }
    if (score >= this._config.minScoreForNeutral) {
      return REPUTATION_LEVEL.NEUTRAL;
    }
    return REPUTATION_LEVEL.UNTRUSTED;
  }

  // ============================================================
  // Persistence Helpers
  // ============================================================

  _createRecord(agentDID) {
    const now = new Date().toISOString();
    const record = {
      id: uuidv4(),
      agentDID,
      score: DEFAULT_SCORE,
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      averageResponseTimeMs: 0,
      reliability: DEFAULT_SCORE,
      quality: DEFAULT_SCORE,
      lastActive: now,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this._scores.set(agentDID, record);
    return record;
  }

  _persistRecord(record) {
    try {
      this.db.run(
        `INSERT OR REPLACE INTO agent_reputation
          (id, agent_did, score, total_tasks, successful_tasks, failed_tasks, average_response_time_ms, reliability, quality, last_active, history, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.agentDID,
          record.score,
          record.totalTasks,
          record.successfulTasks,
          record.failedTasks,
          record.averageResponseTimeMs,
          record.reliability,
          record.quality,
          record.lastActive,
          JSON.stringify(record.history || []),
          record.createdAt,
          record.updatedAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentReputation] Persist error:", e.message);
    }
  }

  async _loadFromDB() {
    try {
      const rows = this.db.prepare("SELECT * FROM agent_reputation").all();

      for (const row of rows) {
        const record = this._rowToRecord(row);
        this._scores.set(record.agentDID, record);
      }
    } catch (e) {
      logger.error("[AgentReputation] Load from DB error:", e.message);
    }
  }

  _rowToRecord(row) {
    return {
      id: row.id,
      agentDID: row.agent_did,
      score: row.score,
      totalTasks: row.total_tasks,
      successfulTasks: row.successful_tasks,
      failedTasks: row.failed_tasks,
      averageResponseTimeMs: row.average_response_time_ms,
      reliability: row.reliability,
      quality: row.quality,
      lastActive: row.last_active,
      history: safeParseJSON(row.history),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

function getAgentReputation() {
  if (!instance) {
    instance = new AgentReputation();
  }
  return instance;
}

module.exports = {
  AgentReputation,
  getAgentReputation,
  REPUTATION_LEVEL,
};
