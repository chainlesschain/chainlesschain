# errorHandler

**Source**: `src\renderer\utils\errorHandler.js`

**Generated**: 2026-01-27T06:44:03.900Z

---

## import

```javascript
import
```

* 统一错误处理工具
 * 提供一致的错误处理、日志记录和用户反馈

---

## export const ErrorType =

```javascript
export const ErrorType =
```

* 错误类型枚举

---

## export const ErrorLevel =

```javascript
export const ErrorLevel =
```

* 错误级别

---

## const ERROR_MESSAGES =

```javascript
const ERROR_MESSAGES =
```

* 错误消息映射

---

## export class AppError extends Error

```javascript
export class AppError extends Error
```

* 应用错误类

---

## class ErrorHandler

```javascript
class ErrorHandler
```

* 错误处理器类

---

## handle(error, options =

```javascript
handle(error, options =
```

* 处理错误
   * @param {Error|AppError} error - 错误对象
   * @param {Object} options - 处理选项

---

## normalizeError(error, context = null)

```javascript
normalizeError(error, context = null)
```

* 标准化错误对象

---

## logError(error, logToConsole = true, logToFile = false)

```javascript
logError(error, logToConsole = true, logToFile = false)
```

* 记录错误

---

## showErrorMessage(error)

```javascript
showErrorMessage(error)
```

* 显示错误消息（Toast）

---

## showErrorNotification(error)

```javascript
showErrorNotification(error)
```

* 显示错误通知（Notification）

---

## getErrorTitle(error)

```javascript
getErrorTitle(error)
```

* 获取错误标题

---

## addListener(listener)

```javascript
addListener(listener)
```

* 添加错误监听器

---

## removeListener(listener)

```javascript
removeListener(listener)
```

* 移除错误监听器

---

## notifyListeners(error)

```javascript
notifyListeners(error)
```

* 通知所有监听器

---

## getErrorLog()

```javascript
getErrorLog()
```

* 获取错误日志

---

## clearErrorLog()

```javascript
clearErrorLog()
```

* 清空错误日志

---

## exportErrorLog()

```javascript
exportErrorLog()
```

* 导出错误日志

---

## export function handleError(error, options =

```javascript
export function handleError(error, options =
```

* 便捷函数：处理错误

---

## export function createError(

```javascript
export function createError(
```

* 便捷函数：创建应用错误

---

## export function withErrorHandling(fn, options =

```javascript
export function withErrorHandling(fn, options =
```

* 异步函数错误包装器
 * 自动捕获并处理异步函数中的错误

---

## export function handlePromise(promise, options =

```javascript
export function handlePromise(promise, options =
```

* Promise 错误处理

---

## export async function withRetry(fn, options =

```javascript
export async function withRetry(fn, options =
```

* 重试包装器
 * 自动重试失败的操作

---

## export function withTimeout(

```javascript
export function withTimeout(
```

* 超时包装器

---

## export function isIPCNotReadyError(error)

```javascript
export function isIPCNotReadyError(error)
```

* 检查是否为 IPC 未就绪错误
 * 这类错误通常在应用启动时发生，可以静默重试

---

## export function isSerializationError(error)

```javascript
export function isSerializationError(error)
```

* 检查是否为序列化错误
 * 这类错误通常是因为尝试通过 IPC 传输不可序列化的对象

---

## export async function safeIPCCall(ipcFn, options =

```javascript
export async function safeIPCCall(ipcFn, options =
```

* IPC 调用包装器
 * 自动处理 IPC 未就绪的情况，支持重试

---

