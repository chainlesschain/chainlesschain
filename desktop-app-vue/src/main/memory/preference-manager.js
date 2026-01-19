/**
 * PreferenceManager - User Preference Management
 *
 * Manages user preferences, usage history, and search history.
 * Integrates with the Memory Bank system for persistent storage.
 *
 * Features:
 * - CRUD operations for preferences by category/key
 * - Usage history recording and analysis
 * - Search history with suggestions
 * - File-based backup to .chainlesschain/memory/preferences/
 *
 * @module preference-manager
 * @version 1.0.0
 * @since 2026-01-17
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * PreferenceManager class
 */
class PreferenceManager extends EventEmitter {
  /**
   * Create a PreferenceManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.preferencesDir - Directory for preference backups
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[PreferenceManager] database parameter is required");
    }

    this.db = options.database;
    this.preferencesDir =
      options.preferencesDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "preferences");

    // In-memory cache for fast access
    this.cache = new Map();
    this.cacheInitialized = false;

    // Default preference categories
    this.defaultCategories = ["ui", "feature", "llm", "search", "system"];

    logger.info("[PreferenceManager] Initialized", {
      preferencesDir: this.preferencesDir,
    });
  }

  /**
   * Initialize the manager (ensure tables and directories exist)
   */
  async initialize() {
    try {
      // Ensure directory exists
      await fs.mkdir(this.preferencesDir, { recursive: true });

      // Ensure tables exist
      await this._ensureTables();

      // Load preferences into cache
      await this._loadCache();

      logger.info("[PreferenceManager] Initialization complete");
    } catch (error) {
      logger.error("[PreferenceManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Ensure database tables exist
   * @private
   */
  async _ensureTables() {
    try {
      // Check if user_preferences table exists
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='user_preferences'
      `);
      const exists = tableCheck.get();

      if (!exists) {
        // Create tables
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS user_preferences (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            value_type TEXT DEFAULT 'string',
            description TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(category, key)
          )
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_user_preferences_category
          ON user_preferences(category)
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS usage_history (
            id TEXT PRIMARY KEY,
            feature TEXT NOT NULL,
            action TEXT,
            metadata TEXT,
            duration_ms INTEGER,
            success INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_usage_history_feature
          ON usage_history(feature)
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_usage_history_created
          ON usage_history(created_at DESC)
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS search_history (
            id TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            context TEXT,
            result_count INTEGER DEFAULT 0,
            selected_result TEXT,
            selected_position INTEGER,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_search_history_query
          ON search_history(query)
        `,
          )
          .run();

        this.db
          .prepare(
            `
          CREATE INDEX IF NOT EXISTS idx_search_history_created
          ON search_history(created_at DESC)
        `,
          )
          .run();

        logger.info("[PreferenceManager] Database tables created");
      }
    } catch (error) {
      logger.error("[PreferenceManager] Failed to ensure tables:", error);
      throw error;
    }
  }

  /**
   * Load all preferences into cache
   * @private
   */
  async _loadCache() {
    try {
      const stmt = this.db.prepare(`
        SELECT category, key, value, value_type
        FROM user_preferences
      `);
      const rows = stmt.all();

      this.cache.clear();

      for (const row of rows) {
        const cacheKey = `${row.category}:${row.key}`;
        try {
          this.cache.set(cacheKey, JSON.parse(row.value));
        } catch {
          this.cache.set(cacheKey, row.value);
        }
      }

      this.cacheInitialized = true;
      logger.info(`[PreferenceManager] Loaded ${rows.length} preferences`);
    } catch (error) {
      logger.error("[PreferenceManager] Failed to load cache:", error);
    }
  }

  // ============================================================
  // CRUD Operations
  // ============================================================

  /**
   * Get a preference value
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @param {*} defaultValue - Default value if not found
   * @returns {Promise<*>} The preference value
   */
  async get(category, key, defaultValue = null) {
    try {
      // Check cache first
      const cacheKey = `${category}:${key}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Query database
      const stmt = this.db.prepare(`
        SELECT value, value_type
        FROM user_preferences
        WHERE category = ? AND key = ?
      `);
      const row = stmt.get(category, key);

      if (!row) {
        return defaultValue;
      }

      try {
        const value = JSON.parse(row.value);
        this.cache.set(cacheKey, value);
        return value;
      } catch {
        this.cache.set(cacheKey, row.value);
        return row.value;
      }
    } catch (error) {
      logger.error(
        `[PreferenceManager] Failed to get ${category}:${key}:`,
        error,
      );
      return defaultValue;
    }
  }

  /**
   * Set a preference value
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @param {*} value - The value to set
   * @param {Object} options - Additional options
   * @param {string} [options.description] - Description of the preference
   * @returns {Promise<boolean>} Success status
   */
  async set(category, key, value, options = {}) {
    try {
      const now = Date.now();
      const id = uuidv4();
      const valueType = Array.isArray(value)
        ? "array"
        : typeof value === "object"
          ? "object"
          : typeof value;
      const serializedValue = JSON.stringify(value);

      // Upsert the preference
      const stmt = this.db.prepare(`
        INSERT INTO user_preferences (id, category, key, value, value_type, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(category, key) DO UPDATE SET
          value = excluded.value,
          value_type = excluded.value_type,
          description = COALESCE(excluded.description, description),
          updated_at = excluded.updated_at
      `);

      stmt.run(
        id,
        category,
        key,
        serializedValue,
        valueType,
        options.description || null,
        now,
        now,
      );

      // Update cache
      const cacheKey = `${category}:${key}`;
      this.cache.set(cacheKey, value);

      // Emit event
      this.emit("preference-changed", { category, key, value });

      // Backup to file (async, don't wait)
      this._backupCategory(category).catch((err) => {
        logger.warn("[PreferenceManager] Backup failed:", err.message);
      });

      return true;
    } catch (error) {
      logger.error(
        `[PreferenceManager] Failed to set ${category}:${key}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Delete a preference
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @returns {Promise<boolean>} Success status
   */
  async delete(category, key) {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM user_preferences
        WHERE category = ? AND key = ?
      `);
      stmt.run(category, key);

      // Remove from cache
      const cacheKey = `${category}:${key}`;
      this.cache.delete(cacheKey);

      this.emit("preference-deleted", { category, key });
      return true;
    } catch (error) {
      logger.error(
        `[PreferenceManager] Failed to delete ${category}:${key}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get all preferences in a category
   * @param {string} category - Preference category
   * @returns {Promise<Object>} Object with all key-value pairs
   */
  async getCategory(category) {
    try {
      const stmt = this.db.prepare(`
        SELECT key, value, value_type
        FROM user_preferences
        WHERE category = ?
      `);
      const rows = stmt.all(category);

      const result = {};
      for (const row of rows) {
        try {
          result[row.key] = JSON.parse(row.value);
        } catch {
          result[row.key] = row.value;
        }
      }

      return result;
    } catch (error) {
      logger.error(
        `[PreferenceManager] Failed to get category ${category}:`,
        error,
      );
      return {};
    }
  }

  /**
   * Set multiple preferences in a category
   * @param {string} category - Preference category
   * @param {Object} values - Object with key-value pairs
   * @returns {Promise<boolean>} Success status
   */
  async setCategory(category, values) {
    try {
      for (const [key, value] of Object.entries(values)) {
        await this.set(category, key, value);
      }
      return true;
    } catch (error) {
      logger.error(
        `[PreferenceManager] Failed to set category ${category}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get all preferences
   * @returns {Promise<Object>} Object with categories as keys
   */
  async getAll() {
    try {
      const stmt = this.db.prepare(`
        SELECT category, key, value, value_type
        FROM user_preferences
        ORDER BY category, key
      `);
      const rows = stmt.all();

      const result = {};
      for (const row of rows) {
        if (!result[row.category]) {
          result[row.category] = {};
        }
        try {
          result[row.category][row.key] = JSON.parse(row.value);
        } catch {
          result[row.category][row.key] = row.value;
        }
      }

      return result;
    } catch (error) {
      logger.error(
        "[PreferenceManager] Failed to get all preferences:",
        error,
      );
      return {};
    }
  }

  // ============================================================
  // Usage History
  // ============================================================

  /**
   * Record a feature usage event
   * @param {string} feature - Feature name
   * @param {Object} options - Additional options
   * @param {string} [options.action] - Action performed
   * @param {Object} [options.metadata] - Additional metadata
   * @param {number} [options.durationMs] - Duration in milliseconds
   * @param {boolean} [options.success=true] - Whether the action succeeded
   * @returns {Promise<string>} The usage record ID
   */
  async recordUsage(feature, options = {}) {
    try {
      const id = uuidv4();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO usage_history (id, feature, action, metadata, duration_ms, success, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        feature,
        options.action || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
        options.durationMs || null,
        options.success !== false ? 1 : 0,
        now,
      );

      this.emit("usage-recorded", { id, feature, action: options.action });
      return id;
    } catch (error) {
      logger.error(`[PreferenceManager] Failed to record usage:`, error);
      throw error;
    }
  }

  /**
   * Get recent usage history
   * @param {Object} options - Query options
   * @param {string} [options.feature] - Filter by feature
   * @param {number} [options.limit=50] - Maximum records
   * @param {number} [options.days=7] - Number of days to look back
   * @returns {Promise<Array>} Usage records
   */
  async getRecentHistory(options = {}) {
    const { feature, limit = 50, days = 7 } = options;

    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      let sql = `
        SELECT id, feature, action, metadata, duration_ms, success, created_at
        FROM usage_history
        WHERE created_at > ?
      `;
      const params = [cutoff];

      if (feature) {
        sql += " AND feature = ?";
        params.push(feature);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        feature: row.feature,
        action: row.action,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        durationMs: row.duration_ms,
        success: row.success === 1,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error("[PreferenceManager] Failed to get history:", error);
      return [];
    }
  }

  /**
   * Get usage statistics
   * @param {Object} options - Query options
   * @param {number} [options.days=7] - Number of days to analyze
   * @returns {Promise<Object>} Usage statistics
   */
  async getUsageStats(options = {}) {
    const { days = 7 } = options;

    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      const stmt = this.db.prepare(`
        SELECT
          feature,
          action,
          COUNT(*) as count,
          AVG(duration_ms) as avg_duration,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
        FROM usage_history
        WHERE created_at > ?
        GROUP BY feature, action
        ORDER BY count DESC
      `);

      const rows = stmt.all(cutoff);

      return {
        period: { days, from: cutoff, to: Date.now() },
        features: rows.map((row) => ({
          feature: row.feature,
          action: row.action,
          count: row.count,
          avgDuration: row.avg_duration,
          successRate: row.success_rate,
        })),
      };
    } catch (error) {
      logger.error("[PreferenceManager] Failed to get usage stats:", error);
      return { period: { days }, features: [] };
    }
  }

  // ============================================================
  // Search History
  // ============================================================

  /**
   * Add a search query to history
   * @param {string} query - The search query
   * @param {Object} options - Additional options
   * @param {string} [options.context] - Search context
   * @param {number} [options.resultCount=0] - Number of results
   * @param {string} [options.selectedResult] - Selected result ID/title
   * @param {number} [options.selectedPosition] - Position of selected result
   * @returns {Promise<string>} The search record ID
   */
  async addSearchHistory(query, options = {}) {
    try {
      const id = uuidv4();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO search_history (id, query, context, result_count, selected_result, selected_position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        query,
        options.context || null,
        options.resultCount || 0,
        options.selectedResult || null,
        options.selectedPosition || null,
        now,
      );

      return id;
    } catch (error) {
      logger.error("[PreferenceManager] Failed to add search history:", error);
      throw error;
    }
  }

  /**
   * Get search history
   * @param {Object} options - Query options
   * @param {string} [options.context] - Filter by context
   * @param {number} [options.limit=20] - Maximum records
   * @returns {Promise<Array>} Search records
   */
  async getSearchHistory(options = {}) {
    const { context, limit = 20 } = options;

    try {
      let sql = `
        SELECT id, query, context, result_count, selected_result, selected_position, created_at
        FROM search_history
      `;
      const params = [];

      if (context) {
        sql += " WHERE context = ?";
        params.push(context);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      logger.error("[PreferenceManager] Failed to get search history:", error);
      return [];
    }
  }

  /**
   * Get search suggestions based on history
   * @param {string} prefix - Query prefix
   * @param {Object} options - Options
   * @param {number} [options.limit=5] - Maximum suggestions
   * @returns {Promise<Array>} Search suggestions
   */
  async getSearchSuggestions(prefix, options = {}) {
    const { limit = 5 } = options;

    try {
      const stmt = this.db.prepare(`
        SELECT query, COUNT(*) as count
        FROM search_history
        WHERE query LIKE ?
        GROUP BY query
        ORDER BY count DESC, MAX(created_at) DESC
        LIMIT ?
      `);

      const rows = stmt.all(`${prefix}%`, limit);
      return rows.map((row) => ({
        query: row.query,
        count: row.count,
      }));
    } catch (error) {
      logger.error("[PreferenceManager] Failed to get suggestions:", error);
      return [];
    }
  }

  /**
   * Clear search history
   * @param {Object} options - Options
   * @param {number} [options.olderThanDays] - Clear records older than N days
   * @returns {Promise<number>} Number of deleted records
   */
  async clearSearchHistory(options = {}) {
    try {
      let sql = "DELETE FROM search_history";
      const params = [];

      if (options.olderThanDays) {
        const cutoff = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000;
        sql += " WHERE created_at < ?";
        params.push(cutoff);
      }

      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);

      logger.info(
        `[PreferenceManager] Cleared ${result.changes} search records`,
      );
      return result.changes;
    } catch (error) {
      logger.error("[PreferenceManager] Failed to clear history:", error);
      return 0;
    }
  }

  // ============================================================
  // File-based Backup
  // ============================================================

  /**
   * Backup a category to file
   * @private
   * @param {string} category - Category to backup
   */
  async _backupCategory(category) {
    try {
      const prefs = await this.getCategory(category);
      const filePath = path.join(this.preferencesDir, `${category}.json`);
      await fs.writeFile(filePath, JSON.stringify(prefs, null, 2), "utf-8");
    } catch (error) {
      logger.error(
        `[PreferenceManager] Backup failed for ${category}:`,
        error,
      );
    }
  }

  /**
   * Backup all preferences to files
   * @returns {Promise<Object>} Backup result
   */
  async backupAll() {
    try {
      const all = await this.getAll();
      const results = {};

      for (const category of Object.keys(all)) {
        try {
          const filePath = path.join(this.preferencesDir, `${category}.json`);
          await fs.writeFile(
            filePath,
            JSON.stringify(all[category], null, 2),
            "utf-8",
          );
          results[category] = { success: true };
        } catch (err) {
          results[category] = { success: false, error: err.message };
        }
      }

      logger.info("[PreferenceManager] Backup complete");
      return { success: true, categories: results };
    } catch (error) {
      logger.error("[PreferenceManager] Backup all failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Restore preferences from backup files
   * @param {Object} options - Options
   * @param {boolean} [options.overwrite=false] - Overwrite existing preferences
   * @returns {Promise<Object>} Restore result
   */
  async restoreFromBackup(options = {}) {
    const { overwrite = false } = options;

    try {
      const files = await fs.readdir(this.preferencesDir);
      const results = {};

      for (const file of files) {
        if (!file.endsWith(".json")) {continue;}

        const category = path.basename(file, ".json");

        try {
          const filePath = path.join(this.preferencesDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const prefs = JSON.parse(content);

          for (const [key, value] of Object.entries(prefs)) {
            const existing = await this.get(category, key);
            if (!existing || overwrite) {
              await this.set(category, key, value);
            }
          }

          results[category] = {
            success: true,
            restored: Object.keys(prefs).length,
          };
        } catch (err) {
          results[category] = { success: false, error: err.message };
        }
      }

      logger.info("[PreferenceManager] Restore complete");
      return { success: true, categories: results };
    } catch (error) {
      logger.error("[PreferenceManager] Restore failed:", error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Get statistics about stored preferences
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const prefStmt = this.db.prepare(`
        SELECT category, COUNT(*) as count
        FROM user_preferences
        GROUP BY category
      `);
      const prefStats = prefStmt.all();

      const usageStmt = this.db.prepare(`
        SELECT COUNT(*) as total FROM usage_history
      `);
      const usageCount = usageStmt.get();

      const searchStmt = this.db.prepare(`
        SELECT COUNT(*) as total FROM search_history
      `);
      const searchCount = searchStmt.get();

      return {
        preferences: {
          total: prefStats.reduce((sum, r) => sum + r.count, 0),
          byCategory: prefStats.reduce((acc, r) => {
            acc[r.category] = r.count;
            return acc;
          }, {}),
        },
        usageHistory: usageCount.total,
        searchHistory: searchCount.total,
        cacheSize: this.cache.size,
      };
    } catch (error) {
      logger.error("[PreferenceManager] Failed to get stats:", error);
      return {};
    }
  }

  /**
   * Clear the in-memory cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheInitialized = false;
    logger.info("[PreferenceManager] Cache cleared");
  }

  /**
   * Cleanup old records
   * @param {Object} options - Options
   * @param {number} [options.usageHistoryDays=90] - Keep usage records for N days
   * @param {number} [options.searchHistoryDays=30] - Keep search records for N days
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanup(options = {}) {
    const { usageHistoryDays = 90, searchHistoryDays = 30 } = options;

    try {
      const usageCutoff = Date.now() - usageHistoryDays * 24 * 60 * 60 * 1000;
      const searchCutoff = Date.now() - searchHistoryDays * 24 * 60 * 60 * 1000;

      const usageStmt = this.db.prepare(`
        DELETE FROM usage_history WHERE created_at < ?
      `);
      const usageResult = usageStmt.run(usageCutoff);

      const searchStmt = this.db.prepare(`
        DELETE FROM search_history WHERE created_at < ?
      `);
      const searchResult = searchStmt.run(searchCutoff);

      logger.info("[PreferenceManager] Cleanup complete:", {
        usageDeleted: usageResult.changes,
        searchDeleted: searchResult.changes,
      });

      return {
        success: true,
        usageDeleted: usageResult.changes,
        searchDeleted: searchResult.changes,
      };
    } catch (error) {
      logger.error("[PreferenceManager] Cleanup failed:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = {
  PreferenceManager,
};
