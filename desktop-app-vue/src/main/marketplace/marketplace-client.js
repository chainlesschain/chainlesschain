/**
 * Plugin Marketplace HTTP Client
 *
 * HTTP client for communicating with the Plugin Marketplace REST API.
 * Supports DID-based authentication, retry logic for transient errors,
 * and multipart uploads for plugin publishing.
 *
 * API Base URL: http://localhost:8090/api
 * Response format: { success: true, message: "...", data: {...}, timestamp: ... }
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

let axios;
try {
  axios = require('axios');
} catch (e) {
  logger.warn('[MarketplaceClient] axios not available');
}

// Default configuration
const DEFAULT_BASE_URL = process.env.MARKETPLACE_API_URL || 'http://localhost:8090/api';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay for exponential backoff
const UPLOAD_TIMEOUT = 120000; // 2 minutes for file uploads

/**
 * HTTP status codes that are considered transient and eligible for retry
 */
const TRANSIENT_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Error codes from axios that indicate network-level transient failures
 */
const TRANSIENT_ERROR_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'ERR_NETWORK',
];

/**
 * Plugin Marketplace HTTP Client
 *
 * Provides methods for interacting with the Plugin Marketplace REST API,
 * including plugin discovery, publishing, rating, and administration.
 *
 * @example
 * const client = new MarketplaceClient({
 *   baseURL: 'http://localhost:8090/api',
 *   authToken: 'jwt-token-here'
 * });
 * const result = await client.listPlugins({ category: 'tools', page: 1 });
 */
class MarketplaceClient {
  /**
   * Create a new MarketplaceClient instance
   * @param {Object} options - Client configuration
   * @param {string} [options.baseURL] - Base URL of the marketplace API
   * @param {string} [options.authToken] - JWT authentication token
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {number} [options.maxRetries] - Maximum number of retry attempts
   */
  constructor({ baseURL, authToken, timeout, maxRetries } = {}) {
    this.baseURL = baseURL || DEFAULT_BASE_URL;
    this.authToken = authToken || null;
    this.timeout = timeout || DEFAULT_TIMEOUT;
    this.maxRetries = maxRetries != null ? maxRetries : MAX_RETRIES;
    this.requestId = null;

    // Statistics tracking
    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retries: 0,
      lastRequestTime: null,
    };

    this._initClient();

    logger.info(`[MarketplaceClient] Initialized with baseURL: ${this.baseURL}`);
  }

  /**
   * Initialize the axios client with interceptors
   * @private
   */
  _initClient() {
    if (!axios) {
      logger.error('[MarketplaceClient] axios is not available, client will not function');
      this.client = null;
      return;
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client-Version': '0.33.0',
      },
    });

    // Set auth token if provided
    if (this.authToken) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.authToken}`;
    }

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
        // Generate and attach request ID for tracing
        const requestId = uuidv4();
        config.headers['X-Request-ID'] = requestId;
        this.requestId = requestId;

        this._stats.totalRequests++;
        this._stats.lastRequestTime = Date.now();

        logger.info(
          `[MarketplaceClient] ${config.method.toUpperCase()} ${config.url} [${requestId.substring(0, 8)}]`
        );

        return config;
      },
      (error) => {
        logger.error('[MarketplaceClient] Request interceptor error:', error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Setup response interceptor for error handling and response normalization
   * @private
   */
  _setupResponseInterceptor() {
    this.client.interceptors.response.use(
      (response) => {
        this._stats.successfulRequests++;

        const { data } = response;

        // Handle standard API response format: { success, message, data, timestamp }
        if (data && typeof data === 'object' && 'success' in data) {
          if (!data.success) {
            const error = new Error(data.message || 'API returned unsuccessful response');
            error.apiResponse = data;
            error.status = response.status;
            throw error;
          }
          return data;
        }

        // Non-standard response, wrap it
        return {
          success: true,
          data: data,
          timestamp: Date.now(),
        };
      },
      (error) => {
        this._stats.failedRequests++;

        if (error.response) {
          const status = error.response.status;
          const responseData = error.response.data || {};
          const message = responseData.message || error.message;

          logger.error(
            `[MarketplaceClient] HTTP ${status}: ${message}`
          );

          // Map common HTTP status codes to meaningful error messages
          const statusMessages = {
            400: `Bad request: ${message}`,
            401: 'Authentication required. Please log in.',
            403: 'Permission denied. Insufficient privileges.',
            404: `Resource not found: ${message}`,
            409: `Conflict: ${message}`,
            413: 'Payload too large. Please reduce file size.',
            422: `Validation error: ${message}`,
            429: 'Rate limited. Please try again later.',
            500: `Internal server error: ${message}`,
            502: 'Bad gateway. Marketplace service may be down.',
            503: 'Service unavailable. Please try again later.',
          };

          const enhancedMessage = statusMessages[status] || `Request failed (${status}): ${message}`;

          const enhancedError = new Error(enhancedMessage);
          enhancedError.status = status;
          enhancedError.apiResponse = responseData;
          enhancedError.isHttpError = true;
          enhancedError.isTransient = TRANSIENT_STATUS_CODES.includes(status);

          return Promise.reject(enhancedError);
        } else if (error.request) {
          // Network error - no response received
          const networkError = new Error('Network error: Unable to reach marketplace service');
          networkError.isNetworkError = true;
          networkError.isTransient = true;
          networkError.code = error.code;

          logger.warn(
            `[MarketplaceClient] Network error: ${error.code || error.message}`
          );

          return Promise.reject(networkError);
        } else {
          // Request setup error
          logger.error('[MarketplaceClient] Request setup error:', error.message);
          return Promise.reject(error);
        }
      }
    );
  }

  // ==================== Authentication ====================

  /**
   * Set the JWT authentication token
   * @param {string|null} token - JWT token string, or null to clear
   */
  setAuthToken(token) {
    this.authToken = token;

    if (!this.client) {
      logger.warn('[MarketplaceClient] Client not initialized, token stored for later use');
      return;
    }

    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      logger.info('[MarketplaceClient] Auth token set');
    } else {
      delete this.client.defaults.headers.common['Authorization'];
      this.authToken = null;
      logger.info('[MarketplaceClient] Auth token cleared');
    }
  }

  /**
   * Check whether an authentication token is currently set
   * @returns {boolean}
   */
  hasAuthToken() {
    return !!this.authToken;
  }

  // ==================== Plugin Discovery ====================

  /**
   * List plugins with optional filters
   *
   * @param {Object} [filters={}] - Filter parameters
   * @param {string} [filters.category] - Filter by category slug
   * @param {string} [filters.search] - Free text search query
   * @param {string} [filters.sort] - Sort field (e.g., 'downloads', 'rating', 'created', 'updated')
   * @param {number} [filters.page=1] - Page number (1-based)
   * @param {number} [filters.pageSize=20] - Number of items per page
   * @param {boolean} [filters.verified] - Filter by verification status
   * @returns {Promise<Object>} { success: boolean, data: { items: [], total: number, page: number, pageSize: number } | null, error?: string }
   */
  async listPlugins(filters = {}) {
    try {
      this._ensureClient();

      const params = {};
      if (filters.category) params.category = filters.category;
      if (filters.search) params.search = filters.search;
      if (filters.sort) params.sort = filters.sort;
      if (filters.page != null) params.page = filters.page;
      if (filters.pageSize != null) params.pageSize = filters.pageSize;
      if (filters.verified != null) params.verified = filters.verified;

      const response = await this._requestWithRetry('get', '/plugins', { params });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'listPlugins');
    }
  }

  /**
   * Search plugins with keyword and filters
   *
   * @param {string} keyword - Search keyword
   * @param {Object} [filters={}] - Additional filters
   * @param {string} [filters.category] - Filter by category
   * @param {boolean} [filters.verified] - Filter by verification status
   * @param {string} [filters.sort] - Sort order (e.g., 'relevance', 'downloads', 'rating')
   * @param {number} [filters.page] - Page number
   * @param {number} [filters.pageSize] - Items per page
   * @returns {Promise<Object>} { success: boolean, data: { items: [], total: number } | null, error?: string }
   */
  async searchPlugins(keyword, filters = {}) {
    try {
      this._ensureClient();

      if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
        return {
          success: false,
          error: 'Search keyword is required and must be a non-empty string',
        };
      }

      const params = { keyword: keyword.trim() };
      if (filters.category) params.category = filters.category;
      if (filters.verified != null) params.verified = filters.verified;
      if (filters.sort) params.sort = filters.sort;
      if (filters.page != null) params.page = filters.page;
      if (filters.pageSize != null) params.pageSize = filters.pageSize;

      const response = await this._requestWithRetry('get', '/plugins/search', { params });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'searchPlugins');
    }
  }

  /**
   * Get detailed information about a specific plugin
   *
   * @param {string} id - Plugin ID
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async getPluginDetail(id) {
    try {
      this._ensureClient();

      if (!id) {
        return { success: false, error: 'Plugin ID is required' };
      }

      const response = await this._requestWithRetry('get', `/plugins/${encodeURIComponent(id)}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'getPluginDetail');
    }
  }

  /**
   * Get featured plugins
   *
   * @param {number} [limit=10] - Maximum number of featured plugins to return
   * @returns {Promise<Object>} { success: boolean, data: Array | null, error?: string }
   */
  async getFeatured(limit = 10) {
    try {
      this._ensureClient();

      const params = {};
      if (limit != null && limit > 0) {
        params.limit = Math.min(limit, 100);
      }

      const response = await this._requestWithRetry('get', '/plugins/featured', { params });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'getFeatured');
    }
  }

  /**
   * Get popular plugins
   *
   * @param {number} [limit=20] - Maximum number of popular plugins to return
   * @returns {Promise<Object>} { success: boolean, data: Array | null, error?: string }
   */
  async getPopular(limit = 20) {
    try {
      this._ensureClient();

      const params = {};
      if (limit != null && limit > 0) {
        params.limit = Math.min(limit, 100);
      }

      const response = await this._requestWithRetry('get', '/plugins/popular', { params });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'getPopular');
    }
  }

  /**
   * Get all available plugin categories
   *
   * @returns {Promise<Object>} { success: boolean, data: Array | null, error?: string }
   */
  async getCategories() {
    try {
      this._ensureClient();

      const response = await this._requestWithRetry('get', '/categories');

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'getCategories');
    }
  }

  // ==================== Plugin Download ====================

  /**
   * Get the download URL for a plugin
   *
   * @param {string} id - Plugin ID
   * @param {string} [version] - Specific version to download (defaults to latest)
   * @returns {Promise<Object>} { success: boolean, data: { url: string, version: string, checksum: string } | null, error?: string }
   */
  async downloadPlugin(id, version) {
    try {
      this._ensureClient();

      if (!id) {
        return { success: false, error: 'Plugin ID is required' };
      }

      const params = {};
      if (version) {
        params.version = version;
      }

      const response = await this._requestWithRetry(
        'get',
        `/plugins/${encodeURIComponent(id)}/download`,
        { params }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'downloadPlugin');
    }
  }

  // ==================== Plugin Publishing ====================

  /**
   * Publish a new plugin to the marketplace
   *
   * Sends plugin metadata and the plugin file as multipart/form-data.
   *
   * @param {Object} pluginData - Plugin metadata
   * @param {string} pluginData.name - Plugin name (required)
   * @param {string} pluginData.description - Plugin description (required)
   * @param {string} pluginData.version - Semantic version string (required)
   * @param {string} pluginData.category - Category slug (required)
   * @param {string} [pluginData.author] - Author display name
   * @param {string} [pluginData.authorDid] - Author DID identifier
   * @param {string} [pluginData.license] - License identifier (e.g., 'MIT', 'Apache-2.0')
   * @param {string} [pluginData.homepage] - Homepage or repository URL
   * @param {string} [pluginData.readme] - README content in markdown
   * @param {Array<string>} [pluginData.tags] - Searchable tags
   * @param {Object} [pluginData.dependencies] - Plugin dependency map
   * @param {string} [pluginData.minAppVersion] - Minimum app version required
   * @param {Buffer} fileBuffer - Plugin package file buffer
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async publishPlugin(pluginData, fileBuffer) {
    try {
      this._ensureClient();

      if (!pluginData || !pluginData.name || !pluginData.version) {
        return {
          success: false,
          error: 'Plugin name and version are required',
        };
      }

      if (!fileBuffer || !(fileBuffer instanceof Buffer || ArrayBuffer.isView(fileBuffer))) {
        return {
          success: false,
          error: 'A valid file buffer is required for plugin upload',
        };
      }

      // Build multipart form data
      const FormData = require('form-data');
      const formData = new FormData();

      // Append metadata fields
      const metadataFields = [
        'name', 'description', 'version', 'category', 'author',
        'authorDid', 'license', 'homepage', 'readme', 'minAppVersion',
      ];
      for (const field of metadataFields) {
        if (pluginData[field] != null) {
          formData.append(field, String(pluginData[field]));
        }
      }

      // Append array and object fields as JSON strings
      if (pluginData.tags && Array.isArray(pluginData.tags)) {
        formData.append('tags', JSON.stringify(pluginData.tags));
      }
      if (pluginData.dependencies && typeof pluginData.dependencies === 'object') {
        formData.append('dependencies', JSON.stringify(pluginData.dependencies));
      }

      // Append the plugin file
      const filename = `${pluginData.name}-${pluginData.version}.zip`;
      formData.append('file', fileBuffer, {
        filename: filename,
        contentType: 'application/zip',
      });

      const response = await this._requestWithRetry(
        'post',
        '/plugins',
        {
          data: formData,
          headers: {
            ...formData.getHeaders(),
          },
          timeout: UPLOAD_TIMEOUT,
        },
        1 // Only 1 retry for uploads to avoid duplicate submissions
      );

      logger.info(`[MarketplaceClient] Plugin published successfully: ${pluginData.name}@${pluginData.version}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'publishPlugin');
    }
  }

  /**
   * Update metadata of an existing plugin
   *
   * @param {string} id - Plugin ID
   * @param {Object} data - Fields to update
   * @param {string} [data.description] - Updated description
   * @param {string} [data.homepage] - Updated homepage URL
   * @param {string} [data.readme] - Updated README content
   * @param {Array<string>} [data.tags] - Updated tags
   * @param {string} [data.license] - Updated license
   * @param {string} [data.category] - Updated category
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async updatePluginMetadata(id, data) {
    try {
      this._ensureClient();

      if (!id) {
        return { success: false, error: 'Plugin ID is required' };
      }

      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        return { success: false, error: 'Update data must be a non-empty object' };
      }

      const response = await this._requestWithRetry(
        'put',
        `/plugins/${encodeURIComponent(id)}`,
        { data }
      );

      logger.info(`[MarketplaceClient] Plugin metadata updated: ${id}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'updatePluginMetadata');
    }
  }

  /**
   * Delete a plugin from the marketplace
   *
   * @param {string} id - Plugin ID
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async deletePlugin(id) {
    try {
      this._ensureClient();

      if (!id) {
        return { success: false, error: 'Plugin ID is required' };
      }

      const response = await this._requestWithRetry(
        'delete',
        `/plugins/${encodeURIComponent(id)}`
      );

      logger.info(`[MarketplaceClient] Plugin deleted: ${id}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'deletePlugin');
    }
  }

  // ==================== Ratings & Reviews ====================

  /**
   * Get ratings and reviews for a plugin
   *
   * @param {string} pluginId - Plugin ID
   * @param {Object} [options={}] - Pagination options
   * @param {number} [options.page] - Page number
   * @param {number} [options.pageSize] - Items per page
   * @param {string} [options.sort] - Sort order ('recent', 'highest', 'lowest')
   * @returns {Promise<Object>} { success: boolean, data: { items: [], averageRating: number, totalRatings: number } | null, error?: string }
   */
  async getRatings(pluginId, options = {}) {
    try {
      this._ensureClient();

      if (!pluginId) {
        return { success: false, error: 'Plugin ID is required' };
      }

      const params = {};
      if (options.page != null) params.page = options.page;
      if (options.pageSize != null) params.pageSize = options.pageSize;
      if (options.sort) params.sort = options.sort;

      const response = await this._requestWithRetry(
        'get',
        `/plugins/${encodeURIComponent(pluginId)}/ratings`,
        { params }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'getRatings');
    }
  }

  /**
   * Submit a rating and optional review for a plugin
   *
   * @param {string} pluginId - Plugin ID
   * @param {number} rating - Rating value (1-5)
   * @param {string} [comment] - Optional review comment
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async ratePlugin(pluginId, rating, comment) {
    try {
      this._ensureClient();

      if (!pluginId) {
        return { success: false, error: 'Plugin ID is required' };
      }

      // Validate rating range
      const numericRating = Number(rating);
      if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
        return {
          success: false,
          error: 'Rating must be a number between 1 and 5',
        };
      }

      const body = {
        rating: Math.round(numericRating),
      };
      if (comment && typeof comment === 'string' && comment.trim()) {
        body.comment = comment.trim();
      }

      const response = await this._requestWithRetry(
        'post',
        `/plugins/${encodeURIComponent(pluginId)}/ratings`,
        { data: body }
      );

      logger.info(`[MarketplaceClient] Rating submitted for plugin ${pluginId}: ${body.rating}/5`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'ratePlugin');
    }
  }

  /**
   * Delete a rating by ID
   *
   * @param {string} ratingId - Rating ID to delete
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async deleteRating(ratingId) {
    try {
      this._ensureClient();

      if (!ratingId) {
        return { success: false, error: 'Rating ID is required' };
      }

      const response = await this._requestWithRetry(
        'delete',
        `/ratings/${encodeURIComponent(ratingId)}`
      );

      logger.info(`[MarketplaceClient] Rating deleted: ${ratingId}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'deleteRating');
    }
  }

  // ==================== Plugin Reporting ====================

  /**
   * Report a plugin for policy violation or abuse
   *
   * @param {string} pluginId - Plugin ID to report
   * @param {string} reason - Reason for the report
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async reportPlugin(pluginId, reason) {
    try {
      this._ensureClient();

      if (!pluginId) {
        return { success: false, error: 'Plugin ID is required' };
      }

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return { success: false, error: 'A reason for the report is required' };
      }

      const response = await this._requestWithRetry(
        'post',
        `/plugins/${encodeURIComponent(pluginId)}/report`,
        {
          data: { reason: reason.trim() },
        }
      );

      logger.info(`[MarketplaceClient] Plugin reported: ${pluginId}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'reportPlugin');
    }
  }

  // ==================== Admin Operations ====================

  /**
   * Approve a plugin (admin only)
   *
   * @param {string} id - Plugin ID to approve
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async approvePlugin(id) {
    try {
      this._ensureClient();

      if (!id) {
        return { success: false, error: 'Plugin ID is required' };
      }

      const response = await this._requestWithRetry(
        'post',
        `/plugins/${encodeURIComponent(id)}/approve`
      );

      logger.info(`[MarketplaceClient] Plugin approved: ${id}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'approvePlugin');
    }
  }

  /**
   * Reject a plugin (admin only)
   *
   * @param {string} id - Plugin ID to reject
   * @param {string} reason - Reason for rejection
   * @returns {Promise<Object>} { success: boolean, data: Object | null, error?: string }
   */
  async rejectPlugin(id, reason) {
    try {
      this._ensureClient();

      if (!id) {
        return { success: false, error: 'Plugin ID is required' };
      }

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return { success: false, error: 'A reason for rejection is required' };
      }

      const params = { reason: reason.trim() };

      const response = await this._requestWithRetry(
        'post',
        `/plugins/${encodeURIComponent(id)}/reject`,
        { params }
      );

      logger.info(`[MarketplaceClient] Plugin rejected: ${id}, reason: ${reason.trim()}`);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleMethodError(error, 'rejectPlugin');
    }
  }

  // ==================== Configuration ====================

  /**
   * Update the base URL for the marketplace API
   * @param {string} newBaseURL - New base URL
   */
  setBaseURL(newBaseURL) {
    if (!newBaseURL || typeof newBaseURL !== 'string') {
      logger.warn('[MarketplaceClient] Invalid base URL provided');
      return;
    }

    this.baseURL = newBaseURL;
    if (this.client) {
      this.client.defaults.baseURL = newBaseURL;
    }
    logger.info(`[MarketplaceClient] Base URL updated: ${newBaseURL}`);
  }

  /**
   * Get current client configuration
   * @returns {Object} Client configuration summary
   */
  getConfig() {
    return {
      baseURL: this.baseURL,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      hasAuth: this.hasAuthToken(),
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

  /**
   * Reset request statistics
   */
  resetStats() {
    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retries: 0,
      lastRequestTime: null,
    };
  }

  // ==================== Health & Connectivity ====================

  /**
   * Check connectivity to the marketplace service
   * @returns {Promise<Object>} { success: boolean, latency?: number, error?: string }
   */
  async checkHealth() {
    try {
      this._ensureClient();

      const startTime = Date.now();
      await this.client.get('/health', { timeout: 5000 });
      const latency = Date.now() - startTime;

      return {
        success: true,
        data: {
          status: 'healthy',
          latency,
          baseURL: this.baseURL,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Marketplace service unreachable: ${error.message}`,
        data: {
          status: 'unhealthy',
          baseURL: this.baseURL,
        },
      };
    }
  }

  // ==================== Internal Methods ====================

  /**
   * Ensure the axios client is initialized and available
   * @private
   * @throws {Error} If axios is not available
   */
  _ensureClient() {
    if (!this.client) {
      throw new Error('MarketplaceClient is not available: axios dependency is missing');
    }
  }

  /**
   * Execute an HTTP request with automatic retry for transient failures
   *
   * Implements exponential backoff with jitter. Only retries on network errors
   * and specific HTTP status codes (408, 429, 500, 502, 503, 504).
   *
   * @private
   * @param {string} method - HTTP method (get, post, put, delete)
   * @param {string} url - Request URL path
   * @param {Object} [config={}] - Axios request config (params, data, headers, timeout)
   * @param {number} [maxRetries] - Override max retries for this request
   * @returns {Promise<Object>} Axios response data
   */
  async _requestWithRetry(method, url, config = {}, maxRetries) {
    const retryLimit = maxRetries != null ? maxRetries : this.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        // Build the request config
        const requestConfig = {
          method,
          url,
          ...config,
        };

        // For methods that send data, place it correctly
        if (config.data && (method === 'post' || method === 'put' || method === 'patch')) {
          requestConfig.data = config.data;
        }

        const response = await this.client.request(requestConfig);
        return response;
      } catch (error) {
        lastError = error;

        // Determine if this error is retryable
        const isRetryable = this._isRetryableError(error);
        const isLastAttempt = attempt >= retryLimit;

        if (!isRetryable || isLastAttempt) {
          if (attempt > 0) {
            logger.warn(
              `[MarketplaceClient] Request failed after ${attempt + 1} attempts: ${method.toUpperCase()} ${url}`
            );
          }
          throw error;
        }

        // Calculate backoff delay with jitter
        const baseDelay = RETRY_DELAY_BASE * Math.pow(2, attempt);
        const jitter = Math.random() * baseDelay * 0.3;
        const delay = Math.min(baseDelay + jitter, 30000); // Cap at 30 seconds

        this._stats.retries++;

        logger.info(
          `[MarketplaceClient] Retrying request (${attempt + 1}/${retryLimit}): ${method.toUpperCase()} ${url} in ${Math.round(delay)}ms`
        );

        await this._sleep(delay);
      }
    }

    // Should not reach here, but safety net
    throw lastError || new Error('Request failed after maximum retries');
  }

  /**
   * Determine if an error is eligible for retry
   *
   * @private
   * @param {Error} error - The error to evaluate
   * @returns {boolean} True if the request should be retried
   */
  _isRetryableError(error) {
    // Explicitly marked as transient by our interceptor
    if (error.isTransient) {
      return true;
    }

    // Network-level errors
    if (error.isNetworkError) {
      return true;
    }

    // Check axios error codes for network issues
    if (error.code && TRANSIENT_ERROR_CODES.includes(error.code)) {
      return true;
    }

    // Check HTTP status codes
    if (error.status && TRANSIENT_STATUS_CODES.includes(error.status)) {
      return true;
    }

    return false;
  }

  /**
   * Handle errors from public API methods in a consistent way
   *
   * @private
   * @param {Error} error - The caught error
   * @param {string} methodName - Name of the calling method for logging
   * @returns {Object} Standardized error response { success: false, error: string }
   */
  _handleMethodError(error, methodName) {
    const errorMessage = error.message || 'Unknown error';

    logger.error(`[MarketplaceClient] ${methodName} failed: ${errorMessage}`);

    const result = {
      success: false,
      error: errorMessage,
    };

    // Include HTTP status if available
    if (error.status) {
      result.status = error.status;
    }

    // Include API response data if available
    if (error.apiResponse) {
      result.apiData = error.apiResponse;
    }

    return result;
  }

  /**
   * Sleep for a specified number of milliseconds
   *
   * @private
   * @param {number} ms - Duration in milliseconds
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
      // Clear interceptors
      this.client.interceptors.request.handlers = [];
      this.client.interceptors.response.handlers = [];
    }
    this.client = null;
    this.authToken = null;
    logger.info('[MarketplaceClient] Client destroyed');
  }
}

// ==================== Singleton Support ====================

let _instance = null;

/**
 * Get or create a singleton MarketplaceClient instance
 *
 * @param {Object} [options] - Client options (only used on first call or when forceNew is true)
 * @param {boolean} [forceNew=false] - Force creation of a new instance
 * @returns {MarketplaceClient}
 */
function getMarketplaceClient(options = {}, forceNew = false) {
  if (!_instance || forceNew) {
    if (_instance) {
      _instance.destroy();
    }
    _instance = new MarketplaceClient(options);
  }
  return _instance;
}

module.exports = {
  MarketplaceClient,
  getMarketplaceClient,
};
