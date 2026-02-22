# log-manager

**Source**: `src/main/logging/log-manager.js`

**Generated**: 2026-02-22T01:23:36.713Z

---

## const

```javascript
const
```

* 应用日志管理器
 * 提供统一的日志记录、分级、轮转和查询功能

---

## const LogLevel =

```javascript
const LogLevel =
```

* 日志级别

---

## const LogLevelNames =

```javascript
const LogLevelNames =
```

* 日志级别名称

---

## init()

```javascript
init()
```

* 初始化日志管理器

---

## createLogFile()

```javascript
createLogFile()
```

* 创建日志文件

---

## rotateLogFile()

```javascript
rotateLogFile()
```

* 轮转日志文件

---

## cleanOldLogs()

```javascript
cleanOldLogs()
```

* 清理旧日志文件

---

## log(level, message, meta =

```javascript
log(level, message, meta =
```

* 写入日志

---

## formatLogLine(entry)

```javascript
formatLogLine(entry)
```

* 格式化日志行

---

## logToConsole(level, message)

```javascript
logToConsole(level, message)
```

* 输出到控制台

---

## flush()

```javascript
flush()
```

* 刷新缓冲区

---

## startFlushTimer()

```javascript
startFlushTimer()
```

* 启动定时刷新

---

## close()

```javascript
close()
```

* 关闭日志管理器

---

## debug(message, meta =

```javascript
debug(message, meta =
```

* DEBUG级别日志

---

## info(message, meta =

```javascript
info(message, meta =
```

* INFO级别日志

---

## warn(message, meta =

```javascript
warn(message, meta =
```

* WARN级别日志

---

## error(message, meta =

```javascript
error(message, meta =
```

* ERROR级别日志

---

## fatal(message, meta =

```javascript
fatal(message, meta =
```

* FATAL级别日志

---

## getLogFiles()

```javascript
getLogFiles()
```

* 获取日志文件列表

---

## readLogFile(filename, options =

```javascript
readLogFile(filename, options =
```

* 读取日志文件

---

## searchLogs(query, options =

```javascript
searchLogs(query, options =
```

* 搜索日志

---

## clearAllLogs()

```javascript
clearAllLogs()
```

* 清空所有日志

---

## exportLogs(outputPath)

```javascript
exportLogs(outputPath)
```

* 导出日志

---

