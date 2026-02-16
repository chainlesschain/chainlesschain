# metrics

**Source**: `src/main/rag/metrics.js`

**Generated**: 2026-02-16T22:06:51.442Z

---

## const

```javascript
const
```

* RAG性能监控模块
 * 用于跟踪和分析RAG系统的性能指标

---

## const MetricTypes =

```javascript
const MetricTypes =
```

* 性能指标类型

---

## class RAGMetrics extends EventEmitter

```javascript
class RAGMetrics extends EventEmitter
```

* 性能监控类

---

## record(type, value, metadata =

```javascript
record(type, value, metadata =
```

* 记录指标
   * @param {string} type - 指标类型
   * @param {number} value - 指标值（毫秒）
   * @param {Object} metadata - 额外元数据

---

## startTimer(type)

```javascript
startTimer(type)
```

* 创建计时器
   * @param {string} type - 指标类型
   * @returns {Function} 停止计时函数

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

## recordError(type, error)

```javascript
recordError(type, error)
```

* 记录错误
   * @param {string} type - 错误类型
   * @param {Error} error - 错误对象

---

## getStats(type = null)

```javascript
getStats(type = null)
```

* 获取性能统计
   * @param {string} type - 指标类型（可选）
   * @returns {Object} 统计信息

---

## _calculateStats(records)

```javascript
_calculateStats(records)
```

* 计算统计信息
   * @private

---

## _percentile(sortedValues, percentile)

```javascript
_percentile(sortedValues, percentile)
```

* 计算百分位数
   * @private

---

## _calculateHitRate()

```javascript
_calculateHitRate()
```

* 计算缓存命中率
   * @private

---

## _updateStats(type, value)

```javascript
_updateStats(type, value)
```

* 更新统计
   * @private

---

## _getMetricKey(type)

```javascript
_getMetricKey(type)
```

* 获取指标键名
   * @private

---

## _checkAlerts(type, value)

```javascript
_checkAlerts(type, value)
```

* 检查性能告警
   * @private

---

## getRealTimeOverview()

```javascript
getRealTimeOverview()
```

* 获取实时性能概览

---

## getPerformanceReport(timeRange = 3600000)

```javascript
getPerformanceReport(timeRange = 3600000)
```

* 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）

---

## exportMetrics()

```javascript
exportMetrics()
```

* 导出指标数据
   * @returns {Object} 指标数据

---

## reset()

```javascript
reset()
```

* 重置所有指标

---

## cleanOldMetrics(maxAge = 3600000)

```javascript
cleanOldMetrics(maxAge = 3600000)
```

* 清理旧数据
   * @param {number} maxAge - 最大年龄（毫秒）

---

## _countTotalRecords()

```javascript
_countTotalRecords()
```

* 统计总记录数
   * @private

---

## function getGlobalMetrics()

```javascript
function getGlobalMetrics()
```

* 获取全局指标实例

---

