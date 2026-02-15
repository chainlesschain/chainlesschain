# auto-backup-manager-ipc

**Source**: `src/main/memory/auto-backup-manager-ipc.js`

**Generated**: 2026-02-15T07:37:13.816Z

---

## const

```javascript
const
```

* AutoBackupManager IPC Handlers
 * Handles IPC communication for automatic backup management
 *
 * @module auto-backup-manager-ipc
 * @version 1.0.0
 * @since 2026-01-18

---

## function registerAutoBackupManagerIPC(

```javascript
function registerAutoBackupManagerIPC(
```

* Register all AutoBackupManager IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.autoBackupManager - AutoBackupManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle("backup:create-full", async (_event, scope = "all") =>

```javascript
ipcMain.handle("backup:create-full", async (_event, scope = "all") =>
```

* Create a full backup
   * Channel: 'backup:create-full'

---

## ipcMain.handle("backup:create-incremental", async (_event, scope = "all") =>

```javascript
ipcMain.handle("backup:create-incremental", async (_event, scope = "all") =>
```

* Create an incremental backup
   * Channel: 'backup:create-incremental'

---

## ipcMain.handle("backup:restore", async (_event, backupId, options =

```javascript
ipcMain.handle("backup:restore", async (_event, backupId, options =
```

* Restore from backup
   * Channel: 'backup:restore'

---

## ipcMain.handle("backup:delete", async (_event, backupId) =>

```javascript
ipcMain.handle("backup:delete", async (_event, backupId) =>
```

* Delete a backup
   * Channel: 'backup:delete'

---

## ipcMain.handle("backup:list", async (_event, options =

```javascript
ipcMain.handle("backup:list", async (_event, options =
```

* Get backup history
   * Channel: 'backup:list'

---

## ipcMain.handle("backup:get-stats", async () =>

```javascript
ipcMain.handle("backup:get-stats", async () =>
```

* Get backup statistics
   * Channel: 'backup:get-stats'

---

## ipcMain.handle("backup:configure-schedule", async (_event, config) =>

```javascript
ipcMain.handle("backup:configure-schedule", async (_event, config) =>
```

* Configure a backup schedule
   * Channel: 'backup:configure-schedule'

---

## ipcMain.handle("backup:update-schedule", async (_event, id, updates) =>

```javascript
ipcMain.handle("backup:update-schedule", async (_event, id, updates) =>
```

* Update a backup schedule
   * Channel: 'backup:update-schedule'

---

## ipcMain.handle("backup:delete-schedule", async (_event, id) =>

```javascript
ipcMain.handle("backup:delete-schedule", async (_event, id) =>
```

* Delete a backup schedule
   * Channel: 'backup:delete-schedule'

---

## ipcMain.handle("backup:get-schedules", async () =>

```javascript
ipcMain.handle("backup:get-schedules", async () =>
```

* Get all schedules
   * Channel: 'backup:get-schedules'

---

## function updateAutoBackupManager(newManager)

```javascript
function updateAutoBackupManager(newManager)
```

* Update AutoBackupManager reference
   * For hot-reload or reinitialization
   * @param {AutoBackupManager} newManager - New instance

---

