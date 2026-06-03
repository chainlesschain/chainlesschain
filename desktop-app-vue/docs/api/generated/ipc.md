# ipc

**Source**: `src\renderer\utils\ipc.js`

**Generated**: 2026-01-27T06:44:03.898Z

---

## const STARTUP_RETRY_CHANNELS = [

```javascript
const STARTUP_RETRY_CHANNELS = [
```

* 需要重试逻辑的 IPC 通道（在启动时可能未就绪）

---

## const RETRY_CONFIG =

```javascript
const RETRY_CONFIG =
```

* IPC 重试配置

---

## function isRetryableError(error)

```javascript
function isRetryableError(error)
```

* 检查错误是否可重试

---

## function delay(ms)

```javascript
function delay(ms)
```

* 延迟函数

---

## export async function ipcWithRetry(ipcCall, options =

```javascript
export async function ipcWithRetry(ipcCall, options =
```

* IPC 调用重试包装器
 *
 * @param {Function} ipcCall - IPC 调用函数
 * @param {Object} options - 重试选项
 * @param {number} options.maxRetries - 最大重试次数
 * @param {number} options.initialDelay - 初始延迟
 * @param {boolean} options.silentErrors - 是否静默错误（不在控制台输出）
 * @returns {Promise} IPC 调用结果

---

## export function createRetryableIPC(ipcObject, options =

```javascript
export function createRetryableIPC(ipcObject, options =
```

* 创建带重试的 IPC 调用包装器
 *
 * @param {Object} ipcObject - IPC 对象 (如 window.electron.ipcRenderer)
 * @param {Object} options - 重试选项
 * @returns {Object} 包装后的 IPC 对象

---

## function wrapAPIMethodWithRetry(method, channelName)

```javascript
function wrapAPIMethodWithRetry(method, channelName)
```

* 为 electronAPI 的特定方法添加重试包装
 * 这样在应用启动时，如果 IPC 处理程序还未就绪，会自动重试

---

## function wrapAPIObject(obj, pathPrefix = '')

```javascript
function wrapAPIObject(obj, pathPrefix = '')
```

* 递归包装对象的所有方法

---

## export const electronAPI = wrapAPIObject(window.electronAPI);

```javascript
export const electronAPI = wrapAPIObject(window.electronAPI);
```

* 导出带重试包装的 electronAPI
 * 使用方式：import { electronAPI } from '@/utils/ipc'

---

