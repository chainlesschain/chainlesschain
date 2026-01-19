/**
 * HTTP+SSE Transport for MCP
 *
 * Provides HTTP+Server-Sent Events based communication with MCP servers.
 * More suitable for remote servers and web-based MCP services.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat keep-alive mechanism
 * - Health check monitoring
 * - Authentication token refresh
 * - Connection state management
 * - Circuit breaker pattern for fault tolerance
 *
 * @module HttpSseTransport
 */

const { logger, createLogger } = require('../../utils/logger.js');
const EventEmitter = require("events");
const https = require("https");
const http = require("http");

/**
 * @typedef {Object} HttpSseTransportConfig
 * @property {string} baseURL - Base URL of the MCP server
 * @property {string} apiKey - Optional API key for authentication
 * @property {Object} headers - Additional HTTP headers
 * @property {number} timeout - Request timeout in ms
 * @property {boolean} useSSL - Use HTTPS
 * @property {number} maxRetries - Maximum retry attempts
 * @property {number} retryDelay - Initial retry delay in ms
 * @property {number} heartbeatInterval - Heartbeat interval in ms (default: 30000)
 * @property {number} healthCheckInterval - Health check interval in ms (default: 60000)
 * @property {boolean} enableHeartbeat - Enable heartbeat mechanism (default: true)
 * @property {boolean} enableHealthCheck - Enable health check (default: true)
 * @property {Function} onTokenRefresh - Callback for token refresh
 */

/**
 * Connection states
 */
const ConnectionState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  ERROR: "error",
  CIRCUIT_OPEN: "circuit_open",
};

/**
 * Circuit breaker states
 */
const CircuitState = {
  CLOSED: "closed", // Normal operation
  OPEN: "open", // Failing, reject requests
  HALF_OPEN: "half_open", // Testing if service recovered
};

class HttpSseTransport extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      baseURL: "http://localhost:3000",
      apiKey: null,
      headers: {},
      timeout: 30000,
      useSSL: false,
      maxRetries: 3,
      retryDelay: 1000,
      heartbeatInterval: 30000,
      healthCheckInterval: 60000,
      enableHeartbeat: true,
      enableHealthCheck: true,
      circuitBreakerThreshold: 5, // Open circuit after 5 consecutive failures
      circuitBreakerTimeout: 30000, // Try again after 30s
      onTokenRefresh: null,
      ...config,
    };

    // Connection state
    this.connectionState = ConnectionState.DISCONNECTED;
    this.isConnected = false;
    this.sseConnection = null;
    this.pendingResponses = new Map(); // requestId -> {resolve, reject, timer}
    this.nextRequestId = 1;
    this.retryCount = 0;

    // Heartbeat
    this.heartbeatTimer = null;
    this.lastHeartbeatResponse = null;
    this.missedHeartbeats = 0;

    // Health check
    this.healthCheckTimer = null;
    this.lastHealthCheck = null;
    this.healthCheckResults = [];

    // Circuit breaker
    this.circuitState = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
    this.circuitBreakerTimer = null;

    // Statistics
    this.stats = {
      connectionAttempts: 0,
      successfulConnections: 0,
      failedConnections: 0,
      requestsSent: 0,
      requestsSucceeded: 0,
      requestsFailed: 0,
      bytesReceived: 0,
      bytesSent: 0,
      lastError: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
    };

    logger.info(
      "[HttpSseTransport] Initialized with baseURL:",
      this.config.baseURL,
    );
  }

  /**
   * Start the HTTP+SSE connection
   * @returns {Promise<void>}
   */
  async start() {
    try {
      logger.info("[HttpSseTransport] Starting connection...");
      this.connectionState = ConnectionState.CONNECTING;
      this.stats.connectionAttempts++;

      // Check circuit breaker
      if (this.circuitState === CircuitState.OPEN) {
        const timeSinceOpen = Date.now() - this.circuitOpenedAt;
        if (timeSinceOpen < this.config.circuitBreakerTimeout) {
          throw new Error(
            `Circuit breaker open. Retry in ${Math.ceil((this.config.circuitBreakerTimeout - timeSinceOpen) / 1000)}s`,
          );
        }
        // Try half-open state
        this.circuitState = CircuitState.HALF_OPEN;
        logger.info(
          "[HttpSseTransport] Circuit breaker half-open, testing connection...",
        );
      }

      // Establish SSE connection for receiving messages
      await this._connectSSE();

      this.isConnected = true;
      this.connectionState = ConnectionState.CONNECTED;
      this.stats.successfulConnections++;
      this.stats.lastConnectedAt = new Date().toISOString();
      this.consecutiveFailures = 0;
      this.circuitState = CircuitState.CLOSED;

      // Start heartbeat if enabled
      if (this.config.enableHeartbeat) {
        this._startHeartbeat();
      }

      // Start health check if enabled
      if (this.config.enableHealthCheck) {
        this._startHealthCheck();
      }

      this.emit("connected");
      logger.info("[HttpSseTransport] Connection established");
    } catch (error) {
      logger.error("[HttpSseTransport] Failed to start:", error);
      this.connectionState = ConnectionState.ERROR;
      this.stats.failedConnections++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date().toISOString(),
      };
      this._handleConnectionFailure(error);
      throw error;
    }
  }

  /**
   * Establish SSE connection for server-to-client messages
   * @private
   */
  async _connectSSE() {
    return new Promise((resolve, reject) => {
      const url = new URL("/sse", this.config.baseURL);
      const protocol = this.config.useSSL ? https : http;

      const headers = {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...this.config.headers,
      };

      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }

      const req = protocol.get(url.toString(), { headers }, (res) => {
        if (res.statusCode !== 200) {
          reject(
            new Error(`SSE connection failed with status ${res.statusCode}`),
          );
          return;
        }

        logger.info("[HttpSseTransport] SSE connection established");

        let buffer = "";

        res.on("data", (chunk) => {
          buffer += chunk.toString();

          // Process complete SSE messages
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || ""; // Keep incomplete message in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.substring(6);
              try {
                const message = JSON.parse(data);
                this._handleMessage(message);
              } catch (error) {
                logger.error(
                  "[HttpSseTransport] Failed to parse SSE message:",
                  error,
                );
              }
            }
          }
        });

        res.on("error", (error) => {
          logger.error("[HttpSseTransport] SSE error:", error);
          this.emit("error", error);
          this._reconnectSSE();
        });

        res.on("end", () => {
          logger.info("[HttpSseTransport] SSE connection closed");
          this.isConnected = false;
          this.emit("disconnected");
          this._reconnectSSE();
        });

        this.sseConnection = res;
        resolve();
      });

      req.on("error", (error) => {
        logger.error("[HttpSseTransport] SSE request error:", error);
        reject(error);
      });

      req.setTimeout(this.config.timeout, () => {
        req.destroy();
        reject(new Error("SSE connection timeout"));
      });
    });
  }

  /**
   * Reconnect SSE with exponential backoff
   * @private
   */
  async _reconnectSSE() {
    if (this.retryCount >= this.config.maxRetries) {
      logger.error("[HttpSseTransport] Max retries reached, giving up");
      this.emit("error", new Error("Failed to reconnect after max retries"));
      return;
    }

    this.retryCount++;
    const delay = this.config.retryDelay * Math.pow(2, this.retryCount - 1);

    logger.info(
      `[HttpSseTransport] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.config.maxRetries})`,
    );

    setTimeout(async () => {
      try {
        await this._connectSSE();
        this.retryCount = 0; // Reset on successful connection
        this.isConnected = true;
        this.emit("reconnected");
      } catch (error) {
        logger.error("[HttpSseTransport] Reconnect failed:", error);
        this._reconnectSSE();
      }
    }, delay);
  }

  /**
   * Send a message to the MCP server via HTTP POST
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Response from server
   */
  async send(message) {
    // Check circuit breaker
    if (this.circuitState === CircuitState.OPEN) {
      const timeSinceOpen = Date.now() - this.circuitOpenedAt;
      if (timeSinceOpen < this.config.circuitBreakerTimeout) {
        const error = new Error(
          `Circuit breaker open. Retry in ${Math.ceil((this.config.circuitBreakerTimeout - timeSinceOpen) / 1000)}s`,
        );
        error.code = "CIRCUIT_OPEN";
        throw error;
      }
      // Try half-open state
      this.circuitState = CircuitState.HALF_OPEN;
    }

    if (!this.isConnected) {
      throw new Error("Transport not connected");
    }

    // Assign request ID if not present
    if (!message.id && message.method) {
      message.id = this.nextRequestId++;
    }

    const requestId = message.id;
    this.stats.requestsSent++;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        this.stats.requestsFailed++;
        this._handleConnectionFailure(new Error("Request timeout"));
        reject(
          new Error(
            `Request ${requestId} timed out after ${this.config.timeout}ms`,
          ),
        );
      }, this.config.timeout);

      // Store pending response handler with success/failure tracking
      this.pendingResponses.set(requestId, {
        resolve: (result) => {
          this.stats.requestsSucceeded++;
          this._resetCircuitBreaker();
          resolve(result);
        },
        reject: (error) => {
          this.stats.requestsFailed++;
          this._handleConnectionFailure(error);
          reject(error);
        },
        timer,
        startTime: Date.now(),
      });

      // Send HTTP POST request
      this._sendHttpRequest(message).catch((error) => {
        clearTimeout(timer);
        this.pendingResponses.delete(requestId);
        this.stats.requestsFailed++;
        this._handleConnectionFailure(error);
        reject(error);
      });

      logger.info(
        "[HttpSseTransport] Sent message:",
        message.method || "response",
        requestId,
      );
    });
  }

  /**
   * Send HTTP POST request
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<void>}
   */
  async _sendHttpRequest(message) {
    return new Promise((resolve, reject) => {
      const url = new URL("/rpc", this.config.baseURL);
      const protocol = this.config.useSSL ? https : http;

      const data = JSON.stringify(message);

      const headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...this.config.headers,
      };

      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }

      const options = {
        method: "POST",
        headers,
      };

      const req = protocol.request(url.toString(), options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk.toString();
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // For HTTP+SSE, the response comes via SSE, not HTTP response
            // So we just resolve the HTTP request successfully
            resolve();
          } else {
            reject(
              new Error(
                `HTTP request failed with status ${res.statusCode}: ${responseData}`,
              ),
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.setTimeout(this.config.timeout, () => {
        req.destroy();
        reject(new Error("HTTP request timeout"));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Handle incoming message from SSE
   * @private
   * @param {Object} message - JSON-RPC message
   */
  _handleMessage(message) {
    logger.info(
      "[HttpSseTransport] Received message:",
      message.method || "response",
      message.id,
    );

    // Check if this is a response to a pending request
    if (message.id && this.pendingResponses.has(message.id)) {
      const { resolve, reject, timer } = this.pendingResponses.get(message.id);
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
  }

  /**
   * Stop the HTTP+SSE connection
   * @returns {Promise<void>}
   */
  async stop() {
    logger.info("[HttpSseTransport] Stopping connection");

    // Stop heartbeat
    this._stopHeartbeat();

    // Stop health check
    this._stopHealthCheck();

    // Clear circuit breaker timer
    if (this.circuitBreakerTimer) {
      clearTimeout(this.circuitBreakerTimer);
      this.circuitBreakerTimer = null;
    }

    if (this.sseConnection) {
      this.sseConnection.destroy();
      this.sseConnection = null;
    }

    // Reject all pending requests
    for (const [
      requestId,
      { reject, timer },
    ] of this.pendingResponses.entries()) {
      clearTimeout(timer);
      reject(new Error("Transport stopped"));
    }
    this.pendingResponses.clear();

    this.isConnected = false;
    this.connectionState = ConnectionState.DISCONNECTED;
    this.stats.lastDisconnectedAt = new Date().toISOString();
    this.emit("disconnected");
  }

  // ===================================
  // Heartbeat Methods
  // ===================================

  /**
   * Start heartbeat mechanism
   * @private
   */
  _startHeartbeat() {
    this._stopHeartbeat(); // Clear any existing timer

    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this._sendHeartbeat();
        this.missedHeartbeats = 0;
        this.lastHeartbeatResponse = Date.now();
      } catch (error) {
        this.missedHeartbeats++;
        logger.warn(
          `[HttpSseTransport] Heartbeat failed (missed: ${this.missedHeartbeats}):`,
          error.message,
        );

        // If too many heartbeats missed, trigger reconnection
        if (this.missedHeartbeats >= 3) {
          logger.error(
            "[HttpSseTransport] Too many missed heartbeats, reconnecting...",
          );
          this._reconnectSSE();
        }
      }
    }, this.config.heartbeatInterval);

    logger.info(
      `[HttpSseTransport] Heartbeat started (interval: ${this.config.heartbeatInterval}ms)`,
    );
  }

  /**
   * Stop heartbeat mechanism
   * @private
   */
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send heartbeat ping
   * @private
   */
  async _sendHeartbeat() {
    const start = Date.now();
    await this.send({
      jsonrpc: "2.0",
      method: "ping",
      params: {},
    });
    const latency = Date.now() - start;
    this.emit("heartbeat", { latency, timestamp: Date.now() });
    return latency;
  }

  // ===================================
  // Health Check Methods
  // ===================================

  /**
   * Start health check mechanism
   * @private
   */
  _startHealthCheck() {
    this._stopHealthCheck(); // Clear any existing timer

    this.healthCheckTimer = setInterval(async () => {
      const health = await this.checkHealth();
      this.healthCheckResults.push(health);

      // Keep only last 10 results
      if (this.healthCheckResults.length > 10) {
        this.healthCheckResults.shift();
      }

      this.emit("health-check", health);
    }, this.config.healthCheckInterval);

    logger.info(
      `[HttpSseTransport] Health check started (interval: ${this.config.healthCheckInterval}ms)`,
    );
  }

  /**
   * Stop health check mechanism
   * @private
   */
  _stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Perform health check
   * @returns {Promise<Object>} Health check result
   */
  async checkHealth() {
    const health = {
      timestamp: new Date().toISOString(),
      connected: this.isConnected,
      connectionState: this.connectionState,
      circuitState: this.circuitState,
      latency: null,
      pendingRequests: this.pendingResponses.size,
      stats: { ...this.stats },
      error: null,
    };

    if (this.isConnected) {
      try {
        const start = Date.now();
        await this.ping();
        health.latency = Date.now() - start;
        health.healthy = true;
      } catch (error) {
        health.latency = null;
        health.healthy = false;
        health.error = error.message;
      }
    } else {
      health.healthy = false;
      health.error = "Not connected";
    }

    this.lastHealthCheck = health;
    return health;
  }

  /**
   * Get health status summary
   * @returns {Object}
   */
  getHealthStatus() {
    const avgLatency =
      this.healthCheckResults.length > 0
        ? this.healthCheckResults
            .filter((h) => h.latency !== null)
            .reduce((sum, h) => sum + h.latency, 0) /
          this.healthCheckResults.filter((h) => h.latency !== null).length
        : null;

    return {
      connected: this.isConnected,
      connectionState: this.connectionState,
      circuitState: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      lastHealthCheck: this.lastHealthCheck,
      averageLatency: avgLatency,
      recentHealthChecks: this.healthCheckResults.slice(-5),
      stats: { ...this.stats },
    };
  }

  // ===================================
  // Circuit Breaker Methods
  // ===================================

  /**
   * Handle connection failure for circuit breaker
   * @private
   */
  _handleConnectionFailure(error) {
    this.consecutiveFailures++;
    this.stats.lastError = {
      message: error.message,
      timestamp: new Date().toISOString(),
    };

    if (
      this.circuitState !== CircuitState.OPEN &&
      this.consecutiveFailures >= this.config.circuitBreakerThreshold
    ) {
      this._openCircuit();
    }
  }

  /**
   * Open the circuit breaker
   * @private
   */
  _openCircuit() {
    logger.warn(
      `[HttpSseTransport] Circuit breaker OPENED after ${this.consecutiveFailures} failures`,
    );
    this.circuitState = CircuitState.OPEN;
    this.circuitOpenedAt = Date.now();
    this.connectionState = ConnectionState.CIRCUIT_OPEN;

    this.emit("circuit-open", {
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.circuitOpenedAt,
      retryAfter: this.config.circuitBreakerTimeout,
    });

    // Schedule circuit breaker half-open check
    this.circuitBreakerTimer = setTimeout(() => {
      if (this.circuitState === CircuitState.OPEN) {
        logger.info(
          "[HttpSseTransport] Circuit breaker transitioning to half-open",
        );
        this.circuitState = CircuitState.HALF_OPEN;
        this.emit("circuit-half-open");
      }
    }, this.config.circuitBreakerTimeout);
  }

  /**
   * Reset circuit breaker after successful operation
   * @private
   */
  _resetCircuitBreaker() {
    if (this.circuitState !== CircuitState.CLOSED) {
      logger.info("[HttpSseTransport] Circuit breaker CLOSED");
      this.circuitState = CircuitState.CLOSED;
      this.consecutiveFailures = 0;
      this.emit("circuit-closed");
    }
  }

  // ===================================
  // Authentication Methods
  // ===================================

  /**
   * Refresh authentication token
   * @returns {Promise<void>}
   */
  async refreshToken() {
    if (typeof this.config.onTokenRefresh === "function") {
      try {
        const newToken = await this.config.onTokenRefresh();
        if (newToken) {
          this.config.apiKey = newToken;
          logger.info("[HttpSseTransport] Token refreshed successfully");
          this.emit("token-refreshed");
        }
      } catch (error) {
        logger.error("[HttpSseTransport] Token refresh failed:", error);
        this.emit("token-refresh-failed", error);
        throw error;
      }
    }
  }

  /**
   * Update API key
   * @param {string} apiKey - New API key
   */
  updateApiKey(apiKey) {
    this.config.apiKey = apiKey;
    logger.info("[HttpSseTransport] API key updated");
  }

  /**
   * Check if transport is connected
   * @returns {boolean}
   */
  isReady() {
    return this.isConnected && this.sseConnection !== null;
  }

  /**
   * Send a ping to check connection health
   * @returns {Promise<number>} Round-trip time in ms
   */
  async ping() {
    const start = Date.now();

    await this.send({
      jsonrpc: "2.0",
      method: "ping",
      params: {},
    });

    return Date.now() - start;
  }

  // ===================================
  // Statistics Methods
  // ===================================

  /**
   * Get transport statistics
   * @returns {Object}
   */
  getStats() {
    const uptime = this.stats.lastConnectedAt
      ? Date.now() - new Date(this.stats.lastConnectedAt).getTime()
      : 0;

    return {
      ...this.stats,
      isConnected: this.isConnected,
      connectionState: this.connectionState,
      circuitState: this.circuitState,
      pendingRequests: this.pendingResponses.size,
      uptime: this.isConnected ? uptime : 0,
      missedHeartbeats: this.missedHeartbeats,
      lastHeartbeatResponse: this.lastHeartbeatResponse,
      successRate:
        this.stats.requestsSent > 0
          ? (
              (this.stats.requestsSucceeded / this.stats.requestsSent) *
              100
            ).toFixed(2) + "%"
          : "N/A",
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      connectionAttempts: 0,
      successfulConnections: 0,
      failedConnections: 0,
      requestsSent: 0,
      requestsSucceeded: 0,
      requestsFailed: 0,
      bytesReceived: 0,
      bytesSent: 0,
      lastError: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
    };
    this.healthCheckResults = [];
    logger.info("[HttpSseTransport] Statistics reset");
  }

  // ===================================
  // Utility Methods
  // ===================================

  /**
   * Wait for connection to be ready
   * @param {number} timeout - Maximum wait time in ms
   * @returns {Promise<void>}
   */
  async waitForConnection(timeout = 30000) {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      const onConnected = () => {
        cleanup();
        resolve();
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off("connected", onConnected);
        this.off("error", onError);
      };

      this.once("connected", onConnected);
      this.once("error", onError);
    });
  }

  /**
   * Retry a function with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {Object} options - Retry options
   * @returns {Promise<any>}
   */
  async retryWithBackoff(fn, options = {}) {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    const baseDelay = options.baseDelay || this.config.retryDelay;

    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          logger.info(
            `[HttpSseTransport] Retry ${attempt + 1}/${maxRetries} in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}

// Export the class and constants
module.exports = {
  HttpSseTransport,
  ConnectionState,
  CircuitState,
};
