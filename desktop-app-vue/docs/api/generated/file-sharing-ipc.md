# file-sharing-ipc

**Source**: `src/main/ipc/file-sharing-ipc.js`

**Generated**: 2026-02-16T22:06:51.479Z

---

## const

```javascript
const
```

* 文件共享 IPC 处理器
 * Phase 2 - v0.18.0
 *
 * 注册所有文件共享相关的IPC接口（12个）

---

## function registerFileSharingIPC(app)

```javascript
function registerFileSharingIPC(app)
```

* 注册文件共享IPC处理器
 * @param {Object} app - ChainlessChainApp实例

---

## ipcMain.handle("file:upload", async (event,

```javascript
ipcMain.handle("file:upload", async (event,
```

* 上传文件

---

## ipcMain.handle("file:list", async (event,

```javascript
ipcMain.handle("file:list", async (event,
```

* 获取文件列表

---

## ipcMain.handle("file:detail", async (event,

```javascript
ipcMain.handle("file:detail", async (event,
```

* 获取文件详情

---

## ipcMain.handle("file:delete", async (event,

```javascript
ipcMain.handle("file:delete", async (event,
```

* 删除文件

---

## ipcMain.handle("file:lock", async (event,

```javascript
ipcMain.handle("file:lock", async (event,
```

* 锁定文件

---

## ipcMain.handle("file:unlock", async (event,

```javascript
ipcMain.handle("file:unlock", async (event,
```

* 解锁文件

---

## ipcMain.handle("file:versions", async (event,

```javascript
ipcMain.handle("file:versions", async (event,
```

* 获取文件版本列表

---

## ipcMain.handle("file:rollback", async (event,

```javascript
ipcMain.handle("file:rollback", async (event,
```

* 回滚到指定版本

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 比较两个版本

---

## ipcMain.handle("file:grantPermission", async (event,

```javascript
ipcMain.handle("file:grantPermission", async (event,
```

* 授予文件权限

---

## ipcMain.handle("file:share", async (event,

```javascript
ipcMain.handle("file:share", async (event,
```

* 共享文件

---

## ipcMain.handle("file:sharedFiles", async (event,

```javascript
ipcMain.handle("file:sharedFiles", async (event,
```

* 获取共享的文件列表

---

