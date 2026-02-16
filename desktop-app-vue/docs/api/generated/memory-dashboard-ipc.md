# memory-dashboard-ipc

**Source**: `src/main/memory/memory-dashboard-ipc.js`

**Generated**: 2026-02-16T22:06:51.464Z

---

## const

```javascript
const
```

* Memory Dashboard IPC Handlers
 * Aggregates memory system data for the Memory Bank dashboard
 *
 * @module memory-dashboard-ipc
 * @version 1.0.0
 * @since 2026-01-18

---

## function registerMemoryDashboardIPC(dependencies)

```javascript
function registerMemoryDashboardIPC(dependencies)
```

* Register Memory Dashboard IPC handlers
 * @param {Object} dependencies - Memory system managers
 * @param {Object} dependencies.preferenceManager - PreferenceManager instance
 * @param {Object} dependencies.learnedPatternManager - LearnedPatternManager instance
 * @param {Object} dependencies.autoBackupManager - AutoBackupManager instance
 * @param {Object} dependencies.usageReportGenerator - UsageReportGenerator instance
 * @param {Object} dependencies.behaviorTracker - BehaviorTracker instance
 * @param {Object} dependencies.contextAssociator - ContextAssociator instance
 * @param {Object} dependencies.sessionManager - SessionManager instance
 * @param {Object} dependencies.configManager - UnifiedConfigManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle("memory:get-dashboard-stats", async () =>

```javascript
ipcMain.handle("memory:get-dashboard-stats", async () =>
```

* Get aggregated stats for dashboard overview
   * Channel: 'memory:get-dashboard-stats'

---

## ipcMain.handle("memory:get-all-patterns", async () =>

```javascript
ipcMain.handle("memory:get-all-patterns", async () =>
```

* Get all patterns (aggregated by type)
   * Channel: 'memory:get-all-patterns'

---

## ipcMain.handle("memory:get-all-preferences", async () =>

```javascript
ipcMain.handle("memory:get-all-preferences", async () =>
```

* Get all preferences
   * Channel: 'memory:get-all-preferences'

---

## ipcMain.handle("memory:get-behavior-insights", async () =>

```javascript
ipcMain.handle("memory:get-behavior-insights", async () =>
```

* Get behavior insights and recommendations
   * Channel: 'memory:get-behavior-insights'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get session list with summaries
   * Channel: 'memory:get-session-summaries'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Generate summaries for sessions without summary
   * Channel: 'memory:generate-session-summaries'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Export a single session summary to file
   * Channel: 'memory:export-session-summary'

---

## ipcMain.handle("memory:get-auto-summary-info", async () =>

```javascript
ipcMain.handle("memory:get-auto-summary-info", async () =>
```

* Get auto-summary configuration and statistics
   * Channel: 'memory:get-auto-summary-info'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Update auto-summary configuration
   * Channel: 'memory:update-auto-summary-config'

---

## ipcMain.handle("memory:toggle-background-summary", async (_event, enable) =>

```javascript
ipcMain.handle("memory:toggle-background-summary", async (_event, enable) =>
```

* Toggle background summary generator
   * Channel: 'memory:toggle-background-summary'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Trigger bulk summary generation for sessions without summaries
   * Channel: 'memory:trigger-auto-summaries'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get sessions without summaries
   * Channel: 'memory:get-sessions-without-summary'

---

## ipcMain.handle("memory:get-storage-stats", async () =>

```javascript
ipcMain.handle("memory:get-storage-stats", async () =>
```

* Get storage statistics
   * Channel: 'memory:get-storage-stats'

---

## ipcMain.handle("memory:create-backup", async (_event, type = "full") =>

```javascript
ipcMain.handle("memory:create-backup", async (_event, type = "full") =>
```

* Create a manual backup
   * Channel: 'memory:create-backup'

---

## ipcMain.handle("memory:cleanup-expired", async (_event, options =

```javascript
ipcMain.handle("memory:cleanup-expired", async (_event, options =
```

* Clean up expired data
   * Channel: 'memory:cleanup-expired'

---

## ipcMain.handle("memory:export-data", async (_event, exportType = "all") =>

```javascript
ipcMain.handle("memory:export-data", async (_event, exportType = "all") =>
```

* Export all memory data to files
   * Channel: 'memory:export-data'

---

