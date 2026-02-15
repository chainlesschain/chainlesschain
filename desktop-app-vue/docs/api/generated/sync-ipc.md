# sync-ipc

**Source**: `src/main/sync/sync-ipc.js`

**Generated**: 2026-02-15T08:42:37.179Z

---

## function registerSyncIPC(

```javascript
function registerSyncIPC(
```

* 数据同步 IPC 处理器
 * 负责处理所有数据同步相关的前后端通信
 *
 * @module sync-ipc
 * @description 提供数据同步启动、状态查询、增量同步、冲突解决等 IPC 接口

---

## function registerSyncIPC(

```javascript
function registerSyncIPC(
```

* 注册所有数据同步 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.syncManager - 同步管理器实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）

---

## ipcMain.handle("sync:start", async (_event, deviceId) =>

```javascript
ipcMain.handle("sync:start", async (_event, deviceId) =>
```

* 启动数据同步
   * Channel: 'sync:start'
   *
   * @param {string} deviceId - 设备ID（可选，不提供则自动生成）
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("sync:get-status", async () =>

```javascript
ipcMain.handle("sync:get-status", async () =>
```

* 获取同步状态
   * Channel: 'sync:get-status'
   *
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## ipcMain.handle("sync:incremental", async () =>

```javascript
ipcMain.handle("sync:incremental", async () =>
```

* 手动触发增量同步
   * Channel: 'sync:incremental'
   *
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 解决同步冲突
   * Channel: 'sync:resolve-conflict'
   *
   * NOTE: There's a commented-out duplicate handler in index.js at line 2011.
   * The actual implementation is located at line 3491 (mentioned in comments).
   * This handler is kept here for future migration when the main implementation
   * is moved from index.js.
   *
   * @param {string} conflictId - 冲突ID
   * @param {string} resolution - 解决方案 ('local' | 'remote' | 'merge')
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("sync:set-auth-token", async (_event, token) =>

```javascript
ipcMain.handle("sync:set-auth-token", async (_event, token) =>
```

* 设置同步认证Token
   * Channel: 'sync:set-auth-token'
   *
   * @param {string} token - JWT token
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("sync:clear-auth-token", async () =>

```javascript
ipcMain.handle("sync:clear-auth-token", async () =>
```

* 清除同步认证Token
   * Channel: 'sync:clear-auth-token'
   *
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("sync:has-auth", async () =>

```javascript
ipcMain.handle("sync:has-auth", async () =>
```

* 检查同步认证状态
   * Channel: 'sync:has-auth'
   *
   * @returns {Promise<Object>} { success: boolean, hasAuth: boolean, error?: string }

---

## ipcMain.handle("sync:get-config", async () =>

```javascript
ipcMain.handle("sync:get-config", async () =>
```

* 获取同步配置信息
   * Channel: 'sync:get-config'
   *
   * @returns {Promise<Object>} { success: boolean, config: Object, error?: string }

---

