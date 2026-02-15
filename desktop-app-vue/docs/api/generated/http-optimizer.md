# http-optimizer

**Source**: `src/main/utils/http-optimizer.js`

**Generated**: 2026-02-15T10:10:53.358Z

---

## const

```javascript
const
```

* HTTP服务器性能优化模块
 * 优化请求处理、连接管理和响应速度

---

## checkRateLimit(clientId)

```javascript
checkRateLimit(clientId)
```

* 请求限流检查

---

## getCachedResponse(cacheKey)

```javascript
getCachedResponse(cacheKey)
```

* 响应缓存

---

## cacheResponse(cacheKey, response)

```javascript
cacheResponse(cacheKey, response)
```

* 保存响应到缓存

---

## generateCacheKey(method, path, body)

```javascript
generateCacheKey(method, path, body)
```

* 生成缓存键

---

## async compressResponse(data)

```javascript
async compressResponse(data)
```

* 响应压缩

---

## addToBatch(request)

```javascript
addToBatch(request)
```

* 批处理请求

---

## async processBatch()

```javascript
async processBatch()
```

* 处理批处理队列

---

## async processRequest(request)

```javascript
async processRequest(request)
```

* 处理单个请求（示例）

---

## acquireConnection(clientId)

```javascript
acquireConnection(clientId)
```

* 连接池管理

---

## releaseConnection(clientId)

```javascript
releaseConnection(clientId)
```

* 释放连接

---

## cleanupIdleConnections()

```javascript
cleanupIdleConnections()
```

* 清理空闲连接

---

## recordRequestTime(time, success = true)

```javascript
recordRequestTime(time, success = true)
```

* 记录请求时间

---

## getMetrics()

```javascript
getMetrics()
```

* 获取性能指标

---

## clearCache()

```javascript
clearCache()
```

* 清理缓存

---

## resetMetrics()

```javascript
resetMetrics()
```

* 重置指标

---

