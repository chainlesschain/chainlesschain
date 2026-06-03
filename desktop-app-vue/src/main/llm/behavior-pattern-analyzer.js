/**
 * Behavior Pattern Analyzer
 *
 * Analyzes and records user behavior patterns including time-of-day activity,
 * task sequences, tool usage, topic frequency, session duration, and feedback patterns.
 * Patterns are stored with confidence scores and frequency counts for
 * LLM prompt context injection.
 *
 * @module llm/behavior-pattern-analyzer
 * @version 1.0.0
 * @since 2026-02-23
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Valid pattern types
 */
const PATTERN_TYPES = [
  "time_of_day",
  "task_sequence",
  "tool_usage",
  "topic_frequency",
  "session_duration",
  "feedback_pattern",
];

/**
 * Confidence bounds
 */
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.99;
const DEFAULT_CONFIDENCE = 0.5;

/**
 * Confidence increment per additional observation (diminishing returns)
 */
const CONFIDENCE_INCREMENT_BASE = 0.08;

/**
 * BehaviorPatternAnalyzer - Records, analyzes, and retrieves user behavior patterns
 */
class BehaviorPatternAnalyzer {
  /**
   * Create a BehaviorPatternAnalyzer
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance
   */
  constructor(options = {}) {
    this.db = options.database || null;
    this.initialized = false;
  }

  /**
   * Initialize the analyzer and create the database table
   * @param {Object} [database] - Database instance (overrides constructor)
   */
  async initialize(database) {
    if (database) {
      this.db = database;
    }

    if (!this.db) {
      logger.warn(
        "[BehaviorPatternAnalyzer] No database provided, cannot initialize",
      );
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS interaction_patterns (
          id TEXT PRIMARY KEY,
          pattern_type TEXT NOT NULL CHECK(pattern_type IN ('time_of_day','task_sequence','tool_usage','topic_frequency','session_duration','feedback_pattern')),
          pattern_key TEXT NOT NULL,
          pattern_value TEXT,
          frequency INTEGER DEFAULT 1,
          confidence REAL DEFAULT 0.5,
          last_seen_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(pattern_type, pattern_key)
        );
        CREATE INDEX IF NOT EXISTS idx_interaction_patterns_type ON interaction_patterns(pattern_type);
      `);

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      this.initialized = true;
      logger.info("[BehaviorPatternAnalyzer] Initialized successfully");
    } catch (error) {
      logger.error(
        "[BehaviorPatternAnalyzer] Initialization error:",
        error.message,
      );
      throw error;
    }
  }

  /**
   * Record or update a behavior pattern.
   * If the (pattern_type, pattern_key) already exists, increment frequency and adjust confidence.
   * @param {string} patternType - Pattern type (one of PATTERN_TYPES)
   * @param {string} patternKey - Pattern key (e.g., "morning", "code_review->testing")
   * @param {string} [patternValue] - Optional pattern value/description
   * @returns {Object|null} The recorded or updated pattern
   */
  recordPattern(patternType, patternKey, patternValue) {
    if (!this.db) {
      logger.warn("[BehaviorPatternAnalyzer] Database not available");
      return null;
    }

    if (!patternType || !patternKey) {
      logger.warn(
        "[BehaviorPatternAnalyzer] patternType and patternKey are required",
      );
      return null;
    }

    if (!PATTERN_TYPES.includes(patternType)) {
      logger.warn(
        `[BehaviorPatternAnalyzer] Invalid pattern type: ${patternType}`,
      );
      return null;
    }

    const now = Date.now();

    try {
      // Check if pattern already exists
      const existing = this.db
        .prepare(
          `SELECT * FROM interaction_patterns WHERE pattern_type = ? AND pattern_key = ?`,
        )
        .get(patternType, patternKey);

      if (existing) {
        // Update existing: increment frequency and adjust confidence
        const newFrequency = existing.frequency + 1;
        const confidenceBoost =
          CONFIDENCE_INCREMENT_BASE / Math.sqrt(newFrequency);
        let newConfidence = existing.confidence + confidenceBoost;
        newConfidence = Math.max(
          MIN_CONFIDENCE,
          Math.min(MAX_CONFIDENCE, newConfidence),
        );

        const valueStr =
          patternValue !== undefined ? String(patternValue) : existing.pattern_value;

        this.db.run(
          `UPDATE interaction_patterns
           SET pattern_value = ?, frequency = ?, confidence = ?, last_seen_at = ?, updated_at = ?
           WHERE pattern_type = ? AND pattern_key = ?`,
          [valueStr, newFrequency, newConfidence, now, now, patternType, patternKey],
        );

        if (this.db.saveToFile) {
          this.db.saveToFile();
        }

        const updated = {
          id: existing.id,
          patternType,
          patternKey,
          patternValue: valueStr,
          frequency: newFrequency,
          confidence: newConfidence,
          lastSeenAt: now,
          createdAt: existing.created_at,
          updatedAt: now,
        };

        logger.debug(
          `[BehaviorPatternAnalyzer] Updated pattern: ${patternType}/${patternKey} (freq: ${newFrequency}, confidence: ${newConfidence.toFixed(2)})`,
        );
        return updated;
      } else {
        // Insert new pattern
        const id = uuidv4();
        const valueStr =
          patternValue !== undefined ? String(patternValue) : null;

        this.db.run(
          `INSERT INTO interaction_patterns (id, pattern_type, pattern_key, pattern_value, frequency, confidence, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [id, patternType, patternKey, valueStr, DEFAULT_CONFIDENCE, now, now, now],
        );

        if (this.db.saveToFile) {
          this.db.saveToFile();
        }

        const created = {
          id,
          patternType,
          patternKey,
          patternValue: valueStr,
          frequency: 1,
          confidence: DEFAULT_CONFIDENCE,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };

        logger.debug(
          `[BehaviorPatternAnalyzer] Created pattern: ${patternType}/${patternKey}`,
        );
        return created;
      }
    } catch (error) {
      logger.error(
        "[BehaviorPatternAnalyzer] recordPattern error:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Get behavior patterns, optionally filtered by type
   * @param {string} [patternType] - Filter by pattern type
   * @param {Object} [options] - Query options
   * @param {number} [options.minConfidence] - Minimum confidence threshold
   * @param {number} [options.limit=50] - Maximum results
   * @param {string} [options.sortBy='frequency'] - Sort field ('frequency', 'confidence', 'last_seen_at')
   * @returns {Array} List of pattern objects
   */
  getPatterns(patternType, options = {}) {
    if (!this.db) {
      logger.warn("[BehaviorPatternAnalyzer] Database not available");
      return [];
    }

    const limit = options.limit || 50;
    const sortBy = options.sortBy || "frequency";

    // Validate sort field
    const validSortFields = ["frequency", "confidence", "last_seen_at"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "frequency";

    try {
      const conditions = [];
      const params = [];

      if (patternType) {
        if (!PATTERN_TYPES.includes(patternType)) {
          logger.warn(
            `[BehaviorPatternAnalyzer] Invalid pattern type: ${patternType}`,
          );
          return [];
        }
        conditions.push("pattern_type = ?");
        params.push(patternType);
      }

      if (options.minConfidence !== undefined) {
        conditions.push("confidence >= ?");
        params.push(options.minConfidence);
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = this.db
        .prepare(
          `SELECT * FROM interaction_patterns ${where} ORDER BY ${sortField} DESC LIMIT ?`,
        )
        .all(...params, limit);

      return rows.map(this._rowToPattern);
    } catch (error) {
      logger.error(
        "[BehaviorPatternAnalyzer] getPatterns error:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Analyze when the user is most active based on interaction timestamps
   * @param {Array} interactions - Array of interaction objects with createdAt (epoch ms)
   * @returns {Object} Time pattern analysis results
   */
  analyzeTimePatterns(interactions) {
    if (!interactions || !Array.isArray(interactions) || interactions.length === 0) {
      return {
        hourDistribution: {},
        peakHours: [],
        dayDistribution: {},
        peakDays: [],
      };
    }

    // Count interactions by hour of day
    const hourCounts = {};
    for (let h = 0; h < 24; h++) {
      hourCounts[h] = 0;
    }

    // Count interactions by day of week (0=Sunday, 6=Saturday)
    const dayCounts = {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    };

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    for (const interaction of interactions) {
      const timestamp = interaction.createdAt || interaction.created_at;
      if (!timestamp) {continue;}

      const date = new Date(timestamp);
      const hour = date.getHours();
      const day = date.getDay();

      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }

    // Find peak hours (top 3)
    const sortedHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count > 0);
    const peakHours = sortedHours.slice(0, 3).map(([hour, count]) => ({
      hour: parseInt(hour, 10),
      count,
    }));

    // Find peak days (top 3)
    const sortedDays = Object.entries(dayCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count > 0);
    const peakDays = sortedDays.slice(0, 3).map(([day, count]) => ({
      day: parseInt(day, 10),
      dayName: dayNames[parseInt(day, 10)],
      count,
    }));

    // Record patterns to the database
    for (const peak of peakHours) {
      const hourLabel = this._getHourLabel(peak.hour);
      this.recordPattern(
        "time_of_day",
        `hour_${peak.hour}`,
        `Active at ${hourLabel} (${peak.count} interactions)`,
      );
    }

    for (const peak of peakDays) {
      this.recordPattern(
        "time_of_day",
        `day_${peak.dayName.toLowerCase()}`,
        `Active on ${peak.dayName} (${peak.count} interactions)`,
      );
    }

    return {
      hourDistribution: hourCounts,
      peakHours,
      dayDistribution: dayCounts,
      peakDays,
    };
  }

  /**
   * Analyze most common task types and task sequences
   * @param {Array} interactions - Array of interaction objects with taskType
   * @returns {Object} Task pattern analysis results
   */
  analyzeTaskPatterns(interactions) {
    if (!interactions || !Array.isArray(interactions) || interactions.length === 0) {
      return {
        taskDistribution: {},
        topTasks: [],
        taskSequences: [],
      };
    }

    // Count task types
    const taskCounts = {};
    for (const interaction of interactions) {
      const taskType = interaction.taskType || interaction.task_type || "general";
      taskCounts[taskType] = (taskCounts[taskType] || 0) + 1;
    }

    // Sort by frequency
    const topTasks = Object.entries(taskCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([taskType, count]) => ({ taskType, count }));

    // Analyze task sequences (pairs of consecutive task types)
    const sequenceCounts = {};
    const sortedInteractions = [...interactions].sort((a, b) => {
      const timeA = a.createdAt || a.created_at || 0;
      const timeB = b.createdAt || b.created_at || 0;
      return timeA - timeB;
    });

    for (let i = 1; i < sortedInteractions.length; i++) {
      const prevType =
        sortedInteractions[i - 1].taskType ||
        sortedInteractions[i - 1].task_type ||
        "general";
      const currType =
        sortedInteractions[i].taskType ||
        sortedInteractions[i].task_type ||
        "general";
      const seqKey = `${prevType}->${currType}`;
      sequenceCounts[seqKey] = (sequenceCounts[seqKey] || 0) + 1;
    }

    const taskSequences = Object.entries(sequenceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sequence, count]) => ({ sequence, count }));

    // Record patterns to the database
    for (const task of topTasks.slice(0, 5)) {
      this.recordPattern(
        "topic_frequency",
        `task_${task.taskType}`,
        `${task.count} interactions`,
      );
    }

    for (const seq of taskSequences.slice(0, 5)) {
      this.recordPattern(
        "task_sequence",
        seq.sequence,
        `${seq.count} occurrences`,
      );
    }

    return {
      taskDistribution: taskCounts,
      topTasks,
      taskSequences,
    };
  }

  /**
   * Build a formatted string of behavior patterns for LLM prompt injection
   * @param {number} [limit=10] - Maximum number of patterns to include
   * @returns {string} Formatted pattern context string
   */
  buildPatternContext(limit = 10) {
    if (!this.db) {
      return "";
    }

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM interaction_patterns
           WHERE confidence >= ?
           ORDER BY frequency DESC, confidence DESC
           LIMIT ?`,
        )
        .all(MIN_CONFIDENCE + 0.1, limit);

      if (rows.length === 0) {
        return "";
      }

      const parts = ["## User Behavior Patterns"];

      // Group by pattern type
      const grouped = {};
      for (const row of rows) {
        if (!grouped[row.pattern_type]) {
          grouped[row.pattern_type] = [];
        }
        grouped[row.pattern_type].push(row);
      }

      for (const [type, patterns] of Object.entries(grouped)) {
        const typeLabel = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        parts.push(`\n### ${typeLabel}`);
        for (const p of patterns) {
          const freqStr = `${p.frequency}x`;
          const confStr = `${Math.round(p.confidence * 100)}%`;
          const valueStr = p.pattern_value ? ` - ${p.pattern_value}` : "";
          parts.push(
            `- ${p.pattern_key}${valueStr} (seen ${freqStr}, confidence: ${confStr})`,
          );
        }
      }

      const context = parts.join("\n");
      logger.debug(
        `[BehaviorPatternAnalyzer] Built pattern context: ${context.length} chars, ${rows.length} patterns`,
      );
      return context;
    } catch (error) {
      logger.error(
        "[BehaviorPatternAnalyzer] buildPatternContext error:",
        error.message,
      );
      return "";
    }
  }

  /**
   * Convert a database row to a pattern object
   * @param {Object} row - Database row
   * @returns {Object} Pattern object
   * @private
   */
  _rowToPattern(row) {
    return {
      id: row.id,
      patternType: row.pattern_type,
      patternKey: row.pattern_key,
      patternValue: row.pattern_value,
      frequency: row.frequency,
      confidence: row.confidence,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get a human-readable label for an hour of day
   * @param {number} hour - Hour (0-23)
   * @returns {string} Human-readable label
   * @private
   */
  _getHourLabel(hour) {
    if (hour >= 5 && hour < 9) {return "early morning";}
    if (hour >= 9 && hour < 12) {return "morning";}
    if (hour >= 12 && hour < 14) {return "midday";}
    if (hour >= 14 && hour < 17) {return "afternoon";}
    if (hour >= 17 && hour < 20) {return "evening";}
    if (hour >= 20 && hour < 23) {return "night";}
    return "late night";
  }
}

module.exports = {
  BehaviorPatternAnalyzer,
  PATTERN_TYPES,
};
