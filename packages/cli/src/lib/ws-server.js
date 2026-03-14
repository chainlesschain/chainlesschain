/**
 * ChainlessChain WebSocket Server
 *
 * Exposes CLI commands over WebSocket for remote access by IDE plugins,
 * web frontends, automation scripts, etc. Commands are executed by spawning
 * child processes — all 60+ CLI commands are available immediately.
 */

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the CLI entry point */
const BIN_PATH = join(__dirname, "..", "..", "bin", "chainlesschain.js");

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
    const { id, type } = message;

    if (!id) {
      this._send(ws, {
        type: "error",
        code: "MISSING_ID",
        message: 'Message must include an "id" field',
      });
      return;
    }

    // Check authentication
    const client = this.clients.get(clientId);
    if (this.token && !client.authenticated && type !== "auth") {
      this._send(ws, {
        id,
        type: "error",
        code: "AUTH_REQUIRED",
        message: "Authentication required. Send an auth message first.",
      });
      return;
    }

    switch (type) {
      case "auth":
        this._handleAuth(clientId, ws, message);
        break;
      case "ping":
        this._send(ws, { id, type: "pong", serverTime: Date.now() });
        break;
      case "execute":
        this._executeCommand(id, ws, message.command, false);
        break;
      case "stream":
        this._executeCommand(id, ws, message.command, true);
        break;
      case "cancel":
        this._cancelRequest(id, ws);
        break;
      case "session-create":
        await this._handleSessionCreate(id, ws, message);
        break;
      case "session-resume":
        this._handleSessionResume(id, ws, message);
        break;
      case "session-message":
        this._handleSessionMessage(id, ws, message);
        break;
      case "session-list":
        this._handleSessionList(id, ws);
        break;
      case "session-close":
        this._handleSessionClose(id, ws, message);
        break;
      case "slash-command":
        this._handleSlashCommand(id, ws, message);
        break;
      case "session-answer":
        this._handleSessionAnswer(id, ws, message);
        break;
      default:
        this._send(ws, {
          id,
          type: "error",
          code: "UNKNOWN_TYPE",
          message: `Unknown message type: ${type}`,
        });
    }
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
    if (!this.sessionManager) {
      this._send(ws, {
        id,
        type: "error",
        code: "NO_SESSION_SUPPORT",
        message: "Session support not configured on this server",
      });
      return;
    }

    const { sessionType, provider, model, apiKey, baseUrl, projectRoot } =
      message;

    try {
      const { sessionId } = this.sessionManager.createSession({
        type: sessionType || "agent",
        provider,
        model,
        apiKey,
        baseUrl,
        projectRoot,
      });

      const session = this.sessionManager.getSession(sessionId);

      // Lazy-load handler modules to avoid circular deps
      try {
        const { WebSocketInteractionAdapter } =
          await import("./interaction-adapter.js");
        session.interaction = new WebSocketInteractionAdapter(ws, sessionId);

        let handler;
        if ((sessionType || "agent") === "chat") {
          const { WSChatHandler } = await import("./ws-chat-handler.js");
          handler = new WSChatHandler({
            session,
            interaction: session.interaction,
          });
        } else {
          const { WSAgentHandler } = await import("./ws-agent-handler.js");
          handler = new WSAgentHandler({
            session,
            interaction: session.interaction,
            db: this.sessionManager.db,
          });
        }
        this.sessionHandlers.set(sessionId, handler);
      } catch (_err) {
        // Handler creation failed — session still created, handler can be set later
      }

      this.emit("session:create", { sessionId, type: sessionType || "agent" });

      this._send(ws, {
        id,
        type: "session-created",
        sessionId,
        sessionType: sessionType || "agent",
      });
    } catch (err) {
      this._send(ws, {
        id,
        type: "error",
        code: "SESSION_CREATE_FAILED",
        message: err.message,
      });
    }
  }

  /** @private */
  _handleSessionResume(id, ws, message) {
    if (!this.sessionManager) {
      this._send(ws, {
        id,
        type: "error",
        code: "NO_SESSION_SUPPORT",
        message: "Session support not configured",
      });
      return;
    }

    const { sessionId } = message;
    const session = this.sessionManager.resumeSession(sessionId);

    if (!session) {
      this._send(ws, {
        id,
        type: "error",
        code: "SESSION_NOT_FOUND",
        message: `Session not found: ${sessionId}`,
      });
      return;
    }

    // Filter out system messages for history
    const history = (session.messages || []).filter((m) => m.role !== "system");

    this._send(ws, {
      id,
      type: "session-resumed",
      sessionId: session.id,
      history,
    });
  }

  /** @private */
  _handleSessionMessage(id, ws, message) {
    const { sessionId, content } = message;
    const handler = this.sessionHandlers.get(sessionId);

    if (!handler) {
      this._send(ws, {
        id,
        type: "error",
        code: "SESSION_NOT_FOUND",
        message: `No active session handler for: ${sessionId}`,
      });
      return;
    }

    // Fire and forget — handler emits events via interaction adapter
    handler
      .handleMessage(content, id)
      .then(() => {
        // Persist messages after each turn
        if (this.sessionManager) {
          try {
            this.sessionManager.persistMessages(sessionId);
          } catch (_err) {
            // Non-critical
          }
        }
      })
      .catch((err) => {
        this._send(ws, {
          id,
          type: "error",
          code: "MESSAGE_FAILED",
          message: err.message,
        });
      });
  }

  /** @private */
  _handleSessionList(id, ws) {
    if (!this.sessionManager) {
      this._send(ws, {
        id,
        type: "error",
        code: "NO_SESSION_SUPPORT",
        message: "Session support not configured",
      });
      return;
    }

    const sessions = this.sessionManager.listSessions();
    this._send(ws, {
      id,
      type: "session-list-result",
      sessions,
    });
  }

  /** @private */
  _handleSessionClose(id, ws, message) {
    const { sessionId } = message;

    // Remove handler
    const handler = this.sessionHandlers.get(sessionId);
    if (handler && handler.destroy) {
      handler.destroy();
    }
    this.sessionHandlers.delete(sessionId);

    // Close session in manager
    if (this.sessionManager) {
      try {
        this.sessionManager.closeSession(sessionId);
      } catch (_err) {
        // Non-critical
      }
    }

    this.emit("session:close", { sessionId });

    this._send(ws, {
      id,
      type: "result",
      success: true,
      sessionId,
    });
  }

  /** @private */
  _handleSlashCommand(id, ws, message) {
    const { sessionId, command } = message;
    const handler = this.sessionHandlers.get(sessionId);

    if (!handler) {
      this._send(ws, {
        id,
        type: "error",
        code: "SESSION_NOT_FOUND",
        message: `No active session handler for: ${sessionId}`,
      });
      return;
    }

    handler.handleSlashCommand(command, id);
  }

  /** @private */
  _handleSessionAnswer(id, ws, message) {
    const { sessionId, requestId, answer } = message;

    if (!this.sessionManager) {
      this._send(ws, {
        id,
        type: "error",
        code: "NO_SESSION_SUPPORT",
        message: "Session support not configured",
      });
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (session && session.interaction && session.interaction.resolveAnswer) {
      session.interaction.resolveAnswer(requestId, answer);
    }

    this._send(ws, { id, type: "result", success: true });
  }

  /** @private — ping/pong heartbeat to detect dead connections */
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
}
