# external-device-file-ipc

**Source**: `src/main/file/external-device-file-ipc.js`

**Generated**: 2026-02-21T22:04:25.836Z

---

## const

```javascript
const
```

* 外部设备文件IPC处理器
 *
 * 为渲染进程提供文件浏览、同步、传输等功能的IPC接口

---

## function registerExternalDeviceFileIPC(ipcMain, externalFileManager)

```javascript
function registerExternalDeviceFileIPC(ipcMain, externalFileManager)
```

* 注册外部设备文件相关的IPC处理器
 * @param {Object} ipcMain - IPC主进程对象
 * @param {Object} externalFileManager - 外部设备文件管理器实例

---

## ipcMain.handle('external-file:get-devices', async () =>

```javascript
ipcMain.handle('external-file:get-devices', async () =>
```

* 获取已连接的设备列表

---

## ipcMain.handle('external-file:get-file-list', async (event, deviceId, filters) =>

```javascript
ipcMain.handle('external-file:get-file-list', async (event, deviceId, filters) =>
```

* 获取设备的文件列表

---

## ipcMain.handle('external-file:request-sync', async (event, deviceId, options) =>

```javascript
ipcMain.handle('external-file:request-sync', async (event, deviceId, options) =>
```

* 请求同步设备文件索引

---

## ipcMain.handle('external-file:pull-file', async (event, fileId, options) =>

```javascript
ipcMain.handle('external-file:pull-file', async (event, fileId, options) =>
```

* 拉取文件到本地缓存

---

## ipcMain.handle('external-file:import-to-rag', async (event, fileId) =>

```javascript
ipcMain.handle('external-file:import-to-rag', async (event, fileId) =>
```

* 导入文件到RAG知识库

---

## ipcMain.handle('external-file:import-to-project', async (event, fileId, projectId) =>

```javascript
ipcMain.handle('external-file:import-to-project', async (event, fileId, projectId) =>
```

* 导入文件到项目

---

## ipcMain.handle('external-file:get-projects', async () =>

```javascript
ipcMain.handle('external-file:get-projects', async () =>
```

* 获取项目列表（用于导入选择）

---

## ipcMain.handle('external-file:get-transfer-progress', async (event, transferId) =>

```javascript
ipcMain.handle('external-file:get-transfer-progress', async (event, transferId) =>
```

* 获取文件传输进度

---

## ipcMain.handle('external-file:cancel-transfer', async (event, transferId) =>

```javascript
ipcMain.handle('external-file:cancel-transfer', async (event, transferId) =>
```

* 取消文件传输

---

## ipcMain.handle('external-file:search', async (event, query, options) =>

```javascript
ipcMain.handle('external-file:search', async (event, query, options) =>
```

* 搜索文件

---

## ipcMain.handle('external-file:get-file-info', async (event, fileId) =>

```javascript
ipcMain.handle('external-file:get-file-info', async (event, fileId) =>
```

* 获取文件详情

---

## ipcMain.handle('external-file:toggle-favorite', async (event, fileId) =>

```javascript
ipcMain.handle('external-file:toggle-favorite', async (event, fileId) =>
```

* 切换文件收藏状态

---

## ipcMain.handle('external-file:update-tags', async (event, fileId, tags) =>

```javascript
ipcMain.handle('external-file:update-tags', async (event, fileId, tags) =>
```

* 更新文件标签

---

## ipcMain.handle('external-file:cleanup-cache', async (event, expiry) =>

```javascript
ipcMain.handle('external-file:cleanup-cache', async (event, expiry) =>
```

* 清理过期缓存

---

## ipcMain.handle('external-file:get-cache-stats', async () =>

```javascript
ipcMain.handle('external-file:get-cache-stats', async () =>
```

* 获取缓存统计信息

---

## ipcMain.handle('external-file:get-sync-history', async (event, deviceId, limit) =>

```javascript
ipcMain.handle('external-file:get-sync-history', async (event, deviceId, limit) =>
```

* 获取同步历史

---

## ipcMain.handle('external-file:get-active-transfers', async () =>

```javascript
ipcMain.handle('external-file:get-active-transfers', async () =>
```

* 获取活跃的传输任务

---

## ipcMain.handle('external-file:get-performance-stats', async () =>

```javascript
ipcMain.handle('external-file:get-performance-stats', async () =>
```

* 获取性能统计信息

---

## ipcMain.handle('external-file:get-recent-transfers', async (event, limit) =>

```javascript
ipcMain.handle('external-file:get-recent-transfers', async (event, limit) =>
```

* 获取最近的传输记录

---

## ipcMain.handle('external-file:get-recent-syncs', async (event, limit) =>

```javascript
ipcMain.handle('external-file:get-recent-syncs', async (event, limit) =>
```

* 获取最近的同步记录

---

## ipcMain.handle('external-file:generate-performance-report', async () =>

```javascript
ipcMain.handle('external-file:generate-performance-report', async () =>
```

* 生成性能报告

---

## ipcMain.handle('external-file:reset-performance-metrics', async () =>

```javascript
ipcMain.handle('external-file:reset-performance-metrics', async () =>
```

* 重置性能统计

---

## ipcMain.handle('external-file:get-retry-stats', async () =>

```javascript
ipcMain.handle('external-file:get-retry-stats', async () =>
```

* 获取重试统计信息

---

## ipcMain.handle('external-file:reset-retry-stats', async () =>

```javascript
ipcMain.handle('external-file:reset-retry-stats', async () =>
```

* 重置重试统计

---

