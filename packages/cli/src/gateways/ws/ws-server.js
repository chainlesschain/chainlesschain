/**
 * ChainlessChain WebSocket Server
 *
 * Exposes CLI commands over WebSocket for remote access by IDE plugins,
 * web frontends, automation scripts, etc. Commands are executed by spawning
 * child processes — all 60+ CLI commands are available immediately.
 *
 * Canonical location (moved from src/lib/ws-server.js as part of the
 * CLI Runtime Convergence roadmap, Phase 6a). src/lib/ws-server.js is
 * now a thin re-export shim for backwards compatibility.
 */

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import { createTaskRecord } from "../../runtime/contracts/task-record.js";
import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
} from "../../runtime/runtime-events.js";
import { createWsMessageDispatcher } from "./message-dispatcher.js";
import { handleTaskDetail, handleTaskHistory } from "./task-protocol.js";
import {
  handleSessionCreate,
  handleSessionResume,
  handleSessionMessage,
  handleSessionPolicyUpdate,
  handleSessionList,
  handleSessionClose,
  handleSessionInterrupt,
  handleSessionAnswer,
  handleHostToolResult,
  handleSubAgentList,
  handleSubAgentGet,
  handleReviewEnter,
  handleReviewSubmit,
  handleReviewResolve,
  handleReviewStatus,
  handlePatchPropose,
  handlePatchApply,
  handlePatchReject,
  handlePatchSummary,
  handleTaskGraphCreate,
  handleTaskGraphAddNode,
  handleTaskGraphUpdateNode,
  handleTaskGraphAdvance,
  handleTaskGraphState,
} from "./session-protocol.js";
import {
  handleSlashCommand,
  handleOrchestrate,
  handleCoworkTask,
  handleCoworkCancel,
} from "./action-protocol.js";
import {
  handleWorktreeDiff,
  handleWorktreeMerge,
  handleWorktreeMergePreview,
  handleWorktreeAutomationApply,
  handleWorktreeList,
  handleCompressionStats,
} from "./worktree-protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the CLI entry point */
const BIN_PATH = join(__dirname, "..", "..", "..", "bin", "chainlesschain.js");

/** Commands that must not be executed via WebSocket */
const BLOCKED_COMMANDS = new Set(["serve", "chat", "agent", "setup"]);

/** Heartbeat interval (ms) */
const HEARTBEAT_INTERVAL = 30_000;

/**
 * Tokenize a command string into an array of arguments.
 * Handles double-quoted and single-quoted strings. Does NOT invoke a shell.
 */
export function tokenizeCommand(input) {
  const args = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let escape = false;

  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escape = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inDouble && !inSingle) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

export class ChainlessChainWSServer extends EventEmitter {
  /**
   * @param {object} options
   * @param {number}  [options.port=18800]
   * @param {string}  [options.host="127.0.0.1"]
   * @param {string}  [options.token]           - If set, clients must authenticate first
   * @param {number}  [options.maxConnections=10]
   * @param {number}  [options.timeout=30000]   - Command execution timeout (ms)
   */
  constructor(options = {}) {
    super();
    this.port = options.port || 18800;
    this.host = options.host || "127.0.0.1";
    this.token = options.token || null;
    this.maxConnections = options.maxConnections || 10;
    this.timeout = options.timeout || 30000;

    /** @type {WebSocketServer|null} */
    this.wss = null;

    /** Connected clients: clientId → { ws, authenticated, connectedAt } */
    this.clients = new Map();

    /** Running child processes: requestId → ChildProcess */
    this.processes = new Map();

    /** Session manager for stateful agent/chat sessions */
    this.sessionManager = options.sessionManager || null;

    /** Session handlers: sessionId → WSAgentHandler | WSChatHandler */
    this.sessionHandlers = new Map();
    this._dispatcher = createWsMessageDispatcher(this);

    this._heartbeatTimer = null;
    this._clientCounter = 0;
  }

  /** Start the WebSocket server */
  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.port,
        host: this.host,
      });

      this.wss.on("listening", () => {
        this._startHeartbeat();
        this.emit("listening", { port: this.port, host: this.host });
        resolve();
      });

      this.wss.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.wss.on("connection", (ws, req) => this._handleConnection(ws, req));
    });
  }

  /** Stop the server and clean up */
  async stop() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    // Close all session handlers
    for (const [sessionId, handler] of this.sessionHandlers) {
      if (handler && handler.destroy) {
        handler.destroy();
      }
      if (this.sessionManager) {
        try {
          this.sessionManager.closeSession(sessionId);
        } catch (_err) {
          // Non-critical
        }
      }
    }
    this.sessionHandlers.clear();

    // Kill all running child processes
    for (const [id, child] of this.processes) {
      try {
        child.kill("SIGTERM");
      } catch (_err) {
        // Process may have already exited
      }
      this.processes.delete(id);
    }

    // Close all client connections
    for (const [, client] of this.clients) {
      try {
        client.ws.close(1001, "Server shutting down");
      } catch (_err) {
        // Connection may already be closed
      }
    }
    this.clients.clear();

    // Close the server
    if (this.wss) {
      await new Promise((resolve) => {
        this.wss.close(() => resolve());
      });
      this.wss = null;
    }

    this.emit("stopped");
  }

  /** @private */
  _handleConnection(ws, req) {
    if (this.clients.size >= this.maxConnections) {
      ws.close(1013, "Max connections reached");
      return;
    }

    const clientId = `client-${++this._clientCounter}`;
    const clientIp =
      req.socket.remoteAddress || req.headers["x-forwarded-for"] || "unknown";

    this.clients.set(clientId, {
      ws,
      authenticated: !this.token, // If no token required, auto-authenticated
      connectedAt: Date.now(),
      ip: clientIp,
      alive: true,
    });

    this.emit("connection", { clientId, ip: clientIp });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString("utf8"));
        this._handleMessage(clientId, ws, message);
      } catch (_err) {
        this._send(ws, {
          type: "error",
          code: "INVALID_JSON",
          message: "Failed to parse message as JSON",
        });
      }
    });

    ws.on("close", () => {
      this.clients.delete(clientId);
      this.emit("disconnection", { clientId });
    });

    ws.on("pong", () => {
      const client = this.clients.get(clientId);
      if (client) client.alive = true;
    });
  }

  /** @private */
  async _handleMessage(clientId, ws, message) {
    return this._dispatcher.dispatch(clientId, ws, message);
  }

  /**
   * Handle an orchestrate message — runs ChainlessChain orchestration with
   * real-time progress pushed back over this WebSocket connection.
   *
   * Message format:
   *   { type: "orchestrate", id: "req-1", task: "Fix bug X",
   *     cwd: "/path", agents: 3, ci: "npm test", notify: false }
   *
   * Events emitted back:
   *   { type: "orchestrate:event", event: "start|agent:output|ci:pass|ci:fail|task:status", ... }
   *   { type: "orchestrate:done", id, taskId, status }
   *   { type: "error", code: "ORCHESTRATE_FAILED", ... }
   */
  async _handleOrchestrate(id, ws, message) {
    return handleOrchestrate(this, id, ws, message);
  }

  /** @private — run a cowork daily task via SubAgentContext */
  async _handleCoworkTask(id, ws, message) {
    return handleCoworkTask(this, id, ws, message);
  }

  /** @private — cancel a running cowork task */
  _handleCoworkCancel(id, ws, message) {
    return handleCoworkCancel(this, id, ws, message);
  }

  /** @private – list background tasks */
  async _handleTasksList(id, ws) {
    try {
      await this._ensureTaskManager();
      const tasks = this._taskManager.list();
      this._send(ws, { id, type: "tasks-list", tasks });
    } catch (err) {
      this._send(ws, { id, type: "tasks-list", tasks: [] });
    }
  }

  /** @private — subscribe to task completion events and broadcast to all clients */
  _subscribeTaskNotifications() {
    if (!this._taskManager || this._taskNotificationsSubscribed) return;
    this._taskNotificationsSubscribed = true;

    this._taskManager.on("task:complete", (task) => {
      const record = createTaskRecord(task, {
        source: "background-task-manager",
      });
      this.emit(
        RUNTIME_EVENTS.TASK_NOTIFICATION,
        createRuntimeEvent(
          RUNTIME_EVENTS.TASK_NOTIFICATION,
          { task: record },
          { kind: "server" },
        ),
      );
      this._broadcast({
        type: "task:notification",
        task: record,
      });
    });
  }

  /** @private – stop a background task */
  async _handleTasksStop(id, ws, message) {
    try {
      await this._ensureTaskManager();

      if (this._taskManager && message.taskId) {
        this._taskManager.stop(message.taskId);
        this._send(ws, { id, type: "tasks-stopped", taskId: message.taskId });
      } else {
        this._send(ws, {
          id,
          type: "error",
          code: "NO_TASK",
          message: "taskId required or no task manager",
        });
      }
    } catch (err) {
      this._send(ws, {
        id,
        type: "error",
        code: "TASKS_STOP_FAILED",
        message: err.message,
      });
    }
  }

  /** @private */
  async _handleTaskDetail(id, ws, message) {
    return handleTaskDetail(this, id, ws, message);
  }

  /** @private */
  async _handleTaskHistory(id, ws, message) {
    return handleTaskHistory(this, id, ws, message);
  }

  /** @private — diff preview for agent worktree branch */
  async _handleWorktreeDiff(id, ws, message) {
    return handleWorktreeDiff(this, id, ws, message);
  }

  /** @private — one-click merge of agent worktree branch */
  async _handleWorktreeMerge(id, ws, message) {
    return handleWorktreeMerge(this, id, ws, message);
  }

  /** @private - dry-run merge preview for an agent worktree branch */
  async _handleWorktreeMergePreview(id, ws, message) {
    return handleWorktreeMergePreview(this, id, ws, message);
  }

  /** @private - apply a safe automation candidate inside an agent worktree */
  async _handleWorktreeAutomationApply(id, ws, message) {
    return handleWorktreeAutomationApply(this, id, ws, message);
  }

  /** @private - list agent worktrees */
  async _handleWorktreeList(id, ws) {
    return handleWorktreeList(this, id, ws);
  }

  /** @private */
  async _handleCompressionStats(id, ws, message) {
    return handleCompressionStats(this, id, ws, message);
  }

  /** @private */
  _handleAuth(clientId, ws, message) {
    const { id, token } = message;
    const success = token === this.token;
    const client = this.clients.get(clientId);

    if (success && client) {
      client.authenticated = true;
    }

    this._send(ws, {
      id,
      type: "auth-result",
      success,
      ...(success ? {} : { message: "Invalid token" }),
    });

    if (!success) {
      // Disconnect after failed auth
      setTimeout(() => ws.close(4001, "Authentication failed"), 100);
    }
  }

  /** @private */
  _executeCommand(id, ws, command, stream) {
    if (!command || typeof command !== "string") {
      this._send(ws, {
        id,
        type: "error",
        code: "INVALID_COMMAND",
        message: "Command must be a non-empty string",
      });
      return;
    }

    const args = tokenizeCommand(command.trim());
    if (args.length === 0) {
      this._send(ws, {
        id,
        type: "error",
        code: "INVALID_COMMAND",
        message: "Empty command",
      });
      return;
    }

    // Block dangerous/interactive commands
    const baseCmd = args[0];
    if (BLOCKED_COMMANDS.has(baseCmd)) {
      this._send(ws, {
        id,
        type: "error",
        code: "COMMAND_BLOCKED",
        message: `Command "${baseCmd}" cannot be executed via WebSocket (interactive or recursive)`,
      });
      return;
    }

    const child = spawn(process.execPath, [BIN_PATH, ...args], {
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_SPINNER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.processes.set(id, child);
    this.emit("command:start", { id, command, stream });

    // Timeout handling
    const timer = setTimeout(() => {
      if (this.processes.has(id)) {
        try {
          child.kill("SIGTERM");
        } catch (_err) {
          // Process may have already exited
        }
        this.processes.delete(id);
        this._send(ws, {
          id,
          type: "error",
          code: "COMMAND_TIMEOUT",
          message: `Command timed out after ${this.timeout}ms`,
        });
      }
    }, this.timeout);

    if (stream) {
      // Stream mode: send chunks as they arrive
      child.stdout.on("data", (data) => {
        this._send(ws, {
          id,
          type: "stream-data",
          channel: "stdout",
          data: data.toString("utf8"),
        });
      });

      child.stderr.on("data", (data) => {
        this._send(ws, {
          id,
          type: "stream-data",
          channel: "stderr",
          data: data.toString("utf8"),
        });
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        this.processes.delete(id);
        this._send(ws, {
          id,
          type: "stream-end",
          exitCode: exitCode ?? 1,
        });
        this.emit("command:end", { id, exitCode });
      });
    } else {
      // Buffered mode: collect all output then send result
      const stdoutChunks = [];
      const stderrChunks = [];

      child.stdout.on("data", (data) => stdoutChunks.push(data));
      child.stderr.on("data", (data) => stderrChunks.push(data));

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        this.processes.delete(id);

        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");

        this._send(ws, {
          id,
          type: "result",
          success: exitCode === 0,
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
        });
        this.emit("command:end", { id, exitCode });
      });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      this.processes.delete(id);
      this._send(ws, {
        id,
        type: "error",
        code: "SPAWN_ERROR",
        message: err.message,
      });
    });
  }

  /** @private */
  _cancelRequest(id, ws) {
    const child = this.processes.get(id);
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch (_err) {
        // Process may have already exited
      }
      this.processes.delete(id);
      this._send(ws, {
        id,
        type: "result",
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: "Cancelled by client",
      });
    } else {
      this._send(ws, {
        id,
        type: "error",
        code: "NOT_FOUND",
        message: `No running command with id "${id}"`,
      });
    }
  }

  // ─── Session handlers ─────────────────────────────────────────────

  /** @private */
  async _handleSessionCreate(id, ws, message) {
    return handleSessionCreate(this, id, ws, message);
  }

  /** @private */
  async _handleSessionResume(id, ws, message) {
    return handleSessionResume(this, id, ws, message);
  }

  /** @private */
  _handleSessionMessage(id, ws, message) {
    return handleSessionMessage(this, id, ws, message);
  }

  /** @private */
  _handleSessionPolicyUpdate(id, ws, message) {
    return handleSessionPolicyUpdate(this, id, ws, message);
  }

  /** @private */
  _handleSessionList(id, ws) {
    return handleSessionList(this, id, ws);
  }

  /** @private */
  _handleSessionClose(id, ws, message) {
    return handleSessionClose(this, id, ws, message);
  }

  /** @private */
  _handleSessionInterrupt(id, ws, message) {
    return handleSessionInterrupt(this, id, ws, message);
  }

  /** @private */
  _handleSlashCommand(id, ws, message) {
    return handleSlashCommand(this, id, ws, message);
  }

  /** @private */
  _handleSessionAnswer(id, ws, message) {
    return handleSessionAnswer(this, id, ws, message);
  }

  _handleHostToolResult(id, ws, message) {
    return handleHostToolResult(this, id, ws, message);
  }

  /** @private */
  _handleSubAgentList(id, ws, message) {
    return handleSubAgentList(this, id, ws, message);
  }

  /** @private */
  _handleSubAgentGet(id, ws, message) {
    return handleSubAgentGet(this, id, ws, message);
  }

  /** @private */
  _handleReviewEnter(id, ws, message) {
    return handleReviewEnter(this, id, ws, message);
  }

  /** @private */
  _handleReviewSubmit(id, ws, message) {
    return handleReviewSubmit(this, id, ws, message);
  }

  /** @private */
  _handleReviewResolve(id, ws, message) {
    return handleReviewResolve(this, id, ws, message);
  }

  /** @private */
  _handleReviewStatus(id, ws, message) {
    return handleReviewStatus(this, id, ws, message);
  }

  /** @private */
  _handlePatchPropose(id, ws, message) {
    return handlePatchPropose(this, id, ws, message);
  }

  /** @private */
  _handlePatchApply(id, ws, message) {
    return handlePatchApply(this, id, ws, message);
  }

  /** @private */
  _handlePatchReject(id, ws, message) {
    return handlePatchReject(this, id, ws, message);
  }

  /** @private */
  _handlePatchSummary(id, ws, message) {
    return handlePatchSummary(this, id, ws, message);
  }

  /** @private */
  _handleTaskGraphCreate(id, ws, message) {
    return handleTaskGraphCreate(this, id, ws, message);
  }

  /** @private */
  _handleTaskGraphAddNode(id, ws, message) {
    return handleTaskGraphAddNode(this, id, ws, message);
  }

  /** @private */
  _handleTaskGraphUpdateNode(id, ws, message) {
    return handleTaskGraphUpdateNode(this, id, ws, message);
  }

  /** @private */
  _handleTaskGraphAdvance(id, ws, message) {
    return handleTaskGraphAdvance(this, id, ws, message);
  }

  /** @private */
  _handleTaskGraphState(id, ws, message) {
    return handleTaskGraphState(this, id, ws, message);
  }

  /** @private — ping/pong heartbeat to detect dead connections */
  async _ensureTaskManager() {
    if (this._taskManager) return this._taskManager;
    const { BackgroundTaskManager } =
      await import("../../harness/background-task-manager.js");
    this._taskManager = new BackgroundTaskManager({ recoverOnStart: true });
    this._subscribeTaskNotifications();
    return this._taskManager;
  }

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (!client.alive) {
          client.ws.terminate();
          this.clients.delete(clientId);
          this.emit("disconnection", { clientId, reason: "heartbeat timeout" });
          continue;
        }
        client.alive = false;
        try {
          client.ws.ping();
        } catch (_err) {
          // Connection may be closing
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  /** @private — safe JSON send */
  _send(ws, data) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (_err) {
        // Connection may have just closed
      }
    }
  }

  /** @private — broadcast a message to all connected, authenticated clients */
  _broadcast(data) {
    for (const [, client] of this.clients) {
      if (client.authenticated || !this.token) {
        this._send(client.ws, data);
      }
    }
  }
}
