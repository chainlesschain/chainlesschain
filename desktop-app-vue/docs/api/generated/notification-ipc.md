# notification-ipc

**Source**: `src/main/notification/notification-ipc.js`

**Generated**: 2026-02-15T10:10:53.402Z

---

## const

```javascript
const
```

* 通知 IPC 处理器
 * 负责处理所有通知相关的前后端通信
 *
 * @module notification-ipc
 * @description 提供通知标记、未读计数、桌面通知等 IPC 接口

---

## function registerNotificationIPC(

```javascript
function registerNotificationIPC(
```

* 注册所有通知 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器实例

---

## ipcMain.handle("notification:mark-read", async (_event, id) =>

```javascript
ipcMain.handle("notification:mark-read", async (_event, id) =>
```

* 标记单个通知为已读
   * Channel: 'notification:mark-read'
   *
   * @param {number} id - 通知ID
   * @returns {Promise<Object>} { success: boolean }

---

## ipcMain.handle("notification:mark-all-read", async () =>

```javascript
ipcMain.handle("notification:mark-all-read", async () =>
```

* 标记所有通知为已读
   * Channel: 'notification:mark-all-read'
   *
   * @returns {Promise<Object>} { success: boolean }

---

## ipcMain.handle("notification:get-all", async (_event, options =

```javascript
ipcMain.handle("notification:get-all", async (_event, options =
```

* 获取所有通知
   * Channel: 'notification:get-all'
   *
   * @param {Object} options - 查询选项 (limit, offset, isRead)
   * @returns {Promise<Array>} 通知列表

---

## ipcMain.handle("notification:get-unread-count", async () =>

```javascript
ipcMain.handle("notification:get-unread-count", async () =>
```

* 获取未读通知数量
   * Channel: 'notification:get-unread-count'
   *
   * @returns {Promise<{success: boolean, count: number}>} 未读通知数量

---

## ipcMain.handle("notification:send-desktop", async (_event, title, body) =>

```javascript
ipcMain.handle("notification:send-desktop", async (_event, title, body) =>
```

* 发送系统桌面通知
   * Channel: 'notification:send-desktop'
   *
   * @param {string} title - 通知标题
   * @param {string} body - 通知内容
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

