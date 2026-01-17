/**
 * LearnedPatternManager - Learned Pattern Management
 *
 * Manages learned patterns from user interactions:
 * - Prompt patterns (successful prompts for reuse)
 * - Error fix patterns (learned error-fix associations)
 * - Code snippets (reusable code snippets)
 * - Workflow patterns (common user workflows)
 *
 * Integrates with ErrorMonitor for automatic pattern learning.
 *
 * @module learned-pattern-manager
 * @version 1.0.0
 * @since 2026-01-17
 */

const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * LearnedPatternManager class
 */
class LearnedPatternManager extends EventEmitter {
  /**
   * Create a LearnedPatternManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.patternsDir - Directory for pattern backups
   * @param {Object} [options.llmManager] - LLM Manager for AI-powered analysis
   * @param {Object} [options.errorMonitor] - ErrorMonitor for integration
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[LearnedPatternManager] database parameter is required");
    }

    this.db = options.database;
    this.patternsDir =
      options.patternsDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "learned-patterns");
    this.llmManager = options.llmManager || null;
    this.errorMonitor = options.errorMonitor || null;

    // Pattern categories
    this.categories = {
      prompt: "prompt_patterns",
      errorFix: "error_fix_patterns",
      snippet: "code_snippets",
      workflow: "workflow_patterns",
    };

    console.log("[LearnedPatternManager] Initialized", {
      patternsDir: this.patternsDir,
      hasLLM: !!this.llmManager,
      hasErrorMonitor: !!this.errorMonitor,
    });
  }

  /**
   * Initialize the manager
   */
  async initialize() {
    try {
      // Ensure directory exists
      await fs.mkdir(this.patternsDir, { recursive: true });

      // Ensure tables exist
      await this._ensureTables();

      console.log("[LearnedPatternManager] Initialization complete");
    } catch (error) {
      console.error("[LearnedPatternManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Ensure database tables exist
   * @private
   */
  async _ensureTables() {
    try {
      // Check if tables exist
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='prompt_patterns'
      `);
      const exists = tableCheck.get();

      if (!exists) {
        // Create prompt_patterns table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS prompt_patterns (
            id TEXT PRIMARY KEY,
            template TEXT NOT NULL,
            category TEXT,
            tags TEXT,
            use_count INTEGER DEFAULT 0,
            success_count INTEGER DEFAULT 0,
            preferred_model TEXT,
            avg_response_quality REAL,
            example_input TEXT,
            example_output TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create error_fix_patterns table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS error_fix_patterns (
            id TEXT PRIMARY KEY,
            error_pattern TEXT NOT NULL,
            error_classification TEXT,
            error_message_sample TEXT,
            fix_strategy TEXT NOT NULL,
            fix_steps TEXT,
            fix_code TEXT,
            success_count INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0,
            confidence REAL,
            auto_apply INTEGER DEFAULT 0,
            source TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            last_applied_at INTEGER,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create code_snippets table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS code_snippets (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            language TEXT NOT NULL,
            code TEXT NOT NULL,
            tags TEXT,
            use_count INTEGER DEFAULT 0,
            source TEXT,
            source_url TEXT,
            is_favorite INTEGER DEFAULT 0,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create workflow_patterns table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS workflow_patterns (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            steps TEXT NOT NULL,
            trigger_context TEXT,
            use_count INTEGER DEFAULT 0,
            completion_rate REAL,
            avg_duration_ms INTEGER,
            category TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create indexes
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_prompt_patterns_category ON prompt_patterns(category)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_prompt_patterns_use_count ON prompt_patterns(use_count DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_error_fix_patterns_classification ON error_fix_patterns(error_classification)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_code_snippets_language ON code_snippets(language)`,
          )
          .run();

        console.log("[LearnedPatternManager] Database tables created");
      }
    } catch (error) {
      console.error("[LearnedPatternManager] Failed to ensure tables:", error);
      throw error;
    }
  }

  // ============================================================
  // Prompt Patterns
  // ============================================================

  /**
   * Record a prompt pattern
   * @param {Object} params - Pattern parameters
   * @param {string} params.template - The prompt template
   * @param {string} [params.category] - Category (coding, writing, etc.)
   * @param {string[]} [params.tags] - Tags
   * @param {string} [params.preferredModel] - Preferred LLM model
   * @param {string} [params.exampleInput] - Example input
   * @param {string} [params.exampleOutput] - Example output
   * @returns {Promise<Object>} The created pattern
   */
  async recordPromptPattern(params) {
    try {
      const id = uuidv4();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO prompt_patterns (
          id, template, category, tags, use_count, success_count,
          preferred_model, example_input, example_output, metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        params.template,
        params.category || null,
        params.tags ? JSON.stringify(params.tags) : null,
        params.preferredModel || null,
        params.exampleInput || null,
        params.exampleOutput || null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        now,
        now,
      );

      const pattern = {
        id,
        template: params.template,
        category: params.category,
        tags: params.tags,
        useCount: 1,
        successCount: 0,
        preferredModel: params.preferredModel,
        createdAt: now,
      };

      this.emit("prompt-pattern-recorded", pattern);
      console.log(`[LearnedPatternManager] Prompt pattern recorded: ${id}`);

      return pattern;
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to record prompt pattern:",
        error,
      );
      throw error;
    }
  }

  /**
   * Update prompt pattern usage and success
   * @param {string} id - Pattern ID
   * @param {Object} options - Update options
   * @param {boolean} [options.success] - Whether the usage was successful
   * @param {number} [options.quality] - Quality score (0-1)
   */
  async updatePromptPatternUsage(id, options = {}) {
    try {
      const now = Date.now();
      let sql = `
        UPDATE prompt_patterns
        SET use_count = use_count + 1,
            last_used_at = ?,
            updated_at = ?
      `;
      const params = [now, now];

      if (options.success) {
        sql += ", success_count = success_count + 1";
      }

      if (typeof options.quality === "number") {
        sql += `, avg_response_quality = COALESCE(
          (avg_response_quality * use_count + ?) / (use_count + 1),
          ?
        )`;
        params.push(options.quality, options.quality);
      }

      sql += " WHERE id = ?";
      params.push(id);

      this.db.prepare(sql).run(...params);
      console.log(`[LearnedPatternManager] Prompt pattern updated: ${id}`);
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to update prompt pattern:",
        error,
      );
    }
  }

  /**
   * Get prompt suggestions based on context
   * @param {Object} context - Context for suggestions
   * @param {string} [context.category] - Filter by category
   * @param {string[]} [context.tags] - Filter by tags
   * @param {number} [context.limit=5] - Maximum suggestions
   * @returns {Promise<Array>} Prompt suggestions
   */
  async getPromptSuggestions(context = {}) {
    const { category, tags, limit = 5 } = context;

    try {
      let sql = `
        SELECT *,
          CASE WHEN use_count > 0
            THEN success_count * 1.0 / use_count
            ELSE 0
          END as success_rate
        FROM prompt_patterns
        WHERE 1=1
      `;
      const params = [];

      if (category) {
        sql += " AND category = ?";
        params.push(category);
      }

      sql += " ORDER BY use_count DESC, success_rate DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        template: row.template,
        category: row.category,
        tags: row.tags ? JSON.parse(row.tags) : [],
        useCount: row.use_count,
        successCount: row.success_count,
        successRate: row.success_rate,
        preferredModel: row.preferred_model,
        avgQuality: row.avg_response_quality,
        lastUsedAt: row.last_used_at,
      }));
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to get prompt suggestions:",
        error,
      );
      return [];
    }
  }

  /**
   * Search prompt patterns
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching patterns
   */
  async searchPromptPatterns(query, options = {}) {
    const { limit = 10 } = options;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM prompt_patterns
        WHERE template LIKE ? OR category LIKE ?
        ORDER BY use_count DESC
        LIMIT ?
      `);

      const searchTerm = `%${query}%`;
      const rows = stmt.all(searchTerm, searchTerm, limit);

      return rows.map((row) => ({
        id: row.id,
        template: row.template,
        category: row.category,
        tags: row.tags ? JSON.parse(row.tags) : [],
        useCount: row.use_count,
      }));
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to search prompt patterns:",
        error,
      );
      return [];
    }
  }

  // ============================================================
  // Error Fix Patterns (Integration with ErrorMonitor)
  // ============================================================

  /**
   * Record an error fix pattern
   * @param {Object} params - Pattern parameters
   * @param {string} params.errorPattern - Regex or substring pattern
   * @param {string} params.errorClassification - Classification
   * @param {string} params.fixStrategy - Fix strategy
   * @param {string[]} [params.fixSteps] - Fix steps
   * @param {string} [params.fixCode] - Fix code
   * @param {boolean} [params.success=true] - Whether fix succeeded
   * @param {string} [params.source='user'] - Source
   * @returns {Promise<Object>} The created pattern
   */
  async recordErrorFix(params) {
    try {
      const id = uuidv4();
      const now = Date.now();
      const success = params.success !== false;

      // Check if similar pattern exists
      const existingStmt = this.db.prepare(`
        SELECT id, success_count, failure_count
        FROM error_fix_patterns
        WHERE error_pattern = ? AND fix_strategy = ?
      `);
      const existing = existingStmt.get(
        params.errorPattern,
        params.fixStrategy,
      );

      if (existing) {
        // Update existing pattern
        const updateSql = success
          ? `UPDATE error_fix_patterns SET success_count = success_count + 1, last_applied_at = ?, updated_at = ? WHERE id = ?`
          : `UPDATE error_fix_patterns SET failure_count = failure_count + 1, last_applied_at = ?, updated_at = ? WHERE id = ?`;

        this.db.prepare(updateSql).run(now, now, existing.id);

        return { id: existing.id, updated: true };
      }

      // Create new pattern
      const stmt = this.db.prepare(`
        INSERT INTO error_fix_patterns (
          id, error_pattern, error_classification, error_message_sample,
          fix_strategy, fix_steps, fix_code, success_count, failure_count,
          confidence, auto_apply, source, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        params.errorPattern,
        params.errorClassification || null,
        params.errorMessageSample || null,
        params.fixStrategy,
        params.fixSteps ? JSON.stringify(params.fixSteps) : null,
        params.fixCode || null,
        success ? 1 : 0,
        success ? 0 : 1,
        success ? 0.5 : 0.1,
        0,
        params.source || "user",
        params.metadata ? JSON.stringify(params.metadata) : null,
        now,
        now,
      );

      const pattern = {
        id,
        errorPattern: params.errorPattern,
        errorClassification: params.errorClassification,
        fixStrategy: params.fixStrategy,
        success,
        createdAt: now,
      };

      this.emit("error-fix-recorded", pattern);
      console.log(`[LearnedPatternManager] Error fix pattern recorded: ${id}`);

      return pattern;
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to record error fix:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get error fix suggestions
   * @param {Object} error - Error object
   * @param {string} error.message - Error message
   * @param {string} [error.classification] - Error classification
   * @param {number} [limit=3] - Maximum suggestions
   * @returns {Promise<Array>} Fix suggestions
   */
  async getErrorFixSuggestions(error, limit = 3) {
    try {
      let sql = `
        SELECT *,
          success_count * 1.0 / NULLIF(success_count + failure_count, 0) as success_rate
        FROM error_fix_patterns
        WHERE 1=1
      `;
      const params = [];

      if (error.classification) {
        sql += " AND error_classification = ?";
        params.push(error.classification);
      }

      sql += " ORDER BY success_rate DESC, success_count DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      let rows = stmt.all(...params);

      // If no matches by classification, try pattern matching
      if (rows.length === 0 && error.message) {
        const patternStmt = this.db.prepare(`
          SELECT *,
            success_count * 1.0 / NULLIF(success_count + failure_count, 0) as success_rate
          FROM error_fix_patterns
          WHERE ? LIKE '%' || error_pattern || '%'
          ORDER BY success_rate DESC
          LIMIT ?
        `);
        rows = patternStmt.all(error.message, limit);
      }

      return rows.map((row) => ({
        id: row.id,
        errorPattern: row.error_pattern,
        errorClassification: row.error_classification,
        fixStrategy: row.fix_strategy,
        fixSteps: row.fix_steps ? JSON.parse(row.fix_steps) : [],
        fixCode: row.fix_code,
        successCount: row.success_count,
        failureCount: row.failure_count,
        successRate: row.success_rate,
        confidence: row.confidence,
        autoApply: row.auto_apply === 1,
      }));
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to get error fix suggestions:",
        error,
      );
      return [];
    }
  }

  // ============================================================
  // Code Snippets
  // ============================================================

  /**
   * Save a code snippet
   * @param {Object} snippet - Snippet data
   * @param {string} snippet.title - Title
   * @param {string} snippet.language - Programming language
   * @param {string} snippet.code - The code
   * @param {string} [snippet.description] - Description
   * @param {string[]} [snippet.tags] - Tags
   * @param {string} [snippet.source] - Source
   * @returns {Promise<Object>} The saved snippet
   */
  async saveCodeSnippet(snippet) {
    try {
      const id = uuidv4();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO code_snippets (
          id, title, description, language, code, tags,
          use_count, source, source_url, is_favorite, metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?)
      `);

      stmt.run(
        id,
        snippet.title,
        snippet.description || null,
        snippet.language,
        snippet.code,
        snippet.tags ? JSON.stringify(snippet.tags) : null,
        snippet.source || "manual",
        snippet.sourceUrl || null,
        snippet.metadata ? JSON.stringify(snippet.metadata) : null,
        now,
        now,
      );

      const saved = {
        id,
        title: snippet.title,
        language: snippet.language,
        createdAt: now,
      };

      this.emit("snippet-saved", saved);
      console.log(`[LearnedPatternManager] Code snippet saved: ${id}`);

      return saved;
    } catch (error) {
      console.error("[LearnedPatternManager] Failed to save snippet:", error);
      throw error;
    }
  }

  /**
   * Get code snippets
   * @param {Object} options - Query options
   * @param {string} [options.language] - Filter by language
   * @param {string[]} [options.tags] - Filter by tags
   * @param {boolean} [options.favoritesOnly] - Only favorites
   * @param {number} [options.limit=20] - Maximum results
   * @returns {Promise<Array>} Snippets
   */
  async getCodeSnippets(options = {}) {
    const { language, tags, favoritesOnly, limit = 20 } = options;

    try {
      let sql = `SELECT * FROM code_snippets WHERE 1=1`;
      const params = [];

      if (language) {
        sql += " AND language = ?";
        params.push(language);
      }

      if (favoritesOnly) {
        sql += " AND is_favorite = 1";
      }

      sql += " ORDER BY use_count DESC, updated_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      let result = rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        language: row.language,
        code: row.code,
        tags: row.tags ? JSON.parse(row.tags) : [],
        useCount: row.use_count,
        source: row.source,
        isFavorite: row.is_favorite === 1,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }));

      // Filter by tags if provided
      if (tags && tags.length > 0) {
        result = result.filter((snippet) =>
          tags.some((tag) => snippet.tags.includes(tag)),
        );
      }

      return result;
    } catch (error) {
      console.error("[LearnedPatternManager] Failed to get snippets:", error);
      return [];
    }
  }

  /**
   * Update snippet usage
   * @param {string} id - Snippet ID
   */
  async useCodeSnippet(id) {
    try {
      const now = Date.now();
      this.db
        .prepare(
          `
        UPDATE code_snippets
        SET use_count = use_count + 1, last_used_at = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(now, now, id);
    } catch (error) {
      console.error("[LearnedPatternManager] Failed to update snippet:", error);
    }
  }

  /**
   * Toggle snippet favorite status
   * @param {string} id - Snippet ID
   * @returns {Promise<boolean>} New favorite status
   */
  async toggleSnippetFavorite(id) {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(
        `SELECT is_favorite FROM code_snippets WHERE id = ?`,
      );
      const row = stmt.get(id);

      if (!row) {
        throw new Error("Snippet not found");
      }

      const newStatus = row.is_favorite === 1 ? 0 : 1;
      this.db
        .prepare(
          `UPDATE code_snippets SET is_favorite = ?, updated_at = ? WHERE id = ?`,
        )
        .run(newStatus, now, id);

      return newStatus === 1;
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to toggle favorite:",
        error,
      );
      throw error;
    }
  }

  /**
   * Delete a snippet
   * @param {string} id - Snippet ID
   */
  async deleteCodeSnippet(id) {
    try {
      this.db.prepare(`DELETE FROM code_snippets WHERE id = ?`).run(id);
      this.emit("snippet-deleted", { id });
      console.log(`[LearnedPatternManager] Snippet deleted: ${id}`);
    } catch (error) {
      console.error("[LearnedPatternManager] Failed to delete snippet:", error);
      throw error;
    }
  }

  // ============================================================
  // Workflow Patterns
  // ============================================================

  /**
   * Record a workflow pattern
   * @param {Object} workflow - Workflow data
   * @param {string} workflow.name - Workflow name
   * @param {Object[]} workflow.steps - Workflow steps
   * @param {string} [workflow.description] - Description
   * @param {string} [workflow.category] - Category
   * @param {Object} [workflow.triggerContext] - When to suggest
   * @returns {Promise<Object>} The recorded workflow
   */
  async recordWorkflow(workflow) {
    try {
      const id = uuidv4();
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO workflow_patterns (
          id, name, description, steps, trigger_context,
          use_count, completion_rate, avg_duration_ms, category,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        workflow.name,
        workflow.description || null,
        JSON.stringify(workflow.steps),
        workflow.triggerContext
          ? JSON.stringify(workflow.triggerContext)
          : null,
        workflow.category || null,
        workflow.metadata ? JSON.stringify(workflow.metadata) : null,
        now,
        now,
      );

      const recorded = {
        id,
        name: workflow.name,
        steps: workflow.steps,
        createdAt: now,
      };

      this.emit("workflow-recorded", recorded);
      console.log(`[LearnedPatternManager] Workflow recorded: ${id}`);

      return recorded;
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to record workflow:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get workflow suggestions
   * @param {Object} context - Current context
   * @param {string} [context.category] - Category filter
   * @param {number} [context.limit=5] - Maximum suggestions
   * @returns {Promise<Array>} Workflow suggestions
   */
  async getWorkflowSuggestions(context = {}) {
    const { category, limit = 5 } = context;

    try {
      let sql = `SELECT * FROM workflow_patterns WHERE 1=1`;
      const params = [];

      if (category) {
        sql += " AND category = ?";
        params.push(category);
      }

      sql += " ORDER BY use_count DESC, completion_rate DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        steps: JSON.parse(row.steps),
        category: row.category,
        useCount: row.use_count,
        completionRate: row.completion_rate,
        avgDurationMs: row.avg_duration_ms,
      }));
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to get workflow suggestions:",
        error,
      );
      return [];
    }
  }

  /**
   * Update workflow usage
   * @param {string} id - Workflow ID
   * @param {Object} options - Update options
   * @param {boolean} [options.completed] - Whether workflow was completed
   * @param {number} [options.durationMs] - Duration in milliseconds
   */
  async updateWorkflowUsage(id, options = {}) {
    try {
      const now = Date.now();
      let sql = `
        UPDATE workflow_patterns
        SET use_count = use_count + 1,
            last_used_at = ?,
            updated_at = ?
      `;
      const params = [now, now];

      if (typeof options.completed === "boolean") {
        sql += `, completion_rate = (completion_rate * use_count + ?) / (use_count + 1)`;
        params.push(options.completed ? 1 : 0);
      }

      if (typeof options.durationMs === "number") {
        sql += `, avg_duration_ms = COALESCE(
          (avg_duration_ms * use_count + ?) / (use_count + 1),
          ?
        )`;
        params.push(options.durationMs, options.durationMs);
      }

      sql += " WHERE id = ?";
      params.push(id);

      this.db.prepare(sql).run(...params);
    } catch (error) {
      console.error(
        "[LearnedPatternManager] Failed to update workflow usage:",
        error,
      );
    }
  }

  // ============================================================
  // Statistics and Backup
  // ============================================================

  /**
   * Get statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const promptStmt = this.db.prepare(
        `SELECT COUNT(*) as count, SUM(use_count) as total_uses FROM prompt_patterns`,
      );
      const promptStats = promptStmt.get();

      const errorStmt = this.db.prepare(
        `SELECT COUNT(*) as count, SUM(success_count) as successes FROM error_fix_patterns`,
      );
      const errorStats = errorStmt.get();

      const snippetStmt = this.db.prepare(
        `SELECT COUNT(*) as count, SUM(use_count) as total_uses FROM code_snippets`,
      );
      const snippetStats = snippetStmt.get();

      const workflowStmt = this.db.prepare(
        `SELECT COUNT(*) as count FROM workflow_patterns`,
      );
      const workflowStats = workflowStmt.get();

      return {
        promptPatterns: {
          count: promptStats.count,
          totalUses: promptStats.total_uses || 0,
        },
        errorFixPatterns: {
          count: errorStats.count,
          totalSuccesses: errorStats.successes || 0,
        },
        codeSnippets: {
          count: snippetStats.count,
          totalUses: snippetStats.total_uses || 0,
        },
        workflowPatterns: {
          count: workflowStats.count,
        },
      };
    } catch (error) {
      console.error("[LearnedPatternManager] Failed to get stats:", error);
      return {};
    }
  }

  /**
   * Backup patterns to files
   * @returns {Promise<Object>} Backup result
   */
  async backupToFiles() {
    try {
      const results = {};

      // Backup prompt patterns
      const prompts = await this.getPromptSuggestions({ limit: 1000 });
      const promptsPath = path.join(this.patternsDir, "prompts.json");
      await fs.writeFile(
        promptsPath,
        JSON.stringify(prompts, null, 2),
        "utf-8",
      );
      results.prompts = { success: true, count: prompts.length };

      // Backup code snippets
      const snippets = await this.getCodeSnippets({ limit: 1000 });
      const snippetsPath = path.join(this.patternsDir, "snippets.json");
      await fs.writeFile(
        snippetsPath,
        JSON.stringify(snippets, null, 2),
        "utf-8",
      );
      results.snippets = { success: true, count: snippets.length };

      console.log("[LearnedPatternManager] Backup complete");
      return { success: true, results };
    } catch (error) {
      console.error("[LearnedPatternManager] Backup failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup old patterns
   * @param {Object} options - Options
   * @param {number} [options.minUseCount=0] - Minimum use count to keep
   * @param {number} [options.olderThanDays=180] - Delete patterns older than N days
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanup(options = {}) {
    const { minUseCount = 0, olderThanDays = 180 } = options;

    try {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      let deleted = 0;

      // Cleanup prompt patterns with 0 success
      const promptResult = this.db
        .prepare(
          `
        DELETE FROM prompt_patterns
        WHERE use_count <= ? AND success_count = 0 AND updated_at < ?
      `,
        )
        .run(minUseCount, cutoff);
      deleted += promptResult.changes;

      // Cleanup failed error fix patterns
      const errorResult = this.db
        .prepare(
          `
        DELETE FROM error_fix_patterns
        WHERE success_count = 0 AND failure_count > 3 AND updated_at < ?
      `,
        )
        .run(cutoff);
      deleted += errorResult.changes;

      console.log(
        `[LearnedPatternManager] Cleanup complete: ${deleted} deleted`,
      );
      return { success: true, deleted };
    } catch (error) {
      console.error("[LearnedPatternManager] Cleanup failed:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = {
  LearnedPatternManager,
};
