const { EventEmitter } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  ReadBuffer,
  serializeMessage,
} = require("@modelcontextprotocol/sdk/shared/stdio.js");

const PROCESS_BROKER_MODULE = path.resolve(
  __dirname,
  "../../../../../packages/cli/src/lib/process-execution-broker/index.js",
);
const MCP_STDIO_SANDBOX_POLICY = Object.freeze({
  requiredBoundaries: Object.freeze(["filesystem", "network"]),
});
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUED_WRITE_MESSAGES = 256;
const DEFAULT_MAX_QUEUED_WRITE_BYTES = 8 * 1024 * 1024;
const DEFAULT_WRITE_DRAIN_TIMEOUT_MS = 5000;

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function byteLength(value) {
  return Buffer.isBuffer(value)
    ? value.length
    : Buffer.byteLength(String(value), "utf8");
}

let processBrokerPromise = null;

function loadProcessBroker() {
  if (!processBrokerPromise) {
    processBrokerPromise = import(
      pathToFileURL(PROCESS_BROKER_MODULE).href
    ).then((module) => {
      const broker = module.executionBroker || module.default;
      if (!broker || typeof broker.spawn !== "function") {
        throw new Error("ProcessExecutionBroker exports are unavailable");
      }
      return broker;
    });
  }
  return processBrokerPromise;
}

class BrokeredStdioClientTransport extends EventEmitter {
  constructor(server, deps = {}) {
    super();
    this.server = server || {};
    this.loadBroker = deps.loadProcessBroker || loadProcessBroker;
    this.readBuffer = new ReadBuffer();
    this.process = null;
    this.limits = Object.freeze({
      maxFrameBytes: positiveInteger(
        this.server.maxFrameBytes,
        DEFAULT_MAX_FRAME_BYTES,
      ),
      maxQueuedWriteMessages: positiveInteger(
        this.server.maxQueuedWriteMessages,
        DEFAULT_MAX_QUEUED_WRITE_MESSAGES,
      ),
      maxQueuedWriteBytes: positiveInteger(
        this.server.maxQueuedWriteBytes,
        DEFAULT_MAX_QUEUED_WRITE_BYTES,
      ),
      writeDrainTimeoutMs: positiveInteger(
        this.server.writeDrainTimeoutMs,
        DEFAULT_WRITE_DRAIN_TIMEOUT_MS,
      ),
    });
    this._incompleteFrameBytes = 0;
    this._writeQueue = [];
    this._queuedWriteBytes = 0;
    this._writeActive = false;
    this._writeFailure = null;
  }

  async start() {
    if (this.process) {
      throw new Error("BrokeredStdioClientTransport is already started");
    }
    const broker = await this.loadBroker();
    const child = broker.spawn(this.server.command, this.server.args || [], {
      cwd: this.server.cwd,
      env: { ...(this.server.env || {}) },
      origin: `mcp:stdio:${this.server.serverName || "unknown"}`,
      scope: "mcp-server",
      policy: "allow",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      sandboxPolicy: MCP_STDIO_SANDBOX_POLICY,
    });
    this.process = child;
    this._writeFailure = null;

    child.stdout?.on("data", (chunk) => {
      try {
        this._accountIncomingFrames(chunk);
        this.readBuffer.append(chunk);
        this._processReadBuffer();
      } catch (error) {
        this.onerror?.(error);
        this._terminateForBackpressure(child, error);
      }
    });
    child.stdout?.on("error", (error) => this.onerror?.(error));
    child.stdin?.on("error", (error) => {
      this._failWriteQueue(error);
      this.onerror?.(error);
    });
    child.stderr?.on("data", (chunk) => this.emit("server-log", chunk));
    child.once("error", (error) => {
      this.onerror?.(error);
    });
    child.once("close", () => {
      if (this.process === child) this.process = null;
      this._failWriteQueue(new Error("MCP stdio transport closed"));
      this.onclose?.();
    });
  }

  _accountIncomingFrames(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    let newline;
    while ((newline = bytes.indexOf(0x0a, offset)) !== -1) {
      this._incompleteFrameBytes += newline - offset;
      if (this._incompleteFrameBytes > this.limits.maxFrameBytes) {
        const error = new Error("MCP stdio frame exceeds configured limit");
        error.code = "CC_MCP_STDIO_FRAME_TOO_LARGE";
        throw error;
      }
      this._incompleteFrameBytes = 0;
      offset = newline + 1;
    }
    this._incompleteFrameBytes += bytes.length - offset;
    if (this._incompleteFrameBytes > this.limits.maxFrameBytes) {
      const error = new Error("MCP stdio frame exceeds configured limit");
      error.code = "CC_MCP_STDIO_FRAME_TOO_LARGE";
      throw error;
    }
  }

  _processReadBuffer() {
    while (true) {
      const message = this.readBuffer.readMessage();
      if (message === null) return;
      this.onmessage?.(message);
    }
  }

  send(message) {
    if (!this.process?.stdin) {
      return Promise.reject(new Error("MCP stdio transport is not connected"));
    }
    const payload = serializeMessage(message);
    const bytes = byteLength(payload);
    if (bytes > this.limits.maxFrameBytes) {
      const error = new Error("MCP stdio frame exceeds configured limit");
      error.code = "CC_MCP_STDIO_FRAME_TOO_LARGE";
      return Promise.reject(error);
    }
    if (
      this._writeQueue.length >= this.limits.maxQueuedWriteMessages ||
      this._queuedWriteBytes + bytes > this.limits.maxQueuedWriteBytes
    ) {
      const error = new Error("MCP stdio output queue is overloaded");
      error.code = "OVERLOADED";
      error.retryAfterMs = 100;
      return Promise.reject(error);
    }
    if (this._writeFailure) {
      return Promise.reject(this._writeFailure);
    }
    return new Promise((resolve, reject) => {
      this._writeQueue.push({
        payload,
        bytes,
        resolve,
        reject,
        settled: false,
      });
      this._queuedWriteBytes += bytes;
      this._pumpWriteQueue();
    });
  }

  _pumpWriteQueue() {
    if (this._writeActive || this._writeQueue.length === 0) return;
    const child = this.process;
    if (!child?.stdin || this._writeFailure) {
      this._failWriteQueue(
        this._writeFailure || new Error("MCP stdio transport is not connected"),
      );
      return;
    }

    const entry = this._writeQueue[0];
    entry.stdin = child.stdin;
    this._writeActive = true;
    try {
      if (child.stdin.write(entry.payload)) {
        this._settleWrite(entry);
        return;
      }
    } catch (error) {
      this._failWriteQueue(error);
      return;
    }

    const timer = setTimeout(() => {
      const error = new Error("MCP stdio output remained backpressured");
      error.code = "CC_MCP_STDIO_SLOW_CONSUMER";
      this._failWriteQueue(error);
      this.onerror?.(error);
      this._terminateForBackpressure(child, error);
    }, this.limits.writeDrainTimeoutMs);
    timer.unref?.();
    entry.drainTimer = timer;
    entry.onDrain = () => this._settleWrite(entry);
    child.stdin.once("drain", entry.onDrain);
  }

  _settleWrite(entry) {
    if (entry.settled || this._writeQueue[0] !== entry) return;
    entry.settled = true;
    clearTimeout(entry.drainTimer);
    entry.stdin?.removeListener("drain", entry.onDrain);
    this._writeQueue.shift();
    this._queuedWriteBytes = Math.max(0, this._queuedWriteBytes - entry.bytes);
    this._writeActive = false;
    entry.resolve();
    this._pumpWriteQueue();
  }

  _failWriteQueue(error) {
    if (!this._writeFailure) this._writeFailure = error;
    const queue = this._writeQueue.splice(0);
    this._queuedWriteBytes = 0;
    this._writeActive = false;
    for (const entry of queue) {
      if (entry.settled) continue;
      entry.settled = true;
      clearTimeout(entry.drainTimer);
      entry.stdin?.removeListener("drain", entry.onDrain);
      entry.reject(error);
    }
  }

  _terminateForBackpressure(child, error) {
    if (this.process !== child) return;
    this._failWriteQueue(error);
    try {
      child.stdin?.destroy(error);
    } catch {
      // Continue with broker-owned tree termination.
    }
    if (child.exitCode == null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The Broker owns final process-tree settlement.
      }
    }
  }

  flowControlStatus() {
    return {
      limits: this.limits,
      incompleteFrameBytes: this._incompleteFrameBytes,
      queuedWriteMessages: this._writeQueue.length,
      queuedWriteBytes: this._queuedWriteBytes,
      writeFailure: this._writeFailure?.code || null,
    };
  }

  async close() {
    const child = this.process;
    this.readBuffer.clear();
    this._incompleteFrameBytes = 0;
    this._failWriteQueue(new Error("MCP stdio transport closed"));
    this.process = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // Continue with process-tree termination.
    }
    if (child.exitCode == null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The Broker owns final process-tree settlement.
      }
    }
  }

  get pid() {
    return this.process?.pid ?? null;
  }
}

module.exports = {
  BrokeredStdioClientTransport,
  MCP_STDIO_SANDBOX_POLICY,
  loadProcessBroker,
};
