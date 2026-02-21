# database-performance-ipc

**Source**: `src/main/database/database-performance-ipc.js`

**Generated**: 2026-02-21T22:45:05.303Z

---

## const

```javascript
const
```

* 数据库性能监控 IPC 接口
 *
 * 提供前端访问数据库性能统计和优化功能的接口

---

## function registerDatabasePerformanceIPC(optimizer)

```javascript
function registerDatabasePerformanceIPC(optimizer)
```

* 注册数据库性能监控 IPC 处理器
 * @param {DatabaseOptimizer} optimizer - 数据库优化器实例

---

## ipcMain.handle("db-performance:get-stats", async () =>

```javascript
ipcMain.handle("db-performance:get-stats", async () =>
```

* 获取性能统计

---

## ipcMain.handle("db-performance:reset-stats", async () =>

```javascript
ipcMain.handle("db-performance:reset-stats", async () =>
```

* 重置统计信息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取慢查询日志

---

## ipcMain.handle("db-performance:get-index-suggestions", async () =>

```javascript
ipcMain.handle("db-performance:get-index-suggestions", async () =>
```

* 获取索引建议

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 应用索引建议

---

## ipcMain.handle("db-performance:apply-all-index-suggestions", async () =>

```javascript
ipcMain.handle("db-performance:apply-all-index-suggestions", async () =>
```

* 应用所有索引建议

---

## ipcMain.handle("db-performance:analyze-table", async (event, tableName) =>

```javascript
ipcMain.handle("db-performance:analyze-table", async (event, tableName) =>
```

* 分析表性能

---

## ipcMain.handle("db-performance:optimize", async () =>

```javascript
ipcMain.handle("db-performance:optimize", async () =>
```

* 优化数据库

---

## ipcMain.handle("db-performance:clear-cache", async () =>

```javascript
ipcMain.handle("db-performance:clear-cache", async () =>
```

* 清空查询缓存

---

## ipcMain.handle("db-performance:invalidate-cache", async (event, pattern) =>

```javascript
ipcMain.handle("db-performance:invalidate-cache", async (event, pattern) =>
```

* 使缓存失效（支持模式匹配）

---

