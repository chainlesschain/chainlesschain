# memory-sync-ipc

**Source**: `src/main/memory/memory-sync-ipc.js`

**Generated**: 2026-02-16T13:44:34.645Z

---

## const

```javascript
const
```

* MemorySyncService IPC Handlers
 *
 * 提供内存数据同步服务的 IPC 接口
 *
 * @module memory-sync-ipc
 * @version 1.0.0
 * @since 2026-01-18

---

## function registerMemorySyncIPC(options)

```javascript
function registerMemorySyncIPC(options)
```

* Register Memory Sync IPC handlers
 * @param {Object} options - Options
 * @param {Object} options.memorySyncService - MemorySyncService instance
 * @param {Object} [options.ipcMain] - IPC main object (for testing)
 * @returns {Object} Handler update functions

---

## ipcMain.handle("memory-sync:sync-all", async () =>

```javascript
ipcMain.handle("memory-sync:sync-all", async () =>
```

* Trigger full sync of all data to filesystem
   * Channel: 'memory-sync:sync-all'

---

## ipcMain.handle("memory-sync:sync-category", async (_event, category) =>

```javascript
ipcMain.handle("memory-sync:sync-category", async (_event, category) =>
```

* Sync specific category to filesystem
   * Channel: 'memory-sync:sync-category'

---

## ipcMain.handle("memory-sync:get-status", async () =>

```javascript
ipcMain.handle("memory-sync:get-status", async () =>
```

* Get sync status
   * Channel: 'memory-sync:get-status'

---

## ipcMain.handle("memory-sync:start-periodic", async () =>

```javascript
ipcMain.handle("memory-sync:start-periodic", async () =>
```

* Start periodic sync
   * Channel: 'memory-sync:start-periodic'

---

## ipcMain.handle("memory-sync:stop-periodic", async () =>

```javascript
ipcMain.handle("memory-sync:stop-periodic", async () =>
```

* Stop periodic sync
   * Channel: 'memory-sync:stop-periodic'

---

## ipcMain.handle("memory-sync:generate-report", async () =>

```javascript
ipcMain.handle("memory-sync:generate-report", async () =>
```

* Generate sync report
   * Channel: 'memory-sync:generate-report'

---

## ipcMain.handle("memory-sync:ensure-directories", async () =>

```javascript
ipcMain.handle("memory-sync:ensure-directories", async () =>
```

* Ensure all directories exist
   * Channel: 'memory-sync:ensure-directories'

---

