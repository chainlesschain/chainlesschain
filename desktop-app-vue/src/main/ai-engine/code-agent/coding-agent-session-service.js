const { EventEmitter } = require("events");
const path = require("path");
const { logger } = require("../../utils/logger.js");
const { CodingAgentBridge } = require("./coding-agent-bridge.js");
const {
  CODING_AGENT_EVENT_CHANNEL,
  CODING_AGENT_EVENT_VERSION,
  CODING_AGENT_EVENT_TYPES,
  CodingAgentSequenceTracker,
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
        allowedManagedToolNames: options.allowedManagedToolNames,
        allowedMcpServerNames: options.allowedMcpServerNames,
        allowHighRiskMcpServers: options.allowHighRiskMcpServers,
        mcpServerRegistry: options.mcpServerRegistry,
      });
    this.permissionGate =
      options.permissionGate ||
      new CodingAgentPermissionGate({
        toolAdapter: this.toolAdapter,
      });

    this.sessions = new Map();
    this.requestSessionMap = new Map();
    this.globalEventSequence = 0;
    // Per-instance tracker so monotonic sequences are scoped to this service
    // instead of leaking through the process-global defaultSequenceTracker.
    // Sequence values are typically overwritten by _prepareEventEnvelope, but
    // having a private tracker prevents tests/instances from polluting each
    // other when they share the same Node process.
    this._sequenceTracker = new CodingAgentSequenceTracker();

    this._attachBridge();
  }

  /**
   * Build a unified Coding Agent event envelope using this service's
   * per-instance sequence tracker. All session-service emission sites should
   * funnel through this helper instead of calling createCodingAgentEvent
   * directly so the tracker stays scoped.
   */
  _createEvent(type, payload = {}, context = {}) {
    return createCodingAgentEvent(type, payload, {
      ...context,
      tracker: context.tracker || this._sequenceTracker,
    });
  }

  _attachBridge() {
    this.bridge.on("server-starting", (payload) => {
      this._emitEvent(
        this._createEvent(CODING_AGENT_EVENT_TYPES.SERVER_STARTING, payload),
      );
    });

    this.bridge.on("server-ready", (payload) => {
      this._emitEvent(
        this._createEvent(CODING_AGENT_EVENT_TYPES.SERVER_READY, payload),
      );
    });

    this.bridge.on("server-stopped", (payload) => {
      this._emitEvent(
        this._createEvent(CODING_AGENT_EVENT_TYPES.SERVER_STOPPED, payload),
      );
    });

    this.bridge.on("error", (payload) => {
      this._emitEvent(
        this._createEvent(CODING_AGENT_EVENT_TYPES.ERROR, payload),
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
        this._createEvent(
          CODING_AGENT_EVENT_TYPES.SESSION_CLOSED,
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

  async interruptSession(sessionId) {
    const session = this._requireSession(sessionId);
    const response = await this.bridge.interruptSession(sessionId);

    session.status = "ready";
    session.updatedAt = new Date().toISOString();
    this._removePendingRequestsForSession(session);

    return {
      success: response?.interrupted !== false,
      sessionId,
      interrupted: response?.interrupted !== false,
      wasProcessing: response?.wasProcessing === true,
      interruptedRequestId: response?.interruptedRequestId || null,
    };
  }

  async listWorktrees() {
    const response = await this.bridge.listWorktrees();
    this._emitEvent(
      this._createEvent(
        CODING_AGENT_EVENT_TYPES.WORKTREE_LIST,
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

    const event = this._createEvent(
      CODING_AGENT_EVENT_TYPES.WORKTREE_DIFF,
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

    const event = this._createEvent(
      CODING_AGENT_EVENT_TYPES.WORKTREE_MERGED,
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

    const event = this._createEvent(
      CODING_AGENT_EVENT_TYPES.WORKTREE_MERGE_PREVIEW,
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

    const event = this._createEvent(
      CODING_AGENT_EVENT_TYPES.WORKTREE_AUTOMATION_APPLIED,
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
      this._createEvent(
        CODING_AGENT_EVENT_TYPES.REQUEST_ACCEPTED,
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
      this._createEvent(
        CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMED,
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

  async respondApproval(sessionId, payload = {}) {
    const session = this._requireSession(sessionId);
    const decision = String(
      payload.decision || payload.status || payload.action || "",
    ).toLowerCase();
    const approvalType =
      payload.approvalType || this._inferApprovalType(session);

    if (!decision) {
      throw new Error("Approval response requires a decision.");
    }

    if (
      decision === "granted" ||
      decision === "approved" ||
      decision === "approve" ||
      decision === "confirm"
    ) {
      if (approvalType === "high-risk") {
        const result = await this.confirmHighRiskExecution(sessionId);
        this._storeEvent(
          sessionId,
          this._createEvent(
            CODING_AGENT_EVENT_TYPES.APPROVAL_GRANTED,
            {
              sessionId,
              approvalType,
              tools: session.highRiskToolNames || [],
            },
            { sessionId },
          ),
        );
        return {
          ...result,
          approvalType,
          decision: "granted",
        };
      }

      const result = await this.approvePlan(sessionId);
      return {
        ...result,
        approvalType: "plan",
        decision: "granted",
      };
    }

    if (
      decision === "denied" ||
      decision === "rejected" ||
      decision === "reject" ||
      decision === "cancel"
    ) {
      if (approvalType === "high-risk") {
        session.highRiskConfirmationGranted = false;
        session.updatedAt = new Date().toISOString();
        this._storeEvent(
          sessionId,
          this._createEvent(
            CODING_AGENT_EVENT_TYPES.APPROVAL_DENIED,
            {
              sessionId,
              approvalType,
              tools: session.highRiskToolNames || [],
            },
            { sessionId },
          ),
        );
        await this._syncSessionPolicy(session);
        return {
          success: true,
          sessionId,
          approvalType,
          decision: "denied",
          highRiskConfirmationGranted: false,
          tools: session.highRiskToolNames || [],
        };
      }

      const result = await this.rejectPlan(sessionId);
      return {
        ...result,
        approvalType: "plan",
        decision: "denied",
      };
    }

    throw new Error(`Unsupported approval decision: ${decision}`);
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

  async listBackgroundTasks(options = {}) {
    const response = await this.bridge.listBackgroundTasks();
    let tasks = Array.isArray(response.tasks) ? response.tasks : [];

    if (options.status) {
      tasks = tasks.filter((task) => task?.status === options.status);
    }

    return {
      success: true,
      tasks,
    };
  }

  async getBackgroundTask(taskId) {
    const response = await this.bridge.getBackgroundTask(taskId);
    return {
      success: true,
      task: response.task || null,
    };
  }

  async getBackgroundTaskHistory(taskId, options = {}) {
    const response = await this.bridge.getBackgroundTaskHistory(
      taskId,
      options,
    );
    return {
      success: true,
      taskId,
      history: response.history || [],
    };
  }

  async stopBackgroundTask(taskId) {
    const response = await this.bridge.stopBackgroundTask(taskId);
    return {
      success:
        response?.taskId === taskId || response?.type === "tasks-stopped",
      taskId: response?.taskId || taskId,
    };
  }

  /**
   * List sub-agents scoped to a parent session (or global if none given).
   *
   * Sub-agents are spawned from inside the CLI runtime via the
   * `spawn_sub_agent` tool; this IPC surface lets the renderer show the
   * child-agent roster alongside the normal session list without having to
   * subscribe to every lifecycle event.
   */
  async listSubAgents(sessionId) {
    const response = await this.bridge.listSubAgents(sessionId);
    return {
      success: true,
      sessionId: sessionId || null,
      active: Array.isArray(response.active) ? response.active : [],
      history: Array.isArray(response.history) ? response.history : [],
      stats: response.stats || null,
    };
  }

  async getSubAgent(subAgentId, sessionId) {
    const response = await this.bridge.getSubAgent(subAgentId, sessionId);
    return {
      success: true,
      subAgent: response.subAgent || null,
    };
  }

  /**
   * Enter review mode on a session. Subsequent sendMessage calls are
   * rejected with REVIEW_BLOCKING by the CLI runtime until the review
   * is resolved via `resolveReview`.
   */
  async enterReview(sessionId, options = {}) {
    const response = await this.bridge.enterReview(sessionId, options);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      reviewState: response.reviewState || null,
    };
  }

  /**
   * Append a comment and/or toggle a checklist item on the active review.
   */
  async submitReviewComment(sessionId, update = {}) {
    const response = await this.bridge.submitReviewComment(sessionId, update);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      reviewState: response.reviewState || null,
    };
  }

  /**
   * Resolve the current review with approved/rejected and unblock the
   * session message gate.
   */
  async resolveReview(sessionId, payload = {}) {
    const response = await this.bridge.resolveReview(sessionId, payload);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      reviewState: response.reviewState || null,
    };
  }

  /**
   * Fetch the current review snapshot (null if no review is active).
   */
  async getReviewState(sessionId) {
    const response = await this.bridge.getReviewState(sessionId);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      reviewState: response.reviewState || null,
    };
  }

  /**
   * Propose a patch (batch of file edits) for user preview. The patch is
   * stored on the CLI session's pendingPatches map and surfaced to the
   * renderer via the patch.proposed event envelope.
   */
  async proposePatch(sessionId, payload = {}) {
    const response = await this.bridge.proposePatch(sessionId, payload);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      patch: response.patch || null,
    };
  }

  /**
   * Apply a previously-proposed patch. Note: physical file writes are the
   * caller's responsibility — this method only records the decision on the
   * session state.
   */
  async applyPatch(sessionId, patchId, options = {}) {
    const response = await this.bridge.applyPatch(sessionId, patchId, options);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      patch: response.patch || null,
    };
  }

  /**
   * Reject/discard a previously-proposed patch.
   */
  async rejectPatch(sessionId, patchId, options = {}) {
    const response = await this.bridge.rejectPatch(sessionId, patchId, options);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      patch: response.patch || null,
    };
  }

  /**
   * Fetch the patch summary for a session.
   */
  async getPatchSummary(sessionId) {
    const response = await this.bridge.getPatchSummary(sessionId);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      summary: response.summary || null,
    };
  }

  /**
   * Create a session-scoped task graph. Each node has { id, title,
   * dependsOn[], metadata }. The graph is persisted to session metadata.
   */
  async createTaskGraph(sessionId, payload = {}) {
    const response = await this.bridge.createTaskGraph(sessionId, payload);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      graph: response.graph || null,
    };
  }

  async addTaskNode(sessionId, node) {
    const response = await this.bridge.addTaskNode(sessionId, node);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      graph: response.graph || null,
      nodeId: response.nodeId || (node && node.id) || null,
    };
  }

  async updateTaskNode(sessionId, nodeId, updates = {}) {
    const response = await this.bridge.updateTaskNode(
      sessionId,
      nodeId,
      updates,
    );
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      graph: response.graph || null,
      nodeId: response.nodeId || nodeId,
    };
  }

  async advanceTaskGraph(sessionId) {
    const response = await this.bridge.advanceTaskGraph(sessionId);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      graph: response.graph || null,
      becameReady: Array.isArray(response.becameReady)
        ? response.becameReady
        : [],
    };
  }

  async getTaskGraph(sessionId) {
    const response = await this.bridge.getTaskGraph(sessionId);
    return {
      success: true,
      sessionId: response.sessionId || sessionId,
      graph: response.graph || null,
    };
  }

  async getStatus() {
    const tools = await this.toolAdapter.listAvailableTools();
    const harness = await this.getHarnessStatus();
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
      harness: harness.harness,
    };
  }

  async getHarnessStatus() {
    const tasksResult = await this.listBackgroundTasks().catch(() => ({
      success: false,
      tasks: [],
    }));
    const tasks = Array.isArray(tasksResult.tasks) ? tasksResult.tasks : [];
    const sessions = [...this.sessions.values()];

    return {
      success: true,
      harness: {
        sessions: {
          total: sessions.length,
          running: sessions.filter((session) => session.status === "running")
            .length,
          waitingApproval: sessions.filter(
            (session) => session.status === "waiting_approval",
          ).length,
          active: sessions.filter((session) => session.status !== "closed")
            .length,
        },
        worktrees: {
          tracked: sessions.filter((session) => session.worktree).length,
          isolated: sessions.filter(
            (session) => session.worktreeIsolation === true,
          ).length,
          dirty: sessions.filter(
            (session) => session.worktree?.hasChanges === true,
          ).length,
        },
        backgroundTasks: this._summarizeBackgroundTasks(tasks),
      },
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
      this._createEvent(
        CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMATION_REQUIRED,
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
      if (!this._isExpectedSessionBootstrapMessage(message)) {
        // We only see this when the CLI emits a session-bound event before the
        // host has registered the session locally (e.g. resume race, or events
        // arriving after a process restart). Log it so anomalies are visible
        // instead of silently materializing ghost sessions.
        logger.warn(
          `[CodingAgentSessionService] Materializing previously-unknown session ${sessionId} from bridge message type=${message.type || "unknown"}`,
        );
      }
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

  _isExpectedSessionBootstrapMessage(message) {
    return (
      message?.type === "session-created" || message?.type === "session-resumed"
    );
  }

  _normalizeMessage(message, sessionId) {
    // Always prefer the resolved sessionId (from requestSessionMap) over the
    // raw message.sessionId, which the CLI sometimes omits on response messages.
    const resolvedSessionId = sessionId || message.sessionId || null;

    // CLI runtime now emits unified envelopes natively (source: "cli-runtime").
    // Detect them by the v1.0 envelope shape and pass through unchanged so we
    // do not double-wrap. Augment with the resolved sessionId if missing.
    if (
      message &&
      message.version === "1.0" &&
      typeof message.type === "string" &&
      message.payload &&
      typeof message.payload === "object" &&
      Object.prototype.hasOwnProperty.call(message, "eventId")
    ) {
      if (!message.sessionId && resolvedSessionId) {
        return { ...message, sessionId: resolvedSessionId };
      }
      return message;
    }

    // Legacy kebab-case raw messages still arrive from the request/response
    // path (session-protocol.js) — wrap them via mapLegacyType so the same
    // unified envelope shape flows downstream regardless of source path.
    return this._createEvent(message.type || "unknown", message, {
      sessionId: resolvedSessionId,
      requestId: message.id,
    });
  }

  _applySessionMutation(sessionId, event) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.updatedAt = event.timestamp;
    let policyChanged = false;

    switch (event.type) {
      case CODING_AGENT_EVENT_TYPES.SESSION_STARTED:
      case CODING_AGENT_EVENT_TYPES.SESSION_RESUMED:
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
      case CODING_AGENT_EVENT_TYPES.ASSISTANT_FINAL:
        session.status = "ready";
        if (event.payload.content) {
          session.history.push({
            role: "assistant",
            content: event.payload.content,
          });
        }
        this._completePendingRequest(session, event.requestId);
        break;
      case CODING_AGENT_EVENT_TYPES.SESSION_INTERRUPTED:
        session.status = "ready";
        this._removePendingRequestsForSession(session);
        break;
      case CODING_AGENT_EVENT_TYPES.PLAN_APPROVAL_REQUIRED:
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
      case CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE:
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
      case CODING_AGENT_EVENT_TYPES.ERROR:
        session.status = "failed";
        this._completePendingRequest(session, event.requestId);
        break;
      case CODING_AGENT_EVENT_TYPES.WORKTREE_DIFF:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          { hasChanges: true },
        );
        break;
      case CODING_AGENT_EVENT_TYPES.WORKTREE_MERGE_PREVIEW:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          { hasChanges: true },
        );
        break;
      case CODING_AGENT_EVENT_TYPES.WORKTREE_MERGED:
        session.worktree = mergeWorktreeRecord(
          session.worktree,
          event.payload.record,
          { hasChanges: event.payload.success === true ? false : true },
        );
        break;
      case CODING_AGENT_EVENT_TYPES.WORKTREE_AUTOMATION_APPLIED:
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
        category: evaluation.category,
        planModeBehavior: evaluation.planModeBehavior || null,
        readOnlySubcommands: evaluation.readOnlySubcommands || [],
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

    if (event.type === CODING_AGENT_EVENT_TYPES.PLAN_APPROVAL_REQUIRED) {
      const highRiskTools = this.permissionGate.getHighRiskToolsFromPlanItems(
        event.payload.items || [],
      );

      this._storeEvent(
        sessionId,
        this._createEvent(
          CODING_AGENT_EVENT_TYPES.PLAN_UPDATED,
          {
            summary: event.payload.summary || null,
            items: event.payload.items || [],
          },
          { sessionId, requestId: event.requestId },
        ),
      );

      this._storeEvent(
        sessionId,
        this._createEvent(
          CODING_AGENT_EVENT_TYPES.APPROVAL_REQUESTED,
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
          this._createEvent(
            CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMATION_REQUIRED,
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

    if (event.type !== CODING_AGENT_EVENT_TYPES.TOOL_CALL_COMPLETED) {
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
      this._createEvent(CODING_AGENT_EVENT_TYPES.TOOL_CALL_FAILED, assessment, {
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
      toolArgs: args,
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

  _inferApprovalType(session) {
    if (session?.planModeState === "plan_ready") {
      return "plan";
    }
    if (session?.requiresHighRiskConfirmation) {
      return "high-risk";
    }
    return "plan";
  }

  _summarizeBackgroundTasks(tasks = []) {
    const summary = {
      total: tasks.length,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      timeout: 0,
    };

    for (const task of tasks) {
      const status = String(task?.status || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(summary, status)) {
        summary[status] += 1;
      }
    }

    return summary;
  }

  _prepareEventEnvelope(event) {
    if (!event || typeof event !== "object") {
      return event;
    }

    if (event.meta?.__prepared === true) {
      return event;
    }

    const session =
      event.sessionId && this.sessions.has(event.sessionId)
        ? this.sessions.get(event.sessionId)
        : null;
    const nextSequence = session
      ? (session.eventSequence || 0) + 1
      : this.globalEventSequence + 1;

    if (session) {
      session.eventSequence = nextSequence;
    } else {
      this.globalEventSequence = nextSequence;
    }

    return {
      ...event,
      version: event.version || CODING_AGENT_EVENT_VERSION,
      eventId: event.eventId || event.id || `evt_${Date.now()}`,
      id: event.id || event.eventId || `evt_${Date.now()}`,
      source: event.source || "desktop-main",
      sequence:
        typeof event.sequence === "number" ? event.sequence : nextSequence,
      meta: {
        ...(event.meta || {}),
        __prepared: true,
      },
    };
  }

  _storeEvent(sessionId, event) {
    const preparedEvent = this._prepareEventEnvelope(event);
    const session = this.sessions.get(sessionId);
    if (!session) {
      this._emitEvent(preparedEvent);
      return;
    }

    session.events.push(preparedEvent);
    if (session.events.length > MAX_SESSION_EVENTS) {
      session.events.splice(0, session.events.length - MAX_SESSION_EVENTS);
    }

    this._emitEvent(preparedEvent);
  }

  _emitEvent(event) {
    const preparedEvent = this._prepareEventEnvelope(event);
    this.emit("event", preparedEvent);

    if (
      this.mainWindow &&
      this.mainWindow.webContents &&
      !this.mainWindow.isDestroyed()
    ) {
      this.mainWindow.webContents.send(
        CODING_AGENT_EVENT_CHANNEL,
        preparedEvent,
      );
    }

    logger.info(
      `[CodingAgentSessionService] ${preparedEvent.type} session=${preparedEvent.sessionId || "-"} request=${preparedEvent.requestId || "-"}`,
    );
  }
}

module.exports = {
  CodingAgentSessionService,
};
