/**
 * User Preference Learner
 *
 * Extracts and maintains user preferences from interactions.
 * Supports 6 categories of preferences with confidence scoring,
 * evidence-based learning, and formatted context for LLM prompt injection.
 *
 * @module llm/user-preference-learner
 * @version 1.0.0
 * @since 2026-02-23
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Valid preference categories
 */
const PREFERENCE_CATEGORIES = [
  "communication_style",
  "code_style",
  "response_format",
  "domain_expertise",
  "tool_preferences",
  "language",
];

/**
 * Valid preference sources
 */
const PREFERENCE_SOURCES = ["explicit", "inferred", "feedback"];

/**
 * Confidence bounds
 */
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.99;
const DEFAULT_CONFIDENCE = 0.5;

/**
 * Confidence increment per additional evidence observation (diminishing returns)
 */
const CONFIDENCE_INCREMENT_BASE = 0.1;

/**
 * Keyword heuristics for extracting preferences from interactions.
 * Each entry maps a regex pattern to a preference extraction.
 */
const EXTRACTION_RULES = [
  // Code style preferences
  {
    pattern: /\b(?:use|prefer|want)\s+typescript\b/i,
    category: "code_style",
    key: "language_preference",
    value: "TypeScript",
  },
  {
    pattern: /\b(?:use|prefer|want)\s+javascript\b/i,
    category: "code_style",
    key: "language_preference",
    value: "JavaScript",
  },
  {
    pattern: /\b(?:use|prefer|want)\s+python\b/i,
    category: "code_style",
    key: "language_preference",
    value: "Python",
  },
  {
    pattern: /\b(?:use|prefer|want)\s+rust\b/i,
    category: "code_style",
    key: "language_preference",
    value: "Rust",
  },
  {
    pattern: /\b(?:use|prefer|want)\s+go(?:lang)?\b/i,
    category: "code_style",
    key: "language_preference",
    value: "Go",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:functional|fp)\s+(?:style|programming)\b/i,
    category: "code_style",
    key: "paradigm",
    value: "functional",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:oop|object[- ]oriented)\b/i,
    category: "code_style",
    key: "paradigm",
    value: "object-oriented",
  },
  {
    pattern: /\bno\s+comments?\b/i,
    category: "code_style",
    key: "comments",
    value: "minimal",
  },
  {
    pattern: /\b(?:add|include|write)\s+comments?\b/i,
    category: "code_style",
    key: "comments",
    value: "verbose",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:tabs?|tab\s+indent)/i,
    category: "code_style",
    key: "indentation",
    value: "tabs",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:spaces?|2\s*space|4\s*space)/i,
    category: "code_style",
    key: "indentation",
    value: "spaces",
  },

  // Communication style preferences
  {
    pattern: /\b(?:be\s+)?(?:concise|brief|short|terse)\b/i,
    category: "communication_style",
    key: "verbosity",
    value: "concise",
  },
  {
    pattern: /\b(?:be\s+)?(?:detailed|verbose|thorough|comprehensive)\b/i,
    category: "communication_style",
    key: "verbosity",
    value: "detailed",
  },
  {
    pattern: /\b(?:explain|eli5|simple\s+terms?)\b/i,
    category: "communication_style",
    key: "explanation_level",
    value: "beginner-friendly",
  },
  {
    pattern: /\b(?:no\s+fluff|straight\s+to\s+(?:the\s+)?point|just\s+(?:the\s+)?code)\b/i,
    category: "communication_style",
    key: "style",
    value: "direct",
  },

  // Response format preferences
  {
    pattern: /\b(?:use|format\s+(?:as|with))\s+markdown\b/i,
    category: "response_format",
    key: "format",
    value: "markdown",
  },
  {
    pattern: /\b(?:use|format\s+(?:as|with))\s+(?:plain\s*text|no\s+formatting)\b/i,
    category: "response_format",
    key: "format",
    value: "plain_text",
  },
  {
    pattern: /\b(?:include|add|show)\s+(?:code\s+)?examples?\b/i,
    category: "response_format",
    key: "examples",
    value: "always_include",
  },
  {
    pattern: /\b(?:use|show)\s+(?:bullet\s+)?(?:points?|lists?)\b/i,
    category: "response_format",
    key: "structure",
    value: "bullet_points",
  },
  {
    pattern: /\bstep[- ]by[- ]step\b/i,
    category: "response_format",
    key: "structure",
    value: "step_by_step",
  },

  // Tool preferences
  {
    pattern: /\b(?:use|prefer)\s+(?:vim|neovim|nvim)\b/i,
    category: "tool_preferences",
    key: "editor",
    value: "vim",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:vscode|vs\s*code)\b/i,
    category: "tool_preferences",
    key: "editor",
    value: "vscode",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:docker|containers?)\b/i,
    category: "tool_preferences",
    key: "deployment",
    value: "docker",
  },
  {
    pattern: /\b(?:use|prefer)\s+(?:git|github|gitlab)\b/i,
    category: "tool_preferences",
    key: "vcs",
    value: "git",
  },

  // Language preferences (natural language)
  {
    pattern: /\b(?:respond|answer|reply)\s+(?:in\s+)?chinese\b/i,
    category: "language",
    key: "response_language",
    value: "Chinese",
  },
  {
    pattern: /\b(?:respond|answer|reply)\s+(?:in\s+)?english\b/i,
    category: "language",
    key: "response_language",
    value: "English",
  },
  {
    pattern: /\b(?:respond|answer|reply)\s+(?:in\s+)?japanese\b/i,
    category: "language",
    key: "response_language",
    value: "Japanese",
  },
  {
    pattern: /\b(?:respond|answer|reply)\s+(?:in\s+)?(?:chinese|中文)\b/i,
    category: "language",
    key: "response_language",
    value: "Chinese",
  },

  // Domain expertise
  {
    pattern: /\b(?:focus\s+on|specialize\s+in|expert\s+in)\s+(?:web\s+)?(?:frontend|front[- ]end)\b/i,
    category: "domain_expertise",
    key: "primary_domain",
    value: "frontend",
  },
  {
    pattern: /\b(?:focus\s+on|specialize\s+in|expert\s+in)\s+(?:web\s+)?(?:backend|back[- ]end)\b/i,
    category: "domain_expertise",
    key: "primary_domain",
    value: "backend",
  },
  {
    pattern: /\b(?:focus\s+on|specialize\s+in|expert\s+in)\s+(?:ml|machine\s+learning|ai|deep\s+learning)\b/i,
    category: "domain_expertise",
    key: "primary_domain",
    value: "machine_learning",
  },
  {
    pattern: /\b(?:focus\s+on|specialize\s+in|expert\s+in)\s+(?:devops|infrastructure|sre)\b/i,
    category: "domain_expertise",
    key: "primary_domain",
    value: "devops",
  },
];

/**
 * UserPreferenceLearner - Extracts, stores, and retrieves user preferences
 */
class UserPreferenceLearner {
  /**
   * Create a UserPreferenceLearner
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance
   */
  constructor(options = {}) {
    this.db = options.database || null;
    this.initialized = false;
  }

  /**
   * Initialize the learner and create the database table
   * @param {Object} [database] - Database instance (overrides constructor)
   */
  async initialize(database) {
    if (database) {
      this.db = database;
    }

    if (!this.db) {
      logger.warn(
        "[UserPreferenceLearner] No database provided, cannot initialize",
      );
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL CHECK(category IN ('communication_style','code_style','response_format','domain_expertise','tool_preferences','language')),
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          confidence REAL DEFAULT 0.5,
          source TEXT DEFAULT 'inferred' CHECK(source IN ('explicit','inferred','feedback')),
          evidence_count INTEGER DEFAULT 1,
          last_seen_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(category, key)
        );
        CREATE INDEX IF NOT EXISTS idx_user_preferences_category ON user_preferences(category);
      `);

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      this.initialized = true;
      logger.info("[UserPreferenceLearner] Initialized successfully");
    } catch (error) {
      logger.error(
        "[UserPreferenceLearner] Initialization error:",
        error.message,
      );
      throw error;
    }
  }

  /**
   * Get user preferences, optionally filtered by category
   * @param {string} [category] - Filter by category
   * @returns {Array} List of preference objects
   */
  getPreferences(category) {
    if (!this.db) {
      logger.warn("[UserPreferenceLearner] Database not available");
      return [];
    }

    try {
      let rows;
      if (category) {
        if (!PREFERENCE_CATEGORIES.includes(category)) {
          logger.warn(
            `[UserPreferenceLearner] Invalid category: ${category}`,
          );
          return [];
        }
        rows = this.db
          .prepare(
            `SELECT * FROM user_preferences WHERE category = ? ORDER BY confidence DESC, evidence_count DESC`,
          )
          .all(category);
      } else {
        rows = this.db
          .prepare(
            `SELECT * FROM user_preferences ORDER BY confidence DESC, evidence_count DESC`,
          )
          .all();
      }

      return rows.map(this._rowToPreference);
    } catch (error) {
      logger.error(
        "[UserPreferenceLearner] getPreferences error:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Update or insert a user preference
   * If the preference (category, key) already exists, increment evidence_count and adjust confidence.
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @param {string} value - Preference value
   * @param {string} [source='inferred'] - Source of the preference
   * @returns {Object|null} The updated or created preference
   */
  updatePreference(category, key, value, source = "inferred") {
    if (!this.db) {
      logger.warn("[UserPreferenceLearner] Database not available");
      return null;
    }

    if (!category || !key || value === undefined || value === null) {
      logger.warn(
        "[UserPreferenceLearner] category, key, and value are required",
      );
      return null;
    }

    if (!PREFERENCE_CATEGORIES.includes(category)) {
      logger.warn(
        `[UserPreferenceLearner] Invalid category: ${category}`,
      );
      return null;
    }

    if (!PREFERENCE_SOURCES.includes(source)) {
      source = "inferred";
    }

    const now = Date.now();

    try {
      // Check if preference already exists
      const existing = this.db
        .prepare(
          `SELECT * FROM user_preferences WHERE category = ? AND key = ?`,
        )
        .get(category, key);

      if (existing) {
        // Update existing: increment evidence_count and adjust confidence
        const newEvidenceCount = existing.evidence_count + 1;
        const confidenceBoost =
          CONFIDENCE_INCREMENT_BASE / Math.sqrt(newEvidenceCount);
        let newConfidence = existing.confidence + confidenceBoost;
        newConfidence = Math.max(
          MIN_CONFIDENCE,
          Math.min(MAX_CONFIDENCE, newConfidence),
        );

        // If value changed, reduce confidence slightly
        const valueStr = String(value);
        if (existing.value !== valueStr) {
          newConfidence = Math.max(MIN_CONFIDENCE, newConfidence - 0.1);
        }

        // Explicit source always gets a confidence boost
        if (source === "explicit") {
          newConfidence = Math.min(MAX_CONFIDENCE, newConfidence + 0.15);
        }

        this.db.run(
          `UPDATE user_preferences
           SET value = ?, confidence = ?, source = ?, evidence_count = ?, last_seen_at = ?, updated_at = ?
           WHERE category = ? AND key = ?`,
          [valueStr, newConfidence, source, newEvidenceCount, now, now, category, key],
        );

        if (this.db.saveToFile) {
          this.db.saveToFile();
        }

        const updated = {
          id: existing.id,
          category,
          key,
          value: valueStr,
          confidence: newConfidence,
          source,
          evidenceCount: newEvidenceCount,
          lastSeenAt: now,
          createdAt: existing.created_at,
          updatedAt: now,
        };

        logger.debug(
          `[UserPreferenceLearner] Updated preference: ${category}/${key} = ${valueStr} (confidence: ${newConfidence.toFixed(2)}, evidence: ${newEvidenceCount})`,
        );
        return updated;
      } else {
        // Insert new preference
        const id = uuidv4();
        const initialConfidence =
          source === "explicit" ? 0.8 : DEFAULT_CONFIDENCE;

        this.db.run(
          `INSERT INTO user_preferences (id, category, key, value, confidence, source, evidence_count, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [id, category, key, String(value), initialConfidence, source, now, now, now],
        );

        if (this.db.saveToFile) {
          this.db.saveToFile();
        }

        const created = {
          id,
          category,
          key,
          value: String(value),
          confidence: initialConfidence,
          source,
          evidenceCount: 1,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };

        logger.debug(
          `[UserPreferenceLearner] Created preference: ${category}/${key} = ${value}`,
        );
        return created;
      }
    } catch (error) {
      logger.error(
        "[UserPreferenceLearner] updatePreference error:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Delete a specific preference by ID
   * @param {string} id - Preference ID
   * @returns {boolean} Whether the deletion succeeded
   */
  deletePreference(id) {
    if (!this.db) {
      logger.warn("[UserPreferenceLearner] Database not available");
      return false;
    }

    if (!id) {
      logger.warn("[UserPreferenceLearner] Preference ID is required");
      return false;
    }

    try {
      const result = this.db.run(
        `DELETE FROM user_preferences WHERE id = ?`,
        [id],
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      const deleted = result && result.changes ? result.changes > 0 : true;
      logger.debug(`[UserPreferenceLearner] Deleted preference: ${id}`);
      return deleted;
    } catch (error) {
      logger.error(
        "[UserPreferenceLearner] deletePreference error:",
        error.message,
      );
      return false;
    }
  }

  /**
   * Analyze an interaction to infer user preferences using keyword heuristics
   * @param {string} userMessage - The user's message
   * @param {string} [assistantResponse] - The assistant's response
   * @param {number} [feedback=0] - Feedback score (-1, 0, 1)
   * @returns {Array} Array of extracted preference objects
   */
  extractPreferencesFromInteraction(userMessage, assistantResponse, feedback = 0) {
    if (!userMessage || typeof userMessage !== "string") {
      return [];
    }

    const extracted = [];
    const textToAnalyze = userMessage;

    // Apply extraction rules against the user message
    for (const rule of EXTRACTION_RULES) {
      if (rule.pattern.test(textToAnalyze)) {
        extracted.push({
          category: rule.category,
          key: rule.key,
          value: rule.value,
          source: "inferred",
        });
      }
    }

    // If feedback is positive and there's an assistant response, infer format preferences
    if (feedback > 0 && assistantResponse) {
      // Check if response used code blocks
      if (assistantResponse.includes("```")) {
        extracted.push({
          category: "response_format",
          key: "code_blocks",
          value: "preferred",
          source: "feedback",
        });
      }

      // Check if response used bullet points
      if (/^[\s]*[-*]\s/m.test(assistantResponse)) {
        extracted.push({
          category: "response_format",
          key: "bullet_points",
          value: "preferred",
          source: "feedback",
        });
      }

      // Check if response used numbered lists
      if (/^[\s]*\d+\.\s/m.test(assistantResponse)) {
        extracted.push({
          category: "response_format",
          key: "numbered_lists",
          value: "preferred",
          source: "feedback",
        });
      }
    }

    // If feedback is negative, note what was NOT preferred
    if (feedback < 0 && assistantResponse) {
      if (assistantResponse.length > 2000) {
        extracted.push({
          category: "communication_style",
          key: "verbosity",
          value: "concise",
          source: "feedback",
        });
      }
    }

    // Persist extracted preferences to the database
    for (const pref of extracted) {
      this.updatePreference(pref.category, pref.key, pref.value, pref.source);
    }

    logger.debug(
      `[UserPreferenceLearner] Extracted ${extracted.length} preferences from interaction`,
    );
    return extracted;
  }

  /**
   * Build a formatted string of top preferences for LLM prompt injection
   * @param {number} [limit=10] - Maximum number of preferences to include
   * @returns {string} Formatted preference context string
   */
  buildPreferenceContext(limit = 10) {
    if (!this.db) {
      return "";
    }

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM user_preferences
           WHERE confidence >= ?
           ORDER BY confidence DESC, evidence_count DESC
           LIMIT ?`,
        )
        .all(MIN_CONFIDENCE + 0.1, limit);

      if (rows.length === 0) {
        return "";
      }

      const parts = ["## User Preferences"];

      // Group by category
      const grouped = {};
      for (const row of rows) {
        if (!grouped[row.category]) {
          grouped[row.category] = [];
        }
        grouped[row.category].push(row);
      }

      for (const [category, prefs] of Object.entries(grouped)) {
        const categoryLabel = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        parts.push(`\n### ${categoryLabel}`);
        for (const pref of prefs) {
          const confidenceStr = `${Math.round(pref.confidence * 100)}%`;
          parts.push(
            `- ${pref.key}: ${pref.value} (confidence: ${confidenceStr}, seen ${pref.evidence_count}x)`,
          );
        }
      }

      const context = parts.join("\n");
      logger.debug(
        `[UserPreferenceLearner] Built preference context: ${context.length} chars, ${rows.length} preferences`,
      );
      return context;
    } catch (error) {
      logger.error(
        "[UserPreferenceLearner] buildPreferenceContext error:",
        error.message,
      );
      return "";
    }
  }

  /**
   * Convert a database row to a preference object
   * @param {Object} row - Database row
   * @returns {Object} Preference object
   * @private
   */
  _rowToPreference(row) {
    return {
      id: row.id,
      category: row.category,
      key: row.key,
      value: row.value,
      confidence: row.confidence,
      source: row.source,
      evidenceCount: row.evidence_count,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = {
  UserPreferenceLearner,
  PREFERENCE_CATEGORIES,
  PREFERENCE_SOURCES,
  EXTRACTION_RULES,
};
