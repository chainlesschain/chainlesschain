# usage-report-generator-ipc

**Source**: `src/main/memory/usage-report-generator-ipc.js`

**Generated**: 2026-02-16T13:44:34.644Z

---

## const

```javascript
const
```

* UsageReportGenerator IPC Handlers
 * Handles IPC communication for usage report generation
 *
 * @module usage-report-generator-ipc
 * @version 1.0.0
 * @since 2026-01-18

---

## function registerUsageReportGeneratorIPC(

```javascript
function registerUsageReportGeneratorIPC(
```

* Register all UsageReportGenerator IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.usageReportGenerator - UsageReportGenerator instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle("report:generate-weekly", async (_event, options =

```javascript
ipcMain.handle("report:generate-weekly", async (_event, options =
```

* Generate weekly report
   * Channel: 'report:generate-weekly'

---

## ipcMain.handle("report:generate-monthly", async (_event, options =

```javascript
ipcMain.handle("report:generate-monthly", async (_event, options =
```

* Generate monthly report
   * Channel: 'report:generate-monthly'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Generate cost analysis
   * Channel: 'report:get-cost-analysis'

---

## ipcMain.handle("report:export", async (_event, reportId, options =

```javascript
ipcMain.handle("report:export", async (_event, reportId, options =
```

* Export report
   * Channel: 'report:export'

---

## ipcMain.handle("report:get", async (_event, reportId) =>

```javascript
ipcMain.handle("report:get", async (_event, reportId) =>
```

* Get report by ID
   * Channel: 'report:get'

---

## ipcMain.handle("report:list", async (_event, options =

```javascript
ipcMain.handle("report:list", async (_event, options =
```

* List reports
   * Channel: 'report:list'

---

## ipcMain.handle("report:configure-subscription", async (_event, config) =>

```javascript
ipcMain.handle("report:configure-subscription", async (_event, config) =>
```

* Configure subscription
   * Channel: 'report:configure-subscription'

---

## ipcMain.handle("report:get-subscriptions", async () =>

```javascript
ipcMain.handle("report:get-subscriptions", async () =>
```

* Get subscriptions
   * Channel: 'report:get-subscriptions'

---

## ipcMain.handle("report:delete-subscription", async (_event, id) =>

```javascript
ipcMain.handle("report:delete-subscription", async (_event, id) =>
```

* Delete subscription
   * Channel: 'report:delete-subscription'

---

## function updateUsageReportGenerator(newGenerator)

```javascript
function updateUsageReportGenerator(newGenerator)
```

* Update UsageReportGenerator reference
   * For hot-reload or reinitialization
   * @param {UsageReportGenerator} newGenerator - New instance

---

