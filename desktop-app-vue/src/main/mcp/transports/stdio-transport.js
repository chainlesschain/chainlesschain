/**
 * Stdio Transport for MCP
 *
 * Provides stdio-based communication with MCP servers.
 * Handles process lifecycle, message serialization, and error recovery.
 *
 * @module StdioTransport
 */

const { spawn } = require("child_process");
const EventEmitter = require("events");
const readline = require("readline");

/**
 * @typedef {Object} TransportConfig
 * @property {string} command - Command to execute
 * @property {string[]} args - Command arguments
 * @property {Object} env - Environment variables
 * @property {string} cwd - Working directory
 * @property {number} timeout - Operation timeout in ms
 */

class StdioTransport extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      timeout: 30000,
      maxRestarts: 3,
      restartDelay: 1000,
      ...config,
    };

    this.process = null;
    this.rl = null;
    this.isConnected = false;
    this.restartCount = 0;
    this.pendingResponses = new Map(); // requestId -> {resolve, reject, timer}
    this.messageQueue = [];
    this.nextRequestId = 1;

    console.log("[StdioTransport] Initialized");
  }

  /**
   * Start the MCP server process
   * @param {TransportConfig} config - Transport configuration
   * @returns {Promise<void>}
   */
  async start(config = {}) {
    const finalConfig = { ...this.config, ...config };

    try {
      console.log(
        "[StdioTransport] Starting process:",
        finalConfig.command,
        finalConfig.args,
      );

      // Spawn the MCP server process
      this.process = spawn(finalConfig.command, finalConfig.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...finalConfig.env },
        cwd: finalConfig.cwd,
        shell: true, // Enable shell for Windows compatibility
      });

      // Set up readline for line-based message parsing
      this.rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      // Handle incoming messages
      this.rl.on("line", (line) => {
        this._handleMessage(line);
      });

      // Handle stderr (logs and errors)
      this.process.stderr.on("data", (data) => {
        const message = data.toString().trim();
        if (message) {
          console.log("[StdioTransport] Server stderr:", message);
          this.emit("server-log", { level: "error", message });
        }
      });

      // Handle process exit
      this.process.on("exit", (code, signal) => {
        console.log(
          `[StdioTransport] Process exited with code ${code}, signal ${signal}`,
        );
        this._handleProcessExit(code, signal);
      });

      // Handle process errors
      this.process.on("error", (error) => {
        console.error("[StdioTransport] Process error:", error);
        this.emit("error", error);
      });

      this.isConnected = true;
      this.emit("connected");

      console.log("[StdioTransport] Process started successfully");
    } catch (error) {
      console.error("[StdioTransport] Failed to start process:", error);
      throw error;
    }
  }

  /**
   * Send a message to the MCP server
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Response from server
   */
  async send(message) {
    if (!this.isConnected || !this.process) {
      throw new Error("Transport not connected");
    }

    // Assign request ID if not present
    if (!message.id && message.method) {
      message.id = this.nextRequestId++;
    }

    const requestId = message.id;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(
          new Error(
            `Request ${requestId} timed out after ${this.config.timeout}ms`,
          ),
        );
      }, this.config.timeout);

      // Store pending response handler
      this.pendingResponses.set(requestId, { resolve, reject, timer });

      // Send message
      try {
        const serialized = JSON.stringify(message) + "\n";
        this.process.stdin.write(serialized, "utf8", (error) => {
          if (error) {
            clearTimeout(timer);
            this.pendingResponses.delete(requestId);
            reject(new Error(`Failed to write to stdin: ${error.message}`));
          }
        });

        console.log(
          "[StdioTransport] Sent message:",
          message.method || "response",
          requestId,
        );
      } catch (error) {
        clearTimeout(timer);
        this.pendingResponses.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message from server
   * @private
   * @param {string} line - Raw JSON line
   */
  _handleMessage(line) {
    try {
      const message = JSON.parse(line);

      console.log(
        "[StdioTransport] Received message:",
        message.method || "response",
        message.id,
      );

      // Check if this is a response to a pending request
      if (message.id && this.pendingResponses.has(message.id)) {
        const { resolve, reject, timer } = this.pendingResponses.get(
          message.id,
        );
        clearTimeout(timer);
        this.pendingResponses.delete(message.id);

        if (message.error) {
          reject(new Error(message.error.message || "Unknown error"));
        } else {
          resolve(message.result);
        }
      }
      // Otherwise, it's a notification or request from server
      else if (message.method) {
        this.emit("notification", message);
      }
    } catch (error) {
      console.error("[StdioTransport] Failed to parse message:", line, error);
      this.emit("parse-error", { line, error });
    }
  }

  /**
   * Handle process exit
   * @private
   * @param {number} code - Exit code
   * @param {string} signal - Exit signal
   */
  _handleProcessExit(code, signal) {
    this.isConnected = false;

    // Reject all pending requests
    for (const [
      requestId,
      { reject, timer },
    ] of this.pendingResponses.entries()) {
      clearTimeout(timer);
      reject(new Error(`Process exited with code ${code}, signal ${signal}`));
    }
    this.pendingResponses.clear();

    this.emit("disconnected", { code, signal });

    // Attempt restart if enabled
    if (this.restartCount < this.config.maxRestarts && code !== 0) {
      this.restartCount++;
      console.log(
        `[StdioTransport] Attempting restart (${this.restartCount}/${this.config.maxRestarts})`,
      );

      setTimeout(() => {
        this.start(this.config).catch((error) => {
          console.error("[StdioTransport] Restart failed:", error);
        });
      }, this.config.restartDelay);
    } else {
      console.log("[StdioTransport] Max restarts reached or clean exit");
    }
  }

  /**
   * Stop the MCP server process
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.process) {
      return;
    }

    console.log("[StdioTransport] Stopping process");

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(
          "[StdioTransport] Process did not exit gracefully, forcing kill",
        );
        if (this.process) {
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      this.process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      if (this.process) {
        this.process.kill("SIGTERM");
      }
    }).finally(() => {
      this.isConnected = false;
      this.process = null;
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }
    });
  }

  /**
   * Check if transport is connected
   * @returns {boolean}
   */
  isReady() {
    return this.isConnected && this.process && !this.process.killed;
  }
}

module.exports = { StdioTransport };
