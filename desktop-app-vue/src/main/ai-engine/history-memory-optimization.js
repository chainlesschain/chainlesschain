/**
 * History Memory Optimization
 * P2 Extended Feature - Long-term Memory Integration
 *
 * Integrates with MemGPT Core for:
 * - Historical task learning
 * - Success prediction based on past executions
 * - Pattern recognition and memory
 *
 * @module history-memory-optimization
 * @version 2.0.0
 */

const { logger } = require("../utils/logger.js");

/**
 * History Memory Optimization Class
 * Bridges AI Engine with MemGPT long-term memory system
 */
class HistoryMemoryOptimization {
  constructor(config = {}) {
    this.config = {
      enableLearning: config.enableLearning !== false,
      enablePrediction: config.enablePrediction !== false,
      historyWindowSize: config.historyWindowSize || 1000,
      minSamplesForPrediction: config.minSamplesForPrediction || 10,
      ...config,
    };

    this.db = null;
    this.memgptCore = null;

    // In-memory cache for fast lookups
    this.memoryCache = new Map();
    this.cacheMaxSize = 100;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes

    // Statistics
    this.stats = {
      totalPredictions: 0,
      accuratePredictions: 0,
      memoryHits: 0,
      learningEvents: 0,
    };
  }

  /**
   * Set database reference
   * @param {Object} db - Database instance
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * Set MemGPT Core reference
   * @param {MemGPTCore} memgptCore - MemGPT Core instance
   */
  setMemGPTCore(memgptCore) {
    this.memgptCore = memgptCore;
    logger.info("[HistoryMemory] MemGPT Core reference set");
  }

  /**
   * Learn from task execution history
   * @param {string} taskType - Type of task
   * @param {Object} context - Execution context
   * @returns {Promise<Object|null>} Learned memory or null
   */
  async learnFromHistory(taskType, context = {}) {
    if (!this.config.enableLearning) {
      return null;
    }

    // Check cache first
    const cacheKey = this._getCacheKey(taskType, context);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      this.stats.memoryHits++;
      return cached;
    }

    // Search MemGPT if available
    if (this.memgptCore) {
      try {
        const results = await this.memgptCore.retrieveRelevantMemories(
          `task:${taskType} ${JSON.stringify(context)}`,
          {
            types: ["task", "pattern"],
            limit: 5,
          },
        );

        if (results && results.length > 0) {
          const memory = this._aggregateMemories(results);
          this._addToCache(cacheKey, memory);
          return memory;
        }
      } catch (error) {
        logger.warn("[HistoryMemory] MemGPT search failed:", error.message);
      }
    }

    // Fallback to database if available
    if (this.db) {
      try {
        const rows = await this.db.all(
          `
          SELECT content, importance, metadata
          FROM long_term_memories
          WHERE type = 'task'
          AND content LIKE ?
          ORDER BY importance DESC, accessed_at DESC
          LIMIT 5
        `,
          [`%${taskType}%`],
        );

        if (rows && rows.length > 0) {
          const memory = this._aggregateDbRows(rows);
          this._addToCache(cacheKey, memory);
          return memory;
        }
      } catch (error) {
        logger.warn("[HistoryMemory] DB search failed:", error.message);
      }
    }

    return null;
  }

  /**
   * Predict success probability for a task
   * @param {Object} task - Task to predict
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Prediction result
   */
  async predictSuccess(task, context = {}) {
    this.stats.totalPredictions++;

    if (!this.config.enablePrediction) {
      return {
        probability: 0.5,
        confidence: 0.1,
        reason: "Prediction disabled",
      };
    }

    // Get historical memory
    const memory = await this.learnFromHistory(task.type, context);

    if (!memory) {
      return {
        probability: 0.5,
        confidence: 0.1,
        reason: "No historical data",
      };
    }

    // Check if we have enough samples
    if (memory.sampleCount < this.config.minSamplesForPrediction) {
      return {
        probability: memory.successRate || 0.5,
        confidence: 0.3,
        reason: `Insufficient samples (${memory.sampleCount}/${this.config.minSamplesForPrediction})`,
        memory,
      };
    }

    return {
      probability: memory.successRate,
      confidence: Math.min(0.9, memory.sampleCount / 100),
      reason: "Based on historical data",
      memory,
    };
  }

  /**
   * Record task execution for future learning
   * @param {Object} task - Executed task
   * @param {Object} result - Execution result
   * @param {number} duration - Execution duration in ms
   * @param {Object} context - Execution context
   */
  async recordExecution(task, result, duration, context = {}) {
    if (!this.config.enableLearning) {
      return;
    }

    this.stats.learningEvents++;

    const executionRecord = {
      taskType: task.type,
      taskName: task.name,
      success: result.success !== false,
      duration,
      error: result.error || null,
      context,
      timestamp: Date.now(),
    };

    // Store in MemGPT if available
    if (this.memgptCore) {
      try {
        await this.memgptCore.executeTool("archival_memory_insert", {
          content: JSON.stringify(executionRecord),
          type: "task",
          importance: result.success ? 0.5 : 0.7, // Failed tasks are more important to remember
        });
      } catch (error) {
        logger.warn(
          "[HistoryMemory] Failed to record in MemGPT:",
          error.message,
        );
      }
    }

    // Invalidate cache for this task type
    this._invalidateCache(task.type);
  }

  /**
   * Update prediction accuracy
   * @param {Object} prediction - Original prediction
   * @param {boolean} actualSuccess - Actual outcome
   */
  updatePredictionAccuracy(prediction, actualSuccess) {
    const predictedSuccess = prediction.probability >= 0.5;
    if (predictedSuccess === actualSuccess) {
      this.stats.accuratePredictions++;
    }
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const accuracy =
      this.stats.totalPredictions > 0
        ? (
            (this.stats.accuratePredictions / this.stats.totalPredictions) *
            100
          ).toFixed(1) + "%"
        : "N/A";

    return {
      ...this.stats,
      predictionAccuracy: accuracy,
      cacheSize: this.memoryCache.size,
      hasMemGPT: !!this.memgptCore,
      hasDatabase: !!this.db,
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.memoryCache.clear();
    this.db = null;
    this.memgptCore = null;
  }

  // ========== Private Methods ==========

  /**
   * Get cache key
   * @private
   */
  _getCacheKey(taskType, context) {
    return `${taskType}:${JSON.stringify(context)}`;
  }

  /**
   * Get from cache
   * @private
   */
  _getFromCache(key) {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Add to cache
   * @private
   */
  _addToCache(key, data) {
    // Evict oldest if at capacity
    if (this.memoryCache.size >= this.cacheMaxSize) {
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
    }

    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate cache entries for a task type
   * @private
   */
  _invalidateCache(taskType) {
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(taskType + ":")) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Aggregate memories from MemGPT search results
   * @private
   */
  _aggregateMemories(results) {
    let totalSuccess = 0;
    let totalCount = 0;
    const patterns = [];

    for (const result of results) {
      try {
        const content =
          typeof result.content === "string"
            ? JSON.parse(result.content)
            : result.content;

        if (content.success !== undefined) {
          totalSuccess += content.success ? 1 : 0;
          totalCount++;
        }

        if (content.pattern) {
          patterns.push(content.pattern);
        }
      } catch (e) {
        // Skip malformed entries
      }
    }

    return {
      successRate: totalCount > 0 ? totalSuccess / totalCount : 0.5,
      sampleCount: totalCount,
      patterns: [...new Set(patterns)],
      lastAccessed: Date.now(),
    };
  }

  /**
   * Aggregate database rows
   * @private
   */
  _aggregateDbRows(rows) {
    let totalSuccess = 0;
    let totalCount = 0;

    for (const row of rows) {
      try {
        const content = JSON.parse(row.content);
        if (content.success !== undefined) {
          totalSuccess += content.success ? 1 : 0;
          totalCount++;
        }
      } catch (e) {
        // Skip malformed entries
      }
    }

    return {
      successRate: totalCount > 0 ? totalSuccess / totalCount : 0.5,
      sampleCount: totalCount,
      patterns: [],
      lastAccessed: Date.now(),
    };
  }
}

module.exports = { HistoryMemoryOptimization };
