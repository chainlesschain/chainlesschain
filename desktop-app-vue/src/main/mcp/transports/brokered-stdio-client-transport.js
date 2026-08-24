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

    child.stdout?.on("data", (chunk) => {
      try {
        this.readBuffer.append(chunk);
        this._processReadBuffer();
      } catch (error) {
        this.onerror?.(error);
      }
    });
    child.stdout?.on("error", (error) => this.onerror?.(error));
    child.stdin?.on("error", (error) => this.onerror?.(error));
    child.stderr?.on("data", (chunk) => this.emit("server-log", chunk));
    child.once("error", (error) => {
      this.onerror?.(error);
    });
    child.once("close", () => {
      if (this.process === child) this.process = null;
      this.onclose?.();
    });
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
    return new Promise((resolve, reject) => {
      try {
        if (this.process.stdin.write(payload)) {
          resolve();
        } else {
          this.process.stdin.once("drain", resolve);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async close() {
    const child = this.process;
    this.process = null;
    this.readBuffer.clear();
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
