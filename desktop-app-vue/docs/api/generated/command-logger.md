# command-logger

**Source**: `src/main/remote/logging/command-logger.js`

**Generated**: 2026-02-15T08:42:37.196Z

---

## const

```javascript
const
```

* 命令日志记录器
 *
 * 记录所有远程命令的执行日志，支持：
 * - 结构化日志存储（SQLite）
 * - 日志级别（info、warn、error）
 * - 日志查询（分页、过滤、搜索）
 * - 日志轮转（自动清理旧日志）
 *
 * @module remote/logging/command-logger

---

## const LogLevel =

```javascript
const LogLevel =
```

* 日志级别

---

## class CommandLogger extends EventEmitter

```javascript
class CommandLogger extends EventEmitter
```

* 命令日志记录器类

---

## initializeDatabase()

```javascript
initializeDatabase()
```

* 初始化数据库表

---

## log(logEntry)

```javascript
log(logEntry)
```

* 记录命令日志
   *
   * @param {Object} logEntry - 日志条目
   * @returns {number} 日志 ID

---

## logSuccess(logEntry)

```javascript
logSuccess(logEntry)
```

* 记录成功的命令

---

## logFailure(logEntry)

```javascript
logFailure(logEntry)
```

* 记录失败的命令

---

## logWarning(logEntry)

```javascript
logWarning(logEntry)
```

* 记录警告

---

## query(options =

```javascript
query(options =
```

* 查询日志
   *
   * @param {Object} options - 查询选项
   * @returns {Object} 查询结果

---

## getLogById(id)

```javascript
getLogById(id)
```

* 获取日志详情

---

## getRecentLogs(limit = 20)

```javascript
getRecentLogs(limit = 20)
```

* 获取最近的日志

---

## getLogsByDevice(deviceDid, limit = 50, offset = 0)

```javascript
getLogsByDevice(deviceDid, limit = 50, offset = 0)
```

* 获取设备的日志

---

## getFailureLogs(limit = 50, offset = 0)

```javascript
getFailureLogs(limit = 50, offset = 0)
```

* 获取失败的日志

---

## cleanup()

```javascript
cleanup()
```

* 清理旧日志

---

## startAutoCleanup()

```javascript
startAutoCleanup()
```

* 启动自动清理

---

## stopAutoCleanup()

```javascript
stopAutoCleanup()
```

* 停止自动清理

---

## exportLogs(options =

```javascript
exportLogs(options =
```

* 导出日志

---

## convertToCSV(logs)

```javascript
convertToCSV(logs)
```

* 转换为 CSV 格式

---

## clearAll()

```javascript
clearAll()
```

* 清空所有日志（谨慎使用）

---

## getStats(options =

```javascript
getStats(options =
```

* 获取日志统计

---

## destroy()

```javascript
destroy()
```

* 销毁

---

