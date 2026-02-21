# error-handler

**Source**: `src/main/monitoring/error-handler.js`

**Generated**: 2026-02-21T20:04:16.231Z

---

## const

```javascript
const
```

* 全局错误处理系统
 *
 * 功能：
 * - 全局错误捕获（未捕获异常、Promise拒绝）
 * - 错误分类和优先级
 * - 错误恢复策略
 * - 用户友好的错误提示
 * - 错误报告和统计
 * - 崩溃报告

---

## class ErrorHandler

```javascript
class ErrorHandler
```

* 错误处理器类

---

## initialize()

```javascript
initialize()
```

* 初始化错误处理器

---

## registerGlobalHandlers()

```javascript
registerGlobalHandlers()
```

* 注册全局错误处理器

---

## registerDefaultRecoveryStrategies()

```javascript
registerDefaultRecoveryStrategies()
```

* 注册默认恢复策略

---

## registerRecoveryStrategy(category, strategy)

```javascript
registerRecoveryStrategy(category, strategy)
```

* 注册错误恢复策略

---

## async handleError(error, options =

```javascript
async handleError(error, options =
```

* 处理错误

---

## handleFatalError(error, report)

```javascript
handleFatalError(error, report)
```

* 处理致命错误

---

## showErrorDialog(error, options =

```javascript
showErrorDialog(error, options =
```

* 显示错误对话框

---

## getCategoryText(category)

```javascript
getCategoryText(category)
```

* 获取分类文本

---

## generateErrorReport(error, options =

```javascript
generateErrorReport(error, options =
```

* 生成错误报告

---

## saveErrorReport(report)

```javascript
saveErrorReport(report)
```

* 保存错误报告

---

## updateStats(type, category, error)

```javascript
updateStats(type, category, error)
```

* 更新统计信息

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

## getErrorReports()

```javascript
getErrorReports()
```

* 获取错误报告列表

---

## readErrorReport(filename)

```javascript
readErrorReport(filename)
```

* 读取错误报告

---

## cleanOldReports()

```javascript
cleanOldReports()
```

* 清理旧报告

---

## exportErrorReports(outputPath, options =

```javascript
exportErrorReports(outputPath, options =
```

* 导出错误报告

---

## function getErrorHandler()

```javascript
function getErrorHandler()
```

* 获取全局错误处理器

---

## function initErrorHandler(options =

```javascript
function initErrorHandler(options =
```

* 初始化错误处理器

---

## function handleError(error, options =

```javascript
function handleError(error, options =
```

* 便捷方法：处理错误

---

