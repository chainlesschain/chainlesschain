/**
 * Stdio Transport for MCP
 *
 * Provides stdio-based communication with MCP servers.
 * Handles process lifecycle, message serialization, and error recovery.
 * Supports cross-platform operation (Windows, macOS, Linux).
 *
 * @module StdioTransport
 */

const { logger } = require("../../utils/logger.js");
const { spawn } = require("child_process");
const EventEmitter = require("events");
const readline = require("readline");
const path = require("path");
const os = require("os");

/**
 * Platform detection
 */
const PLATFORM = {
  isWindows: process.platform === "win32",
  isMac: process.platform === "darwin",
  isLinux: process.platform === "linux",
};

/**
 * Get platform-specific spawn options
 * @param {Object} config - Configuration object
 * @returns {Object} Spawn options
 */
function getPlatformSpawnOptions(config) {
  const baseOptions = {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...config.env },
    cwd: config.cwd,
  };

  if (PLATFORM.isWindows) {
    // On Windows, use shell for better command resolution
    // and set proper environment for npm/npx
    return {
      ...baseOptions,
      shell: true,
      windowsHide: true, // Hide the console window
    };
  } else {
    // On Unix-like systems, use shell only if command contains special characters
    const needsShell = /[|&;`$(){}[\]<>*?!#~]/.test(config.command);
    return {
      ...baseOptions,
      shell: needsShell,
    };
  }
}

/**
 * Normalize a path for the current platform
 * @param {string} inputPath - Input path
 * @returns {string} Normalized path
 */
function normalizePath(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  // Normalize the path separators for the current platform
  let normalized = path.normalize(inputPath);

  // On Windows, also handle forward slashes in paths
  if (PLATFORM.isWindows) {
    normalized = normalized.replace(/\//g, path.sep);
  }

  return normalized;
}

/**
 * Get the appropriate kill signal for the platform
 * @returns {string} Kill signal
 */
function getKillSignal() {
  // Windows doesn't support SIGTERM the same way
  return PLATFORM.isWindows ? "SIGKILL" : "SIGTERM";
}

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

    logger.info("[StdioTransport] Initialized");
  }

  /**
   * Start the MCP server process
   * @param {TransportConfig} config - Transport configuration
   * @returns {Promise<void>}
   */
  async start(config = {}) {
    const finalConfig = { ...this.config, ...config };

    try {
      logger.info(
        `[StdioTransport] Starting process on ${process.platform}:`,
        finalConfig.command,
        finalConfig.args,
      );

      // Normalize working directory path
      if (finalConfig.cwd) {
        finalConfig.cwd = normalizePath(finalConfig.cwd);
      }

      // Normalize path arguments
      const normalizedArgs = (finalConfig.args || []).map((arg) => {
        // Check if this argument looks like a path
        if (arg && (arg.includes("/") || arg.includes("\\"))) {
          return normalizePath(arg);
        }
        return arg;
      });

      // Get platform-specific spawn options
      const spawnOptions = getPlatformSpawnOptions(finalConfig);

      // Spawn the MCP server process
      this.process = spawn(finalConfig.command, normalizedArgs, spawnOptions);

      logger.info(
        `[StdioTransport] Process spawned with PID: ${this.process.pid}`,
      );

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
          logger.info("[StdioTransport] Server stderr:", message);
          this.emit("server-log", { level: "error", message });
        }
      });

      // Handle process exit
      this.process.on("exit", (code, signal) => {
        logger.info(
          `[StdioTransport] Process exited with code ${code}, signal ${signal}`,
        );
        this._handleProcessExit(code, signal);
      });

      // Handle process errors
      this.process.on("error", (error) => {
        logger.error("[StdioTransport] Process error:", error);
        this.emit("error", error);
      });

      this.isConnected = true;
      this.emit("connected");

      logger.info("[StdioTransport] Process started successfully");
    } catch (error) {
      logger.error("[StdioTransport] Failed to start process:", error);
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

        logger.info(
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

      logger.info(
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
      logger.error("[StdioTransport] Failed to parse message:", line, error);
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
      logger.info(
        `[StdioTransport] Attempting restart (${this.restartCount}/${this.config.maxRestarts})`,
      );

      setTimeout(() => {
        this.start(this.config).catch((error) => {
          logger.error("[StdioTransport] Restart failed:", error);
        });
      }, this.config.restartDelay);
    } else {
      logger.info("[StdioTransport] Max restarts reached or clean exit");
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

    const pid = this.process.pid;
    logger.info(`[StdioTransport] Stopping process (PID: ${pid})`);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn(
          "[StdioTransport] Process did not exit gracefully, forcing kill",
        );
        if (this.process) {
          this._forceKill();
        }
        resolve();
      }, 5000);

      this.process.once("exit", () => {
        clearTimeout(timer);
        logger.info(`[StdioTransport] Process exited cleanly (PID: ${pid})`);
        resolve();
      });

      // Send graceful shutdown signal
      if (this.process) {
        const signal = getKillSignal();
        logger.info(`[StdioTransport] Sending ${signal} to process`);

        if (PLATFORM.isWindows) {
          // On Windows, use taskkill for cleaner shutdown
          this._windowsKill();
        } else {
          this.process.kill(signal);
        }
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
   * Windows-specific process termination
   * @private
   */
  _windowsKill() {
    if (!this.process || !this.process.pid) {
      return;
    }

    try {
      // On Windows, sending SIGTERM doesn't work well
      // Instead, try to close stdin to signal shutdown
      if (this.process.stdin && !this.process.stdin.destroyed) {
        this.process.stdin.end();
      }

      // Give the process a moment to exit gracefully
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill();
        }
      }, 1000);
    } catch (error) {
      logger.warn("[StdioTransport] Windows kill warning:", error.message);
      this._forceKill();
    }
  }

  /**
   * Force kill the process
   * @private
   */
  _forceKill() {
    if (!this.process) {
      return;
    }

    try {
      if (PLATFORM.isWindows) {
        // Use taskkill on Windows for tree kill
        // Use spawnSync with array arguments to avoid command injection
        const { spawnSync } = require("child_process");
        const pid = String(this.process.pid);
        try {
          spawnSync("taskkill", ["/PID", pid, "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } catch (e) {
          // Process may already be dead
        }
      } else {
        this.process.kill("SIGKILL");
      }
    } catch (error) {
      logger.warn("[StdioTransport] Force kill warning:", error.message);
    }
  }

  /**
   * Check if transport is connected
   * @returns {boolean}
   */
  isReady() {
    return this.isConnected && this.process && !this.process.killed;
  }
}

module.exports = {
  StdioTransport,
  PLATFORM,
  normalizePath,
  getPlatformSpawnOptions,
};
