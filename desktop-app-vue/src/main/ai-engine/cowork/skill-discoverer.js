/**
 * Skill Discoverer — v2.1.0
 *
 * Auto-discovers marketplace skills from task failure analysis.
 * When a skill execution fails or a task has no matching skill,
 * the discoverer extracts keywords, searches the marketplace,
 * and suggests relevant skills for installation.
 *
 * Integrates with HookSystem to observe ToolError / TaskFailed events.
 *
 * @module ai-engine/cowork/skill-discoverer
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const MAX_KEYWORDS = 8;
const SEARCH_RESULT_LIMIT = 5;

// Common stop words to filter from keyword extraction
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "and",
  "but",
  "or",
  "not",
  "no",
  "nor",
  "so",
  "yet",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "they",
  "them",
  "their",
  "error",
  "failed",
  "failure",
  "cannot",
  "unable",
]);

// ============================================================
// SkillDiscoverer
// ============================================================

class SkillDiscoverer {
  constructor() {
    this.db = null;
    this.marketplaceClient = null;
    this.hookSystem = null;
    this.initialized = false;
  }

  /**
   * Initialize with dependencies
   * @param {Object} db - Database manager
   * @param {Object} marketplaceClient - MarketplaceClient (optional)
   * @param {Object} hookSystem - HookSystem (optional)
   */
  async initialize(db, marketplaceClient = null, hookSystem = null) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.marketplaceClient = marketplaceClient;
    this.hookSystem = hookSystem;

    this._ensureTables();

    if (this.hookSystem) {
      this._registerHooks();
    }

    this.initialized = true;
    logger.info("[SkillDiscoverer] Initialized");
  }

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS skill_discovery_log (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          failure_reason TEXT,
          searched_keywords TEXT,
          suggested_skills TEXT DEFAULT '[]',
          installed INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_discovery_task ON skill_discovery_log(task_id);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[SkillDiscoverer] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Analysis & Discovery
  // ============================================================

  /**
   * Analyze a task failure and discover relevant skills
   * @param {Object} data - { taskId, taskDescription, failureReason, context }
   * @returns {Object} Discovery result with suggestions
   */
  async analyzeTaskFailure(data) {
    const { taskId, taskDescription, failureReason, context } = data;

    // Extract keywords from failure context
    const text = [taskDescription, failureReason, context?.error]
      .filter(Boolean)
      .join(" ");
    const keywords = this._extractKeywords(text);

    logger.info(
      `[SkillDiscoverer] Analyzing failure for task ${taskId || "unknown"}: keywords=[${keywords.join(", ")}]`,
    );

    // Search marketplace
    const suggestions = await this.searchRelevantSkills(keywords);

    // Log discovery
    const logEntry = this._logDiscovery({
      taskId: taskId || null,
      failureReason: failureReason || "unknown",
      keywords,
      suggestions,
    });

    return {
      taskId,
      keywords,
      suggestions,
      logId: logEntry.id,
    };
  }

  /**
   * Search the marketplace for skills matching keywords
   * @param {Array<string>} keywords - Search keywords
   * @returns {Array} Matching skills
   */
  async searchRelevantSkills(keywords) {
    if (!keywords || keywords.length === 0) {
      return [];
    }

    // If marketplace client is available, use it
    if (this.marketplaceClient) {
      try {
        const query = keywords.slice(0, 3).join(" ");
        const results = await this.marketplaceClient.searchPlugins(query, {
          limit: SEARCH_RESULT_LIMIT,
        });
        return (results || []).map((plugin) => ({
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          author: plugin.author,
          category: plugin.category,
          matchedKeywords: keywords.filter((kw) =>
            `${plugin.name} ${plugin.description}`.toLowerCase().includes(kw),
          ),
        }));
      } catch (e) {
        logger.warn("[SkillDiscoverer] Marketplace search error:", e.message);
      }
    }

    // Fallback: return keyword-based suggestions without marketplace
    return keywords.slice(0, 3).map((kw) => ({
      name: kw,
      description: `Suggested skill for "${kw}"`,
      matchedKeywords: [kw],
      source: "keyword-inference",
    }));
  }

  /**
   * Suggest installation for discovered skills
   * @param {string} logId - Discovery log entry ID
   * @returns {Object} Installation suggestion with details
   */
  suggestInstallation(logId) {
    try {
      const row = this.db
        .prepare("SELECT * FROM skill_discovery_log WHERE id = ?")
        .get(logId);
      if (!row) {
        return { error: "Discovery log not found" };
      }

      const entry = this._rowToLogEntry(row);
      return {
        logId: entry.id,
        failureReason: entry.failureReason,
        suggestedSkills: entry.suggestedSkills,
        installed: entry.installed,
        recommendation:
          entry.suggestedSkills.length > 0
            ? `Consider installing "${entry.suggestedSkills[0]?.name}" to handle this type of task.`
            : "No matching skills found in the marketplace.",
      };
    } catch (e) {
      logger.error("[SkillDiscoverer] suggestInstallation error:", e.message);
      return { error: e.message };
    }
  }

  /**
   * Mark a discovery log entry as installed
   * @param {string} logId - Discovery log ID
   * @returns {boolean} Success
   */
  markInstalled(logId) {
    try {
      this.db.run("UPDATE skill_discovery_log SET installed = 1 WHERE id = ?", [
        logId,
      ]);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
      return true;
    } catch (e) {
      logger.error("[SkillDiscoverer] markInstalled error:", e.message);
      return false;
    }
  }

  // ============================================================
  // History
  // ============================================================

  /**
   * Get discovery history
   * @param {Object} filters - { limit, offset, installedOnly }
   * @returns {Array} Discovery log entries
   */
  getDiscoveryHistory(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.installedOnly) {
      conditions.push("installed = 1");
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM skill_discovery_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return rows.map(this._rowToLogEntry);
    } catch (e) {
      logger.error("[SkillDiscoverer] getHistory error:", e.message);
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
        .prepare("SELECT COUNT(*) as count FROM skill_discovery_log")
        .get().count;
      const installed = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM skill_discovery_log WHERE installed = 1",
        )
        .get().count;
      const withSuggestions = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM skill_discovery_log WHERE suggested_skills != '[]'",
        )
        .get().count;

      return {
        totalDiscoveries: total,
        installed,
        withSuggestions,
        installRate: total > 0 ? parseFloat((installed / total).toFixed(3)) : 0,
      };
    } catch (e) {
      logger.error("[SkillDiscoverer] stats error:", e.message);
      return {
        totalDiscoveries: 0,
        installed: 0,
        withSuggestions: 0,
        installRate: 0,
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

    try {
      registry.register({
        event: "PostToolUse",
        name: "skill-discoverer:error-observer",
        type: "async",
        priority: 1000,
        handler: async ({ data }) => {
          try {
            if (data?.error || data?.success === false) {
              await this.analyzeTaskFailure({
                taskId: data?.taskId,
                taskDescription: data?.toolName || "unknown",
                failureReason: data?.error || "execution failed",
                context: data,
              });
            }
          } catch (e) {
            // Non-critical
          }
          return { result: "continue" };
        },
      });
    } catch (e) {
      logger.warn("[SkillDiscoverer] Hook registration error:", e.message);
    }

    logger.info("[SkillDiscoverer] Hooks registered");
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  _extractKeywords(text) {
    if (!text) {
      return [];
    }

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    // Deduplicate and take top N by frequency
    const freq = {};
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYWORDS)
      .map(([word]) => word);
  }

  _logDiscovery(data) {
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      this.db.run(
        `INSERT INTO skill_discovery_log (id, task_id, failure_reason, searched_keywords, suggested_skills, installed, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [
          id,
          data.taskId,
          data.failureReason,
          data.keywords.join(","),
          JSON.stringify(data.suggestions),
          now,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.warn("[SkillDiscoverer] Log discovery error:", e.message);
    }

    return { id };
  }

  _rowToLogEntry(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      failureReason: row.failure_reason,
      searchedKeywords: row.searched_keywords
        ? row.searched_keywords.split(",")
        : [],
      suggestedSkills: safeParseJSON(row.suggested_skills),
      installed: row.installed === 1,
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

function getSkillDiscoverer() {
  if (!instance) {
    instance = new SkillDiscoverer();
  }
  return instance;
}

module.exports = {
  SkillDiscoverer,
  getSkillDiscoverer,
};
