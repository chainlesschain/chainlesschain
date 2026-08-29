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
import { resolveCliContextMemoryCutover } from "../../lib/context-memory-kernel/authority.js";
import {
  createTrustedMcpServerMap,
  resolveMcpServerPolicy,
  normalizeRiskLevel,
  selectHigherRiskLevel,
} from "../../runtime/coding-agent-managed-tool-policy.cjs";
import {
  createSession as dbCreateSession,
  saveMessages as dbSaveMessages,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  updateSession as dbUpdateSession,
  deleteSession as dbDeleteSession,
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
import {
  registerHostHooksV2Workspace,
  releaseRegisteredHostHooksV2Workspace,
} from "../../lib/hooks-v2-workspace-context.js";
import { mcpEffectDescriptorFields } from "../../lib/mcp-effect-contract.js";
import {
  sanitizePersistedMessages,
  sanitizePersistedNonSystemMessages,
} from "../../lib/session-message-provenance.js";
import {
  appendWsSessionStateEvent,
  createWsSessionState,
  getWsSessionStateSnapshot,
  hydrateWsSessionState,
  recoverWsSessionState,
  serializeWsSessionState,
  WS_SESSION_STATE_SCHEMA,
  WS_SESSION_STATE_VERSION,
} from "./ws-session-state.js";
import {
  appendEvent as appendCanonicalSessionEvent,
  findLatestEvent as findLatestCanonicalSessionEvent,
} from "../../harness/jsonl-session-store.js";

export const WS_SESSION_ROLLOUT_EVENT = "ws_session_state";
const WS_SESSION_ROLLOUT_SCHEMA = "chainlesschain.ws-session-rollout/v1";

function canonicalWsStateError(code, message) {
  const error = new Error(message);
  error.name = "CanonicalWsSessionStateError";
  error.code = code;
  return error;
}

function hydrateCanonicalWsSessionState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== WS_SESSION_STATE_SCHEMA ||
    value.version !== WS_SESSION_STATE_VERSION ||
    !value.snapshot ||
    typeof value.snapshot !== "object" ||
    !Array.isArray(value.events)
  ) {
    throw canonicalWsStateError(
      "CC_WS_CANONICAL_STATE_CORRUPT",
      "canonical WebSocket session state has an invalid envelope",
    );
  }
  const journal = hydrateWsSessionState(value);
  if (journal.events.length !== value.events.length) {
    throw canonicalWsStateError(
      "CC_WS_CANONICAL_STATE_CORRUPT",
      "canonical WebSocket session state contains a revision gap",
    );
  }
  return journal;
}

function normalizeHostWorkspaceRoot(workspaceRoot) {
  if (
    typeof workspaceRoot !== "string" ||
    workspaceRoot.length === 0 ||
    workspaceRoot.includes("\0")
  ) {
    return null;
  }
  try {
    return path.resolve(workspaceRoot);
  } catch {
    return null;
  }
}

function normalizeCanonicalHostSystemPrefix(messages) {
  const clean = sanitizePersistedMessages(messages, { strict: true });
  if (clean.some((message) => message.role !== "system")) {
    throw new TypeError("Canonical WS host prefix must contain only systems");
  }
  return Object.freeze(clean.map((message) => Object.freeze(message)));
}

function bindCanonicalHostSystemPrefix(session, messages) {
  const prefix = normalizeCanonicalHostSystemPrefix(messages);
  Object.defineProperty(session, "_canonicalHostSystemPrefix", {
    configurable: true,
    value: prefix,
  });
  return prefix;
}

function bindSessionHooksV2Workspace(
  session,
  workspaceRoot,
  { releaseOnClose = false, protectedBindingId = null } = {},
) {
  const binding = workspaceRoot
    ? registerHostHooksV2Workspace(workspaceRoot)
    : null;
  Object.defineProperty(session, "hooksV2WorkspaceBindingId", {
    value: binding?.bindingId || null,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(session, "_releaseHooksV2WorkspaceBindingOnClose", {
    value: Boolean(
      binding &&
      releaseOnClose === true &&
      binding.bindingId !== protectedBindingId,
    ),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return session.hooksV2WorkspaceBindingId;
}

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
 * @property {object|null} sessionBudgetRoot
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
    // Snapshot constructor authority once. Later request fields (and even a
    // mutable compatibility assignment to defaultProjectRoot) cannot replace
    // the root used for strong Hooks v2 execution.
    this._hooksV2HostWorkspaceRoot = normalizeHostWorkspaceRoot(
      this.defaultProjectRoot,
    );
    this._hooksV2HostWorkspaceBindingId = this._hooksV2HostWorkspaceRoot
      ? registerHostHooksV2Workspace(this._hooksV2HostWorkspaceRoot).bindingId
      : null;
    this.mcpClient = options.mcpClient || null;
    this.allowedMcpServerNames = Array.isArray(options.allowedMcpServerNames)
      ? options.allowedMcpServerNames
      : null;
    this.allowHighRiskMcpServers = options.allowHighRiskMcpServers === true;
    this.trustedMcpServers = createTrustedMcpServerMap(
      options.mcpServerRegistry || null,
    );
    this.defaultSystemPromptExtension =
      options.defaultSystemPromptExtension || null;
    this.canonicalSessionStore = {
      appendEvent: appendCanonicalSessionEvent,
      findLatestEvent: findLatestCanonicalSessionEvent,
      ...(options.canonicalSessionStore || {}),
    };

    /** @type {Map<string, Session>} */
    this.sessions = new Map();

    // Cap concurrent in-memory sessions. Each session holds a handler +
    // interaction adapter + agent context, and nothing reaps them on client
    // disconnect (they persist for resume; only closeSession removes one). An
    // authenticated WS client could otherwise spam session-create to exhaust
    // memory — this bounds it (mirrors the PTY manager's cap). Generous enough
    // for legit multi-session use; resume does not create, so reconnecting to
    // an existing session is never blocked by the cap. Override per manager.
    this.maxSessions = Number.isFinite(options.maxSessions)
      ? options.maxSessions
      : 100;

    // Cap patch bookkeeping per session. `patchHistory` is append-only (every
    // applyPatch/rejectPatch pushes, nothing trims) and `pendingPatches` grows
    // with each proposePatch — both are serialized in full by
    // _persistSessionState on every session op, so unbounded growth means
    // O(n) memory AND an O(n²) rewrite cost over a long session (and a tool
    // proposing many large before/after/diff blobs amplifies it). Keep a
    // recent window; oldest entries fall off (FIFO).
    this.maxPatchHistory = Number.isFinite(options.maxPatchHistory)
      ? options.maxPatchHistory
      : 200;
    this.maxPendingPatches = Number.isFinite(options.maxPendingPatches)
      ? options.maxPendingPatches
      : 50;
    // The entry-count caps above bound how MANY patches are kept, but a SINGLE
    // proposed patch (a client-reachable `patch-propose`) could still carry an
    // unbounded number of files, each with unbounded before/after/diff content
    // — all held in memory AND serialized to disk by _persistSessionState. One
    // file with a multi-GB diff string is enough to OOM. Bound a single patch's
    // payload: cap the file count and truncate each content field.
    this.maxPatchFiles = Number.isFinite(options.maxPatchFiles)
      ? options.maxPatchFiles
      : 200;
    this.maxPatchContentChars = Number.isFinite(options.maxPatchContentChars)
      ? options.maxPatchContentChars
      : 512 * 1024; // 512 KB per before/after/diff field
  }

  /**
   * Truncate a patch content field (before/after/diff) to maxPatchContentChars,
   * appending a visible marker. Preserves the null-vs-string distinction (a null
   * field stays null — it signals create/delete ops). Pure.
   */
  _capPatchContent(value) {
    if (value == null) return null;
    const s = String(value);
    if (s.length <= this.maxPatchContentChars) return s;
    return (
      s.slice(0, this.maxPatchContentChars) +
      `\n…[truncated for storage: field was ${s.length} chars]`
    );
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
        const effectFields = mcpEffectDescriptorFields(mcpTool, {
          sourceTrusted: serverPolicy.trusted === true,
          provenance: `desktop-mcp-registry:${serverName}`,
        });
        const riskLevel = selectHigherRiskLevel(
          serverPolicy.securityLevel,
          normalizeRiskLevel(mcpTool?.risk_level, null),
          effectFields.riskLevel,
        );

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
          ...effectFields,
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
   * @param {object} [options.sessionBudgetRoot]
   * @param {boolean} [options.requireDurable=false]
   * @returns {{ sessionId: string }}
   */
  createSession(options = {}) {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `max_sessions_exceeded: ${this.maxSessions} concurrent sessions reached — close some before creating more`,
      );
    }
    const sessionId = options.sessionId || this._generateId();
    if (this.sessions.has(sessionId)) {
      const error = new Error(`session already exists: ${sessionId}`);
      error.code = "CC_WS_SESSION_EXISTS";
      throw error;
    }
    const contextMemoryCutover = resolveCliContextMemoryCutover({
      scopeKey: `cli:ws-session:${sessionId}`,
    });
    const requireDurable = options.requireDurable === true;
    if (requireDurable && !this.db) {
      const error = new Error(
        "Durable WebSocket session creation requires a configured database",
      );
      error.code = "CC_WS_DURABLE_SESSION_REQUIRED";
      throw error;
    }
    const type = options.type || "agent";
    const baseProjectRoot = options.projectRoot || this.defaultProjectRoot;
    const hostAuthorizedBaseRoot =
      normalizeHostWorkspaceRoot(baseProjectRoot) ===
      this._hooksV2HostWorkspaceRoot
        ? this._hooksV2HostWorkspaceRoot
        : null;
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
    if (!contextMemoryCutover.canonical) {
      try {
        const memoryDir = path.join(projectRoot, "memory");
        permanentMemory = new CLIPermanentMemory({
          db: this.db,
          memoryDir,
        });
        permanentMemory.initialize();
      } catch (_err) {
        permanentMemory = null;
      }
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

    // Append optional extension (e.g. cowork template instructions, or bundle AGENTS.md)
    const promptExtension =
      options.systemPromptExtension || this.defaultSystemPromptExtension;
    if (promptExtension) {
      systemPrompt += "\n\n" + promptExtension;
    }

    const messages = [{ role: "system", content: systemPrompt }];

    // Persist to DB
    let databaseCreated = false;
    if (this.db) {
      try {
        dbCreateSession(this.db, {
          id: sessionId,
          title: `WS ${type} ${new Date().toISOString().slice(0, 10)}`,
          provider,
          model: model || "",
          messages,
        });
        databaseCreated = true;
      } catch (error) {
        if (requireDurable) {
          this._discardSessionResources({
            planManager,
            worktree,
            baseProjectRoot,
          });
          error.code ||= "CC_WS_SESSION_PERSISTENCE_FAILED";
          throw error;
        }
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
      sessionBudgetRoot: options.sessionBudgetRoot || null,
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
    bindCanonicalHostSystemPrefix(session, messages);
    this._bindSessionStateJournal(session, createWsSessionState());
    bindSessionHooksV2Workspace(
      session,
      hostAuthorizedBaseRoot
        ? worktree
          ? normalizeHostWorkspaceRoot(projectRoot)
          : hostAuthorizedBaseRoot
        : null,
      {
        releaseOnClose: Boolean(hostAuthorizedBaseRoot && worktree),
        protectedBindingId: this._hooksV2HostWorkspaceBindingId,
      },
    );

    if (this.db && databaseCreated) {
      try {
        dbUpdateSession(this.db, sessionId, {
          metadata: this._serializeSessionMetadata(session),
        });
      } catch (error) {
        if (requireDurable) {
          const cleanupErrors = [];
          try {
            this._discardSessionResources(session);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
          try {
            dbDeleteSession(this.db, sessionId);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
          error.code ||= "CC_WS_SESSION_PERSISTENCE_FAILED";
          if (cleanupErrors.length > 0) {
            throw new AggregateError(
              [error, ...cleanupErrors],
              "Durable WebSocket session creation and rollback both failed",
            );
          }
          throw error;
        }
      }
    }

    this._bindPlanManagerPersistence(session);
    this.sessions.set(sessionId, session);

    return { sessionId };
  }

  /**
   * Remove a newly-created session that was never exposed to a client.
   * Unlike closeSession(), this compensates the database insert instead of
   * persisting a misleading closed session after bootstrap failed.
   */
  rollbackSessionCreation(sessionId) {
    const session = this.sessions.get(sessionId);
    const cleanupErrors = [];
    if (session) {
      try {
        this._discardSessionResources(session);
      } catch (error) {
        cleanupErrors.push(error);
      }
      this.sessions.delete(sessionId);
    }
    if (this.db) {
      try {
        dbDeleteSession(this.db, sessionId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `WebSocket session creation rollback failed: ${sessionId}`,
      );
    }
    return Boolean(session);
  }

  _discardSessionResources(session) {
    if (!session) return;
    if (
      session._releaseHooksV2WorkspaceBindingOnClose === true &&
      session.hooksV2WorkspaceBindingId
    ) {
      releaseRegisteredHostHooksV2Workspace(session.hooksV2WorkspaceBindingId);
    }
    if (typeof session._planPersistenceCleanup === "function") {
      session._planPersistenceCleanup();
    }
    session.planManager?.removeAllListeners?.();
    if (session.worktree?.path && session.baseProjectRoot) {
      removeWorktree(session.baseProjectRoot, session.worktree.path, {
        deleteBranch: true,
      });
    }
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
      const canonicalSessionState =
        metadata.canonicalJsonlSession === true
          ? this._readCanonicalSessionState(dbSession.id, { required: true })
          : null;
      const sessionStateJournal = canonicalSessionState
        ? hydrateCanonicalWsSessionState(canonicalSessionState)
        : hydrateWsSessionState(
            metadata.sessionState,
            Object.prototype.hasOwnProperty.call(metadata, "planSnapshot")
              ? {
                  // Legacy/current metadata migration is pass-through only.
                  // PlanModeManager remains the sole owner of Plan hydration and
                  // persistence.
                  planSnapshot: metadata.planSnapshot,
                }
              : {},
          );
      const stateRecovery = recoverWsSessionState(sessionStateJournal, {
        reason: "process_restart",
      });
      const externalTools = this._buildSessionExternalTools();
      const contextMemoryCutover = resolveCliContextMemoryCutover({
        scopeKey: `cli:ws-session:${dbSession.id}`,
      });
      let contextEngine = null;
      let permanentMemory = null;

      if (!contextMemoryCutover.canonical) {
        try {
          const memoryDir = path.join(workspace.projectRoot, "memory");
          permanentMemory = new CLIPermanentMemory({
            db: this.db,
            memoryDir,
          });
          permanentMemory.initialize();
        } catch (_err) {
          permanentMemory = null;
        }
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
        sessionBudgetRoot: metadata.sessionBudgetRoot || null,
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
        patchHistory: this._boundPatchHistory(metadata.patchHistory),
        taskGraph: this._hydrateTaskGraph(metadata.taskGraph),
        interaction: null,
        canonicalJsonlSession:
          canonicalSessionState != null ||
          metadata.canonicalJsonlSession === true,
        createdAt: dbSession.created_at,
        lastActivity: new Date().toISOString(),
      };
      if (Array.isArray(metadata.canonicalHostSystemPrefix)) {
        bindCanonicalHostSystemPrefix(
          session,
          metadata.canonicalHostSystemPrefix,
        );
      }
      this._bindSessionStateJournal(session, sessionStateJournal);
      const recoveredHooksWorkspaceRoot =
        metadata.worktreeIsolation !== true &&
        normalizeHostWorkspaceRoot(baseProjectRoot) ===
          this._hooksV2HostWorkspaceRoot &&
        normalizeHostWorkspaceRoot(workspace.projectRoot) ===
          this._hooksV2HostWorkspaceRoot
          ? this._hooksV2HostWorkspaceRoot
          : null;
      bindSessionHooksV2Workspace(session, recoveredHooksWorkspaceRoot);

      this._bindPlanManagerPersistence(session);
      this.sessions.set(session.id, session);
      if (stateRecovery.changed) {
        this._persistCanonicalSessionState(session, sessionStateJournal);
        this._persistSessionState(session.id);
      }
      return session;
    } catch (_err) {
      return null;
    }
  }

  /** Build the local compatibility projection for a verified canonical-only session. */
  resumeCanonicalSession(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) return this.resumeSession(sessionId);
    // Read and validate any canonical WS journal before creating a DB/cache
    // projection. An invalid journal must never be replaced by empty state.
    const canonicalSessionState = this._readCanonicalSessionState(sessionId);
    const canonicalJournal = canonicalSessionState
      ? hydrateCanonicalWsSessionState(canonicalSessionState)
      : null;
    const stateRecovery = canonicalJournal
      ? recoverWsSessionState(canonicalJournal, {
          reason: "process_restart",
        })
      : { changed: false };
    const created = this.createSession({
      sessionId,
      type: options.type || "agent",
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      projectRoot: options.projectRoot,
      requireDurable: false,
    });
    const session = this.sessions.get(created.sessionId) || null;
    if (session && canonicalJournal) {
      try {
        session.canonicalJsonlSession = true;
        this._bindSessionStateJournal(session, canonicalJournal);
        if (stateRecovery.changed) {
          this._persistCanonicalSessionState(session, canonicalJournal);
        }
        this._persistSessionState(session.id);
      } catch (error) {
        this.sessions.delete(session.id);
        this._discardSessionResources(session);
        throw error;
      }
    }
    return session;
  }

  /**
   * Close a session and persist final state.
   *
   * @param {string} sessionId
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (
      session._releaseHooksV2WorkspaceBindingOnClose === true &&
      session.hooksV2WorkspaceBindingId
    ) {
      releaseRegisteredHostHooksV2Workspace(session.hooksV2WorkspaceBindingId);
    }

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

    // DB sessions (exclude already-listed in-memory ones AND closed ones —
    // closeSession persists `status: "closed"` to metadata before deleting
    // from in-memory; without this filter the closed session keeps showing
    // up in `session-list`, contradicting the contract).
    if (this.db) {
      try {
        const dbSessions = dbListSessions(this.db, { limit: 20 });
        const inMemoryIds = new Set(this.sessions.keys());
        for (const dbs of dbSessions) {
          const metadata = this._normalizeSessionMetadata(dbs.metadata);
          if (metadata && metadata.status === "closed") {
            continue;
          }
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

    const rawFiles = Array.isArray(payload.files) ? payload.files : [];
    if (rawFiles.length === 0) return null;
    // Cap the per-patch file count; a proposal touching more than this is
    // pathological for review. Excess files are dropped (count recorded below)
    // so one message can't pin unbounded memory / disk.
    const files = rawFiles.slice(0, this.maxPatchFiles);
    const droppedFiles = rawFiles.length - files.length;

    const patchId = `patch-${this._generateId()}`;
    const now = new Date().toISOString();
    const normalizedFiles = files.map((file, index) => {
      const op = file.op || (file.before == null ? "create" : "modify");
      const stats = this._computePatchStats(file);
      return {
        index,
        path: file.path || `unknown-${index}`,
        op,
        before: this._capPatchContent(file.before),
        after: this._capPatchContent(file.after),
        diff: this._capPatchContent(file.diff),
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
        // Surfaced so the reviewer/UI knows the proposal was capped for storage.
        ...(droppedFiles > 0 ? { droppedFiles } : {}),
      },
    };

    if (!(session.pendingPatches instanceof Map)) {
      session.pendingPatches = new Map();
    }
    // Bound un-reviewed proposals: evict the oldest pending (Map preserves
    // insertion order) once at cap. 50 unresolved patches is already
    // pathological; dropping the stalest keeps memory + persisted state bounded
    // without blocking a legitimate new proposal.
    while (session.pendingPatches.size >= this.maxPendingPatches) {
      const oldestKey = session.pendingPatches.keys().next().value;
      if (oldestKey === undefined) break;
      session.pendingPatches.delete(oldestKey);
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
    this._trimPatchHistory(session);
    session.lastActivity = patch.resolvedAt;
    this._persistSessionState(sessionId);
    return patch;
  }

  /**
   * Keep `patchHistory` bounded to the most recent maxPatchHistory entries.
   * Oldest fall off the front (FIFO) so memory + persisted JSON stay bounded.
   */
  _trimPatchHistory(session) {
    if (!Array.isArray(session.patchHistory)) return;
    const overflow = session.patchHistory.length - this.maxPatchHistory;
    if (overflow > 0) {
      session.patchHistory.splice(0, overflow);
    }
  }

  /**
   * Bound a (possibly persisted/tampered) patchHistory array on load, keeping
   * the most recent entries. Returns a fresh array (never the input).
   */
  _boundPatchHistory(list) {
    if (!Array.isArray(list)) return [];
    return list.length > this.maxPatchHistory
      ? list.slice(list.length - this.maxPatchHistory)
      : list.slice();
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
    this._trimPatchHistory(session);
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
    this._persistSessionState(sessionId);
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
      let persistedMessages = session.messages;
      if (
        session.canonicalJsonlSession === true &&
        Array.isArray(session._canonicalHostSystemPrefix)
      ) {
        const hostPrefix = normalizeCanonicalHostSystemPrefix(
          session._canonicalHostSystemPrefix,
        );
        const conversation = sanitizePersistedNonSystemMessages(
          session.messages,
          { strict: true },
        );
        persistedMessages = [...hostPrefix, ...conversation];
      }
      dbSaveMessages(
        this.db,
        sessionId,
        persistedMessages,
        this._serializeSessionMetadata(session),
      );
    } catch (_err) {
      // Non-critical
    }

    session.lastActivity = new Date().toISOString();
  }

  _serializeSessionMetadata(session) {
    const sessionStateJournal = this._ensureSessionStateJournal(session);
    return {
      version: 1,
      sessionType: session.type || "agent",
      // Persist status so listSessions can exclude closed sessions when
      // re-hydrating from DB. Without this, a closed session keeps
      // showing up in `session-list` because closeSession deletes from
      // in-memory map BEFORE the DB row is filtered.
      status: session.status || "active",
      projectRoot: session.projectRoot || null,
      baseProjectRoot: session.baseProjectRoot || session.projectRoot || null,
      baseUrl: session.baseUrl || null,
      hostManagedToolPolicy: session.hostManagedToolPolicy || null,
      sessionBudgetRoot: session.sessionBudgetRoot || null,
      canonicalJsonlSession: session.canonicalJsonlSession === true,
      enabledToolNames: session.enabledToolNames || [],
      canonicalHostSystemPrefix: Array.isArray(
        session._canonicalHostSystemPrefix,
      )
        ? normalizeCanonicalHostSystemPrefix(session._canonicalHostSystemPrefix)
        : null,
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
      // Additive metadata field: old readers ignore it; new readers replay the
      // contiguous event tail over the checkpoint before resuming a session.
      sessionState: serializeWsSessionState(sessionStateJournal),
    };
  }

  _bindSessionStateJournal(session, journal) {
    if (!session || typeof session !== "object") return;
    Object.defineProperty(session, "_sessionStateJournal", {
      value: journal || createWsSessionState(),
      enumerable: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(session, "_recordSessionStateEvent", {
      value: (type, payload = {}) =>
        this.recordSessionStateEvent(session.id, type, payload),
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }

  _ensureSessionStateJournal(session) {
    if (!session?._sessionStateJournal) {
      this._bindSessionStateJournal(session, createWsSessionState());
    }
    return session._sessionStateJournal;
  }

  _readCanonicalSessionState(sessionId, { required = false } = {}) {
    const event = this.canonicalSessionStore.findLatestEvent(
      sessionId,
      WS_SESSION_ROLLOUT_EVENT,
    );
    if (!event) {
      if (required) {
        throw canonicalWsStateError(
          "CC_WS_CANONICAL_STATE_MISSING",
          `canonical WebSocket session state is missing: ${sessionId}`,
        );
      }
      return null;
    }
    if (event.data?.schema !== WS_SESSION_ROLLOUT_SCHEMA) {
      throw canonicalWsStateError(
        "CC_WS_CANONICAL_STATE_CORRUPT",
        `canonical WebSocket session state has an invalid schema: ${sessionId}`,
      );
    }
    return event.data.journal;
  }

  _persistCanonicalSessionState(session, journal) {
    if (session?.canonicalJsonlSession !== true) return null;
    return this.canonicalSessionStore.appendEvent(
      session.id,
      WS_SESSION_ROLLOUT_EVENT,
      {
        schema: WS_SESSION_ROLLOUT_SCHEMA,
        journal: serializeWsSessionState(journal),
      },
    );
  }

  markCanonicalSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const previous = session.canonicalJsonlSession === true;
    session.canonicalJsonlSession = true;
    try {
      this._persistCanonicalSessionState(
        session,
        this._ensureSessionStateJournal(session),
      );
      this._persistSessionState(sessionId);
      return session;
    } catch (error) {
      session.canonicalJsonlSession = previous;
      throw error;
    }
  }

  /** Record a recovery event and atomically persist it with session messages. */
  recordSessionStateEvent(sessionId, type, payload = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const journal = this._ensureSessionStateJournal(session);
    const before = serializeWsSessionState(journal);
    appendWsSessionStateEvent(journal, type, payload);
    try {
      this._persistCanonicalSessionState(session, journal);
    } catch (error) {
      this._bindSessionStateJournal(session, hydrateWsSessionState(before));
      throw error;
    }
    this._persistSessionState(sessionId);
    return getWsSessionStateSnapshot(journal);
  }

  /** Detached snapshot suitable for an additive IDE resume payload. */
  getSessionStateSnapshot(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const journal = this._ensureSessionStateJournal(session);
    return getWsSessionStateSnapshot(journal);
  }

  _hydratePendingPatches(list) {
    const map = new Map();
    if (Array.isArray(list)) {
      // Trim from the front so the most recent proposals survive a reload even
      // if a prior (or tampered) persisted state exceeded the cap.
      const bounded =
        list.length > this.maxPendingPatches
          ? list.slice(list.length - this.maxPendingPatches)
          : list;
      for (const patch of bounded) {
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
