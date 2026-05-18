/**
 * Unified API Service Layer
 * 统一API服务层
 *
 * Features:
 * - Automatic request batching
 * - Data compression for large payloads
 * - Request deduplication
 * - Intelligent caching
 * - Error handling
 * - Request/Response interceptors
 */

import { logger } from '@/utils/logger';
import { getRequestBatcher } from '@/utils/request-batcher';
import { compress, decompress } from '@/utils/data-compression';

// Type definitions
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: HttpMethod;
  enableBatching?: boolean;
  enableCompression?: boolean;
  enableCache?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface BatchRequest {
  endpoint: string;
  params?: Record<string, unknown>;
  options?: ApiRequestOptions;
}

export type RequestInterceptor = (
  endpoint: string,
  params: Record<string, unknown>,
  options: ApiRequestOptions
) => Promise<{ endpoint: string; params: Record<string, unknown>; options: ApiRequestOptions }> | { endpoint: string; params: Record<string, unknown>; options: ApiRequestOptions };

export type ResponseInterceptor = <T>(response: T) => Promise<T> | T;

export interface RequestStats {
  totalRequests: number;
  cachedRequests: number;
  batchedRequests: number;
  averageResponseTime: number;
}

// Get request batcher instance
const batcher = getRequestBatcher({
  batchWindow: 50,
  maxBatchSize: 10,
  enableCache: true,
  enableDeduplication: true,
});

/**
 * Request configuration
 */
const DEFAULT_CONFIG = {
  timeout: 30000,
  compressionThreshold: 10 * 1024, // 10KB
  retryAttempts: 3,
  retryDelay: 1000,
} as const;

/**
 * API base URL
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Unified API request method
 * 统一的API请求方法
 */
export async function apiRequest<T = unknown>(
  endpoint: string,
  params: Record<string, unknown> = {},
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    enableBatching = true,
    enableCompression = true,
    enableCache = true,
    timeout = DEFAULT_CONFIG.timeout,
    headers = {},
    ...otherOptions
  } = options;

  // Use batching for GET requests
  if (enableBatching && method === 'GET') {
    return batcher.request(endpoint, params, {
      skipCache: !enableCache,
      ...otherOptions,
    }) as Promise<T>;
  }

  // Prepare request body
  let body: string | undefined;
  const requestHeaders: Record<string, string | number> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  // Compress large payloads
  if (enableCompression && method !== 'GET') {
    const jsonString = JSON.stringify(params);

    if (jsonString.length > DEFAULT_CONFIG.compressionThreshold) {
      logger.info('[API] Compressing request', {
        originalSize: jsonString.length,
      });

      const compressedPayload = await compress(jsonString, { base64: true });
      body = typeof compressedPayload === 'string' ? compressedPayload : new TextDecoder().decode(compressedPayload);
      requestHeaders['Content-Encoding'] = 'gzip';
      requestHeaders['X-Original-Size'] = jsonString.length;
    } else {
      body = jsonString;
    }
  } else if (method !== 'GET') {
    body = JSON.stringify(params);
  }

  // Make request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: requestHeaders as HeadersInit,
      body: method !== 'GET' ? body : undefined,
      signal: controller.signal,
      ...otherOptions,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check if response is compressed
    const contentEncoding = response.headers.get('Content-Encoding');

    if (contentEncoding === 'gzip' && enableCompression) {
      const compressedData = await response.text();
      const decompressedData = await decompress(compressedData, { fromBase64: true });
      const decompressedText =
        typeof decompressedData === 'string' ? decompressedData : new TextDecoder().decode(decompressedData);

      logger.info('[API] Decompressed response', {
        compressedSize: compressedData.length,
        decompressedSize: decompressedText.length,
      });

      return JSON.parse(decompressedText) as T;
    }

    // Parse JSON response
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    return (await response.text()) as unknown as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * GET request
 */
export async function get<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(url, params, { method: 'GET', ...options });
}

/**
 * POST request
 */
export async function post<T = unknown>(
  url: string,
  data?: Record<string, unknown>,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(url, data, { method: 'POST', ...options });
}

/**
 * PUT request
 */
export async function put<T = unknown>(
  url: string,
  data?: Record<string, unknown>,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(url, data, { method: 'PUT', ...options });
}

/**
 * DELETE request
 */
export async function del<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(url, params, { method: 'DELETE', ...options });
}

/**
 * PATCH request
 */
export async function patch<T = unknown>(
  url: string,
  data?: Record<string, unknown>,
  options?: ApiRequestOptions
): Promise<T> {
  return apiRequest<T>(url, data, { method: 'PATCH', ...options });
}

/**
 * Batch multiple requests
 * 批量请求
 */
export async function batchRequests<T = unknown>(requests: BatchRequest[]): Promise<T[]> {
  const promises = requests.map(({ endpoint, params, options }) => apiRequest<T>(endpoint, params, options));

  return Promise.all(promises);
}

/**
 * Retry request with exponential backoff
 * 重试请求（指数退避）
 */
export async function retryRequest<T>(
  requestFn: () => Promise<T>,
  attempts: number = DEFAULT_CONFIG.retryAttempts
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error as Error;

      if (i < attempts - 1) {
        // Exponential backoff: 1s, 2s, 4s, 8s...
        const delay = DEFAULT_CONFIG.retryDelay * Math.pow(2, i);
        logger.info(`[API] Retry attempt ${i + 1}/${attempts} after ${delay}ms`);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Request interceptor
 * 请求拦截器
 */
const requestInterceptors: RequestInterceptor[] = [];

export function addRequestInterceptor(interceptor: RequestInterceptor): void {
  requestInterceptors.push(interceptor);
}

export function removeRequestInterceptor(interceptor: RequestInterceptor): void {
  const index = requestInterceptors.indexOf(interceptor);
  if (index > -1) {
    requestInterceptors.splice(index, 1);
  }
}

/**
 * Response interceptor
 * 响应拦截器
 */
const responseInterceptors: ResponseInterceptor[] = [];

export function addResponseInterceptor(interceptor: ResponseInterceptor): void {
  responseInterceptors.push(interceptor);
}

export function removeResponseInterceptor(interceptor: ResponseInterceptor): void {
  const index = responseInterceptors.indexOf(interceptor);
  if (index > -1) {
    responseInterceptors.splice(index, 1);
  }
}

/**
 * Get request statistics
 * 获取请求统计
 */
export function getRequestStats(): RequestStats {
  return batcher.getStats();
}

/**
 * Clear request cache
 * 清空请求缓存
 */
export function clearCache(): void {
  batcher.clearCache();
}

/**
 * Export default API object
 */
export default {
  request: apiRequest,
  get,
  post,
  put,
  delete: del,
  patch,
  batch: batchRequests,
  retry: retryRequest,
  getStats: getRequestStats,
  clearCache,
  addRequestInterceptor,
  removeRequestInterceptor,
  addResponseInterceptor,
  removeResponseInterceptor,
};
