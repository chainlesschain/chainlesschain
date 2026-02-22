# secure-storage-ipc

**Source**: `src/main/llm/secure-storage-ipc.js`

**Generated**: 2026-02-22T01:23:36.714Z

---

## const

```javascript
const
```

* 安全存储 IPC 处理器
 *
 * 提供渲染进程访问安全存储的接口
 *
 * @module secure-storage-ipc

---

## function registerSecureStorageIPC()

```javascript
function registerSecureStorageIPC()
```

* 注册安全存储 IPC 处理器

---

## ipcMain.handle("secure-storage:get-info", async () =>

```javascript
ipcMain.handle("secure-storage:get-info", async () =>
```

* 获取存储信息

---

## ipcMain.handle("secure-storage:save", async (event, config) =>

```javascript
ipcMain.handle("secure-storage:save", async (event, config) =>
```

* 保存敏感配置

---

## ipcMain.handle("secure-storage:load", async () =>

```javascript
ipcMain.handle("secure-storage:load", async () =>
```

* 加载敏感配置

---

## ipcMain.handle("secure-storage:exists", async () =>

```javascript
ipcMain.handle("secure-storage:exists", async () =>
```

* 检查配置是否存在

---

## ipcMain.handle("secure-storage:delete", async () =>

```javascript
ipcMain.handle("secure-storage:delete", async () =>
```

* 删除配置

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 验证 API Key 格式

---

## ipcMain.handle("secure-storage:create-backup", async () =>

```javascript
ipcMain.handle("secure-storage:create-backup", async () =>
```

* 创建备份

---

## ipcMain.handle("secure-storage:list-backups", async () =>

```javascript
ipcMain.handle("secure-storage:list-backups", async () =>
```

* 列出备份

---

## ipcMain.handle("secure-storage:restore-backup", async (event, backupPath) =>

```javascript
ipcMain.handle("secure-storage:restore-backup", async (event, backupPath) =>
```

* 从备份恢复

---

## ipcMain.handle("secure-storage:export", async (event,

```javascript
ipcMain.handle("secure-storage:export", async (event,
```

* 导出配置（需要密码）

---

## ipcMain.handle("secure-storage:import", async (event,

```javascript
ipcMain.handle("secure-storage:import", async (event,
```

* 导入配置（需要密码）

---

## ipcMain.handle("secure-storage:migrate-to-safe-storage", async () =>

```javascript
ipcMain.handle("secure-storage:migrate-to-safe-storage", async () =>
```

* 迁移到 safeStorage

---

## ipcMain.handle("secure-storage:clear-cache", async () =>

```javascript
ipcMain.handle("secure-storage:clear-cache", async () =>
```

* 清除缓存

---

## ipcMain.handle("secure-storage:get-sensitive-fields", async () =>

```javascript
ipcMain.handle("secure-storage:get-sensitive-fields", async () =>
```

* 获取敏感字段列表

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取提供商的敏感字段

---

## ipcMain.handle("secure-storage:is-sensitive", async (event, fieldPath) =>

```javascript
ipcMain.handle("secure-storage:is-sensitive", async (event, fieldPath) =>
```

* 检查字段是否敏感

---

## ipcMain.handle("secure-storage:sanitize", async (event, config) =>

```javascript
ipcMain.handle("secure-storage:sanitize", async (event, config) =>
```

* 脱敏配置

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 设置单个 API Key

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取单个 API Key（脱敏）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 删除单个 API Key

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量设置 API Keys

---

## ipcMain.handle("secure-storage:has-api-key", async (event, provider) =>

```javascript
ipcMain.handle("secure-storage:has-api-key", async (event, provider) =>
```

* 检查提供商是否已配置 API Key

---

## ipcMain.handle("secure-storage:get-configured-providers", async () =>

```javascript
ipcMain.handle("secure-storage:get-configured-providers", async () =>
```

* 获取所有已配置的提供商

---

## function unregisterSecureStorageIPC()

```javascript
function unregisterSecureStorageIPC()
```

* 注销 IPC 处理器

---

