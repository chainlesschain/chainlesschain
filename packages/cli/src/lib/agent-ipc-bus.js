/**
 * Agent IPC Bus — M2: 后台Agent实时交互总线
 * 对应文档 §2.2
 *
 * 解决后台agent运行期间不能提问/confirm/elicit的问题:
 * - child agent 通过 IPC 发送 interaction_request
 * - parent 路由给 UI/REPL/headless resolver
 * - 结果通过 interaction_response 返回child
 * - 支持超时、取消、默认值
 */

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { EventRuntimeProducer } from "./event-runtime-producer.js";
import { EventRuntimeStore } from "./event-runtime-store.js";
import executionBroker from "./process-execution-broker/index.js";
import {
  AGENT_IPC_DEFAULT_LIMITS,
  boundedTimeout,
  createBoundedStdinWriter,
  normalizeAgentIPCLimits,
  overloadError,
} from "./agent-ipc-flow-control.js";

export { AGENT_IPC_DEFAULT_LIMITS };

export const _deps = {
  spawn: executionBroker.spawn.bind(executionBroker),
};

/**
 * @typedef {Object} InteractionRequest
 * @property {string} requestId
 * @property {string} agentId - child agent id
 * @property {string} sessionId
 * @property {string} turnId
 * @property {'permission_prompt'|'human_input'|'question'|'confirm'|'elicit'|'mcp_elicit'} type
 * @property {string} prompt
 * @property {string[]} [choices]
 * @property {any} [defaultValue]
 * @property {number} [timeoutMs]
 * @property {Object} [metadata]
 */

class AgentIPCBus extends EventEmitter {
  constructor({ runtimeStore = null, ...limits } = {}) {
    super();
    this.limits = normalizeAgentIPCLimits(limits);
    this._runtimeProducer = runtimeStore
      ? new EventRuntimeProducer({ store: runtimeStore, emitter: this })
      : null;
    /** @type {Map<string, {req: InteractionRequest, resolve: Function, reject: Function, timer?: NodeJS.Timeout}>} */
    this._pendingRequests = new Map();
    /** @type {Map<string, {agentId: string, method: string, resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this._pendingAgentRequests = new Map();
    /** @type {Map<string, Function>} resolvers by agentId */
    this._agentResolvers = new Map();
    /** @type {Map<string, {status: Function, close: Function}>} */
    this._childTransports = new Map();
  }

  /**
   * Register an agent worker's send function so bus can route responses back
   * @param {string} agentId
   * @param {(msg: any) => void} sendToWorker
   */
  registerAgent(agentId, sendToWorker) {
    if (
      !this._agentResolvers.has(agentId) &&
      !this._childTransports.has(agentId) &&
      this._activeAgentCount() >= this.limits.maxAgents
    ) {
      throw overloadError(
        "registered_agents",
        this.limits.maxAgents,
        this.limits.overloadRetryAfterMs,
      );
    }
    this._agentResolvers.set(agentId, sendToWorker);
    this.emit("agent:registered", { agentId });
  }

  unregisterAgent(agentId) {
    const hadAgent = this._agentResolvers.has(agentId);
    const hadTransport = this._childTransports.has(agentId);
    let rejectedPending = false;
    this._agentResolvers.delete(agentId);
    // Reject all pending for this agent
    for (const [reqId, entry] of this._pendingRequests.entries()) {
      if (entry.req.agentId === agentId) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(
          new Error(`Agent ${agentId} disconnected while waiting for response`),
        );
        this._pendingRequests.delete(reqId);
        rejectedPending = true;
      }
    }
    for (const [requestId, entry] of this._pendingAgentRequests.entries()) {
      if (entry.agentId === agentId) {
        clearTimeout(entry.timer);
        entry.reject(
          new Error(
            `Agent ${agentId} disconnected while handling ${entry.method}`,
          ),
        );
        this._pendingAgentRequests.delete(requestId);
        rejectedPending = true;
      }
    }
    this._childTransports.get(agentId)?.close();
    this._childTransports.delete(agentId);
    if (hadAgent || hadTransport || rejectedPending) {
      this.emit("agent:unregistered", { agentId });
    }
  }

  isAgentRegistered(agentId) {
    return this._agentResolvers.has(agentId);
  }

  /**
   * Child agent calls this to request human interaction
   * @param {string} agentId
   * @param {Partial<InteractionRequest>} req
   * @returns {Promise<any>}
   */
  requestInteraction(agentId, req = {}) {
    if (this._pendingRequests.size >= this.limits.maxPendingInteractions) {
      return Promise.reject(
        overloadError(
          "pending_interactions",
          this.limits.maxPendingInteractions,
          this.limits.overloadRetryAfterMs,
        ),
      );
    }
    let pendingForAgent = 0;
    for (const entry of this._pendingRequests.values()) {
      if (entry.req.agentId === agentId) pendingForAgent += 1;
    }
    if (pendingForAgent >= this.limits.maxPendingInteractionsPerAgent) {
      return Promise.reject(
        overloadError(
          "pending_interactions_per_agent",
          this.limits.maxPendingInteractionsPerAgent,
          this.limits.overloadRetryAfterMs,
        ),
      );
    }

    const requestId = crypto.randomUUID();
    let timeoutMs;
    try {
      timeoutMs = boundedTimeout(
        req.timeoutMs,
        this.limits.interactionTimeoutMs,
        this.limits.maxInteractionTimeoutMs,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const fullReq = {
      requestId,
      agentId,
      sessionId: req.sessionId,
      turnId: req.turnId,
      type: req.type || "question",
      prompt: req.prompt,
      choices: req.choices,
      defaultValue: req.defaultValue,
      timeoutMs,
      metadata: req.metadata || {},
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        if (fullReq.defaultValue !== undefined) {
          resolve(fullReq.defaultValue);
        } else {
          reject(
            new Error(
              `Interaction request ${requestId} timed out after ${fullReq.timeoutMs}ms`,
            ),
          );
        }
        this.emit("request:timeout", fullReq);
      }, fullReq.timeoutMs);

      this._pendingRequests.set(requestId, {
        req: fullReq,
        resolve,
        reject,
        timer,
      });
      try {
        this._runtimeProducer?.publish(
          { type: "interaction_request", request: fullReq },
          { origin: "agent-ipc", id: `interaction:${requestId}` },
        );
      } catch (error) {
        // Durable publication is fail-closed for configured runtime mode: do
        // not leave a request that cannot be recovered after a crash.
        this._pendingRequests.delete(requestId);
        clearTimeout(timer);
        reject(error);
        return;
      }
      this.emit("request", fullReq);
    });
  }

  /**
   * Parent/UI calls this to respond to a pending request
   * @param {string} requestId
   * @param {any} response
   */
  respond(requestId, response) {
    const entry = this._pendingRequests.get(requestId);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this._pendingRequests.delete(requestId);
    entry.resolve(response);
    try {
      const id = `interaction:${requestId}`;
      this._runtimeProducer?.store.acknowledgeInbox(id, { response });
    } catch {}
    this.emit("request:resolved", { requestId, response });
    return true;
  }

  /**
   * Reject/cancel a pending request
   * @param {string} requestId
   * @param {Error} [err]
   */
  cancel(requestId, err) {
    const entry = this._pendingRequests.get(requestId);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this._pendingRequests.delete(requestId);
    entry.reject(err || new Error("Interaction cancelled by user"));
    this.emit("request:cancelled", { requestId });
    return true;
  }

  /** Get pending interaction requests for UI */
  getPendingRequests() {
    return Array.from(this._pendingRequests.values()).map((e) => e.req);
  }

  /** Number of pending requests */
  get pendingCount() {
    return this._pendingRequests.size;
  }

  _activeAgentCount() {
    return new Set([
      ...this._agentResolvers.keys(),
      ...this._childTransports.keys(),
    ]).size;
  }

  flowControlStatus() {
    return {
      limits: { ...this.limits },
      activeAgents: this._activeAgentCount(),
      registeredAgents: this._agentResolvers.size,
      pendingInteractions: this._pendingRequests.size,
      pendingAgentRequests: this._pendingAgentRequests.size,
      childTransports: Array.from(this._childTransports.entries()).map(
        ([agentId, transport]) => ({ agentId, ...transport.status() }),
      ),
    };
  }

  /**
   * Spawn a child agent process with standardized JSON-RPC over stdio protocol
   * Aligned with Claude Code sub-agent spawn specification
   * @param {string} command - Agent executable/script path
   * @param {string[]} args - Command arguments
   * @param {object} options - Spawn options
   * @returns {Promise<{process: ChildProcess, agentId: string}>}
   */
  async spawnAgentProcess(command, args = [], options = {}) {
    const agentId = options.agentId || crypto.randomUUID();
    if (
      this._childTransports.has(agentId) ||
      this._agentResolvers.has(agentId)
    ) {
      throw new Error(`Agent ${agentId} is already registered or starting`);
    }
    if (this._activeAgentCount() >= this.limits.maxAgents) {
      throw overloadError(
        "active_agents",
        this.limits.maxAgents,
        this.limits.overloadRetryAfterMs,
      );
    }
    const heartbeatMs = boundedTimeout(
      options.heartbeatMs,
      this.limits.agentHeartbeatMs,
      this.limits.maxAgentHeartbeatMs,
    );
    const initTimeoutMs = boundedTimeout(
      options.initTimeoutMs,
      this.limits.agentInitTimeoutMs,
      this.limits.maxAgentInitTimeoutMs,
    );

    return new Promise((resolve, reject) => {
      const spawnOptions = options.spawnOptions || {};
      const child = _deps.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CHAINLESSCHAIN_AGENT_ID: agentId,
          CHAINLESSCHAIN_AGENT_MODE: "subagent",
          CHAINLESSCHAIN_IPC_PROTOCOL: "jsonrpc-stdio-v1",
          ...options.env,
        },
        ...spawnOptions,
        origin: spawnOptions.origin || "agent-ipc:subagent",
        policy: spawnOptions.policy || "allow",
        scope: spawnOptions.scope || "agent-ipc",
        shell: spawnOptions.shell === true,
      });

      let buffer = Buffer.alloc(0);
      let initialized = false;
      let heartbeatTimer = null;
      let initTimer = null;
      let protocolFailed = false;
      let writer;
      let stderrDrainListener = null;

      const clearStderrDrainListener = () => {
        if (!stderrDrainListener) return;
        process.stderr.off("drain", stderrDrainListener);
        stderrDrainListener = null;
      };

      const terminateForProtocolError = (error, details = {}) => {
        if (protocolFailed) return;
        protocolFailed = true;
        buffer = Buffer.alloc(0);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (initTimer) clearTimeout(initTimer);
        clearStderrDrainListener();
        writer?.close();
        this._childTransports.delete(agentId);
        if (this.isAgentRegistered(agentId)) this.unregisterAgent(agentId);
        this.emit("protocol:error", { agentId, error, ...details });
        if (!initialized) reject(error);
        child.kill();
      };

      writer = createBoundedStdinWriter({
        child,
        agentId,
        limits: this.limits,
        onOverload: (error) => terminateForProtocolError(error),
      });
      this._childTransports.set(agentId, writer);

      const handleLine = (lineBuffer) => {
        if (protocolFailed || lineBuffer.length === 0) return;
        const line = lineBuffer.toString("utf8");
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          this._handleIncomingMessage(agentId, msg, child, writer);
          if (
            msg.jsonrpc === "2.0" &&
            msg.method === "initialize" &&
            Object.prototype.hasOwnProperty.call(msg, "id") &&
            !initialized
          ) {
            this.registerAgent(agentId, (outMsg) => writer.write(outMsg));
            writer.write({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                protocolVersion: "1.0",
                agentId,
                capabilities: { interaction: true, tools: true },
              },
            });
            initialized = true;
            if (initTimer) clearTimeout(initTimer);
            heartbeatTimer = setInterval(() => {
              if (child.exitCode !== null) {
                clearInterval(heartbeatTimer);
                return;
              }
              try {
                writer.write({ jsonrpc: "2.0", method: "heartbeat" });
              } catch {
                clearInterval(heartbeatTimer);
              }
            }, heartbeatMs);
            resolve({ process: child, agentId });
          }
        } catch (error) {
          if (error?.code === "OVERLOADED") {
            terminateForProtocolError(error);
            return;
          }
          this.emit("protocol:error", {
            agentId,
            error,
            raw: line.slice(0, 4096),
          });
        }
      };

      // Handle stdout: line-delimited JSON-RPC
      child.stdout.on("data", (rawChunk) => {
        if (protocolFailed) return;
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk);
        let offset = 0;
        while (offset < chunk.length && !protocolFailed) {
          const newline = chunk.indexOf(0x0a, offset);
          if (newline === -1) {
            const tail = chunk.subarray(offset);
            const nextBytes = buffer.length + tail.length;
            if (nextBytes > this.limits.maxStdoutLineBytes) {
              terminateForProtocolError(
                overloadError(
                  "stdout_line_bytes",
                  this.limits.maxStdoutLineBytes,
                  this.limits.overloadRetryAfterMs,
                ),
                { observedBytes: nextBytes },
              );
              return;
            }
            buffer =
              buffer.length === 0
                ? Buffer.from(tail)
                : Buffer.concat([buffer, tail], nextBytes);
            return;
          }

          const segment = chunk.subarray(offset, newline);
          const lineBytes = buffer.length + segment.length;
          if (lineBytes > this.limits.maxStdoutLineBytes) {
            terminateForProtocolError(
              overloadError(
                "stdout_line_bytes",
                this.limits.maxStdoutLineBytes,
                this.limits.overloadRetryAfterMs,
              ),
              { observedBytes: lineBytes },
            );
            return;
          }
          const lineBuffer =
            buffer.length === 0
              ? segment
              : Buffer.concat([buffer, segment], lineBytes);
          buffer = Buffer.alloc(0);
          handleLine(lineBuffer);
          offset = newline + 1;
        }
      });
      child.stdout.on("error", (error) => {
        terminateForProtocolError(error);
      });

      // Always consume stderr so a verbose child cannot deadlock on a full OS
      // pipe before its host attaches diagnostics. Each emitted diagnostic is
      // independently bounded; stderr is never interpreted as protocol data.
      child.stderr?.on?.("data", (rawChunk) => {
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk);
        const retainedBytes = Math.min(
          chunk.length,
          this.limits.maxStderrChunkBytes,
        );
        const data = chunk.subarray(0, retainedBytes).toString("utf8");
        this.emit("agent:stderr", {
          agentId,
          data,
          observedBytes: chunk.length,
          truncated: retainedBytes !== chunk.length,
        });
        if (options.captureStderr !== false) {
          const accepted = process.stderr.write(`[agent:${agentId}] ${data}`);
          if (!accepted && !stderrDrainListener) {
            child.stderr.pause?.();
            stderrDrainListener = () => {
              stderrDrainListener = null;
              if (child.exitCode === null) child.stderr.resume?.();
            };
            process.stderr.once("drain", stderrDrainListener);
          }
        }
      });
      child.stderr?.on?.("error", (error) => {
        this.emit("agent:stderr-error", { agentId, error });
      });

      child.on("error", (err) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (initTimer) clearTimeout(initTimer);
        clearStderrDrainListener();
        protocolFailed = true;
        buffer = Buffer.alloc(0);
        if (this.isAgentRegistered(agentId)) {
          this.unregisterAgent(agentId);
        } else {
          writer.close();
          this._childTransports.delete(agentId);
        }
        if (!initialized) reject(err);
        this.emit("agent:error", { agentId, error: err });
      });

      child.on("exit", (code, signal) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (initTimer) clearTimeout(initTimer);
        clearStderrDrainListener();
        if (!initialized && !protocolFailed) {
          protocolFailed = true;
          reject(
            new Error(
              `Agent ${agentId} exited before initialization (code=${code}, signal=${signal ?? "none"})`,
            ),
          );
        }
        this.unregisterAgent(agentId);
        this.emit("agent:exit", { agentId, code, signal });
      });

      // Timeout for initialization
      initTimer = setTimeout(() => {
        if (!initialized) {
          terminateForProtocolError(
            new Error(`Agent ${agentId} initialization timed out`),
          );
        }
      }, initTimeoutMs);
    });
  }

  /**
   * Handle incoming JSON-RPC message from child agent
   * @private
   */
  _handleIncomingMessage(agentId, msg, child, writer = null) {
    if (!msg.jsonrpc || msg.jsonrpc !== "2.0") {
      this.emit("protocol:warning", {
        agentId,
        msg,
        reason: "missing jsonrpc version",
      });
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
    const send = (message) => {
      if (writer) return writer.write(message);
      return child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const safeReply = (message) => {
      try {
        return send(message);
      } catch (error) {
        if (!writer) {
          this.emit("protocol:error", { agentId, error });
        }
        return false;
      }
    };

    // Handle requests (method + id)
    if (msg.method && hasId) {
      if (msg.method === "interaction_request") {
        this.requestInteraction(agentId, msg.params)
          .then((result) => {
            safeReply({ jsonrpc: "2.0", id: msg.id, result });
          })
          .catch((err) => {
            safeReply({
              jsonrpc: "2.0",
              id: msg.id,
              error: {
                code: err.code === "OVERLOADED" ? -32001 : -32000,
                message: err.message,
                ...(err.data ? { data: err.data } : {}),
              },
            });
          });
      } else if (msg.method === "log") {
        this.emit("agent:log", { agentId, params: msg.params });
        // Acknowledge log
        send({ jsonrpc: "2.0", id: msg.id, result: true });
      } else {
        this.emit("agent:request", { agentId, msg });
      }
    }
    // Handle notifications (method, no id)
    else if (msg.method && !hasId) {
      if (msg.method === "heartbeat") {
        this.emit("agent:heartbeat", { agentId });
      } else if (msg.method === "progress") {
        this.emit("agent:progress", { agentId, params: msg.params });
      } else {
        this.emit("agent:notification", {
          agentId,
          method: msg.method,
          params: msg.params,
        });
      }
    }
    // Handle responses (id + result/error)
    else if (hasId) {
      const pending = this._pendingAgentRequests.get(msg.id);
      if (pending && pending.agentId === agentId) {
        clearTimeout(pending.timer);
        this._pendingAgentRequests.delete(msg.id);
        if (msg.error) {
          const error = new Error(msg.error.message);
          error.code = msg.error.code;
          error.data = msg.error.data;
          pending.reject(error);
        } else {
          pending.resolve(msg.result);
        }
      }
      this.emit("agent:response", { agentId, msg });
    }
  }

  /**
   * Send a JSON-RPC request to a spawned agent via stdio
   * @param {string} agentId
   * @param {string} method
   * @param {any} params
   * @param {number} [timeoutMs=30000]
   * @returns {Promise<any>}
   */
  sendRequest(agentId, method, params = {}, timeoutMs = undefined) {
    const sendToWorker = this._agentResolvers.get(agentId);
    if (!sendToWorker) {
      return Promise.reject(new Error(`Agent ${agentId} not registered`));
    }
    if (
      this._pendingAgentRequests.size >= this.limits.maxPendingAgentRequests
    ) {
      return Promise.reject(
        overloadError(
          "pending_agent_requests",
          this.limits.maxPendingAgentRequests,
          this.limits.overloadRetryAfterMs,
        ),
      );
    }
    let pendingForAgent = 0;
    for (const entry of this._pendingAgentRequests.values()) {
      if (entry.agentId === agentId) pendingForAgent += 1;
    }
    if (pendingForAgent >= this.limits.maxPendingAgentRequestsPerAgent) {
      return Promise.reject(
        overloadError(
          "pending_agent_requests_per_agent",
          this.limits.maxPendingAgentRequestsPerAgent,
          this.limits.overloadRetryAfterMs,
        ),
      );
    }

    let effectiveTimeoutMs;
    try {
      effectiveTimeoutMs = boundedTimeout(
        timeoutMs,
        this.limits.agentRequestTimeoutMs,
        this.limits.maxAgentRequestTimeoutMs,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingAgentRequests.delete(id);
        reject(new Error(`Request ${method} to agent ${agentId} timed out`));
      }, effectiveTimeoutMs);

      this._pendingAgentRequests.set(id, {
        agentId,
        method,
        resolve,
        reject,
        timer,
      });
      try {
        const accepted = sendToWorker({
          jsonrpc: "2.0",
          id,
          method,
          params,
        });
        if (accepted === false) {
          throw overloadError(
            "agent_transport",
            1,
            this.limits.overloadRetryAfterMs,
          );
        }
      } catch (error) {
        clearTimeout(timer);
        this._pendingAgentRequests.delete(id);
        reject(error);
      }
    });
  }
}

// Singleton
const ipcBus = new AgentIPCBus(
  process.env.CC_EVENT_RUNTIME_DURABLE === "1"
    ? { runtimeStore: new EventRuntimeStore() }
    : {},
);
export default ipcBus;
export { AgentIPCBus };
