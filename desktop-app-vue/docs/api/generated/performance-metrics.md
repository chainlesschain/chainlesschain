# performance-metrics

**Source**: `src/main/file/performance-metrics.js`

**Generated**: 2026-02-17T10:13:18.244Z

---

## const

```javascript
const
```

* 性能指标收集器
 *
 * 职责：
 * - 收集运行时性能数据
 * - 计算平均值和统计数据
 * - 提供性能报告

---

## class PerformanceMetrics

```javascript
class PerformanceMetrics
```

* 性能指标收集器类

---

## recordSync(duration, fileCount, deviceId)

```javascript
recordSync(duration, fileCount, deviceId)
```

* 记录索引同步
   * @param {number} duration - 同步耗时（毫秒）
   * @param {number} fileCount - 同步文件数量
   * @param {string} deviceId - 设备ID

---

## recordSyncError(error)

```javascript
recordSyncError(error)
```

* 记录同步错误

---

## recordTransfer(duration, bytes, fileId)

```javascript
recordTransfer(duration, bytes, fileId)
```

* 记录文件传输
   * @param {number} duration - 传输耗时（毫秒）
   * @param {number} bytes - 传输字节数
   * @param {string} fileId - 文件ID

---

## recordTransferError(error)

```javascript
recordTransferError(error)
```

* 记录传输错误

---

## incrementActiveTransfers()

```javascript
incrementActiveTransfers()
```

* 增加活跃传输计数

---

## decrementActiveTransfers()

```javascript
decrementActiveTransfers()
```

* 减少活跃传输计数

---

## recordCacheHit()

```javascript
recordCacheHit()
```

* 记录缓存命中

---

## recordCacheMiss()

```javascript
recordCacheMiss()
```

* 记录缓存未命中

---

## recordCacheEviction(count, freedBytes)

```javascript
recordCacheEviction(count, freedBytes)
```

* 记录缓存淘汰
   * @param {number} count - 淘汰的文件数量
   * @param {number} freedBytes - 释放的字节数

---

## updateCacheSize(size)

```javascript
updateCacheSize(size)
```

* 更新缓存大小
   * @param {number} size - 当前缓存总大小（字节）

---

## recordDbQuery(duration)

```javascript
recordDbQuery(duration)
```

* 记录数据库查询
   * @param {number} duration - 查询耗时（毫秒）

---

## recordError(type, error)

```javascript
recordError(type, error)
```

* 记录错误
   * @param {string} type - 错误类型
   * @param {Error} error - 错误对象

---

## getAvgSyncDuration()

```javascript
getAvgSyncDuration()
```

* 获取平均同步耗时
   * @returns {number} 平均耗时（毫秒）

---

## getAvgTransferSpeed()

```javascript
getAvgTransferSpeed()
```

* 获取平均传输速度
   * @returns {number} 平均速度（MB/s）

---

## getCacheHitRate()

```javascript
getCacheHitRate()
```

* 获取缓存命中率
   * @returns {number} 命中率（0-1）

---

## getAvgDbQueryDuration()

```javascript
getAvgDbQueryDuration()
```

* 获取平均数据库查询时间
   * @returns {number} 平均耗时（毫秒）

---

## getUptime()

```javascript
getUptime()
```

* 获取运行时长
   * @returns {number} 运行时长（毫秒）

---

## getStats()

```javascript
getStats()
```

* 获取完整统计信息
   * @returns {Object} 统计信息

---

## getRecentTransfers(limit = 10)

```javascript
getRecentTransfers(limit = 10)
```

* 获取最近的传输记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 传输记录

---

## getRecentSyncs(limit = 10)

```javascript
getRecentSyncs(limit = 10)
```

* 获取最近的同步记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 同步记录

---

## reset()

```javascript
reset()
```

* 重置统计信息

---

## exportToJSON()

```javascript
exportToJSON()
```

* 导出统计信息为JSON
   * @returns {string} JSON字符串

---

## generateReport()

```javascript
generateReport()
```

* 生成性能报告
   * @returns {string} 性能报告文本

---

