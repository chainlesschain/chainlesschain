/**
 * WebSocket Session Manager
 *
 * Registry and lifecycle management for stateful agent/chat sessions
 * accessed over WebSocket. Each session maintains its own message history,
 * context engine, permanent memory, plan manager, and LLM configuration.
 *
 * Canonical location (moved from src/lib/ws-session-manager.js as part of
 * the CLI Runtime Convergence roadmap, Phase 6a). src/lib/ws-session-manager.js
 * is now a thin re-export shim for backwards compatibility.
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  ExecutionPlan,
  PlanModeManager,
  PlanState,
} from "../../lib/plan-mode.js";
import { CLIContextEngineering } from "../../lib/cli-context-engineering.js";
import { CLIPermanentMemory } from "../../lib/permanent-memory.js";
import {
  createTrustedMcpServerMap,
  resolveMcpServerPolicy,
  normalizeRiskLevel,
  normalizeBoolean,
  selectHigherRiskLevel,
} from "../../runtime/coding-agent-managed-tool-policy.cjs";
import {
  createSession as dbCreateSession,
  saveMessages as dbSaveMessages,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  updateSession as dbUpdateSession,
} from "../../lib/session-manager.js";
import { buildSystemPrompt } from "../../runtime/agent-core.js";
import { SubAgentRegistry } from "../../lib/sub-agent-registry.js";
import {
  createWorktree,
  removeWorktree,
} from "../../harness/worktree-isolator.js";
import { isGitRepo } from "../../lib/git-integration.js";
import {
  CODING_AGENT_MVP_TOOL_NAMES,
  listCodingAgentToolNames,
} from "../../runtime/coding-agent-contract.js";

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
 * @property {string[]} enabledToolNames
 * @property {object|null} hostManagedToolPolicy
 * @property {Array<object>} externalToolDefinitions
 * @property {object} externalToolDescriptors
 * @property {object} externalToolExecutors
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
    this.mcpClient = options.mcpClient || null;
    this.allowedMcpServerNames = Array.isArray(options.allowedMcpServerNames)
      ? options.allowedMcpServerNames
      : null;
    this.allowHighRiskMcpServers = options.allowHighRiskMcpServers === true;
    this.trustedMcpServers = createTrustedMcpServerMap(
      options.mcpServerRegistry || null,
    );

    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  _normalizeEnabledToolNames(enabledToolNames) {
    const knownToolNames = new Set(listCodingAgentToolNames());
    const requested = Array.isArray(enabledToolNames)
      ? enabledToolNames
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      : [];

    const filtered = requested.filter((name) => knownToolNames.has(name));
    if (filtered.length > 0) {
      return [...new Set(filtered)];
    }

    return [...CODING_AGENT_MVP_TOOL_NAMES];
  }

  _buildSessionExternalTools() {
    if (
      !this.mcpClient ||
      !(this.mcpClient.servers instanceof Map) ||
      typeof this.mcpClient.listTools !== "function"
    ) {
      return {
        definitions: [],
        descriptors: {},
        executors: {},
      };
    }

    const definitions = [];
    const descriptors = {};
    const executors = {};
    const seenNames = new Set();

    for (const [serverName, serverState] of this.mcpClient.servers.entries()) {
      const serverPolicy = resolveMcpServerPolicy(serverName, serverState, {
        allowedMcpServerNames: this.allowedMcpServerNames,
        trustedMcpServers: this.trustedMcpServers,
        allowHighRiskMcpServers: this.allowHighRiskMcpServers,
      });

      if (!serverPolicy.allowed) {
        continue;
      }

      const serverTools = Array.isArray(serverState?.tools)
        ? serverState.tools
        : this.mcpClient.listTools(serverName);

      for (const mcpTool of Array.isArray(serverTools) ? serverTools : []) {
        const parsedSchema = this._parseToolSchema(mcpTool?.inputSchema) ||
          this._parseToolSchema(mcpTool?.input_schema) ||
          this._parseToolSchema(mcpTool?.parameters_schema) || {
            type: "object",
            properties: {},
          };
        const riskLevel = selectHigherRiskLevel(
          serverPolicy.securityLevel,
          normalizeRiskLevel(mcpTool?.risk_level, null),
        );
        const isReadOnly =
          normalizeBoolean(mcpTool?.isReadOnly, false) ||
          normalizeBoolean(mcpTool?.is_read_only, false) ||
          riskLevel === "low";

        let toolName = `mcp_${serverName}_${mcpTool?.name || "tool"}`;
        if (seenNames.has(toolName)) {
          let index = 2;
          let candidate = `${toolName}_${index}`;
          while (seenNames.has(candidate)) {
            index += 1;
            candidate = `${toolName}_${index}`;
          }
          toolName = candidate;
        }
        seenNames.add(toolName);

        const descriptor = {
          name: toolName,
          description: mcpTool?.description || `MCP tool from ${serverName}.`,
          inputSchema: parsedSchema,
          isReadOnly,
          riskLevel,
          source: `mcp:${serverName}`,
          mcpMetadata: {
            serverName,
            trusted: serverPolicy.trusted === true,
            securityLevel: serverPolicy.securityLevel,
            requiredPermissions: serverPolicy.requiredPermissions || [],
            capabilities: serverPolicy.capabilities || [],
            originalToolName: mcpTool?.name || null,
            tool: mcpTool || null,
          },
        };

        definitions.push({
          type: "function",
          function: {
            name: descriptor.name,
            description: descriptor.description,
            parameters: JSON.parse(JSON.stringify(descriptor.inputSchema)),
          },
        });
        descriptors[descriptor.name] = descriptor;
        executors[descriptor.name] = {
          kind: "mcp",
          serverName,
          toolName: mcpTool?.name || null,
        };
      }
    }

    return {
      definitions,
      descriptors,
      executors,
    };
  }

  _parseToolSchema(value) {
    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (_err) {
      return null;
    }
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
    const enabledToolNames = this._normalizeEnabledToolNames(
      options.enabledToolNames,
    );
    const externalTools = this._buildSessionExternalTools();
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
    let systemPrompt = buildSystemPrompt(projectRoot);

    // Append optional extension (e.g. cowork template instructions)
    if (options.systemPromptExtension) {
      systemPrompt += "\n\n" + options.systemPromptExtension;
    }

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
      mcpClient: this.mcpClient,
      enabledToolNames,
      hostManagedToolPolicy: options.hostManagedToolPolicy || null,
      externalToolDefinitions: externalTools.definitions,
      externalToolDescriptors: externalTools.descriptors,
      externalToolExecutors: externalTools.executors,
      projectRoot,
      baseProjectRoot,
      rulesContent: null,
      worktreeIsolation: worktreeIsolationRequested,
      worktree,
      planManager,
      contextEngine,
      permanentMemory,
      reviewState: null,
      pendingPatches: new Map(),
      patchHistory: [],
      taskGraph: null,
      shellPolicyOverrides: options.shellPolicyOverrides || null,
      interaction: null, // Set by ws-server after creation
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    if (this.db) {
      try {
        dbUpdateSession(this.db, sessionId, {
          metadata: this._serializeSessionMetadata(session),
        });
      } catch (_err) {
        // Non-critical
      }
    }

    this._bindPlanManagerPersistence(session);
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
      const metadata = this._normalizeSessionMetadata(dbSession.metadata);
      const baseProjectRoot =
        metadata.baseProjectRoot ||
        metadata.projectRoot ||
        this.defaultProjectRoot;
      const workspace = this._restoreSessionWorkspace(
        dbSession.id,
        baseProjectRoot,
        metadata,
      );
      const planManager = this._hydratePlanManager(metadata.planSnapshot);
      const externalTools = this._buildSessionExternalTools();
      let contextEngine = null;
      let permanentMemory = null;

      try {
        const memoryDir = path.join(workspace.projectRoot, "memory");
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
        type: metadata.sessionType || "agent",
        status: "active",
        messages,
        provider: dbSession.provider || "ollama",
        model: dbSession.model || null,
        apiKey: null,
        baseUrl: metadata.baseUrl || "http://localhost:11434",
        mcpClient: this.mcpClient,
        enabledToolNames: this._normalizeEnabledToolNames(
          metadata.enabledToolNames,
        ),
        hostManagedToolPolicy: metadata.hostManagedToolPolicy || null,
        externalToolDefinitions: externalTools.definitions,
        externalToolDescriptors: externalTools.descriptors,
        externalToolExecutors: externalTools.executors,
        projectRoot: workspace.projectRoot,
        baseProjectRoot,
        rulesContent: null,
        worktreeIsolation: metadata.worktreeIsolation === true,
        worktree: workspace.worktree,
        planManager,
        contextEngine,
        permanentMemory,
        reviewState: metadata.reviewState || null,
        pendingPatches: this._hydratePendingPatches(metadata.pendingPatches),
        patchHistory: Array.isArray(metadata.patchHistory)
          ? metadata.patchHistory
          : [],
        taskGraph: this._hydrateTaskGraph(metadata.taskGraph),
        interaction: null,
        createdAt: dbSession.created_at,
        lastActivity: new Date().toISOString(),
      };

      this._bindPlanManagerPersistence(session);
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
    this._persistSessionState(sessionId);

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
      if (typeof session._planPersistenceCleanup === "function") {
        try {
          session._planPersistenceCleanup();
        } catch (_err) {
          // Non-critical.
        }
      }
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
        enabledToolNames: session.enabledToolNames || [],
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
          const metadata = this._normalizeSessionMetadata(dbs.metadata);
          if (!inMemoryIds.has(dbs.id)) {
            results.push({
              id: dbs.id,
              type: metadata.sessionType || "unknown",
              status: "persisted",
              provider: dbs.provider,
              model: dbs.model,
              messageCount: dbs.message_count,
              enabledToolNames: Array.isArray(metadata.enabledToolNames)
                ? metadata.enabledToolNames
                : [],
              baseProjectRoot: metadata.baseProjectRoot || null,
              worktreeIsolation: metadata.worktreeIsolation === true,
              worktree: metadata.worktree || null,
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
    this._persistSessionState(sessionId);
    return session;
  }

  /**
   * Enter explicit review mode for a session. While in review, handlers
   * MUST gate new sendMessage calls until the review is resolved. Reviewer
   * sub-agents and human reviewers both feed into the same `comments` /
   * `checklist` arrays.
   *
   * @param {string} sessionId
   * @param {{
   *   reason?: string,
   *   requestedBy?: string,
   *   checklist?: Array<{ id?: string, title: string, note?: string }>,
   *   blocking?: boolean,
   * }} [options]
   */
  enterReview(sessionId, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // If already in pending review, return the existing state unchanged so
    // callers can retry safely.
    if (session.reviewState && session.reviewState.status === "pending") {
      return session.reviewState;
    }

    const reviewId = `review-${this._generateId()}`;
    const now = new Date().toISOString();
    const checklist = Array.isArray(options.checklist)
      ? options.checklist.map((item, index) => ({
          id: item.id || `chk-${index}-${Date.now()}`,
          title: item.title || `Item ${index + 1}`,
          note: item.note || null,
          done: false,
        }))
      : [];

    session.reviewState = {
      reviewId,
      status: "pending",
      reason: options.reason || null,
      requestedBy: options.requestedBy || "user",
      requestedAt: now,
      resolvedAt: null,
      resolvedBy: null,
      decision: null,
      blocking: options.blocking !== false,
      comments: [],
      checklist,
    };
    session.lastActivity = now;
    this._persistSessionState(sessionId);
    return session.reviewState;
  }

  /**
   * Submit an incremental update to the active review — append a comment
   * and/or toggle a checklist item. Returns the updated reviewState, or null
   * if the session has no active review.
   *
   * @param {string} sessionId
   * @param {{
   *   comment?: { author?: string, content: string },
   *   checklistItemId?: string,
   *   checklistItemDone?: boolean,
   *   checklistItemNote?: string,
   * }} update
   */
  submitReviewComment(sessionId, update = {}) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.reviewState) return null;
    if (session.reviewState.status !== "pending") return null;

    const now = new Date().toISOString();

    if (update.comment && update.comment.content) {
      session.reviewState.comments.push({
        id: `cmt-${session.reviewState.comments.length}-${Date.now()}`,
        author: update.comment.author || "user",
        content: String(update.comment.content),
        timestamp: now,
      });
    }

    if (update.checklistItemId) {
      const item = session.reviewState.checklist.find(
        (c) => c.id === update.checklistItemId,
      );
      if (item) {
        if (typeof update.checklistItemDone === "boolean") {
          item.done = update.checklistItemDone;
        }
        if (typeof update.checklistItemNote === "string") {
          item.note = update.checklistItemNote;
        }
      }
    }

    session.lastActivity = now;
    this._persistSessionState(sessionId);
    return session.reviewState;
  }

  /**
   * Resolve the active review with an approved/rejected decision. After
   * resolve the session can accept new messages again (reviewState becomes
   * non-blocking but is retained for audit).
   *
   * @param {string} sessionId
   * @param {{ decision: "approved"|"rejected", resolvedBy?: string, summary?: string }} payload
   */
  resolveReview(sessionId, payload = {}) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.reviewState) return null;
    if (session.reviewState.status !== "pending") {
      return session.reviewState;
    }

    const decision =
      payload.decision === "approved" || payload.decision === "rejected"
        ? payload.decision
        : "approved";

    session.reviewState.status = decision;
    session.reviewState.decision = decision;
    session.reviewState.resolvedAt = new Date().toISOString();
    session.reviewState.resolvedBy = payload.resolvedBy || "user";
    session.reviewState.blocking = false;
    if (payload.summary) {
      session.reviewState.summary = String(payload.summary);
    }

    session.lastActivity = session.reviewState.resolvedAt;
    this._persistSessionState(sessionId);
    return session.reviewState;
  }

  /**
   * Returns true when the session currently has a blocking review gate
   * open. Callers (e.g. handleSessionMessage) should short-circuit with a
   * REVIEW_BLOCKING error instead of running the agent turn.
   */
  isReviewBlocking(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.reviewState) return false;
    return (
      session.reviewState.status === "pending" &&
      session.reviewState.blocking === true
    );
  }

  getReviewState(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.reviewState || null : null;
  }

  /**
   * Record a proposed patch on the session. Accepts one or more file hunks
   * that a tool wanted to write but should be previewed before they land.
   *
   * @param {string} sessionId
   * @param {{
   *   files: Array<{
   *     path: string,
   *     op?: "create"|"modify"|"delete",
   *     before?: string|null,
   *     after?: string|null,
   *     diff?: string|null,
   *     stats?: { added?: number, removed?: number }
   *   }>,
   *   origin?: string,
   *   reason?: string,
   *   requestId?: string|null
   * }} payload
   * @returns {object|null} patch record, or null if the session is missing
   */
  proposePatch(sessionId, payload = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) return null;

    const patchId = `patch-${this._generateId()}`;
    const now = new Date().toISOString();
    const normalizedFiles = files.map((file, index) => {
      const op = file.op || (file.before == null ? "create" : "modify");
      const stats = this._computePatchStats(file);
      return {
        index,
        path: file.path || `unknown-${index}`,
        op,
        before: file.before == null ? null : String(file.before),
        after: file.after == null ? null : String(file.after),
        diff: file.diff == null ? null : String(file.diff),
        stats,
      };
    });

    const totalStats = normalizedFiles.reduce(
      (acc, file) => ({
        added: acc.added + (file.stats.added || 0),
        removed: acc.removed + (file.stats.removed || 0),
      }),
      { added: 0, removed: 0 },
    );

    const patch = {
      patchId,
      status: "pending",
      origin: payload.origin || "tool",
      reason: payload.reason || null,
      requestId: payload.requestId || null,
      proposedAt: now,
      resolvedAt: null,
      resolvedBy: null,
      files: normalizedFiles,
      stats: {
        fileCount: normalizedFiles.length,
        added: totalStats.added,
        removed: totalStats.removed,
      },
    };

    if (!(session.pendingPatches instanceof Map)) {
      session.pendingPatches = new Map();
    }
    session.pendingPatches.set(patchId, patch);
    session.lastActivity = now;
    this._persistSessionState(sessionId);
    return patch;
  }

  /**
   * Mark a pending patch as applied. Moves the record to patchHistory so it
   * is still visible in the summary view but no longer counts as pending.
   */
  applyPatch(sessionId, patchId, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session || !(session.pendingPatches instanceof Map)) return null;
    const patch = session.pendingPatches.get(patchId);
    if (!patch) return null;

    patch.status = "applied";
    patch.resolvedAt = new Date().toISOString();
    patch.resolvedBy = options.resolvedBy || "user";
    if (options.note) {
      patch.note = String(options.note);
    }

    session.pendingPatches.delete(patchId);
    if (!Array.isArray(session.patchHistory)) {
      session.patchHistory = [];
    }
    session.patchHistory.push(patch);
    session.lastActivity = patch.resolvedAt;
    this._persistSessionState(sessionId);
    return patch;
  }

  /**
   * Discard a pending patch. Same bookkeeping as applyPatch but records a
   * "rejected" decision instead.
   */
  rejectPatch(sessionId, patchId, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session || !(session.pendingPatches instanceof Map)) return null;
    const patch = session.pendingPatches.get(patchId);
    if (!patch) return null;

    patch.status = "rejected";
    patch.resolvedAt = new Date().toISOString();
    patch.resolvedBy = options.resolvedBy || "user";
    if (options.reason) {
      patch.rejectionReason = String(options.reason);
    }

    session.pendingPatches.delete(patchId);
    if (!Array.isArray(session.patchHistory)) {
      session.patchHistory = [];
    }
    session.patchHistory.push(patch);
    session.lastActivity = patch.resolvedAt;
    this._persistSessionState(sessionId);
    return patch;
  }

  /**
   * Return a flattened summary of all pending + resolved patches on the
   * session. Shape matches what the renderer strip consumes:
   *   { pending: [...], history: [...], totals: { added, removed, fileCount } }
   */
  getPatchSummary(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const pending =
      session.pendingPatches instanceof Map
        ? Array.from(session.pendingPatches.values())
        : [];
    const history = Array.isArray(session.patchHistory)
      ? session.patchHistory
      : [];

    const totals = [...pending, ...history].reduce(
      (acc, patch) => ({
        fileCount: acc.fileCount + (patch.stats?.fileCount || 0),
        added: acc.added + (patch.stats?.added || 0),
        removed: acc.removed + (patch.stats?.removed || 0),
      }),
      { fileCount: 0, added: 0, removed: 0 },
    );

    return { pending, history, totals };
  }

  hasPendingPatches(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !(session.pendingPatches instanceof Map)) return false;
    return session.pendingPatches.size > 0;
  }

  _computePatchStats(file) {
    if (file && file.stats && typeof file.stats === "object") {
      return {
        added: Number(file.stats.added) || 0,
        removed: Number(file.stats.removed) || 0,
      };
    }
    const before = file && typeof file.before === "string" ? file.before : "";
    const after = file && typeof file.after === "string" ? file.after : "";
    const beforeLines = before ? before.split(/\r?\n/).length : 0;
    const afterLines = after ? after.split(/\r?\n/).length : 0;
    // Rough heuristic when no explicit diff is provided: full replace counts
    // the entire file as added/removed.
    if (!before && after) return { added: afterLines, removed: 0 };
    if (before && !after) return { added: 0, removed: beforeLines };
    return {
      added: Math.max(0, afterLines - beforeLines),
      removed: Math.max(0, beforeLines - afterLines),
    };
  }

  /**
   * Create or replace the task graph for a session. A graph is a DAG of
   * `nodes` keyed by id; each node has `{ id, title, status, dependsOn[],
   * metadata }`. Returns the serialized graph.
   */
  createTaskGraph(sessionId, payload = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const graphId = payload.graphId || `graph-${this._generateId()}`;
    const now = new Date().toISOString();
    const nodes = {};
    const incomingNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    for (const raw of incomingNodes) {
      if (!raw || !raw.id) continue;
      nodes[raw.id] = this._normalizeTaskNode(raw, now);
    }

    const graph = {
      graphId,
      title: payload.title || null,
      description: payload.description || null,
      status: "active",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      nodes,
      order: Object.keys(nodes),
    };

    session.taskGraph = graph;
    session.lastActivity = now;
    this._persistSessionState(sessionId);
    return this._cloneTaskGraph(graph);
  }

  /**
   * Add a node to the existing task graph. Fails if no graph exists or if
   * the node id already exists.
   */
  addTaskNode(sessionId, payload = {}) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.taskGraph) return null;
    if (!payload || !payload.id) return null;
    const graph = session.taskGraph;
    if (graph.nodes[payload.id]) return null;

    const now = new Date().toISOString();
    graph.nodes[payload.id] = this._normalizeTaskNode(payload, now);
    graph.order = [...(graph.order || []), payload.id];
    graph.updatedAt = now;
    session.lastActivity = now;
    this._persistSessionState(sessionId);
    return this._cloneTaskGraph(graph);
  }

  /**
   * Update a node's status / metadata. Valid statuses: pending, ready,
   * running, completed, failed, skipped.
   */
  updateTaskNode(sessionId, nodeId, updates = {}) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.taskGraph) return null;
    const graph = session.taskGraph;
    const node = graph.nodes[nodeId];
    if (!node) return null;

    const now = new Date().toISOString();
    if (updates.status) {
      node.status = String(updates.status);
      if (node.status === "running" && !node.startedAt) {
        node.startedAt = now;
      }
      if (
        node.status === "completed" ||
        node.status === "failed" ||
        node.status === "skipped"
      ) {
        node.completedAt = now;
      }
    }
    if (updates.title !== undefined) node.title = updates.title;
    if (updates.result !== undefined) node.result = updates.result;
    if (updates.error !== undefined) node.error = updates.error;
    if (updates.metadata !== undefined) {
      node.metadata = { ...(node.metadata || {}), ...(updates.metadata || {}) };
    }
    node.updatedAt = now;
    graph.updatedAt = now;

    // Check graph completion
    const allDone = Object.values(graph.nodes).every((n) =>
      ["completed", "failed", "skipped"].includes(n.status),
    );
    if (allDone) {
      graph.status = Object.values(graph.nodes).some(
        (n) => n.status === "failed",
      )
        ? "failed"
        : "completed";
      graph.completedAt = now;
    }

    session.lastActivity = now;
    this._persistSessionState(sessionId);
    return this._cloneTaskGraph(graph);
  }

  /**
   * Advance the task graph: mark any `pending` node whose dependencies are
   * all `completed` (or `skipped`) as `ready`. Returns the list of node ids
   * that became ready and the updated graph snapshot.
   */
  advanceTaskGraph(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.taskGraph) return null;
    const graph = session.taskGraph;

    const becameReady = [];
    for (const node of Object.values(graph.nodes)) {
      if (node.status !== "pending") continue;
      const deps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
      const blocked = deps.some((depId) => {
        const dep = graph.nodes[depId];
        if (!dep) return true;
        return dep.status !== "completed" && dep.status !== "skipped";
      });
      if (!blocked) {
        node.status = "ready";
        node.updatedAt = new Date().toISOString();
        becameReady.push(node.id);
      }
    }

    if (becameReady.length > 0) {
      graph.updatedAt = new Date().toISOString();
      session.lastActivity = graph.updatedAt;
      this._persistSessionState(sessionId);
    }

    return {
      graph: this._cloneTaskGraph(graph),
      becameReady,
    };
  }

  getTaskGraph(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.taskGraph) return null;
    return this._cloneTaskGraph(session.taskGraph);
  }

  clearTaskGraph(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.taskGraph = null;
    session.lastActivity = new Date().toISOString();
    this._persistSessionState(sessionId);
    return true;
  }

  _normalizeTaskNode(raw, now) {
    const status = raw.status || "pending";
    return {
      id: raw.id,
      title: raw.title || raw.id,
      description: raw.description || null,
      status,
      dependsOn: Array.isArray(raw.dependsOn)
        ? raw.dependsOn.filter((x) => typeof x === "string")
        : [],
      metadata:
        raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
      startedAt: raw.startedAt || null,
      completedAt: raw.completedAt || null,
      result: raw.result || null,
      error: raw.error || null,
    };
  }

  _cloneTaskGraph(graph) {
    if (!graph) return null;
    return {
      graphId: graph.graphId,
      title: graph.title,
      description: graph.description,
      status: graph.status,
      createdAt: graph.createdAt,
      updatedAt: graph.updatedAt,
      completedAt: graph.completedAt,
      order: Array.isArray(graph.order)
        ? [...graph.order]
        : Object.keys(graph.nodes || {}),
      nodes: Object.fromEntries(
        Object.entries(graph.nodes || {}).map(([id, node]) => [
          id,
          {
            ...node,
            dependsOn: [...(node.dependsOn || [])],
            metadata: { ...(node.metadata || {}) },
          },
        ]),
      ),
    };
  }

  _hydrateTaskGraph(data) {
    if (!data || typeof data !== "object") return null;
    if (!data.graphId || !data.nodes) return null;
    const nodes = {};
    for (const [id, node] of Object.entries(data.nodes)) {
      nodes[id] = this._normalizeTaskNode(
        { ...node, id },
        node.createdAt || new Date().toISOString(),
      );
    }
    return {
      graphId: data.graphId,
      title: data.title || null,
      description: data.description || null,
      status: data.status || "active",
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      completedAt: data.completedAt || null,
      order: Array.isArray(data.order) ? data.order : Object.keys(nodes),
      nodes,
    };
  }

  _serializeTaskGraph(graph) {
    if (!graph) return null;
    return this._cloneTaskGraph(graph);
  }

  /**
   * Persist current messages for a session.
   */
  persistMessages(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !this.db) return;

    try {
      dbSaveMessages(
        this.db,
        sessionId,
        session.messages,
        this._serializeSessionMetadata(session),
      );
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

  _persistSessionState(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !this.db) return;

    try {
      dbSaveMessages(
        this.db,
        sessionId,
        session.messages,
        this._serializeSessionMetadata(session),
      );
    } catch (_err) {
      // Non-critical
    }

    session.lastActivity = new Date().toISOString();
  }

  _serializeSessionMetadata(session) {
    return {
      version: 1,
      sessionType: session.type || "agent",
      projectRoot: session.projectRoot || null,
      baseProjectRoot: session.baseProjectRoot || session.projectRoot || null,
      baseUrl: session.baseUrl || null,
      hostManagedToolPolicy: session.hostManagedToolPolicy || null,
      enabledToolNames: session.enabledToolNames || [],
      worktreeIsolation: session.worktreeIsolation === true,
      worktree: session.worktree || null,
      planSnapshot: this._serializePlanManager(session.planManager),
      reviewState: session.reviewState || null,
      pendingPatches:
        session.pendingPatches instanceof Map
          ? Array.from(session.pendingPatches.values())
          : [],
      patchHistory: Array.isArray(session.patchHistory)
        ? session.patchHistory
        : [],
      taskGraph: this._serializeTaskGraph(session.taskGraph),
    };
  }

  _hydratePendingPatches(list) {
    const map = new Map();
    if (Array.isArray(list)) {
      for (const patch of list) {
        if (patch && patch.patchId) {
          map.set(patch.patchId, patch);
        }
      }
    }
    return map;
  }

  _serializePlanManager(planManager) {
    if (!planManager) {
      return null;
    }

    return {
      state: planManager.state || PlanState.INACTIVE,
      currentPlan: planManager.currentPlan || null,
      history: Array.isArray(planManager.history) ? planManager.history : [],
      blockedToolLog: Array.isArray(planManager.blockedToolLog)
        ? planManager.blockedToolLog
        : [],
    };
  }

  _normalizeSessionMetadata(metadata) {
    if (!metadata) {
      return {};
    }

    if (typeof metadata === "string") {
      try {
        return JSON.parse(metadata);
      } catch (_err) {
        return {};
      }
    }

    return typeof metadata === "object" ? metadata : {};
  }

  _hydratePlanManager(snapshot) {
    const planManager = new PlanModeManager();
    if (!snapshot || typeof snapshot !== "object") {
      return planManager;
    }

    planManager.state = snapshot.state || PlanState.INACTIVE;
    planManager.currentPlan = snapshot.currentPlan
      ? new ExecutionPlan(snapshot.currentPlan)
      : null;
    planManager.history = Array.isArray(snapshot.history)
      ? snapshot.history.map((plan) => new ExecutionPlan(plan))
      : [];
    planManager.blockedToolLog = Array.isArray(snapshot.blockedToolLog)
      ? [...snapshot.blockedToolLog]
      : [];
    return planManager;
  }

  _restoreSessionWorkspace(sessionId, baseProjectRoot, metadata = {}) {
    const requestedWorktreeIsolation = metadata.worktreeIsolation === true;
    const persistedWorktreePath = metadata.worktree?.path || null;

    if (!requestedWorktreeIsolation) {
      return {
        projectRoot: metadata.projectRoot || baseProjectRoot,
        worktree: null,
      };
    }

    if (persistedWorktreePath && fs.existsSync(persistedWorktreePath)) {
      return {
        projectRoot: persistedWorktreePath,
        worktree: {
          ...(metadata.worktree || {}),
          baseProjectRoot,
        },
      };
    }

    try {
      return this._prepareSessionWorkspace(baseProjectRoot, sessionId, {
        worktreeIsolation: true,
      });
    } catch (_err) {
      return {
        projectRoot: baseProjectRoot,
        worktree: null,
      };
    }
  }

  _bindPlanManagerPersistence(session) {
    if (
      !session?.id ||
      !session.planManager ||
      typeof session.planManager.on !== "function"
    ) {
      return;
    }

    if (typeof session._planPersistenceCleanup === "function") {
      session._planPersistenceCleanup();
    }

    const persist = () => this._persistSessionState(session.id);
    const events = [
      "enter",
      "exit",
      "item-added",
      "plan-ready",
      "plan-approved",
      "tool-blocked",
    ];

    for (const eventName of events) {
      session.planManager.on(eventName, persist);
    }

    session._planPersistenceCleanup = () => {
      if (typeof session.planManager.off === "function") {
        for (const eventName of events) {
          session.planManager.off(eventName, persist);
        }
      }
    };
  }
}
