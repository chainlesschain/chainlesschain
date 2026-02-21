# ipc-performance-interceptor

**Source**: `src/main/performance/ipc-performance-interceptor.js`

**Generated**: 2026-02-21T22:45:05.271Z

---

## class IPCPerformanceInterceptor

```javascript
class IPCPerformanceInterceptor
```

* IPC性能拦截器
 * 自动跟踪所有IPC调用的性能

---

## register(ipcMain)

```javascript
register(ipcMain)
```

* 注册IPC性能监控
   * @param {Electron.IpcMain} ipcMain - Electron IPC主进程对象

---

## getActiveRequests()

```javascript
getActiveRequests()
```

* 获取活动请求

---

## getSlowRequests(threshold = 1000)

```javascript
getSlowRequests(threshold = 1000)
```

* 获取慢请求

---

## function getIPCPerformanceInterceptor()

```javascript
function getIPCPerformanceInterceptor()
```

* 获取IPC性能拦截器实例

---

