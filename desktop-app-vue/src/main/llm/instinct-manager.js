/**
 * Instinct Learning System - Manager
 *
 * Automatically extracts reusable patterns ("instincts") from user sessions
 * via hooks observation, stores in permanent memory, and surfaces relevant
 * instincts in future sessions.
 *
 * Inspired by the everything-claude-code instinct learning pattern.
 *
 * @module llm/instinct-manager
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Instinct categories
 */
const INSTINCT_CATEGORIES = {
  CODING_PATTERN: "coding-pattern",
  TOOL_PREFERENCE: "tool-preference",
  WORKFLOW: "workflow",
  ERROR_FIX: "error-fix",
  STYLE: "style",
  ARCHITECTURE: "architecture",
  TESTING: "testing",
  GENERAL: "general",
};

/**
 * Confidence bounds
 */
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.95;
const DEFAULT_CONFIDENCE = 0.5;

/**
 * Observation buffer settings
 */
const OBSERVATION_BUFFER_SIZE = 50;
const OBSERVATION_FLUSH_INTERVAL = 60000; // 1 minute

/**
 * InstinctManager - Singleton manager for the instinct learning system
 */
class InstinctManager {
  constructor() {
    this.db = null;
    this.memoryManager = null;
    this.hookSystem = null;
    this.initialized = false;

    // In-memory observation buffer
    this.observationBuffer = [];

    // In-memory instinct cache (loaded from DB)
    this.instinctCache = new Map();

    // Flush timer
    this._flushTimer = null;

    // Hook unregister handles
    this._hookHandles = [];
  }

  /**
   * Initialize the instinct manager
   * @param {Object} db - Database manager instance
   * @param {Object} memoryManager - PermanentMemoryManager instance
   * @param {Object} hookSystem - HookSystem instance (optional)
   */
  async initialize(db, memoryManager, hookSystem = null) {
    if (this.initialized) {
      logger.warn("[InstinctManager] Already initialized");
      return;
    }

    this.db = db;
    this.memoryManager = memoryManager;
    this.hookSystem = hookSystem;

    // Create database tables
    this._ensureTables();

    // Load existing instincts into cache
    await this._loadInstinctsToCache();

    // Register hooks if hook system is available
    if (this.hookSystem) {
      this._registerHooks();
    }

    // Start periodic flush
    this._flushTimer = setInterval(() => {
      this._flushObservationBuffer().catch((err) =>
        logger.error("[InstinctManager] Flush error:", err.message),
      );
    }, OBSERVATION_FLUSH_INTERVAL);

    this.initialized = true;
    logger.info(
      `[InstinctManager] Initialized with ${this.instinctCache.size} instincts`,
    );
  }

  /**
   * Shut down the instinct manager
   */
  async shutdown() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    // Flush remaining observations
    await this._flushObservationBuffer();

    this.initialized = false;
    logger.info("[InstinctManager] Shut down");
  }

  // ============================================================
  // Database Schema
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS instincts (
          id TEXT PRIMARY KEY,
          pattern TEXT NOT NULL,
          confidence REAL DEFAULT ${DEFAULT_CONFIDENCE},
          category TEXT DEFAULT '${INSTINCT_CATEGORIES.GENERAL}',
          examples TEXT DEFAULT '[]',
          source TEXT DEFAULT 'auto',
          use_count INTEGER DEFAULT 0,
          last_used TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_instincts_category ON instincts(category);
        CREATE INDEX IF NOT EXISTS idx_instincts_confidence ON instincts(confidence);

        CREATE TABLE IF NOT EXISTS instinct_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          event_data TEXT DEFAULT '{}',
          processed INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_observations_processed ON instinct_observations(processed);
        CREATE INDEX IF NOT EXISTS idx_observations_type ON instinct_observations(event_type);
      `);

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.info("[InstinctManager] Database tables ensured");
    } catch (error) {
      logger.error("[InstinctManager] Table creation error:", error.message);
    }
  }

  // ============================================================
  // Instinct CRUD Operations
  // ============================================================

  /**
   * Add a new instinct
   * @param {string} pattern - The pattern description
   * @param {number} confidence - Confidence level (0.1-0.95)
   * @param {string} category - Category from INSTINCT_CATEGORIES
   * @param {Object} options - Additional options
   * @returns {Object} The created instinct
   */
  addInstinct(
    pattern,
    confidence = DEFAULT_CONFIDENCE,
    category = INSTINCT_CATEGORIES.GENERAL,
    options = {},
  ) {
    const id = uuidv4();
    const clampedConfidence = Math.max(
      MIN_CONFIDENCE,
      Math.min(MAX_CONFIDENCE, confidence),
    );
    const examples = JSON.stringify(options.examples || []);
    const source = options.source || "manual";
    const now = new Date().toISOString();

    try {
      this.db.run(
        `INSERT INTO instincts (id, pattern, confidence, category, examples, source, use_count, last_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          id,
          pattern,
          clampedConfidence,
          category,
          examples,
          source,
          now,
          now,
          now,
        ],
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      const instinct = {
        id,
        pattern,
        confidence: clampedConfidence,
        category,
        examples: options.examples || [],
        source,
        useCount: 0,
        lastUsed: now,
        createdAt: now,
        updatedAt: now,
      };

      this.instinctCache.set(id, instinct);
      logger.info(`[InstinctManager] Added instinct: ${id} (${category})`);

      return instinct;
    } catch (error) {
      logger.error("[InstinctManager] Add instinct error:", error.message);
      throw error;
    }
  }

  /**
   * Get all instincts with optional filters
   * @param {Object} filters - Filter options
   * @returns {Array} List of instincts
   */
  getAll(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.category) {
      conditions.push("category = ?");
      params.push(filters.category);
    }
    if (filters.minConfidence !== undefined) {
      conditions.push("confidence >= ?");
      params.push(filters.minConfidence);
    }
    if (filters.source) {
      conditions.push("source = ?");
      params.push(filters.source);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = filters.orderBy || "confidence DESC, use_count DESC";
    const limit = filters.limit || 100;

    try {
      const rows = this.db
        .prepare(`SELECT * FROM instincts ${where} ORDER BY ${orderBy} LIMIT ?`)
        .all(...params, limit);
      return rows.map(this._rowToInstinct);
    } catch (error) {
      logger.error("[InstinctManager] getAll error:", error.message);
      return Array.from(this.instinctCache.values());
    }
  }

  /**
   * Get a single instinct by ID
   * @param {string} id - Instinct ID
   * @returns {Object|null} The instinct
   */
  getById(id) {
    if (this.instinctCache.has(id)) {
      return this.instinctCache.get(id);
    }

    try {
      const row = this.db
        .prepare("SELECT * FROM instincts WHERE id = ?")
        .get(id);
      return row ? this._rowToInstinct(row) : null;
    } catch (error) {
      logger.error("[InstinctManager] getById error:", error.message);
      return null;
    }
  }

  /**
   * Update an instinct
   * @param {string} id - Instinct ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated instinct
   */
  updateInstinct(id, updates) {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    const fields = [];
    const params = [];

    if (updates.pattern !== undefined) {
      fields.push("pattern = ?");
      params.push(updates.pattern);
    }
    if (updates.confidence !== undefined) {
      fields.push("confidence = ?");
      params.push(
        Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, updates.confidence)),
      );
    }
    if (updates.category !== undefined) {
      fields.push("category = ?");
      params.push(updates.category);
    }
    if (updates.examples !== undefined) {
      fields.push("examples = ?");
      params.push(JSON.stringify(updates.examples));
    }

    fields.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);

    try {
      this.db.run(
        `UPDATE instincts SET ${fields.join(", ")} WHERE id = ?`,
        params,
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      // Refresh cache
      const row = this.db
        .prepare("SELECT * FROM instincts WHERE id = ?")
        .get(id);
      if (row) {
        const updated = this._rowToInstinct(row);
        this.instinctCache.set(id, updated);
        return updated;
      }
      return null;
    } catch (error) {
      logger.error("[InstinctManager] update error:", error.message);
      return null;
    }
  }

  /**
   * Delete an instinct
   * @param {string} id - Instinct ID
   * @returns {boolean} Success
   */
  deleteInstinct(id) {
    try {
      this.db.run("DELETE FROM instincts WHERE id = ?", [id]);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
      this.instinctCache.delete(id);
      logger.info(`[InstinctManager] Deleted instinct: ${id}`);
      return true;
    } catch (error) {
      logger.error("[InstinctManager] delete error:", error.message);
      return false;
    }
  }

  // ============================================================
  // Confidence Adjustment
  // ============================================================

  /**
   * Reinforce an instinct (increase confidence on successful use)
   * @param {string} id - Instinct ID
   * @returns {Object|null} Updated instinct
   */
  reinforceInstinct(id) {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    const newConfidence = Math.min(
      MAX_CONFIDENCE,
      existing.confidence + 0.05 * (1 - existing.confidence),
    );
    const now = new Date().toISOString();

    try {
      this.db.run(
        `UPDATE instincts SET confidence = ?, use_count = use_count + 1, last_used = ?, updated_at = ? WHERE id = ?`,
        [newConfidence, now, now, id],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      existing.confidence = newConfidence;
      existing.useCount += 1;
      existing.lastUsed = now;
      this.instinctCache.set(id, existing);

      logger.info(
        `[InstinctManager] Reinforced ${id}: confidence ${existing.confidence.toFixed(2)} → ${newConfidence.toFixed(2)}`,
      );
      return existing;
    } catch (error) {
      logger.error("[InstinctManager] reinforce error:", error.message);
      return null;
    }
  }

  /**
   * Decay an instinct (decrease confidence on failure/disuse)
   * @param {string} id - Instinct ID
   * @returns {Object|null} Updated instinct
   */
  decayInstinct(id) {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    const newConfidence = Math.max(MIN_CONFIDENCE, existing.confidence * 0.9);
    const now = new Date().toISOString();

    try {
      this.db.run(
        `UPDATE instincts SET confidence = ?, updated_at = ? WHERE id = ?`,
        [newConfidence, now, id],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      existing.confidence = newConfidence;
      this.instinctCache.set(id, existing);

      logger.info(
        `[InstinctManager] Decayed ${id}: confidence → ${newConfidence.toFixed(2)}`,
      );
      return existing;
    } catch (error) {
      logger.error("[InstinctManager] decay error:", error.message);
      return null;
    }
  }

  // ============================================================
  // Context-Aware Retrieval
  // ============================================================

  /**
   * Get relevant instincts for a given context
   * Uses keyword matching and category filtering.
   * @param {string} context - The current context/query
   * @param {number} limit - Maximum instincts to return
   * @returns {Array} Relevant instincts sorted by relevance
   */
  getRelevantInstincts(context, limit = 5) {
    if (!context) {
      return [];
    }

    const contextLower = context.toLowerCase();
    const contextWords = contextLower.split(/\s+/).filter((w) => w.length > 2);

    const scored = [];

    for (const instinct of this.instinctCache.values()) {
      if (instinct.confidence < 0.3) {
        continue;
      }

      const patternLower = instinct.pattern.toLowerCase();
      let score = 0;

      // Keyword overlap scoring
      for (const word of contextWords) {
        if (patternLower.includes(word)) {
          score += 1;
        }
      }

      // Category relevance boost
      if (
        context.includes("test") &&
        instinct.category === INSTINCT_CATEGORIES.TESTING
      ) {
        score += 2;
      }
      if (
        context.includes("error") &&
        instinct.category === INSTINCT_CATEGORIES.ERROR_FIX
      ) {
        score += 2;
      }
      if (
        context.includes("style") &&
        instinct.category === INSTINCT_CATEGORIES.STYLE
      ) {
        score += 2;
      }

      // Confidence weighting
      score *= instinct.confidence;

      // Usage frequency bonus
      score += Math.min(instinct.useCount * 0.1, 1.0);

      if (score > 0) {
        scored.push({ instinct, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.instinct);
  }

  /**
   * Build instinct context string for LLM injection
   * @param {string} context - Current task/conversation context
   * @param {number} limit - Max instincts
   * @returns {string} Formatted instinct context
   */
  buildInstinctContext(context, limit = 5) {
    const relevant = this.getRelevantInstincts(context, limit);
    if (relevant.length === 0) {
      return "";
    }

    const lines = [
      "## Learned Patterns (Instincts)",
      "The following patterns have been learned from previous sessions:",
      "",
    ];

    for (const inst of relevant) {
      lines.push(
        `- [${inst.category}] (confidence: ${inst.confidence.toFixed(2)}) ${inst.pattern}`,
      );
    }

    return lines.join("\n");
  }

  // ============================================================
  // Observation System
  // ============================================================

  /**
   * Observe a hook event and buffer it
   * @param {Object} event - The hook event data
   */
  observe(event) {
    if (!event || !event.type) {
      return;
    }

    this.observationBuffer.push({
      eventType: event.type,
      eventData: event.data || {},
      timestamp: new Date().toISOString(),
    });

    // Auto-flush when buffer is full
    if (this.observationBuffer.length >= OBSERVATION_BUFFER_SIZE) {
      this._flushObservationBuffer().catch((err) =>
        logger.error("[InstinctManager] Auto-flush error:", err.message),
      );
    }
  }

  /**
   * Flush the observation buffer to the database
   * @private
   */
  async _flushObservationBuffer() {
    if (this.observationBuffer.length === 0) {
      return;
    }

    const observations = [...this.observationBuffer];
    this.observationBuffer = [];

    try {
      for (const obs of observations) {
        this.db.run(
          `INSERT INTO instinct_observations (event_type, event_data, processed, created_at)
           VALUES (?, ?, 0, ?)`,
          [obs.eventType, JSON.stringify(obs.eventData), obs.timestamp],
        );
      }
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.info(
        `[InstinctManager] Flushed ${observations.length} observations`,
      );
    } catch (error) {
      logger.error("[InstinctManager] Flush error:", error.message);
      // Put observations back
      this.observationBuffer.unshift(...observations);
    }
  }

  // ============================================================
  // Pattern Extraction (Evolve)
  // ============================================================

  /**
   * Analyze unprocessed observations and extract patterns
   * Groups by event type and looks for recurring patterns.
   * @returns {Object} Extraction results
   */
  async evolveInstincts() {
    logger.info("[InstinctManager] Starting instinct evolution...");

    // Flush buffer first
    await this._flushObservationBuffer();

    try {
      // Get unprocessed observations
      const observations = this.db
        .prepare(
          `SELECT * FROM instinct_observations WHERE processed = 0 ORDER BY created_at ASC LIMIT 200`,
        )
        .all();

      if (observations.length === 0) {
        return {
          success: true,
          message: "No unprocessed observations",
          extracted: 0,
        };
      }

      // Group observations by event type
      const grouped = {};
      for (const obs of observations) {
        const type = obs.event_type;
        if (!grouped[type]) {
          grouped[type] = [];
        }
        grouped[type].push({
          ...obs,
          data: safeParseJSON(obs.event_data),
        });
      }

      const extracted = [];

      // Extract patterns from tool usage
      if (grouped.PostToolUse) {
        const toolPatterns = this._extractToolPatterns(grouped.PostToolUse);
        extracted.push(...toolPatterns);
      }

      // Extract patterns from errors
      if (grouped.IPCError || grouped.ToolError) {
        const errorObs = [
          ...(grouped.IPCError || []),
          ...(grouped.ToolError || []),
        ];
        const errorPatterns = this._extractErrorPatterns(errorObs);
        extracted.push(...errorPatterns);
      }

      // Extract patterns from session behavior
      if (grouped.SessionEnd || grouped.SessionStart) {
        const sessionObs = [
          ...(grouped.SessionStart || []),
          ...(grouped.SessionEnd || []),
        ];
        const sessionPatterns = this._extractSessionPatterns(sessionObs);
        extracted.push(...sessionPatterns);
      }

      // Experience Replay: Extract workflow templates from orchestrate/verification observations
      if (grouped.PostToolUse) {
        const workflowTemplates = this._extractWorkflowTemplates(
          grouped.PostToolUse,
        );
        extracted.push(...workflowTemplates);
      }

      // Save extracted instincts
      for (const pattern of extracted) {
        this.addInstinct(
          pattern.pattern,
          pattern.confidence,
          pattern.category,
          {
            source: "auto",
            examples: pattern.examples || [],
          },
        );
      }

      // Mark observations as processed
      const ids = observations.map((o) => o.id);
      if (ids.length > 0) {
        this.db.run(
          `UPDATE instinct_observations SET processed = 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
        if (this.db.saveToFile) {
          this.db.saveToFile();
        }
      }

      logger.info(
        `[InstinctManager] Evolution complete: ${extracted.length} patterns from ${observations.length} observations`,
      );

      return {
        success: true,
        observationsProcessed: observations.length,
        extracted: extracted.length,
        patterns: extracted,
      };
    } catch (error) {
      logger.error("[InstinctManager] Evolution error:", error.message);
      return { success: false, error: error.message, extracted: 0 };
    }
  }

  /**
   * Extract patterns from tool usage observations
   * @private
   */
  _extractToolPatterns(observations) {
    const patterns = [];
    const toolFrequency = {};

    for (const obs of observations) {
      const toolName = obs.data?.toolName || obs.data?.tool || "unknown";
      if (!toolFrequency[toolName]) {
        toolFrequency[toolName] = { count: 0, contexts: [] };
      }
      toolFrequency[toolName].count++;
      if (obs.data?.context) {
        toolFrequency[toolName].contexts.push(
          String(obs.data.context).substring(0, 100),
        );
      }
    }

    // Frequent tool usage pattern
    for (const [tool, data] of Object.entries(toolFrequency)) {
      if (data.count >= 3) {
        patterns.push({
          pattern: `User frequently uses tool "${tool}" (${data.count} times in recent session)`,
          confidence: Math.min(0.3 + data.count * 0.05, 0.7),
          category: INSTINCT_CATEGORIES.TOOL_PREFERENCE,
          examples: data.contexts.slice(0, 3),
        });
      }
    }

    // Tool sequence patterns
    if (observations.length >= 3) {
      const toolSequence = observations
        .slice(0, 10)
        .map((o) => o.data?.toolName || o.data?.tool || "")
        .filter(Boolean);

      if (toolSequence.length >= 3) {
        const seqStr = toolSequence.slice(0, 5).join(" → ");
        patterns.push({
          pattern: `Common tool sequence: ${seqStr}`,
          confidence: 0.35,
          category: INSTINCT_CATEGORIES.WORKFLOW,
          examples: [seqStr],
        });
      }
    }

    return patterns;
  }

  /**
   * Extract patterns from error observations
   * @private
   */
  _extractErrorPatterns(observations) {
    const patterns = [];
    const errorTypes = {};

    for (const obs of observations) {
      const errorType = obs.data?.errorType || obs.data?.code || "unknown";
      if (!errorTypes[errorType]) {
        errorTypes[errorType] = { count: 0, messages: [] };
      }
      errorTypes[errorType].count++;
      if (obs.data?.message) {
        errorTypes[errorType].messages.push(
          String(obs.data.message).substring(0, 100),
        );
      }
    }

    for (const [type, data] of Object.entries(errorTypes)) {
      if (data.count >= 2) {
        patterns.push({
          pattern: `Recurring error type "${type}": ${data.messages[0] || "no message"}`,
          confidence: Math.min(0.3 + data.count * 0.1, 0.7),
          category: INSTINCT_CATEGORIES.ERROR_FIX,
          examples: data.messages.slice(0, 3),
        });
      }
    }

    return patterns;
  }

  /**
   * Extract patterns from session observations
   * @private
   */
  _extractSessionPatterns(observations) {
    // Session-level patterns are broader; extract if enough data
    if (observations.length < 2) {
      return [];
    }

    return [];
  }

  /**
   * Experience Replay: Extract successful workflow/orchestrate execution
   * paths as workflow category instincts with template data.
   *
   * Looks for sequences of orchestrate/verification-loop tool usage that
   * completed successfully, and records them as reusable workflow patterns.
   *
   * @param {Array} observations - PostToolUse observations
   * @returns {Array} Extracted workflow instinct patterns
   * @private
   */
  _extractWorkflowTemplates(observations) {
    const patterns = [];
    const workflowObs = observations.filter((obs) => {
      const toolName = obs.data?.toolName || obs.data?.tool || "";
      return (
        toolName === "orchestrate" ||
        toolName === "verification-loop" ||
        toolName === "verification_loop"
      );
    });

    if (workflowObs.length < 2) {
      return patterns;
    }

    // Group by success status
    const successful = workflowObs.filter(
      (obs) =>
        obs.data?.success === true || obs.data?.result?.verdict === "SHIP",
    );

    if (successful.length >= 1) {
      // Extract the workflow sequence as an instinct
      const toolSequence = workflowObs
        .map((obs) => obs.data?.toolName || obs.data?.tool || "unknown")
        .join(" → ");

      const templateData = successful.map((obs) => ({
        tool: obs.data?.toolName || obs.data?.tool,
        template: obs.data?.result?.template || obs.data?.template,
        verdict: obs.data?.result?.verdict,
        duration: obs.data?.result?.duration || obs.data?.duration,
      }));

      patterns.push({
        pattern: `Successful workflow pattern: ${toolSequence} (${successful.length}/${workflowObs.length} succeeded)`,
        confidence: Math.min(0.4 + successful.length * 0.1, 0.8),
        category: INSTINCT_CATEGORIES.WORKFLOW,
        examples: templateData.slice(0, 3),
      });
    }

    // Extract per-template success patterns
    const templateCounts = {};
    for (const obs of workflowObs) {
      const template =
        obs.data?.result?.template || obs.data?.template || "unknown";
      if (!templateCounts[template]) {
        templateCounts[template] = { total: 0, success: 0 };
      }
      templateCounts[template].total++;
      if (obs.data?.success === true || obs.data?.result?.verdict === "SHIP") {
        templateCounts[template].success++;
      }
    }

    for (const [template, counts] of Object.entries(templateCounts)) {
      if (template === "unknown" || counts.total < 2) {
        continue;
      }
      const rate = counts.success / counts.total;
      if (rate >= 0.5) {
        patterns.push({
          pattern: `Workflow template "${template}" has ${(rate * 100).toFixed(0)}% success rate (${counts.success}/${counts.total} runs)`,
          confidence: Math.min(0.3 + rate * 0.4, 0.8),
          category: INSTINCT_CATEGORIES.WORKFLOW,
          examples: [`template:${template}`, `rate:${rate.toFixed(2)}`],
        });
      }
    }

    return patterns;
  }

  // ============================================================
  // Export / Import
  // ============================================================

  /**
   * Export all instincts as JSON
   * @returns {Object} Export data
   */
  exportInstincts() {
    const instincts = this.getAll({ limit: 10000 });
    return {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      count: instincts.length,
      instincts,
    };
  }

  /**
   * Import instincts from JSON
   * @param {Object} data - Import data (from exportInstincts)
   * @returns {Object} Import result
   */
  importInstincts(data) {
    if (!data || !Array.isArray(data.instincts)) {
      return { success: false, error: "Invalid import data format" };
    }

    let imported = 0;
    let skipped = 0;

    for (const inst of data.instincts) {
      if (!inst.pattern) {
        skipped++;
        continue;
      }

      try {
        this.addInstinct(
          inst.pattern,
          inst.confidence || DEFAULT_CONFIDENCE,
          inst.category || INSTINCT_CATEGORIES.GENERAL,
          {
            source: "import",
            examples: inst.examples || [],
          },
        );
        imported++;
      } catch {
        skipped++;
      }
    }

    logger.info(
      `[InstinctManager] Import: ${imported} imported, ${skipped} skipped`,
    );
    return { success: true, imported, skipped };
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get instinct system statistics
   * @returns {Object} Statistics
   */
  getStats() {
    try {
      const totalInstincts = this.db
        .prepare("SELECT COUNT(*) as count FROM instincts")
        .get().count;

      const byCategory = this.db
        .prepare(
          "SELECT category, COUNT(*) as count FROM instincts GROUP BY category",
        )
        .all();

      const avgConfidence = this.db
        .prepare("SELECT AVG(confidence) as avg FROM instincts")
        .get().avg;

      const totalObservations = this.db
        .prepare("SELECT COUNT(*) as count FROM instinct_observations")
        .get().count;

      const unprocessedObservations = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM instinct_observations WHERE processed = 0",
        )
        .get().count;

      const highConfidence = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM instincts WHERE confidence >= 0.7",
        )
        .get().count;

      const totalUseCount =
        this.db.prepare("SELECT SUM(use_count) as total FROM instincts").get()
          .total || 0;

      return {
        totalInstincts,
        byCategory: byCategory.reduce((acc, r) => {
          acc[r.category] = r.count;
          return acc;
        }, {}),
        avgConfidence: avgConfidence ? parseFloat(avgConfidence.toFixed(3)) : 0,
        highConfidenceCount: highConfidence,
        totalObservations,
        unprocessedObservations,
        bufferSize: this.observationBuffer.length,
        totalUseCount,
      };
    } catch (error) {
      logger.error("[InstinctManager] stats error:", error.message);
      return {
        totalInstincts: this.instinctCache.size,
        byCategory: {},
        avgConfidence: 0,
        totalObservations: 0,
        unprocessedObservations: 0,
        bufferSize: this.observationBuffer.length,
        totalUseCount: 0,
      };
    }
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * Load all instincts from DB into cache
   * @private
   */
  async _loadInstinctsToCache() {
    try {
      const rows = this.db
        .prepare("SELECT * FROM instincts ORDER BY confidence DESC")
        .all();

      this.instinctCache.clear();
      for (const row of rows) {
        const instinct = this._rowToInstinct(row);
        this.instinctCache.set(instinct.id, instinct);
      }
    } catch (error) {
      logger.error("[InstinctManager] Cache load error:", error.message);
    }
  }

  /**
   * Convert a database row to an instinct object
   * @private
   */
  _rowToInstinct(row) {
    return {
      id: row.id,
      pattern: row.pattern,
      confidence: row.confidence,
      category: row.category,
      examples: safeParseJSON(row.examples),
      source: row.source,
      useCount: row.use_count,
      lastUsed: row.last_used,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Register hooks for observation
   * @private
   */
  _registerHooks() {
    if (!this.hookSystem || !this.hookSystem.registry) {
      return;
    }

    const registry = this.hookSystem.registry;

    // Observe PostToolUse events
    try {
      registry.register({
        event: "PostToolUse",
        name: "instinct:tool-observer",
        type: "async",
        priority: 1000, // MONITOR
        handler: async ({ data }) => {
          this.observe({
            type: "PostToolUse",
            data: {
              toolName: data?.toolName,
              tool: data?.tool,
              success: data?.success,
              duration: data?.duration,
              context: data?.context,
            },
          });
          return { result: "continue" };
        },
      });
    } catch (error) {
      logger.warn(
        "[InstinctManager] PostToolUse hook registration failed:",
        error.message,
      );
    }

    // Observe PreCompact (flush before compaction)
    try {
      registry.register({
        event: "PreCompact",
        name: "instinct:pre-compact-flush",
        type: "async",
        priority: 100, // HIGH
        handler: async () => {
          await this._flushObservationBuffer();
          return { result: "continue" };
        },
      });
    } catch (error) {
      logger.warn(
        "[InstinctManager] PreCompact hook registration failed:",
        error.message,
      );
    }

    logger.info("[InstinctManager] Hooks registered");
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

// Singleton instance
let instance = null;

/**
 * Get the singleton InstinctManager instance
 * @returns {InstinctManager}
 */
function getInstinctManager() {
  if (!instance) {
    instance = new InstinctManager();
  }
  return instance;
}

module.exports = {
  InstinctManager,
  getInstinctManager,
  INSTINCT_CATEGORIES,
};
