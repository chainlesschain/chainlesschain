# tool-errors

**Source**: `src/main/skill-tool-system/tool-errors.js`

**Generated**: 2026-02-16T13:44:34.613Z

---

## class ToolError extends Error

```javascript
class ToolError extends Error
```

* 工具错误类定义
 * 提供统一的错误处理和分类

---

## class ToolError extends Error

```javascript
class ToolError extends Error
```

* 基础工具错误类

---

## class ValidationError extends ToolError

```javascript
class ValidationError extends ToolError
```

* 参数验证错误

---

## class ExecutionError extends ToolError

```javascript
class ExecutionError extends ToolError
```

* 工具执行错误

---

## class ToolNotFoundError extends ToolError

```javascript
class ToolNotFoundError extends ToolError
```

* 工具未找到错误

---

## class PermissionError extends ToolError

```javascript
class PermissionError extends ToolError
```

* 权限错误

---

## class TimeoutError extends ToolError

```javascript
class TimeoutError extends ToolError
```

* 超时错误

---

## class ConfigurationError extends ToolError

```javascript
class ConfigurationError extends ToolError
```

* 配置错误

---

## class DependencyError extends ToolError

```javascript
class DependencyError extends ToolError
```

* 依赖错误（缺少必需的依赖）

---

## class ResourceLimitError extends ToolError

```javascript
class ResourceLimitError extends ToolError
```

* 资源限制错误

---

## class ErrorHandler

```javascript
class ErrorHandler
```

* 错误处理器

---

## async handleToolError(error, toolName, params)

```javascript
async handleToolError(error, toolName, params)
```

* 处理工具错误

---

## wrapHandler(handler, toolName, logger)

```javascript
wrapHandler(handler, toolName, logger)
```

* 包装工具Handler，添加错误处理

---

## _validateParams(params, toolName)

```javascript
_validateParams(params, toolName)
```

* 验证参数

---

## _recordErrorStats(error, toolName)

```javascript
_recordErrorStats(error, toolName)
```

* 记录错误统计

---

## getErrorStats()

```javascript
getErrorStats()
```

* 获取错误统计

---

## clearErrorStats()

```javascript
clearErrorStats()
```

* 清除错误统计

---

## _sanitizeParams(params)

```javascript
_sanitizeParams(params)
```

* 清理敏感参数

---

