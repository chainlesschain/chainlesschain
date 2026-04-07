/**
 * WebSocket Session Manager
 *
 * Registry and lifecycle management for stateful agent/chat sessions
 * accessed over WebSocket. Each session maintains its own message history,
 * context engine, permanent memory, plan manager, and LLM configuration.
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PlanModeManager } from "./plan-mode.js";
import { CLIContextEngineering } from "./cli-context-engineering.js";
import { CLIPermanentMemory } from "./permanent-memory.js";
import {
  createSession as dbCreateSession,
  saveMessages as dbSaveMessages,
  getSession as dbGetSession,
  listSessions as dbListSessions,
} from "./session-manager.js";
import { buildSystemPrompt } from "./agent-core.js";
import { SubAgentRegistry } from "./sub-agent-registry.js";
import { createWorktree, removeWorktree } from "./worktree-isolator.js";
import { isGitRepo } from "./git-integration.js";

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {"agent"|"chat"} type
 * @property {"active"|"closed"} status
 * @property {Array} messages
 * @property {string} provider
 * @property {string} model
 * @property {string|null} apiKey
 * @property {string|null} baseUrl
 * @property {string} projectRoot
 * @property {string} baseProjectRoot
 * @property {string|null} rulesContent
 * @property {object|null} hostManagedToolPolicy
 * @property {boolean} worktreeIsolation
 * @property {object|null} worktree
 * @property {PlanModeManager} planManager
 * @property {CLIContextEngineering|null} contextEngine
 * @property {CLIPermanentMemory|null} permanentMemory
 * @property {import("./interaction-adapter.js").WebSocketInteractionAdapter|null} interaction
 * @property {string} createdAt
 * @property {string} lastActivity
 */

export class WSSessionManager {
  /**
   * @param {object} options
   * @param {object} [options.db] - Database instance
   * @param {object} [options.config] - Config object
   * @param {string} [options.defaultProjectRoot] - Default project root
   */
  constructor(options = {}) {
    this.db = options.db || null;
    this.config = options.config || {};
    this.defaultProjectRoot = options.defaultProjectRoot || process.cwd();

    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  /**
   * Generate a unique session ID
   */
  _generateId() {
    const hash = createHash("sha256")
      .update(Math.random().toString() + Date.now().toString())
      .digest("hex")
      .slice(0, 8);
    return `ws-session-${Date.now()}-${hash}`;
  }

  /**
   * Create a new session.
   *
   * @param {object} options
   * @param {"agent"|"chat"} [options.type="agent"]
   * @param {string} [options.projectRoot]
   * @param {string} [options.provider="ollama"]
   * @param {string} [options.model]
   * @param {string} [options.apiKey]
   * @param {string} [options.baseUrl]
   * @param {object} [options.hostManagedToolPolicy]
   * @returns {{ sessionId: string }}
   */
  createSession(options = {}) {
    const sessionId = this._generateId();
    const type = options.type || "agent";
    const baseProjectRoot = options.projectRoot || this.defaultProjectRoot;
    const cfgLlm = this.config?.llm || {};
    const provider = options.provider || cfgLlm.provider || "ollama";
    const model =
      options.model ||
      cfgLlm.model ||
      (provider === "ollama" ? "qwen2.5:7b" : null);
    const baseUrl =
      options.baseUrl || cfgLlm.baseUrl || "http://localhost:11434";
    const apiKey = options.apiKey || cfgLlm.apiKey || null;
    const worktreeIsolationRequested = options.worktreeIsolation === true;
    const isolatedWorkspace = this._prepareSessionWorkspace(
      baseProjectRoot,
      sessionId,
      {
        worktreeIsolation: worktreeIsolationRequested,
      },
    );
    const projectRoot = isolatedWorkspace.projectRoot;
    const worktree = isolatedWorkspace.worktree;

    // Project context (rules.md, persona) is now loaded by buildSystemPrompt()

    // Create plan manager (non-singleton, per-session)
    const planManager = new PlanModeManager();

    // Create context engine
    let contextEngine = null;
    let permanentMemory = null;
    try {
      const memoryDir = path.join(projectRoot, "memory");
      permanentMemory = new CLIPermanentMemory({
        db: this.db,
        memoryDir,
      });
      permanentMemory.initialize();
    } catch (_err) {
      // Non-critical
    }

    try {
      contextEngine = new CLIContextEngineering({
        db: this.db,
        permanentMemory,
      });
    } catch (_err) {
      // Non-critical
    }

    // Build initial system prompt (includes persona + rules.md)
    const systemPrompt = buildSystemPrompt(projectRoot);

    const messages = [{ role: "system", content: systemPrompt }];

    // Persist to DB
    if (this.db) {
      try {
        dbCreateSession(this.db, {
          id: sessionId,
          title: `WS ${type} ${new Date().toISOString().slice(0, 10)}`,
          provider,
          model: model || "",
          messages,
        });
      } catch (_err) {
        // Non-critical
      }
    }

    const session = {
      id: sessionId,
      type,
      status: "active",
      messages,
      provider,
      model,
      apiKey,
      baseUrl,
      hostManagedToolPolicy: options.hostManagedToolPolicy || null,
      projectRoot,
      baseProjectRoot,
      rulesContent: null,
      worktreeIsolation: worktreeIsolationRequested,
      worktree,
      planManager,
      contextEngine,
      permanentMemory,
      interaction: null, // Set by ws-server after creation
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);

    return { sessionId };
  }

  /**
   * Resume an existing session from DB.
   *
   * @param {string} sessionId
   * @returns {Session|null}
   */
  resumeSession(sessionId) {
    // Check in-memory first
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      session.status = "active";
      session.lastActivity = new Date().toISOString();
      return session;
    }

    // Try loading from DB
    if (!this.db) return null;

    try {
      const dbSession = dbGetSession(this.db, sessionId);
      if (!dbSession) return null;

      const messages =
        typeof dbSession.messages === "string"
          ? JSON.parse(dbSession.messages)
          : dbSession.messages || [];

      const planManager = new PlanModeManager();
      let contextEngine = null;
      let permanentMemory = null;

      try {
        const memoryDir = path.join(this.defaultProjectRoot, "memory");
        permanentMemory = new CLIPermanentMemory({
          db: this.db,
          memoryDir,
        });
        permanentMemory.initialize();
      } catch (_err) {
        // Non-critical
      }

      try {
        contextEngine = new CLIContextEngineering({
          db: this.db,
          permanentMemory,
        });
      } catch (_err) {
        // Non-critical
      }

      const session = {
        id: dbSession.id,
        type: "agent", // Default, since DB doesn't store type
        status: "active",
        messages,
        provider: dbSession.provider || "ollama",
        model: dbSession.model || null,
        apiKey: null,
        baseUrl: "http://localhost:11434",
        hostManagedToolPolicy: null,
        projectRoot: this.defaultProjectRoot,
        baseProjectRoot: this.defaultProjectRoot,
        rulesContent: null,
        worktreeIsolation: false,
        worktree: null,
        planManager,
        contextEngine,
        permanentMemory,
        interaction: null,
        createdAt: dbSession.created_at,
        lastActivity: new Date().toISOString(),
      };

      this.sessions.set(session.id, session);
      return session;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Close a session and persist final state.
   *
   * @param {string} sessionId
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "closed";

    // Persist messages to DB
    if (this.db) {
      try {
        dbSaveMessages(this.db, sessionId, session.messages);
      } catch (_err) {
        // Non-critical
      }
    }

    // Auto-summarize into permanent memory
    if (session.permanentMemory && session.messages.length > 4) {
      try {
        session.permanentMemory.autoSummarize(session.messages);
      } catch (_err) {
        // Non-critical
      }
    }

    // Force-complete any active sub-agents for this session
    try {
      SubAgentRegistry.getInstance().forceCompleteAll(sessionId);
    } catch (_err) {
      // Non-critical
    }

    // Clean up plan manager listeners
    if (session.planManager) {
      session.planManager.removeAllListeners();
    }

    if (session.worktree?.path && session.baseProjectRoot) {
      try {
        removeWorktree(session.baseProjectRoot, session.worktree.path, {
          deleteBranch: true,
        });
      } catch (_err) {
        // Best-effort cleanup.
      }
    }

    this.sessions.delete(sessionId);
  }

  /**
   * List all sessions (in-memory + DB).
   *
   * @returns {Array<{id, type, status, createdAt, lastActivity}>}
   */
  listSessions() {
    const results = [];

    // In-memory active sessions
    for (const [, session] of this.sessions) {
      results.push({
        id: session.id,
        type: session.type,
        status: session.status,
        provider: session.provider,
        model: session.model,
        messageCount: session.messages.length,
        baseProjectRoot: session.baseProjectRoot,
        worktreeIsolation: session.worktreeIsolation === true,
        worktree: session.worktree || null,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      });
    }

    // DB sessions (exclude already-listed in-memory ones)
    if (this.db) {
      try {
        const dbSessions = dbListSessions(this.db, { limit: 20 });
        const inMemoryIds = new Set(this.sessions.keys());
        for (const dbs of dbSessions) {
          if (!inMemoryIds.has(dbs.id)) {
            results.push({
              id: dbs.id,
              type: "unknown",
              status: "persisted",
              provider: dbs.provider,
              model: dbs.model,
              messageCount: dbs.message_count,
              createdAt: dbs.created_at,
              lastActivity: dbs.updated_at,
            });
          }
        }
      } catch (_err) {
        // Non-critical
      }
    }

    return results;
  }

  /**
   * Get a session by ID.
   *
   * @param {string} sessionId
   * @returns {Session|null}
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Update host-managed tool policy for an active session.
   *
   * @param {string} sessionId
   * @param {object|null} hostManagedToolPolicy
   * @returns {Session|null}
   */
  updateSessionPolicy(sessionId, hostManagedToolPolicy) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.hostManagedToolPolicy = hostManagedToolPolicy || null;
    session.lastActivity = new Date().toISOString();
    return session;
  }

  /**
   * Persist current messages for a session.
   */
  persistMessages(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !this.db) return;

    try {
      dbSaveMessages(this.db, sessionId, session.messages);
    } catch (_err) {
      // Non-critical
    }

    session.lastActivity = new Date().toISOString();
  }

  _prepareSessionWorkspace(projectRoot, sessionId, options = {}) {
    if (options.worktreeIsolation !== true) {
      return {
        projectRoot,
        worktree: null,
      };
    }

    if (!isGitRepo(projectRoot)) {
      throw new Error(
        `Worktree isolation requires a git repository: ${projectRoot}`,
      );
    }

    const branchName = `coding-agent/${sessionId}`;
    const worktree = createWorktree(projectRoot, branchName);

    return {
      projectRoot: worktree.path,
      worktree: {
        branch: worktree.branch,
        path: worktree.path,
        baseProjectRoot: projectRoot,
      },
    };
  }
}
