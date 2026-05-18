/**
 * EvoMap GEP-A2A Protocol HTTP Client
 *
 * HTTP client for communicating with the EvoMap Hub via the GEP-A2A v1.0.0 protocol.
 * Supports protocol envelope construction, retry logic for transient errors,
 * and both A2A envelope endpoints and REST discovery endpoints.
 *
 * @module evomap/evomap-client
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

let axios;
try {
  axios = require("axios");
} catch (e) {
  logger.warn("[EvoMapClient] axios not available");
}

// Default configuration
const DEFAULT_HUB_URL = process.env.EVOMAP_HUB_URL || "https://evomap.ai";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;

const PROTOCOL_NAME = "GEP-A2A";
const PROTOCOL_VERSION = "1.0.0";

/**
 * HTTP status codes that are considered transient and eligible for retry
 */
const TRANSIENT_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Error codes from axios that indicate network-level transient failures
 */
const TRANSIENT_ERROR_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_NETWORK",
];

/**
 * EvoMap GEP-A2A Protocol HTTP Client
 *
 * @example
 * const client = new EvoMapClient({ hubUrl: 'https://evomap.ai' });
 * const result = await client.hello();
 */
class EvoMapClient {
  /**
   * Create a new EvoMapClient instance
   * @param {Object} options - Client configuration
   * @param {string} [options.hubUrl] - Base URL of the EvoMap Hub
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {number} [options.maxRetries] - Maximum number of retry attempts
   */
  constructor({ hubUrl, timeout, maxRetries } = {}) {
    this.hubUrl = hubUrl || DEFAULT_HUB_URL;
    this.timeout = timeout || DEFAULT_TIMEOUT;
    this.maxRetries = maxRetries != null ? maxRetries : MAX_RETRIES;
    this.senderId = null;

    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retries: 0,
      lastRequestTime: null,
    };

    this._initClient();

    logger.info(`[EvoMapClient] Initialized with hubUrl: ${this.hubUrl}`);
  }

  /**
   * Initialize the axios client with interceptors
   * @private
   */
  _initClient() {
    if (!axios) {
      logger.error(
        "[EvoMapClient] axios is not available, client will not function",
      );
      this.client = null;
      return;
    }

    this.client = axios.create({
      baseURL: this.hubUrl,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Client-Version": "1.0.0",
        "X-Protocol": PROTOCOL_NAME,
        "X-Protocol-Version": PROTOCOL_VERSION,
      },
    });

    this._setupRequestInterceptor();
    this._setupResponseInterceptor();
  }

  /**
   * Setup request interceptor for logging and request ID injection
   * @private
   */
  _setupRequestInterceptor() {
    this.client.interceptors.request.use(
      (config) => {
        const requestId = uuidv4();
        config.headers["X-Request-ID"] = requestId;

        this._stats.totalRequests++;
        this._stats.lastRequestTime = Date.now();

        logger.info(
          `[EvoMapClient] ${config.method.toUpperCase()} ${config.url} [${requestId.substring(0, 8)}]`,
        );

        return config;
      },
      (error) => {
        logger.error(
          "[EvoMapClient] Request interceptor error:",
          error.message,
        );
        return Promise.reject(error);
      },
    );
  }

  /**
   * Setup response interceptor for error handling
   * @private
   */
  _setupResponseInterceptor() {
    this.client.interceptors.response.use(
      (response) => {
        this._stats.successfulRequests++;
        return response.data;
      },
      (error) => {
        this._stats.failedRequests++;

        if (error.response) {
          const status = error.response.status;
          const responseData = error.response.data || {};
          const message =
            responseData.message || responseData.error || error.message;

          logger.error(`[EvoMapClient] HTTP ${status}: ${message}`);

          const enhancedError = new Error(
            `EvoMap Hub error (${status}): ${message}`,
          );
          enhancedError.status = status;
          enhancedError.apiResponse = responseData;
          enhancedError.isHttpError = true;
          enhancedError.isTransient = TRANSIENT_STATUS_CODES.includes(status);

          return Promise.reject(enhancedError);
        } else if (error.request) {
          const networkError = new Error(
            "Network error: Unable to reach EvoMap Hub",
          );
          networkError.isNetworkError = true;
          networkError.isTransient = true;
          networkError.code = error.code;

          logger.warn(
            `[EvoMapClient] Network error: ${error.code || error.message}`,
          );

          return Promise.reject(networkError);
        } else {
          logger.error("[EvoMapClient] Request setup error:", error.message);
          return Promise.reject(error);
        }
      },
    );
  }

  // ==================== Sender Identity ====================

  /**
   * Set the sender node ID for protocol envelopes
   * @param {string} nodeId - Node identifier (e.g. "node_<hex>")
   */
  setSenderId(nodeId) {
    this.senderId = nodeId;
  }

  // ==================== Protocol Envelope ====================

  /**
   * Build a GEP-A2A protocol envelope
   * @param {string} messageType - Message type (hello, publish, fetch, validate, report, revoke)
   * @param {Object} payload - Message payload
   * @returns {Object} Protocol envelope
   */
  _buildEnvelope(messageType, payload = {}) {
    return {
      protocol: PROTOCOL_NAME,
      protocol_version: PROTOCOL_VERSION,
      message_type: messageType,
      message_id: uuidv4(),
      sender_id: this.senderId || "unknown",
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  // ==================== Core A2A Endpoints ====================

  /**
   * Send hello/handshake to the Hub
   * @returns {Promise<Object>} { your_node_id, hub_node_id, credits, claim_code, heartbeat_interval_ms }
   */
  async hello() {
    try {
      this._ensureClient();
      const envelope = this._buildEnvelope("hello", {});
      const response = await this._requestWithRetry("post", "/a2a/hello", {
        data: envelope,
      });
      return {
        success: true,
        data: response.payload || response.data || response,
      };
    } catch (error) {
      return this._handleMethodError(error, "hello");
    }
  }

  /**
   * Publish assets (Gene, Capsule, EvolutionEvent) to the Hub
   * @param {Array} assets - Array of asset objects
   * @returns {Promise<Object>} { status, asset_ids[] }
   */
  async publish(assets) {
    try {
      this._ensureClient();

      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        return {
          success: false,
          error: "Assets array is required and must not be empty",
        };
      }

      const envelope = this._buildEnvelope("publish", { assets });
      const response = await this._requestWithRetry("post", "/a2a/publish", {
        data: envelope,
      });
      return {
        success: true,
        data: response.payload || response.data || response,
      };
    } catch (error) {
      return this._handleMethodError(error, "publish");
    }
  }

  /**
   * Fetch assets from the Hub
   * @param {Object} options - Fetch options (signals, type, limit, etc.)
   * @returns {Promise<Object>} { assets[], tasks[] }
   */
  async fetch(options = {}) {
    try {
      this._ensureClient();
      const envelope = this._buildEnvelope("fetch", options);
      const response = await this._requestWithRetry("post", "/a2a/fetch", {
        data: envelope,
      });
      return {
        success: true,
        data: response.payload || response.data || response,
      };
    } catch (error) {
      return this._handleMethodError(error, "fetch");
    }
  }

  /**
   * Validate assets (dry-run before publish)
   * @param {Array} assets - Array of asset objects to validate
   * @returns {Promise<Object>} { computed_ids[], errors[] }
   */
  async validate(assets) {
    try {
      this._ensureClient();

      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        return { success: false, error: "Assets array is required" };
      }

      const envelope = this._buildEnvelope("validate", { assets });
      const response = await this._requestWithRetry("post", "/a2a/validate", {
        data: envelope,
      });
      return {
        success: true,
        data: response.payload || response.data || response,
      };
    } catch (error) {
      return this._handleMethodError(error, "validate");
    }
  }

  /**
   * Report a validation result for an asset
   * @param {string} targetAssetId - Asset ID to report on
   * @param {Object} validationReport - Validation report data
   * @returns {Promise<Object>}
   */
  async report(targetAssetId, validationReport) {
    try {
      this._ensureClient();

      if (!targetAssetId) {
        return { success: false, error: "Target asset ID is required" };
      }

      const envelope = this._buildEnvelope("report", {
        target_asset_id: targetAssetId,
        validation_report: validationReport,
      });
      const response = await this._requestWithRetry("post", "/a2a/report", {
        data: envelope,
      });
      return {
        success: true,
        data: response.payload || response.data || response,
      };
    } catch (error) {
      return this._handleMethodError(error, "report");
    }
  }

  /**
   * Revoke a previously published asset
   * @param {string} assetId - Asset ID to revoke
   * @param {string} reason - Reason for revocation
   * @returns {Promise<Object>}
   */
  async revoke(assetId, reason) {
    try {
      this._ensureClient();

      if (!assetId) {
        return { success: false, error: "Asset ID is required" };
      }

      const envelope = this._buildEnvelope("revoke", {
        asset_id: assetId,
        reason: reason || "Revoked by publisher",
      });
      const response = await this._requestWithRetry("post", "/a2a/revoke", {
        data: envelope,
      });
      return {
        success: true,
        data: response.payload || response.data || response,
      };
    } catch (error) {
      return this._handleMethodError(error, "revoke");
    }
  }

  // ==================== REST Discovery Endpoints ====================

  /**
   * Search assets by signals, type, and sort criteria
   * @param {string[]} signals - Keywords/signals to match
   * @param {string} [type] - Asset type filter (Gene|Capsule|EvolutionEvent)
   * @param {string} [sort] - Sort order (relevance|trending|recent)
   * @returns {Promise<Object>} { assets[] }
   */
  async searchAssets(signals, type, sort) {
    try {
      this._ensureClient();

      const params = {};
      if (signals && Array.isArray(signals)) {
        params.signals = signals.join(",");
      }
      if (type) {
        params.type = type;
      }
      if (sort) {
        params.sort = sort;
      }

      const response = await this._requestWithRetry(
        "get",
        "/api/assets/search",
        { params },
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "searchAssets");
    }
  }

  /**
   * Get detailed information about a specific asset
   * @param {string} assetId - Asset ID
   * @returns {Promise<Object>} Asset detail
   */
  async getAssetDetail(assetId) {
    try {
      this._ensureClient();

      if (!assetId) {
        return { success: false, error: "Asset ID is required" };
      }

      const response = await this._requestWithRetry(
        "get",
        `/api/assets/${encodeURIComponent(assetId)}`,
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "getAssetDetail");
    }
  }

  /**
   * Get ranked/promoted assets
   * @param {string} [type] - Asset type filter
   * @param {number} [limit=20] - Max results
   * @returns {Promise<Object>} { assets[] }
   */
  async getRankedAssets(type, limit = 20) {
    try {
      this._ensureClient();

      const params = { limit: Math.min(limit, 100) };
      if (type) {
        params.type = type;
      }

      const response = await this._requestWithRetry(
        "get",
        "/api/assets/ranked",
        { params },
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "getRankedAssets");
    }
  }

  /**
   * Get trending assets
   * @returns {Promise<Object>} { assets[] }
   */
  async getTrending() {
    try {
      this._ensureClient();
      const response = await this._requestWithRetry(
        "get",
        "/api/assets/trending",
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "getTrending");
    }
  }

  // ==================== Task/Bounty Endpoints ====================

  /**
   * List available tasks/bounties
   * @param {number} [reputation] - Minimum reputation filter
   * @param {number} [limit=20] - Max results
   * @returns {Promise<Object>} { tasks[] }
   */
  async listTasks(reputation, limit = 20) {
    try {
      this._ensureClient();

      const params = { limit: Math.min(limit, 100) };
      if (reputation != null) {
        params.min_reputation = reputation;
      }

      const response = await this._requestWithRetry("get", "/api/tasks", {
        params,
      });
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "listTasks");
    }
  }

  /**
   * Claim a task/bounty
   * @param {string} taskId - Task ID to claim
   * @returns {Promise<Object>}
   */
  async claimTask(taskId) {
    try {
      this._ensureClient();

      if (!taskId) {
        return { success: false, error: "Task ID is required" };
      }

      const envelope = this._buildEnvelope("claim_task", { task_id: taskId });
      const response = await this._requestWithRetry(
        "post",
        `/api/tasks/${encodeURIComponent(taskId)}/claim`,
        { data: envelope },
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "claimTask");
    }
  }

  /**
   * Complete a task by submitting the result asset
   * @param {string} taskId - Task ID
   * @param {string} assetId - Asset ID of the result
   * @returns {Promise<Object>}
   */
  async completeTask(taskId, assetId) {
    try {
      this._ensureClient();

      if (!taskId || !assetId) {
        return { success: false, error: "Task ID and asset ID are required" };
      }

      const envelope = this._buildEnvelope("complete_task", {
        task_id: taskId,
        asset_id: assetId,
      });
      const response = await this._requestWithRetry(
        "post",
        `/api/tasks/${encodeURIComponent(taskId)}/complete`,
        { data: envelope },
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "completeTask");
    }
  }

  // ==================== Node Info ====================

  /**
   * Get node info (reputation, stats)
   * @param {string} nodeId - Node ID
   * @returns {Promise<Object>} { reputation, stats }
   */
  async getNodeInfo(nodeId) {
    try {
      this._ensureClient();

      if (!nodeId) {
        return { success: false, error: "Node ID is required" };
      }

      const response = await this._requestWithRetry(
        "get",
        `/api/nodes/${encodeURIComponent(nodeId)}`,
      );
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "getNodeInfo");
    }
  }

  /**
   * Get Hub statistics
   * @returns {Promise<Object>} Hub stats
   */
  async getHubStats() {
    try {
      this._ensureClient();
      const response = await this._requestWithRetry("get", "/api/stats");
      return { success: true, data: response };
    } catch (error) {
      return this._handleMethodError(error, "getHubStats");
    }
  }

  // ==================== Asset ID Computation ====================

  /**
   * Compute asset ID using SHA-256 of canonical JSON
   * @param {Object} asset - Asset object (asset_id field is excluded from hash)
   * @returns {string} "sha256:<hex>"
   */
  static computeAssetId(asset) {
    const filtered = {};
    const sortedKeys = Object.keys(asset).sort();

    for (const key of sortedKeys) {
      if (key === "asset_id") {
        continue;
      }
      filtered[key] = asset[key];
    }

    const canonical = JSON.stringify(filtered);
    const hash = crypto
      .createHash("sha256")
      .update(canonical, "utf8")
      .digest("hex");
    return `sha256:${hash}`;
  }

  // ==================== Configuration ====================

  /**
   * Update the Hub URL
   * @param {string} newHubUrl - New Hub URL
   */
  setHubUrl(newHubUrl) {
    if (!newHubUrl || typeof newHubUrl !== "string") {
      logger.warn("[EvoMapClient] Invalid Hub URL provided");
      return;
    }

    this.hubUrl = newHubUrl;
    if (this.client) {
      this.client.defaults.baseURL = newHubUrl;
    }
    logger.info(`[EvoMapClient] Hub URL updated: ${newHubUrl}`);
  }

  /**
   * Get current client configuration
   * @returns {Object} Client configuration summary
   */
  getConfig() {
    return {
      hubUrl: this.hubUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      senderId: this.senderId,
      isAvailable: !!this.client,
    };
  }

  /**
   * Get request statistics
   * @returns {Object} Statistics about requests made by this client
   */
  getStats() {
    return { ...this._stats };
  }

  // ==================== Internal Methods ====================

  /**
   * Ensure the axios client is initialized and available
   * @private
   * @throws {Error} If axios is not available
   */
  _ensureClient() {
    if (!this.client) {
      throw new Error(
        "EvoMapClient is not available: axios dependency is missing",
      );
    }
  }

  /**
   * Execute an HTTP request with automatic retry for transient failures
   * @private
   * @param {string} method - HTTP method
   * @param {string} url - Request URL path
   * @param {Object} [config={}] - Axios request config
   * @param {number} [maxRetries] - Override max retries
   * @returns {Promise<Object>} Response data
   */
  async _requestWithRetry(method, url, config = {}, maxRetries) {
    const retryLimit = maxRetries != null ? maxRetries : this.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        const requestConfig = {
          method,
          url,
          ...config,
        };

        if (
          config.data &&
          (method === "post" || method === "put" || method === "patch")
        ) {
          requestConfig.data = config.data;
        }

        const response = await this.client.request(requestConfig);
        return response;
      } catch (error) {
        lastError = error;

        const isRetryable = this._isRetryableError(error);
        const isLastAttempt = attempt >= retryLimit;

        if (!isRetryable || isLastAttempt) {
          if (attempt > 0) {
            logger.warn(
              `[EvoMapClient] Request failed after ${attempt + 1} attempts: ${method.toUpperCase()} ${url}`,
            );
          }
          throw error;
        }

        const baseDelay = RETRY_DELAY_BASE * Math.pow(2, attempt);
        const jitter = Math.random() * baseDelay * 0.3;
        const delay = Math.min(baseDelay + jitter, 30000);

        this._stats.retries++;

        logger.info(
          `[EvoMapClient] Retrying request (${attempt + 1}/${retryLimit}): ${method.toUpperCase()} ${url} in ${Math.round(delay)}ms`,
        );

        await this._sleep(delay);
      }
    }

    throw lastError || new Error("Request failed after maximum retries");
  }

  /**
   * Determine if an error is eligible for retry
   * @private
   * @param {Error} error
   * @returns {boolean}
   */
  _isRetryableError(error) {
    if (error.isTransient) {
      return true;
    }
    if (error.isNetworkError) {
      return true;
    }
    if (error.code && TRANSIENT_ERROR_CODES.includes(error.code)) {
      return true;
    }
    if (error.status && TRANSIENT_STATUS_CODES.includes(error.status)) {
      return true;
    }
    return false;
  }

  /**
   * Handle errors from public API methods in a consistent way
   * @private
   * @param {Error} error
   * @param {string} methodName
   * @returns {Object} Standardized error response
   */
  _handleMethodError(error, methodName) {
    const errorMessage = error.message || "Unknown error";

    logger.error(`[EvoMapClient] ${methodName} failed: ${errorMessage}`);

    const result = {
      success: false,
      error: errorMessage,
    };

    if (error.status) {
      result.status = error.status;
    }

    if (error.apiResponse) {
      result.apiData = error.apiResponse;
    }

    return result;
  }

  /**
   * Sleep for a specified number of milliseconds
   * @private
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Destroy the client and clean up resources
   */
  destroy() {
    if (this.client) {
      this.client.interceptors.request.clear();
      this.client.interceptors.response.clear();
    }
    this.client = null;
    this.senderId = null;
    logger.info("[EvoMapClient] Client destroyed");
  }
}

// ==================== Singleton Support ====================

let _instance = null;

/**
 * Get or create a singleton EvoMapClient instance
 * @param {Object} [options] - Client options (only used on first call or when forceNew is true)
 * @param {boolean} [forceNew=false] - Force creation of a new instance
 * @returns {EvoMapClient}
 */
function getEvoMapClient(options = {}, forceNew = false) {
  if (!_instance || forceNew) {
    if (_instance) {
      _instance.destroy();
    }
    _instance = new EvoMapClient(options);
  }
  return _instance;
}

module.exports = {
  EvoMapClient,
  getEvoMapClient,
};
