# request-batcher

**Source**: `src\renderer\utils\request-batcher.js`

**Generated**: 2026-01-27T06:44:03.895Z

---

## class RequestBatcher

```javascript
class RequestBatcher
```

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

---

## async request(endpoint, params =

```javascript
async request(endpoint, params =
```

* Make a request (with batching and deduplication)
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Request parameters
   * @param {Object} options - Additional options
   * @returns {Promise} Response data

---

## addToBatch(endpoint, params, options)

```javascript
addToBatch(endpoint, params, options)
```

* Add request to batch queue

---

## async executeBatch(batchKey)

```javascript
async executeBatch(batchKey)
```

* Execute a batch of requests

---

## async executeSingle(endpoint, params, options)

```javascript
async executeSingle(endpoint, params, options)
```

* Execute single request (not batched)

---

## async executeBatchAPI(endpoint, batchParams)

```javascript
async executeBatchAPI(endpoint, batchParams)
```

* Execute batch API call (override this method)

---

## async executeAPI(endpoint, params, options =

```javascript
async executeAPI(endpoint, params, options =
```

* Execute single API call (override this method)

---

## isBatchable(endpoint)

```javascript
isBatchable(endpoint)
```

* Check if endpoint supports batching

---

## getBatchKey(endpoint)

```javascript
getBatchKey(endpoint)
```

* Get batch key for grouping requests

---

## generateRequestKey(endpoint, params)

```javascript
generateRequestKey(endpoint, params)
```

* Generate unique request key

---

## generateCacheKey(endpoint, params)

```javascript
generateCacheKey(endpoint, params)
```

* Generate cache key

---

## getFromCache(key)

```javascript
getFromCache(key)
```

* Get from cache

---

## setCache(key, data)

```javascript
setCache(key, data)
```

* Set cache

---

## clearCache()

```javascript
clearCache()
```

* Clear cache

---

## startCacheCleanup()

```javascript
startCacheCleanup()
```

* Start cache cleanup interval

---

## stopCacheCleanup()

```javascript
stopCacheCleanup()
```

* Stop cache cleanup interval

---

## estimateBandwidthSaved(batchSize)

```javascript
estimateBandwidthSaved(batchSize)
```

* Estimate bandwidth saved

---

## updateAverageResponseTime(newTime)

```javascript
updateAverageResponseTime(newTime)
```

* Update average response time

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## destroy()

```javascript
destroy()
```

* Destroy and cleanup

---

## export function getRequestBatcher(options)

```javascript
export function getRequestBatcher(options)
```

* Get or create request batcher instance

---

## export async function batchedRequest(endpoint, params, options)

```javascript
export async function batchedRequest(endpoint, params, options)
```

* Convenience function: make a batched request

---

