/**
 * Memory-Augmented Generation (MAG) Engine
 *
 * Core engine for the Long-term Memory Enhancement system (F8).
 * Records user interactions, provides semantic search over past conversations,
 * analyzes interaction patterns, and builds memory context for LLM prompt injection.
 *
 * @module llm/memory-augmented-generation
 * @version 1.0.0
 * @since 2026-02-23
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Default configuration
 */
const DEFAULTS = {
  maxHistoryResults: 20,
  maxContextItems: 5,
  minRelevanceScore: 0.1,
};

/**
 * MemoryAugmentedGeneration - Records, searches, and analyzes user interactions
 * for long-term memory enhancement.
 */
class MemoryAugmentedGeneration {
  /**
   * Create a MAG engine
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance
   * @param {Object} [options.permanentMemoryManager] - PermanentMemoryManager instance
   * @param {Object} [options.instinctManager] - InstinctManager instance
   * @param {Object} [options.hybridSearchEngine] - HybridSearchEngine instance
   */
  constructor(options = {}) {
    this.db = options.database || null;
    this.permanentMemoryManager = options.permanentMemoryManager || null;
    this.instinctManager = options.instinctManager || null;
    this.hybridSearchEngine = options.hybridSearchEngine || null;
    this.initialized = false;
  }

  /**
   * Initialize the MAG engine and create database tables
   * @param {Object} [database] - Database instance (overrides constructor)
   */
  async initialize(database) {
    if (database) {
      this.db = database;
    }

    if (!this.db) {
      logger.warn(
        "[MemoryAugmentedGeneration] No database provided, cannot initialize",
      );
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS interaction_history (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          user_message TEXT NOT NULL,
          assistant_response TEXT,
          task_type TEXT DEFAULT 'general',
          feedback INTEGER DEFAULT 0,
          tokens_used INTEGER DEFAULT 0,
          latency_ms INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_interaction_history_created_at ON interaction_history(created_at);
        CREATE INDEX IF NOT EXISTS idx_interaction_history_task_type ON interaction_history(task_type);
      `);

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      this.initialized = true;
      logger.info("[MemoryAugmentedGeneration] Initialized successfully");
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] Initialization error:",
        error.message,
      );
      throw error;
    }
  }

  /**
   * Record a user interaction to the interaction_history table
   * @param {Object} data - Interaction data
   * @param {string} [data.conversationId] - Conversation ID
   * @param {string} data.userMessage - The user's message
   * @param {string} [data.assistantResponse] - The assistant's response
   * @param {string} [data.taskType='general'] - Task type classification
   * @param {number} [data.feedback=0] - Feedback score (-1, 0, 1)
   * @param {number} [data.tokensUsed=0] - Tokens consumed
   * @param {number} [data.latencyMs=0] - Response latency in milliseconds
   * @returns {Object} The recorded interaction
   */
  recordInteraction(data) {
    if (!this.db) {
      logger.warn(
        "[MemoryAugmentedGeneration] Database not available, skipping record",
      );
      return null;
    }

    if (!data || !data.userMessage) {
      logger.warn(
        "[MemoryAugmentedGeneration] userMessage is required for recordInteraction",
      );
      return null;
    }

    const id = uuidv4();
    const now = Date.now();

    const interaction = {
      id,
      conversationId: data.conversationId || null,
      userMessage: data.userMessage,
      assistantResponse: data.assistantResponse || null,
      taskType: data.taskType || "general",
      feedback: data.feedback || 0,
      tokensUsed: data.tokensUsed || 0,
      latencyMs: data.latencyMs || 0,
      createdAt: now,
    };

    try {
      this.db.run(
        `INSERT INTO interaction_history (id, conversation_id, user_message, assistant_response, task_type, feedback, tokens_used, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          interaction.id,
          interaction.conversationId,
          interaction.userMessage,
          interaction.assistantResponse,
          interaction.taskType,
          interaction.feedback,
          interaction.tokensUsed,
          interaction.latencyMs,
          interaction.createdAt,
        ],
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.debug(
        `[MemoryAugmentedGeneration] Recorded interaction: ${id} (${interaction.taskType})`,
      );
      return interaction;
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] recordInteraction error:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Record or update feedback for a specific interaction
   * @param {string} interactionId - The interaction ID
   * @param {number} feedback - Feedback score (-1, 0, 1)
   * @returns {boolean} Whether the update succeeded
   */
  recordFeedback(interactionId, feedback) {
    if (!this.db) {
      logger.warn(
        "[MemoryAugmentedGeneration] Database not available, skipping feedback",
      );
      return false;
    }

    if (!interactionId) {
      logger.warn(
        "[MemoryAugmentedGeneration] interactionId is required for recordFeedback",
      );
      return false;
    }

    const feedbackValue =
      typeof feedback === "number" ? Math.max(-1, Math.min(1, feedback)) : 0;

    try {
      const result = this.db.run(
        `UPDATE interaction_history SET feedback = ? WHERE id = ?`,
        [feedbackValue, interactionId],
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      const changed = result && result.changes ? result.changes > 0 : true;
      logger.debug(
        `[MemoryAugmentedGeneration] Feedback recorded for ${interactionId}: ${feedbackValue}`,
      );
      return changed;
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] recordFeedback error:",
        error.message,
      );
      return false;
    }
  }

  /**
   * Search past interactions using keyword matching
   * @param {string} query - Search query
   * @param {Object} [options] - Search options
   * @param {number} [options.limit=20] - Max results
   * @param {string} [options.taskType] - Filter by task type
   * @param {number} [options.minFeedback] - Minimum feedback score
   * @param {number} [options.startTime] - Start time (epoch ms)
   * @param {number} [options.endTime] - End time (epoch ms)
   * @returns {Array} Matching interactions sorted by relevance
   */
  searchHistory(query, options = {}) {
    if (!this.db) {
      logger.warn(
        "[MemoryAugmentedGeneration] Database not available for search",
      );
      return [];
    }

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return [];
    }

    const limit = options.limit || DEFAULTS.maxHistoryResults;
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 1);

    if (keywords.length === 0) {
      return [];
    }

    try {
      // Build conditions
      const conditions = [];
      const params = [];

      // Keyword matching on user_message and assistant_response
      const keywordConditions = keywords.map(() => {
        return "(LOWER(user_message) LIKE ? OR LOWER(COALESCE(assistant_response, '')) LIKE ?)";
      });
      conditions.push(`(${keywordConditions.join(" OR ")})`);
      for (const keyword of keywords) {
        params.push(`%${keyword}%`, `%${keyword}%`);
      }

      // Optional filters
      if (options.taskType) {
        conditions.push("task_type = ?");
        params.push(options.taskType);
      }

      if (options.minFeedback !== undefined) {
        conditions.push("feedback >= ?");
        params.push(options.minFeedback);
      }

      if (options.startTime) {
        conditions.push("created_at >= ?");
        params.push(options.startTime);
      }

      if (options.endTime) {
        conditions.push("created_at <= ?");
        params.push(options.endTime);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = this.db
        .prepare(
          `SELECT * FROM interaction_history ${where} ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...params, limit);

      // Calculate relevance score based on keyword matches
      const results = rows.map((row) => {
        const combinedText = `${(row.user_message || "").toLowerCase()} ${(row.assistant_response || "").toLowerCase()}`;
        let matchCount = 0;
        for (const keyword of keywords) {
          if (combinedText.includes(keyword)) {
            matchCount++;
          }
        }
        const relevanceScore = keywords.length > 0 ? matchCount / keywords.length : 0;

        return {
          id: row.id,
          conversationId: row.conversation_id,
          userMessage: row.user_message,
          assistantResponse: row.assistant_response,
          taskType: row.task_type,
          feedback: row.feedback,
          tokensUsed: row.tokens_used,
          latencyMs: row.latency_ms,
          createdAt: row.created_at,
          relevanceScore,
        };
      });

      // Sort by relevance score descending, then by created_at descending
      results.sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.createdAt - a.createdAt;
      });

      logger.debug(
        `[MemoryAugmentedGeneration] Search for "${query}" returned ${results.length} results`,
      );
      return results;
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] searchHistory error:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Analyze interaction patterns and return insights
   * @returns {Object} Insights object with statistics and patterns
   */
  getInsights() {
    if (!this.db) {
      logger.warn(
        "[MemoryAugmentedGeneration] Database not available for insights",
      );
      return {
        totalInteractions: 0,
        taskTypeDistribution: {},
        averageFeedback: 0,
        activeHours: [],
        recentActivity: [],
        topTaskTypes: [],
      };
    }

    try {
      // Total interactions
      const totalRow = this.db
        .prepare(`SELECT COUNT(*) as count FROM interaction_history`)
        .get();
      const totalInteractions = totalRow ? totalRow.count : 0;

      // Task type distribution
      const taskTypeRows = this.db
        .prepare(
          `SELECT task_type, COUNT(*) as count FROM interaction_history GROUP BY task_type ORDER BY count DESC`,
        )
        .all();
      const taskTypeDistribution = {};
      const topTaskTypes = [];
      for (const row of taskTypeRows) {
        taskTypeDistribution[row.task_type] = row.count;
        topTaskTypes.push({ taskType: row.task_type, count: row.count });
      }

      // Average feedback score (only for interactions that have feedback)
      const feedbackRow = this.db
        .prepare(
          `SELECT AVG(feedback) as avg_feedback FROM interaction_history WHERE feedback != 0`,
        )
        .get();
      const averageFeedback = feedbackRow && feedbackRow.avg_feedback !== null
        ? Math.round(feedbackRow.avg_feedback * 100) / 100
        : 0;

      // Active hours analysis (group by hour of day)
      const hourRows = this.db
        .prepare(
          `SELECT
            CAST((created_at / 3600000) % 24 AS INTEGER) as hour,
            COUNT(*) as count
          FROM interaction_history
          GROUP BY hour
          ORDER BY count DESC`,
        )
        .all();
      const activeHours = hourRows.map((row) => ({
        hour: row.hour,
        count: row.count,
      }));

      // Recent activity (last 7 days, grouped by day)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentRows = this.db
        .prepare(
          `SELECT
            CAST(created_at / 86400000 AS INTEGER) as day_epoch,
            COUNT(*) as count
          FROM interaction_history
          WHERE created_at >= ?
          GROUP BY day_epoch
          ORDER BY day_epoch DESC`,
        )
        .all(sevenDaysAgo);
      const recentActivity = recentRows.map((row) => ({
        date: new Date(row.day_epoch * 86400000).toISOString().split("T")[0],
        count: row.count,
      }));

      // Average tokens used and latency
      const performanceRow = this.db
        .prepare(
          `SELECT
            AVG(tokens_used) as avg_tokens,
            AVG(latency_ms) as avg_latency
          FROM interaction_history
          WHERE tokens_used > 0`,
        )
        .get();
      const averageTokens = performanceRow && performanceRow.avg_tokens !== null
        ? Math.round(performanceRow.avg_tokens)
        : 0;
      const averageLatency = performanceRow && performanceRow.avg_latency !== null
        ? Math.round(performanceRow.avg_latency)
        : 0;

      const insights = {
        totalInteractions,
        taskTypeDistribution,
        topTaskTypes,
        averageFeedback,
        activeHours,
        recentActivity,
        averageTokens,
        averageLatency,
      };

      logger.debug(
        `[MemoryAugmentedGeneration] Generated insights: ${totalInteractions} total interactions`,
      );
      return insights;
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] getInsights error:",
        error.message,
      );
      return {
        totalInteractions: 0,
        taskTypeDistribution: {},
        averageFeedback: 0,
        activeHours: [],
        recentActivity: [],
        topTaskTypes: [],
      };
    }
  }

  /**
   * Clear interaction history with optional time range
   * @param {Object} [options] - Clear options
   * @param {number} [options.startTime] - Clear from this time (epoch ms)
   * @param {number} [options.endTime] - Clear until this time (epoch ms)
   * @param {string} [options.taskType] - Clear only this task type
   * @returns {Object} Result with count of deleted interactions
   */
  clearHistory(options = {}) {
    if (!this.db) {
      logger.warn(
        "[MemoryAugmentedGeneration] Database not available for clearHistory",
      );
      return { deleted: 0 };
    }

    try {
      const conditions = [];
      const params = [];

      if (options.startTime) {
        conditions.push("created_at >= ?");
        params.push(options.startTime);
      }

      if (options.endTime) {
        conditions.push("created_at <= ?");
        params.push(options.endTime);
      }

      if (options.taskType) {
        conditions.push("task_type = ?");
        params.push(options.taskType);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Get count before deleting
      const countRow = this.db
        .prepare(`SELECT COUNT(*) as count FROM interaction_history ${where}`)
        .get(...params);
      const count = countRow ? countRow.count : 0;

      this.db.run(
        `DELETE FROM interaction_history ${where}`,
        params,
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.info(
        `[MemoryAugmentedGeneration] Cleared ${count} interactions from history`,
      );
      return { deleted: count };
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] clearHistory error:",
        error.message,
      );
      return { deleted: 0 };
    }
  }

  /**
   * Build a formatted string of relevant past interactions and user preferences
   * for injection into LLM prompts
   * @param {string} query - The current user query to find relevant context for
   * @param {number} [limit=5] - Maximum number of past interactions to include
   * @returns {string} Formatted memory context string
   */
  buildMemoryContext(query, limit = DEFAULTS.maxContextItems) {
    if (!this.db || !query) {
      return "";
    }

    try {
      const parts = [];

      // 1. Search for relevant past interactions
      const relevantInteractions = this.searchHistory(query, {
        limit,
        minFeedback: 0,
      });

      if (relevantInteractions.length > 0) {
        parts.push("## Relevant Past Interactions");
        for (const interaction of relevantInteractions) {
          const date = new Date(interaction.createdAt).toISOString().split("T")[0];
          const feedbackLabel =
            interaction.feedback > 0
              ? " [positive feedback]"
              : interaction.feedback < 0
                ? " [negative feedback]"
                : "";
          parts.push(
            `- [${date}] (${interaction.taskType}${feedbackLabel}) User: "${this._truncate(interaction.userMessage, 100)}"`,
          );
          if (interaction.assistantResponse) {
            parts.push(
              `  Response summary: "${this._truncate(interaction.assistantResponse, 150)}"`,
            );
          }
        }
      }

      // 2. Get recent positive interactions for general context
      const positiveInteractions = this._getRecentPositiveInteractions(3);
      if (positiveInteractions.length > 0) {
        parts.push("");
        parts.push("## Preferred Interaction Patterns");
        for (const interaction of positiveInteractions) {
          parts.push(
            `- Task type "${interaction.task_type}" was well-received (feedback: ${interaction.feedback})`,
          );
        }
      }

      // 3. Get most common task types
      const commonTypes = this._getMostCommonTaskTypes(3);
      if (commonTypes.length > 0) {
        parts.push("");
        parts.push("## User's Common Task Types");
        for (const type of commonTypes) {
          parts.push(`- ${type.task_type}: ${type.count} interactions`);
        }
      }

      const context = parts.join("\n");
      logger.debug(
        `[MemoryAugmentedGeneration] Built memory context: ${context.length} chars`,
      );
      return context;
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] buildMemoryContext error:",
        error.message,
      );
      return "";
    }
  }

  /**
   * Get recent interactions with positive feedback
   * @param {number} limit - Max results
   * @returns {Array} Rows from the database
   * @private
   */
  _getRecentPositiveInteractions(limit) {
    try {
      return this.db
        .prepare(
          `SELECT * FROM interaction_history WHERE feedback > 0 ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit);
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] _getRecentPositiveInteractions error:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Get most common task types
   * @param {number} limit - Max results
   * @returns {Array} Rows with task_type and count
   * @private
   */
  _getMostCommonTaskTypes(limit) {
    try {
      return this.db
        .prepare(
          `SELECT task_type, COUNT(*) as count FROM interaction_history GROUP BY task_type ORDER BY count DESC LIMIT ?`,
        )
        .all(limit);
    } catch (error) {
      logger.error(
        "[MemoryAugmentedGeneration] _getMostCommonTaskTypes error:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Truncate a string to a maximum length with ellipsis
   * @param {string} str - String to truncate
   * @param {number} maxLen - Maximum length
   * @returns {string} Truncated string
   * @private
   */
  _truncate(str, maxLen) {
    if (!str) return "";
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + "...";
  }
}

module.exports = { MemoryAugmentedGeneration };
