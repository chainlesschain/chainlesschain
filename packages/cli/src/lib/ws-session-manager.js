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
import { ExecutionPlan, PlanModeManager, PlanState } from "./plan-mode.js";
import { CLIContextEngineering } from "./cli-context-engineering.js";
import { CLIPermanentMemory } from "./permanent-memory.js";
import {
  createTrustedMcpServerMap,
  resolveMcpServerPolicy,
  normalizeRiskLevel,
  normalizeBoolean,
  selectHigherRiskLevel,
} from "../runtime/coding-agent-managed-tool-policy.cjs";
import {
  createSession as dbCreateSession,
  saveMessages as dbSaveMessages,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  updateSession as dbUpdateSession,
} from "./session-manager.js";
import { buildSystemPrompt } from "./agent-core.js";
import { SubAgentRegistry } from "./sub-agent-registry.js";
import { createWorktree, removeWorktree } from "./worktree-isolator.js";
import { isGitRepo } from "./git-integration.js";
import {
  CODING_AGENT_MVP_TOOL_NAMES,
  listCodingAgentToolNames,
} from "../runtime/coding-agent-contract.js";

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
    };
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
