import { logger } from "@/utils/logger";

/**
 * Request Batcher and Deduplication System
 * 请求批处理和去重系统
 *
 * Features:
 * - Automatic request batching (merge multiple requests into one)
 * - Request deduplication (prevent duplicate concurrent requests)
 * - Configurable batch window and size
 * - Request priority queue
 * - Cache support with TTL
 * - Retry mechanism with exponential backoff
 */

// ==================== Type Definitions ====================

/**
 * Request batcher options
 */
export interface RequestBatcherOptions {
  /** Wait time before sending batch (ms) */
  batchWindow?: number;
  /** Max requests per batch */
  maxBatchSize?: number;
  /** Enable caching */
  enableCache?: boolean;
  /** Cache time to live (ms) */
  cacheTTL?: number;
  /** Enable request deduplication */
  enableDeduplication?: boolean;
  /** Max retry attempts */
  maxRetries?: number;
  /** Retry delay (ms) */
  retryDelay?: number;
  /** Debug mode */
  debug?: boolean;
  /** Maximum distinct batches waiting for execution */
  maxPendingBatches?: number;
  /** Maximum batches executing concurrently */
  maxConcurrentBatches?: number;
  /** Maximum immediate requests executing concurrently */
  maxInflightRequests?: number;
  /** Maximum retained cache entries */
  maxCacheEntries?: number;
  /** Maximum bytes retained by one cache entry */
  maxCacheEntryBytes?: number;
  /** Maximum bytes retained by the cache */
  maxCacheBytes?: number;
  /** Maximum serialized request bytes */
  maxRequestBytes?: number;
  /** Maximum endpoint characters */
  maxEndpointChars?: number;
}

const KIB = 1024;
const MIB = 1024 * KIB;

export const DEFAULT_REQUEST_BATCHER_LIMITS = Object.freeze({
  maxBatchSize: 10,
  maxPendingBatches: 64,
  maxConcurrentBatches: 16,
  maxInflightRequests: 128,
  maxCacheEntries: 512,
  maxCacheEntryBytes: 256 * KIB,
  maxCacheBytes: 4 * MIB,
  maxRequestBytes: 64 * KIB,
  maxEndpointChars: 2048,
});

export const HARD_REQUEST_BATCHER_LIMITS = Object.freeze({
  maxBatchSize: 1000,
  maxPendingBatches: 512,
  maxConcurrentBatches: 128,
  maxInflightRequests: 1024,
  maxCacheEntries: 4096,
  maxCacheEntryBytes: MIB,
  maxCacheBytes: 32 * MIB,
  maxRequestBytes: MIB,
  maxEndpointChars: 8192,
});

export class RequestBatcherError extends Error {
  code: "OVERLOADED" | "INVALID_ARGUMENT" | "CANCELED";
  scope: string;
  retryAfterMs?: number;
  limit?: Record<string, number>;

  constructor(
    message: string,
    options: {
      code: "OVERLOADED" | "INVALID_ARGUMENT" | "CANCELED";
      scope: string;
      retryAfterMs?: number;
      limit?: Record<string, number>;
    },
  ) {
    super(message);
    this.name = "RequestBatcherError";
    this.code = options.code;
    this.scope = options.scope;
    this.retryAfterMs = options.retryAfterMs;
    this.limit = options.limit;
  }
}

function normalizedPositiveInteger(
  value: unknown,
  fallback: number,
  hardLimit: number,
): number {
  let numericValue: number;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function normalizedNonNegativeInteger(
  value: unknown,
  fallback: number,
  hardLimit: number,
): number {
  let numericValue: number;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function jsonBytes(
  value: unknown,
): { serialized: string; bytes: number } | null {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      return null;
    }
    return {
      serialized,
      bytes: new TextEncoder().encode(serialized).byteLength,
    };
  } catch {
    return null;
  }
}

/**
 * Request parameters
 */
export interface RequestParams {
  [key: string]: any;
}

/**
 * Request options
 */
export interface RequestOptions {
  /** Skip cache lookup */
  skipCache?: boolean;
  /** Skip deduplication */
  skipDeduplication?: boolean;
  /** Enable batching */
  enableBatching?: boolean;
  /** HTTP method */
  method?: string;
  /** HTTP headers */
  headers?: Record<string, string>;
}

/**
 * Pending request
 */
interface PendingRequest {
  params: RequestParams;
  options: RequestOptions;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

/**
 * Batch state
 */
interface BatchState {
  endpoint: string;
  requests: PendingRequest[];
  timer: ReturnType<typeof setTimeout> | null;
  ready: boolean;
}

/**
 * Cache entry
 */
interface CacheEntry {
  data: any;
  timestamp: number;
  bytes: number;
}

/**
 * Request batcher statistics
 */
export interface RequestBatcherStats {
  totalRequests: number;
  batchedRequests: number;
  cachedRequests: number;
  deduplicatedRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  bandwidthSaved: number;
}

/**
 * Extended statistics with computed values
 */
export interface ExtendedStats extends RequestBatcherStats {
  completedRequests: number;
  batchRate: string;
  cacheHitRate: string;
  bandwidthSavedKB: number;
  cacheSize: number;
  inflightRequests: number;
  pendingBatches: number;
  activeBatches: number;
  cacheBytes: number;
}

// ==================== Request Batcher Class ====================

class RequestBatcher {
  private options: Required<RequestBatcherOptions>;
  private pendingRequests: Map<string, BatchState> = new Map();
  private inflightRequests: Map<string, Promise<any>> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private cacheBytes = 0;
  private activeBatches = 0;
  private destroyed = false;
  private stats: RequestBatcherStats;
  private _cacheCleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: RequestBatcherOptions = {}) {
    const maxCacheBytes = normalizedPositiveInteger(
      options.maxCacheBytes,
      DEFAULT_REQUEST_BATCHER_LIMITS.maxCacheBytes,
      HARD_REQUEST_BATCHER_LIMITS.maxCacheBytes,
    );
    // Configuration
    this.options = {
      batchWindow: normalizedNonNegativeInteger(
        options.batchWindow,
        50,
        60 * 1000,
      ),
      maxBatchSize: normalizedPositiveInteger(
        options.maxBatchSize,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxBatchSize,
        HARD_REQUEST_BATCHER_LIMITS.maxBatchSize,
      ),
      enableCache: options.enableCache !== false,
      cacheTTL: normalizedNonNegativeInteger(
        options.cacheTTL,
        5 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
      enableDeduplication: options.enableDeduplication !== false,
      maxRetries: normalizedNonNegativeInteger(options.maxRetries, 3, 10),
      retryDelay: normalizedNonNegativeInteger(
        options.retryDelay,
        1000,
        60 * 1000,
      ),
      debug: options.debug ?? false,
      maxPendingBatches: normalizedPositiveInteger(
        options.maxPendingBatches,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxPendingBatches,
        HARD_REQUEST_BATCHER_LIMITS.maxPendingBatches,
      ),
      maxConcurrentBatches: normalizedPositiveInteger(
        options.maxConcurrentBatches,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxConcurrentBatches,
        HARD_REQUEST_BATCHER_LIMITS.maxConcurrentBatches,
      ),
      maxInflightRequests: normalizedPositiveInteger(
        options.maxInflightRequests,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxInflightRequests,
        HARD_REQUEST_BATCHER_LIMITS.maxInflightRequests,
      ),
      maxCacheEntries: normalizedPositiveInteger(
        options.maxCacheEntries,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxCacheEntries,
        HARD_REQUEST_BATCHER_LIMITS.maxCacheEntries,
      ),
      maxCacheEntryBytes: Math.min(
        maxCacheBytes,
        normalizedPositiveInteger(
          options.maxCacheEntryBytes,
          DEFAULT_REQUEST_BATCHER_LIMITS.maxCacheEntryBytes,
          HARD_REQUEST_BATCHER_LIMITS.maxCacheEntryBytes,
        ),
      ),
      maxCacheBytes,
      maxRequestBytes: normalizedPositiveInteger(
        options.maxRequestBytes,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxRequestBytes,
        HARD_REQUEST_BATCHER_LIMITS.maxRequestBytes,
      ),
      maxEndpointChars: normalizedPositiveInteger(
        options.maxEndpointChars,
        DEFAULT_REQUEST_BATCHER_LIMITS.maxEndpointChars,
        HARD_REQUEST_BATCHER_LIMITS.maxEndpointChars,
      ),
    };

    // State
    this.pendingRequests = new Map();
    this.inflightRequests = new Map();
    this.cache = new Map();
    this.cacheBytes = 0;
    this.activeBatches = 0;
    this.destroyed = false;

    // Statistics
    this.stats = {
      totalRequests: 0,
      batchedRequests: 0,
      cachedRequests: 0,
      deduplicatedRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      bandwidthSaved: 0,
    };

    // Cache cleanup interval ID
    this._cacheCleanupIntervalId = null;

    // Start cache cleanup
    this.startCacheCleanup();

    if (this.options.debug) {
      logger.info("[RequestBatcher] Initialized with options:", {
        options: this.options,
      });
    }
  }

  /**
   * Make a request (with batching and deduplication)
   * @param endpoint - API endpoint
   * @param params - Request parameters
   * @param options - Additional options
   * @returns Response data
   */
  async request<T = any>(
    endpoint: string,
    params: RequestParams = {},
    options: RequestOptions = {},
  ): Promise<T> {
    if (this.destroyed) {
      throw new RequestBatcherError("Request batcher is destroyed", {
        code: "CANCELED",
        scope: "request_batcher",
      });
    }
    const normalized = this.normalizeRequest(endpoint, params, options);
    endpoint = normalized.endpoint;
    params = normalized.params;
    options = normalized.options;
    this.stats.totalRequests++;

    const requestKey = this.validateRetainedKey(
      this.generateRequestKey(endpoint, params),
      "request_key",
    );
    const cacheKey = this.validateRetainedKey(
      this.generateCacheKey(endpoint, params),
      "request_cache_key",
    );

    // 1. Check cache
    if (this.options.enableCache && !options.skipCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached !== null) {
        this.stats.cachedRequests++;
        if (this.options.debug) {
          logger.info(`[RequestBatcher] Cache hit: ${endpoint}`);
        }
        return cached as T;
      }
    }

    // 2. Deduplication: check if same request is already in flight
    if (this.options.enableDeduplication && !options.skipDeduplication) {
      const inflight = this.inflightRequests.get(requestKey);
      if (inflight) {
        this.stats.deduplicatedRequests++;
        if (this.options.debug) {
          logger.info(`[RequestBatcher] Deduplicated: ${endpoint}`);
        }
        return inflight as Promise<T>;
      }
    }

    // 3. Batching: add to batch queue
    if (options.enableBatching !== false && this.isBatchable(endpoint)) {
      return this.addToBatch<T>(endpoint, params, options);
    }

    // 4. Execute immediately (not batchable)
    return this.executeSingle<T>(endpoint, params, options);
  }

  /**
   * Add request to batch queue
   */
  private addToBatch<T>(
    endpoint: string,
    params: RequestParams,
    options: RequestOptions,
  ): Promise<T> {
    const batchKey = this.validateRetainedKey(
      this.getBatchKey(endpoint),
      "request_batch_key",
    );

    return new Promise((resolve, reject) => {
      // Get or create batch
      let batch = this.pendingRequests.get(batchKey);

      if (!batch) {
        if (this.pendingRequests.size >= this.options.maxPendingBatches) {
          this.stats.failedRequests++;
          reject(
            new RequestBatcherError("Pending batch capacity exceeded", {
              code: "OVERLOADED",
              scope: "request_batches",
              retryAfterMs: this.options.batchWindow || 1,
              limit: {
                maxPendingBatches: this.options.maxPendingBatches,
              },
            }),
          );
          return;
        }
        batch = {
          endpoint,
          requests: [],
          timer: null,
          ready: false,
        };
        this.pendingRequests.set(batchKey, batch);
      }

      if (batch.requests.length >= this.options.maxBatchSize) {
        this.stats.failedRequests++;
        reject(
          new RequestBatcherError("Request batch capacity exceeded", {
            code: "OVERLOADED",
            scope: "request_batch",
            retryAfterMs: this.options.batchWindow || 1,
            limit: { maxBatchSize: this.options.maxBatchSize },
          }),
        );
        return;
      }

      // Add request to batch
      batch.requests.push({
        params,
        options,
        resolve,
        reject,
      });

      // Clear existing timer
      if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }

      // Execute batch if size limit reached
      if (batch.requests.length >= this.options.maxBatchSize) {
        batch.ready = true;
        this.executeBatch(batchKey);
      } else {
        // Set timer to execute batch after window
        batch.timer = setTimeout(() => {
          batch.timer = null;
          batch.ready = true;
          this.executeBatch(batchKey);
        }, this.options.batchWindow);
      }
    });
  }

  /**
   * Execute a batch of requests
   */
  private async executeBatch(batchKey: string): Promise<void> {
    const batch = this.pendingRequests.get(batchKey);
    if (!batch || batch.requests.length === 0) {
      return;
    }

    if (this.activeBatches >= this.options.maxConcurrentBatches) {
      if (!batch.timer) {
        batch.timer = setTimeout(
          () => {
            batch.timer = null;
            this.executeBatch(batchKey);
          },
          Math.max(1, this.options.batchWindow),
        );
      }
      return;
    }

    this.pendingRequests.delete(batchKey);
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    this.activeBatches++;

    const { endpoint, requests } = batch;
    const batchSize = requests.length;

    this.stats.batchedRequests += batchSize;

    if (this.options.debug) {
      logger.info(
        `[RequestBatcher] Executing batch: ${endpoint} (${batchSize} requests)`,
      );
    }

    try {
      // Build batch request payload
      const batchParams = requests.map((r) => r.params);

      // Execute batch API call
      const startTime = performance.now();
      const results = await this.executeBatchAPI(endpoint, batchParams);
      const responseTime = performance.now() - startTime;

      this.updateAverageResponseTime(responseTime);

      // Estimate bandwidth saved (1 batch request vs N individual requests)
      this.stats.bandwidthSaved += this.estimateBandwidthSaved(batchSize);

      // Resolve individual promises
      requests.forEach((req, index) => {
        const result = results[index];
        const cacheKey = this.validateRetainedKey(
          this.generateCacheKey(endpoint, req.params),
          "request_cache_key",
        );

        // Cache result
        if (this.options.enableCache && !req.options.skipCache) {
          this.setCache(cacheKey, result);
        }

        req.resolve(result);
      });

      if (this.options.debug) {
        logger.info(
          `[RequestBatcher] Batch completed: ${endpoint} (${Math.round(responseTime)}ms)`,
        );
      }
    } catch (error) {
      logger.error(`[RequestBatcher] Batch failed: ${endpoint}`, { error });
      this.stats.failedRequests += batchSize;

      // Reject all promises
      requests.forEach((req) => {
        req.reject(error);
      });
    } finally {
      this.activeBatches--;
      for (const [pendingKey, pendingBatch] of [
        ...this.pendingRequests.entries(),
      ]) {
        if (this.activeBatches >= this.options.maxConcurrentBatches) {
          break;
        }
        if (pendingBatch.ready) {
          this.executeBatch(pendingKey);
        }
      }
    }
  }

  /**
   * Execute single request (not batched)
   */
  private async executeSingle<T>(
    endpoint: string,
    params: RequestParams,
    options: RequestOptions,
  ): Promise<T> {
    if (this.inflightRequests.size >= this.options.maxInflightRequests) {
      this.stats.failedRequests++;
      throw new RequestBatcherError("In-flight request capacity exceeded", {
        code: "OVERLOADED",
        scope: "request_inflight",
        retryAfterMs: 1000,
        limit: {
          maxInflightRequests: this.options.maxInflightRequests,
        },
      });
    }
    const requestKey = this.validateRetainedKey(
      this.generateRequestKey(endpoint, params),
      "request_key",
    );
    const cacheKey = this.validateRetainedKey(
      this.generateCacheKey(endpoint, params),
      "request_cache_key",
    );

    const startTime = performance.now();

    // Create promise for this request
    const requestPromise = (async () => {
      try {
        // Execute API call
        const result = await this.executeAPI(endpoint, params, options);
        const responseTime = performance.now() - startTime;

        this.updateAverageResponseTime(responseTime);

        // Cache result
        if (this.options.enableCache && !options.skipCache) {
          this.setCache(cacheKey, result);
        }

        return result;
      } catch (error) {
        this.stats.failedRequests++;
        throw error;
      } finally {
        this.inflightRequests.delete(requestKey);
      }
    })();

    // Track inflight request
    this.inflightRequests.set(requestKey, requestPromise);

    return requestPromise as Promise<T>;
  }

  /**
   * Execute batch API call (override this method)
   */
  protected async executeBatchAPI(
    endpoint: string,
    batchParams: RequestParams[],
  ): Promise<any[]> {
    // Default implementation: call individual APIs in parallel
    // Override this method to implement actual batch API
    const results = await Promise.all(
      batchParams.map((params) => this.executeAPI(endpoint, params)),
    );
    return results;
  }

  /**
   * Execute single API call (override this method)
   */
  protected async executeAPI(
    endpoint: string,
    params: RequestParams,
    options: RequestOptions = {},
  ): Promise<any> {
    // Default implementation using fetch
    // Override this method to use your API client (axios, etc.)
    const url = new URL(endpoint, window.location.origin);

    Object.keys(params).forEach((key) => {
      url.searchParams.append(key, String(params[key]));
    });

    const response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers: options.headers || {},
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check if endpoint supports batching
   */
  protected isBatchable(endpoint: string): boolean {
    // Default: all GET requests are batchable
    // Override this method for custom logic
    return true;
  }

  /**
   * Validate and detach request data before retaining it in a queue or map.
   */
  private normalizeRequest(
    endpoint: unknown,
    params: RequestParams,
    options: RequestOptions,
  ): {
    endpoint: string;
    params: RequestParams;
    options: RequestOptions;
  } {
    const normalizedEndpoint = String(endpoint ?? "");
    if (normalizedEndpoint.length > this.options.maxEndpointChars) {
      throw new RequestBatcherError("Endpoint is too long", {
        code: "INVALID_ARGUMENT",
        scope: "request_endpoint",
        limit: { maxEndpointChars: this.options.maxEndpointChars },
      });
    }
    const payload = jsonBytes({
      endpoint: normalizedEndpoint,
      params,
      options,
    });
    if (!payload) {
      throw new RequestBatcherError("Request payload is not serializable", {
        code: "INVALID_ARGUMENT",
        scope: "request_payload",
        limit: { maxRequestBytes: this.options.maxRequestBytes },
      });
    }
    if (payload.bytes > this.options.maxRequestBytes) {
      throw new RequestBatcherError("Request payload is too large", {
        code: "INVALID_ARGUMENT",
        scope: "request_payload",
        limit: { maxRequestBytes: this.options.maxRequestBytes },
      });
    }
    const detached = JSON.parse(payload.serialized) as {
      endpoint: string;
      params?: RequestParams;
      options?: RequestOptions;
    };
    return {
      endpoint: detached.endpoint,
      params: detached.params || {},
      options: detached.options || {},
    };
  }

  /**
   * Get batch key for grouping requests
   */
  protected getBatchKey(endpoint: string): string {
    // Group by endpoint
    return endpoint;
  }

  private validateRetainedKey(value: unknown, scope: string): string {
    const key = String(value ?? "");
    if (
      new TextEncoder().encode(key).byteLength > this.options.maxRequestBytes
    ) {
      throw new RequestBatcherError("Request key is too large", {
        code: "INVALID_ARGUMENT",
        scope,
        limit: { maxRequestBytes: this.options.maxRequestBytes },
      });
    }
    return key;
  }

  /**
   * Generate unique request key
   */
  protected generateRequestKey(
    endpoint: string,
    params: RequestParams,
  ): string {
    return `${endpoint}:${JSON.stringify(params)}`;
  }

  /**
   * Generate cache key
   */
  protected generateCacheKey(endpoint: string, params: RequestParams): string {
    return this.generateRequestKey(endpoint, params);
  }

  /**
   * Get from cache
   */
  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;

    if (age > this.options.cacheTTL) {
      this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes);
      this.cache.delete(key);
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    return JSON.parse(JSON.stringify(entry.data));
  }

  /**
   * Set cache
   */
  private setCache(key: string, data: any): void {
    if (this.destroyed) {
      return;
    }
    const encoded = jsonBytes(data);
    const retainedBytes =
      (encoded?.bytes || 0) + new TextEncoder().encode(key).byteLength;
    if (
      !encoded ||
      retainedBytes > this.options.maxCacheEntryBytes ||
      retainedBytes > this.options.maxCacheBytes
    ) {
      return;
    }
    const existing = this.cache.get(key);
    if (existing) {
      this.cacheBytes = Math.max(0, this.cacheBytes - existing.bytes);
      this.cache.delete(key);
    }
    while (
      this.cache.size >= this.options.maxCacheEntries ||
      this.cacheBytes + retainedBytes > this.options.maxCacheBytes
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.cacheBytes = Math.max(0, this.cacheBytes - (oldest?.bytes || 0));
    }
    this.cache.set(key, {
      data: JSON.parse(encoded.serialized),
      timestamp: Date.now(),
      bytes: retainedBytes,
    });
    this.cacheBytes += retainedBytes;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    if (this.options.debug) {
      logger.info("[RequestBatcher] Cache cleared");
    }
  }

  /**
   * Start cache cleanup interval
   */
  private startCacheCleanup(): void {
    if (this._cacheCleanupIntervalId) {
      clearInterval(this._cacheCleanupIntervalId);
    }
    this._cacheCleanupIntervalId = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.options.cacheTTL) {
          this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes);
          this.cache.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0 && this.options.debug) {
        logger.info(
          `[RequestBatcher] Cleaned ${cleaned} expired cache entries`,
        );
      }
    }, 60 * 1000); // Clean every minute
  }

  /**
   * Stop cache cleanup interval
   */
  stopCacheCleanup(): void {
    if (this._cacheCleanupIntervalId) {
      clearInterval(this._cacheCleanupIntervalId);
      this._cacheCleanupIntervalId = null;
    }
  }

  /**
   * Estimate bandwidth saved
   */
  private estimateBandwidthSaved(batchSize: number): number {
    // Rough estimate: each individual request has ~500 bytes overhead
    // Batching saves (N-1) * overhead
    const overheadPerRequest = 500;
    return (batchSize - 1) * overheadPerRequest;
  }

  /**
   * Update average response time
   */
  private updateAverageResponseTime(newTime: number): void {
    const totalCompleted = this.stats.totalRequests - this.stats.failedRequests;
    if (totalCompleted <= 0) {
      this.stats.averageResponseTime = newTime;
    } else {
      this.stats.averageResponseTime =
        (this.stats.averageResponseTime * (totalCompleted - 1) + newTime) /
        totalCompleted;
    }
  }

  /**
   * Get statistics
   */
  getStats(): ExtendedStats {
    const completed = this.stats.totalRequests - this.stats.failedRequests;
    const batchRate =
      this.stats.totalRequests > 0
        ? Math.round(
            (this.stats.batchedRequests / this.stats.totalRequests) * 100,
          )
        : 0;
    const cacheHitRate =
      this.stats.totalRequests > 0
        ? Math.round(
            (this.stats.cachedRequests / this.stats.totalRequests) * 100,
          )
        : 0;

    return {
      ...this.stats,
      completedRequests: completed,
      batchRate: `${batchRate}%`,
      cacheHitRate: `${cacheHitRate}%`,
      bandwidthSavedKB: Math.round(this.stats.bandwidthSaved / 1024),
      cacheSize: this.cache.size,
      cacheBytes: this.cacheBytes,
      inflightRequests: this.inflightRequests.size,
      pendingBatches: this.pendingRequests.size,
      activeBatches: this.activeBatches,
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    // Stop cache cleanup interval
    this.stopCacheCleanup();

    // Clear all pending batches
    this.pendingRequests.forEach((batch) => {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
      const error = new RequestBatcherError("Request batcher was destroyed", {
        code: "CANCELED",
        scope: "request_batcher",
      });
      batch.requests.forEach((request) => request.reject(error));
    });

    this.pendingRequests.clear();
    this.inflightRequests.clear();
    this.cache.clear();
    this.cacheBytes = 0;

    if (this.options.debug) {
      logger.info("[RequestBatcher] Destroyed");
    }
  }
}

// Singleton instance
let batcherInstance: RequestBatcher | null = null;

/**
 * Get or create request batcher instance
 */
export function getRequestBatcher(
  options?: RequestBatcherOptions,
): RequestBatcher {
  if (!batcherInstance) {
    batcherInstance = new RequestBatcher(options);
  }
  return batcherInstance;
}

/**
 * Convenience function: make a batched request
 */
export async function batchedRequest<T = any>(
  endpoint: string,
  params?: RequestParams,
  options?: RequestOptions,
): Promise<T> {
  const batcher = getRequestBatcher();
  return batcher.request<T>(endpoint, params, options);
}

export { RequestBatcher };
export default RequestBatcher;
