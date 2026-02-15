# preference-manager-ipc

**Source**: `src/main/memory/preference-manager-ipc.js`

**Generated**: 2026-02-15T07:37:13.814Z

---

## const

```javascript
const
```

* PreferenceManager IPC Handlers
 * Handles IPC communication for preference management
 *
 * @module preference-manager-ipc
 * @version 1.0.0
 * @since 2026-01-17

---

## function registerPreferenceManagerIPC(

```javascript
function registerPreferenceManagerIPC(
```

* Register all PreferenceManager IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.preferenceManager - PreferenceManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get a single preference
   * Channel: 'preference:get'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Set a single preference
   * Channel: 'preference:set'

---

## ipcMain.handle("preference:delete", async (_event, category, key) =>

```javascript
ipcMain.handle("preference:delete", async (_event, category, key) =>
```

* Delete a preference
   * Channel: 'preference:delete'

---

## ipcMain.handle("preference:get-category", async (_event, category) =>

```javascript
ipcMain.handle("preference:get-category", async (_event, category) =>
```

* Get all preferences in a category
   * Channel: 'preference:get-category'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Set multiple preferences in a category
   * Channel: 'preference:set-category'

---

## ipcMain.handle("preference:get-all", async () =>

```javascript
ipcMain.handle("preference:get-all", async () =>
```

* Get all preferences
   * Channel: 'preference:get-all'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Record a usage event
   * Channel: 'preference:record-usage'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get recent usage history
   * Channel: 'preference:get-recent-history'

---

## ipcMain.handle("preference:get-usage-stats", async (_event, options =

```javascript
ipcMain.handle("preference:get-usage-stats", async (_event, options =
```

* Get usage statistics
   * Channel: 'preference:get-usage-stats'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Add to search history
   * Channel: 'preference:add-search-history'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get search history
   * Channel: 'preference:get-search-history'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get search suggestions
   * Channel: 'preference:get-search-suggestions'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Clear search history
   * Channel: 'preference:clear-search-history'

---

## ipcMain.handle("preference:backup", async () =>

```javascript
ipcMain.handle("preference:backup", async () =>
```

* Backup all preferences
   * Channel: 'preference:backup'

---

## ipcMain.handle("preference:restore", async (_event, options =

```javascript
ipcMain.handle("preference:restore", async (_event, options =
```

* Restore from backup
   * Channel: 'preference:restore'

---

## ipcMain.handle("preference:get-stats", async () =>

```javascript
ipcMain.handle("preference:get-stats", async () =>
```

* Get statistics
   * Channel: 'preference:get-stats'

---

## ipcMain.handle("preference:clear-cache", async () =>

```javascript
ipcMain.handle("preference:clear-cache", async () =>
```

* Clear cache
   * Channel: 'preference:clear-cache'

---

## ipcMain.handle("preference:cleanup", async (_event, options =

```javascript
ipcMain.handle("preference:cleanup", async (_event, options =
```

* Cleanup old records
   * Channel: 'preference:cleanup'

---

## function updatePreferenceManager(newManager)

```javascript
function updatePreferenceManager(newManager)
```

* Update PreferenceManager reference
   * For hot-reload or reinitialization
   * @param {PreferenceManager} newManager - New PreferenceManager instance

---

