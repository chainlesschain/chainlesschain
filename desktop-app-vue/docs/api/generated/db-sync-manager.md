# db-sync-manager

**Source**: `src/main/sync/db-sync-manager.js`

**Generated**: 2026-02-15T08:42:37.180Z

---

## class DBSyncManager extends EventEmitter

```javascript
class DBSyncManager extends EventEmitter
```

* 数据库同步管理器
 * 核心功能：本地 SQLite 与后端 PostgreSQL 的双向同步

---

## setAuthToken(token)

```javascript
setAuthToken(token)
```

* 设置授权Token
   * @param {string} token - JWT token

---

## hasAuth()

```javascript
hasAuth()
```

* 检查是否已认证
   * @returns {boolean}

---

## checkAuth(throwOnError = false)

```javascript
checkAuth(throwOnError = false)
```

* 检查认证状态，如果未认证则抛出错误或警告
   * @param {boolean} throwOnError - 是否在未认证时抛出错误
   * @returns {boolean}

---

## async initialize(deviceId, options =

```javascript
async initialize(deviceId, options =
```

* 初始化同步管理器
   * @param {string} deviceId - 设备ID
   * @param {Object} options - 可选配置
   * @param {string} options.authToken - 认证Token

---

## startPeriodicCleanup()

```javascript
startPeriodicCleanup()
```

* 启动定期清理任务
   * 每24小时清理一次30天前的软删除记录

---

## async syncServerTime()

```javascript
async syncServerTime()
```

* 同步服务器时间，计算时间偏移
   * 解决时间戳不一致问题

---

## adjustToServerTime(localTimestamp)

```javascript
adjustToServerTime(localTimestamp)
```

* 将本地时间戳调整为服务器时间
   * @param {number} localTimestamp - 本地时间戳（毫秒）
   * @returns {number} 调整后的时间戳

---

## adjustToLocalTime(serverTimestamp)

```javascript
adjustToLocalTime(serverTimestamp)
```

* 将服务器时间戳调整为本地时间
   * @param {number} serverTimestamp - 服务器时间戳（毫秒）
   * @returns {number} 调整后的时间戳

---

## async syncAfterLogin(options =

```javascript
async syncAfterLogin(options =
```

* 登录后的完整同步流程（并发版本）
   * @param {Object} options - 可选配置
   * @param {boolean} options.requireAuth - 是否要求认证（默认true）

---

## async uploadLocalChanges(tableName)

```javascript
async uploadLocalChanges(tableName)
```

* 上传本地变更（逐条处理版本）
   * 每条记录独立处理，与后端的独立事务保持一致

---

## async downloadRemoteChanges(tableName)

```javascript
async downloadRemoteChanges(tableName)
```

* 下载远程变更

---

## async handleUpdate(tableName, backendRecord)

```javascript
async handleUpdate(tableName, backendRecord)
```

* 处理更新（冲突检测）

---

## insertOrUpdateLocal(tableName, record)

```javascript
insertOrUpdateLocal(tableName, record)
```

* 插入或更新本地记录

---

## async resolveConflict(conflictId, resolution, mergedData = null)

```javascript
async resolveConflict(conflictId, resolution, mergedData = null)
```

* 解决冲突
   * @param {string} conflictId - 冲突ID (格式: tableName:recordId)
   * @param {string} resolution - 解决策略: 'local', 'remote', 'merge'
   * @param {Object} mergedData - 合并后的数据（仅当 resolution='merge' 时需要）

---

## startPeriodicSync()

```javascript
startPeriodicSync()
```

* 定期增量同步

---

## async syncIncremental(options =

```javascript
async syncIncremental(options =
```

* 增量同步（只同步有变更的表，并发版本）
   * @param {Object} options - 可选配置
   * @param {boolean} options.requireAuth - 是否要求认证（默认true）

---

## setupNetworkListeners()

```javascript
setupNetworkListeners()
```

* 设置网络监听

---

## destroy()

```javascript
destroy()
```

* 销毁管理器

---

