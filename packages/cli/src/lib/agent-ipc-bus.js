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
  constructor({ runtimeStore = null } = {}) {
    super();
    this._runtimeProducer = runtimeStore
      ? new EventRuntimeProducer({ store: runtimeStore, emitter: this })
      : null;
    /** @type {Map<string, {req: InteractionRequest, resolve: Function, reject: Function, timer?: NodeJS.Timeout}>} */
    this._pendingRequests = new Map();
    /** @type {Map<string, Function>} resolvers by agentId */
    this._agentResolvers = new Map();
  }

  /**
   * Register an agent worker's send function so bus can route responses back
   * @param {string} agentId
   * @param {(msg: any) => void} sendToWorker
   */
  registerAgent(agentId, sendToWorker) {
    this._agentResolvers.set(agentId, sendToWorker);
    this.emit("agent:registered", { agentId });
  }

  unregisterAgent(agentId) {
    this._agentResolvers.delete(agentId);
    // Reject all pending for this agent
    for (const [reqId, entry] of this._pendingRequests.entries()) {
      if (entry.req.agentId === agentId) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(`Agent ${agentId} disconnected while waiting for response`));
        this._pendingRequests.delete(reqId);
      }
    }
    this.emit("agent:unregistered", { agentId });
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
  requestInteraction(agentId, req) {
    const requestId = crypto.randomUUID();
    const fullReq = {
      requestId,
      agentId,
      sessionId: req.sessionId,
      turnId: req.turnId,
      type: req.type || "question",
      prompt: req.prompt,
      choices: req.choices,
      defaultValue: req.defaultValue,
      timeoutMs: req.timeoutMs || 300000, // 5min default
      metadata: req.metadata || {},
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        if (fullReq.defaultValue !== undefined) {
          resolve(fullReq.defaultValue);
        } else {
          reject(new Error(`Interaction request ${requestId} timed out after ${fullReq.timeoutMs}ms`));
        }
        this.emit("request:timeout", fullReq);
      }, fullReq.timeoutMs);

      this._pendingRequests.set(requestId, { req: fullReq, resolve, reject, timer });
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
    return Array.from(this._pendingRequests.values()).map(e => e.req);
  }

  /** Number of pending requests */
  get pendingCount() {
    return this._pendingRequests.size;
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
    const heartbeatMs = options.heartbeatMs || 30000;

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

      let buffer = "";
      let initialized = false;
      let heartbeatTimer = null;

      // Handle stdout: line-delimited JSON-RPC
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this._handleIncomingMessage(agentId, msg, child);
            if (msg.method === "initialize" && !initialized) {
              initialized = true;
              this.registerAgent(agentId, (outMsg) => {
                child.stdin.write(JSON.stringify(outMsg) + "\n");
              });
              // Send initialize response
              child.stdin.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  protocolVersion: "1.0",
                  agentId,
                  capabilities: { interaction: true, tools: true },
                },
              }) + "\n");
              // Setup heartbeat
              heartbeatTimer = setInterval(() => {
                if (child.exitCode !== null) {
                  clearInterval(heartbeatTimer);
                  return;
                }
                child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "heartbeat" }) + "\n");
              }, heartbeatMs);
              resolve({ process: child, agentId });
            }
          } catch (e) {
            this.emit("protocol:error", { agentId, error: e, raw: line });
          }
        }
      });

      // Handle stderr: pass through to logger
      child.stderr.on("data", (chunk) => {
        this.emit("agent:stderr", { agentId, data: chunk.toString("utf8") });
        if (options.captureStderr !== false) {
          process.stderr.write(`[agent:${agentId}] ${chunk}`);
        }
      });

      child.on("error", (err) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (!initialized) reject(err);
        this.emit("agent:error", { agentId, error: err });
      });

      child.on("exit", (code, signal) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        this.unregisterAgent(agentId);
        this.emit("agent:exit", { agentId, code, signal });
      });

      // Timeout for initialization
      setTimeout(() => {
        if (!initialized) {
          child.kill();
          reject(new Error(`Agent ${agentId} initialization timed out`));
        }
      }, options.initTimeoutMs || 10000);
    });
  }

  /**
   * Handle incoming JSON-RPC message from child agent
   * @private
   */
  _handleIncomingMessage(agentId, msg, child) {
    if (!msg.jsonrpc || msg.jsonrpc !== "2.0") {
      this.emit("protocol:warning", { agentId, msg, reason: "missing jsonrpc version" });
      return;
    }

    // Handle requests (method + id)
    if (msg.method && msg.id) {
      if (msg.method === "interaction_request") {
        this.requestInteraction(agentId, msg.params).then((result) => {
          child.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result,
          }) + "\n");
        }).catch((err) => {
          child.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32000, message: err.message },
          }) + "\n");
        });
      } else if (msg.method === "log") {
        this.emit("agent:log", { agentId, params: msg.params });
        // Acknowledge log
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: true }) + "\n");
      } else {
        this.emit("agent:request", { agentId, msg });
      }
    }
    // Handle notifications (method, no id)
    else if (msg.method && !msg.id) {
      if (msg.method === "heartbeat") {
        this.emit("agent:heartbeat", { agentId });
      } else if (msg.method === "progress") {
        this.emit("agent:progress", { agentId, params: msg.params });
      } else {
        this.emit("agent:notification", { agentId, method: msg.method, params: msg.params });
      }
    }
    // Handle responses (id + result/error)
    else if (msg.id) {
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
  sendRequest(agentId, method, params = {}, timeoutMs = 30000) {
    const sendToWorker = this._agentResolvers.get(agentId);
    if (!sendToWorker) {
      return Promise.reject(new Error(`Agent ${agentId} not registered`));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeAllListeners(`response:${id}`);
        reject(new Error(`Request ${method} to agent ${agentId} timed out`));
      }, timeoutMs);

      const onResponse = (respMsg) => {
        if (respMsg.msg.id === id) {
          clearTimeout(timer);
          this.off("agent:response", onResponse);
          if (respMsg.msg.error) {
            reject(new Error(respMsg.msg.error.message));
          } else {
            resolve(respMsg.msg.result);
          }
        }
      };
      this.on("agent:response", onResponse);

      sendToWorker({ jsonrpc: "2.0", id, method, params });
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
