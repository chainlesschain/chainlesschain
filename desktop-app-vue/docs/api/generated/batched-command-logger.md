# batched-command-logger

**Source**: `src/main/remote/logging/batched-command-logger.js`

**Generated**: 2026-02-15T10:10:53.380Z

---

## const

```javascript
const
```

* 批处理命令日志记录器（性能优化版）
 *
 * 性能优化：
 * - 批量写入日志（减少数据库 I/O）
 * - 异步处理（不阻塞主线程）
 * - 内存缓冲（临时存储待写入日志）
 *
 * @module remote/logging/batched-command-logger

---

## class BatchedCommandLogger extends EventEmitter

```javascript
class BatchedCommandLogger extends EventEmitter
```

* 批处理命令日志记录器类

---

## initializeDatabase()

```javascript
initializeDatabase()
```

* 初始化数据库表

---

## prepareStatements()

```javascript
prepareStatements()
```

* 预编译 SQL 语句（性能优化）

---

## log(logEntry)

```javascript
log(logEntry)
```

* 记录命令日志（添加到缓冲区）
   * @param {Object} logEntry - 日志条目

---

## startBatchProcessing()

```javascript
startBatchProcessing()
```

* 启动批处理定时器

---

## async flushBuffer()

```javascript
async flushBuffer()
```

* 刷新缓冲区（批量写入数据库）

---

## async forceFlush()

```javascript
async forceFlush()
```

* 强制刷新所有缓冲日志

---

## query(options =

```javascript
query(options =
```

* 查询命令日志
   * @param {Object} options - 查询选项
   * @returns {Object} 查询结果

---

## getPerformanceStats()

```javascript
getPerformanceStats()
```

* 获取性能统计
   * @returns {Object} 性能统计

---

## startAutoCleanup()

```javascript
startAutoCleanup()
```

* 启动自动清理

---

## cleanup()

```javascript
cleanup()
```

* 清理旧日志

---

## async close()

```javascript
async close()
```

* 关闭日志记录器

---

