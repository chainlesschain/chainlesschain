/**
 * Dual Model Manager (Architect + Editor) -- v1.0.0
 *
 * Orchestrates a multi-model collaboration workflow where an Architect model
 * designs solutions and reviews code, while an Editor model implements the
 * designs. The two models alternate turns until the Architect approves the
 * implementation or the maximum turn count is reached.
 *
 * Session lifecycle:
 *   1. startSession  -> Architect analyses task, produces design plan
 *   2. nextTurn      -> Editor implements / Architect reviews (alternating)
 *   3. Session ends when Architect verdict contains "APPROVED" or max turns
 *
 * @module ai-engine/dual-model/dual-model-manager
 */

const { logger } = require("../../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const DEFAULT_CONFIG = {
  maxTurnsPerSession: 10,
  roles: {
    architect: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.3,
      systemPrompt:
        "You are the Architect. Your role is to analyze tasks, design solutions, create implementation plans, and review code. Provide structured output with clear sections: ## Analysis, ## Design, ## Implementation Plan. When reviewing code, provide specific feedback with ## Review and ## Verdict (APPROVED or NEEDS_CHANGES).",
    },
    editor: {
      provider: "deepseek",
      model: "deepseek-chat",
      temperature: 0.2,
      systemPrompt:
        "You are the Editor. Your role is to implement code based on the Architect's design plan. Follow the plan precisely. Output complete, working code. When receiving review feedback, apply all requested changes.",
    },
  },
};

const SESSION_STATUSES = ["pending", "active", "completed", "failed", "cancelled"];
const ROLES = ["architect", "editor"];

// ============================================================
// DualModelManager
// ============================================================

class DualModelManager extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {Object} deps.database  - DatabaseManager instance
   * @param {Object} deps.llmManager - LLMManager instance
   */
  constructor({ database, llmManager } = {}) {
    super();
    this.db = database || null;
    this.llmManager = llmManager || null;
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.initialized = false;
  }

  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------

  /**
   * Initialize the manager and ensure DB tables exist.
   * @param {Object} [database] - Optional database override
   */
  async initialize(database) {
    if (this.initialized) {
      return;
    }

    if (database) {
      this.db = database;
    }

    this._ensureTables();
    this.initialized = true;
    logger.info("[DualModelManager] Initialized");
  }

  /**
   * Create the dual_model_sessions table if it does not exist.
   * @private
   */
  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dual_model_sessions (
          id TEXT PRIMARY KEY,
          task TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed','failed','cancelled')),
          current_role TEXT DEFAULT 'architect' CHECK(current_role IN ('architect','editor')),
          turn_number INTEGER DEFAULT 0,
          architect_config TEXT,
          editor_config TEXT,
          conversation_history TEXT DEFAULT '[]',
          final_output TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dual_model_sessions_status ON dual_model_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_dual_model_sessions_created ON dual_model_sessions(created_at);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[DualModelManager] Table creation error:", e.message);
    }
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Start a new Architect+Editor session.
   *
   * Creates a DB record, then runs the first Architect turn to analyse the
   * task and produce a design plan.
   *
   * @param {string} task - The task description to work on
   * @param {Object} [config] - Optional per-session role config overrides
   * @returns {Object} The newly created session object
   */
  async startSession(task, config) {
    if (!task || typeof task !== "string" || task.trim().length === 0) {
      throw new Error("Task description is required");
    }

    const id = uuidv4();
    const now = Date.now();

    // Merge per-session config overrides
    const sessionArchitectConfig = {
      ...this.config.roles.architect,
      ...(config && config.architect ? config.architect : {}),
    };
    const sessionEditorConfig = {
      ...this.config.roles.editor,
      ...(config && config.editor ? config.editor : {}),
    };

    const maxTurns =
      (config && config.maxTurnsPerSession) || this.config.maxTurnsPerSession;

    // Initial architect message: analyse the task
    const architectPrompt = `Please analyze the following task and create a detailed implementation plan.\n\nTask: ${task}`;
    const architectMessages = [{ role: "user", content: architectPrompt }];

    let architectResponse;
    try {
      architectResponse = await this._callModel("architect", architectMessages, sessionArchitectConfig);
    } catch (callError) {
      logger.error("[DualModelManager] Architect call failed during startSession:", callError.message);
      // Save session as failed
      const failedSession = {
        id,
        task,
        status: "failed",
        current_role: "architect",
        turn_number: 0,
        architect_config: sessionArchitectConfig,
        editor_config: sessionEditorConfig,
        conversation_history: [],
        final_output: null,
        created_at: now,
        updated_at: now,
        maxTurnsPerSession: maxTurns,
        error: callError.message,
      };
      this._saveSession(failedSession);
      this.emit("session:failed", { sessionId: id, error: callError.message });
      throw callError;
    }

    const conversationHistory = [
      {
        role: "architect",
        content: architectResponse,
        turn: 1,
        timestamp: Date.now(),
      },
    ];

    const session = {
      id,
      task,
      status: "active",
      current_role: "editor",
      turn_number: 1,
      architect_config: sessionArchitectConfig,
      editor_config: sessionEditorConfig,
      conversation_history: conversationHistory,
      final_output: null,
      created_at: now,
      updated_at: Date.now(),
      maxTurnsPerSession: maxTurns,
    };

    this._saveSession(session);
    this.emit("session:started", { sessionId: id, task });
    this.emit("turn:completed", {
      sessionId: id,
      role: "architect",
      turn: 1,
    });

    logger.info(`[DualModelManager] Session ${id} started. Architect produced initial plan.`);
    return this._toPublicSession(session);
  }

  /**
   * Advance the session by one turn.
   *
   * - If current_role is 'editor': Editor implements based on Architect's last message.
   * - If current_role is 'architect': Architect reviews Editor's implementation.
   *   If the review contains "APPROVED", session status becomes 'completed'.
   * - If max turns reached, session status becomes 'completed' with a warning.
   *
   * @param {string} sessionId
   * @returns {Object} Updated session object
   */
  async nextTurn(sessionId) {
    const session = this._loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === "completed" || session.status === "cancelled" || session.status === "failed") {
      throw new Error(`Session ${sessionId} is already ${session.status}`);
    }

    const currentRole = session.current_role;
    const history = session.conversation_history;
    const turnNumber = session.turn_number + 1;

    // Check max turns
    if (turnNumber > session.maxTurnsPerSession) {
      session.status = "completed";
      session.final_output = this._extractFinalOutput(history);
      session.updated_at = Date.now();
      this._saveSession(session);
      this.emit("session:completed", {
        sessionId,
        reason: "max_turns_reached",
        turns: session.turn_number,
      });
      logger.warn(`[DualModelManager] Session ${sessionId} completed: max turns reached (${session.maxTurnsPerSession}).`);
      return this._toPublicSession(session);
    }

    // Build messages for the current role
    const roleConfig =
      currentRole === "architect" ? session.architect_config : session.editor_config;

    const messages = this._buildMessagesForRole(currentRole, history, session.task);

    let response;
    try {
      response = await this._callModel(currentRole, messages, roleConfig);
    } catch (callError) {
      logger.error(`[DualModelManager] ${currentRole} call failed on turn ${turnNumber}:`, callError.message);
      session.status = "failed";
      session.updated_at = Date.now();
      this._saveSession(session);
      this.emit("session:failed", { sessionId, error: callError.message });
      throw callError;
    }

    // Append to history
    history.push({
      role: currentRole,
      content: response,
      turn: turnNumber,
      timestamp: Date.now(),
    });

    session.turn_number = turnNumber;
    session.conversation_history = history;
    session.updated_at = Date.now();

    // If architect just reviewed, check for approval
    if (currentRole === "architect") {
      const approved = this._checkApproval(response);
      if (approved) {
        session.status = "completed";
        session.final_output = this._extractFinalOutput(history);
        this._saveSession(session);
        this.emit("session:completed", {
          sessionId,
          reason: "approved",
          turns: turnNumber,
        });
        this.emit("turn:completed", {
          sessionId,
          role: currentRole,
          turn: turnNumber,
        });
        logger.info(`[DualModelManager] Session ${sessionId} completed: Architect APPROVED on turn ${turnNumber}.`);
        return this._toPublicSession(session);
      }
      // Not approved, next role is editor
      session.current_role = "editor";
    } else {
      // Editor finished, next role is architect to review
      session.current_role = "architect";
    }

    this._saveSession(session);
    this.emit("turn:completed", {
      sessionId,
      role: currentRole,
      turn: turnNumber,
    });

    logger.info(`[DualModelManager] Session ${sessionId} turn ${turnNumber} completed (${currentRole}). Next: ${session.current_role}.`);
    return this._toPublicSession(session);
  }

  /**
   * Get the current state of a session.
   * @param {string} sessionId
   * @returns {Object|null} Session state or null if not found
   */
  getState(sessionId) {
    const session = this._loadSession(sessionId);
    if (!session) {
      return null;
    }
    return this._toPublicSession(session);
  }

  /**
   * Force-end a session, marking it as cancelled.
   * @param {string} sessionId
   * @returns {Object} Updated session object
   */
  endSession(sessionId) {
    const session = this._loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === "completed" || session.status === "cancelled") {
      return this._toPublicSession(session);
    }

    session.status = "cancelled";
    session.final_output = this._extractFinalOutput(session.conversation_history);
    session.updated_at = Date.now();
    this._saveSession(session);
    this.emit("session:cancelled", { sessionId });

    logger.info(`[DualModelManager] Session ${sessionId} cancelled.`);
    return this._toPublicSession(session);
  }

  /**
   * Update role configurations for future sessions.
   * @param {Object} config - Configuration overrides
   * @param {Object} [config.architect] - Architect role config
   * @param {Object} [config.editor] - Editor role config
   * @param {number} [config.maxTurnsPerSession] - Max turns per session
   * @returns {Object} Updated configuration
   */
  configureRoles(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Configuration object is required");
    }

    if (config.architect) {
      this.config.roles.architect = {
        ...this.config.roles.architect,
        ...config.architect,
      };
    }

    if (config.editor) {
      this.config.roles.editor = {
        ...this.config.roles.editor,
        ...config.editor,
      };
    }

    if (typeof config.maxTurnsPerSession === "number" && config.maxTurnsPerSession > 0) {
      this.config.maxTurnsPerSession = config.maxTurnsPerSession;
    }

    logger.info("[DualModelManager] Role configuration updated.");
    this.emit("config:updated", this.config);
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * List sessions with optional filtering and pagination.
   * @param {Object} [options]
   * @param {number} [options.limit=20] - Max number of sessions to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.status] - Filter by status
   * @returns {Object} { sessions, total }
   */
  listSessions(options = {}) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const status = options.status || null;

    if (!this.db) {
      return { sessions: [], total: 0 };
    }

    try {
      let countSql;
      let querySql;
      let countParams;
      let queryParams;

      if (status) {
        countSql = "SELECT COUNT(*) as count FROM dual_model_sessions WHERE status = ?";
        countParams = [status];
        querySql =
          "SELECT * FROM dual_model_sessions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?";
        queryParams = [status, limit, offset];
      } else {
        countSql = "SELECT COUNT(*) as count FROM dual_model_sessions";
        countParams = [];
        querySql =
          "SELECT * FROM dual_model_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?";
        queryParams = [limit, offset];
      }

      const countStmt = this.db.prepare(countSql);
      const totalRow = countStmt.get(...countParams);
      const total = totalRow ? totalRow.count : 0;

      const queryStmt = this.db.prepare(querySql);
      const rows = queryStmt.all(...queryParams);

      const sessions = rows.map((row) => this._rowToSession(row));

      return {
        sessions: sessions.map((s) => this._toPublicSession(s)),
        total,
      };
    } catch (e) {
      logger.error("[DualModelManager] listSessions error:", e.message);
      return { sessions: [], total: 0 };
    }
  }

  /**
   * Get the full conversation history for a session.
   * @param {string} sessionId
   * @returns {Array} Conversation history array
   */
  getHistory(sessionId) {
    const session = this._loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session.conversation_history;
  }

  // ----------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------

  /**
   * Call an LLM model for a given role.
   *
   * Creates a temporary LLMManager with the role's provider/model config
   * and sends the messages with the role's system prompt prepended.
   *
   * @param {string} role - 'architect' or 'editor'
   * @param {Array} messages - Chat messages array
   * @param {Object} [roleConfig] - Optional role config override
   * @returns {string} Model response content
   * @private
   */
  async _callModel(role, messages, roleConfig) {
    const config = roleConfig || this.config.roles[role];

    if (!config) {
      throw new Error(`Unknown role: ${role}`);
    }

    if (!this.llmManager) {
      throw new Error("LLM manager is not available");
    }

    // Prepend system prompt
    const fullMessages = [
      { role: "system", content: config.systemPrompt },
      ...messages,
    ];

    // Save current provider state
    const originalProvider = this.llmManager.provider;
    const originalConfig = { ...this.llmManager.config };

    try {
      // Switch to the role's provider/model
      await this.llmManager.switchProvider(config.provider, {
        model: config.model,
        temperature: config.temperature,
      });

      const result = await this.llmManager.chat(fullMessages, {
        temperature: config.temperature,
      });

      const content = result.content || result.text || "";
      return content;
    } finally {
      // Restore original provider
      try {
        await this.llmManager.switchProvider(originalProvider, originalConfig);
      } catch (restoreError) {
        logger.warn("[DualModelManager] Failed to restore original provider:", restoreError.message);
      }
    }
  }

  /**
   * Build the message array for a role based on conversation history.
   * @param {string} role - 'architect' or 'editor'
   * @param {Array} history - Conversation history
   * @param {string} task - Original task description
   * @returns {Array} Messages array for the LLM
   * @private
   */
  _buildMessagesForRole(role, history, task) {
    const messages = [];

    if (role === "editor") {
      // Editor receives the task + architect's latest plan/review
      messages.push({
        role: "user",
        content: `Original task: ${task}`,
      });

      // Add all previous messages as context
      for (const entry of history) {
        if (entry.role === "architect") {
          messages.push({
            role: "user",
            content: `[Architect]: ${entry.content}`,
          });
        } else if (entry.role === "editor") {
          messages.push({
            role: "assistant",
            content: entry.content,
          });
        }
      }

      // Add instruction for the editor
      const lastArchitect = this._getLastMessageByRole(history, "architect");
      if (lastArchitect) {
        messages.push({
          role: "user",
          content:
            "Based on the Architect's plan above, please implement the code. Provide complete, working code.",
        });
      }
    } else {
      // Architect receives the task + editor's latest implementation for review
      messages.push({
        role: "user",
        content: `Original task: ${task}`,
      });

      // Add all previous messages as context
      for (const entry of history) {
        if (entry.role === "editor") {
          messages.push({
            role: "user",
            content: `[Editor Implementation]: ${entry.content}`,
          });
        } else if (entry.role === "architect") {
          messages.push({
            role: "assistant",
            content: entry.content,
          });
        }
      }

      // Add review instruction
      const lastEditor = this._getLastMessageByRole(history, "editor");
      if (lastEditor) {
        messages.push({
          role: "user",
          content:
            "Please review the Editor's implementation above. Provide feedback in ## Review section. End with ## Verdict: APPROVED if the implementation is correct and complete, or NEEDS_CHANGES with specific change requests.",
        });
      }
    }

    return messages;
  }

  /**
   * Get the last message in history from a specific role.
   * @param {Array} history
   * @param {string} role
   * @returns {Object|null}
   * @private
   */
  _getLastMessageByRole(history, role) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === role) {
        return history[i];
      }
    }
    return null;
  }

  /**
   * Check if an architect response contains an APPROVED verdict.
   * @param {string} response
   * @returns {boolean}
   * @private
   */
  _checkApproval(response) {
    if (!response || typeof response !== "string") {
      return false;
    }
    // Look for explicit APPROVED verdict
    const upperResponse = response.toUpperCase();
    // Check for "APPROVED" in a verdict section context
    const hasApproved = upperResponse.includes("APPROVED");
    // Make sure it's not negated like "NOT APPROVED"
    const hasNeedsChanges = upperResponse.includes("NEEDS_CHANGES") || upperResponse.includes("NEEDS CHANGES");

    if (hasApproved && !hasNeedsChanges) {
      return true;
    }
    return false;
  }

  /**
   * Extract the final output from conversation history.
   * Returns the last editor message content as the final implementation,
   * or the last message content if no editor messages exist.
   * @param {Array} history
   * @returns {string|null}
   * @private
   */
  _extractFinalOutput(history) {
    if (!history || history.length === 0) {
      return null;
    }

    // Prefer the last editor message as the final implementation
    const lastEditor = this._getLastMessageByRole(history, "editor");
    if (lastEditor) {
      return lastEditor.content;
    }

    // Fallback to last message
    return history[history.length - 1].content;
  }

  // ----------------------------------------------------------
  // Database helpers
  // ----------------------------------------------------------

  /**
   * Save or update a session in the database.
   * @param {Object} session
   * @private
   */
  _saveSession(session) {
    if (!this.db) {
      return;
    }

    try {
      this.db.run(
        `INSERT OR REPLACE INTO dual_model_sessions
         (id, task, status, current_role, turn_number, architect_config, editor_config, conversation_history, final_output, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        session.id,
        session.task,
        session.status,
        session.current_role,
        session.turn_number,
        JSON.stringify(session.architect_config),
        JSON.stringify(session.editor_config),
        JSON.stringify(session.conversation_history),
        session.final_output || null,
        session.created_at,
        session.updated_at
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[DualModelManager] _saveSession error:", e.message);
    }
  }

  /**
   * Load a session from the database by ID.
   * @param {string} sessionId
   * @returns {Object|null}
   * @private
   */
  _loadSession(sessionId) {
    if (!this.db) {
      return null;
    }

    try {
      const stmt = this.db.prepare("SELECT * FROM dual_model_sessions WHERE id = ?");
      const row = stmt.get(sessionId);
      if (!row) {
        return null;
      }
      return this._rowToSession(row);
    } catch (e) {
      logger.error("[DualModelManager] _loadSession error:", e.message);
      return null;
    }
  }

  /**
   * Convert a database row to a session object.
   * @param {Object} row
   * @returns {Object}
   * @private
   */
  _rowToSession(row) {
    let conversationHistory = [];
    try {
      conversationHistory = JSON.parse(row.conversation_history || "[]");
    } catch (e) {
      conversationHistory = [];
    }

    let architectConfig = this.config.roles.architect;
    try {
      if (row.architect_config) {
        architectConfig = JSON.parse(row.architect_config);
      }
    } catch (e) {
      // use default
    }

    let editorConfig = this.config.roles.editor;
    try {
      if (row.editor_config) {
        editorConfig = JSON.parse(row.editor_config);
      }
    } catch (e) {
      // use default
    }

    return {
      id: row.id,
      task: row.task,
      status: row.status,
      current_role: row.current_role,
      turn_number: row.turn_number,
      architect_config: architectConfig,
      editor_config: editorConfig,
      conversation_history: conversationHistory,
      final_output: row.final_output || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      maxTurnsPerSession: this.config.maxTurnsPerSession,
    };
  }

  /**
   * Create a safe public representation of a session (no internal configs exposed in detail).
   * @param {Object} session
   * @returns {Object}
   * @private
   */
  _toPublicSession(session) {
    return {
      id: session.id,
      task: session.task,
      status: session.status,
      currentRole: session.current_role,
      turnNumber: session.turn_number,
      maxTurns: session.maxTurnsPerSession || this.config.maxTurnsPerSession,
      conversationHistory: session.conversation_history,
      finalOutput: session.final_output,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = { DualModelManager, DEFAULT_CONFIG, SESSION_STATUSES, ROLES };
