# tool-logger

**Source**: `src/main/skill-tool-system/tool-logger.js`

**Generated**: 2026-02-15T07:37:13.778Z

---

## const

```javascript
const
```

* 工具日志记录器
 * 提供结构化的日志记录和错误追踪功能

---

## async _ensureLogDir()

```javascript
async _ensureLogDir()
```

* 确保日志目录存在

---

## _formatMessage(level, message, data = null, error = null)

```javascript
_formatMessage(level, message, data = null, error = null)
```

* 格式化日志消息

---

## async _writeLog(level, message, data = null, error = null)

```javascript
async _writeLog(level, message, data = null, error = null)
```

* 写入日志

---

## _consoleOutput(level, logEntry)

```javascript
_consoleOutput(level, logEntry)
```

* 控制台输出

---

## async _fileOutput(logEntry)

```javascript
async _fileOutput(logEntry)
```

* 文件输出

---

## async error(message, error = null, data = null)

```javascript
async error(message, error = null, data = null)
```

* 记录错误

---

## async warn(message, data = null)

```javascript
async warn(message, data = null)
```

* 记录警告

---

## async info(message, data = null)

```javascript
async info(message, data = null)
```

* 记录信息

---

## async debug(message, data = null)

```javascript
async debug(message, data = null)
```

* 记录调试信息

---

## async trace(message, data = null)

```javascript
async trace(message, data = null)
```

* 记录追踪信息

---

## async logToolCall(toolName, params, startTime)

```javascript
async logToolCall(toolName, params, startTime)
```

* 记录工具调用

---

## async logToolSuccess(toolName, result, duration)

```javascript
async logToolSuccess(toolName, result, duration)
```

* 记录工具成功

---

## async logToolFailure(toolName, error, duration, params)

```javascript
async logToolFailure(toolName, error, duration, params)
```

* 记录工具失败

---

## _sanitizeParams(params)

```javascript
_sanitizeParams(params)
```

* 清理敏感参数（用于日志记录）

---

## child(context)

```javascript
child(context)
```

* 创建子logger（带有特定上下文）

---

