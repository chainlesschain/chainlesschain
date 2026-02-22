# database-ipc

**Source**: `src/main/database/database-ipc.js`

**Generated**: 2026-02-22T01:23:36.737Z

---

## const

```javascript
const
```

* 数据库 IPC 处理器
 * 负责处理所有数据库相关的前后端通信
 *
 * @module database-ipc
 * @description 提供知识库 CRUD、标签管理、统计、备份恢复、多身份切换等 IPC 接口

---

## function registerDatabaseIPC(

```javascript
function registerDatabaseIPC(
```

* 注册所有数据库 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} [dependencies.ragManager] - RAG 管理器（用于知识库同步）
 * @param {Function} dependencies.getAppConfig - 获取应用配置函数
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC防护对象（可选，用于测试注入）

---

## ipcMain.handle("db:get-knowledge-items", async (_event, limit, offset) =>

```javascript
ipcMain.handle("db:get-knowledge-items", async (_event, limit, offset) =>
```

* 获取知识库项列表（分页）
   * Channel: 'db:get-knowledge-items'

---

## ipcMain.handle("db:get-knowledge-item-by-id", async (_event, id) =>

```javascript
ipcMain.handle("db:get-knowledge-item-by-id", async (_event, id) =>
```

* 根据 ID 获取知识库项
   * Channel: 'db:get-knowledge-item-by-id'

---

## ipcMain.handle("db:add-knowledge-item", async (_event, item) =>

```javascript
ipcMain.handle("db:add-knowledge-item", async (_event, item) =>
```

* 添加知识库项（自动同步到 RAG 索引）
   * Channel: 'db:add-knowledge-item'

---

## ipcMain.handle("db:update-knowledge-item", async (_event, id, updates) =>

```javascript
ipcMain.handle("db:update-knowledge-item", async (_event, id, updates) =>
```

* 更新知识库项（自动更新 RAG 索引）
   * Channel: 'db:update-knowledge-item'

---

## ipcMain.handle("db:delete-knowledge-item", async (_event, id) =>

```javascript
ipcMain.handle("db:delete-knowledge-item", async (_event, id) =>
```

* 删除知识库项（自动从 RAG 索引移除）
   * Channel: 'db:delete-knowledge-item'

---

## ipcMain.handle("db:search-knowledge-items", async (_event, query) =>

```javascript
ipcMain.handle("db:search-knowledge-items", async (_event, query) =>
```

* 搜索知识库项
   * Channel: 'db:search-knowledge-items'

---

## ipcMain.handle("db:get-all-tags", async () =>

```javascript
ipcMain.handle("db:get-all-tags", async () =>
```

* 获取所有标签
   * Channel: 'db:get-all-tags'

---

## ipcMain.handle("db:create-tag", async (_event, name, color) =>

```javascript
ipcMain.handle("db:create-tag", async (_event, name, color) =>
```

* 创建新标签
   * Channel: 'db:create-tag'

---

## ipcMain.handle("db:get-knowledge-tags", async (_event, knowledgeId) =>

```javascript
ipcMain.handle("db:get-knowledge-tags", async (_event, knowledgeId) =>
```

* 获取知识库项的标签
   * Channel: 'db:get-knowledge-tags'

---

## ipcMain.handle("db:get-statistics", async () =>

```javascript
ipcMain.handle("db:get-statistics", async () =>
```

* 获取数据库统计数据
   * Channel: 'db:get-statistics'

---

## ipcMain.handle("database:get-stats", async () =>

```javascript
ipcMain.handle("database:get-stats", async () =>
```

* 获取数据库详细统计信息（调试用）
   * Channel: 'database:get-stats'

---

## ipcMain.handle("db:get-path", async () =>

```javascript
ipcMain.handle("db:get-path", async () =>
```

* 获取数据库路径
   * Channel: 'db:get-path'

---

## ipcMain.handle("db:get-current-path", async () =>

```javascript
ipcMain.handle("db:get-current-path", async () =>
```

* 获取当前数据库路径
   * Channel: 'db:get-current-path'

---

## ipcMain.handle("db:get-context-path", async (_event, contextId) =>

```javascript
ipcMain.handle("db:get-context-path", async (_event, contextId) =>
```

* 获取身份上下文对应的数据库路径
   * Channel: 'db:get-context-path'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 切换数据库（企业版多身份功能）
   * Channel: 'db:switch-database'

---

## ipcMain.handle("db:backup", async (_event, backupPath) =>

```javascript
ipcMain.handle("db:backup", async (_event, backupPath) =>
```

* 备份数据库到指定路径
   * Channel: 'db:backup'

---

## ipcMain.handle("database:create-backup", async () =>

```javascript
ipcMain.handle("database:create-backup", async () =>
```

* 创建数据库备份（自动路径）
   * Channel: 'database:create-backup'

---

## ipcMain.handle("database:list-backups", async () =>

```javascript
ipcMain.handle("database:list-backups", async () =>
```

* 列出所有数据库备份
   * Channel: 'database:list-backups'

---

## ipcMain.handle("database:restore-backup", async (_event, backupPath) =>

```javascript
ipcMain.handle("database:restore-backup", async (_event, backupPath) =>
```

* 从备份恢复数据库
   * Channel: 'database:restore-backup'

---

## ipcMain.handle("database:get-config", async () =>

```javascript
ipcMain.handle("database:get-config", async () =>
```

* 获取数据库配置
   * Channel: 'database:get-config'

---

## ipcMain.handle("database:set-path", async (_event, newPath) =>

```javascript
ipcMain.handle("database:set-path", async (_event, newPath) =>
```

* 设置数据库路径（需要重启应用）
   * Channel: 'database:set-path'

---

## ipcMain.handle("database:migrate", async (_event, newPath) =>

```javascript
ipcMain.handle("database:migrate", async (_event, newPath) =>
```

* 迁移数据库到新位置
   * Channel: 'database:migrate'

---

