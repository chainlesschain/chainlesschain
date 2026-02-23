/**
 * Smart Conflict Resolver
 * Orchestrates Level 1→2→3 cascade conflict resolution
 * Conflict classification, pattern matching, user choice recording
 *
 * @module git/conflict-resolution/conflict-resolver
 * @version 1.2.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { RuleMerger, MERGE_RESULT } = require("./rule-merger");
const { ASTMerger } = require("./ast-merger");
const { LLMMerger } = require("./llm-merger");

// Conflict types
const CONFLICT_TYPE = {
  TEXT: "text",
  STRUCTURE: "structure",
  SEMANTIC: "semantic",
  BINARY: "binary",
  CONFIG: "config",
};

// Resolution levels
const RESOLUTION_LEVEL = {
  RULE: 1,
  AST: 2,
  LLM: 3,
  MANUAL: 4,
};

/**
 * SmartConflictResolver
 * Cascade resolution: Level 1 (rules) → Level 2 (AST) → Level 3 (LLM)
 */
class SmartConflictResolver extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} [options.llmManager] - LLM manager for Level 3
   * @param {Object} [options.database] - Database for pattern storage
   * @param {Object} [options.permanentMemory] - PermanentMemoryManager for experience export
   * @param {Object} [options.config] - Resolution configuration
   */
  constructor(options = {}) {
    super();
    this.db = options.database || null;
    this.permanentMemory = options.permanentMemory || null;

    // Initialize mergers
    this.ruleMerger = new RuleMerger(options.ruleOptions || {});
    this.astMerger = new ASTMerger(options.astOptions || {});
    this.llmMerger = new LLMMerger({
      llmManager: options.llmManager || null,
      ...(options.llmOptions || {}),
    });

    // Configuration
    this.config = {
      autoResolveLevel: 1, // Max level for auto-resolve without user confirmation
      aiAssistLevel: 3, // Max level to attempt
      confidenceThreshold: 0.85,
      learnFromUser: true,
      alwaysConfirm: [], // File patterns that always require confirmation
      ...(options.config || {}),
    };

    // Pattern cache (loaded from DB)
    this._patternCache = new Map();

    // Stats
    this._stats = {
      totalConflicts: 0,
      autoResolved: 0,
      level1Resolved: 0,
      level2Resolved: 0,
      level3Resolved: 0,
      manualResolved: 0,
      averageConfidence: 0,
    };
  }

  /**
   * Initialize the resolver (load patterns from DB)
   */
  async initialize() {
    await this._loadPatterns();
    logger.info(
      `[ConflictResolver] Initialized with ${this._patternCache.size} patterns`,
    );
  }

  /**
   * Resolve a single conflict
   * Cascades through Level 1 → Level 2 → Level 3
   *
   * @param {Object} conflict
   * @param {string} conflict.base - Common ancestor content
   * @param {string} conflict.local - Local version
   * @param {string} conflict.remote - Remote version
   * @param {string} conflict.filePath - File path
   * @returns {Promise<Object>} Resolution result
   */
  async resolve(conflict) {
    const startTime = Date.now();
    this._stats.totalConflicts++;

    const conflictId = uuidv4();
    const conflictType = this._classifyConflict(conflict);

    logger.info(
      `[ConflictResolver] Resolving conflict #${conflictId} (${conflictType}) for ${conflict.filePath}`,
    );

    // Check pattern library first
    const patternMatch = this._matchPattern(conflict);
    if (
      patternMatch &&
      patternMatch.confidence >= this.config.confidenceThreshold
    ) {
      logger.info(
        `[ConflictResolver] Pattern match found (confidence: ${patternMatch.confidence})`,
      );
      // Still run through the appropriate level for validation
    }

    let result = null;

    // Level 1: Rule-based merge
    if (this.config.aiAssistLevel >= RESOLUTION_LEVEL.RULE) {
      result = this.ruleMerger.merge(conflict);
      if (result.result === MERGE_RESULT.MERGED) {
        this._stats.level1Resolved++;
        this._stats.autoResolved++;

        const resolution = this._buildResolution(
          conflictId,
          conflict,
          result,
          RESOLUTION_LEVEL.RULE,
          startTime,
        );
        await this._recordResolution(resolution);
        this.emit("conflict:resolved", resolution);
        return resolution;
      }
    }

    // Level 2: AST-based merge
    if (this.config.aiAssistLevel >= RESOLUTION_LEVEL.AST) {
      result = this.astMerger.merge(conflict);
      if (result.result === MERGE_RESULT.MERGED) {
        this._stats.level2Resolved++;
        const autoAccept =
          result.confidence >= this.config.confidenceThreshold &&
          RESOLUTION_LEVEL.AST <= this.config.autoResolveLevel;

        if (autoAccept) {
          this._stats.autoResolved++;
        }

        const resolution = this._buildResolution(
          conflictId,
          conflict,
          result,
          RESOLUTION_LEVEL.AST,
          startTime,
        );
        resolution.autoAccepted = autoAccept;
        await this._recordResolution(resolution);
        this.emit("conflict:resolved", resolution);
        return resolution;
      }
    }

    // Level 3: LLM semantic merge
    if (this.config.aiAssistLevel >= RESOLUTION_LEVEL.LLM) {
      // Use note merge for markdown/knowledge files
      const isNote = conflict.filePath?.match(/\.(md|markdown|txt)$/i);
      if (isNote) {
        result = await this.llmMerger.mergeNotes(conflict);
      } else {
        result = await this.llmMerger.merge(conflict);
      }

      if (result.result === MERGE_RESULT.MERGED) {
        this._stats.level3Resolved++;
        const autoAccept =
          result.confidence >= this.config.confidenceThreshold &&
          RESOLUTION_LEVEL.LLM <= this.config.autoResolveLevel &&
          !this._requiresConfirmation(conflict.filePath);

        if (autoAccept) {
          this._stats.autoResolved++;
        }

        const resolution = this._buildResolution(
          conflictId,
          conflict,
          result,
          RESOLUTION_LEVEL.LLM,
          startTime,
        );
        resolution.autoAccepted = autoAccept;
        resolution.explanation = result.explanation;
        resolution.intentAnalysis = result.intentAnalysis;
        await this._recordResolution(resolution);
        this.emit("conflict:resolved", resolution);
        return resolution;
      }
    }

    // All levels failed - manual resolution needed
    this._stats.manualResolved++;
    const manualResolution = {
      id: conflictId,
      filePath: conflict.filePath,
      conflictType,
      level: RESOLUTION_LEVEL.MANUAL,
      autoResolved: false,
      autoAccepted: false,
      merged: null,
      strategy: "manual-required",
      confidence: 0,
      explanation:
        result?.explanation ||
        "Automatic merge could not resolve this conflict.",
      suggestion: result?.suggestion || null,
      duration: Date.now() - startTime,
    };

    await this._recordResolution(manualResolution);
    this.emit("conflict:manual-required", manualResolution);
    return manualResolution;
  }

  /**
   * Resolve multiple conflicts from a Git merge
   * @param {Array<Object>} conflicts
   * @returns {Promise<Object>} Summary of all resolutions
   */
  async resolveAll(conflicts) {
    const results = [];

    for (const conflict of conflicts) {
      try {
        const result = await this.resolve(conflict);
        results.push(result);
      } catch (error) {
        results.push({
          filePath: conflict.filePath,
          error: error.message,
          autoResolved: false,
        });
      }
    }

    const summary = {
      total: results.length,
      autoResolved: results.filter((r) => r.autoResolved).length,
      manualRequired: results.filter((r) => !r.autoResolved && !r.error).length,
      errors: results.filter((r) => r.error).length,
      results,
    };

    this.emit("conflicts:batch-complete", summary);
    return summary;
  }

  /**
   * Record user's manual choice (for learning)
   *
   * @param {string} conflictId
   * @param {string} chosenContent - The content the user chose
   * @param {string} choiceType - 'local' | 'remote' | 'merged' | 'custom'
   */
  async recordUserChoice(conflictId, chosenContent, choiceType) {
    if (!this.config.learnFromUser) {
      return;
    }

    try {
      // Update resolution history
      if (this.db) {
        this.db.run(
          `UPDATE conflict_resolution_history SET user_accepted = 1, merged_content = ? WHERE id = ?`,
          [chosenContent, conflictId],
        );
      }

      // Extract pattern from user choice
      await this._learnFromChoice(conflictId, chosenContent, choiceType);

      logger.info(
        `[ConflictResolver] User choice recorded for conflict ${conflictId}: ${choiceType}`,
      );
    } catch (error) {
      logger.warn(
        "[ConflictResolver] Failed to record user choice:",
        error.message,
      );
    }
  }

  // ==========================================
  // Conflict classification
  // ==========================================

  /**
   * Classify the type of conflict
   */
  _classifyConflict(conflict) {
    const { filePath } = conflict;
    if (!filePath) {
      return CONFLICT_TYPE.TEXT;
    }

    const ext = filePath.split(".").pop()?.toLowerCase();

    // Config files
    if (["json", "yaml", "yml", "toml", "ini"].includes(ext)) {
      return CONFLICT_TYPE.CONFIG;
    }

    // Code files
    if (["js", "ts", "py", "java", "go", "rs", "cpp", "c"].includes(ext)) {
      return CONFLICT_TYPE.STRUCTURE;
    }

    // Binary files
    if (["db", "sqlite", "bin", "exe", "dll", "so"].includes(ext)) {
      return CONFLICT_TYPE.BINARY;
    }

    return CONFLICT_TYPE.TEXT;
  }

  // ==========================================
  // Pattern library
  // ==========================================

  /**
   * Load patterns from database
   */
  async _loadPatterns() {
    if (!this.db) {
      return;
    }

    try {
      const patterns = this.db.all(
        `SELECT * FROM conflict_patterns WHERE confidence > 0.5 ORDER BY confidence DESC`,
      );

      for (const pattern of patterns) {
        this._patternCache.set(pattern.id, {
          ...pattern,
          metadata: JSON.parse(pattern.metadata || "{}"),
        });
      }
    } catch (error) {
      logger.warn("[ConflictResolver] Failed to load patterns:", error.message);
    }
  }

  /**
   * Match a conflict against known patterns
   */
  _matchPattern(conflict) {
    for (const [, pattern] of this._patternCache) {
      // Match by file pattern
      if (pattern.file_pattern) {
        const regex = new RegExp(pattern.file_pattern.replace(/\*/g, ".*"));
        if (!regex.test(conflict.filePath || "")) {
          continue;
        }
      }

      // Match by conflict type
      const conflictType = this._classifyConflict(conflict);
      if (pattern.pattern_type && pattern.pattern_type !== conflictType) {
        continue;
      }

      // Match by conflict signature (simplified content hash)
      if (pattern.conflict_signature) {
        const signature = this._generateSignature(conflict);
        if (signature !== pattern.conflict_signature) {
          continue;
        }
      }

      // Calculate confidence based on success rate
      const successRate =
        pattern.total_count > 0
          ? pattern.success_count / pattern.total_count
          : 0.5;

      return {
        patternId: pattern.id,
        strategy: pattern.resolution_strategy,
        confidence: Math.min(pattern.confidence, successRate),
      };
    }

    return null;
  }

  /**
   * Generate a signature for a conflict (for pattern matching)
   */
  _generateSignature(conflict) {
    const crypto = require("crypto");
    const content = `${conflict.filePath}:${this._classifyConflict(conflict)}`;
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Learn from user's resolution choice
   */
  async _learnFromChoice(conflictId, chosenContent, choiceType) {
    if (!this.db) {
      return;
    }

    try {
      // Get the original conflict data
      const history = this.db.get(
        `SELECT * FROM conflict_resolution_history WHERE id = ?`,
        [conflictId],
      );

      if (!history) {
        return;
      }

      // Create or update pattern
      const signature = this._generateSignature({
        filePath: history.file_path,
      });

      const existingPattern = this.db.get(
        `SELECT * FROM conflict_patterns WHERE conflict_signature = ?`,
        [signature],
      );

      if (existingPattern) {
        // Update existing pattern
        const wasSuccessful = choiceType !== "manual" ? 1 : 0;
        this.db.run(
          `UPDATE conflict_patterns
           SET success_count = success_count + ?,
               total_count = total_count + 1,
               confidence = CAST(success_count + ? AS REAL) / (total_count + 1),
               updated_at = datetime('now')
           WHERE id = ?`,
          [wasSuccessful, wasSuccessful, existingPattern.id],
        );
      } else {
        // Create new pattern
        this.db.run(
          `INSERT INTO conflict_patterns
           (id, pattern_type, file_pattern, conflict_signature, resolution_strategy, success_count, total_count, confidence)
           VALUES (?, ?, ?, ?, ?, 1, 1, 0.5)`,
          [
            uuidv4(),
            history.conflict_type,
            history.file_path?.replace(/[^/]+$/, "*"),
            signature,
            choiceType,
          ],
        );
      }
    } catch (error) {
      logger.warn("[ConflictResolver] Pattern learning failed:", error.message);
    }
  }

  // ==========================================
  // Permanent Memory Integration
  // ==========================================

  /**
   * Export resolution experience to permanent memory
   */
  async exportToMemory() {
    if (!this.permanentMemory || !this.db) {
      return;
    }

    try {
      const recentHistory = this.db.all(
        `SELECT * FROM conflict_resolution_history
         WHERE auto_resolved = 1 AND created_at > datetime('now', '-7 days')
         ORDER BY created_at DESC LIMIT 20`,
      );

      if (recentHistory.length === 0) {
        return;
      }

      const summary = recentHistory.map((h) => ({
        file: h.file_path,
        type: h.conflict_type,
        strategy: h.resolution_strategy,
        level: h.resolution_level,
        confidence: h.ai_confidence,
      }));

      await this.permanentMemory.appendToMemory?.(
        "MEMORY.md",
        `\n## Git Conflict Resolution Patterns (${new Date().toISOString().split("T")[0]})\n` +
          `Auto-resolved ${recentHistory.length} conflicts:\n` +
          summary
            .map(
              (s) =>
                `- ${s.file}: ${s.strategy} (L${s.level}, ${(s.confidence * 100).toFixed(0)}%)`,
            )
            .join("\n") +
          "\n",
      );

      logger.info(
        "[ConflictResolver] Exported resolution experience to permanent memory",
      );
    } catch (error) {
      logger.warn("[ConflictResolver] Memory export failed:", error.message);
    }
  }

  // ==========================================
  // Internal helpers
  // ==========================================

  _buildResolution(conflictId, conflict, result, level, startTime) {
    return {
      id: conflictId,
      filePath: conflict.filePath,
      conflictType: this._classifyConflict(conflict),
      level,
      autoResolved: true,
      merged: result.merged,
      strategy: result.strategy,
      confidence: result.confidence,
      duration: Date.now() - startTime,
    };
  }

  async _recordResolution(resolution) {
    if (!this.db) {
      return;
    }

    try {
      this.db.run(
        `INSERT INTO conflict_resolution_history
         (id, file_path, conflict_type, resolution_level, resolution_strategy,
          auto_resolved, ai_confidence, merged_content, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resolution.id,
          resolution.filePath,
          resolution.conflictType,
          resolution.level,
          resolution.strategy,
          resolution.autoResolved ? 1 : 0,
          resolution.confidence || null,
          resolution.merged || null,
          resolution.duration || 0,
        ],
      );
    } catch (error) {
      logger.warn(
        "[ConflictResolver] Failed to record resolution:",
        error.message,
      );
    }
  }

  _requiresConfirmation(filePath) {
    if (!filePath) {
      return false;
    }
    return this.config.alwaysConfirm.some((pattern) => {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(filePath);
    });
  }

  /**
   * Get resolver statistics
   */
  getStats() {
    const total = this._stats.totalConflicts || 1;
    return {
      ...this._stats,
      autoResolveRate: this._stats.autoResolved / total,
      patternCount: this._patternCache.size,
    };
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    this._patternCache.clear();
    this.removeAllListeners();
    logger.info("[ConflictResolver] Destroyed");
  }
}

module.exports = {
  SmartConflictResolver,
  CONFLICT_TYPE,
  RESOLUTION_LEVEL,
};
