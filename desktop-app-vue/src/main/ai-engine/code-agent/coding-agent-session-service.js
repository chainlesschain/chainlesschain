const { EventEmitter } = require("events");
const path = require("path");
const { logger } = require("../../utils/logger.js");
const { CodingAgentBridge } = require("./coding-agent-bridge.js");
const {
  CODING_AGENT_EVENT_CHANNEL,
  CodingAgentEventType,
  createCodingAgentEvent,
} = require("./coding-agent-events.js");
const { CodingAgentToolAdapter } = require("./coding-agent-tool-adapter.js");
const {
  CodingAgentPermissionGate,
} = require("./coding-agent-permission-gate.js");

const MAX_SESSION_EVENTS = 200;

function mergeWorktreeRecord(existingWorktree, incomingWorktree, options = {}) {
  const current = existingWorktree || null;
  const next = incomingWorktree || null;
  if (!current && !next) {
    return null;
  }

  const merged = {
    ...(current || {}),
    ...(next || {}),
  };

  merged.branch = next?.branch || current?.branch || null;
  merged.path = next?.path || current?.path || null;
  merged.baseBranch = next?.baseBranch || current?.baseBranch || null;
  merged.hasChanges =
    typeof options.hasChanges === "boolean"
      ? options.hasChanges
      : typeof next?.hasChanges === "boolean"
        ? next.hasChanges
        : typeof current?.hasChanges === "boolean"
          ? current.hasChanges
          : null;
  merged.summary = next?.summary || current?.summary || null;
  merged.conflicts = Array.isArray(next?.conflicts)
    ? next.conflicts
    : Array.isArray(current?.conflicts)
      ? current.conflicts
      : [];
  merged.previewEntrypoints = Array.isArray(next?.previewEntrypoints)
    ? next.previewEntrypoints
    : Array.isArray(current?.previewEntrypoints)
      ? current.previewEntrypoints
      : [];
  merged.meta = {
    ...(current?.meta || {}),
    ...(next?.meta || {}),
  };

  return merged;
}

class CodingAgentSessionService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.mainWindow = options.mainWindow || null;
    this.repoRoot =
      options.repoRoot || path.resolve(__dirname, "../../../../../");
    this.projectRoot = options.projectRoot || this.repoRoot;
    this.bridge =
      options.bridge ||
      new CodingAgentBridge({
        cwd: this.repoRoot,
        projectRoot: this.projectRoot,
      });
    this.toolManager = options.toolManager || null;
    this.mcpManager = options.mcpManager || null;
    this.toolAdapter =
      options.toolAdapter ||
      new CodingAgentToolAdapter({
        toolManager: this.toolManager,
        mcpManager: this.mcpManager,
      });
    this.permissionGate =
      options.permissionGate ||
      new CodingAgentPermissionGate({
        toolAdapter: this.toolAdapter,
      });

    this.sessions = new Map();
    this.requestSessionMap = new Map();

    this._attachBridge();
  }

  _attachBridge() {
    this.bridge.on("server-starting", (payload) => {
      this._emitEvent(
        createCodingAgentEvent(CodingAgentEventType.SERVER_STARTING, payload),
      );
    });

    this.bridge.on("server-ready", (payload) => {
      this._emitEvent(
        createCodingAgentEvent(CodingAgentEventType.SERVER_READY, payload),
      );
    });

    this.bridge.on("server-stopped", (payload) => {
      this._emitEvent(
        createCodingAgentEvent(CodingAgentEventType.SERVER_STOPPED, payload),
      );
    });

    this.bridge.on("error", (payload) => {
      this._emitEvent(
        createCodingAgentEvent(CodingAgentEventType.ERROR, payload),
      );
    });

    this.bridge.on("message", (message) => {
      this._handleBridgeMessage(message);
    });
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  async ensureReady() {
    return this.bridge.ensureReady();
  }

  async createSession(options = {}) {
    const response = await this.bridge.createSession({
      sessionType: "agent",
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      projectRoot: options.projectRoot || this.projectRoot,
      worktreeIsolation: options.worktreeIsolation === true,
    });

    const sessionId = response.sessionId;
    const existing = this.sessions.get(sessionId) || {};
    const session = {
      ...existing,
      sessionId,
      status: "ready",
      provider: options.provider || null,
      model: options.model || null,
      projectRoot:
        response.record?.projectRoot || options.projectRoot || this.projectRoot,
      baseProjectRoot:
        response.record?.baseProjectRoot ||
        options.projectRoot ||
        this.projectRoot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: existing.history || [],
      events: existing.events || [],
      pendingRequests: existing.pendingRequests || [],
      lastPlanSummary: null,
      lastPlanItems: [],
      planModeState: "inactive",
      requiresHighRiskConfirmation: false,
      highRiskConfirmationGranted: false,
      highRiskToolNames: [],
      worktree: response.record?.worktree || existing.worktree || null,
      worktreeIsolation:
        response.record?.worktreeIsolation === true ||
        options.worktreeIsolation === true,
    };
    this.sessions.set(sessionId, session);
    await this._syncSessionPolicy(session);

    return {
      success: true,
      sessionId,
      session,
      record: response.record || null,
    };
  }

  async resumeSession(sessionId) {
    const response = await this.bridge.resumeSession(sessionId);
    const history = Array.isArray(response.history) ? response.history : [];
    const existing = this.sessions.get(sessionId) || {};
    const session = {
      ...existing,
      sessionId,
      createdAt: new Date().toISOString(),
      events: existing.events || [],
      pendingRequests: existing.pendingRequests || [],
      lastPlanItems: existing.lastPlanItems || [],
      planModeState: existing.planModeState || "inactive",
      requiresHighRiskConfirmation:
        existing.requiresHighRiskConfirmation === true,
      highRiskConfirmationGranted:
        existing.highRiskConfirmationGranted === true,
      highRiskToolNames: existing.highRiskToolNames || [],
      projectRoot:
        response.record?.projectRoot ||
        existing.projectRoot ||
        this.projectRoot,
      baseProjectRoot:
        response.record?.baseProjectRoot ||
        existing.baseProjectRoot ||
        this.projectRoot,
      worktree: response.record?.worktree || existing.worktree || null,
      worktreeIsolation:
        response.record?.worktreeIsolation === true ||
        existing.worktreeIsolation === true,
    };

    session.status = "ready";
    session.updatedAt = new Date().toISOString();
    session.history = history;
    session.record = response.record || null;
    this.sessions.set(sessionId, session);
    await this._syncSessionPolicy(session);

    return {
      success: true,
      sessionId,
      history,
      record: response.record || null,
    };
  }

  async listSessions() {
    const response = await this.bridge.listSessions();
    return {
      success: true,
      sessions: response.sessions || [],
    };
  }

  async closeSession(sessionId) {
    const response = await this.bridge.closeSession(sessionId);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "closed";
      session.updatedAt = new Date().toISOString();
      session.planModeState = "inactive";
      session.lastPlanSummary = null;
      session.lastPlanItems = [];
      session.requiresHighRiskConfirmation = false;
      session.highRiskConfirmationGranted = false;
      session.highRiskToolNames = [];
      this._removePendingRequestsForSession(session);

      this._storeEvent(
        sessionId,
        createCodingAgentEvent(
          CodingAgentEventType.SESSION_CLOSED,
          { sessionId },
          { sessionId, requestId: response.id || null },
        ),
      );
    }

    return {
      success: response.success !== false,
      sessionId,
    };
  }

  async listWorktrees() {
    const response = await this.bridge.listWorktrees();
    this._emitEvent(
      createCodingAgentEvent(
        CodingAgentEventType.WORKTREE_LIST,
        {
          worktrees: Array.isArray(response.worktrees)
            ? response.worktrees
            : [],
        },
        { requestId: response.id || null },
      ),
    );

    return {
      success: true,
      worktrees: Array.isArray(response.worktrees) ? response.worktrees : [],
    };
  }

  async getWorktreeDiff(sessionId, options = {}) {
    const session = this._requireSession(sessionId);
    const branch = options.branch || session.worktree?.branch || null;
    if (!branch) {
      throw new Error(
        `Worktree branch not found for coding agent session: ${sessionId}`,
      );
    }

    const response = await this.bridge.diffWorktree(branch, {
      baseBranch: options.baseBranch || null,
      filePath: options.filePath || null,
    });

    const event = createCodingAgentEvent(
      CodingAgentEventType.WORKTREE_DIFF,
      {
        branch,
        filePath: response.filePath || options.filePath || null,
        files: response.files || [],
        summary: response.summary || null,
        diff: response.diff || null,
        record: response.record || null,
      },
      { sessionId, requestId: response.id || null },
    );

    this._storeEvent(sessionId, event);
    this._applySessionMutation(sessionId, event);

    return {
      success: true,
      sessionId,
      branch,
      filePath: response.filePath || options.filePath || null,
      files: response.files || [],
      summary: response.summary || null,
      diff: response.diff || null,
      record: response.record || null,
    };
  }

  async mergeWorktree(sessionId, options = {}) {
    const session = this._requireSession(sessionId);
    const branch = options.branch || session.worktree?.branch || null;
    if (!branch) {
      throw new Error(
        `Worktree branch not found for coding agent session: ${sessionId}`,
      );
    }

    const response = await this.bridge.mergeWorktree(branch, {
      strategy: options.strategy || "merge",
      commitMessage: options.commitMessage || null,
    });

    const event = createCodingAgentEvent(
      CodingAgentEventType.WORKTREE_MERGED,
      {
        branch,
        success: response.success !== false,
        strategy: response.strategy || options.strategy || "merge",
        message: response.message || null,
        summary: response.summary || null,
        conflicts: response.conflicts || [],
        suggestions: response.suggestions || [],
        previewEntrypoints: response.previewEntrypoints || [],
        record: response.record || null,
      },
      { sessionId, requestId: response.id || null },
    );

    this._storeEvent(sessionId, event);
    this._applySessionMutation(sessionId, event);

    return {
      success: response.success !== false,
      sessionId,
      branch,
      strategy: response.strategy || options.strategy || "merge",
      message: response.message || null,
      summary: response.summary || null,
      conflicts: response.conflicts || [],
      suggestions: response.suggestions || [],
      previewEntrypoints: response.previewEntrypoints || [],
      record: response.record || null,
    };
  }

  async previewWorktreeMerge(sessionId, options = {}) {
    const session = this._requireSession(sessionId);
    const branch = options.branch || session.worktree?.branch || null;
    if (!branch) {
      throw new Error(
        `Worktree branch not found for coding agent session: ${sessionId}`,
      );
    }

    const response = await this.bridge.previewWorktreeMerge(branch, {
      baseBranch: options.baseBranch || session.worktree?.baseBranch || null,
      strategy: options.strategy || "merge",
    });

    const event = createCodingAgentEvent(
      CodingAgentEventType.WORKTREE_MERGE_PREVIEW,
      {
        branch,
        baseBranch:
          response.baseBranch ||
          options.baseBranch ||
          session.worktree?.baseBranch ||
          null,
        success: response.success !== false,
        previewOnly: true,
        strategy: response.strategy || options.strategy || "merge",
        message: response.message || null,
        summary: response.summary || null,
        conflicts: response.conflicts || [],
        suggestions: response.suggestions || [],
        previewEntrypoints: response.previewEntrypoints || [],
        record: response.record || null,
      },
      { sessionId, requestId: response.id || null },
    );

    this._storeEvent(sessionId, event);
    this._applySessionMutation(sessionId, event);

    return {
      success: response.success !== false,
      previewOnly: true,
      sessionId,
      branch,
      baseBranch:
        response.baseBranch ||
        options.baseBranch ||
        session.worktree?.baseBranch ||
        null,
      strategy: response.strategy || options.strategy || "merge",
      message: response.message || null,
      summary: response.summary || null,
      conflicts: response.conflicts || [],
      suggestions: response.suggestions || [],
      previewEntrypoints: response.previewEntrypoints || [],
      record: response.record || null,
    };
  }

  async applyWorktreeAutomationCandidate(sessionId, options = {}) {
    const session = this._requireSession(sessionId);
    const branch = options.branch || session.worktree?.branch || null;
    if (!branch) {
      throw new Error(
        `Worktree branch not found for coding agent session: ${sessionId}`,
      );
    }
    if (!options.filePath || !options.candidateId) {
      throw new Error(
        "Applying a worktree automation candidate requires filePath and candidateId.",
      );
    }

    const response = await this.bridge.applyWorktreeAutomationCandidate(
      branch,
      {
        baseBranch: options.baseBranch || session.worktree?.baseBranch || null,
        filePath: options.filePath,
        candidateId: options.candidateId,
        conflictType: options.conflictType || null,
      },
    );

    const event = createCodingAgentEvent(
      CodingAgentEventType.WORKTREE_AUTOMATION_APPLIED,
      {
        branch,
        baseBranch:
          response.baseBranch ||
          options.baseBranch ||
          session.worktree?.baseBranch ||
          null,
        filePath: response.filePath || options.filePath,
        candidateId: response.candidateId || options.candidateId,
        message: response.message || null,
        files: response.files || [],
        summary: response.summary || null,
        diff: response.diff || null,
        record: response.record || null,
      },
      { sessionId, requestId: response.id || null },
    );

    this._storeEvent(sessionId, event);
    this._applySessionMutation(sessionId, event);

    return {
      success: true,
      sessionId,
      branch,
      baseBranch:
        response.baseBranch ||
        options.baseBranch ||
        session.worktree?.baseBranch ||
        null,
      filePath: response.filePath || options.filePath,
      candidateId: response.candidateId || options.candidateId,
      message: response.message || null,
      files: response.files || [],
      summary: response.summary || null,
      diff: response.diff || null,
      record: response.record || null,
    };
  }

  async sendMessage(sessionId, content) {
    const session = this._requireSession(sessionId);
    this._assertHighRiskExecutionConfirmed(session);
    const requestId = `session-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.requestSessionMap.set(requestId, sessionId);
    session.pendingRequests.push(requestId);
    session.status = "running";
    session.updatedAt = new Date().toISOString();
    session.history.push({ role: "user", content });

    this.bridge.send({
      id: requestId,
      type: "session-message",
      sessionId,
      content,
    });

    this._storeEvent(
      sessionId,
      createCodingAgentEvent(
        CodingAgentEventType.MESSAGE_SENT,
        { content },
        { sessionId, requestId },
      ),
    );

    return {
      success: true,
      sessionId,
      requestId,
    };
  }

  async enterPlanMode(sessionId) {
    return this._sendSlashCommand(sessionId, "/plan");
  }

  async showPlan(sessionId) {
    return this._sendSlashCommand(sessionId, "/plan show");
  }

  async approvePlan(sessionId) {
    return this._sendSlashCommand(sessionId, "/plan approve");
  }

  async confirmHighRiskExecution(sessionId) {
    const session = this._requireSession(sessionId);

    session.highRiskConfirmationGranted = true;
    session.updatedAt = new Date().toISOString();

    this._storeEvent(
      sessionId,
      createCodingAgentEvent(
        CodingAgentEventType.HIGH_RISK_CONFIRMED,
        {
          sessionId,
          tools: session.highRiskToolNames || [],
        },
        { sessionId },
      ),
    );

    await this._syncSessionPolicy(session);

    return {
      success: true,
      sessionId,
      highRiskConfirmationGranted: true,
      tools: session.highRiskToolNames || [],
    };
  }

  async rejectPlan(sessionId) {
    return this._sendSlashCommand(sessionId, "/plan reject");
  }

  async cancelSession(sessionId) {
    return this.closeSession(sessionId);
  }

  getSessionState(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    // Return shallow copies of the mutable arrays so renderer-side consumers
    // (or test assertions) cannot mutate internal session state by accident.
    return {
      success: true,
      session: {
        sessionId: session.sessionId,
        status: session.status,
        provider: session.provider || null,
        model: session.model || null,
        projectRoot: session.projectRoot || null,
        baseProjectRoot: session.baseProjectRoot || null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        history: Array.isArray(session.history) ? [...session.history] : [],
        pendingRequests: Array.isArray(session.pendingRequests)
          ? [...session.pendingRequests]
          : [],
        lastPlanSummary: session.lastPlanSummary || null,
        lastPlanItems: Array.isArray(session.lastPlanItems)
          ? [...session.lastPlanItems]
          : [],
        planModeState: session.planModeState || "inactive",
        requiresHighRiskConfirmation:
          session.requiresHighRiskConfirmation === true,
        highRiskConfirmationGranted:
          session.highRiskConfirmationGranted === true,
        highRiskToolNames: Array.isArray(session.highRiskToolNames)
          ? [...session.highRiskToolNames]
          : [],
        worktreeIsolation: session.worktreeIsolation === true,
        worktree: session.worktree || null,
      },
    };
  }

  getSessionEvents(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    return {
      success: true,
      events: Array.isArray(session.events) ? [...session.events] : [],
    };
  }

  async getStatus() {
    const tools = await this.toolAdapter.listAvailableTools();
    return {
      success: true,
      server: {
        connected: this.bridge.connected,
        host: this.bridge.host,
        port: this.bridge.port,
      },
      sessionCount: this.sessions.size,
      tools,
      toolSummary: this.toolAdapter.summarizeTools(tools),
      permissionPolicy: this.permissionGate.getPolicySummary({ tools }),
    };
  }

  async shutdown() {
    await this.bridge.shutdown();
  }

  async _sendSlashCommand(sessionId, command) {
    const session = this._requireSession(sessionId);
    const requestId = `slash-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.requestSessionMap.set(requestId, sessionId);
    session.pendingRequests.push(requestId);
    session.updatedAt = new Date().toISOString();

    this.bridge.send({
      id: requestId,
      type: "slash-command",
      sessionId,
      command,
    });

    return {
      success: true,
      sessionId,
      requestId,
      command,
    };
  }

  _requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Coding agent session not found: ${sessionId}`);
    }
    return session;
  }

  _assertHighRiskExecutionConfirmed(session) {
    if (
      !session?.requiresHighRiskConfirmation ||
      session.highRiskConfirmationGranted === true
    ) {
      return;
    }

    this._storeEvent(
      session.sessionId,
      createCodingAgentEvent(
        CodingAgentEventType.HIGH_RISK_CONFIRMATION_REQUIRED,
        {
          tools: session.highRiskToolNames || [],
          items: (session.highRiskToolNames || []).map((toolName) => ({
            toolName,
            riskLevel: "high",
            title: toolName,
          })),
          reason:
            "High-risk execution confirmation is still required before the agent can continue.",
        },
        { sessionId: session.sessionId },
      ),
    );

    throw new Error(
      session.highRiskToolNames?.length
        ? `High-risk confirmation required before continuing: ${session.highRiskToolNames.join(", ")}`
        : "High-risk confirmation required before continuing.",
    );
  }

  _handleBridgeMessage(message) {
    if (message?.type === "host-tool-call") {
      this._handleHostToolCall(message).catch((error) => {
        logger.warn(
          `[CodingAgentSessionService] Failed to execute hosted tool ${message?.toolName || "unknown"}: ${error.message}`,
        );
      });
      return;
    }

    const sessionId =
      message.sessionId ||
      (message.id ? this.requestSessionMap.get(message.id) : null) ||
      null;

    if (sessionId && !this.sessions.has(sessionId)) {
      // We only see this when the CLI emits a session-bound event before the
      // host has registered the session locally (e.g. resume race, or events
      // arriving after a process restart). Log it so anomalies are visible
      // instead of silently materializing ghost sessions.
      logger.warn(
        `[CodingAgentSessionService] Materializing previously-unknown session ${sessionId} from bridge message type=${message.type || "unknown"}`,
      );
      this.sessions.set(sessionId, {
        sessionId,
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
        events: [],
        pendingRequests: [],
        lastPlanSummary: null,
        planModeState: "inactive",
        lastPlanItems: [],
        requiresHighRiskConfirmation: false,
        highRiskConfirmationGranted: false,
        highRiskToolNames: [],
      });
    }

    const normalized = this._normalizeMessage(message, sessionId);
    if (sessionId) {
      this._storeEvent(sessionId, normalized);
      const policyChanged = this._applySessionMutation(sessionId, normalized);
      if (policyChanged) {
        this._syncSessionPolicy(sessionId).catch((error) => {
          logger.warn(
            `[CodingAgentSessionService] Failed to sync session policy for ${sessionId}: ${error.message}`,
          );
        });
      }
      this._emitDerivedEvents(sessionId, normalized);
    } else {
      this._emitEvent(normalized);
    }
  }

  _normalizeMessage(message, sessionId) {
    // Always prefer the resolved sessionId (from requestSessionMap) over the
    // raw message.sessionId, which the CLI sometimes omits on response messages.
    const resolvedSessionId = sessionId || message.sessionId || null;
    switch (message.type) {
      case "session-created":
        return createCodingAgentEvent(
          CodingAgentEventType.SESSION_CREATED,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "session-resumed":
        return createCodingAgentEvent(
          CodingAgentEventType.SESSION_RESUMED,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "session-list-result":
        return createCodingAgentEvent(
          CodingAgentEventType.SESSION_LIST,
          message,
          { requestId: message.id },
        );
      case "worktree-list":
        return createCodingAgentEvent(
          CodingAgentEventType.WORKTREE_LIST,
          message,
          { requestId: message.id },
        );
      case "worktree-diff":
        return createCodingAgentEvent(
          CodingAgentEventType.WORKTREE_DIFF,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "worktree-merged":
        return createCodingAgentEvent(
          CodingAgentEventType.WORKTREE_MERGED,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "worktree-merge-preview":
        return createCodingAgentEvent(
          CodingAgentEventType.WORKTREE_MERGE_PREVIEW,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "response-complete":
        return createCodingAgentEvent(
          CodingAgentEventType.RESPONSE_COMPLETE,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "tool-executing":
        return createCodingAgentEvent(
          CodingAgentEventType.TOOL_EXECUTING,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "tool-result":
        return createCodingAgentEvent(
          CodingAgentEventType.TOOL_RESULT,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "command-response":
        return createCodingAgentEvent(
          CodingAgentEventType.COMMAND_RESPONSE,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "plan-ready":
        return createCodingAgentEvent(
          CodingAgentEventType.PLAN_READY,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "slot-filling":
        return createCodingAgentEvent(
          CodingAgentEventType.SLOT_FILLING,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "model-switch":
        return createCodingAgentEvent(
          CodingAgentEventType.MODEL_SWITCH,
          message,
          { sessionId: resolvedSessionId, requestId: message.id },
        );
      case "error":
        return createCodingAgentEvent(CodingAgentEventType.ERROR, message, {
          sessionId: resolvedSessionId,
          requestId: message.id,
        });
      default:
        return createCodingAgentEvent(message.type || "unknown", message, {
          sessionId: resolvedSessionId,
          requestId: message.id,
        });
    }
  }

  _applySessionMutation(sessionId, event) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.updatedAt = event.timestamp;
    let policyChanged = false;

    switch (event.type) {
      case CodingAgentEventType.SESSION_CREATED:
      case CodingAgentEventType.SESSION_RESUMED:
        session.status = "ready";
        session.planModeState = "inactive";
        session.lastPlanItems = [];
        session.requiresHighRiskConfirmation = false;
        session.highRiskConfirmationGranted = false;
        session.highRiskToolNames = [];
        if (event.payload.record?.provider) {
          session.provider = event.payload.record.provider;
        }
        if (event.payload.record?.model) {
          session.model = event.payload.record.model;
        }
        if (event.payload.record?.projectRoot) {
          session.projectRoot = event.payload.record.projectRoot;
        }
        if (event.payload.record?.baseProjectRoot) {
          session.baseProjectRoot = event.payload.record.baseProjectRoot;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            event.payload.record || {},
            "worktree",
          )
        ) {
          session.worktree = event.payload.record?.worktree || null;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            event.payload.record || {},
            "worktreeIsolation",
          )
        ) {
          session.worktreeIsolation =
            event.payload.record?.worktreeIsolation === true;
        }
        if (Array.isArray(event.payload.history)) {
          session.history = event.payload.history;
        }
        break;
      case CodingAgentEventType.RESPONSE_COMPLETE:
        session.status = "ready";
        if (event.payload.content) {
          session.history.push({
            role: "assistant",
            content: event.payload.content,
          });
        }
        this._completePendingRequest(session, event.requestId);
        break;
      case CodingAgentEventType.PLAN_READY:
        session.status = "waiting_approval";
        session.lastPlanSummary = event.payload.summary || null;
        session.lastPlanItems = Array.isArray(event.payload.items)
          ? event.payload.items
          : [];
        session.planModeState = "plan_ready";
        session.highRiskToolNames = this.permissionGate
          .getHighRiskToolsFromPlanItems(session.lastPlanItems)
          .map((item) => item.toolName);
        session.requiresHighRiskConfirmation =
          session.highRiskToolNames.length > 0;
        session.highRiskConfirmationGranted = false;
        this._completePendingRequest(session, event.requestId);
        policyChanged = true;
        break;
      case CodingAgentEventType.COMMAND_RESPONSE:
        if (event.payload.result?.state === "analyzing") {
          session.status = "planning";
          session.planModeState = "analyzing";
          policyChanged = true;
        } else if (event.payload.result?.state === "approved") {
          session.status = "ready";
          session.planModeState = "approved";
          policyChanged = true;
        } else if (
          event.payload.result?.state === "rejected" ||
          event.payload.result?.state === "inactive"
        ) {
          session.status = "ready";
          session.planModeState = "inactive";
          session.lastPlanSummary = null;
          session.lastPlanItems = [];
          session.requiresHighRiskConfirmation = false;
          session.highRiskConfirmationGranted = false;
          session.highRiskToolNames = [];
          policyChanged = true;
        } else if (event.payload.result?.error) {
          session.status = "ready";
        }
        this._completePendingRequest(session, event.requestId);
        break;
      case CodingAgentEventType.ERROR:
        session.status = "failed";
        this._completePendingRequest(session, event.requestId);
        break;
      case CodingAgentEventType.WORKTREE_DIFF:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          { hasChanges: true },
        );
        break;
      case CodingAgentEventType.WORKTREE_MERGE_PREVIEW:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          { hasChanges: true },
        );
        break;
      case CodingAgentEventType.WORKTREE_MERGED:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          { hasChanges: event.payload.success === true ? false : true },
        );
        break;
      case CodingAgentEventType.WORKTREE_AUTOMATION_APPLIED:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          {
            hasChanges: (event.payload.summary?.filesChanged || 0) > 0,
          },
        );
        break;
      default:
        break;
    }

    return policyChanged;
  }

  async _buildHostManagedToolPolicy(session) {
    const currentSession =
      typeof session === "string" ? this.sessions.get(session) : session;
    if (!currentSession) {
      return null;
    }

    const availableTools = await this.toolAdapter.listAvailableTools();
    const tools = {};
    for (const tool of availableTools) {
      const evaluation = this.permissionGate.evaluateToolCall({
        toolName: tool.name,
        session: currentSession,
        confirmed: currentSession.highRiskConfirmationGranted === true,
        toolDescriptor: tool,
      });

      tools[tool.name] = {
        allowed: evaluation.allowed,
        decision: evaluation.decision,
        reason: evaluation.reason,
        riskLevel: evaluation.riskLevel,
        requiresPlanApproval: evaluation.requiresPlanApproval,
        requiresConfirmation: evaluation.requiresConfirmation,
      };
    }

    return {
      source: "desktop-host",
      sessionId: currentSession.sessionId,
      syncedAt: new Date().toISOString(),
      planModeState: currentSession.planModeState || "inactive",
      toolDefinitions:
        this.toolAdapter.buildFunctionToolDefinitions(availableTools),
      tools,
    };
  }

  async _syncSessionPolicy(session) {
    const currentSession =
      typeof session === "string" ? this.sessions.get(session) : session;
    if (!currentSession || currentSession.status === "closed") {
      return { success: false, skipped: true };
    }

    if (!this.bridge || typeof this.bridge.updateSessionPolicy !== "function") {
      return { success: false, skipped: true };
    }

    const hostManagedToolPolicy =
      await this._buildHostManagedToolPolicy(currentSession);

    return this.bridge.updateSessionPolicy(
      currentSession.sessionId,
      hostManagedToolPolicy,
    );
  }

  _emitDerivedEvents(sessionId, event) {
    if (!sessionId) {
      return;
    }

    const session = this.sessions.get(sessionId) || null;

    if (event.type === CodingAgentEventType.PLAN_READY) {
      const highRiskTools = this.permissionGate.getHighRiskToolsFromPlanItems(
        event.payload.items || [],
      );

      this._storeEvent(
        sessionId,
        createCodingAgentEvent(
          CodingAgentEventType.PLAN_GENERATED,
          {
            summary: event.payload.summary || null,
            items: event.payload.items || [],
          },
          { sessionId, requestId: event.requestId },
        ),
      );

      this._storeEvent(
        sessionId,
        createCodingAgentEvent(
          CodingAgentEventType.APPROVAL_REQUESTED,
          {
            summary: event.payload.summary || null,
            items: event.payload.items || [],
            permissionPolicy: this.permissionGate.getPolicySummary(),
          },
          { sessionId, requestId: event.requestId },
        ),
      );

      if (highRiskTools.length > 0) {
        this._storeEvent(
          sessionId,
          createCodingAgentEvent(
            CodingAgentEventType.HIGH_RISK_CONFIRMATION_REQUIRED,
            {
              tools: highRiskTools.map((item) => item.toolName),
              items: highRiskTools,
            },
            { sessionId, requestId: event.requestId },
          ),
        );
      }
      return;
    }

    if (event.type !== CodingAgentEventType.TOOL_RESULT) {
      return;
    }

    const assessment = this.permissionGate.getToolResultAssessment(
      event.payload,
      session,
    );

    if (!assessment?.blocked) {
      return;
    }

    this._storeEvent(
      sessionId,
      createCodingAgentEvent(CodingAgentEventType.TOOL_BLOCKED, assessment, {
        sessionId,
        requestId: event.requestId,
      }),
    );
  }

  async _handleHostToolCall(message = {}) {
    const sessionId = message.sessionId || null;
    const requestId = message.requestId || null;
    const toolName = message.toolName || null;
    const args = message.args || {};

    try {
      const result = await this._executeHostedTool(sessionId, toolName, args);
      this.bridge.send({
        id: `host-tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "host-tool-result",
        sessionId,
        requestId,
        toolName,
        success: true,
        result,
      });
    } catch (error) {
      this.bridge.send({
        id: `host-tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "host-tool-result",
        sessionId,
        requestId,
        toolName,
        success: false,
        error: error.message,
      });
    }
  }

  async _executeHostedTool(sessionId, toolName, args = {}) {
    if (!toolName) {
      throw new Error("Hosted tool execution requires a tool name.");
    }

    let descriptor = this.toolAdapter.getToolDescriptorSync(toolName);
    if (!descriptor) {
      await this.toolAdapter.listAvailableTools();
      descriptor = this.toolAdapter.getToolDescriptorSync(toolName);
    }

    if (!descriptor) {
      throw new Error(`Hosted tool is not available: ${toolName}`);
    }

    // Permission gate: never trust the CLI to enforce host-side risk policy.
    // Even if the CLI requests a high-risk tool, the host must verify the
    // session has gone through plan approval and (for high-risk) the second
    // confirmation step before actually executing.
    const session = sessionId ? this.sessions.get(sessionId) : null;
    const evaluation = this.permissionGate.evaluateToolCall({
      toolName,
      session,
      confirmed: session?.highRiskConfirmationGranted === true,
      toolDescriptor: descriptor,
    });
    if (!evaluation.allowed) {
      throw new Error(
        `[Host Policy] Tool "${toolName}" is blocked: ${evaluation.reason}`,
      );
    }

    if (descriptor.mcpMetadata?.serverName) {
      if (!this.mcpManager || typeof this.mcpManager.callTool !== "function") {
        throw new Error(`MCP manager is unavailable for tool "${toolName}".`);
      }

      const result = await this.mcpManager.callTool(
        descriptor.mcpMetadata.serverName,
        descriptor.mcpMetadata.originalToolName,
        args,
      );
      return {
        ...result,
        toolName,
      };
    }

    const functionCaller = this.toolManager?.functionCaller || null;
    if (!functionCaller || typeof functionCaller.callTool !== "function") {
      throw new Error(
        `Tool manager function caller is unavailable for tool "${toolName}".`,
      );
    }

    if (
      typeof functionCaller.hasTool === "function" &&
      !functionCaller.hasTool(toolName)
    ) {
      throw new Error(`Hosted tool is not registered: ${toolName}`);
    }

    const result = await functionCaller.callTool(toolName, args);
    return result && typeof result === "object"
      ? result
      : { result, toolName, sessionId };
  }

  _completePendingRequest(session, requestId) {
    if (!requestId) {
      return;
    }
    session.pendingRequests = (session.pendingRequests || []).filter(
      (value) => value !== requestId,
    );
    this.requestSessionMap.delete(requestId);
  }

  _removePendingRequestsForSession(session) {
    const pendingRequests = Array.isArray(session.pendingRequests)
      ? [...session.pendingRequests]
      : [];

    for (const requestId of pendingRequests) {
      this.requestSessionMap.delete(requestId);
    }

    session.pendingRequests = [];
  }

  _storeEvent(sessionId, event) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this._emitEvent(event);
      return;
    }

    session.events.push(event);
    if (session.events.length > MAX_SESSION_EVENTS) {
      session.events.splice(0, session.events.length - MAX_SESSION_EVENTS);
    }

    this._emitEvent(event);
  }

  _emitEvent(event) {
    this.emit("event", event);

    if (
      this.mainWindow &&
      this.mainWindow.webContents &&
      !this.mainWindow.isDestroyed()
    ) {
      this.mainWindow.webContents.send(CODING_AGENT_EVENT_CHANNEL, event);
    }

    logger.info(
      `[CodingAgentSessionService] ${event.type} session=${event.sessionId || "-"} request=${event.requestId || "-"}`,
    );
  }
}

module.exports = {
  CodingAgentSessionService,
};
