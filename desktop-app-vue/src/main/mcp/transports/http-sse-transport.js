/**
 * HTTP+SSE Transport for MCP
 *
 * Provides HTTP+Server-Sent Events based communication with MCP servers.
 * More suitable for remote servers and web-based MCP services.
 *
 * @module HttpSseTransport
 */

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
 */

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
      ...config,
    };

    this.isConnected = false;
    this.sseConnection = null;
    this.pendingResponses = new Map(); // requestId -> {resolve, reject, timer}
    this.nextRequestId = 1;
    this.retryCount = 0;

    console.log(
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
      console.log("[HttpSseTransport] Starting connection...");

      // Establish SSE connection for receiving messages
      await this._connectSSE();

      this.isConnected = true;
      this.emit("connected");

      console.log("[HttpSseTransport] Connection established");
    } catch (error) {
      console.error("[HttpSseTransport] Failed to start:", error);
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

        console.log("[HttpSseTransport] SSE connection established");

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
                console.error(
                  "[HttpSseTransport] Failed to parse SSE message:",
                  error,
                );
              }
            }
          }
        });

        res.on("error", (error) => {
          console.error("[HttpSseTransport] SSE error:", error);
          this.emit("error", error);
          this._reconnectSSE();
        });

        res.on("end", () => {
          console.log("[HttpSseTransport] SSE connection closed");
          this.isConnected = false;
          this.emit("disconnected");
          this._reconnectSSE();
        });

        this.sseConnection = res;
        resolve();
      });

      req.on("error", (error) => {
        console.error("[HttpSseTransport] SSE request error:", error);
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
      console.error("[HttpSseTransport] Max retries reached, giving up");
      this.emit("error", new Error("Failed to reconnect after max retries"));
      return;
    }

    this.retryCount++;
    const delay = this.config.retryDelay * Math.pow(2, this.retryCount - 1);

    console.log(
      `[HttpSseTransport] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.config.maxRetries})`,
    );

    setTimeout(async () => {
      try {
        await this._connectSSE();
        this.retryCount = 0; // Reset on successful connection
        this.isConnected = true;
        this.emit("reconnected");
      } catch (error) {
        console.error("[HttpSseTransport] Reconnect failed:", error);
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
    if (!this.isConnected) {
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

      // Send HTTP POST request
      this._sendHttpRequest(message).catch((error) => {
        clearTimeout(timer);
        this.pendingResponses.delete(requestId);
        reject(error);
      });

      console.log(
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
    console.log(
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
    console.log("[HttpSseTransport] Stopping connection");

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
    this.emit("disconnected");
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
}

module.exports = { HttpSseTransport };
