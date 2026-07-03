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
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import {
  createEnvelope,
  envelopeFromStreamEvent,
  validateEnvelope,
} from "@chainlesschain/session-core";
import { createTaskRecord } from "../../runtime/contracts/task-record.js";
import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
} from "../../runtime/runtime-events.js";
import { createWsMessageDispatcher } from "./message-dispatcher.js";
import {
  RemoteSessionRegistry,
  RemoteSessionPolicy,
} from "../../harness/remote-session-registry.js";
import { RemoteSessionAuditLog } from "../../harness/remote-session-audit.js";
import { RemoteSessionAuditFileSink } from "../../harness/remote-session-audit-sink.js";
import {
  RemoteSessionPushDispatcher,
  isApprovalRequestEvent,
} from "../../harness/remote-session-push.js";
import { createRemoteSessionPushSender } from "../../harness/remote-session-push-senders.js";
import { RemoteSessionRelay } from "../remote-session-relay.js";
import { handleRemoteSessionPublish } from "./remote-session-protocol.js";
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
  handleCoworkTemplates,
  handleCoworkHistory,
  handleWorkflowList,
  handleWorkflowGet,
  handleWorkflowSave,
  handleWorkflowRemove,
  handleWorkflowRun,
} from "./action-protocol.js";
import {
  handleWorktreeDiff,
  handleWorktreeMerge,
  handleWorktreeMergePreview,
  handleWorktreeAutomationApply,
  handleWorktreeList,
  handleCompressionStats,
} from "./worktree-protocol.js";
import {
  handleChatIntentUnderstand,
  handleChatIntentUnderstandStream,
  handleChatIntentClassifyFollowup,
} from "./chat-intent-protocol.js";
import { handleLlmChat } from "./llm-chat-protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the CLI entry point */
const BIN_PATH = join(__dirname, "..", "..", "..", "bin", "chainlesschain.js");

/**
 * Commands always blocked over WebSocket (any mode):
 *  - serve: would recursively spawn another WS server
 *  - setup: needs interactive TTY
 *  - pack: meaningless self-bundling from inside running instance
 */
const ALWAYS_BLOCKED_COMMANDS = new Set(["serve", "setup", "pack"]);

/**
 * Commands blocked by default but unlocked when running inside a pack
 * artifact (CC_PACK_MODE=1). The Web UI may then expose these via a
 * shell-like surface for advanced users.
 */
const PACK_UNLOCKABLE_COMMANDS = new Set(["chat", "agent"]);

/**
 * Decide if a command is currently blocked over WebSocket.
 * Reads CC_PACK_MODE at call time so tests can flip it per-case.
 * @param {string} baseCmd
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
export function isCommandBlocked(baseCmd, env = process.env) {
  if (ALWAYS_BLOCKED_COMMANDS.has(baseCmd)) return true;
  const packMode = env.CC_PACK_MODE === "1" || env.CC_PACK_MODE === "true";
  if (PACK_UNLOCKABLE_COMMANDS.has(baseCmd) && !packMode) return true;
  return false;
}

/** Heartbeat interval (ms) */
const HEARTBEAT_INTERVAL = 30_000;

/**
 * Grace period (ms) for a token-protected connection to authenticate before it
 * is dropped. Without it an UNAUTHENTICATED client could hold a connection slot
 * indefinitely (the heartbeat only reaps sockets that stop ponging, which a
 * silent-but-alive socket does not) — so `maxConnections` unauthenticated
 * sockets exhaust every slot and lock out legitimate clients: a pre-auth
 * slot-exhaustion DoS, the time-domain complement to the `maxPayloadBytes`
 * memory cap. Only armed when a token is configured; 0 disables. Override via
 * `options.authTimeoutMs`.
 */
const AUTH_TIMEOUT_MS = 15_000;

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
    // Use ?? so an explicit `port: 0` (OS-assigned, used by tests + the
    // desktop web-shell bootstrap) is preserved instead of falling back to
    // the hardcoded 18800. The address() readback after listen() updates
    // this.port to the actual bound port — see start().
    this.port = options.port ?? 18800;
    this.host = options.host || "127.0.0.1";
    this.token = options.token || null;
    this.maxConnections = options.maxConnections || 10;
    this.timeout = options.timeout || 30000;
    // Cap inbound message size. The `ws` default is 100 MiB, and every frame is
    // decoded + JSON.parsed in _handleConnection BEFORE the dispatcher's auth
    // gate — so without a cap an UNAUTHENTICATED client could force a ~100 MB
    // allocation per frame (×maxConnections) on a LAN-exposed (Android remote)
    // deployment: a pre-auth memory-DoS. 32 MiB is generous for control frames
    // and base64 image pastes while bounding abuse; `ws` closes oversize frames
    // with code 1009 without buffering past the limit. Override per server.
    this.maxPayloadBytes = options.maxPayloadBytes || 32 * 1024 * 1024;
    // Drop a token-protected connection that never authenticates within this
    // grace window so it can't hold a maxConnections slot forever (see
    // AUTH_TIMEOUT_MS). `??` so an explicit 0 (disable) is honoured.
    this.authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;

    /** Optional Phase-5 envelope bus for fan-out to hosted HTTP SSE. */
    this.envelopeBus = options.envelopeBus || null;

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
    /** Org-policy constraints for Remote Sessions (scopes, device cap, TTL). */
    this.remoteSessionPolicy =
      options.remoteSessionPolicy || RemoteSessionPolicy.fromEnv(process.env);
    /** Local authorization state for multi-device Remote Sessions. */
    this.remoteSessions =
      options.remoteSessionRegistry ||
      new RemoteSessionRegistry({ policy: this.remoteSessionPolicy });
    /**
     * Optional durable sink (JSONL) for the audit trail. Enabled only when a
     * sink is injected or CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_FILE is set; the
     * in-memory ring stays the primary store and query surface.
     */
    this.remoteSessionAuditSink =
      options.remoteSessionAuditSink ||
      RemoteSessionAuditFileSink.fromEnv(process.env);
    /** Bounded in-memory audit trail for Remote Session lifecycle + control. */
    this.remoteSessionAudit =
      options.remoteSessionAudit ||
      new RemoteSessionAuditLog(
        this.remoteSessionAuditSink
          ? {
              sink: this.remoteSessionAuditSink.handler,
              // Hydrate so audit queries survive a restart; cap to the ring size.
              initialEntries: this.remoteSessionAuditSink.readAll({
                limit: 1000,
              }),
            }
          : {},
      );
    /**
     * Vendor-push dispatcher — wakes backgrounded paired devices for approval
     * requests. Credential-free by default (a no-op until a `sender` is
     * injected); FCM/APNs delivery is host-supplied.
     */
    this.remoteSessionPush =
      options.remoteSessionPush ||
      RemoteSessionPushDispatcher.fromEnv(process.env, {
        // Prefer an explicitly injected sender (tests / custom transport); else
        // build a real FCM sender from env when service-account creds are
        // configured. Stays a no-op (null) when neither is present.
        sender:
          options.remoteSessionPushSender ||
          createRemoteSessionPushSender(process.env),
      });
    this.remoteSessionRelayUrl = options.remoteSessionRelayUrl || null;
    this.remoteSessionPeerId = options.remoteSessionPeerId || null;
    this.remoteSessionCrypto = new Map();
    this.remoteSessionPairingSecrets = new Map();
    this.remoteSessionRelay =
      options.remoteSessionRelay ||
      (this.remoteSessionRelayUrl && this.remoteSessionPeerId
        ? new RemoteSessionRelay({
            relayUrl: this.remoteSessionRelayUrl,
            peerId: this.remoteSessionPeerId,
          })
        : null);
    this._attachRemoteSessionRelay();
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
        maxPayload: this.maxPayloadBytes,
      });

      this.wss.on("listening", () => {
        // When port 0 was requested the OS assigns an ephemeral port;
        // read it back so callers + the listening event see the actual
        // bound port instead of 0. Tests rely on this for collision-free
        // parallel runs.
        const addr = this.wss.address();
        if (addr && typeof addr === "object" && addr.port) {
          this.port = addr.port;
        }
        this._startHeartbeat();
        this.remoteSessionRelay?.connect().catch((error) => {
          this.emit("client-error", {
            clientId: "remote-session-relay",
            error: error.message,
          });
        });
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
    this.remoteSessionCrypto.clear();
    this.remoteSessionPairingSecrets.clear();
    this.remoteSessionRelay?.close();

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

    // Close the server. ws.WebSocketServer.close() waits for all underlying
    // sockets to fully terminate before invoking its callback — on slow CI
    // runners (especially GH Linux/macOS) sockets can linger in TIME_WAIT /
    // CLOSE_WAIT longer than Vitest's task timeout, causing the callback to
    // never fire and afterEach to hang forever. Hard 2s ceiling here lets
    // the test suite reclaim the worker even if a lingering socket exists;
    // the underlying handle is GC'd by node shortly after anyway.
    if (this.wss) {
      await new Promise((resolve) => {
        const ceiling = setTimeout(() => resolve(), 5000);
        this.wss.close(() => {
          clearTimeout(ceiling);
          resolve();
        });
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

    const client = {
      ws,
      authenticated: !this.token, // If no token required, auto-authenticated
      connectedAt: Date.now(),
      ip: clientIp,
      alive: true,
      authTimer: null,
    };
    this.clients.set(clientId, client);

    // Auth grace timer: a token-protected connection that never sends a valid
    // auth message would otherwise hold a slot forever (the heartbeat only reaps
    // sockets that stop ponging). Drop it after the grace window, freeing the
    // slot. Cleared on successful auth (_handleAuth) and on close. unref()'d so
    // it never keeps the process alive on its own.
    if (!client.authenticated && this.authTimeoutMs > 0) {
      client.authTimer = setTimeout(() => {
        if (this.clients.get(clientId) === client && !client.authenticated) {
          this.clients.delete(clientId);
          try {
            ws.close(1008, "Authentication timeout");
          } catch (_err) {
            // socket may already be closing
          }
          this.emit("disconnection", { clientId, reason: "auth timeout" });
        }
      }, this.authTimeoutMs);
      if (typeof client.authTimer.unref === "function") {
        client.authTimer.unref();
      }
    }

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
      if (client.authTimer) {
        clearTimeout(client.authTimer);
        client.authTimer = null;
      }
      this.clients.delete(clientId);
      for (const affected of this.remoteSessions.removeClient(clientId)) {
        if (affected.closed)
          this.remoteSessionCrypto.delete(affected.sessionId);
        if (affected.closed)
          this.remoteSessionPairingSecrets.delete(affected.sessionId);
        this.remoteSessionAudit?.record({
          sessionId: affected.sessionId,
          actor: clientId,
          action: affected.closed ? "session.closed" : "device.disconnected",
          detail: { reason: "disconnect" },
        });
      }
      this.emit("disconnection", { clientId });
    });

    // A misbehaving client (oversize frame → 1009, malformed protocol, abrupt
    // reset) makes the per-connection socket emit 'error'. With no listener Node
    // treats it as an uncaught exception and could crash the whole server — so
    // handle it here; the 'close' that follows removes the client from the map.
    ws.on("error", (err) => {
      this.emit("client-error", {
        clientId,
        error: (err && err.message) || String(err),
      });
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

  /** @private — return cowork templates for UI */
  _handleCoworkTemplates(id, ws) {
    return handleCoworkTemplates(this, id, ws);
  }

  /** @private — return cowork task history */
  _handleCoworkHistory(id, ws, message) {
    return handleCoworkHistory(this, id, ws, message);
  }

  _handleWorkflowList(id, ws) {
    return handleWorkflowList(this, id, ws);
  }
  _handleWorkflowGet(id, ws, message) {
    return handleWorkflowGet(this, id, ws, message);
  }
  _handleWorkflowSave(id, ws, message) {
    return handleWorkflowSave(this, id, ws, message);
  }
  _handleWorkflowRemove(id, ws, message) {
    return handleWorkflowRemove(this, id, ws, message);
  }
  _handleWorkflowRun(id, ws, message) {
    return handleWorkflowRun(this, id, ws, message);
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

  /** @private — port of V5 desktop project:understandIntent IPC */
  async _handleChatIntentUnderstand(id, ws, message) {
    return handleChatIntentUnderstand(this, id, ws, message);
  }

  /** @private — streaming variant emitting per-token chunks */
  async _handleChatIntentUnderstandStream(id, ws, message) {
    return handleChatIntentUnderstandStream(this, id, ws, message);
  }

  /** @private — port of V5 desktop followup-intent:classify IPC */
  async _handleChatIntentClassifyFollowup(id, ws, message) {
    return handleChatIntentClassifyFollowup(this, id, ws, message);
  }

  /** @private — single-shot streaming chat for QuickAsk (`llm.chat` topic) */
  async _handleLlmChat(id, ws, message) {
    return handleLlmChat(this, id, ws, message);
  }

  /**
   * Constant-time check of a client-supplied token against the configured one.
   * A plain `===` leaks timing that a network client could use to recover the
   * token byte-by-byte; hash both to a fixed length and compare in constant
   * time. Preserves the original semantics: no configured token matches only an
   * absent token (the auto-authenticated path).
   * @private
   */
  _tokenMatches(provided) {
    const expected = this.token;
    if (expected == null) return provided == null;
    if (typeof provided !== "string") return false;
    const a = createHash("sha256").update(provided).digest();
    const b = createHash("sha256").update(String(expected)).digest();
    return timingSafeEqual(a, b);
  }

  /** @private */
  _handleAuth(clientId, ws, message) {
    const { id, token } = message;
    const success = this._tokenMatches(token);
    const client = this.clients.get(clientId);

    if (success && client) {
      client.authenticated = true;
      // Authenticated in time — cancel the auth grace timer.
      if (client.authTimer) {
        clearTimeout(client.authTimer);
        client.authTimer = null;
      }
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
    if (isCommandBlocked(baseCmd)) {
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
        // When this server runs inside Electron (e.g. desktop web-shell)
        // process.execPath points at the Electron binary, not node. Setting
        // ELECTRON_RUN_AS_NODE=1 makes Electron behave as a plain Node
        // runtime for this child, so the CLI script runs normally instead
        // of being interpreted as a packaged Electron app entry. No-op
        // outside Electron.
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
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
    // Idempotent: clear any existing timer first so a repeated start() (or a
    // re-fired "listening" event) can't leak the previous interval — stop()
    // only clears the most recent handle, so an overwrite would orphan it.
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
    }
    this._heartbeatTimer = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (!client.alive) {
          if (client.authTimer) {
            clearTimeout(client.authTimer);
            client.authTimer = null;
          }
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
        this._mirrorRemoteSessionEvent(ws, data);
      } catch (_err) {
        // Connection may have just closed
      }
    }
  }

  /** Mirror canonical Agent Session output to paired Remote Session clients. */
  _mirrorRemoteSessionEvent(hostWs, data) {
    if (
      !data ||
      typeof data !== "object" ||
      !data.sessionId ||
      String(data.type || "").startsWith("remote-session-")
    ) {
      return;
    }
    let hostClientId = null;
    for (const [clientId, client] of this.clients) {
      if (client.ws === hostWs) {
        hostClientId = clientId;
        break;
      }
    }
    if (!hostClientId) return;

    for (const remoteSession of this.remoteSessions.findHosted(
      data.sessionId,
      hostClientId,
    )) {
      for (const member of remoteSession.members.values()) {
        if (
          member.clientId === hostClientId ||
          !member.scopes.includes("observe")
        ) {
          continue;
        }
        // Wake a backgrounded device via vendor push for approval requests.
        // Independent of the WS mirror below — a relay-paired mobile app may
        // report a live socket while its process is suspended and will never
        // read the mirrored event until the user taps the push.
        if (member.pushToken && isApprovalRequestEvent(data.type)) {
          this._dispatchApprovalPush(remoteSession, member, data);
        }
        const target = this.clients.get(member.clientId);
        if (!target && this.remoteSessionRelay) {
          const crypto = this.remoteSessionCrypto.get(remoteSession.sessionId);
          if (crypto) {
            this.remoteSessionRelay.sendEncrypted(
              member.clientId,
              crypto.encrypt(member.clientId, data),
            );
          }
          continue;
        }
        if (!target) continue;
        this._send(target.ws, {
          type: "remote-session-event",
          remoteSessionId: remoteSession.sessionId,
          agentSessionId: remoteSession.agentSessionId,
          event: data,
        });
      }
    }
  }

  /**
   * Fire-and-forget a vendor push to one member for an approval request, then
   * record the outcome in the audit trail. Never throws (the dispatcher is
   * best-effort); the WS mirror + in-app notification remain primary.
   */
  _dispatchApprovalPush(remoteSession, member, data) {
    const dispatcher = this.remoteSessionPush;
    if (!dispatcher || !dispatcher.enabled) return;
    const requestId =
      data.requestId || data.approvalId || data.id || `approval:${data.type}`;
    dispatcher
      .dispatch({
        token: member.pushToken,
        provider: member.pushProvider,
        sessionId: remoteSession.sessionId,
        clientId: member.clientId,
        dedupeKey: requestId,
        notification: {
          title: "Approval requested",
          body: "A coding session needs your approval",
        },
      })
      .then((outcome) => {
        // A vendor that reports the token as retired means the app was
        // uninstalled / the token rotated — prune it so it is never retried.
        if (outcome.code === "PUSH_TOKEN_UNREGISTERED") {
          try {
            this.remoteSessions.registerPush(
              remoteSession.sessionId,
              member.clientId,
              { token: null },
            );
          } catch {
            // Member may have been revoked meanwhile — nothing to prune.
          }
          this.remoteSessionAudit?.record({
            sessionId: remoteSession.sessionId,
            actor: member.clientId,
            action: "push.unregistered",
            detail: { provider: member.pushProvider || null },
          });
          return;
        }
        this.remoteSessionAudit?.record({
          sessionId: remoteSession.sessionId,
          actor: member.clientId,
          action:
            outcome.status === "sent"
              ? "push.sent"
              : outcome.status === "failed"
                ? "push.failed"
                : "push.skipped",
          detail: {
            provider: member.pushProvider || null,
            reason: outcome.reason || null,
            error: outcome.error || null,
          },
        });
      })
      .catch(() => {
        // Dispatcher never rejects, but guard anyway — a failed courtesy push
        // must not surface as an unhandled rejection.
      });
  }

  _attachRemoteSessionRelay() {
    if (!this.remoteSessionRelay) return;
    this.remoteSessionRelay.on("relay-message", (message) => {
      this._handleRemoteRelayMessage(message).catch((error) => {
        this.emit("client-error", {
          clientId: "remote-session-relay",
          error: error.message,
        });
      });
    });
    this.remoteSessionRelay.on("encrypted-message", ({ from, envelope }) => {
      this._handleRemoteEncryptedControl(from, envelope).catch((error) => {
        this.emit("client-error", { clientId: from, error: error.message });
      });
    });
  }

  async _handleRemoteRelayMessage(message) {
    if (
      message?.type !== "message" ||
      message.payload?.type !== "remote-session.pair"
    )
      return;
    const payload = message.payload;
    const sessionId = payload.envelope?.sessionId;
    const crypto = this.remoteSessionCrypto.get(sessionId);
    const token = this.remoteSessionPairingSecrets.get(sessionId);
    if (!crypto || !token)
      throw new Error("Remote Session pairing is unavailable or expired");
    crypto.pair(payload.mobilePeerId, payload.mobilePublicKey, token);
    const join = crypto.decrypt(payload.envelope);
    if (join.type !== "pair.join" || join.token !== token) {
      throw new Error("Invalid encrypted Remote Session pairing request");
    }
    const relayMember = this.remoteSessions.join({
      sessionId,
      clientId: payload.mobilePeerId,
      token: join.token,
      via: "relay",
      pushToken: join.pushToken,
      pushProvider: join.pushProvider,
    });
    this.remoteSessionAudit?.record({
      sessionId,
      actor: payload.mobilePeerId,
      action: "device.joined",
      detail: {
        via: "relay",
        hasPush: relayMember?.member?.pushToken ? true : false,
      },
    });
    this.remoteSessionPairingSecrets.delete(sessionId);
    this.remoteSessionRelay.sendEncrypted(
      payload.mobilePeerId,
      crypto.encrypt(payload.mobilePeerId, {
        type: "pair.accepted",
        remoteSessionId: sessionId,
      }),
    );
  }

  async _handleRemoteEncryptedControl(from, envelope) {
    const crypto = this.remoteSessionCrypto.get(envelope?.sessionId);
    if (!crypto) throw new Error("Remote Session crypto context not found");
    const event = crypto.decrypt(envelope);
    const virtualWs = {
      OPEN: 1,
      readyState: 1,
      send: (raw) => {
        const response = JSON.parse(raw);
        this.remoteSessionRelay.sendEncrypted(
          from,
          crypto.encrypt(from, response),
        );
      },
    };
    await handleRemoteSessionPublish(this, from, virtualWs, {
      id: `remote-${Date.now()}`,
      remoteSessionId: envelope.sessionId,
      event,
    });
  }

  /** @private — broadcast a message to all connected, authenticated clients */
  _broadcast(data) {
    for (const [, client] of this.clients) {
      if (client.authenticated || !this.token) {
        this._send(client.ws, data);
      }
    }
  }

  /**
   * Send a Phase-5 service envelope to a single client.
   * Accepts either a pre-built envelope or `{ type, sessionId, runId, requestId, payload }`.
   * Falls back to legacy `_send` shape if envelope construction fails so callers
   * never lose messages because of a contract bug.
   *
   * @param {WebSocket} ws
   * @param {object} envOrSpec
   */
  sendEnvelope(ws, envOrSpec) {
    let env = envOrSpec;
    if (!env || typeof env !== "object") return;
    if (!("v" in env)) {
      try {
        env = createEnvelope(envOrSpec);
      } catch (_e) {
        this._send(ws, envOrSpec);
        return;
      }
    }
    const errors = validateEnvelope(env);
    if (errors.length) {
      this._send(ws, envOrSpec);
      return;
    }
    this._send(ws, env);
  }

  /**
   * Broadcast a Phase-5 service envelope to all authenticated clients.
   */
  broadcastEnvelope(envOrSpec) {
    let env = envOrSpec;
    if (!("v" in (env || {}))) {
      try {
        env = createEnvelope(envOrSpec);
      } catch (_e) {
        this._broadcast(envOrSpec);
        return;
      }
    }
    this._broadcast(env);
    if (this.envelopeBus && env && env.sessionId) {
      try {
        this.envelopeBus.publish(env.sessionId, env);
      } catch (_e) {
        // HTTP fan-out must never break the WS path.
      }
    }
  }

  /**
   * Adapt a StreamRouter event ({type:"token", content:"..."} etc.) into a
   * Phase-5 run.* envelope and send it to a single client.
   */
  sendStreamEnvelope(ws, streamEvent, ctx) {
    try {
      const env = envelopeFromStreamEvent(streamEvent, ctx);
      this._send(ws, env);
    } catch (_e) {
      this._send(ws, streamEvent);
    }
  }
}
