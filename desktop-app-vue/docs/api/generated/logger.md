# logger

**Source**: `src/main/logging/logger.js`

**Generated**: 2026-02-15T08:42:37.225Z

---

## const

```javascript
const
```

* 结构化日志系统
 *
 * 功能：
 * - 多级别日志（debug, info, warn, error, fatal）
 * - 日志轮转（按大小和时间）
 * - 日志分类（按模块）
 * - 性能监控
 * - 错误追踪
 * - 日志导出
 * - 向后兼容旧的Logger接口

---

## function initLogger(options =

```javascript
function initLogger(options =
```

* 初始化日志系统

---

## function cleanOldLogs()

```javascript
function cleanOldLogs()
```

* 清理旧日志文件

---

## function getCurrentLogFile()

```javascript
function getCurrentLogFile()
```

* 获取当前日志文件路径

---

## function writeToFile(message)

```javascript
function writeToFile(message)
```

* 写入日志到文件

---

## class Logger

```javascript
class Logger
```

* Logger类

---

## formatMessage(level, args)

```javascript
formatMessage(level, args)
```

* 格式化日志消息

---

## formatConsoleMessage(level, args)

```javascript
formatConsoleMessage(level, args)
```

* 格式化控制台输出

---

## _log(level, ...args)

```javascript
_log(level, ...args)
```

* 内部日志方法

---

## child(subModuleName)

```javascript
child(subModuleName)
```

* 创建子日志器

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

## setLevel(level)

```javascript
setLevel(level)
```

* 设置日志级别

---

## function getLogger(moduleName)

```javascript
function getLogger(moduleName)
```

* 获取指定模块的 logger 实例
 * @param {string} moduleName - 模块名称
 * @returns {Logger} Logger 实例

---

## function getLogFiles()

```javascript
function getLogFiles()
```

* 获取日志文件列表

---

## function readLogFile(filename, options =

```javascript
function readLogFile(filename, options =
```

* 读取日志文件

---

## function exportLogs(outputPath, options =

```javascript
function exportLogs(outputPath, options =
```

* 导出日志

---

