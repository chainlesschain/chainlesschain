# statistics-collector

**Source**: `src/main/remote/logging/statistics-collector.js`

**Generated**: 2026-02-16T22:06:51.436Z

---

## const

```javascript
const
```

* 统计数据收集器
 *
 * 收集和统计远程命令执行数据，支持：
 * - 实时统计（内存中）
 * - 持久化统计（SQLite）
 * - 多维度统计（设备、命令、时间）
 * - 性能指标（响应时间、成功率）
 *
 * @module remote/logging/statistics-collector

---

## const TimePeriod =

```javascript
const TimePeriod =
```

* 时间段类型

---

## class StatisticsCollector extends EventEmitter

```javascript
class StatisticsCollector extends EventEmitter
```

* 统计数据收集器类

---

## initializeDatabase()

```javascript
initializeDatabase()
```

* 初始化数据库表

---

## record(commandData)

```javascript
record(commandData)
```

* 记录命令执行

---

## getRealTimeStats()

```javascript
getRealTimeStats()
```

* 获取实时统计

---

## async aggregate()

```javascript
async aggregate()
```

* 聚合统计数据到数据库

---

## async aggregateByPeriod(periodType, timestamp)

```javascript
async aggregateByPeriod(periodType, timestamp)
```

* 按时间段聚合

---

## getPeriodRange(periodType, timestamp)

```javascript
getPeriodRange(periodType, timestamp)
```

* 获取时间段范围

---

## queryStats(options =

```javascript
queryStats(options =
```

* 查询统计数据

---

## getDeviceActivity(days = 7)

```javascript
getDeviceActivity(days = 7)
```

* 获取设备活跃度

---

## getCommandRanking(limit = 10)

```javascript
getCommandRanking(limit = 10)
```

* 获取命令排行

---

## getTrend(periodType = TimePeriod.DAY, days = 7)

```javascript
getTrend(periodType = TimePeriod.DAY, days = 7)
```

* 获取趋势数据

---

## startAggregation()

```javascript
startAggregation()
```

* 启动聚合

---

## stopAggregation()

```javascript
stopAggregation()
```

* 停止聚合

---

## cleanup()

```javascript
cleanup()
```

* 清理旧统计数据

---

## resetRealTimeStats()

```javascript
resetRealTimeStats()
```

* 重置实时统计

---

## destroy()

```javascript
destroy()
```

* 销毁

---

