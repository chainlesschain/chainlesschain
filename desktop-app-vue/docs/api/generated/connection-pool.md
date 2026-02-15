# connection-pool

**Source**: `src/main/p2p/connection-pool.js`

**Generated**: 2026-02-15T07:37:13.809Z

---

## const

```javascript
const
```

* P2P连接池管理器
 * 优化P2P连接的生命周期管理、健康检查和资源复用

---

## const ConnectionState =

```javascript
const ConnectionState =
```

* 连接状态枚举

---

## class Connection

```javascript
class Connection
```

* 连接包装类

---

## markActive()

```javascript
markActive()
```

* 标记连接为活跃状态

---

## markIdle()

```javascript
markIdle()
```

* 标记连接为空闲状态

---

## isIdle()

```javascript
isIdle()
```

* 检查连接是否空闲

---

## isTimedOut(maxIdleTime)

```javascript
isTimedOut(maxIdleTime)
```

* 检查连接是否超时

---

## isHealthy()

```javascript
isHealthy()
```

* 检查连接是否健康

---

## recordError()

```javascript
recordError()
```

* 记录错误

---

## resetErrors()

```javascript
resetErrors()
```

* 重置错误计数

---

## class ConnectionPool extends EventEmitter

```javascript
class ConnectionPool extends EventEmitter
```

* P2P连接池管理器

---

## async initialize()

```javascript
async initialize()
```

* 初始化连接池

---

## async acquireConnection(peerId, createConnectionFn)

```javascript
async acquireConnection(peerId, createConnectionFn)
```

* 获取连接（支持连接复用）

---

## async createConnection(peerId, createConnectionFn)

```javascript
async createConnection(peerId, createConnectionFn)
```

* 创建新连接

---

## releaseConnection(peerId)

```javascript
releaseConnection(peerId)
```

* 释放连接（标记为空闲，但不关闭）

---

## async closeConnection(peerId)

```javascript
async closeConnection(peerId)
```

* 关闭连接

---

## async evictIdleConnections(count = 1)

```javascript
async evictIdleConnections(count = 1)
```

* 驱逐空闲连接

---

## async performHealthCheck()

```javascript
async performHealthCheck()
```

* 健康检查

---

## startHealthCheck()

```javascript
startHealthCheck()
```

* 启动健康检查

---

## startCleanup()

```javascript
startCleanup()
```

* 启动清理任务

---

## updateStats()

```javascript
updateStats()
```

* 更新统计信息

---

## getStats()

```javascript
getStats()
```

* 获取连接池统计

---

## getConnectionDetails()

```javascript
getConnectionDetails()
```

* 获取连接详情

---

## async closeAll()

```javascript
async closeAll()
```

* 关闭所有连接

---

## async destroy()

```javascript
async destroy()
```

* 销毁连接池

---

