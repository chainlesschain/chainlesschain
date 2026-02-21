# file-sync-ipc

**Source**: `src/main/file-sync/file-sync-ipc.js`

**Generated**: 2026-02-21T20:04:16.250Z

---

## function registerFileSyncIPC(

```javascript
function registerFileSyncIPC(
```

* 文件同步 IPC 处理器
 * 负责处理所有文件同步相关的前后端通信
 *
 * @module file-sync-ipc
 * @description 提供文件监听、同步状态查询等 IPC 接口

---

## function registerFileSyncIPC(

```javascript
function registerFileSyncIPC(
```

* 注册所有文件同步 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器实例
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）

---

## ipcMain.handle("file-sync:watch-project", async (_event, projectId) =>

```javascript
ipcMain.handle("file-sync:watch-project", async (_event, projectId) =>
```

* 启动项目文件监听
   * Channel: 'file-sync:watch-project'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("file-sync:stop-watch", async (_event, projectId) =>

```javascript
ipcMain.handle("file-sync:stop-watch", async (_event, projectId) =>
```

* 停止项目文件监听
   * Channel: 'file-sync:stop-watch'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("file-sync:get-status", async (_event, fileId) =>

```javascript
ipcMain.handle("file-sync:get-status", async (_event, fileId) =>
```

* 获取文件同步状态
   * Channel: 'file-sync:get-status'
   *
   * @param {string} fileId - 文件ID
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

