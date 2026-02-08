/**
 * BehaviorTracker - Automatic Behavior Learning
 *
 * Tracks and learns from user behavior patterns:
 * - Page visits and navigation patterns
 * - Feature usage and preferences
 * - LLM interaction patterns
 * - Time-based preferences
 * - Smart recommendations
 *
 * @module behavior-tracker
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * BehaviorTracker class
 */
class BehaviorTracker extends EventEmitter {
  /**
   * Create a BehaviorTracker instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.patternsDir - Directory for pattern backups
   * @param {Object} [options.llmManager] - LLM Manager for AI analysis
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[BehaviorTracker] database parameter is required");
    }

    this.db = options.database;
    this.patternsDir =
      options.patternsDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "learned-patterns");
    this.llmManager = options.llmManager || null;

    // Current session tracking
    this.currentSessionId = uuidv4();
    this.recentEvents = [];
    this.maxRecentEvents = 100;

    // Analysis settings
    this.analysisInterval = 60 * 60 * 1000; // Analyze patterns every hour
    this.analysisTimer = null;

    // Minimum occurrences for pattern detection
    this.minSequenceOccurrences = 3;
    this.minPatternConfidence = 0.5;

    logger.info("[BehaviorTracker] Initialized", {
      patternsDir: this.patternsDir,
      sessionId: this.currentSessionId,
    });
  }

  /**
   * Initialize the tracker
   */
  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(this.patternsDir, { recursive: true });

      // Ensure tables exist
      await this._ensureTables();

      // Start periodic analysis
      this._startPeriodicAnalysis();

      logger.info("[BehaviorTracker] Initialization complete");
    } catch (error) {
      logger.error("[BehaviorTracker] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Ensure database tables exist
   * @private
   */
  async _ensureTables() {
    try {
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='behavior_events'
      `);
      const exists = tableCheck.get();

      if (!exists) {
        // Create behavior_events table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS behavior_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            event_name TEXT NOT NULL,
            event_data TEXT,
            session_id TEXT,
            context TEXT,
            duration_ms INTEGER,
            success INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create behavior_patterns table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS behavior_patterns (
            id TEXT PRIMARY KEY,
            pattern_type TEXT NOT NULL,
            pattern_name TEXT,
            pattern_data TEXT NOT NULL,
            confidence REAL DEFAULT 0.5,
            occurrence_count INTEGER DEFAULT 1,
            last_occurrence_at INTEGER,
            is_active INTEGER DEFAULT 1,
            is_confirmed INTEGER DEFAULT 0,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create smart_recommendations table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS smart_recommendations (
            id TEXT PRIMARY KEY,
            recommendation_type TEXT NOT NULL,
            target TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            reason TEXT,
            action_data TEXT,
            score REAL DEFAULT 0,
            priority TEXT DEFAULT 'medium',
            shown_count INTEGER DEFAULT 0,
            accepted_count INTEGER DEFAULT 0,
            dismissed_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            expires_at INTEGER,
            source_pattern_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create feature_sequences table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS feature_sequences (
            id TEXT PRIMARY KEY,
            sequence TEXT NOT NULL UNIQUE,
            sequence_length INTEGER NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            avg_interval_ms REAL,
            completion_rate REAL,
            last_seen_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create indexes
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_behavior_events_type ON behavior_events(event_type, created_at DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_behavior_events_session ON behavior_events(session_id, created_at DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_behavior_patterns_active ON behavior_patterns(is_active, confidence DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_smart_recommendations_active ON smart_recommendations(is_active, priority DESC)`,
          )
          .run();

        logger.info("[BehaviorTracker] Database tables created");
      }
    } catch (error) {
      logger.error("[BehaviorTracker] Failed to ensure tables:", error);
      throw error;
    }
  }

  /**
   * Start periodic pattern analysis
   * @private
   */
  _startPeriodicAnalysis() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
    }

    this.analysisTimer = setInterval(async () => {
      await this.analyzePatterns();
    }, this.analysisInterval);

    logger.info("[BehaviorTracker] Periodic analysis started");
  }

  /**
   * Stop periodic analysis
   */
  stopPeriodicAnalysis() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
      logger.info("[BehaviorTracker] Periodic analysis stopped");
    }
  }

  // ============================================================
  // Event Tracking
  // ============================================================

  /**
   * Track a page visit
   * @param {string} pageName - Page name
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Tracked event
   */
  async trackPageVisit(pageName, options = {}) {
    const { duration, previousPage, metadata } = options;

    const event = {
      type: "page_visit",
      name: pageName,
      data: { previousPage, ...metadata },
      duration,
    };

    return this._trackEvent(event);
  }

  /**
   * Track feature usage
   * @param {string} featureName - Feature name
   * @param {string} action - Action performed
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Tracked event
   */
  async trackFeatureUse(featureName, action = "use", options = {}) {
    const { duration, success = true, metadata } = options;

    const event = {
      type: "feature_use",
      name: `${featureName}_${action}`,
      data: { feature: featureName, action, ...metadata },
      duration,
      success,
    };

    return this._trackEvent(event);
  }

  /**
   * Track LLM interaction
   * @param {Object} params - Interaction parameters
   * @returns {Promise<Object>} Tracked event
   */
  async trackLLMInteraction(params = {}) {
    const {
      provider,
      model,
      queryType,
      inputLength,
      outputLength,
      duration,
      success = true,
      metadata,
    } = params;

    const event = {
      type: "llm_interaction",
      name: `llm_${provider}_${queryType || "query"}`,
      data: {
        provider,
        model,
        queryType,
        inputLength,
        outputLength,
        ...metadata,
      },
      duration,
      success,
    };

    return this._trackEvent(event);
  }

  /**
   * Track search action
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Tracked event
   */
  async trackSearch(query, options = {}) {
    const { context, resultCount, selectedResult, duration } = options;

    const event = {
      type: "search",
      name: `search_${context || "global"}`,
      data: { query: query.substring(0, 100), resultCount, selectedResult },
      duration,
    };

    return this._trackEvent(event);
  }

  /**
   * Track error
   * @param {string} errorType - Error type
   * @param {Object} options - Error options
   * @returns {Promise<Object>} Tracked event
   */
  async trackError(errorType, options = {}) {
    const { message, context, metadata } = options;

    const event = {
      type: "error",
      name: `error_${errorType}`,
      data: { message: message?.substring(0, 200), context, ...metadata },
      success: false,
    };

    return this._trackEvent(event);
  }

  /**
   * Internal event tracking
   * @param {Object} event - Event to track
   * @returns {Promise<Object>} Tracked event
   * @private
   */
  async _trackEvent(event) {
    const id = uuidv4();
    const now = Date.now();

    try {
      this.db
        .prepare(
          `
        INSERT INTO behavior_events (
          id, event_type, event_name, event_data, session_id,
          context, duration_ms, success, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          event.type,
          event.name,
          event.data ? JSON.stringify(event.data) : null,
          this.currentSessionId,
          event.context ? JSON.stringify(event.context) : null,
          event.duration || null,
          event.success !== false ? 1 : 0,
          now,
        );

      // Add to recent events for sequence detection
      this.recentEvents.push({
        id,
        type: event.type,
        name: event.name,
        timestamp: now,
      });

      // Keep recent events buffer manageable
      if (this.recentEvents.length > this.maxRecentEvents) {
        this.recentEvents.shift();
      }

      // Check for sequences after feature usage
      if (event.type === "feature_use") {
        await this._detectSequences();
      }

      const tracked = { id, ...event, timestamp: now };
      this.emit("event-tracked", tracked);

      return tracked;
    } catch (error) {
      logger.error("[BehaviorTracker] Failed to track event:", error);
      throw error;
    }
  }

  // ============================================================
  // Pattern Analysis
  // ============================================================

  /**
   * Analyze behavior patterns
   * @returns {Promise<Object>} Analysis results
   */
  async analyzePatterns() {
    logger.info("[BehaviorTracker] Starting pattern analysis");
    const startTime = Date.now();

    try {
      const results = {
        sequencesDetected: 0,
        timePreferencesUpdated: 0,
        recommendationsGenerated: 0,
      };

      // Detect feature sequences
      const sequences = await this._analyzeFeatureSequences();
      results.sequencesDetected = sequences.length;

      // Analyze time preferences
      const timePrefs = await this._analyzeTimePreferences();
      results.timePreferencesUpdated = timePrefs.updated;

      // Generate recommendations
      const recommendations = await this._generateSmartRecommendations();
      results.recommendationsGenerated = recommendations.length;

      // Update pattern confidence scores
      await this._updatePatternConfidence();

      // Save patterns to file
      await this._backupPatterns();

      results.duration = Date.now() - startTime;
      this.emit("analysis-completed", results);

      logger.info(
        `[BehaviorTracker] Analysis complete: ${results.sequencesDetected} sequences, ${results.recommendationsGenerated} recommendations`,
      );

      return results;
    } catch (error) {
      logger.error("[BehaviorTracker] Pattern analysis failed:", error);
      throw error;
    }
  }

  /**
   * Detect feature usage sequences
   * @private
   */
  async _detectSequences() {
    try {
      // Get recent feature events from this session
      const recentFeatures = this.recentEvents
        .filter((e) => e.type === "feature_use")
        .slice(-10)
        .map((e) => e.name);

      if (recentFeatures.length < 2) {
        return;
      }

      // Check for sequences of 2-4 features
      for (let len = 2; len <= Math.min(4, recentFeatures.length); len++) {
        const sequence = recentFeatures.slice(-len);
        const sequenceKey = JSON.stringify(sequence);

        await this._recordSequence(sequence, sequenceKey);
      }
    } catch (error) {
      logger.error("[BehaviorTracker] Sequence detection failed:", error);
    }
  }

  /**
   * Record a feature sequence
   * @private
   */
  async _recordSequence(sequence, sequenceKey) {
    const now = Date.now();

    try {
      // Check if sequence exists
      const existing = this.db
        .prepare(`SELECT * FROM feature_sequences WHERE sequence = ?`)
        .get(sequenceKey);

      if (existing) {
        // Update occurrence count
        this.db
          .prepare(
            `
          UPDATE feature_sequences
          SET occurrence_count = occurrence_count + 1,
              last_seen_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
          )
          .run(now, now, existing.id);
      } else {
        // Insert new sequence
        this.db
          .prepare(
            `
          INSERT INTO feature_sequences (
            id, sequence, sequence_length, occurrence_count,
            last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?, ?)
        `,
          )
          .run(uuidv4(), sequenceKey, sequence.length, now, now, now);
      }
    } catch (error) {
      logger.error("[BehaviorTracker] Failed to record sequence:", error);
    }
  }

  /**
   * Analyze feature sequences for patterns
   * @private
   */
  async _analyzeFeatureSequences() {
    try {
      // Find frequent sequences
      const stmt = this.db.prepare(`
        SELECT * FROM feature_sequences
        WHERE occurrence_count >= ?
        ORDER BY occurrence_count DESC
        LIMIT 20
      `);
      const sequences = stmt.all(this.minSequenceOccurrences);

      const patterns = [];

      for (const seq of sequences) {
        // Check if pattern already exists
        const existingPattern = this.db
          .prepare(
            `
          SELECT * FROM behavior_patterns
          WHERE pattern_type = 'sequence' AND pattern_data = ?
        `,
          )
          .get(seq.sequence);

        if (existingPattern) {
          // Update existing pattern
          this.db
            .prepare(
              `
            UPDATE behavior_patterns
            SET occurrence_count = ?,
                confidence = MIN(1.0, ? / 10.0),
                last_occurrence_at = ?,
                updated_at = ?
            WHERE id = ?
          `,
            )
            .run(
              seq.occurrence_count,
              seq.occurrence_count,
              seq.last_seen_at,
              Date.now(),
              existingPattern.id,
            );
        } else {
          // Create new pattern
          const patternId = uuidv4();
          const sequenceData = JSON.parse(seq.sequence);

          this.db
            .prepare(
              `
            INSERT INTO behavior_patterns (
              id, pattern_type, pattern_name, pattern_data,
              confidence, occurrence_count, last_occurrence_at,
              created_at, updated_at
            ) VALUES (?, 'sequence', ?, ?, ?, ?, ?, ?, ?)
          `,
            )
            .run(
              patternId,
              `Sequence: ${sequenceData.join(" -> ")}`,
              seq.sequence,
              Math.min(1.0, seq.occurrence_count / 10.0),
              seq.occurrence_count,
              seq.last_seen_at,
              Date.now(),
              Date.now(),
            );

          patterns.push({ id: patternId, sequence: sequenceData });
        }
      }

      return patterns;
    } catch (error) {
      logger.error("[BehaviorTracker] Sequence analysis failed:", error);
      return [];
    }
  }

  /**
   * Analyze time preferences
   * @private
   */
  async _analyzeTimePreferences() {
    try {
      // Get events from last 30 days
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

      const stmt = this.db.prepare(`
        SELECT
          CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) as day_of_week,
          CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) as hour,
          event_type,
          COUNT(*) as event_count,
          AVG(duration_ms) as avg_duration,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate
        FROM behavior_events
        WHERE created_at >= ?
        GROUP BY day_of_week, hour, event_type
      `);
      const timeData = stmt.all(cutoff);

      let updated = 0;

      for (const td of timeData) {
        // Store time preference (using upsert pattern)
        const existing = this.db
          .prepare(
            `
          SELECT id FROM time_preferences
          WHERE preference_type = 'active_hours'
            AND day_of_week = ? AND hour = ?
        `,
          )
          .get(td.day_of_week, td.hour);

        if (existing) {
          this.db
            .prepare(
              `
            UPDATE time_preferences
            SET event_count = event_count + ?,
                avg_duration_ms = ?,
                success_rate = ?,
                updated_at = ?
            WHERE id = ?
          `,
            )
            .run(
              td.event_count,
              td.avg_duration,
              td.success_rate,
              Date.now(),
              existing.id,
            );
        } else {
          this.db
            .prepare(
              `
            INSERT INTO time_preferences (
              id, preference_type, day_of_week, hour,
              event_count, avg_duration_ms, success_rate,
              created_at, updated_at
            ) VALUES (?, 'active_hours', ?, ?, ?, ?, ?, ?, ?)
          `,
            )
            .run(
              uuidv4(),
              td.day_of_week,
              td.hour,
              td.event_count,
              td.avg_duration,
              td.success_rate,
              Date.now(),
              Date.now(),
            );
        }

        updated++;
      }

      return { updated };
    } catch (error) {
      logger.error("[BehaviorTracker] Time preference analysis failed:", error);
      return { updated: 0 };
    }
  }

  /**
   * Generate smart recommendations
   * @private
   */
  async _generateSmartRecommendations() {
    const recommendations = [];

    try {
      // Get high-confidence patterns
      const patterns = this.db
        .prepare(
          `
        SELECT * FROM behavior_patterns
        WHERE is_active = 1 AND confidence >= ?
        ORDER BY confidence DESC
        LIMIT 10
      `,
        )
        .all(this.minPatternConfidence);

      for (const pattern of patterns) {
        // Check if recommendation already exists for this pattern
        const existingRec = this.db
          .prepare(
            `
          SELECT id FROM smart_recommendations
          WHERE source_pattern_id = ? AND is_active = 1
        `,
          )
          .get(pattern.id);

        if (existingRec) {
          continue;
        }

        // Generate recommendation based on pattern type
        const rec = this._createRecommendationFromPattern(pattern);
        if (rec) {
          this.db
            .prepare(
              `
            INSERT INTO smart_recommendations (
              id, recommendation_type, target, title, description,
              reason, action_data, score, priority, source_pattern_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            )
            .run(
              rec.id,
              rec.type,
              rec.target,
              rec.title,
              rec.description,
              rec.reason,
              rec.actionData ? JSON.stringify(rec.actionData) : null,
              rec.score,
              rec.priority,
              pattern.id,
              Date.now(),
              Date.now(),
            );

          recommendations.push(rec);
        }
      }

      // Generate feature suggestions based on usage
      const featureSuggestions = await this._generateFeatureSuggestions();
      recommendations.push(...featureSuggestions);

      return recommendations;
    } catch (error) {
      logger.error(
        "[BehaviorTracker] Recommendation generation failed:",
        error,
      );
      return [];
    }
  }

  /**
   * Create recommendation from pattern
   * @private
   */
  _createRecommendationFromPattern(pattern) {
    const id = uuidv4();

    if (pattern.pattern_type === "sequence") {
      const sequence = JSON.parse(pattern.pattern_data);
      return {
        id,
        type: "workflow",
        target: sequence[0],
        title: `Workflow shortcut: ${pattern.pattern_name}`,
        description: `You often use these features in sequence. Consider creating a workflow for: ${sequence.join(" → ")}`,
        reason: `Based on ${pattern.occurrence_count} observations`,
        actionData: { sequence },
        score: pattern.confidence,
        priority: pattern.confidence >= 0.8 ? "high" : "medium",
      };
    }

    return null;
  }

  /**
   * Generate feature suggestions
   * @private
   */
  async _generateFeatureSuggestions() {
    const suggestions = [];

    try {
      // Find features with low usage but high success rate
      const stmt = this.db.prepare(`
        SELECT event_name,
          COUNT(*) as usage_count,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate
        FROM behavior_events
        WHERE event_type = 'feature_use'
          AND created_at >= ?
        GROUP BY event_name
        HAVING usage_count < 10 AND success_rate >= 0.9
        ORDER BY success_rate DESC
        LIMIT 5
      `);
      const underusedFeatures = stmt.all(Date.now() - 30 * 24 * 60 * 60 * 1000);

      for (const feature of underusedFeatures) {
        const existing = this.db
          .prepare(
            `
          SELECT id FROM smart_recommendations
          WHERE target = ? AND recommendation_type = 'feature' AND is_active = 1
        `,
          )
          .get(feature.event_name);

        if (!existing) {
          const id = uuidv4();
          const featureName = feature.event_name.replace(/_/g, " ");

          this.db
            .prepare(
              `
            INSERT INTO smart_recommendations (
              id, recommendation_type, target, title, description,
              reason, score, priority, created_at, updated_at
            ) VALUES (?, 'feature', ?, ?, ?, ?, ?, 'low', ?, ?)
          `,
            )
            .run(
              id,
              feature.event_name,
              `Try: ${featureName}`,
              `You've used this feature ${feature.usage_count} times with ${Math.round(feature.success_rate * 100)}% success rate. Consider using it more!`,
              "Based on your successful usage patterns",
              0.5,
              Date.now(),
              Date.now(),
            );

          suggestions.push({ id, feature: feature.event_name });
        }
      }

      return suggestions;
    } catch (error) {
      logger.error("[BehaviorTracker] Feature suggestion failed:", error);
      return [];
    }
  }

  /**
   * Update pattern confidence scores
   * @private
   */
  async _updatePatternConfidence() {
    try {
      // Decrease confidence for patterns not seen recently
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days

      this.db
        .prepare(
          `
        UPDATE behavior_patterns
        SET confidence = MAX(0.1, confidence * 0.9),
            updated_at = ?
        WHERE is_active = 1
          AND last_occurrence_at < ?
          AND is_confirmed = 0
      `,
        )
        .run(Date.now(), cutoff);

      // Deactivate patterns with very low confidence
      this.db
        .prepare(
          `
        UPDATE behavior_patterns
        SET is_active = 0, updated_at = ?
        WHERE confidence < 0.2 AND is_confirmed = 0
      `,
        )
        .run(Date.now());
    } catch (error) {
      logger.error("[BehaviorTracker] Confidence update failed:", error);
    }
  }

  /**
   * Backup patterns to file
   * @private
   */
  async _backupPatterns() {
    try {
      const patterns = this.db
        .prepare(`SELECT * FROM behavior_patterns WHERE is_active = 1`)
        .all();
      const recommendations = this.db
        .prepare(`SELECT * FROM smart_recommendations WHERE is_active = 1`)
        .all();

      const backup = {
        version: "1.0.0",
        exportedAt: Date.now(),
        patterns,
        recommendations,
      };

      const backupPath = path.join(this.patternsDir, "behavior-summary.json");
      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
    } catch (error) {
      logger.error("[BehaviorTracker] Pattern backup failed:", error);
    }
  }

  // ============================================================
  // Recommendations
  // ============================================================

  /**
   * Get smart recommendations
   * @param {Object} context - Current context
   * @returns {Promise<Array>} Recommendations
   */
  async getRecommendations(context = {}) {
    const { type, limit = 5 } = context;

    try {
      let sql = `
        SELECT * FROM smart_recommendations
        WHERE is_active = 1
          AND (expires_at IS NULL OR expires_at > ?)
      `;
      const params = [Date.now()];

      if (type) {
        sql += ` AND recommendation_type = ?`;
        params.push(type);
      }

      sql += ` ORDER BY priority DESC, score DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(sql);
      return stmt.all(...params).map((r) => ({
        id: r.id,
        type: r.recommendation_type,
        target: r.target,
        title: r.title,
        description: r.description,
        reason: r.reason,
        actionData: r.action_data ? JSON.parse(r.action_data) : null,
        score: r.score,
        priority: r.priority,
        shownCount: r.shown_count,
        acceptedCount: r.accepted_count,
      }));
    } catch (error) {
      logger.error("[BehaviorTracker] Failed to get recommendations:", error);
      return [];
    }
  }

  /**
   * Mark recommendation as shown
   * @param {string} id - Recommendation ID
   */
  async markRecommendationShown(id) {
    try {
      this.db
        .prepare(
          `
        UPDATE smart_recommendations
        SET shown_count = shown_count + 1, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(Date.now(), id);
    } catch (error) {
      logger.error(
        "[BehaviorTracker] Failed to mark recommendation shown:",
        error,
      );
    }
  }

  /**
   * Accept recommendation
   * @param {string} id - Recommendation ID
   */
  async acceptRecommendation(id) {
    try {
      this.db
        .prepare(
          `
        UPDATE smart_recommendations
        SET accepted_count = accepted_count + 1, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(Date.now(), id);

      // Increase confidence of source pattern
      const rec = this.db
        .prepare(
          `SELECT source_pattern_id FROM smart_recommendations WHERE id = ?`,
        )
        .get(id);
      if (rec?.source_pattern_id) {
        this.db
          .prepare(
            `
          UPDATE behavior_patterns
          SET confidence = MIN(1.0, confidence + 0.1), updated_at = ?
          WHERE id = ?
        `,
          )
          .run(Date.now(), rec.source_pattern_id);
      }

      this.emit("recommendation-accepted", { id });
    } catch (error) {
      logger.error("[BehaviorTracker] Failed to accept recommendation:", error);
    }
  }

  /**
   * Dismiss recommendation
   * @param {string} id - Recommendation ID
   */
  async dismissRecommendation(id) {
    try {
      this.db
        .prepare(
          `
        UPDATE smart_recommendations
        SET dismissed_count = dismissed_count + 1,
            is_active = CASE WHEN dismissed_count >= 3 THEN 0 ELSE is_active END,
            updated_at = ?
        WHERE id = ?
      `,
        )
        .run(Date.now(), id);

      this.emit("recommendation-dismissed", { id });
    } catch (error) {
      logger.error(
        "[BehaviorTracker] Failed to dismiss recommendation:",
        error,
      );
    }
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get behavior statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      // Event counts
      const eventStats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total_events,
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as events_today,
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as events_this_week
        FROM behavior_events
      `,
        )
        .get(dayAgo, weekAgo);

      // Pattern counts
      const patternStats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total_patterns,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_patterns,
          SUM(CASE WHEN is_confirmed = 1 THEN 1 ELSE 0 END) as confirmed_patterns,
          AVG(confidence) as avg_confidence
        FROM behavior_patterns
      `,
        )
        .get();

      // Recommendation counts
      const recStats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total_recommendations,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_recommendations,
          SUM(accepted_count) as total_accepted,
          SUM(dismissed_count) as total_dismissed
        FROM smart_recommendations
      `,
        )
        .get();

      // Top features
      const topFeatures = this.db
        .prepare(
          `
        SELECT event_name, COUNT(*) as count
        FROM behavior_events
        WHERE event_type = 'feature_use' AND created_at >= ?
        GROUP BY event_name
        ORDER BY count DESC
        LIMIT 5
      `,
        )
        .all(weekAgo);

      return {
        events: {
          total: eventStats.total_events || 0,
          today: eventStats.events_today || 0,
          thisWeek: eventStats.events_this_week || 0,
        },
        patterns: {
          total: patternStats.total_patterns || 0,
          active: patternStats.active_patterns || 0,
          confirmed: patternStats.confirmed_patterns || 0,
          avgConfidence: patternStats.avg_confidence || 0,
        },
        recommendations: {
          total: recStats.total_recommendations || 0,
          active: recStats.active_recommendations || 0,
          accepted: recStats.total_accepted || 0,
          dismissed: recStats.total_dismissed || 0,
        },
        topFeatures,
        currentSessionId: this.currentSessionId,
      };
    } catch (error) {
      logger.error("[BehaviorTracker] Failed to get stats:", error);
      return {};
    }
  }

  /**
   * Start a new session
   * @returns {string} New session ID
   */
  startNewSession() {
    this.currentSessionId = uuidv4();
    this.recentEvents = [];
    logger.info(
      `[BehaviorTracker] New session started: ${this.currentSessionId}`,
    );
    return this.currentSessionId;
  }
}

module.exports = {
  BehaviorTracker,
};
