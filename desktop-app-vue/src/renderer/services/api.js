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

import { getRequestBatcher } from '@/utils/request-batcher'
import { compress, decompress } from '@/utils/data-compression'

// Get request batcher instance
const batcher = getRequestBatcher({
  batchWindow: 50,
  maxBatchSize: 10,
  enableCache: true,
  enableDeduplication: true,
})

/**
 * Request configuration
 */
const DEFAULT_CONFIG = {
  timeout: 30000,
  compressionThreshold: 10 * 1024, // 10KB
  retryAttempts: 3,
  retryDelay: 1000,
}

/**
 * API base URL
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

/**
 * Unified API request method
 * 统一的API请求方法
 *
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Request parameters
 * @param {Object} options - Request options
 * @returns {Promise<any>}
 */
export async function apiRequest(endpoint, params = {}, options = {}) {
  const {
    method = 'GET',
    enableBatching = true,
    enableCompression = true,
    enableCache = true,
    timeout = DEFAULT_CONFIG.timeout,
    headers = {},
    ...otherOptions
  } = options

  // Use batching for GET requests
  if (enableBatching && method === 'GET') {
    return batcher.request(endpoint, params, {
      enableCache,
      ...otherOptions,
    })
  }

  // Prepare request body
  let body = params
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  }

  // Compress large payloads
  if (enableCompression && method !== 'GET') {
    const jsonString = JSON.stringify(params)

    if (jsonString.length > DEFAULT_CONFIG.compressionThreshold) {
      console.log(
        `[API] Compressing request (${jsonString.length} bytes -> `,
        'compression enabled)'
      )

      body = await compress(jsonString, { base64: true })
      requestHeaders['Content-Encoding'] = 'gzip'
      requestHeaders['X-Original-Size'] = jsonString.length
    } else {
      body = jsonString
    }
  } else if (method !== 'GET') {
    body = JSON.stringify(params)
  }

  // Make request with timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: method !== 'GET' ? body : undefined,
      signal: controller.signal,
      ...otherOptions,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Check if response is compressed
    const contentEncoding = response.headers.get('Content-Encoding')

    if (contentEncoding === 'gzip' && enableCompression) {
      const compressedData = await response.text()
      const decompressedData = await decompress(compressedData, { fromBase64: true })

      console.log(
        '[API] Decompressed response:',
        compressedData.length,
        '->',
        decompressedData.length,
        'bytes'
      )

      return JSON.parse(decompressedData)
    }

    // Parse JSON response
    const contentType = response.headers.get('Content-Type')
    if (contentType && contentType.includes('application/json')) {
      return response.json()
    }

    return response.text()
  } catch (error) {
    clearTimeout(timeoutId)

    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`)
    }

    throw error
  }
}

/**
 * GET request
 */
export async function get(url, params, options) {
  return apiRequest(url, params, { method: 'GET', ...options })
}

/**
 * POST request
 */
export async function post(url, data, options) {
  return apiRequest(url, data, { method: 'POST', ...options })
}

/**
 * PUT request
 */
export async function put(url, data, options) {
  return apiRequest(url, data, { method: 'PUT', ...options })
}

/**
 * DELETE request
 */
export async function del(url, params, options) {
  return apiRequest(url, params, { method: 'DELETE', ...options })
}

/**
 * PATCH request
 */
export async function patch(url, data, options) {
  return apiRequest(url, data, { method: 'PATCH', ...options })
}

/**
 * Batch multiple requests
 * 批量请求
 *
 * @param {Array} requests - Array of request configs
 * @returns {Promise<Array>}
 */
export async function batchRequests(requests) {
  const promises = requests.map(({ endpoint, params, options }) =>
    apiRequest(endpoint, params, options)
  )

  return Promise.all(promises)
}

/**
 * Retry request with exponential backoff
 * 重试请求（指数退避）
 *
 * @param {Function} requestFn - Request function
 * @param {number} attempts - Max retry attempts
 * @returns {Promise<any>}
 */
export async function retryRequest(requestFn, attempts = DEFAULT_CONFIG.retryAttempts) {
  let lastError

  for (let i = 0; i < attempts; i++) {
    try {
      return await requestFn()
    } catch (error) {
      lastError = error

      if (i < attempts - 1) {
        // Exponential backoff: 1s, 2s, 4s, 8s...
        const delay = DEFAULT_CONFIG.retryDelay * Math.pow(2, i)
        console.log(`[API] Retry attempt ${i + 1}/${attempts} after ${delay}ms`)

        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * Request interceptor
 * 请求拦截器
 */
const requestInterceptors = []

export function addRequestInterceptor(interceptor) {
  requestInterceptors.push(interceptor)
}

export function removeRequestInterceptor(interceptor) {
  const index = requestInterceptors.indexOf(interceptor)
  if (index > -1) {
    requestInterceptors.splice(index, 1)
  }
}

/**
 * Response interceptor
 * 响应拦截器
 */
const responseInterceptors = []

export function addResponseInterceptor(interceptor) {
  responseInterceptors.push(interceptor)
}

export function removeResponseInterceptor(interceptor) {
  const index = responseInterceptors.indexOf(interceptor)
  if (index > -1) {
    responseInterceptors.splice(index, 1)
  }
}

/**
 * Get request statistics
 * 获取请求统计
 */
export function getRequestStats() {
  return batcher.getStats()
}

/**
 * Clear request cache
 * 清空请求缓存
 */
export function clearCache() {
  batcher.clearCache()
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
}
