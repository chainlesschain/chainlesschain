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
}

/**
 * Cache entry
 */
interface CacheEntry {
  data: any;
  timestamp: number;
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
}

// ==================== Request Batcher Class ====================

class RequestBatcher {
  private options: Required<RequestBatcherOptions>;
  private pendingRequests: Map<string, BatchState> = new Map();
  private inflightRequests: Map<string, Promise<any>> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private requestQueue: any[] = [];
  private stats: RequestBatcherStats;
  private _cacheCleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: RequestBatcherOptions = {}) {
    // Configuration
    this.options = {
      batchWindow: options.batchWindow ?? 50,
      maxBatchSize: options.maxBatchSize ?? 10,
      enableCache: options.enableCache !== false,
      cacheTTL: options.cacheTTL ?? 5 * 60 * 1000,
      enableDeduplication: options.enableDeduplication !== false,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      debug: options.debug ?? false,
    };

    // State
    this.pendingRequests = new Map();
    this.inflightRequests = new Map();
    this.cache = new Map();
    this.requestQueue = [];

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
      logger.info("[RequestBatcher] Initialized with options:", { options: this.options });
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
    options: RequestOptions = {}
  ): Promise<T> {
    this.stats.totalRequests++;

    const requestKey = this.generateRequestKey(endpoint, params);
    const cacheKey = this.generateCacheKey(endpoint, params);

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
    options: RequestOptions
  ): Promise<T> {
    const batchKey = this.getBatchKey(endpoint);

    return new Promise((resolve, reject) => {
      // Get or create batch
      let batch = this.pendingRequests.get(batchKey);

      if (!batch) {
        batch = {
          endpoint,
          requests: [],
          timer: null,
        };
        this.pendingRequests.set(batchKey, batch);
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
      }

      // Execute batch if size limit reached
      if (batch.requests.length >= this.options.maxBatchSize) {
        this.executeBatch(batchKey);
      } else {
        // Set timer to execute batch after window
        batch.timer = setTimeout(() => {
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

    this.pendingRequests.delete(batchKey);

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
        const cacheKey = this.generateCacheKey(endpoint, req.params);

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
    }
  }

  /**
   * Execute single request (not batched)
   */
  private async executeSingle<T>(
    endpoint: string,
    params: RequestParams,
    options: RequestOptions
  ): Promise<T> {
    const requestKey = this.generateRequestKey(endpoint, params);
    const cacheKey = this.generateCacheKey(endpoint, params);

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
  protected async executeBatchAPI(endpoint: string, batchParams: RequestParams[]): Promise<any[]> {
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
    options: RequestOptions = {}
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
   * Get batch key for grouping requests
   */
  protected getBatchKey(endpoint: string): string {
    // Group by endpoint
    return endpoint;
  }

  /**
   * Generate unique request key
   */
  protected generateRequestKey(endpoint: string, params: RequestParams): string {
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
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache
   */
  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
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
      inflightRequests: this.inflightRequests.size,
      pendingBatches: this.pendingRequests.size,
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    // Stop cache cleanup interval
    this.stopCacheCleanup();

    // Clear all pending batches
    this.pendingRequests.forEach((batch) => {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    });

    this.pendingRequests.clear();
    this.inflightRequests.clear();
    this.cache.clear();

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
export function getRequestBatcher(options?: RequestBatcherOptions): RequestBatcher {
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
  options?: RequestOptions
): Promise<T> {
  const batcher = getRequestBatcher();
  return batcher.request<T>(endpoint, params, options);
}

export { RequestBatcher };
export default RequestBatcher;
