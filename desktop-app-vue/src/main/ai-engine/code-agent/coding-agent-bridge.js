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
    if (message && message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      if (message.type === "error") {
        this.pending.delete(message.id);
        pending.reject(
          new Error(message.message || message.code || "Unknown WS error"),
        );
      } else if (pending.awaitTypes.has(message.type)) {
        this.pending.delete(message.id);
        pending.resolve(message);
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
      ["session-created"],
    );
  }

  async resumeSession(sessionId) {
    return this.request("session-resume", { sessionId }, ["session-resumed"]);
  }

  async listSessions() {
    return this.request("session-list", {}, ["session-list-result"]);
  }

  async closeSession(sessionId) {
    return this.request("session-close", { sessionId }, ["result"]);
  }

  async updateSessionPolicy(sessionId, hostManagedToolPolicy) {
    return this.request(
      "session-policy-update",
      { sessionId, hostManagedToolPolicy },
      ["session-policy-updated"],
    );
  }

  async listWorktrees() {
    return this.request("worktree-list", {}, ["worktree-list"]);
  }

  async diffWorktree(branch, options = {}) {
    return this.request(
      "worktree-diff",
      {
        branch,
        baseBranch: options.baseBranch || null,
        filePath: options.filePath || null,
      },
      ["worktree-diff"],
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
      ["worktree-merged"],
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
      ["worktree-merge-preview"],
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
      ["worktree-automation-applied"],
    );
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
