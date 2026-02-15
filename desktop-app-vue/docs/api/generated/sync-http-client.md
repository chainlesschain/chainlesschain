# sync-http-client

**Source**: `src/main/sync/sync-http-client.js`

**Generated**: 2026-02-15T07:37:13.772Z

---

## class SyncHTTPClient

```javascript
class SyncHTTPClient
```

* 同步 HTTP 客户端
 * 扩展自 ProjectHTTPClient，提供数据同步相关的 API调用

---

## generateRequestId()

```javascript
generateRequestId()
```

* 生成唯一请求ID
   * 用于幂等性保护
   * @returns {string} UUID格式的请求ID

---

## async getServerTime()

```javascript
async getServerTime()
```

* 获取服务器时间
   * 用于客户端时间同步，解决时间戳偏差问题
   * @returns {Promise<Object>} 服务器时间信息 { timestamp, timezone, iso8601 }

---

## async uploadBatch(tableName, records, deviceId, requestId = null)

```javascript
async uploadBatch(tableName, records, deviceId, requestId = null)
```

* 批量上传数据
   * @param {string} tableName - 表名
   * @param {Array} records - 记录列表
   * @param {string} deviceId - 设备ID
   * @param {string} requestId - 可选的请求ID，用于幂等性保护
   * @returns {Promise<Object>} 上传结果

---

## async downloadIncremental(tableName, lastSyncedAt, deviceId)

```javascript
async downloadIncremental(tableName, lastSyncedAt, deviceId)
```

* 增量下载数据
   * @param {string} tableName - 表名
   * @param {number} lastSyncedAt - 最后同步时间戳（毫秒）
   * @param {string} deviceId - 设备ID
   * @returns {Promise<Object>} 增量数据

---

## async getSyncStatus(deviceId)

```javascript
async getSyncStatus(deviceId)
```

* 获取同步状态
   * @param {string} deviceId - 设备ID
   * @returns {Promise<Object>} 同步状态

---

## async resolveConflict(conflictId, resolution, selectedVersion)

```javascript
async resolveConflict(conflictId, resolution, selectedVersion)
```

* 解决冲突
   * @param {string} conflictId - 冲突ID
   * @param {string} resolution - 解决策略 (local/remote/manual)
   * @param {Object} selectedVersion - 选择的版本数据
   * @returns {Promise<void>}

---

## async health()

```javascript
async health()
```

* 健康检查
   * @returns {Promise<Object>} 健康状态

---

## setAuthToken(token)

```javascript
setAuthToken(token)
```

* 设置授权Token
   * @param {string} token - JWT token

---

## hasAuthToken()

```javascript
hasAuthToken()
```

* 检查是否已设置授权Token
   * @returns {boolean}

---

## setBaseURL(newBaseURL)

```javascript
setBaseURL(newBaseURL)
```

* 更新baseURL
   * @param {string} newBaseURL - 新的base URL

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置
   * @returns {Object} 客户端配置

---

