const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const WebSocket = require("ws");
const { logger } = require("../../utils/logger.js");

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = _deps.netCreateServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test injection seam — overridable in unit tests via require("./coding-agent-bridge")._deps
const _deps = {
  spawn,
  WebSocket,
  netCreateServer: () => net.createServer(),
  findAvailablePort,
  wait,
};

class CodingAgentBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || "127.0.0.1";
    this.cwd = options.cwd || process.cwd();
    this.projectRoot = options.projectRoot || this.cwd;
    this.cliEntry =
      options.cliEntry ||
      path.resolve(this.cwd, "packages", "cli", "bin", "chainlesschain.js");
    this.port = options.port || null;
    this.serverProcess = null;
    this.ws = null;
    this.pending = new Map();
    this.connected = false;
    this.serverStarting = null;
  }

  async ensureReady() {
    if (
      this.connected &&
      this.ws &&
      this.ws.readyState === _deps.WebSocket.OPEN
    ) {
      return { host: this.host, port: this.port };
    }

    if (this.serverStarting) {
      return this.serverStarting;
    }

    this.serverStarting = this._startServerAndConnect();
    try {
      return await this.serverStarting;
    } finally {
      this.serverStarting = null;
    }
  }

  async _startServerAndConnect() {
    if (!this.port) {
      this.port = await _deps.findAvailablePort();
    }

    this.emit("server-starting", { host: this.host, port: this.port });

    if (!this.serverProcess || this.serverProcess.killed) {
      const args = [
        this.cliEntry,
        "serve",
        "--port",
        String(this.port),
        "--host",
        this.host,
        "--project",
        this.projectRoot,
      ];

      this.serverProcess = _deps.spawn(process.execPath, args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.serverProcess.stdout.on("data", (chunk) => {
        logger.info(`[CodingAgentBridge] CLI: ${String(chunk).trim()}`);
      });
      this.serverProcess.stderr.on("data", (chunk) => {
        logger.warn(`[CodingAgentBridge] CLI stderr: ${String(chunk).trim()}`);
      });
      this.serverProcess.on("exit", (code, signal) => {
        this.connected = false;
        this.ws = null;
        // If the CLI server crashes mid-flight, fail any in-flight requests
        // immediately instead of letting callers hang on a dead bridge.
        this._rejectAllPending(
          new Error(
            `Coding agent CLI server exited (code=${code}, signal=${signal})`,
          ),
        );
        this.emit("server-stopped", { code, signal });
      });
      this.serverProcess.on("error", (error) => {
        this.emit("error", {
          code: "CLI_SERVER_START_FAILED",
          message: error.message,
        });
      });
    }

    await this._connectWebSocket();
    this.emit("server-ready", { host: this.host, port: this.port });
    return { host: this.host, port: this.port };
  }

  async _connectWebSocket() {
    let lastError = null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await new Promise((resolve, reject) => {
          const ws = new _deps.WebSocket(`ws://${this.host}:${this.port}`);
          let settled = false;

          const cleanup = () => {
            ws.removeAllListeners("open");
            ws.removeAllListeners("error");
          };

          ws.once("open", () => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            this.ws = ws;
            this.connected = true;
            this._attachSocket(ws);
            resolve();
          });

          ws.once("error", (error) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            try {
              ws.close();
            } catch (_err) {
              // Ignore.
            }
            reject(error);
          });
        });

        return;
      } catch (error) {
        lastError = error;
        await _deps.wait(250);
      }
    }

    throw lastError || new Error("Failed to connect to coding agent server");
  }

  _attachSocket(ws) {
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(String(data));
        this._handleMessage(message);
      } catch (error) {
        this.emit("error", {
          code: "INVALID_WS_MESSAGE",
          message: error.message,
        });
      }
    });

    ws.on("close", () => {
      this.connected = false;
      this.ws = null;
      this._rejectAllPending(
        new Error("Coding agent WebSocket closed before response"),
      );
      this.emit("server-stopped", { code: null, signal: "ws-close" });
    });

    ws.on("error", (error) => {
      this.emit("error", {
        code: "WS_ERROR",
        message: error.message,
      });
    });
  }

  _handleMessage(message) {
    // Detect unified envelope: version "1.0" + eventId + payload object.
    // The CLI runtime now emits envelopes for all solicited responses; the
    // bridge correlates by `requestId` (the inbound request's id, echoed back
    // by the CLI) and unwraps `payload` so existing flat-shape callers in
    // session-service keep working unchanged. Legacy raw messages are still
    // accepted via `message.id` for graceful migration.
    const isEnvelope =
      message &&
      message.version === "1.0" &&
      typeof message.eventId === "string" &&
      message.payload &&
      typeof message.payload === "object";

    const correlationId = isEnvelope
      ? message.requestId
      : message && message.id;

    if (correlationId && this.pending.has(correlationId)) {
      const pending = this.pending.get(correlationId);
      if (message.type === "error") {
        this.pending.delete(correlationId);
        const errSrc = isEnvelope ? message.payload : message;
        pending.reject(
          new Error(errSrc.message || errSrc.code || "Unknown WS error"),
        );
      } else if (pending.awaitTypes.has(message.type)) {
        this.pending.delete(correlationId);
        if (isEnvelope) {
          // Unwrap envelope payload into a flat shape; reconstruct `id` from
          // `requestId` so callers like `sendMessage` that read `response.id`
          // still observe the bridge-generated request id.
          pending.resolve({
            ...message.payload,
            type: message.type,
            id: message.requestId,
            _envelope: message,
          });
        } else {
          pending.resolve(message);
        }
      }
    }

    this.emit("message", message);
  }

  _send(message) {
    if (!this.ws || this.ws.readyState !== _deps.WebSocket.OPEN) {
      throw new Error("Coding agent WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(message));
  }

  _rejectAllPending(reason) {
    const error =
      reason instanceof Error
        ? reason
        : new Error(reason || "Coding agent bridge disconnected");
    for (const [requestId, pending] of this.pending.entries()) {
      this.pending.delete(requestId);
      try {
        pending.reject(error);
      } catch (_err) {
        // Ignore — caller already settled.
      }
    }
  }

  send(message) {
    return this._send(message);
  }

  _createRequestId(prefix = "coding-agent") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async request(type, payload = {}, awaitTypes = []) {
    await this.ensureReady();
    const id = this._createRequestId(type);
    const request = { id, type, ...payload };

    if (!Array.isArray(awaitTypes) || awaitTypes.length === 0) {
      this._send(request);
      return { id };
    }

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, {
        awaitTypes: new Set(awaitTypes),
        resolve,
        reject,
      });
    });

    try {
      this._send(request);
    } catch (sendError) {
      // Bug fix: prevent pending leak when send fails after registration.
      this.pending.delete(id);
      throw sendError;
    }
    return promise;
  }

  async createSession(options = {}) {
    return this.request(
      "session-create",
      {
        sessionType: options.sessionType || "agent",
        provider: options.provider,
        model: options.model,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        projectRoot: options.projectRoot || this.projectRoot,
        worktreeIsolation: options.worktreeIsolation === true,
      },
      // Accept both unified envelope type and legacy kebab-case for the
      // graceful migration window.
      ["session.started", "session-created"],
    );
  }

  async resumeSession(sessionId) {
    return this.request("session-resume", { sessionId }, [
      "session.resumed",
      "session-resumed",
    ]);
  }

  async listSessions() {
    return this.request("session-list", {}, [
      "session.list",
      "session-list-result",
    ]);
  }

  async closeSession(sessionId) {
    return this.request("session-close", { sessionId }, [
      "command.response",
      "result",
    ]);
  }

  async interruptSession(sessionId) {
    return this.request("session-interrupt", { sessionId }, [
      "session.interrupted",
      "session-interrupted",
    ]);
  }

  async updateSessionPolicy(sessionId, hostManagedToolPolicy) {
    return this.request(
      "session-policy-update",
      { sessionId, hostManagedToolPolicy },
      ["command.response", "session-policy-updated"],
    );
  }

  async listWorktrees() {
    return this.request("worktree-list", {}, [
      "worktree.list",
      "worktree-list",
    ]);
  }

  async listBackgroundTasks() {
    return this.request("tasks-list", {}, ["tasks-list"]);
  }

  async getBackgroundTask(taskId) {
    return this.request("tasks-detail", { taskId }, ["tasks-detail"]);
  }

  async getBackgroundTaskHistory(taskId, options = {}) {
    return this.request(
      "tasks-history",
      {
        taskId,
        limit: options.limit,
        offset: options.offset,
      },
      ["tasks-history"],
    );
  }

  async stopBackgroundTask(taskId) {
    return this.request("tasks-stop", { taskId }, ["tasks-stopped"]);
  }

  async diffWorktree(branch, options = {}) {
    return this.request(
      "worktree-diff",
      {
        branch,
        baseBranch: options.baseBranch || null,
        filePath: options.filePath || null,
      },
      ["worktree.diff", "worktree-diff"],
    );
  }

  async mergeWorktree(branch, options = {}) {
    return this.request(
      "worktree-merge",
      {
        branch,
        strategy: options.strategy || "merge",
        commitMessage: options.commitMessage || null,
      },
      ["worktree.merged", "worktree-merged"],
    );
  }

  async previewWorktreeMerge(branch, options = {}) {
    return this.request(
      "worktree-merge-preview",
      {
        branch,
        baseBranch: options.baseBranch || null,
        strategy: options.strategy || "merge",
      },
      ["worktree.merge-preview", "worktree-merge-preview"],
    );
  }

  async applyWorktreeAutomationCandidate(branch, options = {}) {
    return this.request(
      "worktree-automation-apply",
      {
        branch,
        baseBranch: options.baseBranch || null,
        filePath: options.filePath || null,
        candidateId: options.candidateId || null,
        conflictType: options.conflictType || null,
      },
      ["worktree.automation-applied", "worktree-automation-applied"],
    );
  }

  /**
   * List sub-agents spawned from a parent session. Passing no sessionId
   * returns the global registry view (active + history across every session).
   *
   * @param {string} [sessionId]
   * @returns {Promise<object>} unwrapped sub-agent.list payload
   */
  async listSubAgents(sessionId) {
    return this.request("sub-agent-list", sessionId ? { sessionId } : {}, [
      "sub-agent.list",
    ]);
  }

  /**
   * Fetch a single sub-agent snapshot by id.
   * @param {string} subAgentId
   * @param {string} [sessionId] - optional parent session hint
   * @returns {Promise<object>} unwrapped sub-agent.list payload with .subAgent
   */
  async getSubAgent(subAgentId, sessionId) {
    return this.request(
      "sub-agent-get",
      sessionId ? { subAgentId, sessionId } : { subAgentId },
      ["sub-agent.list"],
    );
  }

  /**
   * Enter review mode on a session — blocks subsequent session-messages
   * until the review is resolved (approved or rejected).
   *
   * @param {string} sessionId
   * @param {object} [options]
   * @param {string} [options.reason]
   * @param {string} [options.requestedBy]
   * @param {Array<{id?: string, title: string, note?: string}>} [options.checklist]
   * @param {boolean} [options.blocking=true]
   * @returns {Promise<object>} unwrapped review.requested payload
   */
  async enterReview(sessionId, options = {}) {
    return this.request(
      "review-enter",
      {
        sessionId,
        reason: options.reason || null,
        requestedBy: options.requestedBy || "user",
        checklist: options.checklist || [],
        blocking: options.blocking !== false,
      },
      ["review.requested"],
    );
  }

  /**
   * Submit a comment or toggle a checklist item on the current review.
   *
   * @param {string} sessionId
   * @param {object} update
   * @param {{author?: string, content: string}} [update.comment]
   * @param {string} [update.checklistItemId]
   * @param {boolean} [update.checklistItemDone]
   * @param {string} [update.checklistItemNote]
   * @returns {Promise<object>} unwrapped review.updated payload
   */
  async submitReviewComment(sessionId, update = {}) {
    return this.request(
      "review-submit",
      {
        sessionId,
        comment: update.comment || null,
        checklistItemId: update.checklistItemId || null,
        checklistItemDone: update.checklistItemDone,
        checklistItemNote: update.checklistItemNote,
      },
      ["review.updated"],
    );
  }

  /**
   * Resolve the active review with an approved/rejected decision.
   * Unblocks the session-message gate.
   *
   * @param {string} sessionId
   * @param {object} payload
   * @param {"approved"|"rejected"} payload.decision
   * @param {string} [payload.resolvedBy]
   * @param {string} [payload.summary]
   * @returns {Promise<object>} unwrapped review.resolved payload
   */
  async resolveReview(sessionId, payload = {}) {
    return this.request(
      "review-resolve",
      {
        sessionId,
        decision: payload.decision || "approved",
        resolvedBy: payload.resolvedBy || "user",
        summary: payload.summary || null,
      },
      ["review.resolved"],
    );
  }

  /**
   * Fetch the current review state snapshot (null if none).
   *
   * @param {string} sessionId
   * @returns {Promise<object>} unwrapped review.state payload
   */
  async getReviewState(sessionId) {
    return this.request("review-status", { sessionId }, ["review.state"]);
  }

  /**
   * Propose a patch (batch of file edits) for user preview.
   *
   * @param {string} sessionId
   * @param {object} payload
   * @param {Array<{path: string, op?: string, before?: string, after?: string, diff?: string, stats?: object}>} payload.files
   * @param {string} [payload.origin]
   * @param {string} [payload.reason]
   * @param {string} [payload.requestId]
   * @returns {Promise<object>} unwrapped patch.proposed payload
   */
  async proposePatch(sessionId, payload = {}) {
    return this.request(
      "patch-propose",
      {
        sessionId,
        files: Array.isArray(payload.files) ? payload.files : [],
        origin: payload.origin || "tool",
        reason: payload.reason || null,
        requestId: payload.requestId || null,
      },
      ["patch.proposed"],
    );
  }

  /**
   * Apply a previously-proposed patch.
   *
   * @param {string} sessionId
   * @param {string} patchId
   * @param {object} [options]
   * @returns {Promise<object>} unwrapped patch.applied payload
   */
  async applyPatch(sessionId, patchId, options = {}) {
    return this.request(
      "patch-apply",
      {
        sessionId,
        patchId,
        resolvedBy: options.resolvedBy || "user",
        note: options.note || null,
      },
      ["patch.applied"],
    );
  }

  /**
   * Reject/discard a previously-proposed patch.
   *
   * @param {string} sessionId
   * @param {string} patchId
   * @param {object} [options]
   * @returns {Promise<object>} unwrapped patch.rejected payload
   */
  async rejectPatch(sessionId, patchId, options = {}) {
    return this.request(
      "patch-reject",
      {
        sessionId,
        patchId,
        resolvedBy: options.resolvedBy || "user",
        reason: options.reason || null,
      },
      ["patch.rejected"],
    );
  }

  /**
   * Fetch the patch summary for a session (pending + history + totals).
   *
   * @param {string} sessionId
   * @returns {Promise<object>} unwrapped patch.summary payload
   */
  async getPatchSummary(sessionId) {
    return this.request("patch-summary", { sessionId }, ["patch.summary"]);
  }

  /**
   * Create a task graph for a session (persistent DAG of tasks with deps).
   */
  async createTaskGraph(sessionId, payload = {}) {
    return this.request(
      "task-graph-create",
      {
        sessionId,
        graphId: payload.graphId || null,
        title: payload.title || null,
        description: payload.description || null,
        nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
      },
      ["task-graph.created"],
    );
  }

  /**
   * Add a node to the active task graph.
   */
  async addTaskNode(sessionId, node) {
    return this.request("task-graph-add-node", { sessionId, node }, [
      "task-graph.node.added",
    ]);
  }

  /**
   * Update a task graph node (status / result / error / metadata).
   */
  async updateTaskNode(sessionId, nodeId, updates = {}) {
    return this.request(
      "task-graph-update-node",
      { sessionId, nodeId, updates },
      [
        "task-graph.node.updated",
        "task-graph.node.completed",
        "task-graph.node.failed",
      ],
    );
  }

  /**
   * Advance the task graph: promote pending nodes whose deps are satisfied.
   */
  async advanceTaskGraph(sessionId) {
    return this.request("task-graph-advance", { sessionId }, [
      "task-graph.advanced",
    ]);
  }

  /**
   * Fetch the current task graph state.
   */
  async getTaskGraph(sessionId) {
    return this.request("task-graph-state", { sessionId }, [
      "task-graph.state",
    ]);
  }

  async sendMessage(sessionId, content) {
    const response = await this.request("session-message", {
      sessionId,
      content,
    });
    return { requestId: response.id };
  }

  async sendSlashCommand(sessionId, command) {
    const response = await this.request("slash-command", {
      sessionId,
      command,
    });
    return { requestId: response.id };
  }

  async shutdown() {
    this._rejectAllPending(new Error("Coding agent bridge shutting down"));

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_err) {
        // Ignore.
      }
      this.ws = null;
    }
    this.connected = false;

    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill();
    }
    this.serverProcess = null;
  }
}

module.exports = {
  CodingAgentBridge,
  _deps,
};
